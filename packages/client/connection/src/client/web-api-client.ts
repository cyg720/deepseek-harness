/** Browser API carrier: HTTP upstream plus one WebSocket per downstream event stream. */
/**
 * 文件职责：实现浏览器端 API 客户端，用 HTTP 发送请求，并用两个 WebSocket 接收复用事件和主机事件。
 * 技术维度：基于 Fetch、WebSocket、异步生成器和运行时模式解析器完成传输与校验。
 * 产品维度：让浏览器界面能够调用宿主能力，并持续接收会话状态与主机状态更新。
 * 逻辑维度：把服务地址转换为 WebSocket 地址，监听连接事件、校验数据帧，再通过异步迭代器逐帧交付。
 * 关键边界：上行请求仍走 HTTP；二进制或结构错误的数据帧会被丢弃；取消信号负责关闭连接。
 * 新手阅读建议：先看 WebApiClient 的三个覆写方法，再按 readWebSocket 中“建连、入队、消费、清理”的顺序阅读。
 */

import type { ApiProxy, HostFrame, MuxFrame, RpcRequest, ServerRequest } from './api.ts'
import { AbstractApiClient } from './api.ts'
import { hostFrameSchema, muxFrameSchema } from '@deepseek-ai/dsh-host-apiproxy/api/events.schema'
import { serverRequestSchema } from '@deepseek-ai/dsh-host-apiproxy/api/rpc.schema'
import { HOST_EVENTS_PATH, MUX_EVENTS_PATH } from '../api-path.ts'

/** 中文说明：套接字收件箱元素；`frame` 携带已校验信封，`end` 表示事件流结束。 */
type SocketItem<F> = { kind: 'frame'; envelope: RpcRequest<F> } | { kind: 'end' }
/** 中文说明：最小解析器接口；把未知输入校验并转换为指定帧类型，失败时抛出错误。 */
type Parser<F> = { parse(value: unknown): F }

/** Browser platform subclass: unary/respond use fetch; mux/host use downlink-only WebSockets. */
/** 中文说明：浏览器平台的 API 客户端；普通调用使用 Fetch，两个事件流使用只接收数据的 WebSocket。 */
export class WebApiClient extends AbstractApiClient {
  /**
   * 中文说明：通过浏览器全局 Fetch 发出一次 HTTP 请求。
   * @param input 请求地址。
   * @param init 可选的 Fetch 请求配置。
   * @returns 浏览器返回的响应 Promise。
   * @example 该受保护方法由基类在普通 RPC 调用时使用。
   */
  protected doFetch(input: URL, init?: RequestInit): Promise<Response> {
    return globalThis.fetch(input, init)
  }

  /**
   * 中文说明：打开复用事件下行流；当前载荷为空，取消信号结束连接。
   * @param _payload 为保持接口一致而接收的载荷，当前不读取。
   * @param signal 调用方取消信号。
   * @param onOpen 可选的建连回调。
   * @returns 可异步遍历的复用事件信封。
   * @example `for await (const frame of client.events.mux(...)) { ... }`。
   */
  protected override openMux(
    _payload: Parameters<ApiProxy['events']['mux']>[0]['payload'],
    signal: AbortSignal,
    onOpen?: () => void,
  ): AsyncIterable<RpcRequest<MuxFrame>> {
    return this.readWebSocket(MUX_EVENTS_PATH, signal, muxFrameSchema, onOpen)
  }

  /**
   * 中文说明：打开主机事件下行流；当前载荷为空，取消信号结束连接。
   * @param _payload 为保持接口一致而接收的载荷，当前不读取。
   * @param signal 调用方取消信号。
   * @param onOpen 可选的建连回调。
   * @returns 可异步遍历的主机事件信封。
   * @example `for await (const frame of client.events.host(...)) { ... }`。
   */
  protected override openHost(
    _payload: Parameters<ApiProxy['events']['host']>[0]['payload'],
    signal: AbortSignal,
    onOpen?: () => void,
  ): AsyncIterable<RpcRequest<HostFrame>> {
    return this.readWebSocket(HOST_EVENTS_PATH, signal, hostFrameSchema, onOpen)
  }

