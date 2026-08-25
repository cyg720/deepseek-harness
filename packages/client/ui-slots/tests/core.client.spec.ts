// SlotCore terminal-design behavior: the single register composition API —
// a-priori 'root', children declaration/authorization, load-time validation,
// one-axis lifecycle cascade, store scope pinning, subscription API.
/**
 * 文件职责：验证界面插槽的 core.client.spec.ts 行为。
 * 技术维度：Vitest、React 渲染、DOM 事件和服务替身。
 * 产品维度：防止界面插槽显示、导航或生命周期回归。
 * 逻辑维度：构造状态，触发交互并断言输出和清理。
 * 关键边界：全局主题、DOM 尺寸和订阅必须在用例后恢复。
 * 新手阅读建议：先读夹具，再按加载、交互和卸载场景阅读。
 */
import { describe, expect, it, vi } from 'vitest'
import type { SlotComponent, StoreHandle } from '@deepseek-ai/dsh-client-ui-slots'
import { SlotCore } from '@deepseek-ai/dsh-client-ui-slots'

// 'root' is NOT merged here: the runtime package owns the built-in row, and
// the client aggregate program would see both merges collide.
declare module '@deepseek-ai/dsh-client-ui-slots' {
  /** 中文说明：类型或类 SlotMap 约束模块数据或组件职责。 */
  interface SlotMap {
    'test.single': { kind: 'single'; scope: 'root' }
    'test.session': { kind: 'single'; scope: 'session' }
    'test.list': { kind: 'list'; scope: 'root' }
    'test.keyed': { kind: 'keyed'; scope: 'session' }
    'test.chain': { kind: 'chain'; scope: 'session'; owner: { tags: string[] } }
    'test.grandchild': { kind: 'single'; scope: 'root' }
  }
}

// Wide-accepting fixture: assignable wherever the composed constraint is an
// object type (children-declaring fixtures erase via `as never` instead —
// RendersCheck would demand a renderSlot consumer).
/** 中文说明：测试局部值 Comp，由紧邻初始化决定。 */
const Comp: SlotComponent<object> = () => null

/** A minimal structurally-valid store handle (identity is what the ledger tracks). */
/* 中文说明：函数 fakeHandle 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function fakeHandle(): StoreHandle<{ n: number }, Record<string, (d: { n: number }) => void>> {
  return {
    spec: { init: () => ({ n: 0 }), actions: {} },
    create: () => { throw new Error('not under test') },
  }
}

/** Register a root-frame entry declaring the four test child slots. */
/* 中文说明：函数 mountFrame 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function mountFrame(core: SlotCore) {
  return core.register({
    name: 'root',
    children: {
      'test.single': { kind: 'single', scope: 'root' },
      'test.session': { kind: 'single', scope: 'session' },
      'test.list': { kind: 'list', scope: 'root' },
      'test.keyed': { kind: 'keyed', scope: 'session' },
      'test.chain': { kind: 'chain', scope: 'session' },
    },
  // Type-level renderSlot presence is proven by the type-chain spec; erasing
  // here keeps runtime fixtures terse.
  }, Comp as never)
}

/** 中文说明：测试局部值 flushMicrotasks，由紧邻初始化决定。 */
const flushMicrotasks = () => new Promise<void>((resolve) => { queueMicrotask(resolve) })

describe('a-priori root and declaration gate', () => {
  it('seeds root as single/root at construction', () => {
    /** 中文说明：测试局部值 core，由紧邻初始化决定。 */
    const core = new SlotCore()
    expect(core.specDynamic('root')).toEqual({ kind: 'single', scope: 'root' })
  })

  it('throws on registering into an undeclared slot', () => {
    /** 中文说明：测试局部值 core，由紧邻初始化决定。 */
    const core = new SlotCore()
    expect(() => core.register({ name: 'test.single' }, Comp)).toThrow('not declared')
  })

  it('root is single: a second frame registration throws', () => {
    /** 中文说明：测试局部值 core，由紧邻初始化决定。 */
    const core = new SlotCore()
    mountFrame(core)
    expect(() => core.register({ name: 'root' }, Comp)).toThrow('already has a registration')
  })

  it('children declaration makes child slots registerable, with specs recorded', () => {
    /** 中文说明：测试局部值 core，由紧邻初始化决定。 */
    const core = new SlotCore()
    mountFrame(core)
    expect(core.specDynamic('test.session')).toEqual({ kind: 'single', scope: 'session' })
    expect(() => core.register({ name: 'test.single' }, Comp)).not.toThrow()
  })

  it('duplicate child declaration throws naming the first declarer', () => {
    /** 中文说明：测试局部值 core，由紧邻初始化决定。 */
    const core = new SlotCore()
    mountFrame(core)
    core.register({ name: 'test.single', children: { 'test.grandchild': { kind: 'single', scope: 'root' } } }, Comp as never)
    expect(() => core.register(
      { name: 'test.session', children: { 'test.grandchild': { kind: 'single', scope: 'root' } }, registrant: 'imposter' },
      Comp as never,
    )).toThrow(/already declared.*test\.single/)
  })
})

