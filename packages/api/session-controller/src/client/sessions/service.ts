/*
 * ================================ 文件注释 ================================
 * 【文件职责】SessionRuntime：根会话服务——列表快照存储（含持久化选中
 *   current）、Agent 作用域树、稳定 SessionBinding 缓存、面包屑路由投影。
 * 【技术维度】管理器（SessionManager）是 wire 真值、list 是投影；作用域
 *   生命周期由"舞台"（stage）驱动：懒铸造、随 current 开窗、离场即拆。
 * 【产品维度】会话侧边栏、会话路由、标准属性 provide、子代理目录、fork
 *   与搜索都经本服务；选中会话的窗口"打开"与舞台严格同步。
 * 【逻辑维度】类型区定义概要/列表/绑定；构造函数装配管理器、存储、提供
 *   通道与注册表重建；公开面（open/clear/search/fork/provide/scope 系列）；
 *   私有区（followCurrent/resolve/eligible/projectList/pruneScopes 等）。
 * 【关键边界】舞台（watched）在遮蔽间隙保持冻结视图；被裁剪的会话延迟到
 *   舞台移开再拆；create/fork 保证解析时新会话已在列表存储中（同步可寻址）。
 * 【新手阅读建议】先读 manager.ts 与 session.ts，再看本文件的舞台生命周期。
 * ==========================================================================
 */
/**
 * ClientSessions: root sessions service — list snapshot store (manager
 * projection; carries `current`, the persisted selection every
 * session-scoped surface keys off), Agent scope tree (mintScope pattern: no-op plugin
 * Fiber + ctx.extend scope tag; one scope per session, agent id === session
 * id), stable SessionBinding cache, breadcrumb-route projection.
 *
 * Scope lifecycle is stage-driven: a scope is minted lazily on first
 * resolution (pure — resolution has no side effects and is render-safe);
 * the event window and deferred teardown key off the STAGED session, which
 * follows `list.current` exactly. Staging is the open signal: the window
 * opens ⟺ the session is on stage (the stage is `current`; the staged
 * state can widen to a multi-pane list later). A session leaving the list
 * tears its scope down immediately unless it is the staged one, whose scope
 * survives frozen (read-only view) until the stage moves on.
 */
/*
 * SessionRuntime：根会话服务——列表快照存储（管理器投影；携带 current，
 * 每个会话作用域表面都以此为键的持久选中）、Agent 作用域树（mintScope
 * 模式：no-op 插件 Fiber + ctx.extend 作用域标签；每会话一个作用域，
 * agent id === session id）、稳定 SessionBinding 缓存、面包屑路由投影。
 *
 * 作用域生命周期由舞台（stage）驱动：作用域在首次解析时懒铸造（纯——
 * 解析无副作用且渲染安全）；事件窗口与延迟拆除都以 STAGED 会话为键，
 * 它精确跟随 list.current。上台即开窗信号：窗口打开 ⟺ 会话在舞台上
 * （今天舞台就是 current；将来可放宽为多窗格列表）。离开列表的会话
 * 立即拆除其作用域，除非它是舞台会话——其作用域保持冻结（只读视图）
 * 直到舞台移开。
 */
import type { Context, Fiber } from '@deepseek-ai/cordis'
import type { SubagentAddress } from '@deepseek-ai/dsh-subagent/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { workspaceTitleOf } from '@deepseek-ai/dsh-util-workspace-path'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import { SESSION_SEARCH_RESULT_LIMIT } from '../../types.ts'
import type { SessionJob as JobView } from '../../types.ts'
import type { SessionProjectionMap } from '@deepseek-ai/dsh-session-projection/types'
import {
  createSnapshotStore, type SnapshotStore,
} from '@deepseek-ai/dsh-client-store'
import type { ClientFailure, ClientResult } from '../contract/result.ts'
import type { SessionEventSource } from '../contract/events.ts'
import type { SessionFace } from '../contract/session.ts'
import type { AgentContext, ISessions } from '../contract/sessions.ts'
import { createScope, scopeOf as scopeTagOf } from '../scope.ts'
import { SessionManager } from './manager.ts'
import type { SessionRemotes } from './remotes.ts'
import type { SessionListPhase, SessionSearchResultItem, SubagentCatalogSnapshot } from './manager.ts'
import type { Session } from './session.ts'

