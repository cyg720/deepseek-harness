/** Bounded, escalating process shutdown for the long-lived CLI surfaces. */
/*
 * 文件职责：为长期运行的 CLI 应用提供有时限、可升级的统一进程关闭控制器。
 * 技术维度：使用 Promise 合流、超时计时器和幂等状态标记协调异步资源释放。
 * 产品维度：首次退出请求尽量安全保存并清理资源，重复信号或超时则避免进程无限挂起。
 * 逻辑维度：首次请求启动 dispose 与计时器，正常完成记录退出码，异常、超时或重复中断强退。
 * 关键边界：forceExit 和 complete 最多各生效一次；第二次中断会立即升级为强制退出。
 * 新手阅读建议：先看 shutdown 与 interrupt 的语义差异，再沿 start 的成功和失败分支阅读。
 */

/** Maximum grace allowed for the application tree to dispose before process exit. */
/* 应用树释放完成前允许等待的默认最长时间，单位毫秒。 */
export const PROCESS_SHUTDOWN_TIMEOUT_MS = 5_000

/** Process-exit controller shared by normal completion and Unix signal handlers. */
/* 正常完成路径与 Unix 信号处理器共享的进程退出控制器。 */
export interface ProcessShutdown {
  /** Start or join graceful disposal before allowing natural completion with `code`. */
  /* 启动或加入优雅释放，完成后记录自然退出码。 */
  shutdown(code: number): Promise<void>
  /** Start graceful disposal followed by exit, or force exit when shutdown is already running. */
  /* 首次调用先释放再退出；关闭已进行时立即强制退出。 */
  interrupt(code: number): void
}

/**
 * Create one process-exit controller around an application disposer.
 * @param dispose - Whole-application teardown that resolves at quiescence.
 * @param forceExit - Function that exits the process immediately, replaceable by tests.
 * @param complete - Function that records the natural completion code, replaceable by tests.
 * @param timeoutMs - Grace before forced exit, replaceable by tests.
 * @returns A controller whose normal calls coalesce and whose repeated signal call escalates.
 */
/*
 * 围绕应用释放函数创建幂等且可升级的退出控制器。
 * @param dispose 释放整个应用并在静止后完成的函数。
 * @param forceExit 立即结束进程的函数，测试可替换。
 * @param complete 记录自然完成退出码的函数，测试可替换。
 * @param timeoutMs 强制退出前的最大宽限时间。
 * @returns 正常请求可合流、重复信号可升级的控制器。
 * @example `createProcessShutdown(() => ctx.fiber.dispose())`
 */
export function createProcessShutdown(
  dispose: () => Promise<void>,
  forceExit: (code: number) => void = (code) => { process.exit(code) },
  complete: (code: number) => void = (code) => { process.exitCode = code },
  timeoutMs = PROCESS_SHUTDOWN_TIMEOUT_MS,
): ProcessShutdown {
  /** 已启动的释放任务，存在时后续正常请求直接复用。 */
  let pending: Promise<void> | undefined
  /** 释放超时后触发强制退出的计时器。 */
  let timeout: ReturnType<typeof setTimeout> | undefined
  /** 是否已经记录自然完成退出码。 */
  let completed = false
  /** 是否已经执行强制退出。 */
  let forceExited = false

  /** 清除已设置的退出超时计时器。 */
  const clearExitTimeout = (): void => {
    /* v8 ignore else -- shutdown() arms the timer before any asynchronous exit path can run. */
    /* shutdown 会在任何异步结束路径之前设置计时器。 */
    if (timeout !== undefined) clearTimeout(timeout)
  }

  /** 最多执行一次强制退出，并先取消超时计时器。 */
  const forceExitOnce = (code: number): void => {
    if (forceExited) return
    forceExited = true
    clearExitTimeout()
    forceExit(code)
  }

  /** 最多记录一次自然完成，且强制退出后不再记录。 */
  const completeOnce = (code: number): void => {
    if (completed || forceExited) return
    completed = true
    clearExitTimeout()
    complete(code)
  }

  /** 启动唯一的释放流程，并选择释放成功后自然完成或强制退出。 */
  const start = (code: number, forceAfterDispose: boolean): Promise<void> => {
    if (pending !== undefined) return pending
    timeout = setTimeout(() => { forceExitOnce(code) }, timeoutMs)
    pending = Promise.resolve().then(dispose).then(
      () => {
        if (forceAfterDispose) forceExitOnce(code)
        else completeOnce(code)
      },
      () => { forceExitOnce(code) },
    )
    return pending
  }

  return {
    shutdown(code) {
      return start(code, false)
    },
    interrupt(code) {
      if (pending !== undefined) {
        forceExitOnce(code)
        return
      }
      void start(code, true)
    },
  }
}
