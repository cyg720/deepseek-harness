// @vitest-environment jsdom
/**
 * 文件职责：验证UI 基础组件的 hover-card.client.spec.tsx 行为。
 * 技术维度：Vitest、React 测试渲染、DOM 事件和服务替身。
 * 产品维度：防止UI 基础组件的展示、作用域或交互回归。
 * 逻辑维度：构造上下文与属性，渲染后断言状态和清理。
 * 关键边界：Provider、订阅、全局 DOM 与异步任务必须释放。
 * 新手阅读建议：先读辅助夹具，再按场景顺序阅读。
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HoverCard } from '@deepseek-ai/dsh-client-ui-primitives'
import { POINTER_GRACE_MS } from '../src/pointer-grace.ts'

afterEach(cleanup)
beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

/** Anchor wrapper rect: the card positions from this (jsdom rects are all-zero by default). */
/* 中文说明：函数 stubAnchorRect 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function stubAnchorRect(anchor: HTMLElement, rect: { top: number; right: number }): void {
  /** 中文说明：测试局部值 wrapper，由紧邻初始化决定。 */
  const wrapper = anchor.parentElement as HTMLElement
  wrapper.getBoundingClientRect = () => ({
    top: rect.top, right: rect.right, left: rect.right - 100, bottom: rect.top + 34,
    width: 100, height: 34, x: rect.right - 100, y: rect.top, toJSON: () => ({}),
  })
}

/** 中文说明：函数 mount 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function mount(props: {
  openDelayMs?: number
  disabled?: boolean
  copyText?: string
  copyLabel?: string
  copiedLabel?: string
} = {}) {
  /** 中文说明：测试局部值 view，由紧邻初始化决定。 */
  const view = render(
    <HoverCard
      anchor={<span>row</span>}
      content={<div>card body</div>}
      copyLabel={props.copyLabel ?? 'Copy'}
      copiedLabel={props.copiedLabel ?? 'Copied'}
      {...props}
    />,
  )
  /** 中文说明：测试局部值 anchor，由紧邻初始化决定。 */
  const anchor = screen.getByText('row')
  stubAnchorRect(anchor, { top: 40, right: 200 })
  return { view, anchor, wrapper: anchor.parentElement as HTMLElement }
}

/** Install the async browser clipboard and restore its prior host shape. */
/* 中文说明：函数 installClipboard 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function installClipboard(writeText: (text: string) => Promise<void>): () => void {
  /** 中文说明：测试局部值 prior，由紧邻初始化决定。 */
  const prior = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  })
  return () => {
    if (prior === undefined) Reflect.deleteProperty(navigator, 'clipboard')
    else Object.defineProperty(navigator, 'clipboard', prior)
  }
}

