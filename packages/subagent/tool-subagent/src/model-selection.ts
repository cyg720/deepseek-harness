/** Child LLM route selection for the subagent tool.
 * @remarks 文件说明：文件职责：实现 subagent/tool-subagent 中 model selection 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * subagent/tool-subagent 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。 */

import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { LlmRuntime } from '@deepseek-ai/dsh-llm'
import type { AgentOptions } from '@deepseek-ai/dsh-agent'
import z from '@deepseek-ai/schemastery'

/** One exact child LLM route authorized by a user setting. */
export interface AllowedModelRoute {
  /** Registered LLM provider id. */
  readonly provider: string
  /** Provider-owned exact model id. */
  readonly model: string
}

/** Schema shared by the Host setting and its deployment base.
 * @remarks 中文说明：常量说明：AllowedModelRouteSchema 用于处理 AllowedModelRouteSchema
 * 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
export const AllowedModelRouteSchema: z<AllowedModelRoute> = z.object({
  provider: z.string().min(1).required(),
  model: z.string().min(1).required(),
})

/** Route-selection authority captured by one delegation definition. */
export interface ModelSelectionPolicy {
  /** Exact provider/model routes authorized for explicit selection. */
  readonly routes: readonly AllowedModelRoute[]
}

/**
 * Stable identity for one provider/model pair.
 * @param route - Exact provider/model route.
 * @returns Opaque key for equality checks.
 * @remarks 中文说明：功能说明：处理 modelRouteKey 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：route（AllowedModelRoute）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：string；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 modelRouteKey(route)，
 * 并按返回类型处理结果。
 */
export function modelRouteKey(route: AllowedModelRoute): string {
  return `${route.provider}\0${route.model}`
}

/**
 * Reject malformed or duplicate route policy entries at a durable or configuration boundary.
 * @param routes - Candidate exact routes to validate.
 * @returns an assertion that the candidate is a validated exact-route array.
 * @remarks 中文说明：功能说明：断言 Allowed Model Routes 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：routes（unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：asserts routes is
 * readonly AllowedModelRoute[]；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 assertAllowedModelRoutes(routes)，并按返回类型处理结果。
 */
