/**
 * 文件职责：验证 context/time-context 中 mock llm 相关行为与失败场景。
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。
 * 产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 */
import type { Context } from '@deepseek-ai/cordis'
import { LlmAdapter, type StreamChunk } from '@deepseek-ai/dsh-llm'

/** Deterministic one-step adapter for the time-context Loader fixture.
 * @remarks 中文说明：类说明：TimeContextMockAdapter 用于集中封装 处理
 * TimeContextMockAdapter 相关状态与行为。；核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。；
 * 使用场景：由 context/time-context 在对应插件或业务生命周期内创建和调用。 */
class TimeContextMockAdapter extends LlmAdapter {
  /**
   * 功能说明：处理 stream 相关流程；使用场景由所在模块及调用位置决定。
   * @returns AsyncIterable<StreamChunk>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 stream()，并按返回类型处理结果。
   */
  async * stream(): AsyncIterable<StreamChunk> {
    /**
     * 常量说明：text 用于处理 text 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const text = 'time context sampled'
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text }
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

/**
 * 常量说明：name 用于处理 name 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
export const name = 'time-context-mock-llm'
/**
 * 常量说明：inject 用于处理 inject 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
export const inject = ['llm']

/** Register the test-only `time-context-mock` adapter.
 * @remarks 中文说明：功能说明：注册并应用 apply 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：ctx（Context）：提供当前 Cordis 插件上下文与已声明服务；必须满足声明的类型及调用时序要求。；返回值：void；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 apply(ctx)，并按返回类型处理结果。 */
export function apply(ctx: Context): void {
  ctx.llm.registerAdapter(['time-context-mock'], new TimeContextMockAdapter())
}
