// @vitest-environment jsdom

/**
 * 文件职责：验证 experimental/inspector 中 plugin client spec 相关行为与失败场景。
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。
 * 产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 */
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply } from '../src/client/index.ts'
import { ClientRealmSource } from '../src/client/inspection/realm.ts'
import type { InspectorClientBootstrap } from '../src/shared/bridge/messages/control.ts'

/**
 * 类说明：FakeWebSocket 用于集中封装 处理 FakeWebSocket 相关状态与行为。
 * 核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。
 * 使用场景：由 experimental/inspector 在对应插件或业务生命周期内创建和调用。
 */
class FakeWebSocket extends EventTarget {
  /**
   * 常量说明：CONNECTING 用于处理 CONNECTING 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  static readonly CONNECTING = 0
  /**
   * 常量说明：OPEN 用于打开 OPEN 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  static readonly OPEN = 1
  /**
   * 常量说明：CLOSING 用于处理 CLOSING 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  static readonly CLOSING = 2
  /**
   * 常量说明：CLOSED 用于处理 CLOSED 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  static readonly CLOSED = 3
  /**
   * 常量说明：sockets 用于处理 sockets 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  static readonly sockets: FakeWebSocket[] = []

  /**
   * 常量说明：sent 用于处理 sent 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  readonly sent: string[] = []
  /**
   * 常量说明：url 用于处理 url 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  readonly url: string
  /**
   * 常量说明：protocol 用于处理 protocol 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  readonly protocol: string
  /**
   * 变量说明：readyState 用于处理 readyState 相关数据，作用于成员；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  readyState = FakeWebSocket.CONNECTING
  /**
   * 变量说明：bufferedAmount 用于处理 bufferedAmount 相关数据，作用于成员；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  bufferedAmount = 0

  /**
   * 功能说明：处理 FakeWebSocket 相关流程；使用场景由所在模块及调用位置决定。
   * @param url （string | URL）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param protocols （string | string[]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns 当前类实例；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 通过 new FakeWebSocket(url, protocols) 创建实例，并在所属生命周期内使用。
   */
  constructor(url: string | URL, protocols?: string | string[]) {
    super()
    this.url = String(url)
    this.protocol = typeof protocols === 'string' ? protocols : protocols?.[0] ?? ''
    FakeWebSocket.sockets.push(this)
  }

  /**
   * 功能说明：处理 send 相关流程；使用场景由所在模块及调用位置决定。
   * @param data （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 send(data)，并按返回类型处理结果。
   */
  send(data: string): void {
    this.sent.push(data)
  }

  /**
   * 功能说明：关闭 close 相关流程；使用场景由所在模块及调用位置决定。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 close()，并按返回类型处理结果。
   */
  close(): void {
    if (this.readyState === FakeWebSocket.CLOSED) return
    this.readyState = FakeWebSocket.CLOSED
    this.dispatchEvent(new Event('close'))
  }

  /**
   * 功能说明：打开 open 相关流程；使用场景由所在模块及调用位置决定。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 open()，并按返回类型处理结果。
   */
  open(): void {
    this.readyState = FakeWebSocket.OPEN
    this.dispatchEvent(new Event('open'))
  }

  /**
   * 功能说明：处理 receive 相关流程；使用场景由所在模块及调用位置决定。
   * @param value （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 receive(value)，并按返回类型处理结果。
   */
  receive(value: unknown): void {
    this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(value) }))
  }
}

