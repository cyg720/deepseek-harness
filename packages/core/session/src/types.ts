/*
 * ================================ 文件注释 ================================
 * 【文件职责】定义会话（Session）子系统的全部核心数据类型：会话身份（SessionId）、磁盘格式版本常量、
 *           会话头（SessionHeader）及其创建/恢复选项、轮次结束原因、待办条目（TodoItem）、请求头快照
 *           （EpochHeader）、路由元数据（RequestContext），以及最核心的事件词汇表 SessionEventMap 与
 *           单条事件信封 SessionEvent，另有“表面（surface）”相关类型（SurfaceEventType/SurfaceOp 等）。
 * 【技术维度】TypeScript 类型体操：品牌化类型（Branded<T>，给裸 string 加编译期标记防止不同 id 混用）、
 *            声明合并的可扩展映射（插件可通过 interface 合并向 SessionEventMap 追加自己的事件类型）、
 *            映射类型 + 条件类型（SessionEvent 用 [K in SessionEventType] 加条件分支生成判别联合）。
 * 【产品维度】本项目的会话日志是权威事件流：模型看到的每一条输入都必须能从这份日志重建出来。
 *            这里定义的类型就是日志的“词汇表”，持久化后端、UI 回放、SDK 导出全都围绕它工作。
 * 【逻辑维度】按代码出现顺序：JsonValue 的客户端安全再导出与会话身份；格式版本常量与会话头；
 *            创建/恢复选项与取消原因、轮次结束原因映射、待办条目；请求头快照与路由元数据；
 *            最后是 SessionEventMap 中逐个事件的语义说明与事件信封 SessionEvent 的字段推导。
 * 【关键边界】SESSION_FORMAT_VERSION 当前恒为 0：结构不兼容直接拒绝加载、无迁移；只有 user/message、
 *            assistant/message、tool/result 三类“表面事件”允许携带 surfaceOp/sourceEventSeqs，
 *            其余事件携带会被编译器拒绝；事件缺省视为必需，读取端遇到不认识的必需类型必须拒绝重建。
 * 【新手阅读建议】先通读 SessionEventMap 里每种事件的形状与语义注释，建立“一次 agent 对话在日志里
 *            长什么样”的整体印象；再读 SessionEvent 信封理解 seq/time/ignorable 与表面字段的来历；
 *            最后回头看 SESSION_FORMAT_VERSION 与 SurfaceOp 的长注释，理解版本判据与替换式表面节点机制。
 * ==========================================================================
 */
import type { Branded } from '@deepseek-ai/dsh-brand'
import type {
  AssistantMessage,
  ToolCallId,
  LlmCallConfig,
  LlmCallConfigAdapterDefaults,
  LlmFailure,
  StreamChunk,
  TokenUsage,
  ToolResultMessage,
  ToolSchema,
  UserMessage,
} from '@deepseek-ai/dsh-llm'
import type { JsonValue } from './json.ts'

// The lossless-JSON payload type belongs to this client-safe face too: a wire
// contract carrying JSON data must not import the root entry, which merges
// `ctx.sessions` (a Host-only SessionStore) into every consumer's program.
// 中文说明：JsonValue 也归入这个“客户端安全”出口——承载 JSON 数据的线上契约不能引到根入口，
// 因为根入口会把仅限宿主端使用的 ctx.sessions（SessionStore）合并进每个消费方的程序。
export type { JsonValue } from './json.ts'

/** Identifies one session in the store (and its persistence artifacts). */
export type SessionId = Branded<'SessionId'>

/**
 * Brand a string as a {@link SessionId}.
 * @param id - the raw session id string.
 * @returns the same string, branded (a compile-time cast — no runtime cost).
 */
/*
 * 把一个普通字符串标记为 {@link SessionId} 的工厂函数。
 * 纯编译期类型断言，运行时没有任何开销。
 * @param id - 原始的会话 id 字符串。
 * @returns 同一个字符串，只是带上了品牌标记。
 */
