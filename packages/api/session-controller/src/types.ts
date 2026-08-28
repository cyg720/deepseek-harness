/** Browser-safe request, result, and lifecycle vocabulary for the Session Remote service.
 * @remarks 文件说明：文件职责：实现 api/session-controller 中 types 模块的职责，并向相邻模块提供可复用能力。
 * ；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * api/session-controller 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。 */

import type {
  AttachmentIdType, ImageAttachmentLimits, ImageAttachmentRef, ImageMediaType,
} from '@deepseek-ai/dsh-attachment'
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { MessageId } from '@deepseek-ai/dsh-llm/brand'
import type { ContentBlock } from '@deepseek-ai/dsh-llm/types'
import type { ChunkRow } from '@deepseek-ai/dsh-session/chunk-rows'
import type { JsonValue, SessionHeader, SessionId, SurfaceOp } from '@deepseek-ai/dsh-session/types'
import type { SessionProjectionMap } from '@deepseek-ai/dsh-session-projection/types'
import type { JobId } from '@deepseek-ai/dsh-jobs/brand'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    /** Host state persisted for cold Session list summaries. */
    sessionListMetadata: SessionListMetadata
    /** Host state for the boot-constant image-limit view. */
    imageLimits: null
    /** Durable model selection already used by a request and still pending for a later request. */
    modelSelection: ModelSelectionProjectionState
  }
  interface SessionProjectionMap {
    /** Persisted facts used to summarize a Session without activating it. */
    sessionListMetadata: SessionListMetadata
    /** Image-intake limits enforced by the Session prompt endpoint. */
    imageLimits: ImageAttachmentLimits
    /** Durable model selection already used and selected for the next request. */
    modelSelection: ModelSelectionProjection
  }
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * Complete validated model selection requested for subsequent prompt
     * assembly. Log-only: it never enters derived model history.
     */
    'model/selection': ModelSelection
  }
}

/** Persisted hints used to summarize a cold Session. */
export interface SessionListMetadata {
  /** Whether the folded prefix contains no turn. */
  readonly blank: boolean
  /** Latest human-authored prompt time in the folded prefix. */
  readonly lastPromptAt: number | null
}

/** Every available cached wire value used as partial, possibly stale Session-list hints. */
export interface SessionProjectionHints {
  readonly asOfSeq: number
  /** Provider-validated values present in the cache; omitted keys remain unknown. */
  readonly values: SessionProjectionValues
}

/** Complete projection values at an exact Session event cursor. */
export interface SessionProjectionBaseline {
  readonly asOfSeq: number
  /** Provider-validated values; omitted keys are absent capabilities at this cut. */
  readonly values: SessionProjectionValues
}

/** Typed known projections plus JSON-safe values contributed outside this compilation face. */
export type SessionProjectionValues = Partial<SessionProjectionMap>
  & Readonly<Record<string, SessionProjectionValue>>

/** Browser-submitted prompt content; the Host promotes image bytes to durable references. */
export type PromptContentPart =
  | { readonly type: 'text'; readonly text: string }
  | {
    readonly type: 'image'
    readonly mediaType: ImageMediaType
    readonly data: string
    readonly name?: string
  }

/** Complete model selection for one Session. */
export interface ModelSelection {
  readonly provider: string
  readonly model: string
  readonly reasoningEffort?: string
}

/** Host fold state for durable model selection. */
export interface ModelSelectionProjectionState {
  /** Selection consumed by the latest recorded model request. */
  readonly lastUsed: ModelSelection | null
  /** Later user selection not yet consumed by a matching model request. */
  readonly pending: ModelSelection | null
}

/** Client view of the durable model-selection fold. */
export interface ModelSelectionProjection {
  /** Selection consumed by the latest recorded model request. */
  readonly lastUsed: ModelSelection | null
  /** Selection the next request should use, falling back to {@link lastUsed}. */
  readonly next: ModelSelection | null
}

