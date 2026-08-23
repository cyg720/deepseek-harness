/**
 * ================================ 文件注释 ================================
 * 【文件职责】合并会话查询服务的 Service Definition：精确读、关系追踪、过滤器与全文检索。
 *   提供 ctx.sessionQuery 抽象服务；后端（如 sqlite）实现全文观察、对账、排序、
 *   游标生成与查询执行。
 * 【技术维度】Cordis Service；抽象基类 SessionQueryEngine 提供与后端无关的确定性行为
 *   （列表/读取/过滤/标题折叠/事件窗口/血缘追踪），后端只补全文检索部分。
 * 【产品维度】把"会话日志历史"变成可查询/可搜索/可追溯的产品能力：列表、单条读取、
 *   语义文档过滤、血缘与事件关系追踪。
 * 【逻辑维度】按代码顺序：类型导出 → SessionQueryEngine（构造配置校验、searchSessions/
 *   searchEvents 抽象、listSessions/readSession/filterSessions/readTitle*、listEvents/
 *   filterEvents/readSurface/traceSession/traceEvent/readEvent + 私有辅助）。
 * 【关键边界】readWindowMax 与 persistedInspectConcurrency 在构造时校验；
 *   持久化读取失败映射为 SESSION_QUERY_PERSISTENCE_FAILED 等稳定错误码。
 * 【新手阅读建议】先读 types.ts 的请求/响应类型，再看 SessionQueryEngine 的公开方法。
 * ==========================================================================
 */

/**
 * Service Definition for combined session-history reads, traces, filters, and full-text search.
 *
 * @module @deepseek-ai/dsh-session-query
 */

import { Context, Service } from '@deepseek-ai/cordis'
import { Session, snapshotSessionEvent, type SessionId } from '@deepseek-ai/dsh-session'
import { foldSessionTitle } from '@deepseek-ai/dsh-session-title'
import type { SessionTitleSnapshot } from '@deepseek-ai/dsh-session-title'
import type {
  SessionEventResultFilter,
  SessionEventSearchPage,
  SessionEventReadRequest,
  SessionEventRecord,
  SessionEventSearchDocument,
  SessionEventSearchRequest,
  SessionEventTraceObservation,
  SessionEventTraceRequest,
  SessionEventWindow,
  SessionLineageTrace,
  SessionLogSnapshot,
  SessionRecord,
  SessionResultFilter,
  SessionSearchExecContext,
  SessionSearchHit,
  SessionSearchPage,
  SessionSearchRequest,
  SessionSurfaceSnapshot,
  SessionTitleObservation,
  SessionTitleObservationResult,
} from './types.ts'
import {
  SESSION_QUERY_DEFAULT_PERSISTED_INSPECT_CONCURRENCY,
  SESSION_QUERY_READ_WINDOW_MAX,
  SessionQueryError,
  type Config,
} from './config.ts'
import { SessionCorpus } from './corpus.ts'
import { buildSessionEventSearchDocuments } from './documents.ts'
import {
  filterSessionEventDocuments,
  filterSessionResults,
  materializeSessionEventResultFilters,
  materializeSessionResultFilters,
} from './filters.ts'
import * as tracing from './tracing.ts'

export type * from './types.ts'
export { SessionSearchCursor } from './cursor.ts'
export type { Config, SessionQueryErrorCode } from './config.ts'
export {
  SESSION_QUERY_DEFAULT_PERSISTED_INSPECT_CONCURRENCY,
  SESSION_QUERY_READ_WINDOW_MAX,
  SessionQueryError,
} from './config.ts'
export { extractSessionEventText } from './extraction.ts'
export { buildSessionEventRecords, buildSessionEventSearchDocuments } from './documents.ts'
export {
  compileSessionTextFilter,
  filterSessionEventDocuments,
  filterSessionResults,
  materializeSessionEventResultFilters,
  materializeSessionResultFilters,
} from './filters.ts'
export { assertSessionHeadersCompatible } from './sources.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    sessionQuery: SessionQueryEngine
  }
}

/**
 * Unified live-preferred session query service.
 *
 * Exact reads, filters, and traces are backend-independent concrete behavior.
 * A backend implements full-text observation, reconciliation, ranking, cursor
 * generations, and query execution on the same `ctx.sessionQuery` service.
 */
// 中文：统一的 live 优先会话查询服务：精确读/过滤/追踪是与后端无关的确定性行为；
// 后端（如 sqlite）在同一 ctx.sessionQuery 服务上实现全文观察、对账、排序、游标与执行。
export abstract class SessionQueryEngine extends Service {
  static inject = ['sessions']

