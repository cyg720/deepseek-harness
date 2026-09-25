/** 目录刷新、能力失败和生命周期竞态均使用可控 Promise，不依赖等待时间。 */
import { expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { AgentPresetRoster } from '@deepseek-ai/dsh-agent-presets/types'
import { RemoteError } from '@deepseek-ai/dsh-client-test-runtime'
import { createRoster } from '../src/client/roster.ts'
const roster: AgentPresetRoster = { presets: [
  { id: 'standard', trust: 'system', isDefault: true },
  { id: 'broken-user', trust: 'user', isDefault: false, broken: 'private host diagnostic' },
], authorable: true, modeSelectionEnabled: false }
function fixture() {
  const list = vi.fn<Context['remote']['agentPresets']['list']>().mockResolvedValue({ ok: true, value: roster })
  const canOpenAgentPresetDirectory = vi.fn<Context['remote']['settings']['canOpenAgentPresetDirectory']>().mockResolvedValue({ ok: true, value: true })
  return { list, canOpenAgentPresetDirectory, model: createRoster({ list }, { canOpenAgentPresetDirectory }) }
}
it('保留真实默认和损坏条目，目录开启能力单独派生', async () => {
  const f = fixture(), listener = vi.fn(), off = f.model.subscribe(listener)
  try {
    expect(f.model.getSnapshot().status).toBe('idle')
    await f.model.refresh()
    expect(f.model.getSnapshot()).toEqual({ status: 'ready', roster, canOpenDirectory: true })
    expect(listener).toHaveBeenCalledTimes(2)
    f.canOpenAgentPresetDirectory.mockRejectedValueOnce(new Error('desktop private'))
    await f.model.refresh(); expect(f.model.getSnapshot()).toEqual({ status: 'ready', roster, canOpenDirectory: false })
    f.canOpenAgentPresetDirectory.mockResolvedValueOnce({ ok: false, error: new RemoteError('gateway/invocation-unavailable', 'private', { endpoint: 'settings/canOpenAgentPresetDirectory' }) })
    await f.model.refresh(); expect(f.model.getSnapshot().canOpenDirectory).toBe(false)
    off(); listener.mockClear(); f.model.reset()
    expect(listener).not.toHaveBeenCalled(); expect(f.model.getSnapshot().roster).toBeUndefined()
  } finally { f.model.dispose() }
})
it('空目录和未提供能力分别于读取失败，不泄露错误载荷', async () => {
  const f = fixture()
  try {
    f.list.mockResolvedValueOnce({ ok: true, value: { presets: [], authorable: false, modeSelectionEnabled: false } })
    await f.model.refresh(); expect(f.model.getSnapshot().status).toBe('unavailable')
    f.list.mockResolvedValueOnce({ ok: false, error: new RemoteError('gateway/invocation-unavailable', 'private', { endpoint: 'agentPresets/list' }) })
    await f.model.refresh(); expect(f.model.getSnapshot().status).toBe('unavailable')
    f.list.mockResolvedValueOnce({ ok: false, error: new RemoteError('agent-preset/invalid', 'private', { agentPreset: 'x', reason: 'private' }) })
    await f.model.refresh(); expect(f.model.getSnapshot().status).toBe('error')
    f.list.mockRejectedValueOnce(new Error('private'))
    await f.model.refresh(); expect(f.model.getSnapshot().status).toBe('error')
    expect(JSON.stringify(f.model.getSnapshot())).not.toContain('private')
    await f.model.refresh(); expect(f.model.getSnapshot().status).toBe('ready')
  } finally { f.model.dispose() }
})
it('后发目录胜出，重连及卸载废弃旧结果且卸载后不再请求', async () => {
  const f = fixture()
  let finish!: (value: Awaited<ReturnType<typeof f.list>>) => void
  f.list.mockImplementationOnce(() => new Promise((done) => { finish = done }))
  const first = f.model.refresh()
  await f.model.refresh()
  finish({ ok: true, value: { ...roster, presets: [] } }); await first
  expect(f.model.getSnapshot().roster).toBe(roster)
  f.list.mockImplementationOnce(() => new Promise((done) => { finish = done }))
  const oldConnection = f.model.refresh(); f.model.reset()
  finish({ ok: true, value: roster }); await oldConnection
  expect(f.model.getSnapshot().status).toBe('idle')
  f.list.mockImplementationOnce(() => new Promise((done) => { finish = done }))
  const released = f.model.refresh(); f.model.dispose()
  const snapshot = f.model.getSnapshot()
  finish({ ok: true, value: roster }); await released
  await f.model.refresh(); f.model.reset()
  expect(f.model.getSnapshot()).toBe(snapshot)
  expect(f.list).toHaveBeenCalledTimes(4)
})
