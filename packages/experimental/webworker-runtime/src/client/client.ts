/*
 * 【文件职责】在页面端把 Fetch 调用转为 postMessage 请求帧，并从 Worker 响应帧重建 Response。
 */

import type { IndexInjection } from '@deepseek-ai/dsh-host-webserver'
import type {
  TunnelAbortFrame as AbortFrame,
  TunnelOutboundFrame as ResponseFrame,
  TunnelRequestFrame as RequestFrame,
  TunnelRequestId,
  TunnelStreamEndFrame,
  TunnelStreamErrorFrame,
  TunnelStreamItemFrame,
  TunnelStreamOpenFrame,
} from '../transport/frames.ts'

/** Boot payload of the tunnel bootstrap route. */
export interface BootPayload {
  /** Structured index injection table, executed by the page interpreter. */
  injections: IndexInjection[]
}

/** Fetch-shaped transport the client tree consumes. */
export type TunnelFetch = (input: URL | string, init?: RequestInit) => Promise<Response>

interface PendingUnary {
  /**
   * 功能说明：解析 resolve 相关流程；使用场景由所在模块及调用位置决定。
   * @param response （Response）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 resolve(response)，并按返回类型处理结果。
   */
  resolve(response: Response): void
  /**
   * 功能说明：处理 reject 相关流程；使用场景由所在模块及调用位置决定。
   * @param reason （Error）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 reject(reason)，并按返回类型处理结果。
   */
  reject(reason: Error): void
}

type LogicalStreamFrame = TunnelStreamItemFrame | TunnelStreamEndFrame | TunnelStreamErrorFrame

interface TunnelStreamFailureMarker {
  readonly kind: 'remote' | 'carrier'
  readonly code?: string
  readonly details?: object
}

/** Error carrying stream semantics across independently bundled Client code.
 * @remarks 中文说明：类说明：TunnelLogicalStreamError 用于集中封装 处理
 * TunnelLogicalStreamError 相关状态与行为。；核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。；
 * 使用场景：由 experimental/webworker-runtime 在对应插件或业务生命周期内创建和调用。 */
class TunnelLogicalStreamError extends Error {
  /**
   * 常量说明：dshRemoteStreamFailure 用于处理 dshRemoteStreamFailure 相关数据，作用于成员；
   * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  readonly dshRemoteStreamFailure: TunnelStreamFailureMarker

  /**
   * 功能说明：处理 TunnelLogicalStreamError 相关流程；使用场景由所在模块及调用位置决定。
   * @param failure （TunnelStreamErrorFrame['failure']）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。
   * @param options （ErrorOptions）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。
   * @returns 当前类实例；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 通过 new TunnelLogicalStreamError(failure, options) 创建实例，
   * 并在所属生命周期内使用。
   */
  constructor(failure: TunnelStreamErrorFrame['failure'], options?: ErrorOptions) {
    super(failure.message, options)
    this.name = 'TunnelLogicalStreamError'
    this.dshRemoteStreamFailure = failure.kind === 'remote'
      ? { kind: 'remote', code: failure.code, details: failure.details }
      : { kind: 'carrier' }
  }
}

/**
 * 类说明：LogicalStreamInbox 用于集中封装 处理 LogicalStreamInbox 相关状态与行为。
 * 核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。
 * 使用场景：由 experimental/webworker-runtime 在对应插件或业务生命周期内创建和调用。
 */
class LogicalStreamInbox {
  /**
   * 常量说明：frames 用于处理 frames 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly frames: LogicalStreamFrame[] = []
  /**
   * 变量说明：wake 用于处理 wake 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  private wake: (() => void) | undefined
  /**
   * 变量说明：failed 用于处理 failed 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  private failed = false
  /**
   * 变量说明：failure 用于处理 failure 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  private failure: unknown

  /**
   * 功能说明：处理 push 相关流程；使用场景由所在模块及调用位置决定。
   * @param frame （LogicalStreamFrame）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 push(frame)，并按返回类型处理结果。
   */
  push(frame: LogicalStreamFrame): void {
    if (this.failed) return
    this.frames.push(frame)
    this.wake?.()
    this.wake = undefined
  }

  /**
   * 功能说明：处理 fail 相关流程；使用场景由所在模块及调用位置决定。
   * @param reason （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 fail(reason)，并按返回类型处理结果。
   */
  fail(reason: unknown): void {
    if (this.failed) return
    this.failed = true
    this.failure = reason
    this.frames.length = 0
    this.wake?.()
    this.wake = undefined
  }

