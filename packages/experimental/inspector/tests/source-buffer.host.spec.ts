/** Worker-side source buffer behavior.
 * @remarks 文件说明：文件职责：验证 experimental/inspector 中 source buffer host spec
 * 相关行为与失败场景。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。；产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。；
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。；
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。 */

import { MessageChannel } from 'node:worker_threads'
import { describe, expect, it, vi } from 'vitest'
import { HostBridgePublisher } from '../src/host/bridge/publisher.ts'
import { inspectorId } from '../src/shared/bridge/ids.ts'
import { InspectorSourceBuffer, type InspectorSourceBufferOptions } from '../src/shared/bridge/buffer.ts'
import type { InspectorSourceDescriptor } from '../src/shared/bridge/messages/observation.ts'

/**
 * 常量说明：sourceId 用于处理 sourceId 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const sourceId = inspectorId<'InspectorSourceId'>('source-buffer-test', 'sourceId')
/**
 * 常量说明：generation 用于处理 generation 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const generation = inspectorId<'InspectorSourceGeneration'>('generation-buffer-test', 'generation')
/**
 * 常量说明：source 用于处理 source 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const source: InspectorSourceDescriptor = {
  sourceId,
  generation,
  kind: 'host',
  label: 'Host',
  timeOriginMs: performance.timeOrigin,
  capabilities: [],
}

/**
 * 功能说明：处理 buffer 相关流程；使用场景由所在模块及调用位置决定。
 * @param maxQueuedRecords （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。
 * @param overrides （Partial<InspectorSourceBufferOptions>）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。
 * @returns InspectorSourceBuffer；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 buffer(maxQueuedRecords, overrides)，并按返回类型处理结果。
 */
