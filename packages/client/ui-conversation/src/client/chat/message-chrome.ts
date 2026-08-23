/**
 * ================================ 文件注释 ================================
 * 【文件职责】用户 / 助手消息行的共享时间标签工具：本地日零点、距下一午夜的毫秒数、
 *             已运行时长、延迟秒数、解码吞吐与本地时钟文本。
 * 【技术维度】纯函数；日期用本地时区运算；模板参数经翻译座位插值，单位后缀由 locale 模板
 *             决定（数值本身无单位）。
 * 【产品维度】消息行上的时间戳 / 运行时长 / 首 token 延迟 / tok/s 等小字信息。
 * 【逻辑维度】1) 翻译子类型；2) pad2 补零；3) 日边界两函数；4) 时长 / 延迟 / 吞吐格式化；
 *             5) 本地时钟（同日 HH:mm，同年加日期，跨年加年月日）。
 * 【关键边界】负值钳制为 0；秒数 <10 显示一位小数；时钟为 24 小时制补零。
 * 【新手阅读建议】formatMessageClock 的日期分支是理解重点。
 * ==========================================================================
 */
// Shared time-label helpers for user/assistant IconActions rows.

import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'

/** The date-template share of the conversation dictionary the clock consumes. */
export type ClockTranslate = Translate<'clock.md' | 'clock.ymd'>

/** The elapsed-duration share of the conversation dictionary. */
export type RunDurationTranslate = Translate<'duration.seconds' | 'duration.minutes'>
function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/**
 * Local calendar-day epoch (ms at local midnight) for an instant.
 * @param ms - Unix epoch ms.
 * @returns Midnight of that local calendar day.
 */
/**
 * 某个时刻所在本地日历日的零点（毫秒）。
 * @param ms - Unix 毫秒时间戳。
 * @returns 该本地日历日的零点。
 */
export function startOfLocalDay(ms: number): number {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/**
 * Delay until the next local midnight after `ms` (at least 1ms).
 * @param ms - Unix epoch ms.
 * @returns Milliseconds until the following local midnight.
 */
/**
 * 距 ms 之后下一个本地午夜的延迟（至少 1ms）。
 * @param ms - Unix 毫秒时间戳。
 * @returns 到下一个本地午夜之间的毫秒数。
 */
export function msUntilNextLocalMidnight(ms: number): number {
  const next = new Date(ms)
  next.setHours(24, 0, 0, 0)
  return Math.max(next.getTime() - ms, 1)
}

/**
 * Localized elapsed-time label shared by running and settled turn chrome.
 * @param ms - Elapsed duration in milliseconds (negatives clamp to zero).
 * @param t - Translate seat supplying the duration templates.
 * @returns Display string in whole seconds.
 */
/**
 * 运行中与已定格回合装饰共用的本地化已用时标签。
 * @param ms - 已用时毫秒（负数钳制为 0）。
 * @param t - 提供时长模板的翻译座位。
 * @returns 整数秒的显示串。
 */
export function formatRunDuration(ms: number, t: RunDurationTranslate): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return minutes > 0
    ? t('duration.minutes', { minutes, seconds: String(seconds).padStart(2, '0') })
    : t('duration.seconds', { seconds })
}

/**
 * Sub-turn latency figure: one decimal under ten seconds, whole seconds
 * beyond. Unit-less so the locale template owns the second suffix.
 * @param ms - Latency in milliseconds (negatives clamp to zero).
 * @returns Display number in seconds without unit.
 */
/**
 * 子回合延迟数字：10 秒以内一位小数，以上取整秒。无单位——秒的后缀由语言模板负责。
 * @param ms - 延迟毫秒（负数钳制为 0）。
 * @returns 以秒计的显示数字（无单位）。
 */
export function formatLatencySeconds(ms: number): string {
  const s = Math.max(0, ms) / 1000
  return s < 10 ? String(Math.round(s * 10) / 10) : String(Math.round(s))
}

/**
 * Decode-throughput figure: whole tokens from ten up, one decimal below.
 * @param tps - Tokens per second.
 * @returns Display number without unit.
 */
/**
 * 解码吞吐数字：10 以上取整，以下一位小数。
 * @param tps - 每秒 token 数。
 * @returns 无单位的显示数字。
 */
export function formatTokensPerSecond(tps: number): string {
  const clamped = Math.max(0, tps)
  return clamped >= 10 ? String(Math.round(clamped)) : String(Math.round(clamped * 10) / 10)
}

/**
 * Compact local timestamp for message IconActions. Same calendar day →
 * `HH:mm`; earlier this year → the `clock.md` date template + clock; other
 * years → the `clock.ymd` template + clock. Pure: the date templates arrive
 * through the caller's locale seat.
 * @param time - Unix epoch ms from the source session event.
 * @param t - translate seat supplying the `clock.md` / `clock.ymd` templates.
 * @param now - Reference instant for the day/year cut (defaults to wall clock).
 * @returns Date-aware clock string (24-hour, zero-padded time).
 */
/**
 * 消息行图标动作的紧凑本地时间戳：同一日历日只显示 HH:mm；同年更早显示"日期模板 + 时钟"；
 * 跨年显示"年月日模板 + 时钟"。纯函数——日期模板来自调用方的 locale 座位。
 * @param time - 源会话事件的 Unix 毫秒时间戳。
 * @param t - 提供 clock.md / clock.ymd 模板的翻译座位。
 * @param now - 日 / 年切分的参考时刻（缺省为当前时刻）。
 * @returns 带日期的时钟串（24 小时制、补零）。
 */
export function formatMessageClock(time: number, t: ClockTranslate, now: number = Date.now()): string {
  const d = new Date(time)
  const n = new Date(now)
  const clock = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
  if (
    d.getFullYear() === n.getFullYear()
    && d.getMonth() === n.getMonth()
    && d.getDate() === n.getDate()
  ) {
    return clock
  }
  const params = { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() }
  const md = d.getFullYear() === n.getFullYear() ? t('clock.md', params) : t('clock.ymd', params)
  return `${md} ${clock}`
}
