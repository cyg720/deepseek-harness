/** 对应官方权限预设呈现；当前会话只走既有 /permission 命令。 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-qs-ui-settings-general/client'
import type { SelectOption } from '@deepseek-ai/dsh-client-ui-commands/client'
import type { ClientSessionContext } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type { PermissionSelect } from '@deepseek-ai/dsh-permission-presets/client'
import { en, zh } from './locales.ts'
import { createDefaults } from './defaults.ts'
import { DefaultRow, type DefaultInjected } from './DefaultRow.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' { interface LocaleNamespaceMap { 'qs-ui-permission-presets': keyof typeof zh } }
/** 复用官方会话、命令与词典服务，不创建权限服务。 */
export const inject = ['sessions', 'commandUi', 'locale', 'slots', 'settingsScope', 'settingsSchema', 'remote', 'remote.settings']
/**
 * 将权限投影转换为 QS 命令选项，custom 仅显示状态，不可作为切换目标。
 * @param value - Host 的当前权限选择投影。
 * @param t - QS 词典查询。
 * @returns 带活动标记及完全访问确认要求的选项。
 */
export function permissionOptions(value: PermissionSelect, t: (key: keyof typeof zh) => string): SelectOption[] {
  return value.options.filter(option => option.value !== 'custom').map((option) => {
    const builtin = option.value === 'read-only' ? 'readOnly' : option.value === 'workspace-write' ? 'workspaceWrite'
      : option.value === 'danger-full-access' ? 'fullAccess' : undefined
    // 自定义显示名由 Host 拥有，只有默认机器值或官方产品名才本地化。
    const label = builtin !== undefined && (option.name === option.value || option.name === en[builtin]) ? t(builtin) : option.name
    return { id: option.value, label,
      ...(option.description === undefined ? {} : { detail: option.description }),
      ...(option.value === value.currentValue ? { active: true } : {}),
      ...(option.value === 'danger-full-access' ? { confirmation: {
        title: t('riskTitle'), description: t('riskDescription'), acknowledgeLabel: t('acknowledge'),
        cancelLabel: t('cancel'), confirmLabel: t('confirm'),
      } } : {}),
    }
  })
}
/**
 * 贡献当前会话权限选择；弹层由独立 QS 命令插件呈现。
 * @param ctx - Cordis 浏览器上下文。
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register('qs-ui-permission-presets', { zh, en }), 'qs permission: dictionaries')
  const t = ctx.locale.bind('qs-ui-permission-presets')
  const defaults = createDefaults(ctx.settingsScope.describe(), ctx.remote.settings, ctx.settingsSchema)
  ctx.effect(() => () => { defaults.dispose() }, 'qs permission: default settings lifetime')
  ctx.on('connection/reset', () => { defaults.reset() })
  ctx.slots.inject('qs.settings.general.item', () => ctx.slots.register({
    name: 'qs.settings.general.item', id: 'permission', order: -20, locale: 'qs-ui-permission-presets',
    inject: (): DefaultInjected => ({ hooks: { defaults }, actions: defaults }),
  }, DefaultRow))
  const sessionFor = (session: ClientSessionContext) => ctx.sessions.binding(session.sessionId)?.session
  const selectOf = (session: ClientSessionContext): PermissionSelect | undefined =>
    sessionFor(session)?.projections.faceOf('permissions').getSnapshot() as PermissionSelect | undefined
  // 命令装饰器与权限设置行共用根界面所有权，切回官方时立即释放。
  ctx.slots.inject('qs.settings.general.item', () => ctx.commandUi.decorate({
    name: 'permission', priority: 1, available: session => selectOf(session) !== undefined,
    ui: {
      kind: 'popupSelect',
      options: (session) => {
        const value = selectOf(session)
        if (value === undefined) throw new Error(t('unavailable'))
        return Promise.resolve(permissionOptions(value, t))
      },
      onSelect: async (option, session) => {
        const live = sessionFor(session)
        if (live === undefined) throw new Error(t('unavailable'))
        const result = await live.command(`/permission ${option.id}`)
        if (!result.ok || !result.value.matched) throw new Error(t('failed'))
      },
    },
  }))
}
