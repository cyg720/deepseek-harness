/*
 * ================================ 文件注释 ================================
 * 【文件职责】subagent 能力缝的 Service Definition 主体：维护子代理提供者（provider）注册表，
 *   对外暴露一次性子代理启动、可续聊子代理（continuable）的建立/追问/中断/上报等操作，
 *   并在包内组装生命周期事件、投影、子代理枚举等辅助模块。
 * 【技术维度】基于 Cordis 的 Service 子类 + 声明合并扩展 Context.events 事件表；
 *   一次性与续聊两类子代理共享同一套 start/end 生命周期事件；
 *   续聊能力委托给 SubagentContinuationManager，本文件只保留入口与提供者注册表。
 * 【产品维度】主代理通过工具把任务委托给子代理执行；续聊子代理可作为后台会话持续接收新指令，
 *   本文件保证委托过程可观察（事件）、可枚举（listChildren/listDescendants）、可恢复（续聊）。
 * 【逻辑维度】按代码顺序：类型导出与事件声明合并 → SubagentRuntime 类（提供者注册表、
 *   一次性 start 校验与委托、续聊相关入口、listChildren/listDescendants、依赖注入挂载）。
 * 【关键边界】续聊路径必须同时注入 agents 与 sessionProjections 服务；提供者能力由
 *   assertCapabilities 在委托前校验，缺能力即报错而不是静默降级；提供者名唯一，重复注册抛错。
 * 【新手阅读建议】先读 types.ts 了解请求/结果/提供者契约，再看本文件的 SubagentRuntime 类，
 *   关注 start（一次性）与 startContinuable（续聊）两条主路径；后续可深入 continuation.ts 与 lifecycle.ts。
 * ==========================================================================
 */

/**
 * Service Definition for the subagent capability seam (`ctx.subagents`): a named-provider registry plus a
 * capability-validating asynchronous start API. Providers establish a
 * child before returning its run, so fulfillment is the single publication and
 * ownership-transfer boundary.
 *
 * Unlike the bash seam (one executor per context, second load throws), MULTIPLE
 * providers coexist here: each registers under a unique name and a caller picks
 * one by name. The shape mirrors the LLM adapter registry
 * (`LlmRuntime.registerAdapter`), not the single-service bash executor.
 *
 * This package owns the Service Definition role of the capability seam. Service Providers
 * (`@deepseek-ai/dsh-subagent-spawn-in-process`, `-fork`, `-acp`) and the model-facing
 * consumer (`@deepseek-ai/dsh-tool-subagent`) are separate packages.
 *
 * Public operations express caller intent: `start` returns one published owned
 * one-shot run, `startContinuable` establishes a durable continuable child, and
 * `followup` delivers later content without exposing whether the child is
 * resident. Continuable children never become a {@link SubagentRun}: the
 * continuation manager holds their `AgentHandle` directly and orders every turn
 * through the child's own inbox, so providers contribute only the detached
 * creation spec and see no handle, turn, or teardown. Child and descendant
 * discovery read the live session store and optional session persistence
 * directly and do not require that continuation runtime.
 *
 * Same-process providers are trusted typed collaborators. Requests, provider
 * descriptors, results, and lifecycle payloads are borrowed immutable values;
 * serialization and hostile-input validation belong at real process, worker,
 * persistence, and model boundaries.
 *
 * @module @deepseek-ai/dsh-subagent
 */

