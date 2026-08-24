/**
 * 文件职责：验证Agent Loop的 coverage-edges.spec.ts 行为与不变量。
 * 技术维度：Vitest、Cordis、会话事件、模型适配器和可控工具夹具。
 * 产品维度：防止Agent Loop在取消、恢复、错误或并发场景中产生回归。
 * 逻辑维度：构造服务与事件，驱动执行流程，再断言日志、请求、状态和清理。
 * 关键边界：测试后台任务必须结束；模型可见输入必须可从日志重建；工具调用顺序不可破坏。
 * 新手阅读建议：先读 mock/辅助函数，再按成功、错误、恢复和生命周期场景阅读。
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { createUserMessage, CallId, LlmError, StreamChunk, errorChain  } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId, TurnEndReason } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
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

/** 中文说明：测试辅助函数 waitForIdle 的参数见签名，返回值用于驱动或断言场景；示例见下方用例。 */
function waitForIdle(ctx: Context, agent: Agent): Promise<void> {
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

/** 中文说明：测试辅助函数 send 的参数见签名，返回值用于驱动或断言场景；示例见下方用例。 */
function send(agent: Agent, text: string) {
  agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
}

describe('tool JSON parse', () => {
  it('passes through non-JSON arguments string without crashing', async () => {
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter([
      // model emits tool-call with malformed arguments (not valid JSON)
      [
        { type: 'block-start' as const, index: 0, blockType: 'tool-call' as const },
        { type: 'block-end' as const, index: 0, block: { type: 'tool-call' as const, id: CallId('c1'), name: 'echo', arguments: 'not json' } },
        { type: 'finish' as const, reason: { kind: 'tool-calls' as const } },
      ] satisfies StreamChunk[],
      textResponse('done'),
    ])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await harness(adapter)
    ctx.tools.register(defineContentToolFixture({
      name: 'echo',
      description: 'echo tool',
      parameters: { input: { type: 'string' } },
      async execute(args: unknown) {
        return [{ type: 'text', text: typeof args === 'string' ? `raw: ${args}` : JSON.stringify(args) }]
      },
    }))
    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })

    send(agent, 'use tool')
    await waitForIdle(ctx, agent)

    // tool/call event should have recorded the raw arguments string
    /** 中文说明：测试局部值 callEvent，由紧邻初始化决定，仅在当前场景使用。 */
    const callEvent = agent.session.events.find(e => e.type === 'tool/call')
    expect(callEvent).toBeDefined()
    if (callEvent!.type === 'tool/call') {
      expect(callEvent!.data.arguments).toBe('not json')
    }
    // the loop did not crash — a result was produced
    expect(agent.session.events.some(e => e.type === 'tool/result')).toBe(true)
  })

  it('uses empty object when tool-call arguments are empty string', async () => {
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter([
      [
        { type: 'block-start' as const, index: 0, blockType: 'tool-call' as const },
        { type: 'block-end' as const, index: 0, block: { type: 'tool-call' as const, id: CallId('c1'), name: 'noarg', arguments: '' } },
        { type: 'finish' as const, reason: { kind: 'tool-calls' as const } },
      ] satisfies StreamChunk[],
      textResponse('done'),
    ])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await harness(adapter)
    ctx.tools.register(defineContentToolFixture({
      name: 'noarg',
      description: 'no-arg tool',
      parameters: {},
      async execute() {
        return [{ type: 'text', text: 'ran with empty args' }]
      },
    }))
    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })

    send(agent, 'use tool')
    await waitForIdle(ctx, agent)

    expect(agent.session.events.some(e => e.type === 'tool/result')).toBe(true)
  })
})

