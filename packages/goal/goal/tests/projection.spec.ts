/**
 * The `goal` projection unit: mounting GoalService beside the registry
 * serves the current whole goal on the history tail page with a consistent
 * asOfSeq; before the first create the value is null; a clear tombstone
 * returns it to null; a composition without the goal service has no `goal`
 * key; unmounting drops it (HMR safety). Malformed goal-shaped events are
 * ignored fail-soft (same-reference return) — strict replay validation
 * belongs to the write side and foldGoal, never the projection drive.
 */
/**
 * 文件职责：验证目标工具与投影的 projection.spec.ts 行为与边界。
 * 技术维度：TypeScript、Cordis、JSON 编解码、子进程、事件匹配和严格联合类型。
 * 产品维度：保证目标工具与投影可预测地传递事件、限制循环或适配外部工具。
 * 逻辑维度：构造事件与配置，驱动入口并断言结果。
 * 关键边界：线协议输入必须校验；外部 Hook 失败不得破坏会话日志或核心循环。
 * 新手阅读建议：先读 types/events，再看 codec/matcher/runner，最后阅读桥接配置。
 */

import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { Inbox } from '@deepseek-ai/dsh-agent'
import type { Agent, AgentStatus } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { UserMessage } from '@deepseek-ai/dsh-session'
import SessionStore from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import GoalService, { applyGoalProjection, foldGoal } from '@deepseek-ai/dsh-goal'
import type { GoalRef } from '@deepseek-ai/dsh-goal'

/** 中文说明：类型或类 Bench 约束 Hook、守卫或目标数据职责。 */
interface Bench {
  ctx: Context
  session: Session
  agent: Agent
  tailValues(): Record<string, unknown>
  tailAsOfSeq(): number
}

/** Register a minimal registry-compatible live agent over a store session. */
/** 中文说明：函数 liveAgent 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function liveAgent(ctx: Context, session: Session): Agent {
  /** 中文说明：测试局部值 status，由紧邻初始化决定。 */
  const status: AgentStatus = 'idle'
  /** 中文说明：测试局部值 inbox，由紧邻初始化决定。 */
  const inbox = new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} })
  /** 中文说明：测试局部值 agent，由紧邻初始化决定。 */
  const agent: Agent = {
    id: session.id,
    options: {},
    session,
    inbox,
    ctx,
    get status() { return status },
    send: () => {},
    followup: () => {},
    steer: () => ({ outcome: Promise.resolve({ status: 'rejected' as const }) }),
    inject(input: UserMessage) {
      inbox.append('next-step', input)
    },
    cancel() {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle() { return Promise.resolve() },
  }
  ctx.agents.register(agent)
  return agent
}

/** 中文说明：函数 harness 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
async function harness(withGoal: boolean): Promise<Bench> {
  /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SessionProjectionRegistry)
  if (withGoal) await ctx.plugin(GoalService)
  /** 中文说明：测试局部值 session，由紧邻初始化决定。 */
  const session = ctx.sessions.create()
  /** 中文说明：测试局部值 agent，由紧邻初始化决定。 */
  const agent = liveAgent(ctx, session)
  return {
    ctx,
    session,
    agent,
    tailValues: () => ctx.sessionProjections.snapshot(session).values,
    tailAsOfSeq: () => ctx.sessionProjections.snapshot(session).asOfSeq,
  }
}

