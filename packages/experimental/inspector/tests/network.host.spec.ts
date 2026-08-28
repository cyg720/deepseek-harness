/** Worker-side Network projection behavior.
 * @remarks 文件说明：文件职责：验证 experimental/inspector 中 network host spec
 * 相关行为与失败场景。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。；产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。；
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。；
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。 */

import { describe, expect, it, vi } from 'vitest'
import { NetworkDomain, type NetworkSink } from '../src/worker/cdp/domains/network/session.ts'
import { NetworkStore } from '../src/worker/inspection/network-store.ts'
import { inspectorId } from '../src/shared/bridge/ids.ts'
import type { InspectorSourceDescriptor } from '../src/shared/bridge/messages/observation.ts'
import type { IngestedInspectorRecord } from '../src/worker/bridge/hub.ts'
import type { InspectorJsonValue } from '../src/shared/json.ts'

/**
 * 常量说明：source 用于处理 source 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const source: InspectorSourceDescriptor = {
  sourceId: inspectorId<'InspectorSourceId'>('host-network', 'sourceId'),
  generation: inspectorId<'InspectorSourceGeneration'>('network-generation', 'generation'),
  kind: 'host',
  label: 'Host',
  timeOriginMs: performance.timeOrigin,
  capabilities: [],
}

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
describe('Inspector Network domain', () => {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('bounds incomplete bodies and marks the retained prefix truncated', () => {
    /**
     * 常量说明：sendEvent 用于处理 sendEvent 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const sendEvent = vi.fn()
    /**
     * 常量说明：sink 用于处理 sink 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const sink: NetworkSink = { sendEvent }
    /**
     * 常量说明：store 用于处理 store 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const store = new NetworkStore({ maxRetainedRequests: 10, maxJournalBytes: 4 })
    /**
     * 常量说明：network 用于处理 network 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const network = new NetworkDomain(store)
    network.enable(sink)
    store.append(source, requestRecords('first', 'abcdef'))

    /**
     * 常量说明：response 用于处理 response 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const response = network.handle('Network.getResponseBody', { requestId: requestId('first') }, sink)
    expect(response).toEqual({
      body: Buffer.from('abcd').toString('base64'),
      base64Encoded: true,
      dshInspectorTruncated: true,
    })
    /**
     * 常量说明：dataEvent 用于处理 dataEvent 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：call（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(call)，并按返回类型处理结果。
     */
    const dataEvent = sendEvent.mock.calls.find(call => call[0] === 'Network.dataReceived')
    expect(dataEvent?.[1]).toMatchObject({ dataLength: 6, encodedDataLength: 6 })
    expect(dataEvent?.[1]).not.toHaveProperty('data')
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('evicts completed requests before retaining a later body', () => {
    /**
     * 常量说明：sink 用于处理 sink 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const sink: NetworkSink = { sendEvent: vi.fn() }
    /**
     * 常量说明：store 用于处理 store 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const store = new NetworkStore({ maxRetainedRequests: 10, maxJournalBytes: 4 })
    /**
     * 常量说明：network 用于处理 network 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const network = new NetworkDomain(store)
    store.append(source, requestRecords('first', 'aaaa'))
    store.append(source, requestRecords('second', 'bbbb'))

    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    expect(() => network.handle('Network.getResponseBody', { requestId: requestId('first') }, sink)).toThrow(
      'No resource with given identifier',
    )
    expect(network.handle('Network.getResponseBody', { requestId: requestId('second') }, sink)).toEqual({
      body: Buffer.from('bbbb').toString('base64'),
      base64Encoded: true,
      dshInspectorTruncated: false,
    })
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('streams later response chunks only to CDP sessions that opted in', () => {
    /**
     * 常量说明：firstSend 用于处理 firstSend 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const firstSend = vi.fn()
    /**
     * 常量说明：secondSend 用于处理 secondSend 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const secondSend = vi.fn()
    /**
     * 常量说明：first 用于处理 first 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const first: NetworkSink = { sendEvent: firstSend }
    /**
     * 常量说明：second 用于处理 second 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const second: NetworkSink = { sendEvent: secondSend }
    /**
     * 常量说明：store 用于处理 store 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const store = new NetworkStore({ maxRetainedRequests: 10, maxJournalBytes: 1_024 })
    /**
     * 常量说明：network 用于处理 network 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const network = new NetworkDomain(store)
    network.enable(first)
    network.enable(second)
    /**
     * 常量说明：records 用于处理 records 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const records = requestRecords('stream', 'data: first\n\n')
    store.append(source, records.slice(0, 2))

    expect(network.handle('Network.streamResourceContent', { requestId: requestId('stream') }, first)).toEqual({
      bufferedData: '',
    })
    store.append(source, records.slice(2, 3))

    /**
     * 常量说明：firstData 用于处理 firstData 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：call（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(call)，并按返回类型处理结果。
     */
    const firstData = firstSend.mock.calls.findLast(call => call[0] === 'Network.dataReceived')
    /**
     * 常量说明：secondData 用于处理 secondData 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：call（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(call)，并按返回类型处理结果。
     */
    const secondData = secondSend.mock.calls.findLast(call => call[0] === 'Network.dataReceived')
    expect(firstData?.[1]).toMatchObject({ data: Buffer.from('data: first\n\n').toString('base64') })
    expect(secondData?.[1]).not.toHaveProperty('data')
    expect(network.handle('Network.streamResourceContent', { requestId: requestId('stream') }, second)).toEqual({
      bufferedData: Buffer.from('data: first\n\n').toString('base64'),
    })

    /**
     * 常量说明：later 用于处理 later 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const later = Buffer.from('data: second\n\n').toString('base64')
    store.append(source, [{
      sequence: 4,
      monotonicMs: 4,
      topic: 'fetch/response-body-chunk',
      payload: { requestId: 'stream', data: later },
    }])
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：call（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(call)，并按返回类型处理结果。
     */
    expect(firstSend.mock.calls.findLast(call => call[0] === 'Network.dataReceived')?.[1]).toMatchObject({ data: later })
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：call（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(call)，并按返回类型处理结果。
     */
    expect(secondSend.mock.calls.findLast(call => call[0] === 'Network.dataReceived')?.[1]).toMatchObject({ data: later })
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('projects and replays parsed Server-Sent Events through the CDP EventSource path', () => {
    /**
     * 常量说明：liveSend 用于处理 liveSend 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const liveSend = vi.fn()
    /**
     * 常量说明：store 用于处理 store 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const store = new NetworkStore({ maxRetainedRequests: 10, maxJournalBytes: 1_024 })
    /**
     * 常量说明：network 用于处理 network 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const network = new NetworkDomain(store)
    network.enable({ sendEvent: liveSend })
    store.append(source, eventStreamRecords('events'))

    expect(liveSend).toHaveBeenNthCalledWith(1, 'Network.requestWillBeSent', expect.objectContaining({
      type: 'EventSource',
    }))
    expect(liveSend).toHaveBeenCalledWith('Network.responseReceived', expect.objectContaining({
      type: 'EventSource',
    }))
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：call（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(call)，并按返回类型处理结果。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：call（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(call)，并按返回类型处理结果。
     */
    expect(liveSend.mock.calls
      .filter(call => call[0] === 'Network.eventSourceMessageReceived')
      .map(call => call[1] as unknown))
      .toEqual([
        expect.objectContaining({ eventName: 'message', eventId: '1', data: 'first' }),
        expect.objectContaining({ eventName: 'update', eventId: '2', data: 'second\nline' }),
      ])
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：call（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(call)，并按返回类型处理结果。
     */
    expect(liveSend.mock.calls.map(call => String(call[0]))).toEqual([
      'Network.requestWillBeSent',
      'Network.responseReceived',
      'Network.eventSourceMessageReceived',
      'Network.dataReceived',
      'Network.eventSourceMessageReceived',
      'Network.dataReceived',
      'Network.loadingFinished',
    ])

    /**
     * 常量说明：replay 用于处理 replay 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const replay = vi.fn()
    network.enable({ sendEvent: replay })
    expect(replay).toHaveBeenNthCalledWith(1, 'Network.requestWillBeSent', expect.objectContaining({
      type: 'EventSource',
    }))
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：call（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(call)，并按返回类型处理结果。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：call（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(call)，并按返回类型处理结果。
     */
    expect(replay.mock.calls
      .filter(call => call[0] === 'Network.eventSourceMessageReceived')
      .map(call => call[1] as unknown))
      .toEqual([
        expect.objectContaining({ timestamp: 0.003, eventName: 'message', eventId: '1', data: 'first' }),
        expect.objectContaining({ timestamp: 0.004, eventName: 'update', eventId: '2', data: 'second\nline' }),
      ])
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：call（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(call)，并按返回类型处理结果。
     */
    expect(replay.mock.calls.map(call => String(call[0]))).toEqual([
      'Network.requestWillBeSent',
      'Network.responseReceived',
      'Network.eventSourceMessageReceived',
      'Network.eventSourceMessageReceived',
      'Network.loadingFinished',
    ])
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('bounds active request metadata and does not retain per-chunk events for replay', () => {
    /**
     * 常量说明：firstSend 用于处理 firstSend 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const firstSend = vi.fn()
    /**
     * 常量说明：store 用于处理 store 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const store = new NetworkStore({ maxRetainedRequests: 1, maxJournalBytes: 1_024 })
    /**
     * 常量说明：network 用于处理 network 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const network = new NetworkDomain(store)
    network.enable({ sendEvent: firstSend })
    store.append(source, requestRecords('active-first', 'first').slice(0, 1))
    store.append(source, requestRecords('active-second', 'second').slice(0, 1))

    expect(firstSend).toHaveBeenCalledWith('Network.loadingFailed', expect.objectContaining({
      requestId: requestId('active-first'),
      canceled: true,
    }))
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    expect(() => network.handle(
      'Network.getRequestPostData',
      { requestId: requestId('active-first') },
      { sendEvent: vi.fn() },
    )).toThrow('No resource with given identifier')
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    expect(() => { store.append(source, requestRecords('active-first', 'first').slice(1)) }).not.toThrow()

    store.append(source, requestRecords('active-second', 'second').slice(1))
    /**
     * 常量说明：replay 用于处理 replay 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const replay = vi.fn()
    network.enable({ sendEvent: replay })
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：call（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(call)，并按返回类型处理结果。
     */
    expect(replay.mock.calls.some(call => call[0] === 'Network.dataReceived')).toBe(false)
    expect(replay).toHaveBeenCalledTimes(3)
    expect(replay).toHaveBeenNthCalledWith(1, 'Network.requestWillBeSent', expect.any(Object))
    expect(replay).toHaveBeenNthCalledWith(2, 'Network.responseReceived', expect.any(Object))
    expect(replay).toHaveBeenNthCalledWith(3, 'Network.loadingFinished', expect.any(Object))
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('finishes a response whose observer clone ended with a capture error', () => {
    /**
     * 常量说明：sendEvent 用于处理 sendEvent 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const sendEvent = vi.fn()
    /**
     * 常量说明：store 用于处理 store 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const store = new NetworkStore({ maxRetainedRequests: 10, maxJournalBytes: 1_024 })
    /**
     * 常量说明：network 用于处理 network 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const network = new NetworkDomain(store)
    network.enable({ sendEvent })
    /**
     * 常量说明：records 用于处理 records 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const records = requestRecords('capture-error', 'partial')
    store.append(source, [
      ...records.slice(0, 3),
      {
        sequence: 4,
        monotonicMs: 4,
        topic: 'fetch/end',
        payload: {
          requestId: 'capture-error',
          capturedBytes: 7,
          responseBodyTruncated: true,
          responseCaptureError: 'AbortError: aborted',
        },
      },
    ])

    expect(sendEvent).toHaveBeenCalledWith('Network.loadingFinished', expect.objectContaining({
      requestId: requestId('capture-error'),
      encodedDataLength: 7,
      dshInspectorTruncated: true,
    }))
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：call（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(call)，并按返回类型处理结果。
     */
    expect(sendEvent.mock.calls.some(call => call[0] === 'Network.loadingFailed')).toBe(false)
    expect(network.handle('Network.getResponseBody', { requestId: requestId('capture-error') }, { sendEvent: vi.fn() }))
      .toMatchObject({
        body: Buffer.from('partial').toString('base64'),
        dshInspectorTruncated: true,
        dshInspectorCaptureError: 'AbortError: aborted',
      })
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('marks a failure after response headers truncated with the transport error', () => {
    /**
     * 常量说明：store 用于处理 store 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const store = new NetworkStore({ maxRetainedRequests: 10, maxJournalBytes: 1_024 })
    /**
     * 常量说明：observed 用于处理 observed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const observed: unknown[] = []
    /**
     * 常量说明：unsubscribe 用于处理 unsubscribe 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：event（由 TypeScript
     * 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(event)，并按返回类型处理结果。
     */
    const unsubscribe = store.subscribe((event) => { observed.push(event) })
    store.append(source, [
      ...requestRecords('midstream', 'partial').slice(0, 3),
      {
        sequence: 4,
        monotonicMs: 4,
        topic: 'fetch/error',
        payload: { requestId: 'midstream', message: 'socket reset', canceled: false },
      },
    ])

    expect(store.responseBody(requestId('midstream'))).toMatchObject({
      bytes: Buffer.from('partial'),
      truncated: true,
      captureError: 'socket reset',
      complete: true,
    })
    expect(observed.at(-1)).toMatchObject({ type: 'request-failed', errorText: 'socket reset', canceled: false })
    unsubscribe()
    store.dispose()
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('retains request capture metadata and isolates malformed observations', () => {
    /**
     * 常量说明：store 用于处理 store 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const store = new NetworkStore({ maxRetainedRequests: 10, maxJournalBytes: 1_024 })
    /**
     * 常量说明：observed 用于处理 observed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const observed: unknown[] = []
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    store.subscribe(() => { throw new Error('broken observer') })
    /**
     * 常量说明：unsubscribe 用于处理 unsubscribe 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：event（由 TypeScript
     * 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(event)，并按返回类型处理结果。
     */
    const unsubscribe = store.subscribe((event) => { observed.push(event) })
    /**
     * 常量说明：start 用于启动 start 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const start = requestRecords('metadata', 'response')[0]!
    store.append(source, [
      { ...start, topic: 'ignored/topic' },
      { ...start, payload: null },
      start,
      start,
      { sequence: 2, monotonicMs: 2, topic: 'fetch/request-body-chunk', payload: { requestId: 'metadata', data: Buffer.from('body').toString('base64') } },
      { sequence: 3, monotonicMs: 3, topic: 'fetch/request-body-end', payload: { requestId: 'metadata', truncated: true, captureError: 'request capture failed' } },
    ])
    expect(store.requestBody(requestId('metadata'))).toMatchObject({
      bytes: Buffer.from('body'),
      truncated: true,
      captureError: 'request capture failed',
      complete: false,
    })
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    expect(() => store.responseBody(requestId('metadata'))).toThrow('response headers have not arrived')

    store.append(source, [
      requestRecords('metadata', 'response')[1]!,
      requestRecords('metadata', 'response')[2]!,
      {
        sequence: 4,
        monotonicMs: 4,
        topic: 'fetch/end',
        payload: {
          requestId: 'metadata',
          capturedBytes: 8,
          responseBodyTruncated: true,
          responseCaptureError: 'response capture failed',
        },
      },
      {
        sequence: 5,
        monotonicMs: 5,
        topic: 'fetch/error',
        payload: { requestId: 'metadata', message: 'late failure', canceled: false },
      },
    ])
    expect(store.responseBody(requestId('metadata'))).toMatchObject({
      bytes: Buffer.from('response'),
      truncated: true,
      captureError: 'response capture failed',
      complete: true,
    })
    expect(observed).toHaveLength(4)
    unsubscribe()
    store.dispose()
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    expect(() => store.requestBody(requestId('metadata'))).toThrow('No resource with given identifier')
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    expect(() => store.requestBody(1)).toThrow('Network requestId must be a string')
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('closes only active requests from the selected source and supports replacement', () => {
    /**
     * 常量说明：store 用于处理 store 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const store = new NetworkStore({ maxRetainedRequests: 10, maxJournalBytes: 1_024 })
    /**
     * 常量说明：observed 用于处理 observed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const observed: Array<{ type: string; requestId?: string }> = []
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：event（由 TypeScript
     * 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(event)，并按返回类型处理结果。
     */
    store.subscribe((event) => { observed.push(event) })
    /**
     * 常量说明：clientSource 用于处理 clientSource 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const clientSource: InspectorSourceDescriptor = {
      ...source,
      sourceId: inspectorId<'InspectorSourceId'>('other-network', 'sourceId'),
      generation: inspectorId<'InspectorSourceGeneration'>('other-generation', 'generation'),
      kind: 'client',
    }
    store.append(source, requestRecords('complete', 'done'))
    store.append(source, requestRecords('active', 'partial').slice(0, 3))
    store.append(clientSource, requestRecords('other', 'partial').slice(0, 3))

    store.close(source, 'source closed')
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：event（由 TypeScript
     * 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(event)，并按返回类型处理结果。
     */
    expect(observed.filter(event => event.type === 'request-failed')).toEqual([
      expect.objectContaining({ requestId: requestId('active') }),
    ])
    store.close(source, 'source closed again')
    store.replace(clientSource, [])
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：event（由 TypeScript
     * 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(event)，并按返回类型处理结果。
     */
    expect(observed.filter(event => event.type === 'request-failed')).toHaveLength(2)
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('rejects malformed fetch fields without losing later valid records', () => {
    /**
     * 常量说明：store 用于处理 store 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const store = new NetworkStore({ maxRetainedRequests: 20, maxJournalBytes: 1_024 })
    /**
     * 常量说明：validStart 用于处理 validStart 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const validStart = requestRecords('valid', 'ok')[0]!
    /**
     * 常量说明：malformed 用于处理 malformed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const malformed: IngestedInspectorRecord[] = [
      { ...validStart, payload: null },
      { ...validStart, payload: { ...validStart.payload as object, requestId: 1 } },
      { ...validStart, payload: { ...validStart.payload as object, wallTimeMs: Number.POSITIVE_INFINITY } },
      { ...validStart, payload: { ...validStart.payload as object, headers: {} } },
      { ...validStart, payload: { ...validStart.payload as object, headers: [[1, 'value']] } },
      { ...validStart, payload: { ...validStart.payload as object, hasBody: 'yes' } },
    ]
    store.append(source, [...malformed, validStart])
    /**
     * 常量说明：invalidPayloads 用于处理 invalidPayloads 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const invalidPayloads: InspectorJsonValue[] = [
      { requestId: 'valid', data: '' },
      { requestId: 'valid', data: 'abc' },
      { requestId: 'valid', data: '!!!!' },
      { requestId: 'valid', data: 'ZE==' },
    ]
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：payload（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：index（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(payload, index)，
     * 并按返回类型处理结果。
     */
    store.append(source, invalidPayloads.map((payload, index) => ({
      sequence: index + 2,
      monotonicMs: index + 2,
      topic: 'fetch/request-body-chunk',
      payload,
    })))
    store.append(source, [
      { sequence: 10, monotonicMs: 10, topic: 'fetch/request-body-end', payload: { requestId: 'valid', truncated: 'yes' } },
      { sequence: 11, monotonicMs: 11, topic: 'fetch/request-body-end', payload: { requestId: 'valid', truncated: false, captureError: 1 } },
      { sequence: 12, monotonicMs: 12, topic: 'fetch/response', payload: { requestId: 'valid', url: 'https://example.test', status: '200', statusText: 'OK', headers: [], mimeType: 'text/plain' } },
      { sequence: 13, monotonicMs: 13, topic: 'fetch/response', payload: { requestId: 'valid', url: 'https://example.test', status: 200, statusText: 'OK', headers: [['bad']], mimeType: 'text/plain' } },
      requestRecords('valid', 'ok')[1]!,
      requestRecords('valid', 'ok')[2]!,
      requestRecords('valid', 'ok')[3]!,
      requestRecords('valid', 'ok')[3]!,
    ])

    expect(store.responseBody(requestId('valid')).bytes).toEqual(Buffer.from('ok'))

    /**
     * 常量说明：failedStart 用于处理 failedStart 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const failedStart = requestRecords('failed-before-response', '')[0]!
    store.append(source, [failedStart, {
      sequence: 20,
      monotonicMs: 20,
      topic: 'fetch/error',
      payload: { requestId: 'failed-before-response', message: 'connection failed', canceled: false },
    }])
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('tracks zero-byte truncation and evicts a completed request before an active request', () => {
    /**
     * 常量说明：store 用于处理 store 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const store = new NetworkStore({ maxRetainedRequests: 1, maxJournalBytes: 1 })
    store.append(source, requestRecords('completed', 'a'))
    /**
     * 常量说明：active 用于处理 active 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const active = requestRecords('active', 'bc')
    store.append(source, [
      active[0]!,
      {
        sequence: 2,
        monotonicMs: 2,
        topic: 'fetch/request-body-chunk',
        payload: { requestId: 'active', data: Buffer.from('x').toString('base64') },
      },
      active[1]!,
      active[2]!,
    ])

    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    expect(() => store.requestBody(requestId('completed'))).toThrow('No resource with given identifier')
    expect(store.responseBody(requestId('active'))).toMatchObject({
      bytes: Buffer.alloc(0),
      truncated: true,
      complete: false,
    })

    store.append(source, [{
      sequence: 4,
      monotonicMs: 4,
      topic: 'fetch/request-body-chunk',
      payload: { requestId: 'active', data: Buffer.from('d').toString('base64') },
    }])
    expect(store.requestBody(requestId('active'))).toMatchObject({ bytes: Buffer.from('x'), truncated: true })
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('rejects a non-list header field without dropping the active request', () => {
    /**
     * 常量说明：store 用于处理 store 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const store = new NetworkStore({ maxRetainedRequests: 10, maxJournalBytes: 1_024 })
    /**
     * 常量说明：start 用于启动 start 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const start = requestRecords('headers', 'ok')[0]!
    store.append(source, [{ ...start, payload: { ...start.payload as object, headers: null } }, start])

    expect(store.requestBody(requestId('headers')).complete).toBe(false)
  })
})

/**
 * 功能说明：处理 requestRecords 相关流程；使用场景由所在模块及调用位置决定。
 * @param localId （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param body （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns IngestedInspectorRecord[]；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 requestRecords(localId, body)，并按返回类型处理结果。
 */
function requestRecords(localId: string, body: string): IngestedInspectorRecord[] {
  return [
    {
      sequence: 1,
      monotonicMs: 1,
      topic: 'fetch/start',
      payload: { requestId: localId, url: 'https://example.test/', method: 'GET', headers: [], hasBody: false, wallTimeMs: 1 },
    },
    {
      sequence: 2,
      monotonicMs: 2,
      topic: 'fetch/response',
      payload: { requestId: localId, url: 'https://example.test/', status: 200, statusText: 'OK', headers: [], mimeType: 'text/plain' },
    },
    {
      sequence: 3,
      monotonicMs: 3,
      topic: 'fetch/response-body-chunk',
      payload: { requestId: localId, data: Buffer.from(body).toString('base64') },
    },
    {
      sequence: 4,
      monotonicMs: 4,
      topic: 'fetch/end',
      payload: { requestId: localId, capturedBytes: body.length, responseBodyTruncated: false },
    },
  ]
}

/**
 * 功能说明：处理 eventStreamRecords 相关流程；使用场景由所在模块及调用位置决定。
 * @param localId （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns IngestedInspectorRecord[]；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 eventStreamRecords(localId)，并按返回类型处理结果。
 */
function eventStreamRecords(localId: string): IngestedInspectorRecord[] {
  /**
   * 常量说明：first 用于处理 first 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const first = 'id: 1\ndata: first\n\n'
  /**
   * 常量说明：second 用于处理 second 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const second = 'id: 2\nevent: update\ndata: second\ndata: line\n\n'
  return [
    {
      sequence: 1,
      monotonicMs: 1,
      topic: 'fetch/start',
      payload: { requestId: localId, url: 'https://example.test/events', method: 'GET', headers: [], hasBody: false, wallTimeMs: 1 },
    },
    {
      sequence: 2,
      monotonicMs: 2,
      topic: 'fetch/response',
      payload: {
        requestId: localId,
        url: 'https://example.test/events',
        status: 200,
        statusText: 'OK',
        headers: [['content-type', 'text/event-stream; charset=utf-8']],
        mimeType: 'TEXT/EVENT-STREAM',
      },
    },
    {
      sequence: 3,
      monotonicMs: 3,
      topic: 'fetch/response-body-chunk',
      payload: { requestId: localId, data: Buffer.from(first).toString('base64') },
    },
    {
      sequence: 4,
      monotonicMs: 4,
      topic: 'fetch/response-body-chunk',
      payload: { requestId: localId, data: Buffer.from(second).toString('base64') },
    },
    {
      sequence: 5,
      monotonicMs: 5,
      topic: 'fetch/end',
      payload: { requestId: localId, capturedBytes: first.length + second.length, responseBodyTruncated: false },
    },
  ]
}

/**
 * 功能说明：处理 requestId 相关流程；使用场景由所在模块及调用位置决定。
 * @param localId （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns string；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 requestId(localId)，并按返回类型处理结果。
 */
function requestId(localId: string): string {
  return `${source.sourceId}:${source.generation}:${localId}`
}
