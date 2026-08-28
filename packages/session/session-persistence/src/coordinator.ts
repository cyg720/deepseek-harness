/*
 * ================================ 文件注释 ================================
 * 【文件职责】实现"与具体存储无关"的会话写入/读取编排器 PersistenceCoordinator：
 *   第一方后端（如 JSONL）只需提供最底层的存取原语（PersistenceBackend 接口），
 *   缓冲、序列化、旧格式迁移、崩溃修复、按 id 串行化、释放清理等全部由本文件统一
 *   编排；另含两个专用错误类型与格式版本拒绝文案。
 * 【技术维度】事件溯源日志的追加写 + 按 id 的 Promise 链串行化（防并发交错）；
 *   写后缓冲（write-behind，见 write-behind.ts）；基于修订号的乐观并发控制（读/
 *   校验一个来回内日志未变才提交）；旧版事件词表的读取期迁移（migrate* 函数）；
 *   Cordis effect/on 监听会话生命周期。
 * 【产品维度】让每种持久化介质都能以最小成本接入同一套可靠语义：崩溃后日志可恢复、
 *   并发写不损坏、resume 结果确定，用户在不同后端间获得一致体验。
 * 【逻辑维度】按代码顺序：①默认参数常量与两个错误类；②格式拒绝文案函数；③协调器
 *   策略接口与存储结果结构 StoredPrefix/StoredSuffix；④PersistenceBackend 存储契约；
 *   ⑤私有记账结构与一批纯函数助手（校验、迁移、快照）；⑥PersistenceCoordinator
 *   类：公共 API（create/append/prepare/load/inspect/readFrom）、每 id 串行链、
 *   写路径监听安装、收养与修复逻辑。
 * 【关键边界】序列化后的公共方法之间绝不能互相调用（会死锁），只能调未串行化的
 *   *Core 助手；append 时未知事件类型故意不拒绝（只读侧才拒绝），避免打断进行中的
 *   会话；返回的事件图必须与后端结果完全脱钩（fresh/unaliased）。
 * 【新手阅读建议】先读 PersistenceBackend 接口理解"后端要提供什么"，再读类的公共
 *   API 与 serialize/installWritePath 理解主流程，最后按需查 migrate* 迁移函数和
 *   prepareCore→commitPrepared 的冷读-提交流水线。
 * ==========================================================================
 */
/**
 * Shared buffering, serialization, adoption, repair, and disposal orchestration
 * for first-party backends. Third-party backends may implement the public
 * persistence seam directly.
 * @module @deepseek-ai/dsh-session-persistence/coordinator
 */
/*
 * 【中文导读】上面英文概括本模块定位：为第一方后端提供共享的缓冲、序列化、收养
 * （把磁盘上已有日志接到内存会话）、修复与释放编排。第三方后端也可以绕过协调器、
 * 直接实现 index.ts 里的公共持久化接口。
 */

import { Context } from '@deepseek-ai/cordis'
import {
  adoptSessionEvent,
  interruptedTurnClosers,
  KNOWN_SESSION_EVENT_TYPES,
  SESSION_FORMAT_VERSION,
  SessionPreparation,
  snapshotJsonValue,
  snapshotSessionEvent,
} from '@deepseek-ai/dsh-session'
import type { Session, SessionEvent, SessionId, SessionHeader } from '@deepseek-ai/dsh-session'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import type { BorrowedSessionSource, SessionInspection, SessionLocation } from './index.ts'
import { SessionPersistenceNotFoundError } from './errors.ts'
import type { SessionPersistenceRevision } from './revision.ts'
import { observeQueuedAbort, SessionPreparations } from './preparations.ts'
import type { SessionPreparationReservation } from './preparations.ts'
import { SessionWriteBehind } from './write-behind.ts'

/** Default number of detached session preparations retained by a coordinator. */
// 默认保留的"已准备未发布会话"个数上限：resume 前预热的会话可缓存复用，5 个在
// 内存占用与重复冷读成本之间取得平衡。
export const DEFAULT_PREPARED_SESSION_CACHE_SIZE = 5

/** Default maximum intentional wait before a live session batch starts writing. */
// 默认的写合并窗口：活跃会话的事件先缓冲，最多等 200ms 攒一批再落盘，用少量延迟
// 换取更少的物理写次数（尤其对逐条 delta 事件的高频流式输出）。
export const DEFAULT_WRITE_BATCH_MAX_DELAY_MS = 200

/** Largest write batching delay accepted by Node's timer implementation. */
// 写合并窗口允许的上限 = Node 定时器能接受的最大延时（2^31-1 毫秒，setTimeout 硬限制），
// 用于构造参数校验。
export const MAX_WRITE_BATCH_DELAY_MS = MAX_TIMER_DELAY_MS

/** Durable session contents failed validation after a successful backend read. */
/*
 * 【中文】"损坏"错误：后端成功读出了字节，但内容没通过校验（seq 断档、JSON 解析
 * 失败、头信息非法等）。与下面的"格式不支持"相对——损坏意味着数据真的坏了，
 * 而不只是本程序读不懂。
 */
export class SessionPersistenceCorruptionError extends Error {
  /**
   * @param message - stable corruption context.
   * @param options - original validation failure.
   */
  /*
   * 【中文】构造损坏错误。
   * @param message - 稳定的损坏上下文描述。
   * @param options - 通过 cause 携带最初的校验失败原因，便于逐层排障。
   */
  constructor(message: string, options: ErrorOptions) {
    super(message, options)
    this.name = 'SessionPersistenceCorruptionError'
  }
}

/**
 * The stored log is intact but this runtime cannot faithfully interpret it:
 * the header carries an unsupported format version, or an event's type is
 * unknown to this build. Distinct from {@link SessionPersistenceCorruptionError}
 * — nothing is damaged; the raw log remains readable at {@link location} when
 * the backend keeps one artifact per session.
 */
/*
 * 【中文】"格式不支持"错误：磁盘日志本身完好，只是当前构建无法忠实解读——头信息
 * 带着本构建不认识的格式版本，或出现了未标记 ignorable 的未知事件类型。与损坏错误
 * 的本质区别：数据没坏，用户该看到的是"请升级 harness"，而不是"日志损坏"。若
 * 后端保留单会话工件，{@link location} 会指向原始日志供排查。
 */
export class SessionFormatUnsupportedError extends Error {
  /**
   * @param message - stable reason the log cannot be interpreted, already
   *   including the raw-log path when one exists.
   * @param location - the backend's artifact location, when one exists.
   */
  /*
   * 【中文】构造格式拒绝错误。
   * @param message - 无法解读日志的稳定原因（可能已附带原始日志路径）。
   * @param location - 后端工件位置（存在时才有），便于提示用户去哪里看原文。
   */
  constructor(message: string, readonly location?: SessionLocation) {
    super(message)
    this.name = 'SessionFormatUnsupportedError'
  }
}

/**
 * Direction-aware refusal text for a stored session whose format version this
 * build does not read. Shared by the coordinator's load-time check and by
 * backends that must refuse BEFORE decoding version-dependent structure (a
 * future format may not satisfy this build's structural checks at all, and the
 * user must see "upgrade the harness", never "corrupt").
 * @param id - the stored session id, for message context.
 * @param version - the stored format version.
 * @returns the stable refusal text, without a raw-log path suffix.
 */
/*
 * 【中文】按方向生成格式版本拒绝文案：存的版本比当前构建新 → 提示"升级 harness"；
 * 比当前构建旧 → 说明本构建没有旧版升级路径。协调器的加载检查与各后端的解码前
 * 预检共用此文案，保证用户在任何入口看到的说法一致。
 * @param id - 存储会话 id，用于文案上下文。
 * @param version - 存储的日志格式版本号。
 * @returns 稳定的拒绝文案（不含原始日志路径后缀）。
 */
export function sessionFormatVersionRefusal(id: string, version: number): string {
  // 版本更新：日志来自更新的 harness，唯一出路是升级本程序；版本更旧：明确告知无迁移路径。
  return version > SESSION_FORMAT_VERSION
    ? `session "${id}" uses log format v${version}, but this harness reads only v${SESSION_FORMAT_VERSION}: the log was written by a newer harness — upgrade the harness to open it`
    : `session "${id}" uses log format v${version}, older than the supported v${SESSION_FORMAT_VERSION}, and this build ships no upgrade path for it`
}

/** Coordinator policy supplied by a concrete persistence backend. */
/*
 * 【中文】协调器策略参数：由具体后端在构造协调器时给定。
 */
export interface PersistenceCoordinatorOptions {
  /** Maximum completed unpublished preparations retained for reuse. */
  /* 【中文】最多保留多少个"已完成、未发布"的准备会话供 resume 复用。 */
  readonly preparedSessionCacheSize: number
  /** Maximum intentional batching wait after an idle live queue receives work. */
  /* 【中文】空闲写队列收到新事件后，最多故意等多久再落盘（写合并窗口）。 */
  readonly writeBatchMaxDelayMs: number
}

/**
 * A stored session's header, valid contiguous event prefix, source-qualified
 * revision, and optional opaque torn-tail marker. The revision identifies the
 * exact detached prefix. The coordinator only checks marker presence and
 * returns its value to {@link PersistenceBackend.commitRepair}; each backend
 * owns the marker type.
 */
/*
 * 【中文】一次冷读得到的"已存前缀"：头信息 + 有效的连续事件前缀 + 标识这段前缀的
 * 修订号 + 可选的"残尾标记"。修订号精确对应这份前缀；协调器只检查 tornMarker
 * 是否存在并把原值传回 {@link PersistenceBackend.commitRepair}，标记的具体类型由
 * 每个后端自己定义（对 JSONL 是截断字节偏移等）。
 */
export interface StoredPrefix<TornMarker = unknown> {
  meta: SessionHeader
  events: SessionEvent[]
  /** Revision observed for exactly this detached prefix. */
  /* 【中文】读取时观察到的、恰好对应这份前缀的修订号。 */
  revision: SessionPersistenceRevision
  tornMarker?: TornMarker
}

/**
 * A stored session's header plus the events at or past a requested seq — the
 * return shape of the optional seek-capable
 * {@link PersistenceBackend.loadStoredFrom} hook. Non-mutating reads carry no
 * torn marker: there is nothing to repair.
 */
/*
 * 【中文】"已存后缀"：头信息 + 从请求 seq 起的已存事件，是可选的按位寻址读取钩子
 * {@link PersistenceBackend.loadStoredFrom} 的返回结构。纯读不改任何状态，因此
 * 没有残尾标记——没有需要修复的东西。
 */
export interface StoredSuffix {
  meta: SessionHeader
  events: SessionEvent[]
}

/**
 * The storage contract between {@link PersistenceCoordinator} and a concrete
 * backend: the minimal set of durable primitives the orchestration calls. A
 * backend implements these (over files, rows, an object store, …); the
 * coordinator supplies everything else (buffering, serialization, cursors,
 * adoption, crash repair sequencing, dispose quiescence).
 *
 * @typeParam TornMarker - the backend's opaque torn-tail repair token (see
 * {@link StoredPrefix}). The coordinator treats it as fully opaque.
 */
/*
 * 【中文】协调器与具体后端之间的存储契约：编排层所需的全部持久化原语的最小集合。
 * 后端负责实现这些原语（可以基于文件、数据库行、对象存储等）；其余一切（缓冲、
 * 序列化、游标推进、收养、崩溃修复时序、释放时的静默排空）都由协调器提供。
 * 泛型 TornMarker 是后端自定义的"残尾修复令牌"，对协调器完全 opaque（不透明）。
 */
export interface PersistenceBackend<TornMarker = unknown> {
  /** Human-readable backend name, used in the dispose-failure AggregateError. */
  /* 【中文】后端可读名称，用于释放失败的聚合错误信息。 */
  readonly name: string

