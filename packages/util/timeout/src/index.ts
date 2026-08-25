/**
 * Shared timeout arithmetic, signal fusion, and classification. The library
 * only notifies through abort signals; each capability still owns the mechanism
 * that stops its work and translates timeout reasons into public outcomes.
 * @module @deepseek-ai/dsh-timeout
 */
/*
 * 文件职责：实现 index.ts 覆盖的通用运行时工具行为与边界场景。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、HTTP、类型投影或异步资源控制。
 * 产品维度：保障 Agent 的通用运行时工具能力稳定、可复现且可诊断。
 * 逻辑维度：准备或解析输入，执行核心流程，再转换并核对结果、错误与清理。
 * 关键边界：网络和生成数据不可信；超时与取消必须传播；临时资源必须可靠释放。
 * 新手阅读建议：先看公开类型和夹具，再读主流程，最后关注校验、超时与失败路径。
 */

/**
 * Internal abort reason carrying a capability-owned code and elapsed deadline.
 * Providers translate it through {@link timeoutOf} before returning to callers.
 */
/* 中文说明：class TimeoutReason 定义本模块所需的数据或行为，用于表达通用运行时工具场景。 */
export class TimeoutReason extends Error {
  override name = 'TimeoutReason'

  /**
   * @param code Capability-owned timeout code (e.g. `BASH_TIMEOUT`).
   * @param timeoutMs The deadline that elapsed, in milliseconds.
   */
  constructor(readonly code: string, readonly timeoutMs: number) {
    super(`${code} after ${timeoutMs}ms`)
  }
}

/** Largest delay Node schedules without clamping it to one millisecond. */
/* 中文说明：常量 MAX_TIMER_DELAY_MS 保存本模块共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
export const MAX_TIMER_DELAY_MS = 2_147_483_647

/** 中文说明：函数 assertTimerDelay 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function assertTimerDelay(timeoutMs: number, name: string): void {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > MAX_TIMER_DELAY_MS) {
    throw new Error(`${name} must be a positive finite number no greater than ${MAX_TIMER_DELAY_MS}`)
  }
}

/**
 * Validate a caller's optional timeout hint, use the backend default, then cap
 * it. Supplied values must be positive and finite; zero is not a public
 * disable-timeout sentinel.
 *
 * @param requested The caller's optional hint; validated when present.
 * @param def The backend default applied when `requested` is absent.
 * @param max The backend upper bound the result is capped to.
 * @param name Field name used in the thrown message (so the caller sees which input was
 *   bad).
 * @returns The effective timeout in milliseconds: `min(requested ?? def, max)`.
 */
/*
 * 中文说明：函数 clampTimeout 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。
 * @param requested 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @param def 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @param max 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @param name 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
 */
export function clampTimeout(
  requested: number | undefined,
  def: number,
  max: number,
  name = 'timeoutMs',
): number {
  if (requested !== undefined && (!Number.isFinite(requested) || requested <= 0)) {
    throw new Error(`${name} must be a positive finite number`)
  }
  return Math.min(requested ?? def, max)
}

/** A deadline signal plus the cleanup that clears its timer (dispose-once). */
/* 中文说明：interface Deadline 定义本模块所需的数据或行为，用于表达通用运行时工具场景。 */
export interface Deadline {
  /** Aborts on upstream cancellation OR on timeout (the timeout carries a {@link TimeoutReason}). */
  readonly signal: AbortSignal
  /** Clear the timer. Safe to call once; `using` calls it at scope exit. */
  [Symbol.dispose](): void
}

/** Rearmable timeout around one outstanding async-iterator demand. */
/* 中文说明：interface IdleWatchdog 定义本模块所需的数据或行为，用于表达通用运行时工具场景。 */
export interface IdleWatchdog {
  /** Stable signal aborted by upstream cancellation or this watchdog's timeout. */
  readonly signal: AbortSignal
  /**
   * Await one iterator demand while the idle timer is armed.
   * @param iterator - iterator whose next value represents provider progress.
   * @returns the iterator's next result.
   */
  next<T>(iterator: AsyncIterator<T>): Promise<IteratorResult<T>>
  /** Rearm an outstanding demand after transport activity that yields no iterator value; otherwise a no-op. */
  pulse(): void
  /** Clear an armed timer; safe to call once at the owning stream's exit. */
  [Symbol.dispose](): void
}

/**
 * Fuse upstream cancellation with an identifiable timeout. `timeoutMs <= 0` is
 * the internal no-timer sentinel; the returned disposer clears an armed timer.
 * The signal only notifies, so callers must stop their own work.
 *
 * @param upstream The caller's cancellation signal, if any, fused into the result.
 * @param timeoutMs Deadline in milliseconds; `<= 0` means "no timeout" (arm no timer).
 * @param code Capability-owned code stamped onto the timeout's {@link TimeoutReason}.
 * @returns The fused {@link Deadline} (signal + timer cleanup).
 */
