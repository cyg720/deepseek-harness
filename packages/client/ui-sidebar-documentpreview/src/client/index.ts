/**
 * Browser half: register `text` as a right-Sidebar tab type.
 *
 * The type reaches the Sidebar through its public path only: the definition into
 * `ctx.sidebarRightTabs`, the body into the keyed `sidebar.right.pane.tab`
 * seat, and the chip title into `sidebar.right.pane.tab.title`, both under the
 * definition's `id`. Nothing here reaches into the Sidebar's store, its
 * panes, or its sequence. The file's metadata comes from the standard
 * `useResource`, served by the `file` provider; the content is this type's own
 * business, read through its face. Every import from another
 * client plugin is a type.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-resources/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-api-gateway/client'
import type {} from '@deepseek-ai/dsh-api-workspace-files/remote'
import type { WorkspaceFileParams } from '@deepseek-ai/dsh-api-workspace-files/client'
import { TextPreview } from './TextPreview.tsx'
import { TextTitle } from './TextTitle.tsx'
import { TEXTPREVIEW_ID, textDefinition } from './definition.ts'
import { createDocumentPresentation } from './qs/presentation.ts'
import type { DocumentPreviewPresentation } from './qs/presentation.ts'
import type { PdfPresentation } from './qs/pdf-presentation.ts'
import { hostFileOf } from './rpc.ts'
import { en, zh } from './locales.ts'
import { DocumentPreviewRegistry } from './document/registry.ts'
import { documentTabInfoFactory } from './document/contract.ts'
import { apply as registerText } from './text/index.ts'
import { apply as registerMarkdown } from './markdown/index.ts'
import { apply as registerHtml } from './html/index.ts'
import { apply as registerImage } from './image/index.ts'
import { apply as registerPdf } from './pdf/index.ts'
import { apply as registerCode } from './code/index.ts'

// Values stay package-private unless another package needs them; the plugin
// surface is `apply`, `inject`, and the store factory another registration may
// share, plus the types a consumer of the seat or the store names.
export type { SidebarDocumentPreviewKey } from './locales.ts'
export type { TextPreviewProps } from './TextPreview.tsx'
export type { TextPreviewInjected } from './TextPreview.tsx'
export type { DocumentPreviewPresentation } from './qs/presentation.ts'
export type { PdfPresentation } from './qs/pdf-presentation.ts'
export type { PdfBodyInjected } from './pdf/PdfBody.tsx'
export type { PdfDocument, PdfSession } from './pdf/document.ts'
export type { TextInjected } from './face.ts'
export type { ReadWorkspaceFilePage, SessionFile, WorkspaceFilesReadRemote } from './rpc.ts'
export type { TextPage, TextState, TextStore, TextTabState } from './store.ts'
export type { DocumentContent, DocumentPreviewProps, DocumentTextPage } from './document/contract.ts'
export type { DocumentLoadMode, DocumentPreviewDefinition } from './document/registry.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** File-extension renderer registrations, independent from their keyed document bodies. */
    documentPreviews: DocumentPreviewRegistry
    /** 官方与 QS 共享文件内容和请求代次；正文卸载不销毁仍存活的标签状态。 */
    documentPreviewPresentation: DocumentPreviewPresentation
    /** 双界面共用 PDF 页码状态和 worker/画布操作；挂载正文拥有运行时实例。 */
    documentPdfPresentation: PdfPresentation
  }
}

/** This package's copy namespace. */
const NS = 'sidebarDocumentPreview'

declare module '@deepseek-ai/dsh-client-ui-sidebar-right/client' {
  interface SidebarRightResourceParamsMap {
    /** File line navigation supported by the text preview. */
    file: WorkspaceFileParams
  }
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Text-preview progress, paging, change, control, and failure lines. */
    sidebarDocumentPreview: import('./locales.ts').SidebarDocumentPreviewKey
  }
}

/**
 * Required browser services: the tab registry, the slot registry, copy, and the
 * Remote carrier with its `workspaceFiles` namespace.
 */
export const inject = ['slots', 'locale', 'sidebarRightTabs', 'remote', 'remote.workspaceFiles']

/**
 * Client plugin body: register the type, its dictionaries, its body, and its chip title.
 * @param ctx - client root context carrying the registry, the slots, copy, and the Remote face.
 */
export function apply(ctx: ClientContext): void {
  const previews = new DocumentPreviewRegistry()
  const disposePreviews = ctx.reflect.provide('documentPreviews', previews)
  ctx.effect(() => disposePreviews)
  ctx.effect(() => ctx.sidebarRightTabs.register(textDefinition()), 'ui-sidebar-documentpreview: text type')
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-sidebar-documentpreview: dictionaries')

  // 同一标签跨界面刷新时必须共享请求代次，防止旧读取覆盖新内容。
  const presentation = createDocumentPresentation(
    ctx.remote,
    (file, signal) => ctx.remote.workspaceFiles.readAll(file.sessionId, file.path, signal),
    previews,
    // HTML 静态依赖沿用源文档会话及 Host 路径权限，不暴露任意文件桥接给 iframe。
    (address, relativePath, signal) => {
      const file = hostFileOf(address)
      return ctx.remote.workspaceFiles.readRelated(file.sessionId, file.path, relativePath, signal)
    },
  )
  const disposePresentation = ctx.reflect.provide('documentPreviewPresentation', presentation)
  ctx.effect(() => disposePresentation)
  const { store, inject: bindPreview } = presentation
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register(
    {
      name: 'sidebar.right.pane.tab', key: TEXTPREVIEW_ID, locale: NS, store,
      children: {
        'sidebar.right.tab.document': { kind: 'keyed', scope: 'session', inject: { hooks: { tabInfo: documentTabInfoFactory } } },
      },
      inject: bindPreview,
    },
    TextPreview,
  )), 'ui-sidebar-documentpreview: text body')
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register(
    { name: 'sidebar.right.pane.tab.title', key: TEXTPREVIEW_ID },
    TextTitle,
  )), 'ui-sidebar-documentpreview: text title')
  registerText(ctx)
  registerMarkdown(ctx)
  registerHtml(ctx)
  registerImage(ctx)
  registerPdf(ctx)
  registerCode(ctx)
}

// 二开仅复用身份；定义注册与读取策略仍由本插件负责。
export { documentPreviewIds } from './qs/ids.ts'
