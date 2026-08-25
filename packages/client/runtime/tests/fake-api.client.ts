// Test-local programmable IApiClient fake (NOT the fixture: fixture is a demo
// data source on a real clock; behavior tests need per-case responses and
// deferred-controlled timing). Streams are hand pumps: pushMux/pushHost.
/**
 * 文件职责：提供客户端运行时测试所需的会话 API 替身、可控响应和调用记录。
 * 技术维度：TypeScript 接口替身、Promise、Vitest 可编排函数与内存数据。
 * 产品维度：让会话管理器测试无需真实宿主即可覆盖成功、失败、并发和取消。
 * 逻辑维度：为每个 API 方法设置默认响应，记录调用，并允许用例替换处理函数或延迟结果。
 * 关键边界：测试替身不执行生产端校验；用例必须显式安排它要验证的异常行为。
 * 新手阅读建议：先看调用记录和默认数据，再看各 API 面，最后理解用例如何覆盖响应函数。
 */
import type {
  ClientResponse, HostFrame, IApiClient, ModelSelection, MuxFrame,
  RpcError, RpcReceipt, RpcRequest, RpcResponse, SessionId, SessionModels, SessionSearchItem, SkillEntry,
  WorkspaceId, WorkspaceView,
} from '@deepseek-ai/dsh-api-remotes/client'
import { RpcId } from '@deepseek-ai/dsh-client-connection/client'
import type { SessionRemotes } from '../src/client/sessions/remotes.ts'

/** Programmable-default workspace row (branded id, ISO-ish times). */
/* 中文说明：测试辅助函数 `fakeWorkspace`；参数含义见签名，返回值用于驱动或断言场景；例如按本文件中的调用位置使用。 */
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

/** 中文说明：类型 `Deferred` 约束本文件使用的数据字段和取值范围，避免调用方传入不完整状态。 */
export interface Deferred<T> {
  promise: Promise<T>
  resolve(value: T): void
  reject(error: unknown): void
}