/** Session list row projected from the host list RPC plus live stream increments. */
/* 由 Host 列表 RPC 加实时流增量投影出的会话列表行。 */
export interface SessionSummary {
  id: SessionId
  /** Latest durable log-backed title, absent until the host projects one. */
  /* 最新持久化日志支持的标题；Host 投影前缺失。 */
  title?: string
  /** Human-facing label: durable title, project basename, then session id. */
  /* 人类可读标签：持久标题、项目目录基名、然后会话 id。 */
  displayTitle: string
  cwd?: string
  parentId?: SessionId
  /** Coarse durable origin for navigation filtering; not a continuation capability. */
  /* 供导航过滤使用的粗粒度持久来源；不是续接能力。 */
  origin?: 'subagent'
  running: boolean
  /** Finished while not selected and not yet opened — the sidebar's green "done" reminder. Absent = false. */
  /* 未选中且未打开时已运行完成——侧边栏绿色"完成"提醒。缺省 = false。 */
  completed?: boolean
  /**
   * Empty-log bit (host summary derivation mirror). New Session reuses a blank
   * one targeting the same workspace. Filtering stays with the consumer: the
   * store carries every row, while the Workspace browser shows only the
   * selected blank entry.
   */
  /*
   * 空日志位（Host 概要推导镜像）。New Session 复用指向同一工作区的空白
   * 会话。过滤留在消费方：存储携带每行，而工作区浏览器只展示选定的空白项。
   */
  blank: boolean
  updatedAt: number
  /** Current host-computed projection values retained by the object layer. */
  /* 对象层保留的当前 Host 计算投影值。 */
  projectionValues?: Readonly<Partial<SessionProjectionMap>>
}

/**
 * Session list store shape. `current` rides the same snapshot (arbitrated:
 * the single useSessions standard hook reads list and selection together —
 * sidebar highlighting and current-session consumers share one fact source).
 */
/*
 * 会话列表存储形状。current 与列表在同一快照上（仲裁：唯一 useSessions
 * 标准钩子同时读列表与选中——侧边栏高亮与 SessionProvider 共享一个事实源）。
 */
export interface SessionListState {
  /** Host-list order; addressed breadcrumb-only rows are excluded. */
  /* Host 列表顺序；被寻址的面包屑专属行被排除。 */
  ids: SessionId[]
  /** Host rows plus the current addressed subagent route used by navigation. */
  /* Host 行 + 导航使用的当前寻址子代理路由。 */
  byId: Record<SessionId, SessionSummary>
  current: SessionId | undefined
  /** Arrival lifecycle projected 1:1 from the manager snapshot (see SessionListPhase): empty-with-ready means "truly no sessions". */
  /* 从管理器快照 1:1 投影的到达生命周期（见 SessionListPhase）：空且 ready 意味着"真没有会话"。 */
  phase: SessionListPhase
  /** Direct durable catalogs keyed by their selected parent address. */
  /* 按其选中父地址键控的直接持久目录。 */
  subagentsByParent: Readonly<Record<SessionId, SubagentCatalogSnapshot>>
  /**
   * Background jobs each session can see, mirrored last-wins from Session
   * Controller's control baseline and `jobs` frames. A missing key is an empty
   * set, so consumers read absence rather than a sentinel.
   */
  /*
   * 每个会话可见的后台任务，从 session/jobs 以后到者胜镜像。缺失键即空集
   * ——Host 对无任务的会话不发基线——因此消费方读"缺失"而非哨兵值。
   */
  jobsBySession: Readonly<Record<SessionId, readonly JobView[]>>
  /** Current session's catalog-derived address, absent on ordinary navigation. */
  /* 当前会话的目录派生地址；普通导航时缺失。 */
  currentAddress: SubagentAddress | undefined
}

/** Persisted navigation cell: address survives refresh for correct history routing. */
/* 持久化导航单元：地址在刷新后存活，保证历史路由正确。 */
interface SessionSelection {
  sessionId?: SessionId
  subagentAddress?: SubagentAddress
}

/** Structured session-create failure. */
/* 结构化的会话创建失败。 */
export class SessionCreateError extends Error {
  override readonly name = 'SessionCreateError'

  /**
   * @param rpcError - Host business or folded transport error.
   * @param requestedSessionId - caller-preallocated id used for later stream/list reconciliation.
   */
  /*
   * @param rpcError Host 业务或折叠传输错误。
   * @param requestedSessionId 调用方预分配的 id，用于之后的流/列表对账。
   */
  constructor(
    readonly rpcError: ClientFailure,
    readonly requestedSessionId: SessionId | undefined,
  ) {
    super(`session create failed: ${rpcError.code}: ${rpcError.message}`)
  }
}

/** Structured session-fork failure. */
/* 结构化的会话 fork 失败。 */
export class SessionForkError extends Error {
  override readonly name = 'SessionForkError'

  /**
   * @param rpcError - Host business or folded transport error.
   * @param sourceSessionId - the session the fork was cut from.
   */
  /*
   * @param rpcError Host 业务或折叠传输错误。
   * @param sourceSessionId fork 切割的源会话。
   */
  constructor(
    readonly rpcError: ClientFailure,
    readonly sourceSessionId: SessionId,
  ) {
    super(`session fork failed: ${rpcError.code}: ${rpcError.message}`)
  }
}

/** Identity-stable logical binding for one materialized Client Session. */
export interface SessionBinding {
  readonly sessionId: SessionId
  /** The outward session face only — feature code never sees the concrete class. */
  /* 仅对外会话面——功能代码永远看不到具体类。 */
  readonly session: SessionFace
  /** Contiguous event window reserved for Conversation assembly. */
  readonly eventSource: SessionEventSource
  readonly ctx: AgentContext
}

