/**
 * Cold-session and degenerate-composition paths of the host ApiProxy:
 * metadata-only listing, Agent-free history reads, subagent ownership
 * isolation, and prompt failure mapping.
 */
/**
 * 文件职责：验证Host API Proxy的 api-proxy-cold.spec.ts 行为与边界。
 * 技术维度：TypeScript、Cordis、Fetch/RPC 信封、运行时模式校验、Node/Windows 宿主接口。
 * 产品维度：保证浏览器 API、Hook 或目录操作在各种状态下可靠且可诊断。
 * 逻辑维度：构造请求与宿主服务，调用端点并断言响应和清理。
 * 关键边界：网络与路径输入必须校验；原生对话框和宿主路径操作只允许受信调用。
 * 新手阅读建议：先读请求/响应夹具，再按 API 域、错误码和生命周期场景阅读。
 */

import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore from '@deepseek-ai/dsh-session'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import { TypertLookupFailure } from '@deepseek-ai/dsh-typert-protocol'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import { createUserMessage, MessageId } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import type { SessionEvent, SessionHeader, SessionId } from '@deepseek-ai/dsh-session'
import {
  PersistenceCoordinator,
  SessionPersistenceRevision,
  /** 中文说明：类型或类 PersistenceBackend 约束 API、Hook 或目录数据职责。 */
  type PersistenceBackend,
  /** 中文说明：类型或类 StoredPrefix 约束 API、Hook 或目录数据职责。 */
  type StoredPrefix,
} from '@deepseek-ai/dsh-session-persistence'
import type { RpcRequest } from '@deepseek-ai/dsh-host-apiproxy/api/rpc'
import { RpcId } from '@deepseek-ai/dsh-host-apiproxy/api/rpc'
import { createApiProxy } from '@deepseek-ai/dsh-host-apiproxy'

/** 中文说明：测试局部值 sid，由紧邻初始化决定。 */
const sid = (id: string): SessionId => id as SessionId

