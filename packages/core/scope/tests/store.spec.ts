/**
 * 文件职责：验证作用域的 store.spec.ts 行为与不变量。
 * 技术维度：Vitest、Cordis、会话事件、模型适配器和可控工具夹具。
 * 产品维度：防止作用域在取消、恢复、错误或并发场景中产生回归。
 * 逻辑维度：构造服务与事件，驱动执行流程，再断言日志、请求、状态和清理。
 * 关键边界：测试后台任务必须结束；模型可见输入必须可从日志重建；工具调用顺序不可破坏。
 * 新手阅读建议：先读 mock/辅助函数，再按成功、错误、恢复和生命周期场景阅读。
 */
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import {
  AnonymousEntries,
  createScope,
  NamedEntries,
  ScopedLayers,
  /** 中文说明：测试类型或类 Scope 约束夹具数据和行为。 */
  type Scope,
  /** 中文说明：测试类型或类 ScopeKey 约束夹具数据和行为。 */
  type ScopeKey,
  /** 中文说明：测试类型或类 ScopeLayer 约束夹具数据和行为。 */
  type ScopeLayer,
} from '@deepseek-ai/dsh-scope'

/** 中文说明：测试类型或类 TestLayer 约束夹具数据和行为。 */
class TestLayer implements ScopeLayer {
  readonly named: NamedEntries<number>
  readonly anonymous = new AnonymousEntries<string>()

  constructor(scope: ScopeKey | undefined) {
    this.named = new NamedEntries(name =>
      new Error(`${scope === undefined ? 'global' : 'scoped'} duplicate: ${name}`))
  }

  isEmpty(): boolean {
    return this.named.isEmpty() && this.anonymous.isEmpty()
  }
}

/** Mint one active scope for lifecycle tests. */
/** 中文说明：测试辅助函数 mintScope 的参数见签名，返回值用于驱动或断言场景；示例见下方用例。 */
async function mintScope(ctx: Context, key: ScopeKey): Promise<Scope> {
  /** 中文说明：测试局部值 scope!: Scope，由紧邻初始化决定，仅在当前场景使用。 */
  let scope!: Scope
  await ctx.plugin((inner: Context) => { scope = createScope(inner, key) })
  return scope
}

describe('NamedEntries', () => {
  it('owns duplicate diagnostics, lookup, insertion order, live iteration, and exact idempotent undo', () => {
    /** 中文说明：测试局部值 duplicate，由紧邻初始化决定，仅在当前场景使用。 */
    const duplicate = new Error('caller duplicate')
    /** 中文说明：测试局部值 duplicateError，由紧邻初始化决定，仅在当前场景使用。 */
    const duplicateError = vi.fn(() => duplicate)
    /** 中文说明：测试局部值 entries，由紧邻初始化决定，仅在当前场景使用。 */
    const entries = new NamedEntries<number>(duplicateError)
    /** 中文说明：测试局部值 undoA，由紧邻初始化决定，仅在当前场景使用。 */
    const undoA = entries.insert('a', 1)
    /** 中文说明：测试局部值 values，由紧邻初始化决定，仅在当前场景使用。 */
    const values = entries.values()
    expect(values.next()).toEqual({ value: 1, done: false })
    /** 中文说明：测试局部值 undoB，由紧邻初始化决定，仅在当前场景使用。 */
    const undoB = entries.insert('b', 2)

    expect([...values]).toEqual([2])
    expect([...entries.keys()]).toEqual(['a', 'b'])
    expect([...entries.entries()]).toEqual([['a', 1], ['b', 2]])
    expect(entries.get('a')).toBe(1)
    expect(entries.get('missing')).toBeUndefined()
    expect(entries.has('b')).toBe(true)
    expect(entries.has('missing')).toBe(false)
    expect(entries.isEmpty()).toBe(false)
    expect(() => entries.insert('a', 3)).toThrow(duplicate)
    expect(duplicateError).toHaveBeenCalledWith('a')

    undoA()
    entries.insert('a', 3)
    undoA()
    expect(entries.get('a')).toBe(3)
    undoB()
    expect([...entries.entries()]).toEqual([['a', 3]])
  })

  it('starts a fresh iterator generation after the table drains', () => {
    /** 中文说明：测试局部值 entries，由紧邻初始化决定，仅在当前场景使用。 */
    const entries = new NamedEntries<number>(name => new Error(`duplicate: ${name}`))
    /** 中文说明：测试局部值 undo，由紧邻初始化决定，仅在当前场景使用。 */
    const undo = entries.insert('first', 1)
    /** 中文说明：测试局部值 values，由紧邻初始化决定，仅在当前场景使用。 */
    const values = entries.values()

    expect(values.next()).toEqual({ value: 1, done: false })
    undo()
    entries.insert('replacement', 2)

    expect(values.next().done).toBe(true)
    expect([...entries.values()]).toEqual([2])
  })
})

