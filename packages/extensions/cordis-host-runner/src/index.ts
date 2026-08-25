/*
 * ================================ 文件注释 ================================
 * 【文件职责】Dynamic Cordis Plugin 运行时服务（`dynamicCordisRunner`）的实现：
 *             管理由模型在会话中现场编写、可反复升级的 Cordis 插件——定义/删除包
 *             版本、启动 Host 半部、请求人工审批后再激活 Client 半部、停止运行、
 *             转发 Client 对 Host 方法的调用、汇总只读查询数据。是本包的对外门面。
 * 【技术维度】基于 vendored Cordis：插件（Plugin）持有多个不可变包版本（Package），
 *             一次激活对应一个运行（Run）与一次尝试记录（Attempt，见 types.ts）；
 *             通过 Typert 远程服务协议（@Remote 装饰器）把方法暴露给浏览器页面；
 *             Host 半部代码在 VM 沙箱中求值（sandbox.ts）后以 Fiber 挂载（lifecycle.ts）；
 *             所有跨端数据必须是可 JSON 序列化的。
 * 【产品维度】让最终用户能在浏览器面板里"安装/更新/停止"AI 助手现场写出的 Cordis
 *             插件；涉及 Client 代码的激活会推送审批请求到 UI 等待用户确认；成功/
 *             失败结果以用户消息注入 agent，指导模型下一步操作。
 * 【逻辑维度】1) define/undefine 管理包版本；2) run/runHostHalf 走"模型驱动"与
 *             "面板驱动"两条激活路径；3) resolveRequestRun/settleUserRun 结算激活；
 *             4) invoke 转发 Client 调用；5) snapshot/inventory/inspect* 提供只读查询；
 *             6) 私有方法执行状态机与错误回导（steer* 系列）。
 * 【关键边界】插件归属创建它的 Session，跨会话访问会被拒绝；同一插件同一时刻只允许
 *             一个"正在启动"的激活（starting Map 防并发）；代码先经 precheckCode
 *             预检、再在带超时（vmTimeoutMs）的沙箱中执行；运行期错误按去重键只上报
 *             一次，避免反复打扰模型。
 * 【新手阅读建议】先读 types.ts 掌握 Plugin/Package/Run/Attempt 词汇，再按本文件
 *             define→run→resolveRequestRun 的激活主流程阅读，最后读 registry.ts、
 *             lifecycle.ts、sandbox.ts、guard.ts 补齐细节。
 * ==========================================================================
 */

/**
 * Dynamic Cordis Plugin service: immutable package definitions, one active run
 * per Plugin, human-approved Client activation, and Host/Client invocation.
 * @module @deepseek-ai/dsh-cordis-host-runner
 */

import { Context } from '@deepseek-ai/cordis'
import type { Fiber } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { JsonValue } from '@deepseek-ai/dsh-session/types'
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
import { isPlugin, normalizeHandler } from './guard.ts'
import { CordisInspectRegistryService } from './inspect-registry.ts'
import { missingServices, startHostHalf } from './lifecycle.ts'
import { DynamicCordisRegistry } from './registry.ts'
import type {
  DynamicCordisDefineReceipt, DynamicCordisDefineRequest, DynamicCordisDefinition,
  DynamicCordisPackageInspection, DynamicCordisPendingRequest, DynamicCordisPlugin,
  DynamicCordisPluginInspection,
  DynamicCordisReference, DynamicCordisRun,
} from './registry.ts'
import { createSandbox, evaluateHostCode, precheckCode } from './sandbox.ts'
import type {
  ApprovalRequestId, CordisDynamicPackageId, CordisDynamicPluginId, CordisDynamicPluginRunId, CordisErrorDetails,
  CordisDynamicRunMode, CordisInspectProviderManifest, CordisInspectQueryResolution,
  CordisInspectRequestId, CordisInspectResolveAck, DynamicCordisClientSource, DynamicCordisHostHalfResult,
  DynamicCordisInventoryRow, DynamicCordisInvokeResult, DynamicCordisRenderFailure, DynamicCordisResolveAck,
  DynamicCordisRunAttempt, DynamicCordisRunResolution, DynamicCordisRunResponse, DynamicCordisStopResponse,
  DynamicCordisUndefineReceipt, RequestRunOutcome,
} from './types.ts'

export type * from './types.ts'
export type {
  DynamicCordisDefineReceipt, DynamicCordisDefineRequest, DynamicCordisDefinition, DynamicCordisHandler,
  DynamicCordisPackageInspection, DynamicCordisPlugin, DynamicCordisPluginInspection,
  DynamicCordisReference, DynamicCordisRun,
} from './registry.ts'
export { CordisInspectRegistryService } from './inspect-registry.ts'
export type { HostCordisInspectProviderRegistration } from './inspect-registry.ts'
export { HOST_BUILTIN_INSPECTION } from './sandbox.ts'

/**
 * Brand a Host-minted Plugin ID.
 * @param id - opaque identifier minted by the Host registry.
 * @returns the branded Plugin identifier.
 */
/*
 * 给 Host 注册表铸造的插件 ID 打上品牌标记（Branded）：这只是编译期类型标记，
 * 运行时就是原字符串，用来防止把普通字符串误当成插件 ID 使用。
 * @param id 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
 */
export function CordisDynamicPluginId(id: string): CordisDynamicPluginId {
  return id as CordisDynamicPluginId
}

/**
 * Brand a Host-minted Package ID.
 * @param id - opaque identifier minted by the Host registry.
 * @returns the branded Package identifier.
 */
/*
 * 品牌化"包版本 ID"：每个包版本是一次不可变定义（含 Host/Client 代码），ID 全局唯一。
 * @param id 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
 */
export function CordisDynamicPackageId(id: string): CordisDynamicPackageId {
  return id as CordisDynamicPackageId
}

/**
 * Brand a Host-minted Plugin Run ID.
 * @param id - opaque identifier minted by the Host registry.
 * @returns the branded Plugin Run identifier.
 */
export function CordisDynamicPluginRunId(id: string): CordisDynamicPluginRunId {
  return id as CordisDynamicPluginRunId
}

/**
 * Brand a Host-minted approval request ID.
 * @param id - opaque identifier minted by the Host registry.
 * @returns the branded approval request identifier.
 */
/*
 * 品牌化"审批请求 ID"：模型驱动的 Client 激活在等待用户确认时，用该 ID 在
 * 注册表与事件之间关联请求。
 * @param id 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
 */
export function ApprovalRequestId(id: string): ApprovalRequestId {
  return id as ApprovalRequestId
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Process-local dynamic Plugin registry and lifecycle service. */
    dynamicCordisRunner: DynamicCordisRunnerService
  }
}

/** Runner configuration. */
export interface Config {
  /** Maximum synchronous VM evaluation time in milliseconds. */
  vmTimeoutMs?: number
}

type ResolvedConfig = Required<Config>

/** Host-only snapshot consumed by inspect and tool result rendering. */
export interface DynamicCordisSnapshotRow {
  pluginId: CordisDynamicPluginId
  currentPackageId?: CordisDynamicPackageId
  nextPackageId?: CordisDynamicPackageId
  packages: Array<{
    packageId: CordisDynamicPackageId
    name: string
    purpose: string
    hasHostHalf: boolean
    hasClientHalf: boolean
  }>
  activeRun?: {
    pluginRunId: CordisDynamicPluginRunId
    packageId: CordisDynamicPackageId
    fiber?: Fiber
    handlers: string[]
    renderFailure?: DynamicCordisRenderFailure
  }
  latestRun?: DynamicCordisRunAttempt
}

/**
 * 一次激活的内部计划：锁定目标插件、目标包版本与运行模式；
 * 在激活的多个阶段（run → runHostHalf → activate）之间共享。
 */
interface ActivationPlan {
  plugin: DynamicCordisPlugin
  definition: DynamicCordisDefinition
  mode: CordisDynamicRunMode
}

/** Dynamic Plugin registry and Host-half lifecycle. */
/*
 * 动态 Cordis 插件注册表与 Host 半部生命周期服务。以 `dynamicCordisRunner` 身份
 * 注入 Cordis 上下文，同时是 Typert 远程服务（带 @Remote 的方法可被浏览器页面
 * 跨进程调用）。职责：定义/删除包版本、启动/更新/停止激活、转发 Client 对 Host
 * 方法的调用、汇总 inspect 数据。
 */
export class DynamicCordisRunnerService extends TypertRemoteService {
  static inject = ['tools']
  // 依赖注入声明：需要 tools 服务（提供工具注册能力，供动态插件声明工具时使用）

