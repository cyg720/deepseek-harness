/**
 * ================================ 文件注释 ================================
 * 【文件职责】轨迹记录（TrajectoryCellProps）的数据结构与格式化契约：一条记录承载某一步
 *             操作的可展示信息（文本、预览、详情、时间、token 用量等），并定义稳定身份
 *             与时长格式化工具。
 * 【技术维度】纯类型 + 纯函数；recordId / callId / sourceSeq 三级身份回退保证"向前加载
 *             更早记录"后身份仍稳定；时长格式化带千分位。
 * 【产品维度】轨迹列表每条目渲染所需的数据全部由这一结构承载，详情面板读取 detail 字段。
 * 【逻辑维度】1) 记录类型枚举；2) 度量详情 / 源块类型；3) TrajectoryCellProps 大接口；
 *             4) trajectoryRecordId 身份解析；5) 两个时长格式化函数。
 * 【关键边界】时间字段：timeSeconds 可为 null（未知时长）；startedAt 为毫秒时间戳；
 *             requestOnly 是"仅有请求、无可见记录"的占位标记。
 * 【新手阅读建议】重点读 TrajectoryCellProps 的字段分组（展示 / 详情 / 度量 / 状态）。
 * ==========================================================================
 */
/** Shared trajectory record data and formatting contracts. */

import type { HTMLAttributes } from 'react'
import type { ConversationPromptSnapshot } from '@deepseek-ai/dsh-client-runtime/client'

/** Closed set of trajectory record kinds. */
// 轨迹记录种类的封闭集合：系统 / 用户 / 上下文 / 压缩 / 消息 / 工具 / 子工具。
export type TrajectoryCellKind =
  | 'system'
  | 'user'
  | 'context'
  | 'compacted'
  | 'message'
  | 'tool'
  | 'subtool'

/** Recorded inputs needed to derive assistant TTFT and decode throughput. */
// 推导 assistant"首 token 时间（TTFT）"与"解码吞吐"所需的已记录输入。
export interface AssistantMetricDetail {
  timingRecorded: boolean
  stepStartTime: number | null
  firstTokenTime: number | null
  completedTime: number | null
  usageProvided: boolean
  outputTokens: number | null
}

/** One source content block preserved in model order for the details panel. */
// 详情面板按模型顺序保留的一个源内容块（文本 / 图片 / 工具调用等）。
export interface TrajectorySourceBlock {
  type: string
  content: string
  imageSrc?: string
  imageAlt?: string
  callId?: string
  toolName?: string
}

/** Data and optional presentation attributes for one trajectory record. */
/*
 * 一条轨迹记录的数据与可选展示属性：index 是显示用序号；text / previewMarkdown 是
 * 列表摘要；各 *Detail 字段供详情面板展示；时间与 token 字段用于度量。
 */
