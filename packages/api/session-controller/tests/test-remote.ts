/** Test-only direct Remote face over the Session Controller's internal controllers.
 * @remarks 文件说明：文件职责：验证 api/session-controller 中 test remote 相关行为与失败场景。；
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。；产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。；
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。；
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。 */

import type { Context } from '@deepseek-ai/cordis'
import type { ModelSelection as AgentModelSelection } from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session'
import {
  SessionPersistenceCorruptionError,
  SessionPersistenceNotFoundError,
  SessionPersistenceRevision,
  type BorrowedSessionSource,
  type SessionInspection,
} from '@deepseek-ai/dsh-session-persistence'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SessionQueryEngine from '@deepseek-ai/dsh-session-query'
import { vi } from 'vitest'
import {
  TypertRemoteFailure,
  type RemoteResult,
} from '@deepseek-ai/dsh-typert-protocol'
import SessionController from '../src/index.ts'
import type {
  ModelCatalog,
  SessionAttachmentRequest,
  SessionAttachmentValue,
  SessionCancelRequest,
  SessionCancelValue,
  SessionControlFrame,
  SessionCreateRequest,
  SessionCreateValue,
  SessionForkRequest,
  SessionForkValue,
  SessionFollowFrame,
  SessionFollowRequest,
  SessionListRequest,
  SessionListValue,
  SessionOpenWorkspacePathRequest,
  SessionOpenWorkspacePathValue,
  SessionPage,
  SessionPageRequest,
  SessionPromptRequest,
  SessionPromptValue,
  SessionRenameRequest,
  SessionRenameValue,
  SessionSearchRequest,
  SessionSearchValue,
  SessionSelectModelRequest,
  SessionSelectModelValue,
  SessionUpdateQueueRequest,
  SessionUpdateQueueValue,
} from '../src/types.ts'

