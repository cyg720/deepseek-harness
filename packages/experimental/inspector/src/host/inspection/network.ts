/** Full `globalThis.fetch` capture that publishes without delaying response delivery.
 * @remarks 文件说明：文件职责：实现 experimental/inspector 中 network 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/inspector 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。 */

import type { InspectorJsonValue } from '../../shared/json.ts'
import type { InspectorPublisher } from '../../shared/bridge/publisher.ts'
import { FETCH_TOPICS } from '../../shared/bridge/messages/network.ts'

/** Observation topics published by the Host network adapter.
 * @remarks 中文说明：常量说明：NETWORK_TOPICS 用于处理 NETWORK_TOPICS 相关数据，作用于当前作用域；
 * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
export const NETWORK_TOPICS: readonly string[] = FETCH_TOPICS

/** Byte limits for request and response clone capture. */
export interface FetchCaptureOptions {
  readonly maxRequestBodyBytes: number
  readonly maxResponseBodyBytes: number
  readonly maxChunkBytes: number
}

interface CaptureOutcome {
  readonly capturedBytes: number
  readonly truncated: boolean
  readonly captureError?: string
}

/** Active global fetch wrapper. */
export interface FetchObserver {
  /** Restore the prior fetch implementation, cancel clone readers, and await their settlement.
   * @remarks 中文说明：功能说明：停止 stop 相关流程；使用场景由所在模块及调用位置决定。；返回值：Promise<void>；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 stop()，并按返回类型处理结果。 */
  stop(): Promise<void>
}

/**
 * Install full fetch capture for every later call through `globalThis.fetch`.
 * @param publisher - Host source that receives fetch lifecycle records.
 * @param options - Per-body capture limits.
 * @returns The owner that stops capture and awaits pending body readers.
 * @remarks 中文说明：功能说明：处理 installFetchObserver 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：publisher（InspectorPublisher）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：options（FetchCaptureOptions）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。；
 * 返回值：FetchObserver；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * installFetchObserver(publisher, options)，并按返回类型处理结果。
 */
