/** Workspace command implementation and stable Remote failure mapping.
 * @remarks 文件说明：文件职责：实现 api/workspace-controller 中 commands 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * api/workspace-controller 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。 */

import type { Context } from '@deepseek-ai/cordis'
import type { Workspace } from '@deepseek-ai/dsh-workspace'
import {
  WorkspaceId,
  WorkspaceMoveInvalidError,
  WorkspaceOrderInvalidError,
  WorkspaceUnknownSessionError,
} from '@deepseek-ai/dsh-workspace'
import { TypertRemoteFailure } from '@deepseek-ai/dsh-typert-protocol'
import { workspaceView } from './feed.ts'
import type {
  WorkspaceArchiveSessionRequest,
  WorkspaceArchiveValue,
  WorkspaceCreateRequest,
  WorkspaceCreateValue,
  WorkspaceDeleteRequest,
  WorkspaceDeleteValue,
  WorkspaceInsertBeforeRequest,
  WorkspaceInsertSessionBeforeRequest,
  WorkspaceOrderValue,
  WorkspaceRenameRequest,
  WorkspaceValue,
} from './types.ts'

/** Implements Workspace mutations against the authoritative registry.
 * @remarks 中文说明：类说明：WorkspaceCommands 用于集中封装 处理 WorkspaceCommands 相关状态与行为。；
 * 核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。；使用场景：由 api/workspace-controller
 * 在对应插件或业务生命周期内创建和调用。 */
export class WorkspaceCommands {
  /**
   * 变量说明：operationTail 用于处理 operationTail 相关数据，作用于成员；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  private operationTail = Promise.resolve()

  /** @param ctx - Host context containing the Workspace registry.
   * @remarks 中文说明：功能说明：处理 WorkspaceCommands 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：ctx（Context）：提供当前 Cordis 插件上下文与已声明服务；必须满足声明的类型及调用时序要求。；返回值：当前类实例；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：通过 new WorkspaceCommands(ctx) 创建实例，
   * 并在所属生命周期内使用。 */
  constructor(private readonly ctx: Context) {}

