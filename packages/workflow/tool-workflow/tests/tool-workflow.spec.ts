/**
 * 文件职责：验证 tool-workflow.spec.ts 覆盖的工作流与 Worker Thread行为与生命周期。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、Worker Thread、消息协议或领域实体。
 * 产品维度：保障 Agent 的工作流与 Worker Thread能力稳定、可隔离且可诊断。
 * 逻辑维度：准备配置和消息，建立运行环境，执行流程，再处理事件、错误与清理。
 * 关键边界：线程消息不可信；跨线程状态必须显式传递；终止时必须等待所拥有资源停止。
 * 新手阅读建议：先看协议和类型，再读 Host/Runtime 主流程，最后关注隔离、失败与清理。
 */
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { TOOL_ABORTED_BEFORE_DISPATCH } from '@deepseek-ai/dsh-tools'
import type { ToolExecutionResult, ToolExecutionToken } from '@deepseek-ai/dsh-tools'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { WorkflowRunId, WorkflowEngine } from '@deepseek-ai/dsh-workflow'
import type {
  WorkflowAgentEndInfo, WorkflowAgentInfo, WorkflowResult, WorkflowRun,
  WorkflowRunId as WorkflowRunIdType, WorkflowStartRequest,
} from '@deepseek-ai/dsh-workflow'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import WorkerThreadWorkflowEngine from '@deepseek-ai/dsh-workflow-worker-thread'
import * as toolWorkflow from '../src/index.ts'
import { Session, SessionId } from '@deepseek-ai/dsh-session'

/** 中文说明：变量 testToolSignal 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const testToolSignal = new AbortController().signal

/** A controllable engine standing in behind ctx.workflowEngine (the tool's only seam). */
/* 中文说明：class StubEngine 定义本测试所需的数据或行为，用于表达工作流与 Worker Thread场景。 */
class StubEngine extends WorkflowEngine {
  requests: WorkflowStartRequest[] = []
  cancels: string[] = []
  disposed = 0
  disposeBarrier: Promise<void> | undefined
  settle!: (result: WorkflowResult) => void
  readonly settlements = new Map<WorkflowRunIdType, (result: WorkflowResult) => void>()
  startError: Error | undefined

