/**
 * Pure types of the title domain: the ONE home of the `title` projection-key
 * declaration, free of this package's host-side value imports (cordis
 * service, schemastery, the llm seam). Two namespace projections serve it —
 * `./types` for host consumers and `./client/types` for client aggregates —
 * with zero content duplication.
 *
 * @module @deepseek-ai/dsh-session-title/types
 */

export {}

/*
 * ================================ 文件注释 ================================
 * 【文件职责】标题域的纯类型出口：title 投影键声明的唯一出处（宿主状态表 + 客户端视图表）。
 * 【技术维度】export {} 使文件成为模块以"增强"投影表；纯类型、无宿主侧值导入。
 * 【产品维度】客户端列表行消费的标题投影（last-wins 纯文本）。
 * 【逻辑维度】投影键声明合并（title: string | null）。
 * 【新手阅读建议】与 session-title 服务里注册的 title 投影单元对照。
 * ==========================================================================
 */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** Identifies one session-title provider registration. */
export type SessionTitleProviderId = Branded<'SessionTitleProviderId'>

/** Exact auxiliary model route that produced a title. */
export interface SessionTitleModelProvenance {
  /** Registered LLM provider route. */
  readonly provider: string
  /** Provider model id. */
  readonly model: string
}

/** Durable ownership record for an accepted session title. */
export type SessionTitleSource =
  | { readonly kind: 'fallback' }
  | {
    readonly kind: 'provider'
    readonly provider: SessionTitleProviderId
    readonly model?: SessionTitleModelProvenance
  }
  | {
    /** Explicit user rename: pins the title — automatic generation stops scheduling. */
    readonly kind: 'user'
  }

/** Payload of the log-only `session/title` event. */
export interface SessionTitleEventData {
  /** Normalized non-empty title text. */
  readonly title: string
  /** Exact human `user/message` seqs used to derive this title; empty for an explicit user rename. */
  readonly messageSeqs: number[]
  /** Whether the built-in fallback, a registered provider, or the user supplied the title. */
  readonly source: SessionTitleSource
}

/** Latest folded title plus the title event's durable envelope facts. */
export interface SessionTitleSnapshot extends SessionTitleEventData {
  /** Seq of the latest `session/title` event. */
  readonly eventSeq: number
  /** Timestamp of the latest `session/title` event. */
  readonly updatedAt: number
}

/** Host title projection value. */
export type TitleProjection = SessionTitleSnapshot

/** One eligible human text message exposed to title providers. */
export interface SessionTitleUserMessage {
  /** Source `user/message` event seq. */
  readonly seq: number
  /** Exact concatenated text-block content. */
  readonly text: string
}

/** Eligible title input stored as a bounded aggregate. */
export interface TitleInputState {
  /** The oldest eligible message, or null before any. */
  readonly first: SessionTitleUserMessage | null
  /** Total eligible messages folded so far. */
  readonly count: number
  /** Seq of the newest eligible message, or null before any. */
  readonly lastSeq: number | null
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    /** Latest logged title text, or null. */
    title: string | null
    /** Eligible human title input. */
    titleInput: TitleInputState
  }
  interface SessionProjectionMap {
    /**
     * The session's current normalized title — the latest `session/title`
     * event's text (last-wins), or `null` before the first title lands. A
     * plain string: the shape the client list rows consume.
     */
    title: string | null
  }
}
