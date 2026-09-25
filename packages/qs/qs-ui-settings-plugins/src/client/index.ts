/** 独立插件设置区；配置及清单各自保持贡献和生命周期。 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { resolveSlotLabel, type HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { PluginTab, PluginsInjected, ConfigurableInjected } from './contract.ts'
import { NumericCard, type NumericInjected, type NumericSpec } from './NumericCard.tsx'
import { createCardWriter } from './save.ts'
import { createModelCatalog } from './model-catalog.ts'
import { createSubagentEditor, type SubagentPreference } from './subagent-editor.ts'
import { SubagentCard, type SubagentInjected } from './SubagentCard.tsx'
import { createCredentialAccess } from './credential-access.ts'
import { createSearchSaver } from './search-save.ts'
import { createSearchEditor, searchCredentialRef, type SearchPreference } from './search-editor.ts'
import { SearchCard, type SearchInjected } from './SearchCard.tsx'
import { Configurable } from './Configurable.tsx'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { Plugins } from './Plugins.tsx'
import { zh, en } from './locales.ts'
export type * from './contract.ts'
/** 必需的呈现服务；配置源继续由官方服务提供。 */
export const inject = ['slots', 'locale', 'settingsScope', 'settingsSchema', 'remote', 'remote.settings', 'remote.session', 'remote.credentials']
/**
 * 注册父区域，子标签只在父槽就绪后装配。
 * @param ctx - 浏览器插件上下文。
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register('qs-ui-settings-plugins', { zh, en }), 'qs plugins: locale')
  const t = ctx.locale.bind('qs-ui-settings-plugins')
  let version = -1, revision = -1, rows: readonly PluginTab[] = []
  const tabs: HostObservable<readonly PluginTab[]> = {
    getSnapshot: () => {
      const nextVersion = ctx.slots.getVersion('qs.settings.plugins.tab'), nextRevision = ctx.locale.getSnapshot().revision
      if (version !== nextVersion || revision !== nextRevision) {
        version = nextVersion; revision = nextRevision
        // list 槽要求 id；缺少标题时使用该标识，避免不可辨认的空标签。
        rows = ctx.slots.entries('qs.settings.plugins.tab').map(entry => ({
          id: entry.options.id as string, label: resolveSlotLabel(entry.options.label) ?? entry.options.id as string,
          order: entry.options.order ?? 0,
        })).sort((a, b) => a.order - b.order)
      }
      return rows
    },
    subscribe: (listener) => {
      const ledger = ctx.slots.subscribe('qs.settings.plugins.tab', listener), locale = ctx.locale.subscribe(listener)
      return () => { ledger(); locale() }
    },
  }
  ctx.slots.inject('qs.settings.section', () => ctx.slots.register({
    name: 'qs.settings.section', id: 'plugins', order: 15, label: () => t('title'), locale: 'qs-ui-settings-plugins',
    inject: (): PluginsInjected => ({ hooks: { tabs } }),
    children: { 'qs.settings.plugins.tab': { kind: 'list', scope: 'root' } },
  }, Plugins))
  const settings = ctx.settingsScope.describe()
  // 只请求官方镜像首次读取，读取及取消生命周期由镜像所有者持有。
  void settings.ensure()
  let cardVersion = -1, keys: readonly string[] = []
  const cards: HostObservable<readonly string[]> = {
    getSnapshot: () => {
      const next = ctx.slots.getVersion('qs.settings.plugin.item')
      if (next !== cardVersion) {
        cardVersion = next
        // keyed 槽保证 key 存在；配置值及可写权限继续由官方镜像持有。
        keys = ctx.slots.entries('qs.settings.plugin.item').map(entry => entry.options.key as string)
      }
      return keys
    },
    subscribe: listener => ctx.slots.subscribe('qs.settings.plugin.item', listener),
  }
  ctx.slots.inject('qs.settings.plugins.tab', () => ctx.slots.register({
    name: 'qs.settings.plugins.tab', id: 'configurable', order: 0, label: () => t('configurable'), locale: 'qs-ui-settings-plugins',
    inject: (): ConfigurableInjected => ({ hooks: { settings, cards }, retry: () => { void settings.ensure() } }),
    children: { 'qs.settings.plugin.item': { kind: 'keyed', scope: 'root' } },
  }, Configurable))

  // 与官方保持两个独立配置卡贡献，字段校验由 Host 提供的 schema 决定。
  const numeric: readonly NumericSpec[] = [
    { namespace: 'shell', title: 'shellTitle', fields: [{ name: 'timeoutMs', label: 'timeout' }, { name: 'maxOutputBytes', label: 'outputLimit' }] },
    { namespace: 'agent-loop', title: 'loopTitle', fields: [{ name: 'maxParallelToolCalls', label: 'parallel' }] },
  ]
  for (const spec of numeric) {
    const injected: NumericInjected = {
      ...spec, hooks: { settings },
      createWriter: () => createCardWriter(spec.namespace, ctx.remote.settings, settings),
      valid: (field, value) => {
        const view = settings.getSnapshot().view?.namespaces.find(row => row.ns === spec.namespace)
        if (view === undefined) return false
        const node = ctx.settingsSchema.nodeAtPath(ctx.settingsSchema.rehydrate(view.schema), [field])
        if (node === undefined) throw new Error(`Missing settings schema: ${spec.namespace}.${field}`)
        return ctx.settingsSchema.validate(node, value) === undefined
      },
    }
    ctx.slots.inject('qs.settings.plugin.item', () => ctx.slots.register({
      name: 'qs.settings.plugin.item', key: spec.namespace, locale: 'qs-ui-settings-plugins', inject: () => injected,
    }, NumericCard))
  }

  const namespace = 'subagent-model-selection'
  const catalog = createModelCatalog(() => ctx.remote.session.modelCatalog())
  const editor = createSubagentEditor(ctx.settingsScope.bind<SubagentPreference>({ namespace }), catalog,
    () => createCardWriter(namespace, ctx.remote.settings, settings))
  // 保持官方目录失效与连接重置职责；插件卸载释放订阅和在途结果拥有权。
  ctx.effect(() => () => { editor.dispose() }, 'qs subagent settings: editor')
  ctx.effect(() => ctx.remote.$on('llm/adapters-updated', () => { editor.refresh() }), 'qs subagent settings: adapters')
  ctx.effect(() => ctx.remote.$on('settings/document-updated', () => { editor.refresh() }), 'qs subagent settings: document')
  ctx.on('connection/reset', () => { editor.reset() })
  ctx.slots.inject('qs.settings.plugin.item', () => ctx.slots.register({
    name: 'qs.settings.plugin.item', key: namespace, locale: 'qs-ui-settings-plugins',
    inject: (): SubagentInjected => ({ hooks: { editor }, actions: editor }),
  }, SubagentCard))
  const searchNamespace = 'web-search-deepseek'
  const searchScope = ctx.settingsScope.bind<SearchPreference>({ namespace: searchNamespace })
  const searchEditor = createSearchEditor(searchScope, () => {
    const credentials = createCredentialAccess(ctx.remote.credentials)
    return { credentials, saver: createSearchSaver(createCardWriter(searchNamespace, ctx.remote.settings, settings), credentials,
      () => searchCredentialRef(searchScope.getSnapshot().value)) }
  }, (field, value) => {
    const view = settings.getSnapshot().view?.namespaces.find(row => row.ns === searchNamespace)
    if (view === undefined) return false
    const node = ctx.settingsSchema.nodeAtPath(ctx.settingsSchema.rehydrate(view.schema), [field])
    if (node === undefined) throw new Error(`Missing settings schema: ${searchNamespace}.${field}`)
    return ctx.settingsSchema.validate(node, value) === undefined
  })
  // 凭据写入来自独立服务，必须订阅它的变更，而不能仅依赖配置镜像刷新。
  ctx.effect(() => ctx.remote.$on('credentials/reference-updated', (ref) => {
    if (ref === searchCredentialRef(searchScope.getSnapshot().value)) searchEditor.refreshCredential()
  }), 'qs search settings: credentials')
  ctx.on('connection/reset', () => { searchEditor.reset() })
  ctx.effect(() => () => { searchEditor.dispose() }, 'qs search settings: editor')
  ctx.slots.inject('qs.settings.plugin.item', () => ctx.slots.register({
    name: 'qs.settings.plugin.item', key: searchNamespace, locale: 'qs-ui-settings-plugins',
    inject: (): SearchInjected => ({ hooks: { editor: searchEditor }, actions: searchEditor }),
  }, SearchCard))
}