  start(request: WorkflowStartRequest): WorkflowRun {
    if (this.startError) throw this.startError
    this.requests.push(request)
    /** 中文说明：变量 id 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const id = WorkflowRunId(`run-${this.requests.length}`)
    /** 中文说明：函数值 result 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const result = new Promise<WorkflowResult>((resolve) => { this.settle = resolve })
    this.settlements.set(id, this.settle)
    request.signal?.addEventListener('abort', () => {
      this.settle({ value: null, stopReason: 'cancelled', error: 'signal', agentsStarted: 0 })
    }, { once: true })
    return {
      id,
      meta: request.meta,
      result,
      cancel: (reason?: string) => {
        this.cancels.push(reason ?? 'cancelled')
        this.settle({ value: null, stopReason: 'cancelled', ...reason !== undefined ? { error: reason } : {}, agentsStarted: 0 })
      },
      dispose: async () => {
        this.disposed += 1
        await this.disposeBarrier
        this.settlements.delete(id)
      },
    }
  }

  settleRun(id: WorkflowRunIdType, result: WorkflowResult): void {
    /** 中文说明：变量 settle 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const settle = this.settlements.get(id)
    if (settle === undefined) throw new Error(`unknown stub workflow ${id}`)
    settle(result)
  }

  agentStart(id: WorkflowRunIdType, agent: WorkflowAgentInfo): void {
    this.emitWorkflowEvent('workflow/agent-start', {
      id,
      meta: this.requests[Number(String(id).slice(4)) - 1]!.meta,
    }, agent)
  }

  agentEnd(id: WorkflowRunIdType, agent: WorkflowAgentEndInfo): void {
    this.emitWorkflowEvent('workflow/agent-end', {
      id,
      meta: this.requests[Number(String(id).slice(4)) - 1]!.meta,
    }, agent)
  }
}

/** 中文说明：函数 setup 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function setup(config?: { toolName?: string; maxResultChars?: number }) {
  /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(StubEngine)
  await ctx.plugin(toolWorkflow, config ?? {})
  /** 中文说明：变量 engine 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const engine = ctx.workflowEngine as StubEngine
  /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const session = Session.create(SessionId('caller'))
  /** 中文说明：变量 parent 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const parent = { id: session.id, options: {}, session } as unknown as Agent
  return { ctx, engine, parent, session }
}

/** 中文说明：常量 SCRIPT 保存本测试共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const SCRIPT = 'return 1'
/** 中文说明：常量 META 保存本测试共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const META = { name: 'audit', description: 'd' }

/** 中文说明：函数 execute 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function execute(ctx: Context, args: unknown, extra?: {
  agent?: Agent
  signal?: AbortSignal
  parent?: ToolExecutionToken
}): Promise<ToolExecutionResult> {
  return ctx.tools.execute({
    signal: testToolSignal,
    callId: ToolCallId('call-1'),
    name: 'workflow',
    arguments: args,
    ...extra?.agent ? { agent: extra.agent } : {},
    ...extra?.signal ? { signal: extra.signal } : {},
    ...extra?.parent ? { parent: extra.parent } : {},
  })
}

describe('dsh-tool-workflow', () => {
  it('starts a run with the script/args/parent/signal and renders the completed value', async () => {
    const { ctx, engine, parent } = await setup()
    /** 中文说明：变量 controller 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const controller = new AbortController()
    /** 中文说明：变量 pending 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const pending = execute(ctx, { script: SCRIPT, meta: META, args: { files: ['a.ts'] } }, { agent: parent, signal: controller.signal })
    await vi.waitFor(() => { expect(engine.requests.length).toBe(1) })
    expect(engine.requests[0]).toMatchObject({ script: SCRIPT, meta: META, args: { files: ['a.ts'] }, parent })
    expect(engine.requests[0]!.signal).toBe(controller.signal)
    engine.settle({ value: { findings: [1, 2] }, stopReason: 'completed', agentsStarted: 7 })
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await pending
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected workflow success')
    expect(result.value).toEqual({ runId: 'run-1', agentsStarted: 7, result: { findings: [1, 2] } })
    /** 中文说明：变量 rendered 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const rendered = (result.content[0] as { text: string }).text
    expect(rendered).toContain('workflow "audit" completed (7 agents)')
    expect(rendered).toContain('"findings"')
    expect(engine.disposed).toBe(1)
  })

  it('records one top-level run and its members in the calling Session after cleanup', async () => {
    const { ctx, engine, parent, session } = await setup()
    /** 中文说明：变量 pending 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const pending = execute(ctx, { script: SCRIPT, meta: META }, { agent: parent })
    await vi.waitFor(() => { expect(engine.requests).toHaveLength(1) })
    /** 中文说明：变量 runId 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const runId = WorkflowRunId('run-1')
    engine.agentStart(runId, {
      seq: 1,
      label: '',
      phase: '',
      childId: SessionId('child-1'),
    })
    engine.agentEnd(runId, {
      seq: 1,
      label: '',
      phase: '',
      childId: SessionId('child-1'),
      outcome: 'completed',
    })
    engine.settleRun(runId, { value: 1, stopReason: 'completed', agentsStarted: 1 })
    expect((await pending).isError).toBe(false)
    expect(engine.disposed).toBe(1)
    expect(session.events.map(event => [event.type, event.data])).toEqual([
      ['tool-workflow/run-start', { runId: 'run-1', name: 'audit' }],
      ['tool-workflow/agent-start', {
        runId: 'run-1', seq: 1, label: '', phase: '', childId: 'child-1',
      }],
      ['tool-workflow/agent-end', { runId: 'run-1', seq: 1, outcome: 'completed' }],
      ['tool-workflow/run-end', { runId: 'run-1', stopReason: 'completed' }],
    ])
  })

  it('writes run-end only after run disposal reaches quiescence', async () => {
    const { ctx, engine, parent, session } = await setup()
    /** 中文说明：变量 barrier 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const barrier = Promise.withResolvers<undefined>()
    engine.disposeBarrier = barrier.promise
    /** 中文说明：变量 pending 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const pending = execute(ctx, { script: SCRIPT, meta: META }, { agent: parent })
    await vi.waitFor(() => { expect(engine.requests).toHaveLength(1) })
    engine.settleRun(WorkflowRunId('run-1'), {
      value: null, stopReason: 'completed', agentsStarted: 0,
    })
    await vi.waitFor(() => { expect(engine.disposed).toBe(1) })
    expect(session.events.map(event => event.type)).toEqual(['tool-workflow/run-start'])
    barrier.resolve(undefined)
    expect((await pending).isError).toBe(false)
    expect(session.events.map(event => event.type)).toEqual([
      'tool-workflow/run-start', 'tool-workflow/run-end',
    ])
  })

  it('records zero-member and concurrent runs independently', async () => {
    const { ctx, engine, parent, session } = await setup()
    /** 中文说明：变量 first 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const first = execute(ctx, { script: SCRIPT, meta: { ...META, name: 'first' } }, { agent: parent })
    /** 中文说明：变量 second 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const second = execute(ctx, { script: SCRIPT, meta: { ...META, name: 'second' } }, { agent: parent })
    await vi.waitFor(() => { expect(engine.requests).toHaveLength(2) })
    /** 中文说明：变量 secondId 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const secondId = WorkflowRunId('run-2')
    engine.agentStart(secondId, {
      seq: 1, label: 'member', childId: SessionId('child-2'),
    })
    engine.agentEnd(secondId, {
      seq: 1, label: 'member', childId: SessionId('child-2'), outcome: 'failed',
    })
    engine.settleRun(WorkflowRunId('run-1'), { value: null, stopReason: 'completed', agentsStarted: 0 })
    engine.settleRun(secondId, { value: null, stopReason: 'error', error: 'child failed', agentsStarted: 1 })
    expect((await first).isError).toBe(false)
    expect((await second).isError).toBe(true)
    expect(session.events.filter(event => event.type === 'tool-workflow/agent-start'))
      .toHaveLength(1)
    expect(session.events.filter(event => event.type === 'tool-workflow/run-end').map(event => event.data))
      .toEqual([
        { runId: 'run-1', stopReason: 'completed' },
        { runId: 'run-2', stopReason: 'error' },
      ])
  })

  it('does not record nested transport executions', async () => {
    const { ctx, engine, parent, session } = await setup()
    /** 中文说明：变量 pending 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const pending = execute(ctx, { script: SCRIPT, meta: META }, {
      agent: parent,
      parent: Symbol('outer') as ToolExecutionToken,
    })
    await vi.waitFor(() => { expect(engine.requests).toHaveLength(1) })
    engine.settleRun(WorkflowRunId('run-1'), { value: null, stopReason: 'completed', agentsStarted: 0 })
    expect((await pending).isError).toBe(false)
    expect(session.events).toEqual([])
  })

  it.each([
    'tool-workflow/run-start',
    'tool-workflow/agent-start',
    'tool-workflow/agent-end',
    'tool-workflow/run-end',
  ] as const)('isolates a first append failure at %s and preserves a valid prefix', async (failedType) => {
    const { ctx, engine, parent, session } = await setup()
    /** 中文说明：变量 warnings 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const warnings: string[] = []
    ctx.logger.warn = ((message: unknown) => { warnings.push(String(message)) }) as typeof ctx.logger.warn
    /** 中文说明：变量 append 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const append = session.append.bind(session)
    session.append = ((type: Parameters<Session['append']>[0], data: never) => {
      if (type === failedType) throw new Error(`injected ${failedType} failure`)
      return append(type, data)
    }) as Session['append']

    /** 中文说明：变量 pending 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const pending = execute(ctx, { script: SCRIPT, meta: META }, { agent: parent })
    await vi.waitFor(() => { expect(engine.requests).toHaveLength(1) })
    /** 中文说明：变量 runId 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const runId = WorkflowRunId('run-1')
    engine.agentStart(runId, {
      seq: 1, label: 'member', childId: SessionId('child-1'),
    })
    engine.agentEnd(runId, {
      seq: 1, label: 'member', childId: SessionId('child-1'), outcome: 'completed',
    })
    engine.settleRun(runId, { value: null, stopReason: 'completed', agentsStarted: 1 })
    expect((await pending).isError).toBe(false)
    expect(engine.disposed).toBe(1)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain(failedType)
    /** 中文说明：函数值 types 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const types = session.events.map(event => event.type)
    /** 中文说明：变量 expectedPrefixes 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const expectedPrefixes = {
      'tool-workflow/run-start': [],
      'tool-workflow/agent-start': ['tool-workflow/run-start'],
      'tool-workflow/agent-end': ['tool-workflow/run-start', 'tool-workflow/agent-start'],
      'tool-workflow/run-end': [
        'tool-workflow/run-start', 'tool-workflow/agent-start', 'tool-workflow/agent-end',
      ],
    } as const
    expect(types).toEqual(expectedPrefixes[failedType])
  })

  it('contains an append failure whose thrown value cannot be rendered', async () => {
    const { ctx, engine, parent, session } = await setup()
    /** 中文说明：变量 warnings 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const warnings: string[] = []
    ctx.logger.warn = ((message: unknown) => { warnings.push(String(message)) }) as typeof ctx.logger.warn
    session.append = () => {
      throw { toString: () => { throw new Error('coercion trap') } }
    }
    /** 中文说明：变量 pending 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const pending = execute(ctx, { script: SCRIPT, meta: META }, { agent: parent })
    await vi.waitFor(() => { expect(engine.requests).toHaveLength(1) })
    engine.settleRun(WorkflowRunId('run-1'), {
      value: null, stopReason: 'completed', agentsStarted: 0,
    })
    expect((await pending).isError).toBe(false)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('[unrenderable thrown value]')
  })

  it('maps a non-completed stop reason to an isError result (and still disposes)', async () => {
    const { ctx, engine, parent } = await setup()
    /** 中文说明：变量 pending 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const pending = execute(ctx, { script: SCRIPT, meta: META }, { agent: parent })
    await vi.waitFor(() => { expect(engine.requests.length).toBe(1) })
    engine.settle({ value: null, stopReason: 'error', error: 'script threw: boom', agentsStarted: 2 })
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await pending
    expect(result.isError).toBe(true)
    expect((result.content[0] as { text: string }).text).toContain('workflow run failed: script threw: boom')
    expect(engine.disposed).toBe(1)
  })

  it('reports a cancelled run distinctly (with and without a reason)', async () => {
    const { ctx, engine, parent } = await setup()
    /** 中文说明：变量 pending 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const pending = execute(ctx, { script: SCRIPT, meta: META }, { agent: parent })
    await vi.waitFor(() => { expect(engine.requests.length).toBe(1) })
    engine.settle({ value: null, stopReason: 'cancelled', error: 'user', agentsStarted: 0 })
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await pending
    expect(result.isError).toBe(true)
    expect((result.content[0] as { text: string }).text).toContain('workflow run was cancelled (user)')

    /** 中文说明：变量 bare 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const bare = execute(ctx, { script: SCRIPT, meta: META }, { agent: parent })
    await vi.waitFor(() => { expect(engine.requests.length).toBe(2) })
    engine.settle({ value: null, stopReason: 'cancelled', agentsStarted: 0 })
    expect(((await bare).content[0] as { text: string }).text.trim().endsWith('cancelled')).toBe(true)
  })

  it('an error result without a message renders the unknown-error fallback', async () => {
    const { ctx, engine, parent } = await setup()
    /** 中文说明：变量 pending 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const pending = execute(ctx, { script: SCRIPT, meta: META }, { agent: parent })
    await vi.waitFor(() => { expect(engine.requests.length).toBe(1) })
    engine.settle({ value: null, stopReason: 'error', agentsStarted: 0 })
    expect(((await pending).content[0] as { text: string }).text).toContain('unknown error')
  })

  it('cancels the run when exec.signal aborts MID-FLIGHT (the abort bridge)', async () => {
    const { ctx, engine, parent } = await setup()
    /** 中文说明：变量 controller 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const controller = new AbortController()
    /** 中文说明：变量 pending 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const pending = execute(ctx, { script: SCRIPT, meta: META }, { agent: parent, signal: controller.signal })
    await vi.waitFor(() => { expect(engine.requests.length).toBe(1) })
    controller.abort()
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await pending
    expect(result.isError).toBe(true)
    expect(engine.cancels).toContain('parent step aborted')
    expect(engine.disposed).toBe(1)
  })

  it('a synchronous engine start throw (meta/parse failure) becomes an isError result', async () => {
    const { ctx, engine, parent } = await setup()
    engine.startError = new Error('invalid meta: meta.name must be a non-empty string')
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await execute(ctx, { script: 'nope', meta: { name: '', description: 'd' } }, { agent: parent })
    expect(result.isError).toBe(true)
    expect((result.content[0] as { text: string }).text).toContain('meta.name must be a non-empty string')
  })

  it('requires a calling agent (fails loud without exec.agent)', async () => {
    const { ctx, engine } = await setup()
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await execute(ctx, { script: SCRIPT, meta: META })
    expect(result.isError).toBe(true)
    expect((result.content[0] as { text: string }).text).toContain('requires a calling agent')
    expect(engine.requests.length).toBe(0)
  })

  it('validates its own arguments via the schema DSL (missing script)', async () => {
    const { ctx, parent } = await setup()
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await execute(ctx, {}, { agent: parent })
    expect(result.isError).toBe(true)
    expect(result.error?.info?.code).toBe('INVALID_ARGS')
  })

  it('skips workflow startup when exec.signal is already aborted', async () => {
    const { ctx, engine, parent } = await setup()
    /** 中文说明：变量 controller 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const controller = new AbortController()
    controller.abort()
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await execute(ctx, { script: SCRIPT, meta: META }, { agent: parent, signal: controller.signal })
    expect(result.isError).toBe(true)
    expect(result.error).toEqual({
      message: 'tool call aborted before dispatch',
      info: { name: 'AbortError', code: TOOL_ABORTED_BEFORE_DISPATCH },
    })
    expect(engine.requests).toHaveLength(0)
    expect(engine.cancels).toHaveLength(0)
    expect(engine.disposed).toBe(0)
  })

  it('truncates an oversized rendered value with a notice (maxResultChars)', async () => {
    const { ctx, engine, parent } = await setup({ maxResultChars: 40 })
    /** 中文说明：变量 pending 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const pending = execute(ctx, { script: SCRIPT, meta: META }, { agent: parent })
    await vi.waitFor(() => { expect(engine.requests.length).toBe(1) })
    engine.settle({ value: { blob: 'x'.repeat(500) }, stopReason: 'completed', agentsStarted: 1 })
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await pending
    if (result.isError) throw new Error('expected workflow success')
    expect(result.value).toEqual({ runId: 'run-1', agentsStarted: 1, result: { blob: 'x'.repeat(500) } })
    /** 中文说明：变量 rendered 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const rendered = (result.content[0] as { text: string }).text
    expect(rendered).toContain('[truncated:')
    expect(rendered.length).toBeLessThan(400)
  })

  it('registers under a configured toolName and unregisters on fiber dispose (HMR safety)', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(StubEngine)
    /** 中文说明：变量 fiber 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const fiber = await ctx.plugin(toolWorkflow, { toolName: 'orchestrate' })
    expect(ctx.tools.get('orchestrate')).toBeDefined()
    expect(ctx.tools.get('workflow')).toBeUndefined()
    // The usage-policy prompt section rides the same registration: present
    // under the CONFIGURED name (its guidance names the tool it describes)…
    /** 中文说明：变量 sections 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const sections = (await ctx.systemPrompt.assemble()).sections
    /** 中文说明：函数值 section 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const section = sections.find(s => s.name === 'tool:orchestrate')
    expect(section?.text).toContain('orchestrate')
    expect(sections.some(s => s.name === 'tool:workflow')).toBe(false)
    ctx.systemPrompt.section({ name: 'tool:cordis-order-probe', order: 115.5, text: 'Cordis' })
    expect((await ctx.systemPrompt.assemble()).sections
      .filter(s => s.name === 'tool:cordis-order-probe' || s.name === 'tool:orchestrate')
      .map(s => s.name)).toEqual(['tool:cordis-order-probe', 'tool:orchestrate'])
    await fiber.dispose()
    expect(ctx.tools.get('orchestrate')).toBeUndefined()
    // …and gone with the fiber — a reload must not leak a stale section.
    expect((await ctx.systemPrompt.assemble()).sections.some(s => s.name === 'tool:orchestrate')).toBe(false)
  })

  it('presents a generic pending card titled by the meta name, with the script as rawInput', async () => {
    const { ctx } = await setup()
    /** 中文说明：变量 tool 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const tool = ctx.tools.get('workflow')!
    /** 中文说明：变量 view 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const view = tool.presentCall!({ script: SCRIPT, meta: META })
    expect(view).toMatchObject({ card: 'generic', title: 'workflow: audit', rawInput: SCRIPT })
  })

  it('presentResult keeps the generic card; presentation is pure and replay-safe on malformed args', async () => {
    const { ctx } = await setup()
    /** 中文说明：变量 tool 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const tool = ctx.tools.get('workflow')!
    expect(tool.presentResult!({ script: SCRIPT, meta: META }, { content: [], isError: false })).toEqual({ card: 'generic' })
    // defineTool soft-validates presentation args: a malformed logged shape
    // (wrong fields entirely, or a call missing its meta) falls back to
    // undefined instead of throwing mid-replay.
    expect(tool.presentCall!({ not: 'the schema' })).toBeUndefined()
    expect(tool.presentCall!({ script: SCRIPT })).toBeUndefined()
  })

  it('has the namespace-plugin export shape (no stray default)', () => {
    expect('default' in toolWorkflow).toBe(false)
    expect(toolWorkflow.name).toBe('tool-workflow')
    expect(toolWorkflow.inject).toEqual(['tools', 'workflowEngine', 'systemPrompt'])
    /** 中文说明：变量 loader 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const loader = Object.create(Loader.prototype) as Loader
    /** 中文说明：变量 unwrapped 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const unwrapped = loader.unwrapExports(toolWorkflow) as Record<string, unknown>
    expect(unwrapped).toBe(toolWorkflow)
    expect(typeof unwrapped.apply).toBe('function')
  })

  describe('composition with the REAL worker-thread engine (the mock above must stay honest)', () => {
    it('an abort releases the tool even when the script parks on a promise no hook owns', async () => {
      // The tool and loop await run.result before cleanup, so cancellation must settle a script
      // parked on an unowned promise. Exercise that guarantee through the real registry and worker.
      /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const ctx = new Context()
      await ctx.plugin(SystemPrompt)
      await ctx.plugin(ToolRuntime)
      await ctx.plugin(SubagentRuntime)
      ctx.subagents.registerProvider({
        name: 'spawn',
        capabilities: { agentOptions: true, outputSchema: true, depthLimit: true, toolFilter: true, persona: true },
        inheritsParentContext: false,
        start: () => Promise.reject(new Error('the parked-script fixture must not start a child')),
      })
      await ctx.plugin(WorkerThreadWorkflowEngine, { disposeGraceMs: 30 })
      await ctx.plugin(toolWorkflow, {})
      /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const session = Session.create(SessionId('caller'))
      /** 中文说明：变量 parent 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const parent = { id: session.id, options: {}, session } as unknown as Agent
      /** 中文说明：变量 controller 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const controller = new AbortController()
      /** 中文说明：变量 pending 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const pending = execute(ctx, {
        script: 'await new Promise(() => {})\nreturn 1',
        meta: { name: 'stuck', description: 'parks forever' },
      }, { agent: parent, signal: controller.signal })
      // Give the run a beat to start (past its synchronous slice), then abort.
      await new Promise(resolve => setTimeout(resolve, 20))
      controller.abort('user abort')
      /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const result = await pending
      expect(result.isError).toBe(true)
      expect((result.content[0] as { text: string }).text).toContain('cancelled')
    })
  })
})
