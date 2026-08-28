/** Cold Session history pagination and live-event source.
 * @remarks 文件说明：文件职责：实现 api/session-controller 中 history 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * api/session-controller 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。 */

import type { Context } from '@deepseek-ai/cordis'
import { isAppendSurfaceEvent } from '@deepseek-ai/dsh-session'
import { isChunkRow, packChunkRuns, type ChunkRow } from '@deepseek-ai/dsh-session/chunk-rows'
import type { SessionEvent, SessionHeader, SessionId } from '@deepseek-ai/dsh-session'
import { SessionQueryError, type SessionObservation } from '@deepseek-ai/dsh-session-query'
import type {} from '@deepseek-ai/dsh-subagent'
import { TypertRemoteFailure } from '@deepseek-ai/dsh-typert-protocol'
import type {
  SessionAddress,
  SessionChunkRun,
  SessionEventEntry,
  SessionFollowRequest,
  SessionFollowFrame,
  SessionHistoryRecord,
  SessionPage,
  SessionPageRequest,
  SessionProjectionBaseline,
  SessionProjectionValues,
  SessionWireEvent,
} from './types.ts'

/**
 * 常量说明：DEFAULT_MAX_MESSAGES 用于处理 DEFAULT_MAX_MESSAGES 相关数据，作用于当前作用域；
 * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const DEFAULT_MAX_MESSAGES = 50
/**
 * 常量说明：MESSAGE_TYPES 用于处理 MESSAGE_TYPES 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const MESSAGE_TYPES = new Set(['user/message', 'assistant/message'])

/** Implements cold-safe history operations delegated by the Session Controller.
 * @remarks 中文说明：类说明：SessionHistoryController 用于集中封装 处理
 * SessionHistoryController 相关状态与行为。；核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。；
 * 使用场景：由 api/session-controller 在对应插件或业务生命周期内创建和调用。 */
export class SessionHistoryController {
  /**
   * 常量说明：closeFollowers 用于关闭 Followers 相关数据，作用于成员；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  private readonly closeFollowers = new Set<() => void>()

  /**
   * @param ctx - Host context carrying Session query and projection services.
   * @param promote - starts ordinary Session activation after snapshot delivery.
   * @remarks 中文说明：功能说明：处理 SessionHistoryController 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：ctx（Context）：提供当前 Cordis 插件上下文与已声明服务；必须满足声明的类型及调用时序要求。；
   * 参数说明：promote（(observation: SessionObservation) => void）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。；返回值：当前类实例；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：通过 new
   * SessionHistoryController(ctx, promote) 创建实例，并在所属生命周期内使用。
   */
  constructor(
    private readonly ctx: Context,
    private readonly promote: (observation: SessionObservation) => void,
  ) {
    ctx.effect(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {
          for (const /*
       * 变量说明：close 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
       */ close of this.closeFollowers) close()
          this.closeFollowers.clear()
        }, 'session-controller.history')
  }

