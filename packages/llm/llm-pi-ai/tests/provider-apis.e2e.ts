/**
 * 文件职责：验证 provider-apis.e2e.ts 覆盖的 LLM 配置、调用与事件处理行为。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件上下文和可控测试替身验证运行时协作。
 * 产品维度：保障模型接入在配置变化、认证、重试与异常场景下仍能给 Agent 稳定反馈。
 * 逻辑维度：准备上下文与测试数据，触发被测流程，再核对请求、事件、结果和清理行为。
 * 关键边界：测试替身必须保持确定性；敏感凭据不可写入日志；异步资源必须在用例结束时释放。
 * 新手阅读建议：先看测试数据和辅助函数，再按 describe/it 场景阅读，最后对照被测插件实现。
 */
import { readFile } from 'node:fs/promises'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { AttachmentId, AttachmentStore, ImageVariantId } from '@deepseek-ai/dsh-attachment'
import type {
  ImageAttachmentLimits,
  ImageAttachmentRef,
  ImageRequestPolicy,
  RequestImageAttachment,
  SaveImageAttachment,
  StoredImageAttachment,
} from '@deepseek-ai/dsh-attachment'
import LlmRuntime, { createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import type { Message, ToolSchema } from '@deepseek-ai/dsh-llm'
import * as LlmPiAi from '@deepseek-ai/dsh-llm-pi-ai'
import type { PiAiReplayResponse } from '../src/replay.ts'
import { assemble, type AssembledResult } from './assemble.ts'

/** 中文说明：interface ProviderCase 定义本测试所需的数据或行为，用于表达模型调用相关场景。 */
interface ProviderCase {
  provider: 'openai' | 'anthropic'
  api: 'openai-responses' | 'anthropic-messages'
  model: string
  apiKey?: string
  baseURL?: string
  headers?: Record<string, string>
}

/** 中文说明：变量 openAIBaseURL 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const openAIBaseURL = process.env.DSH_PI_AI_OPENAI_BASE_URL
/** 中文说明：变量 azureOpenAIKey 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const azureOpenAIKey = process.env.AZURE_OPENAI_API_KEY
// Strictly ANTHROPIC_*: the DeepSeek endpoint does not serve the anthropic-messages
// protocol, so falling back to DEEPSEEK_API_KEY turns the keyless skip into a 404.
/** 中文说明：变量 anthropicApiKey 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const anthropicApiKey = process.env.ANTHROPIC_API_KEY
/** 中文说明：变量 anthropicBaseURL 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const anthropicBaseURL = process.env.DSH_PI_AI_ANTHROPIC_BASE_URL

/** 中文说明：变量 providerCases 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const providerCases: ProviderCase[] = [
  {
    provider: 'openai',
    api: 'openai-responses',
    model: process.env.DSH_PI_AI_OPENAI_MODEL ?? 'gpt-5.5',
    ...azureOpenAIKey
      ? { apiKey: azureOpenAIKey, headers: { 'api-key': azureOpenAIKey, Authorization: '' } }
      : {},
    ...openAIBaseURL ? { baseURL: openAIBaseURL } : {},
  },
  {
    provider: 'anthropic',
    api: 'anthropic-messages',
    model: process.env.DSH_PI_AI_ANTHROPIC_MODEL ?? 'claude-opus-4-8',
    ...anthropicApiKey === undefined ? {} : { apiKey: anthropicApiKey },
    ...anthropicBaseURL === undefined ? {} : { baseURL: anthropicBaseURL },
  },
]

/** 中文说明：变量 contexts 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const contexts: Context[] = []

/** 中文说明：函数 harness 承担本测试场景中的准备或验证工作；参数按签名传入，返回值供后续断言使用；示例见本文件调用。 */
async function harness(image?: StoredImageAttachment): Promise<Context> {
  /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(LlmPiAi, {
    providers: Object.fromEntries(providerCases.map(profile => [profile.provider, {
      ...profile.apiKey === undefined ? {} : { apiKey: profile.apiKey },
      ...profile.baseURL === undefined ? {} : { baseURL: profile.baseURL },
      ...profile.headers === undefined ? {} : { headers: profile.headers },
    }])),
  })
  if (image !== undefined) {
    /** 中文说明：变量 fixture 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const fixture = image
    /** 中文说明：class E2eAttachmentStore 定义本测试所需的数据或行为，用于表达模型调用相关场景。 */
    class E2eAttachmentStore extends AttachmentStore {
      readonly imageLimits: ImageAttachmentLimits = {
        maxImageBytes: fixture.data.byteLength,
        maxImagesPerMessage: 1,
        maxMessageImageBytes: fixture.data.byteLength,
        maxImagePixels: fixture.ref.width * fixture.ref.height,
        maxImageDimension: Math.max(fixture.ref.width, fixture.ref.height),
        mediaTypes: [fixture.ref.mediaType],
      }

      validateImage(_input: SaveImageAttachment): Promise<void> {
        return Promise.reject(new Error('e2e attachment fixture is read-only'))
      }

      saveImage(_input: SaveImageAttachment): Promise<ImageAttachmentRef> {
        return Promise.reject(new Error('e2e attachment fixture is read-only'))
      }

      readImage(ref: ImageAttachmentRef): Promise<StoredImageAttachment> {
        if (ref.attachmentId !== fixture.ref.attachmentId) {
          return Promise.reject(new Error('unknown e2e attachment fixture'))
        }
        return Promise.resolve(fixture)
      }

      override readImageRequest(ref: ImageAttachmentRef, _policy: ImageRequestPolicy): Promise<RequestImageAttachment> {
        if (ref.attachmentId !== fixture.ref.attachmentId) {
          return Promise.reject(new Error('unknown e2e attachment fixture'))
        }
        return Promise.resolve({
          variantId: ImageVariantId(`sha256:${'f'.repeat(64)}`),
          attachment: fixture.ref,
          data: fixture.data,
          mediaType: fixture.ref.mediaType,
          bytes: fixture.data.byteLength,
          width: fixture.ref.width,
          height: fixture.ref.height,
          depth: 'uchar',
          space: 'srgb',
          hasAlpha: fixture.ref.mediaType === 'image/png',
        })
      }
    }
    await ctx.plugin(E2eAttachmentStore)
  }
  return ctx
}

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

/** 中文说明：函数 ask 承担本测试场景中的准备或验证工作；参数按签名传入，返回值供后续断言使用；示例见本文件调用。 */
function ask(text: string): Message[] {
  return [createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'plugin', plugin: 'test' },
  })]
}

