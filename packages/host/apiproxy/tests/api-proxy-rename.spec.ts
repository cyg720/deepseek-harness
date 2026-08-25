/**
 * sessions.rename delegation through the composed SessionTitleService. The
 * agent factory is a structural stub whose createAgent forwards seed/meta into
 * the real SessionStore, and whose resume never runs (every source here is
 * already attached). Cold-session resolution is the shared `agentFor` path —
 * api-proxy-cold.spec.ts owns the resume evidence for every unary that rides
 * it, rename included.
 */
/**
 * 文件职责：验证Host API Proxy的 api-proxy-rename.spec.ts 行为与边界。
 * 技术维度：TypeScript、Cordis、Fetch/RPC 信封、运行时模式校验、Node/Windows 宿主接口。
 * 产品维度：保证浏览器 API、Hook 或目录操作在各种状态下可靠且可诊断。
 * 逻辑维度：构造请求与宿主服务，调用端点并断言响应和清理。
 * 关键边界：网络与路径输入必须校验；原生对话框和宿主路径操作只允许受信调用。
 * 新手阅读建议：先读请求/响应夹具，再按 API 域、错误码和生命周期场景阅读。
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore from '@deepseek-ai/dsh-session'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent, AgentHandle, CreateAgentOptions } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionTitleService from '@deepseek-ai/dsh-session-title'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import type { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { RpcRequest } from '@deepseek-ai/dsh-host-apiproxy/api/rpc'
import { RpcId } from '@deepseek-ai/dsh-host-apiproxy/api/rpc'
import { createApiProxy } from '@deepseek-ai/dsh-host-apiproxy'

/** 中文说明：测试局部值 sid，由紧邻初始化决定。 */
const sid = (id: string): SessionId => id as SessionId

/** 中文说明：测试局部值 nextRpc，由紧邻初始化决定。 */
let nextRpc = 1
/** 中文说明：函数 request 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function request<P>(payload: P): RpcRequest<P> {
  return { rpcId: RpcId(`fr-${String(nextRpc++)}`), payload }
}

/** 中文说明：函数 composed 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
async function composed(withTitles = true): Promise<Context> {
  /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(UserQuestionService)
  if (withTitles) {
    await ctx.plugin(SessionTitleService, { fallbackMaxWords: 5, fallbackMaxBytes: 40, maxTitleBytes: 40 })
  }
  // Store-backed structural factory: create builds the session with the
  // forwarded seed/meta (the store validates the balanced prefix) and
  // registers an idle agent stub over it.
  ctx.agents.setFactory({
    createAgent: (ownerCtx: Context, options: CreateAgentOptions): Promise<AgentHandle> => {
      /** 中文说明：测试局部值 session，由紧邻初始化决定。 */
      const session = ctx.sessions.create(options.sessionId, {
        ...options.seed === undefined ? {} : { seed: [...options.seed] },
        ...options.meta === undefined ? {} : { meta: options.meta },
      })
      /** 中文说明：测试局部值 agent，由紧邻初始化决定。 */
      const agent = { id: session.id, session, status: 'idle', ctx: ownerCtx } as Agent
      ctx.agents.register(agent)
      return Promise.resolve({ agent, dispose: () => Promise.resolve() })
    },
    resume: () => Promise.reject(new Error('resume must not run: every source is attached')),
  })
  return ctx
}

/** Register one live agent whose log holds `turns` completed turns. */
/** 中文说明：函数 liveAgent 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function liveAgent(ctx: Context, id: string, turns: number): Session {
  /** 中文说明：测试局部值 session，由紧邻初始化决定。 */
  const session = ctx.sessions.create(sid(id), { meta: { cwd: '/proj' } })
  /** 中文说明：测试局部值 turn，由紧邻初始化决定。 */
  for (let turn = 1; turn <= turns; turn++) {
    session.append('turn/start', { turn })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: `prompt ${String(turn)}` }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    session.append('turn/end', { turn, reason: { kind: 'completed' } })
  }
  ctx.agents.register({ id: session.id, session, status: 'idle', ctx } as Agent)
  return session
}

/** 中文说明：测试局部值 api，由紧邻初始化决定。 */
const api = (ctx: Context) => createApiProxy(ctx, { defaultModelSelection: () => ({ provider: 'p', model: 'm' }), cwd: '/tmp' })

describe('sessions.rename', () => {
  it('accepts through the composed title service: normalized user-source event, echoed seq', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await composed()
    /** 中文说明：测试局部值 source，由紧邻初始化决定。 */
    const source = liveAgent(ctx, 'session-rename', 1)

    /** 中文说明：测试局部值 renamed，由紧邻初始化决定。 */
    const renamed = await api(ctx).sessions.rename(request({ sessionId: source.id, title: '  new   name  ' }))
    expect(renamed.result.ok).toBe(true)
    if (!renamed.result.ok) return
    expect(renamed.result.value.title).toBe('new name')
    /** 中文说明：测试局部值 event，由紧邻初始化决定。 */
    const event = source.events.findLast(item => item.type === 'session/title')
    expect(event?.seq).toBe(renamed.result.value.seq)
    expect(event?.data).toMatchObject({ title: 'new name', source: { kind: 'user' } })
  })

  it('maps only an empty-normalizing title to title-invalid, with a presentable message', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await composed()
    /** 中文说明：测试局部值 source，由紧邻初始化决定。 */
    const source = liveAgent(ctx, 'session-rename-bad', 1)

    // U+200B passes a client-side trim gate but normalizes to empty host-side.
    /** 中文说明：测试局部值 response，由紧邻初始化决定。 */
    const response = await api(ctx).sessions.rename(request({ sessionId: source.id, title: ' ​ ' }))
    expect(response.result.ok).toBe(false)
    if (!response.result.ok) {
      expect(response.result.error).toMatchObject({
        code: 'title-invalid',
        details: { sessionId: source.id },
      })
      // The message renders verbatim in the rename dialog's alert.
      expect(response.result.error.message).toBe('session title must contain visible characters')
    }
  })

  it('maps a non-validation rename failure (stale session object) to internal, not title-invalid', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await composed()
    // The registered agent holds a session object from another store: the
    // title service's liveness check throws a plain Error, which must not
    // read as the user's fault.
    /** 中文说明：测试局部值 foreign，由紧邻初始化决定。 */
    const foreign = await composed(false)
    /** 中文说明：测试局部值 stale，由紧邻初始化决定。 */
    const stale = liveAgent(foreign, 'session-rename-stale', 1)
    ctx.agents.register({ id: stale.id, session: stale, status: 'idle', ctx } as Agent)

    /** 中文说明：测试局部值 response，由紧邻初始化决定。 */
    const response = await api(ctx).sessions.rename(request({ sessionId: stale.id, title: 'name' }))
    expect(response.result.ok).toBe(false)
    if (!response.result.ok) expect(response.result.error.code).toBe('internal')
  })

  it('answers internal when the composition mounts no session-title service', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await composed(false)
    /** 中文说明：测试局部值 source，由紧邻初始化决定。 */
    const source = liveAgent(ctx, 'session-no-titles', 1)

    /** 中文说明：测试局部值 response，由紧邻初始化决定。 */
    const response = await api(ctx).sessions.rename(request({ sessionId: source.id, title: 'name' }))
    expect(response.result.ok).toBe(false)
    if (!response.result.ok) {
      expect(response.result.error.code).toBe('internal')
      expect(response.result.error.message).toMatch(/mounts no session-title service/)
    }
  })
})
