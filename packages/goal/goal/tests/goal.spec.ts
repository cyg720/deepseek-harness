/**
 * 文件职责：验证目标管理的 goal.spec.ts 行为与安全边界。
 * 技术维度：TypeScript、Cordis、会话事件、路径策略、判别联合和 Vitest。
 * 产品维度：保证目标管理操作可预测、可审计并在失败时保持一致。
 * 逻辑维度：构造请求与状态，驱动服务并断言输出和清理。
 * 关键边界：文件路径必须经过策略检查；目标引用含版本，过期修改必须拒绝。
 * 新手阅读建议：先读类型与测试夹具，再按校验、执行、事件折叠和错误流程阅读。
 */
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { agentEvents, Inbox } from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage, HarnessError } from '@deepseek-ai/dsh-llm'
import SessionStore, { Session, SessionId, type UserMessage } from '@deepseek-ai/dsh-session'
import GoalService, {
  GoalError,
  GoalId,
  decodeGoalChange,
  foldGoal,
} from '@deepseek-ai/dsh-goal'
import type { GoalChangeMeta, GoalRef, GoalSnapshotChangeMeta } from '@deepseek-ai/dsh-goal'

/** 中文说明：类型或类 StubAgent 约束文件或目标数据职责。 */
interface StubAgent {
  agent: Agent
  session: Session
}

/** Number the next balanced test-fixture turn. */
/** 中文说明：函数 nextTurn 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function nextTurn(session: Session): number {
  return session.events.reduce((max, event) => event.type === 'turn/start' ? Math.max(max, event.data.turn) : max, 0) + 1
}

/** Mirror the public Agent.inject contract for domain tests. */
/** 中文说明：函数 appendInjection 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function appendInjection(session: Session, input: UserMessage): void {
  new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} }).append('next-step', input)
}

/** Build a registry-compatible agent around one concrete session. */
/** 中文说明：函数 stubAgentForSession 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function stubAgentForSession(session: Session): StubAgent {
  /** 中文说明：测试局部值 id，由紧邻初始化决定。 */
  const id = session.id
  /** 中文说明：测试局部值 inbox，由紧邻初始化决定。 */
  const inbox = new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} })
  /** 中文说明：测试局部值 agent，由紧邻初始化决定。 */
  const agent: Agent = {
    id,
    options: {},
    session,
    inbox,
    ctx: new Context(),
    status: 'idle',
    send: () => {},
    followup: () => {},
    steer: () => {},
    inject(input) { inbox.append('next-step', input) },
    cancel() {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle() { return Promise.resolve() },
  }
  return {
    agent,
    session,
  }
}

/** Build a registry-compatible agent around a fresh session. */
/** 中文说明：函数 stubAgent 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function stubAgent(rawId: string, seed?: readonly import('@deepseek-ai/dsh-session').SessionEvent[]): StubAgent {
  return stubAgentForSession(Session.create(SessionId(rawId), seed))
}

/** 中文说明：函数 harness 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
async function harness(config: { defaultMaxGoalRounds?: number } = {}) {
  /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
  const ctx = new Context()
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(GoalService, config)
  /** 中文说明：测试局部值 stub，由紧邻初始化决定。 */
  const stub = stubAgent(`goal-test-${Math.random()}`)
  ctx.agents.register(stub.agent)
  return { ctx, ...stub }
}

/** Append one admitted goal round as a balanced user-message turn. */
/** 中文说明：函数 appendRound 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function appendRound(session: Session, ref: GoalRef, round: number): void {
  /** 中文说明：测试局部值 source，由紧邻初始化决定。 */
  const source = { kind: 'goal', goalId: ref.id, revision: ref.revision, round } as const
  /** 中文说明：测试局部值 turn，由紧邻初始化决定。 */
  const turn = nextTurn(session)
  session.append('turn/start', { turn })
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: `round ${round}` }], source,
  }), { surfaceOp: 'append' })
  session.append('turn/end', { turn, reason: { kind: 'completed' } })
}

