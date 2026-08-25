/**
 * 文件职责：验证 sqlite-integration.spec.ts 覆盖的会话查询行为、持久化与异常场景。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、SQLite 或会话事件日志。
 * 产品维度：保障 Agent 的会话查询结果稳定、可追踪且可恢复。
 * 逻辑维度：准备会话和存储数据，执行查询或恢复流程，再核对结果、错误与清理。
 * 关键边界：持久化数据属于不可信输入；事件必须可重放；临时数据库与异步资源必须释放。
 * 新手阅读建议：先看测试夹具和查询条件，再读正常场景，最后关注重启、损坏与失败路径。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage, CallId  } from '@deepseek-ai/dsh-llm'
import SessionStore, {
  SESSION_FORMAT_VERSION,
  SessionId,
  /** 中文说明：type Session 定义本测试所需的数据或行为，用于表达会话查询场景。 */
  type Session,
} from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SqliteSessionQueryEngine from '@deepseek-ai/dsh-session-query-sqlite'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as ToolSessionQuery from '@deepseek-ai/dsh-tool-session-query'

/** 中文说明：变量 temporaryDirectories 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const temporaryDirectories: string[] = []
/** 中文说明：变量 contexts 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const contexts: Context[] = []

afterEach(async () => {
  /** 中文说明：该循环依次处理输入数据；循环变量仅在当前循环中有效。 */
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  /** 中文说明：该循环依次处理输入数据；循环变量仅在当前循环中有效。 */
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true })
  }
})

