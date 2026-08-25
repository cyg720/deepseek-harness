/**
 * ================================ 文件注释 ================================
 * 【文件职责】定义会话持久化能力的"服务契约"（Service Definition）：以抽象类
 *   SessionPersistence 规定一切持久化后端必须实现的能力（登记、追加、加载、
 *   检视、按序号读取、列举、定位工件等），并通过声明合并把它挂到 Cordis 容器的
 *   ctx.sessionPersistence 服务名下。具体落盘实现（JSONL、SQLite 后端）都继承本类。
 * 【技术维度】Cordis 插件容器 Service 模式 + TypeScript 抽象类契约；事件溯源
 *   （event sourcing，即"持久化逐条事件而非最终状态"）：日志主体是 SessionEvent
 *   流的追加式存储，不可重放的会话头（SessionHeader）单独存放；另含品牌化修订号
 *   （Branded 类型）等跨包类型词汇。
 * 【产品维度】让 agent 的每段会话都能可靠保存、崩溃后恢复、随时续聊（resume）和
 *   只读检视（inspect），支撑"模型可见的内容必须能从日志重建"这条架构不变量。
 * 【逻辑维度】按代码顺序：①类型再导出（SessionHeader、修订号）；②三个轻量只读
 *   视图接口 Snapshot / Inspection / RawArtifact；③协调器（coordinator.ts）公共
 *   符号的转发导出；④Context 服务名声明合并；⑤SessionLocation 工件定位结构；
 *   ⑥抽象基类 SessionPersistence 及其全部方法。
 * 【关键边界】本文件只有契约没有实现：append 必须在数据真正持久化（durable，即
 *   断电也不丢）后才 resolve；事件必须 seq 连续且可无损 JSON 序列化；返回的日志
 *   是多方共享的不可变快照，调用方只读不写。
 * 【新手阅读建议】先通读 SessionPersistence 类的方法文档理解"能做什么"，再看
 *   coordinator.ts 理解"公共流程如何统一编排"，最后看 jsonl 包理解"如何落到单个
 *   文件"；三个视图接口可在读到对应返回值时回头查阅。
 * ==========================================================================
 */
/**
 * Durable session-persistence Service Definition (`ctx.sessionPersistence`). Backends store
 * {@link SessionEvent}s as the event-sourced log and carry non-replayable
 * {@link SessionHeader} metadata separately.
 * @module @deepseek-ai/dsh-session-persistence
 */
/*
 * 【中文导读】上面英文说明本模块是"持久化会话数据"的服务定义。Cordis 中每个能力缝
 * 都拆成三个角色：Service Definition（契约）/ Provider（实现）/ Consumer（使用方）；
 * 本包扮演契约角色，JSONL、SQLite 后端是实现方，代理循环等则是使用方。
 */

import { Context, Service } from '@deepseek-ai/cordis'
import { SessionPreparation } from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionId, SessionHeader } from '@deepseek-ai/dsh-session'
import type { SessionPersistenceRevision } from './revision.ts'

// Re-export the metadata vocabulary so Consumers import it from the Service Definition.
// 把会话头等类型词汇从上游 dsh-session 再导出，让使用方只依赖本契约包就能取齐所需类型。
export type { SessionHeader } from '@deepseek-ai/dsh-session'
export { SessionPersistenceRevision } from './revision.ts'

/** Lightweight immutable source identity returned without loading a full log. */
/*
 * 【中文】轻量级"存储快照"条目：不解析整份日志，仅凭元数据即可回答"磁盘上存了哪些
 * 会话、各自内容变过没有"。由 listSnapshots 返回，用于会话列表与廉价变更检测。
 */
export interface SessionPersistenceSnapshot {
  /** Detached metadata for one materialized session. */
  /* 【中文】该已落盘会话的头信息副本（id、格式版本、cwd、谱系等），与会话本体解耦。 */
  header: SessionHeader
  /** Opaque source-qualified token that changes whenever this stored log changes. */
  /* 【中文】来源限定的不透明修订令牌：日志内容不变则令牌不变，一旦变化即换新值。
   * 只用于"是否需要重新加载"的相等性比较，切勿解析或猜测其内部格式。 */
  revision: SessionPersistenceRevision
}

