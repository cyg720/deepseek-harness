/**
 * ================================ 文件注释 ================================
 * 【文件职责】owner 级持久 PTY 注册表（TerminalSessionService）：后端拥有终端机制，
 * 本服务拥有 id 铸造、发布、授权（精确 Agent 所有权）与被等待的清理。
 * 【技术维度】Cordis Service + 模块增强（ctx.terminals）；品牌 id（TerminalSessionId）、
 * 错误码（TerminalErrorCode）、名称/并发 spawn 预留、owner 生命周期清理（ctx.effect）、
 * 整服务拆解（disposeAll）；后端注册随 effect 作用域释放。
 * 【产品维度】任意 PTY 后端（bash/pwsh/远程）统一注册与授权：模型/工具只能操作自己
 * 的会话（FOREIGN_SESSION 拒绝），owner 销毁或服务拆解时全部会话被关闭。
 * 【逻辑维度】registerBackend 登记后端 → spawn 创建并发布（名称/并发预留、回滚清理）→
 * startSend/read/signal/kill/list 操作 → owner/服务拆解（abortPendingSpawns + closeRecords）。
 * 【关键边界】spawn 到 close 全程 hasOwnerActivity 无发布间隙；每会话至多一个活跃发送
 * （SEND_ACTIVE）；拆解为尽力而为（一个卡住的会话不能孤儿化后端/预留/owner 清理器）。
 * 【新手阅读建议】先读 spawn 的完整路径（预留 → 后端创建 → 回滚），再看 kill 的
 * closing 围栏，最后看 disposeAll 的拆解顺序。
 * ==========================================================================
 */

/**
 * Owner-scoped persistent PTY registry. Backends own terminal mechanics while
 * this service owns ids, publication, authorization, and awaited cleanup.
 * @module @deepseek-ai/dsh-terminal
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { TerminalBackendCleanupError } from './types.ts'
import type {
  TerminalBackend,
  TerminalBackendSession,
  TerminalReadRequest,
  TerminalReadResult,
  TerminalSendOperation,
  TerminalSendRequest,
  TerminalSessionIdValue,
  TerminalSessionSnapshot,
  TerminalSignal,
  TerminalSignalResult,
  TerminalSpawnRequest,
  TerminalSpawnResult,
} from './types.ts'

export type {
  TerminalBackend,
  TerminalBackendSession,
  TerminalBackendSpawnSpec,
  TerminalReadRequest,
  TerminalReadResult,
  TerminalSendOperation,
  TerminalSendRead,
  TerminalSendRequest,
  TerminalSendResult,
  TerminalSessionSnapshot,
  TerminalSessionStatus,
  TerminalSignal,
  TerminalSignalResult,
  TerminalSpawnRequest,
  TerminalSpawnResult,
  TerminalWaitReason,
} from './types.ts'
export { TerminalBackendCleanupError } from './types.ts'

/** Opaque identity minted by {@link TerminalSessionService} for one live PTY session. */
export type TerminalSessionId = TerminalSessionIdValue

declare module '@deepseek-ai/cordis' {
  interface Context {
    terminals: TerminalSessionService
  }
}

/** Machine-routable PTY service failures. */
/** 可机器路由的 PTY 服务失败码（供上层稳定分类错误）。 */
export type TerminalErrorCode =
  | 'DUPLICATE_BACKEND'
  | 'DUPLICATE_NAME'
  | 'FOREIGN_SESSION'
  | 'NO_BACKEND'
  | 'NO_SESSION'
  | 'OWNER_NOT_LIVE'
  | 'SEND_ACTIVE'
  | 'SERVICE_DISPOSING'

/** Error carrying a stable {@link TerminalErrorCode}. */
/** 携带稳定 TerminalErrorCode 的错误。 */
export class TerminalError extends Error {
  constructor(message: string, readonly code: TerminalErrorCode) {
    super(message)
    this.name = 'TerminalError'
  }
}

/**
 * Brand one registry-minted string as a {@link TerminalSessionId}.
 * @param value - raw registry-issued id.
 * @returns Same string with the PTY session brand.
 */
/**
 * 把一个注册表铸造的字符串打成 TerminalSessionId 品牌。
 * @param value 注册表原始下发的 id
 * @returns 带 PTY 会话品牌的同一字符串
 */
export function TerminalSessionId(value: string): TerminalSessionId {
  return value as TerminalSessionId
}

