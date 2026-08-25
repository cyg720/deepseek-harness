/**
 * 文件职责：验证目标工具与投影的 tool-goal.spec.ts 行为与边界。
 * 技术维度：TypeScript、Cordis、JSON 编解码、子进程、事件匹配和严格联合类型。
 * 产品维度：保证目标工具与投影可预测地传递事件、限制循环或适配外部工具。
 * 逻辑维度：构造事件与配置，驱动入口并断言结果。
 * 关键边界：线协议输入必须校验；外部 Hook 失败不得破坏会话日志或核心循环。
 * 新手阅读建议：先读 types/events，再看 codec/matcher/runner，最后阅读桥接配置。
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import AgentRegistry, { agentEvents, Inbox } from '@deepseek-ai/dsh-agent'
import type { Agent, AgentStatus } from '@deepseek-ai/dsh-agent'
import GoalService, { GoalId } from '@deepseek-ai/dsh-goal'
import type { GoalRef } from '@deepseek-ai/dsh-goal'
import { createUserMessage, CallId } from '@deepseek-ai/dsh-llm'
import type { MessageSource } from '@deepseek-ai/dsh-llm'
import { SESSION_FORMAT_VERSION, Session, SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import * as toolGoal from '@deepseek-ai/dsh-tool-goal'

/** 中文说明：测试局部值 testToolSignal，由紧邻初始化决定。 */
const testToolSignal = new AbortController().signal

/** 中文说明：类型或类 StubAgent 约束 Hook、守卫或目标数据职责。 */
interface StubAgent {
  readonly agent: Agent
  readonly session: Session
  setStatus(status: AgentStatus): void
}

/** Build one registry-compatible live agent whose injections enter the durable inbox. */
/* 中文说明：函数 stubAgent 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function stubAgent(rawId: string, supplied?: Session): StubAgent {
  /** 中文说明：测试局部值 session，由紧邻初始化决定。 */
  const session = supplied ?? Session.create(SessionId(rawId))
  /** 中文说明：测试局部值 status，由紧邻初始化决定。 */
  let status: AgentStatus = 'running'
  /** 中文说明：测试局部值 agent，由紧邻初始化决定。 */
  const agent: Agent = {
    id: session.id,
    options: {},
    session,
    inbox: new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} }),
    get status() { return status },
    ctx: new Context(),
    send: () => {},
    followup: () => {},
    steer: () => ({ outcome: Promise.resolve({ status: 'rejected' as const }) }),
    inject(input) {
      this.inbox.append('next-step', input)
    },
    cancel() {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle() { return Promise.resolve() },
  }
  return { agent, session, setStatus(value) { status = value } }
}

/** Open one message-triggered turn with its accepted model-visible input. */
/* 中文说明：函数 openTurn 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function openTurn(stub: StubAgent, source: MessageSource, text = 'prompt'): number {
  /** 中文说明：测试局部值 turn，由紧邻初始化决定。 */
  const turn = stub.session.events
    .filter(event => event.type === 'turn/start')
    .reduce((max, event) => Math.max(max, event.data.turn), 0) + 1
  /** 中文说明：测试局部值 message，由紧邻初始化决定。 */
  const message = createUserMessage({
    content: [{ type: 'text', text }],
    source,
  })
  stub.agent.inbox.append('next-turn', message)
  /** 中文说明：测试局部值 claimed，由紧邻初始化决定。 */
  const claimed = stub.agent.inbox.claim('next-turn', turn)
  if (claimed.length === 0) throw new Error('expected queued turn input')
  stub.session.append('turn/start', { turn })
  /** 中文说明：测试局部值 admitted，由紧邻初始化决定。 */
  for (const admitted of claimed) {
    stub.session.append('user/message', admitted, { surfaceOp: 'append' })
  }
  return turn
}

/** Close the currently open test turn. */
/* 中文说明：函数 closeTurn 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function closeTurn(stub: StubAgent, turn: number): void {
  stub.session.append('turn/end', { turn, reason: { kind: 'completed' } })
}

/** 中文说明：函数 harness 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
async function harness(config: toolGoal.Config = {}) {
  /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(GoalService)
  /** 中文说明：测试局部值 fiber，由紧邻初始化决定。 */
  const fiber = await ctx.plugin(toolGoal, config)
  /** 中文说明：测试局部值 root，由紧邻初始化决定。 */
  const root = stubAgent(`goal-tool-root-${Math.random()}`)
  ctx.agents.register(root.agent)
  return { ctx, fiber, root }
}