describe('AnonymousEntries', () => {
  it('owns equal values independently with live insertion-ordered iteration and idempotent undo', () => {
    /** 中文说明：测试局部值 entries，由紧邻初始化决定，仅在当前场景使用。 */
    const entries = new AnonymousEntries<object>()
    /** 中文说明：测试局部值 value，由紧邻初始化决定，仅在当前场景使用。 */
    const value = {}
    /** 中文说明：测试局部值 undoFirst，由紧邻初始化决定，仅在当前场景使用。 */
    const undoFirst = entries.append(value)
    /** 中文说明：测试局部值 values，由紧邻初始化决定，仅在当前场景使用。 */
    const values = entries.values()
    expect(values.next()).toEqual({ value, done: false })
    /** 中文说明：测试局部值 undoSecond，由紧邻初始化决定，仅在当前场景使用。 */
    const undoSecond = entries.append(value)

    expect([...values]).toEqual([value])
    expect([...entries.values()]).toEqual([value, value])
    undoFirst()
    undoFirst()
    expect([...entries.values()]).toEqual([value])
    undoSecond()
    expect(entries.isEmpty()).toBe(true)
  })

  it('starts a fresh iterator generation after the table drains', () => {
    /** 中文说明：测试局部值 entries，由紧邻初始化决定，仅在当前场景使用。 */
    const entries = new AnonymousEntries<number>()
    /** 中文说明：测试局部值 undo，由紧邻初始化决定，仅在当前场景使用。 */
    const undo = entries.append(1)
    /** 中文说明：测试局部值 values，由紧邻初始化决定，仅在当前场景使用。 */
    const values = entries.values()

    expect(values.next()).toEqual({ value: 1, done: false })
    undo()
    entries.append(2)

    expect(values.next().done).toBe(true)
    expect([...entries.values()]).toEqual([2])
  })
})