describe('lifecycle cascade (one axis)', () => {
  it('disposing a declaring entry collapses child slots and their contributions recursively', () => {
    /** 中文说明：测试局部值 core，由紧邻初始化决定。 */
    const core = new SlotCore()
    /** 中文说明：测试局部值 disposeFrame，由紧邻初始化决定。 */
    const disposeFrame = mountFrame(core)
    /** 中文说明：测试局部值 disposeChild，由紧邻初始化决定。 */
    const disposeChild = core.register(
      { name: 'test.single', children: { 'test.grandchild': { kind: 'single', scope: 'root' } } }, Comp as never)
    core.register({ name: 'test.grandchild' }, Comp)
    expect(core.entries('test.grandchild')).toHaveLength(1)

    disposeFrame()
    expect(core.specDynamic('test.single')).toBeUndefined()
    expect(core.specDynamic('test.grandchild')).toBeUndefined()
    expect(core.entries('test.single')).toHaveLength(0)
    expect(core.entries('test.grandchild')).toHaveLength(0)
    // Stale disposer of a cascaded-away entry is a no-op.
    expect(() => { disposeChild() }).not.toThrow()
    // Slots return to undeclared: contributing again throws until redeclared.
    expect(() => core.register({ name: 'test.single' }, Comp)).toThrow('not declared')
  })

  it('registration disposers are idempotent', () => {
    /** 中文说明：测试局部值 core，由紧邻初始化决定。 */
    const core = new SlotCore()
    /** 中文说明：测试局部值 dispose，由紧邻初始化决定。 */
    const dispose = mountFrame(core)
    dispose()
    dispose()
    expect(core.entries('root')).toHaveLength(0)
    // Redeclare works after collapse.
    mountFrame(core)
    expect(core.specDynamic('test.single')).toBeDefined()
  })

  it('isLive tracks ledger membership across dispose', () => {
    /** 中文说明：测试局部值 core，由紧邻初始化决定。 */
    const core = new SlotCore()
    mountFrame(core)
    /** 中文说明：测试局部值 dispose，由紧邻初始化决定。 */
    const dispose = core.register({ name: 'test.single' }, Comp)
    /** 中文说明：测试局部值 entry，由紧邻初始化决定。 */
    const entry = core.entries('test.single')[0]!
    expect(core.isLive(entry)).toBe(true)
    dispose()
    expect(core.isLive(entry)).toBe(false)
  })
})