describe('thrown-value propagation', () => {
  it('preserves non-Error throws from pre-commit dispatch validation', async () => {
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter([textResponse('ok')])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await harness(adapter)
    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })

    /** 中文说明：测试局部值 threwOnce，由紧邻初始化决定，仅在当前场景使用。 */
    let threwOnce = false
    ctx.on('internal/dispatch', (_mode, name, args) => {
      if (name !== 'session/event') return
      /** 中文说明：测试局部值 event，由紧邻初始化决定，仅在当前场景使用。 */
      const event = args[1] as SessionEvent
      if (event.type === 'turn/start' && !threwOnce) {
        threwOnce = true
        throw 'naked string error'
      }
    })

    /** 中文说明：测试局部值 errors，由紧邻初始化决定，仅在当前场景使用。 */
    const errors: unknown[] = []
    ctx.on('agent/error', ({ error }) => void errors.push(error))

    send(agent, 'fails before turn start')
    send(agent, 'survives as the next item')
    await waitForIdle(ctx, agent)
    expect(errors).toHaveLength(1)
    expect(errors[0]).toBe('naked string error')
    expect(adapter.requests).toHaveLength(0)
    /** 中文说明：测试局部值 starts，由紧邻初始化决定，仅在当前场景使用。 */
    const starts = agent.session.events.filter(event => event.type === 'turn/start')
    /** 中文说明：测试局部值 ends，由紧邻初始化决定，仅在当前场景使用。 */
    const ends = agent.session.events.filter(event => event.type === 'turn/end')
    /** 中文说明：测试局部值 messages，由紧邻初始化决定，仅在当前场景使用。 */
    const messages = agent.session.events.filter(event => event.type === 'user/message')
    expect(starts).toHaveLength(0)
    expect(ends).toHaveLength(0)
    expect(messages).toHaveLength(0)
    expect(agent.inbox.nextTurn).toHaveLength(2)
  })

  it('preserves non-Error throws from the agent/request waterfall', async () => {
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter([textResponse('irrelevant')])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await harness(adapter)
    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })

    /** 中文说明：测试局部值 threwOnce，由紧邻初始化决定，仅在当前场景使用。 */
    let threwOnce = false
    ctx.on('agent/request', async (_payload, next) => {
      if (!threwOnce) {
        threwOnce = true
        throw { code: 500 }
      }
      return next()
    })

    send(agent, 'go')
    await waitForIdle(ctx, agent)
    /** 中文说明：测试局部值 turnEnd，由紧邻初始化决定，仅在当前场景使用。 */
    const turnEnd = agent.session.events.find(e => e.type === 'turn/end')
    expect(turnEnd?.type === 'turn/end' && turnEnd.data.reason.kind === 'error'
      ? turnEnd.data.reason.error.message
      : undefined).toBe('[object Object]')
  })
})

describe('durable error rendering', () => {
  it('renders a coded error thrown from a plugin', async () => {
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter([textResponse('turn 1')])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await harness(adapter)
    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })

    /** 中文说明：测试局部值 threwOnce，由紧邻初始化决定，仅在当前场景使用。 */
    let threwOnce = false
    ctx.on('agent/request', async (_payload, next) => {
      if (!threwOnce) {
        threwOnce = true
        throw new LlmError('server overloaded', 'RATE_LIMIT')
      }
      return next()
    })

    send(agent, 'go')
    await waitForIdle(ctx, agent)

    /** 中文说明：测试局部值 turnEnd，由紧邻初始化决定，仅在当前场景使用。 */
    const turnEnd = agent.session.events.find(e => e.type === 'turn/end')
    expect(turnEnd).toBeDefined()
    if (turnEnd?.type === 'turn/end' && turnEnd.data.reason.kind === 'error') {
      expect(turnEnd.data.reason.error).toEqual({
        message: 'server overloaded',
        code: 'RATE_LIMIT',
      })
    }
  })
})