/** Execute one registered tool under an optional driver initiator. */
/* 中文说明：函数 execute 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
async function execute(
  ctx: Context,
  name: string,
  args: unknown,
  agent?: Agent,
  initiator: Agent | undefined = agent,
): Promise<ToolExecutionResult> {
  /** 中文说明：测试局部值 run，由紧邻初始化决定。 */
  const run = () => ctx.tools.execute({
    signal: testToolSignal,
    callId: CallId(`call-${Math.random()}`),
    name,
    arguments: args,
    ...agent === undefined ? {} : { agent },
  })
  return initiator === undefined ? run() : ctx.agents.withInitiator(initiator, run)
}

/** Parse the compact JSON returned by a successful goal tool. */
/* 中文说明：函数 resultJson 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function resultJson(result: ToolExecutionResult): Record<string, unknown> {
  expect(result.isError).toBe(false)
  if (result.isError) throw new Error('expected goal tool success')
  /** 中文说明：测试局部值 block，由紧邻初始化决定。 */
  const block = result.content[0]
  if (block?.type !== 'text') throw new Error('expected text tool result')
  /** 中文说明：测试局部值 parsed，由紧邻初始化决定。 */
  const parsed = JSON.parse(block.text) as Record<string, unknown>
  expect(result.value).toEqual(parsed)
  return parsed
}

/** Read the returned goal sub-object. */
/* 中文说明：函数 resultGoal 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function resultGoal(result: ToolExecutionResult): Record<string, unknown> {
  /** 中文说明：测试局部值 goal，由紧邻初始化决定。 */
  const goal = resultJson(result)['goal']
  if (typeof goal !== 'object' || goal === null) throw new Error('expected returned goal')
  return goal as Record<string, unknown>
}

describe('goal tool registration and presentation', () => {
  it('registers three exclusive tools plus configured guidance and disposes all contributions', async () => {
    /** 中文说明：测试局部值 { ctx, fiber }，由紧邻初始化决定。 */
    const { ctx, fiber } = await harness({ blockedAfterConsecutiveRounds: 5 })
    expect(['create_goal', 'get_goal', 'update_goal'].map(name => ctx.tools.get(name)?.name))
      .toEqual(['create_goal', 'get_goal', 'update_goal'])
    /** 中文说明：测试局部值 name，由紧邻初始化决定。 */
    for (const name of ['create_goal', 'get_goal', 'update_goal']) {
      expect(ctx.tools.executionMode({ signal: testToolSignal, callId: CallId(name), name, arguments: {} }))
        .toEqual({ kind: 'exclusive' })
    }
    /** 中文说明：测试局部值 section，由紧邻初始化决定。 */
    const section = (await ctx.systemPrompt.assemble()).sections.find(item => item.name === 'tool:goal')
    expect(section?.text).toContain('infer goal intent')
    expect(section?.text).toContain('at least 5 consecutive goal rounds')

    await fiber.dispose()
    expect(ctx.tools.get('get_goal')).toBeUndefined()
    expect((await ctx.systemPrompt.assemble()).sections.some(item => item.name === 'tool:goal')).toBe(false)
  })

  it('uses args-only generic render intent and soft-fails malformed replay args', async () => {
    /** 中文说明：测试局部值 { ctx }，由紧邻初始化决定。 */
    const { ctx } = await harness()
    expect(ctx.tools.get('get_goal')?.presentCall?.({})).toEqual({
      card: 'generic', title: 'Read current goal', kind: 'read',
    })
    expect(ctx.tools.get('create_goal')?.presentCall?.({ objective: 'ship' })).toEqual({
      card: 'generic', title: 'Create goal', kind: 'other', rawInput: 'ship',
    })
    expect(ctx.tools.get('update_goal')?.presentCall?.({
      goal_id: 'goal-1', revision: 2, action: 'blocked', blocked_reason: 'Waiting for a human choice.',
    })).toEqual({ card: 'generic', title: 'Mark goal', kind: 'other', rawInput: 'Waiting for a human choice.' })
    expect(ctx.tools.get('update_goal')?.presentCall?.({
      goal_id: 'goal-1', revision: 2, action: 'edit',
      objective: 'ship', max_goal_rounds: 0, blocked_reason: '',
    })).toEqual({ card: 'generic', title: 'Edit goal', kind: 'other', rawInput: 'ship' })
    expect(ctx.tools.get('update_goal')?.presentCall?.({
      goal_id: 'goal-1', revision: 2, action: 'edit',
      objective: '', max_goal_rounds: 8, blocked_reason: '',
    })).toEqual({ card: 'generic', title: 'Edit goal', kind: 'other', rawInput: 8 })
    expect(ctx.tools.get('update_goal')?.presentCall?.({
      goal_id: 'goal-1', revision: 2, action: 'resume',
      objective: '', max_goal_rounds: 0, blocked_reason: '',
    })).toEqual({ card: 'generic', title: 'Resume goal', kind: 'other', rawInput: 'goal-1' })
    expect(ctx.tools.get('update_goal')?.presentCall?.({ wrong: true })).toBeUndefined()
  })

  it('has the Loader-safe namespace export shape', () => {
    expect('default' in toolGoal).toBe(false)
    expect(toolGoal.name).toBe('tool-goal')
    expect(toolGoal.inject).toEqual(['agents', 'goals', 'tools', 'systemPrompt'])
    /** 中文说明：测试局部值 loader，由紧邻初始化决定。 */
    const loader = Object.create(Loader.prototype) as Loader
    expect(loader.unwrapExports(toolGoal)).toBe(toolGoal)
  })

  it('fails invalid direct config before registering anything', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(GoalService)
    expect(() => {
      toolGoal.apply(ctx, { blockedAfterConsecutiveRounds: 1.5 })
    }).toThrow(
      'blockedAfterConsecutiveRounds must be a positive safe integer',
    )
    expect(ctx.tools.get('get_goal')).toBeUndefined()
  })

  it('resolves the direct-apply default before registration', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(GoalService)
    toolGoal.apply(ctx, {})
    /** 中文说明：测试局部值 section，由紧邻初始化决定。 */
    const section = (await ctx.systemPrompt.assemble()).sections.find(item => item.name === 'tool:goal')
    expect(section?.text).toContain('at least 3 consecutive goal rounds')
  })
})

