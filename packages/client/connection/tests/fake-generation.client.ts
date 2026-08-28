/** Test-local programmable Connection generation source.
 * @remarks 文件说明：文件职责：验证 client/connection 中 fake generation client
 * 相关行为与失败场景。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。；产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。；
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。；
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。 */
import type { ConnectionGenerationSource } from '../src/client/connection.ts'

type StreamItem = { kind: 'end' } | { kind: 'fail'; error: unknown }

interface StreamConnection {
  /**
   * 功能说明：处理 feed 相关流程；使用场景由所在模块及调用位置决定。
   * @param item （StreamItem）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 feed(item)，并按返回类型处理结果。
   */
  feed(item: StreamItem): void
}

/** Hand-pumped generation source for Connection lifecycle tests.
 * @remarks 中文说明：类说明：FakeGenerationSource 用于集中封装 处理 FakeGenerationSource
 * 相关状态与行为。；核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。；使用场景：由 client/connection
 * 在对应插件或业务生命周期内创建和调用。 */
export class FakeGenerationSource {
  /**
   * 常量说明：connections 用于处理 connections 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly connections: StreamConnection[] = []

  /** When true, the source never reports ready.
   * @remarks 中文说明：变量说明：suppressReady 用于处理 suppressReady 相关数据，作用于成员；
   * 其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。 */
  suppressReady = false

  /** When true, ready callbacks remain parked until the test releases them.
   * @remarks 中文说明：变量说明：holdReady 用于处理 holdReady 相关数据，作用于成员；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。 */
  holdReady = false

  /**
   * 变量说明：heldReady 用于处理 heldReady 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  private heldReady: Array<() => void> = []

  /** Open one generation.
   * @remarks 中文说明：常量说明：source 用于处理 source 相关数据，作用于成员；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。；功能说明：处理 source 相关流程；使用场景由所在模块及调用位置决定。；参数说明：signal（由
   * TypeScript 根据调用位置推断的类型）：传递取消或终止信号；必须满足声明的类型及调用时序要求。；参数说明：ready（由
   * TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript
   * 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 source(signal,
   * ready)，并按返回类型处理结果。 */
  readonly source: ConnectionGenerationSource = (signal, ready) => this.open(signal, ready)

  /** Release every generation currently parked before readiness.
   * @remarks 中文说明：功能说明：处理 releaseReady 相关流程；使用场景由所在模块及调用位置决定。；返回值：void；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 releaseReady()，并按返回类型处理结果。 */
  releaseReady(): void {
    /**
     * 常量说明：held 用于处理 held 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const held = this.heldReady
    this.heldReady = []
    /**
     * 变量说明：fire 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const fire of held) fire()
  }

  /** End every active generation normally.
   * @remarks 中文说明：功能说明：处理 end 相关流程；使用场景由所在模块及调用位置决定。；返回值：void；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 end()，并按返回类型处理结果。 */
  end(): void {
    /**
     * 变量说明：connection 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const connection of [...this.connections]) connection.feed({ kind: 'end' })
  }

  /** Fail every active generation.
   * @remarks 中文说明：功能说明：处理 fail 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：error（unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 fail(error)，并按返回类型处理结果。 */
  fail(error: unknown): void {
    /**
     * 变量说明：connection 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const connection of [...this.connections]) connection.feed({ kind: 'fail', error })
  }

  /** Number of currently active generations.
   * @remarks 中文说明：功能说明：处理 activeCount 相关流程；使用场景由所在模块及调用位置决定。；返回值：number；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 activeCount()，并按返回类型处理结果。 */
  get activeCount(): number {
    return this.connections.length
  }

  /**
   * 功能说明：打开 open 相关流程；使用场景由所在模块及调用位置决定。
   * @param signal （AbortSignal）：传递取消或终止信号；必须满足声明的类型及调用时序要求。
   * @param onReady （(host: { readonly home: string }) => void）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。
   * @returns Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 open(signal, onReady)，并按返回类型处理结果。
   */
  private async open(
    signal: AbortSignal,
    onReady: (host: { readonly home: string }) => void,
  ): Promise<void> {
    /**
     * 常量说明：inbox 用于处理 inbox 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const inbox: StreamItem[] = []
    /**
     * 变量说明：wake 用于处理 wake 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let wake: (() => void) | null = null
    /**
     * 常量说明：connection 用于处理 connection 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：item（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(item)，并按返回类型处理结果。
     */
    const connection: StreamConnection = {
      feed: (item) => {
        inbox.push(item)
        wake?.()
      },
    }
    this.connections.push(connection)
    /**
     * 常量说明：ready 用于处理 ready 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     * 功能说明：处理 ready 相关流程；使用场景由所在模块及调用位置决定。
     * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 ready()，并按返回类型处理结果。
     */
    const ready = (): void => { onReady({ home: '/h' }) }
    if (this.holdReady) this.heldReady.push(ready)
    else if (!this.suppressReady) ready()
    try {
      while (!signal.aborted) {
        while (inbox.length > 0) {
          /**
           * 常量说明：item 用于处理 item 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
           */
          const item = inbox.shift() as StreamItem
          if (item.kind === 'end') return
          if (item.kind === 'fail') throw item.error
        }
        /**
         * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolve（由 TypeScript
         * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
         * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(resolve)，并按返回类型处理结果。
         */
        await new Promise<void>((resolve) => {
          wake = resolve
          /**
           * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
           * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
           */
          signal.addEventListener('abort', () => { resolve() }, { once: true })
        })
        wake = null
      }
    } finally {
      this.connections.splice(this.connections.indexOf(connection), 1)
    }
  }
}
