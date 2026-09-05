/**
 * Surface layer on top of the session event log: an ordered view of events
 * that produce LLM messages. The append-only log remains the source of truth.
 *
 * Browser-safe: web clients consume this subpath export, so it must stay free
 * of `node:` imports (they break the vite bundle).
 *
 * @module @deepseek-ai/dsh-session/surface
 */

/*
 * 【文件职责】从追加式日志维护有序模型消息表面，处理追加和替换；
 * 此模块可在浏览器使用，不能依赖 Node 运行时。
 */

import type { Message } from '@deepseek-ai/dsh-llm'
import { SessionLogOffset, SessionSeq } from './types.ts'
import type {
  SessionEvent,
  SessionSeqCursor,
  SurfaceEvent,
  SurfaceEventType,
  SurfaceOp,
} from './types.ts'

/** Runtime counterpart of the message-producing event union. */
// 产生消息的事件联合的运行时对应集合（与 types.ts 中的 SurfaceEventType 保持一致）。
const SURFACE_EVENT_TYPES = new Set<string>([
  'user/message',
  'assistant/message',
  'tool/result',
])

/**
 * Whether an event type can join the model-visible surface.
 * @param type - event type to test.
 * @returns true for one of the three message-producing event types.
 */
/*
 * 判断一个事件类型是否允许进入模型可见表面。
 * @param type - 待判断的事件类型字符串。
 * @returns 是三种产生消息的事件类型之一时为 true。
 */
export function isSurfaceEligibleType(type: string): boolean {
  return SURFACE_EVENT_TYPES.has(type)
}

/**
 * Narrow an event to a surface-eligible event carrying its required marker.
 * @param event - event to test.
 * @returns true when both the type and marker identify a surface event.
 */
/*
 * 把事件收窄为“带必需标记的表面合格事件”：类型与 surfaceOp 标记两者齐备才算表面事件。
 * @param event - 待判断的事件。
 * @returns 类型与标记都能确认时为 true（此时参数类型收窄为 SurfaceEvent）。
 */
export function isSurfaceEvent(event: SessionEvent): event is SurfaceEvent {
  if (!SURFACE_EVENT_TYPES.has(event.type)) return false
  return (event as SessionEvent<SurfaceEventType>).surfaceOp !== undefined
}

/**
 * Narrow an event to an append-origin surface event: one that entered the
 * surface at its own log position and was never itself a replacement copy.
 *
 * The model-visible surface deliberately shadows replaced ranges, so it is the
 * wrong source for a human transcript — a landed replacement would erase
 * conversation the user already saw. Append-origin events are that transcript's
 * durable source material; replacement copies stay model-only.
 * @param event - event to test.
 * @returns true when the event appended to the surface tail.
 */
/*
 * 收窄为“追加式”表面事件：在自己的日志位置进入表面、且从未充当替换副本的事件。
 * 模型可见表面刻意保留被替换区间的“影子”，因此不适合做人读转录——一次落地替换会
 * 抹掉用户已经看过的对话；追加来源事件才是人类转录的耐久素材，替换副本只供模型使用。
 * @param event - 待判断的事件。
 * @returns 事件以尾部追加方式进入表面时为 true。
 */
export function isAppendSurfaceEvent(
  event: SessionEvent,
): event is SurfaceEvent & { surfaceOp: 'append' } {
  return isSurfaceEvent(event) && event.surfaceOp === 'append'
}

/**
 * Narrow an event to a surface replacement: a node that shadowed an existing
 * surface range instead of appending to the tail. The counterpart of
 * {@link isAppendSurfaceEvent} over the two {@link SurfaceOp} variants.
 * @param event - event to test.
 * @returns true when the event replaced a surface range.
 */
/*
 * 收窄为“替换式”表面节点：遮蔽了既有表面区间而非追加到尾部的事件，
 * 是 {@link isAppendSurfaceEvent} 在两个 {@link SurfaceOp} 变体上的对应面。
 * @param event - 待判断的事件。
 * @returns 事件替换了某个表面区间时为 true。
 */
