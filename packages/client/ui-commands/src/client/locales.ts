
/** `command` namespace dictionaries (the popupSelect shell's copy). */

/** Simplified Chinese dictionary (the key-set source of truth). */
// 中文字典：命令面板的键集基准，DeliverablesKey 类型由它推导。

/*
 * 【文件职责】提供命令候选选择弹层使用的本地化文案，中文字典定义该命名空间的键集合。
 */

export const zh = {
  'search.placeholder': '搜索…',
  'search.aria': '筛选选项',
  'status.loading': '正在加载选项…',
  'status.applying': '正在应用…',
  'status.empty': '无选项',
  'overlay.aria': '/{command} 选项',
  'listbox.aria': '/{command} 匹配项',
  'notice.attachmentsUnsupported': '/{command} 不接受附件，请先移除附件',
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
  'notice.attachmentsUnsupported': '/{command} does not accept attachments; remove them first',
} satisfies Record<CommandKey, string>