export function SessionId(id: string): SessionId {
  return id as SessionId
}

/**
 * The on-disk session format version, stamped into every newly-written {@link SessionHeader}
 * and enforced by every persistence backend on load. The single source of truth for the
 * version — write sites and the load-time check all read it.
 * While the harness is unreleased it is pinned at `0`: no compatibility is
 * implied, incompatible logs are rejected, and no migration is provided.
 *
 * The version is a single monotonic integer with no major/minor split. Whether
 * a bump is needed is decided by what the WRITER emits, never by what a newer
 * reader can accept: bump exactly when an older runtime could no longer handle
 * a new log with full semantic correctness ("parses without error" is not
 * correctness — silently skipping content that shapes reconstruction is a
 * wrong read). Only structural changes reach that bar: the header shape, the
 * {@link SessionEvent} envelope, core event semantics, or the surface
 * mechanism (the {@link SurfaceEventType} set and {@link SurfaceOp} variants).
 * Adding an ordinary event type does not bump: the generated known-event guard
 * makes older runtimes refuse logs containing a type they do not understand.
 * When in doubt, bump: a near-identity upgrade step is almost free, a missed
 * bump makes older runtimes read new logs wrong silently. The full mechanism
 * (upgrade-step chain, in-memory view conversion, migrate-on-continue) is
 * recorded in the fail-closed-session-event-vocabulary Agent Note
 * (`.agents/notes/implemented/simplification/2026-08-25-fail-closed-session-event-vocabulary.md`).
 */
/*
 * 会话日志磁盘格式的版本号：写入每个新建的 {@link SessionHeader}，所有持久化后端加载时校验它。
 * 项目未发布前恒为 0：不做兼容承诺，不兼容的日志直接拒绝、不提供迁移。版本是单一递增整数，
 * 是否升版只看写入方产出的内容：只有结构性变化（头部形状、{@link SessionEvent} 信封、核心事件
 * 语义、表面机制）才升版；新增普通事件类型不需要（由逐事件的 ignorable 标记兜底）。拿不准就升版：
 * 近乎空转的升级步骤几乎零成本，漏升会让旧运行时静默读错新日志。
 */
export const SESSION_FORMAT_VERSION = 0

/**
 * Immutable validated storage metadata, kept outside the conversation event log.
 */
/*
 * 已校验、不可变的存储元数据，保存在会话事件日志之外（不参与事件重放）。
 * 由 store 在创建会话时组装并冻结；恢复路径则直接校验并接管现成的一份。
 */
export interface SessionHeader {
  /**
   * On-disk format version, stamped from {@link SESSION_FORMAT_VERSION} when the
   * session is created. A persistence backend rejects any other version on load
   * (no migration — see the constant).
   */
  /* 磁盘格式版本：创建时取自 SESSION_FORMAT_VERSION；加载时遇到其他值一律被后端拒绝（无迁移）。 */
  readonly version: number
  /** The session's id (mirrors the {@link Session}'s id). */
  /* 会话 id（与会话对象上的 id 一致）。 */
  readonly id: SessionId
  /** Non-negative safe-integer Unix epoch milliseconds when the session was created. */
  /* 会话创建时间：非负安全整数范围内的 Unix 纪元毫秒数。 */
  readonly createdAt: number
  /** Absolute working directory the session was created in (if any). */
  /* 创建会话时所在的工作目录绝对路径（可能缺省）；存储后端靠它定位目录。 */
  readonly cwd?: string
  /** The session this one was forked from (seed lineage), if any. */
  /* 若本会话由某个已有会话 fork（分叉）而来，记录其母会话 id。 */
  readonly parentSession?: SessionId
  /**
   * How many leading events were inherited through a seed. Persisting this
   * boundary lets resume and replay distinguish parent history from child work.
   */
  /* 通过种子（seed）继承了开头多少条事件；把这个边界持久化，resume/replay 才能区分父历史与子工作。 */
  readonly seedLength?: number
  /**
   * Coarse product classification for a session created as a subagent child.
   * This is presentation metadata, not proof that the child is continuable.
   */
  /* 子代理（subagent）子会话的粗粒度产品分类；只是展示元数据，不代表该子会话可以继续对话。 */
  readonly origin?: 'subagent'
  /**
   * Delegation depth: absent (zero) for a top-level session, parent depth + 1
   * for a subagent child. Persisted so a recursion budget survives restart and
   * resume — a runtime-only depth would reset a resumed child to top-level.
   */
  /* 委派深度：顶层会话缺省（视为 0），子代理为父深度 + 1；持久化它使递归预算在重启/恢复后仍然有效。 */
  readonly delegationDepth?: number
  /**
   * Id of the agent preset this session's agent was composed from, when the
   * deployment composes per session. Durable because the preset decides the
   * session's tools and prompt: a resume that restored a different composition
   * would replay history the model can no longer act on.
   */
  /* 组成该会话代理所用 preset 的 id；preset 决定工具与提示词——恢复时若换成另一套组合，模型将无法对历史继续行动。 */
  readonly agentPreset?: string
}

