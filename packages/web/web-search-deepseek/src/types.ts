/**
 * ================================ 文件注释 ================================
 * 【文件职责】本文件定义 DeepSeek 搜索提供方私有的线上类型：Anthropic 兼容 Messages API 的
 *             请求/响应结构（web_search 服务端工具的结果块与引用摘录）。
 * 【技术维度】纯类型文件，无运行时代码；不依赖 ctx.llm（提供方自己发 HTTP 请求）。
 * 【产品维度】这些类型把"DeepSeek 原生搜索"的线上差异收敛在提供方内部，
 *             上层 seam 只需消费归一化后的 WebSearchResult。
 * 【逻辑维度】按出现顺序：结果条目 → 结果块 → 引用位置 → 文本块 → 内容块联合 →
 *             响应信封 → 错误信封。
 * 【关键边界】可引用的结果条目与引用摘录分别落在不同内容块里，由 provider.ts 按 URL 拼合。
 * 【新手阅读建议】对照 provider.ts 中 mapAnthropicResponse 的消费方式阅读。
 * ==========================================================================
 */
/**
 * Provider-private wire types for DeepSeek's Anthropic-compatible Messages API. Citeable
 * result items and citation excerpts arrive in separate blocks; the provider joins them by
 * URL. These types do not create a dependency on `ctx.llm`.
 * @module @deepseek-ai/dsh-web-search-deepseek/types
 */

/** A `web_search_result` item inside a `web_search_tool_result` block. */
// 位于 web_search_tool_result 块内的单条可引用搜索结果条目。
export interface WebSearchResultItem {
  type: string
  url: string
  title?: string | null
  /** Provider-supplied page age/recency string (mapped to `publishedAt`). */
  // 提供方给出的页面时效/新旧程度描述（映射为归一化的 publishedAt）。
  page_age?: string | null
}

/** A `web_search_tool_result` content block: the citeable result shape. */
// web_search_tool_result 内容块：承载可引用结果的形状。
export interface WebSearchToolResultBlock {
  type: 'web_search_tool_result'
  content?: WebSearchResultItem[]
}

/** One citation location inside a `text` block (the snippet source). */
// text 块中的单个引用位置：这是摘要（snippet）的来源。
export interface CitationLocation {
  type?: string
  url?: string | null
  cited_text?: string | null
}

/** A `text` content block: the model's prose plus per-URL citations. */
// text 内容块：模型的文字叙述加上按 URL 组织的引用。
export interface TextBlock {
  type: 'text'
  text?: string | null
  citations?: CitationLocation[]
}

/** Any content block; only `web_search_tool_result` and `text` are consumed. */
// 任意内容块的联合；本提供方只消费 web_search_tool_result 与 text 两种。
export type ContentBlock = WebSearchToolResultBlock | TextBlock | { type: string }

/** DeepSeek's Anthropic Messages response envelope. */
// DeepSeek Messages 响应信封。
export interface AnthropicResponse {
  content?: ContentBlock[]
}

/** DeepSeek's error response envelope (best-effort; fields vary). */
// DeepSeek 错误响应信封（尽力而为，字段随失败类型变化）。
export interface AnthropicError {
  error?: { message?: string } | string
  message?: string
}
