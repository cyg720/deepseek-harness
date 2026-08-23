/**
 * ================================ 文件注释 ================================
 * 【文件职责】会话查询服务的公共配置与定型失败：两个默认常量、可继承 Config、
 *   封闭错误码族与 SessionQueryError。
 * 【技术维度】继承 HarnessError 并在类型上把 code 收窄为封闭联合成员。
 * 【产品维度】让所有查询失败都有稳定的机器可路由错误码。
 * 【逻辑维度】按代码顺序：两个默认常量 → Config → 错误码联合 → SessionQueryError。
 * 【关键边界】错误码是封闭枚举（非可合并扩展）。
 * 【新手阅读建议】记住默认窗口 50 与默认并发 4，其余看错误码清单。
 * ==========================================================================
 */

/** Public configuration and typed failures for the combined session-query service. */

import { HarnessError } from '@deepseek-ai/dsh-llm'

/** Default maximum `before`/`after` raw-event window. */
// 中文：默认的最大 before/after 原始事件窗口（读事件上下文时两侧各最多 50 条）。
export const SESSION_QUERY_READ_WINDOW_MAX = 50

/** Default maximum number of concurrent persisted-log inspections in one batch read. */
export const SESSION_QUERY_DEFAULT_PERSISTED_INSPECT_CONCURRENCY = 4

/** Backend-independent configuration inherited by every session-query implementation. */
export interface Config {
  /** Maximum accepted raw read context on either side. Defaults to 50. */
  readWindowMax?: number
  /** Maximum concurrent persisted-log inspections in one batch read. Defaults to 4. */
  persistedInspectConcurrency?: number
}

/** Stable machine-routable failure taxonomy for session reads, traces, and search. */
export type SessionQueryErrorCode =
  | 'SESSION_QUERY_ABORTED'
  | 'SESSION_QUERY_CORRUPT_SESSION'
  | 'SESSION_QUERY_EVENT_NOT_FOUND'
  | 'SESSION_QUERY_INDEX_FAILED'
  | 'SESSION_QUERY_INVALID_CONFIG'
  | 'SESSION_QUERY_INVALID_CURSOR'
  | 'SESSION_QUERY_INVALID_FILTER'
  | 'SESSION_QUERY_INVALID_LIMIT'
  | 'SESSION_QUERY_INVALID_QUERY'
  | 'SESSION_QUERY_INVALID_LINEAGE'
  | 'SESSION_QUERY_INVALID_SURFACE'
  | 'SESSION_QUERY_INVALID_WINDOW'
  | 'SESSION_QUERY_PERSISTENCE_FAILED'
  | 'SESSION_QUERY_SEARCH_DISABLED'
  | 'SESSION_QUERY_SESSION_NOT_FOUND'
  | 'SESSION_QUERY_STALE_CURSOR'
  | 'SESSION_QUERY_SOURCE_CONFLICT'

/** Typed session-query failure whose `code` is one closed taxonomy member. */
export class SessionQueryError extends HarnessError {
  declare readonly code: SessionQueryErrorCode

  // The base stores the value; this signature narrows its open string code.
  // oxlint-disable-next-line typescript/no-useless-constructor
  constructor(message: string, code: SessionQueryErrorCode, options?: ErrorOptions) {
    super(message, code, options)
  }
}