/** Immutable logical session prepared from persistence or a live owner. */
/*
 * 【中文】一次"检视"得到的完整逻辑会话：校验过的头信息 + 从 seq 0 起连续的事件日志，
 * 整体冻结为只读。数据既可能来自磁盘冷数据（load/inspect），也可能借用自内存中
 * 的活跃会话。调用方只能读取，不得修改。
 */
export interface SessionInspection {
  /** Validated immutable session metadata. */
  /* 【中文】已通过校验的不可变会话头。 */
  readonly meta: SessionHeader
  /** Validated contiguous logical event log. */
  /* 【中文】严格连续的事件日志；冷读时可能已附带崩溃修复所需的合成收尾事件。 */
  readonly events: readonly SessionEvent[]
}

/** A backend's own raw artifact text for one session, verbatim. */
/*
 * 【中文】后端亲手写下的"原始工件"全文，一字不改地返回。供调试、导出、排障使用：
 * 它保留打包行、键顺序、换行等后端私有序列化细节，而不是由解析后的事件重新拼装
 * 出来的"看起来一样"的文本。
 */
export interface SessionRawArtifact {
  /** The session header parsed from the artifact's own first line. */
  /* 【中文】从工件自身第一行解析出的会话头。 */
  readonly meta: SessionHeader
  /** The artifact's base filename on disk, without any physical encoding suffix. */
  /* 【中文】工件的逻辑文件名（不含压缩等物理编码后缀），JSONL 后端固定为 session.jsonl。 */
  readonly filename: string
  /** The artifact's full text content, decoded from the backend's physical encoding. */
  /* 【中文】解码物理编码后的完整正文文本（如 zstd 已解压），忠实对应原始字节。 */
  readonly content: string
}

// The backend-agnostic write-path orchestration first-party backends compose.
// 再导出"与后端无关的写入路径编排器"及其配套类型：第一方后端通过组合
// PersistenceCoordinator 复用缓冲、序列化、崩溃修复、释放清理等公共逻辑。
export {
  DEFAULT_PREPARED_SESSION_CACHE_SIZE,
  DEFAULT_WRITE_BATCH_MAX_DELAY_MS,
  MAX_WRITE_BATCH_DELAY_MS,
  PersistenceCoordinator,
  SessionFormatUnsupportedError,
  SessionPersistenceCorruptionError,
  sessionFormatVersionRefusal,
} from './coordinator.ts'
export type {
  PersistenceBackend,
  PersistenceCoordinatorOptions,
  StoredPrefix,
  StoredSuffix,
} from './coordinator.ts'

/**
 * 【中文】TypeScript 声明合并：给 Cordis 的 Context 接口补充 sessionPersistence
 * 属性，此后任意插件都能直接用 ctx.sessionPersistence 取到该服务实例（类型安全）。
 */
declare module '@deepseek-ai/cordis' {
  interface Context {
    sessionPersistence: SessionPersistence
  }
}

/**
 * A backend-resolved, per-session local artifact location. The path is an
 * absolute target path and can name an artifact that has not materialized yet.
 * Consumers must treat it as a location hint, never as an authorization token.
 */
export interface SessionLocation {
  /** Backend-specific artifact kind, for example `jsonl`. */
  readonly kind: string
  /** Absolute path to this session's backend-owned artifact. */
  readonly path: string
}

/**
 * Durable append-only session storage. Implementations preserve contiguous,
 * losslessly JSON-serializable events; {@link append} resolves only after
 * durability, and {@link load} balances a complete interrupted tail without
 * rewriting committed events.
 */
/*
 * 【中文】持久化能力的抽象基类，即服务契约本体。所有后端继承它并实现各抽象方法；
 * readRaw / prepare 提供通用默认实现。核心契约三条：① append-only——已提交事件
 * 绝不改写；② append 在数据真正持久化后才 resolve；③ load 会"配平"被中断的尾部
 * （补齐合成收尾事件并持久化），但绝不改写已提交前缀。
 */
export abstract class SessionPersistence extends Service {
  /**
   * 【中文】构造时向 Cordis 注册固定服务名 sessionPersistence，子类无需另起服务名。
   * @param ctx - 宿主 Cordis 上下文，用于按名取依赖（如 sessions 服务）。
   */
  constructor(ctx: Context) {
    super(ctx, 'sessionPersistence')
  }

