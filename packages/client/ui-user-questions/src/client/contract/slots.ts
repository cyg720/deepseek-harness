/** Question composer props and one pending Remote waterfall response.
 * @remarks 文件说明：文件职责：实现 client/ui-user-questions 中 slots 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * client/ui-user-questions 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。 */
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
// The client module declares the conversation.composer SlotMap entry required by PropsRuntime.
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {
  AskUserQuestionAnswer, AskUserQuestionItem,
} from '@deepseek-ai/dsh-user-questions'
import type { createQuestionDraftStore } from '../draft-store.ts'

declare module '@deepseek-ai/dsh-client-ui-session/client' {
  interface SessionPendingInteractionMap {
    /** Pending question or plan-review request. */
    question: PendingQuestion
  }
}

/** One structured answer batch covering every question of the request. */
export type QuestionAnswer = AskUserQuestionAnswer

/** One question of the request. */
type QuestionItem = AskUserQuestionItem

/** One option the asker offered on a question. */
type QuestionOption = NonNullable<QuestionItem['options']>[number]

/* jscpd:ignore-start -- Question and Approval intentionally own independent pending-settlement lifecycles. */
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

/**
 * A request narrowed to the `plan-review` presentation intent: everything the
 * decision card renders and answers with, so the panel never re-reads the
 * request fields. `approve` and `decline` are the asker's own options — an
 * answer must carry one of those labels verbatim — and `plan` is the markdown
 * body under review.
 */
export interface PlanReview {
  /** The reviewed question's id, echoed in the answer. */
  id: string
  /** The question text, kept as the card's accessible name. */
  question: string
  /** The plan markdown under review. */
  plan: string
  /** The option that approves the plan. */
  approve: QuestionOption
  /** The option that declines it; absent when the asker offered no other option. */
  decline?: QuestionOption
}

/**
 * Narrow a request to a renderable plan review, or return undefined to leave it
 * to the generic question flow.
 *
 * The card is one decision over one plan, and it claims a request only when it
 * can send every answer that request allows — an intent changes the layout,
 * never which answers are reachable. So the batch must be a single question
 * that declares the intent, carries the plan as its detail, offers the approve
 * label the intent names, and is a binary single choice: at most one option
 * besides approve, and not multi-select. A third option or a multi-select batch
 * has answers two buttons cannot express, so the generic flow keeps it — as it
 * keeps any request whose intent the asker's own service would have rejected,
 * because the client sits downstream of a wire boundary and every request must
 * stay answerable.
 *
 * @param questions - the request's whole question batch.
 * @returns The narrowed review, or undefined when the generic flow owns it.
 * @remarks 中文说明：功能说明：处理 planReviewOf 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：questions（readonly QuestionItem[]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：PlanReview | undefined；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 planReviewOf(questions)，并按返回类型处理结果。
 */
export function planReviewOf(questions: readonly QuestionItem[]): PlanReview | undefined {
  if (questions.length !== 1) return undefined
  // Length-checked above; the index read is the narrowing tax, not a guess.
  /**
   * 常量说明：question 用于处理 question 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const question = questions[0] as QuestionItem
  /**
   * 常量说明：intent 用于处理 intent 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const intent = question.intent
  if (intent?.kind !== 'plan-review' || question.detail === undefined) return undefined
  if (question.multiSelect === true) return undefined
  /**
   * 常量说明：options 用于处理 options 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const options = question.options ?? []
  if (options.length > 2) return undefined
  /**
   * 常量说明：approve 用于处理 approve 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：option（由 TypeScript
   * 根据调用位置推断的类型）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(option)，并按返回类型处理结果。
   */
  const approve = options.find(option => option.label === intent.approve)
  if (approve === undefined) return undefined
  /**
   * 常量说明：decline 用于处理 decline 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：option（由 TypeScript
   * 根据调用位置推断的类型）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(option)，并按返回类型处理结果。
   */
  const decline = options.find(option => option.label !== intent.approve)
  return {
    id: question.id,
    question: question.question,
    plan: question.detail,
    approve,
    ...(decline === undefined ? {} : { decline }),
  }
}

/**
 * 变量说明：nextQuestionKey 用于处理 nextQuestionKey 相关数据，作用于当前作用域；其值可能随流程推进而变化，
 * 读写时需遵守声明类型和所在生命周期。
 */
let nextQuestionKey = 0

/** Create a wire-preserved user-question rejection.
 * @remarks 中文说明：功能说明：处理 questionError 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：message（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：code（'ASK_ABORTED' | 'ASK_CANCELLED'）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：Error；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * questionError(message, code)，并按返回类型处理结果。 */
