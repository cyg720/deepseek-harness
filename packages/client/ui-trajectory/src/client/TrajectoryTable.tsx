/** Turn-aware trajectory event ledger with a local record inspector. */
/**
 * 文件职责：实现运行轨迹的 TrajectoryTable 组件。
 * 技术维度：React、TypeScript、Cordis 插槽和 CSS Modules。
 * 产品维度：向用户展示运行轨迹参数、结果和状态。
 * 逻辑维度：接收类型化数据，选择专用视图并渲染层级与详情。
 * 关键边界：组件不执行工具；未知或失败结果必须保留可诊断信息。
 * 新手阅读建议：先读 Props，再看视图选择、派生值和 JSX。
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import {
  IconChevronRightOutline14,
  IconSettingsOutline16,
  IconSparkle16,
  IconUserOutline16,
  JsonTree,
  MarkdownText,
  Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { structuredPatch } from 'diff'
import type {
  AssistantRequestConfig, ConversationPromptSnapshot,
} from '@deepseek-ai/dsh-client-runtime/client'
import type {
  AssistantMetricDetail, TrajectoryCellKind, TrajectoryCellProps, TrajectorySourceBlock,
} from './trajectory-record.ts'
import { formatElapsedSeconds, trajectoryRecordId } from './trajectory-record.ts'
import {
  groupTrajectoryVirtualRows, trajectoryVirtualRecordKey,
} from './trajectory-virtual-rows.ts'
import type { TrajectoryVirtualRow } from './trajectory-virtual-rows.ts'
import type { TrajectoryTurnModel } from './layout.ts'
import { trajectoryPreviewText } from './trajectory-preview.ts'
import css from './TrajectoryTable.module.css'

/** 中文说明：视图局部值 解构结果，由紧邻初始化决定。 */
const BOTTOM_FOLLOW_THRESHOLD_PX = 2
/** 中文说明：视图局部值 OLDER_LOAD_THRESHOLD_PX，由紧邻初始化决定。 */
const OLDER_LOAD_THRESHOLD_PX = 48
/** 中文说明：视图局部值 解构结果，由紧邻初始化决定。 */
const HISTORY_LOAD_ROW_HEIGHT_PX = 30
/** 中文说明：视图局部值 VIRTUALIZATION_THRESHOLD，由紧邻初始化决定。 */
const VIRTUALIZATION_THRESHOLD = 100
/** 中文说明：视图局部值 VIRTUAL_OVERSCAN_ROWS，由紧邻初始化决定。 */
const VIRTUAL_OVERSCAN_ROWS = 12
/** 中文说明：视图局部值 解构结果，由紧邻初始化决定。 */
const VIRTUAL_INITIAL_VIEWPORT_HEIGHT_PX = 600

/** 中文说明：视图局部值 KIND_LABEL，由紧邻初始化决定。 */
const KIND_LABEL: Record<TrajectoryCellKind, string> = {
  system: 'SYSTEM',
  user: 'USER',
  context: 'CONTEXT',
  compacted: 'COMPACTED',
  message: 'ASSISTANT',
  tool: 'TOOL',
  subtool: 'SUBTOOL',
}

/** 中文说明：函数 ToolWrenchIcon 的参数见签名，返回结果供展示流程使用；示例见本文件。 */
function ToolWrenchIcon(): ReactNode {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      data-role-icon="wrench"
      aria-hidden="true"
    >
      <path d="M14 3.3a3.8 3.8 0 0 1-4.8 4.8l-5.1 5.1a1.6 1.6 0 1 1-2.3-2.3l5.1-5.1A3.8 3.8 0 0 1 11.7 1l-2.3 2.3 2.3 2.3L14 3.3Z" />
    </svg>
  )
}

/** 中文说明：函数 InformationIcon 的参数见签名，返回结果供展示流程使用；示例见本文件。 */
function InformationIcon(): ReactNode {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      data-role-icon="information"
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="6.7" />
      <circle cx="8" cy="5.5" r=".85" fill="currentColor" stroke="none" />
      <path d="M8 7.75v3.4" strokeWidth="1.8" />
    </svg>
  )
}

/** 中文说明：函数 CompactedIcon 的参数见签名，返回结果供展示流程使用；示例见本文件。 */
function CompactedIcon(): ReactNode {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      data-role-icon="compacted"
      aria-hidden="true"
    >
      <path d="m2.5 2.5 3.75 3.75M3 6.25h3.25V3" />
      <path d="m13.5 2.5-3.75 3.75M13 6.25H9.75V3" />
      <path d="m2.5 13.5 3.75-3.75M3 9.75h3.25V13" />
      <path d="m13.5 13.5-3.75-3.75M13 9.75H9.75V13" />
    </svg>
  )
}

/** 中文说明：视图局部值 KIND_ICON，由紧邻初始化决定。 */
const KIND_ICON: Record<TrajectoryCellKind, ReactNode> = {
  system: <IconSettingsOutline16 size={13} />,
  user: <IconUserOutline16 size={13} />,
  context: <InformationIcon />,
  compacted: <CompactedIcon />,
  message: <IconSparkle16 size={13} />,
  tool: <ToolWrenchIcon />,
  subtool: <ToolWrenchIcon />,
}

/** 中文说明：类型或类 TableRecord 约束工具或轨迹数据职责。 */
interface TableRecord {
  turn: number | null
  section: number
  group: string
  groupStart: boolean
  turnStart: boolean
  cell: TrajectoryCellProps
  turnEnd: boolean
  collapsedSummary?: string
  collapsedSummaryKind?: 'turn' | 'assistant'
}

/** 中文说明：类型或类 VirtualRowStructure 约束工具或轨迹数据职责。 */
interface VirtualRowStructure {
  height: number
  key: string
}

/** 中文说明：函数 useStableVirtualRowStructure 的参数见签名，返回结果供展示流程使用；示例见本文件。 */
function useStableVirtualRowStructure(
  rows: readonly TrajectoryVirtualRow<TableRecord>[],
): readonly VirtualRowStructure[] {
  /** 中文说明：视图局部值 cache，由紧邻初始化决定。 */
  const cache = useRef<{
    rows: readonly TrajectoryVirtualRow<TableRecord>[]
    structure: readonly VirtualRowStructure[]
  }>({ rows: [], structure: [] })
  if (cache.current.rows === rows) return cache.current.structure
  /** 中文说明：视图局部值 structure，由紧邻初始化决定。 */
  const structure = cache.current.structure.length === rows.length
    && rows.every((row, index) => {
      /** 中文说明：视图局部值 previous，由紧邻初始化决定。 */
      const previous = cache.current.structure[index]
      return previous?.key === row.key && previous.height === row.height
    })
    ? cache.current.structure
    : rows.map(row => ({ key: row.key, height: row.height }))
  cache.current = { rows, structure }
  return structure
}

/** 中文说明：类型或类 DetailTab 约束工具或轨迹数据职责。 */
type DetailTab =
  | 'system-prompt'
  | 'tools'
  | 'overview'
  | 'rendered'
  | 'raw'
  | 'source'
  | 'input'
  | 'output'
  | 'schema'
  | 'options'
  | 'usage'
  | 'timing'
  | 'diff'
/** 中文说明：类型或类 RecordState 约束工具或轨迹数据职责。 */
type RecordState = 'complete' | 'running' | 'error'

/** 中文说明：类型或类 DetailTabItem 约束工具或轨迹数据职责。 */
interface DetailTabItem {
  id: DetailTab
  label: string
}

/** 中文说明：类型或类 ParentRecords 约束工具或轨迹数据职责。 */
interface ParentRecords {
  message?: TableRecord
  tool?: TableRecord
}

/** 中文说明：类型或类 ToolCallTextParts 约束工具或轨迹数据职责。 */
interface ToolCallTextParts {
  name: string
  args?: string
}

/** 中文说明：类型或类 SelectedRequest 约束工具或轨迹数据职责。 */
interface SelectedRequest {
  turn: number | null
  group: string
  seq?: number
}

/** 中文说明：类型或类 DetailsResizeDrag 约束工具或轨迹数据职责。 */
interface DetailsResizeDrag {
  pointerId: number
  startX: number
  startWidth: number
  splitWidth: number
  startToolRequestOffset: number
}

/** 中文说明：视图局部值 DETAILS_MIN_WIDTH，由紧邻初始化决定。 */
const DETAILS_MIN_WIDTH = 320
/** 中文说明：视图局部值 DETAILS_MAX_WIDTH，由紧邻初始化决定。 */
const DETAILS_MAX_WIDTH = 720
/** 中文说明：视图局部值 TABLE_MIN_WIDTH，由紧邻初始化决定。 */
const TABLE_MIN_WIDTH = 280
/** 中文说明：视图局部值 DETAILS_RESIZE_STEP，由紧邻初始化决定。 */
const DETAILS_RESIZE_STEP = 16
/** 中文说明：视图局部值 TOOL_REQUEST_SHARE，由紧邻初始化决定。 */
const TOOL_REQUEST_SHARE = 0.58
/** 中文说明：视图局部值 TOOL_REQUEST_MIN_WIDTH，由紧邻初始化决定。 */
const TOOL_REQUEST_MIN_WIDTH = 180
/** 中文说明：视图局部值 TOOL_REQUEST_MAX_WIDTH，由紧邻初始化决定。 */
const TOOL_REQUEST_MAX_WIDTH = 480
/** 中文说明：视图局部值 解构结果，由紧邻初始化决定。 */
const DEFAULT_TOOL_REQUEST_SHARE = 0.36
/** 中文说明：视图局部值 解构结果，由紧邻初始化决定。 */
const DEFAULT_TOOL_REQUEST_OFFSET = 56
/** 中文说明：视图局部值 SYSTEM_PROMPT_TABS，由紧邻初始化决定。 */
const SYSTEM_PROMPT_TABS: readonly DetailTabItem[] = [
  { id: 'system-prompt', label: 'System Prompt' },
  { id: 'tools', label: 'Tools' },
]
/** 中文说明：视图局部值 SYSTEM_UPDATE_TABS，由紧邻初始化决定。 */
const SYSTEM_UPDATE_TABS: readonly DetailTabItem[] = [
  { id: 'diff', label: 'Diff' },
  ...SYSTEM_PROMPT_TABS,
]
/** 中文说明：视图局部值 REQUEST_TABS，由紧邻初始化决定。 */
const REQUEST_TABS: readonly DetailTabItem[] = [
  { id: 'overview', label: 'Summary' },
  { id: 'options', label: 'Options' },
  { id: 'usage', label: 'Usage' },
  { id: 'timing', label: 'Timing' },
]

/** 中文说明：类型或类 TrajectorySplitStyle 约束工具或轨迹数据职责。 */
type TrajectorySplitStyle = CSSProperties & {
  '--trajectory-tool-request-width': string
}

/** 中文说明：类型或类 RequestBoundaryStyle 约束工具或轨迹数据职责。 */
type RequestBoundaryStyle = CSSProperties & {
  '--request-boundary-offset': string
}

/** 中文说明：类型或类 VirtualSpacerStyle 约束工具或轨迹数据职责。 */
type VirtualSpacerStyle = CSSProperties & {
  '--trajectory-virtual-spacer-height': string
}

/** 中文说明：类型或类 OlderLoadAnchor 约束工具或轨迹数据职责。 */
interface OlderLoadAnchor {
  readonly historyStartSeq: number | undefined
  readonly scrollHeight: number
  readonly scrollTop: number
}

/** 中文说明：函数 clampDetailsWidth 的参数见签名，返回结果供展示流程使用；示例见本文件。 */
function clampDetailsWidth(width: number, splitWidth: number): number {
  /** 中文说明：视图局部值 maxWidth，由紧邻初始化决定。 */
  const maxWidth = Math.max(
    DETAILS_MIN_WIDTH,
    Math.min(DETAILS_MAX_WIDTH, splitWidth - TABLE_MIN_WIDTH),
  )
  return Math.round(Math.min(Math.max(width, DETAILS_MIN_WIDTH), maxWidth))
}

/** 中文说明：函数 defaultToolRequestWidth 的参数见签名，返回结果供展示流程使用；示例见本文件。 */
function defaultToolRequestWidth(splitWidth: number): number {
  return Math.min(
    Math.max(
      splitWidth * DEFAULT_TOOL_REQUEST_SHARE - DEFAULT_TOOL_REQUEST_OFFSET,
      TOOL_REQUEST_MIN_WIDTH,
    ),
    TOOL_REQUEST_MAX_WIDTH,
  )
}

/** 中文说明：函数 formatDurationMs 的参数见签名，返回结果供展示流程使用；示例见本文件。 */
function formatDurationMs(milliseconds: number): string {
  if (milliseconds < 1_000) return `${Math.round(milliseconds)} ms`
  return `${(milliseconds / 1_000).toFixed(milliseconds < 10_000 ? 2 : 1)} s`
}

/** 中文说明：函数 formatStartedAt 的参数见签名，返回结果供展示流程使用；示例见本文件。 */
function formatStartedAt(timestamp: number | null): string {
  if (timestamp === null || !Number.isFinite(timestamp)) return 'Not available'
  /** 中文说明：视图局部值 date，由紧邻初始化决定。 */
  const date = new Date(timestamp)
  /** 中文说明：视图局部值 two，由紧邻初始化决定。 */
  const two = (value: number) => String(value).padStart(2, '0')
  /** 中文说明：视图局部值 three，由紧邻初始化决定。 */
  const three = (value: number) => String(value).padStart(3, '0')
  /** 中文说明：视图局部值 time，由紧邻初始化决定。 */
  const time = `${two(date.getHours())}:${two(date.getMinutes())}:${two(date.getSeconds())}.${three(date.getMilliseconds())}`
  /** 中文说明：视图局部值 day，由紧邻初始化决定。 */
  const day = `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`
  return `${day} ${time}`
}

/** Whether a click lands on an active text selection and should keep it. */
/** 中文说明：函数 clickSelectsText 的参数见签名，返回结果供展示流程使用；示例见本文件。 */
function clickSelectsText(target: Node): boolean {
  /** 中文说明：视图局部值 selection，由紧邻初始化决定。 */
  const selection = window.getSelection()
  return selection !== null
    && !selection.isCollapsed
    && selection.rangeCount > 0
    && selection.getRangeAt(0).intersectsNode(target)
}

/** 中文说明：函数 StartedAtValue 的参数见签名，返回结果供展示流程使用；示例见本文件。 */
function StartedAtValue({ timestamp }: { timestamp: number | null }) {
  /** 中文说明：视图局部值 [showUnix, setShowUnix]，由紧邻初始化决定。 */
  const [showUnix, setShowUnix] = useState(false)
  if (timestamp === null || !Number.isFinite(timestamp)) return <dd>Not available</dd>
  return (
    <dd>
      <button
        type="button"
        className={css.timestampToggle}
        title={showUnix ? 'Show local time' : 'Show Unix timestamp'}
        onClick={(event) => {
          if (clickSelectsText(event.currentTarget)) return
          setShowUnix(current => !current)
        }}
      >
        {showUnix ? (timestamp / 1_000).toFixed(3) : formatStartedAt(timestamp)}
      </button>
    </dd>
  )
}

/** 中文说明：函数 totalTime 的参数见签名，返回结果供展示流程使用；示例见本文件。 */
function totalTime(metrics: AssistantMetricDetail): string {
  if (!metrics.timingRecorded) return 'Not recorded'
  if (metrics.stepStartTime === null) return 'Step start unavailable'
  if (metrics.completedTime === null) return 'Pending'
  return formatDurationMs(Math.max(0, metrics.completedTime - metrics.stepStartTime))
}

/** 中文说明：函数 ttft 的参数见签名，返回结果供展示流程使用；示例见本文件。 */
function ttft(metrics: AssistantMetricDetail): string {
  if (!metrics.timingRecorded) return 'Not recorded'
  if (metrics.stepStartTime === null) return 'Step start unavailable'
  if (metrics.firstTokenTime === null) return 'First token unavailable'
  return formatDurationMs(Math.max(0, metrics.firstTokenTime - metrics.stepStartTime))
}

/** 中文说明：函数 generationTime 的参数见签名，返回结果供展示流程使用；示例见本文件。 */
function generationTime(metrics: AssistantMetricDetail): string {
  if (!metrics.timingRecorded || metrics.firstTokenTime === null) return 'First token unavailable'
  if (metrics.completedTime === null) return 'Pending'
  return formatDurationMs(Math.max(0, metrics.completedTime - metrics.firstTokenTime))
}

/** 中文说明：函数 throughput 的参数见签名，返回结果供展示流程使用；示例见本文件。 */
function throughput(metrics: AssistantMetricDetail): string {
  if (!metrics.usageProvided) return 'Usage unavailable'
  if (metrics.outputTokens === null) return 'Output tokens unavailable'
  if (!metrics.timingRecorded || metrics.firstTokenTime === null) return 'First token unavailable'
  if (metrics.completedTime === null) return 'Pending'
  /** 中文说明：视图局部值 generationSeconds，由紧邻初始化决定。 */
  const generationSeconds = (metrics.completedTime - metrics.firstTokenTime) / 1_000
  if (generationSeconds <= 0) return 'Duration too short'
  return `${(metrics.outputTokens / generationSeconds).toFixed(1)} tok/s`
}