/*
 * 中文说明：函数 deadline 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。
 * @param upstream 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @param timeoutMs 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @param code 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
 */
export function deadline(
  upstream: AbortSignal | undefined,
  timeoutMs: number,
  code: string,
): Deadline {
  if (timeoutMs <= 0) {
    // No timeout (background work): forward only the upstream signal, or a never-aborting one
    // when there is no upstream.
    return { signal: upstream ?? new AbortController().signal, [Symbol.dispose]() {} }
  }

  assertTimerDelay(timeoutMs, 'deadline timeoutMs')

  /** 中文说明：变量 timer 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const timer = new AbortController()
  /** 中文说明：函数值 id 封装本模块的局部步骤；参数和返回值由右侧签名约束；示例见本模块调用。 */
  const id = setTimeout(() => { timer.abort(new TimeoutReason(code, timeoutMs)) }, timeoutMs)
  return {
    // AbortSignal.any adopts the reason of whichever source aborts FIRST, so a
    // race resolves to a single cause: timeoutOf() reads TimeoutReason only
    // when the timeout won, and upstream-wins leaves an ordinary abort reason.
    signal: upstream !== undefined ? AbortSignal.any([upstream, timer.signal]) : timer.signal,
    [Symbol.dispose]() { clearTimeout(id) },
  }
}

/**
 * Create a rearmable idle watchdog for an async iterator. The timer exists only
 * while {@link IdleWatchdog.next} is outstanding, so consumer think time does
 * not count as provider idle time. The returned signal is stable for the whole
 * call and only notifies; the iterator must observe it to terminate its work.
 *
 * @param upstream - caller cancellation fused into the stable signal.
 * @param timeoutMs - positive finite idle interval in milliseconds.
 * @param code - capability-owned code carried by the timeout reason.
 * @returns a stable signal, guarded next operation, and timer disposer.
 */
/*
 * 中文说明：函数 idleWatchdog 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。
 * @param upstream 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @param timeoutMs 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @param code 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
 */
export function idleWatchdog(
  upstream: AbortSignal | undefined,
  timeoutMs: number,
  code: string,
): IdleWatchdog {
  assertTimerDelay(timeoutMs, 'idleWatchdog timeoutMs')
  /** 中文说明：变量 timeout 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const timeout = new AbortController()
  /** 中文说明：变量 signal 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const signal = upstream === undefined
    ? timeout.signal
    : AbortSignal.any([upstream, timeout.signal])
  /** 中文说明：变量 timer 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let timer: ReturnType<typeof setTimeout> | undefined
  /** 中文说明：变量 outstanding 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let outstanding = false
  /** 中文说明：变量 disposed 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let disposed = false

  /** 中文说明：函数值 arm 封装本模块的局部步骤；参数和返回值由右侧签名约束；示例见本模块调用。 */
  const arm = (): void => {
    if (timer !== undefined) clearTimeout(timer)
    timer = setTimeout(() => {
      timeout.abort(new TimeoutReason(code, timeoutMs))
    }, timeoutMs)
  }

  return {
    signal,
    async next<T>(iterator: AsyncIterator<T>): Promise<IteratorResult<T>> {
      if (disposed) throw new Error('idleWatchdog is disposed')
      if (outstanding) throw new Error('idleWatchdog next is already outstanding')
      outstanding = true
      arm()
      try {
        return await iterator.next()
      } finally {
        clearTimeout(timer)
        timer = undefined
        outstanding = false
      }
    },
    pulse(): void {
      if (disposed || !outstanding) return
      arm()
    },
    [Symbol.dispose](): void {
      if (disposed) return
      disposed = true
      if (timer !== undefined) clearTimeout(timer)
      timer = undefined
    },
  }
}

/**
 * Recover a timeout reason from a reason-bearing object. Supplying `code`
 * distinguishes this deadline from a nested upstream deadline; a foreign code
 * follows the ordinary cancellation path.
 *
 * @param x An {@link AbortSignal} or any `{ reason }` carrier (e.g. a caught abort error).
 * @param code When provided, only a {@link TimeoutReason} with this exact `code` matches.
 * @returns The matching {@link TimeoutReason}, else `undefined`.
 */
/*
 * 中文说明：函数 timeoutOf 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。
 * @param x 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @param code 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
 */
export function timeoutOf(x: AbortSignal | { reason?: unknown }, code?: string): TimeoutReason | undefined {
  // AbortSignal.reason is typed `any`; pin it to `unknown` so no `any` leaks and
  // the instanceof narrows cleanly for both a signal and a bare reason carrier.
  /** 中文说明：变量 reason 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const reason: unknown = x.reason
  if (!(reason instanceof TimeoutReason)) return undefined
  return code === undefined || reason.code === code ? reason : undefined
}
