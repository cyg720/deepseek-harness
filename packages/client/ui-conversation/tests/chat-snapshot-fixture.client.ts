/**
 * 文件职责：验证会话界面的 chat-snapshot-fixture.client.ts 行为和边界。
 * 技术维度：Vitest、React 测试渲染、事件模拟与可控服务替身。
 * 产品维度：防止会话界面交互和展示在扩展后回归。
 * 逻辑维度：构造状态，触发渲染或交互，再断言输出和清理。
 * 关键边界：全局替身、计时器和异步任务必须在用例后恢复。
 * 新手阅读建议：先读辅助夹具，再按 describe 场景顺序阅读。
 */
import type {
  AssistantMessageNode, ChatConversationViewNode, ChatSnapshot, ConversationNode,
  ChatLocationNodeIndex, ChatNodeStore, CompactionSummaryNode, ConversationLocationDataStore,
  ConversationTurnDataMap, LegacyConversationSlice, PartialAssistant, RunningToolCall,
  ToolCallBlock, TurnLocation,
} from '@deepseek-ai/dsh-client-runtime/client'
import { deriveTurnMetrics } from '../src/client/chat/turn-metrics.ts'

/** 中文说明：测试局部值 EMPTY，取值由紧邻初始化决定。 */
const EMPTY: readonly never[] = []

