/**
 * ================================ 文件注释 ================================
 * 【文件职责】`settings.theme` 命名空间的双语文案字典（外观行文案）。
 * 【技术维度】zh 为键集基准，en 受 Record<ThemeKey, string> 约束。
 * 【产品维度】设置页"外观"行的标题与三个偏好选项。
 * 【逻辑维度】zh 定义键，ThemeKey 推导，en 补齐。
 * 【关键边界】zh 是键的单一事实来源。
 * 【新手阅读建议】纯数据文件。
 * ==========================================================================
 */
/** `settings.theme` namespace dictionaries (the Appearance row's copy). */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'appearance.title': '外观',
  'appearance.light': '浅色',
  'appearance.dark': '深色',
  'appearance.system': '跟随系统',
} satisfies Record<string, string>

/** The settings.theme namespace key union. */
export type ThemeKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'appearance.title': 'Appearance',
  'appearance.light': 'Light',
  'appearance.dark': 'Dark',
  'appearance.system': 'System',
} satisfies Record<ThemeKey, string>
