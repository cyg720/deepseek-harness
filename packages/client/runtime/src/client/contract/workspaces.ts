/**
 * ================================ 文件注释 ================================
 * 【文件职责】工作区服务（workspaces-service）的对外接口面：ctx.workspaces
 *   暴露给功能包与渲染宿主的能力清单，测试运行时的工作区替身（double）
 *   必须实现它。
 * 【技术维度】纯类型接口；wire 泵入口（handleHostEnvelope/handleConnected/
 *   refresh/startInitialSelection）留在具体类上，不进接口。
 * 【产品维度】工作区是客户端的主导航单位：连接会话、新建会话、目录选择、
 *   目录浏览、重命名、删除、排序、归档等都从这里发起。
 * 【逻辑维度】list 是只读标准源；connectWorkspace/startSession 负责会话
 *   归属；create/pickDirectory/listDirectory/createDirectory/openPath 负责
 *   目录；rename/delete/insertBefore/insertSessionBefore/archiveSession 负责
 *   组织管理。
 * 【关键边界】读侧之外的所有写操作都留在域内部；拓宽本接口即显式拓宽
 *   功能包可对工作区域做的事情。
 * 【新手阅读建议】对照 workspaces/service.ts 看实现如何满足本接口。
 * ==========================================================================
 */
/**
 * The outward workspaces-service face — what `ctx.workspaces` exposes to
 * feature packages and the renderer host, and therefore exactly what the
 * test runtime's workspaces double must implement. Wire-pump entry points
 * (handleHostEnvelope/handleConnected/refresh/startInitialSelection) stay on
 * the concrete class. Widening this interface is the explicit act of
 * widening what features may do to the workspaces domain.
 */
/**
 * 工作区服务对外面：ctx.workspaces 暴露给功能包与渲染宿主的能力，因此也是
 * 测试运行时的 work区替身必须实现的全部。wire 泵入口（handleHostEnvelope/
 * handleConnected/refresh/startInitialSelection）留在具体类上。拓宽本接口
 * 即显式拓宽功能包可对工作区域做的事情。
 */
import type { DirectoryListing, SessionId, WorkspaceId, WorkspaceView } from '@deepseek-ai/dsh-api-remotes/client'
import type { WorkspaceListState } from '../workspaces/service.ts'
import type { ObservableSnapshot } from './store.ts'

/** The workspaces-service face injected as `ctx.workspaces`. */
/** 以 ctx.workspaces 注入的工作区服务面。 */
export interface IWorkspaces {
  /** The useWorkspaces standard feed (read face — writes stay inside the domain). */
  /** useWorkspaces 的标准数据源（只读面——写操作留在域内部）。 */
  readonly list: ObservableSnapshot<WorkspaceListState>
  /**
   * Connect a Workspace to its reusable or freshly created blank session.
   * @param workspaceId - target workspace.
   * @returns the connected session id.
   */
  /**
   * 把工作区连接到其可复用的或新建的空白会话。
   * @param workspaceId 目标工作区。
   * @returns 连接后的会话 id。
   */
  connectWorkspace(workspaceId: WorkspaceId): Promise<SessionId>
  /**
   * The New Session flow: connect the explicit, current-Session, or recent
   * Workspace and open the resulting session; failures surface on the session
   * list state.
   * @param workspaceId - explicit target; omitted inherits the current
   * Session's Workspace before falling back to the recency projection.
   */
  /**
   * New Session 流程：连接显式指定、当前会话所在或最近使用的工作区并打开
   * 结果会话；失败会反映到会话列表状态上。
   * @param workspaceId 显式目标；省略时先继承当前会话的工作区，
   *   再回退到"最近使用"投影。
   */
  startSession(workspaceId?: WorkspaceId): void
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
  create(input: { path: string }): Promise<WorkspaceView>
  /**
   * Open the Host's native directory picker.
   * @returns the selected path, or null when the user cancelled.
   */
  /**
   * 打开 Host 的原生目录选择器。
   * @returns 选中的路径，用户取消时为 null。
   */
  pickDirectory(): Promise<string | null>
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
  listDirectory(path?: string, signal?: AbortSignal): Promise<DirectoryListing>
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
  createDirectory(path: string, name: string): Promise<string>
  /**
   * Open a filesystem path with the Host operating system's default application.
   * @param path - absolute or host-resolvable path.
   */
  /**
   * 用 Host 操作系统的默认应用打开一个文件系统路径。
   * @param path 绝对路径或 Host 可解析的路径。
   */
  openPath(path: string): Promise<void>
  /**
   * Rename a Workspace.
   * @param workspaceId - target workspace.
   * @param title - the new display title.
   * @returns the updated Workspace view.
   */
  /**
   * 重命名工作区。
   * @param workspaceId 目标工作区。
   * @param title 新的展示标题。
   * @returns 更新后的工作区视图。
   */
  rename(workspaceId: WorkspaceId, title: string): Promise<WorkspaceView>
  /**
   * Delete a Workspace (its sessions fall back to the unaccounted group).
   * @param workspaceId - target workspace.
   */
  /**
   * 删除工作区（其会话回退到"未归属"分组）。
   * @param workspaceId 目标工作区。
   */
  delete(workspaceId: WorkspaceId): Promise<void>
  /**
   * Move a Workspace within the registry display order.
   * @param workspaceId - Workspace to move.
   * @param beforeWorkspaceId - Anchor workspace; omitted appends.
   */
  /**
   * 在注册表的展示顺序中移动工作区。
   * @param workspaceId 要移动的工作区。
   * @param beforeWorkspaceId 锚点工作区；省略则追加到末尾。
   */
  insertBefore(workspaceId: WorkspaceId, beforeWorkspaceId?: WorkspaceId): Promise<void>
  /**
   * Move an accounted session within/into a Workspace's ordered list.
   * @param workspaceId - target workspace.
   * @param sessionId - accounted session to move.
   * @param beforeSessionId - accounted anchor to insert before; omitted appends.
   * @returns the updated Workspace view.
   */
  /**
   * 在/向一个工作区的有序列表中移动已归属会话。
   * @param workspaceId 目标工作区。
   * @param sessionId 要移动的已归属会话。
   * @param beforeSessionId 要插到其前的已归属锚点；省略则追加到末尾。
   * @returns 更新后的工作区视图。
   */
  insertSessionBefore(workspaceId: WorkspaceId, sessionId: SessionId, beforeSessionId?: SessionId): Promise<WorkspaceView>
  /**
   * Archive a session into the registry-global set (hidden from grouping
   * surfaces; session log and accounting slot remain). Archiving the current
   * session clears the selection into the New Session view state.
   * @param sessionId - session to archive.
   */
  /**
   * 把会话归档进注册表全局集合（从分组面隐藏；会话日志与记账槽保留）。
   * 归档当前会话会把选中清除回 New Session 视图状态。
   * @param sessionId 要归档的会话。
   */
  archiveSession(sessionId: SessionId): Promise<void>
}
