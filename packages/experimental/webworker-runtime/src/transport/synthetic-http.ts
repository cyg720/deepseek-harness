/*
 * 【文件职责】为隧道请求构造实际路由所需的 IncomingMessage/ServerResponse，使主机路由和访问检查可在 Worker 环境复用。
 */

import type { TunnelRequestFrame } from './frames.ts'

/**
 * 常量说明：encoder 用于处理 encoder 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const encoder = new TextEncoder()

/** Where a synthesized response writes to. */
export interface ResponseSink {
  /** Head of a streaming response.
   * @remarks 中文说明：功能说明：处理 head 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：status（number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：headers（Record<string, string>）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：void；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 head(status,
   * headers)，并按返回类型处理结果。 */
  head(status: number, headers: Record<string, string>): void
  /** One body chunk after {@link ResponseSink.head}.
   * @remarks 中文说明：功能说明：处理 chunk 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：bytes（Uint8Array）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 chunk(bytes)，并按返回类型处理结果。 */
  chunk(bytes: Uint8Array): void
  /** Completion; the payload is present only for unary answers.
   * @remarks 中文说明：功能说明：处理 end 相关流程；使用场景由所在模块及调用位置决定。；参数说明：payload（{ status:
   * number; headers: Record<string, string>; body?: U…）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。；返回值：void；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 使用示例：典型用法：在完成前置校验后调用 end(payload)，并按返回类型处理结果。 */
  end(payload?: { status: number; headers: Record<string, string>; body?: Uint8Array | undefined }): void
  /** Failure of the exchange.
   * @remarks 中文说明：功能说明：处理 fail 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：message（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 fail(message)，并按返回类型处理结果。 */
  fail(message: string): void
}

/** Request listener shape the app's `createServer` captured. */
export type RequestListener = (req: unknown, res: unknown) => void

/** The pair a route handler consumes, plus abort control for the tunnel. */
export interface SyntheticExchange {
  readonly req: unknown
  readonly res: unknown
  /** Whether the page abandoned the request before it finished. */
  readonly aborted: boolean
  /** Mark the page as gone: emits `close` and stops further frames.
   * @remarks 中文说明：功能说明：处理 abort 相关流程；使用场景由所在模块及调用位置决定。；返回值：void；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 abort()，并按返回类型处理结果。 */
  abort(): void
}

/**
 * Build the request/response pair for one tunnel request.
 *
 * `res.end()` is the settle point: the captured listener returns void, so the
 * response object itself reports completion. `write()` always returns true,
 * which skips backpressure waiting the tunnel cannot observe anyway.
 * @param frame - Validated request frame.
 * @param sink - Frame emitter for the response.
 * @returns The pair handed to the captured request listener.
 * @remarks 中文说明：功能说明：创建 Synthetic Exchange 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：frame（TunnelRequestFrame）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：sink（ResponseSink）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：SyntheticExchange；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * createSyntheticExchange(frame, sink)，并按返回类型处理结果。
 */
