// @vitest-environment jsdom
/** 双槽必须共同就绪，注册和 Host 发现入口均可独立释放与重装。 */
import { expect, it, vi } from 'vitest'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { apply, inject } from '../src/client/index.ts'
import { apply as hostApply } from '../src/index.ts'
import type { BrowseOperations } from '../src/client/browser-state.ts'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'

it('registers both browse flows and releases them with the plugin', async () => {
  const runtime = await SlotTestRuntime.create()
  try {
    const listDirectory = vi.fn(async () => ({ path: '/host/path', home: '/host', crumbs: [], entries: [], truncated: false }))
    const createDirectory = vi.fn(async () => '/host/created')
    runtime.ctx.provide('uiWorkspace', { listDirectory, createDirectory })
    const locale = new LocaleRuntime(runtime.ctx)
    runtime.ctx.provide('locale', locale); runtime.slots.installLocale(locale)
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
        const face = (entries[0]!.inject as unknown as () => BrowseOperations)()
        const signal = new AbortController().signal
        expect((await face.listDirectory('/requested', signal)).path).toBe('/host/path')
        expect(listDirectory).toHaveBeenLastCalledWith('/requested', signal)
        expect(await face.createDirectory('/host', 'new')).toBe('/host/created')
        expect(createDirectory).toHaveBeenLastCalledWith('/host', 'new')
      }
      await plugin.dispose()
      expect(runtime.slots.entries('qs.workspace.hero.directoryFlow')).toHaveLength(0)
      expect(runtime.slots.entries('qs.workspace.sidebar.directoryFlow')).toHaveLength(0)
    }
    expect(listDirectory).toHaveBeenCalledTimes(4)
    expect(createDirectory).toHaveBeenCalledTimes(4)
  } finally { await runtime.dispose() }
})
