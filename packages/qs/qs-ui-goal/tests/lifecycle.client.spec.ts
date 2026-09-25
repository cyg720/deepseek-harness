// @vitest-environment jsdom
/** 官方共享服务就绪后注册两个 QS 呈现，卸载后不残留条目。 */
import { expect, it, vi } from 'vitest'
import { Service } from '@deepseek-ai/cordis'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import type { GoalInjected } from '../src/client/contract.ts'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { apply, inject } from '../src/client/index.ts'

it('mounts, disposes and remounts independent dock and history entries', async () => {
  const runtime = await SlotTestRuntime.create()
  try {
    const locale = new LocaleRuntime(runtime.ctx)
    runtime.ctx.provide('locale', locale); runtime.slots.installLocale(locale)
    const bind = vi.fn(() => ({ hooks: { goalActivation: { getSnapshot: () => ({}), subscribe: () => () => {} } } }))
    runtime.ctx.provide('goalPresentation', { bind })
    runtime.ctx.provide('connection', { state: { getSnapshot: () => 'connected', subscribe: () => () => {} } })
    // Remote 是 Cordis Service，子服务解析不可用普通对象替代。
    class RemoteService extends Service {}
    new RemoteService(runtime.ctx, 'remote')
    const create = vi.fn(async () => ({ ok: true, value: undefined }))
    const get = vi.fn(async () => ({ ok: true, value: undefined }))
    runtime.ctx.provide('remote.goals', { create, get })
    await runtime.declare({
      'qs.composer.dock': { kind: 'list', scope: 'session' },
      'qs.stage.transcript.row': { kind: 'keyed', scope: 'session', inject: { hooks: { turnData: () => () => undefined } } },
    })
    for (let cycle = 0; cycle < 2; cycle++) {
      const feature = await runtime.mount({ inject, apply })
      const entries = runtime.slots.entries('qs.composer.dock')
      expect(entries).toHaveLength(1)
      expect(runtime.slots.entries('qs.stage.transcript.row')).toHaveLength(1)
      // 注册表擦除贡献者私有注入类型，按本插件声明恢复。
      const provide = entries[0]!.inject as unknown as (id: SessionId) => GoalInjected
      const sid = 'goal-session' as SessionId
      const face = provide(sid)
      expect(bind).toHaveBeenLastCalledWith(sid)
      expect(face.hooks.goalConnected.getSnapshot()).toBe(true)
      const stop = face.hooks.goalConnected.subscribe(() => {})
      stop()
      await face.onCreate('clear')
      expect(create).toHaveBeenLastCalledWith(sid, { objective: 'clear' })
      await face.onRefresh()
      expect(get).toHaveBeenLastCalledWith(sid)
      await feature.dispose()
      expect(runtime.slots.entries('qs.composer.dock')).toHaveLength(0)
      expect(runtime.slots.entries('qs.stage.transcript.row')).toHaveLength(0)
    }
  } finally { await runtime.dispose() }
})
