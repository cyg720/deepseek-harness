/** Provider-specific JSON and contribution types for DeepSeek request extensions. */

/** Lossless JSON value accepted by the DeepSeek request body.
 * @remarks 文件说明：文件职责：实现 llm/deepseek-llm-api-extensions 中 types 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * llm/deepseek-llm-api-extensions 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 →
 * 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。 */
export type DeepSeekLlmApiJson =
  | null
  | boolean
  | number
  | string
  | DeepSeekLlmApiJson[]
  | { [key: string]: DeepSeekLlmApiJson }

/**
 * Merge-extensible table of top-level DeepSeek request extension fields.
 * Contributor packages declaration-merge the field they own.
 */
export interface DeepSeekLlmApiExtensionMap {}

/** Exact serialized request facts visible to extension providers. */
export interface DeepSeekLlmApiExtensionRequest {
  /** Base DeepSeek request body before extension fields are merged. */
  readonly body: Readonly<Record<string, DeepSeekLlmApiJson>>
  /** Session identity carried by the model request, when present. */
  readonly sessionId?: string
  /** Auxiliary request classification, when present. */
  readonly purpose?: 'compaction' | 'session-title'
  /** Cancellation for request preparation; providers must stop promptly after abort. */
  readonly signal: AbortSignal
}

/** One prepared field value and its optional post-2xx commit. */
export interface PreparedDeepSeekLlmApiExtension<T extends DeepSeekLlmApiJson> {
  /** Detached value merged under the provider's registered field. */
  readonly value: T
  /** Commit state that depends on confirmed provider acceptance.
   * @remarks 中文说明：功能说明：处理 accept 相关流程；使用场景由所在模块及调用位置决定。；返回值：void |
   * Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 accept()，
   * 并按返回类型处理结果。 */
  accept?(): void | Promise<void>
}

/** Provider registered under one key of {@link DeepSeekLlmApiExtensionMap}. */
export interface DeepSeekLlmApiExtensionProvider<T extends DeepSeekLlmApiJson> {
  /**
   * Prepare one field for an exact serialized request.
   * @param request - immutable base request facts.
   * @returns the prepared field, or `undefined` when this request has no value for it.
   * @remarks 中文说明：功能说明：处理 prepare 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：request（DeepSeekLlmApiExtensionRequest）：提供调用方提交的请求信息；
   * 必须满足声明的类型及调用时序要求。；返回值：PreparedDeepSeekLlmApiExtension<T> | undefined |
   * Promise<PreparedDeep…；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * prepare(request)，并按返回类型处理结果。
   */
  prepare(
    request: DeepSeekLlmApiExtensionRequest,
  ): PreparedDeepSeekLlmApiExtension<T> | undefined | Promise<PreparedDeepSeekLlmApiExtension<T> | undefined>
}

/** All fields prepared for one request plus their joint acceptance transaction. */
export interface PreparedDeepSeekLlmApiExtensions {
  /** Detached top-level fields to merge into the base request. */
  readonly fields: Readonly<Partial<DeepSeekLlmApiExtensionMap>>
  /**
   * Commit every captured provider after HTTP 2xx. Repeated calls join the same settlement.
   * @returns fulfillment after every commit succeeds.
   * @remarks 中文说明：功能说明：处理 accept 相关流程；使用场景由所在模块及调用位置决定。；返回值：Promise<void>；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 accept()，并按返回类型处理结果。
   */
  accept(): Promise<void>
}
