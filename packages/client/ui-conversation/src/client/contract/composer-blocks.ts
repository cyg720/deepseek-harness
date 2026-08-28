/**
 * 文件职责：实现 client/ui-conversation 中 composer blocks 模块的职责，并向相邻模块提供可复用能力。
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。
 * 产品维度：支撑 DeepSeek Harness 的 client/ui-conversation 能力，使上层功能能够稳定组合和扩展。
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 */
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** Why one session's composer is inert. */
export interface ComposerBlock {
  /** Localized placeholder owned by the plugin that raised the block. */
  readonly reason: string
}

/** The registry face other plugins reach through `ctx.conversation.blocks`. */
export interface ComposerBlocks {
  /**
   * Raise or clear this session's block.
   * @param sessionId - Session whose composer is affected.
   * @param block - Block to raise, or undefined to clear it.
   * @remarks 中文说明：功能说明：设置 set 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：sessionId（SessionId）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：block（ComposerBlock | undefined）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：void；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 set(sessionId,
   * block)，并按返回类型处理结果。
   */
  set(sessionId: SessionId, block: ComposerBlock | undefined): void
  /**
   * Resolve the observable block state for one Session.
   * @param sessionId - Session to observe.
   * @returns Identity-stable block store.
   * @remarks 中文说明：功能说明：处理 storeFor 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：sessionId（SessionId）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：SnapshotStore<ComposerBlock | undefined>；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 使用示例：典型用法：在完成前置校验后调用 storeFor(sessionId)，并按返回类型处理结果。
   */
  storeFor(sessionId: SessionId): SnapshotStore<ComposerBlock | undefined>
  /**
   * Drop one Session's store.
   * @param sessionId - Session being released.
   * @remarks 中文说明：功能说明：处理 forget 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：sessionId（SessionId）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 forget(sessionId)，
   * 并按返回类型处理结果。
   */
  forget(sessionId: SessionId): void
}
