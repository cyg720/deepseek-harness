/** Host-side non-CDP query bridge over the Worker MessagePort.
 * @remarks 文件说明：文件职责：实现 experimental/inspector 中 rpc 模块的职责，并向相邻模块提供可复用能力。；
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/inspector 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。 */

import type { MessagePort } from 'node:worker_threads'
import type { InspectorSourceDescriptor } from '../../shared/bridge/messages/observation.ts'
import { InspectorQueryConnection, type InspectorQueryConnectionOptions } from '../../shared/bridge/rpc.ts'

/** Owns query correlation for one Host source generation.
 * @remarks 中文说明：类说明：HostBridgeRpc 用于集中封装 处理 HostBridgeRpc 相关状态与行为。；
 * 核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。；使用场景：由 experimental/inspector
 * 在对应插件或业务生命周期内创建和调用。 */
export class HostBridgeRpc extends InspectorQueryConnection {
  /**
   * 功能说明：处理 HostBridgeRpc 相关流程；使用场景由所在模块及调用位置决定。
   * @param port （MessagePort）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param options （InspectorQueryConnectionOptions）：提供本次操作使用的配置选项；
   * 必须满足声明的类型及调用时序要求。
   * @returns 当前类实例；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 通过 new HostBridgeRpc(port, options) 创建实例，并在所属生命周期内使用。
   */
  constructor(private readonly port: MessagePort, options: InspectorQueryConnectionOptions) {
    super(options)
  }

  /**
   * Connect query writes after the Worker accepts the Host source.
   * @param source - Accepted Host source descriptor.
   * @remarks 中文说明：功能说明：处理 connectPort 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：source（InspectorSourceDescriptor）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：void；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * connectPort(source)，并按返回类型处理结果。
   */
  connectPort(source: InspectorSourceDescriptor): void {
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：frame（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(frame)，并按返回类型处理结果。
     */
    this.connect(source.sourceId, source.generation, {
      send: (frame) => { this.port.postMessage(frame) },
    })
  }
}
