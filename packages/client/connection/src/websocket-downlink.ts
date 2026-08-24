/** Host-side WebSocket carrier for the two server-to-browser event streams. */
/**
 * 文件职责：实现宿主端两条只下行 WebSocket 事件流的升级、帧发送、错误报告和统一关闭。
 * 技术维度：使用 ws 的 noServer 模式、Node 原始 Duplex、AbortController、异步迭代器和 UUID 关联编号。
 * 产品维度：让浏览器持续收到复用事件和主机事件，同时阻止客户端把 WebSocket 当作上行通道。
 * 逻辑维度：HTTP 升级后创建取消控制器，泵送 API Proxy 事件帧；出错时尽力发送失败帧，最后关闭双方。
 * 关键边界：客户端消息属于协议违规并以 1008 关闭；套接字丢失时错误帧可能无法送达；close 会等待所有泵结束。
 * 新手阅读建议：先看 handleMux/handleHost 如何选择源流，再看 upgrade 建立生命周期，最后阅读 pump 的异常与清理逻辑。
 */

import { randomUUID } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import WebSocket, { WebSocketServer } from 'ws'
import type {
  ApiProxy, HostFrame, MuxFrame, RpcRequest, ServerRequest,
} from '@deepseek-ai/dsh-host-apiproxy/api'
import { RpcId } from '@deepseek-ai/dsh-host-apiproxy/api'

/** 中文说明：该载体允许发送的两类下行帧联合类型。 */
type Frame = MuxFrame | HostFrame

/** 中文说明：把内部 RPC 帧转换为网络信封；参数是帧；返回服务端请求，例如发送前调用。 */
function serverRequest(frame: RpcRequest<Frame>): ServerRequest {
  return {
    type: 'server-request',
    rpcId: frame.rpcId,
    method: frame.payload.type,
    payload: frame.payload,
  }
}

/** 中文说明：向打开的套接字发送一帧；参数是套接字和帧；成功送入 ws 时完成，失败时拒绝，例如泵循环逐帧等待。 */
function send(socket: WebSocket, frame: RpcRequest<Frame>): Promise<void> {
  return new Promise((resolve, reject) => {
    if (socket.readyState !== WebSocket.OPEN) {
      reject(new Error('websocket downlink closed before frame delivery'))
      return
    }
    socket.send(JSON.stringify(serverRequest(frame)), (error) => {
      if (error) reject(error)
      else resolve()
    })
  })
}

/** 中文说明：把未知异常转换为下行错误帧；参数是异常值；返回带随机关联编号的帧，例如泵送失败时发送。 */
function failureFrame(error: unknown): RpcRequest<Frame> {
  return {
    rpcId: RpcId(randomUUID()),
    payload: {
      type: 'stream/error',
      error: { code: 'internal', message: String(error), details: {} },
    },
  }
}

/**
 * Owns WebSocket negotiation and frame pumping for the connection plugin's
 * two downlinks. Client messages are a protocol violation: upstream traffic
 * remains on HTTP.
 */
/** 中文说明：管理两条只下行 WebSocket 的升级与帧泵送；上行业务请求始终保留在 HTTP。 */
export class WebSocketDownlinks {
  /** 中文说明：不自行监听端口的 WebSocket 服务器，只接收现有 HTTP 服务器交付的升级。 */
  private readonly server = new WebSocketServer({ noServer: true })
  /** 中文说明：仍在运行的帧泵 Promise 集合，用于关闭时等待全部结束。 */
  private readonly pumps = new Set<Promise<void>>()

  /** @param api - host API supplying the typed event streams. */
  /** 中文说明：创建下行管理器；`api` 提供类型化事件流；例如 `new WebSocketDownlinks(apiProxy)`。 */
  constructor(private readonly api: ApiProxy) {}

