/**
 * ================================ 文件注释 ================================
 * 【文件职责】定义 cordis-host-runner 全部跨端（Host/浏览器 Client/会话）共享的
 *             "线缆词汇表"：动态插件的各类 ID、运行状态、请求/响应结构与事件负载
 *             类型。本文件只含类型，不含任何运行逻辑。
 * 【技术维度】品牌类型（Branded）用于给 ID 打上编译期标记；联合类型表达"判别式
 *             结果"（ok: true/false + reason）；通过 declare module 声明合并扩展
 *             Cordis 的事件映射（Events），事件要求 @mode 与负载 @param 文档。
 * 【产品维度】这些类型是"AI 现场编写 Cordis 插件"功能的契约层：面板、模型工具、
 *             Client 运行器两侧按同一套结构对话，保证状态可展示、可持久化。
 * 【逻辑维度】按概念分组：各类 ID 与平台标记 → inspect 查询的清单/请求/结算类型 →
 *             激活尝试的状态机类型（CordisRunStatus/CordisHalfState/Attempt）→
 *             面板展示类型（Package/RunRequest/Inventory）→ 各动词的响应类型
 *             （RunResponse/StopResponse/HalfResult/InvokeResult）→ 事件映射。
 * 【关键边界】所有类型必须可 JSON 序列化（不能含函数/类实例）；事件注释按协议
 *             要求标注 @mode 与 @param；新增事件键需同步 Client 侧类型。
 * 【新手阅读建议】先浏览第 1–2 组 ID 类型理解"品牌"用法，再看 CordisRunStatus
 *             与 DynamicCordisRunAttempt 掌握状态机，最后对照 index.ts 各方法
 *             的返回类型阅读响应联合类型。
 * ==========================================================================
 */

/**
 * Client-safe wire vocabulary of the dynamic Cordis plugin runner.
 * @module @deepseek-ai/dsh-cordis-host-runner/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type { JsonValue, SessionId } from '@deepseek-ai/dsh-session/types'

/** Stable identity of one dynamic plugin instance. */
/*
 * 一个动态插件实例的稳定身份：跨包版本/激活运行保持不变，作为插件在注册表中的主键。
 */
export type CordisDynamicPluginId = Branded<'CordisDynamicPluginId'>

/** Identity of one immutable package version belonging to a dynamic plugin. */
/*
 * 属于某插件的某个不可变包版本的身份：每次 define 都铸造新 ID，旧版本永不修改。
 */
export type CordisDynamicPackageId = Branded<'CordisDynamicPackageId'>

/** Identity of one successful activation attempt. */
/*
 * 一次成功激活尝试的身份：区分新旧运行，Client 侧的过期调用凭它被拒绝（stale-run）。
 */
export type CordisDynamicPluginRunId = Branded<'CordisDynamicPluginRunId'>

/** Identity of one human approval request. */
/*
 * 一次人工审批请求的身份：模型驱动的 Client 激活等待用户确认时，凭它关联请求与结算。
 */
export type ApprovalRequestId = Branded<'ApprovalRequestId'>

/** Identity of one cross-page inspect query. */
/*
 * 一次跨页面只读查询（inspect query）的身份：Host 发起、Client 应答时用于关联。
 */
export type CordisInspectRequestId = Branded<'CordisInspectRequestId'>

/** Runtime plane that owns an inspect provider. */
/*
 * 拥有 inspect 提供者的运行平面：host 为 Node 进程侧，client 为浏览器侧。
 */
export type CordisInspectPlatform = 'host' | 'client'

/** One model-callable read-only query exposed by an inspect provider. */
export interface CordisInspectMethodManifest {
  /** Method name, unique within its provider. */
  name: string
  /** What the query returns and when to use it. */
  description: string
  /** JSON Schema accepted by the query. */
  inputSchema: JsonValue
  /** JSON Schema produced by the query. */
  outputSchema: JsonValue
}

/** Serializable directory entry for one inspect provider. */
/*
 * 一个 inspect 提供者的可序列化目录条目：提供者 ID、能力说明与其显式方法清单。
 */