describe('disposed vs aborted branching', () => {
  it('handles dispose during model streaming producing reason "disposed"', async () => {
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter(['hang'])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await harness(adapter)
    /** 中文说明：测试局部值 agent!: Agent，由紧邻初始化决定，仅在当前场景使用。 */
    let agent!: Agent
    /** 中文说明：测试局部值 fiber，由紧邻初始化决定，仅在当前场景使用。 */
    const fiber = await ctx.plugin(Object.assign((inner: Context) => {
      agent = inner.agentLoop.create(SessionId('scoped'), { provider: 'mock', model: 'mock' })
    }, { inject: ['agentLoop'] }))

    /** 中文说明：测试局部值 reasons，由紧邻初始化决定，仅在当前场景使用。 */
    const reasons: TurnEndReason[] = []
    ctx.on('session/event', (_s, event) => { if (event.type === 'turn/end') reasons.push(event.data.reason) })

    send(agent, 'go')
    await new Promise(r => setTimeout(r, 30))
    await fiber.dispose() // dispose during hang
    await driverDone(agent)

    // Disposal wins abort classification because the error path checks it first.
    expect(reasons).toContainEqual({ kind: 'aborted', reason: { kind: 'disposed' } })
  })
})

describe('structured tool error propagation (the runtime-validation Agent Note, part 2)', () => {
  it('forwards a tool HarnessError onto the tool/result session event', async () => {
    /** 中文说明：测试局部值 { HarnessError }，由紧邻初始化决定，仅在当前场景使用。 */
    const { HarnessError } = await import('@deepseek-ai/dsh-llm')
    // First model turn calls the tool; second turn (after the tool result is
    // fed back) ends with plain text so the loop settles.
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter([
      toolCallResponse('c1', 'boom', {}),
      textResponse('done'),
    ])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await harness(adapter)
    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
    ctx.tools.register(defineContentToolFixture({
      name: 'boom',
      description: 'always fails',
      parameters: {},
      async execute() {
        throw new HarnessError('exploded', 'BOOM')
      },
    }))

    send(agent, 'go')
    await waitForIdle(ctx, agent)

    /** 中文说明：测试局部值 toolResult，由紧邻初始化决定，仅在当前场景使用。 */
    const toolResult = agent.session.events.find(e => e.type === 'tool/result')
    expect(toolResult?.type === 'tool/result' && toolResult.data.message.content[0].isError).toBe(true)
    expect(toolResult?.type === 'tool/result' && toolResult.data.error)
      .toEqual({ name: 'HarnessError', code: 'BOOM' })
  })
})

describe('request-error action edges', () => {
  it('ignores a retry action returned after the turn was aborted', async () => {
    /** 中文说明：测试局部值 { LlmError }，由紧邻初始化决定，仅在当前场景使用。 */
    const { LlmError } = await import('@deepseek-ai/dsh-llm')
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter([
      () => { throw new LlmError('busy', 'RATE_LIMIT') },
      textResponse('never used'),
    ])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await harness(adapter)
    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = ctx.agentLoop.create(SessionId('retry-after-cancel'), { provider: 'mock', model: 'mock' })
    ctx.on('agent/request-error', async ({ agent: subject }) => {
      subject.cancel({ kind: 'user' })
      return { kind: 'retry' }
    })

    send(agent, 'go')
    await agent.whenIdle()

    // One failed request, no retry turn.
    expect(adapter.requests).toHaveLength(1)
    /** 中文说明：测试局部值 ends，由紧邻初始化决定，仅在当前场景使用。 */
    const ends = agent.session.events.filter(e => e.type === 'turn/end')
    expect(ends).toHaveLength(1)
  })

  it('completed recovery does not retry when cancellation raced the waterfall', async () => {
    /** 中文说明：测试局部值 { LlmError }，由紧邻初始化决定，仅在当前场景使用。 */
    const { LlmError } = await import('@deepseek-ai/dsh-llm')
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter([
      () => { throw new LlmError('busy', 'RATE_LIMIT') },
    ])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await harness(adapter)
    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = ctx.agentLoop.create(SessionId('retry-raced'), { provider: 'mock', model: 'mock' })
    ctx.on('agent/request-error', async ({ agent: subject, signal }, next) => {
      await next()
      subject.cancel({ kind: 'user' })
      expect(signal.aborted).toBe(true)
      return { kind: 'retry' }
    })

    send(agent, 'go')
    await agent.whenIdle()

    expect(adapter.requests).toHaveLength(1)
    /** 中文说明：测试局部值 end，由紧邻初始化决定，仅在当前场景使用。 */
    const end = agent.session.events.findLast(e => e.type === 'turn/end')
    expect(end?.type === 'turn/end' && end.data.reason.kind).toBe('aborted')
  })
})