/** 中文说明：函数 textOf 承担本测试场景中的准备或验证工作；参数按签名传入，返回值供后续断言使用；示例见本文件调用。 */
function textOf(result: AssembledResult): string {
  return result.message.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('')
}

/** 中文说明：函数 expectFinish 承担本测试场景中的准备或验证工作；参数按签名传入，返回值供后续断言使用；示例见本文件调用。 */
function expectFinish(result: AssembledResult, expected: 'stop' | 'tool-calls'): void {
  if (result.finish.kind === 'error') {
    throw new Error(`provider request failed (${result.finish.failure.code}): ${result.finish.failure.message}`)
  }
  expect(result.finish.kind).toBe(expected)
}

/** 中文说明：函数 expectNativeReplay 承担本测试场景中的准备或验证工作；参数按签名传入，返回值供后续断言使用；示例见本文件调用。 */
function expectNativeReplay(result: AssembledResult, profile: ProviderCase): PiAiReplayResponse {
  /** 中文说明：变量 replayState 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const replayState = result.message.source.kind === 'model'
    ? result.message.source.replayState
    : undefined
  expect(replayState).toMatchObject({
    response: {
      kind: 'pi-ai',
      version: 2,
      api: profile.api,
      provider: profile.provider,
      model: profile.model,
    },
  })
  return (replayState as { response: PiAiReplayResponse }).response
}

/** 中文说明：变量 lookupTool 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const lookupTool: ToolSchema = {
  name: 'lookup_code',
  description: 'Look up the word represented by a short code.',
  parameters: {
    type: 'object',
    properties: { code: { type: 'string', description: 'The code to look up.' } },
    required: ['code'],
  },
}

/** 中文说明：该循环依次处理场景数据；循环变量仅在当前循环中有效。 */
for (const profile of providerCases) {
  describe.skipIf(profile.apiKey === undefined)(
    `llm-pi-ai ${profile.provider} e2e (${profile.api})`,
    () => {
      it('streams text with usage and native replay metadata', async () => {
        /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const ctx = await harness()
        /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const result = await assemble(ctx, {
          provider: profile.provider,
          model: profile.model,
          messages: ask('Reply with exactly the word: pong'),
          maxTokens: 1024,
        })

        expectFinish(result, 'stop')
        expect(textOf(result).toLowerCase()).toContain('pong')
        expect(result.usage?.inputTokens).toBeGreaterThan(0)
        expect(result.usage?.outputTokens).toBeGreaterThan(0)
        expect(expectNativeReplay(result, profile).stopReason).toBe('stop')
      })

      it('round-trips a tool call with provider-native replay metadata', async () => {
        /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const ctx = await harness()
        /** 中文说明：变量 prompt 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const prompt = ask('Use lookup_code with code "blue". Do not answer without calling the tool.')
        /** 中文说明：变量 first 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const first = await assemble(ctx, {
          provider: profile.provider,
          model: profile.model,
          messages: prompt,
          tools: [lookupTool],
          maxTokens: 2048,
        })

        expectFinish(first, 'tool-calls')
        /** 中文说明：函数值 call 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
        const call = first.message.content.find(block => block.type === 'tool-call')
        expect(call).toBeDefined()
        expect(call!.name).toBe('lookup_code')
        expect(JSON.parse(call!.arguments)).toMatchObject({ code: 'blue' })
        expect(expectNativeReplay(first, profile).stopReason).toBe('toolUse')

        /** 中文说明：变量 second 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const second = await assemble(ctx, {
          provider: profile.provider,
          model: profile.model,
          messages: [
            ...prompt,
            first.message,
            createUserMessage({
              content: [{
                type: 'tool-result',
                toolCallId: ToolCallId(call!.id),
                content: [{ type: 'text', text: 'The code blue means ocean.' }],
              }],
              source: { kind: 'plugin', plugin: 'test' },
            }),
          ],
          tools: [lookupTool],
          maxTokens: 2048,
        })

        expectFinish(second, 'stop')
        expect(textOf(second).toLowerCase()).toContain('ocean')
        expect(expectNativeReplay(second, profile).stopReason).toBe('stop')
      })

      if (profile.provider === 'anthropic') {
        it('sends a real image through the authenticated Anthropic visual path', async () => {
          /** 中文说明：变量 data 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
          const data = new Uint8Array(await readFile(
            new URL('./fixtures/qr-code.png', import.meta.url),
          ))
          /** 中文说明：变量 ref 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
          const ref: ImageAttachmentRef = {
            attachmentId: AttachmentId(`sha256:${'a'.repeat(64)}`),
            mediaType: 'image/png',
            bytes: data.byteLength,
            width: 256,
            height: 256,
            name: 'qr-code.png',
          }
          /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
          const ctx = await harness({ ref, data })
          /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
          const result = await assemble(ctx, {
            provider: profile.provider,
            model: profile.model,
            messages: [createUserMessage({
              content: [
                {
                  type: 'text',
                  text: 'What type of machine-readable symbol is shown in the attached image? Reply with exactly: QR code',
                },
                { type: 'image', attachment: ref },
              ],
              source: { kind: 'plugin', plugin: 'test' },
            })],
            maxTokens: 256,
          })

          expectFinish(result, 'stop')
          expect(textOf(result).toLowerCase()).toContain('qr code')
        })
      }
    },
  )
}
