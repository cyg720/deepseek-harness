/**
 * ================================ 文件注释 ================================
 * 【文件职责】回合终止失败状态机：turn/start 时开始跟踪，turn/end 且 reason 为 error
 *             时记录失败并产出错误行节点。
 * 【技术维度】ConversationNodeDefinition（target: 'chat'）；failureFrom 提取失败消息与
 *             代码；fallbackState 从匹配历史重建。
 * 【产品维度】回合整体失败时在消息流底部显示明确错误，且不被重试行替代。
 * 【逻辑维度】1) 数据映射扩充；2) lastStep / failureFrom / fallbackState；
 *             3) 状态机；4) 注册函数。
 * 【关键边界】重试发生在失败的回合内部，llm/retry 历史不会抑制本终态行（由
 *             model-retry 节点单独渲染）。
 * 【新手阅读建议】先看 match 对 turn/start 与 turn/end 的两种角色处理。
 * ==========================================================================
 */
import type { Context } from '@deepseek-ai/cordis'
import type {
  ConversationMatch, ConversationNodeContext, ConversationNodeDefinition,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { TurnErrorNode } from '../contract/snapshot.ts'
import { chatNode } from './common.ts'
import { displayFailure } from './event-projection.ts'

declare module '../contract/chat-nodes.ts' {
  interface ChatNodeDataMap {
    /** Terminal turn failure recorded on the turn's end reason. */
    'turn-error': TurnErrorNode
  }
}

interface TurnErrorState {
  readonly turn: number
  readonly failure?: {
    readonly seq: number
    readonly time: number
    readonly message: string
    readonly code?: string
  }
}

function lastStep(context: ConversationNodeContext<TurnErrorState>): number {
  const location = context.start?.location ?? context.matches[0]?.location
  if (location?.kind !== 'turn' && location?.kind !== 'step') return 0
  return location.turn.steps.at(-1)?.step ?? 0
}

function failureFrom(match: ConversationMatch): TurnErrorState['failure'] | undefined {
  if (match.event.type !== 'turn/end' || match.event.data.reason.kind !== 'error') return undefined
  const failure = match.event.data.reason.error
  const display = displayFailure(failure)
  return {
    seq: match.event.seq,
    time: match.event.time,
    message: display.message,
    ...(display.code === undefined ? {} : { code: display.code }),
  }
}

function fallbackState(context: ConversationNodeContext<TurnErrorState>): TurnErrorState | undefined {
  const end = context.matches.find(match => failureFrom(match) !== undefined)
  if (end?.event.type !== 'turn/end') return undefined
  const failure = failureFrom(end)
  if (failure === undefined) return undefined
  return { turn: end.event.data.turn, failure }
}

/**
 * Terminal turn failure Definition. Retries run inside the failing turn, so the
 * turn's `llm/retry` history never suppresses this terminal row; the model-retry
 * node renders that history separately.
 */
export const turnErrorDefinition: ConversationNodeDefinition<TurnErrorState> = {
  kind: 'turn-error',
  target: 'chat',
  match: (event) => {
    if (event.type === 'turn/start') return { id: String(event.data.turn), role: 'start' }
    if (event.type === 'turn/end' && event.data.reason.kind === 'error') {
      return { id: String(event.data.turn), role: 'update' }
    }
    return null
  },
  start: (_context, match) => {
    if (match.event.type !== 'turn/start') throw new Error('turn-error start requires turn/start')
    return { turn: match.event.data.turn }
  },
  update: (context, match) => {
    const failure = failureFrom(match)
    return failure === undefined ? context.state : { ...context.state, failure }
  },
  buildViewNode: (context) => {
    const state = context.state ?? fallbackState(context)
    if (state?.failure === undefined) return null
    const failure = state.failure
    const node: TurnErrorNode = {
      kind: 'turn-error',
      seq: failure.seq,
      time: failure.time,
      turn: state.turn,
      step: lastStep(context),
      message: failure.message,
      ...failure.code === undefined ? {} : { code: failure.code },
    }
    return chatNode(context, 'turn-error', node.seq, node)
  },
}

/**
 * Register the terminal Turn-error business contribution.
 * @param ctx - owning UI Conversation context.
 */
export function registerTurnErrorConversationNode(ctx: Context): void {
  ctx.uiConversation.events.register(turnErrorDefinition)
}
