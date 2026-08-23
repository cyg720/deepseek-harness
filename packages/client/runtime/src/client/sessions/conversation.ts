/**
 * ================================ 文件注释 ================================
 * 【文件职责】会话对话数据模型：ConversationSnapshot / ConversationNode——
 *   逻辑层喂给 UI 的唯一数据形状，以及所有节点类型、请求配置、队列、
 *   局部助手、组合器阶段等类型定义。
 * 【技术维度】纯类型 + 少量纯函数：发布契约要求每次变更替换顶层对象、
 *   未变子结构保持引用（React.memo 前提）；节点 store 与位置索引是稳定的
 *   活读取器，旧快照不是时间点视图。
 * 【产品维度】聊天消息流、工具卡片、压缩标记、命令、上下文注入等全部
 *   UI 渲染形状都在这里定义；空快照常量供未注册视图前使用。
 * 【逻辑维度】先定义块/消息类节点（user/assistant/steering/context/retry/
 *   error/max-tokens/tool-result/command/compaction/unknown），再聚合为
 *   ConversationNode；随后是运行中调用、队列、局部助手、组合器阶段、
 *   快照面（Chat/Conversation）与空常量。
 * 【关键边界】callId/approvalId 在此保持普通 string（方便时再收窄品牌）；
 *   窗口截断会使 call 头/摘要等字段为 null（软降级而非丢行）。
 * 【新手阅读建议】先看 ConversationNode 联合与 ConversationSnapshot 面。
 * ==========================================================================
 */
// ConversationSnapshot / ConversationNode: the only data shape the logic layer feeds the UI.
// Publication contract: every change swaps the top-level object; unchanged
// substructures keep their references (the React.memo premise). Chat node and
// Location stores are stable live readers, so old snapshots are not time-point
// views. callId/approvalId stay plain string here (narrow to real brands when
// convenient).
// ConversationSnapshot / ConversationNode：逻辑层喂给 UI 的唯一数据形状。
// 发布契约：每次变更替换顶层对象；未变子结构保持引用（React.memo 前提）。
// Chat 节点与位置存储是稳定的活读取器，因此旧快照不是时间点视图。
// callId/approvalId 在这里保持普通 string（方便时再收窄为真正的品牌）。

import type { CommandId } from '@deepseek-ai/dsh-commands/brand'
import type { MessageId } from '@deepseek-ai/dsh-llm/brand'
import type { ContentBlock } from '@deepseek-ai/dsh-llm/types'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { LlmRetryEventData } from '@deepseek-ai/dsh-llm-retry/types'
import type { TodoItem } from '@deepseek-ai/dsh-session/types'
import type {
  RpcError, SessionId, SubagentAddress, ToolCallView, ToolResultView,
} from '@deepseek-ai/dsh-api-remotes/client'
import type { PendingInteraction } from './pending.ts'
import type { ContextProvenanceView, KnownContextForm } from './context-provenance.ts'
import type {
  ChatConversationViewNode, ConversationTimelineSnapshot, ConversationViewSnapshotStore,
} from '../contract/conversation.ts'
export type { TodoItem }

/** Request configuration recorded for one provider call. */
/** 为一次提供者调用记录的请求配置。 */
export interface AssistantRequestConfig {
  provider: string
  model: string
  purpose?: string
  thinking?: string
  reasoningEffort?: string
  temperature?: number
  maxTokens?: number
  stop?: readonly string[]
}

/** Stable provider/model identity reported for one completed request. */
/** 一次已完成请求报告的稳定提供者/模型身份。 */
export interface AssistantProvenanceView {
  provider: string
  model: string
}

/** Assistant content blocks sorted by what the UI cares about
 *  (text body / collapsible reasoning / tool-call card head / other fallback). */
/**
 * 助手内容块，按 UI 关心的方式分类（文本主体 / 可折叠推理 / 工具调用
 * 卡片头 / 其他兜底）。
 */
export type AssistantBlock =
  | { kind: 'text'; text: string }
  | { kind: 'reasoning'; text: string }
  | { kind: 'image'; attachment: ImageAttachmentRef }
  | { kind: 'tool-call'; callId: string; name: string; argsRaw: string }
  | { kind: 'other'; block: unknown }

/**
 * core ContentBlock[] -> AssistantBlock[] (classifier shared by finalized messages and partial block-end).
 * @param content - core content blocks verbatim.
 * @returns UI-classified blocks in source order.
 */
