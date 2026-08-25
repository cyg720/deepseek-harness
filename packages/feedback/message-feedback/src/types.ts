/**
 * Public request, value, and failure vocabulary for per-message feedback.
 * This module contains types only so generated Remote clients can consume it
 * without importing Host runtime code.
 * @module @deepseek-ai/dsh-message-feedback/types
 */
/*
 * 文件职责：定义消息反馈功能的公开类型、请求字段与失败结果（types.ts）。
 * 技术维度：TypeScript 类型、品牌标识符与可辨识联合。
 * 产品维度：让客户端和 Host 以一致格式提交与展示消息反馈。
 * 逻辑维度：声明标识符、请求、状态和错误类型，不执行运行时逻辑。
 * 关键边界：本文件仅承载跨包类型，字段变更会影响生成的 Remote 客户端。
 * 新手阅读建议：从品牌 ID 开始，再读请求与返回联合，最后核对失败分支。
 */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type { MessageId } from '@deepseek-ai/dsh-llm/brand'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** Opaque compare-and-set token for one exact feedback item revision. */
/* 中文说明：type MessageFeedbackVersion 定义本模块所需的数据或行为，用于表达当前功能场景。 */
export type MessageFeedbackVersion = Branded<'MessageFeedbackVersion'>

/** The human's overall judgment of one assistant message. */
/* 中文说明：type MessageFeedbackRating 定义本模块所需的数据或行为，用于表达当前功能场景。 */
export type MessageFeedbackRating = 'positive' | 'negative'

/** One current feedback value and its opaque mutation token. */
/* 中文说明：interface MessageFeedbackItem 定义本模块所需的数据或行为，用于表达当前功能场景。 */
export interface MessageFeedbackItem {
  /** Stable identity of the assistant message inside the owning Session. */
  readonly messageId: MessageId
  /** Overall positive or negative judgment. */
  readonly rating: MessageFeedbackRating
  /** Optional explanation, preserved verbatim after validation. */
  readonly note?: string
  /** Equality-only token replaced by every material create or update. */
  readonly version: MessageFeedbackVersion
  /** Host-assigned creation time in Unix epoch milliseconds. */
  readonly createdAt: number
  /** Host-assigned time of the most recent material update. */
  readonly updatedAt: number
}

/** Read all message feedback belonging to one persisted Session lifecycle. */
/* 中文说明：interface MessageFeedbackListRequest 定义本模块所需的数据或行为，用于表达当前功能场景。 */
export interface MessageFeedbackListRequest {
  /** Persisted Session whose sidecar should be read. */
  readonly sessionId: SessionId
}

/** Current feedback values for one Session, in first-creation order. */
/* 中文说明：interface MessageFeedbackListValue 定义本模块所需的数据或行为，用于表达当前功能场景。 */
export interface MessageFeedbackListValue {
  /** Fresh immutable item snapshots. */
  readonly items: readonly MessageFeedbackItem[]
}

/** Create or replace feedback for one assistant message. */
/* 中文说明：interface MessageFeedbackPutRequest 定义本模块所需的数据或行为，用于表达当前功能场景。 */
export interface MessageFeedbackPutRequest {
  /** Persisted Session that owns the target message. */
  readonly sessionId: SessionId
  /** Target assistant-message identity. */
  readonly messageId: MessageId
  /** Desired overall judgment. */
  readonly rating: MessageFeedbackRating
  /** Optional non-blank explanation. */
  readonly note?: string
  /** Observed item version, or `null` to require that no item exists. */
  readonly ifVersion: MessageFeedbackVersion | null
}

/** Delete feedback for one message after observing its current version. */
/* 中文说明：interface MessageFeedbackDeleteRequest 定义本模块所需的数据或行为，用于表达当前功能场景。 */
export interface MessageFeedbackDeleteRequest {
  /** Persisted Session that owns the sidecar. */
  readonly sessionId: SessionId
  /** Message whose feedback should be absent after this operation. */
  readonly messageId: MessageId
  /** Observed item version; ignored when the item is already absent. */
  readonly ifVersion: MessageFeedbackVersion
}