/** 一条已发布会话的注册记录（含活跃发送与关闭围栏）。 */
interface SessionRecord {
  readonly id: TerminalSessionId
  readonly owner: Agent
  readonly name: string | undefined
  readonly type: string
  readonly session: TerminalBackendSession
  active: TerminalSendOperation | undefined
  closing: Promise<void> | undefined
}

/** 一次进行中的未发布 spawn（供拆解中止与清理失败聚合）。 */
interface PendingSpawn {
  readonly owner: Agent
  readonly controller: AbortController
  readonly settled: Promise<void>
  cleanupFailure: { error: unknown } | undefined
}

/** 一次 spawn 的并发预留：提供取消信号并在结束时上报清理失败。 */
interface SpawnReservation {
  readonly signal: AbortSignal
  release(cleanupFailure: { error: unknown } | undefined): void
}

/** In-process registry for replaceable PTY backends and exact-Agent sessions. */
/** 可替换 PTY 后端与精确 Agent 会话的进程内注册表。 */
export class TerminalSessionService extends Service {
  private readonly backends = new Map<string, TerminalBackend>()
  private readonly sessions = new Map<TerminalSessionId, SessionRecord>()
  private readonly reservedNames = new Map<Agent, Set<string>>()
  private readonly pendingSpawns = new Map<Agent, Set<PendingSpawn>>()
  private readonly ownerCleanups = new Map<Agent, () => Promise<void> | void>()
  private readonly disposedOwners = new WeakSet<Agent>()
  private nextId = 0
  private disposing = false

  constructor(ctx: Context) {
    super(ctx, 'terminals')
    // 组合体拆解时关闭全部会话（后端注册各自经 ctx.effect 释放）。
    ctx.effect(() => () => this.disposeAll(), 'pty teardown')
  }

  /**
   * Register one backend type for this effect scope.
   * @param backend - provider with a non-empty unique type.
   * @returns disposer that removes exactly this contribution.
   */
  /**
   * 为当前 effect 作用域注册一种后端类型。
   * @param backend 类型非空且唯一的提供者
   * @returns 恰好移除该贡献的释放器
   */
  registerBackend(backend: TerminalBackend): () => void {
    if (backend.type.length === 0) throw new Error('pty backend type must be non-empty')
    if (this.backends.has(backend.type)) {
      throw new TerminalError(`a PTY backend named "${backend.type}" is already registered`, 'DUPLICATE_BACKEND')
    }
    const dispose = this.ctx.effect(() => {
      this.backends.set(backend.type, backend)
      return () => {
        if (this.backends.get(backend.type) === backend) this.backends.delete(backend.type)
      }
    }, 'pty.registerBackend()')
    return () => void dispose()
  }

  /**
   * List registered backend types in registration order.
   * @returns fresh backend type names.
   */
  /** 按注册顺序列出已注册后端类型。 */
  listBackends(): string[] {
    return [...this.backends.keys()]
  }

