// @vitest-environment jsdom
// Branch coverage for the mdast renderer that real parses cannot reach: the
// grammar only emits references whose definitions exist, always stamps
// positions and align arrays, and never emits bare list items — but the
// renderer is a pure function over mdast, so hand-built trees exercise its
// defensive arms directly.
/**
 * 文件职责：验证UI 基础组件的 markdown-render-units.client.spec.tsx 行为。
 * 技术维度：Vitest、React 测试渲染、DOM 事件和服务替身。
 * 产品维度：防止UI 基础组件的展示、作用域或交互回归。
 * 逻辑维度：构造上下文与属性，渲染后断言状态和清理。
 * 关键边界：Provider、订阅、全局 DOM 与异步任务必须释放。
 * 新手阅读建议：先读辅助夹具，再按场景顺序阅读。
 */
import { StrictMode } from 'react'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type * as Md from 'mdast'
import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import {
  collectReferenceTargets, createReferenceTargets, renderBlocks, renderFootnoteSection,
} from '../src/markdown/render.tsx'
import type { MarkdownRenderContext } from '../src/markdown/render.tsx'

afterEach(cleanup)

/** 中文说明：函数 makeContext 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function makeContext(): MarkdownRenderContext {
  return {
    streaming: false,
    codeLabels: undefined,
    fileMentions: undefined,
    targets: createReferenceTargets(),
    footnoteOrder: [],
    footnoteCounts: new Map(),
  }
}

/** 中文说明：函数 renderNodes 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function renderNodes(nodes: Md.RootContent[], context = makeContext()): HTMLElement {
  /** 中文说明：测试局部值 { container }，由紧邻初始化决定。 */
  const { container } = render(
    <div>{renderBlocks(nodes.map((node, key) => ({ node, key })), context)}</div>,
  )
  return container
}

/** 中文说明：测试局部值 text，由紧邻初始化决定。 */
const text = (value: string): Md.Text => ({ type: 'text', value })

