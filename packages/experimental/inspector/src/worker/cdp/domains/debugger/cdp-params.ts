/** Validation for CDP Debugger requests handled by the shared domain.
 * @remarks 文件说明：文件职责：实现 experimental/inspector 中 cdp params 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/inspector 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。 */

import type { RuntimeCallFrameEvaluationRequest } from '../../../../shared/cdp/index.ts'
import { exactKeys, optionalBoolean, optionalString } from '../../../../shared/validation.ts'

/**
 * Parse Debugger.evaluateOnCallFrame without silently accepting unsupported options.
 * @param params - Untrusted CDP parameters.
 * @returns The common call-frame evaluation request.
 * @remarks 中文说明：功能说明：解析 Call Frame Evaluation 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：params（Readonly<Record<string, unknown>>）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。；返回值：RuntimeCallFrameEvaluationRequest；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 parseCallFrameEvaluation(params)，
 * 并按返回类型处理结果。
 */
export function parseCallFrameEvaluation(
  params: Readonly<Record<string, unknown>>,
): RuntimeCallFrameEvaluationRequest {
  exactKeys(params, [
    'callFrameId', 'expression', 'objectGroup', 'includeCommandLineAPI', 'silent', 'returnByValue',
    'generatePreview', 'throwOnSideEffect', 'timeout',
  ], 'Debugger.evaluateOnCallFrame parameters')
  if (typeof params.callFrameId !== 'string' || typeof params.expression !== 'string') {
    throw new Error('Debugger.evaluateOnCallFrame requires callFrameId and expression')
  }
  if (params.timeout !== undefined
    && (typeof params.timeout !== 'number' || !Number.isFinite(params.timeout) || params.timeout < 0)) {
    throw new Error('Debugger.evaluateOnCallFrame timeout must be a non-negative number')
  }
  return {
    callFrameId: params.callFrameId,
    expression: params.expression,
    ...optionalString(params, 'objectGroup'),
    ...optionalBoolean(params, 'includeCommandLineAPI'),
    ...optionalBoolean(params, 'silent'),
    ...optionalBoolean(params, 'returnByValue'),
    ...optionalBoolean(params, 'generatePreview'),
    ...optionalBoolean(params, 'throwOnSideEffect'),
    ...(params.timeout === undefined ? {} : { timeoutMs: params.timeout }),
  }
}

/**
 * Find a ScriptId carried directly or by a Debugger location parameter.
 * @param params - Parsed CDP parameter record.
 * @returns The targeted script id when the request names one.
 * @remarks 中文说明：功能说明：处理 requestScriptId 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：params（Readonly<Record<string, unknown>>）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。；返回值：string | undefined；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 requestScriptId(params)，并按返回类型处理结果。
 */
export function requestScriptId(params: Readonly<Record<string, unknown>>): string | undefined {
  if (typeof params.scriptId === 'string') return params.scriptId
  /**
   * 变量说明：key 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (const key of ['location', 'start', 'end'] as const) {
    /**
     * 常量说明：value 用于处理 value 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const value = params[key]
    if (typeof value !== 'object' || value === null || Array.isArray(value)) continue
    /**
     * 常量说明：scriptId 用于处理 scriptId 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const scriptId = (value as Readonly<Record<string, unknown>>).scriptId
    if (typeof scriptId === 'string') return scriptId
  }
  return undefined
}
