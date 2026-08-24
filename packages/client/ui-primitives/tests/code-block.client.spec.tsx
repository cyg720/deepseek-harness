// @vitest-environment jsdom
// CodeBlock + the shiki singleton: registered grammars highlight into token
// spans colored by --shiki-* custom properties; unknown/absent languages take
// the identical-geometry plain arm; aliases resolve; the trailing newline is
// display-trimmed. MarkdownText's fence route is pinned in markdown.spec.tsx
// alongside the rest of the markdown family.
/**
 * 文件职责：验证 UI 基础组件的 code-block.client.spec.tsx 行为。
 * 技术维度：Vitest、React 测试渲染和 DOM 事件模拟。
 * 产品维度：防止复用组件的显示和交互回归。
 * 逻辑维度：构造属性，渲染组件并断言 DOM 与事件。
 * 关键边界：测试必须清理 DOM；快照不能替代关键交互断言。
 * 新手阅读建议：先读渲染辅助函数，再按组件场景阅读。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { CodeBlock } from '../src/markdown/CodeBlock.tsx'
import { highlightToHtml } from '../src/markdown/highlight.ts'

afterEach(cleanup)

beforeEach(() => {
  vi.useRealTimers()
})

describe('highlightToHtml', () => {
  it('highlights a registered grammar into css-variables token spans', () => {
    /** 中文说明：测试局部值 html，由紧邻初始化决定。 */
    const html = highlightToHtml('const x: number = 1', 'typescript')
    expect(html).toContain('pre class="shiki css-variables"')
    expect(html).toContain('var(--shiki-')
  })

  it.each([['ts'], ['js'], ['bash'], ['sh'], ['jsonc']])('resolves the %s alias', (alias) => {
    expect(highlightToHtml('x', alias)).toContain('shiki')
  })

  it('returns undefined for unknown or absent languages', () => {
    expect(highlightToHtml('x', 'cobol')).toBeUndefined()
    expect(highlightToHtml('x', undefined)).toBeUndefined()
  })

  // Every read-tool language hint whose grammar loads lazily (the boot set —
  // ts/js/shell/sh/json — is covered above). Touching each one drives its own
  // dynamic import thunk, so the whole LAZY_GRAMMARS table is exercised.
  /** 中文说明：测试局部值 LAZY_ALIASES，由紧邻初始化决定。 */
  const LAZY_ALIASES = [
    'py', 'rb', 'go', 'rs', 'java', 'c', 'cpp', 'cs', 'kotlin', 'swift', 'php',
    'yaml', 'toml', 'ini', 'md', 'mdx', 'html', 'css', 'scss', 'less', 'sql',
    'xml', 'lua',
  ]

  it('lazily loads every read-card grammar: plain first, highlighted after load', async () => {
    // First touch returns the plain fallback (undefined) and starts the import.
    /** 中文说明：测试局部值 alias，由紧邻初始化决定。 */
    for (const alias of LAZY_ALIASES) expect(highlightToHtml('x', alias)).toBeUndefined()
    // Once every grammar has registered, the same call highlights.
    await vi.waitFor(() => {
      /** 中文说明：测试局部值 alias，由紧邻初始化决定。 */
      for (const alias of LAZY_ALIASES) expect(highlightToHtml('x', alias)).toContain('shiki')
    }, { timeout: 5_000 })
  })
})

describe('CodeBlock', () => {
  it('renders the highlighted tree for TypeScript', () => {
    /** 中文说明：测试局部值 view，由紧邻初始化决定。 */
    const view = render(<CodeBlock code={'const a = 1\n'} lang="ts" />)
    /** 中文说明：测试局部值 pre，由紧邻初始化决定。 */
    const pre = view.container.querySelector('pre.shiki')
    expect(pre).not.toBeNull()
    expect(pre!.textContent).toBe('const a = 1')
    expect(pre!.querySelectorAll('span[style]').length).toBeGreaterThan(1)
  })

  it('renders the plain arm for an unknown language with the text verbatim', () => {
    /** 中文说明：测试局部值 view，由紧邻初始化决定。 */
    const view = render(<CodeBlock code={'IDENTIFICATION DIVISION.'} lang="cobol" />)
    expect(view.container.querySelector('pre.shiki')).toBeNull()
    expect(view.getByText('IDENTIFICATION DIVISION.')).toBeTruthy()
  })

  it('renders the plain arm when no language is given', () => {
    /** 中文说明：测试局部值 view，由紧邻初始化决定。 */
    const view = render(<CodeBlock code="plain text" />)
    expect(view.container.querySelector('pre.shiki')).toBeNull()
    expect(view.getByText('plain text')).toBeTruthy()
  })

  it('shows the language banner and copies the pre textContent', async () => {
    vi.useFakeTimers()
    /** 中文说明：测试局部值 writeText，由紧邻初始化决定。 */
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
    render(<CodeBlock code={'const a = 1\n'} lang="ts" />)
    expect(screen.getByText('ts')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '复制' }))
    expect(writeText).toHaveBeenCalledWith('const a = 1')
    // Flush the clipboard promise under fake timers before asserting the label.
    await act(async () => {
      await Promise.resolve()
    })
    expect(screen.getByRole('button', { name: '复制成功' })).toBeTruthy()
    // While the ok label is showing, further clicks are no-ops.
    fireEvent.click(screen.getByRole('button', { name: '复制成功' }))
    expect(writeText).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1000)
    expect(screen.getByRole('button', { name: '复制' })).toBeTruthy()
  })

  it('does not claim success when clipboard.writeText rejects', async () => {
    /** 中文说明：测试局部值 writeText，由紧邻初始化决定。 */
    const writeText = vi.fn().mockRejectedValue(new Error('denied'))
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
    render(<CodeBlock code="plain body" />)
    fireEvent.click(screen.getByRole('button', { name: '复制' }))
    await act(async () => {
      await Promise.resolve()
    })
    expect(screen.getByRole('button', { name: '复制' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '复制成功' })).toBeNull()
  })

  it('falls back to execCommand when clipboard.writeText is unavailable', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: undefined,
    })
    /** 中文说明：测试局部值 exec，由紧邻初始化决定。 */
    const exec = vi.fn().mockReturnValue(true)
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: exec,
    })
    render(<CodeBlock code="plain body" />)
    fireEvent.click(screen.getByRole('button', { name: '复制' }))
    expect(exec).toHaveBeenCalledWith('copy')
    expect(await screen.findByRole('button', { name: '复制成功' })).toBeTruthy()
  })

  it('does not claim success when execCommand throws or is absent', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: undefined,
    })
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: () => {
        throw new Error('denied')
      },
    })
    /** 中文说明：测试局部值 denied，由紧邻初始化决定。 */
    const denied = render(<CodeBlock code="plain body" />)
    fireEvent.click(denied.getByRole('button', { name: '复制' }))
    await Promise.resolve()
    expect(denied.getByRole('button', { name: '复制' })).toBeTruthy()
    denied.unmount()

    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: undefined,
    })
    /** 中文说明：测试局部值 absent，由紧邻初始化决定。 */
    const absent = render(<CodeBlock code="plain body" />)
    fireEvent.click(absent.getByRole('button', { name: '复制' }))
    await Promise.resolve()
    expect(absent.getByRole('button', { name: '复制' })).toBeTruthy()
    expect(absent.queryByRole('button', { name: '复制成功' })).toBeNull()
  })
})
