/**
 * ================================ 文件注释 ================================
 * 【文件职责】轨迹目标下"输入消息"与"收件箱分类"两个状态机：把 user/message 事件分类为
 *             用户消息 / 转向消息（steering）/ 上下文注入，并把 agent/inbox/spliced 事件
 *             折叠成收件箱状态。
 * 【技术维度】ConversationNodeDefinition；trajectory-inbox-next-step 无 target（纯状态），
 *             trajectory-input-message 引用它的 claimed 集合判定 steering。
 * 【产品维度】轨迹区分"用户真正输入"与"系统注入的转向指令"，帮助用户理解模型为什么
 *             被引导到某方向。
 * 【逻辑维度】1) 收件箱三接口与 applySplice 折叠；2) 收件箱状态机；3) 消息状态机
 *             （context / steering / user 三分类）；4) 注册函数。
 * 【关键边界】claimed 判定：收件箱中被认领（claim）的消息记为 steering；
 *             两状态机通过 Definition 名互查（reader.previous）。
 * 【新手阅读建议】先理解 applySplice 的 pending / claimed 两集合如何演化。
 * ==========================================================================
 */
import type { Context } from '@deepseek-ai/cordis'
import type {
  ContextMessageNode, ConversationNodeDefinition, ConversationPreviousContext,
  SteeringMessageNode, UserMessageNode,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-agent/types'
import { trajectoryNode } from './trajectory-definition-common.ts'
import { contextForm, contextProvenance } from './trajectory-event-projection.ts'

/* jscpd:ignore-start -- Target-owned Definitions intentionally keep their event
 * state machines independent; see ../../../../../.agents/notes/implemented/
 * architecture/2026-08-09-client-conversation-node-assembly.md. */
// 收件箱条目的身份（id）。
interface InboxIdentity {
  readonly id: string
}

// 一次收件箱"拼接"操作：从 start 处替换 removedCount 个条目并插入新条目；outcome 为
// 'canceled' 时插入的是被取消的条目。
interface InboxSplice {
  readonly start: number
  readonly removedCount?: number
  readonly inserted: readonly InboxIdentity[]
  readonly outcome?: 'canceled'
}

// 收件箱状态：pending 是待处理队列，claimed 是已被"认领"（成为转向指令）的身份集合。
interface InboxState {
  readonly pending: readonly InboxIdentity[]
  readonly claimed: ReadonlySet<string>
}

// 三种输入类消息节点：用户 / 转向 / 上下文。
type MessageNode = UserMessageNode | SteeringMessageNode | ContextMessageNode

// 把一次拼接折叠进状态：先做数组 splice，再更新 claimed 集合
// （插入的取消认领；被移除的——若非取消——标记为已认领）。
function applySplice(
  previous: ConversationPreviousContext<InboxState> | undefined,
  splice: InboxSplice,
): InboxState {
  const pending = [...(previous?.state.pending ?? [])]
  const claimed = new Set(previous?.state.claimed ?? [])
  const removed = pending.splice(splice.start, splice.removedCount ?? 0, ...splice.inserted)
  for (const identity of splice.inserted) claimed.delete(identity.id)
  if (splice.outcome !== 'canceled') {
    for (const identity of removed) claimed.add(identity.id)
  }
  return { pending, claimed }
}

const trajectoryInboxDefinition: ConversationNodeDefinition<InboxState> = {
  kind: 'trajectory-inbox-next-step',
  match: event => event.type === 'agent/inbox/spliced'
    && event.data.target === 'next-step'
    ? { id: String(event.seq), role: 'start' }
    : null,
  start: (_context, match, reader) => {
    if (match.event.type !== 'agent/inbox/spliced') {
      throw new Error('trajectory-inbox-next-step start requires agent/inbox/spliced')
    }
    return applySplice(
      reader.previous<InboxState>('trajectory-inbox-next-step'),
      match.event.data,
    )
  },
  update: context => context.state,
  publication: () => 'none',
}

/** 输入消息状态机：把 user/message 分类为 context / steering / user，产出视图节点。 */
const trajectoryMessageDefinition: ConversationNodeDefinition<MessageNode> = {
  kind: 'trajectory-input-message',
  target: 'trajectory',
  match: event => event.type === 'user/message'
    ? { id: String(event.seq), role: 'start' }
    : null,
  start: (_context, match, reader) => {
    if (match.event.type !== 'user/message') {
      throw new Error('trajectory-input-message start requires user/message')
    }
    const event = match.event
    if (event.data.source.kind !== 'user') {
      return {
        kind: 'context',
        seq: event.seq,
        time: event.time,
        content: event.data.content,
        source: event.data.source,
        provenance: contextProvenance(event.data.source),
        form: contextForm(event.data.source),
      }
    }
    const claimed = reader.previous<InboxState>('trajectory-inbox-next-step')
      ?.state.claimed.has(String(event.data.id)) === true
    return claimed
      ? {
        kind: 'steering',
        messageId: event.data.id,
        seq: event.seq,
        time: event.time,
        content: event.data.content,
        source: event.data.source,
      }
      : {
        kind: 'user',
        seq: event.seq,
        time: event.time,
        content: event.data.content,
        source: event.data.source,
      }
  },
  update: context => context.state,
  buildViewNode: context => context.state === undefined
    ? null
    : trajectoryNode(context, context.state.seq, { kind: 'node', node: context.state }),
}
/* jscpd:ignore-end */

/**
 * Register Trajectory-owned inbox classification and message records.
 *
 * @param ctx - Plugin context receiving the Definitions.
 */
/*
 * 注册轨迹拥有的收件箱分类与消息记录状态机。
 * @param ctx - 接收这些 Definition 的插件上下文。
 */
export function registerTrajectoryMessageDefinitions(ctx: Context): void {
  ctx.uiConversation.events.register(trajectoryInboxDefinition)
  ctx.uiConversation.events.register(trajectoryMessageDefinition)
}