  /**
   * Read a stored prefix by id, scanning every backend storage scope. Returns
   * `undefined` if no stored artifact exists. Returned metadata must identify
   * `id` before repair or state publication. Used by resume/load, live adoption,
   * and — via `!== undefined` — the create-collision probe. The returned
   * `tornMarker` is present iff there is a torn tail to truncate. Every header
   * and event graph must be fresh, mutually unaliased, and unretained by the
   * backend because preparation freezes and publishes them in place. The
   * returned revision must identify exactly those values and use the same
   * representation as {@link readStoredRevision}.
   * @param id - persisted session id to resolve.
   * @param signal - optional cancellation for backend read work.
   */
  /*
   * 【中文】按 id 读取"已存前缀"，要扫描后端的每一个存储作用域（如所有项目目录）；
   * 找不到返回 undefined。供 resume/load、活跃收养使用，也用 `!== undefined` 充当
   * 创建冲突探测。tornMarker 存在当且仅当有需要截断的残尾。关键要求：返回的头与
   * 事件图必须是全新的、互不别名、后端不再保留引用——因为准备流程会就地冻结并
   * 发布它们。revision 必须与 {@link readStoredRevision} 同一表示。
   * @param id - 要解析的已持久化会话 id。
   * @param signal - 可选取消信号。
   */
  loadStored(id: SessionId, signal?: AbortSignal): Promise<StoredPrefix<TornMarker> | undefined>

  /**
   * Read the current source-qualified revision for one stored session without
   * loading its event log. Returns `undefined` when the identity is absent.
   * @param id - persisted session id to observe.
   * @param signal - optional cancellation for backend read work.
   */
  /*
   * 【中文】只读某个已存会话当前的"来源限定修订号"，不加载事件日志。身份不存在时
   * 返回 undefined。用于廉价的"日志是否变了"检查（乐观并发控制的核心）。
   * @param id - 要观察的已持久化会话 id。
   * @param signal - 可选取消信号。
   */
  readStoredRevision(id: SessionId, signal?: AbortSignal): Promise<SessionPersistenceRevision | undefined>

  /**
   * Optional seek-capable suffix read behind the service's `readFrom`: return
   * the header plus the stored events with `seq >= fromSeq` without reading
   * the whole log. A backend whose medium can address events by seq (SQLite)
   * implements this so `readFrom` scales with the suffix; sequential backends
   * omit it and the coordinator falls back to {@link loadStored} plus a
   * forward skip. Non-mutating (no truncation, no closers). Validation of the
   * region strictly below `fromSeq` is limited to seq contiguity — the
   * service contract scopes this read to the suffix — unless that suffix
   * contains a supported legacy shape whose normalization needs earlier
   * message-identity facts, in which case the coordinator falls back
   * to the complete stored prefix.
   * Unknown-type refusal follows the same suffix scope: a seek-capable
   * backend's `readFrom` checks only the returned suffix, while the
   * sequential fallback parses the whole artifact and refuses on an unknown
   * required event anywhere in it — over-refusal on the sequential side is
   * accepted rather than widening the seek read.
   * @param id - persisted session id to resolve.
   * @param fromSeq - first event seq to include (non-negative safe integer,
   *   validated by the coordinator before this hook runs).
   * @param signal - optional cancellation for backend read work.
   */
  /*
   * 【中文】可选的"按 seq 寻址后缀读取"钩子（支撑服务的 readFrom）：只返回
   * seq >= fromSeq 的已存事件，不读全量。能按下标取行的介质（SQLite）实现它让
   * readFrom 随后缀规模伸缩；顺序介质的后端省略它，协调器会退回 {@link loadStored}
   * 全读再前跳。纯读不修复。fromSeq 以下区域只校验 seq 连续性；若后缀里有需要
   * 前文事实才能归一化的旧格式形状，协调器整体回退到完整前缀读取。
   * @param id - 要解析的已持久化会话 id。
   * @param fromSeq - 要包含的首个事件 seq（非负安全整数，协调器先校验）。
   * @param signal - 可选取消信号。
   */
  loadStoredFrom?(id: SessionId, fromSeq: number, signal?: AbortSignal): Promise<StoredSuffix | undefined>

  /** Durably create an empty header-only session artifact. */
  materializeHeader?(meta: SessionHeader): Promise<void>

  /**
   * Durably append a CONTIGUOUS batch, lazily materializing the session first
   * when `!isMaterialized`. The materialize-write and the first event batch MUST
   * commit ATOMICALLY (a crash between them must not leave a materialized-but-
   * empty session). Returns once the batch is durable.
   */
  /*
   * 【中文】把一批"连续"事件持久化追加；当 isMaterialized 为 false 时先惰性物化
   * 该会话。物化写与首个事件批必须原子提交——若两者之间崩溃，绝不能留下
   * "已物化但零事件"的空会话。本方法在批次落盘（durable）后才返回。
   * @param meta - 会话头信息。
   * @param events - 连续事件批次。
   * @param isMaterialized - 该会话是否已有持久化工件。
   */
  appendBatch(meta: SessionHeader, events: readonly SessionEvent[], isMaterialized: boolean): Promise<void>

  /**
   * Make a crash repair durable: truncate the torn tail (iff
   * `tornMarker !== undefined`) and append `closers` (iff any). NOT required to
   * be atomic — a file backend may truncate-then-append in two fsync'd steps.
   * Used by load (truncate + synthetic closers) and by live-adoption (truncate
   * only, `closers = []`).
   */
  /*
   * 【中文】把崩溃修复持久化：若给了 tornMarker 就截掉残尾，若给了 closers（合成
   * 收尾事件）就追加。不要求原子——文件后端可以"先截断、再追加"两步各自 fsync。
   * load 用它做"截断 + 合成收尾"；活跃收养只用它做"仅截断"（closers 为空）。
   */
  commitRepair(meta: SessionHeader, tornMarker: TornMarker | undefined, closers: readonly SessionEvent[]): Promise<void>

  /**
   * List all stored (materialized) sessions' metadata.
   * @param signal - optional cancellation for backend listing work.
   */
  /*
   * 【中文】列出所有已物化会话的头信息。
   * @param signal - 可选取消信号。
   */
  list(signal?: AbortSignal): Promise<SessionHeader[]>

  /**
   * Optional side-effect-free artifact locator, used to point refusal
   * diagnostics ({@link SessionFormatUnsupportedError}) at the raw log.
   * Backends without one artifact per session omit it or return `undefined`.
   * @param meta - the header whose artifact is requested.
   */
  /*
   * 【中文】可选的、无副作用的工件定位钩子：给 {@link SessionFormatUnsupportedError}
   * 之类的拒绝诊断指明原始日志位置。没有单会话工件的后端可省略或返回 undefined。
   * @param meta - 请求其工件位置的会话头。
   */
  locate?(meta: SessionHeader): SessionLocation | undefined

  /**
   * Optional lifecycle teardown (e.g. close a database handle). Awaited by the
   * coordinator's dispose effect AFTER the quiescence drain. A stateless file
   * backend omits it.
   */
  /*
   * 【中文】可选的生命周期收尾钩子（例如关闭数据库句柄）。协调器的 dispose effect
   * 会在"静默排空"完成之后再 await 它。无状态文件后端可省略。
   */
  close?(): Promise<void>
}

/** Per-session write state held by the coordinator's in-memory bookkeeping. */
/*
 * 【中文】协调器内存记账中的"每会话写状态"。注意它按会话 id 记账，与活跃 Session
 * 对象是两回事（活跃对象记在 live 表里）；owner 字段才把两者关联起来。
 */
interface SessionState {
  meta: SessionHeader
  /** The next seq the backend expects to append (the stored log length). */
  /* 【中文】后端期待的下一个 seq（等于已存日志长度），追加时据此校验连续性。 */
  cursor: number
  /**
   * Whether lazy creation has produced a durable artifact. The first append
   * atomically materializes the header with events; reclaim logic uses this to
   * distinguish an unused id from a persisted collision.
   */
  /*
   * 【中文】惰性创建是否已产生持久化工件。第一次 append 会把头与事件原子地物化；
   * 回收逻辑据此区分"登记过但从未写入的 id"（可回收）与"真的已持久化冲突"。
   */
  materialized: boolean
  /**
   * The live Session this state was bound to via `onCreated`, if any. State
   * created through the public `create()`/`load()` API has no owner; state bound
   * to a live session lets `onCreated` reject a second, unrelated session on the
   * same id (a collision) instead of silently no-opping.
   */
  /*
   * 【中文】通过 onCreated 绑定到本状态的活跃 Session（若有）。经由公共
   * create()/load() 建立的状态没有 owner；绑定了 owner 之后，若另一个不相干的
   * 会话复用同一 id，onCreated 能明确拒绝（冲突）而不是静默跳过。
   */
  owner?: Session
}

/** One live session's initialization and bounded write-behind controller. */
/*
 * 【中文】一个活跃会话的两件套：init 是初始化 Promise（首次创建/收养完成即落定），
 * writes 是该会话专属的写后缓冲控制器（见 write-behind.ts），负责攒批与排空。
 */
interface LiveSessionState {
  init: Promise<void>
  writes: SessionWriteBehind
}

/** One validated cold source and the exact unpublished Session built from it. */
/*
 * 【中文】一个"已校验的冷数据源"以及由它精确构建出的未发布 Session：检视视图、
 * 准备好的 Session、读取时的修订号、构建后的会话长度、残尾标记与合成收尾事件。
 * 协调器用它实现"读一次、多方复用"。
 */
interface PreparedSessionSource<TornMarker> {
  readonly inspection: SessionInspection
  readonly session: Session
  readonly revision: SessionPersistenceRevision
  /** Session length after constructor-owned seed markers were appended. */
  /* 【中文】构造器自有的种子标记追加完毕后的 Session 长度，用于判断是否可复用。 */
  readonly sessionLength: number
  readonly tornMarker: TornMarker | undefined
  readonly closers: readonly SessionEvent[]
}

/** Collect the rejection reasons from a set of promises (none-throwing). */
/*
 * 【中文】等一组 Promise 全部落定并收集所有被拒绝的原因；本身永不抛错。
 * 用于 dispose 时把多个会话的排空错误聚合成一个 AggregateError。
 * @param promises - 任意一组 Promise。
 * @returns 所有拒绝原因组成的数组（全部成功则为空数组）。
 */
async function settledErrors(promises: Iterable<Promise<unknown>>): Promise<unknown[]> {
  const settled = await Promise.allSettled([...promises])
  const errors: unknown[] = []
  for (const result of settled) {
    if (result.status === 'rejected') errors.push(result.reason)
  }
  return errors
}

/** Whether a live session seed reproduces a persisted prefix exactly. */
/*
 * 【中文】判断活跃会话的种子事件是否与已持久化前缀逐条一致（长度覆盖 + 逐条
 * JSON 字符串相等）。用于收养场景：确认"内存里的会话历史"与"磁盘上的前缀"
 * 讲的是同一段历史，防止错误地把两份不同日志缝在一起。
 * @param seed - 活跃会话的种子事件序列。
 * @param prefix - 磁盘上的已存事件前缀。
 * @returns 完全复现返回 true，否则 false。
 */
function seedCoversPrefix(seed: readonly SessionEvent[], prefix: readonly SessionEvent[]): boolean {
  return prefix.length <= seed.length
    && prefix.every((event, index) => {
      const seedEvent = seed[index]
      return seedEvent !== undefined && JSON.stringify(seedEvent) === JSON.stringify(event)
    })
}

/** Reject events from an obsolete v0 vocabulary that this build cannot replay. */
/*
 * 【中文】拒绝本构建已无法重放的旧版（v0）事件词表：request/header-delta、mode/set
 * 两种已删除的事件类型，以及 reason 为 "fallback" 的 request/header。写入侧与
 * 读取侧共用此守卫，保证"本后端拒读的形状也绝不被写入"。
 * @param events - 待检查的事件序列。
 * @param id - 所属会话 id，用于错误文案。
 */
