/**
 * Structural not-implemented stubs: a replaced module must expose every symbol
 * its importers name (a missing CommonJS symbol degrades to `undefined` at call
 * time instead of failing at link time), and every one of those symbols must
 * report exactly what is unavailable when it is finally called.
 */

/**
 * Build a function that throws naming its module and symbol. The refusal is
 * also written to the console before it propagates: callers routinely swallow
 * these errors far from their cause, and the console line is what places the
 * failure while debugging a worker session.
 *
 * `Face` is the Node declaration this stub stands in for, so the replaced module
 * publishes the type its importers compile against. The value is one throwing
 * function whatever that declaration says: a caller reaches the throw before any
 * declared parameter, return value, or `new` result exists, so the assertion
 * below cannot be observed as a lie. It is a function expression rather than an
 * arrow because a stub standing in for a class must refuse under `new` too, and
 * an arrow has no construct behavior to reach.
 * @param module - module specifier being stubbed.
 * @param symbol - exported symbol name.
 * @returns the throwing stand-in, typed as the member it replaces.
 * @remarks 文件说明：文件职责：实现 experimental/webworker-runtime 中
 * notImplementedFail 模块的职责，并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的
 * ESM 模块、严格类型约束与 Cordis 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek
 * Harness 的 experimental/webworker-runtime 能力，使上层功能能够稳定组合和扩展。；
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。；
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 * @remarks 中文说明：功能说明：处理 notImplementedFail 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：module（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：symbol（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：Face；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 notImplementedFail(module, symbol)，
 * 并按返回类型处理结果。
 */
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- only the return position carries the Node declaration
export function notImplementedFail<Face = (...args: never[]) => never>(module: string, symbol: string): Face {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：never；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  return (function refuse(): never {
    throw notAvailableError(module, symbol)
  }) as Face
}

/**
 * Build the refusal error and write it to the console first, for stubs that
 * cannot be a plain throwing function (constructors, methods on structural
 * fakes).
 * @param module - module specifier being stubbed.
 * @param symbol - unavailable member, named as the importer sees it.
 * @returns the error to throw.
 * @remarks 中文说明：功能说明：处理 notAvailableError 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：module（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：symbol（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：Error；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 notAvailableError(module, symbol)，
 * 并按返回类型处理结果。
 */
export function notAvailableError(module: string, symbol: string): Error {
  /**
   * 常量说明：message 用于处理 message 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const message = `web-preview: ${module}.${symbol} is not available in the worker host`
  console.error(message)
  return new Error(message)
}