  /**
   * 中文说明：建立一个下行 WebSocket，并把校验后的消息作为异步序列输出。
   * @param path 相对于 API 基址的事件路径。
   * @param signal 用于关闭连接的取消信号。
   * @param frameSchema 当前事件流的载荷解析器。
   * @param onOpen 可选的建连回调。
   * @returns 逐个产生 RPC 帧的异步生成器。
   * @example `this.readWebSocket('/events', signal, schema)`。
   */
  private async *readWebSocket<F extends MuxFrame | HostFrame>(
    path: string,
    signal: AbortSignal,
    frameSchema: Parser<F>,
    onOpen?: () => void,
  ): AsyncGenerator<RpcRequest<F>> {
    /** 中文说明：由 API 基址和事件路径组合出的地址，随后切换为 WS 或 WSS 协议。 */
    const url = new URL(path, this.resolveBase())
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    /** 中文说明：当前下行连接；只接收服务端数据，不发送业务帧。 */
    const socket = new WebSocket(url)
    /** 中文说明：等待异步生成器消费的帧队列；关闭事件以 `end` 哨兵入队。 */
    const inbox: SocketItem<F>[] = []
    /** 中文说明：队列为空时用于唤醒生成器的单次回调；有数据入队后清空。 */
    let wake: (() => void) | undefined
    /** 中文说明：把帧或结束哨兵入队并唤醒生成器。`item` 是新元素；无返回值；例如传入 `{ kind: 'end' }`。 */
    const enqueue = (item: SocketItem<F>): void => {
      inbox.push(item)
      wake?.()
      wake = undefined
    }
    /** 中文说明：连接建立处理器；触发调用方提供的可选通知，无参数和返回值。 */
    const handleOpen = (): void => { onOpen?.() }
    /** 中文说明：校验文本消息并入队；`event` 是浏览器消息事件；畸形消息只记录后丢弃。 */
    const handleMessage = (event: MessageEvent): void => {
      /** 中文说明：通过 RPC 信封模式校验后的完整服务端请求。 */
      let full: ServerRequest
      /** 中文说明：通过具体事件流模式校验后的载荷。 */
      let frame: F
      try {
        if (typeof event.data !== 'string') throw new Error('binary WebSocket frame')
        full = serverRequestSchema.parse(JSON.parse(event.data))
        frame = frameSchema.parse(full.payload)
      } catch (error) {
        console.error(`[client-connection] dropping malformed WebSocket frame on ${path}:`, error)
        return
      }
      this.onEnvelope(full)
      enqueue({ kind: 'frame', envelope: { rpcId: full.rpcId, payload: frame } })
    }
    /** 中文说明：连接关闭处理器；加入结束哨兵，使异步生成器正常返回。 */
    const handleClose = (): void => { enqueue({ kind: 'end' }) }
    /** 中文说明：取消处理器；仅在连接仍可关闭时主动关闭套接字。 */
    const handleAbort = (): void => {
      if (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN) socket.close()
    }
    socket.addEventListener('open', handleOpen)
    socket.addEventListener('message', handleMessage)
    socket.addEventListener('close', handleClose, { once: true })
    signal.addEventListener('abort', handleAbort, { once: true })
    if (signal.aborted) handleAbort()
    try {
      while (true) {
        while (inbox.length > 0) {
          /** 中文说明：从队列头部取出的元素；循环条件保证此处一定存在。 */
          const item = inbox.shift() as SocketItem<F>
          if (item.kind === 'end') return
          yield item.envelope
        }
        /** 中文说明：队列为空时挂起，下一次入队会调用保存的 resolve。 */
        await new Promise<void>((resolve) => { wake = resolve })
      }
    } finally {
      signal.removeEventListener('abort', handleAbort)
      socket.removeEventListener('open', handleOpen)
      socket.removeEventListener('message', handleMessage)
      socket.removeEventListener('close', handleClose)
      handleAbort()
    }
  }
}
