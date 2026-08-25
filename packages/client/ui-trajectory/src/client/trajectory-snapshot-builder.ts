/**
 * ================================ 文件注释 ================================
 * 【文件职责】轨迹目标的视图快照构建器 TrajectorySnapshotBuilder：把各状态机产出的
 *             贡献节点（按 anchorSeq 排序）合成阶段式快照 TrajectorySnapshot，并做
 *             请求头匹配、工具 schema 捕获、被打断压缩请求与回合错误的修补。
 * 【技术维度】实现 ConversationViewBuilder 接口（replace / apply）；贡献缓存 + 位置
 *             表做增量更新；快照阶段做按序归并（finalized 节点、requests、runningCalls 等）。
 * 【产品维度】轨迹视图读取快照渲染；构建器保证流式更新时只重算受影响部分。
 * 【逻辑维度】1) 空快照常量与 key 工具；2) 请求头匹配 / 应用；3) schema 捕获与索引；
 *             4) 压缩打断与回合错误修补；5) replace / apply / snapshot / rebuildContributions。
 * 【关键边界】anchorSeq 变化才触发结构性重建；request-header 只挂在同 step 的 assistant
 *             请求上（或前一个更早的请求头）；打断压缩 / 回合错误以就地改写请求数组实现。
 * 【新手阅读建议】先读 snapshot() 的归并循环，再看两个修补函数。
 * ==========================================================================
 */
import type { Context } from '@deepseek-ai/cordis'
import type {
  AssistantMessageNode, ConversationNode, ConversationPromptSnapshot,
  ConversationViewBuilder, ConversationViewDefinition, RequestView,
  ToolCallBlock,
} from '@deepseek-ai/dsh-client-runtime/client'
import type {
  TrajectoryConversationViewNode, TrajectoryRequestHeaderState,
  TrajectorySnapshot,
} from './trajectory-contract.ts'

// 共享的空列表常量：避免每次创建快照都 new 数组（也保证引用稳定）。
const EMPTY_LIST: readonly never[] = []
type AssistantRequest = Extract<RequestView, { purpose: 'assistant' }>
type ToolSchema = ConversationPromptSnapshot['tools'][number]

/** Stable empty target used until a Session has assembled Trajectory records. */
// 会话尚未组装出轨迹记录前的稳定空快照（常量引用，避免反复创建）。
export const EMPTY_TRAJECTORY_SNAPSHOT: TrajectorySnapshot = {
  eventNodes: EMPTY_LIST,
  eventLocations: new Map(),
  requests: EMPTY_LIST,
  callSchemas: new Map(),
  partial: null,
  runningCalls: EMPTY_LIST,
}

// 回合 + 步骤合成一个 step 键（用于关联请求头与请求）。
function stepKey(turn: number, step: number): string {
  return `${turn}\u0000${step}`
}

// 请求头所在位置是 step 时给出 step 键，否则 undefined。
function headerStepKey(header: TrajectoryRequestHeaderState): string | undefined {
  const location = header.location
  return location.kind === 'step'
    ? stepKey(location.turn.turn, location.step.step)
    : undefined
}

// 为一次 assistant 请求找它应挂的请求头：优先同 step 的，否则用更早的最近请求头。
function headerFor(
  request: AssistantRequest,
  headersByStep: ReadonlyMap<string, TrajectoryRequestHeaderState>,
  previous: TrajectoryRequestHeaderState | undefined,
): TrajectoryRequestHeaderState | undefined {
  return headersByStep.get(stepKey(request.turn, request.step))
    ?? (previous !== undefined && previous.seq < request.startSeq ? previous : undefined)
}

// 把请求头快照应用到请求上（覆盖 prompt / requestConfig，可选附上 promptChange）。
function applyHeader(
  request: AssistantRequest,
  header: TrajectoryRequestHeaderState | undefined,
  includeChange: boolean,
): AssistantRequest {
  return header === undefined
    ? request
    : {
      ...request,
      prompt: header.prompt,
      requestConfig: header.prompt.config,
      ...(includeChange && header.change !== undefined ? { promptChange: header.change } : {}),
    }
}

function withRequestConfig(
  node: AssistantMessageNode,
  prompt: ConversationPromptSnapshot | undefined,
): AssistantMessageNode {
  return prompt === undefined ? node : { ...node, requestConfig: prompt.config }
}

