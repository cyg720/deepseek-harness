/**
 * 文件职责：验证Agent Loop的 cancel.spec.ts 行为与不变量。
 * 技术维度：Vitest、Cordis、会话事件、模型适配器和可控工具夹具。
 * 产品维度：防止Agent Loop在取消、恢复、错误或并发场景中产生回归。
 * 逻辑维度：构造服务与事件，驱动执行流程，再断言日志、请求、状态和清理。
 * 关键边界：测试后台任务必须结束；模型可见输入必须可从日志重建；工具调用顺序不可破坏。
 * 新手阅读建议：先读 mock/辅助函数，再按成功、错误、恢复和生命周期场景阅读。
 */
import { CallId, createUserMessage } from '@deepseek-ai/dsh-llm'
/**
 * Tests for the queue-aware `Agent.cancel()` primitive. The default clears
 * queued and steering work, while `keepInbox` preserves pending input for a
 * later wake after the active turn reaches quiescence. The suite
 * covers every landing window plus signal reset and `whenIdle()` quiescence.
 * @module dsh-agent-loop/tests/cancel
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId, TurnEndReason } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineContentToolFixture, TOOL_ABORTED_BEFORE_DISPATCH } from '@deepseek-ai/dsh-tools'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { MockAdapter, textResponse, toolCallResponse } from './mock-adapter.ts'

/** 中文说明：测试辅助函数 driverDone 的参数见签名，返回值用于驱动或断言场景；示例见下方用例。 */
function driverDone(agent: Agent): Promise<void> {
  return (agent as Agent & { done: Promise<void> }).done
}

/** 中文说明：测试辅助函数 harness 的参数见签名，返回值用于驱动或断言场景；示例见下方用例。 */
async function harness(adapter: MockAdapter) {
  /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  ctx.llm.registerAdapter(['mock'], adapter)
  return ctx
}

/** 中文说明：测试辅助函数 send 的参数见签名，返回值用于驱动或断言场景；示例见下方用例。 */
function send(agent: Agent, text: string) {
  agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
}

/** Resolve on the agent's next idle transition (event-based, not status poll). */
/** 中文说明：测试辅助函数 waitForIdle 的参数见签名，返回值用于驱动或断言场景；示例见下方用例。 */
function waitForIdle(ctx: Context, agent: Agent): Promise<void> {
  return new Promise((resolve) => {
    /** 中文说明：测试局部值 dispose，由紧邻初始化决定，仅在当前场景使用。 */
    const dispose = ctx.on('agent/status', ({ agent: subject, status }) => {
      if (subject === agent && status === 'idle') { dispose(); resolve() }
    })
  })
}

/** All user-message texts recorded in the log (to assert what actually ran). */
/** 中文说明：测试辅助函数 userTexts 的参数见签名，返回值用于驱动或断言场景；示例见下方用例。 */
function userTexts(agent: Agent): string[] {
  return agent.session.events
    .filter(e => e.type === 'user/message')
    .flatMap(e => e.type === 'user/message' ? e.data.content : [])
    .flatMap(b => b.type === 'text' ? [b.text] : [])
}

