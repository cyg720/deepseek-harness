/**
 * `node:util` for the worker: the members harness code actually imports. Node's
 * inspect output is only used in diagnostics, so a JSON-shaped rendering is
 * enough; `promisify` follows Node's error-first callback convention exactly
 * because zlib-style APIs are wrapped with it at module scope.
 */

/**
 * Wrap an error-first callback function as a promise-returning one.
 * @param fn - callback-style function.
 * @returns the promise-returning wrapper.
 * @remarks 文件说明：文件职责：实现 experimental/webworker-runtime 中 util 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/webworker-runtime 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 →
 * 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。
 * @remarks 中文说明：功能说明：处理 promisify 相关流程；使用场景由所在模块及调用位置决定。；参数说明：fn（(...args:
 * [...A, (error: unknown, value: R) => void]) => vo…）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。；返回值：(...args: A) => Promise<R>；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 promisify(fn)，并按返回类型处理结果。
 */
export function promisify<A extends unknown[], R>(
  fn: (...args: [...A, (error: unknown, value: R) => void]) => void,
): (...args: A) => Promise<R> {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：args（A）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 典型用法：在完成前置校验后调用 匿名回调(args)，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolve（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：reject（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(resolve, reject)，
   * 并按返回类型处理结果。
   */
  return (...args: A) => new Promise<R>((resolve, reject) => {
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：error（unknown）：提供本次调用所需的数据；
     * 必须满足声明的类型及调用时序要求。；参数：value（R）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由
     * TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用
     * 匿名回调(error, value)，并按返回类型处理结果。
     */
    fn(...args, (error: unknown, value: R) => {
      if (error !== null && error !== undefined) reject(error instanceof Error ? error : new Error(inspect(error)))
      else resolve(value)
    })
  })
}

/**
 * Wrap a promise-returning function as an error-first callback one.
 * @param fn - promise-returning function.
 * @returns the callback-style wrapper.
 * @remarks 中文说明：功能说明：处理 callbackify 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：fn（(...args: A) => Promise<R>）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：(...args: [...A, (error: unknown, value?: R) => void]) => void；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 callbackify(fn)，
 * 并按返回类型处理结果。
 */
export function callbackify<A extends unknown[], R>(
  fn: (...args: A) => Promise<R>,
): (...args: [...A, (error: unknown, value?: R) => void]) => void {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：args（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(args)，并按返回类型处理结果。
   */
  return (...args) => {
    /**
     * 常量说明：callback 用于处理 callback 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const callback = args.at(-1) as (error: unknown, value?: R) => void
    /**
     * 常量说明：rest 用于处理 rest 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const rest = args.slice(0, -1) as unknown as A
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：value（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(value)，并按返回类型处理结果。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：error（unknown）：提供本次调用所需的数据；
     * 必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；
     * 典型用法：在完成前置校验后调用 匿名回调(error)，并按返回类型处理结果。
     */
    fn(...rest).then((value) => { callback(null, value) }, (error: unknown) => { callback(error) })
  }
}

/**
 * Diagnostic rendering of a value.
 * @param value - the value.
 * @returns a readable one-line rendering.
 * @remarks 中文说明：功能说明：处理 inspect 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：value（unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：string；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 inspect(value)，并按返回类型处理结果。
 */
export function inspect(value: unknown): string {
  if (typeof value === 'string') return `'${value}'`
  if (value instanceof Error) return value.stack ?? `${value.name}: ${value.message}`
  try {
    // `JSON.stringify` is typed as returning a string but answers undefined for
    // undefined, functions, and symbols.
    /**
     * 常量说明：rendered 用于处理 rendered 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：_key（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：item（unknown）：提供本次调用所需的数据；
     * 必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；
     * 典型用法：在完成前置校验后调用 匿名回调(_key, item)，并按返回类型处理结果。
     */
    const rendered = JSON.stringify(value, (_key, item: unknown) =>
      typeof item === 'bigint' ? item.toString() : item) as string | undefined
    return rendered ?? String(value)
  } catch {
    // Cyclic or otherwise unserializable values still need a rendering.
    return String(value)
  }
}

/**
 * printf-style formatting for the `%s`/`%d`/`%j`/`%o` placeholders Node supports.
 * @param template - format string, or any value when used without placeholders.
 * @param args - substitution values.
 * @returns the formatted string.
 * @remarks 中文说明：功能说明：格式化 format 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：template（unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：args（unknown[]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：string；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 format(template, args)，
 * 并按返回类型处理结果。
 */
