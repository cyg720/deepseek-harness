/**
 * 文件职责：验证 api/workspace-controller 中 model client spec 相关行为与失败场景。
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。
 * 产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 */
import { describe, expect, it, vi } from 'vitest'
import {
  ClientWorkspaceModel, type WorkspaceRemote,
} from '../src/client/index.ts'
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
  WorkspaceError,
  WorkspaceId,
  WorkspaceView,
} from '../src/types.ts'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/**
 * 常量说明：sid 用于处理 sid 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 * 功能说明：处理 sid 相关流程；使用场景由所在模块及调用位置决定。
 * @param id （string）：标识本次操作关联的唯一对象；必须满足声明的类型及调用时序要求。
 * @returns SessionId；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 sid(id)，并按返回类型处理结果。
 */
const sid = (id: string): SessionId => id as SessionId
/**
 * 常量说明：wid 用于处理 wid 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 * 功能说明：处理 wid 相关流程；使用场景由所在模块及调用位置决定。
 * @param id （string）：标识本次操作关联的唯一对象；必须满足声明的类型及调用时序要求。
 * @returns WorkspaceId；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 wid(id)，并按返回类型处理结果。
 */
const wid = (id: string): WorkspaceId => id as WorkspaceId

/**
 * 功能说明：处理 workspace 相关流程；使用场景由所在模块及调用位置决定。
 * @param id （string）：标识本次操作关联的唯一对象；必须满足声明的类型及调用时序要求。
 * @param sessionIds （readonly SessionId[]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param updatedAt （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns WorkspaceView；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 workspace(id, sessionIds, updatedAt)，并按返回类型处理结果。
 */
function workspace(
  id: string,
  sessionIds: readonly SessionId[] = [],
  updatedAt = '2026-01-01T00:00:00.000Z',
): WorkspaceView {
  return {
    workspaceId: wid(id),
    path: `/w/${id}`,
    title: id,
    sessionIds,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt,
  }
}

/**
 * 功能说明：处理 remoteOk 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （T）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns RemoteResult<T>；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 remoteOk(value)，并按返回类型处理结果。
 */
function remoteOk<T>(value: T): RemoteResult<T> {
  return { ok: true, value }
}

/**
 * 功能说明：处理 workspaceError 相关流程；使用场景由所在模块及调用位置决定。
 * @param error （WorkspaceError）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns RemoteResult<never>；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 workspaceError(error)，并按返回类型处理结果。
 */
function workspaceError(error: WorkspaceError): RemoteResult<never> {
  return { ok: false, error }
}

interface Deferred<T> {
  readonly promise: Promise<T>
  /**
   * 功能说明：解析 resolve 相关流程；使用场景由所在模块及调用位置决定。
   * @param value （T）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 resolve(value)，并按返回类型处理结果。
   */
  resolve(value: T): void
  /**
   * 功能说明：处理 reject 相关流程；使用场景由所在模块及调用位置决定。
   * @param error （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 reject(error)，并按返回类型处理结果。
   */
  reject(error: unknown): void
}

/**
 * 功能说明：处理 deferred 相关流程；使用场景由所在模块及调用位置决定。
 * @returns Deferred<T>；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 deferred()，并按返回类型处理结果。
 */
function deferred<T>(): Deferred<T> {
  /**
   * 变量说明：resolve 用于解析 resolve 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let resolve!: (value: T) => void
  /**
   * 变量说明：reject 用于处理 reject 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let reject!: (error: unknown) => void
  /**
   * 常量说明：promise 用于处理 promise 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const promise = new Promise<T>(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：accept（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：fail（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(accept, fail)，并按返回类型处理结果。
 */ (accept, fail) => {
      resolve = accept
      reject = fail
    })
  return { promise, reject, resolve }
}

/**
 * 类说明：FakeWorkspaceRemote 用于集中封装 处理 FakeWorkspaceRemote 相关状态与行为。
 * 核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。
 * 使用场景：由 api/workspace-controller 在对应插件或业务生命周期内创建和调用。
 */
