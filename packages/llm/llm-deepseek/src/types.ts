

/**
 * DeepSeek chat-completions wire format (OpenAI-compatible). Types only.
 *
 * Source of truth: the official API docs at
 * `~/repos/deepsuite-docs/apps/docs/docs` (api/create-chat-completion,
 * guides/thinking_mode.mdx, guides/tool_calls.md), cross-checked against
 * live streams from the internal endpoint (2026-06).
 *
 * @module dsh-llm-deepseek/types
 */

/** Request body for `POST {baseURL}/chat/completions`. */
// 中文：POST {baseURL}/chat/completions 的请求体。

/*
 * 【文件职责】声明 DeepSeek chat-completions 请求和响应的线格式，供提供者适配层与通用模型类型转换。
 */

export interface WireRequest {
  // 中文：模型 id。
  model: string
  // 中文：消息数组。
  messages: WireMessage[]
  // 中文：始终要求流式返回。
  stream: true
  // 中文：要求返回用量统计。
  stream_options: { include_usage: true }
  /** Thinking-mode toggle (top level, NOT inside extra_body on the wire). */
  // 中文：思考模式开关（顶层字段，不在线上 extra_body 里）。
  thinking?: { type: 'enabled' | 'disabled' }
  /** Thinking effort (official levels). */
  // 中文：推理强度（官方级别）。
  reasoning_effort?: 'low' | 'high' | 'max'
  // 中文：工具列表。
  tools?: WireTool[]
  // 中文：采样温度。
  temperature?: number
  // 中文：最大输出 token 数。
  max_tokens?: number
  /**
   * Stop sequences (OpenAI `stop`): generation halts as soon as the model
   * produces any one of these strings. Mapped from `GenerateOptions.stop`.
   */
  // 中文：停止序列（OpenAI 的 stop）：模型一产出其中任意一个字符串即停止
  // 生成；由 GenerateOptions.stop 映射而来。
  stop?: string[]
}

/** System-role message: a single string of instructions. */
// 中文：system 角色消息：单个指令字符串。
export interface WireSystemMessage {
  role: 'system'
  content: string
}

/** Text part inside a multimodal user message. */
// 中文：多模态 user 消息里的文本部分。
export interface WireTextContentPart {
  type: 'text'
  text: string
}

/** Files API reference inside a multimodal user message. */
// 中文：多模态 user 消息里的 Files API 引用。
export interface WireFileContentPart {
  type: 'file'
  file_id: string
}

/** Inline base64 data URL inside a multimodal user message. */
// 中文：多模态 user 消息里的内联 base64 data URL。
export interface WireImageUrlContentPart {
  type: 'image_url'
  image_url: { url: string }
}

/** One image representation accepted by a multimodal user message. */
// 中文：多模态 user 消息接受的一种图片表示（文件引用或内联 URL）。
export type WireImageContentPart = WireFileContentPart | WireImageUrlContentPart

/** Ordered input part accepted by a multimodal user message. */
// 中文：多模态 user 消息接受的有序输入部分（文本或图片）。
export type WireUserContentPart = WireTextContentPart | WireImageContentPart

/** User-role message: text-only string or ordered multimodal input. */
// 中文：user 角色消息：纯文本字符串或有序多模态输入。
export interface WireUserMessage {
  role: 'user'
  content: string | WireUserContentPart[]
}

/** Tool-role message: the result of one tool call, keyed by its call id. */
// 中文：tool 角色消息：一次工具调用的结果，以 call id 关联。
export interface WireToolMessage {
  role: 'tool'
  tool_call_id: string
  content: string
}

/** One entry of the request `messages` array, discriminated on `role`. */
// 中文：请求 messages 数组的一个条目，按 role 判别。
export type WireMessage =
  | WireSystemMessage
  | WireUserMessage
  | WireAssistantMessage
  | WireToolMessage

/*
 * （中文）助手角色的历史消息。工具调用轮次回放 content 为 ""（绝不 null，
 * 某些网关拒绝 null）；只有该轮既无文本也无工具调用时才发 null。
 */
/**
 * Assistant-role history message. The harness replays `content: ""` (never
 * null) on tool-call-only turns — some gateways reject null — and sends null
 * only when the turn carried neither text nor tool calls.
 */
export interface WireAssistantMessage {
  role: 'assistant'
  content: string | null
  /**
   * CoT passback, present on every turn whose assistant content carried
   * reasoning. REQUIRED on tool-call turns in thinking mode (see
   * guides/thinking_mode.mdx § Tool Calls); DeepSeek ignores it elsewhere,
   * while a gateway re-encoding for another vendor recovers that turn's
   * thinking signature by hashing it.
   */
  // 中文：思维链（CoT）回传，凡是助手内容带推理的轮次都会出现。思考模式下
  // 的工具调用轮次必需（见 guides/thinking_mode.mdx 的工具调用一节）；
  // 其他情况 DeepSeek 会忽略它，而为其他厂商转码的网关会通过哈希恢复该轮
  // 的思考签名。
  reasoning_content?: string
  // 中文：已完成的工具调用（回放）。
  tool_calls?: WireToolCall[]
}

