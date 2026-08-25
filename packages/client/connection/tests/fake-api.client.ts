/**
 * 文件职责：提供连接层测试使用的可编排假 API 客户端、延迟对象和事件流控制能力。
 * 技术维度：TypeScript 泛型、Promise、异步生成器、队列和 AbortSignal。
 * 产品维度：让连接生命周期测试无需真实网络即可精确制造成功、失败、挂起、断流和重连。
 * 逻辑维度：记录 RPC 调用，按队列返回预设响应；事件流用收件箱与唤醒函数向生成器交付帧。
 * 关键边界：这是测试替身而非生产实现；未安排的行为可能使用默认结果，使用后应检查记录。
 * 新手阅读建议：先读 Deferred 和 ok，再看 FakeApiClient 的公开控制字段，最后理解 stream 的队列循环。
 */
// Test-local programmable IApiClient fake (NOT the fixture: fixture is a demo
// data source on a real clock; behavior tests need per-case responses and
// deferred-controlled timing). Streams are hand pumps: pushMux/pushHost.
/** 文件职责：提供可编排假 API。技术维度：Promise、异步生成器与队列。产品维度：无网络验证连接行为。逻辑维度：记录调用并泵送预设帧。关键边界：仅限测试且需显式安排行为。新手阅读建议：先读公开控制字段再读 stream。 */
import type {
  HostFrame, IApiClient, ModelSelection, MuxFrame,
  RpcRequest, RpcResponse, SessionId, SessionModels, SessionSearchItem, SkillEntry, WorkspaceId,
} from '../src/client/api.ts'
import { RpcId } from '../src/client/api.ts'

/** 中文说明：测试类型 `Deferred`，约束本文件夹具或观测值的字段，避免模拟数据偏离生产接口。 */
export interface Deferred<T> {
  promise: Promise<T>
  resolve(value: T): void
  reject(error: unknown): void
}

