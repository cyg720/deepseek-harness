/**
 * plan-review 判定。
 *
 * 规则逐条照抄官方 `ui-user-questions/src/client/contract/slots.ts:77-96` 的
 * `planReviewOf`：批次必须**恰好一题**、声明 `intent.kind === 'plan-review'`、
 * 带 `detail`、非多选、选项 ≤2，且 `approve` 由 `intent.approve` **按名匹配**；
 * `decline` 可缺失（只有批准选项是合法请求）。
 *
 * 之所以在本包重写而不是复用官方函数：该函数没有出现在 ui-user-questions 的 `/client`
 * 公共面上，而跨包运行值导入被 bundle 纯净度门禁禁止。规则本身**不按位置或固定文案
 * 推断**，因此与官方判定一致；官方若改规则，这里需要同步（已登记到改动记录清单）。
 */
import type { AskUserQuestionItem } from '@deepseek-ai/dsh-user-questions'

/** 一题的选项。 */
export type QuestionOption = NonNullable<AskUserQuestionItem['options']>[number]

/** 判定结果：可渲染的方案确认。 */
export interface PlanReview {
  /** 被审阅问题的 id，回传答案时原样带回。 */
  readonly id: string
  /** 问题文本，作为卡片的可访问名。 */
  readonly question: string
  /** 待确认的方案正文。 */
  readonly plan: string
  /** 批准该方案的选项。 */
  readonly approve: QuestionOption
  /** 否决该方案的选项；请求方只给了批准选项时缺省。 */
  readonly decline?: QuestionOption
}

/**
 * 把请求收窄成可渲染的方案确认，或返回 undefined 交给通用提问流程。
 * @param questions - 请求的完整问题批次。
 * @returns 收窄后的方案确认，或 undefined。
 */
// Mirrors the official predicate because client plugins cannot import another plugin runtime.
/* jscpd:ignore-start */
export function planReviewOf(questions: readonly AskUserQuestionItem[]): PlanReview | undefined {
  if (questions.length !== 1) return undefined
  const question = questions[0] as AskUserQuestionItem
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
/* jscpd:ignore-end */
