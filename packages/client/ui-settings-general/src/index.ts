/**
 * ================================ 文件注释 ================================
 * 【文件职责】ui-settings-general 包的宿主侧入口：向设置提供者注册持久化的
 *             GUI 引导（onboarding）设置段。
 * 【技术维度】Cordis 宿主插件：ctx.inject(['settings']) 后调用 settings.register
 *             注册命名空间与 schemastery 模式。
 * 【产品维度】欢迎通知"已读版本号"的持久化载体。
 * 【逻辑维度】apply 在 settings 服务可用时注册 ui-onboarding 命名空间及其模式。
 * 【关键边界】只在存在设置提供者时注册；浏览器半部从 ./client 导出。
 * 【新手阅读建议】对照 ui-settings-models/onboarding-copy.ts 的字段名阅读。
 * ==========================================================================
 */
/** Host loader entry for the browser implementation exported from `./client`. */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'

/** Durable settings namespace for product-wide GUI onboarding facts. */
const ONBOARDING_SETTINGS_NAMESPACE = 'ui-onboarding'

interface OnboardingSettings {
  /** Last version acknowledged by the current product welcome step. */
  welcomeNoticeVersion?: string
}

const OnboardingSettingsSchema: z<OnboardingSettings> = z.object({
  welcomeNoticeVersion: z.string(),
})

/** Register the durable GUI-onboarding section when a settings provider exists. */
export function apply(ctx: Context): void {
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.register(
      settingsNamespace(ONBOARDING_SETTINGS_NAMESPACE),
      OnboardingSettingsSchema,
    )
  })
}