export function createSyntheticExchange(frame: TunnelRequestFrame, sink: ResponseSink): SyntheticExchange {
  /**
   * 常量说明：listeners 用于处理 listeners 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const listeners = new Map<string, Set<() => void>>()
  /**
   * 变量说明：status 用于处理 status 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let status = 200
  /**
   * 变量说明：headers 用于处理 headers 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let headers: Record<string, string> = {}
  /**
   * 变量说明：streaming 用于处理 streaming 相关数据，作用于当前作用域；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  let streaming = false
  /**
   * 变量说明：finished 用于处理 finished 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let finished = false
  /**
   * 变量说明：aborted 用于处理 aborted 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let aborted = false

  /**
   * 常量说明：emit 用于发送 emit 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   * 功能说明：发送 emit 相关流程；使用场景由所在模块及调用位置决定。
   * @param event （string）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 emit(event)，并按返回类型处理结果。
   */
  const emit = (event: string): void => {
    /**
     * 变量说明：callback 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const callback of [...(listeners.get(event) ?? [])]) callback()
  }

  /**
   * 常量说明：req 用于处理 req 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：void；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  const req = {
    url: frame.url,
    method: frame.method,
    headers: frame.headers,
    destroy: (): void => { aborted = true },
    /**
     * 功能说明：处理 [Symbol.asyncIterator] 相关流程；使用场景由所在模块及调用位置决定。
     * @returns AsyncGenerator<Uint8Array>；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 [Symbol.asyncIterator]()，并按返回类型处理结果。
     */
    async *[Symbol.asyncIterator](): AsyncGenerator<Uint8Array> {
      if (frame.body === undefined) return
      if (frame.body instanceof Blob) {
        for await (const chunk of frame.body.stream()) {
          if (aborted) return
          if (chunk.byteLength > 0) yield chunk
        }
        return
      }
      if (frame.body instanceof ReadableStream) {
        for await (const chunk of frame.body) {
          if (aborted) return
          if (!(chunk instanceof Uint8Array)) {
            throw new TypeError('webworker tunnel: request stream produced a non-Uint8Array chunk')
          }
          if (chunk.byteLength > 0) yield chunk
        }
        return
      }
      if (aborted || frame.body.byteLength === 0) return
      yield new Uint8Array(frame.body)
    },
  }

  /**
   * 常量说明：res 用于处理 res 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：nextStatus（number）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。；参数：nextHeaders（Record<string, string |
   * number>）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：unknown；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(nextStatus, nextHeaders)，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：chunk（string |
   * Uint8Array）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：boolean；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(chunk)，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：body（string |
   * Uint8Array）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：unknown；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(body)，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：void；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：event（string）：提供需要处理或投影的事件数据；
   * 必须满足声明的类型及调用时序要求。；参数：callback（() => void）：接收后续状态或事件并执行调用方逻辑；
   * 必须满足声明的类型及调用时序要求。；返回值：unknown；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用
   * 匿名回调(event, callback)，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：event（string）：提供需要处理或投影的事件数据；
   * 必须满足声明的类型及调用时序要求。；参数：callback（() => void）：接收后续状态或事件并执行调用方逻辑；
   * 必须满足声明的类型及调用时序要求。；返回值：unknown；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用
   * 匿名回调(event, callback)，并按返回类型处理结果。
   */
  const res: Record<string, unknown> = {
    writeHead: (nextStatus: number, nextHeaders?: Record<string, string | number>): unknown => {
      status = nextStatus
      if (nextHeaders !== undefined) {
        headers = {}
        /**
         * 变量说明：key、value 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
         */
        for (const [key, value] of Object.entries(nextHeaders)) headers[key.toLowerCase()] = String(value)
      }
      return res
    },
    write: (chunk: string | Uint8Array): boolean => {
      if (finished || aborted) return false
      if (!streaming) {
        streaming = true
        sink.head(status, headers)
      }
      sink.chunk(typeof chunk === 'string' ? encoder.encode(chunk) : chunk)
      return true
    },
    end: (body?: string | Uint8Array): unknown => {
      if (finished) return res
      finished = true
      /**
       * 常量说明：bytes 用于处理 bytes 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const bytes = body === undefined ? undefined : typeof body === 'string' ? encoder.encode(body) : body
      if (streaming) {
        if (bytes !== undefined) sink.chunk(bytes)
        sink.end()
      } else {
        sink.end({ status, headers, body: bytes })
      }
      emit('close')
      return res
    },
    destroy: (): void => {
      if (finished) return
      finished = true
      sink.fail(`response destroyed for ${frame.method} ${frame.url}`)
      emit('close')
    },
    on: (event: string, callback: () => void): unknown => {
      /**
       * 常量说明：set 用于设置 set 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const set = listeners.get(event) ?? new Set<() => void>()
      set.add(callback)
      listeners.set(event, set)
      return res
    },
    off: (event: string, callback: () => void): unknown => {
      listeners.get(event)?.delete(callback)
      return res
    },
  }
  res.once = res.on
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  Object.defineProperty(res, 'headersSent', { get: () => streaming })
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  Object.defineProperty(res, 'writableEnded', { get: () => finished })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：void；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  return {
    req,
    res,
    /**
     * 功能说明：处理 aborted 相关流程；使用场景由所在模块及调用位置决定。
     * @returns boolean；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 aborted()，并按返回类型处理结果。
     */
    get aborted(): boolean {
      return aborted
    },
    abort: (): void => {
      if (finished) return
      aborted = true
      finished = true
      emit('aborted')
      emit('close')
    },
  }
}