  /**
   * 功能说明：处理 next 相关流程；使用场景由所在模块及调用位置决定。
   * @returns Promise<LogicalStreamFrame>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 next()，并按返回类型处理结果。
   */
  async next(): Promise<LogicalStreamFrame> {
    while (this.frames.length === 0) {
      if (this.failed) throw this.failure
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolve（由 TypeScript
       * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(resolve)，并按返回类型处理结果。
       */
      await new Promise<void>((resolve) => { this.wake = resolve })
    }
    return this.frames.shift() as LogicalStreamFrame
  }
}

/**
 * Statuses the worker only produces when the host refused the exchange rather than
 * answered it; a route's own 4xx is the tree talking and stays silent here.
 * @remarks 中文说明：常量说明：REFUSAL_STATUS 用于处理 REFUSAL_STATUS 相关数据，作用于当前作用域；
 * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const REFUSAL_STATUS = 500

/**
 * 常量说明：encoder 用于处理 encoder 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const encoder = new TextEncoder()
/**
 * 常量说明：SOURCE_MAP_TRAILER 用于处理 SOURCE_MAP_TRAILER 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const SOURCE_MAP_TRAILER = /\/\/# sourceMappingURL=([^\r\n]+)\s*$/
/**
 * 常量说明：BASE64_CHUNK_BYTES 用于处理 BASE64_CHUNK_BYTES 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const BASE64_CHUNK_BYTES = 32 * 1024

/** Encode UTF-8 text for an inline data URL without a call-stack-sized spread.
 * @remarks 中文说明：功能说明：处理 base64 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：value（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：string；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 base64(value)，并按返回类型处理结果。 */
