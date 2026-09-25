/** 可控扫描/创建时序验证关闭隔离，不依赖定时睡眠或真实文件系统权限。 */
import { expect, it, vi } from 'vitest'
import type { DirectoryListing } from '@deepseek-ai/dsh-api-remotes/client'
import { createBrowseController } from '../src/client/browser-state.ts'

function listing(path: string): DirectoryListing {
  return { path, home: '/host', crumbs: [], entries: [], truncated: false }
}

it('uses Host paths verbatim and supersedes scans even when the transport ignores cancellation', async () => {
  const old = Promise.withResolvers<DirectoryListing>(), next = Promise.withResolvers<DirectoryListing>()
  const listDirectory = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise)
  const controller = createBrowseController({ listDirectory, createDirectory: vi.fn() })
  const notify = vi.fn(), unsubscribe = controller.subscribe(notify)
  const first = controller.navigate(), second = controller.navigate('Z:\\remote\\project')
  expect(listDirectory.mock.calls[0]![0]).toBeUndefined()
  expect((listDirectory.mock.calls[0]![1] as AbortSignal).aborted).toBe(true)
  expect(listDirectory.mock.calls[1]![0]).toBe('Z:\\remote\\project')
  next.resolve(listing('Z:\\REMOTE\\project')); await second
  old.resolve(listing('/obsolete')); await first
  expect(controller.getSnapshot().listing?.path).toBe('Z:\\REMOTE\\project')
  expect(notify).toHaveBeenCalledTimes(3)
  unsubscribe(); controller.dispose()
})

it('ignores superseded errors, exposes current failure without diagnostics and retries the requested path', async () => {
  const old = Promise.withResolvers<DirectoryListing>()
  const listDirectory = vi.fn().mockReturnValueOnce(old.promise).mockRejectedValueOnce(new Error('private path diagnostic'))
    .mockResolvedValueOnce(listing('/normalized'))
  const controller = createBrowseController({ listDirectory, createDirectory: vi.fn() })
  const first = controller.navigate('/old'), second = controller.navigate('/requested')
  await second; old.reject(new Error('obsolete')); await first
  expect(controller.getSnapshot().error).toBe('list')
  expect(JSON.stringify(controller.getSnapshot())).not.toContain('private')
  await controller.retry()
  expect(listDirectory.mock.calls[2]![0]).toBe('/requested')
  expect(controller.getSnapshot()).toEqual({ listing: listing('/normalized'), error: undefined, loading: false, creating: false })
  controller.dispose()
})

it.each(['resolve', 'reject'] as const)('does not publish a scan %s after disposal', async (outcome) => {
  const pending = Promise.withResolvers<DirectoryListing>()
  const listDirectory = vi.fn(() => pending.promise)
  const controller = createBrowseController({ listDirectory, createDirectory: vi.fn() })
  const notify = vi.fn(); controller.subscribe(notify)
  const work = controller.navigate()
  controller.dispose()
  if (outcome === 'resolve') pending.resolve(listing('/late')); else pending.reject(new Error('late'))
  await work; await controller.navigate('/ignored'); await controller.create('ignored')
  expect(notify).toHaveBeenCalledOnce(); expect(listDirectory).toHaveBeenCalledOnce()
})

it('creates only with a readable parent, coalesces gestures and navigates to the returned path', async () => {
  const scan = Promise.withResolvers<DirectoryListing>(), creation = Promise.withResolvers<string>()
  const listDirectory = vi.fn().mockReturnValueOnce(scan.promise).mockResolvedValueOnce(listing('/host/new-normalized'))
  const createDirectory = vi.fn(() => creation.promise)
  const controller = createBrowseController({ listDirectory, createDirectory })
  await controller.create('before first scan')
  const work = controller.navigate('/host'); await controller.create('while scanning')
  expect(createDirectory).not.toHaveBeenCalled()
  scan.resolve(listing('/host')); await work
  const creating = controller.create('new')
  await controller.create('duplicate'); await controller.navigate('/elsewhere')
  expect(createDirectory).toHaveBeenCalledExactlyOnceWith('/host', 'new')
  expect(listDirectory).toHaveBeenCalledOnce()
  creation.resolve('/host/new-normalized'); await creating
  expect(listDirectory.mock.calls[1]![0]).toBe('/host/new-normalized')
  expect(controller.getSnapshot().listing?.path).toBe('/host/new-normalized')
  controller.dispose()
})

it('retains the parent on create failure and requires an explicit retry', async () => {
  const createDirectory = vi.fn().mockRejectedValueOnce(new Error('exists')).mockResolvedValueOnce('/host/new')
  const listDirectory = vi.fn(async (path?: string) => listing(path ?? '/host'))
  const controller = createBrowseController({ listDirectory, createDirectory })
  await controller.navigate(); await controller.create('new')
  expect(controller.getSnapshot()).toEqual({ listing: listing('/host'), loading: false, creating: false, error: 'create' })
  await controller.create('new')
  expect(createDirectory).toHaveBeenCalledTimes(2)
  expect(controller.getSnapshot().listing?.path).toBe('/host/new')
  controller.dispose()
})

it.each(['resolve', 'reject'] as const)('withdraws a pending create %s without another scan after close', async (outcome) => {
  const pending = Promise.withResolvers<string>()
  const listDirectory = vi.fn(async () => listing('/host'))
  const controller = createBrowseController({ listDirectory, createDirectory: () => pending.promise })
  await controller.navigate()
  const work = controller.create('new'), snapshot = controller.getSnapshot()
  controller.dispose()
  if (outcome === 'resolve') pending.resolve('/host/new'); else pending.reject(new Error('late'))
  await work
  expect(controller.getSnapshot()).toBe(snapshot)
  expect(listDirectory).toHaveBeenCalledOnce()
})

it('does not create in a stale directory after a failed navigation', async () => {
  const createDirectory = vi.fn()
  const listDirectory = vi.fn().mockResolvedValueOnce(listing('/host')).mockRejectedValueOnce(new Error('unreadable'))
  const controller = createBrowseController({ listDirectory, createDirectory })
  await controller.navigate(); await controller.navigate('/unreadable'); await controller.create('new')
  expect(createDirectory).not.toHaveBeenCalled()
  expect(controller.getSnapshot().listing?.path).toBe('/host')
  controller.dispose()
})