  /**
   * Read one message-aligned history page without activating an Agent.
   * @param request - durable address and backwards-page cursor.
   * @param signal - caller cancellation for persistence reads.
   * @returns a contiguous event page.
   * @remarks 中文说明：功能说明：处理 page 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：request（SessionPageRequest）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。；
   * 参数说明：signal（AbortSignal）：传递取消或终止信号；必须满足声明的类型及调用时序要求。；
   * 返回值：Promise<SessionPage>；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * page(request, signal)，并按返回类型处理结果。
   */
  async page(request: SessionPageRequest, signal: AbortSignal): Promise<SessionPage> {
    validatePageRequest(request)
    /**
     * 变量说明：source 用于处理 source 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    using source = await this.sourceFor(request.address, signal, false)
    signal.throwIfAborted()
    /**
     * 常量说明：sourceLog 用于处理 sourceLog 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const sourceLog = source.events
    /**
     * 常量说明：sourceCursor 用于处理 sourceCursor 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const sourceCursor = sourceLog.at(-1)?.seq ?? -1
    if (request.throughSeq > sourceCursor) {
      reject(
        'bad-request',
        `session page through seq ${String(request.throughSeq)} is past cursor ${String(sourceCursor)}`,
        {},
      )
    }
    /* v8 ignore next -- Session and persistence validation guarantee a dense zero-based event prefix. */
    if (request.throughSeq >= 0 && sourceLog[request.throughSeq]?.seq !== request.throughSeq) {
      reject('internal', `session log does not contain through seq ${String(request.throughSeq)}`, {})
    }
    /**
     * 常量说明：page 用于处理 page 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const page = paginate(
      sourceLog,
      request.beforeSeq,
      request.maxMessages ?? DEFAULT_MAX_MESSAGES,
      request.throughSeq,
    )
    /**
     * 常量说明：records 用于处理 records 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const records = pageRecords(page.events)
    return {
      records,
      hasMore: page.hasMore,
    }
  }

  /**
   * Follow events appended after an initial cursor on one durable address.
   * @param request - durable address and last committed sequence already held by the caller.
   * @param signal - stream cancellation owned by the Remote carrier.
   * @returns a complete opening snapshot followed by gap-free event frames.
   * @remarks 中文说明：功能说明：处理 follow 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：request（SessionFollowRequest）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。；
   * 参数说明：signal（AbortSignal）：传递取消或终止信号；必须满足声明的类型及调用时序要求。；
   * 返回值：AsyncIterable<SessionFollowFrame>；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 使用示例：典型用法：在完成前置校验后调用 follow(request, signal)，并按返回类型处理结果。
   */
  async *follow(request: SessionFollowRequest, signal: AbortSignal): AsyncIterable<SessionFollowFrame> {
    validateFollowRequest(request)
    /**
     * 常量说明：address 用于处理 address 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const { address } = request
    /**
     * 常量说明：target 用于处理 target 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const target = addressId(address)
    /**
     * 常量说明：buffered 用于处理 buffered 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const buffered: SessionEvent[] = []
    /**
     * 变量说明：snapshotCursor 用于处理 snapshotCursor 相关数据，作用于当前作用域；其值可能随流程推进而变化，
     * 读写时需遵守声明类型和所在生命周期。
     */
    let snapshotCursor: number | undefined
    /**
     * 变量说明：wake 用于处理 wake 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let wake: (() => void) | undefined
    /**
     * 常量说明：notify 用于处理 notify 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     * 功能说明：处理 notify 相关流程；使用场景由所在模块及调用位置决定。
     * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 notify()，并按返回类型处理结果。
     */
    const notify = (): void => {
      /**
       * 常量说明：resume 用于处理 resume 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const resume = wake
      wake = undefined
      resume?.()
    }
    /**
     * 常量说明：follower 用于处理 follower 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const follower = { closed: false }
    /**
     * 常量说明：close 用于关闭 close 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     * 功能说明：关闭 close 相关流程；使用场景由所在模块及调用位置决定。
     * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 close()，并按返回类型处理结果。
     */
    const close = (): void => {
      follower.closed = true
      notify()
    }
    this.closeFollowers.add(close)
    /**
     * 常量说明：disposeEvent 用于处理 disposeEvent 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const disposeEvent = this.ctx.on('session/event', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：session（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：event（由 TypeScript
 * 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(session, event)，
 * 并按返回类型处理结果。
 */ (session, event) => {
        if (session.id !== target) return
        buffered.push(event)
        notify()
      }, { global: true })
    /**
     * 常量说明：disposeCreated 用于处理 disposeCreated 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const disposeCreated = this.ctx.on('session/created', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：session（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(session)，并按返回类型处理结果。
 */ (session) => {
        if (session.id !== target) return
        // Constructor seed events have no session/event notification. Normally
        // only the end-seed suffix is new; if persistence advanced after the
        // opening observation, replay everything beyond that snapshot cursor.
        /**
       * 常量说明：suffix 用于处理 suffix 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
        const suffix = session.events.slice(snapshotCursor === undefined
          ? session.firstLiveSeq
          : snapshotCursor + 1)
        buffered.unshift(...suffix)
        notify()
      }, { global: true })
    /**
     * 常量说明：onAbort 用于响应 Abort 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     * 功能说明：响应 Abort 相关流程；使用场景由所在模块及调用位置决定。
     * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 onAbort()，并按返回类型处理结果。
     */
    const onAbort = (): void => { notify() }
    signal.addEventListener('abort', onAbort, { once: true })
    try {
      /**
       * 变量说明：source 用于处理 source 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
       */
      using source = await this.sourceFor(address, signal, true)
      /**
       * 常量说明：events 用于处理 events 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const events = source.events
      signal.throwIfAborted()
      /**
       * 常量说明：cursor 用于处理 cursor 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const cursor = source.cursor
      snapshotCursor = cursor
      /**
       * 常量说明：page 用于处理 page 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const page = paginate(events, undefined, request.maxMessages ?? DEFAULT_MAX_MESSAGES)
      yield {
        type: 'snapshot',
        header: source.header,
        cursor,
        records: pageRecords(page.events),
        hasMore: page.hasMore,
        projections: source.projections === undefined
          ? { asOfSeq: cursor, values: {} }
          : projectionBlock(source.projections),
      }
      if (address.kind === 'session' && source.source === 'prepared') {
        /**
         * 常量说明：promotion 用于处理 promotion 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const promotion = source.retain()
        try {
          this.promote(promotion)
        } catch (/*
 * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
 */ error: unknown) {
          promotion[Symbol.dispose]()
          throw error
        }
      }
      /**
       * 变量说明：nextSeq 用于处理 nextSeq 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
       */
      let nextSeq = cursor + 1
      while (!follower.closed && !signal.aborted) {
        /**
         * 常量说明：item 用于处理 item 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const item = buffered.shift()
        if (item === undefined) {
          await new Promise<void>(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolve（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(resolve)，并按返回类型处理结果。
 */ (resolve) => { wake = resolve })
          continue
        }
        if (item.seq < nextSeq) continue
        if (item.seq !== nextSeq) {
          reject('internal', `session event stream skipped seq ${String(nextSeq)}`, {})
        }
        nextSeq++
        yield entryFor(item)
      }
    } finally {
      this.closeFollowers.delete(close)
      signal.removeEventListener('abort', onAbort)
      disposeCreated()
      disposeEvent()
    }
  }

  /**
   * 功能说明：处理 sourceFor 相关流程；使用场景由所在模块及调用位置决定。
   * @param address （SessionAddress）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param signal （AbortSignal）：传递取消或终止信号；必须满足声明的类型及调用时序要求。
   * @param withProjections （boolean）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns Promise<SessionObservation>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 sourceFor(address, signal, withProjections)，
   * 并按返回类型处理结果。
   */
  private async sourceFor(
    address: SessionAddress,
    signal: AbortSignal,
    withProjections: boolean,
  ): Promise<SessionObservation> {
    /**
     * 常量说明：sessionId 用于处理 sessionId 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const sessionId = addressId(address)
    try {
      /**
       * 常量说明：observation 用于处理 observation 相关数据，作用于当前作用域；初始化后不可重新赋值，
       * 但对象内部是否可变仍由其类型决定。
       */
      const observation = await this.ctx.sessionQuery.observeSession(sessionId, {
        signal,
        projectionMode: withProjections || address.kind === 'subagent' ? 'all' : 'none',
      })
      if (observation.header.cwd === undefined) {
        observation[Symbol.dispose]()
        rejectNotFound(address)
      }
      try {
        validateAddress(address, observation.header, observation.projections)
      } catch (/*
 * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
 */ error: unknown) {
        observation[Symbol.dispose]()
        throw error
      }
      return observation
    } catch (/*
 * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
 */ error: unknown) {
      if (error instanceof SessionQueryError
        && error.code === 'SESSION_QUERY_SESSION_NOT_FOUND') rejectNotFound(address)
      throw error
    }
  }

}