describe('GoalService creation and replay', () => {
  it('applies the configured default and writes one durable goal change', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_700_000_000_000)
    /** 中文说明：测试局部值 { ctx, agent, session }，由紧邻初始化决定。 */
    const { ctx, agent, session } = await harness({ defaultMaxGoalRounds: 17 })
    /** 中文说明：测试局部值 seen，由紧邻初始化决定。 */
    const seen: string[] = []
    ctx.on('goal/changed', ({ change }) => { seen.push(change.operation) })

    /** 中文说明：测试局部值 goal，由紧邻初始化决定。 */
    const goal = ctx.goals.create(agent, { objective: '  finish the feature  ' })

    expect(goal).toMatchObject({
      objective: 'finish the feature',
      phase: 'active',
      revision: 1,
      maxGoalRounds: 17,
      roundsStarted: 0,
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_000,
      activation: 'armed',
    })
    expect(goal.id).toMatch(/^goal-/)
    expect(seen).toEqual(['create'])
    expect(session.events.map(event => event.type)).toEqual(['goal/change'])
    /** 中文说明：测试局部值 context，由紧邻初始化决定。 */
    const context = session.events[0]
    expect(context?.type).toBe('goal/change')
    if (context?.type !== 'goal/change') throw new Error('expected durable goal change')
    /** 中文说明：测试局部值 change，由紧邻初始化决定。 */
    const change = decodeGoalChange(context.data)
    if (change === undefined) throw new Error('expected decoded goal change')
    expect(change).toMatchObject({ operation: 'create', goal: { id: goal.id } })
    expect(agent.inbox.nextStep).toEqual([])
    expect(session.deriveMessages()).toEqual([])
    expect(foldGoal(session.events)).toMatchObject({ goal: { id: goal.id }, roundsStarted: 0 })
    vi.useRealTimers()
  })

  it('uses 256 rounds by default and validates create input inside create', async () => {
    /** 中文说明：测试局部值 { ctx, agent }，由紧邻初始化决定。 */
    const { ctx, agent } = await harness()
    expect(() => ctx.goals.create(agent, { objective: '   ' })).toThrow(expect.objectContaining({
      code: 'GOAL_INVALID_OBJECTIVE',
    }))
    expect(() => ctx.goals.create(agent, { objective: 'x', maxGoalRounds: 0 })).toThrow(expect.objectContaining({
      code: 'GOAL_INVALID_MAX_ROUNDS',
    }))
    expect(() => ctx.goals.create(agent, { objective: 'x', maxGoalRounds: 1.5 })).toThrow(GoalError)
    expect(() => ctx.goals.create(agent, { objective: 'x', maxGoalRounds: 1.5 })).toThrow(HarnessError)
    expect(() => ctx.goals.create(agent, {
      objective: 'x', maxGoalRounds: Number.MAX_SAFE_INTEGER + 1,
    })).toThrow(GoalError)
    expect(ctx.goals.create(agent, { objective: 'x' }).maxGoalRounds).toBe(256)
  })

  it('also resolves the default when constructed directly without Cordis config normalization', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    await ctx.plugin(AgentRegistry)
    /** 中文说明：测试局部值 goals，由紧邻初始化决定。 */
    const goals = new GoalService(ctx)
    /** 中文说明：测试局部值 stub，由紧邻初始化决定。 */
    const stub = stubAgent('goal-direct-construction')
    ctx.agents.register(stub.agent)
    expect(goals.create(stub.agent, { objective: 'direct' })).toMatchObject({
      objective: 'direct', maxGoalRounds: 256,
    })
  })

  it('rejects invalid direct configuration', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    await ctx.plugin(AgentRegistry)
    await expect(ctx.plugin(GoalService, { defaultMaxGoalRounds: -1 })).rejects.toThrow(expect.objectContaining({
      code: 'GOAL_INVALID_MAX_ROUNDS',
    }))
  })

  it('restores a seeded goal and rounds with activation disarmed', async () => {
    /** 中文说明：测试局部值 first，由紧邻初始化决定。 */
    const first = await harness()
    /** 中文说明：测试局部值 created，由紧邻初始化决定。 */
    const created = first.ctx.goals.create(first.agent, { objective: 'seed me', maxGoalRounds: 9 })
    appendRound(first.session, created, 1)
    appendRound(first.session, created, 2)

    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(GoalService)
    /** 中文说明：测试局部值 resumed，由紧邻初始化决定。 */
    const resumed = stubAgent('seeded-goal', first.session.events)
    ctx.agents.register(resumed.agent)
    expect(ctx.goals.get(resumed.agent)).toMatchObject({
      id: created.id,
      roundsStarted: 2,
      activation: 'disarmed',
    })
  })

  it('inherits the completed-turn goal prefix through SessionStore.fork with child activation disarmed', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(GoalService)
    /** 中文说明：测试局部值 parent，由紧邻初始化决定。 */
    const parent = stubAgentForSession(ctx.sessions.create(SessionId('goal-fork-parent')))
    ctx.agents.register(parent.agent)
    /** 中文说明：测试局部值 goal，由紧邻初始化决定。 */
    const goal = ctx.goals.create(parent.agent, { objective: 'inherit through fork', maxGoalRounds: 5 })
    appendRound(parent.session, goal, 1)

    /** 中文说明：测试局部值 child，由紧邻初始化决定。 */
    const child = stubAgentForSession(ctx.sessions.fork(parent.session))
    ctx.agents.register(child.agent)
    expect(ctx.goals.get(child.agent)).toMatchObject({
      id: goal.id,
      objective: goal.objective,
      roundsStarted: 1,
      activation: 'disarmed',
    })
    expect(child.session.header.parentSession).toBe(parent.session.id)
    expect(child.session.header.seedLength).toBe(parent.session.seq)
  })

  it('disarms live activation on every session-start edge', async () => {
    /** 中文说明：测试局部值 { ctx, agent, session }，由紧邻初始化决定。 */
    const { ctx, agent, session } = await harness()
    /** 中文说明：测试局部值 goal，由紧邻初始化决定。 */
    let goal = ctx.goals.create(agent, { objective: 'stay stopped after resume' })
    expect(goal.activation).toBe('armed')
    agentEvents(ctx, agent).emit('agent/session-start', { source: 'resume' })
    expect(ctx.goals.get(agent)?.activation).toBe('disarmed')
    goal = ctx.goals.resume(agent, goal)
    expect(goal).toMatchObject({ phase: 'active', activation: 'armed', revision: 2 })
    expect(() => foldGoal(session.events)).not.toThrow()
  })

  it('lets a lifecycle owner disarm without writing a durable revision', async () => {
    /** 中文说明：测试局部值 { ctx, agent, session }，由紧邻初始化决定。 */
    const { ctx, agent, session } = await harness()
    /** 中文说明：测试局部值 goal，由紧邻初始化决定。 */
    const goal = ctx.goals.create(agent, { objective: 'survive driver reload' })
    /** 中文说明：测试局部值 before，由紧邻初始化决定。 */
    const before = session.events.length
    expect(ctx.goals.disarm(agent)).toMatchObject({
      id: goal.id,
      revision: goal.revision,
      phase: 'active',
      activation: 'disarmed',
    })
    expect(session.events).toHaveLength(before)
    expect(ctx.goals.resume(agent, goal)).toMatchObject({ revision: 2, activation: 'armed' })
  })

  it('removes the service and its session-start listener with the providing fiber', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    await ctx.plugin(AgentRegistry)
    /** 中文说明：测试局部值 fiber，由紧邻初始化决定。 */
    const fiber = await ctx.plugin(GoalService)
    /** 中文说明：测试局部值 first，由紧邻初始化决定。 */
    const first = ctx.goals
    /** 中文说明：测试局部值 stub，由紧邻初始化决定。 */
    const stub = stubAgent('goal-hmr')
    ctx.agents.register(stub.agent)
    /** 中文说明：测试局部值 goal，由紧邻初始化决定。 */
    const goal = first.create(stub.agent, { objective: 'survive service reload' })

    await fiber.dispose()
    expect(ctx.get('goals')).toBeUndefined()
    agentEvents(ctx, stub.agent).emit('agent/session-start', { source: 'resume' })
    expect(first.get(stub.agent)).toMatchObject({ id: goal.id, activation: 'armed' })

    await ctx.plugin(GoalService)
    expect(ctx.goals).not.toBe(first)
    expect(ctx.goals.get(stub.agent)).toMatchObject({ id: goal.id, activation: 'disarmed' })
  })

  it('requires the exact live registry instance for reads and mutations', async () => {
    /** 中文说明：测试局部值 { ctx, agent }，由紧邻初始化决定。 */
    const { ctx, agent } = await harness()
    // A same-id agent backed by a different session object — the live-instance
    // check must reject it even though the ids match.
    /** 中文说明：测试局部值 impostor，由紧邻初始化决定。 */
    const impostor = stubAgentForSession(Session.create(agent.id)).agent
    expect(() => ctx.goals.get(impostor)).toThrow(expect.objectContaining({ code: 'GOAL_AGENT_NOT_LIVE' }))
    expect(() => ctx.goals.create(impostor, { objective: 'no' })).toThrow(expect.objectContaining({
      code: 'GOAL_AGENT_NOT_LIVE',
    }))
  })

})

