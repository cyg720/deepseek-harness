/** Workspace archive and directory UI capability.
 * @remarks 文件说明：文件职责：实现 client/ui-workspace 中 navigation 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * client/ui-workspace 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类
 * → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。；
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。 */

import { Service, type Context } from '@deepseek-ai/cordis'
import type { ClientRemote, DirectoryListing } from '@deepseek-ai/dsh-api-remotes/client'
import type { RemoteFailure } from '@deepseek-ai/dsh-typert-protocol'
import type {
  ISessions,
  SessionListState,
} from '@deepseek-ai/dsh-api-session-controller/client'
import type {
  IWorkspaces, WorkspaceId, WorkspaceView,
} from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** Workspace archive and directory operations consumed by Client UI domains. */
export interface UiWorkspace {
  /**
   * Resolve the reusable or newly created blank Session for a Workspace.
   * @param workspaceId - target Workspace.
   * @returns a Session already addressable through the Session Controller.
   * @remarks 中文说明：功能说明：处理 connectWorkspace 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：workspaceId（WorkspaceId）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：Promise<SessionId>；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * connectWorkspace(workspaceId)，并按返回类型处理结果。
   */
  connectWorkspace(workspaceId: WorkspaceId): Promise<SessionId>
  /**
   * Start a New Session flow and navigate to its Session.
   * @param workspaceId - explicit target; absent inherits the current or most recent Workspace.
   * @remarks 中文说明：功能说明：启动 Session 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：workspaceId（WorkspaceId）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 startSession(workspaceId)，
   * 并按返回类型处理结果。
   */
  startSession(workspaceId?: WorkspaceId): void
  /**
   * Archive a Session and clear it when it is the current selection.
   * @param sessionId - Session to archive.
   * @remarks 中文说明：功能说明：处理 archiveSession 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：sessionId（SessionId）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * archiveSession(sessionId)，并按返回类型处理结果。
   */
  archiveSession(sessionId: SessionId): Promise<void>
  /**
   * Open the Host-native directory picker.
   * @returns the selected directory, or null when cancelled.
   * @remarks 中文说明：功能说明：处理 pickDirectory 相关流程；使用场景由所在模块及调用位置决定。；
   * 返回值：Promise<string | null>；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 使用示例：典型用法：在完成前置校验后调用 pickDirectory()，并按返回类型处理结果。
   */
  pickDirectory(): Promise<string | null>
  /**
   * List one Host directory level.
   * @param path - directory path; absent selects the Host home.
   * @param signal - cancellation for a superseded scan.
   * @returns directory entries and breadcrumb ancestry.
   * @remarks 中文说明：功能说明：列出 Directory 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：path（string）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；
   * 参数说明：signal（AbortSignal）：传递取消或终止信号；必须满足声明的类型及调用时序要求。；
   * 返回值：Promise<DirectoryListing>；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 使用示例：典型用法：在完成前置校验后调用 listDirectory(path, signal)，并按返回类型处理结果。
   */
  listDirectory(path?: string, signal?: AbortSignal): Promise<DirectoryListing>
  /**
   * Create a child directory.
   * @param path - existing parent directory.
   * @param name - child directory name.
   * @returns created absolute path.
   * @remarks 中文说明：功能说明：创建 Directory 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：path（string）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；
   * 参数说明：name（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：Promise<string>；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 createDirectory(path,
   * name)，并按返回类型处理结果。
   */
  createDirectory(path: string, name: string): Promise<string>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Cross-Controller Workspace navigation and directory UI capability. */
    uiWorkspace: UiWorkspace
  }
}

/** Structured directory failure exposed to directory UI consumers.
 * @remarks 中文说明：类说明：DirectoryBrowseError 用于集中封装 处理 DirectoryBrowseError
 * 相关状态与行为。；核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。；使用场景：由 client/ui-workspace
 * 在对应插件或业务生命周期内创建和调用。 */
