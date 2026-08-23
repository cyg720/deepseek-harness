/**
 * ================================ 文件注释 ================================
 * 【文件职责】WorkspaceRuntime：为 UI 消费方投影工作区对象管理器，并实现
 *   IWorkspaces 对外面的全部行为（创建/连接会话/目录/重命名/删除/排序）。
 * 【技术维度】快照存储（createSnapshotStore）+ 管理器（WorkspaceManager）
 *   双层：管理器是 wire 真值，list 是 UI 面向的不可变投影；双向订阅联动。
 * 【产品维度】工作区侧边栏、New Session 流程、目录浏览器与工作区管理
 *   操作都由本服务支撑；启动时自动选择默认会话。
 * 【逻辑维度】list 是投影存储；connectWorkspace 复用或创建空白会话（并发
 *   合并）；startSession 解析目标工作区；startInitialSelection 一次性选默认；
 *   create/pickDirectory/listDirectory/createDirectory/openPath 走 Host 能力；
 *   rename/delete/insertBefore/insertSessionBefore/archiveSession 走管理器。
 * 【关键边界】connectWorkspace 的空白复用要求"会话 id 属于该工作区且 cwd
 *   规范一致且未归档"，绝不只按 cwd 复用；归档的当前会话在投影时清除选中。
 * 【新手阅读建议】先读 manager.ts 理解基线生命周期，再看本文件的投影。
 * ==========================================================================
 */
/** WorkspaceRuntime projects the Workspace object manager for UI consumers. */
/** WorkspaceRuntime：为 UI 消费方投影工作区对象管理器。 */

import type { Context } from '@deepseek-ai/cordis'
import type {
  DirectoryListing, IApiClient, RpcError,
  SessionId, WorkspaceId, WorkspaceView,
} from '@deepseek-ai/dsh-api-remotes/client'
import type { SnapshotStore } from '../contract/store.ts'
import { createSnapshotStore } from '../contract/store.ts'
import type { SessionsPort, SessionsPortList } from '../contract/sessions-port.ts'
import type { IWorkspaces } from '../contract/workspaces.ts'
import { WorkspaceManager, type WorkspaceListPhase } from './manager.ts'

/** Workspace list plus the two-baseline readiness and default-target projection. */
/** 工作区列表 + 双基线就绪状态 + 默认目标投影。 */
export interface WorkspaceListState {
  items: readonly WorkspaceView[]
  /**
   * Registry-global archive set in Host order: grouping surfaces hide these
   * sessions everywhere (workspace groups and the ungrouped bucket) while
   * their session logs and workspace accounting slots remain. A plain array
   * (store-engine vocabulary; immer drafts reject Sets) — membership lookups
   * build their own transient Set.
   */
  /**
   * 注册表全局的归档集合（按 Host 顺序）：分组面处处隐藏这些会话
   * （工作区分组与未分组桶），但它们的会话日志与工作区记账槽保留。
   * 用普通数组（存储引擎词汇；immer 草稿拒绝 Set）——成员查找时自行
   * 构建临时 Set。
   */
  archivedSessionIds: readonly SessionId[]
  state: 'idle' | 'loading' | 'error'
  phase: WorkspaceListPhase
  error: RpcError | null
  /** True only after both workspace.list and session.list have succeeded. */
  /** 仅当 workspace.list 与 session.list 都成功后为 true。 */
  baselinesReady: boolean
  /** Most recently active Workspace, derived without changing `items` order. */
  /** 最近活跃的工作区，推导时不改变 items 顺序。 */
  recentWorkspaceId: WorkspaceId | undefined
}

/** Structured create failure for UI flows that distinguish Host business errors. */
/** 面向区分 Host 业务错误的 UI 流程的结构化创建失败。 */
export class WorkspaceCreateError extends Error {
  constructor(readonly rpcError: RpcError) {
    super(`workspace create failed: ${rpcError.code}: ${rpcError.message}`)
    this.name = 'WorkspaceCreateError'
  }
}

