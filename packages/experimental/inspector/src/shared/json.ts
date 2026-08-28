/** JSON values admitted by every Inspector cross-realm message. */

/** JSON scalar accepted by Inspector transports.
 * @remarks 文件说明：文件职责：实现 experimental/inspector 中 json 模块的职责，并向相邻模块提供可复用能力。；
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/inspector 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。 */
export type InspectorJsonPrimitive = null | boolean | number | string

/** Recursively JSON-compatible value accepted by Inspector transports. */
export type InspectorJsonValue =
  | InspectorJsonPrimitive
  | readonly InspectorJsonValue[]
  | InspectorJsonObject

/** JSON-compatible object accepted by Inspector transports. */
export interface InspectorJsonObject {
  readonly [key: string]: InspectorJsonValue
}

/**
 * Test that a value can cross both MessagePort and JSON WebSocket carriers without coercion.
 * @param value - Candidate wire value.
 * @returns Whether the value is lossless JSON data.
 * @remarks 中文说明：功能说明：判断是否为 Json Value 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：value（unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：value is
 * InspectorJsonValue；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * isJsonValue(value)，并按返回类型处理结果。
 */
export function isJsonValue(value: unknown): value is InspectorJsonValue {
  return visitJson(value, new Set<object>())
}

/**
 * Require a plain JSON object and return it with a narrowed type.
 * @param value - Candidate wire value.
 * @param label - Field name used in validation errors.
 * @returns The validated JSON object.
 * @remarks 中文说明：功能说明：处理 requireJsonObject 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：value（unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：label（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：InspectorJsonObject；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 requireJsonObject(value,
 * label)，并按返回类型处理结果。
 */
export function requireJsonObject(value: unknown, label: string): InspectorJsonObject {
  if (!isPlainObject(value) || !isJsonValue(value)) {
    throw new Error(`inspector protocol: ${label} must be a JSON object`)
  }
  return value
}

/**
 * Compute the UTF-8 byte length of a JSON wire value.
 * @param value - Validated JSON value.
 * @returns Its encoded byte length.
 * @remarks 中文说明：功能说明：处理 jsonByteLength 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：value（InspectorJsonValue）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：number；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 jsonByteLength(value)，
 * 并按返回类型处理结果。
 */
export function jsonByteLength(value: InspectorJsonValue): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength
}

/**
 * Test whether a value is a plain object with string own keys.
 * @param value - Candidate object.
 * @returns Whether the value has `Object.prototype` or a null prototype.
 * @remarks 中文说明：功能说明：判断是否为 Plain Object 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：value（unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：value is
 * Record<string, unknown>；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * isPlainObject(value)，并按返回类型处理结果。
 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  /**
   * 常量说明：prototype 用于处理 prototype 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const prototype = Reflect.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

/**
 * 功能说明：处理 visitJson 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param ancestors （Set<object>）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns value is InspectorJsonValue；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 visitJson(value, ancestors)，并按返回类型处理结果。
 */
function visitJson(value: unknown, ancestors: Set<object>): value is InspectorJsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value) && !Object.is(value, -0)
  if (typeof value !== 'object' || ancestors.has(value)) return false
  ancestors.add(value)
  try {
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype || Reflect.ownKeys(value).length !== value.length + 1) return false
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：item（由 TypeScript
       * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(item)，并按返回类型处理结果。
       */
      return value.every(item => visitJson(item, ancestors))
    }
    if (!isPlainObject(value)) return false
    /**
     * 变量说明：key 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string') return false
      /**
       * 常量说明：descriptor 用于处理 descriptor 相关数据，作用于当前作用域；初始化后不可重新赋值，
       * 但对象内部是否可变仍由其类型决定。
       */
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (descriptor?.enumerable !== true || !('value' in descriptor) || !visitJson(descriptor.value, ancestors)) return false
    }
    return true
  } finally {
    ancestors.delete(value)
  }
}