export class DirectoryBrowseError extends Error {
  /**
   * 常量说明：name 用于处理 name 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  override readonly name = 'DirectoryBrowseError'

  /** @param rpcError - Host directory business failure.
   * @remarks 中文说明：功能说明：处理 DirectoryBrowseError 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：rpcError（RemoteFailure）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：当前类实例；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：通过 new
   * DirectoryBrowseError(rpcError) 创建实例，并在所属生命周期内使用。 */
  constructor(readonly rpcError: RemoteFailure) {
    super(`directory browse failed: ${rpcError.code}: ${rpcError.message}`)
  }
}

/** Implements Workspace archive and directory UI operations.
 * @remarks 中文说明：类说明：UiWorkspaceService 用于集中封装 处理 UiWorkspaceService
 * 相关状态与行为。；核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。；使用场景：由 client/ui-workspace
 * 在对应插件或业务生命周期内创建和调用。 */
class UiWorkspaceService extends Service implements UiWorkspace {
  /**
   * 常量说明：connecting 用于处理 connecting 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly connecting = new Map<WorkspaceId, Promise<SessionId>>()

  /**
   * @param ctx - Client root Context.
   * @param directoryPicker - the directory-picking Remote namespace.
   * @param workspaces - pure Workspace Controller.
   * @param sessions - pure Session Controller.
   * @remarks 中文说明：功能说明：处理 UiWorkspaceService 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：ctx（Context）：提供当前 Cordis 插件上下文与已声明服务；必须满足声明的类型及调用时序要求。；
   * 参数说明：directoryPicker（ClientRemote['directoryPicker']）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。；参数说明：workspaces（IWorkspaces）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。；参数说明：sessions（ISessions）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：当前类实例；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：通过 new
   * UiWorkspaceService(ctx, directoryPicker, workspaces, sessions) 创建实例，
   * 并在所属生命周期内使用。
   */
  constructor(
    ctx: Context,
    private readonly directoryPicker: ClientRemote['directoryPicker'],
    private readonly workspaces: IWorkspaces,
    private readonly sessions: ISessions,
  ) {
    super(ctx, 'uiWorkspace')
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    ctx.effect(() => this.watchNavigation(), 'ui-workspace: Workspace navigation policy')
  }