  static Config: z<Config> = z.object({
    vmTimeoutMs: z.number().min(1).default(5000),
  })
  // 配置模式：vmTimeoutMs 为沙箱同步求值超时，默认 5000 毫秒，最小 1

  // 根上下文：用于获取 agents 服务、创建动态插件共用的 Fiber 组
  private readonly rootCtx: Context
  // 进程内插件/包版本/待审批请求的存储与 ID 铸造（见 registry.ts）
  private readonly registry = new DynamicCordisRegistry()
  // 只读 inspect 提供者注册表：同时持有 Host 本地提供者与 Client 目录镜像
  private readonly inspectRegistry: CordisInspectRegistryService
  // 正在启动中的激活：插件 ID -> 启动 Promise，用于合并并发激活请求
  private readonly starting = new Map<CordisDynamicPluginId, Promise<DynamicCordisHostHalfResult>>()
  // 补全默认值后的配置（vmTimeoutMs 一定存在）
  private readonly resolved: ResolvedConfig
  // 动态插件共用的 Fiber 组，惰性创建，Host 半部都挂载在该组下
  private group: Fiber | undefined

  /** Create the service under the Host composition. */
  /*
   * 在 Host 组合下创建服务：记录根上下文、固化配置、初始化 inspect 注册表。
   */
  constructor(ctx: Context, config: Config) {
    super(ctx, 'dynamicCordisRunner')
    this.rootCtx = ctx
    this.resolved = config as ResolvedConfig
    this.inspectRegistry = new CordisInspectRegistryService(ctx)
  }

  /**
   * Define a new Plugin's first Package or append a Package to an existing Plugin.
   * @param request - Session ownership, Plugin selection, metadata, and source code.
   * @returns Host-minted Plugin and Package identities with declared-half metadata.
   */
  /*
   * 定义一个插件的新包版本（或为既有插件追加版本）。校验名称/用途非空、至少提供
   * host 或 client 一端代码、代码通过静态预检；新建插件还要求 idPrefix 符合
   * "3–6 个小写英文字母"的规则。定义只入库，不启动。
   * @param request 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
   * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
   */
  define(request: DynamicCordisDefineRequest): DynamicCordisDefineReceipt {
    const name = request.name.trim()
    const purpose = request.purpose.trim()
    if (name.length === 0) throw new Error('cordis_define needs a non-empty `name`')
    if (purpose.length === 0) throw new Error('cordis_define needs a non-empty `purpose`')
    if (request.code.host === undefined && request.code.client === undefined) {
      throw new Error('cordis_define needs `code.host`, `code.client`, or both')
    }
    if (request.code.host !== undefined) precheckCode(request.code.host, 'code.host')
    if (request.code.client !== undefined) precheckCode(request.code.client, 'code.client')

    let plugin: DynamicCordisPlugin
    if (request.plugin.kind === 'new') {
      const prefix = request.plugin.idPrefix.trim()
      if (!/^[a-z]{3,6}$/.test(prefix)) {
        throw new Error('cordis_define `plugin.idPrefix` must contain 3–6 lowercase English letters')
      }
      const pluginId = CordisDynamicPluginId(this.registry.mintPluginId(prefix))
      plugin = {
        pluginId,
        sessionId: request.sessionId,
        packages: new Map(),
        approvedClientPackages: new Set(),
        clientVersionUpdatesApproved: false,
      }
      this.registry.add(plugin)
    } else {
      const found = this.registry.get(request.plugin.pluginId)
      if (found === undefined || found.sessionId !== request.sessionId) {
        throw new Error(missingPluginMessage(request.plugin.pluginId))
      }
      plugin = found
    }

    const packageId = CordisDynamicPackageId(this.registry.mintPackageId())
    const definition: DynamicCordisDefinition = {
      packageId,
      name,
      purpose,
      ...request.code.host === undefined ? {} : { hostCode: request.code.host },
      ...request.code.client === undefined ? {} : { clientCode: request.code.client },
    }
    plugin.packages.set(packageId, definition)
    return {
      pluginId: plugin.pluginId,
      packageId,
      name,
      purpose,
      hasHostHalf: definition.hostCode !== undefined,
      hasClientHalf: definition.clientCode !== undefined,
    }
  }

  /**
   * Remove a Plugin, its active run, and all immutable Packages.
   * @param agent - Agent whose Session must own the Plugin.
   * @param pluginId - Stable Plugin identity to remove.
   * @returns Whether removal succeeded and whether it stopped an active run.
   */
  /*
   * 删除插件及其全部包版本：先取消待审批请求，若正在运行则先回收（retract），
   * 最后从注册表移除。供模型工具调用。
   * @param agent 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
   * @param pluginId 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
   * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
   */
  async undefine(agent: Agent, pluginId: CordisDynamicPluginId): Promise<DynamicCordisUndefineReceipt> {
    const plugin = this.owned(agent, pluginId)
    if (plugin === undefined) return { ok: false, reason: 'plugin-missing', message: missingPluginMessage(pluginId) }
    const wasRunning = plugin.run !== undefined
    this.cancelPending(pluginId, `dynamic plugin "${pluginId}" was removed before approval`)
    if (plugin.run !== undefined) await this.retract(plugin)
    this.registry.delete(pluginId)
    return { ok: true, wasRunning }
  }

  /**
   * Remove a Plugin from the user panel and queue the resulting state change for the model's next step.
   * @param agent - Agent whose Session owns the Plugin and receives the context.
   * @param pluginId - Stable Plugin identity to remove.
   * @returns Whether removal succeeded and whether it stopped an active run.
   */
  /*
   * 面板触发的删除：复用 undefine 逻辑，成功后把"用户已移除该插件"注入 agent 上下文，
   * 让模型在下一步感知到状态变化。
   * @param agent 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
   * @param pluginId 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
   * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
   */
  @Remote('undefineFromPanel')
  async undefineFromPanel(agent: Agent, pluginId: CordisDynamicPluginId): Promise<DynamicCordisUndefineReceipt> {
    const result = await this.undefine(agent, pluginId)
    if (result.ok) {
      this.injectUserContext(
        agent,
        `The user removed Cordis Plugin ${pluginId} and all of its Packages. The Plugin no longer exists.`,
      )
    }
    return result
  }

  /**
   * Start or update one Package for a model tool call. An unauthorized Client
   * Package waits for approval; Plugin-wide authorization covers later versions.
   * @param agent - Agent whose Session must own the Plugin.
   * @param pluginId - Stable Plugin identity to activate.
   * @param packageId - Immutable Package version to activate.
   * @param mode - Whether to run the current version or switch versions.
   * @param signal - Tool-call cancellation signal while the activation request is being created.
   * @returns The successful activation identity or an actionable refusal.
   */
  /*
   * 模型工具调用入口（cordis_run）。解析激活计划后：若目标包只有 Host 代码则直接
   * 激活；含 Client 代码的包先登记审批请求（requiresApproval 决定是否必须等用户
   * 确认），广播 `cordis/request-run` 事件等待页面响应，本函数立即返回"等待中"状态，
   * 真正的激活由页面回调 runHostHalf 完成。
   * @param agent 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
   * @param pluginId 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
   * @param packageId 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
   * @param mode 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
   * @param signal 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
   * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
   */
  async run(
    agent: Agent,
    pluginId: CordisDynamicPluginId,
    packageId: CordisDynamicPackageId,
    mode: CordisDynamicRunMode,
    signal?: AbortSignal,
  ): Promise<DynamicCordisRunResponse> {
    const plan = this.resolvePlan(agent, pluginId, packageId, mode)
    if (!plan.ok) return plan.response
    if (signal?.aborted === true) {
      return {
        ok: false,
        reason: 'cancelled',
        message: `the run request for dynamic plugin "${pluginId}" was cancelled before activation`,
      }
    }
    if (this.registry.pendingRequestFor(pluginId) !== undefined) {
      return { ok: false, reason: 'transition-in-flight', message: `dynamic plugin "${pluginId}" already has a pending run request` }
    }
    const attempt = this.createAttempt(plan)
    plan.plugin.nextPackageId = packageId
    plan.plugin.latestRun = attempt
    if (plan.definition.clientCode === undefined) {
      const started = await this.activate(plan, undefined, false, attempt)
      if (started.ok) return this.runResponse(plan.plugin, started)
      this.failAttempt(plan.plugin, attempt, 'host-load', started)
      return { ...started, reason: 'host-half-failed' }
    }

    const requestId = ApprovalRequestId(this.registry.mintApprovalRequestId())
    const requiresApproval = !plan.plugin.clientVersionUpdatesApproved
      && !plan.plugin.approvedClientPackages.has(packageId)
    attempt.approvalRequestId = requestId
    attempt.requiresApproval = requiresApproval
    attempt.status = requiresApproval ? 'awaiting-approval' : 'starting-host'
    this.registry.armRequest(requestId, {
      agentId: agent.id,
      pluginId,
      packageId,
      pluginRunId: attempt.pluginRunId,
      mode,
      requiresApproval,
    })
    this.ctx.emit('cordis/request-run', {
      requestId,
      agentId: agent.id,
      pluginId,
      packageId,
      mode,
      name: plan.definition.name,
      purpose: plan.definition.purpose,
      requiresApproval,
    })
    return {
      ok: true,
      status: requiresApproval ? 'awaiting-approval' : 'starting',
      pluginId,
      packageId,
      pluginRunId: attempt.pluginRunId,
      mode,
      waitingFor: [],
      ...plan.plugin.currentPackageId === undefined ? {} : { currentPackageId: plan.plugin.currentPackageId },
      nextPackageId: packageId,
    }
  }

