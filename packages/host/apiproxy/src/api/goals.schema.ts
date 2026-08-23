/**
 * ================================ 文件注释 ================================
 * 【文件职责】goals 域的 zod schema 集合：六个变更动词（create/edit/pause/
 * resume/complete/clear）的请求载荷与响应值校验。
 * 【技术维度】纯变更形状：除 clear 外的值 schema 都是 { ref } 回执（clear 是
 * { cleared }）——当前目标状态完全走 'goal' 会话投影，不经过本域值；edit 用
 * refine 强制 objective 与 maxGoalRounds 至少其一。
 * 【产品维度】目标管理界面的数据校验：创建/编辑/暂停/恢复/完成/清除目标，
 * 回执新 CAS 引用（id + revision）。
 * 【逻辑维度】goalRefSchema → 共享 { ref } 值 schema → 各动词的请求/值 schema。
 * 【关键边界】revision 为正整数（CAS 版本号）；edit 至少提供一个可编辑字段；
 * clear 的值是 { cleared: true } 字面量。
 * 【新手阅读建议】与 goals.ts 契约及 api-proxy.ts 的 goals 域实现（mutateGoal）
 * 对照阅读。
 * ==========================================================================
 */
/**
 * goals domain zod schemas. Mutation-only shapes: every value schema is a
 * `{ ref }` acknowledgement (clear: `{ cleared }`) — the current goal state
 * travels exclusively on the 'goal' session projection.
 */

import { z } from 'zod'
import type { Wire } from './rpc.schema.ts'
import type { GoalRef, RequestPayload, ResponseValue } from './index.ts'

/** GoalRef schema. */
// 目标 CAS 引用：id + 正整数 revision。
export const goalRefSchema = z.object({
  id: z.string(),
  revision: z.number().int().positive(),
}) as unknown as z.ZodType<Wire<GoalRef>>

/** Shared `{ ref }` acknowledgement value of every non-clear mutation. */
// 除 clear 外所有变更动词共用的 { ref } 回执值。
const goalRefValueSchema = z.object({ ref: goalRefSchema })

/** goal.create request payload. */
export const goalCreateRequestSchema = z.object({
  sessionId: z.string(),
  objective: z.string().min(1),
  maxGoalRounds: z.number().int().positive().optional(),
}) as unknown as z.ZodType<Wire<RequestPayload<'goal.create'>>>

/** goal.create response value. */
export const goalCreateValueSchema = goalRefValueSchema as unknown as z.ZodType<Wire<ResponseValue<'goal.create'>>>

/** goal.edit request payload. */
export const goalEditRequestSchema = z.object({
  sessionId: z.string(),
  ref: goalRefSchema,
  objective: z.string().min(1).optional(),
  maxGoalRounds: z.number().int().positive().optional(),
}).refine(value => value.objective !== undefined || value.maxGoalRounds !== undefined, {
  message: 'goal.edit requires objective or maxGoalRounds',
}) as unknown as z.ZodType<Wire<RequestPayload<'goal.edit'>>>

/** goal.edit response value. */
export const goalEditValueSchema = goalRefValueSchema as unknown as z.ZodType<Wire<ResponseValue<'goal.edit'>>>

/** goal.pause request payload. */
export const goalPauseRequestSchema = z.object({
  sessionId: z.string(),
  ref: goalRefSchema,
}) as unknown as z.ZodType<Wire<RequestPayload<'goal.pause'>>>

/** goal.pause response value. */
export const goalPauseValueSchema = goalRefValueSchema as unknown as z.ZodType<Wire<ResponseValue<'goal.pause'>>>

/** goal.resume request payload. */
export const goalResumeRequestSchema = z.object({
  sessionId: z.string(),
  ref: goalRefSchema,
}) as unknown as z.ZodType<Wire<RequestPayload<'goal.resume'>>>

/** goal.resume response value. */
export const goalResumeValueSchema = goalRefValueSchema as unknown as z.ZodType<Wire<ResponseValue<'goal.resume'>>>

/** goal.complete request payload. */
export const goalCompleteRequestSchema = z.object({
  sessionId: z.string(),
  ref: goalRefSchema,
}) as unknown as z.ZodType<Wire<RequestPayload<'goal.complete'>>>

/** goal.complete response value. */
export const goalCompleteValueSchema = goalRefValueSchema as unknown as z.ZodType<Wire<ResponseValue<'goal.complete'>>>

/** goal.clear request payload. */
export const goalClearRequestSchema = z.object({
  sessionId: z.string(),
  ref: goalRefSchema,
}) as unknown as z.ZodType<Wire<RequestPayload<'goal.clear'>>>

/** goal.clear response value. */
export const goalClearValueSchema = z.object({
  cleared: z.literal(true),
}) as unknown as z.ZodType<Wire<ResponseValue<'goal.clear'>>>
