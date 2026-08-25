/**
 * ================================ 文件注释 ================================
 * 【文件职责】提供 useDismissOnOutsidePointer Hook：弹出层打开期间，指针按下发生在容器
 *             元素外部时自动关闭（"点击外部关闭"交互）。被任务列表、Cordis 面板等
 *             触发器自有的弹层使用。
 * 【技术维度】React useEffect；在 document 上监听 pointerdown（全局捕获任意位置的点击），
 *             用 Node.contains 判断按下目标是否落在 root 内部。
 * 【产品维度】弹出层需要点击外部自动收起，这是桌面端弹层的标准交互模式；本 Hook 把该
 *             行为收敛成一行调用，避免各组件重复实现。
 * 【逻辑维度】1) open 为 false 时不挂监听；2) closeOutside 判断目标归属并调用 setOpen(false)；
 *             3) 清理函数对称移除监听。
 * 【关键边界】root 必须同时包含触发器和弹层本体，否则点击触发器也会被当作"外部"而误关；
 *             事件用 pointerdown 而非 click，响应更及时且不与其它手势冲突。
 * 【新手阅读建议】理解 contains 的归属判断是核心；注意 root 的包含范围决定行为正确性。
 * ==========================================================================
 */
/**
 * Outside-pointer dismissal for trigger-owned popovers (jobs list, Cordis
 * panel): while the surface is open, a pointerdown outside the root closes it.
 */
/*
 * 本文件实现 useDismissOnOutsidePointer："点击外部关闭"弹层的标准交互——
 * 打开期间，root 之外的 pointerdown 会把 open 状态置回 false。
 */
import { useEffect } from 'react'
import type { RefObject } from 'react'

/**
 * Close an open popover when a pointerdown lands outside its root element.
 * @param root - element containing both the trigger and the open surface.
 * @param open - whether the surface is showing; false detaches the listener.
 * @param setOpen - state setter invoked with false on an outside pointerdown.
 */
/*
 * 在 root 之外按下指针时关闭打开的弹层。
 * 使用示例：useDismissOnOutsidePointer(containerRef, open, setOpen)。
 * @param root - 同时包含触发器和弹出面的元素；其内部的点击不会被当作"外部"。
 * @param open - 弹出面是否显示；false 时不挂载监听。
 * @param setOpen - 外部按下时以 false 调用的状态设置器。
 */
export function useDismissOnOutsidePointer(
  root: RefObject<HTMLElement | null>,
  open: boolean,
  setOpen: (open: boolean) => void,
): void {
  useEffect(() => {
    if (!open) return
    const closeOutside = (event: PointerEvent): void => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) {
        setOpen(false)
      }
    }
    document.addEventListener('pointerdown', closeOutside)
    return () => { document.removeEventListener('pointerdown', closeOutside) }
  }, [root, open, setOpen])
}
