/**
 * ================================ 文件注释 ================================
 * 【文件职责】标题域的客户端命名空间投影：纯转发 types 出口。
 * 【技术维度】客户端聚合只导入 client 命名空间（仓库纪律），零复制。
 * 【逻辑维度】单行 re-export。
 * 【关键边界】只导出类型。
 * 【新手阅读建议】追到 types.ts 看 title 投影键声明。
 * ==========================================================================
 */

/**
 * Client-namespace projection of the title domain: a pure re-export of the package's
 * types outlet. Client code imports ONLY the client namespace (repo
 * discipline), so `./client` projects the same single-source content
 * `./types` serves to host consumers — zero duplication.
 *
 * @module @deepseek-ai/dsh-session-title/client
 */

export type * from './types.ts'
