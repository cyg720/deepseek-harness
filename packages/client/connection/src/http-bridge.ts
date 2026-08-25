/**
 * node:http ↔ WHATWG fetch bridge for the /api transport (host side of the
 * web carrier; the fetch-shaped handler itself is transport-agnostic).
 */
/*
 * 文件职责：在 Node.js HTTP 请求/响应与标准 Fetch Request/Response 之间转换数据。
 * 技术维度：使用 node:http、WHATWG Fetch、异步迭代、AbortController 和流背压控制。
 * 产品维度：让同一套 API 处理器接入宿主 HTTP 服务，并可靠服务浏览器客户端。
 * 逻辑维度：检查并缓冲请求体、构造 Fetch 请求、调用处理器，再把状态头和响应流写回 Node 响应。
 * 关键边界：请求体会完整驻留内存且受大小上限约束；客户端断开会取消处理；响应写入必须处理背压。
 * 新手阅读建议：先看 bridge 的四个参数，再依次阅读“限流、转换、调用、回写”，最后理解 close 与 drain 事件。
 */

import type { IncomingMessage, ServerResponse } from 'node:http'

/** Default carrier cap for all HTTP RPC bodies: sized for the default
 * aggregate image limit (200 MiB) after base64 expansion plus envelope
 * headroom (~267.7 MiB required), rounded up for slack. The bridge buffers
 * each body in memory, so this cap is also the per-request resident bound. */
/* 中文说明：默认请求体上限为 300 MiB，依据图片 Base64 膨胀后的默认总量并预留信封空间。 */
export const DEFAULT_MAX_REQUEST_BODY_BYTES = 300 * 1024 * 1024
/* 中文说明：默认请求体上限为 300 MiB，依据图片 Base64 膨胀后的默认总量并预留信封空间。 */

/** Transport-independent request handler consumed by the Host HTTP bridge. */
/* 中文说明：与具体 HTTP 服务器无关的 Fetch 风格处理器，由宿主桥接层调用。 */
export interface FetchHandler {
  /**
   * Handle one standard Fetch request.
   * @param request - request produced by the active transport bridge.
   * @returns complete or streaming Fetch response.
   */
  /* 中文说明：处理一个标准 Fetch 请求；`request` 是桥接后的请求；返回完整或流式 Response，例如 `await handler.fetch(request)`。 */
  fetch(request: Request): Promise<Response>
}

/**
 * Bridge one node:http request to the fetch-shaped handler (client close
 * aborts; SSE bodies stream out chunk by chunk).
 * @param req - incoming node:http request (fully read before dispatch).
 * @param res - node:http response the bridge writes and owns to completion.
 * @param apiHandler - fetch-shaped API carrier the request is dispatched to.
 * @param maxRequestBodyBytes - maximum body bytes buffered before dispatch.
 */
/*
 * 中文说明：把一条 Node HTTP 请求桥接到 Fetch 处理器，并把 Fetch 响应完整写回客户端。
 * @param req 待读取的 Node 入站请求。
 * @param res 由本函数负责结束的 Node 响应。
 * @param apiHandler 接收转换后 Request 的 Fetch 处理器。
 * @param maxRequestBodyBytes 允许缓冲的最大请求体字节数。
 * @returns 响应写完或连接结束后完成的 Promise。
 * @example `await bridge(req, res, handler)`。
 */
export async function bridge(
  req: IncomingMessage,
  res: ServerResponse,
  apiHandler: FetchHandler,
  maxRequestBodyBytes = DEFAULT_MAX_REQUEST_BODY_BYTES,
): Promise<void> {
  /** 中文说明：向 Fetch 处理器传播客户端异常断开的取消状态。 */
  const abort = new AbortController()
  // Client-disconnect detection MUST hang off the response, not the request:
  // since Node 16, IncomingMessage 'close' fires as soon as the request body is
  // fully consumed (immediately for a bodyless GET), which would abort every SSE
  // stream right after open. ServerResponse 'close' fires on connection teardown;
  // writableEnded distinguishes a normal end() from the client going away.
  // 中文说明：监听响应端 close，避免把正常 end 误判为客户端中途断开。
  res.on('close', () => {
    if (!res.writableEnded) abort.abort()
  })
  /** 中文说明：请求头声明的正文长度；缺失时仍会按实际读取量执行限制。 */
  const declaredLength = req.headers['content-length']
  if (declaredLength !== undefined && Number(declaredLength) > maxRequestBodyBytes) {
    res.writeHead(413, { connection: 'close' })
    res.end()
    req.destroy()
    return
  }
  /** 中文说明：已经读取的请求体分块；总量不超过配置上限。 */
  const chunks: Buffer[] = []
  /** 中文说明：累计读取字节数，防止分块传输绕过 Content-Length 检查。 */
  let received = 0
  for await (const chunk of req) {
    /** 中文说明：Node HTTP 请求流给出的当前 Buffer 分块。 */
    const buffer = chunk as Buffer
    received += buffer.byteLength
    if (received > maxRequestBodyBytes) {
      res.writeHead(413, { connection: 'close' })
      res.end()
      req.destroy()
      return
    }
    chunks.push(buffer)
  }
  /* v8 ignore next 3 -- `??` arms: node:http always sets url/method on server
  requests; the fields are only optional on the client-side IncomingMessage type */
  /* 中文说明：Node 服务端请求实际总有 URL 和方法；空值分支仅为兼容类型声明。 */
  /** 中文说明：由宿主请求构造的标准 Request；正文仅在非空时附加。 */
  const request = new Request(new URL(req.url ?? '/', 'http://dsh.internal'), {
    method: req.method ?? 'GET',
    headers: Object.fromEntries(Object.entries(req.headers).filter(([, v]) => typeof v === 'string') as [string, string][]),
    ...chunks.length > 0 ? { body: Buffer.concat(chunks) } : {},
    signal: abort.signal,
  })
  /** 中文说明：Fetch 风格 API 处理器返回的响应，可能包含流式正文。 */
  const response = await apiHandler.fetch(request)
  res.writeHead(response.status, Object.fromEntries(response.headers.entries()))
  if (response.body === null) {
    res.end()
    return
  }
  for await (const chunk of response.body) {
    // Backpressure: a false return means the socket buffer is full — wait for drain
    // instead of buffering unboundedly (slow/suspended SSE consumers). 'close' also
    // resolves so a mid-wait disconnect can't park this loop forever; the close
    // handler above aborts the handler stream, which then ends the iteration.
    // 中文说明：写缓冲区已满时同时等待 drain 或 close，避免无限缓存或永久挂起。
    if (!res.write(chunk)) {
      await new Promise<void>((resolve) => {
        /** 中文说明：任一等待事件发生后的统一清理与唤醒函数；无参数和返回值。 */
        const done = (): void => {
          res.off('drain', done)
          res.off('close', done)
          resolve()
        }
        res.once('drain', done)
        res.once('close', done)
      })
    }
  }
  res.end()
}
