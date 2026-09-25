/** 保存回执分别描述配置与凭据，迟到响应不能触发已卸载编辑器的后续写入。 */
import { expect, it, vi } from 'vitest'
import type { SettingsNamespaceView, SettingsPathOpView } from '@deepseek-ai/dsh-api-remotes/client'
import type { ModelsOperations } from '@deepseek-ai/dsh-client-ui-settings-models/client'
import { createProviderWriter } from '../src/client/provider-save.ts'

const view: SettingsNamespaceView = { ns: 'fixture', schema: {}, value: { apiKeyEnv: 'KEY' }, user: { apiKeyEnv: 'KEY' }, revision: 3, applies: 'live', secrets: [] }
const ops: SettingsPathOpView[] = [{ op: 'set', path: ['apiKeyEnv'], value: 'KEY' }]
const credential = { ref: 'KEY', value: 'fixture-secret' }
function fixture() {
  const writeSettings = vi.fn<ModelsOperations['writeSettings']>().mockResolvedValue({ kind: 'written', view })
  const storeCredential = vi.fn<ModelsOperations['storeCredential']>().mockResolvedValue(undefined)
  const operations: ModelsOperations = { writeSettings, storeCredential,
    describeCredential: vi.fn(), removeCredential: vi.fn(), discoverModels: vi.fn() }
  let ref: string | undefined = 'KEY', writable = true
  const accept = vi.fn<(next: SettingsNamespaceView) => void>()
  const writer = createProviderWriter('fixture', operations, { accept, writable: () => writable, credentialRef: () => ref })
  return { writer, writeSettings, storeCredential, accept, setRef: (value: string | undefined) => { ref = value },
    setWritable: (value: boolean) => { writable = value } }
}

it('先确认配置版本再写凭据，部分失败后只重试凭据', async () => {
  const f = fixture()
  f.storeCredential.mockImplementationOnce(async () => {
    expect(f.accept).toHaveBeenCalledWith(view)
    return 'private credential failure'
  })
  await expect(f.writer.save({ ops, revision: 2, credential })).resolves.toEqual({ configuration: 'written', credential: 'refused' })
  expect(f.writeSettings).toHaveBeenCalledWith('fixture', ops, 2)
  expect(f.storeCredential).toHaveBeenCalledWith('KEY', 'fixture-secret')
  await expect(f.writer.save({ ops: [], revision: view.revision, credential })).resolves.toEqual({ configuration: 'unchanged', credential: 'written' })
  expect(f.writeSettings).toHaveBeenCalledOnce()
  expect(f.storeCredential).toHaveBeenCalledTimes(2)
})

it.each(['conflict', 'refused'] as const)('配置 %s 不采纳新版本、不写密钥且允许重试', async (kind) => {
  const f = fixture()
  f.writeSettings.mockResolvedValueOnce({ kind, message: 'private failure' })
  await expect(f.writer.save({ ops, revision: 2, credential })).resolves.toEqual({ configuration: kind, credential: 'not-attempted' })
  expect(f.accept).not.toHaveBeenCalled(); expect(f.storeCredential).not.toHaveBeenCalled()
  await expect(f.writer.save({ ops, revision: 2 })).resolves.toEqual({ configuration: 'written', credential: 'unchanged' })
})

it('只读拒绝配置写入，但不禁止独立凭据引导；引用变化不写旧目标', async () => {
  const f = fixture(); f.setWritable(false)
  await expect(f.writer.save({ ops, revision: 2, credential })).resolves.toEqual({ configuration: 'refused', credential: 'not-attempted' })
  expect(f.writeSettings).not.toHaveBeenCalled()
  await expect(f.writer.save({ ops: [], revision: 2, credential })).resolves.toEqual({ configuration: 'unchanged', credential: 'written' })
  f.setRef(undefined)
  await expect(f.writer.save({ ops: [], revision: 2, credential })).resolves.toEqual({ configuration: 'unchanged', credential: 'reference-changed' })
  expect(f.storeCredential).toHaveBeenCalledOnce()
})

