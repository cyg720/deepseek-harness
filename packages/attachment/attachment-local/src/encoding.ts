/** Shared lazy candidate execution for normalization and request-image encoders. */
/**
 * 文件职责：按偏好顺序惰性执行图片编码候选，并选择首个满足字节上限的结果。
 * 技术维度：使用 TypeScript 泛型、异步函数和类型谓词跟踪候选与穷尽结果。
 * 产品维度：优先保留较好图片表示，在都超限时提供最小候选供后续缩放或报错决策。
 * 逻辑维度：先执行首项建立 smallest；依次尝试剩余项，命中上限立即返回，否则持续更新最小项。
 * 关键边界：attempts 至少一项，maxBytes 应为正数；候选只在需要时执行且按声明顺序。
 * 新手阅读建议：先看两个接口，再沿 first、smallest、remaining 循环和最终 { smallest } 阅读。
 */

/** One encoded candidate carrying its complete bytes. */
/** 一个携带完整编码字节的候选结果。 */
export interface EncodedCandidate {
  // 完整编码数据，byteLength 用于上限比较。
  data: Uint8Array
}

/** Result of exhausting candidates at one raster size without a fitting output. */
/** 同一栅格尺寸所有候选均超限时的结果。 */
export interface ExhaustedEncoding<T extends EncodedCandidate> {
  // 已完成候选中占用字节最少的一项。
  smallest: T
}

/**
 * Execute encoding candidates in preference order and stop after the first fitting output.
 * @param attempts - lazy encoders ordered from preferred to fallback representation.
 * @param maxBytes - positive encoded-byte cap.
 * @returns the first fitting candidate, otherwise the smallest completed fallback.
 */
/** 按序编码。@param attempts 惰性编码器数组。@param maxBytes 正数字节上限。@returns 首个合格项或最小超限项。@example await encodeFirstWithinLimit([encodePng], 1024)。 */
export async function encodeFirstWithinLimit<T extends EncodedCandidate>(
  attempts: readonly (() => Promise<T>)[],
  maxBytes: number,
): Promise<T | ExhaustedEncoding<T>> {
  // 第一编码器和剩余候选；第一项缺失时输入无效。
  const [first, ...remaining] = attempts
  if (first === undefined) throw new Error('image encoding requires at least one candidate')
  // 当前已完成候选中最小的一项，初始为首个结果。
  let smallest = await first()
  if (smallest.data.byteLength <= maxBytes) return smallest
  // 当前剩余惰性编码器。
  for (const attempt of remaining) {
    // 当前编码候选。
    const candidate = await attempt()
    if (candidate.data.byteLength <= maxBytes) return candidate
    if (candidate.data.byteLength < smallest.data.byteLength) {
      smallest = candidate
    }
  }
  return { smallest }
}

/**
 * Whether a lazy encoding result exhausted every candidate at one size.
 * @param result - first fitting candidate or exhausted result.
 * @returns whether every candidate exceeded the byte cap.
 */
/** 判断是否已穷尽候选。@param result 编码结果。@returns 含 smallest 时为 true。@example isExhaustedEncoding(result)。 */
export function isExhaustedEncoding<T extends EncodedCandidate>(
  result: T | ExhaustedEncoding<T>,
): result is ExhaustedEncoding<T> {
  return 'smallest' in result
}
