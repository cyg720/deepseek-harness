/**
 * ================================ 文件注释 ================================
 * 【文件职责】请求检查（Request Inspection）视图：把会话事件流中持久化的
 *   请求生命周期事件装配成面向 UI 的请求视图（普通助手生成与压缩请求）。
 * 【技术维度】纯类型模块：定义请求头快照、变更记录与两类请求视图；
 *   运行时装配逻辑在 conversation-assembler 等文件中消费这些类型。
 * 【产品维度】轨迹（Trajectory）布局需要展示每个提供者请求的阶段化信息：
 *   配置、系统提示、工具目录、重试、压缩摘要等。
 * 【逻辑维度】ConversationPromptSnapshot 描述一次普通生成的模型可见请求头；
 *   RequestPromptChange 记录系统/工具的变更；RequestViewBase 提供公共
 *   生命周期字段；AssistantRequestView/CompactionRequestView 分别描述
 *   普通生成与压缩请求；RequestInspectionSnapshot 聚合输出。
 * 【关键边界】status 只允许 running/complete/error；compaction 请求的
 *   step 固定为 0；rawOutput 是压缩提供者的完整输出（安全投影前）。
 * 【新手阅读建议】先看 conversation.ts 中的相关类型再回到本文件。
 * ==========================================================================
 */
import type { ContentBlock, ToolSchema } from '@deepseek-ai/dsh-llm/types'
import type {
  AssistantProvenanceView, AssistantRequestConfig,
} from './conversation.ts'

/** 再导出会话对话模型中定义的请求相关类型，使本模块成为请求检查类型的统一入口。 */
export type {
  AssistantProvenanceView, AssistantRequestConfig,
} from './conversation.ts'

/** Complete model-visible request header in force for an ordinary generation. */
/* 一次普通生成当前生效的完整"模型可见"请求头。 */
export interface ConversationPromptSnapshot {
  /** Provider/model and sampling configuration from the effective request header. */
  /* 来自生效请求头的提供者/模型与采样配置。 */
  config: AssistantRequestConfig
  /** Rendered system prompt text; empty when the request had no system prompt. */
  /* 渲染后的系统提示文本；请求没有系统提示时为空字符串。 */
  system: string
  /** Complete tool catalog sent with the request, including tools that were never called. */
  /* 随请求发送的完整工具目录，包括从未被调用的工具。 */
  tools: readonly ToolSchema[]
}

/** System/tool change introduced while preparing one ordinary request. */
/* 准备一次普通请求时引入的系统/工具变更记录。 */
export interface RequestPromptChange {
  /** Sequence of the request/header event that introduced this state. */
  /* 引入该状态的 request/header 事件的序号。 */
  seq: number
  /** Unix epoch ms from the request/header event. */
  /* request/header 事件的 Unix 毫秒时间戳。 */
  time: number
  /** How the model-visible prompt differs from the previous recorded state. */
  /* 模型可见提示相对上一次记录状态的差异类型。 */
  kind: 'initial' | 'system' | 'tools' | 'system-and-tools'
  /** State immediately before this change; absent for the initial header. */
  /* 变更前的状态；初始请求头没有该字段。 */
  previous?: ConversationPromptSnapshot
}

/** Lifecycle fields shared by ordinary generation and compaction requests. */
/* 普通生成与压缩请求共用的生命周期字段。 */
interface RequestViewBase {
  /** Sequence that opened the operation represented by this request. */
  /* 打开本请求所代表操作的序号。 */
  startSeq: number
  startedAt: number
  completedAt: number | null
  status: 'running' | 'complete' | 'error'
  error?: string
  provenance?: AssistantProvenanceView
  requestConfig?: AssistantRequestConfig
  usage?: unknown
  /** Assistant message or compaction summary sequence produced by this request. */
  /* 本请求产出的助手消息或压缩摘要序号。 */
  resultSeq?: number
}

/** One ordinary assistant generation assembled from durable request events. */
/* 由持久化请求事件装配出的一次普通助手生成。 */
interface AssistantRequestView extends RequestViewBase {
  purpose: 'assistant'
  turn: number
  /** Agent-loop step that issued this request. */
  /* 发起本请求的 agent-loop 步骤。 */
  step: number
  /** Effective ordinary request input, inherited until a later header changes it. */
  /* 生效的普通请求输入；在后续请求头改变前由后续请求继承。 */
  prompt?: ConversationPromptSnapshot
  /** Prompt change logged while preparing this request. */
  /* 准备本请求期间记录下的提示变更。 */
  promptChange?: RequestPromptChange
  /** Retry ordinal scheduled after a failed ordinary request. */
  /* 普通请求失败后排程的重试序号。 */
  retry?: number
  maxRetries?: number
  retryDelayMs?: number
}

/** One compaction provider request, either turn-owned or standalone between turns. */
/* 一次压缩提供者请求：归轮次所有，或在轮次之间独立运行。 */
interface CompactionRequestView extends RequestViewBase {
  purpose: 'compaction'
  /** Owning turn, or `null` when manual compaction ran between turns. */
  /* 归属的轮次；手动压缩在轮次之间运行时为 null。 */
  turn: number | null
  /** Direct compaction requests do not consume an agent-loop step. */
  /* 直接压缩请求不消耗 agent-loop 步骤。 */
  step: 0
  /** Compaction replacement message sequence, when one was committed. */
  /* 已提交的压缩替换消息序号（若有）。 */
  replacementSeq?: number
  /** Safe compaction summary projection. */
  /* 安全的压缩摘要投影。 */
  summary?: readonly ContentBlock[]
  /** Complete compaction provider output before the safe projection. */
  /* 安全投影前的完整压缩提供者输出。 */
  rawOutput?: readonly ContentBlock[]
}

/** One provider request assembled from durable request lifecycle events. */
/* 由持久化请求生命周期事件装配出的一次提供者请求。 */
export type RequestView = AssistantRequestView | CompactionRequestView

/** Request data consumed by the stage-oriented Trajectory layout. */
/* 面向阶段的 Trajectory 布局消费的请求数据。 */
export interface RequestInspectionSnapshot {
  requests: readonly RequestView[]
  callSchemas: ReadonlyMap<string, ToolSchema>
}
