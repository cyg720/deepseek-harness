// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { SessionList } from '../src/client/SessionList.tsx'
import type { QsSessionListProps } from '../src/client/contract.ts'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

it('creates once for the shortcut and removes the handler when navigation unmounts', () => {
  const f = fixture()
  const view = render(<SessionList {...f.props} />)
  fireEvent.keyDown(document, { key: 'k', ctrlKey: true })
  fireEvent.keyDown(document, { key: 'k', ctrlKey: true, repeat: true })
  expect(f.props.createSession).toHaveBeenCalledTimes(1)
  view.unmount()
  fireEvent.keyDown(document, { key: 'k', ctrlKey: true })
  expect(f.props.createSession).toHaveBeenCalledTimes(1)
})

function fixture() {
  const createSession = vi.fn((_signal: AbortSignal) => Promise.resolve(false))
  const props = {
    t: (key: keyof typeof zh) => zh[key],
    useSessions: (select: (value: { ids: readonly string[]; byId: object }) => unknown) => select({ ids: [], byId: {} }),
    useStore: () => [], useQsArchivedSessions: () => [], useSessionPendingInteraction: () => new Set(),
    createSession,
  } as unknown as QsSessionListProps // Empty navigation has no row actions or Session seats.
  return { props, createSession }
}

it('shows a failed creation and makes retry available', async () => {
  const f = fixture()
  f.createSession.mockResolvedValueOnce(false).mockResolvedValueOnce(true)
  render(<SessionList {...f.props} />)
  fireEvent.click(screen.getByRole('button', { name: /新建会话/ }))
  await screen.findByRole('alert')
  expect(screen.getByRole<HTMLButtonElement>('button', { name: /新建会话/ }).disabled).toBe(false)
  fireEvent.click(screen.getByRole('button', { name: /新建会话/ }))
  await waitFor(() => { expect(screen.queryByRole('alert')).toBeNull() })
  expect(f.createSession).toHaveBeenCalledTimes(2)
})

it('aborts the local navigation intent when the list unmounts', () => {
  const f = fixture()
  f.createSession.mockImplementation(() => new Promise(() => {}))
  const view = render(<SessionList {...f.props} />)
  fireEvent.click(screen.getByRole('button', { name: /新建会话/ }))
  view.unmount()
  expect(f.createSession.mock.calls[0]?.[0].aborted).toBe(true)
})

it('opens a fresh draft when the managed session changes', () => {
  const original = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal')
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true,
    value: function (this: HTMLDialogElement) { this.setAttribute('open', '') } })
  try {
    const f = fixture()
    const props = { ...f.props,
      useSessions: (select: (value: object) => unknown) => select({ ids: ['A', 'B'], current: 'A',
        byId: { A: { displayTitle: 'Title A' }, B: { displayTitle: 'Title B' } } }),
      useSessionPendingInteraction: (select: (value: Map<string, never>) => unknown) => select(new Map<string, never>()),
      canArchive: () => true,
    } as unknown as QsSessionListProps // Host snapshots only supply the fields consumed by this navigation.
    render(<SessionList {...props} />)
    fireEvent.click(screen.getByRole('button', { name: `${zh['row.manage']} Title A` }))
    fireEvent.click(screen.getByRole('button', { name: zh['menu.rename'] }))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Unsaved A' } })
    fireEvent.click(screen.getByRole('button', { name: `${zh['row.manage']} Title B` }))
    expect(screen.queryByRole('textbox')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: zh['menu.rename'] }))
    expect(screen.getByRole<HTMLInputElement>('textbox').value).toBe('Title B')
  } finally {
    cleanup()
    if (original === undefined) Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal')
    else Object.defineProperty(HTMLDialogElement.prototype, 'showModal', original)
  }
})