/** Structured browse failure so the directory browser can branch on Host business codes. */
/** 结构化浏览失败，使目录浏览器可按 Host 业务码分支。 */
export class DirectoryBrowseError extends Error {
  constructor(readonly rpcError: RpcError) {
    super(`directory browse failed: ${rpcError.code}: ${rpcError.message}`)
    this.name = 'DirectoryBrowseError'
  }
}

/** Real Workspace object layer and Host actions. */
/** 真实的工作区对象层与 Host 动作。 */
export class WorkspaceRuntime implements IWorkspaces {
  /** UI-facing immutable projection; the manager remains wire truth. */
  /** 面向 UI 的不可变投影；管理器仍是 wire 真值。 */
  readonly list: SnapshotStore<WorkspaceListState>
  /** Workspace baseline and frame owner. */
  /** 工作区基线与帧的属主。 */
  private readonly manager: WorkspaceManager
  /** In-flight blank-session creates keyed by workspace (connectWorkspace coalescing). */
  /** 进行中的空白会话创建，按工作区键控（connectWorkspace 并发合并）。 */
  private readonly connecting = new Map<WorkspaceId, Promise<SessionId>>()
  /** Guards the runtime-owned one-shot initial-selection subscription. */
  /** 守护运行时自有的单次初始选择订阅。 */
  private initialSelectionStarted = false

  /**
   * @param ctx - client root context.
   * @param api - shared wire client.
   * @param sessions - cross-domain sessions face used for recency and blank-session reuse.
   */
  /**
   * @param ctx 客户端根上下文。
   * @param api 共享的线上客户端。
   * @param sessions 用于最近活跃与空白会话复用的跨域会话面。
   */
  constructor(ctx: Context, private readonly api: IApiClient, private readonly sessions: SessionsPort) {
    this.manager = new WorkspaceManager(api)
    this.list = createSnapshotStore<WorkspaceListState>({
      items: [], archivedSessionIds: [], state: 'idle', phase: 'pending', error: null,
      baselinesReady: false, recentWorkspaceId: undefined,
    })
    this.manager.subscribe(() => { this.project() }) // 管理器变化 -> 重新投影
    this.sessions.list.subscribe(() => { this.project() }) // 会话列表变化 -> 重新投影
    ctx.reflect.provide('workspaces', this, undefined)
  }

