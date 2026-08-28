/** In-memory ACP transport fixture over the real agent factory and loop. */
/*
 * 文件职责：为 ACP 测试装配真实代理循环、脚本化模型、内存附件库和交叉连接的协议字节流。
 * 技术维度：使用 Cordis 测试插件、Web Streams、ACP SDK 连接和 Vitest 可控状态构造集成测试环境。
 * 产品维度：无需网络、密钥或真实模型即可重现自动化客户端的会话、富内容、权限和断开流程。
 * 逻辑维度：模型适配器消费预设流，附件库保存确定字节，makeBridgeHarness 挂载依赖并连接客户端与服务端。
 * 关键边界：脚本响应按调用顺序消耗；内存附件只做最小合法性检查；dispose 必须释放整个 Cordis fiber。
 * 新手阅读建议：先读 MockAdapter 的脚本消费，再看 MemoryAttachmentStore，最后跟随 makeBridgeHarness 的装配顺序。
 */

import { Context } from '@deepseek-ai/cordis'
import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  client as createAcpClientApp,
  methods,
  ndJsonStream,
  type Agent as AcpAgent,
  type PromptRequest,
  type PromptResponse,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SendRequestOptions,
  type SessionNotification,
  type Stream,
} from '@agentclientprotocol/sdk'
import AttachmentStore, { AttachmentError, AttachmentId } from '@deepseek-ai/dsh-attachment'
import type { ImageAttachmentLimits, ImageAttachmentRef, SaveImageAttachment, StoredImageAttachment } from '@deepseek-ai/dsh-attachment'
import { type GenerateOptions, LlmAdapter, ReasoningEffortId, type LlmResolvedModelInfo, type StreamChunk } from '@deepseek-ai/dsh-llm'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import * as AcpPlugin from '../src/index.ts'
import type { AcpConfig } from '../src/index.ts'

/** Scripted adapter for protocol tests. */
/* 按预设流片段返回模型输出的确定性测试适配器。 */
class MockAdapter extends LlmAdapter {
  /** 已收到的全部模型请求，供测试检查最终消息和系统提示。 */
  readonly requests: GenerateOptions[] = []

  /**
   * 创建脚本化模型适配器。
   * @param script 每次请求依次消费的流片段或挂起标记。
   * @param imageCapable 是否声明图片输入能力。
   * @example new MockAdapter([textResponse('ok')], false)
   */
  constructor(
    private readonly script: (StreamChunk[] | 'hang')[],
    private readonly imageCapable: boolean,
    private readonly provider = 'mock',
  ) {
    super()
  }

  override providerInfo(provider: string) {
    if (provider !== this.provider) throw new Error(`MockAdapter: unknown provider ${provider}`)
    return { id: this.provider, name: this.provider === 'mock' ? 'Mock' : `Mock ${this.provider}` }
  }

  override listModels(provider: string) {
    return Promise.resolve(provider === this.provider ? [
      {
        provider: this.provider,
        id: 'mock',
        name: 'Mock Reasoner',
        description: 'Mock model with selectable reasoning.',
        inputModalities: this.imageCapable ? ['text', 'image'] as const : ['text'] as const,
      },
      {
        provider: this.provider,
        id: 'plain',
        name: 'Mock Plain',
        inputModalities: ['text'] as const,
      },
    ] : [])
  }

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({
      provider,
      id: model,
      name: model,
      inputModalities: this.imageCapable && model === 'mock' ? ['text', 'image'] : ['text'],
      context: { contextWindow: 1_024 },
      ...model === 'mock' ? {
        reasoning: {
          efforts: [
            { id: ReasoningEffortId('low'), name: 'Low' },
            { id: ReasoningEffortId('high'), name: 'High' },
          ],
          defaultEffort: ReasoningEffortId('high'),
        },
      } : {},
    })
  }

  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    // 本次模型调用应消费的下一条预设响应。
    const entry = this.script.shift()
    if (entry === undefined) throw new Error('MockAdapter: script exhausted')
    if (entry === 'hang') {
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: 'partial' }
      await new Promise<void>((_resolve, reject) => {
        if (options.signal?.aborted) {
          reject(new Error('aborted'))
          return
        }
        options.signal?.addEventListener('abort', () => { reject(new Error('aborted')) }, { once: true })
      })
      return
    }
    for (const chunk of entry) {
      if (options.signal?.aborted) throw new Error('aborted')
      yield chunk
    }
  }
}