  /**
   * Create and publish one owner-scoped session after backend setup succeeds.
   * @param owner - exact registered Agent that owns access and cleanup.
   * @param request - backend type plus optional owner-local name and cwd.
   * @param signal - cancellation of unpublished setup.
   * @returns published identity, metadata, status, and MOTD.
   */
  /**
   * 后端设置成功后创建并发布一个 owner 级会话。名称与并发 spawn 都要预留
   * （防重复/竞态）；设置失败或回滚失败时聚合错误上抛。
   * @param owner 拥有访问与清理的精确已注册 Agent
   * @param request 后端类型加可选 owner 本地名与 cwd
   * @param signal 未发布设置的取消
   * @returns 已发布的身份、元数据、状态与 MOTD
   */
  async spawn(owner: Agent, request: TerminalSpawnRequest, signal?: AbortSignal): Promise<TerminalSpawnResult> {
    this.assertActive()
    signal?.throwIfAborted()
    this.ensureOwnerCleanup(owner)
    const backend = this.backends.get(request.type)
    if (backend === undefined) throw new TerminalError(`no PTY backend registered for "${request.type}"`, 'NO_BACKEND')
    if (request.name !== undefined && request.name.length === 0) throw new Error('PTY session name must be non-empty')
    const releaseName = this.reserveName(owner, request.name)
    const spawnReservation = this.reserveSpawn(owner)
    const backendSignal = signal === undefined
      ? spawnReservation.signal
      : AbortSignal.any([signal, spawnReservation.signal])
    const sessionId = TerminalSessionId(`pty-${++this.nextId}`)
    let session: TerminalBackendSession | undefined
    let cleanupFailure: { error: unknown } | undefined
    try {
      session = await backend.spawn({
        sessionId,
        owner,
        type: request.type,
        ...request.name !== undefined ? { name: request.name } : {},
        ...request.cwd !== undefined ? { cwd: request.cwd } : {},
        signal: backendSignal,
      })
      signal?.throwIfAborted()
      if (this.disposing) {
        throw new TerminalError('PTY service is disposing', 'SERVICE_DISPOSING')
      }
      if (!this.isLiveOwner(owner)) {
        throw new TerminalError('PTY owner is no longer live', 'OWNER_NOT_LIVE')
      }
      const record: SessionRecord = {
        id: sessionId,
        owner,
        name: request.name,
        type: request.type,
        session,
        active: undefined,
        closing: undefined,
      }
      this.sessions.set(sessionId, record)
      return this.snapshot(record, session.motd)
    } catch (error) {
      // 后端清理失败（TerminalBackendCleanupError）与本地回滚失败都要聚合上报。
      if (error instanceof TerminalBackendCleanupError) {
        cleanupFailure = { error: error.cleanupError }
      }
      let rollbackFailure: { error: unknown } | undefined
      if (session !== undefined && !this.sessions.has(sessionId)) {
        try {
          await session.close('PTY spawn rolled back')
        } catch (closeError: unknown) {
          rollbackFailure = { error: closeError }
          cleanupFailure = rollbackFailure
        }
      }
      let failure: unknown = error
      try {
        signal?.throwIfAborted()
        spawnReservation.signal.throwIfAborted()
      } catch (cancellation: unknown) {
        failure = cancellation
      }
      if (rollbackFailure !== undefined && signal?.aborted !== true) {
        throw new AggregateError([failure, rollbackFailure.error], 'PTY spawn and rollback both failed')
      }
      throw failure
    } finally {
      spawnReservation.release(cleanupFailure)
      releaseName()
    }
  }

  /**
   * Test whether an exact owner has a published session or unpublished spawn.
   * @param owner - exact live owner to inspect.
   * @returns true across the entire spawn-to-close interval, with no publication gap.
   */
  /**
   * 测试一个精确 owner 是否有已发布会话或未发布 spawn。
   * @param owner 待检查的精确存活 owner
   * @returns 在整个 spawn 到 close 区间都为 true，无发布间隙
   */
  hasOwnerActivity(owner: Agent): boolean {
    return (this.pendingSpawns.get(owner)?.size ?? 0) > 0
      || [...this.sessions.values()].some(record => record.owner === owner)
  }

  /**
   * Start one exclusive interactive send.
   * @param owner - exact session owner.
   * @param id - target PTY identity.
   * @param request - explicit text, submit behavior, and cancellation.
   * @returns live operation handle for foreground await or task registration.
   */
  /**
   * 启动一个排他交互式发送（会话已有活跃发送时抛 SEND_ACTIVE）。
   * @param owner 精确会话 owner
   * @param id 目标 PTY 身份
   * @param request 显式文本、提交行为与取消
   * @returns 供前台等待或任务登记的存活操作句柄
   */
  startSend(owner: Agent, id: TerminalSessionId, request: TerminalSendRequest): TerminalSendOperation {
    const record = this.expectOwned(owner, id)
    if (record.closing !== undefined) throw new Error(`PTY session ${id} is closing`)
    if (record.active !== undefined) throw new TerminalError(`PTY session ${id} already has an active send`, 'SEND_ACTIVE')
    const operation = record.session.startSend(request)
    record.active = operation
    void operation.done.then(
      () => { record.active = undefined },
      () => { record.active = undefined },
    )
    return operation
  }

  /**
   * Read one bounded scrollback page from an owned session.
   * @param owner - exact session owner.
   * @param id - target PTY identity.
   * @param request - optional newest-relative offset and line count.
   * @returns bounded retained text and pagination metadata.
   */
  /**
   * 从某 owner 会话读一页有界滚动区。
   * @param owner 精确会话 owner
   * @param id 目标 PTY 身份
   * @param request 可选的最新相对偏移与行数
   * @returns 有界保留文本与分页元数据
   */
  read(owner: Agent, id: TerminalSessionId, request: TerminalReadRequest = {}): TerminalReadResult {
    return this.expectOwned(owner, id).session.read(request)
  }

