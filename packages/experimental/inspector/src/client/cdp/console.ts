/** Client Console observation shared by every active DevTools Runtime session.
 * @remarks 文件说明：文件职责：实现 experimental/inspector 中 console 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/inspector 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。 */

import type { ClientRemoteObjectHandle, ClientRuntimeSessionId } from '../../shared/bridge/ids.ts'
import type { ClientConsoleCapability } from '../../shared/bridge/messages/runtime/index.ts'
import type { RuntimeConsoleBackendEvent, RuntimeConsoleType } from '../../shared/cdp/index.ts'
import type { ClientRuntimeExecutor } from './runtime.ts'
import { captureClientConsoleStack, clientErrorStack, type ClientScriptKeyResolver } from './stack.ts'

/**
 * Describe browser-side Console observation.
 * @returns The Console capability advertised by a browser Client source.
 * @remarks 中文说明：功能说明：处理 consoleBridgeCapability 相关流程；使用场景由所在模块及调用位置决定。；
 * 返回值：ClientConsoleCapability；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 consoleBridgeCapability()，并按返回类型处理结果。
 */
export function consoleBridgeCapability(): ClientConsoleCapability {
  return { type: 'client-console' }
}

/** Receives one Console event whose object handles belong to the given session. */
export type ClientConsoleSink = (
  sessionId: ClientRuntimeSessionId,
  event: RuntimeConsoleBackendEvent<ClientRemoteObjectHandle>,
) => void

/**
 * 常量说明：METHODS 用于处理 METHODS 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const METHODS = [
  ['log', 'log'],
  ['debug', 'debug'],
  ['info', 'info'],
  ['error', 'error'],
  ['warn', 'warning'],
  ['dir', 'dir'],
  ['dirxml', 'dirxml'],
  ['table', 'table'],
  ['trace', 'trace'],
  ['clear', 'clear'],
  ['group', 'startGroup'],
  ['groupCollapsed', 'startGroupCollapsed'],
  ['groupEnd', 'endGroup'],
  ['assert', 'assert'],
  ['profile', 'profile'],
  ['profileEnd', 'profileEnd'],
  ['count', 'count'],
  ['timeEnd', 'timeEnd'],
] as const satisfies readonly (readonly [string, RuntimeConsoleType])[]

type ConsoleMethodName = typeof METHODS[number][0]

interface InstalledMethod {
  readonly name: ConsoleMethodName
  readonly original: (...args: unknown[]) => unknown
  readonly replacement: (...args: unknown[]) => unknown
}

/** Installs one transparent console/error observer and fans out session-local values.
 * @remarks 中文说明：类说明：ClientConsoleObserver 用于集中封装 处理 ClientConsoleObserver
 * 相关状态与行为。；核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。；使用场景：由
 * experimental/inspector 在对应插件或业务生命周期内创建和调用。 */
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
export class ClientConsoleObserver {
  /**
   * 常量说明：sessions 用于处理 sessions 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly sessions = new Set<ClientRuntimeSessionId>()
  /**
   * 常量说明：installed 用于处理 installed 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly installed: InstalledMethod[] = []
  /**
   * 变量说明：active 用于处理 active 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  private active = false
  /**
   * 变量说明：closed 用于处理 closed 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  private closed = false

  /**
   * 功能说明：处理 ClientConsoleObserver 相关流程；使用场景由所在模块及调用位置决定。
   * @param runtime （ClientRuntimeExecutor）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param sink （ClientConsoleSink）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param resolveScript （ClientScriptKeyResolver）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。
   * @returns 当前类实例；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 通过 new ClientConsoleObserver(runtime, sink, resolveScript) 创建实例，
   * 并在所属生命周期内使用。
   */
  constructor(
    private readonly runtime: ClientRuntimeExecutor,
    private readonly sink: ClientConsoleSink,
    private readonly resolveScript: ClientScriptKeyResolver = () => undefined,
  ) {}

