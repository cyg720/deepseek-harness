/*
 * ================================ 文件注释 ================================
 * 【文件职责】llm 域契约：宿主导向的提供者拓扑（供配置界面使用）。
 * llm.providers 合并"可配置提供者目录"（哪些提供者可配置、设置在哪）与实时
 * 路由注册表；llm.models 是与会话无关的模型目录（与 session.models 同组、无
 * 会话选择）；llm.discoverModels 探测草稿端点。
 * 【技术维度】纯类型契约；客户端从转发的 llm/adapters-updated 与
 * settings/document-updated 属主事件失效缓存。
 * 【产品维度】LLM 配置面板：提供者列表（含活动/休眠状态）、模型目录、向仍在
 * 起草的设置界面探测端点模型供用户采纳。
 * 【逻辑维度】ConfigurableProviderView → LlmApi（providers/models/discoverModels）
 * → DiscoveredModelView。
 * 【关键边界】discoverModels 的载荷是草稿而非存储路由：已描述的路线由其注册表
 * 无网络应答，未描述的才走 baseURL/api/apiKey 线上探测；什么都不写，答复只是
 * 候选，由后续 settings.mutate 决定路线；apiKey 绝不存储或返回。
 * 【新手阅读建议】与 llm.schema.ts 及 api-proxy.ts 的 llm 域实现对照阅读。
 * ==========================================================================
 */
/**
 * llm domain contract: host-scoped provider topology for configuration
 * surfaces. `llm.providers` merges the configurable-provider directory
 * (which providers CAN be configured, and where their settings live) with the
 * live route registry; `llm.models` is the session-independent model catalog
 * (the same groups as `session.models`, without a per-session selection).
 * Clients invalidate from the forwarded `llm/adapters-updated` and
 * `settings/document-updated` owner events.
 */

import type { RpcRequest, RpcResponse } from './rpc.ts'
import type { ModelCatalogFailure, ModelProviderGroup } from './sessions.ts'

/** Wire view of one configurable provider. */
// 单个可配置提供者的线上视图。
export interface ConfigurableProviderView {
  /** Provider route key (`deepseek-official`, `openai`, …). */
  // 提供者路由键（deepseek-official / openai 等）。
  provider: string
  /** Human-readable name for configuration surfaces. */
  // 配置界面使用的人类可读名称。
  displayName: string
  /** Settings namespace whose section configures this provider. */
  // 其小节配置该提供者的设置命名空间。
  settingsNs: string
  /** Path from that section's root to the provider's profile object (empty = whole section). */
  // 从该小节根部到提供者档案对象的路径（空 = 整个小节）。
  settingsPath: string[]
  /** Whether the route is currently registered (its models are requestable). */
  // 该路由当前是否已注册（其模型可请求）。
  active: boolean
  /**
   * Whether the owning adapter knows this route only because configuration
   * declared it. Absent when the adapter draws no such distinction, so a
   * surface must treat absence as "unknown", not as "shipped".
   */
  // 适配器是否仅因配置声明而知道该路由；缺失表示"未知"而非"内置"。
  declared?: boolean
}

/** Llm-domain unary methods (the map keys llm.* of RpcMethodMap). */
// LLM 域一元方法接口。
export interface LlmApi {
  /**
   * List every configurable provider with its live/dormant state, in
   * directory declaration order. Routes registered outside the directory
   * (an adapter that never declared configurability) are appended with their
   * registration identity and no settings address.
   */
  providers(request: RpcRequest<{}>): Promise<RpcResponse<{ providers: ConfigurableProviderView[] }>>

  /**
   * Host-scoped model catalog over every registered provider route: the
   * settings surface's models view, needing no session. Per-provider listing
   * failures ride `failures` without failing the sound groups.
   */
  models(request: RpcRequest<{}>): Promise<RpcResponse<{ groups: ModelProviderGroup[]; failures: ModelCatalogFailure[] }>>

  /**
   * Interrogate a provider endpoint the configuration surface is still
   * drafting, and return the models it advertises for the user to adopt.
   *
   * The payload is the draft, not a stored route: `settingsNs` selects the
   * adapter family that answers, and the rest comes from the form. `provider`
   * names the route being edited when there is one — an adapter that already
   * describes that route answers from its own registry, with better metadata
   * and no network call, and needs no endpoint. A route it does not describe is
   * asked over the wire, which is what `baseURL`, `api`, and `apiKey` are for.
   *
   * Nothing is written — the reply is candidates, and only a later
   * `settings.mutate` decides what a route serves. `apiKey` is accepted here
   * but never stored or returned; a provider whose key is already stored omits
   * it and the endpoint answers unauthenticated or refuses.
   */
  discoverModels(
    request: RpcRequest<{
      settingsNs: string
      provider?: string
      baseURL?: string
      api?: string
      apiKey?: string
    }>,
    signal?: AbortSignal,
  ): Promise<RpcResponse<{ models: DiscoveredModelView[] }>>
}

/** Wire view of one model an interrogated endpoint advertises. */
export interface DiscoveredModelView {
  /** Model id the endpoint accepts. */
  id: string
  /** Human-readable name when the endpoint supplies one. */
  name?: string
  /** Maximum combined request and response context, when disclosed. */
  contextWindow?: number
  /** Maximum output tokens, when disclosed. */
  maxTokens?: number
}
