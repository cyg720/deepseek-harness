/** Versioned envelopes for Worker-to-Client Runtime operations.
 * @remarks 文件说明：文件职责：实现 experimental/inspector 中 frames 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/inspector 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。 */

import type {
  ClientRuntimeRequestId,
  ClientRuntimeSessionId,
  InspectorSourceGeneration,
  InspectorSourceId,
} from '../../ids.ts'
import { isPlainObject } from '../../../json.ts'
import { exactKeys, exactObject, wireId } from '../../../validation.ts'
import { INSPECTOR_PROTOCOL_VERSION } from '../../version.ts'
import { parseClientRuntimeCommand } from './command-codec.ts'
import { parseClientRuntimeResult } from './value-codec.ts'
import type { ClientRuntimeCommand, ClientRuntimeError, ClientRuntimeResult } from './commands.ts'

/** Source capability that permits synthetic Runtime execution contexts. */
export interface ClientRuntimeCapability {
  readonly type: 'client-runtime'
  readonly origin: string
}

/** Worker request for one operation in a specific source generation and DevTools session. */
export interface ClientRuntimeRequestFrame {
  readonly v: typeof INSPECTOR_PROTOCOL_VERSION
  readonly t: 'client-runtime/request'
  readonly sourceId: InspectorSourceId
  readonly generation: InspectorSourceGeneration
  readonly sessionId: ClientRuntimeSessionId
  readonly requestId: ClientRuntimeRequestId
  readonly command: ClientRuntimeCommand
}

/** Worker cancellation of one outstanding Client Runtime request. */
export interface ClientRuntimeCancelFrame {
  readonly v: typeof INSPECTOR_PROTOCOL_VERSION
  readonly t: 'client-runtime/cancel'
  readonly sourceId: InspectorSourceId
  readonly generation: InspectorSourceGeneration
  readonly sessionId: ClientRuntimeSessionId
  readonly requestId: ClientRuntimeRequestId
}

/** Worker acknowledgement that commits one successful Client Runtime response. */
export interface ClientRuntimeResponseAcknowledgedFrame {
  readonly v: typeof INSPECTOR_PROTOCOL_VERSION
  readonly t: 'client-runtime/response-acknowledged'
  readonly sourceId: InspectorSourceId
  readonly generation: InspectorSourceGeneration
  readonly sessionId: ClientRuntimeSessionId
  readonly requestId: ClientRuntimeRequestId
}

/** Client response to one typed Runtime request. */
export interface ClientRuntimeResponseFrame {
  readonly v: typeof INSPECTOR_PROTOCOL_VERSION
  readonly t: 'client-runtime/response'
  readonly sourceId: InspectorSourceId
  readonly generation: InspectorSourceGeneration
  readonly sessionId: ClientRuntimeSessionId
  readonly requestId: ClientRuntimeRequestId
  readonly outcome:
    | { readonly ok: true; readonly result: ClientRuntimeResult }
    | { readonly ok: false; readonly error: ClientRuntimeError }
}

/** One-way cleanup when a DevTools connection or its Runtime domain closes. */
export interface ClientRuntimeSessionClosedFrame {
  readonly v: typeof INSPECTOR_PROTOCOL_VERSION
  readonly t: 'client-runtime/session-closed'
  readonly sourceId: InspectorSourceId
  readonly generation: InspectorSourceGeneration
  readonly sessionId: ClientRuntimeSessionId
}

/**
 * Parse and rebuild a Client Runtime capability.
 * @param value - Untrusted capability declaration.
 * @returns The validated capability.
 * @remarks 中文说明：功能说明：解析 Client Runtime Capability 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：value（unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：ClientRuntimeCapability；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 parseClientRuntimeCapability(value)，并按返回类型处理结果。
 */
