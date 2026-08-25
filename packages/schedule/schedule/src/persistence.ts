/** Schedule-owned use of the shared session durability barrier. */
/*
 * 文件职责：为定时任务提供会话持久化屏障，并把底层失败包装成领域错误。
 * 技术维度：使用 Cordis 会话服务、异步 flush 和带 cause 的自定义 Error。
 * 产品维度：确保定时任务状态在继续执行前至少被一个持久化监听器确认写入。
 * 逻辑维度：调用共享 flush；无人确认或调用抛错时统一转换为 SchedulePersistenceError。
 * 关键边界：成功要求 flush 返回 true；已包装错误不得再次嵌套包装。
 * 新手阅读建议：先看错误类如何保留 cause，再按 try、布尔结果和 catch 三条路径阅读 flush 函数。
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'

/** Failure to prove that the current live prefix reached a persistence listener. */
/* 无法证明当前会话前缀已到达持久化监听器时抛出的定时任务领域错误。 */
export class SchedulePersistenceError extends Error {
  /**
   * Construct a contained persistence failure.
   * @param cause - Rejection returned by the shared barrier, when present.
   */
  /* 构造持久化失败。@param cause 共享屏障返回的可选原始错误。@example new SchedulePersistenceError(error)。 */
  constructor(cause?: unknown) {
    super('Schedule persistence did not complete.', cause === undefined ? undefined : { cause })
    this.name = 'SchedulePersistenceError'
  }
}

/**
 * Require one successful shared persistence checkpoint.
 * @param ctx - Context carrying the live session store.
 * @param session - Exact live session to checkpoint.
 * @returns After at least one listener explicitly acknowledges completed durability work.
 */
/*
 * 等待一次成功的共享持久化检查点。
 * @param ctx 提供实时会话存储的 Cordis 上下文。
 * @param session 必须持久化的当前会话实例。
 * @returns 至少一个监听器明确确认写入后完成的 Promise。
 * @example await flushSchedulePersistence(ctx, session)。
 */
export async function flushSchedulePersistence(ctx: Context, session: Session): Promise<void> {
  try {
    if (!await ctx.sessions.flush(session)) throw new SchedulePersistenceError()
  } catch (error: unknown) {
    // 底层 flush 抛出的未知错误；领域错误原样重抛，其余错误作为 cause 包装。
    if (error instanceof SchedulePersistenceError) throw error
    throw new SchedulePersistenceError(error)
  }
}
