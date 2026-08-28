/**
 * 文件职责：验证 tracing.spec.ts 覆盖的会话查询行为、持久化与异常场景。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、SQLite 或会话事件日志。
 * 产品维度：保障 Agent 的会话查询结果稳定、可追踪且可恢复。
 * 逻辑维度：准备会话和存储数据，执行查询或恢复流程，再核对结果、错误与清理。
 * 关键边界：持久化数据属于不可信输入；事件必须可重放；临时数据库与异步资源必须释放。
 * 新手阅读建议：先看测试夹具和查询条件，再读正常场景，最后关注重启、损坏与失败路径。
 */
import { createUserMessage, createMessage } from '@deepseek-ai/dsh-llm'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SESSION_FORMAT_VERSION, SessionId } from '@deepseek-ai/dsh-session'
import type { Session, SessionEvent, SessionHeader, SessionId as SessionIdType } from '@deepseek-ai/dsh-session'
import SessionPersistence from '@deepseek-ai/dsh-session-persistence'
import { type SessionQueryErrorCode } from '@deepseek-ai/dsh-session-query'
import { TestSessionQueryEngine } from './test-service.ts'

/** 中文说明：type MutableSessionHeader 定义本测试所需的数据或行为，用于表达会话查询场景。 */
type MutableSessionHeader = { -readonly [K in keyof SessionHeader]: SessionHeader[K] }

/** Test-only mutable view used to verify detached returned metadata. */
/* 中文说明：函数 mutableHeader 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function mutableHeader(value: SessionHeader): MutableSessionHeader {
  return value
}

/** 中文说明：函数 header 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function header(id: string, createdAt = 1, extra: Partial<SessionHeader> = {}): SessionHeader {
  return { version: SESSION_FORMAT_VERSION, id: SessionId(id), createdAt, ...extra }
}

/** 中文说明：函数 appendEvent 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function appendEvent(seq: number, sources?: number[]): SessionEvent {
  return {
    type: 'user/message',
    seq,
    time: seq + 1,
    data: createUserMessage({
      content: [{ type: 'text', text: `event ${seq}` }], source: { kind: 'user' },
    }),
    surfaceOp: 'append',
    ...sources === undefined ? {} : { sourceEventSeqs: sources },
  }
}

/** 中文说明：class TracePersistence 定义本测试所需的数据或行为，用于表达会话查询场景。 */
class TracePersistence extends SessionPersistence {
  override readonly supportsRawArtifacts = false

  static entries = new Map<SessionIdType, { meta: SessionHeader; events: SessionEvent[] }>()
  static listCalls = 0
  static inspectCalls = 0
  static listFailure: Error | undefined
  static inspectFailure: Error | undefined
  static afterList: (() => void) | undefined

  static reset(entries: readonly { meta: SessionHeader; events: SessionEvent[] }[] = []): void {
    this.entries = new Map(entries.map(entry => [entry.meta.id, structuredClone(entry)]))
    this.listCalls = 0
    this.inspectCalls = 0
    this.listFailure = undefined
    this.inspectFailure = undefined
    this.afterList = undefined
  }

  locate(_meta: SessionHeader): undefined {
    return undefined
  }

  borrowSession(_id: SessionIdType, _signal?: AbortSignal): ReturnType<SessionPersistence['borrowSession']> {
    return Promise.reject(new Error('not used'))
  }

  create(meta: SessionHeader): Promise<void> {
    TracePersistence.entries.set(meta.id, { meta: structuredClone(meta), events: [] })
    return Promise.resolve()
  }

