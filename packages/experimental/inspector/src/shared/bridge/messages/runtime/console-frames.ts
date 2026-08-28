/** Typed transport for Client Console sessions and events.
 * @remarks 文件说明：文件职责：实现 experimental/inspector 中 console frames 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/inspector 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。 */

import type { ClientRemoteObjectHandle, ClientRuntimeSessionId, InspectorSourceGeneration, InspectorSourceId } from '../../ids.ts'
import { isPlainObject } from '../../../json.ts'
import type { RuntimeConsoleBackendEvent, RuntimeConsoleType } from '../../../cdp/index.ts'
import { exactKeys, exactObject, wireId } from '../../../validation.ts'
import { INSPECTOR_PROTOCOL_VERSION } from '../../version.ts'
import {
  parseClientRuntimeExceptionDetails,
  parseClientRuntimeRemoteObject,
  parseClientRuntimeStackTrace,
} from './value-codec.ts'

/** Source capability that permits Client Console event forwarding. */
export interface ClientConsoleCapability {
  readonly type: 'client-console'
}

/** Worker request to start Console observation for one DevTools session. */
export interface ClientConsoleEnableFrame {
  readonly v: typeof INSPECTOR_PROTOCOL_VERSION
  readonly t: 'client-console/enable'
  readonly sourceId: InspectorSourceId
  readonly generation: InspectorSourceGeneration
  readonly sessionId: ClientRuntimeSessionId
}

/** Worker request to stop Console observation for one DevTools session. */
export interface ClientConsoleDisableFrame {
  readonly v: typeof INSPECTOR_PROTOCOL_VERSION
  readonly t: 'client-console/disable'
  readonly sourceId: InspectorSourceId
  readonly generation: InspectorSourceGeneration
  readonly sessionId: ClientRuntimeSessionId
}

/** Client Console event carrying objects retained for one DevTools session. */
export interface ClientConsoleEventFrame {
  readonly v: typeof INSPECTOR_PROTOCOL_VERSION
  readonly t: 'client-console/event'
  readonly sourceId: InspectorSourceId
  readonly generation: InspectorSourceGeneration
  readonly sessionId: ClientRuntimeSessionId
  readonly event: RuntimeConsoleBackendEvent<ClientRemoteObjectHandle>
}

/**
 * Parse the marker capability for Client Console forwarding.
 * @param value - Untrusted capability declaration.
 * @returns The validated marker capability.
 * @remarks 中文说明：功能说明：解析 Client Console Capability 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：value（unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：ClientConsoleCapability；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 parseClientConsoleCapability(value)，并按返回类型处理结果。
 */
