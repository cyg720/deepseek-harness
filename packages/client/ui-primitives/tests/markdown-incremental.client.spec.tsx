// @vitest-environment jsdom
// Incremental streaming behavior: a MarkdownText kept mounted across
// append-only rerenders must show, at every step, exactly the DOM a fresh
// mount of the same prefix shows, while reusing the frozen blocks' DOM nodes
// instead of remounting them.
/**
 * 文件职责：验证UI 基础组件的 markdown-incremental.client.spec.tsx 行为。
 * 技术维度：Vitest、React 测试渲染、DOM 事件和服务替身。
 * 产品维度：防止UI 基础组件的展示、作用域或交互回归。
 * 逻辑维度：构造上下文与属性，渲染后断言状态和清理。
 * 关键边界：Provider、订阅、全局 DOM 与异步任务必须释放。
 * 新手阅读建议：先读辅助夹具，再按场景顺序阅读。
 */
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { Root, RootContent } from 'mdast'
import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import { IncrementalMarkdownParser } from '../src/markdown/incremental.ts'
import { parseGfm } from '../src/markdown/parse.ts'

afterEach(cleanup)

/**
 * A many-block document exercising every freeze-sensitive construct. The
 * prefix-equivalence property below holds only while no reference or
 * footnote definition lands on the far side of a freeze boundary from its
 * use: a fresh mount parses everything in one tree while the live stream's
 * frozen blocks are already baked (the fingerprint test demonstrates the
 * documented deviation). Keep definitions adjacent to their references when
 * extending this corpus.
 */
/** 中文说明：测试局部值 STREAM_DOC，由紧邻初始化决定。 */
const STREAM_DOC = [
  '# Title',
  '',
  'First paragraph with **strong** and `code`.',
  '',
  '- list item one',
  '- list item two',
  '',
  '  continuation of item two',
  '',
  'Setext heading',
  '===',
  '',
  '| a | b |',
  '| --- | --- |',
  '| 1 | 2 |',
  '',
  '```ts',
  'const x = 1',
  '',
  'still inside the fence',
  '```',
  '',
  '> quote with lazy',
  'continuation line',
  '',
  'Uses a footnote[^n] twice[^n].',
  '',
  '[^n]: The footnote body.',
  '',
  'Closing paragraph after enough blocks to freeze everything above.',
  '',
  'One more tail block.',
].join('\n')

