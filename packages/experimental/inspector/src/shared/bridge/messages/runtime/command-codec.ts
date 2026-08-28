/** Exact wire decoder for Client Runtime commands.
 * @remarks 文件说明：文件职责：实现 experimental/inspector 中 command codec 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/inspector 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。 */

import { isJsonValue, isPlainObject } from '../../../json.ts'
import { exactKeys, optionalBoolean, optionalNonNegativeNumber, optionalString, wireId } from '../../../validation.ts'
import type { ClientCallArgument, ClientRuntimeCallFunctionCommand, ClientRuntimeCommand } from './commands.ts'

/**
 * Parse and rebuild one Runtime command before it enters the Client realm.
 * @param value - Untrusted command value.
 * @returns The validated command union member.
 * @remarks 中文说明：功能说明：解析 Client Runtime Command 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：value（unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：ClientRuntimeCommand；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * parseClientRuntimeCommand(value)，并按返回类型处理结果。
 */
export function parseClientRuntimeCommand(value: unknown): ClientRuntimeCommand {
  if (!isPlainObject(value) || typeof value.op !== 'string') {
    throw new Error('inspector protocol: Client Runtime command must have an op')
  }
  switch (value.op) {
    case 'evaluate': {
      exactKeys(value, [
        'op', 'expression', 'objectGroup', 'includeCommandLineAPI', 'silent', 'returnByValue',
        'generatePreview', 'userGesture', 'awaitPromise', 'disableBreaks', 'replMode',
        'allowUnsafeEvalBlockedByCSP', 'timeoutMs',
      ], 'evaluate command')
      if (typeof value.expression !== 'string') throw new Error('inspector protocol: evaluate expression must be a string')
      return {
        op: 'evaluate',
        expression: value.expression,
        ...optionalString(value, 'objectGroup'),
        ...optionalBoolean(value, 'includeCommandLineAPI'),
        ...optionalBoolean(value, 'silent'),
        ...optionalBoolean(value, 'returnByValue'),
        ...optionalBoolean(value, 'generatePreview'),
        ...optionalBoolean(value, 'userGesture'),
        ...optionalBoolean(value, 'awaitPromise'),
        ...optionalBoolean(value, 'disableBreaks'),
        ...optionalBoolean(value, 'replMode'),
        ...optionalBoolean(value, 'allowUnsafeEvalBlockedByCSP'),
        ...optionalNonNegativeNumber(value, 'timeoutMs'),
      }
    }
    case 'get-properties':
      exactKeys(value, [
        'op', 'handle', 'ownProperties', 'accessorPropertiesOnly', 'generatePreview', 'nonIndexedPropertiesOnly',
      ], 'get-properties command')
      return {
        op: 'get-properties',
        handle: wireId<'ClientRemoteObjectHandle'>(value.handle, 'handle'),
        ...optionalBoolean(value, 'ownProperties'),
        ...optionalBoolean(value, 'accessorPropertiesOnly'),
        ...optionalBoolean(value, 'generatePreview'),
        ...optionalBoolean(value, 'nonIndexedPropertiesOnly'),
      }
    case 'call-function':
      return parseCallFunction(value)
    case 'await-promise':
      exactKeys(value, ['op', 'promise', 'returnByValue', 'generatePreview'], 'await-promise command')
      return {
        op: 'await-promise',
        promise: wireId<'ClientRemoteObjectHandle'>(value.promise, 'promise'),
        ...optionalBoolean(value, 'returnByValue'),
        ...optionalBoolean(value, 'generatePreview'),
      }
    case 'release-object':
      exactKeys(value, ['op', 'handle'], 'release-object command')
      return {
        op: 'release-object',
        handle: wireId<'ClientRemoteObjectHandle'>(value.handle, 'handle'),
      }
    case 'release-object-group':
      exactKeys(value, ['op', 'objectGroup'], 'release-object-group command')
      if (typeof value.objectGroup !== 'string') throw new Error('inspector protocol: objectGroup must be a string')
      return { op: 'release-object-group', objectGroup: value.objectGroup }
    case 'global-lexical-scope-names':
      exactKeys(value, ['op'], 'global-lexical-scope-names command')
      return { op: 'global-lexical-scope-names' }
    default:
      throw new Error(`inspector protocol: unknown Client Runtime command ${JSON.stringify(value.op)}`)
  }
}

/**
 * 功能说明：解析 Call Function 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （Record<string, unknown>）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns ClientRuntimeCallFunctionCommand；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 parseCallFunction(value)，并按返回类型处理结果。
 */
function parseCallFunction(value: Record<string, unknown>): ClientRuntimeCallFunctionCommand {
  exactKeys(value, [
    'op', 'functionDeclaration', 'receiver', 'arguments', 'objectGroup', 'silent', 'returnByValue',
    'generatePreview', 'userGesture', 'awaitPromise',
  ], 'call-function command')
  if (typeof value.functionDeclaration !== 'string') {
    throw new Error('inspector protocol: functionDeclaration must be a string')
  }
  /**
   * 变量说明：args 用于处理 args 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let args: readonly ClientCallArgument[] | undefined
  if (value.arguments !== undefined) {
    if (!Array.isArray(value.arguments)) throw new Error('inspector protocol: call arguments must be an array')
    args = value.arguments.map(parseCallArgument)
  }
  return {
    op: 'call-function',
    functionDeclaration: value.functionDeclaration,
    ...(value.receiver === undefined
      ? {}
      : { receiver: wireId<'ClientRemoteObjectHandle'>(value.receiver, 'receiver') }),
    ...(args === undefined ? {} : { arguments: args }),
    ...optionalString(value, 'objectGroup'),
    ...optionalBoolean(value, 'silent'),
    ...optionalBoolean(value, 'returnByValue'),
    ...optionalBoolean(value, 'generatePreview'),
    ...optionalBoolean(value, 'userGesture'),
    ...optionalBoolean(value, 'awaitPromise'),
  }
}

/**
 * 功能说明：解析 Call Argument 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns ClientCallArgument；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 parseCallArgument(value)，并按返回类型处理结果。
 */
function parseCallArgument(value: unknown): ClientCallArgument {
  if (!isPlainObject(value) || typeof value.kind !== 'string') {
    throw new Error('inspector protocol: invalid Client Runtime call argument')
  }
  switch (value.kind) {
    case 'value':
      exactKeys(value, ['kind', 'value'], 'value call argument')
      if (!isJsonValue(value.value)) throw new Error('inspector protocol: call argument value must be JSON')
      return { kind: 'value', value: value.value }
    case 'unserializable':
      exactKeys(value, ['kind', 'value'], 'unserializable call argument')
      if (typeof value.value !== 'string') throw new Error('inspector protocol: unserializable argument must be a string')
      return { kind: 'unserializable', value: value.value }
    case 'object':
      exactKeys(value, ['kind', 'handle'], 'object call argument')
      return {
        kind: 'object',
        handle: wireId<'ClientRemoteObjectHandle'>(value.handle, 'handle'),
      }
    case 'undefined':
      exactKeys(value, ['kind'], 'undefined call argument')
      return { kind: 'undefined' }
    default:
      throw new Error(`inspector protocol: unknown call argument ${JSON.stringify(value.kind)}`)
  }
}