/**
 * Options for creating a {@link Session} via the store. `seed` replays/forks
 * an existing event log; `meta` carries the caller-supplied storage fields the
 * store folds into a {@link SessionHeader}.
 */
/*
 * 通过 store 创建 {@link Session} 时的选项：seed 用于重放/fork 一份已有的事件日志；
 * meta 携带调用方提供的存储字段，store 会把它们折叠进一个 {@link SessionHeader}。
 */
export interface CreateSessionOptions {
  /** Initial replay or fork history supplied at construction. */
  /* 构造时提供的初始重放或 fork 历史。 */
  readonly seed?: readonly SessionEvent[]
  /**
   * Storage metadata read once before publication. `seedLength` is explicit
   * because a resumed seed contains the full stored log, not only its inherited prefix.
   */
  /* 发布前一次性读取的存储元数据（各字段含义与 SessionHeader 同名字段一致）；
   *  seedLength 必须显式给出，因为恢复型种子包含的是完整已存日志，而不仅是继承的前缀。 */
  readonly meta?: {
    readonly cwd?: string
    readonly parentSession?: SessionId
    readonly createdAt?: number
    readonly seedLength?: number
    readonly origin?: 'subagent'
    readonly delegationDepth?: number
    readonly agentPreset?: string
  }
}

/**
 * Fresh storage values transferred to {@link SessionStore.prepare} without a
 * second serialization copy. Callers retain no mutable aliases.
 */
/*
 * 不做第二次序列化拷贝、直接转移给 {@link SessionStore.prepare} 使用的新鲜存储值。
 * 调用方此后不得保留对这些对象的任何可变别名。
 */
export interface RestoredSessionOptions {
  /** Fresh detached storage events to validate and freeze in place. */
  /* 待就地校验并冻结的新鲜、已分离的存储事件数组。 */
  readonly seed: SessionEvent[]
  /** Fresh detached storage metadata to validate and freeze in place. */
  /* 待就地校验并冻结的新鲜、已分离的存储元数据。 */
  readonly meta: SessionHeader
  /** Select the persistence ownership-transfer path. */
  /* 字面量标记：选择“持久化所有权转移”路径。 */
  readonly seedSource: 'persistence'
}

/** Inputs accepted while constructing an unpublished Session. */
/* 构造未发布 Session 时接受的输入：普通创建选项，或带所有权转移的恢复选项。 */
export type PrepareSessionOptions =
  | (CreateSessionOptions & { readonly seedSource?: undefined })
  | RestoredSessionOptions

/** Why an active agent driver was cancelled. */
/*
 * 活动中的 agent 驱动被取消的原因：
 * - user：用户主动取消；
 * - parent：父会话/父代理取消；
 * - hook：钩子拦截，附 reason 说明；
 * - disposed：所在上下文被销毁。
 */
