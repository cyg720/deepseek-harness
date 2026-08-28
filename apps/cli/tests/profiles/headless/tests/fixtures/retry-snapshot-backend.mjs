/** Deterministic provider adapter for the headless retry-policy snapshot.
 * @remarks 文件说明：文件职责：验证 apps/cli 中 retry snapshot backend 相关行为与失败场景。；
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。；产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。；
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。；
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。 */

import {
  LlmAdapter,
  LlmError,
  resolveRetryPolicy,
} from '@deepseek-ai/dsh-llm'

/**
 * 类说明：RetrySnapshotAdapter 用于集中封装 处理 RetrySnapshotAdapter 相关状态与行为。
 * 核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。
 * 使用场景：由 apps/cli 在对应插件或业务生命周期内创建和调用。
 */
class RetrySnapshotAdapter extends LlmAdapter {
  /**
   * 变量说明：requests 用于处理 requests 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  requests = 0
  /**
   * 变量说明：firstMessages 用于处理 firstMessages 相关数据，作用于成员；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  firstMessages
  /**
   * 变量说明：policy 用于处理 policy 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  policy = resolveRetryPolicy({
    mode: 'normal',
    maxRetries: 1,
    retryableCodes: ['RATE_LIMIT'],
    backoff: { initialDelayMs: 1, maxDelayMs: 1, jitterRatio: 0 },
  }, 'retry-snapshot-backend.retryPolicy')

  /**
   * 功能说明：处理 providerRetryPolicy 相关流程；使用场景由所在模块及调用位置决定。
   * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 providerRetryPolicy()，并按返回类型处理结果。
   */
  providerRetryPolicy() {
    return this.policy
  }

  /**
   * 功能说明：处理 stream 相关流程；使用场景由所在模块及调用位置决定。
   * @param options （由 TypeScript 根据调用位置推断的类型）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。
   * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 stream(options)，并按返回类型处理结果。
   */
  async * stream(options) {
    /**
     * 常量说明：messages 用于处理 messages 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const messages = JSON.stringify(options.messages)
    this.requests++
    if (this.requests === 1) {
      this.firstMessages = messages
      throw new LlmError('snapshot transient failure', 'RATE_LIMIT', { status: 429 })
    }
    if (this.requests === 2 && messages !== this.firstMessages) {
      throw new Error('retry snapshot changed the model-visible messages')
    }
    /**
     * 常量说明：text 用于处理 text 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const text = 'RETRY_OK'
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text }
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    yield { type: 'usage', usage: { inputTokens: 4, outputTokens: 2 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

/** Cordis plugin name.
 * @remarks 中文说明：常量说明：name 用于处理 name 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
export const name = 'retry-snapshot-backend'
/** Required LLM registry service.
 * @remarks 中文说明：常量说明：inject 用于处理 inject 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
export const inject = ['llm']

/**
 * Register the deterministic provider adapter.
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context carrying the LLM service.
 * @remarks 中文说明：功能说明：注册并应用 apply 相关流程；使用场景由所在模块及调用位置决定。；参数说明：ctx（由
 * TypeScript 根据调用位置推断的类型）：提供当前 Cordis 插件上下文与已声明服务；必须满足声明的类型及调用时序要求。；返回值：由
 * TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * apply(ctx)，并按返回类型处理结果。
 */
export function apply(ctx) {
  ctx.llm.registerAdapter(['deepseek-official'], new RetrySnapshotAdapter())
}
