/**
 * 文件职责：验证 api/session-controller 中 transport client spec 相关行为与失败场景。
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。
 * 产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 */
import { describe, expect, it, vi } from 'vitest'
import {
  RemoteStream,
  RemoteStreamCarrierError,
  RemoteStreamError,
  type RemoteStreamOptions,
} from '@deepseek-ai/dsh-api-gateway/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import {
  createSessionControlStream,
  SessionEventStream,
  sessionStreamFailure,
  type SessionJournalChange,
  type SessionRemote,
} from '../src/client/index.ts'
import type {
  SessionAddress,
  SessionControlFrame,
  SessionEventEntry,
  SessionFollowFrame,
  SessionFollowRequest,
  SessionHistoryRecord,
  SessionPage,
  SessionPageRequest,
} from '../src/types.ts'

type SessionTransportRemote = Pick<SessionRemote, 'control' | 'follow' | 'page'>

/**
 * 常量说明：ADDRESS 用于处理 ADDRESS 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const ADDRESS: SessionAddress = { kind: 'session', sessionId: 'session-1' as never }
/**
 * 常量说明：AVAILABLE_CONNECTION 用于处理 AVAILABLE_CONNECTION 相关数据，作用于当前作用域；
 * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const AVAILABLE_CONNECTION = {
  generation: {
    getSnapshot: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => ({ id: 1, host: { home: '/home/fixture' } }),
    subscribe: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {},
  },
}

/**
 * 功能说明：处理 entry 相关流程；使用场景由所在模块及调用位置决定。
 * @param seq （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns SessionEventEntry；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 entry(seq)，并按返回类型处理结果。
 */
function entry(seq: number): SessionEventEntry {
  return { type: 'event', event: { type: 'turn/start', seq, time: seq, data: { turn: seq } } }
}

/**
 * 功能说明：处理 chunks 相关流程；使用场景由所在模块及调用位置决定。
 * @param seq0 （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns SessionHistoryRecord；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 chunks(seq0)，并按返回类型处理结果。
 */
function chunks(seq0: number): SessionHistoryRecord {
  return {
    type: 'chunks',
    event: {
      type: 'chunkrow/text-chunks',
      seq: seq0,
      time: seq0,
      data: { turn: 1, step: 1, index: 0, texts: ['a', 'b', 'c'], dt: [1, 1] },
    },
  }
}

/**
 * 功能说明：处理 page 相关流程；使用场景由所在模块及调用位置决定。
 * @param records （readonly SessionHistoryRecord[]）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。
 * @param hasMore （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns SessionPage；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 page(records, hasMore)，并按返回类型处理结果。
 */
function page(records: readonly SessionHistoryRecord[], hasMore = false): SessionPage {
  return { records, hasMore }
}

/**
 * 功能说明：处理 snapshot 相关流程；使用场景由所在模块及调用位置决定。
 * @param cursor （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param records （readonly SessionHistoryRecord[]）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。
 * @param hasMore （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns SessionFollowFrame；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 snapshot(cursor, records, hasMore)，并按返回类型处理结果。
 */
function snapshot(
  cursor: number,
  records: readonly SessionHistoryRecord[],
  hasMore = false,
): SessionFollowFrame {
  return {
    type: 'snapshot',
    header: {
      version: 0,
      id: ADDRESS.kind === 'session' ? ADDRESS.sessionId : ADDRESS.childSessionId,
      createdAt: 0,
    },
    cursor,
    records,
    hasMore,
    projections: { asOfSeq: cursor, values: {} },
  }
}

/**
 * 功能说明：处理 sessionClient 相关流程；使用场景由所在模块及调用位置决定。
 * @param remote （SessionTransportRemote）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 sessionClient(remote)，并按返回类型处理结果。
 */
function sessionClient(remote: SessionTransportRemote) {
  return {
    session: remote as SessionRemote,
    $stream: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：options（RemoteStreamOptions<Item>
 * ）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(options)，并按返回类型处理结果。
 */ <Item>(options: RemoteStreamOptions<Item>) => (
      new RemoteStream(AVAILABLE_CONNECTION, options)
    ),
  }
}

