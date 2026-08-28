/** Client-realm executor for the typed Runtime command protocol.
 * @remarks 文件说明：文件职责：实现 experimental/inspector 中 runtime 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/inspector 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。 */

import type {
  ClientCallArgument,
  ClientRuntimeCapability,
  ClientRuntimeCommand,
  ClientRuntimeCompletion,
  ClientRuntimeError,
  ClientRuntimeExceptionDetails,
  ClientRuntimeRequestFrame,
  ClientRuntimeResponseFrame,
  ClientRuntimeResult,
  ClientRuntimeRemoteObject,
} from '../../shared/bridge/messages/runtime/index.ts'
import type {
  ClientRemoteObjectHandle,
  ClientRuntimeRequestId,
  ClientRuntimeSessionId,
} from '../../shared/bridge/ids.ts'
import { isJsonValue, jsonByteLength } from '../../shared/json.ts'
import { INSPECTOR_PROTOCOL_VERSION } from '../../shared/bridge/version.ts'
import { ClientRuntimeExecutionError } from './errors.ts'
import type { RuntimeConsoleBackendEvent, RuntimeConsoleType, RuntimeStackTrace } from '../../shared/cdp/index.ts'
import { ClientObjectStore, type ClientObjectAllocation } from './objects.ts'
import { getClientProperties } from './properties.ts'
import { clientErrorStack, type ClientScriptKeyResolver } from './stack.ts'

/**
 * 常量说明：MAX_RUNTIME_ERROR_MESSAGE_LENGTH 用于处理
 * MAX_RUNTIME_ERROR_MESSAGE_LENGTH 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const MAX_RUNTIME_ERROR_MESSAGE_LENGTH = 2_048

/**
 * Describe browser-side Runtime execution.
 * @param origin - Origin assigned to the synthetic execution context.
 * @returns The Runtime capability advertised by a browser Client source.
 * @remarks 中文说明：功能说明：处理 runtimeBridgeCapability 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：origin（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：ClientRuntimeCapability；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 runtimeBridgeCapability(origin)，并按返回类型处理结果。
 */
export function runtimeBridgeCapability(origin: string): ClientRuntimeCapability {
  return { type: 'client-runtime', origin }
}

/** Client-side limits injected by the Host deployment. */
export interface ClientRuntimeLimits {
  readonly maxObjectsPerSession: number
  readonly maxPropertiesPerResult: number
  readonly maxResponseBytes: number
}

/** Executes Runtime requests while isolating object handles by DevTools session.
 * @remarks 中文说明：类说明：ClientRuntimeExecutor 用于集中封装 处理 ClientRuntimeExecutor
 * 相关状态与行为。；核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。；使用场景：由
 * experimental/inspector 在对应插件或业务生命周期内创建和调用。 */
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
export class ClientRuntimeExecutor {
  /**
   * 常量说明：sessions 用于处理 sessions 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly sessions = new Map<ClientRuntimeSessionId, ClientRuntimeSession>()
  /**
   * 常量说明：responseAllocations 用于处理 responseAllocations 相关数据，作用于成员；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  private readonly responseAllocations = new Map<ClientRuntimeRequestId, {
    readonly sessionId: ClientRuntimeSessionId
    readonly session: ClientRuntimeSession
    readonly allocation: ClientObjectAllocation
  }>()

  /**
   * 功能说明：处理 ClientRuntimeExecutor 相关流程；使用场景由所在模块及调用位置决定。
   * @param limits （ClientRuntimeLimits）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param resolveScript （ClientScriptKeyResolver）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。
   * @returns 当前类实例；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 通过 new ClientRuntimeExecutor(limits, resolveScript) 创建实例，
   * 并在所属生命周期内使用。
   */
  constructor(
    private readonly limits: ClientRuntimeLimits,
    private readonly resolveScript: ClientScriptKeyResolver = () => undefined,
  ) {}

