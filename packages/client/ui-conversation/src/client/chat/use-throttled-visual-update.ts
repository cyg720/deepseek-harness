/**
 * ================================ 文件注释 ================================
 * 【文件职责】提供 useThrottledVisualUpdate：按帧间隔合并（coalesce）非关键的视觉对齐
 *             更新，返回稳定的调度函数。
 * 【技术维度】React Hook（useRef + useCallback + useLayoutEffect）；requestAnimationFrame
 *             递归倒数 intervalFrames 帧后才执行最新一次 update。
 * 【产品维度】滚动容器的贴底 / 高度微调等每帧都做会浪费性能；合并后最多每 N 帧执行一次。
 * 【逻辑维度】1) 常量；2) updateRef 始终指向最新闭包；3) 卸载时取消挂起的帧；
 *             4) 调度器：有挂起帧则忽略（合并），否则逐帧倒数后执行。
 * 【关键边界】一次调用只安排一个帧链，后续调用合并进去（只执行最后一次的最新状态）。
 * 【新手阅读建议】理解"帧倒数 + 合并"两个机制即可。
 * ==========================================================================
 */
/** Frame-throttled scheduling for non-essential visual alignment. */
import { useCallback, useLayoutEffect, useRef } from 'react'

// 默认间隔：等待 3 帧后才应用最新一次对齐更新。
const DEFAULT_INTERVAL_FRAMES = 3

/**
 * Return a stable scheduler that coalesces visual updates over a frame interval.
 * @param update - DOM alignment to run after the throttle interval.
 * @param intervalFrames - frames to wait before applying the latest alignment.
 * @returns a stable function that schedules the latest update.
 */
/**
 * 返回一个稳定的调度器，按帧间隔合并视觉更新。
 * 使用示例：const schedule = useThrottledVisualUpdate(() => align(), 3)；事件里调 schedule()。
 * @param update - 节流间隔结束后要执行的 DOM 对齐。
 * @param intervalFrames - 应用最新对齐前等待的帧数。
 * @returns 调度最新更新的稳定函数。
 */
export function useThrottledVisualUpdate(
  update: () => void,
  intervalFrames = DEFAULT_INTERVAL_FRAMES,
): () => void {
  const updateRef = useRef(update)
  updateRef.current = update
  const pendingFrameRef = useRef<number | null>(null)

  useLayoutEffect(() => () => {
    if (pendingFrameRef.current === null) return
    cancelAnimationFrame(pendingFrameRef.current)
    pendingFrameRef.current = null
  }, [])

  return useCallback(() => {
    if (pendingFrameRef.current !== null) return
    let remainingFrames = intervalFrames
    const advance = (): void => {
      remainingFrames -= 1
      if (remainingFrames > 0) {
        pendingFrameRef.current = requestAnimationFrame(advance)
        return
      }
      pendingFrameRef.current = null
      updateRef.current()
    }
    pendingFrameRef.current = requestAnimationFrame(advance)
  }, [intervalFrames])
}