/** 中文说明：函数 AssistantTimingPanel 的参数见签名，返回结果供展示流程使用；示例见本文件。 */
function AssistantTimingPanel({ metrics }: { metrics: AssistantMetricDetail }) {
  return (
    <dl className={css.overview}>
      <div><dt>Started</dt><StartedAtValue timestamp={metrics.stepStartTime} /></div>
      <div><dt>Total duration</dt><dd>{totalTime(metrics)}</dd></div>
      <div><dt>TTFT</dt><dd>{ttft(metrics)}</dd></div>
      <div><dt>Generation</dt><dd>{generationTime(metrics)}</dd></div>
      <div><dt>Throughput</dt><dd>{throughput(metrics)}</dd></div>
    </dl>
  )
}

/** Props for the trajectory ledger. */
/** 中文说明：类型或类 TrajectoryTableProps 约束工具或轨迹数据职责。 */
export interface TrajectoryTableProps {
  /** Session-global request numbers for the request groups visible in this context. */
  requestNumbers?: readonly TrajectoryRequestNumber[]
  /** Grouped records in display order. */
  turns: readonly TrajectoryTurnModel[]
  /** In-flight cells whose content replaces the matching structural record index. */
  streamingCells?: readonly TrajectoryCellProps[]
  /** Record indexes emphasized by the active timeline focus. */
  timelineFocusIndexes?: ReadonlySet<number> | null
  /** Record indexes retained by the active live search, or null without a query. */
  searchMatchIndexes?: ReadonlySet<number> | null
  /** Report the record currently selected in the local inspector. */
  onSelectedIndexChange?: (index: number | null) => void
  /** Report a direct user selection from a ledger row. */
  onRecordSelect?: (index: number) => void
  /** One externally requested record selection; a new object repeats the request. */
  recordSelection?: { readonly index: number } | null
  /** One externally requested record focus without changing inspector selection. */
  recordFocus?: { readonly index: number } | null
  /** Whether the initial history tail is still loading. */
  historyLoading?: boolean
  /** Whether one older history page request is pending anywhere. */
  olderHistoryLoading?: boolean
  /** First loaded raw event, used to preserve scroll position after prepending a page. */
  historyStartSeq?: number | undefined
  /** Whether one older history page can be requested. */
  hasOlderRecords?: boolean
  /** Load one older history page. */
  onLoadOlder?: () => Promise<boolean>
  /** Clear selection state owned by the ledger host. */
  onClearSelection?: () => void
  /** Turn ids whose rows after the first are folded into a summary. */
  collapsedTurns: ReadonlySet<number>
  /** Toggle one turn between folded and expanded. */
  onToggleTurn: (turn: number) => void
  /** Stable Assistant record ids whose tool calls are folded. */
  collapsedAssistants: ReadonlySet<string>
  /** Toggle tool calls under one assistant record. */
  onToggleAssistant: (id: string) => void
  /** One-shot cross-view inspect: open and scroll to this call's record. */
  inspectCallId?: string | null
  /** Acknowledge a consumed (or unresolvable) inspect request. */
  onInspectApplied?: (() => void) | undefined
}

/** Request-inspector fields shared by ordinary generation and compaction. */
/** 中文说明：类型或类 TrajectoryRequestNumberBase 约束工具或轨迹数据职责。 */
interface TrajectoryRequestNumberBase {
  /** Request anchor event sequence; absent for the currently streaming ordinary request. */
  seq?: number
  group: string
  number: number
  status?: 'complete' | 'running' | 'error'
  startedAt?: number
  completedAt?: number | null
  error?: string
  retry?: number
  maxRetries?: number
  retryDelayMs?: number
  resultSeq?: number
  provider?: string
  model?: string
  requestConfig?: AssistantRequestConfig
  usage?: TrajectoryUsage
  cumulativeUsage?: TrajectoryUsage
}

/** One purpose-discriminated request identity paired with its session-global number. */
/** 中文说明：类型或类 TrajectoryRequestNumber 约束工具或轨迹数据职责。 */
export type TrajectoryRequestNumber = TrajectoryRequestNumberBase & (
  | {
    purpose?: 'assistant'
    turn: number
    step: number
  }
  | {
    purpose: 'compaction'
    turn: number | null
    step: 0
  }
)

/** Disjoint provider token buckets for one request or a session prefix. */
/** 中文说明：类型或类 TrajectoryUsage 约束工具或轨迹数据职责。 */
export interface TrajectoryUsage {
  input?: number
  cacheRead?: number
  cacheWrite?: number
  output?: number
  reasoning?: number
}

/** 中文说明：函数 flattenRecords 的参数见签名，返回结果供展示流程使用；示例见本文件。 */
function flattenRecords(turns: readonly TrajectoryTurnModel[]): TableRecord[] {
  return turns.flatMap((turn, section) => {
    /** 中文说明：视图局部值 firstInSection，由紧邻初始化决定。 */
    let firstInSection = true
    /** 中文说明：视图局部值 records，由紧邻初始化决定。 */
    const records = turn.groups.flatMap((group) => {
      return group.cells.map((cell, index) => {
        /** 中文说明：视图局部值 turnStart，由紧邻初始化决定。 */
        const turnStart = firstInSection
          && cell.requestOnly !== true
          && cell.kind !== 'system'
          && (cell.kind !== 'compacted' || turn.turn === null)
        if (turnStart) firstInSection = false
        return {
          turn: turn.turn,
          section,
          group: group.title,
          groupStart: index === 0,
          turnStart,
          cell,
          turnEnd: false,
        }
      })
    })
    /** 中文说明：视图局部值 last，由紧邻初始化决定。 */
    const last = records.at(-1)
    if (last !== undefined) last.turnEnd = true
    return records
  })
}

/** 中文说明：函数 filterRecords 的参数见签名，返回结果供展示流程使用；示例见本文件。 */
function filterRecords(
  records: readonly TableRecord[],
  matches: ReadonlySet<number>,
): TableRecord[] {
  /** 中文说明：视图局部值 filtered，由紧邻初始化决定。 */
  const filtered = records
    .filter(record =>
      record.cell.requestOnly !== true && matches.has(record.cell.index),
    )
    .map(record => ({ ...record, groupStart: false, turnStart: false, turnEnd: false }))
  /** 中文说明：视图局部值 startedSections，由紧邻初始化决定。 */
  const startedSections = new Set<number>()
  /** 中文说明：视图局部值 [index，由紧邻初始化决定。 */
  for (const [index, record] of filtered.entries()) {
    /** 中文说明：视图局部值 previous，由紧邻初始化决定。 */
    const previous = filtered[index - 1]
    /** 中文说明：视图局部值 next，由紧邻初始化决定。 */
    const next = filtered[index + 1]
    record.groupStart = previous === undefined
      || previous.section !== record.section
      || previous.group !== record.group
    record.turnStart = !startedSections.has(record.section)
      && record.cell.kind !== 'system'
      && (record.cell.kind !== 'compacted' || record.turn === null)
    if (record.turnStart) startedSections.add(record.section)
    record.turnEnd = next === undefined || next.section !== record.section
  }
  return filtered
}

/** 中文说明：函数 requestStep 的参数见签名，返回结果供展示流程使用；示例见本文件。 */
function requestStep(group: string): number | undefined {
  if (!group.startsWith('Step ')) return undefined
  /** 中文说明：视图局部值 value，由紧邻初始化决定。 */
  const value = Number(group.slice('Step '.length))
  return Number.isInteger(value) && value > 0 ? value : undefined
}

/** 中文说明：函数 requestKey 的参数见签名，返回结果供展示流程使用；示例见本文件。 */
function requestKey(turn: number | null, group: string): string {
  return `${turn}\u0000${group}`
}

/** 中文说明：函数 indexRequestBoundaries 的参数见签名，返回结果供展示流程使用；示例见本文件。 */
function indexRequestBoundaries(records: readonly TableRecord[]): ReadonlyMap<string, number> {
  /** 中文说明：视图局部值 boundaries，由紧邻初始化决定。 */
  const boundaries = new Map<string, number>()
  /** 中文说明：视图局部值 record，由紧邻初始化决定。 */
  for (const record of records) {
    /** 中文说明：视图局部值 key，由紧邻初始化决定。 */
    const key = requestKey(record.turn, record.group)
    if (boundaries.has(key)) continue
    if (requestStep(record.group) === undefined) {
      if (record.groupStart) boundaries.set(key, record.cell.index)
      continue
    }
    if (record.cell.kind === 'user' || record.cell.kind === 'context') continue
    boundaries.set(key, record.cell.index)
  }
  return boundaries
}

/** 中文说明：函数 sectionLabel 的参数见签名，返回结果供展示流程使用；示例见本文件。 */
function sectionLabel(turn: number | null): string {
  return turn === null ? 'Between turns' : `Turn ${turn}`
}

/** 中文说明：函数 indexRequestNumbers 的参数见签名，返回结果供展示流程使用；示例见本文件。 */
function indexRequestNumbers(
  records: readonly TableRecord[],
  sessionNumbers: readonly TrajectoryRequestNumber[] | undefined,
  boundaries: ReadonlyMap<string, number>,
): ReadonlyMap<string, number> {
  /** 中文说明：视图局部值 numbers，由紧邻初始化决定。 */
  const numbers = new Map<string, number>()
  /** 中文说明：视图局部值 request，由紧邻初始化决定。 */
  for (const request of sessionNumbers ?? []) {
    numbers.set(requestKey(request.turn, request.group), request.number)
  }
  /** 中文说明：视图局部值 next，由紧邻初始化决定。 */
  let next = Math.max(0, ...numbers.values()) + 1
  /** 中文说明：视图局部值 boundaryRecords，由紧邻初始化决定。 */
  const boundaryRecords = records
    .filter(record => boundaries.get(requestKey(record.turn, record.group)) === record.cell.index
      && requestStep(record.group) !== undefined)
    .sort((left, right) => left.cell.index - right.cell.index)
  /** 中文说明：视图局部值 record，由紧邻初始化决定。 */
  for (const record of boundaryRecords) {
    /** 中文说明：视图局部值 key，由紧邻初始化决定。 */
    const key = requestKey(record.turn, record.group)
    if (!numbers.has(key)) numbers.set(key, next++)
  }
  return numbers
}

/** 中文说明：函数 indexRequestBoundaryRuns 的参数见签名，返回结果供展示流程使用；示例见本文件。 */
function indexRequestBoundaryRuns(records: readonly TableRecord[]): ReadonlyMap<number, number> {
  /** 中文说明：视图局部值 indexes，由紧邻初始化决定。 */
  const indexes = new Map<number, number>()
  /** 中文说明：视图局部值 runLength，由紧邻初始化决定。 */
  let runLength = 0
  /** 中文说明：视图局部值 record，由紧邻初始化决定。 */
  for (const record of records) {
    if (record.cell.requestOnly === true) {
      indexes.set(record.cell.index, runLength++)
      continue
    }
    if (runLength > 0 && record.groupStart && requestStep(record.group) !== undefined) {
      indexes.set(record.cell.index, runLength)
    }
    runLength = 0
  }
  return indexes
}

/** 中文说明：函数 summarizeTurn 的参数见签名，返回结果供展示流程使用；示例见本文件。 */
function summarizeTurn(records: readonly TableRecord[]): string {
  /** 中文说明：视图局部值 steps，由紧邻初始化决定。 */
  const steps = new Set(
    records
      .map(record => record.group)
      .filter(group => group.startsWith('Step ')),
  ).size
  /** 中文说明：视图局部值 toolCalls，由紧邻初始化决定。 */
  const toolCalls = records.filter(record =>
    record.cell.kind === 'tool' || record.cell.kind === 'subtool',
  ).length
  return [
    `${steps} ${steps === 1 ? 'step' : 'steps'}`,
    `${toolCalls} tool ${toolCalls === 1 ? 'call' : 'calls'}`,
  ].join(' · ')
}

/** 中文说明：函数 collapseTurnRecords 的参数见签名，返回结果供展示流程使用；示例见本文件。 */
function collapseTurnRecords(
  records: readonly TableRecord[],
  collapsedTurns: ReadonlySet<number>,
): TableRecord[] {
  /** 中文说明：视图局部值 recordsByTurn，由紧邻初始化决定。 */
  const recordsByTurn = new Map<number, TableRecord[]>()
  /** 中文说明：视图局部值 record，由紧邻初始化决定。 */
  for (const record of records) {
    if (record.turn === null) continue
    /** 中文说明：视图局部值 turnRecords，由紧邻初始化决定。 */
    const turnRecords = recordsByTurn.get(record.turn) ?? []
    turnRecords.push(record)
    recordsByTurn.set(record.turn, turnRecords)
  }
  return records.flatMap((record) => {
    if (record.turn === null || !collapsedTurns.has(record.turn)) return [record]
    /** 中文说明：视图局部值 turnRecords，由紧邻初始化决定。 */
    const turnRecords = recordsByTurn.get(record.turn) ?? [record]
    if (record.cell.requestOnly === true || record.cell.kind === 'system') return [record]
    /** 中文说明：视图局部值 contentRecords，由紧邻初始化决定。 */
    const contentRecords = turnRecords.filter(candidate =>
      candidate.cell.requestOnly !== true && candidate.cell.kind !== 'system')
    if (contentRecords.length <= 1) return [record]
    if (record.cell.index !== contentRecords[0]?.cell.index) return []
    return [
      { ...record, turnEnd: false },
      {
        ...record,
        groupStart: false,
        turnStart: false,
        turnEnd: true,
        collapsedSummary: summarizeTurn(contentRecords.slice(1)),
        collapsedSummaryKind: 'turn',
      },
    ]
  })
}

/** 中文说明：函数 assistantToolCalls 的参数见签名，返回结果供展示流程使用；示例见本文件。 */
function assistantToolCalls(
  records: readonly TableRecord[],
  assistantIndex: number,
): readonly TableRecord[] {
  /** 中文说明：视图局部值 at，由紧邻初始化决定。 */
  const at = records.findIndex(record => record.cell.index === assistantIndex)
  if (at === -1 || records[at]?.cell.kind !== 'message') return []
  /** 中文说明：视图局部值 calls，由紧邻初始化决定。 */
  const calls: TableRecord[] = []
  /** 中文说明：视图局部值 i，由紧邻初始化决定。 */
  for (let i = at + 1; i < records.length; i++) {
    /** 中文说明：视图局部值 record，由紧邻初始化决定。 */
    const record = records[i]
    if (record === undefined) break
    if (record.cell.kind !== 'tool' && record.cell.kind !== 'subtool') break
    calls.push(record)
  }
  return calls
}

/** 中文说明：函数 summarizeAssistantTools 的参数见签名，返回结果供展示流程使用；示例见本文件。 */
function summarizeAssistantTools(records: readonly TableRecord[]): string {
  /** 中文说明：视图局部值 names，由紧邻初始化决定。 */
  const names = [...new Set(records.map((record) => {
    /** 中文说明：视图局部值 separator，由紧邻初始化决定。 */
    const separator = record.cell.text.indexOf(' · ')
    return separator === -1 ? record.cell.text : record.cell.text.slice(0, separator)
  }).filter(name => name !== ''))]
  /** 中文说明：视图局部值 count，由紧邻初始化决定。 */
  const count = records.length
  /** 中文说明：视图局部值 summary，由紧邻初始化决定。 */
  const summary = `${count} tool ${count === 1 ? 'call' : 'calls'}`
  return names.length > 0 ? `${summary} · ${names.join(', ')}` : summary
}

/** 中文说明：函数 collapseAssistantRecords 的参数见签名，返回结果供展示流程使用；示例见本文件。 */
function collapseAssistantRecords(
  records: readonly TableRecord[],
  collapsedAssistants: ReadonlySet<string>,
): TableRecord[] {
  /** 中文说明：视图局部值 out，由紧邻初始化决定。 */
  const out: TableRecord[] = []
  /** 中文说明：视图局部值 i，由紧邻初始化决定。 */
  for (let i = 0; i < records.length; i++) {
    /** 中文说明：视图局部值 record，由紧邻初始化决定。 */
    const record = records[i]
    if (record === undefined) continue
    out.push(record)
    if (
      record.cell.kind !== 'message'
      || !collapsedAssistants.has(trajectoryRecordId(record.cell))
    ) continue
    /** 中文说明：视图局部值 calls，由紧邻初始化决定。 */
    const calls: TableRecord[] = []
    /** 中文说明：视图局部值 j，由紧邻初始化决定。 */
    for (let j = i + 1; j < records.length; j++) {
      /** 中文说明：视图局部值 candidate，由紧邻初始化决定。 */
      const candidate = records[j]
      if (
        candidate === undefined
        || candidate.collapsedSummary !== undefined
        || (candidate.cell.kind !== 'tool' && candidate.cell.kind !== 'subtool')
      ) break
      calls.push(candidate)
    }
    if (calls.length === 0) continue
    /** 中文说明：视图局部值 last，由紧邻初始化决定。 */
    const last = calls.at(-1)
    out[out.length - 1] = { ...record, turnEnd: false }
    out.push({
      ...record,
      groupStart: false,
      turnStart: false,
      turnEnd: last?.turnEnd ?? false,
      collapsedSummary: summarizeAssistantTools(calls),
      collapsedSummaryKind: 'assistant',
    })
    i += calls.length
  }
  return out
}

