/**
 * `node:async_hooks` for the worker: `AsyncLocalStorage` over an EXPLICIT-SWITCH
 * model with two fallbacks. A browser has no async-context tracking, so the store
 * a read answers is decided by three slots, in this order:
 *
 * 1. HOOK OVERLAY — set for the duration of one callback by the hook layer
 *    (`./async-context-hooks.ts`), which captures the context where a callback was
 *    REGISTERED (`.then`, `queueMicrotask`, timers, `fetch`) and restores it where
 *    the callback RUNS.
 * 2. RESUMED CONTEXT — the explicit-switch slot. {@link __snapshotAll} copies every
 *    live instance's effective store and {@link __restoreAll} publishes a copy; the
 *    module loader's `await` rewriting pauses with the first and resumes with the
 *    second, which is what makes attribution causally correct across an `await`
 *    even while another chain interleaves. The rewriter's `restore` returns nothing,
 *    so this slot holds ONE value per instance and a resume REPLACES it rather than
 *    stacking: a frame that resumes again at its next await re-publishes its own
 *    context anyway, and a new `run()` boundary shadows the slot for its extent.
 *    (Callers that want scoping get a disposer back from {@link __restoreAll}.)
 * 2b. BOUNDARY AMBIENT — `run()` also publishes its own store here, so rewritten and
 *    un-rewritten code agree on what the innermost boundary is.
 * 3. FOLDING STACK — the fallback for code the rewriter has not touched: `run()`
 *    pushes an entry that is removed synchronously for a synchronous operation, or
 *    when the returned promise settles for an asynchronous one, so a store stays
 *    visible across `await` inside that operation.
 *
 * Every slot is removed by IDENTITY, never blindly: boundaries settle and frames
 * resume out of order, so a blind pop would drop somebody else's context — and a
 * slot that is released while shadowed must leave the chain without promoting
 * itself back over whoever came after it. The three slots are separate for the same reason — a restored
 * copy pushed onto the folding stack could unwind another boundary's entry.
 *
 * A snapshot with no stores at all is `undefined`, and the hook layer then wraps
 * nothing: a callback registered outside every boundary keeps inheriting the
 * enclosing boundary rather than being masked to `undefined`. `__snapshotAll` is
 * the transformer-facing counterpart and always captures every instance, including
 * the ones reading `undefined`, because a resumed frame must see exactly what it
 * saw at its pause point.
 *
 * BOUNDARY (structural, documented rather than worked around): native
 * `async`/`await` resumption inside code the rewriter has NOT transformed is
 * invisible to user code. Such a frame falls back to the folding stack, which is
 * ordered by nesting rather than by causal chain, so two boundaries overlapping
 * there can attribute to the wrong one. Nothing crashes, the stacks still unwind by
 * identity, and everything the hook layer or the rewriter covers is exact.
 * @remarks 文件说明：文件职责：实现 experimental/webworker-runtime 中 async hooks 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/webworker-runtime 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 →
 * 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。
 */
import { notImplementedFail } from '../../notImplementedFail.ts'

interface Entry<T> {
  readonly store: T | undefined
}

interface Overlay<T> {
  readonly store: T | undefined
}

/** Pristine `then`, so this module's own bookkeeping never re-enters the hook layer.
 * @remarks 中文说明：常量说明：nativeThen 用于处理 nativeThen 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
// eslint-disable-next-line @typescript-eslint/unbound-method -- taking `then` unbound is the point; it is `.call`ed on its own promise
const nativeThen = Promise.prototype.then

/** Every live instance, so one snapshot can capture all of their stores at once.
 * @remarks 中文说明：常量说明：instances 用于处理 instances 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
const instances = new Set<AsyncLocalStorage<unknown>>()

/**
 * 功能说明：判断是否为 Thenable 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns value is PromiseLike<unknown>；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 isThenable(value)，并按返回类型处理结果。
 */
function isThenable(value: unknown): value is PromiseLike<unknown> {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return false
  return typeof (value as { then?: unknown }).then === 'function'
}

