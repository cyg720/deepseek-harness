/*
 * 文件职责：验证浏览器端连接插件装载、状态订阅、HTTP RPC 和 WebSocket 事件流行为。
 * 技术维度：Cordis 测试 Context、Vitest、FakeWebSocket、Fetch 模拟和异步迭代器。
 * 产品维度：保证浏览器启动、重连、取消和目标管理调用在真实组装入口下可用。
 * 逻辑维度：挂载插件，替换浏览器全局对象，驱动模拟响应或事件，再断言状态与清理结果。
 * 关键边界：全局 Fetch 与 WebSocket 必须在用例后恢复；异步流要显式关闭，避免测试泄漏。
 * 新手阅读建议：先读 FakeWebSocket 和 mount，再按连接生命周期、传输、RPC 三组场景阅读。
 */
/**
 * Connection plugin browser-half apply: ctx.connection handle mounting, mode
 * selection off the page URL, and the single-consumer stream-loop ownership.
 */
// oxlint-disable-next-line @stylistic/max-len -- 中文文件说明需要在英文说明下方完整保留六个部分。
/** 文件职责：验证浏览器连接插件装载与传输。技术维度：Cordis、Fetch 和 WebSocket。产品维度：保证浏览器可靠连接宿主。逻辑维度：挂载后驱动模拟事件并断言状态。关键边界：全局替身和异步流必须清理。新手阅读建议：先读 FakeWebSocket 与 mount。 */
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply, type ConnectionHandle } from '../src/client/index.ts'
import type { RpcMessage } from '../src/client/api.ts'
import { RpcId } from '../src/client/api.ts'
import { FixtureApiClient } from '../src/client/fixture.ts'
import { WebApiClient } from '../src/client/web-api-client.ts'

/** 中文说明：测试类型 `Win`，约束本文件夹具或观测值的字段，避免模拟数据偏离生产接口。 */
type Win = { location?: { hostname: string; search: string; origin?: string } }
/** 中文说明：测试类型 `WebSocketGlobal`，约束本文件夹具或观测值的字段，避免模拟数据偏离生产接口。 */
type WebSocketGlobal = { WebSocket?: typeof WebSocket }

/** 中文说明：当前场景使用或观察的 WebSocket 或流套接字；变量 `originalWebSocket` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
const originalWebSocket = globalThis.WebSocket
/** 中文说明：当前场景使用或观察的 WebSocket 或流套接字；变量 `sockets` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
const sockets: FakeWebSocket[] = []

/** 中文说明：测试类 `FakeWebSocket`，模拟连接层依赖并公开可控状态，供本文件场景实例化使用。 */
class FakeWebSocket extends EventTarget {
  /** 中文说明：测试类成员 `CONNECTING`，保存可编排行为或观测状态；取值范围由声明类型限定，仅供连接层测试使用。 */
  static readonly CONNECTING = 0
  /** 中文说明：测试类成员 `OPEN`，保存可编排行为或观测状态；取值范围由声明类型限定，仅供连接层测试使用。 */
  static readonly OPEN = 1
  /** 中文说明：测试类成员 `CLOSING`，保存可编排行为或观测状态；取值范围由声明类型限定，仅供连接层测试使用。 */
  static readonly CLOSING = 2
  /** 中文说明：测试类成员 `CLOSED`，保存可编排行为或观测状态；取值范围由声明类型限定，仅供连接层测试使用。 */
  static readonly CLOSED = 3

  /** 中文说明：测试类成员 `url`，保存可编排行为或观测状态；取值范围由声明类型限定，仅供连接层测试使用。 */
  readonly url: string
  /** 中文说明：测试类成员 `readyState`，保存可编排行为或观测状态；取值范围由声明类型限定，仅供连接层测试使用。 */
  readyState = FakeWebSocket.CONNECTING

  /** 中文说明：测试类方法 `constructor`；参数含义见签名，返回值用于驱动或观察当前场景；例如按下方用例的调用方式使用。 */
  constructor(url: string | URL) {
    super()
    this.url = String(url)
    sockets.push(this)
    queueMicrotask(() => {
      if (this.readyState !== FakeWebSocket.CONNECTING) return
      this.readyState = FakeWebSocket.OPEN
      this.dispatchEvent(new Event('open'))
    })
  }

