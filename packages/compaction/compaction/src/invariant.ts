/** Package-owned compaction log-stream invariants. @module @deepseek-ai/dsh-compaction/invariant */

/*
 * 【文件职责】检查压缩事务在持久日志中的关联关系，确保开始、摘要及结束记录满足领域约定。
 */

import type { Context } from '@deepseek-ai/cordis'
import { isReplacementSurfaceEvent, SessionSeq } from '@deepseek-ai/dsh-session'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { SurfaceManager } from '@deepseek-ai/dsh-session/surface'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type { CompactionId } from './brand.ts'
import { isCompactCheckpointSource } from './checkpoint.ts'
import type { CompactionCheckpointSource } from './checkpoint.ts'
import type {} from './types.ts'

/** 中文说明：上下文局部值 PACKAGE_NAME，由紧邻初始化决定。 */
const PACKAGE_NAME = '@deepseek-ai/dsh-compaction'

/** Cordis companion plugin name. */
/* 中文说明：上下文局部值 name，由紧邻初始化决定。 */
export const name = 'compaction-invariant'
/** Service required before the companion can reserve package ownership. */
/* 中文说明：上下文局部值 inject，由紧邻初始化决定。 */
export const inject = ['invariants']

/** 中文说明：类型或类 CompactionTrace 约束上下文或压缩数据职责。 */
interface CompactionTrace {
  compactionId: CompactionId
  sourceCommandId: string | undefined
  startSeq: SessionSeq
  turn: number | null
  summarized: boolean
}

/** 中文说明：类型或类 SessionTrace 约束上下文或压缩数据职责。 */
interface SessionTrace {
  openTurn: number | null
  compaction: CompactionTrace | undefined
  surfaceEvents: SessionEvent[]
  surface: SurfaceManager
}

/** 中文说明：类型或类 CompactionTransition 约束上下文或压缩数据职责。 */
type CompactionTransition =
  | { kind: 'start'; compactionId: CompactionId; sourceCommandId: string | undefined; startSeq: SessionSeq; turn: number | null }
  | { kind: 'summary'; compactionId: CompactionId; sourceCommandId: string | undefined; startSeq: SessionSeq; turn: number | null }
  | { kind: 'end' }
  | { kind: 'end-seed' }

/** Require a durable opaque identity to be a non-empty string. */
/* 中文说明：函数 validateId 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function validateId(value: unknown, label: string, fail: InvariantFailure): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) fail(`${label} must be a non-empty string`)
}

/** Validate a durable event-sequence identity at this package's event boundary. */
function validateSeq(value: unknown, label: string, fail: InvariantFailure): SessionSeq {
  if (typeof value !== 'number') return fail(`${label} must be a non-negative safe integer event seq`)
  try {
    return SessionSeq(value)
  } catch {
    return fail(`${label} must be a non-negative safe integer event seq`)
  }
}

/** Validate one shadowed surface span and its complete ordered identity list. */
function validateShadowedSeqs(
  trace: SessionTrace,
  event: SessionEvent<'compaction/summary' | 'compaction/prune'>,
  fail: InvariantFailure,
): void {
  const eventType = event.type
  const { data } = event
  const start = validateSeq(data.shadowedRange.start, `${eventType} shadowedRange.start`, fail)
  const end = validateSeq(data.shadowedRange.end, `${eventType} shadowedRange.end`, fail)
  const seqs = data.shadowedSeqs.map((seq, index) => validateSeq(seq, `${eventType} shadowedSeqs[${index}]`, fail))
  if (seqs.length === 0) fail(`${eventType} shadowedSeqs must be non-empty`)
  if (seqs[0] !== start || seqs.at(-1) !== end) {
    fail(`${eventType} shadowedRange must match the first and last shadowedSeqs`)
  }
  const surface = trace.surface.nodes
  const startIndex = surface.indexOf(start)
  const endIndex = surface.indexOf(end)
  if (startIndex < 0 || endIndex < startIndex) {
    fail(`${eventType} shadowed seqs must name an earlier current surface span`)
  }
  const expected = surface.slice(startIndex, endIndex + 1)
  if (expected.length !== seqs.length
    || expected.some((seq, index) => seq !== seqs[index])) {
    fail(`${eventType} shadowedSeqs must list every node in the current surface span`)
  }
}