import { Context, Service } from '@deepseek-ai/cordis'
import { scopeTarget } from '@deepseek-ai/dsh-scope'
import type { Scoped } from '@deepseek-ai/dsh-scope'
import { assertObjectJsonSchema } from '@deepseek-ai/dsh-tools'
import type { ContentBlock, MessageId } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type {
  ContinuableCreateRequest,
  ContinuableCreateSpec,
  ResolvedSubagentStartRequest,
  SubagentCapabilities,
  SubagentProvider,
  SubagentRun,
  SubagentRunEndInfo,
  SubagentRunInfo,
  SubagentStartRequest,
} from './types.ts'
import { SubagentError } from './error.ts'
import { assertSubagentMaxDepth } from './depth.ts'
import { createActivationObserver, createLifecycleEmitter, observeRun } from './lifecycle.ts'
import type { ActivationObserver, LifecycleEmitter } from './lifecycle.ts'
import SubagentContinuationManager from './continuation.ts'
import type {
  ContinuableStart,
  ContinuableStartSpec,
  SubagentFollowupOptions,
  SubagentInterruptAuthority,
  SubagentReportOptions,
} from './continuation.ts'
import SubagentActivationSetupRegistry from './activation-setup-registry.ts'
import type { ContinuableSetupContribution } from './activation-setup-registry.ts'
import { listChildren as listSubagentChildren, listDescendants as listSubagentDescendants } from './list-children.ts'
import type { SubagentDescendantListEntry, SubagentListEntry } from './list-children.ts'
import { snapshotSubagentDescriptor } from './descriptor.ts'
import { subagentIdentityProjectionDefinition, subagentTimingProjectionDefinition } from './projection.ts'

export * from './out-of-process.ts'
export { AssistantOutputFold, finalAssistantOutput } from './assistant-output.ts'
export { SubagentRunId } from './types.ts'
export type {
  ContinuableCreateRequest,
  ContinuableCreateSpec,
  ResolvedSubagentStartRequest,
  SubagentCapabilities,
  SubagentProvider,
  SubagentResult,
  SubagentRun,
  SubagentStartRequest,
  SubagentStopReason,
  SubagentStopReasonMap,
} from './types.ts'
export {
  foldSubagentDescriptor,
  snapshotSubagentDescriptor,
  SUBAGENT_DESCRIPTOR_VERSION,
} from './descriptor.ts'
export type {
  ContinuableSubagentDescriptorData,
  ContinuableSubagentDescriptorInput,
  OneShotSubagentDescriptorData,
  OneShotSubagentDescriptorInput,
  SubagentDescriptorData,
  SubagentDescriptorInput,
} from './descriptor.ts'
export { seedDescriptorTurn } from './descriptor-seed.ts'
export { SubagentError } from './error.ts'
export { settleRun } from './run-settlement.ts'
export { assertSubagentMaxDepth, delegationDepthOf } from './depth.ts'
export {
  appendDelegatedPolicyOverrides,
  applyChildComposition,
  captureDelegatedPolicyOverrides,
  childSessionMeta,
  resolveChildAgentOptions,
  resolveChildDepth,
  SubagentDepthError,
} from './child-agent.ts'
export type { ChildComposition, DelegatedPolicyOverrides } from './child-agent.ts'
export type {
  ContinuableStart,
  ContinuableStartSpec,
  CoordinatorMessageSource,
  SubagentFollowupOptions,
  SubagentInterruptAuthority,
  SubagentReportDelivery,
  SubagentReportMessageSource,
  SubagentReportOptions,
  SubagentSettledMessageSource,
} from './continuation.ts'
export type { ContinuableSetupContribution } from './activation-setup-registry.ts'
export type { SubagentDescendantListEntry, SubagentListEntry } from './list-children.ts'
export type { SubagentRunEndInfo, SubagentRunInfo } from './types.ts'
export type { SubagentIdentityProjection, SubagentTimingProjection } from './projection-types.ts'

// 中文：声明合并：把 ctx.subagents 服务与 subagent 生命周期事件表挂进 Cordis 全局类型，
// 任何插件都能以类型安全的方式访问子代理服务并监听其事件。
declare module '@deepseek-ai/cordis' {
  interface Context {
    subagents: SubagentRuntime
  }

