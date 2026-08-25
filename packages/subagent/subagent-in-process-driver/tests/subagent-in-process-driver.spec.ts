/**
 * 文件职责：验证 subagent-in-process-driver.spec.ts 覆盖的子代理启动、协议、继承与生命周期行为。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、进程协议或同进程代理驱动。
 * 产品维度：保障 Agent 能可靠委派任务、继承上下文并收集子代理结果。
 * 逻辑维度：准备代理配置，启动或连接子代理，转发事件，再处理结果、取消与清理。
 * 关键边界：异步状态不等于单次任务结果；外部输出不可信；清理必须等待子代理完全停止。
 * 新手阅读建议：先看公开配置和测试夹具，再读启动/事件流程，最后关注继承、取消与失败路径。
 */
import { CallId, createUserMessage } from '@deepseek-ai/dsh-llm'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { type Agent, type AgentOptions } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as SessionInvariant from '@deepseek-ai/dsh-session/invariant'
import * as AgentInvariant from '@deepseek-ai/dsh-agent/invariant'
import * as AgentLoopInvariant from '@deepseek-ai/dsh-agent-loop/invariant'
import SubagentRuntime, { snapshotSubagentDescriptor } from '@deepseek-ai/dsh-subagent'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import { maxTokensResponse, MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { startInProcessRun } from '../src/index.ts'

/** 中文说明：type Script 定义本测试所需的数据或行为，用于表达子代理场景。 */
type Script = ConstructorParameters<typeof MockAdapter>[0]

/** 中文说明：函数 mountInvariants 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function mountInvariants(ctx: Context): Promise<void> {
  await ctx.plugin(InvariantRegistry)
  await ctx.plugin(SessionInvariant)
  await ctx.plugin(AgentInvariant)
  await ctx.plugin(AgentLoopInvariant)
}

/** 中文说明：函数 setup 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function setup(script: Script, parentOptions: Partial<AgentOptions> = {}) {
  /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await mountInvariants(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(SubagentRuntime)
  /** 中文说明：变量 adapter 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const adapter = new MockAdapter(script)
  ctx.llm.registerAdapter(['mock'], adapter)
  /** 中文说明：变量 parent 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const parent = ctx.agentLoop.create(SessionId('parent'), { provider: 'mock', model: 'mock', ...parentOptions })
  return { ctx, parent, adapter }
}

/** 中文说明：函数 request 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function request(parent: Agent, signal = new AbortController().signal) {
  return {
    label: 'child task',
    prompt: [{ type: 'text' as const, text: 'child task' }],
    parent,
    signal,
    descriptor: snapshotSubagentDescriptor({
      mode: 'one-shot',
      provider: 'test',
      label: 'child task',
    }),
  }
}

/** 中文说明：函数 text 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function text(blocks: readonly { type: string; text?: string }[]): string {
  return blocks.filter(block => block.type === 'text').map(block => block.text).join('')
}

describe('startInProcessRun', () => {
  it('returns only after publication, drives a fresh child, and disposes it', async () => {
    const { ctx, parent } = await setup([textResponse('driver answer')])
    /** 中文说明：变量 run 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const run = await startInProcessRun(request(parent), {})
    expect(ctx.agents.get(run.id)).toBeDefined()
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await run.result
    expect(result.stopReason).toBe('completed')
    expect(text(result.output)).toBe('driver answer')
    expect(ctx.agents.get(run.id)!.options.subagentDepth).toBe(1)
    await run.dispose()
    await run.dispose()
    expect(ctx.agents.get(run.id)).toBeUndefined()
  })

  it('uses explicit child model selectors when the parent has none and preserves its cwd', async () => {
    const { ctx } = await setup([textResponse('driver answer')])
    /** 中文说明：变量 parent 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const parent = ctx.agentLoop.create(SessionId('bare-parent'), {}, { cwd: '/workspace' })
    /** 中文说明：变量 run 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const run = await startInProcessRun({
      ...request(parent),
      agentOptions: { provider: 'mock', model: 'mock' },
    }, {})

    /** 中文说明：变量 child 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const child = ctx.agents.get(run.id)!
    expect(child.options).toMatchObject({ provider: 'mock', model: 'mock' })
    expect(child.session.header.cwd).toBe('/workspace')
    await expect(run.result).resolves.toMatchObject({ stopReason: 'completed' })
    await run.dispose()
  })

  it('reports a prompt a pre-step rejection discarded as refusal, not completion', async () => {
    const { ctx, parent } = await setup([])
    // A UserPromptSubmit deny or a policy plugin: the child claims its prompt,
    // the rejection discards it, and the turn closes `blocked` with no step.
    ctx.on('agent/pre-step', async ({ agent: subject }, next) => {
      if (subject === parent) return next()
      return { kind: 'reject' as const }
    })

    /** 中文说明：变量 run 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const run = await startInProcessRun(request(parent), {})
    await expect(run.result).resolves.toMatchObject({ stopReason: 'refusal' })
    await run.dispose()
  })

  it('does not add a final durability checkpoint to a foreground run', async () => {
    const { ctx, parent } = await setup([textResponse('driver answer')])
    /** 中文说明：变量 flushes 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let flushes = 0
    ctx.on('session/flush', (session) => {
      if (session.header.parentSession === undefined) return
      flushes++
      throw new Error('disk full')
    })

    /** 中文说明：变量 run 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const run = await startInProcessRun(request(parent), {})
    await expect(run.result).resolves.toMatchObject({ stopReason: 'completed' })
    expect(flushes).toBe(0)
    await run.dispose()
  })

  it('keeps published run and handle disposal failures on separate channels', async () => {
    const { ctx, parent } = await setup([])
    /** 中文说明：变量 runError 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const runError = new Error('published run failed')
    /** 中文说明：变量 disposalError 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const disposalError = new Error('published handle disposal failed')
    /** 中文说明：变量 beforeAgents 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const beforeAgents = ctx.agents.list().length
    /** 中文说明：变量 beforeSessions 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const beforeSessions = ctx.sessions.list().length
    /** 中文说明：变量 parentWithFailedDisposal 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const parentWithFailedDisposal = {
      options: parent.options,
      session: parent.session,
      ctx: {
        get: () => undefined,
        agents: {
          create: async (options: Parameters<typeof ctx.agents.create>[0]) => {
            /** 中文说明：变量 handle 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
            const handle = await ctx.agents.create(options)
            handle.agent.followup = () => { throw runError }
            return {
              ...handle,
              dispose: async () => {
                await handle.dispose()
                throw disposalError
              },
            }
          },
        },
      },
    } as unknown as Agent

    /** 中文说明：变量 run 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const run = await startInProcessRun(request(parentWithFailedDisposal), {})
    expect(ctx.agents.get(run.id)).toBeDefined()
    await expect(run.result).rejects.toBe(runError)
    await expect(run.dispose()).rejects.toBe(disposalError)
    expect(ctx.agents.list()).toHaveLength(beforeAgents)
    expect(ctx.sessions.list()).toHaveLength(beforeSessions)
  })
  it('reports the turn outcome when later metadata is appended during flush', async () => {
    const { ctx, parent } = await setup([maxTokensResponse('partial answer')])
    /** 中文说明：变量 injected 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let injected = false
    ctx.on('session/flush', (session) => {
      if (injected || session.header.parentSession === undefined) return
      /** 中文说明：函数值 lastEnd 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
      const lastEnd = session.events.findLast(event => event.type === 'turn/end')
      if (lastEnd?.type !== 'turn/end' || lastEnd.data.reason.kind !== 'max-tokens') return
      injected = true
      session.append('user/message', createUserMessage({
        content: [{ type: 'text', text: 'late metadata' }],
        source: { kind: 'plugin', plugin: 'late-metadata' },
      }), { surfaceOp: 'append' })
    })

    /** 中文说明：变量 run 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const run = await startInProcessRun(request(parent), {})
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await run.result
    /** 中文说明：变量 child 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const child = ctx.agents.get(run.id)!

    expect(injected).toBe(false)
    expect(child.session.events.findLast(event => event.type === 'turn/end'))
      .toMatchObject({ data: { reason: { kind: 'max-tokens' } } })
    expect(result.stopReason).toBe('max-tokens')
    await run.dispose()
  })

  it('keeps earlier streamed text when the final step appends an empty usage-only message', async () => {
    // A tool-only max-tokens step records an empty assistant/message for
    // usage. The result retains the preceding assistant output.
    const { ctx, parent } = await setup([
      toolCallResponse('t1', 'noop', {}, 'partial one'),
      [
        { type: 'block-start', index: 0, blockType: 'tool-call' },
        { type: 'tool-call-delta', index: 0, id: CallId('t2'), name: 'noop', argumentsDelta: '{}' },
        { type: 'block-end', index: 0, block: { type: 'tool-call', id: CallId('t2'), name: 'noop', arguments: '{}' } },
        { type: 'usage', usage: { inputTokens: 20, outputTokens: 5 } },
        { type: 'finish', reason: { kind: 'max-tokens' } },
      ],
    ])
    /** 中文说明：变量 disposeNoop 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const disposeNoop = ctx.tools.register(defineContentToolFixture({
      name: 'noop', description: 'probe', parameters: {},
      execute() { return Promise.resolve([{ type: 'text', text: 'noop result' }]) },
    }))
    /** 中文说明：变量 run 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const run = await startInProcessRun(request(parent), {})
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await run.result
    expect(result.stopReason).toBe('max-tokens')
    expect(text(result.output)).toBe('partial one')
    await run.dispose()
    disposeNoop()
  })

  it('seeds a forked child but reads only the child-owned output', async () => {
    const { ctx, parent } = await setup([textResponse('parent answer'), textResponse('child answer')])
    parent.followup(createUserMessage({ content: [{ type: 'text', text: 'parent question' }], source: { kind: 'user' } }))
    await parent.whenIdle()
    /** 中文说明：变量 seed 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const seed = parent.session.events.slice()
    /** 中文说明：变量 run 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const run = await startInProcessRun(request(parent), { seed })
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await run.result
    expect(text(result.output)).toBe('child answer')
    /** 中文说明：变量 child 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const child = ctx.agents.get(run.id)!
    expect(child.session.header.seedLength).toBe(seed.length)
    expect(child.session.events.slice(0, seed.length)).toEqual(seed)
    await run.dispose()
  })

  it('persists the child origin and depth in its session header', async () => {
    const { ctx, parent } = await setup([textResponse('child answer')])
    /** 中文说明：变量 run 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const run = await startInProcessRun(request(parent), {})
    await run.result
    // The recursion budget is durable session data, not only runtime options —
    // a depth that lived only in AgentOptions would reset to 0 on resume.
    expect(ctx.agents.get(run.id)!.session.header).toMatchObject({
      origin: 'subagent',
      delegationDepth: 1,
    })
    await run.dispose()
  })

  it('inherits the parent output-token cap and accepts an explicit child override', async () => {
    const { ctx, parent, adapter } = await setup(
      [textResponse('inherited'), textResponse('overridden')],
      { maxTokens: 111 },
    )
    /** 中文说明：变量 inherited 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const inherited = await startInProcessRun(request(parent), {})
    await inherited.result
    expect(adapter.requests[0]?.maxTokens).toBe(111)
    expect(ctx.agents.get(inherited.id)?.options.maxTokens).toBe(111)
    await inherited.dispose()

    /** 中文说明：变量 overridden 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const overridden = await startInProcessRun({
      ...request(parent),
      agentOptions: { maxTokens: 222 },
    }, {})
    await overridden.result
    expect(adapter.requests[1]?.maxTokens).toBe(222)
    expect(ctx.agents.get(overridden.id)?.options.maxTokens).toBe(222)
    await overridden.dispose()
  })

  it('counts a RESUMED child by its persisted header depth, not the absent runtime depth', async () => {
    // Resume rebuilds runtime options, so the durable header must keep this
    // depth-1 child from delegating as though it were top-level.
    const { ctx } = await setup([textResponse('unused')])
    /** 中文说明：变量 resumed 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const resumed = (await ctx.agents.create({
      sessionId: SessionId('resumed-child'),
      meta: { parentSession: SessionId('root'), delegationDepth: 1 },
      agentOptions: { provider: 'mock', model: 'mock' },
      signal: new AbortController().signal,
    })).agent
    await expect(startInProcessRun({ ...request(resumed), maxDepth: 1 }, {}))
      .rejects.toMatchObject({ name: 'SubagentDepthError', attemptedDepth: 2, maxDepth: 1 })
  })

  it('lets runtime options deepen but never lower the persisted depth', async () => {
    const { ctx } = await setup([textResponse('unused')])
    /** 中文说明：变量 parent 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const parent = (await ctx.agents.create({
      sessionId: SessionId('deep-parent'),
      meta: { delegationDepth: 2 },
      agentOptions: { provider: 'mock', model: 'mock', subagentDepth: 1 },
      signal: new AbortController().signal,
    })).agent
    // Persisted 2 vs runtime 1: the child is depth 3, so maxDepth 2 rejects.
    await expect(startInProcessRun({ ...request(parent), maxDepth: 2 }, {}))
      .rejects.toMatchObject({ name: 'SubagentDepthError', attemptedDepth: 3, maxDepth: 2 })
  })

  it('rejects invalid and exceeded depth before publication', async () => {
    const { parent } = await setup([])
    await expect(startInProcessRun({ ...request(parent), maxDepth: -1 }, {}))
      .rejects.toThrow('non-negative safe integer')
    await expect(startInProcessRun({ ...request(parent), maxDepth: 0 }, {}))
      .rejects.toMatchObject({ name: 'SubagentDepthError' })
    /** 中文说明：该循环依次处理代理事件；循环变量仅在当前循环中有效。 */
    for (const value of [Number.NaN, 1.5, -1, -0, Number.MAX_SAFE_INTEGER + 1]) {
      /** 中文说明：变量 malformed 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const malformed = { options: { subagentDepth: value }, session: { header: {} } } as unknown as Agent
      await expect(startInProcessRun(request(malformed), {}))
        .rejects.toThrow('agent subagentDepth must be a non-negative safe integer')
    }
    /** 中文说明：变量 maxParent 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const maxParent = { options: { subagentDepth: Number.MAX_SAFE_INTEGER }, session: { header: {} } } as unknown as Agent
    await expect(startInProcessRun(request(maxParent), {})).rejects.toBeInstanceOf(RangeError)
  })

  it('rejects an already-aborted request without publishing a child', async () => {
    const { ctx, parent } = await setup([])
    /** 中文说明：变量 beforeAgents 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const beforeAgents = ctx.agents.list().length
    /** 中文说明：变量 beforeSessions 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const beforeSessions = ctx.sessions.list().length
    /** 中文说明：变量 controller 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const controller = new AbortController()
    controller.abort('too late')
    await expect(startInProcessRun(request(parent, controller.signal), {}))
      .rejects.toThrow('aborted before child publication')
    expect(ctx.agents.list()).toHaveLength(beforeAgents)
    expect(ctx.sessions.list()).toHaveLength(beforeSessions)
  })

  it('stamps only the resolved depth when neither parent nor request declares a model route', async () => {
    // The one-shot analogue of the deleted resume coverage ("resumes without
    // inventing undeclared agent model options"): a bare parent with no request
    // agentOptions yields a child whose options carry ONLY the stamped depth —
    // no provider/model is fabricated, so the child's turn errors for want of a
    // route rather than silently adopting one.
    const { ctx } = await setup([])
    /** 中文说明：变量 parent 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const parent = ctx.agentLoop.create(SessionId('routeless-parent'), {})
    /** 中文说明：变量 run 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const run = await startInProcessRun(request(parent), {})
    /** 中文说明：变量 child 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const child = ctx.agents.get(run.id)!
    expect(child.options).toEqual({ subagentDepth: 1 })
    await expect(run.result).resolves.toMatchObject({ stopReason: 'error' })
    await run.dispose()
  })

  it('uses the request signal after publication and dispose as cancellation paths', async () => {
    const { parent, adapter } = await setup(['hang', 'hang'])
    /** 中文说明：变量 controller 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const controller = new AbortController()
    /** 中文说明：变量 signalled 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const signalled = await startInProcessRun(request(parent, controller.signal), {})
    await new Promise(resolve => setTimeout(resolve, 30))
    controller.abort('stop child')
    // No step completed a message, so the text streamed before the abort is
    // the cancelled run's output.
    await expect(signalled.result).resolves.toEqual({
      output: [{ type: 'text', text: 'partial' }],
      stopReason: 'aborted',
    })
    expect(adapter.requests[0]?.signal?.reason).toEqual({ kind: 'parent' })
    /** 中文说明：变量 child 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const child = parent.ctx.agents.get(signalled.id)
    /** 中文说明：函数值 turnEnd 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const turnEnd = child?.session.events.findLast(event => event.type === 'turn/end')
    expect(turnEnd?.type === 'turn/end' && turnEnd.data.reason).toEqual({ kind: 'aborted', reason: { kind: 'parent' } })
    await signalled.dispose()

    /** 中文说明：变量 disposed 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const disposed = await startInProcessRun(request(parent), {})
    await new Promise(resolve => setTimeout(resolve, 30))
    await disposed.dispose()
    await expect(disposed.result).resolves.toMatchObject({ stopReason: 'aborted' })
  })

  it('cleans a failed unpublished setup before rejecting', async () => {
    const { ctx, parent } = await setup([])
    /** 中文说明：变量 beforeAgents 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const beforeAgents = ctx.agents.list().length
    /** 中文说明：变量 beforeSessions 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const beforeSessions = ctx.sessions.list().length
    await expect(startInProcessRun({
      ...request(parent),
      toolFilter: { deny: ['unknown-tool'] },
    }, {})).rejects.toThrow('unknown global tool')
    expect(ctx.agents.list()).toHaveLength(beforeAgents)
    expect(ctx.sessions.list()).toHaveLength(beforeSessions)
  })

  it('treats abort after factory publication as a cancelled run with an id', async () => {
    const { ctx, parent } = await setup([])
    /** 中文说明：变量 controller 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const controller = new AbortController()
    /** 中文说明：变量 beforeAgents 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const beforeAgents = ctx.agents.list().length
    /** 中文说明：变量 beforeSessions 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const beforeSessions = ctx.sessions.list().length
    /** 中文说明：变量 parentWithAbortAtHandoff 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const parentWithAbortAtHandoff = {
      options: parent.options,
      session: parent.session,
      ctx: {
        // The driver's synchronous inheritance capture probes both policy
        // services opportunistically; this stub composes neither.
        get: () => undefined,
        agents: {
          create: async (options: Parameters<typeof ctx.agents.create>[0]) => {
            /** 中文说明：变量 handle 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
            const handle = await ctx.agents.create(options)
            // `create()` has detached its creation-only listener, but the
            // published run has not installed its live listener yet.
            controller.abort('handoff race')
            return handle
          },
        },
      },
    } as unknown as Agent
    /** 中文说明：变量 run 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const run = await startInProcessRun(request(parentWithAbortAtHandoff, controller.signal), {})
    expect(ctx.agents.get(run.id)).toBeDefined()
    await expect(run.result).resolves.toEqual({ output: [], stopReason: 'aborted' })
    await run.dispose()
    expect(ctx.agents.list()).toHaveLength(beforeAgents)
    expect(ctx.sessions.list()).toHaveLength(beforeSessions)
  })
})
