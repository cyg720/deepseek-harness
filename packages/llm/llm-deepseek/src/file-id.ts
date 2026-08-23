/**
 * ================================ 文件注释 ================================
 * 【文件职责】定义 DeepSeek Files API 的两类品牌化标识：文件 id（provider
 * 返回）与文件命名空间摘要（本地由端点+API key 推导）。
 * 【技术维度】纯类型层：基于 @deepseek-ai/dsh-brand 的 Branded 类型做名义
 * 类型（nominal typing），构造函数只做类型断言、无运行时校验；命名空间用
 * SHA-256 摘要标识"端点+API key"对应的文件命名空间。
 * 【产品维度】Files API 上传的文件属于"某端点 + 某 API key"的命名空间；
 * 品牌化 id 防止把不同命名空间的文件混淆，是上传/复用/过期管理的基础。
 * 【逻辑维度】DeepSeekFileId（类型 + 构造）→ DeepSeekFileScope（类型 + 构造）。
 * 【关键边界】无运行时校验；命名空间摘要不涉密（SHA-256 单向哈希）。
 * 【新手阅读建议】全文很短，直接通读；重点理解品牌化 id 的用途。
 * ==========================================================================
 */

/** DeepSeek Files API identifiers. @module dsh-llm-deepseek/file-id */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** Opaque identifier returned by the DeepSeek Files API. */
// 中文：DeepSeek Files API 返回的不透明文件标识。
export type DeepSeekFileId = Branded<'DeepSeekFileId'>

/**
 * （中文）在线上校验后给 provider 返回的文件标识打上品牌标签。
 * @param id 非空的 Files API 标识。
 * @returns 同一个字符串，类型层面带上 provider 身份。
 */
/**
 * Brand a provider-returned file identifier after wire validation.
 * @param id - non-empty Files API identifier.
 * @returns the same string with its provider identity attached at type level.
 */
export function DeepSeekFileId(id: string): DeepSeekFileId {
  return id as DeepSeekFileId
}

/** Non-secret digest identifying one endpoint and API-key file namespace. */
// 中文：标识"端点 + API key 文件命名空间"的非机密摘要。
export type DeepSeekFileScope = Branded<'DeepSeekFileScope'>

/**
 * （中文）给本地推导的命名空间摘要打上品牌标签。
 * @param scope 端点与 API key 的 SHA-256 摘要。
 * @returns 同一个字符串，类型层面带上命名空间身份。
 */
/**
 * Brand a locally derived namespace digest.
 * @param scope - SHA-256 digest of endpoint and API key.
 * @returns the same string with namespace identity attached at type level.
 */
export function DeepSeekFileScope(scope: string): DeepSeekFileScope {
  return scope as DeepSeekFileScope
}
