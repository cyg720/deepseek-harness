/**
 * ================================ 文件注释 ================================
 * 【文件职责】轨迹目标下"根工具调用生命周期"状态机：跟踪一次工具调用的 call → result，
 *             并内联折叠嵌套的 code-dispatch 子调用，最终产出带子调用树的工具块
 *             （ToolCallBlock），含运行中（running）与被打断（interrupted）形态。
 * 【技术维度】ConversationNodeDefinition 状态机；ToolState 用 calls / children / parents
 *             三张表维护调用树；acceptsEdge 做环检测与最大深度（256）约束；
 *             projectCall 深度优先投影子树；interruption 根据 step/turn 闭合状态合成
 *             被打断的伪结果。
 * 【产品维度】轨迹里每个工具调用展示完整调用链：run_code 的子调用逐层展开，进度 /
 *             错误 / 打断一目了然。
 * 【逻辑维度】1) 状态与分发数据结构；2) rootCall / rootResult / childCall / childResult
 *             事件转节点；3) 树维护（acceptsEdge / updateDispatch）；4) 投影
 *             （projectCall / fallbackState / interruption）；5) 状态机定义与注册。
 * 【关键边界】深度上限 256 防环与防爆栈；code-dispatch 缺 rootCallId 时不匹配；
 *             状态缺失时用 fallbackState 从匹配历史重建。
 * 【新手阅读建议】先看 updateDispatch 如何把父子边建立起来，再看 projectCall 的递归。
 * ==========================================================================
 */
import type { Context } from '@deepseek-ai/cordis'
import type {
  ConversationMatch, ConversationNodeContext, ConversationNodeDefinition,
  RunningToolCall, ToolCallBlock, ToolResultNode,
} from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-tools/types'
import { trajectoryNode } from './trajectory-definition-common.ts'

/* jscpd:ignore-start -- Target-owned Definitions intentionally keep their event
 * state machines independent; see ../../../../../.agents/notes/implemented/
 * architecture/2026-08-09-client-conversation-node-assembly.md. */
// 调用树的最大深度：防止环与深递归（256 层封顶）。
const MAX_DEPTH = 256

// 工具调用树状态：rootId 是根调用；calls 存节点块，children 存父子关系，parents 存反向边。
interface ToolState {
  readonly rootId: string
  readonly calls: ReadonlyMap<string, ToolCallBlock>
  readonly children: ReadonlyMap<string, readonly string[]>
  readonly parents: ReadonlyMap<string, string>
}

// code-dispatch 事件的数据：父调用、子调用、名称、参数与结果。
interface DispatchData {
  readonly parentCallId: string
  readonly subCallId: string
  readonly name: string
  readonly arguments: unknown
  readonly isError?: boolean
  readonly content?: ToolResultNode['content']
}

// 从 tool/call 事件构造根调用的"运行中"块（RunningToolCall）。
function rootCall(match: ConversationMatch): RunningToolCall {
  if (match.event.type !== 'tool/call') {
    throw new Error('trajectory-tool-call start requires tool/call')
  }
  return {
    callId: String(match.event.data.callId),
    name: match.event.data.name,
    argsRaw: match.event.data.arguments,
    turn: match.event.data.turn,
    step: match.event.data.step,
    time: match.event.time,
    callView: match.view?.for === 'call' ? match.view.view : null,
    subCalls: [],
  }
}

function rootResult(
  match: ConversationMatch,
  previous?: RunningToolCall,
): ToolResultNode | undefined {
  if (match.event.type !== 'tool/result') return undefined
  const result = match.event.data.message.content[0]
  return {
    kind: 'tool-result',
    seq: match.event.seq,
    time: match.event.time,
    callId: String(match.event.data.message.source.callId),
    call: previous === undefined ? null : { name: previous.name, argsRaw: previous.argsRaw },
    callTime: previous?.time ?? null,
    content: result.content,
    isError: result.isError === true,
    ...(match.event.data.error === undefined ? {} : { error: match.event.data.error }),
    meta: match.event.data.meta,
    callView: previous?.callView ?? null,
    resultView: match.view?.for === 'result' ? match.view.view : null,
    subCalls: [],
  }
}

