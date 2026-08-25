/**
 * Host session.search projection: list-equivalent visibility, fixed message
 * filters and result bound, cancellation mapping, and unavailable/failure
 * behavior.
 */
/*
 * 文件职责：验证Host API Proxy的 api-proxy-search.spec.ts 行为与边界。
 * 技术维度：TypeScript、Cordis、Fetch/RPC 信封、运行时模式校验、Node/Windows 宿主接口。
 * 产品维度：保证浏览器 API、Hook 或目录操作在各种状态下可靠且可诊断。
 * 逻辑维度：构造请求与宿主服务，调用端点并断言响应和清理。
 * 关键边界：网络与路径输入必须校验；原生对话框和宿主路径操作只允许受信调用。
 * 新手阅读建议：先读请求/响应夹具，再按 API 域、错误码和生命周期场景阅读。
 */

import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { stat } from 'node:fs/promises'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import type { SessionHeader, SessionId } from '@deepseek-ai/dsh-session'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import {
  SessionQueryError,
  /** 中文说明：类型或类 SessionSearchHit 约束 API、Hook 或目录数据职责。 */
  type SessionSearchHit,
  /** 中文说明：类型或类 SessionSearchRequest 约束 API、Hook 或目录数据职责。 */
  type SessionSearchRequest,
} from '@deepseek-ai/dsh-session-query'
import type { RpcRequest } from '@deepseek-ai/dsh-host-apiproxy/api'
import { RpcId } from '@deepseek-ai/dsh-host-apiproxy/api'
import { createApiProxy } from '@deepseek-ai/dsh-host-apiproxy'

vi.mock('node:fs/promises', async (importOriginal) => {
  /** 中文说明：测试局部值 actual，由紧邻初始化决定。 */
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, stat: vi.fn(actual.stat) }
})

/** 中文说明：测试局部值 sid，由紧邻初始化决定。 */
const sid = (value: string): SessionId => value as SessionId
/** 中文说明：测试局部值 defaults，由紧邻初始化决定。 */
const defaults = { defaultModelSelection: () => ({ provider: 'p', model: 'm' }), cwd: '/tmp' }

/** 中文说明：函数 request 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function request(query: string): RpcRequest<{ query: string }> {
  return { rpcId: RpcId(`search-${query}`), payload: { query } }
}

/** 中文说明：函数 header 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function header(id: string, cwd: string | null = '/project'): SessionHeader {
  return {
    version: 0,
    id: sid(id),
    createdAt: 100,
    ...(cwd === null ? {} : { cwd }),
  }
}

/** 中文说明：函数 hit 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function hit(id: string, index = 0): SessionSearchHit {
  /** 中文说明：测试局部值 session，由紧邻初始化决定。 */
  const session = header(id)
  return {
    header: session,
    live: true,
    persisted: false,
    bestMatch: {
      sessionId: session.id,
      seq: index,
      type: 'user/message',
      time: 200 + index,
      surface: 'current',
      snippet: `match ${index}`,
    },
  }
}