/** 中文说明：测试局部值 nextRpc，由紧邻初始化决定。 */
let nextRpc = 1
/** 中文说明：函数 request 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function request<P>(payload: P): RpcRequest<P> {
  return { rpcId: RpcId(`cold-${String(nextRpc++)}`), payload }
}

/** 中文说明：函数 header 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function header(id: string, createdAt: number, extra: Partial<SessionHeader> = {}): SessionHeader {
  return { version: 0, id: sid(id), createdAt, cwd: '/proj', ...extra }
}

describe('sessions.list cold merge', () => {
  it('verifies only small possibly-blank artifacts and treats every unavailable probe as visible', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(UserQuestionService)
    /** 中文说明：测试局部值 root，由紧邻初始化决定。 */
    const root = mkdtempSync(join(tmpdir(), 'dsh-cold-'))
    /** 中文说明：测试局部值 smallPath，由紧邻初始化决定。 */
    const smallPath = join(root, 'small.log')
    /** 中文说明：测试局部值 largePath，由紧邻初始化决定。 */
    const largePath = join(root, 'large.log')
    writeFileSync(smallPath, 'x'.repeat(1024))
    writeFileSync(largePath, 'x'.repeat(1025))
    /** 中文说明：测试局部值 metas，由紧邻初始化决定。 */
    const metas = [
      header('small-blank', 100),
      header('small-conversation', 200),
      header('large-unknown', 300),
      header('cached-nonblank', 400),
      header('locationless', 500, { parentSession: sid('session-parent'), origin: 'subagent' }),
      header('vanished', 600),
      header('read-failure', 700),
    ]
    /** 中文说明：测试局部值 readFrom，由紧邻初始化决定。 */
    const readFrom = vi.fn(async (id: SessionId) => {
      if (id === sid('small-blank')) {
        return {
          meta: metas[0]!,
          events: [{ type: 'session/end-seed', seq: 0, time: 700, data: {} }] as SessionEvent[],
        }
      }
      if (id === sid('small-conversation')) {
        return {
          meta: metas[1]!,
          events: [
            { type: 'turn/start', seq: 0, time: 800, data: { turn: 1 } },
            {
              type: 'user/message', seq: 1, time: 1200,
              data: createUserMessage({ content: [{ type: 'text', text: 'worked' }], source: { kind: 'user' } }),
              surfaceOp: 'append',
            },
          ] as SessionEvent[],
        }
      }
      if (id === sid('read-failure')) throw new Error('simulated read failure')
      throw new Error(`unexpected cold read: ${id}`)
    })
    ctx.provide('sessionPersistence', {
      list: () => Promise.resolve(metas),
      locate: (meta: SessionHeader) => {
        if (meta.id === sid('large-unknown')) return { kind: 'jsonl', path: largePath }
        if (meta.id === sid('locationless')) return undefined
        if (meta.id === sid('vanished')) return { kind: 'jsonl', path: join(root, 'vanished.log') }
        return { kind: 'jsonl', path: smallPath }
      },
      readFrom,
    } as never)
    ctx.provide('sessionProjectionCache', {
      cachedSnapshot: (meta: SessionHeader) => {
        if (meta.id === sid('small-blank')) {
          return { asOfSeq: 0, values: { sessionListMetadata: { blank: true, lastPromptAt: null } } }
        }
        if (meta.id === sid('small-conversation')) {
          return { asOfSeq: 0, values: { sessionListMetadata: { blank: true, lastPromptAt: 900 } } }
        }
        if (meta.id === sid('cached-nonblank')) {
          return { asOfSeq: 1, values: { sessionListMetadata: { blank: false, lastPromptAt: 1000 } } }
        }
        return undefined
      },
    } as never)
    /** 中文说明：测试局部值 api，由紧邻初始化决定。 */
    const api = createApiProxy(ctx, { defaultModelSelection: () => ({ provider: 'p', model: 'm' }), cwd: '/tmp' })

    /** 中文说明：测试局部值 response，由紧邻初始化决定。 */
    const response = await api.sessions.list(request({}))
    expect(response.result.ok).toBe(true)
    if (!response.result.ok) throw new Error('unreachable')
    /** 中文说明：测试局部值 byId，由紧邻初始化决定。 */
    const byId = Object.fromEntries(response.result.value.items.map(item => [item.sessionId, item]))
    expect(byId['small-blank']).toMatchObject({ blank: true, updatedAt: 100, running: false })
    // A stale true hint cannot hide the turn found in the bounded read.
    expect(byId['small-conversation']).toMatchObject({ blank: false, updatedAt: 1200 })
    expect(byId['large-unknown']).toMatchObject({ blank: false, updatedAt: 300 })
    // false is monotonic, so this row skips stat/read and keeps cached recency.
    expect(byId['cached-nonblank']).toMatchObject({ blank: false, updatedAt: 1000 })
    expect(byId['locationless']).toMatchObject({
      blank: false,
      updatedAt: 500,
      parentSessionId: 'session-parent',
      origin: 'subagent',
    })
    expect(byId['vanished']).toMatchObject({ blank: false, updatedAt: 600 })
    expect(byId['read-failure']).toMatchObject({ blank: false, updatedAt: 700 })
    expect(readFrom).toHaveBeenCalledTimes(3)
    expect(readFrom.mock.calls.map(([id]) => id)).toEqual(expect.arrayContaining([
      sid('small-blank'),
      sid('small-conversation'),
      sid('read-failure'),
    ]))
  })

  it('can disable bounded blank probes without hiding cold Sessions', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(UserQuestionService)
    /** 中文说明：测试局部值 meta，由紧邻初始化决定。 */
    const meta = header('probe-disabled', 100)
    /** 中文说明：测试局部值 readFrom，由紧邻初始化决定。 */
    const readFrom = vi.fn()
    ctx.provide('sessionPersistence', {
      list: () => Promise.resolve([meta]),
      locate: () => ({ kind: 'jsonl', path: '/not-read' }),
      readFrom,
    } as never)
    /** 中文说明：测试局部值 api，由紧邻初始化决定。 */
    const api = createApiProxy(ctx, {
      defaultModelSelection: () => ({ provider: 'p', model: 'm' }),
      cwd: '/tmp',
      coldBlankProbeMaxBytes: 0,
    })

    /** 中文说明：测试局部值 response，由紧邻初始化决定。 */
    const response = await api.sessions.list(request({}))
    if (!response.result.ok) throw new Error('unreachable')
    expect(response.result.value.items).toEqual([
      expect.objectContaining({ sessionId: meta.id, blank: false, updatedAt: meta.createdAt }),
    ])
    expect(readFrom).not.toHaveBeenCalled()
  })

  it('replaces a probed cold row with the live Session that attached during the read', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(UserQuestionService)
    await ctx.plugin(AgentRegistry)
    /** 中文说明：测试局部值 meta，由紧邻初始化决定。 */
    const meta = header('attached-during-probe', 100)
    /** 中文说明：测试局部值 root，由紧邻初始化决定。 */
    const root = mkdtempSync(join(tmpdir(), 'dsh-cold-race-'))
    /** 中文说明：测试局部值 path，由紧邻初始化决定。 */
    const path = join(root, 'small.log')
    writeFileSync(path, 'x')
    /** 中文说明：测试局部值 started，由紧邻初始化决定。 */
    const started = Promise.withResolvers<undefined>()
    /** 中文说明：测试局部值 release，由紧邻初始化决定。 */
    const release = Promise.withResolvers<undefined>()
    ctx.provide('sessionPersistence', {
      list: () => Promise.resolve([meta]),
      locate: () => ({ kind: 'jsonl', path }),
      readFrom: async () => {
        started.resolve(undefined)
        await release.promise
        return {
          meta,
          events: [{ type: 'session/end-seed', seq: 0, time: 110, data: {} }] as SessionEvent[],
        }
      },
    } as never)
    /** 中文说明：测试局部值 api，由紧邻初始化决定。 */
    const api = createApiProxy(ctx, { defaultModelSelection: () => ({ provider: 'p', model: 'm' }), cwd: '/tmp' })

    /** 中文说明：测试局部值 listing，由紧邻初始化决定。 */
    const listing = api.sessions.list(request({}))
    await started.promise
    /** 中文说明：测试局部值 session，由紧邻初始化决定。 */
    const session = ctx.sessions.create(meta.id, {
      seed: [
        { type: 'turn/start', seq: 0, time: 200, data: { turn: 1 } },
        {
          type: 'user/message', seq: 1, time: 300,
          data: createUserMessage({ content: [{ type: 'text', text: 'live' }], source: { kind: 'user' } }),
          surfaceOp: 'append',
        },
      ],
      meta: {
        ...meta.cwd === undefined ? {} : { cwd: meta.cwd },
        createdAt: meta.createdAt,
      },
    })
    ctx.agents.register({ id: session.id, session, status: 'running', ctx } as Agent)
    release.resolve(undefined)

    /** 中文说明：测试局部值 response，由紧邻初始化决定。 */
    const response = await listing
    if (!response.result.ok) throw new Error('list failed')
    expect(response.result.value.items).toEqual([
      expect.objectContaining({
        sessionId: meta.id,
        blank: false,
        running: true,
        updatedAt: 300,
      }),
    ])
  })
})

