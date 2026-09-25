/** 两个呈现消费同一目录请求代次；关闭标签后任何迟到响应均不写回。 */
import { expect, it, vi } from 'vitest'
import { RemoteError } from '@deepseek-ai/dsh-client-test-runtime'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { TabId } from '@deepseek-ai/dsh-client-ui-dockkit'
import type { WorkspaceFilesListRemote } from '../../src/client/face.ts'
import { createFilesPresentation } from '../../src/client/qs/presentation.ts'

it('shares refresh generations between consumers but isolates session instances', async () => {
  type Result = Awaited<ReturnType<WorkspaceFilesListRemote['workspaceFiles']['list']>>
  const pending: Array<(value: Result) => void> = []
  const list = vi.fn<WorkspaceFilesListRemote['workspaceFiles']['list']>(() => new Promise((resolve) => { pending.push(resolve) }))
  const presentation = createFilesPresentation({ workspaceFiles: { list } })
  const a = presentation.store.create('a'), b = presentation.store.create('b')
  const official = presentation.inject('a' as SessionId, a.actions)
  const qs = presentation.inject('a' as SessionId, a.actions)
  expect(qs).toBe(official)
  expect(presentation.inject('b' as SessionId, b.actions)).not.toBe(qs)
  const tab = 'files' as TabId, controller = new AbortController()
  official.start(tab, '/work', controller.signal)
  qs.load(tab, '/work', controller.signal)
  pending[1]!({ ok: false, error: new RemoteError('workspace-file/not-found', 'new result', { path: '/work' }) })
  await Promise.resolve(); await Promise.resolve()
  expect(a.getSnapshot().byTab[tab]?.levels['/work']).toMatchObject({ kind: 'failed', failure: { message: 'new result' } })
  pending[0]!({ ok: false, error: new RemoteError('workspace-file/not-found', 'obsolete result', { path: '/work' }) })
  await Promise.resolve(); await Promise.resolve()
  expect(a.getSnapshot().byTab[tab]?.levels['/work']).toMatchObject({ kind: 'failed', failure: { message: 'new result' } })
  qs.load(tab, '/work', controller.signal)
  controller.abort()
  pending[2]!({ ok: false, error: new RemoteError('workspace-file/not-found', 'after close', { path: '/work' }) })
  await Promise.resolve(); await Promise.resolve()
  expect(a.getSnapshot().byTab[tab]).toBeUndefined()
  expect(b.getSnapshot().byTab).toEqual({})
})