/** 中文说明：函数 baseContext 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
async function baseContext(): Promise<Context> {
  /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(UserQuestionService)
  return ctx
}

describe('session.search', () => {
  it('searches only list-visible ids and current conversation-message events', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await baseContext()
    /** 中文说明：测试局部值 live，由紧邻初始化决定。 */
    const live = ctx.sessions.create(sid('live'), { meta: header('live', '/live') })
    live.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'live text' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    /** 中文说明：测试局部值 cold，由紧邻初始化决定。 */
    const cold = header('cold', '/cold')
    /** 中文说明：测试局部值 legacy，由紧邻初始化决定。 */
    const legacy = header('legacy', null)
    ctx.provide('sessionPersistence', {
      list: () => Promise.resolve([cold, legacy]),
      locate: () => undefined,
    } as never)

    /** 中文说明：测试局部值 searchSessions，由紧邻初始化决定。 */
    const searchSessions = vi.fn((
      _request: SessionSearchRequest,
      _exec?: { signal?: AbortSignal },
    ) => Promise.resolve({
      items: [
        {
          header: legacy,
          live: false,
          persisted: true,
          bestMatch: {
            sessionId: legacy.id,
            seq: 3,
            type: 'user/message' as const,
            time: 190,
            surface: 'current' as const,
            snippet: 'must remain hidden',
          },
        },
        {
          header: cold,
          live: false,
          persisted: true,
          bestMatch: {
            sessionId: cold.id,
            seq: 4,
            type: 'assistant/message' as const,
            time: 200,
            surface: 'current' as const,
            snippet: 'the matching answer',
          },
        },
      ],
    }))
    ctx.provide('sessionQuery', { searchSessions } as never)
    /** 中文说明：测试局部值 api，由紧邻初始化决定。 */
    const api = createApiProxy(ctx, defaults)
    /** 中文说明：测试局部值 signal，由紧邻初始化决定。 */
    const signal = new AbortController().signal

    /** 中文说明：测试局部值 response，由紧邻初始化决定。 */
    const response = await api.sessions.search(request('matching answer'), signal)

    expect(response.result).toEqual({
      ok: true,
      value: {
        items: [{ sessionId: 'cold', snippet: 'the matching answer' }],
        hasMore: false,
      },
    })
    expect(searchSessions).toHaveBeenCalledOnce()
    /** 中文说明：测试局部值 [query, exec]，由紧邻初始化决定。 */
    const [query, exec] = searchSessions.mock.calls[0] as unknown as [
      SessionSearchRequest,
      { signal: AbortSignal },
    ]
    expect(query).toEqual({
      query: 'matching answer',
      eventFilters: [
        {
          kind: 'type',
          values: ['user/message', 'assistant/message'],
        },
        { kind: 'surface', values: ['current'] },
      ],
      limit: 20,
    })
    expect(exec.signal).toBe(signal)
  })

  it('returns an empty page without invoking the index when no session is visible', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await baseContext()
    /** 中文说明：测试局部值 searchSessions，由紧邻初始化决定。 */
    const searchSessions = vi.fn()
    ctx.provide('sessionQuery', { searchSessions } as never)
    /** 中文说明：测试局部值 api，由紧邻初始化决定。 */
    const api = createApiProxy(ctx, defaults)

    /** 中文说明：测试局部值 response，由紧邻初始化决定。 */
    const response = await api.sessions.search(
      request('anything'),
      new AbortController().signal,
    )

    expect(response.result).toEqual({
      ok: true,
      value: { items: [], hasMore: false },
    })
    expect(searchSessions).not.toHaveBeenCalled()
  })

  it('rejects snippets whose recorded provider violates the Host filters', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await baseContext()
    /** 中文说明：测试局部值 visible，由紧邻初始化决定。 */
    const visible = hit('visible')
    ctx.sessions.create(visible.header.id, { meta: visible.header })
    /** 中文说明：测试局部值 withBestMatch，由紧邻初始化决定。 */
    const withBestMatch = (
      index: number,
      bestMatch: Partial<SessionSearchHit['bestMatch']>,
    ): SessionSearchHit => {
      /** 中文说明：测试局部值 base，由紧邻初始化决定。 */
      const base = hit('visible', index)
      return { ...base, bestMatch: { ...base.bestMatch, ...bestMatch } }
    }
    ctx.provide('sessionQuery', {
      searchSessions: () => Promise.resolve({
        items: [
          withBestMatch(0, { sessionId: sid('hidden') }),
          withBestMatch(1, { surface: 'shadowed' }),
          withBestMatch(2, { type: 'tool/result' }),
          withBestMatch(3, { type: 'user/message', snippet: 'allowed snippet' }),
        ],
      }),
    } as never)

    /** 中文说明：测试局部值 response，由紧邻初始化决定。 */
    const response = await createApiProxy(ctx, defaults).sessions.search(
      request('match'),
      new AbortController().signal,
    )

    expect(response.result).toEqual({
      ok: true,
      value: {
        items: [{ sessionId: 'visible', snippet: 'allowed snippet' }],
        hasMore: false,
      },
    })
  })

  it('pages the globally ranked stream until the 20-item Host boundary is known', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await baseContext()
    /** 中文说明：测试局部值 items，由紧邻初始化决定。 */
    const items = Array.from({ length: 21 }, (_, index) => hit(`visible-${index}`, index))
    /** 中文说明：测试局部值 item，由紧邻初始化决定。 */
    for (const item of items) {
      ctx.sessions.create(item.header.id, { meta: item.header })
    }
    /** 中文说明：测试局部值 searchSessions，由紧邻初始化决定。 */
    const searchSessions = vi.fn()
      .mockResolvedValueOnce({
        items: [hit('hidden-ranked-first'), ...items.slice(0, 19)],
        nextCursor: 'page-2',
      })
      .mockResolvedValueOnce({ items: items.slice(19) })
    ctx.provide('sessionQuery', {
      searchSessions,
    } as never)
    /** 中文说明：测试局部值 response，由紧邻初始化决定。 */
    const response = await createApiProxy(ctx, defaults).sessions.search(
      request('match'),
      new AbortController().signal,
    )

    expect(response.result).toMatchObject({
      ok: true,
      value: { hasMore: true },
    })
    if (!response.result.ok) throw new Error('unreachable')
    expect(response.result.value.items).toHaveLength(20)
    expect(response.result.value.items.at(-1)?.sessionId).toBe('visible-19')
    expect(searchSessions).toHaveBeenCalledTimes(2)
    expect(searchSessions.mock.calls[1]?.[0]).toMatchObject({ cursor: 'page-2' })
  })

  it('learns a provider maxLimit of 10 and collects the 20-item result plus lookahead', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await baseContext()
    /** 中文说明：测试局部值 items，由紧邻初始化决定。 */
    const items = Array.from({ length: 21 }, (_, index) => hit(`visible-${index}`, index))
    /** 中文说明：测试局部值 item，由紧邻初始化决定。 */
    for (const item of items) {
      ctx.sessions.create(item.header.id, { meta: item.header })
    }
    /** 中文说明：测试局部值 invalidLimit，由紧邻初始化决定。 */
    const invalidLimit = new SessionQueryError(
      'provider accepts at most 10 items',
      'SESSION_QUERY_INVALID_LIMIT',
    )
    /** 中文说明：测试局部值 searchSessions，由紧邻初始化决定。 */
    const searchSessions = vi.fn((providerRequest: SessionSearchRequest) => {
      /** 中文说明：测试局部值 limit，由紧邻初始化决定。 */
      const limit = providerRequest.limit
      if (limit === undefined) throw new Error('Host search must request an explicit provider limit')
      if (limit > 10) return Promise.reject(invalidLimit)
      /** 中文说明：测试局部值 offset，由紧邻初始化决定。 */
      const offset = providerRequest.cursor === undefined
        ? 0
        : Number.parseInt(providerRequest.cursor.slice('offset-'.length), 10)
      /** 中文说明：测试局部值 end，由紧邻初始化决定。 */
      const end = Math.min(items.length, offset + limit)
      return Promise.resolve({
        items: items.slice(offset, end),
        ...end < items.length ? { nextCursor: `offset-${end}` } : {},
      })
    })
    ctx.provide('sessionQuery', { searchSessions } as never)

    /** 中文说明：测试局部值 response，由紧邻初始化决定。 */
    const response = await createApiProxy(ctx, defaults).sessions.search(
      request('adaptive-page-limit'),
      new AbortController().signal,
    )

    expect(response.result).toMatchObject({
      ok: true,
      value: { hasMore: true },
    })
    if (!response.result.ok) throw new Error('unreachable')
    expect(response.result.value.items.map(item => item.sessionId))
      .toEqual(items.slice(0, 20).map(item => item.header.id))
    expect(searchSessions.mock.calls.map(([providerRequest]) => ({
      limit: providerRequest.limit,
      cursor: providerRequest.cursor,
    }))).toEqual([
      { limit: 20, cursor: undefined },
      { limit: 10, cursor: undefined },
      { limit: 10, cursor: 'offset-10' },
      { limit: 10, cursor: 'offset-20' },
    ])
  })

  it('counts a page-limit probe inside the 100-call budget', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await baseContext()
    ctx.sessions.create(sid('visible'), { meta: header('visible') })
    /** 中文说明：测试局部值 invalidLimit，由紧邻初始化决定。 */
    const invalidLimit = new SessionQueryError(
      'provider accepts at most 10 items',
      'SESSION_QUERY_INVALID_LIMIT',
    )
    /** 中文说明：测试局部值 searchSessions，由紧邻初始化决定。 */
    const searchSessions = vi.fn((providerRequest: SessionSearchRequest) => {
      if (searchSessions.mock.calls.length === 1) {
        expect(providerRequest).toMatchObject({ limit: 20 })
        return Promise.reject(invalidLimit)
      }
      expect(providerRequest.limit).toBe(10)
      return Promise.resolve({
        items: [],
        nextCursor: `page-${searchSessions.mock.calls.length}`,
      })
    })
    ctx.provide('sessionQuery', { searchSessions } as never)

    /** 中文说明：测试局部值 response，由紧邻初始化决定。 */
    const response = await createApiProxy(ctx, defaults).sessions.search(
      request('endless-pages'),
      new AbortController().signal,
    )

    expect(response.result.ok).toBe(false)
    if (response.result.ok) throw new Error('unreachable')
    expect(response.result.error).toMatchObject({ code: 'internal' })
    expect(response.result.error.message).toContain('100-call work budget')
    expect(searchSessions).toHaveBeenCalledTimes(100)
  })

  it('restarts a stale continuation with its learned limit and original visibility snapshot', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await baseContext()
    /** 中文说明：测试局部值 oldOnly，由紧邻初始化决定。 */
    const oldOnly = hit('old-only', 0)
    /** 中文说明：测试局部值 shared，由紧邻初始化决定。 */
    const shared = hit('shared', 1)
    /** 中文说明：测试局部值 freshFirst，由紧邻初始化决定。 */
    const freshFirst = hit('fresh-first', 2)
    /** 中文说明：测试局部值 freshLast，由紧邻初始化决定。 */
    const freshLast = hit('fresh-last', 3)
    /** 中文说明：测试局部值 item，由紧邻初始化决定。 */
    for (const item of [oldOnly, shared, freshFirst, freshLast]) {
      ctx.sessions.create(item.header.id, { meta: item.header })
    }
    /** 中文说明：测试局部值 late，由紧邻初始化决定。 */
    const late = hit('late-visible', 4)
    /** 中文说明：测试局部值 stale，由紧邻初始化决定。 */
    const stale = new SessionQueryError(
      'provider generation changed',
      'SESSION_QUERY_STALE_CURSOR',
    )
    /** 中文说明：测试局部值 invalidLimit，由紧邻初始化决定。 */
    const invalidLimit = new SessionQueryError(
      'provider accepts at most 10 items',
      'SESSION_QUERY_INVALID_LIMIT',
    )
    /** 中文说明：测试局部值 searchSessions，由紧邻初始化决定。 */
    const searchSessions = vi.fn((providerRequest: SessionSearchRequest) => {
      switch (searchSessions.mock.calls.length) {
        case 1:
          expect(providerRequest).toMatchObject({ limit: 20 })
          expect(providerRequest).not.toHaveProperty('cursor')
          return Promise.reject(invalidLimit)
        case 2:
          expect(providerRequest).toMatchObject({ limit: 10 })
          expect(providerRequest).not.toHaveProperty('cursor')
          return Promise.resolve({
            items: [oldOnly, shared],
            nextCursor: 'old-cursor',
          })
        case 3:
          expect(providerRequest).toMatchObject({ limit: 10 })
          expect(providerRequest.cursor).toBe('old-cursor')
          ctx.sessions.create(late.header.id, { meta: late.header })
          return Promise.reject(stale)
        case 4:
          expect(providerRequest).toMatchObject({ limit: 10 })
          expect(providerRequest).not.toHaveProperty('cursor')
          return Promise.resolve({
            items: [freshFirst, shared],
            nextCursor: 'old-cursor',
          })
        case 5:
          expect(providerRequest).toMatchObject({ limit: 10 })
          expect(providerRequest.cursor).toBe('old-cursor')
          return Promise.resolve({ items: [freshLast, late] })
        default:
          return Promise.reject(new Error('unexpected provider call'))
      }
    })
    ctx.provide('sessionQuery', { searchSessions } as never)

    /** 中文说明：测试局部值 response，由紧邻初始化决定。 */
    const response = await createApiProxy(ctx, defaults).sessions.search(
      request('stale-restart'),
      new AbortController().signal,
    )

    expect(response.result).toEqual({
      ok: true,
      value: {
        items: [
          { sessionId: 'fresh-first', snippet: 'match 2' },
          { sessionId: 'shared', snippet: 'match 1' },
          { sessionId: 'fresh-last', snippet: 'match 3' },
        ],
        hasMore: false,
      },
    })
    expect(searchSessions).toHaveBeenCalledTimes(5)
  })

  it('counts continuous stale restarts against the 100-call budget', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await baseContext()
    /** 中文说明：测试局部值 partial，由紧邻初始化决定。 */
    const partial = hit('partial')
    ctx.sessions.create(partial.header.id, { meta: partial.header })
    /** 中文说明：测试局部值 stale，由紧邻初始化决定。 */
    const stale = new SessionQueryError(
      'provider generation changed',
      'SESSION_QUERY_STALE_CURSOR',
    )
    /** 中文说明：测试局部值 searchSessions，由紧邻初始化决定。 */
    const searchSessions = vi.fn((providerRequest: SessionSearchRequest) => {
      if (searchSessions.mock.calls.length > 100) {
        return Promise.reject(new Error('provider was called after the shared budget'))
      }
      if (providerRequest.cursor !== undefined) return Promise.reject(stale)
      return Promise.resolve({
        items: [partial],
        nextCursor: `cursor-${searchSessions.mock.calls.length}`,
      })
    })
    ctx.provide('sessionQuery', { searchSessions } as never)

    /** 中文说明：测试局部值 response，由紧邻初始化决定。 */
    const response = await createApiProxy(ctx, defaults).sessions.search(
      request('stale-churn'),
      new AbortController().signal,
    )

    expect(response.result.ok).toBe(false)
    if (response.result.ok) throw new Error('unreachable')
    expect(response.result.error.code).toBe('internal')
    expect(response.result.error.message).toContain('100-call work budget')
    expect(response.result).not.toHaveProperty('value')
    expect(searchSessions).toHaveBeenCalledTimes(100)
  })

  it('gives abort priority over a coincident stale continuation failure', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await baseContext()
    ctx.sessions.create(sid('visible'), { meta: header('visible') })
    /** 中文说明：测试局部值 controller，由紧邻初始化决定。 */
    const controller = new AbortController()
    /** 中文说明：测试局部值 stale，由紧邻初始化决定。 */
    const stale = new SessionQueryError(
      'provider generation changed',
      'SESSION_QUERY_STALE_CURSOR',
    )
    /** 中文说明：测试局部值 searchSessions，由紧邻初始化决定。 */
    const searchSessions = vi.fn()
      .mockResolvedValueOnce({ items: [], nextCursor: 'stale-cursor' })
      .mockImplementationOnce(() => {
        controller.abort()
        return Promise.reject(stale)
      })
    ctx.provide('sessionQuery', { searchSessions } as never)

    /** 中文说明：测试局部值 response，由紧邻初始化决定。 */
    const response = await createApiProxy(ctx, defaults).sessions.search(
      request('abort-stale'),
      controller.signal,
    )

    expect(response.result).toMatchObject({
      ok: false,
      error: { code: 'cancelled' },
    })
    expect(searchSessions).toHaveBeenCalledTimes(2)
  })

  it('does not retry a stale first-page failure', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await baseContext()
    ctx.sessions.create(sid('visible'), { meta: header('visible') })
    /** 中文说明：测试局部值 searchSessions，由紧邻初始化决定。 */
    const searchSessions = vi.fn(() => Promise.reject(new SessionQueryError(
      'provider generation changed before paging',
      'SESSION_QUERY_STALE_CURSOR',
    )))
    ctx.provide('sessionQuery', { searchSessions } as never)

    /** 中文说明：测试局部值 response，由紧邻初始化决定。 */
    const response = await createApiProxy(ctx, defaults).sessions.search(
      request('first-page-stale'),
      new AbortController().signal,
    )

    expect(response.result).toMatchObject({
      ok: false,
      error: { code: 'internal' },
    })
    expect(response.result).not.toHaveProperty('value')
    expect(searchSessions).toHaveBeenCalledOnce()
  })

  it('does not adapt an invalid-limit continuation failure', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await baseContext()
    ctx.sessions.create(sid('visible'), { meta: header('visible') })
    /** 中文说明：测试局部值 searchSessions，由紧邻初始化决定。 */
    const searchSessions = vi.fn()
      .mockResolvedValueOnce({ items: [], nextCursor: 'page-2' })
      .mockRejectedValueOnce(new SessionQueryError(
        'continuation limit is invalid',
        'SESSION_QUERY_INVALID_LIMIT',
      ))
    ctx.provide('sessionQuery', { searchSessions } as never)

    /** 中文说明：测试局部值 response，由紧邻初始化决定。 */
    const response = await createApiProxy(ctx, defaults).sessions.search(
      request('continuation-invalid-limit'),
      new AbortController().signal,
    )

    expect(response.result).toMatchObject({
      ok: false,
      error: { code: 'internal' },
    })
    expect(searchSessions).toHaveBeenCalledTimes(2)
    expect(searchSessions.mock.calls.map(([providerRequest]) => (
      providerRequest as SessionSearchRequest
    ).limit))
      .toEqual([20, 20])
  })

  it('stops page-limit adaptation at one item', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await baseContext()
    ctx.sessions.create(sid('visible'), { meta: header('visible') })
    /** 中文说明：测试局部值 searchSessions，由紧邻初始化决定。 */
    const searchSessions = vi.fn((providerRequest: SessionSearchRequest) => Promise.reject(
      new SessionQueryError(
        `provider rejects ${providerRequest.limit}`,
        'SESSION_QUERY_INVALID_LIMIT',
      ),
    ))
    ctx.provide('sessionQuery', { searchSessions } as never)

    /** 中文说明：测试局部值 response，由紧邻初始化决定。 */
    const response = await createApiProxy(ctx, defaults).sessions.search(
      request('minimum-page-limit'),
      new AbortController().signal,
    )

    expect(response.result).toMatchObject({
      ok: false,
      error: { code: 'internal' },
    })
    expect(searchSessions.mock.calls.map(([providerRequest]) => providerRequest.limit))
      .toEqual([20, 10, 5, 2, 1])
  })

  it('gives abort priority over a coincident invalid first-page limit', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await baseContext()
    ctx.sessions.create(sid('visible'), { meta: header('visible') })
    /** 中文说明：测试局部值 controller，由紧邻初始化决定。 */
    const controller = new AbortController()
    /** 中文说明：测试局部值 searchSessions，由紧邻初始化决定。 */
    const searchSessions = vi.fn(() => {
      controller.abort()
      return Promise.reject(new SessionQueryError(
        'provider rejects 20',
        'SESSION_QUERY_INVALID_LIMIT',
      ))
    })
    ctx.provide('sessionQuery', { searchSessions } as never)

    /** 中文说明：测试局部值 response，由紧邻初始化决定。 */
    const response = await createApiProxy(ctx, defaults).sessions.search(
      request('abort-invalid-limit'),
      controller.signal,
    )

    expect(response.result).toMatchObject({
      ok: false,
      error: { code: 'cancelled' },
    })
    expect(searchSessions).toHaveBeenCalledOnce()
  })

  it('rejects an oversized provider page', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await baseContext()
    ctx.sessions.create(sid('visible'), { meta: header('visible') })
    /** 中文说明：测试局部值 oversized，由紧邻初始化决定。 */
    const oversized = Array.from({ length: 21 }, (_, index) => hit(`oversized-${index}`))
    /** 中文说明：测试局部值 searchSessions，由紧邻初始化决定。 */
    const searchSessions = vi.fn(() => Promise.resolve({ items: oversized }))
    ctx.provide('sessionQuery', { searchSessions } as never)

    /** 中文说明：测试局部值 response，由紧邻初始化决定。 */
    const response = await createApiProxy(ctx, defaults).sessions.search(
      request('oversized-page'),
      new AbortController().signal,
    )

    expect(response.result.ok).toBe(false)
    if (response.result.ok) throw new Error('unreachable')
    expect(response.result.error).toMatchObject({ code: 'internal' })
    expect(response.result.error.message).toContain('returned 21 items; maximum is 20')
  })

  it('uses the learned provider limit for the overproduction guard', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await baseContext()
    ctx.sessions.create(sid('visible'), { meta: header('visible') })
    /** 中文说明：测试局部值 oversized，由紧邻初始化决定。 */
    const oversized = Array.from({ length: 11 }, (_, index) => hit(`oversized-${index}`))
    /** 中文说明：测试局部值 searchSessions，由紧邻初始化决定。 */
    const searchSessions = vi.fn((providerRequest: SessionSearchRequest) => {
      if (providerRequest.limit === 20) {
        return Promise.reject(new SessionQueryError(
          'provider accepts at most 10 items',
          'SESSION_QUERY_INVALID_LIMIT',
        ))
      }
      return Promise.resolve({ items: oversized })
    })
    ctx.provide('sessionQuery', { searchSessions } as never)

    /** 中文说明：测试局部值 response，由紧邻初始化决定。 */
    const response = await createApiProxy(ctx, defaults).sessions.search(
      request('adapted-oversized-page'),
      new AbortController().signal,
    )

    expect(response.result.ok).toBe(false)
    if (response.result.ok) throw new Error('unreachable')
    expect(response.result.error).toMatchObject({ code: 'internal' })
    expect(response.result.error.message).toContain('returned 11 items; maximum is 10')
    expect(searchSessions).toHaveBeenCalledTimes(2)
  })

  it('bounds provider snippets to 240 Unicode code points without splitting astral text', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await baseContext()
    /** 中文说明：测试局部值 visible，由紧邻初始化决定。 */
    const visible = hit('visible')
    ctx.sessions.create(visible.header.id, { meta: visible.header })
    /** 中文说明：测试局部值 expected，由紧邻初始化决定。 */
    const expected = `${'x'.repeat(239)}😀`
    /** 中文说明：测试局部值 overlong，由紧邻初始化决定。 */
    const overlong = {
      ...visible,
      bestMatch: {
        ...visible.bestMatch,
        snippet: `${expected}${'y'.repeat(10_000)}`,
      },
    }
    ctx.provide('sessionQuery', {
      searchSessions: () => Promise.resolve({ items: [overlong] }),
    } as never)

    /** 中文说明：测试局部值 response，由紧邻初始化决定。 */
    const response = await createApiProxy(ctx, defaults).sessions.search(
      request('bounded-snippet'),
      new AbortController().signal,
    )

    expect(response.result).toEqual({
      ok: true,
      value: {
        items: [{ sessionId: 'visible', snippet: expected }],
        hasMore: false,
      },
    })
  })

  it('fails closed when the provider repeats a continuation cursor', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await baseContext()
    ctx.sessions.create(sid('visible'), { meta: header('visible') })
    /** 中文说明：测试局部值 searchSessions，由紧邻初始化决定。 */
    const searchSessions = vi.fn()
      .mockResolvedValueOnce({ items: [], nextCursor: 'repeated' })
      .mockResolvedValueOnce({ items: [], nextCursor: 'repeated' })
    ctx.provide('sessionQuery', { searchSessions } as never)

    /** 中文说明：测试局部值 response，由紧邻初始化决定。 */
    const response = await createApiProxy(ctx, defaults).sessions.search(
      request('repeated-cursor'),
      new AbortController().signal,
    )

    expect(response.result.ok).toBe(false)
    if (response.result.ok) throw new Error('unreachable')
    expect(response.result.error).toMatchObject({ code: 'internal' })
    expect(response.result.error.message).toContain('repeated a continuation cursor')
    expect(searchSessions).toHaveBeenCalledTimes(2)
  })

  it('validates a repeated cursor before accepting the authorized lookahead', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await baseContext()
    /** 中文说明：测试局部值 items，由紧邻初始化决定。 */
    const items = Array.from({ length: 21 }, (_, index) => hit(`visible-${index}`, index))
    /** 中文说明：测试局部值 item，由紧邻初始化决定。 */
    for (const item of items) {
      ctx.sessions.create(item.header.id, { meta: item.header })
    }
    /** 中文说明：测试局部值 searchSessions，由紧邻初始化决定。 */
    const searchSessions = vi.fn()
      .mockResolvedValueOnce({ items: items.slice(0, 20), nextCursor: 'repeated' })
      .mockResolvedValueOnce({ items: items.slice(20), nextCursor: 'repeated' })
    ctx.provide('sessionQuery', { searchSessions } as never)

    /** 中文说明：测试局部值 response，由紧邻初始化决定。 */
    const response = await createApiProxy(ctx, defaults).sessions.search(
      request('repeated-lookahead-cursor'),
      new AbortController().signal,
    )

    expect(response.result).toMatchObject({
      ok: false,
      error: { code: 'internal' },
    })
    expect(response.result).not.toHaveProperty('value')
    if (response.result.ok) throw new Error('unreachable')
    expect(response.result.error.message).toContain('repeated a continuation cursor')
    expect(searchSessions).toHaveBeenCalledTimes(2)
  })

  it('does not count duplicate session ids toward the result or lookahead boundary', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await baseContext()
    /** 中文说明：测试局部值 items，由紧邻初始化决定。 */
    const items = Array.from({ length: 21 }, (_, index) => hit(`visible-${index}`, index))
    /** 中文说明：测试局部值 item，由紧邻初始化决定。 */
    for (const item of items) {
      ctx.sessions.create(item.header.id, { meta: item.header })
    }
    /** 中文说明：测试局部值 searchSessions，由紧邻初始化决定。 */
    const searchSessions = vi.fn()
      .mockResolvedValueOnce({ items: items.slice(0, 20), nextCursor: 'page-2' })
      .mockResolvedValueOnce({ items: items.slice(0, 20), nextCursor: 'page-3' })
      .mockResolvedValueOnce({ items: items.slice(20) })
    ctx.provide('sessionQuery', { searchSessions } as never)

    /** 中文说明：测试局部值 response，由紧邻初始化决定。 */
    const response = await createApiProxy(ctx, defaults).sessions.search(
      request('duplicate-pages'),
      new AbortController().signal,
    )

    expect(response.result).toMatchObject({
      ok: true,
      value: { hasMore: true },
    })
    if (!response.result.ok) throw new Error('unreachable')
    expect(response.result.value.items.map(item => item.sessionId)).toEqual(
      items.slice(0, 20).map(item => item.header.id),
    )
    expect(searchSessions).toHaveBeenCalledTimes(3)
  })

  it('cancels on a continuation page and passes the carrier signal to both calls', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await baseContext()
    ctx.sessions.create(sid('visible'), { meta: header('visible') })
    /** 中文说明：测试局部值 controller，由紧邻初始化决定。 */
    const controller = new AbortController()
    /** 中文说明：测试局部值 searchSessions，由紧邻初始化决定。 */
    const searchSessions = vi.fn()
      .mockResolvedValueOnce({ items: [], nextCursor: 'page-2' })
      .mockImplementationOnce(() => {
        controller.abort()
        return Promise.resolve({ items: [] })
      })
    ctx.provide('sessionQuery', { searchSessions } as never)

    /** 中文说明：测试局部值 response，由紧邻初始化决定。 */
    const response = await createApiProxy(ctx, defaults).sessions.search(
      request('cancel-continuation'),
      controller.signal,
    )

    expect(response.result).toMatchObject({
      ok: false,
      error: { code: 'cancelled' },
    })
    expect(searchSessions).toHaveBeenCalledTimes(2)
    /** 中文说明：测试局部值 call，由紧邻初始化决定。 */
    for (const call of searchSessions.mock.calls) {
      expect(call[1]).toEqual({ signal: controller.signal })
    }
  })

  it('keeps visibility sets above SQLite variable limits out of provider bindings', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await baseContext()
    /** 中文说明：测试局部值 cold，由紧邻初始化决定。 */
    const cold = Array.from(
      { length: 32_751 },
      (_, index) => header(`cold-${index}`, `/cold-${index}`),
    )
    ctx.provide('sessionPersistence', {
      list: () => Promise.resolve(cold),
      locate: () => undefined,
    } as never)
    /** 中文说明：测试局部值 searchSessions，由紧邻初始化决定。 */
    const searchSessions = vi.fn((_request: SessionSearchRequest) => Promise.resolve({
      items: [hit('cold-32750')],
    }))
    ctx.provide('sessionQuery', { searchSessions } as never)

    /** 中文说明：测试局部值 response，由紧邻初始化决定。 */
    const response = await createApiProxy(ctx, defaults).sessions.search(
      request('large corpus'),
      new AbortController().signal,
    )

    expect(response.result).toEqual({
      ok: true,
      value: {
        items: [{ sessionId: 'cold-32750', snippet: 'match 0' }],
        hasMore: false,
      },
    })
    expect(searchSessions).toHaveBeenCalledOnce()
    expect(searchSessions.mock.calls[0]?.[0]).not.toHaveProperty('sessionFilters')
  })

  it('propagates cancellation through visible-session collection and stops cold-summary work', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await baseContext()
    /** 中文说明：测试局部值 controller，由紧邻初始化决定。 */
    const controller = new AbortController()
    /** 中文说明：测试局部值 cold，由紧邻初始化决定。 */
    const cold = Array.from({ length: 32 }, (_, index) => header(`cold-${index}`, `/cold-${index}`))
    /** 中文说明：测试局部值 list，由紧邻初始化决定。 */
    const list = vi.fn((signal?: AbortSignal) => {
      expect(signal).toBe(controller.signal)
      return Promise.resolve(cold)
    })
    /** 中文说明：测试局部值 locateCalls，由紧邻初始化决定。 */
    let locateCalls = 0
    ctx.provide('sessionPersistence', {
      list,
      locate: () => {
        locateCalls++
        controller.abort()
        return undefined
      },
    } as never)
    /** 中文说明：测试局部值 searchSessions，由紧邻初始化决定。 */
    const searchSessions = vi.fn()
    ctx.provide('sessionQuery', { searchSessions } as never)

    /** 中文说明：测试局部值 response，由紧邻初始化决定。 */
    const response = await createApiProxy(ctx, defaults).sessions.search(
      request('cancel-during-visibility'),
      controller.signal,
    )

    expect(response.result).toMatchObject({
      ok: false,
      error: { code: 'cancelled' },
    })
    expect(list).toHaveBeenCalledOnce()
    expect(locateCalls).toBe(1)
    expect(searchSessions).not.toHaveBeenCalled()
  })

  it('awaits every started cold-summary stat before returning cancellation', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await baseContext()
    /** 中文说明：测试局部值 controller，由紧邻初始化决定。 */
    const controller = new AbortController()
    /** 中文说明：测试局部值 cold，由紧邻初始化决定。 */
    const cold = Array.from({ length: 16 }, (_, index) => header(`cold-${index}`, `/cold-${index}`))
    /** 中文说明：测试局部值 statGates，由紧邻初始化决定。 */
    const statGates = cold.map(() => Promise.withResolvers<{ mtimeMs: number }>())
    /** 中文说明：测试局部值 statMock，由紧邻初始化决定。 */
    const statMock = vi.mocked(stat)
    statMock.mockClear()
    /** 中文说明：测试局部值 gate，由紧邻初始化决定。 */
    for (const gate of statGates) {
      statMock.mockImplementationOnce((() => gate.promise) as never)
    }
    ctx.provide('sessionPersistence', {
      list: () => Promise.resolve(cold),
      locate: (meta: SessionHeader) => ({ kind: 'jsonl', path: `/logs/${meta.id}.jsonl` }),
    } as never)
    /** 中文说明：测试局部值 searchSessions，由紧邻初始化决定。 */
    const searchSessions = vi.fn()
    ctx.provide('sessionQuery', { searchSessions } as never)

    /** 中文说明：测试局部值 settled，由紧邻初始化决定。 */
    let settled = false
    /** 中文说明：测试局部值 responsePromise，由紧邻初始化决定。 */
    const responsePromise = createApiProxy(ctx, defaults).sessions.search(
      request('cancel-during-cold-stats'),
      controller.signal,
    ).finally(() => {
      settled = true
    })
    await vi.waitFor(() => {
      expect(statMock).toHaveBeenCalledTimes(16)
    })

    controller.abort()
    statGates[0]!.resolve({ mtimeMs: 101 })
    await new Promise<void>(resolve => setImmediate(resolve))
    expect(settled).toBe(false)

    /** 中文说明：测试局部值 gate，由紧邻初始化决定。 */
    for (const gate of statGates.slice(1)) gate.resolve({ mtimeMs: 102 })
    /** 中文说明：测试局部值 response，由紧邻初始化决定。 */
    const response = await responsePromise
    expect(response.result).toMatchObject({
      ok: false,
      error: { code: 'cancelled' },
    })
    expect(searchSessions).not.toHaveBeenCalled()
  })

  it('maps missing composition, query cancellation, and provider failure', async () => {
    /** 中文说明：测试局部值 missingCtx，由紧邻初始化决定。 */
    const missingCtx = await baseContext()
    missingCtx.sessions.create(sid('visible'), { meta: header('visible') })
    /** 中文说明：测试局部值 missingApi，由紧邻初始化决定。 */
    const missingApi = createApiProxy(missingCtx, defaults)
    /** 中文说明：测试局部值 preAborted，由紧邻初始化决定。 */
    const preAborted = new AbortController()
    preAborted.abort()
    /** 中文说明：测试局部值 cancelledBeforeLookup，由紧邻初始化决定。 */
    const cancelledBeforeLookup = await missingApi.sessions.search(
      request('cancel-before-lookup'),
      preAborted.signal,
    )
    expect(cancelledBeforeLookup.result).toMatchObject({
      ok: false,
      error: { code: 'cancelled' },
    })

    /** 中文说明：测试局部值 missing，由紧邻初始化决定。 */
    const missing = await missingApi.sessions.search(
      request('needle'),
      new AbortController().signal,
    )
    expect(missing.result.ok).toBe(false)
    if (missing.result.ok) throw new Error('unreachable')
    expect(missing.result.error.code).toBe('internal')
    expect(missing.result.error.message).toContain('does not mount')

    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await baseContext()
    ctx.sessions.create(sid('visible'), { meta: header('visible') })
    /** 中文说明：测试局部值 aborted，由紧邻初始化决定。 */
    const aborted = new SessionQueryError('provider stopped', 'SESSION_QUERY_ABORTED')
    /** 中文说明：测试局部值 searchSessions，由紧邻初始化决定。 */
    const searchSessions = vi.fn()
      .mockRejectedValueOnce(aborted)
      .mockRejectedValueOnce(new Error('database unavailable'))
    ctx.provide('sessionQuery', { searchSessions } as never)
    /** 中文说明：测试局部值 api，由紧邻初始化决定。 */
    const api = createApiProxy(ctx, defaults)

    /** 中文说明：测试局部值 cancelled，由紧邻初始化决定。 */
    const cancelled = await api.sessions.search(
      request('first'),
      new AbortController().signal,
    )
    expect(cancelled.result).toMatchObject({
      ok: false,
      error: { code: 'cancelled' },
    })

    /** 中文说明：测试局部值 failed，由紧邻初始化决定。 */
    const failed = await api.sessions.search(
      request('second'),
      new AbortController().signal,
    )
    expect(failed.result.ok).toBe(false)
    if (failed.result.ok) throw new Error('unreachable')
    expect(failed.result.error.code).toBe('internal')
    expect(failed.result.error.message).toContain('database unavailable')
  })
})
