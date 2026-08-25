/**
 * Process-local dynamic Plugin registry and its opaque identity mints.
 * @module @deepseek-ai/dsh-cordis-host-runner/registry
 */

import type { Fiber } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {
  ApprovalRequestId, CordisDynamicPackageId, CordisDynamicPluginId, CordisDynamicPluginRunId,
  CordisDynamicRunMode, DynamicCordisRenderFailure, DynamicCordisRunAttempt,
} from './types.ts'

/** One Host method exposed to this package's Client half. */
export type DynamicCordisHandler = (args: unknown) => Promise<unknown>

/** One live activation and everything its teardown owns. */
export interface DynamicCordisRun {
  /** Exact activation identity. */
  pluginRunId: CordisDynamicPluginRunId
  /** Immutable package version being run. */
  packageId: CordisDynamicPackageId
  /** Host-half Fiber, absent for Client-only packages. */
  fiber?: Fiber
  /** Active Host methods. */
  handlers: Map<string, DynamicCordisHandler>
  /** Method registration cleanup. */
  handlerDisposers: (() => void)[]
  /** Runtime failures already sent to the owning Agent during this activation. */
  reportedRuntimeErrors: Set<string>
  /** Last render failure observed for this version's current run. */
  renderFailure?: DynamicCordisRenderFailure
  /** Approval whose transition started this run, when model-driven. */
  startedForRequest?: ApprovalRequestId
}

/** One immutable package version. */
/*
 * 一个不可变包版本：一次 define 的产物，持有名称/用途与 Host/Client 两端源码。
 */
export interface DynamicCordisDefinition {
  /** Package identity. */
  packageId: CordisDynamicPackageId
  /** Package label. */
  name: string
  /** User-facing purpose. */
  purpose: string
  /** Host source. */
  hostCode?: string
  /** Client source. */
  clientCode?: string
}

/** Stable plugin instance containing immutable package versions. */
/*
 * 稳定插件实例：跨版本存在，持有多个不可变包版本（按定义顺序）、用户授权记录
 * 与生命周期指针（当前/目标版本、当前运行、最近尝试）。
 */
export interface DynamicCordisPlugin {
  /** Stable identity. */
  pluginId: CordisDynamicPluginId
  /** Owning session. */
  sessionId: SessionId
  /** Versions in define order. */
  packages: Map<CordisDynamicPackageId, DynamicCordisDefinition>
  /** Client-bearing Packages individually authorized by the user. */
  approvedClientPackages: Set<CordisDynamicPackageId>
  /** Whether one user decision authorized future Package versions of this Plugin. */
  clientVersionUpdatesApproved: boolean
  /** Last successfully activated version. */
  currentPackageId?: CordisDynamicPackageId
  /** Failed or in-progress target version. */
  nextPackageId?: CordisDynamicPackageId
  /** Current activation. */
  run?: DynamicCordisRun
  /** Latest activation attempt, including approval and asynchronous failure state. */
  latestRun?: DynamicCordisRunAttempt
}

/** One suspended model-driven activation. */
/*
 * 一个挂起中的模型驱动激活：等待浏览器页面处理，含目标版本、模式与审批要求。
 */
export interface DynamicCordisPendingRequest {
  /** Session whose model requested this activation. */
  agentId: SessionId
  pluginId: CordisDynamicPluginId
  packageId: CordisDynamicPackageId
  pluginRunId: CordisDynamicPluginRunId
  mode: CordisDynamicRunMode
  /** Whether this request must wait for an explicit user decision. */
  requiresApproval: boolean
}

/** Request accepted by `define`; it never crosses the Remote transport. */
/*
 * define 的入参：指定会话归属、新建或追加插件、包名称/用途与两端源码。
 * 仅在 Host 进程内传递，不会跨 Remote 传输。
 */
export interface DynamicCordisDefineRequest {
  /** Session that owns the plugin. */
  sessionId: SessionId
  /** Create a plugin or append to an existing one. */
  plugin:
    | { kind: 'new'; idPrefix: string }
    | { kind: 'existing'; pluginId: CordisDynamicPluginId }
  /** Package label. */
  name: string
  /** User-facing purpose. */
  purpose: string
  /** At least one source half. */
  code: { host?: string; client?: string }
}

