// @vitest-environment jsdom
/** 导航条目通过真实插件注入发布官方会话动作和归档订阅。 */
import { expect, it, vi } from 'vitest'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { apply, inject } from '../src/client/index.ts'
import type { WorkspaceNavigationInjected } from '../src/client/WorkspaceSelector.tsx'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { WorkspaceDirectoryInjected } from '../src/client/DirectoryEntry.tsx'
import type { QsSessionListInjected } from '../src/client/contract.ts'
it('导航注入使用会话服务并传播归档状态', async () => {
  const runtime = await SlotTestRuntime.create()
  try {
    const locale = new LocaleRuntime(runtime.ctx)
    runtime.ctx.provide('locale', locale); runtime.slots.installLocale(locale)
    const openWorkspace = vi.fn().mockResolvedValue(undefined)
    runtime.ctx.provide('uiWorkspace', { openWorkspace, openSession: (id: SessionId) => { runtime.ctx.sessions.open(id) } })
    const id = 'session' as SessionId
    const open = vi.spyOn(runtime.ctx.sessions, 'open').mockImplementation(() => {})
    vi.spyOn(runtime.ctx.sessions, 'create').mockResolvedValue(id)
    const rename = vi.fn().mockResolvedValue({ ok: true })
    vi.spyOn(runtime.ctx.sessions, 'binding').mockImplementation(value => (value === id ? { session: { rename, getSnapshot: () => ({ running: false, queue: [] }) } } : undefined) as ReturnType<typeof runtime.ctx.sessions.binding>)
    let archivedSessionIds: SessionId[] = []
    const notice = vi.fn(), unsubscribe = vi.fn()
    vi.spyOn(runtime.ctx.workspaces.list, 'subscribe').mockImplementation((listener) => { listener(); return unsubscribe })
    vi.spyOn(runtime.ctx.workspaces.list, 'getSnapshot').mockImplementation(() => ({ archivedSessionIds, items: [] }) as unknown as ReturnType<typeof runtime.ctx.workspaces.list.getSnapshot>)
    const archive = vi.spyOn(runtime.ctx.workspaces, 'archiveSession').mockResolvedValue(undefined)
    await runtime.declare({ 'qs.nav': { kind: 'single', scope: 'root' }, 'qs.workspace.hero': { kind: 'single', scope: 'root' } })
    await runtime.mount({ inject, apply })
    const face = (runtime.slots.entries('qs.nav')[0]!.inject as unknown as () => QsSessionListInjected & WorkspaceNavigationInjected)()
    await face.openWorkspace('workspace' as WorkspaceId)
    expect(openWorkspace).toHaveBeenCalledWith('workspace')
    const hero = (runtime.slots.entries('qs.workspace.hero')[0]!.inject as unknown as () => WorkspaceNavigationInjected)()
    await hero.openWorkspace('hero-workspace' as WorkspaceId)
    expect(openWorkspace).toHaveBeenLastCalledWith('hero-workspace')
    const off = face.hooks.qsArchivedSessions.subscribe(notice)
    expect(notice).toHaveBeenCalledOnce()
    archivedSessionIds = [id]
    expect(face.hooks.qsArchivedSessions.getSnapshot()).toBe(archivedSessionIds)
    off(); expect(unsubscribe).toHaveBeenCalledOnce()
    face.selectSession(id); expect(open).toHaveBeenCalledWith(id)
    expect(await face.createSession(new AbortController().signal)).toBe(true)
    expect(await face.renameSession(id, 'new title')).toBe(true)
    expect(rename).toHaveBeenCalledWith('new title')
    expect(await face.renameSession('missing' as SessionId, 'title')).toBe(false)
    expect(await face.archiveSession(id)).toBe(true); expect(archive).toHaveBeenCalledWith(id)
    expect(face.canArchive(id, new Set())).toBe(true)
  } finally { await runtime.dispose() }
})

/** 官方导航和列表更新共同撤销过期目录，槽占用源跟随真实注册表。 */
it('shares directory adoption and cancels pending selection on Session changes', async () => {
  const runtime = await SlotTestRuntime.create()
  try {
    const locale = new LocaleRuntime(runtime.ctx)
    runtime.ctx.provide('locale', locale); runtime.slots.installLocale(locale)
    const openWorkspace = vi.fn(async (_id: WorkspaceId, beforeOpen?: (id: SessionId) => void) => {
      beforeOpen?.('selected' as SessionId)
    })
    runtime.ctx.provide('uiWorkspace', { openWorkspace, openSession: () => {} })
    const listeners = new Set<() => void>()
    let snapshot = runtime.ctx.sessions.list.getSnapshot()
    vi.spyOn(runtime.ctx.sessions.list, 'getSnapshot').mockImplementation(() => snapshot)
    vi.spyOn(runtime.ctx.sessions.list, 'subscribe').mockImplementation((listener) => {
      listeners.add(listener); return () => { listeners.delete(listener) }
    })
    const created = { workspaceId: 'registered' as WorkspaceId, path: '/host/path', title: 'Path',
      sessionIds: [], createdAt: '', updatedAt: '' }
    const create = vi.spyOn(runtime.ctx.workspaces, 'create').mockResolvedValue(created)
    await runtime.declare({ 'qs.nav': { kind: 'single', scope: 'root' }, 'qs.workspace.hero': { kind: 'single', scope: 'root' } })
    const mounted = await runtime.mount({ inject, apply })
    const face = (runtime.slots.entries('qs.nav')[0]!.inject as unknown as () => WorkspaceDirectoryInjected)()
    const hero = (runtime.slots.entries('qs.workspace.hero')[0]!.inject as unknown as () => WorkspaceDirectoryInjected)()
    expect(hero.directory).toBe(face.directory)
    expect(face.hooks.qsDirectoryAvailable.getSnapshot()).toBe(false)
    const stop = face.hooks.qsDirectoryAvailable.subscribe(() => {})
    stop()
    const owner = Symbol('hero')
    const request = face.directory.begin(owner)!
    await face.directory.picked(request, '/host/path')
    expect(create).toHaveBeenCalledExactlyOnceWith({ path: '/host/path' })
    expect(openWorkspace).toHaveBeenCalledExactlyOnceWith('registered', expect.any(Function))
    const deferred = Promise.withResolvers<undefined>()
    openWorkspace.mockImplementationOnce(async (_id, beforeOpen) => {
      await deferred.promise; beforeOpen?.('obsolete' as SessionId)
    })
    const obsolete = face.directory.picked(face.directory.begin(owner)!, '/old')
    await vi.waitFor(() => { expect(openWorkspace).toHaveBeenCalledTimes(2) })
    face.directory.cancel(); deferred.resolve(undefined); await obsolete
    expect(face.directory.state.getSnapshot().phase).toBe('idle')
    face.directory.begin(owner)
    for (const listener of listeners) listener()
    expect(face.directory.state.getSnapshot().phase).toBe('picking')
    snapshot = { ...snapshot, current: 'different' as SessionId }
    for (const listener of listeners) listener()
    expect(face.directory.state.getSnapshot().phase).toBe('idle')
    await mounted.dispose()
    expect(listeners.size).toBe(0)
    expect(face.directory.begin(owner)).toBeUndefined()
  } finally { await runtime.dispose() }
})
