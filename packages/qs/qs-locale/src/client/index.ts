/** 独立对应官方 locale 的语言呈现，复用唯一服务与配置镜像。 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { LocaleSnapshot } from '@deepseek-ai/dsh-client-locale/client'
import type { SettingsMirrorSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-qs-ui-settings-general/client'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import { Language } from './Language.tsx'
import { zh, en } from './locales.ts'
/** 语言及持久化事实均由官方服务提供，不建立二开状态副本。 */
export interface LanguageInjected {
  readonly hooks: { readonly locale: HostObservable<LocaleSnapshot>; readonly settings: HostObservable<SettingsMirrorSnapshot> }
  /** @param id - 官方语言目录中的标识。 */
  setLocale(id: string): void
}
declare module '@deepseek-ai/dsh-client-ui-slots' { interface LocaleNamespaceMap { 'qs-locale': keyof typeof zh } }
/** 必需的官方服务与呈现注册表。 */
export const inject = ['slots', 'locale', 'settingsScope']
/**
 * 注册独立语言行，卸载只释放呈现及本包词典。
 * @param ctx - 浏览器插件上下文。
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register('qs-locale', { zh, en }), 'qs-locale: dictionaries')
  ctx.slots.inject('qs.settings.general.item', () => ctx.slots.register({
    name: 'qs.settings.general.item', id: 'language', order: 0, locale: 'qs-locale',
    inject: (): LanguageInjected => ({
      hooks: { locale: ctx.locale, settings: ctx.settingsScope.describe() },
      setLocale: (id) => { ctx.locale.setLocale(id) },
    }),
  }, Language))
}