  /**
   * Upgrade one socket and pump the mux stream until either side closes.
   * @param req - HTTP upgrade request.
   * @param socket - Raw socket transferred by the HTTP server.
   * @param head - Bytes already read after the upgrade headers.
   */
  /** 中文说明：升级并泵送复用事件；参数是请求、原始套接字和已预读字节；无返回值，例如升级路由收到 MUX 路径时调用。 */
  handleMux(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    this.upgrade(req, socket, head, signal => this.api.events.mux({
      rpcId: RpcId(randomUUID()),
      payload: {},
    }, signal))
  }

  /**
   * Upgrade one socket and pump the host stream until either side closes.
   * @param req - HTTP upgrade request.
   * @param socket - Raw socket transferred by the HTTP server.
   * @param head - Bytes already read after the upgrade headers.
   */
  /** 中文说明：升级并泵送主机事件；参数是请求、原始套接字和已预读字节；无返回值，例如升级路由收到 HOST 路径时调用。 */
  handleHost(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    this.upgrade(req, socket, head, signal => this.api.events.host({
      rpcId: RpcId(randomUUID()),
      payload: {},
    }, signal))
  }

  /**
   * Terminate owned sockets and await the no-server acceptor plus frame pumps.
   * @returns A promise resolving after every socket and source iterator stops.
   */
  /** 中文说明：终止所有套接字并等待服务器和帧泵停止；无参数；返回清理 Promise，例如插件 effect 销毁时 `await downlinks.close()`。 */
  async close(): Promise<void> {
    for (const socket of this.server.clients) socket.terminate()
    await new Promise<void>((resolve, reject) => {
      this.server.close((error) => {
        if (error === undefined) resolve()
        else reject(error)
      })
    })
    await Promise.all(this.pumps)
  }

  /** 中文说明：接管一次 HTTP 升级并启动事件泵；参数为请求、套接字、预读字节和流打开函数；无返回值。 */
  private upgrade<F extends Frame>(
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    open: (signal: AbortSignal) => AsyncIterable<RpcRequest<F>>,
  ): void {
    this.server.handleUpgrade(req, socket, head, (websocket) => {
      /** 中文说明：连接关闭或错误时取消上游事件迭代器的控制器。 */
      const abort = new AbortController()
      websocket.once('close', () => { abort.abort() })
      websocket.once('error', () => { abort.abort() })
      websocket.once('message', () => {
        websocket.close(1008, 'downlink only')
      })
      /** 中文说明：当前连接的帧泵 Promise；加入集合后会在结束时自行移除。 */
      const pump = this.pump(websocket, open(abort.signal), abort)
      this.pumps.add(pump)
      void pump.then(() => { this.pumps.delete(pump) })
    })
  }

  /** 中文说明：逐帧发送一个异步事件流；参数是套接字、帧源和取消控制器；返回结束 Promise，例如 upgrade 建连后启动。 */
  private async pump<F extends Frame>(
    socket: WebSocket,
    frames: AsyncIterable<RpcRequest<F>>,
    abort: AbortController,
  ): Promise<void> {
    try {
      for await (const frame of frames) await send(socket, frame)
    } catch (error) {
      if (!abort.signal.aborted) {
        try {
          await send(socket, failureFrame(error))
        } catch {
          // Socket loss won the race; no downstream remains to receive the failure frame.
          // 中文说明：套接字先断开时已无接收方，发送失败无需继续传播。
        }
      }
    } finally {
      abort.abort()
      if (socket.readyState === WebSocket.OPEN) socket.close()
    }
  }
}

/**
 * Reject an untrusted upgrade before protocol negotiation.
 * @param socket - Raw HTTP socket that remains owned by the caller.
 */
/** 中文说明：在协商协议前拒绝不可信升级；参数是调用方拥有的原始套接字；无返回值，例如来源检查失败时调用。 */
export function rejectWebSocketUpgrade(socket: Duplex): void {
  socket.end([
    'HTTP/1.1 403 Forbidden',
    'Connection: close',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Length: 9',
    '',
    'forbidden',
  ].join('\r\n'))
}
