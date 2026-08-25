/**
 * 文件职责：验证Agent Loop的 contract-regressions.spec.ts 行为与不变量。
 * 技术维度：Vitest、Cordis、会话事件、模型适配器和可控工具夹具。
 * 产品维度：防止Agent Loop在取消、恢复、错误或并发场景中产生回归。
 * 逻辑维度：构造服务与事件，驱动执行流程，再断言日志、请求、状态和清理。
 * 关键边界：测试后台任务必须结束；模型可见输入必须可从日志重建；工具调用顺序不可破坏。
 * 新手阅读建议：先读 mock/辅助函数，再按成功、错误、恢复和生命周期场景阅读。
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { createUserMessage, CallId, LlmError, MessageSource, ProviderRequestId, StreamChunk  } from '@deepseek-ai/dsh-llm'
import SessionStore, { Session, SessionEvent, SessionId, TurnEndReason, type UserMessage } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineContentToolFixture, type PostToolDecision } from '@deepseek-ai/dsh-tools'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { ReactLoopAgent } from '../src/agent.ts'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as SessionInvariant from '@deepseek-ai/dsh-session/invariant'
import * as AgentInvariant from '@deepseek-ai/dsh-agent/invariant'
import * as AgentLoopInvariant from '@deepseek-ai/dsh-agent-loop/invariant'
import { MockAdapter, textResponse, toolCallResponse } from './mock-adapter.ts'

/** 中文说明：测试辅助函数 mountInvariants 的参数见签名，返回值用于驱动或断言场景；示例见下方用例。 */
async function mountInvariants(ctx: Context): Promise<void> {
  await ctx.plugin(InvariantRegistry)
  await ctx.plugin(SessionInvariant)
  await ctx.plugin(AgentInvariant)
  await ctx.plugin(AgentLoopInvariant)
}

/** 中文说明：测试辅助函数 driverDone 的参数见签名，返回值用于驱动或断言场景；示例见下方用例。 */
function driverDone(agent: Agent): Promise<void> {
  return (agent as Agent & { done: Promise<void> }).done
}

/** Regression tests for agent-loop boundary, identity, and lifecycle contracts. */

/* 中文说明：测试辅助函数 harness 的参数见签名，返回值用于驱动或断言场景；示例见下方用例。 */
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

/** 中文说明：测试辅助函数 inboxText 的参数见签名，返回值用于驱动或断言场景；示例见下方用例。 */
function inboxText(message: UserMessage): string {
  return message.content
    .flatMap(block => block.type === 'text' ? [block.text] : [])
    .join('')
}

describe('assistant replay provider and model fields', () => {
  it('records adapter replay state with the assembled assistant content', async () => {
    /** 中文说明：测试局部值 response，由紧邻初始化决定，仅在当前场景使用。 */
    const response = textResponse('unchanged')
    /** 中文说明：测试局部值 replayState，由紧邻初始化决定，仅在当前场景使用。 */
    const replayState = { response: { private: 'state' }, blocks: ['block-meta'] }
    response[response.length - 1] = { type: 'finish', reason: { kind: 'stop' }, replayState }
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter([response])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await harness(adapter)
    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = ctx.agentLoop.create(SessionId('replay-state'), { provider: 'mock', model: 'next-model' })

    send(agent, 'go')
    await waitForIdle(ctx, agent)

    /** 中文说明：测试局部值 recorded，由紧邻初始化决定，仅在当前场景使用。 */
    const recorded = agent.session.events.find(event => event.type === 'assistant/message')
    expect(recorded?.type === 'assistant/message' && recorded.data.message.source).toEqual({
      kind: 'model', provider: 'mock', model: 'next-model', replayState,
    })
    expect(agent.session.deriveMessages().at(-1)?.source).toEqual({
      kind: 'model', provider: 'mock', model: 'next-model', replayState,
    })
  })
})

