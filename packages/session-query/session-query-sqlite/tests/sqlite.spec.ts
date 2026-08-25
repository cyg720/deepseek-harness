/**
 * 文件职责：验证 sqlite.spec.ts 覆盖的会话查询行为、持久化与异常场景。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、SQLite 或会话事件日志。
 * 产品维度：保障 Agent 的会话查询结果稳定、可追踪且可恢复。
 * 逻辑维度：准备会话和存储数据，执行查询或恢复流程，再核对结果、错误与清理。
 * 关键边界：持久化数据属于不可信输入；事件必须可重放；临时数据库与异步资源必须释放。
 * 新手阅读建议：先看测试夹具和查询条件，再读正常场景，最后关注重启、损坏与失败路径。
 */
import { createAssistantMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context, type Fiber } from '@deepseek-ai/cordis'
import { DatabaseSync } from 'node:sqlite'
import { chmod, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import SessionStore, { SESSION_FORMAT_VERSION, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionHeader, SessionId as SessionIdType } from '@deepseek-ai/dsh-session'
import SessionPersistence, { SessionPersistenceRevision } from '@deepseek-ai/dsh-session-persistence'
import type { SessionPersistenceSnapshot } from '@deepseek-ai/dsh-session-persistence'
import SqliteSessionPersistence from '@deepseek-ai/dsh-session-persistence-sqlite'
import SqliteSessionQueryEngine, {
  SESSION_QUERY_SQLITE_SCHEMA_VERSION,
} from '@deepseek-ai/dsh-session-query-sqlite'
import {
  SESSION_QUERY_DEFAULT_PERSISTED_INSPECT_CONCURRENCY,
  SessionQueryError,
  SessionSearchCursor,
  /** 中文说明：type SessionAvailability 定义本测试所需的数据或行为，用于表达会话查询场景。 */
  type SessionAvailability,
  /** 中文说明：type SessionQueryErrorCode 定义本测试所需的数据或行为，用于表达会话查询场景。 */
  type SessionQueryErrorCode,
  /** 中文说明：type SessionSearchRequest 定义本测试所需的数据或行为，用于表达会话查询场景。 */
  type SessionSearchRequest,
} from '@deepseek-ai/dsh-session-query'

/** 中文说明：变量 temporaryDirectories 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const temporaryDirectories: string[] = []

afterEach(async () => {
  /** 中文说明：该循环依次处理输入数据；循环变量仅在当前循环中有效。 */
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true })
  }
})

/** 中文说明：函数 temporaryPath 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function temporaryPath(name = 'search.db'): Promise<string> {
  /** 中文说明：变量 directory 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const directory = await mkdtemp(join(tmpdir(), 'dsh-session-search-'))
  temporaryDirectories.push(directory)
  return join(directory, name)
}

/** 中文说明：函数 header 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function header(id: string, createdAt = 1, extra: Partial<SessionHeader> = {}): SessionHeader {
  return { version: SESSION_FORMAT_VERSION, id: SessionId(id), createdAt, ...extra }
}

/** 中文说明：函数 messageEvents 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function messageEvents(text: string, time = 1): SessionEvent[] {
  return [{
    type: 'user/message',
    seq: 0,
    time,
    data: createUserMessage({
      content: [{ type: 'text', text }], source: { kind: 'user' },
    }),
    surfaceOp: 'append',
  }]
}

/** 中文说明：函数 expectCode 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function expectCode(code: SessionQueryErrorCode): Error {
  return expect.objectContaining({ code }) as Error
}

/** 中文说明：函数 replaceCursorOffset 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function replaceCursorOffset(
  cursor: ReturnType<typeof SessionSearchCursor>,
  offset: number,
): ReturnType<typeof SessionSearchCursor> {
  /** 中文说明：变量 payload 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const payload = JSON.parse(
    Buffer.from(cursor, 'base64url').toString('utf8'),
  ) as Record<string, unknown>
  return SessionSearchCursor(Buffer.from(JSON.stringify({ ...payload, offset }), 'utf8').toString('base64url'))
}

/** 中文说明：class TestPersistence 定义本测试所需的数据或行为，用于表达会话查询场景。 */
class TestPersistence extends SessionPersistence {
  override readonly supportsRawArtifacts = false

  static entries = new Map<SessionIdType, { meta: SessionHeader; events: SessionEvent[] }>()
  static revisions = new Map<SessionIdType, number>()
  static nextRevision = 0
  static loads = new Map<SessionIdType, number>()
  static inspections = new Map<SessionIdType, number>()
  static inspectSignals: Array<AbortSignal | undefined> = []
  static snapshotSignals: Array<AbortSignal | undefined> = []
  static loadEffect: ((entry: { meta: SessionHeader; events: SessionEvent[] }) => void) | undefined
  static inspectEffect: ((
    entry: { meta: SessionHeader; events: SessionEvent[] },
    signal?: AbortSignal,
  ) => void | Promise<void>) | undefined
  static listGate: Promise<void> | undefined
  static listStarted: (() => void) | undefined
  static snapshotEffect: ((signal?: AbortSignal) => void | Promise<void>) | undefined
  static snapshotOverride: (() => SessionPersistenceSnapshot[]) | undefined
  static failure: unknown

  locate(_meta: SessionHeader): undefined {
    return undefined
  }

  static reset(entries: readonly { meta: SessionHeader; events: SessionEvent[] }[] = []): void {
    this.entries = new Map()
    this.revisions = new Map()
    this.loads = new Map()
    this.inspections = new Map()
    this.inspectSignals = []
    this.snapshotSignals = []
    this.loadEffect = undefined
    this.inspectEffect = undefined
    /** 中文说明：该循环依次处理输入数据；循环变量仅在当前循环中有效。 */
    for (const entry of entries) this.set(entry)
    this.listGate = undefined
    this.listStarted = undefined
    this.snapshotEffect = undefined
    this.snapshotOverride = undefined
    this.failure = undefined
  }

  static set(entry: { meta: SessionHeader; events: SessionEvent[] }): void {
    this.entries.set(entry.meta.id, structuredClone(entry))
    this.revisions.set(entry.meta.id, ++this.nextRevision)
  }

  create(meta: SessionHeader): Promise<void> {
    TestPersistence.set({ meta, events: [] })
    return Promise.resolve()
  }

