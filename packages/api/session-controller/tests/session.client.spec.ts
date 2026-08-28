/** Session object lifecycle, event-window transport, commands, and resync behavior.
 * @remarks 文件说明：文件职责：验证 api/session-controller 中 session client spec
 * 相关行为与失败场景。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。；产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。；
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。；
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { RemoteStreamError } from '@deepseek-ai/dsh-api-gateway/client'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import { Session, type SessionOptions } from '../src/client/sessions/session.ts'
import { FakeApiClient, deferred, err, fakeRemote, ok, remoteErr } from './fake-api.client.ts'
import { entries, ev, historyValue, plainTurn } from './event-script.client.ts'

/**
 * 常量说明：SID 用于处理 SID 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const SID = 'fk-s1' as SessionId
/**
 * 常量说明：PARENT 用于处理 PARENT 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const PARENT = 'fk-parent' as SessionId

afterEach(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {
    vi.unstubAllGlobals()
  })

/**
 * 功能说明：处理 makeSession 相关流程；使用场景由所在模块及调用位置决定。
 * @param api （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param options （SessionOptions）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。
 * @returns { api: FakeApiClient; session: Session }；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 makeSession(api, options)，并按返回类型处理结果。
 */
function makeSession(
  api = new FakeApiClient(),
  options: SessionOptions = {},
): { api: FakeApiClient; session: Session } {
  return { api, session: new Session(SID, fakeRemote(api), options) }
}

/**
 * 功能说明：处理 follow 相关流程；使用场景由所在模块及调用位置决定。
 * @param api （FakeApiClient）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param event （SessionEvent）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。
 * @returns Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 follow(api, event)，并按返回类型处理结果。
 */
function follow(
  api: FakeApiClient,
  event: SessionEvent,
): Promise<void> {
  return api.pushFollow(SID, {
    type: 'event',
    event: event as never,
  })
}

/**
 * 功能说明：处理 windowEntries 相关流程；使用场景由所在模块及调用位置决定。
 * @param session （Session）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 windowEntries(session)，并按返回类型处理结果。
 */
function windowEntries(session: Session) {
  return session.eventSource.getSnapshot().entries
}

/**
 * 功能说明：处理 eventSeqs 相关流程；使用场景由所在模块及调用位置决定。
 * @param session （Session）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns number[]；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 eventSeqs(session)，并按返回类型处理结果。
 */
function eventSeqs(session: Session): number[] {
  return windowEntries(session).map(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：entry（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(entry)，并按返回类型处理结果。
 */ entry => entry.event.seq)
}

/**
 * 功能说明：处理 histResponse 相关流程；使用场景由所在模块及调用位置决定。
 * @param events （SessionEvent[]）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。
 * @param hasMore （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 histResponse(events, hasMore)，并按返回类型处理结果。
 */
function histResponse(events: SessionEvent[], hasMore = false) {
  return Promise.resolve(ok(historyValue(events, hasMore)))
}