export function parseClientConsoleCapability(value: unknown): ClientConsoleCapability {
  /**
   * 常量说明：record 用于处理 record 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const record = exactObject(value, ['type'], 'Client Console capability')
  if (record.type !== 'client-console') throw new Error('inspector protocol: invalid Client Console capability')
  return { type: 'client-console' }
}

/**
 * Parse a Worker-to-Client Console lifecycle frame.
 * @param value - Untrusted decoded frame.
 * @returns A validated enable or disable frame.
 * @remarks 中文说明：功能说明：解析 Client Console Control Frame 相关流程；使用场景由所在模块及调用位置决定。
 * ；参数说明：value（Record<string, unknown>）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：ClientConsoleEnableFrame | ClientConsoleDisableFrame；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 parseClientConsoleControlFrame(value)，
 * 并按返回类型处理结果。
 */
export function parseClientConsoleControlFrame(
  value: Record<string, unknown>,
): ClientConsoleEnableFrame | ClientConsoleDisableFrame {
  exactKeys(value, ['v', 't', 'sourceId', 'generation', 'sessionId'], 'Client Console control frame')
  if (value.v !== INSPECTOR_PROTOCOL_VERSION
    || (value.t !== 'client-console/enable' && value.t !== 'client-console/disable')) {
    throw new Error('inspector protocol: invalid Client Console control frame')
  }
  return {
    v: INSPECTOR_PROTOCOL_VERSION,
    t: value.t,
    sourceId: wireId<'InspectorSourceId'>(value.sourceId, 'sourceId'),
    generation: wireId<'InspectorSourceGeneration'>(value.generation, 'generation'),
    sessionId: wireId<'ClientRuntimeSessionId'>(value.sessionId, 'sessionId'),
  }
}

/**
 * Parse one Client-to-Worker Console event.
 * @param value - Untrusted decoded frame.
 * @returns A validated Console event frame.
 * @remarks 中文说明：功能说明：解析 Client Console Event Frame 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：value（Record<string, unknown>）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：ClientConsoleEventFrame；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 parseClientConsoleEventFrame(value)，并按返回类型处理结果。
 */
export function parseClientConsoleEventFrame(value: Record<string, unknown>): ClientConsoleEventFrame {
  exactKeys(value, ['v', 't', 'sourceId', 'generation', 'sessionId', 'event'], 'Client Console event frame')
  if (value.v !== INSPECTOR_PROTOCOL_VERSION || value.t !== 'client-console/event') {
    throw new Error('inspector protocol: invalid Client Console event envelope')
  }
  return {
    v: INSPECTOR_PROTOCOL_VERSION,
    t: 'client-console/event',
    sourceId: wireId<'InspectorSourceId'>(value.sourceId, 'sourceId'),
    generation: wireId<'InspectorSourceGeneration'>(value.generation, 'generation'),
    sessionId: wireId<'ClientRuntimeSessionId'>(value.sessionId, 'sessionId'),
    event: parseEvent(value.event),
  }
}

/**
 * 功能说明：解析 Event 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns RuntimeConsoleBackendEvent<ClientRemoteObjectHandle>；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 parseEvent(value)，并按返回类型处理结果。
 */
function parseEvent(value: unknown): RuntimeConsoleBackendEvent<ClientRemoteObjectHandle> {
  if (!isPlainObject(value) || (value.type !== 'console-api' && value.type !== 'exception')) {
    throw new Error('inspector protocol: invalid Client Console event')
  }
  if (value.type === 'console-api') {
    exactKeys(value, ['type', 'event'], 'Client Console API event')
    /**
     * 常量说明：event 用于处理 event 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const event = exactObject(value.event, ['type', 'arguments', 'timestamp', 'contextId', 'stackTrace'], 'Console API event')
    if (!CONSOLE_TYPES.has(event.type as RuntimeConsoleType)
      || !Array.isArray(event.arguments)
      || typeof event.timestamp !== 'number'
      || !Number.isFinite(event.timestamp)) {
      throw new Error('inspector protocol: invalid Console API event')
    }
    return {
      type: 'console-api',
      event: {
        type: event.type as RuntimeConsoleType,
        arguments: event.arguments.map(parseClientRuntimeRemoteObject),
        timestamp: event.timestamp,
        ...(event.contextId === undefined ? {} : { contextId: integer(event.contextId, 'contextId') }),
        ...(event.stackTrace === undefined ? {} : { stackTrace: parseClientRuntimeStackTrace(event.stackTrace) }),
      },
    }
  }
  exactKeys(value, ['type', 'event'], 'Client exception event')
  /**
   * 常量说明：event 用于处理 event 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const event = exactObject(value.event, ['timestamp', 'contextId', 'details'], 'Client exception event payload')
  if (typeof event.timestamp !== 'number' || !Number.isFinite(event.timestamp)) {
    throw new Error('inspector protocol: invalid Client exception timestamp')
  }
  return {
    type: 'exception',
    event: {
      timestamp: event.timestamp,
      ...(event.contextId === undefined ? {} : { contextId: integer(event.contextId, 'contextId') }),
      details: parseClientRuntimeExceptionDetails(event.details),
    },
  }
}

/**
 * 功能说明：处理 integer 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param label （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns number；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 integer(value, label)，并按返回类型处理结果。
 */
function integer(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value)) throw new Error(`inspector protocol: ${label} must be an integer`)
  return value as number
}

/**
 * 常量说明：CONSOLE_TYPES 用于处理 CONSOLE_TYPES 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const CONSOLE_TYPES = new Set<RuntimeConsoleType>([
  'log', 'debug', 'info', 'error', 'warning', 'dir', 'dirxml', 'table', 'trace', 'clear',
  'startGroup', 'startGroupCollapsed', 'endGroup', 'assert', 'profile', 'profileEnd', 'count', 'timeEnd',
])
