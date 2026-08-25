/*
 * ================================ 文件注释 ================================
 * 【文件职责】把 token-meter 的浏览器安全类型暴露到 client 命名空间：只转发
 * projection.ts 的纯类型导出，供客户端（浏览器/UI 侧）无副作用引用。
 * 【技术维度】桶文件（barrel）：export type * 转发全部类型；不引入任何运行时
 * 依赖（projection.ts 是纯类型文件）。
 * 【产品维度】客户端 UI 需要消费 tokenUsage/contextPressure/contextBreakdown
 * 三类投影类型而不想拉入服务端实现，这个入口提供干净的浏览器安全类型面。
 * 【逻辑维度】单行转发。
 * 【关键边界】只转发类型，绝不携带服务端实现；新增投影类型时同步在
 * projection.ts 导出即可自动透传。
 * 【新手阅读建议】极简桶文件，直接看 projection.ts 获得全部类型定义。
 * ==========================================================================
 */

/**
 * Client-namespace projection of token-meter's browser-safe types.
 *
 * @module @deepseek-ai/dsh-token-meter/client
 */

export type * from './projection.ts'