/** A completed tool call replayed on an assistant history message; `arguments` is the raw JSON string. */
// 中文：助手历史消息上回放的一个已完成工具调用；arguments 是原始 JSON 字符串。
export interface WireToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

/** One entry of the request `tools` array; `parameters` is a JSON Schema object. */
// 中文：请求 tools 数组的一个条目；parameters 是 JSON Schema 对象。
export interface WireTool {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

/** One parsed SSE `data:` payload (a chat.completion.chunk). */
// 中文：一条解析后的 SSE data: 负载（chat.completion.chunk）。
export interface WireChunk {
  // 中文：选择数组（请求总是只要一个选择）。
  choices?: WireChoice[]
  /** Arrives attached to the finish chunk and/or as a trailing usage-only chunk. */
  // 中文：随 finish 块和/或末尾的"仅用量"块到达。
  usage?: WireUsage | null
}

/** One streamed choice (requests always ask for a single one); `finish_reason` is non-null only on its terminal chunk. */
// 中文：一个流式选择（请求总是只要一个）；finish_reason 只在终结块上非 null。
export interface WireChoice {
  delta?: WireDelta
  finish_reason?: string | null
}

/** The incremental content of one streamed choice; any subset of fields may be present per chunk. */
// 中文：一个流式选择的增量内容；每个块可以只带字段的任意子集。
export interface WireDelta {
  role?: string
  /** Visible text. Null/empty on reasoning/tool-call chunks. */
  // 中文：可见文本；推理/工具调用块上为 null 或空。
  content?: string | null
  /**
   * Thinking-mode CoT. The FIRST chunk carries an empty string (must not
   * open a reasoning block); absent entirely in non-thinking mode.
   */
  // 中文：思考模式的 CoT。首个块携带空字符串（不得据此打开推理块）；非思考
  // 模式下整个字段缺席。
  reasoning_content?: string | null
  tool_calls?: WireToolCallDelta[]
}

/** A streamed fragment of one tool call; fragments sharing an `index` concatenate into one call. */
// 中文：一次工具调用的流式片段；共享 index 的片段拼接成一次完整调用。
export interface WireToolCallDelta {
  /** Disambiguates parallel tool calls; stable across a call's deltas. */
  // 中文：区分并行工具调用；在一次调用的各 delta 间保持稳定。
  index: number
  /**
   * Carried by the first delta of each call. Gateways observed in the wild
   * repeat it on continuation deltas as `''` or `null`; both mean "unchanged".
   */
  id?: string | null
  type?: 'function'
  function?: {
    /** Carried by the first delta of each call, with the same `''`/`null` repetition as {@link WireToolCallDelta.id}. */
    name?: string | null
    /** Argument JSON fragment (concatenate across deltas). */
    arguments?: string | null
  }
}

/*
 * （中文）线上 token 计量。prompt_tokens 包含缓存命中（等于
 * prompt_cache_hit_tokens + prompt_cache_miss_tokens）；mapUsage 会扣除它们
 * 以保持 harness"计数互斥"的约定。prompt_tokens_details.cached_tokens 是
 * 命中数的 OpenAI 兼容写法。
 */
/**
 * Wire token accounting. `prompt_tokens` INCLUDES cache hits (it equals
 * `prompt_cache_hit_tokens + prompt_cache_miss_tokens`); `mapUsage` subtracts
 * them to keep the harness convention of disjoint counts.
 * `prompt_tokens_details.cached_tokens` is the OpenAI-compat spelling of the
 * hit count.
 */
export interface WireUsage {
  // 中文：提示 token 总数（含缓存命中）。
  prompt_tokens: number
  // 中文：完成 token 数。
  completion_tokens: number
  /** Provider-reported aggregate across prompt and completion tokens. */
  total_tokens?: number
  prompt_cache_hit_tokens?: number
  // 中文：缓存未命中 token 数（可选）。
  prompt_cache_miss_tokens?: number
  // 中文：OpenAI 兼容的命中数写法（可选）。
  prompt_tokens_details?: { cached_tokens?: number }
  // 中文：推理 token 数（可选）。
  completion_tokens_details?: { reasoning_tokens?: number }
}

/** Non-2xx error body. */
// 中文：非 2xx 错误响应体。
export interface WireError {
  error?: { message?: string; type?: string; code?: string }
}
