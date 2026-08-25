// Hover/focus label bubble (figma tooltip pill: dark plate, white text).
// TODO: interaction is a placeholder (horizontal overflow clamps and a
// vertical collision flips the bubble to the other side, but there is no
// arrow) — visuals and behavior get a proper pass later.
// The anchor is the child element itself (cloneElement, no wrapper node), so
// attaching a tooltip never changes the anchor's layout context. The bubble is
// position:fixed and coordinates come from the anchor's rect at show time, so
// it escapes ancestor overflow clipping (the sidebar rail clips its column)
// without a portal.
/**
 * 文件职责：实现浮层与反馈相关的 Tooltip 基础组件。
 * 技术维度：React、TypeScript、CSS Modules 和浏览器 DOM API。
 * 产品维度：为上层产品界面提供一致的浮层与反馈展示。
 * 逻辑维度：接收属性，派生展示结构并处理局部交互。
 * 关键边界：组件不拥有业务状态；不可信内容必须经过既有安全渲染路径。
 * 新手阅读建议：先读 Props，再看派生值、事件处理和 JSX。
 */

import { cloneElement, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { FocusEventHandler, MouseEventHandler, MutableRefObject, ReactElement, Ref } from 'react'
import css from './Tooltip.module.css'

/** Bubble placement relative to the anchor. */
/* 中文说明：类型或类 TooltipSide 约束基础组件的数据或职责。 */
export type TooltipSide = 'right' | 'bottom' | 'top'

/** Props Tooltip injects into its anchor child; the child's own handlers are chained ahead of the tooltip's. */
/* 中文说明：类型或类 AnchorProps 约束基础组件的数据或职责。 */
interface AnchorProps {
  ref?: Ref<HTMLElement> | undefined
  onMouseEnter?: MouseEventHandler | undefined
  onMouseLeave?: MouseEventHandler | undefined
  onFocus?: FocusEventHandler | undefined
  onBlur?: FocusEventHandler | undefined
}

/** 中文说明：类型或类 TooltipLabel 约束基础组件的数据或职责。 */
type TooltipLabel = string | (() => string)

/**
 * Attach a hover/focus tooltip to an anchor element.
 * @param props.label - bubble text, or a resolver evaluated only while the bubble is visible.
 * @param props.side - placement relative to the anchor (default 'right').
 * @param props.delayMs - hover delay in milliseconds; keyboard focus remains immediate.
 * @param props.disabled - suppress the bubble while true; the anchor renders identically so
 * toggling never remounts it (which would cut its CSS transitions).
 * @param props.maxWidth - bubble width cap in pixels, for labels long enough that the default
 * half-viewport cap would render a slab wider than the surface the anchor sits on.
 * @param props.children - a single anchor element; its own ref (callback or object) is forwarded alongside the tooltip's.
 * @returns the cloned anchor plus a fixed-position bubble while hovered/focused.
 */
/* 中文说明：函数 Tooltip 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
export function Tooltip({ label, side = 'right', delayMs = 0, disabled = false, maxWidth, children }: { label: TooltipLabel; side?: TooltipSide; delayMs?: number; disabled?: boolean; maxWidth?: number; children: ReactElement<AnchorProps> }) {
  /** 中文说明：组件局部值 anchor，由紧邻初始化决定。 */
  const anchor = useRef<HTMLElement | null>(null)
  // React 18 keeps the element's ref outside props; forward it so wrapping an
  // anchor in Tooltip never silently severs the owner's ref.
  /** 中文说明：组件局部值 childRef，由紧邻初始化决定。 */
  const childRef = (children as ReactElement<AnchorProps> & { ref?: Ref<HTMLElement> }).ref
  /** 中文说明：组件局部值 mergedRef，由紧邻初始化决定。 */
  const mergedRef = useCallback((el: HTMLElement | null) => {
    anchor.current = el
    if (typeof childRef === 'function') childRef(el)
    else if (childRef != null) (childRef as MutableRefObject<HTMLElement | null>).current = el
  }, [childRef])
  // The anchor's edges rather than final coordinates: a vertical flip has to
  // re-derive the bubble's own top from the opposite edge.
  /** 中文说明：组件局部值 [pos, setPos]，由紧邻初始化决定。 */
  const [pos, setPos] = useState<{ x: number; top: number; bottom: number } | null>(null)
  // Where the bubble actually sits, which is the requested side until the
  // viewport refuses it.
  /** 中文说明：组件局部值 [placement, setPlacement]，由紧邻初始化决定。 */
  const [placement, setPlacement] = useState<TooltipSide>(side)
  /** 中文说明：组件局部值 bubble，由紧邻初始化决定。 */
  const bubble = useRef<HTMLSpanElement | null>(null)
  /** 中文说明：组件局部值 resolvedLabel，由紧邻初始化决定。 */
  const resolvedLabel = pos === null
    ? null
    : typeof label === 'function' ? label() : label
  /** 中文说明：组件局部值 y，由紧邻初始化决定。 */
  const y = pos === null
    ? 0
    : placement === 'right'
      ? pos.top + (pos.bottom - pos.top) / 2
      : placement === 'top' ? pos.top - 8 : pos.bottom + 8
  /** 中文说明：组件局部值 EDGE_MARGIN，由紧邻初始化决定。 */
  const EDGE_MARGIN = 12
  // Viewport fit: fixed positioning knows nothing about edges, so a centered
  // bubble near the right edge would clip and a long label under an anchor low
  // on the page would run off the bottom. Horizontally the bubble slides back
  // inside; vertically it flips to the opposite side, which is the only move
  // that does not cover the anchor being read. Each measurement resets the base
  // position first, so a shorter label or a larger viewport releases a previous
  // adjustment without another render.
  useLayoutEffect(() => {
    if (pos === null) return
    /** 中文说明：组件局部值 fit，由紧邻初始化决定。 */
    const fit = () => {
      /** 中文说明：组件局部值 el，由紧邻初始化决定。 */
      const el = bubble.current
      /* v8 ignore next -- pos is set only while the bubble is mounted. */
      if (el === null) return
      el.style.left = `${pos.x}px`
      /** 中文说明：组件局部值 r，由紧邻初始化决定。 */
      const r = el.getBoundingClientRect()
      /** 中文说明：组件局部值 dx，由紧邻初始化决定。 */
      let dx = 0
      if (r.right > window.innerWidth - EDGE_MARGIN) dx = window.innerWidth - EDGE_MARGIN - r.right
      if (r.left + dx < EDGE_MARGIN) dx = EDGE_MARGIN - r.left
      el.style.left = `${pos.x + dx}px`
      if (side === 'right') return
      // Flip only into a side that genuinely fits, so an anchor with room on
      // neither side keeps the requested placement instead of oscillating.
      /** 中文说明：组件局部值 fitsBelow，由紧邻初始化决定。 */
      const fitsBelow = pos.bottom + 8 + r.height <= window.innerHeight - EDGE_MARGIN
      /** 中文说明：组件局部值 fitsAbove，由紧邻初始化决定。 */
      const fitsAbove = pos.top - 8 - r.height >= EDGE_MARGIN
      if (placement === 'bottom' && !fitsBelow && fitsAbove) setPlacement('top')
      if (placement === 'top' && !fitsAbove && fitsBelow) setPlacement('bottom')
    }
    fit()
    window.addEventListener('resize', fit)
    return () => { window.removeEventListener('resize', fit) }
  }, [placement, pos, resolvedLabel, side])
  /** 中文说明：组件局部值 showTimer，由紧邻初始化决定。 */
  const showTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Hover and focus are independent triggers: the bubble hides only after
  // BOTH clear (hovering away from a focused anchor must not drop it).
  /** 中文说明：组件局部值 triggers，由紧邻初始化决定。 */
  const triggers = useRef({ hover: false, focus: false })

  // Disabling mid-hover (e.g. clicking a rail control expands the sidebar)
  // must drop an already-visible bubble: no mouseleave fires.
  /** 中文说明：组件局部值 cancelShow，由紧邻初始化决定。 */
  const cancelShow = useCallback(() => {
    if (showTimer.current === null) return
    clearTimeout(showTimer.current)
    showTimer.current = null
  }, [])
  useEffect(() => {
    if (disabled) {
      cancelShow()
      triggers.current = { hover: false, focus: false }
      setPos(null)
    }
    return cancelShow
  }, [cancelShow, disabled])

  /** 中文说明：组件局部值 show，由紧邻初始化决定。 */
  const show = () => {
    if (disabled) return
    /** 中文说明：组件局部值 el，由紧邻初始化决定。 */
    const el = anchor.current
    /* v8 ignore next -- the ref is attached by event time: events fire on the cloned anchor. */
    if (el === null) return
    /** 中文说明：组件局部值 r，由紧邻初始化决定。 */
    const r = el.getBoundingClientRect()
    // Every show starts from the requested side; the fit pass flips it only
    // where this anchor's position demands it.
    setPlacement(side)
    setPos({ x: side === 'right' ? r.right + 10 : r.left + r.width / 2, top: r.top, bottom: r.bottom })
  }
  /** 中文说明：组件局部值 showAfterHoverDelay，由紧邻初始化决定。 */
  const showAfterHoverDelay = () => {
    cancelShow()
    if (delayMs <= 0) {
      show()
      return
    }
    showTimer.current = setTimeout(() => {
      showTimer.current = null
      show()
    }, delayMs)
  }
  /** 中文说明：组件局部值 hide，由紧邻初始化决定。 */
  const hide = () => {
    cancelShow()
    if (!triggers.current.hover && !triggers.current.focus) setPos(null)
  }

  return (
    <>
      {cloneElement(children, {
        ref: mergedRef,
        onMouseEnter: (e) => { children.props.onMouseEnter?.(e); triggers.current.hover = true; showAfterHoverDelay() },
        onMouseLeave: (e) => { children.props.onMouseLeave?.(e); triggers.current.hover = false; cancelShow(); setPos(null) },
        onFocus: (e) => { children.props.onFocus?.(e); triggers.current.focus = true; cancelShow(); show() },
        onBlur: (e) => { children.props.onBlur?.(e); triggers.current.focus = false; hide() },
      })}
      {pos !== null && (
        <span
          ref={bubble}
          className={css.bubble}
          data-side={placement}
          style={{ left: pos.x, top: y, ...maxWidth === undefined ? {} : { maxWidth } }}
          role="tooltip"
        >
          {resolvedLabel}
        </span>
      )}
    </>
  )
}