  append(id: SessionIdType, events: readonly SessionEvent[]): Promise<void> {
    /** 中文说明：变量 entry 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const entry = TracePersistence.entries.get(id)
    if (entry === undefined) return Promise.reject(new Error('missing test session'))
    entry.events.push(...structuredClone(events))
    return Promise.resolve()
  }

  load(id: SessionIdType): Promise<{ meta: SessionHeader; events: SessionEvent[] }> {
    return this.inspect(id)
  }

  inspect(id: SessionIdType): Promise<{ meta: SessionHeader; events: SessionEvent[] }> {
    TracePersistence.inspectCalls += 1
    if (TracePersistence.inspectFailure !== undefined) return Promise.reject(TracePersistence.inspectFailure)
    /** 中文说明：变量 entry 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const entry = TracePersistence.entries.get(id)
    if (entry === undefined) return Promise.reject(new Error('missing test session'))
    return Promise.resolve(structuredClone(entry))
  }

  async readFrom(id: SessionIdType, fromSeq: number): Promise<{ meta: SessionHeader; events: SessionEvent[] }> {
    /** 中文说明：变量 whole 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const whole = await this.inspect(id)
    return { meta: whole.meta, events: whole.events.filter(event => event.seq >= fromSeq) }
  }

  list(): Promise<SessionHeader[]> {
    TracePersistence.listCalls += 1
    if (TracePersistence.listFailure !== undefined) return Promise.reject(TracePersistence.listFailure)
    /** 中文说明：函数值 result 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const result = [...TracePersistence.entries.values()].map(entry => structuredClone(entry.meta))
    TracePersistence.afterList?.()
    return Promise.resolve(result)
  }

  listSnapshots(): Promise<never[]> {
    return Promise.resolve([])
  }
}

/** 中文说明：函数 queryContext 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function queryContext(): Promise<Context> {
  /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(TestSessionQueryEngine)
  return ctx
}

/** 中文说明：函数 expectCode 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function expectCode(code: SessionQueryErrorCode): Error {
  return expect.objectContaining({ code }) as Error
}

/** 中文说明：函数 appendTraceEvents 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function appendTraceEvents(session: Session): void {
  session.append('turn/start', { turn: 1 })
  session.append('step/start', { turn: 1, step: 1 })
  session.append('assistant/chunk', {
    turn: 1,
    step: 1,
    chunk: { type: 'text-delta', index: 0, text: 'draft' },
  })
  session.append(
    'user/message',
    createUserMessage({
      content: [{ type: 'text', text: 'original' }], source: { kind: 'user' },
    }),
    { surfaceOp: 'append', sourceEventSeqs: [2] },
  )
  session.append(
    'assistant/message',
    {
      turn: 1, step: 1,
      message: createMessage({
        role: 'assistant',
        content: [{ type: 'text', text: 'summary one' }],
        source: {
          kind: 'model',
          ...{ provider: 'mock', model: 'mock' },
        },
      }),
    },
    { surfaceOp: { op: 'replace', start: 3, end: 3 }, sourceEventSeqs: [3, 2] },
  )
  session.append(
    'user/message',
    createUserMessage({
      content: [{ type: 'text', text: 'context' }], source: { kind: 'plugin', plugin: 'test' },
    }),
    { surfaceOp: 'append' },
  )
  session.append('step/end', { turn: 1, step: 1 })
  session.append('step/start', { turn: 1, step: 2 })
  session.append(
    'assistant/message',
    {
      turn: 1, step: 2,
      message: createMessage({
        role: 'assistant',
        content: [{ type: 'text', text: 'summary two' }],
        source: {
          kind: 'model',
          ...{ provider: 'mock', model: 'mock' },
        },
      }),
    },
    { surfaceOp: { op: 'replace', start: 4, end: 4 }, sourceEventSeqs: [2, 4] },
  )
}

describe('session lineage tracing', () => {
  it('returns complete ancestry, deterministic descendant trees, and detached records', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await queryContext()
    /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const root = ctx.sessions.create(SessionId('root'), { meta: { createdAt: 0 } })
    /** 中文说明：变量 parent 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const parent = ctx.sessions.create(SessionId('parent'), {
      meta: { createdAt: 1, parentSession: root.id },
    })
    /** 中文说明：变量 target 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const target = ctx.sessions.create(SessionId('target'), {
      meta: { createdAt: 2, parentSession: parent.id },
    })
    ctx.sessions.create(SessionId('b'), { meta: { createdAt: 4, parentSession: target.id } })
    /** 中文说明：变量 childA 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const childA = ctx.sessions.create(SessionId('a'), {
      meta: { createdAt: 4, parentSession: target.id },
    })
    ctx.sessions.create(SessionId('older'), { meta: { createdAt: 3, parentSession: target.id } })
    ctx.sessions.create(SessionId('grandchild'), {
      meta: { createdAt: 5, parentSession: childA.id },
    })

    /** 中文说明：变量 trace 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const trace = await ctx.sessionQuery.traceSession(target.id)
    expect(trace.complete).toBe(true)
    if (!trace.complete) throw new Error('expected complete lineage')
    expect(trace.ancestors.map(record => record.header.id)).toEqual([parent.id, root.id])
    expect(trace.root.header.id).toBe(root.id)
    expect(trace.descendants.map(node => node.session.header.id))
      .toEqual([SessionId('older'), SessionId('a'), SessionId('b')])
    expect(trace.descendants[1]?.descendants.map(node => node.session.header.id))
      .toEqual([SessionId('grandchild')])

    mutableHeader(trace.target.header).createdAt = 99
    mutableHeader(trace.ancestors[0]!.header).createdAt = 99
    mutableHeader(trace.root.header).createdAt = 99
    mutableHeader(trace.descendants[0]!.session.header).createdAt = 99
    /** 中文说明：变量 repeated 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const repeated = await ctx.sessionQuery.traceSession(target.id)
    expect(repeated.target.header.createdAt).toBe(2)
    expect(repeated.ancestors[0]?.header.createdAt).toBe(1)
    expect(repeated.descendants[0]?.session.header.createdAt).toBe(3)
  })

  it('represents root and unresolved-parent traces explicitly', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await queryContext()
    /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const root = ctx.sessions.create(SessionId('root'), { meta: { createdAt: 1 } })
    /** 中文说明：变量 partial 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const partial = ctx.sessions.create(SessionId('partial'), {
      meta: { createdAt: 2, parentSession: SessionId('outside') },
    })

    await expect(ctx.sessionQuery.traceSession(root.id)).resolves.toMatchObject({
      complete: true,
      root: { header: { id: root.id } },
      ancestors: [],
    })
    await expect(ctx.sessionQuery.traceSession(partial.id)).resolves.toMatchObject({
      complete: false,
      unresolvedParentId: SessionId('outside'),
      ancestors: [],
    })
  })

  it('rejects target-connected cycles and missing targets', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await queryContext()
    ctx.sessions.create(SessionId('a'), {
      meta: { createdAt: 1, parentSession: SessionId('b') },
    })
    ctx.sessions.create(SessionId('b'), {
      meta: { createdAt: 2, parentSession: SessionId('a') },
    })

    await expect(ctx.sessionQuery.traceSession(SessionId('a')))
      .rejects.toThrow(expectCode('SESSION_QUERY_INVALID_LINEAGE'))
    await expect(ctx.sessionQuery.traceSession(SessionId('missing')))
      .rejects.toThrow(expectCode('SESSION_QUERY_SESSION_NOT_FOUND'))
  })

  it('uses one cross-corpus observation and preserves persistence failure semantics', async () => {
    /** 中文说明：变量 durable 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const durable = header('durable')
    TracePersistence.reset([{ meta: durable, events: [appendEvent(0)] }])
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await queryContext()
    await ctx.plugin(TracePersistence)

    await expect(ctx.sessionQuery.traceSession(durable.id)).resolves.toMatchObject({
      target: { live: false, persisted: true },
      complete: true,
    })
    expect(TracePersistence.listCalls).toBe(1)
    expect(TracePersistence.inspectCalls).toBe(0)

    TracePersistence.listFailure = new Error('unavailable')
    await expect(ctx.sessionQuery.traceSession(durable.id))
      .rejects.toThrow(expectCode('SESSION_QUERY_PERSISTENCE_FAILED'))
  })

  it('constructs deeply nested descendants without consuming the JavaScript call stack', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await queryContext()
    /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const root = ctx.sessions.create(SessionId('deep-0'), { meta: { createdAt: 0 } })
    /** 中文说明：变量 parent 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let parent = root
    /** 中文说明：该循环依次处理输入数据；循环变量仅在当前循环中有效。 */
    for (let depth = 1; depth < 3_000; depth += 1) {
      parent = ctx.sessions.create(SessionId(`deep-${depth}`), {
        meta: { createdAt: depth, parentSession: parent.id },
      })
    }

    /** 中文说明：变量 trace 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const trace = await ctx.sessionQuery.traceSession(root.id)
    expect(trace.complete).toBe(true)
    /** 中文说明：变量 node 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let node = trace.descendants[0]
    /** 中文说明：该循环依次处理输入数据；循环变量仅在当前循环中有效。 */
    for (let depth = 1; depth < 3_000; depth += 1) {
      if (node === undefined) throw new Error(`lineage ended before depth ${depth}`)
      if (depth === 2_999) expect(node.session.header.id).toBe(SessionId('deep-2999'))
      node = node.descendants[0]
    }
    expect(node).toBeUndefined()
  })
})