export function isReplacementSurfaceEvent(
  event: SessionEvent,
): event is SurfaceEvent & { surfaceOp: Extract<SurfaceOp, { op: 'replace' }> } {
  return isSurfaceEvent(event) && event.surfaceOp !== 'append'
}

/**
 * Project a single event into the LLM message it derives to, or null when it
 * produces none — a non-surface event (attempt, boundary, log-only record) or an
 * empty-content assistant/message (which exists only to host usage). This is
 * THE per-node projection rule: `Session.deriveMessages` folds it over the
 * live surface, external reconstructors and pure projections fold the same
 * function over a log prefix's surface to rebuild the exact messages any
 * request was built from. The returned message is the already frozen message
 * nested in the event wrapper and shared by delivery, durable history, and
 * model requests.
 * @param event - the event to project.
 * @returns the derived message, or null when the event produces none.
 */
/*
 * 把单个事件投影为它派生出的 LLM 消息；不产生消息时返回 null——非表面事件
 * （chunk、边界标记、纯日志记录）以及空内容的 assistant/message（只为承载 usage 存在）
 * 都属于此类。这是唯一的“单节点投影规则”：Session.deriveMessages 在活跃表面上折叠它，
 * 外部重建器与纯投影对日志前缀的表面折叠同一函数，从而重建出任意请求当时的确切消息。
 * 返回的消息就是事件内那个已冻结的消息对象，投递、耐久历史与模型请求共享同一个实例。
 * @param event - 要投影的事件。
 * @returns 派生出的消息；该事件不产生消息时为 null。
 */
export function deriveEventMessage(event: SessionEvent): Message | null {
  // Intentionally non-exhaustive: only message-producing events derive
  // history; turn/step boundaries, failed attempts, and errors are trace/replay
  // data.
  // 有意不穷举：只有产生消息的事件才派生历史；turn/step 边界、chunk、usage 与错误属于追踪/重放数据。
  switch (event.type) {
    // Ordinary prompts and injected context project in user role: the event's
    // model-facing content stays verbatim. Do NOT re-add per-type framing
    // (e.g. `<context>`) here: framing is caller-owned — a producer bakes it
    // into `content`, as agent-instructions does with `<system-reminder>` — or,
    // if reintroduced, must be driven by the event `meta` map and a dedicated
    // renderer, keeping this projection a verbatim pass-through. See the
    // deferred design note in
    // ../../../../.agents/notes/implemented/simplification/2026-07-20-unwrap-injected-content-envelopes.md
    // 普通提示与注入上下文都以 user 角色原样投影；不要在这里按事件类型再加包装（如 <context>）——
    // 包装归生产者自带（烤进 content），或由事件 meta 表加专用渲染器负责，保持此处为原样透传。
    case 'user/message': {
      return event.data
    }
    case 'assistant/message': {
      // Skip an empty-content assistant/message: it exists only to host a
      // max-tokens step's usage and must not inject a content-less assistant
      // turn into the provider transcript.
      // 跳过空内容的 assistant/message：它只为承载 max-tokens 步骤的 usage 而存在，
      // 不能向提供方转录注入一条没有内容的助手轮。
      if (event.data.message.content.length === 0) return null
      return event.data.message
    }
    case 'tool/result': {
      return event.data.message
    }
    default:
      // A non-surface event (boundary, attempt, log-only record) projects to
      // no message. Merge-extensible union: no assertNever here.
      // 非表面事件（边界标记、chunk、纯日志记录）不投影出消息。可合并扩展联合：此处不用 assertNever。
      return null
  }
}

/** One replacement operation observed while folding a session surface. */
/* 折叠会话表面过程中观察到的一次替换操作。 */
export interface SurfaceFoldReplacement {
  /** Seq of the event that replaced the prior surface range. */
  seq: SessionSeq
  /** Declared inclusive start seq of the replaced surface range. */
  start: SessionSeq
  /** Declared inclusive end seq of the replaced surface range. */
  end: SessionSeq
  /** Actual surface entries removed by the operation, in surface order. */
  shadowedSeqs: SessionSeq[]
}

