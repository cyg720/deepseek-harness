/** Lossless range encoding for JSONL `sourceEventSeqs` arrays. */

/*
 * 【文件职责】对持久 sourceEventSeqs 使用单值与连续闭区间进行无损编码，解码后仍保留原事件序号含义。
 */

import { SessionSeq } from './types.ts'
import type { SessionSeq as SessionSeqType } from './types.ts'

/** A stored source sequence or inclusive consecutive range. */
export type EncodedSeq = number | [number, number]

function isStrictlyIncreasing(values: readonly SessionSeqType[]): boolean {
  return values.every((value, index) => index === 0 || value > (values[index - 1] as SessionSeqType))
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
export function encodeSeqRanges(values: readonly SessionSeqType[]): EncodedSeq[] {
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
    /**
    * 变量说明：index 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
    */
    if (end - start >= 2) encoded.push([values[start] as number, values[end] as number])
    else for (let index = start; index <= end; index += 1) encoded.push(values[index] as number)
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
export function decodeSeqRanges(value: unknown, maxEntries = Number.MAX_SAFE_INTEGER): SessionSeqType[] {
  if (!Array.isArray(value)) throw new TypeError('sourceEventSeqs must be an array')
  const decoded: SessionSeqType[] = []
  let hasRange = false
  /**
   * 变量说明：entry 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (const entry of value) {
    if (typeof entry === 'number') {
      assertSeq(entry)
      if (decoded.length >= maxEntries) throw new TypeError('sourceEventSeqs exceeds its event sequence')
      decoded.push(SessionSeq(entry))
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
    for (let seq = start; seq <= end; seq += 1) decoded.push(SessionSeq(seq))
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
