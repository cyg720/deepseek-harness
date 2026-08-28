/**
 * DeepSeek LLM API extension registry: plugins own independent top-level request
 * fields while the official adapter performs one preparation and acceptance transaction.
 * @module @deepseek-ai/dsh-deepseek-llm-api-extensions
 * @remarks 文件说明：文件职责：实现 llm/deepseek-llm-api-extensions 中 index 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * llm/deepseek-llm-api-extensions 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 →
 * 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type {
  DeepSeekLlmApiExtensionMap,
  DeepSeekLlmApiExtensionProvider,
  DeepSeekLlmApiExtensionRequest,
  DeepSeekLlmApiJson,
  PreparedDeepSeekLlmApiExtensions,
} from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    deepseekLlmApiExtensions: DeepSeekLlmApiExtensionRegistry
  }
}

/**
 * 功能说明：处理 accept 相关流程；使用场景由所在模块及调用位置决定。
 * @returns void | Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 accept()，并按返回类型处理结果。
 */
/**
 * 功能说明：处理 accept 相关流程；使用场景由所在模块及调用位置决定。
 * @returns void | Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 accept()，并按返回类型处理结果。
 */
interface ErasedProvider {
  /**
   * 功能说明：处理 prepare 相关流程；使用场景由所在模块及调用位置决定。
   * @param request （DeepSeekLlmApiExtensionRequest）：提供调用方提交的请求信息；
   * 必须满足声明的类型及调用时序要求。
   * @returns | { readonly value: DeepSeekLlmApiJson; accept?(): void |
   * Promise<voi…；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 prepare(request)，并按返回类型处理结果。
   */
  prepare(request: DeepSeekLlmApiExtensionRequest):
    | { readonly value: DeepSeekLlmApiJson; accept?(): void | Promise<void> }
    | undefined
    | Promise<{ readonly value: DeepSeekLlmApiJson; accept?(): void | Promise<void> } | undefined>
}

/** Recursively freeze a fresh structured clone.
 * @remarks 中文说明：功能说明：处理 freezeJson 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：value（T）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：T；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 freezeJson(value)，并按返回类型处理结果。 */
