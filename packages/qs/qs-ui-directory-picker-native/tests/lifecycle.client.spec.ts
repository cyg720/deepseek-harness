// @vitest-environment jsdom
/** 双槽必须共同就绪，注册和 Host 发现入口均可独立释放与重装。 */
import { expect, it, vi } from 'vitest'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { apply, inject } from '../src/client/index.ts'
import { apply as hostApply } from '../src/index.ts'
import type { NativeFlowInjected } from '../src/client/flow.ts'

it('registers both native flows and releases them with the plugin', async () => {
  const runtime = await SlotTestRuntime.create()
  try {
    const pickDirectory = vi.fn(async () => '/host/path')
    runtime.ctx.provide('uiWorkspace', { pickDirectory })
    const host = await runtime.mount({ apply: hostApply }); await host.dispose()
    for (let cycle = 0; cycle < 2; cycle++) {
      const plugin = await runtime.mount({ inject, apply })
      if (cycle === 0) {
        expect(runtime.slots.entries('qs.workspace.hero.directoryFlow')).toHaveLength(0)
        await runtime.declare({
          'qs.workspace.hero.directoryFlow': { kind: 'single', scope: 'root' },
          'qs.workspace.sidebar.directoryFlow': { kind: 'single', scope: 'root' },
        })
      }
      for (const slot of ['qs.workspace.hero.directoryFlow', 'qs.workspace.sidebar.directoryFlow'] as const) {
        const entries = runtime.slots.entries(slot)
        expect(entries).toHaveLength(1)
        const face = (entries[0]!.inject as unknown as () => NativeFlowInjected)()
        expect(await face.pick()).toBe('/host/path')
      }
      await plugin.dispose()
      expect(runtime.slots.entries('qs.workspace.hero.directoryFlow')).toHaveLength(0)
      expect(runtime.slots.entries('qs.workspace.sidebar.directoryFlow')).toHaveLength(0)
    }
    expect(pickDirectory).toHaveBeenCalledTimes(4)
  } finally { await runtime.dispose() }
})