  /**
   * Resolve the session a New Session flow lands in once this Workspace is
   * chosen: reuse the workspace's existing blank session when one is in the
   * list mirror, else create a fresh one on the host (`session.create` births
   * the full Session+Agent — the client holds no intermediate state). The
   * caller owns navigation: take the returned id to `sessions.open`.
   * Resolution guarantee (both arms): the returned id is already in the list
   * store and `sessions.binding(id)` resolves synchronously — draft hand-off
   * may write the new scope's machine before opening.
   * @param workspaceId - chosen Workspace (must be in the workspace list).
   * @returns the reused or newly created session id.
   */
  /**
   * 解析 New Session 流程在选定工作区后落地的会话：列表镜像中有该工作区
   * 的既有空白会话则复用，否则在 Host 上新建（session.create 直接诞生
   * 完整的 Session+Agent——客户端不持有中间状态）。导航归调用方：把返回
   * 的 id 交给 sessions.open。
   * 解析保证（两条分支）：返回的 id 已在列表存储中，且 sessions.binding(id)
   * 同步可解析——草稿交接可能在打开前写入新作用域的机器。
   * @param workspaceId 选定的工作区（必须在工作区列表中）。
   * @returns 复用或新建的会话 id。
   */
  async connectWorkspace(workspaceId: WorkspaceId): Promise<SessionId> {
    const workspace = this.list.getSnapshot().items.find(item => item.workspaceId === workspaceId)
    if (workspace === undefined) throw new Error(`workspaces.connectWorkspace: unknown workspace ${workspaceId}`)
    // Coalesce concurrent connects: a create's summary lands without cwd
    // until the host frame arrives, so a second call inside that window
    // would miss the reuse scan and mint another hidden blank session.
    // 合并并发连接：创建出的概要直到 Host 帧到达前都没有 cwd，因此该窗口
    // 内的第二次调用会错过复用扫描并再铸造一个隐藏的空白会话。
    const inflight = this.connecting.get(workspaceId)
    if (inflight !== undefined) return inflight
    // Reuse requires workspace membership (id in sessionIds AND same
    // canonical cwd — the host's own membership rule), never cwd alone:
    // a cwd match can belong to no account (sessions the CLI/TUI birthed at
    // the host cwd, or a deleted/recreated registration) and reusing it
    // would open a session no grouping surface shows under this workspace.
    // An archived blank is never reused either: reuse would open a session
    // no grouping surface can show, so New Session mints a fresh one instead.
    // 复用要求工作区成员资格（id 在 sessionIds 中且 cwd 规范一致——Host
    // 自己的成员规则），绝不只按 cwd：cwd 匹配可能不属于任何记账（CLI/TUI
    // 在 Host cwd 诞生的会话，或已删除/重建的注册），复用它会在该工作区
    // 下打开一个分组面不展示的会话。归档的空白也绝不复用：复用会打开
    // 分组面无法展示的会话，因此 New Session 改为铸造新会话。
    const archived = this.list.getSnapshot().archivedSessionIds
    const sessions = this.sessions.list.getSnapshot()
    for (const id of sessions.ids) {
      const summary = sessions.byId[id]
      if (summary !== undefined && summary.blank && summary.cwd === workspace.path
        && workspace.sessionIds.includes(summary.id)
        && !archived.includes(summary.id)) return summary.id
    }
    const attempt = this.sessions.create({ workspaceId })
      .finally(() => { this.connecting.delete(workspaceId) })
    this.connecting.set(workspaceId, attempt)
    return attempt
  }

  /**
   * Follow the first complete Workspace/Session baseline and select a default
   * session exactly once. A restored current session wins; otherwise the most
   * recent Workspace is connected (reusing or creating its blank session).
   * Later explicit clears stay cleared instead of retriggering this startup
   * policy. A failed connect may retry on the next baseline projection.
   * @returns disposer for the baseline subscription; late work cannot navigate after disposal.
   */
  /**
   * 跟随首个完整的工作区/会话基线，恰好一次地选择默认会话。恢复的当前
   * 会话优先；否则连接最近工作区（复用或创建其空白会话）。此后的显式
   * 清除保持清除，不会重新触发本启动策略。连接失败可在下次基线投影时
   * 重试。
   * @returns 基线订阅的销毁器；销毁后的迟到工作无法再导航。
   */
  startInitialSelection(): () => void {
    if (this.initialSelectionStarted) {
      throw new Error('workspaces.startInitialSelection: already started')
    }
    this.initialSelectionStarted = true
    let state: 'waiting' | 'connecting' | 'done' = 'waiting'
    let disposed = false
    const reconcile = (): void => {
      if (disposed || state !== 'waiting') return
      const workspace = this.list.getSnapshot()
      if (!workspace.baselinesReady) return // 基线未就绪则等待
      const current = this.sessions.list.getSnapshot().current
      const target = workspace.recentWorkspaceId
      if (current !== undefined || target === undefined) {
        state = 'done' // 已有当前会话或没有可连工作区：无需自动选择
        return
      }
      state = 'connecting'
      void this.connectWorkspace(target).then(
        (sessionId) => {
          if (disposed) return
          if (this.sessions.list.getSnapshot().current === undefined) {
            this.sessions.open(sessionId)
          }
          state = 'done'
        },
        (reason: unknown) => {
          if (disposed) return
          state = 'waiting' // 失败回到等待，下次基线投影再试
          console.warn('initial workspace selection failed:', reason)
        },
      )
    }
    const unsubscribe = this.list.subscribe(reconcile)
    reconcile()
    return () => {
      disposed = true
      unsubscribe()
    }
  }

