/**
 * ================================ 文件注释 ================================
 * 【文件职责】WorkspaceManager：工作区基线（list）、增量帧（changed）与
 *   一元动作（unary response）的属主，是工作区域的 wire 真值。
 * 【技术维度】Notifier + 快照缓存模式；delta 重放（刷新期间到达的帧在
 *   响应上重放）；墓碑（removedIds）防删除复活；世代号仲裁顺序竞争。
 * 【产品维度】工作区列表要同时满足"响应式更新"与"删除不被迟到帧复活"：
 *   用户删除后即使晚到的帧还带着旧行也不能重新出现。
 * 【逻辑维度】refresh 拉基线并重放帧；create/rename/delete/insertBefore/
 *   insertSessionBefore/archiveSession 执行一元动作并立即发布返回快照；
 *   handleHostEnvelope 吸收 Host 帧；installArchived/installOrder/upsert/
 *   remove 是安装原语。
 * 【关键边界】删除依赖 Host id 永不复用（注册表每次用新 randomUUID）；
 *   mutation 响应与 changed 帧竞争时以 updatedAt 较新者为准；
 *   顺序安装以"已提交顺序"为唯一来源。
 * 【新手阅读建议】先读 workspace.ts 的 Workspace 对象，再看本类安装原语。
 * ==========================================================================
 */
/** Workspace baseline, incremental-frame, and unary-action owner. */
/** 工作区基线、增量帧与一元动作的属主。 */

import type {
  HostFrame, IApiClient, RpcError, RpcRequest, RpcResult, SessionId, WorkspaceId, WorkspaceView,
} from '@deepseek-ai/dsh-api-remotes/client'
import { transportError } from '@deepseek-ai/dsh-host-apiproxy/api'
import { Notifier } from '../sessions/notifier.ts'
import { Workspace, type WorkspaceCreateInput } from './workspace.ts'

/** Monotone workspace-list arrival lifecycle. */
/** 单调的工作区列表到达生命周期。 */
export type WorkspaceListPhase = 'pending' | 'ready'

/** Immutable workspace-list snapshot. */
/** 不可变的工作区列表快照。 */
export interface WorkspaceListSnapshot {
  items: readonly WorkspaceView[]
  /**
   * Registry-global archive set in Host order (hidden from grouping
   * surfaces; accounting slots retained). A plain array, not a Set: public
   * snapshot state stays in the store engine's plain-data vocabulary
   * (immer drafts reject Sets without the MapSet plugin); membership
   * lookups build their own transient Set where they need one.
   */
  /**
   * 注册表全局的归档集合（按 Host 顺序；对分组面隐藏；记账槽保留）。
   * 用普通数组而非 Set：公开快照状态保持在存储引擎的纯数据词汇内
   * （没有 MapSet 插件时 immer 草稿拒绝 Set）；成员查找在需要处自建
   * 临时 Set。
   */
  archivedSessionIds: readonly SessionId[]
  state: 'idle' | 'loading' | 'error'
  phase: WorkspaceListPhase
  error: RpcError | null
}

/** 工作区增量：upsert 单条、remove 一条、或整体顺序。 */
type WorkspaceDelta =
  | { type: 'upsert'; workspace: WorkspaceView }
  | { type: 'remove'; workspaceId: WorkspaceId }
  | { type: 'order'; workspaceIds: readonly WorkspaceId[] }