/** One adapter-owned reasoning effort for an exact model route. */
export interface ModelReasoningEffort {
  readonly id: string
  readonly name: string
  readonly description?: string
}

/** Selectable reasoning metadata for one exact model route. */
export interface ModelReasoning {
  readonly efforts: readonly ModelReasoningEffort[]
  readonly defaultEffort?: string
}

/** One model displayed inside its provider group. */
export interface ModelCatalogModel {
  readonly id: string
  readonly name: string
  readonly description?: string
  readonly reasoning?: ModelReasoning
}

/** One provider and its successfully loaded model catalog. */
export interface ModelProviderGroup {
  readonly id: string
  readonly name: string
  readonly models: readonly ModelCatalogModel[]
}

/** One provider whose model catalog lookup failed. */
export interface ModelCatalogFailure {
  readonly id: string
  readonly name: string
  readonly message: string
}

/** Host-generation model catalog and the default used by unconfigured Sessions. */
export interface ModelCatalog {
  readonly default: ModelSelection
  /** Provider routes currently able to serve a request, including empty catalogs. */
  readonly routableProviders: readonly string[]
  readonly groups: readonly ModelProviderGroup[]
  readonly failures: readonly ModelCatalogFailure[]
}

/** One client-requested mutation of a still-pending queue item. */
export type QueueAction =
  | { readonly kind: 'edit'; readonly content: readonly ContentBlock[] }
  | { readonly kind: 'remove' }
  | { readonly kind: 'steer' }

/** One Session list entry. */
export interface SessionSummary {
  readonly sessionId: SessionId
  readonly updatedAt: number
  readonly running: boolean
  readonly blank: boolean
  readonly parentSessionId?: SessionId
  readonly origin?: 'subagent'
  readonly cwd?: string
  readonly projections?: SessionProjectionHints
}

/** One session-content search result. */
export interface SessionSearchItem {
  readonly sessionId: SessionId
  readonly snippet: string
}

/** Maximum number of Sessions returned by one search.
 * @remarks 中文说明：常量说明：SESSION_SEARCH_RESULT_LIMIT 用于处理
 * SESSION_SEARCH_RESULT_LIMIT 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
export const SESSION_SEARCH_RESULT_LIMIT = 20

/** Maximum search snippet length in Unicode code points.
 * @remarks 中文说明：常量说明：SESSION_SEARCH_SNIPPET_MAX_CODE_POINTS 用于处理
 * SESSION_SEARCH_SNIPPET_MAX_CODE_POINTS 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
export const SESSION_SEARCH_SNIPPET_MAX_CODE_POINTS = 240

/** Error details returned by Session Remote methods. */
export interface SessionErrorDetailsMap {
  'bad-request': Record<never, never>
  cancelled: Record<never, never>
  'session-not-found': { readonly sessionId: SessionId }
  'model-unavailable': { readonly provider: string; readonly model: string }
  'session-conflict': {
    readonly sessionId: SessionId
    readonly requestedCwd: string
    readonly existingCwd?: string
  }
  'invalid-time-zone': { readonly value: string }
  'workspace-attach-failed': { readonly sessionId: SessionId; readonly workspaceId: string }
  'workspace-not-found': { readonly workspaceId: string }
  'agent-preset-conflict': {
    readonly sessionId: SessionId
    readonly requestedPreset: string
    readonly existingPreset?: string
  }
  'agent-preset-not-found': { readonly agentPreset: string; readonly available: readonly string[] }
  'agent-preset-invalid': { readonly agentPreset: string; readonly reason: string }
  'agent-busy': { readonly reason: string }
  'attachment-error': { readonly reason: string }
  'queue-item-not-found': { readonly itemId: MessageId }
  'steer-unavailable': { readonly itemId: MessageId }
  'title-invalid': { readonly sessionId: SessionId }
  'fork-unavailable': { readonly sessionId: SessionId }
  'subagent-not-found': {
    readonly parentSessionId: SessionId
    readonly childSessionId: SessionId
  }
  'subagent-catalog-diagnostic': {
    readonly parentSessionId: SessionId
    readonly childSessionId: SessionId
    readonly reason: 'corrupt' | 'unsupported' | 'unavailable'
  }
  'subagent-unauthorized': { readonly childSessionId: SessionId }
  internal: Record<never, never>
}

