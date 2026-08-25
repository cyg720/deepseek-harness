/*
 * ================================ 文件注释 ================================
 * 【文件职责】定义"provider 中立"的消息与流式词汇：会话循环、会话日志、插件
 * 共同使用的核心类型——内容块（ContentBlock）、结束原因（FinishReason）、
 * token 用量（TokenUsage）、流块（StreamChunk）与完整请求（GenerateOptions）。
 * 【技术维度】适配器是唯一负责翻译 provider 线格式的一层；这里的"映射接口"
 * （ContentBlockMap、FinishReasonMap、MessageSourceMap 等）通过 TypeScript
 * 声明合并（declaration merging）让插件可以扩展联合类型；按 type/kind 判别
 * 分支、未知项显式放行。
 * 【产品维度】这些类型是 harness 与所有 LLM provider 交互的公共"词汇表"：
 * 无论是消息展示、token 计量还是错误路由，都基于同一套类型，避免各层各自
 * 发明方言。
 * 【逻辑维度】注册表事件声明 → 消息类型再导出 → 失败事实 → 内容块族 →
 * 结束原因族 → token 用量 → provider/模型目录与发现 → 回放包络 → 流协议
 * → 工具 schema → 完整请求。
 * 【关键边界】TokenUsage 计数互斥（inputTokens 不含缓存读/写）；目录成员资格
 * 只是建议性（advisory），不影响请求路由与校验；适配器必须遵守 StreamChunk
 * 的协议约束（usage 在 finish 之前、工具参数保持原始 JSON 字符串）。
 * 【新手阅读建议】建议顺序：GenerateOptions → StreamChunk → ContentBlock →
 * TokenUsage → FinishReason，先建立"一次请求长什么样"的整体印象。
 * ==========================================================================
 */

/**
 * Canonical provider-neutral message and streaming vocabulary for the loop,
 * session log, and plugins. Adapters alone translate provider wire messages;
 * mapped interfaces make the content, source, and finish unions extensible.
 */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { CallId, ProviderRequestId, ReasoningEffortId } from './brand.ts'
import type { Message } from './message.ts'

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * The provider topology changed: an adapter registered or unregistered
     * routes, or the configurable-provider directory gained or lost entries.
     * This payload-free registry notification fires at each commit point
     * (including registration disposal); consumers re-read `listProviders()`,
     * `listModels()`, or `listConfigurableProviders()` for the new state.
     * Observer failures are contained and cannot veto the registry mutation.
     * @mode emit
     */
    // 中文：provider 拓扑变化事件：适配器注册/注销路由，或可配置 provider
    // 目录增删条目时触发（含注册销毁时刻）。负载为空，消费方自行重读
    // listProviders()/listModels()/listConfigurableProviders() 获取新状态；
    // 观察者失败被隔离，不能否决注册表变更。
    'llm/adapters-updated'(): void
  }
}

export type {
  AssistantMessage,
  AssistantProvenance,
  Message,
  MessageSource,
  MessageSourceMap,
  ModelMessageSource,
  ToolMessageSource,
  ToolResultMessage,
  UserMessage,
} from './message.ts'

/** Serializable provider or transport failure facts; policy decides whether they are retryable. */
/*
 * （中文）可序列化的 provider/传输失败事实；重试策略据此决定失败是否可重试。
 */
export interface LlmFailure {
  /** Human-readable provider or transport failure. */
  // 中文：人类可读的 provider/传输失败描述。
  readonly message: string
  /** Stable provider-neutral machine-routing code. */
  // 中文：稳定的、provider 无关的机器路由码。
  readonly code: string
  /** HTTP status returned by the provider, when available. */
  // 中文：provider 返回的 HTTP 状态码（有则提供）。
  readonly status?: number
  /** Provider-requested delay in milliseconds, when valid and available. */
  // 中文：provider 请求的延迟毫秒数（有效且可用时提供）。
  readonly providerRetryAfterMs?: number
  /** Opaque provider-issued request identifier for diagnostics. */
  // 中文：provider 颁发的请求标识（不透明字符串，供诊断用）。
  readonly requestId?: ProviderRequestId
}

