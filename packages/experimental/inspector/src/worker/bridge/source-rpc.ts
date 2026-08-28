/** Worker-owned request routing for Client read-only source catalogs.
 * @remarks 文件说明：文件职责：实现 experimental/inspector 中 source rpc 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/inspector 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。 */

import { randomUUID } from 'node:crypto'
import type {
  ClientSourceCommand,
  ClientSourceError,
  ClientSourceResponseFrame,
  ClientSourceResult,
} from '../../shared/bridge/messages/sources/index.ts'
import {
  inspectorId,
  type ClientSourceRequestId,
  type ClientSourceSessionId,
} from '../../shared/bridge/ids.ts'
import { INSPECTOR_PROTOCOL_VERSION, type InspectorSourceDescriptor } from '../../shared/bridge/messages/observation.ts'
import { sendClientSessionClosed } from './session.ts'
import type { InspectorSourceEvent, InspectorSourceRegistry } from './hub.ts'

interface PendingSourceRequest {
  readonly source: InspectorSourceDescriptor
  readonly sessionId: ClientSourceSessionId
  readonly command: ClientSourceCommand
  readonly resolve: (result: ClientSourceResult) => void
  readonly reject: (error: Error) => void
  readonly timer: ReturnType<typeof setTimeout>
}

/** Deliberate error returned by the Client source catalog.
 * @remarks 中文说明：类说明：ClientSourceRemoteError 用于集中封装 处理
 * ClientSourceRemoteError 相关状态与行为。；核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。；
 * 使用场景：由 experimental/inspector 在对应插件或业务生命周期内创建和调用。 */
export class ClientSourceRemoteError extends Error {
  /**
   * 功能说明：处理 ClientSourceRemoteError 相关流程；使用场景由所在模块及调用位置决定。
   * @param code （ClientSourceError['code']）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param message （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns 当前类实例；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 通过 new ClientSourceRemoteError(code, message) 创建实例，并在所属生命周期内使用。
   */
  constructor(readonly code: ClientSourceError['code'], message: string) {
    super(message)
  }
}

/** Correlates bounded source requests with one active Client source generation.
 * @remarks 中文说明：类说明：ClientSourceRouter 用于集中封装 处理 ClientSourceRouter
 * 相关状态与行为。；核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。；使用场景：由
 * experimental/inspector 在对应插件或业务生命周期内创建和调用。 */
export class ClientSourceRouter {
  /** Maximum decoded bytes requested in one source-content response.
   * @remarks 中文说明：常量说明：chunkBytes 用于处理 chunkBytes 相关数据，作用于成员；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。 */
  readonly chunkBytes: number
  /**
   * 常量说明：pending 用于处理 pending 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly pending = new Map<ClientSourceRequestId, PendingSourceRequest>()
  /**
   * 常量说明：unsubscribeSources 用于处理 unsubscribeSources 相关数据，作用于成员；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  private readonly unsubscribeSources: () => void
  /**
   * 变量说明：closed 用于处理 closed 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  private closed = false

  /**
   * 功能说明：处理 ClientSourceRouter 相关流程；使用场景由所在模块及调用位置决定。
   * @param sources （InspectorSourceRegistry）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param timeoutMs （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param maxContentBytes （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param maxFrameBytes （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns 当前类实例；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 通过 new ClientSourceRouter(sources, timeoutMs, maxContentBytes,
   * maxFrameBytes) 创建实例，并在所属生命周期内使用。
   */
  constructor(
    private readonly sources: InspectorSourceRegistry,
    private readonly timeoutMs: number,
    readonly maxContentBytes: number,
    maxFrameBytes: number,
  ) {
    this.chunkBytes = Math.max(1, Math.floor((maxFrameBytes - 4_096) * 3 / 4))
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：event（由 TypeScript
     * 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(event)，并按返回类型处理结果。
     */
    this.unsubscribeSources = sources.subscribeEvents((event) => { this.receiveSourceEvent(event) })
  }

