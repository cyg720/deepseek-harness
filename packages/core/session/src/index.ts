/**
 * Event-sourced session service: append-only session log, in-memory store, and
 * the derived LLM message history. Persistence is a plugin concern (subscribe
 * to `session/event`, drain on `session/flush`).
 *
 * @module @deepseek-ai/dsh-session
 */
/*
 * ================================ 文件注释 ================================
 * 【文件职责】dsh-session 包的主入口：定义事件溯源（event-sourced）的会话对象 Session（只追加事件
 *           日志 + 表面视图 + 派生消息历史）、内存会话仓库 SessionStore（ctx.sessions 服务）、fork
 *           支持，以及种子/恢复数据的全套校验与冻结工具函数。
 * 【技术维度】Cordis 插件体系：Service 基类、ctx.effect() 注册效果、ctx.on() 监听事件、declare
 *            module 声明合并挂载 sessions 属性与 session/* 事件；事件溯源架构（append-only log 为
 *            权威，消息历史为派生）；WeakMap 模块级附件把发布钩子挂在 Session 上而不污染公共 API；
 *            deepFreeze 深度冻结保证耐久历史不可篡改；snapshotJsonValue 在边界处校验并分离数据。
 * 【产品维度】一切 agent 对话的“黑匣子”：用户消息、助手回复、工具调用与结果、待办清单、请求配置全部
 *           以事件形式落入日志，支撑 UI 回放、崩溃恢复、fork 分叉、telemetry 与持久化插件对接。
 * 【逻辑维度】按代码顺序：Cordis 上下文/事件声明合并 → 头部校验与快照函数 → adopt/snapshotSessionEvent
 *           → 各类信封与消息形状校验 → 观察者收集与容错调用 → Session 类（append、requestHeader/
 *           requestContext 折叠、deriveMessages 缓存）→ fork 错误类型 → SessionStore 服务
 *           （prepare/enter/announce/create/flush/fork）。
 * 【关键边界】append 的数据必须无损 JSON 可序列化否则当场抛错；事件一经入日志即为已提交，观察者异常
 *           只告警不影响提交；表面事件必须携带 SurfaceIntent、纯日志事件禁止携带；append 发布期间禁止
 *           重入；种子事件按与实时追加相同的规则校验且 seq 必须从 0 连续。
 * 【新手阅读建议】先读 Session 类的类注释与 append 方法（系统的心脏），再读 SessionStore 的
 *           create/prepare/enter/announce 四步事务理解“发布”语义，最后浏览各 assert* 与 validate* 校验
 *           函数了解边界防线。事件语义细节见 types.ts 的 SessionEventMap。
 * ==========================================================================
 */

import { Context, Service } from '@deepseek-ai/cordis'
import { isAbsolute } from 'node:path'
import { deepFreeze } from '@deepseek-ai/dsh-llm'
import { scopeOf, scopeTarget } from '@deepseek-ai/dsh-scope'
import type { Scoped } from '@deepseek-ai/dsh-scope'
import type { Message } from '@deepseek-ai/dsh-llm'
import { SESSION_FORMAT_VERSION, SessionId } from './types.ts'
import type { TypertLookup } from '@deepseek-ai/dsh-typert-protocol'
import type { CreateSessionOptions, EpochHeader, PrepareSessionOptions, RequestContext, SessionEvent, SessionEventMap, SessionEventType, SessionHeader, SurfaceIntent, SurfaceEventType } from './types.ts'
import { snapshotJsonValue } from './json.ts'
import { deriveEventMessage, SurfaceManager } from './surface.ts'
import type { SessionSurface } from './surface.ts'
import { foldRequestHeader } from './request-header.ts'

export * from './types.ts'
export { SessionPreparation } from './preparation.ts'
export type { SessionPreparationOptions } from './preparation.ts'
export type { AssistantMessage, ToolResultMessage, UserMessage } from '@deepseek-ai/dsh-llm'
export { isJsonValue, snapshotJsonValue } from './json.ts'
export type { JsonValue } from './json.ts'
export { interruptedTurnClosers, TOOL_NOT_STARTED, TOOL_OUTCOME_UNKNOWN } from './repair.ts'
export { decodeStorageRecord, packChunkRuns } from './chunk-rows.ts'
export type { ChunkRow, StorageRecord } from './chunk-rows.ts'
export type { SessionSurface, SurfaceFoldReplacement, SurfaceFoldResult } from './surface.ts'
export { deriveEventMessage, foldSurface, isAppendSurfaceEvent, isReplacementSurfaceEvent, isSurfaceEvent, isSurfaceEligibleType } from './surface.ts'
export { canonicalHeader, foldRequestHeader, headerEquals } from './request-header.ts'
export { KNOWN_SESSION_EVENT_TYPES } from './known-event-types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    sessions: SessionStore
  }

  interface Events {
    /**
     * Creation announcement during session publication. A synchronous throw vetoes and rolls
     * back with a paired disposal; detach requested during dispatch is deferred.
     * A returned-promise rejection is logged but cannot retroactively veto this
     * synchronous boundary.
     * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners
     * receive only sessions entered through that agent's context.
     * @param session - the session just entered and announced.
     * @dshScopeScan unsupported
     * @mode emit
     */
    // 中文说明：会话发布期间的创建公告。同步抛出即否决并回滚（配对一次销毁）；分发期间请求的
    // detach 会被推迟。监听器返回的 Promise 被拒绝只会记录告警，无法追溯否决这个同步边界。
    // 作用域过滤分发：agent 作用域的监听器只收到经该 agent 上下文进入的会话。
    'session/created'(this: Scoped<Session>, session: Session): void
    /**
     * Emitted once when an announced session leaves the store, including
     * publication rollback, but never for an entry whose creation announcement
     * did not begin. Listener failures are logged and contained.
     * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`) reuses the owner scope.
     * @param session - the session that is no longer live in the store.
     * @dshScopeScan unsupported
     * @mode emit
     */
    // 中文说明：一个已公告的会话离开 store 时发射一次，包括发布回滚；但创建公告尚未开始的条目不触发。
    // 监听器失败会被记录并隔离。作用域过滤分发复用属主作用域。
    'session/disposed'(this: Scoped<Session>, session: Session): void
    /**
     * Post-commit, fire-and-forget append feed. The listener snapshot resolves
     * before the log push, but callbacks run after it; observer failures are
     * logged and contained without making the committed append fail.
     * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners
     * receive only events from sessions entered through that agent's context.
     * @param session - the session whose log grew.
     * @param event - the appended event, exactly as recorded.
     * @dshScopeScan unsupported
     * @mode emit
     */
    // 中文说明：提交后的“发后即忘”式追加订阅源。监听器快照在日志推入前解析、回调在其后运行；
    // 观察者失败被记录并隔离，不会让已提交的追加失败。作用域过滤分发：agent 作用域监听器只收到
    // 经该 agent 上下文进入的会话的事件。持久化插件就靠它接收事件。
    'session/event'(this: Scoped<Session>, session: Session, event: SessionEvent): void
    /**
     * Awaited parallel durability checkpoint: every listener runs and the
     * caller awaits all of them, with no waterfall veto. Scope-filtered dispatch
     * (`@deepseek-ai/dsh-scope`) reuses the session's owner scope.
     * @param session - the session whose buffered events must reach durable storage.
     * @dshScopeScan unsupported
     * @mode parallel
     */
    // 中文说明：被 await 的并行耐久检查点：每个监听器都会运行、调用方等待全部完成，没有瀑布否决。
    // 作用域过滤分发复用会话的属主作用域。持久化插件在此把缓冲事件写入磁盘。
    'session/flush'(this: Scoped<Session>, session: Session): Promise<void> | void
  }
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  // 向 Typert RPC 注册表声明 session 类型查找：把线上的 sessionId 解析回宿主端 Session 对象。
  interface TypertLookupMap {
    session: TypertLookup<Session, SessionId>
  }
}

