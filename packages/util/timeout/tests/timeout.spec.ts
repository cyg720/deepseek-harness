/**
 * 文件职责：验证 timeout.spec.ts 覆盖的通用运行时工具行为与边界场景。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、HTTP、类型投影或异步资源控制。
 * 产品维度：保障 Agent 的通用运行时工具能力稳定、可复现且可诊断。
 * 逻辑维度：准备或解析输入，执行核心流程，再转换并核对结果、错误与清理。
 * 关键边界：网络和生成数据不可信；超时与取消必须传播；临时资源必须可靠释放。
 * 新手阅读建议：先看公开类型和夹具，再读主流程，最后关注校验、超时与失败路径。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clampTimeout,
  deadline,
  idleWatchdog,
  MAX_TIMER_DELAY_MS,
  timeoutOf,
  TimeoutReason,
} from '@deepseek-ai/dsh-timeout'

describe('TimeoutReason', () => {
  it('is an Error carrying the code and elapsed ms', () => {
    /** 中文说明：变量 reason 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const reason = new TimeoutReason('BASH_TIMEOUT', 100)
    expect(reason).toBeInstanceOf(Error)
    expect(reason.name).toBe('TimeoutReason')
    expect(reason.code).toBe('BASH_TIMEOUT')
    expect(reason.timeoutMs).toBe(100)
    expect(reason.message).toBe('BASH_TIMEOUT after 100ms')
  })
})

describe('clampTimeout', () => {
  it('fills the default when the hint is absent', () => {
    expect(clampTimeout(undefined, 120_000, 600_000)).toBe(120_000)
  })

  it('caps the hint at max', () => {
    expect(clampTimeout(999_999, 120_000, 600_000)).toBe(600_000)
  })

  it('keeps a valid hint under the cap', () => {
    expect(clampTimeout(5_000, 120_000, 600_000)).toBe(5_000)
  })

  it('caps the default itself when the default exceeds max', () => {
    // min(def, max) applies even with no hint — a misconfigured backend never
    // exceeds its own cap.
    expect(clampTimeout(undefined, 900_000, 600_000)).toBe(600_000)
  })

  it('rejects a non-finite hint with the caller-provided name', () => {
    expect(() => clampTimeout(Number.NaN, 100, 200, 'bash-local: request.timeoutMs'))
      .toThrow(/bash-local: request\.timeoutMs must be a positive finite number/)
    expect(() => clampTimeout(Number.POSITIVE_INFINITY, 100, 200))
      .toThrow(/timeoutMs must be a positive finite number/)
  })

  it('rejects a non-positive hint', () => {
    expect(() => clampTimeout(0, 100, 200)).toThrow(/must be a positive finite number/)
    expect(() => clampTimeout(-1, 100, 200)).toThrow(/must be a positive finite number/)
  })
})

describe('deadline — timeout arm', () => {
  afterEach(() => { vi.useRealTimers() })

  it('aborts on timeout with a TimeoutReason after the elapsed ms', () => {
    vi.useFakeTimers()
    using d = deadline(undefined, 100, 'BASH_TIMEOUT')
    expect(d.signal.aborted).toBe(false)
    vi.advanceTimersByTime(100)
    expect(d.signal.aborted).toBe(true)
    /** 中文说明：变量 reason 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const reason = timeoutOf(d.signal)
    expect(reason).toBeInstanceOf(TimeoutReason)
    expect(reason?.code).toBe('BASH_TIMEOUT')
    expect(reason?.timeoutMs).toBe(100)
  })

  it('[Symbol.dispose] clears the timer so no abort fires afterward', () => {
    vi.useFakeTimers()
    /** 中文说明：变量 d 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const d = deadline(undefined, 100, 'BASH_TIMEOUT')
    d[Symbol.dispose]()
    vi.advanceTimersByTime(1_000)
    expect(d.signal.aborted).toBe(false)
    expect(timeoutOf(d.signal)).toBeUndefined()
  })

  it('rejects delays that Node would clamp to one millisecond', () => {
    expect(() => deadline(undefined, MAX_TIMER_DELAY_MS + 1, 'BASH_TIMEOUT'))
      .toThrow(`no greater than ${MAX_TIMER_DELAY_MS}`)
    expect(() => deadline(undefined, Number.POSITIVE_INFINITY, 'BASH_TIMEOUT'))
      .toThrow(`no greater than ${MAX_TIMER_DELAY_MS}`)
  })
})

describe('deadline — fuse with upstream', () => {
  it('aborts on upstream cancellation, classified as NOT a timeout', () => {
    /** 中文说明：变量 upstream 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const upstream = new AbortController()
    using d = deadline(upstream.signal, 60_000, 'BASH_TIMEOUT')
    upstream.abort('user cancelled')
    expect(d.signal.aborted).toBe(true)
    expect(timeoutOf(d.signal)).toBeUndefined()
  })

  it('cancel wins when it fires before the timeout', () => {
    vi.useFakeTimers()
    try {
      /** 中文说明：变量 upstream 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const upstream = new AbortController()
      using d = deadline(upstream.signal, 100, 'BASH_TIMEOUT')
      upstream.abort('user cancelled') // fires first, before the 100ms timer
      vi.advanceTimersByTime(200)
      expect(d.signal.aborted).toBe(true)
      // AbortSignal.any adopts the FIRST source's reason: cancel won, so no
      // TimeoutReason even though the timer later elapsed.
      expect(timeoutOf(d.signal)).toBeUndefined()
    } finally {
      vi.useRealTimers()
    }
  })

  it('timeout wins when it fires before upstream cancellation', () => {
    vi.useFakeTimers()
    try {
      /** 中文说明：变量 upstream 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const upstream = new AbortController()
      using d = deadline(upstream.signal, 100, 'WEB_FETCH_TIMEOUT')
      vi.advanceTimersByTime(150) // past the 100ms deadline: the timer fires first
      expect(d.signal.aborted).toBe(true)
      expect(timeoutOf(d.signal)?.code).toBe('WEB_FETCH_TIMEOUT')
      // A later upstream abort is a no-op on the already-aborted fused signal:
      // AbortSignal.any keeps the FIRST cause, so the timeout classification stands.
      upstream.abort('too late')
      expect(timeoutOf(d.signal)?.code).toBe('WEB_FETCH_TIMEOUT')
    } finally {
      vi.useRealTimers()
    }
  })

  it('forwards a pre-aborted upstream signal immediately', () => {
    /** 中文说明：变量 upstream 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const upstream = new AbortController()
    upstream.abort('already gone')
    using d = deadline(upstream.signal, 60_000, 'BASH_TIMEOUT')
    expect(d.signal.aborted).toBe(true)
    expect(timeoutOf(d.signal)).toBeUndefined()
  })
})

describe('deadline — timeoutMs <= 0 (no-timeout sentinel)', () => {
  afterEach(() => { vi.useRealTimers() })

  it('arms no timer and forwards only the upstream signal', () => {
    vi.useFakeTimers()
    /** 中文说明：变量 upstream 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const upstream = new AbortController()
    using d = deadline(upstream.signal, 0, 'BASH_TIMEOUT')
    vi.advanceTimersByTime(1_000_000)
    expect(d.signal.aborted).toBe(false) // no timer ever armed
    upstream.abort('kill')
    expect(d.signal.aborted).toBe(true)
    expect(timeoutOf(d.signal)).toBeUndefined() // never a timeout
  })

  it('returns a never-aborting signal with a no-op disposer when there is no upstream', () => {
    vi.useFakeTimers()
    /** 中文说明：变量 d 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const d = deadline(undefined, 0, 'BASH_TIMEOUT')
    expect(() => { d[Symbol.dispose]() }).not.toThrow()
    vi.advanceTimersByTime(1_000_000)
    expect(d.signal.aborted).toBe(false)
    expect(timeoutOf(d.signal)).toBeUndefined()
  })

  it('treats a negative timeout the same as zero', () => {
    /** 中文说明：变量 d 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const d = deadline(undefined, -5, 'BASH_TIMEOUT')
    expect(d.signal.aborted).toBe(false)
    d[Symbol.dispose]()
  })
})

describe('timeoutOf', () => {
  it('classifies a bare reason carrier that holds a TimeoutReason', () => {
    /** 中文说明：变量 reason 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const reason = new TimeoutReason('WEB_FETCH_TIMEOUT', 50)
    expect(timeoutOf({ reason })).toBe(reason)
  })

  it('returns undefined for a non-timeout reason', () => {
    expect(timeoutOf({ reason: new Error('other') })).toBeUndefined()
    expect(timeoutOf({ reason: 'user cancelled' })).toBeUndefined()
    expect(timeoutOf({})).toBeUndefined()
  })

  it('matches only the requested code when one is given', () => {
    /** 中文说明：变量 reason 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const reason = new TimeoutReason('BASH_TIMEOUT', 100)
    expect(timeoutOf({ reason }, 'BASH_TIMEOUT')).toBe(reason)
    expect(timeoutOf({ reason }, 'WEB_FETCH_TIMEOUT')).toBeUndefined()
  })
})

describe('deadline — nested deadlines', () => {
  it("does not misclassify an outer deadline's timeout as the inner code", () => {
    // The upstream handed to the inner deadline is ITSELF a deadline that has already timed out
    // (outer). `AbortSignal.any` preserves that reason, but scoping `timeoutOf` to the inner code
    // must classify it as upstream cancellation rather than the inner capability's timeout.
    /** 中文说明：变量 outer 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const outer = new AbortController()
    outer.abort(new TimeoutReason('OUTER_TIMEOUT', 30))
    using inner = deadline(outer.signal, 60_000, 'BASH_TIMEOUT')
    expect(inner.signal.aborted).toBe(true)
    expect(timeoutOf(inner.signal, 'BASH_TIMEOUT')).toBeUndefined() // not ours → upstream-cancel path
    expect(timeoutOf(inner.signal)?.code).toBe('OUTER_TIMEOUT') // but IS a timeout, unscoped
  })
})

describe('idleWatchdog', () => {
  afterEach(() => { vi.useRealTimers() })

  it('arms only while next is outstanding and rearms the same signal for later demand', async () => {
    vi.useFakeTimers()
    /** 中文说明：变量 first 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const first = Promise.withResolvers<IteratorResult<number>>()
    /** 中文说明：变量 second 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const second = Promise.withResolvers<IteratorResult<number>>()
    /** 中文说明：变量 iterator 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const iterator: AsyncIterator<number> = {
      next: vi.fn()
        .mockImplementationOnce(() => first.promise)
        .mockImplementationOnce(() => second.promise),
    }
    using watchdog = idleWatchdog(undefined, 100, 'LLM_STREAM_IDLE_TIMEOUT')
    /** 中文说明：变量 stableSignal 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const stableSignal = watchdog.signal

    /** 中文说明：变量 firstNext 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const firstNext = watchdog.next(iterator)
    await vi.advanceTimersByTimeAsync(99)
    expect(stableSignal.aborted).toBe(false)
    first.resolve({ done: false, value: 1 })
    await expect(firstNext).resolves.toEqual({ done: false, value: 1 })

    await vi.advanceTimersByTimeAsync(10_000)
    expect(stableSignal.aborted).toBe(false)
    expect(watchdog.signal).toBe(stableSignal)

    /** 中文说明：变量 secondNext 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const secondNext = watchdog.next(iterator)
    await vi.advanceTimersByTimeAsync(100)
    expect(timeoutOf(stableSignal, 'LLM_STREAM_IDLE_TIMEOUT')).toMatchObject({ timeoutMs: 100 })
    second.reject(stableSignal.reason)
    await expect(secondNext).rejects.toBe(stableSignal.reason)
  })

  it('rearms outstanding demand on an out-of-band activity pulse', async () => {
    vi.useFakeTimers()
    /** 中文说明：变量 pending 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const pending = Promise.withResolvers<IteratorResult<number>>()
    /** 中文说明：变量 watchdog 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const watchdog = idleWatchdog(undefined, 100, 'LLM_STREAM_IDLE_TIMEOUT')
    watchdog.pulse()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(watchdog.signal.aborted).toBe(false)

    /** 中文说明：函数值 next 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const next = watchdog.next({ next: () => pending.promise })
    await vi.advanceTimersByTimeAsync(99)
    watchdog.pulse()
    await vi.advanceTimersByTimeAsync(99)
    expect(watchdog.signal.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(timeoutOf(watchdog.signal, 'LLM_STREAM_IDLE_TIMEOUT')).toMatchObject({ timeoutMs: 100 })
    pending.reject(watchdog.signal.reason)
    await expect(next).rejects.toBe(watchdog.signal.reason)

    watchdog[Symbol.dispose]()
    watchdog.pulse()
  })

  it('keeps an earlier upstream abort distinct from its own timeout', async () => {
    vi.useFakeTimers()
    /** 中文说明：变量 upstream 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const upstream = new AbortController()
    using watchdog = idleWatchdog(upstream.signal, 100, 'LLM_STREAM_IDLE_TIMEOUT')
    upstream.abort('caller cancelled')
    expect(watchdog.signal.aborted).toBe(true)
    expect(timeoutOf(watchdog.signal, 'LLM_STREAM_IDLE_TIMEOUT')).toBeUndefined()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(watchdog.signal.reason).toBe('caller cancelled')
  })

  it('clears an outstanding arm on disposal', async () => {
    vi.useFakeTimers()
    /** 中文说明：变量 pending 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const pending = Promise.withResolvers<IteratorResult<number>>()
    /** 中文说明：变量 watchdog 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const watchdog = idleWatchdog(undefined, 100, 'LLM_STREAM_IDLE_TIMEOUT')
    void watchdog.next({ next: () => pending.promise })
    watchdog[Symbol.dispose]()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(watchdog.signal.aborted).toBe(false)
    pending.resolve({ done: true, value: undefined })
    await expect(watchdog.next({ next: () => Promise.resolve({ done: true, value: undefined }) }))
      .rejects.toThrow(/disposed/)
    watchdog[Symbol.dispose]()
  })

  it('rejects invalid bounds and concurrent iterator demand', async () => {
    expect(() => idleWatchdog(undefined, 0, 'IDLE')).toThrow(/positive finite/)
    expect(() => idleWatchdog(undefined, Number.NaN, 'IDLE')).toThrow(/positive finite/)
    expect(() => idleWatchdog(undefined, MAX_TIMER_DELAY_MS + 1, 'IDLE'))
      .toThrow(`no greater than ${MAX_TIMER_DELAY_MS}`)
    /** 中文说明：变量 pending 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const pending = Promise.withResolvers<IteratorResult<number>>()
    using watchdog = idleWatchdog(undefined, 100, 'IDLE')
    /** 中文说明：函数值 iterator 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const iterator = { next: () => pending.promise }
    void watchdog.next(iterator)
    await expect(watchdog.next(iterator)).rejects.toThrow(/already outstanding/)
    pending.resolve({ done: true, value: undefined })
  })
})