export function format(template: unknown, ...args: unknown[]): string {
  /**
  * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：value（由 TypeScript
  * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
  * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(value)，并按返回类型处理结果。
  */
  if (typeof template !== 'string') return [template, ...args].map(value => inspect(value)).join(' ')
  /**
   * 变量说明：index 用于处理 index 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let index = 0
  /**
   * 常量说明：substituted 用于处理 substituted 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：token（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(token)，并按返回类型处理结果。
   */
  const substituted = template.replaceAll(/%[sdifjoO%]/g, (token) => {
    if (token === '%%') return '%'
    if (index >= args.length) return token
    /**
     * 常量说明：value 用于处理 value 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const value = args[index++]
    if (token === '%d' || token === '%i') return String(Number(value))
    if (token === '%f') return String(Number(value))
    if (token === '%s') return typeof value === 'string' ? value : inspect(value)
    return inspect(value)
  })
  /**
   * 常量说明：rest 用于处理 rest 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const rest = args.slice(index)
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：value（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(value)，并按返回类型处理结果。
   */
  return rest.length === 0 ? substituted : `${substituted} ${rest.map(value => inspect(value)).join(' ')}`
}

/**
 * Structural deep equality, as `isDeepStrictEqual` defines it for plain data.
 * @param left - first value.
 * @param right - second value.
 * @returns true when both sides are structurally identical.
 * @remarks 中文说明：功能说明：判断是否为 Deep Strict Equal 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：left（unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：right（unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：boolean；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 isDeepStrictEqual(left,
 * right)，并按返回类型处理结果。
 */
export function isDeepStrictEqual(left: unknown, right: unknown): boolean {
  /* jscpd:ignore-start -- the walk necessarily matches credentials-local's
     sameJsonValue (both are structural equality over plain data); a shared
     helper would couple the self-contained builtin face packed into the worker
     image to a host package. */
  if (Object.is(left, right)) return true
  if (typeof left !== 'object' || typeof right !== 'object' || left === null || right === null) return false
  if (Array.isArray(left) !== Array.isArray(right)) return false
  /**
   * 常量说明：leftKeys 用于处理 leftKeys 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const leftKeys = Object.keys(left)
  /**
   * 常量说明：rightKeys 用于处理 rightKeys 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const rightKeys = Object.keys(right)
  if (leftKeys.length !== rightKeys.length) return false
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：key（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(key)，并按返回类型处理结果。
   */
  return leftKeys.every(key => key in right
    && isDeepStrictEqual((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key]))
  /* jscpd:ignore-end */
}

/** Runtime type predicates (`node:util/types`), checked against the Node module of that name.
 * @remarks 中文说明：常量说明：types 用于处理 types 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：value（unknown）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。；返回值：value is Promise<unknown>；调用方应按声明类型处理，不应假定未声明的附加状态。
 * ；典型用法：在完成前置校验后调用 匿名回调(value)，并按返回类型处理结果。
 */
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：value（unknown）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。；返回值：value is Date；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 典型用法：在完成前置校验后调用 匿名回调(value)，并按返回类型处理结果。
 */
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：value（unknown）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。；返回值：value is RegExp；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 典型用法：在完成前置校验后调用 匿名回调(value)，并按返回类型处理结果。
 */
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：value（unknown）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。；返回值：value is NodeJS.TypedArray；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(value)，并按返回类型处理结果。
 */
export const types = {
  isPromise: (value: unknown): value is Promise<unknown> => value instanceof Promise
    || (typeof value === 'object' && value !== null && typeof (value as { then?: unknown }).then === 'function'),
  isDate: (value: unknown): value is Date => value instanceof Date,
  isRegExp: (value: unknown): value is RegExp => value instanceof RegExp,
  // Node counts only the integer and float views, so a DataView answers false.
  isTypedArray: (value: unknown): value is NodeJS.TypedArray => ArrayBuffer.isView(value) && !(value instanceof DataView),
} satisfies Partial<typeof import('node:util/types')>

/**
 * CLI argument parsing has no caller inside the worker host.
 * @returns Never — it throws naming the unavailable member.
 * @remarks 中文说明：功能说明：解析 Args 相关流程；使用场景由所在模块及调用位置决定。；返回值：never；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 parseArgs()，并按返回类型处理结果。
 */
export function parseArgs(): never {
  throw new Error('web-preview: node:util.parseArgs is not available in the worker host')
}

/**
 * Deprecation wrappers pass the function through unchanged.
 * @param fn - the function a caller wanted wrapped.
 * @returns The same function, unwrapped.
 * @remarks 中文说明：功能说明：处理 deprecate 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：fn（F）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：F；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 deprecate(fn)，并按返回类型处理结果。
 */
export function deprecate<F>(fn: F): F {
  return fn
}

/** Text decoder class, as `node:util` re-exports it.
 * @remarks 中文说明：常量说明：TextDecoderClass 用于处理 TextDecoderClass 相关数据，作用于当前作用域；
 * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
const TextDecoderClass = globalThis.TextDecoder

/** Text encoder class, as `node:util` re-exports it.
 * @remarks 中文说明：常量说明：TextEncoderClass 用于处理 TextEncoderClass 相关数据，作用于当前作用域；
 * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
const TextEncoderClass = globalThis.TextEncoder

export { TextDecoderClass as TextDecoder, TextEncoderClass as TextEncoder }

/** CommonJS interop marker: the worker loader hands `default` to default imports (see ./builtins.ts).
 * @remarks 中文说明：常量说明：__esModule 用于处理 __esModule 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
export const __esModule = true

/**
 * The `node:util` declarations this module stands in for. Five members keep this
 * module's own types: `promisify`, `callbackify`, and `inspect` are the plain
 * conversions the harness calls, without Node's overload ladders and the
 * `custom`/`styles`/`defaultOptions` members hung off them; `types` publishes the
 * four predicates in use rather than Node's forty; and `TextDecoder` is the DOM
 * class, whose `decode` input union the Node declaration does not accept.
 */
type NodeFace = Partial<Omit<typeof import('node:util'), 'promisify' | 'callbackify' | 'inspect' | 'types' | 'TextDecoder'>>
  & Record<'promisify' | 'callbackify' | 'inspect' | 'types' | 'TextDecoder', unknown>

/** CommonJS default export: the members `require()` hands a caller of this module. */
export default {
  promisify, callbackify, inspect, format, isDeepStrictEqual, types, parseArgs, deprecate,
  TextDecoder: TextDecoderClass, TextEncoder: TextEncoderClass,
} satisfies NodeFace
