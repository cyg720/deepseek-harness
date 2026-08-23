/**
 * ================================ 文件注释 ================================
 * 【文件职责】注册 sessionStats 投影单元的函数插件：把全日志的回合/步骤计数与
 *   LLM/工具/首 token/解码耗时经 session-projection 能力缝对外提供。
 * 【技术维度】函数式 Cordis 插件（name/inject/apply）；插件只拥有折叠，
 *   投递（快照、变更馈送、各类载体）由能力缝负责。
 * 【产品维度】客户端渲染"全会话统计"（分页与压缩不会改变这些数字）。
 * 【逻辑维度】按代码顺序：类型导出 → name/inject → apply（注册投影定义）。
 * 【关键边界】无 sessionProjections 时注入保持 pending（该注册表是插件的全部目的）。
 * 【新手阅读建议】折叠逻辑在 projection.ts，这里只是注册入口。
 * ==========================================================================
 */

/**
 * Function plugin registering the `sessionStats` projection unit: whole-log
 * turn/step counts and LLM/tool/first-token/decode wall times served through
 * the session-projection seam (registry snapshot, change feed, and every
 * projection carrier), so clients render full-session figures that paging and
 * compaction cannot change. The plugin owns only the fold; delivery is the
 * seam's.
 *
 * @module @deepseek-ai/dsh-session-stats
 */

import type { Context } from '@deepseek-ai/cordis'
import { sessionStatsProjectionDefinition } from './projection.ts'

export type * from './types.ts'

/** Cordis plugin name. */
// 中文：插件名与依赖：投影注册表是插件的全部目的，没有它注入保持 pending。
export const name = 'session-stats'
/** The projection registry is the plugin's whole purpose; without it the fiber stays pending. */
export const inject = ['sessionProjections']

/**
 * Register the `sessionStats` unit; the registration is an effect on this
 * plugin's fiber, so unloading removes the key.
 * @param ctx - registrant context carrying the projection registry.
 */
export function apply(ctx: Context): void {
  ctx.sessionProjections.register(sessionStatsProjectionDefinition)
}
