/**
 * ================================ 文件注释 ================================
 * 【文件职责】subagent 能力缝对外暴露的消费者契约：一次性子代理的请求（SubagentStartRequest）、
 *   结果（SubagentResult）、运行句柄（SubagentRun）、提供者（SubagentProvider）以及
 *   start/end 生命周期事件载荷（SubagentRunInfo/SubagentRunEndInfo）的类型定义。
 * 【技术维度】纯类型模块（类型 + 少量品牌化构造函数），不包含运行时逻辑；
 *   通过 Branded 类型（SubagentRunId）区分不透明 ID；停止原因用可合并扩展的接口族（SubagentStopReasonMap）。
 * 【产品维度】模型工具层（dsh-tool-subagent）据此构造请求并解释结果；宿主与插件监听
 *   subagent/start、subagent/end 事件时也使用这里的载荷类型。
 * 【逻辑维度】按代码顺序：运行 ID 品牌类型 → 生命周期事件载荷 → 能力声明 → 一次性请求 →
 *   解析后请求 → 续聊创建请求/规格 → 结果与停止原因 → 运行句柄 → 提供者接口。
 * 【关键边界】这里只定义契约，不实现校验；能力缺失由 SubagentRuntime.start 在委托前拒绝。
 *   续聊的内部控制接口不在此处，而在 lifecycle.ts / continuation.ts 中保持包内私有。
 * 【新手阅读建议】先读 SubagentStartRequest（一次委托要什么）、SubagentResult（能拿回什么），
 *   再读 SubagentProvider 了解提供者需要实现的两个方法。
 * ==========================================================================
 */

/**
 * The seam's consumer-facing contracts: request, result, and capability types
 * for {@link SubagentProvider}, plus the `subagent/start` and `subagent/end`
 * payloads that plugins and hosts observe. Internal control interfaces belong
 * with their implementation — the lifecycle observer in `./lifecycle.ts`, the
 * continuation host in `./continuation.ts` — so this module stays the published
 * surface rather than a bag of everything type-shaped.
 *
 * @module @deepseek-ai/dsh-subagent/types
 */

import type { Agent, AgentOptions } from '@deepseek-ai/dsh-agent'
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import type { ObjectJsonSchema, ToolRestriction } from '@deepseek-ai/dsh-tools'
import type { SubagentDescriptorData } from './descriptor.ts'

/** Identifies one accepted subagent run across its lifecycle event pair. */
// 中文：品牌化（branded）字符串类型：同一对 start/end 事件用同一个 runId 关联，
// 类型上区别于普通 string，防止误用。
export type SubagentRunId = Branded<'SubagentRunId'>

/**
 * Brand a string as a {@link SubagentRunId}.
 * @param id - the raw run id.
 * @returns the same string, branded.
 */
// 中文：把原始字符串强转成 SubagentRunId（运行时只是同一字符串，类型层面加上品牌标记）。
export function SubagentRunId(id: string): SubagentRunId {
  return id as SubagentRunId
}

/**
 * Observe-only identifying detail for a published subagent run, carried by
 * `subagent/start`. One-shot runs and continuable Activation epochs share this
 * payload, so an observer sees the same vocabulary for both.
 */
// 中文：subagent/start 事件载荷：只含观察用的身份信息。一次性运行与续聊 Activation
// 的 epoch 共用同一载荷，观察者用同一套字段即可同时理解两者。
export interface SubagentRunInfo {
  /** Unique identity shared with the paired terminal event. */
  readonly runId: SubagentRunId
  /**
   * Provider name recorded when the child was first created. The provider may
   * be absent when an accepted one-shot run becomes ready or a persisted
   * Activation cold-resumes, because neither lifecycle depends on continued
   * registration.
   */
  readonly provider: string
  /** The child agent's id. */
  readonly id: SessionId
  /** Snapshot of whether `SubagentRun.localAgent` was present when start fulfilled. */
  readonly local: boolean
}

/**
 * Observe-only outcome detail for a settled subagent run, carried by
 * `subagent/end` and paired with one {@link SubagentRunInfo} by `runId`.
 */
