import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import * as LlmDeepSeek from '@deepseek-ai/dsh-llm-deepseek'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionTitleService from '@deepseek-ai/dsh-session-title'
import * as FirstMessageTitleProvider from '@deepseek-ai/dsh-session-title-first-prompt-llm'

/** 当前测试创建且等待异步释放的 Cordis 上下文。 */
const contexts: Context[] = []

/** 中文：每个用例后并行释放并清空全部上下文。 */
afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

/** 中文：有 API 密钥时启用的真实首提示标题提供者测试组。 */
describe.skipIf(!process.env.DEEPSEEK_API_KEY)('first-prompt title provider with real DeepSeek API', () => {
  /** 中文：调用模型生成短标题并验证来源与字节上限；无参数和返回值。 */
  it('replaces the fallback with a short model title', async () => {
    /** 当前真实 API 用例的 Cordis 上下文。 */
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(LlmDeepSeek, { thinking: 'disabled' })
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionTitleService, {
      fallbackMaxWords: 5,
      fallbackMaxBytes: 40,
      maxTitleBytes: 80,
    })
    await ctx.plugin(FirstMessageTitleProvider, {
      targetWords: 5,
      targetCjkCharacters: 10,
      maxInputBytes: 4_096,
      maxOutputTokens: 64,
      timeoutMs: 60_000,
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash',
    })
    /** 写入首轮消息并接受标题刷新的会话。 */
    const session = ctx.sessions.create(SessionId('real-title-provider'))
    session.append('turn/start', {
      turn: 1,
    })
    /** 用于生成标题且应被 messageSeqs 引用的首条用户消息事件。 */
    const message = session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'Explain why append-only logs make session titles durable.' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })

    /** 模型标题刷新结果；应替换初始回退标题。 */
    const title = await ctx.sessionTitle.refresh(session)

    expect(title).toMatchObject({
      messageSeqs: [message.seq],
      source: {
        kind: 'provider',
        provider: 'session-title-first-prompt-llm',
        model: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
      },
    })
    expect(title?.title.length).toBeGreaterThan(0)
    expect(Buffer.byteLength(title?.title ?? '', 'utf8')).toBeLessThanOrEqual(80)
  })
})
/**
 * 中文说明：
 * - 文件职责：使用真实 DeepSeek API 验证首条提示标题提供者能替换回退标题并记录来源。
 * - 技术维度：使用 Vitest 密钥门控、Cordis、真实 LLM 适配器、会话日志和 UTF-8 字节检查。
 * - 产品维度：确保用户新会话可获得简短、有意义且可追溯到模型与源消息的自动标题。
 * - 逻辑维度：装载完整标题链，追加首轮用户消息，调用 refresh，再验证引用、提供者和长度。
 * - 关键边界：仅在 DEEPSEEK_API_KEY 存在时运行；模型网络调用最长 60 秒，标题不得超过 80 字节。
 * - 新手阅读建议：先看 skipIf 运行条件，再按插件装载顺序理解标题服务如何调用模型提供者。
 */