  interface Events {
    /**
     * A provider became resolvable in the registry.
     * @param provider - the registered provider.
     * @mode emit
     */
    'subagent/provider-added'(provider: SubagentProvider): void
    /**
     * A provider left the registry. Accepted runs remain holder-owned.
     * @param name - the provider name that no longer resolves.
     * @mode emit
     */
    'subagent/provider-removed'(name: string): void
    /**
     * A provider established a published child. For in-process providers,
     * `ctx.agents.get(info.id)` resolves during this notification.
     * Scope-filtered dispatch keys the carrier by the delegating parent, so a
     * parent-scoped listener observes only its own delegations. Paired with
     * `subagent/end`.
     * @param info - the provider and published child identity.
     * @dshScopeScan unsupported
     * @mode emit
     */
    'subagent/start'(this: Scoped<SubagentRuntime>, info: SubagentRunInfo): void
    /**
     * A published child settled. Scope-filtered dispatch uses the same delegating
     * parent carrier as `subagent/start`, so the lifecycle pair reaches the
     * same scoped audience.
     * @param info - the run identity and terminal outcome.
     * @dshScopeScan unsupported
     * @mode emit
     */
    'subagent/end'(this: Scoped<SubagentRuntime>, info: SubagentRunEndInfo): void
  }
}

/** Named provider registry with one-shot runs, durable discovery, and continuable-child operations. */
// 中文：子代理运行时服务（挂在 ctx.subagents 上）。维护"名称 → 提供者"注册表，
// 一次性 start 在此校验能力并委托，续聊操作转给 continuation 管理器。
export class SubagentRuntime extends Service {
  // 中文：已注册提供者的名称索引（保持插入序），registerProvider/getProvider/list 都读它。
  private providers = new Map<string, SubagentProvider>()
  // 中文：续聊管理器实例；只有注入 agents 服务后才创建，未创建时续聊入口报 CONTINUATION_UNAVAILABLE。
  private continuations: SubagentContinuationManager | undefined
  /** Deployment contributions composed into unpublished continuable children. */
  // 中文：部署能力注册表，把贡献安装到每个续聊子代理的未发布创建上下文。
  private readonly setupRegistry = new SubagentActivationSetupRegistry()
  /**
   * The contained lifecycle-edge publisher. Built here because scoped dispatch
   * keys its carrier by this exact service instance, whose own context filter
   * composes into the carrier.
   */
  // 中文：生命周期事件的"包含式"发布器：start/end/provider-removed 都经它派发，
  // 监听器异常被逐个隔离，不打断其他监听器与销毁流程。
  private readonly emitLifecycle: LifecycleEmitter

  // 中文：构造器：注册服务本身；注入 agents 时创建续聊管理器，注入 sessionProjections 时
  // 注册两个子代理投影定义（timing 与 identity）。
  constructor(ctx: Context) {
    super(ctx, 'subagents')
    this.emitLifecycle = createLifecycleEmitter(this.ctx, parent => scopeTarget(this, parent))
    ctx.inject(['agents'], (childCtx: Context) => {
      const manager = new SubagentContinuationManager(childCtx, {
        prepareContinuable: (name, request) => this.prepareContinuable(name, request),
        observeActivation: (provider, childId, parent) => this.observeActivation(provider, childId, parent),
      }, this.setupRegistry)
      this.continuations = manager
      childCtx.effect(() => () => {
        /* v8 ignore else -- one injected binding owns the slot until its fiber disposes. */
        if (this.continuations === manager) this.continuations = undefined
      }, 'subagents.continuationBinding()')
    })
    ctx.inject(['sessionProjections'], (projectionCtx) => {
      projectionCtx.sessionProjections.register(subagentTimingProjectionDefinition)
      projectionCtx.sessionProjections.register(subagentIdentityProjectionDefinition)
    })
  }