// 中文：subagent/end 事件载荷：在 start 载荷基础上追加终止信息（停止原因与最后的
// 助手输出），与配对的 start 事件共享同一个 runId。
export interface SubagentRunEndInfo {
  /** Unique identity shared with the paired start event. */
  readonly runId: SubagentRunId
  /** The same provider name carried by the paired start event. */
  readonly provider: string
  /** The child agent's id. */
  readonly id: SessionId
  /** Snapshot of whether `SubagentRun.localAgent` was present when start fulfilled. */
  readonly local: boolean
  /** The terminal stop reason. */
  readonly stopReason: SubagentResult['stopReason']
  /**
   * The child's final assistant output, selected by the same rule as
   * {@link SubagentResult.output}; absent on infrastructure rejection or when
   * the child produced none.
   */
  readonly lastAssistantMessage?: ContentBlock[]
}

/**
 * Which START-TIME features a provider supports. Checked by the service before delegating to
 * {@link SubagentProvider.start}: a request that needs a capability the chosen provider lacks
 * is rejected with a typed error rather than accepted-then-ignored (the "fail loud, no silent
 * degradation" rule). These flags describe the ONE-SHOT
 * {@link SubagentProvider.start} path, where the provider composes the child;
 * continuable children are composed by the continuation manager itself and are
 * gated by {@link SubagentProvider.prepareContinuable} instead. Each flag
 * corresponds one-to-one to a {@link SubagentStartRequest} option: `depthLimit`
 * to `maxDepth`; the other names match.
 */
// 中文：提供者在"启动时"支持哪些特性。服务端在委托前逐一核对请求所需能力，
// 缺能力即拒绝（fail loud，绝不接受后忽略）。每个布尔与 SubagentStartRequest 的
// 某个可选项一一对应。
export interface SubagentCapabilities {
  readonly outputSchema: boolean
  readonly depthLimit: boolean
  readonly toolFilter: boolean
  readonly persona: boolean
}

/**
 * What a caller asks for when starting a ONE-SHOT subagent. The tool layer
 * builds this from the model's `{ description, prompt }` plus its own config;
 * the service validates {@link SubagentCapabilities} against the named provider
 * and resolves the durable descriptor before dispatching to
 * {@link SubagentProvider.start}.
 */
// 中文：调用方发起一次性子代理委托时的请求：label 是短标签、prompt 是初始内容、
// parent 是发起者（进程内提供者从中推导工作区与血缘）、signal 是贯穿前后的取消通道，
// outputSchema/maxDepth/toolFilter/persona 是需要能力背书的可选项。
export interface SubagentStartRequest {
  /** Optional short display label persisted with a session-backed child. */
  readonly label?: string
  /** Content delivered as the child's user message. */
  readonly prompt: ContentBlock[]
  /**
   * The spawning agent. In-process providers derive workspace, lineage, and
   * delegation depth from its durable session state. ACP reads only its cwd,
   * and only when no deployment `cwd` override is configured.
   */
  readonly parent: Agent
  /**
   * Cancellation signal from the spawning context (the tool's `exec.signal`).
   * This is the canonical cancellation channel both before and after startup:
   * a provider rejects `start()` after cleaning partial resources when it
   * fires before the run is published, and cancels the published run's
   * remaining turn work when it fires afterward.
   */
  readonly signal: AbortSignal
  readonly agentOptions?: AgentOptions
  /**
   * Object-rooted JSON Schema within `assertObjectJsonSchema`'s enforced subset. Start rejects
   * unsupported schemas or providers without the capability. Data must be plain host-realm JSON;
   * a successful child returns the matching value as {@link SubagentResult.structured}.
   */
  readonly outputSchema?: ObjectJsonSchema
  /**
   * Optional absolute delegation-depth cap for the child being started: its
   * computed depth must be less than or equal to this non-negative safe
   * integer. Requires {@link SubagentCapabilities.depthLimit}; rejected at
   * start otherwise.
   */
  readonly maxDepth?: number
  /**
   * Optional child tool scoping. Requires {@link SubagentCapabilities.toolFilter};
   * rejected at start otherwise. In-process backends apply it as a scoped
   * `tools.restrict()` in the child's creation window: the named tools vanish
   * from the child's prompt AND refuse to execute (one visibility), with loud
   * unknown-name validation.
   */
  readonly toolFilter?: ToolRestriction
  /**
   * Optional per-child persona. Requires {@link SubagentCapabilities.persona};
   * rejected at start otherwise. In-process backends register it as a scoped
   * `deployment:persona` section on the child, SHADOWING the deployment's
   * persona for this child alone — same template semantics as the deployment
   * persona (strict `{{…}}` interpolation against the registered variables).
   */
  readonly persona?: string
}

/**
 * Provider-facing one-shot request after {@link SubagentRuntime.start} resolves
 * the durable child descriptor.
 */
