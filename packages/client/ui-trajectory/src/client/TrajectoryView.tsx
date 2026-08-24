/** Trajectory view: compact summary over a turn-aware event ledger. */
/**
 * 文件职责：实现运行轨迹的 TrajectoryView 组件。
 * 技术维度：React、TypeScript、Cordis 插槽、外部 Store 和 CSS Modules。
 * 产品维度：支持用户查看或操作运行轨迹。
 * 逻辑维度：读取状态，派生展示数据，处理操作并渲染界面。
 * 关键边界：异步状态、空状态、虚拟滚动和可访问性必须一致。
 * 新手阅读建议：先读 Props，再看状态选择、事件和 JSX。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  AssistantBlock, AssistantMessageNode, ConversationSnapshot,
  SnapshotStore,
} from '@deepseek-ai/dsh-client-runtime/client'
import {
  TrajectoryTable,
  /** 中文说明：类型或类 TrajectoryRequestNumber 约束模块数据或组件职责。 */
  type TrajectoryRequestNumber,
  /** 中文说明：类型或类 TrajectoryUsage 约束模块数据或组件职责。 */
  type TrajectoryUsage,
} from './TrajectoryTable.tsx'
import { TrajectoryToolbar } from './TrajectoryToolbar.tsx'
import { TrajectoryTimeline } from './TrajectoryTimeline.tsx'
import {
  appendTrajectoryPartialLayout, deriveTrajectoryLayout,
  /** 中文说明：类型或类 TrajectoryTurnModel 约束模块数据或组件职责。 */
  type TrajectoryTurnModel,
} from './layout.ts'
import {
  trajectoryTimelineFocusIndexes,
  /** 中文说明：类型或类 TrajectoryTimelineMode 约束模块数据或组件职责。 */
  type TrajectoryTimelineMode,
  /** 中文说明：类型或类 TrajectoryTimeRange 约束模块数据或组件职责。 */
  type TrajectoryTimeRange,
} from './timeline.ts'
import { trajectoryRecordId } from './trajectory-record.ts'
import { TrajectorySearchIndex } from './trajectory-search-index.ts'
import { EMPTY_TRAJECTORY_SNAPSHOT } from './trajectory-snapshot-builder.ts'
import css from './views.module.css'

/** 中文说明：组件局部值 EMPTY_TURN_IDS，由紧邻初始化决定。 */
const EMPTY_TURN_IDS: ReadonlySet<number> = new Set()
/** 中文说明：组件局部值 EMPTY_RECORD_IDS，由紧邻初始化决定。 */
const EMPTY_RECORD_IDS: ReadonlySet<string> = new Set()
/** 中文说明：组件局部值 SEARCH_INDEX_THROTTLE_MS，由紧邻初始化决定。 */
const SEARCH_INDEX_THROTTLE_MS = 3_000

/** 中文说明：函数 lastCellIndex 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function lastCellIndex(turns: readonly TrajectoryTurnModel[]): number {
  /** 中文说明：组件局部值 last，由紧邻初始化决定。 */
  let last = 0
  /** 中文说明：组件局部值 turn，由紧邻初始化决定。 */
  for (const turn of turns) {
    /** 中文说明：组件局部值 group，由紧邻初始化决定。 */
    for (const group of turn.groups) {
      /** 中文说明：组件局部值 cell，由紧邻初始化决定。 */
      for (const cell of group.cells) last = Math.max(last, cell.index)
    }
  }
  return last
}

/** 中文说明：函数 timelineBlock 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function timelineBlock(block: AssistantBlock): AssistantBlock {
  switch (block.kind) {
    case 'text': return { kind: 'text', text: '' }
    case 'reasoning': return { kind: 'reasoning', text: '' }
    case 'image': return block
    case 'tool-call': return {
      kind: 'tool-call',
      callId: block.callId,
      name: block.name,
      argsRaw: '',
    }
    case 'other': return { kind: 'other', block: null }
  }
}

/** 中文说明：函数 partialStructureSignature 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function partialStructureSignature(partial: ConversationSnapshot['partial']): string {
  if (partial === null) return ''
  return partial.blocks.map(block => block.kind === 'tool-call'
    ? `${block.kind}:${block.callId}:${block.name}`
    : block.kind).join('\u0000')
}

/** Session-bound controls not already supplied by the conversation view slot. */
/** 中文说明：类型或类 TrajectoryViewInjected 约束模块数据或组件职责。 */
export interface TrajectoryViewInjected {
  hooks: {
    duration: SnapshotStore<boolean>
  }
  loadOlder: () => Promise<boolean>
  setActualDuration: (actualDuration: boolean) => void
}