describe('attached updatedAt tracks human prompts', () => {
  it('ignores pickup and non-prompt work after the latest human message', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(UserQuestionService)
    await ctx.plugin(AgentRegistry)
    /** 中文说明：测试局部值 api，由紧邻初始化决定。 */
    const api = createApiProxy(ctx, { defaultModelSelection: () => ({ provider: 'p', model: 'm' }), cwd: '/tmp' })

    // Old work, resumed just now: the log tail would report the pickup.
    /** 中文说明：测试局部值 worked，由紧邻初始化决定。 */
    const worked = 1_000_000
    /** 中文说明：测试局部值 resumed，由紧邻初始化决定。 */
    const resumed = ctx.sessions.create(sid('resumed-untouched'), {
      seed: [
        { type: 'turn/start', seq: 0, time: worked, data: { turn: 1 } },
        {
          type: 'user/message', seq: 1, time: worked,
          data: createUserMessage({ content: [{ type: 'text', text: 'worked' }], source: { kind: 'user' } }),
          surfaceOp: 'append',
        },
        { type: 'turn/end', seq: 2, time: worked + 1, data: { turn: 1, reason: { kind: 'completed' } } },
      ],
      meta: { cwd: '/proj', createdAt: 500 },
    })
    ctx.agents.register({ id: resumed.id, session: resumed, status: 'idle', ctx } as Agent)
    /** 中文说明：测试局部值 boundary，由紧邻初始化决定。 */
    const boundary = resumed.events.at(-1)
    expect(boundary?.type).toBe('session/end-seed')
    expect(boundary?.time).toBeGreaterThan(worked)

    /** 中文说明：测试局部值 listed，由紧邻初始化决定。 */
    const listed = await api.sessions.list(request({}))
    if (!listed.result.ok) throw new Error('list failed')
    /** 中文说明：测试局部值 summary，由紧邻初始化决定。 */
    const summary = listed.result.value.items.find(item => item.sessionId === 'resumed-untouched')
    expect(summary?.updatedAt).toBe(worked)

    // A lifecycle boundary is not a human update.
    resumed.append('turn/start', { turn: 2 })
    /** 中文说明：测试局部值 afterBoundary，由紧邻初始化决定。 */
    const afterBoundary = await api.sessions.list(request({}))
    if (!afterBoundary.result.ok) throw new Error('list failed')
    expect(afterBoundary.result.value.items.find(item => item.sessionId === 'resumed-untouched')?.updatedAt)
      .toBe(worked)

    /** 中文说明：测试局部值 prompt，由紧邻初始化决定。 */
    const prompt = resumed.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'new prompt' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    /** 中文说明：测试局部值 after，由紧邻初始化决定。 */
    const after = await api.sessions.list(request({}))
    if (!after.result.ok) throw new Error('list failed')
    /** 中文说明：测试局部值 moved，由紧邻初始化决定。 */
    const moved = after.result.value.items.find(item => item.sessionId === 'resumed-untouched')
    expect(moved?.updatedAt).toBe(prompt.time)
  })
})

describe('cold history recovery view', () => {
  it('shows in-memory interruption repair without activating the session', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(UserQuestionService)
    /** 中文说明：测试局部值 sessionId，由紧邻初始化决定。 */
    const sessionId = sid('session-interrupted')
    /** 中文说明：测试局部值 meta，由紧邻初始化决定。 */
    const meta = header(sessionId, 1000)
    /** 中文说明：测试局部值 stored，由紧邻初始化决定。 */
    const stored: StoredPrefix<never> = {
      meta,
      events: [{ type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } }],
      revision: SessionPersistenceRevision('history-recovery-test:1'),
    }
    /** 中文说明：测试局部值 backend，由紧邻初始化决定。 */
    const backend: PersistenceBackend<never> = {
      name: 'history-recovery-test',
      loadStored: id => Promise.resolve(id === sessionId ? structuredClone(stored) : undefined),
      readStoredRevision: id => Promise.resolve(
        id === sessionId ? SessionPersistenceRevision('history-recovery-test:1') : undefined,
      ),
      appendBatch: () => Promise.resolve(),
      commitRepair: () => Promise.resolve(),
      list: () => Promise.resolve([structuredClone(meta)]),
    }
    /** 中文说明：测试局部值 coordinator，由紧邻初始化决定。 */
    const coordinator = new PersistenceCoordinator(ctx, backend)
    ctx.provide('sessionPersistence', {
      list: (signal?: AbortSignal) => backend.list(signal),
      inspect: (id: SessionId, signal?: AbortSignal) => coordinator.inspect(id, signal),
      locate: () => undefined,
    } as never)
    /** 中文说明：测试局部值 api，由紧邻初始化决定。 */
    const api = createApiProxy(ctx, { defaultModelSelection: () => ({ provider: 'p', model: 'm' }), cwd: '/tmp' })

    /** 中文说明：测试局部值 history，由紧邻初始化决定。 */
    const history = await api.sessions.history(request({ sessionId, beforeSeq: 2, maxMessages: 10 }))
    if (!history.result.ok) throw new Error('history failed')
    expect(history.result.value.events.map(entry => entry.event)).toMatchInlineSnapshot(`
      [
        {
          "data": {
            "turn": 1,
          },
          "seq": 0,
          "time": 1,
          "type": "turn/start",
        },
        {
          "data": {
            "reason": {
              "kind": "interrupted",
            },
            "turn": 1,
          },
          "seq": 1,
          "time": 1,
          "type": "turn/end",
        },
      ]
    `)
    expect(ctx.sessions.get(sessionId)).toBeUndefined()
    await ctx.fiber.dispose()
  })
})

