/**
 * 文件职责：验证Hook 线协议的 detached.spec.ts 行为与边界。
 * 技术维度：TypeScript、Cordis、JSON 编解码、子进程、事件匹配和严格联合类型。
 * 产品维度：保证Hook 线协议可预测地传递事件、限制循环或适配外部工具。
 * 逻辑维度：构造事件与配置，驱动入口并断言结果。
 * 关键边界：线协议输入必须校验；外部 Hook 失败不得破坏会话日志或核心循环。
 * 新手阅读建议：先读 types/events，再看 codec/matcher/runner，最后阅读桥接配置。
 */
import { describe, expect, it } from 'vitest'
import { createDetachedRuns } from '@deepseek-ai/dsh-hook-protocol'

/** A promise settled from outside, so a test controls exactly when a tracked run finishes. */
/* 中文说明：函数 deferred 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function deferred(): { promise: Promise<void>; resolve: () => void; reject: (error: Error) => void } {
  /** 中文说明：测试局部值 resolve，由紧邻初始化决定。 */
  let resolve!: () => void
  /** 中文说明：测试局部值 reject，由紧邻初始化决定。 */
  let reject!: (error: Error) => void
  /** 中文说明：测试局部值 promise，由紧邻初始化决定。 */
  const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

describe('createDetachedRuns', () => {
  it('starts with an unfired signal; drain fires it (so still-running hook processes get killed)', async () => {
    /** 中文说明：测试局部值 detached，由紧邻初始化决定。 */
    const detached = createDetachedRuns()
    expect(detached.signal.aborted).toBe(false)
    await detached.drain()
    expect(detached.signal.aborted).toBe(true)
    expect(String(detached.signal.reason)).toContain('hook bridge disposed')
  })

  it('drain with nothing tracked resolves immediately', async () => {
    await expect(createDetachedRuns().drain()).resolves.toBeUndefined()
  })

  it('drain waits for a tracked run to settle', async () => {
    /** 中文说明：测试局部值 detached，由紧邻初始化决定。 */
    const detached = createDetachedRuns()
    /** 中文说明：测试局部值 run，由紧邻初始化决定。 */
    const run = deferred()
    detached.track(run.promise)
    /** 中文说明：测试局部值 drained，由紧邻初始化决定。 */
    let drained = false
    /** 中文说明：测试局部值 draining，由紧邻初始化决定。 */
    const draining = detached.drain().then(() => { drained = true })
    // Give the drain every chance to (wrongly) resolve before the run settles.
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(drained).toBe(false)
    run.resolve()
    await draining
    expect(drained).toBe(true)
  })

  it('drain waits for a run tracked WHILE a prior wave was settling', async () => {
    /** 中文说明：测试局部值 detached，由紧邻初始化决定。 */
    const detached = createDetachedRuns()
    /** 中文说明：测试局部值 first，由紧邻初始化决定。 */
    const first = deferred()
    /** 中文说明：测试局部值 second，由紧邻初始化决定。 */
    const second = deferred()
    detached.track(first.promise)
    // The late run enters the registry from the first run's own continuation —
    // after drain() snapshotted its first wave.
    void first.promise.then(() => { detached.track(second.promise) })
    /** 中文说明：测试局部值 drained，由紧邻初始化决定。 */
    let drained = false
    /** 中文说明：测试局部值 draining，由紧邻初始化决定。 */
    const draining = detached.drain().then(() => { drained = true })
    first.resolve()
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(drained).toBe(false)
    second.resolve()
    await draining
    expect(drained).toBe(true)
  })

  it('a rejected tracked run is absorbed by the settlement bookkeeping (drain still resolves)', async () => {
    /** 中文说明：测试局部值 detached，由紧邻初始化决定。 */
    const detached = createDetachedRuns()
    /** 中文说明：测试局部值 run，由紧邻初始化决定。 */
    const run = deferred()
    detached.track(run.promise)
    // The caller-side handler every bridge attaches; the tracker's own
    // bookkeeping must not depend on it, but an UNHANDLED rejection would fail
    // the test run, which is exactly the guarantee under test.
    run.promise.catch(() => {})
    run.reject(new Error('hook run boom'))
    await expect(detached.drain()).resolves.toBeUndefined()
  })
})
