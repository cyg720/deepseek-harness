// @vitest-environment jsdom
/** 用官方服务验证共享句柄和独立贡献的卸载重装。 */
import { expect, it, vi } from 'vitest'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import * as official from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import * as plugin from '../src/client/index.ts'

it('等待父槽，复用官方 store，卸载只删除 QS 呈现，重装仍使用同一句柄', async () => {
  const runtime = await SlotTestRuntime.create()
  try {
    const locale = new LocaleRuntime(runtime.ctx)
    runtime.ctx.provide('locale', locale)
    runtime.slots.installLocale(locale)
    runtime.ctx.provide('layout', { openRightbar: vi.fn(), closeRightbar: vi.fn() } as never)
    runtime.ctx.provide('resources', { pin: vi.fn() } as never)
    await runtime.mount(official)
    const shared = runtime.ctx.sidebarRightPresentation.store
    const first = await runtime.mount(plugin)
    expect(runtime.slots.entries('qs.inspector')).toHaveLength(0)
    await runtime.declare({ 'qs.inspector': { kind: 'single', scope: 'root' } })
    expect(runtime.slots.entries('qs.sidebar.right.session')[0]?.store).toBe(shared)
    expect(runtime.slots.entries('qs.sidebar.right.tab')).toHaveLength(1)
    await first.dispose()
    expect(runtime.slots.entries('qs.inspector')).toHaveLength(0)
    expect(runtime.slots.entries('qs.sidebar.right.tab')).toHaveLength(0)
    expect(runtime.ctx.sidebarRightPresentation.store).toBe(shared)
    await runtime.mount(plugin)
    expect(runtime.slots.entries('qs.sidebar.right.session')[0]?.store).toBe(shared)
    expect(runtime.slots.entries('qs.sidebar.right.tab')).toHaveLength(1)
  } finally { await runtime.dispose() }
})

it('可选登录服务接线随插件释放，冷态装配不清除记录，重装后退出清除记录', async () => {
  const runtime = await SlotTestRuntime.create()
  const key = 'dsh.qs.panel-layout.lifecycle'
  try {
    const locale = new LocaleRuntime(runtime.ctx)
    runtime.ctx.provide('locale', locale); runtime.slots.installLocale(locale)
    runtime.ctx.provide('layout', { openRightbar: vi.fn(), closeRightbar: vi.fn() } as never)
    runtime.ctx.provide('resources', { pin: vi.fn() } as never)
    const listeners = new Set<() => void>()
    let authenticated = false
    const auth = { getSnapshot: () => ({ authenticated }), subscribe: (listener: () => void) => {
      listeners.add(listener); return () => { listeners.delete(listener) }
    } }
    runtime.ctx.provide('qsAuth', auth)
    await runtime.mount(official)
    localStorage.setItem(key, 'pending restore')
    const first = await runtime.mount(plugin)
    expect(listeners.size).toBe(1)
    expect(localStorage.getItem(key)).toBe('pending restore')
    await first.dispose()
    expect(listeners.size).toBe(0)
    await runtime.mount(plugin)
    authenticated = true; for (const listener of listeners) listener()
    expect(localStorage.getItem(key)).toBe('pending restore')
    authenticated = false; for (const listener of listeners) listener()
    expect(localStorage.getItem(key)).toBeNull()
  } finally { await runtime.dispose(); localStorage.removeItem(key) }
})