// 内存附件库用于测试的尺寸、数量、总量和媒体类型限制。
const IMAGE_LIMITS: ImageAttachmentLimits = {
  maxImageBytes: 1024,
  maxImagesPerMessage: 4,
  maxMessageImageBytes: 2048,
  maxImagePixels: 1024,
  maxImageDimension: 2000,
  mediaTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
}

/** In-memory durable store for ACP wire-order and lifecycle tests. */
/* 在进程内模拟持久图片存储，并提供可控验证与读取暂停点。 */
class MemoryAttachmentStore extends AttachmentStore {
  /** 对外公布的固定图片准入限制。 */
  readonly imageLimits = IMAGE_LIMITS
  /** 按保存顺序记录的原始图片输入。 */
  readonly saved: SaveImageAttachment[] = []
  /** 附件标识到复制后图片记录的内存映射。 */
  readonly objects = new Map<string, StoredImageAttachment>()
  /** 可选验证前暂停钩子，用于制造取消和释放竞态。 */
  beforeValidate: (() => Promise<void>) | undefined
  /** 可选读取前暂停钩子，用于证明输出排空顺序。 */
  beforeRead: (() => Promise<void>) | undefined

  /** 验证图片非空，并允许测试在验证前暂停。 */
  async validateImage(input: SaveImageAttachment): Promise<void> {
    await this.beforeValidate?.()
    if (input.data.byteLength === 0) throw new AttachmentError('Image is empty.', 'INVALID_IMAGE')
  }

  /** 保存图片副本并返回基于 SHA-256 的确定性引用。 */
  saveImage(input: SaveImageAttachment): Promise<ImageAttachmentRef> {
    this.saved.push(input)
    // 图片字节的 SHA-256 十六进制摘要。
    const digest = createHash('sha256').update(input.data).digest('hex')
    // 根据摘要、媒体类型和固定尺寸构造的附件引用。
    const ref: ImageAttachmentRef = {
      attachmentId: AttachmentId(`sha256:${digest}`),
      mediaType: input.mediaType,
      bytes: input.data.byteLength,
      width: 1,
      height: 1,
    }
    this.objects.set(ref.attachmentId, { ref, data: Uint8Array.from(input.data) })
    return Promise.resolve(ref)
  }

  /** 根据引用读取图片副本，不存在时抛出稳定附件错误。 */
  async readImage(ref: ImageAttachmentRef): Promise<StoredImageAttachment> {
    await this.beforeRead?.()
    // 标识对应的内存图片对象。
    const stored = this.objects.get(ref.attachmentId)
    if (stored === undefined) throw new AttachmentError('Attachment object is missing.', 'ATTACHMENT_NOT_FOUND')
    return { ref: stored.ref, data: Uint8Array.from(stored.data) }
  }
}

/** Scripted text response ending in a clean stop. */
/*
 * 构造逐字符输出并正常停止的脚本响应。
 * @param text 要提交的完整助手文本。
 * @returns 可由 MockAdapter 依次发送的流片段。
 * @example textResponse('hello')
 */
export function textResponse(text: string): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    ...Array.from(text, (char): StreamChunk => ({ type: 'text-delta', index: 0, text: char })),
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'usage', usage: { inputTokens: 5, outputTokens: text.length } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

/** Scripted response ending at the output-token ceiling. */
/*
 * 构造在输出令牌上限结束但仍提交文本的脚本响应。
 * @param text 截止前提交的助手文本。
 * @returns 以 max-tokens 原因结束的流片段。
 * @example maxTokensResponse('partial answer')
 */
export function maxTokensResponse(text: string): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    ...Array.from(text, (char): StreamChunk => ({ type: 'text-delta', index: 0, text: char })),
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'finish', reason: { kind: 'max-tokens' } },
  ]
}

/** Scripted response that fails after publishing an uncommitted partial chunk. */
/*
 * 构造发送未提交片段后以提供方错误结束的响应。
 * @param message 错误结束原因中的安全说明。
 * @returns 不包含 block-end 的失败流片段。
 * @example errorResponse('provider unavailable')
 */
