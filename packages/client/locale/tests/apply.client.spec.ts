/** locale apply wiring: service + dictionaries provision, declaration-aware
 * Language row registration, snapshot projection into the row store, and
 * recovery after an HMR collapse of the declaring entry. */
/*
 * 文件职责：验证本地化的 apply 行为与边界。
 * 技术维度：Vitest、TypeScript、可控测试替身和真实模块组装。
 * 产品维度：防止用户可见行为在重构或扩展后发生回归。
 * 逻辑维度：构造场景输入，调用被测入口，记录状态并断言结果。
 * 关键边界：测试替身需在用例后清理；异步任务不能泄漏到后续场景。
 * 新手阅读建议：先读辅助函数和固定数据，再按 describe 场景顺序阅读。
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { apply as settingsApply, inject as settingsInject } from '@deepseek-ai/dsh-client-ui-settings/client'
import { TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import {
  apply, inject, SETTINGS_NS,
} from '@deepseek-ai/dsh-client-locale/client'
import type { LanguageRowInjected, LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { LOCALE_SETTINGS_NAMESPACE, LocaleSettingsSchema } from '../src/locale-settings.ts'
import { LanguageRow } from '../src/client/LanguageRow.tsx'
import type { createLanguageRowStore } from '../src/client/settings-store.ts'

/** 中文说明：测试场景的局部值 SLOT，取值由紧邻初始化决定，仅在当前作用域使用。 */
const SLOT = 'settings.general.item'

/** 中文说明：函数 bench 的参数见签名，返回结果供相邻流程使用；调用示例见本文件。 */
async function bench() {
  /** 中文说明：当前 Cordis 上下文 ctx，取值由紧邻初始化决定，仅在当前作用域使用。 */
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  /** 中文说明：测试场景的局部值 preference: string | undefined，取值由紧邻初始化决定，仅在当前作用域使用。 */
  let preference: string | undefined
  /** 中文说明：标识或顺序值 revision，取值由紧邻初始化决定，仅在当前作用域使用。 */
  let revision = 0
  /** 中文说明：测试场景的局部值 namespace，取值由紧邻初始化决定，仅在当前作用域使用。 */
  const namespace = () => ({
    ns: LOCALE_SETTINGS_NAMESPACE,
    schema: LocaleSettingsSchema.toJSON(),
    value: preference === undefined ? {} : { preference },
    applies: 'live' as const,
    secrets: [],
    revision,
  })
  /** 中文说明：测试场景的局部值 describe，取值由紧邻初始化决定，仅在当前作用域使用。 */
  const describe = vi.fn(async () => ({
    ok: true as const,
    value: { writable: true, hasDocument: true, namespaces: [namespace()] },
  }))
  const mutate = vi.fn(async (_ns: string, ops: { value: string }[]) => {
    preference = ops[0]!.value
    revision += 1
    return { ok: true as const, value: namespace() }
  })
  ctx.provide('connection', { api: {}, isLoopback: true } as never)
  const events = new TestRemote(ctx, { settings: { describe, mutate } })
  await ctx.plugin({ inject: [...settingsInject], apply: settingsApply }).await()
  return {
    ctx, slots: ctx.get('slots') as SlotRegistry, describe, mutate, events,
    setHostPreference: (next: string | undefined) => { preference = next; revision += 1 },
  }
}

/** Stand in for the settings shell: declare the General item slot from root. */
/* 中文说明：函数 declareItems 的参数见签名，返回结果供相邻流程使用；调用示例见本文件。 */
function declareItems(slots: SlotRegistry): () => void {
  return slots.register(
    { name: 'root', children: { [SLOT]: { kind: 'list', scope: 'root' } } } as never,
    () => null,
  )
}

/** Mirror the framework's inject choreography: bake a real instance from the
 * declared handle and hand its actions to the entry's inject factory. */
