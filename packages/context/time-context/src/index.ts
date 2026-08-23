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

/**
 * Opt-in request clock context. Eligible steps add durable,
 * source-attributed time readings to the request history.
 *
 * @module @deepseek-ai/dsh-time-context
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import {
  deriveBrowserTimeZoneContext,
  renderBrowserTimeZoneContext,
} from './request-zone.ts'
import type { BrowserTimeZoneContext } from './request-zone.ts'
import { createTimestampFormatter, formatTimestamp } from './timestamp.ts'

/** Cordis plugin name used by loader diagnostics. */
/** Cordis 插件名：加载器诊断与消息来源归属都用它。 */
export const name = 'time-context'

/** The agent registry that owns pre-step processing. */
/** 依赖注入声明：需要 agents 服务（agent 生命周期与 pre-step 处理）。 */
export const inject = ['agents']

/** Request-preparation clock formatting and append scheduling. Invalid values fail plugin load. */
/** 请求准备期的时钟格式化与追加调度配置；非法值会导致插件加载失败。 */
export interface Config {
  /** Fallback display zone when the open turn has no unique browser zone. Omit to use the process zone. */
  /** 当回合没有唯一浏览器时区时使用的兜底展示时区；省略则用进程时区。 */
  timeZone?: string
  /** Minimum milliseconds between durable injections in one session. Omit or set to 0 to inject at every eligible step. */
  /** 同一会话内两次持久化注入的最小间隔毫秒数；省略或 0 表示每个合格步骤都注入。 */
  refreshIntervalMs?: number
}

/** Schemastery validation for {@link Config}. */
/** Config 的 schemastery 校验模式：配置类型声明（值仍为可选项）。 */
export const Config: z<Config> = z.object({
  timeZone: z.string(),
  refreshIntervalMs: z.number(),
})

/** Format a non-negative elapsed millisecond count as compact whole-second units. */
/** 把非负流逝毫秒数格式化为紧凑的整秒单位：如 2d 3h 4m 5s。 */
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

/** Find the latest model-visible event, excluding this plugin's pending append. */
/** 找最近一条模型可见事件的时间：用户/助手消息或工具结果，排除本插件待追加的读取。 */
function precedingMessageTime(agent: Agent): number | undefined {
  for (const event of [...agent.session.events].reverse()) {
    switch (event.type) {
      case 'user/message':
      case 'assistant/message':
      case 'tool/result':
        return event.time
      default:
        // Merge-extensible session events: non-surface records are not messages.
        // 会话事件可扩展合并：非表面记录（如 turn/start）不是消息，跳过
        break
    }
  }
  return undefined
}

/** Find the preceding time-context event within the open turn. */
/** 在打开的回合内找上一条时间上下文事件（步骤 2+ 的流逝基线）。 */
function precedingStepContextTime(agent: Agent, turn: number): number | undefined {
  for (const event of [...agent.session.events].reverse()) {
    if (event.type === 'turn/start' && event.data.turn === turn) return undefined
    if (event.type === 'user/message'
      && event.data.source.kind === 'plugin'
      && event.data.source.plugin === name) {
      return event.time
    }
  }
  return undefined
}

/** Find this plugin's latest durable injection, including a shadowed surface event. */
/** 找本插件最近一次持久化注入的时间（含被遮蔽的表面事件），用于节流判断。 */
function latestInjectionTime(agent: Agent): number | undefined {
  for (const event of [...agent.session.events].reverse()) {
    if (event.type === 'user/message'
      && event.data.source.kind === 'plugin'
      && event.data.source.plugin === name) {
      return event.time
    }
  }
  return undefined
}

/** Collect already-entered and proposed user messages belonging to one open turn. */
/** 收集属于某回合的已进入与拟进入用户消息（供浏览器时区推导）。 */
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

/**
 * 拼装时间读取文本：时间戳行 + 浏览器时区行 + 流逝时间行。
 * @param now 采样时刻（纪元毫秒）
 * @param turn 当前回合号
 * @param step 当前步骤号
 * @param previous 流逝基线的上一个时间点（无则显示 unavailable）
 * @param formatter 选定时区的格式化器
 * @param timeZone 展示时区标签
 * @param browserContext 浏览器时区事实（渲染策略文本）
 * @returns 完整的时间读取文本
 */
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
/** 拒绝无法表示精确毫秒阈值的刷新间隔：必须是非负安全整数。 */
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
/**
 * 注册一个 prepend 的 pre-step 监听（随 ctx 生命周期一起卸载）：
 * 每个合格步骤在消息末尾追加一条持久化时间读取。
 * @param ctx 插件上下文；监听随其一起销毁
 * @param config 时区与持久化刷新调度配置
 * @throws 刷新间隔非法、或配置/进程时区无法解析时抛出
 */
export function apply(ctx: Context, config: Config): void {
  const timeZone = config.timeZone
  const refreshIntervalMs = config.refreshIntervalMs
  validateRefreshInterval(refreshIntervalMs)
  // 进程时区格式化器作为兜底：构建失败（时区不可用）时直接报错
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
  // 按需创建的时区格式化器缓存：同一会话内避免反复构造 Intl 对象
  const formatters = new Map<string, Intl.DateTimeFormat>([[fallbackTimeZone, fallbackFormatter]])

  /** Resolve and cache one request-local timestamp formatter. */
  /** 解析并缓存一个请求局部的时区格式化器（首次使用才创建）。 */
  const formatterFor = (selectedTimeZone: string): Intl.DateTimeFormat => {
    const existing = formatters.get(selectedTimeZone)
    if (existing !== undefined) return existing
    const created = createTimestampFormatter(selectedTimeZone)
    formatters.set(selectedTimeZone, created)
    return created
  }

  ctx.on('agent/pre-step', async (
    { agent, turn, step, signal },
    next,
  ): Promise<PreStepDecision> => {
    const decision = await next()
    if (decision.kind === 'reject' || signal.aborted) return decision
    const now = Date.now()
    // 节流：距上次注入不足 refreshIntervalMs 时跳过本次注入
    if (refreshIntervalMs !== undefined && refreshIntervalMs > 0) {
      const lastInjection = latestInjectionTime(agent)
      if (lastInjection !== undefined
        && now >= lastInjection
        && now - lastInjection < refreshIntervalMs) return decision
    }
    // 步骤 1 以上一条模型可见消息为基线，步骤 2+ 以上一步的上下文读取为基线
    const previous = step === 1
      ? precedingMessageTime(agent)
      : precedingStepContextTime(agent, turn)
    // 浏览器时区唯一时优先使用，否则回退到进程时区
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
      kind: 'enter',
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
