/** Ownerless-copy registrations: the five seats, dictionaries, thunked labels, and HMR recovery. */
/*
 * 文件职责：验证通用设置的 apply.client.spec.ts 行为。
 * 技术维度：Vitest、React 测试渲染、DOM 事件和服务替身。
 * 产品维度：防止通用设置的展示、作用域或交互回归。
 * 逻辑维度：构造上下文与属性，渲染后断言状态和清理。
 * 关键边界：Provider、订阅、全局 DOM 与异步任务必须释放。
 * 新手阅读建议：先读辅助夹具，再按场景顺序阅读。
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import { apply as settingsApply, inject as settingsInject } from '@deepseek-ai/dsh-client-ui-settings/client'
import { apply, inject } from '@deepseek-ai/dsh-client-ui-settings-general/client'
import { CloseLabel, HeaderContent, TriggerContent } from '../src/client/chrome.tsx'
import { GeneralSection } from '../src/client/GeneralSection.tsx'
import { SettingsDocumentAction } from '../src/client/SettingsDocumentAction.tsx'
import type { SettingsDocumentActionInjected } from '../src/client/SettingsDocumentAction.tsx'

// These specs assert the shipped Chinese copy. The lane has no jsdom `window`,
// so browser-language detection never runs and a fresh LocaleRuntime opens on
// FALLBACK_LOCALE (en); bench stages zh explicitly on the locale instead.

/** The seats this plugin fills for a loopback browser (slot name → expected component). */
/* 中文说明：测试局部值 SEATS，由紧邻初始化决定。 */
const SEATS = [
  ['settings.trigger', TriggerContent],
  ['settings.header', HeaderContent],
  ['settings.action', SettingsDocumentAction],
  ['settings.close', CloseLabel],
  ['settings.section', GeneralSection],
] as const

/** 中文说明：函数 bench 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
async function bench(isLoopback = true) {
  /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  /** 中文说明：测试局部值 locale，由紧邻初始化决定。 */
  const locale = new LocaleRuntime(ctx)
  locale.setLocale('zh')
  ctx.provide('locale', locale)
  /** 中文说明：测试局部值 settingsDescribe，由紧邻初始化决定。 */
  const settingsDescribe = vi.fn(() => Promise.resolve({
    ok: true as const,
    value: {
      writable: true,
      hasDocument: true,
      namespaces: [],
    },
  }))
  /** 中文说明：测试局部值 settingsOpenDocument，由紧邻初始化决定。 */
  const settingsOpenDocument = vi.fn(() => Promise.resolve({
    ok: true as const, value: { opened: true as const },
  }))
  ctx.provide('connection', {
    isLoopback,
  } as never)
  new TestRemote(ctx, {
    settings: { describe: settingsDescribe, openSettingsDocument: settingsOpenDocument },
  })
  await ctx.plugin({ inject: [...settingsInject], apply: settingsApply }).await()
  return { ctx, slots: ctx.get('slots') as SlotRegistry, locale, settingsDescribe, settingsOpenDocument }
}

