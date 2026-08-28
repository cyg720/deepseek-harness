/*
 * ================================ 文件注释 ================================
 * 【文件职责】提供内容块的结构辅助：递归检测内容中是否含图片、把图片投射成
 * 确定性文本占位（纯文本模型或超限卸载）、以及按"数量/字节配额 + 量化步长"
 * 卸载最旧图片的策略实现。
 * 【技术维度】图片策略统一共用 contentHasImage 这一处递归遍历；卸载算法基于
 * 持久消息顺序与附件元数据做确定性选择（按字节统计支持 raw/base64 两种口径），
 * 不修改持久消息（原地替换产生浅拷贝）。
 * 【产品维度】多模态请求与纯文本模型、受限请求体之间的兼容：图片不能发给
 * 文本模型时给出稳定占位文本，请求体超限时按策略去掉最旧图片并告知模型，
 * 兼顾可用性与可预测性。
 * 【逻辑维度】占位文本常量 → 三类文本渲染辅助 → 递归图片检测 → 卸载策略
 * 类型 → 长度收集/替换辅助 → 两个对外入口（纯文本投射、超限卸载）。
 * 【关键边界】OFFLOADED_IMAGE_TEXT 对"最早图片先被移除"的说明必须真实；
 * 卸载目标是持久历史（oldest first）的确定性函数，重试/回放结果一致。
 * 【新手阅读建议】先看 contentHasImage 的递归结构，再读
 * offloadRequestImagesWithPolicy 的"长度收集 → 超额计算 → 替换"三段流程。
 * ==========================================================================
 */

/** Content-block structure helpers. @module @deepseek-ai/dsh-llm/content */

import type { ContentBlock } from './types.ts'
import type { Message } from './message.ts'
import type { AttachmentStore, ImageAttachmentRef, ImageMediaType, RequestImageAttachment } from '@deepseek-ai/dsh-attachment'
import { assertNever } from './never.ts'

/** Execution-world path that model tools can use to read one normalized attachment. */
export interface ImageAttachmentAccess {
  /** Absolute path to immutable normalized bytes; callers must treat it as read-only. */
  readonlyPath: string
}

/**
 * Resolve current execution-world access for one durable image reference.
 * @param ref - durable normalized attachment reference.
 * @returns a read-only execution-world path, or undefined when unavailable.
 */
export type ImageAttachmentAccessResolver = (ref: ImageAttachmentRef) => ImageAttachmentAccess | undefined

/**
 * Bridge one attachment provider's host object location into the mounted
 * tool execution world. The consumer supplies the current filesystem
 * provider's mapping without making attachment or LLM definitions depend on it.
 * @param attachments - provider that owns the normalized attachment object.
 * @param mapHostPath - map one absolute host path into the current tool execution world.
 * @param ref - durable normalized attachment reference.
 * @returns a read-only execution-world path, or undefined when either provider exposes no mapping.
 * @throws an attachment error when the durable reference is invalid.
 */
export function resolveImageAttachmentAccess(
  attachments: AttachmentStore,
  mapHostPath: (hostPath: string) => string | undefined,
  ref: ImageAttachmentRef,
): ImageAttachmentAccess | undefined {
  const hostPath = attachments.imageHostPath(ref)
  if (hostPath === undefined) return undefined
  const readonlyPath = mapHostPath(hostPath)
  return readonlyPath === undefined ? undefined : { readonlyPath }
}

function quoted(value: string): string {
  return JSON.stringify(value)
}

function imageIdentity(ref: ImageAttachmentRef): string {
  return ref.name === undefined
    ? String(ref.attachmentId)
    : `${quoted(ref.name)} (${ref.attachmentId})`
}

function extension(mediaType: ImageMediaType): string {
  switch (mediaType) {
    case 'image/png': return '.png'
    case 'image/jpeg': return '.jpg'
    case 'image/webp': return '.webp'
    case 'image/gif': return '.gif'
    default: return assertNever(mediaType, 'image extension')
  }
}

function normalizedAccessText(ref: ImageAttachmentRef, access: ImageAttachmentAccess): string {
  return ` Normalized copy (read-only; may be resized or re-encoded): ${quoted(access.readonlyPath)} (${ref.width}x${ref.height}px, ${ref.mediaType}).`
    + ' Source dimensions, format, and byte size may differ.'
    + ` Copy to a writable path ending in ${extension(ref.mediaType)} before editing.`
}

