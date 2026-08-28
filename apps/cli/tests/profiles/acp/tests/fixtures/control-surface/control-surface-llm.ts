/** Keyless two-model adapter for the generic ACP control-surface conformance test.
 * @remarks 文件说明：文件职责：验证 apps/cli 中 control surface llm 相关行为与失败场景。；
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。；产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。；
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。；
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。 */

import type { Context } from '@deepseek-ai/cordis'
import {
  ToolCallId,
  LlmAdapter,
  ReasoningEffortId,
  type GenerateOptions,
  type LlmResolvedModelInfo,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'

/** Adapter whose deterministic tool turn proves model selection and MCP attachment.
 * @remarks 中文说明：类说明：ControlSurfaceAdapter 用于集中封装 处理 ControlSurfaceAdapter
 * 相关状态与行为。；核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。；使用场景：由 apps/cli
 * 在对应插件或业务生命周期内创建和调用。 */
class ControlSurfaceAdapter extends LlmAdapter {
  /**
   * 功能说明：处理 providerInfo 相关流程；使用场景由所在模块及调用位置决定。
   * @param provider （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 providerInfo(provider)，并按返回类型处理结果。
   */
  override providerInfo(provider: string) {
    if (provider !== 'control-fixture') throw new Error(`unknown fixture provider: ${provider}`)
    return { id: provider, name: 'Control fixture' }
  }

  /**
   * 功能说明：列出 Models 相关流程；使用场景由所在模块及调用位置决定。
   * @param provider （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 listModels(provider)，并按返回类型处理结果。
   */
  override listModels(provider: string) {
    if (provider !== 'control-fixture') return Promise.resolve([])
    return Promise.resolve([
      { provider, id: 'alpha', name: 'Alpha', inputModalities: ['text'] as const },
      { provider, id: 'beta', name: 'Beta', inputModalities: ['text'] as const },
    ])
  }

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
      inputModalities: ['text'],
      context: { contextWindow: 2_048 },
      reasoning: {
        efforts: [
          { id: ReasoningEffortId('low'), name: 'Low' },
          { id: ReasoningEffortId('high'), name: 'High' },
        ],
        defaultEffort: ReasoningEffortId('high'),
      },
    })
  }

  /**
   * 功能说明：处理 stream 相关流程；使用场景由所在模块及调用位置决定。
   * @param options （GenerateOptions）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。
   * @returns AsyncIterable<StreamChunk>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 stream(options)，并按返回类型处理结果。
   */
  override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    /**
     * 常量说明：lastUserIndex 用于处理 lastUserIndex 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const lastUserIndex = options.messages.findLastIndex(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：message（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(message)，并按返回类型处理结果。
 */ message => message.source.kind === 'user')
    /**
     * 常量说明：current 用于处理 current 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const current = options.messages.slice(lastUserIndex)
    /**
     * 常量说明：userText 用于处理 userText 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const userText = current.flatMap(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：message（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(message)，并按返回类型处理结果。
 */ message => message.content)
      .flatMap(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：block（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(block)，并按返回类型处理结果。
 */ block => block.type === 'text' ? [block.text] : [])
      .join('')
    /**
     * 常量说明：hasToolResult 用于判断是否包含 Tool Result 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const hasToolResult = current.some(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：message（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(message)，并按返回类型处理结果。
 */ message => message.content.some(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：block（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(block)，并按返回类型处理结果。
 */ block => block.type === 'tool-result'))
    if (!hasToolResult) {
      /**
       * 常量说明：callId 用于处理 callId 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const callId = ToolCallId(userText.includes('cancel') ? 'control-cancel-add' : 'control-add')
      yield { type: 'block-start', index: 0, blockType: 'reasoning' }
      yield { type: 'reasoning-delta', index: 0, text: 'checking the attached tool' }
      yield { type: 'block-end', index: 0, block: { type: 'reasoning', text: 'checking the attached tool' } }
      yield { type: 'block-start', index: 1, blockType: 'tool-call' }
      yield {
        type: 'tool-call-delta',
        index: 1,
        id: callId,
        name: 'mcp__fixture__add',
        argumentsDelta: '{"a":2,"b":3}',
      }
      yield {
        type: 'block-end',
        index: 1,
        block: {
          type: 'tool-call',
          id: callId,
          name: 'mcp__fixture__add',
          arguments: '{"a":2,"b":3}',
        },
      }
      yield { type: 'usage', usage: { inputTokens: 8, outputTokens: 5 } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
      return
    }
    if (userText.includes('cancel')) {
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: 'waiting' }
      await new Promise<void>(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：_resolve（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：reject（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(_resolve, reject)，
 * 并按返回类型处理结果。
 */ (_resolve, reject) => {
          if (options.signal?.aborted === true) {
            reject(new Error('cancelled'))
            return
          }
          options.signal?.addEventListener('abort', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => { reject(new Error('cancelled')) }, { once: true })
        })
      return
    }
    /**
     * 常量说明：text 用于处理 text 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const text = `model=${options.model}; tool=5`
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text }
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    yield { type: 'usage', usage: { inputTokens: 13, outputTokens: 5 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

/**
 * 常量说明：name 用于处理 name 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
export const name = 'control-surface-llm'
/**
 * 常量说明：inject 用于处理 inject 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
export const inject = ['llm']

/** Register the deterministic control-surface provider.
 * @remarks 中文说明：功能说明：注册并应用 apply 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：ctx（Context）：提供当前 Cordis 插件上下文与已声明服务；必须满足声明的类型及调用时序要求。；返回值：void；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 apply(ctx)，并按返回类型处理结果。 */
export function apply(ctx: Context): void {
  ctx.llm.registerAdapter(['control-fixture'], new ControlSurfaceAdapter())
}