  /**
   * Resolve this backend's independent local artifact for a session without
   * reading, creating, flushing, or otherwise materializing it. Backends such
   * as SQLite that do not own one artifact per session return `undefined`.
   * @param meta - the immutable session header whose artifact is requested.
   * @returns the backend-specific absolute location, when one exists.
   */
  /*
   * 【中文】解析某会话在本后端下的独立本地工件位置——纯计算：不读盘、不建目录、
   * 不触发物化。像 SQLite 这种"全部会话共用一个库、没有单会话文件"的后端返回
   * undefined。
   * @param meta - 目标会话的头信息。
   * @returns 存在独立工件时返回其位置；否则 undefined。
   */
  abstract locate(meta: SessionHeader): SessionLocation | undefined

  /**
   * Whether this backend exposes one verbatim raw artifact per session.
   * A backend that declares `true` must override {@link readRaw}.
   */
  /*
   * 【中文】本后端是否支持"每个会话一份原样工件"的读取能力。声明 true 就必须同时
   * 重写 readRaw；调用方应先查这个开关再决定是否调 readRaw。
   */
  abstract readonly supportsRawArtifacts: boolean

  /**
   * Read a session's backend-owned artifact text verbatim — the exact durable
   * bytes the backend wrote (decoded from its physical encoding, e.g. a
   * decompressed JSONL). The returned `content` is the raw text, not a
   * reconstruction from parsed events, so it preserves backend-specific
   * serialization (chunk packing, key order, line breaks). Callers first test
   * {@link supportsRawArtifacts}; `undefined` then means only that the requested
   * session has no materialized artifact.
   * @param _id - the persisted session to read (unused by the default: no
   * per-session artifact).
   * @param signal - optional cancellation for backend read work.
   * @returns the raw artifact plus its parsed header, or `undefined` when the
   * session is absent.
   * @throws when this backend does not expose per-session raw artifacts.
   */
  /*
   * 【中文】readRaw 的默认实现：不支持原始工件的后端直接拒绝。若调用方在进入前就已
   * 取消（signal.aborted），优先用信号携带的原因失败；否则抛"后端不提供原始工件"
   * 错误。真正的读取逻辑由声明 supportsRawArtifacts = true 的子类重写。
   * @param _id - 目标会话 id（默认实现未使用，参数名下划线表示占位）。
   * @param signal - 可选取消信号。
   * @returns 恒为被拒绝的 Promise。
   */
  readRaw(_id: SessionId, signal?: AbortSignal): Promise<SessionRawArtifact | undefined> {
    // 进入时已取消：直接以信号原因（若是 Error）或通用文案拒绝，不做任何读盘工作。
    if (signal?.aborted === true) {
      return Promise.reject(signal.reason instanceof Error ? signal.reason : new Error('aborted'))
    }
    return Promise.reject(new Error('this session persistence backend does not expose raw artifacts'))
  }

  /**
   * Register a new session's metadata. A backend MAY defer the physical write
   * until the first {@link append} (lazy materialization), in which case a
   * created-but-never-appended session is absent from {@link list}
   * — abandoned sessions leave nothing behind.
   * @param meta - the immutable header (id, version, cwd, lineage) to record.
   */
  abstract create(meta: SessionHeader): Promise<void>

  /**
   * Durably persist a batch of events. Honors the append-only and contiguous-
   * seq contracts: the first event's `seq` MUST equal the stored next-seq
   * (after `load` has durably closed any interrupted turn). Rejects non-JSON-
   * serializable `event.data` with an error naming the offending event type.
   * @param id - the session the batch belongs to.
   * @param events - the contiguous batch to persist, in seq order.
   */
  /*
   * 【中文】把一批事件持久化落盘，是写路径的核心入口。必须同时遵守两条铁律：
   * ① 追加式——已提交内容永不改写；② seq 连续——批内首个事件的 seq 必须等于
   * 已存的下一序号。无法无损 JSON 序列化的 event.data 会报错并点名事件类型。
   * @param id - 批次所属的会话 id。
   * @param events - 按 seq 升序排列的连续事件批次。
   */
  abstract append(id: SessionId, events: readonly SessionEvent[]): Promise<void>