function captureSchemas(
  block: ToolCallBlock,
  toolsByName: ReadonlyMap<string, ToolSchema>,
  output: Map<string, ToolSchema>,
): void {
  const name = 'kind' in block ? block.call?.name : block.name
  const schema = name === undefined ? undefined : toolsByName.get(name)
  if (schema !== undefined) output.set(block.callId, schema)
  for (const child of block.subCalls) captureSchemas(child, toolsByName, output)
}

function indexTools(tools: readonly ToolSchema[]): ReadonlyMap<string, ToolSchema> {
  return new Map(tools.map(tool => [tool.name, tool]))
}

function interruptCompactions(
  requests: RequestView[],
  boundaries: readonly { seq: number; time: number }[],
): void {
  let nextRequest = 0
  const runningCompactions: number[] = []
  for (const boundary of boundaries) {
    while (nextRequest < requests.length) {
      const request = requests[nextRequest]
      if (request === undefined || request.startSeq >= boundary.seq) break
      if (request.purpose === 'compaction' && request.status === 'running') {
        runningCompactions.push(nextRequest)
      }
      nextRequest++
    }
    let index = runningCompactions.pop()
    while (index !== undefined && requests[index]?.status !== 'running') {
      index = runningCompactions.pop()
    }
    if (index === undefined) continue
    const request = requests[index]
    if (request?.purpose !== 'compaction') continue
    requests[index] = {
      ...request,
      completedAt: boundary.time,
      status: 'error',
      error: 'Compaction was interrupted before completion.',
    }
  }
}

/** 把回合结束事件携带的错误挂到该回合最后一次 assistant 请求上。 */
function applyTurnErrors(
  requests: RequestView[],
  endings: readonly { turn: number; time: number; error?: string }[],
): void {
  const lastAssistantByTurn = new Map<number, number>()
  for (const [index, request] of requests.entries()) {
    if (request.purpose === 'assistant') lastAssistantByTurn.set(request.turn, index)
  }
  for (const ending of endings) {
    if (ending.error === undefined) continue
    const index = lastAssistantByTurn.get(ending.turn)
    if (index === undefined) continue
    const request = requests[index]
    if (request?.purpose !== 'assistant') continue
    requests[index] = {
      ...request,
      completedAt: request.completedAt ?? ending.time,
      status: 'error',
      error: ending.error,
    }
  }
}

/** Simple keyed adapter retaining the old Trajectory snapshot and stage layout. */
/*
 * 简单的按键适配器：维护旧式轨迹快照与阶段布局。按 key 缓存贡献节点，按 anchorSeq
 * 排序后合成快照；replace 全量替换，apply 增量 upsert。
 */
export class TrajectorySnapshotBuilder implements ConversationViewBuilder<
  TrajectoryConversationViewNode,
  TrajectorySnapshot
