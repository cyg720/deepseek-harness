/** Failure containment and shutdown coordination for the Inspector Worker.
 * @remarks 文件说明：文件职责：实现 experimental/inspector 中 lifecycle 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/inspector 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。 */

import type { Worker } from 'node:worker_threads'
import type { InspectorHostControl, InspectorWorkerControl } from '../../shared/bridge/messages/control.ts'
import { parseInspectorWorkerControl } from '../../shared/bridge/control-codec.ts'

/** Tracks Worker termination without removing the listener that contains runtime errors.
 * @remarks 中文说明：类说明：InspectorWorkerLifecycle 用于集中封装 处理
 * InspectorWorkerLifecycle 相关状态与行为。；核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。；
 * 使用场景：由 experimental/inspector 在对应插件或业务生命周期内创建和调用。 */
export class InspectorWorkerLifecycle {
  /**
   * 常量说明：exitResolution 用于处理 exitResolution 相关数据，作用于成员；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  private readonly exitResolution = Promise.withResolvers<number>()
  /**
   * 常量说明：failureResolution 用于处理 failureResolution 相关数据，作用于成员；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  private readonly failureResolution = Promise.withResolvers<Error>()
  /**
   * 变量说明：failure 用于处理 failure 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  private failure: Error | undefined
  /**
   * 变量说明：running 用于处理 running 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  private running = false
  /**
   * 变量说明：expectedExit 用于处理 expectedExit 相关数据，作用于成员；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  private expectedExit = false
  /**
   * 变量说明：notified 用于处理 notified 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  private notified = false
  /**
   * 变量说明：onUnexpectedExit 用于响应 Unexpected Exit 相关数据，作用于成员；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  private onUnexpectedExit: ((error: Error) => void) | undefined
  /**
   * 变量说明：exitCodeValue 用于处理 exitCodeValue 相关数据，作用于成员；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  private exitCodeValue: number | undefined

  /** Worker exit code once its `exit` event has fired.
   * @remarks 中文说明：功能说明：处理 exitCode 相关流程；使用场景由所在模块及调用位置决定。；返回值：number |
   * undefined；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 exitCode()，
   * 并按返回类型处理结果。 */
  get exitCode(): number | undefined {
    return this.exitCodeValue
  }

  /**
   * 功能说明：处理 InspectorWorkerLifecycle 相关流程；使用场景由所在模块及调用位置决定。
   * @param worker （Worker）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns 当前类实例；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 通过 new InspectorWorkerLifecycle(worker) 创建实例，并在所属生命周期内使用。
   */
  constructor(private readonly worker: Worker) {
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：error（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(error)，并按返回类型处理结果。
     */
    worker.on('error', (error) => {
      this.failure ??= error
      this.failureResolution.resolve(error)
      this.notifyUnexpectedExit()
    })
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：code（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(code)，并按返回类型处理结果。
     */
    worker.once('exit', (code) => {
      this.exitCodeValue = code
      this.exitResolution.resolve(code)
      this.notifyUnexpectedExit()
    })
  }

