/**
 * Runtime the transformed modules call at every suspension point.
 *
 * `pause` snapshots every ambient store and hands back a token that **always
 * fulfills** (a rejection travels inside it); `resume` restores that snapshot as
 * the first thing the resumed frame does, then returns the value or rethrows the
 * error, so both completion paths are causally exact. The state itself belongs to
 * the `node:async_hooks` proxy — this module only moves it.
 *
 * The transform that inserts these calls lives in `transform.ts`.
 * @module @deepseek-ai/dsh-experimental-webworker-runtime/src/polyfill/async-context/als-runtime
 */
/** Snapshot of every ambient store, opaque to this module.
 * @remarks 文件说明：文件职责：实现 experimental/webworker-runtime 中 als runtime 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/webworker-runtime 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 →
 * 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。 */
export type AlsSnapshot = unknown

/** Result of a suspension: a rejection travels inside it, so the token always fulfills. */
export interface AlsToken {
  readonly ok: boolean
  readonly value?: unknown
  readonly error?: unknown
  readonly snapshot: AlsSnapshot
}

/** The state face the rewrite moves snapshots through; the shim owns the state itself. */
export interface AlsCausality {
  /** Capture every instance's current store.
   * @remarks 中文说明：功能说明：处理 snapshot 相关流程；使用场景由所在模块及调用位置决定。；返回值：AlsSnapshot；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 snapshot()，并按返回类型处理结果。 */
  snapshot(): AlsSnapshot
  /** Restore a captured snapshot.
   * @remarks 中文说明：功能说明：处理 restore 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：snapshot（AlsSnapshot）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 restore(snapshot)，
   * 并按返回类型处理结果。 */
  restore(snapshot: AlsSnapshot): void
}

/** Runtime the rewritten modules call; built by {@link createAlsRuntime}. */
export interface AlsRuntime {
  /**
   * 功能说明：处理 pause 相关流程；使用场景由所在模块及调用位置决定。
   * @param value （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns Promise<AlsToken>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 pause(value)，并按返回类型处理结果。
   */
  pause(value: unknown): Promise<AlsToken>
  /**
   * 功能说明：处理 resume 相关流程；使用场景由所在模块及调用位置决定。
   * @param token （AlsToken）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns unknown；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 resume(token)，并按返回类型处理结果。
   */
  resume(token: AlsToken): unknown
  /**
   * 功能说明：处理 snapshot 相关流程；使用场景由所在模块及调用位置决定。
   * @returns AlsSnapshot；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 snapshot()，并按返回类型处理结果。
   */
  snapshot(): AlsSnapshot
  /**
   * 功能说明：处理 afterYield 相关流程；使用场景由所在模块及调用位置决定。
   * @param snapshot （AlsSnapshot）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param sent （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns unknown；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 afterYield(snapshot, sent)，并按返回类型处理结果。
   */
  afterYield(snapshot: AlsSnapshot, sent: unknown): unknown
  /**
   * 功能说明：处理 iterator 相关流程；使用场景由所在模块及调用位置决定。
   * @param value （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns AsyncIterator<unknown>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 iterator(value)，并按返回类型处理结果。
   */
  iterator(value: unknown): AsyncIterator<unknown>
  /**
   * 功能说明：关闭 close 相关流程；使用场景由所在模块及调用位置决定。
   * @param iterator （AsyncIterator<unknown>）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns Promise<unknown>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 close(iterator)，并按返回类型处理结果。
   */
  close(iterator: AsyncIterator<unknown>): Promise<unknown>
}

/**
 * Build the runtime the rewritten code calls.
 * @param causality - Snapshot face from the `node:async_hooks` proxy; omitted
 *   leaves the rewrite inert (it still hops a microtask, but moves no state).
 * @returns Runtime object passed to every module wrapper.
 * @remarks 中文说明：功能说明：创建 Als Runtime 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：causality（AlsCausality）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：AlsRuntime；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * createAlsRuntime(causality)，并按返回类型处理结果。
 */