/**
 * 功能说明：处理 projectionBlock 相关流程；使用场景由所在模块及调用位置决定。
 * @param snapshot （NonNullable<SessionObservation['projections']>）：提供本次调用所
 * 需的数据；必须满足声明的类型及调用时序要求。
 * @returns SessionProjectionBaseline；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 projectionBlock(snapshot)，并按返回类型处理结果。
 */
function projectionBlock(
  snapshot: NonNullable<SessionObservation['projections']>,
): SessionProjectionBaseline {
  return {
    asOfSeq: snapshot.asOfSeq,
    // Projection definitions validate whole JSON values before snapshot publication.
    values: snapshot.values as SessionProjectionValues,
  }
}

/**
 * 功能说明：校验 Page Request 相关流程；使用场景由所在模块及调用位置决定。
 * @param request （SessionPageRequest）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。
 * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 validatePageRequest(request)，并按返回类型处理结果。
 */
function validatePageRequest(request: SessionPageRequest): void {
  if (!Number.isSafeInteger(request.throughSeq) || request.throughSeq < -1) {
    reject('bad-request', 'throughSeq must be an integer greater than or equal to -1', {})
  }
  if (request.beforeSeq !== undefined
    && (!Number.isSafeInteger(request.beforeSeq) || request.beforeSeq < 0)) {
    reject('bad-request', 'beforeSeq must be a non-negative safe integer', {})
  }
  if (request.maxMessages !== undefined
    && (!Number.isSafeInteger(request.maxMessages) || request.maxMessages <= 0)) {
    reject('bad-request', 'maxMessages must be a positive safe integer', {})
  }
}