describe('kind semantics', () => {
  it('keyed: duplicate key throws, missing key throws', () => {
    /** 中文说明：测试局部值 core，由紧邻初始化决定。 */
    const core = new SlotCore()
    mountFrame(core)
    core.register({ name: 'test.keyed', key: 'a' }, Comp)
    expect(() => core.register({ name: 'test.keyed', key: 'a' }, Comp)).toThrow('key "a"')
    // Statically rejected (KindOptions); runtime guard stays for dynamic callers.
    // @ts-expect-error keyed registration requires options.key
    expect(() => core.register({ name: 'test.keyed' }, Comp)).toThrow('requires options.key')
    expect(() => core.register({ name: 'test.keyed', key: 'b' }, Comp)).not.toThrow()
  })

  it('list: duplicate id throws, missing id throws, entries sort by order stably', () => {
    /** 中文说明：测试局部值 core，由紧邻初始化决定。 */
    const core = new SlotCore()
    mountFrame(core)
    core.register({ name: 'test.list', id: 'c', order: 10 }, Comp)
    core.register({ name: 'test.list', id: 'a' }, Comp)
    core.register({ name: 'test.list', id: 'b' }, Comp)
    expect(() => core.register({ name: 'test.list', id: 'a' }, Comp)).toThrow('id "a"')
    // @ts-expect-error list registration requires options.id
    expect(() => core.register({ name: 'test.list' }, Comp)).toThrow('requires options.id')
    expect(core.entries('test.list').map(e => e.options.id)).toEqual(['a', 'b', 'c'])
  })

  it('chain: missing select throws; select and priority land on the stored entry', () => {
    /** 中文说明：测试局部值 core，由紧邻初始化决定。 */
    const core = new SlotCore()
    mountFrame(core)
    // Statically rejected (KindOptions); runtime guard stays for dynamic callers.
    // @ts-expect-error chain registration requires options.select
    expect(() => core.register({ name: 'test.chain' }, Comp)).toThrow('requires options.select')
    /** 中文说明：测试局部值 select，由紧邻初始化决定。 */
    const select = ({ tags }: { tags: string[] }) => tags[0] ?? null
    core.register({ name: 'test.chain', select, priority: 5 }, Comp as never)
    /** 中文说明：测试局部值 entry，由紧邻初始化决定。 */
    const entry = core.entries('test.chain')[0]!
    expect(entry.select).toBe(select)
    expect(entry.options.priority).toBe(5)
  })

  it('chain: entries sort by priority ascending, ties keep registration order', () => {
    /** 中文说明：测试局部值 core，由紧邻初始化决定。 */
    const core = new SlotCore()
    mountFrame(core)
    /** 中文说明：测试局部值 sel，由紧邻初始化决定。 */
    const sel = () => null
    core.register({ name: 'test.chain', select: sel, priority: 10, registrant: 'late' }, Comp as never)
    core.register({ name: 'test.chain', select: sel, registrant: 'default-a' }, Comp as never)
    core.register({ name: 'test.chain', select: sel, registrant: 'default-b' }, Comp as never)
    core.register({ name: 'test.chain', select: sel, priority: -1, registrant: 'first' }, Comp as never)
    expect(core.entries('test.chain').map(e => e.registrant))
      .toEqual(['first', 'default-a', 'default-b', 'late'])
  })

  it('single: second registration throws, disposer frees the seat', () => {
    /** 中文说明：测试局部值 core，由紧邻初始化决定。 */
    const core = new SlotCore()
    mountFrame(core)
    /** 中文说明：测试局部值 dispose，由紧邻初始化决定。 */
    const dispose = core.register({ name: 'test.single' }, Comp)
    expect(() => core.register({ name: 'test.single' }, Comp)).toThrow('already has a registration')
    dispose()
    expect(core.entries('test.single')).toHaveLength(0)
    expect(() => core.register({ name: 'test.single' }, Comp)).not.toThrow()
  })
})

describe('store scope pinning', () => {
  it('one shared handle under two scopes throws at load', () => {
    /** 中文说明：测试局部值 core，由紧邻初始化决定。 */
    const core = new SlotCore()
    mountFrame(core)
    /** 中文说明：测试局部值 handle，由紧邻初始化决定。 */
    const handle = fakeHandle()
    core.register({ name: 'test.session', store: handle }, Comp as never)
    expect(() => core.register({ name: 'test.single', store: handle }, Comp as never))
      .toThrow('one handle, one scope')
  })

  it('same handle under same scope is fine; full unmount releases the pin', () => {
    /** 中文说明：测试局部值 core，由紧邻初始化决定。 */
    const core = new SlotCore()
    mountFrame(core)
    /** 中文说明：测试局部值 handle，由紧邻初始化决定。 */
    const handle = fakeHandle()
    /** 中文说明：测试局部值 d1，由紧邻初始化决定。 */
    const d1 = core.register({ name: 'test.list', id: 'x', store: handle }, Comp as never)
    /** 中文说明：测试局部值 d2，由紧邻初始化决定。 */
    const d2 = core.register({ name: 'test.list', id: 'y', store: handle }, Comp as never)
    d1()
    // Still mounted once — scope stays pinned.
    expect(() => core.register({ name: 'test.session', store: handle }, Comp as never))
      .toThrow('one handle, one scope')
    d2()
    // All mounts gone: the handle may pin a new scope.
    expect(() => core.register({ name: 'test.session', store: handle }, Comp as never)).not.toThrow()
  })

  it('factories are exempt from pinning (no shared identity)', () => {
    /** 中文说明：测试局部值 core，由紧邻初始化决定。 */
    const core = new SlotCore()
    mountFrame(core)
    /** 中文说明：测试局部值 factory，由紧邻初始化决定。 */
    const factory = () => fakeHandle()
    core.register({ name: 'test.session', store: factory }, Comp as never)
    expect(() => core.register({ name: 'test.single', store: factory }, Comp as never)).not.toThrow()
  })

  it('cascade releases store pins of collapsed child entries', () => {
    /** 中文说明：测试局部值 core，由紧邻初始化决定。 */
    const core = new SlotCore()
    /** 中文说明：测试局部值 disposeFrame，由紧邻初始化决定。 */
    const disposeFrame = mountFrame(core)
    /** 中文说明：测试局部值 handle，由紧邻初始化决定。 */
    const handle = fakeHandle()
    core.register({ name: 'test.session', store: handle }, Comp as never)
    disposeFrame()
    mountFrame(core)
    expect(() => core.register({ name: 'test.single', store: handle }, Comp as never)).not.toThrow()
  })
})

