/** Worker and shared protocol behavior.
 * @remarks 文件说明：文件职责：验证 experimental/inspector 中 protocol host spec
 * 相关行为与失败场景。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。；产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。；
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。；
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。 */

import { describe, expect, it, vi } from 'vitest'
import { INSPECTOR_PROTOCOL_VERSION, parseSourceFrame, parseWorkerSourceFrame } from '../src/shared/bridge/messages/observation.ts'
import { InspectorSourceRegistry, type InspectorRecordConsumer, type SourceConnection } from '../src/worker/bridge/hub.ts'

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
describe('Inspector source protocol', () => {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('rebuilds a valid source frame and rejects non-JSON payloads', () => {
    /**
     * 常量说明：frame 用于处理 frame 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const frame = parseSourceFrame({
      v: INSPECTOR_PROTOCOL_VERSION,
      t: 'source/append',
      sourceId: 'host-1',
      generation: 'generation-1',
      firstSequence: 1,
      droppedBefore: 0,
      records: [{ monotonicMs: 12, topic: 'probe', payload: { ok: true } }],
    }, 4)
    expect(frame.t).toBe('source/append')
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    expect(() => parseSourceFrame({
      v: INSPECTOR_PROTOCOL_VERSION,
      t: 'source/append',
      sourceId: 'host-1',
      generation: 'generation-1',
      firstSequence: 1,
      droppedBefore: 0,
      records: [{ monotonicMs: 12, topic: 'probe', payload: { bad: undefined } }],
    }, 4)).toThrow('lossless JSON object')
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('isolates generations and reports sequence gaps', () => {
    /**
     * 常量说明：replace 用于处理 replace 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const replace = vi.fn()
    /**
     * 常量说明：append 用于处理 append 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const append = vi.fn()
    /**
     * 常量说明：close 用于关闭 close 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const close = vi.fn()
    /**
     * 常量说明：consumer 用于处理 consumer 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const consumer: InspectorRecordConsumer = {
      topics: new Set(['probe']),
      replace,
      append,
      close,
    }
    /**
     * 常量说明：replies 用于处理 replies 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const replies: unknown[] = []
    /**
     * 常量说明：send 用于处理 send 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：frame（unknown）：提供本次调用所需的数据；
     * 必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；
     * 典型用法：在完成前置校验后调用 匿名回调(frame)，并按返回类型处理结果。
     */
    const send = vi.fn((frame: unknown) => { replies.push(frame) })
    /**
     * 常量说明：closeConnection 用于关闭 Connection 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const closeConnection = vi.fn()
    /**
     * 常量说明：connection 用于处理 connection 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const connection: SourceConnection = {
      kind: 'host',
      send,
      close: closeConnection,
    }
    /**
     * 常量说明：registry 用于处理 registry 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const registry = new InspectorSourceRegistry([consumer], 16_384, 4)
    registry.receive(connection, {
      v: 0,
      t: 'source/open',
      source: {
        sourceId: 'host-1',
        generation: 'g-1',
        kind: 'host',
        label: 'Host',
        timeOriginMs: 1_000,
        capabilities: [],
      },
      topics: ['probe'],
    })
    registry.receive(connection, {
      v: 0,
      t: 'source/append',
      sourceId: 'host-1',
      generation: 'g-1',
      firstSequence: 2,
      droppedBefore: 1,
      records: [{ monotonicMs: 1, topic: 'probe', payload: { value: 1 } }],
    })

    expect(append).toHaveBeenCalledOnce()
    expect(registry.describe()[0]).toMatchObject({ expectedSequence: 3, dropped: 1, topics: { probe: 1 } })

    registry.receive(connection, {
      v: 0,
      t: 'source/append',
      sourceId: 'host-1',
      generation: 'g-1',
      firstSequence: 5,
      droppedBefore: 0,
      records: [],
    })
    expect(replies.at(-1)).toMatchObject({ t: 'source/resnapshot', expectedSequence: 3 })
    expect(append).toHaveBeenCalledOnce()
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('closes only a malformed source connection', () => {
    /**
     * 常量说明：send 用于处理 send 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const send = vi.fn()
    /**
     * 常量说明：closeConnection 用于关闭 Connection 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const closeConnection = vi.fn()
    /**
     * 常量说明：connection 用于处理 connection 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const connection: SourceConnection = {
      kind: 'client',
      send,
      close: closeConnection,
    }
    /**
     * 常量说明：registry 用于处理 registry 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const registry = new InspectorSourceRegistry([], 1_024, 2)
    registry.receive(connection, { v: 99, t: 'source/open' })
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ t: 'source/rejected' }))
    expect(closeConnection).toHaveBeenCalledOnce()
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('decodes Runtime commands and rejects undeclared fields', () => {
    /**
     * 常量说明：request 用于处理 request 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const request = parseWorkerSourceFrame({
      v: 0,
      t: 'client-runtime/request',
      sourceId: 'client-1',
      generation: 'g-1',
      sessionId: 'session-1',
      requestId: 'request-1',
      command: {
        op: 'call-function',
        functionDeclaration: 'function () { return this.value }',
        receiver: 'object-1',
        arguments: [{ kind: 'unserializable', value: 'NaN' }],
        returnByValue: true,
      },
    })
    expect(request).toMatchObject({
      t: 'client-runtime/request',
      command: { op: 'call-function', receiver: 'object-1', returnByValue: true },
    })
    if (request.t !== 'client-runtime/request') throw new Error('unexpected frame type')
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    expect(() => parseWorkerSourceFrame({
      ...request,
      command: { ...request.command, unversionedExtension: true },
    })).toThrow('unknown field')

    expect(parseWorkerSourceFrame({
      v: 0,
      t: 'client-runtime/response-acknowledged',
      sourceId: 'client-1',
      generation: 'g-1',
      sessionId: 'session-1',
      requestId: 'request-1',
    })).toMatchObject({ t: 'client-runtime/response-acknowledged', requestId: 'request-1' })
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('rejects invalid RemoteObject representations', () => {
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    expect(() => parseSourceFrame({
      v: 0,
      t: 'client-runtime/response',
      sourceId: 'client-1',
      generation: 'g-1',
      sessionId: 'session-1',
      requestId: 'request-1',
      outcome: {
        ok: true,
        result: {
          op: 'evaluate',
          completion: {
            result: {
              descriptor: { type: 'number', value: 1 },
              object: { handle: 'object-1' },
            },
          },
        },
      },
    }, 4)).toThrow('invalid number RemoteObject representation')
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('decodes exact Client Console lifecycle and event frames', () => {
    expect(parseWorkerSourceFrame({
      v: 0,
      t: 'client-console/enable',
      sourceId: 'client-1',
      generation: 'g-1',
      sessionId: 'session-1',
    })).toMatchObject({ t: 'client-console/enable', sessionId: 'session-1' })

    /**
     * 常量说明：frame 用于处理 frame 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const frame = parseSourceFrame({
      v: 0,
      t: 'client-console/event',
      sourceId: 'client-1',
      generation: 'g-1',
      sessionId: 'session-1',
      event: {
        type: 'console-api',
        event: {
          type: 'log',
          arguments: [{
            descriptor: { type: 'object', className: 'Object', description: 'Object' },
            object: { handle: 'object-1' },
          }],
          timestamp: 12,
        },
      },
    }, 4)
    expect(frame).toMatchObject({
      t: 'client-console/event',
      sessionId: 'session-1',
      event: {
        type: 'console-api',
        event: { type: 'log', arguments: [{ object: { handle: 'object-1' } }] },
      },
    })

    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    expect(() => parseWorkerSourceFrame({
      v: 0,
      t: 'client-console/disable',
      sourceId: 'client-1',
      generation: 'g-1',
      sessionId: 'session-1',
      extra: true,
    })).toThrow('unknown field')
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('decodes bounded Client source commands and responses', () => {
    expect(parseWorkerSourceFrame({
      v: 0,
      t: 'client-sources/request',
      sourceId: 'client-1',
      generation: 'g-1',
      sessionId: 'source-session-1',
      requestId: 'source-request-1',
      command: {
        op: 'get-content-chunk',
        scriptKey: 'bundle',
        content: 'source',
        offset: 0,
        maxBytes: 1024,
      },
    })).toMatchObject({
      t: 'client-sources/request',
      command: { op: 'get-content-chunk', maxBytes: 1024 },
    })

    expect(parseSourceFrame({
      v: 0,
      t: 'client-sources/response',
      sourceId: 'client-1',
      generation: 'g-1',
      sessionId: 'source-session-1',
      requestId: 'source-request-1',
      outcome: {
        ok: true,
        result: {
          op: 'get-content-chunk',
          scriptKey: 'bundle',
          content: 'source',
          available: true,
          offset: 0,
          nextOffset: 3,
          data: 'YWJj',
          eof: true,
        },
      },
    }, 4)).toMatchObject({
      t: 'client-sources/response',
      outcome: { ok: true, result: { data: 'YWJj', eof: true } },
    })

    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    expect(() => parseSourceFrame({
      v: 0,
      t: 'client-sources/response',
      sourceId: 'client-1',
      generation: 'g-1',
      sessionId: 'source-session-1',
      requestId: 'source-request-1',
      outcome: {
        ok: true,
        result: {
          op: 'get-content-chunk',
          scriptKey: 'bundle',
          content: 'source',
          available: true,
          offset: 0,
          nextOffset: 3,
          data: 'not base64',
          eof: true,
        },
      },
    }, 4)).toThrow('chunk data')
  })
})
