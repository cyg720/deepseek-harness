/** Client Runtime failures that belong to the transport rather than evaluated JavaScript.
 * @remarks 文件说明：文件职责：实现 experimental/inspector 中 errors 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/inspector 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。 */

import type { ClientRuntimeError } from '../../shared/bridge/messages/runtime/index.ts'

/** Failure returned through the typed Client Runtime error outcome.
 * @remarks 中文说明：类说明：ClientRuntimeExecutionError 用于集中封装 处理
 * ClientRuntimeExecutionError 相关状态与行为。；核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。；
 * 使用场景：由 experimental/inspector 在对应插件或业务生命周期内创建和调用。 */
export class ClientRuntimeExecutionError extends Error {
  /**
   * 功能说明：处理 ClientRuntimeExecutionError 相关流程；使用场景由所在模块及调用位置决定。
   * @param code （ClientRuntimeError['code']）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param message （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns 当前类实例；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 通过 new ClientRuntimeExecutionError(code, message) 创建实例，
   * 并在所属生命周期内使用。
   */
  constructor(readonly code: ClientRuntimeError['code'], message: string) {
    super(message)
  }
}