describe('abort during tool execution ends the turn', () => {
  it('parks context finalized after a tool-step abort until another wakeup', async () => {
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter([
      toolCallResponse('c1', 'aborter', {}),
      textResponse('after wake'),
    ])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await harness(adapter)
    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = ctx.agentLoop.create(SessionId('a-abort-injection'), { provider: 'mock', model: 'mock' })
    ctx.tools.register(defineContentToolFixture({
      name: 'aborter',
      description: '',
      parameters: {},
      async execute() {
        agent.inject(createUserMessage({ content: [{ type: 'text', text: 'accepted before abort' }], source: { kind: 'plugin', plugin: 'test' } }))
        agent.cancel({ kind: 'user' })
        return [{ type: 'text', text: 'done' }]
      },
    }))
    ctx.on('tools/post-execute', async (): Promise<PostToolDecision> => ({
      kind: 'accept',
      additionalContexts: [createUserMessage({
        content: [{ type: 'text', text: 'accepted result context after abort' }],
        source: { kind: 'plugin', plugin: 'test' },
      })],
    }))

    send(agent, 'go')
    await waitForIdle(ctx, agent)

    expect(agent.session.events
      .filter(event => event.type === 'tool/result'
        || (event.type === 'user/message' && event.data.source.kind === 'plugin')
        || event.type === 'step/end' || event.type === 'turn/end')
      .map(event => event.type))
      .toEqual(['tool/result', 'step/end', 'turn/end'])
    expect(agent.inbox.nextStep.map(inboxText))
      .toEqual(['accepted result context after abort'])

    /** 中文说明：测试局部值 idle，由紧邻初始化决定，仅在当前场景使用。 */
    const idle = waitForIdle(ctx, agent)
    send(agent, 'wake')
    await idle

    expect(agent.session.events
      .flatMap(event => event.type === 'user/message' && event.data.source.kind === 'plugin'
        ? [event.data.content]
        : []))
      .toEqual([
        [{ type: 'text', text: 'accepted result context after abort' }],
      ])
  })

  it('records post-tool context when a later call aborts the batch', async () => {
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter([[
      { type: 'block-start', index: 0, blockType: 'tool-call' },
      { type: 'block-end', index: 0, block: { type: 'tool-call', id: CallId('c1'), name: 'first', arguments: '{}' } },
      { type: 'block-start', index: 1, blockType: 'tool-call' },
      { type: 'block-end', index: 1, block: { type: 'tool-call', id: CallId('c2'), name: 'aborter', arguments: '{}' } },
      { type: 'finish', reason: { kind: 'tool-calls' } },
    ] satisfies StreamChunk[]])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await harness(adapter)
    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = ctx.agentLoop.create(SessionId('a-later-abort-context'), { provider: 'mock', model: 'mock' })
    ctx.tools.register(defineContentToolFixture({
      name: 'first',
      description: '',
      parameters: {},
      async execute() {
        return [{ type: 'text', text: 'first done' }]
      },
    }))
    ctx.tools.register(defineContentToolFixture({
      name: 'aborter',
      description: '',
      parameters: {},
      async execute() {
        agent.cancel({ kind: 'user' })
        return [{ type: 'text', text: 'aborted' }]
      },
    }))
    ctx.on('tools/post-execute', async (exec, _result, next): Promise<PostToolDecision> => {
      if (exec.callId !== CallId('c1')) return next()
      return {
        kind: 'accept',
        additionalContexts: [createUserMessage({
          content: [{ type: 'text', text: 'accepted after first result' }],
          source: { kind: 'plugin', plugin: 'test' },
        })],
      }
    })

    send(agent, 'go')
    await waitForIdle(ctx, agent)

    /** 中文说明：测试局部值 events，由紧邻初始化决定，仅在当前场景使用。 */
    const events = [...agent.session.events]
    expect(events
      .filter(event => event.type === 'tool/result'
        || (event.type === 'user/message' && event.data.source.kind === 'plugin')
        || event.type === 'step/end' || event.type === 'turn/end')
      .map(event => event.type))
      .toEqual(['tool/result', 'tool/result', 'step/end', 'turn/end'])
    expect(events.flatMap(event =>
      event.type === 'user/message' && event.data.source.kind === 'plugin'
        ? [event.data.content]
        : [])[0])
      .toBeUndefined()
  })

  it('closes an empty admitted batch as a turn without a step', async () => {
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter([textResponse('must not run')])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await harness(adapter)
    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = ctx.agentLoop.create(SessionId('a-empty-batch'), { provider: 'mock', model: 'mock' })
    ctx.on('agent/pre-step', ({ agent: subject }, next) => {
      if (subject !== agent) return next()
      return Promise.resolve({ kind: 'enter', messages: [] })
    })
    send(agent, 'go')
    await waitForIdle(ctx, agent)
    expect(adapter.requests).toHaveLength(0)
    expect(agent.session.events.filter(event => event.type === 'turn/start'
      || event.type === 'step/start' || event.type === 'turn/end').map(event => event.type))
      .toEqual(['turn/start', 'turn/end'])
    expect(agent.session.events.find(event => event.type === 'turn/end')?.data)
      .toEqual({ turn: 1, reason: { kind: 'completed' } })
    expect(agent.inbox.nextTurn).toHaveLength(0)
  })

  it('parks result context finalized after disposal cancellation without opening another turn', async () => {
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter([toolCallResponse('c1', 'waiter', {})])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await harness(adapter)
    /** 中文说明：测试局部值 started，由紧邻初始化决定，仅在当前场景使用。 */
    const started = Promise.withResolvers<undefined>()
    /** 中文说明：测试局部值 agent!: Agent，由紧邻初始化决定，仅在当前场景使用。 */
    let agent!: Agent
    /** 中文说明：测试局部值 fiber，由紧邻初始化决定，仅在当前场景使用。 */
    const fiber = await ctx.plugin(Object.assign((inner: Context) => {
      agent = inner.agentLoop.create(SessionId('a-dispose-injection'), { provider: 'mock', model: 'mock' })
    }, { inject: ['agentLoop'] }))
    ctx.tools.register(defineContentToolFixture({
      name: 'waiter',
      description: '',
      parameters: {},
      async execute(_args, exec) {
        agent.inject(createUserMessage({ content: [{ type: 'text', text: 'accepted before disposal' }], source: { kind: 'plugin', plugin: 'test' } }))
        started.resolve(undefined)
        /** 中文说明：测试局部值 signal，由紧邻初始化决定，仅在当前场景使用。 */
        const signal = exec.signal
        if (!signal) throw new Error('tool execution signal is missing')
        await new Promise<void>((resolve) => {
          if (signal.aborted) resolve()
          else signal.addEventListener('abort', () => { resolve() }, { once: true })
        })
        return [{ type: 'text', text: 'done' }]
      },
    }))
    ctx.on('tools/post-execute', async (): Promise<PostToolDecision> => ({
      kind: 'accept',
      additionalContexts: [createUserMessage({
        content: [{ type: 'text', text: 'accepted result context during disposal' }],
        source: { kind: 'plugin', plugin: 'test' },
      })],
    }))

    send(agent, 'go')
    await started.promise
    await fiber.dispose()

    expect(agent.session.events
      .flatMap(event => event.type === 'user/message' && event.data.source.kind === 'plugin'
        ? [event.data.content]
        : []))
      .toEqual([])
    expect(agent.inbox.nextStep.map(inboxText))
      .toEqual(['accepted result context during disposal'])
    expect(agent.session.events.filter(event => event.type === 'turn/start'))
      .toHaveLength(1)
    expect(agent.session.events.find(event => event.type === 'turn/end')?.data.reason)
      .toEqual({ kind: 'aborted', reason: { kind: 'disposed' } })
  })

  it('limits injection deferral to the current tool batch', async () => {
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter([
      [
        { type: 'block-start', index: 0, blockType: 'tool-call' },
        { type: 'block-end', index: 0, block: { type: 'tool-call', id: CallId('c1'), name: 'aborter', arguments: '{}' } },
        { type: 'block-start', index: 1, blockType: 'tool-call' },
        { type: 'block-end', index: 1, block: { type: 'tool-call', id: CallId('c2'), name: 'second', arguments: '{}' } },
        { type: 'finish', reason: { kind: 'tool-calls' } },
      ] satisfies StreamChunk[],
      textResponse('later turn'),
    ])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await harness(adapter)
    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = ctx.agentLoop.create(SessionId('a-historical-tool-pair'), { provider: 'mock', model: 'mock' })
    ctx.tools.register(defineContentToolFixture({
      name: 'aborter',
      description: '',
      parameters: {},
      async execute() {
        agent.cancel({ kind: 'user' })
        return [{ type: 'text', text: 'done' }]
      },
    }))
    ctx.tools.register(defineContentToolFixture({
      name: 'second',
      description: '',
      parameters: {},
      async execute() {
        return [{ type: 'text', text: 'must not run' }]
      },
    }))

    send(agent, 'leave an unmatched historical call')
    await waitForIdle(ctx, agent)
    /** 中文说明：测试局部值 disposeInjection，由紧邻初始化决定，仅在当前场景使用。 */
    const disposeInjection = ctx.on('agent/pre-step', async ({ agent: subject, turn }, next) => {
      /** 中文说明：测试局部值 decision，由紧邻初始化决定，仅在当前场景使用。 */
      const decision = await next()
      if (subject === agent && turn === 2 && decision.kind === 'enter') {
        disposeInjection()
        return {
          kind: 'enter' as const,
          messages: [...decision.messages, createUserMessage({
            content: [{ type: 'text', text: 'new turn context' }],
            source: { kind: 'plugin', plugin: 'test' },
          })],
        }
      }
      return decision
    })
    send(agent, 'start a text-only turn')
    await waitForIdle(ctx, agent)

    expect(agent.session.events.flatMap(event =>
      event.type === 'user/message' && event.data.source.kind === 'plugin'
        ? [event.data.content]
        : [])[0])
      .toEqual([{ type: 'text', text: 'new turn context' }])
    expect(JSON.stringify(adapter.requests[1]?.messages)).toContain('new turn context')
  })
})

describe('steering from late extension points is never stranded', () => {
  it('steer() from an agent/turn-stopping listener continues the same turn', async () => {
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter([
      textResponse('no tools, would stop here'),
      textResponse('continued because of steering'),
    ])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await harness(adapter)
    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })

    /** 中文说明：测试局部值 steeredOnce，由紧邻初始化决定，仅在当前场景使用。 */
    let steeredOnce = false
    ctx.on('agent/turn-stopping', () => {
      if (!steeredOnce) {
        steeredOnce = true
        agent.steer(createUserMessage({ content: [{ type: 'text', text: 'one more thing' }], source: { kind: 'user' } }))
      }
    })

    send(agent, 'go')
    await waitForIdle(ctx, agent)

    // the default decision was false (no tools), but steering forced step 2
    expect(adapter.requests).toHaveLength(2)
    expect(JSON.stringify(adapter.requests[1]!.messages)).toContain('one more thing')
  })

})

describe('plugin exceptions are contained', () => {
  it('a throwing agent/turn-stopping listener ends the turn with an error, loop survives', async () => {
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter([textResponse('one'), textResponse('two')])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await harness(adapter)
    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })

    /** 中文说明：测试局部值 threwOnce，由紧邻初始化决定，仅在当前场景使用。 */
    let threwOnce = false
    ctx.on('agent/turn-stopping', async () => {
      if (!threwOnce) {
        threwOnce = true
        throw new Error('broken continuation plugin')
      }
    })

    send(agent, 'first')
    await waitForIdle(ctx, agent)
    expect(agent.session.events.findLast(event => event.type === 'turn/end')).toMatchObject({
      data: { reason: { kind: 'error', error: { message: 'broken continuation plugin', code: 'UNKNOWN' } } },
    })

    // the loop is still alive: a second send works normally
    send(agent, 'second')
    await waitForIdle(ctx, agent)
    expect(adapter.requests).toHaveLength(2)
    expect(agent.status).toBe('idle')
  })

})

