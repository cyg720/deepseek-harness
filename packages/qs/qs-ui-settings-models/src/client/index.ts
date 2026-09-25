import { CredentialOnboarding } from './CredentialOnboarding.tsx'
/** 模型设置独立对应官方 ui-settings-models，复用唯一访问服务。 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-settings-models/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { Models } from './Models.tsx'
import type { ModelsInjected, WelcomeInjected } from './contract.ts'
import { Welcome } from './Welcome.tsx'
import { zh, en } from './locales.ts'
export type * from './contract.ts'
/** 等待官方模型设置状态及 QS 设置壳，不自行创建模型配置服务。 */
export const inject = ['slots', 'locale', 'modelsSettings']
/**
 * 注册原型模型分区及对应子槽，贡献随插件卸载释放。
 * @param ctx - Client 插件上下文。
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register('qs-ui-settings-models', { zh, en }), 'qs models: locale')
  const t = ctx.locale.bind('qs-ui-settings-models'), face = ctx.modelsSettings.face
  ctx.slots.inject('qs.settings.section', () => ctx.slots.register({
    name: 'qs.settings.section', id: 'models', order: 10, label: () => t('title'), locale: 'qs-ui-settings-models',
    inject: (): ModelsInjected => ({ hooks: { snapshot: face.controller.store }, reload: () => face.controller.load(),
      operations: face.operations, schema: face.schema }),
    children: {
      'qs.settings.models.provider-card': { kind: 'keyed', scope: 'root' },
      'qs.settings.models.footer': { kind: 'list', scope: 'root' },
    },
  }, Models))
  // 文案和确认版本属于官方欢迎控制器，二开只替换呈现，避免错误确认不同内容。
  const copy = ctx.locale.bind('settings.models')
  ctx.slots.inject('qs.settings.onboarding', () => ctx.slots.register({
    name: 'qs.settings.onboarding', id: 'welcome-notice', order: -100, locale: 'qs-ui-settings-models',
    inject: (): WelcomeInjected => ({ hooks: { welcome: face.welcome.store }, load: () => face.welcome.load(),
      acknowledge: () => face.welcome.acknowledge(), copy }),
  }, Welcome))
  // 与官方 DeepSeek 首次配置步骤逐项对应，目录和凭据仍由官方服务持有。
  ctx.slots.inject('qs.settings.onboarding', () => ctx.slots.register({
    name: 'qs.settings.onboarding', id: 'deepseek-official', order: 0, locale: 'qs-ui-settings-models',
    inject: (): ModelsInjected => ({ hooks: { snapshot: face.controller.store }, reload: () => face.controller.load(),
      operations: face.operations, schema: face.schema }),
  }, CredentialOnboarding))
}