  /**
   * Start producing events for one DevTools Runtime session.
   * @param sessionId - Session whose object table retains event arguments.
   * @remarks 中文说明：功能说明：处理 enable 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：sessionId（ClientRuntimeSessionId）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：void；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * enable(sessionId)，并按返回类型处理结果。
   */
  enable(sessionId: ClientRuntimeSessionId): void {
    if (this.closed) return
    this.sessions.add(sessionId)
    if (!this.active) this.install()
  }

  /**
   * Stop producing events and release Console objects for one session.
   * @param sessionId - Session being disabled or closed.
   * @remarks 中文说明：功能说明：处理 disable 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：sessionId（ClientRuntimeSessionId）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：void；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * disable(sessionId)，并按返回类型处理结果。
   */
  disable(sessionId: ClientRuntimeSessionId): void {
    this.sessions.delete(sessionId)
    this.runtime.releaseObjectGroup(sessionId, 'console')
    if (this.sessions.size === 0) this.uninstall()
  }

  /** Restore original browser hooks and clear every active session.
   * @remarks 中文说明：功能说明：关闭 close 相关流程；使用场景由所在模块及调用位置决定。；返回值：void；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 close()，并按返回类型处理结果。 */
  close(): void {
    if (this.closed) return
    this.closed = true
    this.reset()
  }

  /** Stop observing the current source generation while allowing a later reconnect.
   * @remarks 中文说明：功能说明：处理 reset 相关流程；使用场景由所在模块及调用位置决定。；返回值：void；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 reset()，并按返回类型处理结果。 */
  reset(): void {
    this.sessions.clear()
    this.uninstall()
  }

