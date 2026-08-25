/*
 * ================================ 文件注释 ================================
 * 【文件职责】dsh-agent 插件本体：AgentRegistry 服务（ctx.agents）维护在线 agent 注册表，并提供进程内“发起者（initiator）”作用域链；智能体的具体创建由 AgentLoop 工厂实现。
 * 【技术维度】Cordis Service + AsyncLocalStorage 传播发起者；事件带作用域载体（Scoped<Agent>）分发；factory 经 getTraceable 重定向到调用者上下文，使所有权跟随调用者。
 * 【产品维度】这是所有 agent 能力的中枢：创建/恢复/查询 agent、事件订阅、以及“当前由哪个 agent 发起”的因果归属，供日志、指标、宿主归因使用。
 * 【逻辑维度】类型与事件声明（AgentSetup/Handle/Factory/Events 合并）→ AgentRegistry（注册表 + enter/announce 两段式发布）
 * → 发起者管理（withInitiator/runWithInitiator/关闭与排空）。
 * 【关键边界】注册表是权威碰撞边界：同 id 只能有一个 live 条目；enter 与 announce 分离以支持异步工厂的“先 setup 后发布”；发起者链在 teardown 时排空但不等待自身排空。
 * 【新手阅读建议】先读 AgentFactory 接口了解“创建者”契约，再看 AgentRegistry 的 enter/announce/detachEntered 顺序发布逻辑，最后看发起者（initiator）三个公开方法。
 * ==========================================================================
 */
/**
 * Agent service: live registry, factory delegation, and process-local
 * initiator scope. Concrete creation and driving belong to the loop.
 *
 * @module @deepseek-ai/dsh-agent
 */

import { Context, FiberState, getTraceable, Service, symbols } from '@deepseek-ai/cordis'
import type { Fiber } from '@deepseek-ai/cordis'
import { AsyncLocalStorage } from 'node:async_hooks'
import { isPromise } from 'node:util/types'
import { scopeTarget } from '@deepseek-ai/dsh-scope'
import type { Scoped } from '@deepseek-ai/dsh-scope'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import type { TypertContext, TypertLookup } from '@deepseek-ai/dsh-typert-protocol'
import type { Agent, AgentOptions } from './runtime-types.ts'

export * from './runtime-types.ts'
export * from './types.ts'
export * from './inbox.ts'
export * from './consumed-work.ts'
export * from './model-selection.ts'
export { agentCarrier, agentEvents, assembleContextFor, emitAgentEvent } from './dispatch.ts'
export type { AgentEventDispatch, AgentSubjectEvent } from './dispatch.ts'

// 向 typert 协议注册 agent 的查找/上下文映射：让 agentId 能跨 wire/宿主类型解析。
declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertLookupMap {
    agent: TypertLookup<Agent, SessionId>
  }

  interface TypertContextMap {
    agent: TypertContext<SessionId>
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    agents: AgentRegistry
    /**
     * The agent association installed as an own property on `Agent.ctx`, or
     * `undefined` on a plain context. Contexts derived from `Agent.ctx` inherit
     * the association; a deliberately nested scope may carry a nearer
     * `dsh-scope` tag while retaining it, so this field is DX context rather
     * than the scope resolver. {@link AgentRegistry} registers a root accessor
     * defaulting to `undefined`, and core packages below the agent layer use
     * `scopeOf()` for layer selection instead of reading this field.
     */
    // ctx.agent：Agent.ctx 上的 agent 关联（开发体验字段），普通上下文为 undefined；
    // 底层包做分层选择时用 scopeOf()，不直接读它。
    agent?: Agent
  }
}

/**
 * Synchronous finalizer returned by unpublished Agent setup when its
 * contributions need validation at the exact publication commit point.
 */
// 未发布 agent 的 setup 可返回的“同步收尾器”：在发布提交点做最终校验。
export interface AgentSetupCommit {
  /**
   * Validate and commit the prepared setup immediately before publication.
   * @throws when publication must roll the unpublished Agent back.
   */
  // 立即校验并提交；抛错会让发布回滚。
  commit(): void
}

/**
 * Compose an unpublished Agent scope and optionally return its publication commit.
 * @param agentCtx - unpublished Agent scope.
 * @returns an optional synchronous commit invoked after setup awaits settle and immediately before publication.
 */
// setup 回调签名：接收未发布的 agent 作用域，返回可选的发布提交器。
export type AgentSetup = (
  agentCtx: Context,
) => AgentSetupCommit | Promise<AgentSetupCommit | void> | void

/**
 * Options for programmatically creating an agent through the registry factory
 * ({@link AgentRegistry.create}). The caller supplies the single live
 * `sessionId` shared by the agent registry and session log (e.g. an
 * ACP-generated id), plus optional session metadata (the validated `cwd`, fork
 * lineage); the factory creates the session and agent under that identity.
 */
