import { afterEach, expect, it, vi } from 'vitest'
import type { WorkspaceId, WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { createSessionActions, type SessionActionDeps } from '../src/client/use-session-actions.ts'

afterEach(() => { vi.restoreAllMocks() })

function fixture() {
  let current: SessionId | undefined
  const listeners = new Set<() => void>()
  const deferred = Promise.withResolvers<SessionId>()
  const create = vi.fn(() => deferred.promise)
  const open = vi.fn()
  let workspaces: readonly WorkspaceView[] = []
  const deps = {
    sessions: { create, open, list: {
      getSnapshot: () => ({ current }),
      subscribe: (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn) } },
    } },
    navigation: { openSession: open },
    workspaces: { list: { getSnapshot: () => ({ items: workspaces }) } }, faceOf: () => undefined,
  } as unknown as SessionActionDeps // This fixture only exercises Session creation and navigation.
  return { actions: createSessionActions(deps), create, open, deferred, listeners,
    setWorkspaces: (items: readonly WorkspaceView[]) => { workspaces = items },
    select: (id: SessionId | undefined) => { current = id; for (const fn of listeners) fn() } }
}

it('coalesces repeated creation and opens its successful identity once', async () => {
  const f = fixture()
  const signal = new AbortController().signal
  const first = f.actions.create(signal)
  expect(f.actions.create(signal)).toBe(first)
  f.deferred.resolve('created' as SessionId)
  expect(await first).toBe('created')
  expect(f.create).toHaveBeenCalledOnce()
  expect(f.open).toHaveBeenCalledExactlyOnceWith('created')
  expect(f.listeners.size).toBe(0)
})

it.each(['navigation', 'unmount'] as const)('does not steal selection after %s', async (cause) => {
  const f = fixture()
  const controller = new AbortController()
  const result = f.actions.create(controller.signal)
  if (cause === 'navigation') { f.select('other' as SessionId); f.select(undefined) }
  else controller.abort()
  f.deferred.resolve('created' as SessionId)
  await result
  expect(f.open).not.toHaveBeenCalled()
  expect(f.listeners.size).toBe(0)
})

it('does not turn a creation failure carrying an identity into navigation', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const f = fixture()
  const result = f.actions.create(new AbortController().signal)
  f.deferred.reject(Object.assign(new Error('failed'), { requestedSessionId: 'reserved' }))
  expect(await result).toBeUndefined()
  expect(f.open).not.toHaveBeenCalled()
  expect(f.listeners.size).toBe(0)
})

/** 取消、未知会话和执行中队列应阻止不合适的会话操作。 */
it('已经取消的创建不触发 Host，显式打开直接传递会话身份', async () => {
  const f = fixture()
  const aborted = new AbortController(); aborted.abort()
  expect(await f.actions.create(aborted.signal)).toBeUndefined()
  expect(f.create).not.toHaveBeenCalled()
  f.actions.open('target' as SessionId)
  expect(f.open).toHaveBeenCalledExactlyOnceWith('target')
})
it('重命名和归档反映服务结果，并按运行、队列和待答复请求限制归档', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const id = 'known' as SessionId
  const rename = vi.fn().mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ ok: false })
  const archiveSession = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('offline'))
  let running = false, queue: unknown[] = []
  const actions = createSessionActions({
    sessions: {}, workspaces: { archiveSession },
    faceOf: (value: SessionId) => value === id ? { rename, getSnapshot: () => ({ running, queue }) } : undefined,
  } as unknown as SessionActionDeps)
  expect(await actions.rename('missing' as SessionId, 'title')).toBe(false)
  expect(rename).not.toHaveBeenCalled()
  expect(await actions.rename(id, 'new')).toBe(true)
  expect(rename).toHaveBeenLastCalledWith('new')
  expect(await actions.rename(id, 'rejected')).toBe(false)
  expect(await actions.archive(id)).toBe(true)
  expect(await actions.archive(id)).toBe(false)
  expect(archiveSession).toHaveBeenCalledWith(id)
  expect(actions.canArchive(id, new Set([id]))).toBe(false)
  expect(actions.canArchive('missing' as SessionId, new Set())).toBe(false)
  expect(actions.canArchive(id, new Set())).toBe(true)
  running = true
  expect(actions.canArchive(id, new Set())).toBe(false)
  running = false; queue = [{}]
  expect(actions.canArchive(id, new Set())).toBe(false)
})

/** 工作目录由官方成员关系决定，创建期间更换选择不能改写已发出的目标。 */
it.each([true, false])('inherits the selected workspace only when its membership is registered: %s', async (registered) => {
  const f = fixture()
  const selected = 'selected' as SessionId
  f.setWorkspaces([{ workspaceId: 'chosen' as WorkspaceId, path: '/chosen', sessionIds: registered ? [selected] : [],
    title: 'Chosen', createdAt: '', updatedAt: '' }])
  f.select(selected)
  const result = f.actions.create(new AbortController().signal)
  expect(f.create).toHaveBeenCalledWith(registered ? { workspaceId: 'chosen' } : {})
  f.select('elsewhere' as SessionId)
  f.deferred.resolve('created' as SessionId)
  expect(await result).toBe('created')
  expect(f.open).not.toHaveBeenCalled()
  expect(f.listeners.size).toBe(0)
})
