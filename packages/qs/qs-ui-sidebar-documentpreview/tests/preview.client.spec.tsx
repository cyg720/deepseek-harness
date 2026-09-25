// @vitest-environment jsdom
/** 使用官方读取夹具验证 QS 源文本、分页失败恢复及资源版本提示。 */
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { makeTranslate, RemoteError } from '@deepseek-ai/dsh-client-test-runtime'
// 测试夹具不作为产品 API 发布；直接复用官方用例的真实读取控制器。
import { harness, page, settle, TAB_ID } from '../../../client/ui-sidebar-documentpreview/tests/fixtures.client.ts'
import type { DocumentPreviewDefinition } from '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/client'
import { Preview } from '../src/client/Preview.tsx'
import type { PreviewProps } from '../src/client/Preview.tsx'
import { TextBody } from '../src/client/text/index.tsx'
import { CodeBody } from '../src/client/code/index.tsx'
import type { CodeProps } from '../src/client/code/index.tsx'
import type { DocumentProps } from '../src/client/contract.ts'
import { en } from '../src/client/locales.ts'

afterEach(() => { cleanup(); vi.restoreAllMocks() })
const plain: DocumentPreviewDefinition = {
  id: '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/text', extensions: [], title: () => 'Plain text', loading: 'text-pages', wrap: true,
}
function propsFor(h: ReturnType<typeof harness>): PreviewProps {
  const base = h.props()
  // 官方夹具提供同一标准座位；此处只换 QS 文档槽和字典，不替换读取或状态。
  return {
    ...base, t: makeTranslate(en), useDocumentPreviews: selector => selector([plain]), candidates: () => [],
    renderSlot: (_name, owner) => <TextBody {...{ ...base, ...owner } as unknown as DocumentProps} />,
  } as PreviewProps
}
it('renders source as inert text, paginates without mixing lines, and retains wrap preference', async () => {
  const h = harness({ 1: page(1, ['<script>window.bad=true</script>', ''], false), 3: page(3, ['last'], true) })
  const view = render(<Preview {...propsFor(h)} />)
  await settle()
  expect(view.container.querySelector('script')).toBeNull()
  expect(view.container.querySelector('[data-document-line="1"]')?.textContent).toContain('<script>')
  expect(view.container.querySelector('[data-document-line="2"]')).not.toBeNull()
  fireEvent.click(screen.getByRole('button', { name: en.more }))
  await settle()
  expect(h.read).toHaveBeenLastCalledWith(expect.any(String), expect.any(String), 3, h.controller.signal)
  expect(view.container.querySelector('[data-document-line="3"]')?.textContent).toContain('last')
  expect(screen.queryByRole('button', { name: en.more })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: en.wrap }))
  expect(h.instance.getSnapshot().byTab[TAB_ID]?.wrap).toBe(false)
  view.unmount()
  render(<Preview {...propsFor(h)} />)
  expect(screen.getByRole('button', { name: en.wrap }).getAttribute('aria-pressed')).toBe('false')
  expect(h.read).toHaveBeenCalledTimes(2)
})
it('keeps loaded text on failure, does not auto retry on scroll, and retries the failed page explicitly', async () => {
  const h = harness({ 1: page(1, ['kept'], false), 2: { ok: false, error: new RemoteError('gateway/cancelled', 'private detail', {}) } })
  const view = render(<Preview {...propsFor(h)} />)
  await settle()
  fireEvent.click(screen.getByRole('button', { name: en.more }))
  await settle()
  expect(screen.getByRole('alert').textContent).toContain(en.failed)
  expect(view.container.textContent).not.toContain('private detail')
  const scroll = view.container.querySelector('[data-qs-document-text]')!.parentElement!
  fireEvent.scroll(scroll)
  expect(h.read).toHaveBeenCalledTimes(2)
  h.script(2, page(2, ['recovered'], true))
  fireEvent.click(screen.getByRole('alert').querySelector('button')!)
  await settle()
  expect(view.container.textContent).toContain('kept')
  expect(view.container.textContent).toContain('recovered')
})
it('announces a newer version without replacing content until reload', async () => {
  const h = harness({ 1: page(1, ['v1 content'], true) }), props = propsFor(h)
  const view = render(<Preview {...props} />)
  await settle()
  h.setVersion('v2'); view.rerender(<Preview {...propsFor(h)} />)
  expect(screen.getByText(en.changed)).toBeTruthy()
  expect(view.container.textContent).toContain('v1 content')
  h.script(1, page(1, ['v2 content'], true, 'v2'))
  fireEvent.click(screen.getByRole('button', { name: en.reload }))
  await settle()
  expect(screen.queryByText(en.changed)).toBeNull()
  expect(view.container.textContent).toContain('v2 content')
})