/* 中文说明：函数 faceOf 的参数见签名，返回结果供相邻流程使用；调用示例见本文件。 */
function faceOf(slots: SlotRegistry) {
  /** 中文说明：测试场景的局部值 entry，取值由紧邻初始化决定，仅在当前作用域使用。 */
  const entry = slots.entries(SLOT).find(e => e.component === LanguageRow)!
  /** 中文说明：测试场景的局部值 handle，取值由紧邻初始化决定，仅在当前作用域使用。 */
  const handle = entry.store as ReturnType<typeof createLanguageRowStore>
  /** 中文说明：测试场景的局部值 instance，取值由紧邻初始化决定，仅在当前作用域使用。 */
  const instance = handle.create()
  /** 中文说明：测试场景的局部值 face，取值由紧邻初始化决定，仅在当前作用域使用。 */
  const face = (entry.inject as unknown as (a: typeof instance.actions) => LanguageRowInjected)(instance.actions)
  return { entry, instance, face }
}

describe('locale apply', () => {
  // These are wiring specs, not default-language specs. A fresh LocaleRuntime
  // with no jsdom `window` skips browser detection and opens on FALLBACK_LOCALE
  // (en); each test that reads localized copy stages its locale explicitly via
  // setLocale/Host preference instead of leaning on a dead browser pin.

  it('declares the slot service', () => {
    expect(inject).toEqual(['slots', 'connection', 'remote', 'settingsScope'])
  })

  it('provides the service with base + settings dictionaries and registers the row (declaration before or after apply)', async () => {
    /** 中文说明：测试场景的局部值 before，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const before = await bench()
    declareItems(before.slots)
    await before.ctx.plugin({ inject: [...inject], apply }).await()
    /** 中文说明：测试场景的局部值 locale，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const locale = before.ctx.get('locale') as LocaleRuntime
    // Base dictionaries are registered: the (ns, locale) seats are occupied.
    expect(() => locale.register('common', 'zh', {})).toThrow('already has locale')
    expect(() => locale.register('common', 'en', {})).toThrow('already has locale')
    // The lane has no jsdom `window`, so detection never runs and a fresh
    // service opens on FALLBACK_LOCALE (en); read the zh side explicitly.
    locale.setLocale('zh')
    expect(locale.bind(SETTINGS_NS)('language.title')).toBe('语言')
    /** 中文说明：测试场景的局部值 entry，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const entry = before.slots.entries(SLOT).find(e => e.component === LanguageRow)!
    expect(entry.options).toMatchObject({ id: 'language', order: 0 })

    /** 中文说明：测试场景的局部值 after，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const after = await bench()
    /** 中文说明：测试场景的局部值 fiber，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const fiber = after.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(after.slots.entries(SLOT)).toHaveLength(0)
    declareItems(after.slots)
    await Promise.resolve()
    expect(after.slots.entries(SLOT).some(e => e.component === LanguageRow)).toBe(true)
  })

  it('projects service snapshots into the row store and routes face writes back', async () => {
    /** 中文说明：测试场景的局部值 b，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const b = await bench()
    declareItems(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    /** 中文说明：测试场景的局部值 locale，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const locale = b.ctx.get('locale') as LocaleRuntime
    // An event ahead of any inject hits the unbound-actions arm.
    locale.setLocale('en')

    /** 中文说明：测试场景的局部值 { entry, instance, face }，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const { entry, instance, face } = faceOf(b.slots)
    // The inject-time re-sync sealed the init window: the mirror is current.
    expect(instance.getSnapshot().active).toBe('en')
    expect(instance.getSnapshot().options.map(o => o.id)).toEqual(['zh', 'en'])
    // Copy rides the standard locale seat: the entry declares the namespace.
    expect(entry.locale).toBe(SETTINGS_NS)
    expect(locale.bind(SETTINGS_NS)('language.title')).toBe('Language')

    face.setLocale('zh')
    expect(locale.getLocale().active).toBe('zh')
    expect(instance.getSnapshot().active).toBe('zh')
    expect(locale.bind(SETTINGS_NS)('language.title')).toBe('语言')
    await vi.waitFor(() => { expect(b.mutate).toHaveBeenCalledTimes(2) })
  })

  it('projects external locale registration and disposal into the Language row', async () => {
    const b = await bench()
    declareItems(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const { instance } = faceOf(b.slots)

    const languagePack = b.ctx.plugin({
      inject: ['locale'],
      apply: packCtx => packCtx.effect(
        () => packCtx.locale.addLanguage({ id: 'ja', label: '日本語', fallback: 'en' }),
        'test language pack registration',
      ),
    })
    await languagePack.await()
    expect(instance.getSnapshot().options).toEqual([
      { id: 'zh', label: '中文' },
      { id: 'en', label: 'English' },
      { id: 'ja', label: '日本語' },
    ])

    await languagePack.dispose()
    expect(instance.getSnapshot().options.map(option => option.id)).toEqual(['zh', 'en'])
  })

  it('loads and refreshes the explicit Host preference after nonblocking activation', async () => {
    /** 中文说明：测试场景的局部值 b，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const b = await bench()
    // The shared mirror read once at bench time; a Host-side change reaches it
    // through the document invalidation, exactly as production announces one.
    // Preference must differ from the provisional locale (FALLBACK_LOCALE = en
    // with no window), or clearing it below would be unobservable.
    b.setHostPreference('zh')
    b.events.emit('settings/document-updated', [LOCALE_SETTINGS_NAMESPACE, 0])
    declareItems(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    /** 中文说明：测试场景的局部值 locale，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const locale = b.ctx.get('locale') as LocaleRuntime
    await vi.waitFor(() => { expect(locale.getLocale().active).toBe('zh') })
    // Cleared preference falls back to the provisional locale.
    b.setHostPreference(undefined)
    b.events.emit('settings/document-updated', [LOCALE_SETTINGS_NAMESPACE, 0])
    await vi.waitFor(() => { expect(locale.getLocale().active).toBe('en') })
    // Re-selecting zh after the clear is an explicit pick of the provisional
    // value and must persist as a written preference.
    b.setHostPreference('zh')
    b.events.emit('settings/document-updated', [LOCALE_SETTINGS_NAMESPACE, 0])
    await vi.waitFor(() => { expect(locale.getLocale().active).toBe('zh') })
    expect(b.describe).toHaveBeenCalledTimes(4)
  })

  it('recovers after an HMR collapse of the declaring entry (stale disposer must not block)', async () => {
    /** 中文说明：测试场景的局部值 b，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const b = await bench()
    /** 中文说明：测试场景的局部值 host，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const host = declareItems(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    expect(b.slots.entries(SLOT)).toHaveLength(1)

    // Collapse: the declarer dies, the cascade removes our entry while the
    // apply closure still holds its (now stale) disposer.
    host()
    expect(b.slots.entries(SLOT)).toHaveLength(0)

    declareItems(b.slots)
    await Promise.resolve()
    expect(b.slots.entries(SLOT).some(e => e.component === LanguageRow)).toBe(true)
  })

  it('teardown removes the row; teardown without a declaration is quiet', async () => {
    /** 中文说明：测试场景的局部值 b，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const b = await bench()
    declareItems(b.slots)
    /** 中文说明：测试场景的局部值 fiber，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(b.slots.entries(SLOT)).toHaveLength(1)
    await fiber.dispose()
    expect(b.slots.entries(SLOT)).toHaveLength(0)

    // Never-declared bench: the effect disposer's dispose arm stays undefined.
    /** 中文说明：测试场景的局部值 quiet，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const quiet = await bench()
    /** 中文说明：测试场景的局部值 f2，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const f2 = quiet.ctx.plugin({ inject: [...inject], apply })
    await f2.await()
    await f2.dispose()
    expect(quiet.slots.entries(SLOT)).toHaveLength(0)
  })
})
