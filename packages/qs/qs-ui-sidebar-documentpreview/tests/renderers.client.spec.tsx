// @vitest-environment jsdom
/** 使用真实公共渲染器验证 Markdown 安全处理和源码增量高亮。 */
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { CODE_EXTENSIONS, languageForPath as officialLanguage } from '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/src/client/code/languages.ts'
import type { DocumentContent } from '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/client'
import { MarkdownBody } from '../src/client/markdown/index.tsx'
import type { MarkdownProps } from '../src/client/markdown/index.tsx'
import { CodeBody } from '../src/client/code/index.tsx'
import type { CodeProps } from '../src/client/code/index.tsx'
import { languageForPath } from '../src/client/code/languages.ts'
import { en, zh } from '../src/client/locales.ts'

afterEach(cleanup)
function contents(text: string, eof = true): DocumentContent {
  return { kind: 'text', text, pages: [{ offset: 1, text, lines: text.split('\n').length }], eof }
}
function props(content: DocumentContent): CodeProps & MarkdownProps {
  // 文档正文只消费 owner 字段；标准框架其余成员不参与此渲染器回归。
  return { content, t: makeTranslate(en), resourceAddress: 'dsh-resource://file/session/renderers/source.ts',
    wrap: false, scrollportRef: vi.fn() } as unknown as CodeProps & MarkdownProps
}
it('renders headings, tasks, cross-page links and locale-owned chrome without raw HTML execution', () => {
  const first = '# Notes\n\n- [x] Done\n\nRead [guide][ref].\n\n<script>window.bad=1</script>\n\n[unsafe](javascript:alert(1))'
  const view = render(<MarkdownBody {...props(contents(first, false))} />)
  expect(view.getByRole('heading', { name: 'Notes' })).toBeTruthy()
  expect((view.getByRole('checkbox') as HTMLInputElement).checked).toBe(true)
  expect(view.container.querySelector('script')).toBeNull()
  expect(view.container.querySelector('a[href^="javascript:"]')).toBeNull()
  const complete = first + '\n\n[ref]: https://example.test/guide\n\n```ts\nconst n = 1\n```\n\nNote[^1].\n\n[^1]: Detail'
  view.rerender(<MarkdownBody {...props(contents(complete))} />)
  expect(view.getByRole('link', { name: 'guide' }).getAttribute('href')).toBe('https://example.test/guide')
  expect(view.getByRole('button', { name: en.copy })).toBeTruthy()
  expect(view.getByRole('heading', { name: en.footnotes })).toBeTruthy()
  view.rerender(<MarkdownBody {...props(contents(complete))} t={makeTranslate(zh)} />)
  expect(view.getByRole('button', { name: zh.copy })).toBeTruthy()
})
it('keeps the highlighted source mounted as pages extend and reports its scrollport', () => {
  const first = 'const a = 1;\n/* comment', p = props(contents(first, false))
  const view = render(<CodeBody {...p} />)
  const pre = view.container.querySelector('pre.shiki'), row = pre?.querySelector('.line')
  expect(view.getByText('typescript')).toBeTruthy()
  expect(p.scrollportRef).toHaveBeenCalledWith(view.container.querySelector('[data-code-block-content]'))
  expect(row?.textContent).toBe('const a = 1;')
  const complete = first + '\ncontinued */\nconst b = 2;'
  view.rerender(<CodeBody {...p} content={contents(complete, false)} wrap />)
  expect(view.container.querySelector('pre.shiki')).toBe(pre)
  expect(pre?.querySelector('.line')).toBe(row)
  expect(pre?.textContent).toContain('continued */')
  view.rerender(<CodeBody {...p} content={contents(complete)} wrap />)
  expect(view.container.querySelector('pre.shiki')).toBe(pre)
  expect(view.container.querySelector('[data-qs-document-code]')?.getAttribute('data-wrap')).toBe('true')
  view.unmount()
  expect(p.scrollportRef).toHaveBeenLastCalledWith(null)
})
it('rejects byte delivery and invalid code addresses', () => {
  const bytes = props({ kind: 'bytes', data: new Uint8Array([0]) })
  const view = render(<><MarkdownBody {...bytes} /><CodeBody {...bytes} /></>)
  expect(view.container.textContent).toBe('')
  expect(() => CodeBody({ ...props(contents('plain')), resourceAddress: 'invalid' })).toThrow('file address')
})
it('keeps every official grammar mapping including compound paths and unknown suffixes', () => {
  for (const ext of CODE_EXTENSIONS) {
    const path = `C:\\project\\source.${ext.toUpperCase()}`
    expect(languageForPath(path)).toBe(officialLanguage(path))
  }
  expect(languageForPath('README')).toBeUndefined()
  expect(languageForPath('unknown.custom')).toBeUndefined()
})
