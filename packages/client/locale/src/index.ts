/**
 * ================================ 文件注释 ================================
 * 【文件职责】浏览器语言偏好的 Host 注册：当存在设置提供者时，把持久化
 *   语言段注册进 settings 服务。
 * 【技术维度】Cordis 插件：经 ctx.inject(['settings']) 条件挂载（无设置
 *   服务则跳过）；复用 locale-settings.ts 的契约常量与 schema。
 * 【产品维度】Host 侧拥有用户设置文档；语言偏好在这里获得持久化位置，
 *   浏览器侧（client/index.ts）经设置作用域读写。
 * 【逻辑维度】apply 注入 settings 并注册命名空间段。
 * 【关键边界】settings 服务可选（inject 语义）；re-export 提供统一类型
 *   入口。
 * 【新手阅读建议】先读 locale-settings.ts 理解契约，再对照 client/ 半边。
 * ==========================================================================
 */
/** Host registration for the browser locale preference. */
/* 浏览器语言偏好的 Host 注册。 */

import type { Context } from '@deepseek-ai/cordis'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import { LOCALE_SETTINGS_NAMESPACE, LocaleSettingsSchema } from './locale-settings.ts'

export {
  LOCALE_IDS, LOCALE_PREFERENCE_FIELD, LOCALE_SETTINGS_NAMESPACE,
  type BuiltInLocaleId, type LocaleId, type LocaleSettings,
} from './locale-settings.ts'

/**
 * Register the durable locale section when a settings provider exists.
 * @param ctx - Host context whose optional settings service owns the section.
 */
/*
 * 当存在设置提供者时注册持久化语言段。
 * @param ctx 其可选 settings 服务拥有该段的 Host 上下文。
 */
export function apply(ctx: Context): void {
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.register(
      settingsNamespace(LOCALE_SETTINGS_NAMESPACE),
      LocaleSettingsSchema,
    )
  })
}