describe('Remote Agent and Session lookup policy', () => {
  it('deduplicates a cold resume across Agent and Session parameters', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    await ctx.plugin(TypertRegistry)
    await ctx.plugin(SessionStore)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(UserQuestionService)
    /** 中文说明：测试局部值 sessionId，由紧邻初始化决定。 */
    const sessionId = sid('session-remote-cold')
    /** 中文说明：测试局部值 meta，由紧邻初始化决定。 */
    const meta = header(sessionId, 1000)
    /** 中文说明：测试局部值 inspect，由紧邻初始化决定。 */
    const inspect = vi.fn(() => Promise.resolve({ meta, events: [] as SessionEvent[] }))
    ctx.provide('sessionPersistence', {
      list: () => Promise.resolve([meta]),
      inspect,
      locate: () => undefined,
    } as never)
    /** 中文说明：测试局部值 resumedSession，由紧邻初始化决定。 */
    const resumedSession = { id: sessionId, header: meta, events: [] } as unknown as import('@deepseek-ai/dsh-session').Session
    /** 中文说明：测试局部值 resumedAgent，由紧邻初始化决定。 */
    const resumedAgent = { id: sessionId, session: resumedSession, status: 'idle', ctx } as Agent
    /** 中文说明：测试局部值 release，由紧邻初始化决定。 */
    const release = Promise.withResolvers<undefined>()
    /** 中文说明：测试局部值 resume，由紧邻初始化决定。 */
    const resume = vi.spyOn(ctx.agents, 'resume').mockImplementation(async () => {
      await release.promise
      return { agent: resumedAgent, dispose: () => Promise.resolve() }
    })
    /** 中文说明：测试局部值 defaultAgentLookup，由紧邻初始化决定。 */
    const defaultAgentLookup = ctx.typert.lookups.get('agent')
    /** 中文说明：测试局部值 defaultSessionLookup，由紧邻初始化决定。 */
    const defaultSessionLookup = ctx.typert.lookups.get('session')
    createApiProxy(ctx, { defaultModelSelection: () => ({ provider: 'p', model: 'm' }), cwd: '/tmp' })
    await vi.waitFor(() => {
      expect(ctx.typert.lookups.get('agent')).not.toBe(defaultAgentLookup)
      expect(ctx.typert.lookups.get('session')).not.toBe(defaultSessionLookup)
    })
    /** 中文说明：测试局部值 agentLookup，由紧邻初始化决定。 */
    const agentLookup = ctx.typert.lookups.get('agent')
    /** 中文说明：测试局部值 sessionLookup，由紧邻初始化决定。 */
    const sessionLookup = ctx.typert.lookups.get('session')
    if (agentLookup === undefined || sessionLookup === undefined) throw new Error('core lookup providers were not mounted')

    /** 中文说明：测试局部值 resolvedAgent，由紧邻初始化决定。 */
    const resolvedAgent = Promise.resolve(agentLookup.resolve(sessionId))
    /** 中文说明：测试局部值 resolvedSession，由紧邻初始化决定。 */
    const resolvedSession = Promise.resolve(sessionLookup.resolve(sessionId))
    await vi.waitFor(() => { expect(resume).toHaveBeenCalledOnce() })
    release.resolve(undefined)

    await expect(resolvedAgent).resolves.toBe(resumedAgent)
    await expect(resolvedSession).resolves.toBe(resumedSession)
    expect(inspect).toHaveBeenCalledOnce()
  })

  it('preserves the subagent ownership fence for cold and live Remote lookups', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    await ctx.plugin(TypertRegistry)
    await ctx.plugin(SessionStore)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(UserQuestionService)
    /** 中文说明：测试局部值 coldId，由紧邻初始化决定。 */
    const coldId = sid('session-remote-cold-child')
    /** 中文说明：测试局部值 coldMeta，由紧邻初始化决定。 */
    const coldMeta = header(coldId, 1000, {
      parentSession: sid('session-parent'),
      origin: 'subagent',
    })
    /** 中文说明：测试局部值 inspect，由紧邻初始化决定。 */
    const inspect = vi.fn(() => Promise.resolve({ meta: coldMeta, events: [] as SessionEvent[] }))
    ctx.provide('sessionPersistence', {
      list: () => Promise.resolve([coldMeta]),
      inspect,
      locate: () => undefined,
    } as never)
    /** 中文说明：测试局部值 liveSession，由紧邻初始化决定。 */
    const liveSession = ctx.sessions.create(sid('session-remote-live-child'), {
      meta: { cwd: '/proj', parentSession: sid('session-parent'), origin: 'subagent' },
    })
    /** 中文说明：测试局部值 liveAgent，由紧邻初始化决定。 */
    const liveAgent = { id: liveSession.id, session: liveSession, status: 'idle', ctx } as Agent
    ctx.agents.register(liveAgent)
    /** 中文说明：测试局部值 resume，由紧邻初始化决定。 */
    const resume = vi.spyOn(ctx.agents, 'resume')
    /** 中文说明：测试局部值 defaultAgentLookup，由紧邻初始化决定。 */
    const defaultAgentLookup = ctx.typert.lookups.get('agent')
    /** 中文说明：测试局部值 defaultSessionLookup，由紧邻初始化决定。 */
    const defaultSessionLookup = ctx.typert.lookups.get('session')
    createApiProxy(ctx, { defaultModelSelection: () => ({ provider: 'p', model: 'm' }), cwd: '/tmp' })
    await vi.waitFor(() => {
      expect(ctx.typert.lookups.get('agent')).not.toBe(defaultAgentLookup)
      expect(ctx.typert.lookups.get('session')).not.toBe(defaultSessionLookup)
    })
    /** 中文说明：测试局部值 agentLookup，由紧邻初始化决定。 */
    const agentLookup = ctx.typert.lookups.get('agent')
    /** 中文说明：测试局部值 sessionLookup，由紧邻初始化决定。 */
    const sessionLookup = ctx.typert.lookups.get('session')
    if (agentLookup === undefined || sessionLookup === undefined) throw new Error('core lookup providers were not mounted')
    /** 中文说明：测试局部值 ownershipFailure，由紧邻初始化决定。 */
    const ownershipFailure = {
      failure: {
        code: 'agent-busy',
        details: { reason: 'use subagent delivery for this child session' },
      },
    }

    /** 中文说明：测试局部值 coldFailure，由紧邻初始化决定。 */
    const coldFailure = Promise.resolve(agentLookup.resolve(coldId))
    /** 中文说明：测试局部值 liveFailure，由紧邻初始化决定。 */
    const liveFailure = Promise.resolve(sessionLookup.resolve(liveSession.id))
    await expect(coldFailure).rejects.toBeInstanceOf(TypertLookupFailure)
    await expect(coldFailure).rejects.toMatchObject(ownershipFailure)
    await expect(liveFailure).rejects.toBeInstanceOf(TypertLookupFailure)
    await expect(liveFailure).rejects.toMatchObject(ownershipFailure)
    expect(resume).not.toHaveBeenCalled()
    expect(inspect).toHaveBeenCalledOnce()
  })
})