/** 中文说明：函数 stateOf 的参数见签名，返回结果供展示流程使用；示例见本文件。 */
function stateOf(record: TableRecord): RecordState {
  if (record.cell.isError) return 'error'
  if (record.cell.kind === 'compacted' && record.cell.timeSeconds === null) return 'running'
  if (
    (record.cell.kind === 'tool' || record.cell.kind === 'subtool')
    && record.cell.outputDetail === undefined
  ) return 'running'
  return 'complete'
}

/** 中文说明：函数 statusLabel 的参数见签名，返回结果供展示流程使用；示例见本文件。 */
function statusLabel(state: RecordState): string {
  if (state === 'error') return 'Failed'
  if (state === 'running') return 'Pending'
  return 'Completed'
}

/** 中文说明：函数 TokenRows 的参数见签名，返回结果供展示流程使用；示例见本文件。 */
function TokenRows({ cell }: { cell: TrajectoryCellProps }) {
  /** 中文说明：视图局部值 content，由紧邻初始化决定。 */
  const content = cell.output !== undefined && cell.think !== undefined
    ? Math.max(0, cell.output - cell.think)
    : undefined
  return (
    <>
      <div>
        <dt>Tokens</dt>
        <dd>{cell.output === undefined ? '—' : `${cell.output} tok`}</dd>
      </div>
      {cell.think !== undefined && (
        <div className={css.requestTokenDetail}>
          <dt>Reasoning</dt>
          <dd>{cell.think} tok</dd>
        </div>
      )}
      {content !== undefined && (
        <div className={css.requestTokenDetail}>
          <dt>Content</dt>
          <dd>{content} tok</dd>
        </div>
      )}
    </>
  )
}

/** 中文说明：函数 inputTotal 的参数见签名，返回结果供展示流程使用；示例见本文件。 */
function inputTotal(usage: TrajectoryUsage): number | undefined {
  if (
    usage.input === undefined
    && usage.cacheRead === undefined
    && usage.cacheWrite === undefined
  ) return undefined
  return (usage.input ?? 0) + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0)
}

/** 中文说明：函数 UsageRows 的参数见签名，返回结果供展示流程使用；示例见本文件。 */
function UsageRows({ usage }: { usage: TrajectoryUsage | undefined }) {
  if (usage === undefined) return <p className={css.noPayload}>Usage not reported</p>
  /** 中文说明：视图局部值 totalInput，由紧邻初始化决定。 */
  const totalInput = inputTotal(usage)
  /** 中文说明：视图局部值 otherOutput，由紧邻初始化决定。 */
  const otherOutput = usage.output !== undefined && usage.reasoning !== undefined
    ? usage.output - usage.reasoning
    : undefined
  return (
    <dl className={css.overview}>
      {totalInput !== undefined && (
        <div><dt>Input</dt><dd>{totalInput} tok</dd></div>
      )}
      {usage.cacheRead !== undefined && (
        <div className={css.requestTokenDetail}>
          <dt>Cached</dt>
          <dd>{usage.cacheRead} tok</dd>
        </div>
      )}
      {usage.cacheWrite !== undefined && (
        <div className={css.requestTokenDetail}>
          <dt>Cache created</dt>
          <dd>{usage.cacheWrite} tok</dd>
        </div>
      )}
      {usage.input !== undefined && (
        <div className={css.requestTokenDetail}>
          <dt>Other</dt>
          <dd>{usage.input} tok</dd>
        </div>
      )}
      {usage.output !== undefined && (
        <div><dt>Output</dt><dd>{usage.output} tok</dd></div>
      )}
      {usage.reasoning !== undefined && (
        <div className={css.requestTokenDetail}>
          <dt>Reasoning</dt>
          <dd>{usage.reasoning} tok</dd>
        </div>
      )}
      {otherOutput !== undefined && (
        <div className={css.requestTokenDetail}>
          <dt>Content</dt>
          <dd>{otherOutput} tok</dd>
        </div>
      )}
    </dl>
  )
}

/** 中文说明：函数 RequestUsagePanel 的参数见签名，返回结果供展示流程使用；示例见本文件。 */
function RequestUsagePanel({
  usage,
  cumulative,
}: {
  usage: TrajectoryUsage | undefined
  cumulative: TrajectoryUsage | undefined
}) {
  return (
    <div className={css.usagePanel}>
      <section className={css.usageGroup}>
        <h4 className={css.usageHeading}>This request</h4>
        <UsageRows usage={usage} />
      </section>
      <section className={css.usageGroup}>
        <h4 className={css.usageHeading}>Session cumulative</h4>
        <UsageRows usage={cumulative} />
      </section>
    </div>
  )
}

/** 中文说明：函数 RequestOptions 的参数见签名，返回结果供展示流程使用；示例见本文件。 */
function RequestOptions({
  options,
  preview = false,
}: {
  options: AssistantRequestConfig | undefined
  preview?: boolean
}) {
  if (options === undefined) {
    return <p className={css.noPayload}>Options not recorded</p>
  }
  return (
    <JsonTree
      data={options}
      label="Request options JSON"
      className={preview ? css.jsonPreview : css.jsonPayload}
    />
  )
}

/** 中文说明：函数 messageSourceLabel 的参数见签名，返回结果供展示流程使用；示例见本文件。 */
function messageSourceLabel(source: unknown): string {
  if (typeof source !== 'object' || source === null || Array.isArray(source)) {
    return 'Unknown'
  }
  /** 中文说明：视图局部值 properties，由紧邻初始化决定。 */
  const properties = source as Record<string, unknown>
  /** 中文说明：视图局部值 kind，由紧邻初始化决定。 */
  const kind = properties.kind
  if (kind === 'user') return 'User'
  if (kind === 'plugin') {
    /** 中文说明：视图局部值 plugin，由紧邻初始化决定。 */
    const plugin = properties.plugin
    return typeof plugin === 'string' && plugin !== ''
      ? `Plugin · ${plugin}`
      : 'Plugin'
  }
  if (kind === 'goal') {
    /** 中文说明：视图局部值 round，由紧邻初始化决定。 */
    const round = properties.round
    return typeof round === 'number' && round > 0
      ? `Goal · Round ${round}`
      : 'Goal'
  }
  if (typeof kind !== 'string' || kind === '') return 'Unknown'
  return `${kind[0]?.toUpperCase() ?? ''}${kind.slice(1)}`
}

/** 中文说明：函数 MessageSource 的参数见签名，返回结果供展示流程使用；示例见本文件。 */
function MessageSource({ record }: { record: TableRecord }) {
  /** 中文说明：视图局部值 source，由紧邻初始化决定。 */
  const source = record.cell.messageSource
  if (source === undefined) return <p className={css.noPayload}>Source not recorded</p>
  /** 中文说明：视图局部值 data，由紧邻初始化决定。 */
  const data = typeof source === 'object' && source !== null
    ? source
    : { value: source }
  return (
    <JsonTree
      data={data}
      label="Message source JSON"
      className={css.jsonPayload}
    />
  )
}

/** 中文说明：函数 isMarkdownRecord 的参数见签名，返回结果供展示流程使用；示例见本文件。 */
function isMarkdownRecord(record: TableRecord): boolean {
  return record.cell.kind === 'user'
    || record.cell.kind === 'context'
    || record.cell.kind === 'message'
}

/** 中文说明：函数 parentRecords 的参数见签名，返回结果供展示流程使用；示例见本文件。 */
function parentRecords(
  records: readonly TableRecord[],
  record: TableRecord,
): ParentRecords {
  if (record.cell.kind !== 'tool' && record.cell.kind !== 'subtool') return {}
  /** 中文说明：视图局部值 at，由紧邻初始化决定。 */
  const at = records.findIndex(candidate => candidate.cell.index === record.cell.index)
  if (at === -1) return {}
  /** 中文说明：视图局部值 解构结果，由紧邻初始化决定。 */
  let tool: TableRecord | undefined
  if (record.cell.kind === 'subtool') {
    /** 中文说明：视图局部值 i，由紧邻初始化决定。 */
    for (let i = at - 1; i >= 0; i--) {
      /** 中文说明：视图局部值 candidate，由紧邻初始化决定。 */
      const candidate = records[i]
      if (
        candidate === undefined
        || candidate.turn !== record.turn
        || candidate.group !== record.group
      ) break
      if (candidate.cell.kind === 'tool') {
        tool = candidate
        break
      }
    }
  }
  /** 中文说明：视图局部值 parentCallId，由紧邻初始化决定。 */
  const parentCallId = tool?.cell.callId ?? record.cell.callId
  /** 中文说明：视图局部值 解构结果，由紧邻初始化决定。 */
  let message: TableRecord | undefined
  if (parentCallId !== undefined) {
    message = records.find(candidate =>
      candidate.turn === record.turn
      && candidate.cell.kind === 'message'
      && candidate.cell.sourceBlocks?.some(block => block.callId === parentCallId) === true,
    )
  }
  return { ...(message === undefined ? {} : { message }), ...(tool === undefined ? {} : { tool }) }
}

/** 中文说明：函数 markdownSource 的参数见签名，返回结果供展示流程使用；示例见本文件。 */
function markdownSource(record: TableRecord): string | undefined {
  if (record.cell.kind === 'user' || record.cell.kind === 'context') {
    return record.cell.inputDetail
  }
  if (record.cell.kind === 'message' || record.cell.kind === 'compacted') {
    return record.cell.outputDetail
  }
  return undefined
}

/** 中文说明：函数 detailTabs 的参数见签名，返回结果供展示流程使用；示例见本文件。 */
function detailTabs(record: TableRecord): readonly DetailTabItem[] {
  if (record.cell.kind === 'system') {
    return record.cell.previousPromptDetail === undefined
      ? SYSTEM_PROMPT_TABS
      : SYSTEM_UPDATE_TABS
  }
  if (record.cell.kind === 'compacted') {
    return [
      { id: 'overview', label: 'Summary' },
      { id: 'raw', label: 'Raw Output' },
    ]
  }
  if (isMarkdownRecord(record)) {
    return [
      { id: 'overview', label: 'Summary' },
      { id: 'rendered', label: 'Preview' },
      { id: 'raw', label: 'Raw' },
      ...(record.cell.messageSource === undefined
        ? []
        : [{ id: 'source', label: 'Source' } as const]),
    ]
  }
  return [
    { id: 'overview', label: 'Summary' },
    ...(record.cell.inputDetail ? [{ id: 'input', label: 'Payload' } as const] : []),
    ...(record.cell.outputDetail ? [{ id: 'output', label: 'Result' } as const] : []),
    { id: 'schema', label: 'Schema' },
    { id: 'timing', label: 'Timing' },
  ]
}

/** 中文说明：函数 recordDisplayText 的参数见签名，返回结果供展示流程使用；示例见本文件。 */
function recordDisplayText(cell: TrajectoryCellProps): string {
  if (isToolCallOnly(cell)) return ''
  if (cell.previewMarkdown !== undefined) {
    /** 中文说明：视图局部值 preview，由紧邻初始化决定。 */
    const preview = trajectoryPreviewText(cell.previewMarkdown)
    if (cell.text === '') return preview
    return preview === '' ? cell.text : `${cell.text} · ${preview}`
  }
  if (cell.text !== '') return cell.text
  /** 中文说明：视图局部值 markdown，由紧邻初始化决定。 */
  const markdown = cell.kind === 'user' || cell.kind === 'context'
    ? cell.inputDetail
    : cell.kind === 'message'
      ? cell.outputDetail ?? cell.thinkingDetail
      : undefined
  return markdown === undefined ? '' : trajectoryPreviewText(markdown)
}

/** 中文说明：函数 recordResultText 的参数见签名，返回结果供展示流程使用；示例见本文件。 */
function recordResultText(cell: TrajectoryCellProps): string | undefined {
  return cell.resultPreviewMarkdown === undefined
    ? cell.result
    : trajectoryPreviewText(cell.resultPreviewMarkdown)
}

/** 中文说明：函数 toolCallTextParts 的参数见签名，返回结果供展示流程使用；示例见本文件。 */
function toolCallTextParts(
  kind: TrajectoryCellKind,
  text: string,
): ToolCallTextParts | undefined {
  if (kind !== 'tool' && kind !== 'subtool') return undefined
  /** 中文说明：视图局部值 separator，由紧邻初始化决定。 */
  const separator = text.indexOf(' · ')
  if (separator === -1) return { name: text }
  return {
    name: text.slice(0, separator),
    args: text.slice(separator + 3),
  }
}

/** 中文说明：函数 isToolCallOnly 的参数见签名，返回结果供展示流程使用；示例见本文件。 */
function isToolCallOnly(cell: TrajectoryCellProps): boolean {
  return cell.kind === 'message'
    && !cell.outputDetail
    && !cell.thinkingDetail
    && cell.text === 'Tool call only'
}

/** 中文说明：类型或类 RecordPresentationValue 约束工具或轨迹数据职责。 */
interface RecordPresentationValue {
  displayText: string
  listDisplayText: string
  resultText: string | undefined
  toolCallOnly: boolean
  toolCallText: ToolCallTextParts | undefined
}

/** 中文说明：函数 RecordPresentation 的参数见签名，返回结果供展示流程使用；示例见本文件。 */
function RecordPresentation({
  cell,
  children,
}: {
  cell: TrajectoryCellProps
  children: (value: RecordPresentationValue) => ReactNode
}) {
  /** 中文说明：视图局部值 displayText，由紧邻初始化决定。 */
  const displayText = useMemo(
    () => recordDisplayText(cell),
    [
      cell.kind, cell.text, cell.previewMarkdown,
      cell.inputDetail, cell.outputDetail, cell.thinkingDetail,
    ],
  )
  /** 中文说明：视图局部值 resultText，由紧邻初始化决定。 */
  const resultText = useMemo(
    () => recordResultText(cell),
    [cell.result, cell.resultPreviewMarkdown],
  )
  /** 中文说明：视图局部值 toolCallOnly，由紧邻初始化决定。 */
  const toolCallOnly = isToolCallOnly(cell)
  /** 中文说明：视图局部值 toolCallText，由紧邻初始化决定。 */
  const toolCallText = toolCallTextParts(cell.kind, displayText)
  /** 中文说明：视图局部值 listDisplayText，由紧邻初始化决定。 */
  const listDisplayText = toolCallOnly
    ? '(tool call only)'
    : toolCallText === undefined
      ? displayText
      : [toolCallText.name, toolCallText.args].filter(Boolean).join(' ')
  return children({
    displayText,
    listDisplayText,
    resultText,
    toolCallOnly,
    toolCallText,
  })
}

/** 中文说明：函数 RecordListText 的参数见签名，返回结果供展示流程使用；示例见本文件。 */
function RecordListText({
  displayText,
  toolCallOnly,
  toolCallText,
}: Pick<RecordPresentationValue, 'displayText' | 'toolCallOnly' | 'toolCallText'>) {
  if (toolCallOnly) {
    return <span className={css.toolCallOnly}>(tool call only)</span>
  }
  if (toolCallText === undefined) return displayText || '—'
  return (
    <>
      <span className={css.toolCallNameTypeface}>
        {toolCallText.name || '—'}
      </span>
      {toolCallText.args !== undefined && (
        <span className={css.toolCallPayload}>
          {toolCallText.args}
        </span>
      )}
    </>
  )
}

/** 中文说明：函数 MarkdownFragment 的参数见签名，返回结果供展示流程使用；示例见本文件。 */
function MarkdownFragment({
  text,
  rendered,
  preview,
}: {
  text: string
  rendered: boolean
  preview: boolean
}) {
  if (rendered) {
    return (
      <div className={preview ? css.markdownPreview : css.markdownPayload}>
        <MarkdownText text={text} />
      </div>
    )
  }
  return (
    <pre className={`${css.payload} ${preview ? css.payloadPreview : ''}`}>
      {text}
    </pre>
  )
}

/** 中文说明：函数 SourceBlocks 的参数见签名，返回结果供展示流程使用；示例见本文件。 */
function SourceBlocks({
  blocks,
  onOpenCall,
}: {
  blocks: readonly TrajectorySourceBlock[]
  onOpenCall: (callId: string) => void
}) {
  return (
    <div className={css.sourceBlocks}>
      {blocks.map((block, index) => (
        <section className={css.sourceBlock} key={index}>
          {block.callId !== undefined
            ? (
              <button
                type="button"
                className={css.sourceBlockJumpTarget}
                aria-label={`Open Block #${index + 1} tool call summary`}
                title="Open tool call summary"
                onClick={() => {
                  if (block.callId !== undefined) onOpenCall(block.callId)
                }}
              >
                <span className={css.sourceBlockLabel}>
                  {`Block #${index + 1} ${block.type}`}
                </span>
                <IconChevronRightOutline14 className={css.sourceBlockJumpIcon} size={12} />
              </button>
            )
            : (
              <div className={css.sourceBlockHeader}>
                <span className={css.sourceBlockLabel}>
                  {`Block #${index + 1} ${block.type}`}
                </span>
              </div>
            )}
          {block.imageSrc !== undefined
            ? <PanelImage block={block} />
            : <pre className={css.sourceBlockContent}>{block.content}</pre>}
        </section>
      ))}
    </div>
  )
}

