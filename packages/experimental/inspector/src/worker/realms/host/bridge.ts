/** Per-DevTools-connection bridge to the Host main thread's real V8 inspector target.
 * @remarks 文件说明：文件职责：实现 experimental/inspector 中 bridge 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/inspector 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。 */

import { Session } from 'node:inspector'
import type { NativeProtocolNotification } from '../../../shared/cdp/realm.ts'

/** Notification emitted by Node's native inspector session. */
export type HostInspectorNotification = NativeProtocolNotification

interface DynamicInspectorSession {
  /**
   * 功能说明：处理 connectToMainThread 相关流程；使用场景由所在模块及调用位置决定。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 connectToMainThread()，并按返回类型处理结果。
   */
  connectToMainThread(): void
  /**
   * 功能说明：处理 disconnect 相关流程；使用场景由所在模块及调用位置决定。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 disconnect()，并按返回类型处理结果。
   */
  disconnect(): void
  /**
   * 功能说明：响应 on 相关流程；使用场景由所在模块及调用位置决定。
   * @param event （'inspectorNotification'）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。
   * @param listener （(message: HostInspectorNotification) =>
   * void）：接收后续状态或事件并执行调用方逻辑；必须满足声明的类型及调用时序要求。
   * @returns this；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 on(event, listener)，并按返回类型处理结果。
   */
  on(event: 'inspectorNotification', listener: (message: HostInspectorNotification) => void): this
  /**
   * 功能说明：处理 post 相关流程；使用场景由所在模块及调用位置决定。
   * @param method （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param params （Readonly<Record<string, unknown>> |
   * undefined）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param callback （(error: Error | null, result?: Readonly<Record<string,
   * unkn…）：接收后续状态或事件并执行调用方逻辑；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 post(method, params, callback)，并按返回类型处理结果。
   */
  post(
    method: string,
    params: Readonly<Record<string, unknown>> | undefined,
    callback: (error: Error | null, result?: Readonly<Record<string, unknown>>) => void,
  ): void
}

/** Connection-local carrier for requests and notifications from the Host V8 inspector.
 * @remarks 中文说明：类说明：HostInspectorSession 用于集中封装 处理 HostInspectorSession
 * 相关状态与行为。；核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。；使用场景：由
 * experimental/inspector 在对应插件或业务生命周期内创建和调用。 */
export class HostInspectorSession {
  /**
   * 常量说明：session 用于处理 session 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly session = new Session() as unknown as DynamicInspectorSession
  /**
   * 常量说明：listeners 用于处理 listeners 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly listeners = new Set<(message: HostInspectorNotification) => void>()
  /**
   * 变量说明：connected 用于处理 connected 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  private connected = false
  /**
   * 变量说明：failure 用于处理 failure 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  private failure: string | undefined

  /**
   * 功能说明：处理 HostInspectorSession 相关流程；使用场景由所在模块及调用位置决定。
   * @param contextName （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns 当前类实例；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 通过 new HostInspectorSession(contextName) 创建实例，并在所属生命周期内使用。
   */
  constructor(private readonly contextName: string) {
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：message（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(message)，并按返回类型处理结果。
     */
    this.session.on('inspectorNotification', (message) => {
      /**
       * 常量说明：rewritten 用于处理 rewritten 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const rewritten = this.rewriteContextName(message)
      /**
       * 变量说明：listener 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
       */
      for (const listener of [...this.listeners]) {
        try {
          listener(rewritten)
        } catch {
          // One domain subscriber cannot starve notifications for sibling domains.
        }
      }
    })
  }

  /**
   * Subscribe to native inspector notifications.
   * @param listener - Consumer owned by one Worker domain adapter.
   * @returns A disposer removing the consumer.
   * @remarks 中文说明：功能说明：处理 subscribe 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：listener（(message: HostInspectorNotification) =>
   * void）：接收后续状态或事件并执行调用方逻辑；必须满足声明的类型及调用时序要求。；返回值：() => void；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 subscribe(listener)，并按返回类型处理结果。
   */
  subscribe(listener: (message: HostInspectorNotification) => void): () => void {
    this.listeners.add(listener)
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    return () => { this.listeners.delete(listener) }
  }

  /**
   * Execute one Host V8 request for a Worker-owned composite Runtime operation.
   * @param method - CDP method name.
   * @param params - Validated request parameters.
   * @returns The Host inspector result.
   * @remarks 中文说明：功能说明：处理 request 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：method（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：params（Readonly<Record<string, unknown>>）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。；返回值：Promise<Readonly<Record<string, unknown>>>；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 request(method, params)，
   * 并按返回类型处理结果。
   */
  request(method: string, params: Readonly<Record<string, unknown>>): Promise<Readonly<Record<string, unknown>>> {
    /**
     * 常量说明：failure 用于处理 failure 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const failure = this.connect()
    if (failure !== undefined) return Promise.reject(new Error(failure))
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolve（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：reject（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(resolve, reject)，
     * 并按返回类型处理结果。
     */
    return new Promise((resolve, reject) => {
      /**
       * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
       */
      try {
        /**
         * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：error（由 TypeScript
         * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：result（由 TypeScript
         * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
         * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(error, result)，并按返回类型处理结果。
         */
        this.session.post(method, params, (error, result) => {
          if (error !== null) reject(error)
          else resolve(result ?? {})
        })
      } catch (error) {
        reject(new Error(renderError(error)))
      }
    })
  }

