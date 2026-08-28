/**
 * 文件职责：验证Agent Loop的 agent-initiator.spec.ts 行为与不变量。
 * 技术维度：Vitest、Cordis、会话事件、模型适配器和可控工具夹具。
 * 产品维度：防止Agent Loop在取消、恢复、错误或并发场景中产生回归。
 * 逻辑维度：构造服务与事件，驱动执行流程，再断言日志、请求、状态和清理。
 * 关键边界：测试后台任务必须结束；模型可见输入必须可从日志重建；工具调用顺序不可破坏。
 * 新手阅读建议：先读 mock/辅助函数，再按成功、错误、恢复和生命周期场景阅读。
 */
import { describe, expect, it } from 'vitest'
import { Context, type Fiber } from '@deepseek-ai/cordis'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime, { createUserMessage, ToolCallId, LlmAdapter  } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import { MockAdapter, textResponse, toolCallResponse } from './mock-adapter.ts'

/** 中文说明：测试局部值 testToolSignal，由紧邻初始化决定，仅在当前场景使用。 */
const testToolSignal = new AbortController().signal

/** 中文说明：测试类型或类 Harness 约束夹具数据和行为。 */
interface Harness {
  ctx: Context
  agentsFiber: Fiber
  loopFiber: Fiber
}

/** 中文说明：测试辅助函数 harness 的参数见签名，返回值用于驱动或断言场景；示例见下方用例。 */
async function harness(adapter: LlmAdapter): Promise<Harness> {
  /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  /** 中文说明：测试局部值 agentsFiber，由紧邻初始化决定，仅在当前场景使用。 */
  const agentsFiber = await ctx.plugin(AgentRegistry)
  /** 中文说明：测试局部值 loopFiber，由紧邻初始化决定，仅在当前场景使用。 */
  const loopFiber = await ctx.plugin(AgentLoop, { agents: [] })
  ctx.llm.registerAdapter(['mock'], adapter)
  return { ctx, agentsFiber, loopFiber }
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
function send(agent: Agent, text: string): void {
  agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
}

/** Adapter that holds both drivers at the same awaited continuation. */
/* 中文说明：测试类型或类 OverlapAdapter 约束夹具数据和行为。 */
class OverlapAdapter extends LlmAdapter {
  private readonly bothStarted = Promise.withResolvers<boolean>()
  private starts = 0
  readonly observations: { sessionId: SessionId | undefined; before: Agent; after: Agent }[] = []

  constructor(private readonly ctx: Context) {
    super()
  }

  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    /** 中文说明：测试局部值 before，由紧邻初始化决定，仅在当前场景使用。 */
    const before = this.ctx.agents.requireInitiator()
    this.starts += 1
    if (this.starts === 2) this.bothStarted.resolve(true)
    await this.bothStarted.promise
    await Promise.resolve()
    /** 中文说明：测试局部值 after，由紧邻初始化决定，仅在当前场景使用。 */
    const after = this.ctx.agents.requireInitiator()
    this.observations.push({ sessionId: options.sessionId, before, after })
    yield* textResponse('done')
  }
}

/** Test-only transport that materializes ambient identity at its request boundary. */
/* 中文说明：测试类型或类 TestCapabilityTransport 约束夹具数据和行为。 */
class TestCapabilityTransport {
  readonly requests: { path: string; headers: Record<string, string> }[] = []

  constructor(private readonly agents: AgentRegistry) {}

  async request(path: string): Promise<Record<string, string>> {
    await Promise.resolve()
    /** 中文说明：测试局部值 headers，由紧邻初始化决定，仅在当前场景使用。 */
    const headers = {
      'X-Harness-Session-Id': this.agents.requireInitiator().session.id,
    }
    this.requests.push({ path, headers })
    return headers
  }
}

