/**
 * 提问卡：多问题批次、单选 / 多选 / 自由填写，以及仅批准选项的 plan-review。
 *
 * plan-review 的判定完全交给官方的 `planReviewOf`（单问题 + 带 detail + 非多选 +
 * 选项 ≤2 + `approve` 由 `intent.approve` 按名匹配，`decline` 可缺失）——本包不按
 * 位置或固定文案推断。
 *
 * 请求隔离：chain 的渲染 key 是插件条目，同一会话换请求时本组件不卸载。因此
 * **草稿与提交状态都按 `sessionId + pending.key` 归属**：草稿由 apply 持有的内存表
 * 承载（切走会话再回来仍在，HMR 后丢失），提交中/失败状态挂在以请求 key 为 key 的
 * 内层组件上。
 */
import { useMemo, useRef, useState, type ReactNode } from 'react'
import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import { planReviewOf } from './plan-review.ts'
import { draftKey } from './contract.ts'
import type { AskUserQuestionItem } from '@deepseek-ai/dsh-user-questions'
import {
  buildAnswer, EMPTY_DRAFT, isAnswered, toggleOption, writeCustom, type QuestionDraft,
} from './answer.ts'
import type { QsQuestionCardProps } from './contract.ts'
import styles from './questions.module.css'

/**
 * 渲染提问卡。
 * @param props - chain 选举出的待答复请求与语言座席。
 * @returns 提问卡或方案确认卡。
 */
export function QuestionCard(props: QsQuestionCardProps): ReactNode {
  return <QuestionCardBody key={props.matched.key} {...props} />
}

/** 单条请求的卡片主体；状态生命周期与 `matched.key` 一致。 */
function QuestionCardBody({ matched, sessionId, useQuestionDraft, writeDraft, clearDrafts, t }: QsQuestionCardProps): ReactNode {
  // 整表快照（引用稳定），再按本请求切出自己那一份；不重新构造快照以免触发重渲染循环。
  const allDrafts = useQuestionDraft(map => map)
  const drafts = useMemo(() => {
    const scoped = new Map<string, QuestionDraft>()
    for (const question of matched.questions) {
      const draft = allDrafts.get(draftKey(sessionId, matched.key, question.id))
      if (draft !== undefined) scoped.set(question.id, draft)
    }
    return scoped
  }, [allDrafts, sessionId, matched])
  const [submitting, setSubmitting] = useState(false)
  const [failed, setFailed] = useState(false)
  const card = useRef<HTMLElement>(null)
  const [validation, setValidation] = useState(false)

  const markdownLabels = useMemo(() => ({ code: { copyLabel: t('markdown.copy'), copiedLabel: t('markdown.copied') }, footnotes: t('markdown.footnotes') }), [t])
  const review = planReviewOf(matched.questions)

  const submit = (answer: Parameters<typeof matched.answer>[0]): void => {
    if (submitting) return
    setSubmitting(true)
    setFailed(false)
    matched.answer(answer).then(() => { clearDrafts(sessionId, matched.key) }).catch((error: unknown) => {
      // 请求仍然 pending：恢复可点击并提示，让用户重试（chain 不退位）。
      console.error('qs-questions: answer failed', error)
      setFailed(true)
      setSubmitting(false)
    })
  }

  const setDraft = (id: string, next: QuestionDraft): void => { writeDraft(sessionId, matched.key, id, next) }

  if (review !== undefined) {
    return (
      <section className={styles.card} data-qs-plan-card aria-labelledby="qs-plan-title">
        <div className={styles.eyebrow}>{t('plan.eyebrow')}</div>
        <h3 id="qs-plan-title">{review.question}</h3>
        <div className={styles.detail} tabIndex={0} role="region" aria-label={review.question}>
          <MarkdownText text={review.plan} labels={markdownLabels} />
        </div>
        {failed ? <p className={styles.error} role="alert">{t('card.error')}</p> : null}
        <div className={styles.actions}>
          {review.decline === undefined ? null : (
            <button
              type="button"
              className={`qs-btn ${styles.reject}`}
              disabled={submitting}
              onClick={() => { submit({ answers: [{ id: review.id, selected: [review.decline?.label ?? ''] }] }) }}
            >
              {review.decline.label || t('plan.decline')}
            </button>
          )}
          <button
            type="button"
            className="qs-btn qs-btn-primary"
            disabled={submitting}
            onClick={() => { submit({ answers: [{ id: review.id, selected: [review.approve.label] }] }) }}
          >
            {submitting ? t('card.submitting') : review.approve.label || t('plan.approve')}
          </button>
        </div>
      </section>
    )
  }

  const submitForm = (): void => {
    const unanswered = matched.questions.some(
      question => !isAnswered(drafts.get(question.id) ?? EMPTY_DRAFT),
    )
    if (unanswered) {
      setValidation(true)
      const fields = card.current?.querySelectorAll('fieldset')
      const index = matched.questions.findIndex(question => !isAnswered(drafts.get(question.id) ?? EMPTY_DRAFT))
      fields?.[index]?.querySelector<HTMLElement>('input, textarea')?.focus()
      return
    }
    setValidation(false)
    submit(buildAnswer(matched.questions, drafts))
  }

  return (
    <section ref={card} className={styles.card} data-qs-question-card aria-labelledby="qs-question-title">
      <div className={styles.eyebrow}>{t('card.eyebrow')}</div>
      <h3 id="qs-question-title" className="qs-sr-only">{t('card.eyebrow')}</h3>
      {matched.questions.map(question => (
        <QuestionField
          key={question.id}
          question={question}
          draft={drafts.get(question.id) ?? EMPTY_DRAFT}
          invalid={validation && !isAnswered(drafts.get(question.id) ?? EMPTY_DRAFT)}
          disabled={submitting}
          labels={{ other: t('card.other'), placeholder: t('card.otherPlaceholder') }}
          onChange={(next) => { setDraft(question.id, next) }}
        />
      ))}
      {validation ? <p id="qs-question-validation" className={styles.error} role="alert">{t('card.answerAll')}</p> : null}
      {failed ? <p className={styles.error} role="alert">{t('card.error')}</p> : null}
      <p className={styles.note}>{t('card.pendingNote')}</p>
      <div className={styles.actions}>
        <button type="button" className="qs-btn qs-btn-primary" disabled={submitting} onClick={submitForm}>
          {submitting ? t('card.submitting') : failed ? t('card.retry') : t('card.submit')}
        </button>
      </div>
    </section>
  )
}

