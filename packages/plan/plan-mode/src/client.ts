/**
 * Client-namespace projection of the plan domain: a pure re-export of the package's
 * types outlet. Client code imports ONLY the client namespace (repo
 * discipline), so `./client` projects the same single-source content
 * `./types` serves to host consumers — zero duplication.
 *
 * @module @deepseek-ai/dsh-plan-mode/client
 */
/*
 * 文件职责：把计划模式共享类型投影到浏览器客户端命名空间。
 * 技术维度：通过 `export type *` 保持类型单一来源且不产生 JavaScript。
 * 产品维度：计划控件与命令界面可使用一致的模式和事件类型。
 * 逻辑维度：把 `types.ts` 的所有类型从 `./client` 路径重新导出。
 * 关键边界：此文件不能加入计划状态或运行逻辑，实际状态来自会话日志。
 * 新手阅读建议：先读 types.ts，再把本文件理解为浏览器导入路径别名。
 */

export type * from './types.ts'
