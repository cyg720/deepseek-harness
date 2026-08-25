/*
 * ================================ 文件注释 ================================
 * 【文件职责】session-stats 域的纯类型：sessionStats 投影键声明的唯一出处，
 *   不含宿主侧值导入（cordis context、zod、llm 块谓词）。
 * 【技术维度】export {} 使本文件成为模块，从而"增强"投影表而非声明环境模块；
 *   types（宿主）与 client（客户端）两个命名空间投影同一份内容。
 * 【产品维度】字段名与客户端窗口折叠逐字对齐，无此单元的组装可整体回退到窗口折叠。
 * 【逻辑维度】SessionStatsProjection 接口 → 声明合并注册 sessionStats 键。
 * 【关键边界】所有字段从 0 起，首条贡献事件落地前保持 0。
 * 【新手阅读建议】把八个字段与 projection.ts 的折叠分支对照阅读。
 * ==========================================================================
 */

/**
 * Pure types of the session-stats domain: the ONE home of the `sessionStats`
 * projection-key declaration, free of this package's host-side value imports
 * (cordis context, zod, the llm chunk predicate). Two namespace projections
 * serve it — `./types` for host consumers, `./client` for client aggregates —
 * with zero content duplication.
 *
 * @module @deepseek-ai/dsh-session-stats/types
 */

// Marks this file a module so the declaration below AUGMENTS the projection
// table instead of declaring an ambient module.
export {}

/**
 * Whole-log conversation figures, independent of how much history a client
 * has paged in. Counts and wall times all fold from the complete durable log;
 * every field is 0 until its first contributing event lands. Field names
 * mirror the client window fold so an assembly without this unit can fall
 * back to it wholesale.
 */
export interface SessionStatsProjection {
  /** Distinct turns carrying at least one closed step (`step/end`); rejected or empty turns are uncounted. */
  turns: number
  /** Closed steps (`step/end` events) — completed, failed, and cancelled steps alike. */
  steps: number
  /** Summed model wall time (`step/start` → `assistant/message`) over steps that assembled a message. */
  llmMs: number
  /** Summed tool wall time over `tool/call` → `tool/result` pairs matched by callId. */
  toolMs: number
  /** Summed first-token latency (`step/start` → first non-empty delta chunk) over `ttftSteps`. */
  ttftMs: number
  /** Steps carrying a recorded first token. */
  ttftSteps: number
  /** Summed decode wall time (first token → `assistant/message`) over steps that also report output tokens. */
  decodeMs: number
  /** Summed provider output tokens over the same decode-timed steps. */
  decodeTokens: number
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /** Whole-log turn/step counts and wall times; see {@link SessionStatsProjection}. */
    sessionStats: SessionStatsProjection
  }
}