/**
 * 功能说明：校验 Follow Request 相关流程；使用场景由所在模块及调用位置决定。
 * @param request （SessionFollowRequest）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。
 * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 validateFollowRequest(request)，并按返回类型处理结果。
 */
function validateFollowRequest(request: SessionFollowRequest): void {
  if (request.maxMessages !== undefined
    && (!Number.isSafeInteger(request.maxMessages) || request.maxMessages <= 0)) {
    reject('bad-request', 'maxMessages must be a positive safe integer', {})
  }
}

/**
 * 功能说明：处理 addressId 相关流程；使用场景由所在模块及调用位置决定。
 * @param address （SessionAddress）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns SessionId；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 addressId(address)，并按返回类型处理结果。
 */
function addressId(address: SessionAddress): SessionId {
  return address.kind === 'session' ? address.sessionId : address.childSessionId
}

/**
 * 功能说明：校验 Address 相关流程；使用场景由所在模块及调用位置决定。
 * @param address （SessionAddress）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param header （SessionHeader）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param projections （SessionObservation['projections']）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。
 * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 validateAddress(address, header, projections)，
 * 并按返回类型处理结果。
 */
function validateAddress(
  address: SessionAddress,
  header: SessionHeader,
  projections: SessionObservation['projections'],
): void {
  if (address.kind === 'session') {
    if (header.origin === 'subagent') {
      reject('agent-busy', 'subagent Sessions require their durable parent address', {
        reason: 'use subagent delivery for this child session',
      })
    }
    return
  }
  if (header.origin !== 'subagent' || header.parentSession !== address.parentSessionId) {
    reject('subagent-unauthorized', 'subagent does not belong to the supplied parent', {
      childSessionId: address.childSessionId,
    })
  }
  /**
   * 常量说明：identity 用于处理 identity 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const identity = projections?.values.subagent
  if (identity === null) {
    reject('subagent-catalog-diagnostic', 'subagent descriptor is corrupt', {
      parentSessionId: address.parentSessionId,
      childSessionId: address.childSessionId,
      reason: 'corrupt',
    })
  }
  if (identity === undefined || identity.seq < (header.seedLength ?? 0)) {
    reject('subagent-catalog-diagnostic', 'subagent descriptor is unavailable', {
      parentSessionId: address.parentSessionId,
      childSessionId: address.childSessionId,
      reason: 'unsupported',
    })
  }
  if (identity.mode !== address.mode) {
    reject('subagent-unauthorized', 'subagent mode does not match the supplied address', {
      childSessionId: address.childSessionId,
    })
  }
}

/**
 * 功能说明：处理 rejectNotFound 相关流程；使用场景由所在模块及调用位置决定。
 * @param address （SessionAddress）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns never；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 rejectNotFound(address)，并按返回类型处理结果。
 */
function rejectNotFound(address: SessionAddress): never {
  if (address.kind === 'session') {
    reject('session-not-found', `session "${address.sessionId}" not found`, { sessionId: address.sessionId })
  }
  reject('subagent-not-found', 'subagent is unavailable', {
    parentSessionId: address.parentSessionId,
    childSessionId: address.childSessionId,
  })
}

/**
 * 功能说明：处理 reject 相关流程；使用场景由所在模块及调用位置决定。
 * @param code （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param message （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param details （object）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns never；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 reject(code, message, details)，并按返回类型处理结果。
 */
function reject(code: string, message: string, details: object): never {
  throw new TypertRemoteFailure({ code, message, details })
}

/**
 * 功能说明：处理 paginate 相关流程；使用场景由所在模块及调用位置决定。
 * @param events （readonly SessionEvent[]）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。
 * @param beforeSeq （number | undefined）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param maxMessages （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param throughSeq （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。
 * @returns { readonly events: SessionEvent[]; readonly hasMore: boolean }；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 paginate(events, beforeSeq, maxMessages, throughSeq)，
 * 并按返回类型处理结果。
 */
function paginate(
  events: readonly SessionEvent[],
  beforeSeq: number | undefined,
  maxMessages: number,
  throughSeq = events.at(-1)?.seq ?? -1,
): { readonly events: SessionEvent[]; readonly hasMore: boolean } {
  /**
   * 常量说明：end 用于处理 end 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const end = Math.min(throughSeq + 1, beforeSeq ?? throughSeq + 1)
  /**
   * 变量说明：count 用于处理 count 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let count = 0
  /**
   * 变量说明：cut 用于处理 cut 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let cut = 0
  for (let /*
   * 变量说明：index 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */ index = end - 1; index >= 0; index--) {
    /**
     * 常量说明：event 用于处理 event 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const event = events[index] as SessionEvent
    if (!MESSAGE_TYPES.has(event.type) || !isAppendSurfaceEvent(event)) continue
    count++
    /**
     * 常量说明：sources 用于处理 sources 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const sources = (event as { readonly sourceEventSeqs?: readonly number[] }).sourceEventSeqs
    /**
     * 变量说明：groupStart 用于处理 groupStart 相关数据，作用于当前作用域；其值可能随流程推进而变化，
     * 读写时需遵守声明类型和所在生命周期。
     */
    let groupStart = event.seq
    if (sources !== undefined) {
      for (const /*
       * 变量说明：source 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
       */ source of sources) groupStart = Math.min(groupStart, source)
    }
    if (count >= maxMessages) {
      cut = groupStart
      break
    }
  }
  return { events: events.slice(cut, end), hasMore: cut > 0 }
}

