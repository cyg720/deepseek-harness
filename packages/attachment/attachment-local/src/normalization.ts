/** Deterministic provider-independent image normalization. */
/**
 * 文件职责：把已准入图片转换为确定、无元数据、提供方无关的单帧8位sRGB持久版本。
 * 技术维度：使用 sharp 旋转方向、转换色彩空间、采样颜色复杂度，并按多个编码质量与尺寸逐级尝试。
 * 产品维度：让历史会话只保存体积受控且可重复使用的图片，避免每次模型请求重复处理原始大图。
 * 逻辑维度：先判断能否字节直通，否则分类低色彩图片，按透明度选择格式，超出字节上限时持续缩小尺寸。
 * 关键边界：GIF和动画不能直通；重编码不丢透明度；即使缩到1×1仍超限时拒绝图片。
 * 新手阅读建议：先看 canPassThroughNormalization 的全部条件，再看编码尝试顺序，最后跟踪 normalizeImage 的缩放循环。
 */

import sharp, { type Sharp } from 'sharp'
import { AttachmentError } from '@deepseek-ai/dsh-attachment'
import type { ImageMediaType } from '@deepseek-ai/dsh-attachment'
import { encodeFirstWithinLimit, isExhaustedEncoding } from './encoding.ts'
import { detectImage, encodedAlphaIsCompatible } from './image.ts'
import type { DetectedImage } from './image.ts'

/** Deployment-resolved policy for the persisted normalized attachment. */
/** 部署解析后的持久规范化策略。 */
export interface NormalizationPolicy {
  /** Long-edge cap in pixels; larger sources are downscaled proportionally. */
  /** 长边像素上限，较大来源按比例缩小。 */
  maxDimension: number
  /** Independent safety cap for encoded normalized image bytes. */
  /** 规范化图片编码字节的独立安全上限。 */
  maxBytes: number
}

/** Normalized bytes beside the facts recorded by a durable reference. */
/** 规范化字节及其将写入持久引用的真实格式和尺寸。 */
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

// 有损编码按此质量从高到低尝试，避免无界搜索。
const NORMALIZATION_QUALITIES = [85, 80, 75] as const
// 判断颜色复杂度时的最大采样边长。
const LOW_COLOUR_SAMPLE_EDGE = 128
// 量化采样中仍视为低色彩图片的最大颜色数。
const LOW_COLOUR_LIMIT = 256
// 每轮超限后最多保留上一轮90%的尺寸，保证循环持续前进。
const MIN_SCALE_STEP = 0.9

/** Encode one prepared pipeline and report exact output facts. */
/** 按目标格式和质量编码已准备管线，并返回真实字节与尺寸。 */
async function encode(
  pipeline: Sharp,
  mediaType: 'image/png' | 'image/jpeg' | 'image/webp',
  quality?: number,
  palette = true,
): Promise<NormalizedImage> {
  // 根据目标媒体类型配置的 sharp 编码管线。
  const encoded = mediaType === 'image/png'
    ? pipeline.png({ compressionLevel: 9, palette })
    : mediaType === 'image/webp'
      ? pipeline.webp({ quality })
      : pipeline.jpeg({ quality })
  // 编码后的字节及 sharp 报告的最终宽高。
  const { data, info } = await encoded.toBuffer({ resolveWithObject: true })
  return { data: new Uint8Array(data), mediaType, width: info.width, height: info.height }
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
    && Math.max(detected.width, detected.height) <= policy.maxDimension
}

/**
 * Classify a bounded pixel sample without assuming that a PNG source is a screenshot.
 * @param pipeline - oriented sRGB source pipeline before output resizing.
 * @returns whether the nearest-neighbour sample stays within the low-color threshold.
 */
export async function hasLowColourCount(pipeline: Sharp): Promise<boolean> {
  // 最近邻缩小后取得的原始像素和通道数量。
  const { data, info } = await pipeline.clone().resize({
    width: LOW_COLOUR_SAMPLE_EDGE,
    height: LOW_COLOUR_SAMPLE_EDGE,
    fit: 'inside',
    withoutEnlargement: true,
    kernel: sharp.kernel.nearest,
    fastShrinkOnLoad: false,
  }).raw().toBuffer({ resolveWithObject: true })
  // 将各通道压缩为5位后收集的近似颜色集合。
  const colours = new Set<number>()
  for (let offset = 0; offset < data.length; offset += info.channels) {
    // 当前采样像素的红色通道。
    const red = data.readUInt8(offset)
    // 当前采样像素的绿色通道。
    const green = data.readUInt8(offset + 1)
    // 当前采样像素的蓝色通道。
    const blue = data.readUInt8(offset + 2)
    // 当前采样像素的透明度；无alpha时按完全不透明处理。
    const alpha = info.channels === 4 ? data.readUInt8(offset + 3) : 255
    colours.add(((red >> 3) << 15) | ((green >> 3) << 10) | ((blue >> 3) << 5) | (alpha >> 3))
    if (colours.size > LOW_COLOUR_LIMIT) return false
  }
  return true
}

