/** 保存回执与当前会话组成回执分别确认，目标在写入前捕获。 */
import { expect, it, vi } from 'vitest'
import { syncPolicy } from '../src/client/sync-policy.ts'
import type { QsPresetPolicy } from '../src/client/policy.ts'
import type { QsPresetRosterState } from '../src/client/roster.ts'
it('失败写入不触发同步，成功后读取 Host 生效默认并保留部分失败', async () => {
  const save = vi.fn<QsPresetPolicy['save']>().mockResolvedValue('written')
  const sync = vi.fn(async (_id: string) => true)
  const captureDefaultSync = vi.fn(() => sync)
  const refresh = vi.fn(async () => {})
  let state: QsPresetRosterState = { status: 'ready', canOpenDirectory: false, roster: { presets: [
    { id: 'deployment-default', trust: 'system', isDefault: true },
  ], modeSelectionEnabled: false, authorable: false } }
  const policy = syncPolicy({ save, reset: vi.fn(), dispose: vi.fn() }, { captureDefaultSync }, {
    getSnapshot: () => state, refresh, subscribe: () => () => {}, reset: () => {}, dispose: () => {},
  })
  const change = { field: 'default', value: 'saved-default' } as const
  save.mockResolvedValueOnce('conflict')
  expect(await policy.save(change, 4)).toBe('conflict'); expect(sync).not.toHaveBeenCalled(); expect(refresh).not.toHaveBeenCalled()
  expect(await policy.save(change, 4)).toBe('written')
  expect(captureDefaultSync.mock.invocationCallOrder[0]).toBeLessThan(save.mock.invocationCallOrder[0]!)
  expect(save).toHaveBeenLastCalledWith(change, 4)
  expect(sync).toHaveBeenCalledExactlyOnceWith('deployment-default')
  sync.mockResolvedValueOnce(false); expect(await policy.save(change, 4)).toBe('syncFailed')
  for (const next of [
    { ...state, status: 'error' as const },
    { ...state, roster: undefined },
    { ...state, roster: { ...state.roster!, presets: [] } },
  ]) { state = next; expect(await policy.save(change, 4)).toBe('syncFailed') }
  expect(sync).toHaveBeenCalledTimes(2)
})
