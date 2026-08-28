/** Exact-read Session query used by the descriptor-less child snapshot.
 * @remarks 文件说明：文件职责：验证 apps/cli 中 subagent diagnostic query 相关行为与失败场景。；
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。；产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。；
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。；
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。 */

import SessionQueryEngine from '@deepseek-ai/dsh-session-query'

/** Search is outside this fixture; inherited corpus and observation reads stay real.
 * @remarks 中文说明：类说明：SubagentDiagnosticQuery 用于集中封装 处理
 * SubagentDiagnosticQuery 相关状态与行为。；核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。；
 * 使用场景：由 apps/cli 在对应插件或业务生命周期内创建和调用。 */
export default class SubagentDiagnosticQuery extends SessionQueryEngine {
  /**
   * 功能说明：处理 searchSessions 相关流程；使用场景由所在模块及调用位置决定。
   * @returns Promise<never>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 searchSessions()，并按返回类型处理结果。
   */
  override searchSessions(): Promise<never> {
    return Promise.reject(new Error('session search is unavailable in this fixture'))
  }

  /**
   * 功能说明：处理 searchEvents 相关流程；使用场景由所在模块及调用位置决定。
   * @returns Promise<never>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 searchEvents()，并按返回类型处理结果。
   */
  override searchEvents(): Promise<never> {
    return Promise.reject(new Error('event search is unavailable in this fixture'))
  }
}
