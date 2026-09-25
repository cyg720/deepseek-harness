// @vitest-environment jsdom
/** 可控异步准备验证取消和 Blob 所有权，iframe 不取得同源权限。 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { HtmlBody } from '../src/client/html/index.tsx'
import type { HtmlProps } from '../src/client/html/index.tsx'
import { en } from '../src/client/locales.ts'

const create = vi.fn<(blob: Blob) => string>(), revoke = vi.fn<(url: string) => void>()
let createDescriptor: PropertyDescriptor | undefined, revokeDescriptor: PropertyDescriptor | undefined
beforeEach(() => {
  createDescriptor = Object.getOwnPropertyDescriptor(URL, 'createObjectURL')
  revokeDescriptor = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL')
  create.mockReset().mockImplementation(() => `blob:html/${create.mock.calls.length}`); revoke.mockReset()
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: create })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revoke })
})
afterEach(() => {
  try { cleanup() } finally {
    if (createDescriptor === undefined) Reflect.deleteProperty(URL, 'createObjectURL')
    else Object.defineProperty(URL, 'createObjectURL', createDescriptor)
    if (revokeDescriptor === undefined) Reflect.deleteProperty(URL, 'revokeObjectURL')
    else Object.defineProperty(URL, 'revokeObjectURL', revokeDescriptor)
  }
})
function harness() {
  const pending: Array<ReturnType<typeof Promise.withResolvers<string>>> = []
  const prepareHtml = vi.fn<HtmlProps['prepareHtml']>(() => {
    const entry = Promise.withResolvers<string>(); pending.push(entry); return entry.promise
  })
  const controller = new AbortController()
  // 标准座位只读取 tab.signal；其他能力不参与隔离正文的资源所有权。
  const props = { resourceAddress: 'dsh-resource://file/session/html/index.html',
    content: { kind: 'bytes', data: new Uint8Array([1]) }, prepareHtml, t: makeTranslate(en),
    useTabInfo: () => ({ tab: { signal: controller.signal } }),
  } as unknown as HtmlProps
  return { props, prepareHtml, pending, controller }
}
it('publishes only the current preparation and revokes replaced or unloaded frame URLs', async () => {
  const h = harness(), view = render(<HtmlBody {...h.props} />)
  expect(screen.getByRole('status').textContent).toBe(en.loading)
  view.rerender(<HtmlBody {...h.props} content={{ kind: 'bytes', data: new Uint8Array([2]) }} />)
  expect(h.prepareHtml.mock.calls[0]?.[3].aborted).toBe(true)
  await act(async () => { h.pending[1]!.resolve('<h1>current</h1>') })
  const frame = screen.getByTitle(en.htmlFrame)
  expect(frame.getAttribute('sandbox')).toBe('allow-scripts')
  expect(frame.getAttribute('src')).toBe('blob:html/1')
  expect(create.mock.calls[0]?.[0].type).toBe('text/html')
  await act(async () => { h.pending[0]!.resolve('<h1>stale</h1>') })
  expect(create).toHaveBeenCalledTimes(1)
  view.rerender(<HtmlBody {...h.props} resourceAddress="dsh-resource://file/session/html/next.html" />)
  expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:html/1')
  await act(async () => { h.pending[2]!.resolve('<p>next</p>') })
  view.unmount()
  expect(revoke.mock.calls).toEqual([['blob:html/1'], ['blob:html/2']])
})
it('contains read and Blob failures without publishing their diagnostic text', async () => {
  const h = harness(), view = render(<HtmlBody {...h.props} />)
  await act(async () => { h.pending[0]!.reject(new Error('private diagnostic')) })
  expect(screen.getByRole('alert').textContent).toBe(en.htmlFailed)
  create.mockImplementationOnce(() => { throw new Error('private Blob diagnostic') })
  view.rerender(<HtmlBody {...h.props} content={{ kind: 'bytes', data: new Uint8Array([2]) }} />)
  await act(async () => { h.pending[1]!.resolve('<p>allowed</p>') })
  expect(screen.getByRole('alert').textContent).toBe(en.htmlFailed)
  expect(view.container.textContent).not.toContain('private')
  expect(revoke).not.toHaveBeenCalled()
})
it('does not publish after tab abort or allocate for text contents', async () => {
  const h = harness(), view = render(<HtmlBody {...h.props} />)
  h.controller.abort()
  await act(async () => { h.pending[0]!.resolve('<p>late</p>') })
  expect(create).not.toHaveBeenCalled()
  view.rerender(<HtmlBody {...h.props} content={{ kind: 'text', text: '', pages: [], eof: true }} />)
  expect(view.container.textContent).toBe('')
  expect(h.prepareHtml).toHaveBeenCalledTimes(1)
})