export type AgentCancelCause =
  | { readonly kind: 'user' }
  | { readonly kind: 'parent' }
  | { readonly kind: 'hook'; readonly reason: string }
  | { readonly kind: 'disposed' }

/** Durable cancellation cause, including imports whose original coarse record carried no cause. */
/* 可持久化的取消原因：在 AgentCancelCause 基础上增加 legacy——旧导入记录原本没有粗粒度原因时的占位。 */
export type TurnEndCancelCause = AgentCancelCause | { readonly kind: 'legacy' }

/**
 * Why a turn ended. Merge-extensible sum type.
 */
/*
 * 一个轮次（turn）为什么结束。可合并扩展的和类型（sum type）：
 * 插件可以通过声明合并向该映射追加新的结束原因变体。
 * 术语说明：“轮次”指从认领用户输入到本轮响应结束的一个交互单元。
 */
export interface TurnEndReasonMap {
  completed: { kind: 'completed' }
  /** A cancellation request interrupted the live turn. */
  /* 取消请求打断了正在进行的轮次；reason 说明取消方。 */
  aborted: { kind: 'aborted'; reason: TurnEndCancelCause }

  blocked: { kind: 'blocked' }
  /**
   * The turn failed. `error` is always a structured failure: the `LlmError`
   * facts verbatim, or `{ message: errorChain(error), code: 'UNKNOWN' }`
   * flattened from any other error.
   */
  /* 轮次失败；error 恒为结构化失败信息（LlmError 的事实原样保留，或其他错误展平成 { message, code: 'UNKNOWN' }）。 */
  error: { kind: 'error'; error: LlmFailure }
  /** At least one step reached its output-token ceiling, even if a plugin continued the turn. */
  /* 至少一步触及输出 token 上限——即使某个插件让轮次继续了也会记录。 */
  'max-tokens': { kind: 'max-tokens' }
  /**
   * A persistence backend closed a crash-orphaned turn on reload. The loop never
   * emits this marker, and the events recorded before the crash remain intact.
   */
  /* 持久化后端在重新加载时关闭了一个因崩溃而孤立的轮次；循环本身从不发出此标记，崩溃前已记录的事件保持完好。 */
  interrupted: { kind: 'interrupted' }
}

/** The union over {@link TurnEndReasonMap} — why a turn ended; plugins extend it by merging variants into the map. */
/* {@link TurnEndReasonMap} 全部值的联合——轮次结束原因；插件通过向映射合并变体来扩展。 */
export type TurnEndReason = TurnEndReasonMap[keyof TurnEndReasonMap]

/**
 * Logged request state outside derived history: call config, system prompt, and
 * tools. The latest full `request/header` snapshot reconstructs it; canonical
 * empty optional fields are absent.
 */
/*
 * 记录在派生历史之外的一次模型请求状态：调用配置、系统提示词与工具集。
 * 日志中最近一条完整的 request/header 快照即可重建它；规范的空可选字段以“缺失”表示。
 * 术语说明：“纪元（epoch）”指两次头部快照之间配置保持不变的区间。
 */
export interface EpochHeader {
  /** The conversation's call configuration (provider, model, reasoning effort, and sampling scalars). */
  /* 本次对话的调用配置（提供方、模型、推理力度及采样参数）。 */
  config: LlmCallConfig
  /** Effective config fields materialized from the exact adapter rather than proposed by a caller. */
  /* 由具体适配器实际落实（而非调用方提议）的配置字段标记。 */
  adapterDefaults?: LlmCallConfigAdapterDefaults
  /** Rendered system prompt text; absent for a system-less request. */
  /* 渲染后的系统提示词文本；无系统提示的请求则缺省。 */
  system?: string
  /** Assembled tool schemas; absent for a tool-less request. */
  /* 组装好的工具 schema 列表；无工具请求则缺省。 */
  tools?: ToolSchema[]
}