function questionError(message: string, code: 'ASK_ABORTED' | 'ASK_CANCELLED'): Error {
  /**
   * 常量说明：error 用于处理 error 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const error = new Error(message) as Error & { code: string }
  error.name = 'UserQuestionError'
  error.code = code
  return error
}

/** One answerable Client presentation of a pending Host waterfall.
 * @remarks 中文说明：类说明：PendingQuestion 用于集中封装 处理 PendingQuestion 相关状态与行为。；
 * 核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。；使用场景：由 client/ui-user-questions
 * 在对应插件或业务生命周期内创建和调用。 */
export class PendingQuestion {
  /** Presentation discriminator used by Session pending-interaction consumers.
   * @remarks 中文说明：常量说明：kind 用于处理 kind 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
  readonly kind: 'question' | 'plan-review'
  /** Opaque render identity and request key for the Session-scoped draft store.
   * @remarks 中文说明：常量说明：key 用于处理 key 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
  readonly key: string
  /** The request's question list.
   * @remarks 中文说明：常量说明：questions 用于处理 questions 相关数据，作用于成员；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。 */
  readonly questions: readonly AskUserQuestionItem[]
  /** Result returned by the Remote Event listener to the Host waterfall.
   * @remarks 中文说明：常量说明：result 用于处理 result 相关数据，作用于成员；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。 */
  readonly result: Promise<QuestionAnswer>

  /**
   * 常量说明：#resolve 用于处理 #resolve 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  readonly #resolve: (answer: QuestionAnswer) => void
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
  readonly #delegated = Symbol('pending question delegated')
  /**
   * 变量说明：#settled 用于处理 #settled 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  #settled = false

  /**
   * @param sessionId - Agent/Session identity owning the scoped request.
   * @param questions - complete question batch.
   * @param signal - Host request and delivery lifetime.
   * @remarks 中文说明：功能说明：处理 PendingQuestion 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：sessionId（SessionId）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：questions（readonly AskUserQuestionItem[]）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。；参数说明：signal（AbortSignal）：传递取消或终止信号；必须满足声明的类型及调用时序要求。；
   * 返回值：当前类实例；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：通过 new
   * PendingQuestion(sessionId, questions, signal) 创建实例，并在所属生命周期内使用。
   */
  constructor(
    readonly sessionId: SessionId,
    questions: readonly AskUserQuestionItem[],
    signal?: AbortSignal,
  ) {
    nextQuestionKey += 1
    this.key = `question:${String(nextQuestionKey)}`
    this.questions = questions
    this.kind = planReviewOf(questions) === undefined ? 'question' : 'plan-review'
    /**
     * 常量说明：completion 用于处理 completion 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const completion = Promise.withResolvers<QuestionAnswer>()
    this.result = completion.promise
    this.#resolve = completion.resolve
    this.#reject = completion.reject
    this.#signal = signal
    if (signal === undefined) {
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
      this.abort(questionError('ask_user_question was aborted before the user answered', 'ASK_ABORTED'))
    }
    this.#onAbort = onAbort
    signal.addEventListener('abort', onAbort, { once: true })
    if (signal.aborted) onAbort()
  }

  /**
   * Resolve the Host waterfall with the whole answer batch.
   * @param answer - complete structured answer batch.
   * @remarks 中文说明：功能说明：处理 answer 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：answer（QuestionAnswer）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * answer(answer)，并按返回类型处理结果。
   */
  answer(answer: QuestionAnswer): Promise<void> {
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    return settlePendingComposer(() => {
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
       */
      this.finish(() => { this.#resolve(answer) })
    }, 'pending question settlement failed')
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
   * @param reason - rejection received from {@link PendingQuestion.result}.
   * @returns whether {@link PendingQuestion.delegate} produced it.
   * @remarks 中文说明：功能说明：判断是否为 Delegation 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：reason（unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：boolean；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 isDelegation(reason)，
   * 并按返回类型处理结果。
   */
  isDelegation(reason: unknown): boolean {
    return reason === this.#delegated
  }

  /** Reject the Host waterfall because the user closed the question.
   * @remarks 中文说明：功能说明：处理 cancel 相关流程；使用场景由所在模块及调用位置决定。；返回值：Promise<void>；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 cancel()，并按返回类型处理结果。 */
  cancel(): Promise<void> {
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    return settlePendingComposer(() => {
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
       */
      this.finish(() => {
        this.#reject(questionError('the user cancelled ask_user_question', 'ASK_CANCELLED'))
      })
    }, 'pending question cancellation failed')
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
    if (this.#settled) throw new Error(`pending question ${this.key} is already settled`)
    this.#settled = true
    if (this.#signal !== undefined && this.#onAbort !== undefined) {
      this.#signal.removeEventListener('abort', this.#onAbort)
    }
    settle()
  }
}

/** Pending value returned by the composer-chain selector. */
export type QuestionWait = PendingQuestion

/**
 * Full component props: the framework runtime share (chain currency +
 * session/global standard kit) plus the chain `matched` share — the entry's
 * selector result, already narrowed to the question carrier — plus the
 * standard locale seat; the carrier plus the domain face above carry the
 * whole behavior surface.
 */
export type QuestionComposerProps =
  PropsRuntime<'conversation.composer'>
  & PropsStore<ReturnType<typeof createQuestionDraftStore>>
  & { matched: QuestionWait }
  & PropsLocale<'question'>
