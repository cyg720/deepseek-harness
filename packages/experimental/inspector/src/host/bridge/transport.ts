/** Host-realm observation publisher over a dedicated MessagePort.
 * @remarks 文件说明：文件职责：实现 experimental/inspector 中 transport 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/inspector 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。 */

import type { MessagePort } from 'node:worker_threads'
import {
  INSPECTOR_PROTOCOL_VERSION,
  parseWorkerSourceFrame,
  type SourceCloseFrame,
  type SourceOpenFrame,
  type WorkerToSourceFrame,
} from '../../shared/bridge/messages/observation.ts'
import { InspectorSourceConnection } from '../../shared/bridge/publisher.ts'
import { createHostRealmSource } from '../inspection/realm.ts'
import { HostBridgePublisher } from './publisher.ts'
import { HostBridgeRpc } from './rpc.ts'
import { dispatchBridgeFrame } from './dispatcher.ts'

/** Buffer limits for one source publisher. */
export interface HostSourceOptions {
  readonly label: string
  readonly topics: readonly string[]
  readonly maxQueuedRecords: number
  readonly maxQueuedBytes: number
  readonly maxRecordsPerFrame: number
  readonly maxFrameBytes: number
  readonly queryTimeoutMs: number
}

/** Non-blocking Host source; queue overflow is represented by `droppedBefore` on the next batch.
 * @remarks 中文说明：类说明：HostInspectorSource 用于集中封装 处理 HostInspectorSource
 * 相关状态与行为。；核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。；使用场景：由
 * experimental/inspector 在对应插件或业务生命周期内创建和调用。 */
export class HostInspectorSource extends InspectorSourceConnection {
  /**
   * 常量说明：source 用于处理 source 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly source
  /**
   * 常量说明：publisher 用于处理 publisher 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  protected readonly publisher: HostBridgePublisher
  /**
   * 变量说明：closed 用于处理 closed 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  private closed = false
  /**
   * 常量说明：queries 用于处理 queries 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  protected readonly queries: HostBridgeRpc

  /**
   * 功能说明：处理 HostInspectorSource 相关流程；使用场景由所在模块及调用位置决定。
   * @param port （MessagePort）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param options （HostSourceOptions）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。
   * @returns 当前类实例；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 通过 new HostInspectorSource(port, options) 创建实例，并在所属生命周期内使用。
   */
  constructor(private readonly port: MessagePort, options: HostSourceOptions) {
    super()
    this.source = createHostRealmSource(options.label)
    this.publisher = new HostBridgePublisher(port, this.source, options)
    this.queries = new HostBridgeRpc(port, {
      timeoutMs: options.queryTimeoutMs,
      maxFrameBytes: options.maxFrameBytes,
    })
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：value（unknown）：提供本次调用所需的数据；
     * 必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；
     * 典型用法：在完成前置校验后调用 匿名回调(value)，并按返回类型处理结果。
     */
    port.on('message', (value: unknown) => {
      try {
        if (this.queries.receive(value)) return
        this.receive(parseWorkerSourceFrame(value))
      } catch {
        this.close()
      }
    })
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    port.on('close', () => { this.queries.disconnect('Inspector Host source disconnected') })
    port.start()
    /**
     * 常量说明：open 用于打开 open 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const open: SourceOpenFrame = {
      v: INSPECTOR_PROTOCOL_VERSION,
      t: 'source/open',
      source: this.source,
      topics: [...options.topics],
    }
    port.postMessage(open)
    this.publisher.replace()
  }

  /** Flush pending observations and close the source port.
   * @remarks 中文说明：功能说明：关闭 close 相关流程；使用场景由所在模块及调用位置决定。；返回值：void；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 close()，并按返回类型处理结果。 */
  close(): void {
    if (this.closed) return
    this.publisher.close()
    this.closed = true
    this.queries.close('Inspector Host source closed')
    /**
     * 常量说明：frame 用于处理 frame 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const frame: SourceCloseFrame = {
      v: INSPECTOR_PROTOCOL_VERSION,
      t: 'source/close',
      sourceId: this.source.sourceId,
      generation: this.source.generation,
    }
    this.port.postMessage(frame)
    this.port.close()
  }

  /**
   * 功能说明：处理 receive 相关流程；使用场景由所在模块及调用位置决定。
   * @param frame （WorkerToSourceFrame）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 receive(frame)，并按返回类型处理结果。
   */
  private receive(frame: WorkerToSourceFrame): void {
    if (frame.t !== 'source/rejected'
      && (frame.sourceId !== this.source.sourceId || frame.generation !== this.source.generation)) return
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：acknowledged（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(acknowledged)，并按返回类型处理结果。
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
    dispatchBridgeFrame(frame, {
      accepted: () => { this.queries.connectPort(this.source) },
      acknowledged: (acknowledged) => { this.publisher.acknowledge(acknowledged.nextSequence) },
      resnapshot: () => { this.publisher.replace() },
      rejected: (rejected) => { this.queries.disconnect(`Inspector Host source rejected: ${rejected.message}`) },
    })
  }
}