/**
 * 核心 ContentBlock[] -> AssistantBlock[]（最终消息与部分块结束共享的分类器）。
 * @param content 原样的核心内容块。
 * @returns 按源顺序的 UI 分类块。
 */
export function toAssistantBlocks(content: readonly ContentBlock[]): AssistantBlock[] {
  return content.map(toAssistantBlock)
}

/**
 * Classify one block (ToolCallBlock fields are id/arguments, mapped to callId/argsRaw).
 * @param block - one core content block.
 * @returns the UI classification.
 */
/**
 * 分类单个块（ToolCallBlock 字段是 id/arguments，映射为 callId/argsRaw）。
 * @param block 一个核心内容块。
 * @returns UI 分类。
 */
export function toAssistantBlock(block: ContentBlock): AssistantBlock {
  switch (block.type) {
    case 'text': return { kind: 'text', text: block.text }
    case 'reasoning': return { kind: 'reasoning', text: block.text }
    case 'image': return { kind: 'image', attachment: block.attachment }
    case 'tool-call': return { kind: 'tool-call', callId: String(block.id), name: block.name, argsRaw: block.arguments }
    default: return { kind: 'other', block }
  }
}

/** A finalized user message. */
/** 一条已完成的用户消息。 */
export interface UserMessageNode {
  kind: 'user'
  seq: number
  /** Unix epoch ms from the source session event. */
  /** 来自源会话事件的 Unix 毫秒时间戳。 */
  time: number
  content: readonly ContentBlock[]
  source: unknown
}

/** Recorded boundaries used to derive assistant latency and throughput. */
/** 用于推导助手延迟与吞吐的记录边界。 */
export interface AssistantTiming {
  /** Matching step/start timestamp, or null when it is outside the current event window. */
  /** 匹配的 step/start 时间戳；在事件窗口外时为 null。 */
  stepStartTime: number | null
  /** First non-empty text/reasoning/tool delta timestamp, or null when no token delta was recorded. */
  /** 首个非空文本/推理/工具增量时间戳；无 token 增量记录时为 null。 */
  firstTokenTime: number | null
  /** Final assistant/message timestamp. */
  /** 最终 assistant/message 时间戳。 */
  completedTime: number
}

/** A finalized assistant message or an interruption-frozen streaming prefix. */
/** 一条已完成的助手消息，或中断冻结的流式前缀。 */
export interface AssistantMessageNode {
  kind: 'assistant'
  seq: number
  /**
   * Stable identity carried from the `assistant/message` event. Absent only on
   * synthetic interruption fallbacks assembled from chunks without a durable
   * assistant message.
   */
  /**
   * 从 assistant/message 事件携带的稳定身份。仅在从分块合成的、没有持久
   * 助手消息的中断回退上缺失。
   */
  messageId?: MessageId
  /** Unix epoch ms from the source session event (or turn/end when frozen from a partial). */
  /** 来自源会话事件的 Unix 毫秒时间戳（从 partial 冻结时用 turn/end）。 */
  time: number
  turn: number
  step: number
  blocks: readonly AssistantBlock[]
  usage?: unknown
  provenance?: AssistantProvenanceView
  requestConfig?: AssistantRequestConfig
  /** Timing derived from the recorded step/chunk/message event sequence. */
  /** 由记录的 step/chunk/message 事件序列推导的计时。 */
  timing?: AssistantTiming
  /** Prefix of an aborted turn, rendered with a 已停止 marker. A durable
   *  finalized prefix uses its event seq; a chunk-only fallback uses a fractional
   *  seq derived from the closing boundary to keep it ordered inside the flow. */
  /** 被中止轮次的前缀，以"已停止"标记渲染。持久的已完成前缀用其事件 seq；
   *  仅分块的回退用从结束边界派生的分数 seq，以保持它在流内的顺序。 */
  interrupted?: true
}

/** A human message admitted from the next-step inbox while a turn was running. */
/** 轮次运行期间从 next-step 收件箱受理的人类消息（插话）。 */
export interface SteeringMessageNode {
  kind: 'steering'
  /** Stable message identity shared with its pre-admission inbox occurrence. */
  /** 与其受理前收件箱出现共享的稳定消息身份。 */
  messageId: MessageId
  seq: number
  /** Unix epoch ms from the source session event. */
  /** 来自源会话事件的 Unix 毫秒时间戳。 */
  time: number
  content: readonly ContentBlock[]
  source: unknown
}

