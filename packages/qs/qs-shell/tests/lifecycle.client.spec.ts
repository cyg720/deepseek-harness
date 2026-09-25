// @vitest-environment jsdom
/** 外壳的真实插件生命周期：主题订阅、状态条、界面切换和定时提示均随卸载回收。 */
import { afterEach, expect, it, vi } from 'vitest'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { apply, inject } from '../src/client/index.ts'
import { QS_UI_CONFIG_GLOBAL } from '../src/config.ts'
import type { QsChromeInjected, QsOverlayInjected, QsShellRootInjected, QsStatusInjected } from '../src/client/contract.ts'
import type { QsOfficialReturnInjected } from '../src/client/OfficialReturn.tsx'
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })
it.each([false, true])('可选连接和认证服务 %s 时切换与状态订阅可用', async (ready) => {
  vi.stubGlobal(QS_UI_CONFIG_GLOBAL, { defaultUi: 'workbench', showOfficialUiEntry: true })
  const runtime = await SlotTestRuntime.create()
  try {
    const locale = new LocaleRuntime(runtime.ctx)
    runtime.ctx.provide('locale', locale); runtime.slots.installLocale(locale)
    let scheme = 'light'
    runtime.ctx.provide('theme', { getTheme: () => ({ active: { colorScheme: scheme } }) } as never)
    const reconnect = vi.fn(), signOut = vi.fn(), subscribe = vi.fn(() => vi.fn())
    if (ready) {
      runtime.ctx.provide('connection', { state: { getSnapshot: () => 'connected', subscribe }, reconnect, isLoopback: true } as never)
      runtime.ctx.reflect.provide('qsAuth', { signOut })
    }
    await runtime.declare({ 'sidebar.footer.action': { kind: 'list', scope: 'root' } })
    const mounted = await runtime.mount({ inject, apply })
    const root = (runtime.slots.entries('root').filter(entry => entry.options.priority === -1000)[0]!.inject as unknown as () => QsShellRootInjected)()
    const theme = root.hooks.qsTheme
    const initial = theme.getSnapshot(), changed = vi.fn(), offTheme = theme.subscribe(changed)
    expect(theme.getSnapshot()).toBe(initial)
    scheme = 'dark'
    runtime.ctx.emit('theme/change', {} as never)
    expect(changed).toHaveBeenCalledOnce()
    expect(theme.getSnapshot()).toEqual({ scheme: 'dark' })
    offTheme()
    const status = (runtime.slots.entries('qs.status')[0]!.inject as unknown as () => QsStatusInjected)()
    expect(status.hooks.qsConnection.getSnapshot()).toEqual({ state: ready ? 'connected' : undefined, loopback: ready })
    status.hooks.qsConnection.subscribe(vi.fn())(); status.reconnect()
    expect(reconnect).toHaveBeenCalledTimes(ready ? 1 : 0)
    const chrome = (runtime.slots.entries('qs.chrome')[0]!.inject as unknown as () => QsChromeInjected)()
    const modeChange = vi.fn(), offMode = chrome.hooks.qsUiMode.subscribe(modeChange)
    chrome.signOut(); expect(signOut).toHaveBeenCalledTimes(ready ? 1 : 0)
    // 同目标重复切换不得重新注册入口或再次通知订阅者。
    chrome.switchToOfficial(); chrome.switchToOfficial()
    expect(chrome.hooks.qsUiMode.getSnapshot().ui).toBe('official')
    expect(runtime.slots.entries('root').filter(entry => entry.options.priority === -1000)).toHaveLength(0)
    const back = (runtime.slots.entries('sidebar.footer.action')[0]!.inject as unknown as () => QsOfficialReturnInjected)()
    back.backToWorkbench(); back.backToWorkbench()
    expect(runtime.slots.entries('root').filter(entry => entry.options.priority === -1000)).toHaveLength(1)
    expect(runtime.slots.entries('sidebar.footer.action')).toHaveLength(0)
    expect(modeChange).toHaveBeenCalledTimes(2); offMode()
    const overlay = (runtime.slots.entries('qs.overlay')[0]!.inject as unknown as () => QsOverlayInjected)()
    const toasts = overlay.hooks.qsToasts, toastChanged = vi.fn(), offToasts = toasts.subscribe(toastChanged)
    const toast = runtime.ctx.reflect.get('qsToast') as import('../src/client/contract.ts').IQsToast
    expect(toast.notificationCapacity).toBe(256)
    vi.useFakeTimers()
    toast.show('first'); toast.show('second', 100)
    expect(toasts.getSnapshot().map(item => item.message)).toEqual(['first', 'second'])
    await vi.advanceTimersByTimeAsync(100)
    expect(toasts.getSnapshot().map(item => item.message)).toEqual(['first'])
    await vi.advanceTimersByTimeAsync(3100)
    expect(toasts.getSnapshot()).toEqual([])
    toast.show('clear me'); toast.clear()
    expect(toasts.getSnapshot()).toEqual([])
    expect(vi.getTimerCount()).toBe(0)
    offToasts(); const count = toastChanged.mock.calls.length
    toast.show('dispose me')
    await mounted.dispose()
    await vi.advanceTimersByTimeAsync(3200)
    expect(toastChanged).toHaveBeenCalledTimes(count)
    expect(vi.getTimerCount()).toBe(0)
    vi.useRealTimers()
  } finally { await runtime.dispose() }
})
it.each([true, false])('官方首屏配置保留返回入口开关 %s', async (showOfficialUiEntry) => {
  vi.stubGlobal(QS_UI_CONFIG_GLOBAL, { defaultUi: 'official', showOfficialUiEntry })
  const runtime = await SlotTestRuntime.create()
  try {
    const locale = new LocaleRuntime(runtime.ctx)
    runtime.ctx.provide('locale', locale); runtime.slots.installLocale(locale)
    runtime.ctx.provide('theme', { getTheme: () => ({ active: { colorScheme: 'light' } }) } as never)
    await runtime.declare({ 'sidebar.footer.action': { kind: 'list', scope: 'root' } })
    await runtime.mount({ inject, apply })
    expect(runtime.slots.entries('root').filter(entry => entry.options.priority === -1000)).toHaveLength(0)
    expect(runtime.slots.entries('sidebar.footer.action')).toHaveLength(showOfficialUiEntry ? 1 : 0)
  } finally { await runtime.dispose() }
})
