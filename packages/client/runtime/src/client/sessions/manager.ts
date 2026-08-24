// SessionManager: the instance cluster Map<SessionId, Session> (lazy-built, resident) + the frame
// dispatch entry + list state, constructed and held by SessionRuntime (one per client runtime).
// List data never enters zustand; React connects via subscribe/getListSnapshot.
/**
 * 文件职责：管理客户端会话清单、当前会话、历史分页、实时事件订阅和命令操作。
 * 技术维度：Cordis 服务、响应式 Store、异步并发控制、AbortController、会话投影与 API 客户端。
 * 产品维度：驱动会话侧栏和对话页，支持创建、切换、重命名、归档、提示与模型选择。
 * 逻辑维度：初始化列表，按需加载历史，接收实时事件并更新投影；公开命令负责远程调用与本地状态同步。
 * 关键边界：会话切换和销毁必须取消旧请求；历史与实时事件要按序去重；失败不能覆盖较新的状态。
 * 新手阅读建议：先看 Manager 的公开状态与构造过程，再读会话选择/历史加载，最后阅读各产品命令和事件处理。
 */

import type {
  IApiClient, HostFrame, MuxFrame, RpcError, RpcRequest, RpcResult, SessionId,
  SessionSummary, SubagentAddress, SubagentCatalog, JobView, WorkspaceId,
} from '@deepseek-ai/dsh-api-remotes/client'
// Value import from the inline-safe wire layer (not the connection plugin):
// plugin-to-plugin value imports are a bundle purity error.
import { transportError } from '@deepseek-ai/dsh-host-apiproxy/api'
import { mergeOrderedBaseline } from '../ordered-baseline.ts'
import type { ConversationRuntime } from './conversation-assembler.ts'
import type { SessionListEntry, TitledSessionSummary } from './lineage.ts'
import { flattenLineage } from './lineage.ts'
import type { PendingInteractionStatus } from './pending.ts'
// Type-only merge edge: the title domain's client-namespace outlet declares
// the 'title' projection key this manager projects into list rows (and any
// useProjection('title') consumer reads). Zero value imports by construction.
import type {} from '@deepseek-ai/dsh-session-title/client'
import { Notifier } from './notifier.ts'
import { ProjectionValueStore } from './projection-store.ts'
import { Session } from './session.ts'
import type { SessionRemotes } from './remotes.ts'

/**
 * List arrival lifecycle, orthogonal to the pull-activity `state` axis:
 * `pending` (no successful pull yet — an empty items array means "nothing
 * arrived", not "nothing exists") → `ready` (at least one pull landed).
 * Monotone: `ready` never steps back — later pull failures and reconnect
 * re-pulls ride the `state`/`error` axis, which is where failure is modeled
 * (no `error` phase here; that would duplicate `state`).
 */
/** 中文说明：类型 `SessionListPhase` 约束本文件使用的数据字段和取值范围，避免调用方传入不完整状态。 */
export type SessionListPhase = 'pending' | 'ready'

/** Request-local content hit returned to sidebar search consumers. */
/** 中文说明：类型 `SessionSearchResultItem` 约束本文件使用的数据字段和取值范围，避免调用方传入不完整状态。 */
export interface SessionSearchResultItem {
  sessionId: SessionId
  snippet: string
}

/** Immutable session-list snapshot for useSessionList. */
/** 中文说明：类型 `SessionListSnapshot` 约束本文件使用的数据字段和取值范围，避免调用方传入不完整状态。 */
export interface SessionListSnapshot {
  items: readonly SessionListEntry[]
  /** Selected Session id (validated against items; masked to undefined while its session is off the list). */
  current: SessionId | undefined
  state: 'idle' | 'loading' | 'error'
  /** Arrival lifecycle (see {@link SessionListPhase}); `state` stays the pull-activity axis. */
  phase: SessionListPhase
  error: RpcError | null
  subagentsByParent: Readonly<Record<SessionId, SubagentCatalogSnapshot>>
  /** Background jobs per session; an absent key is an empty set. */
  jobsBySession: Readonly<Record<SessionId, readonly JobView[]>>
  currentAddress: SubagentAddress | undefined
}

/** One parent-addressed durable catalog projected through the sessions snapshot. */
/** 中文说明：类型 `SubagentCatalogSnapshot` 约束本文件使用的数据字段和取值范围，避免调用方传入不完整状态。 */
export interface SubagentCatalogSnapshot extends SubagentCatalog {
  state: 'loading' | 'ready' | 'error'
  error: RpcError | null
}

/** 中文说明：类型 `CatalogInflight` 约束本文件使用的数据字段和取值范围，避免调用方传入不完整状态。 */
interface CatalogInflight {
  readonly promise: Promise<void>
  readonly expandableRows: Set<SessionId>
  readonly activityRows: Map<SessionId, 'running' | 'inactive'>
  /** Removal-time invalidation replayed over the response this request predates. */
  parentAvailableOverride: false | undefined
}

/** 中文说明：类型 `SessionListMutation` 约束本文件使用的数据字段和取值范围，避免调用方传入不完整状态。 */
type SessionListMutation =
  | { kind: 'upsert'; summary: SessionSummary }
  | { kind: 'remove'; sessionId: SessionId }
  | { kind: 'status'; sessionId: SessionId; running: boolean }
  | { kind: 'activity'; sessionId: SessionId; updatedAt: number }
  /** Local first-send flip: the sender clears blank without waiting for a host frame. */
  | { kind: 'engaged'; sessionId: SessionId }

/** Stable identity of a frame retained until an uninstantiated Session can consume it. */
/** 中文说明：内部函数 `bufferedRequestKey`；参数含义见签名，返回值用于后续处理；例如按本文件中的调用位置使用。 */
function bufferedRequestKey(envelope: RpcRequest<MuxFrame>): string | undefined {
  /** 中文说明：当前处理、发送或断言的事件及其数据；变量 `frame` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
  const frame = envelope.payload
  switch (frame.type) {
    case 'approval/requested': return `a:${frame.approvalId}`
    case 'question/requested': return `q:${envelope.rpcId}`
    case 'session/queue': return 'queue'
    /* v8 ignore next -- pendingBuffers contains only the three frame types above. */
    default: return undefined
  }
}

/** Match ui-user-questions's binary plan-review routing at the wire boundary. */
/** 中文说明：内部函数 `questionInteractionStatus`；参数含义见签名，返回值用于后续处理；例如按本文件中的调用位置使用。 */
function questionInteractionStatus(
  questions: Extract<MuxFrame, { type: 'question/requested' }>['questions'],
): PendingInteractionStatus {
  if (questions.length !== 1) return 'question'
  /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `question` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
  const question = questions[0] as typeof questions[number]
  /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `intent` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
  const intent = question.intent
  if (intent?.kind !== 'plan-review' || question.detail === undefined) return 'question'
  if (question.multiSelect === true) return 'question'
  /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `options` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
  const options = question.options ?? []
  if (options.length > 2) return 'question'
  return options.some(option => option.label === intent.approve) ? 'plan-review' : 'question'
}