describe('subscription API', () => {
  it('tracks declaration epochs separately from ordinary entry mutations', () => {
    /** 中文说明：测试局部值 core，由紧邻初始化决定。 */
    const core = new SlotCore()
    expect(core.declarationEpoch('root')).toBe(1)
    expect(core.declarationEpoch('test.list')).toBe(0)
    /** 中文说明：测试局部值 disposeFrame，由紧邻初始化决定。 */
    const disposeFrame = mountFrame(core)
    /** 中文说明：测试局部值 declared，由紧邻初始化决定。 */
    const declared = core.declarationEpoch('test.list')
    expect(declared).toBe(1)
    /** 中文说明：测试局部值 disposeEntry，由紧邻初始化决定。 */
    const disposeEntry = core.register({ name: 'test.list', id: 'a' }, Comp)
    disposeEntry()
    expect(core.declarationEpoch('test.list')).toBe(declared)
    disposeFrame()
    expect(core.declarationEpoch('test.list')).toBe(declared + 1)
    mountFrame(core)
    expect(core.declarationEpoch('test.list')).toBe(declared + 2)
  })

  it('entries() returns a stable cached reference between mutations', () => {
    /** 中文说明：测试局部值 core，由紧邻初始化决定。 */
    const core = new SlotCore()
    mountFrame(core)
    core.register({ name: 'test.list', id: 'a' }, Comp)
    /** 中文说明：测试局部值 first，由紧邻初始化决定。 */
    const first = core.entries('test.list')
    expect(core.entries('test.list')).toBe(first)
    core.register({ name: 'test.list', id: 'b' }, Comp)
    expect(core.entries('test.list')).not.toBe(first)
  })

  it('bumps version synchronously but batches notifications per microtask', async () => {
    /** 中文说明：测试局部值 core，由紧邻初始化决定。 */
    const core = new SlotCore()
    mountFrame(core)
    /** 中文说明：测试局部值 fn，由紧邻初始化决定。 */
    const fn = vi.fn()
    core.subscribe('test.list', fn)
    /** 中文说明：测试局部值 before，由紧邻初始化决定。 */
    const before = core.getVersion('test.list')
    core.register({ name: 'test.list', id: 'a' }, Comp)
    core.register({ name: 'test.list', id: 'b' }, Comp)
    expect(core.getVersion('test.list')).toBe(before + 2)
    expect(fn).not.toHaveBeenCalled()
    await flushMicrotasks()
    expect(fn).toHaveBeenCalledTimes(1)
    core.register({ name: 'test.list', id: 'c' }, Comp)
    await flushMicrotasks()
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('declaration itself notifies child-key subscribers (subscribe-ahead allowed)', async () => {
    /** 中文说明：测试局部值 core，由紧邻初始化决定。 */
    const core = new SlotCore()
    /** 中文说明：测试局部值 fn，由紧邻初始化决定。 */
    const fn = vi.fn()
    core.subscribe('test.single', fn)
    mountFrame(core)
    await flushMicrotasks()
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('notifies declaration subscribers synchronously, excluding entries, until unsubscribe', () => {
    /** 中文说明：测试局部值 core，由紧邻初始化决定。 */
    const core = new SlotCore()
    /** 中文说明：测试局部值 fn，由紧邻初始化决定。 */
    const fn = vi.fn()
    /** 中文说明：测试局部值 unsubscribe，由紧邻初始化决定。 */
    const unsubscribe = core.subscribeDeclaration('test.list', fn)
    /** 中文说明：测试局部值 disposeFrame，由紧邻初始化决定。 */
    const disposeFrame = mountFrame(core)
    expect(fn).toHaveBeenCalledTimes(1)
    core.register({ name: 'test.list', id: 'ordinary' }, Comp)
    expect(fn).toHaveBeenCalledTimes(1)
    disposeFrame()
    expect(fn).toHaveBeenCalledTimes(2)
    unsubscribe()
    mountFrame(core)
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('commits sibling declarations before notifying declaration subscribers', () => {
    /** 中文说明：测试局部值 core，由紧邻初始化决定。 */
    const core = new SlotCore()
    /** 中文说明：测试局部值 解构结果，由紧邻初始化决定。 */
    let duplicateDeclaration: unknown
    /** 中文说明：测试局部值 unsubscribe，由紧邻初始化决定。 */
    const unsubscribe = core.subscribeDeclaration('test.single', () => {
      core.register({ name: 'test.list', id: 'from-listener' }, Comp)
      try {
        core.register({
          name: 'test.single',
          children: { 'test.list': { kind: 'list', scope: 'root' } },
        }, Comp as never)
      } catch (error) {
        duplicateDeclaration = error
      }
    })

    /** 中文说明：测试局部值 disposeFrame，由紧邻初始化决定。 */
    const disposeFrame = mountFrame(core)
    expect(core.entries('test.list')).toHaveLength(1)
    expect(String(duplicateDeclaration)).toContain('already declared')
    unsubscribe()
    disposeFrame()
    expect(core.specDynamic('test.list')).toBeUndefined()
  })

  it('notifies only subscribers of the touched key; unsubscribe stops delivery', async () => {
    /** 中文说明：测试局部值 core，由紧邻初始化决定。 */
    const core = new SlotCore()
    mountFrame(core)
    await flushMicrotasks()
    /** 中文说明：测试局部值 single，由紧邻初始化决定。 */
    const single = vi.fn()
    /** 中文说明：测试局部值 list，由紧邻初始化决定。 */
    const list = vi.fn()
    core.subscribe('test.single', single)
    /** 中文说明：测试局部值 unsubscribe，由紧邻初始化决定。 */
    const unsubscribe = core.subscribe('test.list', list)
    core.register({ name: 'test.single' }, Comp)
    await flushMicrotasks()
    expect(single).toHaveBeenCalledTimes(1)
    expect(list).not.toHaveBeenCalled()
    unsubscribe()
    core.register({ name: 'test.list', id: 'a' }, Comp)
    await flushMicrotasks()
    expect(list).not.toHaveBeenCalled()
  })

  it('a mutation from inside a flush re-schedules instead of being lost', async () => {
    /** 中文说明：测试局部值 core，由紧邻初始化决定。 */
    const core = new SlotCore()
    mountFrame(core)
    await flushMicrotasks()
    /** 中文说明：测试局部值 seen，由紧邻初始化决定。 */
    const seen: number[] = []
    /** 中文说明：测试局部值 reentered，由紧邻初始化决定。 */
    let reentered = false
    core.subscribe('test.list', () => {
      seen.push(core.getVersion('test.list'))
      if (!reentered) {
        reentered = true
        core.register({ name: 'test.list', id: 'reentrant' }, Comp)
      }
    })
    core.register({ name: 'test.list', id: 'a' }, Comp)
    await flushMicrotasks()
    await flushMicrotasks()
    expect(seen).toHaveLength(2)
    expect(core.entries('test.list')).toHaveLength(2)
  })

  it('getVersion is 0 for untouched keys and monotonic across redeclaration', () => {
    /** 中文说明：测试局部值 core，由紧邻初始化决定。 */
    const core = new SlotCore()
    expect(core.getVersion('test.single')).toBe(0)
    /** 中文说明：测试局部值 dispose，由紧邻初始化决定。 */
    const dispose = mountFrame(core)
    dispose()
    /** 中文说明：测试局部值 after，由紧邻初始化决定。 */
    const after = core.getVersion('test.single')
    mountFrame(core)
    expect(core.getVersion('test.single')).toBeGreaterThan(after)
  })

  it('onMutate fires synchronously per mutation with the touched key', () => {
    /** 中文说明：测试局部值 core，由紧邻初始化决定。 */
    const core = new SlotCore()
    /** 中文说明：测试局部值 keys，由紧邻初始化决定。 */
    const keys: string[] = []
    /** 中文说明：测试局部值 off，由紧邻初始化决定。 */
    const off = core.onMutate(key => keys.push(key))
    mountFrame(core)
    // Contribution first, then each declared child key.
    expect(keys).toEqual(['root', 'test.single', 'test.session', 'test.list', 'test.keyed', 'test.chain'])
    keys.length = 0
    core.register({ name: 'test.list', id: 'a' }, Comp)
    expect(keys).toEqual(['test.list'])
    off()
    core.register({ name: 'test.list', id: 'b' }, Comp)
    expect(keys).toHaveLength(1)
  })
})
