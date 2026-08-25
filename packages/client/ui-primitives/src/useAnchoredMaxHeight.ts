/*
 * ================================ 文件注释 ================================
 * 【文件职责】提供 useAnchoredMaxHeight Hook：把"底部对齐、向上生长"的浮层（斜杠菜单、
 *             popupSelect）的最大高度钳制在视口内，避免顶部被视口边缘裁掉。
 * 【技术维度】React Hook（useLayoutEffect + useState）；元素底边到视口顶部的距离减去安全
 *             边距即可用高度上限，再与设计上限 cap 取较小值；监听 resize 与捕获阶段 scroll。
 * 【产品维度】输入框上方弹出的候选菜单会随输入内容变化高度，若超出视口顶部则无法选中
 *             靠上的选项；本 Hook 保证菜单永远完整可见。
 * 【逻辑维度】1) MARGIN 安全边距常量；2) 初始高度取 cap；3) fit() 计算实际可用最大高度；
 *             4) 挂载 resize/scroll 监听，signal 变化时（锚点移动、输入框生长）重新测量。
 * 【关键边界】只约束"元素底边到视口顶"这一段（向上生长场景，底边已固定）；ref 为 null
 *             （浮层关闭）时跳过测量；MARGIN 与 Menu 弹层的 portal 边距保持一致。
 * 【新手阅读建议】重点看 fit() 里 Math.min / Math.max 组合表达"双向钳制"的思路。
 * ==========================================================================
 */
/**
 * Viewport-fit hook for bottom-anchored overlays (slash menu, popupSelect):
 * the element's bottom edge is laid out independent of its height, so it
 * grows upward and only the top edge can collide with the viewport — clamp
 * the design cap to the space between that edge and the viewport top.
 */
/*
 * 本文件实现 useAnchoredMaxHeight：针对"底部对齐、向上生长"的浮层（斜杠菜单、popupSelect），
 * 把最大高度钳制在视口内——元素底边已固定，只有顶边可能与视口顶碰撞。
 */
import { useLayoutEffect, useState } from 'react'
import type { RefObject } from 'react'

/** Safe distance kept between the overlay and the viewport top edge (mirrors the Menu portal margin). */
// 浮层与视口顶边之间的安全距离（px），与 Menu 弹层的 portal 边距保持一致。
const MARGIN = 12

/**
 * Clamp a bottom-anchored overlay's max-height to the viewport.
 * @param ref - the overlay element; a null current (overlay closed) skips measuring.
 * @param cap - design max-height in px (the clamp never exceeds it).
 * @param signal - re-measure trigger: pass the overlay's render state so anchor
 *   moves (composer growth) re-fit; resize/scroll re-fit while mounted.
 * @returns the max-height to apply inline, in px.
 */
/*
 * 把底部对齐浮层的最大高度钳制到视口内。
 * 使用示例：const maxH = useAnchoredMaxHeight(menuRef, 320, open)；style={{ maxHeight: maxH }}。
 * @param ref - 浮层元素；current 为 null（浮层关闭）时跳过测量。
 * @param cap - 设计上的最大高度（px），钳制结果永远不会超过它。
 * @param signal - 重新测量的触发信号：传入浮层的渲染状态，锚点移动（如输入框变高）时
 *   重新适配；挂载期间 resize/scroll 也会重新适配。
 * @returns 应以内联样式应用的 max-height（px）。
 */
export function useAnchoredMaxHeight(ref: RefObject<HTMLElement>, cap: number, signal: unknown): number {
  // 初始高度取设计上限 cap；随后被实际可用空间收敛。
  const [maxHeight, setMaxHeight] = useState(cap)
  useLayoutEffect(() => {
    const el = ref.current
    if (el === null) return
    // fit 计算"元素底边到视口顶的距离 - 安全边距"，再与 cap 取较小者，下限为 0。
    const fit = () => {
      setMaxHeight(Math.min(cap, Math.max(0, el.getBoundingClientRect().bottom - MARGIN)))
    }
    // 挂载后立即测量一次，保证首次渲染就得到正确的最大高度。
    fit()
    window.addEventListener('resize', fit)
    window.addEventListener('scroll', fit, true)
    return () => {
      window.removeEventListener('resize', fit)
      window.removeEventListener('scroll', fit, true)
    }
  }, [ref, cap, signal])
  return maxHeight
}