interface FollowGeneration {
  readonly frames: readonly SessionFollowFrame[]
  readonly terminal?: Error
  readonly hold?: boolean
  readonly waitAfterFrames?: Promise<void>
}

/**
 * 类说明：ScriptedSessionRemote 用于集中封装 处理 ScriptedSessionRemote 相关状态与行为。
 * 核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。
 * 使用场景：由 api/session-controller 在对应插件或业务生命周期内创建和调用。
 */
class ScriptedSessionRemote implements SessionTransportRemote {
  /**
   * 常量说明：followRequests 用于处理 followRequests 相关数据，作用于成员；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  readonly followRequests: SessionFollowRequest[] = []
  /**
   * 常量说明：pageRequests 用于处理 pageRequests 相关数据，作用于成员；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  readonly pageRequests: SessionPageRequest[] = []
  /**
   * 常量说明：signals 用于处理 signals 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  readonly signals: AbortSignal[] = []

  /**
   * 功能说明：处理 ScriptedSessionRemote 相关流程；使用场景由所在模块及调用位置决定。
   * @param generations （FollowGeneration[]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param pages （RemoteResult<SessionPage>[]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param controlFrames （readonly SessionControlFrame[]）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。
   * @param holdControl （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。
   * @returns 当前类实例；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 通过 new ScriptedSessionRemote(generations, pages, controlFrames,
   * holdControl) 创建实例，并在所属生命周期内使用。
   */
  constructor(
    private readonly generations: FollowGeneration[],
    private readonly pages: RemoteResult<SessionPage>[],
    private readonly controlFrames: readonly SessionControlFrame[] = [],
    private readonly holdControl = true,
  ) {}

  /**
   * 功能说明：处理 follow 相关流程；使用场景由所在模块及调用位置决定。
   * @param request （SessionFollowRequest）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。
   * @param signal （由 TypeScript 根据调用位置推断的类型）：传递取消或终止信号；必须满足声明的类型及调用时序要求。
   * @returns AsyncIterable<SessionFollowFrame>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 follow(request, signal)，并按返回类型处理结果。
   */
  async *follow(request: SessionFollowRequest, signal = new AbortController().signal): AsyncIterable<SessionFollowFrame> {
    /**
     * 常量说明：generation 用于处理 generation 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const generation = this.generations.shift()
    if (generation === undefined) throw new Error('no scripted Session generation')
    this.followRequests.push(request)
    this.signals.push(signal)
    for (const /*
     * 变量说明：frame 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */ frame of generation.frames) yield frame
    await generation.waitAfterFrames
    if (generation.terminal !== undefined) throw generation.terminal
    if (generation.hold === true && !signal.aborted) {
      await new Promise<void>(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolve（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(resolve)，并按返回类型处理结果。
 */ (resolve) => {
          signal.addEventListener('abort', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => { resolve() }, { once: true })
        })
    }
  }

  /**
   * 功能说明：处理 page 相关流程；使用场景由所在模块及调用位置决定。
   * @param request （SessionPageRequest）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。
   * @returns Promise<RemoteResult<SessionPage>>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 page(request)，并按返回类型处理结果。
   */
  page(request: SessionPageRequest): Promise<RemoteResult<SessionPage>> {
    this.pageRequests.push(request)
    /**
     * 常量说明：result 用于处理 result 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const result = this.pages.shift()
    if (result === undefined) throw new Error('no scripted Session page')
    return Promise.resolve(result)
  }

  /**
   * 功能说明：处理 control 相关流程；使用场景由所在模块及调用位置决定。
   * @param signal （由 TypeScript 根据调用位置推断的类型）：传递取消或终止信号；必须满足声明的类型及调用时序要求。
   * @returns AsyncIterable<SessionControlFrame>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 control(signal)，并按返回类型处理结果。
   */
  async *control(signal = new AbortController().signal): AsyncIterable<SessionControlFrame> {
    for (const /*
     * 变量说明：frame 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */ frame of this.controlFrames) yield frame
    if (this.holdControl && !signal.aborted) {
      await new Promise<void>(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolve（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(resolve)，并按返回类型处理结果。
 */ (resolve) => {
          signal.addEventListener('abort', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => { resolve() }, { once: true })
        })
    }
  }
}