// Scope primitives live in ../scope.ts (the client mirror of host
// dsh-scope, keyed by Agent identity); re-exported here so existing
// consumers keep their import site.
export { scopeOf } from '../scope.ts'

/**
 * Display title projection: durable title, project directory basename, then
 * the raw id.
 */
/*
 * 展示标题投影：持久标题、项目目录基名、然后原始 id。
 */
function displayTitleOf(title: string | undefined, cwd: string | undefined, id: SessionId): string {
  if (title !== undefined) return title
  if (cwd !== undefined && cwd !== '') {
    const base = workspaceTitleOf(cwd)
    if (base !== '') return base
  }
  return id
}

/**
 * Increment a trailing fork number while preserving its half-width or
 * full-width parentheses; an unnumbered title starts with ` (1)`.
 * @param title - source session's durable title.
 * @returns the title assigned to the fork child.
 */
/*
 * 递增结尾的 fork 序号，同时保留半角或全角括号；未编号标题从 ` (1)` 起。
 * @param title 源会话的持久标题。
 * @returns 分配给 fork 子会话的标题。
 */
function increasedForkTitle(title: string): string {
  const ascii = /^(.*?)\((\d+)\)$/u.exec(title)
  if (ascii?.[1] !== undefined && ascii[2] !== undefined) {
    return `${ascii[1]}(${BigInt(ascii[2]) + 1n})`
  }
  const fullWidth = /^(.*?)（(\d+)）$/u.exec(title)
  if (fullWidth?.[1] !== undefined && fullWidth[2] !== undefined) {
    return `${fullWidth[1]}（${BigInt(fullWidth[2]) + 1n}）`
  }
  return `${title} (1)`
}

/** 每个已铸造作用域的记录：fiber/ctx/绑定/会话实例/provide 捆绑。 */
interface ScopeRecord {
  fiber: Fiber
  ctx: AgentContext
  binding: SessionBinding
  /** The concrete Session for runtime-internal entry points (staging open()); the binding carries only the outward face. */
  /* 供运行时内部入口（舞台上 open()）使用的具体 Session；绑定只携带对外面。 */
  session: Session
}

/** Root sessions service: list store, current selection, object-layer manager, scope tree, bindings, and breadcrumb routes. */
export class ClientSessions implements ISessions {
  /**
   * The wire schema's own result bound, re-exposed for presentation plugins as
   * injected data. Not per-connection state: the `session.search` response
   * schema caps `items` at this constant, so every transport (fixture included)
   * reports the same number.
   */
  /*
   * wire schema 自身的结果条数上限，作为注入数据重新暴露给呈现插件。
   * 不是按连接的状态：session.search 响应 schema 把 items 封顶在此常量，
   * 因此每种传输（含夹具）报告同一数值。
   */
  readonly searchResultLimit = SESSION_SEARCH_RESULT_LIMIT
  /** List snapshot store (list RPC + host stream increments; re-pulled on reconnect) — the useSessions standard feed, current included. */
  /* 列表快照存储（列表 RPC + Host 流增量；重连时重拉）——useSessions 标准源，含 current。 */
  readonly list: SnapshotStore<SessionListState>
  /** The object-layer instance cluster and frame dispatch entry. */
  /* 对象层实例簇与帧分发入口。 */
  private readonly manager: SessionManager
  /**
   * Persisted selection cell (the durable half of `list.current`). Private on
   * purpose: reads go through the list snapshot; writes through {@link
   * ClientSessions.open} / {@link ClientSessions.clear}. Projection
   * validates it against the live list instead of destructively pruning, so a
   * selection survives transient list states (reconnect re-pull) and
   * resurfaces when its session returns.
   */
  /*
   * 持久化选中单元（list.current 的持久半边）。刻意私有：读走列表快照；
   * 写经 open / clear。投影会对照活跃列表校验它而非破坏性裁剪，因此选中
   * 在瞬态列表状态（重连重拉）下存活，并在其会话回归时重新浮现。
   */
  private readonly selection: SnapshotStore<SessionSelection>

  private readonly scopes = new Map<SessionId, ScopeRecord>()
  /** In-flight scope drops remain here after records leave `scopes`, so root disposal can await quiescence. */
  private readonly scopeDrops = new Set<Promise<void>>()
  /**
   * The staged session id — follows `list.current` exactly, holding its last
   * defined value across masked gaps (a transiently absent selection blanks
   * `current` without moving the stage, so reconnect re-pulls and removals
   * keep the staged scope's frozen view alive until the stage moves on).
   */
  /*
   * 舞台会话 id——精确跟随 list.current，在遮蔽间隙保持最后定义值
   * （瞬态缺失的选中清空 current 但不移动舞台，因此重连重拉与移除都保持
   * 舞台作用域的冻结视图存活，直到舞台移开）。
   */
  private watched: SessionId | undefined
  /** Removed-while-staged sessions whose teardown waits for the stage to move away. */
  /* 舞台上被移除的会话，其拆除等待舞台移开。 */
  private readonly deferredRemovals = new Set<SessionId>()

