/** Sidebar presentation corresponding to the official ui-sidebar plugin. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-qs-shell/client'
import { QsSideNav } from './SideNav.tsx'
import { zh, en } from './view-locales.ts'
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** 设置入口由独立设置壳贡献，侧栏仅提供位置。 */
    'qs.sidebar.settings': { kind: 'single'; scope: 'root'; owner: { children?: never } }
    /** Workspace/session navigation owned by the sidebar entry. */
    'qs.nav': { kind: 'single'; scope: 'root'; owner: { children?: never } }
  }
  interface LocaleNamespaceMap { 'qs-ui-sidebar': keyof typeof zh }
}
/** Required presentation services. */
export const inject = ['slots', 'locale']
/** Mount the sidebar and its workspace child slot.
 * @param ctx - Client plugin context.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register('qs-ui-sidebar', { zh, en }), 'qs-ui-sidebar: dictionaries')
  ctx.slots.inject('qs.sidebar', () => ctx.slots.register({
    name: 'qs.sidebar', locale: 'qs-ui-sidebar',
    children: { 'qs.nav': { kind: 'single', scope: 'root' }, 'qs.sidebar.settings': { kind: 'single', scope: 'root' } },
  }, QsSideNav))
}