/** Validate and freeze one detached creation header in place. */
/* 就地校验并冻结一份分离的创建头部：版本必须匹配、id 必须一致、各标量字段类型合规、cwd 必须为绝对路径。 */
function validateSessionHeader(id: SessionId, input: unknown): SessionHeader {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('session header is not a plain JSON record')
  }
  const record = input as Record<string, unknown>
  if (record.version !== SESSION_FORMAT_VERSION) {
    throw new Error(`session header version must be ${SESSION_FORMAT_VERSION}, got ${String(record.version)}`)
  }
  if (record.id !== id) {
    throw new Error(`session header id "${String(record.id)}" does not match session id "${id}"`)
  }
  if (typeof record.createdAt !== 'number'
    || !Number.isSafeInteger(record.createdAt)
    || record.createdAt < 0) {
    throw new Error('session header createdAt must be a non-negative safe integer')
  }
  if (record.cwd !== undefined) {
    if (typeof record.cwd !== 'string') throw new Error('session header cwd must be a string')
    if (!isAbsolute(record.cwd)) {
      throw new Error(`session header cwd must be an absolute path, got "${record.cwd}"`)
    }
  }
  if (record.parentSession !== undefined && typeof record.parentSession !== 'string') {
    throw new Error('session header parentSession must be a string')
  }
  if (record.seedLength !== undefined
    && (typeof record.seedLength !== 'number' || !Number.isSafeInteger(record.seedLength) || record.seedLength < 0)) {
    throw new Error('session header seedLength must be a non-negative safe integer')
  }
  if (record.origin !== undefined && record.origin !== 'subagent') {
    throw new Error('session header origin must be "subagent"')
  }
  if (record.delegationDepth !== undefined
    && (typeof record.delegationDepth !== 'number' || !Number.isSafeInteger(record.delegationDepth) || record.delegationDepth < 0)) {
    throw new Error('session header delegationDepth must be a non-negative safe integer')
  }
  if (record.agentPreset !== undefined && typeof record.agentPreset !== 'string') {
    throw new Error('session header agentPreset must be a string')
  }
  return deepFreeze(record as unknown as SessionHeader)
}

/** Validate and freeze one exclusively owned persistence header in place. */
/* 就地校验并冻结一份独占所有的持久化头部：额外要求它是普通 JSON 原型的记录（非类实例）。 */
function validateRestoredSessionHeader(id: SessionId, input: unknown): SessionHeader {
  if (input !== null && typeof input === 'object' && !Array.isArray(input)) {
    const prototype = Reflect.getPrototypeOf(input)
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error('session header is not a plain JSON record')
    }
  }
  return validateSessionHeader(id, input)
}

/** Detach, validate, and freeze the creation metadata published by a session. */
/* 对会话发布时使用的创建元数据做分离、校验并冻结；未提供时按当前时间与格式版本合成最小头部。 */
function snapshotSessionHeader(id: SessionId, source?: SessionHeader): SessionHeader {
  // 未提供头部时合成最小形态（版本 + id + 当前时间）。
  const input: unknown = source === undefined
    ? { version: SESSION_FORMAT_VERSION, id, createdAt: Date.now() }
    : source
  const snapshot = snapshotJsonValue(input)
  if (snapshot === undefined) throw new Error('session header is not losslessly JSON-serializable')
  return validateSessionHeader(id, snapshot)
}

/**
 * Validate an exclusively owned event and deeply freeze its identified message
 * without copying the event. The caller transfers an object graph that no
 * producer retains and that shares no mutable children with another event.
 * Use {@link snapshotSessionEvent} when exclusive ownership is not guaranteed.
 * @param event - exclusively owned event imported across a trusted boundary.
 * @returns the same event object with a validated, deeply frozen message.
 */
/*
 * 校验一个独占所有的会话事件并对其中的“已识别消息”深度冻结，不拷贝事件本身。
 * 调用方保证传入的对象图不再被生产者持有、也不与其他事件共享可变子对象。
 * 无法保证独占时请改用 {@link snapshotSessionEvent}。
 * @param event - 经可信边界导入的独占事件。
 * @returns 同一个事件对象，其消息已通过校验并被深度冻结。
 */
export function adoptSessionEvent<T extends SessionEvent>(event: T): T {
  assertMessageEventShape(
    event,
    `session event at seq ${event.seq}`,
  )
  switch (event.type) {
    case 'user/message':
      deepFreeze(event.data)
      break
    case 'assistant/message':
    case 'tool/result':
      deepFreeze(event.data.message)
      break
    default:
      // SessionEventMap is merge-extensible; plugin-owned events carry no core message.
      // SessionEventMap 可合并扩展；插件自有事件不含核心消息。
      break
  }
  return event
}

/**
 * Detach one event while preserving deep immutability for its identified message.
 * @param event - event imported across a query or persistence boundary.
 * @returns a detached event snapshot with a validated, deeply frozen message.
 */
/*
 * 分离一个事件的同时保持其“已识别消息”的深度不可变性。
 * @param event - 经查询或持久化边界导入的事件。
 * @returns 分离的事件快照，其消息已校验并深度冻结。
 */
export function snapshotSessionEvent<T extends SessionEvent>(event: T): T {
  return adoptSessionEvent(structuredClone(event))
}

/** Deep-freeze one acyclic JSON tree without consuming the JavaScript call stack. */
/* 对一棵无环 JSON 树做深度冻结，且不耗尽 JS 调用栈（显式栈迭代）。 */
function freezeRestoredObject<T extends object>(value: T): T {
  // 待访问栈：弹出即冻结，并把对象子节点压栈。
  const pending: object[] = [value]
  while (pending.length > 0) {
    // The non-empty check proves an object remains to visit.
    // oxlint-disable-next-line typescript/no-non-null-assertion
    const current = pending.pop()!
    Object.freeze(current)
    for (const key in current) {
      const child = (current as Record<string, unknown>)[key]
      if (child !== null && typeof child === 'object') pending.push(child)
    }
  }
  return value
}

/** Validate the fixed event envelope after one-pass JSON materialization. */
/* 在一次性 JSON 物化之后校验固定的事件信封：键集合封闭、type/seq/time 形状正确，并拒绝遗留的 request/header-delta 格式。 */
function assertSessionEventEnvelope(value: Record<string, unknown>, index: number): asserts value is SessionEvent {
  const event = value
  if (event['type'] === 'request/header-delta') {
    throw new Error(`seed event at index ${index} uses unsupported legacy request/header-delta format`)
  }
  for (const key in event) {
    switch (key) {
      case 'type':
      case 'seq':
      case 'time':
      case 'data':
      case 'surfaceOp':
      case 'sourceEventSeqs':
      case 'ignorable':
        break
      default:
        throw new Error(`seed event at index ${index} has an invalid event envelope`)
    }
  }
  const type = event['type']
  const seq = event['seq']
  const time = event['time']
  if (typeof type !== 'string'
    || typeof seq !== 'number' || !Number.isSafeInteger(seq) || seq < 0
    || typeof time !== 'number' || !Number.isSafeInteger(time)
    || event['data'] === undefined
    || (event['ignorable'] !== undefined && event['ignorable'] !== true)) {
    throw new Error(`seed event at index ${index} has an invalid event envelope`)
  }
  switch (type) {
    case 'request/header':
    case 'user/message':
    case 'assistant/message':
    case 'tool/result':
      assertCurrentLlmShape(event, index)
      break
  }
}

/** Reject obsolete request headers and malformed messages at the seed/load boundary. */
/* 在种子/加载边界拒绝过期版本的请求头与畸形消息（provider/model 必须存在等）。 */
function assertCurrentLlmShape(event: Record<string, unknown>, index: number): void {
  const data = event['data']
  const record = typeof data === 'object' && data !== null
    ? data as Record<string, unknown>
    : undefined
  if (event['type'] === 'request/header') {
    const header = record?.['header']
    const headerRecord = typeof header === 'object' && header !== null && !Array.isArray(header)
      ? header as Record<string, unknown>
      : undefined
    const config = headerRecord?.['config']
    if (!hasProviderModel(config)) throw new Error(`seed request/header at index ${index} lacks provider/model`)
    const configRecord = config as Record<string, unknown>
    const reasoningEffort = configRecord['reasoningEffort']
    if (reasoningEffort !== undefined
      && (typeof reasoningEffort !== 'string' || reasoningEffort.length === 0)) {
      throw new Error(`seed request/header at index ${index} has an invalid reasoningEffort`)
    }
    assertAdapterDefaults(headerRecord?.['adapterDefaults'], configRecord, index)
  }
  const type = event['type']
  if (type !== 'user/message' && type !== 'assistant/message'
    && type !== 'tool/result') return
  assertMessageEventShape(event, `seed ${type} at index ${index}`)
}

// adapterDefaults 中允许出现的键白名单：之外的“落实标记”一律拒绝。
const allowedAdapterKeys = new Set(['reasoningEffort', 'maxTokens'])

/** Validate adapter-default markers imported from a durable request header. */
/* 校验从耐久请求头导入的适配器默认标记：只许白名单键、值必须为 true、且被标记的字段必须在 config 中真的存在。 */
function assertAdapterDefaults(
  value: unknown,
  config: Record<string, unknown>,
  index: number,
): void {
  if (value === undefined) return
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`seed request/header at index ${index} has invalid adapterDefaults`)
  }
  const defaults = value as Record<string, unknown>
  if (Object.keys(defaults).some(key => !allowedAdapterKeys.has(key))
    || Object.values(defaults).some(marker => marker !== true)
    || defaults['reasoningEffort'] === true && config['reasoningEffort'] === undefined
    || defaults['maxTokens'] === true && config['maxTokens'] === undefined) {
    throw new Error(`seed request/header at index ${index} has invalid adapterDefaults`)
  }
}

