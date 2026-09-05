// Settled-node identity prevents stream-delta updates from rerendering this row.
// Mounted on 'conversation.composer.dock' so it sticks with the composer in the
// active conversation scrollport (see ConversationRoot data-conversation-scroll).

/*
 * 【文件职责】显示请求耗时、工具耗时等轮次统计；
 * 缺失计时数据不能被解释成额外的已测量请求。
 */

import { Fragment, memo, useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { UseProjection } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: merges the sessionStats key into SessionProjectionMap for useProjection.
import type {} from '@deepseek-ai/dsh-session-stats/client'
import type { TokenUsageProjection } from '@deepseek-ai/dsh-token-meter/client'
import type { ChatViewSlotProps } from '../contract/slots.ts'
import type { ChatSnapshot } from '../contract/snapshot.ts'
import { formatTokensPerSecond } from './message-chrome.ts'
import { assistantStepReading } from '../contract/turn-metrics.ts'
import { formatCacheHitPercent, formatTokens } from './token-format.ts'
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
export function deriveStats(nodes: ChatSnapshot['legacy']['nodes']): WindowStats {
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
 * Compact duration: 45.2s under a minute, 2m42s from there on.
 * @param ms - duration in milliseconds.
 * @returns display string.
 */
export function formatDuration(ms: number, t: ChatViewSlotProps['t']): string {
  const s = ms / 1_000
  if (s < 60) return t('duration.compactSeconds', { seconds: Math.round(s * 10) / 10 })
  const whole = Math.round(s)
  return t('duration.compactMinutes', {
    minutes: Math.floor(whole / 60),
    seconds: whole % 60,
  })
}

/**
 * Display-ready cache-hit share of prompt-side input over the whole durable log.
 * @param usage - the session's token-usage projection value.
 * @returns integer text when integer rounding stays below 100, otherwise the
 * minimum decimal precision that still rounds below 100; a full hit returns
 * 100, and no billed input returns null.
 */
/* 中文说明：函数 cacheHitPercent 的参数见签名，返回结果供相邻流程使用；调用示例见本文件。 */
export function cacheHitPercent(usage: TokenUsageProjection): string | null {
  /** 中文说明：当前组件的局部值 denominator，由紧邻初始化决定。 */
  const denominator = billedInputTokens(usage)
  return formatCacheHitPercent(usage.cacheReadTokens, denominator)
}

/**
 * Sum the three disjoint prompt-side billing buckets.
 * @param usage - the session's token-usage projection value.
 * @returns billed input tokens.
 */
/* 中文说明：函数 billedInputTokens 的参数见签名，返回结果供相邻流程使用；调用示例见本文件。 */
export function billedInputTokens(usage: TokenUsageProjection): number {
  return usage.uncachedInputTokens + usage.cacheReadTokens + usage.cacheWriteTokens
}

/** Props: the conversation-snapshot selector plus the projection read seat. */
/* 中文说明：类型或类 StatsLineProps 约束本文件的数据或组件职责。 */
export interface StatsLineProps {
  useChat: SnapshotSelectorHook<ChatSnapshot>
  useProjection: UseProjection
  /** The owning dock's locale seat. */
  t: ChatViewSlotProps['t']
}

/** Render and measure one non-empty statistics line. */
const StatsLineContent = memo(function StatsLineContent({
  groups,
  line,
}: {
  readonly groups: readonly string[]
  readonly line: string
}) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [truncated, setTruncated] = useState(false)
  const measure = useCallback(() => {
    const el = rootRef.current
    if (el === null) return
    const next = el.scrollWidth > el.clientWidth
    setTruncated(current => current === next ? current : next)
  }, [])
  useLayoutEffect(() => {
    const el = rootRef.current
    if (el === null || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => { observer.disconnect() }
  }, [measure])
  useLayoutEffect(measure, [line, measure])
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

export const StatsLine = memo(function StatsLine({ useChat, useProjection, t }: StatsLineProps) {
  const settledNodes = useChat(s => s.legacy.nodes)
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
    if (stats.llmMs > 0) durations.push(t('stats.llm', { duration: formatDuration(stats.llmMs, t) }))
    if (stats.toolMs > 0) durations.push(t('stats.toolCall', { duration: formatDuration(stats.toolMs, t) }))
    if (durations.length > 0) groups.push(durations.join(' · '))
    /** 中文说明：当前组件的局部值 speeds，由紧邻初始化决定。 */
    const speeds: string[] = []
    if (stats.ttftSteps > 0) {
      speeds.push(t('stats.ttftAverage', { duration: formatDuration(stats.ttftMs / stats.ttftSteps, t) }))
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
      input: formatTokens(billedInputTokens(usage), t),
      output: formatTokens(usage.outputTokens, t),
    }))
  }
  /** 中文说明：当前组件的局部值 line，由紧邻初始化决定。 */
  const line = groups.join(' | ')
  if (groups.length === 0) return null
  return <StatsLineContent groups={groups} line={line} />
})
