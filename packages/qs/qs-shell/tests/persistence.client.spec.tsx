// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { createQsLayoutStore, LAYOUT_STORE_KEY } from '../src/client/layout-store.ts'
import { PanelResize } from '../src/client/PanelResize.tsx'

afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.removeItem(LAYOUT_STORE_KEY); vi.unstubAllGlobals() })

it('restores desktop panel preferences after reload and clears them on logout', () => {
  vi.stubGlobal('matchMedia', () => ({ matches: true }))
  const first = createQsLayoutStore().create()
  first.actions.setLeftOpen(false)
  first.actions.setWidth('right', 390)
  first.actions.setRightOpen(false)
  const next = createQsLayoutStore().create()
  expect(next.getSnapshot()).toMatchObject({ leftOpen: false, rightWidth: 390, rightOpen: false })
  next.actions.reset()
  expect(localStorage.getItem(LAYOUT_STORE_KEY)).toBeNull()
  expect(createQsLayoutStore().create().getSnapshot()).toMatchObject({ leftOpen: true, rightRequestId: 0 })
})

it('ignores corrupt persisted dimensions and clamps live resizing', () => {
  localStorage.setItem(LAYOUT_STORE_KEY, JSON.stringify({ leftWidth: 'wide', rightWidth: 1e9, activeRightTab: 99 }))
  const instance = createQsLayoutStore().create()
  expect(instance.getSnapshot()).toMatchObject({ leftWidth: undefined, rightWidth: undefined, rightRequestId: 0 })
  instance.actions.setWidth('left', 10000)
  expect(instance.getSnapshot().leftWidth).toBe(480)
})

it('resizes a rendered panel with arrow keys', () => {
  const resize = vi.fn()
  render(<><aside /><PanelResize side="left" label="Resize" onResize={resize} /></>)
  const handle = screen.getByRole('separator')
  vi.spyOn(handle.previousElementSibling!, 'getBoundingClientRect').mockReturnValue({ width: 240 } as DOMRect)
  fireEvent.keyDown(handle, { key: 'ArrowRight' })
  expect(resize).toHaveBeenCalledWith('left', 250)
})

/** 浏览器保存值属于外部输入，非法开关不能覆盖断点默认值。 */
it('忽略非法开关并在窄屏收起两侧面板', () => {
  vi.stubGlobal('matchMedia', () => ({ matches: true }))
  localStorage.setItem(LAYOUT_STORE_KEY, JSON.stringify({ leftOpen: 'yes', rightOpen: 1 }))
  const instance = createQsLayoutStore().create()
  expect(instance.getSnapshot()).toMatchObject({ leftOpen: true, rightOpen: true })
  instance.actions.applyViewport({ narrow: true, wide: false })
  expect(instance.getSnapshot()).toMatchObject({ compact: true, leftOpen: false, rightOpen: false })
})

it('面板实际状态回报不产生新的外壳操作，显式同值请求仍递增', () => {
  const store = createQsLayoutStore().create()
  store.actions.setRightOpen(false)
  const requestId = store.getSnapshot().rightRequestId
  store.actions.reportRightOpen(true)
  expect(store.getSnapshot()).toMatchObject({ rightOpen: true, rightRequestId: requestId })
  store.actions.setRightOpen(true)
  expect(store.getSnapshot().rightRequestId).toBe(requestId + 1)
})

it.each([undefined, 1])('migrates supported layout version %s and writes only allowlisted preferences', (version) => {
  vi.stubGlobal('matchMedia', () => ({ matches: true }))
  localStorage.setItem(LAYOUT_STORE_KEY, JSON.stringify({ version, leftOpen: false, rightOpen: true,
    leftWidth: 220, rightWidth: 320, rightRequestId: 999, compact: true, credentials: 'must-not-copy', body: 'private' }))
  const store = createQsLayoutStore().create()
  expect(store.getSnapshot()).toMatchObject({ leftOpen: false, rightOpen: true, leftWidth: 220, rightWidth: 320,
    rightRequestId: 0, compact: false, storageNotice: undefined })
  store.actions.setWidth('left', 240)
  expect(JSON.parse(localStorage.getItem(LAYOUT_STORE_KEY)!)).toEqual({
    version: 1, leftOpen: false, rightOpen: true, leftWidth: 240, rightWidth: 320,
  })
})

it.each(['{broken', 'null', '[]', '42', '"text"', '{"version":2,"leftWidth":220}', '{"version":"1"}', '{"version":null}'])('recovers unsupported or corrupt persisted layout %s visibly', (raw) => {
  vi.stubGlobal('matchMedia', () => ({ matches: true }))
  localStorage.setItem(LAYOUT_STORE_KEY, raw)
  const store = createQsLayoutStore().create()
  expect(store.getSnapshot()).toMatchObject({ leftOpen: true, rightOpen: true, leftWidth: undefined, storageNotice: 'recovered' })
  store.actions.reset()
  expect(store.getSnapshot().storageNotice).toBeUndefined()
  expect(localStorage.getItem(LAYOUT_STORE_KEY)).toBeNull()
})

it('retains valid fields, reports invalid fields and applies narrow viewport limits on restore', () => {
  vi.stubGlobal('matchMedia', () => ({ matches: false }))
  localStorage.setItem(LAYOUT_STORE_KEY, '{"version":1,"leftWidth":250,"rightWidth":0,"leftOpen":true,"rightOpen":false}')
  const store = createQsLayoutStore().create()
  expect(store.getSnapshot()).toMatchObject({ leftWidth: 250, rightWidth: undefined, leftOpen: false, rightOpen: false, storageNotice: 'recovered' })
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('701') }))
  localStorage.setItem(LAYOUT_STORE_KEY, '{"version":1,"rightOpen":true}')
  expect(createQsLayoutStore().create().getSnapshot()).toMatchObject({ compact: false, leftOpen: true, rightOpen: false })
})

it('keeps layout usable and announces denied reads, writes and reset without exposing errors', () => {
  const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('private browser error') })
  const store = createQsLayoutStore().create()
  expect(store.getSnapshot().storageNotice).toBe('memory')
  get.mockRestore()
  store.actions.setLeftOpen(true)
  expect(store.getSnapshot().storageNotice).toBeUndefined()
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') })
  store.actions.setWidth('left', 260)
  expect(store.getSnapshot()).toMatchObject({ leftWidth: 260, storageNotice: 'memory' })
  const remove = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('denied') })
  store.actions.reset()
  expect(store.getSnapshot()).toMatchObject({ leftWidth: undefined, storageNotice: 'memory' })
  remove.mockRestore()
})