/** Validate only the event-specific invariants needed to safely replay a message. */
/* 只校验“安全重放一条消息”所需的事件级不变量：角色、来源 kind、content 结构；assistant 必须是 model 来源，tool/result 的 callId 与工具结果块必须配对。 */
function assertMessageEventShape(event: Record<string, unknown>, subject: string): void {
  const type = event['type']
  if (type !== 'user/message' && type !== 'assistant/message'
    && type !== 'tool/result') return
  const data = event['data']
  const record = typeof data === 'object' && data !== null
    ? data as Record<string, unknown>
    : undefined
  const message = type === 'user/message' ? record : record?.['message']
  if (typeof message !== 'object' || message === null
    || typeof (message as Record<string, unknown>)['id'] !== 'string'
    || (message as Record<string, unknown>)['id'] === '') {
    throw new Error(`${subject} lacks an identified message`)
  }
  const messageRecord = message as Record<string, unknown>
  const expectedRole = type === 'assistant/message' ? 'assistant' : 'user'
  if (messageRecord['role'] !== expectedRole) {
    throw new Error(`${subject} message must have role "${expectedRole}"`)
  }
  const source = messageRecord['source']
  if (typeof source !== 'object' || source === null
    || typeof (source as Record<string, unknown>)['kind'] !== 'string'
    || (source as Record<string, unknown>)['kind'] === '') {
    throw new Error(`${subject} message has invalid source`)
  }
  if (!Array.isArray(messageRecord['content'])) {
    throw new Error(`${subject} message has invalid content`)
  }
  const sourceRecord = source as Record<string, unknown>
  if (type === 'assistant/message') {
    if (sourceRecord['kind'] !== 'model' || !hasProviderModel(sourceRecord)) {
      throw new Error(`${subject} message must have model source`)
    }
    return
  }
  if (type !== 'tool/result') return
  if (sourceRecord['kind'] !== 'tool'
    || typeof sourceRecord['callId'] !== 'string'
    || sourceRecord['callId'] === '') {
    throw new Error(`${subject} message must have tool source`)
  }
  const content = messageRecord['content'] as unknown[]
  const block = content[0]
  if (content.length !== 1 || typeof block !== 'object' || block === null
    || (block as Record<string, unknown>)['type'] !== 'tool-result'
    || !Array.isArray((block as Record<string, unknown>)['content'])) {
    throw new Error(`${subject} message must contain one tool-result block`)
  }
  if ((block as Record<string, unknown>)['toolCallId'] !== sourceRecord['callId']) {
    throw new Error(`${subject} message has mismatched tool call ids`)
  }
}

/** Whether an unknown value carries the current provider/model pair. */
/* 判断未知值是否带有非空的 provider/model 字符串对。 */
function hasProviderModel(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false
  const pair = value as Record<string, unknown>
  return typeof pair['provider'] === 'string' && pair['provider'].length > 0
    && typeof pair['model'] === 'string' && pair['model'].length > 0
}

/** Reject request-header vocabulary removed with the legacy delta codec. */
/* 拒绝随遗留 delta 编解码器一起删除的请求头词汇（request/header-delta 类型与 reason:"fallback"）。 */
function assertSupportedRequestHeader(type: string, data: unknown, location: string): void {
  if (type === 'request/header-delta') {
    throw new Error(`${location} uses unsupported legacy request/header-delta format`)
  }
  if (type === 'request/header'
    && data !== null && typeof data === 'object' && !Array.isArray(data)
    && (data as Record<string, unknown>)['reason'] === 'fallback') {
    throw new Error(`${location} uses unsupported legacy request/header reason "fallback"`)
  }
}

// 已解析的监听器回调签名（参数保持 unknown，由具体事件约定解释）。
type SessionCallback = (...args: unknown[]) => unknown

/** Resolve one listener snapshot, including Cordis's internal dispatch checks. */
/* 解析一次监听器快照，包含 Cordis 内部的分发检查（如 scope 过滤）。 */
function collectSessionCallbacks(ctx: Context, args: unknown[]): SessionCallback[] {
  return [...ctx.events.dispatch('emit', args)] as SessionCallback[]
}

/** Invoke one resolved observe-only listener snapshot with per-listener containment. */
/* 逐一调用已解析的观察型监听器快照，并做逐监听器故障隔离：抛错或 Promise 拒绝只记警告，不影响其他监听者。 */
function invokeContainedSessionObservers(
  ctx: Context,
  name: 'session/event' | 'session/disposed',
  id: SessionId,
  args: unknown[],
  callbacks: SessionCallback[],
): void {
  for (const callback of callbacks) {
    try {
      const returned: unknown = callback(...args)
      void Promise.resolve(returned).catch((error: unknown) => {
        ctx.logger.warn(`session "${id}": ${name} listener rejected: ${String(error)}`)
      })
    } catch (error: unknown) {
      ctx.logger.warn(`session "${id}": ${name} listener threw: ${String(error)}`)
    }
  }
}

/** All mutable lifecycle state for one exact store entry. */
/* 一个确切 store 条目的全部可变生命周期状态。 */
interface SessionEntry {
  // 会话 id。
  readonly id: SessionId
  // 会话对象。
  readonly session: Session
  // 会话的作用域载体：决定 scoped 事件分发时谁能收到。
  readonly carrier: Scoped<Session>
  // 发射事件所用的上下文。
  readonly emitCtx: Context
  // 是否已完成 created 公告。
  announced: boolean
  // created 公告正在进行（防重入）。
  announcing: boolean
  // 一次 append 的发布正在进行。
  appending: boolean
  // 公告/追加期间收到过延迟分离请求。
  detachRequested: boolean
  // 执行真正的分离清理。
  detach(): void
}

/** Store attachment for the append path; module-private to keep Session store-agnostic publicly. */
// append 路径的 store 附件；保持模块私有，使 Session 的公共 API 不绑定具体 store。
const attachments = new WeakMap<Session, SessionEntry>()

/**
 * An event-sourced session: an append-only log of {@link SessionEvent}s.
 *
 * Plain class (not a Service) — create live instances via
 * `ctx.sessions.create()` and detached instances via {@link create}.
 * Seeding with an existing event log replays/forks a session.
 * @typert object
 */
/*
 * 事件溯源的会话：一个只追加的 {@link SessionEvent} 日志。
 * 它是普通类（不是 Cordis Service）——通过 ctx.sessions.create() 创建受管实例，
 * 或用静态 create 创建分离（detached）实例。用已有事件日志做种子即实现重放/fork。
 */
export class Session {
  // 权威的只追加事件日志（内部可变数组；对外只暴露冻结快照）。
  private log: SessionEvent[] = []
  /** Single incremental owner of surface acceptance and projection state. */
  // 表面接收与投影状态的唯一增量管理者。
  private readonly surfaceManager = new SurfaceManager(this.log)

  /** The ordered surface over this session's event log. */
  /* 本会话事件日志之上的有序表面视图。 */
  get surface(): SessionSurface {
    return this.surfaceManager
  }

  /**
   * Detached, deep-frozen creation metadata (format version, cwd, lineage,
   * seed boundary). Supplied by the store via `ctx.sessions.create()`. When a
   * `Session` is created without a store-owned header, a minimal header is
   * synthesized (stamped with the current {@link SESSION_FORMAT_VERSION}) so
   * `session.header` is always present. Kept out of the event log — it is a
   * storage concern, not replayable conversation state.
   */
  /*
   * 深度冻结的创建元数据快照（格式版本、cwd、谱系、种子边界）。
   * 由 store 经 ctx.sessions.create() 提供；不带 store 头部创建的 Session 会合成一份最小头部
   * （盖当前 SESSION_FORMAT_VERSION），因此 session.header 始终存在。
   * 它保存在事件日志之外——属于存储关注点，不是可重放的对话状态。
   */
  readonly header: SessionHeader

  /** The session identity, derived from its durable header's single copy. */
  /* 会话身份，直接取自耐久头部的唯一副本。 */
  get id(): SessionId {
    return this.header.id
  }

  /**
   * The first seq appended IN THIS PROCESS: the length of the constructor
   * seed (0 without one). Events with smaller seq values entered through
   * construction — replay, fork, or resume — and were never published on the
   * `session/event` firehose (constructor seeds do not emit), so consumers
   * that replay the log as a publication substitute (telemetry adoption)
   * start here. Distinct from `header.seedLength`, the DURABLE fork-lineage
   * boundary: a resumed session's constructor seed is its full stored log,
   * while its header keeps the original fork value — this field is the
   * in-process construction fact.
   *
   * Not persisted itself: a seeded session projects it into the log as the
   * `session/end-seed` event, which is what a consumer reading STORED history
   * reads. Locate the LAST such event, not necessarily one at this seq — a
   * seed already ending in one is not re-marked, so reopening an untouched
   * session leaves that event at a smaller seq than `firstLiveSeq`. Prefer
   * this field in-process: it is exact before the marker reaches storage.
   *
   * When this lifecycle appends the marker, it occupies this seq before the
   * store attaches and therefore does not publish either. Otherwise this seq
   * holds an ordinary published write.
   */
  /*
   * 本进程内第一次追加事件的 seq：等于构造种子的长度（无种子则为 0）。
   * seq 更小的事件都是经构造进入的（replay/fork/resume），从不经 session/event 火警广播发布，
   * 因此以日志代替发布的消费者（如 telemetry 采纳）应从这里开始。它与 header.seedLength
   * （耐久的 fork 谱系边界）不同：resume 的构造种子是完整已存日志，而 header 保留原始 fork 值——
   * 本字段是“进程内的构造事实”。
   * 它本身不持久化：种子会话把它投影为日志里的 session/end-seed 事件，读存储历史的消费者找最后一条
   * 该事件即可；种子末尾若已有标记则不重复标注，所以该事件未必位于本 seq。进程内请优先读本字段：
   * 在标记落盘之前它才是精确的。
   */
  readonly firstLiveSeq: number

