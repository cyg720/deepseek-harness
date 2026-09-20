import { afterEach, expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { createSessionActions, type SessionActionDeps } from '../src/client/use-session-actions.ts'

afterEach(() => { vi.restoreAllMocks() })

function fixture() {
  let current: SessionId | undefined
  const listeners = new Set<() => void>()
  const deferred = Promise.withResolvers<SessionId>()
  const create = vi.fn(() => deferred.promise)
  const open = vi.fn()
  const deps = {
    sessions: { create, open, list: {
      getSnapshot: () => ({ current }),
      subscribe: (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn) } },
    } },
    workspaces: {}, faceOf: () => undefined,
  } as unknown as SessionActionDeps // This fixture only exercises Session creation and navigation.
  return { actions: createSessionActions(deps), create, open, deferred, listeners,
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
