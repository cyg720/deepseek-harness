/** Client-side Workspace state model shared by Remote transport and UI projection.
 * @remarks 文件说明：文件职责：实现 api/workspace-controller 中 model 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * api/workspace-controller 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。 */

import { notifySubscribers } from '@deepseek-ai/dsh-client-store'
import type {} from '@deepseek-ai/dsh-api-workspace-controller/remote'
import type { RemoteFailure, RemoteResult, TypertClientRemote } from '@deepseek-ai/dsh-typert-protocol'
import type {
  WorkspaceArchiveSessionRequest,
  WorkspaceArchiveValue,
  WorkspaceBaseline,
  WorkspaceCreateRequest,
  WorkspaceCreateValue,
  WorkspaceDeleteValue,
  WorkspaceInsertSessionBeforeRequest,
  WorkspaceOrderValue,
  WorkspaceValue,
  WorkspaceId,
  WorkspaceView,
} from '../types.ts'

/** Complete generated `ctx.remote.workspace` namespace. */
export type WorkspaceRemote = TypertClientRemote['workspace']

/** Monotone Workspace-list arrival lifecycle. */
export type WorkspaceListPhase = 'pending' | 'ready'

/** Immutable Client Workspace state. */
export interface WorkspaceSnapshot {
  readonly items: readonly WorkspaceView[]
  /** Complete registry-global archive set in Host order. */
  readonly archivedSessionIds: WorkspaceArchiveValue['archivedSessionIds']
  readonly state: 'idle' | 'loading' | 'error'
  readonly phase: WorkspaceListPhase
  readonly error: RemoteFailure | null
}

/** State operations emitted by a decoded Workspace follow generation. */
export interface WorkspaceFollowSink {
  /** Replace all state from the generation baseline.
   * @remarks 中文说明：功能说明：处理 replaceBaseline 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：value（WorkspaceBaseline）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 replaceBaseline(value)，
   * 并按返回类型处理结果。 */
  replaceBaseline(value: WorkspaceBaseline): void
  /** Merge one Workspace row.
   * @remarks 中文说明：功能说明：处理 upsertView 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：workspace（WorkspaceView）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 upsertView(workspace)，
   * 并按返回类型处理结果。 */
  upsertView(workspace: WorkspaceView): void
  /** Remove one Workspace row.
   * @remarks 中文说明：功能说明：移除 View 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：workspaceId（WorkspaceId）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 removeView(workspaceId)，
   * 并按返回类型处理结果。 */
  removeView(workspaceId: WorkspaceId): void
  /** Replace the Host-confirmed Workspace order.
   * @remarks 中文说明：功能说明：处理 replaceOrder 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：workspaceIds（readonly WorkspaceId[]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：void；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * replaceOrder(workspaceIds)，并按返回类型处理结果。 */
  replaceOrder(workspaceIds: readonly WorkspaceId[]): void
  /** Replace the complete archived Session set.
   * @remarks 中文说明：功能说明：处理 replaceArchived 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：sessionIds（WorkspaceArchiveValue['archivedSessionIds']）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。；返回值：void；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 使用示例：典型用法：在完成前置校验后调用 replaceArchived(sessionIds)，并按返回类型处理结果。 */
  replaceArchived(sessionIds: WorkspaceArchiveValue['archivedSessionIds']): void
}

/**
 * Owns the Client Workspace projection, mutation echoes, and stream/unary race resolution.
 * @remarks 中文说明：类说明：ClientWorkspaceModel 用于集中封装 处理 ClientWorkspaceModel
 * 相关状态与行为。；核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。；使用场景：由
 * api/workspace-controller 在对应插件或业务生命周期内创建和调用。
 */
