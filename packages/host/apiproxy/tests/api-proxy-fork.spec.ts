/** Session-fork boundaries, lineage, and inherited model routing. */
/*
 * 文件职责：验证Host API Proxy的 api-proxy-fork.spec.ts 行为与边界。
 * 技术维度：TypeScript、Cordis、Fetch/RPC 信封、运行时模式校验、Node/Windows 宿主接口。
 * 产品维度：保证浏览器 API、Hook 或目录操作在各种状态下可靠且可诊断。
 * 逻辑维度：构造请求与宿主服务，调用端点并断言响应和清理。
 * 关键边界：网络与路径输入必须校验；原生对话框和宿主路径操作只允许受信调用。
 * 新手阅读建议：先读请求/响应夹具，再按 API 域、错误码和生命周期场景阅读。
 */

import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { agentEvents } from '@deepseek-ai/dsh-agent'
import type { Agent, AgentHandle, CreateAgentOptions } from '@deepseek-ai/dsh-agent'
import { createUserMessage, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { LlmCallConfig } from '@deepseek-ai/dsh-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import type { Session, SessionEvent, SessionHeader, SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import type { Workspace } from '@deepseek-ai/dsh-workspace'
import type { RpcRequest } from '@deepseek-ai/dsh-host-apiproxy/api/rpc'
import { RpcId } from '@deepseek-ai/dsh-host-apiproxy/api/rpc'
import { createApiProxy } from '@deepseek-ai/dsh-host-apiproxy'

/** 中文说明：测试局部值 sid，由紧邻初始化决定。 */
const sid = (id: string): SessionId => id as SessionId

/** 中文说明：测试局部值 nextRpc，由紧邻初始化决定。 */
let nextRpc = 1
/** 中文说明：函数 request 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function request<P>(payload: P): RpcRequest<P> {
  return { rpcId: RpcId(`fork-${String(nextRpc++)}`), payload }
}

/** 中文说明：函数 composed 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
async function composed(workspaces: readonly Workspace[] = []): Promise<Context> {
  /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt, { persona: '' })
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(UserQuestionService)
  ctx.provide('workspaceRegistry', { list: () => workspaces } as never)
  ctx.agents.setFactory({
    createAgent: async (ownerCtx: Context, options: CreateAgentOptions): Promise<AgentHandle> => {
      /** 中文说明：测试局部值 session，由紧邻初始化决定。 */
      const session = ctx.sessions.create(options.sessionId, {
        ...options.seed === undefined ? {} : { seed: [...options.seed] },
        ...options.meta === undefined ? {} : { meta: options.meta },
      })
      /** 中文说明：测试局部值 agent，由紧邻初始化决定。 */
      const agent = {} as Agent
      /** 中文说明：测试局部值 agentCtx，由紧邻初始化决定。 */
      const agentCtx = ownerCtx.extend({ agent })
      Object.assign(agent, { id: session.id, session, status: 'idle', ctx: agentCtx })
      await options.setup?.(agentCtx)
      ctx.agents.register(agent)
      return { agent, dispose: () => Promise.resolve() }
    },
    resume: () => Promise.reject(new Error('fork test sources are live')),
  })
  return ctx
}

/** Tail turn appended after the completed ones: left open, or closed as aborted (a stopped turn). */
/* 中文说明：类型或类 Tail 约束 API、Hook 或目录数据职责。 */
type Tail = 'none' | 'open' | 'aborted'