/** Test-held settlement: the case decides when an RPC lands (history-pending injections etc.). */
/* 中文说明：测试辅助函数 `deferred`；参数含义见签名，返回值用于驱动或断言场景；例如按本文件中的调用位置使用。 */
export function deferred<T>(): Deferred<T> {
  /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `resolve` 是可调用函数，其参数与返回值见类型签名；例如由相邻流程调用。 */
  let resolve!: (value: T) => void
  /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `reject` 是可调用函数，其参数与返回值见类型签名；例如由相邻流程调用。 */
  let reject!: (error: unknown) => void
  /** 中文说明：协调异步执行顺序或保存待完成工作的 Promise；变量 `promise` 是可调用函数，其参数与返回值见类型签名；例如由相邻流程调用。 */
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/** 中文说明：当前测试场景使用的局部状态或中间值；变量 `nextRpc` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
let nextRpc = 0

/** 中文说明：测试辅助函数 `ok`；参数含义见签名，返回值用于驱动或断言场景；例如按本文件中的调用位置使用。 */
export function ok<T>(value: T): RpcResponse<T> {
  return { rpcId: RpcId(`fake-${nextRpc++}`), result: { ok: true, value } }
}

/** 中文说明：测试辅助函数 `err`；参数含义见签名，返回值用于驱动或断言场景；例如按本文件中的调用位置使用。 */
export function err<T>(error: RpcError): RpcResponse<T> {
  return { rpcId: RpcId(`fake-${nextRpc++}`), result: { ok: false, error } }
}

/** 中文说明：类型 `StreamItem` 约束本文件使用的数据字段和取值范围，避免调用方传入不完整状态。 */
type StreamItem<F> = { kind: 'frame'; envelope: RpcRequest<F> } | { kind: 'end' } | { kind: 'fail'; error: unknown }

/** 中文说明：类型 `StreamConn` 约束本文件使用的数据字段和取值范围，避免调用方传入不完整状态。 */
interface StreamConn<F> {
  feed(item: StreamItem<F>): void
}

/**
 * Commands Remote double: the generated face delivers the carrier's outcome, so
 * a test that programs nothing sees an empty catalog and an unmatched line.
 * @returns the Remote namespaces the session cluster calls.
 */
/* 中文说明：测试辅助函数 `fakeRemote`；参数含义见签名，返回值用于驱动或断言场景；例如按本文件中的调用位置使用。 */
export function fakeRemote(): SessionRemotes {
  return {
    commands: {
      list: () => Promise.resolve({ ok: true, value: [] }),
      execute: () => Promise.resolve({ ok: true, value: undefined }),
    },
  }
}

/** 中文说明：类 `FakeApiClient` 负责提供可控测试场景，实例由调用方创建并按生命周期释放。 */
export class FakeApiClient implements IApiClient {
  /** Chronological call record: [method, payload]. */
  /* 中文说明：类成员 `calls` 保存可编排行为或观测状态；取值范围由声明类型限定，并随实例生命周期使用。 */
  readonly calls: { method: string; payload: unknown }[] = []

  // Programmable slots (defaults answer OK-empty); reassign per case.
  /** 中文说明：类成员 `onList` 保存可编排行为或观测状态；取值范围由声明类型限定，并随实例生命周期使用。 */
  onList: (payload: unknown) => Promise<RpcResponse<{ items: never[] }>> = () => Promise.resolve(ok({ items: [] }))
  /** 中文说明：类成员 `onSearch` 保存可编排行为或观测状态；取值范围由声明类型限定，并随实例生命周期使用。 */
  onSearch: (payload: unknown) => Promise<RpcResponse<{ items: SessionSearchItem[]; hasMore: boolean }>> =
    () => Promise.resolve(ok({ items: [], hasMore: false }))
  /** 中文说明：类成员 `onCreate` 保存可编排行为或观测状态；取值范围由声明类型限定，并随实例生命周期使用。 */
  onCreate: (payload: unknown) => Promise<RpcResponse<{ sessionId: SessionId }>> = () => Promise.resolve(ok({ sessionId: 'fk-new' as SessionId }))
  /** 中文说明：类成员 `defaultModel` 保存可编排行为或观测状态；取值范围由声明类型限定，并随实例生命周期使用。 */
  readonly defaultModel: ModelSelection = { provider: 'deepseek-official', model: 'deepseek-v4-flash' }
  /** 中文说明：类成员 `onRename` 保存可编排行为或观测状态；取值范围由声明类型限定，并随实例生命周期使用。 */
  onRename: (payload: unknown) => Promise<RpcResponse<{ title: string; seq: number }>> = () => Promise.resolve(ok({ title: 'fk-renamed', seq: 0 }))
  /** 中文说明：类成员 `onFork` 保存可编排行为或观测状态；取值范围由声明类型限定，并随实例生命周期使用。 */
  onFork: (payload: unknown) => Promise<RpcResponse<{ sessionId: SessionId }>> = () => Promise.resolve(ok({ sessionId: 'fk-fork' as SessionId }))
  /** 中文说明：测试类方法 `onHistory`；参数含义见签名，返回值用于驱动或观察场景；例如由本类公开流程或下方用例调用。 */
  onHistory: (payload: { sessionId: SessionId; beforeSeq?: number; maxMessages?: number })
  => Promise<RpcResponse<{ events: never[]; hasMore: boolean }>> =
    () => Promise.resolve(ok({ events: [], hasMore: false }))

  /** 中文说明：类成员 `onModels` 保存可编排行为或观测状态；取值范围由声明类型限定，并随实例生命周期使用。 */
  onModels: (payload: unknown) => Promise<RpcResponse<SessionModels>> = () => Promise.resolve(ok({
    current: this.defaultModel,
    routable: true,
    groups: [{
      id: 'deepseek-official',
      name: 'DeepSeek',
      models: [{ id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash' }],
    }],
    failures: [],
  }))
  /** 中文说明：类成员 `onSelectModel` 保存可编排行为或观测状态；取值范围由声明类型限定，并随实例生命周期使用。 */
  onSelectModel: (payload: { provider: string; model: string }) =>
  Promise<RpcResponse<{ selected: ModelSelection }>> =
    payload => Promise.resolve(ok({ selected: { provider: payload.provider, model: payload.model } }))
  /** 中文说明：类成员 `onPrompt` 保存可编排行为或观测状态；取值范围由声明类型限定，并随实例生命周期使用。 */
  onPrompt: (payload: unknown) => Promise<RpcResponse<{ accepted: true }>> = () => Promise.resolve(ok({ accepted: true as const }))
  /** 中文说明：类成员 `onAttachment` 保存可编排行为或观测状态；取值范围由声明类型限定，并随实例生命周期使用。 */
  onAttachment: (payload: unknown) => Promise<RpcResponse<{ attachment: { attachmentId: never; mediaType: 'image/png'; bytes: number; width: number; height: number }; data: string }>> =
    () => Promise.resolve(ok({ attachment: { attachmentId: 'a' as never, mediaType: 'image/png', bytes: 1, width: 1, height: 1 }, data: 'AA==' }))
  /** 中文说明：类成员 `onUpdateQueue` 保存可编排行为或观测状态；取值范围由声明类型限定，并随实例生命周期使用。 */
  onUpdateQueue: (payload: unknown) => Promise<RpcResponse<{ accepted: true }>> = () => Promise.resolve(ok({ accepted: true as const }))
  /** 中文说明：类成员 `onCancel` 保存可编排行为或观测状态；取值范围由声明类型限定，并随实例生命周期使用。 */
  onCancel: (payload: unknown) => Promise<RpcResponse<{ accepted: true }>> = () => Promise.resolve(ok({ accepted: true as const }))

  /** 中文说明：类成员 `onDescribe` 保存可编排行为或观测状态；取值范围由声明类型限定，并随实例生命周期使用。 */
  onDescribe: (payload: unknown) => Promise<RpcResponse<{
    version: string
    cwd: string
    attachedSessions: number
    home: string
    canOpenPath: boolean
  }>> =
    () => Promise.resolve(ok({
      version: '0-fake', cwd: '/f', attachedSessions: 0, home: '/h', canOpenPath: true,
    }))
  /** 中文说明：类成员 `onPickDirectory` 保存可编排行为或观测状态；取值范围由声明类型限定，并随实例生命周期使用。 */
  onPickDirectory: (payload: unknown) => Promise<RpcResponse<{ path: string | null }>> =
    () => Promise.resolve(ok({ path: null }))
  /** 中文说明：类成员 `onOpenPath` 保存可编排行为或观测状态；取值范围由声明类型限定，并随实例生命周期使用。 */
  onOpenPath: (payload: unknown) => Promise<RpcResponse<{ opened: true }>> =
    () => Promise.resolve(ok({ opened: true as const }))

  /** 中文说明：类成员 `onListDirectory` 保存可编排行为或观测状态；取值范围由声明类型限定，并随实例生命周期使用。 */
  onListDirectory: (payload: unknown) => Promise<RpcResponse<{
    path: string
    home: string
    crumbs: { name: string; path: string; hidden: boolean }[]
    entries: { name: string; path: string; hidden: boolean }[]
    truncated: boolean
  }>> =
    () => Promise.resolve(ok({ path: '/home/fake', home: '/home/fake', crumbs: [{ name: '/', path: '/', hidden: false }], entries: [], truncated: false }))

  /** 中文说明：类成员 `onCreateDirectory` 保存可编排行为或观测状态；取值范围由声明类型限定，并随实例生命周期使用。 */
  onCreateDirectory: (payload: unknown) => Promise<RpcResponse<{ path: string }>> =
    () => Promise.resolve(ok({ path: '/home/fake/new' }))

  /** 中文说明：类成员 `muxConns` 保存可编排行为或观测状态；取值范围由声明类型限定，并随实例生命周期使用。 */
  private readonly muxConns: StreamConn<MuxFrame>[] = []
  /** 中文说明：类成员 `hostConns` 保存可编排行为或观测状态；取值范围由声明类型限定，并随实例生命周期使用。 */
  private readonly hostConns: StreamConn<HostFrame>[] = []
  /** 中文说明：类成员 `lastSearchSignal` 保存可编排行为或观测状态；取值范围由声明类型限定，并随实例生命周期使用。 */
  lastSearchSignal: AbortSignal | undefined

  // Parameters carry local structural annotations: the CI lint lane runs
  // without built lib/, so IApiClient's indexed-access types collapse to any
  // and inferred parameters would trip no-unsafe-argument.
  /** 中文说明：类成员 `sessions` 保存可编排行为或观测状态；取值范围由声明类型限定，并随实例生命周期使用。 */
  readonly sessions: IApiClient['sessions'] = {
    list: (payload: unknown) => this.record('session.list', payload, this.onList(payload)),
    search: (payload: unknown, signal?: AbortSignal) => {
      this.lastSearchSignal = signal
      return this.record('session.search', payload, this.onSearch(payload))
    },
    create: (payload: unknown) => this.record('session.create', payload, this.onCreate(payload)),
    history: (payload: { sessionId: SessionId; beforeSeq?: number; maxMessages?: number }) =>
      this.record('session.history', payload, this.onHistory(payload)),
    models: (payload: unknown) => this.record('session.models', payload, this.onModels(payload)),
    selectModel: (payload: { provider: string; model: string }) =>
      this.record('session.selectModel', payload, this.onSelectModel(payload)),
    rename: (payload: unknown) => this.record('session.rename', payload, this.onRename(payload)),
    fork: (payload: unknown) => this.record('session.fork', payload, this.onFork(payload)),
    prompt: (payload: unknown) => this.record('session.prompt', payload, this.onPrompt(payload)),
    attachment: (payload: unknown) => this.record('session.attachment', payload, this.onAttachment(payload)),
    updateQueue: (payload: unknown) => this.record('session.updateQueue', payload, this.onUpdateQueue(payload)),
    cancel: (payload: unknown) => this.record('session.cancel', payload, this.onCancel(payload)),
  }

  /** 中文说明：类成员 `onSubagentList` 保存可编排行为或观测状态；取值范围由声明类型限定，并随实例生命周期使用。 */
  onSubagentList: (payload: unknown) => Promise<RpcResponse<{ entries: never[]; parentAvailable: boolean }>>
    = () => Promise.resolve(ok({ entries: [], parentAvailable: true }))
  /** 中文说明：类成员 `onSubagentHistory` 保存可编排行为或观测状态；取值范围由声明类型限定，并随实例生命周期使用。 */
  onSubagentHistory: (payload: unknown) => Promise<RpcResponse<{ events: never[]; hasMore: boolean }>>
    = () => Promise.resolve(ok({ events: [], hasMore: false }))
  /** 中文说明：类成员 `onSubagentPrompt` 保存可编排行为或观测状态；取值范围由声明类型限定，并随实例生命周期使用。 */
  onSubagentPrompt: (payload: unknown) => Promise<RpcResponse<{ messageId: never }>>
    = () => Promise.resolve(ok({ messageId: 'fake-message' as never }))

  /** 中文说明：类成员 `onSubagentInterrupt` 保存可编排行为或观测状态；取值范围由声明类型限定，并随实例生命周期使用。 */
  onSubagentInterrupt: (payload: unknown) => Promise<RpcResponse<{ accepted: true }>>
    = () => Promise.resolve(ok({ accepted: true as const }))

  /** 中文说明：类成员 `subagents` 保存可编排行为或观测状态；取值范围由声明类型限定，并随实例生命周期使用。 */
  readonly subagents: IApiClient['subagents'] = {
    list: (payload: unknown) => this.record('subagent.list', payload, this.onSubagentList(payload)),
    history: (payload: unknown) => this.record('subagent.history', payload, this.onSubagentHistory(payload)),
    prompt: (payload: unknown) => this.record('subagent.prompt', payload, this.onSubagentPrompt(payload)),
    interrupt: (payload: unknown) => this.record('subagent.interrupt', payload, this.onSubagentInterrupt(payload)),
  }

  /** 中文说明：类成员 `host` 保存可编排行为或观测状态；取值范围由声明类型限定，并随实例生命周期使用。 */
  readonly host: IApiClient['host'] = {
    describe: (payload: unknown) => this.record('host.describe', payload, this.onDescribe(payload)),
    pickDirectory: (payload: unknown) => this.record('host.pickDirectory', payload, this.onPickDirectory(payload)),
    listDirectory: (payload: unknown) => this.record('host.listDirectory', payload, this.onListDirectory(payload)),
    createDirectory: (payload: unknown) => this.record('host.createDirectory', payload, this.onCreateDirectory(payload)),
    openPath: (payload: unknown) => this.record('host.openPath', payload, this.onOpenPath(payload)),
  }

  // The archive-set field defaults at the binding below so list stubs keep
  // the pre-archive `{ items }` shape; a stub carrying the field wins.
  /** 中文说明：类成员 `onWorkspaceList` 保存可编排行为或观测状态；取值范围由声明类型限定，并随实例生命周期使用。 */
  onWorkspaceList: (payload: unknown) => Promise<RpcResponse<{ items: never[]; archivedSessionIds?: never[] }>> =
    () => Promise.resolve(ok({ items: [] }))
  /** 中文说明：类成员 `onWorkspaceCreate` 保存可编排行为或观测状态；取值范围由声明类型限定，并随实例生命周期使用。 */
  onWorkspaceCreate: (payload: unknown) => Promise<RpcResponse<{ workspace: WorkspaceView; created: boolean }>> =
    () => Promise.resolve(ok({ workspace: fakeWorkspace('fk-ws'), created: true }))

  /** 中文说明：类成员 `onWorkspaceRename` 保存可编排行为或观测状态；取值范围由声明类型限定，并随实例生命周期使用。 */
  onWorkspaceRename: (payload: unknown) => Promise<RpcResponse<{ workspace: WorkspaceView }>> =
    () => Promise.resolve(ok({ workspace: fakeWorkspace('fk-ws') }))

  /** 中文说明：类成员 `onWorkspaceDelete` 保存可编排行为或观测状态；取值范围由声明类型限定，并随实例生命周期使用。 */
  onWorkspaceDelete: (payload: unknown) => Promise<RpcResponse<{ deleted: true }>> =
    () => Promise.resolve(ok({ deleted: true }))

  /** 中文说明：类成员 `onWorkspaceInsertBefore` 保存可编排行为或观测状态；取值范围由声明类型限定，并随实例生命周期使用。 */
  onWorkspaceInsertBefore: (payload: unknown) => Promise<RpcResponse<{ workspaceIds: WorkspaceId[] }>> =
    () => Promise.resolve(ok({ workspaceIds: [] }))

  /** 中文说明：类成员 `onWorkspaceInsertSessionBefore` 保存可编排行为或观测状态；取值范围由声明类型限定，并随实例生命周期使用。 */
  onWorkspaceInsertSessionBefore: (payload: unknown) => Promise<RpcResponse<{ workspace: WorkspaceView }>> =
    () => Promise.resolve(ok({ workspace: fakeWorkspace('fk-ws') }))

  /** 中文说明：类成员 `onWorkspaceArchiveSession` 保存可编排行为或观测状态；取值范围由声明类型限定，并随实例生命周期使用。 */
  onWorkspaceArchiveSession: (payload: unknown) => Promise<RpcResponse<{ archivedSessionIds: SessionId[] }>> =
    payload => Promise.resolve(ok({ archivedSessionIds: [(payload as { sessionId: SessionId }).sessionId] }))

  /** 中文说明：类成员 `workspace` 保存可编排行为或观测状态；取值范围由声明类型限定，并随实例生命周期使用。 */
  readonly workspace: IApiClient['workspace'] = {
    list: (payload: unknown) => this.record('workspace.list', payload, this.onWorkspaceList(payload).then(response => (
      response.result.ok
        ? { ...response, result: { ok: true as const, value: { archivedSessionIds: [] as never[], ...response.result.value } } }
        : response
    )) as ReturnType<IApiClient['workspace']['list']>),
    create: (payload: unknown) => this.record('workspace.create', payload, this.onWorkspaceCreate(payload)),
    rename: (payload: unknown) => this.record('workspace.rename', payload, this.onWorkspaceRename(payload)),
    delete: (payload: unknown) => this.record('workspace.delete', payload, this.onWorkspaceDelete(payload)),
    insertBefore: (payload: unknown) =>
      this.record('workspace.insertBefore', payload, this.onWorkspaceInsertBefore(payload)),
    insertSessionBefore: (payload: unknown) =>
      this.record('workspace.insertSessionBefore', payload, this.onWorkspaceInsertSessionBefore(payload)),
    archiveSession: (payload: unknown) =>
      this.record('workspace.archiveSession', payload, this.onWorkspaceArchiveSession(payload)),
  }

  // Payloads stay `unknown` (lint-lane note above); response rows are the real
  // wire shapes so cases can program requires-bearing catalogs and dual-address
  // skill lists without casts.
  /** 中文说明：类成员 `onSkillList` 保存可编排行为或观测状态；取值范围由声明类型限定，并随实例生命周期使用。 */
  onSkillList: (payload: unknown) => Promise<RpcResponse<{ skills: SkillEntry[] }>>
    = () => Promise.resolve(ok({ skills: [] }))


  /** 中文说明：类成员 `agentPresets` 保存可编排行为或观测状态；取值范围由声明类型限定，并随实例生命周期使用。 */
  readonly agentPresets: IApiClient['agentPresets'] = {
    list: (payload: unknown) => this.record('agentPreset.list', payload, Promise.resolve(ok({ presets: [], authorable: false, hasDocument: false }))),
    select: (payload: { agentPreset: string }) =>
      this.record('agentPreset.select', payload, Promise.resolve(ok({ agentPreset: payload.agentPreset }))),
    read: (payload: { agentPreset: string }) =>
      this.record('agentPreset.read', payload, Promise.resolve(ok({
        agentPreset: payload.agentPreset, trust: 'user' as const, content: '',
      }))),
    copy: (payload: { agentPreset: string }) =>
      this.record('agentPreset.copy', payload, Promise.resolve(ok({ agentPreset: payload.agentPreset }))),
    openDocument: (payload: { agentPreset: string }) =>
      this.record('agentPreset.openDocument', payload, Promise.resolve(ok({ opened: true as const }))),
    remove: (payload: { agentPreset: string }) =>
      this.record('agentPreset.remove', payload, Promise.resolve(ok({}))),
  }

  /** 中文说明：类成员 `skills` 保存可编排行为或观测状态；取值范围由声明类型限定，并随实例生命周期使用。 */
  readonly skills: IApiClient['skills'] = {
    list: (payload: unknown) => this.record('skill.list', payload, this.onSkillList(payload)),
  }

  /** 中文说明：类成员 `goals` 保存可编排行为或观测状态；取值范围由声明类型限定，并随实例生命周期使用。 */
  readonly goals: IApiClient['goals'] = {
    create: payload => this.record('goal.create', payload, Promise.resolve(ok({ ref: { id: 'fake-goal' as never, revision: 1 } }))),
    edit: payload => this.record('goal.edit', payload, Promise.resolve(ok({ ref: { id: 'fake-goal' as never, revision: 1 } }))),
    pause: payload => this.record('goal.pause', payload, Promise.resolve(ok({ ref: { id: 'fake-goal' as never, revision: 1 } }))),
    resume: payload => this.record('goal.resume', payload, Promise.resolve(ok({ ref: { id: 'fake-goal' as never, revision: 1 } }))),
    complete: payload => this.record('goal.complete', payload, Promise.resolve(ok({ ref: { id: 'fake-goal' as never, revision: 1 } }))),
    clear: payload => this.record('goal.clear', payload, Promise.resolve(ok({ cleared: true as const }))),
  }

  /** 中文说明：类成员 `settings` 保存可编排行为或观测状态；取值范围由声明类型限定，并随实例生命周期使用。 */
  readonly settings: IApiClient['settings'] = {
    describe: payload => this.record('settings.describe', payload, Promise.resolve(ok({ writable: true, hasDocument: false, namespaces: [] }))),
    openDocument: payload => this.record('settings.openDocument', payload, Promise.resolve(ok({ opened: true as const }))),
    update: payload => this.record('settings.update', payload, Promise.resolve(ok({ ns: 'fake', schema: {}, value: {}, applies: 'live' as const, secrets: [], revision: 0 }))),
    replace: payload => this.record('settings.replace', payload, Promise.resolve(ok({ ns: 'fake', schema: {}, value: {}, applies: 'live' as const, secrets: [], revision: 0 }))),
    mutate: payload => this.record('settings.mutate', payload, Promise.resolve(ok({ ns: 'fake', schema: {}, value: {}, applies: 'live' as const, secrets: [], revision: 0 }))),
  }

  /** 中文说明：类成员 `credentials` 保存可编排行为或观测状态；取值范围由声明类型限定，并随实例生命周期使用。 */
  readonly credentials: IApiClient['credentials'] = {
    describe: payload => this.record('credentials.describe', payload, Promise.resolve(ok({ credentials: {} }))),
    set: payload => this.record('credentials.set', payload, Promise.resolve(ok({}))),
    unset: payload => this.record('credentials.unset', payload, Promise.resolve(ok({}))),
  }

  /** 中文说明：类成员 `llm` 保存可编排行为或观测状态；取值范围由声明类型限定，并随实例生命周期使用。 */
  readonly llm: IApiClient['llm'] = {
    providers: payload => this.record('llm.providers', payload, Promise.resolve(ok({ providers: [] }))),
    models: payload => this.record('llm.models', payload, Promise.resolve(ok({ groups: [], failures: [] }))),
    discoverModels: payload => this.record('llm.discoverModels', payload, Promise.resolve(ok({ models: [] }))),
  }

  /** When true, streams never fire onOpen (misbehaving-carrier material for the handshake timeout guard). */
  /* 中文说明：类成员 `suppressStreamOpen` 保存可编排行为或观测状态；取值范围由声明类型限定，并随实例生命周期使用。 */
  suppressStreamOpen = false

  /** When true, onOpen callbacks are parked instead of fired; releaseStreamOpens() fires them.
   *  Lets a case hold the readiness handshake open (describe done, streams not yet "established"). */
  /* 中文说明：类成员 `holdStreamOpen` 保存可编排行为或观测状态；取值范围由声明类型限定，并随实例生命周期使用。 */
  holdStreamOpen = false
  /** 中文说明：类成员 `heldOpens` 保存可编排行为或观测状态；取值范围由声明类型限定，并随实例生命周期使用。 */
  private heldOpens: (() => void)[] = []

  /** 中文说明：测试类方法 `releaseStreamOpens`；参数含义见签名，返回值用于驱动或观察场景；例如由本类公开流程或下方用例调用。 */
  releaseStreamOpens(): void {
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `held` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const held = this.heldOpens
    this.heldOpens = []
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `fire` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    for (const fire of held) fire()
  }

  /** 中文说明：类成员 `events` 保存可编排行为或观测状态；取值范围由声明类型限定，并随实例生命周期使用。 */
  readonly events: IApiClient['events'] = {
    mux: (_payload: unknown, signal: AbortSignal, onOpen?: () => void) => this.openStream(this.muxConns, signal, onOpen),
    host: (_payload: unknown, signal: AbortSignal, onOpen?: () => void) => this.openStream(this.hostConns, signal, onOpen),
  }

  /** 中文说明：类成员 `onRespond` 保存可编排行为或观测状态；取值范围由声明类型限定，并随实例生命周期使用。 */
  onRespond: (message: ClientResponse) => Promise<RpcReceipt> = () => Promise.resolve({ accepted: true })

  /** 中文说明：测试类方法 `respond`；参数含义见签名，返回值用于驱动或观察场景；例如由本类公开流程或下方用例调用。 */
  respond(message: ClientResponse): Promise<RpcReceipt> {
    return this.record('respond', message, this.onRespond(message))
  }

  /** Push one mux frame to every open mux stream (rpcId minted unless pinned by the case). */
  /* 中文说明：测试类方法 `pushMux`；参数含义见签名，返回值用于驱动或观察场景；例如由本类公开流程或下方用例调用。 */
  pushMux(frame: MuxFrame, rpcId?: string): void {
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `conn` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    for (const conn of [...this.muxConns]) conn.feed({ kind: 'frame', envelope: { rpcId: RpcId(rpcId ?? `push-${nextRpc++}`), payload: frame } })
  }

  /** 中文说明：测试类方法 `pushHost`；参数含义见签名，返回值用于驱动或观察场景；例如由本类公开流程或下方用例调用。 */
  pushHost(frame: HostFrame, rpcId?: string): void {
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `conn` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    for (const conn of [...this.hostConns]) conn.feed({ kind: 'frame', envelope: { rpcId: RpcId(rpcId ?? `push-${nextRpc++}`), payload: frame } })
  }

  /** End (clean close) or fail (throw) every open stream — reconnect-path material. */
  /* 中文说明：测试类方法 `endStreams`；参数含义见签名，返回值用于驱动或观察场景；例如由本类公开流程或下方用例调用。 */
  endStreams(): void {
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `conn` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    for (const conn of [...this.muxConns, ...this.hostConns]) conn.feed({ kind: 'end' })
  }

  /** 中文说明：测试类方法 `failStreams`；参数含义见签名，返回值用于驱动或观察场景；例如由本类公开流程或下方用例调用。 */
  failStreams(error: unknown): void {
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `conn` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    for (const conn of [...this.muxConns, ...this.hostConns]) conn.feed({ kind: 'fail', error })
  }

  /** 中文说明：测试类方法 `openMuxCount`；参数含义见签名，返回值用于驱动或观察场景；例如由本类公开流程或下方用例调用。 */
  get openMuxCount(): number {
    return this.muxConns.length
  }

  /** 中文说明：测试类方法 `callsOf`；参数含义见签名，返回值用于驱动或观察场景；例如由本类公开流程或下方用例调用。 */
  callsOf(method: string): unknown[] {
    return this.calls.filter(c => c.method === method).map(c => c.payload)
  }

  private record<T>(method: string, payload: unknown, response: Promise<T>): Promise<T> {
    this.calls.push({ method, payload })
    return response
  }

  private async *openStream<F>(registry: StreamConn<F>[], signal: AbortSignal, onOpen?: () => void): AsyncGenerator<RpcRequest<F>> {
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `inbox` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const inbox: StreamItem<F>[] = []
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `wake` 是可调用函数，其参数与返回值见类型签名；例如由相邻流程调用。 */
    let wake: (() => void) | null = null
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `conn` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const conn: StreamConn<F> = {
      feed: (item) => {
        inbox.push(item)
        wake?.()
      },
    }
    registry.push(conn)
    if (this.holdStreamOpen && onOpen !== undefined) this.heldOpens.push(onOpen)
    else if (!this.suppressStreamOpen) onOpen?.()
    try {
      while (!signal.aborted) {
        while (inbox.length > 0) {
          /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `item` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
          const item = inbox.shift() as StreamItem<F>
          if (item.kind === 'end') return
          if (item.kind === 'fail') throw item.error
          yield item.envelope
        }
        await new Promise<void>((resolve) => {
          wake = resolve
          signal.addEventListener('abort', () => { resolve() }, { once: true })
        })
        wake = null
      }
    } finally {
      registry.splice(registry.indexOf(conn), 1)
    }
  }
}