describe('incremental streaming rendering', () => {
  /** 中文说明：测试局部值 chunkSize，由紧邻初始化决定。 */
  for (const chunkSize of [1, 3, 7, 16]) {
    it(`matches a fresh render at every prefix (chunk=${chunkSize})`, { timeout: 20_000 }, () => {
      /** 中文说明：测试局部值 live，由紧邻初始化决定。 */
      const live = render(<MarkdownText text="" streaming />)
      /** 中文说明：测试局部值 end，由紧邻初始化决定。 */
      for (let end = chunkSize; end < STREAM_DOC.length + chunkSize; end += chunkSize) {
        /** 中文说明：测试局部值 prefix，由紧邻初始化决定。 */
        const prefix = STREAM_DOC.slice(0, Math.min(end, STREAM_DOC.length))
        live.rerender(<MarkdownText text={prefix} streaming />)
        /** 中文说明：测试局部值 fresh，由紧邻初始化决定。 */
        const fresh = render(<MarkdownText text={prefix} streaming />)
        expect(live.container.innerHTML).toBe(fresh.container.innerHTML)
        fresh.unmount()
      }
      live.unmount()
    })
  }

  it('keeps frozen block DOM nodes across freezes instead of remounting', () => {
    /** 中文说明：测试局部值 paragraphs，由紧邻初始化决定。 */
    const paragraphs = Array.from({ length: 8 }, (_, i) => `Paragraph number ${i}.`)
    /** 中文说明：测试局部值 first，由紧邻初始化决定。 */
    const first = `${paragraphs[0]}\n\n`
    /** 中文说明：测试局部值 live，由紧邻初始化决定。 */
    const live = render(<MarkdownText text={first} streaming />)
    /** 中文说明：测试局部值 firstBlock，由紧邻初始化决定。 */
    const firstBlock = live.container.querySelector('p')
    expect(firstBlock?.textContent).toBe(paragraphs[0])
    live.rerender(<MarkdownText text={paragraphs.join('\n\n')} streaming />)
    // Same DOM node instance: the block kept its key across the freeze boundary.
    expect(live.container.querySelector('p')).toBe(firstBlock)
    expect(live.container.querySelectorAll('p')).toHaveLength(paragraphs.length)
    live.unmount()
  })

  it('recovers when the text diverges instead of appending', () => {
    /** 中文说明：测试局部值 live，由紧邻初始化决定。 */
    const live = render(<MarkdownText text={'alpha\n\nbeta\n\ngamma\n\ndelta'} streaming />)
    live.rerender(<MarkdownText text={'totally\n\ndifferent\n\ndocument'} streaming />)
    /** 中文说明：测试局部值 fresh，由紧邻初始化决定。 */
    const fresh = render(<MarkdownText text={'totally\n\ndifferent\n\ndocument'} streaming />)
    expect(live.container.innerHTML).toBe(fresh.container.innerHTML)
    live.unmount()
    fresh.unmount()
  })

  it('drops the streaming cache when the copy labels change identity', () => {
    /** 中文说明：测试局部值 doc，由紧邻初始化决定。 */
    const doc = ['```ts', 'const a = 1', '```', '', 'p1', '', 'p2', '', 'p3'].join('\n')
    /** 中文说明：测试局部值 live，由紧邻初始化决定。 */
    const live = render(<MarkdownText text={doc} streaming codeLabels={{ copyLabel: 'Copy' }} />)
    expect([...live.container.querySelectorAll('button')].map(b => b.textContent)).toEqual(['Copy'])
    live.rerender(<MarkdownText text={doc} streaming codeLabels={{ copyLabel: 'Kopieren' }} />)
    expect([...live.container.querySelectorAll('button')].map(b => b.textContent)).toEqual(['Kopieren'])
    live.unmount()
  })

  it('settles into the full math-enabled render after streaming', () => {
    /** 中文说明：测试局部值 doc，由紧邻初始化决定。 */
    const doc = 'Value $E = mc^2$ inline.\n\nSecond.\n\nThird.\n\nFourth.'
    /** 中文说明：测试局部值 live，由紧邻初始化决定。 */
    const live = render(<MarkdownText text={doc} streaming />)
    expect(live.container.querySelector('.katex')).toBeNull()
    live.rerender(<MarkdownText text={doc} />)
    /** 中文说明：测试局部值 settled，由紧邻初始化决定。 */
    const settled = render(<MarkdownText text={doc} />)
    expect(live.container.innerHTML).toBe(settled.container.innerHTML)
    expect(live.container.querySelector('.katex')).not.toBeNull()
    live.unmount()
    settled.unmount()
  })
})

