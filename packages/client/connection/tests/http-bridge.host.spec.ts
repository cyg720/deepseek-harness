/**
 * 文件职责：验证 Node HTTP 到 Fetch 桥的请求体上限和客户端断开取消传播。
 * 技术维度：Node Readable/EventEmitter 测试替身、Vitest、Fetch Request 与 AbortSignal。
 * 产品维度：确保过大请求被及时拒绝，并让长连接在浏览器离开后释放宿主资源。
 * 逻辑维度：构造最小请求与响应替身，调用 bridge，触发销毁或 close，再检查状态和取消信号。
 * 关键边界：替身只实现 bridge 实际读取的方法；增加桥接行为时需同步扩充替身。
 * 新手阅读建议：先看 413 用例理解大小限制，再看 close 用例理解取消传播。
 */
import { EventEmitter } from 'node:events'
import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { describe, expect, it } from 'vitest'
import { bridge } from '../src/http-bridge.ts'

describe('HTTP bridge abort', () => {
  it('destroys a declared-oversize request instead of draining it', async () => {
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `destroyed` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const destroyed: true[] = []
    /** 中文说明：当前场景构造或发出的请求对象；变量 `request` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const request = Readable.from([]) as unknown as IncomingMessage
    Object.assign(request, {
      url: '/api/session.prompt',
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': '999999' },
      destroy: () => { destroyed.push(true) },
    })
    /** 中文说明：用于记录次数、编号或状态码的标量值；变量 `status: number | undefined` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    let status: number | undefined
    /** 中文说明：当前场景输入、传输或校验的数据；变量 `headers: unknown` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    let headers: unknown
    /** 中文说明：当前操作得到的响应或结果，供后续断言；变量 `response` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const response = Object.assign(new EventEmitter(), {
      writableEnded: false,
      writeHead(code: number, values?: unknown) { status = code; headers = values; return this },
      write() { return true },
      end(this: { writableEnded: boolean }) { this.writableEnded = true; return this },
    }) as unknown as ServerResponse

    await bridge(request, response, {
      requestBodyMode: () => 'buffered',
      fetch: () => { throw new Error('a rejected request must never reach the handler') },
    }, 1000)
    // The socket must not stay parked draining a body the client can trickle
    // at will after the rejection — same discipline as the chunked overrun.
    expect(status).toBe(413)
    expect(headers).toMatchObject({ connection: 'close' })
    expect(destroyed).toHaveLength(1)
  })

  it('aborts a pending native picker request when the browser disconnects', async () => {
    /** 中文说明：当前场景输入、传输或校验的数据；变量 `body` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const body = JSON.stringify({
      type: 'client-request', rpcId: 'picker-1', method: 'directoryPicker/pick', payload: { args: {} },
    })
    /** 中文说明：当前场景构造或发出的请求对象；变量 `request` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const request = Readable.from([Buffer.from(body)]) as unknown as IncomingMessage
    Object.assign(request, {
      url: '/api/directoryPicker/pick',
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    })

    /** 中文说明：当前操作得到的响应或结果，供后续断言；变量 `response` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const response = Object.assign(new EventEmitter(), {
      writableEnded: false,
      writeHead() { return this },
      write() { return true },
      end() { this.writableEnded = true; return this },
    }) as unknown as ServerResponse

    /** 中文说明：固定异步执行顺序或等待生命周期事件的 Promise 或门控值；变量 `resolveStarted` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    let resolveStarted!: () => void
    /** 中文说明：固定异步执行顺序或等待生命周期事件的 Promise 或门控值；变量 `started` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const started = new Promise<void>((resolve) => { resolveStarted = resolve })
    /** 中文说明：控制或记录异步操作取消状态的对象；变量 `carrierSignal: AbortSignal | undefined` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    let carrierSignal: AbortSignal | undefined
    /** 中文说明：固定异步执行顺序或等待生命周期事件的 Promise 或门控值；变量 `pending` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const pending = bridge(request, response, {
      requestBodyMode: () => 'buffered',
      fetch: async (input) => {
        /** 中文说明：当前场景构造或发出的请求对象；变量 `fetchRequest` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
        const fetchRequest = input
        carrierSignal = fetchRequest.signal
        resolveStarted()
        if (!fetchRequest.signal.aborted) {
          await new Promise<void>((resolve) => {
            fetchRequest.signal.addEventListener('abort', () => { resolve() }, { once: true })
          })
        }
        return Response.json({ aborted: fetchRequest.signal.aborted })
      },
    }, Number.MAX_SAFE_INTEGER)
    await started
    response.emit('close')
    await pending
    expect(carrierSignal?.aborted).toBe(true)
  })

  it('streams a declared 2.19 GiB request before the body ends and bypasses the JSON buffer cap', async () => {
    const request = new Readable({ read() {} }) as unknown as IncomingMessage
    Object.assign(request, {
      url: '/api/session/uploadFileBinary?sessionId=s1',
      method: 'POST',
      headers: {
        'content-type': 'application/octet-stream',
        'content-length': String(Math.ceil(2.19 * 1024 ** 3)),
      },
    })
    let status: number | undefined
    const responseBytes: Uint8Array[] = []
    const response = Object.assign(new EventEmitter(), {
      writableEnded: false,
      writeHead(code: number) { status = code; return this },
      write(chunk: Uint8Array) { responseBytes.push(chunk); return true },
      end(this: { writableEnded: boolean }) { this.writableEnded = true; return this },
    }) as unknown as ServerResponse

    let resolveStarted!: () => void
    const started = new Promise<void>((resolve) => { resolveStarted = resolve })
    const received: Uint8Array[] = []
    const pending = bridge(request, response, {
      requestBodyMode: () => 'streaming',
      fetch: async (input) => {
        resolveStarted()
        if (input.body === null) throw new Error('streaming request lost its body')
        for await (const chunk of input.body) received.push(chunk)
        return new Response('stored')
      },
    }, 1)

    await started
    expect(received).toEqual([])
    request.push(Buffer.from([1, 2]))
    request.push(Buffer.from([3, 4]))
    request.push(null)
    await pending
    expect(status).toBe(200)
    expect(received).toEqual([Uint8Array.of(1, 2), Uint8Array.of(3, 4)])
    expect(Buffer.concat(responseBytes).toString()).toBe('stored')
  })

  it('closes an unread streaming request after returning an early validation response', async () => {
    const destroyed: true[] = []
    const request = new Readable({ read() {} }) as unknown as IncomingMessage
    Object.assign(request, {
      url: '/api/session/uploadFileBinary',
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      destroy: () => { destroyed.push(true) },
    })
    let status: number | undefined
    let headers: unknown
    const response = Object.assign(new EventEmitter(), {
      writableEnded: false,
      writeHead(code: number, values?: unknown) { status = code; headers = values; return this },
      write() { return true },
      end(this: { writableEnded: boolean }) { this.writableEnded = true; return this },
    }) as unknown as ServerResponse

    await bridge(request, response, {
      requestBodyMode: () => 'streaming',
      fetch: () => Promise.resolve(new Response(null, { status: 415 })),
    }, 1)
    expect(status).toBe(415)
    expect(headers).toMatchObject({ connection: 'close' })
    expect(destroyed).toEqual([true])
  })
})