  /**
   * Deliver an allowed signal through an owned backend session.
   * @param owner - exact session owner.
   * @param id - target PTY identity.
   * @param signal - allowed POSIX signal name.
   * @returns delivered foreground process-group identity.
   */
  /**
   * 经某 owner 后端会话投递允许的信号。
   * @param owner 精确会话 owner
   * @param id 目标 PTY 身份
   * @param signal 允许的 POSIX 信号名
   * @returns 已投递的前台进程组身份
   */
  signal(owner: Agent, id: TerminalSessionId, signal: TerminalSignal): Promise<TerminalSignalResult> {
    return this.expectOwned(owner, id).session.signal(signal)
  }

  /**
   * Close one owned session and remove it only after quiescent backend cleanup.
   * @param owner - exact session owner.
   * @param id - target PTY identity.
   * @param reason - diagnostic cleanup reason.
   * @returns true for a newly closed session, false when the same close is already in flight.
   */
  /**
   * 关闭一个 owner 会话，后端清理静默后才移除。closing 围栏保证同一 close 幂等合并。
   * @param owner 精确会话 owner
   * @param id 目标 PTY 身份
   * @param reason 诊断用清理原因
   * @returns 新发起的关闭返回 true；同一关闭已在途返回 false
   */
  async kill(owner: Agent, id: TerminalSessionId, reason: string = 'model request'): Promise<boolean> {
    const record = this.expectOwned(owner, id)
    if (record.closing !== undefined) {
      await record.closing
      return false
    }
    const closing = record.session.close(reason)
    record.closing = closing
    try {
      await closing
      this.sessions.delete(id)
      return true
    } catch (error) {
      record.closing = undefined
      throw error
    }
  }

  /**
   * List fresh snapshots for exactly one owner.
   * @param owner - exact owner whose sessions are visible.
   * @returns owner-visible snapshots in publication order.
   */
  /**
   * 列出恰一个 owner 的新鲜快照。
   * @param owner 其会话可见的精确 owner
   * @returns 按发布顺序的 owner 可见快照
   */
  list(owner: Agent): TerminalSessionSnapshot[] {
    return [...this.sessions.values()]
      .filter(record => record.owner === owner)
      .map(record => this.snapshot(record))
  }

  private assertActive(): void {
    if (this.disposing) throw new TerminalError('PTY service is disposing', 'SERVICE_DISPOSING')
  }

  private isLiveOwner(owner: Agent): boolean {
    return !this.disposedOwners.has(owner) && this.ctx.get('agents')?.get(owner.id) === owner
  }

  private ensureOwnerCleanup(owner: Agent): void {
    if (!this.isLiveOwner(owner)) {
      throw new TerminalError(`agent "${owner.id}" is not the registered PTY owner`, 'OWNER_NOT_LIVE')
    }
    if (this.ownerCleanups.has(owner)) return
    const detach = owner.ctx.effect(() => async () => {
      this.disposedOwners.add(owner)
      this.ownerCleanups.delete(owner)
      await this.disposeOwned(owner)
    }, 'pty.ownerCleanup()')
    this.ownerCleanups.set(owner, detach)
  }

  private reserveName(owner: Agent, name: string | undefined): () => void {
    if (name === undefined) return () => {}
    if ([...this.sessions.values()].some(record => record.owner === owner && record.name === name)) {
      throw new TerminalError(`PTY session name "${name}" already exists for this owner`, 'DUPLICATE_NAME')
    }
    const reserved = this.reservedNames.get(owner) ?? new Set<string>()
    if (reserved.has(name)) throw new TerminalError(`PTY session name "${name}" is already being created`, 'DUPLICATE_NAME')
    reserved.add(name)
    this.reservedNames.set(owner, reserved)
    return () => {
      reserved.delete(name)
      if (reserved.size === 0) this.reservedNames.delete(owner)
    }
  }

  private reserveSpawn(owner: Agent): SpawnReservation {
    const controller = new AbortController()
    const settlement = Promise.withResolvers<void>()
    const pending: PendingSpawn = { owner, controller, settled: settlement.promise, cleanupFailure: undefined }
    const owned = this.pendingSpawns.get(owner) ?? new Set<PendingSpawn>()
    owned.add(pending)
    this.pendingSpawns.set(owner, owned)
    return {
      signal: controller.signal,
      release: (cleanupFailure) => {
        pending.cleanupFailure = cleanupFailure
        if (cleanupFailure === undefined) this.removePendingSpawn(pending)
        settlement.resolve()
      },
    }
  }

