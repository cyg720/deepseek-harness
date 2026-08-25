/**
 * Quiescence tracking for emit-shaped hook runs that no extension point awaits. Bridges
 * track the run plus its continuation, pass the tracker signal into execution,
 * and drain on disposal so no process or late callback outlives the fiber.
 * @module @deepseek-ai/dsh-hook-protocol/detached
 */
/*
 * 文件职责：实现Hook 线协议的 detached.ts 模块。
 * 技术维度：TypeScript、Cordis、JSON 编解码、子进程、事件匹配和严格联合类型。
 * 产品维度：保证Hook 线协议可预测地传递事件、限制循环或适配外部工具。
 * 逻辑维度：解析配置，匹配事件，执行处理器并合并输出。
 * 关键边界：线协议输入必须校验；外部 Hook 失败不得破坏会话日志或核心循环。
 * 新手阅读建议：先读 types/events，再看 codec/matcher/runner，最后阅读桥接配置。
 */

/** In-flight registry for one bridge's detached hook runs; see the module doc for the wiring contract. */
/* 中文说明：类型或类 DetachedRuns 约束 Hook、守卫或目标数据职责。 */
export interface DetachedRuns {
  /**
   * The abort signal every tracked run must hand to {@link runHook} (via its
   * `signal` option). {@link drain} fires it so a still-running hook process is
   * killed rather than awaited out to its timeout (default 10 minutes).
   */
  readonly signal: AbortSignal
  /**
   * Register one detached run until it settles. Pass the FULL chain — the hook
   * run and its continuation/error handler — so {@link drain} waits for the
   * side effects (an inject, a warn), not just the process exit. A rejected
   * chain is absorbed here (settlement bookkeeping only), but rejection
   * handling is still the caller's job: an untracked `.catch` is what turns a
   * failure into a logged warning instead of silence.
   * @param run - the detached run chain to hold until settled.
   */
  track(run: Promise<unknown>): void
  /**
   * Abort {@link signal}, then resolve once every tracked chain has settled —
   * including chains tracked while the drain is in progress. The bridge
   * registers this as its effect disposer; cordis awaits it, so
   * `fiber.dispose()` resolving means the bridge's detached work is quiescent.
   * A run tracked AFTER drain resolves is not awaited by anyone — by then the
   * bridge's listeners are disposed, so nothing can start one.
   * @returns resolves when all tracked runs have settled.
   */
  drain(): Promise<void>
}

/**
 * Create a {@link DetachedRuns} tracker (one per bridge `apply()`); settled
 * runs are pruned so a long-lived session does not accumulate them.
 * @returns the tracker.
 */
/*
 * 中文说明：函数 createDetachedRuns 的参数见签名，返回结果供相邻流程使用；示例见本文件。
 * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
 */
export function createDetachedRuns(): DetachedRuns {
  /** 中文说明：协议局部值 inflight，由紧邻初始化决定。 */
  const inflight = new Set<Promise<unknown>>()
  /** 中文说明：协议局部值 controller，由紧邻初始化决定。 */
  const controller = new AbortController()
  return {
    signal: controller.signal,
    track(run: Promise<unknown>): void {
      inflight.add(run)
      /** 中文说明：协议局部值 settled，由紧邻初始化决定。 */
      const settled = (): void => { inflight.delete(run) }
      void run.then(settled, settled)
    },
    async drain(): Promise<void> {
      controller.abort(new Error('hook bridge disposed'))
      // Re-check after each wave: a chain can be tracked while a prior wave is
      // settling; loop until the registry is observed empty.
      while (inflight.size > 0) {
        await Promise.allSettled([...inflight])
      }
    },
  }
}