it('loads until a requested code line exists and records the renderer-owned scroll position', async () => {
  const h = harness({ 1: page(1, ['const a = 1;', 'const b = 2;'], false), 3: page(3, ['const c = 3;'], true) })
  const base = h.props({ params: { line: 3 }, revision: 4 })
  const code: DocumentPreviewDefinition = {
    id: '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/code', extensions: ['ts'], title: () => 'Code', loading: 'text-pages', wrap: true,
  }
  const p: PreviewProps = {
    ...propsFor(h), useTabInfo: base.useTabInfo, candidates: () => [code], useDocumentPreviews: selector => selector([code, plain]),
    renderSlot: (_name, owner) => <CodeBody {...{ ...base, ...owner, t: makeTranslate(en) } as unknown as CodeProps} />,
  }
  const view = render(<Preview {...p} />)
  await settle(); await settle()
  expect(h.read).toHaveBeenCalledTimes(2)
  expect(view.container.querySelectorAll('pre .line')).toHaveLength(3)
  expect(h.instance.getSnapshot().byTab[TAB_ID]?.revision).toBe(4)
  const port = view.container.querySelector<HTMLElement>('[data-code-block-content]')!
  fireEvent.scroll(port, { target: { scrollTop: 75 } })
  expect(h.instance.getSnapshot().byTab[TAB_ID]?.scrollTop).toBe(75)
  view.unmount()
  const next = render(<Preview {...p} />)
  await settle()
  expect(next.container.querySelector('[data-code-block-content]')?.scrollTop).toBe(75)
  expect(h.read).toHaveBeenCalledTimes(2)
})

it('marks requested source lines, preserves empty files and declines byte bodies', () => {
  const h = harness(), base = h.props({ params: { line: 4 }, revision: 2 })
  const props = { ...base, wrap: true, content: { kind: 'text', pages: [
    { offset: 4, text: 'target', lines: 1 }, { offset: 5, text: '', lines: 0 },
  ], text: 'target', eof: true } } as unknown as DocumentProps
  const view = render(<TextBody {...props} />)
  expect(view.container.querySelector('[data-target="true"]')?.getAttribute('data-document-line')).toBe('4')
  expect(view.container.querySelectorAll('[data-document-line]')).toHaveLength(1)
  view.rerender(<TextBody {...props} useTabInfo={h.props({ params: {}, revision: 3 }).useTabInfo} />)
  expect(view.container.querySelector('[data-target="true"]')).toBeNull()
  view.rerender(<TextBody {...props} content={{ kind: 'bytes', data: new Uint8Array() }} />)
  expect(view.container.childElementCount).toBe(0)
})

it('keeps unavailable resources read-only and shows resource failure without diagnostics', async () => {
  const h = harness(), props = propsFor(h)
  h.useResource.mockReturnValue({ status: 'none', value: undefined, failure: undefined })
  const view = render(<Preview {...props} />)
  expect(screen.getByText(en.unavailable)).toBeTruthy()
  expect(screen.getByRole('button', { name: en.reload }).hasAttribute('disabled')).toBe(true)
  expect(h.read).not.toHaveBeenCalled()
  h.setFailure(new RemoteError('gateway/cancelled', 'private metadata', {}))
  h.useResource.mockImplementation(() => ({ status: 'failed', value: h.file, failure: new RemoteError('gateway/cancelled', 'private metadata', {}) }))
  h.script(1, page(1, ['available cached metadata'], true))
  view.rerender(<Preview {...props} />)
  await settle()
  expect(screen.getByText(en.failed)).toBeTruthy()
  expect(view.container.textContent).not.toContain('private metadata')
})

it('loads and reloads complete bytes and switches back to paged text', async () => {
  const h = harness({ 1: page(1, ['text interpretation'], true) }), byteData = new Uint8Array([1, 2])
  const binary: DocumentPreviewDefinition = { id: 'test-bytes', extensions: ['md'], title: () => 'Binary', loading: 'bytes-complete' }
  h.bytes.mockResolvedValue({ ok: true, value: {
    absolutePath: '/host/file', version: 'v1', data: btoa(String.fromCharCode(...byteData)), bytes: 2, offset: 0, eof: true,
  } })
  const paint = vi.fn<PreviewProps['renderSlot']>(() => <span data-complete-preview />)
  // Vitest mock 不保留槽位泛型重载，实际调用仍由已声明的 QS 文档槽提供。
  const props: PreviewProps = { ...propsFor(h), candidates: () => [binary], renderSlot: paint as PreviewProps['renderSlot'] }
  render(<Preview {...props} />)
  await settle()
  expect(h.bytes).toHaveBeenCalledTimes(1)
  expect(paint.mock.calls.at(-1)?.[1].content).toEqual({ kind: 'bytes', data: byteData })
  fireEvent.click(screen.getByRole('button', { name: en.reload }))
  await settle()
  expect(h.bytes).toHaveBeenCalledTimes(2)
  fireEvent.change(screen.getByRole('combobox'), { target: { value: plain.id } })
  await settle()
  expect(h.read).toHaveBeenCalledTimes(1)
  expect(paint.mock.calls.at(-1)?.[1].content.kind).toBe('text')
})

