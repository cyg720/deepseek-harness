// @vitest-environment jsdom
/**
 * 文件职责：验证侧栏的 pointer-scrollbars.client.spec.tsx 行为。
 * 技术维度：Vitest、React 渲染、DOM 事件和服务替身。
 * 产品维度：防止侧栏显示、导航或生命周期回归。
 * 逻辑维度：构造状态，触发交互并断言输出和清理。
 * 关键边界：全局主题、DOM 尺寸和订阅必须在用例后恢复。
 * 新手阅读建议：先读夹具，再按加载、交互和卸载场景阅读。
 */
/**
 * Pointer-revealed scrollbars, the shell's half: which class state the column
 * carries as the pointer crosses it. The stylesheet rule that state drives is
 * asserted in scrollbar-quiet-styles.spec.ts (node environment — a jsdom spec
 * has no file: module URL to read the sheet through).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import type { SidebarRootComponentProps, SidebarSectionOwnerProps } from '../src/client/contract/slots.ts'
import { SidebarRoot } from '../src/client/SidebarRoot.tsx'
import { en } from '../src/client/locales.ts'

/** Pinned column box; the shell compares pointer coordinates against it. */
/** 中文说明：测试局部值 COLUMN_WIDTH，由紧邻初始化决定。 */
const COLUMN_WIDTH = 280
/** 中文说明：测试局部值 COLUMN_HEIGHT，由紧邻初始化决定。 */
const COLUMN_HEIGHT = 600

/** 中文说明：测试局部值 t，由紧邻初始化决定。 */
const t: SidebarRootComponentProps['t'] = key => (en as Record<string, string>)[key] ?? key
/** The shell never reads the global hooks; the props share carries them regardless. */
/** 中文说明：测试局部值 neverHook，由紧邻初始化决定。 */
const neverHook = (() => { throw new Error('shell must not read global hooks') }) as never

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

/**
 * Render the shell and expose its column element.
 * @returns the column element and whether it currently carries the quiet state.
 */
/** 中文说明：函数 mountColumn 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function mountColumn(): { column: HTMLElement; quiet: () => boolean } {
  /** 中文说明：测试局部值 view，由紧邻初始化决定。 */
  const view = render(
    <SidebarRoot
      collapsed={false} width={300}
      useSessions={neverHook} useWorkspaces={neverHook}
      startSession={vi.fn()} toggleSidebar={vi.fn()} t={t}
      renderSlot={((_key: string, owner: SidebarSectionOwnerProps) =>
        <div data-testid="region" data-wide={owner.wide} />) as SidebarRootComponentProps['renderSlot']}
    />,
  )
  /** 中文说明：测试局部值 column，由紧邻初始化决定。 */
  const column = view.container.firstElementChild
  if (!(column instanceof HTMLElement)) throw new Error('sidebar column not rendered')
  // jsdom lays nothing out, and the leave decision is geometric: pin the box
  // the shell reads so a coordinate can be inside or outside it.
  Object.defineProperty(column, 'getBoundingClientRect', {
    value: () => ({
      left: 0, top: 0, right: COLUMN_WIDTH, bottom: COLUMN_HEIGHT,
      x: 0, y: 0, width: COLUMN_WIDTH, height: COLUMN_HEIGHT, toJSON: () => ({}),
    }),
  })
  // CSS-module locals are hashed in this bench, so the state is read as a
  // substring of the class list rather than as an exact local name.
  return { column, quiet: () => [...column.classList].some(name => name.includes('quietBars')) }
}

/**
 * Cross the pointer into or out of the column. React synthesizes
 * `pointerenter`/`pointerleave` from `pointerover`/`pointerout`, so the raw
 * enter and leave events it does not listen to would assert nothing.
 * @param column - the sidebar column element.
 * @param direction - `in` to enter the column, `out` to leave it.
 */
/** 中文说明：函数 movePointer 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function movePointer(column: HTMLElement, direction: 'in' | 'out'): void {
  /** 中文说明：测试局部值 outside，由紧邻初始化决定。 */
  const outside = document.body
  if (direction === 'in') fireEvent.pointerOver(column, { relatedTarget: outside })
  else fireEvent.pointerOut(column, { relatedTarget: outside })
}

