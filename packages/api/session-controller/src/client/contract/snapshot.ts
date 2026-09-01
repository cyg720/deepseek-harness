/** Session-owned observable state excluding Conversation target data. */
/*
 * 文件说明：文件职责：实现 api/session-controller 中 snapshot 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * api/session-controller 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。
 */

import type { ContentBlock } from '@deepseek-ai/dsh-llm/types'
import type { MessageId } from '@deepseek-ai/dsh-llm/brand'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SubagentAddress } from '@deepseek-ai/dsh-subagent/client'
import type { RemoteFailure } from '@deepseek-ai/dsh-typert-protocol'
import type { SessionRequestId } from '../../types.ts'

/** One transient inbox occurrence from the authoritative queue snapshot. */
export interface QueuedMessage {
  readonly id: MessageId
  readonly messageId: MessageId
  readonly placement: 'queued' | 'steering' | 'context'
  /** Prompt-RPC identity of a browser-submitted occurrence; correlates the local submission echo. */
  readonly rpcId?: SessionRequestId
  readonly content: readonly ContentBlock[]
  readonly preview: string
  readonly text: string | null
}

/** One image displayed by a local submission echo before durable admission. */
export interface PendingSubmissionImage {
  /** Browser-owned preview URL; its lifecycle belongs to the submitter, never this snapshot. */
  readonly previewUrl: string
  /** Browser file name, when the file had one. */
  readonly name?: string
  /** Intrinsic pixel width, when the submitter has probed it. */
  readonly width?: number
  /** Intrinsic pixel height, when the submitter has probed it. */
  readonly height?: number
}

/** Client surface selected when a local submission begins. */
export type PendingSubmissionPlacement = 'transcript' | 'queued' | 'steering'

/**
 * One local prompt-submission echo: inserted synchronously when a submission
 * begins, so the conversation can show the message before serialization,
 * transport, and durable admission complete. Client-memory only — reload and
 * reconnect rebuild the conversation from durable events alone.
 */
export interface PendingSubmission {
  /** The prompt RPC identity; the durable `user/message` source echoes it as `rpcId`. */
  readonly requestId: SessionRequestId
  /** Expected surface until the Host reports the admitted queue or durable occurrence. */
  readonly placement: PendingSubmissionPlacement
  /** Client wall-clock ms when the submission began. */
  readonly time: number
  /** Prompt text exactly as it will be sent (one text block). */
  readonly text: string
  /** Ordered image previews matching the prompt's image parts. */
  readonly images: readonly PendingSubmissionImage[]
}

/** History-open lifecycle of a Session event window. */
export type OpenState = 'cold' | 'loading' | 'open' | 'error'

/** Send/stop failure surfaced by Session consumers. */
export interface PromptError {
  readonly op: 'send' | 'stop'
  readonly error: RemoteFailure
}

/** Immutable Session lifecycle and control snapshot. */
export interface SessionSnapshot {
  readonly sessionId: SessionId
  readonly queue: readonly QueuedMessage[]
  /** Local prompt-submission echoes not yet observed as durable events or queue occurrences. */
  readonly pendingSubmissions: readonly PendingSubmission[]
  readonly running: boolean
  readonly subagent: {
    readonly address: SubagentAddress
    /** Absent until the direct-parent catalog resolves. */
    readonly parentAvailable?: boolean
  } | null
  readonly removed: boolean
  readonly openState: OpenState
  readonly openError: RemoteFailure | null
  readonly hasMore: boolean
  readonly loadingOlder: boolean
  readonly promptError: PromptError | null
  readonly blank: boolean
  readonly lastAgentError: string | null
  /** A prompt call has begun on this Client Session object. */
  readonly promptAttempted: boolean
  /** The first accepted prompt has not reached a durable `turn/start` event. */
  readonly awaitingFirstTurn: boolean
}
