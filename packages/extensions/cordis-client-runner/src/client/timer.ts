/**
 * ================================ 文件注释 ================================
 * 【文件职责】Cordis 定时器服务（timer）的浏览器实现：与 Host TimerService 相同
 *             的公开 API，为 ctx 混入生命周期安全的定时器助手，所有定时器都是
 *             Fiber 效果（插件停止自动清理）。
 * 【技术维度】Service 子类 + ctx.mixin 混入；timeout/interval 支持"回调"与
 *             "Promise/异步迭代器"两种重载；throttle/debounce 基于 schedule 包装器，
 *             挂起的回调归属调用 Fiber；dispose 随 Fiber 卸载。
 * 【产品维度】让动态插件在浏览器侧也能用与 Host 一致的定时器 API，且不会因忘记
 *             清理而泄漏（卸载即清理）。
 * 【逻辑维度】declare module 混入类型 → ClientTimerService：构造函数注册+混入 →
 *             setTimeout/setInterval（弃用别名）→ timeout/interval 双形态 →
 *             schedule 包装器 → throttle/debounce → provideClientTimer 安装函数。
 * 【关键边界】any 位必须保留（与 Host 擦除签名兼容，见文件头 oxlint 豁免注释）；
 *             interval 的迭代器在 dispose 时以"Context has been disposed"拒绝。
 * 【新手阅读建议】先看 timeout 的两种重载，再看 schedule 如何把清理挂到 Fiber。
 * ==========================================================================
 */

/** Browser implementation of the Cordis timer Service. */

import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
// 以下 oxlint 豁免：为保持与 vendored Host TimerService 的公开 API 完全兼容，
// 回调元组与异步迭代器的返回/拒绝值必须原样透传，不得收窄为单一调用方视角

/*
 * The browser Service preserves the vendored Host TimerService's erased callback tuples and arbitrary
 * async-iterator return and rejection values, so narrowing these positions would change the public API.
 */
/* oxlint-disable typescript/no-explicit-any -- Exact Host TimerService API compatibility; see above. */
/* oxlint-disable typescript/no-unsafe-argument -- The erased callback tuples pass through unchanged. */
/* oxlint-disable typescript/no-unsafe-assignment -- The erased callback tuples pass through unchanged. */
/* oxlint-disable typescript/no-unsafe-member-access -- The returned wrapper retains its dispose property. */
/* oxlint-disable typescript/no-unsafe-return -- The erased generic return values pass through unchanged. */
/* oxlint-disable typescript/prefer-promise-reject-errors -- Async iterators preserve arbitrary throw reasons. */

declare module '@deepseek-ai/cordis' {
  interface Context extends Pick<ClientTimerService, 'interval' | 'timeout' | 'throttle' | 'debounce' | 'setTimeout' | 'setInterval'> {
    /** Browser timer Service used by the mixed-in Context helpers. */
    timer: ClientTimerService
  }
}

type WithDispose<T> = T & { dispose: () => void }

// These `any` positions mirror the Host TimerService's overload erasure: generic callback tuples and async-iterator
// return/rejection values must pass through without narrowing them to one caller's invocation.

/** Browser timer Service with the same public API as the Host Cordis TimerService. */
/**
 * 浏览器侧定时器服务：公开 API 与 Host 的 Cordis TimerService 一致，为 ctx 混入
 * timeout/interval/throttle/debounce/setTimeout/setInterval；所有定时器都是 Fiber
 * 效果，插件停止时自动清理。
 */
export class ClientTimerService extends Service {
  /** Register the Service and mix its lifecycle-safe helpers onto Context. */
  /**
   * 注册 timer 服务并把生命周期安全的助手混入 Context。
   */
  constructor(ctx: Context) {
    super(ctx, 'timer')
    ctx.mixin('timer', ['timeout', 'interval', 'throttle', 'debounce', 'setTimeout', 'setInterval'])
  }

  /**
   * Run a callback once through {@link timeout}.
   * @param callback - Work to run after the delay.
   * @param delay - Delay in milliseconds.
   * @returns Disposer that cancels the pending callback early.
   * @deprecated Use `ctx.timeout()` instead.
   */
  setTimeout(callback: () => void, delay: number): () => void {
    return this.timeout(callback, delay)
  }

  /**
   * Run a callback repeatedly through {@link interval}.
   * @param callback - Work to run on each tick.
   * @param delay - Interval in milliseconds.
   * @returns Disposer that stops the interval early.
   * @deprecated Use `ctx.interval()` instead.
   */
  setInterval(callback: () => void, delay: number): () => void {
    return this.interval(callback, delay)
  }

