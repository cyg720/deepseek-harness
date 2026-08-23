/**
 * ================================ 文件注释 ================================
 * 【文件职责】浏览器安全（无 Node 依赖）的子代理投影词汇入口：仅转发 projection-types 的类型。
 * 【技术维度】纯类型 re-export，不引入任何运行时依赖，可在浏览器环境编译使用。
 * 【产品维度】API 代理/前端需要消费子代理投影类型但不应接触 Node 侧实现时，从这里导入。
 * 【逻辑维度】单行导出两个投影类型。
 * 【关键边界】只导出类型，不导出任何运行时值。
 * 【新手阅读建议】追到 projection-types.ts 看类型定义即可。
 * ==========================================================================
 */

/**
 * Browser-safe subagent projection vocabulary.
 *
 * @module @deepseek-ai/dsh-subagent/client
 */

// 中文：浏览器安全（无 Node 依赖）的投影类型入口，仅转发类型，不引入任何运行时值。
export type { SubagentIdentityProjection, SubagentTimingProjection } from './projection-types.ts'