/** Successful `define` result. */
/*
 * define 成功的回执：铸造出的插件/包 ID 与两端代码是否存在。
 */
export interface DynamicCordisDefineReceipt {
  pluginId: CordisDynamicPluginId
  packageId: CordisDynamicPackageId
  name: string
  purpose: string
  hasHostHalf: boolean
  hasClientHalf: boolean
}

/** Source-free modification context for an explicit `@pluginId` reference. */
/*
 * 用户显式引用某插件时的"无源码修改上下文"：版本指针 + 当前激活/最近尝试摘要。
 */
export interface DynamicCordisReference {
  pluginId: CordisDynamicPluginId
  packageId: CordisDynamicPackageId
  name: string
  purpose: string
  currentPackageId?: CordisDynamicPackageId
  nextPackageId?: CordisDynamicPackageId
  activeRun?: { pluginRunId: CordisDynamicPluginRunId; packageId: CordisDynamicPackageId }
  latestRun?: DynamicCordisRunAttempt
}

/** Source-free Plugin summary returned by layered self inspection. */
/*
 * 分层自查返回的插件摘要（无源码）：在 reference 基础上附全部包版本摘要。
 */
export interface DynamicCordisPluginInspection extends DynamicCordisReference {
  /** Immutable Package summaries in define order. */
  packages: Array<{
    packageId: CordisDynamicPackageId
    name: string
    purpose: string
    hasHostHalf: boolean
    hasClientHalf: boolean
  }>
}

/** Exact immutable Package metadata and source returned by explicit inspection. */
/*
 * 显式检查某个包版本时返回的确切元数据与源码（仅限持有会话）。
 */
export interface DynamicCordisPackageInspection extends DynamicCordisReference {
  /** Host and Client function bodies stored for this Package. */
  code: { host?: string; client?: string }
}

/** Registry, identity mints, and pending approval index. */
/*
 * 注册表：以插件 ID 为主键的存储、四类 ID 的铸造计数器，以及"待审批请求"索引。
 * 纯数据层，无副作用逻辑，由 DynamicCordisRunnerService 调用。
 */
export class DynamicCordisRegistry {
  // 插件存储：插件 ID -> 插件记录
  private readonly plugins = new Map<CordisDynamicPluginId, DynamicCordisPlugin>()
  // 待审批请求索引：审批 ID -> 请求（claim 后即删除，保证只结算一次）
  private readonly pendingRequests = new Map<ApprovalRequestId, DynamicCordisPendingRequest>()
  // 四类 ID 的自增计数器（插件/包/运行/审批）
  private nextPlugin = 1
  private nextPackage = 1
  private nextRun = 1
  private nextApproval = 1

  /**
   * Mint a semantic plugin ID without reusing a prior suffix.
   * @param prefix - validated lowercase semantic prefix proposed by the model.
   * @returns a process-unique Plugin ID.
   */
  /*
   * 铸造语义化插件 ID：形如 `前缀-序号`，循环直到不与已有插件冲突（序号自增）。
   * @param prefix 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
   * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
   */
  mintPluginId(prefix: string): string {
    let id: CordisDynamicPluginId
    do id = `${prefix}-${this.nextPlugin++}` as CordisDynamicPluginId
    while (this.plugins.has(id))
    return id
  }

  /**
   * Mint an immutable package ID.
   * @returns a process-unique Package ID.
   */
  /*
   * 铸造包版本 ID：形如 `pkg-序号`。
   * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
   */
  mintPackageId(): string {
    return `pkg-${this.nextPackage++}`
  }

  /**
   * Mint an activation ID.
   * @returns a process-unique Plugin Run ID.
   */
  /*
   * 铸造激活运行 ID：形如 `run-序号`。
   * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
   */
  mintPluginRunId(): string {
    return `run-${this.nextRun++}`
  }

  /**
   * Mint an approval ID.
   * @returns a process-unique approval request ID.
   */
  /*
   * 铸造审批请求 ID：形如 `approval-序号`。
   * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
   */
  mintApprovalRequestId(): string {
    return `approval-${this.nextApproval++}`
  }

