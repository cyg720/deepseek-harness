// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { SessionMenu } from '../src/client/SessionMenu.tsx'
import { zh } from '../src/client/locales.ts'

const dialogMethods = new Map(['showModal', 'close'].map(name => [name, Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, name)]))
beforeEach(() => {
  for (const name of dialogMethods.keys()) Object.defineProperty(HTMLDialogElement.prototype, name, { configurable: true, value: function (this: HTMLDialogElement) { this.toggleAttribute('open', name === 'showModal') } })
})

it.each([
  ['button', 'resolve'], ['button', 'false'], ['button', 'reject'],
  ['escape', 'resolve'], ['escape', 'reject'], ['unmount', 'resolve'], ['unmount', 'reject'],
] as const)('isolates a %s dismissal from a late %s', async (dismissal, outcome) => {
  const pending = Promise.withResolvers<boolean>()
  const renameSession = vi.fn(() => pending.promise)
  const onClose = vi.fn()
  const actions = { renameSession, archiveSession: vi.fn(), togglePin: vi.fn() }
  function Harness() {
    const [target, setTarget] = useState<string | undefined>('A')
    return <>
      <button onClick={() => { setTarget('B') }}>Open B</button>
      <button onClick={() => { setTarget(undefined) }}>Unmount</button>
      {target === undefined ? null : <SessionMenu key={target} sessionId={target as SessionId} title={target}
        pinned={false} archivable actions={actions} t={key => zh[key]}
        onClose={() => { onClose(); setTarget(undefined) }} />}
    </>
  }
  render(<Harness />)
  fireEvent.click(screen.getByRole('button', { name: zh['menu.rename'] }))
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Saved A' } })
  fireEvent.click(screen.getByRole('button', { name: zh['rename.save'] }))
  expect(renameSession).toHaveBeenCalledWith('A', 'Saved A')
  if (dismissal === 'button') fireEvent.click(screen.getAllByRole('button', { name: zh['menu.close'] })[0]!)
  else if (dismissal === 'escape') fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }))
  else fireEvent.click(screen.getByRole('button', { name: 'Unmount' }))
  expect(screen.queryByRole('dialog')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Open B' }))
  fireEvent.click(screen.getByRole('button', { name: zh['menu.rename'] }))
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Unsaved B' } })
  await act(async () => {
    if (outcome === 'reject') pending.reject(new Error('offline'))
    else pending.resolve(outcome === 'resolve')
    await Promise.allSettled([pending.promise])
  })
  expect(screen.getByRole<HTMLInputElement>('textbox').value).toBe('Unsaved B')
  expect(screen.queryByRole('alert')).toBeNull()
  expect(onClose).toHaveBeenCalledTimes(dismissal === 'unmount' ? 0 : 1)
})

it('notifies closure once when the browser emits a close event', () => {
  const onClose = vi.fn()
  render(<SessionMenu sessionId={'session' as SessionId} title="Original" pinned={false} archivable
    actions={{ renameSession: vi.fn(), archiveSession: vi.fn(), togglePin: vi.fn() }} onClose={onClose} t={key => zh[key]} />)
  const dialog = screen.getByRole('dialog')
  fireEvent.click(screen.getByRole('button', { name: zh['menu.close'] }))
  fireEvent(dialog, new Event('close'))
  expect(onClose).toHaveBeenCalledTimes(1)
})

it.each([true, false])('toggles a pin from pinned=%s and closes', (pinned) => {
  const togglePin = vi.fn()
  const onClose = vi.fn()
  render(<SessionMenu sessionId={'session' as SessionId} title="Original" pinned={pinned} archivable
    actions={{ renameSession: vi.fn(), archiveSession: vi.fn(), togglePin }} onClose={onClose} t={key => zh[key]} />)
  fireEvent.click(screen.getByRole('button', { name: zh[pinned ? 'menu.unpin' : 'menu.pin'] }))
  expect(togglePin).toHaveBeenCalledWith('session')
  expect(onClose).toHaveBeenCalledOnce()
})

