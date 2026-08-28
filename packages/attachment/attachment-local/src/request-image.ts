/** Deterministic cached image versions for model requests. */
/*
 * 文件职责：按模型路由的像素和字节预算生成确定性请求图片，并在本地缓存验证后的变体。
 * 技术维度：使用SHA-256变体标识、sharp多格式编码、内容校验和原子临时文件替换实现可复用缓存。
 * 产品维度：让同一持久附件适配不同模型限制，减少重复压缩，同时不信任损坏或过期缓存。
 * 逻辑维度：校验策略并计算尺寸，选择编码顺序，必要时逐轮缩小，验证输出事实，再读写内容寻址缓存。
 * 关键边界：策略数值必须为正安全整数；缓存身份包含转换版本与全部策略；取消信号在I/O和转换前后检查。
 * 新手阅读建议：先看 descriptor 如何形成缓存身份，再看 requestImageDimensions，最后跟踪 readRequestImageFile 的缓存分支。
 */

import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import sharp, { type Sharp } from 'sharp'
import { AttachmentError, ImageVariantId, requestImageDimensions } from '@deepseek-ai/dsh-attachment'
import type {
  ImageMediaType,
  ImageAttachmentRef,
  ImageRequestPolicy,
  RequestImageAttachment,
  StoredImageAttachment,
} from '@deepseek-ai/dsh-attachment'
import {
  IMAGE_ENCODING_QUALITIES,
  WEBP_ENCODING_EFFORT,
  encodeFirstWithinLimit,
  encodingLadder,
  isExhaustedEncoding,
} from './encoding.ts'
import { detectImage, encodedAlphaIsCompatible, probeImage } from './image.ts'

/** Transform version included in every cache and upload-index identity. */
export const REQUEST_IMAGE_TRANSFORM_VERSION = 'request-image-v5'

/** 尚未重新解码验证的请求图片编码结果。 */
interface EncodedRequestImage {
  /** 编码后的图片字节。 */
  data: Uint8Array
  /** 编码器目标媒体类型。 */
  mediaType: ImageMediaType
  /** 编码器报告的宽度。 */
  width: number
  /** 编码器报告的高度。 */
  height: number
}

/** 已完整验证并补充透明通道事实的请求图片。 */
interface VerifiedRequestImage extends EncodedRequestImage {
  /** 解码像素是否含透明通道。 */
  hasAlpha: boolean
}

/** 计算字符串或字节的SHA-256十六进制摘要。 */
function digest(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

function checkedInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new AttachmentError(`${name} must be a positive integer.`, 'INVALID_ATTACHMENT_REF')
  }
  return value
}

/** 校验模型请求图片的像素和字节预算。 */
function validatePolicy(policy: ImageRequestPolicy): void {
  checkedInteger(policy.maxPixels, 'Image request maxPixels')
  checkedInteger(policy.maxBytes, 'Image request maxBytes')
}

/** 把来源、策略和编码算法全部序列化为稳定变体描述。 */
function descriptor(attachment: ImageAttachmentRef, policy: ImageRequestPolicy): string {
  return JSON.stringify({
    transformVersion: REQUEST_IMAGE_TRANSFORM_VERSION,
    attachmentId: attachment.attachmentId,
    routePixelBudget: policy.maxPixels,
    encodedByteBudget: policy.maxBytes,
    encoding: {
      webpQualities: IMAGE_ENCODING_QUALITIES,
      webpEffort: WEBP_ENCODING_EFFORT,
      jpegQualities: IMAGE_ENCODING_QUALITIES,
      order: ['alpha:webp', 'opaque:jpeg'],
      colourspace: 'srgb',
    },
  })
}

/**
 * Complete deterministic identity for one attachment and route-owned request policy.
 * @param attachment - provider-independent durable normalized attachment reference.
 * @param policy - route-owned pixel and byte policy.
 * @returns branded digest over every request transform input.
 */
export function requestImageVariantId(
  attachment: ImageAttachmentRef,
  policy: ImageRequestPolicy,
): ReturnType<typeof ImageVariantId> {
  return ImageVariantId(`sha256:${digest(descriptor(attachment, policy))}`)
}

/** 构建指定最大宽高的请求图片缩放管线。 */
function pipeline(attachment: StoredImageAttachment, width: number, height: number): Sharp {
  return sourcePipeline(attachment)
    .resize({ width, height, fit: 'inside', withoutEnlargement: true })
}

/** 从已验证持久字节构建sRGB来源管线。 */
function sourcePipeline(attachment: StoredImageAttachment): Sharp {
  return sharp(attachment.data, { failOn: 'error', limitInputPixels: false }).toColourspace('srgb')
}

