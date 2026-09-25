/** 选择请求捕获目标会话；用可控 Promise 验证切换、重连及卸载。 */
import { expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { RemoteError } from '@deepseek-ai/dsh-client-test-runtime'
import { createSeat, type QsPresetSeatSession } from '../src/client/seat.ts'
import type { QsPresetRosterState } from '../src/client/roster.ts'
function fixture() {
  let target: QsPresetSeatSession | undefined
  let directory: QsPresetRosterState = { status: 'ready', canOpenDirectory: false, roster: { authorable: false, modeSelectionEnabled: true, presets: [
    { id: 'standard', trust: 'system', isDefault: true }, { id: 'custom', trust: 'user', isDefault: false },
    { id: 'broken', trust: 'user', isDefault: false, broken: 'private' },
  ] } }
  const listeners = new Set<() => void>()
  const select = vi.fn<Context['remote']['agentPresets']['select']>().mockResolvedValue({ ok: true, value: 'custom' })
  const model = createSeat({
    getSnapshot: () => directory,
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    refresh: async () => {}, reset: () => {}, dispose: () => {},
  }, { select }, () => target)
  return { model, select, listeners, setTarget: (next: QsPresetSeatSession | undefined) => { target = next },
    directory: (next: Partial<QsPresetRosterState>) => {
      directory = { ...directory, ...next }; for (const listener of listeners) listener()
    },
    roster: () => directory.roster!,
  }
}
const session = (id = 'a', blank = true, preset: string | undefined = 'standard'): QsPresetSeatSession => ({ id: id as QsPresetSeatSession['id'], blank, preset })
it('无会话时暂存，空白会话出现才提交真实目标，已有会话不可切换', async () => {
  const f = fixture(), listener = vi.fn(), off = f.model.subscribe(listener)
  await f.model.update(); expect(f.model.getSnapshot().current).toBe('standard')
  await f.model.select('custom'); expect(f.select).not.toHaveBeenCalled()
  // 目录刷新可以暂时清空显示，但有效暂存选择必须在读取完成后恢复。
  f.directory({ status: 'loading' }); expect(f.model.getSnapshot().current).toBe('')
  f.directory({ status: 'ready' }); expect(f.model.getSnapshot().current).toBe('custom')
  expect(f.select).not.toHaveBeenCalled()
  f.setTarget(session()); await f.model.update()
  expect(f.select).toHaveBeenCalledExactlyOnceWith('a', 'custom')
  expect(f.model.getSnapshot()).toEqual({ current: 'custom', busy: false, failed: false })
  f.setTarget(session('b', false)); await f.model.select('custom')
  expect(f.select).toHaveBeenCalledOnce()
  f.setTarget(undefined); await f.model.select('custom'); f.setTarget(session('c', false)); await f.model.update()
  expect(f.model.getSnapshot().current).toBe('standard'); expect(f.select).toHaveBeenCalledOnce()
  f.setTarget(undefined); await f.model.select('custom'); f.setTarget(session('d', true, 'custom')); await f.model.update()
  expect(f.select).toHaveBeenCalledOnce(); expect(listener).toHaveBeenCalled()
  off(); f.model.dispose(); expect(f.listeners.size).toBe(0)
})
it('无目录、隐藏选择器、损坏或失效选择不发送，现有会话不伪造默认投影', async () => {
  const f = fixture()
  await f.model.select('unknown'); await f.model.select('broken'); expect(f.select).not.toHaveBeenCalled()
  await f.model.select('custom')
  f.directory({ roster: { ...f.roster(), modeSelectionEnabled: false } })
  await f.model.select('custom'); f.setTarget(session()); await f.model.update(); expect(f.select).not.toHaveBeenCalled()
  f.directory({ status: 'error' }); await f.model.select('custom'); expect(f.model.getSnapshot().current).toBe('standard')
  f.setTarget(undefined); f.directory({ status: 'loading' }); expect(f.model.getSnapshot().current).toBe('')
  f.directory({ status: 'ready', roster: undefined }); await f.model.select('custom'); expect(f.model.getSnapshot().current).toBe('')
  f.directory({ roster: { presets: [], authorable: false, modeSelectionEnabled: true } }); await f.model.update()
  expect(f.model.getSnapshot().current).toBe('')
  f.directory({ roster: { presets: [{ id: 'custom', trust: 'user', isDefault: true }], authorable: false, modeSelectionEnabled: true } })
  await f.model.select('custom')
  f.directory({ roster: { ...f.roster(), presets: [] } })
  f.setTarget(session()); await f.model.update(); expect(f.select).not.toHaveBeenCalled()
  f.setTarget({ id: session().id, blank: true, preset: undefined }); await f.model.update()
  expect(f.model.getSnapshot().current).toBe('')
  f.model.dispose(); f.model.reset(); await f.model.select('custom'); await f.model.update()
})
it('同一会话的拒绝和传输失败回退显示，错误原文不进入状态', async () => {
  const f = fixture(); f.setTarget(session())
  f.select.mockRejectedValueOnce(new Error('private'))
  await f.model.select('custom'); expect(f.model.getSnapshot()).toEqual({ current: 'standard', busy: false, failed: true })
  f.select.mockResolvedValueOnce({ ok: false, error: new RemoteError('gateway/invocation-unavailable', 'private', { endpoint: 'agentPresets/select' }) })
  await f.model.select('custom'); expect(f.model.getSnapshot().failed).toBe(true)
  await f.model.select('custom'); expect(f.model.getSnapshot().failed).toBe(false)
  f.model.dispose()
})
it('进行中的选择只发一次，切换会话或重连卸载使旧回执失效', async () => {
  for (const action of ['switch', 'reset', 'dispose'] as const) for (const fail of [false, true]) {
    const f = fixture(); f.setTarget(session())
    let resolve!: (value: Awaited<ReturnType<typeof f.select>>) => void, reject!: (reason: Error) => void
    f.select.mockImplementationOnce(() => new Promise((done, refuse) => { resolve = done; reject = refuse }))
    const pending = f.model.select('custom')
    await f.model.select('standard'); await f.model.update(); expect(f.select).toHaveBeenCalledOnce()
    f.setTarget(session('b', false, 'other'))
    if (action === 'reset') f.model.reset()
    if (action === 'dispose') f.model.dispose()
    if (fail) reject(new Error('private')); else resolve({ ok: true, value: 'custom' })
    await pending
    if (action !== 'dispose') expect(f.model.getSnapshot()).toEqual({ current: 'other', busy: false, failed: false })
    f.model.dispose()
  }
})

it('设置同步捕获同一空白会话，关闭选择器仍应用生效默认，跳过旧目标', async () => {
  const f = fixture()
  const none = f.model.captureDefaultSync(); f.setTarget(session()); expect(await none('custom')).toBe(true)
  const apply = f.model.captureDefaultSync()
  f.directory({ roster: { ...f.roster(), modeSelectionEnabled: false } })
  expect(await apply('custom')).toBe(true); expect(f.select).toHaveBeenCalledExactlyOnceWith('a', 'custom')
  expect(await apply('standard')).toBe(true); expect(f.select).toHaveBeenCalledOnce()
  expect(await apply('broken')).toBe(false)
  f.directory({ status: 'error' }); expect(await apply('custom')).toBe(false)
  f.directory({ status: 'ready', roster: undefined }); expect(await apply('custom')).toBe(false)
  f.setTarget(session('b')); expect(await apply('custom')).toBe(true)
  f.setTarget(session('a', false)); expect(await apply('custom')).toBe(true)
  const started = f.model.captureDefaultSync(); f.setTarget(session()); expect(await started('custom')).toBe(true)
  f.setTarget(undefined); expect(await apply('custom')).toBe(true)
  f.setTarget(session()); f.model.reset(); expect(await apply('custom')).toBe(true)
  f.model.dispose(); expect(await f.model.captureDefaultSync()('custom')).toBe(true)
})
it('已有选择在途时拒绝设置同步，失败结果单独返回', async () => {
  const f = fixture(); f.setTarget(session())
  const sync = f.model.captureDefaultSync()
  let resolve!: (value: Awaited<ReturnType<typeof f.select>>) => void
  f.select.mockImplementationOnce(() => new Promise((done) => { resolve = done }))
  const pending = f.model.select('custom')
  expect(await sync('custom')).toBe(false)
  resolve({ ok: true, value: 'custom' }); await pending
  f.select.mockRejectedValueOnce(new Error('private'))
  expect(await sync('custom')).toBe(false)
  f.model.dispose()
})

// 目录和连接恢复不能替代确认预设；旧请求结果不解除新连接的发送保护。
it('重置后的准备中断跨目录刷新保留，明确重试成功才清除', async () => {
  const f = fixture(); f.setTarget(session())
  const reply = Promise.withResolvers<Awaited<ReturnType<typeof f.select>>>()
  f.select.mockReturnValueOnce(reply.promise)
  const pending = f.model.select('custom')
  f.model.reset()
  expect(f.model.preparation.getSnapshot()).toEqual({ sessionId: 'a', pending: false })
  f.directory({ status: 'loading' }); f.directory({ status: 'ready' })
  expect(f.model.preparation.getSnapshot()?.pending).toBe(false)
  reply.resolve({ ok: true, value: 'custom' }); await pending
  expect(f.model.preparation.getSnapshot()?.pending).toBe(false)
  await f.model.select('custom')
  expect(f.model.preparation.getSnapshot()).toBeUndefined()
  f.model.dispose()
})