describe('disposal leaves the two-state status contract balanced', () => {
  it('disposing the fiber ends the active turn and never starts its queued tail', async () => {
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

    /** 中文说明：测试局部值 statuses，由紧邻初始化决定，仅在当前场景使用。 */
    const statuses: string[] = []
    /** 中文说明：测试局部值 reasons，由紧邻初始化决定，仅在当前场景使用。 */
    const reasons: TurnEndReason[] = []
    ctx.on('agent/status', ({ status }) => void statuses.push(status))
    ctx.on('session/event', (_s, event) => { if (event.type === 'turn/end') reasons.push(event.data.reason) })

    send(agent, 'go')
    await new Promise(r => setTimeout(r, 30))
    send(agent, 'queued tail')
    await fiber.dispose()
    await driverDone(agent)

    expect(statuses).toEqual(['running', 'idle'])
    expect(reasons).toEqual([{ kind: 'aborted', reason: { kind: 'disposed' } }])
    expect(agent.session.events.filter(event => event.type === 'turn/start')).toHaveLength(1)
    /** 中文说明：测试局部值 messages，由紧邻初始化决定，仅在当前场景使用。 */
    const messages = agent.session.events
      .filter(event => event.type === 'user/message')
      .flatMap(event => event.data.content)
      .flatMap(block => block.type === 'text' ? [block.text] : [])
    expect(messages).toEqual(['go'])
    expect(adapter.requests).toHaveLength(1)
  })

  it('a throwing agent/status listener cannot break disposal or leak the registry entry', async () => {
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

    ctx.on('agent/status', ({ status }) => {
      if (status === 'idle') throw new Error('broken status listener')
    })

    send(agent, 'go')
    await new Promise(r => setTimeout(r, 30))
    await fiber.dispose()
    await driverDone(agent) // must not hang

    expect(ctx.agents.get(SessionId('scoped'))).toBeUndefined()
  })
})

describe('adapter registration, routing, and accepted-input ownership', () => {
  it('duplicate adapter registration is rejected', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter([])
    ctx.llm.registerAdapter(['m1'], adapter)
    expect(() => ctx.llm.registerAdapter(['m1'], new MockAdapter([])))
      .toThrow('already registered')
    // the original registration survives the failed attempt
    expect(ctx.llm.listProviders()).toEqual([{ id: 'm1', name: 'm1' }])
  })

  it('an agent without a model fails the step with a clear error (not NO_ADAPTER for "default")', async () => {
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter([textResponse('never')])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await harness(adapter)
    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = ctx.agentLoop.create(SessionId('a1'), {}) // no model

    send(agent, 'go')
    await waitForIdle(ctx, agent)
    /** 中文说明：测试局部值 turnEnd，由紧邻初始化决定，仅在当前场景使用。 */
    const turnEnd = agent.session.events.findLast(event => event.type === 'turn/end')
    expect(turnEnd?.type === 'turn/end' && turnEnd.data.reason.kind === 'error'
      ? turnEnd.data.reason.error.message
      : undefined).toContain('has no provider/model')
    expect(turnEnd?.type === 'turn/end' && turnEnd.data.reason.kind === 'error'
      ? turnEnd.data.reason.error.message
      : undefined).toContain('agent/request')
  })

  it('the agent/request waterfall can supply the model for a model-less agent', async () => {
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter([textResponse('routed')])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await harness(adapter)
    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = ctx.agentLoop.create(SessionId('a1'), {}) // no model — router plugin decides

    ctx.on('agent/request', async (_payload, next) => {
      return { ...await next(), provider: 'mock', model: 'mock' }
    })

    send(agent, 'go')
    await waitForIdle(ctx, agent)
    expect(adapter.requests).toHaveLength(1)
    expect(agent.session.deriveMessages().at(-1)?.content).toEqual([{ type: 'text', text: 'routed' }])
  })

  it('durable inbox splices carry exact messages and the claimed steer preserves its source', async () => {
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter([toolCallResponse('c1', 'noop', {}), textResponse('done')])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await harness(adapter)
    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
    ctx.tools.register(defineContentToolFixture({
      name: 'noop',
      description: '',
      parameters: {},
      async execute() {
        agent.steer(createUserMessage({ content: [{ type: 'text', text: 's' }], source: { kind: 'plugin', plugin: 'goal' } }))
        return []
      },
    }))

    /** 中文说明：测试局部值 insertedSources，由紧邻初始化决定，仅在当前场景使用。 */
    const insertedSources: MessageSource[] = []
    /** 中文说明：测试局部值 insertedShapes，由紧邻初始化决定，仅在当前场景使用。 */
    const insertedShapes: string[][] = []
    /** 中文说明：测试局部值 targets，由紧邻初始化决定，仅在当前场景使用。 */
    const targets: string[] = []
    ctx.on('session/event', (session, event) => {
      if (session !== agent.session || event.type !== 'agent/inbox/spliced') return
      /** 中文说明：测试局部值 message，由紧邻初始化决定，仅在当前场景使用。 */
      for (const message of event.data.inserted) {
        insertedSources.push(message.source)
        insertedShapes.push(Object.keys(message).sort())
        targets.push(event.data.target)
      }
    })

    send(agent, 'go') // no explicit source → default {kind:'user'} must be visible
    await waitForIdle(ctx, agent)

    expect(insertedSources).toEqual([
      { kind: 'user' },
      { kind: 'plugin', plugin: 'goal' },
    ])
    expect(insertedShapes).toEqual([
      ['content', 'id', 'role', 'source'],
      ['content', 'id', 'role', 'source'],
    ])
    expect(targets).toEqual(['next-turn', 'next-step'])
    /** 中文说明：测试局部值 steeringSources，由紧邻初始化决定，仅在当前场景使用。 */
    const steeringSources = agent.session.events.flatMap(e =>
      e.type === 'user/message' && e.data.source.kind === 'plugin' ? [e.data.source] : [])
    expect(steeringSources).toEqual([{ kind: 'plugin', plugin: 'goal' }])
  })

})

describe('turn numbering continues across seeded sessions', () => {
  it('a forked agent continues turn numbers after the seed log', async () => {
    /** 中文说明：测试局部值 first，由紧邻初始化决定，仅在当前场景使用。 */
    const first = new MockAdapter([textResponse('turn one')])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await harness(first)
    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
    send(agent, 'first')
    await waitForIdle(ctx, agent)

    // fork: seed a second context's agent with the first session's log
    /** 中文说明：测试局部值 second，由紧邻初始化决定，仅在当前场景使用。 */
    const second = new MockAdapter([textResponse('turn two')])
    /** 中文说明：测试局部值 ctx2，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx2 = new Context()
    await ctx2.plugin(LlmRuntime)
    await ctx2.plugin(SessionStore)
    await ctx2.plugin(SystemPrompt)
    await ctx2.plugin(ToolRuntime)
    await ctx2.plugin(AgentRegistry)
    await ctx2.plugin(AgentLoop, { agents: [] })
    ctx2.llm.registerAdapter(['mock'], second)

    /** 中文说明：测试局部值 seeded，由紧邻初始化决定，仅在当前场景使用。 */
    const seeded = ctx2.sessions.create(SessionId('forked'), { seed: [...agent.session.events] })
    /** 中文说明：测试局部值 forked，由紧邻初始化决定，仅在当前场景使用。 */
    const forked = new ReactLoopAgent(
      ctx2, SessionId('forked-agent'), { provider: 'mock', model: 'mock' }, seeded,
    )

    /** 中文说明：测试局部值 turns，由紧邻初始化决定，仅在当前场景使用。 */
    const turns: number[] = []
    ctx2.on('session/event', (_s, event) => { if (event.type === 'turn/start') turns.push(event.data.turn) })
    forked.followup(createUserMessage({ content: [{ type: 'text', text: 'continue' }], source: { kind: 'user' } }))
    await new Promise<void>((resolve) => {
      ctx2.on('agent/status', ({ agent: subject, status }) => {
        if (subject === forked && status === 'idle') resolve()
      })
    })

    expect(turns).toEqual([2])
  })
})

describe('discriminated SessionEvent narrows without casts', () => {
  it('narrows event.data from event.type', () => {
    /** 中文说明：测试局部值 session，由紧邻初始化决定，仅在当前场景使用。 */
    const session = Session.create(SessionId('s'))
    /** 中文说明：测试局部值 appended，由紧邻初始化决定，仅在当前场景使用。 */
    const appended: SessionEvent = session.append('tool/call', {
      turn: 1, step: 1, callId: CallId('c1'), name: 'echo', arguments: '{}',
    })
    // compile-time: this switch narrows; runtime: values flow through
    switch (appended.type) {
      case 'tool/call': {
        expect(appended.data.callId).toBe('c1')
        expect(appended.data.name).toBe('echo')
        break
      }
      default: throw new Error('wrong narrow')
    }
  })
})