/** 中文说明：函数 PanelImage 的参数见签名，返回结果供展示流程使用；示例见本文件。 */
function PanelImage({
  block,
  preview = false,
}: {
  block: TrajectorySourceBlock
  preview?: boolean
}) {
  if (block.imageSrc === undefined) return null
  return (
    <a
      className={preview ? `${css.panelImageLink} ${css.panelImageLinkPreview}` : css.panelImageLink}
      href={block.imageSrc}
      target="_blank"
      rel="noopener noreferrer"
      title="Open image"
    >
      <img
        className={css.panelImage}
        src={block.imageSrc}
        alt={block.imageAlt ?? ''}
      />
    </a>
  )
}

/** 中文说明：函数 MessageImages 的参数见签名，返回结果供展示流程使用；示例见本文件。 */
function MessageImages({
  blocks,
  preview,
}: {
  blocks: readonly TrajectorySourceBlock[] | undefined
  preview: boolean
}) {
  /** 中文说明：视图局部值 images，由紧邻初始化决定。 */
  const images = blocks?.filter(block => block.imageSrc !== undefined) ?? []
  if (images.length === 0) return null
  return (
    <div className={preview ? `${css.messageImages} ${css.messageImagesPreview}` : css.messageImages}>
      {images.map((block, index) => <PanelImage block={block} preview={preview} key={index} />)}
    </div>
  )
}

