// @vitest-environment jsdom
/**
 * 文件职责：验证UI 基础组件的 json-tree.client.spec.tsx 行为。
 * 技术维度：Vitest、React 测试渲染、DOM 事件和服务替身。
 * 产品维度：防止UI 基础组件的展示、作用域或交互回归。
 * 逻辑维度：构造上下文与属性，渲染后断言状态和清理。
 * 关键边界：Provider、订阅、全局 DOM 与异步任务必须释放。
 * 新手阅读建议：先读辅助夹具，再按场景顺序阅读。
 */

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { JsonTree } from '@deepseek-ai/dsh-client-ui-primitives'

/** 中文说明：测试局部值 解构结果，由紧邻初始化决定。 */
let writeText: ReturnType<typeof vi.fn>

beforeEach(() => {
  writeText = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('JsonTree', () => {
  it('keeps the top level open and renders expandable value previews', () => {
    render(
      <JsonTree
        label="Payload"
        data={{
          nested: { answer: 42 },
          list: ['alpha', 'beta'],
        }}
      />,
    )

    /** 中文说明：测试局部值 tree，由紧邻初始化决定。 */
    const tree = screen.getByRole('tree', { name: 'Payload' })
    /** 中文说明：测试局部值 rows，由紧邻初始化决定。 */
    const rows = within(tree).getAllByRole('treeitem')
    expect(rows).toHaveLength(2)
    expect(rows[0]?.textContent).toBe('nested:{answer: 42},')
    expect(rows[1]?.textContent).toBe('list:["alpha", "beta"]')

    /** 中文说明：测试局部值 expanders，由紧邻初始化决定。 */
    const expanders = within(tree).getAllByRole('button', { name: 'Expand JSON node' })
    expect(expanders[0]?.tabIndex).toBe(0)
    expect(expanders[1]?.tabIndex).toBe(-1)

    fireEvent.click(expanders[0] as HTMLElement)
    expect(within(tree).getAllByRole('treeitem')).toHaveLength(3)
    expect(screen.getByText('answer:')).toBeDefined()
    expect(within(tree).getByRole('button', { name: 'Collapse JSON node' })).toBeDefined()
  })

  it('moves the single tab stop between visible expanders with arrow keys', () => {
    render(
      <JsonTree
        expandTopLevel={false}
        data={{
          first: { nested: 1 },
          second: { nested: 2 },
        }}
      />,
    )

    /** 中文说明：测试局部值 tree，由紧邻初始化决定。 */
    const tree = screen.getByRole('tree', { name: 'JSON' })
    /** 中文说明：测试局部值 root，由紧邻初始化决定。 */
    const root = within(tree).getByRole('button', { name: 'Collapse JSON node' })
    /** 中文说明：测试局部值 children，由紧邻初始化决定。 */
    const children = within(tree).getAllByRole('button', { name: 'Expand JSON node' })

    expect(root.tabIndex).toBe(0)
    fireEvent.keyDown(root, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(children[0])
    expect(root.tabIndex).toBe(-1)
    expect(children[0]?.tabIndex).toBe(0)

    fireEvent.keyDown(children[0] as HTMLElement, { key: 'ArrowRight' })
    expect(children[0]?.getAttribute('aria-expanded')).toBe('true')
    fireEvent.keyDown(children[0] as HTMLElement, { key: 'ArrowLeft' })
    expect(children[0]?.getAttribute('aria-expanded')).toBe('false')
    fireEvent.keyDown(children[0] as HTMLElement, { key: 'Enter' })

    fireEvent.keyDown(children[0] as HTMLElement, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(root)
    fireEvent.keyDown(root, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(children[1])
  })

  it('copies an array element path without recovering data from rendered labels', async () => {
    render(<JsonTree data={{ list: [{ value: 'x' }, 'tail'] }} />)

    /** 中文说明：测试局部值 tree，由紧邻初始化决定。 */
    const tree = screen.getByRole('tree')
    fireEvent.click(within(tree).getByRole('button', { name: 'Expand JSON node' }))
    /** 中文说明：测试局部值 arrayRow，由紧邻初始化决定。 */
    const arrayRow = within(tree).getAllByRole('treeitem')
      .find(row => row.textContent?.startsWith('0:'))
    expect(arrayRow).toBeDefined()

    fireEvent.mouseOver(arrayRow as HTMLElement)
    /** 中文说明：测试局部值 copyButton，由紧邻初始化决定。 */
    const copyButton = screen.getByRole('button', { name: 'Copy pretty JSON' })
    fireEvent.contextMenu(copyButton)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy property path' }))

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('$.list[0]')
    })
  })

  it('renders empty containers, JSON-adjacent primitives, and bounded deep previews', () => {
    /** 中文说明：测试局部值 anonymous，由紧邻初始化决定。 */
    const anonymous = Object.defineProperty(() => {}, 'name', { value: '' })
    /** 中文说明：测试局部值 date，由紧邻初始化决定。 */
    const date = new Date('2026-07-28T00:00:00.000Z')
    /** 中文说明：测试局部值 data，由紧邻初始化决定。 */
    const data = {
      '': 'empty key',
      nil: null,
      text: 'quoted',
      flag: true,
      count: 3,
      big: 4n,
      date,
      named: function named() {},
      missing: undefined,
      symbol: Symbol('token'),
      emptyObject: {},
      emptyArray: [],
      primitivePreview: {
        nil: null,
        flag: false,
        big: 9n,
        missing: undefined,
      },
      exoticPreview: {
        symbol: Symbol(),
        named: function sample() {},
        anonymous,
        date,
      },
      wideObject: { a: 1, b: 2, c: 3, d: 4, e: 5 },
      wideArray: [1, 2, 3, 4, 5, 6],
      deep: { a: { b: { c: 1 } } },
    }
    render(<JsonTree copyable={false} data={data} />)

    /** 中文说明：测试局部值 text，由紧邻初始化决定。 */
    const text = screen.getByRole('tree').textContent
    expect(text).toContain('"":\"empty key\"')
    expect(text).toContain('nil:null')
    expect(text).toContain('flag:true')
    expect(text).toContain('count:3')
    expect(text).toContain('big:4n')
    expect(text).toContain('date:2026-07-28T00:00:00.000Z')
    expect(text).toContain('named:function() { }')
    expect(text).toContain('missing:undefined')
    expect(text).toContain('symbol:Symbol(token)')
    expect(text).toContain('emptyObject:{}')
    expect(text).toContain('emptyArray:[]')
    expect(text).toContain('primitivePreview:{nil: null, flag: false, big: 9, missing: undefined}')
    expect(text).toContain('exoticPreview:{symbol: Symbol, named: sample, anonymous: Function, date: }')
    expect(text).toContain('wideObject:{a: 1, b: 2, c: 3, d: 4, …}')
    expect(text).toContain('wideArray:[1, 2, 3, 4, 5, …]')
    expect(text).toContain('deep:{a: {b: {…}}}')
    expect(screen.queryByRole('button', { name: /Copy/ })).toBeNull()
    fireEvent.mouseOver(screen.getByRole('tree').parentElement as HTMLElement)
  })

  it('renders child commas and lets a clickable property label toggle its node', () => {
    render(<JsonTree data={{ parent: { emptyObject: {}, emptyArray: [], scalar: 1, last: 2 } }} />)

    fireEvent.click(screen.getByText('parent:'))
    /** 中文说明：测试局部值 tree，由紧邻初始化决定。 */
    const tree = screen.getByRole('tree')
    /** 中文说明：测试局部值 rows，由紧邻初始化决定。 */
    const rows = within(tree).getAllByRole('treeitem')
    expect(rows.find(row => row.textContent === 'emptyObject:{},')).toBeDefined()
    expect(rows.find(row => row.textContent === 'emptyArray:[],')).toBeDefined()
    expect(rows.find(row => row.textContent === 'scalar:1,')).toBeDefined()
    expect(rows.find(row => row.textContent === 'last:2')).toBeDefined()

    fireEvent.click(screen.getByText('parent:'))
    expect(within(tree).getAllByRole('treeitem')).toHaveLength(1)
  })

  it('assigns the initial array tab stop and supports an empty collapsible root', () => {
    /** 中文说明：测试局部值 first，由紧邻初始化决定。 */
    const first = render(<JsonTree data={['plain', { nested: true }]} />)
    /** 中文说明：测试局部值 tree，由紧邻初始化决定。 */
    const tree = screen.getByRole('tree')
    expect(tree.textContent).toContain('0:"plain"')
    expect(within(tree).getByRole('button', { name: 'Expand JSON node' }).tabIndex).toBe(0)
    first.unmount()

    render(<JsonTree expandTopLevel={false} data={{}} />)
    expect(screen.getByRole('tree').textContent).toBe('{}')
    expect(screen.queryByRole('button', { name: /JSON node/ })).toBeNull()
  })

  it('copies primitive and object values in every menu mode', async () => {
    /** 中文说明：测试局部值 anonymous，由紧邻初始化决定。 */
    const anonymous = Object.defineProperty(() => {}, 'name', { value: '' })
    render(
      <JsonTree
        data={{
          plain: 'hello',
          'odd-key': 3,
          object: { a: 1 },
          missing: undefined,
          big: 7n,
          symbol: Symbol(),
          symbolNamed: Symbol('token'),
          named: function named() {},
          anonymous,
        }}
      />,
    )

    /** 中文说明：测试局部值 tree，由紧邻初始化决定。 */
    const tree = screen.getByRole('tree')
    /** 中文说明：测试局部值 row，由紧邻初始化决定。 */
    const row = (prefix: string) => {
      /** 中文说明：测试局部值 match，由紧邻初始化决定。 */
      const match = within(tree).getAllByRole('treeitem')
        .find(item => item.textContent?.startsWith(prefix))
      expect(match).toBeDefined()
      return match as HTMLElement
    }
    /** 中文说明：测试局部值 hover，由紧邻初始化决定。 */
    const hover = (prefix: string) => {
      fireEvent.mouseOver(row(prefix))
      return screen.getByRole('button', { name: /Cop/ })
    }
    /** 中文说明：测试局部值 select，由紧邻初始化决定。 */
    const select = (name: string) => {
      /** 中文说明：测试局部值 button，由紧邻初始化决定。 */
      const button = screen.getByRole('button', { name: /Cop/ })
      fireEvent.contextMenu(button)
      fireEvent.click(screen.getByRole('menuitem', { name }))
    }

    fireEvent.click(hover('plain:'))
    await waitFor(() => { expect(writeText).toHaveBeenLastCalledWith('hello') })

    hover('odd-key:')
    select('Copy property path')
    await waitFor(() => { expect(writeText).toHaveBeenLastCalledWith('$["odd-key"]') })
    select('Copy JSON')
    await waitFor(() => { expect(writeText).toHaveBeenLastCalledWith('3') })
    fireEvent.click(hover('odd-key:'))
    await waitFor(() => { expect(writeText).toHaveBeenLastCalledWith('3') })

    fireEvent.click(hover('object:'))
    await waitFor(() => { expect(writeText).toHaveBeenLastCalledWith('{\n  "a": 1\n}') })
    select('Copy compact JSON')
    await waitFor(() => { expect(writeText).toHaveBeenLastCalledWith('{"a":1}') })

    /** 中文说明：测试局部值 [prefix，由紧邻初始化决定。 */
    for (const [prefix, expected] of [
      ['missing:', 'undefined'],
      ['big:', '7'],
      ['symbol:', 'Symbol'],
      ['symbolNamed:', 'token'],
      ['named:', 'named'],
      ['anonymous:', 'Function'],
    ] as const) {
      fireEvent.click(hover(prefix))
      await waitFor(() => { expect(writeText).toHaveBeenLastCalledWith(expected) })
    }
  })

  it('reports clipboard failure, resets feedback, and clears a prior timer', async () => {
    vi.useFakeTimers()
    writeText.mockRejectedValue(new Error('denied'))
    /** 中文说明：测试局部值 view，由紧邻初始化决定。 */
    const view = render(<JsonTree data={{ value: 'x' }} />)
    /** 中文说明：测试局部值 row，由紧邻初始化决定。 */
    const row = screen.getByRole('treeitem')
    fireEvent.mouseOver(row)
    fireEvent.click(screen.getByRole('button', { name: 'Copy value' }))
    await act(async () => { await Promise.resolve() })
    expect(screen.getByRole('button', { name: 'Copy failed' })).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: 'Copy failed' }))
    await act(async () => { await Promise.resolve() })
    act(() => { vi.advanceTimersByTime(1_500) })
    expect(screen.getByRole('button', { name: 'Copy value' })).toBeDefined()
    view.unmount()
  })

  it('keeps copy placement synchronized and clears stale targets', () => {
    /** 中文说明：测试局部值 view，由紧邻初始化决定。 */
    const view = render(<JsonTree data={{ first: { a: 1 }, second: 2 }} />)
    /** 中文说明：测试局部值 root，由紧邻初始化决定。 */
    const root = view.container.firstElementChild as HTMLElement
    /** 中文说明：测试局部值 tree，由紧邻初始化决定。 */
    const tree = screen.getByRole('tree')
    /** 中文说明：测试局部值 firstRow，由紧邻初始化决定。 */
    const firstRow = within(tree).getAllByRole('treeitem')[0] as HTMLElement
    /** 中文说明：测试局部值 secondRow，由紧邻初始化决定。 */
    const secondRow = within(tree).getAllByRole('treeitem')[1] as HTMLElement

    Object.defineProperty(root, 'clientHeight', { configurable: true, value: 100 })
    Object.defineProperty(root, 'clientWidth', { configurable: true, value: 300 })
    vi.spyOn(root, 'getBoundingClientRect').mockReturnValue({
      bottom: 100,
      height: 100,
      left: 10,
      right: 310,
      top: 0,
      width: 300,
      x: 10,
      y: 0,
      toJSON: () => ({}),
    })
    vi.spyOn(firstRow, 'getBoundingClientRect').mockReturnValue({
      bottom: 91,
      height: 16,
      left: 10,
      right: 200,
      top: 75,
      width: 190,
      x: 10,
      y: 75,
      toJSON: () => ({}),
    })

    fireEvent.mouseOver(firstRow)
    /** 中文说明：测试局部值 copyButton，由紧邻初始化决定。 */
    const copyButton = screen.getByRole('button', { name: 'Copy pretty JSON' })
    expect((copyButton.closest('span')?.parentElement as HTMLElement).style.left).toBe('284px')
    fireEvent.mouseOver(copyButton)
    expect(screen.getByRole('button', { name: 'Copy pretty JSON' })).toBeDefined()
    fireEvent.mouseOver(firstRow)

    fireEvent.scroll(root)
    fireEvent.scroll(window)
    fireEvent.resize(window)

    fireEvent.contextMenu(copyButton)
    fireEvent.mouseOver(secondRow)
    fireEvent.mouseOver(root)
    fireEvent.mouseLeave(root)
    expect(screen.getByRole('menu')).toBeDefined()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('button', { name: /Copy/ })).toBeNull()

    fireEvent.mouseOver(secondRow)
    expect(screen.getByRole('button', { name: 'Copy value' })).toBeDefined()
    fireEvent.mouseOver(root)
    expect(screen.queryByRole('button', { name: /Copy/ })).toBeNull()

    fireEvent.scroll(root)
    view.rerender(<JsonTree data={{ replacement: 3 }} />)
    expect(screen.queryByRole('button', { name: /Copy/ })).toBeNull()
  })

  it('copies the fixed root and clears it when the pointer leaves', async () => {
    /** 中文说明：测试局部值 view，由紧邻初始化决定。 */
    const view = render(<JsonTree data={{ value: 1 }} />)
    /** 中文说明：测试局部值 root，由紧邻初始化决定。 */
    const root = view.container.firstElementChild as HTMLElement
    /** 中文说明：测试局部值 openingBracket，由紧邻初始化决定。 */
    const openingBracket = root.querySelector<HTMLElement>('[data-json-root-row]')
    expect(openingBracket).not.toBeNull()

    fireEvent.mouseOver(openingBracket as HTMLElement)
    fireEvent.click(screen.getByRole('button', { name: 'Copy pretty JSON' }))
    await waitFor(() => { expect(writeText).toHaveBeenCalledWith('{\n  "value": 1\n}') })

    fireEvent.mouseLeave(root)
    expect(screen.queryByRole('button', { name: /Copy/ })).toBeNull()
  })
})