class FakeWorkspaceRemote implements WorkspaceRemote {
  /**
   * 常量说明：calls 用于处理 calls 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  readonly calls: Array<{ readonly method: string; readonly request: unknown }> = []
  /**
   * 变量说明：onCreate 用于响应 Create 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   * 功能说明：响应 Create 相关流程；使用场景由所在模块及调用位置决定。
   * @param request （由 TypeScript 根据调用位置推断的类型）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。
   * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 onCreate(request)，并按返回类型处理结果。
   */
  onCreate: (request: WorkspaceCreateRequest) => Promise<RemoteResult<WorkspaceCreateValue>> = request =>
    Promise.resolve(remoteOk({ workspace: workspace(request.path.split('/').pop() ?? 'workspace'), created: true }))
  /**
   * 变量说明：onRename 用于响应 Rename 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   * 功能说明：响应 Rename 相关流程；使用场景由所在模块及调用位置决定。
   * @param request （由 TypeScript 根据调用位置推断的类型）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。
   * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 onRename(request)，并按返回类型处理结果。
   */
  onRename: (request: WorkspaceRenameRequest) => Promise<RemoteResult<WorkspaceValue>> = request =>
    Promise.resolve(remoteOk({ workspace: { ...workspace(String(request.workspaceId)), title: request.title } }))
  /**
   * 变量说明：onDelete 用于响应 Delete 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   * 功能说明：响应 Delete 相关流程；使用场景由所在模块及调用位置决定。
   * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 onDelete()，并按返回类型处理结果。
   */
  onDelete: (_request: WorkspaceDeleteRequest) => Promise<RemoteResult<WorkspaceDeleteValue>> = () =>
    Promise.resolve(remoteOk({ deleted: true }))
  /**
   * 变量说明：onInsertBefore 用于响应 Insert Before 相关数据，作用于成员；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   * 功能说明：响应 Insert Before 相关流程；使用场景由所在模块及调用位置决定。
   * @param request （由 TypeScript 根据调用位置推断的类型）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。
   * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 onInsertBefore(request)，并按返回类型处理结果。
   */
  onInsertBefore: (
    request: WorkspaceInsertBeforeRequest,
  ) => Promise<RemoteResult<WorkspaceOrderValue>> = request =>
    Promise.resolve(remoteOk({ workspaceIds: [request.workspaceId] }))
  /**
   * 变量说明：onInsertSessionBefore 用于响应 Insert Session Before 相关数据，作用于成员；
   * 其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   * 功能说明：响应 Insert Session Before 相关流程；使用场景由所在模块及调用位置决定。
   * @param request （由 TypeScript 根据调用位置推断的类型）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。
   * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 onInsertSessionBefore(request)，并按返回类型处理结果。
   */
  onInsertSessionBefore: (
    request: WorkspaceInsertSessionBeforeRequest,
  ) => Promise<RemoteResult<WorkspaceValue>> = request => Promise.resolve(remoteOk({
    workspace: workspace(String(request.workspaceId), [request.sessionId]),
  }))
  /**
   * 变量说明：onArchiveSession 用于响应 Archive Session 相关数据，作用于成员；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   * 功能说明：响应 Archive Session 相关流程；使用场景由所在模块及调用位置决定。
   * @param request （由 TypeScript 根据调用位置推断的类型）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。
   * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 onArchiveSession(request)，并按返回类型处理结果。
   */
  onArchiveSession: (
    request: WorkspaceArchiveSessionRequest,
  ) => Promise<RemoteResult<WorkspaceArchiveValue>> = request =>
    Promise.resolve(remoteOk({ archivedSessionIds: [request.sessionId] }))

  /**
   * 功能说明：创建 create 相关流程；使用场景由所在模块及调用位置决定。
   * @param request （WorkspaceCreateRequest）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。
   * @returns Promise<RemoteResult<WorkspaceCreateValue>>；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 create(request)，并按返回类型处理结果。
   */
  create(request: WorkspaceCreateRequest): Promise<RemoteResult<WorkspaceCreateValue>> {
    this.record('create', request)
    return this.onCreate(request)
  }

  /**
   * 功能说明：处理 rename 相关流程；使用场景由所在模块及调用位置决定。
   * @param request （WorkspaceRenameRequest）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。
   * @returns Promise<RemoteResult<WorkspaceValue>>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 rename(request)，并按返回类型处理结果。
   */
  rename(request: WorkspaceRenameRequest): Promise<RemoteResult<WorkspaceValue>> {
    this.record('rename', request)
    return this.onRename(request)
  }