/*
 * （中文）给"无法接受持久图片引用"的模型展示的稳定文本：带附件摘要（sha256
 * 前 8 位）便于识别是哪张图。
 * @param ref 未进入请求的持久主引用。
 * @returns 确定性的纯文本占位。
 */
/**
 * Stable text shown to a model that cannot accept one durable image reference.
 * @param ref - durable normalized attachment omitted from the request.
 * @returns deterministic text-only placeholder.
 */
export function textOnlyImageText(ref: ImageAttachmentRef): string {
  const digest = String(ref.attachmentId).slice('sha256:'.length, 'sha256:'.length + 8)
  return `[image omitted because this model accepts text only; attachment sha256:${digest}]`
}

/*
 * （中文）某个精确请求图片的稳定模型可见句柄：包含附件句柄与请求图片尺寸。
 * @param version 与文本一同展示的精确请求图片。
 * @returns 附件句柄与请求图片尺寸的描述文本。
 */
/**
 * Stable model-facing handle for one exact request image. Identity comes from
 * the occurrence's own durable reference: request versions are prepared per
 * attachment id, so one shared version may serve occurrences whose display
 * names differ.
 * @param ref - the occurrence's durable normalized attachment.
 * @param version - exact request-image dimensions shown beside the text.
 * @param access - optional path resolved for the current tool execution world.
 * @returns attachment handle and request-image dimensions.
 */
export function requestImageHandleText(
  ref: ImageAttachmentRef,
  version: Pick<RequestImageAttachment, 'width' | 'height'>,
  access?: ImageAttachmentAccess,
): string {
  const preview = `Image ${imageIdentity(ref)}; request preview ${version.width}x${version.height}px.`
  return access === undefined
    ? `${preview} It may be resized or re-encoded; source dimensions, format, and byte size may differ.`
    : preview + normalizedAccessText(ref, access)
}

/**
 * Stable per-image placeholder for a request-limit omission.
 * @param ref - durable normalized attachment omitted from this request.
 * @param access - optional provider-resolved path for model tools.
 * @returns identity, normalized metadata, and the available recovery path.
 */
export function offloadedImageText(
  ref: ImageAttachmentRef,
  access?: ImageAttachmentAccess,
): string {
  const identity = `image omitted to fit request image limits; ${imageIdentity(ref)}.`
  if (access === undefined) {
    return `[${identity} No local normalized image path is available; ask the user to attach it again if needed.]`
  }
  return `[${identity}${normalizedAccessText(ref, access)}]`
}

/*
 * （中文）判断类型化模型内容里是否含图片块，会递归进入嵌套的 tool-result
 * 内容。这是所有图片策略（能力门控、纯文本序列化、压缩调查）共享的唯一递归
 * 遍历，消费方不会因嵌套深度不同而悄悄分叉。
 * @param content 类型化的模型内容块。
 * @returns 任一嵌套块是图片则返回 true。
 */
/**
 * True when typed model content contains an image block, walking nested
 * tool-result content. This is the one recursive image walk shared by every
 * image policy (capability gating, text-only serialization, compaction
 * survey), so a consumer cannot silently diverge on nesting depth.
 * @param content - typed model content blocks.
 * @returns whether any nested block is an image.
 */
export function contentHasImage(content: readonly ContentBlock[]): boolean {
  return content.some(block => block.type === 'image'
    || (block.type === 'tool-result' && contentHasImage(block.content)))
}

/** Base64 length of raw image bytes, including padding. */
// 中文：原始图片字节数对应的 base64 编码长度（含填充）：每 3 字节 → 4 字符。
function base64Length(bytes: number): number {
  return Math.ceil(bytes / 3) * 4
}

/** Byte accounting and quantized removal policy for one request representation. */
/*
 * （中文）一次请求表示（representation）的字节核算与"量化移除"策略：限制图片
 * 数量/累计字节，超限时按 countQuantum/byteQuantum 整块移除，支持 raw（原始
 * 文件字节）或 base64（内联编码长度）两种核算口径。
 */
