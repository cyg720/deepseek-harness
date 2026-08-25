/**
 * ================================ 文件注释 ================================
 * 【文件职责】定义"会话上下文代"（Conversation Context）的数据模型：一次
 *   追加式模型上下文的不可变世代，由会话表面的替换操作重建而来。
 * 【技术维度】纯类型模块（interface + 字符串字面量联合类型）；
 *   origin 用可辨识的联合描述代际来源（compaction/rewind/rewrite）。
 * 【产品维度】当会话被压缩（compaction）、回退（rewind）或重写（rewrite）时，
 *   客户端需要重建并展示历史上下文，本模型描述每一代上下文的快照信息。
 * 【逻辑维度】ConversationContextOriginKind 枚举代际来源；
 *   ConversationContext 描述一代上下文：代数 id、父代 parentId、
 *   来源 origin、创建事件序号与时间、请求头快照 prompt、节点列表 nodes。
 * 【关键边界】id 从 0 起随代递增且不随追加变化；nodes 对历史代是冻结的
 *   最终节点，对当前代则是折叠中的节点；字段均为只读。
 * 【新手阅读建议】配合 conversation-assembler.ts 看这些代如何被装配。
 * ==========================================================================
 */
import type { ConversationNode } from './conversation.ts'
import type { ConversationPromptSnapshot } from './request-inspection.ts'

/** Operation that started a new append-only model context. */
/* 开启一个新的追加式模型上下文的操作类型：压缩（compaction）、回退（rewind）、重写（rewrite）。 */
export type ConversationContextOriginKind = 'compaction' | 'rewind' | 'rewrite'

/** One immutable model-context generation reconstructed from surface replacements. */
/*
 * 一代不可变的模型上下文：由会话表面的替换操作重建；
 * 会话内可以有多个世代，形成按父代指针连接的上下文演进链。
 */
export interface ConversationContext {
  /** Zero-based generation within the session; stable across later appends. */
  /* 会话内从 0 起的世代序号；后续追加不会改变它。 */
  id: number
  /** Previous generation in this session; absent for the initial context. */
  /* 本会话中上一代的序号；初始上下文没有该字段。 */
  parentId?: number
  /** Why this generation exists; absent for the initial context. */
  /* 本代产生的原因；初始上下文没有该字段。 */
  origin?: ConversationContextOriginKind
  /** Event seq of the replacement that created this generation. */
  /* 创建本代的替换操作在事件流中的序号（seq）。 */
  originSeq?: number
  /** Unix epoch ms of the replacement that created this generation. */
  /* 创建本代的替换操作发生的 Unix 毫秒时间戳。 */
  createdAt?: number
  /** Latest request header observed in this generation, inherited until a later header replaces it. */
  /* 本代观察到的最新请求头快照；在后续请求头替换前由后代继承。 */
  prompt?: ConversationPromptSnapshot
  /** Final frozen nodes for historical generations, or current folded nodes for the tail. */
  /* 历史世代的最终冻结节点；当前（尾）世代则是折叠中的节点。 */
  nodes: readonly ConversationNode[]
}