function assertSupportedEvents(events: readonly SessionEvent[], id: SessionId): void {
  // 三类遗留形状逐一排查；命中即报错并指出具体 seq，方便定位问题日志行。
  const legacyType: string = 'request/header-delta'
  const legacy = events.find(event => event.type === legacyType)
  if (legacy !== undefined) {
    throw new Error(`session "${id}" contains unsupported legacy request/header-delta event at seq ${legacy.seq}`)
  }
  const legacyModeType: string = 'mode/set'
  const legacyMode = events.find(event => event.type === legacyModeType)
  if (legacyMode !== undefined) {
    throw new Error(`session "${id}" contains unsupported legacy mode/set event at seq ${legacyMode.seq}`)
  }
  const fallback = events.find(event => event.type === 'request/header'
    && (event.data as { reason?: string }).reason === 'fallback')
  if (fallback !== undefined) {
    throw new Error(`session "${id}" contains unsupported legacy request/header reason "fallback" at seq ${fallback.seq}`)
  }
}

/** Return an object record without widening arrays into message payloads. */
/*
 * 【中文】把值收窄为"普通对象记录"（非 null、非数组），否则返回 undefined。
 * 迁移代码用它安全地探查旧事件 data 的字段，而不会把数组误当消息载荷处理。
 * @param value - 任意待检查的值。
 * @returns 是普通对象时返回该记录，否则 undefined。
 */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

/** Whether a record contains every required key and no key outside the optional extension set. */
/*
 * 【中文】形状检查：记录必须含全部必填键，且不得出现"必填 + 可选"之外的键。
 * 迁移逻辑据此判断一个旧事件是否严格匹配某个已知的旧版信封，防止把畸形数据
 * 误升级成看似合法的当前格式。
 * @param record - 待检查的对象记录。
 * @param required - 必须存在的键名列表。
 * @param optional - 额外允许出现的键名列表（默认为空）。
 * @returns 形状完全吻合返回 true。
 */
function hasOnlyKeys(
  record: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const allowed = [...required, ...optional]
  return Object.keys(record).every(key => allowed.includes(key))
    && required.every(key => Object.hasOwn(record, key))
}

type PersistedMessageId = SessionEvent<'user/message'>['data']['id']
// 【中文】持久化消息 id 的类型别名：取自 user/message 事件 data 的 id 字段（品牌化
// 类型）。旧格式日志没有消息 id，迁移时按下面的函数规则补造一个稳定 id。

/** Mint the stable import identity for a message persisted before identities existed. */
/*
 * 【中文】为"身份机制出现之前"持久化的消息铸造稳定的导入身份：`legacy-message:
 * <会话id>:<seq>`。同一条日志每次读取都会得到同一个 id，因此跨进程、跨加载保持
 * 稳定，可安全用于消息替换等按 id 引用的场景。
 * @param id - 所属会话 id。
 * @param seq - 该消息事件在日志中的 seq。
 * @returns 合成的遗留消息 id。
 */
function legacyMessageId(id: SessionId, seq: number): PersistedMessageId {
  return `legacy-message:${id}:${seq}` as PersistedMessageId
}

/** Read a replacement target while leaving malformed surface metadata to the session validator. */
/*
 * 【中文】读取旧 tool/result 事件上的 surfaceOp.replace.start（消息替换目标位置），
 * 形状不对就返回 undefined——畸形的表面元数据交给会话校验器去报错，这里不越权。
 * @param event - 待检查的事件。
 * @returns 替换目标的起始序号；无法确认时为 undefined。
 */
function replacementStart(event: SessionEvent): number | undefined {
  const op = asRecord((event as SessionEvent & { surfaceOp?: unknown }).surfaceOp)
  return op?.['op'] === 'replace' && typeof op['start'] === 'number'
    ? op['start']
    : undefined
}

/** Whether one suffix event needs facts available only from the preceding stored prefix. */
/*
 * 【中文】判断一个"后缀事件"是否需要只有前缀里才有的旧事实才能归一化。命中情形：
 * 已删除的 steering/message 类型，或 user/message、assistant/message、tool/result
 * 缺少当前信封字段（id/message）却带着旧 content 字段的形状。readFrom 的寻址读取
 * 遇到这类事件时必须回退为全量前缀读取。
 * @param event - 待判断的事件。
 * @returns 需要前缀事实返回 true。
 */
function needsLegacyPrefix(event: SessionEvent): boolean {
  const data = asRecord(event.data)
  const legacySteeringType: string = 'steering/message'
  if (event.type === legacySteeringType) return true
  if (data === undefined) return false
  switch (event.type) {
    case 'user/message':
      return !Object.hasOwn(data, 'id') && Object.hasOwn(data, 'content')
    case 'assistant/message':
      return !Object.hasOwn(data, 'message') && Object.hasOwn(data, 'content')
    case 'tool/result':
      return !Object.hasOwn(data, 'message') && Object.hasOwn(data, 'callId')
    default:
      return false
  }
}

/** Upgrade the removed steering surface event into its current user-message equivalent. */
/*
 * 【中文】把已删除的 steering/message（旧"转向消息"表面事件）升级为等价的当前
 * user/message。兼容两种旧信封：message 包裹形与 turn+content+source 平铺形；
 * 两种都对不上就报畸形错误，绝不猜测。
 * @param event - 待迁移的事件。
 * @param id - 所属会话 id。
 * @returns 迁移后的事件（非 steering 类型原样返回）。
 */
function migrateLegacySteeringEvent(event: SessionEvent, id: SessionId): SessionEvent {
  const legacyType: string = 'steering/message'
  if (event.type !== legacyType) return event
  const data = asRecord(event.data)
  if (data === undefined) {
    throw new Error(`session "${id}" contains malformed pre-react-loop steering/message at seq ${event.seq}`)
  }
  const wrapped = asRecord(data['message'])
  if (wrapped !== undefined && Number.isSafeInteger(data['turn'])
    && hasOnlyKeys(data, ['turn', 'message'])) {
    return { ...event, type: 'user/message', data: wrapped } as SessionEvent
  }
  if (!Number.isSafeInteger(data['turn']) || !hasOnlyKeys(data, ['turn', 'content', 'source'])) {
    throw new Error(`session "${id}" contains malformed pre-react-loop steering/message at seq ${event.seq}`)
  }
  const { turn: _turn, ...message } = data
  return {
    ...event,
    type: 'user/message',
    data: {
      ...message,
      id: legacyMessageId(id, event.seq),
      role: 'user',
    },
  } as SessionEvent
}

/** Remove the obsolete trigger after verifying the complete old turn-start envelope. */
/*
 * 【中文】清理旧版 turn/start 事件里已废弃的 trigger 字段：先完整校验旧信封
 * （turn 正整数 + trigger.kind 非空字符串 + 无多余键），再剥掉 trigger 只留 turn。
 * 校验不过按畸形报错，保持"宁可拒绝也不误升级"。
 * @param event - 待迁移的事件。
 * @param id - 所属会话 id。
 * @returns 迁移后的事件（非旧形状原样返回）。
 */
function migrateLegacyTurnStartEvent(event: SessionEvent, id: SessionId): SessionEvent {
  if (event.type !== 'turn/start') return event
  const data = asRecord(event.data)
  if (data === undefined || !Object.hasOwn(data, 'trigger')) return event
  const trigger = asRecord(data['trigger'])
  if (!Number.isSafeInteger(data['turn']) || (data['turn'] as number) < 1
    || !hasOnlyKeys(data, ['turn', 'trigger'])
    || trigger === undefined || typeof trigger['kind'] !== 'string' || trigger['kind'].length === 0) {
    throw new Error(`session "${id}" contains malformed pre-react-loop turn/start at seq ${event.seq}`)
  }
  return { ...event, data: { turn: data['turn'] } } as SessionEvent
}

/** Upgrade an obsolete turn ending while preserving the latest-master envelope. */
/*
 * 【中文】把旧版 turn/end 的 reason 结构升级为当前信封：completed/blocked/max-tokens/
 * interrupted 保持不变；aborted 补上 { kind:'legacy' } 子原因；disposed 归一为
 * aborted+disposed；error 的多种旧形状（failure 对象或 message/code 平铺）统一为
 * { kind:'error', error }。任何形状对不上都按畸形报错。
 * @param event - 待迁移的事件。
 * @param id - 所属会话 id。
 * @returns 迁移后的事件。
 */
function migrateLegacyTurnEndEvent(event: SessionEvent, id: SessionId): SessionEvent {
  if (event.type !== 'turn/end') return event
  const data = asRecord(event.data)
  /* v8 ignore next -- a non-record current envelope cannot match a legacy shape. */
  if (data === undefined) return event
  // malformed() 是"报畸形错误"的简写助手，让下面各分支的失败路径保持一行。
  const malformed = (): never => {
    throw new Error(`session "${id}" contains malformed pre-react-loop turn/end at seq ${event.seq}`)
  }
  const reason = asRecord(data['reason'])
  if (!Number.isSafeInteger(data['turn']) || (data['turn'] as number) < 1
    || !hasOnlyKeys(data, ['turn', 'reason'])
    || reason === undefined || typeof reason['kind'] !== 'string') return malformed()

  let currentReason: Record<string, unknown> | undefined
  switch (reason['kind']) {
    case 'completed':
    case 'blocked':
    case 'max-tokens':
    case 'interrupted':
      if (!hasOnlyKeys(reason, ['kind'])) return malformed()
      return event
    case 'aborted':
      if (Object.hasOwn(reason, 'reason')) return event
      if (!hasOnlyKeys(reason, ['kind'])) return malformed()
      currentReason = { kind: 'aborted', reason: { kind: 'legacy' } }
      break
    case 'disposed':
      if (!hasOnlyKeys(reason, ['kind'])) return malformed()
      currentReason = { kind: 'aborted', reason: { kind: 'disposed' } }
      break
    case 'error': {
      if (Object.hasOwn(reason, 'error')) return event
      if (!Number.isSafeInteger(reason['step']) || (reason['step'] as number) < 0) return malformed()
      const failure = asRecord(reason['failure'])
      if (failure !== undefined && hasOnlyKeys(reason, ['kind', 'step', 'failure'])
        && hasOnlyKeys(failure, ['message', 'code'], ['status', 'providerRetryAfterMs', 'requestId'])
        && typeof failure['message'] === 'string' && typeof failure['code'] === 'string'
        && (failure['status'] === undefined || typeof failure['status'] === 'number')
        && (failure['providerRetryAfterMs'] === undefined || typeof failure['providerRetryAfterMs'] === 'number')
        && (failure['requestId'] === undefined || typeof failure['requestId'] === 'string')) {
        currentReason = { kind: 'error', error: failure }
        break
      }
      const messageKeys = reason['code'] === undefined
        ? ['kind', 'step', 'message']
        : ['kind', 'step', 'message', 'code']
      if (!hasOnlyKeys(reason, messageKeys)
        || typeof reason['message'] !== 'string'
        || (reason['code'] !== undefined && typeof reason['code'] !== 'string')) return malformed()
      currentReason = {
        kind: 'error',
        error: {
          message: reason['message'],
          code: typeof reason['code'] === 'string' ? reason['code'] : 'UNKNOWN',
        },
      }
      break
    }
    default:
      return event
  }

  return {
    ...event,
    data: {
      ...data,
      reason: currentReason,
    },
  } as SessionEvent
}

/**
 * Upgrade one pre-identity message event into the current wrapper shape.
 * Current-looking malformed events remain untouched so validation rejects them
 * instead of disguising corruption as legacy data.
 */
/*
 * 【中文】把"消息身份机制出现之前"的消息事件升级为当前包裹信封：
 * - user/message：补 id 与 role:'user'；
 * - assistant/message：content+provenance 包裹为 message{...}（source.kind='model'）；
 * - tool/result：callId/content/isError 包裹为 tool-result 消息；若它是一次"替换"
 *   （surfaceOp.replace），则继承被替换消息的 id，否则按 seq 造遗留 id。
 * 已经长得像当前格式的畸形事件保持原样——让校验器去拒绝，避免把损坏伪装成旧数据。
 * @param event - 待迁移的事件。
 * @param id - 所属会话 id。
 * @param messageIds - seq → 消息 id 的映射，用于替换场景继承 id。
 * @returns 迁移后的事件。
 */