  /**
   * Start Host code for an approved request or a direct panel gesture.
   * @param agent - Agent whose Session must own the Plugin.
   * @param pluginId - Stable Plugin identity to activate.
   * @param packageId - Immutable Package version to activate.
   * @param mode - Whether to run the current version or switch versions.
   * @param requestId - Model-driven request identity, or null for a direct user gesture.
   * @param approveFutureVersions - Whether this approval covers later Packages of the same Plugin.
   * @returns The exact Host activation or a failure message.
   */
  /*
   * 审批通过后（requestId 非空）或面板直连（requestId 为 null）启动 Host 半部：
   * 校验请求 ID 与最新尝试匹配，记录"已批准此包版本"（可顺带批准未来所有版本），
   * 随后激活。面板直连时若目标包已在运行则复用现有激活（attach），避免重复启动。
   * @param agent 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
   * @param pluginId 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
   * @param packageId 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
   * @param mode 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
   * @param requestId 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
   * @param approveFutureVersions 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
   * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
   */
  @Remote('runHostHalf')
  async runHostHalf(
    agent: Agent,
    pluginId: CordisDynamicPluginId,
    packageId: CordisDynamicPackageId,
    mode: CordisDynamicRunMode,
    requestId: ApprovalRequestId | null,
    approveFutureVersions: boolean,
  ): Promise<DynamicCordisHostHalfResult> {
    const plan = this.resolvePlan(agent, pluginId, packageId, mode, requestId === null)
    if (!plan.ok) return { ok: false, message: plan.response.message }
    let attempt: DynamicCordisRunAttempt
    if (requestId !== null) {
      const pending = this.registry.peekRequest(requestId)
      if (pending === undefined || pending.pluginId !== pluginId || pending.packageId !== packageId || pending.mode !== mode) {
        return { ok: false, message: `run request "${requestId}" does not authorize ${pluginId}/${packageId}` }
      }
      const latest = plan.plugin.latestRun
      const expectedStatus = pending.requiresApproval ? 'awaiting-approval' : 'starting-host'
      if (latest === undefined || latest.pluginRunId !== pending.pluginRunId
        || (latest.status !== expectedStatus && (!pending.requiresApproval && latest.status !== 'client-pending'))) {
        return { ok: false, message: `run request "${requestId}" no longer identifies the latest run of ${pluginId}` }
      }
      attempt = latest
      if (pending.requiresApproval) {
        plan.plugin.approvedClientPackages.add(packageId)
        if (approveFutureVersions) plan.plugin.clientVersionUpdatesApproved = true
      }
    } else {
      const pending = this.registry.pendingRequestFor(pluginId)
      if (pending !== undefined) return { ok: false, message: `dynamic plugin "${pluginId}" has pending run request ${pending}` }
      const attached = plan.plugin.run?.packageId === packageId
        && plan.plugin.latestRun?.pluginRunId === plan.plugin.run.pluginRunId
        ? plan.plugin.latestRun
        : undefined
      attempt = attached ?? this.createAttempt(plan)
      if (attached === undefined) {
        plan.plugin.nextPackageId = packageId
        plan.plugin.latestRun = attempt
      }
      if (plan.definition.clientCode !== undefined) plan.plugin.approvedClientPackages.add(packageId)
    }
    const attaching = attempt.pluginRunId === plan.plugin.run?.pluginRunId
    if (!attaching) {
      attempt.status = 'starting-host'
      if (attempt.host.status !== 'absent') attempt.host = { status: 'pending', waitingFor: [] }
    }
    const started = await this.activate(plan, requestId ?? undefined, attaching, attempt)
    if (!started.ok) this.failAttempt(plan.plugin, attempt, 'host-load', started)
    return started
  }

  /**
   * Fetch Client code for the exact active run.
   * @param agent - Agent whose Session must own the Plugin.
   * @param pluginId - Stable Plugin identity to read.
   * @param pluginRunId - Exact active run authorized to receive source.
   * @returns Client source and its Plugin, Package, and run identities.
   */
  /*
   * 向浏览器页面提供当前激活运行对应的 Client 源码。只有持有该插件的会话可读取，
   * 且运行必须仍处于激活状态——旧运行的拉取会被拒绝，防止过期页面继续执行。
   * @param agent 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
   * @param pluginId 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
   * @param pluginRunId 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
   * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
   */
  @Remote('getClientCode')
  getClientCode(
    agent: Agent,
    pluginId: CordisDynamicPluginId,
    pluginRunId: CordisDynamicPluginRunId,
  ): DynamicCordisClientSource {
    const plugin = this.owned(agent, pluginId)
    if (plugin === undefined) throw new Error(missingPluginMessage(pluginId))
    const run = plugin.run
    if (run === undefined || run.pluginRunId !== pluginRunId) {
      throw new Error(`dynamic plugin "${pluginId}" is not running activation "${pluginRunId}"`)
    }
    const definition = plugin.packages.get(run.packageId)
    if (definition?.clientCode === undefined) throw new Error(`package "${run.packageId}" has no Client half`)
    return {
      code: definition.clientCode,
      name: definition.name,
      pluginId,
      packageId: run.packageId,
      pluginRunId,
    }
  }

  /**
   * Resolve one model-driven Client activation request.
   * @param requestId - Request identity to settle once.
   * @param resolution - Browser refusal or exact Client activation result.
   * @returns Whether the still-pending request accepted this resolution.
   */
  /*
   * 结算一次模型驱动的激活请求：先验证请求仍可应答且与当前运行一致，再认领
   * （claimRequest 保证"先到先得"、防止重复结算），把浏览器端的成功/失败结果写入
   * attempt 状态，广播结果事件，并把结论注入发起 agent 的下一条消息。
   * @param requestId 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
   * @param resolution 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
   * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
   */
  @Remote('resolveRequestRun')
  async resolveRequestRun(
    requestId: ApprovalRequestId,
    resolution: DynamicCordisRunResolution,
  ): Promise<DynamicCordisResolveAck> {
    const pending = this.registry.peekRequest(requestId)
    if (pending === undefined) return { accepted: false }
    const plugin = this.registry.get(pending.pluginId)
    if (resolution.ok && plugin?.run?.pluginRunId !== resolution.pluginRunId) return { accepted: false }
    if (!resolution.ok && resolution.pluginRunId !== undefined
      && plugin?.run?.pluginRunId !== resolution.pluginRunId) return { accepted: false }
    this.registry.claimRequest(requestId)
    const settled = await this.settleActivation(plugin, resolution, requestId)
    this.announceResolved(requestId, resolution, pending.requiresApproval ? undefined : 'completed')
    this.steerRunOutcome(pending, settled)
    return { accepted: true }
  }

  /**
   * Settle a direct panel run after this page loaded or failed its Client half.
   * @param agent - Agent whose Session must own the Plugin.
   * @param pluginId - Stable Plugin identity being settled.
   * @param resolution - Exact Client activation result from the acting page.
   * @returns The committed activation or its failure.
   */
  /*
   * 结算面板直连的激活：页面加载/渲染 Client 半部后回报结果，成功则提交激活，
   * 失败则记录诊断；结果同样注入 agent 上下文。
   * @param agent 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
   * @param pluginId 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
   * @param resolution 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
   * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
   */
  @Remote('settleUserRun')
  async settleUserRun(
    agent: Agent,
    pluginId: CordisDynamicPluginId,
    resolution: DynamicCordisRunResolution,
  ): Promise<DynamicCordisRunResponse> {
    const plugin = this.owned(agent, pluginId)
    if (plugin === undefined) return { ok: false, reason: 'plugin-missing', message: missingPluginMessage(pluginId) }
    const settled = await this.settleActivation(plugin, resolution)
    this.injectUserRunOutcome(agent, pluginId, settled)
    return settled
  }

