/**
 * 文件职责：验证DeepSeek LLM的 adapter.e2e.ts 行为与网络边界。
 * 技术维度：TypeScript、Fetch、SSE、OAuth/密钥认证、模型目录和运行时模式校验。
 * 产品维度：让 Agent 能稳定调用供应商模型、发现能力并接收流式结果。
 * 逻辑维度：构造请求或模拟服务器，驱动适配器并断言事件与错误。
 * 关键边界：网络响应属于不可信输入；密钥和令牌不得记录；取消必须终止请求与流。
 * 新手阅读建议：先读 config/auth/catalog，再看 adapter/stream，最后阅读错误和重放测试。
 */
import { readFileSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { createUserMessage, CallId, ReasoningEffortId, createMessage } from '@deepseek-ai/dsh-llm'
import type { Message, ToolSchema } from '@deepseek-ai/dsh-llm'
import AttachmentStore, { AttachmentId, ImageVariantId } from '@deepseek-ai/dsh-attachment'
import type {
  ImageAttachmentLimits,
  ImageAttachmentRef,
  ImageRequestPolicy,
  RequestImageAttachment,
  SaveImageAttachment,
  StoredImageAttachment,
} from '@deepseek-ai/dsh-attachment'
import { LocalCredentialProvider } from '@deepseek-ai/dsh-credentials-local'
import * as LlmDeepSeek from '@deepseek-ai/dsh-llm-deepseek'
import type { Config } from '@deepseek-ai/dsh-llm-deepseek'
import { assemble, type AssembledResult } from './assemble.ts'

/**
 * Real-API e2e for the direct-fetch adapter: V4 Flash + V4 Pro across
 * thinking modes and all official effort levels. The suite skips entirely
 * without $DEEPSEEK_API_KEY; the pre-release vision smoke additionally
 * requires $DEEPSEEK_VISION_E2E=1 (see vitest.e2e.config.ts).
 */

/* 中文说明：测试局部值 FLASH，由紧邻初始化决定。 */
const FLASH = 'deepseek-v4-flash'
/** 中文说明：测试局部值 PRO，由紧邻初始化决定。 */
const PRO = 'deepseek-v4-pro'
/** 中文说明：测试局部值 VISION，由紧邻初始化决定。 */
const VISION = 'deepseek-v4-flash-vision-exp'
/** 中文说明：测试局部值 VISION_E2E_ENABLED，由紧邻初始化决定。 */
const VISION_E2E_ENABLED = process.env.DEEPSEEK_VISION_E2E === '1'
/** 中文说明：测试局部值 TEST_PNG，由紧邻初始化决定。 */
const TEST_PNG = Uint8Array.from(readFileSync(
  new URL('../../llm-pi-ai/tests/fixtures/qr-code.png', import.meta.url),
))
/** 中文说明：测试局部值 contexts，由紧邻初始化决定。 */
const contexts: Context[] = []
/** 中文说明：测试局部值 identityHome: string，由紧邻初始化决定。 */
let identityHome: string

/** 中文说明：类型或类 E2eAttachmentStore 约束模型请求、认证或流事件职责。 */
class E2eAttachmentStore extends AttachmentStore {
  readonly imageLimits: ImageAttachmentLimits = {
    maxImageBytes: TEST_PNG.byteLength,
    maxImagesPerMessage: 1,
    maxMessageImageBytes: TEST_PNG.byteLength,
    maxImagePixels: 256 * 256,
    maxImageDimension: 256,
    mediaTypes: ['image/png'],
  }
  readonly ref: ImageAttachmentRef = {
    attachmentId: AttachmentId(`sha256:${randomBytes(32).toString('hex')}`),
    mediaType: 'image/png',
    bytes: TEST_PNG.byteLength,
    width: 256,
    height: 256,
    name: 'files-api-e2e.png',
  }
  readonly version: RequestImageAttachment = {
    variantId: ImageVariantId(`sha256:${randomBytes(32).toString('hex')}`),
    attachment: this.ref,
    data: TEST_PNG,
    mediaType: 'image/png',
    bytes: TEST_PNG.byteLength,
    width: 256,
    height: 256,
    depth: 'uchar',
    space: 'srgb',
    hasAlpha: false,
  }

  validateImage(_input: SaveImageAttachment): Promise<void> {
    return Promise.resolve()
  }

  saveImage(_input: SaveImageAttachment): Promise<ImageAttachmentRef> {
    return Promise.resolve(this.ref)
  }

  readImage(ref: ImageAttachmentRef, _signal?: AbortSignal): Promise<StoredImageAttachment> {
    return Promise.resolve({ ref, data: TEST_PNG })
  }

  override readImageRequest(
    _ref: ImageAttachmentRef,
    _policy: ImageRequestPolicy,
    _signal?: AbortSignal,
  ): Promise<RequestImageAttachment> {
    return Promise.resolve(this.version)
  }
}

beforeEach(async () => {
  identityHome = await mkdtemp(join(tmpdir(), 'dsh-e2e-user-id-'))
  vi.stubEnv('DSH_HOME', identityHome)
})

/** 中文说明：函数 harness 的参数见签名，返回结果供模型流程使用；示例见本文件。 */
async function harness(_model: string, config: Partial<Config> = {}) {
  /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(E2eAttachmentStore)
  await ctx.plugin(LlmDeepSeek, config)
  return ctx
}

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  await rm(identityHome, { recursive: true, force: true })
})