it('单个在途保存保持调用时的草稿，重复提交不再发送 RPC', async () => {
  const f = fixture(), gate = Promise.withResolvers<Awaited<ReturnType<ModelsOperations['writeSettings']>>>()
  f.writeSettings.mockReturnValueOnce(gate.promise)
  const draft = { ops: structuredClone(ops), revision: 2, credential: { ...credential } }
  const pending = f.writer.save(draft)
  draft.ops.push({ op: 'set', path: ['unrelated'], value: true }); draft.credential.value = 'changed'
  await expect(f.writer.save(draft)).resolves.toEqual({ configuration: 'busy', credential: 'not-attempted' })
  expect(f.writeSettings).toHaveBeenCalledExactlyOnceWith('fixture', ops, 2)
  gate.resolve({ kind: 'written', view }); await pending
  expect(f.storeCredential).toHaveBeenCalledExactlyOnceWith('KEY', 'fixture-secret')
})

it.each([false, true])('配置在途卸载，晚到的拒绝=%s 不采纳视图、不写密钥', async (reject) => {
  const f = fixture(), gate = Promise.withResolvers<Awaited<ReturnType<ModelsOperations['writeSettings']>>>()
  f.writeSettings.mockReturnValueOnce(gate.promise)
  const pending = f.writer.save({ ops, revision: 2, credential }); f.writer.dispose()
  if (reject) gate.reject(new Error('private failure')); else gate.resolve({ kind: 'written', view })
  await expect(pending).resolves.toEqual({ configuration: 'inactive', credential: 'not-attempted' })
  expect(f.accept).not.toHaveBeenCalled(); expect(f.storeCredential).not.toHaveBeenCalled()
  await expect(f.writer.save({ ops, revision: 2 })).resolves.toEqual({ configuration: 'inactive', credential: 'not-attempted' })
})

it('配置确认引发卸载或有效引用改变时，不继续写原凭据', async () => {
  const f = fixture()
  f.accept.mockImplementationOnce(() => { f.setRef('OTHER') })
  await expect(f.writer.save({ ops, revision: 2, credential })).resolves.toEqual({ configuration: 'written', credential: 'reference-changed' })
  f.accept.mockImplementationOnce(() => { f.writer.dispose() })
  await expect(f.writer.save({ ops, revision: 3, credential })).resolves.toEqual({ configuration: 'written', credential: 'inactive' })
  expect(f.storeCredential).not.toHaveBeenCalled()
})

it('传输异常不暴露诊断，后续保存可恢复', async () => {
  const f = fixture()
  f.writeSettings.mockRejectedValueOnce(new Error('private failure'))
  await expect(f.writer.save({ ops, revision: 2, credential })).resolves.toEqual({ configuration: 'refused', credential: 'not-attempted' })
  f.storeCredential.mockRejectedValueOnce(new Error('private secret'))
  await expect(f.writer.save({ ops, revision: 2, credential })).resolves.toEqual({ configuration: 'written', credential: 'refused' })
  await expect(f.writer.save({ ops: [], revision: 3 })).resolves.toEqual({ configuration: 'unchanged', credential: 'unchanged' })
})

it.each([false, true])('凭据在途卸载，晚到的拒绝=%s 不能报告 UI 保存成功', async (reject) => {
  const f = fixture(), gate = Promise.withResolvers<string | undefined>()
  f.storeCredential.mockReturnValueOnce(gate.promise)
  const pending = f.writer.save({ ops: [], revision: 2, credential }); f.writer.dispose()
  if (reject) gate.reject(new Error('private failure')); else gate.resolve(undefined)
  await expect(pending).resolves.toEqual({ configuration: 'unchanged', credential: 'inactive' })
  expect(f.storeCredential).toHaveBeenCalledOnce()
})
