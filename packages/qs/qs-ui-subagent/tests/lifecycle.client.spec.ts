// @vitest-environment jsdom
/** 两项呈现贡献均随独立插件卸载，导航完整传递官方目录地址。 */
import { expect, it, vi } from 'vitest'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { CatalogActions } from '../src/client/contract.ts'
import { apply, inject } from '../src/client/index.ts'
import { apply as hostApply } from '../src/index.ts'

it('registers, disposes and remounts both contributions using one official session owner', async () => {
  const runtime = await SlotTestRuntime.create()
  try {
    const locale = new LocaleRuntime(runtime.ctx)
    runtime.ctx.provide('locale', locale); runtime.slots.installLocale(locale)
    const sessions = runtime.ctx.sessions
    const open = vi.spyOn(sessions, 'open').mockImplementation(() => {})
    const openSubagent = vi.spyOn(sessions, 'openSubagent').mockImplementation(() => {})
    const refreshSubagents = vi.spyOn(sessions, 'refreshSubagents').mockResolvedValue(undefined)
    const setSubagentCatalogOpen = vi.spyOn(sessions, 'setSubagentCatalogOpen').mockImplementation(() => {})
    const host = await runtime.mount({ apply: hostApply }); await host.dispose()
    for (let cycle = 0; cycle < 2; cycle++) {
      const feature = await runtime.mount({ inject, apply })
      if (cycle === 0) {
        expect(runtime.slots.entries('qs.stage.header.actions')).toHaveLength(0)
        await runtime.declare({
          'qs.stage.header.actions': { kind: 'list', scope: 'session' },
          'qs.composer.takeover': { kind: 'chain', scope: 'session' },
        })
      }
      const entries = runtime.slots.entries('qs.stage.header.actions')
      expect(entries).toHaveLength(1)
      expect(runtime.slots.entries('qs.composer.takeover')).toHaveLength(1)
      // 注册表擦除贡献者的私有注入面；这里恢复本插件声明用于调用断言。
      const actions = (entries[0]!.inject as unknown as () => CatalogActions)()
      const id = 'parent' as SessionId
      const address = { parentSessionId: id, childSessionId: 'child' as SessionId, mode: 'one-shot' as const }
      actions.openChild(address); expect(openSubagent).toHaveBeenLastCalledWith(address)
      actions.openParent(id); expect(open).toHaveBeenLastCalledWith(id)
      actions.refresh(id); expect(refreshSubagents).toHaveBeenLastCalledWith(id)
      actions.setCatalogOpen(id, true); expect(setSubagentCatalogOpen).toHaveBeenLastCalledWith(id, true)
      await feature.dispose()
      expect(runtime.slots.entries('qs.stage.header.actions')).toHaveLength(0)
      expect(runtime.slots.entries('qs.composer.takeover')).toHaveLength(0)
    }
  } finally { await runtime.dispose() }
})
