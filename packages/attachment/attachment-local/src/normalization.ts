/** Deterministic provider-independent image normalization. */
/*
 * 文件职责：把已准入图片转换为确定、无元数据、提供方无关的单帧8位sRGB持久版本。
 * 技术维度：使用 sharp 旋转方向、转换色彩空间、采样颜色复杂度，并按多个编码质量与尺寸逐级尝试。
 * 产品维度：让历史会话只保存体积受控且可重复使用的图片，避免每次模型请求重复处理原始大图。
 * 逻辑维度：先判断能否字节直通，否则分类低色彩图片，按透明度选择格式，超出字节上限时持续缩小尺寸。
 * 关键边界：GIF和动画不能直通；重编码不丢透明度；即使缩到1×1仍超限时拒绝图片。
 * 新手阅读建议：先看 canPassThroughNormalization 的全部条件，再看编码尝试顺序，最后跟踪 normalizeImage 的缩放循环。
 */

import sharp, { type Sharp } from 'sharp'
import { AttachmentError, requestImageDimensions } from '@deepseek-ai/dsh-attachment'
import type { ImageMediaType } from '@deepseek-ai/dsh-attachment'
import { encodeFirstWithinLimit, encodingLadder, isExhaustedEncoding } from './encoding.ts'
import { detectImage, encodedAlphaIsCompatible } from './image.ts'
import type { DetectedImage } from './image.ts'

/** Deployment-resolved policy for the persisted normalized attachment. */
/* 部署解析后的持久规范化策略。 */
export interface NormalizationPolicy {
  /** Total-pixel budget; larger sources are downscaled proportionally. */
  maxPixels: number
  /** Long-edge cap in pixels applied after the total-pixel budget, bounding extreme aspect ratios. */
  maxDimension: number
  /** Encoded-byte target for the quality ladder; the smallest ladder output is kept when no quality fits. */
  maxBytes: number
}

/** Normalized bytes beside the facts recorded by a durable reference. */
/* 规范化字节及其将写入持久引用的真实格式和尺寸。 */
export interface NormalizedImage {
  /** 最终编码图片字节。 */
  data: Uint8Array
  /** 与字节实际格式一致的 MIME 类型。 */
  mediaType: ImageMediaType
  /** 最终图片宽度。 */
  width: number
  /** 最终图片高度。 */
  height: number
}

/**
 * Whether bytes already satisfy the normalization requirements.
 * @param detected - fully decoded source facts.
 * @param bytes - encoded source length.
 * @param policy - resolved normalization limits.
 * @returns whether the source can pass through byte-identically.
 */
export function canPassThroughNormalization(
  detected: DetectedImage,
  bytes: number,
  policy: NormalizationPolicy,
): boolean {
  return detected.mediaType !== 'image/gif'
    && !detected.animated
    && !detected.carriesMetadata
    && detected.depth === 'uchar'
    && detected.space === 'srgb'
    && bytes <= policy.maxBytes
    && detected.width * detected.height <= policy.maxPixels
    && Math.max(detected.width, detected.height) <= policy.maxDimension
}

/** Assert that a normalized output is an 8-bit sRGB/sRGBA single-frame image with matching facts. */
/* 完整解码规范化结果，确认它是事实一致的单帧8位sRGB/sRGBA图片。 */
async function verifyNormalizedImage(
  image: NormalizedImage,
  expectedAlpha: boolean | undefined,
): Promise<NormalizedImage> {
  // 从最终字节重新检测的权威图片事实。
  const detected = await detectImage(image.data)
  if (detected.mediaType !== image.mediaType
    || detected.width !== image.width
    || detected.height !== image.height
    || detected.animated
    || detected.carriesMetadata
    || detected.depth !== 'uchar'
    || detected.space !== 'srgb'
    || !encodedAlphaIsCompatible(expectedAlpha, detected)) {
    throw new AttachmentError(
      'Image normalization did not produce a single-frame 8-bit sRGB image with matching metadata.',
      'ATTACHMENT_WRITE_FAILED',
    )
  }
  return image
}

/** Build one fixed-size, oriented, metadata-free sRGB pipeline from submitted bytes. */
/* 从提交字节构建方向正确、无保留元数据、固定尺寸的sRGB管线。 */
function preparedPipeline(data: Uint8Array, width: number, height: number): Sharp {
  return sharp(data, { failOn: 'error', limitInputPixels: false })
    .rotate()
    .toColourspace('srgb')
    .resize({ width, height, fit: 'inside', withoutEnlargement: true })
}

/** Dimensions under the total-pixel budget, then the long-edge cap, without changing aspect ratio. */
function initialDimensions(detected: DetectedImage, policy: NormalizationPolicy): { width: number; height: number } {
  const budgeted = requestImageDimensions(detected.width, detected.height, policy.maxPixels)
  const longEdge = Math.max(budgeted.width, budgeted.height)
  if (longEdge <= policy.maxDimension) return budgeted
  const scale = policy.maxDimension / longEdge
  return {
    width: Math.max(1, Math.floor(budgeted.width * scale)),
    height: Math.max(1, Math.floor(budgeted.height * scale)),
  }
}

/**
 * Produce the persisted provider-independent normalized version of one fully decoded source.
 * The source is passed through only when it is already clean, single-frame, 8-bit sRGB/sRGBA,
 * and inside every normalization limit. Re-encoding never removes transparency. When every
 * ladder quality exceeds the byte target, the smallest ladder output is kept; provider byte
 * caps stay enforced at the route that transmits the bytes.
 * @param data - complete admitted source bytes.
 * @param detected - fully decoded source facts.
 * @param policy - resolved independent normalization limits.
 * @returns verified provider-independent normalized bytes and metadata.
 */
export async function normalizeImage(
  data: Uint8Array,
  detected: DetectedImage,
  policy: NormalizationPolicy,
): Promise<NormalizedImage> {
  if (canPassThroughNormalization(detected, data.byteLength, policy)) {
    return { data, mediaType: detected.mediaType, width: detected.width, height: detected.height }
  }
  try {
    const { width, height } = initialDimensions(detected, policy)
    const encoded = await encodeFirstWithinLimit(
      encodingLadder(preparedPipeline(data, width, height), detected.hasAlpha),
      policy.maxBytes,
    )
    const chosen = isExhaustedEncoding(encoded) ? encoded.smallest : encoded
    return await verifyNormalizedImage(chosen, detected.mediaType === 'image/gif' ? undefined : detected.hasAlpha)
  } catch (error) {
    if (error instanceof AttachmentError) throw error
    // 面向用户的来源格式说明，对高位深PNG给出更明确诊断。
    const source = detected.mediaType === 'image/png' && detected.depth !== 'uchar'
      ? `${detected.depth === 'ushort' ? '16-bit' : detected.depth} PNG`
      : `${detected.depth} ${detected.mediaType.slice('image/'.length).toUpperCase()}`
    throw new AttachmentError(
      `The ${source} could not be converted to the normalized 8-bit sRGB form.`,
      'ATTACHMENT_WRITE_FAILED',
      { cause: error },
    )
  }
}
