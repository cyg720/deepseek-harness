/*
 * ================================ 文件注释 ================================
 * 【文件职责】会话引用的公开请求/候选/准备记录类型。全部是类型定义，
 *             且 import 只走 type-only 子路径，使生成的 Remote 客户端可以
 *             在不加载 Host 运行时代码的情况下消费本模块。
 * 【技术维度】纯类型模块；通过声明合并把 SessionReferenceSource 挂进
 *             dsh-llm 的 MessageSourceMap（消息来源类型注册表）。
 * 【产品维度】描述"引用另一个会话"这一能力的数据契约：引用谁、候选长什么样、
 *             准备好的上下文如何携带。
 * 【逻辑维度】按数据流排列：输入（SessionReferenceInput）→ 发现候选
 *             （SessionReferenceCandidate/MentionCandidate）→ 准备结果
 *             （PreparedReferencedMessage/SessionReferenceSource）→ 展示投影
 *             （ReferencedConversationItem）。
 * 【关键边界】SessionReferenceSource 的附加上下文被视为不可信快照，模型只可
 *             作为背景信息使用；本文件不含任何运行时逻辑。
 * 【新手阅读建议】按"输入 → 候选 → 结果"的顺序读类型，先把握引用链路的
 *                 数据形态，再去看实现它的 index.ts。
 * ==========================================================================
 */

/**
 * Public session-reference request, candidate, and preparation records.
 * Imports stay on type-only subpaths so generated Remote clients can consume
 * this module without Host runtime code.
 * @module @deepseek-ai/dsh-session-reference/types
 */

import type { UserMessage } from '@deepseek-ai/dsh-llm/message'
import type { ContentBlock } from '@deepseek-ai/dsh-llm/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

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
    capturedThroughSeq: number | null
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
