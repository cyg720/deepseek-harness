/** Exact decoders for non-CDP Inspector query frames.
 * @remarks 文件说明：文件职责：实现 experimental/inspector 中 codec 模块的职责，并向相邻模块提供可复用能力。
 * ；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/inspector 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。 */

import { parseCordisRuntimeTree } from '../../../cordis/model.ts'
import { isPlainObject } from '../../../json.ts'
import { exactKeys, exactObject, wireId } from '../../../validation.ts'
import { INSPECTOR_PROTOCOL_VERSION } from '../../version.ts'
import type { InspectorQuery, InspectorQueryError, InspectorQueryResult } from './commands.ts'
import type {
  InspectorQueryRequestFrame,
  InspectorQueryRequestId,
  InspectorQueryResponseFrame,
} from './frames.ts'
import type { InspectorSourceGeneration, InspectorSourceId } from '../../ids.ts'

/** Correlation fields recoverable before a query body is accepted. */
export interface InspectorQueryFrameIdentity {
  readonly sourceId: InspectorSourceId
  readonly generation: InspectorSourceGeneration
  readonly requestId: InspectorQueryRequestId
}

/**
 * Test whether a decoded carrier value belongs to the query request protocol.
 * @param value - Decoded carrier value.
 * @returns Whether the query request decoder owns the value.
 * @remarks 中文说明：功能说明：判断是否为 Inspector Query Request Envelope 相关流程；
 * 使用场景由所在模块及调用位置决定。；参数说明：value（unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：boolean；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * isInspectorQueryRequestEnvelope(value)，并按返回类型处理结果。
 */
export function isInspectorQueryRequestEnvelope(value: unknown): boolean {
  return isPlainObject(value) && value.t === 'query/request'
}

/**
 * Test whether a decoded carrier value belongs to the query response protocol.
 * @param value - Decoded carrier value.
 * @returns Whether the query response decoder owns the value.
 * @remarks 中文说明：功能说明：判断是否为 Inspector Query Response Envelope 相关流程；
 * 使用场景由所在模块及调用位置决定。；参数说明：value（unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：boolean；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * isInspectorQueryResponseEnvelope(value)，并按返回类型处理结果。
 */
export function isInspectorQueryResponseEnvelope(value: unknown): boolean {
  return isPlainObject(value) && value.t === 'query/response'
}

/**
 * Decode one source-to-Worker query request.
 * @param value - Untrusted decoded carrier value.
 * @returns The detached, validated request frame.
 * @remarks 中文说明：功能说明：解析 Inspector Query Request Frame 相关流程；
 * 使用场景由所在模块及调用位置决定。；参数说明：value（unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：InspectorQueryRequestFrame；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 parseInspectorQueryRequestFrame(value)，并按返回类型处理结果。
 */
