/** 插件设置区保持官方父子槽职责；页面由独立贡献拥有。 */
import type { HostObservable, InjectFace, PropsLocale, PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-qs-ui-settings-general/client'
import type { SettingsMirrorSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { zh } from './locales.ts'
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** 配置页和只读清单分别贡献标签。 */
    'qs.settings.plugins.tab': { kind: 'list'; scope: 'root'; owner: { children?: never } }
    /** 配置卡以官方设置命名空间定位。 */
    'qs.settings.plugin.item': { kind: 'keyed'; scope: 'root'; owner: { children?: never } }
  }
  interface LocaleNamespaceMap { 'qs-ui-settings-plugins': keyof typeof zh }
}
/** 已装配标签及本地化标题。 */
export interface PluginTab { readonly id: string; readonly label: string }
/** 只读标签目录，不持有功能页草稿。 */
export interface PluginsInjected { readonly hooks: { readonly tabs: HostObservable<readonly PluginTab[]> } }
/** 插件设置区完整呈现座位。 */
export type PluginsProps = PropsRuntime<'qs.settings.section'> & PropsLocale<'qs-ui-settings-plugins'> & InjectFace<PluginsInjected> & PropsRenderSlots<'qs.settings.plugins.tab'>

/** 配置页只把实际服务的命名空间交给对应卡，不复制配置值。 */
export interface ConfigurableInjected {
  /** 重试尚未取得快照的官方共享读取。 */
  readonly retry: () => void
  readonly hooks: {
    readonly settings: HostObservable<SettingsMirrorSnapshot>
    readonly cards: HostObservable<readonly string[]>
  }
}
/** 命名空间配置卡的动态容器。 */
export type ConfigurableProps = PropsRuntime<'qs.settings.plugins.tab'> & PropsLocale<'qs-ui-settings-plugins'> & InjectFace<ConfigurableInjected> & PropsRenderSlots<'qs.settings.plugin.item'>