  /**
   * Stop the active run while retaining every Package version.
   * @param agent - Agent whose Session must own the Plugin.
   * @param pluginId - Stable Plugin identity to stop.
   * @returns Success or the reason no run was stopped.
   */
  /*
   * 停止当前激活但保留所有包版本：取消待审批请求、回收运行中的 Fiber、
   * 把最近一次尝试标记为 stopped。停止是幂等的，未在运行时返回 not-running。
   * @param agent 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
   * @param pluginId 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
   * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
   */
  async stop(agent: Agent, pluginId: CordisDynamicPluginId): Promise<DynamicCordisStopResponse> {
    const plugin = this.owned(agent, pluginId)
    if (plugin === undefined) return { ok: false, reason: 'plugin-missing', message: missingPluginMessage(pluginId) }
    const pending = this.registry.pendingRequestFor(pluginId)
    if (plugin.run === undefined && pending === undefined) {
      return { ok: false, reason: 'not-running', message: `dynamic plugin "${pluginId}" is not running` }
    }
    if (pending !== undefined) this.cancelPending(pluginId, `dynamic plugin "${pluginId}" was stopped before approval`)
    if (plugin.run !== undefined) await this.retract(plugin)
    if (plugin.latestRun !== undefined) {
      plugin.latestRun.status = 'stopped'
      if (plugin.latestRun.host.status !== 'absent') plugin.latestRun.host = { status: 'stopped', waitingFor: [] }
      if (plugin.latestRun.client.status !== 'absent') plugin.latestRun.client = { status: 'stopped', waitingFor: [] }
    }
    return { ok: true }
  }

  /**
   * Stop a Plugin from the user panel and queue the resulting state change for the model's next step.
   * @param agent - Agent whose Session owns the Plugin and receives the context.
   * @param pluginId - Stable Plugin identity to stop.
   * @returns Success or the reason no run was stopped.
   */
  /*
   * 面板触发的停止：复用 stop 后，把"用户已停止该插件、包版本仍保留"注入 agent 上下文。
   * @param agent 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
   * @param pluginId 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
   * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
   */
  @Remote('stopFromPanel')
  async stopFromPanel(agent: Agent, pluginId: CordisDynamicPluginId): Promise<DynamicCordisStopResponse> {
    const result = await this.stop(agent, pluginId)
    if (!result.ok) return result
    const plugin = this.owned(agent, pluginId)
    this.injectUserContext(
      agent,
      `The user stopped Cordis Plugin ${pluginId}. Its Packages remain defined; currentPackageId is `
        + `${plugin?.currentPackageId ?? 'none'}.`,
    )
    return result
  }

  /**
   * Replace the Host mirror of the Client inspect provider directory.
   * @param providers - complete Client provider manifest.
   * @returns null after accepting the manifest.
   */
  /*
   * 接收 Client 侧 inspect 提供者目录的完整镜像并同步到 Host 注册表，使 Host 侧
   * 的 cordis_inspect_list 能同时列出两端提供者。
   * @param providers 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
   * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
   */
  @Remote('syncInspectManifest')
  syncInspectManifest(providers: readonly CordisInspectProviderManifest[]): null {
    this.inspectRegistry.syncClientManifest(providers)
    return null
  }

  /**
   * Claim one pending Client inspect query with its live result.
   * @param agent - Session that owns the query.
   * @param requestId - exact pending query identity.
   * @param resolution - provider result or structured refusal.
   * @returns whether this answer won the query.
   */
  /*
   * Client 侧回报 inspect 查询结果：转发给 inspect 注册表认领并结算。
   * @param agent 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
   * @param requestId 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
   * @param resolution 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
   * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
   */
  @Remote('resolveInspectQuery')
  resolveInspectQuery(
    agent: Agent,
    requestId: CordisInspectRequestId,
    resolution: CordisInspectQueryResolution,
  ): CordisInspectResolveAck {
    return this.inspectRegistry.resolveClientQuery(agent, requestId, resolution)
  }

  /**
   * Frame-wide inventory, grouped as one row per stable Plugin.
   * @returns Source-free metadata for every process-local Plugin.
   */
  /*
   * 返回整个进程内所有插件的只读清单（不含源码），供浏览器面板绘制库存视图；
   * 每行数据都做了浅拷贝/克隆，避免把内部可变引用暴露给调用方。
   * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
   */
  @Remote('inventory')
  inventory(): DynamicCordisInventoryRow[] {
    return this.registry.all().map(plugin => ({
      pluginId: plugin.pluginId,
      agentId: plugin.sessionId,
      packages: [...plugin.packages.values()].map(definition => ({
        packageId: definition.packageId,
        name: definition.name,
        purpose: definition.purpose,
        hasHostHalf: definition.hostCode !== undefined,
        hasClientHalf: definition.clientCode !== undefined,
      })),
      ...plugin.currentPackageId === undefined ? {} : { currentPackageId: plugin.currentPackageId },
      ...plugin.nextPackageId === undefined ? {} : { nextPackageId: plugin.nextPackageId },
      ...plugin.run === undefined ? {} : {
        activeRun: { pluginRunId: plugin.run.pluginRunId, packageId: plugin.run.packageId },
      },
      ...plugin.latestRun === undefined ? {} : { latestRun: cloneAttempt(plugin.latestRun) },
    }))
  }
  /* jscpd:ignore-end */

  /**
   * Read one Session's Host-rich state for inspection and result rendering.
   * @param agent - Agent whose Session selects visible Plugins.
   * @returns Plugin versions, active runs, Host fibers, and render failures.
   */
  /*
   * 返回当前会话的 Host 富状态快照：除清单信息外还包含运行中的 Fiber 对象与已注册
   * 的 Host 方法名。仅限 Host 进程内使用（inspect 工具、结果渲染），不可跨进程传输。
   * @param agent 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
   * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
   */
  snapshot(agent: Agent): DynamicCordisSnapshotRow[] {
    return this.registry.ofSession(agent.id).map(plugin => ({
      pluginId: plugin.pluginId,
      ...plugin.currentPackageId === undefined ? {} : { currentPackageId: plugin.currentPackageId },
      ...plugin.nextPackageId === undefined ? {} : { nextPackageId: plugin.nextPackageId },
      packages: [...plugin.packages.values()].map(definition => ({
        packageId: definition.packageId,
        name: definition.name,
        purpose: definition.purpose,
        hasHostHalf: definition.hostCode !== undefined,
        hasClientHalf: definition.clientCode !== undefined,
      })),
      ...plugin.run === undefined ? {} : {
        activeRun: {
          pluginRunId: plugin.run.pluginRunId,
          packageId: plugin.run.packageId,
          ...plugin.run.fiber === undefined ? {} : { fiber: plugin.run.fiber },
          handlers: [...plugin.run.handlers.keys()],
          ...plugin.run.renderFailure === undefined ? {} : { renderFailure: plugin.run.renderFailure },
        },
      },
      ...plugin.latestRun === undefined ? {} : { latestRun: cloneAttempt(plugin.latestRun) },
    }))
  }

  /**
   * Read source-free context for an explicit `@pluginId` user gesture.
   * @param agent - Agent whose Session must own the Plugin.
   * @param pluginId - Stable Plugin identity referenced by the user.
   * @returns The preferred modification base, or undefined when unavailable.
   */
  /*
   * 返回"修改基准"：当用户显式提及某插件时，取其 next（进行中的迁移目标）/ current
   * （当前成功版本）/ 最新包版本中最合适的一个作为上下文，让模型知道接下来应基于
   * 哪个版本操作。
   * @param agent 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
   * @param pluginId 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
   * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
   */
  reference(agent: Agent, pluginId: CordisDynamicPluginId): DynamicCordisReference | undefined {
    const plugin = this.owned(agent, pluginId)
    if (plugin === undefined) return undefined
    const packageId = plugin.nextPackageId
      ?? plugin.currentPackageId
      ?? [...plugin.packages.keys()].at(-1)
    if (packageId === undefined) return undefined
    const definition = plugin.packages.get(packageId)
    if (definition === undefined) return undefined
    return {
      pluginId,
      packageId,
      name: definition.name,
      purpose: definition.purpose,
      ...plugin.currentPackageId === undefined ? {} : { currentPackageId: plugin.currentPackageId },
      ...plugin.nextPackageId === undefined ? {} : { nextPackageId: plugin.nextPackageId },
      ...plugin.run === undefined ? {} : {
        activeRun: { pluginRunId: plugin.run.pluginRunId, packageId: plugin.run.packageId },
      },
      ...plugin.latestRun === undefined ? {} : { latestRun: cloneAttempt(plugin.latestRun) },
    }
  }

