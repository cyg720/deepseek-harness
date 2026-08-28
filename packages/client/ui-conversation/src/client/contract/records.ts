// Each publication replaces the top-level snapshot while preserving unchanged
// substructure references. Stable node and location stores make old snapshots
// live readers rather than time-point views.

import type { CommandId } from '@deepseek-ai/dsh-commands/brand'
import type { MessageId } from '@deepseek-ai/dsh-llm/brand'
import type { ContentBlock } from '@deepseek-ai/dsh-llm/types'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { LlmRetryEventData } from '@deepseek-ai/dsh-llm-retry/types'
import type { TodoItem } from '@deepseek-ai/dsh-tool-todo/client'
import type { ContextProvenanceView, KnownContextForm } from './context-provenance.ts'
export type { TodoItem }

/** Request configuration recorded for one provider call. */
/* 为一次提供者调用记录的请求配置。 */
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
/* 一次已完成请求报告的稳定提供者/模型身份。 */
export interface AssistantProvenanceView {
  provider: string
  model: string
}

/** Assistant content blocks sorted by what a UI target presents. */
export type AssistantBlock =
  | { kind: 'text'; text: string }
  | { kind: 'reasoning'; text: string }
  | { kind: 'image'; attachment: ImageAttachmentRef }
  | { kind: 'tool-call'; callId: string; name: string; argsRaw: string }
  | { kind: 'other'; block: unknown }

/** A finalized user message. */
/* 一条已完成的用户消息。 */
export interface UserMessageNode {
  kind: 'user'
  seq: number
  /** Unix epoch ms from the source session event. */
  /* 来自源会话事件的 Unix 毫秒时间戳。 */
  time: number
  content: readonly ContentBlock[]
  source: unknown
}

/** Recorded boundaries used to derive assistant latency and throughput. */
/* 用于推导助手延迟与吞吐的记录边界。 */
export interface AssistantTiming {
  /** Matching step/start timestamp, or null when it is outside the current event window. */
  /* 匹配的 step/start 时间戳；在事件窗口外时为 null。 */
  stepStartTime: number | null
  /** First non-empty text/reasoning/tool delta timestamp, or null when no token delta was recorded. */
  /* 首个非空文本/推理/工具增量时间戳；无 token 增量记录时为 null。 */
  firstTokenTime: number | null
  /** Final assistant/message timestamp. */
  /* 最终 assistant/message 时间戳。 */
  completedTime: number
}

/** A finalized assistant message or an interruption-frozen streaming prefix. */
/* 一条已完成的助手消息，或中断冻结的流式前缀。 */
export interface AssistantMessageNode {
  kind: 'assistant'
  seq: number
  /**
   * Stable identity carried from the `assistant/message` event. Absent only on
   * synthetic interruption fallbacks assembled from chunks without a durable
   * assistant message.
   */
  /*
   * 从 assistant/message 事件携带的稳定身份。仅在从分块合成的、没有持久
   * 助手消息的中断回退上缺失。
   */
  messageId?: MessageId
  /** Unix epoch ms from the source session event (or turn/end when frozen from a partial). */
  /* 来自源会话事件的 Unix 毫秒时间戳（从 partial 冻结时用 turn/end）。 */
  time: number
  turn: number
  step: number
  blocks: readonly AssistantBlock[]
  usage?: unknown
  provenance?: AssistantProvenanceView
  requestConfig?: AssistantRequestConfig
  /** Timing derived from the recorded step/chunk/message event sequence. */
  /* 由记录的 step/chunk/message 事件序列推导的计时。 */
  timing?: AssistantTiming
  /** Prefix of an aborted turn, rendered with a 已停止 marker. A durable
   *  finalized prefix uses its event seq; a chunk-only fallback uses a fractional
   *  seq derived from the closing boundary to keep it ordered inside the flow. */
  /* 被中止轮次的前缀，以"已停止"标记渲染。持久的已完成前缀用其事件 seq；
   *  仅分块的回退用从结束边界派生的分数 seq，以保持它在流内的顺序。 */
  interrupted?: true
}

/** A human message admitted from the next-step inbox while a turn was running. */
/* 轮次运行期间从 next-step 收件箱受理的人类消息（插话）。 */
export interface SteeringMessageNode {
  kind: 'steering'
  /** Stable message identity shared with its pre-admission inbox occurrence. */
  /* 与其受理前收件箱出现共享的稳定消息身份。 */
  messageId: MessageId
  seq: number
  /** Unix epoch ms from the source session event. */
  /* 来自源会话事件的 Unix 毫秒时间戳。 */
  time: number
  content: readonly ContentBlock[]
  source: unknown
}

