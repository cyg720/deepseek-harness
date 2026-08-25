/*
 * ================================ 文件注释 ================================
 * 【文件职责】定义持久化"修订号"（SessionPersistenceRevision）这一品牌化类型及其
 *   打品牌工厂函数，为轻量级存储观察提供不透明的变更令牌词汇。
 * 【技术维度】品牌化类型（Branded<T>）：在 string 之上叠加编译期身份，防止把任意
 *   字符串误当修订号使用；运行时零开销（仅类型断言）。
 * 【产品维度】会话列表/变更检测只需比较修订号即可判断"日志变没变"，不必重读整份
 *   日志，让多会话管理界面保持流畅。
 * 【逻辑维度】先声明类型别名，再提供同名工厂函数把后端自有的字符串表示打上品牌。
 * 【关键边界】修订号对消费方完全不透明：只能做相等性比较，不可解析、排序或跨后端
 *   比较；具体编码格式由各后端自行决定。
 * 【新手阅读建议】两分钟即可读完；重点理解"品牌化 = 编译期防呆"这一惯用法，
 * 以及谁生产（后端）、谁消费（列表与缓存判断）。
 * ==========================================================================
 */
/** Opaque revision identity for lightweight persistence observations. */
/*
 * 【中文导读】上面英文说明：本模块给出"轻量持久化观察"用的不透明修订号身份。
 */

import type { Branded } from '@deepseek-ai/dsh-brand'

/**
 * Backend-owned token that identifies both one storage source and one revision
 * of a persisted session log.
 */
/*
 * 【中文】由后端拥有的令牌：同时标识"哪个存储源"和"该会话日志的哪一次修订"。
 * 内容不变则令牌不变；任何变化都会产生新令牌。
 */
export type SessionPersistenceRevision = Branded<'SessionPersistenceRevision'>

/**
 * Brand a backend revision for the provider-neutral persistence contract.
 * @param value - backend-owned opaque revision representation.
 * @returns the same runtime string with persistence-revision identity.
 */
/*
 * 【中文】把后端自有的修订字符串打上品牌，供中立契约使用。运行时就是同一个
 * 字符串，仅在类型系统里获得身份。
 * @param value - 后端自有的不透明修订表示。
 * @returns 同一运行时值，但带有持久化修订类型身份。
 */
export function SessionPersistenceRevision(value: string): SessionPersistenceRevision {
  return value as SessionPersistenceRevision
}