async function createRequestImage(
  attachment: StoredImageAttachment,
  policy: ImageRequestPolicy,
  hasAlpha: boolean,
): Promise<EncodedRequestImage> {
  const dimensions = requestImageDimensions(attachment.ref.width, attachment.ref.height, policy.maxPixels)
  if (dimensions.width === attachment.ref.width
    && dimensions.height === attachment.ref.height
    && attachment.data.byteLength <= policy.maxBytes) {
    return {
      data: attachment.data,
      mediaType: attachment.ref.mediaType,
      width: attachment.ref.width,
      height: attachment.ref.height,
    }
  }
  const encodedVersion = await encodeFirstWithinLimit(
    encodingLadder(pipeline(attachment, dimensions.width, dimensions.height), hasAlpha),
    policy.maxBytes,
  )
  return isExhaustedEncoding(encodedVersion) ? encodedVersion.smallest : encodedVersion
}

/** 根据变体摘要构造两级分桶缓存路径。 */
function cachePath(root: string, hash: string): string {
  return join(root, 'request-images', hash.slice(0, 2), hash)
}

/** 读取并验证缓存图片，缺失、损坏或不符合当前策略时返回undefined。 */
async function readCached(
  path: string,
  attachment: StoredImageAttachment,
  policy: ImageRequestPolicy,
  expectedAlpha: boolean,
  signal?: AbortSignal,
): Promise<VerifiedRequestImage | undefined> {
  try {
    // 从缓存读取的候选图片字节。
    const data = new Uint8Array(await readFile(path, { signal }))
    // 候选缓存的格式、尺寸和像素事实。
    const detected = await probeImage(data)
    // 当前策略允许的最大宽高。
    const maximum = requestImageDimensions(attachment.ref.width, attachment.ref.height, policy.maxPixels)
    if (detected.depth !== 'uchar' || detected.space !== 'srgb'
      || detected.width > maximum.width || detected.height > maximum.height
      || !encodedAlphaIsCompatible(expectedAlpha, detected)) return undefined
    return { data, mediaType: detected.mediaType, width: detected.width, height: detected.height, hasAlpha: detected.hasAlpha }
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException | null)?.code === 'ENOENT') return undefined
    signal?.throwIfAborted()
    return undefined
  }
}

/** 完整解码新编码结果并确认格式、尺寸、色彩和alpha事实一致。 */
async function verifyRequestImage(
  image: EncodedRequestImage,
  expectedAlpha: boolean,
): Promise<VerifiedRequestImage> {
  // 从新编码字节重新检测的权威事实。
  const detected = await detectImage(image.data)
  if (detected.depth !== 'uchar' || detected.space !== 'srgb'
    || detected.width !== image.width || detected.height !== image.height
    || detected.mediaType !== image.mediaType || !encodedAlphaIsCompatible(expectedAlpha, detected)) {
    throw new AttachmentError(
      'Encoded model-request image does not match its verified 8-bit sRGB metadata.',
      'ATTACHMENT_WRITE_FAILED',
    )
  }
  return { ...image, hasAlpha: detected.hasAlpha }
}

/** 通过同目录独占临时文件和原子重命名写入缓存。 */
async function writeCached(path: string, data: Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  // 与目标同目录且不会与并发写入冲突的临时文件路径。
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, data, { mode: 0o600, flag: 'wx' })
    await rename(temporary, path)
  } finally {
    await rm(temporary, { force: true })
  }
}

/**
 * Generate or reuse one request image below the local attachment root.
 * @param root - absolute versioned attachment storage root.
 * @param attachment - verified normalized attachment bytes and reference.
 * @param policy - exact route request-image policy.
 * @param signal - optional cancellation for cache I/O and image transformation.
 * @returns verified request bytes and deterministic variant identity.
 */
export async function readRequestImageFile(
  root: string,
  attachment: StoredImageAttachment,
  policy: ImageRequestPolicy,
  signal?: AbortSignal,
): Promise<RequestImageAttachment> {
  signal?.throwIfAborted()
  validatePolicy(policy)
  // 已验证持久附件的来源像素事实，主要用于alpha兼容检查。
  const source = await probeImage(attachment.data)
  // 来源引用与完整路由策略决定的确定性变体标识。
  const variantId = requestImageVariantId(attachment.ref, policy)
  // 去掉品牌前缀后用于缓存分桶的纯SHA-256摘要。
  const hash = String(variantId).slice('sha256:'.length)
  // 当前变体对应的本地缓存文件路径。
  const path = cachePath(root, hash)
  // 通过当前策略和来源alpha重新验证后的缓存结果。
  const cached = await readCached(path, attachment, policy, source.hasAlpha, signal)
  // 缓存不存在时生成的候选版本；缓存命中时直接复用。
  const created = cached ?? await createRequestImage(attachment, policy, source.hasAlpha)
  // 最终具备可信alpha事实的请求图片版本。
  const version = cached ?? (created.data === attachment.data
    ? { ...created, hasAlpha: source.hasAlpha }
    : await verifyRequestImage(created, source.hasAlpha))
  signal?.throwIfAborted()
  if (cached === undefined && version.data !== attachment.data) await writeCached(path, version.data)
  return {
    variantId,
    attachment: attachment.ref,
    data: version.data,
    mediaType: version.mediaType,
    bytes: version.data.byteLength,
    width: version.width,
    height: version.height,
    depth: 'uchar',
    space: 'srgb',
    hasAlpha: version.hasAlpha,
  }
}
