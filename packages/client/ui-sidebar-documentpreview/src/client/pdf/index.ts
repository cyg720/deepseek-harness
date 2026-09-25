// 二开正文使用同一公开身份，避免复制私有字符串。
import { documentPreviewIds } from '../qs/ids.ts'
/** Builtin PDF registration through document metadata and the keyed body slot. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '../index.ts'
import type { DocumentPreviewDefinition } from '../document/registry.ts'
import { PdfBody } from './PdfBody.tsx'
import { createPdfPresentation } from '../qs/pdf-presentation.ts'
import { en, zh } from './locales.ts'

/** PDF metadata and keyed body share this package-local implementation identity. */
export const PDF_BODY_ID = documentPreviewIds.pdf

/**
 * Describe the builtin PDF renderer independently from its keyed body slot.
 * @param title - locale-owned implementation name.
 * @returns the complete-file PDF registration.
 */
export function pdfBodyDefinition(title: () => string): DocumentPreviewDefinition {
  return { id: PDF_BODY_ID, extensions: ['pdf'], priority: 'builtin', title, loading: 'bytes-complete', wrap: false }
}

/** @param ctx - context carrying the locale, document registry, and slot registry. */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register('sidebarPdf', { zh, en }))
  const t = ctx.locale.bind('sidebarPdf')
  ctx.effect(() => ctx.documentPreviews.register(pdfBodyDefinition(() => t('title'))))
  // 页码与标签保留由唯一服务持有，双界面不复制 PDF worker 实现。
  const { presentation, dispose } = createPdfPresentation()
  const release = ctx.reflect.provide('documentPdfPresentation', presentation)
  ctx.effect(() => () => { dispose(); return release() })
  ctx.effect(() => ctx.slots.inject('sidebar.right.tab.document', () => ctx.slots.register({
    name: 'sidebar.right.tab.document', key: PDF_BODY_ID, locale: 'sidebarPdf', store: presentation.store,
    inject: presentation.inject,
  }, PdfBody)))
}
