/**
 * `node:events`: a minimal EventEmitter with the members harness code uses.
 * Emission order and listener identity follow Node; anything beyond the basic
 * on/once/off/emit set throws.
 * @remarks 文件说明：文件职责：实现 experimental/webworker-runtime 中 events 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/webworker-runtime 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 →
 * 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。
 */

type Listener = (...args: unknown[]) => void

/**
 * A `once` wrapper, carrying the listener it stands for. Node publishes the same
 * `listener` member, and `removeListener(event, original)` matches through it, so
 * a caller that registered with `once` can withdraw with the function it wrote.
 */
type OnceWrapper = Listener & { listener: Listener }

/** The `node:events` subset the harness registers on: add, remove, and emit.
 * @remarks 中文说明：类说明：EventEmitter 用于集中封装 处理 EventEmitter 相关状态与行为。；
 * 核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。；使用场景：由
 * experimental/webworker-runtime 在对应插件或业务生命周期内创建和调用。 */
export class EventEmitter {
  /**
   * 常量说明：registry 用于处理 registry 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly registry = new Map<string, Listener[]>()

  /**
   * Register a listener.
   * @param event - event name.
   * @param listener - the listener.
   * @returns this emitter.
   * @remarks 中文说明：功能说明：响应 on 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：event（string）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：listener（Listener）：接收后续状态或事件并执行调用方逻辑；必须满足声明的类型及调用时序要求。；返回值：this；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 on(event, listener)，
   * 并按返回类型处理结果。
   */
  on(event: string, listener: Listener): this {
    /**
     * 常量说明：list 用于列出 list 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const list = this.registry.get(event) ?? []
    list.push(listener)
    this.registry.set(event, list)
    return this
  }

  /**
   * Register a listener removed after its first call.
   * @param event - event name.
   * @param listener - the listener.
   * @returns this emitter.
   * @remarks 中文说明：功能说明：处理 once 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：event（string）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：listener（Listener）：接收后续状态或事件并执行调用方逻辑；必须满足声明的类型及调用时序要求。；返回值：this；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 once(event, listener)，
   * 并按返回类型处理结果。
   */
  once(event: string, listener: Listener): this {
    /**
     * 常量说明：wrapper 用于处理 wrapper 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：args（unknown[]）：提供本次调用所需的数据；
     * 必须满足声明的类型及调用时序要求。；返回值：void；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用
     * 匿名回调(args)，并按返回类型处理结果。
     */
    const wrapper = ((...args: unknown[]): void => {
      this.off(event, wrapper)
      listener(...args)
    }) as OnceWrapper
    wrapper.listener = listener
    return this.on(event, wrapper)
  }

  /**
   * Register a listener ahead of the existing ones.
   * @param event - event name.
   * @param listener - the listener.
   * @returns this emitter.
   * @remarks 中文说明：功能说明：处理 prependListener 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：event（string）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：listener（Listener）：接收后续状态或事件并执行调用方逻辑；必须满足声明的类型及调用时序要求。；返回值：this；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 prependListener(event,
   * listener)，并按返回类型处理结果。
   */
  prependListener(event: string, listener: Listener): this {
    /**
     * 常量说明：list 用于列出 list 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const list = this.registry.get(event) ?? []
    list.unshift(listener)
    this.registry.set(event, list)
    return this
  }

  /**
   * Remove a listener, by the function that was registered or by the one a
   * `once` wrapper stands for.
   * @param event - event name.
   * @param listener - the listener.
   * @returns this emitter.
   * @remarks 中文说明：功能说明：处理 off 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：event（string）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：listener（Listener）：接收后续状态或事件并执行调用方逻辑；必须满足声明的类型及调用时序要求。；返回值：this；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 off(event, listener)，
   * 并按返回类型处理结果。
   */
  off(event: string, listener: Listener): this {
    /**
     * 常量说明：list 用于列出 list 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const list = this.registry.get(event)
    if (list !== undefined) {
      // Last registration first, as Node removes it.
      /**
       * 变量说明：at 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
       */
      for (let at = list.length - 1; at >= 0; at--) {
        /**
         * 常量说明：registered 用于处理 registered 相关数据，作用于当前作用域；初始化后不可重新赋值，
         * 但对象内部是否可变仍由其类型决定。
         */
        const registered = list[at]
        if (registered === listener || (registered as OnceWrapper | undefined)?.listener === listener) {
          list.splice(at, 1)
          break
        }
      }
    }
    return this
  }

  /**
   * Alias of {@link off}.
   * @param event - event name.
   * @param listener - the listener.
   * @returns this emitter.
   * @remarks 中文说明：功能说明：移除 Listener 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：event（string）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：listener（Listener）：接收后续状态或事件并执行调用方逻辑；必须满足声明的类型及调用时序要求。；返回值：this；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 removeListener(event,
   * listener)，并按返回类型处理结果。
   */
  removeListener(event: string, listener: Listener): this {
    return this.off(event, listener)
  }

  /**
   * Drop listeners for one event, or all of them.
   * @param event - event name; omitted clears every event.
   * @returns this emitter.
   * @remarks 中文说明：功能说明：移除 All Listeners 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：event（string）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；返回值：this；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 removeAllListeners(event)，并按返回类型处理结果。
   */
  removeAllListeners(event?: string): this {
    if (event === undefined) this.registry.clear()
    else this.registry.delete(event)
    return this
  }

  /**
   * Emit an event.
   * @param event - event name.
   * @param args - listener arguments.
   * @returns whether any listener ran.
   * @remarks 中文说明：功能说明：发送 emit 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：event（string）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：args（unknown[]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：boolean；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 emit(event, args)，
   * 并按返回类型处理结果。
   */
  emit(event: string, ...args: unknown[]): boolean {
    /**
     * 常量说明：list 用于列出 list 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const list = this.registry.get(event)
    if (list === undefined || list.length === 0) return false
    /**
     * 变量说明：listener 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const listener of [...list]) listener(...args)
    return true
  }

  /**
   * Listeners of one event.
   * @param event - event name.
   * @returns a copy of the listener list.
   * @remarks 中文说明：功能说明：处理 listeners 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：event（string）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；返回值：Listener[]；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 listeners(event)，
   * 并按返回类型处理结果。
   */
  listeners(event: string): Listener[] {
    return [...this.registry.get(event) ?? []]
  }

  /**
   * Listener count of one event.
   * @param event - event name.
   * @returns the count.
   * @remarks 中文说明：功能说明：处理 listenerCount 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：event（string）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；返回值：number；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 listenerCount(event)，
   * 并按返回类型处理结果。
   */
  listenerCount(event: string): number {
    return this.registry.get(event)?.length ?? 0
  }

  /**
   * Node's max-listener knob has no effect here.
   * @returns This emitter, for chaining.
   * @remarks 中文说明：功能说明：设置 Max Listeners 相关流程；使用场景由所在模块及调用位置决定。；返回值：this；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 setMaxListeners()，
   * 并按返回类型处理结果。
   */
  setMaxListeners(): this {
    return this
  }
}

/** CommonJS interop marker: the worker loader hands `default` to default imports (see ./builtins.ts).
 * @remarks 中文说明：常量说明：__esModule 用于处理 __esModule 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
export const __esModule = true

/**
 * The `node:events` declarations this module stands in for. `EventEmitter` keeps
 * this module's own class: Node's declaration carries the promise helpers and
 * statics (`once`, `on`, `getEventListeners`, `errorMonitor`) that no worker
 * caller registers through.
 */
type NodeFace = Partial<Omit<typeof import('node:events'), 'EventEmitter'>> & Record<'EventEmitter', unknown>

/** CommonJS default export: the members `require()` hands a caller of this module. */
export default { EventEmitter } satisfies NodeFace
