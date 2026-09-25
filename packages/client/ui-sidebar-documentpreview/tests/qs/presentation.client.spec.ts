/** 双界面使用同一预览代次，刷新和关闭标签之后的旧响应不得恢复过期内容。 */
import { expect, it, vi } from 'vitest'
import { createDocumentPresentation } from '../../src/client/qs/presentation.ts'
import { DocumentPreviewRegistry } from '../../src/client/document/registry.ts'
import type { WorkspaceFilesReadRemote, ReadDocumentBytes } from '../../src/client/rpc.ts'
import { FILE, SESSION, TAB_ID, page } from '../fixtures.client.ts'

it('shares paged and byte read generations and preserves view preferences across consumers', async () => {
  type Read = WorkspaceFilesReadRemote['workspaceFiles']['read']
  const pages: Array<(result: Awaited<ReturnType<Read>>) => void> = []
  const bytes: Array<(result: Awaited<ReturnType<ReadDocumentBytes>>) => void> = []
  const read = vi.fn<Read>(() => new Promise((resolve) => { pages.push(resolve) }))
  const readAll = vi.fn<ReadDocumentBytes>(() => new Promise((resolve) => { bytes.push(resolve) }))
  const registry = new DocumentPreviewRegistry()
  const presentation = createDocumentPresentation({ workspaceFiles: { read } }, readAll, registry, vi.fn())
  const a = presentation.store.create(), b = presentation.store.create()
  const official = presentation.inject(SESSION, a.actions), qs = presentation.inject(SESSION, a.actions)
  expect(qs).toBe(official)
  expect(presentation.inject(SESSION, b.actions)).not.toBe(qs)
  const controller = new AbortController()
  official.loadPage(TAB_ID, FILE, 1, controller.signal)
  a.actions.scrolled(TAB_ID, 120)
  a.actions.toggledWrap(TAB_ID)
  qs.reloadPages(TAB_ID, FILE, controller.signal)
  pages[1]!(page(1, ['current'], true, 'v2'))
  await Promise.resolve()
  pages[0]!(page(1, ['stale'], true, 'v1'))
  await Promise.resolve()
  expect(a.getSnapshot().byTab[TAB_ID]).toMatchObject({
    pages: { 1: { text: 'current' } }, version: 'v2', scrollTop: 120, wrap: false,
  })
  official.loadAll(TAB_ID, FILE, controller.signal)
  qs.reloadAll(TAB_ID, FILE, controller.signal)
  const result = (data: string) => ({ ok: true as const, value: {
    absolutePath: '/work/sample.png', version: 'v3', offset: 0, data, eof: true,
  } })
  bytes[1]!(result('Ag=='))
  await Promise.resolve()
  bytes[0]!(result('AQ=='))
  await Promise.resolve()
  expect(a.getSnapshot().byTab[TAB_ID]?.complete?.data).toEqual(new Uint8Array([2]))
  qs.loadPage(TAB_ID, FILE, 1, controller.signal)
  controller.abort()
  pages[2]!(page(1, ['after close'], true))
  await Promise.resolve()
  expect(a.getSnapshot().byTab[TAB_ID]).toBeUndefined()
  expect(b.getSnapshot().byTab).toEqual({})
  expect(read).toHaveBeenNthCalledWith(1, FILE.sessionId, FILE.path, { offset: 1 }, controller.signal)
  expect(readAll).toHaveBeenNthCalledWith(1, FILE, controller.signal)
})

it('shares live renderer metadata and removes subscriptions through their disposer', () => {
  const registry = new DocumentPreviewRegistry()
  const read = vi.fn<WorkspaceFilesReadRemote['workspaceFiles']['read']>()
  const readAll = vi.fn<ReadDocumentBytes>()
  const presentation = createDocumentPresentation({ workspaceFiles: { read } }, readAll, registry, vi.fn())
  const state = presentation.store.create()
  const source = presentation.inject(SESSION, state.actions).hooks.documentPreviews
  const listener = vi.fn(), stop = source.subscribe(listener)
  const definition = { id: 'test', extensions: ['txt'], title: () => 'Test', loading: 'text-pages' as const }
  const remove = registry.register(definition)
  expect(source.getSnapshot()).toEqual([definition])
  expect(listener).toHaveBeenCalledTimes(1)
  stop(); remove()
  expect(source.getSnapshot()).toEqual([])
  expect(listener).toHaveBeenCalledTimes(1)
  expect(read).not.toHaveBeenCalled()
  expect(readAll).not.toHaveBeenCalled()
})