export function errorResponse(message: string): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text: 'partial' },
    { type: 'finish', reason: { kind: 'error', failure: { message, code: 'PROVIDER_ERROR' } } },
  ]
}

/** 从会话通知中提取的协议更新类型。 */
export type CapturedUpdate = SessionNotification['update']

/** Stable-v1 client methods exercised by the bridge tests. */
interface BridgeClient {
  initialize: NonNullable<AcpAgent['initialize']>
  authenticate: NonNullable<AcpAgent['authenticate']>
  newSession: NonNullable<AcpAgent['newSession']>
  listSessions: NonNullable<AcpAgent['listSessions']>
  resumeSession: NonNullable<AcpAgent['resumeSession']>
  closeSession: NonNullable<AcpAgent['closeSession']>
  setSessionConfigOption: NonNullable<AcpAgent['setSessionConfigOption']>
  prompt: (params: PromptRequest, options?: SendRequestOptions) => Promise<PromptResponse>
  cancel: NonNullable<AcpAgent['cancel']>
}

export interface BridgeHarness {
  /** 挂载真实测试依赖的 Cordis 根上下文。 */
  ctx: Context
  client: BridgeClient
  adapter: MockAdapter
  /** 可选内存附件库；options.attachments=false 时不存在。 */
  attachments: MemoryAttachmentStore | undefined
  /** 不区分会话收集的协议更新。 */
  updates: CapturedUpdate[]
  /** 保留 sessionId 的协议更新记录。 */
  sessionUpdates: { sessionId: string; update: CapturedUpdate }[]
  /** 客户端收到的权限请求记录。 */
  permissionRequests: RequestPermissionRequest[]
  persistenceRoot: string
  onPermission: (request: RequestPermissionRequest) => RequestPermissionResponse
  /** 设置后让客户端拒绝会话更新，用于测试传输失败隔离。 */
  onSessionUpdateError: (() => void) | undefined
  registerCatalogProvider: (provider: string) => () => void
  replacePrimaryProviders: (providers: string[]) => void
  closeClientTransport: () => Promise<void>
  /** 以错误中止客户端到代理端的输入流。 */
  abortClientTransport: () => Promise<void>
  /** ACP 测试插件的 Cordis fiber。 */
  acpFiber: Awaited<ReturnType<Context['plugin']>>
  /** The AgentLoop fiber, so a test can reload the loop out from under the bridge. */
  /* 代理循环 fiber，允许测试在桥接仍存活时重载循环。 */
  loopFiber: Awaited<ReturnType<Context['plugin']>>
  /** 释放整个测试上下文及其所有插件。 */
  dispose: () => Promise<void>
}

/** 允许测试显式传入 undefined 的 ACP 配置覆盖类型。 */
type AcpConfigOverrides = { [K in keyof AcpConfig]?: AcpConfig[K] | undefined }

/** Build the bridge and a connected SDK client over cross-wired byte streams. */
/*
 * 构建通过交叉字节流连接的 ACP 桥接层和 SDK 客户端。
 * @param options 模型脚本、配置、人格、图片能力和附件服务开关。
 * @returns 已挂载并可直接发起协议调用的测试装配。
 * @example await makeBridgeHarness({ script: [textResponse('ok')] })
 */