/** Session business failure returned without throwing a carrier error. */
export type SessionError = {
  [Code in keyof SessionErrorDetailsMap]: {
    readonly code: Code
    readonly message: string
    readonly details: SessionErrorDetailsMap[Code]
  }
}[keyof SessionErrorDetailsMap]

/** Session-addressed request for the human-invocable skill catalog. */
export interface SkillListRequest {
  readonly sessionId: SessionId
}

/** One skill available to the Session's human-facing composer. */
export interface SkillEntry {
  /** Kebab-case identifier referenced as `/name`. */
  readonly name: string
  /** Short routing description. */
  readonly description: string
  /** Optional extra routing guidance. */
  readonly whenToUse?: string
  /** Whether the same skill is also advertised to the model. */
  readonly modelInvocable: boolean
}

/** Human-invocable skills visible through one Session's composition. */
export interface SkillListValue {
  readonly skills: readonly SkillEntry[]
}

/** Session list request. */
export interface SessionListRequest {
  readonly cursor?: string
}

/** Session list response value. */
export interface SessionListValue {
  readonly items: readonly SessionSummary[]
}

/** Session search request. */
export interface SessionSearchRequest {
  readonly query: string
}

/** Session search response value. */
export interface SessionSearchValue {
  readonly items: readonly SessionSearchItem[]
  readonly hasMore: boolean
}

/** Session creation or explicit-id adoption request. */
export interface SessionCreateRequest {
  readonly workspaceId?: WorkspaceId
  readonly cwd?: string
  readonly sessionId?: SessionId
  readonly agentPreset?: string
}

/** Session creation response value. */
export interface SessionCreateValue {
  readonly sessionId: SessionId
  readonly agentPreset?: string
}

/** Session model-selection request. */
export interface SessionSelectModelRequest extends ModelSelection {
  readonly sessionId: SessionId
}

/** Accepted model selection after Host resolution. */
export interface SessionSelectModelValue {
  readonly selected: ModelSelection
}

/** Session rename request. */
export interface SessionRenameRequest {
  readonly sessionId: SessionId
  readonly title: string
}

/** Normalized title and the durable event position that committed it. */
export interface SessionRenameValue {
  readonly title: string
  readonly seq: number
}

/** Session fork request. */
export interface SessionForkRequest {
  readonly sessionId: SessionId
  readonly atSeq?: number
}

/** Identity of a newly forked Session. */
export interface SessionForkValue {
  readonly sessionId: SessionId
}

/** Session prompt request. */
export interface SessionPromptRequest {
  /** Client-minted identity persisted on the exact accepted user message. */
  readonly requestId: SessionRequestId
  readonly sessionId: SessionId
  readonly mode: 'queue' | 'steer'
  readonly content: readonly PromptContentPart[]
  readonly clientTimeZone?: string
}

/** Receipt after one prompt enters the target Agent inbox. */
export interface SessionPromptValue {
  readonly accepted: true
}

/** Durable image read request. */
export interface SessionAttachmentRequest {
  readonly sessionId: SessionId
  readonly attachmentId: AttachmentIdType
}

/** Durable image read response value. */
export interface SessionAttachmentValue {
  readonly attachment: ImageAttachmentRef
  readonly data: string
}

/** Pending queue mutation request. */
export interface SessionUpdateQueueRequest {
  readonly sessionId: SessionId
  readonly itemId: MessageId
  readonly action: QueueAction
}

/** Receipt after one pending queue mutation commits. */
export interface SessionUpdateQueueValue {
  readonly accepted: true
}

/** Active-turn cancellation request. */
export interface SessionCancelRequest {
  readonly sessionId: SessionId
}

