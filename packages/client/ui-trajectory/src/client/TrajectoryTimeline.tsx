/** Chrome-Network-style overview timeline for focusing the trajectory ledger. */
/**
 * 文件职责：实现运行轨迹的 TrajectoryTimeline 组件。
 * 技术维度：React、TypeScript、Cordis 插槽、外部 Store 和 CSS Modules。
 * 产品维度：支持用户查看或操作运行轨迹。
 * 逻辑维度：读取状态，派生展示数据，处理操作并渲染界面。
 * 关键边界：异步状态、空状态、虚拟滚动和可访问性必须一致。
 * 新手阅读建议：先读 Props，再看状态选择、事件和 JSX。
 */

import {
  memo, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent,
  /** 中文说明：类型或类 PointerEvent 约束模块数据或组件职责。 */
  type PointerEvent,
} from 'react'
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TrajectoryTurnModel } from './layout.ts'
import type { AssistantMetricDetail, TrajectoryCellKind, TrajectoryCellProps } from './trajectory-record.ts'
import {
  deriveTrajectoryTimeline,
  formatTimelineOffset,
  /** 中文说明：类型或类 TrajectoryTimelineMode 约束模块数据或组件职责。 */
  type TrajectoryTimelineMode,
  /** 中文说明：类型或类 TrajectoryTimeRange 约束模块数据或组件职责。 */
  type TrajectoryTimeRange,
} from './timeline.ts'
import css from './TrajectoryTimeline.module.css'

/** 中文说明：组件局部值 MINIMUM_DRAG_PX，由紧邻初始化决定。 */
const MINIMUM_DRAG_PX = 3
/** 中文说明：组件局部值 MINIMUM_ZOOM_OPERATIONS，由紧邻初始化决定。 */
const MINIMUM_ZOOM_OPERATIONS = 4
/** 中文说明：组件局部值 EDGE_PAN_ZONE_FRACTION，由紧邻初始化决定。 */
const EDGE_PAN_ZONE_FRACTION = 0.08
/** 中文说明：组件局部值 EDGE_PAN_STEP_FRACTION，由紧邻初始化决定。 */
const EDGE_PAN_STEP_FRACTION = 0.025
/** 中文说明：组件局部值 MAXIMUM_EDGE_PAN_PX，由紧邻初始化决定。 */
const MAXIMUM_EDGE_PAN_PX = 32
/** 中文说明：组件局部值 TIMELINE_TOOLTIP_DELAY_MS，由紧邻初始化决定。 */
const TIMELINE_TOOLTIP_DELAY_MS = 500

/** 中文说明：类型或类 TimelineRecordDetail 约束模块数据或组件职责。 */
interface TimelineRecordDetail {
  decodingMs?: number
  durationMs?: number
  startedAt?: number
  ttftMs?: number
}

/** 中文说明：类型或类 FractionRange 约束模块数据或组件职责。 */
interface FractionRange {
  start: number
  end: number
}

/** 中文说明：类型或类 HoverPoint 约束模块数据或组件职责。 */
interface HoverPoint {
  fraction: number
  recordIndex: number | null
}

/** 中文说明：类型或类 PanGesture 约束模块数据或组件职责。 */
interface PanGesture {
  anchorClientX: number
  anchorStart: number
  moved: boolean
  pannable: boolean
  pointerId: number
}

/** 中文说明：函数 assistantTimingDetail 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function assistantTimingDetail(
  metrics: AssistantMetricDetail | undefined,
): Pick<TimelineRecordDetail, 'ttftMs' | 'decodingMs'> {
  /** 中文说明：组件局部值 start，由紧邻初始化决定。 */
  const start = metrics?.stepStartTime
  /** 中文说明：组件局部值 first，由紧邻初始化决定。 */
  const first = metrics?.firstTokenTime
  /** 中文说明：组件局部值 completed，由紧邻初始化决定。 */
  const completed = metrics?.completedTime
  if (
    metrics?.timingRecorded !== true
    || typeof start !== 'number'
    || typeof first !== 'number'
    || typeof completed !== 'number'
    || !Number.isFinite(start)
    || !Number.isFinite(first)
    || !Number.isFinite(completed)
    || first < start
    || completed < first
  ) return {}
  return { ttftMs: first - start, decodingMs: completed - first }
}

