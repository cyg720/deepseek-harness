/**
 * ================================ 文件注释 ================================
 * 【文件职责】模型可见的只读 Cordis 能力查询（inspect）的 Host 侧注册表与跨页面
 *             路由：Host 本地提供者（如服务清单）直接执行；Client 提供者则把查询
 *             广播到浏览器页面等待实时应答。对应 cordis_inspect_list 与查询工具。
 * 【技术维度】Cordis Service 子类；提供者注册返回幂等 disposer；查询输入/输出都经
 *             JSON Schema 校验且必须无损 JSON（snapshotJsonValue）；Client 查询用
 *             Promise + AbortSignal 挂起，事件广播后由 resolveClientQuery 结算。
 * 【产品维度】让模型能够"问清楚再动手"：列出 Host/Client 两侧可用的只读查询并用
 *             实时结果辅助决策（如查某个服务有哪些方法再调用），且全程只读、可控。
 * 【逻辑维度】注册（register/syncClientManifest）→ 目录（list）→ 执行（query 分
 *             Host/Client 两条路径）→ Client 应答结算（resolveClientQuery）→ 若干
 *             校验助手（validateManifest/findMethod/validateInput/validateOutput）。
 * 【关键边界】提供者 ID 与方法名必须唯一；Client 应答"先到先得"且只认有效 JSON
 *             输出；查询可被 AbortSignal 取消（取消时广播已结算事件）。
 * 【新手阅读建议】先读 query 看 Host/Client 分支，再看 queryClient 的挂起/取消逻辑，
 *             最后看 validateManifest 与 validateInput/Output 的校验规则。
 * ==========================================================================
 */

/** Host registry for model-visible, read-only Cordis capability queries. */

import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { snapshotJsonValue } from '@deepseek-ai/dsh-session'
import type { JsonValue } from '@deepseek-ai/dsh-session/types'
import { assertSupportedJsonSchema, validateJsonSchemaValue } from '@deepseek-ai/dsh-tools'
import type { JsonSchemaNode } from '@deepseek-ai/dsh-tools'
import type {
  CordisInspectMethodManifest, CordisInspectPlatform, CordisInspectProviderManifest,
  CordisInspectProviderView, CordisInspectQueryRequest, CordisInspectQueryResolution,
  CordisInspectRequestId, CordisInspectResolveAck,
} from './types.ts'

/** Context supplied to a Host inspect query. */
/**
 * 提供给 Host inspect 查询的上下文：工具调用取消信号与发起查询的 agent（用于限定
 * 被检查的运行时作用域）。
 */
export interface HostCordisInspectQueryContext {
  /** Tool-call cancellation. */
  signal: AbortSignal
  /** Agent whose scoped runtime is being inspected. */
  agent: Agent
}

/** Local registration paired with its serializable manifest. */
/**
 * 本地提供者注册项：可序列化的清单 + 执行指定方法的查询函数。
 */
export interface HostCordisInspectProviderRegistration {
  /** Provider and explicit method directory. */
  manifest: CordisInspectProviderManifest
  /** Execute one declared method. */
  query(method: string, input: JsonValue | undefined, context: HostCordisInspectQueryContext): Promise<JsonValue>
}

interface PendingClientQuery {
  request: CordisInspectQueryRequest
  method: CordisInspectMethodManifest
  settle(resolution: CordisInspectQueryResolution): void
}
// 挂起的 Client 查询：等待某页面应答的请求、对应方法清单与结算回调（Promise resolve）

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host registry for Cordis inspect providers and Client manifest/query routing. */
    // Host 侧 inspect 提供者注册表与 Client 目录/查询路由
    cordisInspect: CordisInspectRegistryService
  }
}

/** Registry and cross-page router behind the two model-facing inspect tools. */
/**
 * 两个模型侧 inspect 工具背后的注册表与跨页面路由器：统一管理 Host/Client 提供者
 * 目录，把查询分发到对应平面并做输入/输出校验。
 */
export class CordisInspectRegistryService extends Service {
  // Host 本地提供者：提供者 ID -> 注册项
  private readonly providers = new Map<string, HostCordisInspectProviderRegistration>()
  // 挂起的 Client 查询：请求 ID -> 待结算查询
  private readonly pending = new Map<CordisInspectRequestId, PendingClientQuery>()
  // Client 提供者目录镜像（由 Client 侧同步过来，冻结后只读）
  private clientManifest: readonly CordisInspectProviderManifest[] | undefined
  // Client 查询请求 ID 自增计数器
  private nextRequest = 1

  /** Register the process-global Host registry. */
  /**
   * 在 Host 组合下创建服务：注册为 cordisInspect 服务。
   */
  constructor(ctx: Context) {
    super(ctx, 'cordisInspect')
  }

