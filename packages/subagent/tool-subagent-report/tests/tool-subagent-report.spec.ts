/**
 * 文件职责：验证 tool-subagent-report.spec.ts 覆盖的子代理工具行为与生命周期。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、进程流、终端会话或快照规范化。
 * 产品维度：保障 Agent 的子代理工具能力稳定、可复现且可诊断。
 * 逻辑维度：准备输入和资源，执行核心流程，收集事件或输出，再处理错误与清理。
 * 关键边界：进程退出与取消可能竞态；外部输出不可信；清理必须等待子资源完全停止。
 * 新手阅读建议：先看类型和夹具，再读启动/收集主流程，最后关注平台差异、规范化和清理。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { assembleContextFor } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { CallId, LlmAdapter, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import * as SubagentSpawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import * as control from '@deepseek-ai/dsh-tool-subagent-control'
import { textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import * as tool from '../src/index.ts'

/** 中文说明：变量 testSignal 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const testSignal = new AbortController().signal

/** Adapter that keeps selected Agent requests open until released. */
/** 中文说明：class HeldAdapter 定义本测试所需的数据或行为，用于表达子代理工具场景。 */
class HeldAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []
  private readonly gates = new Map<GenerateOptions['sessionId'], PromiseWithResolvers<undefined>>()
  private readonly releasedSessions = new Set<GenerateOptions['sessionId']>()
  private released = false

  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    if (!this.released && !this.releasedSessions.has(options.sessionId)) {
      /** 中文说明：变量 gate 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      let gate = this.gates.get(options.sessionId)
      if (gate === undefined) {
        gate = Promise.withResolvers<undefined>()
        this.gates.set(options.sessionId, gate)
      }
      await gate.promise
    }
    /** 中文说明：该循环依次处理事件或输出；循环变量仅在当前循环中有效。 */
    for (const chunk of textResponse('held answer')) {
      if (options.signal?.aborted) throw new Error('aborted')
      yield chunk
    }
  }

  release(sessionId?: SessionId): void {
    if (sessionId !== undefined) {
      this.releasedSessions.add(sessionId)
      this.gates.get(sessionId)?.resolve(undefined)
      this.gates.delete(sessionId)
      return
    }
    this.released = true
    /** 中文说明：该循环依次处理事件或输出；循环变量仅在当前循环中有效。 */
    for (const gate of this.gates.values()) gate.resolve(undefined)
    this.gates.clear()
  }
}

/** 中文说明：函数值 cleanups 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  /** 中文说明：该循环依次处理事件或输出；循环变量仅在当前循环中有效。 */
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

