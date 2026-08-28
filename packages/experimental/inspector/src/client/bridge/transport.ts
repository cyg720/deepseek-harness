/** Client observation and Runtime endpoint over the Inspector Worker's ingest WebSocket.
 * @remarks 文件说明：文件职责：实现 experimental/inspector 中 transport 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/inspector 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。 */

import type { InspectorClientBootstrap } from '../../shared/bridge/messages/control.ts'
import type {
  ClientRuntimeRequestId,
  ClientRuntimeSessionId,
  InspectorSourceGeneration,
} from '../../shared/bridge/ids.ts'
import { isJsonValue, jsonByteLength } from '../../shared/json.ts'
import {
  INSPECTOR_PROTOCOL_VERSION,
  parseWorkerSourceFrame,
  type SourceCloseFrame,
  type SourceOpenFrame,
} from '../../shared/bridge/messages/observation.ts'
import { InspectorSourceConnection } from '../../shared/bridge/publisher.ts'
import { ClientConsoleObserver } from '../cdp/console.ts'
import { ClientRuntimeExecutor } from '../cdp/runtime.ts'
import {
  ClientSourceCatalog,
  ClientSourceCatalogError,
  discoverInspectorClientSourceCatalog,
} from '../cdp/sources.ts'
import type { ClientSourceRequestFrame, ClientSourceResponseFrame } from '../../shared/bridge/messages/sources/index.ts'
import { ClientRealmSource } from '../inspection/realm.ts'
import { NETWORK_TOPICS } from '../inspection/network.ts'
import { ClientBridgeLifecycle } from './lifecycle.ts'
import { ClientBridgePublisher } from './publisher.ts'
import { ClientBridgeRpc } from './rpc.ts'
import { dispatchBridgeFrame } from './dispatcher.ts'

/** Reconnecting Client source whose bounded queue never blocks page work.
 * @remarks 中文说明：类说明：ClientInspectorSource 用于集中封装 处理 ClientInspectorSource
 * 相关状态与行为。；核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。；使用场景：由
 * experimental/inspector 在对应插件或业务生命周期内创建和调用。 */
