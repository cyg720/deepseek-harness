/** ConsoleBackend over the typed Client Console event transport.
 * @remarks 文件说明：文件职责：实现 experimental/inspector 中 console 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/inspector 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。 */

import type { ClientRuntimeSessionId } from '../../../shared/bridge/ids.ts'
import type { RuntimeBackendObjectHandle } from '../../../shared/cdp/ids.ts'
import type { RuntimeConsoleBackendEvent } from '../../../shared/cdp/index.ts'
import type { ClientRuntimeRouter, ClientRuntimeTarget } from '../../bridge/runtime-rpc.ts'
import type { ConsoleBackend } from '../../../shared/cdp/realm.ts'
import { clientConsoleEvent } from './values.ts'
import type { ClientScriptIdentity } from './scripts.ts'

/** Adapts session-local Client Console events to common Runtime values.
 * @remarks 中文说明：类说明：ClientConsoleBackend 用于集中封装 处理 ClientConsoleBackend
 * 相关状态与行为。；核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。；使用场景：由
 * experimental/inspector 在对应插件或业务生命周期内创建和调用。 */
export class ClientConsoleBackend implements ConsoleBackend {
  /**
   * 常量说明：disposers 用于处理 disposers 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly disposers = new Set<() => void>()

  /**
   * 功能说明：处理 ClientConsoleBackend 相关流程；使用场景由所在模块及调用位置决定。
   * @param target （ClientRuntimeTarget）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param sessionId （ClientRuntimeSessionId）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param router （ClientRuntimeRouter）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param scriptIds （ClientScriptIdentity）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns 当前类实例；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 通过 new ClientConsoleBackend(target, sessionId, router,
   * scriptIds) 创建实例，并在所属生命周期内使用。
   */
  constructor(
    private readonly target: ClientRuntimeTarget,
    private readonly sessionId: ClientRuntimeSessionId,
    private readonly router: ClientRuntimeRouter,
    private readonly scriptIds: ClientScriptIdentity,
  ) {}

  /**
   * 功能说明：处理 subscribe 相关流程；使用场景由所在模块及调用位置决定。
   * @param listener （(event: RuntimeConsoleBackendEvent<RuntimeBackendObject
   * Hand…）：接收后续状态或事件并执行调用方逻辑；必须满足声明的类型及调用时序要求。
   * @returns () => void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 subscribe(listener)，并按返回类型处理结果。
   */
  subscribe(listener: (event: RuntimeConsoleBackendEvent<RuntimeBackendObjectHandle>) => void): () => void {
    /**
     * 常量说明：dispose 用于处理 dispose 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：event（由 TypeScript
     * 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(event)，并按返回类型处理结果。
     */
    const dispose = this.router.subscribeConsole(this.target, this.sessionId, (event) => {
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：scriptKey（由 TypeScript
       * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(scriptKey)，并按返回类型处理结果。
       */
      listener(clientConsoleEvent(event, scriptKey => this.scriptIds.toRuntime(scriptKey)))
    })
    this.disposers.add(dispose)
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    return () => {
      if (!this.disposers.delete(dispose)) return
      dispose()
    }
  }

  /**
   * 功能说明：处理 clear 相关流程；使用场景由所在模块及调用位置决定。
   * @returns Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 clear()，并按返回类型处理结果。
   */
  async clear(): Promise<void> {}

  /** Disable every active Console subscription for this connection.
   * @remarks 中文说明：功能说明：关闭 close 相关流程；使用场景由所在模块及调用位置决定。；返回值：void；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 close()，并按返回类型处理结果。 */
  close(): void {
    /**
     * 变量说明：dispose 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const dispose of this.disposers) dispose()
    this.disposers.clear()
  }
}