/** Registration-bound metadata for one resolved model route. */
/* 一次已解析模型路由的注册期元数据（哪个 provider/model、上下文窗口多大）；仅在变化时写入日志。 */
export interface RequestContext {
  /** Registered provider route the metadata belongs to. */
  /* 元数据所属的已注册提供方（provider）路由名。 */
  provider: string
  /** Provider-owned model id the metadata belongs to. */
  /* 该提供方下的模型 id。 */
  model: string
  /** Maximum combined request and response context in tokens, when advertised. */
  /* 公布出的“请求+响应”合计上下文窗口大小（token 数），未公布则缺省。 */
  contextWindow?: number
}

/**
 * Why a `request/header` snapshot was appended: `'initial'` — the log's first
 * header (a new conversation); `'resume'` — a loop instance's first request
 * over a log that already has header events (process restart, fork seed);
 * `'change'` — a later request used a different header, with `startsSeries`
 * preserving a coincident series boundary; `'series'` — an unchanged header
 * began an explicitly distinct message series or followed a surface replacement.
 */
export type RequestHeaderReason = 'initial' | 'resume' | 'change' | 'series'

/**
 * The merge-extensible, append-only source of truth for an agent interaction.
 * Message history is derived from this log. Every event is lossless JSON and
 * sequence numbers stay contiguous, including raw chunks, so persistence can
 * store the canonical log verbatim.
 */
/*
 * 会话事件词汇表：agent 交互的可合并扩展、只追加的事实来源（source of truth）。
 * 消息历史就是从这份日志派生出来的。每个事件都是无损 JSON，序号（seq）保持连续
 * （包括原始流块在内），因此持久化层可以原封不动地存储规范日志。
 *
 * 阅读前先记住三个词：
 * - turn（轮次）：从认领用户输入到本轮响应结束的一个交互单元；
 * - step（步骤）：一次模型调用加上它触发的全部工具执行；
 * - surface（表面）：对“会产生 LLM 消息的事件”维护的有序视图，模型可见输入由它派生。
 */