/** Plain text visible to the end user. */
// 中文：用户可见的纯文本块。
export interface TextBlock {
  type: 'text'
  text: string
}

/** Reasoning / thinking content, distinct from visible text. */
// 中文：推理/思考内容块，区别于可见文本。
export interface ReasoningBlock {
  type: 'reasoning'
  text: string
}

/*
 * （中文）持久的栅格图像引用，可用于用户或助手内容。该块刻意保持角色中立；
 * 助手侧渲染是向前兼容——当前生产适配器声明只输出文本，因此今天只有用户
 * 内容携带图片。
 */
/**
 * A durable raster image reference, valid in user or assistant content. The
 * block is deliberately role-neutral; assistant-side rendering is forward
 * compatibility — the current production adapters declare text-only output,
 * so only user content carries images today.
 */
export interface ImageBlock {
  type: 'image'
  /** Immutable bytes and intrinsic display metadata owned by the attachment service. */
  // 中文：由附件服务持有的不可变字节与固有显示元数据。
  attachment: ImageAttachmentRef
}

/** A tool invocation requested by the model. */
// 中文：模型发起的工具调用请求块。
export interface ToolCallBlock {
  type: 'tool-call'
  /** Provider-issued call id; correlates with the matching tool result. */
  // 中文：provider 颁发的调用 id，与对应的工具结果相关联。
  id: CallId
  name: string
  /** Raw JSON string as produced by the model. */
  // 中文：模型产出的原始 JSON 参数字符串。
  arguments: string
}

/** The result of a tool invocation, sent back to the model. */
// 中文：工具调用的结果块，回传给模型。
export interface ToolResultBlock {
  type: 'tool-result'
  toolCallId: CallId
  content: ContentBlock[]
  isError?: boolean
}

/*
 * （中文）按 type 键可合并扩展的内容块映射。新增核心块必须同时具备适配器、
 * UI 与压缩（compaction）支持。
 */
/**
 * Merge-extensible content blocks keyed by `type`. New core blocks must land
 * with adapter, UI, and compaction support.
 */
export interface ContentBlockMap {
  'text': TextBlock
  'reasoning': ReasoningBlock
  'image': ImageBlock
  'tool-call': ToolCallBlock
  'tool-result': ToolResultBlock
}

/** The block `type` tag vocabulary; widens as plugins add entries to {@link ContentBlockMap}. */
// 中文：块 type 标签词汇表；随插件向 ContentBlockMap 增加条目而变宽。
export type ContentBlockType = keyof ContentBlockMap
/** Any known content block, derived from {@link ContentBlockMap}; switch on `type` and fall through unknowns (merge-extensible). */
// 中文：任意已知内容块；按 type 分支处理，未知项显式放行（可合并扩展）。
export type ContentBlock = ContentBlockMap[ContentBlockType]

/*
 * （中文）模型响应停止的原因。可合并扩展，允许适配器暴露 provider 专属原因。
 */
/**
 * Why a model response stopped.
 * Merge-extensible so adapters can surface provider-specific reasons.
 */
export interface FinishReasonMap {
  'stop': { kind: 'stop' }
  'tool-calls': { kind: 'tool-calls' }
  'max-tokens': { kind: 'max-tokens' }
  'aborted': { kind: 'aborted'; failure: LlmFailure }
  'error': { kind: 'error'; failure: LlmFailure }
}

/** Any known finish reason, derived from {@link FinishReasonMap}; switch on `kind` and fall through unknowns (merge-extensible). */
// 中文：任意已知结束原因；按 kind 分支处理，未知项显式放行（可合并扩展）。
export type FinishReason = FinishReasonMap[keyof FinishReasonMap]

/**
 * Token accounting for one model call (cache fields are optional).
 *
 * Counts are DISJOINT: `inputTokens` is uncached input only; cached input is
 * reported separately as `cacheReadTokens`/`cacheWriteTokens` (billed input =
 * sum of the three). Adapters whose providers fold cache hits into a total
 * prompt count (DeepSeek's `prompt_tokens`) subtract them out.
 */
