/** ui-theme apply wiring: service provision, settings dictionaries riding the
 * locale service, declaration-aware Appearance row registration, snapshot
 * projection into the row store, and HMR collapse recovery. */
/*
 * 文件职责：验证主题与设计系统的 apply.client.spec.ts 行为。
 * 技术维度：Vitest、React 渲染、DOM 事件和服务替身。
 * 产品维度：防止主题与设计系统显示、导航或生命周期回归。
 * 逻辑维度：构造状态，触发交互并断言输出和清理。
 * 关键边界：全局主题、DOM 尺寸和订阅必须在用例后恢复。
 * 新手阅读建议：先读夹具，再按加载、交互和卸载场景阅读。
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import { apply as settingsApply, inject as settingsInject } from '@deepseek-ai/dsh-client-ui-settings/client'
import { apply, inject, SETTINGS_NS } from '@deepseek-ai/dsh-client-ui-theme/client'
import type { AppearanceRowInjected, ThemeRuntime } from '@deepseek-ai/dsh-client-ui-theme/client'
import { THEME_SETTINGS_NAMESPACE, ThemeSettingsSchema } from '../src/theme-settings.ts'
import { AppearanceRow } from '../src/client/AppearanceRow.tsx'
import type { createAppearanceRowStore } from '../src/client/settings-store.ts'

// These specs assert the shipped Chinese copy. The lane has no jsdom `window`,
// so browser-language detection never runs and a fresh LocaleRuntime opens on
// FALLBACK_LOCALE (en); bench stages zh explicitly on the locale instead.

/** 中文说明：测试局部值 SLOT，由紧邻初始化决定。 */
const SLOT = 'settings.general.item'

/** 中文说明：函数 deferred 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function deferred<T>() {
  /** 中文说明：测试局部值 resolve，由紧邻初始化决定。 */
  let resolve!: (value: T) => void
  /** 中文说明：测试局部值 promise，由紧邻初始化决定。 */
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

/** 中文说明：函数 bench 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
async function bench(isLoopback = true) {
  /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  /** 中文说明：测试局部值 locale，由紧邻初始化决定。 */
  const locale = new LocaleRuntime(ctx)
  locale.setLocale('zh')
  ctx.provide('locale', locale)
  /** 中文说明：测试局部值 preference，由紧邻初始化决定。 */
  let preference = 'system'
  /** 中文说明：测试局部值 namespace，由紧邻初始化决定。 */
  const namespace = () => ({
    ns: THEME_SETTINGS_NAMESPACE,
    schema: ThemeSettingsSchema.toJSON(),
    value: { preference },
    applies: 'live' as const,
    secrets: [],
    revision: 0,
  })
  /** 中文说明：测试局部值 describe，由紧邻初始化决定。 */
  const describe = vi.fn(() => Promise.resolve({
    rpcId: 'theme-describe' as never,
    result: {
      ok: true as const,
      value: { writable: true, hasDocument: true, namespaces: [namespace()] },
    },
  }))
  /** 中文说明：测试局部值 mutate，由紧邻初始化决定。 */
  const mutate = vi.fn((request: { ops: { value: string }[] }) => {
    preference = request.ops[0]!.value
    return Promise.resolve({
      rpcId: 'theme-mutate' as never,
      result: { ok: true as const, value: namespace() },
    })
  })
  ctx.provide('connection', { api: { settings: { describe, mutate } }, isLoopback } as never)
  // The settings transport and the forwarded-event port the plugin injects.
  new TestRemote(ctx)
  await ctx.plugin({ inject: [...settingsInject], apply: settingsApply }).await()
  return {
    ctx, slots: ctx.get('slots') as SlotRegistry, locale, describe, mutate,
    setHostPreference: (next: string) => { preference = next },
  }
}

/** Stand in for the settings shell: declare the General item slot from root. */
/* 中文说明：函数 declareItems 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function declareItems(slots: SlotRegistry): () => void {
  return slots.register(
    { name: 'root', children: { [SLOT]: { kind: 'list', scope: 'root' } } } as never,
    () => null,
  )
}

/** Mirror the framework's inject choreography: bake a real instance from the
 * declared handle and hand its actions to the entry's inject factory. */
