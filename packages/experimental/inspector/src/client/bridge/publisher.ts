/** Buffered Client observation publication across reconnecting WebSockets.
 * @remarks 文件说明：文件职责：实现 experimental/inspector 中 publisher 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/inspector 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。 */

import { InspectorSourceBuffer, type InspectorSourceBufferOptions } from '../../shared/bridge/buffer.ts'
import type { InspectorJsonValue } from '../../shared/json.ts'
import type { InspectorStatePublisher } from '../../shared/bridge/publisher.ts'
import type { InspectorSourceDescriptor } from '../../shared/bridge/messages/observation.ts'

interface ActivePublication {
  readonly socket: WebSocket
  readonly source: InspectorSourceDescriptor
  accepted: boolean
}

/** Non-blocking Client publisher whose bounded state survives transport reconnects.
 * @remarks 中文说明：类说明：ClientBridgePublisher 用于集中封装 处理 ClientBridgePublisher
 * 相关状态与行为。；核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。；使用场景：由
 * experimental/inspector 在对应插件或业务生命周期内创建和调用。 */
export class ClientBridgePublisher implements InspectorStatePublisher {
  /**
   * 常量说明：records 用于处理 records 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly records: InspectorSourceBuffer
  /**
   * 变量说明：active 用于处理 active 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  private active: ActivePublication | undefined
  /**
   * 变量说明：flushTimer 用于处理 flushTimer 相关数据，作用于成员；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  private flushTimer: ReturnType<typeof setTimeout> | undefined
  /**
   * 变量说明：closed 用于处理 closed 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  private closed = false

  /**
   * 功能说明：处理 ClientBridgePublisher 相关流程；使用场景由所在模块及调用位置决定。
   * @param options （InspectorSourceBufferOptions）：提供本次操作使用的配置选项；
   * 必须满足声明的类型及调用时序要求。
   * @param maxBufferedBytes （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns 当前类实例；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 通过 new ClientBridgePublisher(options, maxBufferedBytes) 创建实例，
   * 并在所属生命周期内使用。
   */
  constructor(
    options: InspectorSourceBufferOptions,
    private readonly maxBufferedBytes: number,
  ) {
    this.records = new InspectorSourceBuffer(options)
  }

  /**
   * 功能说明：处理 publish 相关流程；使用场景由所在模块及调用位置决定。
   * @param topic （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param payload （InspectorJsonValue）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param monotonicMs （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 publish(topic, payload, monotonicMs)，并按返回类型处理结果。
   */
  publish(topic: string, payload: InspectorJsonValue, monotonicMs = performance.now()): void {
    if (this.closed) return
    this.records.publish(topic, payload, monotonicMs)
    this.flush()
  }

  /**
   * 功能说明：设置 State 相关流程；使用场景由所在模块及调用位置决定。
   * @param topic （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param payload （InspectorJsonValue）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param monotonicMs （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 setState(topic, payload, monotonicMs)，并按返回类型处理结果。
   */
  setState(topic: string, payload: InspectorJsonValue, monotonicMs = performance.now()): void {
    if (this.closed) throw new Error('inspector: Client source is closed')
    this.records.setState(topic, payload, monotonicMs)
    this.flush()
  }

  /**
   * Install one unopened transport generation.
   * @param socket - WebSocket carrying the generation.
   * @param source - Source identity and generation sent by the socket.
   * @remarks 中文说明：功能说明：处理 connect 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：socket（WebSocket）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：source（InspectorSourceDescriptor）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：void；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 connect(socket,
   * source)，并按返回类型处理结果。
   */
  connect(socket: WebSocket, source: InspectorSourceDescriptor): void {
    this.active = { socket, source, accepted: false }
  }

  /**
   * Send retained state and queued observations after Worker acceptance.
   * @param socket - Accepted active WebSocket.
   * @remarks 中文说明：功能说明：处理 accept 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：socket（WebSocket）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 accept(socket)，并按返回类型处理结果。
   */
  accept(socket: WebSocket): void {
    /**
     * 常量说明：active 用于处理 active 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const active = this.active
    if (active?.socket !== socket) return
    active.accepted = true
    this.replace(socket)
    this.flush()
  }

  /**
   * Resend retained state for the active generation.
   * @param socket - WebSocket that received the resnapshot request.
   * @remarks 中文说明：功能说明：处理 replace 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：socket（WebSocket）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 replace(socket)，
   * 并按返回类型处理结果。
   */
  replace(socket: WebSocket): void {
    /**
     * 常量说明：active 用于处理 active 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const active = this.active
    if (active?.socket !== socket || socket.readyState !== WebSocket.OPEN) return
    socket.send(JSON.stringify(this.records.replacement(active.source.sourceId, active.source.generation)))
  }

  /**
   * Forget one closed transport while retaining buffered state for reconnect.
   * @param socket - WebSocket whose close event fired.
   * @remarks 中文说明：功能说明：处理 disconnect 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：socket（WebSocket）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 disconnect(socket)，
   * 并按返回类型处理结果。
   */
  disconnect(socket: WebSocket): void {
    if (this.active?.socket === socket) this.active = undefined
  }

  /** Stop delayed writes and reject later publication.
   * @remarks 中文说明：功能说明：关闭 close 相关流程；使用场景由所在模块及调用位置决定。；返回值：void；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 close()，并按返回类型处理结果。 */
  close(): void {
    if (this.closed) return
    this.closed = true
    this.active = undefined
    if (this.flushTimer !== undefined) clearTimeout(this.flushTimer)
    this.flushTimer = undefined
  }

  /**
   * 功能说明：处理 flush 相关流程；使用场景由所在模块及调用位置决定。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 flush()，并按返回类型处理结果。
   */
  private flush(): void {
    /**
     * 常量说明：active 用于处理 active 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const active = this.active
    if (!active?.accepted || active.socket.readyState !== WebSocket.OPEN) return
    if (active.socket.bufferedAmount > this.maxBufferedBytes) {
      this.scheduleFlush()
      return
    }
    while (this.records.hasPending && active.socket.bufferedAmount <= this.maxBufferedBytes) {
      /**
       * 常量说明：frame 用于处理 frame 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const frame = this.records.takeBatch(active.source.sourceId, active.source.generation)
      if (frame === undefined) break
      active.socket.send(JSON.stringify(frame))
    }
    if (this.records.hasPending) this.scheduleFlush()
  }

  /**
   * 功能说明：处理 scheduleFlush 相关流程；使用场景由所在模块及调用位置决定。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 scheduleFlush()，并按返回类型处理结果。
   */
  private scheduleFlush(): void {
    if (this.flushTimer !== undefined || this.closed) return
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    this.flushTimer = setTimeout(() => {
      this.flushTimer = undefined
      this.flush()
    }, 25)
  }
}
