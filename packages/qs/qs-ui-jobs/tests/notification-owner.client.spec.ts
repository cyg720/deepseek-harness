/** 可控微任务证明基线先于列表发布、退出与卸载交错均不会产生历史通知。 */
import { afterEach, expect, it, vi } from 'vitest'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SessionControlSnapshot, SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionJob } from '@deepseek-ai/dsh-api-session-controller/types'
import type { ConnectionGeneration } from '@deepseek-ai/dsh-client-connection/client'
import type { QsAuthSnapshot, QsUiModeSnapshot } from '@deepseek-ai/dsh-qs-shell/client'
import { SessionId } from '@deepseek-ai/dsh-session'
import { watchJobNotifications } from '../src/client/notification-owner.ts'

const a = SessionId('a'), b = SessionId('b'), c = SessionId('c')
const cleanup: (() => void)[] = []
afterEach(() => { for (const dispose of cleanup.splice(0)) dispose() })
const tick = async () => { await Promise.resolve(); await Promise.resolve() }
function fixture(capacity = 4) {
  const list = createSnapshotStore<SessionListState>({
    ids: [a, b, c], byId: Object.fromEntries([a, b, c].map(id => [id, {
      id, displayTitle: id, running: false, blank: false, updatedAt: 1,
    }])), current: a, phase: 'ready', jobsBySession: {}, subagentsByParent: {}, currentAddress: undefined,
  })
  const state = createSnapshotStore<SessionControlSnapshot>({ phase: 'ready', baseline: 1 })
  const generation = createSnapshotStore<ConnectionGeneration | undefined>({ id: 1, host: { home: '/synthetic' } })
  const auth = createSnapshotStore<QsAuthSnapshot>({ authenticated: true })
  const ui = createSnapshotStore<QsUiModeSnapshot>({ ui: 'workbench', showOfficialUiEntry: true })
  const toast = { notificationCapacity: capacity, show: vi.fn(), clear: vi.fn() }
  const dispose = watchJobNotifications({
    sessions: { list, control: { state, retry: async () => {} } }, connection: { generation },
    auth: { ...auth, signIn: async () => {}, signOut: () => {} },
    ui: { ...ui, switchTo: () => {}, setLocalFreeze: () => {} }, toast,
    format: ({ sessionId, job }) => `${sessionId}:${job.status}`,
  })
  cleanup.push(dispose)
  const jobs = (sessionId: SessionId, status: SessionJob['status']) => {
    list.set({ ...list.getSnapshot(), jobsBySession: { ...list.getSnapshot().jobsBySession,
      [sessionId]: [{ id: 'job' as SessionJob['id'], status, startedAt: 1, kind: 'test', label: 'synthetic' }],
    } })
  }
  return { list, state, generation, auth, ui, toast, jobs, dispose }
}

it('notifies only opened sessions once and retains observation when switching away', async () => {
  const f = fixture(); await tick()
  f.jobs(a, 'running'); f.jobs(b, 'running'); await tick()
  f.list.set({ ...f.list.getSnapshot(), current: c }); await tick()
  f.jobs(a, 'completed'); f.jobs(b, 'failed'); await tick()
  expect(f.toast.show.mock.calls).toEqual([['a:completed']])
  f.jobs(a, 'completed'); await tick()
  expect(f.toast.show).toHaveBeenCalledTimes(1)
})

it('seeds the projected baseline instead of interpreting it as a live completion', async () => {
  const f = fixture(); f.jobs(a, 'running'); await tick()
  // 对应 manager.markDirty 排队在 control.state 发布之前的生产顺序。
  queueMicrotask(() => { f.jobs(a, 'completed') })
  f.state.set({ phase: 'ready', baseline: 2 })
  await tick()
  expect(f.toast.show).not.toHaveBeenCalled()
  f.jobs(a, 'running'); await tick()
  f.jobs(a, 'failed'); await tick()
  expect(f.toast.show).toHaveBeenCalledExactlyOnceWith('a:failed')
})

it('silences connection loss, changed generations, hidden UI and logout in the same task', async () => {
  const f = fixture(); f.jobs(a, 'running'); await tick()
  f.generation.set(undefined); f.jobs(a, 'failed'); await tick()
  f.generation.set({ id: 2, host: { home: '/synthetic' } }); await tick()
  f.jobs(a, 'running'); await tick()
  f.ui.set({ ui: 'official', showOfficialUiEntry: true }); await tick()
  f.jobs(a, 'completed'); await tick()
  f.ui.set({ ui: 'workbench', showOfficialUiEntry: true }); await tick()
  f.jobs(a, 'running'); await tick()
  f.auth.set({ authenticated: false }); f.jobs(a, 'failed'); f.auth.set({ authenticated: true }); await tick()
  expect(f.toast.show).not.toHaveBeenCalled()
  expect(f.toast.clear).toHaveBeenCalled()
  f.auth.set({ authenticated: false }); await tick()
  f.auth.set({ authenticated: true }); await tick()
  expect(f.toast.show).not.toHaveBeenCalled()
})

it('bounds visited sessions, removes inaccessible rows, and cancels queued work on disposal', async () => {
  const f = fixture(1); f.jobs(a, 'running'); await tick()
  f.list.set({ ...f.list.getSnapshot(), current: b }); f.jobs(b, 'running'); await tick()
  f.jobs(a, 'completed'); await tick()
  expect(f.toast.show).not.toHaveBeenCalled()
  f.list.set({ ...f.list.getSnapshot(), current: undefined, byId: {} }); await tick()
  f.jobs(b, 'completed'); await tick()
  expect(f.toast.show).not.toHaveBeenCalled()
  f.list.set({ ...f.list.getSnapshot(), phase: 'pending' }); await tick()
  f.state.set({ phase: 'reconnecting', baseline: 1 }); f.dispose(); await tick()
  f.jobs(a, 'failed'); await tick()
  expect(f.toast.show).not.toHaveBeenCalled()
})
