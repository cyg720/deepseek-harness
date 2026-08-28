/** Versioned envelopes for Client source catalog operations.
 * @remarks 文件说明：文件职责：实现 experimental/inspector 中 frames 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/inspector 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。 */

import type {
  ClientSourceRequestId,
  ClientSourceSessionId,
  InspectorSourceGeneration,
  InspectorSourceId,
} from '../../ids.ts'
import { isPlainObject } from '../../../json.ts'
import { exactKeys, exactObject, wireId } from '../../../validation.ts'
import { INSPECTOR_PROTOCOL_VERSION } from '../../version.ts'
import { parseClientSourceCommand, parseClientSourceResult } from './codec.ts'
import type { ClientSourceCommand, ClientSourceError, ClientSourceResult } from './commands.ts'

/** Source capability that permits read-only Client script discovery. */
export interface ClientSourcesCapability {
  readonly type: 'client-sources'
}

/** Worker request for one operation in a Client source catalog. */
export interface ClientSourceRequestFrame {
  readonly v: typeof INSPECTOR_PROTOCOL_VERSION
  readonly t: 'client-sources/request'
  readonly sourceId: InspectorSourceId
  readonly generation: InspectorSourceGeneration
  readonly sessionId: ClientSourceSessionId
  readonly requestId: ClientSourceRequestId
  readonly command: ClientSourceCommand
}

/** Client response to one source catalog operation. */
export interface ClientSourceResponseFrame {
  readonly v: typeof INSPECTOR_PROTOCOL_VERSION
  readonly t: 'client-sources/response'
  readonly sourceId: InspectorSourceId
  readonly generation: InspectorSourceGeneration
  readonly sessionId: ClientSourceSessionId
  readonly requestId: ClientSourceRequestId
  readonly outcome:
    | { readonly ok: true; readonly result: ClientSourceResult }
    | { readonly ok: false; readonly error: ClientSourceError }
}

/** One-way cleanup for in-flight operations owned by a closed DevTools session. */
export interface ClientSourceSessionClosedFrame {
  readonly v: typeof INSPECTOR_PROTOCOL_VERSION
  readonly t: 'client-sources/session-closed'
  readonly sourceId: InspectorSourceId
  readonly generation: InspectorSourceGeneration
  readonly sessionId: ClientSourceSessionId
}

/**
 * Parse the marker capability for a Client source catalog.
 * @param value - Untrusted capability declaration.
 * @returns The validated marker capability.
 * @remarks 中文说明：功能说明：解析 Client Sources Capability 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：value（unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：ClientSourcesCapability；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 parseClientSourcesCapability(value)，并按返回类型处理结果。
 */
