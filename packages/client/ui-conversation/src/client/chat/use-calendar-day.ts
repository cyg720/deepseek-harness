/**
 * ================================ 文件注释 ================================
 * 【文件职责】提供 useCalendarDay：组件局部的"日历日"tick——返回当前本地日零点的毫秒值，
 *             并在下一个本地午夜自动更新。
 * 【技术维度】React Hook（useState + useEffect）；用 setTimeout 精确排定到下一个本地午夜，
 *             到点后递归重排。
 * 【产品维度】消息行的时间标签跨午夜时需要从"今天"切到"昨天"；组件本地状态避免引入
 *             框架级订阅。
 * 【逻辑维度】1) 初始日 = 今天零点；2) 每次到点更新并重排下一次定时。
 * 【关键边界】定时器在卸载时清理；只关心本地日历日边界。
 * 【新手阅读建议】注意 msUntilNextLocalMidnight 保证至少 1ms 的延迟。
 * ==========================================================================
 */
// Component-local calendar-day tick: memoized message rows keep stable props
// across midnight, so the IconActions clock needs a local day seat that
// re-fires at the next local midnight without reaching for framework hooks.

import { useEffect, useState } from 'react'
import { msUntilNextLocalMidnight, startOfLocalDay } from './message-chrome.ts'

/**
 * Local calendar-day epoch that advances at each local midnight.
 * @returns Midnight ms for the current local day; updates after the boundary.
 */
/**
 * 返回当前本地日零点毫秒值，并在每次本地午夜自动前进一步。
 * @returns 当前本地日的零点毫秒；跨过午夜边界后自动更新。
 */
export function useCalendarDay(): number {
  const [day, setDay] = useState(() => startOfLocalDay(Date.now()))
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const arm = (): void => {
      const now = Date.now()
      setDay(startOfLocalDay(now))
      timer = setTimeout(arm, msUntilNextLocalMidnight(now))
    }
    timer = setTimeout(arm, msUntilNextLocalMidnight(Date.now()))
    return () => { clearTimeout(timer) }
  }, [])
  return day
}
