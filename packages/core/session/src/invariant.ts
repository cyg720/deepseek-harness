/**
 * Package-owned relational invariants for the session event log. Load this
 * companion beside `@deepseek-ai/dsh-invariants` to enable the checks.
 *
 * @module @deepseek-ai/dsh-session/invariant
 */

/*
 * ================================ 文件注释 ================================
 * 【文件职责】session 包的关系不变量伴随插件：对会话事件日志执行跨事件的关系校验——seq 严格递增、
 *           turn/step 编号连续且正确嵌套、tool/result 必须有同步骤内先行的 tool/call（除非是崩溃
 *           修复的合成结果）、核心执行事件必须被轮次包围等。
 * 【技术维度】“预校验—暂存—提交后套用”的两阶段设计：internal/dispatch 阶段做纯校验并暂存过渡，
 *            session/event 发布阶段才真正改动 trace；WeakMap 按会话/事件弱关联状态（会话销毁即回收）；
 *            判别联合 switch + assertNever 兜底；可合并扩展事件类型走放行的 default 分支。
 * 【产品维度】日志是权威事实来源：一旦写入违反关系的垃圾事件，重放、fork、持久化都会被污染。
 *            此插件把不变量违例变成即时、明确的失败报告，而不是日后难以排查的静默损坏。
 * 【逻辑维度】SessionTrace 记录每个会话的游标状态；validateEvent 纯校验并产出
 *            SessionTraceTransition；applyTransition 在事件提交后套用；install 对存量会话全量补
 *            种子，监听 session/created 建新 trace、internal/dispatch 暂存校验、session/event 消费暂存；
 *            apply 完成注册。
 * 【关键边界】需同时具备 invariants 与 sessions 服务；session/event 若找不到匹配的预校验暂存会直接
 *            fail（说明发布未经校验路径）；session/end-seed 不受轮次约束（不平衡的种子可合法停在开轮次内）；
 *            插件自有事件的关系归插件自己管。
 * 【新手阅读建议】先读 SessionTrace/SessionTraceTransition 两个结构体理解“校验不改状态”的拆分，
 *            再通读 validateEvent 的 switch 看每类事件的关系规则，最后看 install 的几个挂点如何协作。
 * ==========================================================================
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { assertNever } from '@deepseek-ai/dsh-util-values'
import { TOOL_NOT_STARTED } from './repair.ts'

const PACKAGE_NAME = '@deepseek-ai/dsh-session'

/** Cordis companion plugin name. */
export const name = 'session-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** Per-session bookkeeping for relational log checks. */
interface SessionTrace {
  lastSeq: number
  openTurn: number | null
  openStep: number | null
  nextTurn: number
  nextStep: number
  pendingCalls: Set<ToolCallId>
}

/** One accepted event's deferred mutation of a committed session trace. */
interface SessionTraceTransition {
  scalars: Pick<SessionTrace, 'lastSeq' | 'openTurn' | 'openStep' | 'nextTurn' | 'nextStep'>
  pendingCalls:
    | { kind: 'none' }
    | { kind: 'add' | 'delete'; callId: ToolCallId }
    | { kind: 'clear' }
}

/** Assert that a step-scoped event names the currently open turn and step. */
function requireOpenStep(
  trace: SessionTrace,
  kind: string,
  turn: number,
  step: number,
  fail: InvariantFailure,
): void {
  if (trace.openTurn !== turn || trace.openStep !== step) {
    fail(`${kind} names turn ${turn}/step ${step} but open is turn ${trace.openTurn}/step ${trace.openStep}`)
  }
}