  /**
   * The shared New Session action behind the shell entry points (sidebar
   * button, workspace browser): resolve the target Workspace — explicit wins,
   * then the current Session's Workspace, then the recent-Workspace
   * projection — connect its blank session and navigate there; with no
   * Workspace at all, clear the selection into the New Session view state.
   * Connect failures are non-fatal (console diagnostics; the current view
   * stays usable).
   * @param workspaceId - explicit target Workspace for scoped actions.
   */
  /**
   * shell 入口点（侧边栏按钮、工作区浏览器）背后的共享 New Session 动作：
   * 解析目标工作区——显式优先，其次当前会话的工作区，再其次最近工作区
   * 投影——连接其空白会话并导航过去；完全没有工作区时，清除选中进入
   * New Session 视图状态。连接失败是非致命的（控制台诊断；当前视图保持
   * 可用）。
   * @param workspaceId 作用域动作的显式目标工作区。
   */
  startSession(workspaceId?: WorkspaceId): void {
    const workspace = this.list.getSnapshot()
    const current = this.sessions.list.getSnapshot().current
    const currentWorkspaceId = current === undefined
      ? undefined
      : workspace.items.find(item => item.sessionIds.includes(current))?.workspaceId
    const target = workspaceId ?? currentWorkspaceId ?? workspace.recentWorkspaceId
    if (target === undefined) {
      this.sessions.clear()
      return
    }
    void this.connectWorkspace(target).then(
      (sessionId) => { this.sessions.open(sessionId) },
      (reason: unknown) => { console.warn('new session failed:', reason) },
    )
  }

  /**
   * Register an existing path as a Workspace.
   * @param input - the Host create payload.
   * @returns the created or idempotently resolved Workspace.
   */
  /**
   * 把已存在的路径注册为工作区。
   * @param input Host 创建负载。
   * @returns 创建出的或幂等解析到的工作区。
   */
  async create(input: { path: string }): Promise<WorkspaceView> {
    const result = await this.manager.create(input)
    if (!result.ok) throw new WorkspaceCreateError(result.error)
    return result.value.workspace
  }

  /**
   * Open the Host's native directory picker (the `native` capability).
   * @returns the selected path, or null when the user cancelled.
   */
  /**
   * 打开 Host 的原生目录选择器（native 能力）。
   * @returns 选中的路径，用户取消时为 null。
   */
  async pickDirectory(): Promise<string | null> {
    const response = await this.api.host.pickDirectory({})
    if (!response.result.ok) {
      throw new Error(`directory picker failed: ${response.result.error.message}`)
    }
    return response.result.value.path
  }

  /**
   * List one directory level through the Host's `browse` capability.
   * @param path - absolute directory to list; absent lists the Host home directory.
   * @param signal - aborts the wire request (and the Host's scan) when the caller supersedes it.
   * @returns the level's listing with breadcrumb ancestry.
   */
  /**
   * 通过 Host 的 browse 能力列出一层目录。
   * @param path 要列出的绝对目录；缺省列出 Host 主目录。
   * @param signal 调用方发起新请求时可中止本次 wire 请求（及 Host 的扫描）。
   * @returns 该层的目录清单（含面包屑祖先）。
   */
  async listDirectory(path?: string, signal?: AbortSignal): Promise<DirectoryListing> {
    const response = await this.api.host.listDirectory(path === undefined ? {} : { path }, signal)
    if (!response.result.ok) throw new DirectoryBrowseError(response.result.error)
    return response.result.value
  }

  /**
   * Create one child directory through the Host's `browse` capability.
   * @param path - absolute existing parent directory.
   * @param name - single non-blank path segment.
   * @returns the created directory's absolute path.
   */
  /**
   * 通过 Host 的 browse 能力创建一层子目录。
   * @param path 已存在的绝对父目录。
   * @param name 单个非空路径段。
   * @returns 创建出的目录的绝对路径。
   */
  async createDirectory(path: string, name: string): Promise<string> {
    const response = await this.api.host.createDirectory({ path, name })
    if (!response.result.ok) throw new DirectoryBrowseError(response.result.error)
    return response.result.value.path
  }

