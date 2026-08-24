/** Raster inspection: full decode at admission, header-only probe on verified reads. */
/**
 * 文件职责：识别受支持栅格图片的真实格式、尺寸、动画、元数据和像素特征。
 * 技术维度：使用 sharp/libvips 在准入时完整解码，在摘要验证后的读取路径只解析图片头。
 * 产品维度：阻止畸形、超大或伪装媒体类型的图片进入附件库，并为后续压缩提供可靠事实。
 * 逻辑维度：把 sharp 元数据转换为统一结构，按 EXIF 方向调整可见尺寸，再分别提供快速探测和完整检测。
 * 关键边界：只支持 PNG、JPEG、WebP、GIF；完整检测可限制像素数和单边尺寸；任何解析失败统一为附件错误。
 * 新手阅读建议：先看 DetectedImage 字段，再读 imageMetadata 的格式和方向处理，最后比较 probeImage 与 detectImage。
 */

import sharp, { type Sharp } from 'sharp'
import { AttachmentError } from '@deepseek-ai/dsh-attachment'
import type { ImageMediaType } from '@deepseek-ai/dsh-attachment'

/** Decoded metadata from a supported image. */
/** 从受支持图片解码得到、供准入和编码验证共用的事实。 */
export interface DetectedImage {
  /** 图片字节真实对应的受支持 MIME 类型。 */
  mediaType: ImageMediaType
  /** Intrinsic width with EXIF orientation applied — the width a viewer perceives. */
  /** 应用 EXIF 方向后用户实际看到的宽度。 */
  width: number
  /** Intrinsic height with EXIF orientation applied — the height a viewer perceives. */
  /** 应用 EXIF 方向后用户实际看到的高度。 */
  height: number
  /** Whether the container carries more than one frame. */
  /** 容器是否包含多帧动画。 */
  animated: boolean
  /** Whether the bytes carry descriptive metadata, a color profile, or orientation. */
  /** 字节是否携带描述、色彩配置或方向等会被保留的元数据。 */
  carriesMetadata: boolean
  /** Sharp sample depth reported for the decoded channels. */
  /** sharp 报告的像素通道采样深度。 */
  depth: string
  /** Sharp colour space reported for the decoded pixels. */
  /** sharp 报告的解码像素色彩空间。 */
  space: string
  /** Whether decoded pixels carry an alpha channel. */
  /** 解码像素是否包含透明度通道。 */
  hasAlpha: boolean
}

/**
 * Check alpha metadata for bytes produced by this package's encoders.
 * Sharp/libvips may omit an all-opaque alpha plane from WebP output; every
 * other addition or removal indicates that the encoded result is incompatible
 * with its source facts.
 * @param sourceHasAlpha - whether the source bytes declare an alpha plane, or undefined when the source frame is unspecified.
 * @param output - decoded media type and alpha metadata from the encoded result.
 * @returns whether the output alpha metadata is compatible with the source.
 */
/** 检查本包编码结果的透明通道事实是否与来源兼容，允许 WebP 去掉全不透明 alpha。 */
export function encodedAlphaIsCompatible(
  sourceHasAlpha: boolean | undefined,
  output: Pick<DetectedImage, 'mediaType' | 'hasAlpha'>,
): boolean {
  return sourceHasAlpha === undefined
    || output.hasAlpha === sourceHasAlpha
    || (sourceHasAlpha && !output.hasAlpha && output.mediaType === 'image/webp')
}

// sharp 格式名称到附件协议 MIME 类型的白名单映射。
const MEDIA_TYPES: Readonly<Record<string, ImageMediaType>> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
}

/** 判断 sharp 元数据中是否存在描述、配置、方向等需要规范化移除的字段。 */
function carriesRetainedMetadata(metadata: Awaited<ReturnType<Sharp['metadata']>>): boolean {
  return metadata.exif !== undefined
    || metadata.xmp !== undefined
    || metadata.iptc !== undefined
    || metadata.icc !== undefined
    || metadata.hasProfile
    || metadata.tifftagPhotoshop !== undefined
    || metadata.comments !== undefined
    || metadata.orientation !== undefined
}