  /**
   * Prepare the exact unpublished Session used by resume. Implementations may
   * reuse object graphs retained by an earlier {@link inspect} after confirming
   * their durable revision is still current; disposal releases an unpublished
   * reservation. Revision retries require the durable log to remain unchanged
   * for one read/check round trip; continuous external writers may delay completion.
   * @param id - persisted session to prepare.
   * @param signal - optional cancellation for preparation work.
   * @returns one owned unpublished Session preparation.
   */
  /*
   * 【中文】prepare 的通用默认实现：先 load 出日志，再以其为种子构建一个"未发布"
   * 的 Session 准备品（供 resume 流程接管）。对事件与头信息做 structuredClone
   * 深拷贝，是为了让准备品与检视结果彻底脱钩、互不共享可变状态。
   * @param id - 要准备的已持久化会话 id。
   * @param signal - 可选取消信号。
   * @returns 一个独占的、尚未发布的 Session 准备品。
   */
  async prepare(id: SessionId, signal?: AbortSignal): Promise<SessionPreparation> {
    // 等待前后各检查一次取消，避免取消之后仍继续做无用的准备工作。
    signal?.throwIfAborted()
    const loaded = await this.load(id)
    signal?.throwIfAborted()
    const sessions = this.ctx.get('sessions')
    if (sessions === undefined) {
      throw new Error('cannot prepare a session: SessionStore is not configured')
    }
    // 以持久化日志为种子创建准备品；seedSource 标记种子来自磁盘而非实时运行。
    return SessionPreparation.create(sessions.prepare(id, {
      seed: loaded.events.map(event => structuredClone(event)),
      meta: structuredClone(loaded.meta),
      seedSource: 'persistence',
    }))
  }

  /**
   * Load an immutable balanced logical view and commit any required cold
   * recovery. A complete interrupted final turn is preserved and durably
   * closed with missing tool errors plus any open step and turn boundaries;
   * only a torn final record is discarded. Unknown versions and corruption in
   * the committed prefix reject. Implementations MUST NOT crash-repair an
   * identity still bound to a live Session: a balanced live log may return as a
   * durable snapshot, while an open live turn rejects. Returned values may be
   * shared with immutable live or prepared state and must not be mutated.
   * Revision-based implementations may wait for one stable read/check round trip.
   * @param id - the persisted session to reload.
   * @returns the header and a log ending on a balanced `turn/end`.
   */
  /*
   * 【中文】加载 = 读日志 + 必要时提交"冷恢复"。若最后一轮对话因崩溃而完整地停在
   * 半路，会补齐缺失的合成收尾事件（工具错误、step/end、turn/end 等）并把修复
   * 持久化；只有物理上残缺的最后一行会被丢弃。未知版本、已提交前缀中的损坏都会
   * 报错。特别注意：绝不能对仍绑定活跃 Session 的身份做这种崩溃修复——配平的
   * 活跃日志可作为持久快照返回，但开着回合的活跃日志必须拒绝。
   * @param id - 要重新加载的会话 id。
   * @returns 头信息 + 以配平后的 turn/end 收尾的日志。
   */
  abstract load(id: SessionId): Promise<SessionInspection>

  /**
   * Inspect an immutable logical session without committing recovery or
   * publishing it. A cold complete interrupted turn receives synthetic closers
   * in memory and a torn physical tail remains untouched. An already-live
   * Session instead yields its current immutable snapshot, which may contain an
   * open turn and its `session/end-seed` boundary. Coordinator-backed
   * implementations retain the exact cold unpublished Session for bounded
   * reuse by a later {@link prepare}. A stale ready source is reloaded; a source
   * already committing or reserved for resume remains exclusive, and inspection
   * may borrow its immutable view. Callers borrow only the immutable header and
   * log. Continuous external writers may delay revision convergence.
   * @param id - the persisted session to inspect.
   * @param signal - optional cancellation for queued and backend read work.
   * @returns the validated header and current logical event log.
   */
  /*
   * 【中文】"只看不改"版加载：不提交任何修复（冷数据里中断回合的合成收尾只存在于
   * 返回值的内存副本中）、不发布会话；残缺的物理尾部原样不动。若该 id 已有活跃
   * Session，就直接借用其当前不可变快照（可能含未关闭的回合及其 session/end-seed
   * 边界）。协调器实现还会把冷读结果暂存，供随后的 prepare 有限度复用。
   * @param id - 要检视的会话 id。
   * @param signal - 可选取消信号。
   * @returns 校验过的头信息与当前事件日志。
   */
  abstract inspect(id: SessionId, signal?: AbortSignal): Promise<SessionInspection>