/** A context/system injection surfaced in the flow. */
/* 在流中浮现的上下文/系统注入。 */
export interface ContextMessageNode {
  kind: 'context'
  seq: number
  /** Unix epoch ms from the source session event. */
  /* 来自源会话事件的 Unix 毫秒时间戳。 */
  time: number
  content: readonly ContentBlock[]
  source: unknown
  /** Role and producer name projected from `source` by the target. */
  provenance: ContextProvenanceView
  /** Producer-declared information form supported by the target; null presents as opaque. */
  form: KnownContextForm | null
}

/** Durable notice that a closed failed step is waiting for a model-request retry. */
/* 持久通知：已结束的失败步骤正在等待模型请求重试。 */
export type ModelRetryNode = LlmRetryEventData & {
  kind: 'model-retry'
  seq: number
  /** Unix epoch ms from the llm/retry session event. */
  /* 来自 llm/retry 会话事件的 Unix 毫秒时间戳。 */
  time: number
  /**
   * Client-derived lifecycle: scheduled until a retry turn starts, started
   * once it does, or cancelled when the failed turn aborts first.
   */
  /*
   * 客户端推导的生命周期：重试轮次开始前为 scheduled；开始后为 started；
   * 失败轮次先中止则为 cancelled。
   */
  retryState: 'scheduled' | 'started' | 'cancelled'
}

/**
 * Durable terminal failure for a turn that ended with an error reason; the
 * turn's settled retry chain renders separately and never replaces this node.
 */
/*
 * 以错误原因结束的轮次的持久最终失败；该轮已结算的重试链单独渲染，
 * 绝不替换本节点。
 */
export interface TurnErrorNode {
  kind: 'turn-error'
  /** Seq of the owning turn/end event. */
  /* 属主 turn/end 事件的 seq。 */
  seq: number
  /** Unix epoch ms from the turn/end event. */
  /* turn/end 事件的 Unix 毫秒时间戳。 */
  time: number
  turn: number
  step: number
  /** Sanitized provider message; empty when a known code owns localized copy. */
  message: string
  /** Stable provider failure code, when recorded. */
  code?: string
}

/** Durable notice for a turn ended by the per-request output-token cap. */
/* 因每次请求输出 token 上限而结束的轮次的持久通知。 */
export interface TurnMaxTokensNode {
  kind: 'turn-max-tokens'
  /** Seq of the owning turn/end event. */
  /* 属主 turn/end 事件的 seq。 */
  seq: number
  /** Unix epoch ms from the turn/end event. */
  /* turn/end 事件的 Unix 毫秒时间戳。 */
  time: number
  turn: number
  step: number
}

/** A tool result paired (when in-window) with its call head. */
/* 工具结果节点（窗口内时）与其调用头配对。 */
export interface ToolResultNode {
  kind: 'tool-result'
  seq: number
  /** Unix epoch ms from the tool/result session event. */
  /* 来自 tool/result 会话事件的 Unix 毫秒时间戳。 */
  time: number
  callId: string
  /** Parent Tool call for a Code Dispatch result; absent on a root Session result. */
  parentCallId?: string
  /** Call head backfilled from the in-window tool/call; null when window truncation left the call outside (card head shows callId). */
  /* 从窗口内 tool/call 回填的调用头；窗口截断把调用留在窗外时为 null（卡片头显示 callId）。 */
  call: { name: string; argsRaw: string } | null
  /** Unix epoch ms of the paired tool/call when the call is still in-window; used for call-row duration. */
  /* 配对 tool/call 仍在窗口内时的 Unix 毫秒时间戳；用于调用行耗时。 */
  callTime: number | null
  content: readonly ContentBlock[]
  isError: boolean
  error?: { name: string; code: string }
  meta?: unknown
  /** Child calls owned by this call, in dispatch order. */
  /* 本调用拥有的子调用，按分发顺序。 */
  subCalls: readonly ToolCallBlock[]
}

/**
 * One landed compaction, marked at the checkpoint's own log position. The
 * conversation it shadowed on the model surface stays in the transcript above
 * it: the marker reports where the model stopped seeing that history, it does
 * not replace it. The framed checkpoint payload is an instruction envelope
 * written for the model and never renders.
 */
/*
 * 一次落地的压缩，标记在检查点自己的日志位置。它在模型面上遮蔽的对话仍
 * 保留在其上方的转写中：标记报告模型从哪里开始看不到那段历史，并不替换
 * 它。框架化的检查点负载是写给模型的指令信封，从不渲染。
 */
