/**
 * 文件职责：验证 CLI 进程关闭控制器的自然完成、超时、失败、信号升级和请求合流行为。
 * 技术维度：使用 Vitest 假计时器、函数桩和可手动完成的 Promise 精确控制异步时序。
 * 产品维度：确保应用既有机会优雅释放资源，又不会因卡死释放而阻止用户退出。
 * 逻辑维度：构造可控释放任务，分别驱动成功、拒绝、超时、单/双信号和重复关闭场景。
 * 关键边界：测试会修改进程退出码和计时器；每个用例后必须恢复真实计时器与所有桩。
 * 新手阅读建议：先理解 deferred 如何控制 Promise，再按自然完成、超时、信号升级顺序阅读。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createProcessShutdown,
  PROCESS_SHUTDOWN_TIMEOUT_MS,
} from '../src/process-shutdown.ts'

/**
 * 创建可由测试手动完成或拒绝的 Promise。
 * @returns Promise 及其 resolve/reject 控制函数。
 * @example `const disposal = deferred()`
 */
function deferred(): { promise: Promise<void>; resolve: () => void; reject: (error: Error) => void } {
  /** 在 Promise 构造器中捕获的成功完成函数。 */
  let resolve!: () => void
  /** 在 Promise 构造器中捕获的失败函数。 */
  let reject!: (error: Error) => void
  /** 由上述两个函数控制完成状态的等待对象。 */
  const promise = new Promise<void>((accept, fail) => {
    resolve = accept
    reject = fail
  })
  return { promise, resolve, reject }
}

