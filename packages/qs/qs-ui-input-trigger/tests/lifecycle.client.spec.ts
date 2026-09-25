// @vitest-environment jsdom
/** 候选贡献通过槽注册生命周期装卸，重装不重复占位。 */
import { expect, it, vi } from 'vitest'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { apply, inject } from '../src/client/index.ts'
import type { CommandMenuInjected } from '../src/client/CommandMenu.tsx'

it('解析官方会话输入与控制器，缺会话报错，卸载重装恢复单一贡献', async () => {
  const runtime = await SlotTestRuntime.create()
  try {
    const locale = new LocaleRuntime(runtime.ctx)
    runtime.ctx.provide('locale', locale); runtime.slots.installLocale(locale)
    const scope = {} as ReturnType<typeof runtime.ctx.sessions.scope>
    vi.spyOn(runtime.ctx.sessions, 'scope').mockImplementation(id => id === 'one' ? scope : undefined)
    const controller = {}, input = {}
    const sessionOf = vi.fn(() => controller), resolveInput = vi.fn(() => input)
    runtime.ctx.provide('inputTriggers', { sessionOf } as never)
    runtime.ctx.provide('conversation', { input: { for: resolveInput } } as never)
    await runtime.declare({ 'qs.composer.overlay': { kind: 'list', scope: 'session' } })
    for (let iteration = 0; iteration < 2; iteration++) {
      const mounted = await runtime.mount({ inject, apply })
      const entries = runtime.slots.entries('qs.composer.overlay')
      expect(entries).toHaveLength(1)
      const factory = entries[0]!.inject as unknown as (id: SessionId) => CommandMenuInjected
      expect(factory('one' as SessionId)).toEqual({ controller, input })
      expect(sessionOf).toHaveBeenLastCalledWith(scope)
      expect(resolveInput).toHaveBeenLastCalledWith(scope)
      expect(() => factory('missing' as SessionId)).toThrow('session scope unavailable')
      await mounted.dispose()
      expect(runtime.slots.entries('qs.composer.overlay')).toHaveLength(0)
    }
  } finally { await runtime.dispose() }
})
