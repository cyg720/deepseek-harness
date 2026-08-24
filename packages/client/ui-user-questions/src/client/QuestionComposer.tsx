/**
 * 文件职责：实现用户提问与计划复审的 QuestionComposer 组件。
 * 技术维度：React、TypeScript、Cordis 插槽、外部 Store 和 CSS Modules。
 * 产品维度：支持用户查看或操作用户提问与计划复审。
 * 逻辑维度：读取状态，派生展示数据，处理操作并渲染界面。
 * 关键边界：异步状态、空状态、虚拟滚动和可访问性必须一致。
 * 新手阅读建议：先读 Props，再看状态选择、事件和 JSX。
 */
import { useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react'
import clsx from 'clsx'
import {
  Button, IconCheckOutline14, IconChevronDownOutline14, IconChevronLeftOutline14,
  IconChevronRightOutline14, IconChevronUpOutline14, IconCloseOutline16,
  IconEditOutline16, MarkdownText,
} from '@deepseek-ai/dsh-client-ui-primitives'
import {
  PendingQuestion, planReviewOf,
  /** 中文说明：类型或类 QuestionAnswer 约束模块数据或组件职责。 */
  type QuestionAnswer, type QuestionComposerProps,
} from './contract/slots.ts'
import { PlanReviewPanel } from './PlanReviewPanel.tsx'
import css from './QuestionComposer.module.css'

/** 中文说明：类型或类 DraftAnswer 约束模块数据或组件职责。 */
interface DraftAnswer {
  selected: string[]
  custom: string
  skipped: boolean
}

/**
 * Displayed feedback: validation feedback is stored as a dictionary KEY and
 * translated at render, so already-shown feedback follows a locale switch;
 * runtime failure messages (finished strings from the wire) pass through
 * verbatim.
 */
/** 中文说明：类型或类 Feedback 约束模块数据或组件职责。 */
type Feedback = { key: 'error.incomplete' | 'error.unanswered' } | { text: string }

/**
 * Split the conventional recommendation suffix without changing the answer value.
 * @param label - Original option label returned if selected.
 * @returns Display label plus recommendation state.
 */
/** 中文说明：函数 parseRecommendedLabel 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
export function parseRecommendedLabel(label: string): { label: string; recommended: boolean } {
  /** 中文说明：组件局部值 suffix，由紧邻初始化决定。 */
  const suffix = /\s*(?:\((?:recommended|推荐)\)|（(?:recommended|推荐)）)\s*$/i
  return suffix.test(label)
    ? { label: label.replace(suffix, ''), recommended: true }
    : { label, recommended: false }
}

/** Return whether a text-field key event belongs to an active IME composition. */
/** 中文说明：函数 isComposing 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function isComposing(event: KeyboardEvent<HTMLTextAreaElement>): boolean {
  // keyCode 229 is the legacy IME-composition signal engines emit without isComposing.
  // oxlint-disable-next-line typescript/no-deprecated
  return event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229
}

/** The free-text answer field shared by both question shapes. */
/** 中文说明：类型或类 AnswerFieldProps 约束模块数据或组件职责。 */
interface AnswerFieldProps {
  /** Which shape the field takes: the custom row's inline column, or the optionless question's own framed block. */
  variant: 'inline' | 'block'
  /** Current draft text. */
  value: string
  /** Empty-field prompt. */
  placeholder: string
  /** Whether a submission in flight has frozen the field. */
  disabled: boolean
  /** Whether this field takes focus on mount. */
  autoFocus?: boolean
  /** Called when the field takes focus. */
  onFocus?: () => void
  /** Called with each edit of the draft. */
  onChange: (event: ChangeEvent<HTMLTextAreaElement>) => void
  /** Called with each key press, before the browser's own handling. */
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void
}

/**
 * Auto-growing free-text answer: a textarea, so a long answer soft-wraps and
 * Shift+Enter breaks a line, over a hidden mirror that owns the height.
 *
 * The mirror renders the draft plus a trailing newline in normal flow and so
 * sizes the grid row (counting rows by '\n' cannot see soft wraps); the
 * textarea shares that one cell and stretches to it, and `rows={1}` keeps the
 * control's own intrinsic height out of the row sizing so the mirror alone
 * decides. Past the mirror's cap the textarea scrolls itself — it is the only
 * scrollport in the stack, there being no second glyph layer to keep aligned.
 * Mirror and textarea MUST share font, line-height, padding and wrapping rules
 * or the two heights diverge.
 *
 * @param props - field shape, draft text, and the field's event handlers.
 * @returns The mirrored auto-growing field.
 */