/** Declare the shell's six child slots the way ui-settings' entry does. */
/* 中文说明：函数 declare 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function declare(slots: SlotRegistry): () => void {
  return slots.register(
    {
      name: 'root',
      children: {
        'settings.trigger': { kind: 'single', scope: 'root' },
        'settings.header': { kind: 'single', scope: 'root' },
        'settings.action': { kind: 'list', scope: 'root' },
        'settings.close': { kind: 'single', scope: 'root' },
        'settings.section': { kind: 'list', scope: 'root' },
        'settings.onboarding': { kind: 'list', scope: 'root' },
      },
    } as never,
    () => null,
  )
}

/** 中文说明：函数 generalEntry 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function generalEntry(slots: SlotRegistry) {
  return slots.entries('settings.section').find(e => e.component === GeneralSection)
}

describe('ui-settings-general apply', () => {
  it('declares the services it uses', () => {
    expect(inject).toEqual(['slots', 'locale', 'connection', 'remote', 'remote.settings', 'settingsScope'])
  })

  it('fills all five seats for declarations before or after apply', async () => {
    /** 中文说明：测试局部值 before，由紧邻初始化决定。 */
    const before = await bench()
    declare(before.slots)
    await before.ctx.plugin({ inject: [...inject], apply }).await()
    /** 中文说明：测试局部值 [name，由紧邻初始化决定。 */
    for (const [name, component] of SEATS) {
      expect(before.slots.entries(name)[0]!.component).toBe(component)
    }
    /** 中文说明：测试局部值 entry，由紧邻初始化决定。 */
    const entry = generalEntry(before.slots)!
    expect(entry.options).toMatchObject({ id: 'general', order: 0 })
    // The nav label is a locale-following thunk; owners resolve at read time.
    expect(resolveSlotLabel(entry.options.label)).toBe('通用设置')
    expect(before.slots.spec('settings.general.item')).toEqual({ kind: 'list', scope: 'root' })
    expect(before.slots.entries('settings.general.item')).toEqual([])
    // The onboarding hole stays declared for feature-owned steps; this plugin
    // no longer seats one.
    expect(before.slots.entries('settings.onboarding')).toEqual([])
    /** 中文说明：测试局部值 action，由紧邻初始化决定。 */
    const action = before.slots.entries('settings.action')[0]!
    /** 中文说明：测试局部值 actionInjected，由紧邻初始化决定。 */
    const actionInjected = (action.inject as unknown as () => SettingsDocumentActionInjected)()
    expect(actionInjected.controller.store.getSnapshot().status).toBe('idle')
    expect(actionInjected.hooks.snapshot).toBe(actionInjected.controller.store)
    // Copy rides the standard locale seat: every seat declares the namespace.
    /** 中文说明：测试局部值 [name]，由紧邻初始化决定。 */
    for (const [name] of SEATS) {
      expect(before.slots.entries(name)[0]!.locale).toBe('settings')
    }
    /** 中文说明：测试局部值 after，由紧邻初始化决定。 */
    const after = await bench()
    await after.ctx.plugin({ inject: [...inject], apply }).await()
    /** 中文说明：测试局部值 [name]，由紧邻初始化决定。 */
    for (const [name] of SEATS) expect(after.slots.entries(name)).toHaveLength(0)
    declare(after.slots)
    await Promise.resolve()
    /** 中文说明：测试局部值 [name，由紧邻初始化决定。 */
    for (const [name, component] of SEATS) {
      expect(after.slots.entries(name)[0]!.component).toBe(component)
      // The self-inflicted ledger notifications hit the duplicate guard.
      expect(after.slots.entries(name)).toHaveLength(1)
    }
    await vi.waitFor(() => {
      expect(after.slots.spec('settings.general.item')).toEqual({ kind: 'list', scope: 'root' })
    })
  })

  it('registers the zh/en settings dictionaries and frees the seats on teardown', async () => {
    /** 中文说明：测试局部值 b，由紧邻初始化决定。 */
    const b = await bench()
    declare(b.slots)
    /** 中文说明：测试局部值 fiber，由紧邻初始化决定。 */
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(b.locale.bind('settings')('title')).toBe('设置')
    b.locale.setLocale('en')
    expect(b.locale.bind('settings')('close')).toBe('Close')
    b.locale.setLocale('zh')
    await fiber.dispose()
    // The (ns, locale) seats are free again — the dictionary disposer ran.
    expect(() => b.locale.register('settings', 'zh', {})).not.toThrow()
    expect(() => b.locale.register('settings', 'en', {})).not.toThrow()
  })

  it('the nav label thunk follows the active locale without re-registration', async () => {
    /** 中文说明：测试局部值 b，由紧邻初始化决定。 */
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    /** 中文说明：测试局部值 zhVersions，由紧邻初始化决定。 */
    const zhVersions = SEATS.map(([name]) => b.slots.getVersion(name))
    b.locale.setLocale('en')
    // No ledger churn: freshness rides the thunk (and the renderer's locale
    // subscription), not re-registration.
    SEATS.forEach(([name], i) => {
      expect(b.slots.getVersion(name)).toBe(zhVersions[i]!)
      expect(b.slots.entries(name)).toHaveLength(1)
    })
    expect(resolveSlotLabel(generalEntry(b.slots)!.options.label)).toBe('General')
    b.locale.setLocale('zh')
    expect(resolveSlotLabel(generalEntry(b.slots)!.options.label)).toBe('通用设置')
  })

  it('reads availability from the shared mirror and follows its reconnect refresh', async () => {
    /** 中文说明：测试局部值 b，由紧邻初始化决定。 */
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    /** 中文说明：测试局部值 entry，由紧邻初始化决定。 */
    const entry = b.slots.entries('settings.action')[0]!
    /** 中文说明：测试局部值 { controller }，由紧邻初始化决定。 */
    const { controller } = (entry.inject as unknown as () => SettingsDocumentActionInjected)()
    // The mirror read once at its own boot; the action's load adds no read.
    await vi.waitFor(() => { expect(b.settingsDescribe).toHaveBeenCalledOnce() })
    await controller.load()
    expect(b.settingsDescribe).toHaveBeenCalledOnce()
    expect(controller.store.getSnapshot().status).toBe('ready')
    b.ctx.emit('connection/reset')
    await vi.waitFor(() => { expect(b.settingsDescribe).toHaveBeenCalledTimes(2) })
  })

  it('withholds the Host document action off-loopback', async () => {
    const b = await bench(false)
    declare(b.slots)
    /** 中文说明：测试局部值 fiber，由紧邻初始化决定。 */
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(b.slots.entries('settings.action')).toEqual([])
    expect(b.settingsDescribe).not.toHaveBeenCalled()
    await fiber.dispose()
    /** 中文说明：测试局部值 [name]，由紧邻初始化决定。 */
    for (const [name] of SEATS) expect(b.slots.entries(name)).toEqual([])
  })

  it('re-registers after an HMR collapse of the declaring chain (stale disposers must not block)', async () => {
    /** 中文说明：测试局部值 b，由紧邻初始化决定。 */
    const b = await bench()
    /** 中文说明：测试局部值 redeclare，由紧邻初始化决定。 */
    const redeclare = declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    // Declarer unload: the cascade removes every seat entry and the item
    // declaration while our local disposers go stale.
    redeclare()
    /** 中文说明：测试局部值 [name]，由紧邻初始化决定。 */
    for (const [name] of SEATS) expect(b.slots.entries(name)).toHaveLength(0)
    expect(b.slots.spec('settings.general.item')).toBeUndefined()
    declare(b.slots)
    await Promise.resolve()
    /** 中文说明：测试局部值 [name，由紧邻初始化决定。 */
    for (const [name, component] of SEATS) {
      expect(b.slots.entries(name)[0]!.component).toBe(component)
    }
    expect(b.slots.entries('settings.general.item')).toEqual([])
    expect(b.slots.spec('settings.general.item')).toEqual({ kind: 'list', scope: 'root' })
    // The recovered registrations still ride the locale path.
    b.locale.setLocale('en')
    expect(resolveSlotLabel(generalEntry(b.slots)!.options.label)).toBe('General')
    b.locale.setLocale('zh')
  })

  it('removes every seat and the item declaration on teardown', async () => {
    /** 中文说明：测试局部值 b，由紧邻初始化决定。 */
    const b = await bench()
    declare(b.slots)
    /** 中文说明：测试局部值 fiber，由紧邻初始化决定。 */
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(b.slots.spec('settings.general.item')).toBeDefined()
    await fiber.dispose()
    /** 中文说明：测试局部值 [name]，由紧邻初始化决定。 */
    for (const [name] of SEATS) expect(b.slots.entries(name)).toHaveLength(0)
    expect(b.slots.spec('settings.general.item')).toBeUndefined()
  })
})
