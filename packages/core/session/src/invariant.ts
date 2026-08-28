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
import { assertNever } from '@deepseek-ai/dsh-llm'
import type { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { TOOL_NOT_STARTED } from './repair.ts'

// 向 invariants 服务注册包所有权时使用的包名。
const PACKAGE_NAME = '@deepseek-ai/dsh-session'

/** Cordis companion plugin name. */
// Cordis 伴随插件的注册名。
export const name = 'session-invariant'
/** Service required before the companion can reserve package ownership. */
// 前置依赖：invariants 服务就绪后，本伴随才能预约包所有权。
export const inject = ['invariants']

/** Per-session bookkeeping for relational log checks. */
/* 单个会话的关系校验簿记状态。 */
interface SessionTrace {
  // 已见的最大事件 seq。
  lastSeq: number
  // 当前开着的轮次号；null 表示没有开放。
  openTurn: number | null
  // 当前开着的步骤号；null 表示没有开放。
  openStep: number | null
  // 期望的下一个轮次号。
  nextTurn: number
  // 期望的下一个步骤号。
  nextStep: number
  pendingCalls: Set<ToolCallId>
}

/** One accepted event's deferred mutation of a committed session trace. */
/* 一个已接受事件对已提交 trace 的延迟改动（校验通过后才套用）。 */
interface SessionTraceTransition {
  // 标量游标的整体替换值。
  scalars: Pick<SessionTrace, 'lastSeq' | 'openTurn' | 'openStep' | 'nextTurn' | 'nextStep'>
  // 对 pendingCalls 的动作：不动 / 增 / 删 / 清空。
  pendingCalls:
    | { kind: 'none' }
    | { kind: 'add' | 'delete'; callId: ToolCallId }
    | { kind: 'clear' }
}

/** Assert that a step-scoped event names the currently open turn and step. */
/* 断言一个步骤级事件所指的 turn/step 恰是当前开着的那个，否则经 fail 上报。 */
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
/* 校验一个候选事件但不改动已提交的 trace：返回它获批后的延迟过渡。seq 不递增、编号错乱、调用无出处等都经 fail 上报。 */
function validateEvent(
  trace: SessionTrace,
  event: SessionEvent,
  fail: InvariantFailure,
): SessionTraceTransition {
  if (event.seq <= trace.lastSeq) {
    fail(`seq must strictly increase: saw ${event.seq} after ${trace.lastSeq}`)
  }
  // 候选过渡的草稿值：全部通过后才由 applyTransition 一次性生效。
  let openTurn = trace.openTurn
  let openStep = trace.openStep
  let nextTurn = trace.nextTurn
  let nextStep = trace.nextStep
  let pendingCalls: SessionTraceTransition['pendingCalls'] = { kind: 'none' }

  // Context and plugin-owned log-only events may be appended between model
  // executions. Core execution events retain their explicit turn relations.
  // 上下文与插件自有的纯日志事件可以插在模型执行之间；核心执行事件则保持显式的轮次关系。
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
      // Session 已校验过“引用了被替换事件”的内容改写。这是持久的轮内工作，不是对原调用的第二次执行。
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
      // 不约束：不平衡的种子可以合法地把它留在开着的轮次内。
      break
    case 'request/header':
    case 'request/context': {
      // 这些核心执行事件必须落在某个开着的轮次之内。
      if (trace.openTurn === null) {
        fail(`${event.type} appended outside any open turn (core execution events must be turn-enclosed)`)
      }
      break
    }
    default:
      // Merge-extensible event relations belong to their owning plugin.
      // 可合并扩展事件的关系归其所属插件负责。
      break
  }
  return {
    scalars: { lastSeq: event.seq, openTurn, openStep, nextTurn, nextStep },
    pendingCalls,
  }
}

/** Apply one already-validated transition after its event commits. */
/* 在事件提交后，把一个已校验的过渡一次性套用到 trace 上。 */
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
/* 把会话校验贡献安装进其子注册 fiber：为存量会话补建 trace，并挂三个全局监听点。 */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  // 会话 → 校验 trace 的弱映射：会话销毁即随之回收。
  const traces = new WeakMap<Session, SessionTrace>()
  // 事件 → 预校验暂存的弱映射：dispatch 阶段写入，publication 阶段取出套用。
  const stagedTransitions = new WeakMap<SessionEvent, {
    session: Session
    trace: SessionTrace
    transition: SessionTraceTransition
  }>()

  // 新会话的初始游标：无开轮次，期望第 1 轮第 1 步，lastSeq 从 -1 起便于首事件比较。
  const freshTrace = (): SessionTrace => ({
    lastSeq: -1,
    openTurn: null,
    openStep: null,
    nextTurn: 1,
    nextStep: 1,
    pendingCalls: new Set(),
  })

  // 对一个会话的既有事件全量补跑校验，建立初始 trace。
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
    // 更晚的分发监听器可能否决这次发布。校验是纯的，因此放弃这条弱键暂存
    // 既不会推进也不会滞留该会话。
    stagedTransitions.set(event, { session, trace, transition })
  }, { global: true })
}, { inject: ['sessions'] })

/**
 * Register the session invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
/*
 * 注册 session 的不变量伴随插件。
 * @param ctx - 携带 invariants 服务的 Cordis 上下文。
 * @returns 设置成功后该注册的 disposer。
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