export function installFetchObserver(
  publisher: InspectorPublisher,
  options: FetchCaptureOptions,
): FetchObserver {
  /**
   * 常量说明：descriptor 用于处理 descriptor 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'fetch')
  /**
   * 常量说明：original 用于处理 original 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const original = globalThis.fetch
  if (typeof original !== 'function') throw new Error('inspector: globalThis.fetch is unavailable')
  if (descriptor !== undefined && !('value' in descriptor)) {
    throw new Error('inspector: globalThis.fetch is an accessor and cannot be observed safely')
  }

  /**
   * 常量说明：controller 用于处理 controller 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const controller = new AbortController()
  /**
   * 常量说明：pending 用于处理 pending 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const pending = new Set<Promise<void>>()
  /**
   * 变量说明：nextRequestId 用于处理 nextRequestId 相关数据，作用于当前作用域；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  let nextRequestId = 0

  /**
   * 常量说明：track 用于处理 track 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   * 功能说明：处理 track 相关流程；使用场景由所在模块及调用位置决定。
   * @param promise （Promise<void>）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 track(promise)，并按返回类型处理结果。
   */
  const track = (promise: Promise<void>): void => {
    pending.add(promise)
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    void promise.then(
      () => { pending.delete(promise) },
      () => { pending.delete(promise) },
    )
  }

  /**
   * 常量说明：observedFetch 用于处理 observedFetch 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   * 功能说明：处理 observedFetch 相关流程；使用场景由所在模块及调用位置决定。
   * @param input （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param init （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 observedFetch(input, init)，并按返回类型处理结果。
   */
  const observedFetch: typeof fetch = async (input, init) => {
    /**
     * 常量说明：request 用于处理 request 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const request = new Request(input, init)
    /**
     * 常量说明：requestId 用于处理 requestId 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const requestId = `fetch-${++nextRequestId}`
    publisher.publish('fetch/start', {
      requestId,
      url: request.url,
      method: request.method,
      headers: headerEntries(request.headers),
      hasBody: request.body !== null,
      wallTimeMs: Date.now(),
    })

    /**
     * 变量说明：requestClone 用于处理 requestClone 相关数据，作用于当前作用域；其值可能随流程推进而变化，
     * 读写时需遵守声明类型和所在生命周期。
     */
    let requestClone: Request | undefined
    /**
     * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
     */
    try {
      requestClone = request.clone()
    } catch (error) {
      publisher.publish('fetch/request-body-end', {
        requestId,
        capturedBytes: 0,
        truncated: false,
        captureError: renderError(error),
      })
    }
    if (requestClone !== undefined) {
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：data（由 TypeScript
       * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(data)，并按返回类型处理结果。
       */
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：outcome（由 TypeScript
       * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(outcome)，并按返回类型处理结果。
       */
      track(captureBody(
        requestClone.body,
        options.maxRequestBodyBytes,
        options.maxChunkBytes,
        controller.signal,
        (data) => { publisher.publish('fetch/request-body-chunk', { requestId, data }) },
      ).then((outcome) => {
        publisher.publish('fetch/request-body-end', compactOutcome(requestId, outcome))
      }))
    }

    /**
     * 变量说明：response 用于处理 response 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let response: Response
    /**
     * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
     */
    try {
      response = await Reflect.apply(original, globalThis, [request])
    } catch (error) {
      publisher.publish('fetch/error', {
        requestId,
        message: renderError(error),
        canceled: request.signal.aborted || isAbortError(error),
      })
      throw error
    }

    publisher.publish('fetch/response', {
      requestId,
      url: response.url || request.url,
      status: response.status,
      statusText: response.statusText,
      headers: headerEntries(response.headers),
      mimeType: response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() ?? '',
    })

    /**
     * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
     */
    try {
      /**
       * 常量说明：responseClone 用于处理 responseClone 相关数据，作用于当前作用域；初始化后不可重新赋值，
       * 但对象内部是否可变仍由其类型决定。
       */
      const responseClone = response.clone()
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：data（由 TypeScript
       * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(data)，并按返回类型处理结果。
       */
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：outcome（由 TypeScript
       * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(outcome)，并按返回类型处理结果。
       */
      track(captureBody(
        responseClone.body,
        options.maxResponseBodyBytes,
        options.maxChunkBytes,
        controller.signal,
        (data) => { publisher.publish('fetch/response-body-chunk', { requestId, data }) },
      ).then((outcome) => {
        publisher.publish('fetch/end', {
          requestId,
          capturedBytes: outcome.capturedBytes,
          responseBodyTruncated: outcome.truncated,
          ...(outcome.captureError === undefined ? {} : { responseCaptureError: outcome.captureError }),
        })
      }))
    } catch (error) {
      publisher.publish('fetch/end', {
        requestId,
        capturedBytes: 0,
        responseBodyTruncated: false,
        responseCaptureError: renderError(error),
      })
    }
    return response
  }

  Object.defineProperty(observedFetch, 'name', { value: original.name, configurable: true })
  Object.defineProperty(observedFetch, 'length', { value: original.length, configurable: true })
  Object.defineProperty(globalThis, 'fetch', descriptor === undefined
    ? { value: observedFetch, writable: true, configurable: true }
    : { ...descriptor, value: observedFetch })

  /**
   * 变量说明：stopped 用于处理 stopped 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let stopped: Promise<void> | undefined
  return {
    /**
     * 功能说明：停止 stop 相关流程；使用场景由所在模块及调用位置决定。
     * @returns Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 stop()，并按返回类型处理结果。
     */
    stop(): Promise<void> {
      if (stopped !== undefined) return stopped
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
       */
      stopped = (async () => {
        /**
         * 常量说明：current 用于处理 current 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const current = Object.getOwnPropertyDescriptor(globalThis, 'fetch')
        if (current !== undefined && 'value' in current && current.value === observedFetch) {
          if (descriptor === undefined) Reflect.deleteProperty(globalThis, 'fetch')
          else Object.defineProperty(globalThis, 'fetch', descriptor)
        }
        controller.abort()
        await Promise.allSettled([...pending])
      })()
      return stopped
    },
  }
}

/**
 * 功能说明：处理 captureBody 相关流程；使用场景由所在模块及调用位置决定。
 * @param body （ReadableStream<Uint8Array> | null）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。
 * @param limit （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param chunkLimit （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param signal （AbortSignal）：传递取消或终止信号；必须满足声明的类型及调用时序要求。
 * @param emit （(base64: string) => void）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns Promise<CaptureOutcome>；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 captureBody(body, limit, chunkLimit, signal, emit)，
 * 并按返回类型处理结果。
 */
async function captureBody(
  body: ReadableStream<Uint8Array> | null,
  limit: number,
  chunkLimit: number,
  signal: AbortSignal,
  emit: (base64: string) => void,
): Promise<CaptureOutcome> {
  if (body === null) return { capturedBytes: 0, truncated: false }
  /**
   * 常量说明：reader 用于处理 reader 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const reader = body.getReader()
  /**
   * 常量说明：abort 用于处理 abort 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   * 功能说明：处理 abort 相关流程；使用场景由所在模块及调用位置决定。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 abort()，并按返回类型处理结果。
   */
  const abort = (): void => { /**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
void reader.cancel(signal.reason).catch(() => undefined) }
  signal.addEventListener('abort', abort, { once: true })
  /**
   * 变量说明：capturedBytes 用于处理 capturedBytes 相关数据，作用于当前作用域；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  let capturedBytes = 0
  /**
   * 变量说明：truncated 用于处理 truncated 相关数据，作用于当前作用域；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  let truncated = false
  /**
   * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
   */
  try {
    while (!signal.aborted) {
      /**
       * 常量说明：item 用于处理 item 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const item = await reader.read()
      if (item.done) break
      /**
       * 变量说明：offset 用于处理 offset 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
       */
      let offset = 0
      while (offset < item.value.byteLength) {
        /**
         * 常量说明：remaining 用于处理 remaining 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const remaining = limit - capturedBytes
        if (remaining <= 0) {
          truncated = true
          /**
           * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
           * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
           */
          void reader.cancel('inspector body capture limit reached').catch(() => undefined)
          return { capturedBytes, truncated }
        }
        /**
         * 常量说明：size 用于处理 size 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const size = Math.min(chunkLimit, remaining, item.value.byteLength - offset)
        /**
         * 常量说明：chunk 用于处理 chunk 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const chunk = item.value.subarray(offset, offset + size)
        emit(Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength).toString('base64'))
        capturedBytes += size
        offset += size
      }
    }
    if (signal.aborted) {
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
       */
      void reader.cancel(signal.reason).catch(() => undefined)
      return { capturedBytes, truncated, captureError: 'inspector stopped during body capture' }
    }
    return { capturedBytes, truncated }
  } catch (error) {
    return { capturedBytes, truncated: true, captureError: renderError(error) }
  } finally {
    signal.removeEventListener('abort', abort)
    reader.releaseLock()
  }
}

/**
 * 功能说明：处理 compactOutcome 相关流程；使用场景由所在模块及调用位置决定。
 * @param requestId （string）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。
 * @param outcome （CaptureOutcome）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns InspectorJsonValue；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 compactOutcome(requestId, outcome)，并按返回类型处理结果。
 */
function compactOutcome(requestId: string, outcome: CaptureOutcome): InspectorJsonValue {
  return {
    requestId,
    capturedBytes: outcome.capturedBytes,
    truncated: outcome.truncated,
    ...(outcome.captureError === undefined ? {} : { captureError: outcome.captureError }),
  }
}

/**
 * 功能说明：处理 headerEntries 相关流程；使用场景由所在模块及调用位置决定。
 * @param headers （Headers）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns [string, string][]；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 headerEntries(headers)，并按返回类型处理结果。
 */
function headerEntries(headers: Headers): [string, string][] {
  return [...headers.entries()]
}

/**
 * 功能说明：判断是否为 Abort Error 相关流程；使用场景由所在模块及调用位置决定。
 * @param error （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns boolean；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 isAbortError(error)，并按返回类型处理结果。
 */
function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

/**
 * 功能说明：渲染 Error 相关流程；使用场景由所在模块及调用位置决定。
 * @param error （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns string；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 renderError(error)，并按返回类型处理结果。
 */
function renderError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`
  try {
    return String(error)
  } catch {
    return 'unrenderable fetch error'
  }
}