/** Complete result of replaying the surface operations in a session log. */
/* 重放一段会话日志中全部表面操作的完整结果。 */
export interface SurfaceFoldResult {
  /** Current surface event sequences in model-visible order. */
  nodes: SessionSeq[]
  /** Replacement operations in event order. */
  /* 按事件顺序排列的替换操作列表。 */
  replacements: SurfaceFoldReplacement[]
}

/** Readonly live projection of the message-producing session events. */
/* 产生消息的会话事件的只读活跃投影（对外接口）。 */
export interface SessionSurface {
  /** Current surface event sequences in model-visible order. */
  readonly nodes: readonly SessionSeq[]
  /** Monotonic count of committed positional replacements. */
  /* 已提交位置替换的单调计数；变化即表示表面发生过改写，派生缓存需重建。 */
  readonly replaceGeneration: number
}

/** Mutable state shared by complete and incremental folds. */
/* 完整折叠与增量折叠共享的可变内部状态。 */
interface SurfaceFoldState {
  nodes: SessionSeq[]
  replaceGeneration: number
}

/** A validated replacement transition that has not mutated fold state yet. */
/* 已通过校验、尚未改动折叠状态的替换过渡计划。 */
interface SurfaceReplacePlan extends SurfaceFoldReplacement {
  kind: 'replace'
  // 被替换区间在当前 nodes 数组中的起始下标。
  startIdx: number
  // 被替换区间在当前 nodes 数组中的结束下标。
  endIdx: number
}

/** One validated surface transition that has not mutated fold state yet. */
/* 一种已校验、尚未改动状态的表面过渡：追加或替换。 */
type SurfacePlan =
  | { kind: 'append'; seq: SessionSeq }
  | SurfaceReplacePlan

/** Create an empty surface fold state. */
/* 创建一个空的表面折叠状态。 */
function createFoldState(): SurfaceFoldState {
  return { nodes: [], replaceGeneration: 0 }
}

/** Whether a runtime value is a non-negative safe event sequence. */
function isEventSeq(value: unknown): value is SessionSeq {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 0
    && !Object.is(value, -0)
}

/** Whether a runtime value is the exact positional-replacement shape. */
/* 判断运行时值是否恰好是位置替换操作的结构（op/start/end 三键、值类型正确）。 */
function isReplaceOp(value: object): value is Extract<SurfaceOp, { op: 'replace' }> {
  const op = value as Record<string, unknown>
  return Object.keys(op).length === 3
    && Object.hasOwn(op, 'op')
    && Object.hasOwn(op, 'start')
    && Object.hasOwn(op, 'end')
    && op['op'] === 'replace'
    && isEventSeq(op['start'])
    && isEventSeq(op['end'])
}

/** Validate event-local surface eligibility and return its operation. */
/* 校验单个事件的表面资格并返回其表面操作：非表面事件携带标记、表面合格事件缺标记、标记形状非法都会抛错。 */
function surfaceOpOf(event: SessionEvent): SurfaceOp | undefined {
  const raw = event as SessionEvent & { surfaceOp?: unknown; sourceEventSeqs?: unknown }
  if (!isSurfaceEligibleType(event.type)) {
    if (raw.surfaceOp !== undefined) {
      throw new Error(`session event "${event.type}" is not surface-eligible and cannot carry surfaceOp`)
    }
    if (raw.sourceEventSeqs !== undefined) {
      throw new Error(`session event "${event.type}" is not surface-eligible and cannot carry sourceEventSeqs`)
    }
    return
  }
  const op = raw.surfaceOp
  if (op === undefined) {
    throw new Error(`session event "${event.type}" is surface-eligible and requires a surfaceOp marker`)
  }
  if (op === 'append') return op
  if (op === null || typeof op !== 'object' || Array.isArray(op)) {
    throw new Error(`session event "${event.type}" carries an invalid surfaceOp`)
  }
  if (!isReplaceOp(op)) {
    throw new Error(`session event "${event.type}" carries an invalid replace surfaceOp`)
  }
  return op
}

