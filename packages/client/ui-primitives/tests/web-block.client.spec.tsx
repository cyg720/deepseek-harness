// @vitest-environment jsdom
// WebBlock: both kinds of the web card. The search card's answer, its citation
// list with the title-or-hostname label fallback and optional snippet/date, the
// full source list under one <ol>, and the truncated indicator; the fetch
// card's linked URL, status, and truncation. Safe-link
// attributes on both kinds: an http(s) URL becomes an external anchor
// (target/rel), any other URL renders as plain text with no href.
/**
 * 文件职责：验证UI 基础组件的 web-block.client.spec.tsx 行为。
 * 技术维度：Vitest、React 测试渲染、DOM 事件和服务替身。
 * 产品维度：防止UI 基础组件的展示、作用域或交互回归。
 * 逻辑维度：构造上下文与属性，渲染后断言状态和清理。
 * 关键边界：Provider、订阅、全局 DOM 与异步任务必须释放。
 * 新手阅读建议：先读辅助夹具，再按场景顺序阅读。
 */

import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { WebBlock } from '../src/index.ts'
import type { WebSourceView } from '../src/index.ts'

afterEach(cleanup)

/** `count` sources with sequential hostnames, so each row reads distinctly. */
/** 中文说明：函数 sources 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function sources(count: number): WebSourceView[] {
  return Array.from({ length: count }, (_value, index) => ({
    url: `https://site-${index}.example.com/page`,
    title: `Source ${index}`,
  }))
}

describe('WebBlock search card', () => {
  it('renders the answer above the citation list', () => {
    /** 中文说明：测试局部值 view，由紧邻初始化决定。 */
    const view = render(<WebBlock kind="search" answer="**Answer** text" sources={sources(2)} truncated={false} />)
    expect(view.getByText('Answer')).toBeTruthy()
    expect(view.getByText('Source 0')).toBeTruthy()
    expect(view.getByText('Source 1')).toBeTruthy()
  })

  it('omits the answer block when there is no answer', () => {
    /** 中文说明：测试局部值 view，由紧邻初始化决定。 */
    const view = render(<WebBlock kind="search" sources={sources(1)} truncated={false} />)
    expect(view.container.querySelector('[class^="_answer_"]')).toBeNull()
    /** 中文说明：测试局部值 empty，由紧邻初始化决定。 */
    const empty = render(<WebBlock kind="search" answer="" sources={sources(1)} truncated={false} />)
    expect(empty.container.querySelector('[class^="_answer_"]')).toBeNull()
  })

  it('shows the empty-state note when a search returns no answer and no sources', () => {
    /** 中文说明：测试局部值 view，由紧邻初始化决定。 */
    const view = render(<WebBlock kind="search" sources={[]} truncated={false} />)
    expect(view.getByText('未找到结果')).toBeTruthy()
    // The empty note replaces the source list, not an empty <ol>.
    expect(view.container.querySelector('ol')).toBeNull()
  })

  it('shows the source list, not the empty note, when a source is present', () => {
    /** 中文说明：测试局部值 view，由紧邻初始化决定。 */
    const view = render(<WebBlock kind="search" sources={sources(1)} truncated={false} />)
    expect(view.container.querySelector('ol')).toBeTruthy()
    expect(view.queryByText('未找到结果')).toBeNull()
  })

  it('shows the source list when an empty source list still carries an answer', () => {
    /** 中文说明：测试局部值 view，由紧邻初始化决定。 */
    const view = render(<WebBlock kind="search" answer="Just an answer" sources={[]} truncated={false} />)
    expect(view.getByText('Just an answer')).toBeTruthy()
    expect(view.queryByText('未找到结果')).toBeNull()
  })

  it('labels a source by its title, and by hostname when the title is absent', () => {
    /** 中文说明：测试局部值 view，由紧邻初始化决定。 */
    const view = render(<WebBlock kind="search" truncated={false} sources={[
      { url: 'https://example.com/a', title: 'Titled' },
      { url: 'https://plain.example.org/b' },
      { url: 'https://empty.example.net/c', title: '' },
    ]} />)
    expect(view.getByText('Titled')).toBeTruthy()
    // No title / empty title: the hostname labels the link.
    expect(view.getByText('plain.example.org')).toBeTruthy()
    expect(view.getByText('empty.example.net')).toBeTruthy()
  })

  it('labels a source by the raw url when it parses to an empty hostname', () => {
    // file:/data:/javascript: URLs parse but have no hostname; the label must
    // fall back to the raw URL so it is never blank (and the link stays plain
    // text since the protocol is not http(s)).
    /** 中文说明：测试局部值 view，由紧邻初始化决定。 */
    const view = render(<WebBlock kind="search" truncated={false} sources={[
      { url: 'file:///etc/passwd' },
    ]} />)
    expect(view.getByText('file:///etc/passwd')).toBeTruthy()
  })

  it('renders a source as a safe external anchor for an http(s) url', () => {
    /** 中文说明：测试局部值 view，由紧邻初始化决定。 */
    const view = render(<WebBlock kind="search" truncated={false} sources={[
      { url: 'https://example.com/a', title: 'Titled' },
    ]} />)
    /** 中文说明：测试局部值 anchor，由紧邻初始化决定。 */
    const anchor = view.getByText('Titled') as HTMLAnchorElement
    expect(anchor.tagName).toBe('A')
    expect(anchor.getAttribute('href')).toBe('https://example.com/a')
    expect(anchor.getAttribute('target')).toBe('_blank')
    expect(anchor.getAttribute('rel')).toBe('noopener noreferrer')
  })

  it('renders a non-http url as plain text with no href, and its raw text label when unparseable', () => {
    /** 中文说明：测试局部值 view，由紧邻初始化决定。 */
    const view = render(<WebBlock kind="search" truncated={false} sources={[
      { url: 'javascript:alert(1)', title: 'Dangerous' },
      { url: 'not a url' },
    ]} />)
    /** 中文说明：测试局部值 unsafe，由紧邻初始化决定。 */
    const unsafe = view.getByText('Dangerous')
    expect(unsafe.tagName).toBe('SPAN')
    expect(unsafe.getAttribute('href')).toBeNull()
    // An unparseable url is not a link and cannot yield a hostname, so its raw
    // text is the label.
    /** 中文说明：测试局部值 raw，由紧邻初始化决定。 */
    const raw = view.getByText('not a url')
    expect(raw.tagName).toBe('SPAN')
  })

  it('shows a source snippet and publication date when present, and omits them when absent or empty', () => {
    /** 中文说明：测试局部值 view，由紧邻初始化决定。 */
    const view = render(<WebBlock kind="search" truncated={false} sources={[
      { url: 'https://a.example.com', title: 'A', snippet: 'excerpt', publishedAt: '2026-07-01' },
      { url: 'https://b.example.com', title: 'B', snippet: '', publishedAt: '' },
      { url: 'https://c.example.com', title: 'C' },
    ]} />)
    expect(view.getByText('excerpt')).toBeTruthy()
    expect(view.getByText('2026-07-01')).toBeTruthy()
    // The empty-string and absent arms both draw nothing beyond the link.
    expect(view.container.querySelectorAll('[class^="_snippet_"]')).toHaveLength(1)
    expect(view.container.querySelectorAll('[class^="_published_"]')).toHaveLength(1)
  })

  it('shows the truncated indicator only when the list was capped by the tool', () => {
    /** 中文说明：测试局部值 on，由紧邻初始化决定。 */
    const on = render(<WebBlock kind="search" sources={sources(1)} truncated />)
    expect(on.getByText('来源列表已截断')).toBeTruthy()
    cleanup()
    /** 中文说明：测试局部值 off，由紧邻初始化决定。 */
    const off = render(<WebBlock kind="search" sources={sources(1)} truncated={false} />)
    expect(off.queryByText('来源列表已截断')).toBeNull()
  })

  it('renders every source in one <ol> with no expand control', () => {
    // The card shows the whole list the tool returned, with no head/tail
    // collapse and no expand button. jsdom does not resolve the CSS Modules
    // layout, so the scroll geometry the `.sources` max-height produces is
    // pinned by the assembled browser case in apps/web/tests/web-search-round.e2e.ts,
    // not here.
    /** 中文说明：测试局部值 view，由紧邻初始化决定。 */
    const view = render(<WebBlock kind="search" sources={sources(30)} truncated={false} />)
    expect(view.container.querySelectorAll('li[class^="_source_"]')).toHaveLength(30)
    expect(view.container.querySelector('[aria-expanded]')).toBeNull()
    expect(view.container.querySelector('button')).toBeNull()
    // Every direct child of the <ol> is a source <li> (no marker-less expander).
    /** 中文说明：测试局部值 ol，由紧邻初始化决定。 */
    const ol = view.container.querySelector('ol')!
    expect([...ol.children].every(child => child.tagName === 'LI')).toBe(true)
  })

  it('numbers every source by its 1-based citation index via <li value>', () => {
    /** 中文说明：测试局部值 view，由紧邻初始化决定。 */
    const view = render(<WebBlock kind="search" sources={sources(4)} truncated={false} />)
    /** 中文说明：测试局部值 items，由紧邻初始化决定。 */
    const items = [...view.container.querySelectorAll('li[class^="_source_"]')]
    expect(items.map(li => li.getAttribute('value'))).toEqual(['1', '2', '3', '4'])
  })
})

