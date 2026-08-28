/*
 * ================================ 文件注释 ================================
 * 【文件职责】`skill` 命名空间的双语文案字典（技能工具行与菜单标记）。
 * 【技术维度】zh 为键集基准，en 受 Record<SkillKey, string> 约束。
 * 【产品维度】技能工具行的加载/失败/中止状态与"仅用户"菜单标记。
 * 【逻辑维度】NS 常量、zh 键集、SkillKey 推导、en 补齐。
 * 【关键边界】zh 是键的单一事实来源。
 * 【新手阅读建议】纯数据文件。
 * ==========================================================================
 */
/** `skill` namespace dictionaries for the dedicated tool row. */

/** Dictionary namespace owned by this plugin. */
export const NS = 'skill'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'row.title': 'Skill',
  'row.running': '正在加载 skill',
  'row.failed': 'skill 加载失败',
  'row.stopped': 'skill 加载已中止',
  'row.instructions': '说明',
  'row.inspect': '查看',
  'menu.userOnly': '仅用户',
} satisfies Record<string, string>

/** The skill namespace key union. */
export type SkillKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'row.title': 'Skill',
  'row.running': 'Loading skill',
  'row.failed': 'Skill load failed',
  'row.stopped': 'Skill load stopped',
  'row.instructions': 'Instructions',
  'row.inspect': 'Inspect',
  'menu.userOnly': 'user-only',
} satisfies Record<SkillKey, string>