/** Validate cited source-event seqs against prior log entries and the replacement range. */
/* 对照先前日志条目与替换区间，校验事件引用的源事件 seq：必须是更早事件的非重复安全整数集合；替换时还必须覆盖全部被遮蔽节点。 */
function assertProvenance(
  event: SessionEvent,
  shadowedSeqs: readonly SessionSeq[],
): void {
  const raw = (event as SessionEvent & { sourceEventSeqs?: unknown }).sourceEventSeqs
  if (event.type === 'assistant/message' && raw !== undefined) {
    throw new Error('assistant/message embeds its source stream and cannot carry sourceEventSeqs')
  }
  const sources = new Set<SessionSeq>()
  if (raw !== undefined) {
    if (!Array.isArray(raw)) {
      throw new Error(`sourceEventSeqs on event at seq ${event.seq} must be an array when present`)
    }
    if (raw.length === 0) {
      throw new Error('sourceEventSeqs must not be empty')
    }
    let nonEarlierSource: SessionSeq | undefined
    for (const source of raw) {
      if (!isEventSeq(source)) {
        throw new Error(`session event "${event.type}" sourceEventSeqs must densely contain non-negative safe integers`)
      }
      sources.add(source)
      if (nonEarlierSource === undefined && source >= event.seq) nonEarlierSource = source
    }
    if (sources.size !== raw.length) {
      throw new Error('sourceEventSeqs must not contain duplicates')
    }
    if (nonEarlierSource !== undefined) {
      throw new Error(`sourceEventSeqs must reference earlier events: ${nonEarlierSource} >= current seq ${event.seq}`)
    }
  }
  // 被遮蔽但未被引用的节点 seq：非空即校验失败。
  const missing = shadowedSeqs.filter(seq => !sources.has(seq))
  if (missing.length > 0) {
    throw new Error(`surface replace: sourceEventSeqs must include every shadowed surface node; missing ${missing.join(', ')}`)
  }
}

/** Locate one replacement range without mutating the current fold state. */
/* 在当前表面中定位替换区间的下标范围，不修改折叠状态；start/end 不存在或先后颠倒会抛错。 */
function replacementRange(
  state: SurfaceFoldState,
  op: Extract<SurfaceOp, { op: 'replace' }>,
): Pick<SurfaceReplacePlan, 'startIdx' | 'endIdx' | 'shadowedSeqs'> {
  const startIdx = state.nodes.indexOf(op.start)
  if (startIdx === -1) {
    throw new Error(`surface replace: start seq ${op.start} not found in surface`)
  }
  const endIdx = state.nodes.indexOf(op.end)
  if (endIdx === -1) {
    throw new Error(`surface replace: end seq ${op.end} not found in surface`)
  }
  if (startIdx > endIdx) {
    throw new Error(`surface replace: start seq ${op.start} (index ${startIdx}) is after end seq ${op.end} (index ${endIdx})`)
  }
  return {
    startIdx,
    endIdx,
    shadowedSeqs: state.nodes.slice(startIdx, endIdx + 1),
  }
}

/**
 * Deep structural equality over the session-event JSON value domain
 * (null/boolean/number/string, arrays, plain objects). Replaces
 * `node:util`'s isDeepStrictEqual to keep this module browser-safe.
 */
/*
 * 会话事件 JSON 值域（null/布尔/数字/字符串、数组、普通对象）上的深结构相等比较。
 * 自行实现以替代 node:util 的 isDeepStrictEqual，保持本模块浏览器可用。
 */
function isDeepEqualJson(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((item, i) => isDeepEqualJson(item, b[i]))
  }
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  const aKeys = Object.keys(a)
  const bRecord = b as Record<string, unknown>
  if (aKeys.length !== Object.keys(b).length) return false
  return aKeys.every(key => Object.hasOwn(b, key) && isDeepEqualJson((a as Record<string, unknown>)[key], bRecord[key]))
}

