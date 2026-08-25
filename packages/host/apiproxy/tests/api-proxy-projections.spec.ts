/**
 * Projection carrier paths of the host ApiProxy: the history tail page's
 * projections block reads the registry's watermark snapshot (asOfSeq = last
 * event seq, one consistent cut); loadOlder pages never carry the block; a
 * composition without the registry serves histories without it; a disposed
 * registration's key leaves subsequent responses; and every unit change is
 * pushed to mux consumers as a session/projection frame minted here.
 */
/*
 * 文件职责：验证Host API Proxy的 api-proxy-projections.spec.ts 行为与边界。
 * 技术维度：TypeScript、Cordis、Fetch/RPC 信封、运行时模式校验、Node/Windows 宿主接口。
 * 产品维度：保证浏览器 API、Hook 或目录操作在各种状态下可靠且可诊断。
 * 逻辑维度：构造请求与宿主服务，调用端点并断言响应和清理。
 * 关键边界：网络与路径输入必须校验；原生对话框和宿主路径操作只允许受信调用。
 * 新手阅读建议：先读请求/响应夹具，再按 API 域、错误码和生命周期场景阅读。
 */

import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { z } from 'zod'
import AgentRegistry, { Inbox } from '@deepseek-ai/dsh-agent'
import { AttachmentStore } from '@deepseek-ai/dsh-attachment'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import type { MuxFrame, RpcRequest } from '@deepseek-ai/dsh-host-apiproxy/api'
import { RpcId } from '@deepseek-ai/dsh-host-apiproxy/api/rpc'
import { createApiProxy } from '@deepseek-ai/dsh-host-apiproxy'

declare module '@deepseek-ai/dsh-session-projection/types' {
  /** 中文说明：类型或类 SessionProjectionStateMap 约束 API、Hook 或目录数据职责。 */
  interface SessionProjectionStateMap {
    'test/last-user': LastUserState
    'test/internal-count': number
  }
  /** 中文说明：类型或类 SessionProjectionMap 约束 API、Hook 或目录数据职责。 */
  interface SessionProjectionMap {
    'test/last-user': { text: string } | null
  }
}

/** 中文说明：测试局部值 nextRpc，由紧邻初始化决定。 */
let nextRpc = 1
/** 中文说明：函数 request 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function request<P>(payload: P): RpcRequest<P> {
  return { rpcId: RpcId(`proj-${String(nextRpc++)}`), payload }
}

/** Whole-value unit folding the latest user/message text; null before the first. */
/* 中文说明：类型或类 LastUserState 约束 API、Hook 或目录数据职责。 */
type LastUserState = { text: string } | null
/** 中文说明：测试局部值 lastUserUnit，由紧邻初始化决定。 */
const lastUserUnit = () => ({
  key: 'test/last-user',
  stateSchema: z.union([z.object({ text: z.string() }), z.null()]),
  init: () => null,
  apply: (state, event) => (event.type === 'user/message'
    ? { text: (event.data.content[0] as { text?: string }).text ?? '' }
    : state),
  wire: {
    viewSchema: z.union([z.object({ text: z.string() }), z.null()]),
    view: state => state,
  },
  stateVersion: 1,
}) satisfies ProjectionDefinition<'test/last-user', LastUserState>

/** 中文说明：测试局部值 internalCountUnit，由紧邻初始化决定。 */
const internalCountUnit = () => ({
  key: 'test/internal-count',
  stateSchema: z.number().int().nonnegative(),
  init: () => 0,
  apply: (state: number) => state + 1,
  stateVersion: 1,
}) satisfies ProjectionDefinition<'test/internal-count', number>

/** 中文说明：函数 harness 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
async function harness(withRegistry: boolean): Promise<{ ctx: Context; session: Session }> {
  /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(UserQuestionService)
  await ctx.plugin(AgentRegistry)
  if (withRegistry) await ctx.plugin(SessionProjectionRegistry)
  /** 中文说明：测试局部值 session，由紧邻初始化决定。 */
  const session = ctx.sessions.create()
  // The gateway reads both the session and durable inbox baseline.
  ctx.agents.register({ id: session.id, session, inbox: new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} }), status: 'idle', ctx } as Agent)
  return { ctx, session }
}