export class ClientInspectorSource extends InspectorSourceConnection {
  /**
   * 常量说明：realmSource 用于处理 realmSource 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly realmSource: ClientRealmSource
  /**
   * 常量说明：publisher 用于处理 publisher 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  protected readonly publisher: ClientBridgePublisher
  /**
   * 变量说明：socket 用于处理 socket 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  private socket: WebSocket | undefined
  /**
   * 变量说明：generation 用于处理 generation 相关数据，作用于成员；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  private generation: InspectorSourceGeneration | undefined
  /**
   * 变量说明：accepted 用于处理 accepted 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  private accepted = false
  /**
   * 变量说明：closed 用于处理 closed 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  private closed = false
  /**
   * 常量说明：runtime 用于处理 runtime 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly runtime: ClientRuntimeExecutor
  /**
   * 常量说明：runtimeRequests 用于处理 runtimeRequests 相关数据，作用于成员；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  private readonly runtimeRequests = new Map<ClientRuntimeRequestId, {
    readonly controller: AbortController
    readonly sessionId: ClientRuntimeSessionId
  }>()
  /**
   * 常量说明：console 用于处理 console 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly console: ClientConsoleObserver
  /**
   * 常量说明：queries 用于处理 queries 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  protected readonly queries: ClientBridgeRpc
  /**
   * 常量说明：lifecycle 用于处理 lifecycle 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly lifecycle: ClientBridgeLifecycle

  /**
   * 功能说明：处理 ClientInspectorSource 相关流程；使用场景由所在模块及调用位置决定。
   * @param bootstrap （InspectorClientBootstrap）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param label （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param sourceCatalog （ClientSourceCatalog | undefined）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。
   * @param realmSource （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。
   * @returns 当前类实例；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 通过 new ClientInspectorSource(bootstrap, label, sourceCatalog,
   * realmSource) 创建实例，并在所属生命周期内使用。
   */
  constructor(
    private readonly bootstrap: InspectorClientBootstrap,
    label = document.title || 'Client',
    private readonly sourceCatalog: ClientSourceCatalog | undefined = discoverInspectorClientSourceCatalog(),
    realmSource = new ClientRealmSource(label),
  ) {
    super()
    this.realmSource = realmSource
    this.lifecycle = new ClientBridgeLifecycle(bootstrap.reconnectBaseMs, bootstrap.reconnectMaxMs)
    this.publisher = new ClientBridgePublisher({
      topics: ['*'],
      maxQueuedRecords: bootstrap.maxQueuedRecords,
      maxQueuedBytes: bootstrap.maxQueuedBytes,
      maxRecordsPerFrame: bootstrap.maxRecordsPerFrame,
      maxFrameBytes: bootstrap.maxFrameBytes,
    }, bootstrap.maxQueuedBytes)
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：url（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(url)，并按返回类型处理结果。
     */
    this.runtime = new ClientRuntimeExecutor({
      maxObjectsPerSession: bootstrap.maxRuntimeObjectsPerSession,
      maxPropertiesPerResult: bootstrap.maxRuntimePropertiesPerResult,
      maxResponseBytes: bootstrap.maxFrameBytes,
    }, url => this.sourceCatalog?.scriptKeyForUrl(url))
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：sessionId（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：event（由 TypeScript
     * 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(sessionId, event)，
     * 并按返回类型处理结果。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：url（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(url)，并按返回类型处理结果。
     */
    this.console = new ClientConsoleObserver(this.runtime, (sessionId, event) => {
      /**
       * 常量说明：socket 用于处理 socket 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const socket = this.socket
      /**
       * 常量说明：generation 用于处理 generation 相关数据，作用于当前作用域；初始化后不可重新赋值，
       * 但对象内部是否可变仍由其类型决定。
       */
      const generation = this.generation
      if (this.closed
        || !this.accepted
        || socket?.readyState !== WebSocket.OPEN
        || generation === undefined) return
      /**
       * 常量说明：frame 用于处理 frame 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const frame = {
        v: INSPECTOR_PROTOCOL_VERSION,
        t: 'client-console/event',
        sourceId: this.realmSource.sourceId,
        generation,
        sessionId,
        event,
      } as const
      if (!isJsonValue(frame) || jsonByteLength(frame) > this.bootstrap.maxFrameBytes) return
      try {
        socket.send(JSON.stringify(frame))
      } catch {
        // The socket close path resets this generation's Runtime and Console state.
      }
    }, url => this.sourceCatalog?.scriptKeyForUrl(url))
    this.queries = new ClientBridgeRpc({
      timeoutMs: bootstrap.queryTimeoutMs,
      maxFrameBytes: bootstrap.maxFrameBytes,
    })
    this.connect()
  }

  /** Permanently stop reconnecting and close the active source generation.
   * @remarks 中文说明：功能说明：关闭 close 相关流程；使用场景由所在模块及调用位置决定。；返回值：void；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 close()，并按返回类型处理结果。 */
  close(): void {
    if (this.closed) return
    this.closed = true
    this.console.close()
    this.cancelRuntimeRequests()
    this.runtime.reset()
    this.queries.close('Inspector Client source closed')
    this.lifecycle.close()
    this.publisher.close()
    /**
     * 常量说明：socket 用于处理 socket 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const socket = this.socket
    /**
     * 常量说明：generation 用于处理 generation 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const generation = this.generation
    try {
      if (socket?.readyState === WebSocket.OPEN && generation !== undefined) {
        /**
         * 常量说明：frame 用于处理 frame 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const frame: SourceCloseFrame = {
          v: INSPECTOR_PROTOCOL_VERSION,
          t: 'source/close',
          sourceId: this.realmSource.sourceId,
          generation,
        }
        socket.send(JSON.stringify(frame))
        socket.close(1000, 'Client source closed')
      } else {
        socket?.close()
      }
    } finally {
      this.socket = undefined
      this.realmSource.close()
    }
  }

  /**
   * 功能说明：处理 connect 相关流程；使用场景由所在模块及调用位置决定。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 connect()，并按返回类型处理结果。
   */
  private connect(): void {
    if (this.closed) return
    this.console.reset()
    this.cancelRuntimeRequests()
    this.runtime.reset()
    this.queries.disconnect('Inspector Client source reconnecting')
    /**
     * 常量说明：source 用于处理 source 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const source = this.realmSource.connect(this.sourceCatalog !== undefined)
    /**
     * 常量说明：generation 用于处理 generation 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const generation = source.generation
    /**
     * 常量说明：socket 用于处理 socket 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const socket = new WebSocket(this.bootstrap.endpoint, this.bootstrap.protocol)
    this.socket = socket
    this.generation = generation
    this.accepted = false
    this.publisher.connect(socket, source)
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    socket.addEventListener('open', () => {
      if (this.socket !== socket || this.closed) return
      /**
       * 常量说明：frame 用于处理 frame 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const frame: SourceOpenFrame = {
        v: INSPECTOR_PROTOCOL_VERSION,
        t: 'source/open',
        source,
        topics: ['*', ...NETWORK_TOPICS],
      }
      socket.send(JSON.stringify(frame))
    })
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：event（由 TypeScript
     * 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(event)，并按返回类型处理结果。
     */
    socket.addEventListener('message', (event) => {
      if (this.socket !== socket || typeof event.data !== 'string') return
      /**
       * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
       */
      try {
        if (new TextEncoder().encode(event.data).byteLength > this.bootstrap.maxFrameBytes) {
          throw new Error(`inspector protocol: Worker frame exceeds ${String(this.bootstrap.maxFrameBytes)} bytes`)
        }
        /**
         * 常量说明：value 用于处理 value 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const value = JSON.parse(event.data) as unknown
        if (this.queries.receive(value)) return
        /**
         * 常量说明：frame 用于处理 frame 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const frame = parseWorkerSourceFrame(value)
        if (frame.t !== 'source/rejected'
          && (frame.sourceId !== this.realmSource.sourceId || frame.generation !== generation)) return
        /**
         * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
         * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
         */
        /**
         * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
         * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
         */
        /**
         * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
         * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
         */
        /**
         * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：rejected（由 TypeScript
         * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
         * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(rejected)，并按返回类型处理结果。
         */
        /**
         * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：request（由 TypeScript
         * 根据调用位置推断的类型）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
         * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(request)，并按返回类型处理结果。
         */
        /**
         * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：canceled（由 TypeScript
         * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
         * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(canceled)，并按返回类型处理结果。
         */
        /**
         * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：acknowledged（由 TypeScript
         * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
         * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(acknowledged)，并按返回类型处理结果。
         */
        /**
         * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：closed（由 TypeScript
         * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
         * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(closed)，并按返回类型处理结果。
         */
        /**
         * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：enabled（由 TypeScript
         * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
         * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(enabled)，并按返回类型处理结果。
         */
        /**
         * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：disabled（由 TypeScript
         * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
         * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(disabled)，并按返回类型处理结果。
         */
        /**
         * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：request（由 TypeScript
         * 根据调用位置推断的类型）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
         * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(request)，并按返回类型处理结果。
         */
        /**
         * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
         * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
         */
        dispatchBridgeFrame(frame, {
          accepted: () => {
            this.accepted = true
            this.lifecycle.connected()
            this.queries.connectSocket(source, socket)
            this.publisher.accept(socket)
          },
          acknowledged: () => {},
          resnapshot: () => { this.publisher.replace(socket) },
          rejected: (rejected) => {
            console.error(`[inspector] Client source rejected: ${rejected.message}`)
            socket.close(1008, 'source rejected')
          },
          runtime: (request) => {
            /**
             * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：error（unknown）：提供本次调用所需的数据；
             * 必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；
             * 典型用法：在完成前置校验后调用 匿名回调(error)，并按返回类型处理结果。
             */
            void this.executeRuntime(socket, generation, request).catch((error: unknown) => {
              console.error('[inspector] Client Runtime transport failed:', error)
              socket.close(1011, 'Client Runtime transport failed')
            })
          },
          runtimeCanceled: (canceled) => { this.cancelRuntime(canceled.sessionId, canceled.requestId) },
          runtimeAcknowledged: (acknowledged) => {
            this.acknowledgeRuntime(acknowledged.sessionId, acknowledged.requestId)
          },
          runtimeClosed: (closed) => {
            this.cancelRuntimeSession(closed.sessionId)
            this.console.disable(closed.sessionId)
            this.runtime.closeSession(closed.sessionId)
          },
          consoleEnabled: (enabled) => { this.console.enable(enabled.sessionId) },
          consoleDisabled: (disabled) => { this.console.disable(disabled.sessionId) },
          sources: (request) => {
            /**
             * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：error（unknown）：提供本次调用所需的数据；
             * 必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；
             * 典型用法：在完成前置校验后调用 匿名回调(error)，并按返回类型处理结果。
             */
            void this.executeSourceRequest(socket, generation, request).catch((error: unknown) => {
              console.error('[inspector] Client Sources transport failed:', error)
              socket.close(1011, 'Client Sources transport failed')
            })
          },
          sourcesClosed: () => {},
        })
      } catch (error) {
        console.error('[inspector] invalid Worker control frame:', error)
        socket.close(1008, 'invalid Worker control frame')
      }
    })
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    socket.addEventListener('close', () => {
      if (this.socket !== socket || this.closed) return
      this.socket = undefined
      this.accepted = false
      this.publisher.disconnect(socket)
      this.console.reset()
      this.cancelRuntimeRequests()
      this.runtime.reset()
      this.queries.disconnect('Inspector Client source disconnected')
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
       */
      this.lifecycle.reconnect(() => { this.connect() })
    })
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    socket.addEventListener('error', () => {
      // `close` owns reconnection and keeps one timer.
    })
  }

  /**
   * 功能说明：执行 Runtime 相关流程；使用场景由所在模块及调用位置决定。
   * @param socket （WebSocket）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param generation （InspectorSourceGeneration）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。
   * @param frame （Extract<ReturnType<typeof parseWorkerSourceFrame>, { t:
   * 'cl…）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 executeRuntime(socket, generation, frame)，并按返回类型处理结果。
   */
  private async executeRuntime(
    socket: WebSocket,
    generation: InspectorSourceGeneration,
    frame: Extract<ReturnType<typeof parseWorkerSourceFrame>, { t: 'client-runtime/request' }>,
  ): Promise<void> {
    /**
     * 常量说明：controller 用于处理 controller 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const controller = new AbortController()
    /**
     * 常量说明：operation 用于处理 operation 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const operation = { controller, sessionId: frame.sessionId }
    this.runtimeRequests.set(frame.requestId, operation)
    /**
     * 常量说明：response 用于处理 response 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const response = await this.runtime.execute(frame, controller.signal, true)
    if (this.runtimeRequests.get(frame.requestId) !== operation) return
    if (this.closed || this.socket !== socket || this.generation !== generation || socket.readyState !== WebSocket.OPEN) {
      this.cancelRuntime(frame.sessionId, frame.requestId)
      return
    }
    socket.send(JSON.stringify(response))
  }

  /**
   * 功能说明：处理 acknowledgeRuntime 相关流程；使用场景由所在模块及调用位置决定。
   * @param sessionId （ClientRuntimeSessionId）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param requestId （ClientRuntimeRequestId）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 acknowledgeRuntime(sessionId, requestId)，并按返回类型处理结果。
   */
  private acknowledgeRuntime(sessionId: ClientRuntimeSessionId, requestId: ClientRuntimeRequestId): void {
    /**
     * 常量说明：operation 用于处理 operation 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const operation = this.runtimeRequests.get(requestId)
    if (operation === undefined || operation.sessionId !== sessionId) return
    this.runtimeRequests.delete(requestId)
    this.runtime.acknowledge(sessionId, requestId)
  }

  /**
   * 功能说明：处理 cancelRuntime 相关流程；使用场景由所在模块及调用位置决定。
   * @param sessionId （ClientRuntimeSessionId）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param requestId （ClientRuntimeRequestId）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 cancelRuntime(sessionId, requestId)，并按返回类型处理结果。
   */
  private cancelRuntime(sessionId: ClientRuntimeSessionId, requestId: ClientRuntimeRequestId): void {
    /**
     * 常量说明：operation 用于处理 operation 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const operation = this.runtimeRequests.get(requestId)
    if (operation === undefined || operation.sessionId !== sessionId) return
    this.runtimeRequests.delete(requestId)
    operation.controller.abort()
    this.runtime.cancel(sessionId, requestId)
  }

  /**
   * 功能说明：处理 cancelRuntimeSession 相关流程；使用场景由所在模块及调用位置决定。
   * @param sessionId （ClientRuntimeSessionId）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 cancelRuntimeSession(sessionId)，并按返回类型处理结果。
   */
  private cancelRuntimeSession(sessionId: ClientRuntimeSessionId): void {
    /**
     * 变量说明：requestId、operation 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const [requestId, operation] of this.runtimeRequests) {
      if (operation.sessionId !== sessionId) continue
      operation.controller.abort()
      this.runtime.cancel(sessionId, requestId)
      this.runtimeRequests.delete(requestId)
    }
  }

  /**
   * 功能说明：处理 cancelRuntimeRequests 相关流程；使用场景由所在模块及调用位置决定。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 cancelRuntimeRequests()，并按返回类型处理结果。
   */
  private cancelRuntimeRequests(): void {
    /**
     * 变量说明：requestId、operation 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const [requestId, operation] of this.runtimeRequests) {
      operation.controller.abort()
      this.runtime.cancel(operation.sessionId, requestId)
    }
    this.runtimeRequests.clear()
  }

  /**
   * 功能说明：执行 Source Request 相关流程；使用场景由所在模块及调用位置决定。
   * @param socket （WebSocket）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param generation （InspectorSourceGeneration）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。
   * @param frame （ClientSourceRequestFrame）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 executeSourceRequest(socket, generation, frame)，
   * 并按返回类型处理结果。
   */
  private async executeSourceRequest(
    socket: WebSocket,
    generation: InspectorSourceGeneration,
    frame: ClientSourceRequestFrame,
  ): Promise<void> {
    /**
     * 变量说明：outcome 用于处理 outcome 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let outcome: ClientSourceResponseFrame['outcome']
    /**
     * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
     */
    try {
      if (this.sourceCatalog === undefined) {
        throw new ClientSourceCatalogError('invalid-request', 'Client source catalog is unavailable')
      }
      outcome = { ok: true, result: await this.sourceCatalog.execute(frame.command, this.bootstrap.maxClientSourceBytes) }
    } catch (error) {
      outcome = {
        ok: false,
        error: {
          code: error instanceof ClientSourceCatalogError ? error.code : 'internal-error',
          message: renderError(error).slice(0, 2_048),
        },
      }
    }
    /**
     * 变量说明：response 用于处理 response 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let response: ClientSourceResponseFrame = {
      v: INSPECTOR_PROTOCOL_VERSION,
      t: 'client-sources/response',
      sourceId: this.realmSource.sourceId,
      generation,
      sessionId: frame.sessionId,
      requestId: frame.requestId,
      outcome,
    }
    if (!isJsonValue(response) || jsonByteLength(response) > this.bootstrap.maxFrameBytes) {
      response = {
        ...response,
        outcome: {
          ok: false,
          error: { code: 'result-too-large', message: 'Client source result exceeds the source-frame byte limit' },
        },
      }
    }
    if (this.closed || this.socket !== socket || this.generation !== generation || socket.readyState !== WebSocket.OPEN) return
    socket.send(JSON.stringify(response))
  }

}

/**
 * 功能说明：渲染 Error 相关流程；使用场景由所在模块及调用位置决定。
 * @param error （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns string；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 renderError(error)，并按返回类型处理结果。
 */
function renderError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
