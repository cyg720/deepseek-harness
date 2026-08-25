/*
 * ================================ 文件注释 ================================
 * 【文件职责】设置域基础包的浏览器侧入口：提供 ctx.settingsScope（设置命名空间
 *             作用域服务）并拥有浏览器中唯一的 settings.describe 读取者（镜像）。
 * 【技术维度】Cordis 浏览器插件：镜像的失效订阅（settings/document-updated、
 *             connection/reset）在此注册，所有派生表面从单次线缆读取刷新。
 * 【产品维度】设置面板各行的读写基础服务；任何拥有偏好的功能都能依赖它。
 * 【逻辑维度】1) 创建模式服务与镜像；2) 注册失效订阅并首读；3) 挂载作用域绑定器。
 * 【关键边界】本包不依赖任何 ui-* 呈现包（设置外壳在 ui-settings-general，
 *             避免经 ui-sidebar 与 ui-layout/ui-theme 形成引用环）。
 * 【新手阅读建议】先读 settings-mirror.ts 与 settings-scope.ts，再看本文件的装配。
 * ==========================================================================
 */
/**
 * Settings domain base plugin, browser half. Provides `ctx.settingsScope`, the
 * settings-namespace scope service every preference row binds its durable
 * section through, and owns the one `settings.describe` reader in the browser:
 * the describe mirror, whose invalidation subscriptions
 * (`settings/document-updated`, `connection/reset`) live here so every derived
 * surface refreshes from a single wire read. It depends on no `ui-*`
 * presentation package, so any feature that owns a preference can reach it:
 * the settings SHELL — the `sidebar.settings` occupant, its navigation, and
 * the chrome — lives in ui-settings-general, because a shell dependency on
 * ui-sidebar would close a reference cycle through ui-layout and ui-theme.
 * Export discipline: packages/client/AGENTS.md.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-api-remotes/client'
// Type-only pair supplying `$on` and its key face without dragging a build
// artifact into the Host graph (rationale beside the same pair in
// settings-scope.ts).
import type {} from '@deepseek-ai/dsh-api-remotes/types'
import type {} from '@deepseek-ai/dsh-settings/types'
import { SettingsSchemaService } from './schema.ts'
import { SettingsScopeBinder } from './settings-scope.ts'
import { SettingsDescribeMirror } from './settings-mirror.ts'

export type {
  SettingsGeneralItemOwnerProps, SettingsHeaderOwnerProps, SettingsOnboardingOwnerProps,
  SettingsPluginsTabOwnerProps, SettingsSectionOwnerProps, SettingsTriggerOwnerProps,
} from './contract/slots.ts'
export type { SettingsScopeController, SettingsScopeBinder } from './settings-scope.ts'
export type { SettingsSchemaService } from './schema.ts'
export type { SchemaNode } from './schema.ts'
export type { SettingsDescribeFace, SettingsDescribeView, SettingsMirrorSnapshot } from './settings-mirror.ts'

/**
 * Required services: the wire handle for the mirror's reads and the forwarded
 * settings invalidation the mirror refreshes on.
 */
export const inject = ['connection', 'remote']

/**
 * Provide the settings-namespace scope service over one shared describe
 * mirror, and keep that mirror fresh on the two signals that can move the
 * settings document: a document commit and a (re)connect.
 *
 * Constructing the service in this plugin's fiber keeps its traced methods
 * bound to each consuming plugin's context.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  const schema = new SettingsSchemaService(ctx)
  const connection = ctx.get('connection') as ConnectionHandle
  const mirror = new SettingsDescribeMirror(
    connection.api,
    connection.isLoopback ? 'host' : 'memory',
  )
  ctx.effect(() => {
    const disposers = [
      (ctx.get('remote') as ClientContext['remote']).$on('settings/document-updated', () => { void mirror.load() }),
      ctx.on('connection/reset', () => { void mirror.load() }),
    ]
    // The first connection also emits connection/reset, so startup normally
    // costs two reads (budgeted in startup-rpc-budget.e2e.ts). The in-flight
    // fold does not merge them into one; it guarantees at most one pending
    // read at a time and that no invalidation arriving mid-read is lost.
    void mirror.ensure()
    return () => { for (const dispose of disposers) dispose() }
  }, 'ui-settings: describe mirror invalidations')
  new SettingsScopeBinder(ctx, { mirror, schema })
}