describe('Session open', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {
    it('keeps a bare Session blank until an authoritative lifecycle signal arrives', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {
        /**
     * 常量说明：session 用于处理 session 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const { session } = makeSession()
        expect(session.getSnapshot()).toMatchObject({ blank: true, promptAttempted: false, running: false })

        session.handleRunning(true)
        expect(session.getSnapshot()).toMatchObject({ blank: false, running: true })
      })

    it('installs the tail page: cold → loading → open with window and nodes in place', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：api、session 用于处理 api、session 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const { api, session } = makeSession()
        /**
     * 常量说明：page 用于处理 page 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const page = plainTurn(10, 3, '问', '答')
        api.onHistory = /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => histResponse(page, true)
        expect(session.getSnapshot().openState).toBe('cold')
        /**
     * 常量说明：opening 用于处理 opening 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const opening = session.open()
        expect(session.getSnapshot().openState).toBe('loading')
        await opening
        /**
     * 常量说明：snapshot 用于处理 snapshot 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const snapshot = session.getSnapshot()
        expect(snapshot.openState).toBe('open')
        expect(snapshot.hasMore).toBe(true)
        expect(eventSeqs(session)).toEqual([10, 11, 12, 13, 14, 15])
        expect(session.eventSource.getSnapshot().change).toMatchObject({ kind: 'replace' })
      })

    it('is idempotent: concurrent opens share one follow, reopening when open is a no-op', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：api、session 用于处理 api、session 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const { api, session } = makeSession()
        await Promise.all([session.open(), session.open()])
        await session.open()
        expect(api.callsOf('session.follow')).toHaveLength(1)
        expect(api.callsOf('session.history')).toEqual([])
      })

    it('lands an error result in openState=error with the RpcError kept', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：api、session 用于处理 api、session 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const { api, session } = makeSession()
        api.onHistory = /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => Promise.resolve(err({ code: 'session-not-found', message: 'gone', details: { sessionId: SID } }))
        await session.open()
        /**
     * 常量说明：snapshot 用于处理 snapshot 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const snapshot = session.getSnapshot()
        expect(snapshot.openState).toBe('error')
        expect(snapshot.openError?.code).toBe('session-not-found')
      })

    it('folds a transport throw into openState=error / internal', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：api、session 用于处理 api、session 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const { api, session } = makeSession()
        api.onHistory = /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => Promise.reject(new Error('socket died'))
        await session.open()
        expect(session.getSnapshot().openState).toBe('error')
        expect(session.getSnapshot().openError).toMatchObject({ code: 'internal', message: 'socket died' })
      })

    it('stitches live frames arriving while history is pending, dropping the page overlap', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：api、session 用于处理 api、session 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const { api, session } = makeSession()
        /**
     * 常量说明：gate 用于处理 gate 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const gate = deferred<Awaited<ReturnType<FakeApiClient['onHistory']>>>()
        api.onHistory = /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => gate.promise
        /**
     * 常量说明：opening 用于处理 opening 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const opening = session.open()
        // Three live frames land while the opening snapshot is pending; seq 15 overlaps its tail.
        /**
     * 常量说明：page 用于处理 page 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const page = plainTurn(10, 0, '早', '安')
        /**
     * 常量说明：deliveries 用于处理 deliveries 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const deliveries = [
          follow(api, ev.turnStart(15, 1)),
          follow(api, ev.user(16, '插进来的')),
        ]
        gate.resolve(ok({
          records: entries(page) as never[],
          hasMore: false,
          modelSelection: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
        }))
        await Promise.all([opening, ...deliveries])
        /**
     * 常量说明：seqs 用于处理 seqs 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const seqs = eventSeqs(session)
        // Overlapping seq-15 frame (== page tail turn/end) was dropped; 16 appended once.
        expect(seqs).toEqual([10, 11, 12, 13, 14, 15, 16])
      })
  })


describe('live event path', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {
  /**
   * 功能说明：处理 opened 相关流程；使用场景由所在模块及调用位置决定。
   * @param events （SessionEvent[]）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。
   * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 opened(events)，并按返回类型处理结果。
   */
    async function opened(events: SessionEvent[] = plainTurn(0, 0, 'a', 'b')) {
    /**
     * 常量说明：api、session 用于处理 api、session 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
      const { api, session } = makeSession()
      api.onHistory = /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => histResponse(events)
      await session.open()
      return { api, session }
    }

    it('drops replayed frames at or below the window tail', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：api、session 用于处理 api、session 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const { api, session } = await opened()
        /**
     * 常量说明：before 用于处理 before 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const before = session.eventSource.getSnapshot()
        await follow(api, ev.user(3, '重放'))
        expect(session.eventSource.getSnapshot()).toBe(before)
      })

    it('keeps the authoritative host blank bit across unrelated log events', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：api、session 用于处理 api、session 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const { api, session } = await opened([])
        session.handleBlank(true)
        await Promise.all([
          follow(api, ev.commandRun(0, 'cmd-perm', 'permission', ' danger-full-access')),
          follow(api, ev.commandDone(1, 'cmd-perm', 'success', 'preset danger-full-access')),
        ])
        /**
     * 常量说明：snapshot 用于处理 snapshot 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const snapshot = session.getSnapshot()
        expect(eventSeqs(session)).toEqual([0, 1])
        expect(snapshot.blank).toBe(true)
      })

    it('repairs a seq gap by repulling the tail page instead of appending a hole', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：api、session 用于处理 api、session 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const { api, session } = await opened(plainTurn(0, 0, 'a', 'b')) // tail seq = 5
        /**
     * 常量说明：repaired 用于处理 repaired 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const repaired = [...plainTurn(0, 0, 'a', 'b'), ...plainTurn(6, 1, 'c', 'd')]
        api.onHistory = /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => histResponse(repaired)
        // seq 9 with tail 5 → gap; the event detours to the buffer and one history refetch fires.
        await follow(api, ev.assistant(9, 1, 'd'))
        await vi.waitFor(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {
            expect(api.callsOf('session.history')).toHaveLength(1)
          })
        await vi.waitFor(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {
            expect(eventSeqs(session)).toEqual(
              repaired.filter(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：event（由 TypeScript
 * 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(event)，并按返回类型处理结果。
 */ event => event.seq <= 9).map(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：event（由 TypeScript
 * 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(event)，并按返回类型处理结果。
 */ event => event.seq),
            )
          })
      })
  })

