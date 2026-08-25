/**
 * 文件职责：验证 write-behind.spec.ts 覆盖的会话持久化行为、持久化与生命周期。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、事件日志、SQLite 或 OpenTelemetry。
 * 产品维度：保障 Agent 的会话持久化状态稳定、可重放且可诊断。
 * 逻辑维度：准备或解析会话数据，执行核心流程，再处理结果、错误与资源清理。
 * 关键边界：持久化和遥测输入不可信；敏感数据必须脱敏；事件与数据库资源必须正确收尾。
 * 新手阅读建议：先看数据类型和辅助函数，再读写入/投影主流程，最后关注恢复、脱敏和失败场景。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { SessionWriteBehind } from '../src/write-behind.ts'

/** Minimal ordered event fixture; batching does not interpret event vocabulary. */
/** 中文说明：函数 event 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function event(seq: number): SessionEvent<'turn/start'> {
  return {
    type: 'turn/start',
    seq,
    time: seq,
    data: { turn: seq + 1 },
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('SessionWriteBehind', () => {
  it('uses one fixed window from the first queued event and owns its copy', async () => {
    vi.useFakeTimers()
    /** 中文说明：变量 batches 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const batches: SessionEvent[][] = []
    /** 中文说明：变量 controller 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const controller = new SessionWriteBehind({
      maxDelayMs: 200,
      write: async (events) => { batches.push(structuredClone(events) as SessionEvent[]) },
      reportBackgroundFailure: vi.fn(),
    })
    /** 中文说明：变量 first 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const first = event(0)

    controller.enqueue(first)
    first.data.turn = 99
    await vi.advanceTimersByTimeAsync(150)
    controller.enqueue(event(1))
    await vi.advanceTimersByTimeAsync(49)
    expect(batches).toEqual([])

    await vi.advanceTimersByTimeAsync(1)
    expect(batches).toEqual([[
      expect.objectContaining({ seq: 0, data: { turn: 1 } }),
      expect.objectContaining({ seq: 1 }),
    ]])
    expect(controller.hasWork).toBe(false)
  })

  it('coalesces twenty events admitted ten milliseconds apart into one 200 ms batch', async () => {
    vi.useFakeTimers()
    /** 中文说明：变量 batches 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const batches: number[][] = []
    /** 中文说明：变量 controller 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const controller = new SessionWriteBehind({
      maxDelayMs: 200,
      write: async (events) => { batches.push(events.map(item => item.seq)) },
      reportBackgroundFailure: vi.fn(),
    })

    controller.enqueue(event(0))
    /** 中文说明：该循环依次处理会话数据；循环变量仅在当前循环中有效。 */
    for (let seq = 1; seq < 20; seq += 1) {
      await vi.advanceTimersByTimeAsync(10)
      controller.enqueue(event(seq))
    }
    expect(batches).toEqual([])

    await vi.advanceTimersByTimeAsync(10)
    expect(batches).toEqual([Array.from({ length: 20 }, (_, seq) => seq)])
    await controller.flush()
  })

  it('makes concurrent flushes one immediate barrier that drains admitted tails', async () => {
    vi.useFakeTimers()
    /** 中文说明：变量 gate 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const gate = Promise.withResolvers<boolean>()
    /** 中文说明：变量 batches 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const batches: number[][] = []
    /** 中文说明：变量 controller 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const controller = new SessionWriteBehind({
      maxDelayMs: 200,
      write: async (events) => {
        batches.push(events.map(item => item.seq))
        if (batches.length === 1) await gate.promise
      },
      reportBackgroundFailure: vi.fn(),
    })

    controller.enqueue(event(0))
    /** 中文说明：变量 first 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const first = controller.flush()
    /** 中文说明：变量 second 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const second = controller.flush()
    expect(second).toBe(first)
    await Promise.resolve()
    expect(batches).toEqual([[0]])

    controller.enqueue(event(1))
    gate.resolve(true)
    await first
    expect(batches).toEqual([[0], [1]])
    expect(controller.hasWork).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('starts a new window for work admitted after an already-quiescent barrier', async () => {
    vi.useFakeTimers()
    /** 中文说明：变量 batches 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const batches: number[][] = []
    /** 中文说明：变量 controller 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const controller = new SessionWriteBehind({
      maxDelayMs: 200,
      write: async (events) => { batches.push(events.map(item => item.seq)) },
      reportBackgroundFailure: vi.fn(),
    })

    /** 中文说明：变量 barrier 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const barrier = controller.flush()
    controller.enqueue(event(0))
    await barrier
    expect(batches).toEqual([])
    expect(vi.getTimerCount()).toBe(1)

    await vi.advanceTimersByTimeAsync(200)
    expect(batches).toEqual([[0]])
    expect(controller.hasWork).toBe(false)
  })

  it('starts an over-budget tail immediately after the active write', async () => {
    vi.useFakeTimers()
    /** 中文说明：变量 gate 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const gate = Promise.withResolvers<boolean>()
    /** 中文说明：变量 batches 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const batches: number[][] = []
    /** 中文说明：变量 controller 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const controller = new SessionWriteBehind({
      maxDelayMs: 200,
      write: async (events) => {
        batches.push(events.map(item => item.seq))
        if (batches.length === 1) await gate.promise
      },
      reportBackgroundFailure: vi.fn(),
    })

    controller.enqueue(event(0))
    await vi.advanceTimersByTimeAsync(200)
    expect(batches).toEqual([[0]])
    controller.enqueue(event(1))
    await vi.advanceTimersByTimeAsync(200)
    expect(batches).toEqual([[0]])

    gate.resolve(true)
    await vi.advanceTimersByTimeAsync(0)
    expect(batches).toEqual([[0], [1]])
    await controller.flush()
  })

  it('keeps a tail deadline that has not expired when the active write finishes', async () => {
    vi.useFakeTimers()
    /** 中文说明：变量 gate 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const gate = Promise.withResolvers<boolean>()
    /** 中文说明：变量 batches 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const batches: number[][] = []
    /** 中文说明：变量 controller 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const controller = new SessionWriteBehind({
      maxDelayMs: 200,
      write: async (events) => {
        batches.push(events.map(item => item.seq))
        if (batches.length === 1) await gate.promise
      },
      reportBackgroundFailure: vi.fn(),
    })

    controller.enqueue(event(0))
    await vi.advanceTimersByTimeAsync(200)
    controller.enqueue(event(1))
    await vi.advanceTimersByTimeAsync(50)
    gate.resolve(true)
    await vi.advanceTimersByTimeAsync(0)
    expect(batches).toEqual([[0]])

    await vi.advanceTimersByTimeAsync(149)
    expect(batches).toEqual([[0]])
    await vi.advanceTimersByTimeAsync(1)
    expect(batches).toEqual([[0], [1]])
    await controller.flush()
  })

  it('pauses automatic retries after failure and preserves order for new work', async () => {
    vi.useFakeTimers()
    /** 中文说明：变量 failure 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const failure = new Error('storage unavailable')
    /** 中文说明：变量 report 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const report = vi.fn()
    /** 中文说明：变量 batches 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const batches: number[][] = []
    /** 中文说明：变量 attempt 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let attempt = 0
    /** 中文说明：变量 controller 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const controller = new SessionWriteBehind({
      maxDelayMs: 200,
      write: async (events) => {
        batches.push(events.map(item => item.seq))
        if (++attempt === 1) throw failure
      },
      reportBackgroundFailure: report,
    })

    controller.enqueue(event(0))
    await vi.advanceTimersByTimeAsync(200)
    expect(report).toHaveBeenCalledWith(failure)
    expect(controller.hasWork).toBe(true)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(batches).toEqual([[0]])

    controller.enqueue(event(1))
    await vi.advanceTimersByTimeAsync(199)
    expect(batches).toEqual([[0]])
    await vi.advanceTimersByTimeAsync(1)
    expect(batches).toEqual([[0], [0, 1]])
    await controller.flush()
  })

  it('observes an overlapping background failure and retries it inside flush', async () => {
    vi.useFakeTimers()
    /** 中文说明：变量 gate 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const gate = Promise.withResolvers<boolean>()
    /** 中文说明：变量 report 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const report = vi.fn()
    /** 中文说明：变量 batches 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const batches: number[][] = []
    /** 中文说明：变量 controller 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const controller = new SessionWriteBehind({
      maxDelayMs: 200,
      write: async (events) => {
        batches.push(events.map(item => item.seq))
        if (batches.length === 1) {
          await gate.promise
          throw new Error('transient')
        }
      },
      reportBackgroundFailure: report,
    })

    controller.enqueue(event(0))
    await vi.advanceTimersByTimeAsync(200)
    /** 中文说明：变量 first 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const first = controller.flush()
    /** 中文说明：变量 second 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const second = controller.flush()
    gate.resolve(true)

    await expect(Promise.all([first, second])).resolves.toEqual([undefined, undefined])
    expect(batches).toEqual([[0], [0]])
    expect(report).toHaveBeenCalledOnce()
    expect(controller.hasWork).toBe(false)
  })

  it('surfaces a barrier failure without detached logging and retains its batch', async () => {
    vi.useFakeTimers()
    /** 中文说明：变量 failure 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const failure = new Error('durability failed')
    /** 中文说明：变量 report 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const report = vi.fn()
    /** 中文说明：变量 batches 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const batches: number[][] = []
    /** 中文说明：变量 attempt 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let attempt = 0
    /** 中文说明：变量 controller 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const controller = new SessionWriteBehind({
      maxDelayMs: 200,
      write: async (events) => {
        batches.push(events.map(item => item.seq))
        if (++attempt === 1) throw failure
      },
      reportBackgroundFailure: report,
    })

    controller.enqueue(event(0))
    await expect(controller.flush()).rejects.toBe(failure)
    expect(report).not.toHaveBeenCalled()
    expect(controller.hasWork).toBe(true)

    controller.enqueue(event(1))
    await vi.advanceTimersByTimeAsync(200)
    expect(batches).toEqual([[0], [0, 1]])
    await controller.flush()
  })

  it('retains a failed batch larger than the engine call-argument limit', async () => {
    /** 中文说明：变量 failure 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const failure = new Error('durability failed')
    /** 中文说明：变量 batchSize 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const batchSize = 150_000
    /** 中文说明：变量 sizes 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const sizes: number[] = []
    /** 中文说明：变量 attempt 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let attempt = 0
    /** 中文说明：变量 controller 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const controller = new SessionWriteBehind({
      maxDelayMs: 200,
      write: async (events) => {
        sizes.push(events.length)
        if (++attempt === 1) throw failure
      },
      reportBackgroundFailure: vi.fn(),
    })

    /** 中文说明：该循环依次处理会话数据；循环变量仅在当前循环中有效。 */
    for (let seq = 0; seq < batchSize; seq += 1) controller.enqueue(event(seq))
    await expect(controller.flush()).rejects.toBe(failure)
    expect(controller.hasWork).toBe(true)

    await controller.flush()
    expect(sizes).toEqual([batchSize, batchSize])
    expect(controller.hasWork).toBe(false)
  })
})
