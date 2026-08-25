/**
 * 文件职责：验证Session 持久状态的 scoped.spec.ts 行为与边界。
 * 技术维度：TypeScript、Cordis、Vitest、会话事件、JSON 模式和服务作用域。
 * 产品维度：保证Session 持久状态在配置、错误、恢复和生命周期场景中可靠。
 * 逻辑维度：构造输入并驱动服务，再断言输出、日志和清理。
 * 关键边界：持久与凭据数据属于不可信边界；工具和提示词必须保持模型可见内容可重建。
 * 新手阅读建议：先读类型和夹具，再按正常、非法输入、作用域和清理场景阅读。
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createScope, scopeOf } from '@deepseek-ai/dsh-scope'
import type { Scope, ScopeKey } from '@deepseek-ai/dsh-scope'
import SessionStore from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'

/** 中文说明：函数 mount 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
async function mount(): Promise<Context> {
  /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  return ctx
}

/** 中文说明：函数 mintScope 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
async function mintScope(ctx: Context, name: string): Promise<Scope> {
  /** 中文说明：测试局部值 scope!: Scope，由紧邻初始化决定。 */
  let scope!: Scope
  // The scoped context resolves services through the MINTING plugin's
  // dependency chain — the minter must inject what scope holders will reach.
  await ctx.plugin(Object.assign((inner: Context) => { scope = createScope(inner, { name }) },
    { inject: ['sessions'] }))
  return scope
}

/** The key a test scope was minted with. */
/* 中文说明：函数 keyOf 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function keyOf(scope: Scope): ScopeKey {

  return scopeOf(scope.ctx)!
}

describe('session dispatch carriers', () => {
  it('a session entered through a scoped context dispatches its events in that scope', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await mount()
    /** 中文说明：测试局部值 scope，由紧邻初始化决定。 */
    const scope = await mintScope(ctx, 'owner')
    /** 中文说明：测试局部值 otherScope，由紧邻初始化决定。 */
    const otherScope = await mintScope(ctx, 'other')

    /** 中文说明：测试局部值 heard，由紧邻初始化决定。 */
    const heard: string[] = []
    ctx.on('session/event', (_session, event) => void heard.push(`global:${event.type}`))
    scope.ctx.on('session/event', (_session, event) => void heard.push(`owner:${event.type}`))
    otherScope.ctx.on('session/event', (_session, event) => void heard.push(`other:${event.type}`))
    scope.ctx.on('session/created', session => void heard.push(`owner-created:${session.id}`))
    otherScope.ctx.on('session/created', session => void heard.push(`other-created:${session.id}`))

    /** 中文说明：测试局部值 session，由紧邻初始化决定。 */
    const session = scope.ctx.sessions.create()
    session.append('turn/start', { turn: 1 })

    expect(heard).toEqual([
      `owner-created:${session.id}`,
      'global:turn/start',
      'owner:turn/start',
    ])
  })

  it('a bare session dispatches subject-less: scoped listeners never hear it', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await mount()
    /** 中文说明：测试局部值 scope，由紧邻初始化决定。 */
    const scope = await mintScope(ctx, 'owner')
    /** 中文说明：测试局部值 heard，由紧邻初始化决定。 */
    const heard: string[] = []
    ctx.on('session/event', (_s, event) => void heard.push(`global:${event.type}`))
    scope.ctx.on('session/event', (_s, event) => void heard.push(`owner:${event.type}`))

    /** 中文说明：测试局部值 bare，由紧邻初始化决定。 */
    const bare = ctx.sessions.create()
    bare.append('turn/start', { turn: 1 })
    expect(heard).toEqual(['global:turn/start'])
  })

  it('reuses the captured owner carrier for the paired disposal notification', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await mount()
    /** 中文说明：测试局部值 owner，由紧邻初始化决定。 */
    const owner = await mintScope(ctx, 'owner')
    /** 中文说明：测试局部值 other，由紧邻初始化决定。 */
    const other = await mintScope(ctx, 'other')
    /** 中文说明：测试局部值 heard，由紧邻初始化决定。 */
    const heard: string[] = []
    ctx.on('session/disposed', (session) => { heard.push(`global:${session.id}`) })
    owner.ctx.on('session/disposed', (session) => { heard.push(`owner:${session.id}`) })
    other.ctx.on('session/disposed', (session) => { heard.push(`other:${session.id}`) })

    /** 中文说明：测试局部值 session，由紧邻初始化决定。 */
    const session = owner.ctx.sessions.prepare()
    /** 中文说明：测试局部值 detach，由紧邻初始化决定。 */
    const detach = owner.ctx.sessions.enter(session)
    owner.ctx.sessions.announce(session)
    detach()

    expect(heard).toEqual([`global:${session.id}`, `owner:${session.id}`])
  })
})