/** Validate one candidate event without mutating the committed trace. */
function validateEvent(
  trace: SessionTrace,
  event: SessionEvent,
  fail: InvariantFailure,
): SessionTraceTransition {
  if (event.seq <= trace.lastSeq) {
    fail(`seq must strictly increase: saw ${event.seq} after ${trace.lastSeq}`)
  }
  let openTurn = trace.openTurn
  let openStep = trace.openStep
  let nextTurn = trace.nextTurn
  let nextStep = trace.nextStep
  let pendingCalls: SessionTraceTransition['pendingCalls'] = { kind: 'none' }

  // Context and plugin-owned log-only events may be appended between model
  // executions. Core execution events retain their explicit turn relations.
  switch (event.type) {
    case 'turn/start': {
      if (trace.openTurn !== null) {
        fail(`turn/start ${event.data.turn} while turn ${trace.openTurn} is still open`)
      }
      if (event.data.turn !== trace.nextTurn) {
        fail(`turn/start expected turn ${trace.nextTurn}, got ${event.data.turn}`)
      }
      openTurn = event.data.turn
      nextStep = 1
      break
    }
    case 'turn/end': {
      if (trace.openTurn !== event.data.turn) {
        fail(`turn/end ${event.data.turn} does not match open turn ${trace.openTurn}`)
      }
      if (trace.openStep !== null) {
        fail(`turn/end ${event.data.turn} while step ${trace.openStep} is still open`)
      }
      openTurn = null
      nextTurn += 1
      break
    }
    case 'step/start': {
      if (trace.openTurn !== event.data.turn) {
        fail(`step/start in turn ${event.data.turn} but open turn is ${trace.openTurn}`)
      }
      if (trace.openStep !== null) {
        fail(`step/start ${event.data.step} while step ${trace.openStep} is still open`)
      }
      if (event.data.step !== trace.nextStep) {
        fail(`step/start expected step ${trace.nextStep} in turn ${event.data.turn}, got ${event.data.step}`)
      }
      openStep = event.data.step
      break
    }
    case 'step/end': {
      requireOpenStep(trace, 'step/end', event.data.turn, event.data.step, fail)
      pendingCalls = { kind: 'clear' }
      openStep = null
      nextStep += 1
      break
    }
    case 'assistant/chunk': {
      requireOpenStep(trace, 'assistant/chunk', event.data.turn, event.data.step, fail)
      break
    }
    case 'assistant/message': {
      requireOpenStep(trace, 'assistant/message', event.data.turn, event.data.step, fail)
      break
    }
    case 'tool/call': {
      requireOpenStep(trace, 'tool/call', event.data.turn, event.data.step, fail)
      pendingCalls = { kind: 'add', callId: event.data.callId }
      break
    }
    case 'tool/result': {
      // Session has already validated a content rewrite that cites its replaced event.
      // It is durable turn work, not a second execution of the original call.
      if (event.surfaceOp !== 'append') {
        if (trace.openTurn === null) {
          fail('tool/result surface replacement appended outside any open turn')
        }
        break
      }
      requireOpenStep(trace, 'tool/result', event.data.turn, event.data.step, fail)
      const callId = event.data.message.source.callId
      const syntheticNotStarted = event.data.message.content[0].isError === true && event.data.error?.code === TOOL_NOT_STARTED
      if (!trace.pendingCalls.has(callId) && !syntheticNotStarted) {
        fail(`tool/result for ${callId} with no prior tool/call in this step`)
      }
      pendingCalls = { kind: 'delete', callId }
      break
    }
    case 'user/message':
      break
    case 'session/end-seed':
      // Unconstrained: an unbalanced seed legally puts it inside an open turn.
      break
    case 'request/header':
    case 'request/context': {
      if (trace.openTurn === null) {
        fail(`${event.type} appended outside any open turn (core execution events must be turn-enclosed)`)
      }
      break
    }
    default:
      // Merge-extensible event relations belong to their owning plugin.
      break
  }
  return {
    scalars: { lastSeq: event.seq, openTurn, openStep, nextTurn, nextStep },
    pendingCalls,
  }
}

/** Apply one already-validated transition after its event commits. */
function applyTransition(trace: SessionTrace, transition: SessionTraceTransition): void {
  Object.assign(trace, transition.scalars)
  switch (transition.pendingCalls.kind) {
    case 'none':
      break
    case 'add':
      trace.pendingCalls.add(transition.pendingCalls.callId)
      break
    case 'delete':
      trace.pendingCalls.delete(transition.pendingCalls.callId)
      break
    case 'clear':
      trace.pendingCalls.clear()
      break
    /* v8 ignore next -- validateEvent produces this closed transition union */
    default:
      assertNever(transition.pendingCalls, 'session trace pending-call transition')
  }
}

/** Install the session contribution into its child registration fiber. */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  const traces = new WeakMap<Session, SessionTrace>()
  const stagedTransitions = new WeakMap<SessionEvent, {
    session: Session
    trace: SessionTrace
    transition: SessionTraceTransition
  }>()

  const freshTrace = (): SessionTrace => ({
    lastSeq: -1,
    openTurn: null,
    openStep: null,
    nextTurn: 1,
    nextStep: 1,
    pendingCalls: new Set(),
  })

  const seedSession = (session: Session): SessionTrace => {
    const trace = freshTrace()
    traces.set(session, trace)
    for (const event of session.events) {
      applyTransition(trace, validateEvent(trace, event, fail))
    }
    return trace
  }

  /* v8 ignore next -- session/event always follows list() or session/created seeding */
  const traceFor = (session: Session): SessionTrace => traces.get(session) ?? seedSession(session)

  for (const session of ctx.sessions.list()) seedSession(session)

  ctx.on('session/created', (session) => { seedSession(session) }, { global: true })

  ctx.on('session/event', (session, event) => {
    const staged = stagedTransitions.get(event)
    /* v8 ignore next 2 -- internal/dispatch stages the exact callback arguments */
    if (staged === undefined || staged.session !== session) {
      return fail('session/event reached publication without matching pre-commit validation')
    }
    stagedTransitions.delete(event)
    applyTransition(staged.trace, staged.transition)
  }, { global: true })

  ctx.on('internal/dispatch', (_mode, eventName, args) => {
    if (eventName !== 'session/event') return
    const [session, event] = args as [Session, SessionEvent]
    const trace = traceFor(session)
    const transition = validateEvent(trace, event, fail)
    // A later dispatch listener may veto. Validation is pure, so abandoning
    // this weakly keyed transition does not advance or retain the session.
    stagedTransitions.set(event, { session, trace, transition })
  }, { global: true })
}, { inject: ['sessions'] })

/**
 * Register the session invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