  /**
   * List source-free Plugin summaries owned by one Session.
   * @param agent - Agent whose Session selects visible Plugins.
   * @returns one summary per Plugin in creation order.
   */
  /*
   * 列出当前会话拥有的插件摘要（无源码），按创建顺序排列。
   * @param agent 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
   * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
   */
  listPlugins(agent: Agent): DynamicCordisPluginInspection[] {
    return this.registry.ofSession(agent.id).map(plugin => this.inspectPlugin(agent, plugin.pluginId))
  }

  /**
   * Inspect one Plugin without returning Package source.
   * @param agent - Agent whose Session must own the Plugin.
   * @param pluginId - stable Plugin identity.
   * @returns version pointers, latest run, and all Package summaries.
   */
  /*
   * 查看单个插件的版本指针、最近运行与全部包版本摘要（不返回源码）。
   * @param agent 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
   * @param pluginId 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
   * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
   */
  inspectPlugin(agent: Agent, pluginId: CordisDynamicPluginId): DynamicCordisPluginInspection {
    const plugin = this.owned(agent, pluginId)
    if (plugin === undefined) throw new Error(missingPluginMessage(pluginId))
    const reference = this.reference(agent, pluginId)
    if (reference === undefined) throw new Error(`dynamic plugin "${pluginId}" has no package`)
    return {
      ...reference,
      packages: [...plugin.packages.values()].map(definition => ({
        packageId: definition.packageId,
        name: definition.name,
        purpose: definition.purpose,
        hasHostHalf: definition.hostCode !== undefined,
        hasClientHalf: definition.clientCode !== undefined,
      })),
    }
  }

  /**
   * Read one exact immutable Package and its Host and Client source.
   * @param agent - Agent whose Session must own the Plugin.
   * @param pluginId - Stable Plugin identity that owns the Package.
   * @param packageId - Exact immutable Package identity to inspect.
   * @returns Package metadata, source, and the Plugin's lifecycle pointers.
   */
  /*
   * 读取某个确切包版本，包括其 Host 与 Client 源码（仅限持有会话），
   * 供模型查看/修改后再定义新版本。
   * @param agent 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
   * @param pluginId 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
   * @param packageId 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
   * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
   */
  inspectPackage(
    agent: Agent,
    pluginId: CordisDynamicPluginId,
    packageId: CordisDynamicPackageId,
  ): DynamicCordisPackageInspection {
    const plugin = this.owned(agent, pluginId)
    if (plugin === undefined) throw new Error(missingPluginMessage(pluginId))
    const definition = plugin.packages.get(packageId)
    if (definition === undefined) {
      throw new Error(`dynamic package "${packageId}" does not exist on plugin "${pluginId}"`)
    }
    return {
      pluginId,
      packageId,
      name: definition.name,
      purpose: definition.purpose,
      code: {
        ...definition.hostCode === undefined ? {} : { host: definition.hostCode },
        ...definition.clientCode === undefined ? {} : { client: definition.clientCode },
      },
      // 生命周期指针快照：仅拷贝存在字段，避免暴露内部可变引用
      /* jscpd:ignore-start */
      ...plugin.currentPackageId === undefined ? {} : { currentPackageId: plugin.currentPackageId },
      ...plugin.nextPackageId === undefined ? {} : { nextPackageId: plugin.nextPackageId },
      ...plugin.run === undefined ? {} : {
        activeRun: { pluginRunId: plugin.run.pluginRunId, packageId: plugin.run.packageId },
      },
      ...plugin.latestRun === undefined ? {} : { latestRun: cloneAttempt(plugin.latestRun) },
      /* jscpd:ignore-end */
    }
  }

  /**
   * Record a post-load render failure for the exact active run.
   * @param agent - Agent whose Session must own the Plugin.
   * @param pluginId - Stable Plugin identity that rendered.
   * @param pluginRunId - Exact active run that produced the failure.
   * @param failure - Slot, message, and entry-retirement result.
   * @returns Null after recording or ignoring a stale report.
   */
  /*
   * 记录 Client 渲染失败：把失败写入当前运行的 renderFailure 并标记 attempt 失败；
   * 若这是该次激活首次渲染失败，还通过 steerRenderFailure 通知 agent 指导修复。
   * 过期运行的上报会被静默忽略。
   * @param agent 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
   * @param pluginId 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
   * @param pluginRunId 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
   * @param failure 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
   * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
   */
  @Remote('reportRenderFailure')
  async reportRenderFailure(
    agent: Agent,
    pluginId: CordisDynamicPluginId,
    pluginRunId: CordisDynamicPluginRunId,
    failure: DynamicCordisRenderFailure,
  ): Promise<null> {
    const plugin = this.owned(agent, pluginId)
    if (plugin?.run?.pluginRunId === pluginRunId) {
      const run = plugin.run
      const definition = plugin.packages.get(plugin.run.packageId)
      const shouldSteer = run.renderFailure === undefined
      run.renderFailure = failure
      const attempt = plugin.latestRun
      if (attempt?.pluginRunId === pluginRunId) {
        attempt.error = this.diagnostic(plugin, attempt, 'client-render', failure)
        attempt.client = { status: 'failed', waitingFor: attempt.client.waitingFor, error: failure.message }
        attempt.status = 'failed'
      }
      if (definition !== undefined && shouldSteer) {
        this.steerRenderFailure(agent, plugin, definition, pluginRunId, failure)
      }
    }
    return await Promise.resolve(null)
  }

  /**
   * Report a Client guard rejection that happened after the Package completed activation.
   * @param agent - Agent whose Session must own the Plugin.
   * @param pluginId - Stable Plugin identity whose Client code was rejected.
   * @param pluginRunId - Exact active run that produced the rejection.
   * @param failure - Original guard message and stack.
   * @returns Null after reporting or ignoring a stale/startup failure.
   */
  /*
   * 记录激活完成后 Client 代码触发的守卫拒绝：交给 steerGuardFailure 去重后上报
   * agent（守卫错误不影响运行本身，插件保持 running）。
   * @param agent 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
   * @param pluginId 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
   * @param pluginRunId 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
   * @param failure 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
   * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
   */
  @Remote('reportClientGuardFailure')
  async reportClientGuardFailure(
    agent: Agent,
    pluginId: CordisDynamicPluginId,
    pluginRunId: CordisDynamicPluginRunId,
    failure: CordisErrorDetails,
  ): Promise<null> {
    const plugin = this.owned(agent, pluginId)
    const run = plugin?.run
    if (plugin !== undefined && run?.pluginRunId === pluginRunId) {
      this.steerGuardFailure(plugin, run, 'Client', failure)
    }
    return await Promise.resolve(null)
  }

  /**
   * Invoke an active Host method while rejecting stale Client runs.
   * @param pluginId - Stable Plugin identity that owns the method.
   * @param pluginRunId - Exact active run authorizing the call.
   * @param method - Registered Host handler name.
   * @param args - JSON argument delivered to the handler.
   * @returns The JSON result or a typed invocation failure.
   */
  /*
   * Client 调用 Host 方法：校验插件在运行且运行 ID 未过期，查找已注册的 handler 并
   * 执行；handler 抛错时先向 agent 上报一次，再返回结构化错误给 Client。
   * @param pluginId 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
   * @param pluginRunId 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
   * @param method 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
   * @param args 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
   * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
   */
  @Remote('invoke')
  async invoke(
    pluginId: CordisDynamicPluginId,
    pluginRunId: CordisDynamicPluginRunId,
    method: string,
    args: JsonValue,
  ): Promise<DynamicCordisInvokeResult> {
    const plugin = this.registry.get(pluginId)
    if (plugin === undefined || plugin.run === undefined) {
      return { ok: false, code: 'plugin-not-running', message: `dynamic plugin "${pluginId}" is not running` }
    }
    const run = plugin.run
    if (run.pluginRunId !== pluginRunId) {
      return { ok: false, code: 'stale-run', message: `activation "${pluginRunId}" is no longer active` }
    }
    const handler = run.handlers.get(method)
    if (handler === undefined) {
      return { ok: false, code: 'method-not-found', message: `dynamic plugin "${pluginId}" registered no Host method "${method}"` }
    }
    try {
      return { ok: true, value: await handler(args) as JsonValue }
    } catch (error) {
      const failure = errorDetails(error)
      this.steerHostHandlerFailure(plugin, run, method, failure)
      return { ok: false, code: 'handler-error', ...failure }
    }
  }

