/** 对应官方 ui-sidebar-files，只替换正文与标题，不重复注册类型或读取服务。 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-files/client'
import type {} from '@deepseek-ai/dsh-qs-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { Files, FilesTitle } from './Files.tsx'
import { zh, en } from './locales.ts'
/** 等待官方共享服务及 QS 槽位，不读取其他插件私有模块。 */
export const inject = ['slots', 'locale', 'sidebarFilesPresentation']
/**
 * 按官方文件树定义身份注册独立 QS 呈现。
 * @param ctx - 共享目录状态与呈现注册表。
 */
export function apply(ctx: Context): void {
  const { store, inject } = ctx.sidebarFilesPresentation
  ctx.effect(() => ctx.locale.register('qs-ui-sidebar-files', { zh, en }), 'qs-ui-sidebar-files: dictionaries')
  // 身份来自官方 files definition，导航类型和 Host 权限仍由原插件拥有。
  const key = '@deepseek-ai/dsh-client-ui-sidebar-files'
  ctx.slots.inject('qs.sidebar.right.tab', () => ctx.slots.register({ name: 'qs.sidebar.right.tab', key, locale: 'qs-ui-sidebar-files', store, inject }, Files))
  ctx.slots.inject('qs.sidebar.right.tab.title', () => ctx.slots.register({ name: 'qs.sidebar.right.tab.title', key, locale: 'qs-ui-sidebar-files' }, FilesTitle))
}
