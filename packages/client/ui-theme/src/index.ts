/*
 * ================================ 文件注释 ================================
 * 【文件职责】ui-theme 包的宿主侧入口：注册耐久主题设置段（有设置服务时），
 *             并每次以当前主题引导行应答 index 注入收集。
 * 【技术维度】Cordis 宿主插件：ctx.inject(['settings']) 注册命名空间与模式；
 *             webserver/index-inject 事件推送引导行（预插件明暗调色板）。
 * 【产品维度】宿主侧主题偏好的持久化与首屏明暗调色板引导。
 * 【逻辑维度】readPreference 读设置段（缺省用模式默认）→ apply 注册段并挂
 *             index 注入监听。
 * 【关键边界】无设置提供者时用 DEFAULT_PREFERENCE。
 * 【新手阅读建议】与 boot-theme.ts 和 theme-settings.ts 对照阅读。
 * ==========================================================================
 */
/** Host registration for the browser theme preference and pre-plugin palette. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import { bootThemeInjection } from './boot-theme.ts'
import {
  DEFAULT_FONT_SIZE, DEFAULT_PREFERENCE, THEME_SETTINGS_NAMESPACE, ThemeSettingsSchema,
  type ThemePreference, type ThemeSettings,
} from './theme-settings.ts'

export {
  DEFAULT_FONT_SIZE, DEFAULT_PREFERENCE, FONT_SIZE_FIELD, FONT_SIZE_MAX, FONT_SIZE_MIN,
  THEME_PREFERENCE_FIELD, THEME_PREFERENCES, THEME_SETTINGS_NAMESPACE,
  type ThemePreference, type ThemeSettings,
} from './theme-settings.ts'

const THEME_NAMESPACE = settingsNamespace(THEME_SETTINGS_NAMESPACE)

/** Read the registered theme section or the schema defaults without a settings provider. */
function readSection(ctx: Context): { preference: ThemePreference; fontSize: number } {
  const fallback = { preference: DEFAULT_PREFERENCE, fontSize: DEFAULT_FONT_SIZE }
  const settings = ctx.get('settings')
  if (settings === undefined) return fallback
  const section = settings.get(THEME_NAMESPACE) as ThemeSettings | undefined
  if (section === undefined) return fallback
  return section
}

/**
 * Register the durable theme section when the optional settings service is
 * composed, and answer every index injection collection with the current
 * theme bootstrap row.
 * @param ctx - Host context that may acquire the settings service.
 */
export function apply(ctx: Context): void {
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.register(THEME_NAMESPACE, ThemeSettingsSchema)
  })
  ctx.on('webserver/index-inject', (table) => {
    const section = readSection(ctx)
    table.push(bootThemeInjection(section.preference, section.fontSize))
  })
}
