/** Buffered Host observation publication over a dedicated Worker MessagePort.
 * @remarks 文件说明：文件职责：实现 experimental/inspector 中 publisher 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/inspector 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。 */

import type { MessagePort } from 'node:worker_threads'
import { InspectorSourceBuffer, type InspectorSourceBufferOptions } from '../../shared/bridge/buffer.ts'
import type { InspectorJsonValue } from '../../shared/json.ts'
import type { InspectorStatePublisher } from '../../shared/bridge/publisher.ts'
import type { InspectorSourceDescriptor } from '../../shared/bridge/messages/observation.ts'

/** Non-blocking Host publisher with microtask-coalesced MessagePort writes.
 * @remarks 中文说明：类说明：HostBridgePublisher 用于集中封装 处理 HostBridgePublisher
 * 相关状态与行为。；核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。；使用场景：由
 * experimental/inspector 在对应插件或业务生命周期内创建和调用。 */
export class HostBridgePublisher implements InspectorStatePublisher {
  /**
   * 常量说明：records 用于处理 records 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly records: InspectorSourceBuffer
  /**
   * 变量说明：flushScheduled 用于处理 flushScheduled 相关数据，作用于成员；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  private flushScheduled = false
  /**
   * 变量说明：inFlightNextSequence 用于处理 inFlightNextSequence 相关数据，作用于成员；
   * 其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  private inFlightNextSequence: number | undefined
  /**
   * 变量说明：closed 用于处理 closed 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  private closed = false

  /**
   * 功能说明：处理 HostBridgePublisher 相关流程；使用场景由所在模块及调用位置决定。
   * @param port （MessagePort）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param source （InspectorSourceDescriptor）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param options （InspectorSourceBufferOptions）：提供本次操作使用的配置选项；
   * 必须满足声明的类型及调用时序要求。
   * @returns 当前类实例；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 通过 new HostBridgePublisher(port, source, options) 创建实例，
   * 并在所属生命周期内使用。
   */
  constructor(
    private readonly port: MessagePort,
    private readonly source: InspectorSourceDescriptor,
    options: InspectorSourceBufferOptions,
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
    this.scheduleFlush()
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
    if (this.closed) throw new Error('inspector: Host source is closed')
    this.records.setState(topic, payload, monotonicMs)
    this.scheduleFlush()
  }

  /** Send the retained state as a complete source replacement.
   * @remarks 中文说明：功能说明：处理 replace 相关流程；使用场景由所在模块及调用位置决定。；返回值：void；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 replace()，并按返回类型处理结果。 */
  replace(): void {
    this.inFlightNextSequence = undefined
    this.port.postMessage(this.records.replacement(this.source.sourceId, this.source.generation))
    this.scheduleFlush()
  }

  /** Send one queued batch when no earlier MessagePort batch awaits acknowledgement.
   * @remarks 中文说明：功能说明：处理 flush 相关流程；使用场景由所在模块及调用位置决定。；返回值：void；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 flush()，并按返回类型处理结果。 */
  flush(): void {
    if (this.closed || this.inFlightNextSequence !== undefined) return
    /**
     * 常量说明：frame 用于处理 frame 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const frame = this.records.takeBatch(this.source.sourceId, this.source.generation)
    if (frame === undefined) return
    this.port.postMessage(frame)
    this.inFlightNextSequence = frame.firstSequence + frame.records.length
  }

  /**
   * Release one in-flight batch and schedule the next bounded transfer.
   * @param nextSequence - First sequence expected by the Worker after the accepted batch.
   * @remarks 中文说明：功能说明：处理 acknowledge 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：nextSequence（number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 acknowledge(nextSequence)，
   * 并按返回类型处理结果。
   */
  acknowledge(nextSequence: number): void {
    if (this.closed || this.inFlightNextSequence === undefined) return
    if (nextSequence !== this.inFlightNextSequence) {
      throw new Error('inspector: Host source acknowledgement does not match the in-flight batch')
    }
    this.inFlightNextSequence = undefined
    this.scheduleFlush()
  }

  /** Send at most one final batch, discard later queued observations, and reject publication.
   * @remarks 中文说明：功能说明：关闭 close 相关流程；使用场景由所在模块及调用位置决定。；返回值：void；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 close()，并按返回类型处理结果。 */
  close(): void {
    if (this.closed) return
    this.flush()
    this.closed = true
    this.records.discardPending()
  }

  /**
   * 功能说明：处理 scheduleFlush 相关流程；使用场景由所在模块及调用位置决定。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 scheduleFlush()，并按返回类型处理结果。
   */
  private scheduleFlush(): void {
    if (!this.records.hasPending || this.flushScheduled) return
    this.flushScheduled = true
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    queueMicrotask(() => {
      this.flushScheduled = false
      this.flush()
    })
  }
}
