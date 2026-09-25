/** 独立对应 ui-settings-general；官方 settingsScope 仍是唯一配置源。 */
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import { DocumentAction, type DocumentInjected } from './DocumentAction.tsx'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import { resolveSlotLabel, type HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { SettingsEntry, SettingsInjected } from './contract.ts'
import { Settings, General } from './Settings.tsx'
import { zh, en } from './locales.ts'
export type * from './contract.ts'
/** 共用官方配置镜像和连接，不建立二开配置服务。 */
export const inject = ['slots', 'locale', 'settingsScope', 'connection', 'remote', 'remote.settings']
/**
 * 注册设置壳及通用行容器，全部贡献随插件生命周期释放。
 * @param ctx - 浏览器插件上下文。
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register('qs-ui-settings-general', { zh, en }), 'qs settings: locale')
  const t = ctx.locale.bind('qs-ui-settings-general')
  const connection = ctx.get('connection') as ConnectionHandle
  const entries = (slot: 'qs.settings.section' | 'qs.settings.onboarding'): HostObservable<readonly SettingsEntry[]> => {
    let version = -1, revision = -1, rows: readonly SettingsEntry[] = []
    return {
      getSnapshot: () => {
        const nextVersion = ctx.slots.getVersion(slot), nextRevision = ctx.locale.getSnapshot().revision
        if (version !== nextVersion || revision !== nextRevision) {
          version = nextVersion; revision = nextRevision
          // list 槽注册要求 id；未提供显示名时仍保留可识别的分区标识。
          rows = ctx.slots.entries(slot).map(entry => ({
            id: entry.options.id as string,
            label: resolveSlotLabel(entry.options.label) ?? entry.options.id as string, order: entry.options.order ?? 0,
          })).sort((a, b) => a.order - b.order)
        }
        return rows
      },
      subscribe: (listener) => {
        const offSlots = ctx.slots.subscribe(slot, listener), offLocale = ctx.locale.subscribe(listener)
        return () => { offSlots(); offLocale() }
      },
    }
  }
  const injected: SettingsInjected = {
    hooks: { sections: entries('qs.settings.section'), onboarding: entries('qs.settings.onboarding'), connection: connection.state, settings: ctx.settingsScope.describe() },
    reconnect: () => { connection.reconnect() },
  }
  ctx.slots.inject('qs.sidebar.settings', () => ctx.slots.register({
    name: 'qs.sidebar.settings', locale: 'qs-ui-settings-general', inject: () => injected,
    children: {
      'qs.settings.section': { kind: 'list', scope: 'root' }, 'qs.settings.action': { kind: 'list', scope: 'root' },
      'qs.settings.onboarding': { kind: 'list', scope: 'root' },
    },
  }, Settings))
  // 远端连接不提供本机文件入口；读写权限与是否存在文件分别由官方事实决定。
  if (ctx.remote.$host.isLoopback) ctx.slots.inject('qs.settings.action', () => ctx.slots.register({
    name: 'qs.settings.action', id: 'open-document', locale: 'qs-ui-settings-general',
    inject: (): DocumentInjected => ({
      hooks: { settings: ctx.settingsScope.describe() },
      openDocument: async () => (await ctx.remote.settings.openSettingsDocument()).ok,
    }),
  }, DocumentAction))
  ctx.slots.inject('qs.settings.section', () => ctx.slots.register({
    name: 'qs.settings.section', id: 'general', order: 0, label: () => t('general'), locale: 'qs-ui-settings-general',
    children: { 'qs.settings.general.item': { kind: 'list', scope: 'root' } },
  }, General))
}
