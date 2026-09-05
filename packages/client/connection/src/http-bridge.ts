/**
 * node:http ↔ WHATWG fetch bridge for the /api transport (host side of the
 * web carrier; the fetch-shaped handler itself is transport-agnostic).
 */

/*
 * 【文件职责】在 Node HTTP 请求与 Fetch Request/Response 之间转换；
 * 请求体上限同时限制每次请求的缓冲内存。
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { Readable } from 'node:stream'
import type { ConnectionFetchHandler } from './rpc.ts'

/** Default carrier cap for all HTTP RPC bodies: sized for the default
 * aggregate image limit (200 MiB) after base64 expansion plus envelope
 * headroom (~267.7 MiB required), rounded up for slack. The bridge buffers
 * each body in memory, so this cap is also the per-request resident bound. */
/* 中文说明：默认请求体上限为 300 MiB，依据图片 Base64 膨胀后的默认总量并预留信封空间。 */
export const DEFAULT_MAX_REQUEST_BODY_BYTES = 300 * 1024 * 1024
/* 中文说明：默认请求体上限为 300 MiB，依据图片 Base64 膨胀后的默认总量并预留信封空间。 */

/**
 * Bridge one node:http request to the fetch-shaped handler (client close
 * aborts; response bodies stream out chunk by chunk).
 * @param req - incoming node:http request.
 * @param res - node:http response the bridge writes and owns to completion.
 * @param apiHandler - fetch-shaped API carrier the request is dispatched to.
 * @param maxRequestBodyBytes - maximum bytes buffered for a buffered route.
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
  apiHandler: ConnectionFetchHandler,
  maxRequestBodyBytes = DEFAULT_MAX_REQUEST_BODY_BYTES,
): Promise<void> {
  /** 中文说明：向 Fetch 处理器传播客户端异常断开的取消状态。 */
  const abort = new AbortController()
  // Client-disconnect detection MUST hang off the response, not the request:
  // since Node 16, IncomingMessage 'close' fires as soon as the request body is
  // fully consumed (immediately for a bodyless GET), which would abort a
  // streaming response right after open. ServerResponse 'close' fires on connection teardown;
  // writableEnded distinguishes a normal end() from the client going away.
  // 中文说明：监听响应端 close，避免把正常 end 误判为客户端中途断开。
  res.on('close', () => {
    if (!res.writableEnded) abort.abort()
  })
  /* v8 ignore next 2 -- node:http always sets url/method on server requests. */
  const url = new URL(req.url ?? '/', 'http://dsh.internal')
  const method = req.method ?? 'GET'
  const headers = Object.fromEntries(
    Object.entries(req.headers).filter(([, value]) => typeof value === 'string') as [string, string][],
  )
  const bodyMode = apiHandler.requestBodyMode({ method, url })
  let request: Request
  if (bodyMode === 'buffered') {
    const declaredLength = req.headers['content-length']
    if (declaredLength !== undefined && Number(declaredLength) > maxRequestBodyBytes) {
      res.writeHead(413, { connection: 'close' })
      res.end()
      req.destroy()
      return
    }
    const chunks: Buffer[] = []
    let received = 0
    for await (const chunk of req) {
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
    request = new Request(url, {
      method,
      headers,
      ...chunks.length > 0 ? { body: Buffer.concat(chunks) } : {},
      signal: abort.signal,
    })
  } else {
    request = new Request(url, {
      method,
      headers,
      body: Readable.toWeb(req) as ReadableStream<Uint8Array>,
      signal: abort.signal,
      duplex: 'half',
    } as RequestInit & { duplex: 'half' })
  }
  const response = await apiHandler.fetch(request)
  const requestUnread = bodyMode === 'streaming' && !req.readableEnded
  const responseHeaders = Object.fromEntries(response.headers.entries())
  res.writeHead(response.status, requestUnread ? { ...responseHeaders, connection: 'close' } : responseHeaders)
  if (response.body === null) {
    res.end()
    if (requestUnread) req.destroy()
    return
  }
  for await (const chunk of response.body) {
    // Backpressure: a false return means the socket buffer is full — wait for drain
    // instead of buffering unboundedly (slow or suspended consumers). 'close' also
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
  if (requestUnread) req.destroy()
}
