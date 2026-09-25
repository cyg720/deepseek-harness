/** 独立对应官方 ui-agent-preset；共享目录读取由官方 Host 提供。 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-qs-ui-settings-general/client'
import { createRoster } from './roster.ts'
import { createPolicy } from './policy.ts'
import { createSeat } from './seat.ts'
import { syncPolicy } from './sync-policy.ts'
import type { QsSendPreparationEntry } from '@deepseek-ai/dsh-qs-composer/client'
import { PresetSeat, PresetLabel, type PresetSeatInjected } from './PresetSeat.tsx'
import { Directory, type DirectoryInjected } from './Directory.tsx'
import { zh, en } from './locales.ts'
declare module '@deepseek-ai/dsh-client-ui-slots' { interface LocaleNamespaceMap { 'qs-ui-agent-preset': keyof typeof zh } }
/** 官方目录和设置能力保持唯一。 */
export const inject = ['slots', 'locale', 'sessions', 'settingsScope', 'remote', 'remote.agentPresets', 'remote.settings']
/**
 * 安装共享目录与设置区域；释放时断开订阅并废弃在途读取。
 * @param ctx - 浏览器插件上下文。
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register('qs-ui-agent-preset', { zh, en }), 'qs presets: dictionaries')
  const t = ctx.locale.bind('qs-ui-agent-preset')
  const roster = createRoster(ctx.remote.agentPresets, ctx.remote.settings)
  const settings = ctx.settingsScope.describe()
  const writer = createPolicy(settings, ctx.remote.settings)
  const seat = createSeat(roster, ctx.remote.agentPresets, () => {
    const source = ctx.sessions.list.getSnapshot()
    const target = source.current === undefined ? undefined : source.byId[source.current]
    if (target === undefined) return undefined
    const preset = target.projectionValues?.agentPreset
    return { id: target.id, blank: target.blank, preset: typeof preset === 'string' ? preset : undefined }
  })
  const policy = syncPolicy(writer, seat, roster)
  ctx.inject(['qsSendPreparation'], (scope) => {
    let value: QsSendPreparationEntry | undefined
    const update = (): void => {
      const source = seat.preparation.getSnapshot()
      value = source === undefined ? undefined : { ...source, reason: t(source.pending ? 'applyingPreset' : 'presetFailed') }
    }
    update()
    scope.effect(() => scope.qsSendPreparation.register('agent-preset', {
      getSnapshot: () => value,
      subscribe: listener => seat.preparation.subscribe(() => { update(); listener() }),
    }, t('presetInterrupted')), 'qs presets: send preparation')
  })
  const refresh = async (): Promise<void> => { await Promise.allSettled([roster.refresh(), settings.ensure()]) }
  ctx.effect(() => () => { seat.dispose(); roster.dispose(); policy.dispose() }, 'qs presets: roster lifetime')
  ctx.effect(() => ctx.remote.$on('settings/document-updated', (ns) => {
    if (ns === 'agent-presets' && roster.getSnapshot().status !== 'idle') void roster.refresh()
  }), 'qs presets: settings invalidation')
  ctx.on('connection/reset', () => {
    const active = roster.getSnapshot().status !== 'idle'
    policy.reset()
    seat.reset()
    roster.reset()
    if (active) void refresh()
  })
  ctx.slots.inject('qs.settings.section', () => ctx.slots.register({
    name: 'qs.settings.section', id: 'agent-presets', order: 20, label: () => t('title'), locale: 'qs-ui-agent-preset',
    inject: (): DirectoryInjected => ({ hooks: { roster, settings }, policy, refresh }),
  }, Directory))
  const face = (): PresetSeatInjected => ({ hooks: { roster, seat }, load: roster.refresh, select: id => seat.select(id) })
  ctx.slots.inject('qs.workspace.hero.agentPreset', () => {
    const off = ctx.sessions.list.subscribe(() => { void seat.update() })
    const remove = ctx.slots.register({ name: 'qs.workspace.hero.agentPreset', locale: 'qs-ui-agent-preset', inject: face }, PresetSeat)
    // 切回官方界面时不保留 QS 暂存选择，防止后续官方新会话接收旧选择。
    return () => { off(); remove(); seat.reset() }
  })
  ctx.slots.inject('qs.stage.header.actions', () => ctx.slots.register({
    name: 'qs.stage.header.actions', id: 'agent-preset', order: -10, locale: 'qs-ui-agent-preset', inject: face,
  }, PresetLabel))
}