  /**
   * 功能说明：处理 connectWorkspace 相关流程；使用场景由所在模块及调用位置决定。
   * @param workspaceId （WorkspaceId）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns Promise<SessionId>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 connectWorkspace(workspaceId)，并按返回类型处理结果。
   */
  async connectWorkspace(workspaceId: WorkspaceId): Promise<SessionId> {
    /**
     * 常量说明：workspace 用于处理 workspace 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：item（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(item)，并按返回类型处理结果。
     */
    const workspace = this.workspaces.list.getSnapshot().items
      .find(item => item.workspaceId === workspaceId)
    if (workspace === undefined) {
      throw new Error(`uiWorkspace.connectWorkspace: unknown workspace ${workspaceId}`)
    }
    /**
     * 常量说明：inflight 用于处理 inflight 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const inflight = this.connecting.get(workspaceId)
    if (inflight !== undefined) return inflight

    /**
     * 常量说明：archived 用于处理 archived 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const archived = this.workspaces.list.getSnapshot().archivedSessionIds
    /**
     * 常量说明：sessions 用于处理 sessions 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const sessions = this.sessions.list.getSnapshot()
    /**
     * 变量说明：id 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const id of sessions.ids) {
      /**
       * 常量说明：summary 用于处理 summary 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const summary = sessions.byId[id]
      if (summary !== undefined && summary.blank && summary.cwd === workspace.path
        && workspace.sessionIds.includes(summary.id)
        && !archived.includes(summary.id)) return summary.id
    }

    /**
     * 常量说明：attempt 用于处理 attempt 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    const attempt = this.sessions.create({ workspaceId })
      .finally(() => { this.connecting.delete(workspaceId) })
    this.connecting.set(workspaceId, attempt)
    return attempt
  }

  /**
   * 功能说明：启动 Session 相关流程；使用场景由所在模块及调用位置决定。
   * @param workspaceId （WorkspaceId）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 startSession(workspaceId)，并按返回类型处理结果。
   */
  startSession(workspaceId?: WorkspaceId): void {
    /**
     * 常量说明：workspace 用于处理 workspace 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const workspace = this.workspaces.list.getSnapshot()
    /**
     * 常量说明：sessions 用于处理 sessions 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const sessions = this.sessions.list.getSnapshot()
    /**
     * 常量说明：current 用于处理 current 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const current = sessions.current
    /**
     * 常量说明：currentWorkspaceId 用于处理 currentWorkspaceId 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：item（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(item)，并按返回类型处理结果。
     */
    const currentWorkspaceId = current === undefined
      ? undefined
      : workspace.items.find(item => item.sessionIds.includes(current))?.workspaceId
    /**
     * 常量说明：recent 用于处理 recent 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const recent = workspace.phase === 'ready' && sessions.phase === 'ready'
      ? recentWorkspace(workspace.items, sessions.byId)
      : undefined
    /**
     * 常量说明：target 用于处理 target 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const target = workspaceId ?? currentWorkspaceId ?? recent
    if (target === undefined) {
      this.sessions.clear()
      return
    }
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：sessionId（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(sessionId)，并按返回类型处理结果。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：reason（unknown）：提供本次调用所需的数据；
     * 必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；
     * 典型用法：在完成前置校验后调用 匿名回调(reason)，并按返回类型处理结果。
     */
    void this.connectWorkspace(target).then(
      (sessionId) => { this.sessions.open(sessionId) },
      (reason: unknown) => { console.warn('new session failed:', reason) },
    )
  }

  /**
   * 功能说明：处理 archiveSession 相关流程；使用场景由所在模块及调用位置决定。
   * @param sessionId （SessionId）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 archiveSession(sessionId)，并按返回类型处理结果。
   */
  async archiveSession(sessionId: SessionId): Promise<void> {
    await this.workspaces.archiveSession(sessionId)
  }

  /**
   * 功能说明：处理 pickDirectory 相关流程；使用场景由所在模块及调用位置决定。
   * @returns Promise<string | null>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 pickDirectory()，并按返回类型处理结果。
   */
  async pickDirectory(): Promise<string | null> {
    /**
     * 常量说明：result 用于处理 result 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const result = await this.directoryPicker.pick()
    if (!result.ok) throw new Error(`directory picker failed: ${result.error.message}`)
    return result.value
  }

  /**
   * 功能说明：列出 Directory 相关流程；使用场景由所在模块及调用位置决定。
   * @param path （string）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。
   * @param signal （AbortSignal）：传递取消或终止信号；必须满足声明的类型及调用时序要求。
   * @returns Promise<DirectoryListing>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 listDirectory(path, signal)，并按返回类型处理结果。
   */
  async listDirectory(path?: string, signal?: AbortSignal): Promise<DirectoryListing> {
    /**
     * 常量说明：result 用于处理 result 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const result = await this.directoryPicker.list(path, signal)
    if (!result.ok) throw new DirectoryBrowseError(result.error)
    return result.value
  }

  /**
   * 功能说明：创建 Directory 相关流程；使用场景由所在模块及调用位置决定。
   * @param path （string）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。
   * @param name （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns Promise<string>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 createDirectory(path, name)，并按返回类型处理结果。
   */
  async createDirectory(path: string, name: string): Promise<string> {
    /**
     * 常量说明：result 用于处理 result 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const result = await this.directoryPicker.createDirectory(path, name)
    if (!result.ok) throw new DirectoryBrowseError(result.error)
    return result.value
  }

  /**
   * 功能说明：处理 watchNavigation 相关流程；使用场景由所在模块及调用位置决定。
   * @returns () => void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 watchNavigation()，并按返回类型处理结果。
   */
  private watchNavigation(): () => void {
    /**
     * 变量说明：initial 用于处理 initial 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let initial: 'waiting' | 'connecting' | 'done' = 'waiting'
    /**
     * 变量说明：disposed 用于处理 disposed 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let disposed = false
    /**
     * 常量说明：reconcile 用于处理 reconcile 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     * 功能说明：处理 reconcile 相关流程；使用场景由所在模块及调用位置决定。
     * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 reconcile()，并按返回类型处理结果。
     */
    const reconcile = (): void => {
      if (disposed) return
      if (this.clearArchivedCurrent()) return
      if (initial !== 'waiting') return
      /**
       * 常量说明：workspace 用于处理 workspace 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const workspace = this.workspaces.list.getSnapshot()
      /**
       * 常量说明：sessions 用于处理 sessions 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const sessions = this.sessions.list.getSnapshot()
      if (workspace.phase !== 'ready' || sessions.phase !== 'ready') return
      if (sessions.current !== undefined) {
        initial = 'done'
        return
      }
      /**
       * 常量说明：target 用于处理 target 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const target = recentWorkspace(workspace.items, sessions.byId)
      if (target === undefined) {
        initial = 'done'
        return
      }
      initial = 'connecting'
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：sessionId（由 TypeScript
       * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(sessionId)，并按返回类型处理结果。
       */
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：reason（unknown）：提供本次调用所需的数据；
       * 必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；
       * 典型用法：在完成前置校验后调用 匿名回调(reason)，并按返回类型处理结果。
       */
      void this.connectWorkspace(target).then(
        (sessionId) => {
          if (disposed) return
          if (this.sessions.list.getSnapshot().current === undefined) {
            this.sessions.open(sessionId)
          }
          initial = 'done'
        },
        (reason: unknown) => {
          if (disposed) return
          initial = 'waiting'
          console.warn('initial workspace selection failed:', reason)
        },
      )
    }
    /**
     * 常量说明：disposeWorkspaces 用于处理 disposeWorkspaces 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const disposeWorkspaces = this.workspaces.list.subscribe(reconcile)
    /**
     * 常量说明：disposeSessions 用于处理 disposeSessions 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const disposeSessions = this.sessions.list.subscribe(reconcile)
    reconcile()
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    return () => {
      disposed = true
      disposeSessions()
      disposeWorkspaces()
    }
  }

  /** @returns true when an archived current selection was cleared.
   * @remarks 中文说明：功能说明：处理 clearArchivedCurrent 相关流程；使用场景由所在模块及调用位置决定。；
   * 返回值：boolean；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * clearArchivedCurrent()，并按返回类型处理结果。 */
  private clearArchivedCurrent(): boolean {
    /**
     * 常量说明：current 用于处理 current 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const current = this.sessions.list.getSnapshot().current
    if (current === undefined
      || !this.workspaces.list.getSnapshot().archivedSessionIds.includes(current)) return false
    this.sessions.clear()
    return true
  }

}

/** Stable tie-breaking follows Host Workspace order.
 * @remarks 中文说明：功能说明：处理 recentWorkspace 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：workspaces（readonly WorkspaceView[]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：sessions（SessionListState['byId']）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：WorkspaceId | undefined；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 recentWorkspace(workspaces, sessions)，并按返回类型处理结果。 */
function recentWorkspace(
  workspaces: readonly WorkspaceView[],
  sessions: SessionListState['byId'],
): WorkspaceId | undefined {
  /**
   * 变量说明：selected 用于处理 selected 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let selected: WorkspaceId | undefined
  /**
   * 变量说明：selectedTime 用于处理 selectedTime 相关数据，作用于当前作用域；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  let selectedTime = Number.NEGATIVE_INFINITY
  /**
   * 变量说明：workspace 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (const workspace of workspaces) {
    /**
     * 变量说明：latest 用于处理 latest 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let latest = Number.NEGATIVE_INFINITY
    /**
     * 变量说明：sessionId 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const sessionId of workspace.sessionIds) {
      /**
       * 常量说明：session 用于处理 session 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const session = sessions[sessionId]
      if (session !== undefined) latest = Math.max(latest, session.updatedAt)
    }
    if (latest === Number.NEGATIVE_INFINITY) latest = Date.parse(workspace.createdAt)
    if (selected === undefined || latest > selectedTime) {
      selected = workspace.workspaceId
      selectedTime = latest
    }
  }
  return selected
}

export { UiWorkspaceService }
