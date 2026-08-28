/** Host WebSocket owner for multiplexed Typert Remote streams.
 * @remarks 文件说明：文件职责：实现 api/gateway 中 stream server 模块的职责，并向相邻模块提供可复用能力。；
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的 api/gateway 能力，
 * 使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。；
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。 */

import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import WebSocket, { WebSocketServer, type RawData } from 'ws'
import {
  parseRemoteStreamClientMessage,
  type RemoteStreamFailure,
  type RemoteStreamServerMessage,
} from './stream-protocol.ts'

/** Open one validated Remote stream for a decoded wire request. */
export type RemoteStreamOpener = (
  endpoint: string,
  payload: unknown,
  signal: AbortSignal,
) => Promise<AsyncIterable<unknown>>

/** Convert an invocation or carrier failure to a stable wire value. */
export type RemoteStreamFailureMapper = (error: unknown) => RemoteStreamFailure

/** Own the no-server WebSocket acceptor and every active logical stream.
 * @remarks 中文说明：类说明：RemoteStreamMuxServer 用于集中封装 处理 RemoteStreamMuxServer
 * 相关状态与行为。；核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。；使用场景：由 api/gateway
 * 在对应插件或业务生命周期内创建和调用。 */
export class RemoteStreamMuxServer {
  /**
   * 常量说明：server 用于处理 server 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly server = new WebSocketServer({ noServer: true })
  /**
   * 常量说明：connections 用于处理 connections 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly connections = new Set<Promise<void>>()
  /**
   * 变量说明：heartbeatTimer 用于处理 heartbeatTimer 相关数据，作用于成员；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  private heartbeatTimer: NodeJS.Timeout | undefined

  /**
   * @param open - Gateway stream dispatcher.
   * @param failure - Gateway error-to-wire mapper.
   * @param heartbeatIntervalMs - interval between WebSocket Ping control frames.
   * @remarks 中文说明：功能说明：处理 RemoteStreamMuxServer 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：open（RemoteStreamOpener）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：failure（RemoteStreamFailureMapper）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：heartbeatIntervalMs（number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：当前类实例；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：通过 new RemoteStreamMuxServer(open,
   * failure, heartbeatIntervalMs) 创建实例，并在所属生命周期内使用。
   */
  constructor(
    private readonly open: RemoteStreamOpener,
    private readonly failure: RemoteStreamFailureMapper,
    private readonly heartbeatIntervalMs: number,
  ) {}

