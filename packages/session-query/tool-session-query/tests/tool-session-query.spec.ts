/**
 * 文件职责：验证 tool-session-query.spec.ts 覆盖的会话查询行为、持久化与异常场景。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、SQLite 或会话事件日志。
 * 产品维度：保障 Agent 的会话查询结果稳定、可追踪且可恢复。
 * 逻辑维度：准备会话和存储数据，执行查询或恢复流程，再核对结果、错误与清理。
 * 关键边界：持久化数据属于不可信输入；事件必须可重放；临时数据库与异步资源必须释放。
 * 新手阅读建议：先看测试夹具和查询条件，再读正常场景，最后关注重启、损坏与失败路径。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context, type Fiber } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage, CallId, HarnessError , createMessage } from '@deepseek-ai/dsh-llm'
import { MAX_TIMER_DELAY_MS, TimeoutReason } from '@deepseek-ai/dsh-timeout'
import * as TimeoutPolicy from '@deepseek-ai/dsh-tool-call-timeout-policy'
import SessionStore, {
  SESSION_FORMAT_VERSION,
  SessionId,
  /** 中文说明：type Session 定义本测试所需的数据或行为，用于表达会话查询场景。 */
  type Session,
  /** 中文说明：type SessionHeader 定义本测试所需的数据或行为，用于表达会话查询场景。 */
  type SessionHeader,
  /** 中文说明：type SessionId 定义本测试所需的数据或行为，用于表达会话查询场景。 */
  type SessionId as SessionIdValue,
} from '@deepseek-ai/dsh-session'
import SessionQueryEngine, {
  SessionQueryError,
  SessionSearchCursor,
  /** 中文说明：type SessionEventSearchHit 定义本测试所需的数据或行为，用于表达会话查询场景。 */
  type SessionEventSearchHit,
  /** 中文说明：type SessionEventSearchPage 定义本测试所需的数据或行为，用于表达会话查询场景。 */
  type SessionEventSearchPage,
  /** 中文说明：type SessionEventSearchRequest 定义本测试所需的数据或行为，用于表达会话查询场景。 */
  type SessionEventSearchRequest,
  /** 中文说明：type SessionLineageNode 定义本测试所需的数据或行为，用于表达会话查询场景。 */
  type SessionLineageNode,
  /** 中文说明：type SessionSearchExecContext 定义本测试所需的数据或行为，用于表达会话查询场景。 */
  type SessionSearchExecContext,
  /** 中文说明：type SessionSearchHit 定义本测试所需的数据或行为，用于表达会话查询场景。 */
  type SessionSearchHit,
  /** 中文说明：type SessionSearchPage 定义本测试所需的数据或行为，用于表达会话查询场景。 */
  type SessionSearchPage,
  /** 中文说明：type SessionSearchRequest 定义本测试所需的数据或行为，用于表达会话查询场景。 */
  type SessionSearchRequest,
  /** 中文说明：type SessionTitleObservationResult 定义本测试所需的数据或行为，用于表达会话查询场景。 */
  type SessionTitleObservationResult,
} from '@deepseek-ai/dsh-session-query'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { type ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import * as ToolSessionQuery from '@deepseek-ai/dsh-tool-session-query'

/** 中文说明：变量 activeContexts 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const activeContexts: Context[] = []

afterEach(async () => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  /** 中文说明：该循环依次处理输入数据；循环变量仅在当前循环中有效。 */
  for (const ctx of activeContexts.splice(0)) await ctx.fiber.dispose()
  FakeQuery.reset()
})

/** 中文说明：函数 header 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function header(id: string, cwd: string | undefined, createdAt = 1, parentSession?: SessionIdValue): SessionHeader {
  return {
    version: SESSION_FORMAT_VERSION,
    id: SessionId(id),
    createdAt,
    ...cwd === undefined ? {} : { cwd },
    ...parentSession === undefined ? {} : { parentSession },
  }
}

/** 中文说明：函数 createSession 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function createSession(
  ctx: Context,
  id: string,
  cwd: string | undefined,
  createdAt = 1,
  parentSession?: SessionIdValue,
): Session {
  return ctx.sessions.create(SessionId(id), {
    meta: {
      createdAt,
      ...cwd === undefined ? {} : { cwd },
      ...parentSession === undefined ? {} : { parentSession },
    },
  })
}

/** 中文说明：函数 openStep 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function openStep(session: Session, text = 'prior needle'): void {
  session.append('turn/start', { turn: 1 })
  session.append(
    'user/message',
    createUserMessage({
      content: [{ type: 'text', text }], source: { kind: 'user' },
    }),
    { surfaceOp: 'append' },
  )
  session.append('step/start', { turn: 1, step: 1 })
}

/** 中文说明：函数 fakeAgent 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function fakeAgent(session: Session): Agent {
  return { id: session.id, session } as unknown as Agent
}

/** 中文说明：函数 sessionHit 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function sessionHit(
  id: string,
  cwd: string | undefined,
  text = 'needle excerpt',
  parentSession?: SessionIdValue,
): SessionSearchHit {
  return {
    header: header(id, cwd, 100, parentSession),
    live: true,
    persisted: false,
    bestMatch: {
      sessionId: SessionId(id),
      seq: 4,
      type: 'assistant/message',
      time: 200,
      surface: 'current',
      snippet: text,
    },
  }
}

/** 中文说明：函数 eventHit 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function eventHit(sessionId: SessionIdValue, seq: number, text = 'needle excerpt'): SessionEventSearchHit {
  return {
    sessionId,
    seq,
    type: 'user/message',
    time: 200 + seq,
    surface: 'current',
    snippet: text,
  }
}

/** 中文说明：class FakeQuery 定义本测试所需的数据或行为，用于表达会话查询场景。 */
class FakeQuery extends SessionQueryEngine {
  static sessionSearch: (
    request: SessionSearchRequest,
    exec?: SessionSearchExecContext,
  ) => Promise<SessionSearchPage<SessionSearchHit>> = () => Promise.resolve({ items: [] })

  static eventSearch: (
    request: SessionEventSearchRequest,
    exec?: SessionSearchExecContext,
  ) => Promise<SessionEventSearchPage> = request => Promise.resolve({
    session: header(request.sessionId, '/work'),
    items: [],
  })

  static sessionRequests: SessionSearchRequest[] = []
  static eventRequests: SessionEventSearchRequest[] = []
  static searchSignals: Array<AbortSignal | undefined> = []
  static titles = new Map<SessionIdValue, string | Error>()

  static reset(): void {
    this.sessionSearch = () => Promise.resolve({ items: [] })
    this.eventSearch = request => Promise.resolve({
      session: header(request.sessionId, '/work'),
      items: [],
    })
    this.sessionRequests = []
    this.eventRequests = []
    this.searchSignals = []
    this.titles = new Map()
  }

  override searchSessions(
    request: SessionSearchRequest,
    exec?: SessionSearchExecContext,
  ): Promise<SessionSearchPage<SessionSearchHit>> {
    FakeQuery.sessionRequests.push(request)
    FakeQuery.searchSignals.push(exec?.signal)
    return FakeQuery.sessionSearch(request, exec)
  }

  override searchEvents(
    request: SessionEventSearchRequest,
    exec?: SessionSearchExecContext,
  ): Promise<SessionEventSearchPage> {
    FakeQuery.eventRequests.push(request)
    FakeQuery.searchSignals.push(exec?.signal)
    return FakeQuery.eventSearch(request, exec)
  }

  override async readTitleSnapshots(
    sessionIds: readonly SessionIdValue[],
    signal?: AbortSignal,
  ): Promise<SessionTitleObservationResult[]> {
    /** 中文说明：变量 observations 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const observations = await super.readTitleSnapshots(sessionIds, signal)
    return observations.map((observation): SessionTitleObservationResult => {
      /** 中文说明：变量 value 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const value = FakeQuery.titles.get(observation.sessionId)
      if (value instanceof Error) {
        return { sessionId: observation.sessionId, status: 'rejected', reason: value }
      }
      if (value === undefined || observation.status === 'rejected') return observation
      return {
        ...observation,
        value: {
          ...observation.value,
          title: {
            title: value,
            messageSeqs: [],
            source: { kind: 'fallback' },
            eventSeq: 0,
            updatedAt: 1,
          },
        },
      }
    })
  }
}

/** 中文说明：interface Mounted 定义本测试所需的数据或行为，用于表达会话查询场景。 */
interface Mounted {
  readonly ctx: Context
  readonly fiber: Fiber
  readonly caller: Session
  call(name: string, args: unknown, options?: { agent?: Agent; signal?: AbortSignal }): Promise<ToolExecutionResult>
}

/** 中文说明：函数 mount 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function mount(
  config: ToolSessionQuery.Config = {},
  callerCwd: string | null = '/work',
  enforceTimeout = false,
): Promise<Mounted> {
  /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const ctx = new Context()
  activeContexts.push(ctx)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  if (enforceTimeout) await ctx.plugin(TimeoutPolicy)
  await ctx.plugin(FakeQuery)
  /** 中文说明：变量 fiber 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const fiber = await ctx.plugin(ToolSessionQuery, config)
  /** 中文说明：变量 caller 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const caller = createSession(ctx, 'caller', callerCwd ?? undefined, 10)
  openStep(caller)
  /** 中文说明：变量 calls 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let calls = 0
  return {
    ctx,
    fiber,
    caller,
    call: (toolName, args, options = {}) => ctx.tools.execute({
      name: toolName,
      arguments: args,
      callId: CallId(`call-${++calls}`),
      signal: options.signal ?? new AbortController().signal,
      ...options.agent === undefined ? { agent: fakeAgent(caller) } : { agent: options.agent },
    }),
  }
}

/** 中文说明：函数 text 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function text(result: ToolExecutionResult): string {
  return result.content.map(block => block.type === 'text' ? block.text : '').join('\n')
}

/** 中文说明：函数 errorCode 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function errorCode(result: ToolExecutionResult): string | undefined {
  return result.isError ? result.error.info?.code : undefined
}

describe('registration and schemas', () => {
  it('registers the five cursor-free tools, prompt, timeouts, and pure generic presenters, then disposes them', async () => {
    /** 中文说明：变量 mounted 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const mounted = await mount({ maxSearchResults: 7, searchTimeoutMs: 1234 })
    /** 中文说明：函数值 names 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const names = mounted.ctx.tools.schemas().map(schema => schema.name)
    expect(names).toEqual([
      'session_search',
      'session_event_search',
      'session_trace',
      'session_event_trace',
      'session_event_read',
    ])
    /** 中文说明：函数值 sessionSchema 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const sessionSchema = mounted.ctx.tools.schemas().find(schema => schema.name === 'session_search')
    expect(sessionSchema?.parameters).not.toHaveProperty('properties.cursor')
    expect(sessionSchema?.parameters).not.toHaveProperty('properties.limit')
    expect(sessionSchema?.parameters).not.toHaveProperty('properties.cwd')
    expect(mounted.ctx.tools.get('session_search')?.timeoutMs).toBe(1234)
    expect(mounted.ctx.tools.get('session_trace')?.timeoutMs).toBeUndefined()
    /** 中文说明：变量 parallelArgs 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const parallelArgs: Record<string, unknown> = {
      session_trace: {},
      session_event_trace: { seq: 0 },
      session_event_read: { seq: 0 },
    }
    /** 中文说明：该循环依次处理输入数据；循环变量仅在当前循环中有效。 */
    for (const [name, args] of Object.entries(parallelArgs)) {
      expect(mounted.ctx.tools.get(name)?.isConcurrencySafe?.(args)).toBe(true)
    }
    expect(mounted.ctx.tools.get('session_search')?.output.render({}, 'rendered'))
      .toEqual([{ type: 'text', text: 'rendered' }])
    expect(mounted.ctx.tools.get('session_search')?.presentCall?.({ query: 'needle' }))
      .toEqual({ card: 'generic', kind: 'search', title: 'Search prior sessions', rawInput: 'needle' })
    expect(mounted.ctx.tools.get('session_event_search')?.presentCall?.({ query: 'needle' }))
      .toEqual({ card: 'generic', kind: 'search', title: 'Search session events', rawInput: 'needle' })
    expect(mounted.ctx.tools.get('session_trace')?.presentCall?.({}))
      .toEqual({ card: 'generic', kind: 'read', title: 'Trace current session' })
    expect(mounted.ctx.tools.get('session_trace')?.presentCall?.({ session_id: 'other' }))
      .toEqual({ card: 'generic', kind: 'read', title: 'Trace session other', rawInput: 'other' })
    expect(mounted.ctx.tools.get('session_event_trace')?.presentCall?.({ session_id: 'other', seq: 3 }))
      .toEqual({
        card: 'generic',
        kind: 'read',
        title: 'Trace event 3',
        rawInput: { session_id: 'other', seq: 3 },
      })
    expect(mounted.ctx.tools.get('session_event_read')?.presentCall?.({ seq: 4 }))
      .toEqual({ card: 'generic', kind: 'read', title: 'Read event 4', rawInput: { seq: 4 } })
    /** 中文说明：变量 assembly 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const assembly = await mounted.ctx.systemPrompt.assemble()
    expect(assembly.sections.find(section => section.name === 'tool:session-query')?.text)
      .toContain('prior sessions')

    await mounted.fiber.dispose()
    expect(mounted.ctx.tools.schemas().map(schema => schema.name)).toEqual([])
    expect((await mounted.ctx.systemPrompt.assemble()).sections.map(section => section.name))
      .not.toContain('tool:session-query')
  })

  it('keeps generation-bound searches exclusive while exact observations remain parallel', async () => {
    /** 中文说明：变量 mounted 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const mounted = await mount()
    /** 中文说明：变量 classifications 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const classifications = [
      ['session_search', { query: 'q' }, 'exclusive'],
      ['session_event_search', { query: 'q' }, 'exclusive'],
      ['session_trace', {}, 'parallel'],
      ['session_event_trace', { seq: 0 }, 'parallel'],
      ['session_event_read', { seq: 0 }, 'parallel'],
    ] as const

    /** 中文说明：该循环依次处理输入数据；循环变量仅在当前循环中有效。 */
    for (const [name, args, kind] of classifications) {
      expect(mounted.ctx.tools.executionMode({
        name,
        arguments: args,
        callId: CallId(`mode-${name}`),
        signal: new AbortController().signal,
        agent: fakeAgent(mounted.caller),
      })).toEqual({ kind })
    }
  })

  it('fails invalid direct config before registering anything', async () => {
    /** 中文说明：变量 mounted 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const mounted = await mount()
    /** 中文说明：该循环依次处理输入数据；循环变量仅在当前循环中有效。 */
    for (const maxSearchResults of [0, 1.5, Number.NaN]) {
      expect(() => { ToolSessionQuery.apply(mounted.ctx, { maxSearchResults }) })
        .toThrow('maxSearchResults')
    }
    /** 中文说明：该循环依次处理输入数据；循环变量仅在当前循环中有效。 */
    for (const searchTimeoutMs of [0, 1.5, Number.POSITIVE_INFINITY, MAX_TIMER_DELAY_MS + 1]) {
      expect(() => { ToolSessionQuery.apply(mounted.ctx, { searchTimeoutMs }) })
        .toThrow(`no greater than ${MAX_TIMER_DELAY_MS}`)
    }
    expect(() => { ToolSessionQuery.apply(new Context(), {}) }).toThrow()
  })

  it('expresses the complete Node timer range in the Loader config schema', () => {
    expect(new ToolSessionQuery.Config({ searchTimeoutMs: MAX_TIMER_DELAY_MS }))
      .toEqual({ maxSearchResults: 100, searchTimeoutMs: MAX_TIMER_DELAY_MS })
    expect(() => new ToolSessionQuery.Config({ searchTimeoutMs: 1.5 })).toThrow()
    expect(() => new ToolSessionQuery.Config({ searchTimeoutMs: MAX_TIMER_DELAY_MS + 1 })).toThrow()
  })
})

