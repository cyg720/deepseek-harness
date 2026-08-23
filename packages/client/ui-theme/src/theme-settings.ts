/**
 * ================================ 文件注释 ================================
 * 【文件职责】主题偏好（light/dark/system）的设置契约：命名空间、字段、可持久化
 *             类型与宿主模式/浏览器作用域共用的耐久模式段。
 * 【技术维度】schemastery 模式：同一模式既作宿主注册，也作浏览器作用域校验的
 *             线缆信封；偏好集合以 as const 固定。
 * 【产品维度】设置页"外观"行的持久化载体：跟随系统/浅色/深色。
 * 【逻辑维度】常量（偏好列表/命名空间/字段/默认值）→ ThemeSettings 接口与模式
 *             → isThemePreference 类型守卫。
 * 【关键边界】DEFAULT_PREFERENCE 为 'system'；未知值在设置/注册边界被拒绝。
 * 【新手阅读建议】与 settings-store.ts 和 client/index.ts 的读写对照阅读。
 * ==========================================================================
 */
/** Theme preferences stored in the Host user-settings document. */

import z from '@deepseek-ai/schemastery'

/** Built-in preferences accepted at the registry and settings boundaries. */
export const THEME_PREFERENCES = ['light', 'dark', 'system'] as const

/** Settings namespace owned by the theme plugin. */
export const THEME_SETTINGS_NAMESPACE = 'ui-theme'

/** Field carrying the selected built-in theme preference. */
export const THEME_PREFERENCE_FIELD = 'preference'

/** Theme preference persisted by the product Appearance row. */
export type ThemePreference = typeof THEME_PREFERENCES[number]

/** Default preference when the user-settings document has no override. */
export const DEFAULT_PREFERENCE: ThemePreference = 'system'

/** Durable theme section shared by the Host schema and the browser scope. */
export interface ThemeSettings {
  /** Selected built-in preference. */
  preference: ThemePreference
}

/** Durable theme schema; also the wire envelope the browser scope validates against. */
export const ThemeSettingsSchema: z<ThemeSettings> = z.object({
  [THEME_PREFERENCE_FIELD]: z.union([...THEME_PREFERENCES]).default(DEFAULT_PREFERENCE),
})

/**
 * Narrow one wire or registry value to a persistable preference.
 * @param value - value crossing the settings or registry boundary.
 * @returns whether the value is a built-in preference.
 */
export function isThemePreference(value: unknown): value is ThemePreference {
  return THEME_PREFERENCES.some(preference => preference === value)
}