describe('stream failure edges', () => {
  it('rethrows a mid-stream throw that carries no adapter failure facts', async () => {
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter([textResponse('will be vetoed')])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await harness(adapter)
    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = ctx.agentLoop.create(SessionId('stream-no-facts'), { provider: 'mock', model: 'mock' })
    /** 中文说明：测试局部值 recoveries，由紧邻初始化决定，仅在当前场景使用。 */
    let recoveries = 0
    ctx.on('agent/request-error', async () => { recoveries += 1 })
    // A pre-commit chunk veto throws INSIDE the stream-consumption try, but it
    // is not an adapter-boundary failure, so llmFailureOf yields no facts.
    /** 中文说明：测试局部值 vetoed，由紧邻初始化决定，仅在当前场景使用。 */
    let vetoed = false
    ctx.on('internal/dispatch', (_mode, name, args) => {
      if (name !== 'session/event') return
      /** 中文说明：测试局部值 event，由紧邻初始化决定，仅在当前场景使用。 */
      const event = args[1] as SessionEvent
      if (event.type === 'assistant/chunk' && !vetoed) {
        vetoed = true
        throw new Error('reject the first chunk')
      }
    })

    send(agent, 'go')
    await agent.whenIdle()

    // No facts -> not offered to recovery; the turn fails through settle().
    expect(recoveries).toBe(0)
    /** 中文说明：测试局部值 end，由紧邻初始化决定，仅在当前场景使用。 */
    const end = agent.session.events.findLast(e => e.type === 'turn/end')
    expect(end?.type === 'turn/end' && end.data.reason.kind).toBe('error')
  })
})

describe('post-turn continuation edges', () => {
  it('whenIdle resolves for a waiter whose awaited run fails', async () => {
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter([textResponse('unused')])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await harness(adapter)
    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = ctx.agentLoop.create(SessionId('whenidle-reject'), { provider: 'mock', model: 'mock' })
    /** 中文说明：测试局部值 rejected，由紧邻初始化决定，仅在当前场景使用。 */
    let rejected = false
    ctx.on('internal/dispatch', (_mode, name, args) => {
      if (name !== 'session/event') return
      /** 中文说明：测试局部值 event，由紧邻初始化决定，仅在当前场景使用。 */
      const event = args[1] as SessionEvent
      if (event.type === 'turn/start' && !rejected) {
        rejected = true
        throw new Error('veto turn start while a waiter is pending')
      }
    })

    send(agent, 'go')
    await expect(agent.whenIdle()).resolves.toBeUndefined()
    expect(agent.status).toBe('idle')
  })
})

describe('persistent step-close rejection', () => {
  it('still publishes the terminal status when both step-close attempts are vetoed', async () => {
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter([textResponse('will not close')])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await harness(adapter)
    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = ctx.agentLoop.create(SessionId('stepend-double-veto'), { provider: 'mock', model: 'mock' })
    // Persistently reject step/end: the catch's own close attempt fails too,
    // and the contained failure must not strand status at running.
    ctx.on('internal/dispatch', (_mode, name, args) => {
      if (name !== 'session/event') return
      /** 中文说明：测试局部值 event，由紧邻初始化决定，仅在当前场景使用。 */
      const event = args[1] as SessionEvent
      if (event.type === 'step/end') throw new Error('step close permanently rejected')
    })
    /** 中文说明：测试局部值 statuses，由紧邻初始化决定，仅在当前场景使用。 */
    const statuses: string[] = []
    ctx.on('agent/status', ({ agent: subject, status }) => { if (subject === agent) statuses.push(status) })

    send(agent, 'go')
    await agent.whenIdle()

    expect(agent.status).toBe('idle')
    expect(statuses).toEqual(['running', 'idle'])
  })
})

