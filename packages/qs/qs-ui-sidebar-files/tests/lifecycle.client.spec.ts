// @vitest-environment jsdom
/** 独立呈现与官方共享句柄，卸载不清除官方目录状态。 */
import { expect, it, vi } from 'vitest'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { createFilesPresentation } from '@deepseek-ai/dsh-client-ui-sidebar-files/src/client/qs/presentation.ts'
import { apply, inject } from '../src/client/index.ts'

it('waits for parent slots and disposes only its own body and title', async () => {
  const runtime = await SlotTestRuntime.create()
  try {
    const locale = new LocaleRuntime(runtime.ctx)
    runtime.ctx.provide('locale', locale); runtime.slots.installLocale(locale)
    const shared = createFilesPresentation({ workspaceFiles: { list: vi.fn() } })
    runtime.ctx.provide('sidebarFilesPresentation', shared)
    for (let cycle = 0; cycle < 2; cycle++) {
      const fiber = await runtime.mount({ inject, apply })
      if (cycle === 0) {
        expect(runtime.slots.entries('qs.sidebar.right.tab')).toHaveLength(0)
        await runtime.declare({
          'qs.sidebar.right.tab': { kind: 'keyed', scope: 'session', inject: { hooks: { tabInfo: () => () => { throw new Error('Registration-only test does not render tabs') } } } },
          'qs.sidebar.right.tab.title': { kind: 'keyed', scope: 'session', inject: { hooks: { tabInfo: () => () => { throw new Error('Registration-only test does not render tabs') } } } },
        })
      }
      const body = runtime.slots.entries('qs.sidebar.right.tab')
      expect(body).toHaveLength(1)
      expect(body[0]!.store).toBe(shared.store)
      expect(body[0]!.inject).toBe(shared.inject)
      expect(runtime.slots.entries('qs.sidebar.right.tab.title')).toHaveLength(1)
      await fiber.dispose()
      expect(runtime.slots.entries('qs.sidebar.right.tab')).toHaveLength(0)
      expect(runtime.slots.entries('qs.sidebar.right.tab.title')).toHaveLength(0)
      expect(runtime.ctx.sidebarFilesPresentation).toBe(shared)
    }
  } finally { await runtime.dispose() }
})
