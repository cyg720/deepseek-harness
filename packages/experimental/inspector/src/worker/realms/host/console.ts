/** ConsoleBackend implementation over native Node Runtime notifications.
 * @remarks 文件说明：文件职责：实现 experimental/inspector 中 console 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/inspector 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。 */

import type { RuntimeBackendObjectHandle } from '../../../shared/cdp/ids.ts'
import type {
  RuntimeConsoleBackendEvent,
  RuntimeConsoleType,
} from '../../../shared/cdp/index.ts'
import type { HostInspectorSession } from './bridge.ts'
import type { ConsoleBackend } from '../../../shared/cdp/realm.ts'
import { isNativeRecord } from './values.ts'
import { HostNotificationChannel } from './bridge.ts'
import type { HostRuntimeBackend } from './runtime.ts'

/**
 * 常量说明：CONSOLE_TYPES 用于处理 CONSOLE_TYPES 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const CONSOLE_TYPES = new Set<RuntimeConsoleType>([
  'log', 'debug', 'info', 'error', 'warning', 'dir', 'dirxml', 'table', 'trace', 'clear',
  'startGroup', 'startGroupCollapsed', 'endGroup', 'assert', 'profile', 'profileEnd', 'count', 'timeEnd',
])

/** Converts native Runtime notifications to realm-neutral Console events.
 * @remarks 中文说明：类说明：HostConsoleBackend 用于集中封装 处理 HostConsoleBackend
 * 相关状态与行为。；核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。；使用场景：由
 * experimental/inspector 在对应插件或业务生命周期内创建和调用。 */
export class HostConsoleBackend implements ConsoleBackend {
  /**
   * 常量说明：events 用于处理 events 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly events: HostNotificationChannel<RuntimeConsoleBackendEvent<RuntimeBackendObjectHandle>>

  /**
   * 功能说明：处理 HostConsoleBackend 相关流程；使用场景由所在模块及调用位置决定。
   * @param target （HostInspectorSession）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param runtime （HostRuntimeBackend）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns 当前类实例；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 通过 new HostConsoleBackend(target, runtime) 创建实例，并在所属生命周期内使用。
   */
  constructor(
    private readonly target: HostInspectorSession,
    private readonly runtime: HostRuntimeBackend,
  ) {
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：message（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(message)，并按返回类型处理结果。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：message（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(message)，并按返回类型处理结果。
     */
    this.events = new HostNotificationChannel(
      target,
      message => message.method === 'Runtime.consoleAPICalled' || message.method === 'Runtime.exceptionThrown',
      async message => message.method === 'Runtime.consoleAPICalled'
        ? this.consoleEvent(message.params)
        : this.exceptionEvent(message.params),
    )
  }

  /**
   * Subscribe to native Console and exception events.
   * @param listener - Connection-local event consumer.
   * @returns A disposer removing the consumer.
   * @remarks 中文说明：功能说明：处理 subscribe 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：listener（(event: RuntimeConsoleBackendEvent<RuntimeBackendObjectHan
   * d…）：接收后续状态或事件并执行调用方逻辑；必须满足声明的类型及调用时序要求。；返回值：() => void；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 subscribe(listener)，并按返回类型处理结果。
   */
  subscribe(listener: (event: RuntimeConsoleBackendEvent<RuntimeBackendObjectHandle>) => void): () => void {
    return this.events.subscribe(listener)
  }

  /**
   * 功能说明：处理 clear 相关流程；使用场景由所在模块及调用位置决定。
   * @returns Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 clear()，并按返回类型处理结果。
   */
  async clear(): Promise<void> {
    await this.target.request('Runtime.discardConsoleEntries', {})
  }

  /** Release the native notification subscription.
   * @remarks 中文说明：功能说明：关闭 close 相关流程；使用场景由所在模块及调用位置决定。；返回值：void；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 close()，并按返回类型处理结果。 */
  close(): void {
    this.events.close()
  }

  /**
   * 功能说明：处理 consoleEvent 相关流程；使用场景由所在模块及调用位置决定。
   * @param params （Readonly<Record<string, unknown>> |
   * undefined）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns Promise<RuntimeConsoleBackendEvent<RuntimeBackendObjectHandle>
   * | unde…；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 consoleEvent(params)，并按返回类型处理结果。
   */
  private async consoleEvent(
    params: Readonly<Record<string, unknown>> | undefined,
  ): Promise<RuntimeConsoleBackendEvent<RuntimeBackendObjectHandle> | undefined> {
    /**
     * 常量说明：type 用于处理 type 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const type = params?.type
    /**
     * 常量说明：args 用于处理 args 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const args = params?.args
    /**
     * 常量说明：timestamp 用于处理 timestamp 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const timestamp = params?.timestamp
    /**
     * 常量说明：stackTrace 用于处理 stackTrace 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const stackTrace = params?.stackTrace
    if (!CONSOLE_TYPES.has(type as RuntimeConsoleType) || !Array.isArray(args) || typeof timestamp !== 'number') return undefined
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：value（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(value)，并按返回类型处理结果。
     */
    return {
      type: 'console-api',
      event: {
        type: type as RuntimeConsoleType,
        arguments: await Promise.all(args.map(value => this.runtime.remoteObject(value))),
        timestamp,
        ...(typeof params?.executionContextId === 'number' ? { contextId: params.executionContextId } : {}),
        ...(isNativeRecord(stackTrace) ? { stackTrace: this.runtime.stackTrace(stackTrace) } : {}),
      },
    }
  }

  /**
   * 功能说明：处理 exceptionEvent 相关流程；使用场景由所在模块及调用位置决定。
   * @param params （Readonly<Record<string, unknown>> |
   * undefined）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns Promise<RuntimeConsoleBackendEvent<RuntimeBackendObjectHandle>
   * | unde…；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 exceptionEvent(params)，并按返回类型处理结果。
   */
  private async exceptionEvent(
    params: Readonly<Record<string, unknown>> | undefined,
  ): Promise<RuntimeConsoleBackendEvent<RuntimeBackendObjectHandle> | undefined> {
    /**
     * 常量说明：timestamp 用于处理 timestamp 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const timestamp = params?.timestamp
    /**
     * 常量说明：exceptionDetails 用于处理 exceptionDetails 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const exceptionDetails = params?.exceptionDetails
    /**
     * 常量说明：contextId 用于处理 contextId 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const contextId = params?.executionContextId
    if (typeof timestamp !== 'number' || exceptionDetails === undefined) return undefined
    return {
      type: 'exception',
      event: {
        timestamp,
        ...(typeof contextId === 'number' ? { contextId } : {}),
        details: await this.runtime.exceptionDetails(exceptionDetails),
      },
    }
  }
}
