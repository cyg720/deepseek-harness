/**
 * ================================ 文件注释 ================================
 * 【文件职责】设置外壳铬与通用导航的双语文案字典（功能行各自拥有自己的文案）。
 * 【技术维度】zh 为键集基准，en 受 Record<SettingsKey, string> 约束。
 * 【产品维度】设置触发行、面板标题、关闭标签、打开配置文件与通用分区导航。
 * 【逻辑维度】zh 定义键，SettingsKey 推导，en 补齐。
 * 【关键边界】zh 是键的单一事实来源。
 * 【新手阅读建议】纯数据文件。
 * ==========================================================================
 */
/** Shell chrome and General-nav dictionaries; feature rows own their copy. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'trigger': '设置',
  'title': '设置',
  'close': '关闭',
  'openDocument': '打开配置文件',
  'openDocument.error': '无法打开配置文件',
  'general.nav': '通用设置',
} satisfies Record<string, string>

/** The settings namespace key union. */
export type SettingsKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'trigger': 'Settings',
  'title': 'Settings',
  'close': 'Close',
  'openDocument': 'Open configuration file',
  'openDocument.error': 'Could not open configuration file',
  'general.nav': 'General',
} satisfies Record<SettingsKey, string>