  /**
   * Register one Host provider.
   * @param registration - manifest and local query handler.
   * @returns idempotent disposer.
   */
  /**
   * 注册一个 Host 本地提供者：校验清单后入库；重复注册同一 ID 报错。
   * @returns 幂等卸载函数（仅当自己仍是当前注册项时才删除）
   */
  register(registration: HostCordisInspectProviderRegistration): () => void {
    const manifest = validateManifest(registration.manifest)
    if (this.providers.has(manifest.id)) throw new Error(`Host Cordis inspect provider "${manifest.id}" is already registered`)
    const stored = { ...registration, manifest }
    this.providers.set(manifest.id, stored)
    return () => {
      if (this.providers.get(manifest.id) === stored) this.providers.delete(manifest.id)
    }
  }

  /**
   * Replace the mirrored Client provider directory.
   * @param providers - complete Client manifest snapshot.
   */
  /**
   * 替换 Client 提供者目录镜像：整体校验（含重复 ID 检查）后冻结存储。
   */
  syncClientManifest(providers: readonly CordisInspectProviderManifest[]): void {
    const ids = new Set<string>()
    const validated = providers.map((provider) => {
      const manifest = validateManifest(provider)
      if (ids.has(manifest.id)) throw new Error(`Client Cordis inspect manifest repeats provider "${manifest.id}"`)
      ids.add(manifest.id)
      return manifest
    })
    this.clientManifest = Object.freeze(validated)
  }

  /**
   * Return the complete known Host and Client provider directory.
   * @returns Host providers followed by the Client providers.
   */
  /**
   * 返回完整目录：Host 提供者在前、Client 镜像在后（每行都带运行平面标注）。
   */
  list(): CordisInspectProviderView[] {
    return [
      ...[...this.providers.values()].map(provider => view('host', provider.manifest)),
      ...(this.clientManifest ?? []).map(provider => view('client', provider)),
    ]
  }

  /**
   * Execute one provider query on its owning platform.
   * @param platform - Host or Client runtime.
   * @param providerId - provider selected from {@link list}.
   * @param methodName - declared method name.
   * @param input - optional lossless JSON input.
   * @param agent - requesting Agent and scope.
   * @param signal - tool-call cancellation.
   * @returns provider JSON data.
   */
  /**
   * 在提供者所属平面执行查询：Host 路径直接调本地查询函数；Client 路径广播事件
   * 并等待页面应答。两端都在执行前后校验输入/输出 schema 与取消信号。
   */
  async query(
    platform: CordisInspectPlatform,
    providerId: string,
    methodName: string,
    input: JsonValue | undefined,
    agent: Agent,
    signal: AbortSignal,
  ): Promise<JsonValue> {
    if (platform === 'host') {
      const registration = this.providers.get(providerId)
      if (registration === undefined) throw new Error(`Host Cordis inspect provider "${providerId}" is not registered`)
      const method = findMethod(registration.manifest, methodName)
      validateInput('Host', providerId, method, input)
      signal.throwIfAborted()
      const data = await registration.query(methodName, input, { agent, signal })
      signal.throwIfAborted()
      return validateOutput('Host', providerId, method, data)
    }
    return await this.queryClient(providerId, methodName, input, agent, signal)
  }

  /**
   * Accept the first valid Client response for a pending query.
   * @param agent - Agent whose Session owns the query.
   * @param requestId - Pending Client query identity.
   * @param resolution - Client provider result or failure.
   * @returns whether this response settled the still-pending query.
   */
  /**
   * 认领并结算一次挂起的 Client 查询：校验请求属于该会话、应答成功且输出符合
   * schema，才删除挂起项并广播"已结算"事件；否则返回未接受。
   */
  resolveClientQuery(
    agent: Agent,
    requestId: CordisInspectRequestId,
    resolution: CordisInspectQueryResolution,
  ): CordisInspectResolveAck {
    const pending = this.pending.get(requestId)
    if (pending === undefined || pending.request.agentId !== agent.id) return { accepted: false }
    if (!resolution.ok) return { accepted: false }
    try {
      resolution = {
        ok: true,
        data: validateOutput('Client', pending.request.provider, pending.method, resolution.data),
      }
    } catch {
      return { accepted: false }
    }
    this.pending.delete(requestId)
    pending.settle(resolution)
    this.ctx.emit('cordis/inspect-query-resolved', { requestId })
    return { accepted: true }
  }

