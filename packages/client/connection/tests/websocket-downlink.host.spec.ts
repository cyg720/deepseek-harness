/**
 * 文件职责：验证宿主 WebSocket 下行的帧泵送、协议拒绝、异常帧、取消与关闭等待。
 * 技术维度：Node HTTP、ws、异步生成器、AbortSignal、Vitest 间谍与同步门 Promise。
 * 产品维度：确保浏览器事件流可靠结束，客户端违规上行被拒绝，宿主清理不会遗留后台任务。
 * 逻辑维度：启动临时服务器和下行管理器，连接真实 WebSocket，操纵事件源或套接字，再检查帧和生命周期。
 * 关键边界：每个临时服务器与套接字都必须清理；竞态用门控 Promise 固定顺序，不能依赖任意延时。
 * 新手阅读建议：先读 untilAbort、idle、serve、read，再按正常传输、违规、失败和 close 竞态阅读。
 */
import { once } from 'node:events'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import WebSocket from 'ws'
import type {
  ApiProxy, HostFrame, MuxFrame, RpcRequest, ServerRequest,
} from '@deepseek-ai/dsh-host-apiproxy/api'
import { RpcId } from '@deepseek-ai/dsh-host-apiproxy/api'
import { HOST_EVENTS_PATH, MUX_EVENTS_PATH } from '../src/api-path.ts'
import { WebSocketDownlinks } from '../src/websocket-downlink.ts'

/** 中文说明：测试类型 `MuxSource`，约束本文件夹具或观测值的字段，避免模拟数据偏离生产接口。 */
type MuxSource = (signal: AbortSignal) => AsyncIterable<RpcRequest<MuxFrame>>
/** 中文说明：测试类型 `HostSource`，约束本文件夹具或观测值的字段，避免模拟数据偏离生产接口。 */
type HostSource = (signal: AbortSignal) => AsyncIterable<RpcRequest<HostFrame>>

/** 中文说明：按发生顺序收集观测值的数组或记录集合；变量 `running` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
const running: (() => Promise<void>)[] = []

afterEach(async () => {
  await Promise.all(running.splice(0).map(close => close()))
})

/** 中文说明：测试辅助函数 `untilAbort`；参数含义见签名，返回值供当前场景驱动或断言；例如按下方测试调用方式使用。 */
function untilAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve()
  return new Promise((resolve) => {
    signal.addEventListener('abort', () => { resolve() }, { once: true })
  })
}

/** 中文说明：测试辅助函数 `idle`；参数含义见签名，返回值供当前场景驱动或断言；例如按下方测试调用方式使用。 */
async function * idle<F>(signal: AbortSignal): AsyncGenerator<RpcRequest<F>> {
  await untilAbort(signal)
}

/** 中文说明：测试辅助函数 `api`；参数含义见签名，返回值供当前场景驱动或断言；例如按下方测试调用方式使用。 */
function api(mux: MuxSource, host: HostSource): ApiProxy {
  return {
    events: {
      mux: (_request, signal) => mux(signal),
      host: (_request, signal) => host(signal),
    },
  } as ApiProxy
}

