/**
 * ask_user_question 视图：历史问答只读展示。
 *
 * 本卡不创建第二个回答表单：待回答交互由 qs-composer 的固定待回答座位承载。
 * 取消与中断有各自的结论文案（取消按成功态呈现、中断按已中断呈现），与官方一致。
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ReactNode } from 'react'
import type { ToolCallBlock } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { QsToolviewProps } from '../contract.ts'
import { callHead, isSettled, parseArgs, singleText } from '../raw-tool-call.ts'
import { registerToolview, type ToolviewComponent } from '../toolview-registration.ts'
import { GenericToolCard } from './generic.tsx'
import styles from '../tool.module.css'

/** 一个问题定义。 */
export interface AskQuestionEntry {
  /** 稳定提问 id，回答按它回传。 */
  readonly id: string
  /** 问题正文。 */
  readonly question: string
}

/** 一条已配对回答。 */
export interface AskAnswerEntry {
  /** 对应提问 id。 */
  readonly id: string
  /** 问题正文。 */
  readonly question: string
  /** 选中项与自定义回答，按官方顺序合并。 */
  readonly answers: readonly string[]
}

/** `ask_user_question` 的视图模型。 */
export type AskCardModel =
  | { readonly kind: 'waiting'; readonly questions: readonly AskQuestionEntry[] }
  | { readonly kind: 'answered'; readonly pairs: readonly AskAnswerEntry[]; readonly total: number }
  | { readonly kind: 'unresolved'; readonly verdict: 'cancelled' | 'interrupted'; readonly questions: readonly AskQuestionEntry[] }
  | { readonly kind: 'counted'; readonly answered: number; readonly total: number }

/**
 * 读取提问定义。
 * @param argsRaw - 原始参数文本。
 * @returns 提问列表；无提问、缺 id/正文或 id 重复时为 undefined。
 */
function questionEntries(argsRaw: string): AskQuestionEntry[] | undefined {
  const questions = parseArgs(argsRaw)?.questions
  if (!Array.isArray(questions) || questions.length === 0) return undefined
  const entries: AskQuestionEntry[] = []
  const seen = new Set<string>()
  for (const question of questions) {
    if (typeof question !== 'object' || question === null) return undefined
    const entry = question as { id?: unknown; question?: unknown }
    if (typeof entry.id !== 'string' || typeof entry.question !== 'string') return undefined
    if (seen.has(entry.id)) return undefined
    seen.add(entry.id)
    entries.push({ id: entry.id, question: entry.question })
  }
  return entries
}

/**
 * 读取回答条目。
 * @param text - 结果正文（官方写成 `{"answers":[...]}` 的 JSON）。
 * @returns 回答列表；结构不符时为 undefined。
 */
function answerEntries(text: string): { id: string; selected: readonly string[]; custom: string | undefined }[] | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    // 无法解析的结果交给兜底卡保留原文，不能声称没有回答。
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined
  const answers = (parsed as { readonly answers?: unknown }).answers
  if (!Array.isArray(answers)) return undefined
  const entries: { id: string; selected: readonly string[]; custom: string | undefined }[] = []
  for (const answer of answers) {
    if (typeof answer !== 'object' || answer === null) return undefined
    const entry = answer as { id?: unknown; selected?: unknown; custom?: unknown }
    if (typeof entry.id !== 'string' || !Array.isArray(entry.selected)) return undefined
    if (!entry.selected.every((item): item is string => typeof item === 'string')) return undefined
    if (entry.custom !== undefined && typeof entry.custom !== 'string') return undefined
    entries.push({ id: entry.id, selected: entry.selected, custom: entry.custom })
  }
  return entries
}

/**
 * 按 id 严格配对提问与回答；任一处不匹配即放弃配对。
 * @param questions - 提问列表。
 * @param answers - 回答列表。
 * @returns 配对结果；无法逐一配对时为 undefined。
 */
function pairAnswers(
  questions: readonly AskQuestionEntry[],
  answers: readonly { id: string; selected: readonly string[]; custom: string | undefined }[],
): AskAnswerEntry[] | undefined {
  if (questions.length !== answers.length) return undefined
  const byId = new Map<string, { selected: readonly string[]; custom: string | undefined }>()
  for (const answer of answers) {
    if (byId.has(answer.id)) return undefined
    byId.set(answer.id, answer)
  }
  const pairs: AskAnswerEntry[] = []
  for (const question of questions) {
    const answer = byId.get(question.id)
    if (answer === undefined) return undefined
    pairs.push({
      id: question.id,
      question: question.question,
      answers: [...answer.selected, ...(answer.custom === undefined || answer.custom === '' ? [] : [answer.custom])],
    })
  }
  return pairs
}

