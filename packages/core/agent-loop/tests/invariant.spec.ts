/**
 * 文件职责：验证Agent Loop的 invariant.spec.ts 行为与不变量。
 * 技术维度：Vitest、Cordis、会话事件、模型适配器和可控工具夹具。
 * 产品维度：防止Agent Loop在取消、恢复、错误或并发场景中产生回归。
 * 逻辑维度：构造服务与事件，驱动执行流程，再断言日志、请求、状态和清理。
 * 关键边界：测试后台任务必须结束；模型可见输入必须可从日志重建；工具调用顺序不可破坏。
 * 新手阅读建议：先读 mock/辅助函数，再按成功、错误、恢复和生命周期场景阅读。
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as AgentLoopInvariant from '@deepseek-ai/dsh-agent-loop/invariant'
import { createUserMessage, markAgentLoopRequest, type GenerateOptions  } from '@deepseek-ai/dsh-llm'

/** 中文说明：测试辅助函数 setup 的参数见签名，返回值用于驱动或断言场景；示例见下方用例。 */
async function setup(): Promise<Context> {
  /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(InvariantRegistry)
  await ctx.plugin(AgentLoopInvariant)
  return ctx
}

/** 中文说明：测试辅助函数 dispatch 的参数见签名，返回值用于驱动或断言场景；示例见下方用例。 */
function dispatch(ctx: Context, options: unknown): void {
  void ctx.waterfall('llm/stream', options as never, () => (async function* () {})() as never)
}

/** 中文说明：测试辅助函数 loopRequest 的参数见签名，返回值用于驱动或断言场景；示例见下方用例。 */
function loopRequest<T extends object>(options: T): Readonly<T> {
  markAgentLoopRequest(options as GenerateOptions)
  return Object.freeze(options)
}

/** 中文说明：测试辅助函数 requestSetup 的参数见签名，返回值用于驱动或断言场景；示例见下方用例。 */
async function requestSetup() {
  /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
  const ctx = await setup()
  /** 中文说明：测试局部值 session，由紧邻初始化决定，仅在当前场景使用。 */
  const session = ctx.sessions.create(SessionId('req-check'))
  session.append('turn/start', { turn: 1 })
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: 'hi' }], source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  /** 中文说明：测试局部值 boundary，由紧邻初始化决定，仅在当前场景使用。 */
  const boundary = session.deriveMessages()
  session.append('step/start', { turn: 1, step: 1 })
  session.append('request/header', { header: { config: { provider: 'mock', model: 'm' } }, reason: 'initial' })
  return { ctx, session, boundary }
}

