/** 通过官方 schema 解析器核对动态选项，用可控回执复现重连与推送竞态。 */
import { Context } from '@deepseek-ai/cordis'
import { expect, it, vi } from 'vitest'
import { SettingsSchemaService } from '@deepseek-ai/dsh-client-ui-settings/src/client/schema.ts'
import { RemoteError } from '@deepseek-ai/dsh-client-test-runtime'
import type { SettingsNamespaceView } from '@deepseek-ai/dsh-api-remotes/client'
import type { SettingsMirrorSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import { createDefaults, readDefaults } from '../src/client/defaults.ts'

const SCHEMA = { uid: 5, refs: {
  1: { type: 'const', value: 'read-only' },
  2: { type: 'const', value: 'workspace-write', meta: { description: 'Workspace Write' } },
  3: { type: 'const', value: 'danger-full-access' },
  4: { type: 'union', list: [1, 2, 3] },
  5: { type: 'object', dict: { defaultPreset: 4 } },
} }
const view = (revision: number): SettingsNamespaceView => ({ ns: 'permission', revision, schema: SCHEMA, value: { defaultPreset: 'read-only' }, applies: 'live', secrets: [] })
const ready = (revision = 2, writable = true): SettingsMirrorSnapshot => ({ status: 'ready', error: null, view: { namespaces: [view(revision)], writable, hasDocument: true } })
function fixture() {
  const context = new Context(), schema = new SettingsSchemaService(context)
  let state = ready()
  const listeners = new Set<() => void>(), ensure = vi.fn(async () => {})
  const acceptView = vi.fn((next: SettingsNamespaceView) => {
    state = { ...ready(), view: { ...ready().view!, namespaces: [next] } }; notify()
  })
  const notify = () => { for (const listener of listeners) listener() }
  const mutate = vi.fn<Context['remote']['settings']['mutate']>().mockResolvedValue({ ok: true, value: view(3) })
  const controller = createDefaults({
    getSnapshot: () => state,
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    ensure, acceptView,
  }, { mutate }, schema)
  return { controller, schema, mutate, ensure, acceptView, listeners, set: (next: SettingsMirrorSnapshot) => { state = next; notify() } }
}
it('解析官方动态 schema，缺失或不匹配的描述不能成为可写默认值', () => {
  const f = fixture()
  try {
    expect(readDefaults(view(2), f.schema)).toEqual({ current: 'read-only', options: [
      { value: 'read-only', name: 'read-only' }, { value: 'workspace-write', name: 'Workspace Write' }, { value: 'danger-full-access', name: 'danger-full-access' },
    ] })
    const parse = (node: SettingsNamespaceView['schema']) => readDefaults({ ...view(2), schema: { uid: 2, refs: { 1: node, 2: { type: 'object', dict: { defaultPreset: 1 } } } } }, f.schema)
    expect(parse({ type: 'const', value: 'read-only', meta: { description: '' } }).options).toEqual([{ value: 'read-only', name: 'read-only' }])
    for (const node of [{ type: 'string' }, { type: 'const', value: 7 }, { type: 'union' }, { type: 'const', value: 'missing' }]) expect(() => parse(node)).toThrow()
    expect(() => readDefaults({ ...view(2), value: null }, f.schema)).toThrow()
    expect(() => readDefaults({ ...view(2), value: {} }, f.schema)).toThrow()
    expect(() => readDefaults({ ...view(2), schema: { uid: 1, refs: { 1: { type: 'object', dict: {} } } } }, f.schema)).toThrow()
  } finally { f.controller.dispose() }
})
it('只允许有效可写版本，完全访问须明确确认，保存载荷指向新会话默认值', async () => {
  const f = fixture()
  try {
    await f.controller.load(); expect(f.ensure).toHaveBeenCalledOnce()
    await f.controller.select('unknown', 2, true, 0)
    await f.controller.select('danger-full-access', 2, false, 0)
    expect(f.mutate).not.toHaveBeenCalled()
    await f.controller.select('workspace-write', 1, false, 0)
    expect(f.controller.getSnapshot().outcome).toBe('conflict')
    await f.controller.select('danger-full-access', 2, true, 0)
    expect(f.mutate).toHaveBeenCalledExactlyOnceWith('permission', [{ op: 'set', path: ['defaultPreset'], value: 'danger-full-access' }], 2)
    expect(f.controller.getSnapshot()).toMatchObject({ outcome: 'written', saving: false })
    for (const state of [ready(3, false), { status: 'loading', error: null, view: undefined }, { status: 'unavailable', error: null, view: undefined }, { status: 'ready', error: null, view: undefined }, { ...ready(), view: { ...ready().view!, namespaces: [] } }, { ...ready(), error: 'private' }, { ...ready(), view: { ...ready().view!, namespaces: [{ ...view(2), value: {} }] } }] as SettingsMirrorSnapshot[]) {
      f.set(state); await f.controller.select('workspace-write', 2, true, 0)
      expect(f.controller.getSnapshot().writable).toBe(false)
    }
    expect(f.mutate).toHaveBeenCalledOnce()
  } finally { f.controller.dispose() }
})
it('推送版本比写入回执新时不回滚；并发点击只发一次', async () => {
  const f = fixture()
  try {
    let resolve!: (value: Awaited<ReturnType<typeof f.mutate>>) => void
    f.mutate.mockImplementationOnce(() => new Promise((done) => { resolve = done }))
    const pending = f.controller.select('workspace-write', 2, false, 0)
    await f.controller.select('read-only', 2, false, 0)
    expect(f.mutate).toHaveBeenCalledOnce()
    f.set(ready(9)); resolve({ ok: true, value: view(3) }); await pending
    expect(f.acceptView).not.toHaveBeenCalled()
    expect(f.controller.getSnapshot()).toMatchObject({ revision: 9, outcome: 'written' })
  } finally { f.controller.dispose() }
})
it('冲突与传输失败可重试，不向视图传递错误原文', async () => {
  const f = fixture()
  try {
    for (const code of ['settings/conflict', 'settings/rejected'] as const) {
      const error = code === 'settings/conflict'
        ? new RemoteError('settings/conflict', 'private-detail', { ns: 'permission', expected: 2, actual: 3 })
        : new RemoteError('settings/rejected', 'private-detail', { ns: 'permission' })
      f.mutate.mockResolvedValueOnce({ ok: false, error })
      await f.controller.select('read-only', 2, false, 0)
      expect(f.controller.getSnapshot().outcome).toBe(code === 'settings/conflict' ? 'conflict' : 'refused')
    }
    f.mutate.mockRejectedValueOnce(new Error('private-detail'))
    await f.controller.select('read-only', 2, false, 0)
    expect(f.controller.getSnapshot().outcome).toBe('refused')
    expect(JSON.stringify(f.controller.getSnapshot())).not.toContain('private-detail')
    f.ensure.mockRejectedValueOnce(new Error('private-detail'))
    await f.controller.load(); expect(f.controller.getSnapshot().status).toBe('error')
    await f.controller.load(); expect(f.controller.getSnapshot().status).toBe('ready')
  } finally { f.controller.dispose() }
})
it('重连或卸载使旧写入和旧读取失效，不影响新生命周期', async () => {
  for (const dispose of [false, true]) for (const failure of [false, true]) {
    const f = fixture(), listener = vi.fn(), off = f.controller.subscribe(listener)
    let resolve!: (value: Awaited<ReturnType<typeof f.mutate>>) => void, reject!: (reason: Error) => void
    f.mutate.mockImplementationOnce(() => new Promise((done, fail) => { resolve = done; reject = fail }))
    const pending = f.controller.select('read-only', 2, false, 0)
    if (dispose) f.controller.dispose(); else f.controller.reset()
    if (failure) reject(new Error('late')); else resolve({ ok: true, value: view(3) })
    await pending
    expect(f.acceptView).not.toHaveBeenCalled()
    off(); listener.mockClear(); f.set(ready()); expect(listener).not.toHaveBeenCalled()
    if (dispose) { await f.controller.load(); await f.controller.select('read-only', 2, false, 0); expect(f.mutate).toHaveBeenCalledOnce(); expect(f.listeners.size).toBe(0) }
    else {
      await f.controller.select('read-only', 2, true, 0); expect(f.mutate).toHaveBeenCalledOnce()
      await f.controller.select('read-only', 2, false, 1); expect(f.acceptView).toHaveBeenCalledOnce() }
    f.controller.dispose()
  }
  const f = fixture()
  let reject!: (reason: Error) => void
  f.ensure.mockImplementationOnce(() => new Promise((_, fail) => { reject = fail }))
  const pending = f.controller.load(); f.controller.reset(); reject(new Error('late')); await pending
  expect(f.controller.getSnapshot().status).toBe('ready')
  f.controller.dispose()
  const closed = fixture()
  let finish!: () => void
  closed.ensure.mockImplementationOnce(() => new Promise((done) => { finish = done }))
  const reading = closed.controller.load(); closed.controller.dispose(); finish(); await reading
})