function locationTurn(match: ConversationMatch): number {
  return match.location.kind === 'step' || match.location.kind === 'turn'
    ? match.location.turn.turn
    : 0
}

function locationStep(match: ConversationMatch): number {
  return match.location.kind === 'step' ? match.location.step.step : 0
}

function childCall(match: ConversationMatch, data: DispatchData): RunningToolCall {
  return {
    callId: data.subCallId,
    name: data.name,
    argsRaw: JSON.stringify(data.arguments),
    turn: locationTurn(match),
    step: locationStep(match),
    time: match.event.time,
    callView: null,
    subCalls: [],
  }
}

function childResult(
  match: ConversationMatch,
  data: DispatchData,
  previous?: ToolCallBlock,
): ToolResultNode {
  return {
    kind: 'tool-result',
    seq: match.event.seq,
    time: match.event.time,
    callId: data.subCallId,
    call: { name: data.name, argsRaw: JSON.stringify(data.arguments) },
    callTime: previous === undefined || 'kind' in previous ? null : previous.time,
    content: data.content ?? [],
    isError: data.isError === true,
    callView: null,
    resultView: null,
    subCalls: [],
  }
}

function acceptsEdge(state: ToolState, parent: string, child: string): boolean {
  if (parent === child || state.parents.has(child)) return false
  let cursor: string | undefined = parent
  let parentDepth = 0
  const ancestors = new Set<string>()
  while (cursor !== undefined) {
    if (cursor === child || ancestors.has(cursor)) return false
    ancestors.add(cursor)
    parentDepth++
    cursor = state.parents.get(cursor)
  }
  const pending = [{ callId: child, depth: 1 }]
  const descendants = new Set<string>()
  let subtreeDepth = 0
  for (const candidate of pending) {
    if (descendants.has(candidate.callId)) return false
    descendants.add(candidate.callId)
    subtreeDepth = Math.max(subtreeDepth, candidate.depth)
    for (const nested of state.children.get(candidate.callId) ?? []) {
      pending.push({ callId: nested, depth: candidate.depth + 1 })
    }
  }
  return parentDepth + subtreeDepth <= MAX_DEPTH
}

// 把 code-dispatch（start / settle）事件折叠进调用树：start 建子调用块，settle 补结果块。
function updateDispatch(state: ToolState, match: ConversationMatch): ToolState {
  const event = match.event
  if (event.type !== 'tool/code-dispatch-start' && event.type !== 'tool/code-dispatch') return state
  const data = event.data
  const parentId = String(data.parentCallId)
  const childId = String(data.subCallId)
  const siblings = state.children.get(parentId) ?? []
  const index = siblings.indexOf(childId)
  if (index < 0 && !acceptsEdge(state, parentId, childId)) return state
  if (event.type === 'tool/code-dispatch-start' && index >= 0) return state

  const calls = new Map(state.calls)
  calls.set(childId, event.type === 'tool/code-dispatch-start'
    ? childCall(match, data)
    : childResult(match, data, calls.get(childId)))
  if (index >= 0) return { ...state, calls }
  const children = new Map(state.children)
  children.set(parentId, [...siblings, childId])
  const parents = new Map(state.parents)
  parents.set(childId, parentId)
  return { ...state, calls, children, parents }
}

function interruption(
  context: ConversationNodeContext<ToolState>,
): { seq: number; time: number } | undefined {
  const location = context.start?.location
  if (location?.kind === 'step' && location.step.status === 'closed') return location.step.end
  if ((location?.kind === 'step' || location?.kind === 'turn')
    && location.turn.status === 'closed') return location.turn.end
  return undefined
}

