/*
 * ================================ 文件注释 ================================
 * 【文件职责】审批域的 zod schema：审批 id 品牌铸造点与审批应答载荷 schema，
 * 服务于 /api/respond 端点经 pending 表路由后的二次解析。
 * 【技术维度】approvalRequestIdSchema 是本域唯一品牌铸造点（非空字符串校验后
 * cast）；载荷 schema 用 satisfies Wire<ApprovalResponsePayload> 对齐契约类型。
 * 【产品维度】客户端对审批的应答在线上边界被严格校验，outcome 只能是
 * allowed-once / rejected，防止非法取值。
 * 【逻辑维度】审批 id schema → 应答载荷 schema（sessionId + approvalId + outcome）。
 * 【关键边界】approvalId 最小长度 1（非空）；应答中的 sessionId/approvalId 必须
 * 与 pending 条目匹配才算合法（由实现层校验，schema 只保证形状）。
 * 【新手阅读建议】与 approvals.ts 的类型对照阅读，并在 api-proxy.ts 的 respond
 * 中看 schema 解析后的审计关联校验。
 * ==========================================================================
 */
/**
 * approvals domain zod schemas (respond is a client-response; the payload schema serves
 * the /api/respond endpoint's second parse after routing via the pending table).
 * ApprovalRequestId brand cast point: one.
 */

import { z } from 'zod'
import type { ApprovalRequestId } from '@deepseek-ai/dsh-user-approval/types'
import type { ApprovalResponsePayload } from './approvals.ts'
import type { Wire } from './rpc.schema.ts'
import { sessionIdSchema } from './sessions.schema.ts'

/** ApprovalRequestId: one brand cast after schema validation (the only cast point in this domain). */
// 审批 id：非空字符串校验后的唯一一次品牌 cast。
export const approvalRequestIdSchema = z.string().min(1) as unknown as z.ZodType<ApprovalRequestId>

/** Approval answer payload (the result.value slot of a client-response). */
// 审批应答载荷 schema：会话/审批/结果三字段，outcome 收窄为两个合法字面量。
export const approvalResponsePayloadSchema = z.object({
  sessionId: sessionIdSchema,
  approvalId: approvalRequestIdSchema,
  outcome: z.union([z.literal('allowed-once'), z.literal('rejected')]),
}) satisfies z.ZodType<Wire<ApprovalResponsePayload>>
