/** Lossless range encoding for JSONL `sourceEventSeqs` arrays. */

/** A stored source sequence or inclusive consecutive range.
 * @remarks 文件说明：文件职责：实现 core/session 中 seq ranges 模块的职责，并向相邻模块提供可复用能力。；
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的 core/session 能力，
 * 使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。；
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。 */
export type EncodedSeq = number | [number, number]

/**
 * 功能说明：判断是否为 Strictly Increasing 相关流程；使用场景由所在模块及调用位置决定。
 * @param values （readonly number[]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns boolean；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 isStrictlyIncreasing(values)，并按返回类型处理结果。
 */
function isStrictlyIncreasing(values: readonly number[]): boolean {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：value（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：index（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(value, index)，并按返回类型处理结果。
   */
  return values.every((value, index) => index === 0 || value > (values[index - 1] as number))
}

/**
 * Replace profitable consecutive runs with inclusive pairs.
 * @param values - validated in-memory source sequences.
 * @returns a lossless JSON storage form.
 * @remarks 中文说明：功能说明：编码 Seq Ranges 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：values（readonly number[]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：EncodedSeq[]；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * encodeSeqRanges(values)，并按返回类型处理结果。
 */
export function encodeSeqRanges(values: readonly number[]): EncodedSeq[] {
  if (!isStrictlyIncreasing(values)) return [...values]
  /**
   * 常量说明：encoded 用于处理 encoded 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const encoded: EncodedSeq[] = []
  /**
   * 变量说明：start 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (let start = 0; start < values.length;) {
    /**
     * 变量说明：end 用于处理 end 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let end = start
    while (end + 1 < values.length && values[end + 1] === (values[end] as number) + 1) end += 1
    if (end - start >= 2) encoded.push([values[start] as number, values[end] as number])
    else /**
 * 变量说明：index 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
 */
for (let index = start; index <= end; index += 1) encoded.push(values[index] as number)
    start = end + 1
  }
  return encoded
}

/**
 * Expand a JSON storage-form source sequence array.
 * @param value - parsed storage value.
 * @param maxEntries - largest list permitted by the owning event.
 * @returns the in-memory source sequences.
 * @remarks 中文说明：功能说明：解码 Seq Ranges 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：value（unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数说明：maxEntries（由
 * TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：number[]；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 decodeSeqRanges(value,
 * maxEntries)，并按返回类型处理结果。
 */
export function decodeSeqRanges(value: unknown, maxEntries = Number.MAX_SAFE_INTEGER): number[] {
  if (!Array.isArray(value)) throw new TypeError('sourceEventSeqs must be an array')
  /**
   * 常量说明：decoded 用于处理 decoded 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const decoded: number[] = []
  /**
   * 变量说明：hasRange 用于判断是否包含 Range 相关数据，作用于当前作用域；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  let hasRange = false
  /**
   * 变量说明：entry 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (const entry of value) {
    if (typeof entry === 'number') {
      assertSeq(entry)
      if (decoded.length >= maxEntries) throw new TypeError('sourceEventSeqs exceeds its event sequence')
      decoded.push(entry)
      continue
    }
    if (!Array.isArray(entry) || entry.length !== 2) {
      throw new TypeError('sourceEventSeqs range entries must be [start, end] pairs')
    }
    /**
     * 常量说明：start 用于启动 start 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const start: unknown = entry[0]
    /**
     * 常量说明：end 用于处理 end 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const end: unknown = entry[1]
    assertSeq(start)
    assertSeq(end)
    if (end < start) throw new TypeError('sourceEventSeqs ranges require start <= end')
    /**
     * 常量说明：length 用于处理 length 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const length = end - start + 1
    if (length > maxEntries - decoded.length) {
      throw new TypeError('sourceEventSeqs range exceeds its event sequence')
    }
    /**
     * 变量说明：seq 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (let seq = start; seq <= end; seq += 1) decoded.push(seq)
    hasRange = true
  }
  if (hasRange && !isStrictlyIncreasing(decoded)) {
    throw new TypeError('sourceEventSeqs ranges must be strictly increasing')
  }
  return decoded
}

/**
 * 功能说明：断言 Seq 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns asserts value is number；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 assertSeq(value)，并按返回类型处理结果。
 */
function assertSeq(value: unknown): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new TypeError('sourceEventSeqs must contain non-negative safe integers')
  }
}
