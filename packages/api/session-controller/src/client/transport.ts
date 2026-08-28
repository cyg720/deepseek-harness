/** Session-specific adapters for Gateway-owned Remote stream lifecycles.
 * @remarks 文件说明：文件职责：实现 api/session-controller 中 transport 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * api/session-controller 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。 */

import type {} from '@deepseek-ai/dsh-api-session-controller/remote'
import type { RemoteFailure } from '@deepseek-ai/dsh-typert-protocol'
import {
  RemoteJournalStream,
  RemoteSnapshotStream,
  RemoteStreamCarrierError,
  RemoteStreamError,
  type ClientRemote,
  type RemoteJournalChange,
  type RemoteJournalFrame,
} from '@deepseek-ai/dsh-api-gateway/client'
import type {
  SessionAddress,
  SessionControlFrame,
  SessionHistoryRecord,
  SessionPage,
  SessionPageRequest,
  SessionProjectionBaseline,
} from '../types.ts'
import {
  historyEntries,
  historyRecordFirstSeq,
  historyRecordLastSeq,
} from './sessions/history-records.ts'
import type { SessionEventLikeEntry, SessionLiveEventEntry } from './contract/events.ts'

export {
  SESSION_SEARCH_RESULT_LIMIT,
  SESSION_SEARCH_SNIPPET_MAX_CODE_POINTS,
} from '../types.ts'

/** Pagination fields bound to an already-addressed Session journal. */
export type ClientSessionPageRequest = Omit<SessionPageRequest, 'address' | 'throughSeq'>

/** Complete generated `ctx.remote.session` namespace. */
export type SessionRemote = ClientRemote['session']

/** Opening metadata carried only by a follow snapshot, never by loadOlder pages. */
interface SessionJournalPage extends SessionPage {
  readonly projections?: SessionProjectionBaseline
}

/** One complete publication from the Session journal stream. */
export type SessionJournalChange =
  | {
    readonly type: 'replace' | 'prepend'
    readonly page: SessionJournalPage
    readonly entries: readonly SessionEventLikeEntry[]
    readonly hasMore: boolean
  }
  | { readonly type: 'append'; readonly entry: SessionLiveEventEntry }

/**
 * 功能说明：处理 toSessionJournalChange 相关流程；使用场景由所在模块及调用位置决定。
 * @param change （RemoteJournalChange<SessionJournalPage,
 * SessionHistoryRecor…）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns SessionJournalChange；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 toSessionJournalChange(change)，并按返回类型处理结果。
 */
function toSessionJournalChange(
  change: RemoteJournalChange<SessionJournalPage, SessionHistoryRecord>,
): SessionJournalChange {
  switch (change.type) {
    case 'replace':
    case 'prepend':
      return { ...change, entries: historyEntries(change.entries) }
    case 'append': {
      if (change.entry.type !== 'event') {
        throw new Error('session live stream emitted a packed history record')
      }
      return {
        type: 'append',
        entry: change.entry as unknown as SessionLiveEventEntry,
      }
    }
  }
}

type SessionControlBaselineFrame = Extract<SessionControlFrame, { type: 'baseline' }>
type SessionControlDeltaFrame = Exclude<SessionControlFrame, SessionControlBaselineFrame>

/** Gateway-owned control snapshot stream configured for Session frames. */
export type SessionControlStream = RemoteSnapshotStream<
  SessionControlBaselineFrame,
  SessionControlDeltaFrame
>

type SessionStreamRemote = Pick<ClientRemote, '$stream' | 'session'>

/** Domain sinks used by the Host-wide Session control stream. */
export interface SessionControlStreamOptions {
  /** Apply a complete baseline or one later update. */
  readonly accept: (frame: SessionControlFrame) => void
  /** Observe a retryable carrier loss before reconnection. */
  readonly carrierFailed?: (error: RemoteStreamCarrierError) => void
  /** Publish a terminal business or protocol failure. */
  readonly failed: (error: unknown) => void
}

/** Domain sinks used by one addressed Session event journal. */
export interface SessionEventStreamOptions {
  /** Apply one complete event-window change. */
  readonly publish: (change: SessionJournalChange) => void
  /** Observe a retryable carrier loss before reconnection. */
  readonly carrierFailed?: (error: RemoteStreamCarrierError) => void
  /** Publish a terminal stream, page, or protocol failure after opening. */
  readonly failed: (error: unknown) => void
}

/**
 * Create the Host-wide Session control snapshot stream.
 * @param remote - generated Session namespace and Gateway stream factory.
 * @param options - Session state destinations.
 * @returns an unstarted stream owned by the Client Session runtime.
 * @remarks 中文说明：功能说明：创建 Session Control Stream 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：remote（SessionStreamRemote）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：options（SessionControlStreamOptions）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。
 * ；返回值：SessionControlStream；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * createSessionControlStream(remote, options)，并按返回类型处理结果。
 */
export function createSessionControlStream(
  remote: SessionStreamRemote,
  options: SessionControlStreamOptions,
): SessionControlStream {
  /**
   * 常量说明：stream 用于处理 stream 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const stream = remote.$stream<SessionControlFrame>({
    name: 'session control stream',
    open: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：signal（由 TypeScript
 * 根据调用位置推断的类型）：传递取消或终止信号；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(signal)，并按返回类型处理结果。
 */ signal => remote.session.control(signal),
    ended: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：accepted（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(accepted)，并按返回类型处理结果。
 */ accepted => accepted
      ? new RemoteStreamCarrierError('session control stream ended without a terminal result')
      : new Error('session control stream ended before its opening snapshot'),
    ...(options.carrierFailed === undefined ? {} : { carrierFailed: options.carrierFailed }),
  })
  return new RemoteSnapshotStream(stream, {
    name: 'session control stream',
    isSnapshot: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：frame（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：frame is
 * SessionControlBaselineFrame；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用
 * 匿名回调(frame)，并按返回类型处理结果。
 */ (frame): frame is SessionControlBaselineFrame => frame.type === 'baseline',
    replace: options.accept,
    update: options.accept,
    failed: options.failed,
  })
}