/*
 * （中文）一次模型调用的 token 计量（缓存字段可选）。
 * 计数是互斥的：inputTokens 只含未命中缓存的输入；缓存命中输入单列为
 * cacheReadTokens/cacheWriteTokens（计费输入 = 三者之和）。provider 若把
 * 缓存命中并入总提示数（如 DeepSeek 的 prompt_tokens），适配器需将其扣除。
 */
export interface TokenUsage {
  // 中文：未命中缓存的输入 token 数。
  inputTokens: number
  // 中文：输出 token 数。
  outputTokens: number
  // 中文：读取缓存命中的 token 数（可选）。
  cacheReadTokens?: number
  // 中文：写入缓存的 token 数（可选）。
  cacheWriteTokens?: number
  // 中文：推理（reasoning）token 数（可选）。
  reasoningTokens?: number
}

/** Display metadata for one registered provider route. */
/*
 * （中文）单个已注册 provider 路由的展示元数据。
 */
export interface LlmProviderInfo {
  /** Provider route key used by {@link GenerateOptions.provider}. */
  // 中文：GenerateOptions.provider 使用的路由键。
  id: string
  /** Human-readable provider name for selectors and diagnostics. */
  // 中文：供选择器与诊断使用的人类可读 provider 名。
  name: string
}

/** Merge-extensible provider model modality vocabulary. */
// 中文：可合并扩展的 provider 模型模态（modality，即输入输出内容形态）词汇表。
export interface ModelModalityMap {
  text: 'text'
  image: 'image'
}

/** Any declared provider model modality. */
// 中文：任意已声明的 provider 模型模态。
export type ModelModality = ModelModalityMap[keyof ModelModalityMap]

/*
 * （中文）适配器插件可通过配置激活的 provider 路由（无论当前是否已注册）。
 * 配置界面把该目录与 listProviders() 合并，从而同时呈现每个可配置 provider
 * 的"在线/休眠"状态。
 */
/**
 * One provider route an adapter plugin can activate through configuration,
 * whether or not the route is currently registered. Configuration surfaces
 * merge this directory with `listProviders()` to offer every configurable
 * provider alongside its live/dormant state.
 */
export interface LlmConfigurableProvider {
  /** Provider route key this entry activates when configured. */
  // 中文：该条目被配置后激活的 provider 路由键。
  provider: string
  /** Human-readable provider name for configuration surfaces. */
  // 中文：供配置界面显示的人类可读 provider 名。
  displayName: string
  /** User-settings namespace whose section configures this provider. */
  // 中文：负责配置该 provider 的用户设置命名空间。
  settingsNs: string
  /**
   * Path from that namespace's section root to this provider's profile
   * object; empty when the whole section is the profile.
   */
  // 中文：从该命名空间段根到本 provider 配置文件对象的路径；段整体即配置
  // 文件对象时为空数组。
  settingsPath: readonly string[]
  /**
   * Whether the owning adapter knows this route only because configuration
   * declared it — a gateway or self-hosted server it ships nothing about.
   * Absent means the adapter draws no such distinction; false means it does
   * and this route is one of its own. Only the adapter can answer: a stored
   * profile is how a user-added route AND a corrected shipped one both look
   * from outside.
   */
  // 中文：所属适配器是否只知道这条路由是因为配置声明了它（网关或自托管服务，
  // 适配器本身一无所知）。缺省表示适配器不做此区分；false 表示区分且该路由
  // 是它自己的。只有适配器能回答：从外部看，用户添加的路由与被修正的出厂
  // 路由看起来都一样（都是已存配置）。
  declared?: boolean
}

/*
 * （中文）对"配置尚未存储"的 provider 端点的一次探询。配置界面发送用户仍在
 * 编辑的草稿，因此请求直接携带端点与凭据而非命名路由：一个正在被添加的
 * provider 还没有可命名的路由。
 */
/**
 * One interrogation of a provider endpoint that configuration has not stored
 * yet. Configuration surfaces send the draft a user is still editing, so the
 * request carries the endpoint and credential directly instead of naming a
 * route: a provider being added has no route to name.
 */