describe('a finish-error stream chunk ends the turn as error, not completed', () => {
  it('translates finish {kind:error} into a turn error with a logged error event', async () => {
    // A finish-error chunk must not produce a completed assistant turn.
    /** 中文说明：测试局部值 failure，由紧邻初始化决定，仅在当前场景使用。 */
    const failure = {
      message: 'provider 401',
      code: 'AUTH',
      status: 401,
      providerRetryAfterMs: 2_000,
      requestId: ProviderRequestId('finish-request-1'),
    }
    /** 中文说明：测试局部值 errorStream，由紧邻初始化决定，仅在当前场景使用。 */
    const errorStream: StreamChunk[] = [
      { type: 'finish', reason: { kind: 'error', failure } },
    ]
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter([errorStream])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await harness(adapter)
    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = ctx.agentLoop.create(SessionId('a-finish-error'), { provider: 'mock', model: 'mock' })

    /** 中文说明：测试局部值 reasons，由紧邻初始化决定，仅在当前场景使用。 */
    const reasons: TurnEndReason[] = []
    /** 中文说明：测试局部值 errors，由紧邻初始化决定，仅在当前场景使用。 */
    const errors: unknown[] = []
    ctx.on('agent/error', ({ turn, step, error }) => {
      expect({ turn, step }).toEqual({ turn: 1, step: 1 })
      errors.push(error)
    })
    ctx.on('session/event', (_s, event) => { if (event.type === 'turn/end') reasons.push(event.data.reason) })

    send(agent, 'go')
    await waitForIdle(ctx, agent)

    expect(reasons).toEqual([{ kind: 'error', error: failure }])
    expect(errors).toHaveLength(1)
    expect(errors[0]).toBeInstanceOf(LlmError)
    expect((errors[0] as LlmError).failure).toEqual(failure)

    /** 中文说明：测试局部值 events，由紧邻初始化决定，仅在当前场景使用。 */
    const events = [...agent.session.events]
    /** 中文说明：测试局部值 turnEnd，由紧邻初始化决定，仅在当前场景使用。 */
    const turnEnd = events.find(event => event.type === 'turn/end')
    expect(turnEnd).toMatchObject({ data: { reason: { kind: 'error', error: failure } } })
    // A failed step must not synthesize an assistant message.
    expect(events.some(event => event.type === 'assistant/message')).toBe(false)
  })

  it('translates finish {kind:aborted} into a turn error coded ABORTED', async () => {
    /** 中文说明：测试局部值 abortedStream，由紧邻初始化决定，仅在当前场景使用。 */
    const abortedStream: StreamChunk[] = [
      { type: 'finish', reason: { kind: 'aborted', failure: { message: 'model stream aborted', code: 'ABORTED' } } },
    ]
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter([abortedStream])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await harness(adapter)
    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = ctx.agentLoop.create(SessionId('a-finish-aborted'), { provider: 'mock', model: 'mock' })

    /** 中文说明：测试局部值 reasons，由紧邻初始化决定，仅在当前场景使用。 */
    const reasons: TurnEndReason[] = []
    ctx.on('session/event', (_s, event) => { if (event.type === 'turn/end') reasons.push(event.data.reason) })

    send(agent, 'go')
    await waitForIdle(ctx, agent)

    expect(reasons).toEqual([{ kind: 'error', error: { message: 'model stream aborted', code: 'ABORTED' } }])
    expect([...agent.session.events].some(event => event.type === 'assistant/message')).toBe(false)
  })

  it('handles a finish error without a code (code key omitted)', async () => {
    /** 中文说明：测试局部值 errorStream，由紧邻初始化决定，仅在当前场景使用。 */
    const errorStream: StreamChunk[] = [
      { type: 'finish', reason: { kind: 'error', failure: { message: 'codeless failure', code: 'UNKNOWN' } } },
    ]
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter([errorStream])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await harness(adapter)
    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = ctx.agentLoop.create(SessionId('a-finish-error-nocode'), { provider: 'mock', model: 'mock' })

    /** 中文说明：测试局部值 reasons，由紧邻初始化决定，仅在当前场景使用。 */
    const reasons: TurnEndReason[] = []
    ctx.on('session/event', (_s, event) => { if (event.type === 'turn/end') reasons.push(event.data.reason) })

    send(agent, 'go')
    await waitForIdle(ctx, agent)

    expect(reasons).toEqual([{ kind: 'error', error: { message: 'codeless failure', code: 'UNKNOWN' } }])
  })
})

describe('step boundary publication order', () => {
  it('the step/start event is in session.events when its session/event listener fires', async () => {
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter([textResponse('done')])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await harness(adapter)
    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = ctx.agentLoop.create(SessionId('a-step-order'), { provider: 'mock', model: 'mock' })

    /** 中文说明：测试局部值 observed，由紧邻初始化决定，仅在当前场景使用。 */
    const observed: { turn: number; step: number; lastEventType: string | undefined; sawStepStart: boolean }[] = []
    ctx.on('session/event', (subject, event) => {
      if (subject !== agent.session || event.type !== 'step/start') return
      /** 中文说明：测试局部值 events，由紧邻初始化决定，仅在当前场景使用。 */
      const events = [...subject.events]
      /** 中文说明：测试局部值 last，由紧邻初始化决定，仅在当前场景使用。 */
      const last = events.at(-1)
      observed.push({
        turn: event.data.turn,
        step: event.data.step,
        lastEventType: last?.type,
        sawStepStart: events.some(e => e.type === 'step/start' && e.data.turn === event.data.turn && e.data.step === event.data.step),
      })
    })

    send(agent, 'go')
    await waitForIdle(ctx, agent)

    expect(observed).toHaveLength(1)
    expect(observed[0]).toMatchObject({ turn: 1, step: 1, lastEventType: 'step/start', sawStepStart: true })
  })
})

