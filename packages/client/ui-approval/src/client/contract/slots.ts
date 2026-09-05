/*
 * 【文件职责】声明审批输入区与关联详情的插槽参数，确保待审批请求在组合界面中保留关联身份。
 */

import type { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {
  PropsLocale, PropsRenderSlots, PropsRuntime,
} from '@deepseek-ai/dsh-client-ui-slots'
import type { ApprovalKey } from '../locales.ts'

/* jscpd:ignore-start -- Approval and Question intentionally own independent pending-settlement lifecycles. */
/**
 * 功能说明：处理 settlePendingComposer 相关流程；使用场景由所在模块及调用位置决定。
 * @param settle （() => void）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param failureMessage （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 settlePendingComposer(settle, failureMessage)，
 * 并按返回类型处理结果。
 */
function settlePendingComposer(settle: () => void, failureMessage: string): Promise<void> {
  /**
   * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
   */
  try {
    settle()
    return Promise.resolve()
  } catch (error) {
    return Promise.reject(error instanceof Error
      ? error
      : new Error(failureMessage, { cause: error }))
  }
}
/* jscpd:ignore-end */

declare module '@deepseek-ai/dsh-client-ui-session/client' {
  interface SessionPendingInteractionMap {
    /** Pending approval request. */
    approval: PendingApproval
  }
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Approval prompt copy. */
    approval: ApprovalKey
  }

  interface SlotMap {
    /** Optional detail for the Tool call correlated with an approval request. */
    'conversation.approval.detail': {
      kind: 'single'
      scope: 'session'
      owner: ApprovalDetailOwnerProps
    }
  }
}

/** Stable identity handed to an optional approval-detail renderer. */
export interface ApprovalDetailOwnerProps {
  /** Tool call correlated with the request. */
  callId: ToolCallId
}

/** Client-visible fields of an approval request projected through Remote Events. */
export interface ApprovalPresentationRequest {
  /** Tool requesting the decision. */
  readonly toolName: string
  /** Tool call correlated with the request. */
  readonly callId?: ToolCallId
  /** Human-readable reason supplied by the requester. */
  readonly reason?: string
  /** Cancellation projected from the Host waterfall. */
  readonly signal?: AbortSignal
}

/** Decisions this interactive Client presentation can return. */
export type ApprovalDecision = 'allowed-once' | 'rejected'

/**
 * 变量说明：nextApprovalKey 用于处理 nextApprovalKey 相关数据，作用于当前作用域；其值可能随流程推进而变化，
 * 读写时需遵守声明类型和所在生命周期。
 */
let nextApprovalKey = 0

/** One answerable Client presentation of a pending Host waterfall.
 * @remarks 中文说明：类说明：PendingApproval 用于集中封装 处理 PendingApproval 相关状态与行为。；
 * 核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。；使用场景：由 client/ui-approval
 * 在对应插件或业务生命周期内创建和调用。 */
export class PendingApproval {
  /** Domain discriminator used by Session pending-interaction consumers. */
  readonly kind: 'approval'
  /** Opaque render identity and one-shot remount axis. */
  readonly key: string
  /** Tool requesting the decision.
   * @remarks 中文说明：常量说明：toolName 用于处理 toolName 相关数据，作用于成员；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。 */
  readonly toolName: string
  /** Correlated Tool call, when supplied by the asker.
   * @remarks 中文说明：常量说明：callId 用于处理 callId 相关数据，作用于成员；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。 */
  readonly callId: ToolCallId | undefined
  /** Human-readable reason supplied by the asker.
   * @remarks 中文说明：常量说明：reason 用于处理 reason 相关数据，作用于成员；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。 */
  readonly reason: string | undefined
  /** Result returned by the Remote Event listener to the Host waterfall.
   * @remarks 中文说明：常量说明：result 用于处理 result 相关数据，作用于成员；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。 */
  readonly result: Promise<ApprovalDecision>

