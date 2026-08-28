/** Shared quality ladder and lazy candidate execution for normalization and request-image encoders. */

import type { Sharp } from 'sharp'

/** Shared ladder for both encoders: spaced so each step buys a real size reduction. */
export const IMAGE_ENCODING_QUALITIES = [85, 75, 60] as const
/** Fixed lossy-WebP effort; deeper search costs 3-4x encode time for about 5% size. */
export const WEBP_ENCODING_EFFORT = 0

/** One ladder output carrying its complete bytes and exact facts. */
export interface EncodedImage {
  data: Uint8Array
  mediaType: 'image/jpeg' | 'image/webp'
  width: number
  height: number
}

async function encode(pipeline: Sharp, mediaType: EncodedImage['mediaType'], quality: number): Promise<EncodedImage> {
  const encoded = mediaType === 'image/webp'
    ? pipeline.webp({ quality, effort: WEBP_ENCODING_EFFORT })
    : pipeline.jpeg({ quality })
  const { data, info } = await encoded.toBuffer({ resolveWithObject: true })
  return { data: new Uint8Array(data), mediaType, width: info.width, height: info.height }
}

/**
 * Build the lazy quality ladder for one prepared pipeline: WebP keeps a source
 * alpha channel, everything else is JPEG.
 * @param prepared - sized sRGB pipeline; cloned per candidate.
 * @param hasAlpha - decoded source alpha fact selecting the codec.
 * @returns encoders ordered from highest to lowest ladder quality.
 */
export function encodingLadder(prepared: Sharp, hasAlpha: boolean): Array<() => Promise<EncodedImage>> {
  const mediaType = hasAlpha ? 'image/webp' : 'image/jpeg'
  return IMAGE_ENCODING_QUALITIES.map(quality => (
    () => encode(prepared.clone(), mediaType, quality)
  ))
}

/** One encoded candidate carrying its complete bytes. */
/* 一个携带完整编码字节的候选结果。 */
export interface EncodedCandidate {
  // 完整编码数据，byteLength 用于上限比较。
  data: Uint8Array
}

/** Result of exhausting candidates at one raster size without a fitting output. */
/* 同一栅格尺寸所有候选均超限时的结果。 */
export interface ExhaustedEncoding<T extends EncodedCandidate> {
  // 已完成候选中占用字节最少的一项。
  smallest: T
}

/**
 * Execute encoding candidates in preference order and stop after the first fitting output.
 * @param attempts - lazy encoders ordered from preferred to fallback representation.
 * @param maxBytes - positive encoded-byte target.
 * @returns the first fitting candidate, otherwise the smallest completed fallback.
 */
/*
 * 按序编码。@param attempts 惰性编码器数组。@param maxBytes 正数字节上限。@returns 首个合格项或最小超限项。@example await encodeFirstWithinLimit([encodePng], 1024)。
 * @param attempts 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @param maxBytes 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
 */
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
 * @returns whether every candidate exceeded the byte target.
 */
/*
 * 判断是否已穷尽候选。@param result 编码结果。@returns 含 smallest 时为 true。@example isExhaustedEncoding(result)。
 * @param result 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
 */
export function isExhaustedEncoding<T extends EncodedCandidate>(
  result: T | ExhaustedEncoding<T>,
): result is ExhaustedEncoding<T> {
  return 'smallest' in result
}