/** Node's AsyncLocalStorage face, restricted to the members the host tree uses.
 * @remarks 中文说明：类说明：AsyncLocalStorage 用于集中封装 处理 AsyncLocalStorage 相关状态与行为。；
 * 核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。；使用场景：由
 * experimental/webworker-runtime 在对应插件或业务生命周期内创建和调用。 */
export class AsyncLocalStorage<T> {
  /**
   * 常量说明：entries 用于处理 entries 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly entries: Entry<T>[] = []
  /**
   * 变量说明：overlay 用于处理 overlay 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  private overlay: Overlay<T> | undefined
  /**
   * 常量说明：ambients 用于处理 ambients 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly ambients: Overlay<T>[] = []
  /**
   * 变量说明：resumed 用于处理 resumed 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  private resumed: Overlay<T> | undefined

  /**
   * 功能说明：处理 AsyncLocalStorage 相关流程；使用场景由所在模块及调用位置决定。
   * @returns 当前类实例；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 通过 new AsyncLocalStorage() 创建实例，并在所属生命周期内使用。
   */
  constructor() {
    instances.add(this)
  }

  /**
   * Run a callback with the store visible for the operation's whole lifetime:
   * until it returns, or until the promise it returned settles.
   * @param store - value {@link getStore} answers inside the boundary.
   * @param callback - the operation.
   * @param args - callback arguments.
   * @returns the exact value the callback returned.
   * @remarks 中文说明：功能说明：执行 run 相关流程；使用场景由所在模块及调用位置决定。；参数说明：store（T |
   * undefined）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数说明：callback（(...args:
   * never[]) => R）：接收后续状态或事件并执行调用方逻辑；必须满足声明的类型及调用时序要求。；
   * 参数说明：args（never[]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：R；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 run(store, callback, args)，并按返回类型处理结果。
   */
  run<R>(store: T | undefined, callback: (...args: never[]) => R, ...args: never[]): R {
    /**
     * 常量说明：entry 用于处理 entry 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const entry: Entry<T> = { store }
    this.entries.push(entry)
    // Removal is by entry identity: overlapping boundaries settle out of order,
    // and a blind pop would drop somebody else's entry.
    /**
     * 常量说明：remove 用于移除 remove 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     * 功能说明：移除 remove 相关流程；使用场景由所在模块及调用位置决定。
     * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 remove()，并按返回类型处理结果。
     */
    const remove = (): void => {
      /**
       * 常量说明：at 用于处理 at 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const at = this.entries.lastIndexOf(entry)
      if (at !== -1) this.entries.splice(at, 1)
    }
    // The boundary also publishes an ambient slot until its entry goes away.
    // Removal is by identity here too: a shadowed slot must leave the chain
    // without promoting itself back over whoever came after it.
    /**
     * 常量说明：ambient 用于处理 ambient 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const ambient: Overlay<T> = { store }
    this.ambients.push(ambient)
    /**
     * 常量说明：removeBoundary 用于移除 Boundary 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     * 功能说明：移除 Boundary 相关流程；使用场景由所在模块及调用位置决定。
     * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 removeBoundary()，并按返回类型处理结果。
     */
    const removeBoundary = (): void => {
      /**
       * 常量说明：at 用于处理 at 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const at = this.ambients.lastIndexOf(ambient)
      if (at !== -1) this.ambients.splice(at, 1)
      if (this.resumed === undefined) this.resumed = restoreResumed
      remove()
    }
    // A boundary opened under an overlay or a resumed context (a hook-restored
    // callback, or a rewritten frame, that starts a new run) must not keep reading
    // them: its own entry is the truth.
    /**
     * 常量说明：restoreOverlay 用于处理 restoreOverlay 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const restoreOverlay = this.overlay
    /**
     * 常量说明：restoreResumed 用于处理 restoreResumed 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const restoreResumed = this.resumed
    this.overlay = undefined
    this.resumed = undefined
    /**
     * 变量说明：result 用于处理 result 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let result: R
    /**
     * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
     */
    try {
      result = callback(...args)
    } catch (error) {
      this.overlay = restoreOverlay
      removeBoundary()
      throw error
    }
    this.overlay = restoreOverlay
    if (!isThenable(result)) {
      removeBoundary()
      return result
    }
    try {
      // `then.call` on the caller's own promise: no species construction, and the
      // rejection stays the caller's to observe (both handlers are attached, so
      // this observation never becomes an unhandled rejection itself).
      void nativeThen.call(result, removeBoundary, removeBoundary)
    } catch {
      // A branded promise may expose a failing @@species; the boundary then ends
      // here rather than leaking an entry that nothing would ever remove.
      removeBoundary()
    }
    return result
  }

  /**
   * Current store, resolved through the slot order this module documents: the
   * hook-restored overlay, then the ambient context a resume installed (or a
   * boundary owns), then the folding stack's innermost entry.
   * @returns the store, or undefined outside every boundary.
   * @remarks 中文说明：功能说明：获取 Store 相关流程；使用场景由所在模块及调用位置决定。；返回值：T | undefined；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 getStore()，并按返回类型处理结果。
   */
  getStore(): T | undefined {
    if (this.overlay !== undefined) return this.overlay.store
    if (this.resumed !== undefined) return this.resumed.store
    /**
     * 常量说明：ambient 用于处理 ambient 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const ambient = this.ambients.at(-1)
    if (ambient !== undefined) return ambient.store
    return this.entries.at(-1)?.store
  }

  /**
   * Run a callback with no store, folding over its lifetime like {@link run}.
   * @param callback - the operation.
   * @param args - callback arguments.
   * @returns the exact value the callback returned.
   * @remarks 中文说明：功能说明：处理 exit 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：callback（(...args: never[]) => R）：接收后续状态或事件并执行调用方逻辑；
   * 必须满足声明的类型及调用时序要求。；参数说明：args（never[]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：R；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 exit(callback, args)，
   * 并按返回类型处理结果。
   */
  exit<R>(callback: (...args: never[]) => R, ...args: never[]): R {
    return this.run(undefined, callback, ...args)
  }

  /**
   * Enter a boundary that lasts until {@link disable}, as Node's `enterWith` does
   * for the remainder of the current chain.
   * @param store - value {@link getStore} answers from now on.
   * @remarks 中文说明：功能说明：处理 enterWith 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：store（T）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 enterWith(store)，并按返回类型处理结果。
   */
  enterWith(store: T): void {
    this.entries.push({ store })
  }

  /** Drop every slot; teardown calls this unconditionally.
   * @remarks 中文说明：功能说明：处理 disable 相关流程；使用场景由所在模块及调用位置决定。；返回值：void；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 disable()，并按返回类型处理结果。 */
  disable(): void {
    this.entries.length = 0
    this.overlay = undefined
    this.ambients.length = 0
    this.resumed = undefined
  }

  /**
   * Copy every live instance's effective store, including the instances reading
   * `undefined`: a resumed frame must see exactly what its pause point saw.
   * @returns the ambient snapshot.
   * @remarks 中文说明：功能说明：处理 snapshotAll 相关流程；使用场景由所在模块及调用位置决定。；
   * 返回值：AmbientSnapshot；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * snapshotAll()，并按返回类型处理结果。
   */
  static snapshotAll(): AmbientSnapshot {
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：instance（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(instance)，并按返回类型处理结果。
     */
    return [...instances].map(instance => ({ instance, store: instance.getStore() }))
  }

  /**
   * Install a snapshot as the ambient context of every instance it names.
   * @param snapshot - a copy from {@link snapshotAll}.
   * @returns a disposer that restores the previous ambients, identity-checked.
   * @remarks 中文说明：功能说明：处理 restoreAll 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：snapshot（AmbientSnapshot）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：() =>
   * void；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 restoreAll(snapshot)，
   * 并按返回类型处理结果。
   */
  static restoreAll(snapshot: AmbientSnapshot): () => void {
    /**
     * 常量说明：installed 用于处理 installed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：{ instance, store }（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调({ instance, store })，
     * 并按返回类型处理结果。
     */
    const installed = snapshot.map(({ instance, store }) => {
      /**
       * 常量说明：slot 用于处理 slot 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const slot = { store }
      /**
       * 常量说明：before 用于处理 before 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const before = instance.resumed
      instance.resumed = slot
      return { instance, slot, before }
    })
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    return () => {
      /**
       * 变量说明：instance、slot、before 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
       */
      for (const { instance, slot, before } of installed) {
        if (instance.resumed === slot) instance.resumed = before
      }
    }
  }

  /**
   * Copy every live instance's current store. Not part of the Node face: this is
   * the shim's own mechanism, kept in the class so the overlay stays private.
   * @returns the snapshot, or undefined when no instance has a store.
   * @remarks 中文说明：功能说明：处理 captureContext 相关流程；使用场景由所在模块及调用位置决定。；
   * 返回值：AsyncContextSnapshot | undefined；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 使用示例：典型用法：在完成前置校验后调用 captureContext()，并按返回类型处理结果。
   */
  static captureContext(): AsyncContextSnapshot | undefined {
    /**
     * 变量说明：captured 用于处理 captured 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let captured: CapturedStore[] | undefined
    /**
     * 变量说明：instance 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const instance of instances) {
      /**
       * 常量说明：store 用于处理 store 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const store = instance.getStore()
      if (store === undefined) continue
      captured ??= []
      captured.push({ instance, store })
    }
    return captured
  }

  /**
   * Run a callback with a captured context restored into the overlay slots.
   * @param snapshot - context copy, or undefined to run unchanged.
   * @param callback - the callback.
   * @returns the callback's return value.
   * @remarks 中文说明：功能说明：执行 With Context 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：snapshot（AsyncContextSnapshot | undefined）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。；参数说明：callback（() => R）：接收后续状态或事件并执行调用方逻辑；
   * 必须满足声明的类型及调用时序要求。；返回值：R；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * runWithContext(snapshot, callback)，并按返回类型处理结果。
   */
  static runWithContext<R>(snapshot: AsyncContextSnapshot | undefined, callback: () => R): R {
    if (snapshot === undefined) return callback()
    /**
     * 常量说明：previous 用于处理 previous 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：{ instance, store }（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调({ instance, store })，
     * 并按返回类型处理结果。
     */
    const previous = snapshot.map(({ instance, store }) => {
      /**
       * 常量说明：before 用于处理 before 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const before = instance.overlay
      instance.overlay = { store }
      return { instance, before }
    })
    try {
      return callback()
    } finally {
      /**
       * 变量说明：instance、before 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
       */
      for (const { instance, before } of previous) instance.overlay = before
    }
  }

  /**
   * Every live instance, for {@link runAtAsyncContextRoot}.
   * @returns The stores a snapshot must capture.
   * @remarks 中文说明：功能说明：处理 liveInstances 相关流程；使用场景由所在模块及调用位置决定。；返回值：readonly
   * AsyncLocalStorage<unknown>[]；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 使用示例：典型用法：在完成前置校验后调用 liveInstances()，并按返回类型处理结果。
   */
  static liveInstances(): readonly AsyncLocalStorage<unknown>[] {
    return [...instances]
  }

  /**
   * Bind a callback to the current context.
   * @param callback - the callback to bind.
   * @returns a callback that restores this context when invoked.
   * @remarks 中文说明：功能说明：处理 bind 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：callback（F）：接收后续状态或事件并执行调用方逻辑；必须满足声明的类型及调用时序要求。；返回值：F；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 bind(callback)，并按返回类型处理结果。
   */
  static bind<F extends (...args: never[]) => unknown>(callback: F): F {
    return bindAsyncContext(callback)
  }

  /**
   * Snapshot helper matching Node's static: run a callback in the context
   * captured now.
   * @returns a function that runs its argument in the captured context.
   * @remarks 中文说明：功能说明：处理 snapshot 相关流程；使用场景由所在模块及调用位置决定。；返回值：<R>(callback:
   * () => R) => R；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 snapshot()，
   * 并按返回类型处理结果。
   */
  static snapshot(): <R>(callback: () => R) => R {
    /**
     * 常量说明：snapshot 用于处理 snapshot 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const snapshot = AsyncLocalStorage.captureContext()
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：callback（由 TypeScript
     * 根据调用位置推断的类型）：接收后续状态或事件并执行调用方逻辑；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript
     * 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(callback)，
     * 并按返回类型处理结果。
     */
    return callback => AsyncLocalStorage.runWithContext(snapshot, callback)
  }
}

/** One instance's captured store. */
interface CapturedStore {
  readonly instance: AsyncLocalStorage<unknown>
  readonly store: unknown
}

/** Opaque context copy produced by {@link captureAsyncContext}. */
export type AsyncContextSnapshot = readonly CapturedStore[]

/** Opaque ambient copy produced by {@link __snapshotAll}; covers every live instance. */
export type AmbientSnapshot = readonly CapturedStore[]

/**
 * Copy every live instance's current store.
 * @returns the snapshot, or undefined when no instance has a store (the hook
 * layer then wraps nothing and callbacks inherit the stack top).
 * @remarks 中文说明：功能说明：处理 captureAsyncContext 相关流程；使用场景由所在模块及调用位置决定。；
 * 返回值：AsyncContextSnapshot | undefined；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 captureAsyncContext()，并按返回类型处理结果。
 */
export function captureAsyncContext(): AsyncContextSnapshot | undefined {
  return AsyncLocalStorage.captureContext()
}

/**
 * Run a callback with a captured context restored into the overlay slots.
 * @param snapshot - context copy, or undefined to run unchanged.
 * @param callback - the callback.
 * @returns the callback's return value.
 * @remarks 中文说明：功能说明：执行 With Async Context 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：snapshot（AsyncContextSnapshot | undefined）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。；参数说明：callback（() => R）：接收后续状态或事件并执行调用方逻辑；
 * 必须满足声明的类型及调用时序要求。；返回值：R；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * runWithAsyncContext(snapshot, callback)，并按返回类型处理结果。
 */
export function runWithAsyncContext<R>(snapshot: AsyncContextSnapshot | undefined, callback: () => R): R {
  return AsyncLocalStorage.runWithContext(snapshot, callback)
}

/**
 * Capture the current context now and restore it around every later invocation.
 * @param callback - the callback to bind.
 * @returns the bound callback, or the original when no context is active.
 * @remarks 中文说明：功能说明：处理 bindAsyncContext 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：callback（F）：接收后续状态或事件并执行调用方逻辑；必须满足声明的类型及调用时序要求。；返回值：F；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 bindAsyncContext(callback)，并按返回类型处理结果。
 */
export function bindAsyncContext<F extends (...args: never[]) => unknown>(callback: F): F {
  /**
   * 常量说明：snapshot 用于处理 snapshot 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const snapshot = captureAsyncContext()
  if (snapshot === undefined) return callback
  /**
   * 常量说明：bound 用于处理 bound 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   * 功能说明：处理 bound 相关流程；使用场景由所在模块及调用位置决定。
   * @param args （never[]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns unknown；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 bound(args)，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  const bound = (...args: never[]): unknown => runWithAsyncContext(snapshot, () => callback(...args))
  return bound as F
}

/**
 * Run a callback at the root: every instance reads `undefined`, whatever was open
 * before. The tunnel's message entry uses this so a queued request never inherits
 * a boundary from unrelated work that happened to run first.
 * @param callback - the callback.
 * @returns the callback's return value.
 * @remarks 中文说明：功能说明：执行 At Async Context Root 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：callback（() => R）：接收后续状态或事件并执行调用方逻辑；必须满足声明的类型及调用时序要求。；返回值：R；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * runAtAsyncContextRoot(callback)，并按返回类型处理结果。
 */
export function runAtAsyncContextRoot<R>(callback: () => R): R {
  /**
   * 常量说明：root 用于处理 root 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：instance（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(instance)，并按返回类型处理结果。
   */
  const root: CapturedStore[] = AsyncLocalStorage.liveInstances().map(instance => ({ instance, store: undefined }))
  return runWithAsyncContext(root, callback)
}

/**
 * Pause point of the loader's `await` rewriting: copy the context every live
 * instance currently reads.
 *
 * The transformed module reaches this through the module proxy table
 * (`require('node:async_hooks').__snapshotAll()`), so the rewriter needs no
 * additional plumbing.
 * @returns the ambient snapshot to hand to {@link __restoreAll} after the await.
 * @remarks 中文说明：功能说明：处理 __snapshotAll 相关流程；使用场景由所在模块及调用位置决定。；
 * 返回值：AmbientSnapshot；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * __snapshotAll()，并按返回类型处理结果。
 */
export function __snapshotAll(): AmbientSnapshot {
  return AsyncLocalStorage.snapshotAll()
}

/**
 * Resume point of the loader's `await` rewriting: publish a paused context as the
 * ambient one, so reads after the await answer what the frame saw before it —
 * even while another chain interleaves.
 * @param snapshot - the copy {@link __snapshotAll} produced at the pause point.
 * @returns a disposer that restores the previous ambient context, identity-checked;
 * a rewriter that wraps a whole function body calls it in that body's `finally`.
 * @remarks 中文说明：功能说明：处理 __restoreAll 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：snapshot（AmbientSnapshot）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：() =>
 * void；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * __restoreAll(snapshot)，并按返回类型处理结果。
 */
export function __restoreAll(snapshot: AmbientSnapshot): () => void {
  return AsyncLocalStorage.restoreAll(snapshot)
}

/**
 * Snapshot face the module loader's `await` rewriting consumes (its `AlsCausality`):
 * the same pair as {@link __snapshotAll}/{@link __restoreAll}, with `restore`
 * narrowed to void because the rewritten code has no place to keep a disposer.
 * @remarks 中文说明：常量说明：alsCausality 用于处理 alsCausality 相关数据，作用于当前作用域；
 * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：AmbientSnapshot；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：snapshot（AmbientSnapshot）：提供本次调用所
 * 需的数据；必须满足声明的类型及调用时序要求。；返回值：void；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 典型用法：在完成前置校验后调用 匿名回调(snapshot)，并按返回类型处理结果。
 */
export const alsCausality = {
  snapshot: (): AmbientSnapshot => __snapshotAll(),
  restore: (snapshot: AmbientSnapshot): void => { __restoreAll(snapshot) },
}

/**
 * Async ids are not tracked; a stable id keeps callers that log it working.
 * @returns Always 1.
 * @remarks 中文说明：功能说明：处理 executionAsyncId 相关流程；使用场景由所在模块及调用位置决定。；返回值：number；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 executionAsyncId()，
 * 并按返回类型处理结果。
 */
export function executionAsyncId(): number {
  return 1
}

/**
 * Trigger ids are not tracked either.
 * @returns Always 0.
 * @remarks 中文说明：功能说明：处理 triggerAsyncId 相关流程；使用场景由所在模块及调用位置决定。；返回值：number；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 triggerAsyncId()，
 * 并按返回类型处理结果。
 */
export function triggerAsyncId(): number {
  return 0
}

/**
 * Async hooks cannot be created: no async resource tracking exists in the worker.
 * @returns Never — it throws naming the unavailable member.
 * @remarks 中文说明：功能说明：创建 Hook 相关流程；使用场景由所在模块及调用位置决定。；返回值：never；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 createHook()，并按返回类型处理结果。
 */
export function createHook(): never {
  throw new Error('web-preview: node:async_hooks.createHook is not available in the worker host')
}

/** Resource construction is likewise unavailable.
 * @remarks 中文说明：常量说明：AsyncResource 用于处理 AsyncResource 相关数据，作用于当前作用域；
 * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
export const AsyncResource: typeof import('node:async_hooks').AsyncResource
  = notImplementedFail('node:async_hooks', 'AsyncResource')

/** CommonJS interop marker: the worker loader hands `default` to default imports (see ./builtins.ts).
 * @remarks 中文说明：常量说明：__esModule 用于处理 __esModule 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
export const __esModule = true

/**
 * The `node:async_hooks` declarations this module stands in for.
 * `AsyncLocalStorage` keeps this module's own class: it carries the store
 * bookkeeping the rewrite route reads through statics Node does not declare, and
 * its `run` is typed for the callback arguments the host tree passes.
 */
type NodeFace = Partial<Omit<typeof import('node:async_hooks'), 'AsyncLocalStorage'>>
  & Record<'AsyncLocalStorage', unknown>

/** CommonJS default export: the members `require()` hands a caller of this module. */
export default {
  AsyncLocalStorage, AsyncResource, executionAsyncId, triggerAsyncId, createHook,
} satisfies NodeFace
