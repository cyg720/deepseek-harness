/**
 * 文件职责：验证Pi AI LLM的 adapter.e2e.ts 行为与网络边界。
 * 技术维度：TypeScript、Fetch、SSE、OAuth/密钥认证、模型目录和运行时模式校验。
 * 产品维度：让 Agent 能稳定调用供应商模型、发现能力并接收流式结果。
 * 逻辑维度：构造请求或模拟服务器，驱动适配器并断言事件与错误。
 * 关键边界：网络响应属于不可信输入；密钥和令牌不得记录；取消必须终止请求与流。
 * 新手阅读建议：先读 config/auth/catalog，再看 adapter/stream，最后阅读错误和重放测试。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { createUserMessage, CallId, ReasoningEffortId  } from '@deepseek-ai/dsh-llm'
import type { Message, ToolSchema } from '@deepseek-ai/dsh-llm'
import * as LlmPiAi from '@deepseek-ai/dsh-llm-pi-ai'
import type { PiAiProviderProfile } from '@deepseek-ai/dsh-llm-pi-ai'
import * as LlmDeepSeek from '@deepseek-ai/dsh-llm-deepseek'
import { assemble, type AssembledResult } from './assemble.ts'

/**
 * Real-API e2e for the pi-ai-backed adapter: V4 Flash + V4 Pro with provider
 * defaults and representative off/high/max reasoning. Mirrors the native
 * adapter's StreamChunk contract and exercises a replayed tool follow-up.
 * Key-gated.
 */

/** 中文说明：测试局部值 FLASH，由紧邻初始化决定。 */
const FLASH = 'deepseek-v4-flash'
/** 中文说明：测试局部值 PRO，由紧邻初始化决定。 */
const PRO = 'deepseek-v4-pro'
/** 中文说明：测试局部值 contexts，由紧邻初始化决定。 */
const contexts: Context[] = []

/** 中文说明：函数 harness 的参数见签名，返回结果供模型流程使用；示例见本文件。 */
async function harness(_model: string, config: Partial<PiAiProviderProfile> = {}) {
  /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(LlmPiAi, {
    providers: {
      deepseek: {
        ...process.env.DEEPSEEK_API_KEY === undefined ? {} : { apiKey: process.env.DEEPSEEK_API_KEY },
        ...process.env.DEEPSEEK_BASE_URL === undefined ? {} : { baseURL: process.env.DEEPSEEK_BASE_URL },
        ...config,
      },
    },
  })
  return ctx
}

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
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

/** 中文说明：函数 blockKinds 的参数见签名，返回结果供模型流程使用；示例见本文件。 */
function blockKinds(result: AssembledResult): string[] {
  return result.message.content.map(block => block.type)
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

describe.skipIf(!process.env.DEEPSEEK_API_KEY)('llm-pi-ai e2e (real API)', () => {
  it.each([FLASH, PRO])('%s + provider-default reasoning: plain text generation', async (model) => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await harness(model)
    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await assemble(ctx,{
      model,
      messages: ask('Reply with exactly the word: pong'),
      maxTokens: 50,
    })
    expect(result.finish.kind).toBe('stop')
    expect(textOf(result).toLowerCase()).toContain('pong')
  })

  it('flash + reasoning off: plain text without reasoning blocks', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await harness(FLASH)
    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await assemble(ctx,{
      model: FLASH,
      reasoningEffort: ReasoningEffortId('off'),
      messages: ask('Reply with exactly the word: pong'),
      maxTokens: 50,
    })
    expect(result.finish.kind).toBe('stop')
    expect(result.message.content.some(block => block.type === 'reasoning')).toBe(false)
    expect(textOf(result).toLowerCase()).toContain('pong')
  })

  it.each([FLASH, PRO])('%s + reasoning high: reasoning blocks present', async (model) => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await harness(model)
    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await assemble(ctx,{
      model,
      reasoningEffort: ReasoningEffortId('high'),
      messages: ask('Which is larger, 9.11 or 9.8? Answer with just the number.'),
      maxTokens: 2000,
    })
    expect(result.finish.kind).toBe('stop')
    expect(result.message.content.some(block => block.type === 'reasoning')).toBe(true)
    expect(textOf(result)).toContain('9.8')
  })

  it('pro + reasoning max: tool-call round trip', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await harness(PRO)

    /** 中文说明：测试局部值 first，由紧邻初始化决定。 */
    const first = await assemble(ctx,{
      model: PRO,
      reasoningEffort: ReasoningEffortId('max'),
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

    /** 中文说明：测试局部值 second，由紧邻初始化决定。 */
    const second = await assemble(ctx,{
      model: PRO,
      reasoningEffort: ReasoningEffortId('max'),
      messages: [
        ...ask('What is the weather in Paris right now? Use the get_weather tool.'),
        first.message,
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
  })

  it('produces the same block structure as llm-deepseek for the same prompt', async () => {
    // Loose structural equivalence between the two independent adapters:
    // same block KINDS in the same order for a deterministic prompt — the
    // cross-implementation check that the StreamChunk design holds.
    /** 中文说明：测试局部值 deepseekCtx，由紧邻初始化决定。 */
    const deepseekCtx = new Context()
    contexts.push(deepseekCtx)
    await deepseekCtx.plugin(LlmRuntime)
    await deepseekCtx.plugin(LlmDeepSeek, { thinking: 'disabled' })

    /** 中文说明：测试局部值 piCtx，由紧邻初始化决定。 */
    const piCtx = await harness(FLASH)

    /** 中文说明：测试局部值 prompt，由紧邻初始化决定。 */
    const prompt = ask('Reply with exactly the word: pong')
    /** 中文说明：测试局部值 [fromDeepSeek, fromPiAi]，由紧邻初始化决定。 */
    const [fromDeepSeek, fromPiAi] = await Promise.all([
      assemble(deepseekCtx, { provider: 'deepseek-official', model: FLASH, messages: prompt, maxTokens: 50 }),
      assemble(piCtx, { model: FLASH, messages: prompt, maxTokens: 50 }),
    ])
    expect(blockKinds(fromPiAi)).toEqual(blockKinds(fromDeepSeek))
    expect(fromPiAi.finish.kind).toBe(fromDeepSeek.finish.kind)
  })
})