describe('request-reconstruction invariant', () => {
  it('accepts a frozen request equal to the boundary derivation and folded header', async () => {
    /** 中文说明：测试局部值 解构结果，由紧邻初始化决定，仅在当前场景使用。 */
    const { ctx, session, boundary } = await requestSetup()
    /** 中文说明：测试局部值 options，由紧邻初始化决定，仅在当前场景使用。 */
    const options = loopRequest({ model: 'm', messages: Object.freeze(boundary), sessionId: session.id })
    expect(() => { dispatch(ctx, options) }).not.toThrow()
  })

  it('includes context appended inside the open step before dispatch', async () => {
    /** 中文说明：测试局部值 { ctx, session }，由紧邻初始化决定，仅在当前场景使用。 */
    const { ctx, session } = await requestSetup()
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: '[step context]' }], source: { kind: 'plugin', plugin: 'x' },
    }), { surfaceOp: 'append' })
    /** 中文说明：测试局部值 options，由紧邻初始化决定，仅在当前场景使用。 */
    const options = loopRequest({
      model: 'm',
      messages: Object.freeze(session.deriveMessages()),
      sessionId: session.id,
    })
    expect(() => { dispatch(ctx, options) }).not.toThrow()
  })

  it('requires the messages to equal the boundary derivation exactly (no unlogged prefix)', async () => {
    /** 中文说明：测试局部值 解构结果，由紧邻初始化决定，仅在当前场景使用。 */
    const { ctx, session, boundary } = await requestSetup()
    /** 中文说明：测试局部值 extra，由紧邻初始化决定，仅在当前场景使用。 */
    const extra = { role: 'user' as const, content: [{ type: 'text' as const, text: '<system-reminder>catalog</system-reminder>' }] }
    expect(() => { dispatch(ctx, loopRequest({ model: 'm', messages: Object.freeze([...boundary]), sessionId: session.id })) })
      .not.toThrow()
    expect(() => { dispatch(ctx, loopRequest({ model: 'm', messages: Object.freeze([extra, ...boundary]), sessionId: session.id })) })
      .toThrow(/diverges from the dispatch-time durable derivation/)
    expect(() => { dispatch(ctx, loopRequest({ model: 'm', messages: Object.freeze([...boundary, extra]), sessionId: session.id })) })
      .toThrow(/diverges from the dispatch-time durable derivation/)
  })

  it('rejects message and header divergence', async () => {
    /** 中文说明：测试局部值 解构结果，由紧邻初始化决定，仅在当前场景使用。 */
    const { ctx, session, boundary } = await requestSetup()
    /** 中文说明：测试局部值 divergent，由紧邻初始化决定，仅在当前场景使用。 */
    const divergent = [...boundary, { role: 'user', content: [{ type: 'text', text: 'phantom' }] }]
    expect(() => { dispatch(ctx, loopRequest({ model: 'm', messages: Object.freeze(divergent), sessionId: session.id })) })
      .toThrow(/diverges from the dispatch-time durable derivation/)
    expect(() => { dispatch(ctx, loopRequest({ model: 'other', messages: Object.freeze(boundary), sessionId: session.id })) })
      .toThrow(/diverges from the folded request header/)
  })

  it('rejects loop requests with no boundary or header', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await setup()
    /** 中文说明：测试局部值 session，由紧邻初始化决定，仅在当前场景使用。 */
    const session = ctx.sessions.create(SessionId('req-bare'))
    session.append('turn/start', { turn: 1 })
    /** 中文说明：测试局部值 bare，由紧邻初始化决定，仅在当前场景使用。 */
    const bare = loopRequest({ model: 'm', messages: Object.freeze([]), sessionId: session.id })
    expect(() => { dispatch(ctx, bare) }).toThrow(/no step\/start/)
    session.append('step/start', { turn: 1, step: 1 })
    expect(() => { dispatch(ctx, bare) }).toThrow(/no request\/header event/)
  })

  it('rejects an unfrozen messages array but skips requests outside the loop contract', async () => {
    /** 中文说明：测试局部值 解构结果，由紧邻初始化决定，仅在当前场景使用。 */
    const { ctx, session, boundary } = await requestSetup()
    expect(() => { dispatch(ctx, loopRequest({ model: 'm', messages: [...boundary], sessionId: session.id })) })
      .toThrow(/frozen messages array/)
    expect(() => { dispatch(ctx, { model: 'summarizer', messages: [], sessionId: session.id }) }).not.toThrow()
    expect(() => { dispatch(ctx, Object.freeze({ model: 'm', messages: Object.freeze([]) })) }).not.toThrow()
    expect(() => { dispatch(ctx, Object.freeze({ model: 'm', messages: Object.freeze([]), sessionId: SessionId('ghost') })) })
      .not.toThrow()

    /** 中文说明：测试局部值 directSession，由紧邻初始化决定，仅在当前场景使用。 */
    const directSession = ctx.sessions.create(SessionId('direct-one-shot'))
    expect(() => {
      dispatch(ctx, Object.freeze({ model: 'one-shot', messages: Object.freeze([]), sessionId: directSession.id }))
    }).not.toThrow()
  })

  it('rejects malformed requests carrying the loop marker', async () => {
    /** 中文说明：测试局部值 { ctx, session }，由紧邻初始化决定，仅在当前场景使用。 */
    const { ctx, session } = await requestSetup()
    /** 中文说明：测试局部值 messages，由紧邻初始化决定，仅在当前场景使用。 */
    const messages: GenerateOptions['messages'] = []
    Object.freeze(messages)
    expect(() => {
      dispatch(ctx, markAgentLoopRequest({ provider: 'p', model: 'm', messages, sessionId: session.id }))
    }).toThrow(/request must be frozen/)
    expect(() => {
      dispatch(ctx, loopRequest({ model: 'm', messages: Object.freeze([]) }))
    }).toThrow(/carry a session id/)
    expect(() => {
      dispatch(ctx, loopRequest({
        model: 'm',
        messages: Object.freeze([]),
        sessionId: SessionId('missing-loop-session'),
      }))
    }).toThrow(/live session id/)
  })

  it('prepends ahead of a short-circuiting stream listener', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    ctx.on('llm/stream', () => (async function* () {})() as never)
    await ctx.plugin(InvariantRegistry)
    await ctx.plugin(AgentLoopInvariant)
    /** 中文说明：测试局部值 session，由紧邻初始化决定，仅在当前场景使用。 */
    const session = ctx.sessions.create(SessionId('prepend-check'))
    session.append('turn/start', { turn: 1 })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'hi' }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    session.append('step/start', { turn: 1, step: 1 })
    session.append('request/header', { header: { config: { provider: 'mock', model: 'm' } }, reason: 'initial' })
    /** 中文说明：测试局部值 divergent，由紧邻初始化决定，仅在当前场景使用。 */
    const divergent = loopRequest({
      model: 'm',
      messages: Object.freeze([{ role: 'user', content: [{ type: 'text', text: 'phantom' }] }]),
      sessionId: session.id,
    })
    expect(() => { dispatch(ctx, divergent) }).toThrow(/diverges from the dispatch-time durable derivation/)
  })
})