  /**
   * Establish one durable continuable child and deliver its initial prompt.
   * Resolves when the child's inbox accepts that prompt, without waiting for the
   * turn to start or for the message to reach the Session log; any earlier
   * failure rejects with no ids and rolls back the child entirely.
   * @param spec - provider, delegation request, and caller cancellation.
   * @returns the durable child id and the accepted prompt's message id.
   * @throws when continuation services are unavailable or materialization fails.
   */
  // 中文：建立并启动一个可续聊子代理：保留持久 ID → 解析 provider 的创建规格 →
  // 物化子代理 Agent → 投递初始提示词；在收件箱接受前任何失败都整体回滚（无 ID 返回）。
  async startContinuable(spec: ContinuableStartSpec): Promise<ContinuableStart> {
    return this.requireContinuations().startContinuable(spec)
  }

  /**
   * Deliver one later message to a continuable child as its next FIFO turn. A
   * resident child's Agent inbox accepts it directly (waking a `waiting`
   * Activation), while an absent one is cold-resumed from its persisted
   * Session. The Agent inbox is the only queue, so every accepted message has
   * one observable order.
   * @param parent - the exact live direct parent authorizing this delivery.
   * @param childId - durable child session id.
   * @param content - user-role content to deliver.
   * @param options - the message source fields and caller cancellation, which stops the
   *   operation only before inbox acceptance.
   * @returns the accepted message's inbox id.
   * @throws when continuation services are unavailable, parent authority is
   *   rejected, or the message was not admitted.
   */
  // 中文：向已存在的续聊子代理投递一条后续消息（作为其下一个 FIFO 回合）：
  // 驻留则直接入收件箱，未驻留则从持久化会话冷恢复后投递。
  async followup(
    parent: Agent,
    childId: SessionId,
    content: ContentBlock[],
    options: SubagentFollowupOptions,
  ): Promise<MessageId> {
    return this.requireContinuations().followup(parent, childId, content, options)
  }

  /**
   * Interrupt one live continuable child's current turn under a human parent
   * address or an exact live ancestor Agent. Fire-and-return: the cancel
   * signal is issued before this returns, but the target may keep running
   * until it observes the signal. Unclaimed pending inbox work, the Activation,
   * and published descendants are preserved; claimed work is not requeued.
   * Once the interrupted driver is idle, a waking send resumes the parked FIFO
   * queue. An absent target — including a one-shot or unknown id —
   * is an accepted no-op, as is a manager-less composition, which cannot own a
   * live Activation.
   * @param targetSessionId - the durable child session id to interrupt.
   * @param authority - the human parent address or exact live ancestor Agent.
   * @throws {SubagentError} `UNAUTHORIZED` when the authority does not own the
   *   live target.
   */
  // 中文：中断一个驻留续聊子代理的当前回合：发出取消信号即返回，不等待目标响应；
  // 目标不存在或没有续聊管理器时是接受的无操作（no-op）。
  interrupt(targetSessionId: SessionId, authority: SubagentInterruptAuthority): void {
    this.continuations?.interrupt(targetSessionId, authority)
  }

  /**
   * Deliver selected content from one live continuable child to its durable
   * direct parent. The child is the authority credential; callers cannot name a
   * recipient. Reporting does not conclude the child's turn or Activation.
   * @param child - exact live reporting child.
   * @param content - selected model-facing content.
   * @param options - parent scheduling and pre-acceptance cancellation.
   * @returns the stable identity of the parent-accepted message.
   * @throws when continuation services are unavailable, sender authorization
   *   fails, or the direct parent is not live.
   */
  // 中文：续聊子代理向自己的持久化直接父代理上报选定内容：子代理本身就是授权凭证，
  // 调用方不能指定收件人；上报不结束子代理的回合或 Activation。
  async reportFrom(
    child: Agent,
    content: ContentBlock[],
    options: SubagentReportOptions,
  ): Promise<MessageId> {
    return this.requireContinuations().reportFrom(child, content, options)
  }