/** Append `count` user messages so the log has paginable message boundaries. */
/* 中文说明：函数 seedMessages 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function seedMessages(session: Session, count: number): void {
  /** 中文说明：测试局部值 i，由紧邻初始化决定。 */
  for (let i = 0; i < count; i++) {
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: `m${i}` }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
  }
}

/** 中文说明：测试局部值 api，由紧邻初始化决定。 */
const api = (ctx: Context) => createApiProxy(ctx, { defaultModelSelection: () => ({ provider: 'p', model: 'm' }), cwd: '/tmp' })

describe('session.history projections block', () => {
  it('serves the unit value on the tail page with asOfSeq = last event seq', async () => {
    /** 中文说明：测试局部值 { ctx, session }，由紧邻初始化决定。 */
    const { ctx, session } = await harness(true)
    ctx.sessionProjections.register(lastUserUnit())
    seedMessages(session, 3)
    /** 中文说明：测试局部值 response，由紧邻初始化决定。 */
    const response = await api(ctx).sessions.history(request({ sessionId: session.id }))
    expect(response.result.ok).toBe(true)
    if (!response.result.ok) throw new Error('unreachable')
    /** 中文说明：测试局部值 { events, projections }，由紧邻初始化决定。 */
    const { events, projections } = response.result.value
    expect(projections).toBeDefined()
    expect(projections?.asOfSeq).toBe(session.seq - 1)
    expect(projections?.values['test/last-user']).toEqual({ text: 'm2' })
    // asOfSeq IS the window tail: the last served event carries it.
    expect(events.at(-1)?.event.seq).toBe(projections?.asOfSeq)
  })

  it('publishes the attachments imageLimits as a constant unit while both seams are composed', async () => {
    /** 中文说明：测试局部值 { ctx, session }，由紧邻初始化决定。 */
    const { ctx, session } = await harness(true)
    /** 中文说明：测试局部值 limits，由紧邻初始化决定。 */
    const limits = {
      maxImageBytes: 5 * 1024 * 1024,
      maxImagesPerMessage: 20,
      maxMessageImageBytes: 100 * 1024 * 1024,
      maxImagePixels: 40_000_000,
      maxImageDimension: 2000,
      mediaTypes: ['image/png'] as const,
    }
    await ctx.plugin(class extends AttachmentStore {
      readonly imageLimits = limits
      validateImage(): Promise<void> { return Promise.resolve() }
      saveImage(): Promise<never> { return Promise.reject(new Error('unused')) }
      readImage(): Promise<never> { return Promise.reject(new Error('unused')) }
    })
    /** 中文说明：测试局部值 gateway，由紧邻初始化决定。 */
    const gateway = api(ctx)
    seedMessages(session, 2)
    /** 中文说明：测试局部值 response，由紧邻初始化决定。 */
    const response = await gateway.sessions.history(request({ sessionId: session.id }))
    if (!response.result.ok) throw new Error('history failed')
    expect(response.result.value.projections?.values['imageLimits']).toEqual(limits)
    // Constant unit: appending events must never broadcast an imageLimits frame.
    await new Promise(resolve => setTimeout(resolve, 0))
    /** 中文说明：测试局部值 abort，由紧邻初始化决定。 */
    const abort = new AbortController()
    /** 中文说明：测试局部值 stream，由紧邻初始化决定。 */
    const stream = gateway.events.mux({ rpcId: RpcId('t-limits-mux'), payload: {} }, abort.signal)
    /** 中文说明：测试局部值 frames，由紧邻初始化决定。 */
    const frames: MuxFrame[] = []
    /** 中文说明：测试局部值 drained，由紧邻初始化决定。 */
    const drained = (async () => {
      /** 中文说明：测试局部值 envelope，由紧邻初始化决定。 */
      for await (const envelope of stream) {
        frames.push(envelope.payload)
        if (frames.some(f => f.type === 'session/event')) abort.abort()
      }
    })().catch(() => {})
    seedMessages(session, 1)
    await drained
    expect(frames.some(f => f.type === 'session/projection' && f.key === 'imageLimits')).toBe(false)
  })

  it('leaves the imageLimits key absent while no attachment service is composed', async () => {
    /** 中文说明：测试局部值 { ctx, session }，由紧邻初始化决定。 */
    const { ctx, session } = await harness(true)
    seedMessages(session, 1)
    /** 中文说明：测试局部值 response，由紧邻初始化决定。 */
    const response = await api(ctx).sessions.history(request({ sessionId: session.id }))
    if (!response.result.ok) throw new Error('history failed')
    expect(response.result.value.projections).toBeDefined()
    expect('imageLimits' in (response.result.value.projections?.values ?? {})).toBe(false)
  })

  it('never carries the block on loadOlder pages (beforeSeq present)', async () => {
    /** 中文说明：测试局部值 { ctx, session }，由紧邻初始化决定。 */
    const { ctx, session } = await harness(true)
    ctx.sessionProjections.register(lastUserUnit())
    seedMessages(session, 5)
    /** 中文说明：测试局部值 older，由紧邻初始化决定。 */
    const older = await api(ctx).sessions.history(request({ sessionId: session.id, beforeSeq: 3, maxMessages: 2 }))
    expect(older.result.ok).toBe(true)
    if (!older.result.ok) throw new Error('unreachable')
    expect('projections' in older.result.value).toBe(false)
  })

  it('serves no block when the composition has no projection registry', async () => {
    /** 中文说明：测试局部值 { ctx, session }，由紧邻初始化决定。 */
    const { ctx, session } = await harness(false)
    seedMessages(session, 2)
    /** 中文说明：测试局部值 response，由紧邻初始化决定。 */
    const response = await api(ctx).sessions.history(request({ sessionId: session.id }))
    expect(response.result.ok).toBe(true)
    if (!response.result.ok) throw new Error('unreachable')
    expect('projections' in response.result.value).toBe(false)
  })

  it('never exposes a host-only unit through history, listing, or push frames', async () => {
    /** 中文说明：测试局部值 { ctx, session }，由紧邻初始化决定。 */
    const { ctx, session } = await harness(true)
    ctx.sessionProjections.register(internalCountUnit())
    /** 中文说明：测试局部值 proxy，由紧邻初始化决定。 */
    const proxy = api(ctx)
    await new Promise(resolve => setTimeout(resolve, 0))
    /** 中文说明：测试局部值 abort，由紧邻初始化决定。 */
    const abort = new AbortController()
    /** 中文说明：测试局部值 frames，由紧邻初始化决定。 */
    const frames: MuxFrame[] = []
    /** 中文说明：测试局部值 drained，由紧邻初始化决定。 */
    const drained = (async () => {
      /** 中文说明：测试局部值 envelope，由紧邻初始化决定。 */
      for await (const envelope of proxy.events.mux({ rpcId: RpcId('t-host-only-mux'), payload: {} }, abort.signal)) {
        frames.push(envelope.payload)
        if (envelope.payload.type === 'session/event') abort.abort()
      }
    })().catch(() => {})

    seedMessages(session, 1)
    await drained

    /** 中文说明：测试局部值 history，由紧邻初始化决定。 */
    const history = await proxy.sessions.history(request({ sessionId: session.id }))
    if (!history.result.ok) throw new Error('history failed')
    expect('test/internal-count' in (history.result.value.projections?.values ?? {})).toBe(false)
    /** 中文说明：测试局部值 listing，由紧邻初始化决定。 */
    const listing = await proxy.sessions.list(request({}))
    if (!listing.result.ok) throw new Error('listing failed')
    /** 中文说明：测试局部值 row，由紧邻初始化决定。 */
    const row = listing.result.value.items.find(item => item.sessionId === session.id)
    expect('test/internal-count' in (row?.projections?.values ?? {})).toBe(false)
    expect(frames.some(frame => frame.type === 'session/projection' && frame.key === 'test/internal-count')).toBe(false)
  })

  it('drops a disposed registration from subsequent tail pages (empty block, key absent)', async () => {
    /** 中文说明：测试局部值 { ctx, session }，由紧邻初始化决定。 */
    const { ctx, session } = await harness(true)
    /** 中文说明：测试局部值 dispose，由紧邻初始化决定。 */
    const dispose = ctx.sessionProjections.register(lastUserUnit())
    seedMessages(session, 1)
    /** 中文说明：测试局部值 proxy，由紧邻初始化决定。 */
    const proxy = api(ctx)
    /** 中文说明：测试局部值 before，由紧邻初始化决定。 */
    const before = await proxy.sessions.history(request({ sessionId: session.id }))
    if (!before.result.ok) throw new Error('unreachable')
    expect(before.result.value.projections?.values['test/last-user']).toEqual({ text: 'm0' })

    dispose()
    /** 中文说明：测试局部值 after，由紧邻初始化决定。 */
    const after = await proxy.sessions.history(request({ sessionId: session.id }))
    if (!after.result.ok) throw new Error('unreachable')
    // The registry stays mounted; only the disposed key leaves while the
    // gateway-owned Session-list unit remains.
    expect(after.result.value.projections?.asOfSeq).toBe(session.seq - 1)
    expect('test/last-user' in (after.result.value.projections?.values ?? {})).toBe(false)
    expect(after.result.value.projections?.values.sessionListMetadata).toEqual({
      blank: true,
      lastPromptAt: session.events.at(-1)?.time,
    })
  })

  it('removes the gateway-owned Session-list unit when the gateway fiber unloads', async () => {
    /** 中文说明：测试局部值 { ctx, session }，由紧邻初始化决定。 */
    const { ctx, session } = await harness(true)
    expect('sessionListMetadata' in ctx.sessionProjections.snapshot(session).values).toBe(false)
    /** 中文说明：测试局部值 fiber，由紧邻初始化决定。 */
    const fiber = ctx.plugin(Object.assign((gatewayCtx: Context) => {
      createApiProxy(gatewayCtx, { defaultModelSelection: () => ({ provider: 'p', model: 'm' }), cwd: '/tmp' })
    }, { inject: ['sessions', 'agents', 'userQuestions', 'sessionProjections'] }))
    await fiber.await()
    await vi.waitFor(() => {
      expect(ctx.sessionProjections.snapshot(session).values.sessionListMetadata)
        .toEqual({ blank: true, lastPromptAt: null })
    })
    await fiber.dispose()
    expect('sessionListMetadata' in ctx.sessionProjections.snapshot(session).values).toBe(false)
  })
})