/** 中文说明：函数 sameValues 的参数见签名，返回结果供相邻流程使用；示例见本文件调用处。 */
function sameValues<T>(left: readonly T[], right: readonly T[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

/** 中文说明：函数 nodeSource 的参数见签名，返回结果供相邻流程使用；示例见本文件调用处。 */
function nodeSource(node: ChatConversationViewNode): unknown {
  if (node.kind === 'assistant-step') {
    /** 中文说明：测试局部值 data，取值由紧邻初始化决定。 */
    const data = node.data as ReturnType<typeof assistantData>
    return data.finalNode ?? data.blocks
  }
  if (node.kind === 'tool-call') return (node.data as { readonly root: ToolCallBlock }).root
  if (node.kind === 'model-retry') return (node.data as { readonly current: unknown }).current
  if (node.kind === 'turn-tail') return (node.data as { readonly seq: number }).seq
  return node.data
}

/** 中文说明：类型或类 FixtureNodeStore 约束本文件的数据或组件职责。 */
class FixtureNodeStore implements ChatNodeStore {
  private byKey = new Map<string, ChatConversationViewNode>()
  private list: readonly ChatConversationViewNode[] = EMPTY

  get(key: string): ChatConversationViewNode | undefined {
    return this.byKey.get(key)
  }

  values(): readonly ChatConversationViewNode[] {
    return this.list
  }

  replace(candidates: readonly ChatConversationViewNode[]): void {
    /** 中文说明：测试局部值 next，取值由紧邻初始化决定。 */
    const next = new Map<string, ChatConversationViewNode>()
    /** 中文说明：有序集合 list，取值由紧邻初始化决定。 */
    const list = candidates.map((candidate) => {
      /** 中文说明：测试局部值 previous，取值由紧邻初始化决定。 */
      const previous = this.byKey.get(candidate.key)
      /** 中文说明：测试局部值 node，取值由紧邻初始化决定。 */
      const node = previous !== undefined
        && previous.kind === candidate.kind
        && previous.anchorSeq === candidate.anchorSeq
        && previous.visibility === candidate.visibility
        && nodeSource(previous) === nodeSource(candidate)
        ? previous
        : candidate
      next.set(node.key, node)
      return node
    })
    this.byKey = next
    this.list = sameValues(this.list, list) ? this.list : list
  }
}

/** 中文说明：类型或类 FixtureLocationIndex 约束本文件的数据或组件职责。 */
class FixtureLocationIndex implements ChatLocationNodeIndex {
  private turns = new Map<number, readonly string[]>()

  getTurn(turn: number): readonly string[] {
    return this.turns.get(turn) ?? EMPTY
  }

  getStep(): readonly string[] {
    return EMPTY
  }

  replace(next: ReadonlyMap<number, readonly string[]>): void {
    /** 中文说明：测试局部值 stable，取值由紧邻初始化决定。 */
    const stable = new Map<number, readonly string[]>()
    /** 中文说明：测试局部值 [turn，取值由紧邻初始化决定。 */
    for (const [turn, keys] of next) {
      /** 中文说明：测试局部值 previous，取值由紧邻初始化决定。 */
      const previous = this.turns.get(turn) ?? EMPTY
      stable.set(turn, sameValues(previous, keys) ? previous : keys)
    }
    this.turns = stable
  }
}

/** 中文说明：类型或类 FixtureTurnDataStore 约束本文件的数据或组件职责。 */
class FixtureTurnDataStore implements ConversationLocationDataStore<ConversationTurnDataMap> {
  private readonly values = new Map<string, unknown>()

  get<Key extends Extract<keyof ConversationTurnDataMap, string>>(
    key: Key,
  ): Readonly<ConversationTurnDataMap[Key]> | undefined {
    return this.values.get(key) as Readonly<ConversationTurnDataMap[Key]> | undefined
  }

  set<Key extends Extract<keyof ConversationTurnDataMap, string>>(
    key: Key,
    value: ConversationTurnDataMap[Key],
  ): void {
    this.values.set(key, value)
  }
}

/** 中文说明：函数 assistantData 的参数见签名，返回结果供相邻流程使用；示例见本文件调用处。 */
function assistantData(node: AssistantMessageNode) {
  return {
    status: node.interrupted === true ? 'interrupted' as const : 'settled' as const,
    turn: node.turn,
    step: node.step,
    blocks: node.blocks,
    time: node.time,
    finalNode: node,
  }
}

/** 中文说明：函数 settledNode 的参数见签名，返回结果供相邻流程使用；示例见本文件调用处。 */
function settledNode(
  node: ConversationNode,
  turns: ReadonlyMap<number, TurnLocation>,
): ChatConversationViewNode {
  /** 中文说明：测试局部值 turn，取值由紧邻初始化决定。 */
  const turn = 'turn' in node && typeof node.turn === 'number' ? turns.get(node.turn) : undefined
  /** 中文说明：测试局部值 base，取值由紧邻初始化决定。 */
  const base = {
    key: `fixture:${node.kind}:${node.seq}`,
    id: String(node.seq),
    target: 'chat' as const,
    anchorSeq: node.seq,
    location: turn === undefined
      ? { kind: 'session' as const }
      : { kind: 'turn' as const, turn },
    visibility: 'visible' as const,
  }
  switch (node.kind) {
    case 'assistant':
      return { ...base, kind: 'assistant-step', data: assistantData(node) }
    case 'tool-result':
      return { ...base, key: `fixture:tool:${node.callId}`, kind: 'tool-call', data: { root: node } }
    case 'model-retry':
      return { ...base, key: 'fixture:model-retry', kind: 'model-retry', data: { attempts: [node], current: node } }
    default:
      return { ...base, kind: node.kind, data: node }
  }
}

/** Build the canonical Chat fixture corresponding to one legacy test slice. */
/** 中文说明：函数 chatSnapshotFixture 的参数见签名，返回结果供相邻流程使用；示例见本文件调用处。 */
export function chatSnapshotFixture(input: {
  readonly nodes?: readonly ConversationNode[]
  readonly partial?: PartialAssistant | null
  readonly runningCalls?: readonly RunningToolCall[]
  readonly turnTimings?: LegacyConversationSlice['turnTimings']
  readonly turnEnds?: LegacyConversationSlice['turnEnds']
} = {}, previous?: ChatSnapshot): ChatSnapshot {
  /** 中文说明：测试局部值 legacy，取值由紧邻初始化决定。 */
  const legacy: LegacyConversationSlice = {
    nodes: input.nodes ?? EMPTY,
    partial: input.partial ?? null,
    runningCalls: input.runningCalls ?? EMPTY,
    turnTimings: input.turnTimings ?? new Map(),
    turnEnds: input.turnEnds ?? new Map(),
  }
  /** 中文说明：测试局部值 turnNumbers，取值由紧邻初始化决定。 */
  const turnNumbers = new Set([...legacy.turnTimings.keys(), ...legacy.turnEnds.keys()])
  /** 中文说明：测试局部值 node，取值由紧邻初始化决定。 */
  for (const node of legacy.nodes) {
    if ('turn' in node && typeof node.turn === 'number') turnNumbers.add(node.turn)
  }
  if (legacy.partial !== null) turnNumbers.add(legacy.partial.turn)
  /** 中文说明：测试局部值 call，取值由紧邻初始化决定。 */
  for (const call of legacy.runningCalls) turnNumbers.add(call.turn)
  /** 中文说明：测试局部值 turns，取值由紧邻初始化决定。 */
  const turns = new Map<number, TurnLocation>()
  /** 中文说明：测试局部值 turnData，取值由紧邻初始化决定。 */
  const turnData = new Map<number, FixtureTurnDataStore>()
  /** 中文说明：测试局部值 turn，取值由紧邻初始化决定。 */
  for (const turn of [...turnNumbers].sort((left, right) => left - right)) {
    /** 中文说明：测试局部值 timing，取值由紧邻初始化决定。 */
    const timing = legacy.turnTimings.get(turn)
    /** 中文说明：测试局部值 endSeq，取值由紧邻初始化决定。 */
    const endSeq = legacy.turnEnds.get(turn)
    /** 中文说明：测试局部值 data，取值由紧邻初始化决定。 */
    const data = new FixtureTurnDataStore()
    turnData.set(turn, data)
    turns.set(turn, {
      turn,
      start: timing === undefined ? undefined : {
        type: 'turn/start', seq: Math.max(0, (endSeq ?? 1) - 1), time: timing.startTime, turn,
      } as never,
      end: timing?.endTime === undefined || endSeq === undefined ? undefined : {
        type: 'turn/end', seq: endSeq, time: timing.endTime, turn, reason: 'completed',
      } as never,
      status: endSeq === undefined ? 'open' : 'closed',
      steps: EMPTY,
      data,
    })
  }
  /** 中文说明：测试局部值 linkedCompactions，取值由紧邻初始化决定。 */
  const linkedCompactions = new Set<CompactionSummaryNode>()
  /** 中文说明：有序集合 nodes，取值由紧邻初始化决定。 */
  const nodes = legacy.nodes.flatMap((node): ChatConversationViewNode[] => {
    if (node.kind === 'command' && node.name === 'compact') {
      /** 中文说明：测试局部值 sourceSeq，取值由紧邻初始化决定。 */
      const sourceSeq = node.outcome?.kind === 'success' ? node.outcome.sourceEventSeq : undefined
      /** 中文说明：测试局部值 candidates，取值由紧邻初始化决定。 */
      const candidates = sourceSeq === undefined
        ? []
        : legacy.nodes.filter((candidate): candidate is CompactionSummaryNode =>
          candidate.kind === 'compaction' && candidate.summaryEventSeq === sourceSeq)
      /** 中文说明：测试局部值 compaction，取值由紧邻初始化决定。 */
      const compaction = candidates.length === 1 ? candidates[0] : undefined
      if (node.outcome === null || compaction !== undefined) {
        if (compaction !== undefined) linkedCompactions.add(compaction)
        /** 中文说明：测试局部值 base，取值由紧邻初始化决定。 */
        const base = settledNode(node, turns)
        return [{
          ...base,
          key: `fixture:manual-compaction:${node.commandId}`,
          kind: 'manual-compaction',
          anchorSeq: compaction?.seq ?? node.seq,
          data: { command: node, compaction: compaction ?? null },
        }]
      }
    }
    if (node.kind === 'compaction' && linkedCompactions.has(node)) return []
    return [settledNode(node, turns)]
  })
  if (legacy.partial !== null) {
    /** 中文说明：测试局部值 turn，取值由紧邻初始化决定。 */
    const turn = turns.get(legacy.partial.turn)
    nodes.push({
      key: `fixture:assistant:${legacy.partial.turn}:${legacy.partial.step}`,
      id: `${legacy.partial.turn}:${legacy.partial.step}`,
      target: 'chat',
      kind: 'assistant-step',
      anchorSeq: Number.MAX_SAFE_INTEGER - 1,
      location: turn === undefined ? { kind: 'session' } : { kind: 'turn', turn },
      visibility: 'visible',
      data: {
        status: 'running',
        turn: legacy.partial.turn,
        step: legacy.partial.step,
        blocks: legacy.partial.blocks,
        time: 0,
      },
    })
  }
  /** 中文说明：测试局部值 call，取值由紧邻初始化决定。 */
  for (const call of legacy.runningCalls) {
    /** 中文说明：测试局部值 turn，取值由紧邻初始化决定。 */
    const turn = turns.get(call.turn)
    nodes.push({
      key: `fixture:tool:${call.callId}`,
      id: call.callId,
      target: 'chat',
      kind: 'tool-call',
      anchorSeq: Number.MAX_SAFE_INTEGER,
      location: turn === undefined ? { kind: 'session' } : { kind: 'turn', turn },
      visibility: 'visible',
      data: { root: call },
    })
  }
  /** 中文说明：测试局部值 [turnNumber，取值由紧邻初始化决定。 */
  for (const [turnNumber, endSeq] of legacy.turnEnds) {
    /** 中文说明：测试局部值 turn，取值由紧邻初始化决定。 */
    const turn = turns.get(turnNumber)
    /** 中文说明：状态快照 dataStore，取值由紧邻初始化决定。 */
    const dataStore = turnData.get(turnNumber)
    if (turn === undefined || dataStore === undefined) continue
    /** 中文说明：测试局部值 closing，取值由紧邻初始化决定。 */
    const closing = legacy.nodes
      .filter((candidate): candidate is AssistantMessageNode => candidate.kind === 'assistant'
        && candidate.turn === turnNumber
        && candidate.blocks.some(block => block.kind === 'text' && block.text.trim() !== ''))
      .map(assistantData)
      .at(-1) ?? null
    /** 中文说明：测试局部值 preceding，取值由紧邻初始化决定。 */
    const preceding = nodes.findLast((candidate) => {
      /** 中文说明：测试局部值 location，取值由紧邻初始化决定。 */
      const location = candidate.location
      return (location.kind === 'turn' || location.kind === 'step')
        && location.turn.turn === turnNumber
    })
    /** 中文说明：测试局部值 metrics，取值由紧邻初始化决定。 */
    const metrics = deriveTurnMetrics(legacy.nodes).get(turnNumber)
    /** 中文说明：测试局部值 tailData，取值由紧邻初始化决定。 */
    const tailData = {
      turn: turnNumber,
      seq: endSeq,
      time: turn.end?.time ?? 0,
      closing,
      branchUnavailable: closing === null
        || preceding?.kind !== 'assistant-step'
        || (preceding.data as ReturnType<typeof assistantData>).finalNode.seq !== closing.finalNode.seq,
      ...metrics?.ttftMs === undefined ? {} : { ttftMs: metrics.ttftMs },
      ...metrics?.tokensPerSecond === undefined ? {} : { tokensPerSecond: metrics.tokensPerSecond },
    }
    dataStore.set('turn-tail', tailData)
    nodes.push({
      key: `fixture:turn-tail:${turnNumber}`,
      id: String(turnNumber),
      target: 'chat',
      kind: 'turn-tail',
      anchorSeq: endSeq,
      location: { kind: 'turn', turn },
      visibility: 'visible',
      data: tailData,
    })
  }
  /** 中文说明：状态快照 store，取值由紧邻初始化决定。 */
  const store = previous?.nodes instanceof FixtureNodeStore ? previous.nodes : new FixtureNodeStore()
  store.replace(nodes)
  /** 中文说明：测试局部值 byKey，取值由紧邻初始化决定。 */
  const byKey = new Map(store.values().map(node => [node.key, node]))
  /** 中文说明：测试局部值 nextOrder，取值由紧邻初始化决定。 */
  const nextOrder = nodes.map(node => node.key)
  /** 中文说明：测试局部值 order，取值由紧邻初始化决定。 */
  const order = previous !== undefined && sameValues(previous.order, nextOrder) ? previous.order : nextOrder
  /** 中文说明：测试局部值 byTurn，取值由紧邻初始化决定。 */
  const byTurn = new Map<number, readonly string[]>()
  /** 中文说明：测试局部值 turn，取值由紧邻初始化决定。 */
  for (const turn of turns.keys()) {
    byTurn.set(turn, order.filter((key) => {
      /** 中文说明：测试局部值 location，取值由紧邻初始化决定。 */
      const location = byKey.get(key)?.location
      return location?.kind === 'turn' && location.turn.turn === turn
        || location?.kind === 'step' && location.turn.turn === turn
    }))
  }
  /** 中文说明：测试局部值 locations，取值由紧邻初始化决定。 */
  const locations = previous?.locations instanceof FixtureLocationIndex
    ? previous.locations
    : new FixtureLocationIndex()
  locations.replace(byTurn)
  /** 中文说明：测试局部值 timeline，取值由紧邻初始化决定。 */
  const timeline = previous !== undefined
    && previous.legacy.turnTimings === legacy.turnTimings
    && previous.legacy.turnEnds === legacy.turnEnds
    ? previous.timeline
    : { turnOrder: [...turns.keys()], turns }
  return {
    order,
    nodes: store,
    locations,
    timeline,
    legacy,
  }
}