/** Direct test face matching the generated `ctx.remote.session` unary methods. */
export interface TestSessionRemote {
  /**
   * 功能说明：判断是否能够 Open Workspace Path 相关流程；使用场景由所在模块及调用位置决定。
   * @returns Promise<RemoteResult<boolean>>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 canOpenWorkspacePath()，并按返回类型处理结果。
   */
  canOpenWorkspacePath(): Promise<RemoteResult<boolean>>
  /**
   * 功能说明：列出 list 相关流程；使用场景由所在模块及调用位置决定。
   * @param request （SessionListRequest）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。
   * @param signal （AbortSignal）：传递取消或终止信号；必须满足声明的类型及调用时序要求。
   * @returns Promise<RemoteResult<SessionListValue>>；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 list(request, signal)，并按返回类型处理结果。
   */
  list(request: SessionListRequest, signal?: AbortSignal): Promise<RemoteResult<SessionListValue>>
  /**
   * 功能说明：处理 search 相关流程；使用场景由所在模块及调用位置决定。
   * @param request （SessionSearchRequest）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。
   * @param signal （AbortSignal）：传递取消或终止信号；必须满足声明的类型及调用时序要求。
   * @returns Promise<RemoteResult<SessionSearchValue>>；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 search(request, signal)，并按返回类型处理结果。
   */
  search(request: SessionSearchRequest, signal?: AbortSignal): Promise<RemoteResult<SessionSearchValue>>
  /**
   * 功能说明：创建 create 相关流程；使用场景由所在模块及调用位置决定。
   * @param request （SessionCreateRequest）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。
   * @returns Promise<RemoteResult<SessionCreateValue>>；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 create(request)，并按返回类型处理结果。
   */
  create(request: SessionCreateRequest): Promise<RemoteResult<SessionCreateValue>>
  /**
   * 功能说明：处理 selectModel 相关流程；使用场景由所在模块及调用位置决定。
   * @param request （SessionSelectModelRequest）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。
   * @returns Promise<RemoteResult<SessionSelectModelValue>>；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 selectModel(request)，并按返回类型处理结果。
   */
  selectModel(request: SessionSelectModelRequest): Promise<RemoteResult<SessionSelectModelValue>>
  /**
   * 功能说明：处理 modelCatalog 相关流程；使用场景由所在模块及调用位置决定。
   * @returns Promise<RemoteResult<ModelCatalog>>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 modelCatalog()，并按返回类型处理结果。
   */
  modelCatalog(): Promise<RemoteResult<ModelCatalog>>
  /**
   * 功能说明：处理 rename 相关流程；使用场景由所在模块及调用位置决定。
   * @param request （SessionRenameRequest）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。
   * @returns Promise<RemoteResult<SessionRenameValue>>；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 rename(request)，并按返回类型处理结果。
   */
  rename(request: SessionRenameRequest): Promise<RemoteResult<SessionRenameValue>>
  /**
   * 功能说明：处理 fork 相关流程；使用场景由所在模块及调用位置决定。
   * @param request （SessionForkRequest）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。
   * @returns Promise<RemoteResult<SessionForkValue>>；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 fork(request)，并按返回类型处理结果。
   */
  fork(request: SessionForkRequest): Promise<RemoteResult<SessionForkValue>>
  /**
   * 功能说明：处理 prompt 相关流程；使用场景由所在模块及调用位置决定。
   * @param request （SessionPromptRequest）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。
   * @param signal （AbortSignal）：传递取消或终止信号；必须满足声明的类型及调用时序要求。
   * @returns Promise<RemoteResult<SessionPromptValue>>；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 prompt(request, signal)，并按返回类型处理结果。
   */
  prompt(request: SessionPromptRequest, signal?: AbortSignal): Promise<RemoteResult<SessionPromptValue>>
  /**
   * 功能说明：处理 attachment 相关流程；使用场景由所在模块及调用位置决定。
   * @param request （SessionAttachmentRequest）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。
   * @returns Promise<RemoteResult<SessionAttachmentValue>>；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 attachment(request)，并按返回类型处理结果。
   */
  attachment(request: SessionAttachmentRequest): Promise<RemoteResult<SessionAttachmentValue>>
  /**
   * 功能说明：更新 Queue 相关流程；使用场景由所在模块及调用位置决定。
   * @param request （SessionUpdateQueueRequest）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。
   * @returns Promise<RemoteResult<SessionUpdateQueueValue>>；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 updateQueue(request)，并按返回类型处理结果。
   */
  updateQueue(request: SessionUpdateQueueRequest): Promise<RemoteResult<SessionUpdateQueueValue>>
  /**
   * 功能说明：处理 cancel 相关流程；使用场景由所在模块及调用位置决定。
   * @param request （SessionCancelRequest）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。
   * @returns Promise<RemoteResult<SessionCancelValue>>；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 cancel(request)，并按返回类型处理结果。
   */
  cancel(request: SessionCancelRequest): Promise<RemoteResult<SessionCancelValue>>
  /**
   * 功能说明：打开 Workspace Path 相关流程；使用场景由所在模块及调用位置决定。
   * @param request （SessionOpenWorkspacePathRequest）：提供调用方提交的请求信息；
   * 必须满足声明的类型及调用时序要求。
   * @param signal （AbortSignal）：传递取消或终止信号；必须满足声明的类型及调用时序要求。
   * @returns Promise<RemoteResult<SessionOpenWorkspacePathValue>>；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 openWorkspacePath(request, signal)，并按返回类型处理结果。
   */
  openWorkspacePath(
    request: SessionOpenWorkspacePathRequest,
    signal?: AbortSignal,
  ): Promise<RemoteResult<SessionOpenWorkspacePathValue>>
  /**
   * 功能说明：处理 page 相关流程；使用场景由所在模块及调用位置决定。
   * @param request （SessionPageRequest）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。
   * @param signal （AbortSignal）：传递取消或终止信号；必须满足声明的类型及调用时序要求。
   * @returns Promise<RemoteResult<SessionPage>>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 page(request, signal)，并按返回类型处理结果。
   */
  page(request: SessionPageRequest, signal?: AbortSignal): Promise<RemoteResult<SessionPage>>
  /**
   * 功能说明：处理 follow 相关流程；使用场景由所在模块及调用位置决定。
   * @param request （SessionFollowRequest）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。
   * @param signal （AbortSignal）：传递取消或终止信号；必须满足声明的类型及调用时序要求。
   * @returns AsyncIterable<SessionFollowFrame>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 follow(request, signal)，并按返回类型处理结果。
   */
  follow(request: SessionFollowRequest, signal?: AbortSignal): AsyncIterable<SessionFollowFrame>
  /**
   * 功能说明：处理 control 相关流程；使用场景由所在模块及调用位置决定。
   * @param signal （AbortSignal）：传递取消或终止信号；必须满足声明的类型及调用时序要求。
   * @returns AsyncIterable<SessionControlFrame>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 control(signal)，并按返回类型处理结果。
   */
  control(signal?: AbortSignal): AsyncIterable<SessionControlFrame>
}

/** Dependencies and policy supplied by a Session Controller unit harness. */
export interface TestSessionRemoteDefaults {
  readonly defaultModelSelection: () => AgentModelSelection
  readonly cwd: string
  readonly coldBlankProbeMaxBytes?: number
  readonly nativeOpen?: boolean
  readonly saveDefaultModelSelection?: (selection: AgentModelSelection) => void | Promise<void>
  readonly openPath?: (path: string, signal: AbortSignal) => Promise<void>
  readonly canOpenPath?: () => boolean
}