function migrateLegacyMessageEvent(
  event: SessionEvent,
  id: SessionId,
  messageIds: ReadonlyMap<number, PersistedMessageId>,
): SessionEvent {
  const data = asRecord(event.data)
  if (data === undefined) return event
  switch (event.type) {
    case 'user/message': {
      if (Object.hasOwn(data, 'id') || Object.hasOwn(data, 'role')
        || Object.hasOwn(data, 'message')
        || !Object.hasOwn(data, 'content') || !Object.hasOwn(data, 'source')) return event
      return {
        ...event,
        data: {
          ...data,
          id: legacyMessageId(id, event.seq),
          role: 'user',
        },
      } as SessionEvent
    }
    case 'assistant/message': {
      if (Object.hasOwn(data, 'message')
        || !Object.hasOwn(data, 'content') || !Object.hasOwn(data, 'provenance')) return event
      const { content, provenance, ...eventData } = data
      return {
        ...event,
        data: {
          ...eventData,
          message: {
            id: legacyMessageId(id, event.seq),
            role: 'assistant',
            content,
            source: {
              ...asRecord(provenance),
              kind: 'model',
            },
          },
        },
      } as SessionEvent
    }
    case 'tool/result': {
      if (Object.hasOwn(data, 'message')
        || !Object.hasOwn(data, 'callId') || !Object.hasOwn(data, 'content')
        || !Object.hasOwn(data, 'isError')) return event
      const { callId, content, isError, ...eventData } = data
      const inheritedId = replacementStart(event)
      return {
        ...event,
        data: {
          ...eventData,
          message: {
            id: inheritedId === undefined
              ? legacyMessageId(id, event.seq)
              : messageIds.get(inheritedId),
            role: 'user',
            content: [{
              type: 'tool-result',
              toolCallId: callId,
              content,
              isError,
            }],
            source: {
              kind: 'tool',
              callId,
            },
          },
        },
      } as SessionEvent
    }
    default:
      return event
  }
}

/** Read the identified message carried by one validated current event. */
/*
 * 【中文】从一个"已迁移为当前格式"的事件里读出其携带的消息 id：user/message 的
 * data 本身就是消息；其余类型从 data.message 里取。取不到返回 undefined。
 * @param event - 当前格式的事件。
 * @returns 消息 id（存在时）。
 */
function eventMessageId(event: SessionEvent): PersistedMessageId | undefined {
  const data = asRecord(event.data)
  const message = event.type === 'user/message' ? data : asRecord(data?.['message'])
  return typeof message?.['id'] === 'string' ? message['id'] as PersistedMessageId : undefined
}

/** Materialize stored events as upgraded, validated snapshots with immutable messages. */
/*
 * 【中文】把磁盘上读出的事件序列整体"物化"：先拒绝不支持的旧词表，再逐条做旧格式
 * 迁移，最后 snapshotSessionEvent（深拷贝 + 校验 + 深冻结），产出全新的、不可变的
 * 事件数组。返回值与输入完全脱钩，调用方可安全持有。同时维护 seq→消息 id 映射供
 * 替换类迁移使用。
 * @param events - 从存储读出的事件。
 * @param id - 所属会话 id。
 * @returns 全新的事件快照数组。
 */
function snapshotStoredEvents(events: readonly SessionEvent[], id: SessionId): SessionEvent[] {
  assertSupportedEvents(events, id)
  // 逐条迁移并记录消息 id：后面的 tool/result 替换事件可能要引用前面消息的 id。
  const messageIds = new Map<number, PersistedMessageId>()
  return events.map((event) => {
    const migratedStart = migrateLegacyTurnStartEvent(event, id)
    const migratedTurn = migrateLegacyTurnEndEvent(migratedStart, id)
    const migratedSteering = migrateLegacySteeringEvent(migratedTurn, id)
    const snapshot = snapshotSessionEvent(migrateLegacyMessageEvent(migratedSteering, id, messageIds))
    const messageId = eventMessageId(snapshot)
    if (messageId !== undefined) messageIds.set(snapshot.seq, messageId)
    return snapshot
  })
}

/** Upgrade and validate an exclusively owned backend result without copying it. */
/*
 * 【中文】与 snapshotStoredEvents 类似的迁移 + 校验流水线，但采用"收养"（adopt）
 * 方式：直接在后端返回的数组上就地迁移、校验并深冻结，不额外拷贝——前提是调用方
 * 独占该结果（协调器契约保证后端不保留引用）。省一次深拷贝。
 * @param events - 后端返回的、本方独占的事件数组（将被就地改写）。
 * @param id - 所属会话 id。
 * @returns 同一数组引用，元素已迁移并冻结。
 */
function adoptStoredEvents(events: SessionEvent[], id: SessionId): SessionEvent[] {
  assertSupportedEvents(events, id)
  const messageIds = new Map<number, PersistedMessageId>()
  for (const [index, event] of events.entries()) {
    const migratedStart = migrateLegacyTurnStartEvent(event, id)
    const migratedTurn = migrateLegacyTurnEndEvent(migratedStart, id)
    const migratedSteering = migrateLegacySteeringEvent(migratedTurn, id)
    const adopted = adoptSessionEvent(migrateLegacyMessageEvent(migratedSteering, id, messageIds))
    events[index] = adopted
    const messageId = eventMessageId(adopted)
    if (messageId !== undefined) messageIds.set(adopted.seq, messageId)
  }
  return events
}

/**
 * Owns the backend-agnostic session write-path orchestration. A backend
 * constructs one (`new PersistenceCoordinator(ctx, this)`), implements
 * {@link PersistenceBackend}, and delegates its write/read service methods to
 * the matching coordinator methods.
 *
 * All per-id operations are serialized (a per-id promise chain) so concurrent
 * flushes / a flush racing a load never interleave storage writes. The
 * constructor installs the write-path listeners, per-session retirement, and
 * the backend dispose effect.
 *
 * @typeParam TornMarker - the backend's opaque torn-tail repair token.
 */
/*
 * 【中文】会话写路径的"总编排器"。具体后端 `new PersistenceCoordinator(ctx, this)`
 * 构造一个实例、实现 {@link PersistenceBackend}，再把自己服务的读写方法一一委托给
 * 协调器的同名方法即可。要点：
 * - 同一会话 id 的所有操作经 Promise 链串行化，并发 flush 与 flush/load 竞争绝不
 *   交错写存储；
 * - 构造时安装写路径监听（session/created、session/event、session/flush、
 *   session/disposed）、每会话退役逻辑与后端 dispose effect。
 */
export class PersistenceCoordinator<TornMarker = unknown> {
  /** Backend bookkeeping keyed by session id (NOT the live Session object). */
  /* 【中文】按会话 id 记账的后端状态表（键是 id，不是活跃 Session 对象）。 */
  private states = new Map<SessionId, SessionState>()
  /** Lifecycle and write-behind state keyed by the exact live Session. */
  /* 【中文】按活跃 Session 对象本身记账的生命周期与写后缓冲状态。 */
  private live = new Map<Session, LiveSessionState>()
  /** Exact disposed lifecycles whose buffered tail is still draining. */
  /* 【中文】已销毁、但缓冲尾仍在排空中的会话生命周期（id → 排空 Promise）。 */
  private retirements = new Map<SessionId, Promise<void>>()
  /** Shared cold reads, unpublished reservations, and completed LRU entries. */
  /* 【中文】共享冷读、未发布预留与已完成 LRU 的准备池（见 preparations.ts）。 */
  private readonly preparations: SessionPreparations<PreparedSessionSource<TornMarker>, SessionState>
  /**
   * Per-session serialization: every operation chains onto the prior one for the
   * same id, so writes for one session never interleave. Keyed by session id.
   */
  /*
   * 【中文】每会话串行链：同一 id 的操作依次链接在前一个之后，保证写入永不交错。
   * 键为会话 id。
   */
  private chains = new Map<SessionId, Promise<unknown>>()
  /** Resolved fixed write-batching window shared by per-session controllers. */
  /* 【中文】解析后的固定写合并窗口，供各会话的写控制器共享。 */
  private readonly writeBatchMaxDelayMs: number

  /**
   * 【中文】构造协调器：校验并固化策略参数、建准备池、安装写路径监听。
   * @param ctx - 宿主 Cordis 上下文。
   * @param backend - 本后端的存储原语实现。
   * @param options - 可选策略参数；缺省用 DEFAULT_* 常量。
   */
  constructor(
    private ctx: Context,
    private backend: PersistenceBackend<TornMarker>,
    options: PersistenceCoordinatorOptions = {
      preparedSessionCacheSize: DEFAULT_PREPARED_SESSION_CACHE_SIZE,
      writeBatchMaxDelayMs: DEFAULT_WRITE_BATCH_MAX_DELAY_MS,
    },
  ) {
    // 参数即契约：缓存容量必须是正整数；写窗口必须落在 1..MAX 区间内，否则快速失败。
    if (!Number.isSafeInteger(options.preparedSessionCacheSize)
      || options.preparedSessionCacheSize < 1) {
      throw new TypeError('preparedSessionCacheSize must be a positive safe integer')
    }
    if (!Number.isSafeInteger(options.writeBatchMaxDelayMs)
      || options.writeBatchMaxDelayMs < 1
      || options.writeBatchMaxDelayMs > MAX_WRITE_BATCH_DELAY_MS) {
      throw new TypeError(`writeBatchMaxDelayMs must be an integer between 1 and ${MAX_WRITE_BATCH_DELAY_MS}`)
    }
    this.writeBatchMaxDelayMs = options.writeBatchMaxDelayMs
    this.preparations = new SessionPreparations(options.preparedSessionCacheSize)
    this.installWritePath()
  }

  // --- Public API (the backend's service methods delegate here) ---

  /**
   * Register detached session metadata for lazy creation on the first append.
   * @param meta - header to snapshot; duplicate tracked or persisted ids reject.
   */
  /*
   * 【中文】登记一个"惰性创建"的会话：此刻只快照头信息记账，不落盘；第一次 append
   * 才真正物化。id 已在本后端记账/准备中、或磁盘上已有同 id 日志时都会拒绝。
   * @param meta - 要快照的头信息。
   * @returns 记账成功 resolve；重复 id reject。
   */
  create(meta: SessionHeader): Promise<void> {
    // Snapshot before queueing so caller mutation cannot diverge the key and header.
    // 先快照再排队：防止调用方在等待期间改写 meta，导致键与头信息不一致。
    const snapshot = snapshotJsonValue(meta)
    if (snapshot === undefined) {
      return Promise.reject(new TypeError('session metadata must be losslessly JSON-serializable'))
    }
    if (!Number.isSafeInteger(snapshot.createdAt) || snapshot.createdAt < 0) {
      return Promise.reject(new TypeError('session metadata createdAt must be a non-negative safe integer'))
    }
    return this.serialize(snapshot.id, () => this.createCore(snapshot))
  }

  /**
   * Materialize one exact live session without inventing a session event.
   * @param session - live session already registered through the write path.
   */
  async ensureMaterialized(session: Session): Promise<void> {
    await this.flush(session)
    await this.serialize(session.id, async () => {
      const state = this.states.get(session.id)
      /* v8 ignore next -- successful live flush always initializes the exact session state. */
      if (state === undefined) throw new Error(`session "${session.id}" is not registered for persistence`)
      if (state.materialized) return
      if (this.backend.materializeHeader === undefined) {
        throw new Error('session persistence backend cannot materialize an empty session')
      }
      await this.backend.materializeHeader(state.meta)
      state.materialized = true
      this.preparations.invalidate(session.id)
    })
  }

  private async createCore(meta: SessionHeader): Promise<void> {
    // Do NOT clobber an existing session: the SessionId IS the identity.
    // 绝不覆盖已有会话：SessionId 就是身份本身。
    if (this.states.has(meta.id) || this.preparations.has(meta.id)) {
      throw new Error(`session "${meta.id}" already exists in this backend`)
    }
    // A persisted artifact under this id (in ANY scope) blocks creation: load/
    // resume identify a session by id alone, so a second artifact would make
    // resume nondeterministic.
    // 任何作用域下同 id 的持久化工件都会阻止创建：load/resume 只凭 id 定位，
    // 出现第二份工件会让续聊结果不确定。
    if (await this.backend.loadStored(meta.id) !== undefined) {
      throw new Error(`session "${meta.id}" already has a persisted log on disk; load/resume it instead of creating`)
    }
    // Pure lazy: record intent only. No artifact until the first append.
    // 纯惰性：只记录意图，第一次 append 前不产生任何工件。
    this.states.set(meta.id, { meta, cursor: 0, materialized: false })
  }