  /**
   * @param ctx - client root context (scope fibers mount under it).
   * @param remote - generated Remote namespaces shared with every Session.
   */
  /*
   * @param ctx 客户端根上下文（作用域 fiber 挂载其下）。
   * @param api 每个会话共享的线上客户端。
   * @param remote 每个会话共享的生成远程命名空间。
   * @param conversationRuntime 当运行时 apply 拥有它们时，同趟的注册表实例。
   */
  constructor(
    private readonly rootCtx: Context,
    remote: SessionRemotes,
  ) {
    this.selection = createSnapshotStore<SessionSelection>(
      {},
      { persist: { name: 'dsh.sessions.current' } })
    const restored = this.selection.getSnapshot()
    this.manager = new SessionManager(
      remote,
      restored.sessionId,
      restored.subagentAddress,
    )
    this.list = createSnapshotStore<SessionListState>({
      ids: [], byId: {}, current: undefined, phase: 'pending',
      subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined,
    })
    // The manager owns wire truth; the store is its projection. Manager
    // notifications are already microtask-batched.
    const disposeManagerProjection = this.manager.subscribe(() => {
      this.projectList()
    })
    // Stage follower: every current write (open() and projection alike)
    // re-evaluates staging, so startup restore (persisted selection validated
    // by the projection) and reconnect resurfacing open their window with no
    // dedicated code path. Safe to run synchronously inside the store notify:
    // the follower writes no list state — session.open()'s synchronous prefix
    // touches only session-side state and its own microtask-batched notifier.
    const disposeStageFollower = this.list.subscribe(() => {
      this.followCurrent()
    })
    rootCtx.effect(() => async () => {
      disposeStageFollower()
      disposeManagerProjection()
      const scopes = [...this.scopes]
      this.scopes.clear()
      this.deferredRemovals.clear()
      this.watched = undefined
      for (const [id, record] of scopes) this.startScopeDrop(id, record)
      await this.drainScopeDrops()
      await this.manager.dispose()
    }, 'session-controller.client.sessions')
    rootCtx.reflect.provide('sessions', this, undefined)
  }

  /**
   * Select a listed or retained catalog-addressed session as current.
   * @param id - listed or addressed session id.
   */
  /*
   * 把一个已列出或保留的目录寻址会话选为当前。
   * @param id 已列出或被寻址的会话 id。
   */
  open(id: SessionId): void {
    this.manager.select(id)
  }

  /**
   * Open a healthy catalog child through its direct-parent address.
   * @param address - catalog-derived parent and child ids.
   */
  /*
   * 通过其直接父地址打开一个健康的目录子会话。
   * @param address 目录派生的父与子 id。
   */
  openSubagent(address: SubagentAddress): void {
    this.manager.selectSubagent(address)
  }

  /**
   * Resolve an already discovered direct-parent address without opening it.
   * Feature plugins use this to avoid Agent-bound RPCs in persisted child views.
   * @param id - possible addressed child id.
   * @returns The retained address, when present.
   */
  /*
   * 解析一个已发现的直接父地址而不打开它。功能插件用它避免在持久子视图中
   * 发起 Agent 绑定的 RPC。
   * @param id 可能的被寻址子 id。
   * @returns 保留的地址（若有）。
   */
  subagentAddress(id: SessionId): SubagentAddress | undefined {
    return this.manager.subagentAddress(id)
  }

  /**
   * Inform the Session Controller whether a catalog menu is consuming membership updates.
   * @param parentSessionId - selected parent.
   * @param open - menu state.
   */
  /*
   * 告知运行时某个目录菜单是否在消费成员更新。
   * @param parentSessionId 选中的父。
   * @param open 菜单状态。
   */
  setSubagentCatalogOpen(parentSessionId: SessionId, open: boolean): void {
    this.manager.setSubagentCatalogOpen(parentSessionId, open)
  }

  /**
   * Refresh one direct-child catalog.
   * @param parentSessionId - catalog owner.
   */
  /*
   * 刷新一个直接子目录。
   * @param parentSessionId 目录属主。
   */
  refreshSubagents(parentSessionId: SessionId): Promise<void> {
    return this.manager.refreshSubagents(parentSessionId)
  }

  /**
   * Clear the current selection so the layout shows the no-session empty
   * state (new-session affordance and the workspace preselection flow).
   * Wipes the persisted selection too — a reload stays on empty until the
   * user opens or starts a session. The staged scope keeps its frozen view
   * per the masked-gap contract until the next open() moves the stage.
   */
  /*
   * 清除当前选中，使布局显示"无会话"空状态（新建会话入口与工作区预选
   * 流程）。同时清除持久选中——重载保持空状态，直到用户打开或启动会话。
   * 按遮蔽间隙契约，舞台作用域保持其冻结视图，直到下次 open() 移动舞台。
   */
  clear(): void {
    this.manager.clearSelection()
  }

  /**
   * Refresh the real Session baseline, reusing an in-flight pull.
   * @returns completion of the current or newly started baseline pull.
   */
  /*
   * 刷新真实会话基线，复用进行中的拉取。
   * @returns 当前或新发起的基线拉取的完成信号。
   */
  refresh(): Promise<void> {
    return this.manager.refreshList()
  }

