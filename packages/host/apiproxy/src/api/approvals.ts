/**
 * ================================ 文件注释 ================================
 * 【文件职责】审批域契约：定义审批应答载荷 ApprovalResponsePayload。审批
 * requested 帧是 server-request（稳定 rpcId），应答是回显该 rpcId 的
 * client-response（不是一元方法、不在 RpcMethodMap、不铸新 id）。
 * 【技术维度】纯类型契约（零依赖、浏览器可导入）；approvalId 是核心审计关联
 * 字段（宿主实现用它核对 approval/asked 与 approval/decided 事件），线上的
 * 关联则靠回显的 rpcId 维系。
 * 【产品维度】工具执行前需要用户授权的交互（如危险操作）：客户端在 mux 流
 * 收到 approval/requested 帧，通过 POST /api/respond 回答，最终结果在解析帧中
 * 送达。
 * 【逻辑维度】ApprovalResponsePayload：sessionId、approvalId、outcome。
 * 【关键边界】outcome 只接受客户端能给出的两个值（allowed-once / rejected）——
 * cancelled/unavailable 是宿主侧结果，客户端不可上报。
 * 【新手阅读建议】与 questions.ts 对照阅读（两者同为"可回答 server-request"），
 * 并在 api-proxy.ts 的 respond 中看它如何被路由结算。
 * ==========================================================================
 */
/**
 * approvals domain contract. The approval requested frame is a
 * server-request (stable rpcId); the answer is a client-response echoing that rpcId (not a
 * unary method, not in RpcMethodMap, mints no new id), carried on POST /api/respond with an
 * RpcReceipt carrier receipt as the HTTP response body; the final outcome arrives in the resolved frame.
 */

import type { ApprovalRequestId } from '@deepseek-ai/dsh-user-approval/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/**
 * Approval answer payload (the result.value slot of a client-response). outcome accepts only
 * the two values a client can give (cancelled/unavailable are host-side outcomes). approvalId
 * is the core audit correlation (used by the impl to reconcile `approval/asked`/`decided`;
 * passes through core's existing brand); wire correlation is governed by the echoed rpcId.
 */
// 审批应答载荷：sessionId + 审批 id + 客户端可选的结果；approvalId 走核心既有品牌。
export interface ApprovalResponsePayload {
  sessionId: SessionId
  approvalId: ApprovalRequestId
  outcome: 'allowed-once' | 'rejected'
}