  // `async` so synchronous materialization failures below reject (not throw) per
  // the Promise<void> contract — callers use `await expect(...).rejects`.
  // 声明为 async 是为了让下方的同步物化失败表现为 reject 而非同步 throw，符合
  // Promise<void> 返回契约（调用方统一用 await ... catch 处理）。
  /**
   * Durably persist a batch of events. Honors the append-only and contiguous-seq
   * contracts; rejects non-JSON-serializable `event.data`.
   * @param id - the session the batch belongs to.
   * @param events - the contiguous batch to persist, in seq order; materialized
   *   as a detached lossless-JSON snapshot at call time.
   */
  /*
   * 【中文】把一批事件持久化落盘：遵守追加式与 seq 连续契约；无法无损 JSON 序列化
   * 的 event.data 直接拒绝。调用即对整批做深快照，之后排队等待该会话的串行链。
   * @param id - 批次所属会话 id。
   * @param events - 按 seq 升序的连续批次；调用时即固化为独立的 JSON 快照。
   */
  async append(id: SessionId, events: readonly SessionEvent[]): Promise<void> {
    // Validate and deep-snapshot the complete batch HERE, in one traversal,
    // before the op waits behind the per-session chain. A check followed by
    // structuredClone would reread accessors and could sanitize an exotic value
    // into an apparently valid record; the single-pass materializer makes the
    // checked value exactly the value persisted.
    // 在排进串行链之前、于一次遍历中完成校验 + 深快照。若"先检查再 structuredClone"，
    // 访问器可能被二次读取，把怪异值"洗"成看似合法的记录；单遍物化保证
    // "被校验的值 == 被持久化的值"。
    const batch = snapshotJsonValue(events)
    if (batch === undefined) {
      throw new TypeError('session event batch is not losslessly JSON-serializable because it contains non-JSON-serializable data')
    }
    return this.serialize(id, () => this.appendCore(id, batch))
  }

  private async appendCore(id: SessionId, events: readonly SessionEvent[]): Promise<void> {
    // Every append route converges here: the public service, live write-behind
    // drains, and HMR seed/suffix adoption. Legacy-shape rejection stays at
    // this shared boundary so a stale JavaScript plugin cannot persist a
    // retired shape this backend refuses to load. The unknown-type guard is
    // deliberately read-side only: an append-time refusal would stall a live
    // session's durability mid-flight, which costs more than a loud refusal at
    // the log's next load (trade-off owned by the fail-closed-session-event-
    // vocabulary Agent Note).
    assertSupportedEvents(events, id)
    if (events.length === 0) return
    // 有未发布预留占着该 id 时禁止追加（正在 commit/reserved 阶段）。
    this.preparations.assertWritable(id)
    let state = this.states.get(id)
    // 内存里没有该 id 的状态：说明是磁盘上已有、尚未接管的会话，先收养。
    if (state === undefined) state = await this.adopt(id)

    // Contiguity contract: each event's seq must continue the stored log.
    // 连续性契约：每个事件的 seq 必须无缝续接已存日志。
    for (const [i, event] of events.entries()) {
      if (event.seq !== state.cursor + i) {
        throw new Error(`append seq mismatch for "${id}": expected ${state.cursor + i} at index ${i}, got ${event.seq}`)
      }
    }

    await this.backend.appendBatch(state.meta, events, state.materialized)
    // The durable write is the transaction: mark materialized + advance the
    // cursor as soon as it commits (uniform across backends).
    // 持久化写本身就是事务：一旦提交就立即标记已物化并推进游标（各后端行为一致）。
    state.materialized = true
    state.cursor += events.length
    // 日志变了，之前缓存的准备视图随之作废。
    this.preparations.invalidate(id)
  }

  /**
   * Prepare and reserve the exact unpublished Session used by resume.
   * Revision retries converge once the durable log remains unchanged for one
   * read/check round trip; continuous external writers may delay completion.
   * @param id - persisted session to prepare.
   * @param signal - optional cancellation for reading and repair.
   * @returns an owned preparation released after publication or rollback.
   */
  /*
   * 【中文】准备并预留 resume 专用的"未发布 Session"。基于修订号重试：只要持久化
   * 日志在"读一次 + 校验一次"的来回里保持不变即可收敛；外部持续写入会推迟完成。
   * 会话仍活跃时拒绝。返回的准备品在发布或回滚后释放。
   * @param id - 要准备的已持久化会话 id。
   * @param signal - 读取与修复期间的可选取消信号。
   * @returns 独占的准备品。
   */
  async prepare(id: SessionId, signal?: AbortSignal): Promise<SessionPreparation> {
    // 无限重试：每次循环先等退役排空，再走"预留→提交"流水线；提交失败（日志变了）
    // 就重来，直至拿到稳定的预留。
    for (;;) {
      await this.waitForRetirement(id, signal)
      if (this.ctx.sessions.get(id) !== undefined) {
        throw new Error(`cannot prepare session "${id}" while it is live`)
      }
      // reserve 内部：冷读（串行化）→ 等 ready → commitPrepared 提交修复与游标状态。
      const reservation = await this.preparations.reserve(
        id,
        () => this.serialize(id, () => this.prepareCore(id)),
        source => this.serialize(id, () => this.commitPrepared(source), signal),
        signal,
      )
      if (reservation === undefined) continue
      // 拿到预留后再复查一次"是否变活跃"，防止竞态下把活跃会话二次准备。
      if (this.ctx.sessions.get(id) !== undefined) {
        this.preparations.release(reservation, false)
        throw new Error(`cannot prepare session "${id}" while it is live`)
      }
      // 包装成 SessionPreparation：release 时若该准备品从未发布且长度未变，可回收复用。
      return SessionPreparation.create(reservation.source.session, {
        release: () => {
          this.preparations.release(
            reservation,
            reservation.state.owner === undefined
              && reservation.source.session.events.length === reservation.source.sessionLength,
          )
        },
      })
    }
  }

  /**
   * Commit recovery and return its immutable logical view without publication.
   * Revision retries converge once the durable log remains unchanged for one
   * read/check round trip; continuous external writers may delay completion.
   * @param id - persisted session to load.
   * @returns prepared header and balanced events.
   */
  /*
   * 【中文】提交恢复并返回其不可变逻辑视图，但不发布 Session。与 prepare 相同的
   * 修订号重试语义。若该 id 已有活跃 Session，则改为把活跃会话的写缓冲排空后
   * 返回其持久快照。
   * @param id - 要加载的已持久化会话 id。
   * @returns 准备好的头信息与配平后的事件。
   */
  async load(id: SessionId): Promise<SessionInspection> {
    // 与 prepare 同构的重试循环；差别在于 load 只取 inspection、随后丢弃预留。
    for (;;) {
      await this.waitForRetirement(id)
      const live = this.ctx.sessions.get(id)
      // 已是活跃会话：排空其写缓冲后借用不可变视图（开着回合则报错）。
      if (live !== undefined) return this.loadLiveSnapshot(live)
      const reservation = await this.preparations.reserve(
        id,
        () => this.serialize(id, () => this.prepareCore(id)),
        source => this.serialize(id, () => this.commitPrepared(source)),
      )
      if (reservation === undefined) continue
      const attached = this.ctx.sessions.get(id)
      if (attached !== undefined) {
        this.preparations.discard(reservation)
        return this.loadLiveSnapshot(attached)
      }
      this.preparations.discard(reservation)
      return reservation.source.inspection
    }
  }

  /**
   * Inspect a logical session without publishing it or committing recovery.
   * A stale ready source is reloaded. A source already committing or reserved
   * for resume remains exclusive, and inspection may borrow its immutable view.
   * Revision retries converge once the log is stable for one read/check round
   * trip; continuous external writers may delay completion.
   * @param id - persisted session to inspect.
   * @param signal - optional cancellation for preparation work.
   * @returns immutable prepared metadata and events; a live view may have an open turn.
   */
  /*
   * 【中文】检视：不发布、不提交恢复地读取逻辑会话。就绪但过期的源会被重读；已被
   * 提交或被 resume 预留的源保持独占，检视只借用其不可变视图。修订号重试语义同前。
   * @param id - 要检视的已持久化会话 id。
   * @param signal - 准备工作期间的可选取消信号。
   * @returns 不可变的头信息与事件；活跃视图可能含未关闭回合。
   */
  async inspect(id: SessionId, signal?: AbortSignal): Promise<SessionInspection> {
    // 重试循环：处理"读的过程中会话变活跃 / 日志被外部改写"等竞态，直到给出稳定结果。
    for (;;) {
      signal?.throwIfAborted()
      if (this.retirements.has(id)) await this.waitForRetirement(id, signal)
      const live = this.ctx.sessions.get(id)
      // 活跃会话直接借视图，不经过准备池。
      if (live !== undefined) return this.inspectLive(live)
      try {
        // 从准备池取（或共享进行中的）冷读结果。
        const source = await this.preparations.inspect(
          id,
          () => this.serialize(id, () => this.prepareCore(id)),
          signal,
        )
        const attached = this.ctx.sessions.get(id)
        if (attached !== undefined) return this.inspectLive(attached)
        // 串行化地校验缓存源的修订号是否仍与磁盘一致。
        const current = await this.serialize(
          id,
          () => this.isPreparedSourceCurrent(source, signal),
          signal,
        )
        const published = this.ctx.sessions.get(id)
        if (published !== undefined) return this.inspectLive(published)
        // 源仍新鲜：直接返回其检视视图。
        if (current) return source.inspection
        // 源过期：若它已被某个预留独占（retained）就仍可借视图，否则丢弃后重试。
        if (this.preparations.discardReady(id, source) === 'retained') {
          return source.inspection
        }
      } catch (error: unknown) {
        // 失败路径同样先看会话是否已活跃：是则借活跃视图，否则原样上抛。
        signal?.throwIfAborted()
        const attached = this.ctx.sessions.get(id)
        if (attached !== undefined) return this.inspectLive(attached)
        throw error
      }
    }
  }

  /**
   * Borrow one exact logical view while pinning its reusable prepared Session.
   * @param id - persisted session to observe.
   * @param signal - optional cancellation for preparation work.
   * @returns a disposable observation retaining the prepared source.
   */
  async borrowSession(id: SessionId, signal?: AbortSignal): Promise<BorrowedSessionSource> {
    for (;;) {
      signal?.throwIfAborted()
      if (this.retirements.has(id)) await this.waitForRetirement(id, signal)
      const live = this.ctx.sessions.get(id)
      if (live !== undefined) {
        return { source: 'live', inspection: this.inspectLive(live), [Symbol.dispose]: () => {} }
      }
      const observation = await this.preparations.borrow(
        id,
        () => this.serialize(id, () => this.prepareCore(id)),
        signal,
      )
      const source = observation.source
      try {
        const attached = this.ctx.sessions.get(id)
        if (attached !== undefined) {
          observation[Symbol.dispose]()
          return { source: 'live', inspection: this.inspectLive(attached), [Symbol.dispose]: () => {} }
        }
        const current = await this.serialize(
          id,
          () => this.isPreparedSourceCurrent(source, signal),
          signal,
        )
        const published = this.ctx.sessions.get(id)
        if (published !== undefined) {
          observation[Symbol.dispose]()
          return { source: 'live', inspection: this.inspectLive(published), [Symbol.dispose]: () => {} }
        }
        if (current || this.preparations.discardReady(id, source) === 'retained') {
          return {
            source: 'prepared',
            inspection: source.inspection,
            revision: source.revision,
            preparedSession: source.session,
            [Symbol.dispose]: () => { observation[Symbol.dispose]() },
          }
        }
      } catch (error: unknown) {
        observation[Symbol.dispose]()
        signal?.throwIfAborted()
        const attached = this.ctx.sessions.get(id)
        if (attached !== undefined) {
          return { source: 'live', inspection: this.inspectLive(attached), [Symbol.dispose]: () => {} }
        }
        throw error
      }
      observation[Symbol.dispose]()
    }
  }