  /**
   * Open a filesystem path with the Host operating system's default application.
   * @param path - absolute or host-resolvable path.
   */
  /**
   * 用 Host 操作系统的默认应用打开一个文件系统路径。
   * @param path 绝对路径或 Host 可解析的路径。
   */
  async openPath(path: string): Promise<void> {
    const response = await this.api.host.openPath({ path })
    if (!response.result.ok) {
      throw new Error(`path open failed: ${response.result.error.message}`)
    }
  }

  /**
   * Rename a Workspace.
   * @param workspaceId - target workspace.
   * @param title - new display title (trimmed non-empty by the Host).
   * @returns the renamed Workspace view.
   */
  /**
   * 重命名工作区。
   * @param workspaceId 目标工作区。
   * @param title 新的展示标题（由 Host 修剪为非空）。
   * @returns 重命名后的工作区视图。
   */
  async rename(workspaceId: WorkspaceId, title: string): Promise<WorkspaceView> {
    const result = await this.manager.rename(workspaceId, title)
    if (!result.ok) throw new Error(`workspace rename failed: ${result.error.code}: ${result.error.message}`)
    return result.value.workspace
  }

  /**
   * Delete one Workspace registration. Sessions, session logs, and the
   * directory remain Host-owned outside this operation.
   * @param workspaceId - target workspace.
   */
  /**
   * 删除一个工作区注册。会话、会话日志与目录仍归 Host 所有，不在此操作内。
   * @param workspaceId 目标工作区。
   */
  async delete(workspaceId: WorkspaceId): Promise<void> {
    const result = await this.manager.delete(workspaceId)
    if (!result.ok) throw new Error(`workspace delete failed: ${result.error.code}: ${result.error.message}`)
  }

  /**
   * Move a Workspace within the durable registry display order.
   * @param workspaceId - Workspace to move.
   * @param beforeWorkspaceId - Anchor workspace; omitted appends.
   */
  /**
   * 在持久化注册表的展示顺序中移动工作区。
   * @param workspaceId 要移动的工作区。
   * @param beforeWorkspaceId 锚点工作区；省略则追加到末尾。
   */
  async insertBefore(workspaceId: WorkspaceId, beforeWorkspaceId?: WorkspaceId): Promise<void> {
    const result = await this.manager.insertBefore(workspaceId, beforeWorkspaceId)
    if (!result.ok) throw new Error(`workspace reorder failed: ${result.error.code}: ${result.error.message}`)
  }

  /**
   * Archive a session into the registry-global set. Clearing an archived
   * current selection is the projection sweep's job (one rule for the local
   * echo and a remote tab's frame alike).
   * @param sessionId - session to archive.
   */
  /**
   * 把会话归档进注册表全局集合。清除被归档的当前选中是投影清扫的职责
   * （对本地回显与远程标签页的帧用同一条规则）。
   * @param sessionId 要归档的会话。
   */
  async archiveSession(sessionId: SessionId): Promise<void> {
    const result = await this.manager.archiveSession(sessionId)
    if (!result.ok) throw new Error(`session archive failed: ${result.error.code}: ${result.error.message}`)
  }

  /**
   * Move a session within its Workspace's manual order (DOM-insertBefore-like).
   * @param workspaceId - owning workspace.
   * @param sessionId - accounted session to move.
   * @param beforeSessionId - accounted anchor to insert before; omitted appends.
   * @returns the updated Workspace view.
   */
  /**
   * 在所属工作区的手动顺序中移动会话（类 DOM insertBefore）。
   * @param workspaceId 属主工作区。
   * @param sessionId 要移动的已归属会话。
   * @param beforeSessionId 要插到其前的已归属锚点；省略则追加到末尾。
   * @returns 更新后的工作区视图。
   */
  async insertSessionBefore(
    workspaceId: WorkspaceId,
    sessionId: SessionId,
    beforeSessionId?: SessionId,
  ): Promise<WorkspaceView> {
    const result = await this.manager.insertSessionBefore(workspaceId, sessionId, beforeSessionId)
    if (!result.ok) throw new Error(`workspace move failed: ${result.error.code}: ${result.error.message}`)
    return result.value.workspace
  }