export function createAlsRuntime(causality?: AlsCausality): AlsRuntime {
  /**
   * 常量说明：snapshot 用于处理 snapshot 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   * 功能说明：处理 snapshot 相关流程；使用场景由所在模块及调用位置决定。
   * @returns AlsSnapshot；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 snapshot()，并按返回类型处理结果。
   */
  const snapshot = (): AlsSnapshot => causality?.snapshot()
  /**
   * 常量说明：restore 用于处理 restore 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   * 功能说明：处理 restore 相关流程；使用场景由所在模块及调用位置决定。
   * @param value （AlsSnapshot）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 restore(value)，并按返回类型处理结果。
   */
  const restore = (value: AlsSnapshot): void => { causality?.restore(value) }
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：value（unknown）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。；返回值：Promise<AlsToken>；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 典型用法：在完成前置校验后调用 匿名回调(value)，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：token（AlsToken）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。；返回值：unknown；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用
   * 匿名回调(token)，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：captured（AlsSnapshot）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。；参数：sent（unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：unknown；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(captured,
   * sent)，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：value（unknown）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。；返回值：AsyncIterator<unknown>；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 典型用法：在完成前置校验后调用 匿名回调(value)，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：iterator（AsyncIterator<unknown>）：
   * 提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：Promise<unknown>；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(iterator)，并按返回类型处理结果。
   */
  return {
    snapshot,
    pause: (value: unknown): Promise<AlsToken> => {
      /**
       * 常量说明：captured 用于处理 captured 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const captured = snapshot()
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：settled（由 TypeScript
       * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(settled)，并按返回类型处理结果。
       */
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：error（unknown）：提供本次调用所需的数据；
       * 必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；
       * 典型用法：在完成前置校验后调用 匿名回调(error)，并按返回类型处理结果。
       */
      return Promise.resolve(value).then(
        settled => ({ ok: true, value: settled, snapshot: captured }),
        (error: unknown) => ({ ok: false, error, snapshot: captured }),
      )
    },
    resume: (token: AlsToken): unknown => {
      restore(token.snapshot)
      if (token.ok) return token.value
      throw token.error
    },
    afterYield: (captured: AlsSnapshot, sent: unknown): unknown => {
      restore(captured)
      return sent
    },
    iterator: (value: unknown): AsyncIterator<unknown> => {
      /**
       * 常量说明：source 用于处理 source 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const source = value as {
        [Symbol.asyncIterator]?: () => AsyncIterator<unknown>
        [Symbol.iterator]?: () => Iterator<unknown, unknown>
      }
      /**
       * 常量说明：asyncFactory 用于处理 asyncFactory 相关数据，作用于当前作用域；初始化后不可重新赋值，
       * 但对象内部是否可变仍由其类型决定。
       */
      const asyncFactory = source[Symbol.asyncIterator]
      if (typeof asyncFactory === 'function') return asyncFactory.call(source)
      /**
       * 常量说明：syncFactory 用于同步 Factory 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const syncFactory = source[Symbol.iterator]
      if (typeof syncFactory !== 'function') {
        throw new TypeError('webworker als: for-await source is neither async nor sync iterable')
      }
      /**
       * 常量说明：inner 用于处理 inner 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const inner = syncFactory.call(source)
      // Async-from-sync: a sync iterator's values may be promises the loop awaits.
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：args（[] | [unknown]）：提供本次调用所需的数据；
       * 必须满足声明的类型及调用时序要求。；返回值：Promise<IteratorResult<unknown>>；调用方应按声明类型处理，
       * 不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(args)，并按返回类型处理结果。
       */
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：sent（unknown）：提供本次调用所需的数据；
       * 必须满足声明的类型及调用时序要求。；返回值：Promise<IteratorResult<unknown>>；调用方应按声明类型处理，
       * 不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(sent)，并按返回类型处理结果。
       */
      return {
        next: async (...args: [] | [unknown]): Promise<IteratorResult<unknown>> => {
          /**
           * 常量说明：step 用于处理 step 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
           */
          const step = inner.next(...args as [unknown])
          return { done: step.done ?? false, value: await step.value }
        },
        return: async (sent?: unknown): Promise<IteratorResult<unknown>> => {
          /**
           * 常量说明：step 用于处理 step 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
           */
          const step = inner.return?.(sent) ?? { done: true, value: undefined }
          return { done: step.done ?? true, value: await step.value }
        },
      } as AsyncIterator<unknown>
    },
    close: async (iterator: AsyncIterator<unknown>): Promise<unknown> => {
      try {
        return await iterator.return?.(undefined)
      } catch {
        // Closing an iterator that already failed has nothing left to release.
        return undefined
      }
    },
  }
}