  /**
   * 功能说明：删除 delete 相关流程；使用场景由所在模块及调用位置决定。
   * @param request （WorkspaceDeleteRequest）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。
   * @returns Promise<RemoteResult<WorkspaceDeleteValue>>；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 delete(request)，并按返回类型处理结果。
   */
  delete(request: WorkspaceDeleteRequest): Promise<RemoteResult<WorkspaceDeleteValue>> {
    this.record('delete', request)
    return this.onDelete(request)
  }

  /**
   * 功能说明：处理 insertBefore 相关流程；使用场景由所在模块及调用位置决定。
   * @param request （WorkspaceInsertBeforeRequest）：提供调用方提交的请求信息；
   * 必须满足声明的类型及调用时序要求。
   * @returns Promise<RemoteResult<WorkspaceOrderValue>>；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 insertBefore(request)，并按返回类型处理结果。
   */
  insertBefore(request: WorkspaceInsertBeforeRequest): Promise<RemoteResult<WorkspaceOrderValue>> {
    this.record('insertBefore', request)
    return this.onInsertBefore(request)
  }

  /**
   * 功能说明：处理 insertSessionBefore 相关流程；使用场景由所在模块及调用位置决定。
   * @param request （WorkspaceInsertSessionBeforeRequest）：提供调用方提交的请求信息；
   * 必须满足声明的类型及调用时序要求。
   * @returns Promise<RemoteResult<WorkspaceValue>>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 insertSessionBefore(request)，并按返回类型处理结果。
   */
  insertSessionBefore(request: WorkspaceInsertSessionBeforeRequest): Promise<RemoteResult<WorkspaceValue>> {
    this.record('insertSessionBefore', request)
    return this.onInsertSessionBefore(request)
  }

  /**
   * 功能说明：处理 archiveSession 相关流程；使用场景由所在模块及调用位置决定。
   * @param request （WorkspaceArchiveSessionRequest）：提供调用方提交的请求信息；
   * 必须满足声明的类型及调用时序要求。
   * @returns Promise<RemoteResult<WorkspaceArchiveValue>>；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 archiveSession(request)，并按返回类型处理结果。
   */
  archiveSession(request: WorkspaceArchiveSessionRequest): Promise<RemoteResult<WorkspaceArchiveValue>> {
    this.record('archiveSession', request)
    return this.onArchiveSession(request)
  }

  /**
   * 功能说明：处理 follow 相关流程；使用场景由所在模块及调用位置决定。
   * @param _signal （AbortSignal）：传递取消或终止信号；必须满足声明的类型及调用时序要求。
   * @returns AsyncGenerator<WorkspaceFollowFrame>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 follow(_signal)，并按返回类型处理结果。
   */
  async *follow(_signal?: AbortSignal): AsyncGenerator<WorkspaceFollowFrame> {}

  /**
   * 功能说明：处理 record 相关流程；使用场景由所在模块及调用位置决定。
   * @param method （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param request （unknown）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 record(method, request)，并按返回类型处理结果。
   */
  private record(method: string, request: unknown): void {
    this.calls.push({ method, request })
  }
}

/**
 * 功能说明：处理 modelFor 相关流程；使用场景由所在模块及调用位置决定。
 * @param remote （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns ClientWorkspaceModel；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 modelFor(remote)，并按返回类型处理结果。
 */
function modelFor(remote = new FakeWorkspaceRemote()): ClientWorkspaceModel {
  return new ClientWorkspaceModel(remote)
}

/**
 * 功能说明：处理 baseline 相关流程；使用场景由所在模块及调用位置决定。
 * @param model （ClientWorkspaceModel）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param items （readonly WorkspaceView[]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param archivedSessionIds （readonly SessionId[]）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。
 * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 baseline(model, items, archivedSessionIds)，
 * 并按返回类型处理结果。
 */
function baseline(
  model: ClientWorkspaceModel,
  items: readonly WorkspaceView[] = [],
  archivedSessionIds: readonly SessionId[] = [],
): void {
  model.replaceBaseline({ items, archivedSessionIds })
}