  /**
   * Create or resolve one Workspace over an existing directory.
   * @param request - directory path to register.
   * @returns the Workspace and whether this call created it.
   * @remarks 中文说明：功能说明：创建 create 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：request（WorkspaceCreateRequest）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。；
   * 返回值：Promise<WorkspaceCreateValue>；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 使用示例：典型用法：在完成前置校验后调用 create(request)，并按返回类型处理结果。
   */
  create(request: WorkspaceCreateRequest): Promise<WorkspaceCreateValue> {
    return this.enqueue(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        try {
        /**
         * 常量说明：existing 用于处理 existing 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
          const existing = await this.ctx.workspaceRegistry.resolveByPath(request.path)
          if (existing !== undefined) {
            return { workspace: workspaceView(existing), created: false }
          }
          /**
         * 常量说明：workspace 用于处理 workspace 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
          const workspace = await this.ctx.workspaceRegistry.create(request.path)
          return { workspace: workspaceView(workspace), created: true }
        } catch (/*
 * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
 */ error) {
          if (error instanceof TypertRemoteFailure) throw error
          throw failure(
            'workspace-invalid-path',
            `cannot create a Workspace at "${request.path}": ${errorMessage(error)}`,
            { path: request.path },
          )
        }
      })
  }

  /**
   * Rename one Workspace after serializing title ownership checks.
   * @param request - Workspace identity and proposed title.
   * @returns the updated Workspace projection.
   * @remarks 中文说明：功能说明：处理 rename 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：request（WorkspaceRenameRequest）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。；
   * 返回值：Promise<WorkspaceValue>；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 使用示例：典型用法：在完成前置校验后调用 rename(request)，并按返回类型处理结果。
   */
  rename(request: WorkspaceRenameRequest): Promise<WorkspaceValue> {
    /**
     * 常量说明：title 用于处理 title 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const title = request.title.trim()
    if (title === '') {
      return Promise.reject(failure(
        'bad-request',
        'Workspace rename requires a non-blank title',
        {},
      ))
    }
    return this.enqueue(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
      /**
       * 常量说明：workspace 用于处理 workspace 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
        const workspace = this.requireWorkspace(request.workspaceId)
        if (title !== workspace.title) {
          if (this.ctx.workspaceRegistry.list().some(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：candidate（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(candidate)，并按返回类型处理结果。
 */ candidate =>
              candidate.id !== workspace.id && candidate.title === title)) {
            throw failure(
              'workspace-name-conflict',
              `Workspace name '${title}' is already in use`,
              { name: title },
            )
          }
          await workspace.setTitle(title)
        }
        return { workspace: workspaceView(workspace) }
      })
  }

  /**
   * Delete one Workspace registration without deleting its directory or Sessions.
   * @param request - Workspace identity to remove.
   * @returns deletion confirmation.
   * @remarks 中文说明：功能说明：删除 delete 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：request（WorkspaceDeleteRequest）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。；
   * 返回值：Promise<WorkspaceDeleteValue>；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 使用示例：典型用法：在完成前置校验后调用 delete(request)，并按返回类型处理结果。
   */
  delete(request: WorkspaceDeleteRequest): Promise<WorkspaceDeleteValue> {
    return this.enqueue(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        if (!await this.ctx.workspaceRegistry.delete(WorkspaceId(request.workspaceId))) {
          throw workspaceNotFound(request.workspaceId)
        }
        return { deleted: true }
      })
  }

  /**
   * Move one Workspace within the durable registry order.
   * @param request - moved Workspace and optional anchor.
   * @returns the complete resulting Workspace order.
   * @remarks 中文说明：功能说明：处理 insertBefore 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：request（WorkspaceInsertBeforeRequest）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。
   * ；返回值：Promise<WorkspaceOrderValue>；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 使用示例：典型用法：在完成前置校验后调用 insertBefore(request)，并按返回类型处理结果。
   */
  async insertBefore(request: WorkspaceInsertBeforeRequest): Promise<WorkspaceOrderValue> {
    try {
      /**
       * 常量说明：workspaceIds 用于处理 workspaceIds 相关数据，作用于当前作用域；初始化后不可重新赋值，
       * 但对象内部是否可变仍由其类型决定。
       */
      const workspaceIds = await this.ctx.workspaceRegistry.insertBefore(
        WorkspaceId(request.workspaceId),
        request.beforeWorkspaceId === undefined
          ? undefined
          : WorkspaceId(request.beforeWorkspaceId),
      )
      return { workspaceIds: [...workspaceIds] }
    } catch (/*
 * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
 */ error) {
      if (!(error instanceof WorkspaceOrderInvalidError)) throw error
      throw workspaceNotFound(error.workspaceId)
    }
  }

  /**
   * Move one accounted Session within a Workspace's manual order.
   * @param request - Workspace, Session, and optional anchor identities.
   * @returns the updated Workspace projection.
   * @remarks 中文说明：功能说明：处理 insertSessionBefore 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：request（WorkspaceInsertSessionBeforeRequest）：提供调用方提交的请求信息；
   * 必须满足声明的类型及调用时序要求。；返回值：Promise<WorkspaceValue>；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 使用示例：典型用法：在完成前置校验后调用 insertSessionBefore(request)，并按返回类型处理结果。
   */
  async insertSessionBefore(request: WorkspaceInsertSessionBeforeRequest): Promise<WorkspaceValue> {
    /**
     * 常量说明：workspace 用于处理 workspace 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const workspace = this.requireWorkspace(request.workspaceId)
    try {
      await workspace.insertSessionBefore(request.sessionId, request.beforeSessionId)
    } catch (/*
 * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
 */ error) {
      if (!(error instanceof WorkspaceMoveInvalidError)) throw error
      throw failure(
        'workspace-move-invalid',
        error.message,
        {
          workspaceId: request.workspaceId,
          sessionId: request.sessionId,
          ...request.beforeSessionId === undefined
            ? {}
            : { beforeSessionId: request.beforeSessionId },
        },
      )
    }
    return { workspace: workspaceView(workspace) }
  }

  /**
   * Add one known Session to the registry-global archive set.
   * @param request - Session identity to archive.
   * @returns the complete resulting archive set.
   * @remarks 中文说明：功能说明：处理 archiveSession 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：request（WorkspaceArchiveSessionRequest）：提供调用方提交的请求信息；
   * 必须满足声明的类型及调用时序要求。；返回值：Promise<WorkspaceArchiveValue>；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 archiveSession(request)，并按返回类型处理结果。
   */
  async archiveSession(request: WorkspaceArchiveSessionRequest): Promise<WorkspaceArchiveValue> {
    try {
      await this.ctx.workspaceRegistry.archiveSession(request.sessionId)
    } catch (/*
 * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
 */ error) {
      if (!(error instanceof WorkspaceUnknownSessionError)) throw error
      throw failure('session-not-found', error.message, { sessionId: request.sessionId })
    }
    return { archivedSessionIds: [...this.ctx.workspaceRegistry.archivedSessionIds] }
  }

  /**
   * 功能说明：处理 requireWorkspace 相关流程；使用场景由所在模块及调用位置决定。
   * @param workspaceId （WorkspaceId）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns Workspace；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 requireWorkspace(workspaceId)，并按返回类型处理结果。
   */
  private requireWorkspace(workspaceId: WorkspaceId): Workspace {
    /**
     * 常量说明：workspace 用于处理 workspace 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const workspace = this.ctx.workspaceRegistry.get(WorkspaceId(workspaceId))
    if (workspace === undefined) throw workspaceNotFound(workspaceId)
    return workspace
  }

  /**
   * 功能说明：处理 enqueue 相关流程；使用场景由所在模块及调用位置决定。
   * @param operation （() => Promise<T>）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns Promise<T>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 enqueue(operation)，并按返回类型处理结果。
   */
  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    /**
     * 常量说明：result 用于处理 result 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const result = this.operationTail.then(operation)
    this.operationTail = result.then(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => undefined, /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => undefined)
    return result
  }
}

/**
 * 功能说明：处理 workspaceNotFound 相关流程；使用场景由所在模块及调用位置决定。
 * @param workspaceId （WorkspaceId）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns TypertRemoteFailure；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 workspaceNotFound(workspaceId)，并按返回类型处理结果。
 */
function workspaceNotFound(workspaceId: WorkspaceId): TypertRemoteFailure {
  return failure(
    'workspace-not-found',
    `Workspace "${workspaceId}" not found`,
    { workspaceId },
  )
}

/**
 * 功能说明：处理 failure 相关流程；使用场景由所在模块及调用位置决定。
 * @param code （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param message （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param details （object）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns TypertRemoteFailure；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 failure(code, message, details)，并按返回类型处理结果。
 */
function failure(
  code: string,
  message: string,
  details: object,
): TypertRemoteFailure {
  return new TypertRemoteFailure({ code, message, details })
}

/**
 * 功能说明：处理 errorMessage 相关流程；使用场景由所在模块及调用位置决定。
 * @param error （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns string；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 errorMessage(error)，并按返回类型处理结果。
 */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