export interface RequestImageOffloadPolicy {
  /** Image count accepted by the route; omission leaves count unbounded. */
  // 中文：路由接受的图片数量；省略表示数量不设限。
  maxImages?: number
  /** Accumulated image bytes accepted by the route; omission leaves bytes unbounded. */
  // 中文：路由接受的累计图片字节；省略表示字节不设限。
  maxBytes?: number
  /** Number of excess images removed as one deterministic step. */
  // 中文：一次确定性步骤移除的超额图片数量。
  countQuantum?: number
  /** Number of excess bytes removed as one deterministic step. */
  // 中文：一次确定性步骤移除的超额字节数。
  byteQuantum?: number
  /** Whether byte accounting uses raw file bytes or inline base64 length. */
  // 中文：字节核算用原始文件字节还是内联 base64 长度。
  representation: 'raw' | 'base64'
  /** Resolve the encoded request-version length; omission uses normalized attachment bytes. */
  byteLength?: (ref: ImageAttachmentRef) => number
  /** Build the model-visible replacement for each omitted attachment. */
  placeholder: (ref: ImageAttachmentRef) => string
}

/** Collect represented image lengths in request and nested-block order. */
// 中文：按请求与嵌套块顺序收集每个图片的"表示后长度"到 lengths 数组；
// 图片在 tool-result 内会递归深入。
function collectImageLengths(
  blocks: readonly ContentBlock[],
  lengths: number[],
  policy: RequestImageOffloadPolicy,
): void {
  for (const block of blocks) {
    if (block.type === 'image') {
      const bytes = policy.byteLength === undefined
        ? block.attachment.bytes
        : policy.byteLength(block.attachment)
      lengths.push(policy.representation === 'base64' ? base64Length(bytes) : bytes)
    } else if (block.type === 'tool-result') {
      collectImageLengths(block.content, lengths, policy)
    }
  }
}

/** Replace the first `remaining.count` image occurrences without mutating durable messages. */
// 中文：把前 remaining.count 个图片替换为 OFFLOADED_IMAGE_TEXT 占位文本，
// 不修改持久消息：惰性浅拷贝（next 仅在确实需要改写时才创建）。
function replaceOldestImages(
  blocks: readonly ContentBlock[],
  remaining: { count: number },
  placeholder: (ref: ImageAttachmentRef) => string,
): ContentBlock[] {
  let next: ContentBlock[] | undefined
  for (const [index, block] of blocks.entries()) {
    if (block.type === 'image' && remaining.count > 0) {
      remaining.count -= 1
      next ??= blocks.slice(0, index)
      next.push({ type: 'text', text: placeholder(block.attachment) })
      continue
    }
    if (block.type === 'tool-result') {
      const content = replaceOldestImages(block.content, remaining, placeholder)
      if (content !== block.content) {
        next ??= blocks.slice(0, index)
        next.push({ ...block, content })
        continue
      }
    }
    next?.push(block)
  }
  return next ?? blocks as ContentBlock[]
}

/** Replace every image occurrence, including nested tool results, for a text-only model. */
// 中文：把每个图片（含嵌套 tool-result 内）替换为"仅文本模型"占位文本。
function replaceImagesForTextModel(blocks: readonly ContentBlock[]): ContentBlock[] {
  let next: ContentBlock[] | undefined
  for (const [index, block] of blocks.entries()) {
    if (block.type === 'image') {
      next ??= blocks.slice(0, index)
      next.push({ type: 'text', text: textOnlyImageText(block.attachment) })
      continue
    }
    if (block.type === 'tool-result') {
      const content = replaceImagesForTextModel(block.content)
      if (content !== block.content) {
        next ??= blocks.slice(0, index)
        next.push({ ...block, content })
        continue
      }
    }
    next?.push(block)
  }
  return next ?? blocks as ContentBlock[]
}

/*
 * （中文）把持久图片历史投射成某个纯文本模型的确定性文本：消息本身无图时
 * 原样返回；有图时逐条浅拷贝消息并替换内容树，占位文本稳定可复现。
 * @param messages 完整请求历史。
 * @returns 无图时返回原列表，否则返回带稳定占位的浅拷贝消息列表。
 */
/**
 * Project durable image history into deterministic text for an exact text-only model.
 * @param messages - complete request history.
 * @returns the original list without images, otherwise shallow message copies with stable placeholders.
 */
export function projectImagesForTextModel(messages: readonly Message[]): readonly Message[] {
  if (!messages.some(message => contentHasImage(message.content))) return messages
  return messages.map((message) => {
    const content = replaceImagesForTextModel(message.content)
    return content === message.content ? message : { ...message, content }
  })
}