// 编程式创建 agent 的选项：调用方提供唯一的 sessionId（agent 注册表与会话日志共享），
// 工厂在该身份下创建会话与 agent。
export interface CreateAgentOptions {
  /** The live agent/session identity. */
  // 在线 agent/会话共享身份。
  readonly sessionId: SessionId
  /**
   * Session creation metadata: validated absolute `cwd`, `parentSession`
   * fork lineage, the `seedLength` seed boundary, the coarse `origin`
   * classification, and the `delegationDepth` recursion budget. Mirrors the
   * `cwd`/`parentSession`/`seedLength`/`origin`/`delegationDepth` fields of
   * {@link CreateSessionOptions.meta} in dsh-session (the internal-only
   * `createdAt`, used when reconstructing a persisted session, is deliberately
   * excluded — a factory caller never sets it). This is durable session data,
   * so the session boundary validates and snapshots it before asynchronous
   * setup begins.
   */
  // 会话创建元数据：校验过的 cwd、fork 谱系（parentSession）、种子边界、粗粒度来源与递归深度预算。
  // 属持久化会话数据，异步 setup 开始前由会话边界校验并快照。
  readonly meta?: {
    readonly cwd?: string
    readonly parentSession?: SessionId
    readonly seedLength?: number
    readonly origin?: 'subagent'
    readonly delegationDepth?: number
    readonly agentPreset?: string
  }
  /**
   * Initial replay/fork history. A fork supplies a balanced completed-turn
   * prefix of the parent's log. The complete seed must be contiguous from seq
   * 0, carry only lossless-JSON data, and contain no open turn/step or dangling
   * tool call. The factory passes it to the session's durable
   * validator/snapshot boundary before publication.
   */
  // 初始回放/分支历史：从 seq 0 开始连续、只含无损 JSON 数据、无未闭合轮次/步骤或悬空工具调用。
  readonly seed?: readonly SessionEvent[]
  /** Per-agent options (model, …). */
  // 每个 agent 的选项（模型等）。
  readonly agentOptions?: AgentOptions
  /** Optional creation-only cancellation signal; detached before the returned handle becomes visible. */
  // 仅创建期的取消信号；返回句柄可见前会被摘除。
  readonly signal?: AbortSignal
  /**
   * Creation-time composition of the agent's scoped world. The factory awaits
   * setup after minting `agentCtx` but BEFORE inserting or announcing either
   * the session or agent, so observers can never see a partially configured
   * world. Setup may return an {@link AgentSetupCommit}; the factory invokes its
   * synchronous `commit()` after every setup await settles and immediately
   * before registry publication. This lets mutable provisioning revalidate at
   * the exact publication boundary. Everything registered through `agentCtx`
   * (scoped tools, prompt sections/variables, `restrict()`, listeners, awaited
   * child plugins) exists before `session/created`, `agent/created`,
   * `agent/session-start`, and the first prompt assembly. A setup
   * throw/rejection, commit throw, or owner disposal rolls the scope back
   * without publishing either id.
   *
   * **Setup composes, it never drives**: the callback is trusted same-process
   * code and receives the full scoped context, so this is a contract rather
   * than a runtime restriction. Drive the agent only after creation resolves.
   */
  // 创建期组合回调：工厂在插入/发布会话与 agent 之前 await setup，保证观察者永远看不到“半配置”的世界；
  // setup 只负责组合、绝不驱动（驱动必须等创建完成后）。
  readonly setup?: AgentSetup
}

/**
 * Options for resuming an agent on a persisted session
 * ({@link AgentRegistry.resume}).
 */
// 在持久化会话上恢复 agent 的选项。
export interface ResumeAgentOptions {
  /** The persisted session id to load and use as the live agent/session identity. */
  // 要加载的持久化会话 id（同时作为在线身份）。
  readonly resumeSessionId: SessionId
  /** Per-agent options (model, …). */
  // 每个 agent 的选项（模型等）。
  readonly agentOptions?: AgentOptions
  /** Optional creation-only cancellation signal for persistence load/setup; detached before return. */
  // 仅加载/setup 期的取消信号；返回前摘除。
  readonly signal?: AbortSignal
  /**
   * Resume-time composition of the agent's fresh scoped world. Persistence is
   * loaded first; the factory then mints `agentCtx` and awaits setup while the
   * reconstructed session and agent remain unpublished. The callback has the
   * same trusted composition-only contract and optional synchronous
   * publication commit as {@link CreateAgentOptions.setup}: all registrations
   * exist before either creation announcement, and rejection, commit failure,
   * or owner disposal rolls the transaction back without publishing either id.
   */
  // 恢复期组合回调：持久化先加载，工厂再 mint agentCtx 并 await setup（此时会话与 agent 仍未发布）。
  readonly setup?: AgentSetup
}

