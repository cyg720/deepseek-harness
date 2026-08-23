/**
 * ================================ 文件注释 ================================
 * 【文件职责】typert-generator 包的公共入口（桶文件）：统一再导出分析器、模型、
 *             发射器与渲染器，以及工作区级生成器。构建期接线在 ./tsdown 子路径。
 * 【技术维度】纯再导出：不包含任何实现；类型与值分开导出，便于按需引入。
 * 【产品维度】外部（如构建脚本、CLI）只需 import @deepseek-ai/dsh-typert-generator
 *             即可拿到整套"从源码生成类型图产物"的能力。
 * 【逻辑维度】按代码顺序：analyzer（工作区分析）、emitter（模型发射）、
 *             cordis-catalog（目录 / 清单）、renderer（渲染器）、workspace（工作区入口）、
 *             model（模型类型全集）。
 * 【关键边界】tsdown 插件不在本入口导出，需要单独 import 子路径，避免给普通消费者
 *             引入 rolldown 相关依赖。
 * 【新手阅读建议】想理解生成流程，建议按 workspace → analyzer → model → emitter
 *             顺序阅读对应源码文件。
 * ==========================================================================
 */

/**
 * Public API of the Typert analyzer, compiler-independent model, and
 * model-driven artifact emitters. Build wiring lives in the `./tsdown`
 * subpath.
 * @module @deepseek-ai/dsh-typert-generator
 */
// 中文导读：本文件只是"集散地"，把各模块的公开符号汇聚成一个包级 API 面。

export { WorkspaceAnalyzer, WorkspaceCaches, TypertAnalysisError } from './analyzer.ts'
export type { AnalysisMode, DiscoveredTypertPackage, WorkspaceAnalyzerOptions } from './analyzer.ts'
export { FaceModelEmitter, TypertEmitError } from './emitter.ts'
export type { ModelEmitResult } from './emitter.ts'
export * from './cordis-catalog.ts'
export { TypeGraphRenderer, TypeGraphRenderError } from './renderer.ts'
export { WorkspaceTypertGenerator } from './workspace.ts'
export type { WorkspaceEmitResult } from './workspace.ts'
export type * from './model.ts'