export class ClientWorkspaceModel implements WorkspaceFollowSink {
  /**
   * 变量说明：items 用于处理 items 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  private items: readonly WorkspaceView[] = []
  /**
   * 变量说明：archivedSessionIds 用于处理 archivedSessionIds 相关数据，作用于成员；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  private archivedSessionIds: WorkspaceArchiveValue['archivedSessionIds'] = []
  /**
   * 变量说明：state 用于处理 state 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  private state: WorkspaceSnapshot['state'] = 'loading'
  /**
   * 变量说明：phase 用于处理 phase 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  private phase: WorkspaceListPhase = 'pending'
  /**
   * 变量说明：error 用于处理 error 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  private error: RemoteFailure | null = null
  /** Latest local reorder request; only its unary echo may install order.
   * @remarks 中文说明：变量说明：orderRequestGeneration 用于处理 orderRequestGeneration
   * 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。 */
  private orderRequestGeneration = 0
  /** Increments on stream orders so a later remote commit outranks an older unary echo.
   * @remarks 中文说明：变量说明：orderFrameGeneration 用于处理 orderFrameGeneration 相关数据，
   * 作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。 */
  private orderFrameGeneration = 0
  /** Last complete order accepted from a baseline, increment, or current unary echo.
   * @remarks 中文说明：变量说明：committedOrder 用于处理 committedOrder 相关数据，作用于成员；
   * 其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。 */
  private committedOrder: WorkspaceId[] = []
  /** Host Workspace ids are never reused, so delayed data cannot resurrect a removed row.
   * @remarks 中文说明：常量说明：removedIds 用于处理 removedIds 相关数据，作用于成员；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。 */
  private readonly removedIds = new Set<WorkspaceId>()
  /**
   * 常量说明：listeners 用于处理 listeners 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly listeners = new Set<() => void>()
  /**
   * 变量说明：snapshotCache 用于处理 snapshotCache 相关数据，作用于成员；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  private snapshotCache: WorkspaceSnapshot
  /**
   * 变量说明：snapshotDirty 用于处理 snapshotDirty 相关数据，作用于成员；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  private snapshotDirty = false
  /**
   * 变量说明：notificationPending 用于处理 notificationPending 相关数据，作用于成员；
   * 其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  private notificationPending = false
  /**
   * 变量说明：notificationScheduled 用于处理 notificationScheduled 相关数据，作用于成员；
   * 其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  private notificationScheduled = false
  /**
   * 变量说明：notificationGeneration 用于处理 notificationGeneration 相关数据，作用于成员；
   * 其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  private notificationGeneration = 0

  /** @param remote - generated Workspace Remote namespace.
   * @remarks 中文说明：功能说明：处理 ClientWorkspaceModel 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：remote（WorkspaceRemote）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：当前类实例；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：通过 new ClientWorkspaceModel(remote)
   * 创建实例，并在所属生命周期内使用。 */
  constructor(private readonly remote: WorkspaceRemote) {
    this.snapshotCache = this.buildSnapshot()
  }