/** Restrict a tool-result replacement to one current result's content. */
/* 限制 tool/result 的替换：只能改写当前某一个 tool/result，且除 content 内容本身外其余部分必须与原事件完全一致。 */
function assertToolResultRewrite(
  event: SessionEvent,
  shadowedSeqs: readonly SessionSeq[],
  events: readonly SessionEvent[],
  baseSeq: SessionLogOffset,
): void {
  if (event.type !== 'tool/result') return
  if (shadowedSeqs.length !== 1) {
    throw new Error('tool/result surface replacement must rewrite exactly one current node')
  }
  for (const originalSeq of shadowedSeqs) {
    // originalSeq 是绝对 seq；减去窗口基点得到数组下标。
    const original = events[originalSeq - baseSeq]
    if (original?.type !== 'tool/result') {
      throw new Error('tool/result surface replacement must target a current tool/result')
    }
    const originalRest = { ...original.data } as Record<string, unknown>
    const replacementRest = { ...event.data } as Record<string, unknown>
    const originalResult = original.data.message.content[0]
    const replacementResult = event.data.message.content[0]
    originalRest['message'] = {
      ...original.data.message,
      content: [{ ...originalResult, content: null }],
    }
    replacementRest['message'] = {
      ...event.data.message,
      content: [{ ...replacementResult, content: null }],
    }
    if (!isDeepEqualJson(originalRest, replacementRest)) {
      throw new Error('tool/result surface replacement may change only content')
    }
  }
}

/** Validate one event at its replay boundary and prepare its atomic fold transition. */
/* 在重放边界处校验一个事件并准备其原子折叠过渡计划（不改动状态）；seq 不连续立即抛错。 */
function planSurfaceEvent(
  state: SurfaceFoldState,
  event: SessionEvent,
  expectedSeq: SessionSeq,
  events: readonly SessionEvent[],
  baseSeq: SessionLogOffset,
): SurfacePlan | undefined {
  if (event.seq !== expectedSeq) {
    throw new Error(`session event seq ${event.seq} is not contiguous; expected ${expectedSeq}`)
  }
  const surfaceOp = surfaceOpOf(event)
  if (surfaceOp === undefined) return
  if (surfaceOp === 'append') {
    assertProvenance(event, [])
    return { kind: 'append', seq: event.seq }
  }
  const range = replacementRange(state, surfaceOp)
  assertProvenance(event, range.shadowedSeqs)
  assertToolResultRewrite(event, range.shadowedSeqs, events, baseSeq)
  return {
    kind: 'replace',
    seq: event.seq,
    start: surfaceOp.start,
    end: surfaceOp.end,
    ...range,
  }
}

/** Apply one event and return replacement metadata only when one occurred. */
/* 应用一个事件：先规划（校验）再提交；发生替换时返回其元数据。 */
function applySurfaceEvent(
  state: SurfaceFoldState,
  event: SessionEvent,
  expectedSeq: SessionSeq,
  events: readonly SessionEvent[],
  baseSeq: SessionLogOffset,
): SurfaceFoldReplacement | undefined {
  const plan = planSurfaceEvent(state, event, expectedSeq, events, baseSeq)
  return applySurfacePlan(state, plan)
}

/** Commit one previously validated surface transition. */
/* 提交一个此前已校验的表面过渡：追加即推入尾部队列；替换即执行 splice 并递增 replaceGeneration。 */
function applySurfacePlan(
  state: SurfaceFoldState,
  plan: SurfacePlan | undefined,
): SurfaceFoldReplacement | undefined {
  if (plan?.kind === 'append') {
    state.nodes.push(plan.seq)
  } else if (plan?.kind === 'replace') {
    state.nodes.splice(plan.startIdx, plan.endIdx - plan.startIdx + 1, plan.seq)
    state.replaceGeneration += 1
  }
  if (plan?.kind !== 'replace') return
  return {
    seq: plan.seq,
    start: plan.start,
    end: plan.end,
    shadowedSeqs: plan.shadowedSeqs,
  }
}

/**
 * Replay a complete session log through the canonical surface fold.
 * @param events - session events in contiguous seq order.
 * @returns detached current sequences and replacement history.
 * @throws when an event violates surface metadata, source-event references, range, or tool-result rewrite rules.
 */
/*
 * 把一份完整会话日志重放经过规范的表面折叠。
 * @param events - 按连续 seq 顺序排列的会话事件。
 * @returns 分离的当前表面 seq 列表与替换历史。
 * @throws 任一事件违反表面元数据、源事件引用、区间或 tool/result 改写规则时抛出。
 */