function projectCall(
  state: ToolState,
  callId: string,
  interruptedAt: { seq: number; time: number } | undefined,
  visited = new Set<string>(),
  depth = 1,
): ToolCallBlock | undefined {
  const block = state.calls.get(callId)
  if (block === undefined) return undefined
  if (visited.has(callId) || depth > MAX_DEPTH) return { ...block, subCalls: [] }
  const nextVisited = new Set(visited)
  nextVisited.add(callId)
  const subCalls = (state.children.get(callId) ?? [])
    .flatMap((childId) => {
      const child = projectCall(state, childId, interruptedAt, nextVisited, depth + 1)
      return child === undefined ? [] : [child]
    })
  if ('kind' in block || interruptedAt === undefined) return { ...block, subCalls }
  return {
    kind: 'tool-result',
    seq: interruptedAt.seq - 0.8,
    time: interruptedAt.time,
    callId: block.callId,
    call: { name: block.name, argsRaw: block.argsRaw },
    callTime: block.time,
    content: [],
    isError: true,
    error: { name: 'Interrupted', code: 'interrupted' },
    callView: block.callView,
    resultView: null,
    subCalls,
  }
}

function fallbackState(context: ConversationNodeContext<ToolState>): ToolState | undefined {
  const resultMatch = context.matches.find(match => match.event.type === 'tool/result')
  const root = resultMatch === undefined ? undefined : rootResult(resultMatch)
  if (root === undefined) return undefined
  let state: ToolState = {
    rootId: root.callId,
    calls: new Map([[root.callId, root]]),
    children: new Map(),
    parents: new Map(),
  }
  for (const match of context.matches) state = updateDispatch(state, match)
  return state
}

/** Trajectory-owned root Tool lifecycle with nested Code Dispatch calls. */
/** 轨迹拥有的根工具调用生命周期状态机（含嵌套 code-dispatch 子调用）。 */
const trajectoryToolDefinition: ConversationNodeDefinition<ToolState> = {
  kind: 'trajectory-tool-call',
  target: 'trajectory',
  match: (event) => {
    if (event.type === 'tool/call') return { id: String(event.data.callId), role: 'start' }
    if (event.type === 'tool/result') {
      return { id: String(event.data.message.source.callId), role: 'update' }
    }
    if (event.type === 'tool/code-dispatch-start' || event.type === 'tool/code-dispatch') {
      const rootCallId: unknown = event.data.rootCallId
      return typeof rootCallId === 'string' && rootCallId !== ''
        ? { id: rootCallId, role: 'update' }
        : null
    }
    return null
  },
  start: (_context, match) => {
    const root = rootCall(match)
    return {
      rootId: root.callId,
      calls: new Map([[root.callId, root]]),
      children: new Map(),
      parents: new Map(),
    }
  },
  update: (context, match) => {
    if (match.event.type !== 'tool/result') return updateDispatch(context.state, match)
    const previous = context.state.calls.get(context.state.rootId)
    const running = previous !== undefined && !('kind' in previous) ? previous : undefined
    const result = rootResult(match, running)
    if (result === undefined) return context.state
    const calls = new Map(context.state.calls)
    calls.set(context.state.rootId, result)
    return { ...context.state, calls }
  },
  buildViewNode: (context) => {
    const state = context.state ?? fallbackState(context)
    if (state === undefined) return null
    const root = projectCall(state, state.rootId, interruption(context))
    if (root === undefined) return null
    const anchorSeq = context.start?.event.seq
      ?? ('kind' in root ? root.seq : context.matches[0]?.event.seq ?? 0)
    return trajectoryNode(context, anchorSeq, { kind: 'tool', root })
  },
}
/* jscpd:ignore-end */

/**
 * Register the Trajectory Tool lifecycle.
 *
 * @param ctx - Plugin context receiving the Definition.
 */
/**
 * 注册轨迹的工具调用生命周期状态机。
 * @param ctx - 接收该 Definition 的插件上下文。
 */
export function registerTrajectoryToolDefinition(ctx: Context): void {
  ctx.conversationEvents.register(trajectoryToolDefinition)
}