/** 中文说明：函数 liveAgent 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function liveAgent(
  ctx: Context,
  id: string,
  turns: number,
  tail: Tail = 'none',
  lineage: { parentSession?: SessionId; origin?: 'subagent' } = {},
): Session {
  /** 中文说明：测试局部值 session，由紧邻初始化决定。 */
  const session = ctx.sessions.create(sid(id), { meta: { cwd: '/proj', ...lineage } })
  /** 中文说明：测试局部值 turn，由紧邻初始化决定。 */
  for (let turn = 1; turn <= turns; turn++) {
    session.append('turn/start', { turn })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: `prompt ${String(turn)}` }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    session.append('turn/end', { turn, reason: { kind: 'completed' } })
  }
  if (tail !== 'none') {
    session.append('turn/start', { turn: turns + 1 })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'open prompt' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    if (tail === 'aborted') session.append('turn/end', {
      turn: turns + 1,
      reason: { kind: 'aborted', reason: { kind: 'user' } },
    })
  }
  ctx.agents.register({ id: session.id, session, status: 'idle', ctx } as Agent)
  return session
}

/** 中文说明：测试局部值 api，由紧邻初始化决定。 */
const api = (ctx: Context) => createApiProxy(ctx, {
  defaultModelSelection: () => ({ provider: 'default-provider', model: 'default-model' }),
  cwd: '/tmp',
})

