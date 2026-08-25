/*
 * ================================ 文件注释 ================================
 * 【文件职责】GoalBar 的注入面（inject face）类型定义：目标栏停靠条槽位
 *             需要的四个变更动词与它们的结果类型。
 * 【技术维度】纯类型模块：槽位由 ui-conversation 声明，本包只贡献入口；
 *             实时目标值不走注入面，而是通过 useProjection('goal') 到达。
 * 【产品维度】目标栏上"保存/暂停/恢复/清除"操作的后端接口形态。
 * 【逻辑维度】GoalActionResult 是远程调用结果；GoalBarActions 定义四个动词签名。
 * 【关键边界】成功值在条带中不被读取（变更后的目标经投影到达），只渲染失败。
 * 【新手阅读建议】与 GoalBar.tsx 配合理解注入面与投影的分工。
 * ==========================================================================
 */
/**
 * GoalBar's injected face. The target 'conversation.input.dock' slot is
 * declared (children table) and typed by ui-conversation; this package only
 * contributes the entry, so no SlotMap merge lives here. The live goal value
 * is NOT part of this face — it arrives through `useProjection('goal')`
 * (the framework standard kit); inject carries only the mutation verbs
 * (callbacks from inject, live state from useProjection).
 */

import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'

/**
 * Settled outcome of one goal mutation, rendered inline by the strip. The
 * the strip renders the failure only — the mutated goal arrives through the
 * projection — so the success value stays unread here.
 */
// 一次目标变更的结算结果：条带只渲染失败，成功值经投影到达、此处不读。
export type GoalActionResult = RemoteResult<unknown>

/** Injected business face of the GoalBar dock entry: the mutation verbs (function properties: the strip destructures them freely). */
export interface GoalBarActions {
  /**
   * Replace the current goal's objective (CAS on the projected ref).
   * @param objective - replacement objective text.
   */
  onEdit: (objective: string) => Promise<GoalActionResult>
  /** Pause an active goal. */
  onPause: () => Promise<GoalActionResult>
  /** Resume a paused goal. */
  onResume: () => Promise<GoalActionResult>
  /** Clear the current goal (tombstone). */
  onClear: () => Promise<GoalActionResult>
}