/** Keep the optional initiating command identity stable across one transaction. */
/* 中文说明：函数 validateSourceCommandId 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function validateSourceCommandId(
  eventType: string,
  value: unknown,
  expected: string | undefined,
  fail: InvariantFailure,
): void {
  if (value !== undefined) validateId(value, `${eventType} sourceCommandId`, fail)
  if (value !== expected) {
    fail(`${eventType} sourceCommandId ${String(value)} does not match compaction/start sourceCommandId ${String(expected)}`)
  }
}

/** Validate one replacement checkpoint against its open compaction transaction. */
/* 中文说明：函数 validateCheckpoint 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function validateCheckpoint(
  trace: SessionTrace,
  event: SessionEvent<'user/message'>,
  fail: InvariantFailure,
): void {
  /** 中文说明：上下文局部值 source，由紧邻初始化决定。 */
  const source = event.data.source as typeof event.data.source & Partial<CompactionCheckpointSource>
  validateId(source.compactionId, 'compaction checkpoint compactionId', fail)
  if (source.sourceCommandId !== undefined) {
    validateId(source.sourceCommandId, 'compaction checkpoint sourceCommandId', fail)
  }
  /** 中文说明：上下文局部值 open，由紧邻初始化决定。 */
  const open = trace.compaction
  if (open === undefined) fail('compaction checkpoint has no matching compaction/start')
  if (source.compactionId !== open.compactionId) {
    fail(`compaction checkpoint id ${source.compactionId} does not match compaction/start id ${open.compactionId}`)
  }
  validateSourceCommandId('compaction checkpoint', source.sourceCommandId, open.sourceCommandId, fail)
}

/** Compaction starts still unmatched when a later seed boundary made them stale. */
/* 中文说明：函数 inheritedOrphanStartSeqs 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function inheritedOrphanStartSeqs(
  events: readonly SessionEvent[],
): ReadonlySet<SessionSeq> {
  const stale = new Set<SessionSeq>()
  let openStartSeq: SessionSeq | undefined
  for (const event of events) {
    if (event.type === 'compaction/start') {
      openStartSeq = event.seq
    } else if (event.type === 'compaction/end') {
      openStartSeq = undefined
    } else if (event.type === 'session/end-seed') {
      if (openStartSeq !== undefined) stale.add(openStartSeq)
      openStartSeq = undefined
    }
  }
  return stale
}

/** Keep every live compaction bracket on one side of each turn boundary. */
/* 中文说明：函数 validateTurnBoundary 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function validateTurnBoundary(
  trace: SessionTrace,
  event: SessionEvent,
  fail: InvariantFailure,
): void {
  if (
    (event.type !== 'turn/start' && event.type !== 'turn/end')
    || trace.compaction === undefined
  ) return
  /** 中文说明：上下文局部值 owner，由紧邻初始化决定。 */
  const owner = trace.compaction.turn === null
    ? 'standalone compaction'
    : `compaction for turn ${trace.compaction.turn}`
  fail(`${event.type} cannot cross an open ${owner}`)
}

