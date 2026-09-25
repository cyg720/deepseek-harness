// @vitest-environment jsdom
/** 两种语言及请求替换覆盖真实表单交互，Host 操作以可控 Promise 提供。 */
import { StrictMode } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { DirectoryListing } from '@deepseek-ai/dsh-api-remotes/client'
import { BrowseDirectoryFlow, type BrowseFlowProps } from '../src/client/flow.tsx'
import { en, zh } from '../src/client/locales.ts'

afterEach(cleanup)
function listing(path = '/host'): DirectoryListing {
  return { path, home: '/host', crumbs: [{ name: '/', path: '/', hidden: false }, { name: 'host', path, hidden: false }],
    entries: [{ name: 'project', path: '/host/project', hidden: false }, { name: '.hidden', path: '/host/.hidden', hidden: true }], truncated: true }
}
function fixture(copy: typeof en = en): BrowseFlowProps {
  const dictionary: Record<string, string> = copy
  return { open: true, busy: false, request: Symbol('request'), onPicked: vi.fn(), onCancel: vi.fn(), onError: vi.fn(),
    listDirectory: vi.fn(async (path?: string) => listing(path)), createDirectory: vi.fn(async () => '/host/new-normalized'),
    t: key => dictionary[key] ?? key }
}

it.each([en, zh])('navigates Host paths, toggles hidden entries, creates and confirms using localized controls', async (copy) => {
  const props = fixture(copy)
  render(<BrowseDirectoryFlow {...props} />)
  await act(async () => {})
  expect(screen.getByRole('dialog', { name: copy.title })).toBeTruthy()
  expect(screen.getByRole('status').textContent).toBe(copy.truncated)
  expect(screen.queryByRole('button', { name: '.hidden' })).toBeNull()
  fireEvent.click(screen.getByRole('checkbox', { name: copy.hidden }))
  fireEvent.click(screen.getByRole('button', { name: '.hidden' }))
  await act(async () => {})
  expect(props.listDirectory).toHaveBeenLastCalledWith('/host/.hidden', expect.any(AbortSignal))
  fireEvent.click(screen.getByRole('button', { name: copy.parent })); await act(async () => {})
  expect(props.listDirectory).toHaveBeenLastCalledWith('/', expect.any(AbortSignal))
  fireEvent.click(screen.getByRole('button', { name: copy.home })); await act(async () => {})
  fireEvent.change(screen.getByRole('textbox', { name: copy.path }), { target: { value: 'Z:\\remote\\task' } })
  fireEvent.click(screen.getByRole('button', { name: copy.go })); await act(async () => {})
  expect(props.listDirectory).toHaveBeenLastCalledWith('Z:\\remote\\task', expect.any(AbortSignal))
  fireEvent.change(screen.getByRole('textbox', { name: copy.folderName }), { target: { value: 'new' } })
  fireEvent.click(screen.getByRole('button', { name: copy.create })); await act(async () => {})
  expect(props.createDirectory).toHaveBeenCalledExactlyOnceWith('Z:\\remote\\task', 'new')
  fireEvent.click(screen.getByRole('button', { name: copy.confirm }))
  expect(props.onPicked).toHaveBeenCalledExactlyOnceWith('/host/new-normalized')
})

it('shows a safe listing failure, disables adoption of stale data and retries the attempted path', async () => {
  const props = fixture()
  vi.mocked(props.listDirectory).mockRejectedValueOnce(new Error('private diagnostic'))
  render(<BrowseDirectoryFlow {...props} />); await act(async () => {})
  expect(screen.getByRole('alert').textContent).toBe(en.listError)
  expect(screen.getByRole<HTMLButtonElement>('button', { name: en.confirm }).disabled).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: en.retry })); await act(async () => {})
  expect(screen.queryByRole('alert')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'project' })); await act(async () => {})
  expect(props.listDirectory).toHaveBeenLastCalledWith('/host/project', expect.any(AbortSignal))
})

it('keeps cancellation available while creating and discards late creation after the flow closes', async () => {
  const pending = Promise.withResolvers<string>(), props = fixture()
  vi.mocked(props.createDirectory).mockReturnValue(pending.promise)
  const view = render(<BrowseDirectoryFlow {...props} />); await act(async () => {})
  fireEvent.change(screen.getByRole('textbox', { name: en.folderName }), { target: { value: 'new' } })
  fireEvent.click(screen.getByRole('button', { name: en.create }))
  expect(screen.getAllByRole('status').some(node => node.textContent === en.creating)).toBe(true)
  fireEvent.click(screen.getAllByRole('button', { name: en.cancel }).at(-1)!)
  expect(props.onCancel).toHaveBeenCalledOnce()
  view.rerender(<BrowseDirectoryFlow {...props} open={false} />)
  await act(async () => { pending.resolve('/late') })
  expect(props.listDirectory).toHaveBeenCalledOnce()
  expect(props.onPicked).not.toHaveBeenCalled()
  expect(screen.queryByRole('dialog')).toBeNull()
})