describe('session.list projections column', () => {
  it('serves attached rows from the live registry cut, watermarked for client seeding', async () => {
    /** 中文说明：测试局部值 { ctx, session }，由紧邻初始化决定。 */
    const { ctx, session } = await harness(true)
    ctx.sessionProjections.register(lastUserUnit())
    /** 中文说明：测试局部值 gateway，由紧邻初始化决定。 */
    const gateway = api(ctx)
    await new Promise(resolve => setTimeout(resolve, 0))
    session.append('turn/start', { turn: 1 })
    seedMessages(session, 1)
    /** 中文说明：测试局部值 response，由紧邻初始化决定。 */
    const response = await gateway.sessions.list(request({}))
    if (!response.result.ok) throw new Error('unreachable')
    /** 中文说明：测试局部值 row，由紧邻初始化决定。 */
    const row = response.result.value.items.find(item => item.sessionId === session.id)
    expect(row?.projections?.values['test/last-user']).toEqual({ text: 'm0' })
    expect(row?.projections?.values.sessionListMetadata).toEqual({
      blank: false,
      lastPromptAt: session.events.at(-1)?.time,
    })
    expect(row?.projections?.asOfSeq).toBe(session.seq - 1)
  })

  it('omits the column entirely when no registry is mounted', async () => {
    /** 中文说明：测试局部值 { ctx, session }，由紧邻初始化决定。 */
    const { ctx, session } = await harness(false)
    seedMessages(session, 1)
    /** 中文说明：测试局部值 response，由紧邻初始化决定。 */
    const response = await api(ctx).sessions.list(request({}))
    if (!response.result.ok) throw new Error('unreachable')
    /** 中文说明：测试局部值 row，由紧邻初始化决定。 */
    const row = response.result.value.items.find(item => item.sessionId === session.id)
    expect(row).toBeDefined()
    expect(row !== undefined && 'projections' in row).toBe(false)
  })

  it('serves cold rows from the persisted projection cache with zero log loads', async () => {
    /** 中文说明：测试局部值 { ctx }，由紧邻初始化决定。 */
    const { ctx } = await harness(true)
    /** 中文说明：测试局部值 coldId，由紧邻初始化决定。 */
    const coldId = SessionId('session-cold-listing')
    /** 中文说明：测试局部值 load，由紧邻初始化决定。 */
    const load = () => { throw new Error('list must not load event logs') }
    ctx.provide('sessionPersistence', {
      list: async () => [{ version: 0, id: coldId, createdAt: 5, cwd: '/tmp' }],
      locate: () => undefined,
      load,
      inspect: load,
      readFrom: load,
    } as never)
    ctx.provide('sessionProjectionCache', {
      // The carrier hands the listed header through as the identity witness.
      cachedSnapshot: (meta: { id: unknown; createdAt: number }) =>
        (meta.id === coldId && meta.createdAt === 5
          ? { asOfSeq: 7, values: { 'test/last-user': { text: 'cached' } } }
          : undefined),
    } as never)
    /** 中文说明：测试局部值 response，由紧邻初始化决定。 */
    const response = await api(ctx).sessions.list(request({}))
    if (!response.result.ok) throw new Error('unreachable')
    /** 中文说明：测试局部值 row，由紧邻初始化决定。 */
    const row = response.result.value.items.find(item => item.sessionId === coldId)
    expect(row?.running).toBe(false)
    expect(row?.projections).toEqual({ asOfSeq: 7, values: { 'test/last-user': { text: 'cached' } } })
  })

  it('cold rows without a cache plugin (or without a stored row) just lack the column', async () => {
    /** 中文说明：测试局部值 { ctx }，由紧邻初始化决定。 */
    const { ctx } = await harness(true)
    /** 中文说明：测试局部值 coldId，由紧邻初始化决定。 */
    const coldId = SessionId('session-cold-uncached')
    ctx.provide('sessionPersistence', {
      list: async () => [{ version: 0, id: coldId, createdAt: 5, cwd: '/tmp' }],
      locate: () => undefined,
    } as never)
    /** 中文说明：测试局部值 response，由紧邻初始化决定。 */
    const response = await api(ctx).sessions.list(request({}))
    if (!response.result.ok) throw new Error('unreachable')
    /** 中文说明：测试局部值 row，由紧邻初始化决定。 */
    const row = response.result.value.items.find(item => item.sessionId === coldId)
    expect(row).toBeDefined()
    expect(row !== undefined && 'projections' in row).toBe(false)
  })

  it('a throwing column read degrades that row, never the listing', async () => {
    /** 中文说明：测试局部值 { ctx, session }，由紧邻初始化决定。 */
    const { ctx, session } = await harness(true)
    ctx.sessionProjections.register({
      ...lastUserUnit(),
      wire: {
        viewSchema: z.union([z.object({ text: z.string() }), z.null()]),
        view: () => { throw new Error('unit exploded') },
      },
    })
    seedMessages(session, 1)
    /** 中文说明：测试局部值 response，由紧邻初始化决定。 */
    const response = await api(ctx).sessions.list(request({}))
    if (!response.result.ok) throw new Error('unreachable')
    /** 中文说明：测试局部值 row，由紧邻初始化决定。 */
    const row = response.result.value.items.find(item => item.sessionId === session.id)
    expect(row).toBeDefined()
    expect(row !== undefined && 'projections' in row).toBe(false)
  })
})