/** One paginable message so the tail is non-degenerate. */
/** 中文说明：函数 seedMessage 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function seedMessage(session: Session): void {
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: 'hi' }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
}

describe('goal projection unit', () => {
  it('serves null before the first create', async () => {
    /** 中文说明：测试局部值 bench，由紧邻初始化决定。 */
    const bench = await harness(true)
    seedMessage(bench.session)
    expect(bench.tailValues()).toEqual({ goal: null })
    expect(bench.tailAsOfSeq()).toBe(bench.session.seq - 1)
  })

  it('serves the whole current goal after create and tracks mutations last-wins', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_700_000_000_000)
    try {
      /** 中文说明：测试局部值 bench，由紧邻初始化决定。 */
      const bench = await harness(true)
      seedMessage(bench.session)
      /** 中文说明：测试局部值 created，由紧邻初始化决定。 */
      const created = bench.ctx.goals.create(bench.agent, { objective: 'ship the goal bar' })
      /** 中文说明：测试局部值 afterCreate，由紧邻初始化决定。 */
      const afterCreate = bench.tailValues().goal
      expect(afterCreate).toMatchObject({
        goal: { id: created.id, revision: 1, objective: 'ship the goal bar', phase: 'active' },
        roundsStarted: 0,
      })

      /** 中文说明：测试局部值 ref，由紧邻初始化决定。 */
      const ref: GoalRef = { id: created.id, revision: created.revision }
      /** 中文说明：测试局部值 paused，由紧邻初始化决定。 */
      const paused = bench.ctx.goals.pause(bench.agent, ref)
      expect(bench.tailValues().goal).toMatchObject({
        goal: { revision: paused.revision, phase: 'paused' },
      })
      expect(bench.tailAsOfSeq()).toBe(bench.session.seq - 1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('returns to null after a clear tombstone', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_700_000_000_000)
    try {
      /** 中文说明：测试局部值 bench，由紧邻初始化决定。 */
      const bench = await harness(true)
      seedMessage(bench.session)
      /** 中文说明：测试局部值 created，由紧邻初始化决定。 */
      const created = bench.ctx.goals.create(bench.agent, { objective: 'temporary' })
      expect(bench.tailValues().goal).not.toBeNull()
      bench.ctx.goals.clear(bench.agent, { id: created.id, revision: created.revision })
      expect(bench.tailValues().goal).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not let inbox changes revive a cleared goal', async () => {
    /** 中文说明：测试局部值 bench，由紧邻初始化决定。 */
    const bench = await harness(true)
    /** 中文说明：测试局部值 created，由紧邻初始化决定。 */
    const created = bench.ctx.goals.create(bench.agent, { objective: 'stay cleared' })
    bench.ctx.goals.clear(bench.agent, created)

    bench.agent.inbox.prepend('next-step', createUserMessage({
      content: [{ type: 'text', text: 'unrelated pending context' }],
      source: { kind: 'plugin', plugin: 'test' },
    }))

    expect(bench.tailValues().goal).toBeNull()
    expect(foldGoal(bench.session.events).goal).toBeUndefined()
  })

  it('ignores non-goal and malformed goal-shaped events fail-soft (same reference)', () => {
    // The package invariant rejects a violating stream loudly wherever it is
    // installed — the unit itself must never throw on the projection drive
    // (a throwing apply would tear down every registered unit's drive), so
    // its transition is exercised directly as the pure function it is.
    /** 中文说明：测试局部值 plainUser，由紧邻初始化决定。 */
    const plainUser = createUserMessage({
      content: [{ type: 'text', text: 'hi' }],
      source: { kind: 'user' },
    })
    /** 中文说明：测试局部值 user，由紧邻初始化决定。 */
    const user = { type: 'user/message', seq: 0, time: 1, data: plainUser } as never
    /** 中文说明：测试局部值 state，由紧邻初始化决定。 */
    const state = { goal: { id: 'g1', revision: 1, objective: 'x', phase: 'active', maxGoalRounds: 4 }, roundsStarted: 0, createdAt: 1, updatedAt: 1 } as never
    /** 中文说明：测试局部值 empty，由紧邻初始化决定。 */
    const empty = null
    expect(applyGoalProjection(empty, user)).toBe(empty)
    /** 中文说明：测试局部值 queuedUser，由紧邻初始化决定。 */
    const queuedUser = {
      type: 'agent/inbox/spliced', seq: 1, time: 2,
      data: { target: 'next-step', start: 0, inserted: [plainUser] },
    } as never
    /** 中文说明：测试局部值 current，由紧邻初始化决定。 */
    const current = state
    expect(applyGoalProjection(current, queuedUser)).toBe(current)

    /** 中文说明：测试局部值 malformed，由紧邻初始化决定。 */
    const malformed = {
      type: 'goal/change', seq: 1, time: 2,
      data: { kind: 'goal/change', version: 1, operation: 'create' },
    } as never
    // Same-reference return: the registry's Object.is gate sees no change.
    expect(applyGoalProjection(current, malformed)).toBe(current)
    expect(applyGoalProjection(empty, malformed)).toBe(empty)

    /** 中文说明：测试局部值 queuedRound，由紧邻初始化决定。 */
    const queuedRound = {
      type: 'agent/inbox/spliced', seq: 3, time: 4,
      data: { target: 'next-step', start: 0, inserted: [createUserMessage({
        content: [{ type: 'text', text: 'later round' }],
        source: { kind: 'goal', goalId: 'g1', revision: 1, round: 1 } as never,
      })] },
    } as never
    expect(applyGoalProjection(current, queuedRound)).toBe(current)

    // A non-message event (the registry drives EVERY committed event through
    // apply): early same-reference return.
    /** 中文说明：测试局部值 turnStart，由紧邻初始化决定。 */
    const turnStart = { type: 'turn/start', seq: 3, time: 4, data: { turn: 1 } } as never
    expect(applyGoalProjection(current, turnStart)).toBe(current)

    // A goal/change event whose payload carries a foreign kind is ignored.
    /** 中文说明：测试局部值 foreignKind，由紧邻初始化决定。 */
    const foreignKind = { type: 'goal/change', seq: 4, time: 5, data: { kind: 'not-a-goal-change' } } as never
    expect(applyGoalProjection(current, foreignKind)).toBe(current)
  })

  it('has no goal key when the goal service is not composed', async () => {
    /** 中文说明：测试局部值 bench，由紧邻初始化决定。 */
    const bench = await harness(false)
    seedMessage(bench.session)
    expect('goal' in (bench.tailValues() ?? {})).toBe(false)
  })

  it('drops the key when the goal fiber unloads (HMR safety)', async () => {
    /** 中文说明：测试局部值 bench，由紧邻初始化决定。 */
    const bench = await harness(false)
    seedMessage(bench.session)
    /** 中文说明：测试局部值 fiber，由紧邻初始化决定。 */
    const fiber = await bench.ctx.plugin(GoalService)
    expect(bench.tailValues()).toEqual({ goal: null })
    await fiber.dispose()
    expect('goal' in (bench.tailValues() ?? {})).toBe(false)
  })
})
