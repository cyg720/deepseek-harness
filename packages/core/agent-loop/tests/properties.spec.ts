/**
 * Property-based tests for the agent loop's inbox/turn scheduling (the
 * property-testing Agent Note). Deterministic by construction: schedules are driven
 * through the `agent/status` settle signal (no wall-clock sleeps), so a flake
 * is a finding, not timing noise.
 *
 * Invariants: every sent message appears exactly once in the log (none lost);
 * turn numbers strictly increase; status transitions follow
 * idle→running→idle, while teardown is a registry lifecycle.
 */
/*
 * 文件职责：验证Agent Loop的 properties.spec.ts 行为与不变量。
 * 技术维度：Vitest、Cordis、会话事件、模型适配器和可控工具夹具。
 * 产品维度：防止Agent Loop在取消、恢复、错误或并发场景中产生回归。
 * 逻辑维度：构造服务与事件，驱动执行流程，再断言日志、请求、状态和清理。
 * 关键边界：测试后台任务必须结束；模型可见输入必须可从日志重建；工具调用顺序不可破坏。
 * 新手阅读建议：先读 mock/辅助函数，再按成功、错误、恢复和生命周期场景阅读。
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import { createUserMessage, LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'

import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import fc from 'fast-check'

/** A never-exhausting adapter: every model call returns the same short reply. */
/* 中文说明：测试类型或类 EchoAdapter 约束夹具数据和行为。 */
class EchoAdapter extends LlmAdapter {
  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    if (options.signal?.aborted) throw new Error('aborted')
    /** 中文说明：测试局部值 text，由紧邻初始化决定，仅在当前场景使用。 */
    const text = 'ok'
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text }
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

/** 中文说明：测试辅助函数 harness 的参数见签名，返回值用于驱动或断言场景；示例见下方用例。 */
async function harness() {
  /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  ctx.llm.registerAdapter(['mock'], new EchoAdapter())
  return ctx
}

/** Resolve on the agent's next transition to idle (event-based, not polled). */
/* 中文说明：测试辅助函数 nextIdle 的参数见签名，返回值用于驱动或断言场景；示例见下方用例。 */
function nextIdle(ctx: Context, agent: Agent): Promise<void> {
  return new Promise((resolve) => {
    /** 中文说明：测试局部值 dispose，由紧邻初始化决定，仅在当前场景使用。 */
    const dispose = ctx.on('agent/status', ({ agent: subject, status }) => {
      if (subject === agent && status === 'idle') {
        dispose()
        resolve()
      }
    })
  })
}

/** Record every status transition for the legal-machine assertion. Returns
 * the seen list plus a disposer for the listener (per the registry convention). */
/* 中文说明：测试辅助函数 recordStatus 的参数见签名，返回值用于驱动或断言场景；示例见下方用例。 */
function recordStatus(ctx: Context, agent: Agent): { seen: string[]; dispose: () => void } {
  /** 中文说明：测试局部值 seen，由紧邻初始化决定，仅在当前场景使用。 */
  const seen: string[] = []
  /** 中文说明：测试局部值 dispose，由紧邻初始化决定，仅在当前场景使用。 */
  const dispose = ctx.on('agent/status', ({ agent: subject, status }) => {
    if (subject === agent) seen.push(status)
  })
  return { seen, dispose }
}

/** 中文说明：测试辅助函数 userMessageTexts 的参数见签名，返回值用于驱动或断言场景；示例见下方用例。 */
function userMessageTexts(agent: Agent): string[] {
  return agent.session.events
    .filter(e => e.type === 'user/message')
    .map(e => (e.data as { content: { type: string; text?: string }[] }).content.map(b => b.text ?? '').join(''))
}

/** 中文说明：测试辅助函数 turnNumbers 的参数见签名，返回值用于驱动或断言场景；示例见下方用例。 */
function turnNumbers(agent: Agent): number[] {
  return agent.session.events
    .filter(e => e.type === 'turn/start')
    .map(e => e.data.turn)
}

/** 中文说明：测试辅助函数 turnEndNumbers 的参数见签名，返回值用于驱动或断言场景；示例见下方用例。 */
function turnEndNumbers(agent: Agent): number[] {
  return agent.session.events
    .filter(e => e.type === 'turn/end')
    .map(e => (e.data as { turn: number }).turn)
}

/** 中文说明：测试辅助函数 userMessageCountsByTurn 的参数见签名，返回值用于驱动或断言场景；示例见下方用例。 */
function userMessageCountsByTurn(agent: Agent): number[] {
  /** 中文说明：测试局部值 counts，由紧邻初始化决定，仅在当前场景使用。 */
  const counts: number[] = []
  /** 中文说明：测试局部值 event，由紧邻初始化决定，仅在当前场景使用。 */
  for (const event of agent.session.events) {
    if (event.type === 'turn/start') counts.push(0)
    if (event.type === 'user/message') counts[counts.length - 1]! += 1
  }
  return counts
}