export interface LlmModelDiscoveryRequest {
  /**
   * Route the draft is editing, when it edits an existing one. A route whose
   * adapter already knows its models answers from that knowledge instead of
   * asking the endpoint — the adapter's own registry is the better answer, and
   * it costs no network call.
   */
  // 中文：草稿正在编辑的路由（当它编辑既有路由时）。该路由的适配器若已知其
  // 模型，则直接据此回答而不询问端点——适配器自己的注册表是更好的答案，
  // 且不消耗网络调用。
  provider?: string
  /**
   * Endpoint to interrogate. Optional because a route the adapter already
   * describes needs none; a route it does not must supply one.
   */
  // 中文：要探询的端点。可选：适配器已描述的路由无需端点；适配器不认识的
  // 路由必须提供。
  baseURL?: string
  /** Wire protocol the endpoint speaks, when the draft names one. */
  // 中文：端点使用的线上协议（草稿指明时）。
  api?: string
  /** Credential for this interrogation alone; the harness never stores it. */
  // 中文：仅用于本次探询的凭据；harness 绝不存储它。
  apiKey?: string
  /** Caller cancellation; implementations must settle promptly after it aborts. */
  // 中文：调用方取消信号；实现必须在其 abort 后迅速收敛。
  signal?: AbortSignal
}

/*
 * （中文）端点自述的某个模型。除 id 外每个字段都可选——大多数 provider 的
 * 列表只披露 id 而无其他；采用这些模型之一的界面仍需补足其适配器所需的能力。
 */
/**
 * One model an endpoint reports about itself. Every field but the id is
 * optional because most provider listings disclose an id and nothing else;
 * a surface adopting one of these still owes the capacities its adapter needs.
 */
export interface LlmDiscoveredModel {
  /** Model id the endpoint accepts. */
  // 中文：端点接受的模型 id。
  id: string
  /** Human-readable name when the endpoint supplies one. */
  // 中文：端点提供时的人类可读名称。
  name?: string
  /** Maximum combined request and response context, when disclosed. */
  // 中文：披露时的请求+响应合并上下文上限。
  contextWindow?: number
  /** Maximum output tokens, when disclosed. */
  // 中文：披露时的最大输出 token 数。
  maxTokens?: number
}

/** One adapter-discovered model; catalog membership is advisory, not request validation. */
/*
 * （中文）适配器发现的单个模型；目录成员资格只是建议性，不是请求校验。
 */
export interface LlmModelInfo {
  /** Provider route that owns this model entry. */
  // 中文：拥有该模型条目的 provider 路由。
  provider: string
  /** Model id passed to {@link GenerateOptions.model}. */
  // 中文：传给 GenerateOptions.model 的模型 id。
  id: string
  /** Human-readable model name for selectors. */
  // 中文：供选择器使用的人类可读模型名。
  name: string
  /** Optional user-facing distinction from otherwise similar models. */
  // 中文：可选的、面向用户的区分说明（用于区分相似模型）。
  description?: string
  /** Accepted request modalities; absent means unknown, while an explicit omission is negative capability. */
  // 中文：接受的请求模态；缺省表示未知，而显式省略表示"负能力"（明确不支持）。
  inputModalities?: readonly ModelModality[]
}

/** Provider-owned context capacity for one exact provider/model route. */
// 中文：某条精确 provider/model 路由的 provider 自有上下文容量。
export interface LlmModelContext {
  /** Maximum combined request and response context in tokens. */
  // 中文：请求+响应合并上下文上限（token 数）。
  contextWindow: number
}

/** Display metadata for one adapter-owned reasoning effort. */
/*
 * （中文）单个适配器自有的推理强度（reasoning effort）的展示元数据。
 */
export interface LlmReasoningEffortInfo {
  /** Opaque stable value accepted by {@link GenerateOptions.reasoningEffort}. */
  // 中文：GenerateOptions.reasoningEffort 接受的不透明稳定值。
  id: ReasoningEffortId
  /** Human-readable effort name for selectors and diagnostics. */
  // 中文：供选择器与诊断使用的人类可读强度名。
  name: string
  /** Optional user-facing distinction from otherwise similar efforts. */
  // 中文：可选的、面向用户的区分说明。
  description?: string
}