  /**
   * Read the stored events from `fromSeq` onward, detached and non-mutating
   * (the read-from-seq primitive behind the service's `readFrom`). Runs on
   * the same per-id chain as writes; a backend with the seek-capable
   * {@link PersistenceBackend.loadStoredFrom} hook reads only the suffix,
   * every other backend reads its stored prefix and skips forward here.
   * @param id - persisted session to read.
   * @param fromSeq - first event seq to include; a non-negative safe integer.
   * @param signal - optional cancellation for queued and backend read work.
   * @returns stored header and the valid stored events with `seq >= fromSeq`.
   */
  /*
   * 【中文】readFrom 的协调器实现：与写操作同一条每 id 串行链上执行；实现了寻址钩子
   * {@link PersistenceBackend.loadStoredFrom} 的后端只读后缀，其余后端在此处读取
   * 完整前缀再向前跳过。纯物理读取，不做任何修复。
   * @param id - 要读取的已持久化会话 id。
   * @param fromSeq - 返回结果包含的首个事件 seq（非负安全整数）。
   * @param signal - 排队与后端读取期间的可选取消信号。
   * @returns 存储头信息与所有 seq >= fromSeq 的有效已存事件。
   */
  readFrom(id: SessionId, fromSeq: number, signal?: AbortSignal): Promise<{ meta: SessionHeader; events: SessionEvent[] }> {
    // 入口先校验 fromSeq 形状，非法立即以 TypeError 拒绝。
    if (!Number.isSafeInteger(fromSeq) || fromSeq < 0) {
      return Promise.reject(new TypeError(`readFrom fromSeq must be a non-negative safe integer, got ${String(fromSeq)}`))
    }
    const retired = Promise.resolve(this.retirements.get(id))
    const waited = signal === undefined ? retired : observeQueuedAbort(retired, signal, () => false)
    return waited.then(() => this.serialize(id, () => this.readFromCore(id, fromSeq, signal), signal))
  }

  /**
   * 【中文】readFrom 的核心逻辑（已在该 id 的串行链内执行）。
   * @param id - 会话 id。
   * @param fromSeq - 首个要包含的 seq。
   * @param signal - 可选取消信号。
   * @returns 头信息与后缀事件。
   */
  private async readFromCore(
    id: SessionId,
    fromSeq: number,
    signal?: AbortSignal,
  ): Promise<{ meta: SessionHeader; events: SessionEvent[] }> {
    signal?.throwIfAborted()
    if (this.backend.loadStoredFrom !== undefined) {
      // 寻址路径：让后端直读后缀；读取错误先区分"真失败"与"调用方已取消"。
      let suffix: StoredSuffix | undefined
      try {
        suffix = await this.backend.loadStoredFrom(id, fromSeq, signal)
      } catch (error: unknown) {
        if (signal?.aborted) signal.throwIfAborted()
        throw error
      }
      signal?.throwIfAborted()
      if (suffix === undefined) throw new SessionPersistenceNotFoundError(id)
      this.assertStoredId(id, suffix.meta)
      this.assertVersion(suffix.meta)
      // 后缀里出现需要前缀事实的旧形状：整体回退为全量前缀读取再过滤。
      if (suffix.events.some(needsLegacyPrefix)) {
        const whole = await this.readStoredPrefix(id, signal)
        return { meta: whole.meta, events: whole.events.filter(event => event.seq >= fromSeq) }
      }
      const events = snapshotStoredEvents(suffix.events, id)
      this.assertEventsSupported(suffix.meta, events)
      return { meta: structuredClone(suffix.meta), events }
    }
    // 顺序介质回退：seq 从 0 连续，后缀就是数组切片。
    const whole = await this.readStoredPrefix(id, signal)
    // Sequential fallback: contiguous seqs from 0 make the suffix an index slice.
    return { meta: whole.meta, events: whole.events.slice(fromSeq) }
  }

  /** Read one detached physical prefix without logical recovery or caching. */
  /*
   * 【中文】读取一份"脱钩的物理前缀"：不做逻辑恢复、不进缓存、不截断残尾——
   * 残尾碎片天然不会进入返回值（解析器只产出完整记录）。供 readFrom 等纯读场景用。
   * @param id - 会话 id。
   * @param signal - 可选取消信号。
   * @returns 头信息（深拷贝）与迁移、校验后的事件。
   */
  private async readStoredPrefix(
    id: SessionId,
    signal?: AbortSignal,
  ): Promise<{ meta: SessionHeader; events: SessionEvent[] }> {
    signal?.throwIfAborted()
    const stored = await this.backend.loadStored(id, signal)
    signal?.throwIfAborted()
    if (stored === undefined) throw new SessionPersistenceNotFoundError(id)
    this.assertStoredId(id, stored.meta)
    this.assertVersion(stored.meta)
    const events = snapshotStoredEvents(stored.events, id)
    this.assertEventsSupported(stored.meta, events)
    return {
      meta: structuredClone(stored.meta),
      events,
    }
  }

  /** Read, repair in memory, validate, and freeze one cold source once. */
  /*
   * 【中文】冷读流水线（只执行一次）：读已存前缀 → 校验 id 与格式版本 → 收养并
   * 迁移事件 → 校验事件词表 → 为完整中断的回合计算合成收尾 → 用配平后的日志构建
   * 未发布 Session 并冻结检视视图。格式拒绝原样上抛；其余校验失败统一包装为
   * 损坏错误。
   * @param id - 要冷读的会话 id。
   * @returns 准备好的源（检视视图 + Session + 修订号 + 修复材料）。
   */
  private async prepareCore(id: SessionId): Promise<PreparedSessionSource<TornMarker>> {
    const stored = await this.backend.loadStored(id)
    if (stored === undefined) throw new SessionPersistenceNotFoundError(id)
    try {
      const { meta, events, revision, tornMarker } = stored
      // 四步校验与迁移：身份、版本、旧形状升级、未知类型。
      this.assertStoredId(id, meta)
      this.assertVersion(meta)
      const storedEvents = adoptStoredEvents(events, id)
      this.assertEventsSupported(meta, storedEvents)

      // Preserve complete interrupted events and synthesize only missing closers.
      // 保留完整的中断事件，只为缺失的收尾合成补齐事件。
      const closers = interruptedTurnClosers(storedEvents).map(adoptSessionEvent)
      const balanced = [...storedEvents, ...closers]
      // 以配平日志为种子构建未发布 Session，并冻结一份检视视图供多方借用。
      const session = this.ctx.sessions.prepare(id, {
        seed: balanced,
        meta,
        seedSource: 'persistence',
      })
      const inspection: SessionInspection = Object.freeze({
        meta: session.header,
        events: Object.freeze(balanced),
      })
      return {
        inspection,
        session,
        revision,
        sessionLength: session.events.length,
        tornMarker,
        closers,
      }
    } catch (error: unknown) {
      // An unsupported format is a refusal over an intact log, not damage —
      // surface it unwrapped so callers can point at the raw artifact.
      // 格式不支持是对完好日志的"拒绝"而非损坏——原样上抛，让调用方能指向原始工件。
      if (error instanceof SessionFormatUnsupportedError) throw error
      throw new SessionPersistenceCorruptionError(
        `stored session "${id}" failed validation: ${String(error)}`,
        { cause: error },
      )
    }
  }

  /** Commit one prepared repair and establish its ownerless durable cursor. */
  /*
   * 【中文】提交一次准备好的修复并确立无主的持久游标：若需要修复（有残尾或合成
   * 收尾）就先写盘，然后返回 undefined 让调用方重读（因为修订号已变）；无需修复时
   * 直接建立内存状态。已有活跃归属的 id 会拒绝。
   * @param source - 准备好的源。
   * @returns 成功时给出 {source, state}；执行了磁盘修复则 undefined。
   */
  private async commitPrepared(
    source: PreparedSessionSource<TornMarker>,
  ): Promise<{ source: PreparedSessionSource<TornMarker>; state: SessionState } | undefined> {
    const id = source.inspection.meta.id
    const cursor = source.inspection.events.length
    const existing = this.states.get(id)
    if (existing?.owner !== undefined) {
      throw new Error(`session "${id}" already has a live persistence owner`)
    }
    if (!await this.isPreparedSourceCurrent(source)) return undefined
    if (source.tornMarker !== undefined || source.closers.length > 0) {
      await this.backend.commitRepair(source.inspection.meta, source.tornMarker, source.closers)
      // The repair changed the durable revision. Reload the exact committed
      // graph instead of associating the old in-memory view with a newer revision.
      // 修复改变了磁盘修订号：宁可重读已提交的精确图，也不把旧内存视图硬配到新修订上。
      return undefined
    }
    const state = existing ?? {
      meta: source.inspection.meta,
      cursor,
      materialized: true,
    }
    state.meta = source.inspection.meta
    state.cursor = cursor
    state.materialized = true
    this.states.set(id, state)
    return {
      source,
      state,
    }
  }

  /** Whether one cached source still names the current durable log revision. */
  /*
   * 【中文】乐观并发控制的核心检查：缓存源记录的修订号是否仍等于磁盘当前修订号。
   * @param source - 待校验的缓存源。
   * @param signal - 可选取消信号。
   * @returns 一致返回 true（源仍新鲜）。
   */
  private async isPreparedSourceCurrent(
    source: PreparedSessionSource<TornMarker>,
    signal?: AbortSignal,
  ): Promise<boolean> {
    return await this.backend.readStoredRevision(source.inspection.meta.id, signal) === source.revision
  }

  /** Return one durable immutable view of an already-live Session. */
  /*
   * 【中文】为"已是活跃会话"的 load 场景返回持久不可变视图：先排空其写缓冲保证
   * 磁盘与内存一致；开着回合的活跃日志拒绝加载（用户应使用活跃会话或等回合关闭）。
   * @param session - 活跃 Session。
   * @returns 冻结的 {头信息, 事件} 视图。
   */
  private async loadLiveSnapshot(session: Session): Promise<SessionInspection> {
    const events = session.events
    await this.flush(session)
    const state = this.states.get(session.id)
    /* v8 ignore next -- successful flush always publishes this live session's durable state */
    if (state === undefined) throw new Error(`session "${session.id}" lost persistence state during load`)
    if (events.length === 0 && !state.materialized) throw new Error(`session "${session.id}" not found`)
    if (interruptedTurnClosers(events).length > 0) {
      throw new Error(`cannot load session "${session.id}" while its live turn is open; use the live Session or wait for the turn to close`)
    }
    return Object.freeze({ meta: state.meta, events })
  }

  /** Borrow one immutable view from an already-live Session. */
  /*
   * 【中文】inspect 的活跃捷径：直接借用活跃会话当前的不可变头信息与事件视图，
   * 不排空、不修复——只求"此刻看到什么就是什么"。
   * @param session - 活跃 Session。
   * @returns 冻结的检视视图。
   */
  private inspectLive(session: Session): SessionInspection {
    return Object.freeze({ meta: session.header, events: session.events })
  }

  /** Await one retiring lifecycle with caller cancellation. */
  /*
   * 【中文】等待某个 id 的退役排空完成（若在退役中）；支持调用方取消观察。
   * @param id - 会话 id。
   * @param signal - 可选取消信号。
   * @returns 排空完成后 resolve。
   */
  private waitForRetirement(id: SessionId, signal?: AbortSignal): Promise<void> {
    const retired = Promise.resolve(this.retirements.get(id))
    return signal === undefined
      ? retired
      : observeQueuedAbort(retired, signal, () => false)
  }

  // Listing is a direct backend read and needs no coordinator state.
  // 列举只是直接读后端，不涉及协调器状态。

  // --- per-id serialization + adoption helpers ---
  // --- 每 id 串行化 + 收养助手 ---