describe('GoalService mutations', () => {
  it('adapts Remote creation and reuses business methods for later mutations', async () => {
    /** 中文说明：测试局部值 { ctx, agent }，由紧邻初始化决定。 */
    const { ctx, agent } = await harness()
    /** 中文说明：测试局部值 created，由紧邻初始化决定。 */
    const created = ctx.goals.remoteExportCreate(agent, { objective: 'remote lifecycle' })
    /** 中文说明：测试局部值 edited，由紧邻初始化决定。 */
    const edited = ctx.goals.edit(agent, created.ref, { objective: 'edited remotely' })
    /** 中文说明：测试局部值 paused，由紧邻初始化决定。 */
    const paused = ctx.goals.pause(agent, edited)
    /** 中文说明：测试局部值 resumed，由紧邻初始化决定。 */
    const resumed = ctx.goals.resume(agent, paused)
    /** 中文说明：测试局部值 completed，由紧邻初始化决定。 */
    const completed = ctx.goals.complete(agent, resumed)
    /** 中文说明：测试局部值 cleared，由紧邻初始化决定。 */
    const cleared = ctx.goals.clear(agent, completed)

    expect(edited).toMatchObject({ objective: 'edited remotely', revision: 2 })
    expect(paused).toMatchObject({ phase: 'paused', revision: 3 })
    expect(resumed).toMatchObject({ phase: 'active', revision: 4 })
    expect(completed).toMatchObject({ phase: 'complete', revision: 5 })
    expect(cleared).toEqual({ id: created.ref.id, revision: 6 })
  })

  it('edits with compare-and-set revisions and rejects empty edits', async () => {
    /** 中文说明：测试局部值 { ctx, agent }，由紧邻初始化决定。 */
    const { ctx, agent } = await harness()
    /** 中文说明：测试局部值 created，由紧邻初始化决定。 */
    const created = ctx.goals.create(agent, { objective: 'old', maxGoalRounds: 4 })
    expect(() => ctx.goals.edit(agent, created, {})).toThrow(expect.objectContaining({ code: 'GOAL_INVALID_EDIT' }))
    /** 中文说明：测试局部值 objective，由紧邻初始化决定。 */
    const objective = ctx.goals.edit(agent, created, { objective: ' new ' })
    expect(objective).toMatchObject({ objective: 'new', maxGoalRounds: 4, revision: 2, activation: 'armed' })
    expect(() => ctx.goals.edit(agent, created, { maxGoalRounds: 8 })).toThrow(expect.objectContaining({
      code: 'GOAL_STALE_REVISION',
    }))
    /** 中文说明：测试局部值 cap，由紧邻初始化决定。 */
    const cap = ctx.goals.edit(agent, objective, { maxGoalRounds: 8 })
    expect(cap).toMatchObject({ objective: 'new', maxGoalRounds: 8, revision: 3 })
    expect(() => ctx.goals.edit(agent, cap, { objective: ' ' })).toThrow(expect.objectContaining({
      code: 'GOAL_INVALID_OBJECTIVE',
    }))
  })

  it('supports pause, resume, block, and completion transitions', async () => {
    /** 中文说明：测试局部值 { ctx, agent }，由紧邻初始化决定。 */
    const { ctx, agent } = await harness()
    /** 中文说明：测试局部值 goal，由紧邻初始化决定。 */
    let goal = ctx.goals.create(agent, { objective: 'lifecycle' })
    goal = ctx.goals.pause(agent, goal)
    expect(goal).toMatchObject({ phase: 'paused', activation: 'disarmed', revision: 2 })
    goal = ctx.goals.resume(agent, goal)
    expect(goal).toMatchObject({ phase: 'active', activation: 'armed', revision: 3 })
    goal = ctx.goals.block(agent, goal, { code: 'needs-input', message: 'A choice is required.' })
    expect(goal).toMatchObject({
      phase: 'blocked',
      blockedReason: { code: 'needs-input', message: 'A choice is required.' },
      activation: 'disarmed',
    })
    goal = ctx.goals.resume(agent, goal)
    goal = ctx.goals.pause(agent, goal)
    goal = ctx.goals.complete(agent, goal)
    expect(goal).toMatchObject({ phase: 'complete', activation: 'disarmed' })
    expect(() => ctx.goals.resume(agent, goal)).toThrow(expect.objectContaining({ code: 'GOAL_INVALID_TRANSITION' }))
  })

  it('allows completion from every stopped phase and replacement only after completion', async () => {
    /** 中文说明：测试局部值 phases，由紧邻初始化决定。 */
    const phases = ['paused', 'blocked'] as const
    /** 中文说明：测试局部值 phase，由紧邻初始化决定。 */
    for (const phase of phases) {
      /** 中文说明：测试局部值 { ctx, agent }，由紧邻初始化决定。 */
      const { ctx, agent } = await harness()
      /** 中文说明：测试局部值 goal，由紧邻初始化决定。 */
      let goal = ctx.goals.create(agent, { objective: phase })
      goal = phase === 'paused'
        ? ctx.goals.pause(agent, goal)
        : ctx.goals.block(agent, goal, { code: 'test-blocker', message: 'Blocked for the test.' })
      /** 中文说明：测试局部值 complete，由紧邻初始化决定。 */
      const complete = ctx.goals.complete(agent, goal)
      /** 中文说明：测试局部值 replacement，由紧邻初始化决定。 */
      const replacement = ctx.goals.create(agent, { objective: `after ${phase}` })
      expect(complete.phase).toBe('complete')
      expect(replacement.id).not.toBe(complete.id)
      expect(replacement.revision).toBe(1)
    }
  })

  it('rejects replacement and invalid phase transitions while a resumable goal exists', async () => {
    /** 中文说明：测试局部值 { ctx, agent }，由紧邻初始化决定。 */
    const { ctx, agent } = await harness()
    /** 中文说明：测试局部值 goal，由紧邻初始化决定。 */
    const goal = ctx.goals.create(agent, { objective: 'still active' })
    expect(() => ctx.goals.create(agent, { objective: 'replacement' })).toThrow(expect.objectContaining({
      code: 'GOAL_ALREADY_EXISTS',
    }))
    expect(() => ctx.goals.resume(agent, goal)).toThrow(expect.objectContaining({ code: 'GOAL_INVALID_TRANSITION' }))
    /** 中文说明：测试局部值 paused，由紧邻初始化决定。 */
    const paused = ctx.goals.pause(agent, goal)
    expect(() => ctx.goals.pause(agent, paused)).toThrow(expect.objectContaining({ code: 'GOAL_INVALID_TRANSITION' }))
    expect(() => ctx.goals.block(agent, paused, {
      code: 'test-blocker', message: 'Blocked for the test.',
    })).toThrow(expect.objectContaining({
      code: 'GOAL_INVALID_TRANSITION',
    }))
  })

  it('records canonical blocker reasons and enforces the round cap on resume', async () => {
    /** 中文说明：测试局部值 { ctx, agent, session }，由紧邻初始化决定。 */
    const { ctx, agent, session } = await harness()
    /** 中文说明：测试局部值 goal，由紧邻初始化决定。 */
    let goal = ctx.goals.create(agent, { objective: 'bounded', maxGoalRounds: 2 })
    /** 中文说明：测试局部值 reason，由紧邻初始化决定。 */
    for (const reason of [null, [], { code: 1, message: 'invalid code' }, { code: 'round-limit', message: 1 }]) {
      expect(() => ctx.goals.block(agent, goal, reason as never)).toThrow(expect.objectContaining({
        code: 'GOAL_INVALID_BLOCK_REASON',
      }))
    }
    expect(() => ctx.goals.block(agent, goal, {
      code: 'Not Canonical', message: 'invalid code',
    })).toThrow(expect.objectContaining({ code: 'GOAL_INVALID_BLOCK_REASON' }))
    expect(() => ctx.goals.block(agent, goal, {
      code: 'round-limit', message: '   ',
    })).toThrow(expect.objectContaining({ code: 'GOAL_INVALID_BLOCK_REASON' }))
    appendRound(session, goal, 1)
    expect(ctx.goals.get(agent)?.roundsStarted).toBe(1)
    appendRound(session, goal, 2)
    goal = ctx.goals.block(agent, goal, { code: 'round-limit', message: '  Goal round limit reached.  ' })
    expect(goal).toMatchObject({
      phase: 'blocked',
      blockedReason: { code: 'round-limit', message: 'Goal round limit reached.' },
      roundsStarted: 2,
      activation: 'disarmed',
    })
    expect(() => ctx.goals.resume(agent, goal)).toThrow(expect.objectContaining({ code: 'GOAL_INVALID_TRANSITION' }))
    goal = ctx.goals.edit(agent, goal, { maxGoalRounds: 3 })
    expect(goal.blockedReason).toEqual({ code: 'round-limit', message: 'Goal round limit reached.' })
    goal = ctx.goals.resume(agent, goal)
    expect(goal).toMatchObject({ phase: 'active', maxGoalRounds: 3, activation: 'armed' })
    expect(goal.blockedReason).toBeUndefined()
    appendRound(session, goal, 3)
    goal = ctx.goals.block(agent, goal, { code: 'round-limit', message: 'Goal round limit reached.' })
    expect(ctx.goals.complete(agent, goal).phase).toBe('complete')
  })

  it('clears through a revisioned tombstone and permits a fresh goal', async () => {
    /** 中文说明：测试局部值 { ctx, agent, session }，由紧邻初始化决定。 */
    const { ctx, agent, session } = await harness()
    /** 中文说明：测试局部值 goal，由紧邻初始化决定。 */
    const goal = ctx.goals.create(agent, { objective: 'temporary' })
    /** 中文说明：测试局部值 tombstone，由紧邻初始化决定。 */
    const tombstone = ctx.goals.clear(agent, goal)
    expect(tombstone).toEqual({ id: goal.id, revision: 2 })
    expect(ctx.goals.get(agent)).toBeUndefined()
    expect(foldGoal(session.events)).toEqual({ roundsStarted: 0, lastRef: tombstone })
    expect(() => ctx.goals.clear(agent, goal)).toThrow(expect.objectContaining({ code: 'GOAL_NOT_FOUND' }))
    /** 中文说明：测试局部值 next，由紧邻初始化决定。 */
    const next = ctx.goals.create(agent, { objective: 'fresh' })
    expect(next.id).not.toBe(goal.id)
  })

  it('keeps per-goal mutation timestamps monotonic when the wall clock moves backward', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(100)
    /** 中文说明：测试局部值 { ctx, agent, session }，由紧邻初始化决定。 */
    const { ctx, agent, session } = await harness()
    /** 中文说明：测试局部值 goal，由紧邻初始化决定。 */
    let goal = ctx.goals.create(agent, { objective: 'monotonic time' })
    vi.setSystemTime(90)
    goal = ctx.goals.pause(agent, goal)
    expect(goal.updatedAt).toBe(100)
    vi.setSystemTime(80)
    ctx.goals.clear(agent, goal)
    /** 中文说明：测试局部值 clear，由紧邻初始化决定。 */
    const clear = session.events
      .filter(event => event.type === 'goal/change')
      .map(event => event.type === 'goal/change' ? decodeGoalChange(event.data) : undefined)
      .at(-1)
    expect(clear).toMatchObject({ operation: 'clear', clearedAt: 100 })
    expect(() => foldGoal(session.events)).not.toThrow()
    vi.useRealTimers()
  })

  it('contains goal notification failures and preserves later listeners', async () => {
    /** 中文说明：测试局部值 { ctx, agent }，由紧邻初始化决定。 */
    const { ctx, agent } = await harness()
    /** 中文说明：测试局部值 warn，由紧邻初始化决定。 */
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
    /** 中文说明：测试局部值 seen，由紧邻初始化决定。 */
    const seen: string[] = []
    ctx.on('goal/changed', () => { throw new Error('broken observer') })
    ctx.on('goal/changed', ({ change }) => { seen.push(change.operation) })
    expect(ctx.goals.create(agent, { objective: 'notify' }).phase).toBe('active')
    expect(seen).toEqual(['create'])
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('broken observer'))
  })

  it('commits consecutive revisions through durable goal events', async () => {
    /** 中文说明：测试局部值 { ctx, agent, session }，由紧邻初始化决定。 */
    const { ctx, agent, session } = await harness()
    /** 中文说明：测试局部值 goal，由紧邻初始化决定。 */
    let goal = ctx.goals.create(agent, { objective: 'deferred', maxGoalRounds: 5 })
    goal = ctx.goals.edit(agent, goal, { objective: 'deferred edit' })
    goal = ctx.goals.pause(agent, goal)
    expect(goal).toMatchObject({ revision: 3, phase: 'paused', activation: 'disarmed' })
    expect(session.events.map(event => event.type)).toEqual([
      'goal/change', 'goal/change', 'goal/change',
    ])
    expect(ctx.goals.get(agent)).toMatchObject({ revision: 3, phase: 'paused' })
    expect(foldGoal(session.events)).toMatchObject({ goal: { revision: 3, phase: 'paused' } })
  })

  it('publishes a mutation consistently to a reentrant session observer', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(GoalService)
    /** 中文说明：测试局部值 stub，由紧邻初始化决定。 */
    const stub = stubAgentForSession(ctx.sessions.create(SessionId('goal-reentrant-observer')))
    ctx.agents.register(stub.agent)
    /** 中文说明：测试局部值 解构结果，由紧邻初始化决定。 */
    let observed: ReturnType<GoalService['get']>
    ctx.on('session/event', (session, event) => {
      if (session === stub.session && event.type === 'goal/change') observed = ctx.goals.get(stub.agent)
    })

    /** 中文说明：测试局部值 created，由紧邻初始化决定。 */
    const created = ctx.goals.create(stub.agent, { objective: 'publish once' })

    expect(observed).toEqual(created)
    expect(ctx.goals.get(stub.agent)).toEqual(created)
    expect(foldGoal(stub.session.events)).toMatchObject({ goal: { id: created.id, revision: 1 } })
  })

  it('does not delegate goal persistence to agent injection', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(GoalService)
    /** 中文说明：测试局部值 stub，由紧邻初始化决定。 */
    const stub = stubAgent('goal-independent-injection')
    stub.agent.inject = () => { throw new Error('injection must not be called') }
    ctx.agents.register(stub.agent)

    expect(ctx.goals.create(stub.agent, { objective: 'persist directly' })).toMatchObject({
      objective: 'persist directly',
      revision: 1,
    })
    expect(stub.agent.inbox.nextStep).toEqual([])
    expect(stub.session.events.map(event => event.type)).toEqual(['goal/change'])
  })

  it('observes a valid goal snapshot appended after an empty cache was established', async () => {
    /** 中文说明：测试局部值 { ctx, agent, session }，由紧邻初始化决定。 */
    const { ctx, agent, session } = await harness()
    expect(ctx.goals.get(agent)).toBeUndefined()
    /** 中文说明：测试局部值 change，由紧邻初始化决定。 */
    const change: GoalSnapshotChangeMeta = {
      kind: 'goal/change',
      version: 1,
      operation: 'create',
      goal: {
        id: GoalId('goal-external'),
        revision: 1,
        objective: 'observe external append',
        phase: 'active',
        maxGoalRounds: 4,
      },
      roundsStarted: 0,
      createdAt: 12,
      updatedAt: 12,
    }
    session.append('goal/change', change)

    expect(ctx.goals.get(agent)).toMatchObject({
      id: change.goal.id,
      objective: change.goal.objective,
      activation: 'disarmed',
    })
  })

  it('reports the same corrupt unseen event after committing its valid prefix', async () => {
    /** 中文说明：测试局部值 { ctx, agent, session }，由紧邻初始化决定。 */
    const { ctx, agent, session } = await harness()
    expect(ctx.goals.get(agent)).toBeUndefined()
    /** 中文说明：测试局部值 change，由紧邻初始化决定。 */
    const change: GoalSnapshotChangeMeta = {
      kind: 'goal/change',
      version: 1,
      operation: 'create',
      goal: {
        id: GoalId('goal-valid-prefix'),
        revision: 1,
        objective: 'valid prefix',
        phase: 'active',
        maxGoalRounds: 4,
      },
      roundsStarted: 0,
      createdAt: 12,
      updatedAt: 12,
    }
    session.append('goal/change', change)
    session.append('goal/change', { ...change, operation: 'edit', extra: true } as never)

    expect(() => ctx.goals.get(agent)).toThrow('snapshot change must have exactly')
    expect(() => ctx.goals.get(agent)).toThrow('snapshot change must have exactly')
  })
})

