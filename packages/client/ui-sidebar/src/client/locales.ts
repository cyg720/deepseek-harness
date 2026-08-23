/**
 * ================================ 文件注释 ================================
 * 【文件职责】`sidebar` 命名空间的双语文案字典（外壳控件：品牌行、新会话、折叠开关）。
 * 【技术维度】zh 为键集基准，en 受 Record<SidebarKey, string> 约束。
 * 【产品维度】侧边栏外壳控件的可见文字与无障碍标签。
 * 【逻辑维度】zh 定义键，SidebarKey 推导，en 补齐。
 * 【关键边界】zh 是键的单一事实来源。
 * 【新手阅读建议】纯数据文件。
 * ==========================================================================
 */
/** `sidebar` namespace dictionaries: shell controls (brand row, New Session, fold toggle). */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'session.new': '新会话',
  'session.new.label': '新建会话',
  'toggle.open': '打开侧边栏',
  'toggle.collapse': '收起侧边栏',
} satisfies Record<string, string>

/** The sidebar namespace key union. */
export type SidebarKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'session.new': 'New Session',
  'session.new.label': 'New session',
  'toggle.open': 'Open sidebar',
  'toggle.collapse': 'Collapse sidebar',
} satisfies Record<SidebarKey, string>