/** A context/system injection surfaced in the flow. */
/** 在流中浮现的上下文/系统注入。 */
export interface ContextMessageNode {
  kind: 'context'
  seq: number
  /** Unix epoch ms from the source session event. */
  /** 来自源会话事件的 Unix 毫秒时间戳。 */
  time: number
  content: readonly ContentBlock[]
  source: unknown
  /** Role and producer name projected from `source` ({@link contextProvenance}). */
  /** 从 source 投影的角色与生产者名称（contextProvenance）。 */
  provenance: ContextProvenanceView
  /** Producer-declared information form ({@link contextForm}); null presents as opaque. */
  /** 生产者声明的信息形态（contextForm）；null 以不透明呈现。 */
  form: KnownContextForm | null
}

/** Durable notice that a closed failed step is waiting for a model-request retry. */
/** 持久通知：已结束的失败步骤正在等待模型请求重试。 */
export type ModelRetryNode = LlmRetryEventData & {
  kind: 'model-retry'
  seq: number
  /** Unix epoch ms from the llm/retry session event. */
  /** 来自 llm/retry 会话事件的 Unix 毫秒时间戳。 */
  time: number
  /**
   * Client-derived lifecycle: scheduled until a retry turn starts, started
   * once it does, or cancelled when the failed turn aborts first.
   */
  /**
   * 客户端推导的生命周期：重试轮次开始前为 scheduled；开始后为 started；
   * 失败轮次先中止则为 cancelled。
   */
  retryState: 'scheduled' | 'started' | 'cancelled'
}

/**
 * Durable terminal failure for a turn that ended with an error reason; the
 * turn's settled retry chain renders separately and never replaces this node.
 */
/**
 * 以错误原因结束的轮次的持久最终失败；该轮已结算的重试链单独渲染，
 * 绝不替换本节点。
 */
export interface TurnErrorNode {
  kind: 'turn-error'
  /** Seq of the owning turn/end event. */
  /** 属主 turn/end 事件的 seq。 */
  seq: number
  /** Unix epoch ms from the turn/end event. */
  /** turn/end 事件的 Unix 毫秒时间戳。 */
  time: number
  turn: number
  step: number
  message: string
  code?: string
}

/** Durable notice for a turn ended by the per-request output-token cap. */
/** 因每次请求输出 token 上限而结束的轮次的持久通知。 */
export interface TurnMaxTokensNode {
  kind: 'turn-max-tokens'
  /** Seq of the owning turn/end event. */
  /** 属主 turn/end 事件的 seq。 */
  seq: number
  /** Unix epoch ms from the turn/end event. */
  /** turn/end 事件的 Unix 毫秒时间戳。 */
  time: number
  turn: number
  step: number
}

/** A tool result paired (when in-window) with its call head. */
/** 工具结果节点（窗口内时）与其调用头配对。 */
export interface ToolResultNode {
  kind: 'tool-result'
  seq: number
  /** Unix epoch ms from the tool/result session event. */
  /** 来自 tool/result 会话事件的 Unix 毫秒时间戳。 */
  time: number
  callId: string
  /** Call head backfilled from the in-window tool/call; null when window truncation left the call outside (card head shows callId). */
  /** 从窗口内 tool/call 回填的调用头；窗口截断把调用留在窗外时为 null（卡片头显示 callId）。 */
  call: { name: string; argsRaw: string } | null
  /** Unix epoch ms of the paired tool/call when the call is still in-window; used for call-row duration. */
  /** 配对 tool/call 仍在窗口内时的 Unix 毫秒时间戳；用于调用行耗时。 */
  callTime: number | null
  content: readonly ContentBlock[]
  isError: boolean
  error?: { name: string; code: string }
  meta?: unknown
  /** Host-computed render intent from the paired tool/call's wire view; null = generic JSON card (documented default). */
  /** 配对 tool/call 的 wire 视图的 Host 计算渲染意图；null = 通用 JSON 卡片（有文档默认）。 */
  callView: ToolCallView | null
  /** Host-computed render intent from this tool/result's wire view; null = same default. */
  /** 本 tool/result 的 wire 视图的 Host 计算渲染意图；null = 同一默认。 */
  resultView: ToolResultView | null
  /** Child calls owned by this call, in dispatch order. */
  /** 本调用拥有的子调用，按分发顺序。 */
  subCalls: readonly ToolCallBlock[]
}

