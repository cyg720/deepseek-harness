/**
 * ================================ 文件注释 ================================
 * 【文件职责】定义 dsh-llm-retry 包唯一的品牌化 id：RetryId（一次请求步骤的
 * 重试链共享的稳定身份）。
 * 【技术维度】基于 @deepseek-ai/dsh-brand 的 Branded 类型做名义类型；构造
 * 函数只做类型断言，无运行时校验。
 * 【产品维度】重试链跨"调度（llm/retry 事件）→ 等待完成（llm/retry-started
 * 事件）"多次记录，RetryId 把同一策略链的多次记录关联起来，供回放与不变量
 * 校验使用。
 * 【逻辑维度】类型声明 → 同名构造辅助。
 * 【关键边界】无校验；品牌标签全局唯一。
 * 【新手阅读建议】全文极短，直接通读即可。
 * ==========================================================================
 */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** Stable identity shared by every attempt in one request-step retry chain. */
// 中文：同一请求步骤重试链里所有尝试共享的稳定身份（每次调度与启动记录携带）。
export type RetryId = Branded<'RetryId'>

/**
 * （中文）给实现铸造的重试链身份打上品牌标签。
 * @param id 不透明的重试身份。
 * @returns 同一个字符串，品牌化为 RetryId；不做校验。
 */
/**
 * Brand an implementation-minted retry-chain identity.
 * @param id - opaque retry identity.
 * @returns the same string, branded; no validation is performed.
 */
export function RetryId(id: string): RetryId {
  return id as RetryId
}
