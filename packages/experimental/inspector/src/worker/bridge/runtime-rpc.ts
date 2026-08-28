/** Worker-owned routing between synthetic Client contexts and source generations.
 * @remarks 文件说明：文件职责：实现 experimental/inspector 中 runtime rpc 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/inspector 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。 */

import { randomUUID } from 'node:crypto'
import type {
  ClientConsoleEventFrame,
  ClientRuntimeCapability,
  ClientRuntimeCommand,
  ClientRuntimeError,
  ClientRuntimeResponseFrame,
  ClientRuntimeResult,
} from '../../shared/bridge/messages/runtime/index.ts'
import {
  inspectorId,
  type ClientRemoteObjectHandle,
  type ClientRuntimeRequestId,
  type ClientRuntimeSessionId,
} from '../../shared/bridge/ids.ts'
import { INSPECTOR_PROTOCOL_VERSION, type InspectorSourceDescriptor } from '../../shared/bridge/messages/observation.ts'
import { sendClientSessionClosed } from './session.ts'
import type { InspectorSourceEvent, InspectorSourceRegistry } from './hub.ts'
import type { RuntimeConsoleBackendEvent } from '../../shared/cdp/index.ts'

/** One connected projection of a Client realm into a synthetic CDP execution context. */
export interface ClientRuntimeTarget {
  readonly contextId: number
  readonly uniqueContextId: string
  readonly source: InspectorSourceDescriptor
  readonly capability: ClientRuntimeCapability
}

/** Runtime target admission or removal. */
export type ClientRuntimeTargetEvent =
  | { readonly type: 'opened'; readonly target: ClientRuntimeTarget }
  | { readonly type: 'closed'; readonly target: ClientRuntimeTarget }

interface PendingRequest {
  readonly target: ClientRuntimeTarget
  readonly sessionId: ClientRuntimeSessionId
  readonly op: ClientRuntimeCommand['op']
  readonly resolve: (result: ClientRuntimeResult) => void
  readonly reject: (error: Error) => void
  readonly timer: ReturnType<typeof setTimeout>
}

interface ConsoleSubscription {
  readonly target: ClientRuntimeTarget
  readonly sessionId: ClientRuntimeSessionId
  readonly listener: (event: RuntimeConsoleBackendEvent<ClientRemoteObjectHandle>) => void
}

/** Error returned deliberately by the Client Runtime executor.
 * @remarks 中文说明：类说明：ClientRuntimeRemoteError 用于集中封装 处理
 * ClientRuntimeRemoteError 相关状态与行为。；核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。；
 * 使用场景：由 experimental/inspector 在对应插件或业务生命周期内创建和调用。 */
export class ClientRuntimeRemoteError extends Error {
  /**
   * 功能说明：处理 ClientRuntimeRemoteError 相关流程；使用场景由所在模块及调用位置决定。
   * @param code （ClientRuntimeError['code']）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param message （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns 当前类实例；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 通过 new ClientRuntimeRemoteError(code, message) 创建实例，并在所属生命周期内使用。
   */
  constructor(readonly code: ClientRuntimeError['code'], message: string) {
    super(message)
  }
}

/** Runtime context registry and correlated Worker-to-Client request owner.
 * @remarks 中文说明：类说明：ClientRuntimeRouter 用于集中封装 处理 ClientRuntimeRouter
 * 相关状态与行为。；核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。；使用场景：由
 * experimental/inspector 在对应插件或业务生命周期内创建和调用。 */
