/** Conversion from Client wire values to realm-neutral Runtime values.
 * @remarks 文件说明：文件职责：实现 experimental/inspector 中 values 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/inspector 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。 */

import type {
  ClientRuntimeExceptionDetails,
  ClientRuntimePropertyDescriptor,
  ClientRuntimeRemoteObject,
  ClientRuntimeResult,
} from '../../../shared/bridge/messages/runtime/index.ts'
import {
  type ClientRemoteObjectHandle,
} from '../../../shared/bridge/ids.ts'
import { inspectorId } from '../../../shared/identity.ts'
import type { RuntimeBackendObjectHandle, RuntimeScriptKey } from '../../../shared/cdp/ids.ts'
import type {
  RuntimeCompletion,
  RuntimeConsoleBackendEvent,
  RuntimeExceptionDetails,
  RuntimeInternalPropertyDescriptor,
  RuntimePropertyDescriptor,
  RuntimeRemoteObject,
  RuntimeStackTrace,
} from '../../../shared/cdp/index.ts'

/** Maps a Client-local script key into its realm-wide Runtime identity. */
export type ClientScriptKeyMapper = (scriptKey: RuntimeScriptKey) => RuntimeScriptKey

/**
 * Convert one Client completion and all nested objects.
 * @param result - Successful Client Runtime command result.
 * @param mapScriptKey - Realm-wide script identity mapper.
 * @returns A realm-neutral Runtime completion.
 * @remarks 中文说明：功能说明：处理 clientCompletion 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：result（Extract<ClientRuntimeResult, { op: 'evaluate' |
 * 'call-funct…）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：mapScriptKey（ClientScriptKeyMapper）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：RuntimeCompletion<RuntimeBackendObjectHandle>；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 clientCompletion(result,
 * mapScriptKey)，并按返回类型处理结果。
 */
export function clientCompletion(
  result: Extract<ClientRuntimeResult, { op: 'evaluate' | 'call-function' | 'await-promise' }>,
  mapScriptKey: ClientScriptKeyMapper,
): RuntimeCompletion<RuntimeBackendObjectHandle> {
  return {
    result: clientRemoteObject(result.completion.result),
    ...(result.completion.exceptionDetails === undefined
      ? {}
      : { exceptionDetails: clientException(result.completion.exceptionDetails, mapScriptKey) }),
  }
}

/**
 * Convert one Client property descriptor and all nested objects.
 * @param value - Client wire property descriptor.
 * @returns A realm-neutral property descriptor.
 * @remarks 中文说明：功能说明：处理 clientProperty 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：value（ClientRuntimePropertyDescriptor）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * ；返回值：RuntimePropertyDescriptor<RuntimeBackendObjectHandle>；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 clientProperty(value)，并按返回类型处理结果。
 */