describe('renderBlocks over hand-built trees', () => {
  it('reverts unresolved references to their bracketed source', () => {
    /** 中文说明：测试局部值 container，由紧邻初始化决定。 */
    const container = renderNodes([
      {
        type: 'paragraph',
        children: [
          { type: 'linkReference', identifier: 'a', referenceType: 'shortcut', children: [text('one')] },
          { type: 'linkReference', identifier: 'b', referenceType: 'collapsed', children: [text('two')] },
          { type: 'linkReference', identifier: 'c', label: 'C', referenceType: 'full', children: [text('three')] },
          { type: 'imageReference', identifier: 'd', referenceType: 'full', alt: 'pic' },
          { type: 'imageReference', identifier: 'e', referenceType: 'shortcut', alt: null },
        ],
      },
    ])
    expect(container.textContent).toBe('[one][two][][three][C]![pic][d]![]')
    expect(container.querySelector('a')).toBeNull()
  })

  it('keeps the first definition when identifiers repeat', () => {
    /** 中文说明：测试局部值 targets，由紧邻初始化决定。 */
    const targets = createReferenceTargets()
    collectReferenceTargets([
      { type: 'definition', identifier: 'dup', url: 'https://example.com/first' },
      { type: 'definition', identifier: 'dup', url: 'https://example.com/second' },
      { type: 'footnoteDefinition', identifier: 'fn', children: [] },
      { type: 'footnoteDefinition', identifier: 'fn', children: [{ type: 'paragraph', children: [text('late')] }] },
    ], targets)
    expect(targets.definitions.get('DUP')?.url).toBe('https://example.com/first')
    expect(targets.footnotes.get('FN')?.children).toEqual([])
  })

  it('renders a bare list item, computing looseness from the item itself', () => {
    /** 中文说明：测试局部值 item，由紧邻初始化决定。 */
    const item: Md.ListItem = {
      type: 'listItem',
      spread: null,
      children: [
        { type: 'paragraph', children: [text('alpha')] },
        { type: 'paragraph', children: [text('beta')] },
      ],
    }
    /** 中文说明：测试局部值 container，由紧邻初始化决定。 */
    const container = renderNodes([item])
    // Two block children make the parentless item loose: paragraphs stay wrapped.
    expect([...container.querySelectorAll('li > p')].map(p => p.textContent)).toEqual(['alpha', 'beta'])
  })

  it('renders spread-null lists and align-less tables', () => {
    /** 中文说明：测试局部值 container，由紧邻初始化决定。 */
    const container = renderNodes([
      {
        type: 'list',
        ordered: false,
        spread: null,
        children: [{ type: 'listItem', spread: null, children: [{ type: 'paragraph', children: [text('solo')] }] }],
      },
      {
        type: 'table',
        children: [
          { type: 'tableRow', children: [{ type: 'tableCell', children: [text('h')] }] },
          { type: 'tableRow', children: [{ type: 'tableCell', children: [text('short')] }] },
        ],
      },
    ])
    expect(container.querySelector('li')?.textContent).toBe('solo')
    expect(container.querySelector('th')?.getAttribute('style')).toBeNull()
    expect(container.querySelector('td')?.textContent).toBe('short')
  })

  it('renders a rowless align-less table as an empty fill wrapper', () => {
    // Zero columns is below the wide threshold, so the fill arm applies.
    /** 中文说明：测试局部值 container，由紧邻初始化决定。 */
    const container = renderNodes([{ type: 'table', children: [] }])
    /** 中文说明：测试局部值 wrapper，由紧邻初始化决定。 */
    const wrapper = container.querySelector('table')?.parentElement
    expect(wrapper?.className).not.toContain('md-table-wide')
    expect(container.querySelector('table')?.childElementCount).toBe(0)
  })

  it('pads rows against the alignment width with empty cells', () => {
    /** 中文说明：测试局部值 container，由紧邻初始化决定。 */
    const container = renderNodes([
      {
        type: 'table',
        align: ['left', 'right'],
        children: [
          { type: 'tableRow', children: [{ type: 'tableCell', children: [text('only')] }] },
        ],
      },
    ])
    /** 中文说明：测试局部值 cells，由紧邻初始化决定。 */
    const cells = [...container.querySelectorAll('th')]
    expect(cells).toHaveLength(2)
    expect(cells[1]?.textContent).toBe('')
  })

  it('renders a checked item without any content as a bare checkbox', () => {
    /** 中文说明：测试局部值 container，由紧邻初始化决定。 */
    const container = renderNodes([
      {
        type: 'list',
        ordered: false,
        children: [
          { type: 'listItem', checked: true, children: [] },
          { type: 'listItem', checked: false, children: [{ type: 'paragraph', children: [] }] },
        ],
      },
    ])
    /** 中文说明：测试局部值 items，由紧邻初始化决定。 */
    const items = [...container.querySelectorAll('li.task-list-item')]
    expect(items).toHaveLength(2)
    /** 中文说明：测试局部值 item，由紧邻初始化决定。 */
    for (const item of items) {
      expect(item.querySelector('input[type="checkbox"]')).not.toBeNull()
      expect(item.textContent?.trim()).toBe('')
    }
  })

  it('renders images with a null alt as an empty alt attribute', () => {
    /** 中文说明：测试局部值 targets，由紧邻初始化决定。 */
    const targets = createReferenceTargets()
    targets.definitions.set('R', { type: 'definition', identifier: 'r', url: 'https://example.com/r.png' })
    /** 中文说明：测试局部值 container，由紧邻初始化决定。 */
    const container = renderNodes([
      { type: 'paragraph', children: [{ type: 'image', url: 'https://example.com/x.png', alt: null }] },
      { type: 'paragraph', children: [{ type: 'imageReference', identifier: 'r', referenceType: 'full', alt: null }] },
    ], { ...makeContext(), targets })
    /** 中文说明：测试局部值 images，由紧邻初始化决定。 */
    const images = [...container.querySelectorAll('img')]
    expect(images.map(image => image.getAttribute('alt'))).toEqual(['', ''])
  })

  it('drops a definition nested in a list item without leaving a separator behind', () => {
    /** 中文说明：测试局部值 container，由紧邻初始化决定。 */
    const container = renderNodes([
      {
        type: 'list',
        ordered: true,
        start: 3,
        children: [{
          type: 'listItem',
          children: [
            { type: 'paragraph', children: [text('body')] },
            { type: 'definition', identifier: 'x', url: 'https://example.com' },
          ],
        }],
      },
    ])
    expect(container.querySelector('ol')?.getAttribute('start')).toBe('3')
    // The two mdast children make the item loose (wrap newlines around the
    // paragraph); the dropped definition contributes nothing else.
    expect(container.querySelector('li')?.textContent).toBe('\nbody\n')
  })

  it('renders nothing for node types without a mapping', () => {
    /** 中文说明：测试局部值 container，由紧邻初始化决定。 */
    const container = renderNodes([
      { type: 'yaml', value: 'front: matter' },
      { type: 'tableRow', children: [] },
      { type: 'paragraph', children: [text('after')] },
    ])
    expect(container.textContent).toBe('after')
  })
})