function base64(value: string): string {
  /**
   * 常量说明：bytes 用于处理 bytes 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const bytes = encoder.encode(value)
  /**
   * 变量说明：binary 用于处理 binary 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let binary = ''
  /**
   * 变量说明：offset 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (let offset = 0; offset < bytes.length; offset += BASE64_CHUNK_BYTES) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + BASE64_CHUNK_BYTES))
  }
  return btoa(binary)
}

/** Replace a tunnel-only map reference with a self-contained Base64 data URL.
 * @remarks 中文说明：功能说明：处理 localizeSourceMap 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：source（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：bundleUrl（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：fetch（TunnelFetch）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：Promise<string>；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * localizeSourceMap(source, bundleUrl, fetch)，并按返回类型处理结果。 */
async function localizeSourceMap(source: string, bundleUrl: string, fetch: TunnelFetch): Promise<string> {
  /**
   * 常量说明：match 用于处理 match 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const match = SOURCE_MAP_TRAILER.exec(source)
  if (match?.[1] === undefined) return source
  try {
    /**
     * 常量说明：response 用于处理 response 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const response = await fetch(new URL(match[1], new URL(bundleUrl, globalThis.location.origin)))
    if (!response.ok) return source.replace(SOURCE_MAP_TRAILER, '')
    /**
     * 常量说明：dataUrl 用于处理 dataUrl 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const dataUrl = `data:application/json;charset=utf-8;base64,${base64(await response.text())}`
    return source.replace(SOURCE_MAP_TRAILER, `//# sourceMappingURL=${dataUrl}`)
  } catch {
    // A source map is diagnostic-only; its transport failure must not prevent
    // the plugin factory from registering.
    return source.replace(SOURCE_MAP_TRAILER, '')
  }
}

/** Keep opaque Blobs and transferable streams intact; normalize other bodies to bytes. */
function toTunnelBody(
  body: RequestInit['body'],
): ArrayBuffer | Blob | ReadableStream<Uint8Array> | undefined {
  if (body === undefined || body === null) return undefined
  if (typeof body === 'string') return encoder.encode(body).buffer
  if (body instanceof Blob) return body
  if (body instanceof ReadableStream) return body as ReadableStream<Uint8Array>
  if (body instanceof ArrayBuffer) return body
  if (ArrayBuffer.isView(body)) {
    return body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength)
  }
  throw new Error(`web-preview tunnel: unsupported request body ${Object.prototype.toString.call(body)}`)
}

/** Statuses whose Response must carry a null body.
 * @remarks 中文说明：常量说明：NULL_BODY_STATUS 用于处理 NULL_BODY_STATUS 相关数据，作用于当前作用域；
 * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
const NULL_BODY_STATUS = new Set([101, 204, 205, 304])

/** The page half of the tunnel: one `fetch`-shaped face over `postMessage`.
 * @remarks 中文说明：类说明：WorkerTunnel 用于集中封装 处理 WorkerTunnel 相关状态与行为。；
 * 核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。；使用场景：由
 * experimental/webworker-runtime 在对应插件或业务生命周期内创建和调用。 */
export class WorkerTunnel {
  /**
   * 常量说明：worker 用于处理 worker 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly worker: Worker
  /**
   * 变量说明：nextId 用于处理 nextId 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  private nextId = 1
  /**
   * 常量说明：unary 用于处理 unary 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly unary = new Map<TunnelRequestId, PendingUnary>()
  /**
   * 常量说明：bodyStreams 用于处理 bodyStreams 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly bodyStreams = new Map<TunnelRequestId, ReadableStreamDefaultController<Uint8Array>>()
  /**
   * 常量说明：logicalStreams 用于处理 logicalStreams 相关数据，作用于成员；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  private readonly logicalStreams = new Map<TunnelRequestId, LogicalStreamInbox>()
  /**
   * In-flight request descriptions, so a refusal names what was refused.
   *
   * A tunnel failure and a failure inside the host tree look identical from the
   * page — both surface as one rejected fetch — and the acceptance run keeps the
   * page console but not the frames. Warning here separates the two without
   * recording anything on the normal path, where no refusal frame ever arrives.
   * @remarks 中文说明：常量说明：inFlight 用于处理 inFlight 相关数据，作用于成员；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  private readonly inFlight = new Map<TunnelRequestId, string>()

  /** Body-phase abort listeners, released when their stream settles.
   * @remarks 中文说明：常量说明：releases 用于处理 releases 相关数据，作用于成员；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。 */
  private readonly releases = new Map<TunnelRequestId, () => void>()

  /**
   * Attach to a spawned worker and start consuming response frames.
   * @param worker - the host worker.
   * @remarks 中文说明：功能说明：处理 WorkerTunnel 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：worker（Worker）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：当前类实例；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：通过 new WorkerTunnel(worker) 创建实例，并在所属生命周期内使用。
   */
  constructor(worker: Worker) {
    this.worker = worker
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：event（MessageEvent<ResponseFrame>
     * ）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(event)，并按返回类型处理结果。
     */
    worker.addEventListener('message', (event: MessageEvent<ResponseFrame>) => {
      this.receive(event.data)
    })
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：event（由 TypeScript
     * 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(event)，并按返回类型处理结果。
     */
    worker.addEventListener('error', (event) => {
      /**
       * 常量说明：reason 用于处理 reason 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const reason = new Error(`web-preview tunnel: worker failed: ${event.message}`)
      /**
       * 变量说明：id 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
       */
      for (const id of this.inFlight.keys()) this.warnRefusal(id, `worker failed: ${event.message}`)
      this.inFlight.clear()
      /**
       * 变量说明：pending 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
       */
      for (const pending of this.unary.values()) pending.reject(reason)
      this.unary.clear()
      /**
       * 变量说明：controller 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
       */
      for (const controller of this.bodyStreams.values()) controller.error(reason)
      this.bodyStreams.clear()
      /**
       * 常量说明：failure 用于处理 failure 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const failure = new TunnelLogicalStreamError({
        kind: 'carrier',
        message: `web-preview tunnel: worker failed: ${event.message}`,
      }, { cause: reason })
      /**
       * 变量说明：inbox 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
       */
      for (const inbox of this.logicalStreams.values()) inbox.fail(failure)
      this.logicalStreams.clear()
      /**
       * 变量说明：release 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
       */
      for (const release of this.releases.values()) release()
      this.releases.clear()
    })
  }

  /**
   * Open the tunnel: the worker assembles its host from this frame.
   * @param image - VFS image URL the worker fetches.
   * @param overlays - Ordered data overlay URLs applied before boot.
   * @remarks 中文说明：功能说明：处理 init 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：image（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数说明：overlays（readonly
   * string[]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 init(image, overlays)，并按返回类型处理结果。
   */
  init(image: string, overlays: readonly string[] = []): void {
    this.worker.postMessage({ t: 'init', image, overlays })
  }

  /** Fetch-shaped entry: one request frame, one Response (streamed when the worker streams).
   * @remarks 中文说明：常量说明：fetch 用于请求 fetch 相关数据，作用于成员；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。；功能说明：请求 fetch 相关流程；使用场景由所在模块及调用位置决定。；参数说明：input（由
   * TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数说明：init（由
   * TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript
   * 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 fetch(input,
   * init)，并按返回类型处理结果。 */
  readonly fetch: TunnelFetch = async (input, init) => {
    /**
     * 常量说明：signal 用于处理 signal 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const signal = init?.signal
    // Checked before any frame leaves: a request the caller already abandoned
    // must not reach the worker, where a write-shaped route would still run.
    if (signal?.aborted === true) throw new DOMException('The operation was aborted.', 'AbortError')
    /**
     * 常量说明：id 用于处理 id 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const id = this.nextId++
    const body = init?.body === undefined || init.body === null ? undefined : toTunnelBody(init.body)
    const frame: RequestFrame = {
      t: 'req',
      id,
      method: init?.method ?? 'GET',
      url: new URL(input, globalThis.location.origin).toString(),
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      ...(body === undefined ? {} : { body }),
    }
    /**
     * 常量说明：response 用于处理 response 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolve（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：reject（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(resolve, reject)，
     * 并按返回类型处理结果。
     */
    const response = new Promise<Response>((resolve, reject) => {
      this.unary.set(id, { resolve, reject })
    })
    this.inFlight.set(id, `${frame.method} ${frame.url}`)
    if (body instanceof ReadableStream) this.worker.postMessage(frame, [body])
    else this.worker.postMessage(frame)
    if (signal === undefined || signal === null) return await response
    /**
     * 常量说明：raced 用于处理 raced 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const raced = this.rejectOnAbort(id, signal)
    try {
      /**
       * 常量说明：settled 用于处理 settled 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const settled = await Promise.race([response, raced.rejected])
      // A streaming response outlives its head: hand the signal to the body
      // phase, so a later stop still ends the stream and reaches the worker.
      if (this.bodyStreams.has(id)) this.observeStreamAbort(id, signal)
      return settled
    } finally {
      raced.release()
    }
  }

  /**
   * Open one decoded Gateway Remote stream over the worker-local carrier.
   * @param endpoint - canonical Gateway Remote endpoint.
   * @param payload - decoded endpoint payload.
   * @param signal - logical-stream cancellation.
   * @returns decoded stream values from the worker Host.
   * @remarks 中文说明：功能说明：打开 open 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：endpoint（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：payload（unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：signal（AbortSignal）：传递取消或终止信号；必须满足声明的类型及调用时序要求。；返回值：AsyncGenerator；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 open(endpoint, payload,
   * signal)，并按返回类型处理结果。
   */
  async *open(endpoint: string, payload: unknown, signal: AbortSignal): AsyncGenerator {
    signal.throwIfAborted()
    /**
     * 常量说明：id 用于处理 id 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const id = this.nextId++
    /**
     * 常量说明：inbox 用于处理 inbox 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const inbox = new LogicalStreamInbox()
    /**
     * 变量说明：opened 用于处理 opened 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let opened = false
    /**
     * 变量说明：terminal 用于处理 terminal 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let terminal = false
    /**
     * 常量说明：onAbort 用于响应 Abort 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     * 功能说明：响应 Abort 相关流程；使用场景由所在模块及调用位置决定。
     * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 onAbort()，并按返回类型处理结果。
     */
    const onAbort = (): void => { inbox.fail(signal.reason) }
    signal.addEventListener('abort', onAbort, { once: true })
    this.logicalStreams.set(id, inbox)
    this.inFlight.set(id, `STREAM ${endpoint}`)
    try {
      /**
       * 常量说明：frame 用于处理 frame 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const frame: TunnelStreamOpenFrame = { t: 'stream-open', id, endpoint, payload }
      /**
       * 变量说明：cause 保存当前捕获的异常；使用前应按项目约定缩小其类型。
       */
      try {
        this.worker.postMessage(frame)
        opened = true
      } catch (cause) {
        throw new TunnelLogicalStreamError({
          kind: 'carrier',
          message: `web-preview tunnel: failed to open Remote stream ${endpoint}`,
        }, { cause })
      }
      while (true) {
        /**
         * 常量说明：response 用于处理 response 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const response = await inbox.next()
        signal.throwIfAborted()
        if (response.t === 'stream-item') {
          yield response.value
          continue
        }
        terminal = true
        if (response.t === 'stream-error') throw new TunnelLogicalStreamError(response.failure)
        return
      }
    } finally {
      signal.removeEventListener('abort', onAbort)
      this.logicalStreams.delete(id)
      this.inFlight.delete(id)
      if (opened && !terminal) this.abortWorkerOperation(id)
    }
  }

  /**
   * Read the pre-cordis boot payload (the injection table).
   * @returns The payload the page applies before the client tree loads.
   * @remarks 中文说明：功能说明：处理 bootPayload 相关流程；使用场景由所在模块及调用位置决定。；
   * 返回值：Promise<BootPayload>；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * bootPayload()，并按返回类型处理结果。
   */
  async bootPayload(): Promise<BootPayload> {
    /**
     * 常量说明：response 用于处理 response 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const response = await this.fetch('/__boot__')
    if (!response.ok) {
      throw new Error(`web-preview tunnel: boot payload failed with HTTP ${String(response.status)}: ${await response.text()}`)
    }
    return await response.json() as BootPayload
  }

  /**
   * `loadBundle` seam: take one client bundle through the tunnel and execute it
   * as a classic script, exactly like the shell's same-origin `<script src>`.
   * The image packs each bundle with a trailing `sourceURL` naming its image
   * path, so the blob shows under that name in the debugger instead of as an
   * anonymous blob entry.
   * @param url - Graph combo URL (`/plugins/??<id>/client.js&rev=...`).
   * @remarks 中文说明：功能说明：加载 Bundle 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：url（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：Promise<void>；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 loadBundle(url)，
   * 并按返回类型处理结果。
   */
  async loadBundle(url: string): Promise<void> {
    /**
     * 常量说明：response 用于处理 response 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const response = await this.fetch(url)
    if (!response.ok) {
      throw new Error(`web-preview tunnel: bundle ${url} failed with HTTP ${String(response.status)}`)
    }
    /**
     * 常量说明：source 用于处理 source 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const source = await localizeSourceMap(await response.text(), url, this.fetch)
    /**
     * 常量说明：blob 用于处理 blob 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const blob = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }))
    try {
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolve（由 TypeScript
       * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：reject（由 TypeScript
       * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(resolve, reject)，
       * 并按返回类型处理结果。
       */
      await new Promise<void>((resolve, reject) => {
        /**
         * 常量说明：el 用于处理 el 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const el = document.createElement('script')
        el.src = blob
        /**
         * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
         * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
         */
        el.addEventListener('load', () => {
          el.remove()
          resolve()
        }, { once: true })
        /**
         * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
         * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
         */
        el.addEventListener('error', () => {
          el.remove()
          reject(new Error(`web-preview tunnel: bundle ${url} failed to execute`))
        }, { once: true })
        document.head.append(el)
      })
    } finally {
      URL.revokeObjectURL(blob)
    }
  }

  /**
   * 功能说明：处理 rejectOnAbort 相关流程；使用场景由所在模块及调用位置决定。
   * @param id （TunnelRequestId）：标识本次操作关联的唯一对象；必须满足声明的类型及调用时序要求。
   * @param signal （AbortSignal）：传递取消或终止信号；必须满足声明的类型及调用时序要求。
   * @returns { rejected: Promise<never>; release: () => void }；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 rejectOnAbort(id, signal)，并按返回类型处理结果。
   */
  private rejectOnAbort(id: TunnelRequestId, signal: AbortSignal): { rejected: Promise<never>; release: () => void } {
    /**
     * 变量说明：release 用于处理 release 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     * 功能说明：处理 release 相关流程；使用场景由所在模块及调用位置决定。
     * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 release()，并按返回类型处理结果。
     */
    let release = (): void => {}
    /**
     * 常量说明：rejected 用于处理 rejected 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：_resolve（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：reject（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(_resolve, reject)，
     * 并按返回类型处理结果。
     */
    const rejected = new Promise<never>((_resolve, reject) => {
      /**
       * 常量说明：fail 用于处理 fail 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       * 功能说明：处理 fail 相关流程；使用场景由所在模块及调用位置决定。
       * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
       * @example 在完成前置校验后调用 fail()，并按返回类型处理结果。
       */
      const fail = (): void => { reject(this.abortRequest(id)) }
      if (signal.aborted) {
        fail()
        return
      }
      signal.addEventListener('abort', fail, { once: true })
      // A completed request must not leave its listener on a long-lived
      // signal, where every further request would pile another one on.
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
       */
      release = () => { signal.removeEventListener('abort', fail) }
    })
    return { rejected, release }
  }

  /**
   * Tear down one request the page abandoned: the maps forget it, the worker
   * is told, and a live body stream errors for its reader.
   * @param id - request id being abandoned.
   * @returns The abort error the caller surfaces.
   * @remarks 中文说明：功能说明：处理 abortRequest 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：id（TunnelRequestId）：标识本次操作关联的唯一对象；必须满足声明的类型及调用时序要求。；
   * 返回值：DOMException；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * abortRequest(id)，并按返回类型处理结果。
   */
  private abortRequest(id: TunnelRequestId): DOMException {
    this.unary.delete(id)
    /**
     * 常量说明：controller 用于处理 controller 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const controller = this.bodyStreams.get(id)
    this.bodyStreams.delete(id)
    this.inFlight.delete(id)
    this.releases.delete(id)
    this.abortWorkerOperation(id)
    /**
     * 常量说明：reason 用于处理 reason 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const reason = new DOMException('The operation was aborted.', 'AbortError')
    controller?.error(reason)
    return reason
  }

  /**
   * Hold the caller's signal over the body phase: the head settled, so
   * {@link rejectOnAbort}'s listener is about to go, but a stop must still
   * end the stream. Released when the stream settles.
   * @param id - request id whose body is still crossing.
   * @param signal - the caller's signal.
   * @remarks 中文说明：功能说明：处理 observeStreamAbort 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：id（TunnelRequestId）：标识本次操作关联的唯一对象；必须满足声明的类型及调用时序要求。；
   * 参数说明：signal（AbortSignal）：传递取消或终止信号；必须满足声明的类型及调用时序要求。；返回值：void；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 observeStreamAbort(id,
   * signal)，并按返回类型处理结果。
   */
  private observeStreamAbort(id: TunnelRequestId, signal: AbortSignal): void {
    /**
     * 常量说明：onAbort 用于响应 Abort 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     * 功能说明：响应 Abort 相关流程；使用场景由所在模块及调用位置决定。
     * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 onAbort()，并按返回类型处理结果。
     */
    const onAbort = (): void => { this.abortRequest(id) }
    signal.addEventListener('abort', onAbort, { once: true })
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    this.releases.set(id, () => { signal.removeEventListener('abort', onAbort) })
  }

  /** Release a body-phase abort listener a settled stream no longer needs.
   * @remarks 中文说明：功能说明：处理 releaseSignal 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：id（TunnelRequestId）：标识本次操作关联的唯一对象；必须满足声明的类型及调用时序要求。；返回值：void；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 releaseSignal(id)，
   * 并按返回类型处理结果。 */
  private releaseSignal(id: TunnelRequestId): void {
    /**
     * 常量说明：release 用于处理 release 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const release = this.releases.get(id)
    this.releases.delete(id)
    release?.()
  }

  /** Cancel a stream the consumer stopped reading (the head already resolved).
   * @remarks 中文说明：功能说明：处理 cancelStream 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：id（TunnelRequestId）：标识本次操作关联的唯一对象；必须满足声明的类型及调用时序要求。；返回值：void；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 cancelStream(id)，
   * 并按返回类型处理结果。 */
  private cancelStream(id: TunnelRequestId): void {
    this.releaseSignal(id)
    this.bodyStreams.delete(id)
    this.inFlight.delete(id)
    this.abortWorkerOperation(id)
  }

  /** Best-effort cancellation: a failed worker cannot receive the frame anyway.
   * @remarks 中文说明：功能说明：处理 abortWorkerOperation 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：id（TunnelRequestId）：标识本次操作关联的唯一对象；必须满足声明的类型及调用时序要求。；返回值：void；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 abortWorkerOperation(id)，
   * 并按返回类型处理结果。 */
  private abortWorkerOperation(id: TunnelRequestId): void {
    /**
     * 常量说明：abort 用于处理 abort 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const abort: AbortFrame = { t: 'abort', id }
    try {
      this.worker.postMessage(abort)
    } catch {
      // The operation is already locally terminal; worker failure is reported by its owning path.
    }
  }

  /**
   * Report a refusal on the page console, where the acceptance run already keeps it.
   *
   * The prefix names the reporter, not the culprit: a 5xx can equally come from a
   * handler inside the host tree. The message text decides — the worker expands
   * nested causes into it, and its deepest layer is where the failure was thrown.
   * @param id - request id the frame answers.
   * @param outcome - what came back instead of a reply.
   * @remarks 中文说明：功能说明：处理 warnRefusal 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：id（TunnelRequestId）：标识本次操作关联的唯一对象；必须满足声明的类型及调用时序要求。；
   * 参数说明：outcome（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 warnRefusal(id, outcome)，并按返回类型处理结果。
   */
  private warnRefusal(id: TunnelRequestId, outcome: string): void {
    console.warn(`web-preview tunnel: request ${String(id)} ${this.inFlight.get(id) ?? '(unknown request)'} → ${outcome}`)
  }

  /**
   * 功能说明：处理 receive 相关流程；使用场景由所在模块及调用位置决定。
   * @param frame （ResponseFrame）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 receive(frame)，并按返回类型处理结果。
   */
  private receive(frame: ResponseFrame): void {
    switch (frame.t) {
      case 'res': {
        /**
         * 常量说明：pending 用于处理 pending 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const pending = this.unary.get(frame.id)
        if (pending === undefined) return
        if (frame.status >= REFUSAL_STATUS) {
          this.warnRefusal(frame.id, `HTTP ${String(frame.status)}${frame.message === undefined ? '' : `: ${frame.message}`}`)
        }
        this.unary.delete(frame.id)
        this.inFlight.delete(frame.id)
        /**
         * 常量说明：body 用于处理 body 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const body = NULL_BODY_STATUS.has(frame.status)
          ? null
          : frame.body ?? frame.message ?? null
        pending.resolve(new Response(body, { status: frame.status, headers: frame.headers }))
        return
      }
      case 'res-head': {
        /**
         * 常量说明：pending 用于处理 pending 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const pending = this.unary.get(frame.id)
        if (pending === undefined) return
        this.unary.delete(frame.id)
        /**
         * 常量说明：stream 用于处理 stream 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        /**
         * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：controller（由 TypeScript
         * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
         * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(controller)，并按返回类型处理结果。
         */
        /**
         * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
         * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
         */
        const stream = new ReadableStream<Uint8Array>({
          start: (controller) => {
            this.bodyStreams.set(frame.id, controller)
          },
          cancel: () => {
            this.cancelStream(frame.id)
          },
        })
        pending.resolve(new Response(stream, { status: frame.status, headers: frame.headers }))
        return
      }
      case 'res-chunk': {
        this.bodyStreams.get(frame.id)?.enqueue(new Uint8Array(frame.chunk))
        return
      }
      case 'res-end': {
        /**
         * 常量说明：controller 用于处理 controller 相关数据，作用于当前作用域；初始化后不可重新赋值，
         * 但对象内部是否可变仍由其类型决定。
         */
        const controller = this.bodyStreams.get(frame.id)
        if (controller === undefined) return
        this.bodyStreams.delete(frame.id)
        this.inFlight.delete(frame.id)
        this.releaseSignal(frame.id)
        controller.close()
        return
      }
      case 'res-err': {
        /**
         * 常量说明：reason 用于处理 reason 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const reason = new Error(`web-preview tunnel: ${frame.message}`)
        this.warnRefusal(frame.id, `res-err: ${frame.message}`)
        /**
         * 常量说明：pending 用于处理 pending 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const pending = this.unary.get(frame.id)
        this.inFlight.delete(frame.id)
        if (pending !== undefined) {
          this.unary.delete(frame.id)
          pending.reject(reason)
          return
        }
        /**
         * 常量说明：controller 用于处理 controller 相关数据，作用于当前作用域；初始化后不可重新赋值，
         * 但对象内部是否可变仍由其类型决定。
         */
        const controller = this.bodyStreams.get(frame.id)
        if (controller === undefined) return
        this.bodyStreams.delete(frame.id)
        this.releaseSignal(frame.id)
        controller.error(reason)
        return
      }
      case 'stream-item':
      case 'stream-end':
      case 'stream-error': {
        this.logicalStreams.get(frame.id)?.push(frame)
        return
      }
      default: {
        /**
         * 常量说明：unknown 用于处理 unknown 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const unknown: never = frame
        throw new Error(`web-preview tunnel: unknown frame ${JSON.stringify(unknown)}`)
      }
    }
  }
}