/** Selectable reasoning efforts for one exact provider/model route. */
/*
 * （中文）某条精确 provider/model 路由可选的推理强度。
 */
export interface LlmModelReasoningInfo {
  /** Supported efforts in adapter-preferred display order. */
  // 中文：支持的强度，按适配器偏好的展示顺序。
  efforts: readonly LlmReasoningEffortInfo[]
  /**
   * Adapter-configured default materialized into requests when callers omit
   * an effort. Absence preserves the provider's own default.
   */
  // 中文：调用方省略强度时，物化进请求的适配器配置默认值；缺省则保留
  // provider 自己的默认。
  defaultEffort?: ReasoningEffortId
}

/** Exact-route model metadata resolved by its owning adapter. */
/*
 * （中文）由所属适配器解析出的精确路由模型元数据。
 */
export interface LlmResolvedModelInfo extends LlmModelInfo {
  /** Provider-owned context capacity when known. */
  // 中文：已知时的 provider 自有上下文容量。
  context?: LlmModelContext
  /** Adapter-configured per-request output cap materialized when callers omit one. */
  // 中文：调用方省略时物化进请求的适配器配置输出上限。
  defaultMaxTokens?: number
  /** Adapter-owned selectable reasoning levels when exposed. */
  // 中文：暴露时的适配器自有可选推理级别。
  reasoning?: LlmModelReasoningInfo
}

/**
 * Adapter-private lossless-JSON state for replaying a successful response,
 * carried by a terminal `finish` chunk and stored on the assembled assistant
 * message's model source. Both halves stay opaque to the harness; only the
 * split is shared vocabulary, so assembly can keep stored metadata aligned
 * with stored content without reading either half.
 */
/*
 * （中文）回放成功响应所需的适配器私有无损 JSON 状态：由终结性 finish 块携带，
 * 存在组装后的助手消息的模型来源上。两半内容对 harness 保持不透明；共享的
 * 只是"拆分"这个约定，因此组装器可以在不读取任何一半的情况下保持存储元数据
 * 与存储内容对齐。
 */
export interface ReplayEnvelope {
  /** Response-level adapter-private metadata (ids, native stop reason). */
  // 中文：响应级的适配器私有元数据（id、原生停止原因等）。
  response: unknown
  /**
   * Per-block adapter-private metadata, one entry per emitted block in
   * first-seen stream order. When assembly drops a block it drops the entry at
   * the same position; entries whose length does not match the emitted block
   * count discard the whole envelope. An adapter whose metadata is independent
   * of block structure omits this field and the envelope passes through
   * assembly unchanged.
   */
  // 中文：逐块适配器私有元数据，按"首次出现"的流顺序每块一条。组装器丢弃某
  // 块时同步丢弃同位置的条目；条目数与发出块数不匹配则整体丢弃该包络。元数据
  // 与块结构无关的适配器省略此字段，包络原样穿过组装。
  blocks?: readonly unknown[]
}

/*
 * （中文）适配器发出的原始流协议。
 * 块索引用于关联交错的 delta；block-end 携带组装好的块。适配器在终结 finish
 * 前发出 usage，之后不再发任何东西；工具参数保持原始 JSON 字符串。适配器实现
 * 可以抛错，但 LlmRuntime.stream() 会先把该失败规范化为终结性的 error 或
 * aborted finish 再暴露给消费方。
 */
/**
 * Raw streaming protocol emitted by adapters.
 * Block indexes correlate interleaved deltas, and `block-end` carries the
 * assembled block. Adapters emit usage before the terminal finish and nothing
 * afterward; tool arguments remain raw JSON strings. An adapter implementation
 * may throw, but `LlmRuntime.stream()` normalizes that failure to a terminal
 * `error` or `aborted` finish before exposing it to consumers.
 */
