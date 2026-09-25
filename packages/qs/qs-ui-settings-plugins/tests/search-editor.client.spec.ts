/** WebSearch 部分保存只清理成功字段；凭据引用固定，重连清除密钥草稿。 */
import { expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import { createCredentialAccess } from '../src/client/credential-access.ts'
import { createSearchEditor, searchCredentialRef, type SearchPreference } from '../src/client/search-editor.ts'
import type { SearchSaver, SearchSaveResult } from '../src/client/search-save.ts'

function fixture() {
  let snapshot: SettingsScopeSnapshot<SearchPreference> = {
    status: 'ready', writable: true, mode: 'host', revision: 2,
    value: { baseURL: 'https://example.test', maxUses: 5 }, base: { maxUses: 3 }, user: { maxUses: 5 },
  }
  const listeners = new Set<() => void>()
  const scope = { getSnapshot: () => snapshot, subscribe: (listener: () => void) => {
    listeners.add(listener); return () => { listeners.delete(listener) }
  } }
  const save = vi.fn<SearchSaver['save']>().mockResolvedValue({ configuration: 'written', credential: 'refused' }), dispose = vi.fn()
  const describe = vi.fn<Context['remote']['credentials']['describe']>().mockResolvedValue({ ok: true, value: {} })
  const editor = createSearchEditor(scope, () => ({
    credentials: createCredentialAccess({ describe, set: vi.fn() }), saver: { save, dispose },
  }), (_field, value) => typeof value === 'string' || value > 0)
  return { editor, save, describe, dispose, listeners, update: (next: Partial<typeof snapshot>) => {
    snapshot = { ...snapshot, ...next }; for (const listener of listeners) listener()
  } }
}
it('部分成功保留密钥，重试不重复配置，成功后清除明文', async () => {
  const f = fixture(), observe = vi.fn(), off = f.editor.subscribe(observe)
  await vi.waitFor(() => { expect(f.editor.getSnapshot().credential.status).toBe('ready') })
  f.editor.edit('maxUses', '9'); f.editor.editSecret('fixture-secret')
  await f.editor.save()
  expect(f.save).toHaveBeenLastCalledWith({ ops: [{ op: 'set', path: ['maxUses'], value: 9 }], revision: 2,
    credential: { ref: 'DEEPSEEK_API_KEY', value: 'fixture-secret' } })
  expect(f.editor.getSnapshot().secret).toBe('fixture-secret')
  f.update({ revision: 3, value: { maxUses: 9 } })
  f.save.mockResolvedValueOnce({ configuration: 'unchanged', credential: 'written' })
  await f.editor.save()
  expect(f.save).toHaveBeenLastCalledWith({ ops: [], revision: 3, credential: { ref: 'DEEPSEEK_API_KEY', value: 'fixture-secret' } })
  expect(f.editor.getSnapshot().secret).toBe(''); expect(f.editor.getSnapshot().dirty).toBe(false)
  expect(observe).toHaveBeenCalled(); off(); f.editor.dispose()
})
it('校验、继承复位、版本冲突和引用变化不静默修改草稿', async () => {
  const f = fixture(); await vi.waitFor(() => { expect(f.editor.getSnapshot().credential.status).toBe('ready') })
  for (const text of ['NaN', '-1']) {
    f.editor.edit('maxUses', text); await f.editor.save(); expect(f.editor.getSnapshot().invalid).toBe(true)
  }
  expect(f.save).not.toHaveBeenCalled()
  f.editor.resetField('maxUses'); expect(f.editor.getSnapshot().fields.maxUses.text).toBe('3')
  await f.editor.save(); expect(f.save).toHaveBeenLastCalledWith({ ops: [{ op: 'unset', path: ['maxUses'] }], revision: 2 })
  f.editor.edit('baseURL', ' https://new.test '); f.update({ revision: 4 })
  expect(f.editor.getSnapshot().conflicted).toBe(true); await f.editor.save(); expect(f.save).toHaveBeenCalledOnce()
  f.editor.discard(); f.editor.editSecret('fixture-secret')
  f.update({ value: { apiKeyEnv: 'OTHER' } })
  expect(f.editor.getSnapshot().referenceChanged).toBe(true); await f.editor.save(); expect(f.save).toHaveBeenCalledOnce()
  f.editor.discard(); expect(f.editor.getSnapshot().secret).toBe('')
  f.editor.dispose(); expect(f.listeners.size).toBe(0)
  expect(searchCredentialRef({ apiKeyEnv: '' })).toBe('DEEPSEEK_API_KEY')
})
it('保存期间不接受编辑，重连清除旧明文并忽略旧回执', async () => {
  const f = fixture(); await vi.waitFor(() => { expect(f.editor.getSnapshot().credential.status).toBe('ready') })
  f.editor.editSecret('fixture-secret'); f.editor.edit('baseURL', 'https://next.test')
  let resolve!: (result: SearchSaveResult) => void
  f.save.mockImplementationOnce(() => new Promise((done) => { resolve = done }))
  const pending = f.editor.save()
  f.editor.editSecret('should-not-replace'); f.editor.edit('maxUses', '10'); f.editor.discard(); await f.editor.save()
  expect(f.save).toHaveBeenCalledOnce()
  f.editor.clearSecret(); expect(f.editor.getSnapshot().secret).toBe('')
  f.editor.reset(); expect(f.editor.getSnapshot().secret).toBe('')
  resolve({ configuration: 'written', credential: 'written' }); await pending
  expect(f.editor.getSnapshot().outcome).toBeUndefined()
  f.update({ writable: false }); f.editor.edit('maxUses', '4'); await f.editor.save()
  expect(f.editor.getSnapshot().dirty).toBe(false)
  f.editor.dispose(); f.editor.reset(); f.editor.discard(); f.editor.refreshCredential()
  expect(f.dispose).toHaveBeenCalledTimes(2)
})
it('缺失基础字段可恢复继承，空密钥不发删除请求，缺失版本明确失败', async () => {
  const f = fixture(); await vi.waitFor(() => { expect(f.editor.getSnapshot().credential.status).toBe('ready') })
  f.update({ base: undefined, user: undefined })
  f.editor.resetField('baseURL'); expect(f.editor.getSnapshot().fields.baseURL.text).toBe('')
  f.editor.editSecret('fixture-secret'); f.editor.editSecret('')
  await f.editor.save()
  expect(f.save).toHaveBeenLastCalledWith({ ops: [{ op: 'unset', path: ['baseURL'] }], revision: 2 })
  f.update({ revision: undefined })
  expect(() => { f.editor.edit('maxUses', '4') }).toThrow('Ready search settings require a revision')
  f.editor.editSecret('fixture-secret')
  await expect(f.editor.save()).rejects.toThrow('Ready search settings require a revision')
  f.editor.dispose(); expect(f.editor.getSnapshot().secret).toBe('')
})
