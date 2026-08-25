/**
 * 文件职责：验证作用域的 scope.spec.ts 行为与不变量。
 * 技术维度：Vitest、Cordis、会话事件、模型适配器和可控工具夹具。
 * 产品维度：防止作用域在取消、恢复、错误或并发场景中产生回归。
 * 逻辑维度：构造服务与事件，驱动执行流程，再断言日志、请求、状态和清理。
 * 关键边界：测试后台任务必须结束；模型可见输入必须可从日志重建；工具调用顺序不可破坏。
 * 新手阅读建议：先读 mock/辅助函数，再按成功、错误、恢复和生命周期场景阅读。
 */
import { describe, expect, expectTypeOf, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { bindScopeParent, carrierKeyOf, createScope, isScopeCarrier, scopeChainOf, scopeOf, scopeParentOf, scopeTarget } from '@deepseek-ai/dsh-scope'
import type { Scope, Scoped } from '@deepseek-ai/dsh-scope'

declare module '@deepseek-ai/cordis' {
  /** 中文说明：测试类型或类 Events 约束夹具数据和行为。 */
  interface Events {
    /**
     * Test-only event for scope-filtered dispatch.
     * @param value - opaque payload recorded by listeners.
     * @mode emit
     */
    'scope-test/ping'(value: string): void
  }
}

/** Mount a host plugin and mint a scope inside it. */
/* 中文说明：测试辅助函数 mintScope 的参数见签名，返回值用于驱动或断言场景；示例见下方用例。 */
async function mintScope(ctx: Context, key: object): Promise<Scope> {
  /** 中文说明：测试局部值 scope!: Scope，由紧邻初始化决定，仅在当前场景使用。 */
  let scope!: Scope
  await ctx.plugin((inner: Context) => { scope = createScope(inner, key) })
  return scope
}

describe('createScope', () => {
  it('tags contexts and derived contexts, with the nearest tag winning', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = new Context()
    /** 中文说明：测试局部值 outerKey，由紧邻初始化决定，仅在当前场景使用。 */
    const outerKey = { name: 'outer' }
    /** 中文说明：测试局部值 innerKey，由紧邻初始化决定，仅在当前场景使用。 */
    const innerKey = { name: 'inner' }
    /** 中文说明：测试局部值 outer，由紧邻初始化决定，仅在当前场景使用。 */
    const outer = await mintScope(ctx, outerKey)
    /** 中文说明：测试局部值 inner，由紧邻初始化决定，仅在当前场景使用。 */
    const inner = createScope(outer.ctx, innerKey)

    expect(scopeOf(ctx)).toBeUndefined()
    expect(scopeOf(outer.ctx)).toBe(outerKey)
    expect(scopeOf(outer.ctx.extend({}))).toBe(outerKey)
    expect(scopeOf(inner.ctx)).toBe(innerKey)

    await inner.dispose()
    await outer.dispose()
  })

  it('is usable synchronously before the backing fiber activates', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = new Context()
    /** 中文说明：测试局部值 events，由紧邻初始化决定，仅在当前场景使用。 */
    const events: string[] = []
    /** 中文说明：测试局部值 scope!: Scope，由紧邻初始化决定，仅在当前场景使用。 */
    let scope!: Scope
    await ctx.plugin((inner: Context) => {
      scope = createScope(inner, { name: 'sync' })
      scope.ctx.effect(() => () => void events.push('disposed'))
      events.push('registered')
    })
    expect(events).toEqual(['registered'])
    await scope.dispose()
    expect(events).toEqual(['registered', 'disposed'])
  })

  it('shares quiescence across repeat and raw-disposer-first calls', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = new Context()
    /** 中文说明：测试局部值 scope，由紧邻初始化决定，仅在当前场景使用。 */
    const scope = await mintScope(ctx, { name: 'quiescence' })
    /** 中文说明：测试局部值 gate，由紧邻初始化决定，仅在当前场景使用。 */
    const gate = Promise.withResolvers<undefined>()
    /** 中文说明：测试局部值 finished，由紧邻初始化决定，仅在当前场景使用。 */
    let finished = false
    scope.ctx.effect(() => async () => {
      await gate.promise
      finished = true
    })

    /** 中文说明：测试局部值 raw，由紧邻初始化决定，仅在当前场景使用。 */
    const raw = Promise.resolve(scope.rawDispose())
    /** 中文说明：测试局部值 publicDispose，由紧邻初始化决定，仅在当前场景使用。 */
    const publicDispose = scope.dispose()
    await Promise.resolve()
    expect(finished).toBe(false)
    gate.resolve(undefined)
    await Promise.all([raw, publicDispose, scope.dispose()])
    expect(finished).toBe(true)
  })

  it('exposes the exact raw disposer for ordered composite teardown', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = new Context()
    /** 中文说明：测试局部值 order，由紧邻初始化决定，仅在当前场景使用。 */
    const order: string[] = []
    /** 中文说明：测试局部值 dispose，由紧邻初始化决定，仅在当前场景使用。 */
    let dispose!: () => Promise<void> | void
    await ctx.plugin((inner: Context) => {
      dispose = inner.effect(function* () {
        yield () => void order.push('outer')
        /** 中文说明：测试局部值 scope，由紧邻初始化决定，仅在当前场景使用。 */
        const scope = createScope(inner, { name: 'nested' })
        scope.ctx.effect(() => () => void order.push('scope'))
        yield scope.rawDispose
        yield () => void order.push('inner')
      })
    })
    await dispose()
    expect(order).toEqual(['inner', 'scope', 'outer'])
  })
})

