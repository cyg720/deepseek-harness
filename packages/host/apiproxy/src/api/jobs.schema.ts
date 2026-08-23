/**
 * ================================ 文件注释 ================================
 * 【文件职责】tasks 域的 zod schema：品牌化的任务 id 与 session/jobs 帧携带的
 * 线上任务视图。
 * 【技术维度】taskIdSchema 是唯一品牌铸造点（非空字符串校验后一次 cast）；
 * kind 保持开放字符串——生产者插件通过声明合并扩展 kind 映射，本边界无法枚举
 * 封闭集合；视图 schema 用 satisfies Wire<JobView> 对齐契约类型。
 * 【产品维度】客户端任务列表（运行/停止/完成/被杀/失败状态 + 详细信息）的
 * 校验来源，保证 session/jobs 帧结构稳定。
 * 【逻辑维度】任务 id schema → 任务视图 schema（id/kind/label/status/detail/
 * startedAt/finishedAt）。
 * 【关键边界】status 是封闭枚举（五个字面量）；detail/finishedAt 可选，仅当
 * 生产者提供时出现。
 * 【新手阅读建议】与 jobs.ts 的 JobView 类型对照阅读，理解"类型 + schema"双
 * 份声明如何被 satisfies 约束一致。
 * ==========================================================================
 */
/**
 * tasks domain zod schemas: the branded job id and the wire view carried by
 * `session/jobs` frames.
 */

import { z } from 'zod'
import type { JobId } from '@deepseek-ai/dsh-jobs/brand'
import type { JobView } from './jobs.ts'
import type { Wire } from './rpc.schema.ts'

/** JobId: one brand cast after non-empty string validation. */
// 任务 id：先校验非空字符串，再做唯一一次品牌 cast。
export const taskIdSchema = z.string().min(1) as unknown as z.ZodType<JobId>

/**
 * One wire task view. `kind` stays an open string because producer plugins
 * extend the registry's kind map by declaration merging, so the closed set is
 * not knowable at this boundary.
 */
export const taskViewSchema = z.object({
  id: taskIdSchema,
  kind: z.string().min(1),
  label: z.string().min(1),
  status: z.union([
    z.literal('running'),
    z.literal('stopping'),
    z.literal('completed'),
    z.literal('killed'),
    z.literal('failed'),
  ]),
  detail: z.string().optional(),
  startedAt: z.number().int().nonnegative(),
  finishedAt: z.number().int().nonnegative().optional(),
}) satisfies z.ZodType<Wire<JobView>>