  append(id: SessionIdType, events: readonly SessionEvent[]): Promise<void> {
    /** 中文说明：变量 entry 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const entry = TestPersistence.entries.get(id)
    if (entry === undefined) return Promise.reject(new Error('missing test session'))
    entry.events.push(...structuredClone(events))
    TestPersistence.revisions.set(id, ++TestPersistence.nextRevision)
    return Promise.resolve()
  }

  async load(id: SessionIdType): Promise<{ meta: SessionHeader; events: SessionEvent[] }> {
    TestPersistence.loads.set(id, (TestPersistence.loads.get(id) ?? 0) + 1)
    if (TestPersistence.failure !== undefined) throw TestPersistence.failure
    /** 中文说明：变量 entry 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const entry = TestPersistence.entries.get(id)
    if (entry === undefined) throw new Error('missing test session')
    if (TestPersistence.loadEffect !== undefined) {
      /** 中文说明：变量 effect 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const effect = TestPersistence.loadEffect
      TestPersistence.loadEffect = undefined
      effect(entry)
      TestPersistence.revisions.set(id, ++TestPersistence.nextRevision)
    }
    return structuredClone(entry)
  }

  async inspect(id: SessionIdType, signal?: AbortSignal): Promise<{ meta: SessionHeader; events: SessionEvent[] }> {
    TestPersistence.inspections.set(id, (TestPersistence.inspections.get(id) ?? 0) + 1)
    TestPersistence.inspectSignals.push(signal)
    if (TestPersistence.failure !== undefined) throw TestPersistence.failure
    /** 中文说明：变量 entry 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const entry = TestPersistence.entries.get(id)
    if (entry === undefined) throw new Error('missing test session')
    await TestPersistence.inspectEffect?.(entry, signal)
    TestPersistence.inspectEffect = undefined
    return structuredClone(entry)
  }

  async readFrom(id: SessionIdType, fromSeq: number, signal?: AbortSignal): Promise<{ meta: SessionHeader; events: SessionEvent[] }> {
    /** 中文说明：变量 whole 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const whole = await this.inspect(id, signal)
    return { meta: whole.meta, events: whole.events.filter(event => event.seq >= fromSeq) }
  }

  async list(): Promise<SessionHeader[]> {
    TestPersistence.listStarted?.()
    await TestPersistence.listGate
    if (TestPersistence.failure !== undefined) throw TestPersistence.failure
    return [...TestPersistence.entries.values()].map(entry => structuredClone(entry.meta))
  }


  async listSnapshots(signal?: AbortSignal): Promise<SessionPersistenceSnapshot[]> {
    TestPersistence.snapshotSignals.push(signal)
    TestPersistence.listStarted?.()
    await TestPersistence.listGate
    if (TestPersistence.failure !== undefined) throw TestPersistence.failure
    /** 中文说明：变量 snapshots 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const snapshots = TestPersistence.snapshotOverride?.()
      ?? [...TestPersistence.entries.values()].map(entry => ({
        header: structuredClone(entry.meta),
        revision: SessionPersistenceRevision(`test:${TestPersistence.revisions.get(entry.meta.id)}`),
      }))
    await TestPersistence.snapshotEffect?.(signal)
    return snapshots
  }
}

/** 中文说明：函数 liveContext 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function liveContext(config: ConstructorParameters<typeof SqliteSessionQueryEngine>[1] = { path: ':memory:' }): Promise<Context> {
  /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SqliteSessionQueryEngine, config)
  return ctx
}

describe('SQLite session search', () => {
  it('defaults and validates opening policy and persisted inspection concurrency through its Cordis config', async () => {
    /** 中文说明：变量 defaultCtx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const defaultCtx = await liveContext()
    expect((defaultCtx.sessionQuery as SqliteSessionQueryEngine).config.openAt).toBe('startup')
    expect((defaultCtx.sessionQuery as SqliteSessionQueryEngine).config.persistedInspectConcurrency)
      .toBe(SESSION_QUERY_DEFAULT_PERSISTED_INSPECT_CONCURRENCY)

    /** 中文说明：变量 configuredValue 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const configuredValue = 2
    /** 中文说明：变量 configured 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const configured = new SqliteSessionQueryEngine.Config({
      path: ':memory:',
      openAt: 'first-search',
      persistedInspectConcurrency: configuredValue,
    })
    expect(configured.openAt).toBe('first-search')
    expect(configured.persistedInspectConcurrency).toBe(configuredValue)
    /** 中文说明：变量 configuredCtx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const configuredCtx = await liveContext(configured)
    expect((configuredCtx.sessionQuery as SqliteSessionQueryEngine).config.persistedInspectConcurrency)
      .toBe(configuredValue)

    /** 中文说明：该循环依次处理输入数据；循环变量仅在当前循环中有效。 */
    for (const persistedInspectConcurrency of [0, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => new SqliteSessionQueryEngine.Config({
        path: ':memory:',
        persistedInspectConcurrency,
      })).toThrow()
    }
    expect(() => new SqliteSessionQueryEngine.Config({
      path: ':memory:',
      openAt: 'later' as never,
    })).toThrow()
  })

  it('mounts and disposes first-search mode without opening its database', async () => {
    /** 中文说明：变量 path 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const path = await temporaryPath('unopened.db')
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    /** 中文说明：变量 search 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const search = await ctx.plugin(SqliteSessionQueryEngine, {
      path,
      openAt: 'first-search',
    })

    await expect(stat(path)).rejects.toMatchObject({ code: 'ENOENT' })
    await search.dispose()
    await expect(stat(path)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('refuses search in never mode while inherited reads and traces keep working', async () => {
    /** 中文说明：变量 path 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const path = await temporaryPath('never-mode.db')
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    /** 中文说明：变量 search 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const search = await ctx.plugin(SqliteSessionQueryEngine, { path, openAt: 'never' })
    /** 中文说明：变量 service 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const service = ctx.sessionQuery as SqliteSessionQueryEngine
    expect(service.config.openAt).toBe('never')

    /** 中文说明：变量 parent 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const parent = SessionId('never-parent')
    /** 中文说明：变量 child 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const child = SessionId('never-child')
    ctx.sessions.create(parent, { seed: messageEvents('never opened needle'), meta: { createdAt: 10 } })
    ctx.sessions.create(child, { meta: { parentSession: parent, createdAt: 20 } })

    await expect(service.searchSessions({ query: 'needle' }))
      .rejects.toThrow(expectCode('SESSION_QUERY_SEARCH_DISABLED'))
    await expect(service.searchEvents({ sessionId: parent, query: 'needle' }))
      .rejects.toThrow(expectCode('SESSION_QUERY_SEARCH_DISABLED'))

    expect((await service.listSessions()).map(record => record.header.id).sort())
      .toEqual([child, parent])
    /** 中文说明：变量 lineage 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const lineage = await service.traceSession(parent)
    expect(lineage.complete).toBe(true)
    expect(lineage.descendants.map(node => node.session.header.id)).toEqual([child])

    // The disabled index never touches the filesystem, in mount, use, or disposal.
    await expect(stat(path)).rejects.toMatchObject({ code: 'ENOENT' })
    await search.dispose()
    await expect(stat(path)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('opens once on the first search and reuses readiness for later searches', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SqliteSessionQueryEngine, {
      path: ':memory:',
      openAt: 'first-search',
    })
    /** 中文说明：变量 service 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const service = ctx.sessionQuery as SqliteSessionQueryEngine
    /** 中文说明：变量 internals 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const internals = service as unknown as { _open(): Promise<void> }
    /** 中文说明：变量 open 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const open = vi.spyOn(internals, '_open')

    await expect(service.searchSessions({ query: 'first' })).resolves.toEqual({ items: [] })
    await expect(service.searchSessions({ query: 'second' })).resolves.toEqual({ items: [] })

    expect(open).toHaveBeenCalledOnce()
  })

  it('shares one readiness promise across concurrent first searches', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SqliteSessionQueryEngine, {
      path: ':memory:',
      openAt: 'first-search',
    })
    /** 中文说明：变量 service 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const service = ctx.sessionQuery as SqliteSessionQueryEngine
    /** 中文说明：变量 internals 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const internals = service as unknown as { _open(): Promise<void> }
    /** 中文说明：变量 originalOpen 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const originalOpen = internals._open.bind(internals)
    /** 中文说明：变量 release 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const release = Promise.withResolvers<undefined>()
    /** 中文说明：变量 started 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const started = Promise.withResolvers<undefined>()
    /** 中文说明：函数值 open 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const open = vi.spyOn(internals, '_open').mockImplementation(async () => {
      started.resolve(undefined)
      await release.promise
      await originalOpen()
    })

    /** 中文说明：变量 first 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const first = service.searchSessions({ query: 'first' })
    /** 中文说明：变量 second 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const second = service.searchSessions({ query: 'second' })
    await started.promise
    expect(open).toHaveBeenCalledOnce()
    release.resolve(undefined)

    await expect(Promise.all([first, second])).resolves.toEqual([
      { items: [] },
      { items: [] },
    ])
    expect(open).toHaveBeenCalledOnce()
  })

  it('searches two-character Unicode61 tokens in live-only sessions', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await liveContext({ path: ':memory:', snippetChars: 20 })
    /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const session = ctx.sessions.create(SessionId('live'), {
      // agentPreset rides along: the index rebuilds the header a caller reads,
      // and a session listed under the wrong composition is a lie about what it
      // ran. The full-header comparison below is what pins every column.
      meta: { cwd: '/work', createdAt: 10, seedLength: 1, delegationDepth: 2, agentPreset: 'minimal' },
    })
    session.append(
      'user/message',
      createUserMessage({
        content: [{ type: 'text', text: 'An AI helper' }], source: { kind: 'user' },
      }),
      { surfaceOp: 'append' },
    )

    await expect(ctx.sessionQuery.searchEvents({ sessionId: session.id, query: 'AI' }))
      .resolves.toMatchObject({
        session: { ...session.header, seedLength: 1 },
        items: [{ sessionId: session.id, seq: 0, snippet: 'An AI helper' }],
      })
    await expect(ctx.sessionQuery.searchSessions({ query: 'AI' }))
      .resolves.toMatchObject({ items: [{ header: { ...session.header, seedLength: 1 }, live: true, persisted: false }] })
  })

  it('excludes assistant reasoning while indexing visible answer text', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await liveContext()
    /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const session = ctx.sessions.create(SessionId('reasoning'))
    session.append(
      'assistant/message',
      {
        turn: 1,
        step: 1,
        message: createAssistantMessage({
          content: [
            { type: 'reasoning', text: 'private-chain-marker' },
            { type: 'text', text: 'visible-answer-marker' },
          ],
          source: { provider: 'mock', model: 'mock' },
        }),
      },
      { surfaceOp: 'append' },
    )

    await expect(ctx.sessionQuery.searchSessions({ query: 'private-chain-marker' }))
      .resolves.toEqual({ items: [] })
    await expect(ctx.sessionQuery.searchSessions({ query: 'visible-answer-marker' }))
      .resolves.toMatchObject({
        items: [{
          header: { id: session.id },
          bestMatch: { snippet: 'visible-answer-marker' },
        }],
      })
  })

  it('searches all surfaces by default and applies metadata before ranking', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await liveContext({ path: ':memory:', defaultLimit: 10, maxLimit: 20 })
    /** 中文说明：变量 parent 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const parent = SessionId('parent')
    /** 中文说明：变量 events 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const events: SessionEvent[] = [
      { type: 'user/message', seq: 0, time: 10, data: createUserMessage({
        content: [{ type: 'text', text: 'needle original' }], source: { kind: 'user' },
      }), surfaceOp: 'append' },
      { type: 'assistant/chunk', seq: 1, time: 11, data: { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: 'needle raw' } } },
      { type: 'user/message', seq: 2, time: 12, data: createUserMessage({
        content: [{ type: 'text', text: 'needle summary' }], source: { kind: 'plugin', plugin: 'test' },
      }), surfaceOp: { op: 'replace', start: 0, end: 0 }, sourceEventSeqs: [0] },
      { type: 'turn/end', seq: 3, time: 13, data: { turn: 1, reason: { kind: 'error', error: { message: 'needle failure', code: 'UNKNOWN' } } } },
    ]
    ctx.sessions.create(SessionId('a'), { seed: events, meta: { cwd: '/a', parentSession: parent, createdAt: 20 } })
    ctx.sessions.create(SessionId('b'), { seed: messageEvents('needle peer', 12), meta: { createdAt: 20 } })

    /** 中文说明：变量 all 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const all = await ctx.sessionQuery.searchEvents({ sessionId: SessionId('a'), query: 'needle' })
    expect(new Set(all.items.map(item => item.surface))).toEqual(new Set(['current', 'shadowed', 'log-only']))
    await expect(ctx.sessionQuery.searchEvents({
      sessionId: SessionId('a'),
      query: 'needle',
      filters: [
        { kind: 'seq', from: 2, to: 2 },
        { kind: 'time', from: 12, to: 12 },
        { kind: 'type', values: ['user/message'] },
        { kind: 'surface', values: ['current'] },
      ],
    })).resolves.toMatchObject({ items: [{ seq: 2, surface: 'current' }] })

    /** 中文说明：变量 grouped 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const grouped = await ctx.sessionQuery.searchSessions({
      query: 'needle',
      sessionFilters: [
        { kind: 'id', values: [SessionId('a')] },
        { kind: 'cwd', values: ['/a'] },
        { kind: 'created-at', from: 20, to: 20 },
        { kind: 'parent', values: [parent] },
        { kind: 'availability', values: ['live'] },
      ],
      eventFilters: [{ kind: 'surface', values: ['shadowed'] }],
    })
    expect(grouped.items).toHaveLength(1)
    expect(grouped.items[0]).toMatchObject({
      header: { id: SessionId('a'), cwd: '/a', parentSession: parent },
      live: true,
      persisted: false,
      bestMatch: { seq: 0, surface: 'shadowed' },
    })
  })

  it('searches at the supported FTS5 outer-predicate boundary in both scopes', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await liveContext()
    /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const session = ctx.sessions.create(SessionId('predicate-boundary'), {
      seed: messageEvents('needle'),
      meta: { cwd: '/work' },
    })
    /** 中文说明：变量 sessionFilters 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const sessionFilters = Array.from(
      { length: 14 },
      () => ({ kind: 'cwd' as const, values: ['/work', null] }),
    )
    /** 中文说明：变量 eventFilters 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const eventFilters = Array.from(
      { length: 13 },
      () => ({ kind: 'type' as const, values: ['user/message' as const] }),
    )

    await expect(ctx.sessionQuery.searchSessions({ query: 'needle', sessionFilters }))
      .resolves.toMatchObject({ items: [{ header: { id: session.id } }] })
    await expect(ctx.sessionQuery.searchEvents({
      sessionId: session.id,
      query: 'needle',
      filters: eventFilters,
    })).resolves.toMatchObject({ items: [{ sessionId: session.id, seq: 0 }] })
  })

  it('rejects unsupported FTS5 outer-predicate counts with typed errors', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await liveContext()
    /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const session = ctx.sessions.create(SessionId('predicate-limit'), { seed: messageEvents('needle') })
    /** 中文说明：变量 sessionFilters 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const sessionFilters = Array.from(
      { length: 1_100 },
      () => ({ kind: 'id' as const, values: [session.id] }),
    )
    /** 中文说明：变量 eventFilters 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const eventFilters = Array.from(
      { length: 1_100 },
      () => ({ kind: 'type' as const, values: ['user/message' as const] }),
    )

    await expect(ctx.sessionQuery.searchSessions({ query: 'needle', sessionFilters }))
      .rejects.toThrow(expectCode('SESSION_QUERY_INVALID_FILTER'))
    await expect(ctx.sessionQuery.searchEvents({
      sessionId: session.id,
      query: 'needle',
      filters: eventFilters,
    })).rejects.toThrow(expectCode('SESSION_QUERY_INVALID_FILTER'))
    await expect(ctx.sessionQuery.searchSessions({
      query: 'needle',
      sessionFilters: sessionFilters.slice(0, 7),
      eventFilters: eventFilters.slice(0, 8),
    })).rejects.toThrow(expectCode('SESSION_QUERY_INVALID_FILTER'))
    await expect(ctx.sessionQuery.searchEvents({
      sessionId: session.id,
      query: 'needle',
      filters: eventFilters.slice(0, 14),
    })).rejects.toThrow(expectCode('SESSION_QUERY_INVALID_FILTER'))
  })

  it('uses literal phrase tokens, stable ties, and bounded Unicode snippets', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await liveContext({ path: ':memory:', defaultLimit: 10, maxLimit: 10, snippetChars: 5 })
    ctx.sessions.create(SessionId('a'), { seed: messageEvents('😀😀 alpha beta BRAID 😀😀', 10), meta: { createdAt: 1 } })
    ctx.sessions.create(SessionId('b'), { seed: messageEvents('alpha beta', 10), meta: { createdAt: 1 } })
    ctx.sessions.create(SessionId('c'), { seed: messageEvents('alpha middle beta', 10), meta: { createdAt: 1 } })
    ctx.sessions.create(SessionId('d'), { seed: messageEvents('alpha beta', 10), meta: { createdAt: 1 } })
    ctx.sessions.create(SessionId('operator'), { seed: messageEvents('needle OR absent', 10), meta: { createdAt: 1 } })
    ctx.sessions.create(SessionId('only'), { seed: messageEvents('needle only', 10), meta: { createdAt: 1 } })
    ctx.sessions.create(SessionId('quote'), { seed: messageEvents('say "needle" exactly', 10), meta: { createdAt: 1 } })

    /** 中文说明：变量 phrase 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const phrase = await ctx.sessionQuery.searchSessions({ query: 'alpha beta' })
    expect(phrase.items.map(item => item.header.id)).toEqual([SessionId('b'), SessionId('d'), SessionId('a')])
    expect(phrase.items.every(item => Array.from(item.bestMatch.snippet).length <= 5)).toBe(true)
    await expect(ctx.sessionQuery.searchSessions({ query: 'AI' })).resolves.toEqual({ items: [] })
    await expect(ctx.sessionQuery.searchSessions({ query: 'needle OR absent' }))
      .resolves.toMatchObject({ items: [{ header: { id: SessionId('operator') } }] })
    await expect(ctx.sessionQuery.searchSessions({ query: 'say "needle"' }))
      .resolves.toMatchObject({ items: [{ header: { id: SessionId('quote') } }] })
    await expect(ctx.sessionQuery.searchSessions({ query: '*' })).resolves.toEqual({ items: [] })
  })

  it('ranks live and persisted matches on one source-comparable contract', async () => {
    /** 中文说明：变量 persisted 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const persisted = header('z-persisted')
    TestPersistence.reset([
      { meta: persisted, events: messageEvents('needle needle', 10) },
      ...Array.from({ length: 12 }, (_, index) => ({
        meta: header(`filler-${index}`),
        events: messageEvents('needle', 10),
      })),
    ])
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await liveContext()
    /** 中文说明：变量 persistence 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const persistence = await ctx.plugin(TestPersistence)
    ctx.sessions.create(SessionId('a-live'), {
      seed: messageEvents('needle needle', 10),
      meta: { createdAt: persisted.createdAt },
    })

    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await ctx.sessionQuery.searchSessions({
      query: 'needle',
      sessionFilters: [{ kind: 'id', values: [SessionId('a-live'), persisted.id] }],
    })
    expect(result.items.map(item => item.header.id)).toEqual([SessionId('a-live'), persisted.id])
    await persistence.dispose()
  })

  it('positions snippets from FTS5 matches across diacritics and punctuation', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await liveContext({ path: ':memory:', snippetChars: 14 })
    /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const session = ctx.sessions.create(SessionId('snippet'), {
      seed: messageEvents('long long long—café,\nnext value', 10),
    })

    /** 中文说明：变量 page 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const page = await ctx.sessionQuery.searchEvents({ sessionId: session.id, query: 'CAFE' })
    expect(page.items).toHaveLength(1)
    expect(page.items[0]!.snippet).toContain('café')
    expect(page.items[0]!.snippet).toContain('—')
    expect(page.items[0]!.snippet).not.toContain('\n')
    expect(Array.from(page.items[0]!.snippet).length).toBeLessThanOrEqual(14)
  })

  it('binds cursors to requests and only invalidates within-session pages for target changes', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await liveContext({ path: ':memory:', defaultLimit: 1, maxLimit: 5 })
    /** 中文说明：变量 target 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const target = ctx.sessions.create(SessionId('target'), {
      seed: [
        ...messageEvents('needle one', 10),
        { ...messageEvents('needle two', 11)[0]!, seq: 1 },
        { ...messageEvents('needle three', 12)[0]!, seq: 2 },
      ],
    })
    ctx.sessions.create(SessionId('other'), { seed: messageEvents('needle other', 10) })

    /** 中文说明：变量 eventPage 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const eventPage = await ctx.sessionQuery.searchEvents({ sessionId: target.id, query: 'needle', limit: 1 })
    /** 中文说明：变量 sessionPage 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const sessionPage = await ctx.sessionQuery.searchSessions({ query: 'needle', limit: 1 })
    expect(eventPage.nextCursor).toEqual(expect.any(String))
    expect(sessionPage.nextCursor).toEqual(expect.any(String))
    if (eventPage.nextCursor === undefined || sessionPage.nextCursor === undefined) throw new Error('expected cursors')

    /** 中文说明：变量 unsafeOffsetCursor 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const unsafeOffsetCursor = replaceCursorOffset(eventPage.nextCursor, 1e100)
    await expect(ctx.sessionQuery.searchEvents({
      sessionId: target.id,
      query: 'needle',
      limit: 1,
      cursor: unsafeOffsetCursor,
    })).rejects.toThrow(expectCode('SESSION_QUERY_INVALID_CURSOR'))

    /** 中文说明：函数值 eventKeys 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const eventKeys = eventPage.items.map(item => `${item.sessionId}:${item.seq}`)
    /** 中文说明：变量 eventCursor 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let eventCursor: ReturnType<typeof SessionSearchCursor> | undefined = eventPage.nextCursor
    while (eventCursor !== undefined) {
      /** 中文说明：变量 next 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const next = await ctx.sessionQuery.searchEvents({
        sessionId: target.id,
        query: 'needle',
        limit: 1,
        cursor: eventCursor,
      })
      eventKeys.push(...next.items.map(item => `${item.sessionId}:${item.seq}`))
      eventCursor = next.nextCursor
    }
    expect(eventKeys).toHaveLength(3)
    expect(new Set(eventKeys).size).toBe(eventKeys.length)

    /** 中文说明：函数值 sessionIds 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const sessionIds = sessionPage.items.map(item => item.header.id)
    /** 中文说明：变量 sessionCursor 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let sessionCursor: ReturnType<typeof SessionSearchCursor> | undefined = sessionPage.nextCursor
    while (sessionCursor !== undefined) {
      /** 中文说明：变量 next 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const next = await ctx.sessionQuery.searchSessions({ query: 'needle', limit: 1, cursor: sessionCursor })
      sessionIds.push(...next.items.map(item => item.header.id))
      sessionCursor = next.nextCursor
    }
    expect(sessionIds).toHaveLength(2)
    expect(new Set(sessionIds).size).toBe(sessionIds.length)

    ctx.sessions.create(SessionId('unrelated'), { seed: messageEvents('needle unrelated', 20) })
    await expect(ctx.sessionQuery.searchEvents({
      sessionId: target.id,
      query: 'needle',
      limit: 1,
      cursor: eventPage.nextCursor,
    })).resolves.toMatchObject({ items: [{ sessionId: target.id }] })
    await expect(ctx.sessionQuery.searchSessions({ query: 'needle', limit: 1, cursor: sessionPage.nextCursor }))
      .rejects.toThrow(expectCode('SESSION_QUERY_STALE_CURSOR'))
    await expect(ctx.sessionQuery.searchEvents({
      sessionId: target.id,
      query: 'different',
      limit: 1,
      cursor: eventPage.nextCursor,
    })).rejects.toThrow(expectCode('SESSION_QUERY_INVALID_CURSOR'))

    target.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'needle four' }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    await expect(ctx.sessionQuery.searchEvents({
      sessionId: target.id,
      query: 'needle',
      limit: 1,
      cursor: eventPage.nextCursor,
    })).rejects.toThrow(expectCode('SESSION_QUERY_STALE_CURSOR'))
  })

  it('invalidates session cursors after transient persistence topology changes', async () => {
    TestPersistence.reset()
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await liveContext({ path: ':memory:', defaultLimit: 1, maxLimit: 5 })
    ctx.sessions.create(SessionId('first'), { seed: messageEvents('needle first') })
    ctx.sessions.create(SessionId('second'), { seed: messageEvents('needle second') })
    /** 中文说明：变量 page 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const page = await ctx.sessionQuery.searchSessions({ query: 'needle', limit: 1 })
    if (page.nextCursor === undefined) throw new Error('expected cursor')

    /** 中文说明：变量 persistence 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const persistence = await ctx.plugin(TestPersistence)
    await persistence.dispose()

    await expect(ctx.sessionQuery.searchSessions({
      query: 'needle',
      limit: 1,
      cursor: page.nextCursor,
    })).rejects.toThrow(expectCode('SESSION_QUERY_STALE_CURSOR'))
  })

  it('rejects invalid requests, filters, cursors, and direct config', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await liveContext({ path: ':memory:', defaultLimit: 2, maxLimit: 3 })
    /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const session = ctx.sessions.create(SessionId('valid'), { seed: messageEvents('needle') })
    /** 中文说明：该循环依次处理输入数据；循环变量仅在当前循环中有效。 */
    for (const request of [
      { sessionId: session.id, query: '' },
      { sessionId: session.id, query: 'needle', limit: 0 },
      { sessionId: session.id, query: 'needle', limit: 4 },
      { sessionId: session.id, query: 'needle', filters: [{ kind: 'seq', from: 2, to: 1 }] },
      { sessionId: session.id, query: 'needle', filters: [{ kind: 'surface', values: ['future'] }] },
      { sessionId: session.id, query: 'bad\0query' },
    ] as const) {
      await expect(ctx.sessionQuery.searchEvents(request as never)).rejects.toBeInstanceOf(Error)
    }
    await expect(ctx.sessionQuery.searchSessions({
      query: 'needle',
      sessionFilters: [{ kind: 'availability', values: ['remote' as never] }],
    })).rejects.toThrow(expectCode('SESSION_QUERY_INVALID_FILTER'))
    await expect(ctx.sessionQuery.searchSessions({
      query: 'needle',
      sessionFilters: [{ kind: 'future' } as never],
    })).rejects.toThrow(expectCode('SESSION_QUERY_INVALID_FILTER'))
    await expect(ctx.sessionQuery.searchSessions({
      query: 'needle',
      eventFilters: [{ kind: 'future' } as never],
    })).rejects.toThrow(expectCode('SESSION_QUERY_INVALID_FILTER'))
    await expect(ctx.sessionQuery.searchEvents({
      sessionId: session.id,
      query: 'needle',
      filters: [{ kind: 'future' } as never],
    })).rejects.toThrow(expectCode('SESSION_QUERY_INVALID_FILTER'))
    await expect(ctx.sessionQuery.searchEvents({
      sessionId: session.id,
      query: 'needle',
      cursor: SessionSearchCursor('not-json'),
    }))
      .rejects.toThrow(expectCode('SESSION_QUERY_INVALID_CURSOR'))
    await expect(ctx.sessionQuery.searchEvents({ sessionId: SessionId('absent'), query: 'needle' }))
      .rejects.toThrow(expectCode('SESSION_QUERY_SESSION_NOT_FOUND'))

    /** 中文说明：该循环依次处理输入数据；循环变量仅在当前循环中有效。 */
    for (const config of [
      { path: '' },
      { path: ':memory:', defaultLimit: 0 },
      { path: ':memory:', maxLimit: 0 },
      { path: ':memory:', defaultLimit: 1e100 },
      { path: ':memory:', maxLimit: 1e100 },
      { path: ':memory:', snippetChars: 0 },
      { path: ':memory:', readWindowMax: -1 },
      { path: ':memory:', persistedInspectConcurrency: 0 },
      { path: ':memory:', persistedInspectConcurrency: Number.MAX_SAFE_INTEGER + 1 },
      { path: ':memory:', defaultLimit: 3, maxLimit: 2 },
      { path: ':memory:', openAt: 'later' },
      { path: ':memory:', journalMode: 'memory' },
    ]) {
      /** 中文说明：变量 direct 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const direct = new Context()
      await direct.plugin(SessionStore)
      expect(() => new SqliteSessionQueryEngine(direct, config as never))
        .toThrow(expectCode('SESSION_QUERY_INVALID_CONFIG'))
      expect(direct.sessionQuery).toBeUndefined()
    }
  })

  it('rejects aggregate filter bindings above SQLite\'s portable variable limit', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await liveContext()
    /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const session = ctx.sessions.create(SessionId('binding-limit'), { seed: messageEvents('needle') })
    // Each clause is below the ceiling; combined with its sibling and fixed
    // query bindings, the complete statement is not portable.
    /** 中文说明：变量 halfPortableLimit 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const halfPortableLimit = 16_383
    /** 中文说明：变量 ids 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ids = Array.from(
      { length: halfPortableLimit },
      (_, index) => SessionId(`binding-${index}`),
    )
    /** 中文说明：函数值 types 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const types = Array.from({ length: halfPortableLimit }, () => 'user/message' as const)
    /** 中文说明：函数值 surfaces 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const surfaces = Array.from({ length: halfPortableLimit }, () => 'current' as const)

    await expect(ctx.sessionQuery.searchSessions({
      query: 'needle',
      sessionFilters: [{ kind: 'id', values: ids }],
      eventFilters: [{ kind: 'type', values: types }],
    })).rejects.toThrow(expectCode('SESSION_QUERY_INVALID_FILTER'))
    await expect(ctx.sessionQuery.searchEvents({
      sessionId: session.id,
      query: 'needle',
      filters: [
        { kind: 'type', values: types },
        { kind: 'surface', values: surfaces },
      ],
    })).rejects.toThrow(expectCode('SESSION_QUERY_INVALID_FILTER'))
  })

  it('rejects one 125,000-value filter list with a typed error', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await liveContext()
    /** 中文说明：变量 ids 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ids = Array.from(
      { length: 125_000 },
      (_, index) => SessionId(`oversized-binding-${index}`),
    )

    await expect(ctx.sessionQuery.searchSessions({
      query: 'needle',
      sessionFilters: [{ kind: 'id', values: ids }],
    })).rejects.toThrow(expectCode('SESSION_QUERY_INVALID_FILTER'))
  })
})

describe('SQLite reconciliation and source lifecycle', () => {
  it('owns queued request and filter values before waiting for the serializer', async () => {
    /** 中文说明：变量 durable 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const durable = header('owned')
    TestPersistence.reset([{ meta: durable, events: messageEvents('durable needle') }])
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await liveContext()
    /** 中文说明：变量 persistence 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const persistence = await ctx.plugin(TestPersistence)
    /** 中文说明：函数值 release 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    let release!: () => void
    TestPersistence.listGate = new Promise<void>((resolve) => { release = resolve })
    /** 中文说明：函数值 markStarted 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    let markStarted!: () => void
    /** 中文说明：函数值 started 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const started = new Promise<void>((resolve) => { markStarted = resolve })
    TestPersistence.listStarted = () => {
      TestPersistence.listStarted = undefined
      markStarted()
    }
    /** 中文说明：变量 blocking 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const blocking = ctx.sessionQuery.searchSessions({ query: 'needle' })
    await started

    /** 中文说明：变量 availability 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const availability: SessionAvailability[] = ['persisted']
    /** 中文说明：变量 request 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const request: SessionSearchRequest = {
      query: 'needle',
      sessionFilters: [{ kind: 'availability', values: availability }],
    }
    /** 中文说明：变量 queued 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const queued = ctx.sessionQuery.searchSessions(request)
    request.query = 'absent'
    availability[0] = 'live'
    release()

    await expect(blocking).resolves.toMatchObject({ items: [{ header: durable }] })
    await expect(queued).resolves.toMatchObject({ items: [{ header: durable }] })
    await persistence.dispose()
  })

  it('mounts persistence dynamically, shadows with TEMP live rows, reveals, and hides on unmount', async () => {
    /** 中文说明：变量 shared 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const shared = header('shared', 10, { cwd: '/work' })
    /** 中文说明：变量 durable 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const durable = header('durable', 5)
    TestPersistence.reset([
      { meta: shared, events: messageEvents('persisted needle') },
      { meta: durable, events: messageEvents('durable needle') },
    ])
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await liveContext()
    await expect(ctx.sessionQuery.searchSessions({ query: 'durable' })).resolves.toEqual({ items: [] })
    /** 中文说明：变量 persistenceFiber 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const persistenceFiber = await ctx.plugin(TestPersistence)

    await expect(ctx.sessionQuery.searchSessions({ query: 'durable' }))
      .resolves.toMatchObject({ items: [{ header: durable, live: false, persisted: true }] })
    /** 中文说明：变量 live 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const live = ctx.sessions.prepare(shared.id, { meta: { createdAt: 10, cwd: '/work' } })
    live.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'live needle' }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    /** 中文说明：变量 detach 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const detach = ctx.sessions.enter(live)
    ctx.sessions.announce(live)

    await expect(ctx.sessionQuery.searchSessions({ query: 'persisted' })).resolves.toEqual({ items: [] })
    await expect(ctx.sessionQuery.searchSessions({ query: 'live' }))
      .resolves.toMatchObject({ items: [{ header: shared, live: true, persisted: true }] })
    detach()
    await expect(ctx.sessionQuery.searchSessions({ query: 'persisted' }))
      .resolves.toMatchObject({ items: [{ header: shared, live: false, persisted: true }] })

    await persistenceFiber.dispose()
    await expect(ctx.sessionQuery.searchSessions({ query: 'durable' })).resolves.toEqual({ items: [] })
    await expect(ctx.sessionQuery.searchEvents({ sessionId: durable.id, query: 'needle' }))
      .rejects.toThrow(expectCode('SESSION_QUERY_SESSION_NOT_FOUND'))
  })

  it('does not load a persisted log while the same session is live', async () => {
    /** 中文说明：变量 shared 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const shared = header('checkpointed-live', 10)
    TestPersistence.reset([{ meta: shared, events: messageEvents('persisted needle') }])
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await liveContext()
    /** 中文说明：变量 live 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const live = ctx.sessions.prepare(shared.id, {
      seed: messageEvents('live needle'),
      meta: { createdAt: shared.createdAt },
    })
    /** 中文说明：变量 detach 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const detach = ctx.sessions.enter(live)
    ctx.sessions.announce(live)
    /** 中文说明：变量 persistence 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const persistence = await ctx.plugin(TestPersistence)

    await expect(ctx.sessionQuery.searchSessions({
      query: 'live',
      sessionFilters: [{ kind: 'availability', values: ['persisted'] }],
    })).resolves.toMatchObject({
      items: [{ header: shared, live: true, persisted: true }],
    })
    expect(TestPersistence.loads.get(shared.id)).toBeUndefined()
    expect(TestPersistence.inspections.get(shared.id)).toBeUndefined()

    detach()
    await expect(ctx.sessionQuery.searchSessions({ query: 'persisted' }))
      .resolves.toMatchObject({ items: [{ header: shared, live: false, persisted: true }] })
    expect(TestPersistence.loads.get(shared.id)).toBeUndefined()
    expect(TestPersistence.inspections.get(shared.id)).toBe(1)
    await persistence.dispose()
  })

  it('retries when a live owner attaches during persistence observation', async () => {
    TestPersistence.reset()
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await liveContext()
    await ctx.plugin(TestPersistence)
    TestPersistence.snapshotEffect = () => {
      TestPersistence.snapshotEffect = undefined
      ctx.sessions.create(SessionId('attached'), { seed: messageEvents('attached needle') })
    }

    await expect(ctx.sessionQuery.searchSessions({ query: 'attached' }))
      .resolves.toMatchObject({ items: [{ header: { id: SessionId('attached') } }] })
  })

  it('cannot crash-repair a log when live ownership begins during persisted inspection', async () => {
    /** 中文说明：变量 shared 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const shared = header('attach-during-inspect', 10)
    /** 中文说明：变量 persistedEvents 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const persistedEvents = messageEvents('persisted needle')
    TestPersistence.reset([{ meta: shared, events: persistedEvents }])
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await liveContext()
    await ctx.plugin(TestPersistence)
    TestPersistence.loadEffect = (entry) => {
      entry.events = messageEvents('incorrect repair')
    }
    TestPersistence.inspectEffect = () => {
      ctx.sessions.create(shared.id, {
        seed: messageEvents('live needle'),
        meta: { createdAt: shared.createdAt },
      })
    }

    await expect(ctx.sessionQuery.searchSessions({ query: 'live' }))
      .resolves.toMatchObject({ items: [{ header: shared, live: true, persisted: true }] })
    expect(TestPersistence.loads.get(shared.id)).toBeUndefined()
    expect(TestPersistence.entries.get(shared.id)?.events).toEqual(persistedEvents)
  })

  it('retries when one live owner replaces another during persistence observation', async () => {
    TestPersistence.reset()
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await liveContext()
    /** 中文说明：变量 first 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const first = ctx.sessions.prepare(SessionId('first'), { seed: messageEvents('first needle') })
    /** 中文说明：变量 detachFirst 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const detachFirst = ctx.sessions.enter(first)
    ctx.sessions.announce(first)
    await ctx.plugin(TestPersistence)
    TestPersistence.snapshotEffect = () => {
      TestPersistence.snapshotEffect = undefined
      detachFirst()
      ctx.sessions.create(SessionId('second'), { seed: messageEvents('second needle') })
    }

    await expect(ctx.sessionQuery.searchSessions({ query: 'second' }))
      .resolves.toMatchObject({ items: [{ header: { id: SessionId('second') } }] })
  })

  it('uses the reconciled persistence binding through the query boundary', async () => {
    /** 中文说明：变量 durable 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const durable = header('post-reconcile-unmount')
    TestPersistence.reset([{ meta: durable, events: [
      ...messageEvents('durable needle', 1),
      { ...messageEvents('durable needle again', 2)[0]!, seq: 1 },
    ] }])
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await liveContext({ path: ':memory:', defaultLimit: 1, maxLimit: 2 })
    /** 中文说明：变量 persistence 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const persistence = await ctx.plugin(TestPersistence)
    /** 中文说明：变量 internals 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const internals = ctx.sessionQuery as unknown as {
      _reconcile(signal: AbortSignal | undefined): Promise<{
        identity: symbol
        service?: SessionPersistence
      }>
    }
    /** 中文说明：变量 reconcile 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const reconcile = internals._reconcile.bind(internals)
    /** 中文说明：函数值 boundary 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const boundary = vi.spyOn(internals, '_reconcile').mockImplementation(async (signal) => {
      /** 中文说明：变量 binding 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const binding = await reconcile(signal)
      await persistence.dispose()
      return binding
    })

    /** 中文说明：变量 page 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const page = await ctx.sessionQuery.searchEvents({
      sessionId: durable.id,
      query: 'needle',
      limit: 1,
    })
    expect(page.items).toMatchObject([{ sessionId: durable.id }])
    expect(page.nextCursor).toEqual(expect.any(String))
    boundary.mockRestore()
    await expect(ctx.sessionQuery.searchEvents({ sessionId: durable.id, query: 'needle' }))
      .rejects.toThrow(expectCode('SESSION_QUERY_SESSION_NOT_FOUND'))
  })

  it('discards a stale list rejection when persistence unmounts during observation', async () => {
    /** 中文说明：变量 durable 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const durable = header('racing')
    TestPersistence.reset([{ meta: durable, events: messageEvents('durable needle') }])
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await liveContext()
    /** 中文说明：变量 persistenceFiber 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const persistenceFiber = await ctx.plugin(TestPersistence)
    /** 中文说明：函数值 release 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    let release!: () => void
    TestPersistence.listGate = new Promise<void>((resolve) => { release = resolve })
    /** 中文说明：函数值 markStarted 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    let markStarted!: () => void
    /** 中文说明：函数值 started 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const started = new Promise<void>((resolve) => { markStarted = resolve })
    TestPersistence.listStarted = () => {
      TestPersistence.listStarted = undefined
      markStarted()
    }

    /** 中文说明：变量 search 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const search = ctx.sessionQuery.searchSessions({ query: 'needle' })
    await started
    await persistenceFiber.dispose()
    TestPersistence.failure = new Error('stale backend rejection')
    release()
    await expect(search).resolves.toEqual({ items: [] })
  })

  it('retries against a replacement after the prior binding rejects', async () => {
    /** 中文说明：变量 durable 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const durable = header('replacement')
    TestPersistence.reset([{ meta: durable, events: messageEvents('durable needle') }])
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await liveContext()
    /** 中文说明：变量 prior 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const prior = await ctx.plugin(TestPersistence)
    /** 中文说明：函数值 rejectPrior 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    let rejectPrior!: (reason: unknown) => void
    TestPersistence.listGate = new Promise<void>((_resolve, reject) => { rejectPrior = reject })
    /** 中文说明：函数值 markStarted 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    let markStarted!: () => void
    /** 中文说明：函数值 started 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const started = new Promise<void>((resolve) => { markStarted = resolve })
    TestPersistence.listStarted = () => {
      TestPersistence.listStarted = undefined
      markStarted()
    }

    /** 中文说明：变量 search 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const search = ctx.sessionQuery.searchSessions({ query: 'needle' })
    await started
    await prior.dispose()
    TestPersistence.listGate = undefined
    /** 中文说明：变量 replacement 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const replacement = await ctx.plugin(TestPersistence)
    rejectPrior(new Error('stale prior binding'))
    await expect(search).resolves.toMatchObject({ items: [{ header: durable }] })
    await replacement.dispose()
  })

  it('reloads a replacement source even when its opaque revisions collide', async () => {
    /** 中文说明：变量 durable 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const durable = header('colliding-replacement')
    TestPersistence.reset([{ meta: durable, events: messageEvents('old content') }])
    /** 中文说明：变量 revision 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const revision = TestPersistence.revisions.get(durable.id)!
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await liveContext()
    /** 中文说明：变量 prior 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const prior = await ctx.plugin(TestPersistence)
    await expect(ctx.sessionQuery.searchSessions({ query: 'old' }))
      .resolves.toMatchObject({ items: [{ header: durable }] })
    await prior.dispose()

    TestPersistence.set({ meta: durable, events: messageEvents('new needle') })
    TestPersistence.revisions.set(durable.id, revision)
    /** 中文说明：变量 replacement 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const replacement = await ctx.plugin(TestPersistence)
    /** 中文说明：变量 page 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const page = await ctx.sessionQuery.searchSessions({ query: 'new needle' })
    expect(TestPersistence.inspections.get(durable.id)).toBe(2)
    expect(page).toMatchObject({ items: [{ header: durable }] })
    await expect(ctx.sessionQuery.searchSessions({ query: 'old' })).resolves.toEqual({ items: [] })
    expect(TestPersistence.inspections.get(durable.id)).toBe(2)
    await replacement.dispose()
  })

  it('retries when a successful observation belongs to a source unmounted during listing', async () => {
    /** 中文说明：变量 durable 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const durable = header('successful-unmount')
    TestPersistence.reset([{ meta: durable, events: messageEvents('durable needle') }])
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await liveContext()
    /** 中文说明：变量 persistence 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const persistence = await ctx.plugin(TestPersistence)
    /** 中文说明：变量 lists 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let lists = 0
    TestPersistence.snapshotEffect = async () => {
      lists += 1
      if (lists === 2) await persistence.dispose()
    }

    await expect(ctx.sessionQuery.searchSessions({ query: 'needle' })).resolves.toEqual({ items: [] })
    expect(lists).toBe(2)
  })

  it('retries when the snapshot population changes during observation', async () => {
    /** 中文说明：变量 first 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const first = header('first')
    /** 中文说明：变量 added 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const added = header('added-during-list')
    TestPersistence.reset([{ meta: first, events: messageEvents('first needle') }])
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await liveContext()
    await ctx.plugin(TestPersistence)
    TestPersistence.snapshotEffect = () => {
      TestPersistence.snapshotEffect = undefined
      TestPersistence.set({ meta: added, events: messageEvents('added needle') })
    }

    /** 中文说明：变量 page 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const page = await ctx.sessionQuery.searchSessions({ query: 'needle' })
    expect(page.items.map(item => item.header.id).sort()).toEqual([added.id, first.id].sort())
    expect(TestPersistence.inspections.get(first.id)).toBe(2)
    expect(TestPersistence.inspections.get(added.id)).toBe(1)
  })

  it('fails after one retry when persistence snapshots keep changing', async () => {
    /** 中文说明：变量 durable 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const durable = header('continuous-mutation')
    TestPersistence.reset([{ meta: durable, events: messageEvents('durable needle') }])
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await liveContext()
    await ctx.plugin(TestPersistence)
    /** 中文说明：变量 lists 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let lists = 0
    TestPersistence.snapshotEffect = () => {
      lists += 1
      TestPersistence.set({ meta: durable, events: messageEvents(`durable needle ${lists}`) })
    }

    await expect(ctx.sessionQuery.searchSessions({ query: 'needle' }))
      .rejects.toThrow(expectCode('SESSION_QUERY_PERSISTENCE_FAILED'))
    expect(lists).toBe(4)
  })

  it('retries if the persistence binding changes while live sessions are observed', async () => {
    /** 中文说明：变量 durable 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const durable = header('live-boundary-retry')
    TestPersistence.reset([{ meta: durable, events: messageEvents('durable needle') }])
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await liveContext()
    await ctx.plugin(TestPersistence)
    /** 中文说明：变量 internals 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const internals = ctx.sessionQuery as unknown as {
      _persistenceBinding: { identity: symbol; service?: SessionPersistence }
    }
    /** 中文说明：变量 originalList 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const originalList = ctx.sessions.list.bind(ctx.sessions)
    /** 中文说明：变量 bumped 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let bumped = false
    /** 中文说明：函数值 list 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const list = vi.spyOn(ctx.sessions, 'list').mockImplementation(() => {
      if (!bumped) {
        bumped = true
        internals._persistenceBinding = {
          ...internals._persistenceBinding,
          identity: Symbol(),
        }
      }
      return originalList()
    })

    await expect(ctx.sessionQuery.searchSessions({ query: 'needle' }))
      .resolves.toMatchObject({ items: [{ header: durable }] })
    expect(TestPersistence.inspections.get(durable.id)).toBe(2)
    list.mockRestore()
  })

  it('rejects malformed snapshots and preserves typed persistence failures', async () => {
    /** 中文说明：变量 durable 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const durable = header('invalid-snapshot')
    TestPersistence.reset([{ meta: durable, events: messageEvents('durable needle') }])
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await liveContext()
    await ctx.plugin(TestPersistence)

    TestPersistence.snapshotOverride = () => 'not-an-array' as never
    await expect(ctx.sessionQuery.searchSessions({ query: 'needle' }))
      .rejects.toThrow(expectCode('SESSION_QUERY_PERSISTENCE_FAILED'))
    TestPersistence.snapshotOverride = () => [{ header: durable, revision: 1 as never }]
    await expect(ctx.sessionQuery.searchSessions({ query: 'needle' }))
      .rejects.toThrow(expectCode('SESSION_QUERY_PERSISTENCE_FAILED'))
    TestPersistence.snapshotOverride = () => [
      { header: durable, revision: SessionPersistenceRevision('duplicate:1') },
      { header: durable, revision: SessionPersistenceRevision('duplicate:2') },
    ]
    await expect(ctx.sessionQuery.searchSessions({ query: 'needle' }))
      .rejects.toThrow(expectCode('SESSION_QUERY_PERSISTENCE_FAILED'))

    TestPersistence.snapshotOverride = undefined
    /** 中文说明：变量 typed 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const typed = new SessionQueryError('typed persistence failure', 'SESSION_QUERY_PERSISTENCE_FAILED')
    TestPersistence.failure = typed
    await expect(ctx.sessionQuery.searchSessions({ query: 'needle' })).rejects.toBe(typed)
  })

  it('rejects immutable header conflicts between live and persisted sources', async () => {
    /** 中文说明：变量 shared 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const shared = header('conflict', 10, { delegationDepth: 1 })
    TestPersistence.reset([{ meta: shared, events: messageEvents('persisted needle') }])
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await liveContext()
    await ctx.plugin(TestPersistence)
    ctx.sessions.create(shared.id, {
      seed: messageEvents('live needle'),
      meta: { createdAt: 10, delegationDepth: 2 },
    })

    await expect(ctx.sessionQuery.searchSessions({ query: 'needle' }))
      .rejects.toThrow(expectCode('SESSION_QUERY_SOURCE_CONFLICT'))
  })

  it('preserves unchanged persisted generations while reconciling new, changed, and deleted rows', { timeout: 20_000 }, async () => {
    /** 中文说明：变量 path 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const path = await temporaryPath()
    /** 中文说明：变量 unchanged 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const unchanged = header('unchanged')
    /** 中文说明：变量 changed 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const changed = header('changed')
    /** 中文说明：变量 deleted 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const deleted = header('deleted')
    TestPersistence.reset([
      { meta: unchanged, events: messageEvents('unchanged needle') },
      { meta: changed, events: messageEvents('old needle') },
      { meta: deleted, events: messageEvents('deleted needle') },
    ])
    /** 中文说明：变量 first 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const first = new Context()
    await first.plugin(SessionStore)
    /** 中文说明：变量 firstPersistence 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const firstPersistence = await first.plugin(TestPersistence)
    /** 中文说明：变量 firstSearch 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const firstSearch = await first.plugin(SqliteSessionQueryEngine, { path })
    await first.sessionQuery.searchSessions({ query: 'needle' })
    expect(Object.fromEntries(TestPersistence.inspections)).toEqual({ unchanged: 1, changed: 1, deleted: 1 })
    await first.sessionQuery.searchSessions({ query: 'needle' })
    expect(Object.fromEntries(TestPersistence.inspections)).toEqual({ unchanged: 1, changed: 1, deleted: 1 })
    await firstSearch.dispose()
    await firstPersistence.dispose()

    /** 中文说明：变量 beforeDb 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const beforeDb = new DatabaseSync(path)
    /** 中文说明：变量 beforeRows 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const beforeRows = beforeDb.prepare('SELECT id, generation FROM persisted_sessions ORDER BY id').all() as Array<{ id: string; generation: number }>
    beforeDb.close()
    /** 中文说明：函数值 before 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const before = new Map(beforeRows.map(row => [row.id, row.generation]))

    /** 中文说明：变量 added 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const added = header('added')
    TestPersistence.entries.delete(deleted.id)
    TestPersistence.set({ meta: changed, events: messageEvents('changed needle') })
    TestPersistence.set({ meta: added, events: messageEvents('added needle') })
    /** 中文说明：变量 second 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const second = new Context()
    await second.plugin(SessionStore)
    /** 中文说明：变量 secondPersistence 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const secondPersistence = await second.plugin(TestPersistence)
    /** 中文说明：变量 secondSearch 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const secondSearch = await second.plugin(SqliteSessionQueryEngine, { path })
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await second.sessionQuery.searchSessions({ query: 'needle' })
    expect(result.items.map(item => item.header.id).sort()).toEqual([added.id, changed.id, unchanged.id].sort())
    expect(Object.fromEntries(TestPersistence.inspections)).toEqual({
      unchanged: 1,
      changed: 2,
      deleted: 1,
      added: 1,
    })
    await secondSearch.dispose()
    await secondPersistence.dispose()

    /** 中文说明：变量 afterDb 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const afterDb = new DatabaseSync(path)
    /** 中文说明：变量 afterRows 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const afterRows = afterDb.prepare('SELECT id, generation FROM persisted_sessions ORDER BY id').all() as Array<{ id: string; generation: number }>
    afterDb.close()
    /** 中文说明：函数值 after 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const after = new Map(afterRows.map(row => [row.id, row.generation]))
    expect(after.get(unchanged.id)).toBe(before.get(unchanged.id))
    expect(after.get(changed.id)).toBeGreaterThan(before.get(changed.id)!)
    expect(after.has(deleted.id)).toBe(false)
    expect(after.has(added.id)).toBe(true)
  })

  it('drops connection-local live overlays on reopen and retains persistent bases', async () => {
    /** 中文说明：变量 path 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const path = await temporaryPath()
    /** 中文说明：变量 shared 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const shared = header('shared', 10)
    TestPersistence.reset([{ meta: shared, events: messageEvents('persisted needle') }])
    /** 中文说明：变量 first 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const first = new Context()
    await first.plugin(SessionStore)
    /** 中文说明：变量 persistence 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const persistence = await first.plugin(TestPersistence)
    /** 中文说明：变量 live 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const live = first.sessions.create(shared.id, { seed: messageEvents('live needle'), meta: { createdAt: 10 } })
    /** 中文说明：变量 search 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const search = await first.plugin(SqliteSessionQueryEngine, { path })
    await expect(first.sessionQuery.searchEvents({ sessionId: live.id, query: 'live' })).resolves.toMatchObject({ items: [{}] })
    await search.dispose()
    await persistence.dispose()

    /** 中文说明：变量 second 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const second = new Context()
    await second.plugin(SessionStore)
    /** 中文说明：变量 persistenceAgain 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const persistenceAgain = await second.plugin(TestPersistence)
    /** 中文说明：变量 searchAgain 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const searchAgain = await second.plugin(SqliteSessionQueryEngine, { path })
    await expect(second.sessionQuery.searchSessions({ query: 'live' })).resolves.toEqual({ items: [] })
    await expect(second.sessionQuery.searchSessions({ query: 'persisted' }))
      .resolves.toMatchObject({ items: [{ header: shared, live: false, persisted: true }] })
    expect(TestPersistence.inspections.get(shared.id)).toBe(1)
    await searchAgain.dispose()
    await persistenceAgain.dispose()
  })

  it('refreshes after an external mutating load repair without loading from the query path', async () => {
    /** 中文说明：变量 durable 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const durable = header('repair')
    TestPersistence.reset([{ meta: durable, events: messageEvents('before repair') }])
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await liveContext()
    /** 中文说明：变量 persistence 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const persistence = await ctx.plugin(TestPersistence)
    await expect(ctx.sessionQuery.searchSessions({ query: 'before' }))
      .resolves.toMatchObject({ items: [{ header: durable }] })
    TestPersistence.loadEffect = (entry) => {
      entry.events = messageEvents('repaired needle')
    }
    await ctx.sessionPersistence.load(durable.id)

    await expect(ctx.sessionQuery.searchSessions({ query: 'repaired' }))
      .resolves.toMatchObject({ items: [{ header: durable }] })
    expect(TestPersistence.inspections.get(durable.id)).toBe(2)
    await ctx.sessionQuery.searchSessions({ query: 'repaired' })
    expect(TestPersistence.inspections.get(durable.id)).toBe(2)
    expect(TestPersistence.loads.get(durable.id)).toBe(1)
    await persistence.dispose()
  })

  it('recovers on the next search after source and SQLite transaction failures', async () => {
    TestPersistence.reset([{ meta: header('durable'), events: messageEvents('durable needle') }])
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await liveContext()
    await ctx.plugin(TestPersistence)
    TestPersistence.failure = 'offline'
    await expect(ctx.sessionQuery.searchSessions({ query: 'needle' }))
      .rejects.toThrow(expectCode('SESSION_QUERY_PERSISTENCE_FAILED'))
    /** 中文说明：变量 signal 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const signal = new AbortController().signal
    await expect(ctx.sessionQuery.searchSessions({ query: 'needle' }, { signal }))
      .rejects.toThrow(expectCode('SESSION_QUERY_PERSISTENCE_FAILED'))
    TestPersistence.failure = new Error('still offline')
    await expect(ctx.sessionQuery.searchSessions({ query: 'needle' }, { signal }))
      .rejects.toThrow(expectCode('SESSION_QUERY_PERSISTENCE_FAILED'))
    TestPersistence.failure = undefined
    await expect(ctx.sessionQuery.searchSessions({ query: 'needle' })).resolves.toMatchObject({ items: [{}] })

    /** 中文说明：变量 live 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const live = ctx.sessions.create(SessionId('live'), { seed: messageEvents('base') })
    await ctx.sessionQuery.searchEvents({ sessionId: live.id, query: 'base' })
    /** 中文说明：变量 db 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const db = (ctx.sessionQuery as unknown as { _db: DatabaseSync })._db
    db.exec('PRAGMA query_only = ON')
    live.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'retry needle' }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    await expect(ctx.sessionQuery.searchEvents({ sessionId: live.id, query: 'needle' }))
      .rejects.toThrow(expectCode('SESSION_QUERY_INDEX_FAILED'))
    db.exec('PRAGMA query_only = OFF')
    // seq 2: one-event seed, end-seed, then the live message.
    await expect(ctx.sessionQuery.searchEvents({ sessionId: live.id, query: 'needle' }))
      .resolves.toMatchObject({ items: [{ seq: 2 }] })
  })
})

describe('SQLite schema, cancellation, and real persistence integration', () => {
  it('creates a new database and WAL sidecars owner-only without changing its parent mode', async () => {
    if (process.platform === 'win32') return
    /** 中文说明：变量 path 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const path = await temporaryPath()
    /** 中文说明：变量 directory 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const directory = dirname(path)
    await chmod(directory, 0o755)

    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await liveContext({ path })
    await ctx.sessionQuery.searchSessions({ query: 'needle' })

    expect((await stat(directory)).mode & 0o777).toBe(0o755)
    expect((await stat(path)).mode & 0o777).toBe(0o600)
    expect((await stat(`${path}-wal`)).mode & 0o777).toBe(0o600)
    expect((await stat(`${path}-shm`)).mode & 0o777).toBe(0o600)
    await (ctx.sessionQuery as SqliteSessionQueryEngine).close()
  })

  it('creates a persistent rollback journal owner-only', async () => {
    if (process.platform === 'win32') return
    /** 中文说明：变量 path 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const path = await temporaryPath()
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await liveContext({ path, journalMode: 'persist' })
    await ctx.sessionQuery.searchSessions({ query: 'needle' })

    expect((await stat(path)).mode & 0o777).toBe(0o600)
    expect((await stat(`${path}-journal`)).mode & 0o777).toBe(0o600)
    await (ctx.sessionQuery as SqliteSessionQueryEngine).close()
  })

  it('preserves the mode of an existing database file', async () => {
    if (process.platform === 'win32') return
    /** 中文说明：变量 path 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const path = await temporaryPath()
    await writeFile(path, '', { mode: 0o644 })
    await chmod(path, 0o644)

    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await liveContext({ path, journalMode: 'delete' })
    await ctx.sessionQuery.searchSessions({ query: 'needle' })

    expect((await stat(path)).mode & 0o777).toBe(0o644)
    await (ctx.sessionQuery as SqliteSessionQueryEngine).close()
  })

  it('surfaces filesystem failures while pre-creating the database', async () => {
    /** 中文说明：变量 path 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const path = `${await temporaryPath()}\0`
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(SessionStore)

    await expect(ctx.plugin(SqliteSessionQueryEngine, { path })).rejects.toMatchObject({
      code: 'SESSION_QUERY_INDEX_FAILED',
      cause: { code: 'ERR_INVALID_ARG_VALUE' },
    })
    expect(ctx.sessionQuery).toBeUndefined()
  })

  it('resets a recognized incompatible schema but refuses unknown or foreign tables', { timeout: 20_000 }, async () => {
    /** 中文说明：变量 stalePath 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const stalePath = await temporaryPath('stale.db')
    /** 中文说明：变量 staleOwner 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const staleOwner = await liveContext({ path: stalePath })
    await (staleOwner.sessionQuery as SqliteSessionQueryEngine).close()
    /** 中文说明：变量 stale 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const stale = new DatabaseSync(stalePath)
    stale.exec(`PRAGMA user_version = ${SESSION_QUERY_SQLITE_SCHEMA_VERSION - 1}`)
    stale.close()
    /** 中文说明：变量 staleCtx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const staleCtx = await liveContext({ path: stalePath })
    staleCtx.sessions.create(SessionId('live'), { seed: messageEvents('needle') })
    await staleCtx.sessionQuery.searchSessions({ query: 'needle' })
    await (staleCtx.sessionQuery as SqliteSessionQueryEngine).close()
    /** 中文说明：变量 rebuilt 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const rebuilt = new DatabaseSync(stalePath)
    expect((rebuilt.prepare('PRAGMA user_version').get() as { user_version: number }).user_version)
      .toBe(SESSION_QUERY_SQLITE_SCHEMA_VERSION)
    rebuilt.close()

    /** 中文说明：变量 augmentedPath 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const augmentedPath = await temporaryPath('augmented.db')
    /** 中文说明：变量 augmentedOwner 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const augmentedOwner = await liveContext({ path: augmentedPath })
    await (augmentedOwner.sessionQuery as SqliteSessionQueryEngine).close()
    /** 中文说明：变量 augmented 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const augmented = new DatabaseSync(augmentedPath)
    augmented.exec('CREATE TABLE unrelated(value TEXT)')
    augmented.exec("INSERT INTO unrelated VALUES ('safe')")
    augmented.exec('PRAGMA user_version = 999')
    augmented.close()
    /** 中文说明：变量 augmentedCtx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const augmentedCtx = new Context()
    await augmentedCtx.plugin(SessionStore)
    await expect(augmentedCtx.plugin(SqliteSessionQueryEngine, { path: augmentedPath }))
      .rejects.toThrow(expectCode('SESSION_QUERY_INDEX_FAILED'))
    expect(augmentedCtx.sessionQuery).toBeUndefined()
    /** 中文说明：变量 stillAugmented 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const stillAugmented = new DatabaseSync(augmentedPath)
    expect(stillAugmented.prepare('SELECT value FROM unrelated').get()).toEqual({ value: 'safe' })
    expect(stillAugmented.prepare('PRAGMA user_version').get()).toEqual({ user_version: 999 })
    stillAugmented.close()

    /** 中文说明：变量 currentAugmentedPath 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const currentAugmentedPath = await temporaryPath('current-augmented.db')
    /** 中文说明：变量 currentAugmentedOwner 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const currentAugmentedOwner = await liveContext({ path: currentAugmentedPath })
    await (currentAugmentedOwner.sessionQuery as SqliteSessionQueryEngine).close()
    /** 中文说明：变量 currentAugmented 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const currentAugmented = new DatabaseSync(currentAugmentedPath)
    currentAugmented.exec('CREATE TABLE unrelated(value TEXT)')
    currentAugmented.exec("INSERT INTO unrelated VALUES ('safe')")
    currentAugmented.close()
    /** 中文说明：变量 currentAugmentedCtx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const currentAugmentedCtx = new Context()
    await currentAugmentedCtx.plugin(SessionStore)
    await expect(currentAugmentedCtx.plugin(SqliteSessionQueryEngine, {
      path: currentAugmentedPath,
      journalMode: 'delete',
    })).rejects.toThrow(expectCode('SESSION_QUERY_INDEX_FAILED'))
    expect(currentAugmentedCtx.sessionQuery).toBeUndefined()
    /** 中文说明：变量 stillCurrentAugmented 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const stillCurrentAugmented = new DatabaseSync(currentAugmentedPath)
    expect(stillCurrentAugmented.prepare('SELECT value FROM unrelated').get()).toEqual({ value: 'safe' })
    expect(stillCurrentAugmented.prepare('PRAGMA user_version').get())
      .toEqual({ user_version: SESSION_QUERY_SQLITE_SCHEMA_VERSION })
    expect(stillCurrentAugmented.prepare('PRAGMA journal_mode').get()).toEqual({ journal_mode: 'wal' })
    stillCurrentAugmented.close()

    /** 中文说明：变量 foreignPath 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const foreignPath = await temporaryPath('foreign.db')
    /** 中文说明：变量 foreign 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const foreign = new DatabaseSync(foreignPath)
    foreign.exec('PRAGMA journal_mode = WAL')
    foreign.exec('CREATE TABLE canonical(value TEXT)')
    foreign.exec("INSERT INTO canonical VALUES ('safe')")
    foreign.close()
    /** 中文说明：变量 foreignCtx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const foreignCtx = new Context()
    await foreignCtx.plugin(SessionStore)
    await expect(foreignCtx.plugin(SqliteSessionQueryEngine, { path: foreignPath, journalMode: 'delete' }))
      .rejects.toThrow(expectCode('SESSION_QUERY_INDEX_FAILED'))
    expect(foreignCtx.sessionQuery).toBeUndefined()
    /** 中文说明：变量 stillForeign 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const stillForeign = new DatabaseSync(foreignPath)
    expect(stillForeign.prepare('SELECT value FROM canonical').get()).toEqual({ value: 'safe' })
    expect(stillForeign.prepare('PRAGMA journal_mode').get()).toEqual({ journal_mode: 'wal' })
    stillForeign.close()

    /** 中文说明：变量 wildcardPath 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const wildcardPath = await temporaryPath('sqlite-wildcard.db')
    /** 中文说明：变量 wildcard 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const wildcard = new DatabaseSync(wildcardPath)
    wildcard.exec('PRAGMA journal_mode = WAL')
    wildcard.exec('CREATE TABLE sqliteX(value TEXT)')
    wildcard.exec("INSERT INTO sqliteX VALUES ('safe')")
    wildcard.close()
    /** 中文说明：变量 wildcardCtx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const wildcardCtx = new Context()
    await wildcardCtx.plugin(SessionStore)
    await expect(wildcardCtx.plugin(SqliteSessionQueryEngine, {
      path: wildcardPath,
      journalMode: 'delete',
    })).rejects.toThrow(expectCode('SESSION_QUERY_INDEX_FAILED'))
    expect(wildcardCtx.sessionQuery).toBeUndefined()
    /** 中文说明：变量 stillWildcard 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const stillWildcard = new DatabaseSync(wildcardPath)
    expect(stillWildcard.prepare('SELECT value FROM sqliteX').get()).toEqual({ value: 'safe' })
    expect(stillWildcard.prepare('PRAGMA application_id').get()).toEqual({ application_id: 0 })
    expect(stillWildcard.prepare('PRAGMA user_version').get()).toEqual({ user_version: 0 })
    expect(stillWildcard.prepare('PRAGMA journal_mode').get()).toEqual({ journal_mode: 'wal' })
    stillWildcard.close()

    /** 中文说明：变量 otherAppPath 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const otherAppPath = await temporaryPath('other-app.db')
    /** 中文说明：变量 otherApp 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const otherApp = new DatabaseSync(otherAppPath)
    otherApp.exec('PRAGMA application_id = 123')
    otherApp.close()
    /** 中文说明：变量 otherAppCtx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const otherAppCtx = new Context()
    await otherAppCtx.plugin(SessionStore)
    await expect(otherAppCtx.plugin(SqliteSessionQueryEngine, { path: otherAppPath }))
      .rejects.toThrow(expectCode('SESSION_QUERY_INDEX_FAILED'))
    expect(otherAppCtx.sessionQuery).toBeUndefined()
  })

  it('fails plugin initialization without an unhandled rejection or partial service', async () => {
    /** 中文说明：变量 path 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const path = await temporaryPath('never-queried.db')
    /** 中文说明：变量 foreign 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const foreign = new DatabaseSync(path)
    foreign.exec('CREATE TABLE canonical(value TEXT)')
    foreign.close()
    /** 中文说明：变量 unhandled 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const unhandled: unknown[] = []
    /** 中文说明：函数值 onUnhandled 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const onUnhandled = (reason: unknown) => { unhandled.push(reason) }
    process.on('unhandledRejection', onUnhandled)
    try {
      /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const ctx = new Context()
      await ctx.plugin(SessionStore)
      await expect(ctx.plugin(SqliteSessionQueryEngine, { path }))
        .rejects.toThrow(expectCode('SESSION_QUERY_INDEX_FAILED'))
      await new Promise<void>((resolve) => { setImmediate(resolve) })
      expect(unhandled).toEqual([])
      expect(ctx.sessionQuery).toBeUndefined()
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
  })

  it('defers an invalid database failure only in first-search mode', async () => {
    /** 中文说明：变量 path 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const path = await temporaryPath('lazy-invalid.db')
    /** 中文说明：变量 foreign 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const foreign = new DatabaseSync(path)
    foreign.exec('CREATE TABLE canonical(value TEXT)')
    foreign.close()

    /** 中文说明：变量 lazyCtx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const lazyCtx = new Context()
    await lazyCtx.plugin(SessionStore)
    /** 中文说明：变量 lazy 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const lazy = await lazyCtx.plugin(SqliteSessionQueryEngine, {
      path,
      openAt: 'first-search',
    })
    expect(lazyCtx.sessionQuery).toBeInstanceOf(SqliteSessionQueryEngine)
    await expect(lazyCtx.sessionQuery.searchSessions({ query: 'needle' }))
      .rejects.toThrow(expectCode('SESSION_QUERY_INDEX_FAILED'))
    await lazy.dispose()

    /** 中文说明：变量 eagerCtx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const eagerCtx = new Context()
    await eagerCtx.plugin(SessionStore)
    await expect(eagerCtx.plugin(SqliteSessionQueryEngine, { path }))
      .rejects.toThrow(expectCode('SESSION_QUERY_INDEX_FAILED'))
    expect(eagerCtx.sessionQuery).toBeUndefined()
  })

  it.each(['sessions', 'events'] as const)(
    'forwards one exact reconciliation signal through both snapshot lists and persisted inspection for %s search',
    async (scope) => {
      /** 中文说明：变量 durable 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const durable = header(`signal-${scope}`)
      TestPersistence.reset([{ meta: durable, events: messageEvents('signal needle') }])
      /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const ctx = await liveContext()
      await ctx.plugin(TestPersistence)
      /** 中文说明：变量 controller 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const controller = new AbortController()

      /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const result = scope === 'sessions'
        ? await ctx.sessionQuery.searchSessions({ query: 'needle' }, { signal: controller.signal })
        : await ctx.sessionQuery.searchEvents(
          { sessionId: durable.id, query: 'needle' },
          { signal: controller.signal },
        )

      expect(result.items).toHaveLength(1)
      expect(TestPersistence.snapshotSignals).toEqual([controller.signal, controller.signal])
      expect(TestPersistence.inspectSignals).toEqual([controller.signal])
    },
  )

  it.each(['sessions', 'events'] as const)(
    'starts no persistence observation for a pre-aborted %s search',
    async (scope) => {
      /** 中文说明：变量 durable 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const durable = header(`pre-aborted-${scope}`)
      TestPersistence.reset([{ meta: durable, events: messageEvents('needle') }])
      /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const ctx = await liveContext()
      await ctx.plugin(TestPersistence)
      /** 中文说明：变量 controller 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const controller = new AbortController()
      controller.abort(new Error(`pre-aborted ${scope}`))

      /** 中文说明：变量 pending 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const pending = scope === 'sessions'
        ? ctx.sessionQuery.searchSessions({ query: 'needle' }, { signal: controller.signal })
        : ctx.sessionQuery.searchEvents(
          { sessionId: durable.id, query: 'needle' },
          { signal: controller.signal },
        )

      await expect(pending).rejects.toThrow(expectCode('SESSION_QUERY_ABORTED'))
      expect(TestPersistence.snapshotSignals).toEqual([])
      expect(TestPersistence.inspectSignals).toEqual([])
    },
  )

  it('awaits cooperative snapshot-list cancellation cleanup without starting another observation step', async () => {
    /** 中文说明：变量 durable 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const durable = header('cooperative-list-abort')
    TestPersistence.reset([{ meta: durable, events: messageEvents('needle') }])
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await liveContext()
    await ctx.plugin(TestPersistence)
    /** 中文说明：变量 started 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const started = Promise.withResolvers<AbortSignal>()
    /** 中文说明：变量 abortObserved 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const abortObserved = Promise.withResolvers<undefined>()
    /** 中文说明：变量 cleanup 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const cleanup = Promise.withResolvers<undefined>()
    TestPersistence.snapshotEffect = async (signal) => {
      TestPersistence.snapshotEffect = undefined
      if (signal === undefined) throw new Error('expected reconciliation signal')
      started.resolve(signal)
      await new Promise<void>((resolve) => {
        signal.addEventListener('abort', () => { resolve() }, { once: true })
      })
      abortObserved.resolve(undefined)
      await cleanup.promise
      signal.throwIfAborted()
    }
    /** 中文说明：变量 controller 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const controller = new AbortController()
    /** 中文说明：变量 pending 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const pending = ctx.sessionQuery.searchSessions({ query: 'needle' }, { signal: controller.signal })
    expect(await started.promise).toBe(controller.signal)
    /** 中文说明：变量 settled 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let settled = false
    void pending.then(
      () => { settled = true },
      () => { settled = true },
    )

    controller.abort(new Error('cooperative list cancellation'))
    await abortObserved.promise
    expect(settled).toBe(false)
    expect(TestPersistence.snapshotSignals).toEqual([controller.signal])
    expect(TestPersistence.inspectSignals).toEqual([])

    cleanup.resolve(undefined)
    await expect(pending).rejects.toThrow(expectCode('SESSION_QUERY_ABORTED'))
  })

  it('keeps a second search serialized while an abort-ignoring snapshot list finishes', async () => {
    /** 中文说明：变量 durable 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const durable = header('serialized-list-abort')
    TestPersistence.reset([{ meta: durable, events: messageEvents('needle') }])
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await liveContext()
    await ctx.plugin(TestPersistence)
    /** 中文说明：变量 cleanup 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const cleanup = Promise.withResolvers<undefined>()
    /** 中文说明：变量 started 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const started = Promise.withResolvers<undefined>()
    TestPersistence.listGate = cleanup.promise
    TestPersistence.listStarted = () => {
      TestPersistence.listStarted = undefined
      started.resolve(undefined)
    }
    /** 中文说明：变量 controller 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const controller = new AbortController()
    /** 中文说明：变量 first 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const first = ctx.sessionQuery.searchSessions({ query: 'needle' }, { signal: controller.signal })
    await started.promise
    /** 中文说明：变量 firstSettled 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let firstSettled = false
    /** 中文说明：变量 secondSettled 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let secondSettled = false
    void first.then(
      () => { firstSettled = true },
      () => { firstSettled = true },
    )
    controller.abort(new Error('ignored list cancellation'))
    /** 中文说明：变量 second 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const second = ctx.sessionQuery.searchEvents({ sessionId: durable.id, query: 'needle' })
    void second.then(
      () => { secondSettled = true },
      () => { secondSettled = true },
    )
    await Promise.resolve()

    expect(firstSettled).toBe(false)
    expect(secondSettled).toBe(false)
    expect(TestPersistence.snapshotSignals).toEqual([controller.signal])
    expect(TestPersistence.inspectSignals).toEqual([])

    cleanup.resolve(undefined)
    await expect(first).rejects.toThrow(expectCode('SESSION_QUERY_ABORTED'))
    await expect(second).resolves.toMatchObject({ items: [{ sessionId: durable.id }] })
  })

  it('awaits an abort-ignoring inspection and starts neither another inspection nor the after-list', async () => {
    /** 中文说明：变量 first 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const first = header('ignored-inspect-first')
    /** 中文说明：变量 second 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const second = header('ignored-inspect-second')
    TestPersistence.reset([
      { meta: first, events: messageEvents('first needle') },
      { meta: second, events: messageEvents('second needle') },
    ])
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await liveContext()
    await ctx.plugin(TestPersistence)
    /** 中文说明：变量 started 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const started = Promise.withResolvers<AbortSignal>()
    /** 中文说明：变量 cleanup 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const cleanup = Promise.withResolvers<undefined>()
    TestPersistence.inspectEffect = async (_entry, signal) => {
      TestPersistence.inspectEffect = undefined
      if (signal === undefined) throw new Error('expected reconciliation signal')
      started.resolve(signal)
      await cleanup.promise
    }
    /** 中文说明：变量 controller 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const controller = new AbortController()
    /** 中文说明：变量 pending 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const pending = ctx.sessionQuery.searchSessions({ query: 'needle' }, { signal: controller.signal })
    expect(await started.promise).toBe(controller.signal)
    /** 中文说明：变量 settled 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let settled = false
    void pending.then(
      () => { settled = true },
      () => { settled = true },
    )

    controller.abort(new Error('ignored inspect cancellation'))
    await Promise.resolve()
    expect(settled).toBe(false)
    expect(TestPersistence.snapshotSignals).toEqual([controller.signal])
    expect(TestPersistence.inspections.get(first.id)).toBe(1)
    expect(TestPersistence.inspections.get(second.id)).toBeUndefined()

    cleanup.resolve(undefined)
    await expect(pending).rejects.toThrow(expectCode('SESSION_QUERY_ABORTED'))
    expect(TestPersistence.snapshotSignals).toEqual([controller.signal])
    expect(TestPersistence.inspections.get(second.id)).toBeUndefined()
  })

  it('cancels both queued and in-flight source waits without committing them', async () => {
    TestPersistence.reset()
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await liveContext()
    await ctx.plugin(TestPersistence)

    /** 中文说明：变量 boundaryController 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const boundaryController = new AbortController()
    /** 中文说明：变量 boundary 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const boundary = ctx.sessionQuery.searchSessions({ query: 'needle' }, { signal: boundaryController.signal })
    queueMicrotask(() => { boundaryController.abort() })
    await expect(boundary).rejects.toThrow(expectCode('SESSION_QUERY_ABORTED'))

    /** 中文说明：变量 readyController 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const readyController = new AbortController()
    readyController.abort()
    /** 中文说明：变量 internals 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const internals = ctx.sessionQuery as unknown as {
      _ensureReady(signal: AbortSignal): Promise<void>
    }
    await expect(internals._ensureReady(readyController.signal))
      .rejects.toThrow(expectCode('SESSION_QUERY_ABORTED'))

    /** 中文说明：函数值 releaseBlocking 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    let releaseBlocking!: () => void
    TestPersistence.listGate = new Promise<void>((resolve) => { releaseBlocking = resolve })
    /** 中文说明：函数值 markBlockingStarted 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    let markBlockingStarted!: () => void
    /** 中文说明：函数值 blockingStarted 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const blockingStarted = new Promise<void>((resolve) => { markBlockingStarted = resolve })
    TestPersistence.listStarted = () => {
      TestPersistence.listStarted = undefined
      markBlockingStarted()
    }
    /** 中文说明：变量 blocking 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const blocking = ctx.sessionQuery.searchSessions({ query: 'needle' })
    await blockingStarted

    /** 中文说明：变量 queuedController 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const queuedController = new AbortController()
    /** 中文说明：变量 queued 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const queued = ctx.sessionQuery.searchSessions({ query: 'needle' }, { signal: queuedController.signal })
    queuedController.abort()
    await expect(queued).rejects.toThrow(expectCode('SESSION_QUERY_ABORTED'))

    releaseBlocking()
    await expect(blocking).resolves.toEqual({ items: [] })

    TestPersistence.set({
      meta: header('uncommitted'),
      events: messageEvents('durable needle'),
    })
    /** 中文说明：函数值 releaseActive 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    let releaseActive!: () => void
    TestPersistence.listGate = new Promise<void>((resolve) => { releaseActive = resolve })
    /** 中文说明：函数值 markActiveStarted 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    let markActiveStarted!: () => void
    /** 中文说明：函数值 activeStarted 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const activeStarted = new Promise<void>((resolve) => { markActiveStarted = resolve })
    TestPersistence.listStarted = () => {
      TestPersistence.listStarted = undefined
      markActiveStarted()
    }
    /** 中文说明：变量 activeController 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const activeController = new AbortController()
    /** 中文说明：变量 active 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const active = ctx.sessionQuery.searchSessions({ query: 'needle' }, { signal: activeController.signal })
    await activeStarted
    activeController.abort()
    /** 中文说明：变量 activeSettled 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let activeSettled = false
    void active.then(
      () => { activeSettled = true },
      () => { activeSettled = true },
    )
    await Promise.resolve()
    expect(activeSettled).toBe(false)
    releaseActive()
    await expect(active).rejects.toThrow(expectCode('SESSION_QUERY_ABORTED'))

    /** 中文说明：变量 db 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const db = (ctx.sessionQuery as unknown as { _db: DatabaseSync })._db
    expect(db.prepare('SELECT COUNT(*) AS count FROM persisted_sessions').get()).toEqual({ count: 0 })
    await expect(ctx.sessionQuery.searchSessions({ query: 'needle' }))
      .resolves.toMatchObject({ items: [{ header: { id: SessionId('uncommitted') } }] })
  })

  it.each([
    [new Error('ready error'), 'ready error'],
    ['non-error ready failure', 'session-search dependency rejected with a non-Error value'],
  ])('normalizes a rejected readiness wait before mapping it to an index error', async (failure, detail) => {
    TestPersistence.reset()
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await liveContext()
    /** 中文说明：变量 internals 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const internals = ctx.sessionQuery as unknown as {
      _ready: Promise<void>
      _ensureReady(signal: AbortSignal): Promise<void>
    }
    internals._ready = Promise.resolve().then(() => {
      throw failure
    })

    await expect(internals._ensureReady(new AbortController().signal))
      .rejects.toThrow(`session-search SQLite index failed to open: ${detail}`)
  })

  it('checks cancellation after readiness before reconciliation accesses SQLite', async () => {
    TestPersistence.reset()
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await liveContext()
    /** 中文说明：变量 internals 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const internals = ctx.sessionQuery as unknown as {
      _db: DatabaseSync
      _ready: Promise<void>
      _ensureReady(signal: AbortSignal | undefined): Promise<void>
    }
    /** 中文说明：变量 readiness 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const readiness = Promise.withResolvers<undefined>()
    internals._ready = readiness.promise
    /** 中文说明：变量 readyWaitStarted 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const readyWaitStarted = Promise.withResolvers<undefined>()
    /** 中文说明：变量 ensureReady 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ensureReady = internals._ensureReady.bind(internals)
    vi.spyOn(internals, '_ensureReady').mockImplementation(async (signal) => {
      /** 中文说明：变量 pending 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const pending = ensureReady(signal)
      readyWaitStarted.resolve(undefined)
      return pending
    })
    /** 中文说明：变量 prepare 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const prepare = vi.spyOn(internals._db, 'prepare')
    /** 中文说明：变量 reason 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const reason = new Error('cancelled after readiness')
    /** 中文说明：变量 controller 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const controller = new AbortController()
    /** 中文说明：变量 pending 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const pending = ctx.sessionQuery.searchSessions({ query: 'needle' }, { signal: controller.signal })
    await readyWaitStarted.promise

    /** 中文说明：函数值 queueBoundaryAbort 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const queueBoundaryAbort = readiness.promise.then(() => {
      queueMicrotask(() => { controller.abort(reason) })
    })
    readiness.resolve(undefined)
    await queueBoundaryAbort

    await expect(pending).rejects.toThrow(expectCode('SESSION_QUERY_ABORTED'))
    expect(prepare).not.toHaveBeenCalled()
  })

  it('rejects queued and future work when close waits for an accepted operation', async () => {
    TestPersistence.reset()
    /** 中文说明：函数值 release 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    let release!: () => void
    TestPersistence.listGate = new Promise<void>((resolve) => { release = resolve })
    /** 中文说明：函数值 markStarted 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    let markStarted!: () => void
    /** 中文说明：函数值 started 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const started = new Promise<void>((resolve) => { markStarted = resolve })
    TestPersistence.listStarted = () => {
      TestPersistence.listStarted = undefined
      markStarted()
    }
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await liveContext()
    await ctx.plugin(TestPersistence)
    /** 中文说明：变量 search 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const search = ctx.sessionQuery as SqliteSessionQueryEngine
    /** 中文说明：变量 accepted 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const accepted = search.searchSessions({ query: 'needle' })
    await started
    /** 中文说明：变量 queued 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const queued = search.searchSessions({ query: 'needle' })
    /** 中文说明：变量 closing 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const closing = search.close()
    /** 中文说明：变量 repeatedClose 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const repeatedClose = search.close()
    expect(repeatedClose).toBe(closing)
    release()

    await expect(accepted).resolves.toEqual({ items: [] })
    await expect(queued).rejects.toThrow(expectCode('SESSION_QUERY_INDEX_FAILED'))
    await Promise.all([closing, repeatedClose])
    await expect(search.searchSessions({ query: 'needle' }))
      .rejects.toThrow(expectCode('SESSION_QUERY_INDEX_FAILED'))
    expect(search.close()).toBe(closing)
  })

  it('awaits optional-persistence child-fiber quiescence on disposal', async () => {
    TestPersistence.reset()
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    /** 中文说明：变量 search 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const search = await ctx.plugin(SqliteSessionQueryEngine, { path: ':memory:' })
    /** 中文说明：变量 persistence 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const persistence = await ctx.plugin(TestPersistence)
    /** 中文说明：变量 optional 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const optional = (ctx.sessionQuery as unknown as {
      _optionalPersistenceFiber: Fiber
    })._optionalPersistenceFiber
    /** 中文说明：函数值 release 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    let release!: () => void
    /** 中文说明：函数值 cleanup 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const cleanup = new Promise<void>((resolve) => { release = resolve })
    optional.ctx.effect(() => () => cleanup)

    /** 中文说明：变量 settled 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let settled = false
    /** 中文说明：函数值 disposing 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const disposing = search.dispose().then(() => { settled = true })
    await Promise.resolve()
    expect(settled).toBe(false)
    release()
    await disposing
    await persistence.dispose()
  })

  it('combines the real SQLite persistence backend with the real search service keylessly', async () => {
    /** 中文说明：变量 persistencePath 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const persistencePath = await temporaryPath('canonical.db')
    /** 中文说明：变量 searchPath 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const searchPath = await temporaryPath('derived.db')
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    /** 中文说明：变量 persistence 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const persistence = await ctx.plugin(SqliteSessionPersistence, { path: persistencePath })
    /** 中文说明：变量 search 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const search = await ctx.plugin(SqliteSessionQueryEngine, { path: searchPath })
    /** 中文说明：变量 meta 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const meta = header('real', 10, { cwd: '/work' })
    await ctx.sessionPersistence.create(meta)
    await ctx.sessionPersistence.append(meta.id, messageEvents('real SQLite needle'))

    await expect(ctx.sessionQuery.searchSessions({ query: 'SQLite needle' }))
      .resolves.toMatchObject({ items: [{ header: meta, persisted: true, live: false }] })
    await expect(ctx.sessionQuery.searchEvents({ sessionId: meta.id, query: 'SQLite needle' }))
      .resolves.toMatchObject({ session: meta, items: [{ sessionId: meta.id, seq: 0 }] })
    await expect(ctx.sessionQuery.searchEvents({ sessionId: SessionId('absent'), query: 'needle' }))
      .rejects.toThrow(expectCode('SESSION_QUERY_SESSION_NOT_FOUND'))
    await search.dispose()
    await expect(ctx.sessionPersistence.load(meta.id)).resolves.toMatchObject({ meta, events: [{ seq: 0 }] })
    await persistence.dispose()
  })

  it('reconciles colliding local revisions when a derived index reopens against another SQLite store', async () => {
    /** 中文说明：变量 persistencePathA 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const persistencePathA = await temporaryPath('canonical-a.db')
    /** 中文说明：变量 persistencePathB 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const persistencePathB = await temporaryPath('canonical-b.db')
    /** 中文说明：变量 searchPath 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const searchPath = await temporaryPath('derived-collision.db')
    /** 中文说明：变量 shared 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const shared = header('same-id', 10)

    /** 中文说明：变量 first 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const first = new Context()
    await first.plugin(SessionStore)
    /** 中文说明：变量 persistenceA 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const persistenceA = await first.plugin(SqliteSessionPersistence, { path: persistencePathA })
    await first.sessionPersistence.create(shared)
    await first.sessionPersistence.append(shared.id, messageEvents('alpha source'))
    /** 中文说明：变量 inspectA 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const inspectA = vi.spyOn(first.sessionPersistence, 'inspect')
    /** 中文说明：变量 searchA 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const searchA = await first.plugin(SqliteSessionQueryEngine, { path: searchPath })
    await expect(first.sessionQuery.searchSessions({ query: 'alpha' }))
      .resolves.toMatchObject({ items: [{ header: shared }] })
    expect(inspectA).toHaveBeenCalledTimes(1)
    await searchA.dispose()
    await persistenceA.dispose()

    /** 中文说明：变量 reopened 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const reopened = new Context()
    await reopened.plugin(SessionStore)
    /** 中文说明：变量 persistenceAAgain 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const persistenceAAgain = await reopened.plugin(SqliteSessionPersistence, { path: persistencePathA })
    /** 中文说明：变量 reopenedInspect 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const reopenedInspect = vi.spyOn(reopened.sessionPersistence, 'inspect')
    /** 中文说明：变量 searchAAgain 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const searchAAgain = await reopened.plugin(SqliteSessionQueryEngine, { path: searchPath })
    await expect(reopened.sessionQuery.searchSessions({ query: 'alpha' }))
      .resolves.toMatchObject({ items: [{ header: shared }] })
    expect(reopenedInspect).not.toHaveBeenCalled()
    await searchAAgain.dispose()
    await persistenceAAgain.dispose()

    /** 中文说明：变量 second 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const second = new Context()
    await second.plugin(SessionStore)
    /** 中文说明：变量 persistenceB 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const persistenceB = await second.plugin(SqliteSessionPersistence, { path: persistencePathB })
    await second.sessionPersistence.create(shared)
    await second.sessionPersistence.append(shared.id, messageEvents('bravo source'))
    /** 中文说明：变量 inspectB 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const inspectB = vi.spyOn(second.sessionPersistence, 'inspect')
    /** 中文说明：变量 searchB 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const searchB = await second.plugin(SqliteSessionQueryEngine, { path: searchPath })
    await expect(second.sessionQuery.searchSessions({ query: 'bravo' }))
      .resolves.toMatchObject({ items: [{ header: shared }] })
    await expect(second.sessionQuery.searchSessions({ query: 'alpha' })).resolves.toEqual({ items: [] })
    expect(inspectB).toHaveBeenCalledTimes(1)
    await searchB.dispose()
    await persistenceB.dispose()
  })
})