/**
 * One landed compaction, marked at the checkpoint's own log position. The
 * conversation it shadowed on the model surface stays in the transcript above
 * it: the marker reports where the model stopped seeing that history, it does
 * not replace it. The framed checkpoint payload is an instruction envelope
 * written for the model and never renders.
 */
/**
 * 一次落地的压缩，标记在检查点自己的日志位置。它在模型面上遮蔽的对话仍
 * 保留在其上方的转写中：标记报告模型从哪里开始看不到那段历史，并不替换
 * 它。框架化的检查点负载是写给模型的指令信封，从不渲染。
 */
export interface CompactionSummaryNode {
  kind: 'compaction'
  /** Seq of the replacement `user/message` that landed the checkpoint. */
  /** 落地检查点的替换 user/message 的 seq。 */
  seq: number
  /** Unix epoch ms of the checkpoint event. */
  /** 检查点事件的 Unix 毫秒时间戳。 */
  time: number
  /** Summary text from the checkpoint's cited `compaction/summary` event; null when
   *  the window cut left that event outside (the marker is then not expandable). */
  /** 检查点引用的 compaction/summary 事件的摘要文本；窗口截断把该事件留在
   *  窗外时为 null（此时标记不可展开）。 */
  summary: string | null
  /** Seq of the loaded `compaction/summary` event, or null when that event is outside the window. */
  /** 已加载 compaction/summary 事件的 seq；该事件在窗口外时为 null。 */
  summaryEventSeq: number | null
  /** Number of surface items replaced, or null when the summary event is unavailable or malformed. */
  /** 被替换的表面项数量；摘要事件不可用或畸形时为 null。 */
  shadowedItemCount: number | null
  /** Estimated token price of the replaced items, or null when the summary event is unavailable or malformed. */
  /** 被替换项的估计 token 代价；摘要事件不可用或畸形时为 null。 */
  shadowedTokenCount: number | null
}

/**
 * Fallback for surface events this UI version does not know: the documented
 * default arm of `SessionEventMap`, which is merge-extensible, so the
 * projection's switch cannot end in `assertNever`. No event produces this node
 * today — `isAppendSurfaceEvent` admits only the three types in core's
 * `SurfaceEventType`, and each has its own arm — and it exists so widening that
 * set core-side degrades to a raw row instead of dropping the event silently.
 */
/**
 * 本 UI 版本不认识的面事件的兜底：SessionEventMap（合并可扩展）的有文档
 * 默认分支，因此投影 switch 不能以 assertNever 结尾。目前没有事件产生该
 * 节点——isAppendSurfaceEvent 只受理核心 SurfaceEventType 的三种类型，
 * 每种都有自己分支——它存在的意义是：核心侧扩宽该集合时降级为原始行，
 * 而不是静默丢弃事件。
 */
export interface UnknownSurfaceNode {
  kind: 'unknown'
  seq: number
  /** Unix epoch ms from the source session event when known. */
  /** 已知时来自源会话事件的 Unix 毫秒时间戳。 */
  time: number
  type: string
  data: unknown
}

/**
 * One slash-command lifecycle folded from the log-only `command/run` /
 * `command/done` pair (paired by commandId, mirroring tool call↔result).
 * Log-only events are not surface events, so the command Definition indexes
 * them separately and the Chat builder orders the resulting node by seq. A window cut
 * between the pair soft-falls like tool pairs: a done with no in-window run
 * still builds a node (name/args null), and a run with no done renders as
 * still executing.
 */
/**
 * 从仅日志的 command/run / command/done 对（按 commandId 配对，镜像工具
 * 调用与结果）折叠的一次斜杠命令生命周期。仅日志事件不是面事件，因此
 * 命令定义单独索引它们，Chat 构建器按 seq 排列结果节点。配对之间的窗口
 * 截断与工具配对一样软回退：无窗口内 run 的 done 仍构建节点（name/args
 * 为 null），无 done 的 run 渲染为仍在执行。
 */