/**
 * An owned agent plus its disposer, returned by {@link AgentRegistry.create} /
 * {@link AgentRegistry.resume}. The disposer is a CAPABILITY: among consumers,
 * only the holder can tear this agent down. The registered factory provider is
 * also a structural owner because the scoped agent depends on that provider's
 * service API; provider unload stops and drains every live handle it made.
 * `dispose()` stops the loop, awaits its exit, unregisters the agent, removes
 * its session from the store, and finally unwinds its scoped world.
 *
 * `ctx.agents.get(id)` still returns a bare {@link Agent} — the handle is
 * exposed only to the consumer owner that created it; the structural provider
 * reaches the same teardown internally. Config-created agents (the loop's own
 * startup) are owned by the loop fiber and never need a handle.
 */
// 受管 agent + 拆除器：dispose() 是“能力”（capability），只有持有句柄者能拆除；
// 工厂提供方因结构依赖也算所有者，其卸载会停止并排空所有 live 句柄。
export interface AgentHandle {
  agent: Agent
  dispose(): Promise<void>
}

/**
 * The agent-creation factory the loop implementation provides to the registry
 * via {@link AgentRegistry.setFactory}. Kept on the `dsh-agent` interface so
 * consumers (e.g. the ACP bridge) program against `ctx.agents` without
 * depending on the concrete `dsh-agent-loop` package.
 */
// agent 创建工厂接口：由 agent-loop 实现并注册；消费方只依赖本接口，不依赖具体实现包。
export interface AgentFactory {
  /**
   * Create a new agent on a caller-supplied session id. Async because creation
   * awaits unpublished setup, invokes its optional synchronous commit, inserts
   * both session and agent, emits their creation notifications in order, emits
   * `agent/session-start`, and only then starts the loop. The sequence is
   * rollback-covered, but notifications delivered before a later listener
   * failure remain observable; every agent or session creation announcement
   * that began is paired by `agent/disposed` or `session/disposed` during
   * rollback. The owner disposes the resolved handle to stop/drain,
   * unregister, remove the session, and unwind the scope.
   * The registry passes a context carrying the `create()` caller's fiber and
   * scope as `ownerCtx`. The implementation attaches the unpublished
   * transaction and resulting lifecycle to that owner; it must not infer
   * ownership from the factory object's registration context.
   * @param ownerCtx - caller-bound context that owns the transaction and live handle.
   * @param options - agent/session identity, configuration, and optional setup.
   * @returns the owned handle after setup, both announcements, and loop start complete.
   */
  // 创建 agent：等待 setup → 调用可选 commit → 按序插入/发布会话与 agent → 发 session-start → 启动循环；
  // 全程可回滚，但已投递的通知在后续监听器失败后仍可被观察到。
  createAgent(ownerCtx: Context, options: CreateAgentOptions): Promise<AgentHandle>
  /**
   * Prepare a persisted session and resume an agent on it. Async because it awaits
   * both `ctx.sessionPersistence.prepare` and the optional unpublished setup
   * transaction; must be called after that service exists (consumers inject
   * `sessionPersistence`). Publication follows the same setup-commit and
   * ordered boundary as {@link createAgent}.
   * @param ownerCtx - caller-bound context that owns load, setup, and the live handle.
   * @param options - persisted identity, configuration, and optional setup.
   * @returns the owned handle after setup, both announcements, and loop start complete.
   */
  // 恢复 agent：先经 sessionPersistence.prepare 加载持久化会话，再走与 createAgent 相同的 setup/发布边界。
  resume(ownerCtx: Context, options: ResumeAgentOptions): Promise<AgentHandle>
}

/** Thrown when create/resume is called before an agent factory is registered. */
// 工厂未注册时 create/resume 抛出的错误文案。
const NO_FACTORY_MESSAGE = 'no agent factory registered (load an agent-loop plugin)'
// 不在任何发起者边界内却调用 requireInitiator 时的错误文案。
const NO_INITIATOR_MESSAGE = 'no initiating agent is active'
// 发起者作用域已处置（关闭/排空完成）时的错误文案。
const DISPOSED_INITIATOR_MESSAGE = 'agent initiator scope is disposed'

/** All mutable lifecycle state for one exact registry entry. */
// 注册表中一个条目的全部可变生命周期状态。
interface AgentEntry {
  readonly id: SessionId
  readonly agent: Agent
  /** Runtime creator-agent ownership; independent of durable session lineage. */
  // 运行时“创建者 agent”归属；与持久化的会话谱系无关。
  readonly owner: Agent | undefined
  readonly carrier: Scoped<Agent>
  // 是否已对外发布过 agent/created。
  announced: boolean
  // 是否正在发布中（防止创建监听器重入再次 announce）。
  announcing: boolean
  // 是否在发布期间被请求 detach（发布派发展开后执行真正的拆除）。
  detachRequested: boolean
}

/** One tracked boundary plus its inherited nesting chain. */
// 一次被跟踪的发起者边界及其继承的嵌套链（供重入排空使用）。
interface InitiatorRun {
  active: boolean
  readonly parent: InitiatorRun | undefined
}

/** Plain holder prevents Cordis from tracing the factory field before the caller context is known. */
// 普通持有者：在知道调用者上下文之前，避免 Cordis 对工厂字段做依赖追踪（延迟到调用时重追踪）。
interface FactorySlot {
  readonly target: AgentFactory
}

