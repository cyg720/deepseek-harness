/** Trajectory view: compact summary over a turn-aware event ledger. */

/*
 * 【文件职责】组合轨迹摘要、按轮次事件表及会话控制，控制能力通过插槽属性注入。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  AssistantBlock, AssistantMessageNode, ConvViewProps, MessageImageLoader, RenderMessageImages,
  ToolCallBlock,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { InjectFace, PropsLocale, PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
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
import type { TrajectorySnapshot } from './trajectory-contract.ts'
import css from './views.module.css'

/** 中文说明：组件局部值 EMPTY_TURN_IDS，由紧邻初始化决定。 */
const EMPTY_TURN_IDS: ReadonlySet<number> = new Set()
/** 中文说明：组件局部值 EMPTY_RECORD_IDS，由紧邻初始化决定。 */
const EMPTY_RECORD_IDS: ReadonlySet<string> = new Set()
/** 中文说明：组件局部值 SEARCH_INDEX_THROTTLE_MS，由紧邻初始化决定。 */
const SEARCH_INDEX_THROTTLE_MS = 3_000
const HISTORY_PAGE_NODES = 50

function containsCall(calls: readonly ToolCallBlock[], callId: string): boolean {
  for (const call of calls) {
    if (call.callId === callId || containsCall(call.subCalls, callId)) return true
  }
  return false
}

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

function partialStructureSignature(partial: TrajectorySnapshot['partial']): string {
  if (partial === null) return ''
  return partial.blocks.map(block => block.kind === 'tool-call'
    ? `${block.kind}:${block.callId}:${block.name}`
    : block.kind).join('\u0000')
}