describe('turn and step boundary recovery', () => {
  // The session invariant companion makes an unbalanced log fail the test.
  /** 中文说明：测试辅助函数 balancedHarness 的参数见签名，返回值用于驱动或断言场景；示例见下方用例。 */
  async function balancedHarness(adapter: MockAdapter) {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(SessionStore)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(AgentLoop, { agents: [] })
    await mountInvariants(ctx)
    ctx.llm.registerAdapter(['mock'], adapter)
    return ctx
  }

  /** Count turn/step boundary events for balance assertions. */
  /* 中文说明：测试辅助函数 boundaryCounts 的参数见签名，返回值用于驱动或断言场景；示例见下方用例。 */
  function boundaryCounts(agent: Agent) {
    /** 中文说明：测试局部值 e，由紧邻初始化决定，仅在当前场景使用。 */
    const e = [...agent.session.events]
    return {
      turnStart: e.filter(x => x.type === 'turn/start').length,
      turnEnd: e.filter(x => x.type === 'turn/end').length,
      stepStart: e.filter(x => x.type === 'step/start').length,
      stepEnd: e.filter(x => x.type === 'step/end').length,
      errors: e.filter(x => x.type === 'turn/end' && x.data.reason.kind === 'error').length,
      lastTurnEnd: e.findLast(x => x.type === 'turn/end'),
    }
  }

  it('a throwing step/start observer cannot change a successful turn', async () => {
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter([textResponse('request completed')])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await balancedHarness(adapter)
    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = ctx.agentLoop.create(SessionId('a-stepstart'), { provider: 'mock', model: 'mock' })

    // Session owns post-commit containment. The loop sees a successful append,
    // runs the request, and balances the ordinary step and turn boundaries.
    /** 中文说明：测试局部值 threw，由紧邻初始化决定，仅在当前场景使用。 */
    let threw = false
    ctx.on('session/event', (_s, event) => {
      if (event.type === 'step/start' && !threw) { threw = true; throw new Error('boom step-start') }
    })
    /** 中文说明：测试局部值 errors，由紧邻初始化决定，仅在当前场景使用。 */
    const errors: Error[] = []
    ctx.on('agent/error', ({ error }) => {
      if (error instanceof Error) errors.push(error)
    })

    send(agent, 'go')
    await waitForIdle(ctx, agent)

    /** 中文说明：测试局部值 e，由紧邻初始化决定，仅在当前场景使用。 */
    const e = [...agent.session.events]
    /** 中文说明：测试局部值 c，由紧邻初始化决定，仅在当前场景使用。 */
    const c = boundaryCounts(agent)
    expect(c).toMatchObject({ turnStart: 1, turnEnd: 1, stepStart: 1, stepEnd: 1, errors: 0 })
    expect(errors).toEqual([])
    // step/end precedes turn/end (the invariants oracle would reject
    // turn/end-while-step-open, but assert the order explicitly too).
    /** 中文说明：测试局部值 stepEndIdx，由紧邻初始化决定，仅在当前场景使用。 */
    const stepEndIdx = e.findIndex(x => x.type === 'step/end')
    /** 中文说明：测试局部值 turnEndIdx，由紧邻初始化决定，仅在当前场景使用。 */
    const turnEndIdx = e.findIndex(x => x.type === 'turn/end')
    expect(stepEndIdx).toBeGreaterThanOrEqual(0)
    expect(stepEndIdx).toBeLessThan(turnEndIdx)
  })

  it('a pre-commit turn/start rejection leaves no durable turn state', async () => {
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter([])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await balancedHarness(adapter)
    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = ctx.agentLoop.create(SessionId('a-turnstart-veto'), { provider: 'mock', model: 'mock' })
    /** 中文说明：测试局部值 rejected，由紧邻初始化决定，仅在当前场景使用。 */
    let rejected = false
    ctx.on('internal/dispatch', (_mode, name, args) => {
      if (name !== 'session/event') return
      /** 中文说明：测试局部值 event，由紧邻初始化决定，仅在当前场景使用。 */
      const event = args[1] as SessionEvent
      if (event.type === 'turn/start' && !rejected) {
        rejected = true
        throw new Error('reject turn-start before commit')
      }
    })
    /** 中文说明：测试局部值 errors，由紧邻初始化决定，仅在当前场景使用。 */
    const errors: Error[] = []
    ctx.on('agent/error', ({ error }) => {
      if (error instanceof Error) errors.push(error)
    })

    send(agent, 'rejected')
    await waitForIdle(ctx, agent)

    expect(agent.session.events.some(event => event.type === 'turn/start'
      || event.type === 'user/message')).toBe(false)
    expect(agent.inbox.nextTurn).toHaveLength(1)
    expect(errors.map(error => error.message)).toEqual(['reject turn-start before commit'])
    expect(adapter.requests).toHaveLength(0)
  })

  it('a pre-commit step/start validation failure does not invent a step boundary', async () => {
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter([textResponse('never reached')])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await balancedHarness(adapter)
    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = ctx.agentLoop.create(SessionId('a-stepstart-veto'), { provider: 'mock', model: 'mock' })
    /** 中文说明：测试局部值 rejected，由紧邻初始化决定，仅在当前场景使用。 */
    let rejected = false
    ctx.on('internal/dispatch', (_mode, name, args) => {
      if (name !== 'session/event') return
      /** 中文说明：测试局部值 event，由紧邻初始化决定，仅在当前场景使用。 */
      const event = args[1] as SessionEvent
      if (event.type === 'step/start' && !rejected) {
        rejected = true
        throw new Error('reject step-start before commit')
      }
    })
    send(agent, 'go')
    await waitForIdle(ctx, agent)

    expect(adapter.requests).toEqual([])
    expect(boundaryCounts(agent)).toMatchObject({
      turnStart: 1,
      turnEnd: 1,
      stepStart: 0,
      stepEnd: 0,
      errors: 1,
    })
    expect(agent.session.events.findLast(event => event.type === 'turn/end')).toMatchObject({
      data: { reason: { kind: 'error', error: { message: 'reject step-start before commit', code: 'UNKNOWN' } } },
    })
  })

  it('a step/end validation failure surfaces the resulting open-step invariant', async () => {
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter([textResponse('completed before close validation')])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await balancedHarness(adapter)
    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = ctx.agentLoop.create(SessionId('a-stepend-veto'), { provider: 'mock', model: 'mock' })
    /** 中文说明：测试局部值 rejected，由紧邻初始化决定，仅在当前场景使用。 */
    let rejected = false
    ctx.on('internal/dispatch', (_mode, name, args) => {
      if (name !== 'session/event') return
      /** 中文说明：测试局部值 event，由紧邻初始化决定，仅在当前场景使用。 */
      const event = args[1] as SessionEvent
      if (event.type === 'step/end' && !rejected) {
        rejected = true
        throw new Error('reject first step-end')
      }
    })
    /** 中文说明：测试局部值 errors，由紧邻初始化决定，仅在当前场景使用。 */
    const errors: Error[] = []
    ctx.on('agent/error', ({ error }) => {
      if (error instanceof Error) errors.push(error)
    })

    send(agent, 'go')
    await waitForIdle(ctx, agent)

    expect(adapter.requests).toHaveLength(1)
    expect(errors.map(error => error.message)).toEqual([
      'reject first step-end',
      'invariant violated by "@deepseek-ai/dsh-session": turn/end 1 while step 1 is still open',
    ])
    expect(boundaryCounts(agent)).toMatchObject({
      turnStart: 1,
      turnEnd: 0,
      stepStart: 1,
      stepEnd: 0,
      errors: 0,
    })
  })

  it('a throwing agent/error listener during a step-error path still balances the turn, loop survives', async () => {
    // Listener failure cannot interrupt error finalization or the next turn.
    /** 中文说明：测试局部值 errorStream，由紧邻初始化决定，仅在当前场景使用。 */
    const errorStream: StreamChunk[] = [{ type: 'finish', reason: { kind: 'error', failure: { message: 'provider 500', code: 'SERVER' } } }]
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter([errorStream, textResponse('turn 2 ok')])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await balancedHarness(adapter)
    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = ctx.agentLoop.create(SessionId('a-errorlistener'), { provider: 'mock', model: 'mock' })

    /** 中文说明：测试局部值 threw，由紧邻初始化决定，仅在当前场景使用。 */
    let threw = false
    ctx.on('agent/error', () => { if (!threw) { threw = true; throw new Error('boom error-listener') } })

    send(agent, 'go')
    await waitForIdle(ctx, agent)

    /** 中文说明：测试局部值 c，由紧邻初始化决定，仅在当前场景使用。 */
    const c = boundaryCounts(agent)
    // turn 1 balanced despite the throwing agent/error listener.
    expect(c.turnStart).toBe(1)
    expect(c.turnEnd).toBe(1)
    expect(c.stepStart).toBe(c.stepEnd)
    expect(c.lastTurnEnd?.type === 'turn/end' && c.lastTurnEnd.data.reason).toMatchObject({
      kind: 'error',
      error: { message: 'provider 500', code: 'SERVER' },
    })
    expect(threw).toBe(true)

    // loop survives: a second turn runs to completion (invariants oracle would
    // throw on its turn/start if turn 1 had been left open).
    send(agent, 'again')
    await waitForIdle(ctx, agent)
    /** 中文说明：测试局部值 c2，由紧邻初始化决定，仅在当前场景使用。 */
    const c2 = boundaryCounts(agent)
    expect(c2.turnStart).toBe(2)
    expect(c2.turnEnd).toBe(2)
    expect(c2.stepStart).toBe(c2.stepEnd)
  })

  it('disposal during a running turn ends the turn with reason disposed (balanced)', async () => {
    // The 'hang' adapter blocks in stream() until the signal aborts; disposing
    // the agent's fiber mid-turn aborts the in-flight step. The turn must close
    // balanced with reason disposed (no error event for a disposal).
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter(['hang'])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await balancedHarness(adapter)
    /** 中文说明：测试局部值 agent!: Agent，由紧邻初始化决定，仅在当前场景使用。 */
    let agent!: Agent
    /** 中文说明：测试局部值 fiber，由紧邻初始化决定，仅在当前场景使用。 */
    const fiber = await ctx.plugin(Object.assign((inner: Context) => {
      agent = inner.agentLoop.create(SessionId('a-dispose'), { provider: 'mock', model: 'mock' })
    }, { inject: ['agentLoop'] }))

    /** 中文说明：测试局部值 reasons，由紧邻初始化决定，仅在当前场景使用。 */
    const reasons: TurnEndReason[] = []
    ctx.on('session/event', (_s, event) => { if (event.type === 'turn/end') reasons.push(event.data.reason) })

    send(agent, 'go')
    await new Promise(r => setTimeout(r, 30))
    await fiber.dispose() // dispose during the hanging step
    await driverDone(agent)

    /** 中文说明：测试局部值 e，由紧邻初始化决定，仅在当前场景使用。 */
    const e = [...agent.session.events]
    /** 中文说明：测试局部值 turnStarts，由紧邻初始化决定，仅在当前场景使用。 */
    const turnStarts = e.filter(x => x.type === 'turn/start').length
    /** 中文说明：测试局部值 turnEnds，由紧邻初始化决定，仅在当前场景使用。 */
    const turnEnds = e.filter(x => x.type === 'turn/end').length
    expect(turnStarts).toBe(1)
    expect(turnEnds).toBe(1) // balanced — the turn was closed despite disposal
    expect(reasons).toEqual([{ kind: 'aborted', reason: { kind: 'disposed' } }])
    // no error reason: disposal is not a failure.
    expect(e.some(x => x.type === 'turn/end' && x.data.reason.kind === 'error')).toBe(false)
  })

  it('contains a pre-step throw after disposal inside a balanced no-step turn', async () => {
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter([textResponse('never reached')])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await balancedHarness(adapter)
    /** 中文说明：测试局部值 agent!: Agent，由紧邻初始化决定，仅在当前场景使用。 */
    let agent!: Agent
    /** 中文说明：测试局部值 fiber，由紧邻初始化决定，仅在当前场景使用。 */
    const fiber = await ctx.plugin(Object.assign((inner: Context) => {
      agent = inner.agentLoop.create(SessionId('a-prestep-dispose-throw'), { provider: 'mock', model: 'mock' })
    }, { inject: ['agentLoop'] }))

    /** 中文说明：测试局部值 threw，由紧邻初始化决定，仅在当前场景使用。 */
    let threw = false
    ctx.on('agent/pre-step', (_payload, next) => {
      if (threw) return next()
      threw = true
      void fiber.dispose()
      throw new Error('boom pre-step during disposal')
    })
    /** 中文说明：测试局部值 errorEmits，由紧邻初始化决定，仅在当前场景使用。 */
    const errorEmits: Error[] = []
    ctx.on('agent/error', ({ error }) => {
      if (error instanceof Error) errorEmits.push(error)
    })

    send(agent, 'go')
    await agent.whenIdle()

    /** 中文说明：测试局部值 e，由紧邻初始化决定，仅在当前场景使用。 */
    const e = [...agent.session.events]
    expect(e.filter(x => x.type === 'turn/start' || x.type === 'turn/end').map(x => x.type))
      .toEqual(['turn/start', 'turn/end'])
    expect(e.find(x => x.type === 'turn/end')?.data.reason)
      .toEqual({ kind: 'aborted', reason: { kind: 'disposed' } })
    expect(e.some(x => x.type === 'step/start')).toBe(false)
    expect(errorEmits).toHaveLength(0)
  })

  it('a throwing turn/start observer cannot starve the loop or later turns', async () => {
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter([textResponse('turn 1'), textResponse('turn 2')])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await harness(adapter)
    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = ctx.agentLoop.create(SessionId('a-preturn'), { provider: 'mock', model: 'mock' })

    /** 中文说明：测试局部值 threw，由紧邻初始化决定，仅在当前场景使用。 */
    let threw = false
    ctx.on('session/event', (_session, event) => {
      if (!threw && event.type === 'turn/start') { threw = true; throw new Error('boom turn/start append') }
    })
    /** 中文说明：测试局部值 errors，由紧邻初始化决定，仅在当前场景使用。 */
    const errors: Error[] = []
    ctx.on('agent/error', ({ error }) => {
      if (error instanceof Error) errors.push(error)
    })

    send(agent, 'go')
    await waitForIdle(ctx, agent)

    expect(errors).toEqual([])
    // Session contains the observer failure per listener, so the committed turn
    // remains visible to later observers and executes normally.
    /** 中文说明：测试局部值 types，由紧邻初始化决定，仅在当前场景使用。 */
    const types = [...agent.session.events].map(e => e.type)
    expect(types.filter(t => t === 'turn/start')).toHaveLength(1)
    expect(types.filter(t => t === 'turn/end')).toHaveLength(1)
    /** 中文说明：测试局部值 lastBoundary，由紧邻初始化决定，仅在当前场景使用。 */
    const lastBoundary = [...agent.session.events].reverse().find(e => e.type === 'turn/start' || e.type === 'turn/end')
    expect(lastBoundary?.type).toBe('turn/end')
    expect(agent.session.events.at(-1)?.type).toBe('turn/end')

    // loop survives: a second turn runs normally.
    send(agent, 'second')
    await waitForIdle(ctx, agent)
    expect(adapter.requests).toHaveLength(2)
  })

  it('a throwing step/end observer cannot rewrite the turn outcome', async () => {
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter([textResponse('all good'), textResponse('turn 2 ok')])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await balancedHarness(adapter)
    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = ctx.agentLoop.create(SessionId('a-stepend-throw'), { provider: 'mock', model: 'mock' })

    /** 中文说明：测试局部值 threw，由紧邻初始化决定，仅在当前场景使用。 */
    let threw = false
    ctx.on('session/event', (_s, event) => {
      if (event.type === 'step/end' && !threw) { threw = true; throw new Error('boom step-end') }
    })
    /** 中文说明：测试局部值 errors，由紧邻初始化决定，仅在当前场景使用。 */
    const errors: Error[] = []
    ctx.on('agent/error', ({ error }) => {
      if (error instanceof Error) errors.push(error)
    })

    send(agent, 'go')
    await waitForIdle(ctx, agent)

    /** 中文说明：测试局部值 c，由紧邻初始化决定，仅在当前场景使用。 */
    const c = boundaryCounts(agent)
    expect(c).toMatchObject({ turnStart: 1, turnEnd: 1, stepStart: 1, stepEnd: 1, errors: 0 })
    expect(errors).toEqual([])
    expect(c.lastTurnEnd?.type === 'turn/end' && c.lastTurnEnd.data.reason)
      .toEqual({ kind: 'completed' })

    // step/end precedes turn/end (ordering contract)
    /** 中文说明：测试局部值 e，由紧邻初始化决定，仅在当前场景使用。 */
    const e = [...agent.session.events]
    /** 中文说明：测试局部值 stepEndIdx，由紧邻初始化决定，仅在当前场景使用。 */
    const stepEndIdx = e.findIndex(x => x.type === 'step/end')
    /** 中文说明：测试局部值 turnEndIdx，由紧邻初始化决定，仅在当前场景使用。 */
    const turnEndIdx = e.findIndex(x => x.type === 'turn/end')
    expect(stepEndIdx).toBeGreaterThanOrEqual(0)
    expect(stepEndIdx).toBeLessThan(turnEndIdx)

    // loop survives: a subsequent turn runs to completion
    send(agent, 'again')
    await waitForIdle(ctx, agent)
    /** 中文说明：测试局部值 c2，由紧邻初始化决定，仅在当前场景使用。 */
    const c2 = boundaryCounts(agent)
    expect(c2.turnStart).toBe(2)
    expect(c2.turnEnd).toBe(2)
    expect(c2.stepStart).toBe(c2.stepEnd)
  })

  it('a throwing step/end observer cannot interrupt error finalization', async () => {
    // Observer failure after step/end commit cannot interrupt turn finalization.
    /** 中文说明：测试局部值 errorStream，由紧邻初始化决定，仅在当前场景使用。 */
    const errorStream: StreamChunk[] = [{ type: 'finish', reason: { kind: 'error', failure: { message: 'provider 500', code: 'SERVER' } } }]
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter([errorStream, textResponse('turn 2 ok')])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await harness(adapter)
    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = ctx.agentLoop.create(SessionId('a-stependthrow'), { provider: 'mock', model: 'mock' })

    /** 中文说明：测试局部值 threw，由紧邻初始化决定，仅在当前场景使用。 */
    let threw = false
    ctx.on('session/event', (_s, event) => {
      if (!threw && event.type === 'step/end') { threw = true; throw new Error('boom step/end listener') }
    })
    /** 中文说明：测试局部值 errors，由紧邻初始化决定，仅在当前场景使用。 */
    const errors: Error[] = []
    ctx.on('agent/error', ({ error }) => {
      if (error instanceof Error) errors.push(error)
    })

    send(agent, 'go')
    await waitForIdle(ctx, agent)

    /** 中文说明：测试局部值 e，由紧邻初始化决定，仅在当前场景使用。 */
    const e = [...agent.session.events]
    // Both step/end and turn/end are present — finalization ran to completion.
    expect(e.some(x => x.type === 'step/end')).toBe(true)
    expect(e.some(x => x.type === 'turn/end')).toBe(true)
    expect(e.at(-1)?.type).toBe('turn/end')
    expect(errors).toHaveLength(1)
    expect(errors[0]).toBeInstanceOf(LlmError)
    expect((errors[0] as LlmError).failure).toEqual({ message: 'provider 500', code: 'SERVER' })

    // loop survives.
    send(agent, 'again')
    await waitForIdle(ctx, agent)
    expect(e.filter(x => x.type === 'turn/start').length).toBeGreaterThanOrEqual(1)
  })

  it('a throwing session/event listener on turn/end is contained (turn still balanced, loop survives)', async () => {
    // Session contains the observer failure after committing turn/end, so the
    // boundary stays authoritative and the loop continues normally.
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter([textResponse('turn 1'), textResponse('turn 2')])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await harness(adapter)
    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = ctx.agentLoop.create(SessionId('a-turnendappend'), { provider: 'mock', model: 'mock' })

    /** 中文说明：测试局部值 threw，由紧邻初始化决定，仅在当前场景使用。 */
    let threw = false
    ctx.on('session/event', (_s, event) => {
      if (!threw && event.type === 'turn/end') { threw = true; throw new Error('boom turn/end listener') }
    })

    send(agent, 'go')
    await waitForIdle(ctx, agent)
    // turn 1 is balanced despite the throwing turn/end listener.
    /** 中文说明：测试局部值 e1，由紧邻初始化决定，仅在当前场景使用。 */
    const e1 = [...agent.session.events]
    expect(e1.filter(x => x.type === 'turn/start')).toHaveLength(1)
    expect(e1.filter(x => x.type === 'turn/end')).toHaveLength(1)
    expect(e1.at(-1)?.type).toBe('turn/end')

    // loop survives: a second turn runs to completion.
    send(agent, 'again')
    await waitForIdle(ctx, agent)
    expect(adapter.requests).toHaveLength(2)
    expect([...agent.session.events].filter(x => x.type === 'turn/end')).toHaveLength(2)
  })
})

