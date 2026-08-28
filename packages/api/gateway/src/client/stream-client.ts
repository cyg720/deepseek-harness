/** Browser owner for the Gateway multiplexed Remote stream socket.
 * @remarks 文件说明：文件职责：实现 api/gateway 中 stream client 模块的职责，并向相邻模块提供可复用能力。；
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的 api/gateway 能力，
 * 使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。；
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。 */

import {
  parseRemoteStreamServerMessage,
  REMOTE_STREAM_MUX_PATH,
  type RemoteStreamClientMessage,
  type RemoteStreamServerMessage,
} from '../stream-protocol.ts'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'

/**
 * 常量说明：INTERNAL_BASE 用于处理 INTERNAL_BASE 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const INTERNAL_BASE = 'http://dsh.internal'
/**
 * 常量说明：RECONNECT_BASE_MS 用于处理 RECONNECT_BASE_MS 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const RECONNECT_BASE_MS = 500
/**
 * 常量说明：RECONNECT_FACTOR 用于处理 RECONNECT_FACTOR 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const RECONNECT_FACTOR = 2
/**
 * 常量说明：RECONNECT_MAX_MS 用于处理 RECONNECT_MAX_MS 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const RECONNECT_MAX_MS = 10_000

/** One Host-reported Remote stream failure.
 * @remarks 中文说明：类说明：RemoteStreamError 用于集中封装 处理 RemoteStreamError 相关状态与行为。；
 * 核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。；使用场景：由 api/gateway
 * 在对应插件或业务生命周期内创建和调用。 */
export class RemoteStreamError extends Error {
  /** Stable carrier or Gateway error category.
   * @remarks 中文说明：常量说明：code 用于处理 code 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
  readonly code: string
  /** Host-provided structured failure context.
   * @remarks 中文说明：常量说明：details 用于处理 details 相关数据，作用于成员；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。 */
  readonly details: object

  /**
   * @param code - stable Gateway or business error category.
   * @param message - Host-provided failure description.
   * @param details - Host-provided structured failure context.
   * @remarks 中文说明：功能说明：处理 RemoteStreamError 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：code（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：message（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：details（object）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：当前类实例；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：通过 new RemoteStreamError(code, message, details)
   * 创建实例，并在所属生命周期内使用。
   */
  constructor(code: string, message: string, details: object) {
    super(message)
    this.name = 'RemoteStreamError'
    this.code = code
    this.details = details
  }
}

/** Physical Remote stream socket failure that may be retried by a domain transport.
 * @remarks 中文说明：类说明：RemoteStreamCarrierError 用于集中封装 处理
 * RemoteStreamCarrierError 相关状态与行为。；核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。；
 * 使用场景：由 api/gateway 在对应插件或业务生命周期内创建和调用。 */
export class RemoteStreamCarrierError extends Error {
  /**
   * @param message - physical carrier failure description.
   * @param options - optional causal error.
   * @remarks 中文说明：功能说明：处理 RemoteStreamCarrierError 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：message（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：options（ErrorOptions）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。；返回值：当前类实例；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：通过 new
   * RemoteStreamCarrierError(message, options) 创建实例，并在所属生命周期内使用。
   */
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'RemoteStreamCarrierError'
  }
}

interface SocketWaiter {
  /**
   * 功能说明：解析 resolve 相关流程；使用场景由所在模块及调用位置决定。
   * @param socket （WebSocket）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 resolve(socket)，并按返回类型处理结果。
   */
  resolve(socket: WebSocket): void
  /**
   * 功能说明：处理 reject 相关流程；使用场景由所在模块及调用位置决定。
   * @param error （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 reject(error)，并按返回类型处理结果。
   */
  reject(error: unknown): void
}

/** Keep one physical WebSocket and share it among independently cancellable Remote streams.
 * @remarks 中文说明：类说明：RemoteStreamMuxClient 用于集中封装 处理 RemoteStreamMuxClient
 * 相关状态与行为。；核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。；使用场景：由 api/gateway
 * 在对应插件或业务生命周期内创建和调用。 */
