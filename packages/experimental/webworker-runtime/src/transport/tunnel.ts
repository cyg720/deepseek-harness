/**
 * Worker end of the postMessage tunnel. It owns the dispatch lanes and the queue
 * that holds requests until the host tree is serving:
 *
 * - `GET /__boot__` answers from tunnel glue, never from the host API surface,
 *   because the page needs the boot payload before its Cordis tree exists.
 * - Privileged `/api` methods take that same direct entry. The method set is not
 *   restated here: a 401 or 403 from the route lane is retried on the direct
 *   lane because the page owns the worker and needs no network authentication.
 * - Everything else is fed into the real webserver route table through the
 *   request listener the app's fake `node:http` captured, keeping the trust
 *   fences, byte limits, and status semantics intact.
 *
 * A boot failure rejects the whole queue with 503 rather than leaving the page
 * waiting.
 * @module @deepseek-ai/dsh-experimental-webworker-runtime/src/transport/tunnel
 * @remarks 文件说明：文件职责：实现 experimental/webworker-runtime 中 tunnel 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/webworker-runtime 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 →
 * 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。
 */
import {
  parseInboundFrame, type TunnelOutboundFrame, type TunnelRequestFrame, type TunnelRequestId,
  type TunnelStreamOpenFrame,
} from './frames.ts'
import {
  createSyntheticExchange, type RequestListener, type ResponseSink, type SyntheticExchange,
} from './synthetic-http.ts'

/** Prefix owning the API methods.
 * @remarks 中文说明：常量说明：API_PREFIX 用于处理 API_PREFIX 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
export const API_PREFIX = '/api'

/** Host header the synthesized requests carry; the API trust fence requires one.
 * @remarks 中文说明：常量说明：SYNTHETIC_HOST 用于处理 SYNTHETIC_HOST 相关数据，作用于当前作用域；
 * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
export const SYNTHETIC_HOST = '127.0.0.1'

/**
 * 常量说明：encoder 用于处理 encoder 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const encoder = new TextEncoder()

/**
 * Render a failure with everything nested inside it.
 *
 * A boot failure is usually an `AggregateError` of per-entry failures, each
 * wrapping the plugin's own error as `cause`; only the outermost message names
 * "loader entries failed to apply", which says nothing about which row broke.
 *
 * The page logs the rendered text verbatim for refusals; keep it stable for
 * anyone matching boot-failure output.
 * @param reason - Thrown value.
 * @returns One line per nested failure, indented by depth.
 * @remarks 中文说明：功能说明：处理 describeFailure 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：reason（unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：string；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 describeFailure(reason)，
 * 并按返回类型处理结果。
 */
export function describeFailure(reason: unknown): string {
  /**
   * 常量说明：seen 用于处理 seen 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const seen = new Set<unknown>()
  /**
   * 常量说明：lines 用于处理 lines 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const lines: string[] = []
  /**
   * 常量说明：walk 用于处理 walk 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   * 功能说明：处理 walk 相关流程；使用场景由所在模块及调用位置决定。
   * @param value （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param depth （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 walk(value, depth)，并按返回类型处理结果。
   */
  const walk = (value: unknown, depth: number): void => {
    if (value === null || value === undefined || seen.has(value) || depth > 6) return
    seen.add(value)
    /**
     * 常量说明：indent 用于处理 indent 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const indent = '  '.repeat(depth)
    if (!(value instanceof Error)) {
      // A thrower may pass anything as a cause; JSON keeps an object readable
      // where the default stringification would print `[object Object]`.
      /**
       * 常量说明：rendered 用于处理 rendered 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const rendered = typeof value === 'string' ? value : JSON.stringify(value) as string | undefined
      lines.push(`${indent}${rendered ?? typeof value}`)
      return
    }
    lines.push(`${indent}${value.name}: ${value.message}`)
    /**
    * 变量说明：inner 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
    */
    if (value instanceof AggregateError) for (const inner of value.errors) walk(inner, depth + 1)
    walk(value.cause, depth + 1)
  }
  walk(reason, 0)
  return lines.join('\n')
}

