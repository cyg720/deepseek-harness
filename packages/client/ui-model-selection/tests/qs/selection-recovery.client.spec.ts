/** 模型 RPC 拒绝必须释放选择锁，旧会话代次不能覆盖当前状态。 */
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId, ModelCatalog } from '@deepseek-ai/dsh-api-remotes/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { expect, it, vi } from 'vitest'
import { ModelDirectory } from '../../src/client/directory.ts'
import { ModelCatalogDirectory } from '../../src/client/catalog.ts'

const value: ModelCatalog = { default: { provider: 'fixture', model: 'old' }, routableProviders: ['fixture'],
  groups: [{ id: 'fixture', name: 'Fixture', models: [{ id: 'old', name: 'Old' }, { id: 'new', name: 'New' }] }], failures: [] }
async function bench() {
  // 目录只消费 modelCatalog；测试保留真实目录与快照，替换远程传输。
  const context = { remote: { session: { modelCatalog: async () => ({ ok: true, value }) } } }
  const catalog = new ModelCatalogDirectory(context as unknown as Context)
  const projected = createSnapshotStore({ next: { provider: 'fixture', model: 'old' } })
  const selectModel = vi.fn<ConstructorParameters<typeof ModelDirectory>[0]['selectModel']>()
  const directory = new ModelDirectory({ selectModel }, 'selection-recovery' as SessionId, () => true, catalog, projected)
  await directory.load()
  return { directory, projected, selectModel }
}

it.each([new Error('transport unavailable'), 'transport unavailable'])('拒绝后保留权威选择并允许重试：%s', async (error) => {
  const b = await bench()
  try {
    b.selectModel.mockRejectedValueOnce(error)
    await expect(b.directory.select({ provider: 'fixture', model: 'new' })).rejects.toBe(error)
    expect(b.directory.store.getSnapshot()).toMatchObject({ status: 'error', error: 'transport unavailable', current: value.default })
    b.selectModel.mockImplementationOnce(async () => {
      b.projected.set({ next: { provider: 'fixture', model: 'new' } })
      return { ok: true, value: { selected: { provider: 'fixture', model: 'new' } } }
    })
    await b.directory.select({ provider: 'fixture', model: 'new' })
    expect(b.directory.store.getSnapshot()).toMatchObject({ status: 'ready', error: null, current: { provider: 'fixture', model: 'new' } })
  } finally { b.directory.dispose() }
})

it.each(['reset', 'dispose', 'newer'] as const)('迟到拒绝不污染 %s 后的目录', async (mode) => {
  const b = await bench(), late = Promise.withResolvers<never>()
  try {
    b.selectModel.mockReturnValueOnce(late.promise)
    const pending = b.directory.select({ provider: 'fixture', model: 'new' })
    const rejected = expect(pending).rejects.toThrow('late transport')
    if (mode === 'reset') b.directory.resetConnected()
    else if (mode === 'dispose') b.directory.dispose()
    else {
      b.selectModel.mockResolvedValueOnce({ ok: true, value: { selected: value.default } })
      await b.directory.select(value.default)
    }
    const snapshot = b.directory.store.getSnapshot()
    late.reject(new Error('late transport')); await rejected
    expect(b.directory.store.getSnapshot()).toBe(snapshot)
  } finally { b.directory.dispose() }
})