/** Instance cluster + frame entry + the session list. */
/** 中文说明：类 `SessionManager` 负责封装本文件的核心状态与操作，实例由调用方创建并按生命周期释放。 */
export class SessionManager {
  /** 中文说明：类方法 `sessions`；参数含义见签名，返回值用于更新或读取会话状态；例如由本类公开流程或下方用例调用。 */
  private readonly sessions = new Map<SessionId, Session>()
  /** Pre-instantiation buffer for answerable requests and the queued-turn snapshot, which history
   *  cannot reconstruct on open. Live requests remain until resolution; queue and replay duplicates
   *  compact by identity. Instantiation replays and clears it, while removal drops it. */
  /** 中文说明：类方法 `pendingBuffers`；参数含义见签名，返回值用于更新或读取会话状态；例如由本类公开流程或下方用例调用。 */
  private readonly pendingBuffers = new Map<SessionId, RpcRequest<MuxFrame>[]>()
  /** Outstanding answerable interactions per session, keyed by their stable request identity.
   *  Manager-owned rather than read off Session instances because the sidebar must light up for
   *  sessions never instantiated. Cleared per connection generation — the reopen replay re-adds
   *  still-pending requests — and on session-removed. */
  /** 中文说明：类方法 `pendingInteractions`；参数含义见签名，返回值用于更新或读取会话状态；例如由本类公开流程或下方用例调用。 */
  private readonly pendingInteractions = new Map<SessionId, Map<string, PendingInteractionStatus>>()
  /**
   * Sessions that finished running while not selected — the sidebar's green
   * "done" reminder (manager-owned, survives connection generations; cleared
   * on select and session-removed, re-armed by the next completion).
   */
  /** 中文说明：类方法 `completedNotifications`；参数含义见签名，返回值用于更新或读取会话状态；例如由本类公开流程或下方用例调用。 */
  private readonly completedNotifications = new Set<SessionId>()
  /** Last-observed running bits per session; the true→false edge here arms {@link completedNotifications}. */
  /** 中文说明：类方法 `prevRunning`；参数含义见签名，返回值用于更新或读取会话状态；例如由本类公开流程或下方用例调用。 */
  private readonly prevRunning = new Map<SessionId, boolean>()
  /** Per-session projection value stores, retained independently of instance arrival (the
   *  title-snapshot precedent, generalized): push frames land here whether or not the Session
   *  is instantiated (list rows read the 'title' key), and an instantiated Session adopts the
   *  same store so history-baseline seeding and frames converge on one row set. */
  /** 中文说明：类方法 `projectionStores`；参数含义见签名，返回值用于更新或读取会话状态；例如由本类公开流程或下方用例调用。 */
  private readonly projectionStores = new Map<SessionId, ProjectionValueStore>()
  /** 中文说明：类成员 `summaries` 保存该实例拥有的运行状态；取值范围由声明类型限定，并随实例生命周期使用。 */
  private summaries: SessionSummary[] = []
  /** 中文说明：类成员 `listState` 保存该实例拥有的运行状态；取值范围由声明类型限定，并随实例生命周期使用。 */
  private listState: 'idle' | 'loading' | 'error' = 'idle'
  /** Arrival phase; the pending → ready edge fires on the first successful pull (see SessionListPhase). */
  /** 中文说明：类成员 `listPhase` 保存该实例拥有的运行状态；取值范围由声明类型限定，并随实例生命周期使用。 */
  private listPhase: SessionListPhase = 'pending'
  /** 中文说明：类成员 `listError` 保存该实例拥有的运行状态；取值范围由声明类型限定，并随实例生命周期使用。 */
  private listError: RpcError | null = null
  /** 中文说明：类成员 `listInflight` 保存该实例拥有的运行状态；取值范围由声明类型限定，并随实例生命周期使用。 */
  private listInflight: Promise<void> | null = null
  /** Mutations arriving after a list request starts are replayed over its response. */
  /** 中文说明：类成员 `listMutations` 保存该实例拥有的运行状态；取值范围由声明类型限定，并随实例生命周期使用。 */
  private listMutations: SessionListMutation[] | null = null
  /** 中文说明：类方法 `addresses`；参数含义见签名，返回值用于更新或读取会话状态；例如由本类公开流程或下方用例调用。 */
  private readonly addresses = new Map<SessionId, SubagentAddress>()
  /** 中文说明：类方法 `catalogs`；参数含义见签名，返回值用于更新或读取会话状态；例如由本类公开流程或下方用例调用。 */
  private readonly catalogs = new Map<SessionId, SubagentCatalogSnapshot>()
  /** 中文说明：类方法 `catalogInflight`；参数含义见签名，返回值用于更新或读取会话状态；例如由本类公开流程或下方用例调用。 */
  private readonly catalogInflight = new Map<SessionId, CatalogInflight>()
  /** Catalog owners whose membership changed while a pull was in flight: one trailing refresh after it settles. */
  /** 中文说明：类方法 `catalogStale`；参数含义见签名，返回值用于更新或读取会话状态；例如由本类公开流程或下方用例调用。 */
  private readonly catalogStale = new Set<SessionId>()
  /** 中文说明：类方法 `openCatalogs`；参数含义见签名，返回值用于更新或读取会话状态；例如由本类公开流程或下方用例调用。 */
  private readonly openCatalogs = new Set<SessionId>()
  /** 中文说明：类方法 `catalogDebounce`；参数含义见签名，返回值用于更新或读取会话状态；例如由本类公开流程或下方用例调用。 */
  private readonly catalogDebounce = new Map<SessionId, ReturnType<typeof setTimeout>>()
  /**
   * Background jobs per session, last-wins from `session/jobs`. An empty set
   * is stored as an absent key, so absence and `[]` are one representation.
   */
  /** 中文说明：类方法 `jobsBySession`；参数含义见签名，返回值用于更新或读取会话状态；例如由本类公开流程或下方用例调用。 */
  private readonly jobsBySession = new Map<SessionId, readonly JobView[]>()

  /** 中文说明：类成员 `selected` 保存该实例拥有的运行状态；取值范围由声明类型限定，并随实例生命周期使用。 */
  private selected: SessionId | undefined

  /** 中文说明：类成员 `listSnapshotCache` 保存该实例拥有的运行状态；取值范围由声明类型限定，并随实例生命周期使用。 */
  private listSnapshotCache: SessionListSnapshot
  /** Entry-identity cache (reference stability): list rebuilds reuse the previous entry
   *  object when every field matches — wire refreshes mint all-new summary objects, so identity
   *  must be recovered by value or every SessionListItem memo misses on every refresh. */
  /** 中文说明：类方法 `entryCache`；参数含义见签名，返回值用于更新或读取会话状态；例如由本类公开流程或下方用例调用。 */
  private entryCache = new Map<SessionId, SessionListEntry>()
  /** 中文说明：类成员 `itemsCache` 保存该实例拥有的运行状态；取值范围由声明类型限定，并随实例生命周期使用。 */
  private itemsCache: readonly SessionListEntry[] = []
  /** 中文说明：类成员 `notifier` 保存该实例拥有的运行状态；取值范围由声明类型限定，并随实例生命周期使用。 */
  private readonly notifier = new Notifier(() => {
    this.listSnapshotCache = this.buildListSnapshot()
  })

  /**
   * @param api - shared wire client.
   * @param restoredSelection - persisted real-Session selection candidate.
   */
  /** 中文说明：类方法 `constructor`；参数含义见签名，返回值用于更新或读取会话状态；例如由本类公开流程或下方用例调用。 */
  constructor(
    private readonly api: IApiClient,
    private readonly remote: SessionRemotes,
    restoredSelection?: SessionId,
    restoredAddress?: SubagentAddress,
    private readonly conversation?: ConversationRuntime,
  ) {
    this.selected = restoredSelection
    if (restoredAddress !== undefined) this.addresses.set(restoredAddress.childSessionId, restoredAddress)
    this.listSnapshotCache = this.buildListSnapshot()
  }

  // ---- Selection ----

  /**
   * Select a listed Session or a retained catalog-addressed child.
   * @param sessionId - listed or catalog-addressed Session id.
   */
  /** 中文说明：类方法 `select`；参数含义见签名，返回值用于更新或读取会话状态；例如由本类公开流程或下方用例调用。 */
  select(sessionId: SessionId): void {
    /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `address` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const address = this.navigationAddress(sessionId)
    if (!this.summaries.some(summary => summary.sessionId === sessionId) && address === undefined) {
      throw new Error(`sessions.select: unknown session ${sessionId}`)
    }
    if (address !== undefined) this.addresses.set(sessionId, address)
    this.sessions.get(sessionId)?.configureSubagent(
      address,
      address === undefined
        ? false
        : this.catalogs.get(address.parentSessionId)?.parentAvailable ?? false,
    )
    this.selected = sessionId
    // Looking at the session consumes its completion reminder (dot clears).
    this.completedNotifications.delete(sessionId)
    void this.refreshSubagents(sessionId)
    this.notifier.notifyNow()
  }

