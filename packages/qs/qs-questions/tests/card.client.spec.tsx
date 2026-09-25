// @vitest-environment jsdom
import { useSyncExternalStore } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { QuestionCard } from '../src/client/QuestionCard.tsx'
import { draftKey, type QsQuestionCardProps, type QsQuestionDraftMap } from '../src/client/contract.ts'
import type { QuestionDraft } from '../src/client/answer.ts'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

/** 插件重建后旧失败仅属于旧组件，不能禁用新实例或消费它的新答案。 */
it('keeps a remounted question card usable after the previous submission rejects', async () => {
  const old = fixture()
  const pending = Promise.withResolvers<undefined>()
  old.answer.mockReturnValueOnce(pending.promise)
  const previous = render(<QuestionCard {...old.props} />)
  for (const field of screen.getAllByRole('textbox')) fireEvent.change(field, { target: { value: 'old draft' } })
  fireEvent.click(screen.getByRole('button', { name: zh['card.submit'] }))
  expect(old.answer).toHaveBeenCalledOnce()
  previous.unmount()
  const current = fixture()
  render(<QuestionCard {...current.props} />)
  for (const field of screen.getAllByRole('textbox')) fireEvent.change(field, { target: { value: 'new draft' } })
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  try {
    await act(async () => { pending.reject(new Error('old transport failed')) })
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getAllByRole<HTMLTextAreaElement>('textbox').map(field => field.value)).toEqual(['new draft', 'new draft'])
    expect(old.props.clearDrafts).not.toHaveBeenCalled()
    expect(current.props.clearDrafts).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: zh['card.submit'] }))
    await waitFor(() => { expect(current.props.clearDrafts).toHaveBeenCalledOnce() })
    expect(current.answer).toHaveBeenCalledExactlyOnceWith({ answers: [
      { id: 'one', selected: [], custom: 'new draft' }, { id: 'two', selected: [], custom: 'new draft' },
    ] })
  } finally { error.mockRestore() }
})

it.each(['Proceed', 'Decline'])('submits the named plan choice %s and prevents duplicate answers while pending', async (choice) => {
  const { props, answer } = fixture()
  let finish!: () => void
  answer.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve }))
  const matched = { key: 'plan', answer, questions: [{ id: 'plan', question: 'Review', detail: 'Plan', options: [{ label: 'Proceed' }, { label: 'Decline' }], intent: { kind: 'plan-review' as const, approve: 'Proceed' } }] }
  render(<QuestionCard {...props} matched={matched as unknown as QsQuestionCardProps['matched']} />)
  fireEvent.click(screen.getByRole('button', { name: choice }))
  expect(answer).toHaveBeenCalledExactlyOnceWith({ answers: [{ id: 'plan', selected: [choice] }] })
  expect(screen.getAllByRole<HTMLButtonElement>('button').every(button => button.disabled)).toBe(true)
  finish()
  await waitFor(() => { expect(props.clearDrafts).toHaveBeenCalledWith('session', 'plan') })
})

it('keeps a new question request editable while an earlier request settles', async () => {
  const { props, answer } = fixture()
  let fail!: (reason: Error) => void
  answer.mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { fail = reject }))
  const view = render(<QuestionCard {...props} />)
  for (const field of screen.getAllByRole('textbox')) fireEvent.change(field, { target: { value: 'old answer' } })
  fireEvent.click(screen.getByRole('button', { name: zh['card.submit'] }))
  const next = { questions: props.matched.questions, key: 'next-request', answer: vi.fn().mockResolvedValue(undefined) }
  view.rerender(<QuestionCard {...props} matched={next as unknown as QsQuestionCardProps['matched']} />)
  fail(new Error('old request failed'))
  await waitFor(() => { expect(screen.getByRole<HTMLButtonElement>('button', { name: zh['card.submit'] }).disabled).toBe(false) })
  expect(screen.queryByRole('alert')).toBeNull()
  expect(screen.getAllByRole<HTMLTextAreaElement>('textbox').every(field => field.value === '')).toBe(true)
  expect(next.answer).not.toHaveBeenCalled()
})