/**
 * 构建提问模型。
 *
 * 取消（`ASK_CANCELLED`）与中断（`ASK_ABORTED`）按官方语义分别呈现；未结算为等待回答；
 * 有效结果无法严格配对时按结果条目计数；无法解析的结果回落兜底卡。
 * @param block - 运行头或结算结果。
 * @returns 视图模型；参数不符契约时为 undefined。
 */
export function askCardModel(block: ToolCallBlock): AskCardModel | undefined {
  const head = callHead(block)
  if (head === undefined) return undefined
  const questions = questionEntries(head.argsRaw)
  if (questions === undefined) return undefined
  if (!isSettled(block)) return { kind: 'waiting', questions }
  const code = block.error?.code
  if (code === 'ASK_CANCELLED') return { kind: 'unresolved', verdict: 'cancelled', questions }
  if (code === 'ASK_ABORTED') return { kind: 'unresolved', verdict: 'interrupted', questions }
  if (block.isError) return undefined
  const text = singleText(block)
  const answers = text === undefined ? undefined : answerEntries(text)
  if (answers === undefined) return undefined
  const pairs = pairAnswers(questions, answers)
  // 与官方历史摘要一致：计数来自实际返回条目，不根据提问数量补造答案。
  if (pairs === undefined) return {
    kind: 'counted',
    answered: answers.filter(answer => answer.selected.length > 0 || (answer.custom ?? '') !== '').length,
    total: answers.length,
  }
  return { kind: 'answered', pairs, total: questions.length }
}

/** 提问视图组件：模型不成立时回落兜底卡。 */
export const AskQuestionToolview: ToolviewComponent = ({ block, t }: QsToolviewProps): ReactNode => {
  const model = askCardModel(block)
  if (model === undefined) return <GenericToolCard block={block} t={t} />
  if (model.kind === 'waiting') {
    return (
      <div data-qs-tool-ask>
        <p className={styles.notice}>{t('ask.waiting')}</p>
        <QuestionList questions={model.questions} />
        <p className={styles.notice}>{t('ask.readOnly')}</p>
      </div>
    )
  }
  if (model.kind === 'unresolved') {
    return (
      <div data-qs-tool-ask>
        <p className={styles.notice}>
          {t(model.verdict === 'cancelled' ? 'ask.cancelledDetail' : 'ask.interruptedDetail')}
        </p>
        <QuestionList questions={model.questions} />
        <p className={styles.notice}>{t('ask.readOnly')}</p>
      </div>
    )
  }
  if (model.kind === 'counted') {
    return (
      <div data-qs-tool-ask>
        <p className={styles.notice}>{t('ask.answered', { answered: model.answered, total: model.total })}</p>
        <p className={styles.notice}>{t('ask.readOnly')}</p>
      </div>
    )
  }
  return (
    <div data-qs-tool-ask>
      <dl className={styles.askList}>
        {model.pairs.map(pair => (
          <div key={pair.id}>
            <dt data-ask-id={pair.id}>{pair.question}</dt>
            <dd className={styles.askAnswer}>
              {pair.answers.length === 0 ? t('ask.skipped') : pair.answers.join('、')}
            </dd>
          </div>
        ))}
      </dl>
      <p className={styles.notice}>{t('ask.readOnly')}</p>
    </div>
  )
}

/** 提问列表（只读）。 */
function QuestionList({ questions }: { readonly questions: readonly AskQuestionEntry[] }): ReactNode {
  return (
    <ul className={styles.askList}>
      {questions.map(question => (
        <li key={question.id} className={styles.askQuestion}>{question.question}</li>
      ))}
    </ul>
  )
}

/** ask_user_question 视图插件。 */
export const askQuestionToolview = {
  name: 'qs-ask-question-toolview',
  inject: ['slots'],
  /** 注册 ask_user_question 键。 */
  apply(ctx: ClientContext): void {
    registerToolview(ctx, 'ask_user_question', AskQuestionToolview)
  },
}