function buffer(
  maxQueuedRecords = 2,
  overrides: Partial<InspectorSourceBufferOptions> = {},
): InspectorSourceBuffer {
  return new InspectorSourceBuffer({
    topics: ['*'],
    maxQueuedRecords,
    maxQueuedBytes: 32_768,
    maxRecordsPerFrame: 8,
    maxFrameBytes: 32_768,
    ...overrides,
  })
}

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
describe('Inspector source buffer', () => {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('absorbs pre-replacement queue loss exactly once', () => {
    /**
     * 常量说明：records 用于处理 records 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const records = buffer(1)
    expect(records.replacement(sourceId, generation)).toMatchObject({ nextSequence: 1, records: [] })
    records.publish('test/event', { ordinal: 1 }, 1)
    records.publish('test/event', { ordinal: 2 }, 2)

    expect(records.replacement(sourceId, generation)).toMatchObject({
      nextSequence: 2,
      records: [],
    })
    expect(records.takeBatch(sourceId, generation)).toMatchObject({
      firstSequence: 2,
      droppedBefore: 0,
      records: [{ topic: 'test/event', payload: { ordinal: 2 } }],
    })
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('validates records before either carrier can enqueue them', () => {
    /**
     * 常量说明：records 用于处理 records 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const records = buffer()

    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    expect(() => { records.publish('', {}, 1) }).toThrow('topic must contain 1 to 128 characters')
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    expect(() => { records.publish('x'.repeat(129), {}, 1) }).toThrow('topic must contain 1 to 128 characters')
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    expect(() => { buffer(2, { topics: ['declared'] }).publish('undeclared', {}, 1) })
      .toThrow('source does not declare topic')
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    expect(() => { records.publish('test/event', {}, Number.NaN) }).toThrow('monotonicMs must be finite')
    /**
     * 常量说明：cyclic 用于处理 cyclic 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    expect(() => { records.publish('test/event', cyclic as never, 1) }).toThrow('lossless JSON data')
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('rejects oversized retained state without replacing the previous value', () => {
    /**
     * 常量说明：records 用于处理 records 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const records = buffer(4, { maxFrameBytes: 4_300 })
    records.setState('state', { value: 'kept' }, 1)
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    expect(() => { records.setState('state', { value: 'x'.repeat(1_000) }, 2) })
      .toThrow('source state exceeds the source-frame byte limit')
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    expect(() => { records.setState('other', { value: 'x'.repeat(1_000) }, 3) })
      .toThrow('source state exceeds the source-frame byte limit')
    expect(records.replacement(sourceId, generation).records).toEqual([
      { topic: 'state', payload: { value: 'kept' }, monotonicMs: 1 },
    ])
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('splits frames at record, byte, and sequence gaps and discards pending records', () => {
    /**
     * 常量说明：records 用于处理 records 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const records = buffer(10, { maxRecordsPerFrame: 2, maxFrameBytes: 4_300 })
    expect(records.hasPending).toBe(false)
    records.publish('test/event', { value: 'a'.repeat(40) }, 1)
    records.publish('test/event', { value: 'x'.repeat(1_000) }, 2)
    records.publish('test/event', { value: 'b'.repeat(40) }, 3)
    expect(records.hasPending).toBe(true)

    expect(records.takeBatch(sourceId, generation)).toMatchObject({ firstSequence: 1, records: [{ monotonicMs: 1 }] })
    expect(records.takeBatch(sourceId, generation)).toMatchObject({
      firstSequence: 3,
      droppedBefore: 1,
      records: [{ monotonicMs: 3 }],
    })
    expect(records.takeBatch(sourceId, generation)).toBeUndefined()

    records.publish('test/event', { ordinal: 4 }, 4)
    records.discardPending()
    expect(records.hasPending).toBe(false)

    /**
     * 常量说明：byteSplit 用于处理 byteSplit 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const byteSplit = buffer(10, { maxFrameBytes: 4_300 })
    byteSplit.publish('test/event', { value: 'a'.repeat(100) }, 1)
    byteSplit.publish('test/event', { value: 'b'.repeat(100) }, 2)
    expect(byteSplit.takeBatch(sourceId, generation)?.records).toHaveLength(1)
    expect(byteSplit.takeBatch(sourceId, generation)?.records).toHaveLength(1)
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('drops queued records against the byte limit independently of the item limit', () => {
    /**
     * 常量说明：records 用于处理 records 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const records = buffer(10, { maxQueuedBytes: 120 })
    records.publish('test/event', { value: 'a'.repeat(40) }, 1)
    records.publish('test/event', { value: 'b'.repeat(40) }, 2)

    expect(records.takeBatch(sourceId, generation)).toMatchObject({
      firstSequence: 2,
      droppedBefore: 1,
      records: [{ monotonicMs: 2 }],
    })
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('keeps at most one Host MessagePort observation batch in flight', async () => {
    /**
     * 常量说明：channel 用于处理 channel 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const channel = new MessageChannel()
    /**
     * 常量说明：messages 用于处理 messages 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const messages: unknown[] = []
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：message（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(message)，并按返回类型处理结果。
     */
    channel.port2.on('message', (message) => { messages.push(message) })
    channel.port2.start()
    /**
     * 常量说明：publisher 用于处理 publisher 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const publisher = new HostBridgePublisher(channel.port1, source, {
      topics: ['*'],
      maxQueuedRecords: 2,
      maxQueuedBytes: 32_768,
      maxRecordsPerFrame: 1,
      maxFrameBytes: 32_768,
    })
    try {
      publisher.publish('test/event', { ordinal: 1 })
      publisher.flush()
      publisher.publish('test/event', { ordinal: 2 })
      publisher.publish('test/event', { ordinal: 3 })
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
       */
      await vi.waitFor(() => { expect(messages).toHaveLength(1) })
      /**
       * 常量说明：first 用于处理 first 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const first = messages[0] as { firstSequence: number; records: Array<{ payload: unknown }> }
      expect(first.records).toHaveLength(1)
      expect(first.records[0]?.payload).toEqual({ ordinal: 1 })

      publisher.acknowledge(first.firstSequence + first.records.length)
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
       */
      await vi.waitFor(() => { expect(messages).toHaveLength(2) })
      /**
       * 常量说明：second 用于处理 second 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const second = messages[1] as { firstSequence: number; droppedBefore: number; records: Array<{ payload: unknown }> }
      expect(second).toMatchObject({
        firstSequence: 2,
        droppedBefore: 0,
        records: [{ payload: { ordinal: 2 } }],
      })
      publisher.acknowledge(second.firstSequence + second.records.length)
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
       */
      await vi.waitFor(() => { expect(messages).toHaveLength(3) })
      expect(messages[2]).toMatchObject({
        firstSequence: 3,
        records: [{ payload: { ordinal: 3 } }],
      })
    } finally {
      publisher.close()
      channel.port1.close()
      channel.port2.close()
    }
  })
})
