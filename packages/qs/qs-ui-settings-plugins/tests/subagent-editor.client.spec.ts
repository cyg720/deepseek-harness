/** 子代理开关与精确允许路由共用编辑版本，旧连接回执不可清除新草稿。 */
import { expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import { createModelCatalog, modelRouteKey } from '../src/client/model-catalog.ts'
import { createSubagentEditor, type SubagentPreference } from '../src/client/subagent-editor.ts'
import type { CardWriter, SaveOutcome } from '../src/client/save.ts'

function fixture(enabled = false) {
  let snapshot: SettingsScopeSnapshot<SubagentPreference> = {
    status: 'ready', value: { enabled, allowedModels: [] }, base: undefined, user: undefined,
    revision: 2, writable: true, mode: 'host',
  }
  const listeners = new Set<() => void>()
  const scope = {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
  }
  const load = vi.fn<Context['remote']['session']['modelCatalog']>().mockResolvedValue({ ok: true, value: {
    default: { provider: 'alpha', model: 'fast' }, routableProviders: ['alpha'],
    groups: [{ id: 'alpha', name: 'Alpha', models: [{ id: 'fast', name: 'Fast' }] }], failures: [],
  } })
  const catalog = createModelCatalog(load), writers: { save: ReturnType<typeof vi.fn<CardWriter['save']>>; dispose: ReturnType<typeof vi.fn> }[] = []
  const editor = createSubagentEditor(scope, catalog, () => {
    const writer = { save: vi.fn<CardWriter['save']>().mockResolvedValue({ kind: 'refused' }), dispose: vi.fn() }
    writers.push(writer); return writer
  })
  return { editor, catalog, writers, load, listeners, update: (next: Partial<typeof snapshot>) => {
    snapshot = { ...snapshot, ...next }; for (const listener of listeners) listener()
  } }
}
it('启用必须选择路由，原子载荷保留编辑版本，冲突不静默覆盖', async () => {
  const f = fixture(), listener = vi.fn(), off = f.editor.subscribe(listener)
  expect(f.load).not.toHaveBeenCalled(); expect(f.editor.getSnapshot()).toBe(f.editor.getSnapshot())
  f.editor.toggleModel('unknown'); f.editor.toggleEnabled()
  expect(f.editor.getSnapshot().invalid).toBe(true)
  await f.editor.save(); expect(f.writers[0]!.save).not.toHaveBeenCalled()
  await f.catalog.refresh()
  f.editor.toggleModel('unknown')
  f.editor.toggleModel(modelRouteKey({ provider: 'alpha', model: 'fast' }))
  await f.editor.save()
  expect(f.writers[0]!.save).toHaveBeenLastCalledWith([
    { op: 'set', path: ['enabled'], value: true },
    { op: 'set', path: ['allowedModels'], value: [{ provider: 'alpha', model: 'fast' }] },
  ], 2)
  expect(f.editor.getSnapshot().outcome).toBe('refused')
  f.update({ revision: 3 })
  await f.editor.save(); expect(f.editor.getSnapshot().outcome).toBe('conflict')
  expect(f.writers[0]!.save).toHaveBeenCalledTimes(1)
  f.editor.discard(); expect(f.editor.getSnapshot().dirty).toBe(false)
  off(); f.editor.dispose(); expect(f.listeners.size).toBe(0)
  expect(listener).toHaveBeenCalled()
})
it('重连释放旧提交器，旧回执不能清除新草稿，保存期间禁止再次编辑', async () => {
  const f = fixture(true); await f.catalog.refresh()
  let resolve!: (value: SaveOutcome) => void
  f.writers[0]!.save.mockImplementation(() => new Promise((done) => { resolve = done }))
  f.editor.toggleModel(modelRouteKey({ provider: 'alpha', model: 'fast' }))
  const saving = f.editor.save()
  f.editor.toggleEnabled(); f.editor.toggleModel(modelRouteKey({ provider: 'alpha', model: 'fast' })); f.editor.discard()
  await f.editor.save(); expect(f.writers[0]!.save).toHaveBeenCalledOnce()
  f.editor.reset(); expect(f.writers[0]!.dispose).toHaveBeenCalledOnce()
  f.editor.toggleEnabled(); expect(f.editor.getSnapshot().dirty).toBe(true)
  resolve({ kind: 'refused' }); await saving
  expect(f.editor.getSnapshot().outcome).toBeUndefined(); expect(f.editor.getSnapshot().dirty).toBe(true)
  f.editor.dispose(); f.editor.reset(); f.editor.refresh(); f.editor.discard(); f.editor.toggleEnabled()
  expect(f.writers).toHaveLength(2)
})
it('可移除已消失路由，收到明确成功才清草稿，只读状态阻止操作', async () => {
  const f = fixture()
  f.update({ value: { enabled: true, allowedModels: [{ provider: 'gone', model: 'old' }] } })
  await f.catalog.refresh()
  const key = modelRouteKey({ provider: 'gone', model: 'old' })
  expect(f.editor.getSnapshot().candidates.find(row => row.key === key)?.available).toBe(false)
  f.editor.toggleModel(key); expect(f.editor.getSnapshot().invalid).toBe(true)
  f.editor.toggleEnabled()
  f.writers[0]!.save.mockResolvedValue({ kind: 'written', view: {
    ns: 'subagent-model-selection', schema: {}, value: { enabled: false, allowedModels: [] }, revision: 3, applies: 'live', secrets: [],
  } })
  await f.editor.save(); expect(f.editor.getSnapshot().outcome).toBe('written')
  expect(f.editor.getSnapshot().dirty).toBe(false)
  f.update({ writable: false }); f.editor.toggleEnabled(); await f.editor.save()
  expect(f.writers[0]!.save).toHaveBeenCalledOnce()
  f.editor.dispose()
})
it('未就绪不能编辑，缺失编辑版本明确失败，目录刷新按启用状态执行', async () => {
  const f = fixture()
  f.editor.refresh(); expect(f.load).not.toHaveBeenCalled()
  f.update({ status: 'loading', value: undefined, revision: undefined })
  f.editor.toggleEnabled(); expect(f.editor.getSnapshot().dirty).toBe(false)
  f.update({ status: 'ready', value: { enabled: false, allowedModels: [] } })
  expect(() => { f.editor.toggleEnabled() }).toThrow('Ready subagent settings require a revision')
  f.update({ revision: 4 }); f.editor.toggleEnabled()
  await f.catalog.refresh(); const count = f.load.mock.calls.length
  f.editor.refresh(); expect(f.load).toHaveBeenCalledTimes(count + 1)
  await f.catalog.refresh(); f.editor.dispose()
})