/** 中文说明：函数 timelineRecordDetail 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function timelineRecordDetail(cell: TrajectoryCellProps): TimelineRecordDetail {
  /** 中文说明：组件局部值 durationMs，由紧邻初始化决定。 */
  const durationMs = cell.timeSeconds === null || !Number.isFinite(cell.timeSeconds)
    ? undefined
    : Math.max(0, cell.timeSeconds * 1_000)
  /** 中文说明：组件局部值 startedAt，由紧邻初始化决定。 */
  const startedAt = cell.startedAt === null || !Number.isFinite(cell.startedAt)
    ? undefined
    : cell.startedAt
  return {
    ...(durationMs === undefined ? {} : { durationMs }),
    ...(startedAt === undefined ? {} : { startedAt }),
    ...assistantTimingDetail(cell.assistantMetrics),
  }
}

/** 中文说明：函数 timelineKindLabel 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function timelineKindLabel(kind: TrajectoryCellKind): string {
  switch (kind) {
    case 'system': return 'SYSTEM'
    case 'user': return 'USER'
    case 'context': return 'CONTEXT'
    case 'compacted': return 'COMPACTED'
    case 'message': return 'ASSISTANT'
    case 'tool': return 'TOOL'
    case 'subtool': return 'SUBTOOL'
  }
}

/** 中文说明：函数 formatRecordedTime 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function formatRecordedTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3,
  })
}

/** 中文说明：函数 timelineTooltipLabel 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function timelineTooltipLabel(
  kind: TrajectoryCellKind,
  detail: TimelineRecordDetail | undefined,
): string {
  /** 中文说明：组件局部值 heading，由紧邻初始化决定。 */
  const heading = timelineKindLabel(kind)
  if (detail === undefined) return heading
  /** 中文说明：组件局部值 duration，由紧邻初始化决定。 */
  const duration = detail.durationMs === undefined
    ? null
    : `Total ${formatTimelineOffset(detail.durationMs)}`
  /** 中文说明：组件局部值 range，由紧邻初始化决定。 */
  const range = detail.startedAt === undefined
    ? null
    : detail.durationMs === undefined
      ? `Started ${formatRecordedTime(detail.startedAt)}`
      : `${formatRecordedTime(detail.startedAt)} → ${formatRecordedTime(
        detail.startedAt + detail.durationMs,
      )}`
  /** 中文说明：组件局部值 segments，由紧邻初始化决定。 */
  const segments = detail.ttftMs === undefined || detail.decodingMs === undefined
    ? null
    : `TTFT ${formatTimelineOffset(detail.ttftMs)} · Decoding ${formatTimelineOffset(
      detail.decodingMs,
    )}`
  /** 中文说明：组件局部值 timing，由紧邻初始化决定。 */
  const timing = [duration, segments].filter(value => value !== null).join(' · ')
  return [heading, range, timing].filter(value => value !== null && value !== '').join('\n')
}

/** Props for the fixed full-domain overview above the trajectory ledger. */
/** 中文说明：类型或类 TrajectoryTimelineProps 约束模块数据或组件职责。 */
export interface TrajectoryTimelineProps {
  turns: readonly TrajectoryTurnModel[]
  mode: TrajectoryTimelineMode
  range: TrajectoryTimeRange | null
  /** Whether the loaded timeline omits an earlier history prefix. */
  hasEarlierRecords?: boolean
  /** Load one earlier history page from the truncation control. */
  onLoadEarlier?: () => Promise<boolean>
  selectedIndex?: number | null
  /** Record indexes matching the active ledger search, or null without a query. */
  searchMatchIndexes?: ReadonlySet<number> | null
  onRangeChange: (range: TrajectoryTimeRange | null) => void
  /** Select a directly clicked timeline block. */
  onRecordSelect?: (index: number) => void
  /** Bring the nearest record into view after clicking timeline whitespace. */
  onRecordFocus?: (index: number) => void
}

/** 中文说明：函数 orderedRange 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function orderedRange(left: number, right: number): FractionRange {
  return left <= right ? { start: left, end: right } : { start: right, end: left }
}

/** 中文说明：函数 clampFraction 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function clampFraction(value: number): number {
  return Math.min(1, Math.max(0, value))
}

/** 中文说明：函数 centeredRange 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function centeredRange(
  center: number,
  width: number,
  minimum: number,
  maximum: number,
): FractionRange {
  /** 中文说明：组件局部值 clampedWidth，由紧邻初始化决定。 */
  const clampedWidth = Math.min(maximum - minimum, Math.max(0, width))
  /** 中文说明：组件局部值 start，由紧邻初始化决定。 */
  const start = Math.min(
    Math.max(center - clampedWidth / 2, minimum),
    maximum - clampedWidth,
  )
  return { start, end: start + clampedWidth }
}

