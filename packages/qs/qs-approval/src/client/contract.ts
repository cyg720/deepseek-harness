/**
 * qs-approval 的契约。
 *
 * 卡片位 `qs.stage.interaction`（chain，session）由 qs-transcript 声明；
 * 本包以 priority 1 贡献，`select` 命中当前会话的审批 pending 时当选。
 * **chain 条目崩溃不退位**，因此卡片必须自带错误提示与重试。
 */
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { PendingApproval } from '@deepseek-ai/dsh-client-ui-approval/client'
import type { ToolCallInfo } from './approval-detail.ts'
// 仅类型：引入 qs-transcript 声明的交互卡片位与 qs-shell 声明的顶层槽。
import type {} from '@deepseek-ai/dsh-qs-transcript/client'
import type {} from '@deepseek-ai/dsh-qs-shell/client'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'qs-approval': QsApprovalLocaleKey
  }
}

/** 审批卡选中的卡片位条目数据（chain 的 `matched`）。 */
export type QsApprovalMatched = PendingApproval

/** 审批详情索引：callId → 工具调用。 */
export type QsApprovalDetailIndex = ReadonlyMap<string, ToolCallInfo>

/**
 * `qs.stage.interaction` 条目的 inject face。
 *
 * `approvalDetail` 是**每会话**的索引源：卡片只读自己那个 callId。索引只在审批挂起
 * （即卡片挂载）期间被读取，因此这次遍历被限制在"模型正等待答复"的窗口内，
 * 不会进入普通流式追加的热路径。
 */
export interface QsApprovalInjected {
  readonly hooks: {
    /** 工具调用索引源，框架绑成 `useApprovalDetail`。 */
    readonly approvalDetail: HostObservable<QsApprovalDetailIndex>
  }
}

/** 审批卡的完整 props：owner 选举输入 + inject 详情座席 + locale 座席 + matched。 */
export type QsApprovalCardProps =
  PropsRuntime<'qs.stage.interaction'>
  & InjectFace<QsApprovalInjected>
  & { readonly matched: QsApprovalMatched }
  & PropsLocale<'qs-approval'>

/** qs-approval 的本地化键。 */
export type QsApprovalLocaleKey =
  | 'card.eyebrow'
  | 'card.title'
  | 'card.reason'
  | 'card.detail'
  | 'card.detailTarget'
  | 'card.detailFallback'
  | 'card.allow'
  | 'card.reject'
  | 'card.submitting'
  | 'card.pendingNote'
  | 'card.error'
  | 'card.retry'
  | 'card.args'
