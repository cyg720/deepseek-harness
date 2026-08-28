/** Host Workspace Remote owner: explicit commands and reconnect-safe state.
 * @remarks 文件说明：文件职责：实现 api/workspace-controller 中 index 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * api/workspace-controller 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。 */

import { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { WorkspaceCommands } from './commands.ts'
import { DirectoryPickerController } from './directory-picker.ts'
import { WorkspaceFeed } from './feed.ts'
import type {
  WorkspaceArchiveSessionRequest,
  WorkspaceArchiveValue,
  WorkspaceCreateRequest,
  WorkspaceCreateValue,
  WorkspaceDeleteRequest,
  WorkspaceDeleteValue,
  WorkspaceFollowFrame,
  WorkspaceInsertBeforeRequest,
  WorkspaceInsertSessionBeforeRequest,
  WorkspaceOrderValue,
  WorkspaceRenameRequest,
  WorkspaceValue,
} from './types.ts'

export type * from './types.ts'
export { DirectoryPickerController } from './directory-picker.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host Workspace business API and Remote namespace owner. */
    workspaceController: WorkspaceController
  }
}

/** Host service backing the generated `ctx.remote.workspace` namespace.
 * @remarks 中文说明：类说明：WorkspaceController 用于集中封装 处理 WorkspaceController
 * 相关状态与行为。；核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。；使用场景：由
 * api/workspace-controller 在对应插件或业务生命周期内创建和调用。 */
export class WorkspaceController extends TypertRemoteService {
  /**
   * 变量说明：inject 用于处理 inject 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  static inject = ['typert', 'workspaceRegistry']

  /**
   * 常量说明：commands 用于处理 commands 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly commands: WorkspaceCommands
  /**
   * 常量说明：feed 用于处理 feed 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly feed: WorkspaceFeed

  /** @param ctx - Host context containing the Workspace registry.
   * @remarks 中文说明：功能说明：处理 WorkspaceController 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：ctx（Context）：提供当前 Cordis 插件上下文与已声明服务；必须满足声明的类型及调用时序要求。；返回值：当前类实例；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：通过 new WorkspaceController(ctx) 创建实例，
   * 并在所属生命周期内使用。 */
  constructor(ctx: Context) {
    super(ctx, 'workspaceController', { namespace: 'workspace' })
    this.commands = new WorkspaceCommands(ctx)
    this.feed = new WorkspaceFeed(ctx)
    // This package is the Loader entry for both Remote owners it hosts: the
    // directory-picking seam is abstract and never an entry itself. The child
    // stays pending until a picking backend is composed, so a host without one
    // registers no picking namespace instead of answering an unservable verb.
    ctx.plugin(DirectoryPickerController)
  }

  /**
   * Create or idempotently resolve one Workspace over an existing directory.
   * @param request - directory path to register.
   * @returns the Workspace and whether this call created it.
   * @remarks 中文说明：功能说明：创建 create 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：request（WorkspaceCreateRequest）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。；
   * 返回值：Promise<WorkspaceCreateValue>；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 使用示例：典型用法：在完成前置校验后调用 create(request)，并按返回类型处理结果。
   */
  @Remote('create')
  create(request: WorkspaceCreateRequest): Promise<WorkspaceCreateValue> {
    return this.commands.create(request)
  }

  /**
   * Rename one Workspace to a unique non-blank title.
   * @param request - Workspace identity and proposed title.
   * @returns the updated Workspace projection.
   * @remarks 中文说明：功能说明：处理 rename 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：request（WorkspaceRenameRequest）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。；
   * 返回值：Promise<WorkspaceValue>；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 使用示例：典型用法：在完成前置校验后调用 rename(request)，并按返回类型处理结果。
   */
  @Remote('rename')
  rename(request: WorkspaceRenameRequest): Promise<WorkspaceValue> {
    return this.commands.rename(request)
  }

  /**
   * Remove one Workspace registration while retaining files and Sessions.
   * @param request - Workspace identity to remove.
   * @returns deletion confirmation.
   * @remarks 中文说明：功能说明：删除 delete 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：request（WorkspaceDeleteRequest）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。；
   * 返回值：Promise<WorkspaceDeleteValue>；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 使用示例：典型用法：在完成前置校验后调用 delete(request)，并按返回类型处理结果。
   */
  @Remote('delete')
  delete(request: WorkspaceDeleteRequest): Promise<WorkspaceDeleteValue> {
    return this.commands.delete(request)
  }

  /**
   * Move one Workspace within the registry display order.
   * @param request - moved Workspace and optional anchor.
   * @returns the complete resulting Workspace order.
   * @remarks 中文说明：功能说明：处理 insertBefore 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：request（WorkspaceInsertBeforeRequest）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。
   * ；返回值：Promise<WorkspaceOrderValue>；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 使用示例：典型用法：在完成前置校验后调用 insertBefore(request)，并按返回类型处理结果。
   */
  @Remote('insertBefore')
  insertBefore(request: WorkspaceInsertBeforeRequest): Promise<WorkspaceOrderValue> {
    return this.commands.insertBefore(request)
  }

  /**
   * Move one accounted Session within a Workspace.
   * @param request - Workspace, Session, and optional anchor identities.
   * @returns the updated Workspace projection.
   * @remarks 中文说明：功能说明：处理 insertSessionBefore 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：request（WorkspaceInsertSessionBeforeRequest）：提供调用方提交的请求信息；
   * 必须满足声明的类型及调用时序要求。；返回值：Promise<WorkspaceValue>；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 使用示例：典型用法：在完成前置校验后调用 insertSessionBefore(request)，并按返回类型处理结果。
   */
  @Remote('insertSessionBefore')
  insertSessionBefore(request: WorkspaceInsertSessionBeforeRequest): Promise<WorkspaceValue> {
    return this.commands.insertSessionBefore(request)
  }

  /**
   * Hide one known Session from Workspace grouping surfaces.
   * @param request - Session identity to archive.
   * @returns the complete resulting archive set.
   * @remarks 中文说明：功能说明：处理 archiveSession 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：request（WorkspaceArchiveSessionRequest）：提供调用方提交的请求信息；
   * 必须满足声明的类型及调用时序要求。；返回值：Promise<WorkspaceArchiveValue>；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 archiveSession(request)，并按返回类型处理结果。
   */
  @Remote('archiveSession')
  archiveSession(request: WorkspaceArchiveSessionRequest): Promise<WorkspaceArchiveValue> {
    return this.commands.archiveSession(request)
  }

  /**
   * Stream a complete Workspace baseline followed by ordered increments.
   * @param signal - generation cancellation.
   * @returns baseline followed by ordered Workspace increments.
   * @remarks 中文说明：功能说明：处理 follow 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：signal（AbortSignal）：传递取消或终止信号；必须满足声明的类型及调用时序要求。；
   * 返回值：AsyncIterable<WorkspaceFollowFrame>；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 使用示例：典型用法：在完成前置校验后调用 follow(signal)，并按返回类型处理结果。
   */
  @Remote({ mode: 'stream' })
  follow(signal: AbortSignal): AsyncIterable<WorkspaceFollowFrame> {
    return this.feed.follow(signal)
  }
}

export default WorkspaceController