describe('HoverCard', () => {
  it('opens after the dwell delay, positioned right of the anchor', () => {
    /** 中文说明：测试局部值 { wrapper }，由紧邻初始化决定。 */
    const { wrapper } = mount()
    fireEvent.pointerEnter(wrapper)
    expect(screen.queryByText('card body')).toBeNull()
    act(() => { vi.advanceTimersByTime(499) })
    expect(screen.queryByText('card body')).toBeNull()
    act(() => { vi.advanceTimersByTime(1) })
    /** 中文说明：测试局部值 card，由紧邻初始化决定。 */
    const card = screen.getByText('card body').parentElement as HTMLElement
    expect(card.parentElement).toBe(document.body)
    expect(card.style.left).toBe('208px')
    expect(card.style.top).toBe('40px')
  })

  it('honors a custom openDelayMs', () => {
    /** 中文说明：测试局部值 { wrapper }，由紧邻初始化决定。 */
    const { wrapper } = mount({ openDelayMs: 50 })
    fireEvent.pointerEnter(wrapper)
    act(() => { vi.advanceTimersByTime(50) })
    expect(screen.getByText('card body')).toBeTruthy()
  })

  it('pointerleave before the delay cancels the pending open', () => {
    /** 中文说明：测试局部值 { wrapper }，由紧邻初始化决定。 */
    const { wrapper } = mount()
    fireEvent.pointerEnter(wrapper)
    fireEvent.pointerLeave(wrapper)
    act(() => { vi.advanceTimersByTime(1000) })
    expect(screen.queryByText('card body')).toBeNull()
  })

  it('pointerleave closes an open card a grace later; re-enter after that restarts the dwell', () => {
    /** 中文说明：测试局部值 { wrapper }，由紧邻初始化决定。 */
    const { wrapper } = mount()
    fireEvent.pointerEnter(wrapper)
    act(() => { vi.advanceTimersByTime(500) })
    expect(screen.getByText('card body')).toBeTruthy()
    fireEvent.pointerLeave(wrapper)
    act(() => { vi.advanceTimersByTime(POINTER_GRACE_MS - 1) })
    expect(screen.getByText('card body')).toBeTruthy()
    act(() => { vi.advanceTimersByTime(1) })
    expect(screen.queryByText('card body')).toBeNull()
    fireEvent.pointerEnter(wrapper)
    act(() => { vi.advanceTimersByTime(500) })
    expect(screen.getByText('card body')).toBeTruthy()
  })

  it('reaching the card inside the grace keeps it open without restarting the dwell', () => {
    // The portaled card is a React child of the wrapper, so the pointer
    // arriving on it re-enters the wrapper — the gesture an anchor gap
    // would make impossible.
    /** 中文说明：测试局部值 { wrapper }，由紧邻初始化决定。 */
    const { wrapper } = mount()
    fireEvent.pointerEnter(wrapper)
    act(() => { vi.advanceTimersByTime(500) })
    fireEvent.pointerLeave(wrapper)
    act(() => { vi.advanceTimersByTime(POINTER_GRACE_MS - 50) })
    fireEvent.pointerEnter(wrapper)
    act(() => { vi.advanceTimersByTime(POINTER_GRACE_MS * 10) })
    expect(screen.getByText('card body')).toBeTruthy()
  })

  it('re-entering while open does not queue a second dwell', () => {
    /** 中文说明：测试局部值 { wrapper }，由紧邻初始化决定。 */
    const { wrapper } = mount()
    fireEvent.pointerEnter(wrapper)
    act(() => { vi.advanceTimersByTime(500) })
    fireEvent.pointerEnter(wrapper)
    fireEvent.pointerLeave(wrapper)
    act(() => { vi.advanceTimersByTime(POINTER_GRACE_MS) })
    // A dwell restarted by the redundant enter would reopen the card here.
    act(() => { vi.advanceTimersByTime(500) })
    expect(screen.queryByText('card body')).toBeNull()
  })

  it('a press inside the anchor dismisses the card without waiting for disabled', () => {
    /** 中文说明：测试局部值 { wrapper }，由紧邻初始化决定。 */
    const { wrapper } = mount()
    fireEvent.pointerEnter(wrapper)
    act(() => { vi.advanceTimersByTime(500) })
    expect(screen.getByText('card body')).toBeTruthy()
    fireEvent.pointerDown(screen.getByText('row'))
    expect(screen.queryByText('card body')).toBeNull()
    // The pending timer is also cleared: no reopen after the dwell.
    act(() => { vi.advanceTimersByTime(1000) })
    expect(screen.queryByText('card body')).toBeNull()
  })

  it('a press on the card starts a selection instead of dismissing it', () => {
    // The card is a React child of the wrapper, so capture-phase presses on
    // it reach the wrapper's dismissal handler too; they must not close it,
    // or the first pointerdown of a text-selection drag would kill the card.
    /** 中文说明：测试局部值 { wrapper }，由紧邻初始化决定。 */
    const { wrapper } = mount()
    fireEvent.pointerEnter(wrapper)
    act(() => { vi.advanceTimersByTime(500) })
    fireEvent.pointerDown(screen.getByText('card body'))
    // Still mounted after a grace's worth of time: no close was armed either.
    act(() => { vi.advanceTimersByTime(POINTER_GRACE_MS) })
    expect(screen.getByText('card body')).toBeTruthy()
  })

  it('keeps a completed card selection instead of treating its click as copy', async () => {
    /** 中文说明：测试局部值 writeText，由紧邻初始化决定。 */
    const writeText = vi.fn(async () => {})
    /** 中文说明：测试局部值 restoreClipboard，由紧邻初始化决定。 */
    const restoreClipboard = installClipboard(writeText)
    /** 中文说明：测试局部值 selection，由紧邻初始化决定。 */
    const selection = window.getSelection()
    if (selection === null) throw new Error('jsdom selection API unavailable')
    try {
      /** 中文说明：测试局部值 { wrapper }，由紧邻初始化决定。 */
      const { wrapper } = mount({ copyText: 'card body', copyLabel: 'Copy' })
      fireEvent.pointerEnter(wrapper)
      act(() => { vi.advanceTimersByTime(500) })
      /** 中文说明：测试局部值 card，由紧邻初始化决定。 */
      const card = screen.getByRole('button', { name: 'Copy: card body' })
      /** 中文说明：测试局部值 selectedText，由紧邻初始化决定。 */
      const selectedText = screen.getByText('card body')
      /** 中文说明：测试局部值 cardRange，由紧邻初始化决定。 */
      const cardRange = document.createRange()
      cardRange.selectNodeContents(selectedText)
      selection.addRange(cardRange)
      await act(async () => { fireEvent.click(card) })
      expect(writeText).not.toHaveBeenCalled()
      expect(selection.toString()).toBe('card body')
      expect(screen.getByText('card body')).toBeTruthy()

      // Firefox supports multiple selection ranges: any range intersecting
      // this card wins, not only the first.
      selection.removeAllRanges()
      /** 中文说明：测试局部值 getSelection，由紧邻初始化决定。 */
      const getSelection = vi.spyOn(window, 'getSelection').mockReturnValue({
        isCollapsed: false,
        rangeCount: 2,
        getRangeAt: vi.fn((index: number) => ({
          intersectsNode: () => index === 1,
        })),
      } as unknown as Selection)
      await act(async () => { fireEvent.click(card) })
      expect(writeText).not.toHaveBeenCalled()
      getSelection.mockRestore()

      // A non-collapsed selection elsewhere does not block this card.
      /** 中文说明：测试局部值 anchorRange，由紧邻初始化决定。 */
      const anchorRange = document.createRange()
      anchorRange.selectNodeContents(screen.getByText('row'))
      selection.addRange(anchorRange)
      await act(async () => { fireEvent.click(card) })
      expect(writeText).toHaveBeenCalledWith('card body')
    } finally {
      selection.removeAllRanges()
      restoreClipboard()
    }
  })

  it('a press while closed leaves the card closed', () => {
    mount()
    fireEvent.pointerDown(screen.getByText('row'))
    act(() => { vi.advanceTimersByTime(1000) })
    expect(screen.queryByText('card body')).toBeNull()
  })

  it('copies its configured value and shows success only for the feedback window', async () => {
    /** 中文说明：测试局部值 writeText，由紧邻初始化决定。 */
    const writeText = vi.fn(async () => {})
    /** 中文说明：测试局部值 restoreClipboard，由紧邻初始化决定。 */
    const restoreClipboard = installClipboard(writeText)
    try {
      /** 中文说明：测试局部值 { wrapper }，由紧邻初始化决定。 */
      const { wrapper } = mount({
        copyText: '/full/path',
        copyLabel: 'Copy path',
        copiedLabel: 'Copied',
      })
      fireEvent.pointerEnter(wrapper)
      act(() => { vi.advanceTimersByTime(500) })
      /** 中文说明：测试局部值 card，由紧邻初始化决定。 */
      const card = screen.getByRole('button', { name: 'Copy path: /full/path' })
      /** 中文说明：测试局部值 status，由紧邻初始化决定。 */
      const status = screen.getByRole('status')
      expect(status.textContent).toBe('')
      expect(card.contains(status)).toBe(false)
      Object.defineProperty(card, 'offsetHeight', { configurable: true, value: 96 })
      await act(async () => { fireEvent.click(card) })
      expect(writeText).toHaveBeenCalledWith('/full/path')
      expect(status.textContent).toBe('Copied')
      expect(screen.getByRole('button', { name: 'Copy path: /full/path' })).toBe(card)
      expect(card.style.minHeight).toBe('96px')
      // Repeated activation while feedback is visible neither rewrites nor
      // extends the one-second success window.
      await act(async () => { fireEvent.click(card) })
      expect(writeText).toHaveBeenCalledOnce()
      act(() => { vi.advanceTimersByTime(999) })
      expect(status.textContent).toBe('Copied')
      act(() => { vi.advanceTimersByTime(1) })
      expect(screen.getByRole('button', { name: 'Copy path: /full/path' })).toBe(card)
      expect(card.style.minHeight).toBe('')
      expect(status.textContent).toBe('')
      expect(screen.getByText('card body')).toBeTruthy()
    } finally {
      restoreClipboard()
    }
  })

  it('supports button keys and ignores unrelated keys', async () => {
    /** 中文说明：测试局部值 writeText，由紧邻初始化决定。 */
    const writeText = vi.fn(async () => {})
    /** 中文说明：测试局部值 restoreClipboard，由紧邻初始化决定。 */
    const restoreClipboard = installClipboard(writeText)
    try {
      /** 中文说明：测试局部值 { wrapper }，由紧邻初始化决定。 */
      const { wrapper } = mount({ copyText: 'value', copiedLabel: 'Copied' })
      fireEvent.pointerEnter(wrapper)
      act(() => { vi.advanceTimersByTime(500) })
      /** 中文说明：测试局部值 card，由紧邻初始化决定。 */
      const card = screen.getByRole('button')
      fireEvent.keyDown(card, { key: 'Escape' })
      expect(writeText).not.toHaveBeenCalled()
      await act(async () => { fireEvent.keyDown(card, { key: 'Enter' }) })
      expect(writeText).toHaveBeenCalledOnce()
      act(() => { vi.advanceTimersByTime(1000) })
      await act(async () => { fireEvent.keyDown(card, { key: ' ' }) })
      expect(writeText).toHaveBeenCalledTimes(2)
    } finally {
      restoreClipboard()
    }
  })

  it('keeps its content when the clipboard rejects the write', async () => {
    /** 中文说明：测试局部值 writeText，由紧邻初始化决定。 */
    const writeText = vi.fn(async () => { throw new Error('denied') })
    /** 中文说明：测试局部值 restoreClipboard，由紧邻初始化决定。 */
    const restoreClipboard = installClipboard(writeText)
    try {
      /** 中文说明：测试局部值 { wrapper }，由紧邻初始化决定。 */
      const { wrapper } = mount({ copyText: 'value', copiedLabel: 'Copied' })
      fireEvent.pointerEnter(wrapper)
      act(() => { vi.advanceTimersByTime(500) })
      await act(async () => { fireEvent.click(screen.getByRole('button')) })
      expect(screen.queryByText('Copied')).toBeNull()
      expect(screen.getByText('card body')).toBeTruthy()
    } finally {
      restoreClipboard()
    }
  })

  it('unmount clears copied feedback', async () => {
    /** 中文说明：测试局部值 writeText，由紧邻初始化决定。 */
    const writeText = vi.fn(async () => {})
    /** 中文说明：测试局部值 restoreClipboard，由紧邻初始化决定。 */
    const restoreClipboard = installClipboard(writeText)
    try {
      /** 中文说明：测试局部值 { view, wrapper }，由紧邻初始化决定。 */
      const { view, wrapper } = mount({ copyText: 'value' })
      fireEvent.pointerEnter(wrapper)
      act(() => { vi.advanceTimersByTime(500) })
      await act(async () => { fireEvent.click(screen.getByRole('button')) })
      expect(vi.getTimerCount()).toBe(1)
      view.unmount()
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      restoreClipboard()
    }
  })

  it('clears copied feedback when the card closes', async () => {
    /** 中文说明：测试局部值 writeText，由紧邻初始化决定。 */
    const writeText = vi.fn(async () => {})
    /** 中文说明：测试局部值 restoreClipboard，由紧邻初始化决定。 */
    const restoreClipboard = installClipboard(writeText)
    try {
      /** 中文说明：测试局部值 { wrapper }，由紧邻初始化决定。 */
      const { wrapper } = mount({ copyText: 'value', copiedLabel: 'Copied' })
      fireEvent.pointerEnter(wrapper)
      act(() => { vi.advanceTimersByTime(500) })
      await act(async () => { fireEvent.click(screen.getByRole('button')) })
      expect(screen.getByRole('status').textContent).toBe('Copied')
      fireEvent.pointerLeave(wrapper)
      act(() => { vi.advanceTimersByTime(POINTER_GRACE_MS) })
      expect(screen.queryByText('Copied')).toBeNull()
      fireEvent.pointerEnter(wrapper)
      act(() => { vi.advanceTimersByTime(500) })
      expect(screen.getByText('card body')).toBeTruthy()
    } finally {
      restoreClipboard()
    }
  })

  it('does not create copied feedback after an in-flight write unmounts', async () => {
    /** 中文说明：测试局部值 acceptWrite，由紧邻初始化决定。 */
    let acceptWrite: (() => void) | undefined
    /** 中文说明：测试局部值 writeText，由紧邻初始化决定。 */
    const writeText = vi.fn(() => new Promise<void>((resolve) => { acceptWrite = resolve }))
    /** 中文说明：测试局部值 restoreClipboard，由紧邻初始化决定。 */
    const restoreClipboard = installClipboard(writeText)
    try {
      /** 中文说明：测试局部值 { view, wrapper }，由紧邻初始化决定。 */
      const { view, wrapper } = mount({ copyText: 'value' })
      fireEvent.pointerEnter(wrapper)
      act(() => { vi.advanceTimersByTime(500) })
      fireEvent.click(screen.getByRole('button'))
      expect(writeText).toHaveBeenCalledOnce()
      view.unmount()
      await act(async () => { acceptWrite?.() })
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      restoreClipboard()
    }
  })

  it('does not restore copied feedback after an in-flight card closes', async () => {
    /** 中文说明：测试局部值 acceptWrite，由紧邻初始化决定。 */
    let acceptWrite: (() => void) | undefined
    /** 中文说明：测试局部值 writeText，由紧邻初始化决定。 */
    const writeText = vi.fn(() => new Promise<void>((resolve) => { acceptWrite = resolve }))
    /** 中文说明：测试局部值 restoreClipboard，由紧邻初始化决定。 */
    const restoreClipboard = installClipboard(writeText)
    try {
      /** 中文说明：测试局部值 { wrapper }，由紧邻初始化决定。 */
      const { wrapper } = mount({ copyText: 'value', copiedLabel: 'Copied' })
      fireEvent.pointerEnter(wrapper)
      act(() => { vi.advanceTimersByTime(500) })
      fireEvent.click(screen.getByRole('button'))
      fireEvent.pointerLeave(wrapper)
      act(() => { vi.advanceTimersByTime(POINTER_GRACE_MS) })
      fireEvent.pointerEnter(wrapper)
      act(() => { vi.advanceTimersByTime(500) })
      await act(async () => { acceptWrite?.() })
      expect(vi.getTimerCount()).toBe(0)
      expect(screen.getByText('card body')).toBeTruthy()
    } finally {
      restoreClipboard()
    }
  })

  it('coalesces activations while the clipboard write is in flight', async () => {
    /** 中文说明：测试局部值 acceptWrite，由紧邻初始化决定。 */
    let acceptWrite: (() => void) | undefined
    /** 中文说明：测试局部值 writeText，由紧邻初始化决定。 */
    const writeText = vi.fn(() => new Promise<void>((resolve) => { acceptWrite = resolve }))
    /** 中文说明：测试局部值 restoreClipboard，由紧邻初始化决定。 */
    const restoreClipboard = installClipboard(writeText)
    try {
      /** 中文说明：测试局部值 { wrapper }，由紧邻初始化决定。 */
      const { wrapper } = mount({ copyText: 'value', copiedLabel: 'Copied' })
      fireEvent.pointerEnter(wrapper)
      act(() => { vi.advanceTimersByTime(500) })
      /** 中文说明：测试局部值 card，由紧邻初始化决定。 */
      const card = screen.getByRole('button')
      fireEvent.click(card)
      fireEvent.click(card)
      expect(writeText).toHaveBeenCalledOnce()
      await act(async () => { acceptWrite?.() })
      expect(screen.getByRole('status').textContent).toBe('Copied')
    } finally {
      restoreClipboard()
    }
  })

  it('disabled suppresses opening entirely', () => {
    /** 中文说明：测试局部值 { wrapper }，由紧邻初始化决定。 */
    const { wrapper } = mount({ disabled: true })
    fireEvent.pointerEnter(wrapper)
    act(() => { vi.advanceTimersByTime(1000) })
    expect(screen.queryByText('card body')).toBeNull()
  })

  it('flipping disabled true closes an open card', () => {
    /** 中文说明：测试局部值 { view, wrapper }，由紧邻初始化决定。 */
    const { view, wrapper } = mount()
    fireEvent.pointerEnter(wrapper)
    act(() => { vi.advanceTimersByTime(500) })
    expect(screen.getByText('card body')).toBeTruthy()
    view.rerender(
      <HoverCard
        anchor={<span>row</span>}
        content={<div>card body</div>}
        copyLabel="Copy"
        copiedLabel="Copied"
        disabled
      />,
    )
    expect(screen.queryByText('card body')).toBeNull()
  })

  it('corrects the bottom-edge clamp once the mounted card height is measurable', () => {
    // First placement reads height 0 (card not yet mounted) and keeps the
    // anchor top; the post-mount correction re-clamps with the real height.
    window.innerHeight = 300
    /** 中文说明：测试局部值 offsetHeight，由紧邻初始化决定。 */
    const offsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')!
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => 120 })
    try {
      /** 中文说明：测试局部值 { wrapper }，由紧邻初始化决定。 */
      const { wrapper } = mount()
      stubAnchorRect(screen.getByText('row'), { top: 280, right: 200 })
      fireEvent.pointerEnter(wrapper)
      act(() => { vi.advanceTimersByTime(500) })
      /** 中文说明：测试局部值 card，由紧邻初始化决定。 */
      const card = screen.getByText('card body').parentElement as HTMLElement
      // 300 - 120 - 8 = 172, instead of the anchor top 280.
      expect(card.style.top).toBe('172px')
    } finally {
      Object.defineProperty(HTMLElement.prototype, 'offsetHeight', offsetHeight)
    }
  })

  it('clamps inside placement itself when the card is already measured (resize path)', () => {
    window.innerHeight = 300
    /** 中文说明：测试局部值 { wrapper }，由紧邻初始化决定。 */
    const { wrapper } = mount()
    stubAnchorRect(screen.getByText('row'), { top: 280, right: 200 })
    fireEvent.pointerEnter(wrapper)
    act(() => { vi.advanceTimersByTime(500) })
    /** 中文说明：测试局部值 card，由紧邻初始化决定。 */
    const card = screen.getByText('card body').parentElement as HTMLElement
    Object.defineProperty(card, 'offsetHeight', { value: 120 })
    act(() => { fireEvent.resize(window) })
    expect(card.style.top).toBe('172px')
  })

  it('repositions on capture-phase scroll while open and stops listening after close', () => {
    /** 中文说明：测试局部值 { wrapper }，由紧邻初始化决定。 */
    const { wrapper } = mount()
    fireEvent.pointerEnter(wrapper)
    act(() => { vi.advanceTimersByTime(500) })
    stubAnchorRect(screen.getByText('row'), { top: 90, right: 300 })
    act(() => { fireEvent.scroll(document) })
    /** 中文说明：测试局部值 card，由紧邻初始化决定。 */
    const card = screen.getByText('card body').parentElement as HTMLElement
    expect(card.style.left).toBe('308px')
    expect(card.style.top).toBe('90px')
    fireEvent.pointerLeave(wrapper)
    act(() => { vi.advanceTimersByTime(POINTER_GRACE_MS) })
    expect(screen.queryByText('card body')).toBeNull()
  })

  it('unmount clears a pending open timer', () => {
    /** 中文说明：测试局部值 { view, wrapper }，由紧邻初始化决定。 */
    const { view, wrapper } = mount()
    fireEvent.pointerEnter(wrapper)
    view.unmount()
    act(() => { vi.advanceTimersByTime(1000) })
    expect(screen.queryByText('card body')).toBeNull()
  })
})