  /**
   * Refresh the workspace baseline, reusing an in-flight pull.
   * @returns completion of the current or newly started workspace baseline pull.
   */
  /**
   * 刷新工作区基线，复用进行中的拉取。
   * @returns 当前或新发起的工作区基线拉取的完成信号。
   */
  refresh(): Promise<void> {
    return this.manager.refresh()
  }

  /**
   * Route a Host stream envelope into the Workspace object layer.
   * @param envelope - validated Host stream envelope.
   */
  /**
   * 把 Host 流信封路由进工作区对象层。
   * @param envelope 已验证的 Host 流信封。
   */
  handleHostEnvelope(envelope: Parameters<WorkspaceManager['handleHostEnvelope']>[0]): void {
    this.manager.handleHostEnvelope(envelope)
  }

  /** Rebuild the Workspace baseline after connection. */
  /** 连接后重建工作区基线。 */
  handleConnected(): void {
    this.manager.handleConnected()
  }

  /** 把管理器与会话列表的当前状态投影到 list 存储（归档当前会话时清除选中）。 */
  private project(): void {
    const workspace = this.manager.getSnapshot()
    const sessions = this.sessions.list.getSnapshot()
    const baselinesReady = workspace.phase === 'ready' && sessions.phase === 'ready'
    // An archived current selection clears into the New Session view state —
    // a hidden row must not stay open behind the list. Sweeping here covers
    // every install path with one rule: the local unary echo, another tab's
    // changed frame, and a reconnect baseline restoring a persisted
    // selection that was archived while this client was away.
    // 被归档的当前选中清除回 New Session 视图状态——隐藏的行不得留在列表
    // 后面保持打开。在这里清扫用一条规则覆盖所有安装路径：本地单元回显、
    // 另一标签页变更的帧、以及重连基线恢复的、本客户端离线期间被归档的
    // 持久选中。
    if (sessions.current !== undefined && workspace.archivedSessionIds.includes(sessions.current)) {
      this.sessions.clear()
    }
    this.list.set({
      items: workspace.items,
      archivedSessionIds: workspace.archivedSessionIds,
      state: workspace.state,
      phase: workspace.phase,
      error: workspace.error,
      baselinesReady,
      recentWorkspaceId: baselinesReady ? recentWorkspace(workspace.items, sessions.byId) : undefined,
    })
  }
}

/** Stable tie-breaking follows Host Workspace order. */
/**
 * 推导最近活跃工作区：稳定平局裁决遵循 Host 工作区顺序。
 * @param workspaces 工作区视图列表。
 * @param sessions 会话概要映射（用于取 updatedAt）。
 * @returns 最近活跃的工作区 id；无可选时 undefined。
 */
function recentWorkspace(
  workspaces: readonly WorkspaceView[],
  sessions: SessionsPortList['byId'],
): WorkspaceId | undefined {
  let selected: WorkspaceId | undefined
  let selectedTime = Number.NEGATIVE_INFINITY
  for (const workspace of workspaces) {
    let latest = Number.NEGATIVE_INFINITY
    for (const sessionId of workspace.sessionIds) {
      const session = sessions[sessionId]
      if (session !== undefined) latest = Math.max(latest, session.updatedAt)
    }
    if (latest === Number.NEGATIVE_INFINITY) latest = Date.parse(workspace.createdAt) // 无会话时用创建时间兜底
    if (selected === undefined || latest > selectedTime) {
      selected = workspace.workspaceId
      selectedTime = latest
    }
  }
  return selected
}
