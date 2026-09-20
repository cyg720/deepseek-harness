// @vitest-environment jsdom
import { useSyncExternalStore } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { QuestionCard } from '../src/client/QuestionCard.tsx'
import { draftKey, type QsQuestionCardProps, type QsQuestionDraftMap } from '../src/client/contract.ts'
import type { QuestionDraft } from '../src/client/answer.ts'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

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
