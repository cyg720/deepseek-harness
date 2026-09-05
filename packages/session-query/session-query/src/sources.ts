

/** Shared immutable-header checks for logical session source observers. */

/*
 * 【文件职责】检查同一逻辑会话来源的不可变头部是否一致，防止不同观察被误合并。
 */

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
    a.id !== b.id
    || a.createdAt !== b.createdAt
    || a.cwd !== b.cwd
    || a.parentSession !== b.parentSession
    || a.isSeeded !== b.isSeeded
    || (a.delegationDepth ?? 0) !== (b.delegationDepth ?? 0)
  ) {
    throw new SessionQueryError(
      `session source headers conflict for session "${a.id}"`,
      'SESSION_QUERY_SOURCE_CONFLICT',
    )
  }
}
