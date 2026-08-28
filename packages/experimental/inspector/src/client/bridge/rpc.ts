/** Client-side non-CDP query bridge over the active Worker WebSocket.
 * @remarks 文件说明：文件职责：实现 experimental/inspector 中 rpc 模块的职责，并向相邻模块提供可复用能力。；
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/inspector 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。 */

import type { InspectorSourceDescriptor } from '../../shared/bridge/messages/observation.ts'
import { InspectorQueryConnection } from '../../shared/bridge/rpc.ts'

/** Owns query correlation across reconnecting Client source generations.
 * @remarks 中文说明：类说明：ClientBridgeRpc 用于集中封装 处理 ClientBridgeRpc 相关状态与行为。；
 * 核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。；使用场景：由 experimental/inspector
 * 在对应插件或业务生命周期内创建和调用。 */
export class ClientBridgeRpc extends InspectorQueryConnection {
  /**
   * Connect query writes to one accepted Client WebSocket generation.
   * @param source - Accepted source descriptor.
   * @param socket - Active source WebSocket.
   * @remarks 中文说明：功能说明：处理 connectSocket 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：source（InspectorSourceDescriptor）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：socket（WebSocket）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 connectSocket(source,
   * socket)，并按返回类型处理结果。
   */
  connectSocket(source: InspectorSourceDescriptor, socket: WebSocket): void {
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：frame（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(frame)，并按返回类型处理结果。
     */
    this.connect(source.sourceId, source.generation, {
      send: (frame) => {
        if (socket.readyState !== WebSocket.OPEN) throw new Error('Inspector Client query socket is not connected')
        socket.send(JSON.stringify(frame))
      },
    })
  }
}