/** Assert a status trace is a legal run: idle/running alternating, ending idle. */
/* 中文说明：测试辅助函数 assertLegalStatusTrace 的参数见签名，返回值用于驱动或断言场景；示例见下方用例。 */
function assertLegalStatusTrace(trace: string[]): void {
  /** 中文说明：测试局部值 i，由紧邻初始化决定，仅在当前场景使用。 */
  for (let i = 1; i < trace.length; i++) {
    expect(trace[i]).not.toBe(trace[i - 1]) // no repeats (setStatus dedups)
  }
  /** 中文说明：测试局部值 s，由紧邻初始化决定，仅在当前场景使用。 */
  for (const s of trace) expect(['idle', 'running']).toContain(s)
}

describe('agent loop scheduling properties', () => {
  it('a synchronous burst gives every message its own strictly increasing turn', async () => {
    await fc.assert(fc.asyncProperty(
      fc.array(fc.string({ minLength: 1 }), { minLength: 1, maxLength: 6 }),
      async (texts) => {
        /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
        const ctx = await harness()
        try {
          /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
          const agent = ctx.agentLoop.create(SessionId('a'), { provider: 'mock', model: 'mock' })
          /** 中文说明：测试局部值 { seen，由紧邻初始化决定，仅在当前场景使用。 */
          const { seen: trace } = recordStatus(ctx, agent)
          /** 中文说明：测试局部值 idle，由紧邻初始化决定，仅在当前场景使用。 */
          const idle = nextIdle(ctx, agent)
          // Send all in one synchronous tick: they queue before the loop wakes.
          /** 中文说明：测试局部值 text，由紧邻初始化决定，仅在当前场景使用。 */
          for (const text of texts) agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
          await idle

          // No message lost: every send appears as a user/message, in order.
          expect(userMessageTexts(agent)).toEqual(texts)
          // This failure-free fixture maps every item to an independent turn.
          expect(turnNumbers(agent)).toEqual(texts.map((_, i) => i + 1))
          expect(turnEndNumbers(agent)).toEqual(texts.map((_, i) => i + 1))
          expect(userMessageCountsByTurn(agent)).toEqual(texts.map(() => 1))
          expect(trace).toEqual(['running', 'idle'])
          assertLegalStatusTrace(trace)
        } finally {
          await ctx.fiber.dispose()
        }
      },
    ), { numRuns: 25, timeout: 2000 })
  })

  it('sequential sends each get their own turn with increasing numbers', async () => {
    await fc.assert(fc.asyncProperty(
      fc.array(fc.string({ minLength: 1 }), { minLength: 1, maxLength: 5 }),
      async (texts) => {
        /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
        const ctx = await harness()
        try {
          /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
          const agent = ctx.agentLoop.create(SessionId('a'), { provider: 'mock', model: 'mock' })
          /** 中文说明：测试局部值 text，由紧邻初始化决定，仅在当前场景使用。 */
          for (const text of texts) {
            /** 中文说明：测试局部值 idle，由紧邻初始化决定，仅在当前场景使用。 */
            const idle = nextIdle(ctx, agent)
            agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
            await idle
          }
          // Each send was drained at a separate turn start: N turns, 1..N.
          expect(turnNumbers(agent)).toEqual(texts.map((_, i) => i + 1))
          expect(userMessageTexts(agent)).toEqual(texts)
        } finally {
          await ctx.fiber.dispose()
        }
      },
    ), { numRuns: 20, timeout: 2000 })
  })

  it('mixed settled and same-tick sends preserve one turn per message', async () => {
    // Each step optionally waits for idle before the next send; that scheduling
    // choice must not change the ordinary message-to-turn mapping.
    /** 中文说明：测试局部值 stepArb，由紧邻初始化决定，仅在当前场景使用。 */
    const stepArb = fc.record({ text: fc.string({ minLength: 1 }), settle: fc.boolean() })
    await fc.assert(fc.asyncProperty(
      fc.array(stepArb, { minLength: 1, maxLength: 6 }),
      async (steps) => {
        /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
        const ctx = await harness()
        try {
          /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
          const agent = ctx.agentLoop.create(SessionId('a'), { provider: 'mock', model: 'mock' })
          // Capture before each send; the last waiter covers the final turn, and
          // awaiting an already-settled earlier waiter is harmless.
          /** 中文说明：测试局部值 解构结果，由紧邻初始化决定，仅在当前场景使用。 */
          let lastIdle: Promise<void> | undefined
          /** 中文说明：测试局部值 step，由紧邻初始化决定，仅在当前场景使用。 */
          for (const step of steps) {
            /** 中文说明：测试局部值 idle，由紧邻初始化决定，仅在当前场景使用。 */
            const idle = nextIdle(ctx, agent)
            lastIdle = idle
            agent.followup(createUserMessage({ content: [{ type: 'text', text: step.text }], source: { kind: 'user' } }))
            if (step.settle) await idle
          }
          await lastIdle

          // No message is lost or reordered, regardless of driver timing.
          expect(userMessageTexts(agent)).toEqual(steps.map(s => s.text))
          // Every item forms one FIFO-ordered turn containing only that message.
          /** 中文说明：测试局部值 turns，由紧邻初始化决定，仅在当前场景使用。 */
          const turns = turnNumbers(agent)
          expect(turns).toEqual(steps.map((_, i) => i + 1))
          expect(turnEndNumbers(agent)).toEqual(turns)
          expect(userMessageCountsByTurn(agent)).toEqual(steps.map(() => 1))
        } finally {
          await ctx.fiber.dispose()
        }
      },
    ), { numRuns: 25, timeout: 3000 })
  })
})