/**
 * 常量说明：installed 用于处理 installed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const installed = new WeakMap<Context, SessionController>()

type LegacyTestPersistence = Record<string, unknown> & {
  readonly inspect?: (
    sessionId: SessionId,
    signal?: AbortSignal,
  ) => Promise<SessionInspection | undefined>
  readonly borrowSession?: (
    sessionId: SessionId,
    signal?: AbortSignal,
  ) => Promise<BorrowedSessionSource>
}

/** Add the preparation-backed point-read contract to compact persistence doubles.
 * @remarks 中文说明：功能说明：处理 testSessionPersistence 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：ctx（Context）：提供当前 Cordis 插件上下文与已声明服务；必须满足声明的类型及调用时序要求。；
 * 参数说明：persistence（LegacyTestPersistence）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：LegacyTestPersistence；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * testSessionPersistence(ctx, persistence)，并按返回类型处理结果。 */
export function testSessionPersistence(
  ctx: Context,
  persistence: LegacyTestPersistence,
): LegacyTestPersistence {
  if (persistence.borrowSession !== undefined) return persistence
  return {
    ...persistence,
    borrowSession: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：sessionId（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：signal（由 TypeScript
 * 根据调用位置推断的类型）：传递取消或终止信号；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(sessionId, signal)，
 * 并按返回类型处理结果。
 */ async (sessionId, signal) => {
      signal?.throwIfAborted()
      /**
       * 常量说明：inspection 用于处理 inspection 相关数据，作用于当前作用域；初始化后不可重新赋值，
       * 但对象内部是否可变仍由其类型决定。
       */
      const inspection = await persistence.inspect?.(sessionId, signal)
      signal?.throwIfAborted()
      if (inspection === undefined) throw new SessionPersistenceNotFoundError(sessionId)
      try {
        /**
         * 常量说明：preparedSession 用于处理 preparedSession 相关数据，作用于当前作用域；初始化后不可重新赋值，
         * 但对象内部是否可变仍由其类型决定。
         */
        const preparedSession = ctx.sessions.prepare(inspection.meta.id, {
          seed: [...inspection.events],
          meta: inspection.meta,
          seedSource: 'persistence',
        })
        return {
          source: 'prepared',
          inspection: {
            meta: preparedSession.header,
            events: Object.freeze([...inspection.events]),
          },
          revision: SessionPersistenceRevision(`test:${sessionId}:${String(preparedSession.seq)}`),
          preparedSession,
          [Symbol.dispose]: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {},
        }
      } catch (/*
 * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
 */ error: unknown) {
        throw new SessionPersistenceCorruptionError(
          `test session "${sessionId}" failed validation: ${String(error)}`,
          { cause: error },
        )
      }
    },
  }
}

/** Concrete point-read query used by Session Controller tests that do not exercise search.
 * @remarks 中文说明：类说明：TestSessionQuery 用于集中封装 处理 TestSessionQuery 相关状态与行为。；
 * 核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。；使用场景：由 api/session-controller
 * 在对应插件或业务生命周期内创建和调用。 */
class TestSessionQuery extends SessionQueryEngine {
  /**
   * 功能说明：处理 searchSessions 相关流程；使用场景由所在模块及调用位置决定。
   * @returns Promise<never>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 searchSessions()，并按返回类型处理结果。
   */
  override searchSessions(): Promise<never> {
    return Promise.reject(new Error('session search is not configured in this test'))
  }

  /**
   * 功能说明：处理 searchEvents 相关流程；使用场景由所在模块及调用位置决定。
   * @returns Promise<never>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 searchEvents()，并按返回类型处理结果。
   */
  override searchEvents(): Promise<never> {
    return Promise.reject(new Error('event search is not configured in this test'))
  }
}

/** Install the required projection and point-query services for direct controller tests.
 * @remarks 中文说明：功能说明：处理 installSessionReadTestServices 相关流程；
 * 使用场景由所在模块及调用位置决定。；参数说明：ctx（Context）：提供当前 Cordis 插件上下文与已声明服务；
 * 必须满足声明的类型及调用时序要求。；返回值：void；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 installSessionReadTestServices(ctx)，并按返回类型处理结果。 */
export function installSessionReadTestServices(ctx: Context): void {
  if (ctx.get('sessionProjections') === undefined) new SessionProjectionRegistry(ctx)
  if (ctx.get('sessionQuery') === undefined) new TestSessionQuery(ctx)
}

