// @vitest-environment jsdom
/** 命令弹层贡献通过槽注册生命周期装卸，重装不重复占位。 */
import { expect, it, vi } from 'vitest'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { apply, inject } from '../src/client/index.ts'
import type { CommandPopupInjected } from '../src/client/CommandPopup.tsx'

it('解析官方会话输入与控制器，缺会话报错，卸载重装恢复单一贡献', async () => {
  const runtime = await SlotTestRuntime.create()
  try {
    const locale = new LocaleRuntime(runtime.ctx)
    runtime.ctx.provide('locale', locale); runtime.slots.installLocale(locale)
    const scope = {} as ReturnType<typeof runtime.ctx.sessions.scope>
    vi.spyOn(runtime.ctx.sessions, 'scope').mockImplementation(id => id === 'one' ? scope : undefined)
    const popup = {}
    const popupFor = vi.fn(() => popup), release = vi.fn(), bindComposerFocus = vi.fn(() => release)
    runtime.ctx.provide('commandUi', { popupFor, bindComposerFocus } as never)
    await runtime.declare({ 'qs.composer.overlay': { kind: 'list', scope: 'session' } })
    for (let iteration = 0; iteration < 2; iteration++) {
      const mounted = await runtime.mount({ inject, apply })
      const entries = runtime.slots.entries('qs.composer.overlay')
      expect(entries).toHaveLength(1)
      const factory = entries[0]!.inject as unknown as (id: SessionId) => CommandPopupInjected
      const injected = factory('one' as SessionId)
      expect(injected.popup).toBe(popup)
      expect(popupFor).toHaveBeenLastCalledWith(scope)
      const focus = vi.fn()
      expect(injected.bindFocus(focus)).toBe(release)
      expect(bindComposerFocus).toHaveBeenLastCalledWith('one', focus)
      expect(() => factory('missing' as SessionId)).toThrow('session scope unavailable')
      await mounted.dispose()
      expect(runtime.slots.entries('qs.composer.overlay')).toHaveLength(0)
    }
  } finally { await runtime.dispose() }
})
