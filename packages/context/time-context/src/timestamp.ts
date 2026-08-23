/**
 * ================================ 文件注释 ================================
 * 【文件职责】时间上下文（time-context）时间戳的格式化：生产环境注入与
 *             回放校验共用同一套"ISO 外形 + 偏移 + IANA 时区"格式，
 *             保证两边解析结果一致。
 * 【技术维度】Intl.DateTimeFormat + formatToParts 逐段取字段；en-US 区域 +
 *             longOffset 时区名（形如 GMT+08:00）；输出 yyyy-MM-ddTHH:mm:ss
 *             ±HH:MM[Zone] 的 ISO 外形字符串。
 * 【产品维度】模型需要知道"现在几点、哪个时区"才能正确解释相对时间；
 *             这里产出的人类可读时间戳随每次请求注入对话。
 * 【逻辑维度】1) createTimestampFormatter：构造固定字段/循环制的格式化器；
 *             2) formatTimestamp：把格式化器的字段拼成规范时间戳文本。
 * 【关键边界】格式必须与 invariant.ts 里的 READING 正则严格吻合；
 *             timeZoneName 取长偏移（GMT+08:00）而非缩写（CST）。
 * 【新手阅读建议】先看 formatter 的字段配置，再看 formatTimestamp 的拼装
 *                 与 GMT 归一化处理。
 * ==========================================================================
 */

/** ISO-shaped time-context timestamp formatting shared by production and replay validation. */

/** 拼装时间戳所需的字段类型：年月日时分秒 + 时区名。 */
type TimestampPart = 'day' | 'hour' | 'minute' | 'month' | 'second' | 'timeZoneName' | 'year'

/**
 * Create the exact formatter used by durable time-context readings.
 * @param timeZone - Explicit display zone, or `undefined` for the process fallback.
 * @returns A formatter with stable numeric local fields and long numeric offset.
 */
/**
 * 创建持久化时间读取用的精确格式化器：数字型年月日时分秒、24 小时制、
 * 长数字偏移时区名（GMT+08:00 而非 CST）。
 * @param timeZone 显式展示时区；缺省则用进程默认时区
 * @returns 字段固定、偏移为长数字形态的 Intl.DateTimeFormat
 */
export function createTimestampFormatter(timeZone?: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat('en-US', {
    ...(timeZone === undefined ? {} : { timeZone }),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
    timeZoneName: 'longOffset',
  })
}

/**
 * Format an epoch millisecond value as an ISO-shaped timestamp with offset and IANA zone.
 * @param now - Epoch milliseconds to display.
 * @param formatter - Formatter created for `timeZone`.
 * @param timeZone - Canonical zone label carried in brackets.
 * @returns The durable timestamp text.
 */
/**
 * 把纪元毫秒格式化为 ISO 外形时间戳：yyyy-MM-ddTHH:mm:ss±HH:MM[Zone]。
 * 偏移取 timeZoneName 去掉 GMT 前缀（GMT 本身归一化为 GMT+00:00）。
 * @param now 待展示的纪元毫秒时间
 * @param formatter 为 timeZone 创建的格式化器
 * @param timeZone 方括号里携带的规范时区标签（如 Asia/Shanghai）
 * @returns 持久化的时间戳文本
 */
export function formatTimestamp(now: number, formatter: Intl.DateTimeFormat, timeZone: string): string {
  // 把 formatToParts 的字段数组转成 key 为字段类型的对象，便于取各段
  const parts = Object.fromEntries(
    formatter.formatToParts(now).map(part => [part.type, part.value]),
  ) as Record<TimestampPart, string>
  // GMT 是 0 偏移的旧式写法，统一成 GMT+00:00 后去掉前缀得到 ±HH:MM
  const offset = parts.timeZoneName.replace(/^GMT$/, 'GMT+00:00').slice(3)
  return `${parts['year']}-${parts['month']}-${parts['day']}T${parts['hour']}:${parts['minute']}:${parts['second']}${offset}[${timeZone}]`
}
