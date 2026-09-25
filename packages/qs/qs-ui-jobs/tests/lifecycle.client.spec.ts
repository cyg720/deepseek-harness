// @vitest-environment jsdom
/** 独立贡献等待标题宿主，卸载和重装释放注册与字典。 */
import { expect, it, vi } from 'vitest'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { apply, inject } from '../src/client/index.ts'
import { apply as hostApply } from '../src/index.ts'
import type { JobsInjected } from '../src/client/contract.ts'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { QsAuthSnapshot, QsUiModeSnapshot } from '@deepseek-ai/dsh-qs-shell/client'
import type { SessionJob } from '@deepseek-ai/dsh-api-session-controller/types'
it('registers independently and forwards the one official control source', async () => {
  const runtime = await SlotTestRuntime.create()
  try {
    const locale = new LocaleRuntime(runtime.ctx)
    runtime.ctx.provide('locale', locale); runtime.slots.installLocale(locale)
    const host = await runtime.mount({ apply: hostApply }); await host.dispose()
    const retry = vi.spyOn(runtime.ctx.sessions.control, 'retry').mockResolvedValue(undefined)
    for (let cycle = 0; cycle < 2; cycle++) {
      const feature = await runtime.mount({ inject, apply })
      if (cycle === 0) {
        expect(runtime.slots.entries('qs.stage.header.actions')).toHaveLength(0)
        await runtime.declare({ 'qs.stage.header.actions': { kind: 'list', scope: 'session' } })
      }
      const entries = runtime.slots.entries('qs.stage.header.actions')
      expect(entries).toHaveLength(1)
      const face = (entries[0]!.inject as unknown as () => JobsInjected)()
      expect(face.hooks.qsJobsControl).toBe(runtime.ctx.sessions.control.state)
      await face.retry()
      expect(retry).toHaveBeenCalledTimes(cycle + 1)
      await feature.dispose()
      expect(runtime.slots.entries('qs.stage.header.actions')).toHaveLength(0)
    }
  } finally { vi.restoreAllMocks(); await runtime.dispose() }
})

it('installs localized task notifications once per plugin lifecycle and withdraws queued callbacks', async () => {
  const runtime = await SlotTestRuntime.create()
  try {
    const locale = new LocaleRuntime(runtime.ctx)
    runtime.ctx.provide('locale', locale); runtime.slots.installLocale(locale)
    const auth = createSnapshotStore<QsAuthSnapshot>({ authenticated: true })
    const ui = createSnapshotStore<QsUiModeSnapshot>({ ui: 'workbench', showOfficialUiEntry: true })
    const generation = createSnapshotStore({ id: 1, host: { home: '/synthetic' } })
    const toast = { notificationCapacity: 4, show: vi.fn(), clear: vi.fn() }
    runtime.ctx.reflect.provide('qsAuth', auth)
    runtime.ctx.reflect.provide('qsShell', ui)
    runtime.ctx.reflect.provide('qsToast', toast)
    runtime.ctx.provide('connection', { generation } as never)
    const id = SessionId('notifications')
    runtime.sessions.list.set({ ...runtime.sessions.list.getSnapshot(), phase: 'ready', current: id, ids: [id],
      byId: { [id]: { id, displayTitle: 'Synthetic session', blank: false, running: false, updatedAt: 1 } },
    })
    runtime.sessions.control.state.set({ phase: 'ready', baseline: 1 })
    const publish = async (status: SessionJob['status']) => {
      runtime.sessions.list.set({ ...runtime.sessions.list.getSnapshot(), jobsBySession: {
        [id]: [{ id: 'job' as SessionJob['id'], status, startedAt: 1, label: 'secret-like label', kind: 'test' }],
      } })
      await Promise.resolve()
    }
    for (let cycle = 0; cycle < 2; cycle++) {
      const feature = await runtime.mount({ inject, apply })
      await Promise.resolve()
      for (const status of ['completed', 'failed', 'killed'] as const) {
        await publish('running'); await publish(status)
      }
      expect(toast.show).toHaveBeenCalledTimes((cycle + 1) * 3)
      for (const [message] of toast.show.mock.calls) {
        expect(message).toContain('Synthetic session')
        expect(message).not.toContain('secret-like label')
      }
      await feature.dispose()
      await publish('running'); await publish('completed')
      expect(toast.show).toHaveBeenCalledTimes((cycle + 1) * 3)
    }
    // 通知订阅者可同步移除会话；同批后续提示仍保留不透明身份，不读取失效标题。
    const pair: SessionJob[] = ['first', 'second'].map(key => ({
      id: key as SessionJob['id'], status: 'running', startedAt: 2, label: 'synthetic', kind: 'test',
    }))
    runtime.sessions.list.set({ ...runtime.sessions.list.getSnapshot(), jobsBySession: { [id]: pair } })
    const feature = await runtime.mount({ inject, apply }); await Promise.resolve()
    toast.show.mockImplementationOnce(() => {
      runtime.sessions.list.set({ ...runtime.sessions.list.getSnapshot(), byId: {}, current: undefined })
    })
    runtime.sessions.list.set({ ...runtime.sessions.list.getSnapshot(), jobsBySession: {
      [id]: pair.map(job => ({ ...job, status: 'completed' })),
    } })
    await Promise.resolve()
    expect(toast.show).toHaveBeenCalledTimes(8)
    expect(toast.show.mock.calls.at(-1)?.[0]).toContain(id)
    await feature.dispose()
    expect(toast.clear).toHaveBeenCalledTimes(3)
  } finally { await runtime.dispose() }
})