// 中文：服务端解析后的请求：在原始请求上附加已快照并校验过的持久化描述符，
// 提供者直接在子代理日志里写入它即可。
export interface ResolvedSubagentStartRequest extends SubagentStartRequest {
  /** Detached descriptor a session-backed provider persists in the child log. */
  readonly descriptor: SubagentDescriptorData
}

/**
 * What the continuation manager asks a provider for while materializing one
 * continuable child's FIRST activation. The manager has already reserved the
 * durable child identity and owns every later operation, so this request
 * carries only what distinguishes a fresh child from one seeded with parent
 * history.
 */
// 中文：续聊管理器在物化子代理首次 Activation 时向 provider 索取的信息：只有保留的
// 会话 ID、委托父代理与取消信号——因为之后的整个生命周期都归管理器所有。
export interface ContinuableCreateRequest {
  /** The reserved durable child session id, for provider diagnostics. */
  readonly sessionId: SessionId
  /** The delegating parent agent whose history a seeding provider reads. */
  readonly parent: Agent
  /**
   * Caller cancellation, which owns preparation only until the manager accepts
   * the initial prompt into the child's inbox.
   */
  readonly signal: AbortSignal
}

/**
 * A provider's detached contribution to one continuable child's creation. This
 * is DATA, never a capability: it carries no Agent, `AgentHandle`, prompt
 * delivery, result, disposal, or resume operation, because the continuation
 * manager owns the child's whole lifecycle after preparation.
 */
// 中文：provider 对一次续聊子代理创建的"纯数据"贡献：只有是否用父历史种子初始化子会话
// （seed 从 seq 0 连续、无损 JSON、平衡）——不含任何 Agent、句柄或操作能力。
export interface ContinuableCreateSpec {
  /**
   * Completed-turn prefix of the parent's log to seed the child session with,
   * or absent for a fresh child. Same durable contract as
   * `CreateAgentOptions.seed`: contiguous from seq 0, lossless JSON, balanced.
   */
  readonly seed?: readonly SessionEvent[]
}

/**
 * Why a subagent run ended. Merge-extensible (a backend may add variants);
 * consumers branch on the known cases and fall through `default`. The known
 * cases mirror the harness turn-end vocabulary so the tool layer can map a
 * non-`completed` result to an `isError` tool result.
 */
// 中文：停止原因映射族：已知五类与 harness 回合结束词汇对齐；接口可被后端合并扩展，
// 消费者对已知分支 switch、未知分支落入 default。
export interface SubagentStopReasonMap {
  /** The child finished its turn normally. */
  completed: 'completed'
  /** Cancelled through the request signal or disposal. */
  aborted: 'aborted'
  /** Model or transport failure. */
  error: 'error'
  /** The child hit its token ceiling before finishing. */
  'max-tokens': 'max-tokens'
  /** The child declined the task. */
  refusal: 'refusal'
}

// 中文：停止原因的最终联合类型：后端合并进映射族时它自动变宽。
/** The union over {@link SubagentStopReasonMap} — widens automatically as backends merge in variants. */
export type SubagentStopReason = SubagentStopReasonMap[keyof SubagentStopReasonMap]

/**
 * The terminal outcome of a subagent run, resolved by {@link SubagentRun.result}.
 */
// 中文：子代理运行的最终结果：output 是最终助手输出，structured 是请求了 outputSchema
// 且成功满足时的结构化值，diagnostic 是非 completed 时 provider 撰写的失败详情
// （限 4KB、不得含工具输入/文件内容/凭据等敏感信息）。
export interface SubagentResult {
  /**
   * The child's final assistant output is the content of its last non-empty
   * assistant message. Empty-content messages, including usage-only messages,
   * are skipped. Without a non-empty message, the output is its accumulated
   * assistant text stream, or `[]` when the child produced neither.
   */
  readonly output: ContentBlock[]
  /**
   * The structured result after a requested `outputSchema` was successfully
   * satisfied. Requesting a schema does not guarantee presence: a provider can
   * end with `stopReason: 'error'` when the child fails or finishes without a
   * valid capture. The structured value is validated against the requested
   * output schema by the provider; `unknown` here because the seam is
   * schema-agnostic.
   */
  readonly structured?: unknown
  /**
   * Provider-authored, non-assistant failure detail for a non-`completed`
   * result. Providers keep this text free of tool inputs, file contents,
   * environment values, credentials, and raw protocol payloads, and limit it
   * to 4096 UTF-8 bytes. Consumers present it separately from {@link output}.
   */
  readonly diagnostic?: string
  /** Why the run ended. A non-`completed` reason means `output` may be partial. */
  readonly stopReason: SubagentStopReason
}

