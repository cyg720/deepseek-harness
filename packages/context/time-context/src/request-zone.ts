/** Browser-zone derivation and model-facing policy text for one open request turn. */

/*
 * ================================ 文件注释 ================================
 * 【文件职责】浏览器时区推导与模型可见的策略文本：从一个打开回合内的
 *             user-rpc 消息中提取客户端时区，决定"按哪个时区解读时间"。
 * 【技术维度】读取用户消息 source 中的 clientTimeZone 字段；用
 *             Intl.DateTimeFormat.resolvedOptions 做规范性校验；输出
 *             三态结果（唯一/混合/缺失）及对应的模型指导语句。
 * 【产品维度】Web 端用户在不同时区使用产品：模型说"3 点"时必须知道按
 *             谁的 3 点算，本模块给出唯一时区或提示向用户澄清。
 * 【逻辑维度】1) browserTimeZone：单条消息提取并校验时区；2)
 *             deriveBrowserTimeZoneContext：聚合去重排序得出三态；3)
 *             renderBrowserTimeZoneContext：把三态渲染成模型指令行。
 * 【关键边界】时区必须规范（UTC 或 IANA Area/Location 且与 resolvedOptions
 *             一致），否则抛 TypeError——配置/宿主错误要大声失败；
 *             混合时区明确要求模型向用户澄清而不是擅自假设。
 * 【新手阅读建议】先看三态联合类型，再看校验细节（规范化/支持性/大小写），
 *                 最后看每种状态渲染出的策略文本。
 * ==========================================================================
 */

import type { UserMessage } from '@deepseek-ai/dsh-llm'
import { assertNever } from '@deepseek-ai/dsh-util-values'

const IANA_TIME_ZONE = /^[A-Za-z][A-Za-z0-9_+.-]*(?:\/[A-Za-z0-9_+.-]+)+$/

/** Browser-zone facts derived from user-rpc messages in one open turn. */
export type BrowserTimeZoneContext =
  | { readonly kind: 'resolved'; readonly timeZone: string }
  | { readonly kind: 'mixed'; readonly timeZones: readonly string[] }
  | { readonly kind: 'missing' }

/** Read and validate a Host-canonicalized browser zone from one ordinary user-rpc message. */
function browserTimeZone(message: UserMessage): string | undefined {
  const source = message.source
  const value = source.kind === 'user'
    && 'rpcId' in source
    && typeof source.rpcId === 'string'
    && 'clientTimeZone' in source
    && typeof source.clientTimeZone === 'string'
    ? source.clientTimeZone
    : undefined
  if (value === undefined) return undefined
  if (value !== 'UTC' && !IANA_TIME_ZONE.test(value)) {
    throw new TypeError(
      `browser time zone must be canonical UTC or IANA Area/Location: ${JSON.stringify(value)}`,
    )
  }
  let canonical: string
  try {
    canonical = new Intl.DateTimeFormat('en-US', { timeZone: value }).resolvedOptions().timeZone
  } catch (error: unknown) {
    throw new TypeError(`browser time zone is unsupported: ${JSON.stringify(value)}`, { cause: error })
  }
  if (canonical !== value) {
    throw new TypeError(`browser time zone must be canonical: ${JSON.stringify(value)}`)
  }
  return value
}

/**
 * Derive the unique, mixed, or missing browser zone for one open turn.
 * @param messages - Entered and proposed user messages belonging to the turn.
 * @returns Sorted, duplicate-free browser-zone facts.
 * @throws TypeError when a user-rpc source carries an invalid or noncanonical zone.
 */
export function deriveBrowserTimeZoneContext(
  messages: readonly UserMessage[],
): BrowserTimeZoneContext {
  const timeZones = [...new Set(messages.flatMap((message) => {
    const timeZone = browserTimeZone(message)
    return timeZone === undefined ? [] : [timeZone]
  }))].sort()
  const [timeZone, ...remaining] = timeZones
  if (timeZone === undefined) return { kind: 'missing' }
  if (remaining.length === 0) return { kind: 'resolved', timeZone }
  return { kind: 'mixed', timeZones }
}

/**
 * Render the model instruction for one browser-zone context.
 * @param context - Browser-zone facts for the open turn.
 * @returns One durable policy line.
 */
export function renderBrowserTimeZoneContext(context: BrowserTimeZoneContext): string {
  switch (context.kind) {
    case 'resolved':
      return `Browser time zone for this request: ${context.timeZone}. `
        + 'Interpret otherwise-unqualified dates and times in this zone.'
    case 'mixed':
      return `Browser time zone for this request: mixed ${JSON.stringify(context.timeZones)}. `
        + 'Ask the user to clarify otherwise-unqualified dates and times.'
    case 'missing':
      return 'Browser time zone for this request: unavailable. '
        + 'Ask the user to clarify otherwise-unqualified dates and times.'
    /* v8 ignore next 2 -- the closed BrowserTimeZoneContext union is exhausted above. */
    default:
      return assertNever(context, 'BrowserTimeZoneContext')
  }
}
