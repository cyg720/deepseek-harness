// Central contract re-export point: every contract import inside
// web-runtime goes through this single file.
// Types and runtime protocol helpers/bounds come from the apiproxy api/ layer
// (zero Node deps, browser-safe); AbstractApiClient is the client boundary.
// NEVER import the package root: it drags bootHost/cordis into the browser bundle.
// The ./api and ./client subpath exports are the browser-safe channels.
/**
 * 文件职责：作为浏览器连接层唯一协议契约入口，集中重导出API、RPC、会话、消息和工具展示类型。
 * 技术维度：仅从浏览器安全子路径进行TypeScript类型与少量运行时重导出，避免Node/Cordis代码进入前端包。
 * 产品维度：让Web运行时通过稳定单一入口调用Host能力，并在编译期共享所有请求、响应和事件类型。
 * 逻辑维度：按业务API、RPC协议、核心会话与LLM类型分组重导出，最后提供一元响应result提取辅助函数。
 * 关键边界：禁止导入apiproxy包根；本文件不实现传输；resultOf只解包result槽而不解释业务错误。
 * 新手阅读建议：先看HostDescription和Rpc类型来源，再看AbstractApiClient边界，最后阅读resultOf的简单解包用途。
 */

export type {
  ApiProxy, SessionsApi, SessionSearchItem, SessionSummary, PromptContentPart, HostApi, EventsApi, MuxFrame, HostFrame,
  ApprovalResponsePayload, QuestionResponsePayload, HistoryEntry, ToolEventView,
  DirectoryEntry, DirectoryListing,
  ResponseValue, WorkspaceApi, WorkspaceId, WorkspaceView,
  SkillsApi, SkillEntry,
  ModelCatalogFailure, ModelCatalogModel, ModelProviderGroup, ModelReasoning,
  ModelReasoningEffort, ModelSelection, QueueAction, QueuedInboxItem, SessionModels,
  GoalsApi, GoalRef,
  SettingsApi, SettingsNamespaceView, SettingsPathOpView, SettingsSecretView,
  CredentialsApi, CredentialView, ConfigurableProviderView, DiscoveredModelView, LlmApi,
  SubagentsApi, SubagentAddress, SubagentCatalog, SubagentListEntry, SubagentPromptReceipt,
  JobView,
} from '@deepseek-ai/dsh-host-apiproxy/api'
export type { ToolCallView, ToolResultView } from '@deepseek-ai/dsh-tools/presentation'
export type {
  RpcRequest, RpcResponse, RpcResult, RpcError, RpcErrorCode,
  ClientRequest, ServerResponse, ServerRequest, ClientResponse, RpcMessage, RpcReceipt,
} from '@deepseek-ai/dsh-host-apiproxy/api'
// transportError lives in the apiproxy api layer (beside RpcResult, its
// subject); re-exported here so connection consumers keep one contract
// entry point.
export {
  RpcId,
  SESSION_SEARCH_RESULT_LIMIT,
  transportError,
} from '@deepseek-ai/dsh-host-apiproxy/api'
export { AbstractApiClient } from '@deepseek-ai/dsh-host-apiproxy/client'
export type { IApiClient } from '@deepseek-ai/dsh-host-apiproxy/client'
export type { SessionId, SessionEvent } from '@deepseek-ai/dsh-session/types'
export type { MessageId } from '@deepseek-ai/dsh-llm/brand'
export type { ContentBlock, StreamChunk } from '@deepseek-ai/dsh-llm/types'

/** Successful value returned by the connection-generation host handshake. */
/* 每个连接代际Host握手成功后返回的描述值类型。 */
export type HostDescription = import('@deepseek-ai/dsh-host-apiproxy/api').ResponseValue<'host.describe'>

import type { RpcResponse, RpcResult } from '@deepseek-ai/dsh-host-apiproxy/api'

/**
 * Unwrap a unary response: RpcResponse<T> -> RpcResult<T> (business code only
 * cares about the result slot).
 * @param response - the unary response.
 * @returns its result slot.
 */
/*
 * 从一元RPC响应中取出业务层只关心的result槽。
 * @param response 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
 */
export function resultOf<T>(response: RpcResponse<T>): RpcResult<T> {
  return response.result
}
