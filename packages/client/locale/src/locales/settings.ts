/*
 * ================================ 文件注释 ================================
 * 【文件职责】settings.locale 命名空间字典（语言行的文案）。
 * 【技术维度】纯常量字典：zh 是键集事实源；en 用 satisfies 对照 zh 键集
 *   检查完整性。
 * 【产品维度】设置页语言行的标题文案随激活语言切换。
 * 【逻辑维度】zh/en 字典 + SettingsLocaleKey 键联合类型。
 * 【关键边界】zh 是键权威；en 缺失或多余键会编译失败。
 * 【新手阅读建议】无前置依赖；理解 satisfies 钉住键集即可。
 * ==========================================================================
 */
/** `settings.locale` namespace dictionaries (the Language row's copy). */
/* settings.locale 命名空间字典（语言行的文案）。 */

/** Simplified Chinese dictionary (the key-set source of truth). */
/* 简体中文词典（键集事实源）。 */
export const zh = {
  'language.title': '语言',
} satisfies Record<string, string>

/** The settings.locale namespace key union. */
/* settings.locale 命名空间的键联合类型。 */
export type SettingsLocaleKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
/* 英文词典，对照 zh 键集检查完整性。 */
export const en = {
  'language.title': 'Language',
} satisfies Record<SettingsLocaleKey, string>
