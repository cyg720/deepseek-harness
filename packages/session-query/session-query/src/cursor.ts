/*
 * ================================ 文件注释 ================================
 * 【文件职责】会话搜索分页的不透明游标身份：品牌化字符串类型 + 品牌化构造函数。
 * 【技术维度】Branded 类型；运行时只是字符串，编码/解码归提供者。
 * 【产品维度】分页搜索时把续页令牌以类型安全的方式在契约间传递。
 * 【逻辑维度】类型 + 构造函数两个导出。
 * 【新手阅读建议】无复杂度，理解"不透明 = 只传不拆"即可。
 * ==========================================================================
 */

/** Opaque cursor identity for session-search pagination. */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** Provider-owned opaque continuation token returned by session search. */
// 中文：提供者拥有的不透明续页令牌：编码/解码归提供者，消费方只传不拆。
export type SessionSearchCursor = Branded<'SessionSearchCursor'>

/**
 * Brand an encoded provider cursor for the public search contract.
 * @param value - opaque encoded cursor value.
 * @returns the same runtime string with session-search cursor identity.
 */
export function SessionSearchCursor(value: string): SessionSearchCursor {
  return value as SessionSearchCursor
}
