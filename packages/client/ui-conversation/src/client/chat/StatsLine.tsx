// Settled-node identity prevents stream-delta updates from rerendering this row.
// Mounted on 'conversation.composer.dock' so it sticks with the composer in the
// active conversation scrollport (see ConversationRoot data-conversation-scroll).
/**
 * 文件职责：实现会话聊天界面的 StatsLine 组件。
 * 技术维度：React、TypeScript、Cordis 插槽和 CSS Modules。
 * 产品维度：向用户展示并操作会话聊天相关状态。
 * 逻辑维度：读取属性与状态，派生展示数据并响应交互。
 * 关键边界：异步状态、可访问性标签和空数据分支必须保持一致。
 * 新手阅读建议：先读 Props，再看局部状态、effect 和 JSX。
 */

import { Fragment, memo, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ConversationSnapshot, UseProjection } from '@deepseek-ai/dsh-client-runtime/client'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: merges the sessionStats key into SessionProjectionMap for useProjection.
import type {} from '@deepseek-ai/dsh-session-stats/client'
import type { ContextPressureProjection, TokenUsageProjection } from '@deepseek-ai/dsh-token-meter/client'
import type { ComposerBarProps } from '../contract/slots.ts'
import { formatTokensPerSecond } from './message-chrome.ts'
import { assistantStepReading } from './turn-metrics.ts'
import css from './StatsLine.module.css'

/** 中文说明：类型或类 WindowStats 约束本文件的数据或组件职责。 */
interface WindowStats {
  turns: number
  steps: number
  /** Summed request wall time (step/start → assistant/message); 0 when no node carries timing. */
  llmMs: number
  /** Summed tool wall time (tool/call → tool/result); 0 when no pair is in-window. */
  toolMs: number
  /** Summed first-token latency over `ttftSteps`; 0 when no step records it. */
  ttftMs: number
  /** Steps carrying a recorded TTFT. */
  ttftSteps: number
  /** Summed decode wall time over steps that also report output tokens. */
  decodeMs: number
  /** Summed output tokens over the same decode-timed steps. */
  decodeTokens: number
}

/**
 * Fold assistant and tool-result nodes into window-scoped display totals —
 * the FALLBACK for assemblies without the `sessionStats` projection.
 *
 * Every displayed figure rides that durable whole-log projection (and token
 * accounting rides `tokenUsage`) because the window is paged and compaction
 * rewrites it; this fold answers "what is on screen" only when no projection
 * value is served. Its field names deliberately mirror the projection's so
 * the two swap wholesale.
 * @param nodes - snapshot nodes.
 * @returns fallback counts and summed wall times.
 */
/** 中文说明：函数 deriveStats 的参数见签名，返回结果供相邻流程使用；调用示例见本文件。 */
export function deriveStats(nodes: ConversationSnapshot['nodes']): WindowStats {
  /** 中文说明：当前组件的局部值 turns，由紧邻初始化决定。 */
  const turns = new Set<number>()
  /** 中文说明：当前组件的局部值 steps，由紧邻初始化决定。 */
  let steps = 0
  /** 中文说明：当前组件的局部值 llmMs，由紧邻初始化决定。 */
  let llmMs = 0
  /** 中文说明：当前组件的局部值 toolMs，由紧邻初始化决定。 */
  let toolMs = 0
  /** 中文说明：当前组件的局部值 ttftMs，由紧邻初始化决定。 */
  let ttftMs = 0
  /** 中文说明：当前组件的局部值 ttftSteps，由紧邻初始化决定。 */
  let ttftSteps = 0
  /** 中文说明：当前组件的局部值 decodeMs，由紧邻初始化决定。 */
  let decodeMs = 0
  /** 中文说明：当前组件的局部值 decodeTokens，由紧邻初始化决定。 */
  let decodeTokens = 0
  /** 中文说明：当前组件的局部值 node，由紧邻初始化决定。 */
  for (const node of nodes) {
    if (node.kind === 'tool-result') {
      if (node.callTime !== null) toolMs += Math.max(0, node.time - node.callTime)
      continue
    }
    if (node.kind !== 'assistant') continue
    turns.add(node.turn)
    steps += 1
    if (node.timing !== undefined && node.timing.stepStartTime !== null) {
      llmMs += Math.max(0, node.timing.completedTime - node.timing.stepStartTime)
    }
    /** 中文说明：当前组件的局部值 reading，由紧邻初始化决定。 */
    const reading = assistantStepReading(node)
    if (reading.ttftMs !== null) {
      ttftMs += reading.ttftMs
      ttftSteps += 1
    }
    if (reading.decodeMs !== null && reading.outputTokens !== null) {
      decodeMs += reading.decodeMs
      decodeTokens += reading.outputTokens
    }
  }
  return { turns: turns.size, steps, llmMs, toolMs, ttftMs, ttftSteps, decodeMs, decodeTokens }
}