/** 中文说明：函数 fakeAgent 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function fakeAgent(session: Session): Agent {
  return { id: session.id, session } as unknown as Agent
}

describe('tool-session-query with the real SQLite provider', () => {
  it('searches live prior-step history and a persisted same-workspace log', { timeout: 20_000 }, async () => {
    /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const root = await mkdtemp(join(tmpdir(), 'dsh-tool-session-query-'))
    temporaryDirectories.push(root)
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(SessionStore)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(JsonlSessionPersistence, { root, compression: 'none' })
    await ctx.plugin(SqliteSessionQueryEngine, { path: join(root, 'session-query.db') })
    await ctx.plugin(ToolSessionQuery)

    /** 中文说明：变量 persisted 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const persisted = SessionId('persisted')
    await ctx.sessionPersistence.create({
      version: SESSION_FORMAT_VERSION,
      id: persisted,
      createdAt: 1,
      cwd: '/work',
    })
    await ctx.sessionPersistence.append(persisted, [{
      type: 'user/message',
      seq: 0,
      time: 2,
      data: createUserMessage({
        content: [{ type: 'text', text: 'persisted integration needle' }],
        source: { kind: 'user' },
      }),
      surfaceOp: 'append',
    }])

    /** 中文说明：变量 caller 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const caller = ctx.sessions.create(SessionId('caller'), {
      meta: { createdAt: 10, cwd: '/work' },
    })
    caller.append('turn/start', { turn: 1 })
    caller.append(
      'user/message',
      createUserMessage({
        content: [{ type: 'text', text: 'live integration needle' }], source: { kind: 'user' },
      }),
      { surfaceOp: 'append' },
    )
    caller.append('step/start', { turn: 1, step: 1 })

    /** 中文说明：变量 call 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let call = 0
    /** 中文说明：函数值 execute 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const execute = (name: string, args: unknown) => ctx.tools.execute({
      name,
      arguments: args,
      callId: CallId(`integration-${++call}`),
      signal: new AbortController().signal,
      agent: fakeAgent(caller),
    })

    /** 中文说明：变量 sessions 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const sessions = await execute('session_search', { query: 'persisted integration needle' })
    expect(sessions.isError).toBe(false)
    expect(sessions.content.map(block => block.type === 'text' ? block.text : '').join('\n'))
      .toContain('Session persisted')
    /** 中文说明：变量 persistedEvents 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const persistedEvents = await execute('session_event_search', {
      session_id: persisted,
      query: 'persisted integration needle',
    })
    expect(persistedEvents.isError).toBe(false)
    expect(persistedEvents.content.map(block => block.type === 'text' ? block.text : '').join('\n'))
      .toContain('seq 0')
    /** 中文说明：变量 liveEvents 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const liveEvents = await execute('session_event_search', { query: 'live integration needle' })
    expect(liveEvents.isError).toBe(false)
    expect(liveEvents.content.map(block => block.type === 'text' ? block.text : '').join('\n'))
      .toContain('seq 1')
  })

  it('passes finite fractional epoch-millisecond bounds through SQLite comparisons', async () => {
    /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const root = await mkdtemp(join(tmpdir(), 'dsh-tool-session-query-fractional-'))
    temporaryDirectories.push(root)
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(SessionStore)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(JsonlSessionPersistence, { root, compression: 'none' })
    await ctx.plugin(SqliteSessionQueryEngine, { path: join(root, 'session-query.db') })
    await ctx.plugin(ToolSessionQuery)

    /** 中文说明：变量 base 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const base = Date.parse('2026-07-24T00:00:00.000Z')
    /** 中文说明：变量 persisted 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const persisted = SessionId('fractional-persisted')
    await ctx.sessionPersistence.create({
      version: SESSION_FORMAT_VERSION,
      id: persisted,
      createdAt: base,
      cwd: '/work',
    })
    await ctx.sessionPersistence.append(persisted, [
      {
        type: 'user/message',
        seq: 0,
        time: base + 123,
        data: createUserMessage({
          content: [{ type: 'text', text: 'fractional integration needle' }],
          source: { kind: 'user' },
        }),
        surfaceOp: 'append',
      },
      {
        type: 'user/message',
        seq: 1,
        time: base + 124,
        data: createUserMessage({
          content: [{ type: 'text', text: 'fractional integration needle' }],
          source: { kind: 'user' },
        }),
        surfaceOp: 'append',
      },
      {
        type: 'user/message',
        seq: 2,
        time: -124,
        data: createUserMessage({
          content: [{ type: 'text', text: 'pre-epoch fractional needle' }],
          source: { kind: 'user' },
        }),
        surfaceOp: 'append',
      },
      {
        type: 'user/message',
        seq: 3,
        time: -123,
        data: createUserMessage({
          content: [{ type: 'text', text: 'pre-epoch fractional needle' }],
          source: { kind: 'user' },
        }),
        surfaceOp: 'append',
      },
    ])

    /** 中文说明：变量 caller 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const caller = ctx.sessions.create(SessionId('fractional-caller'), {
      meta: { createdAt: base + 1_000, cwd: '/work' },
    })
    /** 中文说明：变量 call 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let call = 0
    /** 中文说明：函数值 execute 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const execute = (args: unknown) => ctx.tools.execute({
      name: 'session_event_search',
      arguments: args,
      callId: CallId(`fractional-integration-${++call}`),
      signal: new AbortController().signal,
      agent: fakeAgent(caller),
    })

    /** 中文说明：变量 lowerBound 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const lowerBound = await execute({
      session_id: persisted,
      query: 'fractional integration needle',
      time_from: '2026-07-24T00:00:00.12300001Z',
    })
    expect(lowerBound.isError).toBe(false)
    /** 中文说明：函数值 lowerText 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const lowerText = lowerBound.content.map(block => block.type === 'text' ? block.text : '').join('\n')
    expect(lowerText).toContain('seq 1')
    expect(lowerText).not.toContain('seq 0')

    /** 中文说明：变量 upperBound 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const upperBound = await execute({
      session_id: persisted,
      query: 'fractional integration needle',
      time_to: '2026-07-24T08:00:00.1239999+08:00',
    })
    expect(upperBound.isError).toBe(false)
    /** 中文说明：函数值 upperText 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const upperText = upperBound.content.map(block => block.type === 'text' ? block.text : '').join('\n')
    expect(upperText).toContain('seq 0')
    expect(upperText).not.toContain('seq 1')

    /** 中文说明：变量 emptySameMillisecond 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const emptySameMillisecond = await execute({
      session_id: persisted,
      query: 'fractional integration needle',
      time_from: '2026-07-24T00:00:00.12300001Z',
      time_to: '2026-07-24T08:00:00.1239999+08:00',
    })
    expect(emptySameMillisecond.isError).toBe(false)
    expect(emptySameMillisecond.content.map(block => block.type === 'text' ? block.text : '').join('\n'))
      .toContain('No prior event matches found.')

    /** 中文说明：变量 preEpochLower 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const preEpochLower = await execute({
      session_id: persisted,
      query: 'pre-epoch fractional needle',
      time_from: '1969-12-31T23:59:59.87600001Z',
    })
    expect(preEpochLower.isError).toBe(false)
    /** 中文说明：变量 preEpochLowerText 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const preEpochLowerText = preEpochLower.content
      .map(block => block.type === 'text' ? block.text : '').join('\n')
    expect(preEpochLowerText).toContain('seq 3')
    expect(preEpochLowerText).not.toContain('seq 2')

    /** 中文说明：变量 preEpochUpper 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const preEpochUpper = await execute({
      session_id: persisted,
      query: 'pre-epoch fractional needle',
      time_to: '1969-12-31T19:59:59.8769999-04:00',
    })
    expect(preEpochUpper.isError).toBe(false)
    /** 中文说明：变量 preEpochUpperText 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const preEpochUpperText = preEpochUpper.content
      .map(block => block.type === 'text' ? block.text : '').join('\n')
    expect(preEpochUpperText).toContain('seq 2')
    expect(preEpochUpperText).not.toContain('seq 3')
  })
})