/**
 * 功能说明：处理 installControllers 相关流程；使用场景由所在模块及调用位置决定。
 * @param ctx （Context）：提供当前 Cordis 插件上下文与已声明服务；必须满足声明的类型及调用时序要求。
 * @param defaults （TestSessionRemoteDefaults）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns SessionController；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 installControllers(ctx, defaults)，并按返回类型处理结果。
 */
function installControllers(
  ctx: Context,
  defaults: TestSessionRemoteDefaults,
): SessionController {
  /**
   * 常量说明：found 用于处理 found 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const found = installed.get(ctx)
  if (found !== undefined) return found

  if (ctx.get('typert') === undefined) {
    /**
     * 常量说明：dispose 用于处理 dispose 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     * 功能说明：处理 dispose 相关流程；使用场景由所在模块及调用位置决定。
     * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 dispose()，并按返回类型处理结果。
     */
    const dispose = (): void => {}
    ctx.provide('typert', {
      lookups: { configure: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => dispose },
      contexts: { configureHost: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => dispose },
    } as never)
  }
  if (ctx.get('agentDefaultModel') === undefined) {
    ctx.provide('agentDefaultModel', {
      currentSelection: defaults.defaultModelSelection,
      saveSelection: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：selection（AgentModelSelection）：提供
 * 本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(selection)，并按返回类型处理结果。
 */ async (selection: AgentModelSelection) => {
        await defaults.saveDefaultModelSelection?.(selection)
      },
    } as never)
  }
  if (ctx.get('llm') === undefined) {
    ctx.provide('llm', {
      listProviders: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {
        /**
         * 常量说明：selection 用于处理 selection 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const selection = defaults.defaultModelSelection()
        return [{ id: selection.provider, name: selection.provider }]
      },
    } as never)
  }
  installSessionReadTestServices(ctx)
  /**
   * 常量说明：cwd 用于处理 cwd 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const cwd = vi.spyOn(process, 'cwd').mockReturnValue(defaults.cwd)
  /**
   * 变量说明：controller 用于处理 controller 相关数据，作用于当前作用域；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  let controller: SessionController
  try {
    controller = new SessionController(
      ctx,
      {
        ...defaults.coldBlankProbeMaxBytes === undefined
          ? {}
          : { coldBlankProbeMaxBytes: defaults.coldBlankProbeMaxBytes },
        ...defaults.nativeOpen === undefined ? {} : { nativeOpen: defaults.nativeOpen },
      },
      {
        ...defaults.openPath === undefined ? {} : { openPath: defaults.openPath },
        ...defaults.canOpenPath === undefined ? {} : { canOpenPath: defaults.canOpenPath },
      },
    )
  } finally {
    cwd.mockRestore()
  }
  installed.set(ctx, controller)
  return controller
}

/** Build or return the production Session Controller for a direct unit harness.
 * @remarks 中文说明：功能说明：创建 Session Test Controller 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：ctx（Context）：提供当前 Cordis 插件上下文与已声明服务；必须满足声明的类型及调用时序要求。；
 * 参数说明：defaults（TestSessionRemoteDefaults）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：SessionController；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * createSessionTestController(ctx, defaults)，并按返回类型处理结果。 */
export function createSessionTestController(
  ctx: Context,
  defaults: TestSessionRemoteDefaults,
): SessionController {
  return installControllers(ctx, defaults)
}

/**
 * 功能说明：处理 remoteResult 相关流程；使用场景由所在模块及调用位置决定。
 * @param operation （() => T | Promise<T>）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param signal （AbortSignal）：传递取消或终止信号；必须满足声明的类型及调用时序要求。
 * @returns Promise<RemoteResult<T>>；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 remoteResult(operation, signal)，并按返回类型处理结果。
 */
function remoteResult<T>(
  operation: () => T | Promise<T>,
  signal?: AbortSignal,
): Promise<RemoteResult<T>> {
  return Promise.resolve()
    .then(operation)
    .then(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：value（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(value)，并按返回类型处理结果。
 */ value => ({ ok: true as const, value }))
    .catch(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：error（unknown）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 典型用法：在完成前置校验后调用 匿名回调(error)，并按返回类型处理结果。
 */ (error: unknown) => ({
        ok: false as const,
        error: signal?.aborted === true
          ? { code: 'cancelled', message: 'request was aborted', details: {} }
          : error instanceof TypertRemoteFailure
            ? error.failure
            : {
              code: 'internal',
              message: error instanceof Error ? error.message : String(error),
              details: {},
            },
      }))
}

/** Build the generated Session Remote's unary result semantics without a carrier.
 * @remarks 中文说明：功能说明：创建 Session Test Remote 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：ctx（Context）：提供当前 Cordis 插件上下文与已声明服务；必须满足声明的类型及调用时序要求。；
 * 参数说明：defaults（TestSessionRemoteDefaults）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：TestSessionRemote；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * createSessionTestRemote(ctx, defaults)，并按返回类型处理结果。 */
export function createSessionTestRemote(
  ctx: Context,
  defaults: TestSessionRemoteDefaults,
): TestSessionRemote {
  /**
   * 常量说明：direct 用于处理 direct 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const direct = createSessionTestController(ctx, defaults)
  return {
    canOpenWorkspacePath: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => remoteResult(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => direct.canOpenWorkspacePath()),
    list: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：request（由 TypeScript
 * 根据调用位置推断的类型）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。；参数：signal（由 TypeScript
 * 根据调用位置推断的类型）：传递取消或终止信号；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(request, signal)，
 * 并按返回类型处理结果。
 */ (request, signal = new AbortController().signal) => remoteResult(
      /*
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
       */ () => direct.list(request, signal),
      signal,
    ),
    search: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：request（由 TypeScript
 * 根据调用位置推断的类型）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。；参数：signal（由 TypeScript
 * 根据调用位置推断的类型）：传递取消或终止信号；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(request, signal)，
 * 并按返回类型处理结果。
 */ (request, signal = new AbortController().signal) => remoteResult(
      /*
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
       */ () => direct.search(request, signal),
      signal,
    ),
    create: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：request（由 TypeScript
 * 根据调用位置推断的类型）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(request)，并按返回类型处理结果。
 */ request => remoteResult(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => direct.create(request)),
    selectModel: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：request（由 TypeScript
 * 根据调用位置推断的类型）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(request)，并按返回类型处理结果。
 */ request => remoteResult(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => direct.selectModel(request)),
    modelCatalog: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => remoteResult(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => direct.modelCatalog()),
    rename: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：request（由 TypeScript
 * 根据调用位置推断的类型）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(request)，并按返回类型处理结果。
 */ request => remoteResult(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => direct.rename(request)),
    fork: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：request（由 TypeScript
 * 根据调用位置推断的类型）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(request)，并按返回类型处理结果。
 */ request => remoteResult(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => direct.fork(request)),
    prompt: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：request（由 TypeScript
 * 根据调用位置推断的类型）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。；参数：signal（由 TypeScript
 * 根据调用位置推断的类型）：传递取消或终止信号；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(request, signal)，
 * 并按返回类型处理结果。
 */ (request, signal = new AbortController().signal) => remoteResult(
      /*
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
       */ () => direct.prompt(request, signal),
      signal,
    ),
    attachment: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：request（由 TypeScript
 * 根据调用位置推断的类型）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(request)，并按返回类型处理结果。
 */ request => remoteResult(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => direct.attachment(request)),
    updateQueue: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：request（由 TypeScript
 * 根据调用位置推断的类型）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(request)，并按返回类型处理结果。
 */ request => remoteResult(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => direct.updateQueue(request)),
    cancel: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：request（由 TypeScript
 * 根据调用位置推断的类型）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(request)，并按返回类型处理结果。
 */ request => remoteResult(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => direct.cancel(request)),
    openWorkspacePath: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：request（由 TypeScript
 * 根据调用位置推断的类型）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。；参数：signal（由 TypeScript
 * 根据调用位置推断的类型）：传递取消或终止信号；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(request, signal)，
 * 并按返回类型处理结果。
 */ (request, signal = new AbortController().signal) => remoteResult(
      /*
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
       */ () => direct.openWorkspacePath(request, signal),
      signal,
    ),
    page: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：request（由 TypeScript
 * 根据调用位置推断的类型）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。；参数：signal（由 TypeScript
 * 根据调用位置推断的类型）：传递取消或终止信号；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(request, signal)，
 * 并按返回类型处理结果。
 */ (request, signal = new AbortController().signal) => remoteResult(
      /*
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
       */ () => direct.page(request, signal),
      signal,
    ),
    follow: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：request（由 TypeScript
 * 根据调用位置推断的类型）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。；参数：signal（由 TypeScript
 * 根据调用位置推断的类型）：传递取消或终止信号；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(request, signal)，
 * 并按返回类型处理结果。
 */ (request, signal = new AbortController().signal) => direct.follow(request, signal),
    control: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：signal（由 TypeScript
 * 根据调用位置推断的类型）：传递取消或终止信号；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(signal)，并按返回类型处理结果。
 */ (signal = new AbortController().signal) => direct.control(signal),
  }
}
