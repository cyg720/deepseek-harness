/** Validation and normalization of CDP Runtime parameters routed to a Client realm.
 * @remarks 文件说明：文件职责：实现 experimental/inspector 中 cdp params 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/inspector 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。 */

import type { RuntimeBackendObjectHandle } from '../../../../shared/cdp/ids.ts'
import { isJsonValue, isPlainObject, type InspectorJsonValue } from '../../../../shared/json.ts'
import type {
  RuntimeAwaitPromiseRequest,
  RuntimeCallFunctionRequest,
  RuntimeEvaluateRequest,
  RuntimeGetPropertiesRequest,
} from '../../../../shared/cdp/index.ts'
import { exactKeys, optionalBoolean, optionalString } from '../../../../shared/validation.ts'

/** Numeric or globally unique selector for one execution context. */
export interface CdpExecutionContextSelector {
  readonly contextId?: number
  readonly executionContextId?: number
  readonly uniqueContextId?: string
}

/** Validated Runtime.evaluate parameters and their routing selector. */
export interface ParsedEvaluate extends CdpExecutionContextSelector {
  readonly request: RuntimeEvaluateRequest
}

/** Client-independent call argument before object ids are routed. */
export type CdpCallArgument =
  | { readonly kind: 'value'; readonly value: InspectorJsonValue }
  | { readonly kind: 'unserializable'; readonly value: string }
  | { readonly kind: 'object'; readonly objectId: string }
  | { readonly kind: 'undefined' }

/** Validated Runtime.callFunctionOn parameters before object-id routing. */
export interface ParsedCallFunction extends CdpExecutionContextSelector {
  readonly objectId?: string
  readonly arguments: readonly CdpCallArgument[]
  readonly request: Omit<RuntimeCallFunctionRequest<RuntimeBackendObjectHandle>, 'receiver' | 'arguments'>
}

/**
 * Parse realm-routed `Runtime.evaluate` parameters.
 * @param params - Untrusted CDP parameters.
 * @returns A context selector and normalized Runtime request.
 * @remarks 中文说明：功能说明：解析 Evaluate 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：params（Readonly<Record<string, unknown>>）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。；返回值：ParsedEvaluate；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 parseEvaluate(params)，并按返回类型处理结果。
 */
