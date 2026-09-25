// @vitest-environment jsdom
/** 装卸 QS 呈现不销毁官方请求控制器，也不新增领域投影。 */
import { expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SessionId } from '@deepseek-ai/dsh-session'
import { PresentedOpenController } from '@deepseek-ai/dsh-client-ui-deliverables/src/client/present-open.ts'
import { createDeliverablesPresentation } from '@deepseek-ai/dsh-client-ui-deliverables/src/client/qs/presentation.ts'
import { apply, inject } from '../src/client/index.ts'
import type { DeliveredInjected } from '../src/client/Deliverables.tsx'
import { apply as hostApply } from '../src/index.ts'

it('waits for slots, preserves official shared operations and removes both contributions on unload', async () => {
  const runtime = await SlotTestRuntime.create(), opener = new PresentedOpenController()
  try {
    // Host 面可独立装卸，不要求浏览器座位或额外原生服务。
    const hostFiber = await runtime.mount({ apply: hostApply })
    await hostFiber.dispose()
    const locale = new LocaleRuntime(runtime.ctx)
    runtime.ctx.provide('locale', locale); runtime.slots.installLocale(locale)
    const shared = createDeliverablesPresentation(opener), openResource = vi.fn()
    runtime.ctx.provide('deliverablesPresentation', shared)
    runtime.ctx.provide('sidebarRight', { openResource } as unknown as Context['sidebarRight'])
    for (let cycle = 0; cycle < 2; cycle++) {
      const fiber = await runtime.mount({ inject, apply })
      if (cycle === 0) {
        expect(runtime.slots.entries('qs.chat.turn-tail')).toHaveLength(0)
        await runtime.declare({ 'qs.chat.turn-tail': { kind: 'chain', scope: 'session' }, 'qs.tool.call.toolview': { kind: 'keyed', scope: 'session' } })
      }
      const entry = runtime.slots.entries('qs.chat.turn-tail')[0]!
      if (typeof entry.inject !== 'function') throw new Error('Missing delivery injection')
      const bind = entry.inject as unknown as (session: ReturnType<typeof SessionId>) => DeliveredInjected
      const face = bind(SessionId('active'))
      expect(face.hooks).toBe(shared.injected.hooks)
      expect(face.openPresented).toBe(shared.injected.openPresented)
      face.openFile('report.pdf')
      expect(openResource).toHaveBeenLastCalledWith('dsh-resource://file/session/active/report.pdf')
      expect(runtime.slots.entries('qs.tool.call.toolview')).toHaveLength(1)
      await fiber.dispose()
      expect(runtime.slots.entries('qs.chat.turn-tail')).toHaveLength(0)
      expect(runtime.slots.entries('qs.tool.call.toolview')).toHaveLength(0)
      expect(runtime.ctx.deliverablesPresentation).toBe(shared)
    }
  } finally { await opener.dispose(); await runtime.dispose() }
})
