/*
 * ================================ 文件注释 ================================
 * 【文件职责】把轨迹布局（turns）投影成概览用的时间线模型：sequence（等宽序列）、
 *             duration（记录时长）、time（压缩空闲的完整时间）、actual（实际时间）
 *             四种模式；并支持按选中区间反查命中的记录索引。
 * 【技术维度】纯函数投影；duration / time 模式按单元格 startedAt + timeSeconds 计算区间，
 *             compressIdle 时把空闲间隙从坐标中扣除（removedIdle 平移）；三车道（lane）
 *             区分 tool / message / 其它。
 * 【产品维度】轨迹概览图让用户一眼看到执行节奏：等宽看"发生顺序"，实际时长看"哪一步最慢"。
 * 【逻辑维度】1) 模式与数据结构类型；2) laneFor 车道分配；3) cellRange 区间计算；
 *             4) deriveTrajectoryTimeline 主投影（sequence 直通，其它走时间投影）；
 *             5) deriveTimedTimeline 去空闲 + 平移；6) 选区命中查询。
 * 【关键边界】timeSeconds 缺失时区间长度为 0；无可见记录返回 null；回合边界时间取
 *             投影后首个 span 的起点。
 * 【新手阅读建议】先看四种模式的语义差异，再看 removedIdle 如何把空闲压缩掉。
 * ==========================================================================
 */
/** Operation-sequence and recorded-time projections for the trajectory overview. */

import type { TrajectoryTurnModel } from './layout.ts'
import { formatDurationMillis } from './trajectory-record.ts'
import type { TrajectoryCellKind, TrajectoryCellProps } from './trajectory-record.ts'

/** Horizontal projection used by the trajectory timeline. */
// 时间线水平投影模式：sequence（等宽序列）/ duration（记录时长）/ time（压缩空闲的
// 完整时间）/ actual（实际时间）。
export type TrajectoryTimelineMode = 'sequence' | 'duration' | 'time' | 'actual'

/** Inclusive selection in the active timeline projection's domain. */
// 当前投影域内的闭区间选择（起止都包含）。
export interface TrajectoryTimeRange {
  start: number
  end: number
}

/** One ledger record projected into the active timeline domain. */
/*
 * 一条账本记录投影进当前时间线域后的片段：带起止、车道、标签与错误标记。
 */
export interface TrajectoryTimelineSpan extends TrajectoryTimeRange {
  index: number
  isError: boolean
  kind: TrajectoryCellKind
  label: string
  lane: number
}

/** One turn boundary in the active timeline domain. */
// 当前时间线域内的一个回合边界（回合号 + 投影后的时间位置）。
export interface TrajectoryTimelineTurnBoundary {
  turn: number
  time: number
}

/** Full-domain model used by the overview. */
// 概览使用的完整时间线模型：全部片段 + 回合边界。
export interface TrajectoryTimelineModel extends TrajectoryTimeRange {
  spans: readonly TrajectoryTimelineSpan[]
  turnBoundaries: readonly TrajectoryTimelineTurnBoundary[]
}

/**
 * Format a timeline duration as an integer-millisecond label.
 * @param milliseconds - Non-negative duration in milliseconds.
 * @returns Millisecond label with thousands separators.
 */
/*
 * 把时间线时长格式化成整数毫秒标签（带千分位），复用于偏移显示。
 * @param milliseconds - 非负毫秒时长。
 * @returns 带千分位的毫秒标签。
 */
export function formatTimelineOffset(milliseconds: number): string {
  return formatDurationMillis(milliseconds)
}

// 车道分配：工具 / 子工具在第 2 道，消息 / 压缩在第 1 道，其余（系统等）在第 0 道。
function laneFor(kind: TrajectoryCellKind): number {
  if (kind === 'tool' || kind === 'subtool') return 2
  if (kind === 'message' || kind === 'compacted') return 1
  return 0
}

// 类型守卫：把 null / undefined / 非有限数都排除，只留下可用的 number。
function finite(value: number | null | undefined): value is number {
  return value !== null && value !== undefined && Number.isFinite(value)
}

// 由单元格的 startedAt 与 timeSeconds 计算它在时间域内的区间；缺开始时间返回 null。
function cellRange(cell: TrajectoryCellProps): TrajectoryTimeRange | null {
  if (!finite(cell.startedAt)) return null
  const durationMs = finite(cell.timeSeconds)
    ? Math.max(0, cell.timeSeconds * 1_000)
    : 0
  return { start: cell.startedAt, end: cell.startedAt + durationMs }
}

/**
 * Project every visible record into a stable three-lane timeline.
 * @param turns - Unfiltered trajectory layout.
 * @param mode - Independent equal/recorded duration and compressed/complete time projection.
 * @returns Timeline model, or `null` when no record is visible.
 */
/*
 * 把每条可见记录投影成稳定的三车道时间线。
 * 使用示例：const model = deriveTrajectoryTimeline(turns, toolbarMode)；model === null 时隐藏概览。
 * @param turns - 未过滤的轨迹布局。
 * @param mode - 等宽 / 记录时长 / 压缩空闲 / 实际时间四种投影。
 * @returns 时间线模型；没有任何可见记录时返回 null。
 */