describe('sessions.fork', () => {
  it('cuts at the anchored completed turn and records lineage and cwd', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await composed()
    /** 中文说明：测试局部值 source，由紧邻初始化决定。 */
    const source = liveAgent(ctx, 'session-source', 2)
    /** 中文说明：测试局部值 response，由紧邻初始化决定。 */
    const response = await api(ctx).sessions.fork(request({ sessionId: source.id, atSeq: 1 }))
    expect(response.result.ok).toBe(true)
    if (!response.result.ok) return
    /** 中文说明：测试局部值 child，由紧邻初始化决定。 */
    const child = ctx.sessions.get(response.result.value.sessionId)
    expect(child?.events.map(event => event.type)).toEqual([
      'turn/start', 'user/message', 'turn/end', 'session/end-seed',
    ])
    expect(child?.header.parentSession).toBe(source.id)
    expect(child?.header.cwd).toBe('/proj')
    await ctx.fiber.dispose()
  })

  it('attaches a subagent fork to its nearest workspace-owning ancestor', async () => {
    /** 中文说明：测试局部值 accounted，由紧邻初始化决定。 */
    const accounted: SessionId[] = []
    /** 中文说明：测试局部值 attachSession，由紧邻初始化决定。 */
    const attachSession = vi.fn<(sessionId: SessionId) => Promise<void>>()
      .mockResolvedValue(undefined)
    /** 中文说明：测试局部值 workspace，由紧邻初始化决定。 */
    const workspace = {
      sessionIds: accounted,
      attachSession,
    } as unknown as Workspace
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await composed([workspace])
    /** 中文说明：测试局部值 owner，由紧邻初始化决定。 */
    const owner = liveAgent(ctx, 'session-owner', 1)
    accounted.push(owner.id)
    /** 中文说明：测试局部值 child，由紧邻初始化决定。 */
    const child = liveAgent(ctx, 'session-child', 1, 'none', {
      parentSession: owner.id,
      origin: 'subagent',
    })
    /** 中文说明：测试局部值 grandchild，由紧邻初始化决定。 */
    const grandchild = liveAgent(ctx, 'session-grandchild', 1, 'none', {
      parentSession: child.id,
      origin: 'subagent',
    })
    ctx.provide('sessionQuery', {
      traceSession: vi.fn(() => Promise.resolve({
        target: { header: grandchild.header, live: true, persisted: false },
        ancestors: [
          { header: child.header, live: true, persisted: false },
          { header: owner.header, live: true, persisted: false },
        ],
        descendants: [],
        complete: true,
        root: { header: owner.header, live: true, persisted: false },
      })),
    } as never)

    /** 中文说明：测试局部值 response，由紧邻初始化决定。 */
    const response = await api(ctx).sessions.fork(request({ sessionId: grandchild.id }))

    expect(response.result.ok).toBe(true)
    if (!response.result.ok) return
    expect(attachSession).toHaveBeenCalledWith(response.result.value.sessionId)
    expect(ctx.sessions.get(response.result.value.sessionId)?.header).toMatchObject({
      parentSession: grandchild.id,
      cwd: '/proj',
    })
    expect(ctx.sessions.get(response.result.value.sessionId)?.header.origin).toBeUndefined()
    await ctx.fiber.dispose()
  })

  it('forks a persisted subagent without resuming its Agent', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await composed()
    /** 中文说明：测试局部值 sourceId，由紧邻初始化决定。 */
    const sourceId = sid('session-cold-subagent')
    /** 中文说明：测试局部值 parentId，由紧邻初始化决定。 */
    const parentId = sid('session-cold-parent')
    /** 中文说明：测试局部值 header，由紧邻初始化决定。 */
    const header: SessionHeader = {
      version: 0,
      id: sourceId,
      createdAt: 1,
      cwd: '/proj',
      parentSession: parentId,
      origin: 'subagent',
    }
    /** 中文说明：测试局部值 events，由紧邻初始化决定。 */
    const events = [
      { type: 'turn/start', seq: 0, time: 1, data: { turn: 1, trigger: { kind: 'message', source: { kind: 'user' } } } },
      {
        type: 'user/message',
        seq: 1,
        time: 2,
        data: createUserMessage({ content: [{ type: 'text', text: 'work' }], source: { kind: 'user' } }),
        surfaceOp: 'append',
      },
      { type: 'turn/end', seq: 2, time: 3, data: { turn: 1, reason: { kind: 'completed' } } },
    ] as SessionEvent[]
    ctx.provide('sessionPersistence', {
      list: () => Promise.resolve([header]),
      inspect: () => Promise.resolve({ meta: header, events }),
    } as never)
    ctx.provide('sessionQuery', {
      traceSession: () => Promise.resolve({
        target: { header, live: false, persisted: true },
        ancestors: [],
        descendants: [],
        complete: true,
        root: { header, live: false, persisted: true },
      }),
    } as never)
    /** 中文说明：测试局部值 resume，由紧邻初始化决定。 */
    const resume = vi.spyOn(ctx.agents, 'resume')

    /** 中文说明：测试局部值 response，由紧邻初始化决定。 */
    const response = await api(ctx).sessions.fork(request({ sessionId: sourceId }))

    expect(response.result.ok).toBe(true)
    if (!response.result.ok) return
    expect(resume).not.toHaveBeenCalled()
    expect(ctx.agents.get(sourceId)).toBeUndefined()
    expect(ctx.sessions.get(response.result.value.sessionId)?.header).toMatchObject({
      parentSession: sourceId,
      cwd: '/proj',
    })
    expect(ctx.sessions.get(response.result.value.sessionId)?.header.origin).toBeUndefined()
    await ctx.fiber.dispose()
  })

  it('uses the last completed turn only for omitted and past-end anchors', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await composed()
    /** 中文说明：测试局部值 source，由紧邻初始化决定。 */
    const source = liveAgent(ctx, 'session-tail', 2, 'open')
    /** 中文说明：测试局部值 proxy，由紧邻初始化决定。 */
    const proxy = api(ctx)
    /** 中文说明：测试局部值 expectedTypes，由紧邻初始化决定。 */
    const expectedTypes = [
      'turn/start', 'user/message', 'turn/end',
      'turn/start', 'user/message', 'turn/end',
      'session/end-seed',
    ]
    /** 中文说明：测试局部值 omitted，由紧邻初始化决定。 */
    const omitted = await proxy.sessions.fork(request({ sessionId: source.id }))
    expect(omitted.result.ok).toBe(true)
    if (omitted.result.ok) {
      expect(ctx.sessions.get(omitted.result.value.sessionId)?.events.map(event => event.type))
        .toEqual(expectedTypes)
    }
    /** 中文说明：测试局部值 pastEnd，由紧邻初始化决定。 */
    const pastEnd = await proxy.sessions.fork(request({ sessionId: source.id, atSeq: 999 }))
    expect(pastEnd.result.ok).toBe(true)
    if (pastEnd.result.ok) {
      expect(ctx.sessions.get(pastEnd.result.value.sessionId)?.events.map(event => event.type))
        .toEqual(expectedTypes)
    }
    await ctx.fiber.dispose()
  })

  it('cuts through an aborted turn: stopped is closed, not open', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await composed()
    /** 中文说明：测试局部值 source，由紧邻初始化决定。 */
    const source = liveAgent(ctx, 'session-aborted', 1, 'aborted')
    // What a stopped message's fork button anchors on: the frozen node sits
    // one event before its turn/end, floored client-side to that event's seq.
    /** 中文说明：测试局部值 anchor，由紧邻初始化决定。 */
    const anchor = (source.events.at(-1)?.seq ?? 0) - 1
    /** 中文说明：测试局部值 response，由紧邻初始化决定。 */
    const response = await api(ctx).sessions.fork(request({ sessionId: source.id, atSeq: anchor }))
    expect(response.result.ok).toBe(true)
    if (!response.result.ok) return
    expect(ctx.sessions.get(response.result.value.sessionId)?.events.map(event => event.type)).toEqual([
      'turn/start', 'user/message', 'turn/end',
      'turn/start', 'user/message', 'turn/end',
      'session/end-seed',
    ])
    await ctx.fiber.dispose()
  })

  it('rejects an in-log anchor whose turn is still open', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await composed()
    /** 中文说明：测试局部值 source，由紧邻初始化决定。 */
    const source = liveAgent(ctx, 'session-open', 1, 'open')
    /** 中文说明：测试局部值 anchor，由紧邻初始化决定。 */
    const anchor = source.events.at(-1)?.seq ?? 0
    /** 中文说明：测试局部值 response，由紧邻初始化决定。 */
    const response = await api(ctx).sessions.fork(request({ sessionId: source.id, atSeq: anchor }))
    expect(response.result).toMatchObject({
      ok: false,
      error: { code: 'fork-unavailable', details: { sessionId: source.id } },
    })
    if (!response.result.ok) expect(response.result.error.message).toMatch(/has not completed/)
    await ctx.fiber.dispose()
  })

  it('installs the latest logged model selection before the child can run', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await composed()
    /** 中文说明：测试局部值 source，由紧邻初始化决定。 */
    const source = liveAgent(ctx, 'session-routed', 1)
    source.append('request/header', {
      header: {
        config: {
          provider: 'inherited-provider',
          model: 'inherited-model',
          reasoningEffort: ReasoningEffortId('high'),
        },
      },
      reason: 'initial',
    })
    /** 中文说明：测试局部值 response，由紧邻初始化决定。 */
    const response = await api(ctx).sessions.fork(request({ sessionId: source.id }))
    expect(response.result.ok).toBe(true)
    if (!response.result.ok) return
    /** 中文说明：测试局部值 child，由紧邻初始化决定。 */
    const child = ctx.agents.get(response.result.value.sessionId)
    if (child === undefined) throw new Error('fork did not publish the child agent')
    /** 中文说明：测试局部值 assembly，由紧邻初始化决定。 */
    const assembly = await child.ctx.systemPrompt.assemble()
    expect(assembly.variables).toMatchObject({
      provider: 'inherited-provider',
      model: 'inherited-model',
    })
    /** 中文说明：测试局部值 fallback，由紧邻初始化决定。 */
    const fallback: LlmCallConfig = { provider: 'default-provider', model: 'default-model' }
    await expect(agentEvents(child.ctx, child).waterfall(
      'agent/request', { turn: 1, step: 0, signal: new AbortController().signal }, () => Promise.resolve(fallback),
    )).resolves.toMatchObject({
      provider: 'inherited-provider',
      model: 'inherited-model',
      reasoningEffort: 'high',
    })
    await ctx.fiber.dispose()
  })
})