/**
 * Move the pointer over the document, as a pointer crossing a fixed overlay
 * that is a DOM descendant of the column does.
 * @param x - client x coordinate.
 * @param y - client y coordinate.
 */
/** 中文说明：函数 movePointerOverDocument 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function movePointerOverDocument(x: number, y: number): void {
  fireEvent.pointerMove(document, { clientX: x, clientY: y })
}

describe('SidebarRoot pointer-revealed scrollbars', () => {
  it('draws them only while the pointer is inside, and lingers on the way out', () => {
    vi.useFakeTimers()
    /** 中文说明：测试局部值 { column, quiet }，由紧邻初始化决定。 */
    const { column, quiet } = mountColumn()
    // At rest — the pointer has never been over the column — the bars are off.
    expect(quiet()).toBe(true)
    movePointer(column, 'in')
    expect(quiet()).toBe(false)
    movePointer(column, 'out')
    // The linger: still drawn just before the window closes, gone just after.
    act(() => { vi.advanceTimersByTime(1999) })
    expect(quiet()).toBe(false)
    act(() => { vi.advanceTimersByTime(1) })
    expect(quiet()).toBe(true)
  })

  it('cancels a pending hide when the pointer comes back', () => {
    vi.useFakeTimers()
    /** 中文说明：测试局部值 { column, quiet }，由紧邻初始化决定。 */
    const { column, quiet } = mountColumn()
    movePointer(column, 'in')
    movePointer(column, 'out')
    act(() => { vi.advanceTimersByTime(1000) })
    movePointer(column, 'in')
    // The first leave's timer would fire here; a cancelled one leaves the bars
    // drawn, which is what keeps a pointer skirting the edge from blinking them.
    act(() => { vi.advanceTimersByTime(5000) })
    expect(quiet()).toBe(false)
  })

  it('hides when the pointer moves outside the column box without leaving its subtree', () => {
    // ui-settings renders its full-viewport panel as a fixed-position
    // DESCENDANT of the column, so DOM containment reports the pointer as
    // still inside while it is visually somewhere else entirely.
    vi.useFakeTimers()
    /** 中文说明：测试局部值 { column, quiet }，由紧邻初始化决定。 */
    const { column, quiet } = mountColumn()
    movePointer(column, 'in')
    expect(quiet()).toBe(false)
    movePointerOverDocument(COLUMN_WIDTH + 400, 300)
    act(() => { vi.advanceTimersByTime(2000) })
    expect(quiet()).toBe(true)
  })

  it('does not restart the window when the pointer keeps moving outside', () => {
    vi.useFakeTimers()
    /** 中文说明：测试局部值 { column, quiet }，由紧邻初始化决定。 */
    const { column, quiet } = mountColumn()
    movePointer(column, 'in')
    movePointer(column, 'out')
    act(() => { vi.advanceTimersByTime(1500) })
    // A pending hide is left alone rather than re-armed: otherwise a pointer
    // resting outside the column would keep pushing the bars' disappearance
    // out, one move at a time.
    movePointerOverDocument(COLUMN_WIDTH + 400, 300)
    act(() => { vi.advanceTimersByTime(600) })
    expect(quiet()).toBe(true)
  })

  it('keeps them drawn while the pointer moves inside the column box', () => {
    vi.useFakeTimers()
    /** 中文说明：测试局部值 { column, quiet }，由紧邻初始化决定。 */
    const { column, quiet } = mountColumn()
    movePointer(column, 'in')
    movePointer(column, 'out')
    // A move landing back inside the box cancels the pending hide, the same
    // way re-entering the element does.
    movePointerOverDocument(COLUMN_WIDTH - 10, 300)
    act(() => { vi.advanceTimersByTime(5000) })
    expect(quiet()).toBe(false)
  })

  it('drops the pending hide when the column unmounts', () => {
    vi.useFakeTimers()
    /** 中文说明：测试局部值 { column }，由紧邻初始化决定。 */
    const { column } = mountColumn()
    movePointer(column, 'in')
    movePointer(column, 'out')
    cleanup()
    // A timer surviving the unmount would call setState on a dead component.
    expect(() => { vi.advanceTimersByTime(5000) }).not.toThrow()
    expect(vi.getTimerCount()).toBe(0)
  })
})