export function parseClientSourcesCapability(value: unknown): ClientSourcesCapability {
  /**
   * 常量说明：record 用于处理 record 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const record = exactObject(value, ['type'], 'Client Sources capability')
  if (record.type !== 'client-sources') throw new Error('inspector protocol: invalid Client Sources capability')
  return { type: 'client-sources' }
}

/**
 * Parse one Worker-to-Client source request.
 * @param value - Untrusted decoded request.
 * @returns The validated request frame.
 * @remarks 中文说明：功能说明：解析 Client Source Request Frame 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：value（Record<string, unknown>）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：ClientSourceRequestFrame；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 parseClientSourceRequestFrame(value)，并按返回类型处理结果。
 */
export function parseClientSourceRequestFrame(value: Record<string, unknown>): ClientSourceRequestFrame {
  exactKeys(value, ['v', 't', 'sourceId', 'generation', 'sessionId', 'requestId', 'command'], 'Client source request')
  if (value.v !== INSPECTOR_PROTOCOL_VERSION || value.t !== 'client-sources/request') {
    throw new Error('inspector protocol: invalid Client source request envelope')
  }
  return {
    v: INSPECTOR_PROTOCOL_VERSION,
    t: 'client-sources/request',
    sourceId: wireId<'InspectorSourceId'>(value.sourceId, 'sourceId'),
    generation: wireId<'InspectorSourceGeneration'>(value.generation, 'generation'),
    sessionId: wireId<'ClientSourceSessionId'>(value.sessionId, 'sessionId'),
    requestId: wireId<'ClientSourceRequestId'>(value.requestId, 'requestId'),
    command: parseClientSourceCommand(value.command),
  }
}

/**
 * Parse one Client-to-Worker source response.
 * @param value - Untrusted decoded response.
 * @returns The validated response frame.
 * @remarks 中文说明：功能说明：解析 Client Source Response Frame 相关流程；使用场景由所在模块及调用位置决定。
 * ；参数说明：value（Record<string, unknown>）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：ClientSourceResponseFrame；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 parseClientSourceResponseFrame(value)，并按返回类型处理结果。
 */
export function parseClientSourceResponseFrame(value: Record<string, unknown>): ClientSourceResponseFrame {
  exactKeys(value, ['v', 't', 'sourceId', 'generation', 'sessionId', 'requestId', 'outcome'], 'Client source response')
  if (value.v !== INSPECTOR_PROTOCOL_VERSION || value.t !== 'client-sources/response') {
    throw new Error('inspector protocol: invalid Client source response envelope')
  }
  return {
    v: INSPECTOR_PROTOCOL_VERSION,
    t: 'client-sources/response',
    sourceId: wireId<'InspectorSourceId'>(value.sourceId, 'sourceId'),
    generation: wireId<'InspectorSourceGeneration'>(value.generation, 'generation'),
    sessionId: wireId<'ClientSourceSessionId'>(value.sessionId, 'sessionId'),
    requestId: wireId<'ClientSourceRequestId'>(value.requestId, 'requestId'),
    outcome: parseOutcome(value.outcome),
  }
}

/**
 * Parse one Client source-session cleanup notification.
 * @param value - Untrusted decoded notification.
 * @returns The validated cleanup frame.
 * @remarks 中文说明：功能说明：解析 Client Source Session Closed Frame 相关流程；
 * 使用场景由所在模块及调用位置决定。；参数说明：value（Record<string, unknown>）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。；返回值：ClientSourceSessionClosedFrame；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 parseClientSourceSessionClosedFrame(v
 * alue)，并按返回类型处理结果。
 */
export function parseClientSourceSessionClosedFrame(value: Record<string, unknown>): ClientSourceSessionClosedFrame {
  exactKeys(value, ['v', 't', 'sourceId', 'generation', 'sessionId'], 'Client source session close')
  if (value.v !== INSPECTOR_PROTOCOL_VERSION || value.t !== 'client-sources/session-closed') {
    throw new Error('inspector protocol: invalid Client source session close envelope')
  }
  return {
    v: INSPECTOR_PROTOCOL_VERSION,
    t: 'client-sources/session-closed',
    sourceId: wireId<'InspectorSourceId'>(value.sourceId, 'sourceId'),
    generation: wireId<'InspectorSourceGeneration'>(value.generation, 'generation'),
    sessionId: wireId<'ClientSourceSessionId'>(value.sessionId, 'sessionId'),
  }
}

/**
 * 功能说明：解析 Outcome 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns ClientSourceResponseFrame['outcome']；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 parseOutcome(value)，并按返回类型处理结果。
 */
function parseOutcome(value: unknown): ClientSourceResponseFrame['outcome'] {
  if (!isPlainObject(value) || typeof value.ok !== 'boolean') {
    throw new Error('inspector protocol: invalid Client source outcome')
  }
  if (value.ok) {
    exactKeys(value, ['ok', 'result'], 'successful Client source outcome')
    return { ok: true, result: parseClientSourceResult(value.result) }
  }
  exactKeys(value, ['ok', 'error'], 'failed Client source outcome')
  /**
   * 常量说明：error 用于处理 error 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const error = exactObject(value.error, ['code', 'message'], 'Client source error')
  if (!ERROR_CODES.has(error.code as ClientSourceError['code']) || typeof error.message !== 'string') {
    throw new Error('inspector protocol: invalid Client source error')
  }
  return { ok: false, error: { code: error.code as ClientSourceError['code'], message: error.message } }
}

/**
 * 常量说明：ERROR_CODES 用于处理 ERROR_CODES 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const ERROR_CODES = new Set<ClientSourceError['code']>([
  'invalid-request', 'script-not-found', 'load-failed', 'result-too-large', 'internal-error',
])
