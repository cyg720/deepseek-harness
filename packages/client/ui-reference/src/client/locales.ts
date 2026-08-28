/*
 * ================================ 文件注释 ================================
 * 【文件职责】`reference` 命名空间的双语文案字典（统一 '@' 引用源的菜单文案）。
 * 【技术维度】zh 为键集基准，en 受 Record<ReferenceKey, string> 约束，
 *             同时做 LocaleNamespaceMap 的声明合并。
 * 【产品维度】'@' 引用菜单的分组标题（文件与文件夹 / Session 对话）与候选类型标签。
 * 【逻辑维度】NS 常量、zh 键集、ReferenceKey 推导、en 补齐。
 * 【关键边界】zh 是键的单一事实来源。
 * 【新手阅读建议】纯数据文件。
 * ==========================================================================
 */
/** `reference` namespace dictionaries for the unified `@` source. */

import type {} from '@deepseek-ai/dsh-client-ui-slots'

/** Dictionary namespace owned by this plugin. */
export const NS = 'reference'

/**
 * Simplified Chinese dictionary (the key-set source of truth).
 *
 * The `time.*` bucket words are this namespace's own copy of the session-row
 * vocabulary: locale-owned copy keeps the words per plugin, while the
 * bucketing they name is the one shared {@link relativeTime} in ui-primitives.
 */
export const zh = {
  'section.files': '文件与文件夹',
  'section.sessions': '对话',
  'candidate.noCwd': '（无工作目录）',
  'crumb.root': '工作区',
  'time.now': '刚刚',
  'time.minutes': '{n}分钟',
  'time.hours': '{n}小时',
  'time.days': '{n}天',
  'time.months': '{n}个月',
  'time.years': '{n}年',
} satisfies Record<string, string>

/** The reference namespace key union. */
export type ReferenceKey = keyof typeof zh

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The unified `@` reference menu's copy. */
    reference: ReferenceKey
  }
}

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'section.files': 'Files & folders',
  'section.sessions': 'Sessions',
  'candidate.noCwd': '(no cwd)',
  'crumb.root': 'Workspace',
  'time.now': 'now',
  'time.minutes': '{n}min',
  'time.hours': '{n}h',
  'time.days': '{n}d',
  'time.months': '{n}mo',
  'time.years': '{n}y',
} satisfies Record<ReferenceKey, string>