/*
 * （中文）返回把最旧图片替换掉、直到累计 base64 载荷符合配置上限的临时请求
 * 消息。选择过程由持久消息顺序与附件元数据确定性决定；provider 可直接序列化
 * 返回的消息，无需读取被省略的字节。
 * @param messages 完整请求历史，最旧在前。
 * @param maxRequestImageBytes 总 base64 图片载荷的正上限；undefined 表示保留全部图片。
 * @returns 原本就符合上限时返回原消息，否则返回内容树被替换的浅拷贝消息。
 */
/**
 * Number of oldest image occurrences one request projection removes, in whole
 * count and byte quanta, once a route budget is exceeded. The result depends
 * only on the represented lengths, so provider request pricing reproduces the
 * exact serialization decision without building the projected messages.
 * @param lengths - represented byte length of every occurrence, in request order.
 * @param policy - count/byte budgets and removal quanta; unbounded when absent.
 * @returns how many leading occurrences the projection replaces with placeholders.
 */
export function offloadedImagePrefixCount(
  lengths: readonly number[],
  policy: Pick<RequestImageOffloadPolicy, 'maxImages' | 'maxBytes' | 'countQuantum' | 'byteQuantum'>,
): number {
  const total = lengths.reduce((sum, bytes) => sum + bytes, 0)
  const excessCount = policy.maxImages === undefined ? 0 : Math.max(0, lengths.length - policy.maxImages)
  const excessBytes = policy.maxBytes === undefined ? 0 : Math.max(0, total - policy.maxBytes)
  if (excessCount === 0 && excessBytes === 0) return 0
  const countQuantum = policy.countQuantum ?? 1
  const byteQuantum = policy.byteQuantum ?? 1
  const removeCount = excessCount === 0 ? 0 : Math.ceil(excessCount / countQuantum) * countQuantum
  const removeBytes = excessBytes === 0 ? 0 : Math.ceil(excessBytes / byteQuantum) * byteQuantum
  let count = 0
  let removedBytes = 0
  for (const imageBytes of lengths) {
    const byteTargetMet = removeBytes === 0
      || (byteQuantum === 1 ? removedBytes >= removeBytes : removedBytes > removeBytes)
    if (count >= removeCount && byteTargetMet) break
    removedBytes += imageBytes
    count += 1
  }
  return count
}

/*
 * （中文）返回确定性的临时投影：路由预算超限后，按"数量与字节量化步长"整体
 * 移除最旧图片。目标只依赖完整持久历史：128 MiB 上限、64 MiB 量化下，129 张
 * 1 MiB 图片会移除最旧的 65 张使剩余 64 MiB；该移除前缀固定不变，直到历史
 * 总量超过 192 MiB。
 * @param messages 完整请求历史，最旧在前。
 * @param policy 路由表示方式、预算与移除量化步长。
 * @returns 低于双上限时返回原消息，否则返回带确定性占位的浅拷贝消息。
 */
/**
 * Return a deterministic transient projection whose oldest images are replaced
 * in whole count and byte quanta after a route budget is exceeded. The target
 * depends only on complete durable history: at 129 one-megabyte images under
 * a 128 MiB bound with a 64 MiB quantum, the oldest 65 images are removed so
 * 64 MiB remain; that removed prefix stays fixed until total history exceeds
 * 192 MiB.
 * @param messages - complete request history, oldest first.
 * @param policy - route representation, budgets, and removal quanta.
 * @returns original messages below both bounds, otherwise shallow copies with deterministic placeholders.
 */
export function offloadRequestImagesWithPolicy(
  messages: readonly Message[],
  policy: RequestImageOffloadPolicy,
): readonly Message[] {
  const lengths: number[] = []
  // 中文：第一步：按请求顺序收集每张图片的表示后长度。
  for (const message of messages) collectImageLengths(message.content, lengths, policy)
  const count = offloadedImagePrefixCount(lengths, policy)
  if (count === 0) return messages
  const remaining = { count }
  // 中文：第四步：逐条消息浅拷贝替换最旧 count 张图片为占位文本。
  return messages.map((message) => {
    const content = replaceOldestImages(message.content, remaining, policy.placeholder)
    return content === message.content ? message : { ...message, content }
  })
}