/** Advance the committed turn cursor after its boundary has been accepted. */
/* 中文说明：函数 applyTurnBoundary 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function applyTurnBoundary(trace: SessionTrace, event: SessionEvent): boolean {
  if (event.type === 'turn/start') {
    trace.openTurn = event.data.turn
    return true
  }
  if (event.type === 'turn/end') {
    trace.openTurn = null
    return true
  }
  return false
}

/** Require a numbered bracket inside its exact turn, or a standalone bracket between turns. */
/* 中文说明：函数 validateOwner 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function validateOwner(
  owner: number | null,
  openTurn: number | null,
  eventType: 'compaction/start' | 'compaction/summary' | 'compaction/end',
  fail: InvariantFailure,
): void {
  if (owner === null) {
    if (openTurn !== null) fail(`${eventType} is standalone but turn ${openTurn} is open`)
    return
  }
  if (openTurn === null) fail(`${eventType} for turn ${owner} appended outside any open turn`)
  if (owner !== openTurn) fail(`${eventType} names turn ${owner} but open turn is ${openTurn}`)
}

/** Validate one compaction event without advancing committed trace state. */
/* 中文说明：函数 validateCompactionEvent 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function validateCompactionEvent(
  trace: SessionTrace,
  event: SessionEvent,
  fail: InvariantFailure,
): CompactionTransition | undefined {
  if (event.type === 'session/end-seed') return { kind: 'end-seed' }
  if (event.type === 'compaction/prune') {
    validateShadowedSeqs(trace, event, fail)
    return undefined
  }
  if (event.type === 'user/message'
    && isReplacementSurfaceEvent(event)
    && isCompactCheckpointSource(event.data.source)) {
    validateCheckpoint(trace, event, fail)
    return undefined
  }
  if (event.type !== 'compaction/start' && event.type !== 'compaction/summary' && event.type !== 'compaction/end') {
    return undefined
  }
  /** 中文说明：上下文局部值 open，由紧邻初始化决定。 */
  const open = trace.compaction
  if (event.type === 'compaction/start') {
    validateId(event.data.compactionId, 'compaction/start compactionId', fail)
    if (event.data.sourceCommandId !== undefined) {
      validateId(event.data.sourceCommandId, 'compaction/start sourceCommandId', fail)
    }
    if (open !== undefined) {
      /** 中文说明：上下文局部值 owner，由紧邻初始化决定。 */
      const owner = open.turn === null ? 'standalone compaction' : `turn ${open.turn}`
      fail(`compaction/start while ${owner} is still compacting`)
    }
    validateOwner(event.data.turn, trace.openTurn, event.type, fail)
    return {
      kind: 'start',
      compactionId: event.data.compactionId,
      sourceCommandId: event.data.sourceCommandId,
      startSeq: event.seq,
      turn: event.data.turn,
    }
  }
  if (event.type === 'compaction/summary') {
    validateId(event.data.compactionId, 'compaction/summary compactionId', fail)
    if (event.data.sourceCommandId !== undefined) {
      validateId(event.data.sourceCommandId, 'compaction/summary sourceCommandId', fail)
    }
    if (open === undefined) fail('compaction/summary has no matching compaction/start')
    if (event.data.compactionId !== open.compactionId) {
      fail(`compaction/summary id ${event.data.compactionId} does not match compaction/start id ${open.compactionId}`)
    }
    validateSourceCommandId('compaction/summary', event.data.sourceCommandId, open.sourceCommandId, fail)
    validateOwner(open.turn, trace.openTurn, event.type, fail)
    if (open.summarized) fail('compaction/summary repeated within one compaction')
    validateShadowedSeqs(trace, event, fail)
    if (!Number.isSafeInteger(event.data.shadowedTokenCount) || event.data.shadowedTokenCount < 0) {
      fail('compaction/summary shadowedTokenCount must be a non-negative safe integer')
    }
    return {
      kind: 'summary',
      compactionId: open.compactionId,
      sourceCommandId: open.sourceCommandId,
      startSeq: open.startSeq,
      turn: open.turn,
    }
  }
  validateId(event.data.compactionId, 'compaction/end compactionId', fail)
  if (event.data.sourceCommandId !== undefined) {
    validateId(event.data.sourceCommandId, 'compaction/end sourceCommandId', fail)
  }
  if (open === undefined) fail('compaction/end has no matching compaction/start')
  if (event.data.compactionId !== open.compactionId) {
    fail(`compaction/end id ${event.data.compactionId} does not match compaction/start id ${open.compactionId}`)
  }
  validateSourceCommandId('compaction/end', event.data.sourceCommandId, open.sourceCommandId, fail)
  if (event.data.turn !== open.turn) {
    fail(`compaction/end owner ${String(event.data.turn)} does not match compaction/start owner ${String(open.turn)}`)
  }
  validateOwner(open.turn, trace.openTurn, event.type, fail)
  if (event.data.error === undefined && !open.summarized) {
    fail('successful compaction/end requires one compaction/summary')
  }
  return { kind: 'end' }
}