  /**
   * Read the stored events from `fromSeq` onward — the read-from-seq
   * primitive for read models that resume from a watermark (e.g. a persisted
   * projection cache folding only the tail past its checkpoint). Unlike
   * {@link inspect}, it is a detached physical suffix read: no preparation
   * cache, torn-tail truncation, synthetic closers, or coordinator-state
   * publication. Only events from the valid contiguous stored prefix are
   * returned, so a torn fragment never reaches the caller. `fromSeq` at or
   * beyond the stored prefix returns an empty event list (never an error).
   * Backends whose medium can seek by seq
   * (SQLite) read only the suffix; sequential media (JSONL, both encodings)
   * still parse the whole artifact and skip forward — the primitive bounds
   * what is RETURNED and refolded, not every backend's physical read.
   * @param id - the persisted session to read.
   * @param fromSeq - first event seq to include; a non-negative safe integer.
   * @param signal - optional cancellation for queued and backend read work.
   * @returns the header and the stored events with `seq >= fromSeq`.
   */
  /*
   * 【中文】"从第 fromSeq 条起向后读"的原语，服务于增量消费方：例如带水位线
   * （checkpoint）的投影缓存只需折叠新增的尾部。与 inspect 的本质区别是纯物理读取：
   * 不截断尾巴、不补合成事件、不碰准备缓存与发布状态。只返回有效连续前缀内的事件，
   * 残缺碎片永远不会漏给调用方；fromSeq 超出范围时返回空列表而非报错。能按 seq 寻址
   * 的介质（SQLite）可直读后缀；JSONL 这类顺序介质仍要解析整个文件再跳过前段——
   * 本原语约束的是"返回/重放什么"，不是每个后端的物理读法。
   * @param id - 目标会话 id。
   * @param fromSeq - 返回结果包含的第一个事件 seq（非负安全整数）。
   * @param signal - 可选取消信号。
   * @returns 头信息与所有 seq >= fromSeq 的已存事件。
   */
  abstract readFrom(id: SessionId, fromSeq: number, signal?: AbortSignal):
  Promise<{ meta: SessionHeader; events: SessionEvent[] }>

  /**
   * Lightweight listing from metadata, without a full-log parse.
   * @param signal - optional cancellation for backend listing work.
   * @returns one header per materialized session.
   */
  /*
   * 【中文】轻量列举所有"已物化"（真正落过盘）的会话：每条只读头信息，不解析整份
   * 日志，成本与会话数量成正比而与会话长度无关。
   * @param signal - 可选取消信号。
   * @returns 每个已物化会话一条头信息。
   */
  abstract list(signal?: AbortSignal): Promise<SessionHeader[]>

  /**
   * List materialized sessions with cheap per-log change tokens.
   *
   * Repeated observations of an unchanged log return the same revision. A
   * successful mutating {@link load} repair changes the next listed revision.
   * Revisions also distinguish independently backed stores so backend-local
   * counters cannot compare equal across different persistence sources.
   * @param signal - optional cancellation for backend snapshot-listing work.
   * @returns one header and opaque revision per materialized session without loading full logs.
   */
  /*
   * 【中文】在 list 基础上为每个日志附加廉价变更令牌（revision）：对同一份不变的日志
   * 反复观察得到相同令牌；一次成功的 load 修复会改变下次列出的令牌；不同后端/
   * 存储源的令牌互相隔离、不会撞号。适合实现"哪些会话有新内容"的轮询判断。
   * @param signal - 可选取消信号。
   * @returns 每个已物化会话一条 {头信息, 修订号} 快照。
   */
  abstract listSnapshots(signal?: AbortSignal): Promise<SessionPersistenceSnapshot[]>
}

export default SessionPersistence
