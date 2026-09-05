/**
 * Workspace entity registry (`ctx.workspaceRegistry`): durable workspace records,
 * stable registry order, and header-validated session membership over the
 * domain data form.
 * @module @deepseek-ai/dsh-workspace
 */

/*
 * 【文件职责】管理持久工作区实体、稳定顺序和会话成员关系，加入会话前验证其头部中的工作区事实。
 */

import { randomUUID } from 'node:crypto'
import { stat } from 'node:fs/promises'
import { Context, Service } from '@deepseek-ai/cordis'
import type { SessionHeader, SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type { DomainGlobal, KvTable } from '@deepseek-ai/dsh-storage-domain'
import { WorkspaceEntity } from './entity.ts'
import type { WorkspaceEntityHost } from './entity.ts'

export { WorkspaceMoveInvalidError } from './entity.ts'
import { defaultWorkspaceTitle, realpathNormalize } from './paths.ts'
import { workspaceDomainSpec } from './spec.ts'
import type { WorkspaceDomainState, WorkspaceRecord } from './spec.ts'
import type { Workspace, WorkspaceId as WorkspaceIdBrand } from './types.ts'

export type { Workspace } from './types.ts'
export { workspaceDomainState, workspaceRecord, workspaceDomainSpec } from './spec.ts'
export type { WorkspaceDomainState, WorkspaceRecord } from './spec.ts'
export { realpathNormalize } from './paths.ts'

/** Identifies one workspace record (see `src/types.ts` for the brand rationale). */
/* 中文说明：type WorkspaceId 定义本模块所需的数据或行为，用于表达工作区实体与配置场景。 */
export type WorkspaceId = WorkspaceIdBrand

/**
 * Brand a string as a {@link WorkspaceId}.
 * @param id - Raw workspace id string.
 * @returns the same string, branded at compile time.
 */
/*
 * 中文说明：函数 WorkspaceId 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。
 * @param id 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
 */
export function WorkspaceId(id: string): WorkspaceId {
  return id as WorkspaceId
}

/**
 * An archiveSession request named a session neither live nor in session
 * persistence — a definite miss only; storage faults propagate as themselves.
 */
/* 中文说明：class WorkspaceUnknownSessionError 定义本模块所需的数据或行为，用于表达工作区实体与配置场景。 */
export class WorkspaceUnknownSessionError extends Error {
  /**
   * @param sessionId - The unknown session id.
   */
  constructor(readonly sessionId: SessionId) {
    super(`cannot archive session '${sessionId}': live sessions and session persistence hold no such session`)
    this.name = 'WorkspaceUnknownSessionError'
  }
}

/** A workspace reorder named a source or anchor absent from the durable registry order. */
/* 中文说明：class WorkspaceOrderInvalidError 定义本模块所需的数据或行为，用于表达工作区实体与配置场景。 */
export class WorkspaceOrderInvalidError extends Error {
  /**
   * @param workspaceId - Missing source or anchor id.
   */
  constructor(readonly workspaceId: WorkspaceId) {
    super(`cannot reorder unknown workspace '${workspaceId}'`)
    this.name = 'WorkspaceOrderInvalidError'
  }
}


declare module '@deepseek-ai/cordis' {
  /** 中文说明：interface Context 定义本模块所需的数据或行为，用于表达工作区实体与配置场景。 */
  interface Context {
    workspaceRegistry: WorkspaceRegistry
  }
}

/** 中文说明：interface BootstrapGroup 定义本模块所需的数据或行为，用于表达工作区实体与配置场景。 */
interface BootstrapGroup {
  readonly path: string
  readonly headers: SessionHeader[]
  readonly newestAt: number
}

/** 中文说明：函数值 sameIds 封装本模块的局部步骤；参数和返回值由右侧签名约束；示例见本模块调用。 */
const sameIds = (left: readonly WorkspaceId[], right: readonly WorkspaceId[]): boolean =>
  left.length === right.length && left.every((id, index) => id === right[index])

/** 中文说明：函数值 compareHeaders 封装本模块的局部步骤；参数和返回值由右侧签名约束；示例见本模块调用。 */
const compareHeaders = (left: SessionHeader, right: SessionHeader): number =>
  right.createdAt - left.createdAt || String(left.id).localeCompare(String(right.id))

/**
 * Durable workspace registry. Startup waits for `sessionPersistence`, builds
 * one canonical-cwd header index, and completes the one-time history
 * bootstrap before the service becomes active. The persistence dependency is
 * mandatory so an unavailable peer can never be mistaken for an empty
 * history and commit the initialized marker.
 */
/* 中文说明：class WorkspaceRegistry 定义本模块所需的数据或行为，用于表达工作区实体与配置场景。 */
export class WorkspaceRegistry extends Service {
  static inject = ['storageDomain', 'sessionPersistence']

  private table?: KvTable<WorkspaceId, WorkspaceRecord>
  private global?: DomainGlobal<WorkspaceDomainState>
  private state?: WorkspaceDomainState
  private readonly entities = new Map<WorkspaceId, WorkspaceEntity>()
  private readonly headers = new Map<SessionId, SessionHeader>()
  private readonly sessionPaths = new Map<SessionId, string>()
  private readonly invalidSessionPaths = new Map<SessionId, string>()
  private operationTail: Promise<void> = Promise.resolve()

  private readonly host: WorkspaceEntityHost = {
    table: () => this.requireTable(),
    sessionPath: id => this.sessionPaths.get(id),
    readSessionHeader: id => this.readSessionHeader(id),
    rememberSessionPath: (id, path) => {
      this.sessionPaths.set(id, path)
      this.invalidSessionPaths.delete(id)
    },
  }

  constructor(ctx: Context) {
    super(ctx, 'workspaceRegistry')
  }

  /** Open the domain, finish bootstrap when required, and rebuild the ordered cache. */
  protected async [Service.init](): Promise<void> {
    /** 中文说明：变量 domain 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const domain = await this.ctx.storageDomain.open(workspaceDomainSpec)
    this.ctx.effect(() => () => domain.close(), 'workspace.domainClose')
    this.table = domain.table('workspaces')
    this.global = domain.global
    this.state = domain.global.get()

    await this.recoverPendingMutation()
    this.validateStoredState(this.state)
    if (!this.state.initialized) {
      const headers = await this.listStoredHeaders()
      await this.replaceHeaderIndex(headers)
      await this.bootstrap(headers)
    } else if (this.table.size > 0) {
      await this.replaceHeaderIndex(await this.listStoredHeaders())
    }

    await this.indexLiveSessions()
    this.validateStoredState(this.requireState())
    this.rebuildEntities()
    this.reportFilteredCandidates()
  }

  /**
   * Create or reuse a workspace for an existing directory. The fully qualified
   * path is canonicalized through `fs.realpath`; a relative, nonexistent, or
   * non-directory path rejects. Repeated calls for the same canonical path
   * return the existing entity without changing its title.
   * A newly created workspace is prepended to the durable registry order.
   * Different canonical paths may share a display title.
   * @param path - Existing directory to own, in a fully qualified path spelling.
   * @param title - Display title used only when a new record is created.
   * @returns the existing or newly durable workspace.
   */
  // TODO: `title` lost its last production caller when the gateway's
  // create-by-name branch was deleted
  // (.agents/notes/implemented/simplification/2026-07-31-one-route-to-add-a-workspace.md);
  // drop the parameter with its @param clause and the `create(path, title?)`
  // lines in this package's README pair.
  async create(path: string, title?: string): Promise<Workspace> {
    /** 中文说明：变量 canonical 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const canonical = await realpathNormalize(path)
    if (!(await stat(canonical)).isDirectory()) {
      throw new Error(`cannot create a workspace at '${canonical}': path is not a directory`)
    }
    return await this.enqueueOperation(() => this.createCanonical(canonical, title))
  }

  /**
   * Look up a workspace by id.
   * @param id - Workspace id.
   * @returns the workspace, or `undefined` when unknown.
   */
  get(id: WorkspaceId): Workspace | undefined {
    return this.entities.get(id)
  }

  /**
   * Synchronous workspace projection in durable registry order. Every
   * entity's `sessionIds` getter is already filtered by the startup/live
   * canonical-cwd header index; this method performs no persistence reads.
   * @returns a fresh ordered array of workspace entities.
   */
  list(): Workspace[] {
    return this.requireState().workspaceIds.map((id) => {
      /** 中文说明：变量 entity 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const entity = this.entities.get(id)
      if (entity === undefined) {
        throw new Error(`workspace registry order references missing workspace '${id}'`)
      }
      return entity
    })
  }

  /**
   * Delete one workspace registration while retaining its directory and every
   * session log. The durable order is updated before the table deletion; a
   * failed table write restores the prior order and keeps the entity
   * published. Unknown ids are an idempotent no-op for domain callers.
   * @param id - Workspace registration to remove.
   * @returns `true` when a record was deleted, `false` when it was unknown.
   */
  delete(id: WorkspaceId): Promise<boolean> {
    return this.enqueueOperation(() => this.deleteKnown(id))
  }

  /**
   * Move one workspace within the durable display order, DOM-insertBefore-like.
   * With an anchor it lands before that workspace; without one it appends.
   * @param id - Workspace to move.
   * @param beforeId - Workspace anchor; omitted appends.
   * @returns the complete committed workspace order.
   */
  insertBefore(id: WorkspaceId, beforeId?: WorkspaceId): Promise<readonly WorkspaceId[]> {
    return this.enqueueOperation(async () => {
      /** 中文说明：变量 state 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const state = this.requireState()
      if (!state.workspaceIds.includes(id)) throw new WorkspaceOrderInvalidError(id)
      if (beforeId !== undefined && !state.workspaceIds.includes(beforeId)) {
        throw new WorkspaceOrderInvalidError(beforeId)
      }
      if (beforeId === id) return state.workspaceIds
      /** 中文说明：函数值 without 封装本模块的局部步骤；参数和返回值由右侧签名约束；示例见本模块调用。 */
      const without = state.workspaceIds.filter(workspaceId => workspaceId !== id)
      /** 中文说明：变量 at 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const at = beforeId === undefined ? without.length : without.indexOf(beforeId)
      /** 中文说明：变量 workspaceIds 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const workspaceIds = [...without.slice(0, at), id, ...without.slice(at)]
      if (sameIds(workspaceIds, state.workspaceIds)) return state.workspaceIds
      await this.setState({ ...state, workspaceIds })
      return workspaceIds
    })
  }

  /**
   * The registry-global archive set: sessions hidden from every grouping
   * surface. Archiving never touches workspace accounting — an archived
   * session keeps its `sessionIds` slot so unarchiving restores its position.
   * @returns the archived session ids in archive order.
   */
  get archivedSessionIds(): readonly SessionId[] {
    return this.requireState().archivedSessionIds
  }

  /**
   * Archive one session durably. The session must exist (live or in session
   * persistence); its workspace accounting — or lack of one — is irrelevant.
   * An already archived id resolves without writing.
   * @param sessionId - The session to archive.
   * @returns resolution after durability.
   */
  archiveSession(sessionId: SessionId): Promise<void> {
    return this.enqueueOperation(async () => {
      // The chain slot serializes against every other registry write, so this
      // check-then-write pair cannot interleave with another archive.
      if (this.requireState().archivedSessionIds.includes(sessionId)) return
      if (!(await this.sessionKnown(sessionId))) {
        throw new WorkspaceUnknownSessionError(sessionId)
      }
      /** 中文说明：变量 state 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const state = this.requireState()
      await this.setState({ ...state, archivedSessionIds: [...state.archivedSessionIds, sessionId] })
    })
  }

  /**
   * Whether a session is live, header-indexed, or present in a fresh
   * persistence listing. Only a definite miss returns false — a failing
   * `sessionPersistence.list()` propagates so storage faults never
   * masquerade as an unknown session.
   */
  private async sessionKnown(id: SessionId): Promise<boolean> {
    if (this.ctx.get('sessions')?.get(id) !== undefined) return true
    if (this.headers.has(id)) return true
    await this.indexHeaders(await this.listStoredHeaders())
    return this.headers.has(id)
  }

  /**
   * Resolve by canonical directory path without creating or mutating a
   * workspace. A missing path rejects during `realpath`; an existing unowned
   * directory returns `undefined`.
   * @param path - Existing directory path in a fully qualified spelling.
   * @returns the workspace owning the canonical path, when one exists.
   */
  async resolveByPath(path: string): Promise<Workspace | undefined> {
    /** 中文说明：变量 canonical 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const canonical = await realpathNormalize(path)
    /** 中文说明：该循环依次处理消息或实体；循环变量仅在当前循环中有效。 */
    for (const entity of this.entities.values()) {
      if (entity.path === canonical) return entity
    }
    return undefined
  }

  private async createCanonical(canonical: string, title?: string): Promise<WorkspaceEntity> {
    /** 中文说明：该循环依次处理消息或实体；循环变量仅在当前循环中有效。 */
    for (const entity of this.entities.values()) {
      if (entity.path === canonical) return entity
    }

    const workspaceName = title ?? defaultWorkspaceTitle(canonical)
    const table = this.requireTable()
    /** 中文说明：变量 state 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const state = this.requireState()
    /** 中文说明：变量 id 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const id = WorkspaceId(randomUUID())
    /** 中文说明：变量 now 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const now = new Date().toISOString()
    /** 中文说明：变量 record 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const record: WorkspaceRecord = {
      path: canonical,
      title: workspaceName,
      sessionIds: [],
      createdAt: now,
      updatedAt: now,
    }
    /** 中文说明：变量 entity 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const entity = new WorkspaceEntity(this.host, id, record)
    this.entities.set(id, entity)
    /** 中文说明：变量 pendingState 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const pendingState: WorkspaceDomainState = {
      ...state,
      pendingMutation: { operation: 'create', workspaceId: id },
    }
    try {
      await this.setState(pendingState)
    } catch (error) {
      this.entities.delete(id)
      throw error
    }
    try {
      await table.put(id, record)
    } catch (error) {
      this.entities.delete(id)
      try {
        await this.setState(state)
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          `workspace '${id}' record write and pending-marker rollback both failed`,
        )
      }
      throw error
    }

    try {
      await this.setState({
        initialized: true,
        workspaceIds: [id, ...state.workspaceIds],
        archivedSessionIds: state.archivedSessionIds,
      })
    } catch (error) {
      this.entities.delete(id)
      try {
        await table.delete(id)
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          `workspace '${id}' order write and record rollback both failed; the pending marker remains recoverable`,
        )
      }
      try {
        await this.setState(state)
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          `workspace '${id}' order write and pending-marker rollback both failed`,
        )
      }
      throw error
    }
    return entity
  }

  private async deleteKnown(id: WorkspaceId): Promise<boolean> {
    /** 中文说明：变量 entity 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const entity = this.entities.get(id)
    if (entity === undefined) return false
    /** 中文说明：变量 state 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const state = this.requireState()
    /** 中文说明：变量 nextState 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const nextState = {
      initialized: true,
      workspaceIds: state.workspaceIds.filter(workspaceId => workspaceId !== id),
      archivedSessionIds: state.archivedSessionIds,
    }
    await this.setState({
      ...nextState,
      pendingMutation: { operation: 'delete', workspaceId: id },
    })
    this.entities.delete(id)
    try {
      await this.requireTable().delete(id)
    } catch (error) {
      this.entities.set(id, entity)
      try {
        await this.setState(state)
      } catch (rollbackError) {
        // The durable marker still says to finish deletion, so the cache must
        // agree with that recoverable direction rather than republish a row
        // absent from the persisted order.
        this.entities.delete(id)
        throw new AggregateError(
          [error, rollbackError],
          `workspace '${id}' record deletion and registry-order rollback both failed`,
        )
      }
      throw error
    }
    try {
      await this.setState(nextState)
    } catch (error) {
      // The deletion committed at the table write and was already published
      // to Host streams. Keep the durable marker for startup recovery rather
      // than reporting failure after the requested state became true.
      this.ctx.logger.warn(
        `workspace '${id}' was deleted but its pending marker could not be cleared: ${String(error)}`,
      )
    }
    return true
  }

  /**
   * Complete the one mutation explicitly named by durable state. Unexplained
   * order/table divergence still reaches {@link validateStoredState} and
   * fails loud; this path never guesses which operation created a row from its shape alone.
   */
  private async recoverPendingMutation(): Promise<void> {
    /** 中文说明：变量 state 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const state = this.requireState()
    /** 中文说明：变量 pending 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const pending = state.pendingMutation
    if (pending === undefined) return
    if (state.workspaceIds.includes(pending.workspaceId)) {
      throw new Error(
        `workspace domain is inconsistent: pending ${pending.operation} workspace `
        + `'${pending.workspaceId}' is still present in registry order`,
      )
    }
    await this.requireTable().delete(pending.workspaceId)
    await this.setState({
      initialized: state.initialized,
      workspaceIds: state.workspaceIds,
      archivedSessionIds: state.archivedSessionIds,
    })
  }

  private async bootstrap(headers: readonly SessionHeader[]): Promise<void> {
    /** 中文说明：变量 table 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const table = this.requireTable()
    /** 中文说明：变量 state 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const state = this.requireState()
    /** 中文说明：变量 groupsByPath 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const groupsByPath = new Map<string, SessionHeader[]>()
    /** 中文说明：该循环依次处理消息或实体；循环变量仅在当前循环中有效。 */
    for (const header of headers) {
      /** 中文说明：变量 path 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const path = this.sessionPaths.get(header.id)
      if (path === undefined) continue
      /** 中文说明：变量 group 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const group = groupsByPath.get(path)
      if (group === undefined) groupsByPath.set(path, [header])
      else group.push(header)
    }
    /** 中文说明：函数值 groups 封装本模块的局部步骤；参数和返回值由右侧签名约束；示例见本模块调用。 */
    const groups: BootstrapGroup[] = [...groupsByPath].map(([path, groupHeaders]) => {
      groupHeaders.sort(compareHeaders)
      /** 中文说明：变量 newest 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const newest = groupHeaders[0] as SessionHeader
      return { path, headers: groupHeaders, newestAt: newest.createdAt }
    }).sort((left, right) =>
      right.newestAt - left.newestAt || left.path.localeCompare(right.path))

    /** 中文说明：变量 byPath 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const byPath = new Map<string, WorkspaceId>()
    /** 中文说明：变量 accounted 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const accounted = new Map<SessionId, WorkspaceId>()
    /** 中文说明：该循环依次处理消息或实体；循环变量仅在当前循环中有效。 */
    for (const [id, record] of table.entries()) {
      byPath.set(record.path, id)
      /** 中文说明：该循环依次处理消息或实体；循环变量仅在当前循环中有效。 */
      for (const sessionId of record.sessionIds) accounted.set(sessionId, id)
    }

    /** 中文说明：该循环依次处理消息或实体；循环变量仅在当前循环中有效。 */
    for (const group of groups) {
      /** 中文说明：变量 id 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      let id = byPath.get(group.path)
      if (id === undefined) {
        /** 中文说明：变量 sessionIds 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const sessionIds = group.headers
          .map(header => header.id)
          .filter(sessionId => !accounted.has(sessionId))
        if (sessionIds.length === 0) continue
        id = WorkspaceId(randomUUID())
        /** 中文说明：变量 createdAt 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const createdAt = new Date(group.newestAt).toISOString()
        /** 中文说明：变量 record 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const record: WorkspaceRecord = {
          path: group.path,
          title: defaultWorkspaceTitle(group.path),
          sessionIds,
          createdAt,
          updatedAt: createdAt,
        }
        await table.put(id, record)
        byPath.set(group.path, id)
        /** 中文说明：该循环依次处理消息或实体；循环变量仅在当前循环中有效。 */
        for (const sessionId of sessionIds) accounted.set(sessionId, id)
        continue
      }

      /** 中文说明：变量 current 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const current = table.get(id) as WorkspaceRecord
      /** 中文说明：变量 historical 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const historical = group.headers
        .map(header => header.id)
        .filter(sessionId => accounted.get(sessionId) === undefined || accounted.get(sessionId) === id)
      /** 中文说明：变量 historicalSet 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const historicalSet = new Set(historical)
      /** 中文说明：变量 sessionIds 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const sessionIds = [
        ...historical,
        ...current.sessionIds.filter(sessionId => !historicalSet.has(sessionId)),
      ]
      if (sameSessionIds(current.sessionIds, sessionIds)) continue
      await table.update(id, record => ({
        ...record,
        sessionIds,
        updatedAt: new Date().toISOString(),
      }))
      /** 中文说明：该循环依次处理消息或实体；循环变量仅在当前循环中有效。 */
      for (const sessionId of historical) accounted.set(sessionId, id)
    }

    /** 中文说明：函数值 groupRank 封装本模块的局部步骤；参数和返回值由右侧签名约束；示例见本模块调用。 */
    const groupRank = new Map(groups.map(group => [group.path, group.newestAt]))
    /** 中文说明：函数值 priorRank 封装本模块的局部步骤；参数和返回值由右侧签名约束；示例见本模块调用。 */
    const priorRank = new Map(state.workspaceIds.map((id, index) => [id, index]))
    /** 中文说明：变量 workspaceIds 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const workspaceIds = [...table.entries()]
      .sort(([leftId, left], [rightId, right]) => {
        /** 中文说明：变量 leftTime 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const leftTime = groupRank.get(left.path) ?? Date.parse(left.createdAt)
        /** 中文说明：变量 rightTime 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const rightTime = groupRank.get(right.path) ?? Date.parse(right.createdAt)
        return rightTime - leftTime
          || (priorRank.get(leftId) ?? Number.MAX_SAFE_INTEGER)
            - (priorRank.get(rightId) ?? Number.MAX_SAFE_INTEGER)
          || String(leftId).localeCompare(String(rightId))
      })
      .map(([id]) => id)

    if (!sameIds(state.workspaceIds, workspaceIds)) {
      await this.setState({ initialized: false, workspaceIds, archivedSessionIds: state.archivedSessionIds })
    }
    await this.setState({ initialized: true, workspaceIds, archivedSessionIds: state.archivedSessionIds })
  }

  private validateStoredState(state: WorkspaceDomainState): void {
    /** 中文说明：变量 table 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const table = this.requireTable()
    /** 中文说明：变量 order 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const order = new Set<WorkspaceId>()
    /** 中文说明：该循环依次处理消息或实体；循环变量仅在当前循环中有效。 */
    for (const id of state.workspaceIds) {
      if (order.has(id)) {
        throw new Error(`workspace domain is inconsistent: registry order repeats workspace '${id}'`)
      }
      if (table.get(id) === undefined) {
        throw new Error(`workspace domain is inconsistent: registry order references missing workspace '${id}'`)
      }
      order.add(id)
    }
    if (state.initialized && order.size !== table.size) {
      /** 中文说明：函数值 orphan 封装本模块的局部步骤；参数和返回值由右侧签名约束；示例见本模块调用。 */
      const orphan = [...table.keys()].find(id => !order.has(id))
      throw new Error(
        `workspace domain is inconsistent: workspace '${orphan as WorkspaceId}' is absent from registry order`,
      )
    }

    /** 中文说明：变量 paths 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const paths = new Map<string, WorkspaceId>()
    /** 中文说明：变量 accounted 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const accounted = new Map<SessionId, WorkspaceId>()
    /** 中文说明：该循环依次处理消息或实体；循环变量仅在当前循环中有效。 */
    for (const [id, record] of table.entries()) {
      /** 中文说明：变量 pathHolder 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const pathHolder = paths.get(record.path)
      if (pathHolder !== undefined) {
        throw new Error(
          `workspace domain is inconsistent: path '${record.path}' is claimed `
          + `by both workspace '${pathHolder}' and workspace '${id}'`,
        )
      }
      paths.set(record.path, id)
      /** 中文说明：该循环依次处理消息或实体；循环变量仅在当前循环中有效。 */
      for (const sessionId of record.sessionIds) {
        /** 中文说明：变量 holder 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const holder = accounted.get(sessionId)
        if (holder !== undefined) {
          throw new Error(
            `workspace domain is inconsistent: session '${sessionId}' is accounted `
            + `by both workspace '${holder}' and workspace '${id}'`,
          )
        }
        accounted.set(sessionId, id)
      }
    }
  }

  private rebuildEntities(): void {
    this.entities.clear()
    /** 中文说明：该循环依次处理消息或实体；循环变量仅在当前循环中有效。 */
    for (const id of this.requireState().workspaceIds) {
      /** 中文说明：变量 record 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const record = this.requireTable().get(id) as WorkspaceRecord
      this.entities.set(id, new WorkspaceEntity(this.host, id, record))
    }
  }

  private async replaceHeaderIndex(headers: readonly SessionHeader[]): Promise<void> {
    this.headers.clear()
    this.sessionPaths.clear()
    this.invalidSessionPaths.clear()
    await this.indexHeaders(headers)
  }

  private async indexHeaders(headers: readonly SessionHeader[]): Promise<void> {
    /** 中文说明：该循环依次处理消息或实体；循环变量仅在当前循环中有效。 */
    for (const header of headers) await this.indexHeader(header)
  }

  private async indexHeader(header: SessionHeader): Promise<void> {
    this.headers.set(header.id, header)
    this.sessionPaths.delete(header.id)
    if (header.cwd === undefined) {
      this.invalidSessionPaths.set(header.id, 'header has no cwd')
      return
    }
    try {
      /** 中文说明：变量 path 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const path = await realpathNormalize(header.cwd)
      if (!(await stat(path)).isDirectory()) {
        this.invalidSessionPaths.set(header.id, `cwd '${header.cwd}' is not a directory`)
        return
      }
      this.sessionPaths.set(header.id, path)
      this.invalidSessionPaths.delete(header.id)
    } catch {
      this.invalidSessionPaths.set(header.id, `cwd '${header.cwd}' does not resolve`)
    }
  }

  /** Every stored session's header, projected from the persistence snapshot listing. */
  private async listStoredHeaders(): Promise<SessionHeader[]> {
    const snapshots = await this.ctx.sessionPersistence.list()
    return snapshots.map(snapshot => snapshot.header)
  }

  private async indexLiveSessions(): Promise<void> {
    /** 中文说明：变量 sessions 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const sessions = this.ctx.get('sessions')
    if (sessions === undefined) return
    await this.indexHeaders(sessions.list().map(session => session.header))
  }

  private reportFilteredCandidates(): void {
    /** 中文说明：该循环依次处理消息或实体；循环变量仅在当前循环中有效。 */
    for (const entity of this.entities.values()) {
      /** 中文说明：变量 record 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const record = this.requireTable().get(entity.id) as WorkspaceRecord
      /** 中文说明：该循环依次处理消息或实体；循环变量仅在当前循环中有效。 */
      for (const sessionId of record.sessionIds) {
        /** 中文说明：变量 path 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const path = this.sessionPaths.get(sessionId)
        if (path === record.path) continue
        /** 中文说明：变量 reason 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const reason = this.invalidSessionPaths.get(sessionId)
          ?? (this.headers.has(sessionId)
            ? `canonical cwd '${path}' differs from workspace path '${record.path}'`
            : 'session header is missing')
        this.ctx.logger.warn(
          `workspace '${entity.id}' filtered session '${sessionId}' from membership: ${reason}`,
        )
      }
    }
  }

  private async readSessionHeader(id: SessionId): Promise<SessionHeader> {
    /** 中文说明：变量 live 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const live = this.ctx.get('sessions')?.get(id)
    if (live !== undefined) {
      this.headers.set(id, live.header)
      return live.header
    }
    /** 中文说明：变量 cached 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const cached = this.headers.get(id)
    if (cached !== undefined) return cached

    const headers = await this.listStoredHeaders()
    await this.indexHeaders(headers)
    /** 中文说明：变量 header 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const header = this.headers.get(id)
    if (header === undefined) {
      throw new Error(`cannot validate session '${id}': session persistence holds no such session`)
    }
    return header
  }

  private requireTable(): KvTable<WorkspaceId, WorkspaceRecord> {
    if (this.table === undefined) throw new Error('workspace registry is not started yet')
    return this.table
  }

  private requireState(): WorkspaceDomainState {
    if (this.state === undefined) throw new Error('workspace registry is not started yet')
    return this.state
  }

  private async setState(state: WorkspaceDomainState): Promise<void> {
    await (this.global as DomainGlobal<WorkspaceDomainState>).set(state)
    this.state = state
  }

  private enqueueOperation<T>(operation: () => Promise<T>): Promise<T> {
    /** 中文说明：函数值 result 封装本模块的局部步骤；参数和返回值由右侧签名约束；示例见本模块调用。 */
    const result = this.operationTail.then(async () => {
      // A committed delete may leave only its marker cleanup pending. Retry
      // recovery before another create/delete can overwrite that pending operation record.
      await this.recoverPendingMutation()
      return await operation()
    })
    this.operationTail = result.then(() => {}, () => {})
    return result
  }
}

/** 中文说明：函数值 sameSessionIds 封装本模块的局部步骤；参数和返回值由右侧签名约束；示例见本模块调用。 */
const sameSessionIds = (left: readonly SessionId[], right: readonly SessionId[]): boolean =>
  left.length === right.length && left.every((id, index) => id === right[index])

export default WorkspaceRegistry