export interface CommandNode {
  kind: 'command'
  /** Seq of the command/run event; the done event's seq when only the done is in-window. */
  /** command/run 事件的 seq；仅 done 在窗口内时用 done 事件的 seq。 */
  seq: number
  /** Unix epoch ms of the anchoring event. */
  /** 锚定事件的 Unix 毫秒时间戳。 */
  time: number
  /** Pairing id minted by the host executor. */
  /** Host 执行器铸造的配对 id。 */
  commandId: CommandId
  /** Command name (run payload's structured field); null when the run fell outside the window. */
  /** 命令名（run 负载的结构化字段）；run 落在窗口外时为 null。 */
  name: string | null
  /**
   * Verbatim rawInput after the name, including separator whitespace; null
   * when omitted by the command or when the run fell outside the window.
   */
  /**
   * 名称之后逐字的 rawInput，含分隔空白；命令省略或 run 落在窗口外时为 null。
   */
  args: string | null
  /** Settlement outcome (done payload); null while the command is still executing. */
  /** 结算结果（done 负载）；命令仍在执行时为 null。 */
  outcome: {
    kind: 'success' | 'error'
    text?: string
    /** Earlier authoritative domain event for a richer client-computed presentation. */
    /** 更早的权威域事件，供更丰富的客户端计算呈现使用。 */
    sourceEventSeq?: number
  } | null
}

/** Finalized conversation node union (kind discriminates; seq is the React key). */
/** 已完成的会话节点联合（kind 判别；seq 是 React key）。 */
export type ConversationNode =
  | UserMessageNode
  | AssistantMessageNode
  | SteeringMessageNode
  | ContextMessageNode
  | ModelRetryNode
  | TurnErrorNode
  | TurnMaxTokensNode
  | ToolResultNode
  | CommandNode
  | CompactionSummaryNode
  | UnknownSurfaceNode

/** In-flight tool card material: tool/call seen, tool/result not yet. */
/** 进行中的工具卡片材料：已见 tool/call，尚未见 tool/result。 */
export interface RunningToolCall {
  callId: string
  name: string
  argsRaw: string
  turn: number
  step: number
  /** Unix epoch ms when the tool/call event was logged. */
  /** tool/call 事件记录时的 Unix 毫秒时间戳。 */
  time: number
  /** Host-computed render intent riding the tool/call frame; null = generic JSON card. */
  /** 随 tool/call 帧的 Host 计算渲染意图；null = 通用 JSON 卡片。 */
  callView: ToolCallView | null
  /** Child calls owned by this call, in dispatch order. */
  /** 本调用拥有的子调用，按分发顺序。 */
  subCalls: readonly ToolCallBlock[]
}

/** One running or settled call, recursively owning its child calls. */
/** 一个运行中或已结算的调用，递归拥有其子调用。 */
export type ToolCallBlock = RunningToolCall | ToolResultNode

/** One transient inbox occurrence from the authoritative `session/queue` snapshot. */
/** 来自权威 session/queue 快照的一次瞬时收件箱出现。 */
export interface QueuedMessage {
  readonly id: MessageId
  /** Stable message identity used for transient-to-durable steering handoff. */
  /** 用于瞬时到持久 steering 交接的稳定消息身份。 */
  readonly messageId: MessageId
  /** Agent-resolved placement; only queued rows accept queue mutations. */
  /** Agent 解析的放置方式；只有 queued 行接受队列变更。 */
  readonly placement: 'queued' | 'steering' | 'context'
  /** Complete content used to render pending steering before it becomes durable. */
  /** 在成为持久化前渲染待处理 steering 的完整内容。 */
  readonly content: readonly ContentBlock[]
  readonly preview: string
  /** Complete editable text; null when the message contains non-text blocks. */
  /** 完整可编辑文本；消息含非文本块时为 null。 */
  readonly text: string | null
}

/** In-progress assistant output (chunk accumulator product). */
/** 进行中的助手输出（分块累加器产物）。 */
export interface PartialAssistant {
  turn: number
  step: number
  blocks: readonly AssistantBlock[]
}

/** History-open lifecycle of a Session window. */
/** 会话窗口的历史打开生命周期。 */
export type OpenState = 'cold' | 'loading' | 'open' | 'error'

/**
 * Input-area shape of an OPEN session, derived at snapshot assembly (the one
 * place that knows the predicate — consumers switch, never re-derive):
 *
 * - `blank`: the authoritative blank bit is still set and no prompt was
 *   attempted — the UI renders the blank-session guidance hero.
 * - `engaging`: a first prompt was attempted, but no accepted turn or other
 *   authoritative activity signal has arrived — the UI keeps the composer
 *   visible through admission and error frames.
 * - `active`: the session is non-blank beyond its pending first prompt,
 *   contains visible non-command Chat content, is running, or owns a pending
 *   interaction — the ordinary conversation view.
 *
 * A failed first prompt stays `engaging` (composer + error strip — retry
 * semantics; returning to the hero would discard the error context).
 * Sessions whose window is not open (`loading`/`error`) are outside phase
 * jurisdiction: consumers branch on {@link ConversationSnapshot.openState}
 * first.
 */