describe('scopeTarget', () => {
  it('routes scoped listeners by key while untagged listeners remain global', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = new Context()
    /** 中文说明：测试局部值 keyA，由紧邻初始化决定，仅在当前场景使用。 */
    const keyA = { name: 'A' }
    /** 中文说明：测试局部值 keyB，由紧邻初始化决定，仅在当前场景使用。 */
    const keyB = { name: 'B' }
    /** 中文说明：测试局部值 scopeA，由紧邻初始化决定，仅在当前场景使用。 */
    const scopeA = await mintScope(ctx, keyA)
    /** 中文说明：测试局部值 scopeB，由紧邻初始化决定，仅在当前场景使用。 */
    const scopeB = await mintScope(ctx, keyB)
    /** 中文说明：测试局部值 heard，由紧邻初始化决定，仅在当前场景使用。 */
    const heard: string[] = []
    ctx.on('scope-test/ping', value => void heard.push(`global:${value}`))
    scopeA.ctx.on('scope-test/ping', value => void heard.push(`A:${value}`))
    scopeB.ctx.on('scope-test/ping', value => void heard.push(`B:${value}`))

    ctx.emit(scopeTarget(ctx, keyA), 'scope-test/ping', 'a')
    ctx.emit(scopeTarget(ctx, keyB), 'scope-test/ping', 'b')
    ctx.emit(scopeTarget(ctx, undefined), 'scope-test/ping', 'none')

    expect(heard).toEqual(['global:a', 'A:a', 'global:b', 'B:b', 'global:none'])
    await Promise.all([scopeA.dispose(), scopeB.dispose()])
  })

  it('preserves a base Cordis filter and its receiver', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = new Context()
    /** 中文说明：测试局部值 key，由紧邻初始化决定，仅在当前场景使用。 */
    const key = { name: 'A' }
    /** 中文说明：测试局部值 scope，由紧邻初始化决定，仅在当前场景使用。 */
    const scope = await mintScope(ctx, key)
    /** 中文说明：测试局部值 heard，由紧邻初始化决定，仅在当前场景使用。 */
    const heard: string[] = []
    ctx.on('scope-test/ping', value => void heard.push(`global:${value}`))
    scope.ctx.on('scope-test/ping', value => void heard.push(`A:${value}`))
    /** 中文说明：测试局部值 receiverMatches，由紧邻初始化决定，仅在当前场景使用。 */
    let receiverMatches = false
    /** 中文说明：测试局部值 base，由紧邻初始化决定，仅在当前场景使用。 */
    const base = {
      [Context.filter](this: object): boolean {
        receiverMatches = this === base
        return false
      },
    }

    ctx.emit(scopeTarget(base, key), 'scope-test/ping', 'vetoed')
    expect(heard).toEqual([])
    expect(receiverMatches).toBe(true)
    await scope.dispose()
  })

  it('{ global: true } listeners retain Cordis global-listener semantics', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = new Context()
    /** 中文说明：测试局部值 scope，由紧邻初始化决定，仅在当前场景使用。 */
    const scope = await mintScope(ctx, { name: 'A' })
    /** 中文说明：测试局部值 heard，由紧邻初始化决定，仅在当前场景使用。 */
    const heard: string[] = []
    scope.ctx.on('scope-test/ping', value => void heard.push(value), { global: true })
    ctx.emit(scopeTarget(ctx, { name: 'other' }), 'scope-test/ping', 'foreign')
    ctx.emit(scopeTarget(ctx, undefined), 'scope-test/ping', 'none')
    expect(heard).toEqual(['foreign', 'none'])
    await scope.dispose()
  })

  it('uses an opaque branded carrier with a separately tracked key', () => {
    /** 中文说明：测试局部值 key，由紧邻初始化决定，仅在当前场景使用。 */
    const key = { name: 'key' }
    /** 中文说明：测试局部值 subject，由紧邻初始化决定，仅在当前场景使用。 */
    const subject = { value: 1 }
    /** 中文说明：测试局部值 carrier，由紧邻初始化决定，仅在当前场景使用。 */
    const carrier = scopeTarget(subject, key)
    expect(isScopeCarrier(carrier)).toBe(true)
    expect(carrierKeyOf(carrier)).toBe(key)
    expect(isScopeCarrier(subject)).toBe(false)
    expect(carrierKeyOf(subject)).toBeUndefined()
    expect('value' in carrier).toBe(false)
    expectTypeOf(carrier).toEqualTypeOf<Scoped<typeof subject>>()
  })
})

