/*
 * 【文件职责】限定 Session 及其管理器可调用的 Remote 命名空间，集中声明客户端所需的主机操作。
 */

import type { ClientRemote } from '@deepseek-ai/dsh-api-gateway/client'
import type { CommandSubmitAttachment } from '@deepseek-ai/dsh-commands/types'
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
    attachments: readonly CommandSubmitAttachment[],
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