describe('tool result call identity', () => {
  it('the loop records tool/result under the model call.id even when a post-execute listener replaces content', async () => {
    // Model emits a tool-call with id "c1", then a final text turn.
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter([
      toolCallResponse('c1', 'echo', { x: 1 }),
      textResponse('done'),
    ])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await harness(adapter)
    ctx.tools.register(defineContentToolFixture({
      name: 'echo',
      description: 'echo',
      parameters: { x: { type: 'number' } },
      async execute() { return [{ type: 'text', text: 'ok' }] },
    }))

    // A post-execute listener transforms the result (accept-with-replacement).
    // The loop must still record the tool/result under the model's authoritative
    // call.id, which is the immutable identity carried by the execution input.
    ctx.on('tools/post-execute', (exec, _result) => {
      expect(exec.callId).toBe(CallId('c1')) // the loop passed the real id in
      return Promise.resolve({ kind: 'accept', content: [{ type: 'text', text: 'ok' }] })
    }, { prepend: true })

    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = ctx.agentLoop.create(SessionId('a-callid'), { provider: 'mock', model: 'mock' })
    send(agent, 'use tool')
    await waitForIdle(ctx, agent)

    // The logged tool/result.callId is the originating call.id.
    /** 中文说明：测试局部值 resultEvent，由紧邻初始化决定，仅在当前场景使用。 */
    const resultEvent = [...agent.session.events].find(e => e.type === 'tool/result')
    expect(resultEvent?.type).toBe('tool/result')
    if (resultEvent?.type === 'tool/result') {
      expect(resultEvent.data.message.source.callId).toBe(CallId('c1'))
    }

    // And deriveMessages pairs the tool-result with the assistant tool-call:
    // the derived tool-result block's toolCallId equals the original call.id.
    /** 中文说明：测试局部值 messages，由紧邻初始化决定，仅在当前场景使用。 */
    const messages = agent.session.deriveMessages()
    /** 中文说明：测试局部值 toolResultBlock，由紧邻初始化决定，仅在当前场景使用。 */
    const toolResultBlock = messages
      .flatMap(m => m.content)
      .find(b => b.type === 'tool-result')
    expect(toolResultBlock?.type).toBe('tool-result')
    if (toolResultBlock?.type === 'tool-result') {
      expect(toolResultBlock.toolCallId).toBe(CallId('c1'))
    }
  })
})