  /**
   * Create a detached session by validating and snapshotting borrowed seed
   * events and storage metadata.
   * @param id - session identity.
   * @param seed - optional borrowed replay or fork events.
   * @param header - optional borrowed storage metadata.
   * @returns a detached session.
   */
  /*
   * 通过校验并对“借来的”种子事件与存储元数据做快照，创建一个分离（不受 store 管理）的会话。
   * @param id - 会话身份。
   * @param seed - 可选的借入重放/fork 事件。
   * @param header - 可选的借入存储元数据。
   * @returns 一个分离的会话。
   */
  static create(id: SessionId, seed?: readonly SessionEvent[], header?: SessionHeader): Session {
    return new Session(id, seed, header)
  }

  /**
   * Restore a detached session by taking ownership of fresh persistence values.
   * The storage format, event envelopes, sequence continuity, surface transitions,
   * and header fields are validated before the restored objects are frozen.
   * @param id - restored session identity.
   * @param seed - fresh detached events whose ownership is transferred.
   * @param header - fresh detached metadata whose ownership is transferred.
   * @returns a restored detached session.
   */
  /*
   * 通过接管新鲜持久化值的所有权来恢复一个分离会话。存储格式、事件信封、seq 连续性、
   * 表面过渡与头部字段都会先校验，再冻结恢复对象。
   * @param id - 恢复的会话身份。
   * @param seed - 所有权转移的新鲜分离事件。
   * @param header - 所有权转移的新鲜分离元数据。
   * @returns 恢复出的分离会话。
   */
  static fromRestore(id: SessionId, seed: readonly SessionEvent[], header: SessionHeader): Session {
    return new Session(id, seed, header, 'restore')
  }

  // 私有构造：mode 决定走“借入快照”（snapshot）还是“独占恢复”（restore）路径。
  private constructor(
    id: SessionId,
    seed?: readonly SessionEvent[],
    header?: SessionHeader,
    mode: 'snapshot' | 'restore' = 'snapshot',
  ) {
    // restore 模式下先行校验的持久化头部。
    const restoredHeader = mode === 'restore'
      ? validateRestoredSessionHeader(id, header)
      : undefined
    if (seed !== undefined) {
      // Validate the seed to the SAME invariants `append` enforces, so a
      // replay/fork (`ctx.sessions.create(id, { seed })`) cannot construct a
      // live log that no persistence backend could store: each event's `data`
      // must be JSON-serializable, and `seq` must be contiguous from 0 (the
      // `seq = log.length` contract the whole system relies on). Without this,
      // a bad seed would surface only later as a backend rejection or a silent
      // divergence between the live log and disk.
      // 用与 append 完全相同的不变量校验种子，使 replay/fork 不可能造出任何持久化后端都无法存储的日志：
      // 每个事件的 data 必须可 JSON 序列化，seq 必须从 0 连续（全系统依赖的 seq=log.length 契约）。
      // 否则坏种子只会在之后才以后端拒绝或活日志与磁盘静默分叉的形式暴露。
      for (const [index, source] of seed.entries()) {
        // The seed is a persistence/replay boundary: validate and detach the
        // complete event in one lossless-JSON pass.
        // 种子是持久化/重放边界：用一次无损 JSON 遍历同时完成整个事件的校验与分离。
        const snapshot = mode === 'restore' ? source : snapshotJsonValue(source)
        if (snapshot === undefined) {
          throw new Error(`seed event at index ${index} is not losslessly JSON-serializable`)
        }
        assertSessionEventEnvelope(snapshot, index)
        assertSupportedRequestHeader(snapshot.type, snapshot.data, `seed event at index ${index}`)
        if (snapshot.seq !== index) {
          throw new Error(`seed event at index ${index} has seq ${snapshot.seq} (expected ${index}); seed must be contiguous from 0`)
        }
        // A seed is accepted incrementally through the same transition as a
        // live append and a full-log fold. The candidate is planned before it
        // enters `log`, so a failure cannot partially mutate the surface.
        // 种子通过与实时追加、全量折叠相同的过渡被增量接收；候选先规划后入 log，
        // 因此失败不会留下部分套用的表面变更。
        try {
          this.surfaceManager.validateNext(snapshot)
        } catch (error: unknown) {
          throw new Error(`invalid seed event at index ${index}: ${error instanceof Error ? error.message : 'invalid surface metadata'}`)
        }
        this.log.push(mode === 'restore' ? freezeRestoredObject(snapshot) : deepFreeze(snapshot))
      }
    }
    // 本进程首个活事件的 seq = 种子长度。
    this.firstLiveSeq = this.log.length
    this.header = restoredHeader ?? snapshotSessionHeader(id, header)
    // Appended here so the marker is already in `events` when a backend
    // captures the creation seed: no load-time write. Re-marking is skipped
    // because a cold session is resumed on first touch, so repeatedly opening
    // one must not grow its log per open.
    // 在此追加标记，使后端捕获创建种子时它已在事件里：加载时无需补写。种子末尾已是该标记
    // 则不再重复，避免反复打开未动过的会话导致日志膨胀。
    if (seed !== undefined && this.log.at(-1)?.type !== 'session/end-seed') {
      this.append('session/end-seed', {})
    }
  }

  /** Cached immutable public snapshot of the private append-only log. */
  /* 私有只追加日志的缓存式不可变公开快照。 */
  private eventsSnapshot: readonly SessionEvent[] | undefined

  /**
   * An immutable snapshot of the append-only event log. The snapshot is reused
   * until the next append; a previously returned array does not grow later.
   * Events and their nested data are deep-frozen at acceptance, so neither a
   * cast nor ordinary JavaScript can rewrite durable history.
   */
  /*
   * 事件日志的不可变快照。在下一次追加之前复用同一数组；已返回的数组之后不会增长。
   * 事件与其嵌套数据在接受时即被深度冻结，因此无论类型断言还是普通 JavaScript 都无法改写耐久历史。
   */
  get events(): readonly SessionEvent[] {
    this.eventsSnapshot ??= Object.freeze([...this.log])
    return this.eventsSnapshot
  }

  /** The next event's sequence number — always the log length (the `seq = log.length` contiguity contract). */
  /* 下一个事件的序号——恒等于日志长度（全系统依赖的 seq=log.length 连续性契约）。 */
  get seq(): number {
    return this.log.length
  }

