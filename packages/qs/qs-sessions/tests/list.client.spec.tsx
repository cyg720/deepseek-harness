// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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

/** 导航创建请求合并、失败及卸载落定均不能污染下一次导航。 */
it.each(['resolve', 'reject'] as const)('创建 %s 在卸载后落定不触发错误显示', async (outcome) => {
  const f = fixture(), pending = Promise.withResolvers<boolean>()
  f.createSession.mockReturnValue(pending.promise)
  const view = render(<SessionList {...f.props} />)
  fireEvent.keyDown(document, { key: 'k', metaKey: true })
  fireEvent.keyDown(document, { key: 'k', ctrlKey: true })
  expect(f.createSession).toHaveBeenCalledOnce()
  view.unmount()
  await act(async () => { if (outcome === 'resolve') pending.resolve(false); else pending.reject(new Error('offline')); await Promise.allSettled([pending.promise]) })
  expect(screen.queryByRole('alert')).toBeNull()
})
it('创建异常可以重试，模态框打开时快捷键不创建会话', async () => {
  const f = fixture()
  f.createSession.mockRejectedValueOnce(new Error('offline'))
  const view = render(<><dialog open /><SessionList {...f.props} /></>)
  fireEvent.keyDown(document, { key: 'k', ctrlKey: true })
  expect(f.createSession).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: /新建会话/ }))
  await screen.findByRole('alert')
  expect(screen.getByRole<HTMLButtonElement>('button', { name: /新建会话/ }).disabled).toBe(false)
  view.unmount()
})
it.each([true, false])('列表归档成功 %s 只在成功时清除置顶', async (ok) => {
  const show = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal')
  const close = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'close')
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function (this: HTMLDialogElement) { this.open = true } })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function (this: HTMLDialogElement) { this.open = false } })
  try {
    const f = fixture(), forget = vi.fn(), toggle = vi.fn(), selectSession = vi.fn()
    const props = {
      ...f.props, selectSession, actions: { forget, toggle },
      archiveSession: vi.fn().mockResolvedValue(ok), canArchive: () => true,
      useSessions: (select: (value: object) => unknown) => select({ ids: ['A', 'B'], current: 'A', byId: { A: { displayTitle: 'Title A', running: true } } }),
      useStore: (select: (value: object) => unknown) => select({ pinned: ['A'] }),
      useQsArchivedSessions: (select: (value: readonly never[]) => unknown) => select([]),
      useSessionPendingInteraction: (select: (value: Map<string, never>) => unknown) => select(new Map<string, never>()),
    } as unknown as QsSessionListProps
    render(<SessionList {...props} />)
    fireEvent.click(screen.getByRole('button', { name: 'Title A' }))
    expect(selectSession).toHaveBeenCalledWith('A')
    fireEvent.click(screen.getByRole('button', { name: `${zh['row.manage']} Title A` }))
    fireEvent.click(screen.getByRole('button', { name: zh['menu.unpin'] }))
    expect(toggle).toHaveBeenCalledWith('A')
    fireEvent.click(screen.getByRole('button', { name: `${zh['row.manage']} Title A` }))
    fireEvent.click(screen.getByRole('button', { name: zh['menu.archive'] }))
    fireEvent.click(screen.getByRole('button', { name: zh['menu.archive'] }))
    await waitFor(() => { expect(props.archiveSession).toHaveBeenCalledWith('A') })
    expect(forget).toHaveBeenCalledTimes(ok ? 1 : 0)
  } finally {
    cleanup()
    for (const [key, descriptor] of [['showModal', show], ['close', close]] as const) {
      if (descriptor) Object.defineProperty(HTMLDialogElement.prototype, key, descriptor)
      else Reflect.deleteProperty(HTMLDialogElement.prototype, key)
    }
  }
})

/** 远端移除菜单目标时仍保留本地草稿，并用会话 id 标识目标。 */
it('列表移除目标后保留菜单及重命名草稿', () => {
  const original = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal')
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function (this: HTMLDialogElement) { this.open = true } })
  try {
    const f = fixture()
    let present = true
    const props = { ...f.props,
      useSessions: (select: (value: object) => unknown) => select({ ids: present ? ['A'] : [], byId: present ? { A: { displayTitle: 'Title A' } } : {} }),
      useSessionPendingInteraction: (select: (value: Map<string, never>) => unknown) => select(new Map<string, never>()),
      canArchive: () => true,
    } as unknown as QsSessionListProps
    const view = render(<SessionList {...props} />)
    fireEvent.click(screen.getByRole('button', { name: `${zh['row.manage']} Title A` }))
    present = false
    view.rerender(<SessionList {...props} />)
    expect(screen.getByRole('dialog').textContent).toContain('A')
    fireEvent.click(screen.getByRole('button', { name: zh['menu.rename'] }))
    expect(screen.getByRole<HTMLInputElement>('textbox').value).toBe('Title A')
  } finally {
    cleanup()
    if (original === undefined) Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal')
    else Object.defineProperty(HTMLDialogElement.prototype, 'showModal', original)
  }
})