export interface CompactionSummaryNode {
  kind: 'compaction'
  /** Seq of the replacement `user/message` that landed the checkpoint. */
  /* 落地检查点的替换 user/message 的 seq。 */
  seq: number
  /** Unix epoch ms of the checkpoint event. */
  /* 检查点事件的 Unix 毫秒时间戳。 */
  time: number
  /** Summary text from the checkpoint's cited `compaction/summary` event; null when
   *  the window cut left that event outside (the marker is then not expandable). */
  /* 检查点引用的 compaction/summary 事件的摘要文本；窗口截断把该事件留在
   *  窗外时为 null（此时标记不可展开）。 */
  summary: string | null
  /** Seq of the loaded `compaction/summary` event, or null when that event is outside the window. */
  /* 已加载 compaction/summary 事件的 seq；该事件在窗口外时为 null。 */
  summaryEventSeq: number | null
  /** Number of surface items replaced, or null when the summary event is unavailable or malformed. */
  /* 被替换的表面项数量；摘要事件不可用或畸形时为 null。 */
  shadowedItemCount: number | null
  /** Estimated token price of the replaced items, or null when the summary event is unavailable or malformed. */
  /* 被替换项的估计 token 代价；摘要事件不可用或畸形时为 null。 */
  shadowedTokenCount: number | null
}

/**
 * Fallback for surface events this UI version does not know: the documented
 * default arm of `SessionEventMap`, which is merge-extensible, so the
 * projection's switch cannot end in `assertNever`. No event produces this node
 * because `isAppendSurfaceEvent` admits only the three types in core's
 * `SurfaceEventType`, and each has its own arm — and it exists so widening that
 * set core-side degrades to a raw row instead of dropping the event silently.
 */
/*
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
  /* 已知时来自源会话事件的 Unix 毫秒时间戳。 */
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
/*
 * 从仅日志的 command/run / command/done 对（按 commandId 配对，镜像工具
 * 调用与结果）折叠的一次斜杠命令生命周期。仅日志事件不是面事件，因此
 * 命令定义单独索引它们，Chat 构建器按 seq 排列结果节点。配对之间的窗口
 * 截断与工具配对一样软回退：无窗口内 run 的 done 仍构建节点（name/args
 * 为 null），无 done 的 run 渲染为仍在执行。
 */
export interface CommandNode {
  kind: 'command'
  /** Seq of the command/run event; the done event's seq when only the done is in-window. */
  /* command/run 事件的 seq；仅 done 在窗口内时用 done 事件的 seq。 */
  seq: number
  /** Unix epoch ms of the anchoring event. */
  /* 锚定事件的 Unix 毫秒时间戳。 */
  time: number
  /** Pairing id minted by the host executor. */
  /* Host 执行器铸造的配对 id。 */
  commandId: CommandId
  /** Command name (run payload's structured field); null when the run fell outside the window. */
  /* 命令名（run 负载的结构化字段）；run 落在窗口外时为 null。 */
  name: string | null
  /**
   * Verbatim rawInput after the name, including separator whitespace; null
   * when omitted by the command or when the run fell outside the window.
   */
  /*
   * 名称之后逐字的 rawInput，含分隔空白；命令省略或 run 落在窗口外时为 null。
   */
  args: string | null
  /** Settlement outcome (done payload); null while the command is still executing. */
  /* 结算结果（done 负载）；命令仍在执行时为 null。 */
  outcome: {
    kind: 'success' | 'error'
    text?: string
    /** Earlier authoritative domain event for a richer client-computed presentation. */
    /* 更早的权威域事件，供更丰富的客户端计算呈现使用。 */
    sourceEventSeq?: number
  } | null
}

/** Finalized conversation node union (kind discriminates; seq is the React key). */
/* 已完成的会话节点联合（kind 判别；seq 是 React key）。 */
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
/* 进行中的工具卡片材料：已见 tool/call，尚未见 tool/result。 */
export interface RunningToolCall {
  callId: string
  /** Parent Tool call for a Code Dispatch start; absent on a root Session call. */
  parentCallId?: string
  name: string
  argsRaw: string
  turn: number
  step: number
  /** Unix epoch ms when the tool/call event was logged. */
  /* tool/call 事件记录时的 Unix 毫秒时间戳。 */
  time: number
  /** Child calls owned by this call, in dispatch order. */
  /* 本调用拥有的子调用，按分发顺序。 */
  subCalls: readonly ToolCallBlock[]
}

/** One running or settled call, recursively owning its child calls. */
/* 一个运行中或已结算的调用，递归拥有其子调用。 */
export type ToolCallBlock = RunningToolCall | ToolResultNode

/** In-progress assistant output (chunk accumulator product). */
/* 进行中的助手输出（分块累加器产物）。 */
export interface PartialAssistant {
  turn: number
  step: number
  blocks: readonly AssistantBlock[]
}
