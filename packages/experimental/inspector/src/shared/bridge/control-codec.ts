/** Exact decoders for Host, Worker, and injected Client lifecycle values.
 * @remarks 文件说明：文件职责：实现 experimental/inspector 中 control codec 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/inspector 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。 */

import type {
  InspectorClientBootstrap,
  InspectorHostControl,
  InspectorWorkerConfig,
  InspectorWorkerControl,
} from './messages/control.ts'
import { isPlainObject } from '../json.ts'
import { exactKeys, exactObject } from '../validation.ts'

/**
 * Decode the structured-cloned Worker configuration.
 * @param value - Untrusted workerData config value.
 * @returns The validated Worker configuration.
 * @remarks 中文说明：功能说明：解析 Inspector Worker Config 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：value（unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：InspectorWorkerConfig；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * parseInspectorWorkerConfig(value)，并按返回类型处理结果。
 */
export function parseInspectorWorkerConfig(value: unknown): InspectorWorkerConfig {
  /**
   * 常量说明：record 用于处理 record 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const record = exactObject(value, [
    'host', 'startPort', 'targetId', 'clientToken', 'clientOrigins', 'maxSourceFrameBytes',
    'maxSourceRecordsPerFrame', 'maxRetainedRequests', 'maxJournalBytes', 'clientRuntimeTimeoutMs', 'maxCordisNodes',
    'maxDisconnectedCordisTrees', 'maxClientSourceBytes',
  ], 'Worker config')
  if (record.host !== '127.0.0.1') throw new Error('inspector protocol: Worker host must be 127.0.0.1')
  if (typeof record.targetId !== 'string' || record.targetId.length === 0) {
    throw new Error('inspector protocol: Worker targetId must be a non-empty string')
  }
  if (typeof record.clientToken !== 'string' || record.clientToken.length === 0) {
    throw new Error('inspector protocol: Worker clientToken must be a non-empty string')
  }
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：origin（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(origin)，并按返回类型处理结果。
   */
  if (!Array.isArray(record.clientOrigins) || !record.clientOrigins.every(origin => typeof origin === 'string')) {
    throw new Error('inspector protocol: Worker clientOrigins must be strings')
  }
  /**
   * 常量说明：startPort 用于启动 Port 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const startPort = natural(record.startPort, 'startPort', true)
  if (startPort > 65_535) throw new Error('inspector protocol: Worker startPort must not exceed 65535')
  return {
    host: record.host,
    startPort,
    targetId: record.targetId,
    clientToken: record.clientToken,
    clientOrigins: record.clientOrigins,
    maxSourceFrameBytes: natural(record.maxSourceFrameBytes, 'maxSourceFrameBytes'),
    maxSourceRecordsPerFrame: natural(record.maxSourceRecordsPerFrame, 'maxSourceRecordsPerFrame'),
    maxRetainedRequests: natural(record.maxRetainedRequests, 'maxRetainedRequests'),
    maxJournalBytes: natural(record.maxJournalBytes, 'maxJournalBytes'),
    clientRuntimeTimeoutMs: natural(record.clientRuntimeTimeoutMs, 'clientRuntimeTimeoutMs'),
    maxClientSourceBytes: natural(record.maxClientSourceBytes, 'maxClientSourceBytes'),
    maxCordisNodes: natural(record.maxCordisNodes, 'maxCordisNodes'),
    maxDisconnectedCordisTrees: natural(record.maxDisconnectedCordisTrees, 'maxDisconnectedCordisTrees', true),
  }
}

/**
 * Decode one Host-to-Worker lifecycle command.
 * @param value - Untrusted control message.
 * @returns The validated Host command.
 * @remarks 中文说明：功能说明：解析 Inspector Host Control 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：value（unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：InspectorHostControl；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * parseInspectorHostControl(value)，并按返回类型处理结果。
 */
export function parseInspectorHostControl(value: unknown): InspectorHostControl {
  /**
   * 常量说明：record 用于处理 record 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const record = exactObject(value, ['type'], 'Host control message')
  if (record.type !== 'shutdown') throw new Error('inspector protocol: unknown Host control message')
  return { type: 'shutdown' }
}

/**
 * Decode one Worker-to-Host lifecycle event.
 * @param value - Untrusted control message.
 * @returns The validated Worker event.
 * @remarks 中文说明：功能说明：解析 Inspector Worker Control 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：value（unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：InspectorWorkerControl；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 parseInspectorWorkerControl(value)，并按返回类型处理结果。
 */
export function parseInspectorWorkerControl(value: unknown): InspectorWorkerControl {
  /**
   * 常量说明：record 用于处理 record 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const record = exactObjectByType(value, 'Worker control message')
  switch (record.type) {
    case 'ready':
      exactKeys(record, ['type', 'host', 'port', 'targetId'], 'Worker ready message')
      if (typeof record.host !== 'string' || typeof record.targetId !== 'string') {
        throw new Error('inspector protocol: invalid Worker ready identity')
      }
      return {
        type: 'ready',
        host: record.host,
        port: natural(record.port, 'port', true),
        targetId: record.targetId,
      }
    case 'failure':
      exactKeys(record, ['type', 'message'], 'Worker failure message')
      if (typeof record.message !== 'string') throw new Error('inspector protocol: invalid Worker failure')
      return { type: 'failure', message: record.message }
    case 'stopped':
      exactKeys(record, ['type'], 'Worker stopped message')
      return { type: 'stopped' }
    default:
      throw new Error('inspector protocol: unknown Worker control message')
  }
}

/**
 * Decode bootstrap data injected into the browser global.
 * @param value - Untrusted injected value.
 * @returns The validated Client bootstrap.
 * @remarks 中文说明：功能说明：解析 Inspector Client Bootstrap 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：value（unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：InspectorClientBootstrap；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 parseInspectorClientBootstrap(value)，并按返回类型处理结果。
 */
export function parseInspectorClientBootstrap(value: unknown): InspectorClientBootstrap {
  /**
   * 常量说明：record 用于处理 record 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const record = exactObject(value, [
    'endpoint', 'protocol', 'maxQueuedRecords', 'maxQueuedBytes', 'maxRecordsPerFrame', 'maxFrameBytes',
    'reconnectBaseMs', 'reconnectMaxMs', 'queryTimeoutMs', 'maxRuntimeObjectsPerSession',
    'maxRuntimePropertiesPerResult', 'maxCordisNodes', 'maxClientSourceBytes',
  ], 'Client bootstrap')
  if (typeof record.endpoint !== 'string' || typeof record.protocol !== 'string') {
    throw new Error('inspector protocol: Client bootstrap endpoint and protocol must be strings')
  }
  /**
   * 变量说明：endpoint 用于处理 endpoint 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let endpoint: URL
  try {
    endpoint = new URL(record.endpoint)
  } catch {
    throw new Error('inspector protocol: Client bootstrap endpoint must be an absolute URL')
  }
  if (endpoint.protocol !== 'ws:' || endpoint.hostname !== '127.0.0.1') {
    throw new Error('inspector protocol: Client bootstrap endpoint must use ws on 127.0.0.1')
  }
  if (record.protocol.length === 0 || record.protocol.length > 256) {
    throw new Error('inspector protocol: Client bootstrap protocol must contain 1 to 256 characters')
  }
  /**
   * 常量说明：bootstrap 用于处理 bootstrap 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const bootstrap: InspectorClientBootstrap = {
    endpoint: record.endpoint,
    protocol: record.protocol,
    maxQueuedRecords: natural(record.maxQueuedRecords, 'maxQueuedRecords'),
    maxQueuedBytes: natural(record.maxQueuedBytes, 'maxQueuedBytes'),
    maxRecordsPerFrame: natural(record.maxRecordsPerFrame, 'maxRecordsPerFrame'),
    maxFrameBytes: natural(record.maxFrameBytes, 'maxFrameBytes'),
    reconnectBaseMs: natural(record.reconnectBaseMs, 'reconnectBaseMs'),
    reconnectMaxMs: natural(record.reconnectMaxMs, 'reconnectMaxMs'),
    queryTimeoutMs: natural(record.queryTimeoutMs, 'queryTimeoutMs'),
    maxRuntimeObjectsPerSession: natural(record.maxRuntimeObjectsPerSession, 'maxRuntimeObjectsPerSession'),
    maxRuntimePropertiesPerResult: natural(record.maxRuntimePropertiesPerResult, 'maxRuntimePropertiesPerResult'),
    maxClientSourceBytes: natural(record.maxClientSourceBytes, 'maxClientSourceBytes'),
    maxCordisNodes: natural(record.maxCordisNodes, 'maxCordisNodes'),
  }
  if (bootstrap.reconnectMaxMs < bootstrap.reconnectBaseMs) {
    throw new Error('inspector protocol: reconnectMaxMs must be at least reconnectBaseMs')
  }
  return bootstrap
}

/**
 * 功能说明：处理 exactObjectByType 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param label （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns Record<string, unknown>；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 exactObjectByType(value, label)，并按返回类型处理结果。
 */
function exactObjectByType(value: unknown, label: string): Record<string, unknown> {
  if (!isPlainObject(value) || typeof value.type !== 'string') {
    throw new Error(`inspector protocol: ${label} must have a type`)
  }
  return value
}

/**
 * 功能说明：处理 natural 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param label （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param zero （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns number；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 natural(value, label, zero)，并按返回类型处理结果。
 */
function natural(value: unknown, label: string, zero = false): number {
  if (!Number.isSafeInteger(value) || (value as number) < (zero ? 0 : 1)) {
    throw new Error(`inspector protocol: ${label} must be ${zero ? 'a non-negative' : 'a positive'} safe integer`)
  }
  return value as number
}