/** 中文说明：函数 ask 的参数见签名，返回结果供模型流程使用；示例见本文件。 */
function ask(text: string): Message[] {
  return [createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'plugin', plugin: 'test' },
  })]
}

/** 中文说明：函数 textOf 的参数见签名，返回结果供模型流程使用；示例见本文件。 */
function textOf(result: AssembledResult): string {
  return result.message.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('')
}

/** 中文说明：测试局部值 weatherTool，由紧邻初始化决定。 */
const weatherTool: ToolSchema = {
  name: 'get_weather',
  description: 'Get the current weather for a city.',
  parameters: {
    type: 'object',
    properties: { city: { type: 'string', description: 'City name' } },
    required: ['city'],
  },
}

describe.skipIf(!process.env.DEEPSEEK_API_KEY)('llm-deepseek e2e (real API)', () => {
  it.skipIf(!VISION_E2E_ENABLED)('uses the built-in official route to upload, reference, and delete one image', async () => {
    /** 中文说明：测试局部值 key，由紧邻初始化决定。 */
    const key = process.env.DEEPSEEK_API_KEY
    if (key === undefined) throw new Error('e2e ran without DEEPSEEK_API_KEY')
    /** 中文说明：测试局部值 baseURL，由紧邻初始化决定。 */
    const baseURL = process.env.DEEPSEEK_BASE_URL ?? LlmDeepSeek.PUBLIC_BASE_URL
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await harness(VISION, { baseURL })
    await ctx.plugin(E2eAttachmentStore)
    /** 中文说明：测试局部值 attachments，由紧邻初始化决定。 */
    const attachments = ctx.attachments as E2eAttachmentStore
    /** 中文说明：测试局部值 解构结果，由紧邻初始化决定。 */
    let uploadedFile: LlmDeepSeek.DeepSeekFileIdType | undefined
    /** 中文说明：测试局部值 nativeFetch，由紧邻初始化决定。 */
    const nativeFetch = globalThis.fetch
    /** 中文说明：测试局部值 observedFetch，由紧邻初始化决定。 */
    const observedFetch: typeof fetch = async (input, init) => {
      /** 中文说明：测试局部值 response，由紧邻初始化决定。 */
      const response = await nativeFetch(input, init)
      /** 中文说明：测试局部值 url，由紧邻初始化决定。 */
      const url = new URL(input instanceof Request ? input.url : input)
      /** 中文说明：测试局部值 method，由紧邻初始化决定。 */
      const method = init?.method ?? (input instanceof Request ? input.method : 'GET')
      if (method === 'POST' && url.pathname.endsWith('/files') && response.ok) {
        /** 中文说明：测试局部值 value，由紧邻初始化决定。 */
        const value = await response.clone().json() as { id?: unknown }
        if (typeof value.id === 'string') uploadedFile = LlmDeepSeek.DeepSeekFileId(value.id)
      }
      return response
    }
    vi.stubGlobal('fetch', observedFetch)
    /** 中文说明：测试局部值 files，由紧邻初始化决定。 */
    const files = new LlmDeepSeek.DeepSeekFilesClient({ baseURL, apiKey: key })

    try {
      /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
      const result = await assemble(ctx, {
        model: VISION,
        messages: [createUserMessage({
          content: [
            { type: 'text', text: 'Briefly describe this image.' },
            { type: 'image', attachment: attachments.ref },
          ],
          source: { kind: 'plugin', plugin: 'test' },
        })],
        maxTokens: 100,
      })
      expect(
        result.finish.kind,
        `DeepSeek vision result: ${JSON.stringify(result.finish)}`,
      ).toBe('stop')
      expect(textOf(result).trim().length).toBeGreaterThan(0)
      expect(uploadedFile).toMatch(/^file-api-/u)
    } finally {
      if (uploadedFile !== undefined) await files.delete(uploadedFile)
    }
  })

  it('serves a real request with the key held only by a credentials-local document', async () => {
    /** 中文说明：测试局部值 key，由紧邻初始化决定。 */
    const key = process.env.DEEPSEEK_API_KEY
    if (key === undefined) throw new Error('e2e ran without DEEPSEEK_API_KEY')
    /** 中文说明：测试局部值 dir，由紧邻初始化决定。 */
    const dir = await mkdtemp(join(tmpdir(), 'dsh-e2e-credentials-'))
    try {
      // JSON.stringify quotes the value: YAML is a JSON superset, so a real
      // key survives whatever characters it happens to carry.
      await writeFile(join(dir, '.credentials.yaml'), `version: 1\nrefs:\n  DEEPSEEK_API_KEY: ${JSON.stringify(key)}\n`, { mode: 0o600 })
      // Scrub the ambient variable so only the credential seam can supply the
      // key: this request proves the per-request resolution path end to end.
      vi.stubEnv('DEEPSEEK_API_KEY', '')
      /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
      const ctx = new Context()
      contexts.push(ctx)
      await ctx.plugin(LlmRuntime)
      await ctx.plugin(LocalCredentialProvider, { path: join(dir, '.credentials.yaml'), watch: false })
      await ctx.plugin(LlmDeepSeek, {})

      /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
      const result = await assemble(ctx, {
        model: FLASH,
        messages: ask('Reply with exactly the word: pong'),
        maxTokens: 50,
      })
      expect(result.finish.kind).toBe('stop')
      expect(textOf(result).toLowerCase()).toContain('pong')
    } finally {
      vi.unstubAllEnvs()
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('flash dynamically switches from off to low', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await harness(FLASH, { reasoningEffort: 'off' })
    /** 中文说明：测试局部值 withoutThinking，由紧邻初始化决定。 */
    const withoutThinking = await assemble(ctx,{
      model: FLASH,
      messages: ask('Reply with exactly the word: pong'),
      maxTokens: 50,
    })
    expect(withoutThinking.finish.kind).toBe('stop')
    expect(textOf(withoutThinking).toLowerCase()).toContain('pong')
    expect(withoutThinking.message.content.some(block => block.type === 'reasoning')).toBe(false)
    expect(withoutThinking.usage?.inputTokens).toBeGreaterThan(0)
    expect(withoutThinking.usage?.outputTokens).toBeGreaterThan(0)

    /** 中文说明：测试局部值 withThinking，由紧邻初始化决定。 */
    const withThinking = await assemble(ctx,{
      model: FLASH,
      reasoningEffort: ReasoningEffortId('low'),
      messages: ask('Which is larger, 9.11 or 9.8? Answer with just the number.'),
      maxTokens: 2000,
    })
    expect(withThinking.finish.kind).toBe('stop')
    expect(withThinking.message.content.some(block => block.type === 'reasoning')).toBe(true)
    expect(textOf(withThinking)).toContain('9.8')
    expect(withThinking.usage?.reasoningTokens).toBeGreaterThan(0)
  })

  it.each(['high', 'max'] as const)(
    'pro + thinking enabled (effort %s): tool-call round trip with reasoning passback',
    async (effort) => {
      /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
      const ctx = await harness(PRO, { thinking: 'enabled' })

      // Turn 1: the model must call the tool (and think before it).
      /** 中文说明：测试局部值 first，由紧邻初始化决定。 */
      const first = await assemble(ctx,{
        model: PRO,
        reasoningEffort: ReasoningEffortId(effort),
        messages: ask('What is the weather in Paris right now? Use the get_weather tool.'),
        tools: [weatherTool],
        maxTokens: 2000,
      })
      expect(first.finish.kind).toBe('tool-calls')
      /** 中文说明：测试局部值 call，由紧邻初始化决定。 */
      const call = first.message.content.find(block => block.type === 'tool-call')
      expect(call).toBeDefined()
      expect(call!.name).toBe('get_weather')
      expect(JSON.parse(call!.arguments)).toMatchObject({ city: expect.stringMatching(/paris/i) as string })

      // Turn 2: send the tool result back WITH the assistant's reasoning
      // block in history (the official thinking+tools passback rule).
      /** 中文说明：测试局部值 second，由紧邻初始化决定。 */
      const second = await assemble(ctx,{
        model: PRO,
        reasoningEffort: ReasoningEffortId(effort),
        messages: [
          ...ask('What is the weather in Paris right now? Use the get_weather tool.'),
          createMessage({
            role: 'assistant', content: first.message.content,
            source: { kind: 'plugin', plugin: 'test' },
          }),
          createUserMessage({
            content: [{
              type: 'tool-result',
              toolCallId: CallId(call!.id),
              content: [{ type: 'text', text: 'Sunny, 22°C' }],
            }],
            source: { kind: 'plugin', plugin: 'test' },
          }),
        ],
        tools: [weatherTool],
        maxTokens: 2000,
      })
      expect(second.finish.kind).toBe('stop')
      expect(textOf(second).toLowerCase()).toMatch(/sunny|22/)
    },
  )

  it('pro + thinking disabled: plain generation without reasoning blocks', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await harness(PRO, { thinking: 'disabled' })
    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await assemble(ctx,{
      model: PRO,
      messages: ask('Reply with exactly the word: pong'),
      maxTokens: 50,
    })
    expect(result.finish.kind).toBe('stop')
    expect(result.message.content.some(block => block.type === 'reasoning')).toBe(false)
  })

  it('streams raw chunks in protocol order', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await harness(FLASH, { thinking: 'disabled' })
    /** 中文说明：测试局部值 kinds，由紧邻初始化决定。 */
    const kinds: string[] = []
    /** 中文说明：测试局部值 chunk，由紧邻初始化决定。 */
    for await (const chunk of ctx.llm.stream({
      provider: 'deepseek-official',
      model: FLASH,
      messages: ask('Count from 1 to 5, digits only.'),
      maxTokens: 50,
    })) {
      kinds.push(chunk.type)
    }
    expect(kinds[0]).toBe('block-start')
    expect(kinds.at(-1)).toBe('finish')
    expect(kinds.filter(kind => kind === 'finish')).toHaveLength(1)
    // usage precedes finish (deferred-emit contract)
    expect(kinds.indexOf('usage')).toBeLessThan(kinds.indexOf('finish'))
  })
})