  /**
   * Compose one deployment capability into every continuable child's
   * unpublished creation context on fresh creation and cold resume. Grants wait
   * for the next Activation; removing the contribution revokes every resident
   * installation immediately.
   * @param contribution - synchronous child-scope installer.
   * @returns the exact Cordis effect disposer.
   */
  // 中文：注册一条部署能力，安装进每个续聊子代理的创建上下文（新建与冷恢复都生效）；
  // 返回的 effect 注销器撤销注册并立即吊销已驻留的安装。
  registerContinuableSetup(contribution: ContinuableSetupContribution): () => void {
    // oxlint-disable-next-line typescript/no-misused-promises -- synchronous cleanup; direct return preserves disposer identity
    return this.ctx.effect(
      () => this.setupRegistry.register(contribution),
      'subagents.registerContinuableSetup()',
    )
  }

  /**
   * Close continuable admission below exact live parent Agents, stop only their
   * visible descendant Activations synchronously, then await admitted scoped
   * materializations and release those forests child-first. The scoped cutoff
   * lasts until each exact parent leaves the registry; unrelated parent trees
   * remain live.
   * @param parents - exact host-owned parent Agents entering teardown.
   * @returns once every retained descendant Activation released its `AgentHandle`.
   * @throws an aggregate error after all branches settle when any failed.
   */
  // 中文：关闭精确父代理之下的续聊准入、同步停掉其可见的后代 Activation，然后等待已
  // 准入的物化完成并子优先释放这些森林；无关的父代理树保持存活。
  async drainContinuableDescendants(parents: readonly Agent[]): Promise<void> {
    const manager = this.continuations
    // Absent continuation services means nothing was ever materialized.
    if (manager === undefined) return
    await manager.drainDescendants(parents)
  }

  /**
   * Release selected resident continuable direct children of one exact live
   * parent. Other children of the same parent remain admitted and resident.
   * Absent targets and a manager-less composition are accepted no-ops.
   * @param parent - exact live direct parent authorizing the selected release.
   * @param childIds - durable direct-child ids to release when resident.
   * @returns once every selected Activation released its `AgentHandle`.
   * @throws {SubagentError} `UNAUTHORIZED` when a resident target belongs to a
   *   different parent or the supplied parent identity is stale.
   */
  // 中文：释放指定父代理的若干驻留直接子代理（其余子代理保持准入与驻留）；目标不存在
  // 或没有续聊管理器时是接受的无操作；子代会被递归释放。
  async drainContinuableChildren(parent: Agent, childIds: readonly SessionId[]): Promise<void> {
    const manager = this.continuations
    if (manager === undefined) return
    await manager.drainChildren(parent, childIds)
  }

  /**
   * Enumerate the parent's direct session-backed subagents without loading or
   * resuming an Agent and without any query service: the listing merges the live
   * session store with optional session persistence (live-preferred) and
   * serves each child's durable mode/label from the registered `subagent`
   * projection unit down a three-rung ladder — the registry's watermark
   * snapshot for a live child; for a cold one, a durable projection-cache
   * row when the optional cache serves an own-suffix identity (its `seq`
   * gate proves the value postdates the fork seed, where a child's own
   * descriptor is immutable once appended), else one persistence inspection
   * folded through the registry. The
   * projection fold is the single classification authority; per-child
   * diagnostics relay a fold that served no identity or a failed inspection,
   * never a list-time descriptor parse. Absent persistence, enumeration is
   * live-only (a cold child cannot be resumed then either, so its absence is
   * capability absence, not an error). This service consults no Agent
   * registrations, Activations, or providers.
   *
   * Every persistence read receives `signal`, and the listing rechecks
   * cancellation around each of those awaits. Read rejections that settle
   * after an abort become a stable `SubagentError` with code `CANCELLED`.
   * @param parentSessionId - parent session whose direct children are listed.
   * @param signal - caller-owned cancellation forwarded to persistence reads
   *   and observed around every read await.
   * @returns children and per-child diagnostics ordered by `createdAt`, then id.
   * @throws {@link SubagentError} when the projection registry or the session
   *   store is not mounted, or the caller cancels the listing.
   */
  // 中文：列出父代理的直接会话备份子代理：不加载或恢复任何 Agent、不依赖查询服务，
  // 从 live 会话存储与可选持久化的合并语料中枚举，身份经投影三级梯子解析。
  listChildren(parentSessionId: SessionId, signal?: AbortSignal): Promise<SubagentListEntry[]> {
    return listSubagentChildren(this.ctx, parentSessionId, signal)
  }

