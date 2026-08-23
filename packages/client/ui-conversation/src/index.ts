/**
 * ================================ 文件注释 ================================
 * 【文件职责】浏览器会话偏好的宿主注册入口：当设置服务存在时，把会话设置的命名空间与
 *             schema 登记进用户设置文档，并转发 submission-settings.ts 的公共导出。
 * 【技术维度】Cordis 插件（apply + 条件 inject）；settingsNamespace + settings.register。
 * 【产品维度】让"繁忙时 Enter 行为"等会话设置在宿主侧可持久化、可编辑。
 * 【逻辑维度】1) 转发设置类型与常量；2) apply 里按需注册 schema。
 * 【关键边界】settings 服务可选（inject 是延迟的，不存在时跳过注册）。
 * 【新手阅读建议】与 submission-settings.ts 对照理解 schema 的单一来源。
 * ==========================================================================
 */
/** Host registration for browser conversation preferences. */

import type { Context } from '@deepseek-ai/cordis'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import { CONVERSATION_SETTINGS_NAMESPACE, ConversationSettingsSchema } from './submission-settings.ts'

export {
  BUSY_ENTER_BEHAVIORS, BUSY_ENTER_FIELD, CONVERSATION_SETTINGS_NAMESPACE,
  DEFAULT_BUSY_ENTER_BEHAVIOR, type BusyEnterBehavior, type ConversationSettings,
} from './submission-settings.ts'

/**
 * Register the durable conversation section when a settings provider exists.
 * @param ctx - Host context whose optional settings service owns the section.
 */
/**
 * 当存在设置提供方时，登记持久化的会话设置段。
 * @param ctx - 宿主上下文；其可选 settings 服务拥有该设置段。
 */
export function apply(ctx: Context): void {
  // 条件注入：settings 服务缺失（如无设置功能的宿主）时跳过注册。
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.register(
      settingsNamespace(CONVERSATION_SETTINGS_NAMESPACE),
      ConversationSettingsSchema,
    )
  })
}
