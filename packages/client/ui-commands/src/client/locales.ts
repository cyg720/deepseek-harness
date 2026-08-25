/*
 * ================================ 文件注释 ================================
 * 【文件职责】`command` 命名空间的双语文案字典（弹出选择面板的文案）。
 * 【技术维度】以 zh 字典为键集基准，en 字典用类型约束保证键完整；命令面板的 UI 文案。
 * 【产品维度】命令弹出面板的搜索占位、加载/应用/空状态提示与无障碍标签等。
 * 【逻辑维度】zh 定义全部键，CommandKey 由其推导，en 受 Record<CommandKey, string> 约束。
 * 【关键边界】zh 是键的单一事实来源；增删文案必须同步两边。
 * 【新手阅读建议】无特殊阅读顺序，纯数据文件。
 * ==========================================================================
 */
/** `command` namespace dictionaries (the popupSelect shell's copy). */

/** Simplified Chinese dictionary (the key-set source of truth). */
// 中文字典：命令面板的键集基准，DeliverablesKey 类型由它推导。
export const zh = {
  'search.placeholder': '搜索…',
  'search.aria': '筛选选项',
  'status.loading': '正在加载选项…',
  'status.applying': '正在应用…',
  'status.empty': '无选项',
  'overlay.aria': '/{command} 选项',
  'listbox.aria': '/{command} 匹配项',
  'notice.imagesUnsupported': '/{command} 不接受图片附件，请先移除图片',
} satisfies Record<string, string>

/** The command namespace key union. */
// 命令命名空间的键联合类型：由 zh 字典键推导。
export type CommandKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
// 英文字典：受类型约束必须与 zh 键集一致。
export const en = {
  'search.placeholder': 'Search…',
  'search.aria': 'Filter options',
  'status.loading': 'Loading options…',
  'status.applying': 'Applying…',
  'status.empty': 'No options',
  'overlay.aria': '/{command} options',
  'listbox.aria': '/{command} matches',
  'notice.imagesUnsupported': '/{command} does not accept image attachments; remove them first',
} satisfies Record<CommandKey, string>
