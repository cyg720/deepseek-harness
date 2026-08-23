/**
 * ================================ 文件注释 ================================
 * 【文件职责】标题域的纯类型出口：title 投影键声明的唯一出处（宿主状态表 + 客户端视图表）。
 * 【技术维度】export {} 使文件成为模块以"增强"投影表；纯类型、无宿主侧值导入。
 * 【产品维度】客户端列表行消费的标题投影（last-wins 纯文本）。
 * 【逻辑维度】投影键声明合并（title: string | null）。
 * 【新手阅读建议】与 session-title 服务里注册的 title 投影单元对照。
 * ==========================================================================
 */

/**
 * Pure types of the title domain: the ONE home of the `title` projection-key
 * declaration, free of this package's host-side value imports (cordis
 * service, schemastery, the llm seam). Two namespace projections serve it —
 * `./types` for host consumers, `./client/types` (the browser half-entry's
 * re-export) for client aggregates — with zero content duplication.
 *
 * @module @deepseek-ai/dsh-session-title/types
 */

// Marks this file a module so the declaration below AUGMENTS the projection
// table instead of declaring an ambient module.
export {}

// 中文：声明合并：把 title 投影键同时注册进宿主状态表（折叠态）与客户端视图表（标题文本）。
declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    title: string | null
  }
  interface SessionProjectionMap {
    /**
     * The session's current normalized title — the latest `session/title`
     * event's text (last-wins), or `null` before the first title lands. A
     * plain string: the shape the client list rows consume.
     */
    title: string | null
  }
}