/**
 * 功能说明：处理 entryFor 相关流程；使用场景由所在模块及调用位置决定。
 * @param event （SessionEvent）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。
 * @returns SessionEventEntry；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 entryFor(event)，并按返回类型处理结果。
 */
function entryFor(event: SessionEvent): SessionEventEntry {
  return {
    type: 'event',
    // Session.append validates and freezes event data as JSON before publication.
    event: event as unknown as SessionWireEvent,
  }
}

/**
 * 功能说明：处理 chunkEntryFor 相关流程；使用场景由所在模块及调用位置决定。
 * @param row （ChunkRow）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns SessionChunkRun；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 chunkEntryFor(row)，并按返回类型处理结果。
 */
function chunkEntryFor(row: ChunkRow): SessionChunkRun {
  switch (row.type) {
    case 'text-chunks':
      return {
        type: 'chunks',
        event: { type: 'chunkrow/text-chunks', seq: row.seq0, time: row.time0, data: row.data },
      }
    case 'reasoning-chunks':
      return {
        type: 'chunks',
        event: { type: 'chunkrow/reasoning-chunks', seq: row.seq0, time: row.time0, data: row.data },
      }
    case 'tool-call-chunks':
      return {
        type: 'chunks',
        event: { type: 'chunkrow/tool-call-chunks', seq: row.seq0, time: row.time0, data: row.data },
      }
  }
}

/** Encode one bounded logical page without changing its pagination cut.
 * @remarks 中文说明：功能说明：处理 pageRecords 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：events（readonly SessionEvent[]）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；
 * 返回值：SessionHistoryRecord[]；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 pageRecords(events)，并按返回类型处理结果。 */
function pageRecords(events: readonly SessionEvent[]): SessionHistoryRecord[] {
  return packChunkRuns(events).map(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：record（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(record)，并按返回类型处理结果。
 */ record => isChunkRow(record)
      ? chunkEntryFor(record)
      : entryFor(record))
}
