/**
 * ================================ 文件注释 ================================
 * 【文件职责】"回合被输出 token 上限截断"的通知状态机：匹配 reason 为 max-tokens 的
 *             turn/end，产出通知节点。
 * 【技术维度】ConversationNodeDefinition（target: 'chat'）；noticeAnchor 把通知锚在
 *             关闭 assistant 与回合尾之间（保回合尾为回合最后节点，分支动作可用）。
 * 【产品维度】回答被截断时明确告知用户并提示"发送继续"。
 * 【逻辑维度】1) 数据映射扩充；2) lastStep / noticeAnchor / stateFrom；
 *             3) 状态机；4) 注册函数。
 * 【关键边界】没有可保护的关闭文本 assistant 时退回 turn/end seq 锚点。
 * 【新手阅读建议】noticeAnchor 是理解重点（合成序偏移的用途）。
 * ==========================================================================
 */
import type { Context } from '@deepseek-ai/cordis'
import type {
  ConversationMatch, ConversationNodeContext, ConversationNodeDefinition,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { TurnMaxTokensNode } from '../contract/snapshot.ts'
import { CHAT_SYNTHETIC_SEQ_OFFSETS, chatNode } from './common.ts'

declare module '../contract/chat-nodes.ts' {
  interface ChatNodeDataMap {
    /** Turn ended by the per-request output-token cap. */
    'turn-max-tokens': TurnMaxTokensNode
  }
}

interface TurnMaxTokensState {
  readonly turn: number
  readonly seq: number
  readonly time: number
}

function lastStep(context: ConversationNodeContext<TurnMaxTokensState>): number {
  const location = context.start?.location ?? context.matches[0]?.location
  if (location?.kind !== 'turn' && location?.kind !== 'step') return 0
  return location.turn.steps.at(-1)?.step ?? 0
}

/**
 * Anchor the notice between the closing Assistant and the turn-tail so the
 * tail stays the turn's last Chat node and keeps its branch action enabled.
 * Without a closing text Assistant there is no branch action to protect, and
 * the turn/end seq keeps the notice at the truncation point.
 */
function noticeAnchor(context: ConversationNodeContext<TurnMaxTokensState>, seq: number): number {
  const location = context.start?.location ?? context.matches[0]?.location
  if (location?.kind !== 'turn' && location?.kind !== 'step') return seq
  const closing = location.turn.data.get('turn-tail')?.closing
  return closing === null || closing === undefined
    ? seq
    : closing.finalNode.seq + CHAT_SYNTHETIC_SEQ_OFFSETS.maxTokensNotice
}

function stateFrom(match: ConversationMatch): TurnMaxTokensState | undefined {
  if (match.event.type !== 'turn/end' || match.event.data.reason.kind !== 'max-tokens') return undefined
  return { turn: match.event.data.turn, seq: match.event.seq, time: match.event.time }
}

/** Notice Definition for a turn the provider ended at its output-token cap. */
export const turnMaxTokensDefinition: ConversationNodeDefinition<TurnMaxTokensState> = {
  kind: 'turn-max-tokens',
  target: 'chat',
  match: (event) => {
    if (event.type === 'turn/end' && event.data.reason.kind === 'max-tokens') {
      return { id: String(event.data.turn), role: 'start' }
    }
    return null
  },
  start: (_context, match) => {
    const state = stateFrom(match)
    if (state === undefined) throw new Error('turn-max-tokens start requires a max-tokens turn/end')
    return state
  },
  update: context => context.state,
  buildViewNode: (context) => {
    const state = context.state
    if (state === undefined) return null
    const node: TurnMaxTokensNode = {
      kind: 'turn-max-tokens',
      seq: state.seq,
      time: state.time,
      turn: state.turn,
      step: lastStep(context),
    }
    return chatNode(context, 'turn-max-tokens', noticeAnchor(context, state.seq), node)
  },
}

/**
 * Register the max-tokens turn-end notice contribution.
 * @param ctx - owning UI Conversation context.
 */
export function registerTurnMaxTokensConversationNode(ctx: Context): void {
  ctx.uiConversation.events.register(turnMaxTokensDefinition)
}
