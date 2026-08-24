// @vitest-environment jsdom
// 中文：使用 jsdom 验证灯箱的焦点和鼠标键盘交互。
/**
 * 中文说明：
 * - 文件职责：验证图片灯箱的焦点接管与恢复、关闭方式和遮罩点击边界。
 * - 技术维度：使用 Vitest、Testing Library、React、jsdom 和 DOM 属性替身。
 * - 产品维度：确保原图预览可由键盘和鼠标安全关闭，并把焦点还给打开控件。
 * - 逻辑维度：分别测试关闭按钮/Escape、无可恢复焦点、遮罩与图片点击三种路径。
 * - 关键边界：jsdom 默认 activeElement 为 body，第二例显式模拟 null；每例后清理 DOM。
 * - 新手阅读建议：先看第一例的焦点生命周期，再比较 mask 和 img 的 mouseDown 行为。
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { ImageLightbox } from '../src/ImageLightbox.tsx'

/** 中文：每个用例后卸载组件并清空 DOM。 */
afterEach(cleanup)

/** 灯箱对话框及关闭按钮的固定中文无障碍文案。 */
const labels = { dialog: '原图预览', close: '关闭原图预览' }

/** 中文：ImageLightbox 客户端交互测试组。 */
describe('ImageLightbox', () => {
  /** 中文：验证自动聚焦、按钮/Escape 关闭和卸载后焦点恢复；无参数和返回值。 */
  it('focuses its close control, closes by button and Escape, and restores focus', () => {
    /** 模拟打开灯箱且之后应恢复焦点的按钮。 */
    const opener = document.createElement('button')
    document.body.appendChild(opener)
    opener.focus()
    /** 关闭回调探针。 */
    const onClose = vi.fn()
    /** 灯箱渲染与卸载句柄。 */
    const view = render(<ImageLightbox src="blob:original" alt="原图" labels={labels} onClose={onClose} />)
    /** 灯箱内应自动获得焦点的关闭按钮。 */
    const close = view.getByRole('button', { name: '关闭原图预览' })
    expect(document.activeElement).toBe(close)
    fireEvent.keyDown(window, { key: 'a' })
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.keyDown(window, { key: 'Escape' })
    fireEvent.click(close)
    expect(onClose).toHaveBeenCalledTimes(2)
    view.unmount()
    expect(document.activeElement).toBe(opener)
    opener.remove()
  })

  /** 中文：挂载时没有活动元素也应安全卸载；无参数和返回值。 */
  it('tolerates a focus owner it cannot restore (no active element at mount)', () => {
    // jsdom always reports body as the fallback active element; stub the
    // element-less state a detached focus can leave.
    // 中文：jsdom 通常以 body 兜底，这里模拟分离焦点可能留下的无活动元素状态。
    Object.defineProperty(document, 'activeElement', { configurable: true, get: () => null })
    try {
      /** 在 activeElement 为 null 时创建的灯箱渲染句柄。 */
      const view = render(<ImageLightbox src="blob:original" alt="原图" labels={labels} onClose={vi.fn()} />)
      view.unmount()
    } finally {
      delete (document as { activeElement?: unknown }).activeElement
    }
  })

  /** 中文：遮罩按下应关闭，图片区域按下不应关闭；无参数和返回值。 */
  it('closes on a mask press but not on a press over the image', () => {
    /** 关闭回调探针。 */
    const onClose = vi.fn()
    /** 当前灯箱渲染句柄。 */
    const view = render(<ImageLightbox src="blob:original" alt="原图" labels={labels} onClose={onClose} />)
    fireEvent.mouseDown(view.getByRole('img'))
    expect(onClose).not.toHaveBeenCalled()
    /** aria-hidden 的灯箱遮罩元素。 */
    const mask = document.querySelector('[aria-hidden="true"]') as HTMLElement
    fireEvent.mouseDown(mask)
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
