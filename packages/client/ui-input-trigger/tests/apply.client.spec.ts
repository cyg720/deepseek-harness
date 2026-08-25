/**
 * apply wiring on a real cordis Context + SlotRegistry: InputTriggerService mounts
 * as ctx.inputTriggers once its sessions dependency is up; the MenuView overlay
 * registration follows the slot declaration, resolves the per-session controller from the slot's
 * sessionId, and unregisters on fiber teardown.
 */
/*
 * 文件职责：验证输入触发菜单的 apply.client.spec.ts 行为。
 * 技术维度：Vitest、React 渲染、事件模拟和服务替身。
 * 产品维度：防止输入触发菜单用户流程回归。
 * 逻辑维度：构造状态，触发行为并断言结果和清理。
 * 关键边界：异步任务、全局替身和 DOM 必须在用例后恢复。
 * 新手阅读建议：先读辅助函数，再按场景顺序阅读。
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { createScope, scopeOf, SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { apply, inject, InputTriggerService } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type { MenuViewInjected } from '@deepseek-ai/dsh-client-ui-input-trigger/client'

/** 中文说明：测试局部值 sid，由紧邻初始化决定。 */
const sid = (k: string): SessionId => k as SessionId

/** 中文说明：函数 bench 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
async function bench() {
  /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  /** 中文说明：测试局部值 slots，由紧邻初始化决定。 */
  const slots = ctx.get('slots') as SlotRegistry
  // Stand-in for the ui-conversation composer entry: declare the overlay
  // slot without providing ConversationController, which is not its lifecycle
  // signal.
  slots.register(
    { name: 'root', children: { 'conversation.input.overlay': { kind: 'list', scope: 'session' } } } as never,
    () => null,
  )
  // Sessions face: mint one real scope for session 'a' and resolve it by id.
  /** 中文说明：测试局部值 scope，由紧邻初始化决定。 */
  const scope = createScope(ctx, sid('a'))
  ctx.provide('sessions', {
    scope: (id: SessionId) => (id === sid('a') ? scope.ctx : undefined),
    scopeOf: (c: Context) => scopeOf(c),
  })
  /** 中文说明：测试局部值 locale，由紧邻初始化决定。 */
  const locale = new LocaleRuntime(ctx)
  // These specs assert the shipped Chinese copy. There is no jsdom `window`
  // in this lane, so browser-language detection never runs and the locale
  // comes from FALLBACK_LOCALE (en): state the asserted locale explicitly.
  locale.setLocale('zh')
  ctx.provide('locale', locale)
  return { ctx, slots, locale }
}

describe('apply', () => {
  it('declares the sessions and locale dependencies (scope tree + localized menu copy)', () => {
    expect(inject).toEqual(['sessions', 'locale'])
  })

  it('registers the bilingual menu dictionaries (group titles by source name + the pending row)', async () => {
    /** 中文说明：测试局部值 { ctx, locale }，由紧邻初始化决定。 */
    const { ctx, locale } = await bench()
    await ctx.plugin({ inject: [...inject], apply }).await()
    /** 中文说明：测试局部值 t，由紧邻初始化决定。 */
    const t = locale.bind('slash.menu')
    expect(t('command')).toBe('命令')
    locale.setLocale('en')
    expect(t('skill')).toBe('Skills')
    expect(t('subagent')).toBe('Subagents')
    expect(t('loading')).toBe('Loading…')
  })

  it('mounts ctx.inputTriggers once sessions is up, before any conversation service exists', async () => {
    /** 中文说明：测试局部值 { ctx }，由紧邻初始化决定。 */
    const { ctx } = await bench()
    await ctx.plugin({ inject: [...inject], apply }).await()
    expect(ctx.get('inputTriggers')).toBeInstanceOf(InputTriggerService)
  })

  it('registers MenuView into the overlay and resolves the per-session controller by slot sessionId', async () => {
    /** 中文说明：测试局部值 { ctx, slots }，由紧邻初始化决定。 */
    const { ctx, slots } = await bench()
    await ctx.plugin({ inject: [...inject], apply }).await()
    expect(slots.entries('conversation.input.overlay')).toHaveLength(1)
    /** 中文说明：测试局部值 entries，由紧邻初始化决定。 */
    const entries = slots.entries('conversation.input.overlay')
    expect(entries[0]!.options.id).toBe('slash-menu')
    // Copy rides the standard locale seat, not the business face.
    expect(entries[0]!.locale).toBe('slash.menu')

    /** 中文说明：测试局部值 inputTriggers，由紧邻初始化决定。 */
    const inputTriggers = ctx.get('inputTriggers') as InputTriggerService
    // StoredEntry.inject is declaration-typed ((...args: never[]) shape);
    // the erased registration widens it past a direct cast, so hop unknown.
    /** 中文说明：测试局部值 injectEntry，由紧邻初始化决定。 */
    const injectEntry = entries[0]!.inject as unknown as (sessionId: SessionId) => MenuViewInjected
    /** 中文说明：测试局部值 injected，由紧邻初始化决定。 */
    const injected = injectEntry(sid('a'))
    /** 中文说明：测试局部值 controller，由紧邻初始化决定。 */
    const controller = inputTriggers.sessionOf(
      (ctx.get('sessions') as { scope(id: SessionId): Context }).scope(sid('a')),
    )
    expect(injected.menu).toBe(controller.menu)
    // The pick face routes into the controller pipeline (closed menu → no-op).
    injected.onPick('command', 0)
    expect(controller.menu.getSnapshot().open).toBe(false)
    // The dismiss face routes into the controller too (closed menu → no-op).
    injected.onDismiss()
    expect(controller.menu.getSnapshot().open).toBe(false)
    // An unknown session id fails loud (no silent scope miss).
    expect(() => injectEntry(sid('ghost'))).toThrow(/resolved no scope/)
  })

  it('fiber teardown removes the overlay entry', async () => {
    /** 中文说明：测试局部值 { ctx, slots }，由紧邻初始化决定。 */
    const { ctx, slots } = await bench()
    /** 中文说明：测试局部值 fiber，由紧邻初始化决定。 */
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(slots.entries('conversation.input.overlay')).toHaveLength(1)

    await fiber.dispose()
    expect(slots.entries('conversation.input.overlay')).toHaveLength(0)
    expect(ctx.get('inputTriggers')).toBeUndefined()
  })
})
