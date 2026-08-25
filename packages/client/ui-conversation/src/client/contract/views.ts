/*
 * ================================ 文件注释 ================================
 * 【文件职责】会话共享的视图 / 选择 / 存储状态契约：调用 id、详情联动选择目标、视图页签
 *             与每会话聊天 store 状态。
 * 【技术维度】纯类型文件；ChatStoreState 被 stores.ts 的 defineStore 与各槽位消费。
 * 【产品维度】详情面板 / 轨迹视图 / 对话视图之间靠这些类型协作。
 * 【逻辑维度】1) CallId；2) SelectionTarget；3) ViewTab；4) ChatStoreState。
 * 【关键边界】未知的持久化视图 id 回退到 Chat 视图；inspect 是"一次性交接"语义
 *             （消费方读取后清除）。
 * 【新手阅读建议】把 ChatStoreState 四个字段与 stores.ts 的动作对照看。
 * ==========================================================================
 */
/** Shared conversation view, selection, and store-state contracts. */

/** Tool call identity as carried on the wire (branded upstream in connection). */
export type CallId = string

/** Selection target for the details linkage channel (toolcall is the step special case). */
// 详情联动通道的选择目标（工具调用是步骤的特例）。
export interface SelectionTarget { turnSeq: number; stepSeq?: number; callId?: CallId; toolName?: string }

/**
 * One conversation view tab, projected from a 'conversation.view' slot
 * entry's registration options (label falls back to the entry id).
 */
// 一个会话视图页签：从 'conversation.view' 槽位条目的注册选项投影而来
// （label 缺省时回退到条目 id）。
export interface ViewTab { id: string; label: string }

/**
 * Per-session state shared by conversation, chat-view, and details slots.
 * Unknown persisted view ids fall back to the stable Chat view.
 */
// 会话骨架、聊天视图与详情槽位共享的每会话状态；未知的持久化视图 id 回退到 Chat 视图。
export interface ChatStoreState {
  /** Details-linkage channel (conversation writes, details reads). */
  // 详情联动通道（会话侧写、详情侧读）。
  selection: SelectionTarget | null
  /** Composer draft (persisted; survives session switches and reloads). */
  // 输入框草稿（持久化；跨会话切换与刷新保留）。
  draft: string
  /** Active conversation view id ('conversation.view' entry id); null falls back to Chat. */
  // 当前会话视图 id；null 回退到 Chat。
  view: string | null
  /**
   * One-shot inspect handoff: chat writes the call to reveal, the trajectory
   * view consumes it and acknowledges by clearing. Read with `?? null` —
   * persisted snapshots from before this field rehydrate without it.
   */
  // 一次性"检查"交接：chat 写入要展示的调用，轨迹视图消费后清除确认；读取用 ?? null——
  // 本字段出现前的持久化快照在回填时没有它。
  inspect: { callId: CallId } | null
}
