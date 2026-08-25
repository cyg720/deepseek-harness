/*
 * ================================ 文件注释 ================================
 * 【文件职责】apiproxy 契约层的桶文件（barrel）：汇总各域名接口（sessions、
 * host、workspace、agentPresets、skills、subagents、events、goals、settings、
 * credentials、llm、downloads）与消息层类型，统一对外导出。
 * 【技术维度】纯类型/值重导出，零 Node 依赖、浏览器可直接导入；TS 接口是权威
 * 契约，HTTP/WebSocket/进程内 SSE 仅是物理通道（四象限消息模型）；ApiProxy
 * 根接口在此组装各域。
 * 【产品维度】远程客户端只需 import 本文件即可获得完整类型契约与运行时 schema
 * 工具，无需关心具体载体。
 * 【逻辑维度】ApiProxy 根接口 → 域名接口与载荷实体重导出 → 窄形式消息类型 →
 * 四象限完整形式 → 错误与 id → 会话搜索产品边界 → 方法注册表（rpc-map）。
 * 【关键边界】downloads 域是宿主专用（GET、无信封、不出现在 IApiClient）；
 * 新增客户端请求域 = 一个新文件对 + 根接口一个字段 + rpc-map 一行。
 * 【新手阅读建议】先读 ApiProxy 根接口把握全貌，再按域读各域名文件，最后看
 * rpc-map 理解方法注册表与派生泛型。
 * ==========================================================================
 */
/**
 * apiproxy contract-layer barrel. api/ has zero Node dependencies and is
 * importable from the browser; the TS interfaces are the authoritative contract, while HTTP,
 * WebSocket, and in-process SSE are merely physical channels (four-quadrant message model).
 */

import type { SessionsApi } from './sessions.ts'
import type { HostApi } from './host.ts'
import type { WorkspaceApi } from './workspace.ts'
import type { AgentPresetsApi } from './agent-presets.ts'
import type { SkillsApi } from './skills.ts'
import type { SubagentsApi } from './subagents.ts'
import type { EventsApi } from './events.ts'
import type { GoalsApi } from './goals.ts'
import type { SettingsApi } from './settings.ts'
import type { CredentialsApi } from './credentials.ts'
import type { LlmApi } from './llm.ts'
import type { DownloadsApi } from './downloads.ts'
import type { ClientResponse, RpcReceipt } from './rpc.ts'

/** Root interface of the unified API. New client-request domain = one new file pair + one field here + one map row. */
export interface ApiProxy {
  sessions: SessionsApi
  subagents: SubagentsApi
  host: HostApi
  workspace: WorkspaceApi
  skills: SkillsApi
  agentPresets: AgentPresetsApi
  events: EventsApi
  goals: GoalsApi
  settings: SettingsApi
  credentials: CredentialsApi
  llm: LlmApi
  /** Host-only download surfaces (GET, no wire envelope); absent from IApiClient. */
  downloads: DownloadsApi
  /**
   * Response entry for server requests; not a domain method.
   * @param message - Client response carrying the server request's rpcId.
   * @returns Transport receipt for the response delivery.
   */
  respond(message: ClientResponse): Promise<RpcReceipt>
}

// ---- Domain interfaces and payload entities ----
export type {
  HistoryEntry, ModelCatalogFailure, ModelCatalogModel, ModelProviderGroup, ModelReasoning,
  ModelReasoningEffort, ModelSelection, PromptContentPart, QueueAction, SessionModels,
  SessionListMetadata, SessionProjectionsBlock, SessionSearchItem, SessionsApi, SessionSummary,
} from './sessions.ts'
export type { DirectoryEntry, DirectoryListing, HostApi } from './host.ts'
export type {
  SubagentAddress, SubagentCatalog, SubagentInterruptReceipt, SubagentListEntry,
  SubagentPromptReceipt, SubagentsApi,
} from './subagents.ts'
export type { JobView } from './jobs.ts'
export type { WorkspaceApi, WorkspaceId, WorkspaceView } from './workspace.ts'
export type { SkillsApi, SkillEntry } from './skills.ts'
export type { AgentPresetsApi, AgentPresetEntry } from './agent-presets.ts'
export type { EventsApi, MuxFrame, HostFrame, QueuedInboxItem, ToolCallView, ToolEventView, ToolResultView } from './events.ts'
export type { GoalsApi, GoalId, GoalRef } from './goals.ts'
export type { SettingsApi, SettingsNamespaceView, SettingsPathOpView, SettingsSecretView } from './settings.ts'
export type { CredentialsApi, CredentialView } from './credentials.ts'
export type { ConfigurableProviderView, DiscoveredModelView, LlmApi } from './llm.ts'
export type { DownloadsApi } from './downloads.ts'
export type { ApprovalResponsePayload } from './approvals.ts'

export type { QuestionResponsePayload } from './questions.ts'

// ---- Message layer: narrow forms (domain-signature view) ----
export type { RpcRequest, RpcResponse } from './rpc.ts'

// ---- Message layer: the four wire full forms + carrier receipt ----
export type {
  ClientRequest,
  ClientResponse,
  RpcMessage,
  RpcReceipt,
  ServerRequest,
  ServerResponse,
} from './rpc.ts'

// ---- Errors and ids ----
export { RpcId, transportError } from './rpc.ts'
export type { RpcError, RpcErrorCode, RpcErrorDetailsMap, RpcResult } from './rpc.ts'
export {
  clientRequestSchema,
  serverRequestSchema,
  serverResponseSchema,
} from './rpc.schema.ts'

// ---- Fixed session-search product bounds ----
export {
  SESSION_SEARCH_RESULT_LIMIT,
  SESSION_SEARCH_SNIPPET_MAX_CODE_POINTS,
} from './session-search.ts'

// ---- Method registry and derived generics ----
export type { RequestPayload, ResponseValue, RpcMethodMap } from './rpc-map.ts'