/**
 * 已打开会话的输入区形状，在快照装配时推导（唯一知道谓词的地方——消费方
 * 只 switch，不重新推导）：
 *
 * - blank：权威空白位仍置位且未尝试过任何提示词——UI 渲染空白会话引导页。
 * - engaging：已尝试首条提示词，但尚无被接受的轮次或其他权威活动信号——
 *   UI 在受理与错误帧期间保持编辑器可见。
 * - active：会话超出待处理首条提示词的非空白状态、含可见的非命令聊天
 *   内容、正在运行、或拥有待处理交互——普通会话视图。
 *
 * 失败的首条提示词保持 engaging（编辑器 + 错误条——重试语义；回到引导页
 * 会丢弃错误上下文）。窗口未打开（loading/error）的会话在阶段管辖之外：
 * 消费方先按 ConversationSnapshot.openState 分支。
 */
export type ComposerPhase = 'blank' | 'engaging' | 'active'

/** Send/stop failure surfaced in the input error strip; op picks the user-facing copy (发送失败 vs 停止失败). */
/** 输入错误条中浮现的发送/停止失败；op 选择面向用户的文案（发送失败 与 停止失败）。 */
export interface PromptError {
  op: 'send' | 'stop'
  error: RpcError
}

/**
 * Stable live per-key reader. An old ChatSnapshot observes later flushes
 * through this store.
 */
/**
 * 稳定的每键活读取器。旧 ChatSnapshot 通过该存储观察之后的冲刷。
 */
export interface ChatNodeStore {
  /** @param key - stable Conversation Context key. @returns current Node, when visible or hidden. */
  /** @param key 稳定的会话上下文键。 @returns 当前节点（可见或隐藏时）。 */
  get(key: string): ChatConversationViewNode | undefined
  /** @returns all currently materialized Nodes without imposing render order. */
  /** @returns 当前全部已物化节点，不施加渲染顺序。 */
  values(): readonly ChatConversationViewNode[]
}

/**
 * Stable live Location index. An old ChatSnapshot observes later membership
 * changes through this index.
 */
/**
 * 稳定的活位置索引。旧 ChatSnapshot 通过该索引观察之后的成员变化。
 */
export interface ChatLocationNodeIndex {
  /** @param turn - owning turn. @returns ordered Chat Node keys in the turn. */
  /** @param turn 属主轮次。 @returns 该轮次中有序的 Chat 节点键。 */
  getTurn(turn: number): readonly string[]
  /** @param turn - owning turn. @param step - owning step. @returns ordered Chat Node keys in the step. */
  /** @param turn 属主轮次。 @param step 属主步骤。 @returns 该步骤中有序的 Chat 节点键。 */
  getStep(turn: number, step: number): readonly string[]
}

/** Compatibility projection backing StatsLine and the legacy top-level snapshot fields. */
/** 支撑 StatsLine 与旧版顶层快照字段的兼容投影。 */
export interface LegacyConversationSlice {
  readonly nodes: readonly ConversationNode[]
  readonly turnTimings: ReadonlyMap<number, { readonly startTime: number; readonly endTime?: number }>
  readonly turnEnds: ReadonlyMap<number, number>
  readonly partial: PartialAssistant | null
  readonly runningCalls: readonly RunningToolCall[]
}

/** Incremental Chat publication with immutable order and stable live keyed readers. */
/** 增量 Chat 发布：不可变顺序 + 稳定的活按键读取器。 */
export interface ChatSnapshot {
  readonly order: readonly string[]
  readonly nodes: ChatNodeStore
  readonly locations: ChatLocationNodeIndex
  readonly timeline: ConversationTimelineSnapshot
  readonly legacy: LegacyConversationSlice
}

const EMPTY_LIST: readonly never[] = [] // 共享空数组常量（渲染序）
const EMPTY_TIMELINE: ConversationTimelineSnapshot = { turnOrder: EMPTY_LIST, turns: new Map() }

