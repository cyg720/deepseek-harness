// @vitest-environment jsdom
/** 目录和扩展座位独立装卸，快照来自官方共享控制器。 */
import { Service, type Context } from '@deepseek-ai/cordis'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { expect, it, vi } from 'vitest'
import * as plugin from '../src/client/index.ts'
import type { ModelsInjected, WelcomeInjected } from '../src/client/contract.ts'
import { apply as hostApply } from '../src/index.ts'
it('迟到设置壳、卸载与重装保留同一官方快照', async () => {
  hostApply()
  const runtime = await SlotTestRuntime.create()
  try {
    const locale = new LocaleRuntime(runtime.ctx)
    runtime.ctx.provide('locale', locale); runtime.slots.installLocale(locale)
    const load = vi.fn(async () => {}), store = { getSnapshot: () => ({}), subscribe: () => () => {} }
    const operations = {}, schema = {}
    const welcome = { store, load: vi.fn(async () => {}), acknowledge: vi.fn(async () => true) }
    class Access extends Service {
      readonly face = { controller: { store, load }, operations, schema, welcome }
      constructor(ctx: Context) { super(ctx, 'modelsSettings') }
    }
    new Access(runtime.ctx)
    const first = await runtime.mount(plugin)
    expect(runtime.slots.entries('qs.settings.section')).toHaveLength(0)
    // 测试根只装配一次，同时声明设置页与引导座位，验证迟到依赖的独立注册。
    await runtime.declare({
      'qs.settings.section': { kind: 'list', scope: 'root' },
      'qs.settings.onboarding': { kind: 'list', scope: 'root' },
    })
    const entry = runtime.slots.entries('qs.settings.section')[0]!
    expect(entry.options.id).toBe('models')
    locale.setLocale('zh'); expect(resolveSlotLabel(entry.options.label)).toBe('模型与供应商')
    locale.setLocale('en'); expect(resolveSlotLabel(entry.options.label)).toBe('Models and providers')
    const injected = (entry.inject as unknown as () => ModelsInjected)()
    expect(injected.hooks.snapshot).toBe(store)
    expect(injected.operations).toBe(operations); expect(injected.schema).toBe(schema)
    await injected.reload(); expect(load).toHaveBeenCalledOnce()
    expect(runtime.slots.spec('qs.settings.models.provider-card')).toMatchObject({ kind: 'keyed' })
    const step = runtime.slots.entries('qs.settings.onboarding')[0]!
    expect(step.options).toMatchObject({ id: 'welcome-notice', order: -100 })
    const notice = (step.inject as unknown as () => WelcomeInjected)()
    expect(notice.hooks.welcome).toBe(welcome.store)
    await notice.load(); expect(welcome.load).toHaveBeenCalledOnce()
    await expect(notice.acknowledge()).resolves.toBe(true); expect(welcome.acknowledge).toHaveBeenCalledOnce()
    const credentialEntry = runtime.slots.entries('qs.settings.onboarding')[1]!
    expect(credentialEntry.options).toMatchObject({ id: 'deepseek-official', order: 0 })
    const credential = (credentialEntry.inject as unknown as () => ModelsInjected)()
    expect(credential.hooks.snapshot).toBe(store); expect(credential.operations).toBe(operations)
    await credential.reload(); expect(load).toHaveBeenCalledTimes(2)
    await first.dispose()
    expect(runtime.slots.entries('qs.settings.section')).toHaveLength(0)
    expect(runtime.slots.entries('qs.settings.onboarding')).toHaveLength(0)
    await runtime.mount(plugin)
    expect(runtime.slots.entries('qs.settings.section')).toHaveLength(1)
    expect(runtime.slots.entries('qs.settings.onboarding').map(entry => entry.options.id)).toEqual(['welcome-notice', 'deepseek-official'])
  } finally { await runtime.dispose() }
})
