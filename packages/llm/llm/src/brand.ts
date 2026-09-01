/**
 * dsh-llm's owned branded ids: tool-call correlation and provider request
 * diagnostics.
 *
 * The `Branded<B>` primitive and stateless constructor live in
 * `@deepseek-ai/dsh-brand` so every owner of a cross-boundary id can brand it
 * without depending on dsh-llm; see that package's README for the
 * nominal-typing policy.
 *
 * @module @deepseek-ai/dsh-llm/brand
 */

/*
 * ================================ 文件注释 ================================
 * 【文件职责】定义 dsh-llm 包自己拥有的一批"品牌化 id"（branded id）类型及
 * 其同名构造函数：MessageId（消息标识）、CallId（工具调用关联标识）、
 * ProviderRequestId（provider 请求标识）、ReasoningEffortId（推理强度标识）。
 * 【技术维度】基于 @deepseek-ai/dsh-brand 的 Branded<B> 原始类型做名义类型
 * （nominal typing）：底层都是字符串，但带上不同品牌标签后互不兼容，编译器
 * 会拒绝跨类型混用。构造函数只做类型断言，不做运行时校验。
 * 【产品维度】这些 id 会跨越包边界（会话日志、模型请求、插件）传递，必须保证
 * 语义清晰、类型安全，防止"字符串满天飞"导致把一种 id 错当成另一种使用。
 * 【逻辑维度】按类型分组：每种品牌类型紧跟一个同名构造函数，模式完全一致——
 * 声明 Branded 类型、提供工厂函数、返回原字符串（无校验）。
 * 【关键边界】无运行时校验，约束只在编译期生效；品牌标签字符串全局唯一。
 * 【新手阅读建议】先读文件头英文模块说明，再依次看四个类型，中文注释帮助
 * 理解每个 id 在项目里被谁、在什么场景使用。
 * ==========================================================================
 */

import { brandString, type Branded } from '@deepseek-ai/dsh-brand'

/** Stable identity carried by one message across inbox, log, and model-request boundaries. */
export type MessageId = Branded<'MessageId'>

/**
 * Brand a message identifier.
 * @param id - the opaque message identifier.
 * @returns the same string with the message-id brand.
 */
export function MessageId(id: string): MessageId {
  return brandString<MessageId>(id)
}

/**
 * Correlates a model-issued tool call with its result. Provider-issued for
 * real adapters; synthesized by mocks/assembler fallbacks.
 */
export type ToolCallId = Branded<'ToolCallId'>

/**
 * Brand a string as a {@link ToolCallId}.
 * @param id - the provider-issued or synthesized call id.
 * @returns the same string with the tool-call-id brand.
 */
export function ToolCallId(id: string): ToolCallId {
  return brandString<ToolCallId>(id)
}

/** Provider-issued request identifier retained for diagnostics across package boundaries. */
export type ProviderRequestId = Branded<'ProviderRequestId'>

/**
 * Brand a provider-issued request identifier.
 * @param id - the opaque provider-issued string.
 * @returns the same string, branded; no validation is performed.
 */
export function ProviderRequestId(id: string): ProviderRequestId {
  return brandString<ProviderRequestId>(id)
}

/** Adapter-owned identifier for one model's selectable reasoning effort. */
export type ReasoningEffortId = Branded<'ReasoningEffortId'>

/**
 * Brand an adapter-owned reasoning-effort identifier.
 * @param id - the opaque identifier exposed by one model capability.
 * @returns the same string, branded; no validation is performed.
 */
export function ReasoningEffortId(id: string): ReasoningEffortId {
  return brandString<ReasoningEffortId>(id)
}