  /**
   * Upgrade one trusted request and begin serving its logical streams.
   * @param req - authenticated HTTP upgrade request.
   * @param socket - carrier socket transferred to the WebSocket server.
   * @param head - bytes already read after the HTTP upgrade headers.
   * @remarks 中文说明：功能说明：处理 Upgrade 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：req（IncomingMessage）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：socket（Duplex）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：head（Buffer）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 handleUpgrade(req, socket, head)，
   * 并按返回类型处理结果。
   */
  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    this.server.handleUpgrade(req, socket, head, /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：websocket（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(websocket)，并按返回类型处理结果。
 */ (websocket) => {
        this.startHeartbeat()
        /**
       * 常量说明：connection 用于处理 connection 相关数据，作用于当前作用域；初始化后不可重新赋值，
       * 但对象内部是否可变仍由其类型决定。
       */
        const connection = new RemoteStreamMuxConnection(websocket, this.open, this.failure)
        /**
       * 常量说明：done 用于处理 done 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
        const done = connection.run()
        this.connections.add(done)
        void done.then(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => { this.connections.delete(done) })
      })
  }

  /** Terminate all sockets and wait until every iterator has returned.
   * @remarks 中文说明：功能说明：关闭 close 相关流程；使用场景由所在模块及调用位置决定。；返回值：Promise<void>；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 close()，并按返回类型处理结果。 */
  async close(): Promise<void> {
    clearInterval(this.heartbeatTimer)
    this.heartbeatTimer = undefined
    for (const /*
     * 变量说明：socket 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */ socket of this.server.clients) socket.terminate()
    /**
     * 常量说明：closed 用于处理 closed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const closed = Promise.withResolvers<void>()
    this.server.close(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：error（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(error)，并按返回类型处理结果。
 */ (error) => {
        if (error === undefined) closed.resolve()
        else closed.reject(error)
      })
    await closed.promise
    await Promise.all(this.connections)
  }

  /** Start one `unref()` timer after the first upgrade; it spans empty-client periods until close().
   * @remarks 中文说明：功能说明：启动 Heartbeat 相关流程；使用场景由所在模块及调用位置决定。；返回值：void；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 startHeartbeat()，
   * 并按返回类型处理结果。 */
  private startHeartbeat(): void {
    if (this.heartbeatTimer !== undefined) return
    this.heartbeatTimer = setInterval(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {
        for (const /*
       * 变量说明：socket 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
       */ socket of this.server.clients) {
          if (socket.readyState === WebSocket.OPEN) socket.ping()
        }
      }, this.heartbeatIntervalMs)
    this.heartbeatTimer.unref()
  }
}

interface ActiveStream {
  readonly abort: AbortController
  done: Promise<void>
}

/**
 * 类说明：RemoteStreamMuxConnection 用于集中封装 处理 RemoteStreamMuxConnection
 * 相关状态与行为。
 * 核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。
 * 使用场景：由 api/gateway 在对应插件或业务生命周期内创建和调用。
 */
class RemoteStreamMuxConnection {
  /**
   * 常量说明：streams 用于处理 streams 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly streams = new Map<string, ActiveStream>()
  /**
   * 变量说明：writes 用于处理 writes 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  private writes = Promise.resolve()

  /**
   * 功能说明：处理 RemoteStreamMuxConnection 相关流程；使用场景由所在模块及调用位置决定。
   * @param socket （WebSocket）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param open （RemoteStreamOpener）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param failure （RemoteStreamFailureMapper）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns 当前类实例；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 通过 new RemoteStreamMuxConnection(socket, open, failure) 创建实例，
   * 并在所属生命周期内使用。
   */
  constructor(
    private readonly socket: WebSocket,
    private readonly open: RemoteStreamOpener,
    private readonly failure: RemoteStreamFailureMapper,
  ) {}

