/**
 * Wire-safe question and answer types, free of cordis/service imports so browser
 * type chains (apiproxy api → client) can consume them without loading this
 * package's Context augmentation.
 * @module @deepseek-ai/dsh-user-questions/types
 */
/*
 * 文件职责：实现交互与审批的 types.ts 模块。
 * 技术维度：TypeScript、Cordis 服务、会话事件、持久状态、Node 宿主接口和 Vitest。
 * 产品维度：保证交互与审批在授权、等待、失败和清理场景中可靠。
 * 逻辑维度：注册能力，校验请求，更新状态并记录事件。
 * 关键边界：匿名标识不是认证；模型可见审批、提问和任务信息必须写入会话日志。
 * 新手阅读建议：先读类型与事件，再按注册、请求、状态变化和清理流程阅读。
 */

/** One selectable answer offered to the user. */
/* 中文说明：类型或类 AskUserQuestionOption 约束宿主、交互或任务数据职责。 */
export interface AskUserQuestionOption {
  /** User-facing label. */
  label: string
  /** Optional extra context rendered by capable UIs. */
  description?: string
}

/**
 * A caller-declared presentation intent: the question IS this kind of
 * decision, so a UI that recognises the tag may present it as such instead of as a
 * generic option list. Tagged so further intents can be added; a UI that does
 * not know a tag renders the generic flow, and the answer encoding is identical
 * either way — an intent changes presentation only, never the protocol.
 */
/* 中文说明：类型或类 AskUserQuestionIntent 约束宿主、交互或任务数据职责。 */
export type AskUserQuestionIntent = {
  /** A plan submitted for review: `detail` is the plan markdown `ask()` requires, and the decision approves or declines it. */
  kind: 'plan-review'
  /**
   * The option label that approves the plan; every other option declines it.
   * Named rather than positional so no UI infers the verdict from option order.
   * An `approve` naming no option of its own question is rejected at `ask()`.
   */
  approve: string
}

/** One question in a user-questions request. */
/* 中文说明：类型或类 AskUserQuestionItem 约束宿主、交互或任务数据职责。 */
export interface AskUserQuestionItem {
  /** Stable caller-provided question id, echoed in the answer. */
  id: string
  /** The question to display. */
  question: string
  /** Optional supporting detail rendered with the question but kept out of option labels. */
  detail?: string
  /** Optional short heading/group label. */
  header?: string
  /** Optional choices the UI can render as a menu. */
  options?: AskUserQuestionOption[]
  /** Whether more than one option may be selected. Defaults to single-select. */
  multiSelect?: boolean
  /** Optional presentation intent for capable UIs; absent asks for the generic option list. */
  intent?: AskUserQuestionIntent
}

/** Answer to one question. */
/* 中文说明：类型或类 AskUserQuestionAnswerItem 约束宿主、交互或任务数据职责。 */
export interface AskUserQuestionAnswerItem {
  /** The answered question id. */
  id: string
  /** Selected option labels. May accompany custom text for a multi-select question. */
  selected: string[]
  /** Optional free-text "Other" answer. */
  custom?: string
}

/** The human's answer. */
/* 中文说明：类型或类 AskUserQuestionAnswer 约束宿主、交互或任务数据职责。 */
export interface AskUserQuestionAnswer {
  /** Structured answers keyed by question id. */
  answers: AskUserQuestionAnswerItem[]
}
