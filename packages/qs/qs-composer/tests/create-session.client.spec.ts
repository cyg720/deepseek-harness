import { expect, it, vi } from 'vitest'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { createForSend } from '../src/client/create-session.ts'

function fixture() {
  let current: SessionId | undefined
  const listeners = new Set<() => void>()
  let complete: (id: SessionId) => void = () => {}
  let fail: (error: Error) => void = () => {}
  const create = vi.fn(() => new Promise<SessionId>((resolve, reject) => { complete = resolve; fail = reject }))
  const open = vi.fn()
  const list = {
    getSnapshot: () => ({ current }),
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
  } as ISessions['list'] // Creation reads only the current-selection member.
  return {
    sessions: { list, create, open }, listeners,
    complete: () => { complete('reserved' as SessionId) }, fail: (error: Error) => { fail(error) },
    select: (id: SessionId | undefined) => { current = id; for (const listener of listeners) listener() },
  }
}

it('opens only a successful creation and releases its subscription', async () => {
  const f = fixture()
  const result = createForSend(f.sessions, 'reserved' as SessionId, new AbortController().signal, () => false)
  f.complete()
  expect(await result).toBe('reserved')
  expect(f.sessions.open).toHaveBeenCalledExactlyOnceWith('reserved')
  expect(f.listeners.size).toBe(0)
})

it('does not open a failed request even when the error carries requestedSessionId', async () => {
  const f = fixture()
  const error = Object.assign(new Error('creation failed'), { requestedSessionId: 'reserved' })
  const result = createForSend(f.sessions, 'reserved' as SessionId, new AbortController().signal, () => false)
  f.fail(error)
  await expect(result).rejects.toBe(error)
  expect(f.sessions.open).not.toHaveBeenCalled()
  expect(f.listeners.size).toBe(0)
})

it.each(['cancel', 'navigate', 'dispose'] as const)('ignores late creation after %s', async (cause) => {
  const f = fixture()
  const controller = new AbortController()
  let disposed = false
  const result = createForSend(f.sessions, 'reserved' as SessionId, controller.signal, () => disposed)
  if (cause === 'cancel') controller.abort()
  if (cause === 'navigate') { f.select('other' as SessionId); f.select(undefined) }
  if (cause === 'dispose') disposed = true
  f.complete()
  expect(await result).toBeUndefined()
  expect(f.sessions.open).not.toHaveBeenCalled()
  expect(f.listeners.size).toBe(0)
})


it('does not create when its owner has already cancelled', async () => {
  const f = fixture()
  const controller = new AbortController()
  controller.abort()
  expect(await createForSend(f.sessions, 'reserved' as SessionId, controller.signal, () => false)).toBeUndefined()
  expect(f.sessions.create).not.toHaveBeenCalled()
  expect(f.listeners.size).toBe(0)
})
