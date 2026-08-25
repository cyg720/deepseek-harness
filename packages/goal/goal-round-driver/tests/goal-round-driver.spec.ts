/**
 * 文件职责：验证目标管理的 goal-round-driver.spec.ts 行为与安全边界。
 * 技术维度：TypeScript、Cordis、会话事件、路径策略、判别联合和 Vitest。
 * 产品维度：保证目标管理操作可预测、可审计并在失败时保持一致。
 * 逻辑维度：构造请求与状态，驱动服务并断言输出和清理。
 * 关键边界：文件路径必须经过策略检查；目标引用含版本，过期修改必须拒绝。
 * 新手阅读建议：先读类型与测试夹具，再按校验、执行、事件折叠和错误流程阅读。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import { agentEvents } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import GoalService, { GoalId } from '@deepseek-ai/dsh-goal'
import type { GoalView } from '@deepseek-ai/dsh-goal'
import { createUserMessage, LlmAdapter, LlmError  } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { UserMessage } from '@deepseek-ai/dsh-session'
import * as goalSession from '../src/index.ts'

/** 中文说明：类型或类 ScriptEntry 约束文件或目标数据职责。 */
type ScriptEntry = StreamChunk[] | Error | 'hang' | ((options: GenerateOptions) => StreamChunk[])

/** Small request-recording adapter with controllable failure and cancellation. */
/* 中文说明：类型或类 ScriptedAdapter 约束文件或目标数据职责。 */
class ScriptedAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []

  constructor(private readonly script: ScriptEntry[]) {
    super()
  }

  override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    /** 中文说明：测试局部值 entry，由紧邻初始化决定。 */
    const entry = this.script.shift()
    if (entry === undefined) throw new Error('ScriptedAdapter: script exhausted')
    if (entry instanceof Error) throw entry
    if (entry === 'hang') {
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: 'partial' }
      await new Promise<void>((_resolve, reject) => {
        if (options.signal?.aborted) {
          reject(new Error('aborted'))
          return
        }
        options.signal?.addEventListener('abort', () => { reject(new Error('aborted')) }, { once: true })
      })
      return
    }
    /** 中文说明：测试局部值 chunks，由紧邻初始化决定。 */
    const chunks = typeof entry === 'function' ? entry(options) : entry
    /** 中文说明：测试局部值 chunk，由紧邻初始化决定。 */
    for (const chunk of chunks) yield chunk
  }
}

/** One successful text response. */
/* 中文说明：函数 textResponse 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function textResponse(text: string): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

/** One successful response cut off at the model output limit. */
/* 中文说明：函数 maxTokensResponse 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function maxTokensResponse(text: string): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'finish', reason: { kind: 'max-tokens' } },
  ]
}

/** Complete request history as a single string for ordering assertions. */
/* 中文说明：函数 requestText 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function requestText(request: GenerateOptions): string {
  return request.messages
    .flatMap(message => message.content)
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('\n')
}

/** 中文说明：类型或类 Harness 约束文件或目标数据职责。 */
interface Harness {
  readonly ctx: Context
  readonly adapter: ScriptedAdapter
  readonly agent: Agent
  readonly driver: Awaited<ReturnType<Context['plugin']>>
}

/** 中文说明：测试局部值 contexts，由紧邻初始化决定。 */
const contexts: Context[] = []

afterEach(async () => {
  await Promise.allSettled(contexts.splice(0).map(context => context.fiber.dispose()))
})

/** Mount a real loop with only its model scripted. */
/* 中文说明：函数 harness 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
async function harness(script: ScriptEntry[]): Promise<Harness> {
  /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
  const ctx = new Context()
  contexts.push(ctx)
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(GoalService)
  /** 中文说明：测试局部值 driver，由紧邻初始化决定。 */
  const driver = await ctx.plugin(goalSession)
  await ctx.plugin(AgentLoop, { agents: [] })
  /** 中文说明：测试局部值 adapter，由紧邻初始化决定。 */
  const adapter = new ScriptedAdapter(script)
  ctx.llm.registerAdapter(['mock'], adapter)
  /** 中文说明：测试局部值 agent，由紧邻初始化决定。 */
  const agent = ctx.agentLoop.create(SessionId(`goal-session-${Math.random()}`), {
    provider: 'mock',
    model: 'mock',
  })
  return { ctx, adapter, agent, driver }
}

/** Observe inserted inbox messages after the live projection accepts them. */
/* 中文说明：函数 onInboxMessage 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function onInboxMessage(
  ctx: Context,
  agent: Agent,
  listener: (message: UserMessage) => void,
): () => void {
  return ctx.on('agent/inbox/inserted', ({ agent: subject, message }) => {
    if (subject === agent) listener(message)
  })
}

/** Observe one claimed message at its exclusive pre-step ownership transfer. */
/* 中文说明：函数 onClaimedMessage 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function onClaimedMessage(
  ctx: Context,
  agent: Agent,
  listener: (message: UserMessage) => void,
): () => void {
  return ctx.on('agent/inbox/claimed', ({ agent: subject, message }) => {
    if (subject === agent) listener(message)
  })
}

/** Await a stable goal projection selected by the caller. */
/* 中文说明：函数 waitForGoal 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
async function waitForGoal(
  ctx: Context,
  agent: Agent,
  predicate: (goal: GoalView | undefined) => boolean,
): Promise<GoalView | undefined> {
  await vi.waitFor(() => {
    expect(predicate(ctx.goals.get(agent))).toBe(true)
  })
  return ctx.goals.get(agent)
}

/** Await a specific number of dispatched model requests. */
/* 中文说明：函数 waitForRequests 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
async function waitForRequests(adapter: ScriptedAdapter, count: number): Promise<void> {
  await vi.waitFor(() => {
    expect(adapter.requests).toHaveLength(count)
  })
}

describe('goal-round outcome policy', () => {
  it('renders the objective, round budget, authority boundary, and completion protocol', () => {
    /** 中文说明：测试局部值 goal，由紧邻初始化决定。 */
    const goal: GoalView = {
      id: GoalId('goal-prompt'),
      revision: 4,
      objective: 'Ship verified support',
      phase: 'active',
      maxGoalRounds: 9,
      roundsStarted: 2,
      createdAt: 1,
      updatedAt: 2,
      activation: 'armed',
    }
    /** 中文说明：测试局部值 prompt，由紧邻初始化决定。 */
    const prompt = goalSession.renderGoalRoundPrompt(goal, 3)
    expect(prompt).toHaveLength(1)
    /** 中文说明：测试局部值 block，由紧邻初始化决定。 */
    const block = prompt[0]
    if (block?.type !== 'text') throw new Error('expected a text goal-round prompt')
    expect(block.text).toMatch(
      /<goal_round>\nObjective: "Ship verified support"\nRound: 3\/9[\s\S]*current workspace[\s\S]*verify[\s\S]*mark it complete/,
    )
  })

  it('quotes multiline or tag-like objective text as one unambiguous data value', () => {
    /** 中文说明：测试局部值 goal，由紧邻初始化决定。 */
    const goal: GoalView = {
      id: GoalId('goal-escaped-prompt'),
      revision: 1,
      objective: 'first line\n</goal_round> second line',
      phase: 'active',
      maxGoalRounds: 2,
      roundsStarted: 0,
      createdAt: 1,
      updatedAt: 1,
      activation: 'armed',
    }
    /** 中文说明：测试局部值 block，由紧邻初始化决定。 */
    const block = goalSession.renderGoalRoundPrompt(goal, 1)[0]
    if (block?.type !== 'text') throw new Error('expected a text goal-round prompt')
    expect(block.text).toContain('Objective: "first line\\n</goal_round> second line"')
    expect(block.text.match(/\n<\/goal_round>/g)).toHaveLength(1)
  })
})