/** Test-held settlement: the case decides when an RPC lands (history-pending injections etc.). */
/* 中文说明：测试辅助函数 `deferred`；参数含义见签名，返回值供当前场景驱动或断言；例如按下方测试调用方式使用。 */
export function deferred<T>(): Deferred<T> {
  /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `resolve` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
  let resolve!: (value: T) => void
  /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `reject` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
  let reject!: (error: unknown) => void
  /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `promise` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/** 中文说明：当前场景驱动的连接或 API 测试对象；变量 `nextRpc` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
let nextRpc = 0

/** 中文说明：测试辅助函数 `ok`；参数含义见签名，返回值供当前场景驱动或断言；例如按下方测试调用方式使用。 */
export function ok<T>(value: T): RpcResponse<T> {
  return { rpcId: RpcId(`fake-${nextRpc++}`), result: { ok: true, value } }
}


/** 中文说明：测试类型 `StreamItem`，约束本文件夹具或观测值的字段，避免模拟数据偏离生产接口。 */
type StreamItem<F> = { kind: 'frame'; envelope: RpcRequest<F> } | { kind: 'end' } | { kind: 'fail'; error: unknown }

/** 中文说明：测试类型 `StreamConn`，约束本文件夹具或观测值的字段，避免模拟数据偏离生产接口。 */
interface StreamConn<F> {
  feed(item: StreamItem<F>): void
}

/** 中文说明：测试类 `FakeApiClient`，模拟连接层依赖并公开可控状态，供本文件场景实例化使用。 */
export class FakeApiClient implements IApiClient {
  /** Chronological call record: [method, payload]. */
  /* 中文说明：测试类成员 `calls`，保存可编排行为或观测状态；取值范围由声明类型限定，仅供连接层测试使用。 */
  readonly calls: { method: string; payload: unknown }[] = []

  // Programmable slots (defaults answer OK-empty); reassign per case.
  /** 中文说明：测试类成员 `onList`，保存可编排行为或观测状态；取值范围由声明类型限定，仅供连接层测试使用。 */
  onList: (payload: unknown) => Promise<RpcResponse<{ items: never[] }>> = () => Promise.resolve(ok({ items: [] }))
  /** 中文说明：测试类成员 `onSearch`，保存可编排行为或观测状态；取值范围由声明类型限定，仅供连接层测试使用。 */
  onSearch: (payload: unknown) => Promise<RpcResponse<{ items: SessionSearchItem[]; hasMore: boolean }>> =
    () => Promise.resolve(ok({ items: [], hasMore: false }))
  /** 中文说明：测试类成员 `onCreate`，保存可编排行为或观测状态；取值范围由声明类型限定，仅供连接层测试使用。 */
  onCreate: (payload: unknown) => Promise<RpcResponse<{ sessionId: SessionId }>> = () => Promise.resolve(ok({ sessionId: 'fk-new' as SessionId }))
  /** 中文说明：测试类成员 `onRename`，保存可编排行为或观测状态；取值范围由声明类型限定，仅供连接层测试使用。 */
  onRename: (payload: unknown) => Promise<RpcResponse<{ title: string; seq: number }>> = () => Promise.resolve(ok({ title: 'fk-renamed', seq: 0 }))
  /** 中文说明：测试类成员 `onFork`，保存可编排行为或观测状态；取值范围由声明类型限定，仅供连接层测试使用。 */
  onFork: (payload: unknown) => Promise<RpcResponse<{ sessionId: SessionId }>> = () => Promise.resolve(ok({ sessionId: 'fk-fork' as SessionId }))
  /** 中文说明：测试类方法 `onHistory`；参数含义见签名，返回值用于驱动或观察当前场景；例如按下方用例的调用方式使用。 */
  onHistory: (payload: { sessionId: SessionId; beforeSeq?: number; maxMessages?: number })
  => Promise<RpcResponse<{ events: never[]; hasMore: boolean; modelSelection: ModelSelection }>> =
    () => Promise.resolve(ok({
      events: [],
      hasMore: false,
      modelSelection: { provider: 'deepseek-official', model: 'deepseek-chat' },
    }))

  /** 中文说明：测试类成员 `onModels`，保存可编排行为或观测状态；取值范围由声明类型限定，仅供连接层测试使用。 */
  onModels: (payload: unknown) => Promise<RpcResponse<SessionModels>> = () => Promise.resolve(ok({
    current: { provider: 'deepseek-official', model: 'deepseek-chat' },
    routable: true,
    groups: [],
    failures: [],
  }))
  /** 中文说明：测试类方法 `onSelectModel`；参数含义见签名，返回值用于驱动或观察当前场景；例如按下方用例的调用方式使用。 */
  onSelectModel: (payload: ModelSelection & { sessionId: SessionId })
  => Promise<RpcResponse<{ selected: ModelSelection }>> =
    payload => Promise.resolve(ok({ selected: { provider: payload.provider, model: payload.model } }))
  /** 中文说明：测试类成员 `onPrompt`，保存可编排行为或观测状态；取值范围由声明类型限定，仅供连接层测试使用。 */
  onPrompt: (payload: unknown) => Promise<RpcResponse<{ accepted: true }>> = () => Promise.resolve(ok({ accepted: true as const }))
  /** 中文说明：测试类成员 `onAttachment`，保存可编排行为或观测状态；取值范围由声明类型限定，仅供连接层测试使用。 */
  onAttachment: (payload: unknown) => Promise<RpcResponse<{ attachment: { attachmentId: never; mediaType: 'image/png'; bytes: number; width: number; height: number }; data: string }>> =
    () => Promise.resolve(ok({ attachment: { attachmentId: 'a' as never, mediaType: 'image/png', bytes: 1, width: 1, height: 1 }, data: 'AA==' }))
  /** 中文说明：测试类成员 `onUpdateQueue`，保存可编排行为或观测状态；取值范围由声明类型限定，仅供连接层测试使用。 */
  onUpdateQueue: (payload: unknown) => Promise<RpcResponse<{ accepted: true }>> = () => Promise.resolve(ok({ accepted: true as const }))
  /** 中文说明：测试类成员 `onCancel`，保存可编排行为或观测状态；取值范围由声明类型限定，仅供连接层测试使用。 */
  onCancel: (payload: unknown) => Promise<RpcResponse<{ accepted: true }>> = () => Promise.resolve(ok({ accepted: true as const }))
  /** 中文说明：测试类成员 `onDescribe`，保存可编排行为或观测状态；取值范围由声明类型限定，仅供连接层测试使用。 */
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
  /** 中文说明：测试类成员 `onPickDirectory`，保存可编排行为或观测状态；取值范围由声明类型限定，仅供连接层测试使用。 */
  onPickDirectory: (payload: unknown) => Promise<RpcResponse<{ path: string | null }>> =
    () => Promise.resolve(ok({ path: null }))
  /** 中文说明：测试类成员 `onOpenPath`，保存可编排行为或观测状态；取值范围由声明类型限定，仅供连接层测试使用。 */
  onOpenPath: (payload: unknown) => Promise<RpcResponse<{ opened: true }>> =
    () => Promise.resolve(ok({ opened: true as const }))

  /** 中文说明：测试类成员 `onListDirectory`，保存可编排行为或观测状态；取值范围由声明类型限定，仅供连接层测试使用。 */
  onListDirectory: (payload: unknown) => Promise<RpcResponse<{
    path: string
    home: string
    crumbs: { name: string; path: string; hidden: boolean }[]
    entries: { name: string; path: string; hidden: boolean }[]
    truncated: boolean
  }>> =
    () => Promise.resolve(ok({ path: '/home/fake', home: '/home/fake', crumbs: [{ name: '/', path: '/', hidden: false }], entries: [], truncated: false }))

  /** 中文说明：测试类成员 `onCreateDirectory`，保存可编排行为或观测状态；取值范围由声明类型限定，仅供连接层测试使用。 */
  onCreateDirectory: (payload: unknown) => Promise<RpcResponse<{ path: string }>> =
    () => Promise.resolve(ok({ path: '/home/fake/new' }))

  /** 中文说明：测试类成员 `muxConns`，保存可编排行为或观测状态；取值范围由声明类型限定，仅供连接层测试使用。 */
  private readonly muxConns: StreamConn<MuxFrame>[] = []
  /** 中文说明：测试类成员 `hostConns`，保存可编排行为或观测状态；取值范围由声明类型限定，仅供连接层测试使用。 */
  private readonly hostConns: StreamConn<HostFrame>[] = []
  /** 中文说明：测试类成员 `lastSearchSignal`，保存可编排行为或观测状态；取值范围由声明类型限定，仅供连接层测试使用。 */
  lastSearchSignal: AbortSignal | undefined

  // Parameter annotations below are local structural types on purpose: the CI
  // lint lane runs without built artifacts, where IApiClient's wire types
  // (apiproxy subpath) resolve to any and inferred params trip no-unsafe-argument.
  /** 中文说明：测试类成员 `sessions`，保存可编排行为或观测状态；取值范围由声明类型限定，仅供连接层测试使用。 */
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
    selectModel: (payload: ModelSelection & { sessionId: SessionId }) =>
      this.record('session.selectModel', payload, this.onSelectModel(payload)),
    rename: (payload: unknown) => this.record('session.rename', payload, this.onRename(payload)),
    fork: (payload: unknown) => this.record('session.fork', payload, this.onFork(payload)),
    prompt: (payload: unknown) => this.record('session.prompt', payload, this.onPrompt(payload)),
    attachment: (payload: unknown) => this.record('session.attachment', payload, this.onAttachment(payload)),
    updateQueue: (payload: unknown) => this.record('session.updateQueue', payload, this.onUpdateQueue(payload)),
    cancel: (payload: unknown) => this.record('session.cancel', payload, this.onCancel(payload)),
  }

  /** 中文说明：测试类成员 `subagents`，保存可编排行为或观测状态；取值范围由声明类型限定，仅供连接层测试使用。 */
  readonly subagents: IApiClient['subagents'] = {
    list: (payload: unknown) => this.record('subagent.list', payload, Promise.resolve(ok({
      entries: [],
      parentAvailable: true,
    }))),
    history: (payload: unknown) => this.record('subagent.history', payload, Promise.resolve(ok({
      events: [],
      hasMore: false,
    }))),
    prompt: (payload: unknown) => this.record('subagent.prompt', payload, Promise.resolve(ok({
      messageId: 'fake-message' as never,
    }))),
    interrupt: (payload: unknown) => this.record('subagent.interrupt', payload, Promise.resolve(ok({
      accepted: true as const,
    }))),
  }

  /** 中文说明：测试类成员 `host`，保存可编排行为或观测状态；取值范围由声明类型限定，仅供连接层测试使用。 */
  readonly host: IApiClient['host'] = {
    describe: payload => this.record('host.describe', payload, this.onDescribe(payload)),
    pickDirectory: payload => this.record('host.pickDirectory', payload, this.onPickDirectory(payload)),
    listDirectory: payload => this.record('host.listDirectory', payload, this.onListDirectory(payload)),
    createDirectory: payload => this.record('host.createDirectory', payload, this.onCreateDirectory(payload)),
    openPath: payload => this.record('host.openPath', payload, this.onOpenPath(payload)),
  }

  /** 中文说明：测试类成员 `workspace`，保存可编排行为或观测状态；取值范围由声明类型限定，仅供连接层测试使用。 */
  readonly workspace: IApiClient['workspace'] = {
    list: (payload: unknown) => this.record('workspace.list', payload, Promise.resolve(ok({ items: [], archivedSessionIds: [] }))),
    create: (payload: unknown) => this.record('workspace.create', payload, Promise.resolve(ok({
      workspace: { workspaceId: 'fk-ws' as never, path: '/f/ws', title: 'ws', sessionIds: [], createdAt: '0', updatedAt: '0' },
      created: true,
    }))),
    rename: (payload: unknown) => this.record('workspace.rename', payload, Promise.resolve(ok({
      workspace: { workspaceId: 'fk-ws' as never, path: '/f/ws', title: 'ws', sessionIds: [], createdAt: '0', updatedAt: '0' },
    }))),
    delete: (payload: unknown) => this.record('workspace.delete', payload, Promise.resolve(ok({ deleted: true as const }))),
    insertBefore: (payload: unknown) => this.record('workspace.insertBefore', payload, Promise.resolve(ok({
      workspaceIds: [(payload as { workspaceId: WorkspaceId }).workspaceId],
    }))),
    insertSessionBefore: (payload: unknown) => this.record('workspace.insertSessionBefore', payload, Promise.resolve(ok({
      workspace: { workspaceId: 'fk-ws' as never, path: '/f/ws', title: 'ws', sessionIds: [], createdAt: '0', updatedAt: '0' },
    }))),
    archiveSession: (payload: unknown) => this.record('workspace.archiveSession', payload, Promise.resolve(ok({
      archivedSessionIds: [(payload as { sessionId: SessionId }).sessionId],
    }))),
  }

  // Payloads stay `unknown` (lint-lane note above); response rows are the real
  // wire shapes so cases can program catalogs and skill lists without casts.
  /** 中文说明：测试类成员 `onSkillList`，保存可编排行为或观测状态；取值范围由声明类型限定，仅供连接层测试使用。 */
  onSkillList: (payload: unknown) => Promise<RpcResponse<{ skills: SkillEntry[] }>>
    = () => Promise.resolve(ok({ skills: [] }))


  /** 中文说明：测试类成员 `agentPresets`，保存可编排行为或观测状态；取值范围由声明类型限定，仅供连接层测试使用。 */
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

  /** 中文说明：测试类成员 `skills`，保存可编排行为或观测状态；取值范围由声明类型限定，仅供连接层测试使用。 */
  readonly skills: IApiClient['skills'] = {
    list: (payload: unknown) => this.record('skill.list', payload, this.onSkillList(payload)),
  }

  /** 中文说明：测试类成员 `goals`，保存可编排行为或观测状态；取值范围由声明类型限定，仅供连接层测试使用。 */
  readonly goals: IApiClient['goals'] = {
    create: payload => this.record('goal.create', payload, Promise.resolve(ok({ ref: { id: 'fake-goal' as never, revision: 1 } }))),
    edit: payload => this.record('goal.edit', payload, Promise.resolve(ok({ ref: { id: 'fake-goal' as never, revision: 1 } }))),
    pause: payload => this.record('goal.pause', payload, Promise.resolve(ok({ ref: { id: 'fake-goal' as never, revision: 1 } }))),
    resume: payload => this.record('goal.resume', payload, Promise.resolve(ok({ ref: { id: 'fake-goal' as never, revision: 1 } }))),
    complete: payload => this.record('goal.complete', payload, Promise.resolve(ok({ ref: { id: 'fake-goal' as never, revision: 1 } }))),
    clear: payload => this.record('goal.clear', payload, Promise.resolve(ok({ cleared: true as const }))),
  }

  /** 中文说明：测试类成员 `settings`，保存可编排行为或观测状态；取值范围由声明类型限定，仅供连接层测试使用。 */
  readonly settings: IApiClient['settings'] = {
    describe: payload => this.record('settings.describe', payload, Promise.resolve(ok({ writable: true, hasDocument: false, namespaces: [] }))),
    openDocument: payload => this.record('settings.openDocument', payload, Promise.resolve(ok({ opened: true as const }))),
    update: payload => this.record('settings.update', payload, Promise.resolve(ok({ ns: 'fake', schema: {}, value: {}, applies: 'live' as const, secrets: [], revision: 0 }))),
    replace: payload => this.record('settings.replace', payload, Promise.resolve(ok({ ns: 'fake', schema: {}, value: {}, applies: 'live' as const, secrets: [], revision: 0 }))),
    mutate: payload => this.record('settings.mutate', payload, Promise.resolve(ok({ ns: 'fake', schema: {}, value: {}, applies: 'live' as const, secrets: [], revision: 0 }))),
  }

  /** 中文说明：测试类成员 `credentials`，保存可编排行为或观测状态；取值范围由声明类型限定，仅供连接层测试使用。 */
  readonly credentials: IApiClient['credentials'] = {
    describe: payload => this.record('credentials.describe', payload, Promise.resolve(ok({ credentials: {} }))),
    set: payload => this.record('credentials.set', payload, Promise.resolve(ok({}))),
    unset: payload => this.record('credentials.unset', payload, Promise.resolve(ok({}))),
  }

  /** 中文说明：测试类成员 `llm`，保存可编排行为或观测状态；取值范围由声明类型限定，仅供连接层测试使用。 */
  readonly llm: IApiClient['llm'] = {
    providers: payload => this.record('llm.providers', payload, Promise.resolve(ok({ providers: [] }))),
    models: payload => this.record('llm.models', payload, Promise.resolve(ok({ groups: [], failures: [] }))),
    discoverModels: payload => this.record('llm.discoverModels', payload, Promise.resolve(ok({ models: [] }))),
  }

  /** When true, streams never fire onOpen (misbehaving-carrier material for the handshake timeout guard). */
  /* 中文说明：测试类成员 `suppressStreamOpen`，保存可编排行为或观测状态；取值范围由声明类型限定，仅供连接层测试使用。 */
  suppressStreamOpen = false

  /** When true, onOpen callbacks are parked instead of fired; releaseStreamOpens() fires them.
   *  Lets a case hold the readiness handshake open (describe done, streams not yet "established"). */
  /* 中文说明：测试类成员 `holdStreamOpen`，保存可编排行为或观测状态；取值范围由声明类型限定，仅供连接层测试使用。 */
  holdStreamOpen = false
  /** 中文说明：测试类成员 `heldOpens`，保存可编排行为或观测状态；取值范围由声明类型限定，仅供连接层测试使用。 */
  private heldOpens: (() => void)[] = []

  /** 中文说明：测试类方法 `releaseStreamOpens`；参数含义见签名，返回值用于驱动或观察当前场景；例如按下方用例的调用方式使用。 */
  releaseStreamOpens(): void {
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `held` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const held = this.heldOpens
    this.heldOpens = []
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `fire` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    for (const fire of held) fire()
  }

  /** 中文说明：测试类成员 `events`，保存可编排行为或观测状态；取值范围由声明类型限定，仅供连接层测试使用。 */
  readonly events: IApiClient['events'] = {
    mux: (_payload: unknown, signal: AbortSignal, onOpen?: () => void) =>
      this.openStream(this.muxConns, signal, onOpen),
    host: (_payload: unknown, signal: AbortSignal, onOpen?: () => void) =>
      this.openStream(this.hostConns, signal, onOpen),
  }

  /** 中文说明：测试类方法 `respond`；参数含义见签名，返回值用于驱动或观察当前场景；例如按下方用例的调用方式使用。 */
  respond(): Promise<{ accepted: false; reason: 'not-pending' }> {
    return Promise.resolve({ accepted: false, reason: 'not-pending' })
  }

  /** Push one mux frame to every open mux stream (rpcId minted unless pinned by the case). */
  /* 中文说明：测试类方法 `pushMux`；参数含义见签名，返回值用于驱动或观察当前场景；例如按下方用例的调用方式使用。 */
  pushMux(frame: MuxFrame, rpcId?: string): void {
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `conn` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    for (const conn of [...this.muxConns]) conn.feed({ kind: 'frame', envelope: { rpcId: RpcId(rpcId ?? `push-${nextRpc++}`), payload: frame } })
  }

  /** 中文说明：测试类方法 `pushHost`；参数含义见签名，返回值用于驱动或观察当前场景；例如按下方用例的调用方式使用。 */
  pushHost(frame: HostFrame, rpcId?: string): void {
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `conn` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    for (const conn of [...this.hostConns]) conn.feed({ kind: 'frame', envelope: { rpcId: RpcId(rpcId ?? `push-${nextRpc++}`), payload: frame } })
  }

  /** End (clean close) or fail (throw) every open stream — reconnect-path material. */
  /* 中文说明：测试类方法 `endStreams`；参数含义见签名，返回值用于驱动或观察当前场景；例如按下方用例的调用方式使用。 */
  endStreams(): void {
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `conn` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    for (const conn of [...this.muxConns, ...this.hostConns]) conn.feed({ kind: 'end' })
  }

  /** 中文说明：测试类方法 `failStreams`；参数含义见签名，返回值用于驱动或观察当前场景；例如按下方用例的调用方式使用。 */
  failStreams(error: unknown): void {
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `conn` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    for (const conn of [...this.muxConns, ...this.hostConns]) conn.feed({ kind: 'fail', error })
  }

  /** 中文说明：测试类方法 `openMuxCount`；参数含义见签名，返回值用于驱动或观察当前场景；例如按下方用例的调用方式使用。 */
  get openMuxCount(): number {
    return this.muxConns.length
  }

  /** 中文说明：测试类方法 `callsOf`；参数含义见签名，返回值用于驱动或观察当前场景；例如按下方用例的调用方式使用。 */
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
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `wake` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
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