describe('incremental parsing is actually in effect', () => {
  it('hands the grammar only the source tail once blocks freeze', () => {
    /** 中文说明：测试局部值 calls，由紧邻初始化决定。 */
    const calls: string[] = []
    /** 中文说明：测试局部值 recording，由紧邻初始化决定。 */
    const recording = (text: string): Root => {
      calls.push(text)
      return parseGfm(text)
    }
    /** 中文说明：测试局部值 parser，由紧邻初始化决定。 */
    const parser = new IncrementalMarkdownParser(recording)
    /** 中文说明：测试局部值 paragraphs，由紧邻初始化决定。 */
    const paragraphs = Array.from({ length: 40 }, (_, i) => `Paragraph number ${i} with some words.`)
    /** 中文说明：测试局部值 text，由紧邻初始化决定。 */
    let text = ''
    /** 中文说明：测试局部值 paragraph，由紧邻初始化决定。 */
    for (const paragraph of paragraphs) {
      text += `${paragraph}\n\n`
      parser.update(text)
    }
    expect(text.length).toBeGreaterThan(1500)
    // Warm-up aside, every parse sees only the unstable tail: bounded by a
    // few paragraphs, not the growing document.
    /** 中文说明：测试局部值 steady，由紧邻初始化决定。 */
    const steady = calls.slice(5)
    expect(Math.max(...steady.map(call => call.length))).toBeLessThan(200)
    expect(steady.every(call => !call.includes('Paragraph number 0 '))).toBe(true)
    // Cumulative parsed bytes stay linear in the document; full re-parsing
    // would have accumulated ~40/2 times the document length here.
    /** 中文说明：测试局部值 totalParsed，由紧邻初始化决定。 */
    const totalParsed = calls.reduce((sum, call) => sum + call.length, 0)
    expect(totalParsed).toBeLessThan(text.length * 5)
  })

  it('shows the documented streaming fingerprint: a definition frozen earlier no longer resolves a new reference, and settling heals it', () => {
    /** 中文说明：测试局部值 doc，由紧邻初始化决定。 */
    const doc = [
      '[ref]: https://example.com/target',
      '',
      'Paragraph one keeps the definition company.',
      '',
      'Paragraph two pushes the freeze boundary.',
      '',
      'Paragraph three freezes the definition out.',
      '',
      'See [the link][ref] for details.',
    ].join('\n')
    /** 中文说明：测试局部值 head，由紧邻初始化决定。 */
    const head = doc.slice(0, doc.indexOf('See'))
    /** 中文说明：测试局部值 live，由紧邻初始化决定。 */
    const live = render(<MarkdownText text={head} streaming />)
    live.rerender(<MarkdownText text={doc} streaming />)
    // The tail re-parse cannot see the frozen definition, so the reference
    // stays literal — the direct observable that the whole text was NOT
    // re-parsed (a one-shot mount of the same text resolves it).
    expect(live.container.querySelector('a')).toBeNull()
    expect(live.container.textContent).toContain('[the link][ref]')
    /** 中文说明：测试局部值 fresh，由紧邻初始化决定。 */
    const fresh = render(<MarkdownText text={doc} streaming />)
    expect(fresh.container.querySelector('a')?.getAttribute('href')).toBe('https://example.com/target')
    fresh.unmount()
    // The settled swap re-parses everything and heals the deviation.
    live.rerender(<MarkdownText text={doc} />)
    expect(live.container.querySelector('a')?.getAttribute('href')).toBe('https://example.com/target')
    live.unmount()
  })
})

