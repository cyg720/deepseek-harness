/*
 * ================================ 文件注释 ================================
 * 【文件职责】Agent Teams 的定型失败类型与通用的抛错值渲染。
 * 【技术维度】TeamError 继承 HarnessError；errorMessage 对非 Error 抛值用 node:util
 *   的 inspect 做有界单行渲染。
 * 【产品维度】团队操作失败以稳定错误码（TEAM_*）呈现给工具层。
 * 【逻辑维度】TeamError → errorMessage。
 * 【新手阅读建议】全文件很短；错误码是字符串便于扩展。
 * ==========================================================================
 */

/** Typed Agent Teams failures. */

import { inspect } from 'node:util'
import { HarnessError } from '@deepseek-ai/dsh-llm'

/** Stable failure raised by the Team domain. */
export class TeamError extends HarnessError {
  constructor(message: string, code: string, options?: ErrorOptions) {
    super(message, code, options)
    this.name = 'TeamError'
  }
}

/**
 * Render an arbitrary thrown value without replacing the original rejection.
 * @param error - caught value used in a diagnostic or durable failure record.
 * @returns one bounded single-line description.
 */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return inspect(error, { breakLength: Infinity, compact: true, depth: 4 })
}