export async function makeBridgeHarness(options: {
  script?: (StreamChunk[] | 'hang')[]
  config?: AcpConfigOverrides
  persona?: string
  imageCapable?: boolean
  attachments?: boolean
  persistenceRoot?: string
} = {}): Promise<BridgeHarness> {
  // 根据测试参数创建的脚本化模型适配器。
  const adapter = new MockAdapter(options.script ?? [], options.imageCapable === true)
  // 隔离当前测试插件树的 Cordis 根上下文。
  const ctx = new Context()
  const ownsPersistenceRoot = options.persistenceRoot === undefined
  const persistenceRoot = options.persistenceRoot ?? await mkdtemp(join(tmpdir(), 'dsh-acp-test-'))
  await mountAgentLoopTestDependencies(ctx, { systemPrompt: { persona: options.persona ?? '' } })
  await ctx.plugin(JsonlSessionPersistence, { root: persistenceRoot, compression: 'none' })
  await ctx.plugin(TokenMeter)
  if (options.attachments !== false) await ctx.plugin(MemoryAttachmentStore)
  // 真实代理循环插件的 fiber，测试可单独重载它。
  const loopFiber = await ctx.plugin(AgentLoop, { agents: [] })
  const primaryAdapter = ctx.llm.registerAdapter(['mock'], adapter)

  // 代理端写、客户端读的字节流。
  const agentToClient = new TransformStream<Uint8Array, Uint8Array>()
  // 客户端写、代理端读的字节流。
  const clientToAgent = new TransformStream<Uint8Array, Uint8Array>()
  // 测试用于关闭或中止客户端传输的底层写入器。
  const clientToAgentWriter = clientToAgent.writable.getWriter()
  // 把客户端输出转发到代理输入写入器的适配流。
  const clientOutput = new WritableStream<Uint8Array>({
    write: chunk => clientToAgentWriter.write(chunk),
  })
  // ACP 服务端使用的 NDJSON 双向流。
  const agentStream: Stream = ndJsonStream(agentToClient.writable, clientToAgent.readable)
  // ACP 客户端使用的 NDJSON 双向流。
  const clientStream: Stream = ndJsonStream(clientOutput, agentToClient.readable)

  // 所有会话合并后的更新记录。
  const updates: CapturedUpdate[] = []
  // 保留会话归属的更新记录。
  const sessionUpdates: { sessionId: string; update: CapturedUpdate }[] = []
  // 客户端收到的权限请求记录。
  const permissionRequests: RequestPermissionRequest[] = []
  // 先创建可被回调闭包引用的可变测试装配对象。
  const harness: BridgeHarness = {
    ctx,
    adapter,
    attachments: ctx.get('attachments') as MemoryAttachmentStore | undefined,
    updates,
    sessionUpdates,
    permissionRequests,
    persistenceRoot,
    onPermission: () => ({ outcome: { outcome: 'cancelled' } }),
    onSessionUpdateError: undefined,
    registerCatalogProvider: provider => ctx.llm.registerAdapter([provider], new MockAdapter([], false, provider)),
    replacePrimaryProviders: (providers) => { primaryAdapter.replace(providers) },
    client: undefined as unknown as BridgeClient,
    acpFiber: undefined as unknown as BridgeHarness['acpFiber'],
    loopFiber,
    closeClientTransport: async () => { await clientToAgentWriter.close() },
    abortClientTransport: async () => { await clientToAgentWriter.abort(new Error('client transport failed')) },
    dispose: async () => {
      await ctx.fiber.dispose()
      if (ownsPersistenceRoot) await rm(persistenceRoot, { recursive: true, force: true })
    },
  }

  const clientApp = createAcpClientApp({ name: 'dsh-acp-test-client' })
    .onNotification(methods.client.session.update, ({ params }) => {
      updates.push(params.update)
      sessionUpdates.push({ sessionId: params.sessionId, update: params.update })
      if (harness.onSessionUpdateError !== undefined) return Promise.reject(new Error('client update rejected'))
      return Promise.resolve()
    })
    .onRequest(methods.client.session.requestPermission, ({ params }) => {
      permissionRequests.push(params)
      return Promise.resolve(harness.onPermission(params))
    })

  // 将内存传输与调用者覆盖合并后的 ACP 插件运行配置。
  const config = { stream: agentStream, ...options.config } as AcpConfig
  if (!(options.config && 'provider' in options.config)) config.provider = 'mock'
  if (!(options.config && 'model' in options.config)) config.model = 'mock'
  harness.acpFiber = await ctx.plugin({
    name: 'acp-test',
    inject: [...AcpPlugin.inject],
    apply: (inner: Context) => { AcpPlugin.apply(inner, config) },
  })
  const clientConnection = clientApp.connect(clientStream)
  const client = clientConnection.agent
  harness.client = {
    initialize: params => client.request(methods.agent.initialize, params),
    authenticate: params => client.request(methods.agent.authenticate, params),
    newSession: params => client.request(methods.agent.session.new, params),
    listSessions: params => client.request(methods.agent.session.list, params),
    resumeSession: params => client.request(methods.agent.session.resume, params),
    closeSession: params => client.request(methods.agent.session.close, params),
    setSessionConfigOption: params => client.request(methods.agent.session.setConfigOption, params),
    prompt: (params, options) => client.request(methods.agent.session.prompt, params, options),
    cancel: params => client.notify(methods.agent.session.cancel, params),
  }
  return harness
}