export interface CordisInspectProviderManifest {
  /** Provider identity, unique within one platform. */
  id: string
  /** Capability described by this provider. */
  description: string
  /** Explicit read-only queries. */
  methods: readonly CordisInspectMethodManifest[]
}

/** Provider directory row returned by `cordis_inspect_list`. */
export interface CordisInspectProviderView extends CordisInspectProviderManifest {
  /** Runtime plane that executes these methods. */
  platform: CordisInspectPlatform
}

/** Host broadcast requesting one live Client inspect result. */
export interface CordisInspectQueryRequest {
  /** Correlation identity. */
  requestId: CordisInspectRequestId
  /** Session whose model requested the query. */
  agentId: SessionId
  /** Provider selected from the Client manifest. */
  provider: string
  /** Method selected from the provider manifest. */
  method: string
  /** JSON query input, omitted when the method has no fields. */
  input?: JsonValue
}

/** Result sent from a Client provider to the waiting Host query. */
/*
 * Client 提供者向等待中的 Host 查询回报的结果：成功携带 JSON 数据，失败携带
 * 结构化原因（提供者缺失/方法缺失/输入非法/执行出错/已取消）。
 */
export type CordisInspectQueryResolution =
  | { ok: true; data: JsonValue }
  | {
    ok: false
    reason: 'provider-missing' | 'method-missing' | 'invalid-input' | 'provider-error' | 'cancelled'
    message: string
  }

/** Notification that a Client inspect request can no longer be answered. */
/*
 * 通知所有 Client：某次查询已结算或取消，不再可应答（用于清理等待状态）。
 */
export interface CordisInspectQueryResolved {
  /** Query that left the pending state. */
  requestId: CordisInspectRequestId
}

/** Whether a Client answer claimed the still-pending query. */
/*
 * Client 的应答是否"赢得了"仍处于等待中的查询：未知/已取消/过期/迟到的应答为 false。
 */
export interface CordisInspectResolveAck {
  /** False for unknown, cancelled, stale, or late answers. */
  accepted: boolean
}

/** Whether a package starts the current version or replaces it. */
/*
 * 激活模式：run 表示启动当前/指定版本，update 表示用新版本替换已成功的当前版本。
 */
export type CordisDynamicRunMode = 'run' | 'update'

/** How a model-driven Client activation request left the pending state. */
/*
 * 模型驱动的 Client 激活请求的最终去向：批准/完成/拒绝/取消/失败（广播给所有页面）。
 */
export type RequestRunOutcome = 'approved' | 'completed' | 'rejected' | 'cancelled' | 'failed'

/** Error fields preserved across the Host/Client transport. */
/*
 * 跨 Host/Client 传输时保留的错误字段：消息必带，堆栈在 thrown 值携带时才存在。
 */
export interface CordisErrorDetails {
  /** Original error message. */
  message: string
  /** Original stack when the thrown value supplied one. */
  stack?: string
}

/** Persisted state of the latest activation attempt. */
/*
 * 最近一次激活尝试的持久化状态机：从等待审批 → 启动各阶段 → 运行/等待，
 * 或以拒绝/失败/取消/停止收场。面板据此渲染进度。
 */
export type CordisRunStatus =
  | 'awaiting-approval'
  | 'starting-host'
  | 'client-pending'
  | 'running'
  | 'waiting'
  | 'rejected'
  | 'failed'
  | 'cancelled'
  | 'stopped'

/** One platform half within an activation attempt. */
/*
 * 一次激活尝试中"某一半"（Host 或 Client）的状态：运行/等待/失败等，
 * waitingFor 列出该半部因缺失服务仍在等待的服务名。
 */
export interface CordisHalfState {
  /** Lifecycle state of this half. */
  status: 'absent' | 'pending' | 'stopped' | 'running' | 'waiting' | 'failed'
  /** Services still needed by a successfully created Fiber. */
  waitingFor: readonly string[]
  /** Failure text for this half. */
  error?: string
}

/** Structured failure associated with an exact activation attempt. */
/*
 * 与某次确切激活尝试绑定的结构化失败：失败阶段、消息/堆栈，以及插件/包/运行三重 ID。
 */