/** Session-bound controls not already supplied by the conversation view slot. */
/* 中文说明：类型或类 TrajectoryViewInjected 约束模块数据或组件职责。 */
export interface TrajectoryViewInjected {
  hooks: {
    duration: SnapshotStore<boolean>
  }
  loadOlder: () => Promise<boolean>
  loadImage: MessageImageLoader
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
  useSession, useTrajectory, useDuration, loadOlder, loadImage, setActualDuration,
  viewRequest, completeViewRequest, renderSlot, t,
}: ConvViewProps
  & PropsRenderSlots<'conversation.trajectory.images'>
  & InjectFace<TrajectoryViewInjected>
  & PropsLocale<'trajectory'>) {
  const [collapsedTurns, setCollapsedTurns] = useState<ReadonlySet<number>>(EMPTY_TURN_IDS)
  const renderImages = useCallback<RenderMessageImages>(
    owner => renderSlot('conversation.trajectory.images', { ...owner, loadImage }),
    [loadImage, renderSlot],
  )
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
  const completeInspection = useTrajectory(snapshot => snapshot)
  const latestNodeSeq = completeInspection.eventNodes.at(-1)?.seq
  const [historyTailSeq, setHistoryTailSeq] = useState(latestNodeSeq)
  const [historyNodeLimit, setHistoryNodeLimit] = useState(HISTORY_PAGE_NODES)
  const fixedTailSeq = historyTailSeq ?? latestNodeSeq
  const historyTailIndex = fixedTailSeq === undefined
    ? -1
    : completeInspection.eventNodes.findLastIndex(node => node.seq <= fixedTailSeq)
  const historyEndIndex = historyTailIndex < 0 && latestNodeSeq !== undefined
    ? completeInspection.eventNodes.length
    : historyTailIndex + 1
  const historyStartIndex = Math.max(0, historyEndIndex - historyNodeLimit)
  useEffect(() => {
    if (latestNodeSeq !== undefined && (historyTailSeq === undefined || historyTailIndex < 0)) {
      setHistoryTailSeq(latestNodeSeq)
    }
  }, [historyTailIndex, historyTailSeq, latestNodeSeq])
  const inspection = useMemo<TrajectorySnapshot>(() => {
    if (historyStartIndex === 0) return completeInspection
    const eventNodes = completeInspection.eventNodes.slice(historyStartIndex)
    const firstSeq = eventNodes[0]?.seq ?? 0
    return {
      ...completeInspection,
      eventNodes,
      requests: completeInspection.requests.filter(request =>
        request.startSeq >= firstSeq || (request.resultSeq ?? -1) >= firstSeq),
    }
  }, [completeInspection, historyStartIndex])
  const historyLoading = useSession(snapshot => snapshot.openState === 'loading')
  /** 中文说明：组件局部值 olderHistoryLoading，由紧邻初始化决定。 */
  const olderHistoryLoading = useSession(snapshot => snapshot.loadingOlder)
  const sessionHasOlderHistory = useSession(snapshot => snapshot.hasMore)
  const hasResidentOlderHistory = historyStartIndex > 0
  const hasOlderHistory = hasResidentOlderHistory
    || sessionHasOlderHistory
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
  const inspectCallId = viewRequest?.view === 'trajectory' ? viewRequest.focus : null
  const inspectNodeIndex = useMemo(() => inspectCallId === null
    ? -1
    : completeInspection.eventNodes.findIndex(node => node.kind === 'assistant'
      ? node.blocks.some(block => block.kind === 'tool-call' && block.callId === inspectCallId)
      : node.kind === 'tool-result' && containsCall([node], inspectCallId)),
  [completeInspection.eventNodes, inspectCallId])
  useEffect(() => {
    if (inspectNodeIndex < 0 || inspectNodeIndex >= historyStartIndex) return
    setHistoryNodeLimit(limit => limit + historyStartIndex - inspectNodeIndex)
  }, [historyStartIndex, inspectNodeIndex])
  const requestNumbers = useMemo<readonly TrajectoryRequestNumber[]>(() => {
    /** 中文说明：组件局部值 assistantsByStep，由紧邻初始化决定。 */
    const assistantsByStep = new Map<string, AssistantMessageNode>()
    for (const node of completeInspection.eventNodes) {
      if (node.kind !== 'assistant' || node.step <= 0) continue
      assistantsByStep.set(`${node.turn}\u0000${node.step}`, node)
    }
    /** 中文说明：组件局部值 requestsByStep，由紧邻初始化决定。 */
    const requestsByStep = new Map(
      completeInspection.requests
        .filter(request => request.purpose === 'assistant')
        .map(request => [
          `${request.turn}\u0000${request.step}`,
          request,
        ]),
    )
    /** 中文说明：组件局部值 orderedRequests，由紧邻初始化决定。 */
    const orderedRequests = [
      ...completeInspection.requests.map(request => ({
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
          group: t('group.step', { step }),
          number: index + 1,
          ...(request?.status === undefined ? {} : { status: request.status }),
          ...(request?.startedAt === undefined ? {} : { startedAt: request.startedAt }),
          ...(request?.completedAt === undefined ? {} : { completedAt: request.completedAt }),
          ...(request?.error === undefined ? {} : { error: request.error }),
          ...(request?.errorCode === undefined ? {} : { errorCode: request.errorCode }),
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
        group: t('group.compaction', { seq: request.startSeq }),
        number: index + 1,
        purpose: 'compaction',
        status: request.status,
        startedAt: request.startedAt,
        completedAt: request.completedAt,
        ...(request.error === undefined ? {} : { error: request.error }),
        ...(request.errorCode === undefined ? {} : { errorCode: request.errorCode }),
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
    completeInspection.eventNodes, completeInspection.requests, t,
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
    }, t)
    return { turns, lastIndex: lastCellIndex(turns) }
  }, [
    nodes, eventLocations, partialTurn, partialStep,
    runningCalls, requests, callSchemas, t,
  ])
  /** 中文说明：组件局部值 timelinePartialSignature，由紧邻初始化决定。 */
  const timelinePartialSignature = partialStructureSignature(partial)
  const timelinePartial = useMemo<TrajectorySnapshot['partial']>(() => partial === null
    ? null
    : {
      turn: partial.turn,
      step: partial.step,
      blocks: partial.blocks.map(block => timelineBlock(block)),
    },
  [partialStep, partialTurn, timelinePartialSignature])
  /** 中文说明：组件局部值 timelineTurns，由紧邻初始化决定。 */
  const timelineTurns = useMemo(
    () => appendTrajectoryPartialLayout(finalized.turns, timelinePartial, finalized.lastIndex, t),
    [finalized, timelinePartial, t],
  )
  /** 中文说明：组件局部值 timelineMode，由紧邻初始化决定。 */
  const timelineMode: TrajectoryTimelineMode = actualDuration
    ? actualTime ? 'actual' : 'duration'
    : actualTime ? 'time' : 'sequence'
  /** 中文说明：组件局部值 partialSearchTurns，由紧邻初始化决定。 */
  const partialSearchTurns = useMemo(
    () => appendTrajectoryPartialLayout([], partial, finalized.lastIndex, t),
    [finalized.lastIndex, partial, t],
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

  const loadEarlierHistory = useCallback(async () => {
    if (!hasResidentOlderHistory && !await loadOlder()) return false
    setHistoryNodeLimit(limit => limit + HISTORY_PAGE_NODES)
    return true
  }, [hasResidentOlderHistory, loadOlder])

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
        t={t}
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
          t={t}
          renderImages={renderImages}
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
          inspectCallId={inspectCallId}
          onInspectApplied={completeViewRequest}
        />
      </div>
    </div>
  )
}