function freezeJson<T extends DeepSeekLlmApiJson>(value: T): T {
  if (value !== null && typeof value === 'object') {
    /**
     * 变量说明：child 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const child of Array.isArray(value) ? value : Object.values(value)) freezeJson(child)
    Object.freeze(value)
  }
  return value
}

/** Settle every acceptance callback before reporting failures.
 * @remarks 中文说明：功能说明：处理 acceptAll 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：callbacks（readonly (() => void | Promise<void>)[]）：接收后续状态或事件并执行调用方逻
 * 辑；必须满足声明的类型及调用时序要求。；返回值：Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 acceptAll(callbacks)，并按返回类型处理结果。 */
async function acceptAll(callbacks: readonly (() => void | Promise<void>)[]): Promise<void> {
  /**
   * 常量说明：outcomes 用于处理 outcomes 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：callback（由 TypeScript
   * 根据调用位置推断的类型）：接收后续状态或事件并执行调用方逻辑；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript
   * 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(callback)，
   * 并按返回类型处理结果。
   */
  const outcomes = await Promise.allSettled(callbacks.map(callback => Promise.resolve().then(callback)))
  /**
   * 常量说明：failures 用于处理 failures 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：outcome（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：outcome is
   * PromiseRejectedResult；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用
   * 匿名回调(outcome)，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：outcome（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(outcome)，并按返回类型处理结果。
   */
  const failures: unknown[] = outcomes
    .filter((outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected')
    .map(outcome => outcome.reason as unknown)
  if (failures.length === 1) throw failures[0]
  if (failures.length > 1) throw new AggregateError(failures, 'DeepSeek LLM API extension acceptance failed')
}

/** Stop awaiting provider work when the containing model request is cancelled.
 * @remarks 中文说明：功能说明：处理 abortable 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：work（Promise<T>）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：signal（AbortSignal）：传递取消或终止信号；必须满足声明的类型及调用时序要求。；返回值：Promise<T>；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 abortable(work, signal)，
 * 并按返回类型处理结果。 */
async function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted()
  /**
   * 常量说明：aborted 用于处理 aborted 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const aborted = Promise.withResolvers<never>()
  /**
   * 常量说明：onAbort 用于响应 Abort 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   * 功能说明：响应 Abort 相关流程；使用场景由所在模块及调用位置决定。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 onAbort()，并按返回类型处理结果。
   */
  const onAbort = (): void => { aborted.reject(signal.reason) }
  signal.addEventListener('abort', onAbort, { once: true })
  try {
    /**
     * 常量说明：result 用于处理 result 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const result = await Promise.race([work, aborted.promise])
    signal.throwIfAborted()
    return result
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
}

/** Registry of independently owned top-level fields for official DeepSeek requests.
 * @remarks 中文说明：类说明：DeepSeekLlmApiExtensionRegistry 用于集中封装 处理
 * DeepSeekLlmApiExtensionRegistry 相关状态与行为。；核心功能：通过成员字段保存状态，
 * 并由公开方法提供受类型约束的操作入口。；使用场景：由 llm/deepseek-llm-api-extensions
 * 在对应插件或业务生命周期内创建和调用。 */
export class DeepSeekLlmApiExtensionRegistry extends Service {
  /**
   * 常量说明：providers 用于处理 providers 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly providers = new Map<string, ErasedProvider>()

  /**
   * 功能说明：处理 DeepSeekLlmApiExtensionRegistry 相关流程；使用场景由所在模块及调用位置决定。
   * @param ctx （Context）：提供当前 Cordis 插件上下文与已声明服务；必须满足声明的类型及调用时序要求。
   * @returns 当前类实例；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 通过 new DeepSeekLlmApiExtensionRegistry(ctx) 创建实例，并在所属生命周期内使用。
   */
  constructor(ctx: Context) {
    super(ctx, 'deepseekLlmApiExtensions')
  }

  /**
   * Register the sole provider of one top-level request field. Registration is effect-scoped.
   * @param field - declaration-merged field owned by the provider.
   * @param provider - request-time field preparation and optional acceptance behavior.
   * @returns disposer that releases the field.
   * @remarks 中文说明：功能说明：注册 register 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：field（K）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：provider（DeepSeekLlmApiExtensionProvider<DeepSeekLlmApiExtensionMap
   * […）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：() => Promise<void>；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 register(field, provider)，并按返回类型处理结果。
   */
  register<K extends keyof DeepSeekLlmApiExtensionMap>(
    field: K,
    provider: DeepSeekLlmApiExtensionProvider<DeepSeekLlmApiExtensionMap[K]>,
  ): () => Promise<void> {
    /**
     * 常量说明：fieldName 用于处理 fieldName 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const fieldName = field as string
    if (fieldName.length === 0 || fieldName.trim() !== fieldName) {
      throw new Error('deepseek-llm-api-extensions: field must be a non-blank trimmed string')
    }
    /**
     * 常量说明：providers 用于处理 providers 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const providers = this.providers
    /**
     * 常量说明：erased 用于处理 erased 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const erased = provider as ErasedProvider
    /**
     * 常量说明：dispose 用于处理 dispose 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    const dispose = this.ctx.effect(() => {
      if (providers.has(fieldName)) {
        throw new Error(`deepseek-llm-api-extensions: field ${JSON.stringify(fieldName)} is already registered`)
      }
      providers.set(fieldName, erased)
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
       */
      return () => {
        providers.delete(fieldName)
      }
    }, `deepseekLlmApiExtensions.register(${JSON.stringify(fieldName)})`)
    return dispose
  }

  /**
   * Prepare every currently registered field from one immutable base request.
   * Preparation failures reject before HTTP dispatch. Field values are cloned and frozen;
   * providers retain no mutable alias to the outgoing request.
   * @param request - exact serialized request facts before extension fields.
   * @returns detached fields and their idempotent joint acceptance transaction.
   * @remarks 中文说明：功能说明：处理 prepare 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：request（DeepSeekLlmApiExtensionRequest）：提供调用方提交的请求信息；
   * 必须满足声明的类型及调用时序要求。；返回值：Promise<PreparedDeepSeekLlmApiExtensions>；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 prepare(request)，
   * 并按返回类型处理结果。
   */
  async prepare(request: DeepSeekLlmApiExtensionRequest): Promise<PreparedDeepSeekLlmApiExtensions> {
    request.signal.throwIfAborted()
    /**
     * 常量说明：entries 用于处理 entries 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const entries = [...this.providers.entries()]
    /**
     * 常量说明：prepared 用于处理 prepared 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：[field, provider]（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调([field, provider])，
     * 并按返回类型处理结果。
     */
    const prepared = await abortable(Promise.all(entries.map(async ([field, provider]) => ({
      field,
      result: await provider.prepare(request),
    }))), request.signal)
    /**
     * 常量说明：fields 用于处理 fields 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const fields: Record<string, DeepSeekLlmApiJson> = Object.create(null) as Record<string, DeepSeekLlmApiJson>
    /**
     * 常量说明：callbacks 用于处理 callbacks 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const callbacks: Array<() => void | Promise<void>> = []
    /**
     * 变量说明：field、result 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const { field, result } of prepared) {
      if (result === undefined) continue
      fields[field] = freezeJson(structuredClone(result.value))
      /**
       * 常量说明：accept 用于处理 accept 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const accept = result.accept
      if (accept !== undefined) callbacks.push(accept.bind(result))
    }
    Object.freeze(fields)
    /**
     * 变量说明：acceptance 用于处理 acceptance 相关数据，作用于当前作用域；其值可能随流程推进而变化，
     * 读写时需遵守声明类型和所在生命周期。
     */
    let acceptance: Promise<void> | undefined
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    return {
      fields,
      accept: () => acceptance ??= acceptAll(callbacks),
    }
  }
}

export default DeepSeekLlmApiExtensionRegistry