export interface CordisRunDiagnostic {
  /** Stage that failed. */
  phase: 'approval' | 'host-load' | 'host-apply' | 'client-load' | 'client-apply' | 'client-render'
  /** Original failure text. */
  message: string
  /** Original failure stack when available. */
  stack?: string
  /** Stable Plugin identity. */
  pluginId: CordisDynamicPluginId
  /** Immutable Package identity. */
  packageId: CordisDynamicPackageId
  /** Exact attempt identity. */
  pluginRunId: CordisDynamicPluginRunId
}

/** Latest activation attempt retained independently from the physical run. */
/*
 * 最近一次激活尝试的完整记录：独立于物理运行保留，即使运行已被回收，面板仍能
 * 展示"上次尝试"的审批/失败状态。
 */
export interface DynamicCordisRunAttempt {
  /** Exact attempt identity. */
  pluginRunId: CordisDynamicPluginRunId
  /** Target Package. */
  packageId: CordisDynamicPackageId
  /** Explicit run/update intent. */
  mode: CordisDynamicRunMode
  /** Current attempt state. */
  status: CordisRunStatus
  /** Pending Client activation request; it represents approval only when `requiresApproval` is true. */
  approvalRequestId?: ApprovalRequestId
  /** Whether the pending Client activation requires a user decision. */
  requiresApproval?: boolean
  /** Host-half state. */
  host: CordisHalfState
  /** Client-half state. */
  client: CordisHalfState
  /** Most recent failure. */
  error?: CordisRunDiagnostic
}

/** One running package announced to browser pages. */
/*
 * 向浏览器页面广播"某个包正在运行"的通知负载：插件/包/运行三重 ID 加名称。
 */
export interface DynamicCordisPackage {
  /** Stable plugin instance. */
  pluginId: CordisDynamicPluginId
  /** Immutable package version currently active. */
  packageId: CordisDynamicPackageId
  /** This activation's identity. */
  pluginRunId: CordisDynamicPluginRunId
  /** Package label. */
  name: string
}

/** One pending model-driven Client activation forwarded to browser pages. */
/*
 * 转发给所有页面的"待处理模型驱动激活"：含发起会话、目标版本、用途说明，
 * 以及是否需要用户显式决策（requiresApproval）。
 */
export interface DynamicCordisRunRequest {
  /** Correlation identity of the activation request. */
  requestId: ApprovalRequestId
  /** Session whose plugin and tool call own the request. */
  agentId: SessionId
  /** Stable plugin instance being acted on. */
  pluginId: CordisDynamicPluginId
  /** Package version the request will activate. */
  packageId: CordisDynamicPackageId
  /** Explicit lifecycle intent. */
  mode: CordisDynamicRunMode
  /** Package label. */
  name: string
  /** User-facing reason supplied at define time. */
  purpose: string
  /** Whether a page must wait for an explicit user decision before activation. */
  requiresApproval: boolean
}

/** One settled model-driven Client activation request broadcast to all pages. */
/*
 * 广播给所有页面的"请求已结算"通知：请求 ID 加最终去向（批准/完成/拒绝/取消/失败）。
 */
export interface DynamicCordisRequestResolved {
  /** Request that left the pending state. */
  requestId: ApprovalRequestId
  /** How the request settled. */
  outcome: RequestRunOutcome
}

/** One activation withdrawn from every page. */
export interface DynamicCordisRetracted {
  /** Stable plugin instance. */
  pluginId: CordisDynamicPluginId
  /** Package version that was active. */
  packageId: CordisDynamicPackageId
  /** Exact activation being withdrawn. */
  pluginRunId: CordisDynamicPluginRunId
}

/** Package metadata exposed by the inventory without source code. */
/*
 * 库存视图中的包版本元数据：不含源码，只含名称/用途与两端代码是否存在。
 */
export interface DynamicCordisInventoryPackage {
  /** Immutable package version. */
  packageId: CordisDynamicPackageId
  /** Package label. */
  name: string
  /** User-facing purpose. */
  purpose: string
  /** Whether this version contains Host code. */
  hasHostHalf: boolean
  /** Whether this version contains Client code. */
  hasClientHalf: boolean
}