  /**
   * Search the Host's visible message-content index. Results stay
   * request-local; the list snapshot remains the metadata authority.
   * @param query - non-blank literal phrase.
   * @param signal - cancellation for a superseded search.
   * @returns bounded results or a business/transport error.
   */
  /*
   * 搜索 Host 可见的消息内容索引。结果保持在请求本地；列表快照仍是元数据
   * 权威。
   * @param query 非空白字面短语。
   * @param signal 用于取消被取代搜索的中止信号。
   * @returns 有界结果或业务/传输错误。
   */
  search(
    query: string,
    signal: AbortSignal,
  ): Promise<ClientResult<{ items: SessionSearchResultItem[]; hasMore: boolean }>> {
    return this.manager.search(query, signal)
  }

  /**
   * Apply one Session Controller live-control frame.
   * @param frame - baseline or live control replacement.
   */
  handleControlFrame(frame: Parameters<SessionManager['handleControlFrame']>[0]): void {
    this.manager.handleControlFrame(frame)
  }

  /**
   * Apply one remotely forwarded Session-list addition.
   * @param summary - current Host summary for the added Session.
   */
  handleSessionAdded(summary: Parameters<SessionManager['handleSessionAdded']>[0]): void {
    this.manager.handleSessionAdded(summary)
  }

  /**
   * Apply one remotely forwarded Session removal.
   * @param sessionId - removed Session identity.
   */
  handleSessionRemoved(sessionId: Parameters<SessionManager['handleSessionRemoved']>[0]): void {
    this.manager.handleSessionRemoved(sessionId)
  }

  /**
   * Apply one remotely forwarded running-state change.
   * @param args - Session identity and current Agent running state.
   */
  handleSessionStatus(...args: Parameters<SessionManager['handleSessionStatus']>): void {
    this.manager.handleSessionStatus(...args)
  }

  /**
   * Apply one remotely forwarded list-activity change.
   * @param args - Session identity and durable activity timestamp.
   */
  handleSessionActivity(...args: Parameters<SessionManager['handleSessionActivity']>): void {
    this.manager.handleSessionActivity(...args)
  }

  /**
   * Apply one remotely forwarded Agent failure.
   * @param args - Session identity and caller-visible failure description.
   */
  handleSessionError(...args: Parameters<SessionManager['handleSessionError']>): void {
    this.manager.handleSessionError(...args)
  }

  /** Rebuild the Session baseline and every opened window after connection. */
  /* 连接后重建会话基线与每个已打开的窗口。 */
  handleConnected(): void {
    this.manager.handleConnected()
  }

  /**
   * Create a session on the host. Resolution guarantee: by the time the
   * promise resolves, the created session is in the list store and
   * {@link ClientSessions.binding} resolves it — callers (New Session
   * draft hand-off) may address the scope synchronously, without waiting a
   * notifier flush. The synchronous projection below makes this structural
   * rather than an accident of microtask ordering.
   * @param opts - target workspace or directory and an optional preallocated id.
   * @returns the new session id.
   * @throws {SessionCreateError} with the requested id.
   */
  /*
   * 在 Host 上创建会话。解析保证：promise 解析时新会话已在列表存储中，且
   * binding 可解析它——调用方（New Session 草稿交接）可同步寻址作用域，
   * 无需等通知冲刷。下方的同步投影使这成为结构性保证，而非微任务顺序的
   * 偶然。
   * @param opts 目标工作区或目录 + 可选预分配 id。
   * @returns 新会话 id。
   * @throws 携带请求 id 的 SessionCreateError。
   */
  async create(opts: { workspaceId?: WorkspaceId; cwd?: string; sessionId?: SessionId } = {}): Promise<SessionId> {
    const result = await this.manager.create(opts)
    if (!result.ok) throw new SessionCreateError(result.error, opts.sessionId)
    this.projectList()
    return result.value.sessionId
  }

