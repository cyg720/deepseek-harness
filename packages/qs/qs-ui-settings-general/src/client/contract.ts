/** 设置壳只管理呈现；字段和配置写入归各功能插件。 */
import type { HostObservable, InjectFace, PropsLocale, PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SettingsSectionOwnerProps, SettingsOnboardingOwnerProps, SettingsMirrorSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { ConnectionState } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-qs-ui-sidebar/client'
import type { zh } from './locales.ts'
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** 功能插件逐项贡献设置分区，id 用于导航选择。 */
    'qs.settings.section': { kind: 'list'; scope: 'root'; owner: SettingsSectionOwnerProps }
    /** 设置页头操作；不复制配置源。 */
    'qs.settings.action': { kind: 'list'; scope: 'root'; owner: { children?: never } }
    /** 通用偏好按官方功能 owner 独立注册。 */
    'qs.settings.general.item': { kind: 'list'; scope: 'root'; owner: { children?: never } }
    /** 空白会话中的有序引导，由具体插件决定是否显示。 */
    'qs.settings.onboarding': { kind: 'list'; scope: 'root'; owner: SettingsOnboardingOwnerProps }
  }
  interface LocaleNamespaceMap { 'qs-ui-settings-general': keyof typeof zh }
}
/** 已注册分区或引导的稳定导航快照。 */
export interface SettingsEntry { readonly id: string; readonly label: string }
/** 设置壳共享的官方只读事实和重连操作。 */
export interface SettingsInjected {
  readonly hooks: {
    readonly sections: HostObservable<readonly SettingsEntry[]>
    readonly onboarding: HostObservable<readonly SettingsEntry[]>
    readonly connection: HostObservable<ConnectionState | undefined>
    readonly settings: HostObservable<SettingsMirrorSnapshot>
  }
  /** 请求官方连接服务重新连接。 */
  reconnect(): void
}
/** 设置入口完整呈现座位。 */
export type SettingsProps = PropsRuntime<'qs.sidebar.settings'> & InjectFace<SettingsInjected> & PropsLocale<'qs-ui-settings-general'>
  & PropsRenderSlots<'qs.settings.section' | 'qs.settings.action' | 'qs.settings.onboarding'>
/** 通用分区只负责布局，不接管功能插件状态。 */
export type GeneralProps = PropsRuntime<'qs.settings.section'> & PropsLocale<'qs-ui-settings-general'> & PropsRenderSlots<'qs.settings.general.item'>
