/**
 * 文件职责：验证 api/session-controller 中 transport host spec 相关行为与失败场景。
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。
 * 产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 */
import { Context } from '@deepseek-ai/cordis'
import { createScope } from '@deepseek-ai/dsh-scope'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { Session, SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
import type { SessionObservation } from '@deepseek-ai/dsh-session-query'
import { snapshotSubagentDescriptor } from '@deepseek-ai/dsh-subagent'
import { subagentIdentityProjectionDefinition } from '@deepseek-ai/dsh-subagent/src/projection.ts'
import { describe, expect, it, vi } from 'vitest'
import { SessionHistoryController } from '../src/history.ts'
import { installSessionReadTestServices, testSessionPersistence } from './test-remote.ts'

/**
 * 常量说明：signal 用于处理 signal 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 * 功能说明：处理 signal 相关流程；使用场景由所在模块及调用位置决定。
 * @returns AbortSignal；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 signal()，并按返回类型处理结果。
 */
const signal = (): AbortSignal => new AbortController().signal

/**
 * 功能说明：处理 append 相关流程；使用场景由所在模块及调用位置决定。
 * @param session （Session）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param type （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param data （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param options （{ readonly surfaceOp?: unknown; readonly
 * sourceEventSeqs?: …）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。
 * @returns SessionEvent；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 append(session, type, data, options)，并按返回类型处理结果。
 */
function append(
  session: Session,
  type: string,
  data: unknown,
  options?: { readonly surfaceOp?: unknown; readonly sourceEventSeqs?: readonly number[] },
): SessionEvent {
  return (session.append as unknown as (
    eventType: string,
    eventData: unknown,
    eventOptions?: unknown,
  ) => SessionEvent)(type, data, options)
}

/**
 * 功能说明：处理 event 相关流程；使用场景由所在模块及调用位置决定。
 * @param type （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param seq （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param data （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns SessionEvent；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 event(type, seq, data)，并按返回类型处理结果。
 */
function event(type: string, seq: number, data: unknown = {}): SessionEvent {
  return {
    type,
    seq,
    time: seq + 1,
    data,
  } as SessionEvent
}

/**
 * 功能说明：处理 cold 相关流程；使用场景由所在模块及调用位置决定。
 * @param ctx （Context）：提供当前 Cordis 插件上下文与已声明服务；必须满足声明的类型及调用时序要求。
 * @param header （SessionHeader）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param events （readonly SessionEvent[]）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。
 * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 cold(ctx, header, events)，并按返回类型处理结果。
 */
function cold(
  ctx: Context,
  header: SessionHeader,
  events: readonly SessionEvent[],
): void {
  ctx.provide('sessionPersistence', testSessionPersistence(ctx, {
    list: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => Promise.resolve([header]),
    inspect: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => Promise.resolve({ meta: header, events }),
  }) as never)
}

interface Deferred<T> {
  readonly promise: Promise<T>
  /**
   * 功能说明：解析 resolve 相关流程；使用场景由所在模块及调用位置决定。
   * @param value （T）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 resolve(value)，并按返回类型处理结果。
   */
  resolve(value: T): void
}

/**
 * 功能说明：处理 deferred 相关流程；使用场景由所在模块及调用位置决定。
 * @returns Deferred<T>；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 deferred()，并按返回类型处理结果。
 */
function deferred<T>(): Deferred<T> {
  /**
   * 变量说明：resolve 用于解析 resolve 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let resolve!: (value: T) => void
  /**
   * 常量说明：promise 用于处理 promise 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const promise = new Promise<T>(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：settle（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(settle)，并按返回类型处理结果。
 */ (settle) => { resolve = settle })
  return { promise, resolve }
}

/**
 * 功能说明：处理 setup 相关流程；使用场景由所在模块及调用位置决定。
 * @returns Promise<{ ctx: Context; transport: SessionHistoryController }>；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 setup()，并按返回类型处理结果。
 */
async function setup(): Promise<{ ctx: Context; transport: SessionHistoryController }> {
  /**
   * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  installSessionReadTestServices(ctx)
  ctx.sessionProjections.register(subagentIdentityProjectionDefinition)
  /**
   * 常量说明：transport 用于处理 transport 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const transport = new SessionHistoryController(ctx, /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：observation（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(observation)，并按返回类型处理结果。
 */ (observation) => { observation[Symbol.dispose]() })
  return { ctx, transport }
}