export interface TrajectoryCellProps extends HTMLAttributes<HTMLDivElement> {
  /** 1-based record index shown as `#N`. */
  // 从 1 开始的记录序号，界面显示为 #N。
  index: number
  /** Projection-stable identity when no single source event owns the record lifecycle. */
  // 当没有单一源事件拥有记录生命周期时，由投影方给出的稳定身份。
  recordId?: string
  kind: TrajectoryCellKind
  /** Non-Markdown summary or prefix; CSS ellipsis when it overflows. */
  // 非 Markdown 的摘要或前缀；溢出时用 CSS 省略号。
  text: string
  /** Raw Markdown source converted into the single-line summary at its consumer. */
  // 原始 Markdown 源，由消费方转成单行摘要。
  previewMarkdown?: string
  /** Whether this user record opens a new model turn. */
  // 该用户记录是否开启一个新的模型回合。
  opensTurn?: boolean
  /** Source session-event seq for cross-record navigation. */
  // 源会话事件的 seq，用于跨记录导航。
  sourceSeq?: number
  /** Producer role and name from a user-role message or context injection. */
  // 消息来源（角色与名称），来自用户消息或上下文注入。
  messageSource?: unknown
  /** Producer-owned model-hidden metadata carried beside the message source. */
  /** A separator-only anchor for an auxiliary request with no visible record. */
  // 仅作分隔符的锚：辅助请求没有可见记录时用 requestOnly 占位。
  requestOnly?: boolean
  /** Full request/message content for the details panel. */
  // 完整请求 / 消息内容，供详情面板展示。
  inputDetail?: string
  /** Complete system-prompt/tool-catalog state introduced by a SYSTEM record. */
  // SYSTEM 记录引入的完整系统提示词 / 工具目录状态。
  promptDetail?: ConversationPromptSnapshot
  /** System-prompt/tool-catalog state replaced by a SYSTEM update. */
  // SYSTEM 更新所替换掉的旧系统提示词 / 工具目录状态。
  previousPromptDetail?: ConversationPromptSnapshot
  /** Full assistant/tool result content for the details panel. */
  // 完整 assistant / 工具结果内容，供详情面板展示。
  outputDetail?: string
  /** Full assistant reasoning content for the details panel. */
  // 完整 assistant 推理内容，供详情面板展示。
  thinkingDetail?: string
  /** Original message blocks in source order for the details panel. */
  // 原始消息块（按源顺序），供详情面板展示。
  sourceBlocks?: readonly TrajectorySourceBlock[]
  /** Original tool result blocks in source order for the details panel. */
  // 原始工具结果块（按源顺序），供详情面板展示。
  outputBlocks?: readonly TrajectorySourceBlock[]
  /** Call-time model-visible tool schema for the details panel. */
  // 调用时刻模型可见的工具 schema，供详情面板展示。
  schemaDetail?: string
  /** Assistant-only timing and token facts for the details panel. */
  // assistant 专属的时序与 token 事实，供详情面板展示。
  assistantMetrics?: AssistantMetricDetail
  /** Tool-only result summary paired with the call in the same record. */
  // 工具结果摘要，与同记录中的调用配对。
  result?: string
  /** Raw Markdown source converted into the tool-result summary at its consumer. */
  // 工具结果的原始 Markdown 源，由消费方转成摘要。
  resultPreviewMarkdown?: string
  /** Tool call id used to link message source blocks to tool records. */
  // 工具调用 id，用于把消息源块链接到工具记录。
  callId?: string
  /** Tool-only result failure state. */
  // 工具结果失败状态。
  isError?: boolean
  /** Own duration in seconds, or `null` when no duration is known. */
  // 自身时长（秒）；未知时为 null。
  timeSeconds: number | null
  /** Unix epoch milliseconds when this operation actually started, when known. */
  // 该操作实际开始的 Unix 毫秒时间戳（若已知）。
  startedAt?: number | null
  /** Message-only prompt token count. */
  // 仅消息：提示词 token 数。
  input?: number
  /** Message-only input tokens served from a provider cache. */
  // 仅消息：由提供商缓存命中的输入 token 数。
  cacheRead?: number
  /** Message-only input tokens written into a provider cache. */
  // 仅消息：写入提供商缓存的输入 token 数。
  cacheWrite?: number
  /** Message-only completion token count. */
  // 仅消息：完成 token 数。
  output?: number
  /** Message-only reasoning token count. */
  // 仅消息：推理 token 数。
  think?: number
  /** Whether the legacy standalone cell renders its selection treatment. */
  // 旧式独立单元格是否渲染选中态。
  selected?: boolean
}

/**
 * Resolve the identity that survives prepending older projected records.
 * @param cell - Projected trajectory record.
 * @returns Stable identity from the owning event or tool call, with a fixture fallback.
 */
/*
 * 解析记录身份：向前加载更早记录后仍保持稳定。优先用 recordId，其次 callId / sourceSeq
 * 合成，最后用 kind + index 兜底（测试夹具用）。
 * @param cell - 投影后的轨迹记录。
 * @returns 由所属事件或工具调用得出的稳定身份。
 */
export function trajectoryRecordId(cell: TrajectoryCellProps): string {
  if (cell.recordId !== undefined) return cell.recordId
  if (cell.callId !== undefined) return `${cell.kind}\u0000call\u0000${cell.callId}`
  if (cell.sourceSeq !== undefined) return `${cell.kind}\u0000seq\u0000${cell.sourceSeq}`
  return `${cell.kind}\u0000index\u0000${cell.index}`
}

/**
 * Format a duration in milliseconds with thousands separators.
 * @param milliseconds - Duration in milliseconds, or `null` when absent.
 * @returns `—` when unknown, otherwise an integer-millisecond label.
 */
/*
 * 格式化毫秒时长（带千分位）。未知（null 或非有限数）时返回长破折号。
 * @param milliseconds - 毫秒时长；缺失时为 null。
 * @returns 未知时返回 '—'，否则返回整数毫秒标签。
 */
export function formatDurationMillis(milliseconds: number | null): string {
  if (milliseconds === null || !Number.isFinite(milliseconds)) return '—'
  const integer = String(Math.round(milliseconds))
  return `${integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',')} ms`
}

/**
 * Format an elapsed duration given in seconds as a millisecond label.
 * @param seconds - Duration seconds, or `null` when absent.
 * @returns `—` when unknown, otherwise an integer-millisecond label.
 */
/*
 * 把以秒给出的时长格式化成毫秒标签（转成毫秒后复用 formatDurationMillis）。
 * @param seconds - 时长秒数；缺失时为 null。
 * @returns 未知时返回 '—'，否则返回整数毫秒标签。
 */
export function formatElapsedSeconds(seconds: number | null): string {
  return formatDurationMillis(seconds === null ? null : seconds * 1000)
}