export function deriveTrajectoryTimeline(
  turns: readonly TrajectoryTurnModel[],
  mode: TrajectoryTimelineMode = 'sequence',
): TrajectoryTimelineModel | null {
  if (mode !== 'sequence') {
    // 时间相关模式：actual 与 duration 用记录时长，time 还要压缩空闲间隙。
    return deriveTimedTimeline(
      turns,
      mode === 'duration' || mode === 'actual',
      mode === 'duration',
    )
  }
  const spans: TrajectoryTimelineSpan[] = []
  const turnBoundaries: TrajectoryTimelineTurnBoundary[] = []

  for (const turn of turns) {
    // 等宽模式：每个可见记录占一个固定单位宽度。
    const cells = turn.groups.flatMap(group =>
      group.cells.filter(cell => cell.requestOnly !== true),
    )
    if (cells.length === 0) continue
    if (turn.turn !== null) {
      turnBoundaries.push({
        turn: turn.turn,
        time: spans.length,
      })
    }
    spans.push(...cells.map((cell, offset): TrajectoryTimelineSpan => ({
      start: spans.length + offset,
      end: spans.length + offset + 1,
      index: cell.index,
      isError: cell.isError === true,
      kind: cell.kind,
      label: cell.text,
      lane: laneFor(cell.kind),
    })))
  }

  if (spans.length === 0) return null
  return {
    start: 0,
    end: spans.length,
    spans,
    turnBoundaries,
  }
}

// 时间投影：把每个记录的 [startedAt, startedAt+时长] 区间作为横轴；compressIdle 时
// 先把空闲间隙从所有坐标中扣除（removedIdle），actualDuration 决定片段末端取真实结束
// 还是只取起点（把区间画成"点"）。
function deriveTimedTimeline(
  turns: readonly TrajectoryTurnModel[],
  actualDuration: boolean,
  compressIdle: boolean,
): TrajectoryTimelineModel | null {
  const timedTurns = turns.flatMap((turn) => {
    const rawSpans = turn.groups.flatMap(group =>
      group.cells.flatMap((cell): TrajectoryTimelineSpan[] => {
        if (cell.requestOnly === true) return []
        const range = cellRange(cell)
        return range === null
          ? []
          : [{
            ...range,
            index: cell.index,
            isError: cell.isError === true,
            kind: cell.kind,
            label: cell.text,
            lane: laneFor(cell.kind),
          }]
      }),
    )
    return rawSpans.length === 0 ? [] : [{ turn: turn.turn, rawSpans }]
  })
  const rawSpans = timedTurns.flatMap(turn => turn.rawSpans)
  if (rawSpans.length === 0) return null

  // 按开始时间排序后，累计每个 span 之前被压缩掉的空闲总量，记在 removedIdleBySpan 里。
  const removedIdleBySpan = new Map<TrajectoryTimelineSpan, number>()
  let removedIdle = 0
  let coveredUntil: number | null = null
  for (const span of [...rawSpans].sort((left, right) =>
    left.start - right.start || left.end - right.end)) {
    if (compressIdle && coveredUntil !== null && span.start > coveredUntil) {
      removedIdle += span.start - coveredUntil
    }
    removedIdleBySpan.set(span, removedIdle)
    coveredUntil = coveredUntil === null ? span.end : Math.max(coveredUntil, span.end)
  }

  // 每个 span 减去它应扣的空闲；回合边界取该回合首个投影 span 的起点。
  const spans: TrajectoryTimelineSpan[] = []
  const turnBoundaries: TrajectoryTimelineTurnBoundary[] = []
  for (const turn of timedTurns) {
    const projected = turn.rawSpans.map((span): TrajectoryTimelineSpan => {
      const offset = removedIdleBySpan.get(span) ?? 0
      return {
        ...span,
        start: span.start - offset,
        end: (actualDuration ? span.end : span.start) - offset,
      }
    })
    spans.push(...projected)
    if (turn.turn !== null) {
      turnBoundaries.push({
        turn: turn.turn,
        time: Math.min(...projected.map(span => span.start)),
      })
    }
  }

  return {
    start: Math.min(...spans.map(span => span.start)),
    end: Math.max(...spans.map(span => span.end)),
    spans,
    turnBoundaries,
  }
}

/**
 * Identify records active at any point inside an inclusive selected interval.
 * @param turns - Unfiltered trajectory layout.
 * @param range - Selected interval in the active projection.
 * @param mode - Independent equal/recorded duration and compressed/complete time projection.
 * @returns Record indexes inside the focus interval.
 */
/*
 * 找出与选中闭区间相交的所有记录索引（用于聚焦 / 高亮）。
 * @param turns - 未过滤的轨迹布局。
 * @param range - 当前投影中的选中区间。
 * @param mode - 与时间线相同的投影模式。
 * @returns 落在焦点区间内的记录索引集合。
 */
export function trajectoryTimelineFocusIndexes(
  turns: readonly TrajectoryTurnModel[],
  range: TrajectoryTimeRange,
  mode: TrajectoryTimelineMode = 'sequence',
): ReadonlySet<number> {
  const model = deriveTrajectoryTimeline(turns, mode)
  return new Set(
    model?.spans
      .filter(span => span.start <= range.end && span.end >= range.start)
      .map(span => span.index),
  )
}
