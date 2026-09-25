/** 真实官方 store 的提交观察不依赖挂载界面，重复订阅和释放均独立。 */
import { expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { createSidebarRightStore } from '../../src/client/stores.ts'
import { createLayoutObserver } from '../../src/client/qs/layout-observer.ts'

const sid = 'observed' as SessionId
const create = () => createSidebarRightStore(() => ({ kind: 'guide', title: 'Start' })).create()
it('skips absent layouts and emits each committed identity once', () => {
  const store = create(), observer = createLayoutObserver(), listener = vi.fn()
  observer.attach(sid, store)
  const off = observer.watch(listener)
  expect(listener).not.toHaveBeenCalled()
  store.actions.setExpanded(sid, true)
  expect(listener).toHaveBeenCalledExactlyOnceWith(sid, store.getSnapshot().bySession[sid]!.layout)
  store.actions.setExpanded(sid, true)
  store.actions.open('another')
  expect(listener).toHaveBeenCalledTimes(1)
  off(); store.actions.setMode(sid, 'fullscreen')
  expect(listener).toHaveBeenCalledTimes(1)
  observer.dispose()
})
it('replays already committed layouts to a late listener and notifies existing listeners of a late store', () => {
  const store = create(), observer = createLayoutObserver(), first = vi.fn(), late = vi.fn()
  store.actions.setExpanded(sid, true)
  observer.watch(first)
  observer.attach(sid, store)
  observer.watch(late)
  expect(first).toHaveBeenCalledTimes(1)
  expect(late).toHaveBeenCalledExactlyOnceWith(sid, store.getSnapshot().bySession[sid]!.layout)
  observer.dispose()
  store.actions.setMode(sid, 'fullscreen')
  expect(first).toHaveBeenCalledTimes(1)
  expect(late).toHaveBeenCalledTimes(1)
})
it('replaces an owned store subscription without accepting old instance commits', () => {
  const old = create(), current = create(), observer = createLayoutObserver(), listener = vi.fn()
  observer.watch(listener)
  observer.attach(sid, old)
  observer.attach(sid, current)
  old.actions.setExpanded(sid, true)
  expect(listener).not.toHaveBeenCalled()
  current.actions.setExpanded(sid, true)
  expect(listener).toHaveBeenCalledTimes(1)
  observer.dispose()
})
it('contains a failing consumer without starving other consumers or store commits', () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  const store = create(), observer = createLayoutObserver(), healthy = vi.fn()
  try {
    observer.attach(sid, store)
    observer.watch(() => { throw new Error('consumer failed') })
    observer.watch(healthy)
    store.actions.setExpanded(sid, true)
    expect(healthy).toHaveBeenCalledTimes(1)
    expect(error).toHaveBeenCalledOnce()
  } finally { observer.dispose(); error.mockRestore() }
})