/** Workspace object cluster driven by one list baseline and changed-frame upserts. */
/** 由一个列表基线与 changed 帧 upsert 驱动的工作区对象簇。 */
export class WorkspaceManager {
  private items: Workspace[] = [] // 工作区对象的有序集合
  private itemViewsSource: readonly Workspace[] | null = null // itemViews 缓存的源引用
  private itemViewsCache: readonly WorkspaceView[] = [] // 视图数组缓存
  // Full-snapshot state (list response / unary response / changed frame all
  // carry the complete set), so deltas never merge — installs replace.
  // 全量快照状态（list 响应 / 一元响应 / changed 帧都携带完整集合），
  // 因此增量从不合并——安装即替换。
  private archivedSessionIds: readonly SessionId[] = []
  private state: WorkspaceListSnapshot['state'] = 'idle'
  private phase: WorkspaceListPhase = 'pending'
  private error: RpcError | null = null
  private inflight: Promise<void> | null = null // 进行中的 refresh（共享）
  private refreshFrames: WorkspaceDelta[] | null = null // refresh 期间收集待重放的帧
  /**
   * True once a frame or unary echo installed the archive set while a list
   * request was in flight: that install is newer than the pending baseline,
   * so the baseline's (older) set must not roll it back — the archive
   * mirror of replaying refreshFrames over the item baseline.
   */
  /**
   * 当帧或一元回显在 list 请求进行中安装了归档集时为 true：该安装比
   * 待处理基线更新，因此基线的（更旧）集合不得回滚它——这是对条目基线
   * 重放 refreshFrames 的归档镜像。
   */
  private archivedSupersedesRefresh = false
  /** Latest local reorder request; only its unary echo may install order. */
  /** 最新本地重排请求；只有它的一元回显可以安装顺序。 */
  private orderRequestGeneration = 0
  /** Increments on order frames so a later remote commit outranks an older unary echo. */
  /** 顺序帧时递增，使更晚的远端提交压过更旧的一元回显。 */
  private orderFrameGeneration = 0
  /** Last complete order accepted from a Host baseline, frame, or current unary echo. */
  /** 最近一次从 Host 基线、帧或当前一元回显接受的完整顺序。 */
  private committedOrder: WorkspaceId[] = []
  /**
   * Ids this process has seen removed, kept for the connection's lifetime so
   * a late changed frame or a stale baseline row cannot resurrect a deleted
   * row. Correctness rests on Host ids never being reused (the registry mints
   * a fresh `randomUUID` per record, including when the same directory is
   * registered again) — a path-derived id scheme would turn these entries
   * into permanent blindfolds and must clear them instead.
   */
  /**
   * 本进程见过的已删除 id，在连接生命周期内保留，使迟到的 changed 帧或
   * 陈旧基线行无法复活已删除的行。正确性建立在 Host id 永不复用上
   * （注册表每条记录铸造新 randomUUID，包括同一目录再次注册时）——
   * 路径派生 id 方案会把这些条目变成永久眼罩，必须改为清除它们。
   */
  private readonly removedIds = new Set<WorkspaceId>()
  private snapshotCache: WorkspaceListSnapshot // 快照缓存
  private readonly notifier = new Notifier(() => {
    this.snapshotCache = this.buildSnapshot() // 失效时重建缓存
  })

  /** @param api - shared wire client. */
  /** @param api 共享的线上客户端。 */
  constructor(private readonly api: IApiClient) {
    this.snapshotCache = this.buildSnapshot()
  }

  /**
   * Refresh from workspace.list. The first successful response establishes
   * Host order; later responses re-establish the durable order so reconnects
   * adopt reorders committed while this client was offline. Frames arriving
   * during the RPC are replayed over its response.
   * @returns the shared in-flight refresh.
   */
  /**
   * 从 workspace.list 刷新。首个成功响应确立 Host 顺序；后续响应重新确立
   * 持久顺序，使重连采纳本客户端离线期间提交的重排。RPC 期间到达的帧
   * 在其响应上重放。
   * @returns 共享的进行中刷新。
   */
  refresh(): Promise<void> {
    if (this.inflight !== null) return this.inflight
    this.state = 'loading'
    this.error = null
    const frames: WorkspaceDelta[] = []
    this.refreshFrames = frames
    this.notifier.markDirty()
    this.inflight = (async () => {
      try {
        const { result } = await this.api.workspace.list({})
        if (result.ok) {
          let items = result.value.items
          items = items.filter(workspace => !this.removedIds.has(workspace.workspaceId)) // 过滤已删除墓碑
          for (const delta of frames) items = applyWorkspaceDelta(items, delta) // 重放帧
          this.installViews(items)
          if (!this.archivedSupersedesRefresh) this.installArchived(result.value.archivedSessionIds)
          this.state = 'idle'
          this.phase = 'ready'
        } else {
          this.state = 'error'
          this.error = result.error
        }
      } catch (error) {
        this.state = 'error'
        const folded = transportError<never>(error)
        /* v8 ignore next -- transportError always returns the failure branch. */
        this.error = folded.ok ? null : folded.error
      } finally {
        this.refreshFrames = null
        this.archivedSupersedesRefresh = false
        this.inflight = null
        this.notifier.markDirty()
      }
    })()
    return this.inflight
  }