/* 中文说明：函数 faceOf 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function faceOf(slots: SlotRegistry) {
  /** 中文说明：测试局部值 entry，由紧邻初始化决定。 */
  const entry = slots.entries(SLOT).find(e => e.component === AppearanceRow)!
  /** 中文说明：测试局部值 handle，由紧邻初始化决定。 */
  const handle = entry.store as ReturnType<typeof createAppearanceRowStore>
  /** 中文说明：测试局部值 instance，由紧邻初始化决定。 */
  const instance = handle.create()
  /** 中文说明：测试局部值 face，由紧邻初始化决定。 */
  const face = (entry.inject as unknown as (a: typeof instance.actions) => AppearanceRowInjected)(instance.actions)
  return { entry, instance, face }
}

describe('ui-theme apply', () => {
  it('declares the slot and locale services', () => {
    expect(inject).toEqual(['slots', 'locale', 'connection', 'remote', 'settingsScope'])
  })

  it('provides the service, registers localized copy, and registers the row (declaration before or after apply)', async () => {
    /** 中文说明：测试局部值 before，由紧邻初始化决定。 */
    const before = await bench()
    declareItems(before.slots)
    await before.ctx.plugin({ inject: [...inject], apply }).await()
    expect(before.locale.bind(SETTINGS_NS)('appearance.title')).toBe('外观')
    before.locale.setLocale('en')
    expect(before.locale.bind(SETTINGS_NS)('appearance.title')).toBe('Appearance')
    /** 中文说明：测试局部值 entry，由紧邻初始化决定。 */
    const entry = before.slots.entries(SLOT).find(e => e.component === AppearanceRow)!
    expect(entry.options).toMatchObject({ id: 'appearance', order: 10 })

    /** 中文说明：测试局部值 after，由紧邻初始化决定。 */
    const after = await bench()
    /** 中文说明：测试局部值 fiber，由紧邻初始化决定。 */
    const fiber = after.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(after.slots.entries(SLOT)).toHaveLength(0)
    declareItems(after.slots)
    await Promise.resolve()
    expect(after.slots.entries(SLOT).some(e => e.component === AppearanceRow)).toBe(true)
  })

  it('projects service snapshots into the row store and routes face writes back', async () => {
    /** 中文说明：测试局部值 b，由紧邻初始化决定。 */
    const b = await bench()
    declareItems(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    /** 中文说明：测试局部值 theme，由紧邻初始化决定。 */
    const theme = b.ctx.get('theme') as ThemeRuntime
    // An event ahead of any inject hits the unbound-actions arm.
    theme.setTheme('dark')

    /** 中文说明：测试局部值 { instance, face }，由紧邻初始化决定。 */
    const { instance, face } = faceOf(b.slots)
    // The inject-time re-sync sealed the init window: the mirror is current.
    expect(instance.getSnapshot().preference).toBe('dark')
    // Copy rides the standard locale seat: the entry declares the namespace.
    expect(b.slots.entries(SLOT).find(e => e.component === AppearanceRow)!.locale).toBe(SETTINGS_NS)

    face.setTheme('system')
    expect(theme.getTheme().preference).toBe('system')
    expect(instance.getSnapshot().preference).toBe('system')
    await vi.waitFor(() => { expect(b.mutate).toHaveBeenCalledTimes(2) })
  })

  it('loads Host settings at boot, refreshes its namespace, and keeps remote browsers process-local', async () => {
    /** 中文说明：测试局部值 b，由紧邻初始化决定。 */
    const b = await bench()
    // The shared mirror read once at bench time; a Host-side change reaches it
    // through the document invalidation, exactly as production announces one.
    b.setHostPreference('dark')
    b.ctx.remote.$dispatch('settings/document-updated', [THEME_SETTINGS_NAMESPACE, 0])
    declareItems(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    /** 中文说明：测试局部值 theme，由紧邻初始化决定。 */
    const theme = b.ctx.get('theme') as ThemeRuntime
    await vi.waitFor(() => { expect(theme.getTheme().preference).toBe('dark') })
    // The mirror refreshes on every document commit (ns-agnostic); the scope's
    // derived value only moves when its own namespace changed.
    b.ctx.remote.$dispatch('settings/document-updated', ['unrelated', 0])
    await vi.waitFor(() => { expect(b.describe).toHaveBeenCalledTimes(3) })
    expect(theme.getTheme().preference).toBe('dark')
    b.setHostPreference('light')
    b.ctx.remote.$dispatch('settings/document-updated', [THEME_SETTINGS_NAMESPACE, 0])
    await vi.waitFor(() => { expect(theme.getTheme().preference).toBe('light') })
    b.setHostPreference('dark')
    b.ctx.emit('connection/reset')
    await vi.waitFor(() => { expect(theme.getTheme().preference).toBe('dark') })

    /** 中文说明：测试局部值 remote，由紧邻初始化决定。 */
    const remote = await bench(false)
    declareItems(remote.slots)
    await remote.ctx.plugin({ inject: [...inject], apply }).await()
    /** 中文说明：测试局部值 remoteTheme，由紧邻初始化决定。 */
    const remoteTheme = remote.ctx.get('theme') as ThemeRuntime
    remoteTheme.setTheme('dark')
    await Promise.resolve()
    expect(remote.describe).not.toHaveBeenCalled()
    expect(remote.mutate).not.toHaveBeenCalled()
  })

  it('activates before a slow settings refresh and converges when it settles', async () => {
    /** 中文说明：测试局部值 b，由紧邻初始化决定。 */
    const b = await bench()
    b.setHostPreference('dark')
    /** 中文说明：测试局部值 describe，由紧邻初始化决定。 */
    const describe = b.describe.getMockImplementation()!
    /** 中文说明：测试局部值 pending，由紧邻初始化决定。 */
    const pending = deferred<Awaited<ReturnType<typeof describe>>>()
    b.describe.mockImplementationOnce(() => pending.promise)
    // The refresh hangs on the wire; the mirror keeps serving the last good
    // answer, so activation never blocks on the settings transport.
    b.ctx.remote.$dispatch('settings/document-updated', [THEME_SETTINGS_NAMESPACE, 0])
    /** 中文说明：测试局部值 fiber，由紧邻初始化决定。 */
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    /** 中文说明：测试局部值 theme，由紧邻初始化决定。 */
    const theme = b.ctx.get('theme') as ThemeRuntime
    expect(theme.getTheme().preference).toBe('system')
    pending.resolve(await describe())
    await vi.waitFor(() => { expect(theme.getTheme().preference).toBe('dark') })
    await fiber.dispose()
  })

  it('ignores an invalid preference crossing the settings wire', async () => {
    /** 中文说明：测试局部值 b，由紧邻初始化决定。 */
    const b = await bench()
    b.setHostPreference('sepia')
    b.ctx.remote.$dispatch('settings/document-updated', [THEME_SETTINGS_NAMESPACE, 0])
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    /** 中文说明：测试局部值 theme，由紧邻初始化决定。 */
    const theme = b.ctx.get('theme') as ThemeRuntime
    await vi.waitFor(() => { expect(b.describe).toHaveBeenCalledTimes(2) })
    expect(theme.getTheme().preference).toBe('system')
  })

  it('recovers after an HMR collapse of the declaring entry (stale disposer must not block)', async () => {
    /** 中文说明：测试局部值 b，由紧邻初始化决定。 */
    const b = await bench()
    /** 中文说明：测试局部值 host，由紧邻初始化决定。 */
    const host = declareItems(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    expect(b.slots.entries(SLOT)).toHaveLength(1)

    // Collapse: the declarer dies, the cascade removes our entry while the
    // apply closure still holds its (now stale) disposer.
    host()
    expect(b.slots.entries(SLOT)).toHaveLength(0)

    declareItems(b.slots)
    await Promise.resolve()
    expect(b.slots.entries(SLOT).some(e => e.component === AppearanceRow)).toBe(true)
  })

  it('teardown removes the row and the dictionaries; teardown without a declaration is quiet', async () => {
    /** 中文说明：测试局部值 b，由紧邻初始化决定。 */
    const b = await bench()
    declareItems(b.slots)
    /** 中文说明：测试局部值 fiber，由紧邻初始化决定。 */
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(b.slots.entries(SLOT)).toHaveLength(1)
    await fiber.dispose()
    expect(b.slots.entries(SLOT)).toHaveLength(0)
    // Dictionary disposal: translation falls back to the bare key.
    expect(b.locale.bind(SETTINGS_NS)('appearance.title')).toBe('appearance.title')

    // Never-declared bench: the effect disposer's dispose arm stays undefined.
    /** 中文说明：测试局部值 quiet，由紧邻初始化决定。 */
    const quiet = await bench()
    /** 中文说明：测试局部值 f2，由紧邻初始化决定。 */
    const f2 = quiet.ctx.plugin({ inject: [...inject], apply })
    await f2.await()
    await f2.dispose()
    expect(quiet.slots.entries(SLOT)).toHaveLength(0)
  })
})