  /**
   * Run `op` after any in-flight operation for the same session id, so writes for
   * one session never interleave. Errors do not poison the chain. NOTE: serialized
   * public methods must NOT call each other (deadlock); they call the unserialized
   * `*Core` helpers instead.
   */
  /*
   * 【中文】串行化执行器：让同一会话 id 的操作依次排队，写入永不交错；单个操作的
   * 失败不会污染后续队列。铁律：已串行化的公共方法之间禁止互相调用（会死锁），
   * 它们只能调用未串行化的 *Core 助手。
   * @param id - 会话 id（串行键）。
   * @param op - 要排队的操作。
   * @param signal - 可选取消信号：排队未开始时可立即以取消原因拒绝。
   * @returns 操作本身的完成结果。
   */
  private serialize<T>(
    id: SessionId,
    op: () => Promise<T> | T,
    signal?: AbortSignal,
  ): Promise<T> {
    // 取该 id 当前链尾（没有则从一个已 resolve 的 Promise 起链）。
    const prior = this.chains.get(id) ?? Promise.resolve()
    let started = false
    const run = (): Promise<T> | T => {
      signal?.throwIfAborted()
      started = true
      return op()
    }
    // 无论前驱成功失败都继续执行本操作；next 才是调用方看到的真实结果。
    const next = prior.then(run, run)
    // Keep the chain alive but swallow this op's rejection for the NEXT waiter
    // (the caller still sees the real rejection via `next`).
    // 吞掉本操作的 rejection 以维持链条存活（下一个等待者不受影响）；
    // 调用方仍通过 next 看到真实的拒绝原因。
    const tail = next.then(() => undefined, () => undefined)
    this.chains.set(id, tail)
    // Settled tails carry no serialization value. Delete only the exact tail
    // installed above: a later operation may already have replaced it.
    // 已落定的尾结点没有保留价值；只删除"恰好是自己装的"那条尾，
    // 更晚的操作可能已经替换过它。
    void tail.then(() => {
      if (this.chains.get(id) === tail) this.chains.delete(id)
    })
    return signal === undefined ? next : observeQueuedAbort(next, signal, () => started)
  }

  /** Build a state for a session discovered in storage but not yet in memory. */
  /*
   * 【中文】收养：为"磁盘上存在、内存中尚无状态"的会话建立写状态。优先取准备池里
   * 就绪的冷读源，否则现做一次冷读；随后提交修复/游标状态。若提交期间日志又变了
   * （返回 undefined）就循环重试。必须在串行链内调用，因此只用 core 助手。
   * @param id - 要收养的会话 id。
   * @returns 建立好的会话状态。
   */
  private async adopt(id: SessionId): Promise<SessionState> {
    // This runs inside the id's serialization chain, so it uses core helpers
    // instead of re-entering through public prepare/load methods.
    // 本方法运行在该 id 的串行链内，所以只调 core 助手，绝不重入公共 prepare/load。
    for (;;) {
      const source = this.preparations.takeReady(id) ?? await this.prepareCore(id)
      const committed = await this.commitPrepared(source)
      if (committed !== undefined) return committed.state
    }
  }

  /**
   * 【中文】校验存储头的格式版本：与当前 SESSION_FORMAT_VERSION 不同即构造带原始
   * 工件位置提示的格式拒绝错误。
   * @param meta - 待检查的头信息。
   */
  private assertVersion(meta: SessionHeader): void {
    if (meta.version === SESSION_FORMAT_VERSION) return
    throw this.unsupported(meta, sessionFormatVersionRefusal(meta.id, meta.version))
  }

  /**
   * Refuse a log containing an event type this build does not know: silently
   * skipping an unknown event could reconstruct a wrong session. Runs on
   * NORMALIZED events — after `snapshotStoredEvents`/`adoptStoredEvents` has
   * upgraded the legacy shapes this build still reads and rejected the ones it
   * does not, so those keep their specific diagnostics.
   */
  /*
   * 【中文】拒绝包含本构建不认识的事件类型的日志——除非写入方标记了该事件
   * ignorable。原因：一个未被识别的"必需"事件可能改变整份日志的解读方式，
   * 静默跳过会重建出错误的会话。本检查运行在归一化之后的事件上：旧形状已先被
   * 迁移或按各自诊断拒绝，不会在这里产生笼统报错。
   * @param meta - 所属会话头。
   * @param events - 已迁移的事件序列。
   */
  private assertEventsSupported(meta: SessionHeader, events: readonly SessionEvent[]): void {
    // ignorable 事件允许被旧构建安全跳过（信封契约），其余未知类型一律拒绝。
    for (const event of events) {
      if (KNOWN_SESSION_EVENT_TYPES.has(event.type)) continue
      throw this.unsupported(meta, `session "${meta.id}" contains event type "${event.type}" (seq ${event.seq}) unknown to this harness; refusing to interpret the log — it was likely written by a newer harness`)
    }
  }

  /** Build a format refusal that points at the raw artifact when the backend has one. */
  /*
   * 【中文】构造格式拒绝错误；若后端能定位原始工件，把路径追加到文案里方便用户
   * 自查日志。
   * @param meta - 所属会话头。
   * @param reason - 拒绝原因文案（不含路径后缀）。
   * @returns 带位置提示的 SessionFormatUnsupportedError。
   */
  private unsupported(meta: SessionHeader, reason: string): SessionFormatUnsupportedError {
    const location = this.backend.locate?.(meta)
    return new SessionFormatUnsupportedError(
      location === undefined ? reason : `${reason} (raw log: ${location.path})`,
      location,
    )
  }

  /** Reject backend metadata that is not bound to the requested session id. */
  /*
   * 【中文】身份一致性守卫：后端返回的头信息必须就是请求的那个会话，否则视为
   * 存储错乱并报错。
   * @param id - 请求的会话 id。
   * @param meta - 后端返回的头信息。
   */
  private assertStoredId(id: SessionId, meta: SessionHeader): void {
    if (meta.id !== id) {
      throw new Error(`stored session identity mismatch: requested "${id}", header contains "${meta.id}"`)
    }
  }

  // --- write path (session/event → flush drain) ---
  // --- 写路径（会话事件 → flush 排空） ---

  private installWritePath(): void {
    const ctx = this.ctx

    // Register the disposer BEFORE the listeners. Cordis tears effects down in
    // reverse registration order, so event admission closes before this final
    // drain reaches quiescence and closes the backend.
    // 先注册 disposer 再注册监听：Cordis 按注册的逆序拆除，因此"事件准入先关闭，
    // 最后才轮到这次终局排空到达静默并关闭后端"。
    ctx.effect(() => async () => {
      let disposeError: unknown
      try {
        const errors = await settledErrors([...this.live.keys()].map(session => this.flush(session)))
        while (this.chains.size > 0) await Promise.allSettled([...this.chains.values()])
        if (errors.length > 0) {
          throw new AggregateError(errors, `${this.backend.name} dispose failed`)
        }
      } catch (error: unknown) {
        disposeError = error
        throw error
      } finally {
        try {
          await this.backend.close?.()
        } catch (closeError: unknown) {
          // A close failure can only add teardown context; keep the already-
          // captured drain AggregateError as the primary failure rather than
          // masking it. Only surface the close error if the drain succeeded.
          // close 失败只是补充拆除上下文：保持先前捕获的排空聚合错误为主失败，
          // 不被掩盖；只有排空成功时才上抛 close 错误。
          /* v8 ignore start -- close failure racing disposal is a defensive teardown edge */
          if (disposeError === undefined) throw closeError
          /* v8 ignore stop */
        }
      }
    }, `${this.backend.name} write path`)

    // Capture the header on creation and persist a fork's seed once.
    // 在会话创建时捕获头信息，并把（分叉会话的）种子持久化一次。
    ctx.on('session/created', (session) => {
      void this.initFor(session)
    })

    // Keep a persistence-owned copy of each frozen event and start its bounded window.
    // 为每条已冻结事件保留一份持久化自有副本，并启动其有限的写合并窗口。
    ctx.on('session/event', (session, event) => {
      const live = this.initFor(session)
      live.writes.enqueue(event)
    })

    // Callers use flush as the immediate durability barrier for buffered writes.
    // 调用方把 flush 当作缓冲写入的"立即持久化屏障"。
    ctx.on('session/flush', session => this.flush(session))

    // Session disposal is observe-only, so retirement contains its own failure.
    // 会话销毁只做观察，退役过程中的失败由退役逻辑自行记录、不向外抛。
    ctx.on('session/disposed', (session) => { this.retire(session) })

    // HMR does not replay session/created, so seed existing live sessions.
    for (const session of ctx.sessions.list()) void this.initFor(session)
  }

  /** Start and observe one disposed session's final drain. */
  /*
   * 【中文】启动并观察某个已销毁会话的最后一次排空：登记到 retirements 表供他人
   * 等待，排空结束后移除；失败只记日志（销毁路径不向外抛错）。
   * @param session - 刚被销毁的 Session。
   */
  private retire(session: Session): void {
    if (!this.live.has(session)) return
    const retirement = this.retireCore(session)
    this.retirements.set(session.id, retirement)
    const forget = (): void => {
      if (this.retirements.get(session.id) === retirement) this.retirements.delete(session.id)
    }
    void retirement.then(forget, forget)
    void retirement.catch((error: unknown) => {
      this.ctx.logger.warn(`${this.backend.name}: session "${session.id}" retirement failed: ${String(error)}`)
    })
  }

  /** Drain and release state owned by one exact disposed Session lifecycle. */
  /*
   * 【中文】排空并释放某个精确销毁生命周期所拥有的状态：先 flush 落盘缓冲，再在
   * 串行链内解除 live 绑定并删除该会话的记账状态（仅当归属仍是本会话）。
   * @param session - 已销毁的 Session。
   */
  private async retireCore(session: Session): Promise<void> {
    await this.flush(session)
    const id = session.header.id
    await this.serialize(id, () => {
      this.live.delete(session)
      if (this.states.get(id)?.owner === session) this.states.delete(id)
    })
  }

  /** Return the one lifecycle controller for a live session, creating it if needed. */
  /*
   * 【中文】取活跃会话唯一的生命周期控制器；没有则创建。若存在与该 Session 精确
   * 匹配的"已准备预留"（resume 发布场景），走 attachPrepared 接管；否则按全新
   * 初始化处理：以会话当前事件为种子，串行执行 onCreated 并启动写后缓冲。
   * @param session - 活跃 Session。
   * @returns 该会话的生命周期控制器。
   */
  private initFor(session: Session): LiveSessionState {
    const existing = this.live.get(session)
    if (existing) return existing
    const reservation = this.preparations.reservationFor(session)
    if (reservation !== undefined) {
      // resume 场景：把准备好的 Session 与其持久化状态精确接驳。
      const restored = this.attachPrepared(session, reservation)
      this.live.set(session, restored)
      return restored
    }
    // Session owns this stable deep-frozen snapshot; backends only serialize it.
    // 会话自身持有这份稳定的深冻结快照，后端只负责序列化它。
    const seed = session.events
    const live: LiveSessionState = {
      init: Promise.resolve(),
      writes: this.createWriteBehind(session, () => live.init),
    }
    this.live.set(session, live)
    // 初始化排队进串行链；失败由 flush/dispose 通过控制器观察，这里不悬挂未处理拒绝。
    live.init = this.serialize(session.header.id, () => this.onCreated(session, seed))
    live.init.catch(() => { /* observed by flush/dispose through the controller */ })
    return live
  }

  /** Bind one exact prepared Session and persist only its unpublished suffix. */
  /*
   * 【中文】把"精确匹配的准备 Session"与其持久化状态接驳：多重一致性检查（对象
   * 同一性、无其他归属、游标对齐 firstLiveSeq）通过后，把尚未持久化的后缀事件
   * 深拷贝入队补写，并消费预留、登记归属。
   * @param session - 由准备品发布的活跃 Session。
   * @param reservation - 对应的独占预留。
   * @returns 建立好的生命周期控制器。
   */
  private attachPrepared(
    session: Session,
    reservation: SessionPreparationReservation<PreparedSessionSource<TornMarker>, SessionState>,
  ): LiveSessionState {
    const { source, state } = reservation
    if (source.session !== session || state.owner !== undefined
      || state.cursor !== source.inspection.events.length
      || session.firstLiveSeq !== state.cursor) {
      throw new Error(`session "${session.id}" preparation no longer matches its persistence state`)
    }
    const suffix = session.events.slice(state.cursor).map(event => structuredClone(event))
    this.preparations.attach(reservation)
    state.owner = session
    const live: LiveSessionState = {
      init: Promise.resolve(),
      writes: this.createWriteBehind(session, () => live.init),
    }
    // 准备期间新产生的事件（后缀）尚未落盘，初始化时先补写。
    if (suffix.length > 0) {
      live.init = this.serialize(session.id, () => this.appendCore(session.id, suffix))
      live.init.catch(() => { /* observed by flush/dispose through the controller */ })
    }
    return live
  }