  /**
   * 路由一次 Client 查询：登记挂起项、广播 cordis/inspect-query 事件等待页面应答；
   * 信号取消时结算为 cancelled 并广播"已结算"。异常路径统一转成 Error 抛出。
   */
  private async queryClient(
    providerId: string,
    methodName: string,
    input: JsonValue | undefined,
    agent: Agent,
    signal: AbortSignal,
  ): Promise<JsonValue> {
    const provider = this.clientManifest?.find(candidate => candidate.id === providerId)
    if (provider === undefined) throw new Error(`Client Cordis inspect provider "${providerId}" is not registered`)
    const method = findMethod(provider, methodName)
    validateInput('Client', providerId, method, input)
    signal.throwIfAborted()
    const requestId = `inspect-${this.nextRequest++}` as CordisInspectRequestId
    const request: CordisInspectQueryRequest = {
      requestId,
      agentId: agent.id,
      provider: providerId,
      method: methodName,
      ...input === undefined ? {} : { input },
    }
    const result = new Promise<CordisInspectQueryResolution>((resolve) => {
      this.pending.set(requestId, { request, method, settle: resolve })
    })
    const onAbort = (): void => {
      const pending = this.pending.get(requestId)
      if (pending === undefined) return
      this.pending.delete(requestId)
      pending.settle({ ok: false, reason: 'cancelled', message: `Client inspect query ${providerId}.${methodName} was cancelled` })
      this.ctx.emit('cordis/inspect-query-resolved', { requestId })
    }
    signal.addEventListener('abort', onAbort, { once: true })
    if (signal.aborted) onAbort()
    else this.ctx.emit('cordis/inspect-query', request)
    try {
      const resolution = await result
      if (!resolution.ok) throw new Error(`${providerId}.${methodName}: ${resolution.message}`)
      return resolution.data
    } finally {
      signal.removeEventListener('abort', onAbort)
    }
  }
}

function view(platform: CordisInspectPlatform, manifest: CordisInspectProviderManifest): CordisInspectProviderView {
  // 组装目录行：平台标注 + 清单 + 方法清单拷贝
  return { platform, ...manifest, methods: [...manifest.methods] }
}

/**
 * 校验提供者清单：ID/描述非空、方法名唯一且非空、输入输出 schema 受支持；
 * 通过后整体冻结（含方法数组），保证镜像只读。
 */
function validateManifest(manifest: CordisInspectProviderManifest): CordisInspectProviderManifest {
  if (manifest.id.trim() === '') throw new Error('Cordis inspect provider id must not be empty')
  if (manifest.description.trim() === '') throw new Error(`Cordis inspect provider "${manifest.id}" needs a description`)
  const names = new Set<string>()
  const methods = manifest.methods.map((method) => {
    if (method.name.trim() === '') throw new Error(`Cordis inspect provider "${manifest.id}" has an empty method name`)
    if (names.has(method.name)) throw new Error(`Cordis inspect provider "${manifest.id}" repeats method "${method.name}"`)
    if (method.description.trim() === '') throw new Error(`Cordis inspect method ${manifest.id}.${method.name} needs a description`)
    assertSupportedJsonSchema(method.inputSchema)
    assertSupportedJsonSchema(method.outputSchema)
    names.add(method.name)
    return Object.freeze({ ...method })
  })
  return Object.freeze({ ...manifest, methods: Object.freeze(methods) })
}

/**
 * 在提供者清单中查找方法；找不到时报错（提供者存在但方法名写错）。
 */
function findMethod(manifest: CordisInspectProviderManifest, name: string): CordisInspectMethodManifest {
  const method = manifest.methods.find(candidate => candidate.name === name)
  if (method === undefined) throw new Error(`Cordis inspect provider "${manifest.id}" has no method "${name}"`)
  return method
}

/**
 * 校验查询输入：按方法声明的 inputSchema 校验（缺省视为空对象），不合规报错。
 */
function validateInput(
  platform: 'Host' | 'Client',
  provider: string,
  method: CordisInspectMethodManifest,
  input: JsonValue | undefined,
): void {
  const violations = validateJsonSchemaValue(method.inputSchema as JsonSchemaNode, input ?? {}, 'input')
  if (violations.length > 0) throw new Error(`${platform} Cordis inspect ${provider}.${method.name} rejected input: ${violations.join('; ')}`)
}

/**
 * 校验查询输出：先保证是无损 JSON 快照，再按 outputSchema 校验，返回规范化快照。
 */
function validateOutput(
  platform: 'Host' | 'Client',
  provider: string,
  method: CordisInspectMethodManifest,
  data: JsonValue,
): JsonValue {
  const snapshot = snapshotJsonValue(data)
  if (snapshot === undefined) throw new Error(`${platform} Cordis inspect ${provider}.${method.name} returned a non-JSON value`)
  const violations = validateJsonSchemaValue(method.outputSchema as JsonSchemaNode, snapshot, 'output')
  if (violations.length > 0) throw new Error(`${platform} Cordis inspect ${provider}.${method.name} returned invalid output: ${violations.join('; ')}`)
  return snapshot
}
