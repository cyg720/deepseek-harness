// @vitest-environment jsdom
/**
 * 文件职责：验证UI 基础组件的 tooltip.client.spec.tsx 行为。
 * 技术维度：Vitest、React 测试渲染、DOM 事件和服务替身。
 * 产品维度：防止UI 基础组件的展示、作用域或交互回归。
 * 逻辑维度：构造上下文与属性，渲染后断言状态和清理。
 * 关键边界：Provider、订阅、全局 DOM 与异步任务必须释放。
 * 新手阅读建议：先读辅助夹具，再按场景顺序阅读。
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'

afterEach(cleanup)

describe('Tooltip', () => {
  it('resolves lazy labels only after the bubble becomes visible', () => {
    vi.useFakeTimers()
    try {
      /** 中文说明：测试局部值 label，由紧邻初始化决定。 */
      const label = vi.fn(() => 'Timing details')
      render(
        <Tooltip label={label} delayMs={500}>
          <button type="button">anchor</button>
        </Tooltip>,
      )
      expect(label).not.toHaveBeenCalled()
      fireEvent.mouseEnter(screen.getByText('anchor'))
      act(() => { vi.advanceTimersByTime(499) })
      expect(label).not.toHaveBeenCalled()
      act(() => { vi.advanceTimersByTime(1) })
      expect(screen.getByRole('tooltip').textContent).toBe('Timing details')
      expect(label).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })

  it('can delay pointer hover without delaying keyboard focus', () => {
    vi.useFakeTimers()
    try {
      render(
        <Tooltip label="Timing details" delayMs={500}>
          <button type="button">anchor</button>
        </Tooltip>,
      )
      /** 中文说明：测试局部值 anchor，由紧邻初始化决定。 */
      const anchor = screen.getByText('anchor')
      fireEvent.mouseEnter(anchor)
      act(() => { vi.advanceTimersByTime(499) })
      expect(screen.queryByRole('tooltip')).toBeNull()
      fireEvent.mouseLeave(anchor)
      act(() => { vi.advanceTimersByTime(1) })
      expect(screen.queryByRole('tooltip')).toBeNull()
      fireEvent.mouseEnter(anchor)
      act(() => { vi.advanceTimersByTime(500) })
      expect(screen.getByRole('tooltip').textContent).toBe('Timing details')
      fireEvent.mouseLeave(anchor)
      fireEvent.focus(anchor)
      expect(screen.getByRole('tooltip').textContent).toBe('Timing details')
    } finally {
      vi.useRealTimers()
    }
  })

  it('shows the bubble to the right on hover and hides it on leave', () => {
    render(
      <Tooltip label="Open sidebar">
        <button type="button">anchor</button>
      </Tooltip>,
    )
    /** 中文说明：测试局部值 anchor，由紧邻初始化决定。 */
    const anchor = screen.getByText('anchor')
    fireEvent.mouseEnter(anchor)
    /** 中文说明：测试局部值 bubble，由紧邻初始化决定。 */
    const bubble = screen.getByRole('tooltip')
    expect(bubble.textContent).toBe('Open sidebar')
    expect(bubble.getAttribute('data-side')).toBe('right')
    // jsdom rects are all-zero: right placement lands at the +10 gutter, then
    // the zero-width measured rect clamps to the 12px edge margin (10 + 12).
    expect(bubble.style.left).toBe('22px')
    expect(bubble.style.top).toBe('0px')
    fireEvent.mouseLeave(anchor)
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('supports bottom placement and the focus/blur channel', () => {
    render(
      <Tooltip label="Below" side="bottom">
        <button type="button">anchor</button>
      </Tooltip>,
    )
    /** 中文说明：测试局部值 anchor，由紧邻初始化决定。 */
    const anchor = screen.getByText('anchor')
    fireEvent.focus(anchor)
    /** 中文说明：测试局部值 bubble，由紧邻初始化决定。 */
    const bubble = screen.getByRole('tooltip')
    expect(bubble.getAttribute('data-side')).toBe('bottom')
    // Zero-width jsdom rect at x=0 clamps to the 12px edge margin.
    expect(bubble.style.left).toBe('12px')
    expect(bubble.style.top).toBe('8px')
    fireEvent.blur(anchor)
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  // jsdom's default rects are all-zero, so the clamp tests stub the measured
  // rect (anchor and bubble share the prototype stub) and derive expectations
  // from it: pos.x = anchor center, then shifted by the measured overflow.
  /** 中文说明：测试局部值 rect，由紧邻初始化决定。 */
  const rect = (left: number, right: number): DOMRect =>
    ({ left, right, top: 0, bottom: 20, width: right - left, height: 20, x: left, y: 0, toJSON: () => ({}) })

  it('caps the bubble width where the label would otherwise slab across the surface', () => {
    render(
      <Tooltip label="A description long enough to need a cap" side="bottom" maxWidth={360}>
        <button type="button">anchor</button>
      </Tooltip>,
    )
    fireEvent.mouseEnter(screen.getByText('anchor'))

    // The stylesheet's half-viewport cap stays the default; this one overrides it.
    expect(screen.getByRole('tooltip').style.maxWidth).toBe('360px')
  })

  it('clamps a bubble overflowing the right viewport edge back inside', () => {
    /** 中文说明：测试局部值 spy，由紧邻初始化决定。 */
    const spy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(rect(900, 1100))
    try {
      render(
        <Tooltip label="Wide" side="bottom">
          <button type="button">anchor</button>
        </Tooltip>,
      )
      fireEvent.mouseEnter(screen.getByText('anchor'))
      // pos.x = 1000 (anchor center); measured right edge 1100 overflows the
      // 1024 viewport's 12px safe margin (limit 1012) by 88, so the clamp
      // shifts left to 912.
      expect(screen.getByRole('tooltip').style.left).toBe('912px')
    } finally {
      spy.mockRestore()
    }
  })

  it('reclamps after label and viewport width changes', () => {
    /** 中文说明：测试局部值 originalWidth，由紧邻初始化决定。 */
    const originalWidth = window.innerWidth
    /** 中文说明：测试局部值 spy，由紧邻初始化决定。 */
    const spy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      if (this.getAttribute('role') !== 'tooltip') return rect(900, 1000)
      return this.textContent === 'Wide' ? rect(900, 1100) : rect(850, 950)
    })
    try {
      /** 中文说明：测试局部值 view，由紧邻初始化决定。 */
      const view = render(
        <Tooltip label="Wide" side="bottom">
          <button type="button">anchor</button>
        </Tooltip>,
      )
      fireEvent.mouseEnter(screen.getByText('anchor'))
      expect(screen.getByRole('tooltip').style.left).toBe('862px')

      view.rerender(
        <Tooltip label="Short" side="bottom">
          <button type="button">anchor</button>
        </Tooltip>,
      )
      expect(screen.getByRole('tooltip').style.left).toBe('950px')

      Object.defineProperty(window, 'innerWidth', { configurable: true, value: 900 })
      fireEvent(window, new Event('resize'))
      expect(screen.getByRole('tooltip').style.left).toBe('888px')
    } finally {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalWidth })
      spy.mockRestore()
    }
  })

  it('clamps a bubble past the left viewport edge back inside', () => {
    /** 中文说明：测试局部值 spy，由紧邻初始化决定。 */
    const spy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(rect(-20, 80))
    try {
      render(
        <Tooltip label="Wide" side="bottom">
          <button type="button">anchor</button>
        </Tooltip>,
      )
      fireEvent.mouseEnter(screen.getByText('anchor'))
      // pos.x = 30 (anchor center); measured left edge -20 underflows the
      // 12px safe margin by 32, so the clamp shifts right to 62.
      expect(screen.getByRole('tooltip').style.left).toBe('62px')
    } finally {
      spy.mockRestore()
    }
  })

  /** Anchor and bubble rects, so a placement test measures real room rather than jsdom's all-zero boxes. */
  /* 中文说明：测试局部值 placed，由紧邻初始化决定。 */
  const placed = (anchorTop: number, anchorBottom: number, bubbleHeight: number) =>
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      /** 中文说明：测试局部值 [top, bottom]，由紧邻初始化决定。 */
      const [top, bottom] = this.getAttribute('role') === 'tooltip'
        ? [0, bubbleHeight]
        : [anchorTop, anchorBottom]
      return {
        left: 100, right: 200, top, bottom, width: 100, height: bottom - top, x: 100, y: top, toJSON: () => ({}),
      }
    })

  it('supports top placement for anchors at the viewport bottom', () => {
    /** 中文说明：测试局部值 spy，由紧邻初始化决定。 */
    const spy = placed(700, 720, 20)
    try {
      render(
        <Tooltip label="Above" side="top">
          <button type="button">anchor</button>
        </Tooltip>,
      )
      fireEvent.mouseEnter(screen.getByText('anchor'))
      /** 中文说明：测试局部值 bubble，由紧邻初始化决定。 */
      const bubble = screen.getByRole('tooltip')
      // There is room above, so the requested side stands: the bubble's own
      // top sits at the anchor's top less the 8px gutter.
      expect(bubble.getAttribute('data-side')).toBe('top')
      expect(bubble.style.top).toBe('692px')
      expect(bubble.style.left).toBe('150px')
    } finally {
      spy.mockRestore()
    }
  })

  it('flips a bottom bubble above an anchor with no room below', () => {
    // jsdom's viewport is 768 tall: a 300px bubble under an anchor ending at
    // 700 would run off, and there is room for it above.
    /** 中文说明：测试局部值 spy，由紧邻初始化决定。 */
    const spy = placed(600, 700, 300)
    try {
      render(
        <Tooltip label="Tall" side="bottom">
          <button type="button">anchor</button>
        </Tooltip>,
      )
      fireEvent.mouseEnter(screen.getByText('anchor'))
      /** 中文说明：测试局部值 bubble，由紧邻初始化决定。 */
      const bubble = screen.getByRole('tooltip')
      expect(bubble.getAttribute('data-side')).toBe('top')
      expect(bubble.style.top).toBe('592px')
    } finally {
      spy.mockRestore()
    }
  })

  it('flips a top bubble below an anchor with no room above', () => {
    /** 中文说明：测试局部值 spy，由紧邻初始化决定。 */
    const spy = placed(10, 40, 100)
    try {
      render(
        <Tooltip label="Tall" side="top">
          <button type="button">anchor</button>
        </Tooltip>,
      )
      fireEvent.mouseEnter(screen.getByText('anchor'))
      /** 中文说明：测试局部值 bubble，由紧邻初始化决定。 */
      const bubble = screen.getByRole('tooltip')
      expect(bubble.getAttribute('data-side')).toBe('bottom')
      expect(bubble.style.top).toBe('48px')
    } finally {
      spy.mockRestore()
    }
  })

  it('keeps the requested side when neither side fits', () => {
    // A bubble taller than the viewport has no home; oscillating between the
    // two would be worse than honouring the request.
    /** 中文说明：测试局部值 spy，由紧邻初始化决定。 */
    const spy = placed(300, 400, 900)
    try {
      render(
        <Tooltip label="Huge" side="bottom">
          <button type="button">anchor</button>
        </Tooltip>,
      )
      fireEvent.mouseEnter(screen.getByText('anchor'))
      expect(screen.getByRole('tooltip').getAttribute('data-side')).toBe('bottom')
    } finally {
      spy.mockRestore()
    }
  })

  it('chains the anchor\'s own handlers ahead of the tooltip\'s', () => {
    /** 中文说明：测试局部值 onMouseEnter，由紧邻初始化决定。 */
    const onMouseEnter = vi.fn()
    /** 中文说明：测试局部值 onMouseLeave，由紧邻初始化决定。 */
    const onMouseLeave = vi.fn()
    /** 中文说明：测试局部值 onFocus，由紧邻初始化决定。 */
    const onFocus = vi.fn()
    /** 中文说明：测试局部值 onBlur，由紧邻初始化决定。 */
    const onBlur = vi.fn()
    render(
      <Tooltip label="Chained">
        <button type="button" onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave} onFocus={onFocus} onBlur={onBlur}>anchor</button>
      </Tooltip>,
    )
    /** 中文说明：测试局部值 anchor，由紧邻初始化决定。 */
    const anchor = screen.getByText('anchor')
    fireEvent.mouseEnter(anchor)
    fireEvent.mouseLeave(anchor)
    fireEvent.focus(anchor)
    fireEvent.blur(anchor)
    expect(onMouseEnter).toHaveBeenCalledOnce()
    expect(onMouseLeave).toHaveBeenCalledOnce()
    expect(onFocus).toHaveBeenCalledOnce()
    expect(onBlur).toHaveBeenCalledOnce()
  })

  it('suppresses the bubble while disabled without remounting the anchor', () => {
    /** 中文说明：测试局部值 { rerender }，由紧邻初始化决定。 */
    const { rerender } = render(
      <Tooltip label="Rail" disabled>
        <button type="button">anchor</button>
      </Tooltip>,
    )
    /** 中文说明：测试局部值 anchor，由紧邻初始化决定。 */
    const anchor = screen.getByText('anchor')
    fireEvent.mouseEnter(anchor)
    expect(screen.queryByRole('tooltip')).toBeNull()
    rerender(
      <Tooltip label="Rail">
        <button type="button">anchor</button>
      </Tooltip>,
    )
    // Same DOM node: toggling disabled never remounted the anchor.
    expect(screen.getByText('anchor')).toBe(anchor)
    fireEvent.mouseEnter(anchor)
    expect(screen.getByRole('tooltip')).toBeTruthy()
  })

  it('mouse leave hides the bubble immediately, even while the anchor stays focused', () => {
    render(
      <Tooltip label="Sticky">
        <button type="button">anchor</button>
      </Tooltip>,
    )
    /** 中文说明：测试局部值 anchor，由紧邻初始化决定。 */
    const anchor = screen.getByText('anchor')
    // Focused AND hovered: leaving with the mouse drops the bubble at once.
    fireEvent.focus(anchor)
    fireEvent.mouseEnter(anchor)
    fireEvent.mouseLeave(anchor)
    expect(screen.queryByRole('tooltip')).toBeNull()
    // Re-entering shows it again; blurring while still hovered keeps it.
    fireEvent.mouseEnter(anchor)
    fireEvent.blur(anchor)
    expect(screen.getByRole('tooltip')).toBeTruthy()
    fireEvent.mouseLeave(anchor)
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('forwards the anchor element to the child ref (object and callback)', () => {
    /** 中文说明：测试局部值 objectRef，由紧邻初始化决定。 */
    const objectRef = { current: null as HTMLButtonElement | null }
    /** 中文说明：测试局部值 callbackRef，由紧邻初始化决定。 */
    const callbackRef = vi.fn()
    /** 中文说明：测试局部值 { rerender }，由紧邻初始化决定。 */
    const { rerender } = render(
      <Tooltip label="Add">
        <button type="button" ref={objectRef}>anchor</button>
      </Tooltip>,
    )
    expect(objectRef.current).toBe(screen.getByText('anchor'))
    // Tooltip's own positioning still works through the merged ref.
    fireEvent.mouseEnter(screen.getByText('anchor'))
    expect(screen.getByRole('tooltip')).toBeTruthy()
    rerender(
      <Tooltip label="Add">
        <button type="button" ref={callbackRef}>anchor</button>
      </Tooltip>,
    )
    expect(callbackRef).toHaveBeenCalledWith(screen.getByText('anchor'))
  })

  it('drops an already-visible bubble when disabled flips mid-hover', () => {
    /** 中文说明：测试局部值 { rerender }，由紧邻初始化决定。 */
    const { rerender } = render(
      <Tooltip label="Rail">
        <button type="button">anchor</button>
      </Tooltip>,
    )
    fireEvent.mouseEnter(screen.getByText('anchor'))
    expect(screen.getByRole('tooltip')).toBeTruthy()
    // e.g. clicking a rail control expands the sidebar: no mouseleave fires.
    rerender(
      <Tooltip label="Rail" disabled>
        <button type="button">anchor</button>
      </Tooltip>,
    )
    expect(screen.queryByRole('tooltip')).toBeNull()
  })
})
