/*
 * ================================ 文件注释 ================================
 * 【文件职责】skills 域的 zod schema（名字从地图键派生）：skill.list 的请求载荷
 * 与响应值校验。
 * 【技术维度】satisfies Wire<> 对齐契约类型；sessionId 复用 sessions.schema 的
 * 品牌铸造点。
 * 【产品维度】客户端 '/' 弹层技能列表的数据校验：技能名/描述/补充指引/模型可
 * 调用性。
 * 【逻辑维度】skillEntrySchema → skillListRequestSchema → skillListValueSchema。
 * 【关键边界】name 最小长度 1（非空）；whenToUse 可选。
 * 【新手阅读建议】与 skills.ts 契约及 api-proxy.ts 的 skills.list 实现对照。
 * ==========================================================================
 */
/**
 * skills domain zod schemas (names derived from map keys: skillListRequestSchema /
 * skillListValueSchema).
 */

import { z } from 'zod'
import type { RequestPayload, ResponseValue } from './rpc-map.ts'
import type { Wire } from './rpc.schema.ts'
import { sessionIdSchema } from './sessions.schema.ts'
import type { SkillEntry } from './skills.ts'

/** SkillEntry row of skill.list. */
// skill.list 的技能条目行。
export const skillEntrySchema = z.object({
  name: z.string().min(1),
  description: z.string(),
  whenToUse: z.string().optional(),
  modelInvocable: z.boolean(),
}) satisfies z.ZodType<Wire<SkillEntry>>

/** skill.list request payload. */
export const skillListRequestSchema = z.object({
  sessionId: sessionIdSchema,
}) satisfies z.ZodType<Wire<RequestPayload<'skill.list'>>>

/** skill.list response value. */
export const skillListValueSchema = z.object({
  skills: z.array(skillEntrySchema),
}) satisfies z.ZodType<Wire<ResponseValue<'skill.list'>>>
