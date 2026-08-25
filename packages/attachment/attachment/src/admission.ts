/** Wire-form admission of base64-encoded image uploads. @module @deepseek-ai/dsh-attachment/admission */
/*
 * 文件职责：接纳线协议中的 Base64 图片批次，规范解码后交给附件存储执行统一策略。
 * 技术维度：使用 Node Buffer 严格往返校验规范 Base64，并通过 AttachmentStore 批量保存。
 * 产品维度：拒绝歧义或损坏上传，确保浏览器图片以稳定顺序持久化并返回引用。
 * 逻辑维度：decodeBase64 校验单条编码，saveInput 转换字段，admitEncodedImages 映射整个批次并保存。
 * 关键边界：空字符串和非规范等价编码均拒绝；数量、总字节、媒体类型与单图限制由存储层拥有。
 * 新手阅读建议：先看 decodeBase64 的往返判断，再看 saveInput 的可选 name，最后看批量入口。
 */

import { Buffer } from 'node:buffer'
import { AttachmentError } from './error.ts'
import type { AttachmentStore } from './index.ts'
import type { EncodedImageAttachment, ImageAttachmentRef, SaveImageAttachment } from './types.ts'

/** Decode one upload payload while rejecting non-canonical base64 forms. */
/* 解码单条上传。@param data Base64 文本。@returns 字节数组。@throws AttachmentError 非规范或空输入。@example decodeBase64('aGk=')。 */
function decodeBase64(data: string): Uint8Array {
  // Node 宽松解码出的字节；随后必须重新编码比较以排除非规范形式。
  const decoded = Buffer.from(data, 'base64')
  if (data.length === 0 || decoded.toString('base64') !== data) {
    throw new AttachmentError('Image upload is not canonical base64.', 'INVALID_IMAGE_BASE64')
  }
  return new Uint8Array(decoded)
}

/** Store input for one decoded upload. */
/* 构造存储输入。@param image 线协议编码图片。@returns 已解码 SaveImageAttachment。@example saveInput(image)。 */
function saveInput(image: EncodedImageAttachment): SaveImageAttachment {
  return {
    data: decodeBase64(image.data),
    mediaType: image.mediaType,
    ...image.name === undefined ? {} : { name: image.name },
  }
}

/**
 * Admit one wire image batch: enforce canonical base64 on every member, then
 * delegate batch admission — count and aggregate-byte limits, media-type and
 * per-image validation, ordered commit — to {@link AttachmentStore.saveImages}.
 * The shared entry for every RPC endpoint accepting browser uploads.
 * @param attachments - the deployment attachment store owning batch policy.
 * @param images - base64-encoded uploads in caller order.
 * @returns durable references in the same order as `images`.
 * @throws AttachmentError on a non-canonical payload or a refused batch.
 */
/*
 * 接纳图片批次。@param attachments 附件存储。@param images 按调用方顺序的编码图片。@returns 同序持久引用。@example await admitEncodedImages(store, images)。
 * @param attachments 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @param images 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
 */
export async function admitEncodedImages(
  attachments: AttachmentStore,
  images: readonly EncodedImageAttachment[],
): Promise<readonly ImageAttachmentRef[]> {
  return attachments.saveImages(images.map(saveInput))
}
