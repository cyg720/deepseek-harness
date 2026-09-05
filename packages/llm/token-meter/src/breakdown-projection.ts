

/**
 * Pure fold for the heuristic context-composition projection: system prompt
 * and tool schemas from the newest request envelope, conversation from the
 * live surface. Prices with the same shared estimator as the meter service,
 * so the three figures match `measure()`'s heuristic vocabulary exactly.
 */

/*
 * 【文件职责】从最新请求配置与当前会话表面计算上下文构成，使用 token-meter 共用的启发式估算器。
 */

import { z } from 'zod'
import { canonicalHeader, SessionSeq } from '@deepseek-ai/dsh-session'
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
const sessionSeq = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).transform(SessionSeq)

/** The context-breakdown state schema and source of its inferred type. */
// 中文：context-breakdown 状态 schema（含可选 claim）与推导出的状态类型。
const contextBreakdownStateSchema = z.object({
  systemTokens: tokenCount,
  toolsTokens: tokenCount,
  messageTokens: tokenCount,
  claim: z.object({
    start: sessionSeq,
    end: sessionSeq,
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
 * projection uses — so fully metered logs equal the sum of
 * `measure().nodes[].heuristicTokens` at every event boundary and compaction
 * shrinks the figure by its logged shadow price; the route-priced
 * `measure().surfaceTokens` deliberately diverges by the routed model's image
 * repricing. A replacement without a claim preserves the previous total. The
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
