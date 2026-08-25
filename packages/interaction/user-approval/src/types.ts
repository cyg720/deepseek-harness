/**
 * Wire-safe approval identifiers and outcome vocabulary, free of
 * cordis/service imports so browser type chains (apiproxy api → client) can
 * consume them without loading this package's Context augmentation.
 * @module @deepseek-ai/dsh-user-approval/types
 */
/*
 * 文件职责：定义浏览器安全的审批请求品牌标识和封闭审批结果词汇。
 * 技术维度：使用零依赖 Branded 类型与字符串字面量联合，避免加载 Cordis 服务实现。
 * 产品维度：把一次审批询问与最终决定可靠关联，并让调用方明确处理拒绝、取消和不可用。
 * 逻辑维度：声明 ApprovalRequestId 和品牌函数，再列出四种互斥 ApprovalOutcome。
 * 关键边界：品牌函数不校验字符串；unavailable 必须按失败关闭处理，不能等同于允许。
 * 新手阅读建议：先看 ID 如何配对 asked/decided 事件，再逐个理解四种结果对执行权限的影响。
 */

import type { Branded } from '@deepseek-ai/dsh-brand'

/**
 * Pairs one `approval/asked` audit event with its `approval/decided`.
 * Service-issued (one fresh id per {@link ApprovalService.request} call).
 */
/* ApprovalRequestId：每次审批请求新生成的标识，用于配对 asked 与 decided 审计事件。 */
export type ApprovalRequestId = Branded<'ApprovalRequestId'>

/**
 * Brand a string as an {@link ApprovalRequestId}.
 * @param id - the raw id string to brand.
 * @returns the same string carrying the brand.
 */
/*
 * 把服务已生成的原始字符串标记为 ApprovalRequestId。
 * @param id - 每次 ApprovalService.request 新生成的原始 ID。
 * @returns 运行时不变、仅增加编译期品牌的同一字符串。
 * @example ApprovalRequestId('approval-1')。
 */
export function ApprovalRequestId(id: string): ApprovalRequestId {
  return id as ApprovalRequestId
}

/**
 * Closed approval outcomes: a one-shot grant, explicit rejection, withdrawn
 * request, or unavailable answerer. Callers fail closed on `unavailable`.
 */
/* ApprovalOutcome：一次性允许、明确拒绝、请求撤销或回答者不可用四种封闭结果。 */
export type ApprovalOutcome = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'
