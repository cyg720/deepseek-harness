/**
 * 文件职责：验证客户端会话运行时的 store 行为与边界。
 * 技术维度：Vitest、TypeScript、可控测试替身和真实模块组装。
 * 产品维度：防止用户可见行为在重构或扩展后发生回归。
 * 逻辑维度：构造场景输入，调用被测入口，记录状态并断言结果。
 * 关键边界：测试替身需在用例后清理；异步任务不能泄漏到后续场景。
 * 新手阅读建议：先读辅助函数和固定数据，再按 describe 场景顺序阅读。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSnapshotStore, defineStore, shallowEqual } from '../src/client/contract/store.ts'

/** 中文说明：类型 State 约束本文件数据字段及允许取值。 */
interface State {
  /** 中文说明：成员 a 保存可编排测试状态，取值由声明类型限定。 */
  a: { n: number }
  /** 中文说明：成员 b 保存可编排测试状态，取值由声明类型限定。 */
  b: { list: string[] }
}

/** 中文说明：测试场景的局部值 init，取值由紧邻初始化决定，仅在当前作用域使用。 */
const init = (): State => ({ a: { n: 1 }, b: { list: ['x'] } })

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('createSnapshotStore', () => {
  it('applies update through a draft and preserves untouched branch references', () => {
    /** 中文说明：当前状态或快照 store，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const store = createSnapshotStore(init())
    /** 中文说明：测试场景的局部值 before，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const before = store.getSnapshot()
    store.update((d) => { d.a.n = 2 })
    /** 中文说明：测试场景的局部值 after，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const after = store.getSnapshot()
    expect(after).not.toBe(before)
    expect(after.a.n).toBe(2)
    expect(after.b).toBe(before.b)
  })

  it('notifies synchronously per update by default', () => {
    /** 中文说明：当前状态或快照 store，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const store = createSnapshotStore(init())
    /** 中文说明：按序保存的数据集合 seen，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const seen: number[] = []
    store.subscribe(() => { seen.push(store.getSnapshot().a.n) })
    store.update((d) => { d.a.n = 2 })
    store.update((d) => { d.a.n = 3 })
    expect(seen).toEqual([2, 3])
  })

  it('coalesces a frame of updates into one notification in raf mode', () => {
    /** 中文说明：当前传输或投影数据 frame，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const frame: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      frame.push(cb)
      return frame.length
    })
    /** 中文说明：当前状态或快照 store，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const store = createSnapshotStore(init(), { flush: 'raf' })
    /** 中文说明：失败路径的观测值 spy，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const spy = vi.fn()
    store.subscribe(spy)
    store.update((d) => { d.a.n = 2 })
    store.update((d) => { d.a.n = 3 })
    store.update((d) => { d.b.list.push('y') })
    expect(spy).not.toHaveBeenCalled()
    expect(frame).toHaveLength(1)
    frame.shift()!(0)
    expect(spy).toHaveBeenCalledTimes(1)
    expect(store.getSnapshot().a.n).toBe(3)
    // Next frame batches independently.
    store.update((d) => { d.a.n = 4 })
    expect(frame).toHaveLength(1)
    frame.shift()!(0)
    expect(spy).toHaveBeenCalledTimes(2)
  })

  it('falls back to microtask batching in raf mode without requestAnimationFrame', async () => {
    /** 中文说明：当前状态或快照 store，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const store = createSnapshotStore(init(), { flush: 'raf' })
    /** 中文说明：失败路径的观测值 spy，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const spy = vi.fn()
    store.subscribe(spy)
    store.update((d) => { d.a.n = 2 })
    store.update((d) => { d.a.n = 3 })
    expect(spy).not.toHaveBeenCalled()
    await Promise.resolve()
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('unsubscribes raf-mode listeners', () => {
    /** 中文说明：当前传输或投影数据 frame，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const frame: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      frame.push(cb)
      return frame.length
    })
    /** 中文说明：当前状态或快照 store，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const store = createSnapshotStore(init(), { flush: 'raf' })
    /** 中文说明：失败路径的观测值 spy，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const spy = vi.fn()
    /** 中文说明：测试场景的局部值 off，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const off = store.subscribe(spy)
    store.update((d) => { d.a.n = 2 })
    off()
    frame.shift()!(0)
    expect(spy).not.toHaveBeenCalled()
  })

  it('replaces state wholesale via set and freezes it outside production', () => {
    /** 中文说明：当前状态或快照 store，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const store = createSnapshotStore(init())
    /** 中文说明：测试场景的局部值 next，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const next = init()
    store.set(next)
    expect(store.getSnapshot()).toBe(next)
    expect(() => { (store.getSnapshot().a).n = 9 }).toThrow()
  })

  it('freezes update produce output outside production (immer dev freeze)', () => {
    /** 中文说明：当前状态或快照 store，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const store = createSnapshotStore(init())
    store.update((d) => { d.a.n = 2 })
    expect(() => { (store.getSnapshot().a).n = 9 }).toThrow()
  })

  it('rehydrates primitive state whole, not spread into index keys', () => {
    /** 中文说明：测试场景的局部值 backing，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const backing = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => backing.get(k) ?? null,
      setItem: (k: string, v: string) => { backing.set(k, v) },
      removeItem: (k: string) => { backing.delete(k) },
    })
    /** 中文说明：当前状态或快照 store，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const store = createSnapshotStore<string>('', { persist: { name: 'spec-draft' } })
    store.set('hello')
    /** 中文说明：测试场景的局部值 revived，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const revived = createSnapshotStore<string>('', { persist: { name: 'spec-draft' } })
    expect(revived.getSnapshot()).toBe('hello')
  })

  it('persists to localStorage under the given name and rehydrates', () => {
    /** 中文说明：测试场景的局部值 backing，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const backing = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => backing.get(k) ?? null,
      setItem: (k: string, v: string) => { backing.set(k, v) },
      removeItem: (k: string) => { backing.delete(k) },
    })
    /** 中文说明：当前状态或快照 store，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const store = createSnapshotStore(init(), { persist: { name: 'spec-store' } })
    store.update((d) => { d.a.n = 42 })
    expect(backing.has('spec-store')).toBe(true)
    /** 中文说明：测试场景的局部值 revived，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const revived = createSnapshotStore(init(), { persist: { name: 'spec-store' } })
    expect(revived.getSnapshot().a.n).toBe(42)
  })
})

describe('defineStore', () => {
  /** 中文说明：测试场景的局部值 declare，取值由紧邻初始化决定，仅在当前作用域使用。 */
  const declare = () => defineStore({
    init: () => ({ selection: null as string | null, draft: '' }),
    actions: {
      select: (d, target: string) => { d.selection = target },
      setDraft: (d, text: string) => { d.draft = text },
      clearDraft: (d) => { d.draft = '' },
    },
  })

  it('create() yields a live instance: fresh init state, selector-visible action writes', () => {
    /** 中文说明：测试场景的局部值 inst，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const inst = declare().create()
    expect(inst.store.getSnapshot()).toEqual({ selection: null, draft: '' })
    inst.actions.setDraft('hello')
    inst.actions.select('m1')
    expect(inst.store.getSnapshot()).toEqual({ selection: 'm1', draft: 'hello' })
    inst.actions.clearDraft()
    expect(inst.store.getSnapshot().draft).toBe('')
  })

  it('bakes draft-stripped actions that write through update (draft mutation, not replacement)', () => {
    /** 中文说明：测试场景的局部值 inst，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const inst = declare().create()
    /** 中文说明：测试场景的局部值 before，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const before = inst.store.getSnapshot()
    inst.actions.setDraft('x')
    /** 中文说明：测试场景的局部值 after，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const after = inst.store.getSnapshot()
    expect(after).not.toBe(before)
    expect(after.selection).toBe(before.selection)   // untouched branch preserved (immer path)
  })

  it('creates independent instances per create() call (the handle is a spec, not a singleton)', () => {
    /** 中文说明：测试场景的局部值 handle，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const handle = declare()
    /** 中文说明：测试场景的局部值 a，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const a = handle.create()
    /** 中文说明：测试场景的局部值 b，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const b = handle.create()
    a.actions.setDraft('only-a')
    expect(b.store.getSnapshot().draft).toBe('')
  })

  it('suffixes the persist key with the scope key: per-session persistence plus clearPersisted cleanup', () => {
    /** 中文说明：测试场景的局部值 backing，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const backing = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => backing.get(k) ?? null,
      setItem: (k: string, v: string) => { backing.set(k, v) },
      removeItem: (k: string) => { backing.delete(k) },
    })
    /** 中文说明：测试场景的局部值 handle，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const handle = defineStore({
      init: () => ({ draft: '' }),
      persist: 'spec.chat',
      actions: { setDraft: (d, text: string) => { d.draft = text } },
    })
    handle.create('s1').actions.setDraft('one')
    handle.create('s2').actions.setDraft('two')
    handle.create().actions.setDraft('root')
    expect(JSON.parse(backing.get('spec.chat.s1')!)).toEqual({ draft: 'one' })
    expect(JSON.parse(backing.get('spec.chat.s2')!)).toEqual({ draft: 'two' })
    expect(JSON.parse(backing.get('spec.chat')!)).toEqual({ draft: 'root' })
    // Rehydration honors the same suffixed key.
    expect(handle.create('s1').store.getSnapshot().draft).toBe('one')
    // Scope-death cleanup removes exactly the suffixed key.
    handle.create('s1').clearPersisted()
    expect(backing.has('spec.chat.s1')).toBe(false)
    expect(backing.has('spec.chat.s2')).toBe(true)
    expect(backing.has('spec.chat')).toBe(true)
  })

  it('clearPersisted is a no-op without a persist declaration or without storage', () => {
    /** 中文说明：测试场景的局部值 inst，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const inst = declare().create('s1')   // no persist key declared
    expect(() => { inst.clearPersisted() }).not.toThrow()
    /** 中文说明：测试场景的局部值 persisting，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const persisting = defineStore({
      init: () => ({ n: 0 }),
      persist: 'spec.nostorage',
      actions: { inc: (d) => { d.n += 1 } },
    }).create()
    // jsdom-less lane: localStorage may exist here, so simulate its absence.
    vi.stubGlobal('localStorage', undefined)
    expect(() => { persisting.clearPersisted() }).not.toThrow()
  })

  it('swallows storage failures in clearPersisted (same non-fatal contract as persistence)', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => { throw new Error('quota / private mode') },
    })
    /** 中文说明：测试场景的局部值 inst，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const inst = defineStore({
      init: () => ({ n: 0 }),
      persist: 'spec.throwing',
      actions: { inc: (d) => { d.n += 1 } },
    }).create()
    expect(() => { inst.clearPersisted() }).not.toThrow()
  })
})

describe('shallowEqual', () => {
  it('matches one-level-equal objects and rejects deeper drift', () => {
    /** 中文说明：测试场景的局部值 leaf，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const leaf = { deep: 1 }
    expect(shallowEqual({ x: 1, y: leaf }, { x: 1, y: leaf })).toBe(true)
    expect(shallowEqual({ x: 1, y: { deep: 1 } }, { x: 1, y: { deep: 1 } })).toBe(false)
    expect(shallowEqual([1, 2], [1, 2])).toBe(true)
    expect(shallowEqual([1, 2], [2, 1])).toBe(false)
  })
})
