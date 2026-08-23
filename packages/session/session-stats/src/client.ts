/**
 * ================================ 文件注释 ================================
 * 【文件职责】session-stats 域的客户端命名空间投影：纯转发 types 出口。
 * 【技术维度】客户端聚合只允许导入 client 命名空间（仓库纪律），
 *   因此这里把同一份类型内容再投影一次，零复制。
 * 【逻辑维度】单行 re-export。
 * 【关键边界】只导出类型。
 * 【新手阅读建议】追到 types.ts 看 SessionStatsProjection 定义。
 * ==========================================================================
 */

/**
 * Client-namespace projection of the session-stats domain: a pure re-export
 * of the package's types outlet. Client code imports ONLY the client
 * namespace (repo discipline), so `./client` projects the same single-source
 * content `./types` serves to host consumers — zero duplication.
 *
 * @module @deepseek-ai/dsh-session-stats/client
 */

export type * from './types.ts'