/** 中文说明：函数 AnswerField 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function AnswerField(props: AnswerFieldProps) {
  return (
    <div className={clsx(css.field, props.variant === 'inline' ? css.customInline : css.customBlock)}>
      <div aria-hidden className={css.fieldMirror}>{`${props.value}\n`}</div>
      <textarea
        autoFocus={props.autoFocus}
        className={css.fieldInput}
        value={props.value}
        disabled={props.disabled}
        rows={1}
        placeholder={props.placeholder}
        onFocus={props.onFocus}
        onChange={props.onChange}
        onKeyDown={props.onKeyDown}
      />
    </div>
  )
}

/**
 * Composer takeover boundary; the carrier key keys local drafts, so a
 * same-request replay (same key, new carrier object) preserves them.
 *
 * One takeover, two shapes: a request that declares a presentation intent this
 * package renders takes that shape (a plan review is one decision over one
 * plan, not a question set), and every other request takes the generic flow.
 * The routing lives here, at the one entry that owns the composer seat, so
 * neither shape can claim a request the other is already rendering.
 *
 * @param props - the selector-matched pending question carrier plus the framework standard kit.
 * @returns The question flow, or the intent's own surface, for this request.
 */
/** 中文说明：函数 QuestionComposer 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
export function QuestionComposer(props: QuestionComposerProps) {
  // Domain-face mint rides the carrier's stable identity (never minted in a
  // select/render dispatch — per-dispatch minting would churn memo identity).
  /** 中文说明：组件局部值 question，由紧邻初始化决定。 */
  const question = useMemo(() => new PendingQuestion(props.matched), [props.matched])
  /** 中文说明：组件局部值 review，由紧邻初始化决定。 */
  const review = useMemo(() => planReviewOf(question.questions), [question])
  return review === undefined
    ? <QuestionFlow key={question.key} pending={question} t={props.t} />
    : <PlanReviewPanel key={question.key} pending={question} review={review} t={props.t} />
}

