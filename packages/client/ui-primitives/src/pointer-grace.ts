/**
 * ================================ 文件注释 ================================
 * 【文件职责】提供"指针弹出层延迟关闭"机制 usePointerGrace：HoverCard、Menu 等悬停弹出
 *             组件在指针离开后不立即关闭，而是给 200ms 宽限期，让指针来得及跨过锚点与
 *             弹层之间的空隙。
 * 【技术维度】React Hook（useCallback + useRef + useEffect）；用 setTimeout 实现可取消的
 *             延迟回调；close 回调存入 ref，保证每次渲染都能取到最新闭包。
 * 【产品维度】悬浮卡片/菜单这类"移开即关"的交互如果反应太快，鼠标在途中弹层就消失了，
 *             体验割裂；宽限期是桌面 UI 弹层的常见设计。
 * 【逻辑维度】1) 定义 POINTER_GRACE_MS 常量；2) 定义 PointerGrace 句柄接口；
 *             3) usePointerGrace 用 timerRef 管理定时器：arm 重新计时、cancel 取消，
 *                组件卸载时自动取消挂起的关闭。
 * 【关键边界】宽限期结束仍未返回才真正触发 close；挂起定时器在卸载时被丢弃，避免对
 *             已卸载组件回调。
 * 【新手阅读建议】先理解"为什么需要宽限期"（锚点与弹层之间的地面空隙），再看 arm/cancel
 *             如何协作替换旧的挂起计时。
 * ==========================================================================
 */
// Shared close timing for pointer-dismissed popups (HoverCard, hover-closing
// Menu). Both float free of their anchor, so the pointer has to cross ground
// that belongs to neither on its way in; closing on the first pointerleave
// makes the popup unreachable. The grace turns that transit into a cancelable
// pending close.
// 本文件实现"指针弹出层延迟关闭"机制：HoverCard、Menu 等弹层与锚点之间存在地面空隙，
// 鼠标一离开就关闭会让弹层根本无法到达；宽限期把"关闭"变成可取消的挂起动作。

import { useCallback, useEffect, useRef } from 'react'

/**
 * Grace before a pointer-dismissed popup closes. Covers the anchor->popup gap
 * (8px for HoverCard, 4px for Menu) at a hand's travel speed without leaving a
 * popup lingering once the pointer has genuinely moved on.
 */
// 宽限期长度（ms）：覆盖锚点到弹层的空隙（HoverCard 8px、Menu 4px）所需的手速时间；
// 既让指针来得及到达，又不让弹层在指针真正离开后久久不关。
export const POINTER_GRACE_MS = 200

/** Cancelable delayed close for a pointer-dismissed popup. */
/*
 * 可取消的延迟关闭句柄：arm 重新计时，cancel 中止挂起的关闭。
 */
export interface PointerGrace {
  /** Schedule the close {@link POINTER_GRACE_MS} from now, replacing any pending one. */
  // 从现在起再过 POINTER_GRACE_MS 执行关闭；若已有挂起计时则先取消（相当于重置计时）。
  arm: () => void
  /** Abort a pending close (the pointer came back). */
  // 中止挂起的关闭（例如指针又回到了弹层上）。
  cancel: () => void
}

/**
 * Delay a pointer-dismissed popup's close so the pointer can cross the gap
 * between anchor and popup. A pending close is dropped on unmount.
 * @param close - runs when the grace elapses with no re-entry; read at fire
 * time, so callers may pass a fresh closure each render.
 * @returns the {@link PointerGrace} handle.
 */
/*
 * 延迟"指针移出"弹层的关闭动作，让指针有时间跨过锚点与弹层之间的空隙。
 * 使用示例：const { arm, cancel } = usePointerGrace(() => setOpen(false))；
 *   在 onPointerLeave 里调 arm、onPointerEnter 里调 cancel。
 * @param close - 宽限期结束且没有重新进入时执行；在触发时才读取，因此调用方每次
 *   渲染传新闭包也可以。
 * @returns PointerGrace 句柄（arm / cancel）。
 */
export function usePointerGrace(close: () => void): PointerGrace {
  // timerRef 保存挂起的定时器 id；null 表示当前没有挂起的关闭。
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // closeRef 始终指向最新的 close 闭包，避免 useCallback 因闭包变化而重建。
  const closeRef = useRef(close)
  closeRef.current = close

  const cancel = useCallback(() => {
    if (timerRef.current === null) return
    clearTimeout(timerRef.current)
    timerRef.current = null
  }, [])

  const arm = useCallback(() => {
    // 先取消旧的挂起计时再重新计时：连续触发 pointerleave 时宽限期从最后一次算起。
    cancel()
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      closeRef.current()
    }, POINTER_GRACE_MS)
  }, [cancel])

  // 组件卸载时取消挂起的关闭，避免对已卸载组件回调。
  useEffect(() => cancel, [cancel])

  return { arm, cancel }
}