it('submits only the selected option after replacing a custom single-choice answer', async () => {
  const { props, answer } = fixture()
  const matched = { key: props.matched.key, answer, questions: [{ id: 'one', question: 'Choose', options: [{ label: 'Option B' }] }] }
  render(<QuestionCard {...props} matched={matched as unknown as QsQuestionCardProps['matched']} />)
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Discarded custom answer' } })
  fireEvent.click(screen.getByRole('radio', { name: 'Option B' }))
  fireEvent.click(screen.getByRole('button', { name: zh['card.submit'] }))
  await waitFor(() => { expect(answer).toHaveBeenCalledExactlyOnceWith({ answers: [{ id: 'one', selected: ['Option B'] }] }) })
  expect(screen.getByRole<HTMLTextAreaElement>('textbox').value).toBe('')
})

function fixture() {
  const answer = vi.fn().mockResolvedValue(undefined)
  let drafts: QsQuestionDraftMap = new Map()
  const listeners = new Set<() => void>()
  const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn) } }
  const props = {
    sessionId: 'session',
    matched: { key: 'request', questions: [{ id: 'one', question: 'First question' }, { id: 'two', question: 'Second question' }], answer },
    t: (key: keyof typeof zh) => zh[key],
    useQuestionDraft: (select: (value: QsQuestionDraftMap) => unknown) => select(useSyncExternalStore(subscribe, () => drafts)),
    writeDraft: (session: string, request: string, id: string, draft: QuestionDraft) => {
      drafts = new Map(drafts).set(draftKey(session, request, id), draft)
      for (const listener of listeners) listener()
    },
    clearDrafts: vi.fn(),
  } as unknown as QsQuestionCardProps // Only the seats consumed by this card are supplied.
  return { props, answer }
}

it('focuses the first unanswered field and submits the whole answered batch', async () => {
  const { props, answer } = fixture()
  render(<QuestionCard {...props} />)
  const fields = screen.getAllByRole<HTMLTextAreaElement>('textbox')
  fireEvent.change(fields[0]!, { target: { value: 'first answer' } })
  fireEvent.click(screen.getByRole('button', { name: zh['card.submit'] }))
  expect(document.activeElement).toBe(fields[1])
  expect(fields[1]?.closest('fieldset')?.getAttribute('aria-describedby')).toBe('qs-question-validation')
  expect(answer).not.toHaveBeenCalled()
  fireEvent.change(fields[1]!, { target: { value: 'second answer' } })
  fireEvent.click(screen.getByRole('button', { name: zh['card.submit'] }))
  await waitFor(() => { expect(props.clearDrafts).toHaveBeenCalledWith('session', 'request') })
  expect(answer).toHaveBeenCalledExactlyOnceWith({ answers: [
    { id: 'one', selected: [], custom: 'first answer' }, { id: 'two', selected: [], custom: 'second answer' },
  ] })
})

it('retains answers after a rejected submission and allows retry', async () => {
  const { props, answer } = fixture()
  answer.mockRejectedValueOnce(new Error('offline'))
  render(<QuestionCard {...props} />)
  for (const field of screen.getAllByRole('textbox')) fireEvent.change(field, { target: { value: 'kept' } })
  fireEvent.click(screen.getByRole('button', { name: zh['card.submit'] }))
  await screen.findByRole('button', { name: zh['card.retry'] })
  expect(screen.getAllByRole<HTMLTextAreaElement>('textbox').map(field => field.value)).toEqual(['kept', 'kept'])
  fireEvent.click(screen.getByRole('button', { name: zh['card.retry'] }))
  await waitFor(() => { expect(props.clearDrafts).toHaveBeenCalledOnce() })
})

