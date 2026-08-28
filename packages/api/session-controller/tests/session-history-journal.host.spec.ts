/** Raw Session journal transport and message-aligned pagination coverage.
 * @remarks 文件说明：文件职责：验证 api/session-controller 中 session history journal
 * host spec 相关行为与失败场景。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与
 * Cordis 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。；
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。；
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。 */

import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import SessionStore from '@deepseek-ai/dsh-session'
import { decodeStorageRecord, type ChunkRow } from '@deepseek-ai/dsh-session/chunk-rows'
import { ToolCallId, createMessage, createToolResultMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Session, SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import { SessionHistoryController } from '@deepseek-ai/dsh-api-session-controller/src/history.ts'
import type {
  ChunkRowEvent,
  SessionFollowFrame,
  SessionPage,
  SessionWireEvent,
} from '@deepseek-ai/dsh-api-session-controller/types'
import { createSessionTestRemote, installSessionReadTestServices } from './test-remote.ts'

/** Append a production-shaped human prompt to the session surface.
 * @remarks 中文说明：功能说明：处理 appendUserText 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：session（Session）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：text（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：SessionEvent；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 appendUserText(session,
 * text)，并按返回类型处理结果。 */
function appendUserText(session: Session, text: string): SessionEvent {
  return session.append('user/message', createUserMessage({
    content: [{ type: 'text', text }], source: { kind: 'user' },
  }), { surfaceOp: 'append' })
}

/** Append a production-shaped assistant message to the session surface.
 * @remarks 中文说明：功能说明：处理 appendAssistantText 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：session（Session）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：text（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：step（number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：SessionEvent；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * appendAssistantText(session, text, step)，并按返回类型处理结果。 */
function appendAssistantText(session: Session, text: string, step: number): SessionEvent {
  return session.append('assistant/message', {
    turn: 1,
    step,
    message: createMessage({
      role: 'assistant',
      content: [{ type: 'text', text }],
      source: { kind: 'model', provider: 'p', model: 'm' },
    }),
  }, { surfaceOp: 'append' })
}

/**
 * Append a plugin-owned log-only event. The host proxy is projection-only, so it
 * declares no compaction vocabulary; the cast writes the real event shape without
 * depending on the owning package.
 * @remarks 中文说明：功能说明：处理 appendExtension 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：session（Session）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：type（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：data（unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：SessionEvent；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 appendExtension(session,
 * type, data)，并按返回类型处理结果。
 */
function appendExtension(session: Session, type: string, data: unknown): SessionEvent {
  return (session.append as unknown as (type: string, data: unknown) => SessionEvent)(type, data)
}

/**
 * 功能说明：处理 harness 相关流程；使用场景由所在模块及调用位置决定。
 * @returns Promise<{ ctx: Context }>；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 harness()，并按返回类型处理结果。
 */
async function harness(): Promise<{ ctx: Context }> {
  /**
   * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  installSessionReadTestServices(ctx)
  return { ctx }
}

/** Drain one Session follow until `count` event frames arrive.
 * @remarks 中文说明：功能说明：收集 collect 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：iterable（AsyncIterable<SessionFollowFrame>）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。；参数说明：count（number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：abort（AbortController）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：Promise<SessionFollowFrame[]>；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 collect(iterable, count, abort)，并按返回类型处理结果。 */
async function collect(
  iterable: AsyncIterable<SessionFollowFrame>,
  count: number,
  abort: AbortController,
): Promise<SessionFollowFrame[]> {
  /**
   * 常量说明：frames 用于处理 frames 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const frames: SessionFollowFrame[] = []
  for await (const /*
   * 变量说明：frame 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */ frame of iterable) {
    frames.push(frame)
    if (frames.filter(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：candidate（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(candidate)，并按返回类型处理结果。
 */ candidate => candidate.type === 'event').length >= count) abort.abort()
  }
  return frames
}

/** Open follow and wait until its cursor is fixed before appending fixtures.
 * @remarks 中文说明：功能说明：打开 Follow 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：history（SessionHistoryController）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：sessionId（SessionId）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：signal（AbortSignal）：传递取消或终止信号；必须满足声明的类型及调用时序要求。；
 * 返回值：Promise<AsyncIterable<SessionFollowFrame>>；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 openFollow(history, sessionId, signal)，并按返回类型处理结果。 */
async function openFollow(
  history: SessionHistoryController,
  sessionId: SessionId,
  signal: AbortSignal,
): Promise<AsyncIterable<SessionFollowFrame>> {
  /**
   * 常量说明：iterator 用于处理 iterator 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const iterator = history.follow({
    address: { kind: 'session', sessionId },
  }, signal)[Symbol.asyncIterator]()
  await expect(iterator.next()).resolves.toMatchObject({
    done: false,
    value: { type: 'snapshot' },
  })
  return { [Symbol.asyncIterator]: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => iterator }
}

/** Expand packed page records for assertions over the logical journal.
 * @remarks 中文说明：功能说明：处理 pageEvents 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：page（SessionPage）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：SessionWireEvent[]；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * pageEvents(page)，并按返回类型处理结果。 */
function pageEvents(page: SessionPage): SessionWireEvent[] {
  return page.records.flatMap(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：record（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(record)，并按返回类型处理结果。
 */ record => record.type === 'event'
      ? [record.event]
      : decodeStorageRecord(chunkRow(record.event)).map(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：event（由 TypeScript
 * 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(event)，并按返回类型处理结果。
 */ event => event as unknown as SessionWireEvent))
}

/**
 * 功能说明：处理 chunkRow 相关流程；使用场景由所在模块及调用位置决定。
 * @param event （ChunkRowEvent）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。
 * @returns ChunkRow；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 chunkRow(event)，并按返回类型处理结果。
 */
function chunkRow(event: ChunkRowEvent): ChunkRow {
  switch (event.type) {
    case 'chunkrow/text-chunks':
      return { type: 'text-chunks', seq0: event.seq, time0: event.time, data: event.data }
    case 'chunkrow/reasoning-chunks':
      return { type: 'reasoning-chunks', seq0: event.seq, time0: event.time, data: event.data }
    case 'chunkrow/tool-call-chunks':
      return { type: 'tool-call-chunks', seq0: event.seq, time0: event.time, data: event.data }
  }
}

describe('Session history raw journal', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {
    it('follows raw tool events and preserves result metadata without a Tools service', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const { ctx } = await harness()
        /**
     * 常量说明：session 用于处理 session 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const session = ctx.sessions.create(undefined, { meta: { cwd: '/workspace' } })
        /**
     * 常量说明：history 用于处理 history 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const history = new SessionHistoryController(ctx, /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：observation（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(observation)，并按返回类型处理结果。
 */ (observation) => { observation[Symbol.dispose]() })
        /**
     * 常量说明：abort 用于处理 abort 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const abort = new AbortController()
        /**
     * 常量说明：stream 用于处理 stream 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const stream = await openFollow(history, session.id, abort.signal)
        /**
     * 常量说明：collected 用于处理 collected 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const collected = collect(stream, 2, abort)
        /**
     * 常量说明：call 用于处理 call 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const call = session.append('tool/call', {
          turn: 1, step: 1, callId: ToolCallId('raw-call'), name: 'custom', arguments: '{malformed',
        })
        /**
     * 常量说明：result 用于处理 result 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const result = session.append('tool/result', {
          turn: 1, step: 1,
          message: createToolResultMessage({
            callId: ToolCallId('raw-call'),
            content: [{ type: 'text', text: 'raw output' }],
            isError: false,
          }),
          meta: { nested: { count: 2 }, paths: ['a.ts', 'b.ts'] },
        }, { surfaceOp: 'append' })

        /**
     * 常量说明：frames 用于处理 frames 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const frames = await collected
        expect(frames).toEqual([
          { type: 'event', event: call },
          { type: 'event', event: result },
        ])
        expect((frames[1] as Extract<SessionFollowFrame, { type: 'event' }>).event.data)
          .toMatchObject({ meta: { nested: { count: 2 }, paths: ['a.ts', 'b.ts'] } })
      })

    it('follows live results without rescanning Session history', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const { ctx } = await harness()
        /**
     * 常量说明：session 用于处理 session 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const session = ctx.sessions.create(undefined, { meta: { cwd: '/workspace' } })
        /**
     * 常量说明：history 用于处理 history 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const history = new SessionHistoryController(ctx, /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：observation（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(observation)，并按返回类型处理结果。
 */ (observation) => { observation[Symbol.dispose]() })
        /**
     * 常量说明：abort 用于处理 abort 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const abort = new AbortController()
        /**
     * 常量说明：stream 用于处理 stream 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const stream = await openFollow(history, session.id, abort.signal)
        /**
     * 常量说明：iterator 用于处理 iterator 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const iterator = stream[Symbol.asyncIterator]()

        session.append('tool/call', {
          turn: 1, step: 1, callId: ToolCallId('live-fast'), name: 'term', arguments: '{"cmd":"pwd"}',
        })
        await expect(iterator.next()).resolves.toMatchObject({
          value: { type: 'event', event: { type: 'tool/call', data: { callId: 'live-fast' } } },
        })

        /**
     * 常量说明：events 用于处理 events 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const events = vi.spyOn(session, 'events', 'get').mockImplementation(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {
            throw new Error('live result rescanned Session history')
          })
        try {
          session.append('tool/result', {
            turn: 1, step: 1,
            message: createToolResultMessage({
              callId: ToolCallId('live-fast'),
              content: [{ type: 'text', text: 'ok' }],
              isError: false,
            }),
          }, { surfaceOp: 'append' })
          await expect(iterator.next()).resolves.toMatchObject({
            value: { type: 'event', event: { type: 'tool/result', data: { message: { source: { callId: 'live-fast' } } } } },
          })
        } finally {
          events.mockRestore()
          abort.abort()
          await iterator.next()
          await ctx.fiber.dispose()
        }
      })

    it('serves raw call and result entries without parsing tool arguments', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const { ctx } = await harness()
        /**
     * 常量说明：remote 用于处理 remote 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const remote = createSessionTestRemote(ctx, { defaultModelSelection: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => ({ provider: 'p', model: 'm' }), cwd: '/tmp' })
        /**
     * 常量说明：session 用于处理 session 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const session = ctx.sessions.create(undefined, { meta: { cwd: '/workspace' } })
        /**
     * 常量说明：start 用于启动 start 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const start = session.append('turn/start', { turn: 1 })
        /**
     * 常量说明：call 用于处理 call 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const call = session.append('tool/call', {
          turn: 1, step: 1, callId: ToolCallId('history-call'), name: 'custom', arguments: '{broken',
        })
        /**
     * 常量说明：result 用于处理 result 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const result = session.append('tool/result', {
          turn: 1, step: 1,
          message: createToolResultMessage({
            callId: ToolCallId('history-call'),
            content: [{ type: 'text', text: 'failed raw output' }],
            isError: true,
          }),
          meta: { persisted: true, count: 3 },
        }, { surfaceOp: 'append' })

        /**
     * 常量说明：response 用于处理 response 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const response = await remote.page({
          address: { kind: 'session', sessionId: session.id },
          throughSeq: session.seq - 1,
        })
        expect(response.ok).toBe(true)
        if (!response.ok) throw new Error('unreachable')
        expect(response.value.records).toEqual([
          { type: 'event', event: start },
          { type: 'event', event: call },
          { type: 'event', event: result },
        ])
      })

    it('counts only append-origin messages toward maxMessages and keeps each compaction summary with its replacement', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const { ctx } = await harness()
        /**
     * 常量说明：remote 用于处理 remote 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const remote = createSessionTestRemote(ctx, { defaultModelSelection: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => ({ provider: 'p', model: 'm' }), cwd: '/tmp' })
        /**
     * 常量说明：session 用于处理 session 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const session = ctx.sessions.create(undefined, { meta: { cwd: '/workspace' } })
        session.append('turn/start', { turn: 1 })
        /**
     * 常量说明：first 用于处理 first 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const first = appendUserText(session, 'first prompt')
        appendAssistantText(session, 'first reply', 1)
        /**
     * 常量说明：third 用于处理 third 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const third = appendUserText(session, 'second prompt')
        appendAssistantText(session, 'second reply', 2)
        /**
     * 常量说明：shadowed 用于处理 shadowed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const shadowed = [...session.surface.nodes]
        // A compaction transaction: a log-only summary record immediately followed by the
        // replacement that shadows the range.
        /**
     * 常量说明：summary 用于处理 summary 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const summary = appendExtension(session, 'compaction/summary', {
          summary: [{ type: 'text', text: 'summary' }],
          shadowedRange: { start: shadowed[0], end: shadowed.at(-1) },
          shadowedSeqs: shadowed,
          shadowedTokenCount: 0,
          provider: 'p',
          model: 'm',
        })
        session.append('user/message', createUserMessage({
          content: [{ type: 'text', text: '<context_checkpoint>summary</context_checkpoint>' }],
          source: { kind: 'plugin', plugin: 'compact' },
        }), {
          surfaceOp: { op: 'replace', start: shadowed[0] as number, end: shadowed.at(-1) as number },
          sourceEventSeqs: [...shadowed, summary.seq],
        })

        /**
     * 常量说明：response 用于处理 response 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const response = await remote.page({
          address: { kind: 'session', sessionId: session.id },
          throughSeq: session.seq - 1,
          maxMessages: 2,
        })
        if (!response.ok) throw new Error('unreachable')
        /**
     * 常量说明：page 用于处理 page 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const page = pageEvents(response.value)
        // Two append-origin messages fill the page even though a replacement copy of
        // the same event type sits in the window: the copy is model-only.
        /**
     * 常量说明：messages 用于处理 messages 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const messages = page.filter(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：event（由 TypeScript
 * 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(event)，并按返回类型处理结果。
 */ event => event.type === 'user/message' || event.type === 'assistant/message')
        expect(messages.map(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：event（由 TypeScript
 * 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(event)，并按返回类型处理结果。
 */ event => event.seq)).toEqual([third.seq, third.seq + 1, third.seq + 3])
        expect(page.some(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：event（由 TypeScript
 * 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(event)，并按返回类型处理结果。
 */ event => event.seq === first.seq)).toBe(false)
        expect(response.value.hasMore).toBe(true)
        // The range stays contiguous, so the checkpoint's summary record is readable on
        // the same page as the checkpoint itself.
        /**
     * 常量说明：summaryIndex 用于处理 summaryIndex 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const summaryIndex = page.findIndex(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：event（由 TypeScript
 * 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(event)，并按返回类型处理结果。
 */ event => event.seq === summary.seq)
        expect(summaryIndex).toBeGreaterThan(-1)
        expect(page[summaryIndex + 1]?.seq).toBe(summary.seq + 1)
        expect(page.map(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：event（由 TypeScript
 * 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(event)，并按返回类型处理结果。
 */ event => event.seq)).toEqual(page.map(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：_event（由 TypeScript
 * 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；参数：index（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(_event, index)，并按返回类型处理结果。
 */ (_event, index) => third.seq + index))
      })

    it('paginates a message with many provenance sources without variadic argument expansion', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const { ctx } = await harness()
        /**
     * 常量说明：remote 用于处理 remote 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const remote = createSessionTestRemote(ctx, { defaultModelSelection: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => ({ provider: 'p', model: 'm' }), cwd: '/tmp' })
        /**
     * 常量说明：session 用于处理 session 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const session = ctx.sessions.create(undefined, { meta: { cwd: '/workspace' } })
        session.append('turn/start', { turn: 1 })
        /**
     * 常量说明：sources 用于处理 sources 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const sources = Array.from({ length: 128 }, /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => session.append('assistant/chunk', {
            turn: 1,
            step: 1,
            chunk: { type: 'text-delta', index: 0, text: 'x' },
          }).seq)
        /**
     * 常量说明：message 用于处理 message 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const message = session.append('assistant/message', {
          turn: 1,
          step: 1,
          message: createMessage({
            role: 'assistant',
            content: [{ type: 'text', text: 'x'.repeat(sources.length) }],
            source: { kind: 'model', provider: 'p', model: 'm' },
          }),
        }, { surfaceOp: 'append', sourceEventSeqs: sources })

        /**
     * 常量说明：scalarMin 用于处理 scalarMin 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const scalarMin = Math.min
        /**
     * 常量说明：min 用于处理 min 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const min = vi.spyOn(Math, 'min').mockImplementation(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：values（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(values)，并按返回类型处理结果。
 */ (...values) => {
            if (values.length > 2) throw new RangeError('variadic minimum rejected by regression harness')
            return scalarMin(...values)
          })
        try {
          /**
       * 常量说明：response 用于处理 response 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
          const response = await remote.page({
            address: { kind: 'session', sessionId: session.id },
            throughSeq: message.seq,
            maxMessages: 1,
          })
          if (!response.ok) throw new Error('unreachable')
          expect(pageEvents(response.value).map(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：event（由 TypeScript
 * 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(event)，并按返回类型处理结果。
 */ event => event.seq)).toEqual([...sources, message.seq])
          expect(response.value.records.filter(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：record（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(record)，并按返回类型处理结果。
 */ record => record.type === 'chunks')).toHaveLength(1)
          expect(response.value.hasMore).toBe(true)
        } finally {
          min.mockRestore()
        }
      })

    it('encodes reasoning and tool-call runs as aligned chunk events', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const { ctx } = await harness()
        /**
     * 常量说明：remote 用于处理 remote 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const remote = createSessionTestRemote(ctx, { defaultModelSelection: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => ({ provider: 'p', model: 'm' }), cwd: '/tmp' })
        /**
     * 常量说明：session 用于处理 session 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const session = ctx.sessions.create(undefined, { meta: { cwd: '/workspace' } })
        /**
     * 常量说明：reasoning 用于处理 reasoning 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const reasoning = [0, 1, 2].map(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：index（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(index)，并按返回类型处理结果。
 */ index => session.append('assistant/chunk', {
            turn: 1,
            step: 1,
            chunk: { type: 'reasoning-delta', index: 0, text: `r${String(index)}` },
          }))
        /**
     * 常量说明：callId 用于处理 callId 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const callId = ToolCallId('packed-call')
        /**
     * 常量说明：toolCall 用于处理 toolCall 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const toolCall = [0, 1, 2].map(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：index（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(index)，并按返回类型处理结果。
 */ index => session.append('assistant/chunk', {
            turn: 1,
            step: 1,
            chunk: { type: 'tool-call-delta', index: 1, id: callId, argumentsDelta: `a${String(index)}` },
          }))

        /**
     * 常量说明：response 用于处理 response 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const response = await remote.page({
          address: { kind: 'session', sessionId: session.id },
          throughSeq: session.seq - 1,
        })
        if (!response.ok) throw new Error('unreachable')
        expect(response.value.records).toEqual([
          {
            type: 'chunks',
            event: {
              type: 'chunkrow/reasoning-chunks',
              seq: reasoning[0]?.seq,
              time: reasoning[0]?.time,
              data: {
                turn: 1,
                step: 1,
                index: 0,
                dt: reasoning.slice(1).map(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：event（由 TypeScript
 * 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；参数：index（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(event, index)，并按返回类型处理结果。
 */ (event, index) => event.time - (reasoning[index]?.time ?? 0)),
                texts: ['r0', 'r1', 'r2'],
              },
            },
          },
          {
            type: 'chunks',
            event: {
              type: 'chunkrow/tool-call-chunks',
              seq: toolCall[0]?.seq,
              time: toolCall[0]?.time,
              data: {
                turn: 1,
                step: 1,
                index: 1,
                id: callId,
                dt: toolCall.slice(1).map(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：event（由 TypeScript
 * 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；参数：index（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(event, index)，并按返回类型处理结果。
 */ (event, index) => event.time - (toolCall[index]?.time ?? 0)),
                args: ['a0', 'a1', 'a2'],
              },
            },
          },
        ])
        await ctx.fiber.dispose()
      })

    it('follows a result after turn/end without reading the addressed Session log', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const { ctx } = await harness()
        /**
     * 常量说明：session 用于处理 session 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const session = ctx.sessions.create(undefined, { meta: { cwd: '/workspace' } })
        /**
     * 常量说明：history 用于处理 history 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const history = new SessionHistoryController(ctx, /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：observation（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(observation)，并按返回类型处理结果。
 */ (observation) => { observation[Symbol.dispose]() })
        /**
     * 常量说明：abort 用于处理 abort 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const abort = new AbortController()
        /**
     * 常量说明：stream 用于处理 stream 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const stream = await openFollow(history, session.id, abort.signal)
        /**
     * 常量说明：iterator 用于处理 iterator 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const iterator = stream[Symbol.asyncIterator]()

        session.append('turn/start', { turn: 1 })
        await expect(iterator.next()).resolves.toMatchObject({
          value: { type: 'event', event: { type: 'turn/start' } },
        })
        session.append('tool/call', { turn: 1, step: 1, callId: ToolCallId('c-late'), name: 'term', arguments: '{"cmd":"tail"}' })
        await expect(iterator.next()).resolves.toMatchObject({
          value: { type: 'event', event: { type: 'tool/call' } },
        })
        session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
        await expect(iterator.next()).resolves.toMatchObject({
          value: { type: 'event', event: { type: 'turn/end' } },
        })
        /**
     * 常量说明：events 用于处理 events 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const events = vi.spyOn(session, 'events', 'get').mockImplementation(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {
            throw new Error('live result rescanned Session history')
          })
        try {
          /**
       * 常量说明：result 用于处理 result 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
          const result = session.append('tool/result', {
            turn: 1, step: 1,
            message: createToolResultMessage({
              callId: ToolCallId('c-late'),
              content: [{ type: 'text', text: 'ok' }],
              isError: false,
            }),
          }, { surfaceOp: 'append' })
          await expect(iterator.next()).resolves.toEqual({
            done: false,
            value: { type: 'event', event: result },
          })
        } finally {
          events.mockRestore()
          abort.abort()
          await iterator.next()
          await ctx.fiber.dispose()
        }
      })
  })