/**
 * Compact token count: 517 / 12.2K / 517K / 1.2M (one decimal under three digits).
 * @param n - token count.
 * @returns display string.
 */
/** 中文说明：函数 formatTokens 的参数见签名，返回结果供相邻流程使用；调用示例见本文件。 */
export function formatTokens(n: number): string {
  /** 中文说明：当前组件的局部值 scaled，由紧邻初始化决定。 */
  const scaled = (v: number): string =>
    v >= 100 ? String(Math.round(v)) : String(Math.round(v * 10) / 10)
  if (n < 1_000) return String(n)
  if (n < 1_000_000) return `${scaled(n / 1_000)}K`
  return `${scaled(n / 1_000_000)}M`
}

/**
 * Compact duration: 45.2s under a minute, 2m42s from there on.
 * @param ms - duration in milliseconds.
 * @returns display string.
 */
/** 中文说明：函数 formatDuration 的参数见签名，返回结果供相邻流程使用；调用示例见本文件。 */
export function formatDuration(ms: number): string {
  /** 中文说明：当前组件的局部值 s，由紧邻初始化决定。 */
  const s = ms / 1_000
  if (s < 60) return `${Math.round(s * 10) / 10}s`
  /** 中文说明：当前组件的局部值 whole，由紧邻初始化决定。 */
  const whole = Math.round(s)
  return `${Math.floor(whole / 60)}m${whole % 60}s`
}

/** Round a cache-read ratio to an integer percentage, with positive ties rounded up. */
/** 中文说明：函数 roundedIntegerPercent 的参数见签名，返回结果供相邻流程使用；调用示例见本文件。 */
function roundedIntegerPercent(cacheReadTokens: number, denominator: number): number {
  /** 中文说明：当前组件的局部值 denominatorQuotient，由紧邻初始化决定。 */
  const denominatorQuotient = Math.floor(denominator / 200)
  /** 中文说明：当前组件的局部值 denominatorRemainder，由紧邻初始化决定。 */
  const denominatorRemainder = denominator % 200
  /** 中文说明：当前组件的局部值 lower，由紧邻初始化决定。 */
  let lower = 0
  /** 中文说明：当前组件的局部值 upper，由紧邻初始化决定。 */
  let upper = 100
  while (lower < upper) {
    /** 中文说明：当前组件的局部值 candidate，由紧邻初始化决定。 */
    const candidate = Math.floor((lower + upper + 1) / 2)
    /** 中文说明：当前组件的局部值 factor，由紧邻初始化决定。 */
    const factor = candidate * 2 - 1
    /** 中文说明：当前组件的局部值 threshold，由紧邻初始化决定。 */
    const threshold = factor * denominatorQuotient
      + Math.ceil(factor * denominatorRemainder / 200)
    if (cacheReadTokens >= threshold) {
      lower = candidate
    } else {
      upper = candidate - 1
    }
  }
  return lower
}

/**
 * Display-ready cache-hit share of prompt-side input over the whole durable log.
 * @param usage - the session's token-usage projection value.
 * @returns integer text when integer rounding stays below 100, otherwise the
 * minimum decimal precision that still rounds below 100; a full hit returns
 * 100, and no billed input returns null.
 */
