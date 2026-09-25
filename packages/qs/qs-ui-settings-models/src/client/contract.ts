/** 二开模型设置扩展与官方子席位逐项对应。 */
import type { HostObservable, InjectFace, PropsLocale, PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ModelsSettingsFace, ModelsSettingsState, ModelsFooterOwnerProps, ProviderCardExtrasOwnerProps } from '@deepseek-ai/dsh-client-ui-settings-models/client'
import type {} from '@deepseek-ai/dsh-qs-ui-settings-general/client'
import type { zh } from './locales.ts'
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** 供应商卡的适配器扩展区域，按所属 settingsNs 寻址。 */
    'qs.settings.models.provider-card': { kind: 'keyed'; scope: 'root'; owner: ProviderCardExtrasOwnerProps }
    /** 模型设置页尾的独立扩展。 */
    'qs.settings.models.footer': { kind: 'list'; scope: 'root'; owner: ModelsFooterOwnerProps }
  }
  interface LocaleNamespaceMap { 'qs-ui-settings-models': keyof typeof zh }
}
/** 只消费官方目录快照与读取动作，不复制控制器。 */
export interface ModelsInjected {
  readonly hooks: { readonly snapshot: HostObservable<ModelsSettingsState> }
  readonly operations: ModelsSettingsFace['operations']
  readonly schema: ModelsSettingsFace['schema']
  /** @returns 本次目录读取结束；传输拒绝由视图呈现可重试状态。 */
  readonly reload: () => Promise<void>
}
/** 模型分区完整呈现参数。 */
export type ModelsProps = PropsRuntime<'qs.settings.section'> & InjectFace<ModelsInjected> & PropsLocale<'qs-ui-settings-models'>
  & PropsRenderSlots<'qs.settings.models.provider-card' | 'qs.settings.models.footer'>

/** 欢迎说明与官方确认版本共享控制器，文案也读取同一官方词典。 */
export interface WelcomeInjected {
  readonly hooks: { readonly welcome: ModelsSettingsFace['welcome']['store'] }
  /** @returns 欢迎确认状态读取完成。 */
  readonly load: () => Promise<void>
  /** @returns 当前说明版本是否已确认。 */
  readonly acknowledge: () => Promise<boolean>
  /**
   * 读取与确认版本一致的说明。
   * @param key - 官方版本化欢迎说明字段。
   * @returns 当前语言对应的说明。
   */
  readonly copy: (key: 'welcomeTitle' | 'welcomeBody' | 'welcomeError' | 'welcomeContinue') => string
}
/** 欢迎步骤读取共享状态，通过设置壳完成当前注册项。 */
export type WelcomeProps = PropsRuntime<'qs.settings.onboarding'> & InjectFace<WelcomeInjected> & PropsLocale<'qs-ui-settings-models'>

/** 首次凭据配置只消费模型目录，不持有第二个控制器。 */
export type CredentialOnboardingProps = PropsRuntime<'qs.settings.onboarding'> & InjectFace<ModelsInjected> & PropsLocale<'qs-ui-settings-models'>
