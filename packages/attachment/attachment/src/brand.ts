/** Attachment identifier brand. @module @deepseek-ai/dsh-attachment/brand */
/**
 * 文件职责：定义附件对象和请求图像变体的品牌化不透明标识。
 * 技术维度：使用 TypeScript Branded 类型与同名构造函数阻止普通字符串跨领域误用。
 * 产品维度：保证上传附件和派生图像在会话、存储与模型请求之间使用正确身份。
 * 逻辑维度：分别声明 AttachmentId 与 ImageVariantId 类型，并提供已验证字符串的品牌转换函数。
 * 关键边界：转换函数不做运行时校验；只有存储后端或附件提供者验证过的值才能传入。
 * 新手阅读建议：先理解品牌类型运行时仍是字符串，再确认每个 ID 的产生方和使用方。
 */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** Opaque content-addressed identifier for one immutable attachment object. */
/** AttachmentId：一个不可变附件对象的内容寻址不透明标识。 */
export type AttachmentId = Branded<'AttachmentId'>

/**
 * Brand a validated storage identifier.
 * @param value - backend-produced opaque identifier.
 * @returns the branded identifier.
 */
/**
 * 把存储后端已验证的不透明字符串标记为 AttachmentId。
 * @param value - 后端产生并验证过的内容寻址标识。
 * @returns 仅类型层增加品牌的附件标识，运行时字符串不变。
 * @example AttachmentId('sha256:...')。
 */
export function AttachmentId(value: string): AttachmentId {
  return value as AttachmentId
}

/** Opaque deterministic identity for one request-image transformation. */
/** ImageVariantId：一次请求图像转换的确定性不透明身份。 */
export type ImageVariantId = Branded<'ImageVariantId'>

/**
 * Brand a validated request-image transformation identifier.
 * @param value - attachment-provider-produced opaque identifier.
 * @returns the branded identifier.
 */
/**
 * 把附件提供者已验证的转换标识标记为 ImageVariantId。
 * @param value - 附件提供者产生的图像变体不透明标识。
 * @returns 仅类型层增加品牌的图像变体标识。
 * @example ImageVariantId('variant:thumbnail')。
 */
export function ImageVariantId(value: string): ImageVariantId {
  return value as ImageVariantId
}
