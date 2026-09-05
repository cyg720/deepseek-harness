/** Package-owned durable workflow-record invariants. @module @deepseek-ai/dsh-tool-workflow/invariant */

/*
 * 【文件职责】检查工作流持久运行记录的关联关系，约束工作流与子运行的日志完整性。
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type {} from './types.ts'

/** 中文说明：常量 PACKAGE_NAME 保存本模块共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const PACKAGE_NAME = '@deepseek-ai/dsh-tool-workflow'

/** Cordis companion plugin name. */
/* 中文说明：变量 name 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
export const name = 'tool-workflow-invariant'
/** Services required to validate existing and newly appended Session logs. */
/* 中文说明：变量 inject 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
export const inject = ['invariants']

/** 中文说明：interface RunTrace 定义本模块所需的数据或行为，用于表达工作流与 Worker Thread场景。 */
interface RunTrace {
  ended: boolean
  readonly members: Map<number, boolean>
}

/** 中文说明：type WorkflowTrace 定义本模块所需的数据或行为，用于表达工作流与 Worker Thread场景。 */
type WorkflowTrace = Map<string, RunTrace>

/** Whether this package owns the candidate Session event. */
/* 中文说明：函数 isWorkflowRecordEvent 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function isWorkflowRecordEvent(event: SessionEvent): boolean {
  return event.type.startsWith('tool-workflow/')
}

/** Require a durable opaque identity to be a non-empty string. */
/* 中文说明：函数 stringId 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function stringId(value: unknown, label: string, fail: InvariantFailure): string {
  if (typeof value !== 'string' || value.length === 0) fail(`${label} must be a non-empty string`)
  return value
}

/** Require one workflow member's 1-based sequence identity. */
/* 中文说明：函数 memberSeq 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function memberSeq(value: unknown, fail: InvariantFailure): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    fail('tool-workflow member seq must be a positive safe integer')
  }
  return value as number
}

/** Read one plain payload field without trusting restored plugin data. */
/* 中文说明：函数 recordOf 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function recordOf(event: SessionEvent, fail: InvariantFailure): Record<string, unknown> {
  /** 中文说明：变量 data 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const data: unknown = event.data
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    fail(`${event.type} data must be a JSON object`)
  }
  return data as Record<string, unknown>
}

/** Copy only the run one candidate can mutate; other committed states stay shared. */
/* 中文说明：函数 cloneTraceForEvent 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function cloneTraceForEvent(
  source: WorkflowTrace,
  event: SessionEvent,
  fail: InvariantFailure,
): WorkflowTrace {
  /** 中文说明：变量 trace 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const trace = new Map(source)
  if (event.type === 'tool-workflow/run-start') return trace
  /** 中文说明：变量 data 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const data = recordOf(event, fail)
  /** 中文说明：变量 runId 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const runId = stringId(data.runId, `${event.type} runId`, fail)
  /** 中文说明：变量 run 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const run = source.get(runId)
  if (run !== undefined) {
    trace.set(runId, { ended: run.ended, members: new Map(run.members) })
  }
  return trace
}

/** Require the named run to exist and remain open. */
/* 中文说明：函数 openRun 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function openRun(trace: WorkflowTrace, runId: string, eventType: string, fail: InvariantFailure): RunTrace {
  /** 中文说明：变量 run 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const run = trace.get(runId)
  if (run === undefined) fail(`${eventType} has no matching tool-workflow/run-start for run ${runId}`)
  if (run.ended) fail(`${eventType} appears after tool-workflow/run-end for run ${runId}`)
  return run
}

/** Advance the workflow-record fold with one relevant Session event. */
/* 中文说明：函数 applyEvent 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function applyEvent(trace: WorkflowTrace, event: SessionEvent, fail: InvariantFailure): void {
  /** 中文说明：变量 data 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const data = recordOf(event, fail)
  /** 中文说明：变量 runId 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const runId = stringId(data.runId, `${event.type} runId`, fail)

  switch (event.type) {
    case 'tool-workflow/run-start': {
      if (typeof data.name !== 'string' || data.name.length === 0) {
        fail('tool-workflow/run-start name must be a non-empty string')
      }
      if (trace.has(runId)) fail(`tool-workflow/run-start repeats run ${runId}`)
      trace.set(runId, { ended: false, members: new Map() })
      return
    }
    case 'tool-workflow/agent-start': {
      /** 中文说明：变量 run 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const run = openRun(trace, runId, event.type, fail)
      /** 中文说明：变量 seq 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const seq = memberSeq(data.seq, fail)
      if (typeof data.label !== 'string') fail('tool-workflow/agent-start label must be a string')
      if (data.phase !== undefined && typeof data.phase !== 'string') {
        fail('tool-workflow/agent-start phase must be a string when present')
      }
      stringId(data.childId, 'tool-workflow/agent-start childId', fail)
      if (run.members.has(seq)) fail(`tool-workflow/agent-start repeats member seq ${seq} in run ${runId}`)
      run.members.set(seq, false)
      return
    }
    case 'tool-workflow/agent-end': {
      /** 中文说明：变量 run 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const run = openRun(trace, runId, event.type, fail)
      /** 中文说明：变量 seq 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const seq = memberSeq(data.seq, fail)
      if (data.outcome !== 'completed' && data.outcome !== 'failed' && data.outcome !== 'cancelled') {
        fail(`tool-workflow/agent-end outcome ${String(data.outcome)} is invalid`)
      }
      /** 中文说明：变量 ended 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const ended = run.members.get(seq)
      if (ended === undefined) fail(`tool-workflow/agent-end has no matching member seq ${seq} in run ${runId}`)
      if (ended) fail(`tool-workflow/agent-end repeats member seq ${seq} in run ${runId}`)
      run.members.set(seq, true)
      return
    }
    case 'tool-workflow/run-end': {
      /** 中文说明：变量 run 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const run = openRun(trace, runId, event.type, fail)
      if (data.stopReason !== 'completed' && data.stopReason !== 'cancelled' && data.stopReason !== 'error') {
        fail(`tool-workflow/run-end stopReason ${String(data.stopReason)} is invalid`)
      }
      /** 中文说明：函数值 openMembers 封装本模块的局部步骤；参数和返回值由右侧签名约束；示例见本模块调用。 */
      const openMembers = [...run.members].filter(([, ended]) => !ended).map(([seq]) => seq)
      if (openMembers.length > 0) {
        fail(`tool-workflow/run-end leaves member seq ${openMembers.join(', ')} open in run ${runId}`)
      }
      run.ended = true
      run.members.clear()
      return
    }
    default:
      fail(`unknown tool-workflow event type ${event.type}`)
  }
}

