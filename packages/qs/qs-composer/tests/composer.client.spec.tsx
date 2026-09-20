// @vitest-environment jsdom
/** Composer lifecycle regressions with a deferred Host creation response. */
import { useSyncExternalStore } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { Composer } from '../src/client/Composer.tsx'
import type { QsComposerProps, QsComposerSnapshot } from '../src/client/contract.ts'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

function fixture() {
  let state: QsComposerSnapshot = { frozen: false, unownedDraft: '' }
  const listeners = new Set<() => void>()
  const publish = (next: QsComposerSnapshot) => { state = next; for (const listener of listeners) listener() }
  const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
  let settle: (id: string | undefined) => void = () => {}
  const createSession = vi.fn((_id: string, _signal: AbortSignal) => new Promise<string | undefined>((resolve) => { settle = resolve }))
  const setFrozen = vi.fn((reason: 'sending' | undefined) => { publish({ ...state, frozen: reason !== undefined }) })
  const rows: readonly never[] = []
  const props = {
    t: (key: keyof typeof zh) => zh[key],
    useQsComposer: (select: (value: QsComposerSnapshot) => unknown) => select(useSyncExternalStore(subscribe, () => state)),
    useQsQueue: (select: (value: readonly never[]) => unknown) => select(rows),
    useInput: () => undefined, useSession: () => undefined,
    useSessionPendingInteraction: () => undefined,
    useQsConnected: () => true, useQsBlocked: () => undefined,
    useQsNotice: () => undefined, useQsModel: () => undefined,
    loadModel: () => {}, stop: vi.fn(),
    reserveSessionId: () => 'reserved-session', createSession,
    setUnownedDraft: (text: string) => { publish({ ...state, unownedDraft: text }) }, setFrozen,
    removeQueueItem: vi.fn(), steerQueueItem: vi.fn(), editQueueItem: vi.fn(),
  } as unknown as QsComposerProps // Renderer seats are absent in the no-session fixture.
  return { props, createSession, setFrozen, settle: (id: string | undefined) => { settle(id) } }
}

it('keeps the draft and reserved identity after creation failure', async () => {
  const f = fixture()
  render(<Composer {...f.props} />)
  fireEvent.change(screen.getByRole<HTMLTextAreaElement>('textbox'), { target: { value: 'retained draft' } })
  fireEvent.click(screen.getByRole('button', { name: zh['input.send'] }))
  await act(async () => { f.settle(undefined) })
  expect(screen.getByRole('alert').textContent).toBe(zh['input.createFailed'])
  expect((screen.getByRole<HTMLTextAreaElement>('textbox')).value).toBe('retained draft')
  fireEvent.click(screen.getByRole('button', { name: zh['input.send'] }))
  expect(f.createSession.mock.calls.map(call => call[0])).toEqual(['reserved-session', 'reserved-session'])
})

it('aborts creation when cancelled and ignores its late response', async () => {
  const f = fixture()
  render(<Composer {...f.props} />)
  fireEvent.change(screen.getByRole<HTMLTextAreaElement>('textbox'), { target: { value: 'cancel me' } })
  fireEvent.click(screen.getByRole('button', { name: zh['input.send'] }))
  const signal = f.createSession.mock.calls[0]?.[1]
  fireEvent.click(screen.getByRole('button', { name: zh['input.cancel'] }))
  expect(signal?.aborted).toBe(true)
  await act(async () => { f.settle('reserved-session') })
  expect((screen.getByRole<HTMLTextAreaElement>('textbox')).readOnly).toBe(false)
  expect((screen.getByRole<HTMLTextAreaElement>('textbox')).value).toBe('cancel me')
})

it('unmount aborts creation and clears the shell freeze', async () => {
  const f = fixture()
  const view = render(<Composer {...f.props} />)
  fireEvent.change(screen.getByRole<HTMLTextAreaElement>('textbox'), { target: { value: 'keep on logout' } })
  fireEvent.click(screen.getByRole('button', { name: zh['input.send'] }))
  view.unmount()
  expect(f.createSession.mock.calls[0]?.[1].aborted).toBe(true)
  expect(f.setFrozen).toHaveBeenLastCalledWith(undefined)
  await act(async () => { f.settle(undefined) })
  render(<Composer {...f.props} />)
  await waitFor(() => { expect((screen.getByRole<HTMLTextAreaElement>('textbox')).readOnly).toBe(false) })
})

it('blocks disconnected submission without making the draft readonly', () => {
  const f = fixture()
  render(<Composer {...f.props} useQsConnected={() => false as never} />)
  fireEvent.change(screen.getByRole<HTMLTextAreaElement>('textbox'), { target: { value: 'offline draft' } })
  fireEvent.keyDown(screen.getByRole<HTMLTextAreaElement>('textbox'), { key: 'Enter' })
  expect(f.createSession).not.toHaveBeenCalled()
  expect((screen.getByRole<HTMLTextAreaElement>('textbox')).readOnly).toBe(false)
  expect(screen.getByRole('status').textContent).toBe(zh['input.disconnected'])
})

it('keeps the first draft editable and requires another click after a blocked handoff recovers', async () => {
  const f = fixture()
  const view = render(<Composer {...f.props} />)
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'review before sending' } })
  fireEvent.click(screen.getByRole('button', { name: zh['input.send'] }))
  const setDraft = vi.fn()
  const submit = vi.fn()
  const inputActions = { setDraft, submit } as unknown as NonNullable<QsComposerProps['inputActions']>
  const bound: QsComposerProps = { ...f.props, sessionId: 'reserved-session' as QsComposerProps['sessionId'], inputActions }
  view.rerender(<Composer {...bound} useQsConnected={() => false as never} />)
  await act(async () => { f.settle('reserved-session') })
  view.rerender(<Composer {...bound} />)
  expect(submit).not.toHaveBeenCalled()
  expect(setDraft).toHaveBeenCalledWith('review before sending')
  expect(screen.getByRole<HTMLTextAreaElement>('textbox').readOnly).toBe(false)
})