  /**
   * 解析激活计划：校验插件归属、包存在、run/update 模式与当前版本的一致性、
   * 且没有并发启动；allowActiveAttach 允许面板直连时附加到已在运行的激活。
   * @param allowActiveAttach - 是否允许附加到当前正在运行的激活（面板直连传 true）
   * @returns 成功时为 { ok: true, plugin, definition, mode }，失败时为结构化拒绝响应
   */
  private resolvePlan(
    agent: Agent,
    pluginId: CordisDynamicPluginId,
    packageId: CordisDynamicPackageId,
    mode: CordisDynamicRunMode,
    allowActiveAttach = false,
  ): { ok: true } & ActivationPlan | { ok: false; response: Extract<DynamicCordisRunResponse, { ok: false }> } {
    const plugin = this.owned(agent, pluginId)
    if (plugin === undefined) return { ok: false, response: { ok: false, reason: 'plugin-missing', message: missingPluginMessage(pluginId) } }
    const definition = plugin.packages.get(packageId)
    if (definition === undefined) {
      return { ok: false, response: { ok: false, reason: 'package-missing', message: `plugin "${pluginId}" has no package "${packageId}"` } }
    }
    const current = plugin.currentPackageId
    if (mode === 'update' && (current === undefined || current === packageId)) {
      return {
        ok: false,
        response: {
          ok: false,
          reason: 'invalid-mode',
          message: current === undefined
            ? `plugin "${pluginId}" has no successful version yet; start "${packageId}" with mode "run"`
            : `package "${packageId}" is already current; use mode "run"`,
        },
      }
    }
    if (mode === 'run' && current !== undefined && current !== packageId) {
      return {
        ok: false,
        response: {
          ok: false,
          reason: 'invalid-mode',
          message: `package "${packageId}" differs from current "${current}"; use mode "update"`,
        },
      }
    }
    if (!allowActiveAttach && this.starting.has(pluginId)) {
      return { ok: false, response: { ok: false, reason: 'transition-in-flight', message: `plugin "${pluginId}" is already starting` } }
    }
    return { ok: true, plugin, definition, mode }
  }

  /**
   * 发起一次 Host 半部启动：同一插件并发启动时复用已在进行中的 Promise（starting
   * Map），防止重复激活；Promise 结算后清理 Map 条目。
   */
  private activate(
    plan: ActivationPlan,
    requestId: ApprovalRequestId | undefined,
    allowActiveAttach: boolean,
    attempt: DynamicCordisRunAttempt,
  ): Promise<DynamicCordisHostHalfResult> {
    const inFlight = this.starting.get(plan.plugin.pluginId)
    if (inFlight !== undefined) return inFlight
    const starting = this.startFresh(plan, requestId, allowActiveAttach, attempt)
    this.starting.set(plan.plugin.pluginId, starting)
    return starting.finally(() => { this.starting.delete(plan.plugin.pluginId) })
  }

  /**
   * 真正执行一次全新激活：若允许附加且目标版本已在运行则直接返回"附加成功"；否则
   * 先回收旧运行、创建 run 对象、执行 Host 代码（startHost），成功后发布
   * `cordis/dynamic-package` 事件，再按是否含 Client 半部决定立即提交激活还是进入
   * client-pending 等待浏览器端。
   */
  private async startFresh(
    plan: ActivationPlan,
    requestId: ApprovalRequestId | undefined,
    allowActiveAttach: boolean,
    attempt: DynamicCordisRunAttempt,
  ): Promise<DynamicCordisHostHalfResult> {
    const { plugin, definition, mode } = plan
    if (allowActiveAttach
      && plugin.run?.packageId === definition.packageId
      && plugin.run.pluginRunId === attempt.pluginRunId) {
      return {
        ok: true,
        pluginId: plugin.pluginId,
        packageId: definition.packageId,
        pluginRunId: plugin.run.pluginRunId,
        waitingFor: missingFor(this.ctx, plugin.run),
        startedHere: false,
      }
    }
    if (plugin.run !== undefined) await this.retract(plugin)
    if (mode === 'update' || plugin.currentPackageId === undefined) plugin.nextPackageId = definition.packageId
    const run: DynamicCordisRun = {
      pluginRunId: attempt.pluginRunId,
      packageId: definition.packageId,
      handlers: new Map(),
      handlerDisposers: [],
      reportedRuntimeErrors: new Set(),
      ...requestId === undefined ? {} : { startedForRequest: requestId },
    }
    if (definition.hostCode !== undefined) {
      const failure = await this.startHost(plugin, definition.hostCode, run)
      if (failure !== undefined) return { ok: false, ...failure }
    }
    plugin.run = run
    this.ctx.emit('cordis/dynamic-package', {
      pluginId: plugin.pluginId,
      packageId: definition.packageId,
      pluginRunId: run.pluginRunId,
      name: definition.name,
    })
    attempt.host = {
      status: run.fiber === undefined ? 'absent' : missingFor(this.ctx, run).length === 0 ? 'running' : 'waiting',
      waitingFor: missingFor(this.ctx, run),
    }
    if (definition.clientCode === undefined) {
      this.commitActivation(plugin, run)
    } else {
      attempt.status = 'client-pending'
      attempt.client = { status: 'pending', waitingFor: [] }
    }
    return {
      ok: true,
      pluginId: plugin.pluginId,
      packageId: definition.packageId,
      pluginRunId: run.pluginRunId,
      waitingFor: missingFor(this.ctx, run),
      startedHere: true,
    }
  }

  /**
   * 在 VM 沙箱中执行 Host 代码并挂载：handle 回调把 Host 暴露给 Client 的方法收集进
   * run.handlers；校验返回值是插件函数或含 apply 的对象；随后在 cordis-dynamic 组下
   * 以 Fiber 启动（守卫包裹见 guard.ts）。任何失败先清理已注册的 handler 再返回错误。
   */
  private async startHost(
    plugin: DynamicCordisPlugin,
    hostCode: string,
    run: DynamicCordisRun,
  ): Promise<CordisErrorDetails | undefined> {
    const handle = (method: unknown, fn: unknown): (() => void) => {
      const normalized = normalizeHandler(method, fn)
      run.handlers.set(normalized.method, normalized.handler)
      const dispose = (): void => {
        if (run.handlers.get(normalized.method) === normalized.handler) run.handlers.delete(normalized.method)
      }
      run.handlerDisposers.push(dispose)
      return dispose
    }
    try {
      const sandbox = createSandbox(plugin.pluginId, { handle })
      const evaluated = await evaluateHostCode(sandbox, hostCode, plugin.pluginId, this.resolved.vmTimeoutMs)
      if (!isPlugin(evaluated)) {
        throw new Error(evaluated === undefined
          ? 'the Host half returned `undefined` — did you forget `return`?'
          : 'the Host half must return a Plugin function or an object with apply(ctx)')
      }
      run.fiber = await startHostHalf(
        this.requireGroup(),
        evaluated,
        (error) => { this.steerGuardFailure(plugin, run, 'Host', errorDetails(error)) },
      )
      return undefined
    } catch (error) {
      for (const dispose of run.handlerDisposers.splice(0)) dispose()
      return errorDetails(error)
    }
  }

  /**
   * 把浏览器返回的激活结果写入状态机：拒绝时标记 rejected；失败时若该页面确实拥有
   * 此次运行则回收它并记录诊断；成功时更新 client 半部状态并提交激活。
   */
  private async settleActivation(
    plugin: DynamicCordisPlugin | undefined,
    resolution: DynamicCordisRunResolution,
    requestId?: ApprovalRequestId,
  ): Promise<DynamicCordisRunResponse> {
    if (plugin === undefined) return { ok: false, reason: 'plugin-missing', message: 'the dynamic plugin was removed during activation' }
    const attempt = plugin.latestRun
    if (!resolution.ok) {
      if (resolution.reason === 'rejected') {
        if (attempt !== undefined) {
          attempt.status = 'rejected'
          attempt.error = this.diagnostic(plugin, attempt, 'approval', resolution.message ?? 'the run request was declined')
          attempt.client = { status: 'stopped', waitingFor: [] }
        }
        return { ok: false, reason: 'rejected', message: resolution.message ?? 'the run request was declined' }
      }
      const run = plugin.run
      const ownsRun = run !== undefined
        && resolution.pluginRunId === run.pluginRunId
        && (requestId === undefined || run.startedForRequest === requestId)
        && resolution.startedHere !== false
      if (ownsRun) await this.retract(plugin)
      if (attempt !== undefined && (resolution.pluginRunId === undefined || attempt.pluginRunId === resolution.pluginRunId)) {
        this.failAttempt(
          plugin,
          attempt,
          resolution.reason === 'host-half-failed' ? 'host-apply' : 'client-apply',
          {
            message: resolution.message ?? resolution.reason,
            ...resolution.stack === undefined ? {} : { stack: resolution.stack },
          },
        )
      }
      return {
        ok: false,
        reason: resolution.reason,
        message: resolution.message ?? resolution.reason,
        ...resolution.stack === undefined ? {} : { stack: resolution.stack },
      }
    }
    const run = plugin.run
    if (run === undefined || run.pluginRunId !== resolution.pluginRunId) {
      return { ok: false, reason: 'client-half-failed', message: `activation "${resolution.pluginRunId}" is no longer active` }
    }
    if (attempt !== undefined && attempt.pluginRunId === run.pluginRunId) {
      attempt.client = {
        status: resolution.waitingFor === undefined || resolution.waitingFor.length === 0 ? 'running' : 'waiting',
        waitingFor: resolution.waitingFor ?? [],
      }
    }
    this.commitActivation(plugin, run)
    return {
      ...this.runResponse(plugin, {
        ok: true,
        pluginId: plugin.pluginId,
        packageId: run.packageId,
        pluginRunId: run.pluginRunId,
        waitingFor: missingFor(this.ctx, run),
        startedHere: false,
      }),
      ...resolution.waitingFor === undefined ? {} : { clientWaitingFor: resolution.waitingFor },
    }
  }