export function clientProperty(
  value: ClientRuntimePropertyDescriptor,
): RuntimePropertyDescriptor<RuntimeBackendObjectHandle> {
  /**
   * 常量说明：propertyValue、get、set、symbol、descriptor 用于处理
   * propertyValue、get、set、symbol、descriptor 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const { value: propertyValue, get, set, symbol, ...descriptor } = value
  return {
    ...descriptor,
    ...(propertyValue === undefined ? {} : { value: clientRemoteObject(propertyValue) }),
    ...(get === undefined ? {} : { get: clientRemoteObject(get) }),
    ...(set === undefined ? {} : { set: clientRemoteObject(set) }),
    ...(symbol === undefined ? {} : { symbol: clientRemoteObject(symbol) }),
  }
}

/**
 * Convert one Client internal property descriptor.
 * @param value - Client wire internal property.
 * @returns A realm-neutral internal property.
 * @remarks 中文说明：功能说明：处理 clientInternalProperty 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：value（RuntimeInternalPropertyDescriptor<ClientRemoteObjectHandle>）：
 * 提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：RuntimeInternalPropertyDescriptor<Runt
 * imeBackendObjectHandle>；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * clientInternalProperty(value)，并按返回类型处理结果。
 */
export function clientInternalProperty(
  value: RuntimeInternalPropertyDescriptor<ClientRemoteObjectHandle>,
): RuntimeInternalPropertyDescriptor<RuntimeBackendObjectHandle> {
  return {
    name: value.name,
    ...(value.value === undefined ? {} : { value: clientRemoteObject(value.value) }),
  }
}

/**
 * Convert Client exception details and their optional object.
 * @param value - Client wire exception details.
 * @param mapScriptKey - Realm-wide script identity mapper.
 * @returns Realm-neutral exception details.
 * @remarks 中文说明：功能说明：处理 clientException 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：value（ClientRuntimeExceptionDetails）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：mapScriptKey（ClientScriptKeyMapper）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：RuntimeExceptionDetails<RuntimeBackendObjectHandle>；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 clientException(value, mapScriptKey)，
 * 并按返回类型处理结果。
 */
export function clientException(
  value: ClientRuntimeExceptionDetails,
  mapScriptKey: ClientScriptKeyMapper,
): RuntimeExceptionDetails<RuntimeBackendObjectHandle> {
  /**
   * 常量说明：exception、details 用于处理 exception、details 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const { exception, ...details } = value
  return {
    ...details,
    ...(value.stackTrace === undefined ? {} : { stackTrace: clientStackTrace(value.stackTrace, mapScriptKey) }),
    ...(exception === undefined ? {} : { exception: clientRemoteObject(exception) }),
  }
}

/**
 * Convert a Client Console event recursively.
 * @param value - Client wire Console event.
 * @param mapScriptKey - Realm-wide script identity mapper.
 * @returns A realm-neutral Console event.
 * @remarks 中文说明：功能说明：处理 clientConsoleEvent 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：value（RuntimeConsoleBackendEvent<ClientRemoteObjectHandle>）：提供本次调用所
 * 需的数据；必须满足声明的类型及调用时序要求。；参数说明：mapScriptKey（ClientScriptKeyMapper）：提供本次调用所需
 * 的数据；必须满足声明的类型及调用时序要求。；返回值：RuntimeConsoleBackendEvent<RuntimeBackendObjec
 * tHandle>；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * clientConsoleEvent(value, mapScriptKey)，并按返回类型处理结果。
 */
export function clientConsoleEvent(
  value: RuntimeConsoleBackendEvent<ClientRemoteObjectHandle>,
  mapScriptKey: ClientScriptKeyMapper,
): RuntimeConsoleBackendEvent<RuntimeBackendObjectHandle> {
  if (value.type === 'console-api') {
    return {
      type: value.type,
      event: {
        ...value.event,
        arguments: value.event.arguments.map(clientRemoteObject),
        ...(value.event.stackTrace === undefined
          ? {}
          : { stackTrace: clientStackTrace(value.event.stackTrace, mapScriptKey) }),
      },
    }
  }
  return {
    type: value.type,
    event: { ...value.event, details: clientException(value.event.details, mapScriptKey) },
  }
}

/**
 * Convert a Client RemoteObject into the backend-neutral handle slot.
 * @param value - Client wire RemoteObject.
 * @returns A realm-neutral Runtime value.
 * @remarks 中文说明：功能说明：处理 clientRemoteObject 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：value（ClientRuntimeRemoteObject）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：RuntimeRemoteObject<RuntimeBackendObjectHandle>；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 clientRemoteObject(value)，并按返回类型处理结果。
 */
export function clientRemoteObject(
  value: ClientRuntimeRemoteObject,
): RuntimeRemoteObject<RuntimeBackendObjectHandle> {
  return {
    descriptor: value.descriptor,
    ...(value.object === undefined
      ? {}
      : { object: { handle: backendHandle(value.object.handle) } }),
    ...(value.semanticReference === undefined ? {} : { semanticReference: value.semanticReference }),
  }
}

/**
 * Rebrand a common backend handle for the Client transport that owns it.
 * @param value - Backend handle from a routed Runtime request.
 * @returns The same opaque text under its Client wire role.
 * @remarks 中文说明：功能说明：处理 clientHandle 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：value（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：ClientRemoteObjectHandle；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 clientHandle(value)，并按返回类型处理结果。
 */
export function clientHandle(value: string): ClientRemoteObjectHandle {
  return inspectorId<'ClientRemoteObjectHandle'>(value, 'Client object handle')
}

/**
 * 功能说明：处理 backendHandle 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns RuntimeBackendObjectHandle；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 backendHandle(value)，并按返回类型处理结果。
 */
function backendHandle(value: string): RuntimeBackendObjectHandle {
  return inspectorId<'RuntimeBackendObjectHandle'>(value, 'Runtime backend object handle')
}

/**
 * 功能说明：处理 clientStackTrace 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （RuntimeStackTrace）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param mapScriptKey （ClientScriptKeyMapper）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns RuntimeStackTrace；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 clientStackTrace(value, mapScriptKey)，并按返回类型处理结果。
 */
function clientStackTrace(value: RuntimeStackTrace, mapScriptKey: ClientScriptKeyMapper): RuntimeStackTrace {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：frame（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(frame)，并按返回类型处理结果。
   */
  return {
    ...value,
    callFrames: value.callFrames.map(frame => ({
      ...frame,
      ...(frame.scriptKey === undefined ? {} : { scriptKey: mapScriptKey(frame.scriptKey) }),
    })),
    ...(value.parent === undefined ? {} : { parent: clientStackTrace(value.parent, mapScriptKey) }),
  }
}