describe('goal tool execution authority', () => {
  it('lets a root model infer create intent from its accepted human turn', async () => {
    /** 中文说明：测试局部值 { ctx, root }，由紧邻初始化决定。 */
    const { ctx, root } = await harness()
    openTurn(root, { kind: 'user' }, '请持续工作直到这个功能完成')
    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await execute(ctx, 'create_goal', {
      objective: 'Finish the feature', max_goal_rounds: 9,
    }, root.agent)
    expect(resultGoal(result)).toMatchObject({
      objective: 'Finish the feature', revision: 1, phase: 'active', maxGoalRounds: 9,
    })
    expect(resultJson(result)['activation']).toBe('armed')
    expect(ctx.goals.get(root.agent)?.objective).toBe('Finish the feature')
  })

  it('rejects agentless, driverless, non-human, and live-child creation', async () => {
    /** 中文说明：测试局部值 { ctx, root }，由紧邻初始化决定。 */
    const { ctx, root } = await harness()
    /** 中文说明：测试局部值 agentless，由紧邻初始化决定。 */
    const agentless = await execute(ctx, 'get_goal', {})
    expect(agentless.error?.info?.code).toBe('GOAL_TOOL_AGENT_REQUIRED')

    openTurn(root, { kind: 'user' })
    /** 中文说明：测试局部值 driverless，由紧邻初始化决定。 */
    const driverless = await ctx.tools.execute({
      signal: testToolSignal,
      callId: CallId('call-driverless'),
      name: 'get_goal',
      arguments: {},
      agent: root.agent,
    })
    expect(driverless.error?.info?.code).toBe('GOAL_TOOL_DRIVER_REQUIRED')
    closeTurn(root, 1)

    openTurn(root, { kind: 'plugin', plugin: 'test' })
    /** 中文说明：测试局部值 nonHuman，由紧邻初始化决定。 */
    const nonHuman = await execute(ctx, 'create_goal', { objective: 'forged' }, root.agent)
    expect(nonHuman.error?.info?.code).toBe('GOAL_TOOL_AUTHORITY_REQUIRED')
    closeTurn(root, 2)

    /** 中文说明：测试局部值 child，由紧邻初始化决定。 */
    const child = stubAgent('goal-tool-child')
    ctx.agents.enter(child.agent, root.agent)
    ctx.agents.announce(child.agent)
    openTurn(child, { kind: 'user' })
    /** 中文说明：测试局部值 childResult，由紧邻初始化决定。 */
    const childResult = await execute(ctx, 'create_goal', { objective: 'child goal' }, child.agent)
    expect(childResult.error?.info?.code).toBe('GOAL_TOOL_AUTHORITY_REQUIRED')
  })

  it('rejects stale agent objects and agents outside running status through the executor', async () => {
    /** 中文说明：测试局部值 { ctx, root }，由紧邻初始化决定。 */
    const { ctx, root } = await harness()
    openTurn(root, { kind: 'user' })
    // A distinct agent object over root's exact session: same id, not the live
    // registered instance, so the executor must reject it.
    /** 中文说明：测试局部值 stale，由紧邻初始化决定。 */
    const stale = stubAgent('goal-tool-stale', root.agent.session).agent
    /** 中文说明：测试局部值 staleResult，由紧邻初始化决定。 */
    const staleResult = await execute(ctx, 'get_goal', {}, stale, stale)
    expect(staleResult.error?.info?.code).toBe('GOAL_TOOL_DRIVER_REQUIRED')

    root.setStatus('idle')
    /** 中文说明：测试局部值 idleResult，由紧邻初始化决定。 */
    const idleResult = await execute(ctx, 'get_goal', {}, root.agent)
    expect(idleResult.error?.info?.code).toBe('GOAL_TOOL_DRIVER_REQUIRED')
  })

  it('treats a fork resumed as a runtime root as direct-human authority', async () => {
    /** 中文说明：测试局部值 { ctx, root }，由紧邻初始化决定。 */
    const { ctx, root } = await harness()
    /** 中文说明：测试局部值 originalTurn，由紧邻初始化决定。 */
    const originalTurn = openTurn(root, { kind: 'user' })
    /** 中文说明：测试局部值 created，由紧邻初始化决定。 */
    const created = ctx.goals.create(root.agent, { objective: 'resume the fork' })
    closeTurn(root, originalTurn)
    /** 中文说明：测试局部值 forkId，由紧邻初始化决定。 */
    const forkId = SessionId('goal-tool-resumed-fork')
    /** 中文说明：测试局部值 forkSession，由紧邻初始化决定。 */
    const forkSession = Session.create(forkId, root.session.events, {
      version: SESSION_FORMAT_VERSION,
      id: forkId,
      createdAt: Date.now(),
      parentSession: root.session.id,
      seedLength: root.session.seq,
    })
    /** 中文说明：测试局部值 fork，由紧邻初始化决定。 */
    const fork = stubAgent(forkId, forkSession)
    ctx.agents.register(fork.agent)
    expect(ctx.goals.get(fork.agent)).toMatchObject({ id: created.id, activation: 'disarmed' })

    openTurn(fork, { kind: 'user' }, '继续这个目标')
    /** 中文说明：测试局部值 resumed，由紧邻初始化决定。 */
    const resumed = await execute(ctx, 'update_goal', {
      goal_id: created.id, revision: created.revision, action: 'resume',
    }, fork.agent)
    expect(resultGoal(resumed)).toMatchObject({ id: created.id, revision: 2, phase: 'active' })
  })

  it('rejects calls before a turn and after its end boundary', async () => {
    /** 中文说明：测试局部值 { ctx, root }，由紧邻初始化决定。 */
    const { ctx, root } = await harness()
    /** 中文说明：测试局部值 before，由紧邻初始化决定。 */
    const before = await execute(ctx, 'get_goal', {}, root.agent)
    expect(before.error?.info?.code).toBe('GOAL_TOOL_DRIVER_REQUIRED')

    /** 中文说明：测试局部值 turn，由紧邻初始化决定。 */
    const turn = openTurn(root, { kind: 'user' })
    closeTurn(root, turn)
    /** 中文说明：测试局部值 after，由紧邻初始化决定。 */
    const after = await execute(ctx, 'get_goal', {}, root.agent)
    expect(after.error?.info?.code).toBe('GOAL_TOOL_DRIVER_REQUIRED')
  })

  it('rejects terminal reporting without human input or a current goal round', async () => {
    /** 中文说明：测试局部值 { ctx, root }，由紧邻初始化决定。 */
    const { ctx, root } = await harness()
    openTurn(root, { kind: 'plugin', plugin: 'test' })
    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await execute(ctx, 'update_goal', {
      goal_id: 'goal-missing', revision: 1, action: 'complete',
    }, root.agent)
    expect(result.error?.info?.code).toBe('GOAL_TOOL_AUTHORITY_REQUIRED')
    /** 中文说明：测试局部值 malformed，由紧邻初始化决定。 */
    const malformed = await execute(ctx, 'update_goal', {
      goal_id: 'goal-missing', revision: 1, action: 'pause', objective: 'probe',
    }, root.agent)
    expect(malformed.error?.info?.code).toBe('GOAL_TOOL_AUTHORITY_REQUIRED')
  })

  it('accepts direct human steering in a goal-sourced root turn', async () => {
    /** 中文说明：测试局部值 { ctx, root }，由紧邻初始化决定。 */
    const { ctx, root } = await harness()
    /** 中文说明：测试局部值 humanTurn，由紧邻初始化决定。 */
    const humanTurn = openTurn(root, { kind: 'user' })
    /** 中文说明：测试局部值 created，由紧邻初始化决定。 */
    const created = ctx.goals.create(root.agent, { objective: 'steer me' })
    closeTurn(root, humanTurn)
    openTurn(root, {
      kind: 'goal', goalId: created.id, revision: created.revision, round: 1,
    })
    root.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'pause now' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    /** 中文说明：测试局部值 paused，由紧邻初始化决定。 */
    const paused = await execute(ctx, 'update_goal', {
      goal_id: created.id, revision: created.revision, action: 'pause',
    }, root.agent)
    expect(resultGoal(paused)).toMatchObject({ phase: 'paused', revision: 2 })
  })

  it('rejects an initiator different from exec.agent', async () => {
    /** 中文说明：测试局部值 { ctx, root }，由紧邻初始化决定。 */
    const { ctx, root } = await harness()
    /** 中文说明：测试局部值 other，由紧邻初始化决定。 */
    const other = stubAgent('goal-tool-other')
    ctx.agents.register(other.agent)
    openTurn(other, { kind: 'user' })
    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await execute(ctx, 'get_goal', {}, other.agent, root.agent)
    expect(result.error?.info?.code).toBe('GOAL_TOOL_DRIVER_REQUIRED')
  })
})