/** 中文说明：函数 rangeFraction 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function rangeFraction(
  range: TrajectoryTimeRange,
  start: number,
  duration: number,
  minimum: number,
  maximum: number,
): FractionRange {
  /** 中文说明：组件局部值 bounded，由紧邻初始化决定。 */
  const bounded = orderedRange(
    Math.min(maximum, Math.max(minimum, range.start)),
    Math.min(maximum, Math.max(minimum, range.end)),
  )
  return {
    start: (bounded.start - start) / duration,
    end: (bounded.end - start) / duration,
  }
}

/** 中文说明：函数 LaneLabels 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function LaneLabels() {
  return (
    <div className={css.labels} aria-hidden="true">
      <span>Input</span>
      <span>Model</span>
      <span>Tools</span>
    </div>
  )
}

/** 中文说明：函数 EarlierHistoryBoundary 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function EarlierHistoryBoundary({
  loading,
  onHover,
  onLoad,
}: {
  loading: boolean
  onHover: () => void
  onLoad: (() => void) | undefined
}) {
  return (
    <Tooltip
      label={loading ? 'Loading earlier history…' : 'Click to load earlier history'}
      side="right"
      delayMs={TIMELINE_TOOLTIP_DELAY_MS}
    >
      <button
        type="button"
        className={css.earlierHistory}
        data-earlier-history
        data-loading={loading || undefined}
        aria-label={loading ? 'Loading earlier history' : 'Load earlier history'}
        aria-disabled={loading || onLoad === undefined}
        onClick={onLoad}
        onPointerEnter={(event) => {
          event.stopPropagation()
          onHover()
        }}
        onPointerMove={(event) => { event.stopPropagation() }}
        onPointerDown={(event) => { event.stopPropagation() }}
      >
        …
      </button>
    </Tooltip>
  )
}

/** Overview renderer with drag ranges, click-sized focus, and Escape reset. */
/** 中文说明：组件局部值 TrajectoryTimeline，由紧邻初始化决定。 */
export const TrajectoryTimeline = memo(function TrajectoryTimeline({
  turns,
  mode,
  range,
  hasEarlierRecords = false,
  onLoadEarlier,
  selectedIndex = null,
  searchMatchIndexes = null,
  onRangeChange,
  onRecordSelect,
  onRecordFocus,
}: TrajectoryTimelineProps) {
  /** 中文说明：组件局部值 model，由紧邻初始化决定。 */
  const model = useMemo(() => deriveTrajectoryTimeline(turns, mode), [mode, turns])
  /** 中文说明：组件局部值 detailByIndex，由紧邻初始化决定。 */
  const detailByIndex = useMemo(
    () => new Map(turns.flatMap(turn =>
      turn.groups.flatMap(group =>
        group.cells.map(cell => [cell.index, timelineRecordDetail(cell)] as const),
      ),
    )),
    [turns],
  )
  /** 中文说明：组件局部值 dragRef，由紧邻初始化决定。 */
  const dragRef = useRef<{
    pointerId: number
    anchorTime: number
    anchorClientX: number
    recordIndex: number | null
  } | null>(null)
  /** 中文说明：组件局部值 panRef，由紧邻初始化决定。 */
  const panRef = useRef<PanGesture | null>(null)
  /** 中文说明：组件局部值 rootRef，由紧邻初始化决定。 */
  const rootRef = useRef<HTMLElement | null>(null)
  /** 中文说明：组件局部值 trackRef，由紧邻初始化决定。 */
  const trackRef = useRef<HTMLDivElement | null>(null)
  /** 中文说明：组件局部值 [draft, setDraft]，由紧邻初始化决定。 */
  const [draft, setDraft] = useState<TrajectoryTimeRange | null>(null)
  /** 中文说明：组件局部值 [hover, setHover]，由紧邻初始化决定。 */
  const [hover, setHover] = useState<HoverPoint | null>(null)
  /** 中文说明：组件局部值 解构结果，由紧邻初始化决定。 */
  const [loadingEarlier, setLoadingEarlier] = useState(false)
  /** 中文说明：组件局部值 [panning, setPanning]，由紧邻初始化决定。 */
  const [panning, setPanning] = useState(false)
  /** 中文说明：组件局部值 [viewport, setViewport]，由紧邻初始化决定。 */
  const [viewport, setViewport] = useState<TrajectoryTimeRange | null>(null)
  /** 中文说明：组件局部值 解构结果，由紧邻初始化决定。 */
  const [animateViewport, setAnimateViewport] = useState(false)
  useEffect(() => {
    if (
      model !== null
      && range !== null
      && (range.end < model.start || range.start > model.end)
    ) {
      onRangeChange(null)
    }
  }, [model, onRangeChange, range])
  useEffect(() => {
    if (model === null) return
    setAnimateViewport(false)
    setViewport(current =>
      current !== null && (current.end < model.start || current.start > model.end)
        ? null
        : current)
  }, [model])
  useEffect(() => {
    if (model === null || selectedIndex === null) return
    /** 中文说明：组件局部值 selectedSpan，由紧邻初始化决定。 */
    const selectedSpan = model.spans.find(span => span.index === selectedIndex)
    if (selectedSpan === undefined) return
    setAnimateViewport(true)
    setViewport((current) => {
      if (current === null) return current
      if (
        selectedSpan.end > current.start
        && selectedSpan.start < current.end
      ) return current
      /** 中文说明：组件局部值 duration，由紧邻初始化决定。 */
      const duration = Math.max(1, current.end - current.start)
      /** 中文说明：组件局部值 desiredStart，由紧邻初始化决定。 */
      const desiredStart = selectedSpan.end <= current.start
        ? selectedSpan.start
        : selectedSpan.end - duration
      /** 中文说明：组件局部值 nextStart，由紧邻初始化决定。 */
      const nextStart = Math.min(
        Math.max(desiredStart, model.start),
        Math.max(model.start, model.end - duration),
      )
      if (nextStart === current.start) return current
      return { start: nextStart, end: nextStart + duration }
    })
  }, [model, selectedIndex])
  /** 中文说明：组件局部值 fullDuration，由紧邻初始化决定。 */
  const fullDuration = Math.max(1, (model?.end ?? 0) - (model?.start ?? 0))
  /** 中文说明：组件局部值 viewportDuration，由紧邻初始化决定。 */
  const viewportDuration = Math.min(
    fullDuration,
    Math.max(1, (viewport?.end ?? 0) - (viewport?.start ?? 0)),
  )
  /** 中文说明：组件局部值 viewportStart，由紧邻初始化决定。 */
  const viewportStart = model === null || viewport === null
    ? model?.start ?? 0
    : Math.min(
      Math.max(viewport.start, model.start),
      model.end - viewportDuration,
    )
  /** 中文说明：组件局部值 domainDuration，由紧邻初始化决定。 */
  const domainDuration = viewport === null ? fullDuration : viewportDuration
  /** 中文说明：组件局部值 domainStart，由紧邻初始化决定。 */
  const domainStart = viewport === null ? model?.start ?? 0 : viewportStart
  /** 中文说明：组件局部值 showsEarlierBoundary，由紧邻初始化决定。 */
  const showsEarlierBoundary = hasEarlierRecords
    && model !== null
    && domainStart === model.start
  /** 中文说明：组件局部值 loadEarlier，由紧邻初始化决定。 */
  const loadEarlier = onLoadEarlier === undefined || loadingEarlier
    ? undefined
    : () => {
      setLoadingEarlier(true)
      void onLoadEarlier().finally(() => { setLoadingEarlier(false) })
    }
  /** 中文说明：组件局部值 projectedDomainStyle，由紧邻初始化决定。 */
  const projectedDomainStyle = model === null
    ? undefined
    : {
      '--trajectory-domain-left':
        `${-(domainStart - model.start) / domainDuration * 100}%`,
      '--trajectory-domain-width': `${fullDuration / domainDuration * 100}%`,
    } as CSSProperties
  /** 中文说明：组件局部值 committed，由紧邻初始化决定。 */
  const committed = model === null || range === null
    ? null
    : rangeFraction(range, domainStart, domainDuration, model.start, model.end)
  /** 中文说明：组件局部值 draftFraction，由紧邻初始化决定。 */
  const draftFraction = model === null || draft === null
    ? null
    : rangeFraction(draft, domainStart, domainDuration, model.start, model.end)
  /** 中文说明：组件局部值 visibleRange，由紧邻初始化决定。 */
  const visibleRange = draftFraction ?? committed
  /** 中文说明：组件局部值 activeRange，由紧邻初始化决定。 */
  const activeRange = draft ?? range
  useEffect(() => {
    /** 中文说明：组件局部值 root，由紧邻初始化决定。 */
    const root = rootRef.current
    if (root === null) return
    /** 中文说明：组件局部值 onWheel，由紧邻初始化决定。 */
    const onWheel = (event: globalThis.WheelEvent): void => {
      event.preventDefault()
      /** 中文说明：组件局部值 track，由紧邻初始化决定。 */
      const track = trackRef.current
      if (track === null || model === null) return
      setAnimateViewport(false)
      /** 中文说明：组件局部值 rect，由紧邻初始化决定。 */
      const rect = track.getBoundingClientRect()
      /** 中文说明：组件局部值 anchorFraction，由紧邻初始化决定。 */
      const anchorFraction =
        clampFraction((event.clientX - rect.left) / Math.max(1, rect.width))
      /** 中文说明：组件局部值 nextDuration，由紧邻初始化决定。 */
      const nextDuration = Math.min(
        fullDuration,
        Math.max(
          Math.min(mode === 'sequence' ? MINIMUM_ZOOM_OPERATIONS : 20, fullDuration),
          domainDuration * Math.exp(event.deltaY * 0.0015),
        ),
      )
      if (nextDuration >= fullDuration * 0.999) {
        setViewport(null)
        return
      }
      /** 中文说明：组件局部值 anchorTime，由紧邻初始化决定。 */
      const anchorTime = domainStart + anchorFraction * domainDuration
      /** 中文说明：组件局部值 nextStart，由紧邻初始化决定。 */
      const nextStart = Math.min(
        Math.max(anchorTime - anchorFraction * nextDuration, model.start),
        model.end - nextDuration,
      )
      setViewport({ start: nextStart, end: nextStart + nextDuration })
    }
    root.addEventListener('wheel', onWheel, { passive: false })
    return () => { root.removeEventListener('wheel', onWheel) }
  }, [domainDuration, domainStart, fullDuration, mode, model])

  if (model === null) {
    return (
      <section ref={rootRef} className={css.root} aria-label="Trajectory timeline">
        <div className={css.plot}>
          <LaneLabels />
          <div className={css.track}>
            <span className={css.empty}>No timing data</span>
            {hasEarlierRecords && (
              <EarlierHistoryBoundary
                loading={loadingEarlier}
                onHover={() => { setHover(null) }}
                onLoad={loadEarlier}
              />
            )}
          </div>
        </div>
      </section>
    )
  }

  /** 中文说明：组件局部值 minimumSelectionDuration，由紧邻初始化决定。 */
  const minimumSelectionDuration = Math.min(
    domainDuration,
    fullDuration / model.spans.length,
  )

  /** 中文说明：组件局部值 fractionAt，由紧邻初始化决定。 */
  const fractionAt = (event: PointerEvent<HTMLDivElement>): number => {
    /** 中文说明：组件局部值 rect，由紧邻初始化决定。 */
    const rect = event.currentTarget.getBoundingClientRect()
    return clampFraction((event.clientX - rect.left) / Math.max(1, rect.width))
  }

  /** 中文说明：组件局部值 recordIndexAt，由紧邻初始化决定。 */
  const recordIndexAt = (event: PointerEvent<HTMLDivElement>): number | null => {
    /** 中文说明：组件局部值 target，由紧邻初始化决定。 */
    const target = event.target instanceof HTMLElement ? event.target : null
    /** 中文说明：组件局部值 value，由紧邻初始化决定。 */
    const value = target?.closest<HTMLElement>('[data-timeline-record-index]')
      ?.dataset.timelineRecordIndex
    if (value === undefined) return null
    /** 中文说明：组件局部值 index，由紧邻初始化决定。 */
    const index = Number(value)
    return Number.isFinite(index) ? index : null
  }

  /** 中文说明：组件局部值 commit，由紧邻初始化决定。 */
  const commit = (nextRange: TrajectoryTimeRange) => {
    onRangeChange(nextRange)
  }

  /** 中文说明：组件局部值 onPointerDown，由紧邻初始化决定。 */
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button === 2) {
      panRef.current = {
        anchorClientX: event.clientX,
        anchorStart: domainStart,
        moved: false,
        pannable: viewport !== null,
        pointerId: event.pointerId,
      }
      if (viewport !== null) setAnimateViewport(false)
      setPanning(true)
      if (typeof event.currentTarget.setPointerCapture === 'function') {
        event.currentTarget.setPointerCapture(event.pointerId)
      }
      return
    }
    if (event.button !== 0) return
    /** 中文说明：组件局部值 anchor，由紧邻初始化决定。 */
    const anchor = fractionAt(event)
    /** 中文说明：组件局部值 anchorTime，由紧邻初始化决定。 */
    const anchorTime = domainStart + anchor * domainDuration
    /** 中文说明：组件局部值 recordIndex，由紧邻初始化决定。 */
    const recordIndex = recordIndexAt(event)
    setHover({ fraction: anchor, recordIndex })
    dragRef.current = {
      pointerId: event.pointerId,
      anchorTime,
      anchorClientX: event.clientX,
      recordIndex,
    }
    if (typeof event.currentTarget.setPointerCapture === 'function') {
      event.currentTarget.setPointerCapture(event.pointerId)
    }
    setDraft({ start: anchorTime, end: anchorTime })
  }

  /** 中文说明：组件局部值 onPointerMove，由紧邻初始化决定。 */
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    /** 中文说明：组件局部值 rect，由紧邻初始化决定。 */
    const rect = event.currentTarget.getBoundingClientRect()
    /** 中文说明：组件局部值 fraction，由紧邻初始化决定。 */
    const fraction = fractionAt(event)
    setHover({ fraction, recordIndex: recordIndexAt(event) })
    /** 中文说明：组件局部值 pan，由紧邻初始化决定。 */
    const pan = panRef.current
    if (pan !== null && pan.pointerId === event.pointerId) {
      if (Math.abs(event.clientX - pan.anchorClientX) >= MINIMUM_DRAG_PX) {
        pan.moved = true
      }
      if (!pan.pannable) return
      /** 中文说明：组件局部值 delta，由紧邻初始化决定。 */
      const delta = (event.clientX - pan.anchorClientX) / Math.max(1, rect.width)
      /** 中文说明：组件局部值 nextStart，由紧邻初始化决定。 */
      const nextStart = Math.min(
        Math.max(pan.anchorStart - delta * domainDuration, model.start),
        model.end - domainDuration,
      )
      setViewport({ start: nextStart, end: nextStart + domainDuration })
      return
    }
    /** 中文说明：组件局部值 drag，由紧邻初始化决定。 */
    const drag = dragRef.current
    if (drag === null || drag.pointerId !== event.pointerId) return
    /** 中文说明：组件局部值 nextDomainStart，由紧邻初始化决定。 */
    let nextDomainStart = domainStart
    if (viewport !== null) {
      /** 中文说明：组件局部值 localX，由紧邻初始化决定。 */
      const localX = event.clientX - rect.left
      /** 中文说明：组件局部值 edgeWidth，由紧邻初始化决定。 */
      const edgeWidth = Math.min(
        MAXIMUM_EDGE_PAN_PX,
        Math.max(1, rect.width * EDGE_PAN_ZONE_FRACTION),
      )
      /** 中文说明：组件局部值 direction，由紧邻初始化决定。 */
      const direction = localX < edgeWidth
        ? -1
        : localX > rect.width - edgeWidth ? 1 : 0
      if (direction !== 0) {
        /** 中文说明：组件局部值 edgeDistance，由紧邻初始化决定。 */
        const edgeDistance = direction < 0
          ? edgeWidth - localX
          : localX - (rect.width - edgeWidth)
        /** 中文说明：组件局部值 strength，由紧邻初始化决定。 */
        const strength = clampFraction(edgeDistance / edgeWidth)
        /** 中文说明：组件局部值 desiredStart，由紧邻初始化决定。 */
        const desiredStart = domainStart
          + direction * domainDuration * EDGE_PAN_STEP_FRACTION
          * Math.max(0.2, strength)
        nextDomainStart = Math.min(
          Math.max(desiredStart, model.start),
          model.end - domainDuration,
        )
        if (nextDomainStart !== domainStart) {
          setAnimateViewport(false)
          setViewport({
            start: nextDomainStart,
            end: nextDomainStart + domainDuration,
          })
        }
      }
    }
    /** 中文说明：组件局部值 pointTime，由紧邻初始化决定。 */
    const pointTime = nextDomainStart + fraction * domainDuration
    setDraft(orderedRange(drag.anchorTime, pointTime))
  }

  /** 中文说明：组件局部值 onPointerEnd，由紧邻初始化决定。 */
  const onPointerEnd = (event: PointerEvent<HTMLDivElement>) => {
    /** 中文说明：组件局部值 pan，由紧邻初始化决定。 */
    const pan = panRef.current
    if (pan !== null && pan.pointerId === event.pointerId) {
      /** 中文说明：组件局部值 moved，由紧邻初始化决定。 */
      const moved = pan.moved
        || Math.abs(event.clientX - pan.anchorClientX) >= MINIMUM_DRAG_PX
      panRef.current = null
      setPanning(false)
      if (!moved) onRangeChange(null)
      return
    }
    /** 中文说明：组件局部值 drag，由紧邻初始化决定。 */
    const drag = dragRef.current
    if (drag === null || drag.pointerId !== event.pointerId) return
    /** 中文说明：组件局部值 pointFraction，由紧邻初始化决定。 */
    const pointFraction = fractionAt(event)
    /** 中文说明：组件局部值 pointTime，由紧邻初始化决定。 */
    const pointTime = domainStart + pointFraction * domainDuration
    /** 中文说明：组件局部值 selected，由紧邻初始化决定。 */
    const selected = orderedRange(drag.anchorTime, pointTime)
    setHover({ fraction: pointFraction, recordIndex: recordIndexAt(event) })
    dragRef.current = null
    setDraft(null)
    /** 中文说明：组件局部值 click，由紧邻初始化决定。 */
    const click = Math.abs(event.clientX - drag.anchorClientX) < MINIMUM_DRAG_PX
    /** 中文说明：组件局部值 clickedSpan，由紧邻初始化决定。 */
    const clickedSpan = click && drag.recordIndex !== null
      ? model.spans.find(span => span.index === drag.recordIndex)
      : undefined
    if (clickedSpan !== undefined) {
      onRangeChange(null)
      onRecordSelect?.(clickedSpan.index)
      return
    }
    /** 中文说明：组件局部值 committedRange，由紧邻初始化决定。 */
    const committedRange = selected.end - selected.start < minimumSelectionDuration
      ? centeredRange(
        click ? selected.start : (selected.start + selected.end) / 2,
        minimumSelectionDuration,
        model.start,
        model.end,
      )
      : selected
    commit(committedRange)
    if (click) {
      /** 中文说明：组件局部值 timelinePoint，由紧邻初始化决定。 */
      const timelinePoint = selected.start
      /** 中文说明：组件局部值 nearest，由紧邻初始化决定。 */
      const nearest = model.spans.reduce((candidate, span) => {
        /** 中文说明：组件局部值 candidateDistance，由紧邻初始化决定。 */
        const candidateDistance = timelinePoint < candidate.start
          ? candidate.start - timelinePoint
          : timelinePoint > candidate.end ? timelinePoint - candidate.end : 0
        /** 中文说明：组件局部值 spanDistance，由紧邻初始化决定。 */
        const spanDistance = timelinePoint < span.start
          ? span.start - timelinePoint
          : timelinePoint > span.end ? timelinePoint - span.end : 0
        return spanDistance < candidateDistance ? span : candidate
      })
      onRecordFocus?.(nearest.index)
    }
  }

  /** 中文说明：组件局部值 onKeyDown，由紧邻初始化决定。 */
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape' || range === null) return
    event.preventDefault()
    onRangeChange(null)
  }

  /** 中文说明：组件局部值 onPointerCancel，由紧邻初始化决定。 */
  const onPointerCancel = () => {
    dragRef.current = null
    panRef.current = null
    setDraft(null)
    setHover(null)
    setPanning(false)
  }

  return (
    <section ref={rootRef} className={css.root} aria-label="Trajectory timeline">
      <div className={css.plot}>
        <LaneLabels />
        <div
          ref={trackRef}
          className={css.track}
          data-panning={panning || undefined}
          aria-label="Timeline overview; drag horizontally to focus events"
          tabIndex={0}
          onKeyDown={onKeyDown}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerCancel}
          onPointerLeave={() => {
            if (dragRef.current === null && panRef.current === null) setHover(null)
          }}
          onDoubleClick={(event) => {
            event.preventDefault()
            onRangeChange(null)
          }}
          onContextMenu={(event) => {
            event.preventDefault()
          }}
        >
          {showsEarlierBoundary && (
            <EarlierHistoryBoundary
              loading={loadingEarlier}
              onHover={() => { setHover(null) }}
              onLoad={loadEarlier}
            />
          )}
          {hover !== null && hover.recordIndex === null && draft === null && (
            <div
              className={css.hoverLine}
              data-timeline-hover-line
              aria-hidden="true"
              style={{
                '--trajectory-hover-left': `${hover.fraction * 100}%`,
              } as CSSProperties}
            />
          )}
          {visibleRange !== null && (
            <>
              <div
                className={css.selection}
                data-dragging={draft === null ? undefined : 'true'}
                aria-hidden="true"
                style={{
                  '--trajectory-selection-left': `${visibleRange.start * 100}%`,
                  '--trajectory-selection-width': `${(visibleRange.end - visibleRange.start) * 100}%`,
                } as CSSProperties}
              />
              <div
                className={css.selectionEdges}
                data-dragging={draft === null ? undefined : 'true'}
                aria-hidden="true"
                style={{
                  '--trajectory-selection-left': `${visibleRange.start * 100}%`,
                  '--trajectory-selection-width': `${(visibleRange.end - visibleRange.start) * 100}%`,
                } as CSSProperties}
              />
            </>
          )}
          <div
            className={css.turnBoundaries}
            data-animate-viewport={animateViewport || undefined}
            aria-hidden="true"
            style={projectedDomainStyle}
          >
            {model.turnBoundaries
              .filter(boundary =>
                boundary.time > model.start
                && boundary.time >= domainStart
                && boundary.time <= domainStart + domainDuration)
              .map(boundary => (
                <span
                  className={css.turnBoundary}
                  data-turn={boundary.turn}
                  key={boundary.turn}
                  style={{
                    '--trajectory-turn-left':
                      `${(boundary.time - model.start) / fullDuration * 100}%`,
                  } as CSSProperties}
                />
              ))}
          </div>
          <div
            className={css.lanes}
            data-animate-viewport={animateViewport || undefined}
            data-timeline-domain
            style={projectedDomainStyle}
          >
            {model.spans
              .filter(span =>
                span.index === selectedIndex
                || (span.end >= domainStart && span.start <= domainStart + domainDuration))
              .map((span) => {
                /** 中文说明：组件局部值 left，由紧邻初始化决定。 */
                const left = (span.start - model.start) / fullDuration
                /** 中文说明：组件局部值 width，由紧邻初始化决定。 */
                const width = (span.end - span.start) / fullDuration
                /** 中文说明：组件局部值 widthPercent，由紧邻初始化决定。 */
                const widthPercent = width * 100
                /** 中文说明：组件局部值 detail，由紧邻初始化决定。 */
                const detail = detailByIndex.get(span.index)
                /** 中文说明：组件局部值 ttftMs，由紧邻初始化决定。 */
                const ttftMs = detail?.ttftMs
                /** 中文说明：组件局部值 decodingMs，由紧邻初始化决定。 */
                const decodingMs = detail?.decodingMs
                /** 中文说明：组件局部值 ttftFraction，由紧邻初始化决定。 */
                const ttftFraction = ttftMs === undefined
                  || decodingMs === undefined
                  || ttftMs + decodingMs <= 0
                  ? null
                  : ttftMs / (ttftMs + decodingMs)
                return (
                  <Tooltip
                    key={span.index}
                    label={() => timelineTooltipLabel(span.kind, detail)}
                    side="bottom"
                    delayMs={TIMELINE_TOOLTIP_DELAY_MS}
                  >
                    <span
                      aria-hidden="true"
                      className={css.span}
                      data-timeline-span={span.kind}
                      data-timeline-record-index={span.index}
                      data-assistant-timing={ttftFraction === null ? undefined : 'true'}
                      data-error={span.isError || undefined}
                      data-equal-duration={mode === 'time' || undefined}
                      data-current={span.index === selectedIndex || undefined}
                      data-hovered={hover?.recordIndex === span.index || undefined}
                      data-search-match={searchMatchIndexes === null
                        ? undefined
                        : searchMatchIndexes.has(span.index) ? 'true' : 'false'}
                      data-selected={activeRange === null
                        ? undefined
                        : span.start <= activeRange.end && span.end >= activeRange.start
                          ? 'true'
                          : 'false'}
                      style={{
                        '--trajectory-span-left': `${left * 100}%`,
                        '--trajectory-span-width': `${widthPercent}%`,
                        '--trajectory-span-gap': `min(${widthPercent * 0.08}%, 1px)`,
                        '--trajectory-span-lane': span.lane,
                        ...(ttftFraction === null
                          ? {}
                          : { '--trajectory-assistant-ttft': `${ttftFraction * 100}%` }),
                      } as CSSProperties}
                    />
                  </Tooltip>
                )
              })}
          </div>
        </div>
      </div>
    </section>
  )
})
