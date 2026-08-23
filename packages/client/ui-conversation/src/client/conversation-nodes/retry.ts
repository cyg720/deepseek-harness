/**
 * ================================ 文件注释 ================================
 * 【文件职责】模型重试链状态机：把共享同一 RetryId 的 llm/retry 与 llm/retry-started
 *             事件累积成一条"重试链"行（scheduled → started，边界关闭后 scheduled 变
 *             cancelled）。
 * 【技术维度】ConversationNodeDefinition（target: 'chat'）；attempts 数组累积；
 *             isClosed 按 step/turn 闭合状态判定。
 * 【产品维度】消息流中一条重试行展示全部尝试与当前状态，用户看到重试在发生。
 * 【逻辑维度】1) 数据映射扩充与 RetryState；2) scheduledNode / isClosed；
 *             3) 状态机（match / start / update / buildViewNode）；4) 注册函数。
 * 【关键边界】retryId 缺失不匹配；最后一条 scheduled 尝试在边界闭合后渲染为 cancelled。
 * 【新手阅读建议】先看 buildViewNode 里 cancelled 的推导。
 * ==========================================================================
 */
import type { Context } from '@deepseek-ai/cordis'
import type {
  ConversationLocation, ConversationNodeDefinition, ModelRetryNode,
} from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-llm-retry/types'
import type { RetryChatData } from '../contract/chat-nodes.ts'
import { chatNode } from './common.ts'

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ChatNodeDataMap {
    /** Producer-correlated model retry chain. */
    'model-retry': RetryChatData
  }
}

/** Accumulated retry attempts sharing one producer-owned RetryId. */
export interface RetryState {
  readonly turn: number
  readonly step: number
  readonly attempts: readonly ModelRetryNode[]
}

function scheduledNode(match: Parameters<ConversationNodeDefinition['start']>[1]): ModelRetryNode | undefined {
  if (match.event.type !== 'llm/retry') return undefined
  return {
    kind: 'model-retry',
    seq: match.event.seq,
    time: match.event.time,
    retryState: 'scheduled',
    ...match.event.data,
  }
}

/** A scheduled attempt is cancelled once either owning boundary closes. */
function isClosed(location: ConversationLocation): boolean {
  return (location.kind === 'step' && location.step.status === 'closed')
    || ((location.kind === 'step' || location.kind === 'turn') && location.turn.status === 'closed')
}

/** Producer-correlated model retry chain Definition. */
export const retryDefinition: ConversationNodeDefinition<RetryState> = {
  kind: 'model-retry',
  target: 'chat',
  match: (event) => {
    if (event.type === 'llm/retry') {
      const retryId: unknown = event.data.retryId
      if (typeof retryId !== 'string' || retryId === '') return null
      return { id: retryId, role: event.data.retry === 1 ? 'start' : 'update' }
    }
    if (event.type === 'llm/retry-started') {
      const retryId: unknown = event.data.retryId
      return typeof retryId === 'string' && retryId !== '' ? { id: retryId, role: 'update' } : null
    }
    return null
  },
  start: (_context, match) => {
    const node = scheduledNode(match)
    if (node === undefined) throw new Error('model-retry start requires a valid llm/retry event')
    return { turn: node.turn, step: node.step, attempts: [node] }
  },
  update: (context, match) => {
    if (match.event.type === 'llm/retry') {
      const node = scheduledNode(match)
      return node === undefined ? context.state : { ...context.state, attempts: [...context.state.attempts, node] }
    }
    if (match.event.type !== 'llm/retry-started') return context.state
    const retry = match.event.data.retry
    return {
      ...context.state,
      attempts: context.state.attempts.map(attempt =>
        attempt.retry === retry ? { ...attempt, retryState: 'started' } : attempt),
    }
  },
  buildViewNode: (context) => {
    if (context.state === undefined || context.state.attempts.length === 0) return null
    const location = context.start?.location ?? context.matches[0]?.location ?? { kind: 'unresolved' as const }
    const stateAttempts = context.state.attempts
    const attempts = stateAttempts.map((attempt, index) =>
      index === stateAttempts.length - 1
        && attempt.retryState === 'scheduled'
        && isClosed(location)
        ? { ...attempt, retryState: 'cancelled' as const }
        : attempt)
    const current = attempts.at(-1)
    if (current === undefined) return null
    const data: RetryChatData = { attempts, current }
    return chatNode(context, 'model-retry', attempts[0]?.seq ?? current.seq, data)
  },
}

/**
 * Register the correlated model-retry business contribution.
 * @param ctx - owning UI Conversation context.
 */
export function registerRetryConversationNode(ctx: Context): void {
  ctx.conversationEvents.register(retryDefinition)
}
