/** 已配置状态不能证明新密钥写入成功，引用切换和卸载使旧回执失效。 */
import { expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { RemoteError } from '@deepseek-ai/dsh-client-test-runtime'
import { createCredentialAccess } from '../src/client/credential-access.ts'
function fixture() {
  const describe = vi.fn<Context['remote']['credentials']['describe']>()
  const set = vi.fn<Context['remote']['credentials']['set']>()
  return { describe, set, access: createCredentialAccess({ describe, set }) }
}
const refusal = { ok: false as const, error: new RemoteError('gateway/internal', 'private failure', {}) }
it('写入成功后的状态复查跨越引用切换时不在新引用呈现旧成功', async () => {
  const f = fixture()
  f.describe.mockResolvedValueOnce({ ok: true, value: {} }); await f.access.refresh('A')
  let resolve!: (value: Awaited<ReturnType<typeof f.describe>>) => void
  f.describe.mockImplementationOnce(() => new Promise((done) => { resolve = done }))
  f.set.mockResolvedValueOnce({ ok: true, value: undefined })
  const writing = f.access.write('A', 'fixture-value')
  await vi.waitFor(() => { expect(f.describe).toHaveBeenCalledTimes(2) })
  f.describe.mockResolvedValueOnce({ ok: true, value: {} }); await f.access.refresh('B')
  resolve({ ok: true, value: { A: { configured: true, writable: true } } })
  await expect(writing).resolves.toBe('inactive')
  expect(f.access.getSnapshot().ref).toBe('B'); expect(f.access.getSnapshot().configured).toBe(false)
  f.access.dispose()
})
it('已有密钥但写入被拒绝不能报成功，确认写入后状态读取失败仍保留写入事实', async () => {
  const f = fixture(), observe = vi.fn(), off = f.access.subscribe(observe)
  expect(f.access.getSnapshot()).toBe(f.access.getSnapshot())
  await expect(f.access.write('KEY', 'new-test-value')).resolves.toBe('refused')
  f.describe.mockResolvedValue({ ok: true, value: { KEY: { configured: true, writable: true } } })
  await f.access.refresh('KEY')
  await expect(f.access.write('OTHER', 'new-test-value')).resolves.toBe('refused')
  f.set.mockResolvedValueOnce(refusal)
  await expect(f.access.write('KEY', 'new-test-value')).resolves.toBe('refused')
  expect(f.access.getSnapshot().configured).toBe(true)
  f.set.mockRejectedValueOnce(new Error('private network detail'))
  await expect(f.access.write('KEY', 'new-test-value')).resolves.toBe('refused')
  f.set.mockResolvedValueOnce({ ok: true, value: undefined }); f.describe.mockRejectedValueOnce(new Error('read failed'))
  await expect(f.access.write('KEY', 'new-test-value')).resolves.toBe('written')
  expect(f.set).toHaveBeenLastCalledWith('KEY', 'new-test-value')
  expect(f.access.getSnapshot()).toEqual({ ref: 'KEY', status: 'error', configured: false, writable: false, saving: false })
  expect(JSON.stringify(f.access.getSnapshot())).not.toContain('new-test-value')
  expect(observe).toHaveBeenCalled(); off(); f.access.dispose()
})
it('新引用读取与写入不受旧引用的迟到响应影响，重复保存不重复写入', async () => {
  const f = fixture()
  f.describe.mockResolvedValue({ ok: true, value: {} })
  await f.access.refresh('A')
  type Write = Awaited<ReturnType<typeof f.set>>
  let resolve!: (value: Write) => void
  f.set.mockImplementationOnce(() => new Promise((done) => { resolve = done }))
  const first = f.access.write('A', 'fixture-value')
  await expect(f.access.write('A', 'duplicate')).resolves.toBe('busy')
  await f.access.refresh('B')
  resolve({ ok: true, value: undefined }); await expect(first).resolves.toBe('inactive')
  expect(f.access.getSnapshot().ref).toBe('B')
  let reject!: (value: Error) => void
  f.set.mockImplementationOnce(() => new Promise((_done, fail) => { reject = fail }))
  const second = f.access.write('B', 'fixture-value')
  f.access.dispose(); reject(new Error('old request')); await expect(second).resolves.toBe('inactive')
  await expect(f.access.write('B', 'fixture-value')).resolves.toBe('inactive')
  const count = f.describe.mock.calls.length; await f.access.refresh('B'); expect(f.describe).toHaveBeenCalledTimes(count)
})
it('目录后发读取拥有状态，只读禁用写入，缺失引用仍交 Host 决定可写性', async () => {
  const f = fixture()
  type Read = Awaited<ReturnType<typeof f.describe>>
  let resolve!: (value: Read) => void
  f.describe.mockImplementationOnce(() => new Promise((done) => { resolve = done }))
  const old = f.access.refresh('A')
  f.describe.mockResolvedValueOnce({ ok: true, value: { B: { configured: true, writable: false } } })
  await f.access.refresh('B'); resolve({ ok: true, value: {} }); await old
  expect(f.access.getSnapshot().ref).toBe('B')
  await expect(f.access.write('B', 'fixture-value')).resolves.toBe('refused')
  f.describe.mockResolvedValueOnce(refusal); await f.access.refresh('B')
  expect(f.access.getSnapshot().status).toBe('error')
  let reject!: (value: Error) => void
  f.describe.mockImplementationOnce(() => new Promise((_done, fail) => { reject = fail }))
  const stale = f.access.refresh('B'); f.access.dispose(); reject(new Error('old failure')); await stale
})