describe('subagent ownership fence', () => {
  it('reads a cold child without an Agent and rejects generic resume or adoption', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(UserQuestionService)
    /** 中文说明：测试局部值 sessionId，由紧邻初始化决定。 */
    const sessionId = sid('session-child')
    /** 中文说明：测试局部值 meta，由紧邻初始化决定。 */
    const meta = header('session-child', 1000, {
      parentSession: sid('session-parent'),
      seedLength: 0,
      origin: 'subagent',
    })
    /** 中文说明：测试局部值 events，由紧邻初始化决定。 */
    const events = [
      { type: 'turn/start', seq: 0, time: 1, data: { turn: 1, trigger: { kind: 'message', source: { kind: 'user' } } } },
      {
        type: 'user/message',
        seq: 1,
        time: 2,
        data: { content: [{ type: 'text', text: 'work' }], source: { kind: 'user' } },
        surfaceOp: 'append',
      },
      {
        type: 'subagent/descriptor',
        seq: 2,
        time: 3,
        data: { version: 2, mode: 'continuable', provider: 'spawn', label: 'child' },
      },
      { type: 'turn/end', seq: 3, time: 4, data: { turn: 1, reason: { kind: 'completed' } } },
    ] as SessionEvent[]
    /** 中文说明：测试局部值 inspect，由紧邻初始化决定。 */
    const inspect = vi.fn(() => Promise.resolve({ meta, events }))
    ctx.provide('sessionPersistence', {
      list: () => Promise.resolve([meta]),
      inspect,
      locate: () => undefined,
    } as never)
    /** 中文说明：测试局部值 resume，由紧邻初始化决定。 */
    const resume = vi.spyOn(ctx.agents, 'resume')
    /** 中文说明：测试局部值 api，由紧邻初始化决定。 */
    const api = createApiProxy(ctx, { defaultModelSelection: () => ({ provider: 'p', model: 'm' }), cwd: '/tmp' })

    /** 中文说明：测试局部值 history，由紧邻初始化决定。 */
    const history = await api.sessions.history(request({ sessionId }))
    expect(history.result.ok).toBe(true)
    if (history.result.ok) {
      expect(history.result.value.events.map(entry => entry.event.type)).toEqual(events.map(event => event.type))
    }
    expect(ctx.agents.get(sessionId)).toBeUndefined()

    /** 中文说明：测试局部值 prompt，由紧邻初始化决定。 */
    const prompt = await api.sessions.prompt(request({
      sessionId,
      mode: 'queue',
      content: [{ type: 'text', text: 'follow up' }],
    }))
    expect(prompt.result.ok).toBe(false)
    if (!prompt.result.ok) {
      expect(prompt.result.error).toMatchObject({
        code: 'agent-busy',
        details: { reason: 'use subagent delivery for this child session' },
      })
    }

    /** 中文说明：测试局部值 create，由紧邻初始化决定。 */
    const create = await api.sessions.create(request({ sessionId, cwd: '/proj' }))
    expect(create.result.ok).toBe(false)
    if (!create.result.ok) expect(create.result.error.code).toBe('agent-busy')
    expect(resume).not.toHaveBeenCalled()
    expect(ctx.agents.get(sessionId)).toBeUndefined()
    expect(inspect).toHaveBeenCalledTimes(3)
  })

  it('no longer treats a descriptor-only cold child without origin as subagent-owned', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(UserQuestionService)
    /** 中文说明：测试局部值 sessionId，由紧邻初始化决定。 */
    const sessionId = sid('session-legacy-child')
    /** 中文说明：测试局部值 meta，由紧邻初始化决定。 */
    const meta = header('session-legacy-child', 1000, {
      parentSession: sid('session-parent'),
      seedLength: 0,
    })
    /** 中文说明：测试局部值 events，由紧邻初始化决定。 */
    const events = [
      {
        type: 'subagent/descriptor',
        seq: 0,
        time: 1,
        data: { version: 2, mode: 'continuable', provider: 'spawn', label: 'child' },
      },
    ] as SessionEvent[]
    ctx.provide('sessionPersistence', {
      list: () => Promise.resolve([meta]),
      inspect: () => Promise.resolve({ meta, events }),
      locate: () => undefined,
    } as never)
    // Stores whose headers predate `origin` classify a child only through the
    // descriptor event; the pre-release decision stops recognizing them, so
    // the ownership fence lets generic resume reach the registry instead of
    // answering `agent-busy`.
    /** 中文说明：测试局部值 resume，由紧邻初始化决定。 */
    const resume = vi.spyOn(ctx.agents, 'resume')
      .mockRejectedValue(new Error('registry unavailable in this bench'))
    /** 中文说明：测试局部值 api，由紧邻初始化决定。 */
    const api = createApiProxy(ctx, { defaultModelSelection: () => ({ provider: 'p', model: 'm' }), cwd: '/tmp' })

    /** 中文说明：测试局部值 prompt，由紧邻初始化决定。 */
    const prompt = await api.sessions.prompt(request({
      sessionId,
      mode: 'queue',
      content: [{ type: 'text', text: 'follow up' }],
    }))
    expect(resume).toHaveBeenCalledTimes(1)
    expect(prompt.result.ok).toBe(false)
    if (!prompt.result.ok) expect(prompt.result.error.code).toBe('internal')
  })

  it('rejects origin-marked and runtime-owned live children from generic controls', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(UserQuestionService)
    /** 中文说明：测试局部值 parentSession，由紧邻初始化决定。 */
    const parentSession = ctx.sessions.create(sid('session-parent'), { meta: { cwd: '/proj' } })
    /** 中文说明：测试局部值 parent，由紧邻初始化决定。 */
    const parent = { id: parentSession.id, session: parentSession, status: 'idle', ctx } as Agent
    ctx.agents.register(parent)

    /** 中文说明：测试局部值 originSession，由紧邻初始化决定。 */
    const originSession = ctx.sessions.create(sid('session-origin-child'), {
      meta: { cwd: '/proj', parentSession: parent.id, origin: 'subagent' },
    })
    /** 中文说明：测试局部值 cancel，由紧邻初始化决定。 */
    const cancel = vi.fn()
    /** 中文说明：测试局部值 updateInbox，由紧邻初始化决定。 */
    const updateInbox = vi.fn(() => 'applied' as const)
    /** 中文说明：测试局部值 originChild，由紧邻初始化决定。 */
    const originChild = {
      id: originSession.id,
      session: originSession,
      status: 'idle',
      ctx,
      cancel,
      updateInbox,
    } as unknown as Agent
    ctx.agents.register(originChild)

    /** 中文说明：测试局部值 startingSession，由紧邻初始化决定。 */
    const startingSession = ctx.sessions.create(sid('session-starting-child'), {
      meta: { cwd: '/proj', parentSession: parent.id },
    })
    /** 中文说明：测试局部值 startingChild，由紧邻初始化决定。 */
    const startingChild = { id: startingSession.id, session: startingSession, status: 'idle', ctx } as Agent
    ctx.agents.enter(startingChild, parent)
    /** 中文说明：测试局部值 api，由紧邻初始化决定。 */
    const api = createApiProxy(ctx, { defaultModelSelection: () => ({ provider: 'p', model: 'm' }), cwd: '/tmp' })

    /** 中文说明：测试局部值 stopped，由紧邻初始化决定。 */
    const stopped = await api.sessions.cancel(request({ sessionId: originChild.id }))
    expect(stopped.result.ok).toBe(false)
    if (!stopped.result.ok) expect(stopped.result.error.code).toBe('agent-busy')
    expect(cancel).not.toHaveBeenCalled()

    /** 中文说明：测试局部值 queued，由紧邻初始化决定。 */
    const queued = await api.sessions.updateQueue(request({
      sessionId: originChild.id,
      itemId: MessageId('queued-item'),
      action: { kind: 'remove' },
    }))
    expect(queued.result.ok).toBe(false)
    if (!queued.result.ok) expect(queued.result.error.code).toBe('agent-busy')
    expect(updateInbox).not.toHaveBeenCalled()

    /** 中文说明：测试局部值 models，由紧邻初始化决定。 */
    const models = await api.sessions.models(request({ sessionId: startingChild.id }))
    expect(models.result.ok).toBe(false)
    if (!models.result.ok) expect(models.result.error.code).toBe('agent-busy')

    /** 中文说明：测试局部值 create，由紧邻初始化决定。 */
    const create = await api.sessions.create(request({ sessionId: originChild.id, cwd: '/proj' }))
    expect(create.result.ok).toBe(false)
    if (!create.result.ok) expect(create.result.error.code).toBe('agent-busy')

    /** 中文说明：测试局部值 history，由紧邻初始化决定。 */
    const history = await api.sessions.history(request({ sessionId: originChild.id }))
    expect(history.result.ok).toBe(true)
    expect(ctx.agents.get(originChild.id)).toBe(originChild)
  })

  it('does not classify an ordinary fork from an inherited ancestor descriptor', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(UserQuestionService)
    /** 中文说明：测试局部值 session，由紧邻初始化决定。 */
    const session = ctx.sessions.create(sid('session-ordinary-fork'), {
      seed: [{
        type: 'subagent/descriptor',
        seq: 0,
        time: 1,
        data: { version: 2, mode: 'continuable', provider: 'spawn', label: 'ancestor' },
      }],
      meta: { cwd: '/proj', parentSession: sid('session-source'), seedLength: 1 },
    })
    /** 中文说明：测试局部值 followup，由紧邻初始化决定。 */
    const followup = vi.fn()
    /** 中文说明：测试局部值 agent，由紧邻初始化决定。 */
    const agent = { id: session.id, session, status: 'idle', ctx, followup } as unknown as Agent
    ctx.agents.register(agent)
    /** 中文说明：测试局部值 api，由紧邻初始化决定。 */
    const api = createApiProxy(ctx, { defaultModelSelection: () => ({ provider: 'p', model: 'm' }), cwd: '/tmp' })

    /** 中文说明：测试局部值 response，由紧邻初始化决定。 */
    const response = await api.sessions.prompt(request({
      sessionId: agent.id,
      mode: 'queue',
      content: [{ type: 'text', text: 'ordinary work' }],
    }))
    expect(response.result.ok).toBe(true)
    expect(followup).toHaveBeenCalledOnce()
  })

  it('canonicalizes a supplied browser zone on the exact prompt and rejects invalid names', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(UserQuestionService)
    /** 中文说明：测试局部值 session，由紧邻初始化决定。 */
    const session = ctx.sessions.create(sid('session-browser-zone'), { meta: { cwd: '/proj' } })
    /** 中文说明：测试局部值 followup，由紧邻初始化决定。 */
    const followup = vi.fn()
    /** 中文说明：测试局部值 agent，由紧邻初始化决定。 */
    const agent = { id: session.id, session, status: 'idle', ctx, followup } as unknown as Agent
    ctx.agents.register(agent)
    /** 中文说明：测试局部值 api，由紧邻初始化决定。 */
    const api = createApiProxy(ctx, {
      defaultModelSelection: () => ({ provider: 'p', model: 'm' }),
      cwd: '/tmp',
    })

    /** 中文说明：测试局部值 alias，由紧邻初始化决定。 */
    const alias = 'US/Pacific'
    /** 中文说明：测试局部值 canonical，由紧邻初始化决定。 */
    const canonical = new Intl.DateTimeFormat('en-US', { timeZone: alias })
      .resolvedOptions().timeZone
    /** 中文说明：测试局部值 zonedRequest，由紧邻初始化决定。 */
    const zonedRequest = request({
      sessionId: agent.id,
      mode: 'queue' as const,
      content: [{ type: 'text' as const, text: 'zoned work' }],
      clientTimeZone: alias,
    })
    await expect(api.sessions.prompt(zonedRequest)).resolves.toMatchObject({
      result: { ok: true },
    })
    expect(followup).toHaveBeenNthCalledWith(1, expect.objectContaining({
      source: { kind: 'user', rpcId: zonedRequest.rpcId, clientTimeZone: canonical },
    }))

    /** 中文说明：测试局部值 utcRequest，由紧邻初始化决定。 */
    const utcRequest = request({
      sessionId: agent.id,
      mode: 'queue' as const,
      content: [{ type: 'text' as const, text: 'UTC work' }],
      clientTimeZone: 'UTC',
    })
    await expect(api.sessions.prompt(utcRequest)).resolves.toMatchObject({
      result: { ok: true },
    })
    expect(followup).toHaveBeenNthCalledWith(2, expect.objectContaining({
      source: { kind: 'user', rpcId: utcRequest.rpcId, clientTimeZone: 'UTC' },
    }))

    /** 中文说明：测试局部值 unzonedRequest，由紧邻初始化决定。 */
    const unzonedRequest = request({
      sessionId: agent.id,
      mode: 'queue' as const,
      content: [{ type: 'text' as const, text: 'headless work' }],
    })
    await expect(api.sessions.prompt(unzonedRequest)).resolves.toMatchObject({
      result: { ok: true },
    })
    expect(followup).toHaveBeenNthCalledWith(3, expect.objectContaining({
      source: { kind: 'user', rpcId: unzonedRequest.rpcId },
    }))

    /** 中文说明：测试局部值 clientTimeZone，由紧邻初始化决定。 */
    for (const clientTimeZone of ['', ' UTC', 'CST', 'Not/A_Real_Zone']) {
      /** 中文说明：测试局部值 invalid，由紧邻初始化决定。 */
      const invalid = await api.sessions.prompt(request({
        sessionId: agent.id,
        mode: 'queue' as const,
        content: [{ type: 'text' as const, text: 'invalid zone' }],
        clientTimeZone,
      }))
      expect(invalid.result).toEqual({
        ok: false,
        error: {
          code: 'invalid-time-zone',
          message: 'clientTimeZone must be UTC or a valid IANA Area/Location name',
          details: { value: clientTimeZone },
        },
      })
    }
    expect(followup).toHaveBeenCalledTimes(3)
  })
})