  /**
   * Enumerate the root's complete session-backed subagent tree in stable
   * pre-order from one live-preferred corpus, without loading or resuming an
   * Agent. Ordinary sessions and one-shot children remain traversal nodes so
   * continuable descendants below them are discovered; each returned entry
   * adds its durable `parentId` and root-relative `depth`. Identity resolution,
   * diagnostics, optional persistence, and cancellation follow the same
   * projection-backed contract as {@link listChildren}.
   * @param rootSessionId - session whose complete descendant tree is listed.
   * @param signal - caller-owned cancellation forwarded to persistence reads
   *   and observed around every read await.
   * @returns children and per-candidate diagnostics with tree position, in
   *   stable pre-order.
   * @throws {@link SubagentError} under the same conditions as {@link listChildren}.
   */
  // 中文：按稳定前序枚举根代理的完整会话备份子代理树：普通会话与一次性子代理仍是遍历
  // 节点（保证其下的续聊后代被发现）；不加载或恢复任何 Agent。
  listDescendants(rootSessionId: SessionId, signal?: AbortSignal): Promise<SubagentDescendantListEntry[]> {
    return listSubagentDescendants(this.ctx, rootSessionId, signal)
  }

  /**
   * Register a provider under its name. Registration is effect-scoped and HMR
   * safe; removing a provider blocks new starts but does not revoke runs that
   * were already returned to their holders.
   * @param provider - the trusted provider implementation.
   * @returns the exact Cordis effect disposer.
   */
  // 中文：按名称注册提供者：effect 作用域注册、HMR 安全；移除只阻止新启动，
  // 不吊销已返回给持有者的一次性运行。重复名称抛 DUPLICATE_PROVIDER。
  registerProvider(provider: SubagentProvider): () => void {
    const name = provider.name
    // oxlint-disable-next-line typescript/no-misused-promises -- synchronous cleanup; direct return preserves disposer identity
    return this.ctx.effect(function* (this: SubagentRuntime) {
      if (this.providers.has(name)) {
        throw new SubagentError(`a subagent provider named "${name}" is already registered`, 'DUPLICATE_PROVIDER')
      }
      this.providers.set(name, provider)
      yield () => {
        this.providers.delete(name)
        this.emitLifecycle('subagent/provider-removed', name)
      }
      // A throwing added-listener unwinds the yielded rollback, matching the
      // repository's fail-loud registration semantics.
      this.ctx.emit('subagent/provider-added', provider)
    }.bind(this), 'subagents.registerProvider()')
  }

  /**
   * Look up a provider by name.
   * @param name - the provider name.
   * @returns the provider, or undefined when absent.
   */
  // 中文：按名称查提供者（未注册返回 undefined）。
  getProvider(name: string): SubagentProvider | undefined {
    return this.providers.get(name)
  }

  /**
   * List registered provider names in insertion order.
   * @returns the registered names.
   */
  // 中文：按插入序列出已注册提供者名称。
  list(): string[] {
    return [...this.providers.keys()]
  }