describe('SessionHistoryController', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {
    it('opens at the current cursor and follows later events from an ordinary Session', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：ctx、transport 用于处理 ctx、transport 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const { ctx, transport } = await setup()
        /**
     * 常量说明：session 用于处理 session 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const session = ctx.sessions.create(SessionId('ordinary'), { meta: { cwd: '/workspace' } })
        session.append('turn/start', { turn: 1 })
        /**
     * 常量说明：abort 用于处理 abort 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const abort = new AbortController()
        /**
     * 常量说明：iterator 用于处理 iterator 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const iterator = transport.follow(
          { address: { kind: 'session', sessionId: session.id } },
          abort.signal,
        )[Symbol.asyncIterator]()

        expect(await iterator.next()).toMatchObject({ done: false, value: { type: 'snapshot', cursor: 0 } })
        session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
        expect(await iterator.next()).toMatchObject({
          done: false,
          value: { type: 'event', event: { type: 'turn/end', seq: 1 } },
        })

        /**
     * 常量说明：page 用于处理 page 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const page = await transport.page(
          { address: { kind: 'session', sessionId: session.id }, throughSeq: 1 },
          new AbortController().signal,
        )
        expect(page.records.map(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：entry（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(entry)，并按返回类型处理结果。
 */ entry => entry.event.seq)).toEqual([0, 1])

        abort.abort()
        expect(await iterator.next()).toMatchObject({ done: true })
      })

    it('ends active followers when the owning Controller unloads', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const ctx = new Context()
        await ctx.plugin(SessionStore)
        installSessionReadTestServices(ctx)
        /**
     * 变量说明：transport 用于处理 transport 相关数据，作用于当前作用域；其值可能随流程推进而变化，
     * 读写时需遵守声明类型和所在生命周期。
     */
        let transport!: SessionHistoryController
        /**
     * 常量说明：owner 用于处理 owner 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const owner = ctx.plugin(Object.assign(
          /*
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：inner（Context）：提供本次调用所需的数据；
       * 必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；
       * 典型用法：在完成前置校验后调用 匿名回调(inner)，并按返回类型处理结果。
       */ (inner: Context) => {
            transport = new SessionHistoryController(inner, /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：observation（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(observation)，并按返回类型处理结果。
 */ (observation) => { observation[Symbol.dispose]() })
          },
          { inject: ['sessions', 'sessionQuery'] },
        ))
        await owner.await()
        /**
     * 常量说明：session 用于处理 session 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const session = ctx.sessions.create(SessionId('controller-unload'), { meta: { cwd: '/workspace' } })
        /**
     * 常量说明：iterator 用于处理 iterator 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const iterator = transport.follow(
          { address: { kind: 'session', sessionId: session.id } },
          new AbortController().signal,
        )[Symbol.asyncIterator]()

        await expect(iterator.next()).resolves.toMatchObject({
          done: false,
          value: { type: 'snapshot', cursor: -1 },
        })
        /**
     * 常量说明：pending 用于处理 pending 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const pending = iterator.next()
        await owner.dispose()
        await expect(pending).resolves.toEqual({ done: true, value: undefined })
        await ctx.fiber.dispose()
      })

    it('reconnects with a complete replacement snapshot before later live events', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：ctx、transport 用于处理 ctx、transport 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const { ctx, transport } = await setup()
        /**
     * 常量说明：session 用于处理 session 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const session = ctx.sessions.create(SessionId('resume'), { meta: { cwd: '/workspace' } })
        session.append('turn/start', { turn: 1 })
        session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
        session.append('turn/start', { turn: 2 })
        /**
     * 常量说明：abort 用于处理 abort 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const abort = new AbortController()
        /**
     * 常量说明：iterator 用于处理 iterator 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const iterator = transport.follow({
          address: { kind: 'session', sessionId: session.id },
        }, abort.signal)[Symbol.asyncIterator]()

        expect(await iterator.next()).toMatchObject({
          done: false,
          value: {
            type: 'snapshot',
            cursor: 2,
            records: [
              { type: 'event', event: { seq: 0 } },
              { type: 'event', event: { seq: 1 } },
              { type: 'event', event: { seq: 2 } },
            ],
          },
        })
        session.append('turn/end', { turn: 2, reason: { kind: 'completed' } })
        expect(await iterator.next()).toMatchObject({ done: false, value: { type: 'event', event: { seq: 3 } } })

        abort.abort()
        expect(await iterator.next()).toMatchObject({ done: true })
      })

    it('subscribes before a cold read and ignores unrelated and replayed buffered events', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：ctx、transport 用于处理 ctx、transport 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const { ctx, transport } = await setup()
        /**
     * 常量说明：sessionId 用于处理 sessionId 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const sessionId = SessionId('cold-race')
        /**
     * 常量说明：header 用于处理 header 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const header = { version: 0, id: sessionId, createdAt: 1, cwd: '/workspace' }
        /**
     * 常量说明：inspected 用于处理 inspected 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const inspected = deferred<{ meta: SessionHeader; events: readonly SessionEvent[] }>()
        ctx.provide('sessionPersistence', testSessionPersistence(ctx, {
          inspect: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => inspected.promise,
        }) as never)
        /**
     * 常量说明：abort 用于处理 abort 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const abort = new AbortController()
        /**
     * 常量说明：iterator 用于处理 iterator 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const iterator = transport.follow({ address: { kind: 'session', sessionId } }, abort.signal)
          [Symbol.asyncIterator]()
        /**
     * 常量说明：opening 用于处理 opening 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const opening = iterator.next()

        ctx.emit('session/event', {
          id: SessionId('unrelated'), events: [event('fixture/other', 0)],
        } as unknown as Session, event('fixture/other', 0))
        ctx.emit('session/event', {
          id: sessionId, events: [event('fixture/start', 0)],
        } as unknown as Session, event('fixture/start', 0))
        inspected.resolve({ meta: header, events: [event('fixture/start', 0)] })
        await expect(opening).resolves.toMatchObject({ done: false, value: { type: 'snapshot', cursor: 0 } })

        /**
     * 常量说明：waiting 用于处理 waiting 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const waiting = iterator.next()
        abort.abort()
        await expect(waiting).resolves.toMatchObject({ done: true })
      })

    it('buffers creation while the opening observation is unresolved', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const ctx = new Context()
        await ctx.plugin(SessionStore)
        /**
     * 常量说明：sessionId 用于处理 sessionId 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const sessionId = SessionId('created-during-observation')
        /**
     * 常量说明：header 用于处理 header 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const header = { version: 0, id: sessionId, createdAt: 1, cwd: '/workspace' }
        /**
     * 常量说明：observed 用于处理 observed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const observed = deferred<SessionObservation>()
        ctx.provide('sessionQuery', { observeSession: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => observed.promise } as never)
        /**
     * 常量说明：transport 用于处理 transport 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const transport = new SessionHistoryController(ctx, vi.fn())
        /**
     * 常量说明：abort 用于处理 abort 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const abort = new AbortController()
        /**
     * 常量说明：iterator 用于处理 iterator 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const iterator = transport.follow({ address: { kind: 'session', sessionId } }, abort.signal)
          [Symbol.asyncIterator]()
        /**
     * 常量说明：opening 用于处理 opening 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const opening = iterator.next()

        /**
     * 常量说明：attached 用于处理 attached 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const attached = ctx.sessions.create(sessionId, { meta: header, seed: [event('fixture/seed', 0)] })
        observed.resolve({
          source: 'live',
          header: attached.header,
          events: attached.events,
          cursor: attached.seq - 1,
          projections: { asOfSeq: attached.seq - 1, values: {} },
          retain: vi.fn(),
          [Symbol.dispose]: vi.fn(),
        } as unknown as SessionObservation)
        await expect(opening).resolves.toMatchObject({
          done: false,
          value: {
            type: 'snapshot',
            cursor: 1,
            records: [
              { type: 'event', event: { seq: 0 } },
              { type: 'event', event: { seq: 1 } },
            ],
          },
        })
        expect(attached.id).toBe(sessionId)
        abort.abort()
        await expect(iterator.next()).resolves.toMatchObject({ done: true })
      })

    it('bridges the unpublished end-seed boundary when a cold source attaches', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const ctx = new Context()
        await ctx.plugin(SessionStore)
        installSessionReadTestServices(ctx)
        /**
     * 变量说明：transport 用于处理 transport 相关数据，作用于当前作用域；其值可能随流程推进而变化，
     * 读写时需遵守声明类型和所在生命周期。
     */
        let transport!: SessionHistoryController
        /**
     * 变量说明：agentCtx 用于处理 agentCtx 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
        let agentCtx!: Context
        await ctx.plugin(Object.assign(
          /*
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：inner（Context）：提供本次调用所需的数据；
       * 必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；
       * 典型用法：在完成前置校验后调用 匿名回调(inner)，并按返回类型处理结果。
       */ (inner: Context) => {
            transport = new SessionHistoryController(inner, /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：observation（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(observation)，并按返回类型处理结果。
 */ (observation) => { observation[Symbol.dispose]() })
          },
          { inject: ['sessions', 'sessionQuery'] },
        ))
        await ctx.plugin(Object.assign(
          /*
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：inner（Context）：提供本次调用所需的数据；
       * 必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；
       * 典型用法：在完成前置校验后调用 匿名回调(inner)，并按返回类型处理结果。
       */ (inner: Context) => { agentCtx = createScope(inner, { name: 'agent' }).ctx },
          { inject: ['sessions'] },
        ))
        /**
     * 常量说明：sessionId 用于处理 sessionId 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const sessionId = SessionId('cold-attach')
        /**
     * 常量说明：header 用于处理 header 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const header = { version: 0, id: sessionId, createdAt: 1, cwd: '/workspace' }
        /**
     * 常量说明：seed 用于处理 seed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const seed = [event('fixture/start', 0)]
        cold(ctx, header, seed)
        agentCtx.on('session/created', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：session（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(session)，并按返回类型处理结果。
 */ (session) => {
            if (session.id !== sessionId) return
            append(session, 'fixture/setup-one', {})
            append(session, 'fixture/setup-two', {})
          })
        /**
     * 常量说明：abort 用于处理 abort 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const abort = new AbortController()
        /**
     * 常量说明：iterator 用于处理 iterator 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const iterator = transport.follow({ address: { kind: 'session', sessionId } }, abort.signal)
          [Symbol.asyncIterator]()

        await expect(iterator.next()).resolves.toMatchObject({ done: false, value: { type: 'snapshot', cursor: 0 } })
        agentCtx.sessions.create(SessionId('unrelated-created'), { meta: { cwd: '/workspace' } })
        /**
     * 常量说明：attached 用于处理 attached 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const attached = agentCtx.sessions.prepare(sessionId, { meta: header, seed })
        agentCtx.sessions.enter(attached)
        agentCtx.sessions.announce(attached)
        await expect(iterator.next()).resolves.toMatchObject({
          done: false,
          value: { type: 'event', event: { type: 'session/end-seed', seq: 1 } },
        })
        await expect(iterator.next()).resolves.toMatchObject({
          done: false,
          value: { type: 'event', event: { type: 'fixture/setup-one', seq: 2 } },
        })
        await expect(iterator.next()).resolves.toMatchObject({
          done: false,
          value: { type: 'event', event: { type: 'fixture/setup-two', seq: 3 } },
        })
        append(attached, 'fixture/live', {})
        await expect(iterator.next()).resolves.toMatchObject({
          done: false,
          value: { type: 'event', event: { type: 'fixture/live', seq: 4 } },
        })

        abort.abort()
        await expect(iterator.next()).resolves.toMatchObject({ done: true })
      })

    it('rejects gaps in replayed and live event sequences', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：replay 用于处理 replay 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const replay = await setup()
        /**
     * 常量说明：replayId 用于处理 replayId 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const replayId = SessionId('replay-gap')
        /**
     * 常量说明：replayHeader 用于处理 replayHeader 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const replayHeader = { version: 0, id: replayId, createdAt: 1, cwd: '/workspace' }
        cold(replay.ctx, replayHeader, [event('fixture/start', 0), event('fixture/gap', 2)])
        /**
     * 常量说明：replayed 用于处理 replayed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const replayed = replay.transport.follow({
          address: { kind: 'session', sessionId: replayId },
        }, signal())[Symbol.asyncIterator]()
        await expect(replayed.next()).rejects.toMatchObject({ code: 'SESSION_QUERY_CORRUPT_SESSION' })

        /**
     * 常量说明：live 用于处理 live 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const live = await setup()
        /**
     * 常量说明：session 用于处理 session 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const session = live.ctx.sessions.create(SessionId('live-gap'), { meta: { cwd: '/workspace' } })
        append(session, 'fixture/start', {})
        live.ctx.provide('agents', { get: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => ({ id: session.id }) } as never)
        /**
     * 常量说明：followed 用于处理 followed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const followed = live.transport.follow({
          address: { kind: 'session', sessionId: session.id },
        }, signal())[Symbol.asyncIterator]()
        await expect(followed.next()).resolves.toMatchObject({ done: false, value: { type: 'snapshot', cursor: 0 } })
        /**
     * 常量说明：skipped 用于处理 skipped 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const skipped = event('fixture/skipped', 1)
        /**
     * 常量说明：gap 用于处理 gap 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const gap = event('fixture/gap', 2)
        live.ctx.emit('session/event', {
          id: session.id,
          events: [event('fixture/start', 0), skipped, gap],
        } as unknown as Session, gap)
        await expect(followed.next()).rejects.toMatchObject({ failure: { code: 'internal' } })
      })

    it('opens an empty source at cursor -1', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：ctx、transport 用于处理 ctx、transport 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const { ctx, transport } = await setup()
        /**
     * 常量说明：session 用于处理 session 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const session = ctx.sessions.create(SessionId('empty-follow'), { meta: { cwd: '/workspace' } })
        /**
     * 常量说明：abort 用于处理 abort 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const abort = new AbortController()
        /**
     * 常量说明：iterator 用于处理 iterator 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const iterator = transport.follow({
          address: { kind: 'session', sessionId: session.id },
        }, abort.signal)[Symbol.asyncIterator]()
        await expect(iterator.next()).resolves.toMatchObject({ done: false, value: { type: 'snapshot', cursor: -1 } })
        await expect(transport.page({
          address: { kind: 'session', sessionId: session.id }, throughSeq: -1,
        }, signal())).resolves.toMatchObject({ records: [], hasMore: false })
        abort.abort()
        await expect(iterator.next()).resolves.toMatchObject({ done: true })
      })

    it('publishes an empty projection baseline when the query has no registry', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const ctx = new Context()
        await ctx.plugin(SessionStore)
        /**
     * 常量说明：sessionId 用于处理 sessionId 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const sessionId = SessionId('projectionless-follow')
        /**
     * 常量说明：meta 用于处理 meta 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const meta = { version: 0, id: sessionId, createdAt: 1, cwd: '/workspace' }
        ctx.provide('sessionQuery', {
          observeSession: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => Promise.resolve({
            source: 'live', header: meta, events: [], cursor: -1,
            retain: vi.fn(), [Symbol.dispose]: vi.fn(),
          } satisfies SessionObservation),
        } as never)
        /**
     * 常量说明：history 用于处理 history 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const history = new SessionHistoryController(ctx, vi.fn())
        /**
     * 常量说明：abort 用于处理 abort 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const abort = new AbortController()
        /**
     * 常量说明：iterator 用于处理 iterator 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const iterator = history.follow({ address: { kind: 'session', sessionId } }, abort.signal)
          [Symbol.asyncIterator]()

        await expect(iterator.next()).resolves.toMatchObject({
          value: { type: 'snapshot', projections: { asOfSeq: -1, values: {} } },
        })
        abort.abort()
        await expect(iterator.next()).resolves.toMatchObject({ done: true })
        await ctx.fiber.dispose()
      })

    it('disposes a retained promotion when background activation rejects synchronously', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const ctx = new Context()
        await ctx.plugin(SessionStore)
        /**
     * 常量说明：sessionId 用于处理 sessionId 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const sessionId = SessionId('promotion-failure')
        /**
     * 常量说明：meta 用于处理 meta 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const meta = { version: 0, id: sessionId, createdAt: 1, cwd: '/workspace' }
        /**
     * 常量说明：disposePromotion 用于处理 disposePromotion 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const disposePromotion = vi.fn()
        /**
     * 常量说明：promotion 用于处理 promotion 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const promotion = {
          source: 'prepared', header: meta, events: [], cursor: -1,
          projections: { asOfSeq: -1, values: {} },
          retain: vi.fn(), [Symbol.dispose]: disposePromotion,
        } as unknown as SessionObservation
        /**
     * 常量说明：source 用于处理 source 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const source = {
          ...promotion,
          retain: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => promotion,
          [Symbol.dispose]: vi.fn(),
        } as SessionObservation
        ctx.provide('sessionQuery', {
          observeSession: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => Promise.resolve(source),
        } as never)
        /**
     * 常量说明：history 用于处理 history 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const history = new SessionHistoryController(ctx, /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => { throw new Error('activation failed') })
        /**
     * 常量说明：iterator 用于处理 iterator 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const iterator = history.follow({ address: { kind: 'session', sessionId } }, signal())
          [Symbol.asyncIterator]()

        await expect(iterator.next()).resolves.toMatchObject({ value: { type: 'snapshot' } })
        await expect(iterator.next()).rejects.toThrow('activation failed')
        expect(disposePromotion).toHaveBeenCalledOnce()
        await ctx.fiber.dispose()
      })

    it('requires the durable parent and mode for a direct subagent address', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：ctx、transport 用于处理 ctx、transport 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const { ctx, transport } = await setup()
        /**
     * 常量说明：parentSessionId 用于处理 parentSessionId 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const parentSessionId = SessionId('parent')
        /**
     * 常量说明：childSessionId 用于处理 childSessionId 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const childSessionId = SessionId('child')
        ctx.sessions.create(parentSessionId, { meta: { cwd: '/workspace' } })
        /**
     * 常量说明：child 用于处理 child 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const child = ctx.sessions.create(childSessionId, {
          meta: { cwd: '/workspace', origin: 'subagent', parentSession: parentSessionId },
        })
        child.append('subagent/descriptor', snapshotSubagentDescriptor({
          mode: 'continuable',
          provider: 'test',
          label: 'child',
        }))
        /**
     * 常量说明：signal 用于处理 signal 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const signal = new AbortController().signal

        await expect(transport.page({
          address: { kind: 'subagent', parentSessionId, childSessionId, mode: 'continuable' },
          throughSeq: 0,
        }, signal)).resolves.toMatchObject({
          records: [{ type: 'event', event: { type: 'subagent/descriptor' } }],
        })
        await expect(transport.page({
          address: {
            kind: 'subagent',
            parentSessionId: SessionId('other-parent'),
            childSessionId,
            mode: 'continuable',
          },
          throughSeq: 0,
        }, signal)).rejects.toMatchObject({ failure: { code: 'subagent-unauthorized' } })
        await expect(transport.page({
          address: { kind: 'subagent', parentSessionId, childSessionId, mode: 'one-shot' },
          throughSeq: 0,
        }, signal)).rejects.toMatchObject({ failure: { code: 'subagent-unauthorized' } })
        await expect(transport.page({
          address: { kind: 'session', sessionId: childSessionId },
          throughSeq: 0,
        }, signal)).rejects.toMatchObject({ failure: { code: 'agent-busy' } })
      })

    it('preserves a cold inspection failure for the Gateway error branch', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：ctx、transport 用于处理 ctx、transport 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const { ctx, transport } = await setup()
        /**
     * 常量说明：sessionId 用于处理 sessionId 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const sessionId = SessionId('corrupt-cold')
        /**
     * 常量说明：failure 用于处理 failure 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const failure = new Error('cold log is corrupt')
        /**
     * 常量说明：header 用于处理 header 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const header = { version: 0, id: sessionId, createdAt: 1, cwd: '/workspace' }
        ctx.provide('sessionPersistence', testSessionPersistence(ctx, {
          list: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => Promise.resolve([header]),
          inspect: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => Promise.reject(failure),
        }) as never)

        await expect(transport.page({
          address: { kind: 'session', sessionId },
          throughSeq: -1,
        }, new AbortController().signal)).rejects.toMatchObject({
          code: 'SESSION_QUERY_PERSISTENCE_FAILED',
          cause: failure,
        })
      })

    it('rejects malformed page and follow cursors at the service boundary', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：ctx、transport 用于处理 ctx、transport 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const { ctx, transport } = await setup()
        /**
     * 常量说明：session 用于处理 session 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const session = ctx.sessions.create(SessionId('validation'), { meta: { cwd: '/workspace' } })
        /**
     * 常量说明：address 用于处理 address 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const address = { kind: 'session' as const, sessionId: session.id }
        for (const /*
     * 变量说明：request 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */ request of [
            { address, throughSeq: -2 },
            { address, throughSeq: 0.5 },
            { address, throughSeq: -1, beforeSeq: -1 },
            { address, throughSeq: -1, beforeSeq: 1.5 },
            { address, throughSeq: -1, maxMessages: 0 },
            { address, throughSeq: -1, maxMessages: 1.5 },
          ]) {
          await expect(transport.page(request, signal())).rejects.toMatchObject({ failure: { code: 'bad-request' } })
        }
        await expect(transport.page({ address, throughSeq: 0 }, signal()))
          .rejects.toMatchObject({ failure: { code: 'bad-request' } })

        /**
     * 常量说明：corrupt 用于处理 corrupt 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const corrupt = await setup()
        /**
     * 常量说明：corruptId 用于处理 corruptId 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const corruptId = SessionId('missing-through-seq')
        cold(
          corrupt.ctx,
          { version: 0, id: corruptId, createdAt: 1, cwd: '/workspace' },
          [event('fixture/start', 0), event('fixture/gap', 2)],
        )
        await expect(corrupt.transport.page({
          address: { kind: 'session', sessionId: corruptId }, throughSeq: 1,
        }, signal())).rejects.toMatchObject({ code: 'SESSION_QUERY_CORRUPT_SESSION' })
        for (const /*
     * 变量说明：maxMessages 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */ maxMessages of [0, 0.5]) {
          /**
       * 常量说明：iterator 用于处理 iterator 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
          const iterator = transport.follow({ address, maxMessages }, signal())[Symbol.asyncIterator]()
          await expect(iterator.next()).rejects.toMatchObject({ failure: { code: 'bad-request' } })
        }
      })

    it('reports missing ordinary and subagent sources without fabricating inspection failures', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：ctx、transport 用于处理 ctx、transport 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const { ctx, transport } = await setup()
        /**
     * 常量说明：ordinary 用于处理 ordinary 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const ordinary = { kind: 'session' as const, sessionId: SessionId('missing') }
        await expect(transport.page({ address: ordinary, throughSeq: -1 }, signal()))
          .rejects.toMatchObject({ failure: { code: 'session-not-found' } })

        /**
     * 常量说明：inspect 用于处理 inspect 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const inspect = vi.fn(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => Promise.resolve(undefined))
        ctx.provide('sessionPersistence', testSessionPersistence(ctx, {
          list: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => Promise.resolve([]),
          inspect,
        }) as never)
        await expect(transport.page({ address: ordinary, throughSeq: -1 }, signal()))
          .rejects.toMatchObject({ failure: { code: 'session-not-found' } })
        await expect(transport.page({
          address: {
            kind: 'subagent',
            parentSessionId: SessionId('parent'),
            childSessionId: SessionId('missing-child'),
            mode: 'continuable',
          },
          throughSeq: -1,
        }, signal())).rejects.toMatchObject({ failure: { code: 'subagent-not-found' } })
        expect(inspect).toHaveBeenCalledTimes(2)
      })

    it('rejects incomplete cold metadata before serving a source', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：first 用于处理 first 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const first = await setup()
        /**
     * 常量说明：sessionId 用于处理 sessionId 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const sessionId = SessionId('incomplete')
        /**
     * 常量说明：address 用于处理 address 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const address = { kind: 'session' as const, sessionId }
        /**
     * 常量说明：firstHeader 用于处理 firstHeader 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const firstHeader = { version: 0, id: sessionId, createdAt: 1 }
        first.ctx.provide('sessionPersistence', testSessionPersistence(first.ctx, {
          list: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => Promise.resolve([firstHeader]),
          inspect: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => Promise.resolve({ meta: firstHeader, events: [] }),
        }) as never)
        await expect(first.transport.page({ address, throughSeq: -1 }, signal()))
          .rejects.toMatchObject({ failure: { code: 'session-not-found' } })

        /**
     * 常量说明：second 用于处理 second 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const second = await setup()
        /**
     * 常量说明：listed 用于处理 listed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const listed = { version: 0, id: sessionId, createdAt: 1, cwd: '/workspace' }
        /**
     * 常量说明：inspected 用于处理 inspected 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const inspected = { version: 0, id: sessionId, createdAt: 1 }
        second.ctx.provide('sessionPersistence', testSessionPersistence(second.ctx, {
          list: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => Promise.resolve([listed]),
          inspect: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => Promise.resolve({ meta: inspected, events: [] }),
        }) as never)
        await expect(second.transport.page({ address, throughSeq: -1 }, signal()))
          .rejects.toMatchObject({ failure: { code: 'session-not-found' } })
      })

    it('serves cold ordinary history and validates every durable subagent descriptor state', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：ordinaryBench 用于处理 ordinaryBench 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const ordinaryBench = await setup()
        /**
     * 常量说明：ordinaryId 用于处理 ordinaryId 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const ordinaryId = SessionId('cold-ordinary')
        /**
     * 常量说明：ordinaryHeader 用于处理 ordinaryHeader 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const ordinaryHeader = { version: 0, id: ordinaryId, createdAt: 1, cwd: '/workspace' }
        cold(ordinaryBench.ctx, ordinaryHeader, [event('turn/start', 0, { turn: 1 })])
        await expect(ordinaryBench.transport.page({
          address: { kind: 'session', sessionId: ordinaryId },
          throughSeq: 0,
        }, signal())).resolves.toMatchObject({
          records: [{ type: 'event', event: { seq: 0 } }],
        })

        /**
     * 常量说明：parentSessionId 用于处理 parentSessionId 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const parentSessionId = SessionId('cold-parent')
        /**
     * 常量说明：childSessionId 用于处理 childSessionId 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const childSessionId = SessionId('cold-child')
        /**
     * 常量说明：childHeader 用于处理 childHeader 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const childHeader = {
          version: 0,
          id: childSessionId,
          createdAt: 1,
          cwd: '/workspace',
          origin: 'subagent' as const,
          parentSession: parentSessionId,
        }
        /**
     * 常量说明：childAddress 用于处理 childAddress 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const childAddress = {
          kind: 'subagent' as const,
          parentSessionId,
          childSessionId,
          mode: 'continuable' as const,
        }
        /**
     * 常量说明：missing 用于处理 missing 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const missing = await setup()
        cold(missing.ctx, childHeader, [])
        await expect(missing.transport.page({ address: childAddress, throughSeq: -1 }, signal()))
          .rejects.toMatchObject({ failure: { code: 'subagent-catalog-diagnostic', details: { reason: 'corrupt' } } })

        /**
     * 常量说明：corrupt 用于处理 corrupt 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const corrupt = await setup()
        cold(corrupt.ctx, childHeader, [event('subagent/descriptor', 0, { version: 'bad' })])
        await expect(corrupt.transport.page({ address: childAddress, throughSeq: 0 }, signal()))
          .rejects.toMatchObject({ failure: { code: 'subagent-catalog-diagnostic', details: { reason: 'corrupt' } } })

        /**
     * 常量说明：ordinaryChild 用于处理 ordinaryChild 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const ordinaryChild = await setup()
        /**
     * 常量说明：_origin、ordinaryChildHeader 用于处理 _origin、ordinaryChildHeader 相关数据，
     * 作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const { origin: _origin, ...ordinaryChildHeader } = childHeader
        cold(ordinaryChild.ctx, ordinaryChildHeader, [])
        await expect(ordinaryChild.transport.page({ address: childAddress, throughSeq: -1 }, signal()))
          .rejects.toMatchObject({ failure: { code: 'subagent-unauthorized' } })
      })

    it('reports an unavailable descriptor when an observed child has no projection value', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const ctx = new Context()
        await ctx.plugin(SessionStore)
        /**
     * 常量说明：parentSessionId 用于处理 parentSessionId 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const parentSessionId = SessionId('missing-projection-parent')
        /**
     * 常量说明：childSessionId 用于处理 childSessionId 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const childSessionId = SessionId('missing-projection-child')
        /**
     * 常量说明：meta 用于处理 meta 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const meta: SessionHeader = {
          version: 0,
          id: childSessionId,
          createdAt: 1,
          cwd: '/workspace',
          origin: 'subagent',
          parentSession: parentSessionId,
        }
        ctx.provide('sessionQuery', {
          observeSession: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => Promise.resolve({
            source: 'live', header: meta, events: [], cursor: -1,
            projections: { asOfSeq: -1, values: {} },
            retain: vi.fn(), [Symbol.dispose]: vi.fn(),
          } as unknown as SessionObservation),
        } as never)
        /**
     * 常量说明：history 用于处理 history 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const history = new SessionHistoryController(ctx, vi.fn())

        await expect(history.page({
          address: { kind: 'subagent', parentSessionId, childSessionId, mode: 'continuable' },
          throughSeq: -1,
        }, signal())).rejects.toMatchObject({
          failure: { code: 'subagent-catalog-diagnostic', details: { reason: 'unsupported' } },
        })
        await ctx.fiber.dispose()
      })

    it('keeps pages projection-free and computes projections only for child authorization', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：ordinary 用于处理 ordinary 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const ordinary = await setup()
        /**
     * 常量说明：session 用于处理 session 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const session = ordinary.ctx.sessions.create(SessionId('projected'), { meta: { cwd: '/workspace' } })
        session.append('turn/start', { turn: 1 })
        /**
     * 常量说明：ordinarySnapshot 用于处理 ordinarySnapshot 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const ordinarySnapshot = vi.spyOn(ordinary.ctx.sessionProjections, 'snapshot')
        /**
     * 常量说明：ordinaryPage 用于处理 ordinaryPage 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const ordinaryPage = await ordinary.transport.page({
          address: { kind: 'session', sessionId: session.id },
          throughSeq: 0,
        }, signal())
        expect('projections' in ordinaryPage).toBe(false)
        expect(ordinarySnapshot).not.toHaveBeenCalled()

        /**
     * 常量说明：child 用于处理 child 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const child = await setup()
        /**
     * 常量说明：parentSessionId 用于处理 parentSessionId 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const parentSessionId = SessionId('projection-parent')
        /**
     * 常量说明：childSessionId 用于处理 childSessionId 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const childSessionId = SessionId('projection-child')
        /**
     * 常量说明：childSession 用于处理 childSession 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const childSession = child.ctx.sessions.create(childSessionId, {
          meta: { cwd: '/workspace', origin: 'subagent', parentSession: parentSessionId },
        })
        childSession.append('subagent/descriptor', snapshotSubagentDescriptor({
          mode: 'continuable', provider: 'test', label: 'child',
        }))
        /**
     * 常量说明：childSnapshot 用于处理 childSnapshot 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const childSnapshot = vi.spyOn(child.ctx.sessionProjections, 'snapshot')
        /**
     * 常量说明：page 用于处理 page 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const page = await child.transport.page({
          address: { kind: 'subagent', parentSessionId, childSessionId, mode: 'continuable' },
          throughSeq: 0,
        }, signal())
        expect('projections' in page).toBe(false)
        expect(childSnapshot).toHaveBeenCalledWith(childSession)
      })

    it('keeps message-aligned pagination contiguous across replacement provenance', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：ctx、transport 用于处理 ctx、transport 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const { ctx, transport } = await setup()
        /**
     * 常量说明：session 用于处理 session 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const session = ctx.sessions.create(SessionId('pagination'), { meta: { cwd: '/workspace' } })
        session.append('turn/start', { turn: 1 })
        append(session, 'user/message', { content: [], source: { kind: 'user' } }, { surfaceOp: 'append' })
        /**
     * 常量说明：firstReply 用于处理 firstReply 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const firstReply = append(session, 'assistant/message', { turn: 1, step: 1, message: {} }, { surfaceOp: 'append' })
        append(session, 'user/message', { content: [], source: { kind: 'user' } }, { surfaceOp: 'append' })
        append(session, 'assistant/message', { turn: 1, step: 2, message: {} }, { surfaceOp: 'append' })
        /**
     * 常量说明：summary 用于处理 summary 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const summary = append(session, 'fixture/summary', {})
        /**
     * 常量说明：replacement 用于处理 replacement 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const replacement = append(session, 'user/message', { content: [], source: { kind: 'plugin' } }, {
          surfaceOp: { op: 'replace', start: 1, end: 4 },
          sourceEventSeqs: [1, firstReply.seq, 3, 4, summary.seq],
        })

        /**
     * 常量说明：page 用于处理 page 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const page = await transport.page({
          address: { kind: 'session', sessionId: session.id }, throughSeq: replacement.seq, maxMessages: 2,
        }, signal())
        expect(page.records.map(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：entry（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(entry)，并按返回类型处理结果。
 */ entry => entry.event.seq))
          .toEqual([3, 4, 5, replacement.seq])
        expect(page.hasMore).toBe(true)
        /**
     * 常量说明：before 用于处理 before 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const before = await transport.page({
          address: { kind: 'session', sessionId: session.id }, throughSeq: replacement.seq, beforeSeq: 3, maxMessages: 1,
        }, signal())
        expect(before.records.map(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：entry（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(entry)，并按返回类型处理结果。
 */ entry => entry.event.seq)).toEqual([2])
      })

    it('keeps cited source events in the page that owns their appended message', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：ctx、transport 用于处理 ctx、transport 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const { ctx, transport } = await setup()
        /**
     * 常量说明：session 用于处理 session 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const session = ctx.sessions.create(SessionId('pagination-sources'), { meta: { cwd: '/workspace' } })
        /**
     * 常量说明：source 用于处理 source 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const source = append(session, 'fixture/source', {})
        append(session, 'user/message', { content: [], source: { kind: 'plugin' } }, {
          surfaceOp: 'append', sourceEventSeqs: [source.seq],
        })

        /**
     * 常量说明：page 用于处理 page 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const page = await transport.page({
          address: { kind: 'session', sessionId: session.id }, throughSeq: 1, maxMessages: 1,
        }, signal())
        expect(page.records.map(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：entry（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(entry)，并按返回类型处理结果。
 */ entry => entry.event.seq)).toEqual([0, 1])
        expect(page.hasMore).toBe(false)
      })

  })