it('resets draft and rejects old scan replies when a different request replaces the dialog', async () => {
  const props = fixture(), pending = Promise.withResolvers<DirectoryListing>()
  vi.mocked(props.listDirectory).mockReturnValueOnce(pending.promise)
  const view = render(<BrowseDirectoryFlow {...props} />)
  fireEvent.change(screen.getByRole('textbox', { name: en.path }), { target: { value: '/old-draft' } })
  view.rerender(<BrowseDirectoryFlow {...props} request={Symbol('next')} />)
  await act(async () => { pending.resolve(listing('/obsolete')) })
  expect(screen.getByRole<HTMLInputElement>('textbox', { name: en.path }).value).toBe('/host')
  expect(vi.mocked(props.listDirectory).mock.calls[0]![1]!.aborted).toBe(true)
})

it('aborts the StrictMode rehearsal scan and closes on Escape', async () => {
  const props = fixture()
  render(<StrictMode><BrowseDirectoryFlow {...props} /></StrictMode>); await act(async () => {})
  expect(props.listDirectory).toHaveBeenCalledTimes(2)
  expect(vi.mocked(props.listDirectory).mock.calls[0]![1]!.aborted).toBe(true)
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(props.onCancel).toHaveBeenCalledOnce()
})

it('keeps keyboard focus inside the dialog and restores the originating control', async () => {
  const props = fixture(), trigger = document.createElement('button')
  document.body.append(trigger); trigger.focus()
  try {
    const view = render(<BrowseDirectoryFlow {...props} />); await act(async () => {})
    const path = screen.getByRole('textbox', { name: en.path }), confirm = screen.getByRole('button', { name: en.confirm })
    expect(document.activeElement).toBe(path)
    fireEvent.keyDown(path, { key: 'Tab', shiftKey: true }); expect(document.activeElement).toBe(confirm)
    fireEvent.keyDown(confirm, { key: 'Tab' }); expect(document.activeElement).toBe(path)
    fireEvent.keyDown(path, { key: 'Tab' }); fireEvent.keyDown(path, { key: 'ArrowDown' })
    fireEvent.keyDown(confirm, { key: 'Tab', shiftKey: true })
    view.unmount(); expect(document.activeElement).toBe(trigger)
  } finally { trigger.remove() }
})

it('renders empty listings and safe create failure while preventing submission during adoption', async () => {
  const props = fixture()
  vi.mocked(props.listDirectory).mockResolvedValue({ path: '/host', home: '/host', crumbs: [], entries: [], truncated: false })
  vi.mocked(props.createDirectory).mockRejectedValue(new Error('private create failure'))
  const view = render(<BrowseDirectoryFlow {...props} />); await act(async () => {})
  expect(screen.getByText(en.empty)).toBeTruthy()
  const name = screen.getByRole('textbox', { name: en.folderName }), path = screen.getByRole('textbox', { name: en.path })
  fireEvent.submit(name.closest('form')!)
  fireEvent.change(path, { target: { value: '' } }); fireEvent.submit(path.closest('form')!)
  expect(props.createDirectory).not.toHaveBeenCalled(); expect(props.listDirectory).toHaveBeenCalledOnce()
  fireEvent.change(name, { target: { value: 'new' } }); fireEvent.submit(name.closest('form')!)
  await act(async () => {})
  expect(screen.getByRole('alert').textContent).toBe(en.createError)
  view.rerender(<BrowseDirectoryFlow {...props} busy />)
  expect(screen.getByRole('status').textContent).toBe(en.adopting)
  fireEvent.submit(name.closest('form')!); fireEvent.submit(path.closest('form')!)
  expect(props.createDirectory).toHaveBeenCalledOnce()
})

it('uses Host breadcrumb addresses for ancestor navigation', async () => {
  const props = fixture()
  render(<BrowseDirectoryFlow {...props} />); await act(async () => {})
  fireEvent.click(screen.getByRole('button', { name: '/' })); await act(async () => {})
  expect(props.listDirectory).toHaveBeenLastCalledWith('/', expect.any(AbortSignal))
})