  /**
   * Fork a session from a completed-turn prefix of the source (same
   * synchronous-addressability guarantee as {@link ClientSessions.create}:
   * on resolution the child is in the list store and open() can target it).
   * @param opts - source session id, the optional event seq anchoring the
   *   cut (the boundary is the first turn/end at or after it; an in-log
   *   anchor in an open turn is unavailable rather than clipped backward),
   *   and whether to increment an inherited durable title before resolving.
   *   A fractional anchor floors to a real event seq: the frozen nodes of an
   *   interrupted turn carry flow-ordering seqs between two events, and the
   *   wire takes integers only.
   * @returns the child session id.
   * @throws {SessionForkError} with the source id.
   * @throws {Error} when a requested child-title rename fails after creation.
   */
  /*
   * 从源会话的已完成轮次前缀 fork 出子会话（与 create 相同的同步可寻址
   * 保证：解析时子会话已在列表存储中，open() 可指向它）。
   * @param opts 源会话 id、可选的锚定切割的事件 seq（边界是该 seq 处或
   *   之后的第一个轮次结束；开放轮次中的日志内锚点不可用，不会向后裁剪）、
   *   以及解析前是否递增继承的持久标题。分数锚点向下取整为真实事件 seq：
   *   被中断轮次的冻结节点携带两个事件之间的流排序 seq，而线上只收整数。
   * @returns 子会话 id。
   * @throws 携带源 id 的 SessionForkError。
   * @throws 创建后请求的子会话标题重命名失败时抛出 Error。
   */
  async fork(opts: {
    sessionId: SessionId
    atSeq?: number
    increaseTitle?: boolean
  }): Promise<SessionId> {
    const sourceTitle = opts.increaseTitle
      ? this.list.getSnapshot().byId[opts.sessionId]?.title
      : undefined
    const result = await this.manager.fork({
      sessionId: opts.sessionId,
      // Flooring lands inside the anchor's own turn (every turn opens with a
      // turn/start), so the host's first-turn/end-at-or-after cut still ends
      // on that turn — never clipped back to the previous one.
      // 向下取整落在锚点自己的轮次内（每轮都以 turn/start 开启），因此
      // Host 的"该处或之后的首个轮次结束"切割仍结束于该轮——绝不回退到
      // 上一轮。
      ...(opts.atSeq === undefined ? {} : { atSeq: Math.floor(opts.atSeq) }),
    })
    if (!result.ok) throw new SessionForkError(result.error, opts.sessionId)
    this.projectList()
    const childId = result.value.sessionId
    if (sourceTitle !== undefined) {
      const child = this.binding(childId)?.session
      if (child === undefined) throw new Error(`fork child "${childId}" is not locally addressable`)
      const renamed = await child.rename(increasedForkTitle(sourceTitle))
      if (!renamed.ok) throw new Error(`fork child rename failed: ${renamed.error.code}: ${renamed.error.message}`)
    }
    return childId
  }

  /**
   * Resolve an Agent-scoped context view (use-and-discard).
   * @param id - session id (the agent identity — 1:1 same axis).
   * @returns scoped ctx, or undefined for a session neither listed nor already scoped.
   */
  /*
   * 解析一个 Agent 作用域化上下文视图（即用即弃）。
   * @param id 会话 id（即 agent 身份——1:1 同轴）。
   * @returns 作用域化 ctx；会话既未列出也未作用域化时为 undefined。
   */
  scope(id: SessionId): AgentContext | undefined {
    return this.resolve(id)?.ctx
  }

  /**
   * Materialize the Agent scope named by a validated Host Remote Event.
   * The first successful Session-list baseline becomes authoritative for its
   * lifetime; until then, transport streams may address the scope in either
   * arrival order.
   * @param id - Host-projected Agent identity (the matching Session id).
   * @returns the identity-stable Agent Context.
   */
  resolveAgentScope(id: SessionId): AgentContext {
    return (this.scopes.get(id) ?? this.materializeScope(id)).ctx
  }

  /**
   * Read the Agent scope tag off a context. Service-method boundary: fetch
   * bundles must reach scope resolution through ctx.sessions — a cross-bundle
   * value import of the standalone helper would inline a second module
   * instance whose private tag Symbol never matches.
   * @param ctx - any client context.
   * @returns the session id, or undefined on root contexts.
   */
  /*
   * 从上下文读取 Agent 作用域标签。服务方法边界：fetch 捆绑必须经
   * ctx.sessions 到达作用域解析——跨捆绑值导入独立助手会内联第二个模块
   * 实例，其私有标签 Symbol 永不匹配。
   * @param ctx 任意客户端上下文。
   * @returns 会话 id，根上下文返回 undefined。
   */
  scopeOf(ctx: Context): SessionId | undefined {
    return scopeTagOf(ctx)
  }

  /**
   * Resolve the business Session behind an Agent-scoped context — the one
   * hop every scoped consumer (event listeners, per-session controllers)
   * takes from ctx-space into object-space (the client mirror of host
   * `agent.session`). Same service-method boundary as
   * {@link ClientSessions.scopeOf}.
   * @param ctx - an Agent-scoped context.
   * @returns the session face, or undefined when the ctx is untagged or its scope was pruned.
   */
  /*
   * 解析 Agent 作用域化上下文背后的业务 Session——每个作用域消费方
   * （事件监听器、按会话控制器）从 ctx 空间进入对象空间的那一跳（Host
   * agent.session 的客户端镜像）。与 scopeOf 相同的服务方法边界。
   * @param ctx 一个 Agent 作用域化上下文。
   * @returns 会话面；ctx 未带标签或其作用域被裁剪时为 undefined。
   */
  sessionOf(ctx: Context): SessionFace | undefined {
    const id = scopeTagOf(ctx)
    if (id === undefined) return undefined
    return this.scopes.get(id)?.binding.session
  }

  /**
   * Resolve the stable session binding (scope-addressed assembly feed). Pure
   * resolution — no staging, no window side effects.
   * @param id - session id.
   * @returns binding, or undefined for a session neither listed nor already scoped.
   */
  /*
   * 解析稳定的会话绑定（作用域寻址的装配数据源）。纯解析——不上台、
   * 无窗口副作用。
   * @param id 会话 id。
   * @returns 绑定；会话既未列出也未作用域化时为 undefined。
   */
  binding(id: SessionId): SessionBinding | undefined {
    return this.resolve(id)?.binding
  }