describe('degenerate composition (no persistence, no factory)', () => {
  it('list skips the cold merge and history reports missing persistence as internal', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(UserQuestionService)
    /** 中文说明：测试局部值 api，由紧邻初始化决定。 */
    const api = createApiProxy(ctx, { defaultModelSelection: () => ({ provider: 'p', model: 'm' }), cwd: '/tmp' })

    /** 中文说明：测试局部值 listed，由紧邻初始化决定。 */
    const listed = await api.sessions.list(request({}))
    expect(listed.result.ok).toBe(true)
    if (listed.result.ok) expect(listed.result.value.items).toEqual([])

    // No persistence means cold history cannot inspect a transcript.
    /** 中文说明：测试局部值 response，由紧邻初始化决定。 */
    const response = await api.sessions.history(request({ sessionId: sid('session-ghost') }))
    expect(response.result.ok).toBe(false)
    if (!response.result.ok) {
      expect(response.result.error.code).toBe('internal')
      expect(response.result.error.message).toMatch(/history unavailable for session "session-ghost"/)
    }
  })

  it('maps a persistence catalog miss to session-not-found without inspection', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(UserQuestionService)
    /** 中文说明：测试局部值 inspect，由紧邻初始化决定。 */
    const inspect = vi.fn()
    ctx.provide('sessionPersistence', {
      list: () => Promise.resolve([]),
      inspect,
    } as never)
    /** 中文说明：测试局部值 api，由紧邻初始化决定。 */
    const api = createApiProxy(ctx, { defaultModelSelection: () => ({ provider: 'p', model: 'm' }), cwd: '/tmp' })

    /** 中文说明：测试局部值 response，由紧邻初始化决定。 */
    const response = await api.sessions.history(request({ sessionId: sid('session-missing') }))
    expect(response.result.ok).toBe(false)
    if (!response.result.ok) expect(response.result.error.code).toBe('session-not-found')
    expect(inspect).not.toHaveBeenCalled()
  })
})

