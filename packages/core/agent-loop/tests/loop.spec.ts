/**
 * 文件职责：验证Agent Loop的 loop.spec.ts 行为与不变量。
 * 技术维度：Vitest、Cordis、会话事件、模型适配器和可控工具夹具。
 * 产品维度：防止Agent Loop在取消、恢复、错误或并发场景中产生回归。
 * 逻辑维度：构造服务与事件，驱动执行流程，再断言日志、请求、状态和清理。
 * 关键边界：测试后台任务必须结束；模型可见输入必须可从日志重建；工具调用顺序不可破坏。
 * 新手阅读建议：先读 mock/辅助函数，再按成功、错误、恢复和生命周期场景阅读。
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { createUserMessage, CallId, LlmError, StreamChunk  } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId, TurnEndReason } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'

import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { MockAdapter, maxTokensResponse, textResponse, toolCallResponse } from './mock-adapter.ts'

/** 中文说明：测试辅助函数 driverDone 的参数见签名，返回值用于驱动或断言场景；示例见下方用例。 */
function driverDone(agent: Agent): Promise<void> {
  return (agent as Agent & { done: Promise<void> }).done
}

/** 中文说明：测试辅助函数 harness 的参数见签名，返回值用于驱动或断言场景；示例见下方用例。 */
async function harness(adapter: MockAdapter, persona = '') {
  /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt, { persona })
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  ctx.llm.registerAdapter(['mock'], adapter)
  return ctx
}

/** Wait for the agent's next transition to idle after a waking send. */
/* 中文说明：测试辅助函数 waitForIdle 的参数见签名，返回值用于驱动或断言场景；示例见下方用例。 */
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

/** All user-message texts recorded in the log (to assert what actually ran). */
/* 中文说明：测试辅助函数 userTexts 的参数见签名，返回值用于驱动或断言场景；示例见下方用例。 */
function userTexts(agent: Agent): string[] {
  return agent.session.events
    .filter(e => e.type === 'user/message')
    .flatMap(e => e.type === 'user/message' ? e.data.content : [])
    .flatMap(b => b.type === 'text' ? [b.text] : [])
}

