/** 配置和凭据两个事务的部分结果，不能靠已配置徽标或单个成功推断全部保存。 */
import { expect, it, vi } from 'vitest'
import type { SettingsPathOpView } from '@deepseek-ai/dsh-api-remotes/client'
import type { CardWriter, SaveOutcome } from '../src/client/save.ts'
import type { CredentialAccess } from '../src/client/credential-access.ts'
import { createSearchSaver } from '../src/client/search-save.ts'
const ops: SettingsPathOpView[] = [{ op: 'set', path: ['maxUses'], value: 4 }]
const written: SaveOutcome = { kind: 'written', view: { ns: 'web-search-deepseek', schema: {}, value: { maxUses: 4 }, revision: 3, applies: 'live', secrets: [] } }
function fixture() {
  const save = vi.fn<CardWriter['save']>().mockResolvedValue(written), dispose = vi.fn()
  const write = vi.fn<CredentialAccess['write']>().mockResolvedValue('written')
  let ref = 'KEY'
  const saver = createSearchSaver({ save, dispose }, { write }, () => ref)
  return { saver, save, dispose, write, setRef: (next: string) => { ref = next } }
}
it('原子配置确认后才写密钥，凭据失败保持配置成功，重试只提交剩余草稿', async () => {
  const f = fixture(); f.write.mockResolvedValueOnce('refused')
  const request = { ops, revision: 2, credential: { ref: 'KEY', value: 'fixture-secret' } }
  await expect(f.saver.save(request)).resolves.toEqual({ configuration: 'written', credential: 'refused' })
  expect(f.save).toHaveBeenCalledWith(ops, 2); expect(f.write).toHaveBeenCalledWith('KEY', 'fixture-secret')
  expect(f.save.mock.invocationCallOrder[0]).toBeLessThan(f.write.mock.invocationCallOrder[0]!)
  await expect(f.saver.save({ ...request, ops: [] })).resolves.toEqual({ configuration: 'unchanged', credential: 'written' })
  expect(f.save).toHaveBeenCalledOnce(); expect(f.write).toHaveBeenCalledTimes(2)
  f.saver.dispose()
})
it('配置冲突不写凭据，无凭据草稿不触发凭据接口，引用改变禁止错写', async () => {
  const f = fixture()
  f.save.mockResolvedValueOnce({ kind: 'conflict' })
  await expect(f.saver.save({ ops, revision: 2, credential: { ref: 'KEY', value: 'fixture-secret' } }))
    .resolves.toEqual({ configuration: 'conflict', credential: 'not-attempted' })
  expect(f.write).not.toHaveBeenCalled()
  f.save.mockResolvedValueOnce({ kind: 'refused' })
  await expect(f.saver.save({ ops, revision: 2 })).resolves.toEqual({ configuration: 'refused', credential: 'unchanged' })
  await expect(f.saver.save({ ops, revision: 2 })).resolves.toEqual({ configuration: 'written', credential: 'unchanged' })
  f.setRef('OTHER')
  await expect(f.saver.save({ ops: [], revision: 2, credential: { ref: 'KEY', value: 'fixture-secret' } }))
    .resolves.toEqual({ configuration: 'unchanged', credential: 'reference-changed' })
  expect(f.write).not.toHaveBeenCalled(); f.saver.dispose()
})
it('重复保存不发送，调用方修改不改变在途草稿，释放后不继续写入凭据', async () => {
  const f = fixture(); let resolve!: (value: SaveOutcome) => void
  f.save.mockImplementationOnce(() => new Promise((done) => { resolve = done }))
  const credential = { ref: 'KEY', value: 'fixture-secret' }
  const first = f.saver.save({ ops, revision: 2, credential })
  credential.ref = 'CHANGED'
  await expect(f.saver.save({ ops, revision: 2 })).resolves.toEqual({ configuration: 'busy', credential: 'not-attempted' })
  resolve(written); await first; expect(f.write).toHaveBeenCalledWith('KEY', 'fixture-secret')
  f.save.mockImplementationOnce(() => new Promise((done) => { resolve = done }))
  const second = f.saver.save({ ops, revision: 2, credential })
  f.saver.dispose(); resolve(written)
  await expect(second).resolves.toEqual({ configuration: 'written', credential: 'not-attempted' })
  await expect(f.saver.save({ ops, revision: 2 })).resolves.toEqual({ configuration: 'inactive', credential: 'not-attempted' })
  expect(f.write).toHaveBeenCalledOnce(); expect(f.dispose).toHaveBeenCalledOnce()
})
it('凭据写入期间释放只忽略 UI 回执，不声称回滚已发送的 Host 写入', async () => {
  const f = fixture(); let resolve!: (value: Awaited<ReturnType<CredentialAccess['write']>>) => void
  f.write.mockImplementationOnce(() => new Promise((done) => { resolve = done }))
  const saving = f.saver.save({ ops: [], revision: 2, credential: { ref: 'KEY', value: 'fixture-secret' } })
  f.saver.dispose(); resolve('written')
  await expect(saving).resolves.toEqual({ configuration: 'unchanged', credential: 'inactive' })
})
