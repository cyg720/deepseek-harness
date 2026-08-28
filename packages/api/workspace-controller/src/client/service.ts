/** React-free Client Workspace service and command facade.
 * @remarks 文件说明：文件职责：实现 api/workspace-controller 中 service 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * api/workspace-controller 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。 */

import { Service, type Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { RemoteFailure } from '@deepseek-ai/dsh-typert-protocol'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import type { WorkspaceView } from '../types.ts'
import type { ClientWorkspaceModel, WorkspaceSnapshot } from './model.ts'

/** Structured create failure for callers that distinguish Host business errors.
 * @remarks 中文说明：类说明：WorkspaceCreateError 用于集中封装 处理 WorkspaceCreateError
 * 相关状态与行为。；核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。；使用场景：由
 * api/workspace-controller 在对应插件或业务生命周期内创建和调用。 */
export class WorkspaceCreateError extends Error {
  /**
   * 常量说明：name 用于处理 name 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  override readonly name = 'WorkspaceCreateError'

  /** @param rpcError - Host business or folded transport failure.
   * @remarks 中文说明：功能说明：处理 WorkspaceCreateError 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：rpcError（RemoteFailure）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：当前类实例；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：通过 new
   * WorkspaceCreateError(rpcError) 创建实例，并在所属生命周期内使用。 */
  constructor(readonly rpcError: RemoteFailure) {
    super(`workspace create failed: ${rpcError.code}: ${rpcError.message}`)
  }
}

/** Bare observable source for the Workspace Controller snapshot. */
export interface WorkspaceSource {
  /** Read the identity-stable current snapshot.
   * @remarks 中文说明：功能说明：获取 Snapshot 相关流程；使用场景由所在模块及调用位置决定。；
   * 返回值：WorkspaceSnapshot；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * getSnapshot()，并按返回类型处理结果。 */
  getSnapshot(): WorkspaceSnapshot
  /**
   * Subscribe to snapshot changes.
   * @param listener - invalidation callback.
   * @returns unsubscribe function.
   * @remarks 中文说明：功能说明：处理 subscribe 相关流程；使用场景由所在模块及调用位置决定。；参数说明：listener（()
   * => void）：接收后续状态或事件并执行调用方逻辑；必须满足声明的类型及调用时序要求。；返回值：() => void；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 subscribe(listener)，并按返回类型处理结果。
   */
  subscribe(listener: () => void): () => void
}

/** Workspace Controller's Client service face. */
export interface IWorkspaces {
  /** Host-authoritative Workspace rows, order, archive set, and follow lifecycle. */
  readonly list: WorkspaceSource
  /**
   * Register an existing path as a Workspace.
   * @param input - Host create payload.
   * @returns the created or idempotently resolved Workspace.
   * @remarks 中文说明：功能说明：创建 create 相关流程；使用场景由所在模块及调用位置决定。；参数说明：input（{ path:
   * string }）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：Promise<WorkspaceView>；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 create(input)，并按返回类型处理结果。
   */
  create(input: { path: string }): Promise<WorkspaceView>
  /**
   * Rename a Workspace.
   * @param workspaceId - target Workspace.
   * @param title - new display title.
   * @returns the renamed Workspace.
   * @remarks 中文说明：功能说明：处理 rename 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：workspaceId（WorkspaceId）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：title（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：Promise<WorkspaceView>；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 使用示例：典型用法：在完成前置校验后调用 rename(workspaceId, title)，并按返回类型处理结果。
   */
  rename(workspaceId: WorkspaceId, title: string): Promise<WorkspaceView>
  /**
   * Delete a Workspace registration without deleting Sessions or files.
   * @param workspaceId - target Workspace.
   * @remarks 中文说明：功能说明：删除 delete 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：workspaceId（WorkspaceId）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * delete(workspaceId)，并按返回类型处理结果。
   */
  delete(workspaceId: WorkspaceId): Promise<void>
  /**
   * Move a Workspace within the Host registry order.
   * @param workspaceId - Workspace to move.
   * @param beforeWorkspaceId - anchor Workspace; omitted appends.
   * @remarks 中文说明：功能说明：处理 insertBefore 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：workspaceId（WorkspaceId）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：beforeWorkspaceId（WorkspaceId）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * insertBefore(workspaceId, beforeWorkspaceId)，并按返回类型处理结果。
   */
  insertBefore(workspaceId: WorkspaceId, beforeWorkspaceId?: WorkspaceId): Promise<void>
  /**
   * Archive a Session from Workspace grouping surfaces.
   * @param sessionId - Session to archive.
   * @remarks 中文说明：功能说明：处理 archiveSession 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：sessionId（SessionId）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * archiveSession(sessionId)，并按返回类型处理结果。
   */
  archiveSession(sessionId: SessionId): Promise<void>
  /**
   * Move a Session within one Workspace account.
   * @param workspaceId - owning Workspace.
   * @param sessionId - Session to move.
   * @param beforeSessionId - anchor Session; omitted appends.
   * @returns the changed Workspace.
   * @remarks 中文说明：功能说明：处理 insertSessionBefore 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：workspaceId（WorkspaceId）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：sessionId（SessionId）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：beforeSessionId（SessionId）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：Promise<WorkspaceView>；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 使用示例：典型用法：在完成前置校验后调用 insertSessionBefore(workspaceId, sessionId,
   * beforeSessionId)，并按返回类型处理结果。
   */
  insertSessionBefore(
    workspaceId: WorkspaceId,
    sessionId: SessionId,
    beforeSessionId?: SessionId,
  ): Promise<WorkspaceView>
}

/** Owns the bare Workspace snapshot and Workspace-only commands.
 * @remarks 中文说明：类说明：WorkspaceController 用于集中封装 处理 WorkspaceController
 * 相关状态与行为。；核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。；使用场景：由
 * api/workspace-controller 在对应插件或业务生命周期内创建和调用。 */
export class WorkspaceController extends Service implements IWorkspaces {
  /**
   * 常量说明：list 用于列出 list 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  readonly list: WorkspaceSource

  /**
   * @param ctx - Client root Context.
   * @param model - Remote-backed Workspace state model.
   * @remarks 中文说明：功能说明：处理 WorkspaceController 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：ctx（Context）：提供当前 Cordis 插件上下文与已声明服务；必须满足声明的类型及调用时序要求。；
   * 参数说明：model（ClientWorkspaceModel）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：当前类实例；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：通过 new WorkspaceController(ctx,
   * model) 创建实例，并在所属生命周期内使用。
   */
  constructor(ctx: Context, private readonly model: ClientWorkspaceModel) {
    super(ctx, 'workspaces')
    this.list = model
  }

  /**
   * 功能说明：创建 create 相关流程；使用场景由所在模块及调用位置决定。
   * @param input （{ path: string }）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns Promise<WorkspaceView>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 create(input)，并按返回类型处理结果。
   */
  async create(input: { path: string }): Promise<WorkspaceView> {
    /**
     * 常量说明：result 用于处理 result 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const result = await this.model.create(input)
    if (!result.ok) throw new WorkspaceCreateError(result.error)
    return result.value.workspace
  }

  /**
   * 功能说明：处理 rename 相关流程；使用场景由所在模块及调用位置决定。
   * @param workspaceId （WorkspaceId）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param title （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns Promise<WorkspaceView>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 rename(workspaceId, title)，并按返回类型处理结果。
   */
  async rename(workspaceId: WorkspaceId, title: string): Promise<WorkspaceView> {
    /**
     * 常量说明：result 用于处理 result 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const result = await this.model.rename(workspaceId, title)
    if (!result.ok) throw commandError('rename', result.error)
    return result.value.workspace
  }

  /**
   * 功能说明：删除 delete 相关流程；使用场景由所在模块及调用位置决定。
   * @param workspaceId （WorkspaceId）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 delete(workspaceId)，并按返回类型处理结果。
   */
  async delete(workspaceId: WorkspaceId): Promise<void> {
    /**
     * 常量说明：result 用于处理 result 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const result = await this.model.delete(workspaceId)
    if (!result.ok) throw commandError('delete', result.error)
  }

  /**
   * 功能说明：处理 insertBefore 相关流程；使用场景由所在模块及调用位置决定。
   * @param workspaceId （WorkspaceId）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param beforeWorkspaceId （WorkspaceId）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 insertBefore(workspaceId, beforeWorkspaceId)，
   * 并按返回类型处理结果。
   */
  async insertBefore(workspaceId: WorkspaceId, beforeWorkspaceId?: WorkspaceId): Promise<void> {
    /**
     * 常量说明：result 用于处理 result 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const result = await this.model.insertBefore(workspaceId, beforeWorkspaceId)
    if (!result.ok) throw commandError('reorder', result.error)
  }

  /**
   * 功能说明：处理 archiveSession 相关流程；使用场景由所在模块及调用位置决定。
   * @param sessionId （SessionId）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 archiveSession(sessionId)，并按返回类型处理结果。
   */
  async archiveSession(sessionId: SessionId): Promise<void> {
    /**
     * 常量说明：result 用于处理 result 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const result = await this.model.archiveSession(sessionId)
    if (!result.ok) throw commandError('session archive', result.error)
  }

  /**
   * 功能说明：处理 insertSessionBefore 相关流程；使用场景由所在模块及调用位置决定。
   * @param workspaceId （WorkspaceId）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param sessionId （SessionId）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param beforeSessionId （SessionId）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns Promise<WorkspaceView>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 insertSessionBefore(workspaceId, sessionId,
   * beforeSessionId)，并按返回类型处理结果。
   */
  async insertSessionBefore(
    workspaceId: WorkspaceId,
    sessionId: SessionId,
    beforeSessionId?: SessionId,
  ): Promise<WorkspaceView> {
    /**
     * 常量说明：result 用于处理 result 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const result = await this.model.insertSessionBefore(workspaceId, sessionId, beforeSessionId)
    if (!result.ok) throw commandError('move', result.error)
    return result.value.workspace
  }
}

/**
 * 功能说明：处理 commandError 相关流程；使用场景由所在模块及调用位置决定。
 * @param operation （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param failure （RemoteFailure）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns Error；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 commandError(operation, failure)，并按返回类型处理结果。
 */
function commandError(operation: string, failure: RemoteFailure): Error {
  return new Error(`workspace ${operation} failed: ${failure.code}: ${failure.message}`)
}
