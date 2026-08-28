// @vitest-environment jsdom
// 中文：使用 jsdom 模拟 Toast 所需的 DOM、窗口事件和元素测量。
/**
 * 中文说明：
 * - 文件职责：验证 Toast 的无障碍公告、存续计时、锚点居中、窗口重测和卸载清理。
 * - 技术维度：使用 Vitest 假计时器、Testing Library、React 和 DOM 几何替身。
 * - 产品维度：确保短暂提示可读、位置正确，关闭后不会延迟触发过期回调。
 * - 逻辑维度：分别测试四秒生命周期、锚点随 resize 更新、无图标渲染及卸载取消计时器。
 * - 关键边界：用例必须在 finally 恢复真实计时器；自建 anchor 需从 document 移除。
 * - 新手阅读建议：先看第一例的 3999+1 毫秒边界，再看第二例如何替换 getBoundingClientRect。
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { Toast } from '../src/Toast.tsx'

/** 中文：每个用例后卸载所有 React 树并清空 DOM。 */
afterEach(cleanup)

/** 中文：Toast 客户端行为测试组。 */
describe('Toast', () => {
  /** 中文：验证提示文字、图标及四秒后 onDone；无参数和返回值。 */
  it('announces its text and reports done after the hold-and-fade lifetime', () => {
    vi.useFakeTimers()
    try {
      /** 完成回调探针，应只在完整生命周期结束时调用一次。 */
      const onDone = vi.fn()
      /** 包含 Toast 的渲染查询句柄。 */
      const view = render(<Toast text="最多添加 50 张图片" icon={<svg data-testid="icon" />} onDone={onDone} />)
      /** role=alert 的提示根元素。 */
      const banner = view.getByRole('alert')
      expect(banner.textContent).toContain('最多添加 50 张图片')
      expect(view.getByTestId('icon')).toBeTruthy()
      vi.advanceTimersByTime(3999)
      expect(onDone).not.toHaveBeenCalled()
      vi.advanceTimersByTime(1)
      expect(onDone).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('holds for the owner\'s window and hands the stylesheet the same value', () => {
    vi.useFakeTimers()
    try {
      const onDone = vi.fn()
      const view = render(<Toast text="切换失败" holdMs={6000} onDone={onDone} />)
      // One value drives both, so a banner can never unmount mid-fade: the
      // timer waits the hold plus the fade, and the stylesheet delays the
      // fade by the same hold.
      expect(view.getByRole('alert').style.getPropertyValue('--dsh-toast-hold')).toBe('6000ms')
      vi.advanceTimersByTime(6999)
      expect(onDone).not.toHaveBeenCalled()
      vi.advanceTimersByTime(1)
      expect(onDone).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('centers over its anchor and re-measures on window resize', () => {
    vi.useFakeTimers()
    try {
      /** 模拟 Toast 定位参照的 DOM 元素。 */
      const anchor = document.createElement('div')
      document.body.appendChild(anchor)
      anchor.getBoundingClientRect = () => ({ left: 100, width: 400 }) as DOMRect
      /** 锚定 Toast 的渲染查询句柄。 */
      const view = render(<Toast text="anchored" anchor={anchor} onDone={vi.fn()} />)
      expect(view.getByRole('alert').style.left).toBe('300px')
      anchor.getBoundingClientRect = () => ({ left: 200, width: 400 }) as DOMRect
      fireEvent(window, new Event('resize'))
      expect(view.getByRole('alert').style.left).toBe('400px')
      anchor.remove()
    } finally {
      vi.useRealTimers()
    }
  })

  /** 中文：验证省略 icon 时无占位节点，且卸载会取消完成计时器；无参数和返回值。 */
  it('renders without an icon and cancels its timer on unmount', () => {
    vi.useFakeTimers()
    try {
      /** 完成回调探针，组件卸载后不应再被调用。 */
      const onDone = vi.fn()
      /** 无图标 Toast 的渲染与卸载句柄。 */
      const view = render(<Toast text="plain" onDone={onDone} />)
      expect(view.getByRole('alert').querySelector('[aria-hidden]')).toBeNull()
      view.unmount()
      vi.advanceTimersByTime(10_000)
      expect(onDone).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})
