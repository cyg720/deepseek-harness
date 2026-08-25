/*
 * ================================ 文件注释 ================================
 * 【文件职责】实现"启发式上下文构成"投影单元：系统提示与工具 schema 取最新
 * 请求包络，对话部分取实时表面；用与 meter 服务相同的共享估计器定价，因此
 * 三个数字与 measure() 的启发式词汇完全一致。
 * 【技术维度】标准投影单元（ProjectionDefinition）：zod 定义状态 schema 与
 * 视图 schema（strict，未知键拒绝）；消息数字复用 foldSurfaceProjection 的
 * O(1) 折叠，因此完整计量的日志在任意事件边界都等于 measure().surfaceTokens，
 * 压缩按日志的影子价格收缩；无 claim 的替换保留先前总量。状态只是固定几个
 * 数字，持久化检查点保持 O(1)。
 * 【产品维度】UI 展示"下一次请求由什么组成"（系统/工具/消息占比），帮助用户
 * 理解上下文预算的去向。
 * 【逻辑维度】schema 与状态类型 → 投影定义（init/apply/wire）。
 * 【关键边界】包络字段按 request/header last-wins；替换无 claim 时保留旧值。
 * 【新手阅读建议】先读英文注释理解"构成而非总额"，再看 apply 的三路更新。
 * ==========================================================================
 */

/**
 * Pure fold for the heuristic context-composition projection: system prompt
 * and tool schemas from the newest request envelope, conversation from the
 * live surface. Prices with the same shared estimator as the meter service,
 * so the three figures match `measure()`'s heuristic vocabulary exactly.
 */

import { z } from 'zod'
import { canonicalHeader } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import { estimateSystemTokens, estimateToolsTokens } from './estimate.ts'
import { foldSurfaceProjection } from './surface-projection.ts'
// Import for the `contextBreakdown` SessionProjectionStateMap key merge.
import type {} from './projection.ts'

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    contextBreakdown: ContextBreakdownState
  }
}

/** Non-negative integer token count (the shared figure shape). */
// 中文：非负整数 token 数（共享的数字形状）。
const tokenCount = z.number().int().nonnegative()

/** The context-breakdown state schema and source of its inferred type. */
// 中文：context-breakdown 状态 schema（含可选 claim）与推导出的状态类型。
const contextBreakdownStateSchema = z.object({
  systemTokens: tokenCount,
  toolsTokens: tokenCount,
  messageTokens: tokenCount,
  claim: z.object({
    start: tokenCount,
    end: tokenCount,
    tokens: tokenCount,
  }).optional(),
}).strict()
type ContextBreakdownState = z.infer<typeof contextBreakdownStateSchema>

// 中文：对外视图 schema（不含内部 claim）。
const breakdownSchema = z.object({
  systemTokens: tokenCount,
  toolsTokens: tokenCount,
  messageTokens: tokenCount,
}).strict()

/*
 * （中文）token-meter 的上下文构成投影单元。
 * 包络数字按 request/header last-wins；消息数字复用 foldSurfaceProjection——
 * 与占用投影相同的 O(1) 折叠——因此完整计量的日志在任意事件边界都等于
 * measure().surfaceTokens，压缩按日志的影子价格收缩。无 claim 的替换保留
 * 先前总量。状态只是固定几个数字，持久化检查点保持 O(1)。
 */
/**
 * Token-meter's context-composition projection unit.
 *
 * Envelope figures are last-wins per `request/header`; the message figure
 * rides {@link foldSurfaceProjection} — the same O(1) fold the occupancy
 * projection uses — so fully metered logs equal `measure().surfaceTokens` at
 * every event boundary and compaction shrinks the figure by its logged shadow
 * price. A replacement without a claim preserves the previous total. The
 * state is a fixed handful of numbers, so the persisted checkpoint stays
 * O(1) over the session's life.
 */
export const contextBreakdownProjectionDefinition = {
  key: 'contextBreakdown',
  stateVersion: 2,
  stateSchema: contextBreakdownStateSchema,
  init: () => ({ systemTokens: 0, toolsTokens: 0, messageTokens: 0 }),
  apply: (state, event) => {
    // 中文：先做表面折叠（维护 claim 与消息增量）。
    const fold = foldSurfaceProjection(state.claim, event)
    let systemTokens = state.systemTokens
    let toolsTokens = state.toolsTokens
    if (event.type === 'request/header') {
      // 中文：新请求头：重估系统提示与工具 schema（last-wins）。
      const header = canonicalHeader(event.data.header)
      systemTokens = estimateSystemTokens(header)
      toolsTokens = estimateToolsTokens(header)
    }
    // 中文：无任何变化时复用原状态（不新建对象）。
    if (systemTokens === state.systemTokens
      && toolsTokens === state.toolsTokens
      && fold.deltaTokens === 0
      && fold.claim === undefined
      && state.claim === undefined) return state
    return {
      systemTokens,
      toolsTokens,
      messageTokens: state.messageTokens + fold.deltaTokens,
      ...fold.claim === undefined ? {} : { claim: fold.claim },
    }
  },
  wire: {
    viewSchema: breakdownSchema,
    view: ({ systemTokens, toolsTokens, messageTokens }) => ({ systemTokens, toolsTokens, messageTokens }),
  },
} satisfies ProjectionDefinition<'contextBreakdown', ContextBreakdownState>
