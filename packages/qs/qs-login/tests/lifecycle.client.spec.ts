// @vitest-environment jsdom
/** 使用真实槽注册表验证表单、服务与根座位共享身份，卸载会撤销贡献。 */
import { afterEach, expect, it, vi } from 'vitest'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { apply, inject } from '../src/client/index.ts'
import type { QsGateInjected } from '../src/client/contract.ts'
import { DEMO_PASSWORD, SIGN_IN_DELAY_MS } from '../src/client/auth-gateway.ts'
afterEach(() => { vi.useRealTimers(); localStorage.clear() })
it.each([true, false])('记住身份 %s 时表单与服务共享登录和退出通知', async (remember) => {
  const runtime = await SlotTestRuntime.create()
  try {
    const locale = new LocaleRuntime(runtime.ctx)
    runtime.ctx.provide('locale', locale)
    runtime.slots.installLocale(locale)
    await runtime.declare({ 'qs.gate': { kind: 'single', scope: 'root' } })
    const mounted = await runtime.mount({ inject, apply })
    const face = (runtime.slots.entries('qs.gate')[0]!.inject as unknown as () => QsGateInjected)()
    const auth = runtime.ctx.reflect.get('qsAuth') as import('@deepseek-ai/dsh-qs-shell/client').IQsAuth
    expect(auth.getSnapshot()).toEqual({ authenticated: false })
    const serviceNotice = vi.fn(), seatNotice = vi.fn()
    const offService = auth.subscribe(serviceNotice), offSeat = face.hooks.auth.subscribe(seatNotice)
    vi.useFakeTimers()
    const login = face.signIn({ username: ' admin ', password: DEMO_PASSWORD }, remember)
    expect(auth.getSnapshot().authenticated).toBe(false)
    await vi.advanceTimersByTimeAsync(SIGN_IN_DELAY_MS)
    await login
    expect(auth.getSnapshot()).toEqual({ authenticated: true, user: 'admin' })
    expect(face.hooks.auth.getSnapshot()).toEqual(auth.getSnapshot())
    expect(face.rememberedUser()).toBe(remember ? 'admin' : '')
    expect(serviceNotice).toHaveBeenCalledOnce()
    expect(seatNotice).toHaveBeenCalledOnce()
    auth.signOut()
    expect(face.hooks.auth.getSnapshot()).toEqual({ authenticated: false })
    const second = auth.signIn({ username: 'admin', password: DEMO_PASSWORD })
    await vi.advanceTimersByTimeAsync(SIGN_IN_DELAY_MS)
    await second
    expect(face.hooks.auth.getSnapshot().authenticated).toBe(true)
    offService(); offSeat()
    const count = serviceNotice.mock.calls.length
    auth.signOut()
    expect(serviceNotice).toHaveBeenCalledTimes(count)
    vi.useRealTimers()
    await mounted.dispose()
    expect(runtime.slots.entries('qs.gate')).toHaveLength(0)
  } finally { await runtime.dispose() }
})