  /**
   * Create or resolve a real Workspace, then publish its returned snapshot
   * without waiting for the changed frame.
   * @param input - the existing absolute path to adopt.
   * @returns the wire result.
   */
  /**
   * 创建或解析一个真实工作区，然后不等 changed 帧直接发布返回快照。
   * @param input 要采纳的已存在绝对路径。
   * @returns 线上结果。
   */
  async create(input: WorkspaceCreateInput): Promise<RpcResult<{ workspace: WorkspaceView; created: boolean }>> {
    const workspace = new Workspace(this.api, input)
    const completion = workspace.materialize()
    if (completion === undefined) throw new Error('a local Workspace must be materializable')
    const result = await completion
    if (result.ok) this.upsert(result.value.workspace, workspace)
    return result
  }

  /**
   * Rename a Workspace, then publish its returned snapshot without waiting
   * for the changed frame.
   * @param workspaceId - target workspace.
   * @param title - new display title.
   * @returns the wire result.
   */
  /**
   * 重命名工作区，然后不等 changed 帧直接发布返回快照。
   * @param workspaceId 目标工作区。
   * @param title 新的展示标题。
   * @returns 线上结果。
   */
  async rename(workspaceId: WorkspaceId, title: string): Promise<RpcResult<{ workspace: WorkspaceView }>> {
    const { result } = await this.api.workspace.rename({ workspaceId, title })
    if (result.ok) this.upsert(result.value.workspace)
    return result
  }

  /**
   * Delete a Workspace registration and remove its local projection from the
   * unary response without waiting for the Host frame.
   * @param workspaceId - target workspace.
   * @returns the wire result.
   */
  /**
   * 删除工作区注册，并依据一元响应不等 Host 帧直接移除本地投影。
   * @param workspaceId 目标工作区。
   * @returns 线上结果。
   */
  async delete(workspaceId: WorkspaceId): Promise<RpcResult<{ deleted: true }>> {
    const { result } = await this.api.workspace.delete({ workspaceId })
    if (result.ok) this.remove(workspaceId, true)
    return result
  }

  /**
   * Move a Workspace within the registry display order and install the full
   * returned order without waiting for the Host frame.
   * @param workspaceId - Workspace to move.
   * @param beforeWorkspaceId - Anchor workspace; omitted appends.
   * @returns the wire result.
   */
  /**
   * 在注册表展示顺序中移动工作区，并不等 Host 帧直接安装返回的完整顺序。
   * @param workspaceId 要移动的工作区。
   * @param beforeWorkspaceId 锚点工作区；省略则追加到末尾。
   * @returns 线上结果。
   */
  async insertBefore(
    workspaceId: WorkspaceId,
    beforeWorkspaceId?: WorkspaceId,
  ): Promise<RpcResult<{ workspaceIds: WorkspaceId[] }>> {
    const requestGeneration = ++this.orderRequestGeneration
    const frameGeneration = this.orderFrameGeneration
    const localOrder = this.itemViews().map(workspace => workspace.workspaceId)
    this.installOrder(insertIdBefore(localOrder, workspaceId, beforeWorkspaceId)) // 乐观本地安装
    let result: RpcResult<{ workspaceIds: WorkspaceId[] }>
    try {
      ;({ result } = await this.api.workspace.insertBefore({
        workspaceId,
        ...beforeWorkspaceId === undefined ? {} : { beforeWorkspaceId },
      }))
    } catch (error) {
      if (requestGeneration === this.orderRequestGeneration
        && frameGeneration === this.orderFrameGeneration) {
        this.installOrder(this.committedOrder) // 失败回滚到已提交顺序
      }
      throw error
    }
    if (result.ok && requestGeneration === this.orderRequestGeneration
      && frameGeneration === this.orderFrameGeneration) {
      this.installOrder(result.value.workspaceIds, true)
    } else if (!result.ok && requestGeneration === this.orderRequestGeneration
      && frameGeneration === this.orderFrameGeneration) {
      this.installOrder(this.committedOrder)
    }
    return result
  }