> {
  // key → 贡献节点 的缓存（增量更新的权威状态）。
  private readonly nodes = new Map<string, TrajectoryConversationViewNode>()
  // key → 排序后下标 的位置表（快速定位以就地替换）。
  private readonly positions = new Map<string, number>()
  // 排序后的贡献数组（rebuildContributions 重建）。
  private contributions: TrajectoryConversationViewNode[] = []
  readonly empty = EMPTY_TRAJECTORY_SNAPSHOT

  // 全量替换：清空并按新节点重建排序与快照。
  replace(input: {
    readonly nodes: readonly TrajectoryConversationViewNode[]
  }): TrajectorySnapshot {
    this.nodes.clear()
    for (const node of input.nodes) this.nodes.set(node.key, node)
    this.rebuildContributions()
    return this.snapshot()
  }

  // 增量更新：upsert 节点；只有 anchorSeq 变化或首次出现才需要重建排序，否则就地替换。
  apply(input: {
    readonly upserts: readonly TrajectoryConversationViewNode[]
  }): TrajectorySnapshot {
    let structural = false
    for (const node of input.upserts) {
      const previous = this.nodes.get(node.key)
      this.nodes.set(node.key, node)
      if (previous === undefined || previous.anchorSeq !== node.anchorSeq) {
        structural = true
        continue
      }
      const position = this.positions.get(node.key)
      if (position === undefined) structural = true
      else this.contributions[position] = node
    }
    if (structural) this.rebuildContributions()
    return this.snapshot()
  }

  private snapshot(): TrajectorySnapshot {
    const headersByStep = new Map<string, TrajectoryRequestHeaderState>()
    for (const contribution of this.contributions) {
      if (contribution.data.kind !== 'request-header') continue
      const key = headerStepKey(contribution.data.header)
      if (key !== undefined) headersByStep.set(key, contribution.data.header)
    }
    const finalized: ConversationNode[] = []
    const eventLocations = new Map<number, TrajectoryConversationViewNode['location']>()
    const requests: RequestView[] = []
    const boundaries: { seq: number; time: number }[] = []
    const turnEndings: { turn: number; time: number; error?: string }[] = []
    const callSchemas = new Map<string, ToolSchema>()
    const consumedPromptChanges = new Set<number>()
    let previousHeader: TrajectoryRequestHeaderState | undefined
    let previousTools: ReadonlyMap<string, ToolSchema> = new Map()
    let partial: TrajectorySnapshot['partial'] = null
    const runningCalls: TrajectorySnapshot['runningCalls'][number][] = []

    for (const contribution of this.contributions) {
      const data = contribution.data
      if (data.kind === 'request-header') {
        previousHeader = data.header
        previousTools = indexTools(data.header.prompt.tools)
        continue
      }
      if (data.kind === 'node') {
        finalized.push(data.node)
        eventLocations.set(data.node.seq, contribution.location)
        continue
      }
      if (data.kind === 'assistant') {
        const header = data.request === undefined
          ? undefined
          : headerFor(data.request, headersByStep, previousHeader)
        if (data.node !== undefined) finalized.push(withRequestConfig(data.node, header?.prompt))
        if (data.partial !== null) partial = data.partial
        if (data.request !== undefined) {
          const includeChange = header?.change !== undefined
            && !consumedPromptChanges.has(header.seq)
          requests.push(applyHeader(data.request, header, includeChange))
          if (includeChange) consumedPromptChanges.add(header.seq)
        }
        continue
      }
      if (data.kind === 'tool') {
        if ('kind' in data.root) finalized.push(data.root)
        else runningCalls.push(data.root)
        if (previousHeader !== undefined && previousHeader.seq < contribution.anchorSeq) {
          captureSchemas(data.root, previousTools, callSchemas)
        }
        continue
      }
      if (data.kind === 'compaction') {
        requests.push(data.request)
        continue
      }
      if (data.kind === 'session-end') {
        boundaries.push({ seq: data.seq, time: data.time })
        continue
      }
      turnEndings.push({
        turn: data.turn,
        time: data.time,
        ...(data.error === undefined ? {} : { error: data.error }),
      })
    }

    requests.sort((left, right) => left.startSeq - right.startSeq)
    interruptCompactions(requests, boundaries)
    applyTurnErrors(requests, turnEndings)
    finalized.sort((left, right) => left.seq - right.seq)
    const eventNodes = finalized
    return {
      eventNodes,
      eventLocations,
      requests,
      callSchemas,
      partial,
      runningCalls,
    }
  }

  // 重建排序后的贡献数组与位置表（anchorSeq 升序，同序按 key）。
  private rebuildContributions(): void {
    this.contributions = [...this.nodes.values()]
      .sort((left, right) => left.anchorSeq - right.anchorSeq || left.key.localeCompare(right.key))
    this.positions.clear()
    for (const [index, contribution] of this.contributions.entries()) {
      this.positions.set(contribution.key, index)
    }
  }
}

/** Trajectory target factory preserving the existing stage-oriented view model. */
export const trajectoryViewDefinition: ConversationViewDefinition<
  TrajectoryConversationViewNode,
  TrajectorySnapshot
> = {
  target: 'trajectory',
  create: () => new TrajectorySnapshotBuilder(),
}

/**
 * Register the stage-oriented Trajectory target builder.
 *
 * @param ctx - Plugin context receiving the view Definition.
 */
/*
 * 注册阶段式轨迹目标构建器。
 * @param ctx - 接收该视图 Definition 的插件上下文。
 */
export function registerTrajectoryConversationView(ctx: Context): void {
  ctx.conversationViews.register(trajectoryViewDefinition)
}