export function parseClientRuntimeCapability(value: unknown): ClientRuntimeCapability {
  /**
   * 常量说明：record 用于处理 record 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const record = exactObject(value, ['type', 'origin'], 'Client Runtime capability')
  if (record.type !== 'client-runtime' || typeof record.origin !== 'string' || record.origin.length > 2_048) {
    throw new Error('inspector protocol: invalid Client Runtime capability')
  }
  return { type: 'client-runtime', origin: record.origin }
}

/**
 * Parse and rebuild one Worker-to-Client Runtime request.
 * @param value - Untrusted request frame.
 * @returns The validated request frame.
 * @remarks 中文说明：功能说明：解析 Client Runtime Request Frame 相关流程；使用场景由所在模块及调用位置决定。
 * ；参数说明：value（Record<string, unknown>）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：ClientRuntimeRequestFrame；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 parseClientRuntimeRequestFrame(value)，并按返回类型处理结果。
 */
export function parseClientRuntimeRequestFrame(value: Record<string, unknown>): ClientRuntimeRequestFrame {
  exactKeys(value, ['v', 't', 'sourceId', 'generation', 'sessionId', 'requestId', 'command'], 'Client Runtime request')
  if (value.v !== INSPECTOR_PROTOCOL_VERSION || value.t !== 'client-runtime/request') {
    throw new Error('inspector protocol: invalid Client Runtime request envelope')
  }
  return {
    v: INSPECTOR_PROTOCOL_VERSION,
    t: 'client-runtime/request',
    sourceId: wireId<'InspectorSourceId'>(value.sourceId, 'sourceId'),
    generation: wireId<'InspectorSourceGeneration'>(value.generation, 'generation'),
    sessionId: wireId<'ClientRuntimeSessionId'>(value.sessionId, 'sessionId'),
    requestId: wireId<'ClientRuntimeRequestId'>(value.requestId, 'requestId'),
    command: parseClientRuntimeCommand(value.command),
  }
}

/**
 * Parse and rebuild one Worker-to-Client Runtime cancellation.
 * @param value - Untrusted cancellation frame.
 * @returns The validated cancellation frame.
 * @remarks 中文说明：功能说明：解析 Client Runtime Cancel Frame 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：value（Record<string, unknown>）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：ClientRuntimeCancelFrame；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 parseClientRuntimeCancelFrame(value)，并按返回类型处理结果。
 */
export function parseClientRuntimeCancelFrame(value: Record<string, unknown>): ClientRuntimeCancelFrame {
  exactKeys(value, ['v', 't', 'sourceId', 'generation', 'sessionId', 'requestId'], 'Client Runtime cancellation')
  if (value.v !== INSPECTOR_PROTOCOL_VERSION || value.t !== 'client-runtime/cancel') {
    throw new Error('inspector protocol: invalid Client Runtime cancellation envelope')
  }
  return {
    v: INSPECTOR_PROTOCOL_VERSION,
    t: 'client-runtime/cancel',
    sourceId: wireId<'InspectorSourceId'>(value.sourceId, 'sourceId'),
    generation: wireId<'InspectorSourceGeneration'>(value.generation, 'generation'),
    sessionId: wireId<'ClientRuntimeSessionId'>(value.sessionId, 'sessionId'),
    requestId: wireId<'ClientRuntimeRequestId'>(value.requestId, 'requestId'),
  }
}

/**
 * Parse and rebuild one Worker acknowledgement for a Client Runtime response.
 * @param value - Untrusted acknowledgement frame.
 * @returns The validated acknowledgement frame.
 * @remarks 中文说明：功能说明：解析 Client Runtime Response Acknowledged Frame 相关流程；
 * 使用场景由所在模块及调用位置决定。；参数说明：value（Record<string, unknown>）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。；返回值：ClientRuntimeResponseAcknowledgedFrame；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 parseClientRuntimeResponseAcknowledge
 * dFrame(value)，并按返回类型处理结果。
 */
/* jscpd:ignore-start */
// Deliberately mirrors parseClientRuntimeCancelFrame: each wire parser spells
// out its own envelope literally instead of sharing a tag-parameterized helper.
export function parseClientRuntimeResponseAcknowledgedFrame(
  value: Record<string, unknown>,
): ClientRuntimeResponseAcknowledgedFrame {
  exactKeys(value, ['v', 't', 'sourceId', 'generation', 'sessionId', 'requestId'], 'Client Runtime response acknowledgement')
  if (value.v !== INSPECTOR_PROTOCOL_VERSION || value.t !== 'client-runtime/response-acknowledged') {
    throw new Error('inspector protocol: invalid Client Runtime response acknowledgement envelope')
  }
  return {
    v: INSPECTOR_PROTOCOL_VERSION,
    t: 'client-runtime/response-acknowledged',
    sourceId: wireId<'InspectorSourceId'>(value.sourceId, 'sourceId'),
    generation: wireId<'InspectorSourceGeneration'>(value.generation, 'generation'),
    sessionId: wireId<'ClientRuntimeSessionId'>(value.sessionId, 'sessionId'),
    requestId: wireId<'ClientRuntimeRequestId'>(value.requestId, 'requestId'),
  }
}
/* jscpd:ignore-end */

/**
 * Parse and rebuild one Client-to-Worker Runtime response.
 * @param value - Untrusted response frame.
 * @returns The validated response frame.
 * @remarks 中文说明：功能说明：解析 Client Runtime Response Frame 相关流程；
 * 使用场景由所在模块及调用位置决定。；参数说明：value（Record<string, unknown>）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。；返回值：ClientRuntimeResponseFrame；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 parseClientRuntimeResponseFrame(value
 * )，并按返回类型处理结果。
 */
export function parseClientRuntimeResponseFrame(value: Record<string, unknown>): ClientRuntimeResponseFrame {
  exactKeys(value, ['v', 't', 'sourceId', 'generation', 'sessionId', 'requestId', 'outcome'], 'Client Runtime response')
  if (value.v !== INSPECTOR_PROTOCOL_VERSION || value.t !== 'client-runtime/response') {
    throw new Error('inspector protocol: invalid Client Runtime response envelope')
  }
  return {
    v: INSPECTOR_PROTOCOL_VERSION,
    t: 'client-runtime/response',
    sourceId: wireId<'InspectorSourceId'>(value.sourceId, 'sourceId'),
    generation: wireId<'InspectorSourceGeneration'>(value.generation, 'generation'),
    sessionId: wireId<'ClientRuntimeSessionId'>(value.sessionId, 'sessionId'),
    requestId: wireId<'ClientRuntimeRequestId'>(value.requestId, 'requestId'),
    outcome: parseOutcome(value.outcome),
  }
}

/**
 * Parse and rebuild one Runtime-session cleanup notification.
 * @param value - Untrusted cleanup frame.
 * @returns The validated cleanup frame.
 * @remarks 中文说明：功能说明：解析 Client Runtime Session Closed Frame 相关流程；
 * 使用场景由所在模块及调用位置决定。；参数说明：value（Record<string, unknown>）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。；返回值：ClientRuntimeSessionClosedFrame；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 parseClientRuntimeSessionClosedFrame(
 * value)，并按返回类型处理结果。
 */
export function parseClientRuntimeSessionClosedFrame(value: Record<string, unknown>): ClientRuntimeSessionClosedFrame {
  exactKeys(value, ['v', 't', 'sourceId', 'generation', 'sessionId'], 'Client Runtime session close')
  if (value.v !== INSPECTOR_PROTOCOL_VERSION || value.t !== 'client-runtime/session-closed') {
    throw new Error('inspector protocol: invalid Client Runtime session close envelope')
  }
  return {
    v: INSPECTOR_PROTOCOL_VERSION,
    t: 'client-runtime/session-closed',
    sourceId: wireId<'InspectorSourceId'>(value.sourceId, 'sourceId'),
    generation: wireId<'InspectorSourceGeneration'>(value.generation, 'generation'),
    sessionId: wireId<'ClientRuntimeSessionId'>(value.sessionId, 'sessionId'),
  }
}

/**
 * 功能说明：解析 Outcome 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns ClientRuntimeResponseFrame['outcome']；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 parseOutcome(value)，并按返回类型处理结果。
 */
function parseOutcome(value: unknown): ClientRuntimeResponseFrame['outcome'] {
  if (!isPlainObject(value) || typeof value.ok !== 'boolean') {
    throw new Error('inspector protocol: invalid Client Runtime outcome')
  }
  if (value.ok) {
    exactKeys(value, ['ok', 'result'], 'successful Client Runtime outcome')
    return { ok: true, result: parseClientRuntimeResult(value.result) }
  }
  exactKeys(value, ['ok', 'error'], 'failed Client Runtime outcome')
  /**
   * 常量说明：error 用于处理 error 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const error = exactObject(value.error, ['code', 'message'], 'Client Runtime error')
  if (!ERROR_CODES.has(error.code as ClientRuntimeError['code']) || typeof error.message !== 'string') {
    throw new Error('inspector protocol: invalid Client Runtime error')
  }
  return { ok: false, error: { code: error.code as ClientRuntimeError['code'], message: error.message } }
}

/**
 * 常量说明：ERROR_CODES 用于处理 ERROR_CODES 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const ERROR_CODES = new Set<ClientRuntimeError['code']>([
  'invalid-request', 'object-not-found', 'unsupported', 'timeout', 'result-too-large', 'internal-error',
])
