/**
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

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'section.files': '文件与文件夹',
  'section.sessions': 'Session 对话',
  'candidate.file': '文件',
  'candidate.folder': '文件夹',
  'candidate.session': 'Session',
  'candidate.noCwd': '（无工作目录）',
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
  'section.sessions': 'Session conversations',
  'candidate.file': 'File',
  'candidate.folder': 'Folder',
  'candidate.session': 'Session',
  'candidate.noCwd': '(no cwd)',
} satisfies Record<ReferenceKey, string>