  /**
   * Select a healthy child through its durable direct-parent address.
   * @param address - catalog-derived parent and child ids.
   */
  /** 中文说明：类方法 `selectSubagent`；参数含义见签名，返回值用于更新或读取会话状态；例如由本类公开流程或下方用例调用。 */
  selectSubagent(address: SubagentAddress): void {
    /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `catalog` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const catalog = this.catalogs.get(address.parentSessionId)
    /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `entry` 是可调用函数，其参数与返回值见类型签名；例如由相邻流程调用。 */
    const entry = catalog?.entries.find(candidate => candidate.id === address.childSessionId)
    if (entry === undefined || entry.kind !== 'child' || entry.mode !== address.mode) {
      throw new Error(`sessions.selectSubagent: ${address.childSessionId} is not a healthy catalog child`)
    }
    this.addresses.set(address.childSessionId, address)
    this.sessions.get(address.childSessionId)?.configureSubagent(address, catalog?.parentAvailable ?? false)
    this.selected = address.childSessionId
    this.completedNotifications.delete(address.childSessionId)
    void this.refreshSubagents(address.childSessionId)
    this.notifier.notifyNow()
  }

  /** Clear the selection (the layout falls to the no-session view state). */
  /** 中文说明：类方法 `clearSelection`；参数含义见签名，返回值用于更新或读取会话状态；例如由本类公开流程或下方用例调用。 */
  clearSelection(): void {
    this.selected = undefined
    this.notifier.notifyNow()
  }

  /**
   * Return the durable catalog address retained for one child.
   * @param sessionId - possible addressed child id.
   * @returns The direct-parent address, when navigation discovered one.
   */
  /** 中文说明：类方法 `subagentAddress`；参数含义见签名，返回值用于更新或读取会话状态；例如由本类公开流程或下方用例调用。 */
  subagentAddress(sessionId: SessionId): SubagentAddress | undefined {
    return this.addresses.get(sessionId)
  }

