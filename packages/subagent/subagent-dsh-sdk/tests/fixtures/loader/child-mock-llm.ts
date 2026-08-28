/**
 * 文件职责：验证 subagent/subagent-dsh-sdk 中 child mock llm 相关行为与失败场景。
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。
 * 产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 */
import type { Context } from '@deepseek-ai/cordis'
import { existsSync, writeFileSync } from 'node:fs'
import { setTimeout } from 'node:timers/promises'
import type { GenerateOptions, LlmResolvedModelInfo, StreamChunk } from '@deepseek-ai/dsh-llm'
import { LlmAdapter, ReasoningEffortId } from '@deepseek-ai/dsh-llm'

/**
 * Scripted model for the CHILD runtime: validates either the routed success
 * case or the diagnostic fixture's fixed route. Failure mode streams partial
 * text before a fixed provider error so the parent can assert safe diagnostics.
 * @remarks 中文说明：类说明：RouteEchoAdapter 用于集中封装 处理 RouteEchoAdapter 相关状态与行为。；
 * 核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。；使用场景：由 subagent/subagent-dsh-sdk
 * 在对应插件或业务生命周期内创建和调用。
 */
class RouteEchoAdapter extends LlmAdapter {
  /**
   * 功能说明：解析 Model 相关流程；使用场景由所在模块及调用位置决定。
   * @param provider （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param model （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns Promise<LlmResolvedModelInfo>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 resolveModel(provider, model)，并按返回类型处理结果。
   */
  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
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
     * 常量说明：failure 用于处理 failure 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const failure = process.env.DSH_TEST_CHILD_FAILURE === '1'
    /**
     * 常量说明：dynamicRoute 用于处理 dynamicRoute 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const dynamicRoute = options.provider === 'mock'
      && options.model === 'mock-routed'
      && options.reasoningEffort === 'max'
      && options.maxTokens === 777
    /**
     * 常量说明：diagnosticRoute 用于处理 diagnosticRoute 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const diagnosticRoute = failure
      && options.provider === 'mock'
      && options.model === 'mock-echo'
    if (!dynamicRoute && !diagnosticRoute) {
      throw new Error(`unexpected child route: ${JSON.stringify({
        provider: options.provider,
        model: options.model,
        reasoningEffort: options.reasoningEffort,
        maxTokens: options.maxTokens,
      })}`)
    }
    /**
     * 常量说明：ready 用于处理 ready 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const ready = process.env.FAKE_INIT_READY
    /**
     * 常量说明：release 用于处理 release 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const release = process.env.FAKE_INIT_GO
    if (ready !== undefined) writeFileSync(ready, 'ready\n')
    if (release !== undefined) {
      /**
       * 常量说明：deadline 用于处理 deadline 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const deadline = Date.now() + 30_000
      while (!existsSync(release)) {
        if (Date.now() > deadline) throw new Error(`child mock timed out waiting for ${release}`)
        await setTimeout(10)
      }
    }
    /**
     * 常量说明：reply 用于处理 reply 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const reply = failure
      ? 'partial child loader answer'
      : `child route: mock/mock-routed/max/777; cwd: ${process.cwd()}`
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: reply }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: reply } }
    yield { type: 'usage', usage: { inputTokens: 3, outputTokens: 5 } }
    yield failure
      ? { type: 'finish', reason: { kind: 'error', failure: { code: 'CHILD_TEST_FAILURE', message: 'child loader failure' } } }
      : { type: 'finish', reason: { kind: 'stop' } }
  }
}

/**
 * 常量说明：name 用于处理 name 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
export const name = 'child-mock-llm'
/**
 * 常量说明：inject 用于处理 inject 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
export const inject = ['llm']

/**
 * Register the cwd-echo adapter under the `mock` provider.
 * @param ctx - the plugin context supplying `ctx.llm`.
 * @remarks 中文说明：功能说明：注册并应用 apply 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：ctx（Context）：提供当前 Cordis 插件上下文与已声明服务；必须满足声明的类型及调用时序要求。；返回值：void；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 apply(ctx)，并按返回类型处理结果。
 */
export function apply(ctx: Context): void {
  ctx.llm.registerAdapter(['mock'], new RouteEchoAdapter())
}
