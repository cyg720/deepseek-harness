/**
 * 文件职责：验证 subagent/subagent-dsh-sdk 中 mock delegating llm 相关行为与失败场景。
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。
 * 产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 */
import type { Context } from '@deepseek-ai/cordis'
import { appendFileSync } from 'node:fs'
import type { GenerateOptions, LlmResolvedModelInfo, StreamChunk } from '@deepseek-ai/dsh-llm'
import { ToolCallId, LlmAdapter, ReasoningEffortId } from '@deepseek-ai/dsh-llm'

/**
 * Test adapter for the `mock-delegate` model: the first request calls the
 * `subagent` tool once, and the follow-up streams the tool result text back
 * verbatim — so the SDK child runtime's answer (the scripted child model's
 * cwd echo) reaches the parent session log for the driving e2e to assert.
 * @remarks 中文说明：类说明：MockDelegatingAdapter 用于集中封装 处理 MockDelegatingAdapter
 * 相关状态与行为。；核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。；使用场景：由
 * subagent/subagent-dsh-sdk 在对应插件或业务生命周期内创建和调用。
 */
class MockDelegatingAdapter extends LlmAdapter {
  /**
   * 功能说明：解析 Model 相关流程；使用场景由所在模块及调用位置决定。
   * @param provider （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param model （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns Promise<LlmResolvedModelInfo>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 resolveModel(provider, model)，并按返回类型处理结果。
   */
  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    if (process.env.DSH_TEST_PARENT_MODEL_RECORD !== undefined) {
      appendFileSync(process.env.DSH_TEST_PARENT_MODEL_RECORD, `${provider}/${model}\n`)
    }
    return Promise.resolve({
      provider,
      id: model,
      name: model,
      reasoning: {
        efforts: [{ id: ReasoningEffortId('max'), name: 'Maximum' }],
      },
    })
  }

  /**
   * 功能说明：处理 stream 相关流程；使用场景由所在模块及调用位置决定。
   * @param options （GenerateOptions）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。
   * @returns AsyncIterable<StreamChunk>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 stream(options)，并按返回类型处理结果。
   */
  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    /**
     * 常量说明：toolResultText 用于处理 toolResultText 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：block（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(block)，并按返回类型处理结果。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：block（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(block)，并按返回类型处理结果。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：block（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(block)，并按返回类型处理结果。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：block（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(block)，并按返回类型处理结果。
     */
    const toolResultText = options.messages.at(-1)?.content
      .filter(block => block.type === 'tool-result')
      .flatMap(block => block.content)
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('') ?? ''

    if (toolResultText.length === 0) {
      /**
       * 常量说明：selectedRoute 用于处理 selectedRoute 相关数据，作用于当前作用域；初始化后不可重新赋值，
       * 但对象内部是否可变仍由其类型决定。
       */
      const selectedRoute = process.env.DSH_TEST_CHILD_DEFAULT_ROUTE === '1'
        ? { reasoning_effort: 'max' }
        : { provider: 'mock', model: 'mock-routed', reasoning_effort: 'max' }
      /**
       * 常量说明：args 用于处理 args 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const args = JSON.stringify({
        description: 'route probe',
        prompt: 'report your route and workspace',
        ...selectedRoute,
      })
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id: ToolCallId('call-delegate'), name: 'subagent', argumentsDelta: args }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: ToolCallId('call-delegate'), name: 'subagent', arguments: args } }
      yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
      return
    }

    /**
     * 常量说明：reply 用于处理 reply 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const reply = `child reported:\n${toolResultText}`
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: reply }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: reply } }
    yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

/**
 * 常量说明：name 用于处理 name 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
export const name = 'mock-llm'
/**
 * 常量说明：inject 用于处理 inject 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
export const inject = ['llm']

/**
 * Register the delegating mock adapter under the `mock` provider.
 * @param ctx - the plugin context supplying `ctx.llm`.
 * @remarks 中文说明：功能说明：注册并应用 apply 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：ctx（Context）：提供当前 Cordis 插件上下文与已声明服务；必须满足声明的类型及调用时序要求。；返回值：void；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 apply(ctx)，并按返回类型处理结果。
 */
export function apply(ctx: Context): void {
  /**
   * 常量说明：providers 用于处理 providers 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const providers = process.env.DSH_TEST_PARENT_PROVIDER === 'deepseek-official'
    ? ['deepseek-official', 'mock']
    : ['mock']
  ctx.llm.registerAdapter(providers, new MockDelegatingAdapter())
}
