/**
 * ================================ 文件注释 ================================
 * 【文件职责】提问输入条槽位契约：conversation.composer 槽位的注册者侧 props
 *             组合，以及运行时钟载体（PendingWait）之上的提问领域面。
 * 【技术维度】纯类型 + 领域类：载体只负责信封传输；提问协议——答案值形态、取消
 *             错误编码、回执检查——都住在本包（消费它的包）。
 * 【产品维度】等待用户回答的提问载体：通用提问流程与 plan-review 决策卡片。
 * 【逻辑维度】QuestionWait/QuestionAnswer 载体类型 → PlanReview/planReviewOf
 *             收窄决策卡片 → PendingQuestion 领域面（answer/cancel 走线缆编码）。
 * 【关键边界】planReviewOf 只认"单一问题 + plan-review 意图 + 至多两个选项且
 *             非多选"的批——两个按钮表达不了第三选项或多选。
 * 【新手阅读建议】先看 planReviewOf 的收窄规则，再看 PendingQuestion 的编码。
 * ==========================================================================
 */
/**
 * Question-composer slot contract: the registrant-side props composition for
 * the conversation-owned `conversation.composer` slot, plus the question
 * domain face over the runtime's carrier object. The carrier (PendingWait)
 * owns envelope transport only; the question protocol — answer value shape,
 * cancelled error encoding, receipt checks — lives HERE, with the package
 * that consumes it.
 */
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Also pulls ui-conversation's SlotMap merge (the 'conversation.composer'
// entry) into every program that sees this contract, so PropsRuntime resolves.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { PendingWait } from '@deepseek-ai/dsh-client-runtime/client'
import type { QuestionResponsePayload } from '@deepseek-ai/dsh-api-remotes/client'

/** The pending question carrier the owner dispatches into the composer slot. */
export type QuestionWait = PendingWait<'question'>

/** One structured answer batch covering every question of the request. */
export type QuestionAnswer = QuestionResponsePayload['answer']

/** One question of the request, as the carrier payload carries it. */
type QuestionItem = QuestionWait['payload']['questions'][number]

/** One option the asker offered on a question. */
type QuestionOption = NonNullable<QuestionItem['options']>[number]

/**
 * A request narrowed to the `plan-review` presentation intent: everything the
 * decision card renders and answers with, so the panel never re-reads the
 * request shape. `approve` and `decline` are the asker's own options — an
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
 */
export function planReviewOf(questions: readonly QuestionItem[]): PlanReview | undefined {
  if (questions.length !== 1) return undefined
  // Length-checked above; the index read is the narrowing tax, not a guess.
  const question = questions[0] as QuestionItem
  const intent = question.intent
  if (intent?.kind !== 'plan-review' || question.detail === undefined) return undefined
  if (question.multiSelect === true) return undefined
  const options = question.options ?? []
  if (options.length > 2) return undefined
  const approve = options.find(option => option.label === intent.approve)
  if (approve === undefined) return undefined
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
 * Question domain face over the carrier: render identity and questions
 * transparently forwarded; answer/cancel own the wire encoding (the success
 * fields and the cancelled error) and turn a rejected carrier receipt into a
 * thrown error. Components mint one per carrier via useMemo (never inside a
 * select — a per-dispatch mint would churn identity and break memoization).
 */
export class PendingQuestion {
  /**
   * @param wait - the runtime carrier for one pending question request.
   */
  constructor(private readonly wait: QuestionWait) {}

  /** Opaque render identity (React key / draft remount axis), forwarded from the carrier. */
  get key(): string {
    return this.wait.key
  }

  /** The request's question list, forwarded from the carrier payload. */
  get questions(): QuestionWait['payload']['questions'] {
    return this.wait.payload.questions
  }

  /**
   * Deliver the whole answer batch; a rejected carrier receipt throws.
   * @param answer - complete structured answer batch.
   */
  async answer(answer: QuestionAnswer): Promise<void> {
    const receipt = await this.wait.respond({
      ok: true, value: { sessionId: this.wait.sessionId, answer },
    })
    if (!receipt.accepted) {
      throw new Error(`question response rejected: ${receipt.reason}`)
    }
  }

  /** Reject the whole wait (the host resolves the tool call as cancelled); a rejected receipt throws. */
  async cancel(): Promise<void> {
    const receipt = await this.wait.respond({
      ok: false,
      error: { code: 'cancelled', message: 'the user closed this question request', details: {} },
    })
    if (!receipt.accepted) {
      throw new Error(`question cancellation rejected: ${receipt.reason}`)
    }
  }
}

/**
 * Full component props: the framework runtime share (chain currency +
 * session/global standard kit) plus the chain `matched` share — the entry's
 * selector result, already narrowed to the question carrier — plus the
 * standard locale seat; the carrier plus the domain face above carry the
 * whole behavior surface.
 */
export type QuestionComposerProps =
  PropsRuntime<'conversation.composer'> & { matched: QuestionWait } & PropsLocale<'question'>
