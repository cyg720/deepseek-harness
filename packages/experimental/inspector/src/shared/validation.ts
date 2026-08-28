/** Shared exact-object readers for versioned Inspector wire protocols.
 * @remarks 文件说明：文件职责：实现 experimental/inspector 中 validation 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/inspector 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。 */

import { inspectorId, type InspectorId } from './identity.ts'
import { isPlainObject } from './json.ts'

/**
 * Require a plain object containing only the listed fields.
 * @param value - Candidate object.
 * @param keys - Complete field allowlist.
 * @param label - Object name used in validation errors.
 * @returns The validated plain object.
 * @remarks 中文说明：功能说明：处理 exactObject 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：value（unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数说明：keys（readonly
 * string[]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数说明：label（string）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。；返回值：Record<string, unknown>；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 exactObject(value, keys, label)，并按返回类型处理结果。
 */
export function exactObject(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (!isPlainObject(value)) throw new Error(`inspector protocol: ${label} must be an object`)
  exactKeys(value, keys, label)
  return value
}

/**
 * Reject fields outside one versioned object's declared field set.
 * @param value - Plain object being validated.
 * @param keys - Complete field allowlist.
 * @param label - Object name used in validation errors.
 * @remarks 中文说明：功能说明：处理 exactKeys 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：value（Record<string, unknown>）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：keys（readonly string[]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：label（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 exactKeys(value, keys, label)，
 * 并按返回类型处理结果。
 */
export function exactKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  /**
   * 常量说明：allowed 用于处理 allowed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const allowed = new Set(keys)
  /**
   * 变量说明：key 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !allowed.has(key)) {
      throw new Error(`inspector protocol: ${label} has unknown field ${JSON.stringify(String(key))}`)
    }
  }
}

/**
 * Read one non-empty opaque identifier.
 * @param value - Candidate identifier.
 * @param label - Field name used in validation errors.
 * @returns The role-branded identifier.
 * @remarks 中文说明：功能说明：处理 wireId 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：value（unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：label（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：InspectorId<Role>；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 wireId(value, label)，
 * 并按返回类型处理结果。
 */
export function wireId<Role extends string>(value: unknown, label: string): InspectorId<Role> {
  if (typeof value !== 'string') throw new Error(`inspector protocol: ${label} must be a string`)
  return inspectorId<Role>(value, label)
}

/**
 * Read one optional string field.
 * @param value - Object containing the field.
 * @param key - Field name.
 * @returns An empty object or the validated field.
 * @remarks 中文说明：功能说明：处理 optionalString 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：value（Record<string, unknown>）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：key（Key）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：{ readonly [Property in
 * Key]?: string }；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * optionalString(value, key)，并按返回类型处理结果。
 */
export function optionalString<Key extends string>(
  value: Record<string, unknown>,
  key: Key,
): { readonly [Property in Key]?: string } {
  /**
   * 常量说明：item 用于处理 item 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const item = value[key]
  if (item === undefined) return {}
  if (typeof item !== 'string') throw new Error(`inspector protocol: ${key} must be a string`)
  return { [key]: item } as { readonly [Property in Key]?: string }
}

/**
 * Read one optional boolean field.
 * @param value - Object containing the field.
 * @param key - Field name.
 * @returns An empty object or the validated field.
 * @remarks 中文说明：功能说明：处理 optionalBoolean 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：value（Record<string, unknown>）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：key（Key）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：{ readonly [Property in
 * Key]?: boolean }；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * optionalBoolean(value, key)，并按返回类型处理结果。
 */
export function optionalBoolean<Key extends string>(
  value: Record<string, unknown>,
  key: Key,
): { readonly [Property in Key]?: boolean } {
  /**
   * 常量说明：item 用于处理 item 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const item = value[key]
  if (item === undefined) return {}
  if (typeof item !== 'boolean') throw new Error(`inspector protocol: ${key} must be a boolean`)
  return { [key]: item } as { readonly [Property in Key]?: boolean }
}

/**
 * Read one optional non-negative finite number field.
 * @param value - Object containing the field.
 * @param key - Field name.
 * @returns An empty object or the validated field.
 * @remarks 中文说明：功能说明：处理 optionalNonNegativeNumber 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：value（Record<string, unknown>）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：key（Key）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：{ readonly [Property in
 * Key]?: number }；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * optionalNonNegativeNumber(value, key)，并按返回类型处理结果。
 */
export function optionalNonNegativeNumber<Key extends string>(
  value: Record<string, unknown>,
  key: Key,
): { readonly [Property in Key]?: number } {
  /**
   * 常量说明：item 用于处理 item 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const item = value[key]
  if (item === undefined) return {}
  if (typeof item !== 'number' || !Number.isFinite(item) || item < 0) {
    throw new Error(`inspector protocol: ${key} must be a non-negative finite number`)
  }
  return { [key]: item } as { readonly [Property in Key]?: number }
}