describe('session/projection push frame', () => {
  /** Drain frames until `count` session/projection frames arrived. */
  /* 中文说明：函数 collect 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
  async function collect(iterable: AsyncIterable<RpcRequest<MuxFrame>>, count: number, abort: AbortController): Promise<MuxFrame[]> {
    /** 中文说明：测试局部值 frames，由紧邻初始化决定。 */
    const frames: MuxFrame[] = []
    /** 中文说明：测试局部值 envelope，由紧邻初始化决定。 */
    for await (const envelope of iterable) {
      frames.push(envelope.payload)
      if (frames.filter(f => f.type === 'session/projection').length >= count) abort.abort()
    }
    return frames
  }

  it('broadcasts a frame per changed unit with the causing seq, and none for same-reference applies', async () => {
    /** 中文说明：测试局部值 { ctx, session }，由紧邻初始化决定。 */
    const { ctx, session } = await harness(true)
    ctx.sessionProjections.register(lastUserUnit())
    /** 中文说明：测试局部值 proxy，由紧邻初始化决定。 */
    const proxy = api(ctx)
    // The gateway's onChanged subscription lives in an inject child whose
    // fiber activates asynchronously; yield until it lands before appending.
    await new Promise(resolve => setTimeout(resolve, 0))
    /** 中文说明：测试局部值 abort，由紧邻初始化决定。 */
    const abort = new AbortController()
    /** 中文说明：测试局部值 stream，由紧邻初始化决定。 */
    const stream = proxy.events.mux({ rpcId: RpcId('t-proj-mux'), payload: {} }, abort.signal)
    /** 中文说明：测试局部值 collected，由紧邻初始化决定。 */
    const collected = collect(stream, 5, abort)

    /** 中文说明：测试局部值 now，由紧邻初始化决定。 */
    const now = vi.spyOn(Date, 'now').mockReturnValue(100)
    seedMessages(session, 1)
    now.mockReturnValue(200)
    session.append('turn/start', { turn: 1 })
    now.mockReturnValue(300)
    seedMessages(session, 1)
    now.mockRestore()

    /** 中文说明：测试局部值 frames，由紧邻初始化决定。 */
    const frames = await collected
    /** 中文说明：测试局部值 pushes，由紧邻初始化决定。 */
    const pushes = frames.filter(
      (f): f is Extract<MuxFrame, { type: 'session/projection' }> =>
        f.type === 'session/projection' && f.key === 'test/last-user',
    )
    expect(pushes).toEqual([
      { type: 'session/projection', sessionId: session.id, key: 'test/last-user', value: { text: 'm0' }, seq: 0 },
      { type: 'session/projection', sessionId: session.id, key: 'test/last-user', value: { text: 'm0' }, seq: 2 },
    ])
    expect(frames.filter(
      (f): f is Extract<MuxFrame, { type: 'session/projection' }> =>
        f.type === 'session/projection' && f.key === 'sessionListMetadata',
    )).toEqual([
      { type: 'session/projection', sessionId: session.id, key: 'sessionListMetadata', value: { blank: true, lastPromptAt: 100 }, seq: 0 },
      { type: 'session/projection', sessionId: session.id, key: 'sessionListMetadata', value: { blank: false, lastPromptAt: 100 }, seq: 1 },
      { type: 'session/projection', sessionId: session.id, key: 'sessionListMetadata', value: { blank: false, lastPromptAt: 300 }, seq: 2 },
    ])
    // Frame seq aligns with the tail block's asOfSeq vocabulary (higher-seq-wins compatible).
    /** 中文说明：测试局部值 tail，由紧邻初始化决定。 */
    const tail = await proxy.sessions.history(request({ sessionId: session.id }))
    if (!tail.result.ok) throw new Error('unreachable')
    expect(tail.result.value.projections?.asOfSeq).toBe(pushes.at(-1)?.seq)
  })

  it('emits no projection frames when the composition has no registry', async () => {
    /** 中文说明：测试局部值 { ctx, session }，由紧邻初始化决定。 */
    const { ctx, session } = await harness(false)
    /** 中文说明：测试局部值 proxy，由紧邻初始化决定。 */
    const proxy = api(ctx)
    /** 中文说明：测试局部值 abort，由紧邻初始化决定。 */
    const abort = new AbortController()
    /** 中文说明：测试局部值 stream，由紧邻初始化决定。 */
    const stream = proxy.events.mux({ rpcId: RpcId('t-noproj-mux'), payload: {} }, abort.signal)
    /** 中文说明：测试局部值 frames，由紧邻初始化决定。 */
    const frames: MuxFrame[] = []
    /** 中文说明：测试局部值 drained，由紧邻初始化决定。 */
    const drained = (async () => {
      /** 中文说明：测试局部值 envelope，由紧邻初始化决定。 */
      for await (const envelope of stream) {
        frames.push(envelope.payload)
        if (frames.filter(f => f.type === 'session/event').length >= 2) abort.abort()
      }
    })()
    seedMessages(session, 2)
    await drained
    expect(frames.some(f => f.type === 'session/projection')).toBe(false)
  })
})
