// @vitest-environment jsdom
/** 文档与画布取消采用真实 AbortSignal，PDF 外部运行时通过窄接口模拟。 */
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { createPdfStore } from '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/src/client/pdf/store.ts'
import { PdfWorkerFailure } from '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/src/client/pdf/errors.ts'
import type { PdfDocument } from '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/client'
import type { TabId } from '@deepseek-ai/dsh-client-ui-dockkit'
import { PdfBody } from '../src/client/pdf/index.tsx'
import type { PdfProps } from '../src/client/pdf/index.tsx'
import { en } from '../src/client/locales.ts'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })
function fixture() {
  const instance = createPdfStore().create(), controller = new AbortController()
  const pending = Promise.withResolvers<PdfDocument>(), dispose = vi.fn(async () => {})
  const open = vi.fn<PdfProps['open']>(() => ({ document: pending.promise, dispose }))
  const draw = vi.fn<PdfProps['render']>().mockResolvedValue({ width: 120, height: 80 })
  const document: PdfDocument = { numPages: 2, getPage: vi.fn<PdfDocument['getPage']>() }
  // 框架其余标准字段不参与本文档生命周期，实际 store 和 tab.signal 保持真实。
  const props = { content: { kind: 'bytes', data: new Uint8Array([1]) }, open, render: draw, t: makeTranslate(en),
    useTabInfo: () => ({ tab: { id: 'pdf' as TabId, signal: controller.signal } }),
    useStore: selector => selector(instance.getSnapshot()), actions: instance.actions, retainTab: vi.fn(),
  } as PdfProps
  return { props, pending, dispose, open, draw, controller, document, instance }
}
it('draws pages and cancels every canvas and worker session on unload', async () => {
  const h = fixture(), view = render(<PdfBody {...h.props} />)
  expect(screen.getByRole('status').textContent).toBe(en.loading)
  await act(async () => { h.pending.resolve(h.document) })
  expect(screen.getAllByRole('img')).toHaveLength(2)
  expect(h.draw).toHaveBeenCalledTimes(2)
  const signals = h.draw.mock.calls.map(call => call[3])
  view.unmount()
  expect(h.open.mock.calls[0]?.[1].aborted).toBe(true)
  expect(signals.every(signal => signal.aborted)).toBe(true)
  expect(h.dispose).toHaveBeenCalledTimes(1)
})
it.each([
  ['PasswordException', en.pdfPassword], ['PdfWorkerFailure', en.pdfWorker], ['Error', en.pdfFailed],
])('shows localized %s without raw diagnostics and allows retry', async (name, expected) => {
  const h = fixture(), view = render(<PdfBody {...h.props} />)
  await act(async () => { h.pending.reject(Object.assign(new Error('private diagnostic'), { name })) })
  expect(screen.getByRole('alert').textContent).toContain(expected)
  expect(view.container.textContent).not.toContain('private diagnostic')
  h.open.mockReturnValueOnce({ document: Promise.resolve(h.document), dispose: h.dispose })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: en.retry })) })
  expect(screen.getAllByRole('img')).toHaveLength(2)
  expect(h.dispose).toHaveBeenCalledTimes(1)
})
it('retries a failed page with a distinct canvas and ignores a document arriving after cancellation', async () => {
  const h = fixture()
  h.draw.mockRejectedValueOnce(new Error('bad page'))
  const view = render(<PdfBody {...h.props} />)
  await act(async () => { h.pending.resolve(h.document) })
  const oldCanvas = h.draw.mock.calls[0]![2]
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: en.retry })) })
  expect(h.draw.mock.calls.at(-1)?.[2]).not.toBe(oldCanvas)
  expect(h.draw.mock.calls[0]?.[3].aborted).toBe(true)
  view.unmount()
  const late = fixture(), second = render(<PdfBody {...late.props} />)
  second.unmount()
  await act(async () => { late.pending.resolve(late.document) })
  expect(late.draw).not.toHaveBeenCalled()
})
it('rejects text delivery without starting a worker', () => {
  const h = fixture()
  render(<PdfBody {...h.props} content={{ kind: 'text', pages: [], text: '', eof: true }} />)
  expect(screen.getByRole('alert').textContent).toBe(en.pdfUnsupported)
  expect(h.open).not.toHaveBeenCalled()
})

