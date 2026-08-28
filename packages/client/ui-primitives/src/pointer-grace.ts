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
