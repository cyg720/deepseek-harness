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
import type {
  AdmittedPromptContentPart,
  EncodedImageAttachment,
  ImageAttachmentRef,
  PromptContentPart,
  SaveImageAttachment,
} from './types.ts'

/** Decode one upload payload while rejecting non-canonical base64 forms. */
function decodeBase64(data: string): Uint8Array {
  const decoded = Buffer.from(data, 'base64')
  if (data.length === 0 || decoded.toString('base64') !== data) {
    throw new AttachmentError('Image upload is not canonical base64.', 'INVALID_IMAGE_BASE64')
  }
  return new Uint8Array(decoded)
}

/** Store input for one decoded upload. */
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
export async function admitEncodedImages(
  attachments: AttachmentStore,
  images: readonly EncodedImageAttachment[],
): Promise<readonly ImageAttachmentRef[]> {
  return attachments.saveImages(images.map(saveInput))
}

/**
 * Admit one browser prompt and replace each uploaded image with its durable reference.
 * Text-only prompts do not access the attachment store.
 * @param attachments - the deployment attachment store owning batch policy.
 * @param content - browser prompt parts in message order.
 * @returns admitted prompt parts in the same order as `content`.
 * @throws AttachmentError when the image batch is refused.
 */
export async function admitPromptContent(
  attachments: AttachmentStore,
  content: readonly PromptContentPart[],
): Promise<AdmittedPromptContentPart[]> {
  if (content.every(part => part.type === 'text')) {
    return content.map(part => ({ type: 'text', text: part.text }))
  }
  const refs = await admitEncodedImages(attachments, content.filter(part => part.type === 'image'))
  let next = 0
  return content.map(part => part.type === 'text'
    ? { type: 'text', text: part.text }
    // admitEncodedImages returns one reference per image part in order.
    : { type: 'image', attachment: refs[next++] as ImageAttachmentRef })
}
