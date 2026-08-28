/**
 * ================================ 文件注释 ================================
 * 【文件职责】common 命名空间的英文基础字典，对照 zh 键集检查完整性。
 * 【技术维度】纯常量字典：satisfies Record<CommonKey, string> 钉住键集。
 * 【产品维度】英文 UI 文案；键集与 zh 完全一致保证双语平衡。
 * 【逻辑维度】单字典常量。
 * 【关键边界】键权威在 zh.ts；此处缺失或多余键是编译错误。
 * 【新手阅读建议】对照 zh.ts 的 CommonKey 理解。
 * ==========================================================================
 */
import type { CommonKey } from './zh.ts'

/** en base dictionary for the common namespace, checked complete against the zh key set. */
/* common 命名空间的英文基础字典，对照 zh 键集检查完整性。 */
export const en = {
  'ok': 'OK',
  'cancel': 'Cancel',
  'close': 'Close',
  'copy': 'Copy',
  'copied': 'Copied',
  'copy.failed': 'Copy failed',
  'copy.value': 'Copy value',
  'copy.json': 'Copy JSON',
  'copy.path': 'Copy property path',
  'copy.prettyJson': 'Copy pretty JSON',
  'copy.compactJson': 'Copy compact JSON',
  'copy.optionsHint': '{action}; right-click for copy options',
  'retry': 'Retry',
  'loading': 'Loading…',
  'load.failed': 'Failed to load',
  'submit': 'Submit',
  'submitting': 'Submitting…',
  'next': 'Next',
  'previous': 'Previous',
  'skip': 'Skip',
  'delete': 'Delete',
  'edit': 'Edit',
  'save': 'Save',
  'search': 'Search',
  'more': 'More',
  'collapse': 'Collapse',
  'expand': 'Expand',
  'back': 'Back',
  'brand.localBuild': 'DSH Local Build',
  'unknown': 'Unknown',
  'none': 'None',
  'truncated': 'Truncated',
  'connection.reconnecting': 'Connection lost; reconnecting…',
  'json.collapseNode': 'Collapse JSON node',
  'json.expandNode': 'Expand JSON node',
  'json.label': 'JSON',
  'markdown.footnotes': 'Footnotes',
  'markdown.truncatedCharacters': '… truncated at {total} characters',
  'number.thousand': '{value}K',
  'number.million': '{value}M',
} satisfies Record<CommonKey, string>
