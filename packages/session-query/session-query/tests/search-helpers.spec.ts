/**
 * 文件职责：验证 search-helpers.spec.ts 覆盖的会话查询行为、持久化与异常场景。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、SQLite 或会话事件日志。
 * 产品维度：保障 Agent 的会话查询结果稳定、可追踪且可恢复。
 * 逻辑维度：准备会话和存储数据，执行查询或恢复流程，再核对结果、错误与清理。
 * 关键边界：持久化数据属于不可信输入；事件必须可重放；临时数据库与异步资源必须释放。
 * 新手阅读建议：先看测试夹具和查询条件，再读正常场景，最后关注重启、损坏与失败路径。
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage, ToolCallId , createMessage, createToolResultMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, {
  SESSION_FORMAT_VERSION,
  SessionId,
} from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
import {
  buildSessionEventRecords,
  buildSessionEventSearchDocuments,
  compileSessionTextFilter,
  extractSessionEventText,
  filterSessionEventDocuments,
  filterSessionResults,
  materializeSessionEventResultFilters,
  materializeSessionResultFilters,
  /** 中文说明：type SessionQueryErrorCode 定义本测试所需的数据或行为，用于表达会话查询场景。 */
  type SessionQueryErrorCode,
} from '@deepseek-ai/dsh-session-query'
import { TestSessionQueryEngine } from './test-service.ts'