export class RemoteStreamMuxClient {
  /**
   * 变量说明：socket 用于处理 socket 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  private socket: WebSocket | undefined
  /**
   * 变量说明：cancelCandidate 用于处理 cancelCandidate 相关数据，作用于成员；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  private cancelCandidate: ((error: Error) => void) | undefined
  /**
   * 变量说明：keepAlive 用于处理 keepAlive 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  private keepAlive: Promise<void> | undefined
  /**
   * 变量说明：keepAliveAbort 用于处理 keepAliveAbort 相关数据，作用于成员；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  private keepAliveAbort: AbortController | undefined
  /**
   * 常量说明：streams 用于处理 streams 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly streams = new Map<string, StreamInbox>()
  /**
   * 常量说明：waiters 用于处理 waiters 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly waiters = new Set<SocketWaiter>()
  /**
   * 变量说明：running 用于处理 running 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  private running = false
  /**
   * 变量说明：disposed 用于处理 disposed 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  private disposed = false

  /** Start the persistent physical connection; repeated calls are inert.
   * @remarks 中文说明：功能说明：启动 start 相关流程；使用场景由所在模块及调用位置决定。；返回值：void；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 start()，并按返回类型处理结果。 */
  start(): void {
    if (this.running || this.disposed) return
    this.running = true
    this.maintain()
  }