  /**
   * Move the stage to the list's current session: sweep teardowns deferred
   * behind the previous occupant and pull the new occupant's history window.
   * Staging IS the open signal — the window opens ⟺ the session is on stage
   * — and open() is idempotent (an in-flight or completed open no-ops; a
   * failed one retries the next time current is touched).
   */
  /*
   * 把舞台移到列表当前会话：清扫前一个占据者延迟的拆除，并拉取新占据者
   * 的历史窗口。上台即开窗信号——窗口打开 ⟺ 会话在舞台上——且 open()
   * 是幂等的（进行中或已完成的 open 空操作；失败的会在下次触碰 current
   * 时重试）。
   */
  private followCurrent(): void {
    const snapshot = this.list.getSnapshot()
    const current = snapshot.current
    // A masked gap (current blanked while the selection's session is
    // transiently absent) holds the stage: tearing down on the gap would
    // destroy exactly the frozen scope the mask exists to preserve.
    // 遮蔽间隙（选中会话瞬态缺失时 current 被清空）保持舞台：在间隙上
    // 拆除会破坏掩码恰恰要保留的冻结作用域。
    if (current === undefined || snapshot.byId[current] === undefined || current === this.watched) return
    this.watched = current
    this.sweepDeferred()
    const record = this.resolve(current)
    /* v8 ignore next 3 -- defensive: current is always a listed id (open()
     * validates and the projection masks absent selections), so resolve
     * cannot miss; kept so a future current writer cannot crash the notify. */
    if (record !== undefined) {
      void record.session.open()
      void this.manager.refreshSubagents(current)
    }
  }

  /**
   * Lazily mint the scope + binding for an eligible session. Eligibility and
   * prune share one predicate: listed on the host or selected
   * through a retained subagent address. Breadcrumb-only ancestors remain
   * summary data and do not keep scopes alive.
   */
  /*
   * 为符合条件的会话懒铸造作用域 + 绑定。资格与裁剪共享一个谓词：在 Host
   * 上列出，或经保留的子代理地址选中。仅面包屑的祖先保持概要数据，不
   * 维持作用域存活。
   */
  private resolve(id: SessionId): ScopeRecord | undefined {
    const existing = this.scopes.get(id)
    if (existing !== undefined) return existing
    if (!this.eligible(id)) return undefined
    return this.materializeScope(id)
  }

  /** Materialize one scope after its caller establishes that the id may be addressed. */
  private materializeScope(id: SessionId): ScopeRecord {
    const { fiber, ctx } = createScope(this.rootCtx, id)
    const session = this.manager.get(id)
    // The Session owns its scoped dispatch point (host Agent.loopCtx mirror);
    // mint and bind are one step so a live scope record implies a bound actx.
    // Session 拥有其作用域分发点（Host Agent.loopCtx 镜像）；铸造与绑定是
    // 一步，因此活跃作用域记录意味着 actx 已绑定。
    session.bindScope(ctx)
    const binding: SessionBinding = { sessionId: id, session, eventSource: session.eventSource, ctx }
    const record: ScopeRecord = {
      fiber,
      ctx,
      binding,
      session,
    }
    this.scopes.set(id, record)
    return record
  }

  /** The one aliveness predicate shared by scope mint and prune: host-listed or currently addressed. */
  /* 作用域铸造与裁剪共享的唯一存活谓词：已列出或当前被寻址。 */
  private eligible(id: SessionId): boolean {
    const { ids, current } = this.list.getSnapshot()
    return current === id || ids.includes(id)
  }