describe('freeze dynamics around frontier-sensitive constructs', () => {
  it('an unclosed fence pins the tail: nothing freezes until it closes', () => {
    /** 中文说明：测试局部值 parser，由紧邻初始化决定。 */
    const parser = new IncrementalMarkdownParser(parseGfm)
    /** 中文说明：测试局部值 text，由紧邻初始化决定。 */
    let text = 'p1.\n\np2.\n\np3.\n\n```ts\n'
    /** 中文说明：测试局部值 opened，由紧邻初始化决定。 */
    const opened = parser.update(text)
    /** 中文说明：测试局部值 frozenAtOpen，由紧邻初始化决定。 */
    const frozenAtOpen = opened.frozen.length
    expect(opened.tail[opened.tail.length - 1]?.node.type).toBe('code')
    /** 中文说明：测试局部值 line，由紧邻初始化决定。 */
    for (const line of ['const a = 1\n', '\n', 'looks like a paragraph\n', '- looks like a list\n']) {
      text += line
      /** 中文说明：测试局部值 grown，由紧邻初始化决定。 */
      const grown = parser.update(text)
      // The fence swallows everything appended, so the block census cannot
      // grow and the freeze boundary must hold still.
      expect(grown.frozen.length).toBe(frozenAtOpen)
      expect(grown.tail[grown.tail.length - 1]?.node.type).toBe('code')
    }
    text += '```\n\nafter one.\n\nafter two.\n'
    /** 中文说明：测试局部值 closed，由紧邻初始化决定。 */
    const closed = parser.update(text)
    expect(closed.frozen.length).toBeGreaterThan(frozenAtOpen)
    /** 中文说明：测试局部值 frozenCode，由紧邻初始化决定。 */
    const frozenCode = closed.frozen.find(block => block.node.type === 'code')?.node
    expect(frozenCode?.type === 'code' && frozenCode.value).toContain('looks like a list')
  })

  it('a list can keep extending across blank lines until it freezes whole', () => {
    /** 中文说明：测试局部值 parser，由紧邻初始化决定。 */
    const parser = new IncrementalMarkdownParser(parseGfm)
    /** 中文说明：测试局部值 text，由紧邻初始化决定。 */
    let text = 'intro.\n\nsecond.\n\nthird.\n\n- item a\n- item b\n'
    /** 中文说明：测试局部值 before，由紧邻初始化决定。 */
    const before = parser.update(text)
    /** 中文说明：测试局部值 frozenBefore，由紧邻初始化决定。 */
    const frozenBefore = before.frozen.length
    text += '\n- item c\n'
    /** 中文说明：测试局部值 extended，由紧邻初始化决定。 */
    const extended = parser.update(text)
    expect(extended.frozen.length).toBe(frozenBefore)
    /** 中文说明：测试局部值 tailList，由紧邻初始化决定。 */
    const tailList = extended.tail[extended.tail.length - 1]?.node
    expect(tailList?.type === 'list' && tailList.children).toHaveLength(3)
    text += '\nafter.\n\nmore.\n\nend.\n'
    /** 中文说明：测试局部值 after，由紧邻初始化决定。 */
    const after = parser.update(text)
    /** 中文说明：测试局部值 frozenList，由紧邻初始化决定。 */
    const frozenList = after.frozen.find(block => block.node.type === 'list')?.node
    expect(frozenList?.type === 'list' && frozenList.children).toHaveLength(3)
  })

  it('keeps every previously frozen key as a stable prefix across the stream', () => {
    /** 中文说明：测试局部值 parser，由紧邻初始化决定。 */
    const parser = new IncrementalMarkdownParser(parseGfm)
    /** 中文说明：测试局部值 previous，由紧邻初始化决定。 */
    let previous: readonly number[] = []
    /** 中文说明：测试局部值 end，由紧邻初始化决定。 */
    for (let end = 7; end < STREAM_DOC.length + 7; end += 7) {
      /** 中文说明：测试局部值 { frozen }，由紧邻初始化决定。 */
      const { frozen } = parser.update(STREAM_DOC.slice(0, Math.min(end, STREAM_DOC.length)))
      /** 中文说明：测试局部值 keys，由紧邻初始化决定。 */
      const keys = frozen.map(block => block.key)
      expect(keys.slice(0, previous.length)).toEqual(previous)
      previous = keys
    }
    expect(previous.length).toBeGreaterThan(4)
  })
})