  /**
   * Move a session within its Workspace's manual order, then publish the
   * returned snapshot without waiting for the changed frame.
   * @param workspaceId - owning workspace.
   * @param sessionId - accounted session to move.
   * @param beforeSessionId - accounted anchor to insert before; omitted appends.
   * @returns the wire result.
   */
  /**
   * 在所属工作区的手动顺序中移动会话，然后不等 changed 帧直接发布返回快照。
   * @param workspaceId 属主工作区。
   * @param sessionId 要移动的已归属会话。
   * @param beforeSessionId 要插到其前的已归属锚点；省略则追加到末尾。
   * @returns 线上结果。
   */
  async insertSessionBefore(
    workspaceId: WorkspaceId,
    sessionId: SessionId,
    beforeSessionId?: SessionId,
  ): Promise<RpcResult<{ workspace: WorkspaceView }>> {
    const { result } = await this.api.workspace.insertSessionBefore({
      workspaceId, sessionId,
      ...beforeSessionId === undefined ? {} : { beforeSessionId },
    })
    if (result.ok) this.upsert(result.value.workspace)
    return result
  }

  /**
   * Archive one session in the registry-global set, then install the
   * returned full set without waiting for the changed frame.
   * @param sessionId - session to archive.
   * @returns the wire result.
   */
  /**
   * 在注册表全局集合中归档一个会话，然后不等 changed 帧直接安装返回的
   * 完整集合。
   * @param sessionId 要归档的会话。
   * @returns 线上结果。
   */
  async archiveSession(sessionId: SessionId): Promise<RpcResult<{ archivedSessionIds: SessionId[] }>> {
    const { result } = await this.api.workspace.archiveSession({ sessionId })
    if (result.ok) this.installArchived(result.value.archivedSessionIds)
    return result
  }

  /**
   * Host-frame entry. Non-workspace frames are ignored so the runtime can
   * fan one host stream out to both object managers.
   * @param envelope - host stream envelope.
   */
  /**
   * Host 帧入口。非工作区帧被忽略，使运行时可以把一条 Host 流扇出给两个
   * 对象管理器。
   * @param envelope Host 流信封。
   */
  handleHostEnvelope(envelope: RpcRequest<HostFrame>): void {
    if (envelope.payload.type === 'host/workspace-changed') this.upsert(envelope.payload.workspace)
    else if (envelope.payload.type === 'host/workspace-removed') this.remove(envelope.payload.workspaceId)
    else if (envelope.payload.type === 'host/workspace-order-changed') {
      this.orderFrameGeneration++
      this.installOrder(envelope.payload.workspaceIds, true)
    }
    else if (envelope.payload.type === 'host/archived-sessions-changed') {
      this.installArchived(envelope.payload.archivedSessionIds)
    }
  }

  /** Re-pull the baseline after each connection generation. */
  /** 每个连接世代后重新拉取基线。 */
  handleConnected(): void {
    void this.refresh()
  }

  /**
   * Subscribe to workspace snapshot invalidation.
   * @param listener - snapshot invalidation callback.
   * @returns unsubscribe function.
   */
  /**
   * 订阅工作区快照的失效通知。
   * @param listener 快照失效回调。
   * @returns 取消订阅函数。
   */
  subscribe(listener: () => void): () => void {
    return this.notifier.subscribe(listener)
  }

  /**
   * Read the cached workspace snapshot after flushing pending notifications.
   * @returns the cached workspace snapshot.
   */
  /**
   * 先冲刷待处理的通知，再读取缓存的工作区快照。
   * @returns 缓存的工作区快照。
   */
  getSnapshot(): WorkspaceListSnapshot {
    this.notifier.ensureFresh()
    return this.snapshotCache
  }

