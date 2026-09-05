/**
 * 文件职责：验证 experimental/webworker-runtime 中 tunnel server spec 相关行为与失败场景。
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。
 * 产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 */
import { describe, expect, it, vi } from 'vitest'
import type { TunnelOutboundFrame } from '../../src/transport/frames.ts'
import { TunnelServer, type TunnelSeams } from '../../src/transport/tunnel.ts'

function bytes(...values: number[]): Uint8Array<ArrayBuffer> {
  const data = new Uint8Array(new ArrayBuffer(values.length))
  data.set(values)
  return data
}

function harness(): { server: TunnelServer; frames: TunnelOutboundFrame[] } {
  /**
   * 常量说明：frames 用于处理 frames 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const frames: TunnelOutboundFrame[] = []
  /**
   * 常量说明：server 用于处理 server 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：frame（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(frame)，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  const server = new TunnelServer({
    port: { postMessage: (frame) => { frames.push(frame) } },
    requestListener: () => Promise.reject(new Error('fixture has no HTTP listener')),
  })
  return { server, frames }
}

/**
 * 功能说明：处理 seams 相关流程；使用场景由所在模块及调用位置决定。
 * @param openStream （TunnelSeams['openStream']）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。
 * @returns TunnelSeams；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 seams(openStream)，并按返回类型处理结果。
 */
function seams(openStream: TunnelSeams['openStream']): TunnelSeams {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：error（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(error)，并按返回类型处理结果。
   */
  return {
    directFetch: () => Promise.reject(new Error('fixture has no direct fetch')),
    bootPayload: () => ({}),
    openStream,
    streamFailure: error => ({
      code: 'fixture-stream-failed',
      message: error instanceof Error ? error.message : String(error),
      details: { fixture: true },
    }),
  }
}

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
describe('worker tunnel unary authentication', () => {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：status（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(status)，并按返回类型处理结果。
   */
  it.each([401, 403])('retries a route-lane HTTP %s through the worker-local direct lane', async (status) => {
    /**
     * 常量说明：frames 用于处理 frames 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const frames: TunnelOutboundFrame[] = []
    /**
     * 常量说明：directFetch 用于处理 directFetch 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    const directFetch = vi.fn(async () => new Response('direct answer', {
      status: 200,
      headers: { 'content-type': 'text/plain' },
    }))
    /**
     * 常量说明：server 用于处理 server 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：frame（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(frame)，并按返回类型处理结果。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：_req（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：response（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(_req, response)，
     * 并按返回类型处理结果。
     */
    const server = new TunnelServer({
      port: { postMessage: (frame) => { frames.push(frame) } },
      requestListener: () => Promise.resolve((_req, response) => {
        /**
         * 常量说明：res 用于处理 res 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const res = response as {
          /**
           * 功能说明：写入 Head 相关流程；使用场景由所在模块及调用位置决定。
           * @param status （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
           * @param headers （Record<string, string>）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
           * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
           * @example 在完成前置校验后调用 writeHead(status, headers)，并按返回类型处理结果。
           */
          writeHead(status: number, headers: Record<string, string>): void
          /**
           * 功能说明：处理 end 相关流程；使用场景由所在模块及调用位置决定。
           * @param body （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
           * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
           * @example 在完成前置校验后调用 end(body)，并按返回类型处理结果。
           */
          end(body: string): void
        }
        res.writeHead(status, { 'content-type': 'text/plain' })
        res.end('network request rejected')
      }),
    })
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：AsyncGenerator；调用方应按声明类型处理，
     * 不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    server.serve({
      ...seams(async () => (async function *(): AsyncGenerator { yield undefined })()),
      directFetch,
    })

    server.handleMessage({
      t: 'req', id: status, method: 'POST', url: 'http://localhost/api/session/list', headers: {},
    })

    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    await vi.waitFor(() => { expect(frames).toHaveLength(1) })
    /**
     * 常量说明：frame 用于处理 frame 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const [frame] = frames
    expect(frame).toMatchObject({ t: 'res', id: status, status: 200 })
    if (frame?.t !== 'res' || frame.body === undefined) throw new Error('direct retry did not return one body')
    expect(new TextDecoder().decode(frame.body)).toBe('direct answer')
    expect(directFetch).toHaveBeenCalledOnce()
  })
})

describe('worker tunnel Blob requests', () => {
  it('streams an opaque Blob in bounded chunks inside the Host Worker route', async () => {
    const frames: TunnelOutboundFrame[] = []
    const seen: Uint8Array[] = []
    const body = new Blob(['unused'])
    body.arrayBuffer = () => Promise.reject(new Error('route must not aggregate the Blob'))
    body.stream = () => new ReadableStream<Uint8Array<ArrayBuffer>>({
      start(controller) {
        controller.enqueue(bytes(108, 97, 114))
        controller.enqueue(bytes(103, 101))
        controller.close()
      },
    })
    const server = new TunnelServer({
      port: { postMessage: (frame) => { frames.push(frame) } },
      requestListener: () => Promise.resolve(async (request, response) => {
        for await (const chunk of request as AsyncIterable<Uint8Array>) seen.push(chunk)
        const res = response as { writeHead(status: number): void; end(body: string): void }
        res.writeHead(200)
        res.end('stored')
      }),
    })
    server.serve(seams(async () => (async function *(): AsyncGenerator { yield undefined })()))
    server.handleMessage({
      t: 'req', id: 9, method: 'POST', url: 'http://localhost/upload', headers: {}, body,
    })
    await vi.waitFor(() => { expect(frames).toHaveLength(1) })
    expect(seen.map(chunk => new TextDecoder().decode(chunk))).toEqual(['lar', 'ge'])
    expect(frames[0]).toMatchObject({ t: 'res', id: 9, status: 200 })
  })
})

describe('worker tunnel ReadableStream requests', () => {
  it('streams transferred chunks through the Host Worker route', async () => {
    const frames: TunnelOutboundFrame[] = []
    const seen: Uint8Array[] = []
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes(111, 110, 101))
        controller.enqueue(bytes(116, 119, 111))
        controller.close()
      },
    })
    const server = new TunnelServer({
      port: { postMessage: (frame) => { frames.push(frame) } },
      requestListener: () => Promise.resolve(async (request, response) => {
        for await (const chunk of request as AsyncIterable<Uint8Array>) seen.push(chunk)
        const res = response as { writeHead(status: number): void; end(body: string): void }
        res.writeHead(200)
        res.end('stored')
      }),
    })
    server.serve(seams(async () => (async function *(): AsyncGenerator { yield undefined })()))
    server.handleMessage({
      t: 'req', id: 10, method: 'POST', url: 'http://localhost/upload', headers: {}, body,
    })
    await vi.waitFor(() => { expect(frames).toHaveLength(1) })
    expect(seen.map(chunk => new TextDecoder().decode(chunk))).toEqual(['one', 'two'])
    expect(frames[0]).toMatchObject({ t: 'res', id: 10, status: 200 })
  })
})

describe('worker tunnel logical streams', () => {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('drains a pre-boot open through the worker-local Gateway seam', async () => {
    /**
     * 常量说明：server、frames 用于处理 server、frames 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const { server, frames } = harness()
    /**
     * 常量说明：seen 用于处理 seen 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const seen: unknown[] = []
    server.handleMessage({
      t: 'stream-open', id: 1, endpoint: 'session/follow', payload: { args: { sessionId: 'session-1' } },
    })
    expect(frames).toEqual([])

    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：endpoint（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：payload（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：signal（由 TypeScript
     * 根据调用位置推断的类型）：传递取消或终止信号；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(endpoint, payload,
     * signal)，并按返回类型处理结果。
     */
    server.serve(seams(async (endpoint, payload, signal) => {
      seen.push(endpoint, payload, signal)
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：AsyncGenerator；调用方应按声明类型处理，
       * 不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
       */
      return (async function *(): AsyncGenerator {
        yield { type: 'baseline' }
        yield { type: 'event', seq: 1 }
      })()
    }))

    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    await vi.waitFor(() => {
      expect(frames).toEqual([
        { t: 'stream-item', id: 1, value: { type: 'baseline' } },
        { t: 'stream-item', id: 1, value: { type: 'event', seq: 1 } },
        { t: 'stream-end', id: 1 },
      ])
    })
    expect(seen).toEqual([
      'session/follow',
      { args: { sessionId: 'session-1' } },
      expect.any(AbortSignal),
    ])
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('cancels one logical stream without emitting a terminal frame', async () => {
    /**
     * 常量说明：server、frames 用于处理 server、frames 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const { server, frames } = harness()
    /**
     * 常量说明：opened 用于处理 opened 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const opened = Promise.withResolvers<AbortSignal>()
    /**
     * 常量说明：stopped 用于处理 stopped 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const stopped = Promise.withResolvers<undefined>()
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：_endpoint（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：_payload（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：signal（由 TypeScript
     * 根据调用位置推断的类型）：传递取消或终止信号；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(_endpoint, _payload,
     * signal)，并按返回类型处理结果。
     */
    server.serve(seams(async (_endpoint, _payload, signal) => {
      opened.resolve(signal)
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：AsyncGenerator；调用方应按声明类型处理，
       * 不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
       */
      return (async function *(): AsyncGenerator {
        yield 'ready'
        /**
         * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolve（由 TypeScript
         * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
         * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(resolve)，并按返回类型处理结果。
         */
        await new Promise<void>((resolve) => {
          /**
           * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
           * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
           */
          signal.addEventListener('abort', () => { resolve() }, { once: true })
        })
        stopped.resolve(undefined)
      })()
    }))
    server.handleMessage({ t: 'stream-open', id: 2, endpoint: '$events', payload: { args: {} } })
    /**
     * 常量说明：signal 用于处理 signal 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const signal = await opened.promise
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    await vi.waitFor(() => { expect(frames).toContainEqual({ t: 'stream-item', id: 2, value: 'ready' }) })

    server.handleMessage({ t: 'abort', id: 2 })
    await stopped.promise
    expect(signal.aborted).toBe(true)
    expect(frames).toEqual([{ t: 'stream-item', id: 2, value: 'ready' }])
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('maps a Host stream failure through Gateway-owned fields', async () => {
    /**
     * 常量说明：server、frames 用于处理 server、frames 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const { server, frames } = harness()
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    server.serve(seams(async () => { throw new Error('Host stream exploded') }))
    server.handleMessage({ t: 'stream-open', id: 3, endpoint: 'probe/watch', payload: {} })

    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    await vi.waitFor(() => {
      expect(frames).toEqual([{
        t: 'stream-error',
        id: 3,
        failure: {
          kind: 'remote',
          code: 'fixture-stream-failed',
          message: 'Host stream exploded',
          details: { fixture: true },
        },
      }])
    })
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('refuses queued and future streams after boot failure as carrier failures', () => {
    /**
     * 常量说明：server、frames 用于处理 server、frames 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const { server, frames } = harness()
    server.handleMessage({ t: 'stream-open', id: 4, endpoint: '$events', payload: {} })
    server.fail(new Error('image failed'))
    server.handleMessage({ t: 'stream-open', id: 5, endpoint: '$events', payload: {} })

    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：id（由 TypeScript
     * 根据调用位置推断的类型）：标识本次操作关联的唯一对象；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(id)，并按返回类型处理结果。
     */
    expect(frames).toEqual([4, 5].map(id => ({
      t: 'stream-error',
      id,
      failure: { kind: 'carrier', message: 'Error: image failed' },
    })))
  })
})