export type StreamChunk =
  | { type: 'block-start'; index: number; blockType: ContentBlockType }
  | { type: 'text-delta'; index: number; text: string }
  | { type: 'reasoning-delta'; index: number; text: string }
  | { type: 'tool-call-delta'; index: number; id: CallId; name?: string; argumentsDelta: string }
  | { type: 'block-end'; index: number; block: ContentBlock }
  | { type: 'usage'; usage: TokenUsage }
  | {
    type: 'finish'
    reason: FinishReason
    /** Replay metadata for a successful response; see {@link ReplayEnvelope}. */
    // 中文：成功响应的回放元数据；见 ReplayEnvelope。
    replayState?: ReplayEnvelope
  }

/*
 * （中文）发送给模型的工具 JSON-schema 描述。
 * 声明在这里（而非 dsh-tools）是因为它是 GenerateOptions 的一部分；dsh-tools
 * 的 ToolDefinition 与 dsh-system-prompt 的 PromptAssembly 都从本包导入它。
 */
/**
 * JSON-schema description of a tool, as sent to the model.
 *
 * Declared here (not in dsh-tools) because it is part of {@link GenerateOptions};
 * dsh-tools' ToolDefinition and dsh-system-prompt's PromptAssembly both import
 * it from this package.
 */
export interface ToolSchema {
  // 中文：工具名。
  name: string
  // 中文：工具描述。
  description: string
  /** JSON Schema object for the arguments. */
  // 中文：参数用的 JSON Schema 对象。
  parameters: Record<string, unknown>
}

/** A single model request, fully assembled. */
/*
 * （中文）一次完整组装好的模型请求。
 */
export interface GenerateOptions {
  /** Registered provider route selecting the adapter instance. */
  // 中文：选择适配器实例的已注册 provider 路由。
  provider: string
  // 中文：模型 id。
  model: string
  /** Adapter-owned reasoning effort selected for this exact model. */
  // 中文：为该精确模型选择的适配器自有推理强度。
  reasoningEffort?: ReasoningEffortId
  /**
   * Ordered conversation messages, exactly as the provider sees them (after
   * the `system` slot). A loop-built request assembles them as
   * the derived history (dsh-agent-loop); a hand-built one-shot passes any list.
   */
  // 中文：有序对话消息，与 provider 所见完全一致（system 槽之后的部分）。
  // loop 构建的请求把它们组装为派生历史（dsh-agent-loop）；手工构建的单次
  // 请求可传任意列表。
  messages: Message[]
  /** System prompt text (adapters map to the provider's system slot). */
  // 中文：系统提示词文本（适配器映射到 provider 的 system 槽）。
  system?: string
  /** Tool schemas (adapters map to the provider's `tools` field). */
  // 中文：工具 schema 列表（适配器映射到 provider 的 tools 字段）。
  tools?: ToolSchema[]
  // 中文：采样温度。
  temperature?: number
  // 中文：最大输出 token 数。
  maxTokens?: number
  /**
   * Stop sequences: generation halts as soon as the model produces any one of
   * these strings (adapters map to the provider's stop field, e.g. OpenAI
   * `stop`). The stop string itself is not included in the output.
   */
  // 中文：停止序列：模型一产出其中任意一个字符串即停止生成（适配器映射到
  // provider 的 stop 字段，如 OpenAI 的 stop）。停止串本身不包含在输出里。
  stop?: string[]
  // 中文：取消信号（AbortSignal）。
  signal?: AbortSignal
  /**
   * Session identity stamped by the loop for request routing. Replay uses it
   * to separate cursors; adapters may map it to model-hidden transport metadata.
   */
  // 中文：loop 为请求路由盖印的会话身份。回放用它区分游标；适配器可把它映射
  // 到模型不可见的传输元数据。
  sessionId?: Branded<'SessionId'>
  /**
   * Provider-neutral classification for an auxiliary model call. Adapters may
   * map the purpose to model-hidden transport metadata or purpose-specific
   * generation policy. Ordinary conversation requests leave it unset.
   */
  // 中文：辅助模型调用的 provider 中立分类。适配器可把用途映射到模型不可见的
  // 传输元数据或按用途区分的生成策略。普通对话请求不设置它。
  purpose?: 'compaction' | 'session-title'
}