/** Boot the real continuation graph with optional report installation. */
/** 中文说明：函数 setup 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function setup(options: { load?: boolean; config?: tool.Config } = {}) {
  /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const root = mkdtempSync(join(tmpdir(), 'dsh-tool-subagent-report-'))
  await ctx.plugin(JsonlSessionPersistence, { root })
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(SubagentRuntime)
  await ctx.plugin(SubagentSpawn, { providerName: 'spawn' })
  /** 中文说明：变量 fiber 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const fiber = options.load === false
    ? undefined
    : await ctx.plugin(tool, options.config ?? { reportDelivery: 'quiet' })
  /** 中文说明：变量 adapter 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const adapter = new HeldAdapter()
  ctx.llm.registerAdapter(['mock'], adapter)
  /** 中文说明：变量 parent 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const parent = ctx.agentLoop.create(SessionId('parent'), { provider: 'mock', model: 'mock' })
  cleanups.push(async () => {
    adapter.release()
    await ctx.fiber.dispose()
    rmSync(root, { recursive: true, force: true })
  })
  return { ctx, parent, adapter, fiber }
}

/** Start and resolve one resident continuable child. */
/** 中文说明：函数 startChild 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function startChild(ctx: Context, parent: Agent, prompt = 'child task') {
  /** 中文说明：变量 started 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const started = await ctx.subagents.startContinuable({
    provider: 'spawn',
    label: prompt,
    request: {
      prompt: [{ type: 'text', text: prompt }],
      parent,
    },
    signal: testSignal,
  })
  /** 中文说明：函数值 child 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
  const child = await vi.waitFor(() => {
    /** 中文说明：变量 live 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const live = ctx.agents.get(started.childId)
    expect(live).toBeDefined()
    return live as Agent
  })
  return { started, child }
}

/** Start one parent request that remains open in the held adapter. */
/** 中文说明：函数 startHeldParentTurn 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function startHeldParentTurn(parent: Agent, adapter: HeldAdapter): Promise<void> {
  parent.followup(createUserMessage({
    content: [{ type: 'text', text: 'parent work' }],
    source: { kind: 'user' },
  }))
  await vi.waitFor(() => {
    expect(adapter.requests.some(request => request.sessionId === parent.id)).toBe(true)
  })
}

/** 中文说明：变量 calls 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
let calls = 0
/** 中文说明：函数 callReport 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function callReport(ctx: Context, child: Agent, output: string, signal = testSignal) {
  return ctx.tools.execute({
    signal,
    callId: CallId(`report-${++calls}`),
    name: 'report',
    arguments: { output },
    agent: child,
  })
}

/** Occupy the child-local report name to force installation rollback. */
/** 中文说明：函数 registerReportConflict 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function registerReportConflict(child: Agent): () => void {
  return child.ctx.tools.register({
    name: 'report',
    description: 'conflicting report fixture',
    parameters: { type: 'object', properties: {} },
    output: { schema: { type: 'object', properties: {} }, render: () => [] },
    execute: () => Promise.resolve({}),
  })
}

/** Reports already visible or still pending in one Agent. */
/** 中文说明：函数 reports 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function reports(agent: Agent): { id: string; text: string; sender: string }[] {
  /** 中文说明：函数值 visible 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
  const visible = agent.session.events.flatMap(event => event.type === 'user/message' ? [event.data] : [])
  return [...visible, ...agent.inbox.nextStep].flatMap((message) => {
    if (message.source.kind !== 'subagent-report') return []
    return [{
      id: message.id,
      text: message.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n'),
      sender: message.source.senderSessionId,
    }]
  })
}

/** 中文说明：函数 renderedText 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function renderedText(result: { content: { type: string; text?: string }[] }): string {
  return result.content.flatMap(block => block.type === 'text' ? [block.text ?? ''] : []).join('')
}

/** The prompt sections one agent's scope assembles, by name. */
/** 中文说明：函数 sectionNames 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function sectionNames(ctx: Context, agent: Agent): Promise<string[]> {
  /** 中文说明：变量 assembly 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const assembly = await ctx.systemPrompt.assemble(assembleContextFor(agent))
  return assembly.sections.map(section => section.name)
}

describe('dsh-tool-subagent-report', () => {
  it('registers report only in continuable child scopes', async () => {
    const { ctx, parent } = await setup()
    expect(ctx.tools.schemas().map(schema => schema.name)).not.toContain('report')
    expect(ctx.tools.schemas(parent).map(schema => schema.name)).not.toContain('report')

    const { child } = await startChild(ctx, parent)
    /** 中文说明：函数值 schemas 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const schemas = ctx.tools.schemas(child).filter(schema => schema.name === 'report')
    expect(schemas).toHaveLength(1)
    /** 中文说明：变量 properties 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const properties = (schemas[0]?.parameters as { properties: Record<string, unknown> }).properties
    expect(Object.keys(properties)).toEqual(['output'])
  })

  it('adds no implicit capability when the package is absent', async () => {
    const { ctx, parent } = await setup({ load: false })
    const { child } = await startChild(ctx, parent)
    expect(ctx.tools.schemas(child).map(schema => schema.name)).not.toContain('report')
    expect((await callReport(ctx, child, 'missing')).isError).toBe(true)
  })

  it('does not imply parent controls and survives a global-tool allow-list', async () => {
    const { ctx, parent } = await setup()
    expect(ctx.tools.schemas().map(schema => schema.name)).not.toContain('send_message')
    await ctx.plugin(control)
    expect(ctx.tools.schemas().map(schema => schema.name)).toContain('send_message')

    /** 中文说明：变量 started 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const started = await ctx.subagents.startContinuable({
      provider: 'spawn',
      label: 'restricted child',
      request: {
        prompt: [{ type: 'text', text: 'restricted child' }],
        parent,
        toolFilter: { allow: [] },
      },
      signal: testSignal,
    })
    /** 中文说明：函数值 child 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const child = await vi.waitFor(() => {
      /** 中文说明：变量 live 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const live = ctx.agents.get(started.childId)
      expect(live).toBeDefined()
      return live as Agent
    })
    /** 中文说明：函数值 names 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const names = ctx.tools.schemas(child).map(schema => schema.name)
    expect(names).toContain('report')
    expect(names).not.toContain('send_message')
  })

  it('delivers quiet reports with stable message and sender identities without waking', async () => {
    const { ctx, parent, adapter } = await setup()
    const { started, child } = await startChild(ctx, parent)
    /** 中文说明：函数值 parentRequests 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const parentRequests = adapter.requests.filter(request => request.sessionId === parent.id).length
    /** 中文说明：变量 enqueues 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const enqueues: string[] = []
    ctx.on('agent/inbox/inserted', ({ agent, message }) => {
      if (agent === parent) {
        enqueues.push(agent.inbox.nextTurn.some(queued => queued.id === message.id) ? 'queued' : 'steering')
      }
    })

    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await callReport(ctx, child, 'CHILD_FINDING')

    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('report unexpectedly failed')
    /** 中文说明：变量 messageId 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const messageId = (result.value as { messageId: string }).messageId
    expect(renderedText(result)).toContain(messageId)
    expect(reports(parent)).toEqual([{
      id: messageId,
      text: `Background subagent ${started.childId} reported:\nCHILD_FINDING`,
      sender: started.childId,
    }])
    expect(enqueues).toEqual(['steering'])
    expect(parent.status).toBe('idle')
    expect(adapter.requests.filter(request => request.sessionId === parent.id)).toHaveLength(parentRequests)
  })

  it('delivers next-step reports through waking steering', async () => {
    const { ctx, parent, adapter } = await setup({ config: { reportDelivery: 'next-step' } })
    const { child } = await startChild(ctx, parent)
    /** 中文说明：变量 enqueues 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const enqueues: string[] = []
    ctx.on('agent/inbox/inserted', ({ agent, message }) => {
      if (agent === parent) {
        enqueues.push(agent.inbox.nextTurn.some(queued => queued.id === message.id) ? 'queued' : 'steering')
      }
    })

    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await callReport(ctx, child, 'WAKE_UP')
    expect(result.isError).toBe(false)
    expect(enqueues).toEqual(['steering'])
    await vi.waitFor(() => {
      expect(adapter.requests.some(request => request.sessionId === parent.id)).toBe(true)
    })
  })

  it('batches repeated next-step reports in accepted order', async () => {
    const { ctx, parent, adapter } = await setup({ config: { reportDelivery: 'next-step' } })
    await startHeldParentTurn(parent, adapter)
    const { child } = await startChild(ctx, parent)

    expect((await callReport(ctx, child, 'FIRST')).isError).toBe(false)
    expect((await callReport(ctx, child, 'SECOND')).isError).toBe(false)
    expect(reports(parent).map(report => report.text.split('\n').at(-1))).toEqual(['FIRST', 'SECOND'])
    expect(parent.inbox.nextStep).toHaveLength(2)
  })

  it('keeps a report before the child settlement in one busy-parent batch', async () => {
    const { ctx, parent, adapter } = await setup({ config: { reportDelivery: 'next-step' } })
    await startHeldParentTurn(parent, adapter)
    const { started, child } = await startChild(ctx, parent)

    expect((await callReport(ctx, child, 'ORDERED_REPORT')).isError).toBe(false)
    adapter.release(started.childId)
    await vi.waitFor(() => { expect(ctx.agents.get(started.childId)).toBeUndefined() })

    expect(parent.inbox.nextStep.map(message => message.source.kind)).toEqual([
      'subagent-report',
      'subagent-settled',
    ])
    expect(parent.inbox.nextTurn).toHaveLength(0)
  })

  it('keeps an accepted report after the child settles', async () => {
    const { ctx, parent, adapter } = await setup()
    const { started, child } = await startChild(ctx, parent)
    expect((await callReport(ctx, child, 'DURABLE_SELECTION')).isError).toBe(false)

    adapter.release()
    await vi.waitFor(() => {
      expect(ctx.agents.get(started.childId) === undefined).toBe(true)
    }, { timeout: 5_000 })
    expect(reports(parent).map(report => report.text)).toEqual([
      `Background subagent ${started.childId} reported:\nDURABLE_SELECTION`,
    ])
  })

  it('routes nested reports exactly one edge upward', async () => {
    const { ctx, parent, adapter } = await setup()
    const { child } = await startChild(ctx, parent, 'outer task')
    const { started: grandchildStart, child: grandchild } = await startChild(ctx, child, 'inner task')

    expect((await callReport(ctx, grandchild, 'FROM_GRANDCHILD')).isError).toBe(false)
    expect(reports(parent)).toEqual([])
    // The intermediate parent's turn is open, so quiet context is pending in
    // its inbox until that turn reaches its next safe log boundary.
    expect(reports(child)).toHaveLength(1)
    adapter.release()
    await vi.waitFor(() => { expect(reports(child)).toHaveLength(1) })
    expect(reports(child)[0]?.sender).toBe(grandchildStart.childId)
    expect(reports(child)[0]?.text).toContain('FROM_GRANDCHILD')
  })

  it('accounts next-step reports delivered to a resident continuable parent', async () => {
    const { ctx, parent, adapter } = await setup({ config: { reportDelivery: 'next-step' } })
    const { child } = await startChild(ctx, parent, 'outer task')
    const { started: grandchildStart, child: grandchild } = await startChild(ctx, child, 'inner task')

    expect((await callReport(ctx, grandchild, 'WAKE_PARENT_CHILD')).isError).toBe(false)
    expect(ctx.agents.get(child.id)).toBe(child)

    adapter.release()
    await vi.waitFor(() => { expect(reports(child)).toHaveLength(1) })
    expect(reports(child)[0]?.sender).toBe(grandchildStart.childId)
    expect(reports(child)[0]?.text).toContain('WAKE_PARENT_CHILD')
  })

  it('normalizes a direct parent send rejection', async () => {
    const { ctx, parent } = await setup()
    const { child } = await startChild(ctx, parent)
    vi.spyOn(parent, 'inject').mockImplementationOnce(() => {
      throw new Error('parent closed during delivery')
    })

    await expect(ctx.subagents.reportFrom(child, [{ type: 'text', text: 'rejected' }], {
      delivery: 'quiet',
      signal: testSignal,
    })).rejects.toMatchObject({ code: 'PARENT_UNAVAILABLE' })
    expect(reports(parent)).toEqual([])
  })

  it('rejects roots, forged same-id senders, absent parents, cancellation, and drain', async () => {
    const { ctx, parent, adapter } = await setup()
    await expect(ctx.subagents.reportFrom(parent, [{ type: 'text', text: 'root' }], {
      delivery: 'quiet',
      signal: testSignal,
    })).rejects.toMatchObject({ code: 'UNAUTHORIZED' })

    /** 中文说明：变量 disposable 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const disposable = await ctx.agents.create({
      sessionId: SessionId('disposable-parent'),
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    const { child } = await startChild(ctx, disposable.agent)
    /** 中文说明：变量 forged 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const forged = { ...child } as Agent
    await expect(ctx.subagents.reportFrom(forged, [{ type: 'text', text: 'forged' }], {
      delivery: 'quiet',
      signal: testSignal,
    })).rejects.toMatchObject({ code: 'UNAUTHORIZED' })

    /** 中文说明：变量 aborted 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const aborted = new AbortController()
    aborted.abort()
    expect((await callReport(ctx, child, 'cancelled', aborted.signal)).isError).toBe(true)

    await disposable.dispose()
    expect((await callReport(ctx, child, 'orphaned')).isError).toBe(true)

    adapter.release()
    /** 中文说明：变量 draining 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const draining = ctx.subagents.drainContinuableDescendants([child])
    await expect(ctx.subagents.reportFrom(child, [{ type: 'text', text: 'draining' }], {
      delivery: 'quiet',
      signal: testSignal,
    })).rejects.toMatchObject({ code: 'DRAINING' })
    await draining
  })

  it('revokes resident installations and defers later grants to the next Activation', async () => {
    const { ctx, parent, fiber } = await setup()
    const { child } = await startChild(ctx, parent)
    expect(ctx.tools.schemas(child).map(schema => schema.name)).toContain('report')
    expect(await sectionNames(ctx, child)).toContain('tool:report')

    await fiber?.dispose()
    expect(ctx.tools.schemas(child).map(schema => schema.name)).not.toContain('report')
    expect(await sectionNames(ctx, child)).not.toContain('tool:report')
    expect((await callReport(ctx, child, 'revoked')).isError).toBe(true)

    /** 中文说明：变量 late 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const late = await ctx.plugin(tool, { reportDelivery: 'quiet' })
    expect(ctx.tools.schemas(child).map(schema => schema.name)).not.toContain('report')
    expect(await sectionNames(ctx, child)).not.toContain('tool:report')
    await late.dispose()
  })

  it('rolls back prompt guidance when tool registration fails', async () => {
    const { ctx, parent } = await setup({ load: false })
    const { child } = await startChild(ctx, parent)
    /** 中文说明：变量 disposeConflict 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const disposeConflict = registerReportConflict(child)

    expect(() => tool.installReportTool(child.ctx, ctx, 'quiet')).toThrow(/already registered in this scope/)
    expect(await sectionNames(ctx, child)).not.toContain('tool:report')
    disposeConflict()
  })

  it('aggregates a registration failure with a prompt rollback failure', async () => {
    const { ctx, parent } = await setup({ load: false })
    const { child } = await startChild(ctx, parent)
    /** 中文说明：变量 disposeConflict 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const disposeConflict = registerReportConflict(child)
    /** 中文说明：变量 rollbackFailure 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const rollbackFailure = new Error('prompt rollback listener failed')
    /** 中文说明：变量 promptChanges 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let promptChanges = 0
    /** 中文说明：函数值 off 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const off = ctx.on('system-prompt/change', () => {
      promptChanges++
      if (promptChanges === 2) throw rollbackFailure
    })

    /** 中文说明：变量 failure 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let failure: unknown
    try {
      tool.installReportTool(child.ctx, ctx, 'quiet')
    } catch (error: unknown) {
      failure = error
    }
    off()

    expect(failure).toBeInstanceOf(AggregateError)
    if (!(failure instanceof AggregateError)) throw new Error('expected aggregate installation failure')
    expect(failure.errors).toHaveLength(2)
    expect(String(failure.errors[0])).toContain('already registered in this scope')
    expect(failure.errors[1]).toBe(rollbackFailure)
    expect(await sectionNames(ctx, child)).not.toContain('tool:report')
    disposeConflict()
  })

  it('attempts both revocations and aggregates change-listener failures', async () => {
    const { ctx, parent } = await setup({ load: false })
    const { child } = await startChild(ctx, parent)
    /** 中文说明：变量 dispose 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const dispose = tool.installReportTool(child.ctx, ctx, 'quiet')
    /** 中文说明：变量 toolFailure 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const toolFailure = new Error('tool removal listener failed')
    /** 中文说明：变量 promptFailure 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const promptFailure = new Error('prompt removal listener failed')
    /** 中文说明：函数值 offTool 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const offTool = ctx.on('tools/change', () => { throw toolFailure })
    /** 中文说明：函数值 offPrompt 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const offPrompt = ctx.on('system-prompt/change', () => { throw promptFailure })

    /** 中文说明：变量 failure 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let failure: unknown
    try {
      dispose()
    } catch (error: unknown) {
      failure = error
    }
    offPrompt()
    offTool()

    expect(failure).toBeInstanceOf(AggregateError)
    if (!(failure instanceof AggregateError)) throw new Error('expected aggregate revocation failure')
    expect(failure.errors).toEqual([toolFailure, promptFailure])
    expect(ctx.tools.schemas(child).map(schema => schema.name)).not.toContain('report')
    expect(await sectionNames(ctx, child)).not.toContain('tool:report')
  })

  it('scopes the report guidance to the child that owns it', async () => {
    const { ctx, parent } = await setup()
    const { child } = await startChild(ctx, parent, 'first child')
    const { child: sibling } = await startChild(ctx, parent, 'second child')

    /** 中文说明：变量 assembly 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const assembly = await ctx.systemPrompt.assemble(assembleContextFor(child))
    /** 中文说明：函数值 guidance 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const guidance = assembly.sections.find(section => section.name === 'tool:report')
    // Pins the model-visible instruction that makes the return channel a
    // contract rather than an option the child may quietly skip.
    expect(guidance?.text).toContain('Deliver your result with the report tool before you finish')
    expect(guidance?.text).toContain('reporting never ends your turn')

    expect(await sectionNames(ctx, parent)).not.toContain('tool:report')
    // A sibling installs its own copy; neither child can observe the other's.
    expect(await sectionNames(ctx, sibling)).toContain('tool:report')
    expect((await ctx.systemPrompt.assemble()).sections.map(section => section.name))
      .not.toContain('tool:report')
  })

  it('rolls back materialization when a setup contribution revokes itself', async () => {
    const { ctx, parent } = await setup({ load: false })
    /** 中文说明：函数值 self 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const self: { revoke?: () => void } = {}
    self.revoke = ctx.subagents.registerContinuableSetup((childCtx) => {
      /** 中文说明：变量 dispose 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const dispose = childCtx.tools.register({
        name: 'racing-report',
        description: 'racing setup',
        parameters: { type: 'object', properties: {} },
        output: { schema: { type: 'object', properties: {} }, render: () => [] },
        execute: () => Promise.resolve({}),
      })
      self.revoke?.()
      return dispose
    })

    // No session may be announced for the rejected child: the setup
    // validation must reject inside the creation callback, before the factory
    // publishes — a post-publication rejection would persist a resumable
    // ghost that `list_agents` surfaces and `send_message` can resurrect.
    // The parent was created inside setup(), so any later announcement is the
    // rejected child's.
    /** 中文说明：变量 announced 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const announced: SessionId[] = []
    /** 中文说明：函数值 listener 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const listener = (session: { id: SessionId }): void => { announced.push(session.id) }
    /** 中文说明：变量 removeListener 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const removeListener = ctx.on('session/created', listener)
    await expect(ctx.subagents.startContinuable({
      provider: 'spawn',
      label: 'racing child',
      request: {
        prompt: [{ type: 'text', text: 'racing child' }],
        parent,
      },
      signal: testSignal,
    })).rejects.toMatchObject({ code: 'ACTIVATION_SETUP_REVOKED' })
    removeListener()
    expect(announced).toEqual([])
    expect(ctx.agents.list().map(agent => agent.id)).toEqual([parent.id])
  })

  it('rolls back materialization when setup revocation lands before publication', async () => {
    const { ctx, parent } = await setup({ load: false })
    /** 中文说明：函数值 self 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const self: { revoke?: () => void } = {}
    /** 中文说明：变量 installed 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let installed = false
    self.revoke = ctx.subagents.registerContinuableSetup(() => {
      installed = true
      queueMicrotask(() => { self.revoke?.() })
      return () => { installed = false }
    })
    /** 中文说明：变量 announced 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const announced: SessionId[] = []
    /** 中文说明：函数值 removeListener 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const removeListener = ctx.on('session/created', (session) => { announced.push(session.id) })

    await expect(ctx.subagents.startContinuable({
      provider: 'spawn',
      label: 'revoked child',
      request: {
        prompt: [{ type: 'text', text: 'revoked child' }],
        parent,
      },
      signal: testSignal,
    })).rejects.toMatchObject({ code: 'ACTIVATION_SETUP_REVOKED' })
    removeListener()
    expect(installed).toBe(false)
    expect(announced).toEqual([])
    expect(ctx.agents.list().map(agent => agent.id)).toEqual([parent.id])
    expect(ctx.sessions.list()).toEqual([parent.session])
  })

  it('accepts a report into a host-disposing but still-registered parent', async () => {
    const { ctx } = await setup()
    /** 中文说明：变量 parentHandle 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const parentHandle = await ctx.agents.create({
      sessionId: SessionId('disposing-parent'),
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    const { child } = await startChild(ctx, parentHandle.agent)
    // Host-owned disposal starts asynchronously; the parent stays registered
    // until quiescence, and registry presence — not disposal state — is the
    // acceptance gate (pins the README contract).
    /** 中文说明：变量 disposing 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const disposing = parentHandle.dispose()
    /** 中文说明：变量 accepted 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const accepted = await callReport(ctx, child, 'during-close')
    expect(accepted.isError).toBe(false)
    await disposing
    expect((await callReport(ctx, child, 'after-close')).isError).toBe(true)
  })

  it('keeps the namespace plugin shape and validates its default', () => {
    expect('default' in tool).toBe(false)
    expect(tool.name).toBe('tool-subagent-report')
    expect(tool.inject).toEqual(['subagents', 'tools', 'systemPrompt'])
    // Next-step delivery wakes a parked parent and lets a running parent act at
    // its nearest safe boundary.
    expect(tool.Config({}).reportDelivery).toBe('next-step')
    expect(() => tool.Config({ reportDelivery: 'wakeup' } as never)).toThrow()
    expect(() => tool.Config({ reportDelivery: 'shout' } as never)).toThrow()
  })

  it('wakes the parent under the default configuration', async () => {
    const { ctx, parent, adapter } = await setup({ config: {} })
    const { child } = await startChild(ctx, parent)
    /** 中文说明：变量 enqueues 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const enqueues: string[] = []
    ctx.on('agent/inbox/inserted', ({ agent, message }) => {
      if (agent === parent) {
        enqueues.push(agent.inbox.nextTurn.some(queued => queued.id === message.id) ? 'queued' : 'steering')
      }
    })

    expect((await callReport(ctx, child, 'DEFAULT_WAKES')).isError).toBe(false)
    expect(enqueues).toEqual(['steering'])
    await vi.waitFor(() => {
      expect(adapter.requests.some(request => request.sessionId === parent.id)).toBe(true)
    })
  })
})

/** Prove report delivery uses ordinary logged user messages (runtime-context snapshots excluded). */
/** 中文说明：函数 userTexts 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function userTexts(events: readonly SessionEvent[]): string[] {
  return events.flatMap(event => event.type === 'user/message' && event.data.source.kind !== 'plugin'
    ? event.data.content.flatMap(block => block.type === 'text' ? [block.text] : [])
    : [])
}

describe('dsh-tool-subagent-report result independence', () => {
  it('does not report a final assistant answer automatically or create Jobs', async () => {
    const { ctx, parent, adapter } = await setup()
    const { started } = await startChild(ctx, parent)
    adapter.release()
    await vi.waitFor(() => {
      expect(ctx.agents.get(started.childId) === undefined).toBe(true)
    }, { timeout: 5_000 })

    // The parent does learn the child settled — that account is the
    // continuation service's, carried under its own `subagent-settled` source.
    // Nothing turns the child's final answer into a report it did not send.
    expect(reports(parent)).toEqual([])
    expect(userTexts((await ctx.sessionPersistence.load(started.childId)).events)).toEqual(['child task'])
    expect(ctx.get('jobs')).toBeUndefined()
  })
})