describe('renderFootnoteSection edge shapes', () => {
  it('skips referenced footnotes without definitions and returns null when none remain', () => {
    /** 中文说明：测试局部值 context，由紧邻初始化决定。 */
    const context = makeContext()
    context.footnoteOrder.push('GHOST')
    context.footnoteCounts.set('GHOST', 1)
    expect(renderFootnoteSection(context)).toBeNull()
  })

  it('renders no back-reference markers for an uncounted footnote', () => {
    /** 中文说明：测试局部值 context，由紧邻初始化决定。 */
    const context = makeContext()
    context.targets.footnotes.set('Q', {
      type: 'footnoteDefinition',
      identifier: 'q',
      children: [{ type: 'paragraph', children: [text('quiet')] }],
    })
    context.footnoteOrder.push('Q')
    /** 中文说明：测试局部值 { container }，由紧邻初始化决定。 */
    const { container } = render(<div>{renderFootnoteSection(context)}</div>)
    expect(container.querySelector('li')?.textContent).toBe('\nquiet \n')
  })

  it('appends back-references after a non-paragraph body', () => {
    /** 中文说明：测试局部值 context，由紧邻初始化决定。 */
    const context = makeContext()
    context.targets.footnotes.set('N', {
      type: 'footnoteDefinition',
      identifier: 'n',
      children: [{ type: 'code', value: 'code body', lang: null }],
    })
    context.footnoteOrder.push('N')
    context.footnoteCounts.set('N', 1)
    /** 中文说明：测试局部值 { container }，由紧邻初始化决定。 */
    const { container } = render(<div>{renderFootnoteSection(context)}</div>)
    /** 中文说明：测试局部值 item，由紧邻初始化决定。 */
    const item = container.querySelector('li')
    expect(item?.querySelector('.md-code-block')).not.toBeNull()
    expect(item?.textContent).toContain('↩')
  })
})

describe('MarkdownText under StrictMode', () => {
  it('streams identically when React double-invokes render work', () => {
    /** 中文说明：测试局部值 doc，由紧邻初始化决定。 */
    const doc = 'one\n\ntwo\n\nthree\n\nfour\n\nfive'
    /** 中文说明：测试局部值 strict，由紧邻初始化决定。 */
    const strict = render(<StrictMode><MarkdownText text={doc.slice(0, 8)} streaming /></StrictMode>)
    strict.rerender(<StrictMode><MarkdownText text={doc} streaming /></StrictMode>)
    /** 中文说明：测试局部值 plain，由紧邻初始化决定。 */
    const plain = render(<MarkdownText text={doc} streaming />)
    expect(strict.container.innerHTML).toBe(plain.container.innerHTML)
    strict.unmount()
    plain.unmount()
  })
})