  /**
   * Establish a published child on the named provider. Capability and semantic
   * checks run before delegation. Provider ownership lasts until its promise
   * fulfills; a rejection therefore has no run for the caller to dispose and
   * emits no run lifecycle events. Post-publication turn and infrastructure
   * failures settle through the returned run.
   * @param name - the provider to use.
   * @param request - child label, prompt, parent, signal, and optional capabilities.
   * @returns the published holder-owned run.
   */
  // 中文：建立一次性子代理的主入口：按名称取提供者 → 校验能力与最大深度/输出 schema →
  // 快照持久化描述符 → 委托 provider.start 并包上生命周期观察（observeRun）。
  async start(name: string, request: SubagentStartRequest): Promise<SubagentRun> {
    const provider = this.expectProvider(name)
    this.assertCapabilities(provider, request)
    assertSubagentMaxDepth(request.maxDepth)
    if (request.outputSchema !== undefined) assertObjectJsonSchema(request.outputSchema)
    const descriptor = snapshotSubagentDescriptor({
      mode: 'one-shot',
      provider: name,
      ...request.label !== undefined ? { label: request.label } : {},
    })
    const resolved: ResolvedSubagentStartRequest = { ...request, descriptor }
    return observeRun(this.emitLifecycle, name, request.parent, await provider.start(resolved))
  }

  /**
   * Resolve one provider's detached continuable-creation contribution. Method
   * presence on the provider IS the capability, so a provider without it is
   * rejected before the manager reserves any child resources.
   */
  // 中文：解析一个提供者的"续聊创建贡献"；方法存在即能力，提供者没有
  // prepareContinuable 时在任何子代理资源预留前就报 UNSUPPORTED_CAPABILITY。
  private async prepareContinuable(
    name: string,
    request: ContinuableCreateRequest,
  ): Promise<ContinuableCreateSpec> {
    const provider = this.expectProvider(name)
    if (provider.prepareContinuable === undefined) {
      throw new SubagentError(
        `subagent provider "${provider.name}" does not support continuable children `
        + '(no prepareContinuable capability)',
        'UNSUPPORTED_CAPABILITY',
      )
    }
    return provider.prepareContinuable(request)
  }

  /** Look up a provider for dispatch or fail loud. */
  // 中文：按名称取提供者，未注册即抛 NO_PROVIDER（fail loud）。
  private expectProvider(name: string): SubagentProvider {
    const provider = this.providers.get(name)
    if (provider === undefined) {
      throw new SubagentError(`no subagent provider registered for "${name}"`, 'NO_PROVIDER')
    }
    return provider
  }

  /** Resolve the optional continuable-subagent manager or fail loud. */
  // 中文：解析续聊管理器，未注入 agents 服务时报 CONTINUATION_UNAVAILABLE。
  private requireContinuations(): SubagentContinuationManager {
    if (this.continuations === undefined) {
      throw new SubagentError(
        'continuable subagents require the agents service',
        'CONTINUATION_UNAVAILABLE',
      )
    }
    return this.continuations
  }

  /**
   * Build the lifecycle observer for one continuable Activation's residency
   * epoch, so the manager publishes its edges without owning event dispatch.
   */
  // 中文：为一次续聊 Activation 的驻留 epoch 构建生命周期观察器（事件发布交给生命周期模块）。
  private observeActivation(
    provider: string,
    childId: SessionId,
    parent: Agent,
  ): ActivationObserver {
    return createActivationObserver(this.emitLifecycle, provider, childId, parent)
  }

  /** Reject the first requested capability that the provider lacks. */
  // 中文：在委托前拒绝请求里第一个提供者不支持的能力（fail loud，绝不静默降级）。
  private assertCapabilities(provider: SubagentProvider, request: SubagentStartRequest): void {
    const needs: { when: boolean; cap: keyof SubagentCapabilities }[] = [
      { when: request.outputSchema !== undefined, cap: 'outputSchema' },
      { when: request.maxDepth !== undefined, cap: 'depthLimit' },
      { when: request.toolFilter !== undefined, cap: 'toolFilter' },
      { when: request.persona !== undefined, cap: 'persona' },
    ]
    for (const { when, cap } of needs) {
      if (when && !provider.capabilities[cap]) {
        throw new SubagentError(
          `subagent provider "${provider.name}" does not support the "${cap}" capability`,
          'UNSUPPORTED_CAPABILITY',
        )
      }
    }
  }
}

export default SubagentRuntime