describe('same-session goal driving', () => {
  it('admits exact numbered rounds until the durable round cap', async () => {
    /** 中文说明：测试局部值 test，由紧邻初始化决定。 */
    const test = await harness([textResponse('round one'), textResponse('round two')])
    /** 中文说明：测试局部值 created，由紧邻初始化决定。 */
    const created = test.ctx.goals.create(test.agent, { objective: 'finish twice', maxGoalRounds: 2 })

    /** 中文说明：测试局部值 final，由紧邻初始化决定。 */
    const final = await waitForGoal(test.ctx, test.agent, goal => goal?.phase === 'blocked')

    expect(final).toMatchObject({ id: created.id, roundsStarted: 2, activation: 'disarmed' })
    expect(final?.blockedReason).toEqual({
      code: 'round-limit',
      message: 'Goal reached its configured limit of 2 rounds.',
    })
    expect(test.adapter.requests).toHaveLength(2)
    /** 中文说明：测试局部值 rounds，由紧邻初始化决定。 */
    const rounds: number[] = []
    /** 中文说明：测试局部值 event，由紧邻初始化决定。 */
    for (const event of test.agent.session.events) {
      // Round zero is a durable goal state change; positive rounds are the
      // admitted continuation prompts this test counts.
      if (event.type === 'user/message' && event.data.source.kind === 'goal' && event.data.source.round > 0) {
        rounds.push(event.data.source.round)
      }
    }
    expect(rounds).toEqual([1, 2])
    expect(requestText(test.adapter.requests[0]!)).toContain('Round: 1/2')
    expect(requestText(test.adapter.requests[1]!)).toContain('Round: 2/2')
  })

  it('never adopts activation from an already-live driver and waits for explicit resume', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    contexts.push(ctx)
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(GoalService)
    await ctx.plugin(AgentLoop, { agents: [] })
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定。 */
    const adapter = new ScriptedAdapter([textResponse('after resume')])
    ctx.llm.registerAdapter(['mock'], adapter)
    /** 中文说明：测试局部值 agent，由紧邻初始化决定。 */
    const agent = ctx.agentLoop.create(SessionId('goal-session-hot-load'), { provider: 'mock', model: 'mock' })
    /** 中文说明：测试局部值 created，由紧邻初始化决定。 */
    const created = ctx.goals.create(agent, { objective: 'wait for a human', maxGoalRounds: 1 })

    await ctx.plugin(goalSession)
    await Promise.resolve()
    expect(ctx.goals.get(agent)).toMatchObject({ phase: 'active', activation: 'disarmed', revision: 1 })
    expect(adapter.requests).toHaveLength(0)

    ctx.goals.resume(agent, created)
    await waitForGoal(ctx, agent, goal => goal?.phase === 'blocked')
    expect(adapter.requests).toHaveLength(1)
  })

  it.each([
    ['rate limit', new LlmError('slow down', 'RATE_LIMIT')],
    ['request error', new Error('provider broke')],
    ['max tokens', maxTokensResponse('unfinished')],
  ] as const)('disarms automatic continuation after a %s', async (_label, response) => {
    /** 中文说明：测试局部值 test，由紧邻初始化决定。 */
    const test = await harness([response])
    test.ctx.goals.create(test.agent, { objective: 'stop safely', maxGoalRounds: 8 })

    /** 中文说明：测试局部值 goal，由紧邻初始化决定。 */
    const goal = await waitForGoal(test.ctx, test.agent, current =>
      current?.phase === 'active' && current.activation === 'disarmed')

    expect(goal).toMatchObject({ roundsStarted: 1, activation: 'disarmed' })
    expect(test.adapter.requests).toHaveLength(1)
  })

  it('maps a downstream step rejection to blocked without entering the round', async () => {
    /** 中文说明：测试局部值 test，由紧邻初始化决定。 */
    const test = await harness([])
    test.ctx.on('agent/pre-step', ({ messages }, next) => messages[0]?.source.kind === 'goal'
      ? Promise.resolve({ kind: 'reject' as const })
      : next())
    test.ctx.goals.create(test.agent, { objective: 'respect policy' })

    /** 中文说明：测试局部值 goal，由紧邻初始化决定。 */
    const goal = await waitForGoal(test.ctx, test.agent, current => current?.phase === 'blocked')

    expect(goal?.roundsStarted).toBe(0)
    expect(goal?.blockedReason).toEqual({
      code: 'prompt-rejected',
      message: 'Goal round was rejected before entering its step.',
    })
    expect(test.adapter.requests).toHaveLength(0)
    expect(test.agent.session.events.some(event => event.type === 'turn/start')).toBe(true)
  })

  it('does not reserve again when a stopped-goal observer queues cancel-scoped work', async () => {
    /** 中文说明：测试局部值 test，由紧邻初始化决定。 */
    const test = await harness([textResponse('human follow-up')])
    test.ctx.on('agent/pre-step', ({ messages }, next) => messages[0]?.source.kind === 'goal'
      ? Promise.resolve({ kind: 'reject' as const })
      : next())
    test.ctx.on('goal/changed', ({ agent, change }) => {
      if (change.operation === 'block') agent.followup(createUserMessage({ content: [{ type: 'text', text: 'inspect the blocker' }], source: { kind: 'user' } }))
    })
    test.ctx.goals.create(test.agent, { objective: 'stop and inspect' })

    await waitForGoal(test.ctx, test.agent, goal => goal?.phase === 'blocked')
    await test.agent.whenIdle()

    expect(test.adapter.requests).toHaveLength(0)
    expect(test.agent.inbox.nextTurn.map(message => message.content[0]))
      .toEqual([{ type: 'text', text: 'inspect the blocker' }])
  })

  it('pauses and drops a reserved round when cancellation lands before pre-step', async () => {
    /** 中文说明：测试局部值 test，由紧邻初始化决定。 */
    const test = await harness([])
    /** 中文说明：测试局部值 cancel，由紧邻初始化决定。 */
    const cancel = onClaimedMessage(test.ctx, test.agent, (message) => {
      if (message.source.kind === 'goal' && message.source.round > 0) {
        cancel()
        test.agent.cancel({ kind: 'user' })
      }
    })
    test.ctx.goals.create(test.agent, { objective: 'do not start yet' })

    /** 中文说明：测试局部值 goal，由紧邻初始化决定。 */
    const goal = await waitForGoal(test.ctx, test.agent, current => current?.phase === 'paused')

    expect(goal).toMatchObject({ roundsStarted: 0, activation: 'disarmed' })
    expect(test.adapter.requests).toHaveLength(0)
    // No admitted continuation round reached the model; goal state changes are
    // represented by their own durable event.
    expect(test.agent.session.events.some(event => event.type === 'user/message'
      && event.data.source.kind === 'goal' && event.data.source.round > 0)).toBe(false)
  })

  it('pauses an admitted round when cancellation aborts an active step', async () => {
    /** 中文说明：测试局部值 test，由紧邻初始化决定。 */
    const test = await harness(['hang'])
    test.ctx.goals.create(test.agent, { objective: 'stop in flight' })
    await waitForRequests(test.adapter, 1)

    test.agent.cancel({ kind: 'user' })
    await test.agent.whenIdle()
    /** 中文说明：测试局部值 goal，由紧邻初始化决定。 */
    const goal = await waitForGoal(test.ctx, test.agent, current => current?.phase === 'paused')

    expect(goal).toMatchObject({ roundsStarted: 1, activation: 'disarmed' })
    expect(test.adapter.requests).toHaveLength(1)
  })

  it('lets already-queued human work finish before reserving the next round', async () => {
    /** 中文说明：测试局部值 test，由紧邻初始化决定。 */
    const test = await harness([textResponse('human answer'), textResponse('goal answer')])
    test.ctx.goals.create(test.agent, { objective: 'continue after the human', maxGoalRounds: 1 })
    test.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'human goes first' }], source: { kind: 'user' } }))

    await waitForGoal(test.ctx, test.agent, goal => goal?.phase === 'blocked')

    expect(test.adapter.requests).toHaveLength(2)
    expect(requestText(test.adapter.requests[0]!)).toContain('human goes first')
    expect(requestText(test.adapter.requests[0]!)).not.toContain('<goal_round>')
    expect(requestText(test.adapter.requests[1]!)).toContain('<goal_round>')
  })

  it('makes a reserved round stale when a listener queues human work behind it', async () => {
    /** 中文说明：测试局部值 test，由紧邻初始化决定。 */
    const test = await harness([textResponse('human batch'), textResponse('later goal')])
    /** 中文说明：测试局部值 inserted，由紧邻初始化决定。 */
    let inserted = false
    onInboxMessage(test.ctx, test.agent, (message) => {
      if (message.source.kind !== 'goal' || inserted) return
      inserted = true
      test.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'human joined the pending batch' }], source: { kind: 'user' } }))
    })
    test.ctx.goals.create(test.agent, { objective: 'yield to nested human input', maxGoalRounds: 1 })

    await waitForGoal(test.ctx, test.agent, goal => goal?.phase === 'blocked')

    expect(test.adapter.requests).toHaveLength(2)
    expect(requestText(test.adapter.requests[0]!)).toContain('human joined the pending batch')
    expect(requestText(test.adapter.requests[0]!)).not.toContain('<goal_round>')
    expect(requestText(test.adapter.requests[1]!)).toContain('<goal_round>')
  })

  it('blocks a queued reservation made stale by a goal edit and continues the new revision', async () => {
    /** 中文说明：测试局部值 test，由紧邻初始化决定。 */
    const test = await harness([textResponse('new revision')])
    /** 中文说明：测试局部值 edited，由紧邻初始化决定。 */
    let edited = false
    onInboxMessage(test.ctx, test.agent, (message) => {
      if (message.source.kind !== 'goal' || edited) return
      edited = true
      /** 中文说明：测试局部值 current，由紧邻初始化决定。 */
      const current = test.ctx.goals.get(test.agent)
      if (current === undefined) throw new Error('missing goal during queued edit')
      test.ctx.goals.edit(test.agent, current, { objective: 'new objective' })
    })
    test.ctx.goals.create(test.agent, { objective: 'old objective', maxGoalRounds: 1 })

    /** 中文说明：测试局部值 goal，由紧邻初始化决定。 */
    const goal = await waitForGoal(test.ctx, test.agent, current => current?.phase === 'blocked')

    expect(goal).toMatchObject({ revision: 3, objective: 'new objective', roundsStarted: 1 })
    /** 中文说明：测试局部值 admitted，由紧邻初始化决定。 */
    const admitted = test.agent.session.events.find(event => event.type === 'user/message'
      && event.data.source.kind === 'goal' && event.data.source.round > 0)
    expect(admitted?.type === 'user/message' && admitted.data.source.kind === 'goal'
      ? admitted.data.source.revision
      : undefined).toBe(2)
  })

  it('rechecks revision after downstream prompt hooks before admitting', async () => {
    /** 中文说明：测试局部值 test，由紧邻初始化决定。 */
    const test = await harness([textResponse('new revision')])
    /** 中文说明：测试局部值 edited，由紧邻初始化决定。 */
    let edited = false
    test.ctx.on('agent/pre-step', ({ agent, messages }, next) => {
      if (messages[0]?.source.kind === 'goal' && !edited) {
        edited = true
        /** 中文说明：测试局部值 current，由紧邻初始化决定。 */
        const current = test.ctx.goals.get(agent)
        if (current === undefined) throw new Error('missing goal during prompt edit')
        test.ctx.goals.edit(agent, current, { objective: 'edited downstream' })
      }
      return next()
    })
    test.ctx.goals.create(test.agent, { objective: 'edit during pre-step', maxGoalRounds: 1 })

    /** 中文说明：测试局部值 goal，由紧邻初始化决定。 */
    const goal = await waitForGoal(test.ctx, test.agent, current => current?.phase === 'blocked')

    expect(goal).toMatchObject({ objective: 'edited downstream', roundsStarted: 1 })
    expect(test.adapter.requests).toHaveLength(1)
  })

  it('does not block a goal that downstream paused before rejecting its prompt', async () => {
    /** 中文说明：测试局部值 test，由紧邻初始化决定。 */
    const test = await harness([])
    test.ctx.on('agent/pre-step', async ({ agent, messages }, next) => {
      if (!messages.some(message => message.source.kind === 'goal' && message.source.round > 0)) {
        return next()
      }
      /** 中文说明：测试局部值 goal，由紧邻初始化决定。 */
      const goal = test.ctx.goals.get(agent)
      if (goal === undefined) throw new Error('missing goal before downstream pause')
      test.ctx.goals.pause(agent, { id: goal.id, revision: goal.revision })
      return { kind: 'reject' as const }
    })
    test.ctx.goals.create(test.agent, { objective: 'pause before rejection' })

    /** 中文说明：测试局部值 goal，由紧邻初始化决定。 */
    const goal = await waitForGoal(test.ctx, test.agent, current => current?.phase === 'paused')

    expect(goal).toMatchObject({ phase: 'paused' })
    expect(test.adapter.requests).toEqual([])
  })

  it('restores non-goal step context when a claimed reservation becomes stale', async () => {
    /** 中文说明：测试局部值 test，由紧邻初始化决定。 */
    const test = await harness([textResponse('side contexts'), textResponse('revised goal')])
    /** 中文说明：测试局部值 claimedContext，由紧邻初始化决定。 */
    const claimedContext = createUserMessage({
      content: [{ type: 'text', text: 'claimed context to restore' }],
      source: { kind: 'plugin', plugin: 'test' },
    })
    /** 中文说明：测试局部值 roundZeroContext，由紧邻初始化决定。 */
    const roundZeroContext = createUserMessage({
      content: [{ type: 'text', text: 'obsolete goal context' }],
      source: { kind: 'goal', goalId: GoalId('old-goal'), revision: 1, round: 0 },
    })
    /** 中文说明：测试局部值 queuedStepContext，由紧邻初始化决定。 */
    const queuedStepContext = createUserMessage({
      content: [{ type: 'text', text: 'context already queued for the next step' }],
      source: { kind: 'plugin', plugin: 'test' },
    })
    /** 中文说明：测试局部值 queuedTurnContext，由紧邻初始化决定。 */
    const queuedTurnContext = createUserMessage({
      content: [{ type: 'text', text: 'context already queued for the next turn' }],
      source: { kind: 'plugin', plugin: 'test' },
    })
    /** 中文说明：测试局部值 staged，由紧邻初始化决定。 */
    let staged = false
    /** 中文说明：测试局部值 stopInserted，由紧邻初始化决定。 */
    const stopInserted = onInboxMessage(test.ctx, test.agent, (message) => {
      if (message.source.kind !== 'goal' || message.source.round <= 0 || staged) return
      staged = true
      test.agent.inbox.prepend('next-step', claimedContext)
      test.agent.inbox.prepend('next-step', roundZeroContext)
    })
    /** 中文说明：测试局部值 edited，由紧邻初始化决定。 */
    let edited = false
    test.ctx.on('agent/pre-step', async ({ agent, messages }, next) => {
      /** 中文说明：测试局部值 decision，由紧邻初始化决定。 */
      const decision = await next()
      if (!messages.some(message => message.source.kind === 'goal' && message.source.round > 0) || edited) return decision
      edited = true
      agent.inbox.prepend('next-step', queuedStepContext)
      agent.inbox.append('next-turn', queuedTurnContext)
      /** 中文说明：测试局部值 goal，由紧邻初始化决定。 */
      const goal = test.ctx.goals.get(agent)
      if (goal === undefined) throw new Error('missing claimed goal')
      test.ctx.goals.edit(agent, goal, { objective: 'revised after claim' })
      return decision.kind === 'reject' ? decision : {
        kind: 'enter' as const,
        messages: [...decision.messages, queuedStepContext, queuedTurnContext],
      }
    })
    test.ctx.goals.create(test.agent, { objective: 'stale before admission', maxGoalRounds: 1 })

    /** 中文说明：测试局部值 goal，由紧邻初始化决定。 */
    const goal = await waitForGoal(test.ctx, test.agent, current => current?.phase === 'blocked')
    stopInserted()

    expect(goal).toMatchObject({ objective: 'revised after claim', roundsStarted: 1 })
    expect(test.adapter.requests).toHaveLength(2)
    expect(requestText(test.adapter.requests[0]!)).toContain('claimed context to restore')
    expect(requestText(test.adapter.requests[0]!)).toContain('context already queued for the next step')
    expect(requestText(test.adapter.requests[0]!)).toContain('context already queued for the next turn')
    expect(requestText(test.adapter.requests[0]!)).not.toContain('obsolete goal context')
    expect(requestText(test.adapter.requests[0]!)).not.toContain('<goal_round>')
    expect(requestText(test.adapter.requests[1]!)).toContain('revised after claim')
    expect(requestText(test.adapter.requests[1]!)).not.toContain('stale before admission')
  })

  it('disarms without dispatch when a durability checkpoint fails', async () => {
    /** 中文说明：测试局部值 test，由紧邻初始化决定。 */
    const test = await harness([])
    test.ctx.on('session/flush', () => Promise.reject(new Error('disk unavailable')))
    test.ctx.goals.create(test.agent, { objective: 'do not outrun storage' })

    /** 中文说明：测试局部值 goal，由紧邻初始化决定。 */
    const goal = await waitForGoal(test.ctx, test.agent, current => current?.activation === 'disarmed')

    expect(goal).toMatchObject({ phase: 'active', roundsStarted: 0 })
    expect(test.adapter.requests).toHaveLength(0)
  })

  it('disarms instead of reserving another round when the round checkpoint fails', async () => {
    /** 中文说明：测试局部值 test，由紧邻初始化决定。 */
    const test = await harness([textResponse('round one ran')])
    // The loop persists eagerly with no turn-end flush, so the driver owns
    // the round durability barrier. Let goal creation's checkpoint pass, then
    // fail the flush that settles round one: no second round may be reserved
    // on state that was never persisted.
    /** 中文说明：测试局部值 flushes，由紧邻初始化决定。 */
    let flushes = 0
    test.ctx.on('session/flush', () => {
      flushes += 1
      // Flush 1 is goal creation's checkpoint; flush 2 settles round one.
      return flushes >= 2 ? Promise.reject(new Error('round checkpoint failed')) : undefined
    })
    test.ctx.goals.create(test.agent, { objective: 'no autonomous rounds without durability', maxGoalRounds: 5 })

    /** 中文说明：测试局部值 goal，由紧邻初始化决定。 */
    const goal = await waitForGoal(test.ctx, test.agent, current => current?.activation === 'disarmed')

    expect(goal).toMatchObject({ phase: 'active', roundsStarted: 1 })
    expect(test.adapter.requests).toHaveLength(1)
  })

  it('reserves the next round only after the settled round checkpoint succeeds', async () => {
    /** 中文说明：测试局部值 test，由紧邻初始化决定。 */
    const test = await harness([textResponse('round one'), textResponse('round two')])
    /** 中文说明：测试局部值 flushes，由紧邻初始化决定。 */
    const flushes: number[] = []
    test.ctx.on('session/flush', () => { flushes.push(test.adapter.requests.length) })
    test.ctx.goals.create(test.agent, { objective: 'checkpoint between rounds', maxGoalRounds: 2 })

    /** 中文说明：测试局部值 goal，由紧邻初始化决定。 */
    const goal = await waitForGoal(test.ctx, test.agent, current => current?.phase === 'blocked')

    expect(goal?.blockedReason?.code).toBe('round-limit')
    expect(goal?.roundsStarted).toBe(2)
    expect(test.adapter.requests).toHaveLength(2)
    // A flush was observed after round one settled and before round two
    // dispatched (recorded request count 1 at flush time).
    expect(flushes).toContain(1)
  })

  it('contains a checkpoint failure after a clear notification leaves no current goal', async () => {
    /** 中文说明：测试局部值 test，由紧邻初始化决定。 */
    const test = await harness([])
    test.ctx.on('session/flush', () => Promise.reject(new Error('clear checkpoint failed')))
    agentEvents(test.ctx, test.agent).emit('goal/changed', {
      change: {
        operation: 'clear',
        ref: { id: GoalId('cleared-goal'), revision: 2 },
      },
    })
    await new Promise<void>((resolve) => { setImmediate(resolve) })

    expect(test.ctx.goals.get(test.agent)).toBeUndefined()
    expect(test.adapter.requests).toHaveLength(0)
  })

  it('settles a goal round from its successful retry turn, not the failed original', async () => {
    /** 中文说明：测试局部值 test，由紧邻初始化决定。 */
    const test = await harness([
      new LlmError('transient', 'SERVER'),
      textResponse('retry succeeded'),
    ])
    // The llm-retry shape: schedule one retry for the failed goal-round request.
    /** 中文说明：测试局部值 retried，由紧邻初始化决定。 */
    let retried = false
    test.ctx.on('agent/request-error', async (_payload) => {
      if (!retried) {
        retried = true
        return { kind: 'retry' }
      }
    })
    test.ctx.goals.create(test.agent, { objective: 'survive a transient failure', maxGoalRounds: 1 })

    /** 中文说明：测试局部值 goal，由紧邻初始化决定。 */
    const goal = await waitForGoal(test.ctx, test.agent, current => current?.phase === 'blocked')

    // The retry turn's completed outcome settles the round: round-limit, not
    // the failed original turn's turn-error.
    expect(goal?.blockedReason?.code).toBe('round-limit')
    expect(goal?.roundsStarted).toBe(1)
    expect(test.adapter.requests).toHaveLength(2)
  })

  it('does not double-clear when a throwing hook already cancelled the round', async () => {
    /** 中文说明：测试局部值 test，由紧邻初始化决定。 */
    const test = await harness([])
    // The downstream hook cancels (pausing the goal and clearing the queued
    // attempt through cancel-requested) and THEN throws: the catch finds no
    // matching reservation and must not reschedule a paused goal.
    /** 中文说明：测试局部值 fired，由紧邻初始化决定。 */
    let fired = false
    test.ctx.on('agent/pre-step', async ({ agent, messages }, next) => {
      if (messages[0]?.source.kind === 'goal' && !fired) {
        fired = true
        agent.cancel({ kind: 'user' })
        throw new Error('hook cancelled then exploded')
      }
      return next()
    })
    test.ctx.goals.create(test.agent, { objective: 'cancel then throw' })

    /** 中文说明：测试局部值 goal，由紧邻初始化决定。 */
    const goal = await waitForGoal(test.ctx, test.agent, current => current?.phase === 'paused')
    await test.agent.whenIdle()
    await new Promise((resolve) => { setImmediate(resolve) })

    expect(goal?.roundsStarted).toBe(0)
    expect(test.adapter.requests).toHaveLength(0)
    expect(test.ctx.goals.get(test.agent)).toMatchObject({ phase: 'paused' })
  })

  it('fails closed when a downstream pre-step hook throws', async () => {
    /** 中文说明：测试局部值 test，由紧邻初始化决定。 */
    const test = await harness([])
    // Registered after goal-round-driver's own listener: the throw propagates back
    // through goal-round-driver's next() await, dropping the whole step proposal.
    /** 中文说明：测试局部值 threw，由紧邻初始化决定。 */
    let threw = false
    test.ctx.on('agent/pre-step', async ({ messages }, next) => {
      if (messages[0]?.source.kind === 'goal' && !threw) {
        threw = true
        throw new Error('downstream pre-step hook exploded')
      }
      return next()
    })
    test.ctx.goals.create(test.agent, { objective: 'survive a throwing hook', maxGoalRounds: 1 })

    /** 中文说明：测试局部值 goal，由紧邻初始化决定。 */
    const goal = await waitForGoal(test.ctx, test.agent, current => current?.activation === 'disarmed')
    expect(goal).toMatchObject({ phase: 'active', roundsStarted: 0 })
    expect(test.adapter.requests).toHaveLength(0)
    expect(test.agent.inbox.nextTurn).toHaveLength(0)
  })

  it('a retry turn on a non-goal failure leaves the goal reservation untouched', async () => {
    /** 中文说明：测试局部值 test，由紧邻初始化决定。 */
    const test = await harness([
      new LlmError('transient on human turn', 'SERVER'),
      textResponse('human retry succeeded'),
      textResponse('goal round ran'),
    ])
    /** 中文说明：测试局部值 retried，由紧邻初始化决定。 */
    let retried = false
    test.ctx.on('agent/request-error', async (_payload) => {
      if (!retried) {
        retried = true
        return { kind: 'retry' }
      }
    })
    // A human prompt fails and retries while a goal is armed but its round
    // is not yet reserved: the retry trigger must not adopt or clear
    // anything (the attempt is absent), and the goal proceeds normally.
    test.ctx.goals.create(test.agent, { objective: 'ignore foreign retries', maxGoalRounds: 1 })
    test.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'human work' }], source: { kind: 'user' } }))

    /** 中文说明：测试局部值 goal，由紧邻初始化决定。 */
    const goal = await waitForGoal(test.ctx, test.agent, current => current?.phase === 'blocked')
    expect(goal?.blockedReason?.code).toBe('round-limit')
    expect(goal?.roundsStarted).toBe(1)
  })

  it('blocks the goal when a custom agent rejects the otherwise valid follow-up', async () => {
    /** 中文说明：测试局部值 test，由紧邻初始化决定。 */
    const test = await harness([])
    // Reject only the goal-sourced round follow-up, not the state-change injection
    // that precedes it.
    /** 中文说明：测试局部值 realFollowup，由紧邻初始化决定。 */
    const realFollowup = test.agent.followup.bind(test.agent)
    vi.spyOn(test.agent, 'followup').mockImplementation((input) => {
      if (input.source.kind === 'goal') {
        throw new Error('queue rejected')
      }
      realFollowup(input)
    })
    test.ctx.goals.create(test.agent, { objective: 'handle queue failure' })

    /** 中文说明：测试局部值 goal，由紧邻初始化决定。 */
    const goal = await waitForGoal(test.ctx, test.agent, current => current?.phase === 'blocked')

    expect(goal).toMatchObject({ roundsStarted: 0, activation: 'disarmed' })
    expect(goal?.blockedReason).toEqual({
      code: 'queue-failed',
      message: 'Could not queue goal round 1: queue rejected',
    })
    expect(test.adapter.requests).toHaveLength(0)
  })

  it('preserves a custom agent side effect when followup disarms before throwing', async () => {
    /** 中文说明：测试局部值 test，由紧邻初始化决定。 */
    const test = await harness([])
    /** 中文说明：测试局部值 realFollowup，由紧邻初始化决定。 */
    const realFollowup = test.agent.followup.bind(test.agent)
    vi.spyOn(test.agent, 'followup').mockImplementation((input) => {
      if (input.source.kind === 'goal') {
        test.ctx.goals.disarm(test.agent)
        throw new Error('queue rejected after disarm')
      }
      realFollowup(input)
    })
    test.ctx.goals.create(test.agent, { objective: 'preserve the newer activation state' })

    /** 中文说明：测试局部值 goal，由紧邻初始化决定。 */
    const goal = await waitForGoal(test.ctx, test.agent, current => current?.activation === 'disarmed')

    expect(goal).toMatchObject({ phase: 'active', roundsStarted: 0 })
    expect(test.adapter.requests).toHaveLength(0)
  })

  it('contains a mutation failure inside the scheduler loop and fails closed', async () => {
    /** 中文说明：测试局部值 test，由紧邻初始化决定。 */
    const test = await harness([textResponse('the only round')])
    // The only ctx.goals.block call in a completing one-round run is the
    // driver's round-limit stop, so the mock fails exactly that drive pass.
    vi.spyOn(test.ctx.goals, 'block').mockImplementationOnce(() => {
      throw new Error('round-limit block failed')
    })
    test.ctx.goals.create(test.agent, { objective: 'contain a driver failure', maxGoalRounds: 1 })

    /** 中文说明：测试局部值 goal，由紧邻初始化决定。 */
    const goal = await waitForGoal(test.ctx, test.agent, current => current?.activation === 'disarmed')

    expect(goal).toMatchObject({ phase: 'active', roundsStarted: 1 })
    expect(goal?.blockedReason).toBeUndefined()
    expect(test.adapter.requests).toHaveLength(1)
  })

  it('contains synchronous scheduler startup failure', async () => {
    /** 中文说明：测试局部值 test，由紧邻初始化决定。 */
    const test = await harness([])
    vi.spyOn(test.ctx.agents, 'withoutInitiator').mockImplementationOnce(() => {
      throw 'scheduler closed'
    })
    test.ctx.goals.create(test.agent, { objective: 'fail startup closed' })

    /** 中文说明：测试局部值 goal，由紧邻初始化决定。 */
    const goal = await waitForGoal(test.ctx, test.agent, current => current?.activation === 'disarmed')

    expect(goal?.phase).toBe('active')
    expect(test.adapter.requests).toHaveLength(0)
  })

  it('contains an asynchronously rejected scheduler task', async () => {
    /** 中文说明：测试局部值 test，由紧邻初始化决定。 */
    const test = await harness([])
    vi.spyOn(test.ctx.agents, 'withoutInitiator').mockImplementationOnce(
      () => Promise.reject(new Error('scheduler task rejected')),
    )
    test.ctx.goals.create(test.agent, { objective: 'fail task closed' })

    /** 中文说明：测试局部值 goal，由紧邻初始化决定。 */
    const goal = await waitForGoal(test.ctx, test.agent, current => current?.activation === 'disarmed')

    expect(goal?.phase).toBe('active')
    expect(test.adapter.requests).toHaveLength(0)
  })

  it('fails an initial pre-step read closed even when the first disarm attempt throws', async () => {
    /** 中文说明：测试局部值 test，由紧邻初始化决定。 */
    const test = await harness([textResponse('retry after containment')])
    /** 中文说明：测试局部值 armed，由紧邻初始化决定。 */
    let armed = true
    onClaimedMessage(test.ctx, test.agent, (message) => {
      if (message.source.kind !== 'goal' || message.source.round <= 0 || !armed) return
      armed = false
      vi.spyOn(test.ctx.goals, 'get').mockImplementationOnce(() => {
        throw new Error('pre-step projection failed')
      })
      vi.spyOn(test.ctx.goals, 'disarm').mockImplementationOnce(() => {
        throw 'disarm failed'
      })
    })
    test.ctx.goals.create(test.agent, { objective: 'retry stale pre-step', maxGoalRounds: 1 })

    await waitForGoal(test.ctx, test.agent, goal => goal?.phase === 'blocked')

    expect(test.adapter.requests).toHaveLength(1)
  })

  it('fails a post-hook read closed before the prompt can enter history', async () => {
    /** 中文说明：测试局部值 test，由紧邻初始化决定。 */
    const test = await harness([])
    /** 中文说明：测试局部值 armed，由紧邻初始化决定。 */
    let armed = true
    test.ctx.on('agent/pre-step', ({ messages }, next) => {
      if (messages[0]?.source.kind === 'goal' && armed) {
        armed = false
        vi.spyOn(test.ctx.goals, 'get').mockImplementationOnce(() => {
          throw new Error('post-hook projection failed')
        })
      }
      return next()
    })
    test.ctx.goals.create(test.agent, { objective: 'block post-hook failure' })

    /** 中文说明：测试局部值 goal，由紧邻初始化决定。 */
    const goal = await waitForGoal(test.ctx, test.agent, current => current?.activation === 'disarmed')

    expect(goal).toMatchObject({ phase: 'active', roundsStarted: 0 })
    expect(test.adapter.requests).toHaveLength(0)
  })

  it('blocks forged goal attribution without touching an absent reservation', async () => {
    /** 中文说明：测试局部值 test，由紧邻初始化决定。 */
    const test = await harness([])
    test.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'forged automatic work' }], source: { kind: 'goal', goalId: GoalId('forged-goal'), revision: 1, round: 1 } }))
    await test.agent.whenIdle()

    expect(test.adapter.requests).toHaveLength(0)
    expect(test.agent.session.events.some(event => event.type === 'turn/start')).toBe(true)
  })

  it('leaves round-zero goal context to the ordinary pre-step chain', async () => {
    /** 中文说明：测试局部值 test，由紧邻初始化决定。 */
    const test = await harness([textResponse('accepted context')])
    test.agent.followup(createUserMessage({
      content: [{ type: 'text', text: 'goal context' }],
      source: { kind: 'goal', goalId: GoalId('context-goal'), revision: 1, round: 0 },
    }))

    await test.agent.whenIdle()

    expect(test.adapter.requests).toHaveLength(1)
    expect(requestText(test.adapter.requests[0]!)).toContain('goal context')
  })

  it('does not invent goal state when ordinary queued work is cancelled', async () => {
    /** 中文说明：测试局部值 test，由紧邻初始化决定。 */
    const test = await harness([])
    test.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'cancel ordinary work' }], source: { kind: 'user' } }))
    test.agent.cancel({ kind: 'user' })
    await test.agent.whenIdle()

    expect(test.ctx.goals.get(test.agent)).toBeUndefined()
    expect(test.adapter.requests).toHaveLength(0)
  })

  it('disarms without durably pausing when cancellation belongs to unrelated human work', async () => {
    /** 中文说明：测试局部值 test，由紧邻初始化决定。 */
    const test = await harness(['hang'])
    test.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'inspect something first' }], source: { kind: 'user' } }))
    await waitForRequests(test.adapter, 1)
    /** 中文说明：测试局部值 created，由紧邻初始化决定。 */
    const created = test.ctx.goals.create(test.agent, { objective: 'continue after inspection' })

    test.agent.cancel({ kind: 'user' })
    await test.agent.whenIdle()

    expect(test.ctx.goals.get(test.agent)).toMatchObject({
      id: created.id,
      revision: created.revision,
      phase: 'active',
      activation: 'disarmed',
      roundsStarted: 0,
    })
  })

  it('falls back to disarming when a cancelled reservation cannot be paused', async () => {
    /** 中文说明：测试局部值 test，由紧邻初始化决定。 */
    const test = await harness([])
    /** 中文说明：测试局部值 cancel，由紧邻初始化决定。 */
    const cancel = onInboxMessage(test.ctx, test.agent, (message) => {
      if (message.source.kind !== 'goal' || message.source.round <= 0) return
      cancel()
      vi.spyOn(test.ctx.goals, 'pause').mockImplementationOnce(() => {
        throw new Error('pause failed')
      })
      test.agent.cancel({ kind: 'user' })
    })
    test.ctx.goals.create(test.agent, { objective: 'fail closed after cancellation' })

    /** 中文说明：测试局部值 goal，由紧邻初始化决定。 */
    const goal = await waitForGoal(test.ctx, test.agent, current => current?.activation === 'disarmed')

    expect(goal).toMatchObject({ phase: 'active', revision: 1, roundsStarted: 0 })
    expect(test.adapter.requests).toHaveLength(0)
  })

  it('rejects the step when downstream cancellation clears the reservation', async () => {
    /** 中文说明：测试局部值 test，由紧邻初始化决定。 */
    const test = await harness([])
    /** 中文说明：测试局部值 cancelled，由紧邻初始化决定。 */
    let cancelled = false
    test.ctx.on('agent/pre-step', ({ agent, messages }, next) => {
      if (messages[0]?.source.kind === 'goal' && !cancelled) {
        cancelled = true
        agent.cancel({ kind: 'user' })
      }
      return next()
    })
    test.ctx.goals.create(test.agent, { objective: 'cancel during pre-step' })

    /** 中文说明：测试局部值 goal，由紧邻初始化决定。 */
    const goal = await waitForGoal(test.ctx, test.agent, current => current?.phase === 'paused')
    await test.agent.whenIdle()

    expect(goal?.roundsStarted).toBe(0)
    expect(test.adapter.requests).toHaveLength(0)
  })

  it('disarms and cancels an admitted round before driver teardown completes', async () => {
    /** 中文说明：测试局部值 test，由紧邻初始化决定。 */
    const test = await harness(['hang'])
    test.ctx.goals.create(test.agent, { objective: 'survive plugin unload' })
    await waitForRequests(test.adapter, 1)

    await test.driver.dispose()

    expect(test.ctx.goals.get(test.agent)).toMatchObject({
      phase: 'active',
      activation: 'disarmed',
      roundsStarted: 1,
    })
    expect(test.agent.status).toBe('idle')
    expect(test.adapter.requests).toHaveLength(1)
  })

  it('cancels an accepted queued round and awaits its driver task during teardown', async () => {
    /** 中文说明：测试局部值 test，由紧邻初始化决定。 */
    const test = await harness([])
    /** 中文说明：测试局部值 解构结果，由紧邻初始化决定。 */
    let unloading: Promise<void> | undefined
    onInboxMessage(test.ctx, test.agent, (message) => {
      if (message.source.kind === 'goal' && unloading === undefined) {
        unloading = Promise.resolve(test.driver.dispose())
      }
    })
    test.ctx.goals.create(test.agent, { objective: 'unload while queued' })
    await vi.waitFor(() => { expect(unloading).toBeDefined() })
    await unloading

    expect(test.ctx.goals.get(test.agent)).toMatchObject({
      phase: 'active',
      activation: 'disarmed',
      roundsStarted: 0,
    })
    expect(test.adapter.requests).toHaveLength(0)
  })

  it('resets process-local scheduling state at a session-start edge', async () => {
    /** 中文说明：测试局部值 test，由紧邻初始化决定。 */
    const test = await harness([textResponse('after explicit resume')])
    /** 中文说明：测试局部值 created，由紧邻初始化决定。 */
    const created = test.ctx.goals.create(test.agent, { objective: 'restart safely', maxGoalRounds: 1 })
    agentEvents(test.ctx, test.agent).emit('agent/session-start', { source: 'resume' })
    await Promise.resolve()

    expect(test.ctx.goals.get(test.agent)).toMatchObject({ activation: 'disarmed', roundsStarted: 0 })
    expect(test.adapter.requests).toHaveLength(0)

    test.ctx.goals.resume(test.agent, created)
    await waitForGoal(test.ctx, test.agent, goal => goal?.phase === 'blocked')
    expect(test.adapter.requests).toHaveLength(1)
  })

  it('disarms when a round turn/end cannot commit', async () => {
    /** 中文说明：测试局部值 test，由紧邻初始化决定。 */
    const test = await harness([textResponse('round ran')])
    test.ctx.on('internal/dispatch', (_mode, name, args) => {
      if (name !== 'session/event') return
      /** 中文说明：测试局部值 event，由紧邻初始化决定。 */
      const event = args[1] as { type: string }
      if (event.type === 'turn/end') throw new Error('turn close permanently rejected')
    })
    test.ctx.goals.create(test.agent, { objective: 'survive a lost turn end' })
    await waitForRequests(test.adapter, 1)
    await test.agent.whenIdle()
    await new Promise((resolve) => { setImmediate(resolve) })

    expect(test.adapter.requests).toHaveLength(1)
    expect(test.ctx.goals.get(test.agent)).toMatchObject({
      phase: 'active',
      activation: 'disarmed',
    })
  })

  it('disarms instead of continuing when a plugin reports a post-turn persistence failure', async () => {
    /** 中文说明：测试局部值 test，由紧邻初始化决定。 */
    const test = await harness([textResponse('round one')])
    test.ctx.on('session/event', (session, event) => {
      if (session === test.agent.session && event.type === 'turn/end') {
        agentEvents(test.ctx, test.agent).emit('agent/error', { turn: event.data.turn, step: 1, error: new Error('post-turn flush failed') })
      }
    })
    test.ctx.goals.create(test.agent, { objective: 'stop when durability is lost', maxGoalRounds: 8 })

    /** 中文说明：测试局部值 goal，由紧邻初始化决定。 */
    const goal = await waitForGoal(test.ctx, test.agent, current => current?.activation === 'disarmed')
    await test.agent.whenIdle()

    expect(goal).toMatchObject({ phase: 'active', roundsStarted: 1 })
    expect(test.adapter.requests).toHaveLength(1)
  })

  it('ignores a post-turn failure reported for a retired agent', async () => {
    /** 中文说明：测试局部值 test，由紧邻初始化决定。 */
    const test = await harness([textResponse('ordinary work')])
    /** 中文说明：测试局部值 handle，由紧邻初始化决定。 */
    const handle = await test.ctx.agents.create({
      sessionId: SessionId('goal-session-retired'),
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'one ordinary turn' }], source: { kind: 'user' } }))
    await handle.agent.whenIdle()
    /** 中文说明：测试局部值 closed，由紧邻初始化决定。 */
    const closed = handle.agent.session.events.findLast(event => event.type === 'turn/end')
    if (closed?.type !== 'turn/end') throw new Error('expected a closed turn')
    await handle.dispose()
    /** 中文说明：测试局部值 warn，由紧邻初始化决定。 */
    const warn = vi.spyOn(test.ctx.logger, 'warn')

    agentEvents(test.ctx, handle.agent).emit('agent/error', { turn: closed.data.turn, step: 1, error: new Error('late flush failure') })

    expect(test.ctx.agents.get(handle.agent.id)).toBeUndefined()
    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('goal-round-driver'))
  })

  it('keeps terminal agent failure disarmed and defers queued human work until another wakeup', async () => {
    /** 中文说明：测试局部值 test，由紧邻初始化决定。 */
    const test = await harness([new Error('round one broke'), textResponse('human answer')])
    /** 中文说明：测试局部值 queued，由紧邻初始化决定。 */
    let queued = false
    test.ctx.on('session/event', (session, event) => {
      if (session !== test.agent.session || queued) return
      if (event.type === 'user/message' && event.data.source.kind === 'goal') {
        queued = true
        queueMicrotask(() => {
          test.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'human interleaved' }], source: { kind: 'user' } }))
        })
      }
    })
    test.ctx.goals.create(test.agent, { objective: 'survive a stale failure', maxGoalRounds: 1 })

    await waitForGoal(test.ctx, test.agent, current =>
      current?.phase === 'active' && current.activation === 'disarmed')

    expect(test.adapter.requests).toHaveLength(1)
    expect(test.agent.inbox.nextTurn).toHaveLength(1)

    test.agent.steer(createUserMessage({ content: [{ type: 'text', text: 'resume after failure' }], source: { kind: 'user' } }))
    await test.agent.whenIdle()

    expect(test.adapter.requests).toHaveLength(2)
    expect(requestText(test.adapter.requests[1]!)).toContain('human interleaved')
    expect(requestText(test.adapter.requests[1]!)).toContain('resume after failure')
  })

  it('waits for work queued by a pause observer before considering the next round', async () => {
    /** 中文说明：测试局部值 test，由紧邻初始化决定。 */
    const test = await harness(['hang', textResponse('inspection answer')])
    test.ctx.on('goal/changed', ({ agent, change }) => {
      if (agent === test.agent && change.operation === 'pause') {
        agent.followup(createUserMessage({ content: [{ type: 'text', text: 'inspect the pause' }], source: { kind: 'user' } }))
      }
    })
    test.ctx.goals.create(test.agent, { objective: 'pause then inspect' })
    await waitForRequests(test.adapter, 1)

    test.agent.cancel({ kind: 'user' })
    await waitForRequests(test.adapter, 2)
    await test.agent.whenIdle()

    expect(test.ctx.goals.get(test.agent)).toMatchObject({
      phase: 'paused',
      roundsStarted: 1,
      activation: 'disarmed',
    })
    expect(requestText(test.adapter.requests[1]!)).toContain('inspect the pause')
  })

  it('does not re-block a goal the downstream veto already saw cancelled', async () => {
    /** 中文说明：测试局部值 test，由紧邻初始化决定。 */
    const test = await harness([])
    /** 中文说明：测试局部值 vetoed，由紧邻初始化决定。 */
    let vetoed = false
    test.ctx.on('agent/pre-step', ({ agent, messages }, next) => {
      if (messages[0]?.source.kind === 'goal' && !vetoed) {
        vetoed = true
        agent.cancel({ kind: 'user' })
        return Promise.resolve<PreStepDecision>({
          kind: 'reject',
        })
      }
      return next()
    })
    test.ctx.goals.create(test.agent, { objective: 'veto after cancellation' })

    /** 中文说明：测试局部值 goal，由紧邻初始化决定。 */
    const goal = await waitForGoal(test.ctx, test.agent, current => current?.phase === 'paused')
    await test.agent.whenIdle()

    // Cancellation already cleared the reservation and paused the goal, so the
    // veto neither touches an absent attempt nor blocks the paused goal.
    expect(goal).toMatchObject({ roundsStarted: 0, activation: 'disarmed' })
    expect(goal?.blockedReason).toBeUndefined()
    expect(test.adapter.requests).toHaveLength(0)
  })

  it('awaits a claimed reservation stuck in pre-step during teardown without cancelling', async () => {
    /** 中文说明：测试局部值 test，由紧邻初始化决定。 */
    const test = await harness([])
    /** 中文说明：测试局部值 release，由紧邻初始化决定。 */
    let release: (() => void) | undefined
    test.ctx.on('agent/pre-step', async ({ messages }, next) => {
      if (messages[0]?.source.kind === 'goal' && release === undefined) {
        await new Promise<void>((resolve) => { release = resolve })
      }
      return next()
    })
    test.ctx.goals.create(test.agent, { objective: 'unload during pre-step' })
    await vi.waitFor(() => { expect(release).toBeDefined() })

    /** 中文说明：测试局部值 disposal，由紧邻初始化决定。 */
    const disposal = Promise.resolve(test.driver.dispose())
    await waitForGoal(test.ctx, test.agent, goal => goal?.activation === 'disarmed')
    release?.()
    await disposal

    expect(test.ctx.goals.get(test.agent)).toMatchObject({ phase: 'active', roundsStarted: 0 })
    expect(test.adapter.requests).toHaveLength(0)
    expect(test.agent.session.events.some(event => event.type === 'turn/start')).toBe(true)
  })

  it('ignores session events without an exact owning agent and retires disposed agent state', async () => {
    /** 中文说明：测试局部值 test，由紧邻初始化决定。 */
    const test = await harness([])
    /** 中文说明：测试局部值 orphan，由紧邻初始化决定。 */
    const orphan = test.ctx.sessions.create(SessionId('goal-session-orphan'))
    orphan.append('turn/start', {
      turn: 1,
    })
    orphan.append('turn/end', { turn: 1, reason: { kind: 'completed' } })

    /** 中文说明：测试局部值 handle，由紧邻初始化决定。 */
    const handle = await test.ctx.agents.create({
      sessionId: SessionId('goal-session-disposed'),
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    await handle.dispose()

    expect(test.ctx.agents.get(handle.agent.id)).toBeUndefined()
  })
})
