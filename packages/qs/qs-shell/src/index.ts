/**
 * 奇术工作台的 Host 入口。
 *
 * 职责：解析 Loader 行配置 `{ defaultUi, showOfficialUiEntry }`，并按仓库既有的
 * 宿主到浏览器配置通路（`webserver/index-inject` 的 `global` 行）把它交给浏览器半边。
 * 浏览器半边不读 Loader 行配置——`dsh.client` 行的浏览器半边由模块系统装载，
 * 拿不到宿主侧的行配置。
 */
import type { Context } from '@deepseek-ai/cordis'
// 仅类型：引入 webServer 服务与 `webserver/index-inject` 事件合并。
import type {} from '@deepseek-ai/dsh-host-webserver'
import Schema from '@deepseek-ai/schemastery'
import { QS_UI_CONFIG_GLOBAL, resolveQsShellConfig } from './config.ts'
import type { QsShellConfig } from './client/contract.ts'

/** Loader 行配置的校验 schema；非法枚举与非法布尔值在加载期就失败。 */
export const Config: Schema<QsShellConfig> = Schema.object({
  defaultUi: Schema.union(['workbench', 'official'] as const).default('workbench'),
  showOfficialUiEntry: Schema.boolean().default(false),
})

/**
 * 注册宿主侧行为。
 * @param ctx - 宿主插件上下文。
 * @param config - 已解析的行配置（schema 默认值已应用）。
 */
export function apply(ctx: Context, config?: QsShellConfig): void {
  const resolved = resolveQsShellConfig(config ?? {})
  ctx.inject(['webServer'], (webCtx) => {
    webCtx.effect(() => webCtx.on('webserver/index-inject', (table) => {
      table.push({ kind: 'global', name: QS_UI_CONFIG_GLOBAL, value: resolved })
    }), 'qs-shell: index config injection')
  })
}