describe('tool result meta persistence', () => {
  it('records a presentationMeta payload on the tool/result event', async () => {
    /** 中文说明：测试局部值 { defineTool }，由紧邻初始化决定，仅在当前场景使用。 */
    const { defineTool } = await import('@deepseek-ai/dsh-tools')
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter([
      toolCallResponse('c1', 'meta-tool', {}),
      textResponse('done'),
    ])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await harness(adapter)
    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = ctx.agentLoop.create(SessionId('tool-meta'), { provider: 'mock', model: 'mock' })
    ctx.tools.register(defineTool({
      name: 'meta-tool',
      description: 'carries presentation meta',
      parameters: {},
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: value }],
        presentationMeta: () => ({ presentation: 'diff-card' }),
      },
      async execute() {
        return 'ran'
      },
    }))

    send(agent, 'go')
    await waitForIdle(ctx, agent)

    /** 中文说明：测试局部值 result，由紧邻初始化决定，仅在当前场景使用。 */
    const result = agent.session.events.find(e => e.type === 'tool/result')
    expect(result?.type === 'tool/result' && result.data.meta).toEqual({ presentation: 'diff-card' })
  })
})

describe('turn close failure containment', () => {
  it('a rejected turn/end append is contained: warn + agent/error, no retry', async () => {
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter([textResponse('ok')])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await harness(adapter)
    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = ctx.agentLoop.create(SessionId('turnend-veto'), { provider: 'mock', model: 'mock' })
    /** 中文说明：测试局部值 vetoed，由紧邻初始化决定，仅在当前场景使用。 */
    let vetoed = false
    ctx.on('internal/dispatch', (_mode, name, args) => {
      if (name !== 'session/event') return
      /** 中文说明：测试局部值 event，由紧邻初始化决定，仅在当前场景使用。 */
      const event = args[1] as SessionEvent
      if (event.type === 'turn/end' && !vetoed) {
        vetoed = true
        throw new Error('reject turn end')
      }
    })
    /** 中文说明：测试局部值 errors，由紧邻初始化决定，仅在当前场景使用。 */
    const errors: unknown[] = []
    ctx.on('agent/error', ({ error }) => { errors.push(error) })

    send(agent, 'go')
    await agent.whenIdle()

    // The close failure is reported live; the machine still reaches idle.
    expect(errors.map(e => e instanceof Error && e.message)).toContain('reject turn end')
    expect(agent.status).toBe('idle')
    expect(adapter.requests).toHaveLength(1)
  })
})

describe('recovery without a retry action', () => {
  it('a completed recovery that returns no action leaves the failed turn terminal', async () => {
    /** 中文说明：测试局部值 { LlmError }，由紧邻初始化决定，仅在当前场景使用。 */
    const { LlmError } = await import('@deepseek-ai/dsh-llm')
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter([
      () => { throw new LlmError('down', 'SERVICE_UNAVAILABLE') },
    ])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await harness(adapter)
    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = ctx.agentLoop.create(SessionId('recovery-no-retry'), { provider: 'mock', model: 'mock' })
    /** 中文说明：测试局部值 recoveries，由紧邻初始化决定，仅在当前场景使用。 */
    let recoveries = 0
    ctx.on('agent/request-error', async () => { recoveries += 1 })

    send(agent, 'go')
    await agent.whenIdle()

    expect(recoveries).toBe(1)
    expect(adapter.requests).toHaveLength(1)
    /** 中文说明：测试局部值 end，由紧邻初始化决定，仅在当前场景使用。 */
    const end = agent.session.events.findLast(e => e.type === 'turn/end')
    expect(end?.type === 'turn/end' && end.data.reason.kind).toBe('error')
  })
})

