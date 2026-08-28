/**
 * 文件职责：验证 tool-ralph.spec.ts 覆盖的工作流与 Worker Thread行为与生命周期。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、Worker Thread、消息协议或领域实体。
 * 产品维度：保障 Agent 的工作流与 Worker Thread能力稳定、可隔离且可诊断。
 * 逻辑维度：准备配置和消息，建立运行环境，执行流程，再处理事件、错误与清理。
 * 关键边界：线程消息不可信；跨线程状态必须显式传递；终止时必须等待所拥有资源停止。
 * 新手阅读建议：先看协议和类型，再读 Host/Runtime 主流程，最后关注隔离、失败与清理。
 */
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import type { SubagentCapabilities, SubagentProvider, SubagentRun, SubagentStartRequest } from '@deepseek-ai/dsh-subagent'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { TOOL_ABORTED_BEFORE_DISPATCH } from '@deepseek-ai/dsh-tools'
import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import { WorkflowRunId, WorkflowEngine } from '@deepseek-ai/dsh-workflow'
import type { WorkflowResult, WorkflowRun, WorkflowStartRequest } from '@deepseek-ai/dsh-workflow'
import * as toolRalph from '../src/index.ts'

/** 中文说明：变量 testToolSignal 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const testToolSignal = new AbortController().signal

/** 中文说明：class StubEngine 定义本测试所需的数据或行为，用于表达工作流与 Worker Thread场景。 */
class StubEngine extends WorkflowEngine {
  requests: WorkflowStartRequest[] = []
  cancels: string[] = []
  disposed = 0
  settle!: (result: WorkflowResult) => void
  startError: Error | undefined
  onStart: (() => void) | undefined

