// @vitest-environment jsdom
/** 使用官方共享状态验证目录行为，权限失败与真实资源地址均做载荷断言。 */
import { useSyncExternalStore } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { makeTranslate, RemoteError } from '@deepseek-ai/dsh-client-test-runtime'
import { createFilesPresentation } from '@deepseek-ai/dsh-client-ui-sidebar-files/src/client/qs/presentation.ts'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { TabId } from '@deepseek-ai/dsh-client-ui-dockkit'
import type { WorkspaceFilesListRemote } from '@deepseek-ai/dsh-client-ui-sidebar-files/client'
import { Files, FilesTitle } from '../src/client/Files.tsx'
import type { FilesProps } from '../src/client/Files.tsx'
import { zh, en } from '../src/client/locales.ts'

afterEach(cleanup)
const SESSION = 'qs-files' as SessionId, TAB = 'tab-files' as TabId
function mount(cwd: string | undefined = '/work', aborted = false) {
  type Result = Awaited<ReturnType<WorkspaceFilesListRemote['workspaceFiles']['list']>>
  const pending: Array<(value: Result) => void> = []
  const list = vi.fn<WorkspaceFilesListRemote['workspaceFiles']['list']>(() => new Promise((resolve) => { pending.push(resolve) }))
  const shared = createFilesPresentation({ workspaceFiles: { list } }), instance = shared.store.create(SESSION)
  const controller = new AbortController(), openResource = vi.fn()
  if (aborted) controller.abort()
  // 标准座位其余成员由 runtime 注入，本用例只构造组件实际消费的成员。
  const props = {
    useTabInfo: () => ({ tab: { id: TAB, signal: controller.signal, actions: { openResource } } }),
    useSessions: <S,>(selector: (state: SessionListState) => S) => selector({
      byId: cwd === undefined ? {} : { [SESSION]: { cwd } },
    } as unknown as SessionListState),
    useStore: <S,>(selector: (state: ReturnType<typeof instance.getSnapshot>) => S) => selector(useSyncExternalStore(
      listener => instance.subscribe(listener), () => instance.getSnapshot(),
    )),
    actions: instance.actions, ...shared.inject(SESSION, instance.actions), sessionId: SESSION, t: makeTranslate(zh),
  } as unknown as FilesProps
  const view = render(<Files {...props} />)
  return { pending, list, controller, instance, openResource, view, props }
}
it('lists directories first, expands lazily, opens real resource addresses and reloads expanded levels', async () => {
  const h = mount()
  expect(screen.getByText(zh.loading)).toBeTruthy()
  h.pending[0]!({ ok: true, value: { path: '', entries: [
    { name: 'file10.ts', type: 'file' }, { name: 'z', type: 'directory' },
    { name: 'file2.ts', type: 'file' }, { name: 'link', type: 'other' },
  ], truncated: true } })
  await screen.findByText(zh.truncated)
  expect(screen.getAllByRole('button').map(b => b.textContent)).toEqual([zh.reload, '▸z', 'file2.ts', 'file10.ts'])
  expect(screen.getByTitle(zh.other).getAttribute('aria-disabled')).toBe('true')
  fireEvent.click(screen.getByRole('button', { name: 'file2.ts' }))
  expect(h.openResource).toHaveBeenCalledWith('dsh-resource://file/session/qs-files/file2.ts')
  fireEvent.click(screen.getByRole('button', { name: /z/ }))
  expect(h.list).toHaveBeenLastCalledWith(SESSION, '/work/z', h.controller.signal)
  h.pending[1]!({ ok: true, value: { path: 'z', entries: [], truncated: false } })
  await screen.findByText(zh.empty)
  fireEvent.click(screen.getByRole('button', { name: /z/ }))
  expect(screen.queryByText(zh.empty)).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: /z/ }))
  expect(h.list).toHaveBeenCalledTimes(2)
  fireEvent.click(screen.getByRole('button', { name: zh.reload }))
  expect(h.list).toHaveBeenCalledTimes(4)
  h.controller.abort()
})
it.each([
  [new RemoteError('workspace-file/not-found', 'secret diagnostic', { path: '/work' }), zh.notFound],
  [new RemoteError('workspace-file/outside-workspace', 'secret diagnostic', { path: '/work' }), zh.outside],
  [new RemoteError('workspace-file/not-directory', 'secret diagnostic', { path: '/work', kind: 'file' }), zh.notDirectory],
  [new RemoteError('gateway/cancelled', 'secret diagnostic', {}), zh.unavailable],
] as const)('shows safe failure copy for %s', async (error, line) => {
  const h = mount()
  h.pending[0]!({ ok: false, error })
  await screen.findByText(line)
  expect(screen.queryByText('secret diagnostic')).toBeNull()
  h.controller.abort()
})
it('shows missing workspace and never seeds an aborted tab', async () => {
  const h = mount('/work', true)
  expect(h.list).not.toHaveBeenCalled()
  expect(screen.getByText(zh.loading)).toBeTruthy()
  h.view.rerender(<Files {...h.props} useSessions={selector => selector({ byId: {} } as SessionListState)} />)
  await waitFor(() => { expect(screen.getByText(zh.noWorkspace)).toBeTruthy() })
  h.view.rerender(<FilesTitle t={makeTranslate(en)} />)
  expect(screen.getByText(en.title)).toBeTruthy()
})