  /**
   * Whether a live session's `seed` reproduces the first `cursor` persisted
   * events. A `cursor` of 0 (nothing persisted yet) trivially matches. Used when
   * a live session claims ownerless state left by a prior `load()`/`create()`.
   */
  /*
   * 【中文】判断活跃会话的种子是否恰好复现了已持久化的前 cursor 条事件。
   * cursor 为 0（磁盘上还没有内容）时平凡成立。用于活跃会话认领先前
   * load()/create() 留下的"无主状态"前的安全检查。
   * @param id - 会话 id。
   * @param seed - 活跃会话的种子事件。
   * @param cursor - 已持久化的事件数。
   * @returns 种子覆盖前缀返回 true。
   */
  private async seedMatchesPersisted(id: SessionId, seed: readonly SessionEvent[], cursor: number): Promise<boolean> {
    if (cursor === 0) return true
    const stored = await this.backend.loadStored(id)
    /* v8 ignore next -- a cursor > 0 means the session was materialized, so it exists */
    if (stored === undefined) return false
    this.assertStoredId(id, stored.meta)
    // 只比较前 cursor 条：之后的差异属于"活跃会话领先"，由后缀补写处理。
    return seedCoversPrefix(seed, snapshotStoredEvents(stored.events, id).slice(0, cursor))
  }

  /**
   * On session/created: sync the backend's in-memory state to a live Session.
   *
   * Cases, by whether this backend tracks the id and whether an artifact exists:
   *   1. Already tracked → no-op (or claim ownerless state if the seed matches,
   *      or reclaim a truly-abandoned id, else reject as a collision).
   *   2. Not tracked, an artifact EXISTS at the same cwd and is a seq-aligned
   *      PREFIX of the live events → ADOPT it, persisting any live suffix.
   *   3. Not tracked, an artifact EXISTS at another cwd or is NOT a prefix →
   *      REJECT (collision).
   *   4. Not tracked and NO artifact → a genuinely new session: register meta
   *      (lazy) and persist its seed once.
   */
  /*
   * 【中文】session/created 的核心处理：把后端内存状态与活跃 Session 同步。
   * 按"是否已记账 / 磁盘是否有工件"分四种情形：
   *   1. 已记账 → 无操作（或种子吻合时认领无主状态，或回收真正被弃用的 id，
   *      否则按 id 冲突拒绝）；
   *   2. 未记账、同 cwd 有工件且是活跃事件的 seq 对齐前缀 → 收养并补写活跃后缀；
   *   3. 未记账、工件在别的 cwd 或不是前缀 → 拒绝（冲突）；
   *   4. 未记账且无工件 → 全新会话：登记元数据（惰性）并把种子持久化一次。
   * @param session - 新创建的活跃 Session。
   * @param seed - 创建时刻的完整事件序列（种子）。
   */
  private async onCreated(session: Session, seed: readonly SessionEvent[]): Promise<void> {
    const id = session.header.id
    const tracked = this.states.get(id)
    if (tracked !== undefined) {
      // case 1: already tracked.
      // 情形 1：已记账。
      /* v8 ignore next -- initFor dedupes per session object; same-object re-entry can't occur */
      if (tracked.owner === session) return
      if (tracked.owner === undefined) {
        // Ownerless state from the public create()/load() API. The FIRST live
        // session claims it — but ONLY if BOTH the cwd scope and the seed match.
        // A same-id ownerless artifact at a different cwd is a collision, not a
        // claim: accepting it would append this live session's events through
        // the stored header's cwd. The seed guard then ensures the live events
        // reproduce the persisted prefix; otherwise a fresh session reusing the
        // id could have its leading events filtered as already written.
        // 公共 create()/load() API 留下的无主状态：第一个活跃会话可认领——但必须
        // 同时满足 cwd 作用域与种子两条校验。不同 cwd 的同 id 工件是冲突而非认领：
        // 接受它会让本会话事件经由存储头的 cwd 写入。种子守卫确保活跃事件确实
        // 复现已持久化前缀；否则复用 id 的新会话可能把开头事件误判为"已写过"而过滤。
        if (tracked.meta.cwd !== session.header.cwd) {
          throw new Error(`session "${id}" is already persisted at a different cwd (persisted: ${String(tracked.meta.cwd)}, live: ${String(session.header.cwd)}) (id collision)`)
        }
        if (!await this.seedMatchesPersisted(id, seed, tracked.cursor)) {
          throw new Error(`session "${id}" is already persisted with ${tracked.cursor} event(s) that do not match this live session (id collision)`)
        }
        tracked.owner = session
        // Persist the seed SUFFIX beyond the persisted prefix. Constructor seed
        // events never emit session/event, so the buffer never sees them.
        // 只补写超出已持久化前缀的种子后缀。构造器种子事件不会发出 session/event，
        // 写缓冲永远见不到它们。
        const suffix = seed.slice(tracked.cursor)
        if (suffix.length > 0) await this.appendCore(id, suffix)
        return
      }
      // 已被另一个活跃会话占用：若它尚未物化也没有排队写，视为弃用直接回收；
      // 否则按冲突拒绝。
      const owner = this.live.get(tracked.owner)
      if (!tracked.materialized && !owner?.writes.hasWork) {
        this.states.delete(id)
      } else {
        throw new Error(`session "${id}" is already bound to a different live session in this backend (id collision)`)
      }
    }

    // case 2/3: resolve the id once across storage, then let adoption reject a
    // cwd mismatch before repair or state publication.
    // 情形 2/3：先跨存储解析一次该 id，再由收养逻辑在修复或发布之前拒绝 cwd 不符。
    const live = await this.backend.loadStored(id)
    if (live !== undefined) {
      // Do NOT route through cold preparation: that crash-repairs open turns as
      // interrupted, which is wrong for HMR while the live Session is still the
      // authority and may append the real step/turn end later.
      // 绝不能走冷读准备路径：那会把未关闭回合当中断做崩溃修复——HMR 场景下活跃
      // Session 才是权威，稍后会写入真正的 step/turn 结束事件。
      await this.adoptLivePrefix(session, seed, live)
      return
    }

    // case 4: a genuinely new session. Register its meta (lazy), then persist its
    // seed (events present at creation time) once.
    // 情形 4：真正的新会话。登记元数据（惰性），再把创建时刻已有的种子事件持久化一次。
    const meta: SessionHeader = { ...session.header }
    await this.createCore(meta)
    // Bind this state to the live session so a later DIFFERENT session reusing
    // the id is detected as a collision (case 1) rather than silently no-opped.
    // 把状态绑定到本活跃会话：之后另一个会话复用同一 id 时会被识别为冲突（情形 1），
    // 而不是静默跳过。
    const created = this.states.get(id)
    /* v8 ignore next -- create() always sets the state for the id */
    if (created !== undefined) created.owner = session
    if (seed.length > 0) await this.appendCore(id, seed)
  }

  /**
   * Adopt a stored prefix as a live session's history (HMR/reload): verify the
   * seed covers the stored prefix, truncate any torn tail (NOT the open turn —
   * the live Session is still the authority), bind ownership, and persist the
   * live suffix that was ahead of the stored prefix.
   */
  /*
   * 【中文】把已存前缀收养为活跃会话的历史（HMR/重载场景）：校验种子覆盖前缀、
   * cwd 一致、版本与词表受支持；只截断物理残尾（不关闭未完回合——活跃 Session
   * 仍是权威）；绑定归属，并把领先于已存前缀的活跃后缀补写落盘。
   * @param session - 活跃 Session。
   * @param seed - 创建时刻的种子事件。
   * @param stored - 磁盘上读出的已存前缀。
   */
  private async adoptLivePrefix(session: Session, seed: readonly SessionEvent[], stored: StoredPrefix<TornMarker>): Promise<void> {
    const { meta, events, tornMarker } = stored
    this.assertStoredId(session.header.id, meta)
    if (meta.cwd !== session.header.cwd) {
      throw new Error(`session "${session.header.id}" is already persisted at a different cwd (persisted: ${String(meta.cwd)}, live: ${String(session.header.cwd)}) (id collision)`)
    }
    this.assertVersion(meta)
    const storedEvents = snapshotStoredEvents(events, session.header.id)
    this.assertEventsSupported(meta, storedEvents)
    if (!seedCoversPrefix(seed, storedEvents)) {
      throw new Error(`session "${session.header.id}" already has a persisted log on disk that does not match this live session (id collision)`)
    }
    // Truncate-only repair (no closers): the open turn is NOT closed here.
    // 仅截断的修复（无合成收尾）：这里不关闭未完回合。
    if (tornMarker !== undefined) await this.backend.commitRepair(meta, tornMarker, [])
    this.states.set(session.header.id, {
      meta: { ...meta },
      cursor: storedEvents.length,
      materialized: true,
      owner: session,
    })
    const suffix = seed.slice(storedEvents.length)
    // 领先于已存前缀的活跃事件（含 HMR 期间新产生者）补写落盘。
    if (suffix.length > 0) await this.appendCore(session.header.id, suffix)
  }

  /**
   * 【中文】把某个会话的缓冲写入全部落盘：先取消自动等待，等初始化完成，再排空
   * 写后缓冲。初始化失败时同样取消自动等待后再上抛——普通 flush 可能与退役/拆除
   * 期间的最后一次入队发生竞争。
   * @param session - 要排空的活跃 Session。
   */
  private async flush(session: Session): Promise<void> {
    const live = this.initFor(session)
    live.writes.cancelAutomaticWait()
    try {
      await live.init
    } catch (error: unknown) {
      // Admission is closed during retirement/teardown, but an ordinary flush
      // may have raced one last enqueue while initialization was pending.
      // 退役/拆除期间准入已关闭，但普通 flush 可能在初始化挂起时与最后一次入队竞争。
      live.writes.cancelAutomaticWait()
      throw error
    }
    await live.writes.flush()
  }

  /** Build one package-private write controller around initialization and id serialization. */
  /*
   * 【中文】为会话构建包内私有的写控制器：写动作 = 等初始化就绪 → 排进该 id 的
   * 串行链执行 appendLiveBatch；后台写失败只告警并保留缓冲事件等待重试。
   * @param session - 目标活跃 Session。
   * @param ready - 返回初始化完成的 Promise。
   * @returns 写后缓冲控制器。
   */
  private createWriteBehind(session: Session, ready: () => Promise<void>): SessionWriteBehind {
    return new SessionWriteBehind({
      maxDelayMs: this.writeBatchMaxDelayMs,
      write: async (batch) => {
        await ready()
        await this.serialize(session.header.id, () => this.appendLiveBatch(session.header.id, batch))
      },
      reportBackgroundFailure: (error) => {
        this.ctx.logger.warn(`${this.backend.name}: background write for session "${session.id}" failed (buffered events retained): ${String(error)}`)
      },
    })
  }

  /** Append one controller-owned prefix after filtering events initialization already stored. */
  /*
   * 【中文】追加写控制器持有的批次：先按当前游标过滤掉"初始化时已经写过"的事件，
   * 再把剩余部分交给 appendCore。游标之后的都是新事件。
   * @param id - 会话 id。
   * @param batch - 写控制器攒下的事件批次。
   */
  private async appendLiveBatch(id: SessionId, batch: readonly SessionEvent[]): Promise<void> {
    const state = this.states.get(id)
    /* v8 ignore next -- state is always set by the awaited initialization */
    const cursor = state?.cursor ?? 0
    const fresh = batch.filter(e => e.seq >= cursor)
    await this.appendCore(id, fresh)
  }
}