it('draws visible pages lazily and ignores observer deliveries after disposal', async () => {
  // 浏览器回调由测试显式投递，避免依赖 jsdom 的布局和真实时间。
  const observers: Array<{ notify: (visible: boolean) => void; disconnect: ReturnType<typeof vi.fn> }> = []
  vi.stubGlobal('IntersectionObserver', class {
    disconnect = vi.fn()
    observe = vi.fn()
    constructor(callback: IntersectionObserverCallback) {
      observers.push({ disconnect: this.disconnect, notify: (visible) => {
        callback([{ isIntersecting: visible } as IntersectionObserverEntry], this as unknown as IntersectionObserver)
      } })
    }
  })
  const h = fixture(), view = render(<PdfBody {...h.props} />)
  await act(async () => { h.pending.resolve(h.document) })
  expect(h.draw.mock.calls.map(call => call[1])).toEqual([1])
  await act(async () => { observers[1]!.notify(false) })
  expect(h.draw).toHaveBeenCalledTimes(1)
  await act(async () => { observers[1]!.notify(true) })
  expect(h.draw.mock.calls.map(call => call[1])).toEqual([1, 2])
  expect(h.instance.getSnapshot().byTab['pdf' as TabId]?.page).toBe(2)
  view.unmount()
  await act(async () => { observers[0]!.notify(true) })
  expect(h.instance.getSnapshot().byTab['pdf' as TabId]?.page).toBe(2)
  expect(observers.every(observer => observer.disconnect.mock.calls.length > 0)).toBe(true)
})

it('isolates replacement bytes from late worker failures and late canvas completion', async () => {
  const h = fixture(), staleDraw = Promise.withResolvers<{ width: number; height: number }>()
  h.draw.mockReturnValueOnce(staleDraw.promise)
  const view = render(<PdfBody {...h.props} />)
  await act(async () => { h.pending.resolve(h.document) })
  const stale = h.open.mock.calls[0]!, replacement = Promise.withResolvers<PdfDocument>()
  h.open.mockReturnValueOnce({ document: replacement.promise, dispose: h.dispose })
  view.rerender(<PdfBody {...h.props} content={{ kind: 'bytes', data: new Uint8Array([2]) }} />)
  expect(stale[1].aborted).toBe(true)
  await act(async () => {
    stale[2]?.(new PdfWorkerFailure(new ErrorEvent('error', { message: 'retired worker' })))
    staleDraw.resolve({ width: 1, height: 1 })
    replacement.resolve(h.document)
  })
  expect(screen.queryByRole('alert')).toBeNull()
  expect(screen.getAllByRole('img')).toHaveLength(2)
  await act(async () => {
    h.open.mock.calls[1]![2]?.(new PdfWorkerFailure(new ErrorEvent('error', { message: 'active worker failure' })))
  })
  expect(screen.getByRole('alert').textContent).toContain(en.pdfWorker)
  expect(view.container.textContent).not.toContain('active worker failure')
})

it('does not reopen an aborted tab and ignores a rejected document after unload', async () => {
  const h = fixture()
  h.controller.abort()
  const view = render(<PdfBody {...h.props} />)
  expect(h.open).not.toHaveBeenCalled()
  view.unmount()
  const late = fixture(), mounted = render(<PdfBody {...late.props} />)
  mounted.unmount()
  await act(async () => { late.pending.reject(new Error('late rejection')) })
  expect(late.draw).not.toHaveBeenCalled()
})

it('ignores canvas rejection after its document has been unloaded', async () => {
  const h = fixture(), pending = Promise.withResolvers<{ width: number; height: number }>()
  h.draw.mockReturnValueOnce(pending.promise)
  const view = render(<PdfBody {...h.props} />)
  await act(async () => { h.pending.resolve(h.document) })
  view.unmount()
  await act(async () => { pending.reject(new Error('cancelled rendering')) })
  expect(h.draw.mock.calls[0]![3].aborted).toBe(true)
})