describe('disposal and cancellation during pre-step assembly', () => {
  it('disposal during system-prompt assembly closes a no-step turn', { timeout: 30000 }, async () => {
    // Start disposal, then release assembly. Do not await disposal first: it
    // waits for the blocked driver to exit.
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter(['hang'])
    /** 中文说明：测试局部值 releaseAssemble，由紧邻初始化决定，仅在当前场景使用。 */
    let releaseAssemble!: () => void
    /** 中文说明：测试局部值 blocked，由紧邻初始化决定，仅在当前场景使用。 */
    const blocked = new Promise<void>(r => void (releaseAssemble = r))

    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(SessionStore)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(AgentLoop, { agents: [] })
    await mountInvariants(ctx)
    ctx.llm.registerAdapter(['mock'], adapter)

    // Parent-owned listener survives agent-fiber disposal.
    /** 中文说明：测试局部值 unlisten，由紧邻初始化决定，仅在当前场景使用。 */
    const unlisten = ctx.on('system-prompt/assemble', async function (_assembly, _context, next) {
      await blocked
      return next()
    })

    /** 中文说明：测试局部值 agent!: Agent，由紧邻初始化决定，仅在当前场景使用。 */
    let agent!: Agent
    /** 中文说明：测试局部值 fiber，由紧邻初始化决定，仅在当前场景使用。 */
    const fiber = await ctx.plugin(Object.assign((inner: Context) => {
      agent = inner.agentLoop.create(SessionId('a-dispose-assemble'), { provider: 'mock', model: 'mock' })
    }, { inject: ['agentLoop'] }))

    /** 中文说明：测试局部值 reasons，由紧邻初始化决定，仅在当前场景使用。 */
    const reasons: TurnEndReason[] = []
    ctx.on('session/event', (_s, event) => { if (event.type === 'turn/end') reasons.push(event.data.reason) })

    send(agent, 'go')
    // Give the loop time to reach pre-step assembly.
    await new Promise(r => setTimeout(r, 50))

    // Release assembly before awaiting disposal because disposal joins the blocked driver.
    /** 中文说明：测试局部值 disposalDone，由紧邻初始化决定，仅在当前场景使用。 */
    const disposalDone = fiber.dispose()

    releaseAssemble()
    await disposalDone
    await driverDone(agent)
    unlisten()

    /** 中文说明：测试局部值 e，由紧邻初始化决定，仅在当前场景使用。 */
    const e = [...agent.session.events]
    expect(e.filter(x => x.type === 'turn/start' || x.type === 'turn/end').map(x => x.type))
      .toEqual(['turn/start', 'turn/end'])
    expect(e.some(x => x.type === 'step/start')).toBe(false)
    expect(e.some(x => x.type === 'step/end')).toBe(false)
    expect(e.some(x => x.type === 'assistant/chunk')).toBe(false)
    expect(reasons).toEqual([{ kind: 'aborted', reason: { kind: 'disposed' } }])
  })

  it('cancel during system-prompt assembly closes a no-step turn', { timeout: 30000 }, async () => {
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter([textResponse('should not appear')])
    /** 中文说明：测试局部值 releaseAssemble，由紧邻初始化决定，仅在当前场景使用。 */
    let releaseAssemble!: () => void
    /** 中文说明：测试局部值 blocker，由紧邻初始化决定，仅在当前场景使用。 */
    const blocker = new Promise<void>(r => void (releaseAssemble = r))

    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(SessionStore)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(AgentLoop, { agents: [] })
    await mountInvariants(ctx)
    ctx.llm.registerAdapter(['mock'], adapter)

    /** 中文说明：测试局部值 unlisten，由紧邻初始化决定，仅在当前场景使用。 */
    const unlisten = ctx.on('system-prompt/assemble', async function (_assembly, _context, next) {
      await blocker
      return next()
    })

    /** 中文说明：测试局部值 agent!: Agent，由紧邻初始化决定，仅在当前场景使用。 */
    let agent!: Agent
    /** 中文说明：测试局部值 fiber，由紧邻初始化决定，仅在当前场景使用。 */
    const fiber = await ctx.plugin(Object.assign((inner: Context) => {
      agent = inner.agentLoop.create(SessionId('a-cancel-assemble'), { provider: 'mock', model: 'mock' })
    }, { inject: ['agentLoop'] }))

    /** 中文说明：测试局部值 reasons，由紧邻初始化决定，仅在当前场景使用。 */
    const reasons: TurnEndReason[] = []
    ctx.on('session/event', (_s, event) => { if (event.type === 'turn/end') reasons.push(event.data.reason) })

    send(agent, 'go')
    await new Promise(r => setTimeout(r, 50))
    agent.cancel({ kind: 'user' })

    releaseAssemble()
    await waitForIdle(ctx, agent)
    await fiber.dispose()
    await driverDone(agent)
    unlisten()

    /** 中文说明：测试局部值 e，由紧邻初始化决定，仅在当前场景使用。 */
    const e = [...agent.session.events]
    expect(e.filter(x => x.type === 'turn/start' || x.type === 'turn/end').map(x => x.type))
      .toEqual(['turn/start', 'turn/end'])
    expect(e.some(x => x.type === 'step/start')).toBe(false)
    expect(e.some(x => x.type === 'step/end')).toBe(false)
    expect(e.some(x => x.type === 'assistant/chunk')).toBe(false)
    expect(e.some(x => x.type === 'assistant/message')).toBe(false)
    expect(adapter.requests).toHaveLength(0)
    expect(reasons).toEqual([{ kind: 'aborted', reason: { kind: 'user' } }])
  })

  it('disposal during pre-step closes a no-step turn', { timeout: 15000 }, async () => {
    // Start disposal, then release pre-step; awaiting disposal first would deadlock on the blocked driver.
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter(['hang'])
    /** 中文说明：测试局部值 releasePreStep，由紧邻初始化决定，仅在当前场景使用。 */
    let releasePreStep!: () => void
    /** 中文说明：测试局部值 blocker，由紧邻初始化决定，仅在当前场景使用。 */
    const blocker = new Promise<void>(r => void (releasePreStep = r))

    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(SessionStore)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(AgentLoop, { agents: [] })
    await mountInvariants(ctx)
    ctx.llm.registerAdapter(['mock'], adapter)

    ctx.on('agent/pre-step', async (_payload, next) => {
      await blocker
      return next()
    })

    /** 中文说明：测试局部值 agent!: Agent，由紧邻初始化决定，仅在当前场景使用。 */
    let agent!: Agent
    /** 中文说明：测试局部值 fiber，由紧邻初始化决定，仅在当前场景使用。 */
    const fiber = await ctx.plugin(Object.assign((inner: Context) => {
      agent = inner.agentLoop.create(SessionId('a-dispose-prestep'), { provider: 'mock', model: 'mock' })
    }, { inject: ['agentLoop'] }))

    /** 中文说明：测试局部值 reasons，由紧邻初始化决定，仅在当前场景使用。 */
    const reasons: TurnEndReason[] = []
    ctx.on('session/event', (_s, event) => { if (event.type === 'turn/end') reasons.push(event.data.reason) })

    send(agent, 'go')
    await new Promise(r => setTimeout(r, 50))

    /** 中文说明：测试局部值 disposalDone，由紧邻初始化决定，仅在当前场景使用。 */
    const disposalDone = fiber.dispose()
    releasePreStep()
    await disposalDone
    await driverDone(agent)

    // The post-listener cancellation check catches disposal before any step or LLM call.
    /** 中文说明：测试局部值 e，由紧邻初始化决定，仅在当前场景使用。 */
    const e = [...agent.session.events]
    expect(e.filter(x => x.type === 'turn/start' || x.type === 'turn/end').map(x => x.type))
      .toEqual(['turn/start', 'turn/end'])
    expect(e.some(x => x.type === 'step/start')).toBe(false)
    expect(e.some(x => x.type === 'assistant/chunk')).toBe(false)
    expect(reasons).toEqual([{ kind: 'aborted', reason: { kind: 'disposed' } }])
  })

  it('cancel during pre-step closes a no-step turn', { timeout: 15000 }, async () => {
    // Release pre-step after cancellation to exercise the post-listener check.
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter(['hang'])
    /** 中文说明：测试局部值 releasePreStep，由紧邻初始化决定，仅在当前场景使用。 */
    let releasePreStep!: () => void
    /** 中文说明：测试局部值 blocker，由紧邻初始化决定，仅在当前场景使用。 */
    const blocker = new Promise<void>(r => void (releasePreStep = r))

    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(SessionStore)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(AgentLoop, { agents: [] })
    await mountInvariants(ctx)
    ctx.llm.registerAdapter(['mock'], adapter)

    ctx.on('agent/pre-step', async (_payload, next) => {
      await blocker
      return next()
    })

    /** 中文说明：测试局部值 agent!: Agent，由紧邻初始化决定，仅在当前场景使用。 */
    let agent!: Agent
    /** 中文说明：测试局部值 fiber，由紧邻初始化决定，仅在当前场景使用。 */
    const fiber = await ctx.plugin(Object.assign((inner: Context) => {
      agent = inner.agentLoop.create(SessionId('a-cancel-prestep'), { provider: 'mock', model: 'mock' })
    }, { inject: ['agentLoop'] }))

    /** 中文说明：测试局部值 reasons，由紧邻初始化决定，仅在当前场景使用。 */
    const reasons: TurnEndReason[] = []
    ctx.on('session/event', (_s, event) => { if (event.type === 'turn/end') reasons.push(event.data.reason) })

    send(agent, 'go')
    await new Promise(r => setTimeout(r, 30))
    agent.cancel({ kind: 'user' })

    releasePreStep()
    await waitForIdle(ctx, agent)
    await fiber.dispose()
    await driverDone(agent)

    /** 中文说明：测试局部值 e，由紧邻初始化决定，仅在当前场景使用。 */
    const e = [...agent.session.events]
    expect(e.filter(x => x.type === 'turn/start' || x.type === 'turn/end').map(x => x.type))
      .toEqual(['turn/start', 'turn/end'])
    expect(e.some(x => x.type === 'step/start')).toBe(false)
    expect(e.some(x => x.type === 'assistant/chunk')).toBe(false)
    expect(reasons).toEqual([{ kind: 'aborted', reason: { kind: 'user' } }])
  })

  it('disposal during assembly does not leak an LLM call or append assistant/chunk', { timeout: 15000 }, async () => {
    // The key assertion from the original bug report: after disposal, no
    // assistant/chunk or assistant/message appears — the turn ends disposed
    // before any model interaction.
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter([textResponse('should not appear')])
    /** 中文说明：测试局部值 releaseAssemble，由紧邻初始化决定，仅在当前场景使用。 */
    let releaseAssemble!: () => void
    /** 中文说明：测试局部值 blocker，由紧邻初始化决定，仅在当前场景使用。 */
    const blocker = new Promise<void>(r => void (releaseAssemble = r))

    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(SessionStore)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(AgentLoop, { agents: [] })
    await mountInvariants(ctx)
    ctx.llm.registerAdapter(['mock'], adapter)

    ctx.on('system-prompt/assemble', async function (_assembly, _context, next) {
      await blocker
      return next()
    })

    /** 中文说明：测试局部值 agent!: Agent，由紧邻初始化决定，仅在当前场景使用。 */
    let agent!: Agent
    /** 中文说明：测试局部值 fiber，由紧邻初始化决定，仅在当前场景使用。 */
    const fiber = await ctx.plugin(Object.assign((inner: Context) => {
      agent = inner.agentLoop.create(SessionId('a-dispose-no-leak'), { provider: 'mock', model: 'mock' })
    }, { inject: ['agentLoop'] }))

    send(agent, 'go')
    await new Promise(r => setTimeout(r, 50))

    /** 中文说明：测试局部值 disposalDone，由紧邻初始化决定，仅在当前场景使用。 */
    const disposalDone = fiber.dispose()
    releaseAssemble()
    await disposalDone
    await driverDone(agent)

    /** 中文说明：测试局部值 e，由紧邻初始化决定，仅在当前场景使用。 */
    const e = [...agent.session.events]
    expect(e.filter(x => x.type === 'turn/start' || x.type === 'turn/end').map(x => x.type))
      .toEqual(['turn/start', 'turn/end'])
    expect(e.find(x => x.type === 'turn/end')?.data.reason)
      .toEqual({ kind: 'aborted', reason: { kind: 'disposed' } })
    expect(e.some(x => x.type === 'assistant/chunk')).toBe(false)
    expect(e.some(x => x.type === 'assistant/message')).toBe(false)
    expect(adapter.requests).toHaveLength(0)
  })
})