  /**
   * Run a callback once after a delay.
   * @param callback - work to run.
   * @param delay - delay in milliseconds.
   * @returns disposer that cancels the callback.
   */
  timeout(callback: () => void, delay: number): () => void
  /**
   * Wait for a delay.
   * @param delay - delay in milliseconds.
   * @returns promise resolved after the delay.
   */
  timeout(delay: number): Promise<void>
  timeout(...args: any[]): any {
    const callback = typeof args[0] === 'function' ? args.shift() as () => void : undefined
    const delay = args[0] as number
    if (callback !== undefined) {
      const dispose = this.ctx.effect(() => {
        const timer = globalThis.setTimeout(() => {
          void dispose()
          callback()
        }, delay)
        return () => { globalThis.clearTimeout(timer) }
      }, 'ctx.timeout()')
      return dispose
    }

    const { promise, resolve, reject } = Promise.withResolvers<void>()
    const dispose = this.ctx.effect(() => {
      const timer = globalThis.setTimeout(resolve, delay)
      return () => {
        globalThis.clearTimeout(timer)
        reject(new Error('Context has been disposed'))
      }
    }, 'ctx.timeout()')
    return promise.finally(() => { void dispose() })
  }

  /**
   * Run a callback repeatedly.
   * @param callback - work to run on each tick.
   * @param delay - interval in milliseconds.
   * @returns disposer that stops the interval.
   */
  interval(callback: () => void, delay: number): () => void
  /**
   * Iterate over timer ticks.
   * @param delay - interval in milliseconds.
   * @returns async iterator of ticks.
   */
  interval<R = any>(delay: number): AsyncIterableIterator<void, R, void>
  interval(...args: any[]): any {
    const callback = typeof args[0] === 'function' ? args.shift() as () => void : undefined
    const delay = args[0] as number
    if (callback !== undefined) {
      return this.ctx.effect(() => {
        const timer = globalThis.setInterval(callback, delay)
        return () => { globalThis.clearInterval(timer) }
      }, 'ctx.interval()')
    }

    let done: { kind: 'return'; value: any } | { kind: 'throw'; reason: any } | undefined
    let nextTask: PromiseWithResolvers<IteratorResult<void>> | undefined
    const dispose = this.ctx.effect(() => {
      const timer = globalThis.setInterval(() => {
        nextTask?.resolve({ done: false, value: undefined })
      }, delay)
      return () => {
        globalThis.clearInterval(timer)
        if (done !== undefined) return
        done = { kind: 'throw', reason: new Error('Context has been disposed') }
        nextTask?.reject(done.reason)
      }
    }, 'ctx.interval()')
    return {
      next: () => {
        if (done === undefined) return (nextTask = Promise.withResolvers()).promise
        if (done.kind === 'return') return Promise.resolve({ done: true, value: done.value })
        return Promise.reject(done.reason)
      },
      return: (value: any) => {
        if (done === undefined) done = { kind: 'return', value }
        nextTask?.resolve({ done: true, value })
        void dispose()
        return Promise.resolve({ done: true, value })
      },
      throw: (reason: any) => {
        if (done === undefined) done = { kind: 'throw', reason }
        nextTask?.reject(reason)
        void dispose()
        return Promise.resolve({ done: true, value: undefined })
      },
      [Symbol.asyncIterator]() {
        return this
      },
    } satisfies AsyncIterableIterator<void>
  }

  /** Build a delayed wrapper whose pending callback belongs to the calling Fiber. */
  /**
   * 构造延迟包装器：待执行的回调挂到调用 Fiber 上（dispose 随 Fiber 清理）。
   */
  private schedule(label: string, trigger: (args: any[], disposed: boolean) => number | undefined, disposed = false): any {
    let timer: number | undefined
    const dispose = this.ctx.effect(() => () => {
      disposed = true
      globalThis.clearTimeout(timer)
    }, label)
    const wrapper: any = (...args: any[]): void => {
      globalThis.clearTimeout(timer)
      timer = trigger(args, disposed)
    }
    wrapper.dispose = dispose
    return wrapper
  }

  /**
   * Return a throttled function whose timer is disposed with the calling Fiber.
   * @param callback - Function to throttle.
   * @param delay - Minimum interval between calls in milliseconds.
   * @param noTrailing - Whether to suppress a delayed trailing call.
   * @returns Throttled function with an early disposer.
   */
  throttle<F extends (...args: any[]) => void>(callback: F, delay: number, noTrailing?: boolean): WithDispose<F> {
    let lastCall = -Infinity
    const execute = (...args: Parameters<F>): void => {
      lastCall = Date.now()
      callback(...args)
    }
    return this.schedule('ctx.throttle()', (args, disposed) => {
      const remaining = delay - Date.now() + lastCall
      if (remaining <= 0) {
        execute(...args as Parameters<F>)
      } else if (!disposed) {
        return globalThis.setTimeout(execute, remaining, ...args)
      }
    }, noTrailing)
  }

  /**
   * Return a debounced function whose timer is disposed with the calling Fiber.
   * @param callback - Function to debounce.
   * @param delay - Quiet period in milliseconds.
   * @returns Debounced function with an early disposer.
   */
  debounce<F extends (...args: any[]) => void>(callback: F, delay: number): WithDispose<F> {
    return this.schedule('ctx.debounce()', (args, disposed) => {
      if (disposed) return
      return globalThis.setTimeout(callback, delay, ...args)
    })
  }
}

/**
 * Install the browser timer Service on one Client composition.
 * @param ctx - Client context that owns the Service and mixed-in helpers.
 * @returns Nothing after registering the Service.
 */
/**
 * 在客户端组合上安装浏览器定时器服务（构造即注册 + 混入）。
 */
export function provideClientTimer(ctx: Context): void {
  new ClientTimerService(ctx)
}