export function foldSurface(events: readonly SessionEvent[]): SurfaceFoldResult {
  const state = createFoldState()
  // 收集过程中发生的每次替换，随结果一并返回。
  const replacements: SurfaceFoldReplacement[] = []
  for (const [index, event] of events.entries()) {
    const replacement = applySurfaceEvent(
      state,
      event,
      SessionSeq(index),
      events,
      SessionLogOffset(0),
    )
    if (replacement !== undefined) replacements.push(replacement)
  }
  return { nodes: [...state.nodes], replacements }
}

/** Incremental ordered surface view and append-boundary validator. */
/*
 * 增量维护的有序表面视图，兼作“追加边界”的校验器。
 * 内部持有日志窗口的引用：读取 nodes/replaceGeneration 或 validateNext 时，
 * 会先把自上次访问以来新追加进日志的事件折叠掉，再执行本次操作。
 */
export class SurfaceManager implements SessionSurface {
  /** Shared transition state; replacement history is not retained. */
  // 共享的折叠过渡状态；不保留替换历史。
  private _state = createFoldState()
  /** Last processed absolute seq. */
  private _lastProcessedSeq: SessionSeqCursor
  /** Candidate already validated by `validateNext`, pending exact log admission. */
  private _pendingPlan: { event: SessionEvent; expectedSeq: SessionSeq; plan: SurfacePlan | undefined } | undefined

  /**
   * @param log - Contiguous complete log or loaded event window.
   * @param baseSeq - Absolute sequence of the window's first event.
   */
  /*
   * @param log - 连续完整的日志，或已加载的事件窗口。
   * @param baseSeq - 窗口第一个事件的绝对 seq。
   */
  constructor(
    private log: readonly SessionEvent[],
    private readonly baseSeq: SessionLogOffset = SessionLogOffset(0),
  ) {
    this._lastProcessedSeq = baseSeq === 0 ? -1 : SessionSeq(baseSeq - 1)
  }

  /**
   * Validate the next candidate without mutating the committed surface.
   * @param event - candidate event that has not entered the log yet.
   */
  /*
   * 校验下一个候选事件但不提交：先折叠日志新尾部，再按“即将写入的位置”规划过渡并存入 _pendingPlan，
   * 待该事件真正进入日志时由 _processDelta 复用这份计划，避免重复校验。
   * @param event - 尚未进入日志的候选事件。
   */
  validateNext(event: SessionEvent): void {
    if (this._lastProcessedSeq < this.baseSeq + this.log.length - 1) this._processDelta()
    const expectedSeq = SessionSeq(this.baseSeq + this.log.length)
    this._pendingPlan = {
      event,
      expectedSeq,
      plan: planSurfaceEvent(this._state, event, expectedSeq, this.log, this.baseSeq),
    }
  }

  /** Monotonic count of folded positional replacements. */
  /* 已折叠的位置替换的单调计数。 */
  get replaceGeneration(): number {
    if (this._lastProcessedSeq < this.baseSeq + this.log.length - 1) this._processDelta()
    return this._state.replaceGeneration
  }

  /** Surface event sequences in model-visible order. */
  get nodes(): readonly SessionSeq[] {
    if (this._lastProcessedSeq < this.baseSeq + this.log.length - 1) this._processDelta()
    return this._state.nodes
  }

  /** Fold events appended since the previous access. */
  /* 折叠自上次访问以来追加进日志的事件；优先消费 validateNext 预留的 pending 计划，避免重复校验。 */
  private _processDelta(): void {
    const tailSeq = this.baseSeq + this.log.length - 1
    for (let seq = this._lastProcessedSeq + 1; seq <= tailSeq; seq++) {
      const index = seq - this.baseSeq
      // oxlint-disable-next-line typescript/no-non-null-assertion -- bounded by the loop condition
      const event = this.log[index]!
      const pending = this._pendingPlan
      if (pending?.event === event && pending.expectedSeq === seq) {
        applySurfacePlan(this._state, pending.plan)
      } else {
        applySurfaceEvent(this._state, event, SessionSeq(seq), this.log, this.baseSeq)
      }
      if (pending !== undefined && pending.expectedSeq <= seq) this._pendingPlan = undefined
      this._lastProcessedSeq = SessionSeq(seq)
    }
  }
}
