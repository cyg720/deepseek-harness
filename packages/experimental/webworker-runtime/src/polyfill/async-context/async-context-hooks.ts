/**
 * Global hook layer for the ALS shim: capture the async context where a callback
 * is REGISTERED and restore it where the callback RUNS. Together with the folding
 * stack in `./async-hooks.ts` this gives the worker two kinds of coverage —
 * `await` inside a boundary keeps its store because the boundary's stack entry is
 * still open, and work handed to the platform (`.then`, `queueMicrotask`, timers,
 * `fetch`) keeps its store because it was captured at registration.
 *
 * Patched here: `Promise.prototype.then` and `queueMicrotask` and `fetch`. Node's
 * `catch`/`finally` are specified to invoke `then` on the receiver, so they inherit
 * the patch instead of needing their own (`als-check.ts` proves it). The worker's
 * `setTimeout`/`setInterval`/`setImmediate` are bound in `./timers-global.ts`, and
 * the host's `process.nextTick` shim is built on `queueMicrotask`, so both arrive
 * here too.
 *
 * Two properties the patches keep:
 * - the values stay native promises — a handler is wrapped, never the chain, so
 *   `then` still returns what the original returned;
 * - an empty handler slot stays empty (`.then(undefined, onRejected)` must not
 *   grow a fulfilled handler, or a rejection would be swallowed).
 *
 * Not covered (structural): native `async`/`await` resumption is invisible to user
 * code, so the folding stack remains what carries a store across an `await`.
 * @remarks 文件说明：文件职责：实现 experimental/webworker-runtime 中 async context
 * hooks 模块的职责，并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM
 * 模块、严格类型约束与 Cordis 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness
 * 的 experimental/webworker-runtime 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 →
 * 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。
 */
import { bindAsyncContext, captureAsyncContext, runWithAsyncContext } from '../../node/builtin_modules/implemented/async_hooks.ts'

type Handler = ((value: never) => unknown) | null | undefined

/**
 * 变量说明：installed 用于处理 installed 相关数据，作用于当前作用域；其值可能随流程推进而变化，
 * 读写时需遵守声明类型和所在生命周期。
 */
let installed = false

/** Wrap one handler slot, leaving a non-function slot exactly as it was.
 * @remarks 中文说明：常量说明：bindSlot 用于处理 bindSlot 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。；功能说明：处理 bindSlot 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：handler（Handler）：接收后续状态或事件并执行调用方逻辑；必须满足声明的类型及调用时序要求。；
 * 参数说明：snapshot（ReturnType<typeof captureAsyncContext>）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。；返回值：Handler；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 bindSlot(handler, snapshot)，并按返回类型处理结果。 */
const bindSlot = (handler: Handler, snapshot: ReturnType<typeof captureAsyncContext>): Handler => {
  if (typeof handler !== 'function') return handler
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：value（never）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 典型用法：在完成前置校验后调用 匿名回调(value)，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  return (value: never) => runWithAsyncContext(snapshot, () => handler(value))
}

/**
 * Patch the platform registration points. Idempotent; call once from the worker
 * entry before the host tree boots.
 * @remarks 中文说明：功能说明：处理 installAsyncContextHooks 相关流程；使用场景由所在模块及调用位置决定。；
 * 返回值：void；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * installAsyncContextHooks()，并按返回类型处理结果。
 */
export function installAsyncContextHooks(): void {
  if (installed) return
  installed = true

  // eslint-disable-next-line @typescript-eslint/unbound-method -- the pristine `then` is `.call`ed on its own promise below
  /**
   * 常量说明：nativeThen 用于处理 nativeThen 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const nativeThen = Promise.prototype.then
  // A browser has no async-context tracking, so registration points are where a
  // store can be captured at all — patching them is the point of this module.
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：this（Promise<T>）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。；参数：onFulfilled（((value: T) => R1 | PromiseLike<R1>) |
   * null）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：onRejected（((reason: unknown) =>
   * R2 | PromiseLike<R2>) | null）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：Promise<R1 | R2>；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用
   * 匿名回调(this, onFulfilled, onRejected)，并按返回类型处理结果。
   */
  Promise.prototype.then = function patchedThen<T, R1, R2>(
    this: Promise<T>,
    onFulfilled?: ((value: T) => R1 | PromiseLike<R1>) | null,
    onRejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): Promise<R1 | R2> {
    /**
     * 常量说明：snapshot 用于处理 snapshot 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const snapshot = captureAsyncContext()
    if (snapshot === undefined) return nativeThen.call(this, onFulfilled, onRejected) as Promise<R1 | R2>
    return nativeThen.call(
      this,
      bindSlot(onFulfilled as Handler, snapshot) as typeof onFulfilled,
      bindSlot(onRejected as Handler, snapshot) as typeof onRejected,
    ) as Promise<R1 | R2>
  }

  /**
   * 常量说明：nativeQueueMicrotask 用于处理 nativeQueueMicrotask 相关数据，作用于当前作用域；
   * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const nativeQueueMicrotask = globalThis.queueMicrotask.bind(globalThis)
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：callback（VoidFunction）：接收后续状态或事件并
   * 执行调用方逻辑；必须满足声明的类型及调用时序要求。；返回值：void；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 典型用法：在完成前置校验后调用 匿名回调(callback)，并按返回类型处理结果。
   */
  globalThis.queueMicrotask = (callback: VoidFunction): void => {
    nativeQueueMicrotask(bindAsyncContext(callback))
  }

  /**
   * 常量说明：nativeFetch 用于处理 nativeFetch 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const nativeFetch = globalThis.fetch.bind(globalThis)
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：input（RequestInfo |
   * URL）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：init（RequestInit）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。；返回值：Promise<Response>；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 典型用法：在完成前置校验后调用 匿名回调(input, init)，并按返回类型处理结果。
   */
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    /**
     * 常量说明：snapshot 用于处理 snapshot 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const snapshot = captureAsyncContext()
    if (snapshot === undefined) return nativeFetch(input, init)
    // Bind the response continuation to the call site, for consumers that hand
    // the promise on before attaching handlers. `nativeThen` keeps the chain native.
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：response（Response）：提供本次调用所需的数据；
     * 必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；
     * 典型用法：在完成前置校验后调用 匿名回调(response)，并按返回类型处理结果。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：reason（unknown）：提供本次调用所需的数据；
     * 必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；
     * 典型用法：在完成前置校验后调用 匿名回调(reason)，并按返回类型处理结果。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    return nativeThen.call(
      nativeFetch(input, init),
      (response: Response) => runWithAsyncContext(snapshot, () => response),
      (reason: unknown) => runWithAsyncContext(snapshot, () => { throw reason }),
    ) as Promise<Response>
  })
}
