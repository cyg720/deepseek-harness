/** Wire messages for Gateway-owned Remote streams and event-result RPCs.
 * @remarks 文件说明：文件职责：实现 api/gateway 中 stream protocol 模块的职责，并向相邻模块提供可复用能力。；
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的 api/gateway 能力，
 * 使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。；
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。 */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** Exact WebSocket route carrying every Typert Remote stream.
 * @remarks 中文说明：常量说明：REMOTE_STREAM_MUX_PATH 用于处理 REMOTE_STREAM_MUX_PATH
 * 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
export const REMOTE_STREAM_MUX_PATH = '/api/remote.mux'

/** Gateway-internal logical stream carrying application-selected Cordis events.
 * @remarks 中文说明：常量说明：REMOTE_EVENT_STREAM_ENDPOINT 用于处理
 * REMOTE_EVENT_STREAM_ENDPOINT 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
export const REMOTE_EVENT_STREAM_ENDPOINT = '$events'

/** Gateway-internal unary endpoint returning one Client Remote Event outcome.
 * @remarks 中文说明：常量说明：REMOTE_EVENT_RESULT_ENDPOINT 用于处理
 * REMOTE_EVENT_RESULT_ENDPOINT 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
export const REMOTE_EVENT_RESULT_ENDPOINT = '$events/result'

/** Empty standard Remote payload used to open the forwarded-event stream.
 * @remarks 中文说明：常量说明：REMOTE_EVENT_STREAM_PAYLOAD 用于处理
 * REMOTE_EVENT_STREAM_PAYLOAD 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
export const REMOTE_EVENT_STREAM_PAYLOAD = { args: {} } as const

/** Discriminator for the first item proving the Host event source is ready.
 * @remarks 中文说明：常量说明：REMOTE_EVENT_STREAM_READY 用于处理
 * REMOTE_EVENT_STREAM_READY 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
export const REMOTE_EVENT_STREAM_READY = { type: 'ready' } as const

/** Opaque identity for one active Client Remote Event generation. */
export type RemoteEventClientId = Branded<'RemoteEventClientId'>

/** Opaque correlation id for one pending Host-to-Client Remote Event. */
export type RemoteEventId = Branded<'RemoteEventId'>

/** Stable Host facts published with every established Client event generation. */
export interface RemoteEventHostInfo {
  /** Host account home used only to abbreviate displayed filesystem paths. */
  readonly home: string
}

/** Opening item that binds later HTTP results to this active event stream. */
export interface RemoteEventReadyFrame {
  readonly type: 'ready'
  readonly clientId: RemoteEventClientId
  /** Stable Host facts attached to this connection generation. */
  readonly host: RemoteEventHostInfo
}

/** Opaque Agent identity carried by one scoped Remote Event. */
export type RemoteEventAgentId = Branded<'RemoteEventAgentId'>

/** One Host notification delivered to a Client generation. */
export interface RemoteEventEmitFrame {
  readonly type: 'emit'
  readonly event: string
  readonly args: readonly unknown[]
}

/** One pending Agent-scoped waterfall delivered to a Client generation. */
export interface RemoteEventInvocationFrame {
  readonly type: 'waterfall'
  readonly event: string
  readonly eventId: RemoteEventId
  readonly agentId: RemoteEventAgentId
  readonly request: Readonly<Record<string, unknown>>
}

/** Cancellation of a pending waterfall previously delivered under the same id. */
export interface RemoteEventCancellationFrame {
  readonly type: 'cancel'
  readonly eventId: RemoteEventId
}

/** Every item carried by the Gateway-internal forwarded-event stream. */
export type RemoteEventDownlinkFrame =
  | RemoteEventReadyFrame
  | RemoteEventEmitFrame
  | RemoteEventInvocationFrame
  | RemoteEventCancellationFrame

/** JSON request fields plus the Host cancellation lifetime removed for transport. */
export interface ProjectedRemoteEventRequest {
  readonly request: Readonly<Record<string, unknown>>
  readonly signal?: AbortSignal
}

/** Error fields retained when a Client listener rejects a Host waterfall. */
export interface RemoteEventRejection {
  readonly name: string
  readonly message: string
  readonly code?: string
  readonly details?: unknown
}