/**
 * Agent service (`ctx.agents`): tracks live agents and carries the initiating
 * Agent through one process-local asynchronous driver chain. Agent *creation*
 * is provided by whichever plugin implements the {@link AgentFactory}
 * (`@deepseek-ai/dsh-agent-loop`), registered via {@link setFactory}.
 *
 * Initiator methods provide same-process causal attribution only. Ambient
 * presence is neither liveness proof nor authorization; subjects and owners
 * remain explicit, as does identity at worker, process, persistence, and wire
 * boundaries. Returned Promise boundaries drain during teardown, except a
 * nested lineage that starts an owning-fiber unload is excluded from its own drain.
 */
// AgentRegistry：在线 agent 注册表 + 进程内“发起者”传播。创建能力由 AgentLoop 工厂提供，
// 发起者方法只做同进程因果归属，不构成存活证明或授权。
export class AgentRegistry extends Service {
  // 注册表本体：sessionId → 条目。这是权威碰撞边界，同 id 只允许一个 live 条目。
  private store = new Map<SessionId, AgentEntry>()
  // 工厂槽位：由 setFactory 注册（agent-loop 构造时调用），create/resume 都委托给它。
  private factory: FactorySlot | undefined
  // 发起者存储：AsyncLocalStorage 让“当前由哪个 agent 发起”在异步链上自动传播。
  private readonly initiators = new AsyncLocalStorage<Agent | undefined>()
  // 发起者运行边界栈：跟踪嵌套的 withInitiator/withoutInitiator 调用，供重入排空。
  private readonly initiatorRuns = new AsyncLocalStorage<InitiatorRun>()
  // 发起者生命周期状态：active（可开新边界）→ closing（只允许排空）→ disposed（彻底关闭）。
  private initiatorState: 'active' | 'closing' | 'disposed' = 'active'
  // 当前活跃的发起者边界数；归零时 resolve 排空承诺。
  private activeInitiatorRuns = 0
  // 排空承诺：等待所有返回 Promise 的边界结算。
  private initiatorDrain: PromiseWithResolvers<void> | undefined
  // 一次性拆除承诺：幂等，多个拆除请求共享同一完成。
  private initiatorDisposal: Promise<void> | undefined

  constructor(ctx: Context) {
    super(ctx, 'agents')
    // 注册 typert 查找：把 agentId 在 wire 与宿主类型间转换，供类型图协议解析。
    ctx.inject(['typert'], (typeCtx) => {
      typeCtx.typert.lookups.register('agent', {
        parameter: 'agent',
        wire: 'agentId',
        hostTypeSymbol: '@deepseek-ai/dsh-agent#Agent',
        wireTypeSymbol: '@deepseek-ai/dsh-session/types#SessionId',
        resolve: sessionId => this.get(sessionId),
      })
      typeCtx.typert.contexts.registerHost('agent', {
        wire: 'agentId',
        wireTypeSymbol: '@deepseek-ai/dsh-session/types#SessionId',
        resolve: sessionId => this.get(sessionId)?.ctx,
      })
    })
    // The `ctx.agent` DX accessor: default `undefined` on every context, so a
    // plain plugin context reads cleanly instead of hitting the Cordis
    // unknown-property throw. Each Agent.ctx shadows it with an own property
    // (own properties resolve before the context proxy is consulted), so the
    // accessor body never needs to resolve a scope itself. Effect-scoped:
    // unwinds with this service's fiber.
    // ctx.agent 访问器：默认 undefined，让普通插件上下文干净可读；Agent.ctx 用自有属性遮蔽它。
    ctx.accessor('agent', { get: () => undefined })
    // 任一祖先纤维开始卸载时，关闭发起者（不再接受新边界，只排空已开始的）。
    ctx.on('internal/status', (fiber) => {
      if (fiber.state === FiberState.UNLOADING && this.hasLifecycleAncestor(fiber)) {
        this.closeInitiators()
      }
    })
    // 生命周期：先排空并关闭发起者，随服务纤维拆除。
    ctx.effect(function* (this: AgentRegistry) {
      yield () => this.disposeInitiators()
      yield () => { this.closeInitiators() }
    }.bind(this), 'agents.initiatorLifecycle()')
  }

  /**
   * Read the Agent that initiated the inherited asynchronous driver chain.
   * Use this optional form for logging, tracing, metrics, or host attribution
   * that also supports agentless calls. When a parent creates a child, setup
   * reports the causal parent while `agentCtx.agent` identifies the child.
   * @returns the inherited Agent, or `undefined` outside an initiator boundary
   *   and inside an explicit clearing boundary.
   * @throws when this service instance has been disposed.
   */
  // 可选读发起者：日志/追踪/指标/宿主归因用它；无边界或显式清除边界时返回 undefined。
  currentInitiator(): Agent | undefined {
    this.assertInitiatorsReadable()
    return this.initiators.getStore()
  }