/** Receipt after cancellation is admitted to the live Agent. */
export interface SessionCancelValue {
  readonly accepted: true
}

/** Request to open one path prepared by a Session-aware caller on the Host desktop. */
export interface SessionOpenWorkspacePathRequest {
  /** Path after best-effort Session workspace resolution, in Host filesystem syntax. */
  readonly path: string
}

/** Confirmation that the Host handed a workspace path to its native opener. */
export interface SessionOpenWorkspacePathValue {
  readonly opened: true
}

/** Client-minted prompt identity used to reconcile optimistic and durable messages. */
export type SessionRequestId = Branded<'session-request-id'>

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /** Browser prompt correlation and optional Host-validated time zone. */
    'user-rpc': { kind: 'user'; rpcId: SessionRequestId; clientTimeZone?: string }
  }
}

/** Durable identity selecting an ordinary Session or one direct subagent child. */
export type SessionAddress =
  | { readonly kind: 'session'; readonly sessionId: SessionId }
  | {
    readonly kind: 'subagent'
    readonly parentSessionId: SessionId
    readonly childSessionId: SessionId
    readonly mode: 'one-shot' | 'continuable'
  }

/** One raw Session event in the Remote journal. */
export interface SessionEventEntry {
  readonly type: 'event'
  readonly event: SessionWireEvent
}

/** Event-shaped wire representation of one packed chunk row. */
export type ChunkRowEvent = {
  [Kind in ChunkRow['type']]: {
    readonly type: `chunkrow/${Kind}`
    readonly seq: number
    readonly time: number
    readonly data: Extract<ChunkRow, { readonly type: Kind }>['data']
  }
}[ChunkRow['type']]

/** One lossless run of consecutive Assistant delta events in a history page. */
export interface SessionChunkRun {
  readonly type: 'chunks'
  readonly event: ChunkRowEvent
}

/** One history-page record: a raw event or a packed Assistant delta run. */
export type SessionHistoryRecord = SessionEventEntry | SessionChunkRun

/** Session event wire form; durable readers own recognition of merge-extensible event names. */
export interface SessionWireEvent {
  readonly type: string
  readonly seq: number
  readonly time: number
  readonly data: JsonValue
  readonly sourceEventSeqs?: number[]
  readonly surfaceOp?: SurfaceOp
}

/** One message-aligned backwards-history request. */
export interface SessionPageRequest {
  readonly address: SessionAddress
  /** Inclusive log cut obtained from the corresponding follow opening frame. */
  readonly throughSeq: number
  readonly beforeSeq?: number
  readonly maxMessages?: number
}

/** One live event request for a durable Session address. */
export interface SessionFollowRequest {
  readonly address: SessionAddress
  readonly maxMessages?: number
}

/** One contiguous backwards page of a Session log. */
export interface SessionPage {
  readonly records: readonly SessionHistoryRecord[]
  readonly hasMore: boolean
}

/** Complete opening window followed by ordered events appended after its cursor. */
export type SessionFollowFrame =
  | {
    readonly type: 'snapshot'
    readonly header: SessionHeader
    readonly cursor: number
    readonly records: readonly SessionHistoryRecord[]
    readonly hasMore: boolean
    readonly projections: SessionProjectionBaseline
  }
  | SessionEventEntry

/** One pending inbox occurrence in the authoritative queue snapshot. */
export interface SessionQueuedItem {
  readonly id: MessageId
  readonly placement: 'queued' | 'steering' | 'context'
  /** Prompt-RPC identity from the queued message's user source; clients retire the matching local submission echo on it. */
  readonly rpcId?: SessionRequestId
  /** JSON-safe message fields consumed by pending-queue presentation. */
  readonly message: {
    readonly id: MessageId
    readonly content: readonly JsonValue[]
  }
}

