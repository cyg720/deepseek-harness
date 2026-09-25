/** 可控异步请求证明双入口互斥，旧选择和旧登记不能污染重开的入口。 */
import { expect, it, vi } from 'vitest'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import { createDirectoryFlow } from '../src/client/directory-flow.ts'

function fixture() {
  const pending = Promise.withResolvers<WorkspaceId>()
  const create = vi.fn(() => pending.promise)
  const open = vi.fn(async (_id: WorkspaceId, isCurrent: () => boolean) => { expect(isCurrent()).toBe(true) })
  const flow = createDirectoryFlow({ create, open })
  return { flow, create, open, pending }
}
function begin(flow: ReturnType<typeof createDirectoryFlow>, owner = Symbol('entry')): symbol {
  const request = flow.begin(owner)
  if (request === undefined) throw new Error('directory request not opened')
  return request
}

it('admits one entry, adopts exactly once and releases listeners', async () => {
  const f = fixture(), owner = Symbol('sidebar'), notice = vi.fn()
  const off = f.flow.state.subscribe(notice)
  const request = begin(f.flow, owner)
  expect(f.flow.begin(Symbol('hero'))).toBeUndefined()
  const work = f.flow.picked(request, '/host/project')
  expect(f.flow.begin(owner)).toBeUndefined()
  await f.flow.picked(request, '/duplicate')
  f.flow.failed(request)
  expect(f.flow.state.getSnapshot().phase).toBe('adopting')
  expect(f.create).toHaveBeenCalledExactlyOnceWith('/host/project')
  f.pending.resolve('registered' as WorkspaceId)
  await work
  expect(f.open).toHaveBeenCalledExactlyOnceWith('registered', expect.any(Function))
  expect(f.flow.state.getSnapshot()).toEqual({ owner: undefined, request: undefined, phase: 'idle' })
  expect(notice).toHaveBeenCalledTimes(3)
  off(); f.flow.cancel(); begin(f.flow)
  expect(notice).toHaveBeenCalledTimes(3)
  f.flow.dispose()
})

it.each(['cancel', 'dispose', 'withdraw'] as const)('does not adopt a late picker answer after %s', async (action) => {
  const f = fixture(), owner = Symbol('hero')
  const old = begin(f.flow, owner)
  if (action === 'withdraw') f.flow.withdraw(owner)
  else f.flow[action]()
  await f.flow.picked(old, '/obsolete')
  f.flow.failed(old)
  f.flow.dismiss(old)
  expect(f.create).not.toHaveBeenCalled()
  expect(f.flow.state.getSnapshot().phase).toBe('idle')
  if (action === 'dispose') expect(f.flow.begin(owner)).toBeUndefined()
  f.flow.dispose()
})

it.each(['resolve', 'reject'] as const)('ignores old adoption %s after a new entry starts', async (outcome) => {
  const f = fixture(), owner = Symbol('sidebar'), nextOwner = Symbol('hero')
  const old = begin(f.flow, owner)
  const work = f.flow.picked(old, '/old')
  f.flow.withdraw(Symbol('other'))
  expect(f.flow.state.getSnapshot().phase).toBe('adopting')
  f.flow.cancel()
  const next = begin(f.flow, nextOwner)
  f.flow.withdraw(owner)
  f.flow.failed(old)
  if (outcome === 'resolve') f.pending.resolve('old-workspace' as WorkspaceId)
  else f.pending.reject(new Error('old Host diagnostic'))
  await work
  expect(f.open).not.toHaveBeenCalled()
  expect(f.flow.state.getSnapshot()).toEqual({ owner: nextOwner, request: next, phase: 'picking' })
  f.flow.dispose()
})

it('keeps picker and adoption failures retryable without storing diagnostics', async () => {
  const f = fixture(), owner = Symbol('sidebar')
  f.flow.failed(begin(f.flow, owner))
  expect(f.flow.state.getSnapshot().phase).toBe('failed')
  const second = begin(f.flow, owner)
  const work = f.flow.picked(second, '/denied')
  f.pending.reject(new Error('secret diagnostic'))
  await work
  expect(f.flow.state.getSnapshot().phase).toBe('failed')
  expect(JSON.stringify(f.flow.state.getSnapshot())).not.toContain('secret')
  f.create.mockResolvedValue('retry' as WorkspaceId)
  await f.flow.picked(begin(f.flow, owner), '/retry')
  expect(f.open).toHaveBeenCalledExactlyOnceWith('retry', expect.any(Function))
  f.flow.dispose()
})

it.each([true, false])('does not settle an obsolete navigation, rejecting=%s', async (reject) => {
  const f = fixture(), navigating = Promise.withResolvers<undefined>()
  f.create.mockResolvedValue('workspace' as WorkspaceId)
  f.open.mockImplementation(async () => { await navigating.promise })
  const work = f.flow.picked(begin(f.flow), '/host/path')
  await vi.waitFor(() => { expect(f.open).toHaveBeenCalledOnce() })
  f.flow.cancel()
  const next = begin(f.flow)
  if (reject) navigating.reject(new Error('late open error'))
  else navigating.resolve(undefined)
  await work
  expect(f.flow.state.getSnapshot().request).toBe(next)
  expect(f.flow.state.getSnapshot().phase).toBe('picking')
  f.flow.dispose()
})

it('permits retry when current navigation fails', async () => {
  const f = fixture()
  f.create.mockResolvedValue('workspace' as WorkspaceId)
  f.open.mockRejectedValue(new Error('navigation failure'))
  await f.flow.picked(begin(f.flow), '/host/path')
  expect(f.flow.state.getSnapshot().phase).toBe('failed')
  f.flow.dispose()
})

it('only the current request can dismiss its picker', () => {
  const f = fixture(), request = begin(f.flow)
  f.flow.dismiss(request)
  expect(f.flow.state.getSnapshot().phase).toBe('idle')
  f.flow.dispose()
})