  /**
   * Create or resolve a Workspace and merge the unary result immediately.
   * @param input - existing absolute path to adopt.
   * @returns generated Remote result.
   * @remarks 中文说明：功能说明：创建 create 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：input（WorkspaceCreateRequest）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：Promise<RemoteResult<WorkspaceCreateValue>>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * ；使用示例：典型用法：在完成前置校验后调用 create(input)，并按返回类型处理结果。
   */
  async create(input: WorkspaceCreateRequest): Promise<RemoteResult<WorkspaceCreateValue>> {
    /**
     * 变量说明：result 用于处理 result 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let result: RemoteResult<WorkspaceCreateValue>
    try {
      result = await this.remote.create(input)
    } catch (/*
 * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
 */ error) {
      result = failureResult(error)
    }
    if (result.ok) this.upsert(result.value.workspace)
    return result
  }

  /**
   * Rename a Workspace and merge the unary result immediately.
   * @param workspaceId - target Workspace.
   * @param title - new display title.
   * @returns generated Remote result.
   * @remarks 中文说明：功能说明：处理 rename 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：workspaceId（WorkspaceId）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：title（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：Promise<RemoteResult<WorkspaceValue>>；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 使用示例：典型用法：在完成前置校验后调用 rename(workspaceId, title)，并按返回类型处理结果。
   */
  async rename(workspaceId: WorkspaceId, title: string): Promise<RemoteResult<WorkspaceValue>> {
    /**
     * 常量说明：result 用于处理 result 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const result = await this.remote.rename({ workspaceId, title })
    if (result.ok) this.upsert(result.value.workspace)
    return result
  }

  /**
   * Delete a Workspace and remove it from the local projection immediately.
   * @param workspaceId - target Workspace.
   * @returns generated Remote result.
   * @remarks 中文说明：功能说明：删除 delete 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：workspaceId（WorkspaceId）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：Promise<RemoteResult<WorkspaceDeleteValue>>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * ；使用示例：典型用法：在完成前置校验后调用 delete(workspaceId)，并按返回类型处理结果。
   */
  async delete(workspaceId: WorkspaceId): Promise<RemoteResult<WorkspaceDeleteValue>> {
    /**
     * 常量说明：result 用于处理 result 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const result = await this.remote.delete({ workspaceId })
    if (result.ok) this.remove(workspaceId, true)
    return result
  }

  /**
   * Optimistically move a Workspace and reconcile the returned complete order.
   * @param workspaceId - Workspace to move.
   * @param beforeWorkspaceId - anchor Workspace; omitted appends.
   * @returns generated Remote result.
   * @remarks 中文说明：功能说明：处理 insertBefore 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：workspaceId（WorkspaceId）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：beforeWorkspaceId（WorkspaceId）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：Promise<RemoteResult<WorkspaceOrderValue>>；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 使用示例：典型用法：在完成前置校验后调用 insertBefore(workspaceId, beforeWorkspaceId)，
   * 并按返回类型处理结果。
   */
  async insertBefore(
    workspaceId: WorkspaceId,
    beforeWorkspaceId?: WorkspaceId,
  ): Promise<RemoteResult<WorkspaceOrderValue>> {
    /**
     * 常量说明：requestGeneration 用于处理 requestGeneration 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const requestGeneration = ++this.orderRequestGeneration
    /**
     * 常量说明：frameGeneration 用于处理 frameGeneration 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const frameGeneration = this.orderFrameGeneration
    /**
     * 常量说明：localOrder 用于处理 localOrder 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const localOrder = this.items.map(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：workspace（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(workspace)，并按返回类型处理结果。
 */ workspace => workspace.workspaceId)
    this.installOrder(insertIdBefore(localOrder, workspaceId, beforeWorkspaceId))
    /**
     * 变量说明：result 用于处理 result 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let result: RemoteResult<WorkspaceOrderValue>
    try {
      result = await this.remote.insertBefore({
        workspaceId,
        ...beforeWorkspaceId === undefined ? {} : { beforeWorkspaceId },
      })
    } catch (/*
 * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
 */ error) {
      if (requestGeneration === this.orderRequestGeneration
        && frameGeneration === this.orderFrameGeneration) {
        this.installOrder(this.committedOrder)
      }
      throw error
    }
    if (requestGeneration === this.orderRequestGeneration
      && frameGeneration === this.orderFrameGeneration) {
      this.installOrder(result.ok ? result.value.workspaceIds : this.committedOrder, result.ok)
    }
    return result
  }

  /**
   * Move a Session within its Workspace and merge the returned row.
   * @param workspaceId - owning Workspace.
   * @param sessionId - accounted Session to move.
   * @param beforeSessionId - accounted anchor; omitted appends.
   * @returns generated Remote result.
   * @remarks 中文说明：功能说明：处理 insertSessionBefore 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：workspaceId（WorkspaceInsertSessionBeforeRequest['workspaceId']）：提供本
   * 次调用所需的数据；必须满足声明的类型及调用时序要求。；参数说明：sessionId（WorkspaceInsertSessionBeforeRe
   * quest['sessionId']）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：beforeSessionId（WorkspaceInsertSessionBeforeRequest['beforeSessionI
   * d']）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：Promise<RemoteResult<WorkspaceVal
   * ue>>；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * insertSessionBefore(workspaceId, sessionId, beforeSessionId)，并按返回类型处理结果。
   */
  async insertSessionBefore(
    workspaceId: WorkspaceInsertSessionBeforeRequest['workspaceId'],
    sessionId: WorkspaceInsertSessionBeforeRequest['sessionId'],
    beforeSessionId?: WorkspaceInsertSessionBeforeRequest['beforeSessionId'],
  ): Promise<RemoteResult<WorkspaceValue>> {
    /**
     * 常量说明：result 用于处理 result 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const result = await this.remote.insertSessionBefore({
      workspaceId,
      sessionId,
      ...beforeSessionId === undefined ? {} : { beforeSessionId },
    })
    if (result.ok) this.upsert(result.value.workspace)
    return result
  }

  /**
   * Archive one Session and install the returned complete archive set.
   * @param sessionId - Session to archive.
   * @returns generated Remote result.
   * @remarks 中文说明：功能说明：处理 archiveSession 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：sessionId（WorkspaceArchiveSessionRequest['sessionId']）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。；返回值：Promise<RemoteResult<WorkspaceArchiveValue>>；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 archiveSession(sessionId)，
   * 并按返回类型处理结果。
   */
  async archiveSession(
    sessionId: WorkspaceArchiveSessionRequest['sessionId'],
  ): Promise<RemoteResult<WorkspaceArchiveValue>> {
    /**
     * 常量说明：result 用于处理 result 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const result = await this.remote.archiveSession({ sessionId })
    if (result.ok) this.installArchived(result.value.archivedSessionIds)
    return result
  }

  /**
   * Replace the projection from one complete stream-generation baseline.
   * @param baseline - complete Workspace and archive projection.
   * @remarks 中文说明：功能说明：处理 replaceBaseline 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：baseline（WorkspaceBaseline）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 replaceBaseline(baseline)，
   * 并按返回类型处理结果。
   */
  replaceBaseline(baseline: WorkspaceBaseline): void {
    this.orderFrameGeneration++
    this.installViews(baseline.items)
    this.installArchived(baseline.archivedSessionIds)
    this.state = 'idle'
    this.phase = 'ready'
    this.error = null
    this.invalidate()
  }

  /** Merge one decoded Workspace upsert from the current follow generation.
   * @remarks 中文说明：功能说明：处理 upsertView 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：workspace（WorkspaceView）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 upsertView(workspace)，
   * 并按返回类型处理结果。 */
  upsertView(workspace: WorkspaceView): void {
    this.upsert(workspace)
  }

  /** Apply one decoded Workspace removal from the current follow generation.
   * @remarks 中文说明：功能说明：移除 View 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：workspaceId（WorkspaceId）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 removeView(workspaceId)，
   * 并按返回类型处理结果。 */
  removeView(workspaceId: WorkspaceId): void {
    this.remove(workspaceId)
  }

  /** Replace Host-confirmed order from the current follow generation.
   * @remarks 中文说明：功能说明：处理 replaceOrder 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：workspaceIds（readonly WorkspaceId[]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：void；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * replaceOrder(workspaceIds)，并按返回类型处理结果。 */
  replaceOrder(workspaceIds: readonly WorkspaceId[]): void {
    this.orderFrameGeneration++
    this.installOrder(workspaceIds, true)
  }

  /**
   * Replace the archived Session set from the current follow generation.
   * @param archivedSessionIds - complete Host-confirmed archive set.
   * @remarks 中文说明：功能说明：处理 replaceArchived 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：archivedSessionIds（WorkspaceArchiveValue['archivedSessionIds']）：提供本
   * 次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 使用示例：典型用法：在完成前置校验后调用 replaceArchived(archivedSessionIds)，并按返回类型处理结果。
   */
  replaceArchived(archivedSessionIds: WorkspaceArchiveValue['archivedSessionIds']): void {
    this.installArchived(archivedSessionIds)
  }

  /** Keep the last complete projection visible while a lost carrier reconnects.
   * @remarks 中文说明：功能说明：处理 Carrier Failure 相关流程；使用场景由所在模块及调用位置决定。；返回值：void；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 handleCarrierFailure()，
   * 并按返回类型处理结果。 */
  handleCarrierFailure(): void {
    this.state = 'loading'
    this.error = null
    this.invalidate()
  }

  /**
   * Publish a non-retryable stream or protocol failure.
   * @param error - terminal stream failure.
   * @remarks 中文说明：功能说明：处理 Stream Failure 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：error（unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 handleStreamFailure(error)，并按返回类型处理结果。
   */
  handleStreamFailure(error: unknown): void {
    this.state = 'error'
    this.error = failureOf(error)
    this.invalidate()
  }

  /**
   * Subscribe to Workspace state invalidation.
   * @param listener - invalidation callback.
   * @returns unsubscribe function.
   * @remarks 中文说明：功能说明：处理 subscribe 相关流程；使用场景由所在模块及调用位置决定。；参数说明：listener（()
   * => void）：接收后续状态或事件并执行调用方逻辑；必须满足声明的类型及调用时序要求。；返回值：() => void；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 subscribe(listener)，并按返回类型处理结果。
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    return () => { this.listeners.delete(listener) }
  }

  /**
   * Read the cached state, rebuilding it first when necessary.
   * @returns the current stable Workspace list snapshot.
   * @remarks 中文说明：功能说明：获取 Snapshot 相关流程；使用场景由所在模块及调用位置决定。；
   * 返回值：WorkspaceSnapshot；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * getSnapshot()，并按返回类型处理结果。
   */
  getSnapshot(): WorkspaceSnapshot {
    this.refreshSnapshot()
    return this.snapshotCache
  }

  /**
   * 功能说明：构建 Snapshot 相关流程；使用场景由所在模块及调用位置决定。
   * @returns WorkspaceSnapshot；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 buildSnapshot()，并按返回类型处理结果。
   */
  private buildSnapshot(): WorkspaceSnapshot {
    return {
      items: this.items,
      archivedSessionIds: this.archivedSessionIds,
      state: this.state,
      phase: this.phase,
      error: this.error,
    }
  }

  /**
   * 功能说明：处理 installArchived 相关流程；使用场景由所在模块及调用位置决定。
   * @param archivedSessionIds （WorkspaceArchiveValue['archivedSessionIds']）：
   * 提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 installArchived(archivedSessionIds)，并按返回类型处理结果。
   */
  private installArchived(archivedSessionIds: WorkspaceArchiveValue['archivedSessionIds']): void {
    if (archivedSessionIds.length === this.archivedSessionIds.length
      && archivedSessionIds.every(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：id（由 TypeScript
 * 根据调用位置推断的类型）：标识本次操作关联的唯一对象；必须满足声明的类型及调用时序要求。；参数：index（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(id, index)，并按返回类型处理结果。
 */ (id, index) => id === this.archivedSessionIds[index])) return
    this.archivedSessionIds = [...archivedSessionIds]
    this.invalidate()
  }

  /**
   * 功能说明：处理 installOrder 相关流程；使用场景由所在模块及调用位置决定。
   * @param workspaceIds （readonly WorkspaceId[]）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。
   * @param committed （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 installOrder(workspaceIds, committed)，并按返回类型处理结果。
   */
  private installOrder(workspaceIds: readonly WorkspaceId[], committed = false): void {
    if (committed) this.committedOrder = [...workspaceIds]
    /**
     * 常量说明：rank 用于处理 rank 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const rank = new Map(workspaceIds.map(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：id（由 TypeScript
 * 根据调用位置推断的类型）：标识本次操作关联的唯一对象；必须满足声明的类型及调用时序要求。；参数：index（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(id, index)，并按返回类型处理结果。
 */ (id, index) => [id, index]))
    /**
     * 常量说明：items 用于处理 items 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const items = [...this.items].sort(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：left（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：right（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(left, right)，并按返回类型处理结果。
 */ (left, right) =>
        (rank.get(left.workspaceId) ?? Number.MAX_SAFE_INTEGER)
      - (rank.get(right.workspaceId) ?? Number.MAX_SAFE_INTEGER))
    if (items.every(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：item（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：index（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(item, index)，并按返回类型处理结果。
 */ (item, index) => item === this.items[index])) return
    this.items = items
    this.invalidate()
  }

  /**
   * 功能说明：处理 upsert 相关流程；使用场景由所在模块及调用位置决定。
   * @param view （WorkspaceView）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 upsert(view)，并按返回类型处理结果。
   */
  private upsert(view: WorkspaceView): void {
    if (this.removedIds.has(view.workspaceId)) return
    /**
     * 常量说明：index 用于处理 index 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const index = this.items.findIndex(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：item（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(item)，并按返回类型处理结果。
 */ item => item.workspaceId === view.workspaceId)
    /**
     * 常量说明：installed 用于处理 installed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const installed = this.items[index]
    // Unary responses and stream increments race on separate requests. Keep
    // the newest Host projection regardless of their arrival order.
    if (installed !== undefined && Date.parse(view.updatedAt) < Date.parse(installed.updatedAt)) return
    if (!this.committedOrder.includes(view.workspaceId)) {
      this.committedOrder = [view.workspaceId, ...this.committedOrder]
    }
    this.items = index === -1
      ? [view, ...this.items]
      : this.items.map(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：item（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：position（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(item, position)，
 * 并按返回类型处理结果。
 */ (item, position) => position === index ? view : item)
    this.invalidate()
  }

  /**
   * 功能说明：移除 remove 相关流程；使用场景由所在模块及调用位置决定。
   * @param workspaceId （WorkspaceId）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param immediate （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 remove(workspaceId, immediate)，并按返回类型处理结果。
   */
  private remove(workspaceId: WorkspaceId, immediate = false): void {
    this.removedIds.add(workspaceId)
    this.committedOrder = this.committedOrder.filter(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：id（由 TypeScript
 * 根据调用位置推断的类型）：标识本次操作关联的唯一对象；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(id)，并按返回类型处理结果。
 */ id => id !== workspaceId)
    /**
     * 常量说明：items 用于处理 items 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const items = this.items.filter(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：item（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(item)，并按返回类型处理结果。
 */ item => item.workspaceId !== workspaceId)
    if (items.length === this.items.length) {
      // A successful unary echo still publishes an earlier increment's
      // pending removal before the user operation resolves.
      if (immediate) this.invalidate(true)
      return
    }
    this.items = items
    this.invalidate(immediate)
  }

  /**
   * 功能说明：处理 installViews 相关流程；使用场景由所在模块及调用位置决定。
   * @param views （readonly WorkspaceView[]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 installViews(views)，并按返回类型处理结果。
   */
  private installViews(views: readonly WorkspaceView[]): void {
    /**
     * 常量说明：installed 用于处理 installed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const installed = new Map<WorkspaceId, WorkspaceView>()
    for (const /*
     * 变量说明：view 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */ view of views) {
      if (!this.removedIds.has(view.workspaceId)) installed.set(view.workspaceId, view)
    }
    this.items = [...installed.values()]
    this.committedOrder = views.map(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：view（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(view)，并按返回类型处理结果。
 */ view => view.workspaceId)
  }

  /**
   * 功能说明：处理 invalidate 相关流程；使用场景由所在模块及调用位置决定。
   * @param immediate （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 invalidate(immediate)，并按返回类型处理结果。
   */
  private invalidate(immediate = false): void {
    this.snapshotDirty = true
    this.notificationPending = true
    if (immediate) {
      this.notificationGeneration++
      this.notificationScheduled = false
      this.flush()
      return
    }
    if (this.notificationScheduled) return
    this.notificationScheduled = true
    /**
     * 常量说明：generation 用于处理 generation 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const generation = ++this.notificationGeneration
    queueMicrotask(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {
        if (generation !== this.notificationGeneration) return
        this.notificationScheduled = false
        this.flush()
      })
  }

  /**
   * 功能说明：处理 flush 相关流程；使用场景由所在模块及调用位置决定。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 flush()，并按返回类型处理结果。
   */
  private flush(): void {
    if (!this.notificationPending || this.listeners.size === 0) return
    this.notificationPending = false
    this.refreshSnapshot()
    notifySubscribers(this.listeners, '[workspace-controller]')
  }

  /**
   * 功能说明：处理 refreshSnapshot 相关流程；使用场景由所在模块及调用位置决定。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 refreshSnapshot()，并按返回类型处理结果。
   */
  private refreshSnapshot(): void {
    if (!this.snapshotDirty) return
    this.snapshotDirty = false
    this.snapshotCache = this.buildSnapshot()
  }
}

