/**
 * `node:timers/promises`: real implementations over the worker's timer globals.
 * @remarks 文件说明：文件职责：实现 experimental/webworker-runtime 中 promises 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/webworker-runtime 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 →
 * 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。
 */
import type { TimerOptions } from 'node:timers'

/** The rejection an aborted wait reports, as Node and the DOM both spell it.
 * @remarks 中文说明：常量说明：abortError 用于处理 abortError 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。；功能说明：处理 abortError 相关流程；使用场景由所在模块及调用位置决定。；
 * 返回值：DOMException；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * abortError()，并按返回类型处理结果。 */
const abortError = (): DOMException => new DOMException('The operation was aborted.', 'AbortError')

/**
 * Resolve after a delay.
 * @param delayMs - milliseconds to wait.
 * @param value - value to resolve with; Node resolves undefined when none is handed in.
 * @param options - abort support, as Node provides.
 * @returns the value after the delay, or a rejection when the signal aborts.
 * @remarks 中文说明：功能说明：设置 Timeout 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：delayMs（number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：value（T）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：options（TimerOptions）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。；
 * 返回值：Promise<T>；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * setTimeout(delayMs, value, options)，并按返回类型处理结果。
 */
export function setTimeout<T = void>(
  delayMs?: number,
  value?: T,
  options?: TimerOptions,
): Promise<T> {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolve（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：reject（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(resolve, reject)，
   * 并按返回类型处理结果。
   */
  return new Promise((resolve, reject) => {
    // A signal that has already aborted emits no further `abort` event, so the
    // timer must not be armed at all; Node rejects such a call straight away.
    if (options?.signal?.aborted === true) {
      reject(abortError())
      return
    }
    /**
     * 常量说明：timer 用于处理 timer 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    const timer = globalThis.setTimeout(() => { resolve(value as T) }, delayMs)
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    options?.signal?.addEventListener('abort', () => {
      globalThis.clearTimeout(timer)
      reject(abortError())
    }, { once: true })
  })
}

/**
 * Resolve on the next macrotask.
 * @param value - resolution value handed back after the timer.
 * @returns a promise resolved after a zero-delay timer.
 * @remarks 中文说明：功能说明：设置 Immediate 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：value（T）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：Promise<T>；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 setImmediate(value)，并按返回类型处理结果。
 */
export function setImmediate<T = void>(value?: T): Promise<T> {
  return setTimeout(0, value)
}

/** Cooperative scheduling helpers Node exposes on this module.
 * @remarks 中文说明：常量说明：scheduler 用于处理 scheduler 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：delayMs（number）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。；参数：options（TimerOptions）：提供本次操作使用的配置选项；
 * 必须满足声明的类型及调用时序要求。；返回值：Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 典型用法：在完成前置校验后调用 匿名回调(delayMs, options)，并按返回类型处理结果。
 */
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：Promise<void>；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
export const scheduler = {
  wait: async (delayMs?: number, options?: TimerOptions): Promise<void> => {
    await setTimeout(delayMs, undefined, options)
  },
  yield: async (): Promise<void> => { await setTimeout(0) },
}

/** CommonJS interop marker: the worker loader hands `default` to default imports (see ./builtins.ts).
 * @remarks 中文说明：常量说明：__esModule 用于处理 __esModule 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
export const __esModule = true

/** The `node:timers/promises` declarations this module stands in for. */
type NodeFace = Partial<typeof import('node:timers/promises')>

/** CommonJS default export: the members `require()` hands a caller of this module. */
export default { setTimeout, setImmediate, scheduler } satisfies NodeFace