describe('session event tracing', () => {
  it('returns direct replacement and cited source-event links in their contract order', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await queryContext()
    /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const session = ctx.sessions.create(SessionId('trace'))
    appendTraceEvents(session)

    /** 中文说明：变量 original 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const original = await ctx.sessionQuery.traceEvent({ sessionId: session.id, seq: 3 })
    expect(original.target).toMatchObject({
      sessionId: session.id,
      seq: 3,
      type: 'user/message',
      surface: 'shadowed',
    })
    expect(original).toMatchObject({
      replacedBy: 4,
      replacementChain: [4, 8],
      replacedEventSeqs: [],
      sourceEventSeqs: [2],
      derivedEventSeqs: [4],
    })
    await expect(ctx.sessionQuery.traceEvent({ sessionId: session.id, seq: 4 }))
      .resolves.toMatchObject({
        replacedBy: 8,
        replacementChain: [8],
        replacedEventSeqs: [3],
        sourceEventSeqs: [3, 2],
        derivedEventSeqs: [8],
      })
    await expect(ctx.sessionQuery.traceEvent({ sessionId: session.id, seq: 2 }))
      .resolves.toMatchObject({
        target: { surface: 'log-only' },
        replacementChain: [],
        sourceEventSeqs: [],
        derivedEventSeqs: [3, 4, 8],
      })
    await expect(ctx.sessionQuery.traceEvent({ sessionId: session.id, seq: 8 }))
      .resolves.toMatchObject({
        replacementChain: [],
        replacedEventSeqs: [4],
        sourceEventSeqs: [2, 4],
        derivedEventSeqs: [],
      })
  })

  it('returns fresh trace arrays and target records', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await queryContext()
    /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const session = ctx.sessions.create(SessionId('detached'))
    appendTraceEvents(session)

    /** 中文说明：变量 first 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const first = await ctx.sessionQuery.traceEvent({ sessionId: session.id, seq: 4 })
    first.target.time = -1
    first.replacementChain.push(99)
    first.replacedEventSeqs.push(99)
    first.sourceEventSeqs.push(99)
    first.derivedEventSeqs.push(99)
    /** 中文说明：变量 repeated 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const repeated = await ctx.sessionQuery.traceEvent({ sessionId: session.id, seq: 4 })
    expect(repeated.target.time).not.toBe(-1)
    expect(repeated.replacementChain).toEqual([8])
    expect(repeated.replacedEventSeqs).toEqual([3])
    expect(repeated.sourceEventSeqs).toEqual([3, 2])
    expect(repeated.derivedEventSeqs).toEqual([8])
  })

  it('inspects persisted logs once, prefers live logs, and preserves failures and conflicts', async () => {
    /** 中文说明：变量 durable 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const durable = header('shared', 1, { cwd: '/same' })
    TracePersistence.reset([{ meta: durable, events: [appendEvent(0)] }])
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await queryContext()
    await ctx.plugin(TracePersistence)

    await expect(ctx.sessionQuery.traceEvent({ sessionId: durable.id, seq: 0 }))
      .resolves.toMatchObject({ target: { type: 'user/message', surface: 'current' } })
    expect([TracePersistence.listCalls, TracePersistence.inspectCalls]).toEqual([1, 1])

    /** 中文说明：变量 live 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const live = ctx.sessions.create(durable.id, { meta: { createdAt: 1, cwd: '/same' } })
    live.append('turn/start', { turn: 1 })
    live.append(
      'user/message',
      createUserMessage({
        content: [{ type: 'text', text: 'live' }], source: { kind: 'plugin', plugin: 'test' },
      }),
      { surfaceOp: 'append' },
    )
    TracePersistence.listFailure = new Error('list unavailable')
    TracePersistence.inspectFailure = new Error('inspect unavailable')
    await expect(ctx.sessionQuery.traceEvent({ sessionId: durable.id, seq: 1 }))
      .resolves.toMatchObject({ target: { type: 'user/message' } })
    expect([TracePersistence.listCalls, TracePersistence.inspectCalls]).toEqual([1, 1])

    TracePersistence.reset([{ meta: durable, events: [appendEvent(0)] }])
    /** 中文说明：变量 failedCtx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const failedCtx = await queryContext()
    await failedCtx.plugin(TracePersistence)
    TracePersistence.listFailure = new Error('list unavailable')
    await expect(failedCtx.sessionQuery.traceEvent({ sessionId: durable.id, seq: 0 }))
      .rejects.toThrow(expectCode('SESSION_QUERY_PERSISTENCE_FAILED'))
    TracePersistence.listFailure = undefined
    TracePersistence.inspectFailure = new Error('inspect unavailable')
    await expect(failedCtx.sessionQuery.traceEvent({ sessionId: durable.id, seq: 0 }))
      .rejects.toThrow(expectCode('SESSION_QUERY_PERSISTENCE_FAILED'))
    TracePersistence.inspectFailure = undefined
    TracePersistence.afterList = () => {
      mutableHeader(TracePersistence.entries.get(durable.id)!.meta).cwd = '/changed'
    }
    await expect(failedCtx.sessionQuery.traceEvent({ sessionId: durable.id, seq: 0 }))
      .rejects.toThrow(expectCode('SESSION_QUERY_SOURCE_CONFLICT'))
  })

  it('checks target existence before surface or source-event analysis', async () => {
    /** 中文说明：变量 bad 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const bad = header('bad-target')
    /** 中文说明：变量 malformed 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const malformed: SessionEvent[] = [appendEvent(0), {
      type: 'assistant/message',
      seq: 1,
      time: 2,
      data: {
        turn: 1, step: 1,
        message: createMessage({
          role: 'assistant',
          content: [],
          source: {
            kind: 'model',
            ...{ provider: 'mock', model: 'mock' },
          },
        }),
      },
      surfaceOp: { op: 'replace', start: 9, end: 9 },
      sourceEventSeqs: [],
    }]
    TracePersistence.reset([{ meta: bad, events: malformed }])
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await queryContext()
    await ctx.plugin(TracePersistence)

    await expect(ctx.sessionQuery.traceEvent({ sessionId: bad.id, seq: 9 }))
      .rejects.toThrow(expectCode('SESSION_QUERY_EVENT_NOT_FOUND'))
    await expect(ctx.sessionQuery.traceEvent({ sessionId: bad.id, seq: 0 }))
      .rejects.toThrow(expectCode('SESSION_QUERY_INVALID_SURFACE'))
  })

  it.each([
    ['non-surface sources', [
      { type: 'turn/start', seq: 0, time: 1, data: { turn: 1 }, sourceEventSeqs: [0] },
    ]],
    ['invalid source array', [
      { ...appendEvent(0), sourceEventSeqs: 'invalid' },
    ]],
    ['empty sources', [
      appendEvent(0, []),
    ]],
    ['sparse sources', [
      appendEvent(0, Array<number>(1)),
    ]],
    ['duplicate sources', [
      appendEvent(0),
      appendEvent(1, [0, 0]),
    ]],
    ['missing earlier source', [
      appendEvent(0),
      appendEvent(1, [-1]),
    ]],
    ['future source', [
      appendEvent(0, [1]),
      appendEvent(1),
    ]],
    ['replacement without sources', [
      appendEvent(0),
      { ...appendEvent(1), surfaceOp: { op: 'replace', start: 0, end: 0 } },
    ]],
    ['replacement missing a shadowed source', [
      { type: 'assistant/chunk', seq: 0, time: 1, data: { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: 'draft' } } },
      appendEvent(1),
      { ...appendEvent(2, [0]), surfaceOp: { op: 'replace', start: 1, end: 1 } },
    ]],
  ] as const)('rejects an invalid surface log: %s', async (_name, rawEvents) => {
    /** 中文说明：变量 durable 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const durable = header('invalid-provenance')
    /** 中文说明：变量 events 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const events = structuredClone(rawEvents) as unknown as SessionEvent[]
    TracePersistence.reset([{ meta: durable, events }])
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await queryContext()
    await ctx.plugin(TracePersistence)

    await expect(ctx.sessionQuery.traceEvent({ sessionId: durable.id, seq: 0 }))
      .rejects.toThrow(expectCode('SESSION_QUERY_INVALID_SURFACE'))
  })

  it('rejects surfaceOp on a non-surface event as an invalid surface', async () => {
    /** 中文说明：变量 durable 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const durable = header('invalid-non-surface-op')
    /** 中文说明：变量 events 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const events = [{
      type: 'turn/start',
      seq: 0,
      time: 1,
      data: { turn: 1 },
      surfaceOp: 'append',
    }] as unknown as SessionEvent[]
    TracePersistence.reset([{ meta: durable, events }])
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await queryContext()
    await ctx.plugin(TracePersistence)

    await expect(ctx.sessionQuery.traceEvent({ sessionId: durable.id, seq: 0 }))
      .rejects.toThrow(expectCode('SESSION_QUERY_INVALID_SURFACE'))
  })

  it('applies the same surface contract to listEvents', async () => {
    /** 中文说明：变量 durable 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const durable = header('list-regression')
    TracePersistence.reset([{ meta: durable, events: [appendEvent(0), appendEvent(1, [0, 0])] }])
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await queryContext()
    await ctx.plugin(TracePersistence)

    await expect(ctx.sessionQuery.listEvents(durable.id))
      .rejects.toThrow(expectCode('SESSION_QUERY_INVALID_SURFACE'))
  })
})
