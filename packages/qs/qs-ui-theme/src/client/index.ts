/** 对应官方 ui-theme 的两个设置行，共享其状态、事件和持久化。 */
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { ThemeSnapshot } from '@deepseek-ai/dsh-client-ui-theme/client'
import type { SettingsMirrorSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-qs-ui-settings-general/client'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import { Appearance, FontSize } from './Rows.tsx'
import { zh, en } from './locales.ts'
/** 官方快照及命令，不维护独立主题偏好。 */
export interface ThemeInjected {
  readonly hooks: { readonly theme: HostObservable<ThemeSnapshot>; readonly settings: HostObservable<SettingsMirrorSnapshot> }
  /** @param id - 官方已注册主题或 system。 */
  setTheme(id: string): void
  /** @param px - 官方接受的 12 至 17 整数像素。 */
  setFontSize(px: number): void
}
declare module '@deepseek-ai/dsh-client-ui-slots' { interface LocaleNamespaceMap { 'qs-ui-theme': keyof typeof zh } }
/** 呈现依赖唯一官方服务与设置镜像。 */
export const inject = ['slots', 'locale', 'theme', 'settingsScope']
/**
 * 独立注册外观与字号行，释放呈现不释放官方服务。
 * @param ctx - 浏览器插件上下文。
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register('qs-ui-theme', { zh, en }), 'qs-ui-theme: dictionaries')
  const theme: HostObservable<ThemeSnapshot> = {
    getSnapshot: () => ctx.theme.getTheme(),
    subscribe: listener => ctx.on('theme/change', () => { listener() }),
  }
  const injected = (): ThemeInjected => ({
    hooks: { theme, settings: ctx.settingsScope.describe() },
    setTheme: (id) => { ctx.theme.setTheme(id) },
    setFontSize: (px) => { ctx.theme.setFontSize(px) },
  })
  ctx.slots.inject('qs.settings.general.item', () => ctx.slots.register({
    name: 'qs.settings.general.item', id: 'appearance', order: 10, locale: 'qs-ui-theme', inject: injected,
  }, Appearance))
  ctx.slots.inject('qs.settings.general.item', () => ctx.slots.register({
    name: 'qs.settings.general.item', id: 'font-size', order: 11, locale: 'qs-ui-theme', inject: injected,
  }, FontSize))
}
