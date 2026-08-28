/** Exact decoders for Client source catalog operations and values.
 * @remarks 文件说明：文件职责：实现 experimental/inspector 中 codec 模块的职责，并向相邻模块提供可复用能力。
 * ；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/inspector 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。 */

import { isPlainObject } from '../../../json.ts'
import type { RuntimeScript } from '../../../cdp/index.ts'
import { exactKeys, exactObject, optionalBoolean, optionalString, wireId } from '../../../validation.ts'
import type {
  ClientScriptDescriptor,
  ClientSourceCommand,
  ClientSourceContentKind,
  ClientSourceResult,
} from './commands.ts'

/**
 * Parse one Worker-to-Client source command.
 * @param value - Untrusted decoded command.
 * @returns The validated command.
 * @remarks 中文说明：功能说明：解析 Client Source Command 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：value（unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：ClientSourceCommand；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * parseClientSourceCommand(value)，并按返回类型处理结果。
 */
export function parseClientSourceCommand(value: unknown): ClientSourceCommand {
  if (!isPlainObject(value) || typeof value.op !== 'string') {
    throw new Error('inspector protocol: Client source command must have an op')
  }
  if (value.op === 'list-scripts') {
    exactKeys(value, ['op'], 'Client source list command')
    return { op: 'list-scripts' }
  }
  if (value.op !== 'get-content-chunk') {
    throw new Error(`inspector protocol: unknown Client source command ${JSON.stringify(value.op)}`)
  }
  exactKeys(value, ['op', 'scriptKey', 'content', 'offset', 'maxBytes'], 'Client source chunk command')
  return {
    op: 'get-content-chunk',
    scriptKey: wireId<'RuntimeScriptKey'>(value.scriptKey, 'scriptKey'),
    content: contentKind(value.content),
    offset: natural(value.offset, 'offset', true),
    maxBytes: natural(value.maxBytes, 'maxBytes', false),
  }
}

/**
 * Parse one successful Client source result.
 * @param value - Untrusted decoded result.
 * @returns The validated result.
 * @remarks 中文说明：功能说明：解析 Client Source Result 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：value（unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：ClientSourceResult；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * parseClientSourceResult(value)，并按返回类型处理结果。
 */
export function parseClientSourceResult(value: unknown): ClientSourceResult {
  if (!isPlainObject(value) || typeof value.op !== 'string') {
    throw new Error('inspector protocol: Client source result must have an op')
  }
  if (value.op === 'list-scripts') {
    exactKeys(value, ['op', 'scripts'], 'Client source list result')
    if (!Array.isArray(value.scripts)) throw new Error('inspector protocol: Client source scripts must be an array')
    return { op: 'list-scripts', scripts: value.scripts.map(parseScript) }
  }
  if (value.op !== 'get-content-chunk') {
    throw new Error(`inspector protocol: unknown Client source result ${JSON.stringify(value.op)}`)
  }
  if (value.available === false) {
    exactKeys(value, ['op', 'scriptKey', 'content', 'available'], 'unavailable Client source chunk')
    return {
      op: 'get-content-chunk',
      scriptKey: wireId<'RuntimeScriptKey'>(value.scriptKey, 'scriptKey'),
      content: contentKind(value.content),
      available: false,
    }
  }
  exactKeys(
    value,
    ['op', 'scriptKey', 'content', 'available', 'offset', 'nextOffset', 'data', 'eof'],
    'Client source chunk result',
  )
  if (value.available !== true || typeof value.data !== 'string' || typeof value.eof !== 'boolean') {
    throw new Error('inspector protocol: invalid Client source chunk result')
  }
  /**
   * 常量说明：offset 用于处理 offset 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const offset = natural(value.offset, 'offset', true)
  /**
   * 常量说明：nextOffset 用于处理 nextOffset 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const nextOffset = natural(value.nextOffset, 'nextOffset', true)
  if (nextOffset < offset || !BASE64.test(value.data)) {
    throw new Error('inspector protocol: invalid Client source chunk data')
  }
  return {
    op: 'get-content-chunk',
    scriptKey: wireId<'RuntimeScriptKey'>(value.scriptKey, 'scriptKey'),
    content: contentKind(value.content),
    available: true,
    offset,
    nextOffset,
    data: value.data,
    eof: value.eof,
  }
}

/**
 * 功能说明：解析 Script 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns ClientScriptDescriptor；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 parseScript(value)，并按返回类型处理结果。
 */
function parseScript(value: unknown): ClientScriptDescriptor {
  /**
   * 常量说明：record 用于处理 record 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const record = exactObject(value, [
    'scriptKey', 'url', 'hash', 'buildId', 'sourceMapUrl', 'startLine', 'startColumn', 'endLine', 'endColumn',
    'isModule', 'length',
  ], 'Client script descriptor')
  if (typeof record.url !== 'string' || record.url.length > 8_192 || typeof record.hash !== 'string') {
    throw new Error('inspector protocol: invalid Client script identity')
  }
  return {
    scriptKey: wireId<'RuntimeScriptKey'>(record.scriptKey, 'scriptKey'),
    url: record.url,
    hash: record.hash,
    ...optionalString(record, 'buildId'),
    ...optionalString(record, 'sourceMapUrl'),
    startLine: natural(record.startLine, 'startLine', true),
    startColumn: natural(record.startColumn, 'startColumn', true),
    endLine: natural(record.endLine, 'endLine', true),
    endColumn: natural(record.endColumn, 'endColumn', true),
    ...optionalBoolean(record, 'isModule'),
    ...(record.length === undefined ? {} : { length: natural(record.length, 'length', true) }),
  } satisfies Omit<RuntimeScript, 'executionContextId'>
}

/**
 * 功能说明：处理 contentKind 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns ClientSourceContentKind；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 contentKind(value)，并按返回类型处理结果。
 */
function contentKind(value: unknown): ClientSourceContentKind {
  if (value !== 'source' && value !== 'source-map') {
    throw new Error('inspector protocol: invalid Client source content kind')
  }
  return value
}

/**
 * 功能说明：处理 natural 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param label （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param zero （boolean）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns number；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 natural(value, label, zero)，并按返回类型处理结果。
 */
function natural(value: unknown, label: string, zero: boolean): number {
  if (!Number.isSafeInteger(value) || (value as number) < (zero ? 0 : 1)) {
    throw new Error(`inspector protocol: ${label} must be ${zero ? 'a non-negative' : 'a positive'} integer`)
  }
  return value as number
}

/**
 * 常量说明：BASE64 用于处理 BASE64 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const BASE64 = /^(?:[A-Za-z\d+/]{4})*(?:[A-Za-z\d+/]{2}==|[A-Za-z\d+/]{3}=)?$/u
