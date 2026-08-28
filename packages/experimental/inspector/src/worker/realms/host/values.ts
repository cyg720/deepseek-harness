/** Small validators for values returned by Node's native Inspector protocol. */

/**
 * Test whether a native protocol value is a non-array object record.
 * @param value - Native protocol value.
 * @returns Whether the value can be read as named fields.
 * @remarks 文件说明：文件职责：实现 experimental/inspector 中 values 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/inspector 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。
 * @remarks 中文说明：功能说明：判断是否为 Native Record 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：value（unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：value is
 * Readonly<Record<string, unknown>>；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 isNativeRecord(value)，并按返回类型处理结果。
 */
export function isNativeRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Require a native protocol object record.
 * @param value - Native protocol value.
 * @param label - Subject named in the validation error.
 * @returns The validated object record.
 * @remarks 中文说明：功能说明：处理 requireNativeRecord 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：value（unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：label（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：Readonly<Record<string, unknown>>；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 requireNativeRecord(value, label)，并按返回类型处理结果。
 */
export function requireNativeRecord(value: unknown, label: string): Readonly<Record<string, unknown>> {
  if (!isNativeRecord(value)) throw new Error(`${label} must be an object`)
  return value
}

/**
 * Include an optional field only when the native request supplied a value.
 * @param key - Native protocol field name.
 * @param value - Optional field value.
 * @returns An empty record or the requested field.
 * @remarks 中文说明：功能说明：处理 optionalNativeField 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：key（Key）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数说明：value（Value |
 * undefined）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：Partial<Record<Key, Value>>；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 optionalNativeField(key,
 * value)，并按返回类型处理结果。
 */
export function optionalNativeField<Key extends string, Value>(
  key: Key,
  value: Value | undefined,
): Partial<Record<Key, Value>> {
  return value === undefined ? {} : { [key]: value } as Partial<Record<Key, Value>>
}