it('does not fetch without a registered reader and uses matching metadata without a text fallback', async () => {
  const h = harness({ 1: page(1, ['readable'], true) }), props = propsFor(h)
  const view = render(<Preview {...props} useDocumentPreviews={selector => selector([])} />)
  await settle()
  expect(h.read).not.toHaveBeenCalled()
  expect(screen.getByRole('combobox').children).toHaveLength(0)
  view.rerender(<Preview {...props} useDocumentPreviews={selector => selector([])} candidates={() => [plain]} />)
  await settle()
  expect(screen.getByRole('combobox').children).toHaveLength(1)
  expect(h.read).toHaveBeenCalledTimes(1)
})

it('paginates at the bottom but ignores nested scroll containers and an aborted tab', async () => {
  const h = harness({ 1: page(1, ['first'], false), 2: page(2, ['last'], true) })
  const view = render(<Preview {...propsFor(h)} />)
  await settle()
  const text = view.container.querySelector('[data-qs-document-text]')!, port = text.parentElement!
  fireEvent.scroll(text)
  expect(h.read).toHaveBeenCalledTimes(1)
  Object.defineProperties(port, { scrollHeight: { value: 200, configurable: true }, clientHeight: { value: 100, configurable: true } })
  fireEvent.scroll(port, { target: { scrollTop: 25 } })
  expect(h.read).toHaveBeenCalledTimes(1)
  await act(async () => { fireEvent.scroll(port, { target: { scrollTop: 100 } }) })
  expect(h.read).toHaveBeenCalledTimes(2)
  act(() => { h.controller.abort() })
  fireEvent.scroll(port)
  expect(h.read).toHaveBeenCalledTimes(2)
})

it('retries an initial failure only while resource reads are available', async () => {
  const h = harness(), props = propsFor(h)
  const view = render(<Preview {...props} />)
  await settle()
  expect(screen.getByRole('alert')).toBeTruthy()
  h.useResource.mockReturnValue({ status: 'none', value: undefined, failure: undefined })
  view.rerender(<Preview {...props} />)
  fireEvent.click(screen.getByRole('alert').querySelector('button')!)
  expect(h.read).toHaveBeenCalledTimes(1)
  h.useResource.mockReturnValue({ status: 'live', value: h.file!, failure: undefined })
  h.script(1, page(1, ['recovered initial read'], true))
  view.rerender(<Preview {...props} />)
  fireEvent.click(screen.getByRole('alert').querySelector('button')!)
  await settle()
  expect(screen.queryByRole('alert')).toBeNull()
  expect(view.container.textContent).toContain('recovered initial read')
})

it('waits for line DOM and settles a navigation beyond the end of file', async () => {
  const h = harness({ 1: page(1, ['one'], true) }), props = propsFor(h)
  const view = render(<Preview {...props} useTabInfo={h.props({ params: { line: 1 }, revision: 3 }).useTabInfo}
    renderSlot={() => <div data-delayed-body />} />)
  await settle()
  expect(h.instance.getSnapshot().byTab[TAB_ID]?.revision).not.toBe(3)
  view.rerender(<Preview {...props} useTabInfo={h.props({ params: { line: 50 }, revision: 4 }).useTabInfo} />)
  await settle()
  expect(h.instance.getSnapshot().byTab[TAB_ID]?.revision).toBe(4)
  expect(h.read).toHaveBeenCalledTimes(1)
})

it('rejects a resource address without a session before any Host read', () => {
  const h = harness(), props = propsFor(h), info = props.useTabInfo()
  // React 会将预期的 render 异常报告到控制台；仅本例抑制并在 afterEach 恢复。
  vi.spyOn(console, 'error').mockImplementation(() => {})
  expect(() => render(<Preview {...props} useTabInfo={() => ({
    ...info, tab: { ...info.tab, contentId: 'dsh-resource://file/absolute/tmp/file.txt' },
  })} />)).toThrow('Document preview requires a session file address')
  expect(h.read).not.toHaveBeenCalled()
  expect(h.bytes).not.toHaveBeenCalled()
})