/** Adapter whose first call waits for cancellation and whose later calls complete. */
/* 中文说明：测试类型或类 ReloadAdapter 约束夹具数据和行为。 */
class ReloadAdapter extends LlmAdapter {
  readonly firstStarted = Promise.withResolvers<boolean>()
  firstAgentDuringAbort: Agent | undefined
  laterAgent: Agent | undefined
  calls = 0
  agents: AgentRegistry | undefined

  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    /** 中文说明：测试局部值 agents，由紧邻初始化决定，仅在当前场景使用。 */
    const agents = this.agents
    if (agents === undefined) throw new Error('agent service missing')
    this.calls += 1
    if (this.calls === 1) {
      this.firstStarted.resolve(true)
      try {
        await new Promise<void>((_resolve, reject) => {
          /** 中文说明：测试局部值 abort，由紧邻初始化决定，仅在当前场景使用。 */
          const abort = (): void => { reject(new Error('aborted')) }
          if (options.signal?.aborted === true) abort()
          else options.signal?.addEventListener('abort', abort, { once: true })
        })
      } catch (error: unknown) {
        await Promise.resolve()
        this.firstAgentDuringAbort = agents.requireInitiator()
        throw error
      }
      return
    }
    await Promise.resolve()
    this.laterAgent = agents.requireInitiator()
    yield* textResponse('reloaded')
  }
}