/**
 * 常量说明：bootstrap 用于处理 bootstrap 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const bootstrap: InspectorClientBootstrap = {
  endpoint: 'ws://127.0.0.1:9230/ingest',
  protocol: 'dsh-inspector-v0-token',
  maxQueuedRecords: 16,
  maxQueuedBytes: 16_384,
  maxRecordsPerFrame: 8,
  maxFrameBytes: 32_768,
  reconnectBaseMs: 10,
  reconnectMaxMs: 20,
  queryTimeoutMs: 100,
  maxRuntimeObjectsPerSession: 100,
  maxRuntimePropertiesPerResult: 100,
  maxClientSourceBytes: 1_048_576,
  maxCordisNodes: 100,
}

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
describe('experimental Inspector Client plugin', () => {
  /**
   * 常量说明：nativeWebSocket 用于处理 nativeWebSocket 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const nativeWebSocket = globalThis.WebSocket
  /**
   * 常量说明：nativeFetch 用于处理 nativeFetch 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const nativeFetch = globalThis.fetch

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  afterEach(() => {
    vi.restoreAllMocks()
    FakeWebSocket.sockets.length = 0
    globalThis.WebSocket = nativeWebSocket
    globalThis.fetch = nativeFetch
    sessionStorage.clear()
    delete globalThis.__DSH_INSPECTOR__
    Reflect.deleteProperty(globalThis, '__DSH_BOOT__')
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('provides ctx.inspector and sends observations after the Worker accepts the source', async () => {
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket
    globalThis.__DSH_INSPECTOR__ = bootstrap
    /**
     * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const ctx = new Context()
    /**
     * 常量说明：fiber 用于处理 fiber 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const fiber = ctx.plugin({ apply })
    await fiber.await()
    /**
     * 常量说明：socket 用于处理 socket 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const socket = FakeWebSocket.sockets[0]!
    expect(socket.url).toBe(bootstrap.endpoint)
    expect(socket.protocol).toBe(bootstrap.protocol)
    socket.open()
    /**
     * 常量说明：open 用于打开 open 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const open = JSON.parse(socket.sent[0]!) as {
      source: { sourceId: string; generation: string }
    }
    socket.receive({
      v: 0,
      t: 'source/accepted',
      sourceId: open.source.sourceId,
      generation: open.source.generation,
    })
    expect(JSON.parse(socket.sent[1]!) as unknown).toMatchObject({
      t: 'source/replace',
      records: [{ topic: 'cordis/tree', payload: { schemaVersion: 0, truncated: false } }],
    })

    /**
     * 常量说明：treePromise 用于处理 treePromise 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const treePromise = ctx.inspector.cordis.getTree()
    /**
     * 常量说明：treeRequest 用于处理 treeRequest 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：value（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(value)，并按返回类型处理结果。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：frame（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(frame)，并按返回类型处理结果。
     */
    const treeRequest = socket.sent.map(value => JSON.parse(value) as { t: string; requestId?: string })
      .find(frame => frame.t === 'query/request')
    expect(treeRequest?.requestId).toBeTypeOf('string')
    socket.receive({
      v: 0,
      t: 'query/response',
      sourceId: open.source.sourceId,
      generation: open.source.generation,
      requestId: treeRequest!.requestId,
      outcome: {
        ok: true,
        result: { op: 'cordis-tree/get', tree: { schemaVersion: 0, host: null, clients: [] } },
      },
    })
    await expect(treePromise).resolves.toEqual({ schemaVersion: 0, host: null, clients: [] })

    ctx.inspector.publish('client/probe', { ready: true }, 7)
    /**
     * 常量说明：append 用于处理 append 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：value（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(value)，并按返回类型处理结果。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：frame（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(frame)，并按返回类型处理结果。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：record（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(record)，并按返回类型处理结果。
     */
    const append = socket.sent.map(value => JSON.parse(value) as {
      t: string
      records: Array<{ topic: string; monotonicMs: number; payload: unknown }>
    }).find(frame => frame.t === 'source/append'
      && frame.records.some(record => record.topic === 'client/probe'))
    expect(append).toMatchObject({
      t: 'source/append',
      records: [{ topic: 'client/probe', monotonicMs: 7, payload: { ready: true } }],
    })

    document.title = 'Inspector Client Realm'
    socket.receive({
      v: 0,
      t: 'client-runtime/request',
      sourceId: open.source.sourceId,
      generation: open.source.generation,
      sessionId: 'devtools-1',
      requestId: 'runtime-1',
      command: { op: 'evaluate', expression: 'document.title', returnByValue: true },
    })
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    await vi.waitFor(() => {
      /**
       * 常量说明：response 用于处理 response 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：value（由 TypeScript
       * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(value)，并按返回类型处理结果。
       */
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：frame（由 TypeScript
       * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(frame)，并按返回类型处理结果。
       */
      const response = socket.sent.map(value => JSON.parse(value) as { requestId?: string })
        .find(frame => frame.requestId === 'runtime-1')
      expect(response).toMatchObject({
        t: 'client-runtime/response',
        sessionId: 'devtools-1',
        requestId: 'runtime-1',
        outcome: {
          ok: true,
          result: { op: 'evaluate', completion: { result: { descriptor: { value: 'Inspector Client Realm' } } } },
        },
      })
    })

    await fiber.dispose()
    expect(JSON.parse(socket.sent.at(-1)!)).toMatchObject({ t: 'source/close' })
    expect(socket.readyState).toBe(FakeWebSocket.CLOSED)
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('keeps the realm source id and rotates the transport generation on reconnect', async () => {
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket
    globalThis.__DSH_INSPECTOR__ = bootstrap
    /**
     * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const ctx = new Context()
    /**
     * 常量说明：fiber 用于处理 fiber 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const fiber = ctx.plugin({ apply })
    await fiber.await()
    /**
     * 常量说明：firstSocket 用于处理 firstSocket 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const firstSocket = FakeWebSocket.sockets[0]!
    firstSocket.open()
    /**
     * 常量说明：firstOpen 用于处理 firstOpen 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const firstOpen = JSON.parse(firstSocket.sent[0]!) as {
      source: { sourceId: string; generation: string }
    }

    firstSocket.close()
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    await vi.waitFor(() => { expect(FakeWebSocket.sockets).toHaveLength(2) })
    /**
     * 常量说明：secondSocket 用于处理 secondSocket 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const secondSocket = FakeWebSocket.sockets[1]!
    secondSocket.open()
    /**
     * 常量说明：secondOpen 用于处理 secondOpen 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const secondOpen = JSON.parse(secondSocket.sent[0]!) as {
      source: { sourceId: string; generation: string }
    }
    expect(secondOpen.source.sourceId).toBe(firstOpen.source.sourceId)
    expect(secondOpen.source.generation).not.toBe(firstOpen.source.generation)

    await fiber.dispose()
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('keeps the logical source id when the Client plugin is recreated after a page refresh', async () => {
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket
    globalThis.__DSH_INSPECTOR__ = bootstrap
    /**
     * 常量说明：firstContext 用于处理 firstContext 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const firstContext = new Context()
    /**
     * 常量说明：firstFiber 用于处理 firstFiber 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const firstFiber = firstContext.plugin({ apply })
    await firstFiber.await()
    /**
     * 常量说明：firstSocket 用于处理 firstSocket 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const firstSocket = FakeWebSocket.sockets[0]!
    firstSocket.open()
    /**
     * 常量说明：firstOpen 用于处理 firstOpen 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const firstOpen = JSON.parse(firstSocket.sent[0]!) as {
      source: { sourceId: string; generation: string }
    }
    await firstFiber.dispose()

    /**
     * 常量说明：secondContext 用于处理 secondContext 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const secondContext = new Context()
    /**
     * 常量说明：secondFiber 用于处理 secondFiber 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const secondFiber = secondContext.plugin({ apply })
    await secondFiber.await()
    /**
     * 常量说明：secondSocket 用于处理 secondSocket 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const secondSocket = FakeWebSocket.sockets[1]!
    secondSocket.open()
    /**
     * 常量说明：secondOpen 用于处理 secondOpen 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const secondOpen = JSON.parse(secondSocket.sent[0]!) as {
      source: { sourceId: string; generation: string }
    }

    expect(secondOpen.source.sourceId).toBe(firstOpen.source.sourceId)
    expect(secondOpen.source.generation).not.toBe(firstOpen.source.generation)
    await secondFiber.dispose()
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('rotates a copied session identity while its original page remains live', async () => {
    /**
     * 常量说明：descriptor 用于处理 descriptor 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const descriptor = Object.getOwnPropertyDescriptor(navigator, 'locks')
    /**
     * 常量说明：held 用于处理 held 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const held = new Set<string>()
    /**
     * 常量说明：request 用于处理 request 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     * 功能说明：处理 request 相关流程；使用场景由所在模块及调用位置决定。
     * @param name （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
     * @param _options （LockOptions）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。
     * @param callback （(lock: Lock | null) => unknown）：接收后续状态或事件并执行调用方逻辑；
     * 必须满足声明的类型及调用时序要求。
     * @returns Promise<unknown>；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 request(name, _options, callback)，并按返回类型处理结果。
     */
    const request = async (
      name: string,
      _options: LockOptions,
      callback: (lock: Lock | null) => unknown,
    ): Promise<unknown> => {
      /**
       * 常量说明：acquired 用于处理 acquired 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const acquired = !held.has(name)
      if (acquired) held.add(name)
      try {
        return await callback(acquired ? { name, mode: 'exclusive' } : null)
      } finally {
        if (acquired) held.delete(name)
      }
    }
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: { request },
    })
    /**
     * 变量说明：first 用于处理 first 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let first: ClientRealmSource | undefined
    /**
     * 变量说明：duplicate 用于处理 duplicate 相关数据，作用于当前作用域；其值可能随流程推进而变化，
     * 读写时需遵守声明类型和所在生命周期。
     */
    let duplicate: ClientRealmSource | undefined
    /**
     * 变量说明：refreshed 用于处理 refreshed 相关数据，作用于当前作用域；其值可能随流程推进而变化，
     * 读写时需遵守声明类型和所在生命周期。
     */
    let refreshed: ClientRealmSource | undefined
    try {
      first = await ClientRealmSource.claim('first')
      duplicate = await ClientRealmSource.claim('duplicate')
      expect(duplicate.sourceId).not.toBe(first.sourceId)

      first.close()
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
       */
      await vi.waitFor(() => { expect(held.size).toBe(1) })
      sessionStorage.setItem('dsh.experimental-inspector.client-source-id.v0', first.sourceId)
      refreshed = await ClientRealmSource.claim('refreshed')
      expect(refreshed.sourceId).toBe(first.sourceId)
    } finally {
      first?.close()
      duplicate?.close()
      refreshed?.close()
      if (descriptor === undefined) Reflect.deleteProperty(navigator, 'locks')
      else Object.defineProperty(navigator, 'locks', descriptor)
    }
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('falls back to a page-lifetime source id when session storage is unavailable', async () => {
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket
    globalThis.__DSH_INSPECTOR__ = bootstrap
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('storage disabled', 'SecurityError')
    })
    /**
     * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const ctx = new Context()
    /**
     * 常量说明：fiber 用于处理 fiber 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const fiber = ctx.plugin({ apply })
    await fiber.await()
    /**
     * 常量说明：socket 用于处理 socket 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const socket = FakeWebSocket.sockets[0]!
    socket.open()
    /**
     * 常量说明：open 用于打开 open 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const open = JSON.parse(socket.sent[0]!) as { source: { sourceId: string } }

    expect(open.source.sourceId).toMatch(/^client-/u)
    await fiber.dispose()
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('cancels an outstanding Client Runtime operation without sending a late response', async () => {
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket
    globalThis.__DSH_INSPECTOR__ = bootstrap
    /**
     * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const ctx = new Context()
    /**
     * 常量说明：fiber 用于处理 fiber 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const fiber = ctx.plugin({ apply })
    await fiber.await()
    /**
     * 常量说明：socket 用于处理 socket 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const socket = FakeWebSocket.sockets[0]!
    socket.open()
    /**
     * 常量说明：open 用于打开 open 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const open = JSON.parse(socket.sent[0]!) as {
      source: { sourceId: string; generation: string }
    }
    socket.receive({
      v: 0,
      t: 'source/accepted',
      sourceId: open.source.sourceId,
      generation: open.source.generation,
    })
    socket.receive({
      v: 0,
      t: 'client-runtime/request',
      sourceId: open.source.sourceId,
      generation: open.source.generation,
      sessionId: 'devtools-cancel',
      requestId: 'runtime-cancel',
      command: { op: 'evaluate', expression: 'new Promise(() => {})', awaitPromise: true },
    })
    socket.receive({
      v: 0,
      t: 'client-runtime/cancel',
      sourceId: open.source.sourceId,
      generation: open.source.generation,
      sessionId: 'devtools-cancel',
      requestId: 'runtime-cancel',
    })
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolve（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(resolve)，并按返回类型处理结果。
     */
    await new Promise(resolve => setTimeout(resolve, 0))
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：value（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(value)，并按返回类型处理结果。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：frame（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(frame)，并按返回类型处理结果。
     */
    expect(socket.sent.map(value => JSON.parse(value) as { requestId?: string })
      .some(frame => frame.requestId === 'runtime-cancel')).toBe(false)

    socket.receive({
      v: 0,
      t: 'client-runtime/request',
      sourceId: open.source.sourceId,
      generation: open.source.generation,
      sessionId: 'devtools-cancel',
      requestId: 'runtime-after-cancel',
      command: { op: 'evaluate', expression: '42', returnByValue: true },
    })
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    await vi.waitFor(() => {
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：value（由 TypeScript
       * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(value)，并按返回类型处理结果。
       */
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：frame（由 TypeScript
       * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(frame)，并按返回类型处理结果。
       */
      expect(socket.sent.map(value => JSON.parse(value) as { requestId?: string })
        .some(frame => frame.requestId === 'runtime-after-cancel')).toBe(true)
    })

    await fiber.dispose()
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('does not report queue loss again after a replacement absorbs it', async () => {
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket
    globalThis.__DSH_INSPECTOR__ = { ...bootstrap, maxQueuedRecords: 1 }
    /**
     * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const ctx = new Context()
    /**
     * 常量说明：fiber 用于处理 fiber 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const fiber = ctx.plugin({ apply })
    await fiber.await()
    /**
     * 常量说明：socket 用于处理 socket 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const socket = FakeWebSocket.sockets[0]!

    ctx.inspector.publish('client/first', { ordinal: 1 })
    ctx.inspector.publish('client/second', { ordinal: 2 })
    socket.open()
    /**
     * 常量说明：open 用于打开 open 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const open = JSON.parse(socket.sent[0]!) as {
      source: { sourceId: string; generation: string }
    }
    socket.receive({
      v: 0,
      t: 'source/accepted',
      sourceId: open.source.sourceId,
      generation: open.source.generation,
    })

    /**
     * 常量说明：replacement 用于处理 replacement 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const replacement = JSON.parse(socket.sent[1]!) as { nextSequence: number }
    /**
     * 常量说明：append 用于处理 append 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const append = JSON.parse(socket.sent[2]!) as {
      firstSequence: number
      droppedBefore: number
      records: Array<{ topic: string }>
    }
    expect(append).toMatchObject({
      firstSequence: replacement.nextSequence,
      droppedBefore: 0,
      records: [{ topic: 'client/second' }],
    })

    await fiber.dispose()
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('discovers and serves its built Client bundle through the source protocol', async () => {
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket
    globalThis.__DSH_INSPECTOR__ = bootstrap
    Reflect.set(globalThis, '__DSH_BOOT__', {
      rev: 'graph',
      entries: [{
        id: '@deepseek-ai/dsh-experimental-inspector',
        url: '/plugins/@deepseek-ai/dsh-experimental-inspector/client.js?rev=bundle-rev',
        rev: 'bundle-rev',
      }],
    })
    /**
     * 常量说明：source 用于处理 source 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const source = 'const clientBundleMarker = "你好"\n'
    /**
     * 常量说明：sourceMap 用于处理 sourceMap 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const sourceMap = '{"version":3,"sources":["client/index.ts"]}'
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：input（string | URL |
     * Request）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(input)，并按返回类型处理结果。
     */
    globalThis.fetch = vi.fn(async (input: string | URL | Request) => {
      /**
       * 常量说明：url 用于处理 url 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      return new Response(url.includes('.js.map') ? sourceMap : source)
    })

    /**
     * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const ctx = new Context()
    /**
     * 常量说明：fiber 用于处理 fiber 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const fiber = ctx.plugin({ apply })
    await fiber.await()
    /**
     * 常量说明：socket 用于处理 socket 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const socket = FakeWebSocket.sockets[0]!
    socket.open()
    /**
     * 常量说明：open 用于打开 open 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const open = JSON.parse(socket.sent[0]!) as {
      source: { sourceId: string; generation: string; capabilities: Array<{ type: string }> }
    }
    expect(open.source.capabilities).toEqual(expect.arrayContaining([{ type: 'client-sources' }]))
    socket.receive({
      v: 0,
      t: 'source/accepted',
      sourceId: open.source.sourceId,
      generation: open.source.generation,
    })
    socket.receive({
      v: 0,
      t: 'client-sources/request',
      sourceId: open.source.sourceId,
      generation: open.source.generation,
      sessionId: 'source-session-1',
      requestId: 'source-request-1',
      command: { op: 'list-scripts' },
    })

    /**
     * 变量说明：scriptKey 用于处理 scriptKey 相关数据，作用于当前作用域；其值可能随流程推进而变化，
     * 读写时需遵守声明类型和所在生命周期。
     */
    let scriptKey: string | undefined
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    await vi.waitFor(() => {
      /**
       * 常量说明：response 用于处理 response 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：value（由 TypeScript
       * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(value)，并按返回类型处理结果。
       */
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：frame（由 TypeScript
       * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(frame)，并按返回类型处理结果。
       */
      const response = socket.sent.map(value => JSON.parse(value) as {
        requestId?: string
        outcome?: { result?: { scripts?: Array<{ scriptKey: string; url: string; sourceMapUrl: string }> } }
      }).find(frame => frame.requestId === 'source-request-1')
      /**
       * 常量说明：script 用于处理 script 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const script = response?.outcome?.result?.scripts?.[0]
      expect(script?.url).toContain('/plugins/@deepseek-ai/dsh-experimental-inspector/client.js?rev=bundle-rev')
      expect(script?.sourceMapUrl)
        .toContain('/plugins/@deepseek-ai/dsh-experimental-inspector/client.js.map?rev=bundle-rev')
      scriptKey = script?.scriptKey
    })
    socket.receive({
      v: 0,
      t: 'client-sources/request',
      sourceId: open.source.sourceId,
      generation: open.source.generation,
      sessionId: 'source-session-1',
      requestId: 'source-request-2',
      command: { op: 'get-content-chunk', scriptKey, content: 'source', offset: 0, maxBytes: 1_024 },
    })
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    await vi.waitFor(() => {
      /**
       * 常量说明：response 用于处理 response 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：value（由 TypeScript
       * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(value)，并按返回类型处理结果。
       */
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：frame（由 TypeScript
       * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(frame)，并按返回类型处理结果。
       */
      const response = socket.sent.map(value => JSON.parse(value) as {
        requestId?: string
        outcome?: { result?: { data?: string; eof?: boolean } }
      }).find(frame => frame.requestId === 'source-request-2')
      expect(response?.outcome?.result?.eof).toBe(true)
      /**
       * 常量说明：bytes 用于处理 bytes 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：character（由 TypeScript
       * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(character)，并按返回类型处理结果。
       */
      const bytes = Uint8Array.from(atob(response?.outcome?.result?.data ?? ''), character => character.charCodeAt(0))
      expect(new TextDecoder().decode(bytes)).toBe(source)
    })

    await fiber.dispose()
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('fails loud when the Host did not inject a bootstrap', async () => {
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket
    /**
     * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const ctx = new Context()
    /**
     * 常量说明：fiber 用于处理 fiber 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const fiber = ctx.plugin({ apply })
    await expect(fiber).rejects.toThrow('Host bootstrap is missing')
    await fiber.dispose()
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('closes the Client source when a later plugin registration fails', async () => {
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket
    globalThis.__DSH_INSPECTOR__ = bootstrap
    /**
     * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const ctx = new Context()
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    ctx.provide('inspector', {
      publish: () => undefined,
      cordis: { getTree: () => Promise.reject(new Error('unused test service')) },
    })

    /**
     * 常量说明：fiber 用于处理 fiber 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const fiber = ctx.plugin({ apply })
    await expect(fiber.await()).rejects.toThrow('service "inspector" has been registered')
    expect(FakeWebSocket.sockets).toHaveLength(1)
    expect(FakeWebSocket.sockets[0]?.readyState).toBe(FakeWebSocket.CLOSED)
    await fiber.dispose()
  })
})
