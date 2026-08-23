/**
 * ================================ 文件注释 ================================
 * 【文件职责】lsp-stdio 共享的取消（abort）辅助：把 AbortSignal 的中止原因转成保留超时分类的错误（abortError）、快速抛出已触发的中止（throwIfAborted）、以及让一次等待可被信号放弃（abortable）。
 * 【技术维度】基于 @deepseek-ai/dsh-timeout 的 timeoutOf 保留超时分类；abortable 用 Promise.race 把"工作 Promise"与"取消 Promise"赛跑，finally 中移除监听避免泄漏。
 * 【产品维度】LSP 查询可能被模型侧超时或插件卸载中断：这些辅助让查询在等待主机 I/O、队列、握手或协议响应时都能及时放弃，而不是无限阻塞。
 * 【逻辑维度】abortError（分类中止原因）→ throwIfAborted（已触发则抛）→ abortable（带取消的等待）。
 * 【关键边界】abortable 只放弃"等待"本身，底层工作继续运行到其所有者定义的静默边界；中止原因优先保留超时错误，便于上层区分"超时"与"取消"。
 * 【新手阅读建议】从 abortable 入手理解 Promise.race 取消模式，再结合 instance.ts 看它如何被用于队列与握手阶段。
 * ==========================================================================
 */
/**
 * Shared cancellation helpers for the local LSP provider's host-I/O, queue, and protocol phases.
 * @module @deepseek-ai/dsh-lsp-stdio/abort
 */

import { timeoutOf } from '@deepseek-ai/dsh-timeout'

/**
 * Build an abort Error carrying the signal's reason and preserving timeout classification.
 * @param signal - the aborted signal whose reason to surface.
 * @returns the timeout reason if present, else the Error reason, else a generic aborted Error.
 */
// 构造中止错误：优先返回信号携带的超时原因（保留"超时"分类），否则返回 Error 原因，最后退回通用"已中止"错误。
export function abortError(signal: AbortSignal): Error {
  // 信号若来自超时控制器，其原因是超时错误，需原样返回以便上层区分"超时"与"取消"。
  const timeout = timeoutOf(signal)
  if (timeout !== undefined) return timeout
  const reason: unknown = signal.reason
  if (reason instanceof Error) return reason
  return new Error('LSP query aborted')
}

/**
 * Throw the signal's classified abort error when it has already fired.
 * @param signal - the optional query cancellation signal.
 */
// 信号已触发时立即抛出分类后的中止错误；常用于异步操作开始前做快速检查。
export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError(signal)
}

/**
 * Await work while allowing a query signal to abandon its wait; the underlying work keeps its own
 * handlers and continues to its owner-defined quiescence boundary.
 * @param work - the owned asynchronous work.
 * @param signal - optional query cancellation.
 * @returns the work result, or a rejection carrying the classified abort reason.
 */
// 让一次等待可被取消：等待 work 完成，但 signal 触发时立即以分类中止错误拒绝；底层工作本身不被打断，继续运行到其所有者定义的静默边界。
export function abortable<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
  // 无信号则原样返回，不做任何包装。
  if (signal === undefined) return work
  // 信号已触发：直接拒绝，无需等待。
  if (signal.aborted) return Promise.reject(abortError(signal))
  // 手工构造一个"取消 Promise"：abort 事件触发时以分类中止错误拒绝它。
  const canceled = Promise.withResolvers<never>()
  const onAbort = (): void => { canceled.reject(abortError(signal)) }
  signal.addEventListener('abort', onAbort, { once: true })
  // 把工作结果归一化为 Error，避免非 Error 抛出值破坏上层类型。
  const normalized = work.catch((error: unknown) => {
    /* v8 ignore next -- owned LSP promises reject with Error; coercion defends the generic helper. */
    throw error instanceof Error ? error : new Error(String(error))
  })
  // 与"取消 Promise"赛跑：谁先完成谁决定结果；无论胜负都移除监听，防止泄漏。
  return Promise.race([normalized, canceled.promise])
    .finally(() => { signal.removeEventListener('abort', onAbort) })
}
