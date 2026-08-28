/**
 * ================================ 文件注释 ================================
 * 【文件职责】未认领的"追加面"事件兜底 Definition：任何没有业务状态机声明的
 *             append-surface 事件都渲染成通用的 unknown 行。
 * 【技术维度】ConversationNodeDefinition（registerFallback 注册）；isAppendSurfaceEvent
 *             判定范围；载荷原样进入 UnknownSurfaceNode。
 * 【产品维度】新事件类型在界面至少可见（不至于丢失），便于后续识别与接管。
 * 【逻辑维度】1) 数据映射扩充；2) 兜底定义；3) 注册函数。
 * 【关键边界】兜底只在没有更具体的定义认领时生效。
 * 【新手阅读建议】理解"兜底 = 最低可见性保障"。
 * ==========================================================================
 */
import type { Context } from '@deepseek-ai/cordis'
import type { ConversationNodeDefinition } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { isAppendSurfaceEvent } from '@deepseek-ai/dsh-session/surface'
import type { UnknownSurfaceNode } from '../contract/snapshot.ts'
import { chatNode } from './common.ts'

declare module '../contract/chat-nodes.ts' {
  interface ChatNodeDataMap {
    /** Generic presentation of an unclaimed append-surface event. */
    unknown: UnknownSurfaceNode
  }
}

/** Unclaimed append-surface fallback Definition. */
export const unknownFallbackDefinition: ConversationNodeDefinition<UnknownSurfaceNode> = {
  kind: 'unknown-surface',
  target: 'chat',
  match: (event) => {
    if (event.type === 'chunkrow/text-chunks'
      || event.type === 'chunkrow/reasoning-chunks'
      || event.type === 'chunkrow/tool-call-chunks') return null
    return isAppendSurfaceEvent(event) ? { id: String(event.seq), role: 'start' } : null
  },
  start: (_context, match) => ({
    kind: 'unknown',
    seq: match.event.seq,
    time: match.event.time,
    type: match.event.type,
    data: match.event.data,
  }),
  update: context => context.state,
  buildViewNode: context => context.state === undefined
    ? null
    : chatNode(context, 'unknown', context.state.seq, context.state),
}

/**
 * Register the unmatched append-surface fallback contribution.
 * @param ctx - owning UI Conversation context.
 */
export function registerUnknownConversationFallback(ctx: Context): void {
  ctx.uiConversation.events.registerFallback(unknownFallbackDefinition)
}