describe('multibyte content', () => {
  /** 中文说明：测试局部值 CJK_DOC，由紧邻初始化决定。 */
  const CJK_DOC = [
    '# 标题 🎉',
    '',
    '这是一段包含 **加粗**、`行内代码` 与表情 😀🚀 的中文段落。',
    '',
    '- 列表项一 ✅',
    '- 列表项二',
    '',
    '> 引用一行,带表情 🐟',
    '',
    '```',
    '中文代码 🎯',
    '```',
    '',
    '| 键 | 值 |',
    '| --- | --- |',
    '| 甲 | 乙 |',
    '',
    '结尾段落,足够多的块让前面全部冻结。🌊',
  ].join('\n')

  it('code-unit chunking (splitting surrogate pairs mid-stream) matches fresh renders', () => {
    /** 中文说明：测试局部值 live，由紧邻初始化决定。 */
    const live = render(<MarkdownText text="" streaming />)
    /** 中文说明：测试局部值 end，由紧邻初始化决定。 */
    for (let end = 1; end < CJK_DOC.length + 1; end += 1) {
      /** 中文说明：测试局部值 prefix，由紧邻初始化决定。 */
      const prefix = CJK_DOC.slice(0, Math.min(end, CJK_DOC.length))
      live.rerender(<MarkdownText text={prefix} streaming />)
      /** 中文说明：测试局部值 fresh，由紧邻初始化决定。 */
      const fresh = render(<MarkdownText text={prefix} streaming />)
      expect(live.container.innerHTML).toBe(fresh.container.innerHTML)
      fresh.unmount()
    }
    live.unmount()
  })

  it('freeze-cut offsets agree with one-shot parse offsets on astral content', () => {
    /** 中文说明：测试局部值 parser，由紧邻初始化决定。 */
    const parser = new IncrementalMarkdownParser(parseGfm)
    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    let result = parser.update(CJK_DOC.slice(0, 3))
    /** 中文说明：测试局部值 end，由紧邻初始化决定。 */
    for (let end = 6; end < CJK_DOC.length + 3; end += 3) {
      result = parser.update(CJK_DOC.slice(0, Math.min(end, CJK_DOC.length)))
    }
    /** 中文说明：测试局部值 oneShot，由紧邻初始化决定。 */
    const oneShot = parseGfm(CJK_DOC).children.map(node => node.position?.start.offset)
    expect([...result.frozen, ...result.tail].map(block => block.key)).toEqual(oneShot)
    expect(result.frozen.length).toBeGreaterThan(3)
  })
})