/** Gateway-owned event journal bound to one ordinary or direct-subagent Session address.
 * @remarks 中文说明：类说明：SessionEventStream 用于集中封装 处理 SessionEventStream
 * 相关状态与行为。；核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。；使用场景：由
 * api/session-controller 在对应插件或业务生命周期内创建和调用。 */
export class SessionEventStream extends RemoteJournalStream<
  SessionJournalPage,
  SessionHistoryRecord,
  number,
  ClientSessionPageRequest
> {
  /**
   * @param remote - generated Session namespace and Gateway stream factory.
   * @param address - durable ordinary-Session or direct-subagent address.
   * @param options - Session event-window destinations.
   * @remarks 中文说明：功能说明：处理 SessionEventStream 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：remote（SessionStreamRemote）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：address（SessionAddress）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：options（SessionEventStreamOptions）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。；
   * 返回值：当前类实例；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：通过 new
   * SessionEventStream(remote, address, options) 创建实例，并在所属生命周期内使用。
   */
  constructor(
    private readonly remote: SessionStreamRemote,
    private readonly address: SessionAddress,
    options: SessionEventStreamOptions,
  ) {
    super(remote, {
      name: 'session event stream',
      emptyCursor: -1,
      entries: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：page（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(page)，并按返回类型处理结果。
 */ page => page.records,
      hasMore: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：page（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(page)，并按返回类型处理结果。
 */ page => page.hasMore,
      first: historyRecordFirstSeq,
      last: historyRecordLastSeq,
      compare: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：left（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：right（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(left, right)，并按返回类型处理结果。
 */ (left, right) => left - right,
      follows: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：left（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：right（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(left, right)，并按返回类型处理结果。
 */ (left, right) => right === left + 1,
      publish: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：change（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(change)，并按返回类型处理结果。
 */ (change) => { options.publish(toSessionJournalChange(change)) },
      ...(options.carrierFailed === undefined
        ? {}
        : { carrierFailed: options.carrierFailed }),
      failed: options.failed,
    })
  }

  /** @inheritdoc
   * @remarks 中文说明：功能说明：处理 follow 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：request（ClientSessionPageRequest）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。；
   * 参数说明：signal（AbortSignal）：传递取消或终止信号；必须满足声明的类型及调用时序要求。；
   * 返回值：AsyncIterable<RemoteJournalFrame<SessionHistoryRecord, number,
   * Sessio…；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 follow(request,
   * signal)，并按返回类型处理结果。 */
  protected override async * follow(
    request: ClientSessionPageRequest,
    signal: AbortSignal,
  ): AsyncIterable<RemoteJournalFrame<SessionHistoryRecord, number, SessionJournalPage>> {
    for await (const /*
     * 变量说明：frame 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */ frame of this.remote.session.follow({
        address: this.address,
        ...(request.maxMessages === undefined ? {} : { maxMessages: request.maxMessages }),
      }, signal)) {
      if (frame.type === 'snapshot') {
        yield {
          type: 'opened',
          cursor: frame.cursor,
          page: {
            records: frame.records,
            hasMore: frame.hasMore,
            projections: frame.projections,
          },
        }
        continue
      }
      yield { type: 'entry', entry: frame }
    }
  }

  /** @inheritdoc
   * @remarks 中文说明：功能说明：读取 Page 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：request（ClientSessionPageRequest）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。；
   * 参数说明：throughSeq（number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：signal（AbortSignal）：传递取消或终止信号；必须满足声明的类型及调用时序要求。；
   * 返回值：Promise<SessionJournalPage>；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 使用示例：典型用法：在完成前置校验后调用 readPage(request, throughSeq, signal)，并按返回类型处理结果。 */
  protected override async readPage(
    request: ClientSessionPageRequest,
    throughSeq: number,
    signal: AbortSignal,
  ): Promise<SessionJournalPage> {
    /**
     * 常量说明：result 用于处理 result 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const result = await this.remote.session.page(
      { address: this.address, throughSeq, ...request },
      signal,
    )
    if (!result.ok) {
      throw new RemoteStreamError(
        result.error.code,
        result.error.message,
        result.error.details,
      )
    }
    return result.value
  }

  /** @inheritdoc
   * @remarks 中文说明：功能说明：处理 repairRequest 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：request（ClientSessionPageRequest）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。；
   * 返回值：ClientSessionPageRequest；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 使用示例：典型用法：在完成前置校验后调用 repairRequest(request)，并按返回类型处理结果。 */
  protected override repairRequest(
    request: ClientSessionPageRequest,
  ): ClientSessionPageRequest {
    return request.maxMessages === undefined ? {} : { maxMessages: request.maxMessages }
  }
}

/**
 * Recover a Host Session failure from a Remote stream terminal error.
 * @param error - value thrown while opening or consuming a Session stream.
 * @returns the Host failure, or `undefined` for carrier and local failures.
 * @remarks 中文说明：功能说明：处理 sessionStreamFailure 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：error（unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：RemoteFailure |
 * undefined；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * sessionStreamFailure(error)，并按返回类型处理结果。
 */
export function sessionStreamFailure(error: unknown): RemoteFailure | undefined {
  if (!(error instanceof RemoteStreamError)) return undefined
  return { code: error.code, message: error.message, details: error.details }
}