describe('ClientWorkspaceModel', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {
    it('replaces reconnect state and applies ordered increments', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {
        /**
     * 常量说明：model 用于处理 model 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const model = modelFor()
        expect(model.getSnapshot()).toMatchObject({ phase: 'pending', state: 'loading' })
        baseline(model, [workspace('old'), workspace('kept')])
        model.upsertView(workspace('new'))
        model.replaceOrder([wid('kept'), wid('new'), wid('old')])
        model.replaceArchived([sid('hidden')])
        model.removeView(wid('old'))
        expect(model.getSnapshot()).toMatchObject({ phase: 'ready', state: 'idle', archivedSessionIds: ['hidden'] })
        expect(model.getSnapshot().items.map(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：item（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(item)，并按返回类型处理结果。
 */ item => item.workspaceId)).toEqual(['kept', 'new'])

        baseline(model, [workspace('fresh')])
        expect(model.getSnapshot().items.map(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：item（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(item)，并按返回类型处理结果。
 */ item => item.workspaceId)).toEqual(['fresh'])
        expect(model.getSnapshot().archivedSessionIds).toEqual([])
      })

    it('keeps the last baseline during retry and exposes a terminal stream failure', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {
        /**
     * 常量说明：model 用于处理 model 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const model = modelFor()
        baseline(model, [workspace('visible')])
        model.handleCarrierFailure()
        expect(model.getSnapshot()).toMatchObject({ phase: 'ready', state: 'loading', error: null })
        expect(model.getSnapshot().items.map(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：item（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(item)，并按返回类型处理结果。
 */ item => item.workspaceId)).toEqual(['visible'])
        model.handleStreamFailure(new Error('wire down'))
        expect(model.getSnapshot()).toMatchObject({
          phase: 'ready', state: 'error', error: { code: 'internal', message: 'wire down' },
        })
        model.handleStreamFailure('plain failure')
        expect(model.getSnapshot().error?.message).toBe('plain failure')
        baseline(model, [workspace('restored')])
        expect(model.getSnapshot()).toMatchObject({ phase: 'ready', state: 'idle', error: null })
      })

    it('creates by path, prepends the returned row, and folds rejected calls', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：remote 用于处理 remote 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const remote = new FakeWorkspaceRemote()
        /**
     * 常量说明：model 用于处理 model 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const model = modelFor(remote)
        remote.onCreate = /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：request（由 TypeScript
 * 根据调用位置推断的类型）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(request)，并按返回类型处理结果。
 */ request => Promise.resolve(remoteOk({
            workspace: workspace('created', [], '2026-02-01T00:00:00.000Z'),
            created: request.path === '/w/created',
          }))
        await expect(model.create({ path: '/w/created' })).resolves.toMatchObject({ ok: true })
        expect(remote.calls).toContainEqual({ method: 'create', request: { path: '/w/created' } })
        expect(model.getSnapshot().items[0]?.workspaceId).toBe('created')

        remote.onCreate = /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => Promise.reject(new Error('create transport'))
        await expect(model.create({ path: '/w/existing' })).resolves.toMatchObject({
          ok: false, error: { code: 'internal', message: 'create transport' },
        })
      })

    it('lets newer stream order outrank unary echoes and rolls failures back', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：remote 用于处理 remote 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const remote = new FakeWorkspaceRemote()
        /**
     * 常量说明：model 用于处理 model 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const model = modelFor(remote)
        baseline(model, [workspace('one'), workspace('two'), workspace('three')])

        /**
     * 常量说明：gate 用于处理 gate 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const gate = deferred<RemoteResult<WorkspaceOrderValue>>()
        remote.onInsertBefore = /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => gate.promise
        /**
     * 常量说明：pending 用于处理 pending 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const pending = model.insertBefore(wid('three'), wid('one'))
        expect(model.getSnapshot().items.map(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：item（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(item)，并按返回类型处理结果。
 */ item => item.workspaceId)).toEqual(['three', 'one', 'two'])
        model.replaceOrder([wid('one'), wid('three'), wid('two')])
        gate.resolve(remoteOk({ workspaceIds: [wid('three'), wid('one'), wid('two')] }))
        await pending
        expect(model.getSnapshot().items.map(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：item（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(item)，并按返回类型处理结果。
 */ item => item.workspaceId)).toEqual(['one', 'three', 'two'])

        remote.onInsertBefore = /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => Promise.resolve(workspaceError({
            code: 'workspace-not-found', message: 'gone', details: { workspaceId: wid('three') },
          }))
        /**
     * 常量说明：rejected 用于处理 rejected 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const rejected = model.insertBefore(wid('three'))
        expect(model.getSnapshot().items.map(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：item（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(item)，并按返回类型处理结果。
 */ item => item.workspaceId)).toEqual(['one', 'two', 'three'])
        await expect(rejected).resolves.toMatchObject({ ok: false })
        expect(model.getSnapshot().items.map(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：item（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(item)，并按返回类型处理结果。
 */ item => item.workspaceId)).toEqual(['one', 'three', 'two'])

        remote.onInsertBefore = /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => Promise.reject(new Error('transport down'))
        /**
     * 常量说明：disconnected 用于处理 disconnected 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const disconnected = model.insertBefore(wid('three'), wid('one'))
        expect(model.getSnapshot().items.map(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：item（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(item)，并按返回类型处理结果。
 */ item => item.workspaceId)).toEqual(['three', 'one', 'two'])
        await expect(disconnected).rejects.toThrow('transport down')
        expect(model.getSnapshot().items.map(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：item（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(item)，并按返回类型处理结果。
 */ item => item.workspaceId)).toEqual(['one', 'three', 'two'])
      })

    it('keeps a newer optimistic reorder when an older transport call rejects', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：remote 用于处理 remote 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const remote = new FakeWorkspaceRemote()
        /**
     * 常量说明：model 用于处理 model 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const model = modelFor(remote)
        baseline(model, [workspace('one'), workspace('two'), workspace('three')])
        /**
     * 常量说明：firstGate 用于处理 firstGate 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const firstGate = deferred<RemoteResult<WorkspaceOrderValue>>()
        /**
     * 常量说明：secondGate 用于处理 secondGate 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const secondGate = deferred<RemoteResult<WorkspaceOrderValue>>()
        /**
     * 变量说明：request 用于处理 request 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
        let request = 0
        remote.onInsertBefore = /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => request++ === 0 ? firstGate.promise : secondGate.promise

        /**
     * 常量说明：first 用于处理 first 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const first = model.insertBefore(wid('three'), wid('one'))
        /**
     * 常量说明：second 用于处理 second 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const second = model.insertBefore(wid('two'), wid('three'))
        firstGate.reject(new Error('first transport failed'))
        await expect(first).rejects.toThrow('first transport failed')
        expect(model.getSnapshot().items.map(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：item（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(item)，并按返回类型处理结果。
 */ item => item.workspaceId)).toEqual(['two', 'three', 'one'])
        secondGate.resolve(remoteOk({ workspaceIds: [wid('two'), wid('three'), wid('one')] }))
        await expect(second).resolves.toMatchObject({ ok: true })
      })

    it('rolls overlapping rejected reorders back to the last Host order', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：remote 用于处理 remote 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const remote = new FakeWorkspaceRemote()
        /**
     * 常量说明：model 用于处理 model 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const model = modelFor(remote)
        baseline(model, [workspace('one'), workspace('two'), workspace('three')])
        /**
     * 常量说明：firstGate 用于处理 firstGate 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const firstGate = deferred<RemoteResult<WorkspaceOrderValue>>()
        /**
     * 常量说明：secondGate 用于处理 secondGate 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const secondGate = deferred<RemoteResult<WorkspaceOrderValue>>()
        /**
     * 变量说明：request 用于处理 request 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
        let request = 0
        remote.onInsertBefore = /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => request++ === 0 ? firstGate.promise : secondGate.promise

        /**
     * 常量说明：first 用于处理 first 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const first = model.insertBefore(wid('three'), wid('one'))
        /**
     * 常量说明：second 用于处理 second 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const second = model.insertBefore(wid('two'), wid('three'))
        expect(model.getSnapshot().items.map(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：item（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(item)，并按返回类型处理结果。
 */ item => item.workspaceId)).toEqual(['two', 'three', 'one'])
        firstGate.resolve(workspaceError({
          code: 'workspace-not-found', message: 'first rejected', details: { workspaceId: wid('three') },
        }))
        await expect(first).resolves.toMatchObject({ ok: false })
        expect(model.getSnapshot().items.map(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：item（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(item)，并按返回类型处理结果。
 */ item => item.workspaceId)).toEqual(['two', 'three', 'one'])
        secondGate.resolve(workspaceError({
          code: 'workspace-not-found', message: 'second rejected', details: { workspaceId: wid('two') },
        }))
        await expect(second).resolves.toMatchObject({ ok: false })
        expect(model.getSnapshot().items.map(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：item（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(item)，并按返回类型处理结果。
 */ item => item.workspaceId)).toEqual(['one', 'two', 'three'])
      })

    it('retains removal tombstones across later baselines', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {
        /**
     * 常量说明：model 用于处理 model 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const model = modelFor()
        baseline(model, [workspace('gone'), workspace('kept')])
        model.removeView(wid('gone'))
        model.removeView(wid('gone'))
        expect(model.getSnapshot().items.map(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：item（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(item)，并按返回类型处理结果。
 */ item => item.workspaceId)).toEqual(['kept'])
        baseline(model, [workspace('gone')])
        expect(model.getSnapshot().items).toEqual([])
      })

    it('does not let delayed unary data resurrect a removed Workspace', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：remote 用于处理 remote 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const remote = new FakeWorkspaceRemote()
        /**
     * 常量说明：model 用于处理 model 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const model = modelFor(remote)
        baseline(model, [workspace('gone')])
        /**
     * 常量说明：gate 用于处理 gate 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const gate = deferred<RemoteResult<WorkspaceValue>>()
        remote.onRename = /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => gate.promise
        /**
     * 常量说明：rename 用于处理 rename 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const rename = model.rename(wid('gone'), 'late')
        model.removeView(wid('gone'))
        gate.resolve(remoteOk({ workspace: { ...workspace('gone'), title: 'late' } }))
        await expect(rename).resolves.toMatchObject({ ok: true })
        expect(model.getSnapshot().items).toEqual([])
      })

    it('applies Workspace mutation echoes and leaves failed results unchanged', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：remote 用于处理 remote 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const remote = new FakeWorkspaceRemote()
        /**
     * 常量说明：model 用于处理 model 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const model = modelFor(remote)
        baseline(model, [workspace('one', [sid('first'), sid('second')])], [sid('archived')])

        remote.onRename = /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => Promise.resolve(workspaceError({
            code: 'workspace-not-found', message: 'gone', details: { workspaceId: wid('one') },
          }))
        await expect(model.rename(wid('one'), 'ignored')).resolves.toMatchObject({ ok: false })
        expect(model.getSnapshot().items[0]?.title).toBe('one')

        remote.onDelete = /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => Promise.resolve(workspaceError({
            code: 'workspace-not-found', message: 'gone', details: { workspaceId: wid('one') },
          }))
        await expect(model.delete(wid('one'))).resolves.toMatchObject({ ok: false })
        expect(model.getSnapshot().items).toHaveLength(1)

        remote.onInsertSessionBefore = /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：request（由 TypeScript
 * 根据调用位置推断的类型）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(request)，并按返回类型处理结果。
 */ request => Promise.resolve(remoteOk({
            workspace: workspace('one', [request.sessionId, sid('first')], '2026-02-01T00:00:00.000Z'),
          }))
        await expect(model.insertSessionBefore(wid('one'), sid('second'), sid('first')))
          .resolves.toMatchObject({ ok: true })
        expect(remote.calls).toContainEqual({
          method: 'insertSessionBefore',
          request: { workspaceId: 'one', sessionId: 'second', beforeSessionId: 'first' },
        })

        remote.onInsertSessionBefore = /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => Promise.resolve(workspaceError({
            code: 'workspace-move-invalid',
            message: 'invalid move',
            details: { workspaceId: wid('one'), sessionId: sid('second') },
          }))
        await expect(model.insertSessionBefore(wid('one'), sid('second')))
          .resolves.toMatchObject({ ok: false })
        expect(remote.calls).toContainEqual({
          method: 'insertSessionBefore',
          request: { workspaceId: 'one', sessionId: 'second' },
        })

        remote.onArchiveSession = /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => Promise.resolve(workspaceError({
            code: 'session-not-found', message: 'missing', details: { sessionId: sid('missing') },
          }))
        await expect(model.archiveSession(sid('missing'))).resolves.toMatchObject({ ok: false })
        expect(model.getSnapshot().archivedSessionIds).toEqual(['archived'])
        remote.onArchiveSession = /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：request（由 TypeScript
 * 根据调用位置推断的类型）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(request)，并按返回类型处理结果。
 */ request => Promise.resolve(remoteOk({ archivedSessionIds: [request.sessionId] }))
        await expect(model.archiveSession(sid('fresh'))).resolves.toMatchObject({ ok: true })
        expect(model.getSnapshot().archivedSessionIds).toEqual(['fresh'])
      })

    it('keeps the newest row and places Workspaces missing from partial orders last', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：model 用于处理 model 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const model = modelFor()
        baseline(model, [
          workspace('one', [], '2026-02-01T00:00:00.000Z'),
          workspace('two'),
        ])
        model.upsertView(workspace('one', [], '2025-12-01T00:00:00.000Z'))
        expect(model.getSnapshot().items[0]?.updatedAt).toBe('2026-02-01T00:00:00.000Z')
        model.upsertView(workspace('one', [sid('new')], '2026-03-01T00:00:00.000Z'))
        expect(model.getSnapshot().items[0]?.sessionIds).toEqual(['new'])

        model.replaceOrder([wid('one')])
        expect(model.getSnapshot().items.map(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：item（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(item)，并按返回类型处理结果。
 */ item => item.workspaceId)).toEqual(['one', 'two'])
        model.replaceOrder([wid('two')])
        expect(model.getSnapshot().items.map(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：item（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(item)，并按返回类型处理结果。
 */ item => item.workspaceId)).toEqual(['two', 'one'])
        model.replaceOrder([wid('one')])
        expect(model.getSnapshot().items.map(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：item（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(item)，并按返回类型处理结果。
 */ item => item.workspaceId)).toEqual(['one', 'two'])

        await expect(model.insertBefore(wid('one'), wid('one'))).resolves.toMatchObject({ ok: true })
        expect(model.getSnapshot().items.map(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：item（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(item)，并按返回类型处理结果。
 */ item => item.workspaceId)).toEqual(['one', 'two'])
      })

    it('notifies subscribers and cancels a queued notification after an immediate delete echo', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：remote 用于处理 remote 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const remote = new FakeWorkspaceRemote()
        /**
     * 常量说明：model 用于处理 model 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const model = modelFor(remote)
        baseline(model, [workspace('gone')])
        await Promise.resolve()
        /**
     * 常量说明：listener 用于处理 listener 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const listener = vi.fn()
        /**
     * 常量说明：unsubscribe 用于处理 unsubscribe 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const unsubscribe = model.subscribe(listener)

        /**
     * 常量说明：deletion 用于处理 deletion 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const deletion = model.delete(wid('gone'))
        model.removeView(wid('gone'))
        await expect(deletion).resolves.toMatchObject({ ok: true })
        expect(listener).toHaveBeenCalledOnce()
        await Promise.resolve()
        expect(listener).toHaveBeenCalledOnce()

        unsubscribe()
        model.handleCarrierFailure()
        await Promise.resolve()
        expect(listener).toHaveBeenCalledOnce()
      })

    it('removes from a unary delete echo before the operation resolves', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：remote 用于处理 remote 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const remote = new FakeWorkspaceRemote()
        /**
     * 常量说明：model 用于处理 model 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const model = modelFor(remote)
        baseline(model, [workspace('gone')])
        await expect(model.delete(wid('gone'))).resolves.toMatchObject({ ok: true })
        expect(remote.calls).toContainEqual({ method: 'delete', request: { workspaceId: 'gone' } })
        expect(model.getSnapshot().items).toEqual([])
        model.removeView(wid('gone'))
        expect(model.getSnapshot().items).toEqual([])
      })
  })