/** Empty target store used by fixtures and Sessions without registered views. */
/** 供夹具与未注册视图的会话使用的空目标存储。 */
export const EMPTY_CONVERSATION_VIEWS: ConversationViewSnapshotStore = {
  get: () => undefined,
}

/** Empty Chat target used before a view builder is registered. */
/** 视图构建器注册前使用的空 Chat 目标。 */
export const EMPTY_CHAT_SNAPSHOT: ChatSnapshot = {
  order: EMPTY_LIST,
  nodes: {
    get: () => undefined,
    values: () => EMPTY_LIST,
  },
  locations: {
    getTurn: () => EMPTY_LIST,
    getStep: () => EMPTY_LIST,
  },
  timeline: EMPTY_TIMELINE,
  legacy: {
    nodes: EMPTY_LIST,
    turnTimings: new Map(),
    turnEnds: new Map(),
    partial: null,
    runningCalls: EMPTY_LIST,
  },
}

/** The immutable snapshot contract Session hands to uSES (see the web client architecture RFC). */
/** Session 交给 uSES 的不可变快照契约（见 web 客户端架构 RFC）。 */
export interface ConversationSnapshot {
  sessionId: SessionId
  /** Registered target snapshots assembled from Session events. */
  /** 由会话事件装配的已注册目标快照。 */
  views: ConversationViewSnapshotStore
  /** Final Chat target assembled from independently registered business Definitions. */
  /** 由独立注册的业务定义装配的最终 Chat 目标。 */
  chat: ChatSnapshot
  /** Legacy top-level compatibility field mirrored from the registered Chat Definitions. */
  /** 从已注册 Chat 定义镜像的旧版顶层兼容字段。 */
  nodes: readonly ConversationNode[]
  /** Exact in-window `turn/start` time and optional matching `turn/end` time. */
  /** 窗口内精确的 turn/start 时间与可选的匹配 turn/end 时间。 */
  turnTimings: ReadonlyMap<number, { readonly startTime: number; readonly endTime?: number }>
  /** In-window completed turn number -> its `turn/end` event seq. */
  /** 窗口内已完成的轮次号 -> 其 turn/end 事件 seq。 */
  turnEnds: ReadonlyMap<number, number>
  partial: PartialAssistant | null
  runningCalls: readonly RunningToolCall[]
  pending: readonly PendingInteraction[]
  /** Authoritative transient inbox snapshot, including queued and steering placements. */
  /** 权威的瞬时收件箱快照，含 queued 与 steering 放置。 */
  queue: readonly QueuedMessage[]
  running: boolean
  /**
   * Catalog-discovered continuation address. Its parent availability controls
   * human input; null means ordinary session transport.
   */
  /**
   * 目录发现的续接地址。其父可用性控制人类输入；null 表示普通会话传输。
   */
  subagent: { address: SubagentAddress; parentAvailable: boolean } | null
  /** Input-area shape (see {@link ComposerPhase}); derived here, switched on by consumers. */
  /** 输入区形状（见 ComposerPhase）；在此推导，由消费方 switch。 */
  composerPhase: ComposerPhase
  /** Set after host/session-removed; the UI grays out and disables input. */
  /** host/session-removed 后置位；UI 置灰并禁用输入。 */
  removed: boolean
  openState: OpenState
  openError: RpcError | null
  hasMore: boolean
  loadingOlder: boolean
  promptError: PromptError | null
  /**
   * Whether this session still has an empty log (no user message yet).
   * Mirrors the host summary's derived blank bit: seeded from `session.list`
   * / the `host/session-added` frame, flipped false by the first ACCEPTED
   * prompt locally (on the RPC success response — acceptance proves the
   * user message is in the host log; a rejected first prompt keeps the
   * session blank and reusable) and by any `running: true` status remotely,
   * and re-aligned by every list re-pull (the summary stays authoritative).
   * Blank sessions are hidden from session lists and reused by New Session.
   */
  /**
   * 本会话是否仍为空日志（尚无用户消息）。镜像 Host 概要推导的空白位：
   * 由 session.list / host/session-added 帧播种；本地首条被接受的提示词
   * （RPC 成功响应时——受理证明用户消息已在 Host 日志；被拒绝的首条提示词
   * 保持会话空白可复用）与远端任何 running: true 状态翻转为 false；每次
   * 列表重拉重新对齐（概要保持权威）。空白会话从会话列表隐藏并被
   * New Session 复用。
   */
  blank: boolean
  lastAgentError: string | null
}