interface QuestionFieldProps {
  readonly question: AskUserQuestionItem
  readonly draft: QuestionDraft
  readonly invalid: boolean
  readonly disabled: boolean
  readonly labels: { readonly other: string; readonly placeholder: string }
  readonly onChange: (next: QuestionDraft) => void
}

/** 一题的作答区：选项、单选/多选、自由填写。 */
function QuestionField(props: QuestionFieldProps): ReactNode {
  const { question, draft, invalid, disabled, labels, onChange } = props
  const options = question.options ?? []
  return (
    <fieldset aria-describedby={invalid ? 'qs-question-validation' : undefined} aria-invalid={invalid} className={styles.question} data-invalid={invalid ? 'true' : undefined}>
      <legend>{question.header === undefined ? question.question : `${question.header} · ${question.question}`}</legend>
      {question.detail === undefined ? null : <p className={styles.questionDetail}>{question.detail}</p>}
      {options.map(option => (
        <label key={option.label} className={styles.option}>
          <input
            type={question.multiSelect === true ? 'checkbox' : 'radio'}
            name={`qs-question-${question.id}`}
            checked={draft.selected.includes(option.label)}
            disabled={disabled}
            onChange={() => { onChange(toggleOption(question, draft, option.label)) }}
          />
          <span>
            <strong>{option.label}</strong>
            {option.description === undefined ? null : <small>{option.description}</small>}
          </span>
        </label>
      ))}
      <label className={`qs-field ${styles.other}`}>
        <span>{labels.other}</span>
        <textarea
          value={draft.custom}
          disabled={disabled}
          placeholder={labels.placeholder}
          onChange={(event) => { onChange(writeCustom(question, draft, event.target.value)) }}
        />
      </label>
    </fieldset>
  )
}