describe('streaming composition across freezes', () => {
  it('continues footnote numbering from frozen references and lists all definitions', () => {
    /** 中文说明：测试局部值 doc，由紧邻初始化决定。 */
    const doc = [
      'Alpha uses a footnote[^a].',
      '',
      '[^a]: First note body.',
      '',
      'Filler one.',
      '',
      'Filler two.',
      '',
      'Filler three.',
      '',
      'Beta uses another[^b].',
      '',
      '[^b]: Second note body.',
    ].join('\n')
    /** 中文说明：测试局部值 head，由紧邻初始化决定。 */
    const head = doc.slice(0, doc.indexOf('Beta'))
    /** 中文说明：测试局部值 live，由紧邻初始化决定。 */
    const live = render(<MarkdownText text={head} streaming />)
    live.rerender(<MarkdownText text={doc} streaming />)
    expect([...live.container.querySelectorAll('p sup')].map(sup => sup.textContent)).toEqual(['1', '2'])
    expect([...live.container.querySelectorAll('section.footnotes li')].map(li => li.id))
      .toEqual(['user-content-fn-a', 'user-content-fn-b'])
    expect(live.container.querySelector('section.footnotes')?.textContent).toContain('First note body. ↩')
    /** 中文说明：测试局部值 fresh，由紧邻初始化决定。 */
    const fresh = render(<MarkdownText text={doc} streaming />)
    expect(live.container.innerHTML).toBe(fresh.container.innerHTML)
    fresh.unmount()
    live.unmount()
  })

  it('keeps every frozen block DOM node through the rest of the stream', () => {
    /** 中文说明：测试局部值 paragraphs，由紧邻初始化决定。 */
    const paragraphs = Array.from({ length: 12 }, (_, i) => `Stable paragraph ${i}.`)
    /** 中文说明：测试局部值 half，由紧邻初始化决定。 */
    const half = `${paragraphs.slice(0, 6).join('\n\n')}\n\n`
    /** 中文说明：测试局部值 live，由紧邻初始化决定。 */
    const live = render(<MarkdownText text={half} streaming />)
    /** 中文说明：测试局部值 captured，由紧邻初始化决定。 */
    const captured = [...live.container.querySelectorAll('p')]
    expect(captured.length).toBe(6)
    /** 中文说明：测试局部值 text，由紧邻初始化决定。 */
    let text = half
    /** 中文说明：测试局部值 paragraph，由紧邻初始化决定。 */
    for (const paragraph of paragraphs.slice(6)) {
      text += `${paragraph}\n\n`
      live.rerender(<MarkdownText text={text} streaming />)
    }
    /** 中文说明：测试局部值 finalNodes，由紧邻初始化决定。 */
    const finalNodes = [...live.container.querySelectorAll('p')]
    expect(finalNodes.slice(0, 6)).toEqual(captured)
    expect(finalNodes).toHaveLength(12)
    live.unmount()
  })

  it('renders an empty document for definition-only streams, including trailing blank lines', () => {
    /** 中文说明：测试局部值 doc，由紧邻初始化决定。 */
    const doc = '[a]: https://example.com/1\n\n[b]: https://example.com/2\n\n[c]: https://example.com/3\n\n[d]: https://example.com/4'
    /** 中文说明：测试局部值 live，由紧邻初始化决定。 */
    const live = render(<MarkdownText text={doc.slice(0, 30)} streaming />)
    live.rerender(<MarkdownText text={doc} streaming />)
    live.rerender(<MarkdownText text={`${doc}\n\n\n`} streaming />)
    /** 中文说明：测试局部值 fresh，由紧邻初始化决定。 */
    const fresh = render(<MarkdownText text={`${doc}\n\n\n`} streaming />)
    expect(live.container.innerHTML).toBe(fresh.container.innerHTML)
    expect(live.container.querySelector('div')?.childNodes).toHaveLength(0)
    fresh.unmount()
    live.unmount()
  })

  it('survives streaming → settled → streaming prop flips with a fresh incremental state', () => {
    /** 中文说明：测试局部值 live，由紧邻初始化决定。 */
    const live = render(<MarkdownText text={'a.\n\nb.'} streaming />)
    live.rerender(<MarkdownText text={'a.\n\nb.'} />)
    /** 中文说明：测试局部值 settled，由紧邻初始化决定。 */
    const settled = render(<MarkdownText text={'a.\n\nb.'} />)
    expect(live.container.innerHTML).toBe(settled.container.innerHTML)
    settled.unmount()
    live.rerender(<MarkdownText text={'a.\n\nb.\n\nc.\n\nd.\n\ne.'} streaming />)
    /** 中文说明：测试局部值 fresh，由紧邻初始化决定。 */
    const fresh = render(<MarkdownText text={'a.\n\nb.\n\nc.\n\nd.\n\ne.'} streaming />)
    expect(live.container.innerHTML).toBe(fresh.container.innerHTML)
    fresh.unmount()
    live.unmount()
  })

  it('matches fresh renders under irregular deterministic chunk sizes', () => {
    /** 中文说明：测试局部值 seed，由紧邻初始化决定。 */
    let seed = 42
    /** 中文说明：测试局部值 nextSize，由紧邻初始化决定。 */
    const nextSize = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648
      return 1 + (seed % 13)
    }
    /** 中文说明：测试局部值 live，由紧邻初始化决定。 */
    const live = render(<MarkdownText text="" streaming />)
    /** 中文说明：测试局部值 end，由紧邻初始化决定。 */
    let end = 0
    while (end < STREAM_DOC.length) {
      end = Math.min(end + nextSize(), STREAM_DOC.length)
      /** 中文说明：测试局部值 prefix，由紧邻初始化决定。 */
      const prefix = STREAM_DOC.slice(0, end)
      live.rerender(<MarkdownText text={prefix} streaming />)
      /** 中文说明：测试局部值 fresh，由紧邻初始化决定。 */
      const fresh = render(<MarkdownText text={prefix} streaming />)
      expect(live.container.innerHTML).toBe(fresh.container.innerHTML)
      fresh.unmount()
    }
    live.unmount()
  })
})