describe('sessions.prompt synchronous rejection', () => {
  it('maps a synchronous send throw (disposed/invalid input) to agent-busy with the reason attached', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(UserQuestionService)
    /** 中文说明：测试局部值 session，由紧邻初始化决定。 */
    const session = ctx.sessions.create(sid('session-throwing'))
    // A live structural stub whose delivery verbs throw synchronously, the
    // shape a disposed loop presents at this gateway boundary.
    ctx.agents.register({
      id: session.id,
      session,
      status: 'idle',
      ctx,
      followup: () => { throw new Error('agent "session-throwing" lifecycle disposed') },
      steer: () => { throw new Error('agent "session-throwing" lifecycle disposed') },
    } as unknown as Agent)
    /** 中文说明：测试局部值 api，由紧邻初始化决定。 */
    const api = createApiProxy(ctx, { defaultModelSelection: () => ({ provider: 'p', model: 'm' }), cwd: '/tmp' })

    /** 中文说明：测试局部值 mode，由紧邻初始化决定。 */
    for (const mode of ['queue', 'steer'] as const) {
      /** 中文说明：测试局部值 response，由紧邻初始化决定。 */
      const response = await api.sessions.prompt(request({
        sessionId: session.id, mode, content: [{ type: 'text' as const, text: 'x' }],
      }))
      expect(response.result.ok).toBe(false)
      if (!response.result.ok) {
        expect(response.result.error.code).toBe('agent-busy')
        expect(response.result.error.message).toBe('prompt rejected')
        expect(response.result.error.details).toEqual({
          reason: 'Error: agent "session-throwing" lifecycle disposed',
        })
      }
    }
  })

  it('classifies a raced cold-resume ID collision as agent-busy', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(UserQuestionService)
    /** 中文说明：测试局部值 sessionId，由紧邻初始化决定。 */
    const sessionId = sid('race-resume')
    /** 中文说明：测试局部值 meta，由紧邻初始化决定。 */
    const meta: SessionHeader = header('race-resume', 1000)
    ctx.provide('sessionPersistence', {
      list: () => Promise.resolve([meta]),
      inspect: () => Promise.resolve({ meta, events: [] as SessionEvent[] }),
      locate: () => undefined,
    } as never)
    // The raced winner: a live parent-owned subagent publishes the identity
    // while the generic cold resume is in flight, so the resume collides.
    /** 中文说明：测试局部值 parentSession，由紧邻初始化决定。 */
    const parentSession = ctx.sessions.create(sid('race-parent'), { meta: { cwd: '/proj' } })
    /** 中文说明：测试局部值 parent，由紧邻初始化决定。 */
    const parent = { id: parentSession.id, session: parentSession, status: 'idle', ctx } as Agent
    ctx.agents.register(parent)
    /** 中文说明：测试局部值 childSession，由紧邻初始化决定。 */
    const childSession = ctx.sessions.create(sessionId, {
      meta: { cwd: '/proj', parentSession: parent.id, origin: 'subagent' },
    })
    /** 中文说明：测试局部值 child，由紧邻初始化决定。 */
    const child = { id: sessionId, session: childSession, status: 'idle', ctx } as unknown as Agent
    vi.spyOn(ctx.agents, 'resume').mockImplementationOnce(async () => {
      // The parent's `enter()` wins the identity between the pre-resume
      // re-check and publication; the generic resume then collides.
      ctx.agents.register(child)
      throw new Error('session id already published')
    })
    /** 中文说明：测试局部值 api，由紧邻初始化决定。 */
    const api = createApiProxy(ctx, { defaultModelSelection: () => ({ provider: 'p', model: 'm' }), cwd: '/tmp' })

    /** 中文说明：测试局部值 models，由紧邻初始化决定。 */
    const models = await api.sessions.models(request({ sessionId }))
    expect(models.result.ok).toBe(false)
    if (!models.result.ok) {
      expect(models.result.error).toMatchObject({
        code: 'agent-busy',
        details: { reason: 'use subagent delivery for this child session' },
      })
    }
  })
})