/** Idempotent deletion acknowledgement. */
/* 中文说明：interface MessageFeedbackDeleteValue 定义本模块所需的数据或行为，用于表达当前功能场景。 */
export interface MessageFeedbackDeleteValue {
  /** Stable postcondition shared by the first deletion and every retry. */
  readonly absent: true
}

/** No persisted Session header exists for the requested id. */
/* 中文说明：interface MessageFeedbackSessionNotFound 定义本模块所需的数据或行为，用于表达当前功能场景。 */
export interface MessageFeedbackSessionNotFound {
  readonly code: 'session-not-found'
  readonly sessionId: SessionId
}

/** The id does not name a derived, append-origin assistant message. */
/* 中文说明：interface MessageFeedbackTargetNotFound 定义本模块所需的数据或行为，用于表达当前功能场景。 */
export interface MessageFeedbackTargetNotFound {
  readonly code: 'target-not-found'
  readonly sessionId: SessionId
  readonly messageId: MessageId
}

/** A material mutation did not match the addressed item's current version. */
/* 中文说明：interface MessageFeedbackVersionConflict 定义本模块所需的数据或行为，用于表达当前功能场景。 */
export interface MessageFeedbackVersionConflict {
  readonly code: 'version-conflict'
  /** Authoritative current item, or `null` when it does not exist. */
  readonly current: MessageFeedbackItem | null
}

/** A supplied note contains no non-whitespace character. */
/* 中文说明：interface MessageFeedbackNoteBlank 定义本模块所需的数据或行为，用于表达当前功能场景。 */
export interface MessageFeedbackNoteBlank {
  readonly code: 'note-blank'
}

/** A supplied note exceeds the configured UTF-8 byte limit. */
/* 中文说明：interface MessageFeedbackNoteTooLarge 定义本模块所需的数据或行为，用于表达当前功能场景。 */
export interface MessageFeedbackNoteTooLarge {
  readonly code: 'note-too-large'
  readonly maxBytes: number
  readonly actualBytes: number
}

/** Failures shared by the public message-feedback operations. */
/* 中文说明：type MessageFeedbackFailure 定义本模块所需的数据或行为，用于表达当前功能场景。 */
export type MessageFeedbackFailure =
  | MessageFeedbackSessionNotFound
  | MessageFeedbackTargetNotFound
  | MessageFeedbackVersionConflict
  | MessageFeedbackNoteBlank
  | MessageFeedbackNoteTooLarge

/** Successful public operation result. */
/* 中文说明：interface MessageFeedbackSuccess 定义本模块所需的数据或行为，用于表达当前功能场景。 */
export interface MessageFeedbackSuccess<T> {
  readonly ok: true
  readonly value: T
}

/** Rejected public operation result with a stable business failure. */
/* 中文说明：interface MessageFeedbackRejected 定义本模块所需的数据或行为，用于表达当前功能场景。 */
export interface MessageFeedbackRejected<E extends MessageFeedbackFailure> {
  readonly ok: false
  readonly error: E
}

/** Result returned by the message-feedback `list` operation. */
/* 中文说明：type MessageFeedbackListResult 定义本模块所需的数据或行为，用于表达当前功能场景。 */
export type MessageFeedbackListResult =
  | MessageFeedbackSuccess<MessageFeedbackListValue>
  | MessageFeedbackRejected<MessageFeedbackSessionNotFound>

/** Result returned by the message-feedback `put` operation. */
/* 中文说明：type MessageFeedbackPutResult 定义本模块所需的数据或行为，用于表达当前功能场景。 */
export type MessageFeedbackPutResult =
  | MessageFeedbackSuccess<MessageFeedbackItem>
  | MessageFeedbackRejected<
    | MessageFeedbackSessionNotFound
    | MessageFeedbackTargetNotFound
    | MessageFeedbackVersionConflict
    | MessageFeedbackNoteBlank
    | MessageFeedbackNoteTooLarge
  >

/** Result returned by the message-feedback `delete` operation. */
/* 中文说明：type MessageFeedbackDeleteResult 定义本模块所需的数据或行为，用于表达当前功能场景。 */
export type MessageFeedbackDeleteResult =
  | MessageFeedbackSuccess<MessageFeedbackDeleteValue>
  | MessageFeedbackRejected<MessageFeedbackSessionNotFound | MessageFeedbackVersionConflict>