describe('WebBlock fetch card', () => {
  it('renders the fetched url as a safe external anchor and its HTTP status', () => {
    /** 中文说明：测试局部值 view，由紧邻初始化决定。 */
    const view = render(<WebBlock kind="fetch" url="https://example.com/page" statusCode={200} truncated={false} />)
    /** 中文说明：测试局部值 anchor，由紧邻初始化决定。 */
    const anchor = view.getByText('https://example.com/page') as HTMLAnchorElement
    expect(anchor.tagName).toBe('A')
    expect(anchor.getAttribute('href')).toBe('https://example.com/page')
    expect(anchor.getAttribute('target')).toBe('_blank')
    expect(anchor.getAttribute('rel')).toBe('noopener noreferrer')
    expect(view.getByText('HTTP 200')).toBeTruthy()
  })

  it('renders a non-http fetch url as plain text with no href', () => {
    /** 中文说明：测试局部值 view，由紧邻初始化决定。 */
    const view = render(<WebBlock kind="fetch" url="file:///etc/passwd" statusCode={200} truncated={false} />)
    /** 中文说明：测试局部值 label，由紧邻初始化决定。 */
    const label = view.getByText('file:///etc/passwd')
    expect(label.tagName).toBe('SPAN')
    expect(label.getAttribute('href')).toBeNull()
  })

  it('shows the truncated indicator only when the content was cut', () => {
    /** 中文说明：测试局部值 on，由紧邻初始化决定。 */
    const on = render(<WebBlock kind="fetch" url="https://example.com" statusCode={200} truncated />)
    expect(on.getByText('内容已截断')).toBeTruthy()
    cleanup()
    /** 中文说明：测试局部值 off，由紧邻初始化决定。 */
    const off = render(<WebBlock kind="fetch" url="https://example.com" statusCode={200} truncated={false} />)
    expect(off.queryByText('内容已截断')).toBeNull()
  })

  it('carries a non-200 status verbatim', () => {
    /** 中文说明：测试局部值 view，由紧邻初始化决定。 */
    const view = render(<WebBlock kind="fetch" url="https://example.com/missing" statusCode={404} truncated={false} />)
    expect(view.getByText('HTTP 404')).toBeTruthy()
  })
})