/** Client response to one scoped Remote Event delivery. */
export interface RemoteEventResult {
  readonly clientId: RemoteEventClientId
  readonly eventId: RemoteEventId
  readonly outcome:
    | { readonly kind: 'next' }
    | { readonly kind: 'result'; readonly value?: unknown }
    | { readonly kind: 'rejected'; readonly error: RemoteEventRejection }
}

/**
 * Parse one result sent through the Client's `$events/result` HTTP RPC.
 * @param value - untrusted result payload.
 * @returns validated event correlation and outcome fields.
 * @remarks 中文说明：功能说明：解析 Remote Event Result 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：value（unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：RemoteEventResult；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * parseRemoteEventResult(value)，并按返回类型处理结果。
 */
export function parseRemoteEventResult(value: unknown): RemoteEventResult {
  if (!isRecord(value)
    || !exactKeys(value, ['clientId', 'eventId', 'outcome'])
    || !isRemoteEventClientId(value.clientId)
    || !isRemoteEventId(value.eventId)
    || !isRecord(value.outcome)) {
    throw new Error('api gateway: invalid Remote event result')
  }
  /**
   * 常量说明：outcome 用于处理 outcome 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const outcome = value.outcome
  if (outcome.kind === 'next' && exactKeys(outcome, ['kind'])) {
    return {
      clientId: value.clientId,
      eventId: value.eventId,
      outcome: { kind: 'next' },
    }
  }
  if (outcome.kind === 'result'
    && (exactKeys(outcome, ['kind']) || exactKeys(outcome, ['kind', 'value']))
    && (!Object.hasOwn(outcome, 'value') || isRemoteJsonValue(outcome.value))) {
    return {
      clientId: value.clientId,
      eventId: value.eventId,
      outcome: Object.hasOwn(outcome, 'value')
        ? { kind: 'result', value: outcome.value }
        : { kind: 'result' },
    }
  }
  if (outcome.kind === 'rejected'
    && exactKeys(outcome, ['kind', 'error'])) {
    return {
      clientId: value.clientId,
      eventId: value.eventId,
      outcome: { kind: 'rejected', error: parseRemoteEventRejection(outcome.error) },
    }
  }
  throw new Error('api gateway: invalid Remote event result')
}

/**
 * Remove the direct Agent and cancellation fields from one waterfall request.
 * @param value - request object before the waterfall's `next` callback.
 * @param subject - Agent used by the Cordis scope carrier.
 * @returns JSON-safe request fields and the optional Host cancellation signal.
 * @remarks 中文说明：功能说明：处理 projectRemoteEventRequest 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：value（unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：subject（object）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：ProjectedRemoteEventRequest；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 projectRemoteEventRequest(value, subject)，
 * 并按返回类型处理结果。
 */
export function projectRemoteEventRequest(
  value: unknown,
  subject: object,
): ProjectedRemoteEventRequest {
  if (!isPlainRecord(value) || !Object.hasOwn(value, 'agent') || value.agent !== subject) {
    throw new TypeError('api gateway: Remote event request must carry its scoped Agent directly')
  }
  /**
   * 常量说明：signal 用于处理 signal 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const signal = value.signal
  if (signal !== undefined && !(signal instanceof AbortSignal)) {
    throw new TypeError('api gateway: Remote event request signal must be an AbortSignal')
  }
  /**
   * 常量说明：request 用于处理 request 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const request: Record<string, unknown> = Object.create(null) as Record<string, unknown>
  for (const /*
   * 变量说明：key 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */ key of Reflect.ownKeys(value)) {
    if (key === 'agent' || key === 'signal') continue
    /**
     * 常量说明：descriptor 用于处理 descriptor 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const descriptor = typeof key === 'string' ? Object.getOwnPropertyDescriptor(value, key) : undefined
    if (typeof key !== 'string' || descriptor?.enumerable !== true) {
      throw new TypeError('api gateway: Remote event request has a non-JSON property')
    }
    request[key] = Reflect.get(value, key)
  }
  if (!isRemoteJsonValue(request)) {
    throw new TypeError('api gateway: Remote event request is not lossless JSON data')
  }
  return {
    request,
    ...(signal === undefined ? {} : { signal }),
  }
}

/**
 * Project an arbitrary rejection to stable, JSON-safe error fields.
 * @param reason - value thrown or rejected by a Client listener.
 * @returns wire-safe rejection fields.
 * @remarks 中文说明：功能说明：处理 projectRemoteEventRejection 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：reason（unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：RemoteEventRejection；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * projectRemoteEventRejection(reason)，并按返回类型处理结果。
 */
export function projectRemoteEventRejection(reason: unknown): RemoteEventRejection {
  /**
   * 常量说明：record 用于处理 record 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const record = typeof reason === 'object' && reason !== null ? reason : undefined
  /**
   * 常量说明：name 用于处理 name 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const name = stringProperty(record, 'name') ?? 'Error'
  /**
   * 常量说明：message 用于处理 message 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const message = stringProperty(record, 'message') ?? String(reason)
  /**
   * 常量说明：code 用于处理 code 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const code = stringProperty(record, 'code')
  /**
   * 常量说明：details 用于处理 details 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const details = record === undefined ? undefined : Reflect.get(record, 'details') as unknown
  return {
    name,
    message,
    ...(code === undefined ? {} : { code }),
    ...(details === undefined || !isRemoteJsonValue(details) ? {} : { details }),
  }
}

/**
 * Recreate a Client rejection for the Host continuation.
 * @param rejection - validated wire-safe error fields.
 * @returns an Error preserving the remote name, code, and JSON-safe details.
 * @remarks 中文说明：功能说明：处理 restoreRemoteEventRejection 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：rejection（RemoteEventRejection）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：Error；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * restoreRemoteEventRejection(rejection)，并按返回类型处理结果。
 */
export function restoreRemoteEventRejection(rejection: RemoteEventRejection): Error {
  /**
   * 常量说明：error 用于处理 error 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const error = new Error(rejection.message) as Error & { code?: string; details?: unknown }
  error.name = rejection.name
  if (rejection.code !== undefined) error.code = rejection.code
  if (rejection.details !== undefined) error.details = rejection.details
  return error
}

/**
 * Test whether a value crosses JSON transport without coercion or omission.
 * @param value - candidate boundary value.
 * @returns whether the value is losslessly JSON-compatible.
 * @remarks 中文说明：功能说明：判断是否为 Remote Json Value 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：value（unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：boolean；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 isRemoteJsonValue(value)，
 * 并按返回类型处理结果。
 */
export function isRemoteJsonValue(value: unknown): boolean {
  return visitJsonValue(value, new Set<object>())
}

/**
 * Recognize a non-empty Remote Event correlation id at a wire boundary.
 * @param value - untrusted wire value.
 * @returns whether the value is a valid Remote Event id.
 * @remarks 中文说明：功能说明：判断是否为 Remote Event Id 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：value（unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：value is
 * RemoteEventId；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * isRemoteEventId(value)，并按返回类型处理结果。
 */
export function isRemoteEventId(value: unknown): value is RemoteEventId {
  return typeof value === 'string' && value.length > 0
}

/**
 * Recognize a non-empty Remote Event Client id at a wire boundary.
 * @param value - untrusted wire value.
 * @returns whether the value identifies one event-stream generation.
 * @remarks 中文说明：功能说明：判断是否为 Remote Event Client Id 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：value（unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：value is
 * RemoteEventClientId；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * isRemoteEventClientId(value)，并按返回类型处理结果。
 */
export function isRemoteEventClientId(value: unknown): value is RemoteEventClientId {
  return typeof value === 'string' && value.length > 0
}

/**
 * Recognize the direct Agent identity used by a scoped Remote Event.
 * @param value - untrusted wire value.
 * @returns whether the value is a non-empty Agent identity.
 * @remarks 中文说明：功能说明：判断是否为 Remote Event Agent Id 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：value（unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：value is
 * RemoteEventAgentId；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * isRemoteEventAgentId(value)，并按返回类型处理结果。
 */
export function isRemoteEventAgentId(value: unknown): value is RemoteEventAgentId {
  return typeof value === 'string' && value.length > 0
}

/** One logical stream request sent from the browser. */
export type RemoteStreamClientMessage =
  | {
    readonly type: 'open'
    readonly streamId: string
    readonly endpoint: string
    readonly payload: unknown
  }
  | { readonly type: 'cancel'; readonly streamId: string }

/** Carrier-safe failure delivered by the Host. */
export interface RemoteStreamFailure {
  readonly code: string
  readonly message: string
  readonly details: object
}

/** One logical stream frame sent from the Host. */
export type RemoteStreamServerMessage =
  | { readonly type: 'item'; readonly streamId: string; readonly value?: unknown }
  | { readonly type: 'error'; readonly streamId: string; readonly error: RemoteStreamFailure }
  | { readonly type: 'end'; readonly streamId: string }

/**
 * Parse and validate one browser-to-Host text message.
 * @param text - complete WebSocket text message.
 * @returns the validated logical-stream request.
 * @remarks 中文说明：功能说明：解析 Remote Stream Client Message 相关流程；使用场景由所在模块及调用位置决定。
 * ；参数说明：text（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：RemoteStreamClientMessage；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 parseRemoteStreamClientMessage(text)，并按返回类型处理结果。
 */
export function parseRemoteStreamClientMessage(text: string): RemoteStreamClientMessage {
  return parseMessage(text, /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：value（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(value)，并按返回类型处理结果。
 */ (value) => {
      if (value.type === 'cancel' && exactKeys(value, ['type', 'streamId']) && validId(value.streamId)) {
        return value as unknown as RemoteStreamClientMessage
      }
      if (value.type === 'open'
      && exactKeys(value, ['type', 'streamId', 'endpoint', 'payload'])
      && validId(value.streamId)
      && typeof value.endpoint === 'string'
      && value.endpoint.length > 0) {
        return value as unknown as RemoteStreamClientMessage
      }
      throw new Error('api gateway: invalid Remote stream client message')
    })
}

/**
 * Parse and validate one Host-to-browser text message.
 * @param text - complete WebSocket text message.
 * @returns the validated logical-stream frame.
 * @remarks 中文说明：功能说明：解析 Remote Stream Server Message 相关流程；使用场景由所在模块及调用位置决定。
 * ；参数说明：text（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：RemoteStreamServerMessage；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 parseRemoteStreamServerMessage(text)，并按返回类型处理结果。
 */
export function parseRemoteStreamServerMessage(text: string): RemoteStreamServerMessage {
  return parseMessage(text, /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：value（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(value)，并按返回类型处理结果。
 */ (value) => {
      if (value.type === 'item'
      && (exactKeys(value, ['type', 'streamId']) || exactKeys(value, ['type', 'streamId', 'value']))
      && validId(value.streamId)) {
        return value as unknown as RemoteStreamServerMessage
      }
      if (value.type === 'end' && exactKeys(value, ['type', 'streamId']) && validId(value.streamId)) {
        return value as unknown as RemoteStreamServerMessage
      }
      if (value.type === 'error'
      && exactKeys(value, ['type', 'streamId', 'error'])
      && validId(value.streamId)
      && isRecord(value.error)
      && exactKeys(value.error, ['code', 'message', 'details'])
      && typeof value.error.code === 'string'
      && typeof value.error.message === 'string'
      && isRecord(value.error.details)) {
        return value as unknown as RemoteStreamServerMessage
      }
      throw new Error('api gateway: invalid Remote stream server message')
    })
}

/**
 * 功能说明：解析 Message 相关流程；使用场景由所在模块及调用位置决定。
 * @param text （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param validate （(value: Record<string, unknown>) => T）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。
 * @returns T；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 parseMessage(text, validate)，并按返回类型处理结果。
 */
function parseMessage<T>(text: string, validate: (value: Record<string, unknown>) => T): T {
  /**
   * 变量说明：decoded 用于处理 decoded 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let decoded: unknown
  try {
    decoded = JSON.parse(text) as unknown
  } catch (/*
 * 变量说明：cause 保存当前捕获的异常；使用前应按项目约定缩小其类型。
 */ cause) {
    throw new Error('api gateway: Remote stream message is not JSON', { cause })
  }
  if (!isRecord(decoded)) throw new Error('api gateway: Remote stream message must be an object')
  return validate(decoded)
}

/**
 * 功能说明：判断是否为 Record 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns value is Record<string, unknown>；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 isRecord(value)，并按返回类型处理结果。
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
}

/**
 * 功能说明：判断是否为 Plain Record 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns value is Record<string, unknown>；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 isPlainRecord(value)，并按返回类型处理结果。
 */
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false
  /**
   * 常量说明：prototype 用于处理 prototype 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const prototype: unknown = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

/**
 * 功能说明：处理 exactKeys 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （Record<string, unknown>）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param expected （readonly string[]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns boolean；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 exactKeys(value, expected)，并按返回类型处理结果。
 */
function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  /**
   * 常量说明：keys 用于处理 keys 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const keys = Reflect.ownKeys(value)
  return keys.length === expected.length && expected.every(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：key（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(key)，并按返回类型处理结果。
 */ key => Object.hasOwn(value, key))
}

/**
 * 功能说明：处理 validId 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns value is string；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 validId(value)，并按返回类型处理结果。
 */
function validId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

/**
 * 功能说明：解析 Remote Event Rejection 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns RemoteEventRejection；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 parseRemoteEventRejection(value)，并按返回类型处理结果。
 */
function parseRemoteEventRejection(value: unknown): RemoteEventRejection {
  if (!isRecord(value)
    || !hasOnlyKeys(value, ['name', 'message'], ['code', 'details'])
    || typeof value.name !== 'string'
    || value.name.length === 0
    || typeof value.message !== 'string'
    || (Object.hasOwn(value, 'code') && typeof value.code !== 'string')
    || (Object.hasOwn(value, 'details') && !isRemoteJsonValue(value.details))) {
    throw new Error('api gateway: invalid Remote event rejection')
  }
  return {
    name: value.name,
    message: value.message,
    ...(typeof value.code === 'string' ? { code: value.code } : {}),
    ...(Object.hasOwn(value, 'details') ? { details: value.details } : {}),
  }
}

/**
 * 功能说明：判断是否包含 Only Keys 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （Record<string, unknown>）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param required （readonly string[]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param optional （readonly string[]）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。
 * @returns boolean；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 hasOnlyKeys(value, required, optional)，并按返回类型处理结果。
 */
function hasOnlyKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
): boolean {
  /**
   * 常量说明：keys 用于处理 keys 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const keys = Reflect.ownKeys(value)
  return required.every(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：key（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(key)，并按返回类型处理结果。
 */ key => Object.hasOwn(value, key))
    && keys.every(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：key（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(key)，并按返回类型处理结果。
 */ key => typeof key === 'string' && (required.includes(key) || optional.includes(key)))
}

