/** Stable failures exposed by the session-persistence service.
 * @remarks 文件说明：文件职责：实现 session/session-persistence 中 errors 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * session/session-persistence 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态
 * → 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。 */

import type { SessionId } from '@deepseek-ai/dsh-session'

/** The requested Session identity has no materialized durable log.
 * @remarks 中文说明：类说明：SessionPersistenceNotFoundError 用于集中封装 处理
 * SessionPersistenceNotFoundError 相关状态与行为。；核心功能：通过成员字段保存状态，
 * 并由公开方法提供受类型约束的操作入口。；使用场景：由 session/session-persistence
 * 在对应插件或业务生命周期内创建和调用。 */
export class SessionPersistenceNotFoundError extends Error {
  /** @param sessionId - absent durable Session identity.
   * @remarks 中文说明：功能说明：处理 SessionPersistenceNotFoundError 相关流程；
   * 使用场景由所在模块及调用位置决定。；参数说明：sessionId（SessionId）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * ；返回值：当前类实例；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：通过 new
   * SessionPersistenceNotFoundError(sessionId) 创建实例，并在所属生命周期内使用。 */
  constructor(readonly sessionId: SessionId) {
    super(`session "${sessionId}" not found`)
    this.name = 'SessionPersistenceNotFoundError'
  }
}