  /** Project the manager's list snapshot into the store (title derivation is display-only). */
  /* 把管理器的列表快照投影进存储（标题推导仅用于展示）。 */
  private projectList(): void {
    const {
      items, current, phase, subagentsByParent, jobsBySession, currentAddress,
    } = this.manager.getListSnapshot()
    const ids: SessionId[] = []
    const byId: Record<SessionId, SessionSummary> = {}
    for (const entry of items) {
      ids.push(entry.sessionId)
      byId[entry.sessionId] = {
        id: entry.sessionId,
        displayTitle: displayTitleOf(entry.title, entry.cwd, entry.sessionId),
        running: entry.running,
        ...(entry.completed ? { completed: true } : {}),
        blank: entry.blank,
        updatedAt: entry.updatedAt,
        ...(entry.projectionValues === undefined
          ? {}
          : { projectionValues: entry.projectionValues }),
        ...(entry.title !== undefined ? { title: entry.title } : {}),
        ...(entry.cwd !== undefined ? { cwd: entry.cwd } : {}),
        ...(entry.parentSessionId !== undefined ? { parentId: entry.parentSessionId } : {}),
        ...(entry.origin !== undefined ? { origin: entry.origin } : {}),
      }
    }
    if (current !== undefined && currentAddress !== undefined) {
      const seen = new Set<SessionId>()
      let address: SubagentAddress | undefined = currentAddress
      while (address !== undefined && !seen.has(address.childSessionId)) {
        const childId = address.childSessionId
        seen.add(childId)
        const child = subagentsByParent[address.parentSessionId]?.entries
          .find(entry => entry.kind === 'child' && entry.id === childId)
        if (child?.kind !== 'child') break
        const displayTitle = child.label ?? childId
        const summary = byId[childId]
        if (summary === undefined) {
          byId[childId] = {
            id: childId,
            displayTitle,
            parentId: address.parentSessionId,
            origin: 'subagent',
            running: child.activity === 'running',
            blank: false,
            updatedAt: 0,
          }
        } else if (summary.displayTitle !== displayTitle) {
          byId[childId] = { ...summary, displayTitle }
        }
        const parent = byId[address.parentSessionId]
        if (parent !== undefined && parent.origin !== 'subagent') break
        address = this.manager.navigationAddress(address.parentSessionId)
      }
    }
    const persisted = this.selection.getSnapshot().sessionId
    // No current (cleared, or masked gap) wipes the persisted cell — a reload
    // stays on empty; the in-memory selection still resurfaces a masked id.
    // 无 current（清除或遮蔽间隙）会擦除持久单元——重载保持空；内存选中
    // 仍会让被遮蔽的 id 重新浮现。
    if (current === undefined) {
      if (persisted !== undefined) this.selection.set({})
    } else if (byId[current] !== undefined
      && (persisted !== current
        || this.selection.getSnapshot().subagentAddress?.childSessionId !== currentAddress?.childSessionId
        || this.selection.getSnapshot().subagentAddress?.parentSessionId !== currentAddress?.parentSessionId
        || this.selection.getSnapshot().subagentAddress?.mode !== currentAddress?.mode)) {
      this.selection.set({
        sessionId: current,
        ...(currentAddress === undefined ? {} : { subagentAddress: currentAddress }),
      })
    }
    this.list.set({ ids, byId, current, phase, subagentsByParent, jobsBySession, currentAddress })
    this.pruneScopes()
  }

  /** Tear down scope + instance for no-longer-eligible sessions off stage; the staged one defers until the stage moves. */
  /* 为不再符合条件且不在舞台上的会话拆除作用域 + 实例；舞台会话延迟到舞台移开。 */
  private pruneScopes(): void {
    if (this.list.getSnapshot().phase === 'pending') return
    for (const [id, record] of this.scopes) {
      if (this.eligible(id)) continue
      if (id === this.watched) {
        this.deferredRemovals.add(id)
        continue
      }
      this.scopes.delete(id)
      this.deferredRemovals.delete(id)
      this.startScopeDrop(id, record)
    }
  }

  private startScopeDrop(id: SessionId, record: ScopeRecord): void {
    const drop = this.dropScope(id, record)
    this.scopeDrops.add(drop)
    void drop.then(
      () => { this.scopeDrops.delete(drop) },
      () => { this.scopeDrops.delete(drop) },
    )
  }

  private async drainScopeDrops(): Promise<void> {
    while (this.scopeDrops.size > 0) {
      await Promise.allSettled([...this.scopeDrops])
    }
  }

  /**
   * One teardown for the whole per-session axis: the scope
   * fiber (cascading every actx-registered effect: input shell, slash
   * controller, popup, plugin stores, listeners), the session-keyed slot
   * registrations and the Session instance itself — the host session log is the
   * durable truth, a reopen lazily rebuilds and backfills via open().
   */
  private async dropScope(id: SessionId, record: ScopeRecord): Promise<void> {
    // Release the Session's dispatch point with the scope it belongs to (a
    // surviving instance — the live Intent — rebinds when resolve re-mints).
    // 随作用域释放 Session 的分发点（存活的实例——实时 Intent——会在
    // resolve 重新铸造时重新绑定）。
    record.session.unbindScope()
    await Promise.allSettled([
      record.fiber.dispose(),
      this.manager.drop(id),
    ])
  }

  /** Run deferred teardowns whose session is no longer staged (called when the stage moves). */
  /* 运行其会话已不再上台的延迟拆除（舞台移动时调用）。 */
  private sweepDeferred(): void {
    for (const id of [...this.deferredRemovals]) {
      /* v8 ignore next -- defensive: only the staged id ever defers, and every
       * stage move sweeps first, so the set cannot contain the id the stage just
       * moved to; kept as a guard against future extra sweep call sites. */
      if (id === this.watched) continue
      // Eligible again? (A re-added id cancels the deferred teardown.)
      // 又符合条件了？（重新加入的 id 取消延迟拆除。）
      if (this.eligible(id)) {
        this.deferredRemovals.delete(id)
        continue
      }
      const record = this.scopes.get(id)
      this.deferredRemovals.delete(id)
      /* v8 ignore next -- defensive: prune deletes a scope and its deferral
       * together, so a deferred id always still owns its record; kept so a
       * future teardown path cannot double-dispose. */
      if (record !== undefined) {
        this.scopes.delete(id)
        this.startScopeDrop(id, record)
      }
    }
  }
}
