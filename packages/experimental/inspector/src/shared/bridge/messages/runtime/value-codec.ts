/** Exact wire decoder for Client Runtime results and RemoteObject data.
 * @remarks 文件说明：文件职责：实现 experimental/inspector 中 value codec 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/inspector 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。 */

import { isJsonValue, isPlainObject } from '../../../json.ts'
import { exactKeys, exactObject, optionalBoolean, optionalString, wireId } from '../../../validation.ts'
import { parseInspectorObjectReference } from '../../../cordis/object-reference.ts'
import type {
  RuntimeCallFrame,
  RuntimeObjectPreview,
  RuntimePropertyPreview,
  RuntimeRemoteObjectDescriptor,
  RuntimeRemoteObjectSubtype,
  RuntimeRemoteObjectType,
  RuntimeStackTrace,
} from '../../../cdp/index.ts'
import type {
  ClientRuntimeCompletion,
  ClientRuntimeExceptionDetails,
  ClientRuntimeInternalPropertyDescriptor,
  ClientRuntimePropertyDescriptor,
  ClientRuntimeRemoteObject,
  ClientRuntimeResult,
} from './commands.ts'

/**
 * Parse and rebuild one successful Client Runtime result.
 * @param value - Untrusted result value.
 * @returns The validated result union member.
 * @remarks 中文说明：功能说明：解析 Client Runtime Result 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：value（unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：ClientRuntimeResult；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * parseClientRuntimeResult(value)，并按返回类型处理结果。
 */