/** 中文说明：类型或类 UsageLike 约束模块数据或组件职责。 */
interface UsageLike {
  inputTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  outputTokens?: number
  reasoningTokens?: number
}

/** 中文说明：函数 requestUsage 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function requestUsage(value: unknown): TrajectoryUsage | undefined {
  /** 中文说明：组件局部值 usage，由紧邻初始化决定。 */
  const usage = value as UsageLike | undefined
  if (usage === undefined) return undefined
  return {
    ...(usage.inputTokens === undefined ? {} : { input: usage.inputTokens }),
    ...(usage.cacheReadTokens === undefined ? {} : { cacheRead: usage.cacheReadTokens }),
    ...(usage.cacheWriteTokens === undefined ? {} : { cacheWrite: usage.cacheWriteTokens }),
    ...(usage.outputTokens === undefined ? {} : { output: usage.outputTokens }),
    ...(usage.reasoningTokens === undefined ? {} : { reasoning: usage.reasoningTokens }),
  }
}

/** 中文说明：函数 addUsage 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function addUsage(
  total: TrajectoryUsage | undefined,
  usage: TrajectoryUsage | undefined,
): TrajectoryUsage | undefined {
  if (usage === undefined) return total
  return {
    ...(total?.input === undefined && usage.input === undefined
      ? {}
      : { input: (total?.input ?? 0) + (usage.input ?? 0) }),
    ...(total?.cacheRead === undefined && usage.cacheRead === undefined
      ? {}
      : { cacheRead: (total?.cacheRead ?? 0) + (usage.cacheRead ?? 0) }),
    ...(total?.cacheWrite === undefined && usage.cacheWrite === undefined
      ? {}
      : { cacheWrite: (total?.cacheWrite ?? 0) + (usage.cacheWrite ?? 0) }),
    ...(total?.output === undefined && usage.output === undefined
      ? {}
      : { output: (total?.output ?? 0) + (usage.output ?? 0) }),
    ...(total?.reasoning === undefined && usage.reasoning === undefined
      ? {}
      : { reasoning: (total?.reasoning ?? 0) + (usage.reasoning ?? 0) }),
  }
}

/** 中文说明：函数 TrajectoryView 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
export function TrajectoryView({
  useSession, useDuration, loadOlder, setActualDuration,
  inspect, onInspectDone, t,
}: ConvViewProps & InjectFace<TrajectoryViewInjected> & PropsLocale<'trajectory'>) {
  /** 中文说明：组件局部值 解构结果，由紧邻初始化决定。 */
  const [collapsedTurns, setCollapsedTurns] = useState<ReadonlySet<number>>(EMPTY_TURN_IDS)
  /** 中文说明：组件局部值 解构结果，由紧邻初始化决定。 */
  const [collapsedAssistants, setCollapsedAssistants] =
    useState<ReadonlySet<string>>(EMPTY_RECORD_IDS)
  /** 中文说明：组件局部值 解构结果，由紧邻初始化决定。 */
  const [timelineSelection, setTimelineSelection] = useState<TrajectoryTimeRange | null>(null)
  /** 中文说明：组件局部值 actualDuration，由紧邻初始化决定。 */
  const actualDuration = useDuration(value => value)
  /** 中文说明：组件局部值 解构结果，由紧邻初始化决定。 */
  const [actualTime, setActualTime] = useState(false)
  /** 中文说明：组件局部值 解构结果，由紧邻初始化决定。 */
  const [searchQuery, setSearchQuery] = useState('')
  /** 中文说明：组件局部值 [searchIndex]，由紧邻初始化决定。 */
  const [searchIndex] = useState(() => new TrajectorySearchIndex())
  /** 中文说明：组件局部值 解构结果，由紧邻初始化决定。 */
  const [searchIndexRevision, setSearchIndexRevision] = useState(0)
  /** 中文说明：组件局部值 searchIndexTimer，由紧邻初始化决定。 */
  const searchIndexTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** 中文说明：组件局部值 searchIndexInitialized，由紧邻初始化决定。 */
  const searchIndexInitialized = useRef(false)
  /** 中文说明：组件局部值 解构结果，由紧邻初始化决定。 */
  const [selectedTimelineIndex, setSelectedTimelineIndex] = useState<number | null>(null)
  /** 中文说明：组件局部值 解构结果，由紧邻初始化决定。 */
  const [timelineRecordSelection, setTimelineRecordSelection] = useState<{
    readonly index: number
  } | null>(null)
  /** 中文说明：组件局部值 解构结果，由紧邻初始化决定。 */
  const [timelineRecordFocus, setTimelineRecordFocus] = useState<{
    readonly index: number
  } | null>(null)
  /** 中文说明：组件局部值 inspection，由紧邻初始化决定。 */
  const inspection = useSession(snapshot =>
    snapshot.views.get('trajectory') ?? EMPTY_TRAJECTORY_SNAPSHOT)
  /** 中文说明：组件局部值 historyLoading，由紧邻初始化决定。 */
  const historyLoading = useSession(snapshot => snapshot.openState === 'loading')
  /** 中文说明：组件局部值 olderHistoryLoading，由紧邻初始化决定。 */
  const olderHistoryLoading = useSession(snapshot => snapshot.loadingOlder)
  /** 中文说明：组件局部值 hasOlderHistory，由紧邻初始化决定。 */
  const hasOlderHistory = useSession(snapshot => snapshot.hasMore)
  /** 中文说明：组件局部值 nodes，由紧邻初始化决定。 */
  const nodes = inspection.eventNodes
  /** 中文说明：组件局部值 eventLocations，由紧邻初始化决定。 */
  const eventLocations = inspection.eventLocations
  /** 中文说明：组件局部值 historyBaseSeq，由紧邻初始化决定。 */
  const historyBaseSeq = nodes[0]?.seq ?? 0
  /** 中文说明：组件局部值 partial，由紧邻初始化决定。 */
  const partial = inspection.partial
  /** 中文说明：组件局部值 runningCalls，由紧邻初始化决定。 */
  const runningCalls = inspection.runningCalls
  /** 中文说明：组件局部值 requests，由紧邻初始化决定。 */
  const requests = inspection.requests
  /** 中文说明：组件局部值 callSchemas，由紧邻初始化决定。 */
  const callSchemas = inspection.callSchemas
  /** 中文说明：组件局部值 requestNumbers，由紧邻初始化决定。 */
  const requestNumbers = useMemo<readonly TrajectoryRequestNumber[]>(() => {
    /** 中文说明：组件局部值 assistantsByStep，由紧邻初始化决定。 */
    const assistantsByStep = new Map<string, AssistantMessageNode>()
    /** 中文说明：组件局部值 node，由紧邻初始化决定。 */
    for (const node of nodes) {
      if (node.kind !== 'assistant' || node.step <= 0) continue
      assistantsByStep.set(`${node.turn}\u0000${node.step}`, node)
    }
    /** 中文说明：组件局部值 requestsByStep，由紧邻初始化决定。 */
    const requestsByStep = new Map(
      requests
        .filter(request => request.purpose === 'assistant')
        .map(request => [
          `${request.turn}\u0000${request.step}`,
          request,
        ]),
    )
    /** 中文说明：组件局部值 orderedRequests，由紧邻初始化决定。 */
    const orderedRequests = [
      ...requests.map(request => ({
        seq: request.startSeq,
        request,
        node: request.purpose === 'assistant'
          ? assistantsByStep.get(`${request.turn}\u0000${request.step}`)
          : undefined,
      })),
      ...[...assistantsByStep.entries()].flatMap(([key, node]) =>
        requestsByStep.has(key)
          ? []
          : [{
            seq: node.seq,
            request: undefined,
            node,
          }],
      ),
    ].sort((left, right) => left.seq - right.seq)
    /** 中文说明：组件局部值 numbered，由紧邻初始化决定。 */
    const numbered: TrajectoryRequestNumber[] = []
    /** 中文说明：组件局部值 解构结果，由紧邻初始化决定。 */
    let cumulativeUsage: TrajectoryUsage | undefined
    /** 中文说明：组件局部值 [index，由紧邻初始化决定。 */
    for (const [index, entry] of orderedRequests.entries()) {
      /** 中文说明：组件局部值 usage，由紧邻初始化决定。 */
      const usage = requestUsage(entry.request?.usage ?? entry.node?.usage)
      cumulativeUsage = addUsage(cumulativeUsage, usage)
      if (entry.request?.purpose !== 'compaction') {
        /** 中文说明：组件局部值 request，由紧邻初始化决定。 */
        const request = entry.request
        /** 中文说明：组件局部值 node，由紧邻初始化决定。 */
        const node = entry.node
        /** 中文说明：组件局部值 turn，由紧邻初始化决定。 */
        const turn = request?.turn ?? node?.turn
        /** 中文说明：组件局部值 step，由紧邻初始化决定。 */
        const step = request?.step ?? node?.step
        if (turn === undefined || step === undefined) continue
        /** 中文说明：组件局部值 provider，由紧邻初始化决定。 */
        const provider = request?.provenance?.provider ?? node?.provenance?.provider
        /** 中文说明：组件局部值 model，由紧邻初始化决定。 */
        const model = request?.provenance?.model ?? node?.provenance?.model
        /** 中文说明：组件局部值 requestConfig，由紧邻初始化决定。 */
        const requestConfig = request?.requestConfig ?? node?.requestConfig
        numbered.push({
          seq: entry.seq,
          turn,
          step,
          group: `Step ${step}`,
          number: index + 1,
          ...(request?.status === undefined ? {} : { status: request.status }),
          ...(request?.startedAt === undefined ? {} : { startedAt: request.startedAt }),
          ...(request?.completedAt === undefined ? {} : { completedAt: request.completedAt }),
          ...(request?.error === undefined ? {} : { error: request.error }),
          ...(request?.resultSeq === undefined ? {} : { resultSeq: request.resultSeq }),
          ...(request?.retry === undefined ? {} : { retry: request.retry }),
          ...(request?.maxRetries === undefined ? {} : { maxRetries: request.maxRetries }),
          ...(request?.retryDelayMs === undefined
            ? {}
            : { retryDelayMs: request.retryDelayMs }),
          ...(provider === undefined ? {} : { provider }),
          ...(model === undefined ? {} : { model }),
          ...(requestConfig === undefined ? {} : { requestConfig }),
          ...(usage === undefined ? {} : { usage }),
          ...(cumulativeUsage === undefined ? {} : { cumulativeUsage }),
        })
        continue
      }
      /** 中文说明：组件局部值 request，由紧邻初始化决定。 */
      const request = entry.request
      numbered.push({
        seq: request.startSeq,
        turn: request.turn,
        step: 0,
        group: `Compaction ${request.startSeq}`,
        number: index + 1,
        purpose: 'compaction',
        status: request.status,
        startedAt: request.startedAt,
        completedAt: request.completedAt,
        ...(request.error === undefined ? {} : { error: request.error }),
        resultSeq: request.startSeq,
        ...(request.provenance?.provider === undefined
          ? {}
          : { provider: request.provenance.provider }),
        ...(request.provenance?.model === undefined
          ? {}
          : { model: request.provenance.model }),
        ...(request.requestConfig === undefined ? {} : { requestConfig: request.requestConfig }),
        ...(usage === undefined ? {} : { usage }),
        ...(cumulativeUsage === undefined ? {} : { cumulativeUsage }),
      })
    }

    return numbered
  }, [
    nodes, requests,
  ])
  /** 中文说明：组件局部值 partialTurn，由紧邻初始化决定。 */
  const partialTurn = partial?.turn ?? null
  /** 中文说明：组件局部值 partialStep，由紧邻初始化决定。 */
  const partialStep = partial?.step ?? null
  /** 中文说明：组件局部值 finalized，由紧邻初始化决定。 */
  const finalized = useMemo(() => {
    /** 中文说明：组件局部值 turns，由紧邻初始化决定。 */
    const turns = deriveTrajectoryLayout({
      nodes,
      eventLocations,
      partial: partialTurn === null || partialStep === null
        ? null
        : { turn: partialTurn, step: partialStep, blocks: [] },
      runningCalls,
      requests,
      callSchemas,
    })
    return { turns, lastIndex: lastCellIndex(turns) }
  }, [
    nodes, eventLocations, partialTurn, partialStep,
    runningCalls, requests, callSchemas,
  ])
  /** 中文说明：组件局部值 timelinePartialSignature，由紧邻初始化决定。 */
  const timelinePartialSignature = partialStructureSignature(partial)
  /** 中文说明：组件局部值 timelinePartial，由紧邻初始化决定。 */
  const timelinePartial = useMemo<ConversationSnapshot['partial']>(() => partial === null
    ? null
    : {
      turn: partial.turn,
      step: partial.step,
      blocks: partial.blocks.map(block => timelineBlock(block)),
    },
  [partialStep, partialTurn, timelinePartialSignature])
  /** 中文说明：组件局部值 timelineTurns，由紧邻初始化决定。 */
  const timelineTurns = useMemo(
    () => appendTrajectoryPartialLayout(finalized.turns, timelinePartial, finalized.lastIndex),
    [finalized, timelinePartial],
  )
  /** 中文说明：组件局部值 timelineMode，由紧邻初始化决定。 */
  const timelineMode: TrajectoryTimelineMode = actualDuration
    ? actualTime ? 'actual' : 'duration'
    : actualTime ? 'time' : 'sequence'
  /** 中文说明：组件局部值 partialSearchTurns，由紧邻初始化决定。 */
  const partialSearchTurns = useMemo(
    () => appendTrajectoryPartialLayout([], partial, finalized.lastIndex),
    [finalized.lastIndex, partial],
  )
  /** 中文说明：组件局部值 searchLayouts，由紧邻初始化决定。 */
  const searchLayouts = useMemo(
    () => [finalized.turns, partialSearchTurns] as const,
    [finalized, partialSearchTurns],
  )
  /** 中文说明：组件局部值 latestSearchLayouts，由紧邻初始化决定。 */
  const latestSearchLayouts = useRef(searchLayouts)
  latestSearchLayouts.current = searchLayouts
  useEffect(() => {
    if (!searchIndexInitialized.current) {
      searchIndexInitialized.current = true
      if (searchIndex.update(searchLayouts)) {
        setSearchIndexRevision(revision => revision + 1)
      }
      return
    }
    if (searchIndexTimer.current !== null) return
    searchIndexTimer.current = setTimeout(() => {
      searchIndexTimer.current = null
      if (searchIndex.update(latestSearchLayouts.current)) {
        setSearchIndexRevision(revision => revision + 1)
      }
    }, SEARCH_INDEX_THROTTLE_MS)
  }, [searchIndex, searchLayouts])
  useEffect(() => () => {
    if (searchIndexTimer.current !== null) clearTimeout(searchIndexTimer.current)
  }, [])
  /** 中文说明：组件局部值 streamingCells，由紧邻初始化决定。 */
  const streamingCells = useMemo(
    () => partialSearchTurns.flatMap(turn =>
      turn.groups.flatMap(group => group.cells),
    ),
    [partialSearchTurns],
  )
  /** 中文说明：组件局部值 searchMatchRecordIds，由紧邻初始化决定。 */
  const searchMatchRecordIds = useMemo(
    () => searchIndex.search(searchQuery),
    [searchIndex, searchIndexRevision, searchQuery],
  )
  /** 中文说明：组件局部值 searchMatchIndexes，由紧邻初始化决定。 */
  const searchMatchIndexes = useMemo(() => {
    if (searchMatchRecordIds === null) return null
    /** 中文说明：组件局部值 indexes，由紧邻初始化决定。 */
    const indexes = new Set<number>()
    /** 中文说明：组件局部值 turns，由紧邻初始化决定。 */
    for (const turns of searchLayouts) {
      /** 中文说明：组件局部值 turn，由紧邻初始化决定。 */
      for (const turn of turns) {
        /** 中文说明：组件局部值 group，由紧邻初始化决定。 */
        for (const group of turn.groups) {
          /** 中文说明：组件局部值 cell，由紧邻初始化决定。 */
          for (const cell of group.cells) {
            if (searchMatchRecordIds.has(trajectoryRecordId(cell))) indexes.add(cell.index)
          }
        }
      }
    }
    return indexes
  }, [searchLayouts, searchMatchRecordIds])
  /** 中文说明：组件局部值 timelineRange，由紧邻初始化决定。 */
  const timelineRange = timelineSelection
  /** 中文说明：组件局部值 timelineFocusIndexes，由紧邻初始化决定。 */
  const timelineFocusIndexes = useMemo(
    () => timelineRange === null
      ? null
      : trajectoryTimelineFocusIndexes(timelineTurns, timelineRange, timelineMode),
    [timelineMode, timelineRange, timelineTurns],
  )
  /** 中文说明：组件局部值 handleRecordSelect，由紧邻初始化决定。 */
  const handleRecordSelect = useCallback((index: number) => {
    if (
      timelineFocusIndexes !== null
      && !timelineFocusIndexes.has(index)
    ) {
      setTimelineSelection(null)
    }
  }, [timelineFocusIndexes])
  /** 中文说明：组件局部值 handleTimelineRangeChange，由紧邻初始化决定。 */
  const handleTimelineRangeChange = useCallback((range: TrajectoryTimeRange | null) => {
    setTimelineSelection(range)
  }, [])
  /** 中文说明：组件局部值 解构结果，由紧邻初始化决定。 */
  const handleTimelineRecordSelect = useCallback((index: number) => {
    setTimelineSelection(null)
    setTimelineRecordSelection({ index })
    setSelectedTimelineIndex(index)
  }, [])
  /** 中文说明：组件局部值 handleTimelineRecordFocus，由紧邻初始化决定。 */
  const handleTimelineRecordFocus = useCallback((index: number) => {
    setTimelineRecordFocus({ index })
  }, [])
  /** 中文说明：组件局部值 collapsibleTurnIds，由紧邻初始化决定。 */
  const collapsibleTurnIds = useMemo(
    () => timelineTurns
      .filter(turn =>
        turn.turn !== null
        &&
        turn.groups.reduce(
          (count, group) =>
            count + group.cells.filter(cell =>
              cell.requestOnly !== true && cell.kind !== 'system').length,
          0,
        ) > 1)
      .flatMap(turn => turn.turn === null ? [] : [turn.turn]),
    [timelineTurns],
  )
  /** 中文说明：组件局部值 allTurnsCollapsed，由紧邻初始化决定。 */
  const allTurnsCollapsed = collapsibleTurnIds.length > 0
    && collapsibleTurnIds.every(turn => collapsedTurns.has(turn))
  /** 中文说明：组件局部值 collapsibleAssistantIds，由紧邻初始化决定。 */
  const collapsibleAssistantIds = useMemo(() => {
    /** 中文说明：组件局部值 ids，由紧邻初始化决定。 */
    const ids: string[] = []
    /** 中文说明：组件局部值 turn，由紧邻初始化决定。 */
    for (const turn of timelineTurns) {
      /** 中文说明：组件局部值 cells，由紧邻初始化决定。 */
      const cells = turn.groups.flatMap(group => group.cells)
      /** 中文说明：组件局部值 i，由紧邻初始化决定。 */
      for (let i = 0; i < cells.length; i++) {
        /** 中文说明：组件局部值 cell，由紧邻初始化决定。 */
        const cell = cells[i]
        if (cell?.kind !== 'message') continue
        /** 中文说明：组件局部值 next，由紧邻初始化决定。 */
        const next = cells[i + 1]
        if (next?.kind === 'tool' || next?.kind === 'subtool') {
          ids.push(trajectoryRecordId(cell))
        }
      }
    }
    return ids
  }, [timelineTurns])
  /** 中文说明：组件局部值 allAssistantsCollapsed，由紧邻初始化决定。 */
  const allAssistantsCollapsed = collapsibleAssistantIds.length > 0
    && collapsibleAssistantIds.every(index => collapsedAssistants.has(index))

  /** 中文说明：组件局部值 toggleTurn，由紧邻初始化决定。 */
  const toggleTurn = (turn: number) => {
    setCollapsedTurns((current) => {
      /** 中文说明：组件局部值 collapsed，由紧邻初始化决定。 */
      const collapsed = new Set(current)
      if (collapsed.has(turn)) collapsed.delete(turn)
      else collapsed.add(turn)
      return collapsed
    })
  }

  /** 中文说明：组件局部值 toggleAllTurns，由紧邻初始化决定。 */
  const toggleAllTurns = () => {
    setCollapsedTurns((current) => {
      /** 中文说明：组件局部值 collapsed，由紧邻初始化决定。 */
      const collapsed = new Set(current)
      if (allTurnsCollapsed) {
        /** 中文说明：组件局部值 turn，由紧邻初始化决定。 */
        for (const turn of collapsibleTurnIds) collapsed.delete(turn)
      } else {
        /** 中文说明：组件局部值 turn，由紧邻初始化决定。 */
        for (const turn of collapsibleTurnIds) collapsed.add(turn)
      }
      return collapsed
    })
  }

  /** 中文说明：组件局部值 toggleAssistant，由紧邻初始化决定。 */
  const toggleAssistant = (id: string) => {
    setCollapsedAssistants((current) => {
      /** 中文说明：组件局部值 collapsed，由紧邻初始化决定。 */
      const collapsed = new Set(current)
      if (collapsed.has(id)) collapsed.delete(id)
      else collapsed.add(id)
      return collapsed
    })
  }

  /** 中文说明：组件局部值 toggleAllAssistants，由紧邻初始化决定。 */
  const toggleAllAssistants = () => {
    setCollapsedAssistants((current) => {
      /** 中文说明：组件局部值 collapsed，由紧邻初始化决定。 */
      const collapsed = new Set(current)
      if (allAssistantsCollapsed) {
        /** 中文说明：组件局部值 index，由紧邻初始化决定。 */
        for (const index of collapsibleAssistantIds) collapsed.delete(index)
      } else {
        /** 中文说明：组件局部值 index，由紧邻初始化决定。 */
        for (const index of collapsibleAssistantIds) collapsed.add(index)
      }
      return collapsed
    })
  }

  /** 中文说明：组件局部值 loadEarlierHistory，由紧邻初始化决定。 */
  const loadEarlierHistory = useCallback(() => {
    return loadOlder()
  }, [loadOlder])

  return (
    <div className={css.root} data-conversation-composer-overlay="">
      <TrajectoryToolbar
        actualDuration={actualDuration}
        onActualDurationChange={(nextActualDuration) => {
          setActualDuration(nextActualDuration)
          setTimelineSelection(null)
        }}
        actualTime={actualTime}
        onActualTimeChange={(nextActualTime) => {
          setActualTime(nextActualTime)
          setTimelineSelection(null)
        }}
        allTurnsCollapsed={allTurnsCollapsed}
        onToggleAllTurns={toggleAllTurns}
        allAssistantsCollapsed={allAssistantsCollapsed}
        onToggleAllAssistants={toggleAllAssistants}
        searchQuery={searchQuery}
        onSearchQueryChange={setSearchQuery}
        t={t}
      />
      <TrajectoryTimeline
        turns={timelineTurns}
        mode={timelineMode}
        range={timelineRange}
        hasEarlierRecords={hasOlderHistory}
        onLoadEarlier={loadEarlierHistory}
        selectedIndex={selectedTimelineIndex}
        searchMatchIndexes={searchMatchIndexes}
        onRangeChange={handleTimelineRangeChange}
        onRecordSelect={handleTimelineRecordSelect}
        onRecordFocus={handleTimelineRecordFocus}
      />
      <div className={css.ledger}>
        <TrajectoryTable
          requestNumbers={requestNumbers}
          turns={timelineTurns}
          streamingCells={streamingCells}
          timelineFocusIndexes={timelineFocusIndexes}
          searchMatchIndexes={searchMatchIndexes}
          onSelectedIndexChange={setSelectedTimelineIndex}
          onRecordSelect={handleRecordSelect}
          recordSelection={timelineRecordSelection}
          recordFocus={timelineRecordFocus}
          historyLoading={historyLoading}
          olderHistoryLoading={olderHistoryLoading}
          historyStartSeq={historyBaseSeq}
          hasOlderRecords={hasOlderHistory}
          onLoadOlder={loadEarlierHistory}
          onClearSelection={() => { setTimelineSelection(null) }}
          collapsedTurns={collapsedTurns}
          onToggleTurn={toggleTurn}
          collapsedAssistants={collapsedAssistants}
          onToggleAssistant={toggleAssistant}
          inspectCallId={inspect?.callId ?? null}
          onInspectApplied={onInspectDone}
        />
      </div>
    </div>
  )
}
