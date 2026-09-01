/** Session-specific adapters for Gateway-owned Remote stream lifecycles. */

/*
 * 文件说明：文件职责：实现 api/session-controller 中 transport 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * api/session-controller 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。
 */

import type {} from '@deepseek-ai/dsh-api-session-controller/remote'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import {
  RemoteJournalStream,
  RemoteSnapshotStream,
  RemoteStreamCarrierError,
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
import type { SessionRemotes } from './sessions/remotes.ts'

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

function toSessionJournalChange(
  change: RemoteJournalChange<SessionJournalPage, SessionHistoryRecord>,
): SessionJournalChange {
  switch (change.type) {
    case 'replace':
    case 'prepend':
      return { ...change, entries: historyEntries(change.entries) }
    case 'append': {
      if (change.entry.type !== 'event') {
        throw new RemoteError(
          'gateway/internal',
          'session live stream emitted a packed history record',
          {},
        )
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
 */
export function createSessionControlStream(
  remote: SessionRemotes,
  options: SessionControlStreamOptions,
): SessionControlStream {
  const stream = remote.$stream<SessionControlFrame>({
    name: 'session control stream',
    open: signal => remote.session.control(signal),
    ended: accepted => accepted
      ? new RemoteStreamCarrierError('session control stream ended without a terminal result')
      : new Error('session control stream ended before its opening snapshot'),
    ...(options.carrierFailed === undefined ? {} : { carrierFailed: options.carrierFailed }),
  })
  return new RemoteSnapshotStream(stream, {
    name: 'session control stream',
    isSnapshot: (frame): frame is SessionControlBaselineFrame => frame.type === 'baseline',
    replace: options.accept,
    update: options.accept,
    failed: options.failed,
  })
}

/** Gateway-owned event journal bound to one ordinary or direct-subagent Session address. */
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
   */
  constructor(
    private readonly remote: SessionRemotes,
    private readonly address: SessionAddress,
    options: SessionEventStreamOptions,
  ) {
    super(remote, {
      name: 'session event stream',
      emptyCursor: -1,
      entries: page => page.records,
      hasMore: page => page.hasMore,
      first: historyRecordFirstSeq,
      last: historyRecordLastSeq,
      compare: (left, right) => left - right,
      follows: (left, right) => right === left + 1,
      publish: (change) => { options.publish(toSessionJournalChange(change)) },
      ...(options.carrierFailed === undefined
        ? {}
        : { carrierFailed: options.carrierFailed }),
      failed: options.failed,
    })
  }

  /** @inheritdoc */
  protected override async * follow(
    request: ClientSessionPageRequest,
    signal: AbortSignal,
  ): AsyncIterable<RemoteJournalFrame<SessionHistoryRecord, number, SessionJournalPage>> {
    for await (const frame of this.remote.session.follow({
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

  /** @inheritdoc */
  protected override async readPage(
    request: ClientSessionPageRequest,
    throughSeq: number,
    signal: AbortSignal,
  ): Promise<SessionJournalPage> {
    const result = await this.remote.session.page(
      { address: this.address, throughSeq, ...request },
      signal,
    )
    if (!result.ok) throw result.error
    return result.value
  }

  /** @inheritdoc */
  protected override repairRequest(
    request: ClientSessionPageRequest,
  ): ClientSessionPageRequest {
    return request.maxMessages === undefined ? {} : { maxMessages: request.maxMessages }
  }
}