/** 从 sharp 管线读取并统一图片格式、方向尺寸和像素事实。 */
async function imageMetadata(image: Sharp): Promise<DetectedImage> {
  // sharp 对图片头解析得到的原始元数据。
  const metadata = await image.metadata()
  // 从格式白名单收窄出的附件媒体类型。
  const mediaType = MEDIA_TYPES[metadata.format as string]
  if (mediaType === undefined) {
    throw new AttachmentError('Unsupported or malformed image data.', 'INVALID_IMAGE')
  }
  // EXIF orientations 5-8 transpose the stored raster; report the perceived
  // axes so limits, source facts, and coordinate advice all share them.
  // 方向5至8会交换存储轴，因此所有尺寸策略都使用用户可见轴。
  const transposed = metadata.orientation !== undefined && metadata.orientation >= 5
  return {
    mediaType,
    width: transposed ? metadata.height : metadata.width,
    height: transposed ? metadata.width : metadata.height,
    animated: (metadata.pages ?? 1) > 1,
    carriesMetadata: carriesRetainedMetadata(metadata),
    depth: metadata.depth,
    space: metadata.space,
    hasAlpha: metadata.hasAlpha,
  }
}

/**
 * Parse a supported raster's header and return its intrinsic metadata without
 * decoding pixels. Digest-verified reads use this: admission already proved
 * that these exact bytes decode completely, so the read path only re-derives
 * the reference fields instead of paying the full-raster decode again.
 * @param data - complete encoded image bytes.
 * @returns verified format and dimensions.
 */
export async function probeImage(data: Uint8Array): Promise<DetectedImage> {
  try {
    return await imageMetadata(sharp(data, { failOn: 'error', limitInputPixels: false }))
  } catch (error) {
    if (error instanceof AttachmentError) throw error
    throw new AttachmentError('Unsupported or malformed image data.', 'INVALID_IMAGE', { cause: error })
  }
}

/** Admission limits applied to a decoded raster's intrinsic dimensions. */
/** 对完整解码图片的固有尺寸执行的可选准入限制。 */
export interface DecodedImageLimits {
  /** Decoded-pixel (width times height) admission limit. */
  /** 最大解码像素总数，即宽乘高。 */
  maxPixels?: number
  /** Per-side admission limit applied to width and height independently. */
  /** 分别应用于宽和高的最大单边像素数。 */
  maxDimension?: number
}

/**
 * Fully decode a supported raster and return its intrinsic metadata.
 * @param data - complete encoded image bytes.
 * @param limits - intrinsic-dimension admission limits.
 * @returns verified format and dimensions.
 */
export async function detectImage(data: Uint8Array, limits?: DecodedImageLimits): Promise<DetectedImage> {
  try {
    // 禁用 sharp 自带像素限制，由部署配置在读取真实方向尺寸后统一判断。
    const image = sharp(data, { failOn: 'error', limitInputPixels: false })
    // 图片头解析得到的统一事实。
    const detected = await imageMetadata(image)
    if (limits?.maxPixels !== undefined && detected.width * detected.height > limits.maxPixels) {
      throw new AttachmentError('Image exceeds the configured decoded-pixel limit.', 'IMAGE_TOO_MANY_PIXELS')
    }
    if (limits?.maxDimension !== undefined && Math.max(detected.width, detected.height) > limits.maxDimension) {
      throw new AttachmentError('Image exceeds the configured per-side pixel limit.', 'IMAGE_DIMENSION_TOO_LARGE')
    }
    await image.raw().toBuffer()
    return detected
  } catch (error) {
    if (error instanceof AttachmentError) throw error
    throw new AttachmentError('Unsupported or malformed image data.', 'INVALID_IMAGE', { cause: error })
  }
}
