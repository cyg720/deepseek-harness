/**
 * 文件职责：实现浮层与反馈相关的 Toast 基础组件。
 * 技术维度：React、TypeScript、CSS Modules 和浏览器 DOM API。
 * 产品维度：为上层产品界面提供一致的浮层与反馈展示。
 * 逻辑维度：接收属性，派生展示结构并处理局部交互。
 * 关键边界：组件不拥有业务状态；不可信内容必须经过既有安全渲染路径。
 * 新手阅读建议：先读 Props，再看派生值、事件处理和 JSX。
 */
import { useEffect, useLayoutEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import css from './Toast.module.css'

/** Full-opacity hold before the fade starts. Must agree with the stylesheet's
 * toast-fade delay (Toast.module.css) or the banner unmounts mid-fade. */
/* 中文说明：组件局部值 HOLD_MS，由紧邻初始化决定。 */
const HOLD_MS = 3000
/** Fade duration. Must agree with the stylesheet's toast-fade duration. */
/* 中文说明：组件局部值 FADE_MS，由紧邻初始化决定。 */
const FADE_MS = 1000

/**
 * Transient top-center banner: slides in, holds at full opacity, fades out,
 * then reports done so the owner can unmount it. Re-showing the same text
 * restarts the cycle when the owner remounts the component (key it by a
 * per-show sequence). Rendered through a body portal so an owner inside a
 * transformed or filtered ancestor cannot trap the fixed banner in that
 * ancestor's box.
 *
 * @param props.text - resolved banner copy; the owner passes localized text.
 * @param props.icon - optional leading glyph (e.g. a warning icon).
 * @param props.anchor - optional element whose horizontal center the banner
 * follows (e.g. the composer card, so the banner centers over the chat column
 * rather than the whole window); omitted, it centers on the viewport.
 * @param props.onDone - called once the fade completes; unmount the toast here.
 * @returns the floating banner.
 */
/* 中文说明：函数 Toast 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
export function Toast({ text, icon, anchor, onDone }: {
  text: string
  icon?: ReactNode
  anchor?: HTMLElement | null
  onDone: () => void
}) {
  useEffect(() => {
    /** 中文说明：组件局部值 timer，由紧邻初始化决定。 */
    const timer = setTimeout(onDone, HOLD_MS + FADE_MS)
    return () => { clearTimeout(timer) }
  }, [onDone])
  // Anchor-centered placement re-measures on window resizes; the banner lives
  // four seconds, so sub-window layout drift within that span stays out of
  // scope.
  /** 中文说明：组件局部值 [left, setLeft]，由紧邻初始化决定。 */
  const [left, setLeft] = useState<number | null>(null)
  useLayoutEffect(() => {
    if (anchor == null) return
    /** 中文说明：组件局部值 measure，由紧邻初始化决定。 */
    const measure = (): void => {
      /** 中文说明：组件局部值 rect，由紧邻初始化决定。 */
      const rect = anchor.getBoundingClientRect()
      setLeft(rect.left + rect.width / 2)
    }
    measure()
    window.addEventListener('resize', measure)
    return () => { window.removeEventListener('resize', measure) }
  }, [anchor])
  return createPortal(
    <div className={css.toast} role="alert" style={left === null ? undefined : { left }}>
      {icon !== undefined && <span className={css.icon} aria-hidden>{icon}</span>}
      <span className={css.text}>{text}</span>
    </div>,
    document.body,
  )
}