/** Apply one committed compaction transition. */
/* 中文说明：函数 applyCompactionTransition 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function applyCompactionTransition(
  transition: CompactionTransition,
): CompactionTrace | undefined {
  if (transition.kind === 'start') {
    return {
      compactionId: transition.compactionId,
      sourceCommandId: transition.sourceCommandId,
      startSeq: transition.startSeq,
      turn: transition.turn,
      summarized: false,
    }
  }
  if (transition.kind === 'summary') {
    return {
      compactionId: transition.compactionId,
      sourceCommandId: transition.sourceCommandId,
      startSeq: transition.startSeq,
      turn: transition.turn,
      summarized: true,
    }
  }
  return undefined
}

/** Install compaction start/summary/end checks. */
// Event owners keep precommit staging local so their vocabularies never move into a central helper.
/* jscpd:ignore-start */
/** 中文说明：上下文局部值 install，由紧邻初始化决定。 */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  /** 中文说明：上下文局部值 traces，由紧邻初始化决定。 */
  const traces = new WeakMap<Session, SessionTrace>()
  /** 中文说明：上下文局部值 staged，由紧邻初始化决定。 */
  const staged = new WeakMap<SessionEvent, { session: Session; transition: CompactionTransition }>()
  /** 中文说明：上下文局部值 seed，由紧邻初始化决定。 */
  const seed = (session: Session): SessionTrace => {
    const surfaceEvents: SessionEvent[] = []
    const trace: SessionTrace = {
      openTurn: null,
      compaction: undefined,
      surfaceEvents,
      surface: new SurfaceManager(surfaceEvents),
    }
    traces.set(session, trace)
    const events = session.snapshotEvents()
    const staleOrphanStartSeqs = inheritedOrphanStartSeqs(events)
    for (const event of events) {
      // Constructor-seed repair boundaries can precede the end-seed marker
      // that proves an inherited orphan stale. Replay that inherited prefix
      // without letting the soon-to-be-cleared bracket veto its repair.
      if (
        trace.compaction === undefined
        || !staleOrphanStartSeqs.has(trace.compaction.startSeq)
      ) {
        validateTurnBoundary(trace, event, fail)
      }
      /** 中文说明：上下文局部值 transition，由紧邻初始化决定。 */
      const transition = validateCompactionEvent(trace, event, fail)
      if (transition !== undefined) trace.compaction = applyCompactionTransition(transition)
      applyTurnBoundary(trace, event)
      trace.surfaceEvents.push(event)
    }
    return trace
  }
  /** 中文说明：上下文局部值 traceFor，由紧邻初始化决定。 */
  const traceFor = (session: Session): SessionTrace => traces.get(session) ?? seed(session)

  /** 中文说明：上下文局部值 session，由紧邻初始化决定。 */
  for (const session of ctx.sessions.list()) seed(session)
  ctx.on('session/created', (session) => { seed(session) }, { global: true })
  ctx.on('session/event', (session, event) => {
    /** 中文说明：上下文局部值 trace，由紧邻初始化决定。 */
    const trace = traceFor(session)
    validateTurnBoundary(trace, event, fail)
    const changedTurn = applyTurnBoundary(trace, event)
    if (!changedTurn && event.type !== 'session/end-seed'
      && event.type !== 'compaction/start'
      && event.type !== 'compaction/summary'
      && event.type !== 'compaction/end') {
      trace.surfaceEvents.push(event)
      return
    }
    if (!changedTurn) {
      const candidate = staged.get(event)
      /* v8 ignore next -- internal/dispatch stages every compaction event */
      if (candidate === undefined || candidate.session !== session) return fail('compaction event published without pre-commit validation')
      staged.delete(event)
      trace.compaction = applyCompactionTransition(candidate.transition)
    }
    trace.surfaceEvents.push(event)
  }, { global: true })
  ctx.on('internal/dispatch', (_mode, eventName, args) => {
    if (eventName !== 'session/event') return
    /** 中文说明：上下文局部值 [session, event]，由紧邻初始化决定。 */
    const [session, event] = args as [Session, SessionEvent]
    /** 中文说明：上下文局部值 trace，由紧邻初始化决定。 */
    const trace = traceFor(session)
    validateTurnBoundary(trace, event, fail)
    /** 中文说明：上下文局部值 transition，由紧邻初始化决定。 */
    const transition = validateCompactionEvent(trace, event, fail)
    if (transition !== undefined) staged.set(event, { session, transition })
  }, { global: true })
}, { inject: ['sessions'] })
/* jscpd:ignore-end */

/**
 * Register the compact invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
/* 中文说明：上下文局部值 apply，由紧邻初始化决定。 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
