/**
 * ================================ 文件注释 ================================
 * 【文件职责】`deliverables` 命名空间的双语文案字典（"产物"行与提及文案）。
 * 【技术维度】以 zh 字典为键集基准，en 受 Record<DeliverablesKey, string> 约束。
 * 【产品维度】对话中"本次回合产生的文件"（产物）行的可见文字，以及打开文件的按钮文案。
 * 【逻辑维度】NS 常量、zh 字典、en 字典、DeliverablesKey 类型推导。
 * 【关键边界】zh 是键的单一事实来源；增删文案必须同步 en。
 * 【新手阅读建议】纯数据文件。
 * ==========================================================================
 */
/** `deliverables` namespace dictionaries. */

/** Dictionary namespace owned by this plugin. */
// 本插件拥有的字典命名空间名。
export const NS = 'deliverables'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'produced.label': '产物',
  'produced.moreOne': '+ 1 个文件',
  'produced.more': '+ {count} 个文件',
  'produced.open': '打开 {name}',
  'produced.showInFolder': '在文件夹中显示',
}

/** English dictionary (same key set). */
export const en: Record<DeliverablesKey, string> = {
  'produced.label': 'Produced',
  'produced.moreOne': '+ 1 file',
  'produced.more': '+ {count} files',
  'produced.open': 'Open {name}',
  'produced.showInFolder': 'Show in folder',
}

/** Union of this namespace's dictionary keys. */
export type DeliverablesKey = keyof typeof zh