it('rechecks archive eligibility while confirming and allows retry after refusal', async () => {
  const archiveSession = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true)
  const onClose = vi.fn()
  const props = { sessionId: 'session' as SessionId, title: 'Original', pinned: false,
    actions: { renameSession: vi.fn(), archiveSession, togglePin: vi.fn() }, onClose, t: (key: keyof typeof zh) => zh[key] }
  const view = render(<SessionMenu {...props} archivable />)
  fireEvent.click(screen.getByRole('button', { name: zh['menu.archive'] }))
  view.rerender(<SessionMenu {...props} archivable={false} />)
  fireEvent.click(screen.getByRole('button', { name: zh['menu.archive'] }))
  expect(archiveSession).not.toHaveBeenCalled()
  view.rerender(<SessionMenu {...props} archivable />)
  fireEvent.click(screen.getByRole('button', { name: zh['menu.archive'] }))
  await screen.findByRole('alert')
  expect(screen.getByRole('alert').textContent).toBe(zh['archive.busy'])
  fireEvent.click(screen.getByRole('button', { name: zh['menu.archive'] }))
  await waitFor(() => { expect(onClose).toHaveBeenCalledOnce() })
  expect(archiveSession).toHaveBeenNthCalledWith(1, 'session')
  expect(archiveSession).toHaveBeenNthCalledWith(2, 'session')
})
afterEach(() => {
  cleanup()
  for (const [name, descriptor] of dialogMethods) {
    if (descriptor === undefined) Reflect.deleteProperty(HTMLDialogElement.prototype, name)
    else Object.defineProperty(HTMLDialogElement.prototype, name, descriptor)
  }
})

it.each(['false', 'reject'] as const)('retains a rename draft after %s and releases the button for retry', async (failure) => {
  const renameSession = vi.fn().mockResolvedValue(true)
  if (failure === 'false') renameSession.mockResolvedValueOnce(false)
  else renameSession.mockRejectedValueOnce(new Error('offline'))
  const onClose = vi.fn()
  render(<SessionMenu sessionId={'session' as SessionId} title="Original" pinned={false} archivable
    actions={{ renameSession, archiveSession: vi.fn(), togglePin: vi.fn() }} onClose={onClose} t={key => zh[key]} />)
  fireEvent.click(screen.getByRole('button', { name: zh['menu.rename'] }))
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Retained title' } })
  fireEvent.click(screen.getByRole('button', { name: zh['rename.save'] }))
  await screen.findByRole('alert')
  expect(screen.getByRole<HTMLInputElement>('textbox').value).toBe('Retained title')
  expect(screen.getByRole<HTMLButtonElement>('button', { name: zh['rename.save'] }).disabled).toBe(false)
  expect(onClose).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: zh['rename.save'] }))
  await waitFor(() => { expect(onClose).toHaveBeenCalled() })
  expect(renameSession).toHaveBeenCalledTimes(2)
})

/** 同批点击合并为一次重命名，关闭后的排队点击不得再次调用服务。 */
it('阻止同批重复保存及关闭后的迟到保存', async () => {
  const pending = Promise.withResolvers<boolean>()
  const renameSession = vi.fn(() => pending.promise)
  const onClose = vi.fn()
  render(<SessionMenu sessionId={'session' as SessionId} title="Original" pinned={false} archivable
    actions={{ renameSession, archiveSession: vi.fn(), togglePin: vi.fn() }} onClose={onClose} t={key => zh[key]} />)
  fireEvent.click(screen.getByRole('button', { name: zh['menu.rename'] }))
  const save = screen.getByRole('button', { name: zh['rename.save'] })
  act(() => { save.click(); save.click() })
  expect(renameSession).toHaveBeenCalledExactlyOnceWith('session', 'Original')
  await act(async () => { pending.resolve(false); await pending.promise })
  fireEvent.click(screen.getAllByRole('button', { name: zh['menu.close'] })[0]!)
  fireEvent.click(save)
  expect(renameSession).toHaveBeenCalledOnce()
  expect(onClose).toHaveBeenCalledOnce()
})