/**
 * 功能说明：处理 insertIdBefore 相关流程；使用场景由所在模块及调用位置决定。
 * @param ids （readonly WorkspaceId[]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param id （WorkspaceId）：标识本次操作关联的唯一对象；必须满足声明的类型及调用时序要求。
 * @param beforeId （WorkspaceId）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns WorkspaceId[]；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 insertIdBefore(ids, id, beforeId)，并按返回类型处理结果。
 */
function insertIdBefore(
  ids: readonly WorkspaceId[],
  id: WorkspaceId,
  beforeId?: WorkspaceId,
): WorkspaceId[] {
  if (!ids.includes(id) || (beforeId !== undefined && !ids.includes(beforeId)) || beforeId === id) {
    return [...ids]
  }
  /**
   * 常量说明：without 用于处理 without 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const without = ids.filter(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：candidate（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(candidate)，并按返回类型处理结果。
 */ candidate => candidate !== id)
  /**
   * 常量说明：at 用于处理 at 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const at = beforeId === undefined ? without.length : without.indexOf(beforeId)
  return [...without.slice(0, at), id, ...without.slice(at)]
}

/**
 * 功能说明：处理 failureResult 相关流程；使用场景由所在模块及调用位置决定。
 * @param error （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns RemoteResult<T>；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 failureResult(error)，并按返回类型处理结果。
 */
function failureResult<T>(error: unknown): RemoteResult<T> {
  return { ok: false, error: failureOf(error) }
}

/**
 * 功能说明：处理 failureOf 相关流程；使用场景由所在模块及调用位置决定。
 * @param error （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns RemoteFailure；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 failureOf(error)，并按返回类型处理结果。
 */
function failureOf(error: unknown): RemoteFailure {
  return {
    code: 'internal',
    message: error instanceof Error ? error.message : String(error),
    details: {},
  }
}