export interface SessionEventMap {
  /**
   * Opens turn `turn` before the loop claims queued input or runs pre-step.
   * Rejection, empty input, cancellation, or failure may close it with no
   * step; otherwise the following identified `user/message` event or batch
   * records the messages entering the step.
   */
  /* 在循环认领排队输入或执行前置步骤之前，打开第 turn 个轮次；被拒绝、空输入、取消或失败都可能让该轮没有任何 step 就关闭。 */
  'turn/start': { turn: number }
  /**
   * Closes turn `turn` with the {@link TurnEndReason} that ended it. A turn
   * with no entered step has no `step/start` or `step/end`. The loop does not await a
   * flush at turn boundaries: `dsh-session-checkpoint-policy` owns the
   * per-request durability checkpoint, and consumers that read storage after
   * `whenIdle()` flush themselves. Success commits the turn; rejection is
   * reported live and does not prevent later work.
   */
  /* 以结束原因关闭第 turn 个轮次；没有进入过 step 的轮次就没有 step/start 与 step/end。轮边界处循环不等待落盘：由 checkpoint-policy 插件负责每请求的持久化检查点，读完存储的消费者自行冲刷。 */
  'turn/end': { turn: number; reason: TurnEndReason }
  /** Opens step `step` of turn `turn` — one model call plus the tool executions it requested. */
  /* 打开第 turn 轮的第 step 步——一次模型调用加上它要求的全部工具执行。 */
  'step/start': { turn: number; step: number }
  /** Closes step `step` of turn `turn`. */
  /* 关闭第 turn 轮的第 step 步。 */
  'step/end': { turn: number; step: number }
  /**
   * A user-role message on the model-visible surface: a direct human prompt
   * (the queued message claimed for this turn), a synthetic `agent.inject()`
   * context (file-change notices, subdir AGENTS.md, skill content, cron
   * notifications, …), or an entered goal continuation round. All three
   * project their `content` verbatim; `source` tells them apart.
   */
  /*
   * 模型可见表面上的一条 user 角色消息：可能是人类直接输入（本轮认领的排队
   * 消息）、agent.inject() 注入的合成上下文（文件变更通知、子目录 AGENTS.md、
   * 技能内容、定时通知等）、或目标延续回合。三者都原样投影 content，用
   * source 区分来源。
   */
  'user/message': UserMessage
  /** Raw stream chunk — token-level replay fidelity. */
  /* 原始流块——保证 token 级重放保真的数据。 */
  'assistant/chunk': { turn: number; step: number; chunk: StreamChunk }
  /**
   * Assembled assistant message for one step (derived history uses this).
   * Carries the step's `usage` when the adapter reported token accounting, so
   * the model output and its accounting travel together (there is no separate
   * usage record). `usage` is absent when the adapter reported none. A turn
   * cancelled mid-stream finalizes its delivered text/reasoning prefix as this
   * event with `interrupted: true`; undispatched tool calls are absent. The
   * marker distinguishes that prefix without re-deriving interruption from turn
   * boundaries. An aborted turn with no such event streamed no visible content.
   */
  /*
   * 一步组装完成的 assistant 消息（派生历史使用它）。适配器报告了 token 统计
   * 就随事件携带 usage（没有单独的用量记录，输出与账目同行）。中途取消的轮次
   * 会把已送达的文本/推理前缀以此事件落盘并标 interrupted: true，未派发的
   * 工具调用不会出现——该标记无需从轮次边界重新推断中断。被中止的轮次若没有
   * 此事件，说明没有流出任何可见内容。
   */
  'assistant/message': { turn: number; step: number; message: AssistantMessage; usage?: TokenUsage; interrupted?: true }
  /**
   * The model requested one tool invocation: `name` with the raw `arguments`
   * JSON string exactly as the model produced it (unparsed). `callId` pairs the
   * call with its `tool/result`.
   */
  'tool/call': { turn: number; step: number; callId: ToolCallId; name: string; arguments: string }
  /**
   * A completed tool call's model-facing result, optional internal failure
   * identity, and optional tool-private `meta` presentation payload. `meta` is
   * opaque to the core (the producing tool owns its shape and reads it back in
   * `presentResult`) but MUST be JSON-serializable: `Session.append`
   * runtime-validates all event data with `isJsonValue`, so a non-serializable
   * `meta` is rejected at the source, and the durable log reproduces the
   * identical card on replay. Absent
   * unless the tool attaches one (e.g. `dsh-tool-fs` carries its result-time
   * contextual diff here).
   */
  /*
   * 已完成工具调用的模型侧结果 message、可选的内部失败标识 error、可选的
   * 工具私有展示载荷 meta。meta 对核心不透明（由产生它的工具定义形状并在
   * presentResult 读回），但必须可 JSON 序列化——Session.append 会用
   * isJsonValue 校验，不可序列化的 meta 在源头就被拒绝，耐久日志重放时能
   * 还原出完全相同的卡片。
   */
  'tool/result': {
    turn: number
    step: number
    message: ToolResultMessage
    error?: { name: string; code: string }
    meta?: JsonValue
  }
  /**
   * Full header for the next request, appended inside its step before dispatch.
   * It is log-only; the latest snapshot reconstructs the request header.
   */
  'request/header': {
    header: EpochHeader
    reason: RequestHeaderReason
    /** A changed header also begins a distinct model-message series. */
    startsSeries?: true
  }
  /**
   * Route metadata for the next request, logged only when the route or capacity
   * changes. It does not participate in request reconstruction or header equality.
   */
  /* 下一次请求的路由元数据；仅在路由或容量变化时记录。不参与请求重建，也不参与头部相等性比较。 */
  'request/context': RequestContext
  /**
   * Marks the end of a constructor seed. Events before it have smaller seq
   * values and came from the seed (resume, fork, or replay); this lifecycle
   * produced none of them. This log-only event is the durable projection of
   * {@link Session.firstLiveSeq}. Its payload is empty — position and `time`
   * carry the meaning.
   *
   * Locate the LAST one in stored history. A seed already ending in one is not
   * re-marked, so reopening an untouched session does not grow its log per
   * pickup and the event need not be at the current `firstLiveSeq`.
   *
   * `Session`'s constructor is the only legitimate writer. The invariant
   * companion deliberately constrains nothing here, so a plugin appending one
   * would silently classify every live bracket before it as seed history.
   *
   * An owner of a standalone open/close bracket (`compaction/start` …
   * `compaction/end`) reads it because seed history and live work are otherwise
   * byte-identical: an unmatched opening marker before this event belongs to
   * an ended lifecycle, whatever ended it. NOT a liveness signal about other
   * writers — a concurrently live session holds its own boundary elsewhere,
   * so tolerating concurrent writers needs a signal beyond the log.
   */
  /*
   * 标记构造种子的终点：它之前（seq 更小）的事件都来自种子（resume/fork/replay），
   * 本生命周期从未产生过它们。这是 Session.firstLiveSeq 在日志中的持久化投影，
   * 载荷为空——位置和时间本身就是含义。读取存储历史时应定位“最后一条”该事件：
   * 种子若已以其结尾则不再重复标注，避免每次打开未动过的会话都让日志增长。
   * 只有 Session 的构造函数有权写入此事件。
   */
  'session/end-seed': Record<string, never>
}

