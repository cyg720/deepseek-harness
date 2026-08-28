// Test-local programmable Remote fake (NOT the fixture: fixture is a demo
// data source on a real clock; behavior tests need per-case responses and
// deferred-controlled timing). Session streams are hand pumps: pushFollow/pushControl.
/**
 * 文件职责：验证 api/session-controller 中 fake api client 相关行为与失败场景。
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。
 * 产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 */
import type {
  MessageId,
  RpcError, RpcResponse, SessionId, SessionSearchItem,
  SubagentCatalog, SubagentInterruptReceipt, SubagentPromptReceipt,
  WorkspaceId, WorkspaceView,
} from '@deepseek-ai/dsh-api-remotes/client'
import type {
  SessionAddress,
  SessionControlBaseline,
  SessionControlFrame,
  SessionFollowFrame,
  SessionFollowRequest,
  SessionPage,
  SessionPageRequest,
  SessionProjectionBaseline,
  SessionSelectModelRequest,
  SessionSelectModelValue,
} from '@deepseek-ai/dsh-api-session-controller/types'
import type { WorkspaceRemote } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { WorkspaceFollowFrame } from '@deepseek-ai/dsh-api-workspace-controller/types'
import type { RemoteFailure, RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import {
  RemoteStream,
  RemoteStreamError,
  type RemoteStreamOptions,
} from '@deepseek-ai/dsh-api-gateway/client'
import { RpcId } from '@deepseek-ai/dsh-client-connection/client'
import type { SessionRemotes } from '../src/client/sessions/remotes.ts'
import { historyRecordLastSeq } from '../src/client/sessions/history-records.ts'

/**
 * 常量说明：AVAILABLE_STREAM_CONNECTION 用于处理 AVAILABLE_STREAM_CONNECTION 相关数据，
 * 作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const AVAILABLE_STREAM_CONNECTION = {
  generation: {
    getSnapshot: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => ({ id: 1, host: { home: '/h' } }),
    subscribe: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {},
  },
}

/** Programmable-default workspace row (branded id, ISO-ish times).
 * @remarks 中文说明：功能说明：处理 fakeWorkspace 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：id（string）：标识本次操作关联的唯一对象；必须满足声明的类型及调用时序要求。；
 * 参数说明：over（Partial<WorkspaceView>）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：WorkspaceView；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * fakeWorkspace(id, over)，并按返回类型处理结果。 */
function fakeWorkspace(id: string, over: Partial<WorkspaceView> = {}): WorkspaceView {
  return {
    workspaceId: id as WorkspaceId,
    path: '/f/ws',
    title: 'ws',
    sessionIds: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  }
}

/**
 * 功能说明：处理 addressSessionId 相关流程；使用场景由所在模块及调用位置决定。
 * @param address （SessionAddress）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns SessionId；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 addressSessionId(address)，并按返回类型处理结果。
 */
function addressSessionId(address: SessionAddress): SessionId {
  return address.kind === 'session' ? address.sessionId : address.childSessionId
}

export interface Deferred<T> {
  promise: Promise<T>
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

/** Test-held settlement: the case decides when an RPC lands (history-pending injections etc.).
 * @remarks 中文说明：功能说明：处理 deferred 相关流程；使用场景由所在模块及调用位置决定。；返回值：Deferred<T>；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 deferred()，并按返回类型处理结果。 */
export function deferred<T>(): Deferred<T> {
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
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：res（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：rej（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(res, rej)，并按返回类型处理结果。
 */ (res, rej) => {
      resolve = res
      reject = rej
    })
  return { promise, resolve, reject }
}

/**
 * 变量说明：nextRpc 用于处理 nextRpc 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
 */
let nextRpc = 0

/**
 * 功能说明：处理 ok 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （T）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns RpcResponse<T>；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 ok(value)，并按返回类型处理结果。
 */
export function ok<T>(value: T): RpcResponse<T> {
  return { rpcId: RpcId(`fake-${nextRpc++}`), result: { ok: true, value } }
}

/**
 * 功能说明：处理 err 相关流程；使用场景由所在模块及调用位置决定。
 * @param error （RpcError）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns RpcResponse<T>；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 err(error)，并按返回类型处理结果。
 */
export function err<T>(error: RpcError): RpcResponse<T> {
  return { rpcId: RpcId(`fake-${nextRpc++}`), result: { ok: false, error } }
}

/** Successful generated Remote result for programmable domain fakes.
 * @remarks 中文说明：功能说明：处理 remoteOk 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：value（T）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：RemoteResult<T>；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 remoteOk(value)，
 * 并按返回类型处理结果。 */
export function remoteOk<T>(value: T): RemoteResult<T> {
  return { ok: true, value }
}

/**
 * Failed generated Remote result carrying an owner's own failure vocabulary,
 * which the carrier's closed RPC code set does not contain.
 * @param error - the owner-declared failure.
 * @returns the failure branch of a Remote result.
 * @remarks 中文说明：功能说明：处理 remoteErr 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：error（RemoteFailure）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：RemoteResult<T>；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * remoteErr(error)，并按返回类型处理结果。
 */
export function remoteErr<T>(error: RemoteFailure): RemoteResult<T> {
  return { ok: false, error }
}

type ValueStreamItem<F> =
  | { kind: 'frame'; value: F; delivered?: () => void }
  | { kind: 'end' }
  | { kind: 'fail'; error: unknown }

interface ValueStreamConn<F> {
  /**
   * 功能说明：处理 feed 相关流程；使用场景由所在模块及调用位置决定。
   * @param item （ValueStreamItem<F>）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 feed(item)，并按返回类型处理结果。
   */
  feed(item: ValueStreamItem<F>): void
}

interface OpenValueStream<F> {
  readonly values: AsyncGenerator<F>
  /**
   * 功能说明：处理 dispose 相关流程；使用场景由所在模块及调用位置决定。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 dispose()，并按返回类型处理结果。
   */
  dispose(): void
}

/**
 * Commands Remote double: the generated face delivers the carrier's outcome, so
 * a test that programs nothing sees an empty catalog and an unmatched line.
 * @returns the Remote namespaces the session cluster calls.
 */
export type RuntimeRemotes = SessionRemotes & { readonly workspace: WorkspaceRemote }

/**
 * 功能说明：处理 fakeRemote 相关流程；使用场景由所在模块及调用位置决定。
 * @param api （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns RuntimeRemotes；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 fakeRemote(api)，并按返回类型处理结果。
 */
export function fakeRemote(api = new FakeApiClient()): RuntimeRemotes {
  return api.sessionRemotes()
}

/**
 * 类说明：FakeApiClient 用于集中封装 处理 FakeApiClient 相关状态与行为。
 * 核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。
 * 使用场景：由 api/session-controller 在对应插件或业务生命周期内创建和调用。
 */
export class FakeApiClient {
  /** Chronological call record: [method, payload].
   * @remarks 中文说明：常量说明：calls 用于处理 calls 相关数据，作用于成员；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。 */
  readonly calls: { method: string; payload: unknown }[] = []
  /** Session ids in physical follow-generation opening order.
   * @remarks 中文说明：常量说明：followStarts 用于处理 followStarts 相关数据，作用于成员；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。 */
  readonly followStarts: SessionId[] = []

  // Programmable slots (defaults answer OK-empty); reassign per case.
  /**
   * 变量说明：onList 用于响应 List 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   * 功能说明：响应 List 相关流程；使用场景由所在模块及调用位置决定。
   * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 onList()，并按返回类型处理结果。
   */
  onList: (payload: unknown) => Promise<RpcResponse<{ items: never[] }>> = () => Promise.resolve(ok({ items: [] }))
  /**
   * 变量说明：onSearch 用于响应 Search 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   * 功能说明：响应 Search 相关流程；使用场景由所在模块及调用位置决定。
   * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 onSearch()，并按返回类型处理结果。
   */
  onSearch: (payload: unknown) => Promise<RpcResponse<{ items: SessionSearchItem[]; hasMore: boolean }>> =
    () => Promise.resolve(ok({ items: [], hasMore: false }))
  /**
   * 变量说明：onCreate 用于响应 Create 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   * 功能说明：响应 Create 相关流程；使用场景由所在模块及调用位置决定。
   * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 onCreate()，并按返回类型处理结果。
   */
  onCreate: (payload: unknown) => Promise<RpcResponse<{ sessionId: SessionId }>> = () => Promise.resolve(ok({ sessionId: 'fk-new' as SessionId }))
  /**
   * 变量说明：onSelectModel 用于响应 Select Model 相关数据，作用于成员；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   * 功能说明：响应 Select Model 相关流程；使用场景由所在模块及调用位置决定。
   * @param payload （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 onSelectModel(payload)，并按返回类型处理结果。
   */
  onSelectModel: (payload: SessionSelectModelRequest) => Promise<RpcResponse<SessionSelectModelValue>> =
    payload => Promise.resolve(ok({
      selected: {
        provider: payload.provider,
        model: payload.model,
        ...(payload.reasoningEffort === undefined
          ? {}
          : { reasoningEffort: payload.reasoningEffort }),
      },
    }))
  /**
   * 变量说明：onRename 用于响应 Rename 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   * 功能说明：响应 Rename 相关流程；使用场景由所在模块及调用位置决定。
   * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 onRename()，并按返回类型处理结果。
   */
  onRename: (payload: unknown) => Promise<RpcResponse<{ title: string; seq: number }>> = () => Promise.resolve(ok({ title: 'fk-renamed', seq: 0 }))
  /**
   * 变量说明：onFork 用于响应 Fork 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   * 功能说明：响应 Fork 相关流程；使用场景由所在模块及调用位置决定。
   * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 onFork()，并按返回类型处理结果。
   */
  onFork: (payload: unknown) => Promise<RpcResponse<{ sessionId: SessionId }>> = () => Promise.resolve(ok({ sessionId: 'fk-fork' as SessionId }))
  /**
   * 变量说明：onHistory 用于响应 History 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   * 功能说明：响应 History 相关流程；使用场景由所在模块及调用位置决定。
   * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 onHistory()，并按返回类型处理结果。
   */
  onHistory: (payload: { sessionId: SessionId; throughSeq?: number; beforeSeq?: number; maxMessages?: number })
  => Promise<RpcResponse<SessionPage & { readonly projections?: SessionProjectionBaseline }>> =
    () => Promise.resolve(ok({ records: [], hasMore: false }))

  /**
   * 变量说明：onPrompt 用于响应 Prompt 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   * 功能说明：响应 Prompt 相关流程；使用场景由所在模块及调用位置决定。
   * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 onPrompt()，并按返回类型处理结果。
   */
  onPrompt: (payload: unknown) => Promise<RpcResponse<{ accepted: true }>> = () => Promise.resolve(ok({ accepted: true as const }))
  /**
   * 变量说明：onAttachment 用于响应 Attachment 相关数据，作用于成员；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   * 功能说明：响应 Attachment 相关流程；使用场景由所在模块及调用位置决定。
   * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 onAttachment()，并按返回类型处理结果。
   */
  onAttachment: (payload: unknown) => Promise<RpcResponse<{ attachment: { attachmentId: never; mediaType: 'image/png'; bytes: number; width: number; height: number }; data: string }>> =
    () => Promise.resolve(ok({ attachment: { attachmentId: 'a' as never, mediaType: 'image/png', bytes: 1, width: 1, height: 1 }, data: 'AA==' }))
  /**
   * 变量说明：onUpdateQueue 用于响应 Update Queue 相关数据，作用于成员；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   * 功能说明：响应 Update Queue 相关流程；使用场景由所在模块及调用位置决定。
   * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 onUpdateQueue()，并按返回类型处理结果。
   */
  onUpdateQueue: (payload: unknown) => Promise<RpcResponse<{ accepted: true }>> = () => Promise.resolve(ok({ accepted: true as const }))
  /**
   * 变量说明：onCancel 用于响应 Cancel 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   * 功能说明：响应 Cancel 相关流程；使用场景由所在模块及调用位置决定。
   * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 onCancel()，并按返回类型处理结果。
   */
  onCancel: (payload: unknown) => Promise<RpcResponse<{ accepted: true }>> = () => Promise.resolve(ok({ accepted: true as const }))
  /**
   * 变量说明：onOpenWorkspacePath 用于响应 Open Workspace Path 相关数据，作用于成员；
   * 其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   * 功能说明：响应 Open Workspace Path 相关流程；使用场景由所在模块及调用位置决定。
   * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 onOpenWorkspacePath()，并按返回类型处理结果。
   */
  onOpenWorkspacePath: (payload: unknown) => Promise<RemoteResult<{ opened: true }>> =
    () => Promise.resolve(remoteOk({ opened: true as const }))

  /**
   * 常量说明：followConns 用于处理 followConns 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly followConns = new Map<SessionId, ValueStreamConn<SessionFollowFrame>[]>()
  /**
   * 常量说明：controlConns 用于处理 controlConns 相关数据，作用于成员；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  private readonly controlConns: ValueStreamConn<SessionControlFrame>[] = []
  /**
   * 常量说明：workspaceConns 用于处理 workspaceConns 相关数据，作用于成员；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  private readonly workspaceConns: ValueStreamConn<WorkspaceFollowFrame>[] = []
  /** Optional Host opening cursor override for stale-page and reconnect tests.
   * @remarks 中文说明：变量说明：followCursor 用于处理 followCursor 相关数据，作用于成员；
   * 其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。 */
  followCursor: number | undefined
  /**
   * 变量说明：controlBaseline 用于处理 controlBaseline 相关数据，作用于成员；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  controlBaseline: SessionControlBaseline = {
    queues: {},
    jobs: {},
    projections: {},
  }
  /**
   * 变量说明：workspaceBaseline 用于处理 workspaceBaseline 相关数据，作用于成员；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  workspaceBaseline: Extract<WorkspaceFollowFrame, { type: 'baseline' }>['value'] = {
    items: [],
    archivedSessionIds: [],
  }
  /**
   * 变量说明：lastSearchSignal 用于处理 lastSearchSignal 相关数据，作用于成员；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  lastSearchSignal: AbortSignal | undefined

  /**
   * 变量说明：onSubagentList 用于响应 Subagent List 相关数据，作用于成员；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   * 功能说明：响应 Subagent List 相关流程；使用场景由所在模块及调用位置决定。
   * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 onSubagentList()，并按返回类型处理结果。
   */
  onSubagentList: (payload: unknown) => Promise<RemoteResult<SubagentCatalog>>
    = () => Promise.resolve(remoteOk({ entries: [], parentAvailable: true }))
  /**
   * 变量说明：onSubagentPrompt 用于响应 Subagent Prompt 相关数据，作用于成员；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   * 功能说明：响应 Subagent Prompt 相关流程；使用场景由所在模块及调用位置决定。
   * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 onSubagentPrompt()，并按返回类型处理结果。
   */
  onSubagentPrompt: (payload: unknown) => Promise<RemoteResult<SubagentPromptReceipt>>
    = () => Promise.resolve(remoteOk({ messageId: 'fake-message' as MessageId }))

  /**
   * 变量说明：onSubagentInterrupt 用于响应 Subagent Interrupt 相关数据，作用于成员；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   * 功能说明：响应 Subagent Interrupt 相关流程；使用场景由所在模块及调用位置决定。
   * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 onSubagentInterrupt()，并按返回类型处理结果。
   */
  onSubagentInterrupt: (payload: unknown) => Promise<RemoteResult<SubagentInterruptReceipt>>
    = () => Promise.resolve(remoteOk({ accepted: true as const }))

  /**
   * 变量说明：onWorkspaceCreate 用于响应 Workspace Create 相关数据，作用于成员；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   * 功能说明：响应 Workspace Create 相关流程；使用场景由所在模块及调用位置决定。
   * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 onWorkspaceCreate()，并按返回类型处理结果。
   */
  onWorkspaceCreate: (payload: unknown) => Promise<RemoteResult<{ workspace: WorkspaceView; created: boolean }>> =
    () => Promise.resolve(remoteOk({ workspace: fakeWorkspace('fk-ws'), created: true }))

  /**
   * 变量说明：onWorkspaceRename 用于响应 Workspace Rename 相关数据，作用于成员；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   * 功能说明：响应 Workspace Rename 相关流程；使用场景由所在模块及调用位置决定。
   * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 onWorkspaceRename()，并按返回类型处理结果。
   */
  onWorkspaceRename: (payload: unknown) => Promise<RemoteResult<{ workspace: WorkspaceView }>> =
    () => Promise.resolve(remoteOk({ workspace: fakeWorkspace('fk-ws') }))

  /**
   * 变量说明：onWorkspaceDelete 用于响应 Workspace Delete 相关数据，作用于成员；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   * 功能说明：响应 Workspace Delete 相关流程；使用场景由所在模块及调用位置决定。
   * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 onWorkspaceDelete()，并按返回类型处理结果。
   */
  onWorkspaceDelete: (payload: unknown) => Promise<RemoteResult<{ deleted: true }>> =
    () => Promise.resolve(remoteOk({ deleted: true }))

  /**
   * 变量说明：onWorkspaceInsertBefore 用于响应 Workspace Insert Before 相关数据，作用于成员；
   * 其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   * 功能说明：响应 Workspace Insert Before 相关流程；使用场景由所在模块及调用位置决定。
   * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 onWorkspaceInsertBefore()，并按返回类型处理结果。
   */
  onWorkspaceInsertBefore: (payload: unknown) => Promise<RemoteResult<{ workspaceIds: WorkspaceId[] }>> =
    () => Promise.resolve(remoteOk({ workspaceIds: [] }))

  /**
   * 变量说明：onWorkspaceInsertSessionBefore 用于响应 Workspace Insert Session Before
   * 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   * 功能说明：响应 Workspace Insert Session Before 相关流程；使用场景由所在模块及调用位置决定。
   * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 onWorkspaceInsertSessionBefore()，并按返回类型处理结果。
   */
  onWorkspaceInsertSessionBefore: (payload: unknown) => Promise<RemoteResult<{ workspace: WorkspaceView }>> =
    () => Promise.resolve(remoteOk({ workspace: fakeWorkspace('fk-ws') }))

  /**
   * 变量说明：onWorkspaceArchiveSession 用于响应 Workspace Archive Session 相关数据，作用于成员；
   * 其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   * 功能说明：响应 Workspace Archive Session 相关流程；使用场景由所在模块及调用位置决定。
   * @param payload （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 onWorkspaceArchiveSession(payload)，并按返回类型处理结果。
   */
  onWorkspaceArchiveSession: (payload: unknown) => Promise<RemoteResult<{ archivedSessionIds: SessionId[] }>> =
    payload => Promise.resolve(remoteOk({ archivedSessionIds: [(payload as { sessionId: SessionId }).sessionId] }))

  /** Remote namespaces bound to this fake's programmable unary slots and stream pumps.
   * @remarks 中文说明：功能说明：处理 sessionRemotes 相关流程；使用场景由所在模块及调用位置决定。；
   * 返回值：RuntimeRemotes；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * sessionRemotes()，并按返回类型处理结果。 */
  sessionRemotes(): RuntimeRemotes {
    return {
      $stream: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：options（RemoteStreamOptions<Item>
 * ）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(options)，并按返回类型处理结果。
 */ <Item>(options: RemoteStreamOptions<Item>) => (
        new RemoteStream(AVAILABLE_STREAM_CONNECTION, options)
      ),
      commands: {
        execute: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => Promise.resolve({ ok: true, value: undefined }),
      },
      session: {
        canOpenWorkspacePath: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => Promise.resolve(remoteOk(true)),
        list: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：payload（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(payload)，并按返回类型处理结果。
 */ payload => this.remoteResult('session.list', payload, this.onList(payload)),
        modelCatalog: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => Promise.resolve({
          ok: true,
          value: {
            default: { provider: 'fixture', model: 'fixture' },
            routableProviders: [],
            groups: [],
            failures: [],
          },
        }),
        search: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：payload（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：signal（由 TypeScript
 * 根据调用位置推断的类型）：传递取消或终止信号；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(payload, signal)，
 * 并按返回类型处理结果。
 */ (payload, signal) => {
          this.lastSearchSignal = signal
          return this.remoteResult('session.search', payload, this.onSearch(payload))
        },
        create: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：payload（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(payload)，并按返回类型处理结果。
 */ payload => this.remoteResult('session.create', payload, this.onCreate(payload)),
        selectModel: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：payload（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(payload)，并按返回类型处理结果。
 */ payload => this.remoteResult(
          'session.selectModel',
          payload,
          this.onSelectModel(payload),
        ),
        rename: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：payload（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(payload)，并按返回类型处理结果。
 */ payload => this.remoteResult('session.rename', payload, this.onRename(payload)),
        fork: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：payload（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(payload)，并按返回类型处理结果。
 */ payload => this.remoteResult('session.fork', payload, this.onFork(payload)),
        prompt: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：payload（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(payload)，并按返回类型处理结果。
 */ payload => this.remoteResult('session.prompt', payload, this.onPrompt(payload)),
        attachment: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：payload（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(payload)，并按返回类型处理结果。
 */ payload => this.remoteResult('session.attachment', payload, this.onAttachment(payload)),
        updateQueue: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：payload（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(payload)，并按返回类型处理结果。
 */ payload => this.remoteResult('session.updateQueue', payload, this.onUpdateQueue(payload)),
        cancel: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：payload（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(payload)，并按返回类型处理结果。
 */ payload => this.remoteResult('session.cancel', payload, this.onCancel(payload)),
        openWorkspacePath: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：payload（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(payload)，并按返回类型处理结果。
 */ payload => this.record(
          'session.openWorkspacePath',
          payload,
          this.onOpenWorkspacePath(payload),
        ),
        page: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：request（由 TypeScript
 * 根据调用位置推断的类型）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(request)，并按返回类型处理结果。
 */ request => this.page(request),
        follow: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：request（由 TypeScript
 * 根据调用位置推断的类型）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。；参数：signal（由 TypeScript
 * 根据调用位置推断的类型）：传递取消或终止信号；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(request, signal)，
 * 并按返回类型处理结果。
 */ (request, signal) => this.openFollow(request, signal),
        control: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：signal（由 TypeScript
 * 根据调用位置推断的类型）：传递取消或终止信号；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(signal)，并按返回类型处理结果。
 */ signal => this.openControl(signal),
      },
      subagents: {
        list: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：parentSessionId（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(parentSessionId)，
 * 并按返回类型处理结果。
 */ parentSessionId => this.record(
          'subagents.list',
          parentSessionId,
          this.onSubagentList(parentSessionId),
        ),
        prompt: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：request（由 TypeScript
 * 根据调用位置推断的类型）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(request)，并按返回类型处理结果。
 */ request => this.record('subagents.prompt', request, this.onSubagentPrompt(request)),
        interruptByParent: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：childSessionId（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：parentSessionId（由
 * TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：mode（由
 * TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript
 * 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(childSessionId,
 * parentSessionId, mode)，并按返回类型处理结果。
 */ (childSessionId, parentSessionId, mode) => this.record(
          'subagents.interruptByParent',
          { childSessionId, parentSessionId, mode },
          this.onSubagentInterrupt({ childSessionId, parentSessionId, mode }),
        ),
      },
      workspace: {
        create: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：payload（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(payload)，并按返回类型处理结果。
 */ payload => this.record('workspace.create', payload, this.onWorkspaceCreate(payload)),
        rename: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：payload（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(payload)，并按返回类型处理结果。
 */ payload => this.record('workspace.rename', payload, this.onWorkspaceRename(payload)),
        delete: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：payload（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(payload)，并按返回类型处理结果。
 */ payload => this.record('workspace.delete', payload, this.onWorkspaceDelete(payload)),
        insertBefore: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：payload（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(payload)，并按返回类型处理结果。
 */ payload => this.record(
          'workspace.insertBefore',
          payload,
          this.onWorkspaceInsertBefore(payload),
        ),
        insertSessionBefore: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：payload（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(payload)，并按返回类型处理结果。
 */ payload => this.record(
          'workspace.insertSessionBefore',
          payload,
          this.onWorkspaceInsertSessionBefore(payload),
        ),
        archiveSession: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：payload（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(payload)，并按返回类型处理结果。
 */ payload => this.record(
          'workspace.archiveSession',
          payload,
          this.onWorkspaceArchiveSession(payload),
        ),
        follow: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：signal（由 TypeScript
 * 根据调用位置推断的类型）：传递取消或终止信号；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(signal)，并按返回类型处理结果。
 */ signal => this.openWorkspace(signal),
      },
    }
  }

  /** Push one live Session event to every follower of that Session.
   * @remarks 中文说明：功能说明：处理 pushFollow 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：sessionId（SessionId）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：frame（Extract<SessionFollowFrame, { type: 'event' }>）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。；返回值：Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 使用示例：典型用法：在完成前置校验后调用 pushFollow(sessionId, frame)，并按返回类型处理结果。 */
  async pushFollow(
    sessionId: SessionId,
    frame: Extract<SessionFollowFrame, { type: 'event' }>,
  ): Promise<void> {
    await Promise.all([...(this.followConns.get(sessionId) ?? [])].map(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：conn（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(conn)，并按返回类型处理结果。
 */ conn => new Promise<void>(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolve（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(resolve)，并按返回类型处理结果。
 */ (resolve) => {
          conn.feed({ kind: 'frame', value: frame, delivered: resolve })
        })))
  }

  /** Push one Host-wide control update.
   * @remarks 中文说明：功能说明：处理 pushControl 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：frame（Exclude<SessionControlFrame, { type: 'baseline'
   * }>）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 使用示例：典型用法：在完成前置校验后调用 pushControl(frame)，并按返回类型处理结果。 */
  pushControl(frame: Exclude<SessionControlFrame, { type: 'baseline' }>): void {
    for (const /*
     * 变量说明：conn 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */ conn of [...this.controlConns]) conn.feed({ kind: 'frame', value: frame })
  }

  /** Push one Workspace projection increment.
   * @remarks 中文说明：功能说明：处理 pushWorkspace 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：frame（Exclude<WorkspaceFollowFrame, { type: 'baseline'
   * }>）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 使用示例：典型用法：在完成前置校验后调用 pushWorkspace(frame)，并按返回类型处理结果。 */
  pushWorkspace(frame: Exclude<WorkspaceFollowFrame, { type: 'baseline' }>): void {
    for (const /*
     * 变量说明：conn 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */ conn of [...this.workspaceConns]) conn.feed({ kind: 'frame', value: frame })
  }

  /** End (clean close) or fail (throw) every open stream — reconnect-path material.
   * @remarks 中文说明：功能说明：处理 endStreams 相关流程；使用场景由所在模块及调用位置决定。；返回值：void；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 endStreams()，并按返回类型处理结果。 */
  endStreams(): void {
    for (const /*
     * 变量说明：conns 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */ conns of this.followConns.values()) {
      for (const /*
       * 变量说明：conn 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
       */ conn of [...conns]) conn.feed({ kind: 'end' })
    }
    for (const /*
     * 变量说明：conn 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */ conn of [...this.controlConns]) conn.feed({ kind: 'end' })
    for (const /*
     * 变量说明：conn 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */ conn of [...this.workspaceConns]) conn.feed({ kind: 'end' })
  }

  /**
   * 功能说明：处理 failStreams 相关流程；使用场景由所在模块及调用位置决定。
   * @param error （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 failStreams(error)，并按返回类型处理结果。
   */
  failStreams(error: unknown): void {
    for (const /*
     * 变量说明：conns 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */ conns of this.followConns.values()) {
      for (const /*
       * 变量说明：conn 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
       */ conn of [...conns]) conn.feed({ kind: 'fail', error })
    }
    for (const /*
     * 变量说明：conn 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */ conn of [...this.controlConns]) conn.feed({ kind: 'fail', error })
    for (const /*
     * 变量说明：conn 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */ conn of [...this.workspaceConns]) conn.feed({ kind: 'fail', error })
  }

  /**
   * 功能说明：处理 callsOf 相关流程；使用场景由所在模块及调用位置决定。
   * @param method （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns unknown[]；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 callsOf(method)，并按返回类型处理结果。
   */
  callsOf(method: string): unknown[] {
    return this.calls.filter(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：c（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(c)，并按返回类型处理结果。
 */ c => c.method === method).map(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：c（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(c)，并按返回类型处理结果。
 */ c => c.payload)
  }

  /** Number of currently attached journal generations for one Session.
   * @remarks 中文说明：功能说明：处理 activeFollows 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：sessionId（SessionId）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：number；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 activeFollows(sessionId)，
   * 并按返回类型处理结果。 */
  activeFollows(sessionId: SessionId): number {
    return this.followConns.get(sessionId)?.length ?? 0
  }

  /**
   * 功能说明：处理 record 相关流程；使用场景由所在模块及调用位置决定。
   * @param method （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param payload （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param response （Promise<T>）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns Promise<T>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 record(method, payload, response)，并按返回类型处理结果。
   */
  private record<T>(method: string, payload: unknown, response: Promise<T>): Promise<T> {
    this.calls.push({ method, payload })
    return response
  }

  /**
   * 功能说明：处理 remoteResult 相关流程；使用场景由所在模块及调用位置决定。
   * @param method （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param payload （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param response （Promise<RpcResponse<T>>）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns Promise<RemoteResult<T>>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 remoteResult(method, payload, response)，并按返回类型处理结果。
   */
  private async remoteResult<T>(
    method: string,
    payload: unknown,
    response: Promise<RpcResponse<T>>,
  ): Promise<RemoteResult<T>> {
    return (await this.record(method, payload, response)).result
  }

  /**
   * 功能说明：处理 page 相关流程；使用场景由所在模块及调用位置决定。
   * @param request （SessionPageRequest）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。
   * @returns Promise<RemoteResult<SessionPage>>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 page(request)，并按返回类型处理结果。
   */
  private page(request: SessionPageRequest): Promise<RemoteResult<SessionPage>> {
    return this.fetchPage(request)
  }

  /**
   * 功能说明：请求 Page 相关流程；使用场景由所在模块及调用位置决定。
   * @param request （SessionPageRequest）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。
   * @param response （Promise<RpcResponse<SessionPage>>）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。
   * @returns Promise<RemoteResult<SessionPage>>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 fetchPage(request, response)，并按返回类型处理结果。
   */
  private async fetchPage(
    request: SessionPageRequest,
    response?: Promise<RpcResponse<SessionPage>>,
  ): Promise<RemoteResult<SessionPage>> {
    /**
     * 常量说明：sessionId 用于处理 sessionId 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const sessionId = addressSessionId(request.address)
    /**
     * 常量说明：payload 用于处理 payload 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const payload = request.address.kind === 'session'
      ? {
        sessionId,
        throughSeq: request.throughSeq,
        ...request.beforeSeq === undefined ? {} : { beforeSeq: request.beforeSeq },
        ...request.maxMessages === undefined ? {} : { maxMessages: request.maxMessages },
      }
      : {
        parentSessionId: request.address.parentSessionId,
        childSessionId: request.address.childSessionId,
        mode: request.address.mode,
        throughSeq: request.throughSeq,
        ...request.beforeSeq === undefined ? {} : { beforeSeq: request.beforeSeq },
        ...request.maxMessages === undefined ? {} : { maxMessages: request.maxMessages },
      }
    /**
     * 常量说明：method 用于处理 method 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const method = request.address.kind === 'session' ? 'session.history' : 'subagent.history'
    /**
     * 常量说明：result 用于处理 result 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const result = await this.remoteResult(method, payload, response ?? this.onHistory({
      sessionId,
      throughSeq: request.throughSeq,
      ...request.beforeSeq === undefined ? {} : { beforeSeq: request.beforeSeq },
      ...request.maxMessages === undefined ? {} : { maxMessages: request.maxMessages },
    }))
    if (!result.ok) return result
    return {
      ok: true,
      value: {
        ...result.value,
        records: result.value.records
          .filter(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：record（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(record)，并按返回类型处理结果。
 */ record => historyRecordLastSeq(record) <= request.throughSeq),
      },
    }
  }

  /**
   * 功能说明：打开 Follow 相关流程；使用场景由所在模块及调用位置决定。
   * @param request （SessionFollowRequest）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。
   * @param signal （AbortSignal）：传递取消或终止信号；必须满足声明的类型及调用时序要求。
   * @returns AsyncGenerator<SessionFollowFrame>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 openFollow(request, signal)，并按返回类型处理结果。
   */
  private async *openFollow(
    request: SessionFollowRequest,
    signal: AbortSignal = new AbortController().signal,
  ): AsyncGenerator<SessionFollowFrame> {
    /**
     * 常量说明：sessionId 用于处理 sessionId 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const sessionId = addressSessionId(request.address)
    this.followStarts.push(sessionId)
    this.calls.push({ method: 'session.follow', payload: request })
    /**
     * 常量说明：conns 用于处理 conns 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const conns = this.followConns.get(sessionId) ?? []
    if (!this.followConns.has(sessionId)) this.followConns.set(sessionId, conns)
    /**
     * 常量说明：stream 用于处理 stream 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const stream = this.openValueStream(conns, signal)
    try {
      /**
       * 常量说明：response 用于处理 response 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const response = await this.onHistory({
        sessionId,
        maxMessages: request.maxMessages ?? 50,
      })
      if (!response.result.ok) {
        throw new RemoteStreamError(
          response.result.error.code,
          response.result.error.message,
          response.result.error.details,
        )
      }
      /**
       * 常量说明：page 用于处理 page 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const page = response.result.value
      /**
       * 常量说明：tail 用于处理 tail 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const tail = page.records.at(-1)
      /**
       * 常量说明：cursor 用于处理 cursor 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const cursor = this.followCursor ?? (tail === undefined ? -1 : historyRecordLastSeq(tail))
      yield {
        type: 'snapshot',
        header: {
          version: 0,
          id: sessionId,
          createdAt: 0,
          ...(request.address.kind === 'subagent'
            ? { origin: 'subagent' as const, parentSession: request.address.parentSessionId }
            : {}),
        },
        cursor,
        records: page.records.filter(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：record（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(record)，并按返回类型处理结果。
 */ record => historyRecordLastSeq(record) <= cursor),
        hasMore: page.hasMore,
        projections: page.projections ?? { asOfSeq: cursor, values: {} },
      }
      yield* stream.values
    } finally {
      stream.dispose()
    }
  }

  /**
   * 功能说明：打开 Control 相关流程；使用场景由所在模块及调用位置决定。
   * @param signal （AbortSignal）：传递取消或终止信号；必须满足声明的类型及调用时序要求。
   * @returns AsyncGenerator<SessionControlFrame>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 openControl(signal)，并按返回类型处理结果。
   */
  private async *openControl(
    signal: AbortSignal = new AbortController().signal,
  ): AsyncGenerator<SessionControlFrame> {
    /**
     * 常量说明：stream 用于处理 stream 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const stream = this.openValueStream(this.controlConns, signal)
    try {
      yield { type: 'baseline', value: this.controlBaseline }
      yield* stream.values
    } finally {
      stream.dispose()
    }
  }

  /**
   * 功能说明：打开 Workspace 相关流程；使用场景由所在模块及调用位置决定。
   * @param signal （AbortSignal）：传递取消或终止信号；必须满足声明的类型及调用时序要求。
   * @returns AsyncGenerator<WorkspaceFollowFrame>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 openWorkspace(signal)，并按返回类型处理结果。
   */
  private async *openWorkspace(
    signal: AbortSignal = new AbortController().signal,
  ): AsyncGenerator<WorkspaceFollowFrame> {
    /**
     * 常量说明：stream 用于处理 stream 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const stream = this.openValueStream(this.workspaceConns, signal)
    try {
      yield { type: 'baseline', value: this.workspaceBaseline }
      yield* stream.values
    } finally {
      stream.dispose()
    }
  }

  /**
   * 功能说明：打开 Value Stream 相关流程；使用场景由所在模块及调用位置决定。
   * @param registry （ValueStreamConn<F>[]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param signal （AbortSignal）：传递取消或终止信号；必须满足声明的类型及调用时序要求。
   * @returns OpenValueStream<F>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 openValueStream(registry, signal)，并按返回类型处理结果。
   */
  private openValueStream<F>(
    registry: ValueStreamConn<F>[],
    signal: AbortSignal,
  ): OpenValueStream<F> {
    /**
     * 常量说明：inbox 用于处理 inbox 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const inbox: ValueStreamItem<F>[] = []
    /**
     * 变量说明：wake 用于处理 wake 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let wake: (() => void) | null = null
    /**
     * 变量说明：inFlightDelivered 用于处理 inFlightDelivered 相关数据，作用于当前作用域；其值可能随流程推进而变化，
     * 读写时需遵守声明类型和所在生命周期。
     */
    let inFlightDelivered: (() => void) | undefined
    /**
     * 变量说明：disposed 用于处理 disposed 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let disposed = false
    /**
     * 常量说明：conn 用于处理 conn 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const conn: ValueStreamConn<F> = {
      feed: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：item（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(item)，并按返回类型处理结果。
 */ (item) => {
        inbox.push(item)
        wake?.()
      },
    }
    registry.push(conn)
    /**
     * 常量说明：dispose 用于处理 dispose 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     * 功能说明：处理 dispose 相关流程；使用场景由所在模块及调用位置决定。
     * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 dispose()，并按返回类型处理结果。
     */
    const dispose = (): void => {
      if (disposed) return
      disposed = true
      inFlightDelivered?.()
      for (const /*
       * 变量说明：item 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
       */ item of inbox) {
        if (item.kind === 'frame') item.delivered?.()
      }
      /**
       * 常量说明：index 用于处理 index 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const index = registry.indexOf(conn)
      if (index >= 0) registry.splice(index, 1)
      wake?.()
    }
    /**
     * 常量说明：values 用于处理 values 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const values = (/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：AsyncGenerator<F>；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async function* (): AsyncGenerator<F> {
        try {
          while (!signal.aborted && !disposed) {
            while (inbox.length > 0) {
            /**
             * 常量说明：item 用于处理 item 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
             */
              const item = inbox.shift() as ValueStreamItem<F>
              if (item.kind === 'end') return
              if (item.kind === 'fail') throw item.error
              inFlightDelivered = item.delivered
              yield item.value
              inFlightDelivered?.()
              inFlightDelivered = undefined
            }
            await new Promise<void>(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolve（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(resolve)，并按返回类型处理结果。
 */ (resolve) => {
                wake = resolve
                signal.addEventListener('abort', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => { resolve() }, { once: true })
              })
            wake = null
          }
        } finally {
          dispose()
        }
      })()
    return { values, dispose }
  }

}