describe('agent loop', () => {
  it.each([0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid AgentOptions.maxTokens %s before publication',
    async (maxTokens) => {
      /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
      const ctx = await harness(new MockAdapter([]))
      expect(() => ctx.agentLoop.create(
        SessionId('invalid-max-tokens'),
        { provider: 'mock', model: 'mock', maxTokens },
      )).toThrow('agent maxTokens must be a positive safe integer')
      expect(ctx.agents.list()).toEqual([])
      expect(ctx.sessions.list()).toEqual([])
    },
  )

  it('seeds a valid AgentOptions.maxTokens into the first model request', async () => {
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter([textResponse('bounded')])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await harness(adapter)
    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = ctx.agentLoop.create(
      SessionId('valid-max-tokens'),
      { provider: 'mock', model: 'mock', maxTokens: 256 },
    )

    send(agent, 'use the configured output limit')
    await waitForIdle(ctx, agent)

    expect(adapter.requests[0]?.maxTokens).toBe(256)
  })

  it('cancels queued wakeup work together with an active maintenance task', async () => {
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter([textResponse('park reply')])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await harness(adapter)
    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = ctx.agentLoop.create(SessionId('cancel-maintenance-wakeup'), {
      provider: 'mock',
      model: 'mock',
    })
    /** 中文说明：测试局部值 started，由紧邻初始化决定，仅在当前场景使用。 */
    const started = Promise.withResolvers<undefined>()
    /** 中文说明：测试局部值 maintenance，由紧邻初始化决定，仅在当前场景使用。 */
    const maintenance = agent.runMaintenance(async (signal) => {
      started.resolve(undefined)
      await new Promise<void>((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          reject(new Error('maintenance aborted', { cause: signal.reason }))
        }, { once: true })
      })
    })
    await started.promise

    send(agent, 'discard this wakeup') // latched behind the live maintenance task
    agent.cancel({ kind: 'user' }) // drops the queue and the latch, aborts maintenance
    send(agent, 'park after cancellation') // newer intent: re-latched, replays at convergence

    await expect(maintenance).rejects.toThrow('maintenance aborted')
    await agent.whenIdle()

    // The pre-cancel wakeup is gone; the post-cancel wake replays at convergence.
    expect(userTexts(agent)).toEqual(['park after cancellation'])
    expect(agent.inbox.nextTurn).toHaveLength(0)
    expect(adapter.requests).toHaveLength(1)
  })

  it('replays a wake latched behind maintenance at convergence', async () => {
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter([textResponse('wake reply')])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await harness(adapter)
    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = ctx.agentLoop.create(SessionId('maintenance-wake-replay'), {
      provider: 'mock',
      model: 'mock',
    })
    /** 中文说明：测试局部值 started，由紧邻初始化决定，仅在当前场景使用。 */
    const started = Promise.withResolvers<undefined>()
    /** 中文说明：测试局部值 finish，由紧邻初始化决定，仅在当前场景使用。 */
    const finish = Promise.withResolvers<undefined>()
    /** 中文说明：测试局部值 maintenance，由紧邻初始化决定，仅在当前场景使用。 */
    const maintenance = agent.runMaintenance(async () => {
      started.resolve(undefined)
      await finish.promise
    })
    await started.promise

    send(agent, 'wake behind maintenance')
    finish.resolve(undefined)
    await maintenance
    await agent.whenIdle()

    expect(userTexts(agent)).toEqual(['wake behind maintenance'])
    expect(adapter.requests).toHaveLength(1)
  })

  it('suppresses the replay when a latched maintenance wake is removed', async () => {
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter([])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await harness(adapter)
    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = ctx.agentLoop.create(SessionId('maintenance-wake-removed'), {
      provider: 'mock',
      model: 'mock',
    })
    /** 中文说明：测试局部值 started，由紧邻初始化决定，仅在当前场景使用。 */
    const started = Promise.withResolvers<undefined>()
    /** 中文说明：测试局部值 finish，由紧邻初始化决定，仅在当前场景使用。 */
    const finish = Promise.withResolvers<undefined>()
    /** 中文说明：测试局部值 maintenance，由紧邻初始化决定，仅在当前场景使用。 */
    const maintenance = agent.runMaintenance(async () => {
      started.resolve(undefined)
      await finish.promise
    })
    await started.promise

    /** 中文说明：测试局部值 wake，由紧邻初始化决定，仅在当前场景使用。 */
    const wake = createUserMessage({ content: [{ type: 'text', text: 'removed wake' }], source: { kind: 'user' } })
    agent.followup(wake)
    agent.inbox.remove(wake.id)
    finish.resolve(undefined)
    await maintenance
    await agent.whenIdle()

    expect(userTexts(agent)).toEqual([])
    expect(adapter.requests).toEqual([])
    expect(agent.session.events.filter(e => e.type === 'turn/start')).toHaveLength(0)
  })

  it('runs a simple turn: queued message → model → idle, with ordered events', async () => {
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter([textResponse('hello there')])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await harness(adapter)
    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })

    // All boundaries — turn and step — are durable session events on the
    // session/event feed (no agent/* mirror). Record them in fire order to
    // assert the full boundary nesting.
    /** 中文说明：测试局部值 order，由紧邻初始化决定，仅在当前场景使用。 */
    const order: string[] = []
    ctx.on('session/event', (_session, event) => {
      if (event.type === 'turn/start' || event.type === 'step/start' || event.type === 'step/end' || event.type === 'turn/end') {
        order.push(event.type)
      }
    })

    send(agent, 'hi')
    await waitForIdle(ctx, agent)

    expect(order).toEqual(['turn/start', 'step/start', 'step/end', 'turn/end'])

    /** 中文说明：测试局部值 types，由紧邻初始化决定，仅在当前场景使用。 */
    const types = agent.session.events.map(e => e.type)
    // Durable inbox receipt precedes the turn-owned transcript.
    expect(types[0]).toBe('agent/inbox/spliced')
    expect(types).toContain('turn/start')
    expect(types).toContain('user/message')
    expect(types).toContain('assistant/message')
    /** 中文说明：测试局部值 assistantMessage，由紧邻初始化决定，仅在当前场景使用。 */
    const assistantMessage = agent.session.events.find(e => e.type === 'assistant/message')
    expect(assistantMessage?.type === 'assistant/message' && assistantMessage.data.usage).toEqual({ inputTokens: 10, outputTokens: 'hello there'.length })
    expect(types.at(-1)).toBe('turn/end')

    // derived history: user + assistant
    /** 中文说明：测试局部值 messages，由紧邻初始化决定，仅在当前场景使用。 */
    const messages = agent.session.deriveMessages()
    expect(messages.map(m => m.role)).toEqual(['user', 'assistant'])
    expect(messages[1]!.content).toEqual([{ type: 'text', text: 'hello there' }])
  })

  it('round-trips tool calls: model requests tool → executes → result in next request', async () => {
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter([
      toolCallResponse('c1', 'echo', { text: 'ping' }, 'calling echo'),
      textResponse('done'),
    ])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await harness(adapter)
    ctx.tools.register(defineContentToolFixture({
      name: 'echo',
      description: 'echo back',
      parameters: { text: { type: 'string' } },
      async execute(args) {
        return [{ type: 'text', text: `echo: ${args.text}` }]
      },
    }))
    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })

    send(agent, 'use the tool')
    await waitForIdle(ctx, agent)

    // two model calls happened (tool-call step, then final step)
    expect(adapter.requests).toHaveLength(2)

    // the second request's derived history contains the tool result
    /** 中文说明：测试局部值 secondMessages，由紧邻初始化决定，仅在当前场景使用。 */
    const secondMessages = adapter.requests[1]!.messages
    /** 中文说明：测试局部值 toolResultMessage，由紧邻初始化决定，仅在当前场景使用。 */
    const toolResultMessage = secondMessages.find(m =>
      m.content.some(b => b.type === 'tool-result'))
    expect(toolResultMessage).toBeDefined()
    /** 中文说明：测试局部值 block，由紧邻初始化决定，仅在当前场景使用。 */
    const block = toolResultMessage!.content.find(b => b.type === 'tool-result')!
    expect(block).toMatchObject({ toolCallId: 'c1', isError: false })
    expect((block).content).toEqual([{ type: 'text', text: 'echo: ping' }])

    // session log records call + result
    /** 中文说明：测试局部值 types，由紧邻初始化决定，仅在当前场景使用。 */
    const types = agent.session.events.map(e => e.type)
    expect(types).toContain('tool/call')
    expect(types).toContain('tool/result')
  })

  it('renders harness identity, then the persona, then tool guidance — with {{variables}} resolved', async () => {
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter([textResponse('ok')])
    // The persona is a TEMPLATE: {{model}} is the loop-registered variable
    // projecting this agent's configured model, so the model knows its own name.
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await harness(adapter, 'You are a test agent on {{model}}.')
    ctx.systemPrompt.section({ name: 'tool:noop', order: 100, text: 'Use the noop tool wisely.' })
    ctx.tools.register(defineContentToolFixture({
      name: 'noop',
      description: 'does nothing',
      parameters: {},
      async execute() {
        return []
      },
    }))
    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })

    send(agent, 'hi')
    await waitForIdle(ctx, agent)

    /** 中文说明：测试局部值 request，由紧邻初始化决定，仅在当前场景使用。 */
    const request = adapter.requests[0]
    expect(request!.system).toBe('You are an AI agent powered by DeepSeek Harness.\n\nYou are a test agent on mock.\n\nUse the noop tool wisely.')
    expect(request!.tools?.map(t => t.name)).toEqual(['noop'])
  })

  it('resolves {{cwd}} from the agent session workspace (factory create with meta.cwd)', async () => {
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter([textResponse('ok')])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await harness(adapter, 'Working in {{cwd}}.')
    /** 中文说明：测试局部值 handle，由紧邻初始化决定，仅在当前场景使用。 */
    const handle = await ctx.agents.create({
      sessionId: SessionId('s-cwd'),
      meta: { cwd: '/work/space' },
      agentOptions: { provider: 'mock', model: 'mock' },
    })

    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = handle.agent
    send(agent, 'hi')
    await waitForIdle(ctx, agent)

    expect(adapter.requests[0]!.system).toBe('You are an AI agent powered by DeepSeek Harness.\n\nWorking in /work/space.')
  })

  it('contains a strict-variable render failure: the turn errors, the loop keeps serving turns', async () => {
    // A missing cwd variable must fail one turn without preventing a later valid turn.
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter([textResponse('ok after rescue')])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await harness(adapter, 'In {{cwd}}.')
    /** 中文说明：测试局部值 errors，由紧邻初始化决定，仅在当前场景使用。 */
    const errors: Error[] = []
    ctx.on('agent/error', ({ error }) => {
      if (error instanceof Error) errors.push(error)
    })
    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })

    send(agent, 'hi')
    await waitForIdle(ctx, agent)

    expect(adapter.requests).toHaveLength(0) // the request was never sent
    expect(errors.map(error => error.message)).toEqual([
      'prompt variable "{{cwd}}" has no value for this assembly (section "deployment:persona")',
    ])
    /** 中文说明：测试局部值 turnEnd，由紧邻初始化决定，仅在当前场景使用。 */
    const turnEnd = agent.session.events.find(e => e.type === 'turn/end')
    expect(turnEnd?.type === 'turn/end' && turnEnd.data.reason.kind).toBe('error')
    expect(turnEnd?.type === 'turn/end' && turnEnd.data.reason.kind === 'error'
      ? turnEnd.data.reason.error.message
      : '').toContain('no value for this assembly')

    // The loop survived: a waterfall listener rescues {{cwd}} and the SAME
    // agent completes a real model turn.
    ctx.on('system-prompt/assemble', async (assembly, _context, next) => {
      assembly.variables['cwd'] = '/rescued'
      return next()
    })
    send(agent, 'again')
    await waitForIdle(ctx, agent)

    expect(adapter.requests).toHaveLength(1)
    expect(adapter.requests[0]!.system).toBe('You are an AI agent powered by DeepSeek Harness.\n\nIn /rescued.')
    /** 中文说明：测试局部值 turnEnds，由紧邻初始化决定，仅在当前场景使用。 */
    const turnEnds = agent.session.events.filter(e => e.type === 'turn/end')
    expect(turnEnds).toHaveLength(2)
    expect(turnEnds[1]?.type === 'turn/end' && turnEnds[1].data.reason.kind).toBe('completed')
  })

  it('supports the model-via-agent/request path with a {{model}} persona: the supplier states it via the assemble waterfall', async () => {
    // AgentOptions.model unset: the model arrives in the agent/request
    // waterfall (the loop's documented fallback — see runStep's no-model
    // error). {{model}} renders BEFORE that waterfall, so the SAME plugin
    // states the fact early on system-prompt/assemble — the owner of a
    // late-bound fact owns stating it wherever it is claimed.
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter([textResponse('ok')])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await harness(adapter, 'You run on {{model}}.')
    ctx.on('system-prompt/assemble', async (assembly, _context, next) => {
      assembly.variables['provider'] = 'mock'
      assembly.variables['model'] = 'mock'
      return next()
    })
    ctx.on('agent/request', async (_payload, next) => {
      /** 中文说明：测试局部值 config，由紧邻初始化决定，仅在当前场景使用。 */
      const config = await next()
      return { ...config, provider: 'mock', model: 'mock' }
    })
    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = ctx.agentLoop.create(SessionId('a-late-model'), {})

    send(agent, 'hi')
    await waitForIdle(ctx, agent)

    expect(adapter.requests).toHaveLength(1)
    expect(adapter.requests[0]!.model).toBe('mock')
    expect(adapter.requests[0]!.system).toBe('You are an AI agent powered by DeepSeek Harness.\n\nYou run on mock.')
  })

  it('omits the system field when system-prompt/assemble short-circuits with an empty assembly', async () => {
    // The documented escape valve: a deployment that must drop the harness
    // openers short-circuits the assemble waterfall; the request then carries
    // NO system field at all (not an empty string).
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter([textResponse('ok')])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await harness(adapter)
    ctx.on('system-prompt/assemble', async () => ({ sections: [], contexts: [], tools: [], variables: {} }))
    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = ctx.agentLoop.create(SessionId('a-no-system'), { provider: 'mock', model: 'mock' })

    send(agent, 'hi')
    await waitForIdle(ctx, agent)

    expect(adapter.requests).toHaveLength(1)
    expect('system' in adapter.requests[0]!).toBe(false)
  })

  it('materializes changed runtime context at the history tail without rewriting the system header', async () => {
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter([
      textResponse('one'),
      textResponse('two'),
      textResponse('three'),
      textResponse('four'),
      textResponse('five'),
    ])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await harness(adapter)
    /** 中文说明：测试局部值 mode，由紧邻初始化决定，仅在当前场景使用。 */
    let mode = 'read-only'
    /** 中文说明：测试局部值 dispose，由紧邻初始化决定，仅在当前场景使用。 */
    const dispose = ctx.systemPrompt.context({ name: 'policy', order: 0, text: () => `Mode: ${mode}.` })
    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = ctx.agentLoop.create(SessionId('a-runtime-context'), { provider: 'mock', model: 'mock' })
    /** 中文说明：测试局部值 contextEvents，由紧邻初始化决定，仅在当前场景使用。 */
    const contextEvents = () => agent.session.events.flatMap(event =>
      event.type === 'user/message'
        && event.data.source.kind === 'plugin'
        && event.data.source.plugin === '@deepseek-ai/dsh-system-prompt'
        ? [event]
        : [])

    send(agent, 'first')
    await waitForIdle(ctx, agent)
    expect(contextEvents()).toHaveLength(1)
    expect(contextEvents()[0]?.data.content).toEqual([{
      type: 'text',
      text: 'Current runtime context. This snapshot supersedes earlier runtime-context snapshots.\n\nMode: read-only.',
    }])

    send(agent, 'unchanged')
    await waitForIdle(ctx, agent)
    expect(contextEvents()).toHaveLength(1)

    mode = 'danger-full-access'
    send(agent, 'changed')
    await waitForIdle(ctx, agent)
    expect(contextEvents()).toHaveLength(2)
    /** 中文说明：测试局部值 changedBlock，由紧邻初始化决定，仅在当前场景使用。 */
    const changedBlock = contextEvents()[1]?.data.content[0]
    expect(changedBlock?.type).toBe('text')
    if (changedBlock?.type !== 'text') throw new Error('changed runtime context is not text')
    expect(changedBlock.text).toContain('danger-full-access')

    dispose()
    send(agent, 'cleared')
    await waitForIdle(ctx, agent)
    expect(contextEvents()).toHaveLength(3)
    expect(contextEvents()[2]?.data.content).toEqual([{
      type: 'text',
      text: 'Current runtime context: none. Earlier runtime-context snapshots no longer apply.',
    }])

    send(agent, 'still clear')
    await waitForIdle(ctx, agent)
    expect(contextEvents()).toHaveLength(3)
    expect(adapter.requests.map(request => request.system)).toEqual(Array(5).fill(adapter.requests[0]?.system))
    expect(agent.session.events.filter(event => event.type === 'request/header')).toHaveLength(1)
  })

  it('re-emits unchanged runtime context when a surface replacement removed the retained snapshot', async () => {
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter([textResponse('one'), textResponse('two')])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await harness(adapter)
    ctx.systemPrompt.context({ name: 'policy', order: 0, text: 'Mode: read-only.' })
    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = ctx.agentLoop.create(SessionId('a-runtime-context-compacted'), { provider: 'mock', model: 'mock' })

    send(agent, 'first')
    await waitForIdle(ctx, agent)
    /** 中文说明：测试局部值 contextEvent，由紧邻初始化决定，仅在当前场景使用。 */
    const contextEvent = agent.session.events.find(event =>
      event.type === 'user/message'
      && event.data.source.kind === 'plugin'
      && event.data.source.plugin === '@deepseek-ai/dsh-system-prompt')
    if (contextEvent?.type !== 'user/message') throw new Error('first turn did not materialize runtime context')
    agent.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'compacted summary' }],
      source: { kind: 'plugin', plugin: 'test-compaction' },
    }), {
      surfaceOp: { op: 'replace', start: contextEvent.seq, end: contextEvent.seq },
      sourceEventSeqs: [contextEvent.seq],
    })

    send(agent, 'after compaction')
    await waitForIdle(ctx, agent)
    /** 中文说明：测试局部值 runtimeContexts，由紧邻初始化决定，仅在当前场景使用。 */
    const runtimeContexts = agent.session.events.flatMap(event =>
      event.type === 'user/message'
        && event.data.source.kind === 'plugin'
        && event.data.source.plugin === '@deepseek-ai/dsh-system-prompt'
        ? [event]
        : [])
    expect(runtimeContexts).toHaveLength(2)
    expect(adapter.requests[1]?.messages.some(message =>
      message.source.kind === 'plugin'
      && message.source.plugin === '@deepseek-ai/dsh-system-prompt')).toBe(true)
  })

  it('clears compacted runtime context after the active set becomes empty', async () => {
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter([textResponse('one'), textResponse('two')])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await harness(adapter)
    /** 中文说明：测试局部值 dispose，由紧邻初始化决定，仅在当前场景使用。 */
    const dispose = ctx.systemPrompt.context({ name: 'policy', order: 0, text: 'Mode: read-only.' })
    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = ctx.agentLoop.create(SessionId('a-runtime-context-compacted-clear'), { provider: 'mock', model: 'mock' })

    send(agent, 'first')
    await waitForIdle(ctx, agent)
    /** 中文说明：测试局部值 contextEvent，由紧邻初始化决定，仅在当前场景使用。 */
    const contextEvent = agent.session.events.find(event =>
      event.type === 'user/message'
      && event.data.source.kind === 'plugin'
      && event.data.source.plugin === '@deepseek-ai/dsh-system-prompt')
    if (contextEvent?.type !== 'user/message') throw new Error('first turn did not materialize runtime context')
    agent.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'summary retaining old mode: read-only' }],
      source: { kind: 'plugin', plugin: 'test-compaction' },
    }), {
      surfaceOp: { op: 'replace', start: contextEvent.seq, end: contextEvent.seq },
      sourceEventSeqs: [contextEvent.seq],
    })
    dispose()

    send(agent, 'after compaction')
    await waitForIdle(ctx, agent)
    /** 中文说明：测试局部值 clearing，由紧邻初始化决定，仅在当前场景使用。 */
    const clearing = adapter.requests[1]?.messages.find(message =>
      message.source.kind === 'plugin'
      && message.source.plugin === '@deepseek-ai/dsh-system-prompt')
    expect(clearing?.content).toEqual([{
      type: 'text',
      text: 'Current runtime context: none. Earlier runtime-context snapshots no longer apply.',
    }])
  })

  it('does not clear runtime context after an unrelated replacement', async () => {
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter([textResponse('ok')])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await harness(adapter)
    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = ctx.agentLoop.create(SessionId('a-runtime-context-unrelated-compaction'), { provider: 'mock', model: 'mock' })
    /** 中文说明：测试局部值 original，由紧邻初始化决定，仅在当前场景使用。 */
    const original = agent.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'old context' }],
      source: { kind: 'plugin', plugin: 'test-context' },
    }), { surfaceOp: 'append' })
    agent.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'compacted summary' }],
      source: { kind: 'plugin', plugin: 'test-compaction' },
    }), {
      surfaceOp: { op: 'replace', start: original.seq, end: original.seq },
      sourceEventSeqs: [original.seq],
    })

    send(agent, 'after compaction')
    await waitForIdle(ctx, agent)
    expect(adapter.requests[0]?.messages.some(message =>
      message.source.kind === 'plugin'
      && message.source.plugin === '@deepseek-ai/dsh-system-prompt')).toBe(false)
  })

  it('replaces a malformed retained runtime-context message with the current complete snapshot', async () => {
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter([textResponse('ok')])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await harness(adapter)
    ctx.systemPrompt.context({ name: 'policy', order: 0, text: 'Mode: read-only.' })
    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = ctx.agentLoop.create(SessionId('a-runtime-context-malformed'), { provider: 'mock', model: 'mock' })
    agent.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'broken' }, { type: 'text', text: 'snapshot' }],
      source: { kind: 'plugin', plugin: '@deepseek-ai/dsh-system-prompt' },
    }), { surfaceOp: 'append' })

    send(agent, 'repair context')
    await waitForIdle(ctx, agent)
    /** 中文说明：测试局部值 runtimeContexts，由紧邻初始化决定，仅在当前场景使用。 */
    const runtimeContexts = agent.session.events.flatMap(event =>
      event.type === 'user/message'
        && event.data.source.kind === 'plugin'
        && event.data.source.plugin === '@deepseek-ai/dsh-system-prompt'
        ? [event]
        : [])
    expect(runtimeContexts).toHaveLength(2)
    expect(runtimeContexts[1]?.data.content).toEqual([{
      type: 'text',
      text: 'Current runtime context. This snapshot supersedes earlier runtime-context snapshots.\n\nMode: read-only.',
    }])
  })

  it('records raw chunks for replay as assistant/chunk session events', async () => {
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter([textResponse('abc')])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await harness(adapter)
    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })

    send(agent, 'hi')
    await waitForIdle(ctx, agent)

    /** 中文说明：测试局部值 chunkEvents，由紧邻初始化决定，仅在当前场景使用。 */
    const chunkEvents = agent.session.events.filter(e => e.type === 'assistant/chunk')
    // textResponse('abc') = block-start + 3 deltas + block-end + usage + finish = 7
    expect(chunkEvents).toHaveLength(7)
    // replay: chunk events alone re-assemble to the recorded assistant message
    /** 中文说明：测试局部值 deltaText，由紧邻初始化决定，仅在当前场景使用。 */
    const deltaText = chunkEvents
      .flatMap(e => e.type === 'assistant/chunk' ? [e.data.chunk] : [])
      .filter((c: StreamChunk): c is Extract<StreamChunk, { type: 'text-delta' }> => c.type === 'text-delta')
      .map(c => c.text)
      .join('')
    expect(deltaText).toBe('abc')
  })

  it('injects steering between steps and continues the turn', async () => {
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter([
      toolCallResponse('c1', 'slow', {}),
      textResponse('addressed the steering'),
    ])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await harness(adapter)

    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
    ctx.tools.register(defineContentToolFixture({
      name: 'slow',
      description: '',
      parameters: {},
      async execute() {
        // steer while the turn is running (during tool execution)
        agent.steer(createUserMessage({ content: [{ type: 'text', text: 'change of plans' }], source: { kind: 'user' } }))
        return [{ type: 'text', text: 'tool done' }]
      },
    }))

    send(agent, 'start')
    await waitForIdle(ctx, agent)

    /** 中文说明：测试局部值 steering，由紧邻初始化决定，仅在当前场景使用。 */
    const steering = agent.session.events.find(e =>
      e.type === 'user/message' && JSON.stringify(e.data.content).includes('change of plans'))
    expect(steering).toBeDefined()
    // The entered batch is appended after the second step opens and before its
    // request derives history.
    /** 中文说明：测试局部值 steeringSeq，由紧邻初始化决定，仅在当前场景使用。 */
    const steeringSeq = steering!.seq
    /** 中文说明：测试局部值 secondStepStart，由紧邻初始化决定，仅在当前场景使用。 */
    const secondStepStart = agent.session.events.filter(e => e.type === 'step/start')[1]
    expect(secondStepStart).toBeDefined()
    expect(steeringSeq).toBeGreaterThan(secondStepStart!.seq)

    // the second model request saw the steering content
    /** 中文说明：测试局部值 secondRequest，由紧邻初始化决定，仅在当前场景使用。 */
    const secondRequest = adapter.requests[1]
    /** 中文说明：测试局部值 flat，由紧邻初始化决定，仅在当前场景使用。 */
    const flat = JSON.stringify(secondRequest!.messages)
    expect(flat).toContain('change of plans')
  })

  it('starts idle steering synchronously and enters later steering at the next step', async () => {
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter([textResponse('first'), textResponse('second')])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await harness(adapter)
    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })

    /** 中文说明：测试局部值 idle，由紧邻初始化决定，仅在当前场景使用。 */
    const idle = waitForIdle(ctx, agent)
    agent.steer(createUserMessage({ content: [{ type: 'text', text: 'first idle steer' }], source: { kind: 'user' } }))
    expect(agent.status).toBe('running')
    expect(agent.session.events.filter(event => event.type === 'turn/start')).toHaveLength(1)
    agent.steer(createUserMessage({ content: [{ type: 'text', text: 'second idle steer' }], source: { kind: 'user' } }))
    await idle

    expect(agent.session.events.filter(event => event.type === 'turn/start')).toHaveLength(1)
    expect(agent.session.events
      .filter(event => event.type === 'user/message')
      .map(event => event.data.content)).toEqual([
      [{ type: 'text', text: 'first idle steer' }],
      [{ type: 'text', text: 'second idle steer' }],
    ])
    expect(adapter.requests).toHaveLength(2)
    expect(JSON.stringify(adapter.requests[0]?.messages)).toContain('first idle steer')
    expect(JSON.stringify(adapter.requests[0]?.messages)).not.toContain('second idle steer')
    expect(JSON.stringify(adapter.requests[1]?.messages)).toContain('second idle steer')
  })

  it('stops after a throwing pre-step listener and retains later steering until a wakeup', async () => {
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter([textResponse('recovered')])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await harness(adapter)
    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = ctx.agentLoop.create(SessionId('failed-steering'), { provider: 'mock', model: 'mock' })
    /** 中文说明：测试局部值 fail，由紧邻初始化决定，仅在当前场景使用。 */
    let fail = true
    ctx.on('agent/pre-step', ({ agent: subject }, next) => {
      if (subject !== agent || !fail) return next()
      fail = false
      subject.steer(createUserMessage({ content: [{ type: 'text', text: 'pending steering' }], source: { kind: 'user' } }))
      throw new Error('pre-step failed')
    })

    send(agent, 'prompt')
    await waitForIdle(ctx, agent)

    expect(adapter.requests).toHaveLength(0)
    expect(agent.session.events.filter(event => event.type === 'turn/start')).toHaveLength(1)
    expect(agent.session.events.filter(event => event.type === 'turn/end')).toHaveLength(1)
    expect(agent.inbox.nextStep).toHaveLength(1)

    send(agent, 'resume')
    await waitForIdle(ctx, agent)

    expect(adapter.requests).toHaveLength(1)
    expect(agent.session.events.filter(event => event.type === 'turn/start')).toHaveLength(2)
    expect(JSON.stringify(adapter.requests[0]?.messages)).toContain('pending steering')
  })

  it('inject() while idle durably stages context without opening a turn', async () => {
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter([textResponse('ok')])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await harness(adapter)
    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })

    agent.inject(createUserMessage({ content: [{ type: 'text', text: 'file changed: a.ts' }], source: { kind: 'plugin', plugin: 'watcher' } }))
    expect(agent.status).toBe('idle')
    expect(adapter.requests).toHaveLength(0)
    expect(agent.session.events.filter(event => event.type === 'turn/start')).toHaveLength(0)
    expect(agent.session.events.at(-1)).toMatchObject({
      type: 'agent/inbox/spliced',
      data: {
        target: 'next-step',
        inserted: [{
          role: 'user',
          content: [{ type: 'text', text: 'file changed: a.ts' }],
          source: { kind: 'plugin', plugin: 'watcher' },
        }],
      },
    })

    send(agent, 'go')
    await waitForIdle(ctx, agent)
    expect(agent.session.events.filter(event => event.type === 'turn/start')).toHaveLength(1)
    /** 中文说明：测试局部值 flat，由紧邻初始化决定，仅在当前场景使用。 */
    const flat = JSON.stringify(adapter.requests[0]!.messages)
    expect(flat).toContain('file changed: a.ts')
    expect(flat).not.toContain('<context source=')
  })

  it('inject() persists structured context content verbatim with durable source', async () => {
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter([textResponse('ok')])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await harness(adapter)
    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = ctx.agentLoop.create(SessionId('raw-context'), { provider: 'mock', model: 'mock' })
    /** 中文说明：测试局部值 text，由紧邻初始化决定，仅在当前场景使用。 */
    const text = '<system-reminder>Additional instructions from: pkg/AGENTS.md</system-reminder>'
    agent.inject(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'plugin', plugin: 'agent-instructions' } }))
    send(agent, 'go')
    await waitForIdle(ctx, agent)

    /** 中文说明：测试局部值 contextEvent，由紧邻初始化决定，仅在当前场景使用。 */
    const contextEvent = agent.session.events.find(event => event.type === 'user/message' && event.data.source.kind === 'plugin')
    expect(contextEvent?.type === 'user/message' && contextEvent.data.source)
      .toEqual({ kind: 'plugin', plugin: 'agent-instructions' })
    /** 中文说明：测试局部值 requestText，由紧邻初始化决定，仅在当前场景使用。 */
    const requestText = JSON.stringify(adapter.requests[0]!.messages)
    expect(requestText).toContain('Additional instructions from: pkg/AGENTS.md')
    expect(requestText).not.toContain('<context source=')
  })

  it('defers inject() during tool execution until after the tool result', async () => {
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter([
      toolCallResponse('c1', 'noticer', {}, 'calling'),
      textResponse('done'),
    ])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await harness(adapter)
    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
    /** 中文说明：测试局部值 visibleDuringTool，由紧邻初始化决定，仅在当前场景使用。 */
    let visibleDuringTool = false
    ctx.tools.register(defineContentToolFixture({
      name: 'noticer',
      description: 'injects a notice',
      parameters: {},
      async execute() {
        await Promise.resolve()
        /** 中文说明：测试局部值 first，由紧邻初始化决定，仅在当前场景使用。 */
        const first = { type: 'text' as const, text: 'mid-turn notice' }
        agent.inject(createUserMessage({ content: [first], source: { kind: 'plugin', plugin: 'x' } }))
        first.text = 'mutated after inject'
        agent.inject(createUserMessage({ content: [{ type: 'text', text: 'second notice' }], source: { kind: 'plugin', plugin: 'x' } }))
        visibleDuringTool = agent.session.events.some(e => e.type === 'user/message' && e.data.source.kind === 'plugin')
        return [{ type: 'text', text: 'ok' }]
      },
    }))

    send(agent, 'go')
    await waitForIdle(ctx, agent)

    expect(visibleDuringTool).toBe(false)

    // The injection stays in the open turn, but its user-role context cannot
    // split the assistant tool call from the provider's tool-result message.
    /** 中文说明：测试局部值 turnStarts，由紧邻初始化决定，仅在当前场景使用。 */
    const turnStarts = agent.session.events.filter(e => e.type === 'turn/start')
    expect(turnStarts).toHaveLength(1)
    /** 中文说明：测试局部值 result，由紧邻初始化决定，仅在当前场景使用。 */
    const result = agent.session.events.find(e => e.type === 'tool/result')!
    /** 中文说明：测试局部值 contexts，由紧邻初始化决定，仅在当前场景使用。 */
    const contexts = agent.session.events.filter(e => e.type === 'user/message' && e.data.source.kind === 'plugin')
    expect(contexts).toHaveLength(2)
    expect(result.seq).toBeLessThan(contexts[0]!.seq)
    expect(contexts.flatMap(event => event.type === 'user/message' ? event.data.content : []))
      .toEqual([
        { type: 'text', text: 'mid-turn notice' },
        { type: 'text', text: 'second notice' },
      ])

    /** 中文说明：测试局部值 secondRequest，由紧邻初始化决定，仅在当前场景使用。 */
    const secondRequest = adapter.requests[1]!.messages
    /** 中文说明：测试局部值 resultIndex，由紧邻初始化决定，仅在当前场景使用。 */
    const resultIndex = secondRequest.findIndex(message =>
      message.content.some(block => block.type === 'tool-result'))
    /** 中文说明：测试局部值 contextIndexes，由紧邻初始化决定，仅在当前场景使用。 */
    const contextIndexes = secondRequest.flatMap((message, index) =>
      message.content.some(block => block.type === 'text'
        && (block.text.includes('mid-turn notice') || block.text.includes('second notice')))
        ? [index]
        : [])
    expect(resultIndex).toBeGreaterThanOrEqual(0)
    expect(contextIndexes).toHaveLength(2)
    expect(contextIndexes.every(index => index > resultIndex)).toBe(true)
  })

  it('rejects non-JSON context before it enters the active tool-batch FIFO', async () => {
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter([
      toolCallResponse('c1', 'invalid-injector', {}, 'calling'),
      textResponse('done'),
    ])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await harness(adapter)
    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = ctx.agentLoop.create(SessionId('invalid-context'), { provider: 'mock', model: 'mock' })
    ctx.tools.register(defineContentToolFixture({
      name: 'invalid-injector',
      description: 'attempts an invalid context injection',
      parameters: {},
      async execute() {
        expect(() => {
          agent.inject(createUserMessage({ content: [{ type: 'text', text: 'invalid' }], source: { kind: 'plugin', plugin: 'test', bigint: 1n } as never }))
        }).toThrow('agent context must be losslessly JSON-serializable')
        return [{ type: 'text', text: 'rejected invalid context' }]
      },
    }))

    send(agent, 'go')
    await waitForIdle(ctx, agent)

    expect(agent.session.events.some(event => event.type === 'user/message' && event.data.source.kind === 'plugin')).toBe(false)
  })

  it('agent/turn-stopping can steer another step (/loop pattern)', async () => {
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter([
      textResponse('step 1'),
      textResponse('step 2'),
      textResponse('step 3'),
    ])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await harness(adapter)
    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })

    /** 中文说明：测试局部值 steps，由紧邻初始化决定，仅在当前场景使用。 */
    let steps = 0
    ctx.on('session/event', (_session, event) => { if (event.type === 'step/end') steps++ })
    ctx.on('agent/turn-stopping', ({ agent: subject }) => {
      if (steps < 3) {
        subject.steer(createUserMessage({ content: [{ type: 'text', text: 'continue' }], source: { kind: 'plugin', plugin: 'loop-test' } }))
      }
    })

    send(agent, 'go')
    await waitForIdle(ctx, agent)
    expect(steps).toBe(3)
    expect(adapter.requests).toHaveLength(3)
  })

  it('a tool can conclude the turn despite owing a follow-up request', async () => {
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter([toolCallResponse('c1', 'echo', { text: 'x' })])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await harness(adapter)
    ctx.tools.register(defineContentToolFixture({
      name: 'echo',
      description: '',
      parameters: { text: { type: 'string' } },
      async execute(args, exec) {
        exec.concludeTurn()
        return [{ type: 'text', text: String(args.text) }]
      },
    }))
    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })

    send(agent, 'go')
    await waitForIdle(ctx, agent)
    // only one model call despite the tool call requesting a follow-up
    expect(adapter.requests).toHaveLength(1)
    // The tool still executes and durably records its result.
    expect(agent.session.events.some(e => e.type === 'tool/result')).toBe(true)
  })

  it('continues for steering that arrived during a concluding tool step', async () => {
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter([
      toolCallResponse('c1', 'finalize', {}),
      textResponse('next turn reply'),
    ])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await harness(adapter)
    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
    ctx.tools.register(defineContentToolFixture({
      name: 'finalize',
      description: '',
      parameters: {},
      async execute(_args, exec) {
        // Steering lands while the concluding tool is still executing.
        agent.steer(createUserMessage({ content: [{ type: 'text', text: 'late steering' }], source: { kind: 'user' } }))
        exec.concludeTurn()
        return [{ type: 'text', text: 'final' }]
      },
    }))

    send(agent, 'go')
    await waitForIdle(ctx, agent)

    expect(adapter.requests).toHaveLength(2)
    /** 中文说明：测试局部值 events，由紧邻初始化决定，仅在当前场景使用。 */
    const events = agent.session.events.map(event => event.type)
    expect(events.filter(type => type === 'turn/end')).toHaveLength(1)
    expect(JSON.stringify(adapter.requests[1]?.messages)).toContain('late steering')
    /** 中文说明：测试局部值 texts，由紧邻初始化决定，仅在当前场景使用。 */
    const texts = adapter.requests[1]!.messages
      .flatMap(message => message.content)
      .filter(block => block.type === 'text')
      .map(block => block.text)
    expect(texts).toContain('late steering')
  })

  it('agent/request waterfall switches models by returning a replacement config; the switch is logged', async () => {
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter([textResponse('ok')])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await harness(adapter)
    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })

    ctx.on('agent/request', async (_payload, next) => {
      /** 中文说明：测试局部值 config，由紧邻初始化决定，仅在当前场景使用。 */
      const config = await next()
      // The seed is frozen — config is not a mutable per-call knob; a switch
      // is proposed by returning a replacement, and the loop logs it.
      expect(Object.isFrozen(config)).toBe(true)
      expect(() => { (config as { model: string }).model = 'other-model' }).toThrow(TypeError)
      return { ...config, model: 'other-model' }
    })

    send(agent, 'hi')
    await waitForIdle(ctx, agent)
    expect(adapter.requests[0]!.model).toBe('other-model')
    // The header event records what the request ACTUALLY used — the switch is
    // a reconstructable fact, not silent drift.
    /** 中文说明：测试局部值 headerEvent，由紧邻初始化决定，仅在当前场景使用。 */
    const headerEvent = agent.session.events.find(e => e.type === 'request/header')
    expect(headerEvent?.type === 'request/header' && headerEvent.data.header.config.model).toBe('other-model')
  })

  it('agent/pre-step fires once per proposed step before the step is opened', async () => {
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter([
      toolCallResponse('c1', 'echo', {}, 'calling echo'),
      textResponse('done'),
    ])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await harness(adapter)
    ctx.tools.register(defineContentToolFixture({
      name: 'echo', description: 'echo', parameters: {},
      async execute() { return [{ type: 'text', text: 'echoed' }] },
    }))
    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })

    /** 中文说明：测试局部值 fires，由紧邻初始化决定，仅在当前场景使用。 */
    const fires: { turn: number; step: number; signal: AbortSignal }[] = []
    ctx.on('agent/pre-step', ({ agent: subject, turn, step, signal }, next) => {
      if (subject === agent) fires.push({ turn, step, signal })
      return next()
    })

    send(agent, 'go')
    await waitForIdle(ctx, agent)

    expect(fires.map(({ turn, step }) => ({ turn, step }))).toEqual([
      { turn: 1, step: 1 },
      { turn: 1, step: 2 },
    ])
    expect(fires.every(({ signal }) => signal instanceof AbortSignal)).toBe(true)
  })

  it('agent/pre-step fires before its step boundary opens and before the request', async () => {
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter([textResponse('ok')])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await harness(adapter)
    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })

    /** 中文说明：测试局部值 boundaryOpen，由紧邻初始化决定，仅在当前场景使用。 */
    let boundaryOpen = true
    ctx.on('agent/pre-step', ({ agent: subject }, next) => {
      if (subject === agent) boundaryOpen = subject.session.events.at(-1)?.type === 'step/start'
      return next()
    })

    send(agent, 'go')
    await waitForIdle(ctx, agent)

    expect(boundaryOpen).toBe(false)
    expect(adapter.requests).toHaveLength(1)
  })

  it('a throwing agent/pre-step listener fails the proposal, not the loop', async () => {
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter([textResponse('second turn ok')])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await harness(adapter)
    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })

    /** 中文说明：测试局部值 throwOnce，由紧邻初始化决定，仅在当前场景使用。 */
    let throwOnce = true
    ctx.on('agent/pre-step', (_payload, next) => {
      if (throwOnce) { throwOnce = false; throw new Error('boom in pre-step') }
      return next()
    })

    /** 中文说明：测试局部值 errors，由紧邻初始化决定，仅在当前场景使用。 */
    const errors: Error[] = []
    ctx.on('agent/error', ({ error }) => {
      if (error instanceof Error) errors.push(error)
    })

    send(agent, 'first')
    await waitForIdle(ctx, agent)
    // The first proposal failed inside a balanced turn without calling the model.
    expect(errors.map(error => error.message)).toEqual(['boom in pre-step'])
    expect(adapter.requests.length).toBe(0)
    expect(agent.session.events.some(event => event.type === 'turn/start')).toBe(true)
    expect(agent.session.events.some(event => event.type === 'turn/end')).toBe(true)

    // The loop survived: a second prompt runs a normal completed turn.
    send(agent, 'second')
    await waitForIdle(ctx, agent)
    expect(adapter.requests.length).toBe(1)
    /** 中文说明：测试局部值 lastTurnEnd，由紧邻初始化决定，仅在当前场景使用。 */
    const lastTurnEnd = agent.session.events.findLast(e => e.type === 'turn/end')
    expect(lastTurnEnd?.type === 'turn/end' && lastTurnEnd.data.reason).toEqual({ kind: 'completed' })
  })

  it('cancel() mid-stream ends the turn with reason aborted', async () => {
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
    // wait until the stream is hanging, then cancel
    await new Promise(r => setTimeout(r, 30))
    expect(agent.status).toBe('running')
    agent.cancel({ kind: 'user' })
    await waitForIdle(ctx, agent)

    expect(reasons).toEqual([{ kind: 'aborted', reason: { kind: 'user' } }])
  })

  it('surfaces max-tokens as the turn-end reason when the last step is cut off', async () => {
    // A single step that ends with a max-tokens finish (no tool calls): the
    // turn stops by default and ends max-tokens, not completed.
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter([maxTokensResponse('truncat')])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await harness(adapter)
    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })

    /** 中文说明：测试局部值 reasons，由紧邻初始化决定，仅在当前场景使用。 */
    const reasons: TurnEndReason[] = []
    ctx.on('session/event', (_s, event) => { if (event.type === 'turn/end') reasons.push(event.data.reason) })

    send(agent, 'go')
    await waitForIdle(ctx, agent)

    expect(adapter.requests).toHaveLength(1)
    expect(reasons).toEqual([{ kind: 'max-tokens' }])
    // Assert the durable row, not only the live listener.
    /** 中文说明：测试局部值 turnEnd，由紧邻初始化决定，仅在当前场景使用。 */
    const turnEnd = agent.session.events.findLast(e => e.type === 'turn/end')
    expect(turnEnd!.data.reason).toEqual({ kind: 'max-tokens' })
  })

  it('a max-tokens step earlier in a turn still surfaces as max-tokens after a later completed step', async () => {
    // Step 1 is cut off (max-tokens, no tool calls → would stop by default), so continuation
    // must be FORCED to reach step 2 which finishes normally (stop).
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter([
      maxTokensResponse('first half'),
      textResponse('second half'),
    ])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await harness(adapter)
    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })

    /** 中文说明：测试局部值 steps，由紧邻初始化决定，仅在当前场景使用。 */
    let steps = 0
    ctx.on('session/event', (_session, event) => { if (event.type === 'step/end') steps++ })
    // Force exactly one continuation (step 1 → step 2), then defer to default
    // (step 2 is a plain stop with no tool calls → stops).
    ctx.on('agent/turn-stopping', ({ agent: subject }) => {
      if (steps < 2) {
        subject.steer(createUserMessage({ content: [{ type: 'text', text: 'continue after truncation' }], source: { kind: 'plugin', plugin: 'max-tokens-test' } }))
      }
    })

    /** 中文说明：测试局部值 reasons，由紧邻初始化决定，仅在当前场景使用。 */
    const reasons: TurnEndReason[] = []
    ctx.on('session/event', (_s, event) => { if (event.type === 'turn/end') reasons.push(event.data.reason) })

    send(agent, 'go')
    await waitForIdle(ctx, agent)

    expect(steps).toBe(2)
    expect(adapter.requests).toHaveLength(2)
    expect(adapter.requests[1]!.messages).toEqual([
      {
        id: expect.any(String) as unknown,
        role: 'user',
        content: [{ type: 'text', text: 'go' }],
        source: { kind: 'user' },
      },
      {
        id: expect.any(String) as unknown,
        role: 'assistant',
        content: [{ type: 'text', text: 'first half' }],
        source: { kind: 'model', provider: 'mock', model: 'mock' },
      },
      {
        id: expect.any(String) as unknown,
        role: 'user',
        content: [{ type: 'text', text: 'continue after truncation' }],
        source: { kind: 'plugin', plugin: 'max-tokens-test' },
      },
    ])
    // A max-token step is sticky: the later completed step must not
    // downgrade the turn outcome.
    expect(reasons).toEqual([{ kind: 'max-tokens' }])
  })

  it('a completed step after no max-tokens keeps the turn completed (max-tokens does not leak across turns)', async () => {
    // Two consecutive turns: turn 1 is cut off (max-tokens), turn 2 is a clean
    // stop. The per-turn reason must be independent — turn 2 ends completed.
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter([maxTokensResponse('cut'), textResponse('clean')])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await harness(adapter)
    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })

    /** 中文说明：测试局部值 reasons，由紧邻初始化决定，仅在当前场景使用。 */
    const reasons: TurnEndReason[] = []
    ctx.on('session/event', (_s, event) => { if (event.type === 'turn/end') reasons.push(event.data.reason) })

    send(agent, 'first')
    await waitForIdle(ctx, agent)
    send(agent, 'second')
    await waitForIdle(ctx, agent)

    expect(reasons).toEqual([{ kind: 'max-tokens' }, { kind: 'completed' }])
  })

  it('does not dispatch tool calls from a max-tokens-truncated step', async () => {
    /** 中文说明：测试局部值 callId，由紧邻初始化决定，仅在当前场景使用。 */
    const callId = CallId('c1')
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter([[
      { type: 'block-start', index: 0, blockType: 'tool-call' },
      { type: 'tool-call-delta', index: 0, id: callId, name: 'echo', argumentsDelta: '{"text":"x"}' },
      { type: 'block-end', index: 0, block: { type: 'tool-call', id: callId, name: 'echo', arguments: '{"text":"x"}' } },
      { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } },
      { type: 'finish', reason: { kind: 'max-tokens' } },
    ]])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await harness(adapter)
    /** 中文说明：测试局部值 executions，由紧邻初始化决定，仅在当前场景使用。 */
    let executions = 0
    ctx.tools.register(defineContentToolFixture({
      name: 'echo',
      description: '',
      parameters: { text: { type: 'string' } },
      async execute() {
        executions += 1
        return [{ type: 'text', text: 'should not run' }]
      },
    }))
    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })

    /** 中文说明：测试局部值 reasons，由紧邻初始化决定，仅在当前场景使用。 */
    const reasons: TurnEndReason[] = []
    ctx.on('session/event', (_s, event) => { if (event.type === 'turn/end') reasons.push(event.data.reason) })

    send(agent, 'go')
    await waitForIdle(ctx, agent)

    expect(executions).toBe(0)
    expect(agent.session.events.some(e => e.type === 'tool/call')).toBe(false)
    expect(agent.session.deriveMessages()).toEqual([{
      id: expect.any(String) as unknown,
      role: 'user',
      content: [{ type: 'text', text: 'go' }],
      source: { kind: 'user' },
    }])
    expect(reasons).toEqual([{ kind: 'max-tokens' }])
    // Empty content still needs an assistant/message to carry usage; derivation
    // skips that host so it does not create a spurious assistant turn.
    /** 中文说明：测试局部值 assistantMessage，由紧邻初始化决定，仅在当前场景使用。 */
    const assistantMessage = agent.session.events.find(e => e.type === 'assistant/message')
    expect(assistantMessage?.type === 'assistant/message' && assistantMessage.data).toEqual({
      turn: 1,
      step: 1,
      message: {
        id: expect.any(String) as unknown,
        role: 'assistant',
        content: [],
        source: { kind: 'model', provider: 'mock', model: 'mock' },
      },
      usage: { inputTokens: 10, outputTokens: 5 },
    })
  })

  it('appends an empty completion anchor for a max-tokens step with no usage', async () => {
    // The truncated tool call is dropped from durable content, while the
    // successful provider call still needs an exact replay anchor.
    /** 中文说明：测试局部值 callId，由紧邻初始化决定，仅在当前场景使用。 */
    const callId = CallId('c1')
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter([[
      { type: 'block-start', index: 0, blockType: 'tool-call' },
      { type: 'tool-call-delta', index: 0, id: callId, name: 'echo', argumentsDelta: '{"text":"x"}' },
      { type: 'block-end', index: 0, block: { type: 'tool-call', id: callId, name: 'echo', arguments: '{"text":"x"}' } },
      { type: 'finish', reason: { kind: 'max-tokens' } },
    ]])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await harness(adapter)
    ctx.tools.register(defineContentToolFixture({
      name: 'echo',
      description: '',
      parameters: { text: { type: 'string' } },
      async execute() { return [{ type: 'text', text: 'should not run' }] },
    }))
    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })

    /** 中文说明：测试局部值 reasons，由紧邻初始化决定，仅在当前场景使用。 */
    const reasons: TurnEndReason[] = []
    ctx.on('session/event', (_s, event) => { if (event.type === 'turn/end') reasons.push(event.data.reason) })

    send(agent, 'go')
    await waitForIdle(ctx, agent)

    expect(reasons).toEqual([{ kind: 'max-tokens' }])
    /** 中文说明：测试局部值 assistant，由紧邻初始化决定，仅在当前场景使用。 */
    const assistant = agent.session.events.find(e => e.type === 'assistant/message')!
    expect(assistant.type === 'assistant/message' && assistant.data).toEqual({
      turn: 1,
      step: 1,
      message: {
        id: expect.any(String) as unknown,
        role: 'assistant',
        content: [],
        source: { kind: 'model', provider: 'mock', model: 'mock' },
      },
    })
    expect(assistant.sourceEventSeqs?.length).toBeGreaterThan(0)
    expect(agent.session.deriveMessages()).toEqual([{
      id: expect.any(String) as unknown,
      role: 'user',
      content: [{ type: 'text', text: 'go' }],
      source: { kind: 'user' },
    }])
  })

  it('appends an empty completion anchor for a normal stop with no usage', async () => {
    // A clean content-less call stays absent from derived messages but remains
    // a durable successful-call boundary for replay consumers.
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter([[{ type: 'finish', reason: { kind: 'stop' } }]])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await harness(adapter)
    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })

    /** 中文说明：测试局部值 reasons，由紧邻初始化决定，仅在当前场景使用。 */
    const reasons: TurnEndReason[] = []
    ctx.on('session/event', (_s, event) => { if (event.type === 'turn/end') reasons.push(event.data.reason) })

    send(agent, 'go')
    await waitForIdle(ctx, agent)

    expect(reasons).toEqual([{ kind: 'completed' }])
    /** 中文说明：测试局部值 assistant，由紧邻初始化决定，仅在当前场景使用。 */
    const assistant = agent.session.events.find(e => e.type === 'assistant/message')!
    expect(assistant.type === 'assistant/message' && assistant.data).toEqual({
      turn: 1,
      step: 1,
      message: {
        id: expect.any(String) as unknown,
        role: 'assistant',
        content: [],
        source: { kind: 'model', provider: 'mock', model: 'mock' },
      },
    })
    expect(assistant.sourceEventSeqs?.length).toBe(1)
    expect(agent.session.deriveMessages()).toEqual([{
      id: expect.any(String) as unknown,
      role: 'user',
      content: [{ type: 'text', text: 'go' }],
      source: { kind: 'user' },
    }])
  })

  it('keeps safe max-tokens assistant content while dropping truncated tool calls', async () => {
    /** 中文说明：测试局部值 callId，由紧邻初始化决定，仅在当前场景使用。 */
    const callId = CallId('c1')
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter([[
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'text-delta', index: 0, text: 'partial text' },
      { type: 'block-end', index: 0, block: { type: 'text', text: 'partial text' } },
      { type: 'block-start', index: 1, blockType: 'tool-call' },
      { type: 'tool-call-delta', index: 1, id: callId, name: 'echo', argumentsDelta: '{"text"' },
      {
        type: 'finish',
        reason: { kind: 'max-tokens' },
        replayState: { response: { responseId: 'resp-1' }, blocks: ['text-meta', 'tool-meta'] },
      },
    ], textResponse('continued')])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await harness(adapter)
    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })

    send(agent, 'go')
    await waitForIdle(ctx, agent)
    send(agent, 'continue')
    await waitForIdle(ctx, agent)

    expect(agent.session.events.some(e => e.type === 'tool/call')).toBe(false)
    // The follow-up request replays the truncated message with its replay
    // metadata pruned in step with the dropped tool call.
    expect(adapter.requests[1]?.messages[1]?.source).toEqual({
      kind: 'model',
      provider: 'mock',
      model: 'mock',
      replayState: { response: { responseId: 'resp-1' }, blocks: ['text-meta'] },
    })
    expect(agent.session.deriveMessages()).toEqual([
      {
        id: expect.any(String) as unknown,
        role: 'user',
        content: [{ type: 'text', text: 'go' }],
        source: { kind: 'user' },
      },
      {
        id: expect.any(String) as unknown,
        role: 'assistant',
        content: [{ type: 'text', text: 'partial text' }],
        source: {
          kind: 'model',
          provider: 'mock',
          model: 'mock',
          replayState: { response: { responseId: 'resp-1' }, blocks: ['text-meta'] },
        },
      },
      {
        id: expect.any(String) as unknown,
        role: 'user',
        content: [{ type: 'text', text: 'continue' }],
        source: { kind: 'user' },
      },
      {
        id: expect.any(String) as unknown,
        role: 'assistant',
        content: [{ type: 'text', text: 'continued' }],
        source: { kind: 'model', provider: 'mock', model: 'mock' },
      },
    ])
  })

  it('contains a step/end observer failure without changing continuation', async () => {
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter([
      toolCallResponse('c1', 'echo', { text: 'x' }),
      textResponse('continued after tool call'),
    ])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await harness(adapter)
    ctx.tools.register(defineContentToolFixture({
      name: 'echo',
      description: '',
      parameters: { text: { type: 'string' } },
      async execute(args) {
        return [{ type: 'text', text: String(args.text) }]
      },
    }))
    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
    /** 中文说明：测试局部值 threw，由紧邻初始化决定，仅在当前场景使用。 */
    let threw = false
    // Post-commit session observers cannot control the loop. The tool call still
    // drives the second model request, and the turn completes normally.
    ctx.on('session/event', (_session, event) => {
      if (event.type === 'step/end' && !threw) { threw = true; throw new Error('bad step/end listener') }
    })

    send(agent, 'go')
    await waitForIdle(ctx, agent)

    expect(adapter.requests).toHaveLength(2)
    /** 中文说明：测试局部值 turnEnd，由紧邻初始化决定，仅在当前场景使用。 */
    const turnEnd = agent.session.events.findLast(e => e.type === 'turn/end')
    expect(turnEnd?.type === 'turn/end' && turnEnd.data.reason.kind).toBe('completed')
  })

  it('contains a reentrant send attempted during durable inbox publication', async () => {
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter([textResponse('first')])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await harness(adapter)
    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })

    /** 中文说明：测试局部值 nested，由紧邻初始化决定，仅在当前场景使用。 */
    let nested = false
    ctx.on('session/event', (session, event) => {
      if (session !== agent.session || event.type !== 'agent/inbox/spliced'
        || event.data.inserted.length === 0 || nested) return
      nested = true
      send(agent, 'queued listener message')
    })

    /** 中文说明：测试局部值 idle，由紧邻初始化决定，仅在当前场景使用。 */
    const idle = waitForIdle(ctx, agent)
    send(agent, 'outer message')
    await idle

    /** 中文说明：测试局部值 turns，由紧邻初始化决定，仅在当前场景使用。 */
    const turns = agent.session.events.filter(event => event.type === 'turn/start')
    /** 中文说明：测试局部值 messages，由紧邻初始化决定，仅在当前场景使用。 */
    const messages = agent.session.events
      .filter(event => event.type === 'user/message')
      .map(event => event.data.content)
    expect(turns).toHaveLength(1)
    expect(messages).toEqual([[{ type: 'text', text: 'outer message' }]])
  })

  it('preserves independent turn sources across an adjacent microtask send', async () => {
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter([textResponse('first'), textResponse('second')])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await harness(adapter)
    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })

    /** 中文说明：测试局部值 idle，由紧邻初始化决定，仅在当前场景使用。 */
    const idle = waitForIdle(ctx, agent)
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'user message' }], source: { kind: 'user' } }))
    await Promise.resolve()
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'plugin message' }], source: { kind: 'plugin', plugin: 'test' } }))
    await idle

    /** 中文说明：测试局部值 turns，由紧邻初始化决定，仅在当前场景使用。 */
    const turns = agent.session.events.filter(event => event.type === 'turn/start')
    /** 中文说明：测试局部值 sources，由紧邻初始化决定，仅在当前场景使用。 */
    const sources = agent.session.events
      .filter(event => event.type === 'user/message')
      .map(event => event.data.source)
    expect(turns).toHaveLength(2)
    expect(sources).toEqual([
      { kind: 'user' },
      { kind: 'plugin', plugin: 'test' },
    ])
  })

  it('keeps a session-listener send after dequeue in the following turn', async () => {
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter([textResponse('first'), textResponse('second')])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await harness(adapter)
    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })

    /** 中文说明：测试局部值 turns，由紧邻初始化决定，仅在当前场景使用。 */
    const turns: number[] = []
    ctx.on('session/event', (_s, event) => { if (event.type === 'turn/start') turns.push(event.data.turn) })

    // queue two messages while idle — first starts turn 1 immediately;
    // queue the second during turn 1 when the first assistant chunk streams
    /** 中文说明：测试局部值 queued，由紧邻初始化决定，仅在当前场景使用。 */
    let queued = false
    ctx.on('session/event', (_s, event) => {
      if (event.type === 'assistant/chunk' && !queued) {
        queued = true
        queueMicrotask(() => { send(agent, 'second message') })
      }
    })

    send(agent, 'first message')
    await waitForIdle(ctx, agent)

    expect(turns).toEqual([1, 2])
    expect(adapter.requests).toHaveLength(2)
    expect(JSON.stringify(adapter.requests[1]!.messages)).toContain('first')
    expect(JSON.stringify(adapter.requests[1]!.messages)).toContain('second message')
  })

  it('keeps a model-adapter callback send in the following turn', async () => {
    /** 中文说明：测试局部值 agentRef，由紧邻初始化决定，仅在当前场景使用。 */
    const agentRef: { current?: Agent } = {}
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter([
      () => {
        /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
        const agent = agentRef.current
        if (agent === undefined) throw new Error('model callback ran before agent setup')
        send(agent, 'model callback message')
        return textResponse('first')
      },
      textResponse('second'),
    ])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await harness(adapter)
    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
    agentRef.current = agent

    /** 中文说明：测试局部值 idle，由紧邻初始化决定，仅在当前场景使用。 */
    const idle = waitForIdle(ctx, agent)
    send(agent, 'outer message')
    await idle

    /** 中文说明：测试局部值 messages，由紧邻初始化决定，仅在当前场景使用。 */
    const messages = agent.session.events
      .filter(event => event.type === 'user/message')
      .map(event => event.data.content)
    expect(agent.session.events.filter(event => event.type === 'turn/start')).toHaveLength(2)
    expect(messages).toEqual([
      [{ type: 'text', text: 'outer message' }],
      [{ type: 'text', text: 'model callback message' }],
    ])
  })

  it('records normalized model errors on the turn boundary', async () => {
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter([]) // script exhausted → throws
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await harness(adapter)
    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })

    /** 中文说明：测试局部值 errors，由紧邻初始化决定，仅在当前场景使用。 */
    const errors: unknown[] = []
    /** 中文说明：测试局部值 reasons，由紧邻初始化决定，仅在当前场景使用。 */
    const reasons: TurnEndReason[] = []
    ctx.on('agent/error', ({ error }) => {
      errors.push(error)
    })
    ctx.on('session/event', (_s, event) => { if (event.type === 'turn/end') reasons.push(event.data.reason) })

    send(agent, 'hi')
    await waitForIdle(ctx, agent)

    expect(errors).toHaveLength(1)
    expect(errors[0]).toBeInstanceOf(LlmError)
    expect((errors[0] as LlmError).failure).toEqual({
      message: 'MockAdapter: script exhausted',
      code: 'UNKNOWN',
    })
    expect(reasons[0]).toMatchObject({ kind: 'error' })
    // The durable failure and live relay describe the same failed turn.
    /** 中文说明：测试局部值 turnEnd，由紧邻初始化决定，仅在当前场景使用。 */
    const turnEnd = agent.session.events.find(e => e.type === 'turn/end')
    expect(turnEnd?.type === 'turn/end' && turnEnd.data.reason).toMatchObject({ kind: 'error' })
  })

  it('disposing the loop fiber mid-turn stops the loop (HMR safety)', async () => {
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

    expect(ctx.agents.get(SessionId('scoped'))).toBe(agent)
    send(agent, 'go')
    await new Promise(r => setTimeout(r, 30))
    expect(agent.status).toBe('running')

    await fiber.dispose()
    await driverDone(agent)

    expect(ctx.agents.get(SessionId('scoped'))).toBeUndefined()
  })

  it('creates agents from config on startup', async () => {
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter([textResponse('from config')])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(SessionStore)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(AgentLoop, {
      agents: [{ id: SessionId('config-agent'), provider: 'mock', model: 'mock' }],
    })
    ctx.llm.registerAdapter(['mock'], adapter)

    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = ctx.agents.list()[0]!
    expect(agent).toBeDefined()
    expect(agent.id).toBe(agent.session.id)
    expect(agent.id).toMatch(/^config-agent-session-/)
    expect(agent.options.model).toBe('mock')

    // the agent is alive: send triggers a turn
    send(agent, 'hi')
    await waitForIdle(ctx, agent)
    expect(adapter.requests).toHaveLength(1)
  })

  it('attaches config agent cwd to the fresh session header', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(SessionStore)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(AgentLoop, {
      agents: [{ id: SessionId('config-agent'), provider: 'mock', model: 'mock', cwd: '/work/project' }],
    })

    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = ctx.agents.list()[0]!
    expect(agent.session.header.cwd).toBe('/work/project')
  })

  it('replays a session log into an identical derived history', async () => {
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter([
      toolCallResponse('c1', 'echo', { text: 'x' }),
      textResponse('done'),
    ])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await harness(adapter)
    ctx.tools.register(defineContentToolFixture({
      name: 'echo',
      description: '',
      parameters: { text: { type: 'string' } },
      async execute(args) {
        return [{ type: 'text', text: String(args.text) }]
      },
    }))
    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
    send(agent, 'run')
    await waitForIdle(ctx, agent)

    /** 中文说明：测试局部值 replayed，由紧邻初始化决定，仅在当前场景使用。 */
    const replayed = ctx.sessions.create(SessionId('replayed'), { seed: [...agent.session.events] })
    expect(replayed.deriveMessages()).toEqual(agent.session.deriveMessages())
    // event-by-event identity of types over the inherited prefix
    expect(replayed.events.slice(0, agent.session.seq).map(e => e.type)).toEqual(
      agent.session.events.map(e => e.type))
    expect(replayed.events.at(-1)?.type).toBe('session/end-seed')
  })
})