  /**
   * Resolve an address for breadcrumb navigation without retaining transport authority.
   * @param sessionId - possible child id in an already-loaded catalog.
   * @returns A retained or catalog-derived direct-parent address.
   */
  /** 中文说明：类方法 `navigationAddress`；参数含义见签名，返回值用于更新或读取会话状态；例如由本类公开流程或下方用例调用。 */
  navigationAddress(sessionId: SessionId): SubagentAddress | undefined {
    /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `retained` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const retained = this.addresses.get(sessionId)
    if (retained !== undefined) return retained
    /** 中文说明：当前会话或对话投影对象；变量 `[parentSessionId` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    for (const [parentSessionId, catalog] of this.catalogs) {
      /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `child` 是可调用函数，其参数与返回值见类型签名；例如由相邻流程调用。 */
      const child = catalog.entries.find(entry => entry.kind === 'child' && entry.id === sessionId)
      if (child?.kind === 'child') {
        return { parentSessionId, childSessionId: sessionId, mode: child.mode }
      }
    }
    return undefined
  }

  // ---- Instance management ----

  /**
   * Drop a session instance (scope-prune companion: instance
   * and scope share one lifecycle). The host session log is the durable
   * truth — a later get() lazily rebuilds and open() backfills history.
   * @param sessionId - the session to drop.
   */
  /** 中文说明：类方法 `drop`；参数含义见签名，返回值用于更新或读取会话状态；例如由本类公开流程或下方用例调用。 */
  drop(sessionId: SessionId): void {
    this.sessions.delete(sessionId)
  }

  /**
   * Lazy build: return the existing instance or construct one (no auto-open —
   * open is triggered by the container's select callback).
   * @param sessionId - the session to get.
   * @returns the resident instance.
   */
  /** 中文说明：类方法 `get`；参数含义见签名，返回值用于更新或读取会话状态；例如由本类公开流程或下方用例调用。 */
  get(sessionId: SessionId): Session {
    /** 中文说明：当前会话或对话投影对象；变量 `session` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    let session = this.sessions.get(sessionId)
    if (session === undefined) {
      session = this.createSession(sessionId)
      this.sessions.set(sessionId, session)
      // Replay approval/question/queued frames buffered before instantiation (rpcId
      // verbatim, same semantics as the subscribed baseline replay). Replay happens
      // BEFORE the running-bit sync: a not-running summary must sweep replayed queue
      // rows the same way a live status flip would (their retirement events dropped
      // while the session was uninstantiated).
      /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `buffered` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
      const buffered = this.pendingBuffers.get(sessionId)
      if (buffered !== undefined) {
        this.pendingBuffers.delete(sessionId)
        /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `envelope` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
        for (const envelope of buffered) session.handleMuxEnvelope(envelope.rpcId, envelope.payload)
      }
      // Sync the running and blank bits from the list snapshot into the new
      // instance (consistency when the list precedes open).
      /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `summary` 是可调用函数，其参数与返回值见类型签名；例如由相邻流程调用。 */
      const summary = this.summaries.find(s => s.sessionId === sessionId)
      if (summary !== undefined) {
        session.handleBlank(summary.blank)
        session.handleRunning(summary.running)
      } else {
        /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `address` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
        const address = this.addresses.get(sessionId)
        /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `child` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
        const child = address === undefined ? undefined : this.catalogs.get(address.parentSessionId)?.entries
          .find(entry => entry.kind === 'child' && entry.id === sessionId)
        if (child?.kind === 'child') {
          // A catalogued child exists only after its delegated session has
          // durable history, even though child rows do not carry `blank`.
          session.handleBlank(false)
          session.handleRunning(child.activity === 'running')
        }
      }
    }
    return session
  }

  /** 中文说明：类方法 `createSession`；参数含义见签名，返回值用于更新或读取会话状态；例如由本类公开流程或下方用例调用。 */
  private createSession(sessionId: SessionId): Session {
    /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `address` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const address = this.addresses.get(sessionId)
    return new Session(sessionId, this.api, this.remote, {
      ...(address === undefined ? {} : {
        address,
        parentAvailable: this.catalogs.get(address.parentSessionId)?.parentAvailable ?? false,
      }),
      // The sender's local first-send flip mirrors into the list row so the
      // session surfaces (lists filter on blank) before any host frame lands.
      onEngaged: (engaged) => {
        this.recordMutation({ kind: 'engaged', sessionId: engaged.sessionId })
      },
      projections: this.projectionStore(sessionId),
      ...this.conversation === undefined ? {} : { conversation: this.conversation },
    })
  }

  /** Rebuild every resident Session after one coalesced registry transaction. */
  /** 中文说明：类方法 `rebuildConversationRegistry`；参数含义见签名，返回值用于更新或读取会话状态；例如由本类公开流程或下方用例调用。 */
  rebuildConversationRegistry(): void {
    /** 中文说明：当前会话或对话投影对象；变量 `session` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    for (const session of this.sessions.values()) session.rebuildConversationRegistry()
  }

  /** Resident per-session projection store (create-on-demand; outlives instantiation). */
  /** 中文说明：类方法 `projectionStore`；参数含义见签名，返回值用于更新或读取会话状态；例如由本类公开流程或下方用例调用。 */
  private projectionStore(sessionId: SessionId): ProjectionValueStore {
    /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `store` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    let store = this.projectionStores.get(sessionId)
    if (store === undefined) {
      store = new ProjectionValueStore()
      // List rows project off store keys (title); any-key changes re-enter
      // the manager's own batched rebuild channel.
      store.subscribeAny(() => { this.notifier.markDirty() })
      this.projectionStores.set(sessionId, store)
    }
    return store
  }

  /**
   * Refresh one direct-child catalog, reusing its in-flight request.
   * @param parentSessionId - catalog owner.
   */
  /** 中文说明：类方法 `refreshSubagents`；参数含义见签名，返回值用于更新或读取会话状态；例如由本类公开流程或下方用例调用。 */
  refreshSubagents(parentSessionId: SessionId): Promise<void> {
    /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `existing` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const existing = this.catalogInflight.get(parentSessionId)
    if (existing !== undefined) return existing.promise
    /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `previous` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const previous = this.catalogs.get(parentSessionId)
    /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `expandableRows` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const expandableRows = new Set<SessionId>()
    /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `activityRows` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const activityRows = new Map<SessionId, 'running' | 'inactive'>()
    this.catalogs.set(parentSessionId, {
      entries: previous?.entries ?? [],
      parentAvailable: previous?.parentAvailable ?? false,
      state: 'loading',
      error: null,
    })
    this.notifier.markDirty()
    /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `operation` 是可调用函数，其参数与返回值见类型签名；例如由相邻流程调用。 */
    const operation = (async () => {
      try {
        /** 中文说明：当前异步操作的请求或结果；变量 `{ result }` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
        const { result } = await this.api.subagents.list({ parentSessionId })
        if (result.ok) {
          /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `parentAvailable` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
          const parentAvailable = this.catalogInflight.get(parentSessionId)?.parentAvailableOverride
            ?? result.value.parentAvailable
          this.catalogs.set(parentSessionId, {
            ...result.value,
            entries: this.withCatalogMutations(result.value.entries, expandableRows, activityRows),
            parentAvailable,
            state: 'ready',
            error: null,
          })
          /** 中文说明：标识对象、顺序或版本的标量值；变量 `[childId` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
          for (const [childId, address] of this.addresses) {
            if (address.parentSessionId !== parentSessionId) continue
            this.sessions.get(childId)?.handleSubagentParentAvailable(parentAvailable)
          }
        } else {
          this.catalogs.set(parentSessionId, {
            entries: this.withCatalogMutations(
              previous?.entries ?? [], expandableRows, activityRows,
            ),
            parentAvailable: this.catalogInflight.get(parentSessionId)?.parentAvailableOverride
              ?? previous?.parentAvailable ?? false,
            state: 'error',
            error: result.error,
          })
        }
      } catch (error: unknown) {
        /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `folded` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
        const folded = transportError<never>(error)
        this.catalogs.set(parentSessionId, {
          entries: this.withCatalogMutations(
            previous?.entries ?? [], expandableRows, activityRows,
          ),
          parentAvailable: this.catalogInflight.get(parentSessionId)?.parentAvailableOverride
            ?? previous?.parentAvailable ?? false,
          state: 'error',
          error: folded.ok ? null : folded.error,
        })
      } finally {
        this.catalogInflight.delete(parentSessionId)
        // Re-arm the trailing pull before the dirty notify: the response the
        // caller observed predates the stale-marking change, so the follow-up
        // refresh is the only carrier of that change.
        if (this.catalogStale.delete(parentSessionId)) void this.refreshSubagents(parentSessionId)
        this.notifier.markDirty()
      }
    })()
    this.catalogInflight.set(parentSessionId, {
      promise: operation,
      expandableRows,
      activityRows,
      parentAvailableOverride: undefined,
    })
    return operation
  }

  /**
   * Mark whether a catalog menu is consuming live membership updates.
   * @param parentSessionId - catalog owner.
   * @param open - current menu state.
   */
  /** 中文说明：类方法 `setSubagentCatalogOpen`；参数含义见签名，返回值用于更新或读取会话状态；例如由本类公开流程或下方用例调用。 */
  setSubagentCatalogOpen(parentSessionId: SessionId, open: boolean): void {
    if (open) {
      this.openCatalogs.add(parentSessionId)
      void this.refreshSubagents(parentSessionId)
    } else {
      this.openCatalogs.delete(parentSessionId)
      /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `timer` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
      const timer = this.catalogDebounce.get(parentSessionId)
      if (timer !== undefined) {
        clearTimeout(timer)
        this.catalogDebounce.delete(parentSessionId)
      }
    }
  }

  // ---- List API ----

  /** Full refresh via session.list (single-flight: an in-flight call is reused). */
  /** 中文说明：类方法 `refreshList`；参数含义见签名，返回值用于更新或读取会话状态；例如由本类公开流程或下方用例调用。 */
  refreshList(): Promise<void> {
    if (this.listInflight !== null) return this.listInflight
    this.listState = 'loading'
    this.listError = null
    /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `established` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const established = this.summaries
    /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `mutations` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const mutations: SessionListMutation[] = []
    this.listMutations = mutations
    this.notifier.markDirty()
    this.listInflight = (async () => {
      try {
        /** 中文说明：当前异步操作的请求或结果；变量 `{ result }` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
        const { result } = await this.api.sessions.list({})
        if (result.ok) {
          /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `baseline` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
          const baseline = this.listPhase === 'pending'
            ? result.value.items
            : mergeOrderedBaseline(established, result.value.items, summary => summary.sessionId)
          // Seed first observations from the pull-time baseline BEFORE replaying
          // in-flight mutations, then reconcile the reminders after EVERY
          // replayed mutation: an edge that happens entirely between mutations
          // (baseline idle → running → idle) must still arm, which a single
          // sync on the folded result would collapse away.
          /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `s` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
          for (const s of baseline) {
            if (!this.prevRunning.has(s.sessionId)) this.prevRunning.set(s.sessionId, s.running)
          }
          /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `summaries` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
          let summaries = baseline
          /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `mutation` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
          for (const mutation of mutations) {
            summaries = applyMutation(summaries, mutation)
            this.summaries = summaries
            this.syncCompletedNotifications()
          }
          this.summaries = summaries
          this.listState = 'idle'
          this.listPhase = 'ready'
          // Covers the empty-mutations pull (a plain baseline carries no edge).
          this.syncCompletedNotifications()
          // Push running/blank bits down to instantiated Sessions (the list is the authoritative summary source).
          /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `s` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
          for (const s of this.summaries) {
            /** 中文说明：当前会话或对话投影对象；变量 `session` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
            const session = this.sessions.get(s.sessionId)
            if (session === undefined) continue
            session.handleBlank(s.blank)
            session.handleRunning(s.running)
          }
          // Seed each row's projection baseline into the per-session value
          // store (cold titles surface without opening the session). Per-key
          // apply, not seed(): the list block is a partial baseline — the
          // cold cache serves only version-matching keys — so an absent key
          // must not clear; higher-seq-wins still keeps a stale list block
          // from overwriting a newer push frame or tail baseline.
          /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `s` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
          for (const s of result.value.items) {
            /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `block` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
            const block = s.projections
            if (block === undefined) continue
            /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `store` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
            const store = this.projectionStore(s.sessionId)
            /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `values` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
            const values = block.values as Record<string, unknown>
            /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `key` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
            for (const key of Object.keys(values)) store.apply(key, values[key], block.asOfSeq)
          }
        } else {
          this.listState = 'error'
          this.listError = result.error
        }
      } catch (error) {
        this.listState = 'error'
        /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `folded` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
        const folded = transportError<never>(error)
        /* v8 ignore next -- the `? null` arm is unreachable: transportError always returns ok:false. */
        this.listError = folded.ok ? null : folded.error
      } finally {
        this.listMutations = null
        this.listInflight = null
        this.notifier.markDirty()
      }
    })()
    return this.listInflight
  }

  /**
   * Search visible session message content without adding transient query
   * state to the list snapshot.
   * @param query - non-blank literal phrase.
   * @param signal - cancellation for superseded UI queries.
   * @returns the Host result or a folded transport error.
   */
  async search(
    query: string,
    signal: AbortSignal,
  ): Promise<RpcResult<{ items: SessionSearchResultItem[]; hasMore: boolean }>> {
    try {
      return (await this.api.sessions.search({ query }, signal)).result
    } catch (error: unknown) {
      return transportError(error)
    }
  }

  /**
   * Contract session.create; on success merge into summaries immediately (no
   * wait for the next refresh). A created session is blank by definition
   * (entity birth precedes the first message).
   * @param opts - target workspace or working directory, plus an optional caller-owned id.
   * @returns the create result.
   */
  async create(
    opts: { workspaceId?: WorkspaceId; cwd?: string; sessionId?: SessionId } = {},
  ): Promise<RpcResult<{ sessionId: SessionId }>> {
    try {
      /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `shared` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
      const shared = opts.sessionId === undefined ? {} : { sessionId: opts.sessionId }
      /** 中文说明：当前处理、发送或断言的事件及其数据；变量 `payload` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
      const payload = opts.workspaceId !== undefined
        ? { workspaceId: opts.workspaceId, ...shared }
        : { ...(opts.cwd === undefined ? {} : { cwd: opts.cwd }), ...shared }
      /** 中文说明：当前异步操作的请求或结果；变量 `{ result }` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
      const { result } = await this.api.sessions.create(payload)
      if (result.ok) {
        this.recordMutation({ kind: 'upsert', summary: {
          sessionId: result.value.sessionId, updatedAt: Date.now(), running: false, blank: true,
          ...(opts.cwd !== undefined ? { cwd: opts.cwd } : {}),
          ...(result.value.agentPreset !== undefined ? { agentPreset: result.value.agentPreset } : {}),
        } })
      } else {
        /** 中文说明：当前会话或对话投影对象；变量 `publishedSessionId` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
        const publishedSessionId = workspaceAttachSessionId(result.error)
        // Publication precedes attachment. The error's id is a real Session,
        // so expose it immediately as Ungrouped while the caller keeps the
        // prompt buffer and decides whether to retry attachment.
        if (publishedSessionId !== undefined) {
          this.recordMutation({ kind: 'upsert', summary: {
            sessionId: publishedSessionId,
            updatedAt: Date.now(),
            running: false,
            blank: true,
          } })
        }
      }
      return result
    } catch (error) {
      return transportError(error)
    }
  }

  /**
   * Contract session.fork; on success merge the child into summaries
   * immediately (same synchronous-addressability guarantee as create). The
   * child carries the source's history, so it is never blank; lineage rides
   * parentSessionId so the list nests it under its source. A child published
   * before Workspace attachment fails is also reconciled into the list.
   * @param opts - source session and the optional seq anchoring the cut.
   * @returns the fork result (the child session id).
   */
  async fork(
    opts: { sessionId: SessionId; atSeq?: number },
  ): Promise<RpcResult<{ sessionId: SessionId }>> {
    try {
      /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `source` 是可调用函数，其参数与返回值见类型签名；例如由相邻流程调用。 */
      const source = this.summaries.find(s => s.sessionId === opts.sessionId)
      /** 中文说明：当前异步操作的请求或结果；变量 `{ result }` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
      const { result } = await this.api.sessions.fork({
        sessionId: opts.sessionId,
        ...opts.atSeq === undefined ? {} : { atSeq: opts.atSeq },
      })
      /** 中文说明：标识对象、顺序或版本的标量值；变量 `childId` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
      const childId = result.ok
        ? result.value.sessionId
        : workspaceAttachSessionId(result.error)
      if (childId !== undefined) {
        this.recordMutation({ kind: 'upsert', summary: {
          sessionId: childId, updatedAt: Date.now(), running: false, blank: false,
          parentSessionId: opts.sessionId,
          ...(source?.cwd !== undefined ? { cwd: source.cwd } : {}),
        } })
      }
      return result
    } catch (error) {
      return transportError(error)
    }
  }

  /**
   * Insert-or-enrich a locally synthesized summary: a new id prepends; an
   * existing entry only gains fields it lacks (the session-added frame and the
   * create() echo race — whichever lands second must fill the placeholder's
   * missing cwd/parentSessionId, never overwrite list-refresh data).
   */
  /** 中文说明：类方法 `mergeSummary`；参数含义见签名，返回值用于更新或读取会话状态；例如由本类公开流程或下方用例调用。 */
  private mergeSummary(summary: SessionSummary): void {
    this.recordMutation({ kind: 'upsert', summary })
  }

  /**
   * Record a host-confirmed composition switch (see ISessions.noteAgentPreset).
   * @param sessionId - the switched session.
   * @param agentPreset - the preset id the host confirmed.
   */
  /** 中文说明：类方法 `noteAgentPreset`；参数含义见签名，返回值用于更新或读取会话状态；例如由本类公开流程或下方用例调用。 */
  noteAgentPreset(sessionId: SessionId, agentPreset: string): void {
    this.recordMutation({ kind: 'upsert', summary: {
      sessionId, updatedAt: Date.now(), running: false, blank: true, agentPreset,
    } })
  }

  /** Apply immediately and retain for replay when a list response is in flight. */
  /** 中文说明：类方法 `recordMutation`；参数含义见签名，返回值用于更新或读取会话状态；例如由本类公开流程或下方用例调用。 */
  private recordMutation(mutation: SessionListMutation): void {
    this.listMutations?.push(mutation)
    this.summaries = applyMutation(this.summaries, mutation)
    // Eager edge reconciliation — a snapshot-build-time pass would miss consecutive status frames.
    this.syncCompletedNotifications()
    this.notifier.markDirty()
  }

  // ---- Subscription API (for useSessionList) ----

  /**
   * uSES subscription entry for useSessionList.
   * @param listener - change callback.
   * @returns the unsubscribe function.
   */
  /** 中文说明：类成员 `subscribe` 保存该实例拥有的运行状态；取值范围由声明类型限定，并随实例生命周期使用。 */
  subscribe(listener: () => void): () => void {
    return this.notifier.subscribe(listener)
  }

  /**
   * Cached list snapshot (rebuilt lazily when dirty with no listeners).
   * @returns the cached reference (stable until the next flush).
   */
  /** 中文说明：类方法 `getListSnapshot`；参数含义见签名，返回值用于更新或读取会话状态；例如由本类公开流程或下方用例调用。 */
  getListSnapshot(): SessionListSnapshot {
    this.notifier.ensureFresh()
    return this.listSnapshotCache
  }

  /** Add or refresh one stable pending-interaction identity. */
  /** 中文说明：类方法 `trackPending`；参数含义见签名，返回值用于更新或读取会话状态；例如由本类公开流程或下方用例调用。 */
  private trackPending(sessionId: SessionId, key: string, status: PendingInteractionStatus): void {
    /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `interactions` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    let interactions = this.pendingInteractions.get(sessionId)
    if (interactions === undefined) {
      interactions = new Map()
      this.pendingInteractions.set(sessionId, interactions)
    }
    if (interactions.get(key) === status) return
    interactions.set(key, status)
    this.notifier.markDirty()
  }

  /** Settle one pending-interaction identity without disturbing sibling waits. */
  /** 中文说明：类方法 `resolvePending`；参数含义见签名，返回值用于更新或读取会话状态；例如由本类公开流程或下方用例调用。 */
  private resolvePending(sessionId: SessionId, key: string): void {
    /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `interactions` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const interactions = this.pendingInteractions.get(sessionId)
    if (interactions === undefined || !interactions.delete(key)) return
    if (interactions.size === 0) this.pendingInteractions.delete(sessionId)
    this.notifier.markDirty()
  }

  // ---- ConnectionController sinks (wired by boot) ----

  /**
   * Mux frame entry: sessionId-bearing frames go only to instantiated sessions
   * (no lazy build; non-pending frames for uninstantiated sessions drop —
   * history backfills them on open).
   * @param envelope - the frame with its wire rpcId.
   */
  /** 中文说明：类方法 `handleMuxEnvelope`；参数含义见签名，返回值用于更新或读取会话状态；例如由本类公开流程或下方用例调用。 */
  handleMuxEnvelope(envelope: RpcRequest<MuxFrame>): void {
    /** 中文说明：当前处理、发送或断言的事件及其数据；变量 `frame` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const frame = envelope.payload
    if (frame.type === 'stream/error') return // Controller already treats this as stream failure
    if (
      frame.type === 'session/event'
      && frame.event.type === 'user/message'
      && frame.event.data.source.kind === 'user'
    ) {
      // session.list supplies the cold baseline, while a direct prompt or an
      // admitted steer advances it between pulls. Max keeps replayed or
      // repaired older user messages from moving the row backwards.
      this.recordMutation({ kind: 'activity', sessionId: frame.sessionId, updatedAt: frame.event.time })
    }
    if (frame.type === 'session/projection') {
      // Finished host-computed value: land it in the resident store whether or
      // not the Session is instantiated (list rows read the 'title' key). The
      // synchronous markDirty keeps the list snapshot same-tick fresh (the
      // store's own any-key channel is microtask-batched).
      this.projectionStore(frame.sessionId).apply(frame.key, frame.value, frame.seq)
      this.notifier.markDirty()
      return
    }
    if (frame.type === 'session/jobs') {
      // Whole-set snapshot, so last-wins with no reconciliation. The Host omits
      // the baseline for an empty set, which is the same fact an emptying change
      // reports as `[]` — both land as an absent key.
      if (frame.jobs.length === 0) this.jobsBySession.delete(frame.sessionId)
      else this.jobsBySession.set(frame.sessionId, frame.jobs)
      this.notifier.markDirty()
      return
    }
    if (frame.type === 'session/subscribed') {
      // Rows past the host's durable baseline rode state a restart lost; drop
      // them so last-wins cannot pin a phantom value over recomputed truth.
      this.projectionStores.get(frame.sessionId)?.truncate(frame.lastSeq)
      // Same re-baseline reasoning as the queue below: this generation sends a
      // task baseline only when the set is non-empty, so a mirror kept from the
      // previous generation would survive as a phantom list.
      this.jobsBySession.delete(frame.sessionId)
      this.notifier.markDirty()
      // New mux-generation baseline: discard the previous queue snapshot.
      // The host omits session/queue when the live queue is empty, so retaining
      // it could replay stale work when the Session is instantiated later.
      // This is the same re-baseline signal Session uses for its own mirror.
      /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `buffered` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
      const buffered = this.pendingBuffers.get(frame.sessionId)
      if (buffered !== undefined) {
        /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `kept` 是可调用函数，其参数与返回值见类型签名；例如由相邻流程调用。 */
        const kept = buffered.filter(item => item.payload.type !== 'session/queue')
        if (kept.length !== buffered.length) {
          if (kept.length === 0) this.pendingBuffers.delete(frame.sessionId)
          else this.pendingBuffers.set(frame.sessionId, kept)
        }
      }
    }
    // List-level pending-interaction status (the sidebar amber dot): tracked
    // for every session, instantiated or not; stable keys make replays idempotent.
    if (frame.type === 'approval/requested') {
      this.trackPending(frame.sessionId, `a:${frame.approvalId}`, 'approval')
    } else if (frame.type === 'approval/resolved') {
      this.resolvePending(frame.sessionId, `a:${frame.approvalId}`)
    } else if (frame.type === 'question/requested') {
      this.trackPending(
        frame.sessionId,
        `q:${envelope.rpcId}`,
        questionInteractionStatus(frame.questions),
      )
    } else if (frame.type === 'question/resolved') {
      this.resolvePending(frame.sessionId, `q:${frame.questionRpcId}`)
    }
    /** 中文说明：当前会话或对话投影对象；变量 `session` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const session = this.sessions.get(frame.sessionId)
    if (session === undefined) {
      // Answerable requests never hit history: retain each live identity until
      // instantiation, compacting replay duplicates and resolutions so list
      // status cannot outlive the PendingWait the user would need to answer.
      // Queue is a latest-value snapshot; everything else drops because open
      // backfills it from history.
      switch (frame.type) {
        case 'approval/requested':
        case 'question/requested':
        case 'session/queue': {
          /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `buffer` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
          const buffer = this.pendingBuffers.get(frame.sessionId) ?? []
          /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `key` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
          const key = frame.type === 'approval/requested'
            ? `a:${frame.approvalId}`
            : frame.type === 'question/requested' ? `q:${envelope.rpcId}` : 'queue'
          /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `prior` 是可调用函数，其参数与返回值见类型签名；例如由相邻流程调用。 */
          const prior = buffer.findIndex(item => bufferedRequestKey(item) === key)
          if (prior === -1) buffer.push(envelope)
          else buffer[prior] = envelope
          this.pendingBuffers.set(frame.sessionId, buffer)
          return
        }
        case 'approval/resolved':
        case 'question/resolved': {
          /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `buffer` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
          const buffer = this.pendingBuffers.get(frame.sessionId)
          if (buffer === undefined) return
          /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `key` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
          const key = frame.type === 'approval/resolved'
            ? `a:${frame.approvalId}`
            : `q:${frame.questionRpcId}`
          /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `prior` 是可调用函数，其参数与返回值见类型签名；例如由相邻流程调用。 */
          const prior = buffer.findIndex(item => bufferedRequestKey(item) === key)
          if (prior !== -1) buffer.splice(prior, 1)
          if (buffer.length === 0) this.pendingBuffers.delete(frame.sessionId)
          return
        }
        default:
          return
      }
    }
    session.handleMuxEnvelope(envelope.rpcId, frame)
  }

  /**
   * Host frame entry: list upkeep + per-instance running/removed/agent-error relay.
   * @param envelope - the frame with its wire rpcId.
   */
  /** 中文说明：类方法 `handleHostEnvelope`；参数含义见签名，返回值用于更新或读取会话状态；例如由本类公开流程或下方用例调用。 */
  handleHostEnvelope(envelope: RpcRequest<HostFrame>): void {
    /** 中文说明：当前处理、发送或断言的事件及其数据；变量 `frame` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const frame = envelope.payload
    switch (frame.type) {
      case 'host/session-added': {
        this.mergeSummary({
          sessionId: frame.sessionId, updatedAt: Date.now(), running: false, blank: frame.blank,
          ...(frame.parentSessionId !== undefined ? { parentSessionId: frame.parentSessionId } : {}),
          ...(frame.origin !== undefined ? { origin: frame.origin } : {}),
          ...(frame.cwd !== undefined ? { cwd: frame.cwd } : {}),
          ...(frame.agentPreset !== undefined ? { agentPreset: frame.agentPreset } : {}),
        })
        this.sessions.get(frame.sessionId)?.handleBlank(frame.blank)
        if (frame.origin === 'subagent' && frame.parentSessionId !== undefined) {
          this.markCatalogParentExpandable(frame.parentSessionId)
        }
        if (frame.parentSessionId !== undefined
          && (this.selected === frame.parentSessionId || this.openCatalogs.has(frame.parentSessionId))) {
          this.scheduleCatalogRefresh(frame.parentSessionId)
        }
        return
      }
      case 'host/session-removed': {
        /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `summary` 是可调用函数，其参数与返回值见类型签名；例如由相邻流程调用。 */
        const summary = this.summaries.find(candidate => candidate.sessionId === frame.sessionId)
        /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `durableSubagent` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
        const durableSubagent = summary?.origin === 'subagent' || this.addresses.has(frame.sessionId)
        this.recordMutation(durableSubagent
          ? { kind: 'status', sessionId: frame.sessionId, running: false }
          : { kind: 'remove', sessionId: frame.sessionId })
        this.updateCatalogActivity(frame.sessionId, false)
        if (durableSubagent) {
          // An Activation detaching is not durable child deletion:
          // keep its lineage and conversation while returning it to idle.
          this.sessions.get(frame.sessionId)?.handleRunning(false)
        } else {
          this.sessions.get(frame.sessionId)?.handleRemoved()
        }
        this.pendingBuffers.delete(frame.sessionId) // a removed session's buffered frames must not replay on a future instantiation
        this.pendingInteractions.delete(frame.sessionId) // a removed session cannot wait on anyone
        // Owner disposal already dropped these registry-side, but that lands on
        // the mux stream while this frame rides the host stream, so the two have
        // no relative order. Clearing here makes a detached Activation's rows
        // disappear whichever arrives first.
        this.jobsBySession.delete(frame.sessionId)
        if (!durableSubagent) this.projectionStores.delete(frame.sessionId)
        // A pull already in flight was requested before this removal and can
        // carry the pre-removal parentAvailable:true, which would resurrect
        // the writable editor this invalidation just closed. Replay false over
        // that response and queue one trailing refresh so the post-removal
        // host truth converges.
        /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `inflightCatalog` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
        const inflightCatalog = this.catalogInflight.get(frame.sessionId)
        if (inflightCatalog !== undefined) {
          inflightCatalog.parentAvailableOverride = false
          this.catalogStale.add(frame.sessionId)
        }
        // The removed session can no longer be the delivery owner of its
        // catalog: invalidate availability immediately. Removal schedules no
        // catalog refresh, and without this an addressed child keeps a
        // writable editor against a dead continuation owner until an
        // unrelated refresh (or forever, for a closed menu).
        /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `ownedCatalog` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
        const ownedCatalog = this.catalogs.get(frame.sessionId)
        if (ownedCatalog !== undefined && ownedCatalog.parentAvailable) {
          this.catalogs.set(frame.sessionId, { ...ownedCatalog, parentAvailable: false })
        }
        /** 中文说明：标识对象、顺序或版本的标量值；变量 `[childId` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
        for (const [childId, address] of this.addresses) {
          if (address.parentSessionId !== frame.sessionId) continue
          this.sessions.get(childId)?.handleSubagentParentAvailable(false)
        }
        return
      }
      case 'host/session-status': {
        this.recordMutation({ kind: 'status', sessionId: frame.sessionId, running: frame.running })
        this.sessions.get(frame.sessionId)?.handleRunning(frame.running)
        this.updateCatalogActivity(frame.sessionId, frame.running)
        return
      }
      case 'host/agent-error': {
        this.sessions.get(frame.sessionId)?.handleAgentError(frame.message)
        return // not reflected in the list
      }
      default:
        return // stream/error ignored; unknown frames ignored (documented default)
    }
  }

  /**
   * The moment a connection generation dies (before any next-generation frame
   * can arrive — onConnected waits for the readiness handshake while replayed
   * frames flow from stream open, so clearing there would race the replay):
   * drop generation-scoped live state. Interactions resolved while disconnected
   * send no frame, so stale statuses and buffered answerable frames must not
   * survive into the next generation — mux-open replay re-adds every still-pending
   * request with its live rpcId.
  */
  /** 中文说明：类方法 `handleDisconnected`；参数含义见签名，返回值用于更新或读取会话状态；例如由本类公开流程或下方用例调用。 */
  handleDisconnected(): void {
    if (this.pendingInteractions.size > 0) {
      this.pendingInteractions.clear()
      this.notifier.markDirty()
    }
    /** 中文说明：当前会话或对话投影对象；变量 `[sessionId` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    for (const [sessionId, buffer] of [...this.pendingBuffers]) {
      /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `kept` 是可调用函数，其参数与返回值见类型签名；例如由相邻流程调用。 */
      const kept = buffer.filter(item =>
        item.payload.type !== 'approval/requested' && item.payload.type !== 'question/requested')
      if (kept.length === buffer.length) continue
      if (kept.length === 0) this.pendingBuffers.delete(sessionId)
      else this.pendingBuffers.set(sessionId, kept)
    }
  }

  /** After each connection generation: refresh the session baseline and rebuild opened windows. */
  /** 中文说明：类方法 `handleConnected`；参数含义见签名，返回值用于更新或读取会话状态；例如由本类公开流程或下方用例调用。 */
  handleConnected(): void {
    void this.refreshList()
    /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `selectedAddress` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const selectedAddress = this.selected === undefined ? undefined : this.addresses.get(this.selected)
    if (selectedAddress !== undefined) void this.refreshSubagents(selectedAddress.parentSessionId)
    if (this.selected !== undefined) void this.refreshSubagents(this.selected)
    /** 中文说明：当前会话或对话投影对象；变量 `parentSessionId` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    for (const parentSessionId of this.openCatalogs) void this.refreshSubagents(parentSessionId)
    /** 中文说明：当前会话或对话投影对象；变量 `session` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    for (const session of this.sessions.values()) void session.resync()
  }

  /** Debounce membership refetches while one parent catalog is selected or open. */
  /** 中文说明：类方法 `scheduleCatalogRefresh`；参数含义见签名，返回值用于更新或读取会话状态；例如由本类公开流程或下方用例调用。 */
  private scheduleCatalogRefresh(parentSessionId: SessionId): void {
    if (this.catalogDebounce.has(parentSessionId)) return
    /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `timer` 是可调用函数，其参数与返回值见类型签名；例如由相邻流程调用。 */
    const timer = setTimeout(() => {
      this.catalogDebounce.delete(parentSessionId)
      // The in-flight response predates the membership frame that scheduled
      // this callback. Queue one post-settlement pull instead of treating an
      // ordinary overlapping read as evidence that catalog membership changed.
      if (this.catalogInflight.has(parentSessionId)) {
        this.catalogStale.add(parentSessionId)
        return
      }
      void this.refreshSubagents(parentSessionId)
    }, 50)
    this.catalogDebounce.set(parentSessionId, timer)
  }

  /** Apply one Agent-driver transition to loaded and in-flight catalogs. */
  /** 中文说明：类方法 `updateCatalogActivity`；参数含义见签名，返回值用于更新或读取会话状态；例如由本类公开流程或下方用例调用。 */
  private updateCatalogActivity(childSessionId: SessionId, running: boolean): void {
    /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `activity` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const activity = running ? 'running' as const : 'inactive' as const
    /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `inflight` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    for (const inflight of this.catalogInflight.values()) {
      inflight.activityRows.set(childSessionId, activity)
    }
    /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `changed` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    let changed = false
    /** 中文说明：当前会话或对话投影对象；变量 `[parentSessionId` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    for (const [parentSessionId, catalog] of this.catalogs) {
      if (!catalog.entries.some(entry =>
        entry.kind === 'child' && entry.id === childSessionId && entry.activity !== activity)) continue
      /** 中文说明：保存索引、集合或按顺序观测值的数据结构；变量 `entries` 是可调用函数，其参数与返回值见类型签名；例如由相邻流程调用。 */
      const entries = catalog.entries.map((entry) => {
        if (entry.kind !== 'child' || entry.id !== childSessionId) return entry
        return { ...entry, activity }
      })
      changed = true
      this.catalogs.set(parentSessionId, { ...catalog, entries })
    }
    if (changed) this.notifier.markDirty()
  }

  /** Preserve and project a positive expandability hint after one direct subagent publishes. */
  /** 中文说明：类方法 `markCatalogParentExpandable`；参数含义见签名，返回值用于更新或读取会话状态；例如由本类公开流程或下方用例调用。 */
  private markCatalogParentExpandable(parentSessionId: SessionId): void {
    this.applyCatalogParentExpandable(parentSessionId)
    /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `inflight` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    for (const inflight of this.catalogInflight.values()) inflight.expandableRows.add(parentSessionId)
  }

  /** Apply one positive expandability hint to every loaded catalog containing that unique row id. */
  /** 中文说明：类方法 `applyCatalogParentExpandable`；参数含义见签名，返回值用于更新或读取会话状态；例如由本类公开流程或下方用例调用。 */
  private applyCatalogParentExpandable(parentSessionId: SessionId): void {
    /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `changed` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    let changed = false
    /** 中文说明：标识对象、顺序或版本的标量值；变量 `[catalogParentId` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    for (const [catalogParentId, catalog] of this.catalogs) {
      if (!catalog.entries.some(entry =>
        entry.kind === 'child' && entry.id === parentSessionId && !entry.hasChildren)) continue
      /** 中文说明：保存索引、集合或按顺序观测值的数据结构；变量 `entries` 是可调用函数，其参数与返回值见类型签名；例如由相邻流程调用。 */
      const entries = catalog.entries.map((entry) => {
        if (entry.kind !== 'child' || entry.id !== parentSessionId || entry.hasChildren) return entry
        return { ...entry, hasChildren: true }
      })
      changed = true
      this.catalogs.set(catalogParentId, { ...catalog, entries })
    }
    if (changed) this.notifier.markDirty()
  }

  /** Fold request-local row mutations into one catalog result before publication. */
  /** 中文说明：类方法 `withCatalogMutations`；参数含义见签名，返回值用于更新或读取会话状态；例如由本类公开流程或下方用例调用。 */
  private withCatalogMutations(
    entries: SubagentCatalog['entries'],
    expandableRows: ReadonlySet<SessionId>,
    activityRows: ReadonlyMap<SessionId, 'running' | 'inactive'>,
  ): SubagentCatalog['entries'] {
    return entries.map((entry) => {
      if (entry.kind !== 'child') return entry
      /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `activity` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
      const activity = activityRows.get(entry.id)
      if (!expandableRows.has(entry.id) && activity === undefined) return entry
      return {
        ...entry,
        ...expandableRows.has(entry.id) ? { hasChildren: true } : {},
        ...activity === undefined ? {} : { activity },
      }
    })
  }

  /**
   * Reconcile completion reminders against the latest summaries, eagerly after
   * every mutation and pull (a snapshot-build-time pass would collapse
   * consecutive status frames into one observation). A running→idle edge of a
   * non-selected session arms its reminder; running disarms it; removal drops
   * it. First observation only records the running bit — sessions already
   * idle at load get no reminder.
   */
  /** 中文说明：类方法 `syncCompletedNotifications`；参数含义见签名，返回值用于更新或读取会话状态；例如由本类公开流程或下方用例调用。 */
  private syncCompletedNotifications(): void {
    /** 中文说明：保存索引、集合或按顺序观测值的数据结构；变量 `seen` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const seen = new Set<SessionId>()
    /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `s` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    for (const s of this.summaries) {
      seen.add(s.sessionId)
      /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `prev` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
      const prev = this.prevRunning.get(s.sessionId)
      if (prev === undefined) {
        this.prevRunning.set(s.sessionId, s.running)
        continue
      }
      if (prev && !s.running) {
        if (s.sessionId !== this.selected) this.completedNotifications.add(s.sessionId)
      } else if (s.running) {
        this.completedNotifications.delete(s.sessionId)
      }
      this.prevRunning.set(s.sessionId, s.running)
    }
    /** 中文说明：标识对象、顺序或版本的标量值；变量 `id` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    for (const id of this.prevRunning.keys()) {
      if (!seen.has(id)) this.prevRunning.delete(id)
    }
    /** 中文说明：标识对象、顺序或版本的标量值；变量 `id` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    for (const id of this.completedNotifications) {
      if (!seen.has(id)) this.completedNotifications.delete(id)
    }
  }

  /** 中文说明：类方法 `buildListSnapshot`；参数含义见签名，返回值用于更新或读取会话状态；例如由本类公开流程或下方用例调用。 */
  private buildListSnapshot(): SessionListSnapshot {
    /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `merged` 是可调用函数，其参数与返回值见类型签名；例如由相邻流程调用。 */
    const merged: TitledSessionSummary[] = this.summaries.map((summary) => {
      // List rows read the generic 'title' projection key (host-computed unit
      // value; there is no dedicated title frame).
      /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `projectionStore` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
      const projectionStore = this.projectionStores.get(summary.sessionId)
      /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `title` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
      const title = projectionStore?.get('title')
      /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `projectionValues` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
      const projectionValues = projectionStore?.values()
      return {
        ...summary,
        ...(typeof title === 'string' && title !== '' ? { title } : {}),
        ...(projectionValues === undefined ? {} : { projectionValues }),
      }
    })
    /** 中文说明：协调异步执行顺序或保存待完成工作的 Promise；变量 `pendingInteractions` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const pendingInteractions = new Map<SessionId, PendingInteractionStatus>()
    /** 中文说明：当前会话或对话投影对象；变量 `[sessionId` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    for (const [sessionId, interactions] of this.pendingInteractions) {
      /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `statuses` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
      const statuses = [...interactions.values()]
      // The composer selects the first question ahead of approval. Mirror that
      // answer order so the sidebar names the interaction the user can act on.
      /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `status` 是可调用函数，其参数与返回值见类型签名；例如由相邻流程调用。 */
      const status = statuses.find(candidate => candidate !== 'approval') ?? statuses[0]
      if (status !== undefined) pendingInteractions.set(sessionId, status)
    }
    /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `fresh` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const fresh = flattenLineage(merged, pendingInteractions, this.completedNotifications)
    /** 中文说明：保存索引、集合或按顺序观测值的数据结构；变量 `items` 是可调用函数，其参数与返回值见类型签名；例如由相邻流程调用。 */
    const items = fresh.map((entry) => {
      /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `prev` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
      const prev = this.entryCache.get(entry.sessionId)
      if (
        prev !== undefined && prev.updatedAt === entry.updatedAt && prev.running === entry.running
        && prev.blank === entry.blank && prev.agentPreset === entry.agentPreset
        && prev.parentSessionId === entry.parentSessionId && prev.cwd === entry.cwd
        && prev.origin === entry.origin && prev.title === entry.title && prev.depth === entry.depth
        && prev.pendingInteraction === entry.pendingInteraction
        && prev.projectionValues === entry.projectionValues
        && prev.completed === entry.completed
      ) return prev
      this.entryCache.set(entry.sessionId, entry)
      return entry
    })
    /** 中文说明：标识对象、顺序或版本的标量值；变量 `id` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    for (const id of this.entryCache.keys()) {
      if (!items.some(e => e.sessionId === id)) this.entryCache.delete(id)
    }
    /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `sameOrder` 是可调用函数，其参数与返回值见类型签名；例如由相邻流程调用。 */
    const sameOrder = items.length === this.itemsCache.length && items.every((e, i) => e === this.itemsCache[i])
    if (!sameOrder) this.itemsCache = items
    /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `selected` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const selected = this.selected
    /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `current` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const current = selected !== undefined
      && (items.some(item => item.sessionId === selected) || this.addresses.has(selected))
      ? selected
      : undefined
    return {
      items: this.itemsCache,
      current,
      state: this.listState,
      phase: this.listPhase,
      error: this.listError,
      subagentsByParent: Object.fromEntries(this.catalogs),
      jobsBySession: Object.fromEntries(this.jobsBySession),
      currentAddress: current === undefined ? undefined : this.addresses.get(current),
    }
  }
}

/** Apply one list mutation without deriving display order. */
/** 中文说明：内部函数 `applyMutation`；参数含义见签名，返回值用于后续处理；例如按本文件中的调用位置使用。 */
function applyMutation(summaries: readonly SessionSummary[], mutation: SessionListMutation): SessionSummary[] {
  switch (mutation.kind) {
    case 'upsert': {
      /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `existing` 是可调用函数，其参数与返回值见类型签名；例如由相邻流程调用。 */
      const existing = summaries.find(summary => summary.sessionId === mutation.summary.sessionId)
      if (existing === undefined) return [mutation.summary, ...summaries]
      /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `filled` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
      const filled: SessionSummary = {
        ...existing,
        // Blank only lowers: a stale true (session-added racing the local
        // first send) never re-hides an already-surfaced session.
        blank: existing.blank && mutation.summary.blank,
        ...(existing.cwd === undefined && mutation.summary.cwd !== undefined ? { cwd: mutation.summary.cwd } : {}),
        ...(existing.parentSessionId === undefined && mutation.summary.parentSessionId !== undefined
          ? { parentSessionId: mutation.summary.parentSessionId } : {}),
        ...(existing.origin === undefined && mutation.summary.origin !== undefined
          ? { origin: mutation.summary.origin } : {}),
        // Newest wins, not fill-only: a blank-session preset switch replaces
        // the creation-time value, and every producer of this field (the
        // create echo, the select echo, a list row) reports the CURRENT one.
        ...(mutation.summary.agentPreset !== undefined
          ? { agentPreset: mutation.summary.agentPreset } : {}),
      }
      if (filled.cwd === existing.cwd && filled.parentSessionId === existing.parentSessionId
        && filled.origin === existing.origin && filled.blank === existing.blank
        && filled.agentPreset === existing.agentPreset) return [...summaries]
      return summaries.map(summary => summary.sessionId === mutation.summary.sessionId ? filled : summary)
    }
    case 'remove':
      return summaries.filter(summary => summary.sessionId !== mutation.sessionId)
    case 'status':
      // running:true doubles as the cross-client blank flip (a blank session
      // never runs, so the first running frame proves a message landed).
      return summaries.map(summary => summary.sessionId === mutation.sessionId
        && (summary.running !== mutation.running || (mutation.running && summary.blank))
        ? { ...summary, running: mutation.running, blank: summary.blank && !mutation.running }
        : summary)
    case 'activity':
      return summaries.map(summary => summary.sessionId === mutation.sessionId
        && mutation.updatedAt > summary.updatedAt
        ? { ...summary, updatedAt: mutation.updatedAt }
        : summary)
    case 'engaged':
      return summaries.map(summary => summary.sessionId === mutation.sessionId && summary.blank
        ? { ...summary, blank: false }
        : summary)
  }
}

/** Temporary source-plane bridge while the Host contract and client project build independently. */
/** 中文说明：内部函数 `workspaceAttachSessionId`；参数含义见签名，返回值用于后续处理；例如按本文件中的调用位置使用。 */
function workspaceAttachSessionId(error: RpcError): SessionId | undefined {
  /** 中文说明：标识对象、顺序或版本的标量值；变量 `candidate` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
  const candidate = error as unknown as { code: string; details: { sessionId?: SessionId } }
  return candidate.code === 'workspace-attach-failed' ? candidate.details.sessionId : undefined
}
