/** Host-driven Cordis query integration.
 * @remarks 文件说明：文件职责：验证 experimental/inspector 中 cordis query host spec
 * 相关行为与失败场景。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。；产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。；
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。；
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。 */

import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCordisRuntimeTreeReader } from '../src/shared/cordis/reader.ts'
import {
  cordisRuntimeSourceId,
  type CordisRuntimeContext,
  type CordisRuntimeTree,
} from '../src/shared/cordis/model.ts'
import { startInspector, type InspectorHandle } from '../src/host/bridge/controller.ts'
import { publishCordisTree as publishHostCordisTree } from '../src/host/inspection/cordis.ts'
import { inspectorId } from '../src/shared/bridge/ids.ts'
import type { InspectorJsonValue } from '../src/shared/json.ts'
import { InspectorQueryConnection } from '../src/shared/bridge/rpc.ts'
import { parseInspectorQueryRequestFrame, parseInspectorQueryResponseFrame } from '../src/shared/bridge/messages/query/codec.ts'
import type { InspectorQueryRequestFrame, InspectorQueryResponseFrame } from '../src/shared/bridge/messages/query/frames.ts'
import type { InspectorSourceDescriptor } from '../src/shared/bridge/messages/observation.ts'
import { createInspectorService } from '../src/shared/service.ts'
import { CordisTreeStore } from '../src/worker/inspection/cordis-store.ts'
import { InspectorQueryRouter } from '../src/worker/inspection/query-router.ts'
import { InspectorClientFixture } from './fixtures/client-source.host.ts'

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
describe('consumer-neutral Cordis tree', () => {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('projects a detached recursive tree without routing identifiers', () => {
    /**
     * 常量说明：store 用于处理 store 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const store = new CordisTreeStore({ maxNodes: 10, maxDisconnectedTrees: 1 })
    /**
     * 常量说明：source 用于处理 source 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const source = sourceDescriptor('host-1', 'generation-1', 'host')
    store.replace(source, [{
      sequence: 1,
      monotonicMs: 1,
      topic: 'cordis/tree',
      payload: asJson({
        schemaVersion: 0,
        revision: 3,
        objectRegistryId: 'registry-1',
        truncated: false,
        root: {
          kind: 'context',
          objectHandle: 'context-1',
          children: [{
            kind: 'fiber',
            uid: 12,
            objectHandle: 'fiber-1',
            children: [{ kind: 'context', objectHandle: 'context-2', children: [] }],
          }],
        },
      }),
    }])

    /**
     * 常量说明：tree 用于处理 tree 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const tree = store.readTree()
    expect(tree).toEqual({
      schemaVersion: 0,
      host: {
        source: { sourceId: 'host-1', kind: 'host', label: 'host-1' },
        connection: { state: 'connected' },
        revision: 3,
        truncated: false,
        root: {
          kind: 'context',
          children: [{ kind: 'fiber', uid: 12, children: [{ kind: 'context', children: [] }] }],
        },
      },
      clients: [],
    })
    expect(tree.host?.root).not.toBe(store.tree().host?.snapshot.root)
    expect(forbiddenKeys(tree)).toEqual([])

    store.close(source, 'transport closed')
    expect(store.readTree().host?.connection).toEqual({ state: 'disconnected', reason: 'transport closed' })

    /**
     * 常量说明：reconnected 用于处理 reconnected 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const reconnected = sourceDescriptor('host-1', 'generation-2', 'host')
    store.replace(reconnected, [{
      sequence: 1,
      monotonicMs: 2,
      topic: 'cordis/tree',
      payload: asJson({
        schemaVersion: 0,
        revision: 4,
        objectRegistryId: 'registry-2',
        truncated: false,
        root: { kind: 'context', objectHandle: 'context-3', children: [] },
      }),
    }])
    expect(store.readTree().host).toMatchObject({
      connection: { state: 'connected' },
      revision: 4,
      root: { kind: 'context', children: [] },
    })
    expect(forbiddenKeys(store.readTree())).toEqual([])
  })
})

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
describe('Inspector query protocol', () => {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  afterEach(() => { vi.useRealTimers() })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('uses exact request and response codecs', () => {
    /**
     * 常量说明：hiddenTree 用于处理 hiddenTree 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const hiddenTree = runtimeTree()
    if (hiddenTree.host === null) throw new Error('test tree requires a Host realm')
    expect(parseInspectorQueryRequestFrame({
      v: 0,
      t: 'query/request',
      sourceId: 'host-1',
      generation: 'generation-1',
      requestId: 'query-1',
      query: { op: 'cordis-tree/get' },
    })).toMatchObject({ query: { op: 'cordis-tree/get' } })
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    expect(() => parseInspectorQueryRequestFrame({
      v: 0,
      t: 'query/request',
      sourceId: 'host-1',
      generation: 'generation-1',
      requestId: 'query-1',
      query: { op: 'cordis-tree/get', extension: true },
    })).toThrow('unknown field')
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    expect(() => parseInspectorQueryResponseFrame({
      ...successResponse('query-1', runtimeTree()),
      outcome: {
        ok: true,
        result: {
          op: 'cordis-tree/get',
          tree: {
            ...hiddenTree,
            host: {
              ...hiddenTree.host,
              root: { kind: 'context', objectHandle: 'private', children: [] },
            },
          },
        },
      },
    })).toThrow('unknown field')
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('correlates results and clears stale, malformed, timed-out, and closed requests', async () => {
    /**
     * 常量说明：sent 用于处理 sent 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const sent: InspectorQueryRequestFrame[] = []
    /**
     * 常量说明：connection 用于处理 connection 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const connection = new InspectorQueryConnection({ timeoutMs: 20, maxFrameBytes: 16_384 })
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：frame（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(frame)，并按返回类型处理结果。
     */
    connection.connect(sourceId('host-1'), generation('generation-1'), {
      send: (frame) => { sent.push(frame) },
    })

    /**
     * 常量说明：first 用于处理 first 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const first = connection.request({ op: 'cordis-tree/get' })
    /**
     * 常量说明：firstFrame 用于处理 firstFrame 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const firstFrame = sent.at(-1)!
    expect(connection.receive(successResponse(firstFrame.requestId, runtimeTree()))).toBe(true)
    await expect(first).resolves.toEqual({ op: 'cordis-tree/get', tree: runtimeTree() })

    /**
     * 常量说明：stale 用于处理 stale 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const stale = connection.request({ op: 'cordis-tree/get' })
    /**
     * 常量说明：staleFrame 用于处理 staleFrame 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const staleFrame = sent.at(-1)!
    expect(connection.receive({
      ...successResponse(staleFrame.requestId, runtimeTree()),
      generation: generation('generation-old'),
    })).toBe(true)
    await expect(stale).rejects.toThrow('source generation does not match')

    /**
     * 常量说明：malformed 用于处理 malformed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const malformed = connection.request({ op: 'cordis-tree/get' })
    /**
     * 常量说明：malformedFrame 用于处理 malformedFrame 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const malformedFrame = sent.at(-1)!
    /**
     * 常量说明：malformedRejection 用于处理 malformedRejection 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const malformedRejection = expect(malformed).rejects.toThrow('Invalid Inspector query response')
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    expect(() => connection.receive({
      ...successResponse(malformedFrame.requestId, runtimeTree()),
      extension: true,
    })).toThrow('unknown field')
    await malformedRejection

    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：frame（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(frame)，并按返回类型处理结果。
     */
    connection.connect(sourceId('host-1'), generation('generation-2'), {
      send: (frame) => { sent.push(frame) },
    })
    vi.useFakeTimers()
    /**
     * 常量说明：timedOut 用于处理 timedOut 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const timedOut = connection.request({ op: 'cordis-tree/get' })
    /**
     * 常量说明：timeoutRejection 用于处理 timeoutRejection 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const timeoutRejection = expect(timedOut).rejects.toThrow('timed out')
    await vi.advanceTimersByTimeAsync(21)
    await timeoutRejection
    vi.useRealTimers()

    /**
     * 常量说明：closed 用于处理 closed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const closed = connection.request({ op: 'cordis-tree/get' })
    connection.close()
    await expect(closed).rejects.toThrow('closed')
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('rejects malformed, stale, and oversized Worker requests with bounded outcomes', async () => {
    /**
     * 常量说明：responses 用于处理 responses 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const responses: InspectorQueryResponseFrame[] = []
    /**
     * 常量说明：close 用于关闭 close 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const close = vi.fn()
    /**
     * 常量说明：largeTree 用于处理 largeTree 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    const largeTree = runtimeTree({
      kind: 'context',
      children: Array.from({ length: 100 }, () => ({ kind: 'context', children: [] } as const)),
    })
    /**
     * 常量说明：router 用于处理 router 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    const router = new InspectorQueryRouter(createCordisRuntimeTreeReader(() => largeTree), 512)
    /**
     * 常量说明：peer 用于处理 peer 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：frame（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(frame)，并按返回类型处理结果。
     */
    const peer = router.open({ send: (frame) => { responses.push(frame) }, close })
    peer.accept(sourceId('host-1'), generation('generation-1'))

    expect(peer.receive(requestFrame('query-stale', 'generation-old'))).toBe(true)
    expect(responses.at(-1)?.outcome).toMatchObject({ ok: false, error: { code: 'stale-source' } })

    expect(peer.receive({ ...requestFrame('query-malformed'), extension: true })).toBe(true)
    expect(responses.at(-1)?.outcome).toMatchObject({ ok: false, error: { code: 'invalid-request' } })

    expect(peer.receive(requestFrame('query-large'))).toBe(true)
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    await vi.waitFor(() => {
      expect(responses.at(-1)?.outcome).toMatchObject({ ok: false, error: { code: 'result-too-large' } })
    })
    expect(close).not.toHaveBeenCalled()

    /**
     * 常量说明：requester 用于处理 requester 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const requester = new InspectorQueryConnection({ timeoutMs: 100, maxFrameBytes: 512 })
    /**
     * 常量说明：pairedPeer 用于处理 pairedPeer 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：frame（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(frame)，并按返回类型处理结果。
     */
    const pairedPeer = router.open({
      send: (frame) => { requester.receive(frame) },
      close: vi.fn(),
    })
    pairedPeer.accept(sourceId('client-2'), generation('generation-1'))
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：frame（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(frame)，并按返回类型处理结果。
     */
    requester.connect(sourceId('client-2'), generation('generation-1'), {
      send: (frame) => { pairedPeer.receive(frame) },
    })
    await expect(requester.request({ op: 'cordis-tree/get' })).rejects.toMatchObject({ code: 'result-too-large' })
    requester.close()
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('revokes an older carrier when the same source opens a new generation', () => {
    /**
     * 常量说明：firstResponses 用于处理 firstResponses 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const firstResponses: InspectorQueryResponseFrame[] = []
    /**
     * 常量说明：router 用于处理 router 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    const router = new InspectorQueryRouter(createCordisRuntimeTreeReader(() => runtimeTree()), 16_384)
    /**
     * 常量说明：first 用于处理 first 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：frame（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(frame)，并按返回类型处理结果。
     */
    const first = router.open({ send: (frame) => { firstResponses.push(frame) }, close: vi.fn() })
    /**
     * 常量说明：second 用于处理 second 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const second = router.open({ send: vi.fn(), close: vi.fn() })
    first.accept(sourceId('client-1'), generation('generation-1'))
    second.accept(sourceId('client-1'), generation('generation-2'))

    expect(first.receive({
      ...requestFrame('query-old', 'generation-1'),
      sourceId: sourceId('client-1'),
    })).toBe(true)
    expect(firstResponses.at(-1)?.outcome).toMatchObject({ ok: false, error: { code: 'stale-source' } })
  })
})

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
describe('Cordis query service integration', () => {
  /**
   * 变量说明：inspector 用于处理 inspector 相关数据，作用于当前作用域；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  let inspector: InspectorHandle | undefined
  /**
   * 变量说明：clientSource 用于处理 clientSource 相关数据，作用于当前作用域；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  let clientSource: InspectorClientFixture | undefined
  /**
   * 常量说明：observers 用于处理 observers 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const observers: Array<() => void> = []

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  afterEach(async () => {
    /**
     * 变量说明：dispose 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const dispose of observers.splice(0).reverse()) dispose()
    await clientSource?.close()
    clientSource = undefined
    await inspector?.close()
    inspector = undefined
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('returns the same Worker snapshot to Host and Client services without a CDP connection', async () => {
    inspector = await startInspector({
      port: 0,
      captureFetch: false,
      queryTimeoutMs: 1_000,
      maxCordisNodes: 100,
    })
    /**
     * 常量说明：hostContext 用于处理 hostContext 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const hostContext = new Context()
    observers.push(publishHostCordisTree(hostContext, inspector.source, { maxNodes: 100, maxBytes: 64 * 1_024 }))
    /**
     * 常量说明：hostService 用于处理 hostService 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const hostService = createInspectorService(inspector.source)

    clientSource = await InspectorClientFixture.start(inspector.endpoint.client, { label: 'Query Client' })

    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    await vi.waitFor(async () => {
      /**
       * 常量说明：hostTree、clientTree 用于处理 hostTree、clientTree 相关数据，作用于当前作用域；
       * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const [hostTree, clientTree] = await Promise.all([
        hostService.cordis.getTree(),
        clientSource!.getCordisTree(),
      ])
      expect(hostTree).toEqual(clientTree)
      expect(hostTree.host?.source.kind).toBe('host')
      expect(hostTree.clients).toHaveLength(1)
      expect(forbiddenKeys(hostTree)).toEqual([])
    })

    await clientSource.close()
    clientSource = undefined
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    await vi.waitFor(async () => {
      /**
       * 常量说明：tree 用于处理 tree 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const tree = await hostService.cordis.getTree()
      expect(tree.clients[0]?.connection.state).toBe('disconnected')
    })
  })
})

/**
 * 功能说明：处理 sourceDescriptor 相关流程；使用场景由所在模块及调用位置决定。
 * @param id （string）：标识本次操作关联的唯一对象；必须满足声明的类型及调用时序要求。
 * @param sourceGeneration （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param kind （InspectorSourceDescriptor['kind']）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。
 * @returns InspectorSourceDescriptor；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 sourceDescriptor(id, sourceGeneration, kind)，
 * 并按返回类型处理结果。
 */
function sourceDescriptor(
  id: string,
  sourceGeneration: string,
  kind: InspectorSourceDescriptor['kind'],
): InspectorSourceDescriptor {
  return {
    sourceId: sourceId(id),
    generation: generation(sourceGeneration),
    kind,
    label: id,
    timeOriginMs: 0,
    capabilities: [],
  }
}

/**
 * 功能说明：处理 sourceId 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns InspectorSourceDescriptor['sourceId']；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 sourceId(value)，并按返回类型处理结果。
 */
function sourceId(value: string): InspectorSourceDescriptor['sourceId'] {
  return inspectorId<'InspectorSourceId'>(value, 'sourceId')
}

/**
 * 功能说明：处理 generation 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns InspectorSourceDescriptor['generation']；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 generation(value)，并按返回类型处理结果。
 */
function generation(value: string): InspectorSourceDescriptor['generation'] {
  return inspectorId<'InspectorSourceGeneration'>(value, 'generation')
}

/**
 * 功能说明：处理 runtimeTree 相关流程；使用场景由所在模块及调用位置决定。
 * @param root （CordisRuntimeContext）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns CordisRuntimeTree；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 runtimeTree(root)，并按返回类型处理结果。
 */
function runtimeTree(root: CordisRuntimeContext = { kind: 'context', children: [] }): CordisRuntimeTree {
  return {
    schemaVersion: 0,
    host: {
      source: { sourceId: cordisRuntimeSourceId('host-1'), kind: 'host', label: 'Host' },
      connection: { state: 'connected' },
      revision: 1,
      truncated: false,
      root,
    },
    clients: [],
  }
}

/**
 * 功能说明：处理 requestFrame 相关流程；使用场景由所在模块及调用位置决定。
 * @param requestId （string）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。
 * @param sourceGeneration （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。
 * @returns InspectorQueryRequestFrame；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 requestFrame(requestId, sourceGeneration)，并按返回类型处理结果。
 */
function requestFrame(requestId: string, sourceGeneration = 'generation-1'): InspectorQueryRequestFrame {
  return {
    v: 0,
    t: 'query/request',
    sourceId: sourceId('host-1'),
    generation: generation(sourceGeneration),
    requestId: inspectorId<'InspectorQueryRequestId'>(requestId, 'requestId'),
    query: { op: 'cordis-tree/get' },
  }
}

/**
 * 功能说明：处理 successResponse 相关流程；使用场景由所在模块及调用位置决定。
 * @param requestId （string）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。
 * @param tree （CordisRuntimeTree）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns InspectorQueryResponseFrame；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 successResponse(requestId, tree)，并按返回类型处理结果。
 */
function successResponse(requestId: string, tree: CordisRuntimeTree): InspectorQueryResponseFrame {
  return {
    v: 0,
    t: 'query/response',
    sourceId: sourceId('host-1'),
    generation: generation('generation-1'),
    requestId: inspectorId<'InspectorQueryRequestId'>(requestId, 'requestId'),
    outcome: { ok: true, result: { op: 'cordis-tree/get', tree } },
  }
}

/**
 * 功能说明：处理 forbiddenKeys 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns string[]；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 forbiddenKeys(value)，并按返回类型处理结果。
 */
function forbiddenKeys(value: unknown): string[] {
  if (value === null || typeof value !== 'object') return []
  if (Array.isArray(value)) return value.flatMap(forbiddenKeys)
  /**
   * 常量说明：forbidden 用于处理 forbidden 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const forbidden = new Set([
    'objectHandle', 'objectRegistryId', 'registryId', 'generation', 'executionContextId',
    'scriptId', 'nodeId', 'backendNodeId', 'objectId', 'remoteObjectId',
  ])
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：key（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(key)，并按返回类型处理结果。
   */
  return Reflect.ownKeys(value).flatMap((key) => {
    if (typeof key !== 'string') return []
    return [...(forbidden.has(key) ? [key] : []), ...forbiddenKeys(Reflect.get(value, key))]
  })
}

/**
 * 功能说明：处理 asJson 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （object）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns InspectorJsonValue；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 asJson(value)，并按返回类型处理结果。
 */
function asJson(value: object): InspectorJsonValue {
  return value as unknown as InspectorJsonValue
}