  /**
   * Read the initiating Agent and fail when no initiator boundary is active.
   * Use this for private helpers contractually below a driver, or for a
   * deployment-owned outbound request whose contract forbids agentless calls.
   * Generic or direct-call paths use optional lookup or explicit request fields.
   * @returns the inherited Agent.
   * @throws when no initiator is active or this service instance has been disposed.
   */
  // 强读发起者：契约上“必然在驱动之下”的私有助手用它，无边界直接抛错。
  requireInitiator(): Agent {
    const agent = this.currentInitiator()
    if (agent === undefined) throw new Error(NO_INITIATOR_MESSAGE)
    return agent
  }

  /**
   * Run an operation with one exact Agent as its process-local initiator. The
   * exact synchronous value or Promise returned by the operation is preserved.
   * Custom drivers and test harnesses wrap their complete returned foreground
   * lifetime.
   * A queue or wire receiver may establish this boundary only after validating
   * explicit identity and resolving the exact live Agent; this method does neither.
   * Detached work remains owned by the subsystem that starts it.
   * @param agent - initiating Agent to inherit; presence is neither liveness proof nor authorization.
   * @param operation - synchronous or asynchronous operation to invoke.
   * @returns the exact value returned by `operation`.
   * @throws when the initiator scope is closing/disposed, or when `operation` throws.
   */
  // 以指定 agent 为发起者运行操作（同步值或 Promise 原样返回）。注意：传入的 agent 是否存活/授权由调用方负责。
  withInitiator<T>(agent: Agent, operation: () => T): T {
    return this.runWithInitiator(agent, operation)
  }

  /**
   * Run an operation inside a boundary that hides any inherited initiating
   * Agent. The exact synchronous value or Promise is preserved.
   * Use this while creating lazy shared timers, queue pumps, pool maintenance,
   * watchers, or exporters so they do not inherit the first Agent that happens
   * to initialize them. It clears only initiator attribution, not explicit
   * fields, and does not own or drain detached resources.
   * @param operation - synchronous or asynchronous operation to invoke without an initiator.
   * @returns the exact value returned by `operation`.
   * @throws when the initiator scope is closing/disposed, or when `operation` throws.
   */
  // 清除边界：让共享定时器/队列泵/导出器等不继承“第一个碰巧初始化它们的 agent”。
  withoutInitiator<T>(operation: () => T): T {
    return this.runWithInitiator(undefined, operation)
  }

  /**
   * Register the agent-creation factory (the loop calls this on construction,
   * effect-scoped). A traced Cordis service is canonicalized to its concrete
   * target; each create/resume call is then traced through that caller's
   * context so ownership follows the caller without stacking proxy layers.
   * Throws if a factory is already registered. Returns the disposer; on
   * dispose the factory slot is cleared.
   * @param factory - the loop-owned factory {@link create}/{@link resume} delegate to.
   * @returns the disposer that clears the factory slot. The exact
   *   Cordis effect disposer (single-shot): composite (generator) effects may
   *   yield it directly — exact identity nests the teardown in order.
   */
  // 注册创建工厂：agent-loop 构造时调用；重复注册会抛错；返回的拆除器清空槽位。
  setFactory(factory: AgentFactory): () => void {
    const dispose = this.ctx.effect(() => {
      if (this.factory !== undefined) throw new Error('an agent factory is already registered')
      // Avoid stacking two Cordis shadow layers when a caller passes a Service
      // already read through a context. Calls are re-traced through their
      // actual owner context below.
      // 若传入的是已透过上下文读取的 Service，剥壳取回原始目标，避免叠加两层 Cordis 影子。
      const target = (factory as AgentFactory & { [symbols.original]?: AgentFactory })[symbols.original] ?? factory
      this.factory = { target }
      return () => { this.factory = undefined }
    }, 'agents.setFactory()')
    // The exact cordis effect disposer (the agents.register() convention): a
    // caller's composite effect can yield it for in-order teardown; the
    // loop's constructor effect returns it directly, identity-nesting the
    // registration under that effect.
    // 直接返回精确的 effect 拆除器：保持身份，让复合 effect 能按序嵌套拆除。
    // oxlint-disable-next-line typescript/no-misused-promises -- synchronous cleanup; direct return preserves disposer identity
    return dispose
  }

  /** Return the active creation factory. */
  // 取当前工厂；未注册则抛错（提示加载 agent-loop 插件）。
  private requireFactory(): FactorySlot {
    if (this.factory === undefined) throw new Error(NO_FACTORY_MESSAGE)
    return this.factory
  }