/** Assert that a normalized output is an 8-bit sRGB/sRGBA single-frame image with matching facts. */
/** 完整解码规范化结果，确认它是事实一致的单帧8位sRGB/sRGBA图片。 */
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
/** 从提交字节构建方向正确、无保留元数据、固定尺寸的sRGB管线。 */
function preparedPipeline(data: Uint8Array, width: number, height: number): Sharp {
  return sharp(data, { failOn: 'error', limitInputPixels: false })
    .rotate()
    .toColourspace('srgb')
    .resize({ width, height, fit: 'inside', withoutEnlargement: true })
}

/** Dimensions after the long edge is capped without changing aspect ratio. */
/** 在不改变宽高比的前提下计算长边受限后的初始整数尺寸。 */
function initialDimensions(detected: DetectedImage, maxDimension: number): { width: number; height: number } {
  // 不放大来源且让长边不超过策略上限的比例。
  const scale = Math.min(1, maxDimension / Math.max(detected.width, detected.height))
  return {
    width: Math.max(1, Math.round(detected.width * scale)),
    height: Math.max(1, Math.round(detected.height * scale)),
  }
}

/** Lazy encoding order for one size, separated by sampled colour complexity and alpha. */
/** 根据低色彩分类和透明度构造某一尺寸的惰性编码尝试顺序。 */
function encodingAttemptsAtSize(
  data: Uint8Array,
  width: number,
  height: number,
  hasAlpha: boolean,
  lowColour: boolean,
): Array<() => Promise<NormalizedImage>> {
  // 当前尺寸可重复克隆的基础sharp管线。
  const prepared = preparedPipeline(data, width, height)
  // 从高到低质量的WebP编码任务。
  const webp = NORMALIZATION_QUALITIES.map(quality => (
    () => encode(prepared.clone(), 'image/webp', quality)
  ))
  if (lowColour) {
    return [() => encode(prepared.clone(), 'image/png', undefined, !hasAlpha), ...webp]
  }
  if (hasAlpha) return webp
  return NORMALIZATION_QUALITIES.map(quality => (
    () => encode(prepared.clone(), 'image/jpeg', quality)
  ))
}

/**
 * Produce the persisted provider-independent normalized version of one fully decoded source.
 * The source is passed through only when it is already clean, single-frame, 8-bit sRGB/sRGBA,
 * and inside both normalization limits. Re-encoding never removes transparency. After the fixed
 * quality floor is reached, dimensions continue shrinking until the independent byte cap holds.
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
    // 首轮按长边上限计算的目标宽高，后续可继续缩小。
    let { width, height } = initialDimensions(detected, policy.maxDimension)
    // 仅用于低色彩采样的方向正确sRGB管线。
    const classificationPipeline = sharp(data, { failOn: 'error', limitInputPixels: false })
      .rotate()
      .toColourspace('srgb')
    // 来源图片是否适合优先尝试无损调色板PNG。
    const lowColour = await hasLowColourCount(classificationPipeline)
    for (;;) {
      // 当前尺寸全部格式尝试的首个合格结果或最小失败结果。
      const encoded = await encodeFirstWithinLimit(
        encodingAttemptsAtSize(data, width, height, detected.hasAlpha, lowColour),
        policy.maxBytes,
      )
      if (!isExhaustedEncoding(encoded)) {
        return await verifyNormalizedImage(encoded, detected.mediaType === 'image/gif' ? undefined : detected.hasAlpha)
      }
      if (width === 1 && height === 1) break
      // 根据字节超限比例估算下一轮面积缩放，并留5%余量。
      const sizeScale = Math.sqrt(policy.maxBytes / encoded.smallest.data.byteLength) * 0.95
      // 保证至少缩小10%，避免因估算接近1而停滞。
      const scale = Math.min(MIN_SCALE_STEP, sizeScale)
      // 下一轮不小于1像素的宽度。
      const nextWidth = Math.max(1, Math.floor(width * scale))
      // 下一轮不小于1像素的高度。
      const nextHeight = Math.max(1, Math.floor(height * scale))
      width = nextWidth
      height = nextHeight
    }
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
  throw new AttachmentError('Image cannot be encoded within the configured normalized-image byte cap.', 'IMAGE_TOO_LARGE')
}