/**
 * ONE-SHOT child handle returned after publication. Prompt submission, turn
 * work, and infrastructure faults after that boundary belong to {@link result}.
 * Consumers await that result and must always {@link dispose} to cancel
 * remaining work and reach quiescence. A run is one disposable foreground
 * delegation with one result; continuable conversations have no run — the
 * continuation manager holds their `AgentHandle` directly and orders every
 * turn through the child's own inbox.
 */
// 中文：一次性子代理的运行句柄：发布后提示词提交与回合工作都归 result 管；
// 消费者必须等待 result 并最终 dispose()（幂等）以取消剩余工作并到达静默。
export interface SubagentRun {
  /**
   * Parent-scoped run id. For a local run, this MUST equal the published child
   * session id, whose `parentSession` records `request.parent.session.id`; a
   * remote provider mints an id unique in the parent namespace.
   */
  readonly id: SessionId
  /**
   * The exact published in-process child, or `undefined` for a remote run.
   * When present, its id is {@link id}; the provider retains no ownership
   * implication beyond the run's ordinary {@link dispose} contract.
   */
  readonly localAgent: Agent | undefined
  /**
   * Resolves with the child's terminal {@link SubagentResult} when the run
   * settles. Does NOT reject on a child-level failure — a model/transport
   * failure resolves with `stopReason: 'error'` so the consumer maps it to an
   * `isError` tool result. Rejects on an infrastructure fault the seam cannot
   * represent as a stop reason.
   */
  readonly result: Promise<SubagentResult>
  /**
   * Cancel remaining work, reach child quiescence, and release resources.
   * Idempotent.
   */
  dispose(): Promise<void>
}

/**
 * One registered transport for running child agents. Providers are trusted
 * same-process implementations; callers treat descriptors and returned values
 * as borrowed immutable data. The service may call one provider concurrently
 * for distinct children. Providers isolate operation-local mutable state; a
 * shared capacity controller may delay an operation but must not couple its
 * settlement or cleanup to a sibling.
 */
// 中文：一个已注册的子代理运输后端（提供者）。name 唯一；capabilities 描述启动期能力；
// start 建立一次性子代理，prepareContinuable（可选，方法存在即能力）为续聊子代理
// 提供创建期输入。提供者是受信任的同进程实现，可被并发调用。
export interface SubagentProvider {
  /** Unique registry name (e.g. `spawn`, `fork`, `acp`). */
  readonly name: string
  /** The start-time features this provider supports (see {@link SubagentCapabilities}). */
  readonly capabilities: SubagentCapabilities
  /**
   * Whether the child sees the parent's completed-turn prefix. This is descriptive, not a
   * service-validated start capability: the model-facing tool derives truthful wording from it.
   * It says nothing about tool registration, injected services, or authority inheritance.
   */
  readonly inheritsParentContext: boolean
  /**
   * Establish a ONE-SHOT child and return its handle after publication.
   * The service has already validated that every requested start-time
   * capability is supported and resolved `request.descriptor`, so a
   * session-backed implementation appends that descriptor inside the child's
   * initial turn. Before fulfillment, the provider owns setup and cleans any
   * unpublished partial resources before rejecting. Ownership transfers on
   * fulfillment; subsequent turn or infrastructure failure settles through
   * the returned run. Distinct starts may overlap; cancellation, failure,
   * result settlement, and disposal remain independent for each run.
   */
  start(request: ResolvedSubagentStartRequest): Promise<SubagentRun>
  /**
   * OPTIONAL (continuable-creation capability): contribute the detached
   * creation inputs that distinguish this provider's continuable children —
   * only whether the child session is seeded with parent history. Method
   * presence IS the capability: the service rejects continuable starts on
   * providers without it, while a provider that has it may still serve
   * ordinary one-shot delegations.
   *
   * This is the provider's ONLY participation in a continuable child. The
   * continuation manager owns identity reservation, composition, Agent
   * creation, prompt delivery, cold resume, ownership, and disposal, so a
   * provider never sees the child's Agent, handle, turns, or teardown.
   * Distinct preparations may overlap; each follows its own signal and returns
   * data belonging only to `request.sessionId`.
   */
  prepareContinuable?(request: ContinuableCreateRequest): Promise<ContinuableCreateSpec>
}