describe('IncrementalMarkdownParser', () => {
  it('freezes all but the trailing two blocks and keeps freezing as blocks appear', () => {
    /** 中文说明：测试局部值 parser，由紧邻初始化决定。 */
    const parser = new IncrementalMarkdownParser(parseGfm)
    /** 中文说明：测试局部值 first，由紧邻初始化决定。 */
    const first = parser.update('a\n\nb\n\nc\n\nd\n\ne')
    expect(first.frozen.map(b => b.node.type)).toEqual(['paragraph', 'paragraph', 'paragraph'])
    expect(first.tail).toHaveLength(2)
    /** 中文说明：测试局部值 second，由紧邻初始化决定。 */
    const second = parser.update('a\n\nb\n\nc\n\nd\n\ne\n\nf\n\ng')
    expect(second.frozen).toHaveLength(5)
    expect(second.tail).toHaveLength(2)
    // Previously returned frozen entries keep their identity and keys.
    expect(second.frozen.slice(0, 3)).toEqual(first.frozen)
    expect(second.generation).toBe(first.generation)
  })

  it('holds every block in the tail until more than two exist', () => {
    /** 中文说明：测试局部值 parser，由紧邻初始化决定。 */
    const parser = new IncrementalMarkdownParser(parseGfm)
    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = parser.update('only\n\ntwo blocks')
    expect(result.frozen).toHaveLength(0)
    expect(result.tail).toHaveLength(2)
  })

  it('returns the cached result for identical input', () => {
    /** 中文说明：测试局部值 parser，由紧邻初始化决定。 */
    const parser = new IncrementalMarkdownParser(parseGfm)
    /** 中文说明：测试局部值 first，由紧邻初始化决定。 */
    const first = parser.update('a\n\nb\n\nc')
    expect(parser.update('a\n\nb\n\nc')).toBe(first)
  })

  it('bumps the generation and discards frozen blocks on non-append input', () => {
    /** 中文说明：测试局部值 parser，由紧邻初始化决定。 */
    const parser = new IncrementalMarkdownParser(parseGfm)
    /** 中文说明：测试局部值 before，由紧邻初始化决定。 */
    const before = parser.update('a\n\nb\n\nc\n\nd')
    expect(before.frozen.length).toBeGreaterThan(0)
    /** 中文说明：测试局部值 after，由紧邻初始化决定。 */
    const after = parser.update('different')
    expect(after.generation).toBe(before.generation + 1)
    expect(after.frozen).toHaveLength(0)
    expect(after.tail.map(b => b.node.type)).toEqual(['paragraph'])
  })

  it('keys blocks by absolute source offset across freezes', () => {
    /** 中文说明：测试局部值 doc，由紧邻初始化决定。 */
    const doc = 'aaa\n\nbbb\n\nccc\n\nddd\n\neee'
    /** 中文说明：测试局部值 parser，由紧邻初始化决定。 */
    const parser = new IncrementalMarkdownParser(parseGfm)
    /** 中文说明：测试局部值 grown，由紧邻初始化决定。 */
    const grown = parser.update(doc)
    /** 中文说明：测试局部值 oneShotKeys，由紧邻初始化决定。 */
    const oneShotKeys = parseGfm(doc).children.map(node => node.position?.start.offset)
    expect([...grown.frozen, ...grown.tail].map(b => b.key)).toEqual(oneShotKeys)
  })

  it('never freezes under a grammar that omits positions', () => {
    /** 中文说明：测试局部值 bare，由紧邻初始化决定。 */
    const bare = (text: string): Root => {
      /** 中文说明：测试局部值 root，由紧邻初始化决定。 */
      const root = parseGfm(text)
      /** 中文说明：测试局部值 strip，由紧邻初始化决定。 */
      const strip = (nodes: RootContent[]): void => {
        /** 中文说明：测试局部值 node，由紧邻初始化决定。 */
        for (const node of nodes) {
          delete node.position
          if ('children' in node) strip(node.children)
        }
      }
      strip(root.children)
      return root
    }
    /** 中文说明：测试局部值 parser，由紧邻初始化决定。 */
    const parser = new IncrementalMarkdownParser(bare)
    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = parser.update('a\n\nb\n\nc\n\nd\n\ne')
    expect(result.frozen).toHaveLength(0)
    expect(result.tail).toHaveLength(5)
    // Fallback keys stay unique per sibling.
    expect(new Set(result.tail.map(b => b.key)).size).toBe(5)
  })
})
