/** Shared Host/Client publication of browser-safe Cordis snapshots.
 * @remarks 文件说明：文件职责：实现 experimental/inspector 中 publisher 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/inspector 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。 */

import type { Context } from '@deepseek-ai/cordis'
import { CORDIS_TREE_TOPIC } from '../bridge/messages/cordis.ts'
import type { InspectorStatePublisher } from '../bridge/publisher.ts'
import type { InspectorJsonValue } from '../json.ts'
import type { CordisTreeLimits } from './collector.ts'
import { observeCordisTree } from './observer.ts'

/**
 * Observe one Cordis runtime and retain its latest source snapshot.
 * @param ctx - Plugin context whose root is inspected.
 * @param publisher - Active Host or Client source publisher.
 * @param limits - Snapshot node and encoded-byte limits.
 * @returns A disposer that stops observation and releases retained objects.
 * @remarks 中文说明：功能说明：处理 publishCordisTree 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：ctx（Context）：提供当前 Cordis 插件上下文与已声明服务；必须满足声明的类型及调用时序要求。；
 * 参数说明：publisher（InspectorStatePublisher）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：limits（CordisTreeLimits）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：() =>
 * void；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * publishCordisTree(ctx, publisher, limits)，并按返回类型处理结果。
 */
export function publishCordisTree(
  ctx: Context,
  publisher: InspectorStatePublisher,
  limits: CordisTreeLimits,
): () => void {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：snapshot（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(snapshot)，并按返回类型处理结果。
   */
  return observeCordisTree(ctx, (snapshot) => {
    publisher.setState(CORDIS_TREE_TOPIC, snapshot as unknown as InspectorJsonValue)
  }, limits)
}
