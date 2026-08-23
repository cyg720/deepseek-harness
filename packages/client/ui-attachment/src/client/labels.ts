/**
 * ================================ 文件注释 ================================
 * 【文件职责】把对话（conversation）命名空间下的图片相关文案解析成各附件组件的
 *             标签对象：灯箱、消息图片、拖放覆盖层、草稿附件栏。
 * 【技术维度】纯函数式文案装配：接收命名空间翻译函数 t，返回组件需要的结构化标签，
 *             不依赖任何运行时状态。
 * 【产品维度】保证附件相关 UI 的所有可见文字（打开原图、加载失败、拖放提示等）
 *             都走统一的翻译体系，支持多语言。
 * 【逻辑维度】lightboxLabels → messageImageLabels（内嵌灯箱标签）→ dropOverlayLabels
 *             → attachmentRailLabels，四个函数分别装配一个组件的标签。
 * 【关键边界】文案键全部来自 conversation 命名空间；labels 类型来自各组件的 props 类型。
 * 【新手阅读建议】先看最底部的 attachmentRailLabels，再看 messageImageLabels 如何复用 lightboxLabels。
 * ==========================================================================
 */
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { AttachmentRailLabels } from '../AttachmentRail.tsx'
import type { DropOverlayLabels } from '../DropOverlay.tsx'
import type { ImageLightboxLabels } from '../ImageLightbox.tsx'
import type { MessageImageLabels } from '../MessageImage.tsx'

/**
 * Resolve original-image lightbox strings from the conversation namespace.
 * @param t - conversation namespace translator.
 * @returns translated lightbox labels.
 */
// 灯箱文案：用对话命名空间里的"图片预览/关闭预览"两个键装配成组件标签。
export function lightboxLabels(t: TranslateNS<'conversation'>): ImageLightboxLabels {
  return { dialog: t('image.preview'), close: t('image.closePreview') }
}

/**
 * Resolve historical message-image strings from the conversation namespace.
 * @param t - conversation namespace translator.
 * @returns translated message-image labels.
 */
export function messageImageLabels(t: TranslateNS<'conversation'>): MessageImageLabels {
  return {
    image: t('image.label'),
    open: t('image.openOriginal'),
    openNamed: label => t('image.openOriginalLabel', { label }),
    loading: t('image.loading'),
    loadFailed: t('image.loadFailed'),
    lightbox: lightboxLabels(t),
  }
}

/**
 * Resolve the document-level drop invitation and its optional limits line.
 * @param t - conversation namespace translator.
 * @param accepting - whether the composer can accept dropped files.
 * @param limits - optional translated count and size values.
 * @returns translated drop-overlay labels.
 */
// 拖放覆盖层文案：不可接收时只给阻止提示；可接收时给标题与可选的数量/大小说明。
export function dropOverlayLabels(
  t: TranslateNS<'conversation'>,
  accepting: boolean,
  limits?: { readonly count: number; readonly size: string },
): DropOverlayLabels {
  if (!accepting) return { title: t('image.dropBlocked') }
  return {
    title: t('image.dropTitle'),
    desc: limits === undefined ? undefined : t('image.dropDesc', limits),
  }
}

/**
 * Resolve draft-image rail strings from the conversation namespace.
 * @param t - conversation namespace translator.
 * @returns translated attachment-rail labels.
 */
export function attachmentRailLabels(t: TranslateNS<'conversation'>): AttachmentRailLabels {
  return {
    group: t('image.pending'),
    open: t('image.openOriginal'),
    scrollLeft: t('image.scrollLeft'),
    scrollRight: t('image.scrollRight'),
  }
}