describe('unrenderable failure settlement', () => {
  it('drops the rendered message when the error chain cannot be rendered', async () => {
    /** 中文说明：测试局部值 { LlmError }，由紧邻初始化决定，仅在当前场景使用。 */
    const { LlmError } = await import('@deepseek-ai/dsh-llm')
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter([
      () => {
        /** 中文说明：测试局部值 error，由紧邻初始化决定，仅在当前场景使用。 */
        const error = new LlmError('will become hostile', 'SERVER')
        // A hostile message getter makes errorChain collapse to its sentinel;
        // settle() must then fall back to the failure facts alone.
        Object.defineProperty(error, 'message', {
          get() { throw new Error('hostile accessor') },
        })
        throw error
      },
    ])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await harness(adapter)
    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = ctx.agentLoop.create(SessionId('unrenderable'), { provider: 'mock', model: 'mock' })

    send(agent, 'go')
    await agent.whenIdle()

    /** 中文说明：测试局部值 end，由紧邻初始化决定，仅在当前场景使用。 */
    const end = agent.session.events.findLast(e => e.type === 'turn/end')
    expect(end?.type === 'turn/end' && end.data.reason.kind).toBe('error')
    if (end?.type === 'turn/end' && end.data.reason.kind === 'error') {
      // The durable failure keeps the adapter facts' message, not the
      // unrenderable chain.
      expect(errorChain(end.data.reason.error.message)).not.toBe('<unrenderable value>')
    }
  })
})

describe('driver bookkeeping edges', () => {
  it('rejects a direct turn invocation without a driver reservation', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await harness(new MockAdapter([]))
    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = ctx.agentLoop.create(SessionId('turn-without-reservation'), { provider: 'mock', model: 'mock' })

    await expect((agent as unknown as { turn(): Promise<boolean> }).turn())
      .rejects.toThrow('turn without driver reservation')
    expect(agent.status).toBe('idle')
  })

  it('closes an entered turn as blocked when its next step is rejected', async () => {
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter([textResponse('first step')])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await harness(adapter)
    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = ctx.agentLoop.create(SessionId('reject-next-step'), { provider: 'mock', model: 'mock' })
    /** 中文说明：测试局部值 proposals，由紧邻初始化决定，仅在当前场景使用。 */
    let proposals = 0
    ctx.on('agent/pre-step', async (_payload, next) => {
      proposals += 1
      return proposals === 2 ? { kind: 'reject' } : next()
    })
    ctx.on('agent/turn-stopping', ({ agent: subject }) => {
      subject.inject(createUserMessage({
        content: [{ type: 'text', text: 'do not enter the next step' }],
        source: { kind: 'plugin', plugin: 'test' },
      }))
    })

    send(agent, 'go')
    await agent.whenIdle()

    expect(proposals).toBe(2)
    expect(adapter.requests).toHaveLength(1)
    /** 中文说明：测试局部值 end，由紧邻初始化决定，仅在当前场景使用。 */
    const end = agent.session.events.findLast(event => event.type === 'turn/end')
    expect(end?.type === 'turn/end' && end.data.reason).toEqual({ kind: 'blocked' })
  })

  it('a request failure that concludes recovery after step/end closed keeps the boundary balanced', async () => {
    /** 中文说明：测试局部值 { LlmError }，由紧邻初始化决定，仅在当前场景使用。 */
    const { LlmError } = await import('@deepseek-ai/dsh-llm')
    // The failure finish-chunk path returns request-failed AFTER step() has
    // already appended step/end, so the request-failed branch's own
    // step-close guard must see stepOpen === false and skip the append.
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter([
      [
        { type: 'usage' as const, usage: { inputTokens: 1, outputTokens: 0 } },
        { type: 'finish' as const, reason: { kind: 'error' as const, failure: { message: 'empty', code: 'EMPTY_RESPONSE' } } },
      ] satisfies StreamChunk[],
    ])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await harness(adapter)
    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = ctx.agentLoop.create(SessionId('finish-after-close'), { provider: 'mock', model: 'mock' })
    void LlmError

    send(agent, 'go')
    await agent.whenIdle()

    /** 中文说明：测试局部值 types，由紧邻初始化决定，仅在当前场景使用。 */
    const types = agent.session.events.map(e => e.type)
    expect(types.filter(t => t === 'step/end')).toHaveLength(1)
    /** 中文说明：测试局部值 end，由紧邻初始化决定，仅在当前场景使用。 */
    const end = agent.session.events.findLast(e => e.type === 'turn/end')
    expect(end?.type === 'turn/end' && end.data.reason.kind).toBe('error')
  })
})