/** 中文说明：函数 AssistantToolCalls 的参数见签名，返回结果供展示流程使用；示例见本文件。 */
function AssistantToolCalls({
  blocks,
  preview,
  onOpenCall,
}: {
  blocks: readonly TrajectorySourceBlock[] | undefined
  preview: boolean
  onOpenCall: (callId: string) => void
}) {
  /** 中文说明：视图局部值 calls，由紧邻初始化决定。 */
  const calls = blocks?.filter(block => block.type === 'tool-call') ?? []
  if (calls.length === 0) return null
  return (
    <ul className={preview
      ? `${css.assistantToolCalls} ${css.assistantToolCallsPreview}`
      : css.assistantToolCalls}
    >
      {calls.map((call, index) => (
        <li key={call.callId ?? index}>
          <button
            type="button"
            className={css.assistantToolCallButton}
            title="Open tool call summary"
            onClick={() => {
              if (call.callId !== undefined) onOpenCall(call.callId)
            }}
          >
            <svg
              className={css.assistantToolCallIcon}
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94z"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span className={css.assistantToolCallText}>
              <span className={css.assistantToolCallName}>
                {call.toolName ?? 'tool-call'}
              </span>
              {call.content !== '' && (
                <span className={css.assistantToolCallArgs}>{call.content}</span>
              )}
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}

/** 中文说明：函数 ToolGlyph 的参数见签名，返回结果供展示流程使用；示例见本文件。 */
function ToolGlyph() {
  return (
    <svg
      className={css.toolCatalogIcon}
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** 中文说明：函数 ToolCatalog 的参数见签名，返回结果供展示流程使用；示例见本文件。 */
function ToolCatalog({ tools }: { tools: ConversationPromptSnapshot['tools'] }) {
  if (tools.length === 0) return <p className={css.noPayload}>No tools in this request</p>
  return (
    <div className={css.toolCatalog}>
      {tools.map((tool, index) => (
        <details className={css.toolCatalogItem} key={`${tool.name}:${index}`}>
          <summary className={css.toolCatalogSummary}>
            <IconChevronRightOutline14 className={css.toolCatalogChevron} size={12} />
            <ToolGlyph />
            <span className={css.toolCatalogName}>{tool.name}</span>
            <span className={css.toolCatalogDescription}>{tool.description}</span>
          </summary>
          <div className={css.toolCatalogDefinition}>
            {tool.description !== '' && (
              <p className={css.toolCatalogFullDescription}>{tool.description}</p>
            )}
            <JsonTree
              data={tool.parameters}
              label={`${tool.name} parameters JSON`}
              className={css.toolCatalogTree}
            />
          </div>
        </details>
      ))}
    </div>
  )
}

/** 中文说明：类型或类 PromptDiffLine 约束工具或轨迹数据职责。 */
interface PromptDiffLine {
  kind: 'meta' | 'context' | 'added' | 'removed'
  text: string
}

/** 中文说明：函数 promptDiffLines 的参数见签名，返回结果供展示流程使用；示例见本文件。 */
function promptDiffLines(before: string, after: string): readonly PromptDiffLine[] {
  /** 中文说明：视图局部值 patch，由紧邻初始化决定。 */
  const patch = structuredPatch('', '', before, after, undefined, undefined, { context: 3 })
  return patch.hunks.flatMap((hunk, hunkIndex) => [
    ...(hunkIndex === 0 ? [] : [{ kind: 'meta' as const, text: '' }]),
    {
      kind: 'meta' as const,
      text: `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`,
    },
    ...hunk.lines.flatMap((line): PromptDiffLine[] => {
      if (line.startsWith('\\')) return []
      if (line.startsWith('+')) return [{ kind: 'added', text: line }]
      if (line.startsWith('-')) return [{ kind: 'removed', text: line }]
      return [{ kind: 'context', text: line }]
    }),
  ])
}

/** 中文说明：函数 PromptDiffSection 的参数见签名，返回结果供展示流程使用；示例见本文件。 */
function PromptDiffSection({
  title,
  before,
  after,
}: {
  title: string
  before: string
  after: string
}) {
  /** 中文说明：视图局部值 lines，由紧邻初始化决定。 */
  const lines = promptDiffLines(before, after)
  if (lines.length === 0) return null
  return (
    <section className={css.promptDiffSection}>
      <h3 className={css.promptDiffTitle}>{title}</h3>
      <pre className={css.promptDiff}>
        {lines.map((line, index) => (
          <span className={css[`promptDiffLine${line.kind}`]} key={index}>
            {line.text || ' '}
            {'\n'}
          </span>
        ))}
      </pre>
    </section>
  )
}

/** 中文说明：函数 SystemPromptDiff 的参数见签名，返回结果供展示流程使用；示例见本文件。 */
function SystemPromptDiff({
  before,
  after,
}: {
  before: ConversationPromptSnapshot
  after: ConversationPromptSnapshot
}) {
  /** 中文说明：视图局部值 toolsBefore，由紧邻初始化决定。 */
  const toolsBefore = JSON.stringify(before.tools, null, 2)
  /** 中文说明：视图局部值 toolsAfter，由紧邻初始化决定。 */
  const toolsAfter = JSON.stringify(after.tools, null, 2)
  return (
    <div className={css.promptDiffSections}>
      {before.system !== after.system && (
        <PromptDiffSection
          title="System Prompt"
          before={before.system}
          after={after.system}
        />
      )}
      {toolsBefore !== toolsAfter && (
        <PromptDiffSection
          title="Tools"
          before={toolsBefore}
          after={toolsAfter}
        />
      )}
    </div>
  )
}

/** 中文说明：函数 ToolOutputBlocks 的参数见签名，返回结果供展示流程使用；示例见本文件。 */
function ToolOutputBlocks({
  blocks,
  error,
  preview,
}: {
  blocks: readonly TrajectorySourceBlock[]
  error: boolean
  preview: boolean
}) {
  return (
    <div className={[
      css.resultBlocks,
      preview ? css.resultBlocksPreview : undefined,
      error ? css.errorPayload : undefined,
    ].filter((value): value is string => value !== undefined).join(' ')}
    >
      {blocks.map((block, index) => (
        block.imageSrc !== undefined
          ? <PanelImage block={block} preview={preview} key={index} />
          : block.content !== ''
            ? <pre className={css.resultBlockText} key={index}>{block.content}</pre>
            : null
      ))}
    </div>
  )
}

/** 中文说明：函数 MarkdownRecordContent 的参数见签名，返回结果供展示流程使用；示例见本文件。 */
function MarkdownRecordContent({
  record,
  rendered,
  preview = false,
  thinkingExpanded,
  onThinkingExpandedChange,
  onOpenCall,
}: {
  record: TableRecord
  rendered: boolean
  preview?: boolean
  thinkingExpanded: boolean
  onThinkingExpandedChange: (expanded: boolean) => void
  onOpenCall: (callId: string) => void
}) {
  if (!rendered && record.cell.sourceBlocks && record.cell.sourceBlocks.length > 0) {
    return <SourceBlocks blocks={record.cell.sourceBlocks} onOpenCall={onOpenCall} />
  }
  if (record.cell.thinkingDetail) {
    if (!rendered) {
      /** 中文说明：视图局部值 source，由紧邻初始化决定。 */
      const source = [
        record.cell.thinkingDetail,
        record.cell.outputDetail,
      ].filter((value): value is string => value !== undefined && value !== '').join('\n\n')
      return <MarkdownFragment text={source} rendered={false} preview={preview} />
    }
    return (
      <div className={`${css.assistantContent} ${css.assistantContentRendered}`}>
        <div className={
          preview && !record.cell.outputDetail
            ? `${css.thinkingQuote} ${css.thinkingQuoteOnlyPreview}`
            : css.thinkingQuote
        }
        >
          <button
            type="button"
            className={css.thinkingToggle}
            aria-expanded={thinkingExpanded}
            onClick={() => { onThinkingExpandedChange(!thinkingExpanded) }}
          >
            Thinking
            <IconChevronRightOutline14 className={css.thinkingChevron} size={12} />
          </button>
          {thinkingExpanded && (
            <MarkdownFragment
              text={record.cell.thinkingDetail}
              rendered={rendered}
              preview={preview}
            />
          )}
        </div>
        {record.cell.outputDetail && (
          <div className={css.assistantOutput}>
            <MarkdownFragment
              text={record.cell.outputDetail}
              rendered={rendered}
              preview={preview}
            />
          </div>
        )}
        <AssistantToolCalls
          blocks={record.cell.sourceBlocks}
          preview={preview}
          onOpenCall={onOpenCall}
        />
        <MessageImages
          blocks={record.cell.sourceBlocks}
          preview={preview}
        />
      </div>
    )
  }
  /** 中文说明：视图局部值 source，由紧邻初始化决定。 */
  const source = markdownSource(record)
  /** 中文说明：视图局部值 hasImages，由紧邻初始化决定。 */
  const hasImages = record.cell.sourceBlocks?.some(block => block.imageSrc !== undefined) === true
  /** 中文说明：视图局部值 hasToolCalls，由紧邻初始化决定。 */
  const hasToolCalls = record.cell.kind === 'message'
    && record.cell.sourceBlocks?.some(block => block.type === 'tool-call') === true
  if (!source && !hasImages && !hasToolCalls) {
    /** 中文说明：视图局部值 emptyLabel，由紧邻初始化决定。 */
    const emptyLabel = isToolCallOnly(record.cell)
      ? 'Tool call only'
      : record.cell.text || 'No content'
    return <p className={css.noPayload}>{emptyLabel}</p>
  }
  if (!rendered || (!hasImages && !hasToolCalls)) {
    return <MarkdownFragment text={source ?? ''} rendered={rendered} preview={preview} />
  }
  return (
    <div>
      {source && <MarkdownFragment text={source} rendered preview={preview} />}
      {record.cell.kind === 'message' && (
        <AssistantToolCalls
          blocks={record.cell.sourceBlocks}
          preview={preview}
          onOpenCall={onOpenCall}
        />
      )}
      <MessageImages blocks={record.cell.sourceBlocks} preview={preview} />
    </div>
  )
}

/** 中文说明：函数 RecordTiming 的参数见签名，返回结果供展示流程使用；示例见本文件。 */
function RecordTiming({ record }: { record: TableRecord }) {
  return record.cell.kind === 'message' && record.cell.assistantMetrics !== undefined
    ? <AssistantTimingPanel metrics={record.cell.assistantMetrics} />
    : (
      <dl className={css.overview}>
        <div><dt>Started</dt><StartedAtValue timestamp={record.cell.startedAt ?? null} /></div>
        <div><dt>Duration</dt><dd>{formatElapsedSeconds(record.cell.timeSeconds)}</dd></div>
        <div><dt>Timing source</dt><dd>{record.cell.timeSeconds === null ? 'Not available' : 'Session timestamps'}</dd></div>
      </dl>
    )
}

/** 中文说明：函数 RequestTiming 的参数见签名，返回结果供展示流程使用；示例见本文件。 */
function RequestTiming({
  assistant,
  anchor,
  request,
}: {
  assistant: TableRecord | undefined
  anchor: TableRecord | undefined
  request: TrajectoryRequestNumber | undefined
}) {
  if (assistant !== undefined) return <RecordTiming record={assistant} />
  if (request?.startedAt !== undefined) {
    /** 中文说明：视图局部值 duration，由紧邻初始化决定。 */
    const duration = request.completedAt === null || request.completedAt === undefined
      ? null
      : Math.max(0, (request.completedAt - request.startedAt) / 1000)
    return (
      <dl className={css.overview}>
        <div><dt>Started</dt><StartedAtValue timestamp={request.startedAt} /></div>
        <div><dt>Duration</dt><dd>{formatElapsedSeconds(duration)}</dd></div>
        <div>
          <dt>Timing source</dt>
          <dd>{duration === null ? 'Session timestamps (running)' : 'Session timestamps'}</dd>
        </div>
      </dl>
    )
  }
  return (
    <dl className={css.overview}>
      <div>
        <dt>Started</dt>
        <StartedAtValue timestamp={anchor?.cell.startedAt ?? null} />
      </div>
      <div><dt>Duration</dt><dd>{formatElapsedSeconds(null)}</dd></div>
    </dl>
  )
}

/** 中文说明：函数 RecordPayload 的参数见签名，返回结果供展示流程使用；示例见本文件。 */
function RecordPayload({
  record,
  direction,
  preview = false,
}: {
  record: TableRecord
  direction: 'input' | 'output'
  preview?: boolean
}) {
  /** 中文说明：视图局部值 value，由紧邻初始化决定。 */
  const value = direction === 'input' ? record.cell.inputDetail : record.cell.outputDetail
  /** 中文说明：视图局部值 missing，由紧邻初始化决定。 */
  const missing = direction === 'input'
    ? 'No payload captured'
    : 'No result captured'
  if (!value) return <p className={css.noPayload}>{missing}</p>
  /** 中文说明：视图局部值 error，由紧邻初始化决定。 */
  const error = direction === 'output' && record.cell.isError === true
  /** 中文说明：视图局部值 payloadClass，由紧邻初始化决定。 */
  const payloadClass = preview ? css.jsonPreview : css.jsonPayload
  /** 中文说明：视图局部值 payloadClassName，由紧邻初始化决定。 */
  const payloadClassName = error ? `${payloadClass} ${css.errorPayload}` : payloadClass

  /** 中文说明：视图局部值 json，由紧邻初始化决定。 */
  const json = parseJsonContainer(value)
  /** 中文说明：视图局部值 singleTextResult，由紧邻初始化决定。 */
  const singleTextResult = direction === 'output'
    && record.cell.outputBlocks?.length === 1
    && record.cell.outputBlocks[0]?.type === 'text'
  if (singleTextResult && json !== undefined) {
    return (
      <JsonTree
        data={json}
        label="Result JSON"
        className={payloadClassName}
      />
    )
  }

  if (
    direction === 'output'
    && record.cell.outputBlocks?.some(block =>
      block.imageSrc !== undefined || block.content !== '') === true
  ) {
    return (
      <ToolOutputBlocks
        blocks={record.cell.outputBlocks}
        error={error}
        preview={preview}
      />
    )
  }

  /** 中文说明：视图局部值 markdown，由紧邻初始化决定。 */
  const markdown = (
    direction === 'input'
    && (record.cell.kind === 'user' || record.cell.kind === 'context')
  ) || (
    direction === 'output' && record.cell.kind === 'message'
  )
  if (markdown) {
    return (
      <div className={[
        preview ? css.markdownPreview : css.markdownPayload,
        error ? css.errorPayload : undefined,
      ].filter((className): className is string => className !== undefined).join(' ')}
      >
        <MarkdownText text={value} />
      </div>
    )
  }
  if (json !== undefined) {
    return (
      <JsonTree
        data={json}
        label={`${direction === 'input' ? 'Payload' : 'Result'} JSON`}
        className={payloadClassName}
      />
    )
  }
  return (
    <pre className={[
      css.payload,
      preview ? css.payloadPreview : undefined,
      error ? css.errorPayload : undefined,
      value === 'No output' ? css.noOutputText : undefined,
    ].filter((value): value is string => value !== undefined).join(' ')}
    >
      {value}
    </pre>
  )
}

/** 中文说明：函数 RecordSchema 的参数见签名，返回结果供展示流程使用；示例见本文件。 */
function RecordSchema({
  record,
  preview = false,
}: {
  record: TableRecord
  preview?: boolean
}) {
  if (!record.cell.schemaDetail) {
    return <p className={css.noPayload}>Schema unavailable</p>
  }
  /** 中文说明：视图局部值 schema，由紧邻初始化决定。 */
  const schema = parseToolSchema(record.cell.schemaDetail)
  if (schema !== undefined) {
    return (
      <div className={preview ? `${css.schema} ${css.schemaPreview}` : css.schema}>
        <header className={css.schemaIntro}>
          <h3 className={css.schemaName}>{schema.name}</h3>
          <p className={css.schemaDescription}>{schema.description}</p>
        </header>
        <section className={css.schemaParameters}>
          <h4 className={css.schemaParametersTitle}>Parameters</h4>
          <JsonTree
            data={schema.parameters}
            label={`${schema.name} parameters JSON`}
            className={css.schemaTree}
          />
        </section>
      </div>
    )
  }
  return (
    <pre className={`${css.payload} ${preview ? css.payloadPreview : ''}`}>
      {record.cell.schemaDetail}
    </pre>
  )
}

/** 中文说明：类型或类 ParsedToolSchema 约束工具或轨迹数据职责。 */
interface ParsedToolSchema {
  name: string
  description: string
  parameters: object
}

/** 中文说明：函数 parseToolSchema 的参数见签名，返回结果供展示流程使用；示例见本文件。 */
function parseToolSchema(value: string): ParsedToolSchema | undefined {
  try {
    /** 中文说明：视图局部值 parsed，由紧邻初始化决定。 */
    const parsed: unknown = JSON.parse(value)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined
    /** 中文说明：视图局部值 schema，由紧邻初始化决定。 */
    const schema = parsed as Record<string, unknown>
    if (
      typeof schema.name !== 'string'
      || typeof schema.description !== 'string'
      || typeof schema.parameters !== 'object'
      || schema.parameters === null
      || Array.isArray(schema.parameters)
    ) return undefined
    return {
      name: schema.name,
      description: schema.description,
      parameters: schema.parameters,
    }
  } catch {
    return undefined
  }
}

/** 中文说明：函数 parseJsonContainer 的参数见签名，返回结果供展示流程使用；示例见本文件。 */
function parseJsonContainer(value: string): object | undefined {
  try {
    /** 中文说明：视图局部值 parsed，由紧邻初始化决定。 */
    const parsed: unknown = JSON.parse(value)
    return typeof parsed === 'object' && parsed !== null ? parsed : undefined
  } catch {
    return undefined
  }
}

/** 中文说明：函数 OverviewSection 的参数见签名，返回结果供展示流程使用；示例见本文件。 */
function OverviewSection({
  label,
  onOpen,
  children,
}: {
  label: string
  onOpen: () => void
  children: ReactNode
}) {
  return (
    <section className={css.overviewSection}>
      <h3 className={css.overviewHeading}>
        <button
          type="button"
          className={css.overviewTitle}
          onClick={onOpen}
        >
          <span>{label}</span>
          <IconChevronRightOutline14 className={css.overviewTitleIcon} size={12} />
        </button>
      </h3>
      <div
        className={`${css.overviewPreview} ${css.summaryScrollRegion}`}
        data-summary-scroll-region=""
      >
        {children}
      </div>
    </section>
  )
}

/**
 * Render trajectory events as a dense ledger with turn and step separators.
 * Clicking ledger whitespace clears the active record or request selection.
 * @param props - Grouped trajectory data and whole-ledger fold state.
 * @returns The ledger and an optional local record inspector.
 */
/** 中文说明：函数 TrajectoryTable 的参数见签名，返回结果供展示流程使用；示例见本文件。 */
export function TrajectoryTable({
  requestNumbers: sessionRequestNumbers,
  turns,
  streamingCells = [],
  timelineFocusIndexes = null,
  searchMatchIndexes = null,
  onSelectedIndexChange,
  onRecordSelect,
  recordSelection = null,
  recordFocus = null,
  historyLoading = false,
  olderHistoryLoading = false,
  historyStartSeq,
  hasOlderRecords = false,
  onLoadOlder,
  onClearSelection,
  collapsedTurns,
  onToggleTurn,
  collapsedAssistants,
  onToggleAssistant,
  inspectCallId = null,
  onInspectApplied,
}: TrajectoryTableProps) {
  /** 中文说明：视图局部值 解构结果，由紧邻初始化决定。 */
  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(null)
  /** 中文说明：视图局部值 解构结果，由紧邻初始化决定。 */
  const [selectedRequest, setSelectedRequest] = useState<SelectedRequest | null>(null)
  /** 中文说明：视图局部值 [activeTab, setActiveTab]，由紧邻初始化决定。 */
  const [activeTab, setActiveTab] = useState<DetailTab>('overview')
  /** 中文说明：视图局部值 解构结果，由紧邻初始化决定。 */
  const [thinkingExpanded, setThinkingExpanded] = useState(false)
  /** 中文说明：视图局部值 解构结果，由紧邻初始化决定。 */
  const [detailsWidth, setDetailsWidth] = useState<number | null>(null)
  /** 中文说明：视图局部值 解构结果，由紧邻初始化决定。 */
  const [toolRequestOffset, setToolRequestOffset] = useState<number | null>(null)
  /** 中文说明：视图局部值 detailsResizeDrag，由紧邻初始化决定。 */
  const detailsResizeDrag = useRef<DetailsResizeDrag | null>(null)
  /** 中文说明：视图局部值 appliedRecordSelection，由紧邻初始化决定。 */
  const appliedRecordSelection = useRef<TrajectoryTableProps['recordSelection']>(null)
  /** 中文说明：视图局部值 appliedRecordFocus，由紧邻初始化决定。 */
  const appliedRecordFocus = useRef<TrajectoryTableProps['recordFocus']>(null)
  /** 中文说明：视图局部值 tabHistory，由紧邻初始化决定。 */
  const tabHistory = useRef<Set<DetailTab>>(new Set(['overview']))
  /** 中文说明：视图局部值 rootRef，由紧邻初始化决定。 */
  const rootRef = useRef<HTMLDivElement>(null)
  /** 中文说明：视图局部值 tablePaneRef，由紧邻初始化决定。 */
  const tablePaneRef = useRef<HTMLDivElement>(null)
  /** 中文说明：视图局部值 followsTableTail，由紧邻初始化决定。 */
  const followsTableTail = useRef(false)
  /** 中文说明：视图局部值 tableScrollInitialized，由紧邻初始化决定。 */
  const tableScrollInitialized = useRef(false)
  /** 中文说明：视图局部值 解构结果，由紧邻初始化决定。 */
  const [tableScrollReady, setTableScrollReady] = useState(false)
  /** 中文说明：视图局部值 pendingScrollRecordId，由紧邻初始化决定。 */
  const pendingScrollRecordId = useRef<string | null>(null)
  /** 中文说明：视图局部值 loadingOlder，由紧邻初始化决定。 */
  const loadingOlder = useRef(false)
  /** 中文说明：视图局部值 解构结果，由紧邻初始化决定。 */
  const [olderLoading, setOlderLoading] = useState(false)
  /** 中文说明：视图局部值 olderLoadAnchor，由紧邻初始化决定。 */
  const olderLoadAnchor = useRef<OlderLoadAnchor | null>(null)
  /** 中文说明：视图局部值 allRecords，由紧邻初始化决定。 */
  const allRecords = useMemo(() => flattenRecords(turns), [turns])
  /** 中文说明：视图局部值 streamingCellsByIndex，由紧邻初始化决定。 */
  const streamingCellsByIndex = useMemo(
    () => new Map(streamingCells.map(cell => [cell.index, cell])),
    [streamingCells],
  )
  /** 中文说明：视图局部值 currentRecord，由紧邻初始化决定。 */
  const currentRecord = useCallback((record: TableRecord): TableRecord => {
    /** 中文说明：视图局部值 cell，由紧邻初始化决定。 */
    const cell = streamingCellsByIndex.get(record.cell.index)
    return cell === undefined ? record : { ...record, cell }
  }, [streamingCellsByIndex])
  /** 中文说明：视图局部值 selectedTemplate，由紧邻初始化决定。 */
  const selectedTemplate = useMemo(() => selectedRecordId === null
    ? undefined
    : allRecords.find(record => trajectoryRecordId(record.cell) === selectedRecordId),
  [allRecords, selectedRecordId])
  /** 中文说明：视图局部值 selected，由紧邻初始化决定。 */
  const selected = selectedTemplate === undefined
    ? undefined
    : currentRecord(selectedTemplate)
  /** 中文说明：视图局部值 selectedIndex，由紧邻初始化决定。 */
  const selectedIndex = selected?.cell.index ?? null
  useEffect(() => {
    onSelectedIndexChange?.(selectedIndex)
  }, [onSelectedIndexChange, selectedIndex])
  /** 中文说明：视图局部值 requestBoundaries，由紧邻初始化决定。 */
  const requestBoundaries = useMemo(() => indexRequestBoundaries(allRecords), [allRecords])
  /** 中文说明：视图局部值 requestNumbers，由紧邻初始化决定。 */
  const requestNumbers = useMemo(
    () => indexRequestNumbers(allRecords, sessionRequestNumbers, requestBoundaries),
    [allRecords, requestBoundaries, sessionRequestNumbers],
  )
  /** 中文说明：视图局部值 records，由紧邻初始化决定。 */
  const records = useMemo(() => {
    if (searchMatchIndexes !== null) return filterRecords(allRecords, searchMatchIndexes)
    /** 中文说明：视图局部值 turnRecords，由紧邻初始化决定。 */
    const turnRecords = collapsedTurns.size === 0
      ? allRecords
      : collapseTurnRecords(allRecords, collapsedTurns)
    return collapsedAssistants.size === 0
      ? turnRecords
      : collapseAssistantRecords(turnRecords, collapsedAssistants)
  }, [allRecords, collapsedAssistants, collapsedTurns, searchMatchIndexes])
  /** 中文说明：视图局部值 projectedVirtualRows，由紧邻初始化决定。 */
  const projectedVirtualRows = useMemo(
    () => groupTrajectoryVirtualRows(records),
    [records],
  )
  /** 中文说明：视图局部值 virtualRowStructure，由紧邻初始化决定。 */
  const virtualRowStructure = useStableVirtualRowStructure(projectedVirtualRows)
  /** 中文说明：视图局部值 virtualizationEnabled，由紧邻初始化决定。 */
  const virtualizationEnabled = hasOlderRecords
    || records.length > VIRTUALIZATION_THRESHOLD
  /** 中文说明：视图局部值 virtualScrollMargin，由紧邻初始化决定。 */
  const virtualScrollMargin = hasOlderRecords ? HISTORY_LOAD_ROW_HEIGHT_PX : 0
  /** 中文说明：视图局部值 estimateVirtualRowSize，由紧邻初始化决定。 */
  const estimateVirtualRowSize = useCallback(
    (index: number) => virtualRowStructure[index]?.height ?? 30,
    [virtualRowStructure],
  )
  /** 中文说明：视图局部值 getVirtualRowKey，由紧邻初始化决定。 */
  const getVirtualRowKey = useCallback(
    (index: number) => virtualRowStructure[index]?.key ?? index,
    [virtualRowStructure],
  )
  /** 中文说明：视图局部值 getTableScrollElement，由紧邻初始化决定。 */
  const getTableScrollElement = useCallback(() => tablePaneRef.current, [])
  /** 中文说明：视图局部值 rowVirtualizer，由紧邻初始化决定。 */
  const rowVirtualizer = useVirtualizer<HTMLDivElement, HTMLTableRowElement>({
    count: virtualizationEnabled ? virtualRowStructure.length : 0,
    enabled: virtualizationEnabled,
    estimateSize: estimateVirtualRowSize,
    getItemKey: getVirtualRowKey,
    getScrollElement: getTableScrollElement,
    initialRect: { width: 0, height: VIRTUAL_INITIAL_VIEWPORT_HEIGHT_PX },
    anchorTo: 'end',
    overscan: VIRTUAL_OVERSCAN_ROWS,
    scrollMargin: virtualScrollMargin,
    scrollEndThreshold: BOTTOM_FOLLOW_THRESHOLD_PX,
  })
  /** 中文说明：视图局部值 virtualIndexByRecordId，由紧邻初始化决定。 */
  const virtualIndexByRecordId = useMemo(() => {
    /** 中文说明：视图局部值 indexes，由紧邻初始化决定。 */
    const indexes = new Map<string, number>()
    /** 中文说明：视图局部值 [virtualIndex，由紧邻初始化决定。 */
    for (const [virtualIndex, row] of projectedVirtualRows.entries()) {
      /** 中文说明：视图局部值 entry，由紧邻初始化决定。 */
      for (const entry of row.entries) {
        if (entry.record.collapsedSummary === undefined) {
          indexes.set(trajectoryRecordId(entry.record.cell), virtualIndex)
        }
      }
    }
    return indexes
  }, [projectedVirtualRows])
  /** 中文说明：视图局部值 virtualItems，由紧邻初始化决定。 */
  const virtualItems = virtualizationEnabled ? rowVirtualizer.getVirtualItems() : []
  /** 中文说明：视图局部值 virtualTop，由紧邻初始化决定。 */
  const virtualTop = Math.max(0, (virtualItems[0]?.start ?? 0) - virtualScrollMargin)
  /** 中文说明：视图局部值 virtualBottom，由紧邻初始化决定。 */
  const virtualBottom = virtualItems.length === 0
    ? 0
    : Math.max(
      0,
      rowVirtualizer.getTotalSize()
        + virtualScrollMargin
        - (virtualItems.at(-1)?.end ?? 0),
    )
  /** 中文说明：视图局部值 renderedRecords，由紧邻初始化决定。 */
  const renderedRecords = virtualizationEnabled
    ? virtualItems.flatMap((item) => {
      /** 中文说明：视图局部值 row，由紧邻初始化决定。 */
      const row = projectedVirtualRows[item.index]
      if (row === undefined) return []
      return row.entries.map((entry, entryIndex) => ({
        record: currentRecord(entry.record),
        position: entry.logicalIndex,
        terminalRequestBoundary:
          entry.record.cell.requestOnly === true
          && row.entries.at(-1)?.record.cell.requestOnly === true
          && entryIndex === row.entries.length - 1,
      }))
    })
    : records.map((record, position) => ({
      record: currentRecord(record),
      position,
      terminalRequestBoundary:
        record.cell.requestOnly === true && position === records.length - 1,
    }))
  /** 中文说明：视图局部值 requestBoundaryRuns，由紧邻初始化决定。 */
  const requestBoundaryRuns = useMemo(
    () => indexRequestBoundaryRuns(records),
    [records],
  )
  /** 中文说明：视图局部值 selectedPrompt，由紧邻初始化决定。 */
  const selectedPrompt = selected?.cell.kind === 'system'
    ? selected.cell.promptDetail
    : undefined
  /** 中文说明：视图局部值 selectedPreviousPrompt，由紧邻初始化决定。 */
  const selectedPreviousPrompt = selected?.cell.kind === 'system'
    ? selected.cell.previousPromptDetail
    : undefined
  /** 中文说明：视图局部值 promptSelected，由紧邻初始化决定。 */
  const promptSelected = selectedPrompt !== undefined
  /** 中文说明：视图局部值 selectedState，由紧邻初始化决定。 */
  const selectedState = selected === undefined ? undefined : stateOf(selected)
  /** 中文说明：视图局部值 解构结果，由紧邻初始化决定。 */
  const selectedRequestRecordTemplates = useMemo(() => selectedRequest === null
    ? []
    : allRecords.filter(record =>
      record.turn === selectedRequest.turn
        && record.group === selectedRequest.group,
    ), [allRecords, selectedRequest])
  /** 中文说明：视图局部值 selectedRequestRecords，由紧邻初始化决定。 */
  const selectedRequestRecords = selectedRequestRecordTemplates.map(currentRecord)
  /** 中文说明：视图局部值 selectedRequestAssistant，由紧邻初始化决定。 */
  const selectedRequestAssistant = selectedRequestRecords.find(
    record => record.cell.kind === 'message',
  )
  /** 中文说明：视图局部值 selectedRequestAnchor，由紧邻初始化决定。 */
  const selectedRequestAnchor = selectedRequestAssistant ?? selectedRequestRecords[0]
  /** 中文说明：视图局部值 selectedRequestNumber，由紧邻初始化决定。 */
  const selectedRequestNumber = selectedRequest === null
    ? undefined
    : requestNumbers.get(requestKey(selectedRequest.turn, selectedRequest.group))
  /** 中文说明：视图局部值 selectedRequestInfo，由紧邻初始化决定。 */
  const selectedRequestInfo = selectedRequest === null
    ? undefined
    : sessionRequestNumbers?.find(request => selectedRequest.seq === undefined
      ? request.turn === selectedRequest.turn && request.group === selectedRequest.group
      : request.seq === selectedRequest.seq)
  /** 中文说明：视图局部值 selectedRequestState，由紧邻初始化决定。 */
  const selectedRequestState: RecordState | undefined = selectedRequest === null
    ? undefined
    : selectedRequestInfo?.status
      ?? (selectedRequestAssistant?.cell.assistantMetrics?.completedTime === null
        ? 'running'
        : selectedRequestAssistant === undefined
          && selectedRequestRecords.some(record => stateOf(record) === 'running')
          ? 'running'
          : 'complete')
  /** 中文说明：视图局部值 selectedRequestToolCalls，由紧邻初始化决定。 */
  const selectedRequestToolCalls = selectedRequestRecords.filter(
    record => record.cell.kind === 'tool',
  ).length
  /** 中文说明：视图局部值 解构结果，由紧邻初始化决定。 */
  const selectedRequestSubtoolCalls = selectedRequestRecords.filter(
    record => record.cell.kind === 'subtool',
  ).length
  /** 中文说明：视图局部值 解构结果，由紧邻初始化决定。 */
  const selectedRequestResultTemplate = selectedRequestInfo?.resultSeq === undefined
    ? selectedRequestAssistant
    : allRecords.find(record => record.cell.sourceSeq === selectedRequestInfo.resultSeq)
  /** 中文说明：视图局部值 selectedRequestResult，由紧邻初始化决定。 */
  const selectedRequestResult = selectedRequestResultTemplate === undefined
    ? undefined
    : currentRecord(selectedRequestResultTemplate)
  /** 中文说明：视图局部值 selectedRequestUsage，由紧邻初始化决定。 */
  const selectedRequestUsage = selectedRequestInfo?.usage ?? (
    selectedRequestAssistant === undefined
      ? undefined
      : {
        ...(selectedRequestAssistant.cell.input === undefined
          ? {}
          : { input: selectedRequestAssistant.cell.input }),
        ...(selectedRequestAssistant.cell.cacheRead === undefined
          ? {}
          : { cacheRead: selectedRequestAssistant.cell.cacheRead }),
        ...(selectedRequestAssistant.cell.cacheWrite === undefined
          ? {}
          : { cacheWrite: selectedRequestAssistant.cell.cacheWrite }),
        ...(selectedRequestAssistant.cell.output === undefined
          ? {}
          : { output: selectedRequestAssistant.cell.output }),
        ...(selectedRequestAssistant.cell.think === undefined
          ? {}
          : { reasoning: selectedRequestAssistant.cell.think }),
      }
  )
  /** 中文说明：视图局部值 解构结果，由紧邻初始化决定。 */
  const selectedRequestCumulativeUsage =
    selectedRequestInfo?.cumulativeUsage ?? selectedRequestUsage
  /** 中文说明：视图局部值 selectedRequestOptions，由紧邻初始化决定。 */
  const selectedRequestOptions = selectedRequestInfo?.requestConfig
  /** 中文说明：视图局部值 activeTurn，由紧邻初始化决定。 */
  const activeTurn = selectedRequest === null ? selected?.turn : selectedRequest.turn
  /** 中文说明：视图局部值 activeSection，由紧邻初始化决定。 */
  const activeSection = selectedRequest === null
    ? selected?.section
    : selectedRequestRecords[0]?.section
  /** 中文说明：视图局部值 selectedTabs，由紧邻初始化决定。 */
  const selectedTabs = selectedRequest !== null
    ? REQUEST_TABS.filter(tab => tab.id !== 'options' || selectedRequestOptions !== undefined)
    : selected === undefined ? [] : detailTabs(selected)
  /** 中文说明：视图局部值 selectedParents，由紧邻初始化决定。 */
  const selectedParents: ParentRecords = selected === undefined
    ? {}
    : parentRecords(allRecords, selected)
  /** 中文说明：视图局部值 selectedParentMessage，由紧邻初始化决定。 */
  const selectedParentMessage = selectedParents.message
  /** 中文说明：视图局部值 selectedParentTool，由紧邻初始化决定。 */
  const selectedParentTool = selectedParents.tool
  /** 中文说明：视图局部值 selectedAssistantRequest，由紧邻初始化决定。 */
  const selectedAssistantRequest = selected?.cell.kind === 'message'
    ? requestNumbers.get(requestKey(selected.turn, selected.group))
    : undefined
  /** 中文说明：视图局部值 解构结果，由紧邻初始化决定。 */
  const selectedAssistantRequestInfo = selectedAssistantRequest === undefined
    ? undefined
    : sessionRequestNumbers?.find(request => request.number === selectedAssistantRequest)
  /** 中文说明：视图局部值 解构结果，由紧邻初始化决定。 */
  const selectedAssistantRequestTarget: SelectedRequest | undefined =
    selected !== undefined && selectedAssistantRequest !== undefined
      ? {
        turn: selected.turn,
        group: selected.group,
        ...(selectedAssistantRequestInfo?.seq === undefined
          ? {}
          : { seq: selectedAssistantRequestInfo.seq }),
      }
      : undefined
  /** 中文说明：视图局部值 hasSelectedHierarchy，由紧邻初始化决定。 */
  const hasSelectedHierarchy = selectedAssistantRequestTarget !== undefined
    || selectedParents.message !== undefined
    || selectedParents.tool !== undefined
  /** 中文说明：视图局部值 splitStyle，由紧邻初始化决定。 */
  const splitStyle: TrajectorySplitStyle | undefined = toolRequestOffset === null
    ? undefined
    : {
      '--trajectory-tool-request-width': `calc(58cqw - ${toolRequestOffset}px)`,
    }

  /** 中文说明：视图局部值 activateTab，由紧邻初始化决定。 */
  const activateTab = (tab: DetailTab) => {
    tabHistory.current.delete(tab)
    tabHistory.current.add(tab)
    setActiveTab(tab)
  }

  /** 中文说明：视图局部值 clearInspectorSelection，由紧邻初始化决定。 */
  const clearInspectorSelection = () => {
    setSelectedRecordId(null)
    setSelectedRequest(null)
  }

  /** 中文说明：视图局部值 clearAllSelections，由紧邻初始化决定。 */
  const clearAllSelections = () => {
    clearInspectorSelection()
    onClearSelection?.()
  }

  /** 中文说明：视图局部值 selectRecord，由紧邻初始化决定。 */
  const selectRecord = useCallback((index: number) => {
    /** 中文说明：视图局部值 record，由紧邻初始化决定。 */
    const record = allRecords.find(candidate => candidate.cell.index === index)
    onRecordSelect?.(index)
    setSelectedRequest(null)
    setSelectedRecordId(record === undefined ? null : trajectoryRecordId(record.cell))
    if (record === undefined) return
    /** 中文说明：视图局部值 tabs，由紧邻初始化决定。 */
    const tabs = detailTabs(record)
    /** 中文说明：视图局部值 available，由紧邻初始化决定。 */
    const available = new Set(tabs.map(tab => tab.id))
    /** 中文说明：视图局部值 recent，由紧邻初始化决定。 */
    const recent = [...tabHistory.current].reverse().find(tab => available.has(tab))
    setActiveTab(recent ?? tabs[0]?.id ?? 'overview')
  }, [allRecords, onRecordSelect])
  useEffect(() => {
    if (
      recordSelection === null
      || appliedRecordSelection.current === recordSelection
    ) return
    appliedRecordSelection.current = recordSelection
    selectRecord(recordSelection.index)
    /** 中文说明：视图局部值 record，由紧邻初始化决定。 */
    const record = allRecords.find(candidate => candidate.cell.index === recordSelection.index)
    pendingScrollRecordId.current = record === undefined
      ? null
      : trajectoryRecordId(record.cell)
  }, [allRecords, recordSelection, selectRecord])
  useEffect(() => {
    if (recordFocus === null || appliedRecordFocus.current === recordFocus) return
    appliedRecordFocus.current = recordFocus
    /** 中文说明：视图局部值 record，由紧邻初始化决定。 */
    const record = allRecords.find(candidate => candidate.cell.index === recordFocus.index)
    pendingScrollRecordId.current = record === undefined
      ? null
      : trajectoryRecordId(record.cell)
  }, [allRecords, recordFocus])

  /** 中文说明：视图局部值 selectRequest，由紧邻初始化决定。 */
  const selectRequest = (
    request: SelectedRequest,
    tab: 'overview' | 'timing' = 'overview',
  ) => {
    setSelectedRecordId(null)
    setSelectedRequest(request)
    activateTab(tab)
  }

  /** 中文说明：视图局部值 openRecordSummary，由紧邻初始化决定。 */
  const openRecordSummary = (target: TableRecord) => {
    /** 中文说明：视图局部值 targetAt，由紧邻初始化决定。 */
    const targetAt = allRecords.findIndex(record => record.cell.index === target.cell.index)
    if (target.turn !== null && collapsedTurns.has(target.turn)) onToggleTurn(target.turn)
    if (target.cell.kind === 'tool' || target.cell.kind === 'subtool') {
      /** 中文说明：视图局部值 i，由紧邻初始化决定。 */
      for (let i = targetAt - 1; i >= 0; i--) {
        /** 中文说明：视图局部值 candidate，由紧邻初始化决定。 */
        const candidate = allRecords[i]
        if (candidate === undefined || candidate.turn !== target.turn) break
        if (candidate.cell.kind !== 'message') continue
        /** 中文说明：视图局部值 assistantId，由紧邻初始化决定。 */
        const assistantId = trajectoryRecordId(candidate.cell)
        if (collapsedAssistants.has(assistantId)) onToggleAssistant(assistantId)
        break
      }
    }
    setSelectedRequest(null)
    setSelectedRecordId(trajectoryRecordId(target.cell))
    activateTab('overview')
  }

  /** 中文说明：视图局部值 openCallSummary，由紧邻初始化决定。 */
  const openCallSummary = (callId: string) => {
    /** 中文说明：视图局部值 target，由紧邻初始化决定。 */
    const target = allRecords.find(record => record.cell.callId === callId)
    if (target !== undefined) openRecordSummary(target)
  }

  // Cross-view inspect handoff: resolve the requested call to its record,
  // open its summary, and remember the row to scroll once the un-collapsed
  // ledger has rendered. Not-found leaves the request pending (`turns` in the
  // deps retries as history pages in); the ack clears the store field.
  /** 中文说明：视图局部值 openRecordSummaryRef，由紧邻初始化决定。 */
  const openRecordSummaryRef = useRef(openRecordSummary)
  openRecordSummaryRef.current = openRecordSummary
  useEffect(() => {
    if (inspectCallId === null) return
    /** 中文说明：视图局部值 target，由紧邻初始化决定。 */
    const target = flattenRecords(turns).find(record => record.cell.callId === inspectCallId)
    if (target === undefined) return
    openRecordSummaryRef.current(target)
    pendingScrollRecordId.current = trajectoryRecordId(target.cell)
    onInspectApplied?.()
  }, [inspectCallId, turns, onInspectApplied])
  useEffect(() => {
    /** 中文说明：视图局部值 id，由紧邻初始化决定。 */
    const id = pendingScrollRecordId.current
    if (id === null) return
    /** 中文说明：视图局部值 position，由紧邻初始化决定。 */
    const position = records.findIndex(record =>
      trajectoryRecordId(record.cell) === id && record.collapsedSummary === undefined)
    if (position === -1) return
    if (virtualizationEnabled) {
      /** 中文说明：视图局部值 virtualIndex，由紧邻初始化决定。 */
      const virtualIndex = virtualIndexByRecordId.get(id)
      if (virtualIndex === undefined) return
      pendingScrollRecordId.current = null
      followsTableTail.current = false
      rowVirtualizer.scrollToIndex(virtualIndex, { behavior: 'smooth', align: 'center' })
      return
    }
    pendingScrollRecordId.current = null
    followsTableTail.current = false
    /** 中文说明：视图局部值 recordIndex，由紧邻初始化决定。 */
    const recordIndex = records[position]?.cell.index
    /** 中文说明：视图局部值 row，由紧邻初始化决定。 */
    const row = recordIndex === undefined
      ? null
      : rootRef.current?.querySelector<HTMLElement>(`tr[data-record-index="${recordIndex}"]`)
    /* v8 ignore next -- jsdom lacks scrollIntoView; browsers always have it. */
    if (row !== undefined && row !== null && typeof row.scrollIntoView === 'function') {
      row.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [records, rowVirtualizer, virtualIndexByRecordId, virtualizationEnabled])
  useEffect(() => {
    if (timelineFocusIndexes === null || timelineFocusIndexes.size === 0) return
    /** 中文说明：视图局部值 focusedPositions，由紧邻初始化决定。 */
    const focusedPositions = records.flatMap((record, position) =>
      record.collapsedSummary === undefined
      && record.cell.requestOnly !== true
      && timelineFocusIndexes.has(record.cell.index)
        ? [position]
        : [])
    /** 中文说明：视图局部值 first，由紧邻初始化决定。 */
    const first = focusedPositions.at(0)
    /** 中文说明：视图局部值 last，由紧邻初始化决定。 */
    const last = focusedPositions.at(-1)
    if (first === undefined || last === undefined) return
    if (!virtualizationEnabled) {
      /** 中文说明：视图局部值 ledger，由紧邻初始化决定。 */
      const ledger = rootRef.current
      if (ledger === null) return
      /** 中文说明：视图局部值 focusedRows，由紧邻初始化决定。 */
      const focusedRows = [
        ...ledger.querySelectorAll<HTMLElement>('tr[data-timeline-focus="inside"]'),
      ]
      /** 中文说明：视图局部值 firstRow，由紧邻初始化决定。 */
      const firstRow = focusedRows.at(0)
      /** 中文说明：视图局部值 lastRow，由紧邻初始化决定。 */
      const lastRow = focusedRows.at(-1)
      if (firstRow === undefined || lastRow === undefined) return
      /** 中文说明：视图局部值 focusHeight，由紧邻初始化决定。 */
      const focusHeight =
        lastRow.getBoundingClientRect().bottom - firstRow.getBoundingClientRect().top
      /** 中文说明：视图局部值 target，由紧邻初始化决定。 */
      const target = focusHeight > ledger.clientHeight
        ? firstRow
        : focusedRows[Math.floor((focusedRows.length - 1) / 2)]
      /* v8 ignore next -- jsdom lacks scrollIntoView; browsers always have it. */
      if (target !== undefined && typeof target.scrollIntoView === 'function') {
        followsTableTail.current = false
        target.scrollIntoView({
          behavior: 'smooth',
          block: focusHeight > ledger.clientHeight ? 'start' : 'center',
        })
      }
      return
    }
    /** 中文说明：视图局部值 focusedVirtualIndexes，由紧邻初始化决定。 */
    const focusedVirtualIndexes = [...new Set(focusedPositions.flatMap((position) => {
      /** 中文说明：视图局部值 record，由紧邻初始化决定。 */
      const record = records[position]
      if (record === undefined) return []
      /** 中文说明：视图局部值 virtualIndex，由紧邻初始化决定。 */
      const virtualIndex = virtualIndexByRecordId.get(trajectoryRecordId(record.cell))
      return virtualIndex === undefined ? [] : [virtualIndex]
    }))].sort((left, right) => left - right)
    /** 中文说明：视图局部值 firstVirtual，由紧邻初始化决定。 */
    const firstVirtual = focusedVirtualIndexes.at(0)
    /** 中文说明：视图局部值 lastVirtual，由紧邻初始化决定。 */
    const lastVirtual = focusedVirtualIndexes.at(-1)
    if (firstVirtual === undefined || lastVirtual === undefined) return
    /** 中文说明：视图局部值 paneHeight，由紧邻初始化决定。 */
    const paneHeight = tablePaneRef.current?.clientHeight ?? 0
    /** 中文说明：视图局部值 focusHeight，由紧邻初始化决定。 */
    const focusHeight = projectedVirtualRows
      .slice(firstVirtual, lastVirtual + 1)
      .reduce((height, row) => height + row.height, 0)
    followsTableTail.current = false
    rowVirtualizer.scrollToIndex(
      focusHeight > paneHeight
        ? firstVirtual
        : focusedVirtualIndexes[Math.floor((focusedVirtualIndexes.length - 1) / 2)]
          ?? firstVirtual,
      {
        behavior: 'smooth',
        align: focusHeight > paneHeight ? 'start' : 'center',
      },
    )
  }, [
    projectedVirtualRows,
    records,
    rowVirtualizer,
    timelineFocusIndexes,
    virtualIndexByRecordId,
    virtualizationEnabled,
  ])
  /** 中文说明：视图局部值 requestOlder，由紧邻初始化决定。 */
  const requestOlder = useCallback((pane: HTMLDivElement, requireTop: boolean) => {
    if (
      !hasOlderRecords
      || onLoadOlder === undefined
      || loadingOlder.current
      || olderHistoryLoading
      || (requireTop && pane.scrollTop > OLDER_LOAD_THRESHOLD_PX)
    ) return
    loadingOlder.current = true
    setOlderLoading(true)
    olderLoadAnchor.current = {
      historyStartSeq,
      scrollHeight: pane.scrollHeight,
      scrollTop: pane.scrollTop,
    }
    void onLoadOlder().then((advanced) => {
      if (!advanced) olderLoadAnchor.current = null
    }).finally(() => {
      loadingOlder.current = false
      setOlderLoading(false)
    })
  }, [hasOlderRecords, historyStartSeq, olderHistoryLoading, onLoadOlder])
  useLayoutEffect(() => {
    /** 中文说明：视图局部值 pane，由紧邻初始化决定。 */
    const pane = tablePaneRef.current
    if (pane === null) return
    /** 中文说明：视图局部值 anchor，由紧邻初始化决定。 */
    const anchor = olderLoadAnchor.current
    if (anchor !== null && anchor.historyStartSeq !== historyStartSeq) {
      if (!virtualizationEnabled) {
        pane.scrollTop = anchor.scrollTop + pane.scrollHeight - anchor.scrollHeight
      }
      olderLoadAnchor.current = null
      followsTableTail.current = false
      return
    }
    if (!tableScrollInitialized.current) {
      if (historyLoading) return
      tableScrollInitialized.current = true
      followsTableTail.current = true
      if (virtualizationEnabled) rowVirtualizer.scrollToEnd({ behavior: 'auto' })
      else pane.scrollTop = pane.scrollHeight
      setTableScrollReady(true)
      return
    }
    if (!followsTableTail.current) return
    if (virtualizationEnabled) rowVirtualizer.scrollToEnd({ behavior: 'auto' })
    else pane.scrollTop = pane.scrollHeight
  }, [
    historyLoading,
    historyStartSeq,
    rowVirtualizer,
    virtualRowStructure,
    virtualizationEnabled,
  ])

  /** 中文说明：视图局部值 olderBusy，由紧邻初始化决定。 */
  const olderBusy = olderHistoryLoading || olderLoading
  /** 中文说明：视图局部值 showInitialLoading，由紧邻初始化决定。 */
  const showInitialLoading = historyLoading || !tableScrollReady
  /** 中文说明：视图局部值 historyRowOffset，由紧邻初始化决定。 */
  const historyRowOffset = hasOlderRecords ? 1 : 0

  return (
    <div ref={rootRef} className={css.split} style={splitStyle}>
      <div
        ref={tablePaneRef}
        className={css.tablePane}
        data-trajectory-scroll=""
        onScroll={(event) => {
          /** 中文说明：视图局部值 pane，由紧邻初始化决定。 */
          const pane = event.currentTarget
          followsTableTail.current =
            pane.scrollHeight - pane.clientHeight - pane.scrollTop
              <= BOTTOM_FOLLOW_THRESHOLD_PX
          requestOlder(pane, true)
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) clearAllSelections()
        }}
      >
        {showInitialLoading && (
          <div className={css.historyLoading} role="status" aria-live="polite">
            <span className={css.historyLoadingBar}>
              <span className={css.historyLoadingSpinner} aria-hidden="true" />
              Loading trajectory…
            </span>
          </div>
        )}
        <table
          className={css.table}
          data-scroll-ready={tableScrollReady || undefined}
          aria-rowcount={records.length + historyRowOffset}
        >
          <colgroup>
            <col className={css.eventColumn} />
            <col className={css.contentColumn} />
          </colgroup>
          <tbody>
            {hasOlderRecords && (
              <tr
                className={css.historyLoadRow}
                data-history-load=""
                aria-rowindex={1}
              >
                <td colSpan={2}>
                  <button
                    type="button"
                    className={css.historyLoadButton}
                    disabled={olderBusy || onLoadOlder === undefined}
                    aria-label={olderBusy
                      ? 'Loading earlier history…'
                      : 'Load earlier history'}
                    onClick={() => {
                      /** 中文说明：视图局部值 pane，由紧邻初始化决定。 */
                      const pane = tablePaneRef.current
                      if (pane !== null) requestOlder(pane, false)
                    }}
                  >
                    {olderBusy && (
                      <span className={css.historyLoadingSpinner} aria-hidden="true" />
                    )}
                    <span aria-hidden="true">
                      {olderBusy ? 'Loading earlier history…' : 'Load earlier history'}
                    </span>
                    <span className={css.visuallyHidden} role="status" aria-live="polite">
                      {olderBusy ? 'Loading earlier history…' : ''}
                    </span>
                  </button>
                </td>
              </tr>
            )}
            {virtualTop > 0 && (
              <tr className={css.virtualSpacer} data-virtual-spacer="top" aria-hidden="true">
                <td
                  colSpan={2}
                  style={{
                    '--trajectory-virtual-spacer-height': `${virtualTop}px`,
                  } as VirtualSpacerStyle}
                />
              </tr>
            )}
            {renderedRecords.map(({ record, position, terminalRequestBoundary }) => (
              <RecordPresentation
                key={trajectoryVirtualRecordKey(record)}
                cell={record.cell}
              >
                {({ displayText, listDisplayText, resultText, toolCallOnly, toolCallText }) => {
                  /** 中文说明：视图局部值 isCollapsedSummary，由紧邻初始化决定。 */
                  const isCollapsedSummary = record.collapsedSummary !== undefined
                  /** 中文说明：视图局部值 isRequestOnly，由紧邻初始化决定。 */
                  const isRequestOnly = record.cell.requestOnly === true
                  /** 中文说明：视图局部值 isInitialSystem，由紧邻初始化决定。 */
                  const isInitialSystem = record.cell.kind === 'system'
                && record.cell.index === allRecords[0]?.cell.index
                  /** 中文说明：视图局部值 key，由紧邻初始化决定。 */
                  const key = requestKey(record.turn, record.group)
                  /** 中文说明：视图局部值 request，由紧邻初始化决定。 */
                  const request = requestBoundaries.get(key) === record.cell.index
                && !isCollapsedSummary
                && (record.turn === null || !collapsedTurns.has(record.turn))
                    ? requestNumbers.get(key)
                    : undefined
                  /** 中文说明：视图局部值 requestInfo，由紧邻初始化决定。 */
                  const requestInfo = request === undefined
                    ? undefined
                    : sessionRequestNumbers?.find(candidate => candidate.number === request)
                  /** 中文说明：视图局部值 requestStatus，由紧邻初始化决定。 */
                  const requestStatus = requestInfo?.status
                ?? (record.cell.isError === true ? 'error' : undefined)
                  /** 中文说明：视图局部值 requestRunIndex，由紧邻初始化决定。 */
                  const requestRunIndex = requestBoundaryRuns.get(record.cell.index) ?? 0
                  /** 中文说明：视图局部值 requestBoundaryStyle，由紧邻初始化决定。 */
                  const requestBoundaryStyle: RequestBoundaryStyle = {
                    '--request-boundary-offset': `${requestRunIndex * 8}px`,
                  }
                  /** 中文说明：视图局部值 requestLabel，由紧邻初始化决定。 */
                  const requestLabel = request === undefined
                    ? undefined
                    : `Request #${request}${requestInfo?.purpose === 'compaction' ? ' · Compaction' : ''}`
                  /** 中文说明：视图局部值 requestSelected，由紧邻初始化决定。 */
                  const requestSelected = request !== undefined
                && selectedRequest?.turn === record.turn
                && selectedRequest.group === record.group
                  /** 中文说明：视图局部值 sectionActive，由紧邻初始化决定。 */
                  const sectionActive = record.turn === null
                    ? activeSection === record.section
                    : activeTurn === record.turn
                  return (
                    <tr
                      tabIndex={isRequestOnly ? -1 : 0}
                      aria-rowindex={position + 1 + historyRowOffset}
                      aria-label={isCollapsedSummary
                        ? `Collapsed ${record.collapsedSummaryKind} summary, ${record.collapsedSummary}`
                        : isRequestOnly
                          ? `Request ${request ?? ''}, compaction`
                          : `${request === undefined ? '' : `Request ${request}, `}${KIND_LABEL[record.cell.kind]}, ${listDisplayText || 'no content'}`}
                      aria-selected={!isCollapsedSummary && !isRequestOnly && selectedIndex === record.cell.index}
                      data-kind={record.cell.kind}
                      data-trajectory-row-key={trajectoryVirtualRecordKey(record)}
                      data-virtual-position={virtualizationEnabled ? position : undefined}
                      data-record-index={!isCollapsedSummary && !isRequestOnly
                        ? record.cell.index
                        : undefined}
                      data-request-only={isRequestOnly || undefined}
                      data-terminal-request-boundary={terminalRequestBoundary || undefined}
                      data-group-start={record.groupStart || undefined}
                      data-turn-start={record.turnStart || undefined}
                      data-error={record.cell.isError || undefined}
                      data-running={stateOf(record) === 'running' || undefined}
                      data-turn-end={record.turnEnd || undefined}
                      data-collapsed-summary={record.collapsedSummaryKind}
                      data-selected={!isCollapsedSummary && selectedIndex === record.cell.index || undefined}
                      data-timeline-focus={isCollapsedSummary || timelineFocusIndexes === null
                        ? undefined
                        : timelineFocusIndexes.has(record.cell.index) ? 'inside' : 'outside'}
                      onClick={isRequestOnly
                        ? undefined
                        : isCollapsedSummary
                          ? () => {
                            if (record.collapsedSummaryKind === 'turn' && record.turn !== null) {
                              onToggleTurn(record.turn)
                            } else onToggleAssistant(trajectoryRecordId(record.cell))
                          }
                          : () => { selectRecord(record.cell.index) }}
                      onDoubleClick={(event) => {
                        if (isCollapsedSummary || isRequestOnly) return
                        if (record.turn !== null && collapsedTurns.has(record.turn)) {
                          event.preventDefault()
                          onToggleTurn(record.turn)
                          return
                        }
                        if (
                          record.cell.kind === 'message'
                      && assistantToolCalls(allRecords, record.cell.index).length > 0
                        ) {
                          event.preventDefault()
                          onToggleAssistant(trajectoryRecordId(record.cell))
                          return
                        }
                        if (!record.turnStart) return
                        if (record.turn === null) return
                        if (allRecords.filter(candidate =>
                          candidate.turn === record.turn
                      && candidate.cell.requestOnly !== true
                      && candidate.cell.kind !== 'system').length <= 1) return
                        event.preventDefault()
                        onToggleTurn(record.turn)
                      }}
                      onKeyDown={(event) => {
                        if (isRequestOnly) return
                        if (event.key !== 'Enter' && event.key !== ' ') return
                        event.preventDefault()
                        if (isCollapsedSummary) {
                          if (record.collapsedSummaryKind === 'turn' && record.turn !== null) {
                            onToggleTurn(record.turn)
                          } else onToggleAssistant(trajectoryRecordId(record.cell))
                          return
                        }
                        selectRecord(record.cell.index)
                      }}
                    >
                      <td className={css.event}>
                        {request !== undefined && (
                          <button
                            type="button"
                            className={requestSelected
                              ? `${css.requestBoundaryControl} ${css.requestBoundaryControlActive}`
                              : css.requestBoundaryControl}
                            aria-label={requestLabel}
                            aria-pressed={requestSelected}
                            data-label={requestLabel}
                            data-request-run-index={requestRunIndex}
                            data-request-status={requestStatus}
                            style={requestBoundaryStyle}
                            onClick={(event) => {
                              event.stopPropagation()
                              selectRequest({
                                turn: record.turn,
                                group: record.group,
                                ...(requestInfo?.seq === undefined ? {} : { seq: requestInfo.seq }),
                              })
                            }}
                            onDoubleClick={(event) => { event.stopPropagation() }}
                          />
                        )}
                        {record.turn !== null
                    && activeTurn === record.turn
                    && !isInitialSystem && (
                          <span className={css.turnRail} aria-hidden="true" />
                        )}
                        {!isCollapsedSummary && selectedIndex === record.cell.index && (
                          <span className={css.selectionRail} aria-hidden="true" />
                        )}
                        {!isCollapsedSummary
                    && !isRequestOnly
                    && record.turnStart && (
                          <span
                            className={sectionActive
                              ? `${css.turnLabel} ${css.turnLabelActive}`
                              : css.turnLabel}
                            aria-label={sectionLabel(record.turn)}
                          >
                            {record.turn === null
                              ? sectionLabel(record.turn)
                              : (
                                <>
                                  <span className={css.turnLabelFull} aria-hidden="true">
                                    {sectionLabel(record.turn)}
                                  </span>
                                  <span className={css.turnLabelCompact} aria-hidden="true">
                                    #{record.turn}
                                  </span>
                                </>
                              )}
                          </span>
                        )}
                        <div className={css.eventInner}>
                          {!isCollapsedSummary && !isRequestOnly && (
                            <span
                              className={css.kindSlot}
                            >
                              <span
                                className={`${css.kindTag} ${
                                  record.cell.kind === 'system'
                                    ? css.systemNeutral
                                    : record.cell.kind === 'context'
                                      ? css.contextGreen
                                      : record.cell.kind === 'compacted'
                                        ? css.compacted
                                        : record.cell.kind === 'tool'
                                          ? css.toolAmber
                                          : record.cell.kind === 'message'
                                            ? css.assistantVioletBright
                                            : record.cell.kind === 'subtool'
                                              ? css.subtoolAmber
                                              : css[record.cell.kind]
                                }`}
                                data-role-kind={record.cell.kind}
                              >
                                <Tooltip
                                  label={KIND_LABEL[record.cell.kind]}
                                  side="right"
                                >
                                  <span className={css.kindTagIcon} aria-hidden="true">
                                    {KIND_ICON[record.cell.kind]}
                                  </span>
                                </Tooltip>
                                <span className={css.kindTagLabel}>
                                  {KIND_LABEL[record.cell.kind]}
                                </span>
                              </span>
                            </span>
                          )}
                        </div>
                      </td>
                      <td className={css.content}>
                        {isRequestOnly
                          ? null
                          : record.collapsedSummary !== undefined
                            ? (
                              <span className={css.collapsedTurnContent} title={record.collapsedSummary}>
                                <span className={css.collapsedTurnEllipsis}>…</span>
                                <span className={css.collapsedTurnText}>{record.collapsedSummary}</span>
                              </span>
                            )
                            : (
                              <span
                                className={resultText === undefined ? css.contentText : css.resultPreview}
                                title={resultText === undefined
                                  ? listDisplayText
                                  : `${listDisplayText} → ${resultText}`}
                              >
                                <span className={resultText === undefined ? undefined : css.resultRequest}>
                                  <RecordListText
                                    displayText={displayText}
                                    toolCallOnly={toolCallOnly}
                                    toolCallText={toolCallText}
                                  />
                                </span>
                                {resultText !== undefined && (
                                  <span className={record.cell.isError ? `${css.inlineResult} ${css.error}` : css.inlineResult}>
                                    <span className={css.arrow}>→</span>
                                    <span className={resultText === 'No output'
                                      ? `${css.inlineResultText} ${css.noOutputText}`
                                      : css.inlineResultText}
                                    >
                                      {resultText}
                                    </span>
                                  </span>
                                )}
                              </span>
                            )}
                      </td>
                    </tr>
                  )
                }}
              </RecordPresentation>
            ))}
            {virtualBottom > 0 && (
              <tr className={css.virtualSpacer} data-virtual-spacer="bottom" aria-hidden="true">
                <td
                  colSpan={2}
                  style={{
                    '--trajectory-virtual-spacer-height': `${virtualBottom}px`,
                  } as VirtualSpacerStyle}
                />
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {(selectedRequest !== null
        || promptSelected
        || (selected !== undefined && selectedState !== undefined)) && (
        <aside
          className={css.details}
          aria-label="Event details"
          style={detailsWidth === null ? undefined : { width: detailsWidth }}
        >
          <div
            className={css.detailsResizeHandle}
            role="separator"
            aria-label="Resize event details"
            aria-controls="trajectory-detail-panel"
            aria-orientation="vertical"
            tabIndex={0}
            title="Drag to resize. Double-click to reset."
            onDoubleClick={() => {
              setDetailsWidth(null)
              setToolRequestOffset(null)
            }}
            onPointerDown={(event) => {
              if (event.button !== 0) return
              /** 中文说明：视图局部值 details，由紧邻初始化决定。 */
              const details = event.currentTarget.parentElement
              if (details === null) return
              /** 中文说明：视图局部值 split，由紧邻初始化决定。 */
              const split = details.parentElement
              if (split === null) return
              /** 中文说明：视图局部值 splitWidth，由紧邻初始化决定。 */
              const splitWidth = split.getBoundingClientRect().width
              detailsResizeDrag.current = {
                pointerId: event.pointerId,
                startX: event.clientX,
                startWidth: details.getBoundingClientRect().width,
                splitWidth,
                startToolRequestOffset: toolRequestOffset ?? (
                  splitWidth * TOOL_REQUEST_SHARE - defaultToolRequestWidth(splitWidth)
                ),
              }
              event.currentTarget.setPointerCapture(event.pointerId)
              event.preventDefault()
            }}
            onPointerMove={(event) => {
              /** 中文说明：视图局部值 drag，由紧邻初始化决定。 */
              const drag = detailsResizeDrag.current
              if (drag === null || drag.pointerId !== event.pointerId) return
              /** 中文说明：视图局部值 nextDetailsWidth，由紧邻初始化决定。 */
              const nextDetailsWidth = clampDetailsWidth(
                drag.startWidth + drag.startX - event.clientX,
                drag.splitWidth,
              )
              setDetailsWidth(nextDetailsWidth)
              setToolRequestOffset(
                drag.startToolRequestOffset
                + (nextDetailsWidth - drag.startWidth) * TOOL_REQUEST_SHARE,
              )
            }}
            onPointerUp={(event) => {
              if (detailsResizeDrag.current?.pointerId !== event.pointerId) return
              detailsResizeDrag.current = null
              event.currentTarget.releasePointerCapture(event.pointerId)
            }}
            onPointerCancel={() => {
              detailsResizeDrag.current = null
            }}
            onKeyDown={(event) => {
              if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
              /** 中文说明：视图局部值 details，由紧邻初始化决定。 */
              const details = event.currentTarget.parentElement
              if (details === null) return
              /** 中文说明：视图局部值 split，由紧邻初始化决定。 */
              const split = details.parentElement
              if (split === null) return
              /** 中文说明：视图局部值 direction，由紧邻初始化决定。 */
              const direction = event.key === 'ArrowLeft' ? 1 : -1
              /** 中文说明：视图局部值 currentDetailsWidth，由紧邻初始化决定。 */
              const currentDetailsWidth = details.getBoundingClientRect().width
              /** 中文说明：视图局部值 splitWidth，由紧邻初始化决定。 */
              const splitWidth = split.getBoundingClientRect().width
              /** 中文说明：视图局部值 nextDetailsWidth，由紧邻初始化决定。 */
              const nextDetailsWidth = clampDetailsWidth(
                currentDetailsWidth + direction * DETAILS_RESIZE_STEP,
                splitWidth,
              )
              /** 中文说明：视图局部值 currentToolRequestOffset，由紧邻初始化决定。 */
              const currentToolRequestOffset = toolRequestOffset ?? (
                splitWidth * TOOL_REQUEST_SHARE - defaultToolRequestWidth(splitWidth)
              )
              setDetailsWidth(nextDetailsWidth)
              setToolRequestOffset(
                currentToolRequestOffset
                + (nextDetailsWidth - currentDetailsWidth) * TOOL_REQUEST_SHARE,
              )
              event.preventDefault()
            }}
          />
          <div className={css.detailsHeader}>
            <div className={css.detailsTitle}>
              {selectedRequest !== null
                ? (
                  <>
                    <span className={css.requestDetailsDot} aria-hidden="true" />
                    <span className={css.requestDetailsName}>
                      Request #{selectedRequestNumber ?? '—'}
                    </span>
                    <span className={css.detailsLocation}>
                      {selectedRequestInfo?.purpose === 'compaction'
                        ? `Compaction · ${sectionLabel(selectedRequest.turn)}`
                        : sectionLabel(selectedRequest.turn)}
                    </span>
                  </>
                )
                : promptSelected
                  ? (
                    <>
                      <span className={`${css.kindTag} ${css.systemNeutral}`}>SYSTEM</span>
                      <span className={css.detailsLocation}>{selected?.cell.text}</span>
                    </>
                  )
                  : selected !== undefined && (
                    <>
                      <span className={`${css.kindTag} ${
                        selected.cell.kind === 'context'
                          ? css.contextGreen
                          : selected.cell.kind === 'compacted'
                            ? css.compacted
                            : selected.cell.kind === 'tool'
                              ? css.toolAmber
                              : selected.cell.kind === 'message'
                                ? css.assistantVioletBright
                                : selected.cell.kind === 'subtool'
                                  ? css.subtoolAmber
                                  : css[selected.cell.kind]
                      }`}
                      >
                        {KIND_LABEL[selected.cell.kind]}
                      </span>
                      <span className={css.detailsLocation}>
                        {selected.cell.kind === 'compacted'
                          ? sectionLabel(selected.turn)
                          : `${sectionLabel(selected.turn)} · ${selected.group}`}
                      </span>
                    </>
                  )}
            </div>
            <button
              type="button"
              className={css.close}
              aria-label="Close details"
              onClick={clearInspectorSelection}
            >
              <span aria-hidden="true">×</span>
            </button>
          </div>
          <div className={css.detailTabs} role="tablist" aria-label="Event details">
            {selectedTabs.map(tab => (
              <button
                key={tab.id}
                id={`trajectory-detail-${tab.id}`}
                type="button"
                role="tab"
                aria-controls="trajectory-detail-panel"
                aria-selected={activeTab === tab.id}
                className={activeTab === tab.id ? `${css.detailTab} ${css.detailTabActive}` : css.detailTab}
                onClick={() => { activateTab(tab.id) }}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <div
            id="trajectory-detail-panel"
            className={activeTab === 'overview'
              ? `${css.detailBody} ${css.detailBodySummary}`
              : css.detailBody}
            role="tabpanel"
            aria-labelledby={`trajectory-detail-${activeTab}`}
          >
            {selectedRequest !== null
              && selectedRequestState !== undefined
              && activeTab === 'overview' && (
              <>
                <dl
                  className={`${css.overview} ${css.summaryScrollRegion}`}
                  data-summary-scroll-region=""
                >
                  <div>
                    <dt>Status</dt>
                    <dd className={selectedRequestState === 'error' ? css.error : undefined}>
                      {statusLabel(selectedRequestState)}
                    </dd>
                  </div>
                  {selectedRequestInfo?.purpose === 'compaction' && (
                    <div>
                      <dt>Purpose</dt>
                      <dd>Compaction</dd>
                    </div>
                  )}
                  {(selectedRequestInfo?.provider
                    ?? selectedRequestInfo?.requestConfig?.provider) !== undefined && (
                    <div>
                      <dt>Provider</dt>
                      <dd>
                        {selectedRequestInfo?.provider
                          ?? selectedRequestInfo?.requestConfig?.provider}
                      </dd>
                    </div>
                  )}
                  {(selectedRequestInfo?.model
                    ?? selectedRequestInfo?.requestConfig?.model) !== undefined && (
                    <div>
                      <dt>Model</dt>
                      <dd>
                        {selectedRequestInfo?.model
                          ?? selectedRequestInfo?.requestConfig?.model}
                      </dd>
                    </div>
                  )}
                  <div>
                    <dt>Tool calls</dt>
                    <dd>{selectedRequestToolCalls}</dd>
                  </div>
                  {selectedRequestSubtoolCalls > 0 && (
                    <div>
                      <dt>Subtool calls</dt>
                      <dd>{selectedRequestSubtoolCalls}</dd>
                    </div>
                  )}
                  {selectedRequestInfo?.error !== undefined && (
                    <div>
                      <dt>Error</dt>
                      <dd className={css.error}>{selectedRequestInfo.error}</dd>
                    </div>
                  )}
                  {selectedRequestInfo?.retry !== undefined && (
                    <div>
                      <dt>Retry</dt>
                      <dd>
                        Scheduled {selectedRequestInfo.retry}
                        {selectedRequestInfo.maxRetries === undefined
                          ? ''
                          : ` of ${selectedRequestInfo.maxRetries}`}
                      </dd>
                    </div>
                  )}
                  {selectedRequestInfo?.retryDelayMs !== undefined && (
                    <div>
                      <dt>Retry delay</dt>
                      <dd>{formatDurationMs(selectedRequestInfo.retryDelayMs)}</dd>
                    </div>
                  )}
                  {selectedRequestResult !== undefined && (
                    <div>
                      <dt>Result</dt>
                      <dd className={css.overviewParentLinks}>
                        <button
                          type="button"
                          className={css.overviewHierarchyNavLink}
                          onClick={() => {
                            openRecordSummary(selectedRequestResult)
                          }}
                        >
                          <span>
                            {selectedRequestInfo?.purpose === 'compaction'
                              ? 'Compacted'
                              : 'Assistant Message'}
                          </span>
                          <IconChevronRightOutline14
                            className={css.overviewHierarchyJumpIconTight}
                            size={11}
                          />
                        </button>
                      </dd>
                    </div>
                  )}
                </dl>
                <div className={css.overviewSections}>
                  {selectedRequestOptions !== undefined && (
                    <OverviewSection label="Options" onOpen={() => { activateTab('options') }}>
                      <RequestOptions options={selectedRequestOptions} preview />
                    </OverviewSection>
                  )}
                  <OverviewSection label="Usage" onOpen={() => { activateTab('usage') }}>
                    <UsageRows usage={selectedRequestUsage} />
                  </OverviewSection>
                  <OverviewSection label="Timing" onOpen={() => { activateTab('timing') }}>
                    <RequestTiming
                      assistant={selectedRequestAssistant}
                      anchor={selectedRequestAnchor}
                      request={selectedRequestInfo}
                    />
                  </OverviewSection>
                </div>
              </>
            )}
            {selectedRequest !== null && activeTab === 'options' && (
              <RequestOptions options={selectedRequestOptions} />
            )}
            {selectedRequest !== null && activeTab === 'usage' && (
              <RequestUsagePanel
                usage={selectedRequestUsage}
                cumulative={selectedRequestCumulativeUsage}
              />
            )}
            {selectedRequest !== null && activeTab === 'timing' && (
              <RequestTiming
                assistant={selectedRequestAssistant}
                anchor={selectedRequestAnchor}
                request={selectedRequestInfo}
              />
            )}
            {promptSelected
              && selectedPreviousPrompt !== undefined
              && activeTab === 'diff' && (
              <SystemPromptDiff
                before={selectedPreviousPrompt}
                after={selectedPrompt}
              />
            )}
            {promptSelected && activeTab === 'system-prompt' && (
              selectedPrompt.system === ''
                ? <p className={css.noPayload}>No system prompt in this request</p>
                : (
                  <div className={`${css.markdownPayload} ${css.systemPrompt}`}>
                    <MarkdownText text={selectedPrompt.system} />
                  </div>
                )
            )}
            {promptSelected && activeTab === 'tools' && (
              <ToolCatalog tools={selectedPrompt.tools} />
            )}
            {!promptSelected
              && selected?.cell.kind === 'compacted'
              && selectedState !== undefined
              && activeTab === 'overview' && (
              <>
                <dl
                  className={`${css.overview} ${css.summaryScrollRegion}`}
                  data-summary-scroll-region=""
                >
                  <div>
                    <dt>Status</dt>
                    <dd className={selectedState === 'error' ? css.error : undefined}>
                      {statusLabel(selectedState)}
                    </dd>
                  </div>
                  <div>
                    <dt>Duration</dt>
                    <dd>{formatElapsedSeconds(selected.cell.timeSeconds)}</dd>
                  </div>
                  <div>
                    <dt>Tokens</dt>
                    <dd>—</dd>
                  </div>
                </dl>
                {selected.cell.outputDetail !== undefined && (
                  <div
                    className={`${css.compactedSummary} ${css.summaryScrollRegion}`}
                    data-summary-scroll-region=""
                  >
                    <MarkdownRecordContent
                      record={selected}
                      rendered
                      thinkingExpanded={thinkingExpanded}
                      onThinkingExpandedChange={setThinkingExpanded}
                      onOpenCall={openCallSummary}
                    />
                  </div>
                )}
              </>
            )}
            {!promptSelected
              && selected !== undefined
              && selected.cell.kind !== 'compacted'
              && selectedState !== undefined
              && activeTab === 'overview' && (
              <>
                <dl
                  className={`${css.overview} ${css.summaryScrollRegion}`}
                  data-summary-scroll-region=""
                >
                  {selected.cell.messageSource !== undefined && (
                    <div>
                      <dt>Source</dt>
                      <dd className={css.overviewParentLinks}>
                        <button
                          type="button"
                          className={css.overviewHierarchyNavLink}
                          onClick={() => { activateTab('source') }}
                        >
                          <span>{messageSourceLabel(selected.cell.messageSource)}</span>
                          <IconChevronRightOutline14
                            className={css.overviewHierarchyJumpIconTight}
                            size={11}
                          />
                        </button>
                      </dd>
                    </div>
                  )}
                  {hasSelectedHierarchy && (
                    <div>
                      <dt>
                        {selectedAssistantRequestTarget !== undefined
                          ? 'Source'
                          : 'Hierarchy'}
                      </dt>
                      <dd className={css.overviewParentLinks}>
                        {selectedAssistantRequestTarget !== undefined && (
                          <button
                            type="button"
                            className={css.overviewHierarchyNavLink}
                            onClick={() => {
                              selectRequest(selectedAssistantRequestTarget)
                            }}
                          >
                            <span>Request #{selectedAssistantRequest ?? '—'}</span>
                            <IconChevronRightOutline14
                              className={css.overviewHierarchyJumpIconTight}
                              size={11}
                            />
                          </button>
                        )}
                        {selectedParentMessage !== undefined && (
                          <button
                            type="button"
                            className={css.overviewHierarchyNavLink}
                            onClick={() => { openRecordSummary(selectedParentMessage) }}
                          >
                            <span>Assistant Message</span>
                            <IconChevronRightOutline14
                              className={css.overviewHierarchyJumpIconTight}
                              size={11}
                            />
                          </button>
                        )}
                        {selectedParentTool !== undefined && (
                          <button
                            type="button"
                            className={css.overviewHierarchyNavLink}
                            onClick={() => { openRecordSummary(selectedParentTool) }}
                          >
                            <span>Tool Call</span>
                            <IconChevronRightOutline14
                              className={css.overviewHierarchyJumpIconTight}
                              size={11}
                            />
                          </button>
                        )}
                      </dd>
                    </div>
                  )}
                  <div>
                    <dt>Status</dt>
                    <dd className={selectedState === 'error' ? css.error : undefined}>
                      {statusLabel(selectedState)}
                    </dd>
                  </div>
                  {selected.cell.kind === 'message' && (
                    <TokenRows cell={selected.cell} />
                  )}
                  {(selected.cell.kind === 'user' || selected.cell.kind === 'context') && (
                    <div>
                      <dt>Duration</dt>
                      <dd>{formatElapsedSeconds(selected.cell.timeSeconds)}</dd>
                    </div>
                  )}
                </dl>
                <div className={css.overviewSections}>
                  {isMarkdownRecord(selected)
                    ? (
                      <>
                        <OverviewSection label="Preview" onOpen={() => { activateTab('rendered') }}>
                          <MarkdownRecordContent
                            record={selected}
                            rendered
                            preview
                            thinkingExpanded={thinkingExpanded}
                            onThinkingExpandedChange={setThinkingExpanded}
                            onOpenCall={openCallSummary}
                          />
                        </OverviewSection>
                      </>
                    )
                    : (
                      <>
                        {selected.cell.inputDetail && (
                          <OverviewSection label="Payload" onOpen={() => { activateTab('input') }}>
                            <RecordPayload record={selected} direction="input" preview />
                          </OverviewSection>
                        )}
                        {selected.cell.outputDetail && (
                          <OverviewSection label="Result" onOpen={() => { activateTab('output') }}>
                            <RecordPayload record={selected} direction="output" preview />
                          </OverviewSection>
                        )}
                        <OverviewSection label="Schema" onOpen={() => { activateTab('schema') }}>
                          <RecordSchema record={selected} preview />
                        </OverviewSection>
                      </>
                    )}
                  {selectedAssistantRequestTarget !== undefined && (
                    <OverviewSection
                      label="Request Timing"
                      onOpen={() => {
                        selectRequest(selectedAssistantRequestTarget, 'timing')
                      }}
                    >
                      <RecordTiming record={selected} />
                    </OverviewSection>
                  )}
                  {(selected.cell.kind === 'tool' || selected.cell.kind === 'subtool') && (
                    <OverviewSection label="Timing" onOpen={() => { activateTab('timing') }}>
                      <RecordTiming record={selected} />
                    </OverviewSection>
                  )}
                </div>
              </>
            )}
            {!promptSelected && selected !== undefined && activeTab === 'rendered' && (
              <MarkdownRecordContent
                record={selected}
                rendered
                thinkingExpanded={thinkingExpanded}
                onThinkingExpandedChange={setThinkingExpanded}
                onOpenCall={openCallSummary}
              />
            )}
            {!promptSelected && selected !== undefined && activeTab === 'raw' && (
              <MarkdownRecordContent
                record={selected}
                rendered={false}
                thinkingExpanded={thinkingExpanded}
                onThinkingExpandedChange={setThinkingExpanded}
                onOpenCall={openCallSummary}
              />
            )}
            {!promptSelected && selected !== undefined && activeTab === 'source' && (
              <MessageSource record={selected} />
            )}
            {!promptSelected && selected !== undefined && activeTab === 'input' && (
              <RecordPayload record={selected} direction="input" />
            )}
            {!promptSelected && selected !== undefined && activeTab === 'output' && (
              <RecordPayload record={selected} direction="output" />
            )}
            {!promptSelected && selected !== undefined && activeTab === 'schema' && (
              <RecordSchema record={selected} />
            )}
            {!promptSelected && selected !== undefined && activeTab === 'timing' && (
              <RecordTiming record={selected} />
            )}
          </div>
        </aside>
      )}
    </div>
  )
}