describe('Agent.cancel()', () => {
  it('cancel() on an idle agent with nothing queued is a no-op; the next prompt runs (F2 leak guard)', async () => {
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter([textResponse('reply')])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await harness(adapter)
    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })

    // The loop is parked at the idle wait with nothing queued. A cancel here must
    // NOT arm the marker — otherwise the next legitimate prompt would be dropped.
    agent.cancel({ kind: 'user' })

    send(agent, 'real prompt')
    await waitForIdle(ctx, agent)

    // The prompt ran: its user message is in the log and one turn completed.
    expect(userTexts(agent)).toEqual(['real prompt'])
    expect(agent.session.events.some(e => e.type === 'turn/end')).toBe(true)
  })

  it('cancel({ keepInbox: true }) does not restore work already claimed by a waking send', async () => {
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter([textResponse('wake reply')])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await harness(adapter)
    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })

    agent.followup(createUserMessage({
      content: [{ type: 'text', text: 'preserved' }],
      source: { kind: 'user' },
    }))
    // A waking send starts and claims synchronously, so keepInbox has no
    // pending item to preserve by the time this cancellation runs.
    agent.cancel({ kind: 'user' }, { keepInbox: true })
    expect(agent.session.events.some(event =>
      event.type === 'agent/inbox/spliced' && event.data.outcome === 'canceled')).toBe(false)
    await agent.whenIdle()
    expect(agent.inbox.nextTurn).toHaveLength(0)
    expect(userTexts(agent)).toEqual([])
    expect(adapter.requests).toHaveLength(0)
    expect(agent.session.events.findLast(event => event.type === 'turn/end')?.data.reason)
      .toEqual({ kind: 'aborted', reason: { kind: 'user' } })

    /** 中文说明：测试局部值 idle，由紧邻初始化决定，仅在当前场景使用。 */
    const idle = waitForIdle(ctx, agent)
    send(agent, 'wake it')
    await idle
    expect(userTexts(agent)).toEqual(['wake it'])
    expect(adapter.requests).toHaveLength(1)
  })

  it('cancel({ keepInbox: true }) parks queued work after an active turn aborts', async () => {
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter([
      'hang',
      textResponse('preserved reply'),
      textResponse('wake reply'),
    ])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await harness(adapter)
    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = ctx.agentLoop.create(SessionId('keep-after-abort'), { provider: 'mock', model: 'mock' })

    send(agent, 'active')
    await new Promise(resolve => setTimeout(resolve, 30))
    send(agent, 'preserved')
    agent.cancel({ kind: 'user' }, { keepInbox: true })
    await agent.whenIdle()

    expect(userTexts(agent)).toEqual(['active'])
    expect(agent.inbox.nextTurn).toHaveLength(1)
    expect(adapter.requests).toHaveLength(1)

    /** 中文说明：测试局部值 idle，由紧邻初始化决定，仅在当前场景使用。 */
    const idle = waitForIdle(ctx, agent)
    send(agent, 'wake it')
    await idle
    expect(userTexts(agent)).toEqual(['active', 'preserved', 'wake it'])
    expect(adapter.requests).toHaveLength(3)
  })

  it('cancel({ keepInbox: true }) latches a waking send landing in the abort-to-idle window', async () => {
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter(['hang', textResponse('B reply')])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await harness(adapter)
    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = ctx.agentLoop.create(SessionId('latch-window'), { provider: 'mock', model: 'mock' })

    send(agent, 'active')
    await new Promise(resolve => setTimeout(resolve, 30))

    // The abort signal is set but the driver has not converged to idle yet:
    // the waking send must be latched, not parked until another wake.
    agent.cancel({ kind: 'user' }, { keepInbox: true })
    send(agent, 'B')

    await agent.whenIdle()

    expect(userTexts(agent)).toEqual(['active', 'B'])
    expect(adapter.requests).toHaveLength(2)
    expect(agent.inbox.nextTurn).toHaveLength(0)
    expect(agent.session.events.filter(e => e.type === 'turn/end').map(e =>
      e.type === 'turn/end' ? e.data.reason : null)).toEqual([
      { kind: 'aborted', reason: { kind: 'user' } },
      { kind: 'completed' },
    ])
  })

  it('cancel() without keepInbox clears a latched wake alongside the inbox', async () => {
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter(['hang', textResponse('C reply')])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await harness(adapter)
    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = ctx.agentLoop.create(SessionId('latch-cleared'), { provider: 'mock', model: 'mock' })

    send(agent, 'active')
    await new Promise(resolve => setTimeout(resolve, 30))
    agent.cancel({ kind: 'user' }, { keepInbox: true })
    send(agent, 'B') // latched behind the aborted activity
    agent.cancel({ kind: 'user' }) // drops the inbox and the latch with it
    await agent.whenIdle()

    expect(userTexts(agent)).toEqual(['active'])
    expect(agent.inbox.nextTurn).toHaveLength(0)
    expect(adapter.requests).toHaveLength(1)

    send(agent, 'C')
    await agent.whenIdle()
    expect(userTexts(agent)).toEqual(['active', 'C'])
    expect(adapter.requests).toHaveLength(2)
  })

  it('removing the latched wake before convergence suppresses the replay', async () => {
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter(['hang'])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await harness(adapter)
    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = ctx.agentLoop.create(SessionId('removed-latched-wake'), { provider: 'mock', model: 'mock' })

    send(agent, 'active')
    await new Promise(resolve => setTimeout(resolve, 30))

    agent.cancel({ kind: 'user' }, { keepInbox: true })
    /** 中文说明：测试局部值 steer，由紧邻初始化决定，仅在当前场景使用。 */
    const steer = createUserMessage({ content: [{ type: 'text', text: 'steer me' }], source: { kind: 'user' } })
    agent.steer(steer) // latched behind the aborted activity
    agent.inbox.remove(steer.id) // the wake is retracted before convergence

    await agent.whenIdle()

    expect(userTexts(agent)).toEqual(['active'])
    expect(adapter.requests).toHaveLength(1)
    expect(agent.inbox.nextTurn).toHaveLength(0)
    expect(agent.status).toBe('idle')
    // No replay with nothing to run: the latched message is gone, so no
    // empty follow-up turn is recorded.
    expect(agent.session.events.filter(e => e.type === 'turn/start')).toHaveLength(1)
  })

  it('latches a wake arriving deep into a slow abort convergence', async () => {
    // The stream notices the abort only after 50ms, so the driver stays in
    // the abort-to-idle window long after `cancel()` returned: the wake must
    // be latched across the whole window, not just the same-tick case.
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter(['hang-slow', textResponse('B reply')])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await harness(adapter)
    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = ctx.agentLoop.create(SessionId('slow-convergence'), { provider: 'mock', model: 'mock' })

    send(agent, 'A')
    await new Promise(resolve => setTimeout(resolve, 30))

    agent.cancel({ kind: 'user' }, { keepInbox: true })
    await new Promise(resolve => setTimeout(resolve, 10))
    send(agent, 'B')

    await agent.whenIdle()
    expect(userTexts(agent)).toEqual(['A', 'B'])
    expect(adapter.requests).toHaveLength(2)
    expect(agent.inbox.nextTurn).toHaveLength(0)
  })

  it('does not latch a wake landing after disposal begins', async () => {
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter(['hang-slow', textResponse('late reply')])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await harness(adapter)
    /** 中文说明：测试局部值 handle，由紧邻初始化决定，仅在当前场景使用。 */
    const handle = await ctx.agents.create({
      sessionId: SessionId('dispose-window-wake'),
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = handle.agent

    send(agent, 'active')
    await new Promise(resolve => setTimeout(resolve, 30))

    // Dispose cancels with `{ kind: 'disposed' }`; a wake landing in the
    // abort-to-idle window must not latch, so `whenIdle()` does not wait on
    // a model turn over the session being torn down.
    /** 中文说明：测试局部值 disposal，由紧邻初始化决定，仅在当前场景使用。 */
    const disposal = handle.dispose()
    setTimeout(() => { send(agent, 'late wake') }, 10)
    await disposal

    expect(adapter.requests).toHaveLength(1)
    expect(userTexts(agent)).toEqual(['active'])
  })

  it('cancel after waking send closes its synchronously opened turn without a step', async () => {
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter([textResponse('should not run')])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await harness(adapter)
    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })

    send(agent, 'drop me first')
    send(agent, 'drop me second')
    agent.cancel({ kind: 'user' })

    await new Promise(r => setTimeout(r, 30))

    expect(userTexts(agent)).toEqual([])
    expect(agent.session.events.filter(event => event.type === 'turn/start')).toHaveLength(1)
    expect(agent.session.events.filter(event => event.type === 'step/start')).toHaveLength(0)
    expect(agent.session.events.findLast(event => event.type === 'turn/end')?.data.reason)
      .toEqual({ kind: 'aborted', reason: { kind: 'user' } })
    expect(agent.status).toBe('idle')
  })

  it('disposal from the running notification drops queued work before turn start', async () => {
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter([textResponse('should not run')])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await harness(adapter)
    /** 中文说明：测试局部值 handle，由紧邻初始化决定，仅在当前场景使用。 */
    const handle = await ctx.agents.create({
      sessionId: SessionId('dispose-running-session'),
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = handle.agent

    /** 中文说明：测试局部值 running，由紧邻初始化决定，仅在当前场景使用。 */
    const running = Promise.withResolvers<undefined>()
    /** 中文说明：测试局部值 解构结果，由紧邻初始化决定，仅在当前场景使用。 */
    let disposalDone: Promise<void> | undefined
    ctx.on('agent/status', ({ agent: subject, status }) => {
      if (subject !== agent || status !== 'running') return
      disposalDone = handle.dispose()
      running.resolve(undefined)
    })

    send(agent, 'drop before claim')
    await running.promise
    if (disposalDone === undefined) throw new Error('running listener did not start disposal')
    await disposalDone
    await driverDone(agent)

    expect(agent.status).toBe('idle')
    expect(agent.session.events.some(event => event.type === 'turn/start')).toBe(false)
    expect(userTexts(agent)).toEqual([])
    expect(adapter.requests).toHaveLength(0)
  })

  it('a whenIdle() waiter registered BEFORE a pre-step cancel resolves (F1 hang guard)', async () => {
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter([textResponse('x')])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await harness(adapter)
    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })

    // This waiter cannot rely on a running→idle transition because cancellation
    // drops the turn before it runs; the skip path must settle it directly.
    send(agent, 'q')
    /** 中文说明：测试局部值 idle，由紧邻初始化决定，仅在当前场景使用。 */
    const idle = agent.whenIdle()
    agent.cancel({ kind: 'user' })

    // Must resolve (not hang). A timeout makes the failure a clear test failure.
    await Promise.race([
      idle,
      new Promise((_r, reject) => setTimeout(() => { reject(new Error('whenIdle hung after pre-step cancel')) }, 1000)),
    ])
    expect(agent.status).toBe('idle')
  })

  it('idle-listener cancellation settles its waiter without cancelling later work', async () => {
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter([textResponse('first reply'), textResponse('later reply')])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await harness(adapter)
    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = ctx.agentLoop.create(SessionId('idle-listener-cancel'), { provider: 'mock', model: 'mock' })

    /** 中文说明：测试局部值 replacementRegistered，由紧邻初始化决定，仅在当前场景使用。 */
    const replacementRegistered = Promise.withResolvers<undefined>()
    /** 中文说明：测试局部值 解构结果，由紧邻初始化决定，仅在当前场景使用。 */
    let replacementObservation: Promise<{ status: string; requests: number; turns: number }> | undefined
    ctx.on('agent/status', ({ agent: subject, status }) => {
      if (subject !== agent || status !== 'idle' || replacementObservation !== undefined) return
      send(agent, 'cancelled replacement')
      replacementObservation = agent.whenIdle().then(() => ({
        status: agent.status,
        requests: adapter.requests.length,
        turns: agent.session.events.filter(event => event.type === 'turn/start').length,
      }))
      agent.cancel({ kind: 'user' })
      replacementRegistered.resolve(undefined)
    })

    send(agent, 'first')
    await replacementRegistered.promise
    if (replacementObservation === undefined) throw new Error('idle listener did not register replacement work')

    await expect(Promise.race([
      replacementObservation,
      new Promise((_resolve, reject) => setTimeout(() => { reject(new Error('whenIdle hung after idle-listener cancel')) }, 1000)),
    ])).resolves.toEqual({ status: 'idle', requests: 1, turns: 2 })

    /** 中文说明：测试局部值 idle，由紧邻初始化决定，仅在当前场景使用。 */
    const idle = waitForIdle(ctx, agent)
    send(agent, 'later')
    await idle
    expect(adapter.requests).toHaveLength(2)
    expect(userTexts(agent)).toEqual(['first', 'later'])
  })

  it('replacement work queued after idle-listener cancellation replays at convergence', async () => {
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter([
      textResponse('first reply'),
      textResponse('replacement reply'),
      textResponse('wake reply'),
    ])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await harness(adapter)
    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = ctx.agentLoop.create(SessionId('idle-listener-post-cancel-send'), { provider: 'mock', model: 'mock' })

    /** 中文说明：测试局部值 replacementRegistered，由紧邻初始化决定，仅在当前场景使用。 */
    const replacementRegistered = Promise.withResolvers<undefined>()
    /** 中文说明：测试局部值 解构结果，由紧邻初始化决定，仅在当前场景使用。 */
    let replacementIdle: Promise<void> | undefined
    ctx.on('agent/status', ({ agent: subject, status }) => {
      if (subject !== agent || status !== 'idle' || replacementIdle !== undefined) return
      send(agent, 'cancelled replacement')
      agent.cancel({ kind: 'user' })
      send(agent, 'surviving replacement')
      replacementIdle = agent.whenIdle()
      replacementRegistered.resolve(undefined)
    })

    send(agent, 'first')
    await replacementRegistered.promise
    if (replacementIdle === undefined) throw new Error('idle listener did not register replacement work')
    await replacementIdle

    // The wake sent after the cancel fired is latched: the surviving
    // replacement runs at convergence without a third message.
    expect(adapter.requests).toHaveLength(2)
    expect(userTexts(agent)).toEqual(['first', 'surviving replacement'])
    expect(agent.inbox.nextTurn).toHaveLength(0)

    /** 中文说明：测试局部值 idle，由紧邻初始化决定，仅在当前场景使用。 */
    const idle = waitForIdle(ctx, agent)
    send(agent, 'wake it')
    await idle
    expect(adapter.requests).toHaveLength(3)
    expect(userTexts(agent)).toEqual(['first', 'surviving replacement', 'wake it'])
  })

  it('cancel() mid-step aborts the active turn and drops every queued tail item', async () => {
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter(['hang'])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await harness(adapter)
    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })

    /** 中文说明：测试局部值 reasons，由紧邻初始化决定，仅在当前场景使用。 */
    const reasons: TurnEndReason[] = []
    ctx.on('session/event', (_s, event) => { if (event.type === 'turn/end') reasons.push(event.data.reason) })

    send(agent, 'go')
    await new Promise(r => setTimeout(r, 30))
    expect(agent.status).toBe('running')
    send(agent, 'queued tail')
    agent.cancel({ kind: 'user' })
    await waitForIdle(ctx, agent)

    expect(reasons).toEqual([{ kind: 'aborted', reason: { kind: 'user' } }])
    expect(userTexts(agent)).toEqual(['go'])
    expect(agent.session.events.filter(event => event.type === 'turn/start')).toHaveLength(1)
    expect(adapter.requests).toHaveLength(1)
  })

  it('cancel from an assistant/message observer skips execution but balances replay', async () => {
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter([
      toolCallResponse('c1', 'danger', {}),
      textResponse('recovered after cancellation'),
    ])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await harness(adapter)
    /** 中文说明：测试局部值 executions，由紧邻初始化决定，仅在当前场景使用。 */
    let executions = 0
    ctx.tools.register(defineContentToolFixture({
      name: 'danger',
      description: 'must not run after cancellation',
      parameters: {},
      async execute() {
        executions += 1
        return [{ type: 'text', text: 'ran' }]
      },
    }))
    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = ctx.agentLoop.create(SessionId('cancel-after-assistant-message'), { provider: 'mock', model: 'mock' })
    /** 中文说明：测试局部值 dispose，由紧邻初始化决定，仅在当前场景使用。 */
    const dispose = ctx.on('session/event', (session, event) => {
      if (session === agent.session && event.type === 'assistant/message') {
        agent.cancel({ kind: 'user' })
      }
    })

    /** 中文说明：测试局部值 reasons，由紧邻初始化决定，仅在当前场景使用。 */
    const reasons: TurnEndReason[] = []
    ctx.on('session/event', (_session, event) => { if (event.type === 'turn/end') reasons.push(event.data.reason) })

    send(agent, 'go')
    await waitForIdle(ctx, agent)
    dispose()

    expect(executions).toBe(0)
    expect(reasons).toEqual([{ kind: 'aborted', reason: { kind: 'user' } }])
    /** 中文说明：测试局部值 call，由紧邻初始化决定，仅在当前场景使用。 */
    const call = agent.session.events.find(event => event.type === 'tool/call')
    /** 中文说明：测试局部值 result，由紧邻初始化决定，仅在当前场景使用。 */
    const result = agent.session.events.find(event => event.type === 'tool/result')
    expect(call?.type === 'tool/call' ? call.data.callId : undefined).toBe('c1')
    expect(result?.type === 'tool/result' ? result.data : undefined).toMatchObject({
      message: {
        source: { kind: 'tool', callId: 'c1' },
        content: [{ type: 'tool-result', toolCallId: 'c1', isError: true }],
      },
      error: { name: 'AbortError', code: TOOL_ABORTED_BEFORE_DISPATCH },
    })

    send(agent, 'continue safely')
    await waitForIdle(ctx, agent)
    /** 中文说明：测试局部值 replayedResult，由紧邻初始化决定，仅在当前场景使用。 */
    const replayedResult = adapter.requests[1]!.messages
      .flatMap(message => message.content)
      .find(block => block.type === 'tool-result')
    expect(replayedResult).toMatchObject({ toolCallId: 'c1', isError: true })
    expect(reasons).toEqual([
      { kind: 'aborted', reason: { kind: 'user' } },
      { kind: 'completed' },
    ])
  })

  it('a prompt sent AFTER a cancelled turn settles runs normally (marker reset)', async () => {
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter(['hang', textResponse('second reply')])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await harness(adapter)
    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })

    // First turn hangs; cancel it mid-step.
    send(agent, 'first')
    await new Promise(r => setTimeout(r, 30))
    agent.cancel({ kind: 'user' })
    await waitForIdle(ctx, agent)

    // The marker must have been reset after the cancelled turn — a fresh prompt
    // runs to completion rather than being dropped by a stale marker.
    send(agent, 'second')
    await waitForIdle(ctx, agent)

    expect(userTexts(agent)).toContain('second')
    // The second turn completed (its reply was streamed).
    /** 中文说明：测试局部值 reasons，由紧邻初始化决定，仅在当前场景使用。 */
    const reasons = agent.session.events.filter(e => e.type === 'turn/end')
    expect(reasons.length).toBe(2)
  })

  it('cancel mid-stream finalizes the streamed prefix onto the surface', async () => {
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter(['hang', textResponse('after')])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await harness(adapter)
    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = ctx.agentLoop.create(SessionId('partial-finalize'), { provider: 'mock', model: 'mock' })

    send(agent, 'go')
    await new Promise(r => setTimeout(r, 30))
    agent.cancel({ kind: 'user' })
    await waitForIdle(ctx, agent)

    // The prefix the user watched stream is committed as the step's message,
    // carrying the truncation marker and citing exactly the chunk events that
    // delivered it.
    /** 中文说明：测试局部值 message，由紧邻初始化决定，仅在当前场景使用。 */
    const message = agent.session.events.find(e => e.type === 'assistant/message')
    expect(message?.type === 'assistant/message' ? message.data.message.content : undefined)
      .toEqual([{ type: 'text', text: 'partial' }])
    expect(message?.type === 'assistant/message' ? message.data.interrupted : undefined).toBe(true)
    /** 中文说明：测试局部值 chunkSeqs，由紧邻初始化决定，仅在当前场景使用。 */
    const chunkSeqs = agent.session.events.filter(e => e.type === 'assistant/chunk').map(e => e.seq)
    expect(message?.sourceEventSeqs).toEqual(chunkSeqs)
    /** 中文说明：测试局部值 types，由紧邻初始化决定，仅在当前场景使用。 */
    const types = agent.session.events.map(e => e.type)
    expect(types.indexOf('assistant/message')).toBeLessThan(types.indexOf('step/end'))
    expect(types.indexOf('step/end')).toBeLessThan(types.indexOf('turn/end'))

    // The next request derives the finalized prefix: the model sees what the user saw.
    send(agent, 'continue')
    await waitForIdle(ctx, agent)
    /** 中文说明：测试局部值 replayed，由紧邻初始化决定，仅在当前场景使用。 */
    const replayed = adapter.requests[1]!.messages
      .filter(m => m.role === 'assistant')
      .flatMap(m => m.content)
      .flatMap(b => b.type === 'text' ? [b.text] : [])
    expect(replayed).toContain('partial')
  })

  it('cancel during reasoning-only streaming finalizes the reasoning prefix', async () => {
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter([{
      hangAfter: [
        { type: 'block-start', index: 0, blockType: 'reasoning' },
        { type: 'reasoning-delta', index: 0, text: 'thinking about it' },
        { type: 'usage', usage: { inputTokens: 7, outputTokens: 4 } },
      ],
    }])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await harness(adapter)
    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = ctx.agentLoop.create(SessionId('reasoning-finalize'), { provider: 'mock', model: 'mock' })

    send(agent, 'go')
    await new Promise(r => setTimeout(r, 30))
    agent.cancel({ kind: 'user' })
    await waitForIdle(ctx, agent)

    /** 中文说明：测试局部值 message，由紧邻初始化决定，仅在当前场景使用。 */
    const message = agent.session.events.find(e => e.type === 'assistant/message')
    expect(message?.type === 'assistant/message' ? message.data.message.content : undefined)
      .toEqual([{ type: 'reasoning', text: 'thinking about it' }])
    // A usage chunk delivered before the cancel travels with the finalized prefix.
    expect(message?.type === 'assistant/message' ? message.data.usage : undefined)
      .toEqual({ inputTokens: 7, outputTokens: 4 })
  })

  it('cancel drops a half-streamed tool call and keeps the completed text before it', async () => {
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter([{
      hangAfter: [
        { type: 'block-start', index: 0, blockType: 'text' },
        { type: 'text-delta', index: 0, text: 'reading the file' },
        { type: 'block-end', index: 0, block: { type: 'text', text: 'reading the file' } },
        { type: 'block-start', index: 1, blockType: 'tool-call' },
        { type: 'tool-call-delta', index: 1, id: CallId('c1'), name: 'read', argumentsDelta: '{"pa' },
      ],
    }])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await harness(adapter)
    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = ctx.agentLoop.create(SessionId('tool-call-drop'), { provider: 'mock', model: 'mock' })

    send(agent, 'go')
    await new Promise(r => setTimeout(r, 30))
    agent.cancel({ kind: 'user' })
    await waitForIdle(ctx, agent)

    // The undispatched call is dropped whole — no dangling tool_use to pair.
    /** 中文说明：测试局部值 message，由紧邻初始化决定，仅在当前场景使用。 */
    const message = agent.session.events.find(e => e.type === 'assistant/message')
    expect(message?.type === 'assistant/message' ? message.data.message.content : undefined)
      .toEqual([{ type: 'text', text: 'reading the file' }])
    expect(agent.session.events.some(e => e.type === 'tool/call')).toBe(false)
  })

  it('cancel during error recovery does not finalize the failed stream', async () => {
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter([[
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'text-delta', index: 0, text: 'doomed partial' },
      { type: 'finish', reason: { kind: 'error', failure: { message: 'boom', code: 'SERVER_ERROR' } } },
    ]])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await harness(adapter)
    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = ctx.agentLoop.create(SessionId('recovery-cancel'), { provider: 'mock', model: 'mock' })
    // Cancellation lands while agent/request-error is in flight — the window
    // dsh-llm-retry opens when its backoff waits after appending llm/retry.
    ctx.on('agent/request-error', async ({ agent: subject }) => {
      if (subject === agent) subject.cancel({ kind: 'user' })
    })

    send(agent, 'go')
    await waitForIdle(ctx, agent)

    // The failed stream's prefix stays off the surface: clients reset it on
    // retry, and provider failures commit nothing.
    expect(agent.session.events.some(e => e.type === 'assistant/message')).toBe(false)
    /** 中文说明：测试局部值 end，由紧邻初始化决定，仅在当前场景使用。 */
    const end = agent.session.events.find(e => e.type === 'turn/end')
    expect(end?.type === 'turn/end' ? end.data.reason.kind : undefined).toBe('aborted')
  })

  it('retry discards the failed attempt; the final message cites only its own chunks', async () => {
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter([
      [
        { type: 'block-start', index: 0, blockType: 'text' },
        { type: 'text-delta', index: 0, text: 'doomed partial' },
        { type: 'finish', reason: { kind: 'error', failure: { message: 'boom', code: 'SERVER_ERROR' } } },
      ],
      textResponse('recovered'),
    ])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await harness(adapter)
    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = ctx.agentLoop.create(SessionId('retry-discards-content'), { provider: 'mock', model: 'mock' })
    ctx.on('agent/request-error', async () => ({ kind: 'retry' as const }))

    send(agent, 'go')
    await waitForIdle(ctx, agent)

    /** 中文说明：测试局部值 messages，由紧邻初始化决定，仅在当前场景使用。 */
    const messages = agent.session.events.filter(e => e.type === 'assistant/message')
    expect(messages).toHaveLength(1)
    /** 中文说明：测试局部值 message，由紧邻初始化决定，仅在当前场景使用。 */
    const message = messages[0]!
    expect(message.type === 'assistant/message' ? message.data.message.content : undefined)
      .toEqual([{ type: 'text', text: 'recovered' }])
    expect(message.type === 'assistant/message' ? message.data.interrupted : undefined).toBeUndefined()
    // The abandoned attempt's chunks stay out of the completion's source set.
    /** 中文说明：测试局部值 doomedSeqs，由紧邻初始化决定，仅在当前场景使用。 */
    const doomedSeqs = agent.session.events
      .filter(e => e.type === 'assistant/chunk'
        && e.data.chunk.type === 'text-delta' && e.data.chunk.text === 'doomed partial')
      .map(e => e.seq)
    expect(doomedSeqs).toHaveLength(1)
    expect(message.sourceEventSeqs).not.toContain(doomedSeqs[0])
  })

  it('cancel before any visible content finalizes nothing', async () => {
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter([{
      hangAfter: [
        { type: 'block-start', index: 0, blockType: 'tool-call' },
        { type: 'tool-call-delta', index: 0, id: CallId('c1'), name: 'read', argumentsDelta: '{"pa' },
      ],
    }])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await harness(adapter)
    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = ctx.agentLoop.create(SessionId('nothing-to-finalize'), { provider: 'mock', model: 'mock' })

    send(agent, 'go')
    await new Promise(r => setTimeout(r, 30))
    agent.cancel({ kind: 'user' })
    await waitForIdle(ctx, agent)

    expect(agent.session.events.some(e => e.type === 'assistant/message')).toBe(false)
  })

  it('cancel from a synchronous step/start session-event listener drops the step (post-step-start window)', async () => {
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter([textResponse('should not stream')])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await harness(adapter)
    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })

    // A step/start session-event listener fires AFTER step/start is appended
    // (and after the pre-step extension point), so cancelling there lands in the SECOND
    // cancel check (the one that must closeStep() to balance the already-open
    // step) — distinct from a turn-start cancel, caught before the step opens.
    /** 中文说明：测试局部值 streamed，由紧邻初始化决定，仅在当前场景使用。 */
    let streamed = false
    ctx.on('session/event', (_s, event) => { if (event.type === 'assistant/chunk') streamed = true })
    /** 中文说明：测试局部值 dispose，由紧邻初始化决定，仅在当前场景使用。 */
    const dispose = ctx.on('session/event', (session, event) => {
      if (session === agent.session && event.type === 'step/start') agent.cancel({ kind: 'user' })
    })

    /** 中文说明：测试局部值 reasons，由紧邻初始化决定，仅在当前场景使用。 */
    const reasons: TurnEndReason[] = []
    ctx.on('session/event', (_s, event) => { if (event.type === 'turn/end') reasons.push(event.data.reason) })

    send(agent, 'go')
    await waitForIdle(ctx, agent)
    dispose()

    // No step streamed, the turn ended with the coarse aborted outcome, and the
    // log is balanced (the open step was closed by the cancel branch).
    expect(streamed).toBe(false)
    expect(reasons).toEqual([{ kind: 'aborted', reason: { kind: 'user' } }])
    /** 中文说明：测试局部值 types，由紧邻初始化决定，仅在当前场景使用。 */
    const types = agent.session.events.map(e => e.type)
    expect(types.filter(t => t === 'step/start').length).toBe(types.filter(t => t === 'step/end').length)
  })

  it('disposal from a synchronous step/start session-event listener stops before adapter dispatch', async () => {
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter([textResponse('should not stream')])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(SessionStore)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(AgentLoop, { agents: [] })
    ctx.llm.registerAdapter(['mock'], adapter)

    /** 中文说明：测试局部值 handle，由紧邻初始化决定，仅在当前场景使用。 */
    const handle = await ctx.agents.create({
      sessionId: SessionId('dispose-step-start-session'),
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = handle.agent

    /** 中文说明：测试局部值 解构结果，由紧邻初始化决定，仅在当前场景使用。 */
    let disposalDone: Promise<void> | undefined
    /** 中文说明：测试局部值 streamed，由紧邻初始化决定，仅在当前场景使用。 */
    let streamed = false
    ctx.on('session/event', (_s, event) => { if (event.type === 'assistant/chunk') streamed = true })
    ctx.on('session/event', (session, event) => {
      if (session === agent.session && event.type === 'step/start') disposalDone = handle.dispose()
    })

    send(agent, 'go')
    await disposalDone
    await driverDone(agent)

    expect(streamed).toBe(false)
    expect(adapter.requests).toHaveLength(0)
    expect(agent.session.events.some(e => e.type === 'turn/end')).toBe(false)
    /** 中文说明：测试局部值 types，由紧邻初始化决定，仅在当前场景使用。 */
    const types = agent.session.events.map(e => e.type)
    expect(types.filter(t => t === 'step/start').length).toBe(types.filter(t => t === 'step/end').length)
  })

  it('cancel during the stopping window ends the turn aborted and runs no further step', async () => {
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter([textResponse('one'), textResponse('two')])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await harness(adapter)
    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })

    /** 中文说明：测试局部值 steps，由紧邻初始化决定，仅在当前场景使用。 */
    let steps = 0
    /** 中文说明：测试局部值 reasons，由紧邻初始化决定，仅在当前场景使用。 */
    const reasons: TurnEndReason[] = []
    ctx.on('session/event', (_session, event) => {
      if (event.type === 'step/start') steps += 1
      if (event.type === 'turn/end') reasons.push(event.data.reason)
    })

    /** 中文说明：测试局部值 cancelled，由紧邻初始化决定，仅在当前场景使用。 */
    let cancelled = false
    ctx.on('agent/turn-stopping', ({ agent: subject }) => {
      if (subject === agent && !cancelled) {
        cancelled = true
        agent.cancel({ kind: 'user' })
      }
    })

    send(agent, 'go')
    await waitForIdle(ctx, agent)

    // Only ONE step ran (the second was cancelled in the stopping window),
    // and the shared turn signal classified the durable outcome as aborted.
    expect(steps).toBe(1)
    expect(reasons).toEqual([{ kind: 'aborted', reason: { kind: 'user' } }])
  })

  it('cancel from a synchronous agent/status(running) listener drops the turn (window 2)', async () => {
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter([textResponse('should not run')])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await harness(adapter)
    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })

    // `agent/status` is synchronous, so cancellation can land before the
    // durable turn-start commit and must drop the reserved work.
    /** 中文说明：测试局部值 streamed，由紧邻初始化决定，仅在当前场景使用。 */
    let streamed = false
    ctx.on('session/event', (_s, event) => { if (event.type === 'assistant/chunk') streamed = true })
    /** 中文说明：测试局部值 dispose，由紧邻初始化决定，仅在当前场景使用。 */
    const dispose = ctx.on('agent/status', ({ agent: subject, status }) => {
      if (subject === agent && status === 'running') agent.cancel({ kind: 'user' })
    })

    send(agent, 'go')
    await waitForIdle(ctx, agent)
    dispose()

    // No turn opened, no step streamed, and a later prompt still runs (the marker
    // was reset).
    expect(streamed).toBe(false)
    expect(agent.session.events.some(e => e.type === 'turn/start')).toBe(false)
  })

  it('a running-listener cancellation replays replacement work at convergence', async () => {
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter([textResponse('A reply'), textResponse('B reply')])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await harness(adapter)
    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })

    /** 中文说明：测试局部值 replaced，由紧邻初始化决定，仅在当前场景使用。 */
    let replaced = false
    /** 中文说明：测试局部值 dispose，由紧邻初始化决定，仅在当前场景使用。 */
    const dispose = ctx.on('agent/status', ({ agent: subject, status }) => {
      if (subject !== agent || status !== 'running' || replaced) return
      replaced = true
      agent.cancel({ kind: 'user' })
      send(agent, 'B')
    })

    send(agent, 'A')
    /** 中文说明：测试局部值 idle，由紧邻初始化决定，仅在当前场景使用。 */
    const idle = agent.whenIdle()
    await idle
    dispose()

    // B's wake was latched behind the cancelled driver: it runs on its own.
    expect(userTexts(agent)).toEqual(['B'])
    expect(agent.inbox.nextTurn).toHaveLength(0)
    expect(adapter.requests).toHaveLength(1)

    /** 中文说明：测试局部值 replacementIdle，由紧邻初始化决定，仅在当前场景使用。 */
    const replacementIdle = waitForIdle(ctx, agent)
    send(agent, 'C')
    await replacementIdle
    expect(userTexts(agent)).toEqual(['B', 'C'])
    expect(adapter.requests).toHaveLength(2)
    expect(agent.session.events.filter(event => event.type === 'turn/end')).toHaveLength(2)
  })

  it('a prompt queued during pre-step cancellation replays at convergence', async () => {
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter([textResponse('A reply'), textResponse('B reply')])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await harness(adapter)
    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })

    send(agent, 'A')
    /** 中文说明：测试局部值 idle，由紧邻初始化决定，仅在当前场景使用。 */
    const idle = agent.whenIdle()
    agent.cancel({ kind: 'user' })
    send(agent, 'B')

    await idle
    expect(userTexts(agent)).toEqual(['B'])
    expect(agent.inbox.nextTurn).toHaveLength(0)
    expect(adapter.requests).toHaveLength(1)

    /** 中文说明：测试局部值 replacementIdle，由紧邻初始化决定，仅在当前场景使用。 */
    const replacementIdle = waitForIdle(ctx, agent)
    send(agent, 'C')
    await replacementIdle
    expect(userTexts(agent)).toEqual(['B', 'C'])
    expect(adapter.requests).toHaveLength(2)
    expect(agent.session.events.filter(event => event.type === 'turn/end')).toHaveLength(3)
  })

  it("cancel clears the turn's steering — it is not re-enqueued as a fresh turn", async () => {
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter(['hang'])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await harness(adapter)
    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })

    send(agent, 'go')
    await new Promise(r => setTimeout(r, 30))
    expect(agent.status).toBe('running')
    // Steer (joins the running turn's steering FIFO), then cancel: the steering
    // must be dropped, NOT re-enqueued as a new queued turn.
    agent.steer(createUserMessage({ content: [{ type: 'text', text: 'steer text' }], source: { kind: 'user' } }))
    agent.cancel({ kind: 'user' })
    await waitForIdle(ctx, agent)

    // After the cancelled turn settles, the agent is idle with NO follow-up turn
    // started from the dropped steering.
    await new Promise(r => setTimeout(r, 30))
    expect(agent.status).toBe('idle')
    /** 中文说明：测试局部值 turnStarts，由紧邻初始化决定，仅在当前场景使用。 */
    const turnStarts = agent.session.events.filter(e => e.type === 'turn/start')
    expect(turnStarts.length).toBe(1) // only the original (cancelled) turn
    // The steering text was dropped — it never reached the log.
    /** 中文说明：测试局部值 flat，由紧邻初始化决定，仅在当前场景使用。 */
    const flat = agent.session.events
      .filter(e => e.type === 'user/message')
      .flatMap(e => e.data.content)
      .flatMap(b => b.type === 'text' ? [b.text] : [])
    expect(flat).not.toContain('steer text')
  })

  it('replays replacement work queued synchronously by an abort observer', async () => {
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter([
      'hang',
      textResponse('replacement reply'),
      textResponse('wake reply'),
    ])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await harness(adapter)
    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = ctx.agentLoop.create(SessionId('abort-observer-replacement'), { provider: 'mock', model: 'mock' })

    send(agent, 'original')
    await expect.poll(() => adapter.requests.length).toBe(1)
    /** 中文说明：测试局部值 signal，由紧邻初始化决定，仅在当前场景使用。 */
    const signal = adapter.requests[0]?.signal
    if (signal === undefined) throw new Error('model request omitted its turn signal')
    signal.addEventListener('abort', () => { send(agent, 'replacement') }, { once: true })
    /** 中文说明：测试局部值 idle，由紧邻初始化决定，仅在当前场景使用。 */
    const idle = agent.whenIdle()
    agent.cancel({ kind: 'user' })
    await Promise.race([
      idle,
      new Promise((_resolve, reject) => {
        setTimeout(() => {
          reject(new Error(`replacement did not settle: ${JSON.stringify({
            status: agent.status,
            requests: adapter.requests.length,
            users: userTexts(agent),
            events: agent.session.events.map(event => event.type),
          })}`))
        }, 1000)
      }),
    ])

    // The abort-observer wake was latched: replacement runs at convergence,
    // so the original turn is followed by a completed replacement turn.
    expect(adapter.requests).toHaveLength(2)
    expect(userTexts(agent)).toEqual(['original', 'replacement'])
    expect(agent.inbox.nextTurn).toHaveLength(0)
    /** 中文说明：测试局部值 reasons，由紧邻初始化决定，仅在当前场景使用。 */
    const reasons = agent.session.events
      .filter(event => event.type === 'turn/end')
      .map(event => event.type === 'turn/end' ? event.data.reason : undefined)
    expect(reasons).toEqual([{ kind: 'aborted', reason: { kind: 'user' } }, { kind: 'completed' }])

    /** 中文说明：测试局部值 replacementIdle，由紧邻初始化决定，仅在当前场景使用。 */
    const replacementIdle = waitForIdle(ctx, agent)
    send(agent, 'wake it')
    await replacementIdle
    expect(adapter.requests).toHaveLength(3)
    expect(userTexts(agent)).toEqual(['original', 'replacement', 'wake it'])
  })

  it('keeps the first typed cause for an active turn', async () => {
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter(['hang'])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await harness(adapter)
    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = ctx.agentLoop.create(SessionId('typed-first-wins'), { provider: 'mock', model: 'mock' })
    /** 中文说明：测试局部值 supplied，由紧邻初始化决定，仅在当前场景使用。 */
    const supplied: { kind: 'parent' | 'user' } = { kind: 'parent' }

    send(agent, 'go')
    await expect.poll(() => adapter.requests.length).toBe(1)
    agent.cancel(supplied)
    agent.cancel({ kind: 'user' })
    await waitForIdle(ctx, agent)

    /** 中文说明：测试局部值 runtimeReason，由紧邻初始化决定，仅在当前场景使用。 */
    const runtimeReason: unknown = adapter.requests[0]?.signal?.reason
    expect(runtimeReason).toEqual({ kind: 'parent' })
    expect(runtimeReason).toBe(supplied)
    /** 中文说明：测试局部值 turnEnd，由紧邻初始化决定，仅在当前场景使用。 */
    const turnEnd = agent.session.events.findLast(event => event.type === 'turn/end')
    expect(turnEnd?.type === 'turn/end' && turnEnd.data.reason).toEqual({
      kind: 'aborted',
      reason: { kind: 'parent' },
    })
  })

  it('preserves the first user cancellation when lifecycle teardown races it', async () => {
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter(['hang'])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await harness(adapter)
    /** 中文说明：测试局部值 handle，由紧邻初始化决定，仅在当前场景使用。 */
    const handle = await ctx.agents.create({
      sessionId: SessionId('cancel-dispose-race'),
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    /** 中文说明：测试局部值 { agent }，由紧邻初始化决定，仅在当前场景使用。 */
    const { agent } = handle

    send(agent, 'go')
    await expect.poll(() => adapter.requests.length).toBe(1)
    agent.cancel({ kind: 'user' })
    await handle.dispose()

    /** 中文说明：测试局部值 turnEnd，由紧邻初始化决定，仅在当前场景使用。 */
    const turnEnd = agent.session.events.findLast(event => event.type === 'turn/end')
    expect(turnEnd?.type === 'turn/end' && turnEnd.data.reason).toEqual({ kind: 'aborted', reason: { kind: 'user' } })
  })

  it.each([
    'pre-step',
    'system-prompt',
    'request',
    'stopping',
    'tool',
  ] as const)('lets a cooperative %s boundary settle from the explicit turn signal', async (stage) => {
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter(stage === 'tool'
      ? [toolCallResponse('blocked-tool', 'blocked', {})]
      : [textResponse('done')])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await harness(adapter)
    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = ctx.agentLoop.create(SessionId(`cooperative-${stage}`), { provider: 'mock', model: 'mock' })
    /** 中文说明：测试局部值 started，由紧邻初始化决定，仅在当前场景使用。 */
    const started = Promise.withResolvers<undefined>()
    /** 中文说明：测试局部值 blockUntilAbort，由紧邻初始化决定，仅在当前场景使用。 */
    const blockUntilAbort = async (signal: AbortSignal): Promise<void> => {
      started.resolve(undefined)
      if (signal.aborted) return
      await new Promise<void>((resolve) => {
        signal.addEventListener('abort', () => { resolve() }, { once: true })
      })
    }

    switch (stage) {
      case 'pre-step':
        ctx.on('agent/pre-step', async ({ agent: subject, signal }, next) => {
          if (subject === agent) await blockUntilAbort(signal)
          return next()
        })
        break
      case 'system-prompt':
        ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
          if (context.agent === agent) {
            if (context.signal === undefined) throw new Error('turn assembly omitted its signal')
            await blockUntilAbort(context.signal)
          }
          return next()
        })
        break
      case 'request':
        ctx.on('agent/request', async ({ agent: subject, signal }, next) => {
          if (subject === agent) await blockUntilAbort(signal)
          return next()
        })
        break
      case 'stopping':
        ctx.on('agent/turn-stopping', async ({ agent: subject, signal }) => {
          if (subject === agent) await blockUntilAbort(signal)
        })
        break
      case 'tool':
        ctx.tools.register(defineContentToolFixture({
          name: 'blocked',
          description: 'wait for cancellation',
          parameters: {},
          execute: async (_args, exec) => {
            if (exec.signal === undefined) throw new Error('tool execution omitted its signal')
            await blockUntilAbort(exec.signal)
            return [{ type: 'text', text: 'cancelled' }]
          },
        }))
        break
    }

    send(agent, 'go')
    await started.promise
    /** 中文说明：测试局部值 idle，由紧邻初始化决定，仅在当前场景使用。 */
    const idle = agent.whenIdle()
    agent.cancel({ kind: 'user' })
    await idle
    /** 中文说明：测试局部值 turnEnd，由紧邻初始化决定，仅在当前场景使用。 */
    const turnEnd = agent.session.events.findLast(event => event.type === 'turn/end')
    expect(turnEnd?.type === 'turn/end' && turnEnd.data.reason)
      .toEqual({ kind: 'aborted', reason: { kind: 'user' } })
    await ctx.fiber.dispose()
  })
})