describe('input validation and translation', () => {
  it.each([
    [{ query: '   ' }, 'SESSION_QUERY_INVALID_QUERY'],
    [{ query: 'bad\0query' }, 'SESSION_QUERY_INVALID_QUERY'],
    [{ query: 'q', session_ids: [] }, 'SESSION_QUERY_INVALID_FILTER'],
    [{ query: 'q', parent_session_ids: [] }, 'SESSION_QUERY_INVALID_FILTER'],
    [{ query: 'q', availability: [] }, 'SESSION_QUERY_INVALID_FILTER'],
    [{ query: 'q', availability: ['archived'] }, 'INVALID_ARGS'],
    [{ query: 'q', event_types: [] }, 'SESSION_QUERY_INVALID_FILTER'],
    [{ query: 'q', event_surfaces: [] }, 'SESSION_QUERY_INVALID_FILTER'],
    [{ query: 'q', event_surfaces: ['hidden'] }, 'INVALID_ARGS'],
    [{ query: 'q', event_seq_from: -1 }, 'SESSION_QUERY_INVALID_FILTER'],
    [{ query: 'q', event_seq_to: Number.MAX_SAFE_INTEGER + 1 }, 'SESSION_QUERY_INVALID_FILTER'],
    [{ query: 'q', event_seq_from: 2, event_seq_to: 1 }, 'SESSION_QUERY_INVALID_FILTER'],
    [{ query: 'q', created_at_from: '2026-07-24T10:00:00' }, 'SESSION_QUERY_INVALID_FILTER'],
    [{ query: 'q', created_at_from: '2026-02-30T10:00:00Z' }, 'SESSION_QUERY_INVALID_FILTER'],
    [{ query: 'q', created_at_from: '2100-02-29T10:00:00Z' }, 'SESSION_QUERY_INVALID_FILTER'],
    [{ query: 'q', created_at_from: '2026-04-31T10:00:00Z' }, 'SESSION_QUERY_INVALID_FILTER'],
    [{ query: 'q', created_at_from: '2026-01-01T24:00:00Z' }, 'SESSION_QUERY_INVALID_FILTER'],
    [{ query: 'q', created_at_from: '2026-01-01T00:60:00Z' }, 'SESSION_QUERY_INVALID_FILTER'],
    [{ query: 'q', created_at_from: '2026-01-01T00:00:60Z' }, 'SESSION_QUERY_INVALID_FILTER'],
    [{ query: 'q', created_at_from: '2026-01-01T00:00:00+24:00' }, 'SESSION_QUERY_INVALID_FILTER'],
    [{ query: 'q', created_at_from: '2026-01-01T00:00:00+00:60' }, 'SESSION_QUERY_INVALID_FILTER'],
    [{
      query: 'q',
      created_at_from: '2026-07-25T00:00:00Z',
      created_at_to: '2026-07-24T00:00:00Z',
    }, 'SESSION_QUERY_INVALID_FILTER'],
  ])('rejects invalid search arguments %#', async (args, code) => {
    /** 中文说明：变量 mounted 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const mounted = await mount()
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await mounted.call('session_search', args)
    expect(errorCode(result)).toBe(code)
  })

  it('normalizes the query and compiles inclusive session/event filters with one parent OR clause', async () => {
    /** 中文说明：变量 mounted 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const mounted = await mount()
    createSession(mounted.ctx, 'parent', '/work')
    await mounted.call('session_search', {
      query: '  alpha   beta ',
      session_ids: ['a', 'b'],
      created_at_from: '2026-07-24T00:00:00+08:00',
      created_at_to: '2026-07-24T01:00:00+08:00',
      parent_session_ids: ['parent'],
      include_root_sessions: true,
      availability: ['live'],
      event_seq_from: 2,
      event_seq_to: 9,
      event_time_from: '2026-07-24T00:00:00Z',
      event_time_to: '2026-07-24T01:00:00Z',
      event_types: ['plugin/open-event'],
      event_surfaces: ['shadowed'],
    })
    expect(FakeQuery.sessionRequests).toHaveLength(1)
    expect(FakeQuery.sessionRequests[0]).toEqual({
      query: 'alpha beta',
      sessionFilters: [
        { kind: 'id', values: ['a', 'b'] },
        {
          kind: 'created-at',
          from: Date.parse('2026-07-24T00:00:00+08:00'),
          to: Date.parse('2026-07-24T01:00:00+08:00'),
        },
        { kind: 'availability', values: ['live'] },
        { kind: 'parent', values: ['parent', null] },
        { kind: 'cwd', values: ['/work'] },
      ],
      eventFilters: [
        { kind: 'seq', from: 2, to: 9 },
        {
          kind: 'time',
          from: Date.parse('2026-07-24T00:00:00Z'),
          to: Date.parse('2026-07-24T01:00:00Z'),
        },
        { kind: 'type', values: ['plugin/open-event'] },
        { kind: 'surface', values: ['shadowed'] },
      ],
    })
  })

  it.each([
    ['one fractional digit', '2026-07-24T00:00:00.1Z', 100],
    ['two fractional digits', '2026-07-24T00:00:00.12Z', 120],
    ['three fractional digits', '2026-07-24T00:00:00.123Z', 123],
  ])('normalizes %s into an exact integer epoch-millisecond filter', async (_case, value, offset) => {
    /** 中文说明：变量 mounted 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const mounted = await mount()
    await mounted.call('session_search', {
      query: 'q',
      created_at_from: value,
    })
    /** 中文说明：变量 expected 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const expected = Date.parse('2026-07-24T00:00:00.000Z') + offset
    expect(Number.isFinite(expected)).toBe(true)
    expect(FakeQuery.sessionRequests[0]?.sessionFilters).toContainEqual({
      kind: 'created-at',
      from: expected,
    })
  })

  it('maps exact same-millisecond decimal bounds to adjacent numeric values without collapsing the interval', async () => {
    /** 中文说明：变量 mounted 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const mounted = await mount()
    /** 中文说明：变量 base 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const base = Date.parse('2026-07-24T00:00:00.000Z')
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await mounted.call('session_search', {
      query: 'q',
      created_at_from: '2026-07-24T00:00:00.12300001Z',
      created_at_to: '2026-07-24T08:00:00.1239999+08:00',
    })

    expect(result.isError).toBe(false)
    expect(text(result)).toContain('No prior session matches found.')
    /** 中文说明：变量 range 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const range = FakeQuery.sessionRequests[0]?.sessionFilters
      ?.find(filter => filter.kind === 'created-at')
    expect(range).toBeDefined()
    if (range?.kind !== 'created-at' || range.from === undefined || range.to === undefined) {
      throw new Error('expected complete created-at range')
    }
    expect(Number.isFinite(range.from)).toBe(true)
    expect(Number.isFinite(range.to)).toBe(true)
    expect(range.from).toBeGreaterThan(base + 123)
    expect(range.from).toBeLessThan(base + 124)
    expect(range.to).toBeGreaterThan(base + 123)
    expect(range.to).toBeLessThan(base + 124)
    expect(range.from).toBeLessThan(range.to)
  })

  it('rejects exact bounds reversed only below one millisecond before calling the provider', async () => {
    /** 中文说明：变量 mounted 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const mounted = await mount()
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await mounted.call('session_search', {
      query: 'q',
      created_at_from: '2026-07-24T00:00:00.12300002Z',
      created_at_to: '2026-07-24T00:00:00.12300001Z',
    })

    expect(errorCode(result)).toBe('SESSION_QUERY_INVALID_FILTER')
    expect(FakeQuery.sessionRequests).toEqual([])
  })

  it('compares unequal-length exact remainders with implicit trailing decimal zeroes', async () => {
    /** 中文说明：变量 mounted 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const mounted = await mount()
    /** 中文说明：变量 ordered 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ordered = await mounted.call('session_search', {
      query: 'q',
      created_at_from: '2026-07-24T00:00:00.1231Z',
      created_at_to: '2026-07-24T00:00:00.12311Z',
    })
    expect(ordered.isError).toBe(false)

    /** 中文说明：变量 reversed 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const reversed = await mounted.call('session_search', {
      query: 'q',
      created_at_from: '2026-07-24T00:00:00.12311Z',
      created_at_to: '2026-07-24T00:00:00.1231Z',
    })
    expect(errorCode(reversed)).toBe('SESSION_QUERY_INVALID_FILTER')
  })

  it('treats trailing-zero fractional spellings as the same exact instant', async () => {
    /** 中文说明：变量 mounted 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const mounted = await mount()
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await mounted.call('session_search', {
      query: 'q',
      created_at_from: '2026-07-24T00:00:00.1230000100Z',
      created_at_to: '2026-07-24T00:00:00.12300001Z',
    })

    expect(result.isError).toBe(false)
    expect(FakeQuery.sessionRequests).toHaveLength(1)
  })

  it('maps fractional bounds correctly across zero and for negative pre-epoch milliseconds', async () => {
    /** 中文说明：变量 mounted 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const mounted = await mount()
    await mounted.call('session_search', {
      query: 'q',
      created_at_from: '1970-01-01T00:00:00.0000001Z',
      event_time_to: '1969-12-31T23:59:59.9999999Z',
    })
    expect(FakeQuery.sessionRequests[0]?.sessionFilters).toContainEqual({
      kind: 'created-at',
      from: Number.MIN_VALUE,
    })
    expect(FakeQuery.sessionRequests[0]?.eventFilters).toContainEqual({
      kind: 'time',
      to: -Number.MIN_VALUE,
    })

    await mounted.call('session_event_search', {
      query: 'q',
      time_from: '1969-12-31T23:59:59.87600001Z',
      time_to: '1969-12-31T19:59:59.8769999-04:00',
    })
    /** 中文说明：函数值 range 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const range = FakeQuery.eventRequests[0]?.filters?.find(filter => filter.kind === 'time')
    expect(range).toBeDefined()
    if (range?.kind !== 'time' || range.from === undefined || range.to === undefined) {
      throw new Error('expected complete event time range')
    }
    expect(range.from).toBeGreaterThan(-124)
    expect(range.from).toBeLessThan(-123)
    expect(range.to).toBeGreaterThan(-124)
    expect(range.to).toBeLessThan(-123)
    expect(range.from).toBeLessThan(range.to)
  })

  it('rejects a normalized timestamp when the platform parser cannot produce a finite value', async () => {
    /** 中文说明：变量 mounted 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const mounted = await mount()
    vi.spyOn(Date, 'parse').mockReturnValueOnce(Number.NaN)

    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await mounted.call('session_search', {
      query: 'q',
      created_at_from: '2026-07-24T00:00:00.123456Z',
    })

    expect(errorCode(result)).toBe('SESSION_QUERY_INVALID_FILTER')
    expect(FakeQuery.sessionRequests).toEqual([])
  })

  it('compiles one-sided timestamps and independent root/parent clauses', async () => {
    /** 中文说明：变量 mounted 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const mounted = await mount()
    createSession(mounted.ctx, 'parent', '/work')
    await mounted.call('session_search', {
      query: 'q',
      created_at_from: '2024-02-29T00:00Z',
      include_root_sessions: true,
      event_time_to: '2000-02-29T00:00Z',
    })
    expect(FakeQuery.sessionRequests[0]?.sessionFilters).toContainEqual({
      kind: 'created-at',
      from: Date.parse('2024-02-29T00:00Z'),
    })
    expect(FakeQuery.sessionRequests[0]?.sessionFilters).toContainEqual({
      kind: 'parent',
      values: [null],
    })
    expect(FakeQuery.sessionRequests[0]?.eventFilters).toContainEqual({
      kind: 'time',
      to: Date.parse('2000-02-29T00:00Z'),
    })

    await mounted.call('session_search', {
      query: 'q',
      parent_session_ids: ['parent'],
    })
    expect(FakeQuery.sessionRequests[1]?.sessionFilters).toContainEqual({
      kind: 'parent',
      values: ['parent'],
    })
  })
})

describe('workspace authority and lineage redaction', () => {
  it('fails closed without an agent and for direct cross-workspace targets', async () => {
    /** 中文说明：变量 mounted 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const mounted = await mount()
    createSession(mounted.ctx, 'outside', '/outside')
    /** 中文说明：变量 missing 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const missing = await mounted.ctx.tools.execute({
      name: 'session_trace',
      arguments: {},
      callId: CallId('missing-agent'),
      signal: new AbortController().signal,
    })
    expect(errorCode(missing)).toBe('SESSION_QUERY_TOOL_MISSING_AGENT')
    /** 中文说明：变量 denied 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const denied = await mounted.call('session_event_read', { session_id: 'outside', seq: 0 })
    expect(errorCode(denied)).toBe('SESSION_QUERY_TOOL_UNAUTHORIZED')
    expect(text(denied)).not.toContain('session "outside"')
  })

  it('allows only self for a null-cwd caller and denies cross-session search', async () => {
    /** 中文说明：变量 mounted 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const mounted = await mount({}, null)
    /** 中文说明：变量 own 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const own = await mounted.call('session_trace', {})
    expect(own.isError).toBe(false)
    expect(text(own)).toContain('Session caller')
    expect(errorCode(await mounted.call('session_search', { query: 'q' })))
      .toBe('SESSION_QUERY_TOOL_UNAUTHORIZED')
    createSession(mounted.ctx, 'other', undefined)
    expect(errorCode(await mounted.call('session_trace', { session_id: 'other' })))
      .toBe('SESSION_QUERY_TOOL_UNAUTHORIZED')
  })

  it('makes hidden and nonexistent parent guesses indistinguishable without calling search', async () => {
    /** 中文说明：变量 mounted 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const mounted = await mount()
    /** 中文说明：变量 hiddenParent 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const hiddenParent = createSession(mounted.ctx, 'guessed-hidden-parent-secret', '/outside')
    /** 中文说明：变量 visibleChild 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const visibleChild = createSession(
      mounted.ctx,
      'visible-child-of-hidden-parent',
      '/work',
      20,
      hiddenParent.id,
    )
    FakeQuery.sessionSearch = () => Promise.resolve({
      items: [sessionHit(visibleChild.id, '/work', 'must not be discoverable', hiddenParent.id)],
    })

    /** 中文说明：变量 hidden 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const hidden = await mounted.call('session_search', {
      query: 'needle',
      parent_session_ids: [hiddenParent.id],
    })
    /** 中文说明：变量 missing 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const missing = await mounted.call('session_search', {
      query: 'needle',
      parent_session_ids: ['guessed-missing-parent'],
    })

    expect(hidden).toEqual(missing)
    expect(text(hidden)).toBe('No prior session matches found.')
    expect(JSON.stringify(hidden)).not.toContain(visibleChild.id)
    expect(FakeQuery.sessionRequests).toEqual([])
  })

  it('deduplicates parent guesses and sends only authorized parents plus the root marker', async () => {
    /** 中文说明：变量 mounted 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const mounted = await mount()
    /** 中文说明：变量 visible 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const visible = createSession(mounted.ctx, 'visible-parent', '/work')
    /** 中文说明：变量 hidden 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const hidden = createSession(mounted.ctx, 'hidden-parent-filter-secret', '/outside')

    await mounted.call('session_search', {
      query: 'needle',
      parent_session_ids: [visible.id, hidden.id, visible.id, 'missing-parent'],
      include_root_sessions: true,
    })
    await mounted.call('session_search', {
      query: 'needle',
      parent_session_ids: [hidden.id],
      include_root_sessions: true,
    })
    await mounted.call('session_search', {
      query: 'needle',
      parent_session_ids: ['missing-parent'],
      include_root_sessions: true,
    })

    /** 中文说明：函数值 parentValues 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const parentValues = FakeQuery.sessionRequests.map(request =>
      request.sessionFilters?.find(filter => filter.kind === 'parent'))
    expect(parentValues).toEqual([
      { kind: 'parent', values: [visible.id, null] },
      { kind: 'parent', values: [null] },
      { kind: 'parent', values: [null] },
    ])
  })

  it('rejects unrequested or unauthorized records returned during parent preauthorization', async () => {
    /** 中文说明：变量 mounted 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const mounted = await mount()
    /** 中文说明：变量 requested 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const requested = SessionId('requested-parent')
    vi.spyOn(mounted.ctx.sessionQuery, 'filterSessions').mockResolvedValueOnce([
      { header: header('unrequested-parent', '/work'), live: true, persisted: false },
      { header: header(requested, '/outside'), live: true, persisted: false },
    ])

    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await mounted.call('session_search', {
      query: 'needle',
      parent_session_ids: [requested],
    })

    expect(text(result)).toBe('No prior session matches found.')
    expect(FakeQuery.sessionRequests).toEqual([])
  })

  it('validates every other search filter before parent preauthorization', async () => {
    /** 中文说明：变量 mounted 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const mounted = await mount()
    /** 中文说明：变量 filterSessions 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const filterSessions = vi.spyOn(mounted.ctx.sessionQuery, 'filterSessions')

    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await mounted.call('session_search', {
      query: 'needle',
      parent_session_ids: ['guessed-parent'],
      event_seq_from: -1,
    })

    expect(errorCode(result)).toBe('SESSION_QUERY_INVALID_FILTER')
    expect(filterSessions).not.toHaveBeenCalled()
    expect(FakeQuery.sessionRequests).toEqual([])
  })

  it('sanitizes parent preauthorization failures without calling search', async () => {
    /** 中文说明：变量 mounted 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const mounted = await mount()
    /** 中文说明：变量 secret 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const secret = 'conflict at hidden-parent-preauthorization-secret'
    vi.spyOn(mounted.ctx.sessionQuery, 'filterSessions').mockRejectedValueOnce(
      new SessionQueryError(secret, 'SESSION_QUERY_SOURCE_CONFLICT'),
    )
    /** 中文说明：函数值 warn 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const warn = vi.spyOn(mounted.ctx.logger, 'warn').mockImplementation(() => undefined)

    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await mounted.call('session_search', {
      query: 'needle',
      parent_session_ids: ['guessed-parent'],
    })

    expect(errorCode(result)).toBe('SESSION_QUERY_TOOL_FAILED')
    expect(text(result)).toBe('Error: session query operation failed')
    expect(JSON.stringify(result)).not.toContain(secret)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(secret))
    expect(FakeQuery.sessionRequests).toEqual([])
  })

  it('sanitizes direct-target authorization failures before event search', async () => {
    /** 中文说明：变量 mounted 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const mounted = await mount()
    /** 中文说明：变量 target 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const target = createSession(mounted.ctx, 'authorization-failure-target', '/work')
    /** 中文说明：变量 secret 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const secret = 'conflict with hidden-authorization-session-secret'
    vi.spyOn(mounted.ctx.sessionQuery, 'filterSessions').mockRejectedValueOnce(
      new SessionQueryError(secret, 'SESSION_QUERY_SOURCE_CONFLICT'),
    )
    /** 中文说明：函数值 warn 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const warn = vi.spyOn(mounted.ctx.logger, 'warn').mockImplementation(() => undefined)

    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await mounted.call('session_event_search', {
      session_id: target.id,
      query: 'needle',
    })

    expect(errorCode(result)).toBe('SESSION_QUERY_TOOL_FAILED')
    expect(text(result)).toBe('Error: session query operation failed')
    expect(JSON.stringify(result)).not.toContain(secret)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(secret))
    expect(FakeQuery.eventRequests).toEqual([])
  })

  it('preserves parent-preauthorization cancellation and waits for cleanup without logging it', async () => {
    /** 中文说明：变量 mounted 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const mounted = await mount()
    /** 中文说明：变量 controller 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const controller = new AbortController()
    /** 中文说明：变量 cancellation 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const cancellation = new SessionQueryError(
      'parent preauthorization cancelled',
      'SESSION_QUERY_ABORTED',
    )
    /** 中文说明：变量 started 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const started = Promise.withResolvers<undefined>()
    /** 中文说明：变量 abortObserved 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const abortObserved = Promise.withResolvers<undefined>()
    /** 中文说明：变量 cleanup 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const cleanup = Promise.withResolvers<undefined>()
    /** 中文说明：变量 active 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let active = false
    vi.spyOn(mounted.ctx.sessionQuery, 'filterSessions')
      .mockImplementation(async (_filters, signal) => {
        if (signal === undefined) throw new Error('expected parent-authorization signal')
        active = true
        /** 中文说明：函数值 aborted 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
        const aborted = new Promise<void>((resolve) => {
          signal.addEventListener('abort', () => { resolve() }, { once: true })
        })
        started.resolve(undefined)
        await aborted
        abortObserved.resolve(undefined)
        await cleanup.promise
        active = false
        signal.throwIfAborted()
        return []
      })
    /** 中文说明：函数值 warn 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const warn = vi.spyOn(mounted.ctx.logger, 'warn').mockImplementation(() => undefined)

    /** 中文说明：变量 pending 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const pending = mounted.call('session_search', {
      query: 'needle',
      parent_session_ids: ['guessed-parent'],
    }, { signal: controller.signal })
    /** 中文说明：变量 settled 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let settled = false
    void pending.then(
      () => { settled = true },
      () => { settled = true },
    )
    await started.promise
    controller.abort(cancellation)
    await abortObserved.promise

    expect(settled).toBe(false)
    expect(active).toBe(true)
    expect(FakeQuery.sessionRequests).toEqual([])

    cleanup.resolve(undefined)
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await pending
    expect(active).toBe(false)
    expect(errorCode(result)).toBe('SESSION_QUERY_ABORTED')
    expect(text(result)).toBe('Error: parent preauthorization cancelled')
    expect(warn).not.toHaveBeenCalled()
  })

  it('redacts an unauthorized ancestor and prunes unauthorized descendant subtrees without hidden ids', async () => {
    /** 中文说明：变量 mounted 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const mounted = await mount()
    /** 中文说明：变量 hiddenParent 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const hiddenParent = createSession(mounted.ctx, 'hidden-parent-secret', '/outside')
    /** 中文说明：变量 target 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const target = createSession(mounted.ctx, 'target', '/work', 20, hiddenParent.id)
    /** 中文说明：变量 visible 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const visible = createSession(mounted.ctx, 'visible-child', '/work', 30, target.id)
    /** 中文说明：变量 hidden 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const hidden = createSession(mounted.ctx, 'hidden-child-secret', '/outside', 40, target.id)
    createSession(mounted.ctx, 'hidden-grandchild-secret', '/work', 50, hidden.id)
    FakeQuery.titles.set(target.id, 'Target title')
    FakeQuery.titles.set(visible.id, 'Visible title')

    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await mounted.call('session_trace', { session_id: target.id })
    /** 中文说明：变量 output 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const output = text(result)
    expect(output).toContain('Target title')
    expect(output).toContain('visible-child')
    expect(output).toContain('[outside workspace boundary]')
    expect(output).toContain('[outside workspace subtree]')
    expect(output).not.toContain('hidden-parent-secret')
    expect(output).not.toContain('hidden-child-secret')
    expect(output).not.toContain('hidden-grandchild-secret')
  })

  it('sanitizes a real outside-workspace ancestor cycle before the lineage error reaches the model', async () => {
    /** 中文说明：变量 mounted 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const mounted = await mount()
    /** 中文说明：变量 hiddenA 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const hiddenA = SessionId('hidden-cycle-a-secret')
    /** 中文说明：变量 hiddenB 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const hiddenB = SessionId('hidden-cycle-b-secret')
    createSession(mounted.ctx, hiddenA, '/outside', 2, hiddenB)
    createSession(mounted.ctx, hiddenB, '/outside', 3, hiddenA)
    /** 中文说明：变量 target 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const target = createSession(mounted.ctx, 'visible-cycle-target', '/work', 4, hiddenA)

    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await mounted.call('session_trace', { session_id: target.id })

    expect(errorCode(result)).toBe('SESSION_QUERY_INVALID_LINEAGE')
    expect(text(result)).toBe('Error: session lineage is invalid')
    /** 中文说明：变量 presentation 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const presentation = JSON.stringify(result)
    expect(presentation).not.toContain(hiddenA)
    expect(presentation).not.toContain(hiddenB)
  })

  it.each([
    {
      name: 'sensitive source conflict',
      makeError: () => new SessionQueryError(
        'conflict with hidden-lineage-session-secret',
        'SESSION_QUERY_SOURCE_CONFLICT',
      ),
      code: 'SESSION_QUERY_TOOL_FAILED',
      message: 'session query operation failed',
      secret: 'hidden-lineage-session-secret',
    },
    {
      name: 'typed query error',
      makeError: () => new SessionQueryError(
        'unrelated persistence failure',
        'SESSION_QUERY_PERSISTENCE_FAILED',
      ),
      code: 'SESSION_QUERY_PERSISTENCE_FAILED',
      message: 'session history storage is unavailable',
      secret: 'unrelated persistence failure',
    },
    {
      name: 'plain error',
      makeError: () => new Error('unrelated plain trace failure'),
      code: 'SESSION_QUERY_TOOL_FAILED',
      message: 'session query operation failed',
      secret: 'unrelated plain trace failure',
    },
  ])('sanitizes an unrelated $name from lineage tracing', async ({ makeError, code, message, secret }) => {
    /** 中文说明：变量 mounted 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const mounted = await mount()
    /** 中文说明：变量 target 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const target = createSession(mounted.ctx, 'trace-failure-target', '/work')
    /** 中文说明：函数值 warn 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const warn = vi.spyOn(mounted.ctx.logger, 'warn').mockImplementation(() => undefined)
    vi.spyOn(mounted.ctx.sessionQuery, 'traceSession').mockRejectedValueOnce(makeError())

    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await mounted.call('session_trace', { session_id: target.id })

    expect(errorCode(result)).toBe(code)
    expect(text(result)).toBe(`Error: ${message}`)
    expect(JSON.stringify(result)).not.toContain(secret)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(secret))
  })

  it.each([
    'session_event_trace',
    'session_event_read',
  ] as const)('sanitizes typed service diagnostics from %s', async (toolName) => {
    /** 中文说明：变量 mounted 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const mounted = await mount()
    /** 中文说明：变量 target 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const target = createSession(mounted.ctx, `${toolName}-failure-target`, '/work')
    target.append(
      'user/message',
      createUserMessage({
        content: [{ type: 'text', text: 'event' }], source: { kind: 'user' },
      }),
      { surfaceOp: 'append' },
    )
    /** 中文说明：变量 secret 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const secret = `event missing beside hidden-${toolName}-secret`
    /** 中文说明：变量 failure 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const failure = new SessionQueryError(secret, 'SESSION_QUERY_EVENT_NOT_FOUND')
    if (toolName === 'session_event_trace') {
      vi.spyOn(mounted.ctx.sessionQuery, 'traceEvent').mockRejectedValueOnce(failure)
    } else {
      vi.spyOn(mounted.ctx.sessionQuery, 'readEvent').mockRejectedValueOnce(failure)
    }
    /** 中文说明：函数值 warn 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const warn = vi.spyOn(mounted.ctx.logger, 'warn').mockImplementation(() => undefined)

    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await mounted.call(toolName, { session_id: target.id, seq: 0 })

    expect(errorCode(result)).toBe('SESSION_QUERY_EVENT_NOT_FOUND')
    expect(text(result)).toBe('Error: session event was not found')
    expect(JSON.stringify(result)).not.toContain(secret)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(secret))
  })

  it.each([
    'session_trace',
    'session_event_trace',
    'session_event_read',
  ] as const)('forwards the exact signal to %s and waits for service cleanup', async (toolName) => {
    /** 中文说明：变量 mounted 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const mounted = await mount()
    /** 中文说明：变量 target 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const target = createSession(mounted.ctx, `cancelled-${toolName}`, '/work')
    target.append(
      'user/message',
      createUserMessage({
        content: [{ type: 'text', text: 'pending exact read' }], source: { kind: 'user' },
      }),
      { surfaceOp: 'append' },
    )
    /** 中文说明：变量 controller 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const controller = new AbortController()
    /** 中文说明：变量 cancellation 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const cancellation = new SessionQueryError(
      `${toolName} cancelled`,
      'SESSION_QUERY_ABORTED',
    )
    /** 中文说明：变量 started 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const started = Promise.withResolvers<undefined>()
    /** 中文说明：变量 abortObserved 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const abortObserved = Promise.withResolvers<undefined>()
    /** 中文说明：变量 cleanup 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const cleanup = Promise.withResolvers<undefined>()
    /** 中文说明：函数值 warn 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const warn = vi.spyOn(mounted.ctx.logger, 'warn').mockImplementation(() => undefined)
    /** 中文说明：变量 observedSignal 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let observedSignal: AbortSignal | undefined
    /** 中文说明：变量 active 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let active = false
    /** 中文说明：函数值 holdExactRead 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const holdExactRead = async (signal?: AbortSignal): Promise<never> => {
      if (signal === undefined) throw new Error('expected exact tool execution signal')
      observedSignal = signal
      active = true
      /** 中文说明：函数值 aborted 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
      const aborted = new Promise<void>((resolve) => {
        signal.addEventListener('abort', () => { resolve() }, { once: true })
      })
      started.resolve(undefined)
      await aborted
      abortObserved.resolve(undefined)
      await cleanup.promise
      active = false
      signal.throwIfAborted()
      throw new Error('unreachable after exact tool cancellation')
    }
    if (toolName === 'session_trace') {
      vi.spyOn(mounted.ctx.sessionQuery, 'traceSession')
        .mockImplementation((_sessionId, signal) => holdExactRead(signal))
    } else if (toolName === 'session_event_trace') {
      vi.spyOn(mounted.ctx.sessionQuery, 'traceEvent')
        .mockImplementation((_request, signal) => holdExactRead(signal))
    } else {
      vi.spyOn(mounted.ctx.sessionQuery, 'readEvent')
        .mockImplementation((_request, signal) => holdExactRead(signal))
    }
    /** 中文说明：变量 args 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const args = toolName === 'session_trace'
      ? { session_id: target.id }
      : { session_id: target.id, seq: 0 }

    /** 中文说明：变量 pending 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const pending = mounted.call(toolName, args, { signal: controller.signal })
    /** 中文说明：变量 settled 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let settled = false
    void pending.then(
      () => { settled = true },
      () => { settled = true },
    )
    await started.promise
    controller.abort(cancellation)
    await abortObserved.promise

    expect(settled).toBe(false)
    expect(active).toBe(true)
    expect(observedSignal).toBe(controller.signal)

    cleanup.resolve(undefined)
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await pending
    expect(active).toBe(false)
    expect(errorCode(result)).toBe('SESSION_QUERY_ABORTED')
    expect(text(result)).toBe(`Error: ${toolName} cancelled`)
    expect(warn).not.toHaveBeenCalled()
  })

  it('preserves caller cancellation while a lineage trace is pending', async () => {
    /** 中文说明：变量 mounted 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const mounted = await mount()
    /** 中文说明：变量 target 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const target = createSession(mounted.ctx, 'cancelled-trace-target', '/work')
    /** 中文说明：变量 trace 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const trace = await mounted.ctx.sessionQuery.traceSession(target.id)
    /** 中文说明：函数值 started 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    let started!: () => void
    /** 中文说明：函数值 traceStarted 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const traceStarted = new Promise<void>((resolve) => { started = resolve })
    /** 中文说明：函数值 finish 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    let finish!: (value: typeof trace) => void
    vi.spyOn(mounted.ctx.sessionQuery, 'traceSession').mockImplementation(() => {
      started()
      return new Promise<typeof trace>((resolve) => { finish = resolve })
    })
    /** 中文说明：变量 controller 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const controller = new AbortController()
    /** 中文说明：变量 cancellation 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const cancellation = new SessionQueryError('lineage trace cancelled', 'SESSION_QUERY_ABORTED')

    /** 中文说明：变量 pending 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const pending = mounted.call(
      'session_trace',
      { session_id: target.id },
      { signal: controller.signal },
    )
    await traceStarted
    controller.abort(cancellation)
    finish(trace)
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await pending

    expect(errorCode(result)).toBe('SESSION_QUERY_ABORTED')
    expect(text(result)).toBe('Error: lineage trace cancelled')
  })

  it('gives caller cancellation precedence when a pending trace rejects with invalid lineage', async () => {
    /** 中文说明：变量 mounted 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const mounted = await mount()
    /** 中文说明：变量 target 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const target = createSession(mounted.ctx, 'cancelled-invalid-lineage-target', '/work')
    /** 中文说明：函数值 started 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    let started!: () => void
    /** 中文说明：函数值 traceStarted 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const traceStarted = new Promise<void>((resolve) => { started = resolve })
    /** 中文说明：函数值 fail 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    let fail!: (error: SessionQueryError) => void
    vi.spyOn(mounted.ctx.sessionQuery, 'traceSession').mockImplementation(() => {
      started()
      return new Promise((_resolve, reject) => { fail = reject })
    })
    /** 中文说明：变量 controller 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const controller = new AbortController()
    /** 中文说明：变量 cancellation 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const cancellation = new SessionQueryError('lineage trace cancelled first', 'SESSION_QUERY_ABORTED')

    /** 中文说明：变量 pending 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const pending = mounted.call(
      'session_trace',
      { session_id: target.id },
      { signal: controller.signal },
    )
    await traceStarted
    controller.abort(cancellation)
    fail(new SessionQueryError(
      'session lineage contains a cycle at "hidden-race-secret"',
      'SESSION_QUERY_INVALID_LINEAGE',
    ))
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await pending

    expect(errorCode(result)).toBe('SESSION_QUERY_ABORTED')
    expect(text(result)).toBe('Error: lineage trace cancelled first')
    expect(JSON.stringify(result)).not.toContain('hidden-race-secret')
  })

  it('renders branching descendants in source preorder with one indented marker per pruned subtree', async () => {
    /** 中文说明：变量 mounted 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const mounted = await mount()
    /** 中文说明：变量 target 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const target = createSession(mounted.ctx, 'branch-target', '/work', 20)
    const [targetRecord] = await mounted.ctx.sessionQuery.filterSessions([{
      kind: 'id',
      values: [target.id],
    }])
    if (targetRecord === undefined) throw new Error('expected target record')
    /** 中文说明：变量 firstId 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const firstId = SessionId('branch-first')
    /** 中文说明：变量 nestedId 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const nestedId = SessionId('branch-nested')
    /** 中文说明：变量 hiddenId 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const hiddenId = SessionId('branch-hidden-secret')
    /** 中文说明：变量 hiddenDescendantId 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const hiddenDescendantId = SessionId('branch-hidden-descendant-secret')
    /** 中文说明：变量 lastId 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const lastId = SessionId('branch-last')
    /** 中文说明：变量 descendants 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const descendants: SessionLineageNode[] = [
      {
        session: { ...targetRecord, header: header(firstId, '/work', 30) },
        descendants: [
          {
            session: { ...targetRecord, header: header(nestedId, '/work', 40) },
            descendants: [],
          },
          {
            session: { ...targetRecord, header: header(hiddenId, '/outside', 50) },
            descendants: [{
              session: { ...targetRecord, header: header(hiddenDescendantId, '/work', 60) },
              descendants: [],
            }],
          },
        ],
      },
      {
        session: { ...targetRecord, header: header(lastId, '/work', 70) },
        descendants: [],
      },
    ]
    vi.spyOn(mounted.ctx.sessionQuery, 'traceSession').mockResolvedValue({
      target: targetRecord,
      ancestors: [],
      descendants,
      complete: true,
      root: targetRecord,
    })
    /** 中文说明：变量 titleReads 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const titleReads: SessionIdValue[] = []
    vi.spyOn(mounted.ctx.sessionQuery, 'readTitleSnapshots').mockImplementation((sessionIds) => {
      titleReads.push(...sessionIds)
      return Promise.resolve([...new Set(sessionIds)].map(sessionId => ({
        sessionId,
        status: 'fulfilled' as const,
        value: { session: header(sessionId, '/work') },
      })))
    })

    /** 中文说明：变量 output 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const output = text(await mounted.call('session_trace', { session_id: target.id }))
    expect(output.slice(output.indexOf('Descendants:'))).toBe([
      'Descendants:',
      '- branch-first — untitled | 1970-01-01T00:00:00.030Z | live',
      '  - branch-nested — untitled | 1970-01-01T00:00:00.040Z | live',
      '  - [outside workspace subtree]',
      '- branch-last — untitled | 1970-01-01T00:00:00.070Z | live',
    ].join('\n'))
    expect(titleReads).toEqual([target.id, firstId, nestedId, lastId])
  })

  it('renders authorized ancestors and an unresolved lineage boundary without leaking it', async () => {
    /** 中文说明：变量 mounted 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const mounted = await mount()
    /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const root = createSession(mounted.ctx, 'visible-root', '/work', 5)
    /** 中文说明：变量 target 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const target = createSession(mounted.ctx, 'visible-target', '/work', 6, root.id)
    /** 中文说明：变量 complete 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const complete = text(await mounted.call('session_trace', { session_id: target.id }))
    expect(complete).toContain('visible-root')

    /** 中文说明：变量 missingParent 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const missingParent = SessionId('missing-parent-secret')
    /** 中文说明：变量 incomplete 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const incomplete = createSession(mounted.ctx, 'incomplete-target', '/work', 7, missingParent)
    /** 中文说明：变量 redacted 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const redacted = text(await mounted.call('session_trace', { session_id: incomplete.id }))
    expect(redacted).toContain('[outside workspace boundary]')
    expect(redacted).not.toContain(missingParent)
  })

  it('renders unavailable trace records and keeps a self-id descendant authorized', async () => {
    /** 中文说明：变量 mounted 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const mounted = await mount()
    /** 中文说明：变量 target 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const target = createSession(mounted.ctx, 'trace-unavailable', '/work')
    const [record] = await mounted.ctx.sessionQuery.filterSessions([{ kind: 'id', values: [target.id] }])
    const [callerRecord] = await mounted.ctx.sessionQuery.filterSessions([{
      kind: 'id',
      values: [mounted.caller.id],
    }])
    if (record === undefined || callerRecord === undefined) throw new Error('expected live records')
    /** 中文说明：变量 unavailable 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const unavailable = { ...record, live: false, persisted: false }
    /** 中文说明：变量 persisted 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const persisted = { ...callerRecord, live: false, persisted: true }
    vi.spyOn(mounted.ctx.sessionQuery, 'traceSession').mockResolvedValue({
      target: unavailable,
      ancestors: [],
      descendants: [{ session: persisted, descendants: [] }],
      complete: true,
      root: unavailable,
    })
    /** 中文说明：变量 output 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const output = text(await mounted.call('session_trace', { session_id: target.id }))
    expect(output).toContain('Availability: unavailable')
    expect(output).toContain(mounted.caller.id)
    expect(output).toContain('persisted')
  })

  it('rejects every payload observation whose target moved after pre-authorization', async () => {
    /** 中文说明：变量 mounted 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const mounted = await mount()
    /** 中文说明：变量 target 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const target = createSession(mounted.ctx, 'moving-target', '/work')
    target.append(
      'user/message',
      createUserMessage({
        content: [{ type: 'text', text: 'authorized payload' }], source: { kind: 'user' },
      }),
      { surfaceOp: 'append' },
    )
    /** 中文说明：变量 movedHeader 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const movedHeader = header(target.id, '/outside')

    FakeQuery.eventSearch = () => Promise.resolve({
      session: movedHeader,
      items: [eventHit(target.id, 0, 'secret event hit')],
    })
    /** 中文说明：变量 search 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const search = await mounted.call('session_event_search', {
      session_id: target.id,
      query: 'secret',
    })
    expect(errorCode(search)).toBe('SESSION_QUERY_TOOL_UNAUTHORIZED')
    expect(text(search)).not.toContain('secret event hit')

    /** 中文说明：变量 lineage 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const lineage = await mounted.ctx.sessionQuery.traceSession(target.id)
    vi.spyOn(mounted.ctx.sessionQuery, 'traceSession').mockResolvedValueOnce({
      ...lineage,
      target: { ...lineage.target, header: movedHeader },
    })
    expect(errorCode(await mounted.call('session_trace', { session_id: target.id })))
      .toBe('SESSION_QUERY_TOOL_UNAUTHORIZED')

    /** 中文说明：变量 eventTrace 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const eventTrace = await mounted.ctx.sessionQuery.traceEvent({ sessionId: target.id, seq: 0 })
    vi.spyOn(mounted.ctx.sessionQuery, 'traceEvent').mockResolvedValueOnce({
      ...eventTrace,
      session: movedHeader,
    })
    expect(errorCode(await mounted.call('session_event_trace', { session_id: target.id, seq: 0 })))
      .toBe('SESSION_QUERY_TOOL_UNAUTHORIZED')

    /** 中文说明：变量 eventWindow 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const eventWindow = await mounted.ctx.sessionQuery.readEvent({ sessionId: target.id, seq: 0 })
    vi.spyOn(mounted.ctx.sessionQuery, 'readEvent').mockResolvedValueOnce({
      ...eventWindow,
      session: movedHeader,
    })
    expect(errorCode(await mounted.call('session_event_read', { session_id: target.id, seq: 0 })))
      .toBe('SESSION_QUERY_TOOL_UNAUTHORIZED')

    FakeQuery.sessionSearch = () => Promise.resolve({
      items: [sessionHit(target.id, '/work', 'safe hit')],
    })
    vi.spyOn(mounted.ctx.sessionQuery, 'readTitleSnapshots').mockResolvedValueOnce([{
      sessionId: target.id,
      status: 'fulfilled',
      value: {
        session: movedHeader,
        title: {
          title: 'secret moved title',
          messageSeqs: [],
          source: { kind: 'fallback' },
          eventSeq: 0,
          updatedAt: 1,
        },
      },
    }])
    /** 中文说明：变量 titled 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const titled = await mounted.call('session_search', { query: 'safe' })
    expect(errorCode(titled)).toBe('SESSION_QUERY_TOOL_UNAUTHORIZED')
    expect(text(titled)).not.toContain('secret moved title')
  })

  it('rejects a default self read when its same-id observation moved after caller capture', async () => {
    /** 中文说明：变量 mounted 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const mounted = await mount()
    /** 中文说明：变量 appendLegacy 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const appendLegacy = mounted.caller.append.bind(mounted.caller) as unknown as (
      type: string,
      data: unknown,
    ) => Session['events'][number]
    /** 中文说明：变量 secret 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const secret = appendLegacy(
      'context/message',
      {
        content: [{ type: 'text', text: 'same-id moved secret' }],
        source: { kind: 'plugin', plugin: 'test' },
      },
    )
    /** 中文说明：变量 window 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const window = await mounted.ctx.sessionQuery.readEvent({
      sessionId: mounted.caller.id,
      seq: secret.seq,
    })
    vi.spyOn(mounted.ctx.sessionQuery, 'readEvent').mockResolvedValueOnce({
      ...window,
      session: header(mounted.caller.id, '/outside'),
    })

    /** 中文说明：变量 denied 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const denied = await mounted.call('session_event_read', { seq: secret.seq })
    expect(errorCode(denied)).toBe('SESSION_QUERY_TOOL_UNAUTHORIZED')
    expect(text(denied)).not.toContain('same-id moved secret')
  })
})

describe('search paging, prior-history bounds, titles, and cancellation', () => {
  it('drains hidden internal pages to the authorized non-self cap and masks an unauthorized parent id', async () => {
    /** 中文说明：变量 mounted 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const mounted = await mount({ maxSearchResults: 2 })
    /** 中文说明：变量 outside 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const outside = createSession(mounted.ctx, 'outside-parent-secret', '/outside')
    /** 中文说明：变量 a 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const a = createSession(mounted.ctx, 'a', '/work')
    /** 中文说明：变量 b 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const b = createSession(mounted.ctx, 'b', '/work')
    FakeQuery.titles.set(a.id, 'Alpha')
    FakeQuery.titles.set(b.id, 'Beta')
    /** 中文说明：变量 c1 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const c1 = SessionSearchCursor('c1')
    /** 中文说明：变量 c2 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const c2 = SessionSearchCursor('c2')
    FakeQuery.sessionSearch = (request) => {
      if (request.cursor === undefined) {
        return Promise.resolve({
          items: [
            sessionHit('caller', '/work'),
            sessionHit('unauthorized', '/outside'),
          ],
          nextCursor: c1,
        })
      }
      if (request.cursor === c1) {
        return Promise.resolve({
          items: [sessionHit('a', '/work', 'first', outside.id)],
          nextCursor: c2,
        })
      }
      return Promise.resolve({
        items: [
          sessionHit('b', '/work', 'second'),
          sessionHit('additional-authorized', '/work', 'third'),
        ],
      })
    }

    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await mounted.call('session_search', { query: 'needle' })
    /** 中文说明：变量 output 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const output = text(result)
    expect(FakeQuery.sessionRequests).toHaveLength(3)
    expect(FakeQuery.sessionRequests.every(request => request.limit === undefined)).toBe(true)
    expect(FakeQuery.sessionRequests.map(request => request.cursor)).toEqual([undefined, c1, c2])
    expect(output).toContain('Session a — Alpha')
    expect(output).toContain('Session b — Beta')
    expect(output).toContain('Parent: [outside workspace]')
    expect(output).not.toContain('outside-parent-secret')
    expect(output).toContain('Result cap reached')
  })

  it('does not report a cap when only rejected hits remain after the authorized limit', async () => {
    /** 中文说明：变量 mounted 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const mounted = await mount({ maxSearchResults: 1 })
    /** 中文说明：变量 cursor 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const cursor = SessionSearchCursor('rejected-tail')
    FakeQuery.sessionSearch = request => request.cursor === undefined
      ? Promise.resolve({
        items: [sessionHit('authorized', '/work')],
        nextCursor: cursor,
      })
      : Promise.resolve({
        items: [
          sessionHit(mounted.caller.id, '/work'),
          sessionHit('outside', '/outside'),
        ],
      })

    /** 中文说明：变量 output 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const output = text(await mounted.call('session_search', { query: 'needle' }))
    expect(FakeQuery.sessionRequests.map(request => request.cursor)).toEqual([undefined, cursor])
    expect(output).toContain('Session authorized')
    expect(output).not.toContain('Result cap reached')
  })

  it.each([
    {
      toolName: 'session_search',
      args: { query: 'needle' },
      secrets: [
        'session source conflict at hidden-search-session-secret',
        'hidden-search-cause-secret',
      ],
      failure: () => new SessionQueryError(
        'session source conflict at hidden-search-session-secret',
        'SESSION_QUERY_SOURCE_CONFLICT',
        { cause: new Error('hidden-search-cause-secret') },
      ),
    },
    {
      toolName: 'session_event_search',
      args: { query: 'needle' },
      secrets: [
        'plain event provider failure at hidden-event-session-secret',
        'hidden-event-cause-secret',
      ],
      failure: () => new Error(
        'plain event provider failure at hidden-event-session-secret',
        { cause: 'hidden-event-cause-secret' },
      ),
    },
  ] as const)('sanitizes $toolName provider diagnostics', async ({ toolName, args, secrets, failure }) => {
    /** 中文说明：变量 mounted 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const mounted = await mount()
    if (toolName === 'session_search') {
      FakeQuery.sessionSearch = () => Promise.reject(failure())
    } else {
      FakeQuery.eventSearch = () => Promise.reject(failure())
    }
    /** 中文说明：函数值 warn 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const warn = vi.spyOn(mounted.ctx.logger, 'warn').mockImplementation(() => undefined)

    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await mounted.call(toolName, args)

    expect(errorCode(result)).toBe('SESSION_QUERY_TOOL_FAILED')
    expect(text(result)).toBe('Error: session query operation failed')
    /** 中文说明：该循环依次处理输入数据；循环变量仅在当前循环中有效。 */
    for (const secret of secrets) {
      expect(JSON.stringify(result)).not.toContain(secret)
      expect(warn).toHaveBeenCalledWith(expect.stringContaining(secret))
    }
  })

  it.each([
    {
      name: 'a hostile prototype trap',
      secrets: ['proxy payload secret', 'getPrototypeOf secondary secret'],
      diagnostic: '[unprintable session query failure]',
      failure: (): unknown => new Proxy(
        { payload: 'proxy payload secret' },
        {
          getPrototypeOf() {
            throw new Error('getPrototypeOf secondary secret')
          },
        },
      ),
    },
    {
      name: 'a throwing stack getter',
      secrets: ['stack primary secret', 'stack getter secondary secret'],
      diagnostic: '[unprintable session query failure]',
      failure: (): unknown => {
        /** 中文说明：变量 error 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const error = new Error('stack primary secret')
        Object.defineProperty(error, 'stack', {
          get() {
            throw new Error('stack getter secondary secret')
          },
        })
        return error
      },
    },
    {
      name: 'a throwing cause getter',
      secrets: ['cause primary secret', 'cause getter secondary secret'],
      diagnostic: '[unprintable session query failure]',
      failure: (): unknown => {
        /** 中文说明：变量 error 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const error = new Error('cause primary secret')
        Object.defineProperty(error, 'cause', {
          get() {
            throw new Error('cause getter secondary secret')
          },
        })
        return error
      },
    },
    {
      name: 'throwing string coercion',
      secrets: ['string payload secret', 'string coercion secondary secret'],
      diagnostic: '[unprintable session query failure]',
      failure: (): unknown => ({
        payload: 'string payload secret',
        [Symbol.toPrimitive]() {
          throw new Error('string coercion secondary secret')
        },
      }),
    },
    {
      name: 'a throwing code getter',
      secrets: ['code primary secret', 'code getter secondary secret'],
      diagnostic: 'code primary secret',
      failure: (): unknown => {
        /** 中文说明：变量 error 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const error = new SessionQueryError(
          'code primary secret',
          'SESSION_QUERY_PERSISTENCE_FAILED',
        )
        Object.defineProperty(error, 'code', {
          get() {
            throw new Error('code getter secondary secret')
          },
        })
        return error
      },
    },
    {
      name: 'an unknown string code',
      secrets: ['unknown code primary secret', '__proto__'],
      diagnostic: 'unknown code primary secret',
      failure: (): unknown => {
        /** 中文说明：变量 error 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const error = new SessionQueryError(
          'unknown code primary secret',
          'SESSION_QUERY_PERSISTENCE_FAILED',
        )
        Object.defineProperty(error, 'code', { value: '__proto__' })
        return error
      },
    },
    {
      name: 'a non-string code',
      secrets: ['non-string code primary secret', 'non-string code secondary secret'],
      diagnostic: 'non-string code primary secret',
      failure: (): unknown => {
        /** 中文说明：变量 error 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const error = new SessionQueryError(
          'non-string code primary secret',
          'SESSION_QUERY_PERSISTENCE_FAILED',
        )
        Object.defineProperty(error, 'code', {
          value: {
            toString() {
              throw new Error('non-string code secondary secret')
            },
          },
        })
        return error
      },
    },
  ])('fails generic when inspecting $name is unsafe', async ({ secrets, diagnostic, failure }) => {
    /** 中文说明：变量 mounted 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const mounted = await mount()
    // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- hostile unknown rejection is the scenario
    FakeQuery.sessionSearch = () => Promise.reject(failure())
    /** 中文说明：函数值 warn 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const warn = vi.spyOn(mounted.ctx.logger, 'warn').mockImplementation(() => undefined)

    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await mounted.call('session_search', { query: 'needle' })

    expect(errorCode(result)).toBe('SESSION_QUERY_TOOL_FAILED')
    expect(text(result)).toBe('Error: session query operation failed')
    /** 中文说明：该循环依次处理输入数据；循环变量仅在当前循环中有效。 */
    for (const secret of secrets) expect(JSON.stringify(result)).not.toContain(secret)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(diagnostic))
  })

  it('retains a fixed safe typed failure when only its nested diagnostic is unprintable', async () => {
    /** 中文说明：变量 mounted 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const mounted = await mount()
    /** 中文说明：变量 primary 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const primary = 'typed outer diagnostic secret'
    /** 中文说明：变量 nested 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const nested = 'nested prototype secondary secret'
    /** 中文说明：变量 cause 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const cause = new Proxy(
      {},
      {
        getPrototypeOf() {
          throw new Error(nested)
        },
      },
    )
    FakeQuery.sessionSearch = () => Promise.reject(
      new SessionQueryError(
        primary,
        'SESSION_QUERY_PERSISTENCE_FAILED',
        { cause },
      ),
    )
    /** 中文说明：函数值 warn 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const warn = vi.spyOn(mounted.ctx.logger, 'warn').mockImplementation(() => undefined)

    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await mounted.call('session_search', { query: 'needle' })

    expect(errorCode(result)).toBe('SESSION_QUERY_PERSISTENCE_FAILED')
    expect(text(result)).toBe('Error: session history storage is unavailable')
    expect(JSON.stringify(result)).not.toContain(primary)
    expect(JSON.stringify(result)).not.toContain(nested)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('[unprintable session query failure]'))
  })

  it('logs an inspectable cyclic cause chain without exposing it', async () => {
    /** 中文说明：变量 mounted 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const mounted = await mount()
    /** 中文说明：变量 outer 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const outer = new Error('cyclic outer secret')
    /** 中文说明：变量 inner 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const inner = new Error('cyclic inner secret')
    Object.defineProperty(outer, 'cause', { value: inner })
    Object.defineProperty(inner, 'cause', { value: outer })
    FakeQuery.sessionSearch = () => Promise.reject(outer)
    /** 中文说明：函数值 warn 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const warn = vi.spyOn(mounted.ctx.logger, 'warn').mockImplementation(() => undefined)

    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await mounted.call('session_search', { query: 'needle' })

    expect(errorCode(result)).toBe('SESSION_QUERY_TOOL_FAILED')
    expect(text(result)).toBe('Error: session query operation failed')
    expect(JSON.stringify(result)).not.toContain('cyclic outer secret')
    expect(JSON.stringify(result)).not.toContain('cyclic inner secret')
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('cyclic outer secret'))
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('cyclic inner secret'))
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('[circular error cause]'))
  })

  it('fails generic when internal warning logging throws', async () => {
    /** 中文说明：变量 mounted 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const mounted = await mount()
    /** 中文说明：变量 primary 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const primary = 'typed persistence primary secret'
    /** 中文说明：变量 secondary 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const secondary = 'logger warning secondary secret'
    FakeQuery.sessionSearch = () => Promise.reject(
      new SessionQueryError(primary, 'SESSION_QUERY_PERSISTENCE_FAILED'),
    )
    /** 中文说明：变量 warn 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const warn = vi.spyOn(mounted.ctx.logger, 'warn')
      .mockImplementation(() => undefined)
      .mockImplementationOnce(() => {
        throw new Error(secondary)
      })

    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await mounted.call('session_search', { query: 'needle' })

    expect(errorCode(result)).toBe('SESSION_QUERY_TOOL_FAILED')
    expect(text(result)).toBe('Error: session query operation failed')
    expect(JSON.stringify(result)).not.toContain(primary)
    expect(JSON.stringify(result)).not.toContain(secondary)
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('preserves stale-cursor diagnostics without transparently restarting', async () => {
    /** 中文说明：变量 mounted 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const mounted = await mount({ maxSearchResults: 2 })
    /** 中文说明：变量 cursor 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const cursor = SessionSearchCursor('stale-next')
    FakeQuery.sessionSearch = request => request.cursor === undefined
      ? Promise.resolve({ items: [], nextCursor: cursor })
      : Promise.reject(new SessionQueryError('stale provider generation', 'SESSION_QUERY_STALE_CURSOR'))
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await mounted.call('session_search', { query: 'needle' })
    expect(errorCode(result)).toBe('SESSION_QUERY_STALE_CURSOR')
    expect(text(result)).toContain('retry the complete search call')
    expect(FakeQuery.sessionRequests).toHaveLength(2)
  })

  it('rejects a repeated internal cursor instead of looping', async () => {
    /** 中文说明：变量 mounted 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const mounted = await mount()
    /** 中文说明：变量 cursor 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const cursor = SessionSearchCursor('repeat')
    FakeQuery.sessionSearch = () => Promise.resolve({ items: [], nextCursor: cursor })
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await mounted.call('session_search', { query: 'needle' })
    expect(errorCode(result)).toBe('SESSION_QUERY_INVALID_CURSOR')
    expect(text(result)).toBe('Error: session-search provider repeated a continuation cursor')
    expect(FakeQuery.sessionRequests).toHaveLength(2)
  })

  it('renders authorized parent ids and all availability states', async () => {
    /** 中文说明：变量 mounted 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const mounted = await mount({ maxSearchResults: 3 })
    /** 中文说明：变量 parent 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const parent = createSession(mounted.ctx, 'parent', '/work')
    /** 中文说明：变量 child 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const child = createSession(mounted.ctx, 'child', '/work', 2, parent.id)
    /** 中文说明：变量 callerChild 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const callerChild = createSession(mounted.ctx, 'caller-child', '/work', 3, mounted.caller.id)
    FakeQuery.sessionSearch = () => Promise.resolve({
      items: [
        { ...sessionHit(child.id, '/work', 'both', parent.id), live: true, persisted: true },
        { ...sessionHit(callerChild.id, '/work', 'persisted', mounted.caller.id), live: false, persisted: true },
        { ...sessionHit('unavailable', '/work', 'neither'), live: false, persisted: false },
      ],
    })
    /** 中文说明：变量 output 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const output = text(await mounted.call('session_search', { query: 'needle' }))
    expect(output).toContain('Parent: parent')
    expect(output).toContain(`Parent: ${mounted.caller.id}`)
    expect(output).toContain('Availability: live, persisted')
    expect(output).toContain('Availability: persisted')
    expect(output).toContain('Availability: unavailable')
  })

  it('intersects current-session search with the event before the latest step and leaves other targets unchanged', async () => {
    /** 中文说明：变量 mounted 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const mounted = await mount()
    FakeQuery.eventSearch = request => Promise.resolve({
      session: header(request.sessionId, '/work'),
      items: [eventHit(request.sessionId, 1)],
    })
    await mounted.call('session_event_search', {
      query: 'prior',
      seq_from: 0,
      seq_to: 99,
    })
    expect(FakeQuery.eventRequests[0]?.filters).toContainEqual({ kind: 'seq', from: 0, to: 1 })

    /** 中文说明：变量 other 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const other = createSession(mounted.ctx, 'other', '/work')
    await mounted.call('session_event_search', {
      session_id: other.id,
      query: 'prior',
      seq_from: 0,
      seq_to: 99,
    })
    expect(FakeQuery.eventRequests[1]?.filters).toContainEqual({ kind: 'seq', from: 0, to: 99 })
  })

  it('returns no current-session hits without calling FTS when the user range starts in the active step', async () => {
    /** 中文说明：变量 mounted 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const mounted = await mount()
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await mounted.call('session_event_search', {
      query: 'prior',
      seq_from: 2,
    })
    expect(result.isError).toBe(false)
    expect(text(result)).toContain('No prior event matches found.')
    expect(FakeQuery.eventRequests).toEqual([])
  })

  it('requires a current step boundary and drains event pages to a capped result', async () => {
    /** 中文说明：变量 mounted 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const mounted = await mount({ maxSearchResults: 2 })
    /** 中文说明：变量 noStep 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const noStep = createSession(mounted.ctx, 'no-step', '/work')
    /** 中文说明：变量 missing 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const missing = await mounted.call(
      'session_event_search',
      { query: 'q' },
      { agent: fakeAgent(noStep) },
    )
    expect(errorCode(missing)).toBe('SESSION_QUERY_TOOL_NO_CURRENT_STEP')

    /** 中文说明：变量 other 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const other = createSession(mounted.ctx, 'paged-events', '/work')
    /** 中文说明：变量 cursor 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const cursor = SessionSearchCursor('events-next')
    FakeQuery.eventSearch = request => request.cursor === undefined
      ? Promise.resolve({
        session: header(other.id, '/work'),
        items: [eventHit(other.id, 1)],
        nextCursor: cursor,
      })
      : Promise.resolve({
        session: header(other.id, '/work'),
        items: [eventHit(other.id, 2), eventHit(other.id, 3)],
      })
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await mounted.call('session_event_search', {
      session_id: other.id,
      query: 'q',
    })
    expect(FakeQuery.eventRequests.map(request => request.cursor)).toEqual([undefined, cursor])
    expect(text(result)).toContain('Result cap reached')
  })

  it('preserves base results when a title read fails, annotates the code, and logs the full error', async () => {
    /** 中文说明：变量 mounted 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const mounted = await mount()
    /** 中文说明：变量 hit 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const hit = createSession(mounted.ctx, 'hit', '/work')
    /** 中文说明：变量 failure 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const failure = new HarnessError('title backend failed', 'TITLE_BACKEND')
    FakeQuery.titles.set(hit.id, failure)
    FakeQuery.sessionSearch = () => Promise.resolve({ items: [sessionHit(hit.id, '/work')] })
    /** 中文说明：函数值 warn 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const warn = vi.spyOn(mounted.ctx.logger, 'warn').mockImplementation(() => undefined)
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await mounted.call('session_search', { query: 'needle' })
    expect(result.isError).toBe(false)
    expect(text(result)).toContain('untitled (title unavailable: SESSION_QUERY_TOOL_FAILED)')
    expect(JSON.stringify(result)).not.toContain('title backend failed')
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('title backend failed'))
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('HarnessError'))
  })

  it('reports unknown title failures and preserves an Error without a stack', async () => {
    /** 中文说明：变量 mounted 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const mounted = await mount()
    /** 中文说明：变量 first 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const first = createSession(mounted.ctx, 'unknown-title', '/work')
    /** 中文说明：变量 second 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const second = createSession(mounted.ctx, 'second-title-failure', '/work')
    /** 中文说明：变量 stackless 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const stackless = new Error('stackless')
    Object.defineProperty(stackless, 'stack', { value: undefined })
    /** 中文说明：变量 readTitles 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const readTitles = vi.spyOn(mounted.ctx.sessionQuery, 'readTitleSnapshots')
      .mockResolvedValueOnce([
        { sessionId: first.id, status: 'rejected', reason: 'string failure' },
        { sessionId: second.id, status: 'rejected', reason: stackless },
      ])
    FakeQuery.sessionSearch = () => Promise.resolve({
      items: [
        sessionHit(first.id, '/work'),
        sessionHit(second.id, '/work'),
      ],
    })
    /** 中文说明：函数值 warn 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const warn = vi.spyOn(mounted.ctx.logger, 'warn').mockImplementation(() => undefined)
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await mounted.call('session_search', { query: 'needle' })
    expect(text(result)).toContain('title unavailable: SESSION_QUERY_TOOL_FAILED')
    expect(JSON.stringify(result)).not.toContain('string failure')
    expect(JSON.stringify(result)).not.toContain('stackless')
    expect(readTitles).toHaveBeenCalledTimes(1)
    expect(readTitles.mock.calls[0]?.[0]).toEqual([first.id, second.id])
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('string failure'))
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Error: stackless'))
  })

  it('isolates an unprintable per-title failure behind the generic unavailable marker', async () => {
    /** 中文说明：变量 mounted 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const mounted = await mount()
    /** 中文说明：变量 hit 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const hit = createSession(mounted.ctx, 'hostile-title-failure', '/work')
    /** 中文说明：变量 primary 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const primary = 'per-title proxy payload secret'
    /** 中文说明：变量 secondary 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const secondary = 'per-title prototype secondary secret'
    /** 中文说明：变量 reason 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const reason = new Proxy(
      { payload: primary },
      {
        getPrototypeOf() {
          throw new Error(secondary)
        },
      },
    )
    FakeQuery.sessionSearch = () => Promise.resolve({ items: [sessionHit(hit.id, '/work')] })
    vi.spyOn(mounted.ctx.sessionQuery, 'readTitleSnapshots').mockResolvedValueOnce([{
      sessionId: hit.id,
      status: 'rejected',
      reason,
    }])
    /** 中文说明：函数值 warn 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const warn = vi.spyOn(mounted.ctx.logger, 'warn').mockImplementation(() => undefined)

    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await mounted.call('session_search', { query: 'needle' })

    expect(result.isError).toBe(false)
    expect(text(result)).toContain('untitled (title unavailable: SESSION_QUERY_TOOL_FAILED)')
    expect(JSON.stringify(result)).not.toContain(primary)
    expect(JSON.stringify(result)).not.toContain(secondary)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('[unprintable session query failure]'))
  })

  it('sanitizes a thrown batch-title service failure instead of rendering its diagnostic', async () => {
    /** 中文说明：变量 mounted 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const mounted = await mount()
    /** 中文说明：变量 hit 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const hit = createSession(mounted.ctx, 'thrown-title-failure', '/work')
    /** 中文说明：变量 secret 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const secret = 'title batch failed beside hidden-title-session-secret'
    FakeQuery.sessionSearch = () => Promise.resolve({ items: [sessionHit(hit.id, '/work')] })
    vi.spyOn(mounted.ctx.sessionQuery, 'readTitleSnapshots')
      .mockRejectedValueOnce(new Error(secret))
    /** 中文说明：函数值 warn 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const warn = vi.spyOn(mounted.ctx.logger, 'warn').mockImplementation(() => undefined)

    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await mounted.call('session_search', { query: 'needle' })

    expect(errorCode(result)).toBe('SESSION_QUERY_TOOL_FAILED')
    expect(text(result)).toBe('Error: session query operation failed')
    expect(JSON.stringify(result)).not.toContain(secret)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(secret))
  })

  it('does not downgrade cancellation during title enrichment', async () => {
    /** 中文说明：变量 mounted 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const mounted = await mount()
    /** 中文说明：变量 hit 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const hit = createSession(mounted.ctx, 'abort-title', '/work')
    /** 中文说明：变量 controller 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const controller = new AbortController()
    /** 中文说明：变量 cancellation 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const cancellation = new Error('cancelled title batch')
    FakeQuery.sessionSearch = () => Promise.resolve({ items: [sessionHit(hit.id, '/work')] })
    /** 中文说明：函数值 started 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    let started!: () => void
    /** 中文说明：函数值 batchStarted 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const batchStarted = new Promise<void>((resolve) => { started = resolve })
    /** 中文说明：函数值 readTitles 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const readTitles = vi.spyOn(mounted.ctx.sessionQuery, 'readTitleSnapshots').mockImplementation((_ids, signal) => {
      started()
      return new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => { reject(cancellation) }, { once: true })
      })
    })
    /** 中文说明：变量 pending 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const pending = mounted.call('session_search', { query: 'needle' }, { signal: controller.signal })
    await batchStarted
    controller.abort(cancellation)
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await pending
    expect(result.isError).toBe(true)
    expect(text(result)).not.toContain('title unavailable')
    expect(readTitles.mock.calls[0]?.[1]).toBe(controller.signal)
  })

  it('does not downgrade an authorization failure returned by title observation', async () => {
    /** 中文说明：变量 mounted 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const mounted = await mount()
    /** 中文说明：变量 hit 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const hit = createSession(mounted.ctx, 'unauthorized-title-error', '/work')
    /** 中文说明：变量 failure 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const failure = new HarnessError(
      'title observation became unauthorized',
      'SESSION_QUERY_TOOL_UNAUTHORIZED',
    )
    FakeQuery.sessionSearch = () => Promise.resolve({ items: [sessionHit(hit.id, '/work')] })
    vi.spyOn(mounted.ctx.sessionQuery, 'readTitleSnapshots').mockResolvedValueOnce([{
      sessionId: hit.id,
      status: 'rejected',
      reason: failure,
    }])

    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await mounted.call('session_search', { query: 'needle' })

    expect(errorCode(result)).toBe('SESSION_QUERY_TOOL_UNAUTHORIZED')
    expect(text(result)).toBe('Error: session target is outside the caller workspace')
    expect(JSON.stringify(result)).not.toContain('title observation became unauthorized')
    expect(text(result)).not.toContain('title unavailable')
  })

  it('forwards caller cancellation into direct-target authorization and waits for cleanup', async () => {
    /** 中文说明：变量 mounted 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const mounted = await mount()
    /** 中文说明：变量 target 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const target = createSession(mounted.ctx, 'stalled-direct-authorization', '/work')
    /** 中文说明：变量 controller 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const controller = new AbortController()
    /** 中文说明：变量 cancellation 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const cancellation = new SessionQueryError(
      'direct-target authorization cancelled',
      'SESSION_QUERY_ABORTED',
    )
    /** 中文说明：变量 started 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const started = Promise.withResolvers<undefined>()
    /** 中文说明：变量 abortObserved 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const abortObserved = Promise.withResolvers<undefined>()
    /** 中文说明：变量 cleanup 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const cleanup = Promise.withResolvers<undefined>()
    /** 中文说明：变量 active 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let active = false
    /** 中文说明：变量 filterSessions 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const filterSessions = vi.spyOn(mounted.ctx.sessionQuery, 'filterSessions')
      .mockImplementation(async (_filters, signal) => {
        if (signal === undefined) throw new Error('expected authorization signal')
        active = true
        /** 中文说明：函数值 aborted 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
        const aborted = new Promise<void>((resolve) => {
          signal.addEventListener('abort', () => { resolve() }, { once: true })
        })
        started.resolve(undefined)
        await aborted
        abortObserved.resolve(undefined)
        await cleanup.promise
        active = false
        signal.throwIfAborted()
        return []
      })

    /** 中文说明：变量 pending 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const pending = mounted.call(
      'session_event_search',
      { session_id: target.id, query: 'needle' },
      { signal: controller.signal },
    )
    /** 中文说明：变量 settled 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let settled = false
    void pending.then(
      () => { settled = true },
      () => { settled = true },
    )
    await started.promise
    controller.abort(cancellation)
    await abortObserved.promise

    expect(settled).toBe(false)
    expect(active).toBe(true)
    expect(filterSessions.mock.calls[0]?.[1]).toBe(controller.signal)
    expect(controller.signal.reason).toBe(cancellation)
    expect(FakeQuery.eventRequests).toEqual([])

    cleanup.resolve(undefined)
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await pending
    expect(active).toBe(false)
    expect(errorCode(result)).toBe('SESSION_QUERY_ABORTED')
    expect(text(result)).toBe('Error: direct-target authorization cancelled')
    expect(FakeQuery.eventRequests).toEqual([])
  })

  it('forwards the search deadline into parent authorization and times out only after cleanup', async () => {
    vi.useFakeTimers()
    /** 中文说明：变量 timeoutMs 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const timeoutMs = 1_234
    /** 中文说明：变量 mounted 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const mounted = await mount({ searchTimeoutMs: timeoutMs }, '/work', true)
    /** 中文说明：变量 parent 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const parent = createSession(mounted.ctx, 'stalled-parent-authorization', '/work')
    FakeQuery.sessionSearch = () => Promise.resolve({
      items: [sessionHit('authorized-child', '/work', 'needle', parent.id)],
    })
    /** 中文说明：变量 upstream 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const upstream = new AbortController()
    /** 中文说明：变量 started 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const started = Promise.withResolvers<undefined>()
    /** 中文说明：变量 abortObserved 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const abortObserved = Promise.withResolvers<undefined>()
    /** 中文说明：变量 cleanup 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const cleanup = Promise.withResolvers<undefined>()
    /** 中文说明：变量 active 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let active = false
    /** 中文说明：变量 deadlineSignal 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let deadlineSignal: AbortSignal | undefined
    /** 中文说明：变量 filterSessions 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const filterSessions = vi.spyOn(mounted.ctx.sessionQuery, 'filterSessions')
      .mockImplementation(async (_filters, signal) => {
        if (signal === undefined) throw new Error('expected authorization signal')
        deadlineSignal = signal
        active = true
        /** 中文说明：函数值 aborted 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
        const aborted = new Promise<void>((resolve) => {
          signal.addEventListener('abort', () => { resolve() }, { once: true })
        })
        started.resolve(undefined)
        await aborted
        abortObserved.resolve(undefined)
        await cleanup.promise
        active = false
        signal.throwIfAborted()
        return []
      })

    /** 中文说明：变量 pending 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const pending = mounted.call(
      'session_search',
      { query: 'needle' },
      { signal: upstream.signal },
    )
    /** 中文说明：变量 settled 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let settled = false
    void pending.then(
      () => { settled = true },
      () => { settled = true },
    )
    await started.promise
    await vi.advanceTimersByTimeAsync(timeoutMs)
    await abortObserved.promise

    expect(settled).toBe(false)
    expect(active).toBe(true)
    expect(deadlineSignal).toBeDefined()
    expect(deadlineSignal).not.toBe(upstream.signal)
    expect(filterSessions.mock.calls[0]?.[1]).toBe(deadlineSignal)
    expect(FakeQuery.searchSignals).toEqual([deadlineSignal])
    expect(deadlineSignal?.reason).toBeInstanceOf(TimeoutReason)
    expect(deadlineSignal?.reason).toMatchObject({ code: 'TOOL_TIMEOUT', timeoutMs })

    cleanup.resolve(undefined)
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await pending
    expect(active).toBe(false)
    expect(errorCode(result)).toBe('TOOL_TIMEOUT')
    expect(text(result)).toBe(`Error: tool call timed out after ${timeoutMs}ms`)
  })

  it('passes the exact execution signal to every FTS page and stops on cancellation', async () => {
    /** 中文说明：变量 mounted 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const mounted = await mount()
    /** 中文说明：变量 controller 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const controller = new AbortController()
    /** 中文说明：函数值 warn 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const warn = vi.spyOn(mounted.ctx.logger, 'warn').mockImplementation(() => undefined)
    /** 中文说明：函数值 started 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    let started!: () => void
    /** 中文说明：函数值 bodyStarted 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const bodyStarted = new Promise<void>((resolve) => { started = resolve })
    FakeQuery.sessionSearch = (_request, exec) => new Promise((_resolve, reject) => {
      started()
      exec?.signal?.addEventListener('abort', () => {
        reject(new SessionQueryError('aborted', 'SESSION_QUERY_ABORTED'))
      }, { once: true })
    })
    /** 中文说明：变量 cancellation 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const cancellation = new SessionQueryError('aborted', 'SESSION_QUERY_ABORTED')
    /** 中文说明：变量 pending 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const pending = mounted.call('session_search', { query: 'needle' }, { signal: controller.signal })
    await bodyStarted
    controller.abort(cancellation)
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await pending
    expect(result.isError).toBe(true)
    expect(errorCode(result)).toBe('SESSION_QUERY_ABORTED')
    expect(FakeQuery.searchSignals).toEqual([controller.signal])
    expect(warn).not.toHaveBeenCalled()
  })
})

describe('trace and exact read rendering', () => {
  it('renders a deeply nested lineage without recursive consumer traversal', async () => {
    /** 中文说明：变量 mounted 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const mounted = await mount()
    /** 中文说明：变量 target 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const target = createSession(mounted.ctx, 'deep-target', '/work')
    const [targetRecord] = await mounted.ctx.sessionQuery.filterSessions([{
      kind: 'id',
      values: [target.id],
    }])
    if (targetRecord === undefined) throw new Error('expected target record')
    /** 中文说明：变量 depth 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const depth = 3_000
    /** 中文说明：变量 descendants 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let descendants: SessionLineageNode[] = []
    /** 中文说明：该循环依次处理输入数据；循环变量仅在当前循环中有效。 */
    for (let index = depth; index >= 1; index -= 1) {
      descendants = [{
        session: {
          ...targetRecord,
          header: header(`deep-${index}`, '/work', index),
        },
        descendants,
      }]
    }
    vi.spyOn(mounted.ctx.sessionQuery, 'traceSession').mockResolvedValue({
      target: targetRecord,
      ancestors: [],
      descendants,
      complete: true,
      root: targetRecord,
    })
    vi.spyOn(mounted.ctx.sessionQuery, 'readTitleSnapshots').mockImplementation(sessionIds => Promise.resolve(
      [...new Set(sessionIds)].map(sessionId => ({
        sessionId,
        status: 'fulfilled' as const,
        value: { session: header(sessionId, '/work') },
      })),
    ))

    /** 中文说明：变量 output 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const output = text(await mounted.call('session_trace', { session_id: target.id }))
    expect(output).toContain('Descendants:\n- deep-1 —')
    expect(output).toContain(`${'  '.repeat(depth - 1)}- deep-${depth} —`)
  })

  it('renders every event relationship sequence and a UTC target timestamp', async () => {
    /** 中文说明：变量 mounted 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const mounted = await mount()
    /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const session = createSession(mounted.ctx, 'relationships', '/work')
    session.append(
      'user/message',
      createUserMessage({
        content: [{ type: 'text', text: 'source' }], source: { kind: 'user' },
      }),
      { surfaceOp: 'append' },
    )
    session.append(
      'assistant/message',
      {
        turn: 1,
        step: 1,
        message: createMessage({
          role: 'assistant',
          content: [{ type: 'text', text: 'replacement' }],
          source: {
            kind: 'model',
            ...{ provider: 'test', model: 'test' },
          },
        }),
      },
      { surfaceOp: { op: 'replace', start: 0, end: 0 }, sourceEventSeqs: [0] },
    )
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await mounted.call('session_event_trace', { session_id: session.id, seq: 0 })
    expect(text(result)).toContain('Replacement chain: 1')
    expect(text(result)).toContain('Events cited directly as sources: none')
    expect(text(result)).toContain('Direct derived events: 1')
    expect(text(result)).toContain(new Date(session.events[0]?.time ?? 0).toISOString())
  })

  it('renders unabridged fenced target JSON and readable semantic or log-only neighbor summaries', async () => {
    /** 中文说明：变量 mounted 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const mounted = await mount()
    /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const session = createSession(mounted.ctx, 'read', '/work')
    session.append(
      'user/message',
      createUserMessage({
        content: [{ type: 'text', text: 'before semantic text' }], source: { kind: 'user' },
      }),
      { surfaceOp: 'append' },
    )
    session.append(
      'assistant/message',
      {
        turn: 1,
        step: 1,
        message: createMessage({
          role: 'assistant',
          content: [{ type: 'text', text: 'target full text' }],
          source: {
            kind: 'model',
            ...{ provider: 'test', model: 'test' },
          },
        }),
      },
      { surfaceOp: 'append' },
    )
    /** 中文说明：变量 appendLegacy 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const appendLegacy = session.append.bind(session) as unknown as (
      type: string,
      data: unknown,
    ) => Session['events'][number]
    appendLegacy(
      'context/message',
      { content: [{ type: 'text', text: 'after semantic text' }], source: { kind: 'plugin', plugin: 'test' } },
    )
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await mounted.call('session_event_read', {
      session_id: session.id,
      seq: 1,
      before: 1,
      after: 1,
    })
    /** 中文说明：变量 output 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const output = text(result)
    expect(output).toContain('```json')
    expect(output).toContain('"text": "target full text"')
    expect(output).toContain('before semantic text')
    expect(output).toContain('seq 2 | context/message')
    expect(output).toContain('(no semantic text)')
    expect(output).not.toContain('after semantic text')
    expect(output).not.toContain('truncated')
  })

  it('renders empty event relationships and neighbors without semantic text', async () => {
    const mounted = await mount()
    const session = createSession(mounted.ctx, 'empty-relations', '/work')
    session.append('step/start', { turn: 1, step: 1 })
    session.append('step/end', { turn: 1, step: 1 })

    const trace = text(await mounted.call('session_event_trace', {
      session_id: session.id,
      seq: 0,
    }))
    expect(trace).toContain('Replaced by: none')
    expect(trace).toContain('Replacement chain: none')

    const onlyAfter = text(await mounted.call('session_event_read', {
      session_id: session.id,
      seq: 0,
      after: 1,
    }))
    expect(onlyAfter).not.toContain('Before:')
    expect(onlyAfter).toContain('(no semantic text)')

    const onlyBefore = text(await mounted.call('session_event_read', {
      session_id: session.id,
      seq: 1,
      before: 1,
    }))
    expect(onlyBefore).toContain('Before:')
    expect(onlyBefore).not.toContain('After:')
  })

  it.each([
    ['session_event_trace', { seq: -1 }],
    ['session_event_read', { seq: Number.MAX_SAFE_INTEGER + 1 }],
    ['session_event_read', { seq: 0, before: -1 }],
    ['session_event_read', { seq: 0, after: 1.5 }, 'INVALID_ARGS'],
  ])('rejects invalid exact-read integers for %s', async (name, args, expected = 'SESSION_QUERY_INVALID_FILTER') => {
    const mounted = await mount()
    expect(errorCode(await mounted.call(name, args))).toBe(expected)
  })
})