/**
 * Copy bytes into an exact-size ArrayBuffer so it can be transferred.
 *
 * Sliced on the ArrayBuffer, not the view: `Uint8Array.prototype.slice` copies,
 * but a Node-style Buffer overrides `slice()` with view semantics, and the fs
 * bridge hands VFS reads over as Buffer views into the whole mounted image —
 * `bytes.slice().buffer` would then post the entire image as the body.
 * @remarks 中文说明：功能说明：处理 toTransferable 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：bytes（Uint8Array）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：ArrayBuffer；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 toTransferable(bytes)，
 * 并按返回类型处理结果。
 */
function toTransferable(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

/** Message channel the tunnel posts frames on. */
export interface TunnelPort {
  /**
   * 功能说明：处理 postMessage 相关流程；使用场景由所在模块及调用位置决定。
   * @param message （TunnelOutboundFrame）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param transfer （Transferable[]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 postMessage(message, transfer)，并按返回类型处理结果。
   */
  postMessage(message: TunnelOutboundFrame, transfer?: Transferable[]): void
}

/** What the tunnel gains once the host tree is up. */
export interface TunnelSeams {
  /**
   * Direct entry to the API fetch handler for privileged methods and any unary
   * call the route lane refused with 401 or 403.
   */
  readonly directFetch: (request: Request) => Promise<Response>
  /** Boot payload for `GET /__boot__`: the structured index injection table. */
  readonly bootPayload: () => unknown
  /** Open one decoded Gateway Remote stream without another network carrier. */
  readonly openStream: (
    endpoint: string,
    payload: unknown,
    signal: AbortSignal,
  ) => Promise<AsyncIterable<unknown>>
  /** Convert a Gateway stream failure to stable Client fields. */
  readonly streamFailure: (error: unknown) => {
    readonly code: string
    readonly message: string
    readonly details: object
  }
}

/** Construction inputs for {@link TunnelServer}. */
export interface TunnelServerOptions {
  /** Channel back to the page. */
  readonly port: TunnelPort
  /**
   * The webserver's request listener, captured by the app's fake `node:http`.
   * Awaited on first use, so requests may arrive before the server binds.
   */
  readonly requestListener: () => Promise<RequestListener>
  /**
   * Methods that skip the route lane outright. Supply the host's own privileged
   * set when it is reachable; omitting it leaves the 401/403 retry as the mechanism.
   */
  readonly privilegedMethods?: ReadonlySet<string>
  /**
   * Escape hatch for the unary `/api` lane. `route` (default) keeps every fence
   * and byte limit with a 401/403 retry on the direct lane; `direct` sends every
   * unary `/api` call straight to the fetch handler.
   */
  readonly unaryApiLane?: 'route' | 'direct'
}

interface InFlight {
  /**
   * 功能说明：处理 abort 相关流程；使用场景由所在模块及调用位置决定。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 abort()，并按返回类型处理结果。
   */
  abort(): void
}

type QueuedFrame = TunnelRequestFrame | TunnelStreamOpenFrame

/** Recorded response frames, so a route-lane authentication refusal can be discarded.
 * @remarks 中文说明：类说明：BufferedSink 用于集中封装 处理 BufferedSink 相关状态与行为。；
 * 核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。；使用场景：由
 * experimental/webworker-runtime 在对应插件或业务生命周期内创建和调用。 */
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolve（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(resolve)，并按返回类型处理结果。
 */
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：status（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：headers（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(status, headers)，
 * 并按返回类型处理结果。
 */
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：bytes（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(bytes)，并按返回类型处理结果。
 */
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：payload（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(payload)，并按返回类型处理结果。
 */
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：message（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(message)，并按返回类型处理结果。
 */
/**
* 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
* 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
*/
class BufferedSink {
  /**
   * 常量说明：calls 用于处理 calls 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly calls: Array<() => void> = []
  /**
   * 变量说明：target 用于处理 target 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  private target: ResponseSink | undefined
  /**
   * 变量说明：settle 用于处理 settle 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  private settle: ((outcome: { streamed: boolean; status: number }) => void) | undefined

  /** Resolves when the exchange either starts streaming or answers in one frame.
   * @remarks 中文说明：常量说明：settled 用于处理 settled 相关数据，作用于成员；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。 */
  readonly settled = new Promise<{ streamed: boolean; status: number }>((resolve) => { this.settle = resolve })

  /**
   * 常量说明：sink 用于处理 sink 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  readonly sink: ResponseSink = {
    head: (status, headers) => {
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
       */
      this.record(() => { this.target?.head(status, headers) })
      this.settle?.({ streamed: true, status })
    },
    chunk: (bytes) => { this.record(() => { this.target?.chunk(bytes) }) },
    end: (payload) => {
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
       */
      this.record(() => { this.target?.end(payload) })
      this.settle?.({ streamed: payload === undefined, status: payload?.status ?? 200 })
    },
    fail: (message) => {
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
       */
      this.record(() => { this.target?.fail(message) })
      this.settle?.({ streamed: true, status: 500 })
    },
  }

  /**
   * 功能说明：处理 record 相关流程；使用场景由所在模块及调用位置决定。
   * @param call （() => void）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 record(call)，并按返回类型处理结果。
   */
  private record(call: () => void): void {
    if (this.target === undefined) this.calls.push(call)
    else call()
  }

  /**
   * Send everything recorded so far to a real sink and pass later calls through.
   * @param target - Sink receiving the frames.
   * @remarks 中文说明：功能说明：处理 flushTo 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：target（ResponseSink）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 flushTo(target)，
   * 并按返回类型处理结果。
   */
  flushTo(target: ResponseSink): void {
    this.target = target
    /**
     * 变量说明：call 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const call of this.calls.splice(0)) call()
  }
}

/** One tunnel per worker; wire {@link TunnelServer.handleMessage} to `onmessage` first.
 * @remarks 中文说明：类说明：TunnelServer 用于集中封装 处理 TunnelServer 相关状态与行为。；
 * 核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。；使用场景：由
 * experimental/webworker-runtime 在对应插件或业务生命周期内创建和调用。 */
export class TunnelServer {
  /**
   * 常量说明：port 用于处理 port 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly port: TunnelPort
  /**
   * 常量说明：requestListener 用于处理 requestListener 相关数据，作用于成员；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  private readonly requestListener: () => Promise<RequestListener>
  /**
   * 常量说明：privilegedMethods 用于处理 privilegedMethods 相关数据，作用于成员；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  private readonly privilegedMethods: ReadonlySet<string> | undefined
  /**
   * 常量说明：unaryApiLane 用于处理 unaryApiLane 相关数据，作用于成员；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  private readonly unaryApiLane: 'route' | 'direct'
  /**
   * 常量说明：queue 用于处理 queue 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly queue: QueuedFrame[] = []
  /**
   * 常量说明：inFlight 用于处理 inFlight 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly inFlight = new Map<TunnelRequestId, InFlight>()
  /**
   * 变量说明：seams 用于处理 seams 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  private seams: TunnelSeams | undefined
  /**
   * 变量说明：failure 用于处理 failure 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  private failure: string | undefined
  /**
   * 变量说明：listener 用于处理 listener 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  private listener: RequestListener | undefined

  /**
   * 功能说明：处理 TunnelServer 相关流程；使用场景由所在模块及调用位置决定。
   * @param options （TunnelServerOptions）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。
   * @returns 当前类实例；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 通过 new TunnelServer(options) 创建实例，并在所属生命周期内使用。
   */
  constructor(options: TunnelServerOptions) {
    this.port = options.port
    this.requestListener = options.requestListener
    this.privilegedMethods = options.privilegedMethods
    this.unaryApiLane = options.unaryApiLane ?? 'route'
  }

  /**
   * Accept one `postMessage` payload.
   * @param data - Message data from the page.
   * @remarks 中文说明：功能说明：处理 Message 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：data（unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 handleMessage(data)，并按返回类型处理结果。
   */
  handleMessage(data: unknown): void {
    /**
     * 常量说明：frame 用于处理 frame 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const frame = parseInboundFrame(data)
    if (frame.t === 'init') {
      // The worker entry consumes the opening init before this server exists;
      // one reaching a live server is a client double-connect.
      throw new Error('webworker tunnel: duplicate init frame; the tunnel is already open')
    }
    if (frame.t === 'abort') {
      this.inFlight.get(frame.id)?.abort()
      this.inFlight.delete(frame.id)
      // A request still parked in the boot queue must not run after its
      // caller gave up; serve() would otherwise execute it post-boot.
      /**
       * 常量说明：queued 用于处理 queued 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：request（由 TypeScript
       * 根据调用位置推断的类型）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(request)，并按返回类型处理结果。
       */
      const queued = this.queue.findIndex(request => request.id === frame.id)
      if (queued !== -1) this.queue.splice(queued, 1)
      return
    }
    if (this.failure !== undefined) {  this.refuse(frame, this.failure); return }
    if (this.seams === undefined) {
      this.queue.push(frame)
      return
    }
    this.dispatchFrame(frame)
  }

  /**
   * Start serving: drains everything queued during boot.
   * @param seams - Faces that exist only after the host tree is up.
   * @remarks 中文说明：功能说明：处理 serve 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：seams（TunnelSeams）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 serve(seams)，并按返回类型处理结果。
   */
  serve(seams: TunnelSeams): void {
    this.seams = seams
    console.info(`webworker tunnel: serving (unary /api lane=${this.unaryApiLane}${this.unaryApiLane === 'route' ? ' with 401/403 retry' : ''}, privileged set=${this.privilegedMethods === undefined ? 'none' : String(this.privilegedMethods.size)}, queued=${String(this.queue.length)})`)
    /**
     * 变量说明：frame 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const frame of this.queue.splice(0)) this.dispatchFrame(frame)
  }

  /**
   * Refuse every queued and future request; the page renders this like a server
   * that failed to start.
   * @param reason - Boot failure to report.
   * @remarks 中文说明：功能说明：处理 fail 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：reason（unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 fail(reason)，并按返回类型处理结果。
   */
  fail(reason: unknown): void {
    /**
     * 常量说明：message 用于处理 message 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const message = describeFailure(reason)
    this.failure = message
    /**
     * 变量说明：frame 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const frame of this.queue.splice(0)) this.refuse(frame, message)
  }

  /**
   * 功能说明：处理 send 相关流程；使用场景由所在模块及调用位置决定。
   * @param frame （TunnelOutboundFrame）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param transfer （Transferable[]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 send(frame, transfer)，并按返回类型处理结果。
   */
  private send(frame: TunnelOutboundFrame, transfer?: Transferable[]): void {
    this.port.postMessage(frame, transfer)
  }

  /**
   * 功能说明：处理 refuse 相关流程；使用场景由所在模块及调用位置决定。
   * @param frame （QueuedFrame）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param message （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 refuse(frame, message)，并按返回类型处理结果。
   */
  private refuse(frame: QueuedFrame, message: string): void {
    if (frame.t === 'stream-open') {
      this.send({
        t: 'stream-error',
        id: frame.id,
        failure: { kind: 'carrier', message },
      })
      return
    }
    /**
     * 常量说明：body 用于处理 body 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const body = toTransferable(encoder.encode(message))
    this.send({
      t: 'res',
      id: frame.id,
      status: 503,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
      body,
      message,
    }, [body])
  }

  /**
   * 功能说明：分发 Frame 相关流程；使用场景由所在模块及调用位置决定。
   * @param frame （QueuedFrame）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 dispatchFrame(frame)，并按返回类型处理结果。
   */
  private dispatchFrame(frame: QueuedFrame): void {
    if (frame.t === 'stream-open') void this.serveStream(frame)
    else void this.serveRequest(frame)
  }

  /**
   * 功能说明：处理 serveStream 相关流程；使用场景由所在模块及调用位置决定。
   * @param frame （TunnelStreamOpenFrame）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 serveStream(frame)，并按返回类型处理结果。
   */
  private async serveStream(frame: TunnelStreamOpenFrame): Promise<void> {
    if (this.seams === undefined) {
      this.refuse(frame, 'webworker tunnel: Remote stream requested before the host tree is serving')
      return
    }
    /**
     * 常量说明：seams 用于处理 seams 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const seams = this.seams
    /**
     * 常量说明：controller 用于处理 controller 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const controller = new AbortController()
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    this.inFlight.set(frame.id, { abort: () => { controller.abort() } })
    /**
     * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
     */
    try {
      /**
       * 常量说明：source 用于处理 source 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const source = await seams.openStream(frame.endpoint, frame.payload, controller.signal)
      /**
       * 变量说明：value 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
       */
      for await (const value of source) {
        if (controller.signal.aborted) return
        this.send({ t: 'stream-item', id: frame.id, value })
      }
      if (!controller.signal.aborted) this.send({ t: 'stream-end', id: frame.id })
    } catch (error) {
      if (!controller.signal.aborted) {
        /**
         * 常量说明：failure 用于处理 failure 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const failure = seams.streamFailure(error)
        this.send({
          t: 'stream-error',
          id: frame.id,
          failure: { kind: 'remote', ...failure },
        })
      }
    } finally {
      this.inFlight.delete(frame.id)
    }
  }

  /**
   * 功能说明：处理 sinkFor 相关流程；使用场景由所在模块及调用位置决定。
   * @param id （TunnelRequestId）：标识本次操作关联的唯一对象；必须满足声明的类型及调用时序要求。
   * @returns ResponseSink；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 sinkFor(id)，并按返回类型处理结果。
   */
  private sinkFor(id: TunnelRequestId): ResponseSink {
    /**
     * 常量说明：send 用于处理 send 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const send = this.send.bind(this)
    /**
     * 常量说明：inFlight 用于处理 inFlight 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const inFlight = this.inFlight
    return {
      /**
       * 功能说明：处理 head 相关流程；使用场景由所在模块及调用位置决定。
       * @param status （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
       * @param headers （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
       * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
       * @example 在完成前置校验后调用 head(status, headers)，并按返回类型处理结果。
       */
      head(status, headers) {
        send({ t: 'res-head', id, status, headers })
      },
      /**
       * 功能说明：处理 chunk 相关流程；使用场景由所在模块及调用位置决定。
       * @param bytes （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
       * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
       * @example 在完成前置校验后调用 chunk(bytes)，并按返回类型处理结果。
       */
      chunk(bytes) {
        /**
         * 常量说明：buffer 用于处理 buffer 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const buffer = toTransferable(bytes)
        send({ t: 'res-chunk', id, chunk: buffer }, [buffer])
      },
      /**
       * 功能说明：处理 end 相关流程；使用场景由所在模块及调用位置决定。
       * @param payload （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
       * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
       * @example 在完成前置校验后调用 end(payload)，并按返回类型处理结果。
       */
      end(payload) {
        if (payload === undefined) {
          send({ t: 'res-end', id })
        } else {
          /**
           * 常量说明：body 用于处理 body 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
           */
          const body = payload.body === undefined ? undefined : toTransferable(payload.body)
          send({ t: 'res', id, status: payload.status, headers: payload.headers, body }, body === undefined ? undefined : [body])
        }
        inFlight.delete(id)
      },
      /**
       * 功能说明：处理 fail 相关流程；使用场景由所在模块及调用位置决定。
       * @param message （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
       * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
       * @example 在完成前置校验后调用 fail(message)，并按返回类型处理结果。
       */
      fail(message) {
        send({ t: 'res-err', id, message })
        inFlight.delete(id)
      },
    }
  }

  /** The page sends an absolute URL; route handlers read `req.url` as a path.
   * @remarks 中文说明：功能说明：处理 pathFrame 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：frame（TunnelRequestFrame）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：{
   * frame: TunnelRequestFrame; path: string }；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 使用示例：典型用法：在完成前置校验后调用 pathFrame(frame)，并按返回类型处理结果。 */
  private pathFrame(frame: TunnelRequestFrame): { frame: TunnelRequestFrame; path: string } {
    /**
     * 常量说明：url 用于处理 url 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const url = new URL(frame.url, `http://${SYNTHETIC_HOST}`)
    return {
      // The API trust fence reads `host`, which the page cannot set itself.
      frame: { ...frame, url: `${url.pathname}${url.search}`, headers: { ...frame.headers, host: SYNTHETIC_HOST } },
      path: url.pathname,
    }
  }

  /**
   * 功能说明：处理 serveRequest 相关流程；使用场景由所在模块及调用位置决定。
   * @param frame （TunnelRequestFrame）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 serveRequest(frame)，并按返回类型处理结果。
   */
  private async serveRequest(frame: TunnelRequestFrame): Promise<void> {
    /**
     * 常量说明：sink 用于处理 sink 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const sink = this.sinkFor(frame.id)
    /**
     * 变量说明：reason 保存当前捕获的异常；使用前应按项目约定缩小其类型。
     */
    try {
      /**
       * 常量说明：routed、path 用于处理 routed、path 相关数据，作用于当前作用域；初始化后不可重新赋值，
       * 但对象内部是否可变仍由其类型决定。
       */
      const { frame: routed, path } = this.pathFrame(frame)
      if (path === '/__boot__') {  this.serveBoot(frame, sink); return }
      if (path.startsWith(`${API_PREFIX}/`)) {  await this.serveApi(frame, routed, path, sink); return }
      this.dispatch(routed, sink)
    } catch (reason) {
      sink.fail(reason instanceof Error ? reason.message : String(reason))
    }
  }

  /**
   * The listener is captured once and reused, so only requests that arrive
   * before the web server binds pay an await.
   * @returns The webserver request listener.
   * @remarks 中文说明：功能说明：处理 whenListener 相关流程；使用场景由所在模块及调用位置决定。；
   * 返回值：Promise<RequestListener>；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 使用示例：典型用法：在完成前置校验后调用 whenListener()，并按返回类型处理结果。
   */
  private async whenListener(): Promise<RequestListener> {
    this.listener ??= await this.requestListener()
    return this.listener
  }

  /** Feed the real route table through the captured listener.
   * @remarks 中文说明：功能说明：分发 dispatch 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：frame（TunnelRequestFrame）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：sink（ResponseSink）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：into（ResponseSink）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：SyntheticExchange；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * dispatch(frame, sink, into)，并按返回类型处理结果。 */
  private dispatch(frame: TunnelRequestFrame, sink: ResponseSink, into?: ResponseSink): SyntheticExchange {
    /**
     * 常量说明：exchange 用于处理 exchange 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const exchange = createSyntheticExchange(frame, into ?? sink)
    this.inFlight.set(frame.id, exchange)
    /**
     * 常量说明：listener 用于处理 listener 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const listener = this.listener
    if (listener !== undefined) {
      listener(exchange.req, exchange.res)
      return exchange
    }
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolved（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(resolved)，并按返回类型处理结果。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：reason（unknown）：提供本次调用所需的数据；
     * 必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；
     * 典型用法：在完成前置校验后调用 匿名回调(reason)，并按返回类型处理结果。
     */
    void this.whenListener().then((resolved) => {
      // A page that gave up while the server was still binding has nothing to answer.
      if (!exchange.aborted) resolved(exchange.req, exchange.res)
    }, (reason: unknown) => {
      sink.fail(reason instanceof Error ? reason.message : String(reason))
    })
    return exchange
  }

  /**
   * Unary `/api`: keep the route lane's fences, but fall back to the direct lane
   * when network authentication or trust rejects the worker-owning page.
   * @remarks 中文说明：功能说明：处理 serveApi 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：original（TunnelRequestFrame）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：routed（TunnelRequestFrame）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：path（string）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；
   * 参数说明：sink（ResponseSink）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：Promise<void>；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 serveApi(original,
   * routed, path, sink)，并按返回类型处理结果。
   */
  private async serveApi(
    original: TunnelRequestFrame,
    routed: TunnelRequestFrame,
    path: string,
    sink: ResponseSink,
  ): Promise<void> {
    /**
     * 常量说明：method 用于处理 method 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const method = path.slice(API_PREFIX.length + 1)
    if (this.unaryApiLane === 'direct' || this.privilegedMethods?.has(method) === true) {
      await this.serveDirect(original, sink)
      return
    }
    /**
     * 常量说明：buffered 用于处理 buffered 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const buffered = new BufferedSink()
    /**
     * 常量说明：exchange 用于处理 exchange 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const exchange = this.dispatch(routed, sink, buffered.sink)
    // An abort must release this wait too: an aborted exchange stops emitting
    // frames, so `settled` alone would never resolve when the handler had not
    // yet written a head.
    /**
     * 变量说明：settleAborted 用于处理 settleAborted 相关数据，作用于当前作用域；其值可能随流程推进而变化，
     * 读写时需遵守声明类型和所在生命周期。
     * 功能说明：处理 settleAborted 相关流程；使用场景由所在模块及调用位置决定。
     * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 settleAborted()，并按返回类型处理结果。
     */
    let settleAborted = (): void => {}
    /**
     * 常量说明：aborted 用于处理 aborted 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolve（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(resolve)，并按返回类型处理结果。
     */
    /**
    * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
    * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
    */
    const aborted = new Promise<'aborted'>((resolve) => { settleAborted = () => { resolve('aborted') } })
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    this.inFlight.set(routed.id, { abort: () => { exchange.abort(); settleAborted() } })
    /**
     * 常量说明：outcome 用于处理 outcome 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const outcome = await Promise.race([buffered.settled, aborted])
    if (outcome === 'aborted' || exchange.aborted) return
    // The decision happens at the first frame, before anything reaches the page:
    // the route lane streams its answers, so a refusal can carry a body too.
    if (outcome.status === 401 || outcome.status === 403) {
      console.debug(`webworker tunnel: route lane refused ${method} with ${String(outcome.status)}; answering on the direct lane`)
      await this.serveDirect(original, sink)
      return
    }
    buffered.flushTo(sink)
  }

  /**
   * 功能说明：处理 serveBoot 相关流程；使用场景由所在模块及调用位置决定。
   * @param frame （TunnelRequestFrame）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param sink （ResponseSink）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 serveBoot(frame, sink)，并按返回类型处理结果。
   */
  private serveBoot(frame: TunnelRequestFrame, sink: ResponseSink): void {
    if (this.seams === undefined) throw new Error('webworker tunnel: boot payload requested before the host tree is serving')
    if (frame.method !== 'GET') {
      sink.end({ status: 405, headers: { allow: 'GET' } })
      return
    }
    /**
     * 常量说明：body 用于处理 body 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const body = encoder.encode(JSON.stringify(this.seams.bootPayload()))
    sink.end({
      status: 200,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
      body,
    })
  }

  /**
   * 功能说明：处理 serveDirect 相关流程；使用场景由所在模块及调用位置决定。
   * @param frame （TunnelRequestFrame）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param sink （ResponseSink）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 serveDirect(frame, sink)，并按返回类型处理结果。
   */
  private async serveDirect(frame: TunnelRequestFrame, sink: ResponseSink): Promise<void> {
    if (this.seams === undefined) throw new Error('webworker tunnel: direct fetch requested before the host tree is serving')
    /**
     * 常量说明：controller 用于处理 controller 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const controller = new AbortController()
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    this.inFlight.set(frame.id, { abort: () => { controller.abort() } })
    /**
     * 常量说明：headers 用于处理 headers 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const headers = new Headers()
    /**
     * 变量说明：key、value 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const [key, value] of Object.entries(frame.headers)) {
      // Forbidden header names throw on a guarded Headers instance.
      try {
        headers.set(key, value)
      } catch {
        // The fetch handler reads no forbidden header; the route lane owns those.
      }
    }
    /**
     * 常量说明：request 用于处理 request 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const request = new Request(new URL(frame.url, `http://${SYNTHETIC_HOST}`), {
      method: frame.method,
      headers,
      body: frame.body === undefined || frame.method === 'GET' || frame.method === 'HEAD' ? null : frame.body,
      signal: controller.signal,
    })
    /**
     * 常量说明：response 用于处理 response 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const response = await this.seams.directFetch(request)
    /**
     * 常量说明：responseHeaders 用于处理 responseHeaders 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const responseHeaders: Record<string, string> = {}
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：value（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：key（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(value, key)，并按返回类型处理结果。
     */
    response.headers.forEach((value, key) => { responseHeaders[key] = value })
    // Event streams are the only responses the page consumes incrementally;
    // everything else answers as one frame, as the route lane does.
    /**
     * 常量说明：streamed 用于处理 streamed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const streamed = response.body !== null && (responseHeaders['content-type'] ?? '').startsWith('text/event-stream')
    if (!streamed) {
      /**
       * 常量说明：buffer 用于处理 buffer 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const buffer = await response.arrayBuffer()
      sink.end({
        status: response.status,
        headers: responseHeaders,
        body: buffer.byteLength === 0 ? undefined : new Uint8Array(buffer),
      })
      return
    }
    sink.head(response.status, responseHeaders)
    /**
     * 常量说明：reader 用于处理 reader 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const reader = response.body.getReader()
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    this.inFlight.set(frame.id, {
      abort: () => {
        controller.abort()
        /**
         * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
         * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
         */
        void reader.cancel().catch(() => {
          // Cancelling an already-errored stream has nothing left to release.
        })
      },
    })
    /**
     * 变量说明：reason 保存当前捕获的异常；使用前应按项目约定缩小其类型。
     */
    try {
      for (;;) {
        /**
         * 常量说明：done、value 用于处理 done、value 相关数据，作用于当前作用域；初始化后不可重新赋值，
         * 但对象内部是否可变仍由其类型决定。
         */
        const { done, value } = await reader.read()
        if (done) break
        sink.chunk(value)
      }
      sink.end()
    } catch (reason) {
      sink.fail(reason instanceof Error ? reason.message : String(reason))
    } finally {
      reader.releaseLock()
    }
  }
}