  /**
   * Append one typed event to the log and synchronously notify observers via
   * the store-owned, module-private publication hooks. The hot path never blocks
   * on I/O — persistence plugins buffer asynchronously. Once the event enters
   * the log, the append is committed: observer failures are logged and
   * contained per listener, so they do not change the return value or prevent
   * later listeners from observing the same accepted event.
   *
   * @param type - The event type (key of {@link SessionEventMap}).
   * @param data - The event payload; must be JSON-serializable.
   * @param opts - Surface metadata: `surfaceOp` controls how the event enters
   *   the ordered surface; `sourceEventSeqs` lists the seq numbers of earlier
   *   events this one derives from. REQUIRED for
   *   {@link SurfaceEventType} events (every message-producing event must
   *   declare how it joins the surface, the sole source of derived model
   *   history) and
   *   rejected by the compiler for non-surface types like `turn/start` or
   *   `assistant/chunk`.
   * @returns the logged event — its assigned `seq`/`time` plus the SNAPSHOT of
   *   `data` that entered the log, so reading `event.data` back sees the logged
   *   value, never the caller's still-mutable input.
   * @throws if `data` or surface metadata is not losslessly JSON-serializable
   *   (BigInt, function, symbol, undefined, negative zero, non-finite number,
   *   circular reference, sparse array, or an exotic object such as
   *   Map/Set/Date/class instance), or when the candidate violates the
   *   canonical surface contract (marker shape and eligibility, unique
   *   earlier source-event references, positional replacement validity, and complete
   *   shadowed-node coverage). One recursive pass reads, validates, and
   *   copies each nested value once, so a stateful getter cannot supply one value
   *   to validation and another to storage. The event log is the durable source
   *   of truth, so a bad event fails at the append site rather than later during
   *   a backend flush. A synchronous internal dispatch validation failure or an
   *   append reentered while this acceptance/publication boundary is open also
   *   rejects before the log changes.
   */
  /*
   * 向日志追加一个类型化事件，并经 store 拥有的模块私有发布钩子同步通知观察者。
   * 热路径绝不阻塞在 I/O 上——持久化插件异步缓冲。事件一旦入日志即视为已提交：
   * 观察者失败按监听器隔离（记警告），既不改变返回值也不阻止后续监听者观察同一事件。
   * @param type - 事件类型（SessionEventMap 的键）。
   * @param data - 事件载荷；必须可 JSON 序列化。
   * @param opts - 表面元数据：surfaceOp 决定事件如何进入有序表面；sourceEventSeqs 列出本事件
   *   派生自哪些更早事件。对三类表面事件（SurfaceEventType）必填（每条产生消息的事件都必须声明
   *   自己如何加入表面，它是派生模型历史的唯一来源），对 turn/start、assistant/chunk 等纯日志
   *   类型则被编译器拒绝。
   * @returns 入志的事件对象——含分配的 seq/time 以及实际进入日志的 data 快照，因此回读
   *   event.data 看到的是已入志的值而非调用方仍可变的输入。
   * @throws 当 data 或表面元数据不是无损 JSON 可序列化（BigInt、函数、symbol、undefined、负零、
   *   非有限数、循环引用、稀疏数组或 Map/Set/Date/类实例等异构对象）时抛出；当候选违反规范表面契约
   *   （标记形状与资格、源引用唯一且更早、位置替换有效、被遮蔽节点全覆盖）时抛出；分发期间的同步
   *   校验失败或在发布边界内重入 append 也会在日志变化前拒绝。
   */
  append<T extends SessionEventType>(
    type: T,
    data: SessionEventMap[T],
    ...opts: T extends SurfaceEventType ? [opts: SurfaceIntent] : []
  ): SessionEvent<T> {
    // 调用方给出的表面意图（可选第三参）。
    const surfaceOpts: SurfaceIntent | undefined = opts[0]
    // 组装后将随事件一起做快照校验的表面字段（缺省字段保持缺席）。
    const surfaceMetadata = {
      ...surfaceOpts?.sourceEventSeqs === undefined ? {} : { sourceEventSeqs: surfaceOpts.sourceEventSeqs },
      ...surfaceOpts?.surfaceOp === undefined ? {} : { surfaceOp: surfaceOpts.surfaceOp },
    }
    // 载荷的分离快照；undefined 即不可序列化。
    const dataSnapshot = snapshotJsonValue(data)
    if (dataSnapshot === undefined) {
      throw new Error(`session event "${type}" carries non-JSON-serializable data`)
    }
    assertSupportedRequestHeader(type, dataSnapshot, `session event "${type}"`)
    const surfaceMetadataSnapshot = snapshotJsonValue(surfaceMetadata)
    if (surfaceMetadataSnapshot === undefined) {
      throw new Error(`session event "${type}" carries non-JSON-serializable surface metadata`)
    }
    // 本会话在 store 中的附件；未入 store 时为 undefined。
    const entry = attachments.get(this)
    if (entry?.appending) {
      throw new Error('session append cannot reenter while another append is being published')
    }
    // 组装好的最终事件：seq 取日志长度、time 取当下，整体深度冻结。
    const event = deepFreeze({
      type,
      seq: this.log.length,
      time: Date.now(),
      data: dataSnapshot,
      ...(surfaceMetadataSnapshot as { surfaceOp?: unknown; sourceEventSeqs?: unknown }),
    } as unknown as SessionEvent<T>)
    this.surfaceManager.validateNext(event as SessionEvent)

    if (entry !== undefined) entry.appending = true
    try {
      // 预先解析监听器快照，使“日志推入”与“通知”之间的窗口最小。
      let callbacks: SessionCallback[] | undefined
      const callbackArgs: unknown[] = [this, event]
      if (entry !== undefined) {
        callbacks = collectSessionCallbacks(entry.emitCtx, [entry.carrier, 'session/event', ...callbackArgs])
      }
      this.log.push(event as SessionEvent)
      this.eventsSnapshot = undefined
      if (callbacks !== undefined && entry !== undefined) {
        invokeContainedSessionObservers(entry.emitCtx, 'session/event', entry.id, callbackArgs, callbacks)
      }
      return event
    } finally {
      if (entry !== undefined) {
        entry.appending = false
        if (entry.detachRequested && !entry.announcing) entry.detach()
      }
    }
  }

  /** Cached fold of the request-header events — see {@link requestHeader}. */
  /* request/header 事件的缓存折叠结果——见 {@link requestHeader}。 */
  private headerFold: EpochHeader | undefined
  /** Log position (events consumed) the header fold has reached. */
  // 折叠已消费到的事件位置。
  private headerFoldSeq = 0

  /**
   * The {@link EpochHeader} in force after the log's last header event — the
   * header the NEXT request will be compared against — or undefined before
   * the first `request/header` snapshot. The live, incrementally-maintained
   * form of `foldRequestHeader(session.events)`: each header event is folded
   * once, when first seen, so a per-step read costs O(new events).
   * @returns the folded header, or undefined when no header event exists yet.
   */
  /*
   * 返回日志中最后一条 request/header 之后生效的 {@link EpochHeader}——也就是下一次请求
   * 将与之比较的头部；还没有任何头部事件时为 undefined。它是 foldRequestHeader(session.events)
   * 的在线增量形态：每个头部事件只在首次见到时折叠一次，逐步读取的开销是 O(新增事件数)。
   * @returns 折叠出的头部；尚无头部事件时为 undefined。
   */
  requestHeader(): EpochHeader | undefined {
    if (this.headerFoldSeq < this.log.length) {
      // Frozen on update: the fold is session state exposed by reference — a
      // consumer mutating it in place (instead of building a replacement)
      // would desync every later comparison against the log, so mutation
      // throws instead.
      // 更新时即冻结：折叠结果是按引用暴露的会话状态，原地改动（而非构造替换）
      // 会使之后所有与日志的比较失步，因此改动会直接抛错。
      this.headerFold = deepFreeze(foldRequestHeader(this.log.slice(this.headerFoldSeq), this.headerFold))
      this.headerFoldSeq = this.log.length
    }
    return this.headerFold
  }

  /** Cached fold of `request/context` events. */
  /* request/context 事件的缓存折叠。 */
  private contextFold: RequestContext | undefined
  // 折叠已消费到的事件位置。
  private contextFoldSeq = 0

  /**
   * Return the latest resolved route metadata, or `undefined` before the first
   * `request/context` event. Each event is folded once.
   * @returns the latest immutable route metadata.
   */
  /*
   * 返回最新解析出的路由元数据；还没有 request/context 事件时为 undefined。
   * 每个事件只折叠一次。
   * @returns 最新的不可变路由元数据。
   */
  requestContext(): RequestContext | undefined {
    if (this.contextFoldSeq < this.log.length) {
      for (const event of this.log.slice(this.contextFoldSeq)) {
        if (event.type === 'request/context') this.contextFold = deepFreeze({ ...event.data })
      }
      this.contextFoldSeq = this.log.length
    }
    return this.contextFold
  }

  /** The derived-message cache: frozen projections, extended per unseen node. */
  // 派生消息缓存：冻结的投影，按未见过的节点增量扩展。
  private derived: Message[] = []
  /** Surface position (nodes projected) the cache has reached. */
  // 缓存已投影到的表面节点位置。
  private derivedNodes = 0
  /** {@link SurfaceManager.replaceGeneration} the cache was built under. */
  // 缓存构建时所依据的 replaceGeneration（表面改写代数）。
  private derivedGeneration = 0