/** 中文说明：函数 cacheHitPercent 的参数见签名，返回结果供相邻流程使用；调用示例见本文件。 */
export function cacheHitPercent(usage: TokenUsageProjection): string | null {
  /** 中文说明：当前组件的局部值 denominator，由紧邻初始化决定。 */
  const denominator = billedInputTokens(usage)
  if (denominator === 0) return null
  /** 中文说明：当前组件的局部值 missedInputTokens，由紧邻初始化决定。 */
  const missedInputTokens = usage.uncachedInputTokens + usage.cacheWriteTokens
  if (missedInputTokens === 0) return '100'

  /** 中文说明：当前组件的局部值 integerPercent，由紧邻初始化决定。 */
  const integerPercent = roundedIntegerPercent(usage.cacheReadTokens, denominator)
  if (integerPercent < 100) return String(integerPercent)

  // At the first distinguishing precision, the rounded result is 100 minus
  // one to five units in the final decimal place. Scale only while the next
  // multiplication remains at or below the denominator, then derive that
  // final digit through exact small-factor comparisons.
  /** 中文说明：当前组件的局部值 decimalPlaces，由紧邻初始化决定。 */
  let decimalPlaces = 1
  /** 中文说明：当前组件的局部值 scaledDoubleGap，由紧邻初始化决定。 */
  let scaledDoubleGap = missedInputTokens * 200
  /** 中文说明：当前组件的局部值 denominatorTens，由紧邻初始化决定。 */
  const denominatorTens = Math.floor(denominator / 10)
  while (scaledDoubleGap <= denominatorTens) {
    scaledDoubleGap *= 10
    decimalPlaces += 1
  }
  /** 中文说明：当前组件的局部值 denominatorOnes，由紧邻初始化决定。 */
  const denominatorOnes = denominator % 10
  /** 中文说明：当前组件的局部值 roundedLoss，由紧邻初始化决定。 */
  let roundedLoss = 5
  /** 中文说明：当前组件的局部值 loss，由紧邻初始化决定。 */
  for (let loss = 1; loss < 5; loss += 1) {
    /** 中文说明：当前组件的局部值 factor，由紧邻初始化决定。 */
    const factor = loss * 2 + 1
    /** 中文说明：当前组件的局部值 threshold，由紧邻初始化决定。 */
    const threshold = factor * denominatorTens + Math.floor(factor * denominatorOnes / 10)
    if (scaledDoubleGap <= threshold) {
      roundedLoss = loss
      break
    }
  }
  return `99.${'9'.repeat(decimalPlaces - 1)}${10 - roundedLoss}`
}

/**
 * Sum the three disjoint prompt-side billing buckets.
 * @param usage - the session's token-usage projection value.
 * @returns billed input tokens.
 */
/** 中文说明：函数 billedInputTokens 的参数见签名，返回结果供相邻流程使用；调用示例见本文件。 */
export function billedInputTokens(usage: TokenUsageProjection): number {
  return usage.uncachedInputTokens + usage.cacheReadTokens + usage.cacheWriteTokens
}

/** 中文说明：类型或类 ContextOccupancy 约束本文件的数据或组件职责。 */
interface ContextOccupancy {
  percent: number
  usedTokens: number
  contextWindow: number
}

/**
 * Approximate context occupancy, using the TUI's integer rounding and upper
 * clamp. The numerator is `projectedTokens` — the provider sample carried
 * forward over the surface's movement since — so compaction shows immediately
 * instead of waiting for the next request to report usage; it falls back to the
 * bare sample only for a log whose projection predates that field. Numerator
 * and capacity remain independent last-wins projection fields, so this is a
 * reference figure rather than an exact measurement of one request (see the
 * token-meter README).
 * @param pressure - the session's context-pressure projection value.
 * @returns occupancy with its numerator and denominator, or null until both values are known.
 */
/** 中文说明：函数 contextOccupancy 的参数见签名，返回结果供相邻流程使用；调用示例见本文件。 */
export function contextOccupancy(
  pressure: ContextPressureProjection | undefined,
): ContextOccupancy | null {
  /** 中文说明：当前组件的局部值 usedTokens，由紧邻初始化决定。 */
  const usedTokens = pressure?.projectedTokens ?? pressure?.pressureTokens
  if (usedTokens === undefined || pressure?.contextWindow === undefined) return null
  return {
    percent: Math.min(100, Math.round(usedTokens / pressure.contextWindow * 100)),
    usedTokens,
    contextWindow: pressure.contextWindow,
  }
}

/** Props: the conversation-snapshot selector plus the projection read seat. */
/** 中文说明：类型或类 StatsLineProps 约束本文件的数据或组件职责。 */
export interface StatsLineProps {
  useSession: SnapshotSelectorHook<ConversationSnapshot>
  useProjection: UseProjection
  /** The owning dock's locale seat. */
  t: ComposerBarProps['t']
}