describe('goal tool state transitions', () => {
  it('reads null, then edits, pauses, and resumes by exact revision in one human turn', async () => {
    /** 中文说明：测试局部值 { ctx, root }，由紧邻初始化决定。 */
    const { ctx, root } = await harness()
    openTurn(root, { kind: 'user' })
    expect(resultJson(await execute(ctx, 'get_goal', {}, root.agent))).toEqual({ goal: null })
    /** 中文说明：测试局部值 goal，由紧邻初始化决定。 */
    let goal = resultGoal(await execute(ctx, 'create_goal', { objective: 'old' }, root.agent))
    goal = resultGoal(await execute(ctx, 'update_goal', {
      goal_id: goal['id'], revision: goal['revision'], action: 'edit',
      objective: 'new', max_goal_rounds: 8,
    }, root.agent))
    expect(goal).toMatchObject({ objective: 'new', revision: 2, maxGoalRounds: 8 })
    goal = resultGoal(await execute(ctx, 'update_goal', {
      goal_id: goal['id'], revision: goal['revision'], action: 'pause',
    }, root.agent))
    expect(goal).toMatchObject({ phase: 'paused', revision: 3 })
    goal = resultGoal(await execute(ctx, 'update_goal', {
      goal_id: goal['id'], revision: goal['revision'], action: 'resume',
    }, root.agent))
    expect(goal).toMatchObject({ phase: 'active', revision: 4 })
  })

  it('injects one wrap-up instruction for an autonomous completion but leaves a human pause interactive', async () => {
    /** 中文说明：测试局部值 { ctx, root }，由紧邻初始化决定。 */
    const { ctx, root } = await harness()
    /** 中文说明：测试局部值 humanTurn，由紧邻初始化决定。 */
    const humanTurn = openTurn(root, { kind: 'user' })
    /** 中文说明：测试局部值 created，由紧邻初始化决定。 */
    const created = ctx.goals.create(root.agent, { objective: 'pause cleanly' })
    /** 中文说明：测试局部值 paused，由紧邻初始化决定。 */
    const paused = await execute(ctx, 'update_goal', {
      goal_id: created.id, revision: created.revision, action: 'pause',
    }, root.agent)
    expect(resultGoal(paused)).toMatchObject({ phase: 'paused' })
    expect(paused.concludesTurn).toBeUndefined()
    expect(paused.additionalContexts).toBeUndefined()
    /** 中文说明：测试局部值 resumed，由紧邻初始化决定。 */
    const resumed = resultGoal(await execute(ctx, 'update_goal', {
      goal_id: created.id, revision: 2, action: 'resume',
    }, root.agent))
    closeTurn(root, humanTurn)

    openTurn(root, {
      kind: 'goal', goalId: created.id, revision: resumed['revision'] as number, round: 1,
    })
    /** 中文说明：测试局部值 complete，由紧邻初始化决定。 */
    const complete = await execute(ctx, 'update_goal', {
      goal_id: created.id, revision: resumed['revision'], action: 'complete',
    }, root.agent)
    expect(resultGoal(complete)).toMatchObject({ phase: 'complete' })
    expect(complete.concludesTurn).toBeUndefined()
    /** 中文说明：测试局部值 contexts，由紧邻初始化决定。 */
    const contexts = complete.additionalContexts ?? []
    expect(contexts).toHaveLength(1)
    expect(contexts[0]?.source).toEqual({
      kind: 'plugin',
      plugin: 'tool-goal',
      form: 'notice',
      summary: 'complete: pause cleanly',
    })
    /** 中文说明：测试局部值 block，由紧邻初始化决定。 */
    const block = contexts[0]?.content[0]
    if (block?.type !== 'text') throw new Error('expected one text wrap-up block')
    expect(block.text).toContain('<goal_complete>')
    expect(block.text).toContain('"pause cleanly"')
    expect(block.text).toContain("Do not call any more tools in this run; further work waits for the user's next instruction.")
  })

  it('completes without a wrap-up instruction under direct human authority', async () => {
    /** 中文说明：测试局部值 { ctx, root }，由紧邻初始化决定。 */
    const { ctx, root } = await harness()
    openTurn(root, { kind: 'user' })
    /** 中文说明：测试局部值 created，由紧邻初始化决定。 */
    const created = ctx.goals.create(root.agent, { objective: 'finish now' })
    /** 中文说明：测试局部值 complete，由紧邻初始化决定。 */
    const complete = await execute(ctx, 'update_goal', {
      goal_id: created.id, revision: created.revision, action: 'complete',
    }, root.agent)
    expect(resultGoal(complete)).toMatchObject({ phase: 'complete' })
    expect(complete.concludesTurn).toBeUndefined()
    expect(complete.additionalContexts).toBeUndefined()
  })

  it('rearms a restored active goal only after a new direct human prompt', async () => {
    /** 中文说明：测试局部值 { ctx, root }，由紧邻初始化决定。 */
    const { ctx, root } = await harness()
    /** 中文说明：测试局部值 turn，由紧邻初始化决定。 */
    let turn = openTurn(root, { kind: 'user' })
    /** 中文说明：测试局部值 created，由紧邻初始化决定。 */
    const created = ctx.goals.create(root.agent, { objective: 'continue later' })
    closeTurn(root, turn)
    agentEvents(ctx, root.agent).emit('agent/session-start', { source: 'resume' })
    expect(ctx.goals.get(root.agent)?.activation).toBe('disarmed')
    turn = openTurn(root, { kind: 'user' }, '继续')
    /** 中文说明：测试局部值 resumed，由紧邻初始化决定。 */
    const resumed = await execute(ctx, 'update_goal', {
      goal_id: created.id, revision: created.revision, action: 'resume',
    }, root.agent)
    expect(resultGoal(resumed)).toMatchObject({ phase: 'active', revision: 2 })
    expect(resultJson(resumed)['activation']).toBe('armed')
    closeTurn(root, turn)
  })

  it('returns structured domain and conditional-argument failures', async () => {
    /** 中文说明：测试局部值 { ctx, root }，由紧邻初始化决定。 */
    const { ctx, root } = await harness()
    openTurn(root, { kind: 'user' })
    /** 中文说明：测试局部值 invalidCreate，由紧邻初始化决定。 */
    const invalidCreate = await execute(ctx, 'create_goal', { objective: ' ' }, root.agent)
    expect(invalidCreate.error?.info?.code).toBe('GOAL_INVALID_OBJECTIVE')
    /** 中文说明：测试局部值 created，由紧邻初始化决定。 */
    const created = ctx.goals.create(root.agent, { objective: 'valid' })
    /** 中文说明：测试局部值 replacement，由紧邻初始化决定。 */
    const replacement = await execute(ctx, 'update_goal', {
      goal_id: created.id,
      revision: created.revision,
      action: 'pause',
      objective: 'not valid for pause',
    }, root.agent)
    expect(replacement.error?.info?.code).toBe('GOAL_TOOL_INVALID_UPDATE')
    /** 中文说明：测试局部值 terminalUpdate，由紧邻初始化决定。 */
    const terminalUpdate = await execute(ctx, 'update_goal', {
      goal_id: created.id,
      revision: created.revision,
      action: 'complete',
      max_goal_rounds: 2,
    }, root.agent)
    expect(terminalUpdate.error?.info?.code).toBe('GOAL_TOOL_INVALID_UPDATE')
    /** 中文说明：测试局部值 blockedWithoutReason，由紧邻初始化决定。 */
    const blockedWithoutReason = await execute(ctx, 'update_goal', {
      goal_id: created.id, revision: created.revision, action: 'blocked',
    }, root.agent)
    expect(blockedWithoutReason.error?.info?.code).toBe('GOAL_TOOL_INVALID_UPDATE')
    /** 中文说明：测试局部值 blockedWithEmptyReason，由紧邻初始化决定。 */
    const blockedWithEmptyReason = await execute(ctx, 'update_goal', {
      goal_id: created.id, revision: created.revision, action: 'blocked', blocked_reason: ' ',
    }, root.agent)
    expect(blockedWithEmptyReason.error?.info?.code).toBe('GOAL_TOOL_INVALID_UPDATE')
    /** 中文说明：测试局部值 completeWithReason，由紧邻初始化决定。 */
    const completeWithReason = await execute(ctx, 'update_goal', {
      goal_id: created.id, revision: created.revision, action: 'complete', blocked_reason: 'Not a blocker.',
    }, root.agent)
    expect(completeWithReason.error?.info?.code).toBe('GOAL_TOOL_INVALID_UPDATE')
    /** 中文说明：测试局部值 editWithReason，由紧邻初始化决定。 */
    const editWithReason = await execute(ctx, 'update_goal', {
      goal_id: created.id,
      revision: created.revision,
      action: 'edit',
      objective: 'still valid',
      blocked_reason: 'Not valid for edit.',
    }, root.agent)
    expect(editWithReason.error?.info?.code).toBe('GOAL_TOOL_INVALID_UPDATE')
    /** 中文说明：测试局部值 malformedRef，由紧邻初始化决定。 */
    const malformedRef = await execute(ctx, 'update_goal', {
      goal_id: '', revision: 0, action: 'edit', objective: 'x',
    }, root.agent)
    expect(malformedRef.error?.info?.code).toBe('GOAL_TOOL_INVALID_UPDATE')
  })

  it('accepts only empty fillers in fields unused by the selected action', async () => {
    /** 中文说明：测试局部值 { ctx, root }，由紧邻初始化决定。 */
    const { ctx, root } = await harness()
    openTurn(root, { kind: 'user' })
    /** 中文说明：测试局部值 goal，由紧邻初始化决定。 */
    let goal = ctx.goals.create(root.agent, { objective: 'valid' })

    /** 中文说明：测试局部值 edited，由紧邻初始化决定。 */
    const edited = await execute(ctx, 'update_goal', {
      goal_id: goal.id,
      revision: goal.revision,
      action: 'edit',
      objective: 'edited',
      max_goal_rounds: 0,
      blocked_reason: '',
    }, root.agent)
    expect(resultGoal(edited)).toMatchObject({ objective: 'edited' })
    goal = ctx.goals.get(root.agent)!

    /** 中文说明：测试局部值 capped，由紧邻初始化决定。 */
    const capped = await execute(ctx, 'update_goal', {
      goal_id: goal.id,
      revision: goal.revision,
      action: 'edit',
      objective: '',
      max_goal_rounds: 8,
      blocked_reason: '',
    }, root.agent)
    expect(resultGoal(capped)).toMatchObject({ objective: 'edited', maxGoalRounds: 8 })
    goal = ctx.goals.get(root.agent)!

    /** 中文说明：测试局部值 paused，由紧邻初始化决定。 */
    const paused = await execute(ctx, 'update_goal', {
      goal_id: goal.id,
      revision: goal.revision,
      action: 'pause',
      objective: '',
      max_goal_rounds: 0,
      blocked_reason: '',
    }, root.agent)
    expect(resultGoal(paused)).toMatchObject({ phase: 'paused', objective: 'edited' })
    goal = ctx.goals.get(root.agent)!

    /** 中文说明：测试局部值 resumed，由紧邻初始化决定。 */
    const resumed = await execute(ctx, 'update_goal', {
      goal_id: goal.id,
      revision: goal.revision,
      action: 'resume',
      objective: '',
      max_goal_rounds: 0,
      blocked_reason: '',
    }, root.agent)
    expect(resultGoal(resumed)).toMatchObject({ phase: 'active', objective: 'edited' })
    goal = ctx.goals.get(root.agent)!

    /** 中文说明：测试局部值 blocked，由紧邻初始化决定。 */
    const blocked = await execute(ctx, 'update_goal', {
      goal_id: goal.id,
      revision: goal.revision,
      action: 'blocked',
      objective: '',
      max_goal_rounds: 0,
      blocked_reason: 'actual blocker',
    }, root.agent)
    expect(resultGoal(blocked)).toMatchObject({ phase: 'blocked' })
    goal = ctx.goals.resume(root.agent, { id: goal.id, revision: goal.revision + 1 })

    /** 中文说明：测试局部值 complete，由紧邻初始化决定。 */
    const complete = await execute(ctx, 'update_goal', {
      goal_id: goal.id,
      revision: goal.revision,
      action: 'complete',
      objective: '',
      max_goal_rounds: 0,
      blocked_reason: '',
    }, root.agent)
    expect(resultGoal(complete)).toMatchObject({ phase: 'complete', objective: 'edited' })
  })

  it('allows exact goal rounds to complete but not edit or pause', async () => {
    /** 中文说明：测试局部值 { ctx, root }，由紧邻初始化决定。 */
    const { ctx, root } = await harness()
    /** 中文说明：测试局部值 humanTurn，由紧邻初始化决定。 */
    const humanTurn = openTurn(root, { kind: 'user' })
    /** 中文说明：测试局部值 created，由紧邻初始化决定。 */
    const created = ctx.goals.create(root.agent, { objective: 'round-owned' })
    closeTurn(root, humanTurn)
    openTurn(root, { kind: 'goal', goalId: created.id, revision: created.revision, round: 1 })
    /** 中文说明：测试局部值 edit，由紧邻初始化决定。 */
    const edit = await execute(ctx, 'update_goal', {
      goal_id: created.id, revision: created.revision, action: 'edit', objective: 'forbidden',
    }, root.agent)
    expect(edit.error?.info?.code).toBe('GOAL_TOOL_AUTHORITY_REQUIRED')
    /** 中文说明：测试局部值 complete，由紧邻初始化决定。 */
    const complete = await execute(ctx, 'update_goal', {
      goal_id: created.id, revision: created.revision, action: 'complete',
    }, root.agent)
    expect(resultGoal(complete)).toMatchObject({ phase: 'complete', revision: 2, roundsStarted: 1 })
  })

  it('enforces the configured model self-block lower bound across admitted rounds', async () => {
    /** 中文说明：测试局部值 { ctx, root }，由紧邻初始化决定。 */
    const { ctx, root } = await harness({ blockedAfterConsecutiveRounds: 3 })
    /** 中文说明：测试局部值 turn，由紧邻初始化决定。 */
    let turn = openTurn(root, { kind: 'user' })
    /** 中文说明：测试局部值 created，由紧邻初始化决定。 */
    const created = ctx.goals.create(root.agent, { objective: 'blocked eventually' })
    closeTurn(root, turn)
    /** 中文说明：测试局部值 ref，由紧邻初始化决定。 */
    const ref: GoalRef = { id: GoalId(created.id), revision: created.revision }

    /** 中文说明：测试局部值 round，由紧邻初始化决定。 */
    for (let round = 1; round <= 2; round += 1) {
      turn = openTurn(root, { kind: 'goal', goalId: ref.id, revision: ref.revision, round })
      /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
      const result = await execute(ctx, 'update_goal', {
        goal_id: ref.id,
        revision: ref.revision,
        action: 'blocked',
        blocked_reason: 'The required credential is still unavailable.',
      }, root.agent)
      expect(result.error?.info?.code).toBe('GOAL_TOOL_BLOCK_THRESHOLD')
      closeTurn(root, turn)
    }
    openTurn(root, { kind: 'goal', goalId: ref.id, revision: ref.revision, round: 3 })
    /** 中文说明：测试局部值 blocked，由紧邻初始化决定。 */
    const blocked = await execute(ctx, 'update_goal', {
      goal_id: ref.id,
      revision: ref.revision,
      action: 'blocked',
      blocked_reason: 'The required credential is still unavailable.',
    }, root.agent)
    expect(resultGoal(blocked)).toMatchObject({
      phase: 'blocked',
      blockedReason: { code: 'model-reported', message: 'The required credential is still unavailable.' },
      roundsStarted: 3,
    })
    expect(blocked.concludesTurn).toBeUndefined()
    /** 中文说明：测试局部值 contexts，由紧邻初始化决定。 */
    const contexts = blocked.additionalContexts ?? []
    expect(contexts).toHaveLength(1)
    /** 中文说明：测试局部值 block，由紧邻初始化决定。 */
    const block = contexts[0]?.content[0]
    if (block?.type !== 'text') throw new Error('expected one text wrap-up block')
    expect(block.text).toContain('<goal_blocked>')
    expect(block.text).toContain('The required credential is still unavailable.')
    expect(block.text).toContain("Do not call any more tools in this run; further work waits for the user's next instruction.")
  })

  it('lets direct human authority block before the model threshold', async () => {
    /** 中文说明：测试局部值 { ctx, root }，由紧邻初始化决定。 */
    const { ctx, root } = await harness({ blockedAfterConsecutiveRounds: 9 })
    openTurn(root, { kind: 'user' })
    /** 中文说明：测试局部值 created，由紧邻初始化决定。 */
    const created = ctx.goals.create(root.agent, { objective: 'human stop' })
    /** 中文说明：测试局部值 blocked，由紧邻初始化决定。 */
    const blocked = await execute(ctx, 'update_goal', {
      goal_id: created.id,
      revision: created.revision,
      action: 'blocked',
      blocked_reason: 'The user asked to stop until a prerequisite is available.',
    }, root.agent)
    expect(resultGoal(blocked)).toMatchObject({
      phase: 'blocked',
      blockedReason: {
        code: 'model-reported',
        message: 'The user asked to stop until a prerequisite is available.',
      },
      roundsStarted: 0,
    })
    expect(blocked.concludesTurn).toBeUndefined()
    expect(blocked.additionalContexts).toBeUndefined()
  })
})
