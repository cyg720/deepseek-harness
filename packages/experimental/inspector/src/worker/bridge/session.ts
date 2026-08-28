/** Shared cleanup delivery for Worker-owned Client sessions.
 * @remarks 文件说明：文件职责：实现 experimental/inspector 中 session 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/inspector 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。 */

import type { ClientRuntimeSessionClosedFrame } from '../../shared/bridge/messages/runtime/index.ts'
import type { ClientSourceSessionClosedFrame } from '../../shared/bridge/messages/sources/index.ts'
import type { InspectorSourceDescriptor } from '../../shared/bridge/messages/observation.ts'
import type { InspectorSourceRegistry } from './hub.ts'

type ClientSessionClosedFrame = ClientRuntimeSessionClosedFrame | ClientSourceSessionClosedFrame

/**
 * Send cleanup to an active Client generation when its transport is still usable.
 * @param sources - Worker source registry owning the transport.
 * @param source - Generation whose session closed.
 * @param frame - Typed Runtime or source-catalog cleanup frame.
 * @remarks 中文说明：功能说明：处理 sendClientSessionClosed 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：sources（InspectorSourceRegistry）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：source（InspectorSourceDescriptor）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：frame（ClientSessionClosedFrame）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：void；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * sendClientSessionClosed(sources, source, frame)，并按返回类型处理结果。
 */
export function sendClientSessionClosed(
  sources: InspectorSourceRegistry,
  source: InspectorSourceDescriptor,
  frame: ClientSessionClosedFrame,
): void {
  try {
    sources.send(source, frame)
  } catch {
    // Source removal already invalidates every session owned by this generation.
  }
}