export function parseInspectorQueryRequestFrame(value: unknown): InspectorQueryRequestFrame {
  /**
   * 常量说明：record 用于处理 record 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const record = exactObject(value, ['v', 't', 'sourceId', 'generation', 'requestId', 'query'], 'query request')
  if (record.v !== INSPECTOR_PROTOCOL_VERSION || record.t !== 'query/request') {
    throw new Error('inspector protocol: invalid query request envelope')
  }
  return {
    v: INSPECTOR_PROTOCOL_VERSION,
    t: 'query/request',
    sourceId: wireId<'InspectorSourceId'>(record.sourceId, 'sourceId'),
    generation: wireId<'InspectorSourceGeneration'>(record.generation, 'generation'),
    requestId: wireId<'InspectorQueryRequestId'>(record.requestId, 'requestId'),
    query: parseQuery(record.query),
  }
}

/**
 * Decode correlation fields used to reject a malformed request without timing out its caller.
 * @param value - Candidate query request frame.
 * @returns Validated source and request identities.
 * @remarks 中文说明：功能说明：解析 Inspector Query Frame Identity 相关流程；
 * 使用场景由所在模块及调用位置决定。；参数说明：value（unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：InspectorQueryFrameIdentity；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 parseInspectorQueryFrameIdentity(value)，并按返回类型处理结果。
 */
export function parseInspectorQueryFrameIdentity(value: unknown): InspectorQueryFrameIdentity {
  if (!isPlainObject(value) || value.v !== INSPECTOR_PROTOCOL_VERSION || value.t !== 'query/request') {
    throw new Error('inspector protocol: invalid query request envelope')
  }
  return {
    sourceId: wireId<'InspectorSourceId'>(value.sourceId, 'sourceId'),
    generation: wireId<'InspectorSourceGeneration'>(value.generation, 'generation'),
    requestId: wireId<'InspectorQueryRequestId'>(value.requestId, 'requestId'),
  }
}

/**
 * Decode one Worker-to-source query response.
 * @param value - Untrusted decoded carrier value.
 * @returns The detached, validated response frame.
 * @remarks 中文说明：功能说明：解析 Inspector Query Response Frame 相关流程；
 * 使用场景由所在模块及调用位置决定。；参数说明：value（unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：InspectorQueryResponseFrame；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 parseInspectorQueryResponseFrame(value)，并按返回类型处理结果。
 */
export function parseInspectorQueryResponseFrame(value: unknown): InspectorQueryResponseFrame {
  /**
   * 常量说明：record 用于处理 record 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const record = exactObject(value, ['v', 't', 'sourceId', 'generation', 'requestId', 'outcome'], 'query response')
  if (record.v !== INSPECTOR_PROTOCOL_VERSION || record.t !== 'query/response') {
    throw new Error('inspector protocol: invalid query response envelope')
  }
  return {
    v: INSPECTOR_PROTOCOL_VERSION,
    t: 'query/response',
    sourceId: wireId<'InspectorSourceId'>(record.sourceId, 'sourceId'),
    generation: wireId<'InspectorSourceGeneration'>(record.generation, 'generation'),
    requestId: wireId<'InspectorQueryRequestId'>(record.requestId, 'requestId'),
    outcome: parseOutcome(record.outcome),
  }
}

/**
 * 功能说明：解析 Query 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns InspectorQuery；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 parseQuery(value)，并按返回类型处理结果。
 */
function parseQuery(value: unknown): InspectorQuery {
  /**
   * 常量说明：record 用于处理 record 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const record = exactObject(value, ['op'], 'Inspector query')
  if (record.op !== 'cordis-tree/get') {
    throw new Error(`inspector protocol: unknown query operation ${JSON.stringify(record.op)}`)
  }
  return { op: 'cordis-tree/get' }
}

/**
 * 功能说明：解析 Result 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns InspectorQueryResult；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 parseResult(value)，并按返回类型处理结果。
 */
function parseResult(value: unknown): InspectorQueryResult {
  if (!isPlainObject(value) || typeof value.op !== 'string') {
    throw new Error('inspector protocol: query result must have an op')
  }
  switch (value.op) {
    case 'cordis-tree/get':
      exactKeys(value, ['op', 'tree'], 'Cordis tree query result')
      return { op: 'cordis-tree/get', tree: parseCordisRuntimeTree(value.tree) }
    default:
      throw new Error(`inspector protocol: unknown query result ${JSON.stringify(value.op)}`)
  }
}

/**
 * 功能说明：解析 Outcome 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns InspectorQueryResponseFrame['outcome']；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 parseOutcome(value)，并按返回类型处理结果。
 */
function parseOutcome(value: unknown): InspectorQueryResponseFrame['outcome'] {
  if (!isPlainObject(value) || typeof value.ok !== 'boolean') {
    throw new Error('inspector protocol: invalid query outcome')
  }
  if (value.ok) {
    exactKeys(value, ['ok', 'result'], 'successful query outcome')
    return { ok: true, result: parseResult(value.result) }
  }
  exactKeys(value, ['ok', 'error'], 'failed query outcome')
  /**
   * 常量说明：error 用于处理 error 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const error = exactObject(value.error, ['code', 'message'], 'query error')
  if (!QUERY_ERROR_CODES.has(error.code as InspectorQueryError['code']) || typeof error.message !== 'string') {
    throw new Error('inspector protocol: invalid query error')
  }
  return {
    ok: false,
    error: { code: error.code as InspectorQueryError['code'], message: error.message },
  }
}

/**
 * 常量说明：QUERY_ERROR_CODES 用于处理 QUERY_ERROR_CODES 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const QUERY_ERROR_CODES = new Set<InspectorQueryError['code']>([
  'invalid-request', 'stale-source', 'result-too-large', 'internal-error',
])