export function parseClientRuntimeResult(value: unknown): ClientRuntimeResult {
  if (!isPlainObject(value) || typeof value.op !== 'string') {
    throw new Error('inspector protocol: Client Runtime result must have an op')
  }
  switch (value.op) {
    case 'evaluate':
    case 'call-function':
    case 'await-promise':
      exactKeys(value, ['op', 'completion'], `${value.op} result`)
      return { op: value.op, completion: parseCompletion(value.completion) }
    case 'get-properties': {
      exactKeys(value, ['op', 'properties', 'internalProperties', 'exceptionDetails'], 'get-properties result')
      if (!Array.isArray(value.properties)) throw new Error('inspector protocol: properties must be an array')
      /**
       * 常量说明：internal 用于处理 internal 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const internal = value.internalProperties
      if (internal !== undefined && !Array.isArray(internal)) {
        throw new Error('inspector protocol: internalProperties must be an array')
      }
      return {
        op: 'get-properties',
        properties: value.properties.map(parsePropertyDescriptor),
        ...(internal === undefined ? {} : { internalProperties: internal.map(parseInternalPropertyDescriptor) }),
        ...(value.exceptionDetails === undefined
          ? {}
          : { exceptionDetails: parseClientRuntimeExceptionDetails(value.exceptionDetails) }),
      }
    }
    case 'release-object':
    case 'release-object-group':
      exactKeys(value, ['op'], `${value.op} result`)
      return { op: value.op }
    case 'global-lexical-scope-names':
      exactKeys(value, ['op', 'names'], 'global-lexical-scope-names result')
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：name（由 TypeScript
       * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(name)，并按返回类型处理结果。
       */
      if (!Array.isArray(value.names) || !value.names.every(name => typeof name === 'string')) {
        throw new Error('inspector protocol: lexical scope names must be strings')
      }
      return { op: 'global-lexical-scope-names', names: value.names }
    default:
      throw new Error(`inspector protocol: unknown Client Runtime result ${JSON.stringify(value.op)}`)
  }
}

/**
 * 功能说明：解析 Completion 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns ClientRuntimeCompletion；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 parseCompletion(value)，并按返回类型处理结果。
 */
function parseCompletion(value: unknown): ClientRuntimeCompletion {
  /**
   * 常量说明：record 用于处理 record 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const record = exactObject(value, ['result', 'exceptionDetails'], 'Client Runtime completion')
  return {
    result: parseClientRuntimeRemoteObject(record.result),
    ...(record.exceptionDetails === undefined
      ? {}
      : { exceptionDetails: parseClientRuntimeExceptionDetails(record.exceptionDetails) }),
  }
}

/**
 * Decode one Client Runtime object carrying an optional session-local handle.
 * @param value - Untrusted wire value.
 * @returns The validated realm-neutral object value.
 * @remarks 中文说明：功能说明：解析 Client Runtime Remote Object 相关流程；使用场景由所在模块及调用位置决定。
 * ；参数说明：value（unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：ClientRuntimeRemoteObject；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 parseClientRuntimeRemoteObject(value)，并按返回类型处理结果。
 */
export function parseClientRuntimeRemoteObject(value: unknown): ClientRuntimeRemoteObject {
  /**
   * 常量说明：record 用于处理 record 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const record = exactObject(value, ['descriptor', 'object', 'semanticReference'], 'Client Runtime object')
  /**
   * 常量说明：descriptor 用于处理 descriptor 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const descriptor = parseRemoteObjectDescriptor(record.descriptor)
  /**
   * 常量说明：object 用于处理 object 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const object = record.object === undefined
    ? undefined
    : exactObject(record.object, ['handle'], 'Client Runtime object reference')
  /**
   * 常量说明：remote 用于处理 remote 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const remote: ClientRuntimeRemoteObject = {
    descriptor,
    ...(object === undefined
      ? {}
      : { object: { handle: wireId<'ClientRemoteObjectHandle'>(object.handle, 'handle') } }),
    ...(record.semanticReference === undefined
      ? {}
      : { semanticReference: parseInspectorObjectReference(record.semanticReference) }),
  }
  validateRemoteObject(remote)
  return remote
}

/**
 * 功能说明：解析 Remote Object Descriptor 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns RuntimeRemoteObjectDescriptor；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 parseRemoteObjectDescriptor(value)，并按返回类型处理结果。
 */
function parseRemoteObjectDescriptor(value: unknown): RuntimeRemoteObjectDescriptor {
  /**
   * 常量说明：record 用于处理 record 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const record = exactObject(value, [
    'type', 'subtype', 'className', 'value', 'unserializableValue', 'description', 'preview',
  ], 'Runtime object descriptor')
  if (!REMOTE_TYPES.has(record.type as RuntimeRemoteObjectType)) {
    throw new Error('inspector protocol: invalid Client RemoteObject type')
  }
  if (record.subtype !== undefined && !REMOTE_SUBTYPES.has(record.subtype as RuntimeRemoteObjectSubtype)) {
    throw new Error('inspector protocol: invalid Client RemoteObject subtype')
  }
  if (record.value !== undefined && !isJsonValue(record.value)) {
    throw new Error('inspector protocol: Client RemoteObject value must be JSON')
  }
  return {
    type: record.type as RuntimeRemoteObjectType,
    ...(record.subtype === undefined ? {} : { subtype: record.subtype as RuntimeRemoteObjectSubtype }),
    ...optionalString(record, 'className'),
    ...(record.value === undefined ? {} : { value: record.value }),
    ...optionalString(record, 'unserializableValue'),
    ...optionalString(record, 'description'),
    ...(record.preview === undefined ? {} : { preview: parseObjectPreview(record.preview) }),
  }
}

/**
 * 功能说明：解析 Object Preview 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns RuntimeObjectPreview；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 parseObjectPreview(value)，并按返回类型处理结果。
 */
function parseObjectPreview(value: unknown): RuntimeObjectPreview {
  /**
   * 常量说明：record 用于处理 record 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const record = exactObject(value, ['type', 'subtype', 'description', 'overflow', 'properties'], 'object preview')
  if (!REMOTE_TYPES.has(record.type as RuntimeRemoteObjectType)
    || (record.subtype !== undefined && !REMOTE_SUBTYPES.has(record.subtype as RuntimeRemoteObjectSubtype))
    || typeof record.overflow !== 'boolean'
    || !Array.isArray(record.properties)) {
    throw new Error('inspector protocol: invalid object preview')
  }
  return {
    type: record.type as RuntimeRemoteObjectType,
    ...(record.subtype === undefined ? {} : { subtype: record.subtype as RuntimeRemoteObjectSubtype }),
    ...optionalString(record, 'description'),
    overflow: record.overflow,
    properties: record.properties.map(parsePropertyPreview),
  }
}

/**
 * 功能说明：解析 Property Preview 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns RuntimePropertyPreview；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 parsePropertyPreview(value)，并按返回类型处理结果。
 */
function parsePropertyPreview(value: unknown): RuntimePropertyPreview {
  /**
   * 常量说明：record 用于处理 record 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const record = exactObject(value, ['name', 'type', 'value', 'valuePreview', 'subtype'], 'property preview')
  if (typeof record.name !== 'string'
    || (record.type !== 'accessor' && !REMOTE_TYPES.has(record.type as RuntimeRemoteObjectType))
    || (record.subtype !== undefined && !REMOTE_SUBTYPES.has(record.subtype as RuntimeRemoteObjectSubtype))) {
    throw new Error('inspector protocol: invalid property preview')
  }
  return {
    name: record.name,
    type: record.type as RuntimePropertyPreview['type'],
    ...optionalString(record, 'value'),
    ...(record.valuePreview === undefined ? {} : { valuePreview: parseObjectPreview(record.valuePreview) }),
    ...(record.subtype === undefined ? {} : { subtype: record.subtype as RuntimeRemoteObjectSubtype }),
  }
}

/**
 * 功能说明：解析 Property Descriptor 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns ClientRuntimePropertyDescriptor；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 parsePropertyDescriptor(value)，并按返回类型处理结果。
 */
function parsePropertyDescriptor(value: unknown): ClientRuntimePropertyDescriptor {
  /**
   * 常量说明：record 用于处理 record 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const record = exactObject(value, [
    'name', 'value', 'writable', 'get', 'set', 'configurable', 'enumerable', 'wasThrown', 'isOwn', 'symbol',
  ], 'property descriptor')
  if (typeof record.name !== 'string' || typeof record.configurable !== 'boolean' || typeof record.enumerable !== 'boolean') {
    throw new Error('inspector protocol: invalid property descriptor')
  }
  /**
   * 常量说明：dataDescriptor 用于处理 dataDescriptor 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const dataDescriptor = record.value !== undefined || record.writable !== undefined
  /**
   * 常量说明：accessorDescriptor 用于处理 accessorDescriptor 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const accessorDescriptor = record.get !== undefined || record.set !== undefined
  if (dataDescriptor && accessorDescriptor) {
    throw new Error('inspector protocol: property descriptor mixes data and accessor fields')
  }
  return {
    name: record.name,
    ...(record.value === undefined ? {} : { value: parseClientRuntimeRemoteObject(record.value) }),
    ...optionalBoolean(record, 'writable'),
    ...(record.get === undefined ? {} : { get: parseClientRuntimeRemoteObject(record.get) }),
    ...(record.set === undefined ? {} : { set: parseClientRuntimeRemoteObject(record.set) }),
    configurable: record.configurable,
    enumerable: record.enumerable,
    ...optionalBoolean(record, 'wasThrown'),
    ...optionalBoolean(record, 'isOwn'),
    ...(record.symbol === undefined ? {} : { symbol: parseClientRuntimeRemoteObject(record.symbol) }),
  }
}

/**
 * 功能说明：解析 Internal Property Descriptor 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns ClientRuntimeInternalPropertyDescriptor；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 parseInternalPropertyDescriptor(value)，并按返回类型处理结果。
 */
function parseInternalPropertyDescriptor(value: unknown): ClientRuntimeInternalPropertyDescriptor {
  /**
   * 常量说明：record 用于处理 record 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const record = exactObject(value, ['name', 'value'], 'internal property descriptor')
  if (typeof record.name !== 'string') throw new Error('inspector protocol: invalid internal property descriptor')
  return {
    name: record.name,
    ...(record.value === undefined ? {} : { value: parseClientRuntimeRemoteObject(record.value) }),
  }
}

/**
 * Decode Client exception details used by command results and events.
 * @param value - Untrusted wire value.
 * @returns Validated exception details.
 * @remarks 中文说明：功能说明：解析 Client Runtime Exception Details 相关流程；
 * 使用场景由所在模块及调用位置决定。；参数说明：value（unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：ClientRuntimeExceptionDetails；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 parseClientRuntimeExceptionDetails(value)，
 * 并按返回类型处理结果。
 */
export function parseClientRuntimeExceptionDetails(value: unknown): ClientRuntimeExceptionDetails {
  /**
   * 常量说明：record 用于处理 record 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const record = exactObject(value, [
    'text', 'lineNumber', 'columnNumber', 'url', 'stackTrace', 'exception',
  ], 'exception details')
  if (typeof record.text !== 'string'
    || !Number.isSafeInteger(record.lineNumber)
    || (record.lineNumber as number) < 0
    || !Number.isSafeInteger(record.columnNumber)
    || (record.columnNumber as number) < 0) {
    throw new Error('inspector protocol: invalid exception details')
  }
  return {
    text: record.text,
    lineNumber: record.lineNumber as number,
    columnNumber: record.columnNumber as number,
    ...optionalString(record, 'url'),
    ...(record.stackTrace === undefined ? {} : { stackTrace: parseClientRuntimeStackTrace(record.stackTrace) }),
    ...(record.exception === undefined ? {} : { exception: parseClientRuntimeRemoteObject(record.exception) }),
  }
}

/**
 * Decode a stack trace carried by a Client Runtime or Console frame.
 * @param value - Untrusted stack-trace value.
 * @returns The validated realm-neutral stack trace.
 * @remarks 中文说明：功能说明：解析 Client Runtime Stack Trace 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：value（unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：RuntimeStackTrace；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * parseClientRuntimeStackTrace(value)，并按返回类型处理结果。
 */
export function parseClientRuntimeStackTrace(value: unknown): RuntimeStackTrace {
  /**
   * 常量说明：record 用于处理 record 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const record = exactObject(value, ['description', 'callFrames', 'parent'], 'stack trace')
  if (!Array.isArray(record.callFrames)) throw new Error('inspector protocol: stack callFrames must be an array')
  return {
    ...optionalString(record, 'description'),
    callFrames: record.callFrames.map(parseCallFrame),
    ...(record.parent === undefined ? {} : { parent: parseClientRuntimeStackTrace(record.parent) }),
  }
}

/**
 * 功能说明：解析 Call Frame 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns RuntimeCallFrame；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 parseCallFrame(value)，并按返回类型处理结果。
 */
function parseCallFrame(value: unknown): RuntimeCallFrame {
  /**
   * 常量说明：record 用于处理 record 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const record = exactObject(value, ['functionName', 'scriptKey', 'url', 'lineNumber', 'columnNumber'], 'stack call frame')
  if (typeof record.functionName !== 'string'
    || typeof record.url !== 'string'
    || !Number.isSafeInteger(record.lineNumber)
    || !Number.isSafeInteger(record.columnNumber)) {
    throw new Error('inspector protocol: invalid stack call frame')
  }
  return {
    functionName: record.functionName,
    ...(record.scriptKey === undefined ? {} : { scriptKey: wireId<'RuntimeScriptKey'>(record.scriptKey, 'scriptKey') }),
    url: record.url,
    lineNumber: record.lineNumber as number,
    columnNumber: record.columnNumber as number,
  }
}

/**
 * 常量说明：REMOTE_TYPES 用于处理 REMOTE_TYPES 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const REMOTE_TYPES = new Set<RuntimeRemoteObjectType>([
  'object', 'function', 'undefined', 'string', 'number', 'boolean', 'symbol', 'bigint',
])

/**
 * 常量说明：REMOTE_SUBTYPES 用于处理 REMOTE_SUBTYPES 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const REMOTE_SUBTYPES = new Set<RuntimeRemoteObjectSubtype>([
  'array', 'null', 'node', 'regexp', 'date', 'map', 'set', 'weakmap', 'weakset', 'iterator', 'generator',
  'error', 'proxy', 'promise', 'typedarray', 'arraybuffer', 'dataview', 'webassemblymemory', 'wasmvalue',
])

/**
 * 功能说明：校验 Remote Object 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （ClientRuntimeRemoteObject）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 validateRemoteObject(value)，并按返回类型处理结果。
 */
function validateRemoteObject(value: ClientRuntimeRemoteObject): void {
  if (value.semanticReference !== undefined && value.object === undefined) {
    throw new Error('inspector protocol: semanticReference requires a retained Client object')
  }
  /**
   * 常量说明：descriptor 用于处理 descriptor 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const descriptor = value.descriptor
  if (descriptor.subtype !== undefined && descriptor.type !== 'object') {
    throw new Error('inspector protocol: only object RemoteObjects may have a subtype')
  }
  if (descriptor.preview !== undefined && descriptor.type !== 'object') {
    throw new Error('inspector protocol: only object RemoteObjects may have a preview')
  }
  /**
   * 常量说明：hasValue 用于判断是否包含 Value 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const hasValue = descriptor.value !== undefined
  /**
   * 常量说明：hasUnserializableValue 用于判断是否包含 Unserializable Value 相关数据，作用于当前作用域；
   * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const hasUnserializableValue = descriptor.unserializableValue !== undefined
  /**
   * 常量说明：hasObject 用于判断是否包含 Object 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const hasObject = value.object !== undefined
  switch (descriptor.type) {
    case 'undefined':
      requireRepresentations(descriptor.type, hasValue, hasUnserializableValue, hasObject, false, false, false)
      return
    case 'string':
      requireRepresentations(descriptor.type, typeof descriptor.value === 'string', hasUnserializableValue, hasObject, true, false, false)
      return
    case 'boolean':
      requireRepresentations(descriptor.type, typeof descriptor.value === 'boolean', hasUnserializableValue, hasObject, true, false, false)
      return
    case 'number': {
      /**
       * 常量说明：finite 用于处理 finite 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const finite = typeof descriptor.value === 'number'
        && Number.isFinite(descriptor.value)
        && !Object.is(descriptor.value, -0)
      /**
       * 常量说明：special 用于处理 special 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const special = descriptor.unserializableValue === 'NaN'
        || descriptor.unserializableValue === 'Infinity'
        || descriptor.unserializableValue === '-Infinity'
        || descriptor.unserializableValue === '-0'
      if (hasObject || finite === special) throw new Error('inspector protocol: invalid number RemoteObject representation')
      return
    }
    case 'bigint':
      if (hasValue || hasObject || !/^-?(?:0|[1-9]\d*)n$/u.test(descriptor.unserializableValue ?? '')) {
        throw new Error('inspector protocol: invalid bigint RemoteObject representation')
      }
      return
    case 'symbol':
    case 'function':
      requireRepresentations(descriptor.type, hasValue, hasUnserializableValue, hasObject, false, false, true)
      return
    case 'object':
      if (descriptor.subtype === 'null') {
        if (descriptor.value !== null || hasObject || hasUnserializableValue) {
          throw new Error('inspector protocol: invalid null RemoteObject representation')
        }
        return
      }
      if (hasUnserializableValue || hasValue === hasObject) {
        throw new Error('inspector protocol: object RemoteObject needs exactly one value or backend object')
      }
  }
}

/**
 * 功能说明：处理 requireRepresentations 相关流程；使用场景由所在模块及调用位置决定。
 * @param type （RuntimeRemoteObjectType）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param hasValue （boolean）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param hasUnserializableValue （boolean）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param hasObject （boolean）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param expectedValue （boolean）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param expectedUnserializableValue （boolean）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。
 * @param expectedObject （boolean）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 requireRepresentations(type, hasValue,
 * hasUnserializableVa…, hasObject, expectedValue, expectedUnserializa…,
 * expectedObject)，并按返回类型处理结果。
 */
function requireRepresentations(
  type: RuntimeRemoteObjectType,
  hasValue: boolean,
  hasUnserializableValue: boolean,
  hasObject: boolean,
  expectedValue: boolean,
  expectedUnserializableValue: boolean,
  expectedObject: boolean,
): void {
  if (hasValue !== expectedValue
    || hasUnserializableValue !== expectedUnserializableValue
    || hasObject !== expectedObject) {
    throw new Error(`inspector protocol: invalid ${type} RemoteObject representation`)
  }
}
