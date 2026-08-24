/**
 * 文件职责：验证Agent Loop的 request-cache.e2e.ts 行为与不变量。
 * 技术维度：Vitest、Cordis、会话事件、模型适配器和可控工具夹具。
 * 产品维度：防止Agent Loop在取消、恢复、错误或并发场景中产生回归。
 * 逻辑维度：构造服务与事件，驱动执行流程，再断言日志、请求、状态和清理。
 * 关键边界：测试后台任务必须结束；模型可见输入必须可从日志重建；工具调用顺序不可破坏。
 * 新手阅读建议：先读 mock/辅助函数，再按成功、错误、恢复和生命周期场景阅读。
 */
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'

import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import * as LlmDeepSeek from '@deepseek-ai/dsh-llm-deepseek'

/**
 * With-key proof that log-derived requests translate into real provider cache hits: a
 * multi-step tool turn (plus a follow-up turn) against the live DeepSeek API must report
 * `cacheReadTokens > 0` on every request after the first — the adapter maps the provider's
 * `prompt_cache_hit_tokens`, and the per-step usage recorded on `assistant/message` events is
 * the production observable for cache behavior (the reconstructability Agent Note's measurement
 * layer: prefix stability is corollary #1). Mocks establish append-extension;
 * this key-gated test establishes a real provider cache hit.
 */

// Long enough that the shared request prefix comfortably spans the provider's
// cache-block granularity (64 tokens) from the very first request.
/** 中文说明：测试局部值 SYSTEM，由紧邻初始化决定，仅在当前场景使用。 */
const SYSTEM = 'You are a terse coding assistant used in an automated cache test. '
  + 'Always follow instructions literally and exactly. When the user asks you to look '
  + 'something up, call the lookup tool with the requested key and wait for its result '
  + 'before answering. Never invent a value the tool has not returned. After the tool '
  + 'returns, answer with a single short sentence that repeats the returned value '
  + 'verbatim. Do not add explanations, do not use markdown, do not ask follow-up '
  + 'questions. If the user asks anything else, answer in one short sentence.'

/** 中文说明：测试局部值 ctx: Context | undefined，由紧邻初始化决定，仅在当前场景使用。 */
let ctx: Context | undefined

afterEach(async () => {
  await ctx?.fiber.dispose()
  ctx = undefined
})

/** 中文说明：测试辅助函数 loopHarness 的参数见签名，返回值用于驱动或断言场景；示例见下方用例。 */
async function loopHarness(): Promise<Context> {
  /** 中文说明：测试局部值 created，由紧邻初始化决定，仅在当前场景使用。 */
  const created = new Context()
  await created.plugin(LlmRuntime)
  await created.plugin(SessionStore)
  await created.plugin(SystemPrompt, { persona: SYSTEM })
  await created.plugin(ToolRuntime)
  await created.plugin(AgentRegistry)
  await created.plugin(AgentLoop, { agents: [] })
  await created.plugin(LlmDeepSeek)
  created.tools.register(defineContentToolFixture({
    name: 'lookup',
    description: 'Look up the stored value for a key.',
    parameters: { key: { type: 'string', description: 'The key to look up.' } },
    async execute(args) {
      return [{ type: 'text', text: `value(${String(args.key)}) = azure-falcon-42` }]
    },
  }))
  return created
}

/** 中文说明：测试辅助函数 waitForIdle 的参数见签名，返回值用于驱动或断言场景；示例见下方用例。 */
function waitForIdle(context: Context, agent: Agent): Promise<void> {
  return new Promise((resolve) => {
    /** 中文说明：测试局部值 dispose，由紧邻初始化决定，仅在当前场景使用。 */
    const dispose = context.on('agent/status', ({ agent: subject, status }) => {
      if (subject === agent && status === 'idle') {
        dispose()
        resolve()
      }
    })
  })
}

describe.skipIf(!process.env.DEEPSEEK_API_KEY)('log-derived request cache hits (real API)', () => {
  it('every request after the first hits the provider prefix cache', async () => {
    ctx = await loopHarness()
    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = ctx.agentLoop.create(SessionId('cache-e2e'), { provider: 'deepseek-official', model: 'deepseek-v4-flash' })

    // Turn 1: forces a tool call → at least two steps (two model requests).
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Look up the key "deploy-color" with the lookup tool and tell me the value.' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)
    // Turn 2: a follow-up over the same (longer) prefix.
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Thanks. Repeat that value one more time.' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    /** 中文说明：测试局部值 usages，由紧邻初始化决定，仅在当前场景使用。 */
    const usages = [...agent.session.events]
      .filter(e => e.type === 'assistant/message')
      .map(e => e.data.usage)
    expect(usages.length).toBeGreaterThanOrEqual(3) // 2 steps in turn 1 + ≥1 in turn 2
    /** 中文说明：测试局部值 usage，由紧邻初始化决定，仅在当前场景使用。 */
    for (const usage of usages) expect(usage).toBeDefined()

    // The first request has nothing to hit; every later one shares its
    // predecessor as a byte-identical prefix, so the provider must report
    // cached prompt tokens (prompt_cache_hit_tokens → cacheReadTokens).
    /** 中文说明：测试局部值 usage，由紧邻初始化决定，仅在当前场景使用。 */
    for (const usage of usages.slice(1)) {
      expect(usage!.cacheReadTokens ?? 0).toBeGreaterThan(0)
    }

    // World-verification of the conversation itself: the tool value made it
    // through the loop into the final answer.
    /** 中文说明：测试局部值 finalText，由紧邻初始化决定，仅在当前场景使用。 */
    const finalText = agent.session.deriveMessages().at(-1)!.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('')
    expect(finalText).toContain('azure-falcon-42')
  }, 180_000)
})
