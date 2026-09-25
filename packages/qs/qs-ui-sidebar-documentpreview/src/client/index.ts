/** 对应官方文档预览插件；元数据、读取和标签资源由官方唯一服务持有。 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/client'
import type {} from '@deepseek-ai/dsh-qs-ui-sidebar-right/client'
import { Preview } from './Preview.tsx'
import type { PreviewInjected } from './Preview.tsx'
import { tabInfoFactory } from './contract.ts'
import { apply as text } from './text/index.tsx'
import { apply as markdown } from './markdown/index.tsx'
import { apply as code } from './code/index.tsx'
import { apply as image } from './image/index.tsx'
import { apply as html } from './html/index.tsx'
import { apply as pdf } from './pdf/index.tsx'
import { zh, en } from './locales.ts'
/** 等待唯一官方预览状态及渲染类型注册表。 */
export const inject = ['slots', 'locale', 'documentPreviewPresentation', 'documentPreviews', 'documentPdfPresentation']
/**
 * 注册 QS 文档宿主和独立正文子插件。
 * @param ctx - 官方共享预览服务和 QS 插槽。
 */
export function apply(ctx: Context): void {
  const shared = ctx.documentPreviewPresentation
  ctx.effect(() => ctx.locale.register('qs-ui-sidebar-documentpreview', { zh, en }))
  ctx.slots.inject('qs.sidebar.right.tab', () => ctx.slots.register({
    name: 'qs.sidebar.right.tab', key: '@deepseek-ai/dsh-client-ui-sidebar-documentpreview',
    locale: 'qs-ui-sidebar-documentpreview', store: shared.store,
    children: { 'qs.sidebar.document': { kind: 'keyed', scope: 'session', inject: { hooks: { tabInfo: tabInfoFactory } } } },
    inject: (sessionId, actions): PreviewInjected => ({
      ...shared.inject(sessionId, actions), candidates: path => ctx.documentPreviews.candidates(path),
    }),
  }, Preview))
  text(ctx)
  markdown(ctx)
  code(ctx)
  image(ctx)
  html(ctx)
  pdf(ctx)
}
