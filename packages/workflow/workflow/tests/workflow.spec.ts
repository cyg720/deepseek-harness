/**
 * 文件职责：验证 workflow.spec.ts 覆盖的工作流与 Worker Thread行为与生命周期。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、Worker Thread、消息协议或领域实体。
 * 产品维度：保障 Agent 的工作流与 Worker Thread能力稳定、可隔离且可诊断。
 * 逻辑维度：准备配置和消息，建立运行环境，执行流程，再处理事件、错误与清理。
 * 关键边界：线程消息不可信；跨线程状态必须显式传递；终止时必须等待所拥有资源停止。
 * 新手阅读建议：先看协议和类型，再读 Host/Runtime 主流程，最后关注隔离、失败与清理。
 */
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import WorkflowEngineDefault, {
  isFatalWorkflowError,
  WorkflowError,
  WorkflowRunId,
  WorkflowEngine,
} from '../src/index.ts'
import type { WorkflowRun, WorkflowRunInfo, WorkflowStartRequest } from '../src/index.ts'

/** A minimal concrete subclass exposing the protected emit helper for tests. */
/** 中文说明：class StubEngine 定义本测试所需的数据或行为，用于表达工作流与 Worker Thread场景。 */
class StubEngine extends WorkflowEngine {
  start(request: WorkflowStartRequest): WorkflowRun {
    void request
    throw new Error('not under test')
  }

  emit(name: Parameters<WorkflowEngine['emitWorkflowEvent']>[0], ...args: unknown[]): void {
    this.emitWorkflowEvent(name, ...args)
  }
}

/** 中文说明：常量 INFO 保存本测试共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const INFO: WorkflowRunInfo = { id: WorkflowRunId('run-1'), meta: { name: 'w', description: 'd' } }

describe('dsh-workflow (interface)', () => {
  it('WorkflowRunId brands a string (identity at runtime)', () => {
    expect(WorkflowRunId('abc')).toBe('abc')
  })

  it('WorkflowError carries code + fatal (default true) and reads as a HarnessError', () => {
    /** 中文说明：变量 error 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const error = new WorkflowError('cap hit', 'AGENT_CAP')
    expect(error.code).toBe('AGENT_CAP')
    expect(error.fatal).toBe(true)
    expect(error.name).toBe('WorkflowError')
    /** 中文说明：变量 soft 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const soft = new WorkflowError('advisory', 'ITEM_CAP', { fatal: false })
    expect(soft.fatal).toBe(false)
  })

  it('isFatalWorkflowError: true only for a fatal WorkflowError', () => {
    expect(isFatalWorkflowError(new WorkflowError('x', 'CANCELLED'))).toBe(true)
    expect(isFatalWorkflowError(new WorkflowError('x', 'CANCELLED', { fatal: false }))).toBe(false)
    expect(isFatalWorkflowError(new Error('plain'))).toBe(false)
    expect(isFatalWorkflowError('string')).toBe(false)
  })

  it('registers as ctx.workflowEngine and unregisters when its fiber is disposed (HMR safety)', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    /** 中文说明：变量 fiber 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const fiber = await ctx.plugin(StubEngine)
    expect(ctx.get('workflowEngine')).toBeInstanceOf(StubEngine)
    await fiber.dispose()
    expect(ctx.get('workflowEngine')).toBeUndefined()
  })

  it('emitWorkflowEvent dispatches to every listener with the payload tuple', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(StubEngine)
    /** 中文说明：变量 seen 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const seen: unknown[][] = []
    ctx.on('workflow/log', (info, message) => { seen.push([info, message]) })
    ctx.on('workflow/agent-start', (info, agent) => { seen.push([info, agent]) })
    /** 中文说明：变量 engine 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const engine = ctx.workflowEngine as StubEngine
    engine.emit('workflow/start', INFO)
    engine.emit('workflow/log', INFO, 'hello')
    engine.emit('workflow/agent-start', INFO, { seq: 1, label: 'l', childId: 'c' })
    engine.emit('workflow/agent-end', INFO, { seq: 1, label: 'l', childId: 'c', outcome: 'completed' })
    engine.emit('workflow/end', INFO, { stopReason: 'completed', agentsStarted: 1 })
    expect(seen).toEqual([
      [INFO, 'hello'],
      [INFO, { seq: 1, label: 'l', childId: 'c' }],
    ])
  })

  it('contains an asynchronously rejected listener without starving peers', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(StubEngine)
    /** 中文说明：函数值 warn 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => ctx.logger)
    /** 中文说明：变量 seen 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const seen: string[] = []
    // Runtime listeners may return thenables even though the declaration's observable result is void.
    // oxlint-disable-next-line typescript/no-misused-promises -- exercises rejected-listener containment
    ctx.on('workflow/agent-start', async () => { throw new Error('async observer failed') })
    ctx.on('workflow/agent-start', (_info, agent) => { seen.push(agent.label) })
    /** 中文说明：变量 engine 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const engine = ctx.workflowEngine as StubEngine
    /** 中文说明：变量 payload 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const payload = { seq: 1, label: 'original', childId: 'c' }
    engine.emit('workflow/start', INFO)
    engine.emit('workflow/agent-start', INFO, payload)
    await Promise.resolve()
    engine.emit('workflow/agent-end', INFO, { ...payload, outcome: 'completed' })
    engine.emit('workflow/end', INFO, { stopReason: 'completed', agentsStarted: 1 })
    expect(seen).toEqual(['original'])
    expect(String(warn.mock.calls[0]![0])).toContain('listener rejected')
  })

  it('contains a throwing listener PER LISTENER: later listeners still run, nothing propagates', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(StubEngine)
    /** 中文说明：函数值 warn 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => ctx.logger)
    /** 中文说明：变量 reached 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const reached: string[] = []
    ctx.on('workflow/phase', () => { throw new Error('bad listener') })
    ctx.on('workflow/phase', (_info, title) => { reached.push(title) })
    /** 中文说明：变量 engine 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const engine = ctx.workflowEngine as StubEngine
    engine.emit('workflow/start', INFO)
    expect(() => { engine.emit('workflow/phase', INFO, 'Scan') }).not.toThrow()
    engine.emit('workflow/end', INFO, { stopReason: 'completed', agentsStarted: 0 })
    expect(reached).toEqual(['Scan'])
    expect(warn).toHaveBeenCalledOnce()
    expect(String(warn.mock.calls[0]![0])).toContain('workflow/phase listener threw')
  })

  it('containment is total: a listener throwing a value whose coercion throws neither propagates nor starves later listeners', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(StubEngine)
    /** 中文说明：函数值 warn 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => ctx.logger)
    /** 中文说明：变量 reached 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const reached: string[] = []
    ctx.on('workflow/phase', () => {
      throw { toString: () => { throw new Error('coercion trap') } }
    })
    ctx.on('workflow/phase', (_info, title) => { reached.push(title) })
    /** 中文说明：变量 engine 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const engine = ctx.workflowEngine as StubEngine
    engine.emit('workflow/start', INFO)
    expect(() => { engine.emit('workflow/phase', INFO, 'Scan') }).not.toThrow()
    engine.emit('workflow/end', INFO, { stopReason: 'completed', agentsStarted: 0 })
    expect(reached).toEqual(['Scan'])
    expect(warn).toHaveBeenCalledOnce()
    expect(String(warn.mock.calls[0]![0])).toContain('[unrenderable thrown value]')
  })

  it('has the expected exports (default = the abstract service class)', () => {
    expect(WorkflowEngineDefault).toBe(WorkflowEngine)
  })
})