describe('AgentLoop initiator scope', () => {
  it('keeps overlapping driver continuations bound to their exact Agents', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = new Context()
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new OverlapAdapter(ctx)
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(SessionStore)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(AgentLoop, { agents: [] })
    ctx.llm.registerAdapter(['mock'], adapter)

    /** 中文说明：测试局部值 a，由紧邻初始化决定，仅在当前场景使用。 */
    const a = ctx.agentLoop.create(SessionId('a'), { provider: 'mock', model: 'mock' })
    /** 中文说明：测试局部值 b，由紧邻初始化决定，仅在当前场景使用。 */
    const b = ctx.agentLoop.create(SessionId('b'), { provider: 'mock', model: 'mock' })
    /** 中文说明：测试局部值 idleA，由紧邻初始化决定，仅在当前场景使用。 */
    const idleA = waitForIdle(ctx, a)
    /** 中文说明：测试局部值 idleB，由紧邻初始化决定，仅在当前场景使用。 */
    const idleB = waitForIdle(ctx, b)
    send(a, 'a')
    send(b, 'b')
    await Promise.all([idleA, idleB])

    expect(adapter.observations).toHaveLength(2)
    expect(adapter.observations).toEqual(expect.arrayContaining([
      { sessionId: a.session.id, before: a, after: a },
      { sessionId: b.session.id, before: b, after: b },
    ]))
    expect(ctx.agents.currentInitiator()).toBeUndefined()
    await ctx.fiber.dispose()
  })

  it('keeps initiator identity minimal while one explicit signal spans each turn seam', async () => {
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter([
      toolCallResponse('observe-call', 'observe', {}),
      textResponse('first done'),
      textResponse('second done'),
    ])
    /** 中文说明：测试局部值 { ctx }，由紧邻初始化决定，仅在当前场景使用。 */
    const { ctx } = await harness(adapter)
    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = ctx.agentLoop.create(SessionId('signal-owner'), { provider: 'mock', model: 'mock' })
    /** 中文说明：测试局部值 signals，由紧邻初始化决定，仅在当前场景使用。 */
    let signals: AbortSignal[] = []
    /** 中文说明：测试局部值 preStepSignals，由紧邻初始化决定，仅在当前场景使用。 */
    let preStepSignals: AbortSignal[] = []
    /** 中文说明：测试局部值 capture，由紧邻初始化决定，仅在当前场景使用。 */
    const capture = (signal: AbortSignal | undefined): void => {
      if (signal === undefined) throw new Error('turn seam omitted its explicit signal')
      expect(ctx.agents.requireInitiator()).toBe(agent)
      signals.push(signal)
    }

    ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
      if (context.agent === agent) capture(context.signal)
      return next()
    })
    ctx.on('agent/pre-step', async ({ agent: subject, signal }, next) => {
      if (subject === agent) {
        expect(ctx.agents.requireInitiator()).toBe(agent)
        preStepSignals.push(signal)
      }
      return next()
    })
    ctx.on('agent/request', async ({ agent: subject, signal }, next) => {
      if (subject === agent) capture(signal)
      return next()
    })
    ctx.on('agent/turn-stopping', ({ agent: subject, signal }) => {
      if (subject === agent) capture(signal)
    })
    ctx.tools.register(defineContentToolFixture({
      name: 'observe',
      description: 'observe explicit turn state',
      parameters: {},
      execute: async (_args, exec) => {
        capture(exec.signal)
        return [{ type: 'text', text: 'observed' }]
      },
    }))

    /** 中文说明：测试局部值 firstIdle，由紧邻初始化决定，仅在当前场景使用。 */
    const firstIdle = waitForIdle(ctx, agent)
    send(agent, 'first')
    await firstIdle
    /** 中文说明：测试局部值 firstSignal，由紧邻初始化决定，仅在当前场景使用。 */
    const firstSignal = signals[0]
    expect(firstSignal).toBeDefined()
    expect(new Set([...signals, ...adapter.requests.slice(0, 2).map(request => request.signal!)])).toEqual(new Set([firstSignal]))
    expect(preStepSignals).toHaveLength(2)
    expect(new Set(preStepSignals)).toEqual(new Set([firstSignal]))

    signals = []
    preStepSignals = []
    /** 中文说明：测试局部值 secondIdle，由紧邻初始化决定，仅在当前场景使用。 */
    const secondIdle = waitForIdle(ctx, agent)
    send(agent, 'second')
    await secondIdle
    /** 中文说明：测试局部值 secondSignal，由紧邻初始化决定，仅在当前场景使用。 */
    const secondSignal = signals[0]
    expect(secondSignal).toBeDefined()
    expect(new Set([...signals, adapter.requests[2]!.signal!])).toEqual(new Set([secondSignal]))
    expect(preStepSignals).toHaveLength(1)
    expect(preStepSignals[0]).toBe(secondSignal)
    expect(secondSignal).not.toBe(firstSignal)
    expect(ctx.agents.currentInitiator()).toBeUndefined()
    await ctx.fiber.dispose()
  })

  it('keeps child setup under the parent boundary and restores the parent while the child driver remains active', async () => {
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter([
      toolCallResponse('spawn', 'spawn-child', {}),
      toolCallResponse('observe', 'observe-child', {}),
      textResponse('child done'),
      textResponse('parent done'),
    ])
    /** 中文说明：测试局部值 { ctx }，由紧邻初始化决定，仅在当前场景使用。 */
    const { ctx } = await harness(adapter)
    /** 中文说明：测试局部值 解构结果，由紧邻初始化决定，仅在当前场景使用。 */
    let parentDuringSetup: Agent | undefined
    /** 中文说明：测试局部值 解构结果，由紧邻初始化决定，仅在当前场景使用。 */
    let explicitChild: Agent | undefined
    /** 中文说明：测试局部值 解构结果，由紧邻初始化决定，仅在当前场景使用。 */
    let childDuringDriver: Agent | undefined
    /** 中文说明：测试局部值 解构结果，由紧邻初始化决定，仅在当前场景使用。 */
    let parentWhileChildDriverActive: Agent | undefined
    /** 中文说明：测试局部值 child: Agent | undefined，由紧邻初始化决定，仅在当前场景使用。 */
    let child: Agent | undefined

    ctx.tools.register(defineContentToolFixture({
      name: 'spawn-child',
      description: 'create one child agent',
      parameters: {},
      execute: async (_args, exec) => {
        if (exec.agent === undefined) throw new Error('parent agent missing')
        /** 中文说明：测试局部值 handle，由紧邻初始化决定，仅在当前场景使用。 */
        const handle = await exec.agent.ctx.agents.create({
          sessionId: SessionId('child-session'),
          agentOptions: { provider: 'mock', model: 'mock' },
          setup: (agentCtx) => {
            parentDuringSetup = ctx.agents.requireInitiator()
            explicitChild = agentCtx.agent
            agentCtx.tools.register(defineContentToolFixture({
              name: 'observe-child',
              description: 'observe child execution identity',
              parameters: {},
              execute: async () => {
                await Promise.resolve()
                childDuringDriver = ctx.agents.requireInitiator()
                return [{ type: 'text', text: 'observed' }]
              },
            }))
          },
        })
        child = handle.agent
        parentWhileChildDriverActive = ctx.agents.requireInitiator()
        send(handle.agent, 'run child')
        await handle.agent.whenIdle()
        await handle.dispose()
        return [{ type: 'text', text: 'child completed' }]
      },
    }))

    /** 中文说明：测试局部值 parentHandle，由紧邻初始化决定，仅在当前场景使用。 */
    const parentHandle = await ctx.agents.create({
      sessionId: SessionId('parent-session'),
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    /** 中文说明：测试局部值 idle，由紧邻初始化决定，仅在当前场景使用。 */
    const idle = waitForIdle(ctx, parentHandle.agent)
    send(parentHandle.agent, 'spawn')
    await idle

    expect(parentDuringSetup).toBe(parentHandle.agent)
    expect(explicitChild).toBe(child)
    expect(childDuringDriver).toBe(child)
    expect(parentWhileChildDriverActive).toBe(parentHandle.agent)
    expect(ctx.agents.currentInitiator()).toBeUndefined()
    await parentHandle.dispose()
    await ctx.fiber.dispose()
  })

  it('keeps agentless direct tools ambient-free and builds trusted transport headers internally', async () => {
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter([
      toolCallResponse('capability', 'capability-request', { path: '/v1/capability' }),
      textResponse('done'),
    ])
    /** 中文说明：测试局部值 { ctx }，由紧邻初始化决定，仅在当前场景使用。 */
    const { ctx } = await harness(adapter)
    /** 中文说明：测试局部值 transport，由紧邻初始化决定，仅在当前场景使用。 */
    const transport = new TestCapabilityTransport(ctx.agents)
    /** 中文说明：测试局部值 解构结果，由紧邻初始化决定，仅在当前场景使用。 */
    let directAmbient: Agent | undefined
    /** 中文说明：测试局部值 解构结果，由紧邻初始化决定，仅在当前场景使用。 */
    let captured: Agent | undefined

    ctx.tools.register(defineContentToolFixture({
      name: 'agentless-probe',
      description: 'observe an agentless call',
      parameters: {},
      execute: async () => {
        await Promise.resolve()
        directAmbient = ctx.agents.currentInitiator()
        return [{ type: 'text', text: 'ok' }]
      },
    }))
    ctx.tools.register(defineContentToolFixture({
      name: 'capability-request',
      description: 'call the test capability transport',
      parameters: { path: { type: 'string' } },
      execute: async (args) => {
        captured = ctx.agents.requireInitiator()
        /** 中文说明：测试局部值 path，由紧邻初始化决定，仅在当前场景使用。 */
        const path = (args as { path: string }).path
        /** 中文说明：测试局部值 headers，由紧邻初始化决定，仅在当前场景使用。 */
        const headers = await transport.request(path)
        return [{ type: 'text', text: JSON.stringify(headers) }]
      },
    }))

    /** 中文说明：测试局部值 direct，由紧邻初始化决定，仅在当前场景使用。 */
    const direct = await ctx.tools.execute({
      signal: testToolSignal,
      callId: ToolCallId('direct'),
      name: 'agentless-probe',
      arguments: {},
    })
    expect(direct.isError).toBe(false)
    expect(directAmbient).toBeUndefined()

    /** 中文说明：测试局部值 handle，由紧邻初始化决定，仅在当前场景使用。 */
    const handle = await ctx.agents.create({
      sessionId: SessionId('transport-session'),
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    /** 中文说明：测试局部值 idle，由紧邻初始化决定，仅在当前场景使用。 */
    const idle = waitForIdle(ctx, handle.agent)
    send(handle.agent, 'call transport')
    await idle

    expect(transport.requests).toEqual([{
      path: '/v1/capability',
      headers: { 'X-Harness-Session-Id': 'transport-session' },
    }])
    /** 中文说明：测试局部值 schema，由紧邻初始化决定，仅在当前场景使用。 */
    const schema = adapter.requests[0]?.tools?.find(tool => tool.name === 'capability-request')
    expect(JSON.stringify(schema?.parameters)).not.toMatch(/session|harness/i)
    /** 中文说明：测试局部值 call，由紧邻初始化决定，仅在当前场景使用。 */
    const call = handle.agent.session.events.find(event => event.type === 'tool/call')
    expect(call?.type === 'tool/call' ? call.data.arguments : undefined)
      .toBe(JSON.stringify({ path: '/v1/capability' }))
    expect(captured).toBe(handle.agent)

    await handle.dispose()
    expect(ctx.agents.currentInitiator()).toBeUndefined()
    await ctx.fiber.dispose()
  })

  it('drains the old driver before disabling ALS during agent-service restart', async () => {
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new ReloadAdapter()
    /** 中文说明：测试局部值 解构结果，由紧邻初始化决定，仅在当前场景使用。 */
    const { ctx, agentsFiber, loopFiber } = await harness(adapter)
    /** 中文说明：测试局部值 oldService，由紧邻初始化决定，仅在当前场景使用。 */
    const oldService = ctx.agents
    adapter.agents = oldService
    /** 中文说明：测试局部值 oldHandle，由紧邻初始化决定，仅在当前场景使用。 */
    const oldHandle = await ctx.agents.create({
      sessionId: SessionId('before-restart-session'),
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    /** 中文说明：测试局部值 oldAgent，由紧邻初始化决定，仅在当前场景使用。 */
    const oldAgent = oldHandle.agent
    send(oldAgent, 'block')
    await adapter.firstStarted.promise

    await agentsFiber.restart()
    await loopFiber.await()
    expect(adapter.firstAgentDuringAbort?.id).toBe(oldAgent.id)
    expect(adapter.firstAgentDuringAbort?.session).toBe(oldAgent.session)
    expect(() => oldService.currentInitiator()).toThrow('agent initiator scope is disposed')
    expect(ctx.agents).not.toBe(oldService)
    adapter.agents = ctx.agents

    /** 中文说明：测试局部值 newHandle，由紧邻初始化决定，仅在当前场景使用。 */
    const newHandle = await ctx.agents.create({
      sessionId: SessionId('after-restart-session'),
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    /** 中文说明：测试局部值 newAgent，由紧邻初始化决定，仅在当前场景使用。 */
    const newAgent = newHandle.agent
    /** 中文说明：测试局部值 idle，由紧邻初始化决定，仅在当前场景使用。 */
    const idle = waitForIdle(ctx, newAgent)
    send(newAgent, 'continue')
    await idle
    expect(adapter.laterAgent?.id).toBe(newAgent.id)
    expect(adapter.laterAgent?.session).toBe(newAgent.session)
    await ctx.fiber.dispose()
  })

  it('keeps ALS readable while root disposal drains sibling AgentLoop fibers', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = new Context()
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new ReloadAdapter()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(SessionStore)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(AgentLoop, { agents: [] })
    ctx.llm.registerAdapter(['mock'], adapter)
    /** 中文说明：测试局部值 service，由紧邻初始化决定，仅在当前场景使用。 */
    const service = ctx.agents
    adapter.agents = service
    /** 中文说明：测试局部值 handle，由紧邻初始化决定，仅在当前场景使用。 */
    const handle = await ctx.agents.create({
      sessionId: SessionId('root-dispose-session'),
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = handle.agent
    send(agent, 'block')
    await adapter.firstStarted.promise

    await ctx.fiber.dispose()
    expect(adapter.firstAgentDuringAbort?.id).toBe(agent.id)
    expect(adapter.firstAgentDuringAbort?.session).toBe(agent.session)
    expect(() => service.currentInitiator()).toThrow('agent initiator scope is disposed')
  })
})
