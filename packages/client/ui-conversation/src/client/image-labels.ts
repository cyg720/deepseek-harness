/*
 * ================================ 文件注释 ================================
 * 【文件职责】图片附件错误与数量 / 大小限制的文案生成：字节数转 MB 文案；宿主拒绝附件时
 *             按 reason 代码映射成用户可理解的横幅文案。
 * 【技术维度】纯函数 + 字典插值（Translate<ConversationKey>）；reason 来自宿主
 *             attachment-error 事件的 details.reason。
 * 【产品维度】用户拖入过多 / 过大 / 模型不支持的图片时，输入区显示明确原因与解决方向。
 * 【逻辑维度】1) imageSizeText 字节 → MB；2) attachmentErrorText 按 reason 分发。
 * 【关键边界】用户可解决的 reason 点出限制与出路；不可解决的折叠成"发送失败 + 原因码"。
 * 【新手阅读建议】对照 locales.ts 的 image.* 键理解各分支文案。
 * ==========================================================================
 */
/** Attachment error and limit copy owned by the conversation input flow. */

import type { ImageAttachmentLimits } from '@deepseek-ai/dsh-attachment'
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import type { ConversationKey } from './locales.ts'

/**
 * Byte count as user-facing megabytes (`10MB`, `2.5MB`).
 * @param bytes - the byte count.
 * @returns the rounded megabyte text.
 */
export function imageSizeText(bytes: number): string {
  const mb = bytes / (1024 * 1024)
  return `${Number.isInteger(mb) ? String(mb) : mb.toFixed(1)}MB`
}

/**
 * Product copy for a host attachment rejection (the `attachment-error`
 * `details.reason`). User-solvable reasons name the limit and the way out;
 * reasons the user cannot act on fold into one send-failed line carrying the
 * reason code for a bug report.
 * @param t - the conversation-namespace translate.
 * @param reason - the wire `details.reason` code.
 * @param limits - projected limits interpolated into count/size copy, when known.
 * @returns the banner text.
 */
/*
 * 宿主拒绝附件时的产品文案。用户可解决的 reason 点出限制与出路；
 * 用户无法处理的 reason 折叠成一行"发送失败"并携带原因码供上报。
 * @param t - conversation 命名空间的翻译函数。
 * @param reason - 线上的 details.reason 代码。
 * @param limits - 已知时用于插值的限额（数量 / 大小）。
 * @returns 横幅文案。
 */
export function attachmentErrorText(
  t: Translate<ConversationKey>,
  reason: string,
  limits?: ImageAttachmentLimits,
): string {
  switch (reason) {
    case 'MODEL_DOES_NOT_SUPPORT_IMAGES': return t('image.modelUnsupported')
    case 'SUBAGENT_IMAGE_UNSUPPORTED': return t('image.subagentUnsupported')
    case 'IMAGE_TOO_MANY_PIXELS': return t('image.tooManyPixels')
    case 'IMAGE_DIMENSION_TOO_LARGE':
      if (limits !== undefined) return t('image.dimensionTooLarge', { size: limits.maxImageDimension })
      break
    // Undecodable bytes or a declared type its bytes contradict: solvable by
    // replacing or re-exporting the file, so it reads as a format problem.
    case 'INVALID_IMAGE':
    case 'IMAGE_TYPE_MISMATCH':
      return t('image.unsupportedType')
    case 'TOO_MANY_IMAGES':
      if (limits !== undefined) return t('image.tooMany', { count: limits.maxImagesPerMessage })
      break
    case 'IMAGE_TOO_LARGE':
      if (limits !== undefined) return t('image.fileTooLarge', { size: imageSizeText(limits.maxImageBytes) })
      break
    case 'IMAGES_TOO_LARGE':
      if (limits !== undefined) return t('image.totalTooLarge', { size: imageSizeText(limits.maxMessageImageBytes) })
      break
    default: break
  }
  return t('image.sendFailed', { reason })
}