  /**
   * Derive the LLM message history by walking the ordered sequences of
   * message-producing events maintained by `surfaceOp` markers. The
   * surface is the single source of derived history: every message-producing
   * append records its `surfaceOp`, so a raw event with no marker (a chunk, a
   * turn boundary) is correctly absent, and a compaction `replace` deletes the
   * shadowed nodes from the derivation. The projection rules are
   * {@link deriveEventMessage}, folded per node.
   *
   * CACHED: each surface node is projected exactly once, when first seen — a
   * call costs O(new nodes), and a surface rewrite (a `replace`;
   * {@link SessionSurface.replaceGeneration}) rebuilds. The returned array is
   * a fresh snapshot per call (later appends never grow an array a caller
   * already holds); the `Message` objects in it are SHARED and **deep-frozen**.
   * Their content reuses the already frozen durable event data, so the cache
   * needs no second deep clone and consumers still cannot mutate the log.
   * @returns a fresh array of the shared, frozen derived history.
   */
  /*
   * 沿 surfaceOp 标记维护的有序序列遍历，派生出 LLM 消息历史。表面是派生历史的唯一来源：
   * 每个产生消息的追加都记录了自己的 surfaceOp，于是没有标记的原始事件（chunk、轮边界）
   * 自然缺席，compaction 的 replace 会把被遮蔽节点从派生中删除。单节点投影规则是
   * {@link deriveEventMessage}，逐节点折叠。
   *
   * 带缓存：每个表面节点只在首次见到时投影一次，单次调用成本 O(新节点)；
   * 表面改写（replace，见 {@link SessionSurface.replaceGeneration}）会触发重建。
   * 返回数组是每次调用的新快照（之后的追加不会让调用方手里的数组增长）；
   * 其中的 Message 对象是共享且深度冻结的——内容复用已冻结的耐久事件数据，
   * 缓存无需二次深拷贝，消费者也无法借此改动日志。
   * @returns 由共享、冻结消息构成的新数组。
   */
  deriveMessages(): Message[] {
    // 读取当前表面视图及其替换代数，用于检测是否需要重建缓存。
    const surface = this.surface
    const nodes = surface.nodes
    const generation = surface.replaceGeneration
    if (generation !== this.derivedGeneration) {
      this.derived = []
      this.derivedNodes = 0
      this.derivedGeneration = generation
    }
    for (const seq of nodes.slice(this.derivedNodes)) {
      // Surface sequences are built from this.log — seq is always a valid
      // index by construction. The non-null assertion expresses that invariant.
      // 表面 seq 都源自本日志——按构造 seq 就是合法下标；非空断言表达的就是这一不变量。
      // oxlint-disable-next-line typescript/no-non-null-assertion
      const msg = this.deriveEventMessage(this.log[seq]!)
      // A surface node is one of the five message-producing types, but an
      // empty-content assistant/message (a max-tokens step that hosts only
      // usage) derives to null and must not enter the transcript.
      // 空内容的 assistant/message（只承载 usage 的 max-tokens 步骤）投影为 null，不得进入转录。
      if (msg) this.derived.push(msg)
    }
    this.derivedNodes = nodes.length
    return [...this.derived]
  }

  /**
   * Instance face of the pure per-node `deriveEventMessage` export from
   * `surface.ts`.
   * @param event - the event to project.
   * @returns the derived message, or null when the event produces none.
   */
  /*
   * 纯函数 deriveEventMessage 导出的实例门面。
   * @param event - 要投影的事件。
   * @returns 派生的消息；不产生消息时为 null。
   */
  deriveEventMessage(event: SessionEvent): Message | null {
    return deriveEventMessage(event)
  }
}

/** A fork source: either the live session object or its live store id. */
/* fork 来源：活的会话对象，或其在 store 中的活会话 id。 */
export type SessionForkSource = Session | SessionId

/**
 * Rejection codes for session forking: the fork source id is unknown to the
 * live store (`SESSION_NOT_FOUND`) or names a session object that is not the
 * store's live instance (`SESSION_NOT_LIVE`); the requested child id is
 * already taken (`SESSION_ALREADY_EXISTS`); the boundary is not a contiguous
 * existing seq (`INVALID_BOUNDARY`); or the selected prefix ends inside an
 * open turn (`OPEN_TURN`).
 */
/*
 * 会话 fork 被拒绝的错误码：来源 id 不在活 store 中（SESSION_NOT_FOUND）；
 * id 对应的不是 store 的活实例（SESSION_NOT_LIVE）；目标子 id 已被占用
 * （SESSION_ALREADY_EXISTS）；边界不是已存在的连续 seq（INVALID_BOUNDARY）；
 * 所选前缀停在一个未闭合的轮次里（OPEN_TURN）。
 */
export type SessionForkErrorCode =
  | 'SESSION_NOT_FOUND'
  | 'SESSION_NOT_LIVE'
  | 'SESSION_ALREADY_EXISTS'
  | 'INVALID_BOUNDARY'
  | 'OPEN_TURN'

/** Typed error for session fork rejections. */
/* 会话 fork 被拒时抛出的带码类型化错误。 */
export class SessionForkError extends Error {
  /**
   * @param message - 人读的错误描述。
   * @param code - 机器可判定的拒绝原因码。
   */
  constructor(message: string, public readonly code: SessionForkErrorCode) {
    super(message)
    this.name = 'SessionForkError'
  }
}

/**
 * In-memory session store (`ctx.sessions`).
 *
 * Persistence is intentionally not implemented here — persistence plugins
 * subscribe to `session/event` and flush on `session/flush` / dispose.
 */
/*
 * 内存态会话仓库（即 ctx.sessions 服务）。
 * 这里有意不实现持久化——持久化插件订阅 session/event，并在 session/flush 或销毁时冲刷。
 */
export class SessionStore extends Service {
  // 会话 id → 条目（含发布钩子等生命周期状态）的映射。
  private store = new Map<SessionId, SessionEntry>()
  // 自动生成 session-<n> id 的计数器。
  private counter = 0

  /**
   * @param ctx - 宿主 Cordis 上下文。
   */
  constructor(ctx: Context) {
    super(ctx, 'sessions')
    // 依赖 typert 服务时向其注册 session 类型查找：线上 sessionId ↔ 宿主 Session 对象。
    ctx.inject(['typert'], (typeCtx) => {
      typeCtx.typert.lookups.register('session', {
        parameter: 'session',
        wire: 'sessionId',
        hostTypeSymbol: '@deepseek-ai/dsh-session#Session',
        wireTypeSymbol: '@deepseek-ai/dsh-session/types#SessionId',
        resolve: sessionId => this.get(sessionId),
      })
    })
  }

  /**
   * Create a session owned by the calling fiber: disposing that fiber stops
   * event notification and removes the session from the store. `options.seed`
   * populates the session with a copy of those events (replay/fork);
   * `options.meta` attaches creation metadata (validated absolute `cwd`, seed
   * and parent lineage, and delegation depth) as the immutable
   * {@link SessionHeader} (the store fills `version`/`id`/`createdAt`).
   *
   * For an agent whose session must be torn down IN ORDER with its loop (so the
   * loop's final events are published before the store attachment ends), do NOT use this
   * — fold the session lifecycle into the agent's own effect via
   * {@link prepare} + {@link enter} + {@link announce} (see
   * `dsh-agent-loop`'s creation transaction).
   *
   * @param id - the session id; omitted, the store mints `session-<n>`.
   * @param options - seed events and/or creation metadata for the header.
   * @returns the live session, already entered and announced.
   * @throws if a session with `id` already exists, metadata is not a plain
   *   lossless-JSON record with valid scalar fields, or `meta.cwd` is a
   *   non-absolute path (storage backends key directories off it).
   */
  /*
   * 创建一个归调用 fiber 所有的会话：销毁该 fiber 即停止事件通知并把会话移出 store。
   * options.seed 用那些事件的副本填充会话（重放/fork）；options.meta 把创建元数据
   * （校验过的绝对 cwd、种子与亲缘谱系、委派深度）固化为不可变的 {@link SessionHeader}
   * （version/id/createdAt 由 store 填写）。
   * 若会话必须与 agent 循环“按序”拆除（循环的收尾事件要先发布完再摘除 store 附件），
   * 请勿使用本方法——应通过 {@link prepare} + {@link enter} + {@link announce} 把会话生命周期
   * 折叠进 agent 自己的 effect（见 dsh-agent-loop 的创建事务）。
   * @param id - 会话 id；省略时 store 生成 session-<n>。
   * @param options - 种子事件与/或头部创建元数据。
   * @returns 已进入并公告完毕的活会话。
   * @throws 同 id 会话已存在、元数据不是普通可无损 JSON 记录或标量字段非法、或 meta.cwd 不是
   *   绝对路径（存储后端靠它定位目录）时抛出。
   */
  create(id?: SessionId, options?: CreateSessionOptions): Session {
    const session = this.prepare(id, options)
    // Single effect owned by the calling fiber. Yield the detach BEFORE
    // announcing so a throwing `session/created` listener rolls the attach back
    // (the generator effect disposes already-yielded disposers on a throw)
    // instead of leaking the store entry and its publication hooks.
    // 调用 fiber 拥有的单个 effect。先交出（yield）detach 再 announce，这样 session/created
    // 监听器抛错时会回滚 attach（generator effect 在 throw 时会销毁已交出的 disposer），
    // 而不是泄漏 store 条目及其发布钩子。
    this.ctx.effect(function* (this: SessionStore) {
      yield this.enter(session)
      this.announce(session)
    }.bind(this), 'sessions.create()')
    return session
  }

