/**
 * 文件职责：验证 acp/acp 中 model control spec 相关行为与失败场景。
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。
 * 产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 */
import { describe, expect, it, vi } from 'vitest'
import { ReasoningEffortId, type LlmRuntime } from '@deepseek-ai/dsh-llm'
import { AcpModelControl } from '../src/model-control.ts'

/** Minimal LLM catalog/runtime double for pure standard-option tests.
 * @remarks 中文说明：功能说明：处理 llmRuntime 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：overrides（Partial<LlmRuntime>）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：LlmRuntime；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * llmRuntime(overrides)，并按返回类型处理结果。 */
function llmRuntime(overrides: Partial<LlmRuntime> = {}): LlmRuntime {
  return {
    listProviders: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => [{ id: 'mock', name: 'Mock' }],
    listModels: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => Promise.resolve([{ provider: 'mock', id: 'mock', name: 'Mock' }]),
    resolveCallConfig: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：selection（{ provider?: string;
 * model?: string; reasoningEffort?: stri…）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用
 * 匿名回调(selection)，并按返回类型处理结果。
 */ (selection: { provider?: string; model?: string; reasoningEffort?: string }) => Promise.resolve({
      provider: selection.provider ?? 'mock',
      model: selection.model ?? 'mock',
      ...selection.reasoningEffort === undefined
        ? { reasoningEffort: ReasoningEffortId('high') }
        : { reasoningEffort: ReasoningEffortId(selection.reasoningEffort) },
    }),
    resolveModelInfo: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：provider（string）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。；参数：model（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由
 * TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用
 * 匿名回调(provider, model)，并按返回类型处理结果。
 */ (provider: string, model: string) => Promise.resolve({
      provider,
      id: model,
      name: model,
      reasoning: {
        efforts: [
          { id: ReasoningEffortId('low'), name: 'Low', description: 'Less thought.' },
          { id: ReasoningEffortId('high'), name: 'High' },
        ],
        defaultEffort: ReasoningEffortId('high'),
      },
    }),
    ...overrides,
  } as unknown as LlmRuntime
}

describe('ACP model configuration control', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {
    it('represents an absent route and validates value types before mutation', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：control 用于处理 control 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const control = new AcpModelControl(llmRuntime(), undefined)

        expect(control.snapshot()).toBeUndefined()
        await expect(control.options()).resolves.toEqual([])
        await expect(control.set('model', false)).rejects.toThrow(/requires a select value/)
        await expect(control.set('model', 'missing')).rejects.toThrow(/no model selection/)

        control.selection.current = { provider: 'mock', model: 'mock' }
        expect(control.selection.current).toEqual({ provider: 'mock', model: 'mock' })
      })

    it('synthesizes an unlisted current route and exposes reasoning descriptions', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：control 用于处理 control 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const control = new AcpModelControl(llmRuntime({ listProviders: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => [] }), {
          provider: 'private',
          model: 'unlisted',
        })

        /**
     * 常量说明：options 用于处理 options 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const options = await control.options()

        /**
     * 常量说明：model 用于处理 model 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const model = options.find(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：option（由 TypeScript
 * 根据调用位置推断的类型）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(option)，并按返回类型处理结果。
 */ option => option.id === 'model')
        /**
     * 常量说明：reasoning 用于处理 reasoning 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const reasoning = options.find(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：option（由 TypeScript
 * 根据调用位置推断的类型）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(option)，并按返回类型处理结果。
 */ option => option.id === 'reasoning_effort')
        expect(model).toMatchObject({
          type: 'select',
          currentValue: '["private","unlisted"]',
          options: [{ group: 'private', name: 'private', options: [{ name: 'unlisted' }] }],
        })
        expect(reasoning).toMatchObject({
          type: 'select',
          currentValue: 'high',
          options: [{ name: 'Low', description: 'Less thought.' }, { name: 'High' }],
        })

        control.pinTurn(3, { provider: 'turn', model: 'pinned' })
        expect(control.selection.current).toEqual({ provider: 'turn', model: 'pinned' })
        control.releaseTurn(2)
        expect(control.selection.current).toEqual({ provider: 'turn', model: 'pinned' })
        control.releaseTurn(3)
        expect(control.selection.current).toEqual({ provider: 'private', model: 'unlisted' })
      })

    it('keeps the selected route when its provider catalog is temporarily unavailable', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：listModels 用于列出 Models 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const listModels = vi.fn(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => Promise.reject(new Error('catalog unavailable')))
        /**
     * 常量说明：control 用于处理 control 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const control = new AcpModelControl(llmRuntime({ listModels }), { provider: 'mock', model: 'mock' })

        /**
     * 常量说明：options 用于处理 options 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const options = await control.options()

        expect(listModels).toHaveBeenCalledWith('mock')
        expect(options[0]).toMatchObject({
          type: 'select',
          options: [{ group: 'mock', options: [{ name: 'mock' }] }],
        })
      })

    it('rejects an unadvertised reasoning effort and accepts a later valid change', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：control 用于处理 control 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const control = new AcpModelControl(llmRuntime(), { provider: 'mock', model: 'mock' })

        await expect(control.set('reasoning_effort', 'extreme')).rejects.toThrow(/unknown reasoning effort/)
        /**
     * 常量说明：options 用于处理 options 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const options = await control.set('reasoning_effort', 'low')

        expect(options.find(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：option（由 TypeScript
 * 根据调用位置推断的类型）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(option)，并按返回类型处理结果。
 */ option => option.id === 'reasoning_effort')).toMatchObject({ currentValue: 'low' })
      })

    it('exposes and restores a provider-owned reasoning default', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：runtime 用于处理 runtime 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const runtime = llmRuntime({
          resolveCallConfig: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：selection（{ provider?: string;
 * model?: string; reasoningEffort?: stri…）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用
 * 匿名回调(selection)，并按返回类型处理结果。
 */ (selection: { provider?: string; model?: string; reasoningEffort?: string }) => Promise.resolve({
            provider: selection.provider ?? 'mock',
            model: selection.model ?? 'mock',
            ...selection.reasoningEffort === undefined
              ? {}
              : { reasoningEffort: ReasoningEffortId(selection.reasoningEffort) },
          }),
          resolveModelInfo: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：provider（string）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。；参数：model（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由
 * TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用
 * 匿名回调(provider, model)，并按返回类型处理结果。
 */ (provider: string, model: string) => Promise.resolve({
            provider,
            id: model,
            name: model,
            reasoning: {
              efforts: [
                { id: ReasoningEffortId('low'), name: 'Low' },
                { id: ReasoningEffortId('high'), name: 'High' },
              ],
            },
          }),
        })
        /**
     * 常量说明：control 用于处理 control 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const control = new AcpModelControl(runtime, { provider: 'mock', model: 'mock' })

        /**
     * 常量说明：initial 用于处理 initial 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const initial = await control.options()
        expect(initial.find(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：option（由 TypeScript
 * 根据调用位置推断的类型）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(option)，并按返回类型处理结果。
 */ option => option.id === 'reasoning_effort')).toMatchObject({
          currentValue: '',
          options: [{ value: '', name: 'Provider default' }, { value: 'low' }, { value: 'high' }],
        })
        await control.set('reasoning_effort', 'low')
        /**
     * 常量说明：restored 用于处理 restored 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const restored = await control.set('reasoning_effort', '')

        expect(restored.find(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：option（由 TypeScript
 * 根据调用位置推断的类型）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(option)，并按返回类型处理结果。
 */ option => option.id === 'reasoning_effort')).toMatchObject({ currentValue: '' })
        expect(control.selection.current).toEqual({ provider: 'mock', model: 'mock' })
      })
  })
