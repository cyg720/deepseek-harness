/** 对应官方 ui-subagent 的目录导航与只读 composer 两项贡献。 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import { Catalog } from './Catalog.tsx'
import { ReadOnlyComposer, selectReadOnly } from './ReadOnlyComposer.tsx'
import type { CatalogActions } from './contract.ts'
import { zh, en } from './locales.ts'
export type * from './contract.ts'

/** 官方会话所有者缺失时不注册空导航。 */
export const inject = ['slots', 'locale', 'sessions']

/**
 * 注册独立呈现，地址、请求代次及执行权限仍由官方 Session 服务负责。
 * @param ctx - 浏览器根上下文。
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register('qs-ui-subagent', { zh, en }), 'qs-ui-subagent: dictionaries')
  const actions: CatalogActions = {
    openChild: (address) => { ctx.sessions.openSubagent(address) },
    openParent: (id) => { ctx.sessions.open(id) },
    refresh: (id) => { void ctx.sessions.refreshSubagents(id) },
    setCatalogOpen: (id, open) => { ctx.sessions.setSubagentCatalogOpen(id, open) },
  }
  ctx.slots.inject('qs.stage.header.actions', () => ctx.slots.register({
    name: 'qs.stage.header.actions', id: 'qs-subagent', order: 10, locale: 'qs-ui-subagent', inject: () => actions,
  }, Catalog))
  ctx.slots.inject('qs.composer.takeover', () => ctx.slots.register({
    name: 'qs.composer.takeover', priority: -10, locale: 'qs-ui-subagent', select: selectReadOnly,
  }, ReadOnlyComposer))
}
