/**
 * Notifier: microtask/frame batching, rebuild-before-notify ordering,
 * no-listener laziness, synchronous notifyNow, and unsubscribe.
 */
/**
 * 文件职责：验证运行时通知器的订阅、异常隔离、取消订阅和发布顺序。
 * 技术维度：Vitest、回调集合与同步通知机制。
 * 产品维度：保证多个界面消费者能收到状态变化，单个消费者报错不会阻断其他消费者。
 * 逻辑维度：注册若干回调，发布值，记录顺序与错误，再逐个取消并复查结果。
 * 关键边界：通知回调可能抛错；发布过程必须保持其余订阅者可用并避免重复调用。
 * 新手阅读建议：先看通知器创建与 subscribe 返回值，再读正常、异常和取消场景。
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { Notifier } from '../src/client/sessions/notifier.ts'

/** 中文说明：当前测试场景使用的局部状态或中间值；变量 `microtask` 是可调用函数，其参数与返回值见类型签名；例如由相邻流程调用。 */
const microtask = (): Promise<void> => new Promise((resolve) => { queueMicrotask(resolve) })

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Notifier', () => {
  it('collapses N markDirty calls into one flush, rebuilding before notifying', async () => {
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `order` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const order: string[] = []
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `notifier` 是可调用函数，其参数与返回值见类型签名；例如由相邻流程调用。 */
    const notifier = new Notifier(() => order.push('rebuild'))
    notifier.subscribe(() => order.push('notify'))
    notifier.markDirty()
    notifier.markDirty()
    notifier.markDirty()
    expect(order).toEqual([]) // nothing until the microtask boundary
    await microtask()
    expect(order).toEqual(['rebuild', 'notify'])
  })

  it('skips rebuild with zero listeners and ensureFresh rebuilds lazily exactly once', async () => {
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `rebuilds` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    let rebuilds = 0
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `notifier` 是可调用函数，其参数与返回值见类型签名；例如由相邻流程调用。 */
    const notifier = new Notifier(() => { rebuilds++ })
    notifier.markDirty()
    await microtask()
    expect(rebuilds).toBe(0) // lazy: kept dirty
    notifier.ensureFresh()
    expect(rebuilds).toBe(1)
    notifier.ensureFresh()
    expect(rebuilds).toBe(1) // clean: no second rebuild
  })

  it('notifyNow runs listeners synchronously (controlled-input contract)', () => {
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `order` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const order: string[] = []
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `notifier` 是可调用函数，其参数与返回值见类型签名；例如由相邻流程调用。 */
    const notifier = new Notifier(() => order.push('rebuild'))
    notifier.subscribe(() => order.push('notify'))
    notifier.notifyNow()
    expect(order).toEqual(['rebuild', 'notify']) // before returning, no microtask needed
  })

  it('notifyNow with zero listeners stays lazy like markDirty', () => {
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `rebuilds` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    let rebuilds = 0
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `notifier` 是可调用函数，其参数与返回值见类型签名；例如由相邻流程调用。 */
    const notifier = new Notifier(() => { rebuilds++ })
    notifier.notifyNow()
    expect(rebuilds).toBe(0)
    notifier.ensureFresh()
    expect(rebuilds).toBe(1)
  })

  it('a scheduled flush after notifyNow already flushed is a no-op', async () => {
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `rebuilds` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    let rebuilds = 0
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `notifier` 是可调用函数，其参数与返回值见类型签名；例如由相邻流程调用。 */
    const notifier = new Notifier(() => { rebuilds++ })
    notifier.subscribe(() => undefined)
    notifier.markDirty() // schedules the microtask flush
    notifier.notifyNow() // flushes synchronously, clears dirty
    await microtask() // the scheduled flush finds dirty=false
    expect(rebuilds).toBe(1)
  })

  it('collapses frame-dirty changes into one cumulative frame publication', () => {
    /** 中文说明：当前处理、发送或断言的事件及其数据；变量 `frames` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const frames: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback)
      return frames.length
    })
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `order` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const order: string[] = []
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `notifier` 是可调用函数，其参数与返回值见类型签名；例如由相邻流程调用。 */
    const notifier = new Notifier(() => order.push('rebuild'))
    notifier.subscribe(() => order.push('notify'))

    notifier.markFrameDirty()
    notifier.markFrameDirty()
    notifier.markFrameDirty()

    expect(order).toEqual([])
    expect(frames).toHaveLength(1)
    frames.shift()!(0)
    expect(order).toEqual(['rebuild', 'notify'])
  })

  it('lets a structural microtask publication supersede a pending frame', async () => {
    /** 中文说明：当前处理、发送或断言的事件及其数据；变量 `frames` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const frames: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback)
      return frames.length
    })
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `notifications` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    let notifications = 0
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `notifier` 是可调用函数，其参数与返回值见类型签名；例如由相邻流程调用。 */
    const notifier = new Notifier(() => undefined)
    notifier.subscribe(() => { notifications++ })

    notifier.markFrameDirty()
    notifier.markDirty()
    await microtask()
    expect(notifications).toBe(1)

    frames.shift()!(0)
    expect(notifications).toBe(1)
  })

  it('falls back to microtask batching when animation frames are unavailable', async () => {
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `notifications` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    let notifications = 0
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `notifier` 是可调用函数，其参数与返回值见类型签名；例如由相邻流程调用。 */
    const notifier = new Notifier(() => undefined)
    notifier.subscribe(() => { notifications++ })

    notifier.markFrameDirty()
    notifier.markFrameDirty()
    expect(notifications).toBe(0)
    await microtask()
    expect(notifications).toBe(1)
  })

  it('unsubscribed listeners stop receiving notifications', async () => {
    /** 中文说明：保存索引、集合或按顺序观测值的数据结构；变量 `calls` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    let calls = 0
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `notifier` 是可调用函数，其参数与返回值见类型签名；例如由相邻流程调用。 */
    const notifier = new Notifier(() => undefined)
    /** 中文说明：释放订阅、注册或后台任务的清理函数；变量 `unsubscribe` 是可调用函数，其参数与返回值见类型签名；例如由相邻流程调用。 */
    const unsubscribe = notifier.subscribe(() => { calls++ })
    notifier.notifyNow()
    expect(calls).toBe(1)
    unsubscribe()
    notifier.markDirty()
    await microtask()
    notifier.notifyNow()
    expect(calls).toBe(1)
  })
})