  /**
   * Open one logical stream on the persistent physical connection.
   * @param endpoint - Typert Remote stream endpoint.
   * @param payload - endpoint request encoded on the wire.
   * @param signal - cancellation for this logical stream.
   * @returns Host items until completion, cancellation, or failure.
   * @remarks 中文说明：功能说明：打开 open 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：endpoint（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：payload（unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：signal（AbortSignal）：传递取消或终止信号；必须满足声明的类型及调用时序要求。；返回值：AsyncGenerator；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 open(endpoint, payload,
   * signal)，并按返回类型处理结果。
   */
  async *open(
    endpoint: string,
    payload: unknown,
    signal: AbortSignal,
  ): AsyncGenerator {
    this.start()
    signal.throwIfAborted()
    /**
     * 常量说明：streamId 用于处理 streamId 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const streamId = randomUUID()
    /**
     * 常量说明：inbox 用于处理 inbox 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const inbox = new StreamInbox()
    /**
     * 变量说明：carrier 用于处理 carrier 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let carrier: WebSocket | undefined
    /**
     * 变量说明：opened 用于处理 opened 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let opened = false
    /**
     * 变量说明：terminal 用于处理 terminal 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let terminal = false
    /**
     * 常量说明：abort 用于处理 abort 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     * 功能说明：处理 abort 相关流程；使用场景由所在模块及调用位置决定。
     * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 abort()，并按返回类型处理结果。
     */
    const abort = (): void => { inbox.fail(signal.reason) }
    signal.addEventListener('abort', abort, { once: true })
    try {
      /**
       * 常量说明：socket 用于处理 socket 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const socket = await this.waitForSocket(signal)
      signal.throwIfAborted()
      carrier = socket
      this.streams.set(streamId, inbox)
      this.send(socket, { type: 'open', streamId, endpoint, payload })
      opened = true
      while (true) {
        /**
         * 常量说明：frame 用于处理 frame 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const frame = await inbox.next()
        signal.throwIfAborted()
        if (frame.type === 'item') {
          yield frame.value
          continue
        }
        terminal = true
        if (frame.type === 'error') {
          throw new RemoteStreamError(frame.error.code, frame.error.message, frame.error.details)
        }
        return
      }
    } finally {
      signal.removeEventListener('abort', abort)
      this.streams.delete(streamId)
      if (opened && !terminal && carrier?.readyState === WebSocket.OPEN) {
        this.send(carrier, { type: 'cancel', streamId })
      }
    }
  }

  /**
   * Permanently stop reconnecting, close the physical socket, and fail every active logical stream.
   * @returns once the background connection loop has stopped.
   * @remarks 中文说明：功能说明：关闭 close 相关流程；使用场景由所在模块及调用位置决定。；返回值：Promise<void>；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 close()，并按返回类型处理结果。
   */
  async close(): Promise<void> {
    if (!this.disposed) {
      this.disposed = true
      this.running = false
      /**
       * 常量说明：error 用于处理 error 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const error = new Error('api gateway: Remote stream client disposed')
      this.keepAliveAbort?.abort(error)
      this.keepAliveAbort = undefined
      this.failAll(error)
      for (const /*
       * 变量说明：waiter 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
       */ waiter of [...this.waiters]) waiter.reject(error)
      this.cancelCandidate?.(error)
      /**
       * 常量说明：socket 用于处理 socket 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const socket = this.socket
      this.socket = undefined
      socket?.close(1000, 'disposed')
    }
    await this.keepAlive
  }

  /**
   * 功能说明：处理 connect 相关流程；使用场景由所在模块及调用位置决定。
   * @returns Promise<WebSocket>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 connect()，并按返回类型处理结果。
   */
  private connect(): Promise<WebSocket> {
    /**
     * 常量说明：socket 用于处理 socket 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const socket = new WebSocket(remoteStreamUrl())
    /**
     * 常量说明：connecting 用于处理 connecting 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const connecting = new Promise<WebSocket>(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolve（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：reject（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(resolve, reject)，
 * 并按返回类型处理结果。
 */ (resolve, reject) => {
      /**
       * 变量说明：settled 用于处理 settled 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
       */
        let settled = false
        /**
       * 常量说明：rejectCandidate 用于处理 rejectCandidate 相关数据，作用于当前作用域；初始化后不可重新赋值，
       * 但对象内部是否可变仍由其类型决定。
       * 功能说明：处理 rejectCandidate 相关流程；使用场景由所在模块及调用位置决定。
       * @param error （Error）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
       * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
       * @example 在完成前置校验后调用 rejectCandidate(error)，并按返回类型处理结果。
       */
        const rejectCandidate = (error: Error): void => {
          settled = true
          socket.removeEventListener('open', opened)
          socket.removeEventListener('error', failed)
          socket.removeEventListener('message', received)
          socket.removeEventListener('close', closed)
          this.cancelCandidate = undefined
          socket.close()
          reject(error)
        }
        /**
       * 常量说明：opened 用于处理 opened 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       * 功能说明：处理 opened 相关流程；使用场景由所在模块及调用位置决定。
       * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
       * @example 在完成前置校验后调用 opened()，并按返回类型处理结果。
       */
        const opened = (): void => {
          settled = true
          this.cancelCandidate = undefined
          this.socket = socket
          for (const /*
         * 变量说明：waiter 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
         */ waiter of [...this.waiters]) waiter.resolve(socket)
          resolve(socket)
        }
        /**
       * 常量说明：failed 用于处理 failed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       * 功能说明：处理 failed 相关流程；使用场景由所在模块及调用位置决定。
       * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
       * @example 在完成前置校验后调用 failed()，并按返回类型处理结果。
       */
        const failed = (): void => {
          if (!settled) {
            rejectCandidate(new RemoteStreamCarrierError(
              'api gateway: Remote stream WebSocket failed to open',
            ))
            return
          }
          /**
         * 常量说明：error 用于处理 error 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
          const error = new RemoteStreamCarrierError('api gateway: Remote stream WebSocket failed')
          this.lost(socket, error)
          socket.close()
        }
        /**
       * 常量说明：closed 用于处理 closed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       * 功能说明：处理 closed 相关流程；使用场景由所在模块及调用位置决定。
       * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
       * @example 在完成前置校验后调用 closed()，并按返回类型处理结果。
       */
        const closed = (): void => {
          if (!settled) {
            rejectCandidate(new RemoteStreamCarrierError(
              'api gateway: Remote stream WebSocket closed before opening',
            ))
            return
          }
          this.lost(socket)
        }
        /**
       * 常量说明：received 用于处理 received 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       * 功能说明：处理 received 相关流程；使用场景由所在模块及调用位置决定。
       * @param event （MessageEvent）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。
       * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
       * @example 在完成前置校验后调用 received(event)，并按返回类型处理结果。
       */
        const received = (event: MessageEvent): void => { this.receive(socket, event.data) }
        this.cancelCandidate = rejectCandidate
        socket.addEventListener('open', opened, { once: true })
        socket.addEventListener('error', failed, { once: true })
        socket.addEventListener('message', received)
        socket.addEventListener('close', closed, { once: true })
      })
    return connecting
  }

  /**
   * 功能说明：处理 waitForSocket 相关流程；使用场景由所在模块及调用位置决定。
   * @param signal （AbortSignal）：传递取消或终止信号；必须满足声明的类型及调用时序要求。
   * @returns Promise<WebSocket>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 waitForSocket(signal)，并按返回类型处理结果。
   */
  private waitForSocket(signal: AbortSignal): Promise<WebSocket> {
    signal.throwIfAborted()
    if (this.socket?.readyState === WebSocket.OPEN) return Promise.resolve(this.socket)
    if (this.disposed) return Promise.reject(new Error('api gateway: Remote stream client disposed'))
    this.start()
    return new Promise(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolve（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：reject（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(resolve, reject)，
 * 并按返回类型处理结果。
 */ (resolve, reject) => {
      /**
       * 常量说明：aborted 用于处理 aborted 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       * 功能说明：处理 aborted 相关流程；使用场景由所在模块及调用位置决定。
       * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
       * @example 在完成前置校验后调用 aborted()，并按返回类型处理结果。
       */
        const aborted = (): void => { waiter.reject(signal.reason) }
        /**
       * 常量说明：cleanup 用于处理 cleanup 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       * 功能说明：处理 cleanup 相关流程；使用场景由所在模块及调用位置决定。
       * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
       * @example 在完成前置校验后调用 cleanup()，并按返回类型处理结果。
       */
        const cleanup = (): void => {
          this.waiters.delete(waiter)
          signal.removeEventListener('abort', aborted)
        }
        /**
       * 常量说明：waiter 用于处理 waiter 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
        const waiter: SocketWaiter = {
          resolve: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：socket（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(socket)，并按返回类型处理结果。
 */ (socket) => {
            cleanup()
            resolve(socket)
          },
          reject: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：error（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(error)，并按返回类型处理结果。
 */ (error) => {
            cleanup()
            // AbortSignal.reason belongs to the caller and may intentionally be a non-Error sentinel.
            // oxlint-disable-next-line typescript/prefer-promise-reject-errors
            reject(error)
          },
        }
        this.waiters.add(waiter)
        signal.addEventListener('abort', aborted, { once: true })
      })
  }

  /**
   * 功能说明：处理 receive 相关流程；使用场景由所在模块及调用位置决定。
   * @param socket （WebSocket）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param data （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 receive(socket, data)，并按返回类型处理结果。
   */
  private receive(socket: WebSocket, data: unknown): void {
    if (socket !== this.socket) return
    try {
      if (typeof data !== 'string') throw new Error('api gateway: Remote stream WebSocket requires text messages')
      /**
       * 常量说明：frame 用于处理 frame 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const frame = parseRemoteStreamServerMessage(data)
      this.streams.get(frame.streamId)?.push(frame)
    } catch (/*
 * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
 */ error) {
      /**
       * 常量说明：failure 用于处理 failure 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const failure = new RemoteStreamCarrierError('api gateway: invalid Remote stream frame', { cause: error })
      this.failAll(failure)
      this.lost(socket, failure)
      socket.close(4002, 'invalid Remote stream frame')
    }
  }

  /**
   * 功能说明：处理 lost 相关流程；使用场景由所在模块及调用位置决定。
   * @param socket （WebSocket）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param error （RemoteStreamCarrierError）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 lost(socket, error)，并按返回类型处理结果。
   */
  private lost(
    socket: WebSocket,
    error: RemoteStreamCarrierError = new RemoteStreamCarrierError(
      'api gateway: Remote stream WebSocket closed',
    ),
  ): void {
    if (this.socket !== socket) return
    this.socket = undefined
    this.failAll(error)
    this.maintain(error)
  }

  /**
   * 功能说明：处理 maintain 相关流程；使用场景由所在模块及调用位置决定。
   * @param previousFailure （Error）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 maintain(previousFailure)，并按返回类型处理结果。
   */
  private maintain(previousFailure?: Error): void {
    if (!this.running) return
    if (this.keepAlive !== undefined) {
      void this.keepAlive.then(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => { this.maintain(previousFailure) })
      return
    }
    /**
     * 常量说明：abort 用于处理 abort 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const abort = new AbortController()
    this.keepAliveAbort = abort
    /**
     * 常量说明：task 用于处理 task 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const task = this.reconnect(abort.signal, previousFailure)
    this.keepAlive = task
    void task.then(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {
        this.keepAlive = undefined
        this.keepAliveAbort = undefined
      })
  }

  /**
   * 功能说明：处理 reconnect 相关流程；使用场景由所在模块及调用位置决定。
   * @param signal （AbortSignal）：传递取消或终止信号；必须满足声明的类型及调用时序要求。
   * @param previousFailure （Error）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 reconnect(signal, previousFailure)，并按返回类型处理结果。
   */
  private async reconnect(signal: AbortSignal, previousFailure?: Error): Promise<void> {
    /**
     * 变量说明：attempt 用于处理 attempt 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let attempt = 0
    /**
     * 变量说明：failure 用于处理 failure 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let failure = previousFailure
    while (this.isRunning(signal) && this.socket?.readyState !== WebSocket.OPEN) {
      if (failure !== undefined) {
        attempt += 1
        console.warn(`[api-gateway] Remote stream connection unavailable, retry #${String(attempt)}`, failure)
        await sleep(backoffDelay(attempt), signal)
        if (!this.isRunning(signal)) return
      }
      try {
        await this.connect()
        return
      } catch (/*
 * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
 */ error) {
        if (!this.isRunning(signal)) return
        failure = error as Error
      }
    }
  }

  /**
   * 功能说明：判断是否为 Running 相关流程；使用场景由所在模块及调用位置决定。
   * @param signal （AbortSignal）：传递取消或终止信号；必须满足声明的类型及调用时序要求。
   * @returns boolean；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 isRunning(signal)，并按返回类型处理结果。
   */
  private isRunning(signal: AbortSignal): boolean {
    return this.running && !signal.aborted
  }

  /**
   * 功能说明：处理 failAll 相关流程；使用场景由所在模块及调用位置决定。
   * @param error （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 failAll(error)，并按返回类型处理结果。
   */
  private failAll(error: unknown): void {
    for (const /*
     * 变量说明：stream 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */ stream of this.streams.values()) stream.fail(error)
  }

  /**
   * 功能说明：处理 send 相关流程；使用场景由所在模块及调用位置决定。
   * @param socket （WebSocket）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param message （RemoteStreamClientMessage）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 send(socket, message)，并按返回类型处理结果。
   */
  private send(socket: WebSocket, message: RemoteStreamClientMessage): void {
    socket.send(JSON.stringify(message))
  }
}

/**
 * 功能说明：处理 backoffDelay 相关流程；使用场景由所在模块及调用位置决定。
 * @param attempt （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns number；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 backoffDelay(attempt)，并按返回类型处理结果。
 */
function backoffDelay(attempt: number): number {
  /**
   * 常量说明：cap 用于处理 cap 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const cap = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * RECONNECT_FACTOR ** Math.max(0, attempt - 1))
  return cap / 2 + Math.random() * (cap / 2)
}

/**
 * 功能说明：处理 sleep 相关流程；使用场景由所在模块及调用位置决定。
 * @param ms （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param signal （AbortSignal）：传递取消或终止信号；必须满足声明的类型及调用时序要求。
 * @returns Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 sleep(ms, signal)，并按返回类型处理结果。
 */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolve（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(resolve)，并按返回类型处理结果。
 */ (resolve) => {
    /**
     * 常量说明：timer 用于处理 timer 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
      const timer = setTimeout(done, ms)
      signal.addEventListener('abort', done, { once: true })
      /**
     * 功能说明：处理 done 相关流程；使用场景由所在模块及调用位置决定。
     * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 done()，并按返回类型处理结果。
     */
      function done(): void {
        clearTimeout(timer)
        signal.removeEventListener('abort', done)
        resolve()
      }
    })
}

/**
 * 类说明：StreamInbox 用于集中封装 处理 StreamInbox 相关状态与行为。
 * 核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。
 * 使用场景：由 api/gateway 在对应插件或业务生命周期内创建和调用。
 */
class StreamInbox {
  /**
   * 常量说明：frames 用于处理 frames 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly frames: RemoteStreamServerMessage[] = []
  /**
   * 变量说明：wake 用于处理 wake 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  private wake: (() => void) | undefined
  /**
   * 变量说明：failure 用于处理 failure 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  private failure: Error | undefined

  /**
   * 功能说明：处理 push 相关流程；使用场景由所在模块及调用位置决定。
   * @param frame （RemoteStreamServerMessage）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 push(frame)，并按返回类型处理结果。
   */
  push(frame: RemoteStreamServerMessage): void {
    if (this.failure !== undefined) return
    this.frames.push(frame)
    this.wake?.()
    this.wake = undefined
  }

  /**
   * 功能说明：处理 fail 相关流程；使用场景由所在模块及调用位置决定。
   * @param error （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 fail(error)，并按返回类型处理结果。
   */
  fail(error: unknown): void {
    if (this.failure !== undefined) return
    this.failure = error instanceof Error ? error : new Error(String(error), { cause: error })
    this.frames.length = 0
    this.wake?.()
    this.wake = undefined
  }

  /**
   * 功能说明：处理 next 相关流程；使用场景由所在模块及调用位置决定。
   * @returns Promise<RemoteStreamServerMessage>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 next()，并按返回类型处理结果。
   */
  async next(): Promise<RemoteStreamServerMessage> {
    while (this.frames.length === 0) {
      if (this.failure !== undefined) throw this.failure
      await new Promise<void>(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolve（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(resolve)，并按返回类型处理结果。
 */ (resolve) => { this.wake = resolve })
    }
    return this.frames.shift() as RemoteStreamServerMessage
  }
}

/**
 * 功能说明：处理 remoteStreamUrl 相关流程；使用场景由所在模块及调用位置决定。
 * @returns string；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 remoteStreamUrl()，并按返回类型处理结果。
 */
function remoteStreamUrl(): string {
  /**
   * 常量说明：location 用于处理 location 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const location = (globalThis as { location?: { origin?: string } }).location
  /**
   * 常量说明：base 用于处理 base 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const base = location?.origin !== undefined && location.origin !== 'null' ? location.origin : INTERNAL_BASE
  /**
   * 常量说明：url 用于处理 url 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const url = new URL(REMOTE_STREAM_MUX_PATH, base)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  return url.href
}