  /**
   * 提交一次成功激活：更新 currentPackageId、清除 nextPackageId 与运行时标识，
   * 把 attempt 收敛为 running 或 waiting 终态（任一半部仍在等缺失服务则为 waiting）。
   */
  private commitActivation(plugin: DynamicCordisPlugin, run: DynamicCordisRun): void {
    plugin.currentPackageId = run.packageId
    delete plugin.nextPackageId
    delete run.startedForRequest
    const attempt = plugin.latestRun
    if (attempt?.pluginRunId === run.pluginRunId) {
      attempt.status = attempt.host.status === 'waiting' || attempt.client.status === 'waiting' ? 'waiting' : 'running'
      delete attempt.approvalRequestId
      delete attempt.requiresApproval
      delete attempt.error
    }
  }

  /**
   * 将 Host 半部启动结果转换为统一的成功响应（含当前版本与模式）。
   */
  private runResponse(
    plugin: DynamicCordisPlugin,
    started: Extract<DynamicCordisHostHalfResult, { ok: true }>,
  ): Extract<DynamicCordisRunResponse, { ok: true }> {
    return {
      ok: true,
      status: 'running',
      pluginId: plugin.pluginId,
      packageId: started.packageId,
      pluginRunId: started.pluginRunId,
      waitingFor: started.waitingFor,
      currentPackageId: started.packageId,
      mode: plugin.latestRun?.pluginRunId === started.pluginRunId ? plugin.latestRun.mode : 'run',
    }
  }

  /**
   * 广播"请求已结算"事件；override 用于把取消等未走正常结算的路径收敛为对应 outcome。
   */
  private announceResolved(
    requestId: ApprovalRequestId,
    resolution: DynamicCordisRunResolution,
    override?: RequestRunOutcome,
  ): void {
    const outcome = override ?? (resolution.ok ? 'approved' : resolution.reason === 'rejected' ? 'rejected' : 'failed')
    this.ctx.emit('cordis/request-run-resolved', { requestId, outcome })
  }

  /**
   * 把一次模型驱动激活的最终结果注入发起 agent：成功/被拒/失败三套措辞，附带
   * currentPackageId 等上下文，引导模型继续操作或自主修复重试。
   */
  private steerRunOutcome(
    pending: DynamicCordisPendingRequest,
    settled: DynamicCordisRunResponse,
  ): void {
    const agents = this.rootCtx.get('agents')
    const agent = agents?.get(pending.agentId)
    if (agent === undefined) return
    const plugin = this.registry.get(pending.pluginId)
    const identity = `${pending.pluginId}/${pending.packageId} (${pending.pluginRunId})`
    let text: string
    if (settled.ok) {
      text = `Cordis ${pending.mode} ${identity} completed successfully. `
        + `currentPackageId is ${settled.currentPackageId ?? pending.packageId}. Continue using the running Plugin.`
    } else if (settled.reason === 'rejected') {
      text = `The user rejected Cordis ${pending.mode} ${identity}. `
        + 'Do not request the same activation again unless the user asks.'
    } else {
      const returnedStatus = pending.requiresApproval ? 'awaiting-approval' : 'starting'
      text = `Cordis ${pending.mode} ${identity} failed after cordis_run returned ${returnedStatus}: `
        + `${settled.reason}\n${formatErrorDetails(settled)}\n`
        + `currentPackageId: ${plugin?.currentPackageId ?? 'none'}\n`
        + `nextPackageId: ${plugin?.nextPackageId ?? pending.packageId}\n`
        + 'Inspect the failed Package, correct it on the same Plugin when needed, and retry the activation autonomously.'
    }
    agent.steer(createUserMessage({
      content: [{ type: 'text', text }],
      source: { kind: 'plugin', plugin: 'cordis-host-runner' },
    }))
  }

  /**
   * 渲染失败时把修复指引注入 agent：指出失败的槽位、是否让位（abdicated），
   * 并建议定义新版本后以 mode:"update" 自主激活。
   */
  private steerRenderFailure(
    agent: Agent,
    plugin: DynamicCordisPlugin,
    definition: DynamicCordisDefinition,
    pluginRunId: CordisDynamicPluginRunId,
    failure: DynamicCordisRenderFailure,
  ): void {
    agent.steer(createUserMessage({
      content: [{
        type: 'text',
        text: `Cordis Client UI ${plugin.pluginId}/${definition.packageId} (${pluginRunId}) failed while rendering `
          + `Slot "${failure.slot}" after activation.\n`
          + `${formatErrorDetails(failure)}\n`
          + `entryAbdicated: ${failure.abdicated}\n`
          + 'Inspect the failed Package, fix the Client code by defining a new Package on the same Plugin, and '
          + 'activate that Package autonomously with cordis_run mode:"update".',
      }],
      source: { kind: 'plugin', plugin: 'cordis-host-runner' },
    }))
  }

  /**
   * Host 方法调用失败时上报 agent，附带"如何声明缺失服务"的修复建议；
   * 相同错误只上报一次（claimRuntimeFailure 去重）。
   */
  private steerHostHandlerFailure(
    plugin: DynamicCordisPlugin,
    run: DynamicCordisRun,
    method: string,
    failure: CordisErrorDetails,
  ): void {
    const reportKey = `Host\u0000handler\u0000${method}\u0000${failure.message}`
    if (!this.claimRuntimeFailure(plugin, run, reportKey)) return
    const agents = this.rootCtx.get('agents')
    const agent = agents?.get(plugin.sessionId)
    if (agent === undefined) return
    agent.steer(createUserMessage({
      content: [{
        type: 'text',
        text: `Cordis Host handler ${plugin.pluginId}/${run.packageId} (${run.pluginRunId}) failed when the Client called `
          + `host.call(${JSON.stringify(method)}).\n`
          + `${formatErrorDetails(failure)}\n`
          + 'The Plugin remains running. Inspect this Package, correct the Host code on the same Plugin, and activate '
          + 'the new Package autonomously with cordis_run mode:"update". If the handler needs a Service, either declare '
          + 'that Service in the returned Plugin inject list or read it with ctx.get(name) and handle undefined.',
      }],
      source: { kind: 'plugin', plugin: 'cordis-host-runner' },
    }))
  }

  /**
   * 守卫（guard）拒绝运行期代码时上报 agent：Host 与 Client 共用此路径，
   * 按平台区分措辞；同一错误只报一次。
   */
  /* jscpd:ignore-start */
  private steerGuardFailure(
    plugin: DynamicCordisPlugin,
    run: DynamicCordisRun,
    platform: 'Host' | 'Client',
    failure: CordisErrorDetails,
  ): void {
    const reportKey = `${platform}\u0000guard\u0000${failure.message}`
    if (!this.claimRuntimeFailure(plugin, run, reportKey)) return
    const agents = this.rootCtx.get('agents')
    const agent = agents?.get(plugin.sessionId)
    if (agent === undefined) return
    agent.steer(createUserMessage({
      content: [{
        type: 'text',
        text: `Cordis ${platform} guard rejected runtime code in ${plugin.pluginId}/${run.packageId} `
          + `(${run.pluginRunId}) after activation.\n${formatErrorDetails(failure)}\n`
          + 'The Plugin remains running. Inspect this Package, define a corrected Package on the same Plugin, and '
          + 'activate it autonomously with cordis_run mode:"update".',
      }],
      source: { kind: 'plugin', plugin: 'cordis-host-runner' },
    }))
  }
  /* jscpd:ignore-end */