  /**
   * Build a session WITHOUT entering it into the store — validate the id/cwd and
   * construct the {@link Session} (with its immutable {@link SessionHeader}).
   * Pairs with {@link enter} + {@link announce}: a caller that owns a composite
   * `ctx.effect` (the agent factory) folds the session lifecycle into that ONE
   * effect so a fiber unload tears the session + agent down as a single ORDERED
   * chain rather than as racing sibling effects — which would remove the publication hooks
   * before the driver's closing events commit, dropping them.
   *
   * @param id - the session id; omitted, the store mints `session-<n>`.
   * @param options - seed events and/or creation metadata for the header. With
   *   `seedSource: 'persistence'`, metadata and events must be fresh detached
   *   graphs whose ownership transfers to this call: they are validated and
   *   frozen in place through {@link Session.fromRestore}, so the caller must
   *   retain no mutable aliases.
   * @returns the constructed session, NOT yet in the store.
   * @throws if a session with `id` already exists, metadata is not a plain
   *   lossless-JSON record with valid scalar fields, or `meta.cwd` is a
   *   non-absolute path.
   */
  /*
   * 构建“尚未进入 store”的会话：校验 id/cwd 并构造 {@link Session}（含不可变
   * {@link SessionHeader}）。与 {@link enter} + {@link announce} 配对：拥有复合 ctx.effect 的
   * 调用方（agent 工厂）把会话生命周期折叠进这一个 effect，fiber 卸载时按单一有序链条拆除
   * 会话与 agent，而不是竞态的兄弟 effect——后者会在驱动收尾事件提交之前摘掉发布钩子，导致事件丢失。
   * @param id - 会话 id；省略时 store 生成 session-<n>。
   * @param options - 种子事件与/或头部创建元数据。带 seedSource:'persistence' 时，元数据与事件
   *   必须是所有权转移的新鲜分离对象图：它们经 {@link Session.fromRestore} 就地校验并冻结，
   *   调用方不得再保留可变别名。
   * @returns 已构造但尚未入 store 的会话。
   * @throws 同 id 已存在、元数据不是普通可无损 JSON 记录或标量非法、cwd 非绝对路径时抛出。
   */
  prepare(id?: SessionId, options?: PrepareSessionOptions): Session {
    // 最终采用的会话 id：自动生成时跳过已被占用的编号。
    let sessionId: SessionId
    if (id === undefined) {
      do sessionId = SessionId(`session-${++this.counter}`)
      while (this.store.has(sessionId))
    } else {
      sessionId = SessionId(id)
    }
    if (this.store.has(sessionId)) throw new Error(`session "${sessionId}" already exists`)
    if (options?.seedSource === 'persistence') {
      return Session.fromRestore(sessionId, options.seed, options.meta)
    }
    const seed = options?.seed
    const meta = options?.meta
    // 按 meta 组装头部：缺省字段保持缺席（规范形态）。
    const header: SessionHeader = {
      version: SESSION_FORMAT_VERSION,
      id: sessionId,
      createdAt: meta?.createdAt ?? Date.now(),
      ...meta?.cwd === undefined ? {} : { cwd: meta.cwd },
      ...meta?.parentSession === undefined ? {} : { parentSession: meta.parentSession },
      ...meta?.seedLength === undefined ? {} : { seedLength: meta.seedLength },
      ...meta?.origin === undefined ? {} : { origin: meta.origin },
      ...meta?.delegationDepth === undefined ? {} : { delegationDepth: meta.delegationDepth },
      ...meta?.agentPreset === undefined ? {} : { agentPreset: meta.agentPreset },
    }
    return Session.create(sessionId, seed, header)
  }

  /**
   * Enter a {@link prepare}d session into the store: install the module-private
   * append publication hooks and add it to the store. Returns the DETACH
   * disposer (hooks + store removal). Does NOT emit `session/created` —
   * the caller yields this disposer inside its effect and THEN calls
   * {@link announce}, so a throwing `session/created` listener rolls the attach
   * back instead of leaking it.
   *
   * Re-checks the id for a duplicate: `prepare` and `enter` are public
   * cross-package primitives and a caller may interleave arbitrary work (or
   * another create) between them, so a stale prepared session must NOT overwrite
   * a live store entry of the same id — its detach disposer would later delete
   * the REAL session. The {@link create} convenience and the agent factory call
   * the two back-to-back so they never trip this, but the public API cannot
   * assume that.
   *
   * @param session - a {@link prepare}d session not yet in the store.
   * @returns the detach disposer (publication hooks + store removal). When called from
   *   a synchronous `session/created` listener, removal and disposal wait until
   *   that creation dispatch unwinds.
   * @throws if a session with this id is already in the store.
   */
  /*
   * 把 {@link prepare} 好的会话接入 store：安装模块私有的追加发布钩子并加入映射。
   * 返回 DETACH disposer（摘钩子 + 移出 store）。不发射 session/created——调用方应先把本
   * disposer yield 进自己的 effect，然后再调 {@link announce}，这样 creation 监听器抛错时能回滚
   * attach 而不是泄漏它。
   * 这里会复查 id 冲突：prepare 与 enter 都是公开的跨包原语，两次调用之间可能插入任意工作
   * （甚至另一次 create），陈旧的预备会话绝不能覆盖同 id 的活条目——它的 detach disposer 之后会
   * 误删真正的会话。create 便捷方法与 agent 工厂背靠背调用两者故不会踩雷，但公共 API 不能依赖这一前提。
   * @param session - 一个 prepare 过、尚未入 store 的会话。
   * @returns detach disposer（发布钩子 + store 移除）。若从同步的 session/created 监听器内调用，
   *   移除与释放会推迟到该 creation 分发展开完毕之后。
   * @throws 同 id 会话已在 store 中时抛出。
   */
  enter(session: Session): () => void {
    const id = session.id
    // 会话的作用域载体：决定 scoped 事件分发时谁能收到。
    const carrier = scopeTarget(session, scopeOf(this.ctx))
    // This is the authoritative collision boundary after arbitrary unpublished
    // preparation. Only one exact same-id transaction can publish.
    // 这是“任意未发布预备之后”的权威冲突边界：同一 id 只有一个确切事务能发布。
    if (this.store.has(id)) throw new Error(`session "${id}" already exists`)
    if (attachments.has(session)) throw new Error(`session "${id}" is already attached to a store`)
    // 组装生命周期状态条目并双写：store 映射 + 模块级附件。
    const entry: SessionEntry = {
      id,
      session,
      carrier,
      emitCtx: this.ctx,
      announced: false,
      announcing: false,
      appending: false,
      detachRequested: false,
      detach: () => { this.detachEntered(entry) },
    }
    this.store.set(id, entry)
    attachments.set(session, entry)
    // 一次性守卫：detach 只生效一次。
    let entered = true
    // 延迟分离入口：公告或追加正在进行时改为登记请求，待发布展开后再真正拆除。
    const detach = (): void => {
      if (!entered) return
      entered = false
      // A lifecycle listener may own the advanced detach capability. Keep the
      // entry and its publication hooks live until synchronous creation or append
      // publication unwinds, then publish the paired disposal edge.
      if (entry.announcing || entry.appending) {
        entry.detachRequested = true
        return
      }
      entry.detach()
    }
    return detach
  }

  /** Remove one exact entered session and emit its paired disposal when announced. */
  /* 移除一个确切的已接入会话，并在其已公告时发射配对的销毁通知。 */
  private detachEntered(entry: SessionEntry): void {
    entry.detachRequested = false
    // A stale capability cannot remove observers or storage belonging to a
    // later same-id lifecycle.
    // 陈旧的分离能力不得移除后来同 id 生命周期的观察者或存储。
    /* v8 ignore next -- enter() rejects replacement while this single-shot detach capability is live. */
    if (this.store.get(entry.id) !== entry) return
    this.store.delete(entry.id)
    attachments.delete(entry.session)
    if (entry.announced) this.emitDisposed(entry)
  }

  /** Emit `session/created` exactly once for an {@link enter}ed session (with
   * the carrier {@link enter} captured). Separate from {@link enter} so the
   * caller can yield the detach disposer first (rollback safety — see
   * {@link enter}).
   * @param session - the entered session to announce to listeners.
   * @throws if the session is not live or its announcement already began,
   *   including a reentrant call from a creation listener. */
  /*
   * 为一个已 {@link enter} 的会话恰好发射一次 session/created（携带 enter 时捕获的载体）。
   * 与 enter 分离是为了让调用方能先 yield detach disposer（回滚安全性——见 {@link enter}）。
   * @param session - 要向监听者公告的已接入会话。
   * @throws 会话不存活或其公告已经开始时抛出，包括 creation 监听器内的重入调用。
   */
  announce(session: Session): void {
    const entry = this.liveEntryFor(session)
    if (entry.announced || entry.announcing) {
      throw new Error(`session "${entry.id}" was already announced`)
    }
    // Mark before emit: Cordis emit may deliver to earlier listeners and then
    // throw. Rollback must still pair that partial creation with disposal, and
    // a listener cannot recursively create a second lifecycle edge.
    // 先置位再发射：Cordis 的 emit 可能先送达部分监听器然后抛错；回滚仍需把这次部分创建与
    // disposal 配对，且监听器不能递归制造第二次生命周期边沿。
    entry.announced = true
    const callbackArgs: unknown[] = [session]
    entry.announcing = true
    try {
      const callbacks = collectSessionCallbacks(this.ctx, [entry.carrier, 'session/created', session])
      for (const callback of callbacks) {
        // Synchronous throws intentionally propagate and veto publication; the
        // yielded detach then emits the paired disposal edge. An async function
        // is nevertheless assignable to a void listener, so observe its returned
        // promise: rejection is too late to roll back and must be logged instead
        // of becoming unhandled.
        // 同步抛错有意向上传播并否决发布；随后 yield 的 detach 会发出配对的 disposal 边沿。
        // async 函数也可赋给 void 监听器，所以要观测返回的 promise：拒绝已来不及回滚，
        // 只能记录而不能成为 unhandled。
        const returned: unknown = callback(...callbackArgs)
        void Promise.resolve(returned).catch((error: unknown) => {
          this.ctx.logger.warn(`session "${entry.id}": session/created listener rejected: ${String(error)}`)
        })
      }
    } finally {
      entry.announcing = false
      if (entry.detachRequested && !entry.appending) entry.detach()
    }
  }

