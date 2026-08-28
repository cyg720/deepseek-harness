/** Worker-side bridge dependencies for one connected Client realm.
 * @remarks 文件说明：文件职责：实现 experimental/inspector 中 bridge 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/inspector 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。 */

import type { ClientRuntimeRouter, ClientRuntimeTarget } from '../../bridge/runtime-rpc.ts'
import type { ClientSourceRouter } from '../../bridge/source-rpc.ts'

/** Typed bridge services used by all Client realm backend adapters. */
export interface ClientRealmBridge {
  readonly target: ClientRuntimeTarget
  readonly runtime: ClientRuntimeRouter
  readonly sources: ClientSourceRouter
}

/**
 * Bind one Client source generation to the Worker bridge services that can address it.
 * @param target - Active Client source generation and execution context.
 * @param runtime - Runtime and Console RPC router.
 * @param sources - Source-catalog RPC router.
 * @returns The immutable Client realm bridge.
 * @remarks 中文说明：功能说明：创建 Client Realm Bridge 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：target（ClientRuntimeTarget）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：runtime（ClientRuntimeRouter）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：sources（ClientSourceRouter）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：ClientRealmBridge；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * createClientRealmBridge(target, runtime, sources)，并按返回类型处理结果。
 */
export function createClientRealmBridge(
  target: ClientRuntimeTarget,
  runtime: ClientRuntimeRouter,
  sources: ClientSourceRouter,
): ClientRealmBridge {
  return { target, runtime, sources }
}