  /**
   * 运行期错误去重闸门：仅当激活仍处于 running/waiting 且该错误键从未上报过时放行，
   * 并把键记入 reportedRuntimeErrors，避免同一错误反复打扰模型。
   */
  private claimRuntimeFailure(plugin: DynamicCordisPlugin, run: DynamicCordisRun, key: string): boolean {
    const attempt = plugin.latestRun
    if (plugin.run !== run || attempt?.pluginRunId !== run.pluginRunId
      || (attempt.status !== 'running' && attempt.status !== 'waiting')) return false
    if (run.reportedRuntimeErrors.has(key)) return false
    run.reportedRuntimeErrors.add(key)
    return true
  }

  /**
   * 把面板直连激活的结算结果注入 agent 上下文（措辞与模型驱动路径不同）。
   */
  private injectUserRunOutcome(
    agent: Agent,
    pluginId: CordisDynamicPluginId,
    settled: DynamicCordisRunResponse,
  ): void {
    const plugin = this.owned(agent, pluginId)
    let text: string
    if (settled.ok) {
      text = `The user manually ran Cordis Plugin ${pluginId}, Package ${settled.packageId}, `
        + `as ${settled.pluginRunId}. The activation succeeded; currentPackageId is ${settled.currentPackageId}.`
    } else {
      const attempt = plugin?.latestRun
      text = `The user manually ran Cordis Plugin ${pluginId}`
        + `${attempt === undefined ? '' : `, Package ${attempt.packageId}, as ${attempt.pluginRunId}`}, but it failed: `
        + `${settled.reason}\n${formatErrorDetails(settled)}\n`
        + `currentPackageId: ${plugin?.currentPackageId ?? 'none'}\n`
        + `nextPackageId: ${plugin?.nextPackageId ?? 'none'}`
    }
    this.injectUserContext(agent, text)
  }

  /**
   * 向持有会话注入一条"用户操作结果"消息；若该会话已不存在则静默跳过。
   */
  private injectUserContext(agent: Agent, text: string): void {
    const agents = this.rootCtx.get('agents')
    if (agents?.get(agent.id) !== agent) return
    agent.inject(createUserMessage({
      content: [{ type: 'text', text }],
      source: { kind: 'plugin', plugin: 'cordis-host-runner' },
    }))
  }

  /**
   * 取消一个待审批请求：认领后把对应 attempt 标记 cancelled 并写入诊断，
   * 再广播结算事件（outcome 为 cancelled）。
   */
  private cancelPending(pluginId: CordisDynamicPluginId, message: string): void {
    const requestId = this.registry.pendingRequestFor(pluginId)
    if (requestId === undefined) return
    const pending = this.registry.claimRequest(requestId)
    if (pending === undefined) return
    const plugin = this.registry.get(pluginId)
    if (plugin?.latestRun?.pluginRunId === pending.pluginRunId) {
      plugin.latestRun.status = 'cancelled'
      plugin.latestRun.error = this.diagnostic(plugin, plugin.latestRun, 'approval', message)
      delete plugin.latestRun.approvalRequestId
      delete plugin.latestRun.requiresApproval
    }
    this.announceResolved(requestId, { ok: false, reason: 'rejected' }, 'cancelled')
  }

  /**
   * 新建一次激活尝试（attempt）记录：按包两端是否有代码初始化 host/client 半部状态，
   * 初始状态为 starting-host（Host 半部待启动）。
   */
  private createAttempt(plan: ActivationPlan): DynamicCordisRunAttempt {
    return {
      pluginRunId: CordisDynamicPluginRunId(this.registry.mintPluginRunId()),
      packageId: plan.definition.packageId,
      mode: plan.mode,
      status: 'starting-host',
      host: {
        status: plan.definition.hostCode === undefined ? 'absent' : 'pending',
        waitingFor: [],
      },
      client: {
        status: plan.definition.clientCode === undefined ? 'absent' : 'pending',
        waitingFor: [],
      },
    }
  }

  /**
   * 把一次尝试标记为失败并写入诊断；按失败阶段（host* 或 client*）更新对应半部状态。
   */
  private failAttempt(
    plugin: DynamicCordisPlugin,
    attempt: DynamicCordisRunAttempt,
    phase: NonNullable<DynamicCordisRunAttempt['error']>['phase'],
    failure: CordisErrorDetails,
  ): void {
    attempt.status = 'failed'
    attempt.error = this.diagnostic(plugin, attempt, phase, failure)
    if (phase.startsWith('host')) attempt.host = { status: 'failed', waitingFor: [], error: failure.message }
    else attempt.client = { status: 'failed', waitingFor: [], error: failure.message }
  }

  private diagnostic(
    plugin: DynamicCordisPlugin,
    attempt: DynamicCordisRunAttempt,
    phase: NonNullable<DynamicCordisRunAttempt['error']>['phase'],
    failure: CordisErrorDetails | string,
  ): NonNullable<DynamicCordisRunAttempt['error']> {
    const details = typeof failure === 'string' ? { message: failure } : failure
    return {
      phase,
      ...details,
      pluginId: plugin.pluginId,
      packageId: attempt.packageId,
      pluginRunId: attempt.pluginRunId,
    }
  }

  /**
   * 回收一次运行：卸载全部 handler、销毁 Fiber、广播 `cordis/dynamic-retract` 事件。
   */
  private async retract(plugin: DynamicCordisPlugin): Promise<void> {
    const run = plugin.run
    if (run === undefined) return
    delete plugin.run
    for (const dispose of run.handlerDisposers.splice(0)) dispose()
    if (run.fiber !== undefined) await run.fiber.dispose()
    this.ctx.emit('cordis/dynamic-retract', {
      pluginId: plugin.pluginId,
      packageId: run.packageId,
      pluginRunId: run.pluginRunId,
    })
  }

  /**
   * 校验插件归属：仅当插件属于给定 agent 的会话时返回插件，否则返回 undefined。
   * 所有需要"会话持有"的操作都先过这道闸。
   */
  private owned(agent: Agent, pluginId: CordisDynamicPluginId): DynamicCordisPlugin | undefined {
    const plugin = this.registry.get(pluginId)
    return plugin?.sessionId === agent.id ? plugin : undefined
  }

  /**
   * 惰性创建动态插件共用的 Fiber 组（cordis-dynamic），Host 半部都挂载到该组下，
   * 便于统一管理生命周期。
   */
  private requireGroup(): Fiber {
    this.group ??= this.rootCtx.plugin({ name: 'cordis-dynamic', apply: () => {} })
    return this.group
  }
}

/**
 * 汇总 run 缺失的服务名：无 Fiber（纯 Client 包）时视为无缺失。
 */
function missingFor(ctx: Context, run: DynamicCordisRun): string[] {
  return run.fiber === undefined ? [] : missingServices(ctx, run.fiber)
}

/**
 * 生成"插件不存在"的标准报错文案，附带"可能已被移除或 DSH 重启后丢失"的提示。
 */
function missingPluginMessage(id: CordisDynamicPluginId): string {
  return `no dynamic plugin "${id}" in this process — it may have been removed or lost on DSH restart`
}

/**
 * 把任意 thrown 值归一为 { message, stack? }，供跨进程传输与错误展示。
 */
function errorDetails(error: unknown): CordisErrorDetails {
  if (typeof error !== 'object' || error === null) return { message: String(error) }
  const message = 'message' in error && typeof error.message === 'string'
    ? error.message
    : Object.prototype.toString.call(error)
  const stack = 'stack' in error && typeof error.stack === 'string' ? error.stack : undefined
  return { message, ...stack === undefined ? {} : { stack } }
}

/**
 * 把错误详情格式化为人类可读的多行文本（消息 + 可选堆栈）。
 */
function formatErrorDetails(failure: CordisErrorDetails): string {
  return `message: ${failure.message}`
    + (failure.stack === undefined ? '' : `\nstack:\n${failure.stack}`)
}

/**
 * 克隆一次 attempt 的引用字段（host/client/error 及各 waitingFor 数组），
 * 防止外部修改污染内部状态机。
 */
function cloneAttempt(attempt: DynamicCordisRunAttempt): DynamicCordisRunAttempt {
  return {
    ...attempt,
    host: { ...attempt.host, waitingFor: [...attempt.host.waitingFor] },
    client: { ...attempt.client, waitingFor: [...attempt.client.waitingFor] },
    ...attempt.error === undefined ? {} : { error: { ...attempt.error } },
  }
}

export default DynamicCordisRunnerService