describe('Session Client stream adapters', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {
    it('validates a packed logical range before publishing one compact Client entry', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：row 用于处理 row 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const row = chunks(1)
        /**
     * 常量说明：remote 用于处理 remote 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const remote = new ScriptedSessionRemote(
          [{ frames: [snapshot(4, [entry(0), row, entry(4)]), entry(5)], hold: true }],
          [],
        )
        /**
     * 常量说明：changes 用于处理 changes 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const changes: SessionJournalChange[] = []
        /**
     * 常量说明：stream 用于处理 stream 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const stream = new SessionEventStream(sessionClient(remote), ADDRESS, {
          publish: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：change（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(change)，并按返回类型处理结果。
 */ (change) => { changes.push(change) },
          failed: vi.fn(),
        })

        await stream.open({})
        await vi.waitFor(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => { expect(changes).toHaveLength(2) })

        expect(changes[0]).toMatchObject({
          type: 'replace',
          entries: [
            entry(0),
            row,
            entry(4),
          ],
        })
        expect(changes[0]?.type === 'replace' ? changes[0].entries[1] : undefined).toBe(row)
        expect(changes[1]).toEqual({ type: 'append', entry: entry(5) })
        await stream.dispose()
      })

    it('rejects a packed record emitted by the live follow path', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：failed 用于处理 failed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const failed = vi.fn()
        /**
     * 常量说明：remote 用于处理 remote 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const remote = new ScriptedSessionRemote(
          [{ frames: [snapshot(-1, []), chunks(0) as SessionFollowFrame], hold: true }],
          [],
        )
        /**
     * 常量说明：stream 用于处理 stream 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const stream = new SessionEventStream(sessionClient(remote), ADDRESS, {
          publish: vi.fn(),
          failed,
        })

        await stream.open({})
        await vi.waitFor(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => { expect(failed).toHaveBeenCalledOnce() })
        expect(failed.mock.calls[0]?.[0]).toMatchObject({
          message: 'session live stream emitted a packed history record',
        })
        await stream.dispose()
      })

    it('binds an event journal to one address and publishes replace, append, and prepend changes', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：remote 用于处理 remote 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const remote = new ScriptedSessionRemote(
          [{
            frames: [
              snapshot(3, [entry(2), entry(3)], true),
              entry(3),
              entry(4),
            ],
            hold: true,
          }],
          [
            { ok: true, value: page([entry(0), entry(1)], false) },
          ],
        )
        /**
     * 常量说明：changes 用于处理 changes 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const changes: SessionJournalChange[] = []
        /**
     * 常量说明：stream 用于处理 stream 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const stream = new SessionEventStream(sessionClient(remote), ADDRESS, {
          publish: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：change（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(change)，并按返回类型处理结果。
 */ (change) => { changes.push(change) },
          failed: vi.fn(),
        })

        await stream.open({ maxMessages: 50 })
        await vi.waitFor(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => { expect(changes).toHaveLength(2) })
        await stream.prepend({ beforeSeq: 2, maxMessages: 50 })

        expect(remote.followRequests).toEqual([{ address: ADDRESS, maxMessages: 50 }])
        expect(remote.pageRequests).toEqual([
          { address: ADDRESS, throughSeq: 4, beforeSeq: 2, maxMessages: 50 },
        ])
        expect(changes).toMatchObject([
          { type: 'replace', entries: [entry(2), entry(3)], hasMore: true },
          { type: 'append', entry: entry(4) },
          { type: 'prepend', entries: [entry(0), entry(1)], hasMore: false },
        ])
        await stream.dispose()
        expect(remote.signals[0]?.aborted).toBe(true)
      })

    it('replaces the retained window from each reconnect snapshot', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：lost 用于处理 lost 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const lost = new RemoteStreamCarrierError('lost')
        /**
     * 常量说明：remote 用于处理 remote 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const remote = new ScriptedSessionRemote(
          [
            {
              frames: [snapshot(1, [entry(0), entry(1)]), entry(2)],
              terminal: lost,
            },
            { frames: [snapshot(4, [entry(0), entry(1), entry(2), entry(3), entry(4)])], hold: true },
          ],
          [],
        )
        /**
     * 常量说明：changes 用于处理 changes 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const changes: SessionJournalChange[] = []
        /**
     * 常量说明：carrierFailed 用于处理 carrierFailed 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const carrierFailed = vi.fn()
        /**
     * 常量说明：stream 用于处理 stream 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const stream = new SessionEventStream(sessionClient(remote), ADDRESS, {
          publish: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：change（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(change)，并按返回类型处理结果。
 */ (change) => { changes.push(change) },
          carrierFailed,
          failed: vi.fn(),
        })

        await stream.open({ maxMessages: 50 })
        await vi.waitFor(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => { expect(remote.followRequests).toHaveLength(2) })

        expect(remote.followRequests).toEqual([
          { address: ADDRESS, maxMessages: 50 },
          { address: ADDRESS, maxMessages: 50 },
        ])
        expect(remote.pageRequests).toEqual([])
        expect(changes.map(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：change（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(change)，并按返回类型处理结果。
 */ change => change.type)).toEqual(['replace', 'append', 'replace'])
        expect(carrierFailed).toHaveBeenCalledWith(lost)
        await stream.dispose()
      })

    it('repairs a resumed event stream without an optional message limit', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：finish 用于处理 finish 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const finish = Promise.withResolvers<undefined>()
        /**
     * 常量说明：remote 用于处理 remote 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const remote = new ScriptedSessionRemote(
          [
            {
              frames: [snapshot(0, [entry(0)])],
              waitAfterFrames: finish.promise,
              terminal: new RemoteStreamCarrierError('lost'),
            },
            { frames: [snapshot(1, [entry(0), entry(1)])], hold: true },
          ],
          [],
        )
        /**
     * 常量说明：stream 用于处理 stream 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const stream = new SessionEventStream(sessionClient(remote), ADDRESS, {
          publish: vi.fn(),
          failed: vi.fn(),
        })

        await stream.open({})
        finish.resolve(undefined)
        await vi.waitFor(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => { expect(remote.followRequests).toHaveLength(2) })
        expect(remote.followRequests).toEqual([{ address: ADDRESS }, { address: ADDRESS }])
        expect(remote.pageRequests).toEqual([])
        await stream.dispose()
      })

    it('repairs a live gap without adding an absent message limit', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：remote 用于处理 remote 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const remote = new ScriptedSessionRemote(
          [{ frames: [snapshot(0, [entry(0)]), entry(2)], hold: true }],
          [{ ok: true, value: page([entry(0), entry(1), entry(2)]) }],
        )
        /**
     * 常量说明：changes 用于处理 changes 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const changes: SessionJournalChange[] = []
        /**
     * 常量说明：stream 用于处理 stream 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const stream = new SessionEventStream(sessionClient(remote), ADDRESS, {
          publish: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：change（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(change)，并按返回类型处理结果。
 */ (change) => { changes.push(change) },
          failed: vi.fn(),
        })

        await stream.open({})
        await vi.waitFor(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => { expect(changes).toHaveLength(2) })
        expect(remote.pageRequests).toEqual([{ address: ADDRESS, throughSeq: 2 }])
        await stream.dispose()
      })

    it('turns a pagination failure into a typed stream failure', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：failure 用于处理 failure 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const failure = { code: 'session-not-found', message: 'missing', details: { sessionId: 'session-1' } } as const
        /**
     * 常量说明：remote 用于处理 remote 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const remote = new ScriptedSessionRemote(
          [{ frames: [snapshot(-1, [])], hold: true }],
          [{ ok: false, error: failure }],
        )
        /**
     * 常量说明：stream 用于处理 stream 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const stream = new SessionEventStream(sessionClient(remote), ADDRESS, {
          publish: vi.fn(),
          failed: vi.fn(),
        })

        await stream.open({})
        await expect(stream.prepend({})).rejects.toBeInstanceOf(RemoteStreamError)
        await expect(stream.open({})).rejects.toThrow('already opened')
        expect(sessionStreamFailure(new RemoteStreamError(failure.code, failure.message, failure.details)))
          .toEqual(failure)
        expect(sessionStreamFailure(new Error('local'))).toBeUndefined()
        expect(remote.signals[0]?.aborted).toBe(false)
        expect(remote.pageRequests).toEqual([{ address: ADDRESS, throughSeq: -1 }])
        await stream.dispose()
        expect(remote.signals[0]?.aborted).toBe(true)
      })

    it('maps the Host-wide control baseline and deltas into one snapshot stream', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：baseline 用于处理 baseline 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const baseline: SessionControlFrame = {
          type: 'baseline',
          value: { queues: {}, jobs: {}, projections: {} },
        }
        /**
     * 常量说明：update 用于更新 update 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const update: SessionControlFrame = {
          type: 'queue', sessionId: 'session-1' as never, items: [],
        }
        /**
     * 常量说明：remote 用于处理 remote 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const remote = new ScriptedSessionRemote([], [], [baseline, update])
        /**
     * 常量说明：accept 用于处理 accept 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const accept = vi.fn<(frame: SessionControlFrame) => void>()
        /**
     * 常量说明：stream 用于处理 stream 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const stream = createSessionControlStream(sessionClient(remote), {
          accept,
          failed: vi.fn(),
        })

        stream.start()
        stream.start()
        await vi.waitFor(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => { expect(accept).toHaveBeenCalledTimes(2) })
        expect(accept.mock.calls.map(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：[frame]（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调([frame])，并按返回类型处理结果。
 */ ([frame]) => frame)).toEqual([baseline, update])
        await stream.dispose()
        await stream.dispose()
      })

    it('classifies control streams that end before and after their opening baseline', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：beforeFailed 用于处理 beforeFailed 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const beforeFailed = vi.fn()
        /**
     * 常量说明：before 用于处理 before 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const before = createSessionControlStream(
          sessionClient(new ScriptedSessionRemote([], [], [], false)),
          { accept: vi.fn(), failed: beforeFailed },
        )
        before.start()
        await vi.waitFor(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => { expect(beforeFailed).toHaveBeenCalledOnce() })
        expect(beforeFailed.mock.calls[0]?.[0]).toMatchObject({
          message: 'session control stream ended before its opening snapshot',
        })
        await before.dispose()

        /**
     * 常量说明：baseline 用于处理 baseline 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const baseline: SessionControlFrame = {
          type: 'baseline',
          value: { queues: {}, jobs: {}, projections: {} },
        }
        /**
     * 常量说明：carrierFailed 用于处理 carrierFailed 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const carrierFailed = vi.fn()
        /**
     * 常量说明：failed 用于处理 failed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const failed = vi.fn()
        /**
     * 常量说明：afterRemote 用于处理 afterRemote 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const afterRemote = new ScriptedSessionRemote([], [], [baseline], false)
        /**
     * 常量说明：after 用于处理 after 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const after = createSessionControlStream(sessionClient(afterRemote), {
          accept: vi.fn(),
          carrierFailed: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：error（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(error)，并按返回类型处理结果。
 */ (error) => {
            carrierFailed(error)
            void after.dispose()
          },
          failed,
        })
        after.start()
        await vi.waitFor(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => { expect(carrierFailed).toHaveBeenCalledOnce() })
        expect(carrierFailed.mock.calls[0]?.[0]).toMatchObject({
          message: 'session control stream ended without a terminal result',
        })
        expect(failed).not.toHaveBeenCalled()
        await after.dispose()
      })
  })