  /** 用当前各状态字段组装对外快照。 */
  private buildSnapshot(): WorkspaceListSnapshot {
    return {
      items: this.itemViews(),
      archivedSessionIds: this.archivedSessionIds,
      state: this.state,
      phase: this.phase,
      error: this.error,
    }
  }

  /**
   * Replace the archive set when membership actually changed (array identity
   * backs Object.is short-circuits). Host snapshots are append-ordered, so
   * positional comparison is exact, not merely heuristic.
   */
  /**
   * 当成员确实变化时替换归档集（数组身份支撑 Object.is 短路）。Host 快照
   * 是追加顺序，因此位置比较是精确的，不只是启发式。
   */
  private installArchived(archivedSessionIds: readonly SessionId[]): void {
    if (this.refreshFrames !== null) this.archivedSupersedesRefresh = true // 比待处理基线更新
    if (archivedSessionIds.length === this.archivedSessionIds.length
      && archivedSessionIds.every((id, index) => id === this.archivedSessionIds[index])) return
    this.archivedSessionIds = [...archivedSessionIds]
    this.notifier.markDirty()
  }

  /** Reorder known Workspace objects, optionally recording a Host-committed sequence. */
  /** 重排已知的工作区对象，可选地记录 Host 已提交的序列。 */
  private installOrder(workspaceIds: readonly WorkspaceId[], committed = false): void {
    if (committed) {
      this.refreshFrames?.push({ type: 'order', workspaceIds })
      this.committedOrder = [...workspaceIds]
    }
    const rank = new Map(workspaceIds.map((id, index) => [id, index])) // id -> 序号
    const items = [...this.items].sort((left, right) => {
      const leftId = left.getSnapshot().view?.workspaceId
      const rightId = right.getSnapshot().view?.workspaceId
      return (leftId === undefined ? Number.MAX_SAFE_INTEGER : rank.get(leftId) ?? Number.MAX_SAFE_INTEGER)
        - (rightId === undefined ? Number.MAX_SAFE_INTEGER : rank.get(rightId) ?? Number.MAX_SAFE_INTEGER)
    })
    if (items.every((item, index) => item === this.items[index])) return // 顺序未变则不通知
    this.items = items
    this.notifier.markDirty()
  }

  /** Upsert one Host view, optionally retaining the local object that materialized it. */
  /** Upsert 一个 Host 视图，可选地保留物化它的本地对象。 */
  private upsert(view: WorkspaceView, identity?: Workspace): void {
    if (this.removedIds.has(view.workspaceId)) return // 已删除的 id 不再接受
    this.refreshFrames?.push({ type: 'upsert', workspace: view })
    const index = this.items.findIndex(item => item.getSnapshot().view?.workspaceId === view.workspaceId)
    // Mutation responses and changed frames race (two carriers, no ordering):
    // reject a snapshot strictly older than the installed projection so a
    // late unary response cannot roll back a newer frame.
    // mutation 响应与 changed 帧竞争（两个载体，无顺序保证）：拒绝严格早于
    // 已安装投影的快照，使迟到的单元响应无法回滚更新的帧。
    const installed = index === -1 ? undefined : this.items[index]?.getSnapshot().view
    if (installed !== undefined && Date.parse(view.updatedAt) < Date.parse(installed.updatedAt)) return
    if (!this.committedOrder.includes(view.workspaceId)) {
      this.committedOrder = [view.workspaceId, ...this.committedOrder]
    }
    if (identity !== undefined) {
      this.items = index === -1
        ? [identity, ...this.items]
        : this.items.map((item, position) => position === index ? identity : item)
    } else if (index === -1) {
      this.items = [new Workspace(this.api, view), ...this.items]
    } else {
      this.items[index]?.adopt(view)
      this.items = [...this.items]
    }
    this.notifier.markDirty()
  }