/** One stable plugin row in the frame-wide inventory. */
/*
 * 全框架库存中的一行稳定插件：含持有会话、全部版本、当前/目标版本指针、
 * 当前激活与最近一次尝试。
 */
export interface DynamicCordisInventoryRow {
  /** Stable plugin instance. */
  pluginId: CordisDynamicPluginId
  /** Session that owns this plugin. */
  agentId: SessionId
  /** Immutable versions in define order. */
  packages: readonly DynamicCordisInventoryPackage[]
  /** Last package that completed activation successfully. */
  currentPackageId?: CordisDynamicPackageId
  /** Package selected for a failed or in-progress transition. */
  nextPackageId?: CordisDynamicPackageId
  /** Current activation, absent while stopped. */
  activeRun?: {
    pluginRunId: CordisDynamicPluginRunId
    packageId: CordisDynamicPackageId
  }
  /** Latest activation attempt, including pending approval and diagnostics. */
  latestRun?: DynamicCordisRunAttempt
}

/** Answer to removing a plugin and all of its package versions. */
/*
 * 删除插件及其全部版本的应答：成功时告知是否停掉了正在运行的激活，失败时说明原因。
 */
export type DynamicCordisUndefineReceipt =
  | { ok: true; wasRunning: boolean }
  | { ok: false; reason: 'plugin-missing'; message: string }

/** One render failure observed after a Client half loaded. */
/*
 * Client 半部加载后发生的一次渲染失败：失败槽位、消息/堆栈，
 * abdicated 表示失败条目是否已主动让出槽位。
 */
export interface DynamicCordisRenderFailure {
  /** Slot whose component failed. */
  slot: string
  /** Render failure text. */
  message: string
  /** Original render failure stack when available. */
  stack?: string
  /** Whether the failing contribution relinquished its slot. */
  abdicated: boolean
}

/** Result shared by model-driven and panel-driven activation. */
/*
 * 模型驱动与面板驱动共用的一次激活应答：成功时给出激活身份与等待服务，
 * 失败时给出结构化原因（插件/包缺失、模式非法、迁移冲突、任一半失败、被拒/取消等）。
 */
export type DynamicCordisRunResponse =
  | {
    ok: true
    /** Whether activation completed synchronously, is starting in a Client, or awaits user approval. */
    status: 'awaiting-approval' | 'starting' | 'running'
    pluginId: CordisDynamicPluginId
    packageId: CordisDynamicPackageId
    pluginRunId: CordisDynamicPluginRunId
    /** Missing Host services; a parked Fiber is a successful activation. */
    waitingFor: readonly string[]
    /** Missing Client services reported by the approving page. */
    clientWaitingFor?: readonly string[]
    /** Last fully successful Package. */
    currentPackageId?: CordisDynamicPackageId
    /** Selected transition target. */
    nextPackageId?: CordisDynamicPackageId
    /** Explicit lifecycle intent. */
    mode: CordisDynamicRunMode
  }
  | {
    ok: false
    reason:
      | 'plugin-missing'
      | 'package-missing'
      | 'invalid-mode'
      | 'transition-in-flight'
      | 'host-half-failed'
      | 'client-half-failed'
      | 'rejected'
      | 'cancelled'
      | 'not-running'
    message: string
    /** Original failure stack when available. */
    stack?: string
  }

/** Result of stopping a Plugin without deleting its Packages. */
/*
 * 停止插件（保留包版本）的应答：成功或"插件不存在/本就没在运行"。
 */
export type DynamicCordisStopResponse =
  | { ok: true }
  | { ok: false; reason: 'plugin-missing' | 'not-running'; message: string }

/** Result of bringing up the Host half before loading the Client half. */
/*
 * 启动 Host 半部（尚未加载 Client 半部）的结果：成功时给出激活身份与缺失服务，
 * startedHere 区分"本页真正启动"与"仅附加到已运行激活"。
 */
export type DynamicCordisHostHalfResult =
  | {
    ok: true
    pluginId: CordisDynamicPluginId
    packageId: CordisDynamicPackageId
    pluginRunId: CordisDynamicPluginRunId
    waitingFor: readonly string[]
    /** False when a panel merely attaches this page to an already active run. */
    startedHere: boolean
  }
  | ({ ok: false } & CordisErrorDetails)

