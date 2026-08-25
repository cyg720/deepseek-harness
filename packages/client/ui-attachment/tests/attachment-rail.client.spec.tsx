// @vitest-environment jsdom
// AttachmentRail behavior in the jsdom lane: item rendering and callbacks,
// arrow paging over stubbed scroll geometry (jsdom lays nothing out), the
// exclusive vertical-wheel pan, and the new-item end reveal.
/**
 * 文件职责：验证附件的 attachment-rail.client.spec.tsx 行为。
 * 技术维度：Vitest、React 测试渲染和可控替身。
 * 产品维度：防止附件用户流程发生回归。
 * 逻辑维度：构造输入、触发交互并断言输出与清理。
 * 关键边界：全局替身和异步任务必须在用例后清理。
 * 新手阅读建议：先读辅助函数，再按测试场景顺序阅读。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { AttachmentRail } from '../src/AttachmentRail.tsx'
import type { AttachmentRailItem, AttachmentRailLabels } from '../src/AttachmentRail.tsx'

afterEach(cleanup)

// jsdom implements no ResizeObserver; the stub records instances so a test
// can drive the size-change recompute path.
/** 中文说明：测试场景的局部值 observers，由紧邻初始化决定。 */
const observers: { callback: ResizeObserverCallback; observed: Element[] }[] = []
beforeEach(() => {
  observers.length = 0
  vi.stubGlobal('ResizeObserver', class {
    observed: Element[] = []
    constructor(callback: ResizeObserverCallback) {
      observers.push({ callback, observed: this.observed })
    }

    observe(el: Element) { this.observed.push(el) }
    disconnect() { this.observed.length = 0 }
  })
})
afterEach(() => { vi.unstubAllGlobals() })

/** 中文说明：测试场景的局部值 labels，由紧邻初始化决定。 */
const labels: AttachmentRailLabels = {
  group: '待发送图片',
  open: '查看原图',
  scrollLeft: '向左滚动图片',
  scrollRight: '向右滚动图片',
}

/** 中文说明：函数 item 的参数见签名，返回结果供相邻流程使用；调用示例见本文件。 */
function item(id: string): AttachmentRailItem {
  return { id, previewUrl: `blob:${id}`, alt: `${id}.png`, removeLabel: `移除图片 ${id}.png` }
}

/** Stub the rail's scroll geometry (jsdom reports 0 for every metric). */
/* 中文说明：函数 stubGeometry 的参数见签名，返回结果供相邻流程使用；调用示例见本文件。 */
function stubGeometry(rail: HTMLElement, { scrollWidth, clientWidth }: { scrollWidth: number; clientWidth: number }) {
  Object.defineProperty(rail, 'scrollWidth', { value: scrollWidth, configurable: true })
  Object.defineProperty(rail, 'clientWidth', { value: clientWidth, configurable: true })
  /** 中文说明：测试场景的局部值 scrollLeft，由紧邻初始化决定。 */
  let scrollLeft = 0
  Object.defineProperty(rail, 'scrollLeft', {
    configurable: true,
    get: () => scrollLeft,
    set: (value: number) => { scrollLeft = value },
  })
  /** 中文说明：测试场景的局部值 scrollBy，由紧邻初始化决定。 */
  const scrollBy = vi.fn((options: { left: number }) => {
    scrollLeft = Math.max(0, Math.min(scrollWidth - clientWidth, scrollLeft + options.left))
  })
  rail.scrollBy = scrollBy as unknown as typeof rail.scrollBy
  return { scrollBy, setScrollLeft: (value: number) => { scrollLeft = value } }
}

