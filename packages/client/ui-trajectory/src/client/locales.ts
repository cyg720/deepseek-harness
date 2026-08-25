/*
 * ================================ 文件注释 ================================
 * 【文件职责】轨迹插件的字典命名空间（NS = 'trajectory'）：中英文双语 UI 文案与 key 类型。
 * 【技术维度】locale 插件字典契约：TrajectoryKey 联合类型作为键集合的事实来源，并通过
 *             模块扩充把 'trajectory' 键注册进 LocaleNamespaceMap。
 * 【产品维度】轨迹页签标签与工具栏（时长 / 回合 / 调用 / 搜索）文案随界面语言切换。
 * 【逻辑维度】1) NS 常量；2) key 联合类型；3) 模块扩充声明；4) zh / en 两份字典。
 * 【关键边界】zh 是键集合的事实来源；en 必须覆盖同样的键；部分文案（Duration、Turns、
 *             Calls 等）是产品既定的英文文案，刻意保留。
 * 【新手阅读建议】新增文案时需同时改 TrajectoryKey 与两份字典。
 * ==========================================================================
 */
/** `trajectory` namespace dictionaries (view tab label + toolbar strings). */

/** Dictionary namespace owned by this plugin. */
// 本插件拥有的字典命名空间名。
export const NS = 'trajectory'

/** The trajectory dictionary key set (the source of truth for both locales). */
// 轨迹字典的键集合（两份语言字典的事实来源）。
export type TrajectoryKey =
  | 'view.trajectory'
  | 'toolbar.aria'
  | 'toolbar.duration'
  | 'toolbar.useActualDuration'
  | 'toolbar.useEqualWidth'
  | 'toolbar.actualTime'
  | 'toolbar.turns'
  | 'toolbar.expandTurns'
  | 'toolbar.collapseTurns'
  | 'toolbar.calls'
  | 'toolbar.expandCalls'
  | 'toolbar.collapseCalls'
  | 'toolbar.search'
  | 'toolbar.searchPlaceholder'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The trajectory view tab label and toolbar strings. */
    'trajectory': TrajectoryKey
  }
}

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh: Record<TrajectoryKey, string> = {
  'view.trajectory': '轨迹',
  'toolbar.aria': '轨迹工具栏',
  'toolbar.duration': 'Duration',
  'toolbar.useActualDuration': 'Use actual duration',
  'toolbar.useEqualWidth': 'Use equal-width operations',
  'toolbar.actualTime': '实际时间',
  'toolbar.turns': 'Turns',
  'toolbar.expandTurns': 'Expand turns',
  'toolbar.collapseTurns': 'Collapse turns',
  'toolbar.calls': 'Calls',
  'toolbar.expandCalls': 'Expand calls',
  'toolbar.collapseCalls': 'Collapse calls',
  'toolbar.search': '搜索轨迹',
  'toolbar.searchPlaceholder': '搜索',
}

/** English dictionary. */
export const en: Record<TrajectoryKey, string> = {
  'view.trajectory': 'Trajectory',
  'toolbar.aria': 'Trajectory toolbar',
  'toolbar.duration': 'Duration',
  'toolbar.useActualDuration': 'Use actual duration',
  'toolbar.useEqualWidth': 'Use equal-width operations',
  'toolbar.actualTime': 'Actual time',
  'toolbar.turns': 'Turns',
  'toolbar.expandTurns': 'Expand turns',
  'toolbar.collapseTurns': 'Collapse turns',
  'toolbar.calls': 'Calls',
  'toolbar.expandCalls': 'Expand calls',
  'toolbar.collapseCalls': 'Collapse calls',
  'toolbar.search': 'Search trajectory',
  'toolbar.searchPlaceholder': 'Search',
}