/** 每个用例后恢复真实计时器和全部方法桩。 */
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('process shutdown', () => {
  /** 释放成功应记录自然完成，释放失败应立即强制退出。 */
  it('completes naturally after disposal resolves and forces exit when it rejects', async () => {
    /** 成功路径的强制退出桩。 */
    const resolvedExit = vi.fn()
    /** 成功路径的自然完成桩。 */
    const resolvedComplete = vi.fn()
    /** 释放立即成功的关闭控制器。 */
    const resolved = createProcessShutdown(() => Promise.resolve(), resolvedExit, resolvedComplete)
    await resolved.shutdown(0)
    expect(resolvedComplete).toHaveBeenCalledOnce()
    expect(resolvedComplete).toHaveBeenCalledWith(0)
    expect(resolvedExit).not.toHaveBeenCalled()

    /** 失败路径的强制退出桩。 */
    const rejectedExit = vi.fn()
    /** 失败路径的自然完成桩。 */
    const rejectedComplete = vi.fn()
    /** 释放立即拒绝的关闭控制器。 */
    const rejected = createProcessShutdown(
      () => Promise.reject(new Error('dispose failed')),
      rejectedExit,
      rejectedComplete,
    )
    await rejected.shutdown(1)
    expect(rejectedExit).toHaveBeenCalledOnce()
    expect(rejectedExit).toHaveBeenCalledWith(1)
    expect(rejectedComplete).not.toHaveBeenCalled()
  })

  /** 默认自然完成应写入 process.exitCode 而不直接调用 process.exit。 */
  it('uses process.exitCode for default normal completion', async () => {
    /** 防止测试进程真实结束的 process.exit 桩。 */
    const exit = vi.spyOn(process, 'exit').mockImplementation(_code => undefined as never)
    /** 用例执行前的进程退出码，结束时恢复。 */
    const originalExitCode = process.exitCode
    process.exitCode = undefined
    /** 使用默认退出实现的关闭控制器。 */
    const shutdown = createProcessShutdown(() => Promise.resolve())

    try {
      await shutdown.shutdown(7)

      expect(process.exitCode).toBe(7)
      expect(exit).not.toHaveBeenCalled()
    } finally {
      process.exitCode = originalExitCode
    }
  })

  /** 释放超过默认宽限时间时应强制退出且不再自然完成。 */
  it('forces exit when graceful disposal reaches its bound', async () => {
    vi.useFakeTimers()
    /** 手动控制完成时间的释放任务。 */
    const disposal = deferred()
    /** 超时时预期调用的强制退出桩。 */
    const exit = vi.fn()
    /** 超时后不应调用的自然完成桩。 */
    const complete = vi.fn()
    /** 使用默认超时的关闭控制器。 */
    const shutdown = createProcessShutdown(() => disposal.promise, exit, complete)
    /** 正在等待释放完成的关闭 Promise。 */
    const pending = shutdown.shutdown(0)

    await vi.advanceTimersByTimeAsync(PROCESS_SHUTDOWN_TIMEOUT_MS - 1)
    expect(exit).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(exit).toHaveBeenCalledOnce()
    expect(exit).toHaveBeenCalledWith(0)

    disposal.resolve()
    await pending
    expect(exit).toHaveBeenCalledOnce()
    expect(complete).not.toHaveBeenCalled()
  })

  /** 调用方提供的自定义宽限时间应替代默认值。 */
  it('honors a caller-supplied grace period', async () => {
    vi.useFakeTimers()
    const disposal = deferred()
    const exit = vi.fn()
    const shutdown = createProcessShutdown(() => disposal.promise, exit, vi.fn(), 25)
    const pending = shutdown.shutdown(0)

    await vi.advanceTimersByTimeAsync(24)
    expect(exit).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(exit).toHaveBeenCalledOnce()

    disposal.resolve()
    await pending
  })

  /** 正常关闭卡在释放时，Ctrl+C 应升级为强制退出。 */
  it('lets Ctrl+C force a normal shutdown already stuck in disposal', async () => {
    const disposal = deferred()
    const exit = vi.fn()
    const complete = vi.fn()
    const shutdown = createProcessShutdown(() => disposal.promise, exit, complete)
    const pending = shutdown.shutdown(0)

    shutdown.interrupt(130)
    expect(exit).toHaveBeenCalledOnce()
    expect(exit).toHaveBeenCalledWith(130)

    disposal.resolve()
    await pending
    expect(exit).toHaveBeenCalledOnce()
    expect(complete).not.toHaveBeenCalled()
  })

  /** 信号启动的释放即使成功，结束时也应执行信号退出。 */
  it('forces exit after disposal started by a signal', async () => {
    const disposal = deferred()
    const exit = vi.fn()
    const complete = vi.fn()
    const shutdown = createProcessShutdown(() => disposal.promise, exit, complete)

    shutdown.interrupt(143)
    disposal.resolve()
    await shutdown.shutdown(0)

    expect(exit).toHaveBeenCalledOnce()
    expect(exit).toHaveBeenCalledWith(143)
    expect(complete).not.toHaveBeenCalled()
  })

  /** 第一次信号优雅排空，第二次信号立即强制退出。 */
  it('drains on the first signal and forces on the second signal', async () => {
    const disposal = deferred()
    const dispose = vi.fn(() => disposal.promise)
    const exit = vi.fn()
    const shutdown = createProcessShutdown(dispose, exit, vi.fn())

    shutdown.interrupt(143)
    await Promise.resolve()
    expect(dispose).toHaveBeenCalledOnce()
    expect(exit).not.toHaveBeenCalled()

    shutdown.interrupt(130)
    expect(exit).toHaveBeenCalledOnce()
    expect(exit).toHaveBeenCalledWith(130)

    disposal.resolve()
    await shutdown.shutdown(0)
    expect(exit).toHaveBeenCalledOnce()
  })

  /** 多次正常关闭请求应复用同一 Promise，不视为升级信号。 */
  it('coalesces normal shutdown calls without treating them as escalation', async () => {
    const disposal = deferred()
    const exit = vi.fn()
    const complete = vi.fn()
    const shutdown = createProcessShutdown(() => disposal.promise, exit, complete)

    const first = shutdown.shutdown(0)
    const second = shutdown.shutdown(1)
    expect(second).toBe(first)
    expect(exit).not.toHaveBeenCalled()

    disposal.resolve()
    await first
    expect(complete).toHaveBeenCalledOnce()
    expect(complete).toHaveBeenCalledWith(0)
    expect(exit).not.toHaveBeenCalled()
  })

  /** 自然完成后若仍有句柄，后续信号仍可强制终止进程。 */
  it('lets a signal force exit while natural completion drains remaining handles', async () => {
    const exit = vi.fn()
    const complete = vi.fn()
    const shutdown = createProcessShutdown(() => Promise.resolve(), exit, complete)

    await shutdown.shutdown(0)
    shutdown.interrupt(130)

    expect(complete).toHaveBeenCalledOnce()
    expect(exit).toHaveBeenCalledOnce()
    expect(exit).toHaveBeenCalledWith(130)
  })
})
