/**
 * ================================ 文件注释 ================================
 * 【文件职责】`slash.menu` 命名空间的双语文案字典：按源名键控的分组标题、
 *             加载行与列表无障碍标签。
 * 【技术维度】zh 为键集基准；查找链找不到时直接回退返回键本身（未知源显示原始名）。
 * 【产品维度】'/' 与 '@' 菜单的分组标题（命令/技能/子智能体）与加载提示。
 * 【逻辑维度】zh 定义键，MenuKey 推导，en 补齐。
 * 【关键边界】zh 是键的单一事实来源。
 * 【新手阅读建议】纯数据文件。
 * ==========================================================================
 */
/**
 * `slash.menu` namespace dictionaries: group titles keyed by source name
 * (the lookup chain returns the key itself, so an unknown source shows its
 * raw name), the pending row, and the listbox aria label.
 */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'command': '命令',
  'skill': '技能',
  'subagent': '子智能体',
  'loading': '正在加载…',
  'suggestions.aria': '触发候选建议',
} satisfies Record<string, string>

/** The slash.menu namespace key union. */
export type MenuKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'command': 'Commands',
  'skill': 'Skills',
  'subagent': 'Subagents',
  'loading': 'Loading…',
  'suggestions.aria': 'Trigger suggestions',
} satisfies Record<MenuKey, string>
