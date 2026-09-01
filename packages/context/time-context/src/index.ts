/**
 * Opt-in request clock context. Eligible steps add durable,
 * source-attributed time readings to the request history.
 *
 * @module @deepseek-ai/dsh-time-context
 */

/**
 * ================================ 文件注释 ================================
 * 【文件职责】可选的请求时钟上下文插件：符合条件的模型步骤向请求历史追加
 *             一条持久的、带来源归属的时间读取消息，让模型知道"现在几点、
 *             距上一条消息过了多久"。
 * 【技术维度】prepend 的 agent/pre-step 瀑布监听（在其它监听之前改写消息）；
 *             Intl.DateTimeFormat 格式化时间戳；浏览器时区优先、进程时区兜底；
 *             refreshIntervalMs 节流避免每条消息都注入。
 * 【产品维度】用户说"十分钟前那个文件"时，模型需要真实的时间参考；时间读取
 *             消息是模型可见内容，会持久化进会话日志以便回放校验。
 * 【逻辑维度】1) 配置（timeZone 兜底时区 + refreshIntervalMs 注入间隔）；
 *             2) 计时基线查找（precedingMessageTime / precedingStepContextTime /
 *             latestInjectionTime）；3) apply：pre-step 时按节流条件决定是否
 *             注入，拼装时间读取文本并追加为 plugin 来源用户消息。
 * 【关键边界】步骤 1 以"上一条模型可见消息"为流逝基线，其余步骤以上一步
 *             上下文为基线；浏览器时区唯一时用它展示时间戳，否则用进程时区；
 *             注入内容必须与 invariant.ts 的格式约定一致。
 * 【新手阅读建议】先读 Config 与 apply 的主流程，再读三个"找时间点"函数
 *                 理解基线选择，最后看 renderText 的文本拼装。
 * ==========================================================================
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { z as zod } from 'zod'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-session-projection'
import {
  deriveBrowserTimeZoneContext,
  renderBrowserTimeZoneContext,
} from './request-zone.ts'
import type { BrowserTimeZoneContext } from './request-zone.ts'
import { createTimestampFormatter, formatTimestamp } from './timestamp.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'time-context'

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    /** Latest time-context readings. */
    timeContext: TimeContextProjection
  }
}

const timeContextStateSchema = zod.object({
  /** Time of the latest model-visible event (user/assistant message, tool result), or null. */
  lastMessageTime: zod.number().nullable(),
  /** Time of this plugin's latest durable injection, or null. */
  lastInjectionTime: zod.number().nullable(),
  /** Latest injection time in the open turn, or null before that turn receives one. */
  lastTurnInjectionTime: zod.number().nullable(),
})

/** Folded time-context readings. */
type TimeContextProjection = zod.infer<typeof timeContextStateSchema>

/** The agent registry that owns pre-step processing. */
export const inject = ['agents', 'sessionProjections']

/** Request-preparation clock formatting and append scheduling. Invalid values fail plugin load. */
export interface Config {
  /** Fallback display zone when the open turn has no unique browser zone. Omit to use the process zone. */
  timeZone?: string
  /** Minimum milliseconds between durable injections in one session. Omit or set to 0 to inject at every eligible step. */
  refreshIntervalMs?: number
}

/** Schemastery validation for {@link Config}. */
export const Config: z<Config> = z.object({
  timeZone: z.string(),
  refreshIntervalMs: z.number(),
})

/** Format a non-negative elapsed millisecond count as compact whole-second units. */
function formatDuration(elapsedMs: number): string {
  let seconds = Math.floor(Math.max(0, elapsedMs) / 1000)
  const days = Math.floor(seconds / 86_400)
  seconds %= 86_400
  const hours = Math.floor(seconds / 3600)
  seconds %= 3600
  const minutes = Math.floor(seconds / 60)
  seconds %= 60
  const parts: string[] = []
  if (days > 0) parts.push(`${days}d`)
  if (hours > 0) parts.push(`${hours}h`)
  if (minutes > 0) parts.push(`${minutes}m`)
  parts.push(`${seconds}s`)
  return parts.join(' ')
}

/** Collect already-entered and proposed user messages belonging to one open turn. */
function requestMessages(agent: Agent, turn: number, proposed: readonly UserMessage[]): UserMessage[] {
  const start = agent.session.events.findLastIndex(
    event => event.type === 'turn/start' && event.data.turn === turn,
  )
  const entered = start < 0
    ? []
    : agent.session.events.slice(start + 1)
      .flatMap(event => event.type === 'user/message' ? [event.data] : [])
  return [...entered, ...proposed]
}

