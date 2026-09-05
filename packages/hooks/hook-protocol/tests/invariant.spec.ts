/**
 * 文件职责：验证Hook 线协议的 invariant.spec.ts 行为与边界。
 * 技术维度：TypeScript、Cordis、JSON 编解码、子进程、事件匹配和严格联合类型。
 * 产品维度：保证Hook 线协议可预测地传递事件、限制循环或适配外部工具。
 * 逻辑维度：构造事件与配置，驱动入口并断言结果。
 * 关键边界：线协议输入必须校验；外部 Hook 失败不得破坏会话日志或核心循环。
 * 新手阅读建议：先读 types/events，再看 codec/matcher/runner，最后阅读桥接配置。
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { Session, SessionId, SessionSeq } from '@deepseek-ai/dsh-session'
import * as HookInvariant from '@deepseek-ai/dsh-hook-protocol/invariant'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'

/** 中文说明：函数 setup 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
async function setup(): Promise<Context> {
  /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(InvariantRegistry)
  await ctx.plugin(HookInvariant)
  return ctx
}

/** 中文说明：测试局部值 invoked，由紧邻初始化决定。 */
const invoked = (overrides: Record<string, unknown> = {}) => ({
  turn: 1,
  point: 'PreToolUse',
  dialect: 'claude-code' as const,
  handlerId: 'hook-1',
  ...overrides,
})

/** 中文说明：测试局部值 result，由紧邻初始化决定。 */
const result = (overrides: Record<string, unknown> = {}) => ({
  turn: 1,
  point: 'PreToolUse',
  handlerId: 'hook-1',
  decision: 'pass',
  durationMs: 3,
  ...overrides,
})

/** 中文说明：函数 startTurn 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function startTurn(session: Session, turn = 1): void {
  session.append('turn/start', { turn })
}

describe('hook-protocol invariants', () => {
  it('pairs serial and repeated handler invocations', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()
    /** 中文说明：测试局部值 session，由紧邻初始化决定。 */
    const session = ctx.sessions.create()
    startTurn(session)
    session.append('hook/invoked', invoked())
    session.append('hook/invoked', invoked())
    session.append('step/start', { turn: 1, step: 1 })
    session.append('hook/result', result())
    session.append('hook/result', result())
  })

  it('rebuilds pending hook invocations from an existing session', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    /** 中文说明：测试局部值 session，由紧邻初始化决定。 */
    const session = ctx.sessions.create()
    session.append('turn/start', { turn: 1 })
    session.append('hook/invoked', invoked())
    await ctx.plugin(InvariantRegistry)
    await ctx.plugin(HookInvariant)
    expect(() => session.append('hook/result', result())).not.toThrow()
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  })

  it('adopts a bare session first observed through publication', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()
    /** 中文说明：测试局部值 session，由紧邻初始化决定。 */
    const session = Session.create(SessionId('bare-hook-session'))
    expect(() => {
      ctx.emit('session/event', session, {
        type: 'turn/start', seq: SessionSeq(0), time: 0,
        data: { turn: 1 },
      })
      ctx.emit('session/event', session, {
        type: 'hook/invoked', seq: SessionSeq(1), time: 1, data: invoked(),
      })
      ctx.emit('session/event', session, {
        type: 'hook/result', seq: SessionSeq(2), time: 2, data: result(),
      })
    }).not.toThrow()
  })

  it('rejects hook events outside or for a different open turn', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()
    /** 中文说明：测试局部值 session，由紧邻初始化决定。 */
    const session = ctx.sessions.create()
    expect(() => session.append('hook/invoked', invoked())).toThrow(/outside any open turn/)
    startTurn(session)
    expect(() => session.append('hook/invoked', invoked({ turn: 2 }))).toThrow(/but open turn is 1/)
  })

  it('rejects an unenclosed hook event when replaying an existing session', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    /** 中文说明：测试局部值 session，由紧邻初始化决定。 */
    const session = ctx.sessions.create()
    startTurn(session)
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    session.append('hook/invoked', invoked())
    await ctx.plugin(InvariantRegistry)
    await expect(ctx.plugin(HookInvariant).then(() => undefined)).rejects.toThrow(/outside any open turn/)
  })

  it.each([
    [invoked({ point: '' }), /point and handlerId must be non-empty/],
    [invoked({ handlerId: '' }), /point and handlerId must be non-empty/],
    [invoked({ dialect: 'other' }), /unknown dialect/],
  ])('rejects malformed hook invocation %#', async (data, message) => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()
    /** 中文说明：测试局部值 session，由紧邻初始化决定。 */
    const session = ctx.sessions.create()
    startTurn(session)
    expect(() => session.append('hook/invoked', data as never)).toThrow(message)
  })

  it('rejects unmatched and malformed results', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()
    /** 中文说明：测试局部值 session，由紧邻初始化决定。 */
    const session = ctx.sessions.create()
    startTurn(session)
    expect(() => session.append('hook/result', result())).toThrow(/no matching hook\/invoked/)
    session.append('hook/invoked', invoked())
    expect(() => session.append('hook/result', result({ durationMs: -1 })))
      .toThrow(/durationMs must be a non-negative finite number/)
    expect(() => session.append('hook/result', result({ point: 'Stop' })))
      .toThrow(/no matching hook\/invoked/)
  })
})