  /**
   * 功能说明：执行 run 相关流程；使用场景由所在模块及调用位置决定。
   * @returns Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 run()，并按返回类型处理结果。
   */
  async run(): Promise<void> {
    /**
     * 常量说明：closed 用于处理 closed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const closed = new Promise<void>(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolve（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(resolve)，并按返回类型处理结果。
 */ (resolve) => {
        this.socket.once('close', resolve)
        this.socket.once('error', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => { this.socket.terminate() })
        this.socket.on('message', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：data（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：isBinary（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(data, isBinary)，
 * 并按返回类型处理结果。
 */ (data, isBinary) => {
            if (isBinary) {
              this.socket.close(1003, 'text messages required')
              return
            }
            try {
              this.receive(rawText(data))
            } catch {
              this.socket.close(1008, 'invalid Remote stream request')
            }
          })
      })
    await closed
    /**
     * 常量说明：active 用于处理 active 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const active = [...this.streams.values()]
    for (const /*
     * 变量说明：stream 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */ stream of active) stream.abort.abort(new Error('Remote stream socket closed'))
    await Promise.all(active.map(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：stream（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(stream)，并按返回类型处理结果。
 */ stream => stream.done))
  }

  /**
   * 功能说明：处理 receive 相关流程；使用场景由所在模块及调用位置决定。
   * @param text （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 receive(text)，并按返回类型处理结果。
   */
  private receive(text: string): void {
    /**
     * 常量说明：message 用于处理 message 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const message = parseRemoteStreamClientMessage(text)
    if (message.type === 'cancel') {
      this.streams.get(message.streamId)?.abort.abort(new Error('Remote stream cancelled'))
      return
    }
    if (this.streams.has(message.streamId)) {
      throw new Error(`api gateway: duplicate Remote stream id ${JSON.stringify(message.streamId)}`)
    }
    /**
     * 常量说明：abort 用于处理 abort 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const abort = new AbortController()
    /**
     * 常量说明：active 用于处理 active 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const active: ActiveStream = {
      abort,
      done: Promise.resolve(),
    }
    this.streams.set(message.streamId, active)
    /**
     * 常量说明：done 用于处理 done 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const done = this.pump(message.streamId, message.endpoint, message.payload, active)
    active.done = done
    /**
     * 常量说明：remove 用于移除 remove 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     * 功能说明：移除 remove 相关流程；使用场景由所在模块及调用位置决定。
     * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 remove()，并按返回类型处理结果。
     */
    const remove = (): void => { this.streams.delete(message.streamId) }
    void done.then(remove, remove)
  }

  /**
   * 功能说明：处理 pump 相关流程；使用场景由所在模块及调用位置决定。
   * @param streamId （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param endpoint （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param payload （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param active （ActiveStream）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 pump(streamId, endpoint, payload, active)，并按返回类型处理结果。
   */
  private async pump(
    streamId: string,
    endpoint: string,
    payload: unknown,
    active: ActiveStream,
  ): Promise<void> {
    try {
      /**
       * 常量说明：source 用于处理 source 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const source = await this.open(endpoint, payload, active.abort.signal)
      for await (const /*
       * 变量说明：value 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
       */ value of source) {
        await this.send({ type: 'item', streamId, value })
      }
      if (!active.abort.signal.aborted) await this.send({ type: 'end', streamId })
    } catch (/*
 * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
 */ error) {
      if (!active.abort.signal.aborted && this.socket.readyState === WebSocket.OPEN) {
        try {
          await this.send({ type: 'error', streamId, error: this.failure(error) })
        } catch {
          // A terminal frame that cannot be encoded or written leaves the
          // logical stream ambiguous, so fail the physical generation.
          this.socket.close(1011, 'Remote stream failure could not be delivered')
        }
      }
    }
  }

  /**
   * 功能说明：处理 send 相关流程；使用场景由所在模块及调用位置决定。
   * @param message （RemoteStreamServerMessage）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 send(message)，并按返回类型处理结果。
   */
  private send(message: RemoteStreamServerMessage): Promise<void> {
    /**
     * 变量说明：text 用于处理 text 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let text: string
    try {
      text = JSON.stringify(message)
    } catch (/*
 * 变量说明：cause 保存当前捕获的异常；使用前应按项目约定缩小其类型。
 */ cause) {
      return Promise.reject(new Error('api gateway: Remote stream item is not JSON serializable', { cause }))
    }
    /**
     * 常量说明：delivery 用于处理 delivery 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const delivery = this.writes.then(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => new Promise<void>(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolve（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：reject（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(resolve, reject)，
 * 并按返回类型处理结果。
 */ (resolve, reject) => {
          if (this.socket.readyState !== WebSocket.OPEN) {
            reject(new Error('api gateway: Remote stream socket is closed'))
            return
          }
          this.socket.send(text, /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：error（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(error)，并按返回类型处理结果。
 */ (error) => {
              if (error) reject(error)
              else resolve()
            })
        }))
    this.writes = delivery.catch(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => undefined)
    return delivery
  }
}

/**
 * 功能说明：处理 rawText 相关流程；使用场景由所在模块及调用位置决定。
 * @param data （RawData）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns string；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 rawText(data)，并按返回类型处理结果。
 */
function rawText(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8')
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8')
  return Buffer.from(data).toString('utf8')
}

/**
 * Reject an upgrade without transferring socket ownership to ws.
 * @param socket - carrier socket that receives the HTTP rejection.
 * @param status - authentication or browser-trust rejection status.
 * @remarks 中文说明：功能说明：处理 rejectRemoteStreamUpgrade 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：socket（Duplex）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数说明：status（401 |
 * 403）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 rejectRemoteStreamUpgrade(socket, status)，
 * 并按返回类型处理结果。
 */
export function rejectRemoteStreamUpgrade(socket: Duplex, status: 401 | 403): void {
  /**
   * 常量说明：reason 用于处理 reason 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const reason = status === 401 ? 'Unauthorized' : 'Forbidden'
  /**
   * 常量说明：body 用于处理 body 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const body = reason.toLowerCase()
  socket.end([
    `HTTP/1.1 ${String(status)} ${reason}`,
    'Connection: close',
    'Content-Type: text/plain; charset=utf-8',
    `Content-Length: ${String(Buffer.byteLength(body))}`,
    '',
    body,
  ].join('\r\n'))
}