/** The appendable event-type keys of {@link SessionEventMap}, plugin-merged extensions included. */
/* {@link SessionEventMap} 全部可追加的事件类型键（含插件声明合并进来的扩展）。 */
export type SessionEventType = keyof SessionEventMap

/**
 * The subset of {@link SessionEventType} values whose events produce LLM
 * messages and are eligible to appear on the ordered surface. Only these
 * event types may carry {@link SurfaceOp} and {@link SessionEvent.sourceEventSeqs}.
 */
/*
 * {@link SessionEventType} 中“会产生 LLM 消息、因而有资格进入有序表面”的那部分事件类型。
 * 也只有它们可以携带 {@link SurfaceOp} 与 {@link SessionEvent.sourceEventSeqs}。
 */
export type SurfaceEventType =
  | 'user/message'
  | 'assistant/message'
  | 'tool/result'

/**
 * A {@link SessionEvent} that is **on** the ordered surface — its
 * `surfaceOp` is guaranteed present (mandatory), narrowed from a
 * surface-eligible {@link SessionEvent} by checking both `type` and
 * `surfaceOp` at runtime.
 *
 * Use the `isSurfaceEvent` type guard (in `surface.ts`) to narrow a
 * `SessionEvent` to this type.
 */
/*
 * 一个“已经**在**有序表面上”的 {@link SessionEvent}——其 surfaceOp 必然存在（强制）。
 * 由运行时同时检查 type 与 surfaceOp，从表面合格的 {@link SessionEvent} 收窄而来。
 * 请用 surface.ts 的 isSurfaceEvent 类型守卫来收窄。
 */
export type SurfaceEvent = SessionEvent<SurfaceEventType> & { surfaceOp: SurfaceOp }

/**
 * How a session event entered the ordered surface. Only valid on
 * {@link SurfaceEventType} events.
 *
 * - `'append'`: added to the tail — normal path for user/assistant/tool
 *   messages.
 * - `{ op: 'replace', start, end }`: replaces surface nodes from `start`
 *   (inclusive) through `end` (inclusive) with this node. Both must exist as
 *   surface nodes in the current surface. `start === end` replaces a single
 *   node. The node's {@link SessionEvent.sourceEventSeqs} must include every
 *   shadowed surface node. Used by compaction; any surface-replacing producer
 *   may use it.
 */