  /**
   * Create and publish a new agent through the registered factory.
   * Distinct from {@link register} (which records an already-constructed
   * agent): this constructs the agent and its session. Rejects if no factory is
   * registered or creation/setup fails. The resolved {@link AgentHandle} lets
   * the owner tear down exactly this agent.
   * @param options - shared identity, session seed/metadata, and agent options.
   * @returns the handle after setup, rollback-covered publication, and loop start complete.
   */
  // 编程式创建：把调用者上下文与工厂绑定后委托给 factory.createAgent。
  async create(options: CreateAgentOptions): Promise<AgentHandle> {
    const ownerCtx = this.ctx
    // Re-trace a Service-backed factory through the accessing context
    // explicitly. This preserves AgentLoop's dependency origin while binding
    // its effects to ownerCtx; plain factories receive ownerCtx as an explicit
    // capability and need no Cordis tracker magic.
    // 显式把 Service 型工厂重新追踪到访问者上下文：保留 AgentLoop 的依赖来源，同时把 effect 绑到 ownerCtx。
    const { target } = this.requireFactory()
    const receiver = getTraceable(ownerCtx, target)
    // oxlint-disable-next-line typescript/unbound-method -- Reflect.apply intentionally supplies the caller-traced receiver
    return Reflect.apply(target.createAgent, receiver, [ownerCtx, options])
  }

  /**
   * Load a persisted session and resume an agent on it through the registered
   * factory. Rejects if no factory is registered; the factory rejects if
   * session persistence is not configured or persistence/setup fails.
   * @param options - persisted identity, configuration, and optional setup.
   * @returns the handle after setup, rollback-covered publication, and loop start complete.
   */
  // 编程式恢复：加载持久化会话并委托给 factory.resume。
  async resume(options: ResumeAgentOptions): Promise<AgentHandle> {
    const ownerCtx = this.ctx
    const { target } = this.requireFactory()
    const receiver = getTraceable(ownerCtx, target)
    // oxlint-disable-next-line typescript/unbound-method -- Reflect.apply intentionally supplies the caller-traced receiver
    return Reflect.apply(target.resume, receiver, [ownerCtx, options])
  }

  /**
   * Register a live agent. Throws if an agent with the same id is already
   * registered. Emits `agent/created` on registration and `agent/disposed`
   * when the calling fiber is disposed — both with the agent's scope carrier
   * (`scopeTarget(agent, agent)`): the subject is the agent in hand, so the
   * emits are scope-filtered regardless of which context invoked `register`
   * (calling through `agent.ctx` scopes EFFECTS; dispatch scoping always
   * requires passing the carrier). Returns the disposer.
   * @param agent - the already-constructed agent to record in the store.
   * @returns the EXACT Cordis effect disposer (single-shot; a repeat call
   *   returns undefined without awaiting an in-flight teardown). Exact
   *   identity is load-bearing: a composite (generator) effect that owns a
   *   teardown ORDER — the agent factory's lifecycle chain — must yield THIS
   *   function so Cordis nests the unregistration at that yield position;
   *   yielding a wrapper would leave it disposing as a concurrent sibling on
   *   owner unload, unregistering the agent (and emitting `agent/disposed`)
   *   while its final turn is still draining.
   */
  // 常规注册：为已构造好的 agent 建条目并发布（enter + announce 的合并便捷形式）；
  // 返回的必须是“精确的 effect 拆除器”——复合 effect 需按序 yield 它，保证拆除顺序正确。
  register(agent: Agent): () => void {
    const dispose = this.ctx.effect(function* (this: AgentRegistry) {
      yield this.enter(agent, this.ctx.agent)
      this.announce(agent)
    }.bind(this), 'agents.register()')
    // oxlint-disable-next-line typescript/no-misused-promises -- synchronous cleanup; direct return preserves disposer identity
    return dispose
  }

  /**
   * Insert an already-constructed agent without announcing it. This is the
   * advanced ordered-lifecycle primitive used by the async agent factory: it
   * first completes setup while the agent is unpublished, then assigns the
   * returned detach closure into its pre-installed composite teardown before
   * calling {@link announce}. Ordinary callers use {@link register}.
   * @param agent - the prepared, unpublished agent.
   * @param owner - live agent whose scoped context created this agent, or
   *   undefined for a top-level runtime root. This is runtime ownership, not
   *   the resumed session's durable parent lineage.
   * @returns an idempotent closure that removes this exact entry and emits
   *   `agent/disposed` with listener failures contained. When called from a
   *   synchronous `agent/created` listener, removal and disposal wait until
   *   that creation dispatch unwinds.
   */
  // 两段式发布的第一段：只插入不发布。返回的 detach 是幂等闭包；
  // 若在 announce 分发中被调用，会等创建分发展开后再真正拆除。
  enter(agent: Agent, owner: Agent | undefined): () => void {
    const id = agent.id
    // 身份一致性硬约束：agent 与 session 必须共享同一 id。
    if (id !== agent.session.id) {
      throw new Error(`agent id "${id}" does not match session id "${agent.session.id}"`)
    }
    const carrier = scopeTarget(agent, agent)
    // This is the authoritative collision boundary. Concurrent create/resume
    // operations may both prepare, but only one exact entry can publish.
    // 权威碰撞边界：并发 create/resume 可能同时准备，但同一身份只有一处能发布。
    if (this.store.has(id)) throw new Error(`agent "${id}" is already registered`)
    const entry: AgentEntry = {
      id,
      agent,
      owner,
      carrier,
      announced: false,
      announcing: false,
      detachRequested: false,
    }
    this.store.set(id, entry)
    let entered = true
    const detach = (): void => {
      if (!entered) return
      entered = false
      // Every callback reached by this creation dispatch must observe the same
      // live entry, and disposal must follow creation. A listener may own
      // the advanced detach capability, so make that ordering structural:
      // visibility and the paired disposal are deferred until announce()'s
      // synchronous dispatch has unwound.
      // 若仍在 announce 的同步分发中：先标记 detachRequested，等分发展开后再拆——保证
      // “每个回调看到的都是同一个 live 条目，且处置必然发生在创建之后”。
      if (entry.announcing) {
        entry.detachRequested = true
        return
      }
      this.detachEntered(entry)
    }
    return detach
  }

