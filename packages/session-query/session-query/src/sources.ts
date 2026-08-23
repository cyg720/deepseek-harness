/**
 * ================================ 文件注释 ================================
 * 【文件职责】逻辑会话源观察者的共享"不可变 header 兼容"校验：拒绝把两个
 *   标识同一会话但不可变字段不一致的观察当作同一源。
 * 【技术维度】比较 version/id/createdAt/cwd/parentSession/seedLength/delegationDepth。
 * 【产品维度】防止 live 与持久化双源合并时把不同生命周期混为一谈。
 * 【逻辑维度】单函数 assertSessionHeadersCompatible。
 * 【关键边界】不一致抛 SESSION_QUERY_SOURCE_CONFLICT。
 * 【新手阅读建议】与 session-projection-cache 的 identity 绑定思想对照。
 * ==========================================================================
 */

/** Shared immutable-header checks for logical session source observers. */

import type { SessionHeader } from '@deepseek-ai/dsh-session'
import { SessionQueryError } from './config.ts'

/**
 * Reject incompatible observations of one logical session source.
 * @param a - first live, listed, or loaded header observation.
 * @param b - second header observation expected to identify the same source.
 */
// 中文：拒绝同一逻辑会话源的两份不一致观察：任何不可变字段冲突都抛 SOURCE_CONFLICT。
export function assertSessionHeadersCompatible(a: SessionHeader, b: SessionHeader): void {
  if (
    a.version !== b.version
    || a.id !== b.id
    || a.createdAt !== b.createdAt
    || a.cwd !== b.cwd
    || a.parentSession !== b.parentSession
    || a.seedLength !== b.seedLength
    || (a.delegationDepth ?? 0) !== (b.delegationDepth ?? 0)
  ) {
    throw new SessionQueryError(
      `session source headers conflict for session "${a.id}"`,
      'SESSION_QUERY_SOURCE_CONFLICT',
    )
  }
}
