/**
 * The wrapper contract packed bodies are emitted against, and the image-entry
 * types the pack pass consumes.
 *
 * One transform serves both sides — the pack pass lowers with the runtime's
 * own `lowerModuleSource`, never a reimplementation — and the image records
 * the contract version it was lowered against. Bodies emitted against a
 * different wrapper contract are refused at mount time rather than
 * half-working at run time.
 * @module @deepseek-ai/dsh-experimental-webworker-packer/src/transform-image
 * @remarks 文件说明：文件职责：实现 experimental/webworker-packer 中 transform image
 * 模块的职责，并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与
 * Cordis 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/webworker-packer 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 →
 * 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。
 */
import { LOWERING_VERSION } from '@deepseek-ai/dsh-experimental-webworker-runtime'

/** Image entries, keyed by their path relative to the virtual root. */
export type ImageFiles = Record<string, Uint8Array>

/** Wrapper contract the packed bodies are emitted against.
 * @remarks 中文说明：常量说明：WRAPPER_CONTRACT 用于处理 WRAPPER_CONTRACT 相关数据，作用于当前作用域；
 * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
export const WRAPPER_CONTRACT: string = LOWERING_VERSION

/** What one pack-time transform pass did. */
export interface TransformOutcome {
  /** JavaScript entries visited. */
  readonly visited: number
  /** How many changed; the rest were already in final form. */
  readonly rewritten: number
}