/** 中文说明：测试辅助函数 `serve`；参数含义见签名，返回值供当前场景驱动或断言；例如按下方测试调用方式使用。 */
async function serve(downlinks: WebSocketDownlinks): Promise<{
  origin: string
  close: () => Promise<void>
}> {
  /** 中文说明：当前场景使用的临时宿主或服务器对象；变量 `server` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
  const server = createServer()
  server.on('upgrade', (request, socket, head) => {
    /** 中文说明：当前请求或临时服务使用的地址信息；变量 `pathname` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const pathname = new URL(request.url ?? '/', 'http://dsh.internal').pathname
    if (pathname === MUX_EVENTS_PATH) downlinks.handleMux(request, socket, head)
    else if (pathname === HOST_EVENTS_PATH) downlinks.handleHost(request, socket, head)
    else socket.destroy()
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  /** 中文说明：当前请求或临时服务使用的地址信息；变量 `port` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
  const port = (server.address() as AddressInfo).port
  return {
    origin: `ws://127.0.0.1:${String(port)}`,
    close: async () => {
      await downlinks.close()
      await new Promise<void>(resolve => server.close(() => { resolve() }))
    },
  }
}

/** 中文说明：测试辅助函数 `read`；参数含义见签名，返回值供当前场景驱动或断言；例如按下方测试调用方式使用。 */
function read(socket: WebSocket): Promise<ServerRequest> {
  return once(socket, 'message').then(([data]) => JSON.parse(String(data)) as ServerRequest)
}

/** 中文说明：测试辅助函数 `acceptedSocket`；参数含义见签名，返回值供当前场景驱动或断言；例如按下方测试调用方式使用。 */
async function acceptedSocket(downlinks: WebSocketDownlinks): Promise<WebSocket> {
  /** 中文说明：当前场景使用的临时宿主或服务器对象；变量 `server` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
  const server = (downlinks as unknown as { server: { clients: Set<WebSocket> } }).server
  /** 中文说明：当前场景使用或观察的 WebSocket 或流套接字；变量 `accepted: WebSocket | undefined` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
  let accepted: WebSocket | undefined
  await vi.waitFor(() => {
    accepted = server.clients.values().next().value
    expect(accepted).toBeDefined()
  })
  return accepted as WebSocket
}

describe('WebSocket downlinks', () => {
  it('carries mux and host over independent downstream sockets and cancels each source on close', async () => {
    /** 中文说明：控制或记录异步操作取消状态的对象；变量 `muxAborted` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    let muxAborted = false
    /** 中文说明：控制或记录异步操作取消状态的对象；变量 `hostAborted` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    let hostAborted = false
    /** 中文说明：当前场景驱动的连接或 API 测试对象；变量 `downlinks` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const downlinks = new WebSocketDownlinks(api(
      async function * (signal) {
        try {
          yield {
            rpcId: RpcId('mux-1'),
            payload: { type: 'session/subscribed', sessionId: 'session-1' as never, lastSeq: 4 },
          }
          await untilAbort(signal)
        } finally {
          muxAborted = true
        }
      },
      async function * (signal) {
        try {
          yield { rpcId: RpcId('host-1'), payload: { type: 'host/remote-event', event: 'commands/change', args: [] } }
          await untilAbort(signal)
        } finally {
          hostAborted = true
        }
      },
    ))
    /** 中文说明：当前场景使用的临时宿主或服务器对象；变量 `host` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const host = await serve(downlinks)
    running.push(host.close)

    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `mux` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const mux = new WebSocket(`${host.origin}${MUX_EVENTS_PATH}`)
    /** 中文说明：当前场景使用或观察的 WebSocket 或流套接字；变量 `hostSocket` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const hostSocket = new WebSocket(`${host.origin}${HOST_EVENTS_PATH}`)
    /** 中文说明：当前场景输入、传输或校验的数据；变量 `muxFrame` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const muxFrame = read(mux)
    /** 中文说明：当前场景使用的临时宿主或服务器对象；变量 `hostFrame` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const hostFrame = read(hostSocket)
    expect(await muxFrame).toEqual({
      type: 'server-request',
      rpcId: 'mux-1',
      method: 'session/subscribed',
      payload: { type: 'session/subscribed', sessionId: 'session-1', lastSeq: 4 },
    })
    expect(await hostFrame).toEqual({
      type: 'server-request',
      rpcId: 'host-1',
      method: 'host/remote-event',
      payload: { type: 'host/remote-event', event: 'commands/change', args: [] },
    })

    /** 中文说明：固定异步执行顺序或等待生命周期事件的 Promise 或门控值；变量 `muxClosed` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const muxClosed = once(mux, 'close')
    /** 中文说明：固定异步执行顺序或等待生命周期事件的 Promise 或门控值；变量 `hostClosed` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const hostClosed = once(hostSocket, 'close')
    mux.close()
    hostSocket.close()
    await Promise.all([muxClosed, hostClosed])
    await vi.waitFor(() => {
      expect(muxAborted).toBe(true)
      expect(hostAborted).toBe(true)
    })
  })

  it('rejects client messages because upstream remains HTTP', async () => {
    /** 中文说明：控制或记录异步操作取消状态的对象；变量 `aborted` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    let aborted = false
    /** 中文说明：当前场景驱动的连接或 API 测试对象；变量 `downlinks` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const downlinks = new WebSocketDownlinks(api(
      async function * (signal) {
        try {
          await untilAbort(signal)
        } finally {
          aborted = true
        }
      },
      idle,
    ))
    /** 中文说明：当前场景使用的临时宿主或服务器对象；变量 `host` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const host = await serve(downlinks)
    running.push(host.close)
    /** 中文说明：当前场景使用或观察的 WebSocket 或流套接字；变量 `socket` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const socket = new WebSocket(`${host.origin}${MUX_EVENTS_PATH}`)
    await once(socket, 'open')
    /** 中文说明：固定异步执行顺序或等待生命周期事件的 Promise 或门控值；变量 `closed` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const closed = once(socket, 'close')
    socket.send('upstream payload')
    /** 中文说明：用于记录次数、编号或状态码的标量值；变量 `[code, reason]` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const [code, reason] = await closed as [number, Buffer]
    expect(code).toBe(1008)
    expect(String(reason)).toBe('downlink only')
    await vi.waitFor(() => { expect(aborted).toBe(true) })
  })

  it('sends stream/error before closing when a source fails', async () => {
    /** 中文说明：当前场景驱动的连接或 API 测试对象；变量 `downlinks` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const downlinks = new WebSocketDownlinks(api(
      async function * () {
        throw new Error('mux source failed')
      },
      idle,
    ))
    /** 中文说明：当前场景使用的临时宿主或服务器对象；变量 `host` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const host = await serve(downlinks)
    running.push(host.close)
    /** 中文说明：当前场景使用或观察的 WebSocket 或流套接字；变量 `socket` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const socket = new WebSocket(`${host.origin}${MUX_EVENTS_PATH}`)
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `failure` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const failure = read(socket)
    /** 中文说明：固定异步执行顺序或等待生命周期事件的 Promise 或门控值；变量 `closed` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const closed = once(socket, 'close')
    expect((await failure).payload).toEqual({
      type: 'stream/error',
      error: { code: 'internal', message: 'Error: mux source failed', details: {} },
    })
    await closed
  })

  it('aborts the source when an accepted socket reports a transport error', async () => {
    /** 中文说明：控制或记录异步操作取消状态的对象；变量 `aborted` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    let aborted = false
    /** 中文说明：当前场景驱动的连接或 API 测试对象；变量 `downlinks` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const downlinks = new WebSocketDownlinks(api(
      async function * (signal) {
        try {
          await untilAbort(signal)
        } finally {
          aborted = true
        }
      },
      idle,
    ))
    /** 中文说明：当前场景使用的临时宿主或服务器对象；变量 `host` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const host = await serve(downlinks)
    running.push(host.close)
    /** 中文说明：当前场景使用或观察的 WebSocket 或流套接字；变量 `socket` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const socket = new WebSocket(`${host.origin}${MUX_EVENTS_PATH}`)
    await once(socket, 'open')
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `accepted` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const accepted = await acceptedSocket(downlinks)
    /** 中文说明：固定异步执行顺序或等待生命周期事件的 Promise 或门控值；变量 `closed` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const closed = once(socket, 'close')
    accepted.emit('error', new Error('transport failed'))
    await closed
    expect(aborted).toBe(true)
  })

  it('drops a source frame that races after the client has closed', async () => {
    /** 中文说明：结束注册、订阅或异步等待的清理函数；变量 `release` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    let release!: () => void
    /** 中文说明：固定异步执行顺序或等待生命周期事件的 Promise 或门控值；变量 `gate` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const gate = new Promise<void>((resolve) => { release = resolve })
    /** 中文说明：结束注册、订阅或异步等待的清理函数；变量 `finish` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    let finish!: () => void
    /** 中文说明：固定异步执行顺序或等待生命周期事件的 Promise 或门控值；变量 `finished` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const finished = new Promise<void>((resolve) => { finish = resolve })
    /** 中文说明：控制或记录异步操作取消状态的对象；变量 `sourceSignal: AbortSignal | undefined` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    let sourceSignal: AbortSignal | undefined
    /** 中文说明：当前场景驱动的连接或 API 测试对象；变量 `downlinks` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const downlinks = new WebSocketDownlinks(api(
      async function * (signal) {
        sourceSignal = signal
        try {
          await gate
          yield {
            rpcId: RpcId('late'),
            payload: { type: 'session/subscribed', sessionId: 'session-late' as never, lastSeq: 0 },
          }
        } finally {
          finish()
        }
      },
      idle,
    ))
    /** 中文说明：当前场景使用的临时宿主或服务器对象；变量 `host` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const host = await serve(downlinks)
    running.push(host.close)
    /** 中文说明：当前场景使用或观察的 WebSocket 或流套接字；变量 `socket` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const socket = new WebSocket(`${host.origin}${MUX_EVENTS_PATH}`)
    await once(socket, 'open')
    /** 中文说明：固定异步执行顺序或等待生命周期事件的 Promise 或门控值；变量 `closed` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const closed = once(socket, 'close')
    socket.close()
    await closed
    await vi.waitFor(() => { expect(sourceSignal?.aborted).toBe(true) })
    release()
    await finished
  })

  it('contains socket send callback failures and closes the downlink', async () => {
    /** 中文说明：结束注册、订阅或异步等待的清理函数；变量 `release` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    let release!: () => void
    /** 中文说明：固定异步执行顺序或等待生命周期事件的 Promise 或门控值；变量 `gate` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const gate = new Promise<void>((resolve) => { release = resolve })
    /** 中文说明：当前场景驱动的连接或 API 测试对象；变量 `downlinks` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const downlinks = new WebSocketDownlinks(api(
      async function * () {
        await gate
        yield {
          rpcId: RpcId('send-failure'),
          payload: { type: 'session/subscribed', sessionId: 'session-send' as never, lastSeq: 0 },
        }
      },
      idle,
    ))
    /** 中文说明：当前场景使用的临时宿主或服务器对象；变量 `host` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const host = await serve(downlinks)
    running.push(host.close)
    /** 中文说明：当前场景使用或观察的 WebSocket 或流套接字；变量 `socket` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const socket = new WebSocket(`${host.origin}${MUX_EVENTS_PATH}`)
    await once(socket, 'open')
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `accepted` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const accepted = await acceptedSocket(downlinks)
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `send` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const send = vi.spyOn(accepted, 'send').mockImplementation(((
      _data: unknown,
      optionsOrCallback?: unknown,
      callback?: (error?: Error) => void,
    ) => {
      /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `done` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
      const done = typeof optionsOrCallback === 'function'
        ? optionsOrCallback as (error?: Error) => void
        : callback
      done?.(new Error('socket send failed'))
    }) as WebSocket['send'])
    /** 中文说明：固定异步执行顺序或等待生命周期事件的 Promise 或门控值；变量 `closed` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const closed = once(socket, 'close')
    release()
    await closed
    expect(send).toHaveBeenCalledTimes(2)
    send.mockRestore()
  })

  it('rejects when its acceptor has already closed', async () => {
    /** 中文说明：当前场景驱动的连接或 API 测试对象；变量 `downlinks` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const downlinks = new WebSocketDownlinks(api(idle, idle))
    await downlinks.close()
    await expect(downlinks.close()).rejects.toThrow('The server is not running')
  })

  it('waits for source cleanup before teardown resolves', async () => {
    /** 中文说明：固定异步执行顺序或等待生命周期事件的 Promise 或门控值；变量 `cleanupStarted` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    let cleanupStarted!: () => void
    /** 中文说明：固定异步执行顺序或等待生命周期事件的 Promise 或门控值；变量 `started` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const started = new Promise<void>((resolve) => { cleanupStarted = resolve })
    /** 中文说明：结束注册、订阅或异步等待的清理函数；变量 `releaseCleanup` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    let releaseCleanup!: () => void
    /** 中文说明：固定异步执行顺序或等待生命周期事件的 Promise 或门控值；变量 `cleanupGate` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const cleanupGate = new Promise<void>((resolve) => { releaseCleanup = resolve })
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `cleaned` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    let cleaned = false
    /** 中文说明：当前场景驱动的连接或 API 测试对象；变量 `downlinks` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const downlinks = new WebSocketDownlinks(api(
      async function * (signal) {
        try {
          await untilAbort(signal)
        } finally {
          cleanupStarted()
          await cleanupGate
          cleaned = true
        }
      },
      idle,
    ))
    /** 中文说明：当前场景使用的临时宿主或服务器对象；变量 `host` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const host = await serve(downlinks)
    /** 中文说明：当前场景使用或观察的 WebSocket 或流套接字；变量 `socket` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const socket = new WebSocket(`${host.origin}${MUX_EVENTS_PATH}`)
    await once(socket, 'open')
    /** 中文说明：固定异步执行顺序或等待生命周期事件的 Promise 或门控值；变量 `closed` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    let closed = false
    /** 中文说明：固定异步执行顺序或等待生命周期事件的 Promise 或门控值；变量 `closing` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const closing = host.close().then(() => { closed = true })
    try {
      await started
      expect(closed).toBe(false)
      releaseCleanup()
      await closing
      expect(cleaned).toBe(true)
    } finally {
      releaseCleanup()
      await closing
    }
  })
})