describe('paging', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {
    it('prepends an older page and keeps seq continuity', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：older 用于处理 older 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const older = plainTurn(0, 0, '旧问', '旧答')
        /**
     * 常量说明：newer 用于处理 newer 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const newer = plainTurn(6, 1, '新问', '新答')
        /**
     * 常量说明：api、session 用于处理 api、session 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const { api, session } = makeSession()
        api.onHistory = /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：payload（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(payload)，并按返回类型处理结果。
 */ payload => payload.beforeSeq === undefined
            ? histResponse(newer, true)
            : histResponse(older, false)
        await session.open()
        await session.loadOlder()
        /**
     * 常量说明：snapshot 用于处理 snapshot 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const snapshot = session.getSnapshot()
        expect(api.callsOf('session.follow')).toHaveLength(1)
        expect(api.callsOf('session.history')).toMatchObject([
          { sessionId: SID, throughSeq: 11, beforeSeq: 6 },
        ])
        expect(snapshot.hasMore).toBe(false)
        expect(eventSeqs(session)).toEqual([...older, ...newer].map(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：event（由 TypeScript
 * 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(event)，并按返回类型处理结果。
 */ event => event.seq))
      })

    it('installs a page without interpreting business replacement metadata', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：api、session 用于处理 api、session 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const { api, session } = makeSession()
        api.onHistory = /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => histResponse([
            ev.compactSummary(80, '窗外范围的摘要', 3, 40),
            ev.compactCheckpoint(81, 80, 3, 40),
            ev.user(82, '压缩后的新问题'),
          ], true)
        /**
     * 常量说明：errorSpy 用于处理 errorSpy 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => undefined)
        try {
          await session.open()
          /**
       * 常量说明：snapshot 用于处理 snapshot 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
          const snapshot = session.getSnapshot()
          expect(snapshot.openState).toBe('open')
          expect(eventSeqs(session)).toEqual([80, 81, 82])
          expect(errorSpy).not.toHaveBeenCalled()
        } finally {
          errorSpy.mockRestore()
        }
      })

    it('drops a discontinuous older page fail-soft (window unchanged, hasMore cleared)', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：api、session 用于处理 api、session 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const { api, session } = makeSession()
        api.onHistory = /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：payload（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(payload)，并按返回类型处理结果。
 */ payload => payload.beforeSeq === undefined
            ? histResponse(plainTurn(10, 1, '新', '页'), true)
            : histResponse(plainTurn(0, 0, '断', '层'), true) // tail seq 5, but baseSeq is 10 → hole
        /**
     * 常量说明：errorSpy 用于处理 errorSpy 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => undefined)
        try {
          await session.open()
          /**
       * 常量说明：windowBefore 用于处理 windowBefore 相关数据，作用于当前作用域；初始化后不可重新赋值，
       * 但对象内部是否可变仍由其类型决定。
       */
          const windowBefore = session.eventSource.getSnapshot()
          await session.loadOlder()
          /**
       * 常量说明：snapshot 用于处理 snapshot 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
          const snapshot = session.getSnapshot()
          expect(session.eventSource.getSnapshot().entries).toEqual(windowBefore.entries)
          expect(snapshot.hasMore).toBe(false)
        } finally {
          errorSpy.mockRestore()
        }
      })

    it('ignores loadOlder while one is in flight (single request)', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：api、session 用于处理 api、session 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const { api, session } = makeSession()
        api.onHistory = /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => histResponse(plainTurn(6, 1, 'x', 'y'), true)
        await session.open()
        /**
     * 常量说明：gate 用于处理 gate 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const gate = deferred<Awaited<ReturnType<FakeApiClient['onHistory']>>>()
        api.onHistory = /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => gate.promise
        /**
     * 常量说明：first 用于处理 first 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const first = session.loadOlder()
        /**
     * 常量说明：second 用于处理 second 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const second = session.loadOlder()
        gate.resolve(ok({
          records: entries(plainTurn(0, 0, 'a', 'b')) as never[],
          hasMore: false,
          modelSelection: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
        }))
        await Promise.all([first, second])
        expect(api.callsOf('session.follow')).toHaveLength(1)
        expect(api.callsOf('session.history')).toHaveLength(1)
      })
  })

describe('prompt and cancel errors', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {
    it('routes an addressed child through non-activating history, continuation prompt, and interrupt only', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：api 用于处理 api 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const api = new FakeApiClient()
        /**
     * 常量说明：session 用于处理 session 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const session = new Session(SID, fakeRemote(api), {
          address: { parentSessionId: PARENT, childSessionId: SID, mode: 'continuable' },
          parentAvailable: true,
        })
        await session.open()
        /**
     * 常量说明：prompted 用于处理 prompted 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const prompted = await session.prompt([{ type: 'text', text: '继续' }], 'queue')
        /**
     * 常量说明：cancelled 用于处理 cancelled 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const cancelled = await session.cancel()

        expect(prompted).toEqual({ ok: true, value: { accepted: true } })
        expect(cancelled).toEqual({ ok: true, value: { accepted: true } })
        expect(api.callsOf('session.follow')).toEqual([
          {
            address: {
              kind: 'subagent', parentSessionId: PARENT, childSessionId: SID, mode: 'continuable',
            },
            maxMessages: 50,
          },
        ])
        expect(api.callsOf('subagent.history')).toEqual([])
        expect(api.callsOf('subagents.prompt')).toEqual([
          {
            requestId: expect.any(String) as unknown as string,
            parentSessionId: PARENT, childSessionId: SID,
            mode: 'continuable',
            content: [{ type: 'text', text: '继续' }],
            clientTimeZone: new Intl.DateTimeFormat().resolvedOptions().timeZone,
          },
        ])
        expect(api.callsOf('subagents.interruptByParent')).toEqual([
          { childSessionId: SID, parentSessionId: PARENT, mode: 'continuable' },
        ])
        expect(api.callsOf('session.history')).toEqual([])
        expect(api.callsOf('session.prompt')).toEqual([])
        expect(api.callsOf('session.cancel')).toEqual([])
        // A successful interrupt leaves no stop error behind.
        expect(session.getSnapshot().promptError).toBeNull()
        expect(session.getSnapshot().subagent).toEqual({
          address: { parentSessionId: PARENT, childSessionId: SID, mode: 'continuable' },
          parentAvailable: true,
        })
      })

    it('lands an interrupt business failure in promptError with op=stop', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：api 用于处理 api 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const api = new FakeApiClient()
        api.onSubagentInterrupt = /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => Promise.resolve(remoteErr({
            code: 'subagent-unauthorized', message: 'nope', details: { childSessionId: SID },
          }))
        /**
     * 常量说明：session 用于处理 session 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const session = new Session(SID, fakeRemote(api), {
          address: { parentSessionId: PARENT, childSessionId: SID, mode: 'continuable' },
          parentAvailable: true,
        })
        await session.open()
        /**
     * 常量说明：cancelled 用于处理 cancelled 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const cancelled = await session.cancel()
        expect(cancelled).toMatchObject({ ok: false, error: { code: 'subagent-unauthorized' } })
        expect(session.getSnapshot().promptError).toMatchObject({
          op: 'stop', error: { code: 'subagent-unauthorized' },
        })
      })

    it('keeps one-shot history readable without exposing prompt or cancel transport', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：api 用于处理 api 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const api = new FakeApiClient()
        /**
     * 常量说明：session 用于处理 session 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const session = new Session(SID, fakeRemote(api), {
          address: { parentSessionId: PARENT, childSessionId: SID, mode: 'one-shot' },
        })
        await session.open()
        /**
     * 常量说明：prompted 用于处理 prompted 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const prompted = await session.prompt([{ type: 'text', text: '继续' }], 'queue')
        /**
     * 常量说明：cancelled 用于处理 cancelled 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const cancelled = await session.cancel()

        expect(prompted).toMatchObject({ ok: false, error: { code: 'subagent-not-resumable' } })
        expect(cancelled).toMatchObject({ ok: false, error: { code: 'subagent-delivery-unavailable' } })
        expect(api.callsOf('session.follow')).toEqual([
          {
            address: {
              kind: 'subagent', parentSessionId: PARENT, childSessionId: SID, mode: 'one-shot',
            },
            maxMessages: 50,
          },
        ])
        expect(api.callsOf('subagent.history')).toEqual([])
        expect(api.callsOf('subagents.prompt')).toEqual([])
        expect(api.callsOf('subagents.interruptByParent')).toEqual([])
        expect(api.callsOf('session.cancel')).toEqual([])
      })

    it('publishes the first-prompt lifecycle synchronously before the Remote settles', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：api、session 用于处理 api、session 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const { api, session } = makeSession()
        session.handleBlank(true)
        expect(session.getSnapshot()).toMatchObject({
          blank: true, promptAttempted: false, awaitingFirstTurn: false,
        })
        /**
     * 常量说明：inFlight 用于处理 inFlight 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const inFlight = session.prompt([{ type: 'text', text: '要发的' }], 'queue')
        expect(session.getSnapshot()).toMatchObject({
          blank: true, promptAttempted: true, awaitingFirstTurn: true,
        })
        /**
     * 常量说明：result 用于处理 result 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const result = await inFlight
        expect(result.ok).toBe(true)
        expect(session.getSnapshot()).toMatchObject({
          blank: false, promptAttempted: true, awaitingFirstTurn: true,
        })
        expect(api.callsOf('session.prompt')).toMatchObject([{
          sessionId: SID,
          mode: 'queue',
          content: [{ type: 'text', text: '要发的' }],
          clientTimeZone: new Intl.DateTimeFormat().resolvedOptions().timeZone,
        }])
        session.handleRunning(true)
        expect(session.getSnapshot()).toMatchObject({ running: true, awaitingFirstTurn: false })
      })

    it('keeps the attempted-first-prompt state when the Host rejects the prompt', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：api、session 用于处理 api、session 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const { api, session } = makeSession()
        session.handleBlank(true)
        api.onPrompt = /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => Promise.resolve(err({ code: 'agent-busy', message: 'busy', details: { reason: 'x' } }))
        /**
     * 常量说明：result 用于处理 result 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const result = await session.prompt([{ type: 'text', text: '失败的' }], 'queue')
        expect(result.ok).toBe(false)
        expect(session.getSnapshot().promptError).toMatchObject({ op: 'send', error: { code: 'agent-busy' } })
        expect(session.getSnapshot()).toMatchObject({
          blank: true, promptAttempted: true, awaitingFirstTurn: true,
        })
      })

    it('lands cancel failures in promptError with op=stop', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：api、session 用于处理 api、session 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const { api, session } = makeSession()
        api.onCancel = /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => Promise.reject(new Error('cancel transport down'))
        /**
     * 常量说明：result 用于处理 result 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const result = await session.cancel()
        expect(result.ok).toBe(false)
        expect(session.getSnapshot().promptError).toMatchObject({ op: 'stop', error: { code: 'internal' } })
      })

    it('reads session-authorized attachment bytes and keeps the opaque id on the wire', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：api、session 用于处理 api、session 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const { api, session } = makeSession()
        /**
     * 常量说明：result 用于处理 result 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const result = await session.readAttachment('attachment-1' as never)
        expect(result).toEqual({
          ok: true,
          value: {
            attachment: { attachmentId: 'a', mediaType: 'image/png', bytes: 1, width: 1, height: 1 },
            data: Uint8Array.of(0),
          },
        })
        expect(api.callsOf('session.attachment')).toEqual([{
          sessionId: SID, attachmentId: 'attachment-1',
        }])
      })
  })

describe('rename', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {
    it('settles the title projection cell from the unary response (higher-seq-wins vs the push frame)', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：api、session 用于处理 api、session 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const { api, session } = makeSession()
        api.onRename = /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => Promise.resolve(ok({ title: '正名', seq: 7 }))
        /**
     * 常量说明：result 用于处理 result 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const result = await session.rename('  正名  ')
        expect(result).toMatchObject({ ok: true, value: { title: '正名', seq: 7 } })
        expect(api.callsOf('session.rename')).toMatchObject([{ sessionId: SID, title: '  正名  ' }])
        expect(session.projections.faceOf('title').getSnapshot()).toBe('正名')
        // A stale lower-seq apply (the push-frame path routes into this same
        // store) must not roll the settled value back.
        session.projections.apply('title', '旧名', 3)
        expect(session.projections.faceOf('title').getSnapshot()).toBe('正名')
      })

    it('returns the business error untouched and folds a transport throw to internal', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：api、session 用于处理 api、session 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const { api, session } = makeSession()
        api.onRename = /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => Promise.resolve(err({
            code: 'title-invalid', message: 'empty', details: { sessionId: SID },
          } as never))
        /**
     * 常量说明：rejected 用于处理 rejected 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const rejected = await session.rename('   ')
        expect(rejected).toMatchObject({ ok: false, error: { code: 'title-invalid' } })
        expect(session.projections.faceOf('title').getSnapshot()).toBeUndefined()
        api.onRename = /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => Promise.reject(new Error('rename transport down'))
        /**
     * 常量说明：folded 用于处理 folded 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const folded = await session.rename('x')
        expect(folded).toMatchObject({ ok: false, error: { code: 'internal' } })
      })
  })

describe('remaining branches', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {
    it('prompt transport throw folds to internal promptError', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：api、session 用于处理 api、session 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const { api, session } = makeSession()
        api.onPrompt = /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => Promise.reject(new Error('prompt wire down'))
        /**
     * 常量说明：result 用于处理 result 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const result = await session.prompt([{ type: 'text', text: 'x' }], 'queue')
        expect(result.ok).toBe(false)
        expect(session.getSnapshot().promptError).toMatchObject({ op: 'send', error: { code: 'internal', message: 'prompt wire down' } })
      })

    it('cancel business error also lands op=stop promptError', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：api、session 用于处理 api、session 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const { api, session } = makeSession()
        api.onCancel = /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => Promise.resolve(err({ code: 'agent-busy', message: 'nope', details: { reason: 'r' } }))
        await session.cancel()
        expect(session.getSnapshot().promptError).toMatchObject({ op: 'stop', error: { code: 'agent-busy' } })
      })

    it('loadOlder guards: not-open/no-hasMore no-op, err result kept window, empty page updates hasMore, throw fail-soft', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：api、session 用于处理 api、session 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const { api, session } = makeSession()
        await session.loadOlder() // cold: no-op, zero calls
        expect(api.calls).toEqual([])
        api.onHistory = /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => histResponse(plainTurn(6, 1, 'x', 'y'), true)
        await session.open()
        // err result: window unchanged
        api.onHistory = /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => Promise.resolve(err({ code: 'internal', message: 'x', details: {} }))
        await session.loadOlder()
        expect(eventSeqs(session)).toHaveLength(6)
        expect(session.getSnapshot().hasMore).toBe(true)
        // empty page: hasMore adopts the response
        api.onHistory = /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => histResponse([], false)
        await session.loadOlder()
        expect(session.getSnapshot().hasMore).toBe(false)
        // hasMore false now: further loadOlder is a guard no-op
        /**
     * 常量说明：calls 用于处理 calls 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const calls = api.calls.length
        await session.loadOlder()
        expect(api.calls.length).toBe(calls)
        // throw path: fail-soft with console.error
        /**
     * 常量说明：errorSpy 用于处理 errorSpy 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => undefined)
        try {
          await session.resync()
          api.onHistory = /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => histResponse(plainTurn(6, 1, 'x', 'y'), true)
          await session.resync()
          api.onHistory = /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => Promise.reject(new Error('page wire down'))
          await session.loadOlder()
          expect(errorSpy).toHaveBeenCalled()
          expect(session.getSnapshot().loadingOlder).toBe(false)
        } finally {
          errorSpy.mockRestore()
        }
      })

    it('subscribe delivers snapshot-change notifications and unsubscribes', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：api、session 用于处理 api、session 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const { api, session } = makeSession()
        api.onHistory = /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => histResponse(plainTurn(0, 0, 'a', 'b'))
        /**
     * 变量说明：notified 用于处理 notified 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
        let notified = 0
        /**
     * 常量说明：unsubscribe 用于处理 unsubscribe 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const unsubscribe = session.subscribe(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => { notified++ })
        await session.open()
        await new Promise(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolve（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(resolve)，并按返回类型处理结果。
 */ resolve => setTimeout(resolve, 0))
        expect(notified).toBeGreaterThan(0)
        /**
     * 常量说明：seen 用于处理 seen 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const seen = notified
        unsubscribe()
        session.handleRunning(true) // any snapshot mutation; the listener must stay silent
        await new Promise(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolve（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(resolve)，并按返回类型处理结果。
 */ resolve => setTimeout(resolve, 0))
        expect(notified).toBe(seen)
      })

    it('rejects an opening page that does not end at the opening cursor', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：api、session 用于处理 api、session 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const { api, session } = makeSession()
        /**
     * 变量说明：call 用于处理 call 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
        let call = 0
        api.onHistory = /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {
            call++
            return histResponse(plainTurn(0, 0, 'a', 'b'))
          }
        api.followCursor = 11
        await session.open()
        expect(call).toBe(1)
        /**
     * 常量说明：snapshot 用于处理 snapshot 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const snapshot = session.getSnapshot()
        expect(snapshot.openState).toBe('error')
        expect(snapshot.openError).toMatchObject({
          code: 'internal', message: 'session event stream page did not end at its requested cursor',
        })
        expect(eventSeqs(session)).toEqual([])
      })

    it('deduplicates repeated running flips and records removal', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {
        /**
     * 常量说明：session 用于处理 session 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const { session } = makeSession()
        /**
     * 常量说明：before 用于处理 before 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const before = session.getSnapshot()
        session.handleRunning(false) // already false: dedup branch
        expect(session.getSnapshot()).toBe(before)
        session.handleRemoved()
        expect(session.getSnapshot().removed).toBe(true)
      })

    it('drops live events while cold/error (no window upkeep)', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：api、session 用于处理 api、session 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const { api, session } = makeSession()
        await follow(api, ev.user(0, '冷态帧'))
        expect(eventSeqs(session)).toEqual([])
        api.onHistory = /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => Promise.resolve(err({ code: 'internal', message: 'x', details: {} }))
        await session.open()
        await follow(api, ev.user(0, '错态帧'))
        expect(eventSeqs(session)).toEqual([])
      })

    it('preserves a Host-reported failure that terminates the live source', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：api、session 用于处理 api、session 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const { api, session } = makeSession()
        api.onHistory = /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => histResponse(plainTurn(0, 0, 'a', 'b'))
        await session.open()
        /**
     * 常量说明：failure 用于处理 failure 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const failure = {
          code: 'session-not-found',
          message: 'session disappeared',
          details: { sessionId: SID },
        }

        api.failStreams(new RemoteStreamError(failure.code, failure.message, failure.details))
        await vi.waitFor(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => { expect(session.getSnapshot().openState).toBe('error') })

        expect(session.getSnapshot().openError).toEqual(failure)
      })

    it('coalesces queued gap frames behind one repair and exposes a failed repair', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：api、session 用于处理 api、session 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const { api, session } = makeSession()
        api.onHistory = /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => histResponse(plainTurn(0, 0, 'a', 'b'))
        await session.open()
        /**
     * 常量说明：gate 用于处理 gate 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const gate = deferred<Awaited<ReturnType<FakeApiClient['onHistory']>>>()
        /**
     * 变量说明：repairs 用于处理 repairs 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
        let repairs = 0
        api.onHistory = /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {
            repairs++
            return gate.promise
          }
        /**
     * 常量说明：deliveries 用于处理 deliveries 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const deliveries = Promise.all([
          follow(api, ev.user(9, '洞一')),
          follow(api, ev.user(10, '洞二')),
        ])
        await vi.waitFor(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => { expect(repairs).toBe(1) })
        gate.reject(new Error('repair wire down'))
        await deliveries
        await vi.waitFor(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => { expect(session.getSnapshot().openState).toBe('error') })
        expect(session.getSnapshot().openError).toMatchObject({ code: 'internal', message: 'repair wire down' })
        expect(eventSeqs(session)).toHaveLength(6)
      })

    it('doOpen transport throw of a stale generation is swallowed (generation guard in catch)', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：api、session 用于处理 api、session 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const { api, session } = makeSession()
        /**
     * 常量说明：stale 用于处理 stale 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const stale = deferred<Awaited<ReturnType<FakeApiClient['onHistory']>>>()
        api.onHistory = /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => stale.promise
        /**
     * 常量说明：opening 用于处理 opening 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const opening = session.open()
        api.onHistory = /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => histResponse(plainTurn(0, 0, 'a', 'b'))
        /**
     * 常量说明：resynced 用于处理 resynced 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const resynced = session.resync()
        stale.reject(new Error('stale wire'))
        await Promise.all([opening, resynced])
        expect(session.getSnapshot().openState).toBe('open') // stale catch did not write error
      })

    it('drops a stale doOpen whose history resolved successfully after resync superseded it', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：api、session 用于处理 api、session 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const { api, session } = makeSession()
        /**
     * 常量说明：stale 用于处理 stale 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const stale = deferred<Awaited<ReturnType<FakeApiClient['onHistory']>>>()
        api.onHistory = /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => stale.promise
        /**
     * 常量说明：opening 用于处理 opening 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const opening = session.open()
        api.onHistory = /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => histResponse(plainTurn(6, 1, '新', '代'))
        /**
     * 常量说明：resynced 用于处理 resynced 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const resynced = session.resync()
        stale.resolve(ok({
          records: entries(plainTurn(0, 0, '旧', '代')) as never[],
          hasMore: false,
          modelSelection: { provider: 'deepseek-official', model: 'stale' },
        })) // success, but its generation is gone
        await Promise.all([opening, resynced])
        expect(eventSeqs(session)).toEqual(plainTurn(6, 1, '新', '代').map(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：event（由 TypeScript
 * 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(event)，并按返回类型处理结果。
 */ event => event.seq))
      })

    it('drops a gap repair superseded by a full resync while its pull was in flight', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：api、session 用于处理 api、session 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const { api, session } = makeSession()
        api.onHistory = /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => histResponse(plainTurn(0, 0, 'a', 'b'))
        await session.open()
        /**
     * 常量说明：repairPull 用于处理 repairPull 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const repairPull = deferred<Awaited<ReturnType<FakeApiClient['onHistory']>>>()
        api.onHistory = /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => repairPull.promise
        /**
     * 常量说明：delivery 用于处理 delivery 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const delivery = follow(api, ev.user(9, '洞'))
        await vi.waitFor(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => { expect(api.callsOf('session.history')).toHaveLength(1) })
        api.onHistory = /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => histResponse(plainTurn(6, 1, 'c', 'd'))
        /**
     * 常量说明：resynced 用于处理 resynced 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const resynced = session.resync() // bumps the generation
        repairPull.resolve(ok({
          records: entries(plainTurn(0, 0, '旧', '页')) as never[],
          hasMore: false,
          modelSelection: { provider: 'deepseek-official', model: 'stale' },
        })) // repair result: stale, dropped
        await Promise.all([delivery, resynced])
        expect(eventSeqs(session)).toEqual(plainTurn(6, 1, 'c', 'd').map(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：event（由 TypeScript
 * 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(event)，并按返回类型处理结果。
 */ event => event.seq))
      })

    it('successful cancel leaves no promptError', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：api、session 用于处理 api、session 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const { api, session } = makeSession()
        api.onHistory = /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => histResponse(plainTurn(0, 0, 'a', 'b'))
        await session.open()
        /**
     * 常量说明：result 用于处理 result 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const result = await session.cancel()
        expect(result.ok).toBe(true)
        expect(session.getSnapshot().promptError).toBeNull()
      })

    it('dispose is a reserved no-op on resident instances', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：session 用于处理 session 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const { session } = makeSession()
        await expect(session.dispose()).resolves.toBeUndefined()
      })

    it('carries raw history and follow events through the event feed', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：api、session 用于处理 api、session 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const { api, session } = makeSession()
        /**
     * 常量说明：historyCall 用于处理 historyCall 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const historyCall = ev.toolCall(6, 1, 'h1', 'bash', '{"cmd":"pwd"}')
        /**
     * 常量说明：historyResult 用于处理 historyResult 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const historyResult = ev.toolResult(7, 1, 'h1', 'done')
        api.onHistory = /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => Promise.resolve(ok({
            records: [
              ...entries(plainTurn(0, 0, 'a', 'b')),
              { type: 'event', event: historyCall },
              { type: 'event', event: historyResult },
            ] as never[],
            hasMore: false,
            modelSelection: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
          }))
        await session.open()
        expect(windowEntries(session).slice(-2)).toEqual([
          { type: 'event', event: historyCall },
          { type: 'event', event: historyResult },
        ])
        /**
     * 常量说明：liveCall 用于处理 liveCall 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const liveCall = ev.toolCall(8, 2, 'l1', 'write', '{"file_path":"a.ts"}')
        await follow(api, liveCall)
        expect(windowEntries(session).at(-1)).toEqual({ type: 'event', event: liveCall })
        /**
     * 常量说明：liveResult 用于处理 liveResult 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const liveResult = ev.toolResult(9, 2, 'l1', 'ok')
        await follow(api, liveResult)
        expect(windowEntries(session).at(-1)).toEqual({ type: 'event', event: liveResult })
      })
  })

describe('resync', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {
    it('keeps the old feed until the reconnect snapshot, then repairs queued live gaps', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：api、session 用于处理 api、session 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const { api, session } = makeSession()
        api.onHistory = /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => histResponse(plainTurn(0, 0, '旧', '窗'))
        await session.open()
        /**
     * 常量说明：oldWindow 用于处理 oldWindow 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const oldWindow = session.eventSource.getSnapshot()
        /**
     * 常量说明：replacement 用于处理 replacement 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const replacement = deferred<Awaited<ReturnType<FakeApiClient['onHistory']>>>()
        api.followCursor = 15
        api.onHistory = /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => replacement.promise
        /**
     * 常量说明：publications 用于处理 publications 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const publications: ReturnType<Session['eventSource']['getSnapshot']>[] = []
        /**
     * 常量说明：off 用于处理 off 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const off = session.eventSource.subscribe(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {
            publications.push(session.eventSource.getSnapshot())
          })

        /**
     * 常量说明：syncing 用于处理 syncing 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const syncing = session.resync()
        await vi.waitFor(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => { expect(api.callsOf('session.follow')).toHaveLength(2) })
        expect(session.eventSource.getSnapshot()).toBe(oldWindow)
        expect(publications).toEqual([])

        api.onHistory = /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => histResponse([
            ...plainTurn(10, 2, '终', '页'),
            ev.user(16, '后到低位'),
            ev.user(17, '后到高位'),
          ])
        /**
     * 常量说明：liveDeliveries 用于处理 liveDeliveries 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const liveDeliveries = Promise.all([
          follow(api, ev.user(17, '后到高位')),
          follow(api, ev.user(16, '后到低位')),
        ])
        expect(session.eventSource.getSnapshot()).toBe(oldWindow)
        replacement.resolve(ok({
          records: entries(plainTurn(10, 2, '终', '页')) as never[],
          hasMore: false,
          modelSelection: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
        }))
        await Promise.all([syncing, liveDeliveries])
        await vi.waitFor(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {
            expect(eventSeqs(session)).toEqual([10, 11, 12, 13, 14, 15, 16, 17])
          })

        expect(publications).toHaveLength(2)
        expect(publications.map(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：snapshot（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(snapshot)，并按返回类型处理结果。
 */ snapshot => snapshot.change.kind)).toEqual(['replace', 'replace'])
        expect(publications[0]?.entries.map(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：entry（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(entry)，并按返回类型处理结果。
 */ entry => entry.event.seq)).toEqual([10, 11, 12, 13, 14, 15])
        expect(publications[1]?.entries.map(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：entry（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(entry)，并按返回类型处理结果。
 */ entry => entry.event.seq)).toEqual([10, 11, 12, 13, 14, 15, 16, 17])
        off()
      })

    it('rebuilds the window without clearing control state; cold instances no-op', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：api、session 用于处理 api、session 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const { api, session } = makeSession()
        api.onHistory = /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => histResponse(plainTurn(0, 0, 'a', 'b'))
        await session.open()
        session.handleRunning(true)
        session.handleAgentError('still visible')
        api.onHistory = /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => histResponse([...plainTurn(0, 0, 'a', 'b'), ...plainTurn(6, 1, 'c', 'd')])
        await session.resync()
        /**
     * 常量说明：snapshot 用于处理 snapshot 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const snapshot = session.getSnapshot()
        expect(snapshot.openState).toBe('open')
        expect(snapshot.running).toBe(true)
        expect(snapshot.lastAgentError).toBe('still visible')
        expect(eventSeqs(session)).toHaveLength(12)

        /**
     * 常量说明：cold 用于处理 cold 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const cold = makeSession()
        await cold.session.resync()
        expect(cold.api.calls).toEqual([]) // never opened: no traffic
      })

    it('drops a stale in-flight open superseded by resync (generation guard)', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：api、session 用于处理 api、session 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const { api, session } = makeSession()
        /**
     * 常量说明：stale 用于处理 stale 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const stale = deferred<Awaited<ReturnType<FakeApiClient['onHistory']>>>()
        api.onHistory = /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => stale.promise
        /**
     * 常量说明：firstOpen 用于处理 firstOpen 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const firstOpen = session.open()
        api.onHistory = /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => histResponse(plainTurn(6, 1, '新', '代'))
        /**
     * 常量说明：resynced 用于处理 resynced 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const resynced = session.resync()
        stale.reject(new Error('dead connection')) // the doomed pre-disconnect request fails late
        await firstOpen
        await resynced
        /**
     * 常量说明：snapshot 用于处理 snapshot 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const snapshot = session.getSnapshot()
        expect(snapshot.openState).toBe('open') // stale failure did not settle the fresh generation into error
        expect(eventSeqs(session)).toEqual(plainTurn(6, 1, '新', '代').map(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：event（由 TypeScript
 * 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(event)，并按返回类型处理结果。
 */ event => event.seq))
      })

  })

describe('snapshot ownership', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {
    it('publishes event-window appends without changing an unrelated Session snapshot', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：api、session 用于处理 api、session 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const { api, session } = makeSession()
        api.onHistory = /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => histResponse(plainTurn(0, 0, '稳', '定'))
        await session.open()
        /**
     * 常量说明：sessionBefore 用于处理 sessionBefore 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const sessionBefore = session.getSnapshot()
        /**
     * 常量说明：windowBefore 用于处理 windowBefore 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const windowBefore = session.eventSource.getSnapshot()
        /**
     * 常量说明：firstEntry 用于处理 firstEntry 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const firstEntry = windowBefore.entries[0]
        await follow(api, ev.user(6, '追加'))
        /**
     * 常量说明：windowAfter 用于处理 windowAfter 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const windowAfter = session.eventSource.getSnapshot()
        expect(session.getSnapshot()).toBe(sessionBefore)
        expect(windowAfter).not.toBe(windowBefore)
        expect(windowAfter.entries[0]).toBe(firstEntry)
        expect(windowAfter.change).toMatchObject({ kind: 'append' })
      })
  })
