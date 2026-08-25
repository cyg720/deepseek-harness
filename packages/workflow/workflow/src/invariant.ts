/** Package-owned workflow lifecycle invariants. @module @deepseek-ai/dsh-workflow/invariant */
/**
 * 文件职责：实现 invariant.ts 覆盖的工作流与 Worker Thread行为与生命周期。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、Worker Thread、消息协议或领域实体。
 * 产品维度：保障 Agent 的工作流与 Worker Thread能力稳定、可隔离且可诊断。
 * 逻辑维度：准备配置和消息，建立运行环境，执行流程，再处理事件、错误与清理。
 * 关键边界：线程消息不可信；跨线程状态必须显式传递；终止时必须等待所拥有资源停止。
 * 新手阅读建议：先看协议和类型，再读 Host/Runtime 主流程，最后关注隔离、失败与清理。
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type {
  WorkflowAgentEndInfo,
  WorkflowAgentInfo,
  WorkflowResultInfo,
  WorkflowRunInfo,
} from './types.ts'

/** 中文说明：常量 PACKAGE_NAME 保存本模块共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const PACKAGE_NAME = '@deepseek-ai/dsh-workflow'

/** Cordis companion plugin name. */
/** 中文说明：变量 name 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
export const name = 'workflow-invariant'
/** Service required before the companion can reserve package ownership. */
/** 中文说明：变量 inject 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
export const inject = ['invariants']

/** 中文说明：interface WorkflowTrace 定义本模块所需的数据或行为，用于表达工作流与 Worker Thread场景。 */
interface WorkflowTrace {
  meta: string
  agents: Map<number, WorkflowAgentInfo>
  starts: number
}