/*
 * 一个会话事件如何进入有序表面（仅对表面事件类型合法）：
 * - 'append'：追加到尾部——用户/助手/工具消息的正常路径；
 * - { op:'replace', start, end }：用本节点替换表面上 [start, end]（闭区间）内的既有节点，
 *   start 与 end 都必须已是当前表面上的节点；start === end 即替换单个节点；
 *   本事件的 {@link SessionEvent.sourceEventSeqs} 必须涵盖全部被遮蔽的表面节点。
 * compaction（历史压缩）使用它；任何产生表面替换的生产者也可使用。
 */
export type SurfaceOp =
  | 'append'
  | { op: 'replace'; start: number; end: number }

/**
 * Surface placement and cited source-event seqs for {@link Session.append}. Required on
 * message-producing events and forbidden on log-only events.
 */
/* {@link Session.append} 所需的表面放置信息与被引用源事件 seq：消息类事件必填，纯日志事件禁止携带。 */
export interface SurfaceIntent {
  /* 本事件进入表面的方式（追加，或替换某个区间）。 */
  surfaceOp: SurfaceOp
  /**
   * Complete set of known source-event seqs. `assistant/message` may use a
   * present empty array for a known empty provider stream; when the field is
   * absent, the event does not record which earlier events produced the message.
   * Other surface events require a non-empty set when this field is present.
   */
  /* 完整的已知源事件 seq 集合。assistant/message 可用显式空数组表示已知为空的提供方流；缺省则表示不记录来源。其余表面事件一旦提供就必须非空。 */
  sourceEventSeqs?: number[]
}

/**
 * One immutable entry in the session log.
 *
 * A proper discriminated union over `type` (not independent `type`/`data`
 * unions), so `switch (event.type)` narrows `event.data` without casts.
 *
 * The {@link sourceEventSeqs} and {@link surfaceOp} fields are conditional:
 * they only exist on {@link SurfaceEventType} variants (`user/message`,
 * `assistant/message`, `tool/result`).
 * Non-surface events (boundary markers, chunks, usage, errors) never carry
 * surface metadata — the compiler enforces this at `Session.append()`
 * call sites.
 */
/*
 * 会话日志中的一条不可变条目。
 * 这是按 type 划分的正规判别联合（而非独立的 type/data 两个联合），
 * 因此 switch (event.type) 无需类型断言即可收窄 event.data。
 * {@link sourceEventSeqs} 与 {@link surfaceOp} 是条件字段：只存在于三类表面事件变体上；
 * 非表面事件（边界标记、chunk、usage、错误）永不携带表面元数据——编译器在
 * Session.append() 调用点强制这一点。
 */
export type SessionEvent<T extends SessionEventType = SessionEventType> = {
  [K in SessionEventType]: {
    type: K
    /** Monotonic sequence number within the session. */
    // 会话内单调递增的序号；恒等于追加时日志的长度。
    seq: number
    /** Unix epoch milliseconds. */
    // Unix 纪元毫秒时间戳（事件写入时刻）。
    time: number
    // 事件载荷，形状由 SessionEventMap 中该类型的成员决定。
    data: SessionEventMap[K]
  } & (K extends SurfaceEventType ? {
    /**
     * Seq numbers of earlier events that this event cites as sources
     * (e.g. the `assistant/chunk` seqs that built an `assistant/message`,
     * or the surface nodes shadowed by a compaction replace node). An
     * `assistant/message` may carry a present empty array for a known empty
     * provider stream; when the field is absent, the event does not record which
     * earlier events produced the message.
     */
    /*
     * 本事件引用为来源的更早事件的 seq 集合（例如拼出 assistant/message 的那些
     * assistant/chunk 的 seq，或被 compaction 替换节点遮蔽的表面节点）。
     * assistant/message 可用显式空数组表示已知为空的提供方流；缺省则不记录来源。
     */
    sourceEventSeqs?: number[]
    /** How this event entered the surface; absent for non-surface events. */
    /* 本事件进入表面的方式；非表面事件缺省。 */
    surfaceOp?: SurfaceOp
  } : object)
}[T]