  private removePendingSpawn(pending: PendingSpawn): void {
    const owned = this.pendingSpawns.get(pending.owner)
    if (owned === undefined) return
    owned.delete(pending)
    if (owned.size === 0) this.pendingSpawns.delete(pending.owner)
  }

  private async abortPendingSpawns(owner: Agent | undefined, reason: TerminalError): Promise<void> {
    const pending = owner === undefined
      ? [...this.pendingSpawns.values()].flatMap(owned => [...owned])
      : [...(this.pendingSpawns.get(owner) ?? [])]
    for (const spawn of pending) spawn.controller.abort(reason)
    await Promise.all(pending.map(spawn => spawn.settled))
    const failures = pending.flatMap(spawn => spawn.cleanupFailure === undefined ? [] : [spawn.cleanupFailure.error])
    for (const spawn of pending) this.removePendingSpawn(spawn)
    if (failures.length > 0) {
      throw new AggregateError(failures, 'failed to roll back unpublished PTY setup')
    }
  }

  private expectOwned(owner: Agent, id: TerminalSessionId): SessionRecord {
    const record = this.sessions.get(id)
    if (record === undefined) throw new TerminalError(`unknown PTY session ${id}`, 'NO_SESSION')
    if (record.owner !== owner) throw new TerminalError(`PTY session ${id} belongs to another agent`, 'FOREIGN_SESSION')
    return record
  }

  private snapshot(record: SessionRecord): TerminalSessionSnapshot
  private snapshot(record: SessionRecord, motd: string): TerminalSpawnResult
  private snapshot(record: SessionRecord, motd?: string): TerminalSpawnResult | TerminalSessionSnapshot {
    return {
      sessionId: record.id,
      ...record.name !== undefined ? { name: record.name } : {},
      type: record.type,
      ...record.session.pid !== undefined ? { pid: record.session.pid } : {},
      status: record.session.status(),
      ...motd !== undefined ? { motd } : {},
    }
  }

  private async abortAndClose(owner: Agent | undefined, abortReason: TerminalError, closeReason: string): Promise<void> {
    const failures: unknown[] = []
    try {
      await this.abortPendingSpawns(owner, abortReason)
    } catch (error: unknown) {
      failures.push(error)
    }
    const records = [...this.sessions.values()].filter(record => owner === undefined || record.owner === owner)
    try {
      await this.closeRecords(records, closeReason)
    } catch (error: unknown) {
      failures.push(error)
    }
    if (failures.length > 0) throw new AggregateError(failures, 'failed to clean up PTY lifecycle')
  }

  private async disposeOwned(owner: Agent): Promise<void> {
    try {
      await this.abortAndClose(
        owner,
        new TerminalError('PTY owner is no longer live', 'OWNER_NOT_LIVE'),
        'PTY owner disposed',
      )
    } finally {
      this.reservedNames.delete(owner)
    }
  }

  private async disposeAll(): Promise<void> {
    this.disposing = true
    // Teardown is best-effort: a close failure still clears registries and runs
    // owner cleanups before the aggregated error propagates, so one stuck
    // session cannot orphan backends, reservations, or owner detachers.
    try {
      await this.abortAndClose(
        undefined,
        new TerminalError('PTY service is disposing', 'SERVICE_DISPOSING'),
        'PTY service disposed',
      )
    } finally {
      this.backends.clear()
      this.reservedNames.clear()
      this.pendingSpawns.clear()
      const cleanups = [...this.ownerCleanups.values()]
      this.ownerCleanups.clear()
      await Promise.all(cleanups.map(cleanup => Promise.resolve(cleanup())))
    }
  }

  private async closeRecords(records: SessionRecord[], reason: string): Promise<void> {
    const results = await Promise.allSettled(records.map(async (record) => {
      const closing = record.closing ?? record.session.close(reason)
      record.closing = closing
      try {
        await closing
        this.sessions.delete(record.id)
      } catch (error: unknown) {
        // A concurrent retry may already own a newer fence; never clear it.
        if (record.closing === closing) record.closing = undefined
        throw error
      }
    }))
    const failures = results
      .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      .map<unknown>(result => result.reason as unknown)
    if (failures.length > 0) throw new AggregateError(failures, `failed to close ${failures.length} PTY session(s)`)
  }
}

export default TerminalSessionService
