// @vitest-environment jsdom
/** 三个既有图片入口独立等待宿主；卸载和重装不保留注册。 */
import { expect, it } from 'vitest'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { apply, inject } from '../src/client/index.ts'
import { apply as hostApply } from '../src/index.ts'
it('registers all three existing-image contributions and removes them on each unload', async () => {
  const runtime = await SlotTestRuntime.create()
  try {
    const locale = new LocaleRuntime(runtime.ctx)
    runtime.ctx.provide('locale', locale); runtime.slots.installLocale(locale)
    const host = await runtime.mount({ apply: hostApply }); await host.dispose()
    const names = ['qs.conversation.message.images', 'qs.tool.call.images', 'qs.conversation.trajectory.images'] as const
    for (let cycle = 0; cycle < 2; cycle++) {
      const feature = await runtime.mount({ inject, apply })
      if (cycle === 0) {
        for (const name of names) expect(runtime.slots.entries(name)).toHaveLength(0)
        await runtime.declare({
          'qs.conversation.message.images': { kind: 'single', scope: 'session' },
          'qs.tool.call.images': { kind: 'single', scope: 'session' },
          'qs.conversation.trajectory.images': { kind: 'single', scope: 'session' },
        })
      }
      for (const name of names) expect(runtime.slots.entries(name)).toHaveLength(1)
      await feature.dispose()
      for (const name of names) expect(runtime.slots.entries(name)).toHaveLength(0)
    }
  } finally { await runtime.dispose() }
})
