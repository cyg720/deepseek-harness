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

/**
 * dsh-llm's owned branded ids: tool-call correlation and provider request
 * diagnostics.
 *
 * The `Branded<B>` primitive itself lives in `@deepseek-ai/dsh-brand` (a
 * zero-dependency type-only package) so every owner of a cross-boundary id can
 * brand it without depending on dsh-llm; see that package's README for the
 * nominal-typing policy.
 *
 * @module @deepseek-ai/dsh-llm/brand
 */

import type { Branded } from '@deepseek-ai/dsh-brand'

/*
 * （中文）消息标识符类型：把普通 string 打上 "MessageId" 名义标签，使其在
 * 类型层面与其他字符串区分开，防止把消息 id 误当成别的字符串使用。该 id 是
 * 单条消息的稳定身份，跨收件箱、会话日志、模型请求等多个边界保持一致。
 */
/** Stable identity carried by one message across inbox, log, and model-request boundaries. */
export type MessageId = Branded<'MessageId'>

/*
 * （中文）给任意字符串打上 MessageId 标签的构造辅助函数；不做任何校验，只是
 * 在类型层面做标记，运行时返回原字符串。
 * @param id 不透明的消息标识符。
 * @returns 同一个字符串，只是类型被标记为 MessageId。
 */
/**
 * Brand a message identifier.
 * @param id - the opaque message identifier.
 * @returns the same string, branded; no validation is performed.
 */
export function MessageId(id: string): MessageId {
  return id as MessageId
}

/*
 * （中文）工具调用关联标识：把模型发起的一次工具调用（tool call）与其结果
 * 消息关联起来。真实适配器由 provider 颁发，mock 或组装器兜底时合成。
 */
/**
 * Correlates a model-issued tool call with its result. Provider-issued for
 * real adapters; synthesized by mocks/assembler fallbacks.
 */
export type ToolCallId = Branded<'ToolCallId'>

/*
 * （中文）给字符串打上 CallId 标签；运行时无校验，纯类型标记。
 * @param id provider 颁发（或合成）的调用 id。
 * @returns 同一个字符串，类型标记为 CallId。
 */
/**
 * Brand a string as a {@link ToolCallId}.
 * @param id - the provider-issued (or synthesized) call id.
 * @returns the same string, branded; no validation is performed.
 */
export function ToolCallId(id: string): ToolCallId {
  return id as ToolCallId
}

/*
 * （中文）provider 请求标识：provider 在响应/报错里给出的请求级标识，跨包
 * 边界保留用于诊断（例如排查一次失败请求）。
 */
/** Provider-issued request identifier retained for diagnostics across package boundaries. */
export type ProviderRequestId = Branded<'ProviderRequestId'>

/*
 * （中文）给字符串打上 ProviderRequestId 标签；运行时无校验。
 * @param id 不透明的 provider 颁发的请求标识。
 * @returns 同一个字符串，类型标记为 ProviderRequestId。
 */
/**
 * Brand a provider-issued request identifier.
 * @param id - the opaque provider-issued string.
 * @returns the same string, branded; no validation is performed.
 */
export function ProviderRequestId(id: string): ProviderRequestId {
  return id as ProviderRequestId
}

/*
 * （中文）推理强度标识：适配器为某个模型暴露的可选推理强度（reasoning
 * effort）级别的 id，例如 low / medium / high。
 */
/** Adapter-owned identifier for one model's selectable reasoning effort. */
export type ReasoningEffortId = Branded<'ReasoningEffortId'>

/*
 * （中文）给字符串打上 ReasoningEffortId 标签；运行时无校验。
 * @param id 某个模型能力暴露的推理强度标识。
 * @returns 同一个字符串，类型标记为 ReasoningEffortId。
 */
/**
 * Brand an adapter-owned reasoning-effort identifier.
 * @param id - the opaque identifier exposed by one model capability.
 * @returns the same string, branded; no validation is performed.
 */
export function ReasoningEffortId(id: string): ReasoningEffortId {
  return id as ReasoningEffortId
}