/** Browser-safe background-job row. */
export interface SessionJob {
  readonly id: JobId
  readonly kind: string
  readonly label: string
  readonly status: 'running' | 'stopping' | 'completed' | 'killed' | 'failed'
  readonly detail?: string
  readonly startedAt: number
  readonly finishedAt?: number
}

/** Complete live control baseline emitted once per control stream generation. */
export interface SessionControlBaseline {
  readonly queues: Readonly<Record<SessionId, readonly SessionQueuedItem[]>>
  readonly jobs: Readonly<Record<SessionId, readonly SessionJob[]>>
  readonly projections: Readonly<Record<SessionId, SessionProjectionBaseline>>
}

/** One finished projection value and its durable watermark. */
export interface SessionProjectionUpdate {
  readonly sessionId: SessionId
  readonly key: string
  readonly value: JsonValue
  readonly seq: number
}

/** Host-wide live state stream. Each generation starts with exactly one baseline. */
export type SessionControlFrame =
  | { readonly type: 'baseline'; readonly value: SessionControlBaseline }
  | { readonly type: 'queue'; readonly sessionId: SessionId; readonly items: readonly SessionQueuedItem[] }
  | { readonly type: 'jobs'; readonly sessionId: SessionId; readonly jobs: readonly SessionJob[] }
  | ({ readonly type: 'projection' } & SessionProjectionUpdate)

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * A Session became visible to Session list consumers.
     * @mode emit
     * @param summary - initial list row for the Session.
     * @remarks 中文说明：功能说明：处理 'api-session/added' 相关流程；使用场景由所在模块及调用位置决定。；
     * 参数说明：summary（SessionSummary）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
     * 'api-session/added'(summary)，并按返回类型处理结果。
     */
    'api-session/added'(summary: SessionSummary): void
    /**
     * A Session left the live Host registry.
     * @mode emit
     * @param sessionId - removed Session identity.
     * @remarks 中文说明：功能说明：处理 'api-session/removed' 相关流程；使用场景由所在模块及调用位置决定。；
     * 参数说明：sessionId（SessionId）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
     * 'api-session/removed'(sessionId)，并按返回类型处理结果。
     */
    'api-session/removed'(sessionId: SessionId): void
    /**
     * One Agent changed running state.
     * @mode emit
     * @param sessionId - Agent and Session identity.
     * @param running - whether the Agent is running.
     * @remarks 中文说明：功能说明：处理 'api-session/status' 相关流程；使用场景由所在模块及调用位置决定。；
     * 参数说明：sessionId（SessionId）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
     * 参数说明：running（boolean）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；调用方应按声明类型处理，
     * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 'api-session/status'(sessionId,
     * running)，并按返回类型处理结果。
     */
    'api-session/status'(sessionId: SessionId, running: boolean): void
    /**
     * One user-authored durable message advanced Session list activity.
     * @mode emit
     * @param sessionId - addressed Session identity.
     * @param updatedAt - durable message time used for list ordering.
     * @remarks 中文说明：功能说明：处理 'api-session/activity' 相关流程；使用场景由所在模块及调用位置决定。；
     * 参数说明：sessionId（SessionId）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
     * 参数说明：updatedAt（number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
     * 'api-session/activity'(sessionId, updatedAt)，并按返回类型处理结果。
     */
    'api-session/activity'(sessionId: SessionId, updatedAt: number): void
    /**
     * One Agent failed outside a durable turn position.
     * @mode emit
     * @param sessionId - Agent and Session identity.
     * @param message - user-safe failure chain.
     * @remarks 中文说明：功能说明：处理 'api-session/error' 相关流程；使用场景由所在模块及调用位置决定。；
     * 参数说明：sessionId（SessionId）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
     * 参数说明：message（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；调用方应按声明类型处理，
     * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 'api-session/error'(sessionId,
     * message)，并按返回类型处理结果。
     */
    'api-session/error'(sessionId: SessionId, message: string): void
  }
}

/** JSON-compatible projection value accepted by list consumers. */
export type SessionProjectionValue = JsonValue