function renderText(
  now: number,
  turn: number,
  step: number,
  previous: number | undefined,
  formatter: Intl.DateTimeFormat,
  timeZone: string,
  browserContext: BrowserTimeZoneContext,
): string {
  const elapsed = previous === undefined ? 'unavailable' : formatDuration(now - previous)
  const baseline = step === 1 ? 'model-visible message' : 'step context'
  const browserText = renderBrowserTimeZoneContext(browserContext)
  return `Time sampled while preparing turn ${turn}, step ${step}: ${formatTimestamp(now, formatter, timeZone)}\n`
    + `${browserText}\n`
    + `Elapsed since the preceding ${baseline}: ${elapsed}.`
}

/** Reject refresh intervals that cannot represent an exact elapsed-millisecond threshold. */
function validateRefreshInterval(refreshIntervalMs: number | undefined): void {
  if (refreshIntervalMs !== undefined && (
    !Number.isSafeInteger(refreshIntervalMs)
    || refreshIntervalMs < 0
  )) {
    throw new TypeError(
      `time-context: refreshIntervalMs must be a non-negative safe integer, got ${String(refreshIntervalMs)}`,
    )
  }
}

/**
 * Register a prepended pre-step listener for the lifetime of `ctx`.
 * @param ctx - plugin context; the listener is disposed with it.
 * @param config - time zone and durable refresh scheduling configuration.
 * @throws when the refresh interval is invalid or the configured or process time zone cannot be resolved.
 */
export function apply(ctx: Context, config: Config): void {
  const timeZone = config.timeZone
  const refreshIntervalMs = config.refreshIntervalMs
  validateRefreshInterval(refreshIntervalMs)
  let fallbackFormatter: Intl.DateTimeFormat
  try {
    fallbackFormatter = createTimestampFormatter(timeZone)
  } catch (error: unknown) {
    const message = timeZone === undefined
      ? 'time-context: failed to resolve the system time zone'
      : `time-context: invalid IANA timeZone ${JSON.stringify(timeZone)}`
    throw new Error(message, { cause: error })
  }
  const fallbackTimeZone = fallbackFormatter.resolvedOptions().timeZone
  const formatters = new Map<string, Intl.DateTimeFormat>([[fallbackTimeZone, fallbackFormatter]])

  /** Resolve and cache one request-local timestamp formatter. */
  const formatterFor = (selectedTimeZone: string): Intl.DateTimeFormat => {
    const existing = formatters.get(selectedTimeZone)
    if (existing !== undefined) return existing
    const created = createTimestampFormatter(selectedTimeZone)
    formatters.set(selectedTimeZone, created)
    return created
  }

  ctx.sessionProjections.register({
    key: 'timeContext',
    stateVersion: 2,
    stateSchema: timeContextStateSchema,
    init: () => ({ lastMessageTime: null, lastInjectionTime: null, lastTurnInjectionTime: null }),
    apply: (state, event) => {
      if (event.type === 'turn/start' || event.type === 'turn/end') {
        return state.lastTurnInjectionTime === null ? state : { ...state, lastTurnInjectionTime: null }
      }
      if (event.type === 'user/message') {
        const injected = event.data.source.kind === 'plugin' && event.data.source.plugin === name
        const withMessage = state.lastMessageTime === event.time
          ? state
          : { ...state, lastMessageTime: event.time }
        if (!injected) return withMessage
        return {
          ...withMessage,
          lastInjectionTime: event.time,
          lastTurnInjectionTime: event.time,
        }
      }
      if (event.type === 'assistant/message' || event.type === 'tool/result') {
        return state.lastMessageTime === event.time ? state : { ...state, lastMessageTime: event.time }
      }
      return state
    },
  })

  ctx.on('agent/pre-step', async (
    { agent, turn, step, signal },
    next,
  ): Promise<PreStepDecision> => {
    const decision = await next()
    if (decision.kind === 'reject' || signal.aborted) return decision
    const now = Date.now()
    const state = ctx.sessionProjections.stateOf(agent.session, 'timeContext') as TimeContextProjection
    if (refreshIntervalMs !== undefined && refreshIntervalMs > 0) {
      const lastInjection = state.lastInjectionTime
      if (lastInjection != null
        && now >= lastInjection
        && now - lastInjection < refreshIntervalMs) return decision
    }
    /* v8 ignore next 6 -- every later step follows a recorded injection in the same turn */
    const previous = step === 1
      ? state.lastMessageTime ?? undefined
      : state.lastTurnInjectionTime ?? undefined
    const messages = requestMessages(agent, turn, decision.messages)
    const browser = deriveBrowserTimeZoneContext(messages)
    const selectedTimeZone = browser.kind === 'resolved' ? browser.timeZone : fallbackTimeZone
    const text = renderText(
      now,
      turn,
      step,
      previous,
      formatterFor(selectedTimeZone),
      selectedTimeZone,
      browser,
    )
    return {
      ...decision,
      messages: [
        ...decision.messages,
        createUserMessage({
          content: [{ type: 'text', text }],
          source: { kind: 'plugin', plugin: name, form: 'snapshot', sections: [{ name, text }] },
        }),
      ],
    }
  }, { prepend: true })
}
