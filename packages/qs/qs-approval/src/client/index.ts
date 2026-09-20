/**
 * 审批包的浏览器入口。
 *
 * 卡片位由 qs-transcript 声明；本包以 priority 1 贡献，`select` 只在当前会话存在
 * 且 pending 是审批时返回非空（升序第一个非 null 当选）。宿主负责把
 * `{ sessionId, pendingInteraction }` 显式传入——框架不自动补字段。
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// 仅类型：引入 SlotRegistry 的 ctx.slots 服务合并与语言。
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { PendingApproval } from '@deepseek-ai/dsh-client-ui-approval/client'
import type { QsInteractionOwnerProps } from '@deepseek-ai/dsh-qs-transcript/client'
import type { SessionBinding } from '@deepseek-ai/dsh-api-session-controller/client'
import type { ChatSnapshot } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { QsApprovalDetailIndex, QsApprovalInjected } from './contract.ts'
import { collectToolCalls } from './approval-detail.ts'
import { ApprovalCard } from './ApprovalCard.tsx'
import { en, zh } from './locales.ts'

/** 本包的本地化命名空间。 */
const NS = 'qs-approval'

/** 必需服务：槽注册表、语言、会话面与 Conversation 装配面（callId 详情要靠它们解析）。 */
export const inject = ['slots', 'locale', 'sessions', 'uiConversation']

/** 契约再导出。 */
export type * from './contract.ts'
export type { ApprovalDetailView } from './approval-detail.ts'

/** 审批卡在卡片位上的选举优先级（提问为 2，升序先到先得）。 */
export const QS_APPROVAL_PRIORITY = 1

/**
 * 安装审批卡。
 * @param ctx - 浏览器根上下文。
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'qs-approval: dictionaries')
  // 每会话一份 callId 索引源：同一 Chat 快照不重算，订阅仍按会话隔离。
  const detailSources = new WeakMap<SessionBinding, QsApprovalInjected['hooks']['approvalDetail']>()
  const detailSourceFor = (sessionId: string): QsApprovalInjected['hooks']['approvalDetail'] => {
    const binding = ctx.sessions.binding(sessionId as never)
    if (binding === undefined) throw new Error(`qs-approval: unknown session "${sessionId}"`)
    let source = detailSources.get(binding)
    if (source === undefined) {
      const target = ctx.uiConversation.binding(binding).target('chat')
      let seen: ChatSnapshot | undefined
      let index: QsApprovalDetailIndex = new Map()
      source = {
        getSnapshot: () => {
          const snapshot = target.getSnapshot()
          if (snapshot === seen) return index
          seen = snapshot
          index = snapshot === undefined ? new Map() : collectToolCalls(snapshot.nodes.values())
          return index
        },
        subscribe: listener => target.subscribe(listener),
      }
      detailSources.set(binding, source)
    }
    return source
  }

  ctx.slots.inject('qs.stage.interaction', () => ctx.slots.register({
    name: 'qs.stage.interaction',
    priority: QS_APPROVAL_PRIORITY,
    locale: NS,
    inject: (sessionId: string): QsApprovalInjected => ({
      hooks: { approvalDetail: detailSourceFor(sessionId) },
    }),
    select: ({ sessionId, pendingInteraction }: QsInteractionOwnerProps): PendingApproval | null =>
      sessionId !== undefined && pendingInteraction?.kind === 'approval'
        ? pendingInteraction
        : null,
  }, ApprovalCard))
}