  /**
   * 常量说明：#resolve 用于处理 #resolve 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  readonly #resolve: (outcome: ApprovalDecision) => void
  /**
   * 常量说明：#reject 用于处理 #reject 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  readonly #reject: (reason: unknown) => void
  /**
   * 常量说明：#signal 用于处理 #signal 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  readonly #signal: AbortSignal | undefined
  /**
   * 常量说明：#onAbort 用于处理 #onAbort 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  readonly #onAbort: (() => void) | undefined
  /**
   * 常量说明：#delegated 用于处理 #delegated 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  readonly #delegated = Symbol('pending approval delegated')
  /**
   * 变量说明：#settled 用于处理 #settled 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  #settled = false

  /**
   * @param sessionId - Agent/Session identity owning the scoped request.
   * @param request - Host approval request projected through the Remote Event.
   * @remarks 中文说明：功能说明：处理 PendingApproval 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：sessionId（SessionId）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：request（ApprovalPresentationRequest）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。；
   * 返回值：当前类实例；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：通过 new
   * PendingApproval(sessionId, request) 创建实例，并在所属生命周期内使用。
   */
  constructor(readonly sessionId: SessionId, request: ApprovalPresentationRequest) {
    this.kind = 'approval'
    nextApprovalKey += 1
    this.key = `approval:${String(nextApprovalKey)}`
    this.toolName = request.toolName
    this.callId = request.callId
    this.reason = request.reason
    /**
     * 常量说明：completion 用于处理 completion 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const completion = Promise.withResolvers<ApprovalDecision>()
    this.result = completion.promise
    this.#resolve = completion.resolve
    this.#reject = completion.reject
    this.#signal = request.signal
    if (request.signal === undefined) {
      this.#onAbort = undefined
      return
    }
    /**
     * 常量说明：onAbort 用于响应 Abort 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     * 功能说明：响应 Abort 相关流程；使用场景由所在模块及调用位置决定。
     * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 onAbort()，并按返回类型处理结果。
     */
    const onAbort = (): void => {
      this.abort(request.signal?.reason ?? new Error('approval request was aborted'))
    }
    this.#onAbort = onAbort
    request.signal.addEventListener('abort', onAbort, { once: true })
    if (request.signal.aborted) onAbort()
  }

  /**
   * Resolve the Host waterfall with the user's decision.
   * @param outcome - supported interactive decision.
   * @remarks 中文说明：功能说明：处理 answer 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：outcome（ApprovalDecision）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * answer(outcome)，并按返回类型处理结果。
   */
  answer(outcome: ApprovalDecision): Promise<void> {
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    return settlePendingComposer(() => {
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
       */
      this.finish(() => { this.#resolve(outcome) })
    }, 'pending approval settlement failed')
  }

  /** Delegate an unanswered request to the next waterfall listener.
   * @remarks 中文说明：功能说明：处理 delegate 相关流程；使用场景由所在模块及调用位置决定。；返回值：void；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 delegate()，并按返回类型处理结果。 */
  delegate(): void {
    if (this.#settled) return
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    this.finish(() => { this.#reject(this.#delegated) })
  }

  /**
   * Test whether a rejection requests waterfall delegation.
   * @param reason - rejection received from {@link PendingApproval.result}.
   * @returns whether {@link PendingApproval.delegate} produced it.
   * @remarks 中文说明：功能说明：判断是否为 Delegation 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：reason（unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：boolean；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 isDelegation(reason)，
   * 并按返回类型处理结果。
   */
  isDelegation(reason: unknown): boolean {
    return reason === this.#delegated
  }

  /**
   * End an unanswered presentation when its transport, scope, or plugin lifetime ends.
   * @param reason - rejection exposed to the waiting Remote Event listener.
   * @remarks 中文说明：功能说明：处理 abort 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：reason（unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 abort(reason)，并按返回类型处理结果。
   */
  abort(reason: unknown): void {
    if (this.#settled) return
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    this.finish(() => { this.#reject(reason) })
  }

  /**
   * 功能说明：处理 finish 相关流程；使用场景由所在模块及调用位置决定。
   * @param settle （() => void）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 finish(settle)，并按返回类型处理结果。
   */
  private finish(settle: () => void): void {
    if (this.#settled) throw new Error(`pending approval ${this.key} is already settled`)
    this.#settled = true
    if (this.#signal !== undefined && this.#onAbort !== undefined) {
      this.#signal.removeEventListener('abort', this.#onAbort)
    }
    settle()
  }
}

/** Full props of the approval composer takeover. */
export type ApprovalComposerProps =
  PropsRuntime<'conversation.composer'>
  & PropsRenderSlots<'conversation.approval.detail'>
  & { matched: PendingApproval }
  & PropsLocale<'approval'>
