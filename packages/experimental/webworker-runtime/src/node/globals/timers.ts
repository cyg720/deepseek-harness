/**
 * Node-shaped timer handles. The browser's `setTimeout`/`setInterval` return
 * numeric ids, while harness and vendored code calls `.unref()` on the handle
 * (`client-hmr`'s poll interval, cordis's timer plugin). The wrappers return a
 * handle object with Node's `ref`/`unref`/`hasRef`, and `clear*` accepts either
 * form — the object also converts to its numeric id, so any code that stores it
 * as a number keeps working.
 *
 * Handlers are also bound to the async context where the timer was registered
 * (`./async-context-hooks.ts`), so a callback scheduled inside an initiator
 * boundary is attributed to that boundary when it fires.
 * @remarks 文件说明：文件职责：实现 experimental/webworker-runtime 中 timers 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/webworker-runtime 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 →
 * 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。
 */
import { bindAsyncContext } from '../builtin_modules/implemented/async_hooks.ts'

/** Node `Timeout`/`Immediate` face the harness relies on. */
export interface TimerHandle {
  /**
   * 功能说明：处理 ref 相关流程；使用场景由所在模块及调用位置决定。
   * @returns TimerHandle；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 ref()，并按返回类型处理结果。
   */
  ref(): TimerHandle
  /**
   * 功能说明：处理 unref 相关流程；使用场景由所在模块及调用位置决定。
   * @returns TimerHandle；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 unref()，并按返回类型处理结果。
   */
  unref(): TimerHandle
  /**
   * 功能说明：判断是否包含 Ref 相关流程；使用场景由所在模块及调用位置决定。
   * @returns boolean；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 hasRef()，并按返回类型处理结果。
   */
  hasRef(): boolean
  /**
   * 功能说明：处理 [Symbol.toPrimitive] 相关流程；使用场景由所在模块及调用位置决定。
   * @returns number；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 [Symbol.toPrimitive]()，并按返回类型处理结果。
   */
  [Symbol.toPrimitive](): number
}

type Scheduler = (handler: TimerHandler, timeout?: number, ...args: unknown[]) => number
type Clear = (id?: number) => void

/**
 * 常量说明：handleOf 用于处理 Of 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 * 功能说明：处理 Of 相关流程；使用场景由所在模块及调用位置决定。
 * @param id （number）：标识本次操作关联的唯一对象；必须满足声明的类型及调用时序要求。
 * @returns TimerHandle；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 handleOf(id)，并按返回类型处理结果。
 */
const handleOf = (id: number): TimerHandle => {
  /**
   * 常量说明：handle 用于处理 handle 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  const handle: TimerHandle = {
    ref: () => handle,
    unref: () => handle,
    hasRef: () => true,
    [Symbol.toPrimitive]: () => id,
  }
  return handle
}

/**
 * 常量说明：idOf 用于处理 idOf 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 * 功能说明：处理 idOf 相关流程；使用场景由所在模块及调用位置决定。
 * @param handle （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns number | undefined；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 idOf(handle)，并按返回类型处理结果。
 */
const idOf = (handle: unknown): number | undefined => {
  if (typeof handle === 'number') return handle
  if (typeof handle === 'object' && handle !== null && Symbol.toPrimitive in handle) {
    return Number(handle)
  }
  return undefined
}

/**
 * 常量说明：wrapScheduler 用于处理 wrapScheduler 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 * 功能说明：处理 wrapScheduler 相关流程；使用场景由所在模块及调用位置决定。
 * @param schedule （Scheduler）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns ((handler: TimerHandler, timeout?: number, ...args: unknown[])
 * => Tim…；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 wrapScheduler(schedule)，并按返回类型处理结果。
 */
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：handler（由 TypeScript
 * 根据调用位置推断的类型）：接收后续状态或事件并执行调用方逻辑；必须满足声明的类型及调用时序要求。；参数：timeout（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：args（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(handler, timeout, args)，
 * 并按返回类型处理结果。
 */
const wrapScheduler = (schedule: Scheduler): ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => TimerHandle) =>
  (handler, timeout, ...args) => handleOf(schedule(bindHandler(handler), timeout, ...args))

/** Bind a timer handler to its registration context; string handlers have none to bind.
 * @remarks 中文说明：常量说明：bindHandler 用于处理 bindHandler 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。；功能说明：处理 bindHandler 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：handler（TimerHandler）：接收后续状态或事件并执行调用方逻辑；必须满足声明的类型及调用时序要求。；
 * 返回值：TimerHandler；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * bindHandler(handler)，并按返回类型处理结果。 */
const bindHandler = (handler: TimerHandler): TimerHandler =>
  typeof handler === 'function' ? bindAsyncContext(handler as (...args: never[]) => unknown) : handler

/**
 * 常量说明：wrapClear 用于处理 wrapClear 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 * 功能说明：处理 wrapClear 相关流程；使用场景由所在模块及调用位置决定。
 * @param clear （Clear）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns ((handle?: unknown) => void)；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 wrapClear(clear)，并按返回类型处理结果。
 */
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：handle（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(handle)，并按返回类型处理结果。
 */
const wrapClear = (clear: Clear): ((handle?: unknown) => void) =>
  (handle) => { clear(idOf(handle)) }

/** Replace the worker's timer globals with the Node-shaped wrappers.
 * @remarks 中文说明：功能说明：处理 installTimerGlobals 相关流程；使用场景由所在模块及调用位置决定。；
 * 返回值：void；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * installTimerGlobals()，并按返回类型处理结果。 */
export function installTimerGlobals(): void {
  /**
   * 常量说明：scope 用于处理 scope 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const scope = globalThis as unknown as Record<string, unknown>
  /**
   * 常量说明：setTimeoutRaw 用于设置 Timeout Raw 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const setTimeoutRaw = globalThis.setTimeout.bind(globalThis) as unknown as Scheduler
  /**
   * 常量说明：setIntervalRaw 用于设置 Interval Raw 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const setIntervalRaw = globalThis.setInterval.bind(globalThis) as unknown as Scheduler
  /**
   * 常量说明：clearTimeoutRaw 用于处理 clearTimeoutRaw 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const clearTimeoutRaw = globalThis.clearTimeout.bind(globalThis) as unknown as Clear
  /**
   * 常量说明：clearIntervalRaw 用于处理 clearIntervalRaw 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const clearIntervalRaw = globalThis.clearInterval.bind(globalThis) as unknown as Clear
  scope.setTimeout = wrapScheduler(setTimeoutRaw)
  scope.setInterval = wrapScheduler(setIntervalRaw)
  scope.clearTimeout = wrapClear(clearTimeoutRaw)
  scope.clearInterval = wrapClear(clearIntervalRaw)
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：handler（TimerHandler）：接收后续状态或事件并执
   * 行调用方逻辑；必须满足声明的类型及调用时序要求。；参数：args（unknown[]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * ；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用
   * 匿名回调(handler, args)，并按返回类型处理结果。
   */
  scope.setImmediate = (handler: TimerHandler, ...args: unknown[]) =>
    handleOf(setTimeoutRaw(bindHandler(handler), 0, ...args))
  scope.clearImmediate = wrapClear(clearTimeoutRaw)
}