/** 中文说明：变量 id 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const id = SessionId('session')

/** 中文说明：函数 header 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function header(value: string, extra: Partial<SessionHeader> = {}): SessionHeader {
  return { version: SESSION_FORMAT_VERSION, id: SessionId(value), createdAt: 10, ...extra }
}

/** 中文说明：函数 expectCode 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function expectCode(code: SessionQueryErrorCode): Error {
  return expect.objectContaining({ code }) as Error
}

describe('session-query semantic extraction', () => {
  it('extracts first-party message, tool, todo, and failure detail', () => {
    const callId = ToolCallId('call')
    const messageContent: SessionEvent<'user/message'>['data']['content'] = [
      { type: 'text', text: ' visible ' },
      { type: 'reasoning', text: 'thought' },
      { type: 'tool-call', id: callId, name: 'read', arguments: '{"path":"a"}' },
      {
        type: 'tool-result',
        toolCallId: callId,
        content: [{ type: 'text', text: 'nested' }],
        isError: false,
      },
      { type: 'future-content', payload: 'hidden' } as never,
    ]
    /** 中文说明：变量 events 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const events: SessionEvent[] = [
      { type: 'user/message', seq: 0, time: 1, data: createUserMessage({
        content: messageContent, source: { kind: 'user' },
      }), surfaceOp: 'append' },
      { type: 'assistant/message', seq: 1, time: 2, data: {
        turn: 1, step: 1,
        message: createMessage({
          role: 'assistant',
          content: messageContent,
          source: {
            kind: 'model',
            ...{ provider: 'mock', model: 'mock' },
          },
        }),
      }, surfaceOp: 'append' },
      { type: 'user/message', seq: 2, time: 3, data: createUserMessage({
        content: messageContent, source: { kind: 'plugin', plugin: 'test' },
      }), surfaceOp: 'append' },
      { type: 'tool/call', seq: 3, time: 5, data: { turn: 1, step: 1, callId, name: 'bash', arguments: '{"cmd":"pwd"}' } },
      {
        type: 'tool/result',
        seq: 4,
        time: 6,
        data: {
          turn: 1,
          step: 1,
          message: createToolResultMessage({
            callId,
            content: [{ type: 'text', text: 'failed' }],
            isError: true,
          }),
          error: { name: 'Oops', code: 'E_OOPS' },
        },
        surfaceOp: 'append',
      },
      {
        type: 'tool/result',
        seq: 5,
        time: 7,
        data: {
          turn: 1,
          step: 1,
          message: createToolResultMessage({ callId, content: [], isError: false }),
        },
        surfaceOp: 'append',
      },
      { type: 'todo/write', seq: 6, time: 8, data: { todos: [{ status: 'in_progress', content: 'ship search' }] } },
    ]

    /** 中文说明：该循环依次处理输入数据；循环变量仅在当前循环中有效。 */
    for (const event of events.slice(0, 3)) {
      expect(extractSessionEventText(event)).toBe('visible\nread\n{"path":"a"}\nnested')
    }
    expect(extractSessionEventText({
      type: 'assistant/message',
      seq: 9,
      time: 10,
      data: {
        turn: 1,
        step: 1,
        message: createMessage({
          role: 'assistant',
          content: [{ type: 'reasoning', text: 'private thought' }],
          source: { kind: 'model', provider: 'mock', model: 'mock' },
        }),
      },
      surfaceOp: 'append',
    })).toBe('')
    expect(extractSessionEventText(events[3]!)).toBe('bash\n{"cmd":"pwd"}')
    expect(extractSessionEventText(events[4]!)).toBe('failed\nOops\nE_OOPS')
    expect(extractSessionEventText(events[5]!)).toBe('')
    expect(extractSessionEventText(events[6]!)).toBe('in_progress\nship search')
  })

  it('extracts meaningful turn outcomes and skips structural or unknown events', () => {
    /** 中文说明：变量 reasons 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const reasons: Array<[SessionEvent<'turn/end'>['data']['reason'], string]> = [
      [{ kind: 'error', error: { message: 'boom', code: 'UNKNOWN' } }, 'error\nboom'],
      [{ kind: 'error', error: { message: 'provider boom', code: 'UNKNOWN' } }, 'error\nprovider boom'],
      [{ kind: 'aborted', reason: { kind: 'user' } }, 'aborted'],
      [{ kind: 'aborted', reason: { kind: 'disposed' } }, 'aborted'],
      [{ kind: 'max-tokens' }, 'max-tokens'],
      [{ kind: 'interrupted' }, 'interrupted'],
      [{ kind: 'completed' }, ''],
      [{ kind: 'future-status' } as never, ''],
    ]
    /** 中文说明：该循环依次处理输入数据；循环变量仅在当前循环中有效。 */
    for (const [reason, text] of reasons) {
      expect(extractSessionEventText({ type: 'turn/end', seq: 0, time: 1, data: { turn: 1, reason } })).toBe(text)
    }
    /** 中文说明：变量 structural 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const structural: SessionEvent[] = [
      { type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } },
      { type: 'step/start', seq: 1, time: 1, data: { turn: 1, step: 1 } },
      { type: 'step/end', seq: 2, time: 1, data: { turn: 1, step: 1 } },
      { type: 'assistant/chunk', seq: 3, time: 1, data: { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: 'raw' } } },
      { type: 'request/header', seq: 4, time: 1, data: { header: { config: { provider: 'test', model: 'test' } }, reason: 'initial' } },
      { type: 'future/event', seq: 5, time: 1, data: { text: 'hidden' } } as never,
    ]
    expect(structural.map(extractSessionEventText)).toEqual(['', '', '', '', '', ''])
  })
})

describe('session-query document and filter helpers', () => {
  /** 中文说明：变量 events 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const events: SessionEvent[] = [
    { type: 'user/message', seq: 0, time: 10, data: createUserMessage({
      content: [{ type: 'text', text: 'Hello\n(AI)+' }], source: { kind: 'user' },
    }), surfaceOp: 'append' },
    { type: 'assistant/chunk', seq: 1, time: 11, data: { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: 'raw' } } },
    { type: 'assistant/message', seq: 2, time: 12, data: {
      turn: 1, step: 1,
      message: createMessage({
        role: 'assistant',
        content: [{ type: 'text', text: 'replacement' }],
        source: {
          kind: 'model',
          ...{ provider: 'mock', model: 'mock' },
        },
      }),
    }, surfaceOp: { op: 'replace', start: 0, end: 0 }, sourceEventSeqs: [0] },
    { type: 'turn/end', seq: 3, time: 13, data: { turn: 1, reason: { kind: 'interrupted' } } },
  ]

  it('classifies every event and omits non-semantic documents', () => {
    expect(buildSessionEventRecords(id, events).map(record => record.surface))
      .toEqual(['shadowed', 'log-only', 'current', 'log-only'])
    /** 中文说明：变量 documents 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const documents = buildSessionEventSearchDocuments(id, events)
    expect(documents.map(document => [document.seq, document.text, document.surface])).toEqual([
      [0, 'Hello\n(AI)+', 'shadowed'],
      [2, 'replacement', 'current'],
      [3, 'interrupted', 'log-only'],
    ])
  })

  it('applies every session clause with OR values and validates closed values', () => {
    /** 中文说明：变量 parent 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const parent = SessionId('parent')
    /** 中文说明：变量 records 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const records = [
      { header: header('a', { cwd: '/a', parentSession: parent }), live: true, persisted: false, marker: 1 },
      { header: header('b', { createdAt: 20 }), live: false, persisted: true, marker: 2 },
    ]
    expect(filterSessionResults(records, [
      { kind: 'id', values: [SessionId('a'), SessionId('x')] },
      { kind: 'cwd', values: ['/a', null] },
      { kind: 'created-at', from: 5, to: 15 },
      { kind: 'parent', values: [parent, null] },
      { kind: 'availability', values: ['live'] },
    ])).toEqual([records[0]])
    expect(filterSessionResults(records, [{ kind: 'cwd', values: [null] }])).toEqual([records[1]])
    expect(filterSessionResults(records, [{ kind: 'parent', values: [null] }])).toEqual([records[1]])
    expect(filterSessionResults(records, [{ kind: 'availability', values: ['persisted'] }])).toEqual([records[1]])
    expect(() => filterSessionResults(records, [{ kind: 'availability', values: ['remote' as never] }]))
      .toThrow(expectCode('SESSION_QUERY_INVALID_FILTER'))
  })

  it('applies event metadata and safe literal text clauses', () => {
    /** 中文说明：函数值 documents 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const documents = buildSessionEventSearchDocuments(id, events).map((document, marker) => ({ ...document, marker }))
    expect(filterSessionEventDocuments(documents, [
      { kind: 'seq', from: 0, to: 1 },
      { kind: 'time', from: 9, to: 11 },
      { kind: 'type', values: ['user/message', 'tool/result'] },
      { kind: 'surface', values: ['shadowed'] },
      { kind: 'text', text: 'hello   (ai)+' },
    ])).toEqual([documents[0]])
    expect(compileSessionTextFilter('CAFÉ').test('café')).toBe(true)
    expect(filterSessionEventDocuments(documents)).toEqual(documents)
    expect(filterSessionEventDocuments(documents, [{ kind: 'surface', values: [] }])).toEqual([])
    expect(() => filterSessionEventDocuments(documents, [{ kind: 'surface', values: ['future' as never] }]))
      .toThrow(expectCode('SESSION_QUERY_INVALID_FILTER'))
    expect(() => compileSessionTextFilter(' \n ')).toThrow(expectCode('SESSION_QUERY_INVALID_FILTER'))
  })

  it('rejects malformed range filters and malformed surfaces', () => {
    /** 中文说明：变量 documents 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const documents = buildSessionEventSearchDocuments(id, events)
    /** 中文说明：该循环依次处理输入数据；循环变量仅在当前循环中有效。 */
    for (const filter of [
      { kind: 'seq', from: Number.NaN },
      { kind: 'seq', to: Number.POSITIVE_INFINITY },
      { kind: 'time', from: 2, to: 1 },
    ] as const) {
      expect(() => filterSessionEventDocuments(documents, [filter]))
        .toThrow(expectCode('SESSION_QUERY_INVALID_FILTER'))
    }
    expect(() => filterSessionResults([], [{ kind: 'created-at', from: Number.NaN }]))
      .toThrow(expectCode('SESSION_QUERY_INVALID_FILTER'))
    expect(() => filterSessionResults([{ header: header('x'), live: true, persisted: false }], [
      { kind: 'created-at', from: Number.NaN },
    ])).toThrow(expectCode('SESSION_QUERY_INVALID_FILTER'))
    /** 中文说明：变量 malformed 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const malformed: SessionEvent[] = [{
      type: 'assistant/message',
      seq: 0,
      time: 1,
      data: {
        turn: 1, step: 1,
        message: createMessage({
          role: 'assistant',
          content: [{ type: 'text', text: 'bad' }],
          source: {
            kind: 'model',
            ...{ provider: 'mock', model: 'mock' },
          },
        }),
      },
      surfaceOp: { op: 'replace', start: 9, end: 9 },
    }]
    expect(() => buildSessionEventRecords(id, malformed)).toThrow(expectCode('SESSION_QUERY_INVALID_SURFACE'))
  })

  it('owns filters and rejects malformed runtime filter shapes deterministically', () => {
    expect(materializeSessionResultFilters([{ kind: 'created-at', to: 2 }]))
      .toEqual([{ kind: 'created-at', to: 2 }])
    expect(() => materializeSessionResultFilters('not-an-array' as never))
      .toThrow(expectCode('SESSION_QUERY_INVALID_FILTER'))
    expect(() => materializeSessionResultFilters([{ kind: 'id', values: 'bad' } as never]))
      .toThrow(expectCode('SESSION_QUERY_INVALID_FILTER'))
    expect(() => materializeSessionResultFilters([{ kind: 'id', values: [1] } as never]))
      .toThrow(expectCode('SESSION_QUERY_INVALID_FILTER'))
    expect(() => materializeSessionResultFilters([{ kind: 'cwd', values: 'bad' } as never]))
      .toThrow(expectCode('SESSION_QUERY_INVALID_FILTER'))
    expect(() => materializeSessionResultFilters([{ kind: 'parent', values: [1] } as never]))
      .toThrow(expectCode('SESSION_QUERY_INVALID_FILTER'))
    expect(() => materializeSessionResultFilters([{} as never]))
      .toThrow(expectCode('SESSION_QUERY_INVALID_FILTER'))
    expect(() => materializeSessionEventResultFilters([{ kind: 'text', text: 1 } as never]))
      .toThrow(expectCode('SESSION_QUERY_INVALID_FILTER'))
    expect(() => materializeSessionEventResultFilters([{ kind: 'future' } as never]))
      .toThrow(expectCode('SESSION_QUERY_INVALID_FILTER'))
    expect(() => filterSessionResults([], [{ kind: 'future' } as never]))
      .toThrow(expectCode('SESSION_QUERY_INVALID_FILTER'))
    expect(() => filterSessionEventDocuments([], [{ kind: 'future' } as never]))
      .toThrow(expectCode('SESSION_QUERY_INVALID_FILTER'))
  })

  it('exposes the scan path on the combined query service', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(TestSessionQueryEngine)
    /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const session = ctx.sessions.create(id)
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'Alpha\n beta' }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'other' }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    await expect(ctx.sessionQuery.filterEvents(id, [{ kind: 'text', text: 'alpha beta' }]))
      .resolves.toMatchObject([{ seq: 0, text: 'Alpha\n beta' }])
  })
})

it('registers exact and abstract search behavior under one ctx key', async () => {
  /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  /** 中文说明：变量 fiber 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const fiber = await ctx.plugin(TestSessionQueryEngine)
  /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const session = ctx.sessions.create(id)
  await expect(ctx.sessionQuery.searchSessions({ query: 'AI' })).resolves.toEqual({ items: [] })
  await expect(ctx.sessionQuery.searchEvents({ sessionId: id, query: 'AI' }))
    .resolves.toEqual({ session: session.header, items: [] })
  await fiber.dispose()
  expect(ctx.sessionQuery).toBeUndefined()
})