describe('ScopedLayers', () => {
  it('constructs global state eagerly while reads stay non-creating and merge named shadows in order', () => {
    /** 中文说明：测试局部值 created，由紧邻初始化决定，仅在当前场景使用。 */
    const created: Array<ScopeKey | undefined> = []
    /** 中文说明：测试局部值 layers，由紧邻初始化决定，仅在当前场景使用。 */
    const layers = new ScopedLayers(
      (scope) => {
        created.push(scope)
        return new TestLayer(scope)
      },
      vi.fn(),
    )
    /** 中文说明：测试局部值 key，由紧邻初始化决定，仅在当前场景使用。 */
    const key = {}
    layers.global.named.insert('a', 1)
    layers.global.named.insert('shared', 2)

    expect(created).toEqual([undefined])
    expect(layers.peek(undefined)).toBeUndefined()
    expect(layers.peek(key)).toBeUndefined()
    expect([...layers.merge(key, layer => layer.named)]).toEqual([['a', 1], ['shared', 2]])
    expect(created).toEqual([undefined])
  })

  it('uses the same scoped context for lazy visibility and ownership, and reclaims only an empty aggregate', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = new Context()
    /** 中文说明：测试局部值 key，由紧邻初始化决定，仅在当前场景使用。 */
    const key = {}
    /** 中文说明：测试局部值 scope，由紧邻初始化决定，仅在当前场景使用。 */
    const scope = await mintScope(ctx, key)
    /** 中文说明：测试局部值 changed，由紧邻初始化决定，仅在当前场景使用。 */
    const changed = vi.fn()
    /** 中文说明：测试局部值 created，由紧邻初始化决定，仅在当前场景使用。 */
    const created: Array<ScopeKey | undefined> = []
    /** 中文说明：测试局部值 layers，由紧邻初始化决定，仅在当前场景使用。 */
    const layers = new ScopedLayers(
      (selected) => {
        created.push(selected)
        return new TestLayer(selected)
      },
      changed,
    )
    layers.global.named.insert('a', 1)
    layers.global.named.insert('shared', 1)
    /** 中文说明：测试局部值 removeNamed，由紧邻初始化决定，仅在当前场景使用。 */
    const removeNamed = layers.effect(
      scope.ctx,
      layer => layer.named.insert('shared', 2),
      { label: 'test.named', notify: false },
    )
    /** 中文说明：测试局部值 removeTail，由紧邻初始化决定，仅在当前场景使用。 */
    const removeTail = layers.effect(
      scope.ctx,
      layer => layer.named.insert('c', 3),
      { label: 'test.tail', notify: false },
    )
    /** 中文说明：测试局部值 removeAnonymous，由紧邻初始化决定，仅在当前场景使用。 */
    const removeAnonymous = layers.effect(
      scope.ctx,
      layer => layer.anonymous.append('kept'),
      { label: 'test.anonymous', notify: false },
    )

    expect(created).toEqual([undefined, key])
    expect([...layers.merge(key, layer => layer.named)]).toEqual([['a', 1], ['shared', 2], ['c', 3]])
    expect(changed).not.toHaveBeenCalled()
    removeNamed()
    expect(layers.peek(key)).toBeDefined()
    expect([...layers.merge(key, layer => layer.named)]).toEqual([['a', 1], ['shared', 1], ['c', 3]])
    removeTail()
    expect(layers.peek(key)).toBeDefined()
    removeAnonymous()
    expect(layers.peek(key)).toBeUndefined()
    await scope.dispose()
  })

  it('runs action, notification, undo, and disposal notification in order with Cordis idempotence and labels', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = new Context()
    /** 中文说明：测试局部值 events，由紧邻初始化决定，仅在当前场景使用。 */
    const events: string[] = []
    /** 中文说明：测试局部值 layers，由紧邻初始化决定，仅在当前场景使用。 */
    const layers = new ScopedLayers(
      scope => new TestLayer(scope),
      () => void events.push('notify'),
    )
    /** 中文说明：测试局部值 dispose，由紧邻初始化决定，仅在当前场景使用。 */
    const dispose = layers.effect(
      ctx,
      (layer) => {
        events.push('action')
        /** 中文说明：测试局部值 undo，由紧邻初始化决定，仅在当前场景使用。 */
        const undo = layer.named.insert('x', 1)
        return () => {
          events.push('undo')
          undo()
        }
      },
      { label: 'store.order' },
    )

    expect(events).toEqual(['action', 'notify'])
    expect(ctx.fiber.getEffects().map(effect => effect.label)).toContain('store.order')
    dispose()
    dispose()
    expect(events).toEqual(['action', 'notify', 'undo', 'notify'])
    expect(layers.global.isEmpty()).toBe(true)
  })

  it('returns the exact context effect disposer', () => {
    /** 中文说明：测试局部值 rawDispose，由紧邻初始化决定，仅在当前场景使用。 */
    const rawDispose = vi.fn()
    /** 中文说明：测试局部值 effect，由紧邻初始化决定，仅在当前场景使用。 */
    const effect = vi.fn(() => rawDispose)
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = { effect } as unknown as Context
    /** 中文说明：测试局部值 action，由紧邻初始化决定，仅在当前场景使用。 */
    const action = vi.fn(() => vi.fn())
    /** 中文说明：测试局部值 layers，由紧邻初始化决定，仅在当前场景使用。 */
    const layers = new ScopedLayers(scope => new TestLayer(scope), vi.fn())

    /** 中文说明：测试局部值 returned，由紧邻初始化决定，仅在当前场景使用。 */
    const returned = layers.effect(ctx, action, { label: 'store.identity', notify: false })

    expect(returned).toBe(rawDispose)
    expect(effect).toHaveBeenCalledWith(expect.any(Function), 'store.identity')
    expect(action).not.toHaveBeenCalled()
  })

  it('cleans up failed factories and empty failed actions without discarding an existing layer', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = new Context()
    /** 中文说明：测试局部值 key，由紧邻初始化决定，仅在当前场景使用。 */
    const key = {}
    /** 中文说明：测试局部值 scope，由紧邻初始化决定，仅在当前场景使用。 */
    const scope = await mintScope(ctx, key)
    /** 中文说明：测试局部值 failFactory，由紧邻初始化决定，仅在当前场景使用。 */
    let failFactory = true
    /** 中文说明：测试局部值 layers，由紧邻初始化决定，仅在当前场景使用。 */
    const layers = new ScopedLayers(
      (selected) => {
        if (selected !== undefined && failFactory) throw new Error('factory failed')
        return new TestLayer(selected)
      },
      vi.fn(),
    )

    expect(() => layers.effect(
      scope.ctx,
      layer => layer.named.insert('never', 1),
      { label: 'store.factory', notify: false },
    )).toThrow('factory failed')
    expect(layers.peek(key)).toBeUndefined()

    failFactory = false
    expect(() => layers.effect(
      scope.ctx,
      () => { throw new Error('action failed') },
      { label: 'store.action', notify: false },
    )).toThrow('action failed')
    expect(layers.peek(key)).toBeUndefined()

    /** 中文说明：测试局部值 dispose，由紧邻初始化决定，仅在当前场景使用。 */
    const dispose = layers.effect(
      scope.ctx,
      layer => layer.named.insert('kept', 1),
      { label: 'store.kept', notify: false },
    )
    expect(() => layers.effect(
      scope.ctx,
      () => { throw new Error('second action failed') },
      { label: 'store.existing-action', notify: false },
    )).toThrow('second action failed')
    expect(layers.peek(key)?.named.get('kept')).toBe(1)
    dispose()
    await scope.dispose()
  })

  it('rolls back a scoped insertion when notification throws', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = new Context()
    /** 中文说明：测试局部值 key，由紧邻初始化决定，仅在当前场景使用。 */
    const key = {}
    /** 中文说明：测试局部值 scope，由紧邻初始化决定，仅在当前场景使用。 */
    const scope = await mintScope(ctx, key)
    /** 中文说明：测试局部值 events，由紧邻初始化决定，仅在当前场景使用。 */
    const events: string[] = []
    /** 中文说明：测试局部值 notifications，由紧邻初始化决定，仅在当前场景使用。 */
    let notifications = 0
    /** 中文说明：测试局部值 layers，由紧邻初始化决定，仅在当前场景使用。 */
    const layers = new ScopedLayers(
      selected => new TestLayer(selected),
      () => {
        events.push('notify')
        if (++notifications === 1) throw new Error('change failed')
      },
    )

    expect(() => layers.effect(
      scope.ctx,
      (layer) => {
        /** 中文说明：测试局部值 undo，由紧邻初始化决定，仅在当前场景使用。 */
        const undo = layer.named.insert('rollback', 1)
        return () => {
          events.push('undo')
          undo()
        }
      },
      { label: 'store.rollback' },
    )).toThrow('change failed')

    expect(events).toEqual(['notify', 'undo', 'notify'])
    expect(layers.peek(key)).toBeUndefined()
    await scope.dispose()
  })
})