  /**
   * Execute one operation against an active Client source generation.
   * @param source - Client source that owns the script catalog.
   * @param sessionId - DevTools connection-local source session.
   * @param command - Validated read-only source command.
   * @returns The correlated result.
   * @remarks 中文说明：功能说明：处理 request 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：source（InspectorSourceDescriptor）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：sessionId（ClientSourceSessionId）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：command（ClientSourceCommand）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：Promise<ClientSourceResult>；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 使用示例：典型用法：在完成前置校验后调用 request(source, sessionId, command)，并按返回类型处理结果。
   */
  request(
    source: InspectorSourceDescriptor,
    sessionId: ClientSourceSessionId,
    command: ClientSourceCommand,
  ): Promise<ClientSourceResult> {
    if (this.closed) return Promise.reject(new Error('Client source router is closed'))
    /**
     * 常量说明：requestId 用于处理 requestId 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const requestId = inspectorId<'ClientSourceRequestId'>(randomUUID(), 'requestId')
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolve（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：reject（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(resolve, reject)，
     * 并按返回类型处理结果。
     */
    return new Promise((resolve, reject) => {
      /**
       * 常量说明：timer 用于处理 timer 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
       */
      const timer = setTimeout(() => {
        this.pending.delete(requestId)
        reject(new Error(`Client source ${command.op} timed out after ${String(this.timeoutMs)}ms`))
      }, this.timeoutMs)
      timer.unref()
      this.pending.set(requestId, { source, sessionId, command, resolve, reject, timer })
      /**
       * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
       */
      try {
        /**
         * 常量说明：sent 用于处理 sent 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const sent = this.sources.send(source, {
          v: INSPECTOR_PROTOCOL_VERSION,
          t: 'client-sources/request',
          sourceId: source.sourceId,
          generation: source.generation,
          sessionId,
          requestId,
          command,
        })
        if (!sent) this.rejectPending(requestId, new Error('Client source disconnected before dispatch'))
      } catch (error) {
        this.rejectPending(requestId, renderError(error))
      }
    })
  }

  /**
   * Reject pending operations and notify one Client source session that it closed.
   * @param source - Source generation owning the session.
   * @param sessionId - Closing source session.
   * @remarks 中文说明：功能说明：关闭 Session 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：source（InspectorSourceDescriptor）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：sessionId（ClientSourceSessionId）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：void；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * closeSession(source, sessionId)，并按返回类型处理结果。
   */
  closeSession(source: InspectorSourceDescriptor, sessionId: ClientSourceSessionId): void {
    /**
     * 变量说明：requestId、pending 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const [requestId, pending] of this.pending) {
      if (pending.source.sourceId !== source.sourceId
        || pending.source.generation !== source.generation
        || pending.sessionId !== sessionId) continue
      this.rejectPending(requestId, new Error('DevTools source session closed'))
    }
    sendClientSessionClosed(this.sources, source, {
      v: INSPECTOR_PROTOCOL_VERSION,
      t: 'client-sources/session-closed',
      sourceId: source.sourceId,
      generation: source.generation,
      sessionId,
    })
  }

  /** Stop routing and reject every outstanding source operation.
   * @remarks 中文说明：功能说明：关闭 close 相关流程；使用场景由所在模块及调用位置决定。；返回值：void；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 close()，并按返回类型处理结果。 */
  close(): void {
    if (this.closed) return
    this.closed = true
    this.unsubscribeSources()
    /**
     * 变量说明：requestId 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const requestId of [...this.pending.keys()]) {
      this.rejectPending(requestId, new Error('Client source router closed'))
    }
  }

  /**
   * 功能说明：处理 receiveSourceEvent 相关流程；使用场景由所在模块及调用位置决定。
   * @param event （InspectorSourceEvent）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 receiveSourceEvent(event)，并按返回类型处理结果。
   */
  private receiveSourceEvent(event: InspectorSourceEvent): void {
    switch (event.type) {
      case 'closed':
        /**
         * 变量说明：requestId、pending 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
         */
        for (const [requestId, pending] of this.pending) {
          if (pending.source.sourceId === event.source.sourceId
            && pending.source.generation === event.source.generation) {
            this.rejectPending(requestId, new Error(`Client source closed: ${event.reason}`))
          }
        }
        return
      case 'client-source-response':
        this.settle(event.source, event.frame)
        return
      case 'opened':
      case 'client-runtime-response':
      case 'client-console-event':
        return
      default:
        assertNever(event)
    }
  }

  /**
   * 功能说明：处理 settle 相关流程；使用场景由所在模块及调用位置决定。
   * @param source （InspectorSourceDescriptor）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param frame （ClientSourceResponseFrame）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 settle(source, frame)，并按返回类型处理结果。
   */
  private settle(source: InspectorSourceDescriptor, frame: ClientSourceResponseFrame): void {
    /**
     * 常量说明：pending 用于处理 pending 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const pending = this.pending.get(frame.requestId)
    if (pending === undefined) return
    if (pending.source.sourceId !== source.sourceId
      || pending.source.generation !== source.generation
      || pending.sessionId !== frame.sessionId) {
      this.rejectPending(frame.requestId, new Error('Client source response correlation mismatch'))
      return
    }
    if (!frame.outcome.ok) {
      this.rejectPending(
        frame.requestId,
        new ClientSourceRemoteError(frame.outcome.error.code, frame.outcome.error.message),
      )
      return
    }
    if (!matchesCommand(pending.command, frame.outcome.result)) {
      this.rejectPending(frame.requestId, new Error('Client source response does not match its request'))
      return
    }
    clearTimeout(pending.timer)
    this.pending.delete(frame.requestId)
    pending.resolve(frame.outcome.result)
  }

  /**
   * 功能说明：处理 rejectPending 相关流程；使用场景由所在模块及调用位置决定。
   * @param requestId （ClientSourceRequestId）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。
   * @param error （Error）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 rejectPending(requestId, error)，并按返回类型处理结果。
   */
  private rejectPending(requestId: ClientSourceRequestId, error: Error): void {
    /**
     * 常量说明：pending 用于处理 pending 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const pending = this.pending.get(requestId)
    if (pending === undefined) return
    clearTimeout(pending.timer)
    this.pending.delete(requestId)
    pending.reject(error)
  }
}

/**
 * 功能说明：处理 matchesCommand 相关流程；使用场景由所在模块及调用位置决定。
 * @param command （ClientSourceCommand）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param result （ClientSourceResult）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns boolean；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 matchesCommand(command, result)，并按返回类型处理结果。
 */
function matchesCommand(command: ClientSourceCommand, result: ClientSourceResult): boolean {
  if (command.op !== result.op) return false
  if (command.op === 'list-scripts' || result.op === 'list-scripts') return true
  return result.scriptKey === command.scriptKey
    && result.content === command.content
    && (!result.available || result.offset === command.offset)
}

/**
 * 功能说明：渲染 Error 相关流程；使用场景由所在模块及调用位置决定。
 * @param error （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns Error；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 renderError(error)，并按返回类型处理结果。
 */
function renderError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

/**
 * 功能说明：断言 Never 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （never）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns never；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 assertNever(value)，并按返回类型处理结果。
 */
function assertNever(value: never): never {
  throw new Error(`Unexpected source event: ${JSON.stringify(value)}`)
}