  /** Disconnect this DevTools client's V8 session.
   * @remarks 中文说明：功能说明：关闭 close 相关流程；使用场景由所在模块及调用位置决定。；返回值：void；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 close()，并按返回类型处理结果。 */
  close(): void {
    this.listeners.clear()
    if (!this.connected || this.failure !== undefined) return
    this.connected = false
    try {
      this.session.disconnect()
    } catch {
      // The underlying inspector session is already disconnected.
    }
  }

  /**
   * 功能说明：处理 connect 相关流程；使用场景由所在模块及调用位置决定。
   * @returns string | undefined；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 connect()，并按返回类型处理结果。
   */
  private connect(): string | undefined {
    if (this.connected) return this.failure
    this.connected = true
    /**
     * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
     */
    try {
      this.session.connectToMainThread()
    } catch (error) {
      this.failure = `Host V8 inspector is unavailable: ${renderError(error)}`
    }
    return this.failure
  }

  /**
   * 功能说明：处理 rewriteContextName 相关流程；使用场景由所在模块及调用位置决定。
   * @param message （HostInspectorNotification）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns HostInspectorNotification；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 rewriteContextName(message)，并按返回类型处理结果。
   */
  private rewriteContextName(message: HostInspectorNotification): HostInspectorNotification {
    if (message.method !== 'Runtime.executionContextCreated') return message
    /**
     * 常量说明：params 用于处理 params 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const params = message.params
    /**
     * 常量说明：context 用于处理 context 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const context = params?.context
    if (typeof context !== 'object' || context === null) return message
    /**
     * 常量说明：record 用于处理 record 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const record = context as Readonly<Record<string, unknown>>
    /**
     * 常量说明：auxData 用于处理 auxData 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const auxData = record.auxData
    if (typeof auxData !== 'object' || auxData === null || (auxData as Readonly<Record<string, unknown>>).isDefault !== true) {
      return message
    }
    return {
      method: message.method,
      params: {
        ...params,
        context: { ...record, name: this.contextName },
      },
    }
  }
}

/** Serializes accepted native notifications and isolates sibling consumers.
 * @remarks 中文说明：类说明：HostNotificationChannel 用于集中封装 处理
 * HostNotificationChannel 相关状态与行为。；核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。；
 * 使用场景：由 experimental/inspector 在对应插件或业务生命周期内创建和调用。 */
export class HostNotificationChannel<Event> {
  /**
   * 常量说明：listeners 用于处理 listeners 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly listeners = new Set<(event: Event) => void>()
  /**
   * 常量说明：unsubscribe 用于处理 unsubscribe 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly unsubscribe: () => void
  /**
   * 变量说明：delivery 用于处理 delivery 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  private delivery = Promise.resolve()

  /**
   * 功能说明：处理 HostNotificationChannel 相关流程；使用场景由所在模块及调用位置决定。
   * @param target （HostInspectorSession）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param accepts （(message: HostInspectorNotification) =>
   * boolean）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param project （(message: HostInspectorNotification) => Promise<Event |
   * und…）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns 当前类实例；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 通过 new HostNotificationChannel(target, accepts, project) 创建实例，
   * 并在所属生命周期内使用。
   */
  constructor(
    target: HostInspectorSession,
    private readonly accepts: (message: HostInspectorNotification) => boolean,
    private readonly project: (message: HostInspectorNotification) => Promise<Event | undefined>,
  ) {
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：message（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(message)，并按返回类型处理结果。
     */
    this.unsubscribe = target.subscribe((message) => { this.receive(message) })
  }

  /**
   * Subscribe to projected native notifications.
   * @param listener - Consumer invoked in subscription order.
   * @returns A disposer removing the consumer.
   * @remarks 中文说明：功能说明：处理 subscribe 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：listener（(event: Event) => void）：接收后续状态或事件并执行调用方逻辑；必须满足声明的类型及调用时序要求。
   * ；返回值：() => void；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * subscribe(listener)，并按返回类型处理结果。
   */
  subscribe(listener: (event: Event) => void): () => void {
    this.listeners.add(listener)
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    return () => { this.listeners.delete(listener) }
  }

  /** Release the native notification subscription and all consumers.
   * @remarks 中文说明：功能说明：关闭 close 相关流程；使用场景由所在模块及调用位置决定。；返回值：void；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 close()，并按返回类型处理结果。 */
  close(): void {
    this.unsubscribe()
    this.listeners.clear()
  }

  /**
   * 功能说明：处理 receive 相关流程；使用场景由所在模块及调用位置决定。
   * @param message （HostInspectorNotification）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 receive(message)，并按返回类型处理结果。
   */
  private receive(message: HostInspectorNotification): void {
    if (!this.accepts(message)) return
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    this.delivery = this.delivery.then(async () => {
      /**
       * 常量说明：event 用于处理 event 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const event = await this.project(message)
      if (event === undefined) return
      /**
       * 变量说明：listener 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
       */
      for (const listener of [...this.listeners]) {
        try {
          listener(event)
        } catch {
          // One notification consumer cannot prevent delivery to its siblings.
        }
      }
    }).catch(() => {
      // Malformed optional native notifications do not interrupt request handling.
    })
  }
}

/**
 * 功能说明：渲染 Error 相关流程；使用场景由所在模块及调用位置决定。
 * @param error （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns string；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 renderError(error)，并按返回类型处理结果。
 */
function renderError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