export function assertAllowedModelRoutes(routes: unknown): asserts routes is readonly AllowedModelRoute[] {
  if (!Array.isArray(routes)) {
    throw new Error('subagent model selection requires an array of routes')
  }
  /**
   * 常量说明：seen 用于处理 seen 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const seen = new Set<string>()
  /**
   * 常量说明：candidates 用于处理 candidates 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const candidates: readonly unknown[] = routes
  /**
   * 变量说明：candidate 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (const candidate of candidates) {
    if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)
      || !('provider' in candidate) || typeof candidate.provider !== 'string'
      || !('model' in candidate) || typeof candidate.model !== 'string'
      || candidate.provider.length === 0 || candidate.model.length === 0) {
      throw new Error('subagent model selection requires non-empty provider and model ids')
    }
    /**
     * 常量说明：route 用于处理 route 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const route = { provider: candidate.provider, model: candidate.model }
    /**
     * 常量说明：key 用于处理 key 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const key = modelRouteKey(route)
    if (seen.has(key)) {
      throw new Error(`subagent model selection repeats route "${route.provider}/${route.model}"`)
    }
    seen.add(key)
  }
}

/** Model-facing child LLM route fields. */
export interface DelegationModelRequest {
  readonly provider?: string
  readonly model?: string
  readonly reasoning_effort?: string
}

/**
 * Whether a call explicitly selects any child LLM value.
 * @param request - Model-facing route fields from the tool call.
 * @returns Whether at least one route or effort field is present.
 * @remarks 中文说明：功能说明：判断是否包含 Delegation Model Request 相关流程；使用场景由所在模块及调用位置决定。
 * ；参数说明：request（DelegationModelRequest）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。；
 * 返回值：boolean；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * hasDelegationModelRequest(request)，并按返回类型处理结果。
 */
export function hasDelegationModelRequest(request: DelegationModelRequest): boolean {
  return request.provider !== undefined
    || request.model !== undefined
    || request.reasoning_effort !== undefined
}

/** Reject an empty model-facing route value at the tool JSON boundary.
 * @remarks 中文说明：功能说明：断言 Non Empty 相关流程；使用场景由所在模块及调用位置决定。；参数说明：value（string
 * | undefined）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数说明：field（keyof
 * DelegationModelRequest）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 assertNonEmpty(value,
 * field)，并按返回类型处理结果。 */
function assertNonEmpty(value: string | undefined, field: keyof DelegationModelRequest): void {
  if (value !== undefined && value.length === 0) {
    throw new Error(`child LLM \`${field}\` must be non-empty`)
  }
}

/**
 * Merge model-supplied selection fields over configured child defaults.
 * Provider and model form one route and must be supplied together. Changing
 * that route without an effort clears the configured route-owned effort.
 * @param parentOptions - Current parent values that supply missing child values.
 * @param configured - Tool-instance child defaults.
 * @param request - Model-facing route override.
 * @param enabled - Whether this tool instance permits model-facing selection.
 * @returns Child Agent options, preserving omission when no layer contributes one.
 * @remarks 中文说明：功能说明：处理 requestedAgentOptions 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：parentOptions（AgentOptions）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。；
 * 参数说明：configured（AgentOptions | undefined）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。
 * ；参数说明：request（DelegationModelRequest）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。；
 * 参数说明：enabled（boolean）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：AgentOptions |
 * undefined；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * requestedAgentOptions(parentOptions, configured, request, enabled)，
 * 并按返回类型处理结果。
 */
export function requestedAgentOptions(
  parentOptions: AgentOptions,
  configured: AgentOptions | undefined,
  request: DelegationModelRequest,
  enabled: boolean,
): AgentOptions | undefined {
  if (!hasDelegationModelRequest(request)) return configured
  if (!enabled) {
    throw new Error('child model selection is disabled for this tool instance')
  }
  assertNonEmpty(request.provider, 'provider')
  assertNonEmpty(request.model, 'model')
  assertNonEmpty(request.reasoning_effort, 'reasoning_effort')
  if ((request.provider === undefined) !== (request.model === undefined)) {
    throw new Error('child LLM `provider` and `model` must be supplied together')
  }

  /**
   * 常量说明：baselineProvider 用于处理 baselineProvider 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const baselineProvider = configured?.provider ?? parentOptions.provider
  /**
   * 常量说明：baselineModel 用于处理 baselineModel 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const baselineModel = configured?.model ?? parentOptions.model
  /**
   * 常量说明：routeChanged 用于处理 routeChanged 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const routeChanged = request.provider !== undefined
    && (request.provider !== baselineProvider || request.model !== baselineModel)
  /**
   * 常量说明：_configuredReasoningEffort、configuredWithoutReasoning 用于处理
   * _configuredReasoningEffort、configuredWithoutReasoning 相关数据，作用于当前作用域；
   * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const { reasoningEffort: _configuredReasoningEffort, ...configuredWithoutReasoning } = configured ?? {}
  return {
    ...routeChanged && request.reasoning_effort === undefined ? configuredWithoutReasoning : configured,
    ...request.provider === undefined ? {} : { provider: request.provider, model: request.model },
    ...request.reasoning_effort === undefined
      ? {}
      : { reasoningEffort: ReasoningEffortId(request.reasoning_effort) },
  }
}

/**
 * Enforce a settings-owned route list at the operation that creates the child.
 * Pure inheritance remains outside this policy because no model-facing choice
 * occurred; any explicit route or effort field must resolve to an allowed route.
 * @param policy - Selection authority captured for this Session.
 * @param parentOptions - Current parent values that supply missing child values.
 * @param requested - Effective child options after request/config merging.
 * @param request - Model-facing selection fields from the tool call.
 * @remarks 中文说明：功能说明：断言 Allowed Model Selection 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：policy（ModelSelectionPolicy | undefined）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。；参数说明：parentOptions（AgentOptions）：提供本次操作使用的配置选项；
 * 必须满足声明的类型及调用时序要求。；参数说明：requested（AgentOptions | undefined）：提供调用方提交的请求信息；
 * 必须满足声明的类型及调用时序要求。；参数说明：request（DelegationModelRequest）：提供调用方提交的请求信息；
 * 必须满足声明的类型及调用时序要求。；返回值：void；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 assertAllowedModelSelection(policy, parentOptions,
 * requested, request)，并按返回类型处理结果。
 */
export function assertAllowedModelSelection(
  policy: ModelSelectionPolicy | undefined,
  parentOptions: AgentOptions,
  requested: AgentOptions | undefined,
  request: DelegationModelRequest,
): void {
  if (policy === undefined || !hasDelegationModelRequest(request)) return
  /**
   * 常量说明：provider 用于处理 provider 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const provider = requested?.provider ?? parentOptions.provider
  /**
   * 常量说明：model 用于处理 model 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const model = requested?.model ?? parentOptions.model
  if (provider === undefined || model === undefined) {
    throw new Error('cannot select child LLM values without an effective provider and model')
  }
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：route（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(route)，并按返回类型处理结果。
   */
  if (policy.routes.some(route => route.provider === provider && route.model === model)) return
  throw new Error(`child LLM route "${provider}/${model}" is not allowed for this Session`)
}

/**
 * Whether configured Agent options require route validation before delegation.
 * @param options - Tool-instance child defaults.
 * @returns Whether configured provider, model, or effort values must be resolved.
 * @remarks 中文说明：功能说明：判断是否包含 Configured Llm Selection 相关流程；使用场景由所在模块及调用位置决定。
 * ；参数说明：options（AgentOptions | undefined）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。；
 * 返回值：boolean；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * hasConfiguredLlmSelection(options)，并按返回类型处理结果。
 */
export function hasConfiguredLlmSelection(options: AgentOptions | undefined): boolean {
  return options?.provider !== undefined
    || options?.model !== undefined
    || options?.reasoningEffort !== undefined
}

/**
 * Resolve an effective child route through its live adapter before the child is
 * created. The LLM runtime owns provider lookup, exact-model metadata, effort
 * validation, and adapter defaults.
 * @param llm - Live LLM runtime.
 * @param parentOptions - Current parent values whose compatible fields the child inherits.
 * @param requested - Per-child options after request/config merging.
 * @param signal - Tool-call cancellation signal.
 * @param inheritParentReasoningEffort - Whether an omitted effort may inherit from the parent route.
 * @remarks 中文说明：功能说明：处理 preflightChildLlmRoute 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：llm（LlmRuntime）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：parentOptions（AgentOptions）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。；
 * 参数说明：requested（AgentOptions | undefined）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。；
 * 参数说明：signal（AbortSignal）：传递取消或终止信号；必须满足声明的类型及调用时序要求。；
 * 参数说明：inheritParentReasoningEffort（由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。；返回值：Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 preflightChildLlmRoute(llm, parentOptions,
 * requested, signal, inheritParentReason…)，并按返回类型处理结果。
 */
export async function preflightChildLlmRoute(
  llm: LlmRuntime,
  parentOptions: AgentOptions,
  requested: AgentOptions | undefined,
  signal: AbortSignal,
  inheritParentReasoningEffort = true,
): Promise<void> {
  /**
   * 常量说明：provider 用于处理 provider 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const provider = requested?.provider ?? parentOptions.provider
  /**
   * 常量说明：model 用于处理 model 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const model = requested?.model ?? parentOptions.model
  if (provider === undefined || model === undefined) {
    throw new Error('cannot select child LLM values without an effective provider and model')
  }
  /**
   * 常量说明：routeChanged 用于处理 routeChanged 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const routeChanged = provider !== parentOptions.provider || model !== parentOptions.model
  /**
   * 常量说明：reasoningEffort 用于处理 reasoningEffort 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const reasoningEffort = requested?.reasoningEffort
    ?? (inheritParentReasoningEffort && !routeChanged ? parentOptions.reasoningEffort : undefined)
  await llm.resolveCallConfig({
    provider,
    model,
    ...reasoningEffort === undefined ? {} : { reasoningEffort },
  }, signal)
}