export class ClientRuntimeRouter {
  /**
   * 常量说明：targetsBySource 用于处理 targetsBySource 相关数据，作用于成员；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  private readonly targetsBySource = new Map<string, ClientRuntimeTarget>()
  /**
   * 常量说明：pending 用于处理 pending 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly pending = new Map<ClientRuntimeRequestId, PendingRequest>()
  /**
   * 常量说明：consoleSubscriptions 用于处理 consoleSubscriptions 相关数据，作用于成员；
   * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly consoleSubscriptions = new Set<ConsoleSubscription>()
  /**
   * 常量说明：listeners 用于处理 listeners 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly listeners = new Set<(event: ClientRuntimeTargetEvent) => void>()
  /**
   * 常量说明：unsubscribeSources 用于处理 unsubscribeSources 相关数据，作用于成员；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  private readonly unsubscribeSources: () => void
  /**
   * 变量说明：nextContextId 用于处理 nextContextId 相关数据，作用于成员；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  private nextContextId = -1
  /**
   * 变量说明：closed 用于处理 closed 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  private closed = false

  /**
   * 功能说明：处理 ClientRuntimeRouter 相关流程；使用场景由所在模块及调用位置决定。
   * @param sources （InspectorSourceRegistry）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param timeoutMs （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns 当前类实例；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 通过 new ClientRuntimeRouter(sources, timeoutMs) 创建实例，并在所属生命周期内使用。
   */
  constructor(private readonly sources: InspectorSourceRegistry, private readonly timeoutMs: number) {
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：event（由 TypeScript
     * 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(event)，并按返回类型处理结果。
     */
    this.unsubscribeSources = sources.subscribeEvents((event) => { this.receiveSourceEvent(event) })
  }

  /**
   * Snapshot all active Client execution contexts.
   * @returns Active targets in admission order.
   * @remarks 中文说明：功能说明：处理 targets 相关流程；使用场景由所在模块及调用位置决定。；
   * 返回值：ClientRuntimeTarget[]；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * targets()，并按返回类型处理结果。
   */
  targets(): ClientRuntimeTarget[] {
    return [...this.targetsBySource.values()]
  }