it('renders plan Markdown with safe links and keyboard-scrollable details', () => {
  const { props, answer } = fixture()
  const matched = { key: 'plan-request', answer, questions: [{ id: 'plan', question: 'Review', detail: '**Ready** [bad](javascript:alert(1))', options: [{ label: 'Proceed' }], intent: { kind: 'plan-review', approve: 'Proceed' } }] }
  render(<QuestionCard {...props} matched={matched as unknown as QsQuestionCardProps['matched']} />)
  expect(screen.getByText('Ready').tagName).toBe('STRONG')
  expect(screen.getAllByRole('region', { name: 'Review' }).some(region => region.tabIndex === 0)).toBe(true)
  expect(document.querySelector('a[href^="javascript:"]')).toBeNull()
  expect(screen.getByRole('button', { name: 'Proceed' })).toBeTruthy()
})

/** 题目标题、说明、多选和方案失败分支都必须保留实际答案载荷。 */
it('多选题显示说明并同时提交选项和补充文本', async () => {
  const { props, answer } = fixture()
  const matched = { key: props.matched.key, answer, questions: [{ id: 'one', header: 'Scope', question: 'Choose', detail: 'Choose all', multiSelect: true, options: [{ label: 'A', description: 'First' }, { label: 'B' }] }] }
  render(<QuestionCard {...props} matched={matched as unknown as QsQuestionCardProps['matched']} />)
  expect(screen.getByText('Scope · Choose')).toBeDefined()
  expect(screen.getByText('Choose all')).toBeDefined()
  fireEvent.click(screen.getAllByRole('checkbox')[0]!)
  fireEvent.click(screen.getByRole('checkbox', { name: 'B' }))
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'extra' } })
  fireEvent.click(screen.getByRole('button', { name: zh['card.submit'] }))
  await waitFor(() => { expect(answer).toHaveBeenCalledExactlyOnceWith({ answers: [{ id: 'one', selected: ['A', 'B'], custom: 'extra' }] }) })
})
it('方案答复失败显示提示并允许重新批准', async () => {
  const { props, answer } = fixture()
  answer.mockRejectedValueOnce(new Error('offline'))
  const matched = { key: 'plan', answer, questions: [{ id: 'plan', question: 'Review', detail: 'Plan', options: [{ label: '' }], intent: { kind: 'plan-review', approve: '' } }] }
  render(<QuestionCard {...props} matched={matched as unknown as QsQuestionCardProps['matched']} />)
  fireEvent.click(screen.getByRole('button', { name: zh['plan.approve'] }))
  await screen.findByRole('alert')
  fireEvent.click(screen.getByRole('button', { name: zh['plan.approve'] }))
  expect(answer).toHaveBeenCalledTimes(2)
  expect(answer).toHaveBeenLastCalledWith({ answers: [{ id: 'plan', selected: [''] }] })
})

/** 空拒绝文案只使用本地化标签展示，答案仍保留原选项值。 */
it('同批方案答复只提交一次并保留空标签载荷', async () => {
  const { props, answer } = fixture()
  const pending = Promise.withResolvers<undefined>()
  answer.mockReturnValue(pending.promise)
  const matched = { key: 'plan', answer, questions: [{ id: 'plan', question: 'Review', detail: 'Plan', options: [{ label: 'Proceed' }, { label: '' }], intent: { kind: 'plan-review', approve: 'Proceed' } }] }
  render(<QuestionCard {...props} matched={matched as unknown as QsQuestionCardProps['matched']} />)
  const button = screen.getByRole('button', { name: zh['plan.decline'] })
  act(() => { button.click(); button.click() })
  expect(answer).toHaveBeenCalledExactlyOnceWith({ answers: [{ id: 'plan', selected: [''] }] })
  await act(async () => { pending.resolve(undefined); await pending.promise })
  expect(props.clearDrafts).toHaveBeenCalledOnce()
})