  /**
   * Wait for the validated ready frame while also observing startup failure and exit.
   * @param timeoutMs - Readiness deadline in milliseconds.
   * @returns The Worker's bound endpoint fields.
   * @remarks 中文说明：功能说明：处理 waitForReady 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：timeoutMs（number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：Promise<Extract<InspectorWorkerControl, { type: 'ready' }>>；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 waitForReady(timeoutMs)，
   * 并按返回类型处理结果。
   */
  async waitForReady(timeoutMs: number): Promise<Extract<InspectorWorkerControl, { type: 'ready' }>> {
    /**
     * 变量说明：timer 用于处理 timer 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let timer: NodeJS.Timeout | undefined
    /**
     * 变量说明：onMessage 用于响应 Message 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let onMessage: ((value: unknown) => void) | undefined
    /**
     * 常量说明：message 用于处理 message 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolve（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：reject（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(resolve, reject)，
     * 并按返回类型处理结果。
     */
    const message = new Promise<Extract<InspectorWorkerControl, { type: 'ready' }>>((resolve, reject) => {
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：value（unknown）：提供本次调用所需的数据；
       * 必须满足声明的类型及调用时序要求。；返回值：void；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用
       * 匿名回调(value)，并按返回类型处理结果。
       */
      onMessage = (value: unknown): void => {
        /**
         * 变量说明：control 用于处理 control 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
         */
        let control: InspectorWorkerControl
        /**
         * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
         */
        try {
          control = parseInspectorWorkerControl(value)
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)))
          return
        }
        if (control.type === 'ready') resolve(control)
        else if (control.type === 'failure') reject(new Error(`inspector Worker failed: ${control.message}`))
      }
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
       */
      timer = setTimeout(() => {
        reject(new Error(`inspector Worker did not become ready within ${String(timeoutMs)}ms`))
      }, timeoutMs)
      this.worker.on('message', onMessage)
    })
    try {
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：error（由 TypeScript
       * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(error)，并按返回类型处理结果。
       */
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：code（由 TypeScript
       * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(code)，并按返回类型处理结果。
       */
      return await Promise.race([
        message,
        this.failureResolution.promise.then((error) => { throw error }),
        this.exitResolution.promise.then((code) => {
          throw new Error(`inspector Worker exited before readiness (code ${String(code)})`)
        }),
      ])
    } finally {
      if (timer !== undefined) clearTimeout(timer)
      if (onMessage !== undefined) this.worker.off('message', onMessage)
    }
  }

  /**
   * Begin reporting an unexpected runtime exit through one contained callback.
   * @param listener - Failure observer that must not throw.
   * @remarks 中文说明：功能说明：处理 markRunning 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：listener（(error: Error) => void）：接收后续状态或事件并执行调用方逻辑；必须满足声明的类型及调用时序要求。
   * ；返回值：void；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * markRunning(listener)，并按返回类型处理结果。
   */
  markRunning(listener: (error: Error) => void): void {
    this.running = true
    this.onUnexpectedExit = listener
    this.notifyUnexpectedExit()
  }

  /** Mark subsequent Worker termination as owner-requested.
   * @remarks 中文说明：功能说明：处理 expectExit 相关流程；使用场景由所在模块及调用位置决定。；返回值：void；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 expectExit()，并按返回类型处理结果。 */
  expectExit(): void {
    this.expectedExit = true
  }

  /** Terminate the Worker during failed initialization.
   * @remarks 中文说明：功能说明：处理 terminate 相关流程；使用场景由所在模块及调用位置决定。；返回值：Promise<void>；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 terminate()，并按返回类型处理结果。 */
  async terminate(): Promise<void> {
    this.expectExit()
    if (this.exitCodeValue === undefined) await this.worker.terminate()
  }

  /**
   * Request graceful shutdown and terminate after the deadline.
   * @param timeoutMs - Grace period before forced termination.
   * @remarks 中文说明：功能说明：停止 stop 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：timeoutMs（number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：Promise<void>；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 stop(timeoutMs)，
   * 并按返回类型处理结果。
   */
  async stop(timeoutMs: number): Promise<void> {
    this.expectExit()
    if (this.exitCodeValue !== undefined) return
    this.worker.postMessage({ type: 'shutdown' } satisfies InspectorHostControl)
    /**
     * 变量说明：timer 用于处理 timer 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let timer: NodeJS.Timeout | undefined
    /**
     * 常量说明：timeout 用于处理 timeout 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolve（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(resolve)，并按返回类型处理结果。
     */
    const timeout = new Promise<'timeout'>((resolve) => {
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
       */
      timer = setTimeout(() => { resolve('timeout') }, timeoutMs)
    })
    /**
     * 常量说明：outcome 用于处理 outcome 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    const outcome = await Promise.race([
      this.exitResolution.promise.then(() => 'exited' as const),
      timeout,
    ])
    if (timer !== undefined) clearTimeout(timer)
    if (outcome === 'exited') return
    await this.worker.terminate()
    throw new Error(`inspector Worker did not stop within ${String(timeoutMs)}ms and was terminated`)
  }

  /**
   * 功能说明：处理 notifyUnexpectedExit 相关流程；使用场景由所在模块及调用位置决定。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 notifyUnexpectedExit()，并按返回类型处理结果。
   */
  private notifyUnexpectedExit(): void {
    if (!this.running || this.expectedExit || this.notified || this.exitCodeValue === undefined) return
    this.notified = true
    this.onUnexpectedExit?.(this.failure ?? new Error(
      `inspector Worker exited unexpectedly with code ${String(this.exitCodeValue)}`,
    ))
  }
}
