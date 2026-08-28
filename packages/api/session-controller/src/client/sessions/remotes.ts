/**
 * Remote namespaces the Session cluster calls. One parameter for one concept:
 * the generated surface a Session and its manager reach the Host through.
 *
 * @module @deepseek-ai/dsh-api-session-controller/client/sessions/remotes
 * @remarks 文件说明：文件职责：实现 api/session-controller 中 remotes 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * api/session-controller 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。
 */

import type { EncodedImageAttachment } from '@deepseek-ai/dsh-attachment/types'
import type { ClientRemote } from '@deepseek-ai/dsh-api-gateway/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {
  SubagentCatalog, SubagentInterruptReceipt, SubagentPromptReceipt, SubagentPromptRequest,
} from '@deepseek-ai/dsh-subagent/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { SessionRemote } from '../transport.ts'

/** Narrow Commands namespace consumed by a Client Session. */
export interface SessionCommandsRemote {
  /**
   * 功能说明：执行 execute 相关流程；使用场景由所在模块及调用位置决定。
   * @param agentId （SessionId）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param line （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param images （readonly EncodedImageAttachment[]）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。
   * @param signal （AbortSignal）：传递取消或终止信号；必须满足声明的类型及调用时序要求。
   * @returns Promise<RemoteResult<object | undefined>>；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 execute(agentId, line, images, signal)，并按返回类型处理结果。
   */
  execute(
    agentId: SessionId,
    line: string,
    images: readonly EncodedImageAttachment[],
    signal?: AbortSignal,
  ): Promise<RemoteResult<object | undefined>>
}

/** Narrow subagent namespace consumed by a Client Session and its manager. */
export interface SessionSubagentsRemote {
  /**
   * 功能说明：列出 list 相关流程；使用场景由所在模块及调用位置决定。
   * @param parentSessionId （SessionId）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param signal （AbortSignal）：传递取消或终止信号；必须满足声明的类型及调用时序要求。
   * @returns Promise<RemoteResult<SubagentCatalog>>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 list(parentSessionId, signal)，并按返回类型处理结果。
   */
  list(parentSessionId: SessionId, signal?: AbortSignal): Promise<RemoteResult<SubagentCatalog>>
  /**
   * 功能说明：处理 prompt 相关流程；使用场景由所在模块及调用位置决定。
   * @param request （SubagentPromptRequest）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。
   * @param signal （AbortSignal）：传递取消或终止信号；必须满足声明的类型及调用时序要求。
   * @returns Promise<RemoteResult<SubagentPromptReceipt>>；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 prompt(request, signal)，并按返回类型处理结果。
   */
  prompt(
    request: SubagentPromptRequest,
    signal?: AbortSignal,
  ): Promise<RemoteResult<SubagentPromptReceipt>>
  /**
   * 功能说明：处理 interruptByParent 相关流程；使用场景由所在模块及调用位置决定。
   * @param childSessionId （SessionId）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param parentSessionId （SessionId）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param mode （'continuable'）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns Promise<RemoteResult<SubagentInterruptReceipt>>；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 interruptByParent(childSessionId, parentSessionId,
   * mode)，并按返回类型处理结果。
   */
  interruptByParent(
    childSessionId: SessionId,
    parentSessionId: SessionId,
    mode: 'continuable',
  ): Promise<RemoteResult<SubagentInterruptReceipt>>
}

/** Generated Remote namespaces consumed by the Client Session object layer. */
export interface SessionRemotes {
  readonly $stream: ClientRemote['$stream']
  readonly commands: SessionCommandsRemote
  readonly session: SessionRemote
  readonly subagents: SessionSubagentsRemote
}
