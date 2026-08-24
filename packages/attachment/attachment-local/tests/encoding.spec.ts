/**
 * 文件职责：验证图片编码候选的惰性选择和 CompressionLimiter 的并发队列行为。
 * 技术维度：使用Vitest模拟函数与可控Promise精确观察候选调用次数、活动任务数和失败释放。
 * 产品维度：保证图片转换不会执行不必要的低质量编码，也不会超过部署允许的原生并发数。
 * 逻辑维度：先测试首个合格候选与全部超限结果，再用多个门控任务验证并发槽位和异常恢复。
 * 关键边界：候选列表不能为空；全部失败时返回最小结果供缩放估算；同步抛错也必须释放槽位。
 * 新手阅读建议：先看前三个惰性编码用例，再跟踪gates、active和maximum理解限流器调度。
 */
import { describe, expect, it, vi } from 'vitest'
import { CompressionLimiter } from '../src/compression-limiter.ts'
import { encodeFirstWithinLimit, isExhaustedEncoding } from '../src/encoding.ts'

describe('lazy image encoding', () => {
  it('does not execute fallback qualities after the first fitting candidate', async () => {
    const first = vi.fn(() => Promise.resolve({ data: new Uint8Array(8), quality: 85 }))
    const fallback = vi.fn(() => Promise.resolve({ data: new Uint8Array(4), quality: 80 }))

    await expect(encodeFirstWithinLimit([first, fallback], 8)).resolves.toMatchObject({ quality: 85 })
    expect(first).toHaveBeenCalledTimes(1)
    expect(fallback).not.toHaveBeenCalled()
  })

  it('executes later candidates only after earlier candidates exceed the cap', async () => {
    const first = vi.fn(() => Promise.resolve({ data: new Uint8Array(12), quality: 85 }))
    const second = vi.fn(() => Promise.resolve({ data: new Uint8Array(7), quality: 80 }))
    const third = vi.fn(() => Promise.resolve({ data: new Uint8Array(5), quality: 75 }))

    await expect(encodeFirstWithinLimit([first, second, third], 8)).resolves.toMatchObject({ quality: 80 })
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(1)
    expect(third).not.toHaveBeenCalled()
  })

  it('rejects an empty candidate list and reports the smallest exhausted candidate', async () => {
    await expect(encodeFirstWithinLimit([], 8)).rejects.toThrow('requires at least one candidate')
    const result = await encodeFirstWithinLimit([
      () => Promise.resolve({ data: new Uint8Array(12), quality: 85 }),
      () => Promise.resolve({ data: new Uint8Array(9), quality: 80 }),
      () => Promise.resolve({ data: new Uint8Array(10), quality: 75 }),
    ], 8)

    expect(isExhaustedEncoding(result)).toBe(true)
    expect(result).toMatchObject({ smallest: { quality: 80 } })
    expect(isExhaustedEncoding({ data: new Uint8Array(1) })).toBe(false)
  })
})

describe('CompressionLimiter', () => {
  it('starts at most the configured number of tasks and preserves queued progress', async () => {
    const limiter = new CompressionLimiter(2)
    const gates = Array.from({ length: 4 }, () => Promise.withResolvers<undefined>())
    let active = 0
    let maximum = 0
    const started: number[] = []
    const tasks = gates.map((gate, index) => limiter.run(async () => {
      active += 1
      maximum = Math.max(maximum, active)
      started.push(index)
      await gate.promise
      active -= 1
      return index
    }))

    await Promise.resolve()
    expect(started).toEqual([0, 1])
    gates[0]!.resolve(undefined)
    await tasks[0]
    await Promise.resolve()
    expect(started).toEqual([0, 1, 2])
    gates[1]!.resolve(undefined)
    gates[2]!.resolve(undefined)
    await Promise.all([tasks[1], tasks[2]])
    await Promise.resolve()
    expect(started).toEqual([0, 1, 2, 3])
    gates[3]!.resolve(undefined)

    await expect(Promise.all(tasks)).resolves.toEqual([0, 1, 2, 3])
    expect(maximum).toBe(2)
  })

  it('releases a slot when a task throws before returning a promise', async () => {
    const limiter = new CompressionLimiter(1)
    const failed = limiter.run(() => {
      throw new Error('synchronous setup failure')
    })
    const next = limiter.run(() => Promise.resolve('next'))

    await expect(failed).rejects.toThrow('synchronous setup failure')
    await expect(next).resolves.toBe('next')
  })

  it('normalizes a non-Error rejection and releases its slot', async () => {
    const limiter = new CompressionLimiter(1)
    // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- Native bindings can reject non-Error values.
    const failed = limiter.run(() => Promise.reject('native failure'))
    const next = limiter.run(() => Promise.resolve('next'))

    await expect(failed).rejects.toMatchObject({
      message: 'Image compression task rejected with a non-Error value.',
      cause: 'native failure',
    })
    await expect(next).resolves.toBe('next')
  })
})
