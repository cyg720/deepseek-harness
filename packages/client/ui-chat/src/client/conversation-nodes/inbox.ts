/**
 * ================================ 文件注释 ================================
 * 【文件职责】收件箱状态贡献：为 next-turn 与 next-step 两种目标各注册一个累积式
 *             ConversationNodeDefinition，把 agent/inbox/spliced 事件折叠成
 *             pending / claimed 两个集合。
 * 【技术维度】ConversationNodeDefinition（无 target，纯状态）；applySplice 做数组
 *             splice + claimed 集合维护；publication 为 none（不发会话事件）。
 * 【产品维度】"下一回合 / 下一步"的待处理消息账本：steering 分类依赖 next-step 的
 *             claimed 集合。
 * 【逻辑维度】1) 数据结构；2) applySplice 折叠；3) inboxDefinition 工厂；4) 注册函数。
 * 【关键边界】claimed 只对 next-step 目标维护；取消的插入会撤销 claimed。
 * 【新手阅读建议】对照 message.ts 看 claimed 如何被 steering 分类消费。
 * ==========================================================================
 */
import type { Context } from '@deepseek-ai/cordis'
import type {
  ConversationNodeDefinition, ConversationPreviousContext,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { InboxTarget } from '@deepseek-ai/dsh-agent/types'

interface InboxIdentity {
  readonly id: string
}

interface InboxSplice {
  readonly target: InboxTarget
  readonly start: number
  readonly removedCount?: number
  readonly inserted: readonly InboxIdentity[]
  readonly outcome?: 'canceled'
}

/** Cumulative state after one durable inbox splice. */
export interface InboxState {
  readonly pending: readonly InboxIdentity[]
  readonly claimed: ReadonlySet<string>
}

function applySplice(
  previous: ConversationPreviousContext<InboxState> | undefined,
  splice: InboxSplice,
): InboxState {
  const pending = [...(previous?.state.pending ?? [])]
  const claimed = new Set(previous?.state.claimed ?? [])
  const removed = pending.splice(splice.start, splice.removedCount ?? 0, ...splice.inserted)
  for (const identity of splice.inserted) claimed.delete(identity.id)
  if (splice.target === 'next-step' && splice.outcome !== 'canceled') {
    for (const identity of removed) claimed.add(identity.id)
  }
  return { pending, claimed }
}

function inboxDefinition(target: InboxTarget): ConversationNodeDefinition<InboxState> {
  const kind = `inbox-${target}`
  return {
    kind,
    match: event => event.type === 'agent/inbox/spliced'
      && event.data.target === target
      ? { id: String(event.seq), role: 'start' }
      : null,
    start: (_context, match, reader) => {
      if (match.event.type !== 'agent/inbox/spliced') throw new Error(`${kind} start requires agent/inbox/spliced`)
      return applySplice(reader.previous<InboxState>(kind), match.event.data)
    },
    update: context => context.state,
    publication: () => 'none',
  }
}

/** Cumulative next-turn inbox splice Definition. */
export const nextTurnInboxDefinition = inboxDefinition('next-turn')

/** Cumulative next-step inbox splice Definition used to classify steering. */
export const nextStepInboxDefinition = inboxDefinition('next-step')

/**
 * Register the two durable Inbox-state contributions.
 * @param ctx - owning UI Conversation context.
 */
export function registerInboxConversationNodes(ctx: Context): void {
  ctx.uiConversation.events.register(nextTurnInboxDefinition)
  ctx.uiConversation.events.register(nextStepInboxDefinition)
}