/** 中文说明：函数 QuestionFlow 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function QuestionFlow({ pending, t }: { pending: PendingQuestion } & Pick<QuestionComposerProps, 't'>) {
  /** 中文说明：组件局部值 questions，由紧邻初始化决定。 */
  const questions = pending.questions
  /** 中文说明：组件局部值 [index, setIndex]，由紧邻初始化决定。 */
  const [index, setIndex] = useState(0)
  /** 中文说明：组件局部值 [drafts, setDrafts]，由紧邻初始化决定。 */
  const [drafts, setDrafts] = useState<DraftAnswer[]>(() => questions.map(() => ({
    selected: [], custom: '', skipped: false,
  })))
  /** 中文说明：组件局部值 [busy, setBusy]，由紧邻初始化决定。 */
  const [busy, setBusy] = useState<'answer' | 'cancel' | null>(null)
  /** 中文说明：组件局部值 [error, setError]，由紧邻初始化决定。 */
  const [error, setError] = useState<Feedback | null>(null)
  // Collapsed to the header strip so the conversation above stays readable
  // while the user decides; the drafts survive because the state lives here.
  /** 中文说明：组件局部值 [minimized, setMinimized]，由紧邻初始化决定。 */
  const [minimized, setMinimized] = useState(false)
  // The free-form textarea autofocuses on first presentation; re-expanding a
  // collapsed question must not steal focus from the expand toggle back into
  // the input, so focus is granted once per question index.
  /** 中文说明：组件局部值 focusedQuestions，由紧邻初始化决定。 */
  const focusedQuestions = useRef(new Set<number>())
  // index stays in bounds (every setIndex site clamps) and drafts mirrors questions 1:1.
  /** 中文说明：组件局部值 question，由紧邻初始化决定。 */
  // oxlint-disable-next-line typescript/no-non-null-assertion
  const question = questions[index]!
  /** 中文说明：组件局部值 draft，由紧邻初始化决定。 */
  // oxlint-disable-next-line typescript/no-non-null-assertion
  const draft = drafts[index]!
  /** 中文说明：组件局部值 hasOptions，由紧邻初始化决定。 */
  const hasOptions = (question.options?.length ?? 0) > 0

  /** 中文说明：组件局部值 cancelFlow，由紧邻初始化决定。 */
  const cancelFlow = (): void => {
    setBusy('cancel')
    setError(null)
    void pending.cancel().catch((cause: unknown) => {
      setBusy(null)
      setError({ text: cause instanceof Error ? cause.message : String(cause) })
    })
  }

  /** 中文说明：组件局部值 updateDraft，由紧邻初始化决定。 */
  const updateDraft = (update: (current: DraftAnswer) => DraftAnswer): void => {
    setDrafts(current => current.map((item, itemIndex) => itemIndex === index ? update(item) : item))
    setError(null)
  }

  /** 中文说明：组件局部值 choose，由紧邻初始化决定。 */
  const choose = (label: string): void => {
    updateDraft((current) => {
      if (question.multiSelect === true) {
        /** 中文说明：组件局部值 selected，由紧邻初始化决定。 */
        const selected = current.selected.includes(label)
          ? current.selected.filter(item => item !== label)
          : [...current.selected, label]
        return { ...current, selected, skipped: false }
      }
      return { selected: [label], custom: '', skipped: false }
    })
    if (question.multiSelect !== true && index < questions.length - 1) {
      setIndex(current => current + 1)
    }
  }

  /** 中文说明：组件局部值 answered，由紧邻初始化决定。 */
  const answered = (item: DraftAnswer): boolean =>
    item.selected.length > 0 || item.custom.trim() !== ''

  /** 中文说明：组件局部值 completed，由紧邻初始化决定。 */
  const completed = (item: DraftAnswer): boolean => answered(item) || item.skipped

  /** 中文说明：组件局部值 submitDrafts，由紧邻初始化决定。 */
  const submitDrafts = (values: DraftAnswer[]): void => {
    /** 中文说明：组件局部值 missing，由紧邻初始化决定。 */
    const missing = values.findIndex(item => !completed(item))
    if (missing >= 0) {
      setIndex(missing)
      setError({ key: 'error.incomplete' })
      return
    }
    /** 中文说明：组件局部值 answer，由紧邻初始化决定。 */
    const answer: QuestionAnswer = {
      answers: questions.map((item, itemIndex) => {
        /** 中文说明：组件局部值 value，由紧邻初始化决定。 */
        const value = values[itemIndex] as DraftAnswer
        if (value.skipped) return { id: item.id, selected: [] }
        /** 中文说明：组件局部值 custom，由紧邻初始化决定。 */
        const custom = value.custom.trim()
        return {
          id: item.id,
          selected: custom === '' || item.multiSelect === true ? value.selected : [],
          ...(custom === '' ? {} : { custom }),
        }
      }),
    }
    setBusy('answer')
    setError(null)
    void pending.answer(answer).catch((cause: unknown) => {
      setBusy(null)
      setError({ text: cause instanceof Error ? cause.message : String(cause) })
    })
  }

  /** 中文说明：组件局部值 continueFlow，由紧邻初始化决定。 */
  const continueFlow = (): void => {
    if (!answered(draft)) {
      setError({ key: 'error.unanswered' })
      return
    }
    if (index < questions.length - 1) {
      setIndex(current => current + 1)
      setError(null)
      return
    }
    submitDrafts(drafts)
  }

  // Shared by the inline custom field and the optionless one: a multi-select
  // draft retains checked labels, while a single-select custom answer replaces
  // its selection. Enter continues the flow, Shift+Enter breaks a line.
  /** 中文说明：组件局部值 draftCustom，由紧邻初始化决定。 */
  const draftCustom = (event: ChangeEvent<HTMLTextAreaElement>): void => {
    /** 中文说明：组件局部值 value，由紧邻初始化决定。 */
    const value = event.target.value
    updateDraft(current => ({
      ...current,
      selected: question.multiSelect === true ? current.selected : [],
      custom: value,
      skipped: false,
    }))
  }

  /** 中文说明：组件局部值 continueFromCustom，由紧邻初始化决定。 */
  const continueFromCustom = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key !== 'Enter' || event.shiftKey || isComposing(event)) return
    event.preventDefault()
    continueFlow()
  }

  /** 中文说明：组件局部值 skipQuestion，由紧邻初始化决定。 */
  const skipQuestion = (): void => {
    /** 中文说明：组件局部值 nextDrafts，由紧邻初始化决定。 */
    const nextDrafts = drafts.map((item, itemIndex) => itemIndex === index
      ? { selected: [], custom: '', skipped: true }
      : item)
    setDrafts(nextDrafts)
    setError(null)
    if (index < questions.length - 1) {
      setIndex(current => current + 1)
      return
    }
    submitDrafts(nextDrafts)
  }

  return (
    <div className={css.frame} data-question-key={pending.key}>
      <section
        className={clsx(css.card, minimized && css.cardMinimized)}
        aria-labelledby={`question-${pending.key}-${String(index)}`}
      >
        <header className={css.header}>
          <div className={css.headingBlock}>
            {question.header !== undefined && <div className={css.eyebrow}>{question.header}</div>}
            <h2 className={css.title} id={`question-${pending.key}-${String(index)}`}>
              {question.question}
            </h2>
          </div>
          <div className={css.headerActions}>
            <button
              type="button" className={css.iconButton}
              aria-label={t(minimized ? 'nav.maximize' : 'nav.minimize')}
              title={t(minimized ? 'nav.maximize' : 'nav.minimize')}
              aria-expanded={!minimized}
              disabled={busy !== null}
              onClick={() => { setMinimized(current => !current) }}
            >
              {minimized ? <IconChevronUpOutline14 /> : <IconChevronDownOutline14 />}
            </button>
            <button
              type="button" className={css.iconButton} aria-label={t('nav.cancel')}
              title={t('nav.cancel')}
              disabled={busy !== null} onClick={cancelFlow}
            >
              <IconCloseOutline16 />
            </button>
          </div>
        </header>

        {!minimized && (
          <>
            <div className={css.body} data-question-scroll>
              {question.detail !== undefined && (
                <div className={css.detail}><MarkdownText text={question.detail} /></div>
              )}
              <div className={css.options} role={question.multiSelect === true ? 'group' : 'radiogroup'}>
                {(question.options ?? []).map((option, optionIndex) => {
                  /** 中文说明：组件局部值 selected，由紧邻初始化决定。 */
                  const selected = draft.selected.includes(option.label)
                  /** 中文说明：组件局部值 display，由紧邻初始化决定。 */
                  const display = parseRecommendedLabel(option.label)
                  return (
                    <button
                      type="button" key={`${option.label}-${String(optionIndex)}`}
                      className={clsx(css.option, selected && question.multiSelect !== true && css.optionSelected)}
                      role={question.multiSelect === true ? 'checkbox' : 'radio'}
                      aria-checked={selected}
                      aria-label={display.label}
                      disabled={busy !== null}
                      onClick={() => { choose(option.label) }}
                      onKeyDown={(event) => {
                        if (event.key !== 'Enter' || !drafts.every(completed)) return
                        event.preventDefault()
                        submitDrafts(drafts)
                      }}
                    >
                      {question.multiSelect === true
                        ? (
                          <span className={clsx(css.checkbox, selected && css.checkboxChecked)} aria-hidden="true">
                            {selected && <IconCheckOutline14 size={12} />}
                          </span>
                        )
                        : <span className={css.number}>{optionIndex + 1}</span>}
                      <span className={css.optionCopy}>
                        <span className={css.optionLine}>
                          <span className={css.optionLabel}>{display.label}</span>
                          {display.recommended && (
                            <span className={css.badge}>{t('option.recommended')}</span>
                          )}
                          {option.description !== undefined && (
                            <span className={css.description}>{option.description}</span>
                          )}
                        </span>
                      </span>
                    </button>
                  )
                })}

                {hasOptions
                  ? (
                    <div className={clsx(css.customRow, draft.custom !== '' && css.customRowActive)}>
                      {question.multiSelect === true
                        ? (
                          <span
                            className={clsx(css.checkbox, draft.custom !== '' && css.checkboxChecked)}
                            aria-hidden="true"
                          >
                            {draft.custom !== '' && <IconCheckOutline14 size={12} />}
                          </span>
                        )
                        : (
                          <span className={css.number} aria-hidden="true">
                            <IconEditOutline16 size={12} />
                          </span>
                        )}
                      <AnswerField
                        variant="inline"
                        value={draft.custom}
                        disabled={busy !== null}
                        placeholder={t('custom.placeholder')}
                        onChange={draftCustom}
                        onKeyDown={continueFromCustom}
                      />
                    </div>
                  )
                  : (
                    <AnswerField
                      autoFocus={!focusedQuestions.current.has(index)}
                      variant="block"
                      value={draft.custom}
                      disabled={busy !== null}
                      placeholder={t('custom.placeholder')}
                      onFocus={() => { focusedQuestions.current.add(index) }}
                      onChange={draftCustom}
                      onKeyDown={continueFromCustom}
                    />
                  )}
              </div>
            </div>

            <footer className={css.footer}>
              <div className={css.pager}>
                <button
                  type="button" className={css.iconButton} aria-label={t('nav.prev')}
                  disabled={index === 0 || busy !== null}
                  onClick={() => { setIndex(index - 1); setError(null) }}
                >
                  <IconChevronLeftOutline14 />
                </button>
                <span className={css.progress}>{index + 1} / {questions.length}</span>
                <button
                  type="button" className={css.iconButton} aria-label={t('nav.next')}
                  disabled={index === questions.length - 1 || busy !== null}
                  onClick={() => { setIndex(index + 1); setError(null) }}
                >
                  <IconChevronRightOutline14 />
                </button>
              </div>
              <div className={css.feedback} role="status">
                {error === null ? null : 'key' in error ? t(error.key) : error.text}
              </div>
              <div className={css.footerActions}>
                <Button variant="outline" disabled={busy !== null} onClick={skipQuestion}>
                  {t('action.skip')}
                </Button>
                <Button
                  variant="primary"
                  disabled={busy !== null || !answered(draft)} onClick={continueFlow}
                >
                  {busy === 'answer'
                    ? t('submitting')
                    : index === questions.length - 1 ? t('submit') : t('action.next')}
                </Button>
              </div>
            </footer>
          </>
        )}
      </section>
    </div>
  )
}