describe('goal replay validation', () => {
  /** 中文说明：函数 snapshotChange 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
  function snapshotChange(overrides: Partial<GoalSnapshotChangeMeta> = {}): GoalSnapshotChangeMeta {
    return {
      kind: 'goal/change',
      version: 1,
      operation: 'create',
      goal: {
        id: GoalId('goal-validation'),
        revision: 1,
        objective: 'validate',
        phase: 'active',
        maxGoalRounds: 2,
      },
      roundsStarted: 0,
      createdAt: 10,
      updatedAt: 10,
      ...overrides,
    }
  }

  /** 中文说明：函数 appendChange 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
  function appendChange(session: Session, change: GoalChangeMeta): void {
    session.append('goal/change', change)
  }

  /** 中文说明：函数 oneChange 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
  function oneChange(change: GoalChangeMeta) {
    /** 中文说明：测试局部值 session，由紧邻初始化决定。 */
    const session = Session.create(SessionId(`validation-${Math.random()}`))
    appendChange(session, change)
    return session.events
  }

  /** 中文说明：函数 mutation 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
  function mutation(
    current: GoalSnapshotChangeMeta,
    operation: Exclude<GoalSnapshotChangeMeta['operation'], 'create'>,
    phase: GoalSnapshotChangeMeta['goal']['phase'],
    overrides: Partial<GoalSnapshotChangeMeta> = {},
  ): GoalSnapshotChangeMeta {
    return {
      ...current,
      operation,
      goal: {
        id: current.goal.id,
        revision: current.goal.revision + 1,
        objective: current.goal.objective,
        phase,
        ...phase === 'blocked'
          ? { blockedReason: { code: 'test-blocker', message: 'Blocked for replay validation.' } }
          : {},
        maxGoalRounds: current.goal.maxGoalRounds,
      },
      updatedAt: current.updatedAt + 1,
      ...overrides,
    }
  }

  it('keeps durable goal state independent from inbox changes', () => {
    /** 中文说明：测试局部值 change，由紧邻初始化决定。 */
    const change = snapshotChange()
    /** 中文说明：测试局部值 session，由紧邻初始化决定。 */
    const session = Session.create(SessionId('inbox-independent-change'))
    appendChange(session, change)
    expect(foldGoal(session.events)).toMatchObject({ goal: { id: change.goal.id, revision: 1 } })
    /** 中文说明：测试局部值 message，由紧邻初始化决定。 */
    const message = createUserMessage({
      content: [{ type: 'text', text: 'unrelated pending context' }],
      source: { kind: 'plugin', plugin: 'test' },
    })
    /** 中文说明：测试局部值 inbox，由紧邻初始化决定。 */
    const inbox = new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} })
    inbox.append('next-step', message)
    expect(inbox.remove(message.id)).toBe(true)
    expect(foldGoal(session.events)).toMatchObject({ goal: { id: change.goal.id, revision: 1 } })
  })

  /** 中文说明：函数 foldPair 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
  function foldPair(first: GoalSnapshotChangeMeta, second: GoalChangeMeta): ReturnType<typeof foldGoal> {
    /** 中文说明：测试局部值 session，由紧邻初始化决定。 */
    const session = Session.create(SessionId(`validation-pair-${Math.random()}`))
    appendChange(session, first)
    appendChange(session, second)
    return foldGoal(session.events)
  }

  it('ignores unrelated metadata and non-goal round sources', () => {
    expect(decodeGoalChange(undefined)).toBeUndefined()
    expect(decodeGoalChange({ kind: 'other' })).toBeUndefined()
    /** 中文说明：测试局部值 session，由紧邻初始化决定。 */
    const session = Session.create(SessionId('unrelated'))
    appendInjection(session, createUserMessage({
      content: [{ type: 'text', text: 'other' }],
      source: { kind: 'plugin', plugin: 'test' },
    }))
    expect(foldGoal(session.events)).toEqual({ roundsStarted: 0 })
    /** 中文说明：测试局部值 source，由紧邻初始化决定。 */
    const source = { kind: 'plugin', plugin: 'ordinary-user-message' } as const
    /** 中文说明：测试局部值 turn，由紧邻初始化决定。 */
    const turn = nextTurn(session)
    session.append('turn/start', { turn })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'ordinary' }], source,
    }), { surfaceOp: 'append' })
    session.append('turn/end', { turn, reason: { kind: 'completed' } })
    expect(foldGoal(session.events)).toEqual({ roundsStarted: 0 })
  })

  it('rejects rounds attributed to another goal', () => {
    /** 中文说明：测试局部值 change，由紧邻初始化决定。 */
    const change = snapshotChange()
    /** 中文说明：测试局部值 session，由紧邻初始化决定。 */
    const session = Session.create(SessionId('other-goal-round'), oneChange(change))
    appendRound(session, { id: GoalId('goal-other'), revision: 1 }, 1)
    expect(() => foldGoal(session.events)).toThrow('not the next admitted round')
  })

  it('rejects unsupported versions, operations, and extra top-level fields', () => {
    expect(() => decodeGoalChange({ ...snapshotChange(), version: 2 })).toThrow('unsupported goal change version')
    expect(() => decodeGoalChange({ ...snapshotChange(), operation: 'explode' })).toThrow('operation is invalid')
    expect(() => decodeGoalChange({ ...snapshotChange(), extra: true })).toThrow('snapshot change must have exactly')
    expect(() => decodeGoalChange({
      kind: 'goal/change', version: 1, operation: 'clear', cleared: { id: 'x', revision: 2 }, clearedAt: 1, extra: true,
    })).toThrow('clear change must have exactly')
  })

  it('rejects invalid create and missing-current mutation sequences', () => {
    /** 中文说明：测试局部值 base，由紧邻初始化决定。 */
    const base = snapshotChange()
    /** 中文说明：测试局部值 invalidCreates，由紧邻初始化决定。 */
    const invalidCreates: GoalSnapshotChangeMeta[] = [
      { ...base, goal: { ...base.goal, revision: 2 } },
      { ...base, goal: { ...base.goal, phase: 'paused' } },
      { ...base, roundsStarted: 1 },
    ]
    /** 中文说明：测试局部值 change，由紧邻初始化决定。 */
    for (const change of invalidCreates) expect(() => foldGoal(oneChange(change))).toThrow('goal create requires')

    /** 中文说明：测试局部值 edit，由紧邻初始化决定。 */
    const edit = mutation(base, 'edit', 'active')
    expect(() => foldGoal(oneChange(edit))).toThrow('requires a current goal')
    /** 中文说明：测试局部值 clear，由紧邻初始化决定。 */
    const clear: GoalChangeMeta = {
      kind: 'goal/change', version: 1, operation: 'clear', cleared: { id: base.goal.id, revision: 2 }, clearedAt: 12,
    }
    expect(() => foldGoal(oneChange(clear))).toThrow('clear requires a current goal')

    /** 中文说明：测试局部值 secondCreate，由紧邻初始化决定。 */
    const secondCreate = snapshotChange({
      goal: { ...base.goal, id: GoalId('goal-second') },
      createdAt: 20,
      updatedAt: 20,
    })
    expect(() => foldPair(base, secondCreate)).toThrow('goal create requires')
  })

  it('rejects stale identity, counters, timestamps, and definition changes', () => {
    /** 中文说明：测试局部值 base，由紧邻初始化决定。 */
    const base = snapshotChange()
    /** 中文说明：测试局部值 invalid，由紧邻初始化决定。 */
    const invalid: GoalSnapshotChangeMeta[] = [
      mutation(base, 'edit', 'active', { goal: { ...base.goal, id: GoalId('goal-wrong'), revision: 2 } }),
      mutation(base, 'edit', 'active', { goal: { ...base.goal, revision: 3 } }),
      mutation(base, 'edit', 'active', { createdAt: 11 }),
      mutation(base, 'edit', 'active', { updatedAt: 9 }),
      mutation(base, 'edit', 'active', { roundsStarted: 1 }),
      mutation(base, 'pause', 'paused', {
        goal: { ...base.goal, revision: 2, phase: 'paused', objective: 'changed illegally' },
      }),
      mutation(base, 'pause', 'paused', {
        goal: { ...base.goal, revision: 2, phase: 'paused', maxGoalRounds: 3 },
      }),
    ]
    /** 中文说明：测试局部值 change，由紧邻初始化决定。 */
    for (const change of invalid) expect(() => foldPair(base, change)).toThrow()
  })

  it('rejects invalid replayed lifecycle phase transitions', () => {
    /** 中文说明：测试局部值 base，由紧邻初始化决定。 */
    const base = snapshotChange()
    /** 中文说明：测试局部值 invalid，由紧邻初始化决定。 */
    const invalid: GoalSnapshotChangeMeta[] = [
      mutation(base, 'edit', 'paused'),
      mutation(base, 'pause', 'active'),
      mutation(base, 'resume', 'paused'),
      mutation(base, 'complete', 'active'),
      mutation(base, 'block', 'active'),
    ]
    /** 中文说明：测试局部值 change，由紧邻初始化决定。 */
    for (const change of invalid) expect(() => foldPair(base, change)).toThrow()

    /** 中文说明：测试局部值 paused，由紧邻初始化决定。 */
    const paused = mutation(base, 'pause', 'paused')
    /** 中文说明：测试局部值 exhausted，由紧邻初始化决定。 */
    const exhausted = mutation(paused, 'resume', 'active', {
      roundsStarted: 2,
      goal: { ...paused.goal, revision: 3, phase: 'active', maxGoalRounds: 2 },
    })
    /** 中文说明：测试局部值 session，由紧邻初始化决定。 */
    const session = Session.create(SessionId('exhausted-resume'))
    appendChange(session, base)
    appendRound(session, base.goal, 1)
    appendRound(session, base.goal, 2)
    appendChange(session, { ...paused, roundsStarted: 2 })
    appendChange(session, exhausted)
    expect(() => foldGoal(session.events)).toThrow('exhausted round budget')
  })

  it('rejects invalid clear continuity and goal id reuse', () => {
    /** 中文说明：测试局部值 base，由紧邻初始化决定。 */
    const base = snapshotChange()
    /** 中文说明：测试局部值 staleClear，由紧邻初始化决定。 */
    const staleClear: GoalChangeMeta = {
      kind: 'goal/change', version: 1, operation: 'clear', cleared: { id: base.goal.id, revision: 3 }, clearedAt: 11,
    }
    expect(() => foldPair(base, staleClear)).toThrow('advance the current goal')
    /** 中文说明：测试局部值 earlyClear，由紧邻初始化决定。 */
    const earlyClear: GoalChangeMeta = {
      kind: 'goal/change', version: 1, operation: 'clear', cleared: { id: base.goal.id, revision: 2 }, clearedAt: 9,
    }
    expect(() => foldPair(base, earlyClear)).toThrow('timestamp cannot precede')

    /** 中文说明：测试局部值 complete，由紧邻初始化决定。 */
    const complete = mutation(base, 'complete', 'complete')
    /** 中文说明：测试局部值 sameCurrentId，由紧邻初始化决定。 */
    const sameCurrentId = snapshotChange({
      goal: { ...base.goal, revision: 1 },
      createdAt: 20,
      updatedAt: 20,
    })
    /** 中文说明：测试局部值 completedSession，由紧邻初始化决定。 */
    const completedSession = Session.create(SessionId('reuse-complete'))
    appendChange(completedSession, base)
    appendChange(completedSession, complete)
    appendChange(completedSession, sameCurrentId)
    expect(() => foldGoal(completedSession.events)).toThrow('fresh active revision-one')

    /** 中文说明：测试局部值 second，由紧邻初始化决定。 */
    const second = snapshotChange({
      goal: { ...base.goal, id: GoalId('goal-second') },
      createdAt: 20,
      updatedAt: 20,
    })
    /** 中文说明：测试局部值 secondComplete，由紧邻初始化决定。 */
    const secondComplete = mutation(second, 'complete', 'complete')
    /** 中文说明：测试局部值 nonAdjacentReuse，由紧邻初始化决定。 */
    const nonAdjacentReuse = Session.create(SessionId('reuse-non-adjacent'))
    appendChange(nonAdjacentReuse, base)
    appendChange(nonAdjacentReuse, complete)
    appendChange(nonAdjacentReuse, second)
    appendChange(nonAdjacentReuse, secondComplete)
    appendChange(nonAdjacentReuse, { ...sameCurrentId, createdAt: 30, updatedAt: 30 })
    expect(() => foldGoal(nonAdjacentReuse.events)).toThrow('fresh active revision-one')

    /** 中文说明：测试局部值 clear，由紧邻初始化决定。 */
    const clear: GoalChangeMeta = {
      kind: 'goal/change', version: 1, operation: 'clear', cleared: { id: base.goal.id, revision: 2 }, clearedAt: 11,
    }
    /** 中文说明：测试局部值 clearedSession，由紧邻初始化决定。 */
    const clearedSession = Session.create(SessionId('reuse-clear'))
    appendChange(clearedSession, base)
    appendChange(clearedSession, clear)
    appendChange(clearedSession, sameCurrentId)
    expect(() => foldGoal(clearedSession.events)).toThrow('fresh active revision-one')
  })

  it('rejects non-positive goal round sources', () => {
    /** 中文说明：测试局部值 session，由紧邻初始化决定。 */
    const session = Session.create(SessionId('goal-source-without-meta'))
    /** 中文说明：测试局部值 source，由紧邻初始化决定。 */
    const source = { kind: 'goal', goalId: GoalId('goal-missing-meta'), revision: 1, round: 0 } as const
    /** 中文说明：测试局部值 turn，由紧邻初始化决定。 */
    const turn = nextTurn(session)
    session.append('turn/start', { turn })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'missing' }], source,
    }), { surfaceOp: 'append' })
    session.append('turn/end', { turn, reason: { kind: 'completed' } })
    expect(() => foldGoal(session.events)).toThrow('goal message source is invalid')
  })

  it('rejects malformed snapshots, refs, counters, and timestamps', () => {
    /** 中文说明：测试局部值 base，由紧邻初始化决定。 */
    const base = snapshotChange()
    /** 中文说明：测试局部值 badSnapshots，由紧邻初始化决定。 */
    const badSnapshots: unknown[] = [
      null,
      { ...base.goal, extra: true },
      { ...base.goal, id: '' },
      { ...base.goal, objective: ' ' },
      { ...base.goal, objective: ' padded ' },
      { ...base.goal, phase: 'unknown' },
      { ...base.goal, blockedReason: { code: 'unexpected', message: 'Only blocked goals have reasons.' } },
      { ...base.goal, phase: 'blocked' },
      { ...base.goal, phase: 'blocked', blockedReason: null },
      { ...base.goal, phase: 'blocked', blockedReason: { code: 'test-blocker', message: 'Valid.', extra: true } },
      { ...base.goal, phase: 'blocked', blockedReason: { code: 'NOT_CANONICAL', message: 'Bad code.' } },
      { ...base.goal, phase: 'blocked', blockedReason: { code: 'test-blocker', message: ' padded ' } },
      { ...base.goal, revision: 0 },
      { ...base.goal, maxGoalRounds: -1 },
    ]
    /** 中文说明：测试局部值 goal，由紧邻初始化决定。 */
    for (const goal of badSnapshots) expect(() => decodeGoalChange({ ...base, goal })).toThrow()
    expect(() => decodeGoalChange({ ...base, roundsStarted: -1 })).toThrow('roundsStarted')
    expect(() => decodeGoalChange({ ...base, createdAt: -1 })).toThrow('createdAt')
    expect(() => decodeGoalChange({ ...base, updatedAt: 9 })).toThrow('cannot precede')
    expect(() => decodeGoalChange({
      kind: 'goal/change', version: 1, operation: 'clear', cleared: null, clearedAt: 1,
    })).toThrow('tombstone')
    expect(() => decodeGoalChange({
      kind: 'goal/change', version: 1, operation: 'clear', cleared: { id: '', revision: 1 }, clearedAt: 1,
    })).toThrow('non-empty')
    expect(() => decodeGoalChange({
      kind: 'goal/change', version: 1, operation: 'clear', cleared: { id: 'x', revision: 0 }, clearedAt: 1,
    })).toThrow('positive safe integer')
  })

  it('folds a clear tombstone after a snapshot', () => {
    /** 中文说明：测试局部值 change，由紧邻初始化决定。 */
    const change = snapshotChange()
    /** 中文说明：测试局部值 session，由紧邻初始化决定。 */
    const session = Session.create(SessionId('fold-clear'), oneChange(change))
    /** 中文说明：测试局部值 clear，由紧邻初始化决定。 */
    const clear: GoalChangeMeta = {
      kind: 'goal/change',
      version: 1,
      operation: 'clear',
      cleared: { id: change.goal.id, revision: 2 },
      clearedAt: 20,
    }
    appendChange(session, clear)
    expect(foldGoal(session.events)).toEqual({
      roundsStarted: 0,
      lastRef: { id: change.goal.id, revision: 2 },
    })
  })
})
