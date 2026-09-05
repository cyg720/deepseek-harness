

/**
 * Public session-reference request, candidate, and preparation records.
 * Imports stay on type-only subpaths so generated Remote clients can consume
 * this module without Host runtime code.
 * @module @deepseek-ai/dsh-session-reference/types
 */

/*
 * 【文件职责】声明会话引用请求、候选和准备结果，使用纯类型导入以供生成的浏览器 Remote 安全消费。
 */

import type { UserMessage } from '@deepseek-ai/dsh-llm/message'
import type { ContentBlock } from '@deepseek-ai/dsh-llm/types'
import type { OptionalSessionSeq, SessionId } from '@deepseek-ai/dsh-session/types'

/** Durable source session, cited event seqs, and snapshot facts for prepared cross-session context. */
/* 已准备的跨会话上下文：记录来源会话、引用的事件序号与快照事实，随消息持久化。 */
export interface SessionReferenceSource {
  kind: 'session-reference'
  /** Material lifted out of another session's log (`recall` context form). */
  /* 从其他会话日志中提取的材料（recall 上下文形态）。 */
  form: 'recall'
  version: 1
  references: {
    sessionId: string
    label: string
    /** Source Session format generation; absence identifies version 0. */
    capturedFormatVersion?: number
    capturedThroughSeq: OptionalSessionSeq
    compacted: boolean
    originalMessages: number
    retainedMessages: number
    omittedMessages: number
    omittedBytes: number
    truncated: boolean
    inputIndex: number
  }[]
}

/** 声明合并：把本来源类型注册进 dsh-llm 的消息来源映射，使消息能携带该来源。 */
declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'session-reference': SessionReferenceSource
  }
}

/** One source session selected by a host. */
/* 宿主选定的一个来源会话（输入形态）。 */
export interface SessionReferenceInput {
  /** Opaque source session identity. */
  /* 不透明的来源会话标识。 */
  sessionId: SessionId
  /** Optional user-facing mention label. */
  /* 可选的对用户展示的提及标签。 */
  label?: string
}

/** One host-facing candidate from exact session metadata. */
/* 一个面向宿主的发现候选：来自会话元数据的精确读取。 */
export interface SessionReferenceCandidate {
  /** Opaque source session identity. */
  /* 不透明的来源会话标识。 */
  sessionId: SessionId
  /** Latest log-backed title, falling back to the opaque session id. */
  /* 最新日志支持的标题；没有标题时回退为会话 id 本身。 */
  label: string
  /** Source session working directory, when recorded. */
  /* 来源会话的工作目录（若已记录）。 */
  cwd?: string
  /**
   * True when {@link SessionReferenceCandidate.cwd} is recorded and equals the
   * requesting agent's. Hosts that only surface a distinguishing location
   * read this instead of comparing paths they never received.
   */
  sameWorkspace: boolean
  /** Source session creation time in Unix epoch milliseconds. */
  /* 来源会话的创建时间（Unix 毫秒时间戳）。 */
  createdAt: number
}

/** One discovery candidate carrying its canonical prompt mention. */
/* 携带规范提及文本的发现候选：宿主可直接把 mention 插入提示词草稿。 */
export interface SessionReferenceMentionCandidate extends SessionReferenceCandidate {
  /** Canonical `@[label](dsh-session:…)` mention serialized into the prompt draft. */
  /* 序列化进提示词草稿的规范提及：@[label](dsh-session:…)。 */
  mention: string
}

/** Direct message content and optional referenced-session context. */
/* 直接消息内容 + 可选的被引用会话上下文（准备阶段的结果形态）。 */
export interface PreparedReferencedMessage {
  /** Readable message content after host mention tokens are removed. */
  /* 移除宿主提及 token 后的可读消息内容。 */
  content: ContentBlock[]
  /** Aggregated untrusted snapshot, absent when the message has no references. */
  /* 聚合的不可信快照；消息没有引用时该字段不存在。 */
  additionalContext?: UserMessage
}

/** Text-only projected conversation item. */
/* 仅文本的会话投影条目（供 UI 只读展示引用内容）。 */
export interface ReferencedConversationItem {
  /** Original message role. */
  /* 原始消息角色。 */
  role: 'user' | 'assistant'
  /** Visible text retained from that message. */
  /* 从该消息保留下的可见文本。 */
  text: string
}
