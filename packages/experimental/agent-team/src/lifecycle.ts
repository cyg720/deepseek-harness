/**
 * ================================ 文件注释 ================================
 * 【文件职责】团队运行时的共享准入截止与有界结算：单一 AbortController 作为
 *   "服务开始拆卸"的唯一事实，settle 等待已准入操作并保留非取消的失败。
 * 【技术维度】isCancellation 沿 cause 链识别运行时期取消（TEAM_DISPOSED）；
 *   withTimeout 用 Promise.race 给结算操作套期限，防 HMR/进程退出被卡死。
 * 【产品维度】保证团队运行时拆卸"有界、不吞失败"。
 * 【逻辑维度】signal/disposed/reason → isCancellation → close → settle → withTimeout。
 * 【新手阅读建议】先看 close 的取消原因，再看 settle 如何过滤预期取消。
 * ==========================================================================
 */

/** Shared admission cutoff and bounded settlement for the Team runtime. */

import { TeamError } from './error.ts'

/** Owns the single Team runtime cancellation fact and disposal timeout. */
export class TeamRuntimeLifecycle {
  private readonly controller = new AbortController()

  /**
   * @param disposalTimeoutMs - maximum wait for one disposal settlement operation.
   */
  constructor(private readonly disposalTimeoutMs: number) {}

  /** Signal aborted exactly when Team runtime admission closes. */
  get signal(): AbortSignal {
    return this.controller.signal
  }

  /** Whether Team runtime admission is closed. */
  get disposed(): boolean {
    return this.signal.aborted
  }

  /** The exact cancellation reason used to distinguish expected disposal rejection. */
  get reason(): unknown {
    const reason: unknown = this.signal.reason
    return reason
  }

  /** Whether a rejection is the runtime cancellation, directly or through an Error cause chain. */
  private isCancellation(reason: unknown): boolean {
    const seen = new Set<unknown>()
    let current = reason
    while (!seen.has(current)) {
      if (this.disposed && current === this.reason) return true
      if (this.disposed && current instanceof TeamError && current.code === 'TEAM_DISPOSED') return true
      if (!(current instanceof Error)) return false
      seen.add(current)
      current = current.cause
    }
    return false
  }

  /** Close Team runtime admission and cancel admitted interruptible work. */
  close(): void {
    this.controller.abort(new TeamError('Agent Teams service disposed', 'TEAM_DISPOSED'))
  }

  /**
   * Await admitted operations and retain failures other than runtime cancellation.
   * @param operations - admitted operations captured after the admission cutoff.
   * @param failures - aggregate destination for unexpected rejection or timeout.
   */
  async settle(operations: readonly Promise<unknown>[], failures: unknown[]): Promise<void> {
    if (operations.length === 0) return
    try {
      const outcomes = await this.withTimeout(Promise.allSettled(operations))
      for (const outcome of outcomes) {
        if (outcome.status === 'rejected' && !this.isCancellation(outcome.reason)) failures.push(outcome.reason)
      }
    } catch (error: unknown) {
      failures.push(error)
    }
  }

  /**
   * Bound one runtime settlement operation.
   * @param operation - settlement that may otherwise block HMR or process shutdown.
   * @returns the operation result.
   */
  async withTimeout<T>(operation: Promise<T>): Promise<T> {
    let timer!: ReturnType<typeof setTimeout>
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        reject(new TeamError(
          `Agent Teams runtime disposal exceeded ${this.disposalTimeoutMs}ms`,
          'TEAM_DISPOSAL_TIMEOUT',
        ))
      }, this.disposalTimeoutMs)
    })
    try {
      return await Promise.race([operation, timeout])
    } finally {
      clearTimeout(timer)
    }
  }
}
