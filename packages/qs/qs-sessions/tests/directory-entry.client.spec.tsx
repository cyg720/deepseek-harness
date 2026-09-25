// @vitest-environment jsdom
/** 真实组件共享操作所有权，取消/失去流程占用后旧回调无法采纳。 */
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { DirectoryEntry, type DirectoryEntryProps, type QsDirectoryFlowOwner } from '../src/client/DirectoryEntry.tsx'
import { createDirectoryFlow } from '../src/client/directory-flow.ts'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)
it('arbitrates both entries and rejects callbacks from a dismissed request', async () => {
  const pending = Promise.withResolvers<WorkspaceId>()
  const create = vi.fn(() => pending.promise), open = vi.fn(async () => {})
  const directory = createDirectoryFlow({ create, open })
  const owners: QsDirectoryFlowOwner[] = []
  let available = true
  const props: DirectoryEntryProps = { directory, t: makeTranslate(zh), useQsDirectoryAvailable: select => select(available),
    renderFlow: (owner: QsDirectoryFlowOwner) => { owners.push(owner); return null } }
  const view = render(<><section aria-label="first"><DirectoryEntry {...props} /></section>
    <section aria-label="second"><DirectoryEntry {...props} /></section></>)
  const first = within(screen.getByRole('region', { name: 'first' }))
  const second = within(screen.getByRole('region', { name: 'second' }))
  fireEvent.click(first.getByRole('button', { name: zh['directory.add'] }))
  expect(second.getByRole<HTMLButtonElement>('button').disabled).toBe(true)
  const old = owners.at(-1)!
  fireEvent.click(first.getByRole('button', { name: zh['directory.cancel'] }))
  fireEvent.click(second.getByRole('button', { name: zh['directory.add'] }))
  await act(async () => { old.onPicked('/obsolete'); old.onCancel(); old.onError('obsolete error') })
  expect(create).not.toHaveBeenCalled()
  expect(second.queryByRole('alert')).toBeNull()
  const next = owners.at(-1)!
  act(() => { next.onError('private diagnostic') })
  expect(second.getByRole('alert').textContent).toBe(zh['directory.failed'])
  fireEvent.click(second.getByRole('button', { name: zh['directory.add'] }))
  act(() => { owners.at(-1)!.onPicked('/new') })
  expect(second.getByRole('status').textContent).toBe(zh['directory.adopting'])
  available = false
  view.rerender(<><section aria-label="first"><DirectoryEntry {...props} /></section>
    <section aria-label="second"><DirectoryEntry {...props} /></section></>)
  expect(screen.queryByRole('button')).toBeNull()
  await act(async () => { pending.resolve('registered' as WorkspaceId) })
  expect(open).not.toHaveBeenCalled()
  expect(directory.state.getSnapshot().phase).toBe('idle')
  view.unmount(); directory.dispose()
})