  /**
   * Resolve the Client target for one active source generation.
   * @param source - Source identity stored with a semantic node.
   * @returns Its active Runtime target, when the generation still matches.
   * @remarks 中文说明：功能说明：处理 bySource 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：source（InspectorSourceDescriptor）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：ClientRuntimeTarget | undefined；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 使用示例：典型用法：在完成前置校验后调用 bySource(source)，并按返回类型处理结果。
   */
  bySource(source: InspectorSourceDescriptor): ClientRuntimeTarget | undefined {
    /**
     * 常量说明：target 用于处理 target 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const target = this.targetsBySource.get(source.sourceId)
    return target?.source.generation === source.generation ? target : undefined
  }

  /**
   * Subscribe to synthetic execution-context lifecycle.
   * @param listener - Context lifecycle observer.
   * @returns A disposer that removes the observer.
   * @remarks 中文说明：功能说明：处理 subscribe 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：listener（(event: ClientRuntimeTargetEvent) =>
   * void）：接收后续状态或事件并执行调用方逻辑；必须满足声明的类型及调用时序要求。；返回值：() => void；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 subscribe(listener)，并按返回类型处理结果。
   */
  subscribe(listener: (event: ClientRuntimeTargetEvent) => void): () => void {
    this.listeners.add(listener)
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    return () => { this.listeners.delete(listener) }
  }

  /**
   * Enable Console events for one Client realm and DevTools session.
   * @param target - Active Client realm.
   * @param sessionId - DevTools Runtime session retaining event arguments.
   * @param listener - Consumer of validated Client Console events.
   * @returns A disposer that disables this Console session.
   * @remarks 中文说明：功能说明：处理 subscribeConsole 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：target（ClientRuntimeTarget）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：sessionId（ClientRuntimeSessionId）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：listener（(event: RuntimeConsoleBackendEvent<ClientRemoteObjectHandl
   * e…）：接收后续状态或事件并执行调用方逻辑；必须满足声明的类型及调用时序要求。；返回值：() => void；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 subscribeConsole(target, sessionId,
   * listener)，并按返回类型处理结果。
   */
  subscribeConsole(
    target: ClientRuntimeTarget,
    sessionId: ClientRuntimeSessionId,
    listener: (event: RuntimeConsoleBackendEvent<ClientRemoteObjectHandle>) => void,
  ): () => void {
    /**
     * 常量说明：subscription 用于处理 subscription 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const subscription: ConsoleSubscription = { target, sessionId, listener }
    if (!this.sources.send(target.source, {
      v: INSPECTOR_PROTOCOL_VERSION,
      t: 'client-console/enable',
      sourceId: target.source.sourceId,
      generation: target.source.generation,
      sessionId,
    })) {
      throw new Error('Client Console source disconnected before enable')
    }
    this.consoleSubscriptions.add(subscription)
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    return () => {
      if (!this.consoleSubscriptions.delete(subscription)) return
      try {
        this.sources.send(target.source, {
          v: INSPECTOR_PROTOCOL_VERSION,
          t: 'client-console/disable',
          sourceId: target.source.sourceId,
          generation: target.source.generation,
          sessionId,
        })
      } catch {
        // Source removal also disables Console observation in the Client.
      }
    }
  }

  /**
   * Execute one typed command in its currently active source generation.
   * @param target - Active Client source and context.
   * @param sessionId - Calling DevTools Runtime session.
   * @param command - Validated Client Runtime operation.
   * @returns The correlated result, or a rejection on timeout or disconnect.
   * @remarks 中文说明：功能说明：处理 request 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：target（ClientRuntimeTarget）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：sessionId（ClientRuntimeSessionId）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：command（ClientRuntimeCommand）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：Promise<ClientRuntimeResult>；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 使用示例：典型用法：在完成前置校验后调用 request(target, sessionId, command)，并按返回类型处理结果。
   */
  request(
    target: ClientRuntimeTarget,
    sessionId: ClientRuntimeSessionId,
    command: ClientRuntimeCommand,
  ): Promise<ClientRuntimeResult> {
    if (this.closed || this.targetsBySource.get(target.source.sourceId) !== target) {
      return Promise.reject(new Error('Client execution context is no longer available'))
    }
    /**
     * 常量说明：requestId 用于处理 requestId 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const requestId = inspectorId<'ClientRuntimeRequestId'>(randomUUID(), 'requestId')
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
        /**
         * 常量说明：pending 用于处理 pending 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const pending = this.pending.get(requestId)
        if (pending === undefined) return
        this.cancelClientResponse(target.source, sessionId, requestId)
        this.rejectPending(requestId, new Error(`Client Runtime ${command.op} timed out after ${String(this.timeoutMs)}ms`))
      }, this.timeoutMs)
      timer.unref()
      this.pending.set(requestId, { target, sessionId, op: command.op, resolve, reject, timer })
      /**
       * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
       */
      try {
        /**
         * 常量说明：sent 用于处理 sent 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const sent = this.sources.send(target.source, {
          v: INSPECTOR_PROTOCOL_VERSION,
          t: 'client-runtime/request',
          sourceId: target.source.sourceId,
          generation: target.source.generation,
          sessionId,
          requestId,
          command,
        })
        if (!sent) this.rejectPending(requestId, new Error('Client execution context disconnected before dispatch'))
      } catch (error) {
        this.rejectPending(requestId, renderError(error))
      }
    })
  }

  /**
   * Close one realm-local Runtime session without notifying sibling Client realms.
   * @param target - Client realm that owns the session.
   * @param sessionId - Closing DevTools Runtime session.
   * @remarks 中文说明：功能说明：关闭 Target Session 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：target（ClientRuntimeTarget）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：sessionId（ClientRuntimeSessionId）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：void；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * closeTargetSession(target, sessionId)，并按返回类型处理结果。
   */
  closeTargetSession(target: ClientRuntimeTarget, sessionId: ClientRuntimeSessionId): void {
    /**
     * 变量说明：requestId、pending 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const [requestId, pending] of this.pending) {
      if (pending.target !== target || pending.sessionId !== sessionId) continue
      this.rejectPending(requestId, new Error('DevTools Runtime session closed'))
    }
    /**
     * 变量说明：subscription 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const subscription of [...this.consoleSubscriptions]) {
      if (subscription.target === target && subscription.sessionId === sessionId) {
        this.consoleSubscriptions.delete(subscription)
      }
    }
    sendClientSessionClosed(this.sources, target.source, {
      v: INSPECTOR_PROTOCOL_VERSION,
      t: 'client-runtime/session-closed',
      sourceId: target.source.sourceId,
      generation: target.source.generation,
      sessionId,
    })
  }

  /** Stop routing and reject every outstanding operation.
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
      this.rejectPending(requestId, new Error('Client Runtime router closed'))
    }
    this.targetsBySource.clear()
    this.consoleSubscriptions.clear()
    this.listeners.clear()
  }

  /**
   * 功能说明：处理 receiveSourceEvent 相关流程；使用场景由所在模块及调用位置决定。
   * @param event （InspectorSourceEvent）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 receiveSourceEvent(event)，并按返回类型处理结果。
   */
  private receiveSourceEvent(event: InspectorSourceEvent): void {
    switch (event.type) {
      case 'opened':
        this.open(event.source)
        return
      case 'closed':
        this.remove(event.source, event.reason)
        return
      case 'client-runtime-response':
        this.settle(event.source, event.frame)
        return
      case 'client-console-event':
        this.consoleEvent(event.source, event.frame)
        return
      case 'client-source-response':
        return
      default:
        assertNever(event)
    }
  }

  /**
   * 功能说明：打开 open 相关流程；使用场景由所在模块及调用位置决定。
   * @param source （InspectorSourceDescriptor）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 open(source)，并按返回类型处理结果。
   */
  private open(source: InspectorSourceDescriptor): void {
    /**
     * 常量说明：capability 用于处理 capability 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：candidate（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：candidate is
     * ClientRuntimeCapability；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用
     * 匿名回调(candidate)，并按返回类型处理结果。
     */
    const capability = source.capabilities.find(
      (candidate): candidate is ClientRuntimeCapability => candidate.type === 'client-runtime',
    )
    if (capability === undefined) return
    /**
     * 常量说明：target 用于处理 target 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const target: ClientRuntimeTarget = {
      contextId: this.nextContextId--,
      uniqueContextId: `dsh-client:${source.sourceId}:${source.generation}`,
      source,
      capability,
    }
    this.targetsBySource.set(source.sourceId, target)
    this.emit({ type: 'opened', target })
  }

  /**
   * 功能说明：移除 remove 相关流程；使用场景由所在模块及调用位置决定。
   * @param source （InspectorSourceDescriptor）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param reason （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 remove(source, reason)，并按返回类型处理结果。
   */
  private remove(source: InspectorSourceDescriptor, reason: string): void {
    /**
     * 常量说明：target 用于处理 target 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const target = this.targetsBySource.get(source.sourceId)
    if (target === undefined || target.source.generation !== source.generation) return
    this.targetsBySource.delete(source.sourceId)
    /**
     * 变量说明：requestId、pending 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const [requestId, pending] of this.pending) {
      if (pending.target !== target) continue
      this.rejectPending(requestId, new Error(`Client execution context closed: ${reason}`))
    }
    /**
     * 变量说明：subscription 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const subscription of [...this.consoleSubscriptions]) {
      if (subscription.target === target) this.consoleSubscriptions.delete(subscription)
    }
    this.emit({ type: 'closed', target })
  }

  /**
   * 功能说明：处理 consoleEvent 相关流程；使用场景由所在模块及调用位置决定。
   * @param source （InspectorSourceDescriptor）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param frame （ClientConsoleEventFrame）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 consoleEvent(source, frame)，并按返回类型处理结果。
   */
  private consoleEvent(source: InspectorSourceDescriptor, frame: ClientConsoleEventFrame): void {
    /**
     * 常量说明：target 用于处理 target 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const target = this.targetsBySource.get(source.sourceId)
    if (target === undefined || target.source.generation !== source.generation) return
    /**
     * 变量说明：subscription 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const subscription of [...this.consoleSubscriptions]) {
      if (subscription.target !== target || subscription.sessionId !== frame.sessionId) continue
      try {
        subscription.listener(frame.event)
      } catch {
        // One DevTools Console session cannot disrupt sibling sessions.
      }
    }
  }

  /**
   * 功能说明：处理 settle 相关流程；使用场景由所在模块及调用位置决定。
   * @param source （InspectorSourceDescriptor）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param frame （ClientRuntimeResponseFrame）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 settle(source, frame)，并按返回类型处理结果。
   */
  private settle(source: InspectorSourceDescriptor, frame: ClientRuntimeResponseFrame): void {
    /**
     * 常量说明：pending 用于处理 pending 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const pending = this.pending.get(frame.requestId)
    if (pending === undefined) {
      this.cancelClientResponse(source, frame.sessionId, frame.requestId)
      return
    }
    if (pending.target.source.sourceId !== source.sourceId
      || pending.target.source.generation !== source.generation
      || pending.sessionId !== frame.sessionId) {
      this.cancelClientResponse(source, frame.sessionId, frame.requestId)
      this.cancelClientResponse(pending.target.source, pending.sessionId, frame.requestId)
      this.rejectPending(frame.requestId, new Error('Client Runtime response correlation mismatch'))
      return
    }
    if (!frame.outcome.ok) {
      this.acknowledgeClientResponse(source, frame.sessionId, frame.requestId)
      this.rejectPending(frame.requestId, new ClientRuntimeRemoteError(frame.outcome.error.code, frame.outcome.error.message))
      return
    }
    if (frame.outcome.result.op !== pending.op) {
      this.cancelClientResponse(source, frame.sessionId, frame.requestId)
      this.rejectPending(frame.requestId, new Error(
        `Client Runtime response op ${frame.outcome.result.op} does not match ${pending.op}`,
      ))
      return
    }
    if (!this.acknowledgeClientResponse(source, frame.sessionId, frame.requestId)) {
      this.rejectPending(frame.requestId, new Error('Client execution context disconnected before acknowledgement'))
      return
    }
    clearTimeout(pending.timer)
    this.pending.delete(frame.requestId)
    pending.resolve(frame.outcome.result)
  }

  /**
   * 功能说明：处理 acknowledgeClientResponse 相关流程；使用场景由所在模块及调用位置决定。
   * @param source （InspectorSourceDescriptor）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param sessionId （ClientRuntimeSessionId）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param requestId （ClientRuntimeRequestId）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。
   * @returns boolean；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 acknowledgeClientResponse(source, sessionId,
   * requestId)，并按返回类型处理结果。
   */
  private acknowledgeClientResponse(
    source: InspectorSourceDescriptor,
    sessionId: ClientRuntimeSessionId,
    requestId: ClientRuntimeRequestId,
  ): boolean {
    try {
      return this.sources.send(source, {
        v: INSPECTOR_PROTOCOL_VERSION,
        t: 'client-runtime/response-acknowledged',
        sourceId: source.sourceId,
        generation: source.generation,
        sessionId,
        requestId,
      })
    } catch {
      // A failed acknowledgement rejects the Worker request; source teardown releases Client handles.
      return false
    }
  }

  /**
   * 功能说明：处理 cancelClientResponse 相关流程；使用场景由所在模块及调用位置决定。
   * @param source （InspectorSourceDescriptor）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param sessionId （ClientRuntimeSessionId）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param requestId （ClientRuntimeRequestId）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 cancelClientResponse(source, sessionId, requestId)，
   * 并按返回类型处理结果。
   */
  private cancelClientResponse(
    source: InspectorSourceDescriptor,
    sessionId: ClientRuntimeSessionId,
    requestId: ClientRuntimeRequestId,
  ): void {
    try {
      this.sources.send(source, {
        v: INSPECTOR_PROTOCOL_VERSION,
        t: 'client-runtime/cancel',
        sourceId: source.sourceId,
        generation: source.generation,
        sessionId,
        requestId,
      })
    } catch {
      // Cancellation settlement does not depend on delivery to a source that may be closing.
    }
  }

  /**
   * 功能说明：处理 rejectPending 相关流程；使用场景由所在模块及调用位置决定。
   * @param requestId （ClientRuntimeRequestId）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。
   * @param error （Error）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 rejectPending(requestId, error)，并按返回类型处理结果。
   */
  private rejectPending(requestId: ClientRuntimeRequestId, error: Error): void {
    /**
     * 常量说明：pending 用于处理 pending 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const pending = this.pending.get(requestId)
    if (pending === undefined) return
    clearTimeout(pending.timer)
    this.pending.delete(requestId)
    pending.reject(error)
  }

  /**
   * 功能说明：发送 emit 相关流程；使用场景由所在模块及调用位置决定。
   * @param event （ClientRuntimeTargetEvent）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 emit(event)，并按返回类型处理结果。
   */
  private emit(event: ClientRuntimeTargetEvent): void {
    /**
     * 变量说明：listener 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const listener of [...this.listeners]) {
      try {
        listener(event)
      } catch {
        // One CDP session cannot disrupt context delivery to another session.
      }
    }
  }
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
