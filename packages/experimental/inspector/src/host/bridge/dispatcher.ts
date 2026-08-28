/** Dispatch of validated Worker frames accepted by the Host MessagePort.
 * @remarks 文件说明：文件职责：实现 experimental/inspector 中 dispatcher 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/inspector 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。 */

import type {
  SourceAcceptedFrame,
  SourceAppendAcknowledgedFrame,
  SourceRejectedFrame,
  SourceResnapshotFrame,
  WorkerToSourceFrame,
} from '../../shared/bridge/messages/observation.ts'
import { rejectConsoleBridgeCommand } from '../cdp/console.ts'
import { rejectRuntimeBridgeCommand } from '../cdp/runtime.ts'
import { rejectSourcesBridgeCommand } from '../cdp/sources.ts'

/** Operations invoked for source-lifecycle frames addressed to the Host. */
export interface HostBridgeFrameHandlers {
  /**
   * 功能说明：处理 accepted 相关流程；使用场景由所在模块及调用位置决定。
   * @param frame （SourceAcceptedFrame）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 accepted(frame)，并按返回类型处理结果。
   */
  accepted(frame: SourceAcceptedFrame): void
  /**
   * 功能说明：处理 acknowledged 相关流程；使用场景由所在模块及调用位置决定。
   * @param frame （SourceAppendAcknowledgedFrame）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 acknowledged(frame)，并按返回类型处理结果。
   */
  acknowledged(frame: SourceAppendAcknowledgedFrame): void
  /**
   * 功能说明：处理 resnapshot 相关流程；使用场景由所在模块及调用位置决定。
   * @param frame （SourceResnapshotFrame）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 resnapshot(frame)，并按返回类型处理结果。
   */
  resnapshot(frame: SourceResnapshotFrame): void
  /**
   * 功能说明：处理 rejected 相关流程；使用场景由所在模块及调用位置决定。
   * @param frame （SourceRejectedFrame）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 rejected(frame)，并按返回类型处理结果。
   */
  rejected(frame: SourceRejectedFrame): void
}

/**
 * Dispatch one validated Worker frame and reject Client-only commands on the Host carrier.
 * @param frame - Decoded Worker-to-source frame.
 * @param handlers - Host source-lifecycle operations.
 * @remarks 中文说明：功能说明：分发 Bridge Frame 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：frame（WorkerToSourceFrame）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：handlers（HostBridgeFrameHandlers）：接收后续状态或事件并执行调用方逻辑；
 * 必须满足声明的类型及调用时序要求。；返回值：void；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 dispatchBridgeFrame(frame, handlers)，并按返回类型处理结果。
 */
export function dispatchBridgeFrame(frame: WorkerToSourceFrame, handlers: HostBridgeFrameHandlers): void {
  switch (frame.t) {
    case 'source/accepted':
      handlers.accepted(frame)
      return
    case 'source/append-acknowledged':
      handlers.acknowledged(frame)
      return
    case 'source/resnapshot':
      handlers.resnapshot(frame)
      return
    case 'source/rejected':
      handlers.rejected(frame)
      return
    case 'client-runtime/request':
      return rejectRuntimeBridgeCommand(frame.command)
    case 'client-runtime/cancel':
    case 'client-runtime/response-acknowledged':
      return
    case 'client-console/enable':
    case 'client-console/disable':
      return rejectConsoleBridgeCommand(frame.t)
    case 'client-sources/request':
      return rejectSourcesBridgeCommand()
    case 'client-runtime/session-closed':
    case 'client-sources/session-closed':
      return
    default:
      return assertNever(frame)
  }
}

/**
 * 功能说明：断言 Never 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （never）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns never；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 assertNever(value)，并按返回类型处理结果。
 */
function assertNever(value: never): never {
  throw new Error(`Unexpected Worker source frame: ${JSON.stringify(value)}`)
}
