// @vitest-environment jsdom
/** 父子槽按插件生命周期建立，目录快照只在贡献或语言变化时刷新。 */
import { expect, it, vi } from 'vitest'
import { Service, type Context } from '@deepseek-ai/cordis'
import type { SettingsMirrorSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { NumericInjected } from '../src/client/NumericCard.tsx'
import type { SubagentInjected } from '../src/client/SubagentCard.tsx'
import type { SearchInjected } from '../src/client/SearchCard.tsx'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import * as plugin from '../src/client/index.ts'
import type { PluginsInjected, ConfigurableInjected } from '../src/client/contract.ts'
import { apply as host } from '../src/index.ts'
it('父槽迟到、动态标签排序、语言刷新与释放重装', async () => {
  host(); const runtime = await SlotTestRuntime.create()
  try {
    const locale = new LocaleRuntime(runtime.ctx); runtime.ctx.provide('locale', locale); runtime.slots.installLocale(locale)
    let snapshot: SettingsMirrorSnapshot = { status: 'loading', view: undefined, error: null }
    const mirror = {
      getSnapshot: () => snapshot, subscribe: () => () => {},
      ensure: vi.fn().mockResolvedValue(undefined), acceptView: vi.fn(),
    }
    runtime.ctx.provide('settingsScope', { describe: () => mirror, bind: () => ({
      getSnapshot: () => ({ status: 'ready', writable: true, revision: 1, value: { enabled: true, allowedModels: [] } }),
      subscribe: () => () => {},
    }) } as never)
    // 卡片依赖通过 Cordis 注入；目录测试不触发实际网络写入。
    const events = new Map<string, (...args: string[]) => void>()
    class Remote extends Service {
      constructor(ctx: Context) { super(ctx, 'remote') }
      $on = vi.fn((key: string, listener: (...args: string[]) => void) => {
        events.set(key, listener); return () => { events.delete(key) }
      })
    }
    new Remote(runtime.ctx)
    runtime.ctx.provide('remote.settings', { mutate: vi.fn() } as never)
    const modelCatalog = vi.fn().mockResolvedValue({ ok: true, value: { groups: [], failures: [] } })
    runtime.ctx.provide('remote.session', { modelCatalog } as never)
    runtime.ctx.provide('remote.credentials', {
      describe: vi.fn().mockResolvedValue({ ok: true, value: {} }), set: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
    } as never)
    const rehydrate = vi.fn((value: unknown) => value), nodeAtPath = vi.fn(), validate = vi.fn()
    runtime.ctx.provide('settingsSchema', { rehydrate, nodeAtPath, validate } as never)
    const feature = await runtime.mount(plugin)
    expect(runtime.slots.entries('qs.settings.section')).toHaveLength(0)
    await runtime.declare({ 'qs.settings.section': { kind: 'list', scope: 'root' } })
    const entry = runtime.slots.entries('qs.settings.section')[0]!
    expect(typeof entry.options.label).toBe('function')
    expect((entry.options.label as () => string)()).toBe(locale.getSnapshot().active === 'zh' ? '插件设置' : 'Plugin settings')
    const face = (entry.inject as unknown as () => PluginsInjected)()
    const source = face.hooks.tabs, observe = vi.fn(), off = source.subscribe(observe)
    const empty = source.getSnapshot(); expect(source.getSnapshot()).toBe(empty)
    const dispose = runtime.slots.register({ name: 'qs.settings.plugins.tab', id: 'all', order: 10, label: () => locale.getSnapshot().active }, () => null)
    const fallback = runtime.slots.register({ name: 'qs.settings.plugins.tab', id: 'config' }, () => null)
    expect(source.getSnapshot().map(row => row.id)).toEqual(['configurable', 'config', 'all'])
    expect(source.getSnapshot()[1]!.label).toBe('config')
    locale.setLocale('zh'); expect(source.getSnapshot()[2]!.label).toBe('zh'); expect(observe).toHaveBeenCalled()
    off(); dispose(); fallback(); expect(source.getSnapshot()).toHaveLength(1)
    const config = runtime.slots.entries('qs.settings.plugins.tab')[0]!
    const injected = (config.inject as unknown as () => ConfigurableInjected)()
    expect(injected.hooks.settings).toBe(mirror); injected.retry(); expect(mirror.ensure).toHaveBeenCalledTimes(2)
    const cards = injected.hooks.cards, listener = vi.fn(), removeListener = cards.subscribe(listener)
    const before = cards.getSnapshot(); expect(cards.getSnapshot()).toBe(before)
    const removeCard = runtime.slots.register({ name: 'qs.settings.plugin.item', key: 'extension-fixture' }, () => null)
    expect(cards.getSnapshot()).toEqual(['shell', 'agent-loop', 'subagent-model-selection', 'web-search-deepseek', 'extension-fixture']); await vi.waitFor(() => { expect(listener).toHaveBeenCalled() })
    removeListener(); removeCard(); expect(cards.getSnapshot()).toEqual(['shell', 'agent-loop', 'subagent-model-selection', 'web-search-deepseek'])
    const numeric = runtime.slots.entries('qs.settings.plugin.item')[0]!
    const numericFace = (numeric.inject as unknown as () => NumericInjected)()
    expect(numericFace.valid('timeoutMs', 12)).toBe(false)
    snapshot = { status: 'ready', error: null, view: { writable: true, hasDocument: true, namespaces: [
      { ns: 'shell', schema: { type: 'object' }, revision: 1, applies: 'live', secrets: [], value: {} },
    ] } }
    expect(() => numericFace.valid('absent', 12)).toThrow('Missing settings schema: shell.absent')
    nodeAtPath.mockReturnValue({ type: 'number' })
    validate.mockReturnValue('invalid')
    expect(numericFace.valid('timeoutMs', -1)).toBe(false)
    validate.mockReturnValue(undefined)
    expect(numericFace.valid('timeoutMs', 12)).toBe(true)
    expect(nodeAtPath).toHaveBeenLastCalledWith({ type: 'object' }, ['timeoutMs'])
    expect(validate).toHaveBeenLastCalledWith({ type: 'number' }, 12)
    const writer = numericFace.createWriter(); writer.dispose()
    await expect(writer.save([], 1)).resolves.toEqual({ kind: 'inactive' })
    const subagent = runtime.slots.entries('qs.settings.plugin.item').find(row => row.options.key === 'subagent-model-selection')!
    const subagentFace = (subagent.inject as unknown as () => SubagentInjected)()
    expect(subagentFace.hooks.editor.getSnapshot().enabled).toBe(true)
    const reads = modelCatalog.mock.calls.length
    events.get('llm/adapters-updated')!(); events.get('settings/document-updated')!()
    runtime.ctx.emit('connection/reset')
    expect(modelCatalog.mock.calls.length).toBeGreaterThan(reads)
    const search = runtime.slots.entries('qs.settings.plugin.item').find(row => row.options.key === 'web-search-deepseek')!
    const searchFace = (search.inject as unknown as () => SearchInjected)()
    searchFace.actions.edit('maxUses', '4')
    expect(searchFace.hooks.editor.getSnapshot().invalid).toBe(true)
    snapshot = { ...snapshot, view: { ...snapshot.view!, namespaces: [
      { ns: 'web-search-deepseek', schema: { type: 'object' }, revision: 1, applies: 'live', secrets: [], value: {} },
    ] } }
    nodeAtPath.mockReturnValueOnce(undefined)
    expect(() => { searchFace.actions.edit('maxUses', '5') }).toThrow('Missing settings schema: web-search-deepseek.maxUses')
    searchFace.actions.edit('maxUses', '6')
    expect(searchFace.hooks.editor.getSnapshot().invalid).toBe(false)
    events.get('credentials/reference-updated')!('OTHER')
    events.get('credentials/reference-updated')!('DEEPSEEK_API_KEY')
    searchFace.actions.discard()
    await vi.waitFor(() => { expect(searchFace.hooks.editor.getSnapshot().credential.status).toBe('ready') })
    searchFace.actions.editSecret('fixture-value')
    await searchFace.actions.save()
    expect(searchFace.hooks.editor.getSnapshot().outcome).toEqual({ configuration: 'unchanged', credential: 'written' })
    await feature.dispose(); expect(runtime.slots.spec('qs.settings.plugins.tab')).toBeUndefined()
    expect(events.size).toBe(0)
    await runtime.mount(plugin); expect(runtime.slots.entries('qs.settings.section')).toHaveLength(1)
  } finally { await runtime.dispose() }
})