  /** Remove one exact entered agent and emit its paired disposal when announced. */
  // 真正移除条目；仅当该条目已 announce 过才补发 agent/disposed（未发布过就静默删除）。
  private detachEntered(entry: AgentEntry): void {
    entry.detachRequested = false
    // A stale capability can never delete a later same-id lifecycle. The
    // captured entry identity is the final boundary.
    // 过期能力绝不能误删“后来的同 id 生命周期”：以捕获的条目身份为最终边界。
    /* v8 ignore next -- enter() rejects replacement while this single-shot detach capability is live. */
    if (this.store.get(entry.id) !== entry) return
    this.store.delete(entry.id)
    // An insertion rolled back before announce was never externally created,
    // so emitting disposed would invent an impossible lifecycle edge. Marking
    // happens before the created emit: if a later created listener throws,
    // earlier listeners may already have observed it and must see disposal.
    // 未发布就被回滚的插入从未对外存在，不发 disposed（否则会虚构不可能的生命周期边）。
    if (!entry.announced) return
    this.emitDisposed(entry)
  }

  /** Emit the paired disposal edge through the entry's stable carrier. */
  // 经稳定载体发 agent/disposed，逐监听器容错（异步拒绝/同步抛错都只记日志）。
  private emitDisposed(entry: AgentEntry): void {
    const args: unknown[] = [entry.carrier, 'agent/disposed', { agent: entry.agent }]
    for (const callback of this.ctx.events.dispatch('emit', args)) {
      try {
        const returned: unknown = callback(...args)
        void Promise.resolve(returned).catch((error: unknown) => {
          this.ctx.logger.warn(`agent "${entry.id}": agent/disposed listener rejected: ${String(error)}`)
        })
      } catch (error: unknown) {
        this.ctx.logger.warn(`agent "${entry.id}": agent/disposed listener threw: ${String(error)}`)
      }
    }
  }

  /**
   * Announce an agent previously inserted with {@link enter}.
   * @param agent - the live inserted agent to announce.
   * @throws if `agent` is not the exact live registry entry for its id, or its
   *   creation announcement already began (including a reentrant call from a
   *   creation listener).
   */
  // 两段式发布的第二段：发 agent/created。同步抛错会否决发布并回滚；
  // 重复 announce（包括创建监听器里的重入）会抛错。
  announce(agent: Agent): void {
    const entry = this.store.get(agent.id)
    if (entry === undefined || entry.agent !== agent) {
      throw new Error(`agent "${agent.id}" is not live in this registry`)
    }
    if (entry.announced || entry.announcing) {
      throw new Error(`agent "${entry.id}" was already announced`)
    }
    // Mark before dispatch so a listener cannot recursively create a second
    // lifecycle edge; detach still pairs a partially delivered first edge.
    // 先标记再分发：防止监听器递归创建第二条生命周期边；detach 仍能配对“部分投递”的首条边。
    entry.announcing = true
    entry.announced = true
    const args: unknown[] = [entry.carrier, 'agent/created', { agent: entry.agent }]
    try {
      for (const callback of this.ctx.events.dispatch('emit', args)) {
        // A synchronous creation failure vetoes publication and rolls back.
        // Returned-promise rejection happens after this synchronous boundary, so
        // observe and report it instead of leaking an unhandled rejection.
        // 同步失败否决发布并回滚；异步拒绝发生在同步边界之后，观测并上报，避免未处理拒绝泄漏。
        const returned: unknown = callback(...args)
        void Promise.resolve(returned).catch((error: unknown) => {
          this.ctx.logger.warn(`agent "${entry.id}": agent/created listener rejected: ${String(error)}`)
        })
      }
    } finally {
      entry.announcing = false
      if (entry.detachRequested) this.detachEntered(entry)
    }
  }

  /**
   * Look up a live agent.
   * @param id - the shared agent/session id to look up.
   * @returns the agent, or undefined when no live agent has that id.
   */
  // 按 id 查在线 agent。
  get(id: SessionId): Agent | undefined {
    return this.store.get(id)?.agent
  }