  /** Remove one id idempotently and retain a tombstone against late echoes. */
  /** 幂等地移除一个 id，并保留墓碑以对抗迟到回显。 */
  private remove(workspaceId: WorkspaceId, direct = false): void {
    this.refreshFrames?.push({ type: 'remove', workspaceId })
    this.removedIds.add(workspaceId)
    this.committedOrder = this.committedOrder.filter(id => id !== workspaceId)
    const items = this.items.filter(item =>
      item.getSnapshot().view?.workspaceId !== workspaceId)
    if (items.length === this.items.length) {
      // The Host frame may have removed the row first but left its batched
      // notification pending. A successful unary echo still flushes that
      // committed state before the user action resolves.
      // Host 帧可能已先移除该行，但留下批处理通知待处理。成功的一元回显
      // 仍会在用户动作解析前冲刷该已提交状态。
      if (direct) this.notifier.notifyNow()
      return
    }
    this.items = items
    if (direct) this.notifier.notifyNow()
    else this.notifier.markDirty()
  }

  /** 用基线视图列表重建 items（保留既有对象身份，重复 id 采纳最新视图）。 */
  private installViews(views: readonly WorkspaceView[]): void {
    const existing = new Map(
      this.items.flatMap((workspace) => {
        const view = workspace.getSnapshot().view
        return view === undefined ? [] : [[view.workspaceId, workspace] as const]
      }),
    )
    const installed = new Map<WorkspaceView['workspaceId'], Workspace>()
    for (const view of views) {
      const duplicate = installed.get(view.workspaceId)
      if (duplicate !== undefined) {
        duplicate.adopt(view)
        continue
      }
      const workspace = existing.get(view.workspaceId) ?? new Workspace(this.api, view)
      workspace.adopt(view)
      installed.set(view.workspaceId, workspace)
    }
    this.items = [...installed.values()]
    this.committedOrder = views.map(view => view.workspaceId)
  }

  /** 取每个工作区对象的视图数组（源引用未变时走缓存）。 */
  private itemViews(): readonly WorkspaceView[] {
    if (this.itemViewsSource === this.items) return this.itemViewsCache
    this.itemViewsSource = this.items
    this.itemViewsCache = this.items.flatMap((workspace) => {
      const view = workspace.getSnapshot().view
      return view === undefined ? [] : [view]
    })
    return this.itemViewsCache
  }
}

/** Known ids retain their position; a newly created Workspace enters first. */
/** 已知 id 保持原位；新建工作区进入首位。 */
function upsertWorkspace(items: readonly WorkspaceView[], workspace: WorkspaceView): WorkspaceView[] {
  const index = items.findIndex(item => item.workspaceId === workspace.workspaceId)
  return index === -1
    ? [workspace, ...items]
    : items.map((item, position) => position === index ? workspace : item)
}

/** Replay one ordered delta over a baseline: upsert in place, or drop the removed id. */
/** 在基线上重放一个有序增量：原地 upsert，或丢弃已移除 id。 */
function applyWorkspaceDelta(items: readonly WorkspaceView[], delta: WorkspaceDelta): WorkspaceView[] {
  if (delta.type === 'upsert') return upsertWorkspace(items, delta.workspace)
  if (delta.type === 'remove') {
    return items.filter(workspace => workspace.workspaceId !== delta.workspaceId)
  }
  const rank = new Map(delta.workspaceIds.map((id, index) => [id, index]))
  return [...items].sort((left, right) =>
    (rank.get(left.workspaceId) ?? Number.MAX_SAFE_INTEGER)
    - (rank.get(right.workspaceId) ?? Number.MAX_SAFE_INTEGER))
}

/** Move one known id before an optional anchor; unknown ids leave the order unchanged. */
/** 把一个已知 id 移到可选锚点之前；未知 id 保持顺序不变。 */
function insertIdBefore(
  ids: readonly WorkspaceId[],
  id: WorkspaceId,
  beforeId?: WorkspaceId,
): WorkspaceId[] {
  if (!ids.includes(id) || (beforeId !== undefined && !ids.includes(beforeId)) || beforeId === id) {
    return [...ids]
  }
  const without = ids.filter(candidate => candidate !== id)
  const at = beforeId === undefined ? without.length : without.indexOf(beforeId)
  return [...without.slice(0, at), id, ...without.slice(at)]
}
