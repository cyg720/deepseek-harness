/** 写入回执、编辑版本和生命周期拥有权的可控异步回归。 */
import { expect, it, vi } from 'vitest'
import { RemoteError } from '@deepseek-ai/dsh-client-test-runtime'
import type { Context } from '@deepseek-ai/cordis'
import type { SettingsNamespaceView, SettingsPathOpView } from '@deepseek-ai/dsh-api-remotes/client'
import type { SettingsMirrorSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import { createCardWriter } from '../src/client/save.ts'
type Result = Awaited<ReturnType<Context['remote']['settings']['mutate']>>
const view = (revision: number): SettingsNamespaceView => ({ ns: 'shell', schema: {}, value: { timeoutMs: 100 }, revision, applies: 'live', secrets: [] })
function fixture() {
  let state: SettingsMirrorSnapshot = { status: 'ready', error: null, view: { namespaces: [view(2)], writable: true, hasDocument: true } }
  const mutate = vi.fn<Context['remote']['settings']['mutate']>()
  const acceptView = vi.fn()
  const writer = createCardWriter('shell', { mutate }, { getSnapshot: () => state, acceptView })
  return { writer, mutate, acceptView, state: (next: SettingsMirrorSnapshot) => { state = next } }
}
it('固定编辑版本、原子载荷与单次提交，迟到成功不能回滚较新镜像', async () => {
  const f = fixture(); let resolve!: (value: Result) => void
  f.mutate.mockImplementationOnce(() => new Promise((done) => { resolve = done }))
  const ops: SettingsPathOpView[] = [{ op: 'set', path: ['timeoutMs'], value: 100 }, { op: 'unset', path: ['maxOutputBytes'] }]
  const saving = f.writer.save(ops, 1)
  ops[0]!.path[0] = 'changed'
  expect(f.mutate).toHaveBeenCalledWith('shell', [{ op: 'set', path: ['timeoutMs'], value: 100 }, { op: 'unset', path: ['maxOutputBytes'] }], 1)
  await expect(f.writer.save([], 1)).resolves.toEqual({ kind: 'busy' })
  f.state({ status: 'ready', error: null, view: { namespaces: [view(9)], writable: true, hasDocument: true } })
  resolve({ ok: true, value: view(3) }); await expect(saving).resolves.toEqual({ kind: 'written', view: view(3) })
  expect(f.acceptView).not.toHaveBeenCalled()
  f.mutate.mockResolvedValue({ ok: true, value: view(10) })
  await f.writer.save([], 9); expect(f.acceptView).toHaveBeenCalledWith(view(10))
})
it('冲突、拒绝与网络错误均不是成功，未服务和只读状态不写入', async () => {
  const f = fixture()
  f.mutate.mockResolvedValueOnce({ ok: false, error: new RemoteError('settings/conflict', 'secret', { ns: 'shell', expected: 2, actual: 3 }) })
  await expect(f.writer.save([], 2)).resolves.toEqual({ kind: 'conflict' })
  f.mutate.mockResolvedValueOnce({ ok: false, error: new RemoteError('settings/rejected', 'secret', { ns: 'shell' }) })
  await expect(f.writer.save([], 2)).resolves.toEqual({ kind: 'refused' })
  f.mutate.mockRejectedValueOnce(new Error('transport secret'))
  await expect(f.writer.save([], 2)).resolves.toEqual({ kind: 'refused' })
  expect(f.acceptView).not.toHaveBeenCalled()
  for (const state of [
    { status: 'loading', error: null, view: undefined },
    { status: 'ready', error: null, view: undefined },
    { status: 'ready', error: null, view: { namespaces: [view(2)], writable: false, hasDocument: true } },
    { status: 'ready', error: null, view: { namespaces: [], writable: true, hasDocument: true } },
  ] as SettingsMirrorSnapshot[]) {
    f.state(state); await expect(f.writer.save([], 2)).resolves.toEqual({ kind: 'refused' })
  }
  expect(f.mutate).toHaveBeenCalledTimes(3)
})
it('卸载后的成功及失败不再更新镜像，后续保存不发送', async () => {
  for (const fail of [false, true]) {
    const f = fixture(); let resolve!: (value: Result) => void, reject!: (error: Error) => void
    f.mutate.mockImplementationOnce(() => new Promise((done, error) => { resolve = done; reject = error }))
    const pending = f.writer.save([], 2); f.writer.dispose()
    if (fail) reject(new Error('late')); else resolve({ ok: true, value: view(3) })
    await expect(pending).resolves.toEqual({ kind: 'inactive' })
    await expect(f.writer.save([], 2)).resolves.toEqual({ kind: 'inactive' })
    expect(f.acceptView).not.toHaveBeenCalled(); expect(f.mutate).toHaveBeenCalledOnce()
  }
})
it('成功回执到达时镜像尚无命名空间则交给官方接受器处理', async () => {
  const f = fixture(); let resolve!: (value: Result) => void
  f.mutate.mockImplementationOnce(() => new Promise((done) => { resolve = done }))
  const pending = f.writer.save([], 2)
  f.state({ status: 'loading', error: null, view: undefined })
  resolve({ ok: true, value: view(3) }); await pending
  expect(f.acceptView).toHaveBeenCalledWith(view(3))
})