  /**
   * Test whether a live agent was created through one exact parent agent's
   * scoped context. Runtime ownership is independent of durable session
   * lineage and remains unambiguous when unrelated providers reuse an id.
   * @param id - the candidate child agent's shared agent/session id.
   * @param owner - the expected runtime creator agent.
   * @returns true only while the exact child entry is live under that owner.
   */
  // 判断某 agent 是否由指定父 agent 的 scoped 上下文创建（运行时归属，与持久化谱系无关）。
  isOwnedBy(id: SessionId, owner: Agent): boolean {
    return this.store.get(id)?.owner === owner
  }

  /**
   * All live agents, in registration order.
   * @returns a fresh array; mutating it does not affect the registry.
   */
  // 全部在线 agent（注册序）；返回新数组，改动不影响注册表。
  list(): Agent[] {
    return [...this.store.values()].map(entry => entry.agent)
  }

  /**
   * All live top-level agents in registration order. A top-level agent was
   * created without an owning agent context; durable session lineage does not
   * affect this runtime relation, so a resumed fork may still be a root.
   * @returns a fresh array; mutating it does not affect the registry.
   */
  // 全部顶层（无运行时父 agent）agent；恢复的 fork 可能仍是根（运行时关系不看持久化谱系）。
  roots(): Agent[] {
    return [...this.store.values()]
      .filter(entry => entry.owner === undefined)
      .map(entry => entry.agent)
  }

  /** Reject new initiator boundaries while inherited continuations drain. */
  // 关闭发起者：从 active 转为 closing，此后只允许排空已开始的边界。
  private closeInitiators(): void {
    if (this.initiatorState === 'active') this.initiatorState = 'closing'
  }

  /** Wait for returned-Promise boundaries, then invalidate retained references. */
  // 拆除发起者：等所有返回 Promise 的边界结算，再禁用存储并置为 disposed（幂等）。
  private disposeInitiators(): Promise<void> {
    return (this.initiatorDisposal ??= (async () => {
      this.closeInitiators()
      this.releaseReentrantInitiatorRuns()
      if (this.activeInitiatorRuns !== 0) {
        this.initiatorDrain ??= Promise.withResolvers<void>()
        await this.initiatorDrain.promise
      }
      this.initiatorState = 'disposed'
      this.initiators.disable()
      this.initiatorRuns.disable()
    })())
  }

  /** Establish one tracked initiator or clearing boundary. */
  // 发起者边界的统一实现：计数 + 嵌套链记录 + 同步值/异步 Promise 的释放处理。
  private runWithInitiator<T>(agent: Agent | undefined, operation: () => T): T {
    if (this.initiatorState !== 'active') throw new Error(DISPOSED_INITIATOR_MESSAGE)
    const run: InitiatorRun = {
      active: true,
      parent: this.initiatorRuns.getStore(),
    }
    this.activeInitiatorRuns += 1
    let result: T
    try {
      result = this.initiatorRuns.run(run, () => this.initiators.run(agent, operation))
    } catch (error: unknown) {
      this.releaseInitiatorRun(run)
      throw error
    }
    if (isPromise(result)) {
      try {
        // 异步结果：在 Promise 结算（无论成败）时释放运行计数。
        void Promise.prototype.then.call(
          result,
          () => { this.releaseInitiatorRun(run) },
          () => { this.releaseInitiatorRun(run) },
        )
      } catch {
        // A branded Promise may expose a failing @@species. Observer setup did
        // not attach, so preserve the exact return without leaking the run.
        // 品牌化 Promise 可能暴露失败的 @@species：观察者未挂上，保留原返回值并直接释放计数。
        this.releaseInitiatorRun(run)
      }
    } else {
      // 同步结果：立即释放。
      this.releaseInitiatorRun(run)
    }
    return result
  }

  /** Whether one unloading fiber owns this service's lifecycle. */
  // 判断候选纤维是否为本服务生命周期链上的祖先（沿父链向上比对）。
  private hasLifecycleAncestor(candidate: Fiber): boolean {
    let fiber = this.ctx.fiber
    while (true) {
      if (fiber === candidate) return true
      const parent = fiber.parent.fiber
      if (parent === fiber) return false
      fiber = parent
    }
  }

  // 已 disposed 时读取发起者直接抛错。
  private assertInitiatorsReadable(): void {
    if (this.initiatorState === 'disposed') throw new Error(DISPOSED_INITIATOR_MESSAGE)
  }

  /** Exclude the boundary chain that initiated this teardown from its own drain. */
  // 把“发起本次拆除的边界链”从自身排空中排除，避免拆除等待自己（死锁）。
  private releaseReentrantInitiatorRuns(): void {
    let run = this.initiatorRuns.getStore()
    while (run !== undefined) {
      this.releaseInitiatorRun(run)
      run = run.parent
    }
  }

  // 释放一个运行计数；归零时 resolve 排空承诺（只发一次）。
  private releaseInitiatorRun(run: InitiatorRun): void {
    if (!run.active) return
    run.active = false
    this.activeInitiatorRuns -= 1
    if (this.activeInitiatorRuns !== 0) return
    this.initiatorDrain?.resolve()
    this.initiatorDrain = undefined
  }
}

export default AgentRegistry
