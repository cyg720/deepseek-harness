/*
 * ================================ 文件注释 ================================
 * 【文件职责】提供一个 React Hook：让"悬浮面板/弹层"始终贴在其触发元素下方，并在滚动、
 *             窗口缩放、面板自身尺寸变化时自动重新定位。是 ui-primitives 中 HoverCard、
 *             Menu 等浮层组件的位置基础。
 * 【技术维度】基于 React 的 useLayoutEffect + useState；通过 getBoundingClientRect 读取
 *             锚点视口坐标，再对 left/top 做视口内钳制（clamp）；监听 scroll（捕获阶段，
 *             能捕获嵌套滚动容器）、resize，并用 ResizeObserver 监听面板自身尺寸变化。
 * 【产品维度】桌面客户端 UI 中所有"从某个按钮/文本展开的下拉面板、气泡卡片"都需要正确
 *             的跟随定位，否则页面一滚动，浮层就停在原地造成错位。
 * 【逻辑维度】1) 定义 AnchoredPositionOptions 输入类型；2) useAnchoredPosition 内部维护
 *             position 状态；3) place() 计算并钳制坐标；4) open 为 true 时挂载监听、
 *             为 false 或卸载时清理并清空状态。
 * 【关键边界】仅在 open 为 true 时测量与监听；测量依赖真实布局，jsdom 环境测不出真实
 *             尺寸（对应 v8 ignore 块）；ResizeObserver 缺失时优雅降级，仅靠 scroll/resize。
 * 【新手阅读建议】先看接口 AnchoredPositionOptions 了解输入，再读 place() 内部的坐标钳制
 *             公式，最后看 useLayoutEffect 里挂载与清理的对称逻辑。
 * ==========================================================================
 */
/**
 * Keep a fixed-position floating element anchored to a trigger.
 *
 * A portaled panel is positioned from its anchor's viewport rect, which stops
 * being true the moment anything scrolls or the window resizes. This owns that
 * one concern: measure the anchor, offset the panel below it, clamp the result
 * inside the viewport, and re-run on scroll (capture phase, so scrollers nested
 * inside the page are caught too), on resize, and on the panel's own size
 * changes while the element is open.
 * @module @deepseek-ai/dsh-client-ui-primitives/useAnchoredPosition
 */
/*
 * 本文件实现 useAnchoredPosition：负责"浮层跟随锚点"这一件事——测量锚点、
 * 把面板偏移到其下方、钳制进视口，并在滚动、窗口缩放、面板尺寸变化时重算。
 */

import { useLayoutEffect, useState, type CSSProperties, type RefObject } from 'react'

/** Inputs for {@link useAnchoredPosition}. */
/*
 * useAnchoredPosition 的输入参数集：由调用方传入"是否打开"、锚点与面板的引用，
 * 以及间距与边距常量。
 */
export interface AnchoredPositionOptions {
  /** Whether the floating element is mounted and should track its anchor. */
  // 浮层是否已挂载并需要跟随锚点；false 时不测量、直接返回 null。
  open: boolean
  /** The element the panel is placed from. */
  // 锚点元素（通常是触发按钮），面板相对它定位。
  anchorRef: RefObject<HTMLElement | null>
  /** The floating element, measured so the clamp uses real dimensions. */
  // 浮层面板元素；钳制计算需要读取它的真实宽高。
  panelRef: RefObject<HTMLElement | null>
  /** Distance kept between the anchor's bottom edge and the panel's top. */
  // 面板顶部与锚点底边之间保留的间距（px）。
  gap: number
  /** Distance kept between the panel and each viewport edge. */
  // 面板与视口边缘之间保留的最小边距（px）。
  margin: number
}

/**
 * Track an anchor and return the panel's fixed coordinates.
 * @param options - the open state, the two refs, and the gap/margin distances.
 * @returns `left`/`top` for the panel, or `null` before the first measurement.
 */
/*
 * 跟踪锚点并返回面板的 fixed 定位坐标。
 * 使用示例：const pos = useAnchoredPosition({ open, anchorRef, panelRef, gap: 8, margin: 12 })；
 *   pos 为 null 时渲染 null，否则把 { left, top } 作为面板的 style。
 * @param options - 是否打开、两个 ref、间距与边距。
 * @returns 面板的 { left, top } 定位样式，首次测量完成前为 null。
 */
export function useAnchoredPosition(options: AnchoredPositionOptions): CSSProperties | null {
  const { open, anchorRef, panelRef, gap, margin } = options
  // position 为 null 表示"尚未测量/已关闭"；非 null 时才把坐标应用到面板。
  const [position, setPosition] = useState<CSSProperties | null>(null)
  useLayoutEffect(() => {
    if (!open) {
      // 关闭状态：清空坐标并返回，不挂载任何监听。
      setPosition(null)
      return
    }
    // place 负责一次完整的"测量 + 钳制 + 更新状态"；任何相关事件都会重新执行它。
    const place = () => {
      /* v8 ignore start -- geometry read from real layout: jsdom reports zero
         offset sizes, so the positive-size clamp arms are exercised by browser
         scenarios rather than unit tests. */
      const rect = anchorRef.current?.getBoundingClientRect()
      if (rect === undefined) return
      const panel = panelRef.current
      const width = panel?.offsetWidth ?? 0
      const height = panel?.offsetHeight ?? 0
      // 默认把面板放在锚点正下方（left 对齐锚点左缘，top 在锚点底边之下 gap 处）。
      let left = rect.left
      let top = rect.bottom + gap
      // 钳制公式：Math.min(Math.max(x, margin), 视口尺寸 - x 方向尺寸 - margin)，
      // 即"至少离边距 margin，至多不越出视口"；宽/高为 0（未布局）时跳过该轴。
      if (width > 0) left = Math.min(Math.max(left, margin), window.innerWidth - width - margin)
      if (height > 0) top = Math.min(Math.max(top, margin), window.innerHeight - height - margin)
      /* v8 ignore stop */
      setPosition({ left, top })
    }
    // The first run measures the panel in the same commit that opened it, so
    // the clamp uses real dimensions before anything paints.
    // 首次运行在"打开"的同一次提交里测量面板，使钳制在绘制前就使用真实尺寸。
    place()
    // 捕获阶段监听滚动，能捕获页面内嵌套滚动容器的滚动；resize 监听窗口缩放。
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    // The panel's own height changes without either event — a status line
    // appearing inside it, or a `resize: vertical` textarea dragged taller —
    // and a stale clamp would let a panel near the bottom edge cross the
    // margin it is supposed to respect. The guard keeps the hook usable where
    // `ResizeObserver` is absent, which is how jsdom runs.
    // 面板自身高度变化（内部出现状态行、用户拖拽 textarea 变高）不会触发 scroll/resize，
    // 陈旧的高度上限会让靠近底部的面板越过边距；用 ResizeObserver 兜底，缺失时优雅降级。
    const panel = panelRef.current
    let observer: ResizeObserver | null = null
    if (typeof ResizeObserver !== 'undefined' && panel !== null) {
      observer = new ResizeObserver(place)
      observer.observe(panel)
    }
    return () => {
      observer?.disconnect()
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [open, anchorRef, panelRef, gap, margin])
  return position
}