  private readonly _readWindowMax: number
  private readonly _corpus: SessionCorpus

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'sessionQuery')
    this._readWindowMax = config.readWindowMax ?? SESSION_QUERY_READ_WINDOW_MAX
    if (!Number.isInteger(this._readWindowMax) || this._readWindowMax < 0) {
      throw new SessionQueryError(
        'session-query: readWindowMax must be a non-negative integer',
        'SESSION_QUERY_INVALID_CONFIG',
      )
    }
    const persistedInspectConcurrency = config.persistedInspectConcurrency
      ?? SESSION_QUERY_DEFAULT_PERSISTED_INSPECT_CONCURRENCY
    if (!Number.isSafeInteger(persistedInspectConcurrency) || persistedInspectConcurrency < 1) {
      throw new SessionQueryError(
        'session-query: persistedInspectConcurrency must be a positive safe integer',
        'SESSION_QUERY_INVALID_CONFIG',
      )
    }
    this._corpus = new SessionCorpus(ctx, persistedInspectConcurrency)
  }

  /**
   * Search the live-preferred logical corpus and group by session.
   * @param request - query text, metadata filters, page size, and cursor.
   * @param exec - optional cancellation control.
   * @returns session hits ranked by their strongest matching event.
   */
  abstract searchSessions(
    request: SessionSearchRequest,
    exec?: SessionSearchExecContext,
  ): Promise<SessionSearchPage<SessionSearchHit>>

  /**
   * Search events within one live-preferred logical session.
   * @param request - target session, query text, filters, page size, and cursor.
   * @param exec - optional cancellation control.
   * @returns matching event hits and their target header from one indexed generation.
   */
  abstract searchEvents(
    request: SessionEventSearchRequest,
    exec?: SessionSearchExecContext,
  ): Promise<SessionEventSearchPage>

  /**
   * List the complete logical corpus using live-preferred records.
   * @param signal - optional cancellation for persistence listing.
   * @returns deterministic newest-first cloned session records.
   */
  listSessions(signal?: AbortSignal): Promise<SessionRecord[]> {
    return this._corpus.listSessions(signal)
  }

  /**
   * Read and replay-validate one complete logical session log without making it live.
   * @param sessionId - live or persisted session id to read.
   * @returns cloned header and complete raw event log from one observation.
   * @throws when persistence, header compatibility, or replay validation fails.
   */
  // 中文：读取并回放校验一个完整逻辑会话日志（不使其变活）：load → Session.create
  // 触发校验 → 返回克隆的 header 与原始事件快照。
  async readSession(sessionId: SessionId): Promise<SessionLogSnapshot> {
    const loaded = await this._corpus.load(sessionId)
    Session.create(sessionId, loaded.events, loaded.header)
    return {
      session: structuredClone(loaded.header),
      events: loaded.events.map(snapshotSessionEvent),
    }
  }

  /**
   * Filter the complete logical corpus with provider-independent predicates.
   * @param filters - ANDed session metadata and availability clauses.
   * @param signal - optional cancellation for persistence listing.
   * @returns matching cloned records in deterministic newest-first order.
   */
  async filterSessions(
    filters: readonly SessionResultFilter[],
    signal?: AbortSignal,
  ): Promise<SessionRecord[]> {
    const ownedFilters = materializeSessionResultFilters(filters)
    return this._filterSessions(ownedFilters, signal)
  }

  /**
   * Fold the latest log-backed title from one live-preferred logical session.
   * @param sessionId - live or persisted session id to read.
   * @param signal - optional cancellation for source resolution and title folding.
   * @returns latest title snapshot, or `undefined` when the log has no title event.
   */
  async readTitle(
    sessionId: SessionId,
    signal?: AbortSignal,
  ): Promise<SessionTitleSnapshot | undefined> {
    return (await this.readTitleSnapshot(sessionId, signal)).title
  }

  /**
   * Fold the latest title and return its source header from one corpus observation.
   * @param sessionId - live or persisted session id to read.
   * @param signal - optional cancellation for source resolution and title folding.
   * @returns cloned source header and optional latest title snapshot.
   */
  async readTitleSnapshot(
    sessionId: SessionId,
    signal?: AbortSignal,
  ): Promise<SessionTitleObservation> {
    const result = (await this.readTitleSnapshots([sessionId], signal))[0] as SessionTitleObservationResult
    if (result.status === 'rejected') throw result.reason
    return result.value
  }

  /**
   * Fold titles for unique sessions from one cancellable corpus observation.
   *
   * Results preserve first-occurrence input order. Operational failures stay
   * isolated per session, while cancellation rejects the complete operation.
   * @param sessionIds - live or persisted session ids to observe.
   * @param signal - optional cancellation shared by all source reads.
   * @returns one fulfilled or rejected result per unique requested id.
   */
  async readTitleSnapshots(
    sessionIds: readonly SessionId[],
    signal?: AbortSignal,
  ): Promise<SessionTitleObservationResult[]> {
    return this._corpus.projectMany(sessionIds, (source): SessionTitleObservation => {
      const title = foldSessionTitle(source.events)
      return {
        session: structuredClone(source.header),
        ...title === undefined ? {} : { title },
      }
    }, signal)
  }

  /**
   * List lightweight raw-log event records for one logical session.
   * @param sessionId - live-preferred session id to read.
   * @returns event records in ascending seq order.
   */
  async listEvents(sessionId: SessionId): Promise<SessionEventRecord[]> {
    const loaded = await this._corpus.load(sessionId)
    return tracing.eventRecords(sessionId, loaded.events)
  }

  /**
   * Scan first-party semantic event documents with provider-independent filters.
   * @param sessionId - live-preferred session id to scan.
   * @param filters - ANDed metadata and literal-text predicates.
   * @returns matching semantic documents in ascending seq order.
   */
  async filterEvents(
    sessionId: SessionId,
    filters: readonly SessionEventResultFilter[],
  ): Promise<SessionEventSearchDocument[]> {
    const ownedFilters = materializeSessionEventResultFilters(filters)
    return this._filterEvents(sessionId, ownedFilters)
  }

  private async _filterSessions(
    filters: readonly SessionResultFilter[],
    signal?: AbortSignal,
  ): Promise<SessionRecord[]> {
    return filterSessionResults(await this._corpus.listSessions(signal), filters)
  }

  private async _filterEvents(
    sessionId: SessionId,
    filters: readonly SessionEventResultFilter[],
  ): Promise<SessionEventSearchDocument[]> {
    const loaded = await this._corpus.load(sessionId)
    const documents = buildSessionEventSearchDocuments(sessionId, loaded.events)
    return filterSessionEventDocuments(documents, filters)
  }

  /**
   * Read one session's complete current model surface from one corpus observation.
   * @param sessionId - live-preferred session id to read.
   * @returns cloned header, current surface, and the last sequence number included in the raw-log capture.
   * @throws when source resolution fails or the session surface is invalid.
   */
  async readSurface(sessionId: SessionId): Promise<SessionSurfaceSnapshot> {
    const loaded = await this._corpus.load(sessionId)
    return {
      session: structuredClone(loaded.header),
      capturedThroughSeq: loaded.events.at(-1)?.seq ?? null,
      events: tracing.currentSurfaceEvents(sessionId, loaded.events),
    }
  }

  /**
   * Trace known ancestry and descendants from one corpus observation.
   * @param sessionId - logical session id to trace.
   * @param signal - optional cancellation for persistence listing.
   * @returns a complete lineage or the first parent that could not be resolved.
   * @throws when corpus resolution fails, the target is absent, or its known ancestry cycles.
   */
  async traceSession(sessionId: SessionId, signal?: AbortSignal): Promise<SessionLineageTrace> {
    const records = await this._corpus.listSessions(signal)
    signal?.throwIfAborted()
    return tracing.traceSession(records, sessionId)
  }

  /**
   * Trace one event's direct positional replacements and cited source events.
   * @param request - target session id and event seq.
   * @param signal - optional cancellation for persisted source resolution.
   * @returns source header, direct links, and the target's positional replacement chain.
   * @throws when source resolution fails, the target is absent, or surface/source-event validation fails.
   */
  async traceEvent(request: SessionEventTraceRequest, signal?: AbortSignal): Promise<SessionEventTraceObservation> {
    const loaded = await this._corpus.load(request.sessionId, signal)
    signal?.throwIfAborted()
    return {
      session: loaded.header,
      ...tracing.traceEvent(request.sessionId, loaded.events, request.seq),
    }
  }

  /**
   * Read one full event plus a bounded raw-log context window.
   * @param request - target session/seq and context sizes.
   * @param signal - optional cancellation for persisted source resolution.
   * @returns cloned target and neighboring events.
   */
  async readEvent(request: SessionEventReadRequest, signal?: AbortSignal): Promise<SessionEventWindow> {
    const before = this._readWindow('before', request.before)
    const after = this._readWindow('after', request.after)
    const sessionId = request.sessionId
    const seq = request.seq
    return this._readEvent(sessionId, seq, before, after, signal)
  }

  private async _readEvent(
    sessionId: SessionId,
    seq: number,
    before: number,
    after: number,
    signal?: AbortSignal,
  ): Promise<SessionEventWindow> {
    const loaded = await this._corpus.load(sessionId, signal)
    signal?.throwIfAborted()
    const target = loaded.events[seq]
    if (target === undefined || target.seq !== seq) {
      throw new SessionQueryError(
        `session "${sessionId}" has no event at seq ${seq}`,
        'SESSION_QUERY_EVENT_NOT_FOUND',
      )
    }
    const startSeq = Math.max(0, seq - before)
    const endSeq = Math.min(loaded.events.length - 1, seq + after)
    const targetSnapshot = snapshotSessionEvent(target)
    const events = loaded.events.slice(startSeq, endSeq + 1)
      .map(event => event === target
        ? targetSnapshot
        : snapshotSessionEvent(event))
    return {
      session: structuredClone(loaded.header),
      target: targetSnapshot,
      events,
      startSeq,
      endSeq,
    }
  }

  private _readWindow(name: 'before' | 'after', value: number | undefined): number {
    if (value === undefined) return 0
    if (!Number.isInteger(value) || value < 0 || value > this._readWindowMax) {
      throw new SessionQueryError(
        `${name} must be an integer between 0 and ${this._readWindowMax}`,
        'SESSION_QUERY_INVALID_WINDOW',
      )
    }
    return value
  }
}

export default SessionQueryEngine