/** Client-half source for one exact activation. */
/*
 * 某次确切激活的 Client 半部源码：浏览器页面凭插件/运行 ID 校验后执行。
 */
export interface DynamicCordisClientSource {
  /** Browser JavaScript body. */
  code: string
  /** Package label. */
  name: string
  /** Stable plugin instance. */
  pluginId: CordisDynamicPluginId
  /** Immutable source version. */
  packageId: CordisDynamicPackageId
  /** Exact activation the source belongs to. */
  pluginRunId: CordisDynamicPluginRunId
}

/** Browser verdict used for both approved tool runs and panel runs. */
/*
 * 浏览器侧对激活的最终裁决（审批通过的工具运行与面板直连共用）：成功给出运行 ID
 * 与缺失服务，失败给出原因（被拒/任一半失败）与失败时的附加信息。
 */
export type DynamicCordisRunResolution =
  | { ok: true; pluginRunId: CordisDynamicPluginRunId; waitingFor?: readonly string[] }
  | {
    ok: false
    reason: 'rejected' | 'host-half-failed' | 'client-half-failed'
    /** Activation that failed; absent for a refusal before activation. */
    pluginRunId?: CordisDynamicPluginRunId
    /** Whether this page created the failed activation instead of attaching to it. */
    startedHere?: boolean
    message?: string
    stack?: string
  }

/** Whether a Client activation resolution reached the still-pending request. */
/*
 * Client 的激活结算是否命中了仍待处理的请求：迟到/未知/过期的应答为 false。
 */
export interface DynamicCordisResolveAck {
  /** False for late, unknown, or stale answers. */
  accepted: boolean
}

/** Result of routing one Client call to the active Host half. */
/*
 * 把一次 Client 调用路由到活动 Host 半部的结果：成功返回 JSON 值，失败区分
 * 插件未运行/运行过期/方法不存在/处理器抛错四类原因。
 */
export type DynamicCordisInvokeResult =
  | { ok: true; value: JsonValue }
  | ({ ok: false; code: 'plugin-not-running' | 'stale-run' | 'method-not-found' | 'handler-error' } & CordisErrorDetails)

declare module '@deepseek-ai/cordis' {
  // 以下事件由 Host 广播、Client/页面订阅，构成"请求激活/查询"的双向通信通道
  interface Events {
    /**
     * A Client-bearing activation needs a browser page, and may require a user decision.
     * @param request - correlation identity, owner, target version, mode, and approval requirement.
     * @mode emit
     */
    // 含 Client 代码的激活需要一个浏览器页面参与，且可能需要用户决策
    'cordis/request-run'(request: DynamicCordisRunRequest): void
    /**
     * A pending Client activation request left the answerable state.
     * @param resolved - request identity and outcome.
     * @mode emit
     */
    // 待处理的 Client 激活请求已离开"可应答"状态（已结算/取消）
    'cordis/request-run-resolved'(resolved: DynamicCordisRequestResolved): void
    /**
     * One exact Plugin/Package activation is now live in the Host.
     * @param pkg - stable plugin, immutable package, run identity, and label.
     * @mode emit
     */
    // 某次确切的插件/包激活已在 Host 侧上线
    'cordis/dynamic-package'(pkg: DynamicCordisPackage): void
    /**
     * One exact activation was withdrawn.
     * @param retracted - plugin, package, and run identity.
     * @mode emit
     */
    // 某次确切激活已被收回
    'cordis/dynamic-retract'(retracted: DynamicCordisRetracted): void
    /**
     * Request a live read-only query from the Client inspect registry.
     * @param request - correlation, Session, provider, method, and JSON input.
     * @mode emit
     */
    // 向 Client inspect 注册表请求一次实时只读查询
    'cordis/inspect-query'(request: CordisInspectQueryRequest): void
    /**
     * Notify every Client that an inspect query has settled or been cancelled.
     * @param resolved - exact query identity that is no longer answerable.
     * @mode emit
     */
    // 通知所有 Client：某次 inspect 查询已结算或被取消
    'cordis/inspect-query-resolved'(resolved: CordisInspectQueryResolved): void
  }
}