  /**
   * 功能说明：处理 install 相关流程；使用场景由所在模块及调用位置决定。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 install()，并按返回类型处理结果。
   */
  private install(): void {
    this.active = true
    /**
     * 变量说明：name、type 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const [name, type] of METHODS) {
      /**
       * 常量说明：candidate 用于处理 candidate 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const candidate: unknown = Reflect.get(console, name)
      if (typeof candidate !== 'function') continue
      /**
       * 常量说明：original 用于处理 original 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const original = candidate as (...args: unknown[]) => unknown
      /**
       * 常量说明：capture 用于处理 capture 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       * 功能说明：处理 capture 相关流程；使用场景由所在模块及调用位置决定。
       * @param values （readonly unknown[]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
       * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
       * @example 在完成前置校验后调用 capture(values)，并按返回类型处理结果。
       */
      const capture = (values: readonly unknown[]): void => { this.captureConsole(type, values) }
      /**
       * 常量说明：replacement 用于处理 replacement 相关数据，作用于当前作用域；初始化后不可重新赋值，
       * 但对象内部是否可变仍由其类型决定。
       * 功能说明：处理 replacement 相关流程；使用场景由所在模块及调用位置决定。
       * @param this （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
       * @param args （unknown[]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
       * @returns unknown；调用方应按声明类型处理，不应假定未声明的附加状态。
       * @example 在完成前置校验后调用 replacement(this, args)，并按返回类型处理结果。
       */
      const replacement = function (this: unknown, ...args: unknown[]): unknown {
        /**
         * 常量说明：result 用于处理 result 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const result = Reflect.apply(original, this, args)
        /**
         * 常量说明：values 用于处理 values 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const values = name === 'assert' ? args.slice(1) : args
        if (name !== 'assert' || !args[0]) capture(values)
        return result
      }
      if (Reflect.set(console, name, replacement)) this.installed.push({ name, original, replacement })
    }
    addGlobalListener('error', this.onError)
    addGlobalListener('unhandledrejection', this.onUnhandledRejection)
  }

  /**
   * 功能说明：处理 uninstall 相关流程；使用场景由所在模块及调用位置决定。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 uninstall()，并按返回类型处理结果。
   */
  private uninstall(): void {
    if (!this.active) return
    this.active = false
    removeGlobalListener('error', this.onError)
    removeGlobalListener('unhandledrejection', this.onUnhandledRejection)
    /**
     * 变量说明：method 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const method of this.installed.splice(0).reverse()) {
      if (Reflect.get(console, method.name) === method.replacement) Reflect.set(console, method.name, method.original)
    }
  }

  /**
   * 常量说明：onError 用于响应 Error 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   * 功能说明：响应 Error 相关流程；使用场景由所在模块及调用位置决定。
   * @param event （Event）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 onError(event)，并按返回类型处理结果。
   */
  private readonly onError = (event: Event): void => {
    /**
     * 常量说明：error 用于处理 error 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const error = Reflect.get(event, 'error') as unknown
    /**
     * 常量说明：message 用于处理 message 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const message = Reflect.get(event, 'message') as unknown
    this.captureException(error ?? new Error(typeof message === 'string' ? message : 'Client error'))
  }

  /**
   * 常量说明：onUnhandledRejection 用于响应 Unhandled Rejection 相关数据，作用于成员；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   * 功能说明：响应 Unhandled Rejection 相关流程；使用场景由所在模块及调用位置决定。
   * @param event （Event）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 onUnhandledRejection(event)，并按返回类型处理结果。
   */
  private readonly onUnhandledRejection = (event: Event): void => {
    this.captureException(Reflect.get(event, 'reason') as unknown)
  }

  /**
   * 功能说明：处理 captureConsole 相关流程；使用场景由所在模块及调用位置决定。
   * @param type （RuntimeConsoleType）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param values （readonly unknown[]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 captureConsole(type, values)，并按返回类型处理结果。
   */
  private captureConsole(type: RuntimeConsoleType, values: readonly unknown[]): void {
    /**
     * 常量说明：timestamp 用于处理 timestamp 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const timestamp = Date.now()
    /**
     * 常量说明：stackTrace 用于处理 stackTrace 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const stackTrace = captureClientConsoleStack(this.resolveScript)
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    queueMicrotask(() => {
      /**
       * 变量说明：sessionId 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
       */
      for (const sessionId of [...this.sessions]) {
        try {
          /**
           * 常量说明：event 用于处理 event 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
           */
          const event = this.runtime.consoleEvent(sessionId, type, values, timestamp, stackTrace)
          if (event !== undefined) this.sink(sessionId, event)
        } catch {
          // Console observation must not affect the page's original console call.
        }
      }
    })
  }

  /**
   * 功能说明：处理 captureException 相关流程；使用场景由所在模块及调用位置决定。
   * @param error （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 captureException(error)，并按返回类型处理结果。
   */
  private captureException(error: unknown): void {
    /**
     * 常量说明：timestamp 用于处理 timestamp 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const timestamp = Date.now()
    /**
     * 常量说明：stackTrace 用于处理 stackTrace 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const stackTrace = clientErrorStack(error, this.resolveScript)
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    queueMicrotask(() => {
      /**
       * 变量说明：sessionId 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
       */
      for (const sessionId of [...this.sessions]) {
        try {
          /**
           * 常量说明：event 用于处理 event 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
           */
          const event = this.runtime.exceptionEvent(sessionId, error, timestamp, stackTrace)
          if (event !== undefined) this.sink(sessionId, event)
        } catch {
          // Exception observation must not affect browser error dispatch.
        }
      }
    })
  }
}

/**
 * 功能说明：处理 addGlobalListener 相关流程；使用场景由所在模块及调用位置决定。
 * @param type （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param listener （EventListener）：接收后续状态或事件并执行调用方逻辑；必须满足声明的类型及调用时序要求。
 * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 addGlobalListener(type, listener)，并按返回类型处理结果。
 */
function addGlobalListener(type: string, listener: EventListener): void {
  /**
   * 常量说明：add 用于处理 add 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const add = Reflect.get(globalThis, 'addEventListener') as unknown
  if (typeof add === 'function') Reflect.apply(add, globalThis, [type, listener])
}

/**
 * 功能说明：移除 Global Listener 相关流程；使用场景由所在模块及调用位置决定。
 * @param type （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param listener （EventListener）：接收后续状态或事件并执行调用方逻辑；必须满足声明的类型及调用时序要求。
 * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 removeGlobalListener(type, listener)，并按返回类型处理结果。
 */
function removeGlobalListener(type: string, listener: EventListener): void {
  /**
   * 常量说明：remove 用于移除 remove 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const remove = Reflect.get(globalThis, 'removeEventListener') as unknown
  if (typeof remove === 'function') Reflect.apply(remove, globalThis, [type, listener])
}