/**
 * 功能说明：处理 stringProperty 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （object | undefined）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param key （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns string | undefined；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 stringProperty(value, key)，并按返回类型处理结果。
 */
function stringProperty(value: object | undefined, key: string): string | undefined {
  if (value === undefined) return undefined
  /**
   * 常量说明：candidate 用于处理 candidate 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const candidate: unknown = Reflect.get(value, key)
  return typeof candidate === 'string' ? candidate : undefined
}

/**
 * 功能说明：处理 visitJsonValue 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param ancestors （Set<object>）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns boolean；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 visitJsonValue(value, ancestors)，并按返回类型处理结果。
 */
function visitJsonValue(value: unknown, ancestors: Set<object>): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value) && !Object.is(value, -0)
  if (typeof value !== 'object') return false
  if (ancestors.has(value)) return false
  ancestors.add(value)
  try {
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype
        || Reflect.ownKeys(value).length !== value.length + 1) return false
      for (let /*
       * 变量说明：index 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
       */ index = 0; index < value.length; index++) {
        if (!Object.hasOwn(value, index) || !visitJsonValue(value[index], ancestors)) return false
      }
      return true
    }
    /**
     * 常量说明：prototype 用于处理 prototype 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const prototype: unknown = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) return false
    for (const /*
     * 变量说明：key 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */ key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string') return false
      /**
       * 常量说明：descriptor 用于处理 descriptor 相关数据，作用于当前作用域；初始化后不可重新赋值，
       * 但对象内部是否可变仍由其类型决定。
       */
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (descriptor?.enumerable !== true || !visitJsonValue(Reflect.get(value, key), ancestors)) return false
    }
    return true
  } finally {
    ancestors.delete(value)
  }
}
