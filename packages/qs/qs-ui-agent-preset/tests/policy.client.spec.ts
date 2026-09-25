/** 可控 RPC 验证真实字段、CAS 版本和重连回执隔离，不使用定时等待。 */
import { expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { SettingsNamespaceView } from '@deepseek-ai/dsh-api-remotes/client'
import type { SettingsMirrorSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import { RemoteError } from '@deepseek-ai/dsh-client-test-runtime'
import { createPolicy } from '../src/client/policy.ts'

const view = (revision: number): SettingsNamespaceView => ({ ns: 'agent-presets', revision, schema: {}, value: { default: 'standard', modeSelectionEnabled: true }, applies: 'live', secrets: [] })
function fixture() {
  let state: SettingsMirrorSnapshot = { status: 'ready', error: null, view: { namespaces: [view(2)], writable: true, hasDocument: true } }
  const mutate = vi.fn<Context['remote']['settings']['mutate']>().mockResolvedValue({ ok: true, value: view(3) })
  const acceptView = vi.fn()
  const policy = createPolicy({ getSnapshot: () => state, subscribe: () => () => {}, ensure: async () => {}, acceptView }, { mutate })
  return { policy, mutate, acceptView, set: (next: SettingsMirrorSnapshot) => { state = next } }
}
it('默认值和选择器开关分别写入精确字段及用户版本', async () => {
  const f = fixture()
  expect(await f.policy.save({ field: 'default', value: 'custom' }, 2)).toBe('written')
  expect(f.mutate).toHaveBeenLastCalledWith('agent-presets', [{ op: 'set', path: ['default'], value: 'custom' }], 2)
  expect(await f.policy.save({ field: 'modeSelectionEnabled', value: false }, 2)).toBe('written')
  expect(f.mutate).toHaveBeenLastCalledWith('agent-presets', [{ op: 'set', path: ['modeSelectionEnabled'], value: false }], 2)
  expect(f.acceptView).toHaveBeenCalledWith(view(3))
  f.policy.dispose()
})
it('只读、缺失描述和版本冲突不发送写入，远端错误不暴露原文', async () => {
  const f = fixture(), change = { field: 'default', value: 'standard' } as const
  expect(await f.policy.save(change, 1)).toBe('conflict')
  for (const state of [
    { status: 'loading', error: null, view: undefined },
    { status: 'ready', error: 'private', view: undefined },
    { status: 'ready', error: null, view: undefined },
    { status: 'ready', error: null, view: { namespaces: [], writable: false, hasDocument: true } },
    { status: 'ready', error: null, view: { namespaces: [], writable: true, hasDocument: true } },
  ] satisfies SettingsMirrorSnapshot[]) {
    f.set(state); expect(await f.policy.save(change, 2)).toBe('refused')
  }
  expect(f.mutate).not.toHaveBeenCalled()
  f.set({ status: 'ready', error: null, view: { namespaces: [view(2)], writable: true, hasDocument: true } })
  for (const error of [new RemoteError('settings/conflict', 'private', { ns: 'agent-presets', expected: 2, actual: 3 }), new RemoteError('settings/rejected', 'private', { ns: 'agent-presets' })]) {
    f.mutate.mockResolvedValueOnce({ ok: false, error })
    expect(await f.policy.save(change, 2)).toBe(error.code === 'settings/conflict' ? 'conflict' : 'refused')
  }
  f.mutate.mockRejectedValueOnce(new Error('private'))
  expect(await f.policy.save(change, 2)).toBe('refused')
  expect(await f.policy.save(change, 2)).toBe('written')
  f.policy.dispose()
  expect(await f.policy.save(change, 2)).toBe('inactive')
})
it('重连允许新写入，旧成功和旧失败均不覆盖新操作', async () => {
  const f = fixture(), change = { field: 'default', value: 'standard' } as const
  for (const fail of [false, true]) {
    let finish!: (value: Awaited<ReturnType<typeof f.mutate>>) => void
    let reject!: (error: Error) => void
    f.mutate.mockImplementationOnce(() => new Promise((resolve, refuse) => { finish = resolve; reject = refuse }))
    const pending = f.policy.save(change, 2)
    expect(await f.policy.save(change, 2)).toBe('busy')
    f.policy.reset()
    expect(await f.policy.save(change, 2)).toBe('written')
    f.acceptView.mockClear()
    if (fail) reject(new Error('private')); else finish({ ok: true, value: view(3) })
    expect(await pending).toBe('inactive')
    expect(f.acceptView).not.toHaveBeenCalled()
  }
  f.policy.dispose()
})
it('卸载隔离回执，推送较新版本时保持镜像，镜像清空时接受有效回执', async () => {
  const change = { field: 'modeSelectionEnabled', value: false } as const
  for (const mode of ['dispose', 'newer', 'empty', 'missing', 'equal', 'reject'] as const) {
    const f = fixture()
    let finish!: (value: Awaited<ReturnType<typeof f.mutate>>) => void
    let reject!: (error: Error) => void
    f.mutate.mockImplementationOnce(() => new Promise((resolve, refuse) => { finish = resolve; reject = refuse }))
    const pending = f.policy.save(change, 2)
    if (mode === 'dispose' || mode === 'reject') f.policy.dispose()
    else if (mode === 'empty') f.set({ status: 'loading', error: null, view: undefined })
    else f.set({ status: 'ready', error: null, view: { namespaces: mode === 'missing' ? [] : [view(mode === 'equal' ? 3 : 9)], writable: true, hasDocument: true } })
    if (mode === 'reject') reject(new Error('private')); else finish({ ok: true, value: view(3) })
    expect(await pending).toBe(mode === 'dispose' || mode === 'reject' ? 'inactive' : 'written')
    expect(f.acceptView).toHaveBeenCalledTimes(['empty', 'missing', 'equal'].includes(mode) ? 1 : 0)
    f.policy.dispose()
  }
})
