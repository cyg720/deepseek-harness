/**
 * ================================ 文件注释 ================================
 * 【文件职责】轨迹目标下"上下文压缩"与"会话边界"两个状态机：把 compaction/start、summary、
 *             end 与压缩检查点事件组装成一条压缩请求（RequestView），并在会话结束处
 *             产出 session-end 节点。
 * 【技术维度】ConversationNodeDefinition 状态机；以 compactionId 关联多事件；
 *             checkpoint 识别由 compact 插件写入 user/message 来源的特殊标记。
 * 【产品维度】轨迹中展示"上下文已压缩"条目及其摘要 / 错误 / 用量，让用户知道长会话
 *             历史被摘要化；会话结束标记划出轨迹终点。
 * 【逻辑维度】1) 压缩状态结构；2) 两类 id 提取；3) requestFromState 组装请求；
 *             4) 压缩状态机；5) 会话结束状态机；6) 注册函数。
 * 【关键边界】end 事件决定 status（running / complete / error）；checkpoint 记录
 *             替换 seq；start 必须匹配 compaction/start。
 * 【新手阅读建议】先看 requestFromState 如何把三段事件拼成一条请求。
 * ==========================================================================
 */
import type { Context } from '@deepseek-ai/cordis'
import type {
  ConversationMatch, ConversationNodeDefinition, RequestView,
} from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-compaction/types'
import { trajectoryNode } from './trajectory-definition-common.ts'

// 压缩状态：以 start 锚定，后续的 summary / end / checkpoint 事件逐步补全。
interface CompactionState {
  readonly start: ConversationMatch
  readonly summary?: ConversationMatch
  readonly end?: ConversationMatch
  readonly checkpoint?: ConversationMatch
}

// 从 user/message 事件中识别"压缩检查点"：来源是 compact 插件且带非空 compactionId。
function checkpointId(
  event: Parameters<ConversationNodeDefinition['match']>[0],
): string | undefined {
  if (event.type !== 'user/message') return undefined
  const source = event.data.source as unknown as {
    readonly kind?: unknown
    readonly plugin?: unknown
    readonly compactionId?: unknown
  }
  return source.kind === 'plugin' && source.plugin === 'compact'
    && typeof source.compactionId === 'string' && source.compactionId !== ''
    ? source.compactionId
    : undefined
}

function eventCompactionId(
  event: Parameters<ConversationNodeDefinition['match']>[0],
): string | undefined {
  if (event.type !== 'compaction/start'
    && event.type !== 'compaction/summary'
    && event.type !== 'compaction/end') return undefined
  const value: unknown = event.data.compactionId
  return typeof value === 'string' && value !== '' ? value : undefined
}

function requestFromState(
  state: CompactionState,
): Extract<RequestView, { purpose: 'compaction' }> | undefined {
  const start = state.start.event
  if (start.type !== 'compaction/start') return undefined
  const summary = state.summary?.event
  const end = state.end?.event
  const checkpoint = state.checkpoint?.event
  return {
    purpose: 'compaction',
    startSeq: start.seq,
    turn: start.data.turn,
    step: 0,
    startedAt: start.time,
    completedAt: end?.type === 'compaction/end' ? end.time : null,
    status: end?.type !== 'compaction/end'
      ? 'running'
      : end.data.error === undefined ? 'complete' : 'error',
    ...(end?.type === 'compaction/end' && end.data.error !== undefined
      ? { error: end.data.error }
      : {}),
    ...(summary?.type !== 'compaction/summary'
      ? {}
      : {
        resultSeq: summary.seq,
        summary: summary.data.summary,
        ...(summary.data.rawOutput === undefined ? {} : { rawOutput: summary.data.rawOutput }),
        provenance: { provider: summary.data.provider, model: summary.data.model },
        requestConfig: {
          provider: summary.data.provider,
          model: summary.data.model,
          purpose: 'compaction',
          ...(summary.data.maxTokens === undefined ? {} : { maxTokens: summary.data.maxTokens }),
        },
        ...(summary.data.usage === undefined ? {} : { usage: summary.data.usage }),
      }),
    ...(checkpoint?.type === 'user/message' ? { replacementSeq: checkpoint.seq } : {}),
  }
}

/** 压缩状态机：以 compactionId 关联 start / summary / end / checkpoint 事件。 */
const trajectoryCompactionDefinition: ConversationNodeDefinition<CompactionState> = {
  kind: 'trajectory-compaction',
  target: 'trajectory',
  match: (event) => {
    const compactId = eventCompactionId(event)
    if (compactId !== undefined) {
      return { id: compactId, role: event.type === 'compaction/start' ? 'start' : 'update' }
    }
    const checkpoint = checkpointId(event)
    return checkpoint === undefined ? null : { id: checkpoint, role: 'update' }
  },
  start: (_context, match) => {
    if (match.event.type !== 'compaction/start') {
      throw new Error('trajectory-compaction start requires compaction/start')
    }
    return { start: match }
  },
  update: (context, match) => {
    if (match.event.type === 'compaction/summary') return { ...context.state, summary: match }
    if (match.event.type === 'compaction/end') return { ...context.state, end: match }
    return checkpointId(match.event) === undefined
      ? context.state
      : { ...context.state, checkpoint: match }
  },
  buildViewNode: (context) => {
    if (context.state === undefined) return null
    const request = requestFromState(context.state)
    return request === undefined
      ? null
      : trajectoryNode(context, request.startSeq, { kind: 'compaction', request })
  },
}

// 会话结束状态：只记录 seq 与时间，作为轨迹的终点标记。
interface SessionEndState {
  readonly seq: number
  readonly time: number
}

/** 会话结束状态机：匹配 session/end-seed 事件。 */
const trajectorySessionEndDefinition: ConversationNodeDefinition<SessionEndState> = {
  kind: 'trajectory-session-end',
  target: 'trajectory',
  match: event => event.type === 'session/end-seed'
    ? { id: String(event.seq), role: 'start' }
    : null,
  start: (_context, match) => ({ seq: match.event.seq, time: match.event.time }),
  update: context => context.state,
  buildViewNode: context => context.state === undefined
    ? null
    : trajectoryNode(context, context.state.seq, {
      kind: 'session-end',
      seq: context.state.seq,
      time: context.state.time,
    }),
}

/**
 * Register Trajectory compaction requests and session boundaries.
 *
 * @param ctx - Plugin context receiving the Definitions.
 */
/**
 * 注册轨迹的压缩请求与会话边界状态机。
 * @param ctx - 接收这些 Definition 的插件上下文。
 */
export function registerTrajectoryCompactionDefinitions(ctx: Context): void {
  ctx.conversationEvents.register(trajectoryCompactionDefinition)
  ctx.conversationEvents.register(trajectorySessionEndDefinition)
}