/** Install an independent incremental fold over every attached Session. */
/* 中文说明：函数值 install 封装本模块的局部步骤；参数和返回值由右侧签名约束；示例见本模块调用。 */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  /** 中文说明：变量 traces 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const traces = new WeakMap<Session, WorkflowTrace>()
  /** 中文说明：变量 staged 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const staged = new WeakMap<SessionEvent, { session: Session; trace: WorkflowTrace }>()

  /** 中文说明：函数值 seed 封装本模块的局部步骤；参数和返回值由右侧签名约束；示例见本模块调用。 */
  const seed = (session: Session): WorkflowTrace => {
    /** 中文说明：变量 trace 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const trace: WorkflowTrace = new Map()
    for (const event of session.snapshotEvents().filter(isWorkflowRecordEvent)) applyEvent(trace, event, fail)
    traces.set(session, trace)
    return trace
  }
  ctx.sessions.list().forEach(seed)
  ctx.on('session/created', (session) => { seed(session) }, { global: true })
  ctx.on('internal/dispatch', (_mode, eventName, args) => {
    if (eventName !== 'session/event') return
    const [session, event] = args as [Session, SessionEvent]
    if (!isWorkflowRecordEvent(event)) return
    // session/event dispatch follows list() or session/created seeding.
    /** 中文说明：变量 trace 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const trace = cloneTraceForEvent(traces.get(session) as WorkflowTrace, event, fail)
    applyEvent(trace, event, fail)
    staged.set(event, { session, trace })
  }, { global: true })
  ctx.on('session/event', (session, event) => {
    if (!isWorkflowRecordEvent(event)) return
    /** 中文说明：变量 candidate 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const candidate = staged.get(event)
    /* v8 ignore next 2 -- internal/dispatch stages the exact session/event callback arguments. */
    if (candidate === undefined || candidate.session !== session) {
      return fail('session/event reached publication without matching workflow-record validation')
    }
    staged.delete(event)
    traces.set(session, candidate.trace)
  }, { global: true })
}, { inject: ['sessions'] })

/** Register this package's invariant companion. */
/* 中文说明：函数值 apply 封装本模块的局部步骤；参数和返回值由右侧签名约束；示例见本模块调用。 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