describe('scope parent chain', () => {
  it('links at mint, walks to the root, and rejects cycles', () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = new Context()
    /** 中文说明：测试局部值 preset，由紧邻初始化决定，仅在当前场景使用。 */
    const preset = { kind: 'preset' }
    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = { kind: 'agent' }
    createScope(ctx, preset)
    createScope(ctx, agent, { parent: preset })

    expect(scopeParentOf(agent)).toBe(preset)
    expect(scopeParentOf(preset)).toBeUndefined()
    expect(scopeChainOf(agent)).toEqual([agent, preset])
    expect(scopeChainOf(undefined)).toEqual([])
    expect(() => { bindScopeParent(preset, agent) }).toThrow(/cycle/)
    expect(() => { bindScopeParent(preset, preset) }).toThrow(/cycle/)
  })

  it('re-links only through the binding held by the original binder', () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = new Context()
    /** 中文说明：测试局部值 presetA，由紧邻初始化决定，仅在当前场景使用。 */
    const presetA = { id: 'a' }
    /** 中文说明：测试局部值 presetB，由紧邻初始化决定，仅在当前场景使用。 */
    const presetB = { id: 'b' }
    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = { id: 'agent' }
    createScope(ctx, presetA)
    createScope(ctx, presetB)
    /** 中文说明：测试局部值 binding，由紧邻初始化决定，仅在当前场景使用。 */
    const binding = bindScopeParent(agent, presetA)
    createScope(ctx, agent)

    // A bound key cannot be re-bound from the outside; only the binding moves it.
    expect(() => bindScopeParent(agent, presetB)).toThrow(/already bound/)
    binding.rebind(presetB)

    expect(scopeChainOf(agent)).toEqual([agent, presetB])
    // The rebind keeps the cycle check: a parent may not adopt its ancestor.
    /** 中文说明：测试局部值 child，由紧邻初始化决定，仅在当前场景使用。 */
    const child = { id: 'child' }
    /** 中文说明：测试局部值 childBinding，由紧邻初始化决定，仅在当前场景使用。 */
    const childBinding = bindScopeParent(child, agent)
    void childBinding
    expect(() => { binding.rebind(child) }).toThrow(/cycle/)
  })

  it('admits an ancestor-tagged listener for a descendant dispatch, never the reverse', () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = new Context()
    /** 中文说明：测试局部值 preset，由紧邻初始化决定，仅在当前场景使用。 */
    const preset = { kind: 'preset' }
    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = { kind: 'agent' }
    /** 中文说明：测试局部值 other，由紧邻初始化决定，仅在当前场景使用。 */
    const other = { kind: 'other-preset' }
    /** 中文说明：测试局部值 presetScope，由紧邻初始化决定，仅在当前场景使用。 */
    const presetScope = createScope(ctx, preset)
    /** 中文说明：测试局部值 agentScope，由紧邻初始化决定，仅在当前场景使用。 */
    const agentScope = createScope(ctx, agent, { parent: preset })
    /** 中文说明：测试局部值 otherScope，由紧邻初始化决定，仅在当前场景使用。 */
    const otherScope = createScope(ctx, other)

    /** 中文说明：测试局部值 seen，由紧邻初始化决定，仅在当前场景使用。 */
    const seen: string[] = []
    ctx.on('probe/event' as never, ((): void => { seen.push('untagged') }) as never)
    presetScope.ctx.on('probe/event' as never, ((): void => { seen.push('preset') }) as never)
    agentScope.ctx.on('probe/event' as never, ((): void => { seen.push('agent') }) as never)
    otherScope.ctx.on('probe/event' as never, ((): void => { seen.push('other') }) as never)

    /** 中文说明：测试局部值 emit，由紧邻初始化决定，仅在当前场景使用。 */
    const emit = ctx as unknown as { emit: (carrier: object, type: string) => void }
    // Dispatch at the AGENT key: its own tag and its ancestor's admit; a
    // sibling root does not.
    emit.emit(scopeTarget({}, agent), 'probe/event')
    expect(seen.sort()).toEqual(['agent', 'preset', 'untagged'])

    // Dispatch at the PRESET key: the agent-tagged listener sits BELOW the
    // dispatch key and stays excluded — events flow up the chain, not down.
    seen.length = 0
    emit.emit(scopeTarget({}, preset), 'probe/event')
    expect(seen.sort()).toEqual(['preset', 'untagged'])
  })
})