  /**
   * Add one stable plugin.
   * @param plugin - Plugin record to retain under its stable ID.
   */
  /*
   * 新增一个插件记录（define 的新建分支调用）。
   * @param plugin 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
   */
  add(plugin: DynamicCordisPlugin): void {
    this.plugins.set(plugin.pluginId, plugin)
  }

  /**
   * Read one plugin.
   * @param id - stable Plugin ID.
   * @returns the Plugin record, or `undefined` when absent.
   */
  /*
   * 按 ID 读取插件；不存在时返回 undefined。
   * @param id 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
   * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
   */
  get(id: CordisDynamicPluginId): DynamicCordisPlugin | undefined {
    return this.plugins.get(id)
  }

  /**
   * Delete one plugin and all package versions.
   * @param id - stable Plugin ID to remove.
   * @returns whether a Plugin record was removed.
   */
  /*
   * 删除插件及其全部包版本（undefine 的收尾步骤）。
   * @param id 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
   * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
   */
  delete(id: CordisDynamicPluginId): boolean {
    return this.plugins.delete(id)
  }

  /**
   * Read all plugins in creation order.
   * @returns a snapshot of every Plugin record.
   */
  /*
   * 按创建顺序返回所有插件快照。
   * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
   */
  all(): DynamicCordisPlugin[] {
    return [...this.plugins.values()]
  }

  /**
   * Read one session's plugins in creation order.
   * @param sessionId - owning session to filter by.
   * @returns a snapshot of matching Plugin records.
   */
  /*
   * 按会话过滤插件（inventory/snapshot 的按会话视图）。
   * @param sessionId 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
   * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
   */
  ofSession(sessionId: SessionId): DynamicCordisPlugin[] {
    return this.all().filter(plugin => plugin.sessionId === sessionId)
  }

  /**
   * Publish one pending approval.
   * @param id - approval request ID.
   * @param pending - resolver and Plugin metadata retained until settlement.
   */
  /*
   * 登记一个待审批请求（触发点为 run() 广播请求事件时）。
   * @param id 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
   * @param pending 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
   */
  armRequest(id: ApprovalRequestId, pending: DynamicCordisPendingRequest): void {
    this.pendingRequests.set(id, pending)
  }

  /**
   * Read one pending approval without claiming it.
   * @param id - approval request ID.
   * @returns the pending request, or `undefined` when absent.
   */
  /*
   * 只读窥视待审批请求（不删除），用于结算前的校验。
   * @param id 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
   * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
   */
  peekRequest(id: ApprovalRequestId): DynamicCordisPendingRequest | undefined {
    return this.pendingRequests.get(id)
  }

  /**
   * Claim one pending approval; first answer wins.
   * @param id - approval request ID.
   * @returns the claimed request, or `undefined` when already settled.
   */
  /*
   * 认领待审批请求：删除索引并返回请求，保证"先到先得"、只结算一次；
   * 已被认领/取消的请求返回 undefined。
   * @param id 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
   * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
   */
  claimRequest(id: ApprovalRequestId): DynamicCordisPendingRequest | undefined {
    const pending = this.pendingRequests.get(id)
    if (pending !== undefined) this.pendingRequests.delete(id)
    return pending
  }

  /**
   * Cancel one pending approval.
   * @param id - approval request ID to remove.
   */
  /*
   * 直接移除待审批请求（当前代码路径中未使用，保留为对称 API）。
   * @param id 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
   */
  disarmRequest(id: ApprovalRequestId): void {
    this.pendingRequests.delete(id)
  }

  /**
   * Find a pending approval for one Plugin.
   * @param pluginId - stable Plugin ID.
   * @returns its approval request ID, or `undefined` when none is pending.
   */
  /*
   * 查找某插件是否有待审批请求：同一插件同一时刻至多一个，用于拒绝并发激活。
   * @param pluginId 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
   * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
   */
  pendingRequestFor(pluginId: CordisDynamicPluginId): ApprovalRequestId | undefined {
    for (const [requestId, request] of this.pendingRequests) {
      if (request.pluginId === pluginId) return requestId
    }
    return undefined
  }
}