describe('sessions.flush()', () => {
  it('allows an ordinary flush with no listeners', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await mount()
    /** 中文说明：测试局部值 session，由紧邻初始化决定。 */
    const session = ctx.sessions.create()

    await expect(ctx.sessions.flush(session)).resolves.toBe(false)
  })

  it('reports a participating listener after it succeeds', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await mount()
    /** 中文说明：测试局部值 session，由紧邻初始化决定。 */
    const session = ctx.sessions.create()
    /** 中文说明：测试局部值 flushed，由紧邻初始化决定。 */
    const flushed: Session[] = []
    ctx.on('session/flush', current => void flushed.push(current))

    await expect(ctx.sessions.flush(session)).resolves.toBe(true)

    expect(flushed).toEqual([session])
  })

  it('dispatches session/flush with the owning carrier and awaits all listeners', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await mount()
    /** 中文说明：测试局部值 scope，由紧邻初始化决定。 */
    const scope = await mintScope(ctx, 'owner')
    /** 中文说明：测试局部值 flushed，由紧邻初始化决定。 */
    const flushed: string[] = []
    ctx.on('session/flush', async (session: Session) => {
      await Promise.resolve()
      flushed.push(`global:${session.id}`)
    })
    scope.ctx.on('session/flush', (session: Session) => void flushed.push(`owner:${session.id}`))

    /** 中文说明：测试局部值 owned，由紧邻初始化决定。 */
    const owned = scope.ctx.sessions.create()
    /** 中文说明：测试局部值 bare，由紧邻初始化决定。 */
    const bare = ctx.sessions.create()
    await ctx.sessions.flush(owned)
    await ctx.sessions.flush(bare)

    // Parallel dispatch: listener completion order is unspecified (the global
    // listener awaits a microtask) — assert set membership per flush instead.
    expect(flushed.slice(0, 2).sort()).toEqual([`global:${owned.id}`, `owner:${owned.id}`])
    expect(flushed.slice(2)).toEqual([`global:${bare.id}`])
  })

  it('propagates a rejecting flush listener (the caller owns the failure policy)', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await mount()
    ctx.on('session/flush', () => Promise.reject(new Error('disk full')))
    /** 中文说明：测试局部值 session，由紧邻初始化决定。 */
    const session = ctx.sessions.create()
    await expect(ctx.sessions.flush(session)).rejects.toThrow('disk full')
  })

  it('does not let a synchronous flush failure starve later listeners', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await mount()
    /** 中文说明：测试局部值 flushed，由紧邻初始化决定。 */
    const flushed: Session[] = []
    ctx.on('session/flush', () => { throw new Error('disk full') })
    ctx.on('session/flush', (session) => { flushed.push(session) })
    /** 中文说明：测试局部值 session，由紧邻初始化决定。 */
    const session = ctx.sessions.create()

    await expect(ctx.sessions.flush(session)).rejects.toThrow('disk full')
    expect(flushed).toEqual([session])
  })

  it('waits for slower flush listeners before reporting another listener failure', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await mount()
    /** 中文说明：测试局部值 gate，由紧邻初始化决定。 */
    const gate = Promise.withResolvers<undefined>()
    /** 中文说明：测试局部值 slowStarted，由紧邻初始化决定。 */
    let slowStarted = false
    /** 中文说明：测试局部值 settled，由紧邻初始化决定。 */
    let settled = false
    ctx.on('session/flush', () => Promise.reject(new Error('disk full')))
    ctx.on('session/flush', () => {
      slowStarted = true
      return gate.promise
    })
    /** 中文说明：测试局部值 session，由紧邻初始化决定。 */
    const session = ctx.sessions.create()

    /** 中文说明：测试局部值 flushing，由紧邻初始化决定。 */
    const flushing = ctx.sessions.flush(session)
    void flushing.finally(() => { settled = true }).catch(() => undefined)
    await Promise.resolve()
    expect(slowStarted).toBe(true)
    expect(settled).toBe(false)

    gate.resolve(undefined)
    await expect(flushing).rejects.toThrow('disk full')
    expect(settled).toBe(true)
  })

  it('rejects a never-entered session instead of inventing a carrier', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await mount()
    /** 中文说明：测试局部值 scope，由紧邻初始化决定。 */
    const scope = await mintScope(ctx, 'owner')
    /** 中文说明：测试局部值 flushed，由紧邻初始化决定。 */
    const flushed: string[] = []
    ctx.on('session/flush', (session: Session) => void flushed.push(`global:${session.id}`))
    scope.ctx.on('session/flush', (session: Session) => void flushed.push(`owner:${session.id}`))

    /** 中文说明：测试局部值 prepared，由紧邻初始化决定。 */
    const prepared = ctx.sessions.prepare()
    await expect(ctx.sessions.flush(prepared)).rejects.toThrow(/not live/)
    expect(flushed).toEqual([])
  })

  it('clears a detached carrier and rejects stale flushes', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await mount()
    /** 中文说明：测试局部值 scope，由紧邻初始化决定。 */
    const scope = await mintScope(ctx, 'owner')
    /** 中文说明：测试局部值 flushed，由紧邻初始化决定。 */
    const flushed: string[] = []
    ctx.on('session/flush', (session: Session) => void flushed.push(`global:${session.id}`))
    scope.ctx.on('session/flush', (session: Session) => void flushed.push(`owner:${session.id}`))

    /** 中文说明：测试局部值 session，由紧邻初始化决定。 */
    const session = scope.ctx.sessions.prepare()
    /** 中文说明：测试局部值 detach，由紧邻初始化决定。 */
    const detach = scope.ctx.sessions.enter(session)
    await ctx.sessions.flush(session)
    expect(flushed.sort()).toEqual([`global:${session.id}`, `owner:${session.id}`])

    detach()
    await expect(ctx.sessions.flush(session)).rejects.toThrow(/not live/)
    expect(flushed).toHaveLength(2)
  })

  it('keyOf sanity: distinct scopes carry distinct keys', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await mount()
    /** 中文说明：测试局部值 a，由紧邻初始化决定。 */
    const a = await mintScope(ctx, 'a')
    /** 中文说明：测试局部值 b，由紧邻初始化决定。 */
    const b = await mintScope(ctx, 'b')
    expect(keyOf(a)).not.toBe(keyOf(b))
  })
})
