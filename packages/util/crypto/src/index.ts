/**
 * UUID minting that works in every JavaScript context this repository ships
 * to. `crypto.randomUUID` is a secure-context Web API — a page or worker
 * served over plain HTTP on a LAN address has no such method — while
 * `crypto.getRandomValues` is unrestricted everywhere (browsers, workers,
 * Node ≥ 19). One implementation here replaces per-caller polyfills; the
 * `no-restricted-properties` lint rule points `crypto.randomUUID` callers at
 * this module.
 * @module @deepseek-ai/dsh-util-crypto
 */

/** RFC 9562 UUID string, the shape `crypto.randomUUID` declares.
 * @remarks 文件说明：文件职责：实现 util/crypto 中 index 模块的职责，并向相邻模块提供可复用能力。；
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的 util/crypto 能力，
 * 使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。；
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。 */
export type Uuid = `${string}-${string}-${string}-${string}-${string}`

/**
 * Encode bytes as canonical base64 without overflowing function argument limits.
 * @param data - Bytes to encode.
 * @returns base64 text.
 * @remarks 中文说明：功能说明：处理 bytesToBase64 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：data（Uint8Array）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：string；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 bytesToBase64(data)，
 * 并按返回类型处理结果。
 */
export function bytesToBase64(data: Uint8Array): string {
  /**
   * 变量说明：binary 用于处理 binary 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let binary = ''
  /**
   * 常量说明：chunk 用于处理 chunk 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const chunk = 0x8000
  /**
   * 变量说明：offset 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (let offset = 0; offset < data.length; offset += chunk) {
    binary += String.fromCharCode(...data.subarray(offset, offset + chunk))
  }
  return btoa(binary)
}

/**
 * Random v4 UUID, minted from `crypto.getRandomValues`.
 * @returns the UUID string.
 * @remarks 中文说明：功能说明：处理 randomUUID 相关流程；使用场景由所在模块及调用位置决定。；返回值：Uuid；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 randomUUID()，并按返回类型处理结果。
 */
export function randomUUID(): Uuid {
  /**
   * 常量说明：bytes 用于处理 bytes 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16))
  // RFC 9562 §5.4: version 4 in the high nibble of byte 6, variant 10 in byte 8.
  /**
   * 常量说明：hex 用于处理 hex 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：byte（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：index（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(byte, index)，并按返回类型处理结果。
   */
  const hex = Array.from(bytes, (byte, index) => {
    /**
     * 常量说明：pinned 用于处理 pinned 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const pinned = index === 6 ? (byte & 0x0f) | 0x40 : index === 8 ? (byte & 0x3f) | 0x80 : byte
    return pinned.toString(16).padStart(2, '0')
  }).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