  start(request: WorkflowStartRequest): WorkflowRun {
    if (this.startError !== undefined) throw this.startError
    this.requests.push(request)
    /** 中文说明：函数值 result 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const result = new Promise<WorkflowResult>((resolve) => { this.settle = resolve })
    this.onStart?.()
    return {
      id: WorkflowRunId(`ralph-${this.requests.length}`),
      meta: request.meta,
      result,
      cancel: (reason?: string) => {
        this.cancels.push(reason ?? 'cancelled')
        this.settle({
          value: null,
          stopReason: 'cancelled',
          ...reason === undefined ? {} : { error: reason },
          agentsStarted: 0,
        })
      },
      dispose: () => {
        this.disposed += 1
        return Promise.resolve()
      },
    }
  }
}

/** 中文说明：class StubProvider 定义本测试所需的数据或行为，用于表达工作流与 Worker Thread场景。 */
class StubProvider implements SubagentProvider {
  readonly name = 'fresh'
  readonly capabilities: SubagentCapabilities
  readonly inheritsParentContext: boolean

  constructor(options?: { outputSchema?: boolean; inheritsParentContext?: boolean }) {
    this.capabilities = {
      agentOptions: true,
      outputSchema: options?.outputSchema ?? true,
      depthLimit: true,
      toolFilter: true,
      persona: true,
    }
    this.inheritsParentContext = options?.inheritsParentContext ?? false
  }

  start(_request: SubagentStartRequest): Promise<SubagentRun> {
    return Promise.reject(new Error('StubProvider.start must not be reached behind StubEngine'))
  }
}

/** 中文说明：interface SetupOptions 定义本测试所需的数据或行为，用于表达工作流与 Worker Thread场景。 */
interface SetupOptions {
  config?: toolRalph.Config
  provider?: StubProvider | false
}

/** 中文说明：函数 setup 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function setup(options?: SetupOptions) {
  /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(SubagentRuntime)
  /** 中文说明：变量 provider 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const provider = options?.provider === false ? undefined : options?.provider ?? new StubProvider()
  if (provider !== undefined) ctx.subagents.registerProvider(provider)
  await ctx.plugin(StubEngine)
  /** 中文说明：变量 config 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const config: toolRalph.Config = { subagentProvider: 'fresh' }
  if (options?.config?.subagentProvider !== undefined) config.subagentProvider = options.config.subagentProvider
  if (options?.config?.maxRounds !== undefined) config.maxRounds = options.config.maxRounds
  if (options?.config?.maxHandoffChars !== undefined) config.maxHandoffChars = options.config.maxHandoffChars
  if (options?.config?.maxResultChars !== undefined) config.maxResultChars = options.config.maxResultChars
  /** 中文说明：变量 fiber 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const fiber = await ctx.plugin(toolRalph, config)
  /** 中文说明：变量 parent 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const parent = { id: SessionId('caller'), options: {} } as unknown as Agent
  return { ctx, engine: ctx.workflowEngine as StubEngine, parent, fiber }
}

/** 中文说明：函数 execute 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function execute(
  ctx: Context,
  args: unknown,
  extra?: { agent?: Agent; signal?: AbortSignal },
): Promise<ToolExecutionResult> {
  return ctx.tools.execute({
    signal: extra?.signal ?? testToolSignal,
    callId: ToolCallId('ralph-call'),
    name: 'ralph',
    arguments: args,
    ...extra?.agent === undefined ? {} : { agent: extra.agent },
  })
}

/** 中文说明：常量 CONTINUE 保存本测试共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const CONTINUE = {
  status: 'continue',
  summary: 'Implemented the first slice.',
  evidence: ['Focused tests pass.'],
  nextSteps: ['Implement the second slice.'],
  blocker: '',
}

/** 中文说明：常量 COMPLETE 保存本测试共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const COMPLETE = {
  status: 'complete',
  summary: 'The objective is complete.',
  evidence: ['All required gates pass.'],
  nextSteps: [],
  blocker: '',
}

/** 中文说明：常量 BLOCKED 保存本测试共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const BLOCKED = {
  status: 'blocked',
  summary: 'No local work can progress.',
  evidence: ['The required remote service is unavailable.'],
  nextSteps: ['Retry after service recovery.'],
  blocker: 'The required remote service is unavailable.',
}

/** 中文说明：函数 settleCompleted 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function settleCompleted(
  engine: StubEngine,
  pending: Promise<ToolExecutionResult>,
  value: unknown,
  agentsStarted = 1,
): Promise<ToolExecutionResult> {
  await vi.waitFor(() => { expect(engine.requests.length).toBeGreaterThan(0) })
  engine.settle({ value, stopReason: 'completed', agentsStarted })
  return pending
}

describe('dsh-tool-ralph', () => {
  it('starts the fixed workflow through the configured fresh provider and renders completion', async () => {
    const { ctx, engine, parent } = await setup({ config: { maxRounds: 9, maxHandoffChars: 9000 } })
    /** 中文说明：变量 pending 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const pending = execute(ctx, { objective: '  Finish the migration.  ', maxRounds: 4 }, { agent: parent })
    await vi.waitFor(() => { expect(engine.requests).toHaveLength(1) })
    expect(engine.requests[0]).toMatchObject({
      meta: { name: 'ralph-loop' },
      args: { objective: 'Finish the migration.', maxRounds: 4, maxHandoffChars: 9000 },
      subagentProvider: 'fresh',
      maxTotalAgents: 4,
      parent,
    })
    expect(engine.requests[0]!.script).toContain("status: 'budget-limited'")
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await settleCompleted(engine, pending, {
      status: 'complete',
      roundsStarted: 1,
      report: COMPLETE,
    })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected Ralph success')
    expect(result.value).toEqual({
      runId: 'ralph-1',
      agentsStarted: 1,
      result: { status: 'complete', roundsStarted: 1, report: COMPLETE },
    })
    expect((result.content[0] as { text: string }).text)
      .toContain('Ralph worker reported completion after 1 round.')
    expect((result.content[0] as { text: string }).text).toContain('All required gates pass.')
    expect(engine.disposed).toBe(1)
  })

  it('renders blocked and budget-limited terminal outcomes as bounded successful results', async () => {
    const { ctx, engine, parent } = await setup({ config: { maxRounds: 2 } })
    /** 中文说明：变量 blocked 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const blocked = execute(ctx, { objective: 'Ship it.' }, { agent: parent })
    /** 中文说明：变量 blockedResult 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const blockedResult = await settleCompleted(engine, blocked, {
      status: 'blocked',
      roundsStarted: 2,
      report: BLOCKED,
    }, 2)
    expect((blockedResult.content[0] as { text: string }).text)
      .toContain('Ralph worker reported a blocker after 2 rounds.')

    /** 中文说明：变量 limited 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const limited = execute(ctx, { objective: 'Ship it.' }, { agent: parent })
    await vi.waitFor(() => { expect(engine.requests).toHaveLength(2) })
    /** 中文说明：变量 limitedResult 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const limitedResult = await settleCompleted(engine, limited, {
      status: 'budget-limited',
      roundsStarted: 2,
      report: CONTINUE,
    }, 2)
    expect((limitedResult.content[0] as { text: string }).text)
      .toContain('Ralph reached its 2 rounds limit; the worker reported work remaining.')
  })

  it('bounds the complete parent result and labels worker-reported completion', async () => {
    const { ctx, engine, parent } = await setup({ config: { maxResultChars: 160 } })
    /** 中文说明：变量 pending 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const pending = execute(ctx, { objective: 'Ship it.' }, { agent: parent })
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await settleCompleted(engine, pending, {
      status: 'complete',
      roundsStarted: 1,
      report: { ...COMPLETE, evidence: ['x'.repeat(500)] },
    })
    /** 中文说明：变量 text 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const text = (result.content[0] as { text: string }).text
    expect(text).toHaveLength(160)
    expect(text).toContain('Ralph worker reported completion after 1 round.')
    expect(text).toMatch(/… \[truncated\]$/)
  })

  it('honors a result limit shorter than the truncation marker', async () => {
    const { ctx, engine, parent } = await setup({ config: { maxResultChars: 5 } })
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await settleCompleted(engine, execute(ctx, { objective: 'Ship it.' }, { agent: parent }), {
      status: 'complete',
      roundsStarted: 1,
      report: COMPLETE,
    })
    expect((result.content[0] as { text: string }).text).toBe('\n… [t')
  })

  it('reports an ordinary child failure with the failed round and last durable handoff', async () => {
    const { ctx, engine, parent } = await setup({ config: { maxRounds: 2 } })
    /** 中文说明：变量 first 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const first = execute(ctx, { objective: 'Ship it.', maxRounds: 2 }, { agent: parent })
    /** 中文说明：变量 firstResult 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const firstResult = await settleCompleted(engine, first, {
      status: 'round-failed',
      roundsStarted: 1,
      lastReport: null,
    })
    expect(firstResult.isError).toBe(true)
    expect((firstResult.content[0] as { text: string }).text).toContain('Ralph round 1 child failed')
    expect((firstResult.content[0] as { text: string }).text).toContain('No previous handoff was available.')

    /** 中文说明：变量 later 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const later = execute(ctx, { objective: 'Ship it.', maxRounds: 2 }, { agent: parent })
    /** 中文说明：变量 laterResult 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const laterResult = await settleCompleted(engine, later, {
      status: 'round-failed',
      roundsStarted: 2,
      lastReport: CONTINUE,
    })
    expect(laterResult.isError).toBe(true)
    expect((laterResult.content[0] as { text: string }).text).toContain('Ralph round 2 child failed')
    expect((laterResult.content[0] as { text: string }).text).toContain('Implemented the first slice.')
  })

  it('maps workflow error and cancellation reasons to tool errors and always disposes', async () => {
    const { ctx, engine, parent } = await setup()
    /** 中文说明：变量 failed 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const failed = execute(ctx, { objective: 'Work.' }, { agent: parent })
    await vi.waitFor(() => { expect(engine.requests).toHaveLength(1) })
    engine.settle({ value: null, stopReason: 'error', error: 'child report malformed', agentsStarted: 1 })
    expect(((await failed).content[0] as { text: string }).text)
      .toContain('Ralph workflow failed: child report malformed')

    /** 中文说明：变量 unknown 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const unknown = execute(ctx, { objective: 'Work.' }, { agent: parent })
    await vi.waitFor(() => { expect(engine.requests).toHaveLength(2) })
    engine.settle({ value: null, stopReason: 'error', agentsStarted: 0 })
    expect(((await unknown).content[0] as { text: string }).text).toContain('unknown error')

    /** 中文说明：变量 cancelled 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const cancelled = execute(ctx, { objective: 'Work.' }, { agent: parent })
    await vi.waitFor(() => { expect(engine.requests).toHaveLength(3) })
    engine.settle({ value: null, stopReason: 'cancelled', error: 'user stopped', agentsStarted: 0 })
    expect(((await cancelled).content[0] as { text: string }).text).toContain('cancelled (user stopped)')

    /** 中文说明：变量 bare 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const bare = execute(ctx, { objective: 'Work.' }, { agent: parent })
    await vi.waitFor(() => { expect(engine.requests).toHaveLength(4) })
    engine.settle({ value: null, stopReason: 'cancelled', agentsStarted: 0 })
    expect(((await bare).content[0] as { text: string }).text).toMatch(/cancelled$/)
    expect(engine.disposed).toBe(4)
  })

  it('bridges mid-flight cancellation and skips dispatch for an already-aborted parent signal', async () => {
    const { ctx, engine, parent } = await setup()
    /** 中文说明：变量 controller 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const controller = new AbortController()
    /** 中文说明：变量 pending 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const pending = execute(ctx, { objective: 'Work.' }, { agent: parent, signal: controller.signal })
    await vi.waitFor(() => { expect(engine.requests).toHaveLength(1) })
    controller.abort()
    expect((await pending).isError).toBe(true)

    /** 中文说明：变量 already 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const already = new AbortController()
    already.abort()
    /** 中文说明：变量 skipped 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const skipped = await execute(ctx, { objective: 'Work.' }, { agent: parent, signal: already.signal })
    expect(skipped.error?.info?.code).toBe(TOOL_ABORTED_BEFORE_DISPATCH)
    expect(engine.requests).toHaveLength(1)
    expect(engine.cancels).toEqual(['parent step aborted'])
    expect(engine.disposed).toBe(1)
  })

  it('bridges cancellation that arrives while the workflow is starting', async () => {
    const { ctx, engine, parent } = await setup()
    /** 中文说明：变量 controller 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const controller = new AbortController()
    engine.onStart = () => { controller.abort() }

    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await execute(ctx, { objective: 'Work.' }, { agent: parent, signal: controller.signal })

    expect(result.isError).toBe(true)
    expect(engine.requests[0]?.signal).toBe(controller.signal)
    expect(engine.cancels).toEqual(['parent step aborted'])
    expect(engine.disposed).toBe(1)
  })

  it('rejects absent authority, empty objectives, bad round caps, and schema-invalid calls before start', async () => {
    const { ctx, engine, parent } = await setup({ config: { maxRounds: 3 } })
    expect((await execute(ctx, { objective: 'Work.' })).isError).toBe(true)
    expect((await execute(ctx, { objective: '   ' }, { agent: parent })).isError).toBe(true)
    /** 中文说明：该循环依次处理消息或实体；循环变量仅在当前循环中有效。 */
    for (const maxRounds of [0, 1.5, Number.NaN, 4]) {
      expect((await execute(ctx, { objective: 'Work.', maxRounds }, { agent: parent })).isError).toBe(true)
    }
    /** 中文说明：变量 missing 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const missing = await execute(ctx, {}, { agent: parent })
    expect(missing.error?.info?.code).toBe('INVALID_ARGS')
    expect(engine.requests).toHaveLength(0)
  })

  it('rejects missing, unstructured, and parent-context-inheriting provider routes', async () => {
    /** 中文说明：变量 missing 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const missing = await setup({ provider: false })
    expect(((await execute(missing.ctx, { objective: 'Work.' }, { agent: missing.parent })).content[0] as { text: string }).text)
      .toContain('is not registered')
    expect(missing.engine.requests).toHaveLength(0)

    /** 中文说明：变量 unstructured 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const unstructured = await setup({ provider: new StubProvider({ outputSchema: false }) })
    expect(((await execute(unstructured.ctx, { objective: 'Work.' }, { agent: unstructured.parent })).content[0] as { text: string }).text)
      .toContain('does not support structured output')

    /** 中文说明：变量 inherited 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const inherited = await setup({ provider: new StubProvider({ inheritsParentContext: true }) })
    expect(((await execute(inherited.ctx, { objective: 'Work.' }, { agent: inherited.parent })).content[0] as { text: string }).text)
      .toContain('inherits parent context')
  })

  it('rejects invalid direct-apply config before touching injected services', () => {
    expect(() => { toolRalph.apply(new Context(), { subagentProvider: ' ' }) }).toThrow('non-empty normalized')
    expect(() => { toolRalph.apply(new Context(), { maxRounds: 0 }) }).toThrow('positive safe integer')
    expect(() => { toolRalph.apply(new Context(), { maxHandoffChars: 1.5 }) }).toThrow('positive safe integer')
    expect(() => { toolRalph.apply(new Context(), { maxResultChars: 0 }) }).toThrow('positive safe integer')
  })

  it('turns malformed fixed-workflow terminal values and reports into errors', async () => {
    /** 中文说明：变量 cases 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const cases: { value: unknown; message: string; config?: toolRalph.Config }[] = [
      { value: null, message: 'malformed terminal result' },
      { value: { status: 'complete', roundsStarted: 0, report: COMPLETE }, message: 'malformed terminal result' },
      { value: { status: 'complete', roundsStarted: 3, report: COMPLETE }, message: 'malformed terminal result', config: { maxRounds: 2 } },
      { value: { status: 'mystery', roundsStarted: 1, report: COMPLETE }, message: 'unknown terminal status' },
      { value: { status: 'budget-limited', roundsStarted: 1, report: CONTINUE }, message: 'before the round limit', config: { maxRounds: 2 } },
      { value: { status: 'complete', roundsStarted: 1, report: null }, message: 'malformed round report' },
      { value: { status: 'complete', roundsStarted: 1, report: COMPLETE, extra: true }, message: 'malformed terminal result' },
      { value: { status: 'blocked', roundsStarted: 1, report: BLOCKED, extra: true }, message: 'malformed terminal result' },
      { value: { status: 'budget-limited', roundsStarted: 1, report: CONTINUE, extra: true }, message: 'malformed terminal result', config: { maxRounds: 1 } },
      { value: { status: 'complete', roundsStarted: 1, report: { ...COMPLETE, status: 'continue' } }, message: 'malformed round report' },
      { value: { status: 'budget-limited', roundsStarted: 1, report: { ...CONTINUE, nextSteps: [] } }, message: 'invalid continuing report', config: { maxRounds: 1 } },
      { value: { status: 'complete', roundsStarted: 1, report: { ...COMPLETE, evidence: [] } }, message: 'invalid completion report' },
      { value: { status: 'blocked', roundsStarted: 1, report: { ...BLOCKED, blocker: '' } }, message: 'invalid blocked report' },
      { value: { status: 'complete', roundsStarted: 1, report: { ...COMPLETE, summary: 'x'.repeat(500) } }, message: 'oversized handoff', config: { maxHandoffChars: 100 } },
      { value: { status: 'round-failed', roundsStarted: 1 }, message: 'malformed terminal result' },
      { value: { status: 'round-failed', roundsStarted: 1, lastReport: CONTINUE }, message: 'invalid first-round failure' },
      { value: { status: 'round-failed', roundsStarted: 2, lastReport: null }, message: 'without its last handoff', config: { maxRounds: 2 } },
      { value: { status: 'round-failed', roundsStarted: 2, lastReport: { ...CONTINUE, nextSteps: [] } }, message: 'invalid continuing report', config: { maxRounds: 2 } },
    ]
    /** 中文说明：该循环依次处理消息或实体；循环变量仅在当前循环中有效。 */
    for (const testCase of cases) {
      const { ctx, engine, parent } = await setup(
        testCase.config === undefined ? undefined : { config: testCase.config },
      )
      /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const result = await settleCompleted(
        engine,
        execute(ctx, { objective: 'Work.', ...testCase.config?.maxRounds === undefined ? {} : { maxRounds: testCase.config.maxRounds } }, { agent: parent }),
        testCase.value,
      )
      expect(result.isError).toBe(true)
      expect((result.content[0] as { text: string }).text).toContain(testCase.message)
    }
  })

  it('surfaces a synchronous engine start failure without inventing a run', async () => {
    const { ctx, engine, parent } = await setup()
    engine.startError = new Error('engine refused fixed script')
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await execute(ctx, { objective: 'Work.' }, { agent: parent })
    expect(result.isError).toBe(true)
    expect((result.content[0] as { text: string }).text).toContain('engine refused fixed script')
    expect(engine.disposed).toBe(0)
  })

  it('registers scoped guidance and pure replay-safe generic presentation', async () => {
    const { ctx, fiber } = await setup()
    /** 中文说明：函数值 section 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const section = (await ctx.systemPrompt.assemble()).sections.find(candidate => candidate.name === 'tool:ralph')
    expect(section?.text).toContain('ONLY when the direct human explicitly asks')
    expect(section?.text).toContain('worker reports, not independent evaluation')
    /** 中文说明：变量 tool 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const tool = ctx.tools.get('ralph')!
    expect(tool.description).toContain('worker reports completion')
    expect(tool.presentCall!({ objective: 'Finish it.' })).toEqual({
      card: 'generic',
      title: 'ralph',
      rawInput: 'Finish it.',
    })
    expect(tool.presentResult!({ objective: 'Finish it.' }, { content: [], isError: false })).toEqual({ card: 'generic' })
    expect(tool.presentCall!({ nope: true })).toBeUndefined()
    await fiber.dispose()
    expect(ctx.tools.get('ralph')).toBeUndefined()
    expect((await ctx.systemPrompt.assemble()).sections.some(candidate => candidate.name === 'tool:ralph')).toBe(false)
  })

  it('has the namespace-plugin export shape', () => {
    expect('default' in toolRalph).toBe(false)
    expect(toolRalph.name).toBe('tool-ralph')
    expect(toolRalph.inject).toEqual(['tools', 'workflowEngine', 'subagents', 'systemPrompt'])
    /** 中文说明：变量 loader 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const loader = Object.create(Loader.prototype) as Loader
    /** 中文说明：变量 unwrapped 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const unwrapped = loader.unwrapExports(toolRalph) as Record<string, unknown>
    expect(unwrapped).toBe(toolRalph)
    expect(typeof unwrapped.apply).toBe('function')
  })
})