  /** Emit the paired teardown notification with per-listener containment. */
  /* 以逐监听器隔离的方式发射配对的拆除通知（session/disposed）。 */
  private emitDisposed(entry: SessionEntry): void {
    const callbackArgs: unknown[] = [entry.session]
    try {
      const callbacks = collectSessionCallbacks(this.ctx, [entry.carrier, 'session/disposed', entry.session])
      invokeContainedSessionObservers(this.ctx, 'session/disposed', entry.id, callbackArgs, callbacks)
    } catch (error: unknown) {
      this.ctx.logger.warn(`session "${entry.id}": session/disposed dispatch threw: ${String(error)}`)
    }
  }

  /**
   * Dispatch the awaited `session/flush` durability checkpoint for `session`,
   * with the carrier captured at {@link enter}. THE flush entry point: the
   * store owns the carrier, so callers (the checkpoint policy's per-request
   * barrier, goal-round-driver's idle checkpoint, teardown drains, and consumers
   * that flush themselves before reading storage) must come through here
   * rather than dispatch a raw `ctx.parallel('session/flush', …)` — one owner,
   * one spelling, and the scoped-dispatch invariant can pin it.
   * @param session - the session whose buffered events must reach durable storage.
   * @returns whether at least one durability listener participated, after every
   *   listener has settled successfully.
   * @throws the first registered listener failure after every listener settles.
   */
  /*
   * 为会话分发“被 await 的” session/flush 持久化检查点，载体取自 {@link enter} 时捕获的那个。
   * 这是唯一的 flush 入口：store 拥有载体，因此各方（检查点策略的每请求屏障、goal 轮驱动的空闲
   * 检查点、拆除冲刷、以及读存储前自行冲刷的消费者）都必须经由此处，而不是自行派发原始的
   * ctx.parallel('session/flush', …)——单一属主、单一拼写，scoped 分发不变量才能钉住它。
   * @param session - 其缓冲事件必须到达耐久存储的会话。
   * @returns 在所有监听器成功落定后，是否至少有一个持久化监听器参与了。
   * @throws 在所有监听器落定后，重新抛出第一个失败的监听器异常。
   */
  async flush(session: Session): Promise<boolean> {
    const { carrier } = this.liveEntryFor(session)
    const callbackArgs: unknown[] = [session]
    const callbacks = collectSessionCallbacks(this.ctx, [carrier, 'session/flush', session])
    const results = await Promise.allSettled(callbacks.map((callback) => {
      try {
        return callback(...callbackArgs)
      } catch (error: unknown) {
        // Preserve the listener's exact rejection value; flush is a caller-owned
        // failure boundary, and Cordis listeners may throw arbitrary values.
        // 原样保留监听器的拒绝值：flush 是调用方拥有的失败边界，而 Cordis 监听器可能抛出任意值。
        // oxlint-disable-next-line typescript/prefer-promise-reject-errors
        return Promise.reject(error)
      }
    }))
    const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
    if (failure !== undefined) throw failure.reason
    return callbacks.length > 0
  }

  /** Return the exact live entry; detached/prepared objects reject. */
  /* 返回确切的存活条目；已分离/仅预备的对象会抛错。 */
  private liveEntryFor(session: Session): SessionEntry {
    const entry = attachments.get(session)
    if (entry === undefined || this.store.get(entry.id) !== entry) {
      throw new Error(`session "${session.id}" is not live in this store`)
    }
    return entry
  }

  /**
   * Look up a live session.
   * @param id - the session id to look up.
   * @returns the session, or undefined when no live session has that id.
   */
  get(id: SessionId): Session | undefined {
    return this.store.get(id)?.session
  }

  /**
   * All live sessions, in creation order.
   * @returns a fresh array; mutating it does not affect the store.
   */
  list(): Session[] {
    return [...this.store.values()].map(entry => entry.session)
  }

  /**
   * Create a live child session from a stable prefix of a live source.
   * `boundary` is an inclusive source event seq; omitted means the source's
   * current last event. The selected slice may end with a between-turn event
   * but must not end inside an open turn.
   *
   * @param source - Live source session object or id.
   * @param boundary - Inclusive source event seq to fork through; omitted means
   *   the source's current last event, and omitted on an empty source forks an
   *   empty child.
   * @param childSessionId - Optional child session id; omitted delegates to
   *   `SessionStore`'s id policy.
   * @returns The created live child session.
   */
  /*
   * 从一个存活来源的稳定前缀创建活的子会话。boundary 是含端点的来源事件 seq；
   * 缺省取来源当前最后一个事件。所选切片可以止于轮次之间的事件，但不能停在未闭合的轮次内。
   * @param source - 存活的来源会话对象或 id。
   * @param boundary - fork 到（含）的来源事件 seq；缺省为来源最后一个事件，
   *   空来源缺省则得到空子会话。
   * @param childSessionId - 可选的子会话 id；缺省沿用 SessionStore 的 id 策略。
   * @returns 创建出的存活子会话。
   */
  fork(source: SessionForkSource, boundary?: number, childSessionId?: SessionId): Session {
    if (childSessionId !== undefined && this.get(childSessionId) !== undefined) {
      throw new SessionForkError(`session "${childSessionId}" already exists`, 'SESSION_ALREADY_EXISTS')
    }
    const liveSource = this._resolveForkSource(source)
    const seed = this._forkSeed(liveSource, boundary)
    return this.create(childSessionId, {
      seed,
      meta: {
        ...liveSource.header.cwd !== undefined ? { cwd: liveSource.header.cwd } : {},
        parentSession: liveSource.id,
        seedLength: seed.length,
      },
    })
  }

  // 计算 fork 的种子切片：校验边界合法性（安全整数、确实存在、不在开轮次内），返回日志前缀切片。
  private _forkSeed(session: Session, requestedBoundary: number | undefined): SessionEvent[] {
    const events = session.events
    const lastEvent = events.at(-1)
    // 实际生效的 fork 边界：未指定时取最后一个事件的 seq。
    let boundary: number
    if (requestedBoundary !== undefined) {
      boundary = requestedBoundary
    } else {
      if (lastEvent === undefined) return []
      boundary = lastEvent.seq
    }
    if (!Number.isSafeInteger(boundary) || boundary < 0) {
      throw new SessionForkError(
        `fork boundary for session "${session.id}" must be a non-negative safe integer, got ${String(boundary)}`,
        'INVALID_BOUNDARY',
      )
    }
    if (boundary >= events.length) {
      const lastSeq = events.at(-1)?.seq
      throw new SessionForkError(
        `fork boundary ${boundary} does not exist in session "${session.id}" (last seq: ${lastSeq ?? 'none'})`,
        'INVALID_BOUNDARY',
      )
    }

    const boundaryEvent = events[boundary]
    if (boundaryEvent === undefined || boundaryEvent.seq !== boundary) {
      throw new SessionForkError(
        `fork boundary ${boundary} does not match a contiguous event seq in session "${session.id}"`,
        'INVALID_BOUNDARY',
      )
    }
    const lastTurnBoundary = events.slice(0, boundary + 1)
      .findLast(event => event.type === 'turn/start' || event.type === 'turn/end')
    if (lastTurnBoundary?.type === 'turn/start') {
      throw new SessionForkError(
        `fork boundary ${boundary} in session "${session.id}" ends inside open turn ${lastTurnBoundary.data.turn}`,
        'OPEN_TURN',
      )
    }

    return events.slice(0, boundary + 1)
  }

  // 解析 fork 来源：id 必须存在于 store；对象必须是 store 中那个活的同一实例。
  private _resolveForkSource(source: SessionForkSource): Session {
    if (typeof source === 'string') {
      const session = this.get(source)
      if (session === undefined) throw new SessionForkError(`session "${source}" not found`, 'SESSION_NOT_FOUND')
      return session
    }

    const live = this.get(source.id)
    if (live === undefined) {
      throw new SessionForkError(`session "${source.id}" not found`, 'SESSION_NOT_FOUND')
    }
    if (live !== source) throw new SessionForkError(`session "${source.id}" is not the live store instance`, 'SESSION_NOT_LIVE')
    return source
  }

}

export default SessionStore
