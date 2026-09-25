// @vitest-environment jsdom
/** 工作区切换保留官方所有权，失败重试及卸载不结算到后来的界面。 */
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { WorkspaceId, WorkspaceSnapshot } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { WorkspaceSelector, type WorkspaceSelectorProps } from '../src/client/WorkspaceSelector.tsx'
import { SessionNavigation } from '../src/client/SessionNavigation.tsx'
import type { SessionNavigationProps } from '../src/client/SessionNavigation.tsx'
import { createDirectoryFlow } from '../src/client/directory-flow.ts'
import { WorkspaceHero } from '../src/client/WorkspaceHero.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)
function fixture() {
  let workspace: WorkspaceSnapshot = { items: [{ workspaceId: 'w' as WorkspaceId, path: '/host/project', title: 'Project',
    sessionIds: [], createdAt: '', updatedAt: '' }], archivedSessionIds: [], state: 'idle', phase: 'ready', error: null }
  let state = { current: undefined, byId: {} } as SessionListState
  const openWorkspace = vi.fn<WorkspaceSelectorProps['openWorkspace']>().mockResolvedValue(undefined)
  const props: WorkspaceSelectorProps = { t: makeTranslate(zh), openWorkspace,
    useWorkspaces: select => select(workspace), useSessions: select => select(state) }
  return { props, openWorkspace,
    setWorkspace: (next: Partial<WorkspaceSnapshot>) => { workspace = { ...workspace, ...next } },
    setSession: (next: SessionListState) => { state = next } }
}
it('presents loading, failed, empty and selected Host workspace states without inventing rows', () => {
  const f = fixture(), view = render(<WorkspaceSelector {...f.props} />)
  expect(screen.getByRole<HTMLSelectElement>('combobox').disabled).toBe(false)
  const select = screen.getByRole('combobox')
  fireEvent.change(select, { target: { value: 'missing' } }); expect(f.openWorkspace).not.toHaveBeenCalled()
  f.setWorkspace({ phase: 'pending' }); view.rerender(<WorkspaceSelector {...f.props} />)
  expect(screen.getByRole('status').textContent).toBe(zh['workspace.loading'])
  f.setWorkspace({ state: 'error' }); view.rerender(<WorkspaceSelector {...f.props} />)
  expect(screen.getByRole('alert').textContent).toBe(zh['workspace.listFailed'])
  f.setWorkspace({ state: 'idle', phase: 'ready' })
  f.setSession({ current: 's', byId: { s: { cwd: '/host/project' } } } as unknown as SessionListState)
  view.rerender(<WorkspaceSelector {...f.props} />)
  expect(screen.getByText('/host/project')).toBeTruthy()
  expect(screen.getByRole<HTMLSelectElement>('combobox').value).toBe('w')
  f.setWorkspace({ items: [] }); view.rerender(<WorkspaceSelector {...f.props} />)
  expect(screen.getByText(zh['workspace.empty'])).toBeTruthy()
})
it('coalesces duplicate selection, retains retry after failure and ignores a closed instance settlement', async () => {
  const f = fixture()
  let reject: (reason: Error) => void = () => {}
  f.openWorkspace.mockImplementationOnce(() => new Promise<void>((_resolve, rejectPromise) => { reject = rejectPromise }))
  const view = render(<WorkspaceSelector {...f.props} />)
  const select = screen.getByRole('combobox')
  fireEvent.change(select, { target: { value: 'w' } }); fireEvent.change(select, { target: { value: 'w' } })
  expect(f.openWorkspace).toHaveBeenCalledTimes(1)
  expect(screen.getByRole('status').textContent).toBe(zh['workspace.opening'])
  await act(async () => { reject(new Error('private Host failure')) })
  expect(screen.getByRole('alert').textContent).toBe(zh['workspace.failed'])
  expect(view.container.textContent).not.toContain('private Host failure')
  await act(async () => { fireEvent.change(select, { target: { value: 'w' } }) })
  expect(screen.queryByRole('alert')).toBeNull()
  f.openWorkspace.mockImplementationOnce(() => new Promise<void>((_resolve, rejectPromise) => { reject = rejectPromise }))
  fireEvent.change(select, { target: { value: 'w' } }); view.unmount()
  const next = render(<WorkspaceSelector {...fixture().props} />)
  await act(async () => { reject(new Error('late failure')) })
  expect(next.queryByRole('alert')).toBeNull()
})
it('renders the workspace selector alongside the existing session navigation', () => {
  const f = fixture()
  // 空列表测试只提供列表实际读取的标准能力，不执行其他会话动作。
  const directory = createDirectoryFlow({ create: async () => 'w' as WorkspaceId, open: async () => {} })
  const renderSlot = vi.fn(() => null)
  const props = { ...f.props, directory, useQsDirectoryAvailable: () => true, renderSlot,
    useStore: () => [], useQsArchivedSessions: () => [],
    useSessionPendingInteraction: () => new Set(), createSession: vi.fn(),
    useSessions: (select: (state: SessionListState) => unknown) => select({ ids: [], byId: {} } as unknown as SessionListState),
  } as unknown as SessionNavigationProps
  render(<SessionNavigation {...props} />)
  expect(screen.getByRole('combobox')).toBeTruthy()
  expect(screen.getByRole('button', { name: /新建会话/ })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: zh['directory.add'] }))
  expect(renderSlot).toHaveBeenCalledWith('qs.workspace.sidebar.directoryFlow', expect.objectContaining({ open: true }))
})

it('renders the separate hero directory child with the shared owner', () => {
  const f = fixture(), renderSlot = vi.fn(() => null)
  const directory = createDirectoryFlow({ create: async () => 'w' as WorkspaceId, open: async () => {} })
  render(<WorkspaceHero {...f.props} directory={directory} useQsDirectoryAvailable={select => select(true)} renderSlot={renderSlot} />)
  fireEvent.click(screen.getByRole('button', { name: zh['directory.add'] }))
  expect(renderSlot).toHaveBeenCalledWith('qs.workspace.hero.directoryFlow', expect.objectContaining({ open: true }))
})
