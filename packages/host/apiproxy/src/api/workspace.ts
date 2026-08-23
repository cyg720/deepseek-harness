/**
 * ================================ 文件注释 ================================
 * 【文件职责】workspace 域契约：宿主侧工作区实体（@deepseek-ai/dsh-workspace）
 * 的线上投影——目录路径上的稳定 id、显示标题与有序会话账目。方法签名是事实
 * 来源（与 sessions 域一致）。
 * 【技术维度】纯类型契约；WorkspaceId 在此重声明而非从 dsh-workspace 导入：
 * api/ 必须零宿主包依赖、浏览器可导入，品牌字符串一致即可结构兼容。
 * 【产品维度】远程 GUI 的工作区组织：多项目分组、命名、排序与会话归档管理。
 * 【逻辑维度】WorkspaceId → WorkspaceView → WorkspaceApi 七个方法（list/create/
 * rename/delete/insertBefore/insertSessionBefore/archiveSession）。
 * 【关键边界】create 只覆盖已存在目录（不 mkdir）；delete 不触碰目录与日志；
 * 归档会话保留日志与账目槽位（可取消归档恢复）；同标题冲突与移动非法有专属
 * 错误码。
 * 【新手阅读建议】与 workspace.schema.ts 及 api-proxy.ts 的 workspace 域实现
 * （workspaceCreationChain 串行链）对照阅读。
 * ==========================================================================
 */
/**
 * workspace domain contract. Wire projection of the host-side workspace
 * entity (@deepseek-ai/dsh-workspace): a stable id over a directory path,
 * a display title, and the ordered session account. Method signatures are the
 * source of truth, same as the sessions domain.
 */

import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { RpcRequest, RpcResponse } from './rpc.ts'

/**
 * Wire-side workspace id brand. Deliberately re-declared here rather than
 * imported from dsh-workspace: api/ must stay browser-importable with zero
 * host-package dependencies, and the brand string matches, so both sides
 * agree structurally.
 */
// 线上工作区 id 品牌：刻意在此重声明而非从 dsh-workspace 导入——api/ 必须零
// 宿主包依赖、浏览器可导入；品牌字符串一致即可结构兼容。
export type WorkspaceId = Branded<'WorkspaceId'>

/** One workspace row: the record projection every workspace.* value carries. */
// 一个工作区行：所有 workspace.* 值携带的记录投影。
export interface WorkspaceView {
  workspaceId: WorkspaceId
  /** Canonical directory path (host-side realpath canon). */
  // 规范目录路径（宿主侧 realpath 规范化）。
  path: string
  /** Display title (defaults to the path basename at create). */
  // 显示标题（创建时默认取路径基名）。
  title: string
  /**
   * Sessions accounted under this workspace, in manually owned order
   * (attach prepends, insertSessionBefore reorders; activity never does).
   */
  // 本工作区账目下的会话（手工维护顺序：attach 前置、insertSessionBefore 重排，
  // 活动状态从不影响顺序）。
  sessionIds: SessionId[]
  /** ISO-8601 creation instant. */
  // ISO-8601 创建时刻。
  createdAt: string
  /** ISO-8601 last-mutation instant. */
  // ISO-8601 最后变更时刻。
  updatedAt: string
}

/** Workspace-domain unary methods (the map keys workspace.* of RpcMethodMap). */
// 工作区域一元方法接口。
export interface WorkspaceApi {
  /**
   * Lists all workspaces in the registry's durable display order, plus the
   * registry-global archive set (the reconnect baseline of
   * `host/archived-sessions-changed`). Archived sessions stay in their
   * workspace's `sessionIds` account; grouping surfaces hide them.
   */
  list(request: RpcRequest<{}>): Promise<RpcResponse<{ items: WorkspaceView[]; archivedSessionIds: SessionId[] }>>

  /**
   * Creates (or idempotently resolves) a workspace over an EXISTING directory
   * (no mkdir — a missing or non-directory path fails with
   * `workspace-invalid-path`). A path resolving to a directory already owned
   * by a workspace returns that workspace (`created: false`). Adoption allows
   * distinct canonical paths whose basenames produce the same display title;
   * the registry's basename title default names the new workspace.
   */
  create(request: RpcRequest<{ path: string }>):
  Promise<RpcResponse<{ workspace: WorkspaceView; created: boolean }>>

  /**
   * Renames a workspace. `title` is trimmed and must be non-empty
   * (schema-enforced). An unknown id fails with `workspace-not-found`; a
   * title equal to another workspace's fails with `workspace-name-conflict`.
   * Renaming to the current title is a no-op success (no durable write).
   */
  rename(request: RpcRequest<{ workspaceId: WorkspaceId; title: string }>):
  Promise<RpcResponse<{ workspace: WorkspaceView }>>

  /**
   * Removes one Workspace registration. The directory, every user file, and
   * every session log remain untouched; those Sessions consequently become
   * ungrouped. An unknown id fails with `workspace-not-found`.
   */
  delete(request: RpcRequest<{ workspaceId: WorkspaceId }>):
  Promise<RpcResponse<{ deleted: true }>>

  /**
   * Moves one Workspace within the registry display order,
   * DOM-insertBefore-like. An omitted anchor appends to the end.
   */
  insertBefore(request: RpcRequest<{
    workspaceId: WorkspaceId
    beforeWorkspaceId?: WorkspaceId
  }>): Promise<RpcResponse<{ workspaceIds: WorkspaceId[] }>>

  /**
   * Moves an accounted session within its workspace's manual order,
   * DOM-insertBefore-like: with `beforeSessionId` the session is inserted
   * before that anchor; omitted appends to the end. An unknown workspace
   * fails with `workspace-not-found`; a session or anchor not accounted by
   * the workspace fails with `workspace-move-invalid`. A move to the current
   * position is a no-op success.
   */
  insertSessionBefore(request: RpcRequest<{
    workspaceId: WorkspaceId
    sessionId: SessionId
    beforeSessionId?: SessionId
  }>): Promise<RpcResponse<{ workspace: WorkspaceView }>>

  /**
   * Adds one session to the registry-global archive set: the session
   * disappears from every grouping surface but keeps its session log and its
   * workspace accounting slot (a future unarchive restores its position).
   * Idempotent for an already archived id. A session neither live nor in
   * session persistence fails with `session-not-found`. Returns the full
   * updated set (same snapshot the changed frame carries).
   */
  archiveSession(request: RpcRequest<{ sessionId: SessionId }>):
  Promise<RpcResponse<{ archivedSessionIds: SessionId[] }>>
}