/** Require every event for a run to retain its validated identity snapshot. */
/** 中文说明：函数 traceFor 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function traceFor(
  traces: ReadonlyMap<string, WorkflowTrace>,
  info: WorkflowRunInfo,
  fail: InvariantFailure,
): WorkflowTrace {
  /** 中文说明：变量 trace 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const trace = traces.get(info.id)
  if (trace === undefined) fail(`workflow event has no matching workflow/start for run ${JSON.stringify(info.id)}`)
  if (trace.meta !== JSON.stringify(info.meta)) {
    fail(`workflow event meta diverges from workflow/start for run ${JSON.stringify(info.id)}`)
  }
  return trace
}

/** Assert the immutable identity fields shared by an agent pair. */
/** 中文说明：函数 validateAgentEnd 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function validateAgentEnd(start: WorkflowAgentInfo, end: WorkflowAgentEndInfo, fail: InvariantFailure): void {
  if (start.label !== end.label || start.phase !== end.phase || start.childId !== end.childId) {
    fail(`workflow/agent-end identity diverges from workflow/agent-start for seq ${end.seq}`)
  }
  /** 中文说明：变量 outcome 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const outcome: string = end.outcome
  if (outcome !== 'completed' && outcome !== 'failed' && outcome !== 'cancelled') {
    fail(`workflow/agent-end carries unknown outcome ${JSON.stringify(outcome)}`)
  }
}

/** Validate a terminal result against the accumulated run trace. */
/** 中文说明：函数 validateWorkflowEnd 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function validateWorkflowEnd(trace: WorkflowTrace, result: WorkflowResultInfo, fail: InvariantFailure): void {
  if (trace.agents.size > 0) fail(`workflow/end has ${trace.agents.size} agent call(s) without workflow/agent-end`)
  if (!Number.isSafeInteger(result.agentsStarted) || result.agentsStarted < trace.starts) {
    fail('workflow/end agentsStarted must be a safe integer covering every observed agent start')
  }
  if (result.stopReason === 'completed' ? result.error !== undefined : typeof result.error !== 'string') {
    fail('workflow/end error must be absent exactly for completed runs')
  }
}

/** Install workflow start/end and child-call pairing checks. */
/** 中文说明：函数值 install 封装本模块的局部步骤；参数和返回值由右侧签名约束；示例见本模块调用。 */
const install: InvariantInstaller = (ctx, fail) => {
  /** 中文说明：变量 traces 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const traces = new Map<string, WorkflowTrace>()
  /** 中文说明：变量 stagedStarts 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const stagedStarts = new WeakSet<WorkflowRunInfo>()
  /** 中文说明：变量 stagedAgentStarts 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const stagedAgentStarts = new WeakSet<WorkflowAgentInfo>()
  /** 中文说明：变量 stagedAgentEnds 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const stagedAgentEnds = new WeakSet<WorkflowAgentEndInfo>()
  /** 中文说明：变量 stagedEnds 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const stagedEnds = new WeakSet<WorkflowResultInfo>()

  ctx.on('internal/dispatch', (_mode, eventName, args) => {
    if (eventName === 'workflow/start') {
      /** 中文说明：变量 info 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const info = args[0] as WorkflowRunInfo
      if (String(info.id).length === 0 || info.meta.name.length === 0 || info.meta.description.length === 0) {
        fail('workflow/start id, meta.name, and meta.description must be non-empty')
      }
      if (traces.has(info.id)) fail(`workflow/start repeated run id ${JSON.stringify(info.id)}`)
      stagedStarts.add(info)
      return
    }
    if (!eventName.startsWith('workflow/')) return
    /** 中文说明：变量 info 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const info = args[0] as WorkflowRunInfo
    /** 中文说明：变量 trace 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const trace = traceFor(traces, info, fail)
    if (eventName === 'workflow/agent-start') {
      /** 中文说明：变量 agent 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const agent = args[1] as WorkflowAgentInfo
      if (!Number.isSafeInteger(agent.seq) || agent.seq < 1 || String(agent.childId).length === 0) {
        fail('workflow/agent-start seq must be positive and childId must be non-empty')
      }
      if (trace.agents.has(agent.seq)) fail(`workflow/agent-start repeated seq ${agent.seq}`)
      stagedAgentStarts.add(agent)
      return
    }
    if (eventName === 'workflow/agent-end') {
      /** 中文说明：变量 agent 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const agent = args[1] as WorkflowAgentEndInfo
      /** 中文说明：变量 start 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const start = trace.agents.get(agent.seq)
      if (start === undefined) return fail(`workflow/agent-end has no matching start for seq ${agent.seq}`)
      validateAgentEnd(start, agent, fail)
      stagedAgentEnds.add(agent)
      return
    }
    if (eventName === 'workflow/end') {
      /** 中文说明：变量 result 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const result = args[1] as WorkflowResultInfo
      validateWorkflowEnd(trace, result, fail)
      stagedEnds.add(result)
    }
  }, { global: true })

  ctx.on('workflow/start', (info) => {
    /* v8 ignore next -- internal/dispatch stages the same run-info object */
    if (!stagedStarts.delete(info)) return
    traces.set(info.id, { meta: JSON.stringify(info.meta), agents: new Map(), starts: 0 })
  }, { global: true })
  ctx.on('workflow/agent-start', (info, agent) => {
    /* v8 ignore next -- internal/dispatch stages the same agent object */
    if (!stagedAgentStarts.delete(agent)) return
    /** 中文说明：变量 trace 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const trace = traceFor(traces, info, fail)
    trace.agents.set(agent.seq, agent)
    trace.starts += 1
  }, { global: true })
  ctx.on('workflow/agent-end', (info, agent) => {
    /* v8 ignore next -- internal/dispatch stages the same agent object */
    if (!stagedAgentEnds.delete(agent)) return
    traceFor(traces, info, fail).agents.delete(agent.seq)
  }, { global: true })
  ctx.on('workflow/end', (info, result) => {
    /* v8 ignore next -- internal/dispatch stages the same result object */
    if (!stagedEnds.delete(result)) return
    traces.delete(info.id)
  }, { global: true })
}

/**
 * Register the workflow invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
/** 中文说明：函数值 apply 封装本模块的局部步骤；参数和返回值由右侧签名约束；示例见本模块调用。 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
