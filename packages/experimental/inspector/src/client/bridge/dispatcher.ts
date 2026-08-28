/** Dispatch of validated Worker frames to browser-realm capability handlers.
 * @remarks 文件说明：文件职责：实现 experimental/inspector 中 dispatcher 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/inspector 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。 */

import type {
  ClientConsoleDisableFrame,
  ClientConsoleEnableFrame,
  ClientRuntimeCancelFrame,
  ClientRuntimeRequestFrame,
  ClientRuntimeResponseAcknowledgedFrame,
  ClientRuntimeSessionClosedFrame,
} from '../../shared/bridge/messages/runtime/index.ts'
import type { ClientSourceRequestFrame, ClientSourceSessionClosedFrame } from '../../shared/bridge/messages/sources/index.ts'
import type {
  SourceAcceptedFrame,
  SourceAppendAcknowledgedFrame,
  SourceRejectedFrame,
  SourceResnapshotFrame,
  WorkerToSourceFrame,
} from '../../shared/bridge/messages/observation.ts'

/** Operations invoked for each Worker-to-Client frame family. */
export interface ClientBridgeFrameHandlers {
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
  /**
   * 功能说明：处理 runtime 相关流程；使用场景由所在模块及调用位置决定。
   * @param frame （ClientRuntimeRequestFrame）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 runtime(frame)，并按返回类型处理结果。
   */
  runtime(frame: ClientRuntimeRequestFrame): void
  /**
   * 功能说明：处理 runtimeCanceled 相关流程；使用场景由所在模块及调用位置决定。
   * @param frame （ClientRuntimeCancelFrame）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 runtimeCanceled(frame)，并按返回类型处理结果。
   */
  runtimeCanceled(frame: ClientRuntimeCancelFrame): void
  /**
   * 功能说明：处理 runtimeAcknowledged 相关流程；使用场景由所在模块及调用位置决定。
   * @param frame （ClientRuntimeResponseAcknowledgedFrame）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 runtimeAcknowledged(frame)，并按返回类型处理结果。
   */
  runtimeAcknowledged(frame: ClientRuntimeResponseAcknowledgedFrame): void
  /**
   * 功能说明：处理 runtimeClosed 相关流程；使用场景由所在模块及调用位置决定。
   * @param frame （ClientRuntimeSessionClosedFrame）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 runtimeClosed(frame)，并按返回类型处理结果。
   */
  runtimeClosed(frame: ClientRuntimeSessionClosedFrame): void
  /**
   * 功能说明：处理 consoleEnabled 相关流程；使用场景由所在模块及调用位置决定。
   * @param frame （ClientConsoleEnableFrame）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 consoleEnabled(frame)，并按返回类型处理结果。
   */
  consoleEnabled(frame: ClientConsoleEnableFrame): void
  /**
   * 功能说明：处理 consoleDisabled 相关流程；使用场景由所在模块及调用位置决定。
   * @param frame （ClientConsoleDisableFrame）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 consoleDisabled(frame)，并按返回类型处理结果。
   */
  consoleDisabled(frame: ClientConsoleDisableFrame): void
  /**
   * 功能说明：处理 sources 相关流程；使用场景由所在模块及调用位置决定。
   * @param frame （ClientSourceRequestFrame）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 sources(frame)，并按返回类型处理结果。
   */
  sources(frame: ClientSourceRequestFrame): void
  /**
   * 功能说明：处理 sourcesClosed 相关流程；使用场景由所在模块及调用位置决定。
   * @param frame （ClientSourceSessionClosedFrame）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 sourcesClosed(frame)，并按返回类型处理结果。
   */
  sourcesClosed(frame: ClientSourceSessionClosedFrame): void
}

/**
 * Dispatch one validated Worker frame without exposing transport details to domain adapters.
 * @param frame - Decoded Worker-to-source frame.
 * @param handlers - Browser-realm operations for each frame family.
 * @remarks 中文说明：功能说明：分发 Bridge Frame 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：frame（WorkerToSourceFrame）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：handlers（ClientBridgeFrameHandlers）：接收后续状态或事件并执行调用方逻辑；
 * 必须满足声明的类型及调用时序要求。；返回值：void；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 dispatchBridgeFrame(frame, handlers)，并按返回类型处理结果。
 */
export function dispatchBridgeFrame(frame: WorkerToSourceFrame, handlers: ClientBridgeFrameHandlers): void {
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
      handlers.runtime(frame)
      return
    case 'client-runtime/cancel':
      handlers.runtimeCanceled(frame)
      return
    case 'client-runtime/response-acknowledged':
      handlers.runtimeAcknowledged(frame)
      return
    case 'client-runtime/session-closed':
      handlers.runtimeClosed(frame)
      return
    case 'client-console/enable':
      handlers.consoleEnabled(frame)
      return
    case 'client-console/disable':
      handlers.consoleDisabled(frame)
      return
    case 'client-sources/request':
      handlers.sources(frame)
      return
    case 'client-sources/session-closed':
      handlers.sourcesClosed(frame)
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