/** 中文说明：当前组件的局部值 StatsLine，由紧邻初始化决定。 */
export const StatsLine = memo(function StatsLine({ useSession, useProjection, t }: StatsLineProps) {
  /** 中文说明：当前组件的局部值 settledNodes，由紧邻初始化决定。 */
  const settledNodes = useSession(s => s.chat.legacy.nodes)
  /** 中文说明：当前组件的局部值 usage，由紧邻初始化决定。 */
  const usage = useProjection('tokenUsage')
  // Every figure rides the durable sessionStats projection, so paging and
  // compaction cannot change any of them; an assembly without the unit falls
  // back to the window-scoped fold wholesale (same field names), paid only
  // while no projection value is served.
  /** 中文说明：当前组件的局部值 projected，由紧邻初始化决定。 */
  const projected = useProjection('sessionStats')
  /** 中文说明：当前组件的局部值 stats，由紧邻初始化决定。 */
  const stats = useMemo(() => projected ?? deriveStats(settledNodes), [projected, settledNodes])
  // Pipe-separated groups (figma stats strip); a group with no data drops out whole.
  /** 中文说明：当前组件的局部值 groups，由紧邻初始化决定。 */
  const groups: string[] = []
  if (stats.steps > 0) {
    groups.push(t('stats.counts', { turns: stats.turns, steps: stats.steps }))
    /** 中文说明：当前组件的局部值 durations，由紧邻初始化决定。 */
    const durations: string[] = []
    if (stats.llmMs > 0) durations.push(t('stats.llm', { duration: formatDuration(stats.llmMs) }))
    if (stats.toolMs > 0) durations.push(t('stats.toolCall', { duration: formatDuration(stats.toolMs) }))
    if (durations.length > 0) groups.push(durations.join(' · '))
    /** 中文说明：当前组件的局部值 speeds，由紧邻初始化决定。 */
    const speeds: string[] = []
    if (stats.ttftSteps > 0) {
      speeds.push(t('stats.ttftAverage', { duration: formatDuration(stats.ttftMs / stats.ttftSteps) }))
    }
    if (stats.decodeMs > 0) {
      speeds.push(t('stats.tokensPerSecond', {
        throughput: formatTokensPerSecond(stats.decodeTokens / (stats.decodeMs / 1_000)),
      }))
    }
    if (speeds.length > 0) groups.push(speeds.join(' · '))
  }
  // Context occupancy deliberately lives on the composer's ContextMeter ring,
  // not here — one home per fact.
  // Billing rides the durable projection, so these survive paging and
  // compaction. Gated on actual token activity: a session whose steps all
  // settled without billing (e.g. every request failed) shows its counts
  // without a zero-token group.
  if (usage !== undefined
    && (billedInputTokens(usage) > 0 || usage.outputTokens > 0)) {
    /** 中文说明：当前组件的局部值 cacheHit，由紧邻初始化决定。 */
    const cacheHit = cacheHitPercent(usage)
    if (cacheHit !== null) groups.push(t('stats.cacheHit', { percent: cacheHit }))
    groups.push(t('stats.tokens', {
      input: formatTokens(billedInputTokens(usage)),
      output: formatTokens(usage.outputTokens),
    }))
  }
  /** 中文说明：当前组件的局部值 line，由紧邻初始化决定。 */
  const line = groups.join(' | ')
  // The row elides with ellipsis when overlong; a delayed hover tooltip carries
  // the full line, enabled only while content is actually clipped.
  /** 中文说明：当前组件的局部值 rootRef，由紧邻初始化决定。 */
  const rootRef = useRef<HTMLDivElement | null>(null)
  /** 中文说明：当前组件的局部值 [truncated, setTruncated]，由紧邻初始化决定。 */
  const [truncated, setTruncated] = useState(false)
  useLayoutEffect(() => {
    /** 中文说明：当前组件的局部值 el，由紧邻初始化决定。 */
    const el = rootRef.current
    if (el === null) return
    /** 中文说明：当前组件的局部值 measure，由紧邻初始化决定。 */
    const measure = () => { setTruncated(el.scrollWidth > el.clientWidth) }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    /** 中文说明：当前组件的局部值 observer，由紧邻初始化决定。 */
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => { observer.disconnect() }
  }, [line])
  if (groups.length === 0) return null
  return (
    <Tooltip label={line} side="top" delayMs={500} disabled={!truncated}>
      <div ref={rootRef} className={css.root}>
        {groups.map((group, i) => (
          <Fragment key={group}>
            {i > 0 && <><span className={css.sep} aria-hidden>|</span>{' '}</>}
            <span>{group}</span>
          </Fragment>
        ))}
      </div>
    </Tooltip>
  )
})