  /** 中文说明：测试类方法 `close`；参数含义见签名，返回值用于驱动或观察当前场景；例如按下方用例的调用方式使用。 */
  close(): void {
    if (this.readyState === FakeWebSocket.CLOSED) return
    this.readyState = FakeWebSocket.CLOSED
    this.dispatchEvent(new Event('close'))
  }

  /** 中文说明：测试类方法 `receive`；参数含义见签名，返回值用于驱动或观察当前场景；例如按下方用例的调用方式使用。 */
  receive(data: unknown): void {
    this.dispatchEvent(new MessageEvent('message', { data }))
  }
}

afterEach(() => {
  delete (globalThis as Win).location
  sockets.length = 0
  if (originalWebSocket === undefined) delete (globalThis as WebSocketGlobal).WebSocket
  else globalThis.WebSocket = originalWebSocket
})

/** 中文说明：测试辅助函数 `mount`；参数含义见签名，返回值供当前场景驱动或断言；例如按下方测试调用方式使用。 */
async function mount(): Promise<ConnectionHandle> {
  /** 中文说明：当前测试使用的 Cordis 上下文或所属运行环境；变量 `ctx` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
  const ctx = new Context()
  await ctx.plugin({ apply, inject: [] })
  /** 中文说明：当前场景驱动的连接或 API 测试对象；变量 `handle` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
  const handle = ctx.get('connection') as ConnectionHandle | undefined
  if (handle === undefined) throw new Error('ctx.connection not provided')
  return handle
}

describe('connection client apply', () => {
  it('mounts ctx.connection with the real client when no ?fixture switch is present', async () => {
    ;(globalThis as Win).location = { hostname: 'localhost', search: '' }
    /** 中文说明：当前场景驱动的连接或 API 测试对象；变量 `handle` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const handle = await mount()
    expect(handle.api).toBeInstanceOf(WebApiClient)
    expect(handle.isLoopback).toBe(true)
  })

  it('selects the fixture client under ?fixture (and with no location at all stays real)', async () => {
    ;(globalThis as Win).location = { hostname: '127.0.0.1', search: '?fixture' }
    expect((await mount()).api).toBeInstanceOf(FixtureApiClient)
    delete (globalThis as Win).location
    /** 中文说明：当前场景驱动的连接或 API 测试对象；变量 `handle` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const handle = await mount()
    expect(handle.api).toBeInstanceOf(WebApiClient)
    expect(handle.isLoopback).toBe(true)
  })

  it('reports non-loopback page authority through the connection handle', async () => {
    ;(globalThis as Win).location = { hostname: '192.0.2.20', search: '' }
    expect((await mount()).isLoopback).toBe(false)
  })

  it('start() hands out one loop, rejects a second consumer, and stop() aborts the streams', async () => {
    ;(globalThis as Win).location = { hostname: 'localhost', search: '?fixture' }
    /** 中文说明：当前场景驱动的连接或 API 测试对象；变量 `handle` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const handle = await mount()
    /** 中文说明：记录调用并隔离外部输出的 Vitest 测试替身；变量 `errorSpy` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    /** 中文说明：按发生顺序收集观测值的数组或记录集合；变量 `descriptions` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const descriptions: Array<boolean | undefined> = []
    /** 中文说明：结束注册、订阅或异步等待的清理函数；变量 `stopThrowing` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const stopThrowing = handle.hostDescription.subscribe(() => { throw new Error('subscriber bug') })
    /** 中文说明：结束注册、订阅或异步等待的清理函数；变量 `stopDescription` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const stopDescription = handle.hostDescription.subscribe(() => {
      descriptions.push(handle.hostDescription.getSnapshot()?.canOpenPath)
    })
    expect(handle.hostDescription.getSnapshot()).toBeUndefined()
    // config omitted: the `config ?? {}` default arm is part of the surface.
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `connected` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    let connected = 0
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `loop` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const loop = handle.start({ onConnected: () => { connected++ } })
    expect(() => handle.start({})).toThrow(/already owned by another consumer/)
    await vi.waitFor(() => {
      expect(handle.hostDescription.getSnapshot()?.canOpenPath).toBe(true)
    })
    loop.stop() // teardown must not throw; the fixture streams abort quietly
    expect(handle.hostDescription.getSnapshot()).toBeUndefined()
    expect(descriptions).toEqual([true, undefined])
    expect(connected).toBe(1)
    expect(errorSpy).toHaveBeenCalledTimes(2)
    stopThrowing()
    stopDescription()
    errorSpy.mockRestore()
  })

  it('does not announce a generation synchronously stopped by a description subscriber', async () => {
    ;(globalThis as Win).location = { hostname: 'localhost', search: '?fixture' }
    /** 中文说明：当前场景驱动的连接或 API 测试对象；变量 `handle` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const handle = await mount()
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `owner` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const owner: { loop?: ReturnType<ConnectionHandle['start']> } = {}
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `sawDescription` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    let sawDescription = false
    /** 中文说明：结束注册、订阅或异步等待的清理函数；变量 `stopDescription` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const stopDescription = handle.hostDescription.subscribe(() => {
      if (handle.hostDescription.getSnapshot() === undefined) return
      sawDescription = true
      owner.loop?.stop()
    })
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `connected` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const connected = vi.fn()
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `loop` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const loop = handle.start({ onConnected: connected })
    owner.loop = loop
    try {
      await vi.waitFor(() => { expect(sawDescription).toBe(true) })
      expect(handle.hostDescription.getSnapshot()).toBeUndefined()
      expect(connected).not.toHaveBeenCalled()
    } finally {
      stopDescription()
      loop.stop()
    }
  })

  it('retracts the host description while reconnecting and republishes the next generation', async () => {
    ;(globalThis as Win).location = { hostname: 'localhost', search: '?fixture' }
    /** 中文说明：当前场景驱动的连接或 API 测试对象；变量 `handle` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const handle = await mount()
    /** 中文说明：按发生顺序收集观测值的数组或记录集合；变量 `descriptions` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const descriptions: Array<boolean | undefined> = []
    /** 中文说明：按发生顺序收集观测值的数组或记录集合；变量 `reconnectSnapshots` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const reconnectSnapshots: Array<boolean | undefined> = []
    /** 中文说明：结束注册、订阅或异步等待的清理函数；变量 `stopDescription` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const stopDescription = handle.hostDescription.subscribe(() => {
      descriptions.push(handle.hostDescription.getSnapshot()?.canOpenPath)
    })
    /** 中文说明：记录调用并隔离外部输出的 Vitest 测试替身；变量 `warnSpy` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `loop` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const loop = handle.start({
      onStateChange: (state) => {
        if (state === 'reconnecting') {
          reconnectSnapshots.push(handle.hostDescription.getSnapshot()?.canOpenPath)
        }
      },
    }, { backoffBaseMs: 10, backoffFactor: 1, backoffMaxMs: 10, streamOpenTimeoutMs: 500 })
    try {
      await vi.waitFor(() => {
        expect(handle.hostDescription.getSnapshot()?.canOpenPath).toBe(true)
      })
      /** 中文说明：当前场景输入、传输或校验的数据；变量 `timing` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
      const timing = (globalThis as Record<string, unknown>).__fxTiming as
        | { breakStreams(): void }
        | undefined
      if (timing === undefined) throw new Error('fixture timing hooks missing')
      timing.breakStreams()

      await vi.waitFor(() => { expect(reconnectSnapshots).toEqual([undefined]) })
      await vi.waitFor(() => { expect(descriptions).toEqual([true, undefined, true]) })
      expect(handle.hostDescription.getSnapshot()?.canOpenPath).toBe(true)
    } finally {
      stopDescription()
      loop.stop()
      warnSpy.mockRestore()
    }
  })

  it('WebApiClient keeps unary calls and respond on globalThis.fetch', async () => {
    ;(globalThis as Win).location = { hostname: 'localhost', search: '' }
    /** 中文说明：当前场景驱动的连接或 API 测试对象；变量 `handle` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const handle = await mount()
    /** 中文说明：测试前保存的原始全局值，用于结束后恢复；变量 `original` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const original = globalThis.fetch
    /** 中文说明：按发生顺序收集观测值的数组或记录集合；变量 `seen` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const seen: string[] = []
    globalThis.fetch = (input: URL | RequestInfo) => {
      seen.push(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
      return Promise.resolve(new Response('{}', { status: 200 }))
    }
    try {
      // Schema rejection is fine — the transport hop is the assertion.
      await (handle.api as WebApiClient).host.describe({}).catch(() => undefined)
      await handle.api.respond({
        type: 'client-response',
        rpcId: RpcId('response-over-http'),
        result: { ok: true, value: {} },
      }).catch(() => undefined)
    } finally {
      globalThis.fetch = original
    }
    expect(seen.some(u => u.includes('/api/host.describe'))).toBe(true)
    expect(seen.some(u => u.includes('/api/respond'))).toBe(true)
  })

  it('opens one WebSocket per downlink, parses frames, and aborts both without using fetch', async () => {
    ;(globalThis as Win).location = {
      hostname: 'localhost', search: '', origin: 'http://localhost:3080',
    }
    ;(globalThis as WebSocketGlobal).WebSocket = FakeWebSocket as unknown as typeof WebSocket
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `fetch` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const fetch = vi.spyOn(globalThis, 'fetch')
    /** 中文说明：当前场景驱动的连接或 API 测试对象；变量 `client` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const client = (await mount()).api as WebApiClient
    /** 中文说明：按发生顺序收集观测值的数组或记录集合；变量 `envelopes` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const envelopes: RpcMessage[][] = []
    client.subscribeEnvelopes((batch) => { envelopes.push([...batch]) })
    /** 中文说明：按发生顺序收集观测值的数组或记录集合；变量 `opened` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const opened: string[] = []
    /** 中文说明：控制或记录异步操作取消状态的对象；变量 `muxAbort` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const muxAbort = new AbortController()
    /** 中文说明：控制或记录异步操作取消状态的对象；变量 `hostAbort` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const hostAbort = new AbortController()
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `mux` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const mux = client.events.mux({}, muxAbort.signal, () => { opened.push('mux') })[Symbol.asyncIterator]()
    /** 中文说明：当前场景使用的临时宿主或服务器对象；变量 `host` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const host = client.events.host({}, hostAbort.signal, () => { opened.push('host') })[Symbol.asyncIterator]()
    /** 中文说明：当前场景输入、传输或校验的数据；变量 `muxFrame` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const muxFrame = mux.next()
    /** 中文说明：当前场景使用的临时宿主或服务器对象；变量 `hostFrame` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const hostFrame = host.next()
    await vi.waitFor(() => { expect(sockets).toHaveLength(2) })
    expect(sockets.map(socket => socket.url)).toEqual([
      'ws://localhost:3080/api/events.mux',
      'ws://localhost:3080/api/events.host',
    ])
    await vi.waitFor(() => { expect(opened).toEqual(['mux', 'host']) })

    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `errors` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    sockets[0]!.receive(new Uint8Array([1, 2, 3]))
    sockets[1]!.receive(JSON.stringify({ type: 'server-request', rpcId: 'bad', method: 'host/session-status', payload: {} }))
    sockets[0]!.receive(JSON.stringify({
      type: 'server-request',
      rpcId: 'mux-browser',
      method: 'session/subscribed',
      payload: { type: 'session/subscribed', sessionId: 'session-browser', lastSeq: 8 },
    }))
    sockets[1]!.receive(JSON.stringify({
      type: 'server-request',
      rpcId: 'host-browser',
      method: 'host/remote-event',
      payload: { type: 'host/remote-event', event: 'commands/change', args: [] },
    }))
    expect(await muxFrame).toMatchObject({
      value: { rpcId: 'mux-browser', payload: { type: 'session/subscribed', lastSeq: 8 } },
    })
    expect(await hostFrame).toMatchObject({
      value: { rpcId: 'host-browser', payload: { type: 'host/remote-event', event: 'commands/change' } },
    })
    expect(errors).toHaveBeenCalledTimes(2)
    await vi.waitFor(() => { expect(envelopes.flat()).toHaveLength(2) })
    expect(fetch).not.toHaveBeenCalled()

    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `muxEnd` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const muxEnd = mux.next()
    /** 中文说明：当前场景使用的临时宿主或服务器对象；变量 `hostEnd` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const hostEnd = host.next()
    muxAbort.abort()
    hostAbort.abort()
    await expect(muxEnd).resolves.toMatchObject({ done: true })
    await expect(hostEnd).resolves.toMatchObject({ done: true })
    expect(sockets.every(socket => socket.readyState === FakeWebSocket.CLOSED)).toBe(true)
    errors.mockRestore()
    fetch.mockRestore()
  })

  it('maps an HTTPS page origin to a secure WebSocket URL', async () => {
    ;(globalThis as Win).location = {
      hostname: 'harness.example', search: '', origin: 'https://harness.example',
    }
    ;(globalThis as WebSocketGlobal).WebSocket = FakeWebSocket as unknown as typeof WebSocket
    /** 中文说明：当前场景驱动的连接或 API 测试对象；变量 `client` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const client = (await mount()).api
    /** 中文说明：控制或记录异步操作取消状态的对象；变量 `abort` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const abort = new AbortController()
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `iterator` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const iterator = client.events.mux({}, abort.signal)[Symbol.asyncIterator]()
    /** 中文说明：固定异步执行顺序或等待生命周期事件的 Promise 或门控值；变量 `pending` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const pending = iterator.next()
    await vi.waitFor(() => { expect(sockets[0]?.url).toBe('wss://harness.example/api/events.mux') })
    abort.abort()
    await expect(pending).resolves.toMatchObject({ done: true })
  })

  it('closes a WebSocket immediately when its signal was already aborted', async () => {
    ;(globalThis as Win).location = {
      hostname: 'localhost', search: '', origin: 'http://localhost:3080',
    }
    ;(globalThis as WebSocketGlobal).WebSocket = FakeWebSocket as unknown as typeof WebSocket
    /** 中文说明：当前场景驱动的连接或 API 测试对象；变量 `client` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const client = (await mount()).api
    /** 中文说明：控制或记录异步操作取消状态的对象；变量 `abort` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const abort = new AbortController()
    abort.abort()
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `iterator` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const iterator = client.events.mux({}, abort.signal)[Symbol.asyncIterator]()
    await expect(iterator.next()).resolves.toMatchObject({ done: true })
    expect(sockets).toHaveLength(1)
    expect(sockets[0]?.readyState).toBe(FakeWebSocket.CLOSED)
  })

  it('carries RPC calls without requiring secure-context randomUUID', async () => {
    ;(globalThis as Win).location = { hostname: 'localhost', search: '' }
    vi.stubGlobal('crypto', {
      getRandomValues(bytes: Uint8Array) {
        return bytes.fill(0)
      },
    })
    /** 中文说明：当前场景驱动的连接或 API 测试对象；变量 `handle` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const handle = await mount()
    /** 中文说明：测试前保存的原始全局值，用于结束后恢复；变量 `original` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const original = globalThis.fetch
    /** 中文说明：按发生顺序收集观测值的数组或记录集合；变量 `seen` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const seen: { url: string; body: unknown }[] = []
    globalThis.fetch = async (input: URL | RequestInfo, init?: RequestInit) => {
      /** 中文说明：当前请求或临时服务使用的地址信息；变量 `url` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (typeof init?.body !== 'string') throw new TypeError('expected a JSON string request body')
      /** 中文说明：当前场景输入、传输或校验的数据；变量 `body` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
      const body = JSON.parse(init.body) as { rpcId: string }
      seen.push({ url, body })
      return Response.json({
        type: 'server-response',
        rpcId: body.rpcId,
        result: { ok: true, value: { ref: 'goal-1' } },
      })
    }
    try {
      await expect(handle.rpc.call('/api', 'goals/create', { args: { agentId: 'agent-1' } }))
        .resolves.toEqual({ ok: true, value: { ref: 'goal-1' } })
    } finally {
      globalThis.fetch = original
      vi.unstubAllGlobals()
    }
    expect(seen).toHaveLength(1)
    expect(seen[0]?.url).toBe('http://dsh.internal/api/goals/create')
    expect(seen[0]?.body).toMatchObject({
      type: 'client-request',
      rpcId: '00000000-0000-4000-8000-000000000000',
      method: 'goals/create',
      payload: { args: { agentId: 'agent-1' } },
    })
  })

  it('validates generic RPC transport failures, correlation, and targets', async () => {
    ;(globalThis as Win).location = {
      hostname: 'harness.example', search: '', origin: 'https://harness.example',
    }
    /** 中文说明：当前场景驱动的连接或 API 测试对象；变量 `handle` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const handle = await mount()
    /** 中文说明：测试前保存的原始全局值，用于结束后恢复；变量 `original` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const original = globalThis.fetch
    /** 中文说明：控制或记录异步操作取消状态的对象；变量 `abort` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const abort = new AbortController()
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('unavailable', { status: 503 }))
    try {
      await expect(handle.rpc.call('/api', 'goals/create', {}, abort.signal))
        .rejects.toThrow('HTTP 503')
      expect(globalThis.fetch).toHaveBeenCalledWith(
        new URL('https://harness.example/api/goals/create'),
        expect.objectContaining({ signal: abort.signal }),
      )

      ;(globalThis as Win).location = { hostname: 'localhost', search: '', origin: 'null' }
      globalThis.fetch = vi.fn().mockResolvedValue(Response.json({
        type: 'server-response',
        rpcId: 'different-rpc',
        result: { ok: true, value: null },
      }))
      await expect(handle.rpc.call('/api', 'goals/create', {})).rejects.toThrow('rpcId mismatch')
      /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `fetch` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
      const fetch = vi.mocked(globalThis.fetch)
      expect(fetch.mock.calls[0]?.[0]).toEqual(new URL('http://dsh.internal/api/goals/create'))
      expect(fetch.mock.calls[0]?.[1]).not.toHaveProperty('signal')
    } finally {
      globalThis.fetch = original
    }

    /** 中文说明：当前请求或临时服务使用的地址信息；变量 `[channel` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    for (const [channel, endpoint] of [
      ['api2', 'goals/create'],
      ['/api/path', 'goals/create'],
      ['/api', ''],
      ['/api', '.'],
      ['/api', '..'],
      ['/api', 'goals//create'],
      ['/api', 'goals/create?unsafe'],
    ] as const) {
      await expect(handle.rpc.call(channel, endpoint, {})).rejects.toThrow('invalid RPC target')
    }
  })

  it('carries Goal Remotes over the same state as the client-only fixture API', async () => {
    ;(globalThis as Win).location = { hostname: 'localhost', search: '?fixture' }
    /** 中文说明：当前场景驱动的连接或 API 测试对象；变量 `handle` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const handle = await mount()
    /** 中文说明：当前操作得到的响应或结果，供后续断言；变量 `created` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const created = await handle.rpc.call('/api', 'goals/create', {
      args: { agentId: 'fx-alpha', request: { objective: 'fixture remote' } },
    })
    expect(created).toMatchObject({ ok: true, value: { ref: { revision: 1 } } })
    if (!created.ok) throw new Error('fixture Goal create failed')
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `ref` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const ref = (created.value as { ref: { id: string; revision: number } }).ref
    /** 中文说明：当前操作得到的响应或结果，供后续断言；变量 `edited` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const edited = await handle.rpc.call('/api', 'goals/edit', {
      args: { agentId: 'fx-alpha', ref, request: { objective: 'edited fixture remote' } },
    })
    expect(edited).toMatchObject({ ok: true, value: { objective: 'edited fixture remote', revision: 2 } })
    /** 中文说明：当前操作得到的响应或结果，供后续断言；变量 `editedRef` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const editedRef = { id: ref.id, revision: 2 }
    /** 中文说明：当前操作得到的响应或结果，供后续断言；变量 `paused` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const paused = await handle.rpc.call('/api', 'goals/pause', {
      args: { agentId: 'fx-alpha', ref: editedRef },
    })
    expect(paused).toMatchObject({ ok: true, value: { phase: 'paused', activation: 'disarmed', revision: 3 } })
    /** 中文说明：当前操作得到的响应或结果，供后续断言；变量 `resumed` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const resumed = await handle.rpc.call('/api', 'goals/resume', {
      args: { agentId: 'fx-alpha', ref: { id: ref.id, revision: 3 } },
    })
    expect(resumed).toMatchObject({ ok: true, value: { phase: 'active', activation: 'armed', revision: 4 } })
    /** 中文说明：当前操作得到的响应或结果，供后续断言；变量 `completed` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const completed = await handle.rpc.call('/api', 'goals/complete', {
      args: { agentId: 'fx-alpha', ref: { id: ref.id, revision: 4 } },
    })
    expect(completed).toMatchObject({ ok: true, value: { phase: 'complete', activation: 'disarmed', revision: 5 } })
    await expect(handle.rpc.call('/api', 'goals/clear', {
      args: { agentId: 'fx-alpha', ref: { id: ref.id, revision: 5 } },
    })).resolves.toEqual({ ok: true, value: { id: ref.id, revision: 6 } })
    await expect(handle.rpc.call('/other', 'goals/create', {})).rejects.toThrow(/channel.*unavailable/)
    await expect(handle.rpc.call('/api', 'unknown/read', { args: { agentId: 'fx-alpha' } }))
      .rejects.toThrow(/endpoint.*unavailable/)
  })
})