  /**
   * Execute one request and preserve its source, generation, session, and request identities.
   * @param frame - Validated command envelope from the Worker.
   * @param signal - Optional cancellation for an operation awaiting user code.
   * @param deferObjectCommit - Keep new object handles provisional until {@link acknowledge}.
   * @returns A success or transport-error response for the same request.
   * @remarks 中文说明：功能说明：执行 execute 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：frame（ClientRuntimeRequestFrame）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：signal（AbortSignal）：传递取消或终止信号；必须满足声明的类型及调用时序要求。；
   * 参数说明：deferObjectCommit（由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。；返回值：Promise<ClientRuntimeResponseFrame>；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 execute(frame, signal,
   * deferObjectCommit)，并按返回类型处理结果。
   */
  async execute(
    frame: ClientRuntimeRequestFrame,
    signal?: AbortSignal,
    deferObjectCommit = false,
  ): Promise<ClientRuntimeResponseFrame> {
    /**
     * 常量说明：session 用于处理 session 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const session = this.session(frame.sessionId)
    /**
     * 常量说明：allocation 用于处理 allocation 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const allocation = session.beginAllocation()
    /**
     * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
     */
    try {
      /**
       * 常量说明：result 用于处理 result 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const result = await session.execute(frame.command, allocation, signal)
      if (signal?.aborted === true) {
        throw new ClientRuntimeExecutionError('timeout', 'Client Runtime request was canceled')
      }
      /**
       * 常量说明：response 用于处理 response 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const response = responseFrame(frame, { ok: true, result })
      if (!isJsonValue(response) || jsonByteLength(response) > this.limits.maxResponseBytes) {
        session.rollback(allocation)
        return responseFrame(frame, {
          ok: false,
          error: { code: 'result-too-large', message: 'Client Runtime result exceeds the source-frame byte limit' },
        })
      }
      if (deferObjectCommit) {
        if (this.responseAllocations.has(frame.requestId)) {
          session.rollback(allocation)
          return responseFrame(frame, {
            ok: false,
            error: { code: 'invalid-request', message: 'Client Runtime request id is already pending' },
          })
        }
        this.responseAllocations.set(frame.requestId, { sessionId: frame.sessionId, session, allocation })
      } else {
        session.commitAllocation(allocation)
      }
      return response
    } catch (error) {
      session.rollback(allocation)
      return responseFrame(frame, { ok: false, error: runtimeError(error) })
    }
  }

  /**
   * Commit handles after the Worker accepts one Runtime response.
   * @param sessionId - Session that owns the response.
   * @param requestId - Correlation id acknowledged by the Worker.
   * @remarks 中文说明：功能说明：处理 acknowledge 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：sessionId（ClientRuntimeSessionId）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：requestId（ClientRuntimeRequestId）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。；
   * 返回值：void；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * acknowledge(sessionId, requestId)，并按返回类型处理结果。
   */
  acknowledge(sessionId: ClientRuntimeSessionId, requestId: ClientRuntimeRequestId): void {
    /**
     * 常量说明：pending 用于处理 pending 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const pending = this.responseAllocations.get(requestId)
    if (pending === undefined || pending.sessionId !== sessionId) return
    this.responseAllocations.delete(requestId)
    pending.session.commitAllocation(pending.allocation)
  }

  /**
   * Roll back handles from a canceled or otherwise unaccepted Runtime response.
   * @param sessionId - Session that owns the response.
   * @param requestId - Correlation id rejected by the Worker.
   * @remarks 中文说明：功能说明：处理 cancel 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：sessionId（ClientRuntimeSessionId）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：requestId（ClientRuntimeRequestId）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。；
   * 返回值：void；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * cancel(sessionId, requestId)，并按返回类型处理结果。
   */
  cancel(sessionId: ClientRuntimeSessionId, requestId: ClientRuntimeRequestId): void {
    /**
     * 常量说明：pending 用于处理 pending 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const pending = this.responseAllocations.get(requestId)
    if (pending === undefined || pending.sessionId !== sessionId) return
    this.responseAllocations.delete(requestId)
    pending.session.rollback(pending.allocation)
  }

  /**
   * Release all values retained for one closed DevTools connection.
   * @param sessionId - Runtime session owned by that DevTools connection.
   * @remarks 中文说明：功能说明：关闭 Session 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：sessionId（ClientRuntimeSessionId）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：void；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * closeSession(sessionId)，并按返回类型处理结果。
   */
  closeSession(sessionId: ClientRuntimeSessionId): void {
    /**
     * 变量说明：requestId、pending 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const [requestId, pending] of this.responseAllocations) {
      if (pending.sessionId === sessionId) this.responseAllocations.delete(requestId)
    }
    this.sessions.get(sessionId)?.close()
    this.sessions.delete(sessionId)
  }

  /**
   * Release one object group without closing the surrounding Runtime session.
   * @param sessionId - Session that owns the retained objects.
   * @param group - Object-group name to release.
   * @remarks 中文说明：功能说明：处理 releaseObjectGroup 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：sessionId（ClientRuntimeSessionId）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：group（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 releaseObjectGroup(sessionId, group)，
   * 并按返回类型处理结果。
   */
  releaseObjectGroup(sessionId: ClientRuntimeSessionId, group: string): void {
    this.sessions.get(sessionId)?.releaseObjectGroup(group)
  }

  /**
   * Serialize one Console call for a specific DevTools Runtime session.
   * @param sessionId - Session receiving the Console event.
   * @param type - Console API operation.
   * @param values - Original arguments from the page call.
   * @param timestamp - Epoch timestamp in milliseconds.
   * @param stackTrace - Browser call frames captured before deferred delivery.
   * @returns A wire-safe event whose object handles belong only to this session.
   * @remarks 中文说明：功能说明：处理 consoleEvent 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：sessionId（ClientRuntimeSessionId）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：type（RuntimeConsoleType）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：values（readonly unknown[]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：timestamp（number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：stackTrace（RuntimeStackTrace）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：RuntimeConsoleBackendEvent<ClientRemoteObjectHandle> | undefined；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 consoleEvent(sessionId,
   * type, values, timestamp, stackTrace)，并按返回类型处理结果。
   */
  consoleEvent(
    sessionId: ClientRuntimeSessionId,
    type: RuntimeConsoleType,
    values: readonly unknown[],
    timestamp: number,
    stackTrace?: RuntimeStackTrace,
  ): RuntimeConsoleBackendEvent<ClientRemoteObjectHandle> | undefined {
    /**
     * 常量说明：session 用于处理 session 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const session = this.session(sessionId)
    /**
     * 常量说明：allocation 用于处理 allocation 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const allocation = session.beginAllocation()
    /**
     * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
     */
    try {
      /**
       * 常量说明：event 用于处理 event 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const event: RuntimeConsoleBackendEvent<ClientRemoteObjectHandle> = {
        type: 'console-api',
        event: {
          type,
          arguments: session.serializeAll(values, 'console', allocation),
          timestamp,
          ...(stackTrace === undefined ? {} : { stackTrace }),
        },
      }
      if (!isJsonValue(event) || jsonByteLength(event) + 4_096 > this.limits.maxResponseBytes) {
        session.rollback(allocation)
        return undefined
      }
      session.commitAllocation(allocation)
      return event
    } catch (error) {
      session.rollback(allocation)
      throw error
    }
  }

  /**
   * Serialize one uncaught Client exception for a DevTools Runtime session.
   * @param sessionId - Session receiving the exception event.
   * @param error - Thrown or rejected value.
   * @param timestamp - Epoch timestamp in milliseconds.
   * @param stackTrace - Browser call frames attached to the failure.
   * @returns A wire-safe exception event.
   * @remarks 中文说明：功能说明：处理 exceptionEvent 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：sessionId（ClientRuntimeSessionId）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：error（unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：timestamp（number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：stackTrace（RuntimeStackTrace）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：RuntimeConsoleBackendEvent<ClientRemoteObjectHandle> | undefined；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 exceptionEvent(sessionId,
   * error, timestamp, stackTrace)，并按返回类型处理结果。
   */
  exceptionEvent(
    sessionId: ClientRuntimeSessionId,
    error: unknown,
    timestamp: number,
    stackTrace?: RuntimeStackTrace,
  ): RuntimeConsoleBackendEvent<ClientRemoteObjectHandle> | undefined {
    /**
     * 常量说明：session 用于处理 session 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const session = this.session(sessionId)
    /**
     * 常量说明：allocation 用于处理 allocation 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const allocation = session.beginAllocation()
    /**
     * 变量说明：serializationError 保存当前捕获的异常；使用前应按项目约定缩小其类型。
     */
    try {
      /**
       * 常量说明：event 用于处理 event 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const event: RuntimeConsoleBackendEvent<ClientRemoteObjectHandle> = {
        type: 'exception',
        event: {
          timestamp,
          details: session.describeException(error, 'console', stackTrace, allocation),
        },
      }
      if (!isJsonValue(event) || jsonByteLength(event) + 4_096 > this.limits.maxResponseBytes) {
        session.rollback(allocation)
        return undefined
      }
      session.commitAllocation(allocation)
      return event
    } catch (serializationError) {
      session.rollback(allocation)
      throw serializationError
    }
  }

  /** Release all sessions when a source generation ends or reconnects.
   * @remarks 中文说明：功能说明：处理 reset 相关流程；使用场景由所在模块及调用位置决定。；返回值：void；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 reset()，并按返回类型处理结果。 */
  reset(): void {
    this.responseAllocations.clear()
    /**
     * 变量说明：session 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const session of this.sessions.values()) session.close()
    this.sessions.clear()
  }

  /**
   * 功能说明：处理 session 相关流程；使用场景由所在模块及调用位置决定。
   * @param sessionId （ClientRuntimeSessionId）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns ClientRuntimeSession；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 session(sessionId)，并按返回类型处理结果。
   */
  private session(sessionId: ClientRuntimeSessionId): ClientRuntimeSession {
    /**
     * 变量说明：session 用于处理 session 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let session = this.sessions.get(sessionId)
    if (session === undefined) {
      session = new ClientRuntimeSession(
        this.limits.maxObjectsPerSession,
        this.limits.maxPropertiesPerResult,
        this.resolveScript,
      )
      this.sessions.set(sessionId, session)
    }
    return session
  }
}

/**
 * 类说明：ClientRuntimeSession 用于集中封装 处理 ClientRuntimeSession 相关状态与行为。
 * 核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。
 * 使用场景：由 experimental/inspector 在对应插件或业务生命周期内创建和调用。
 */
class ClientRuntimeSession {
  /**
   * 常量说明：objects 用于处理 objects 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly objects: ClientObjectStore

  /**
   * 功能说明：处理 ClientRuntimeSession 相关流程；使用场景由所在模块及调用位置决定。
   * @param maxObjects （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param maxProperties （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param resolveScript （ClientScriptKeyResolver）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。
   * @returns 当前类实例；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 通过 new ClientRuntimeSession(maxObjects, maxProperties,
   * resolveScript) 创建实例，并在所属生命周期内使用。
   */
  constructor(
    maxObjects: number,
    private readonly maxProperties: number,
    private readonly resolveScript: ClientScriptKeyResolver,
  ) {
    this.objects = new ClientObjectStore(maxObjects)
  }

  /**
   * 功能说明：处理 beginAllocation 相关流程；使用场景由所在模块及调用位置决定。
   * @returns ClientObjectAllocation；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 beginAllocation()，并按返回类型处理结果。
   */
  beginAllocation(): ClientObjectAllocation {
    return this.objects.beginAllocation()
  }

  /**
   * 功能说明：处理 commitAllocation 相关流程；使用场景由所在模块及调用位置决定。
   * @param allocation （ClientObjectAllocation）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 commitAllocation(allocation)，并按返回类型处理结果。
   */
  commitAllocation(allocation: ClientObjectAllocation): void {
    this.objects.commitAllocation(allocation)
  }

  /**
   * 功能说明：处理 rollback 相关流程；使用场景由所在模块及调用位置决定。
   * @param allocation （ClientObjectAllocation）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 rollback(allocation)，并按返回类型处理结果。
   */
  rollback(allocation: ClientObjectAllocation): void {
    this.objects.rollback(allocation)
  }

  /**
   * 功能说明：执行 execute 相关流程；使用场景由所在模块及调用位置决定。
   * @param command （ClientRuntimeCommand）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param allocation （ClientObjectAllocation）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param signal （AbortSignal）：传递取消或终止信号；必须满足声明的类型及调用时序要求。
   * @returns Promise<ClientRuntimeResult>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 execute(command, allocation, signal)，并按返回类型处理结果。
   */
  async execute(
    command: ClientRuntimeCommand,
    allocation: ClientObjectAllocation,
    signal?: AbortSignal,
  ): Promise<ClientRuntimeResult> {
    switch (command.op) {
      case 'evaluate':
        return { op: command.op, completion: await this.evaluate(command, allocation, signal) }
      case 'get-properties': {
        /**
         * 常量说明：result 用于处理 result 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const result = getClientProperties(this.objects, command, this.maxProperties, allocation)
        return { op: command.op, ...result }
      }
      case 'call-function':
        return { op: command.op, completion: await this.callFunction(command, allocation, signal) }
      case 'await-promise':
        return { op: command.op, completion: await this.awaitPromise(command, allocation, signal) }
      case 'release-object':
        this.objects.release(command.handle)
        return { op: command.op }
      case 'release-object-group':
        this.releaseObjectGroup(command.objectGroup)
        return { op: command.op }
      case 'global-lexical-scope-names':
        return { op: command.op, names: [] }
      default:
        return assertNever(command)
    }
  }

  /**
   * 功能说明：关闭 close 相关流程；使用场景由所在模块及调用位置决定。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 close()，并按返回类型处理结果。
   */
  close(): void {
    this.objects.clear()
  }

  /**
   * 功能说明：处理 releaseObjectGroup 相关流程；使用场景由所在模块及调用位置决定。
   * @param group （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 releaseObjectGroup(group)，并按返回类型处理结果。
   */
  releaseObjectGroup(group: string): void {
    this.objects.releaseGroup(group)
  }

  /**
   * 功能说明：序列化 All 相关流程；使用场景由所在模块及调用位置决定。
   * @param values （readonly unknown[]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param group （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param allocation （ClientObjectAllocation）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns ClientRuntimeRemoteObject[]；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 serializeAll(values, group, allocation)，并按返回类型处理结果。
   */
  serializeAll(
    values: readonly unknown[],
    group: string,
    allocation: ClientObjectAllocation,
  ): ClientRuntimeRemoteObject[] {
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：value（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(value)，并按返回类型处理结果。
     */
    return values.map(value => this.objects.serialize(value, { group, generatePreview: true }, allocation))
  }

  /**
   * 功能说明：处理 describeException 相关流程；使用场景由所在模块及调用位置决定。
   * @param error （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param group （string | undefined）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param stackTrace （RuntimeStackTrace）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param allocation （ClientObjectAllocation）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns ClientRuntimeExceptionDetails；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 describeException(error, group, stackTrace,
   * allocation)，并按返回类型处理结果。
   */
  describeException(
    error: unknown,
    group: string | undefined,
    stackTrace?: RuntimeStackTrace,
    allocation?: ClientObjectAllocation,
  ): ClientRuntimeExceptionDetails {
    /**
     * 常量说明：options 用于处理 options 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const options = { ...(group === undefined ? {} : { group }) }
    /**
     * 常量说明：resolvedStackTrace 用于处理 resolvedStackTrace 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const resolvedStackTrace = stackTrace ?? clientErrorStack(error, this.resolveScript)
    /**
     * 常量说明：firstFrame 用于处理 firstFrame 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const firstFrame = resolvedStackTrace?.callFrames[0]
    return {
      text: 'Uncaught',
      lineNumber: firstFrame?.lineNumber ?? 0,
      columnNumber: firstFrame?.columnNumber ?? 0,
      ...(firstFrame === undefined ? clientUrl() : { url: firstFrame.url }),
      ...(resolvedStackTrace === undefined ? {} : { stackTrace: resolvedStackTrace }),
      exception: this.objects.serialize(error, options, allocation),
    }
  }

  /**
   * 功能说明：处理 evaluate 相关流程；使用场景由所在模块及调用位置决定。
   * @param command （Extract<ClientRuntimeCommand, { op: 'evaluate'
   * }>）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param allocation （ClientObjectAllocation）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param signal （AbortSignal）：传递取消或终止信号；必须满足声明的类型及调用时序要求。
   * @returns Promise<ClientRuntimeCompletion>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 evaluate(command, allocation, signal)，并按返回类型处理结果。
   */
  private async evaluate(
    command: Extract<ClientRuntimeCommand, { op: 'evaluate' }>,
    allocation: ClientObjectAllocation,
    signal?: AbortSignal,
  ): Promise<ClientRuntimeCompletion> {
    /**
     * 变量说明：value 用于处理 value 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let value: unknown
    /**
     * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
     */
    try {
      value = globalThis.eval(command.expression) as unknown
      if (command.awaitPromise === true) value = await awaitWithCancellation(value, signal, command.timeoutMs)
    } catch (error) {
      if (error instanceof ClientRuntimeExecutionError) throw error
      return this.exception(error, command.objectGroup, allocation)
    }
    return this.completion(
      value,
      allocation,
      command.objectGroup,
      command.generatePreview,
      command.returnByValue,
    )
  }

  /**
   * 功能说明：处理 callFunction 相关流程；使用场景由所在模块及调用位置决定。
   * @param command （Extract<ClientRuntimeCommand, { op: 'call-function'
   * }>）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param allocation （ClientObjectAllocation）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param signal （AbortSignal）：传递取消或终止信号；必须满足声明的类型及调用时序要求。
   * @returns Promise<ClientRuntimeCompletion>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 callFunction(command, allocation, signal)，并按返回类型处理结果。
   */
  private async callFunction(
    command: Extract<ClientRuntimeCommand, { op: 'call-function' }>,
    allocation: ClientObjectAllocation,
    signal?: AbortSignal,
  ): Promise<ClientRuntimeCompletion> {
    /**
     * 常量说明：receiver 用于处理 receiver 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const receiver = command.receiver === undefined ? globalThis : this.objects.get(command.receiver)
    /**
     * 常量说明：inheritedGroup 用于处理 inheritedGroup 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const inheritedGroup = command.receiver === undefined ? undefined : this.objects.group(command.receiver)
    /**
     * 常量说明：group 用于处理 group 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const group = command.objectGroup ?? inheritedGroup
    /**
     * 常量说明：args 用于处理 args 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：argument（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(argument)，并按返回类型处理结果。
     */
    const args = (command.arguments ?? []).map(argument => this.resolveArgument(argument))
    /**
     * 变量说明：value 用于处理 value 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let value: unknown
    /**
     * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
     */
    try {
      /**
       * 常量说明：fn 用于处理 fn 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const fn = globalThis.eval(`(${command.functionDeclaration}\n)`) as unknown
      if (typeof fn !== 'function') throw new TypeError('functionDeclaration did not evaluate to a function')
      value = Reflect.apply(fn, receiver, args)
      if (command.awaitPromise === true) value = await awaitWithCancellation(value, signal)
    } catch (error) {
      if (error instanceof ClientRuntimeExecutionError) throw error
      return this.exception(error, group, allocation)
    }
    return this.completion(value, allocation, group, command.generatePreview, command.returnByValue)
  }

  /**
   * 功能说明：处理 awaitPromise 相关流程；使用场景由所在模块及调用位置决定。
   * @param command （Extract<ClientRuntimeCommand, { op: 'await-promise'
   * }>）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param allocation （ClientObjectAllocation）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param signal （AbortSignal）：传递取消或终止信号；必须满足声明的类型及调用时序要求。
   * @returns Promise<ClientRuntimeCompletion>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 awaitPromise(command, allocation, signal)，并按返回类型处理结果。
   */
  private async awaitPromise(
    command: Extract<ClientRuntimeCommand, { op: 'await-promise' }>,
    allocation: ClientObjectAllocation,
    signal?: AbortSignal,
  ): Promise<ClientRuntimeCompletion> {
    /**
     * 常量说明：group 用于处理 group 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const group = this.objects.group(command.promise)
    /**
     * 变量说明：value 用于处理 value 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let value: unknown
    /**
     * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
     */
    try {
      value = await awaitWithCancellation(this.objects.get(command.promise), signal)
    } catch (error) {
      if (error instanceof ClientRuntimeExecutionError) throw error
      return this.exception(error, group, allocation)
    }
    return this.completion(value, allocation, group, command.generatePreview, command.returnByValue)
  }

  /**
   * 功能说明：解析 Argument 相关流程；使用场景由所在模块及调用位置决定。
   * @param argument （ClientCallArgument）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns unknown；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 resolveArgument(argument)，并按返回类型处理结果。
   */
  private resolveArgument(argument: ClientCallArgument): unknown {
    switch (argument.kind) {
      case 'value': return argument.value
      case 'object': return this.objects.get(argument.handle)
      case 'undefined': return undefined
      case 'unserializable': return parseUnserializable(argument.value)
      default: return assertNever(argument)
    }
  }

  /**
   * 功能说明：处理 exception 相关流程；使用场景由所在模块及调用位置决定。
   * @param error （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param group （string | undefined）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param allocation （ClientObjectAllocation）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns ClientRuntimeCompletion；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 exception(error, group, allocation)，并按返回类型处理结果。
   */
  private exception(
    error: unknown,
    group: string | undefined,
    allocation: ClientObjectAllocation,
  ): ClientRuntimeCompletion {
    /**
     * 常量说明：options 用于处理 options 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const options = { ...(group === undefined ? {} : { group }) }
    /**
     * 常量说明：details 用于处理 details 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const details = this.describeException(error, group, undefined, allocation)
    return { result: this.objects.serialize(error, options, allocation), exceptionDetails: details }
  }

  /**
   * 功能说明：处理 completion 相关流程；使用场景由所在模块及调用位置决定。
   * @param value （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param allocation （ClientObjectAllocation）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param group （string | undefined）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param generatePreview （boolean | undefined）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。
   * @param returnByValue （boolean | undefined）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns ClientRuntimeCompletion；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 completion(value, allocation, group,
   * generatePreview, returnByValue)，并按返回类型处理结果。
   */
  private completion(
    value: unknown,
    allocation: ClientObjectAllocation,
    group: string | undefined,
    generatePreview: boolean | undefined,
    returnByValue: boolean | undefined,
  ): ClientRuntimeCompletion {
    return {
      result: this.objects.serialize(value, {
        ...(group === undefined ? {} : { group }),
        ...(generatePreview === undefined ? {} : { generatePreview }),
        ...(returnByValue === undefined ? {} : { returnByValue }),
      }, allocation),
    }
  }
}

/**
 * 功能说明：处理 responseFrame 相关流程；使用场景由所在模块及调用位置决定。
 * @param request （ClientRuntimeRequestFrame）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。
 * @param outcome （ClientRuntimeResponseFrame['outcome']）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。
 * @returns ClientRuntimeResponseFrame；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 responseFrame(request, outcome)，并按返回类型处理结果。
 */
function responseFrame(
  request: ClientRuntimeRequestFrame,
  outcome: ClientRuntimeResponseFrame['outcome'],
): ClientRuntimeResponseFrame {
  return {
    v: INSPECTOR_PROTOCOL_VERSION,
    t: 'client-runtime/response',
    sourceId: request.sourceId,
    generation: request.generation,
    sessionId: request.sessionId,
    requestId: request.requestId,
    outcome,
  }
}

/**
 * 功能说明：处理 runtimeError 相关流程；使用场景由所在模块及调用位置决定。
 * @param error （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns ClientRuntimeError；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 runtimeError(error)，并按返回类型处理结果。
 */
function runtimeError(error: unknown): ClientRuntimeError {
  /**
   * 常量说明：code 用于处理 code 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const code = error instanceof ClientRuntimeExecutionError ? error.code : 'internal-error'
  /**
   * 常量说明：message 用于处理 message 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const message = error instanceof Error ? error.message : String(error)
  return { code, message: message.slice(0, MAX_RUNTIME_ERROR_MESSAGE_LENGTH) }
}

/**
 * 功能说明：解析 Unserializable 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns unknown；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 parseUnserializable(value)，并按返回类型处理结果。
 */
function parseUnserializable(value: string): unknown {
  if (value === 'NaN') return Number.NaN
  if (value === 'Infinity') return Number.POSITIVE_INFINITY
  if (value === '-Infinity') return Number.NEGATIVE_INFINITY
  if (value === '-0') return -0
  if (/^-?(?:0|[1-9]\d*)n$/u.test(value)) return BigInt(value.slice(0, -1))
  throw new ClientRuntimeExecutionError('invalid-request', `Unsupported unserializable value ${JSON.stringify(value)}`)
}

/**
 * 功能说明：处理 clientUrl 相关流程；使用场景由所在模块及调用位置决定。
 * @returns { readonly url?: string }；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 clientUrl()，并按返回类型处理结果。
 */
function clientUrl(): { readonly url?: string } {
  /**
   * 常量说明：location 用于处理 location 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const location = Reflect.get(globalThis, 'location') as unknown
  if (typeof location !== 'object' || location === null) return {}
  /**
   * 常量说明：href 用于处理 href 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const href = Reflect.get(location, 'href') as unknown
  return typeof href === 'string' ? { url: href } : {}
}

/**
 * 功能说明：处理 awaitWithCancellation 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param signal （AbortSignal | undefined）：传递取消或终止信号；必须满足声明的类型及调用时序要求。
 * @param timeoutMs （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns Promise<unknown>；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 awaitWithCancellation(value, signal, timeoutMs)，
 * 并按返回类型处理结果。
 */
async function awaitWithCancellation(
  value: unknown,
  signal: AbortSignal | undefined,
  timeoutMs?: number,
): Promise<unknown> {
  if (signal?.aborted === true) throw new ClientRuntimeExecutionError('timeout', 'Client Runtime request was canceled')
  /**
   * 变量说明：timer 用于处理 timer 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let timer: ReturnType<typeof setTimeout> | undefined
  /**
   * 变量说明：onAbort 用于响应 Abort 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let onAbort: (() => void) | undefined
  try {
    /**
     * 常量说明：limits 用于处理 limits 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const limits: Promise<never>[] = []
    if (timeoutMs !== undefined) {
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：_resolve（由 TypeScript
       * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：reject（由 TypeScript
       * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(_resolve, reject)，
       * 并按返回类型处理结果。
       */
      limits.push(new Promise<never>((_resolve, reject) => {
        /**
         * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
         * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
         */
        timer = setTimeout(() => {
          reject(new ClientRuntimeExecutionError('timeout', `Client evaluation exceeded ${String(timeoutMs)}ms`))
        }, timeoutMs)
      }))
    }
    if (signal !== undefined) {
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：_resolve（由 TypeScript
       * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：reject（由 TypeScript
       * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(_resolve, reject)，
       * 并按返回类型处理结果。
       */
      limits.push(new Promise<never>((_resolve, reject) => {
        /**
         * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
         * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
         */
        onAbort = () => { reject(new ClientRuntimeExecutionError('timeout', 'Client Runtime request was canceled')) }
        signal.addEventListener('abort', onAbort, { once: true })
      }))
    }
    return await Promise.race([Promise.resolve(value), ...limits])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
    if (onAbort !== undefined) signal?.removeEventListener('abort', onAbort)
  }
}

/**
 * 功能说明：断言 Never 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （never）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns never；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 assertNever(value)，并按返回类型处理结果。
 */
function assertNever(value: never): never {
  throw new Error(`Unexpected Client Runtime variant: ${JSON.stringify(value)}`)
}