describe('AttachmentRail', () => {
  it('renders thumbnails in order and routes open and remove clicks', () => {
    /** 中文说明：测试场景的局部值 onOpen，由紧邻初始化决定。 */
    const onOpen = vi.fn()
    /** 中文说明：测试场景的局部值 onRemove，由紧邻初始化决定。 */
    const onRemove = vi.fn()
    /** 中文说明：测试场景的局部值 items，由紧邻初始化决定。 */
    const items = [item('a'), item('b')]
    /** 中文说明：测试场景的局部值 view，由紧邻初始化决定。 */
    const view = render(<AttachmentRail items={items} labels={labels} onOpen={onOpen} onRemove={onRemove} />)
    /** 中文说明：测试场景的局部值 rail，由紧邻初始化决定。 */
    const rail = view.getByRole('group', { name: '待发送图片' })
    expect([...rail.querySelectorAll('img')].map(img => img.getAttribute('alt'))).toEqual(['a.png', 'b.png'])
    fireEvent.click(view.getAllByTitle('查看原图')[0]!)
    expect(onOpen).toHaveBeenCalledWith(items[0])
    fireEvent.click(view.getByRole('button', { name: '移除图片 b.png' }))
    expect(onRemove).toHaveBeenCalledWith(items[1])
  })

  it('shows edge arrows from scroll geometry and pages a viewport at a time', () => {
    /** 中文说明：测试场景的局部值 view，由紧邻初始化决定。 */
    const view = render(
      <AttachmentRail items={[item('a'), item('b'), item('c')]} labels={labels} onOpen={vi.fn()} onRemove={vi.fn()} />,
    )
    /** 中文说明：测试场景的局部值 rail，由紧邻初始化决定。 */
    const rail = view.getByRole('group', { name: '待发送图片' })
    /** 中文说明：测试场景的局部值 { scrollBy }，由紧邻初始化决定。 */
    const { scrollBy } = stubGeometry(rail, { scrollWidth: 400, clientWidth: 200 })
    // No arrows until geometry is observed (mount saw jsdom's zero metrics).
    expect(view.queryByLabelText('向右滚动图片')).toBeNull()
    fireEvent.scroll(rail)
    // Same-edges scroll takes the memoized-state path.
    fireEvent.scroll(rail)
    expect(view.queryByLabelText('向左滚动图片')).toBeNull()
    /** 中文说明：测试场景的局部值 right，由紧邻初始化决定。 */
    const right = view.getByLabelText('向右滚动图片')
    // clientWidth 200 - 64 < the 200 floor: pages by the floor.
    fireEvent.click(right)
    expect(scrollBy).toHaveBeenCalledWith({ left: 200, behavior: 'smooth' })
    fireEvent.scroll(rail)
    // Scrolled to the far edge: only the left arrow remains.
    expect(view.queryByLabelText('向右滚动图片')).toBeNull()
    fireEvent.click(view.getByLabelText('向左滚动图片'))
    expect(scrollBy).toHaveBeenCalledWith({ left: -200, behavior: 'smooth' })
    fireEvent.scroll(rail)
    expect(view.queryByLabelText('向左滚动图片')).toBeNull()
    expect(view.getByLabelText('向右滚动图片')).toBeTruthy()
  })

  it('shows both arrows mid-scroll and recomputes when the rail itself resizes', () => {
    /** 中文说明：测试场景的局部值 view，由紧邻初始化决定。 */
    const view = render(
      <AttachmentRail items={[item('a'), item('b'), item('c')]} labels={labels} onOpen={vi.fn()} onRemove={vi.fn()} />,
    )
    /** 中文说明：测试场景的局部值 rail，由紧邻初始化决定。 */
    const rail = view.getByRole('group', { name: '待发送图片' })
    /** 中文说明：测试场景的局部值 { setScrollLeft }，由紧邻初始化决定。 */
    const { setScrollLeft } = stubGeometry(rail, { scrollWidth: 400, clientWidth: 200 })
    setScrollLeft(100)
    // The component observes the rail element, not the window: a sidebar or
    // panel resize reaches it through the ResizeObserver callback.
    expect(observers.at(-1)?.observed).toContain(rail)
    act(() => { observers.at(-1)!.callback([], undefined as never) })
    expect(view.getByLabelText('向左滚动图片')).toBeTruthy()
    expect(view.getByLabelText('向右滚动图片')).toBeTruthy()
  })

  it('keeps scrolling available when ResizeObserver is unavailable', () => {
    vi.stubGlobal('ResizeObserver', undefined)
    /** 中文说明：测试场景的局部值 view，由紧邻初始化决定。 */
    const view = render(
      <AttachmentRail items={[item('a')]} labels={labels} onOpen={vi.fn()} onRemove={vi.fn()} />,
    )
    expect(view.getByRole('group', { name: '待发送图片' })).toBeTruthy()
    view.unmount()
  })

  it('pans horizontally on a vertical wheel, consuming the event, with clamped normalized travel', () => {
    /** 中文说明：测试场景的局部值 view，由紧邻初始化决定。 */
    const view = render(
      <AttachmentRail items={[item('a'), item('b')]} labels={labels} onOpen={vi.fn()} onRemove={vi.fn()} />,
    )
    /** 中文说明：测试场景的局部值 rail，由紧邻初始化决定。 */
    const rail = view.getByRole('group', { name: '待发送图片' })
    /** 中文说明：测试场景的局部值 { scrollBy }，由紧邻初始化决定。 */
    const { scrollBy } = stubGeometry(rail, { scrollWidth: 400, clientWidth: 200 })
    // Converted ticks are consumed (preventDefault): fireEvent returns false.
    expect(fireEvent.wheel(rail, { deltaY: 30 })).toBe(false)
    expect(scrollBy).toHaveBeenCalledWith({ left: 30, behavior: 'auto' })
    fireEvent.wheel(rail, { deltaY: 500 })
    expect(scrollBy).toHaveBeenCalledWith({ left: 60, behavior: 'auto' })
    fireEvent.wheel(rail, { deltaY: -500 })
    expect(scrollBy).toHaveBeenCalledWith({ left: -60, behavior: 'auto' })
    // Firefox notch wheels report lines; a page-mode wheel reports viewports.
    fireEvent.wheel(rail, { deltaY: 2, deltaMode: WheelEvent.DOM_DELTA_LINE })
    expect(scrollBy).toHaveBeenCalledWith({ left: 32, behavior: 'auto' })
    fireEvent.wheel(rail, { deltaY: -1, deltaMode: WheelEvent.DOM_DELTA_PAGE })
    expect(scrollBy).toHaveBeenCalledWith({ left: -60, behavior: 'auto' })
    // A diagonal pan is consumed too — nothing vertical may escape the rail —
    // and keeps its horizontal intent.
    expect(fireEvent.wheel(rail, { deltaX: 12, deltaY: 30 })).toBe(false)
    expect(scrollBy).toHaveBeenCalledWith({ left: 12, behavior: 'auto' })
    // A purely horizontal pan and a zero-delta wheel keep native behavior.
    expect(fireEvent.wheel(rail, { deltaX: 12, deltaY: 0 })).toBe(true)
    fireEvent.wheel(rail, { deltaY: 0 })
    expect(scrollBy).toHaveBeenCalledTimes(6)
  })

  it('pages instantly under a reduced-motion preference, smoothly otherwise', () => {
    /** 中文说明：测试场景的局部值 [matches，由紧邻初始化决定。 */
    for (const [matches, behavior] of [[true, 'auto'], [false, 'smooth']] as const) {
      vi.stubGlobal('matchMedia', vi.fn(() => ({ matches }) as MediaQueryList))
      /** 中文说明：测试场景的局部值 view，由紧邻初始化决定。 */
      const view = render(
        <AttachmentRail items={[item('a'), item('b'), item('c')]} labels={labels} onOpen={vi.fn()} onRemove={vi.fn()} />,
      )
      /** 中文说明：测试场景的局部值 rail，由紧邻初始化决定。 */
      const rail = view.getByRole('group', { name: '待发送图片' })
      /** 中文说明：测试场景的局部值 { scrollBy }，由紧邻初始化决定。 */
      const { scrollBy } = stubGeometry(rail, { scrollWidth: 400, clientWidth: 200 })
      fireEvent.scroll(rail)
      fireEvent.click(view.getByLabelText('向右滚动图片'))
      expect(scrollBy).toHaveBeenCalledWith({ left: 200, behavior })
      view.unmount()
    }
  })

  it('reveals the rail end when an item is added, not when one is removed', () => {
    /** 中文说明：测试场景的局部值 first，由紧邻初始化决定。 */
    const first = [item('a'), item('b')]
    /** 中文说明：测试场景的局部值 view，由紧邻初始化决定。 */
    const view = render(
      <AttachmentRail items={first} labels={labels} onOpen={vi.fn()} onRemove={vi.fn()} />,
    )
    /** 中文说明：测试场景的局部值 rail，由紧邻初始化决定。 */
    const rail = view.getByRole('group', { name: '待发送图片' })
    stubGeometry(rail, { scrollWidth: 400, clientWidth: 200 })
    view.rerender(
      <AttachmentRail items={[...first, item('c')]} labels={labels} onOpen={vi.fn()} onRemove={vi.fn()} />,
    )
    expect(rail.scrollLeft).toBe(200)
    view.rerender(
      <AttachmentRail items={first} labels={labels} onOpen={vi.fn()} onRemove={vi.fn()} />,
    )
    // Removal keeps the position; only growth jumps to the end.
    expect(rail.scrollLeft).toBe(200)
  })
})
