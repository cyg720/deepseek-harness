// @vitest-environment jsdom
/** 日程贡献等待自己的宿主声明，卸载、重装不残留注册。 */
import { expect, it } from 'vitest'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { apply, inject } from '../src/client/index.ts'
import { apply as hostApply } from '../src/index.ts'
it('registers one independent read-only contribution across remounts', async () => {
  const runtime = await SlotTestRuntime.create()
  try {
    const locale = new LocaleRuntime(runtime.ctx)
    runtime.ctx.provide('locale', locale); runtime.slots.installLocale(locale)
    const host = await runtime.mount({ apply: hostApply }); await host.dispose()
    for (let cycle = 0; cycle < 2; cycle++) {
      const feature = await runtime.mount({ inject, apply })
      if (cycle === 0) {
        expect(runtime.slots.entries('qs.stage.header.actions')).toHaveLength(0)
        await runtime.declare({ 'qs.stage.header.actions': { kind: 'list', scope: 'session' } })
      }
      const entries = runtime.slots.entries('qs.stage.header.actions')
      expect(entries).toHaveLength(1)
      expect(entries[0]!.options.id).toBe('qs-schedule-catalog')
      await feature.dispose()
      expect(runtime.slots.entries('qs.stage.header.actions')).toHaveLength(0)
    }
  } finally { await runtime.dispose() }
})