export function parseEvaluate(params: Readonly<Record<string, unknown>>): ParsedEvaluate {
  exactKeys(params, [
    'expression', 'objectGroup', 'includeCommandLineAPI', 'silent', 'contextId', 'returnByValue',
    'generatePreview', 'userGesture', 'awaitPromise', 'throwOnSideEffect', 'timeout', 'disableBreaks',
    'replMode', 'allowUnsafeEvalBlockedByCSP', 'uniqueContextId', 'serializationOptions',
  ], 'Runtime.evaluate params')
  if (typeof params.expression !== 'string') throw new Error('Runtime.evaluate expression must be a string')
  /**
   * 常量说明：selector 用于处理 selector 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const selector = parseContextSelector(params, 'contextId')
  /**
   * 常量说明：timeout 用于处理 timeout 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const timeout = params.timeout
  if (timeout !== undefined && (typeof timeout !== 'number' || !Number.isFinite(timeout) || timeout < 0)) {
    throw new Error('Runtime.evaluate timeout must be a non-negative finite number')
  }
  return {
    ...selector,
    request: {
      expression: params.expression,
      ...optionalString(params, 'objectGroup'),
      ...optionalBoolean(params, 'includeCommandLineAPI'),
      ...optionalBoolean(params, 'silent'),
      ...optionalBoolean(params, 'returnByValue'),
      ...optionalBoolean(params, 'generatePreview'),
      ...optionalBoolean(params, 'userGesture'),
      ...optionalBoolean(params, 'awaitPromise'),
      ...optionalBoolean(params, 'disableBreaks'),
      ...optionalBoolean(params, 'replMode'),
      ...optionalBoolean(params, 'allowUnsafeEvalBlockedByCSP'),
      ...optionalBoolean(params, 'throwOnSideEffect'),
      ...optionalJsonObject(params, 'serializationOptions'),
      ...(timeout === undefined ? {} : { timeoutMs: timeout }),
    },
  }
}

/**
 * Parse realm-routed `Runtime.getProperties` parameters.
 * @param params - Untrusted CDP parameters.
 * @returns The external object id and handle-free Runtime request.
 * @remarks 中文说明：功能说明：解析 Get Properties 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：params（Readonly<Record<string, unknown>>）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。；返回值：{ readonly objectId: string readonly request:
 * Omit<RuntimeGetProperti…；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * parseGetProperties(params)，并按返回类型处理结果。
 */
export function parseGetProperties(
  params: Readonly<Record<string, unknown>>,
): {
  readonly objectId: string
  readonly request: Omit<RuntimeGetPropertiesRequest<RuntimeBackendObjectHandle>, 'handle'>
} {
  exactKeys(params, [
    'objectId', 'ownProperties', 'accessorPropertiesOnly', 'generatePreview', 'nonIndexedPropertiesOnly',
  ], 'Runtime.getProperties params')
  if (typeof params.objectId !== 'string') throw new Error('Runtime.getProperties objectId must be a string')
  return {
    objectId: params.objectId,
    request: {
      ...optionalBoolean(params, 'ownProperties'),
      ...optionalBoolean(params, 'accessorPropertiesOnly'),
      ...optionalBoolean(params, 'generatePreview'),
      ...optionalBoolean(params, 'nonIndexedPropertiesOnly'),
    },
  }
}

/**
 * Parse Client-routed `Runtime.callFunctionOn` parameters.
 * @param params - Untrusted CDP parameters.
 * @returns Routing fields, arguments, and a handle-free Runtime request.
 * @remarks 中文说明：功能说明：解析 Call Function 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：params（Readonly<Record<string, unknown>>）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。；返回值：ParsedCallFunction；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 parseCallFunction(params)，并按返回类型处理结果。
 */
export function parseCallFunction(params: Readonly<Record<string, unknown>>): ParsedCallFunction {
  exactKeys(params, [
    'functionDeclaration', 'objectId', 'arguments', 'silent', 'returnByValue', 'generatePreview', 'userGesture',
    'awaitPromise', 'executionContextId', 'objectGroup', 'throwOnSideEffect', 'uniqueContextId', 'serializationOptions',
  ], 'Runtime.callFunctionOn params')
  if (typeof params.functionDeclaration !== 'string') {
    throw new Error('Runtime.callFunctionOn functionDeclaration must be a string')
  }
  /**
   * 常量说明：selector 用于处理 selector 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const selector = parseContextSelector(params, 'executionContextId')
  /**
   * 常量说明：objectId 用于处理 objectId 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const objectId = optionalObjectId(params.objectId, 'Runtime.callFunctionOn objectId')
  if (objectId === undefined
    && selector.executionContextId === undefined
    && selector.uniqueContextId === undefined) {
    throw new Error('Runtime.callFunctionOn requires objectId or an execution context')
  }
  if (objectId !== undefined && (selector.executionContextId !== undefined || selector.uniqueContextId !== undefined)) {
    throw new Error('Runtime.callFunctionOn objectId and execution context are mutually exclusive')
  }
  /**
   * 变量说明：args 用于处理 args 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let args: readonly CdpCallArgument[] = []
  if (params.arguments !== undefined) {
    if (!Array.isArray(params.arguments)) throw new Error('Runtime.callFunctionOn arguments must be an array')
    args = params.arguments.map(parseCallArgument)
  }
  return {
    ...selector,
    ...(objectId === undefined ? {} : { objectId }),
    arguments: args,
    request: {
      functionDeclaration: params.functionDeclaration,
      ...optionalString(params, 'objectGroup'),
      ...optionalBoolean(params, 'silent'),
      ...optionalBoolean(params, 'returnByValue'),
      ...optionalBoolean(params, 'generatePreview'),
      ...optionalBoolean(params, 'userGesture'),
      ...optionalBoolean(params, 'awaitPromise'),
      ...optionalBoolean(params, 'throwOnSideEffect'),
      ...optionalJsonObject(params, 'serializationOptions'),
    },
  }
}

/**
 * Parse Client-routed `Runtime.awaitPromise` parameters.
 * @param params - Untrusted CDP parameters.
 * @returns The external promise id and handle-free Runtime request.
 * @remarks 中文说明：功能说明：解析 Await Promise 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：params（Readonly<Record<string, unknown>>）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。；返回值：{ readonly promiseObjectId: string readonly
 * request: Omit<RuntimeAwai…；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 parseAwaitPromise(params)，并按返回类型处理结果。
 */
export function parseAwaitPromise(params: Readonly<Record<string, unknown>>): {
  readonly promiseObjectId: string
  readonly request: Omit<RuntimeAwaitPromiseRequest<RuntimeBackendObjectHandle>, 'promise'>
} {
  exactKeys(params, ['promiseObjectId', 'returnByValue', 'generatePreview'], 'Runtime.awaitPromise params')
  if (typeof params.promiseObjectId !== 'string') throw new Error('Runtime.awaitPromise promiseObjectId must be a string')
  return {
    promiseObjectId: params.promiseObjectId,
    request: {
      ...optionalBoolean(params, 'returnByValue'),
      ...optionalBoolean(params, 'generatePreview'),
    },
  }
}

/**
 * Parse one required object id.
 * @param params - Untrusted CDP parameters.
 * @returns The object id.
 * @remarks 中文说明：功能说明：解析 Release Object 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：params（Readonly<Record<string, unknown>>）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。；返回值：string；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 parseReleaseObject(params)，并按返回类型处理结果。
 */
export function parseReleaseObject(params: Readonly<Record<string, unknown>>): string {
  exactKeys(params, ['objectId'], 'Runtime.releaseObject params')
  if (typeof params.objectId !== 'string') throw new Error('Runtime.releaseObject objectId must be a string')
  return params.objectId
}

/**
 * Parse one required object-group name.
 * @param params - Untrusted CDP parameters.
 * @returns The object-group name.
 * @remarks 中文说明：功能说明：解析 Release Object Group 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：params（Readonly<Record<string, unknown>>）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。；返回值：string；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 parseReleaseObjectGroup(params)，并按返回类型处理结果。
 */
export function parseReleaseObjectGroup(params: Readonly<Record<string, unknown>>): string {
  exactKeys(params, ['objectGroup'], 'Runtime.releaseObjectGroup params')
  if (typeof params.objectGroup !== 'string') throw new Error('Runtime.releaseObjectGroup objectGroup must be a string')
  return params.objectGroup
}

/**
 * Parse `Runtime.globalLexicalScopeNames` context selection.
 * @param params - Untrusted CDP parameters.
 * @returns The validated context selector.
 * @remarks 中文说明：功能说明：解析 Global Lexical Scope Names 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：params（Readonly<Record<string, unknown>>）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。；返回值：CdpExecutionContextSelector；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 parseGlobalLexicalScopeNames(params)，
 * 并按返回类型处理结果。
 */
export function parseGlobalLexicalScopeNames(params: Readonly<Record<string, unknown>>): CdpExecutionContextSelector {
  exactKeys(params, ['executionContextId'], 'Runtime.globalLexicalScopeNames params')
  return parseContextSelector(params, 'executionContextId')
}

/**
 * 功能说明：解析 Call Argument 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns CdpCallArgument；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 parseCallArgument(value)，并按返回类型处理结果。
 */
function parseCallArgument(value: unknown): CdpCallArgument {
  if (!isPlainObject(value)) throw new Error('Runtime.callFunctionOn argument must be an object')
  exactKeys(value, ['value', 'unserializableValue', 'objectId'], 'Runtime.callFunctionOn argument')
  /**
   * 常量说明：present 用于处理 present 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：key（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(key)，并按返回类型处理结果。
   */
  const present = ['value', 'unserializableValue', 'objectId'].filter(key => Object.hasOwn(value, key))
  if (present.length > 1) throw new Error('Runtime.callFunctionOn argument has multiple value representations')
  if (present.length === 0) return { kind: 'undefined' }
  if (present[0] === 'value') {
    if (!isJsonValue(value.value)) throw new Error('Runtime.callFunctionOn argument value must be JSON')
    return { kind: 'value', value: value.value }
  }
  if (present[0] === 'unserializableValue') {
    if (typeof value.unserializableValue !== 'string') {
      throw new Error('Runtime.callFunctionOn unserializableValue must be a string')
    }
    return { kind: 'unserializable', value: value.unserializableValue }
  }
  if (typeof value.objectId !== 'string') throw new Error('Runtime.callFunctionOn argument objectId must be a string')
  return { kind: 'object', objectId: value.objectId }
}

/**
 * 功能说明：解析 Context Selector 相关流程；使用场景由所在模块及调用位置决定。
 * @param params （Readonly<Record<string, unknown>>）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。
 * @param numericKey （'contextId' | 'executionContextId'）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。
 * @returns CdpExecutionContextSelector；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 parseContextSelector(params, numericKey)，并按返回类型处理结果。
 */
function parseContextSelector(
  params: Readonly<Record<string, unknown>>,
  numericKey: 'contextId' | 'executionContextId',
): CdpExecutionContextSelector {
  /**
   * 常量说明：numeric 用于处理 numeric 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const numeric = params[numericKey]
  /**
   * 常量说明：unique 用于处理 unique 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const unique = params.uniqueContextId
  if (numeric !== undefined && (!Number.isSafeInteger(numeric))) {
    throw new Error(`Runtime ${numericKey} must be an integer`)
  }
  if (unique !== undefined && typeof unique !== 'string') throw new Error('Runtime uniqueContextId must be a string')
  if (numeric !== undefined && unique !== undefined) throw new Error('Runtime context selectors are mutually exclusive')
  return {
    ...(numeric === undefined
      ? {}
      : numericKey === 'contextId'
        ? { contextId: numeric as number }
        : { executionContextId: numeric as number }),
    ...(unique === undefined ? {} : { uniqueContextId: unique }),
  }
}

/**
 * 功能说明：处理 optionalObjectId 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param label （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns string | undefined；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 optionalObjectId(value, label)，并按返回类型处理结果。
 */
function optionalObjectId(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string') throw new Error(`${label} must be a string`)
  return value
}

/**
 * 功能说明：处理 optionalJsonObject 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （Readonly<Record<string, unknown>>）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。
 * @param key （Key）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns Partial<Record<Key, Readonly<Record<string,
 * InspectorJsonValue>>>>；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 optionalJsonObject(value, key)，并按返回类型处理结果。
 */
function optionalJsonObject<Key extends string>(
  value: Readonly<Record<string, unknown>>,
  key: Key,
): Partial<Record<Key, Readonly<Record<string, InspectorJsonValue>>>> {
  /**
   * 常量说明：item 用于处理 item 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const item = value[key]
  if (item === undefined) return {}
  if (!isPlainObject(item) || !isJsonValue(item)) throw new Error(`Runtime ${key} must be a JSON object`)
  return { [key]: item } as Partial<Record<Key, Readonly<Record<string, InspectorJsonValue>>>>
}
