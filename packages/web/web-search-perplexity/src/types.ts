/**
 * ================================ 文件注释 ================================
 * 【文件职责】本文件定义 Perplexity 搜索 API 的线上类型：OpenAI 兼容的 chat-completions
 *             请求/响应结构（含结构化 search_results 与 URL-only citations 两种来源）。
 * 【技术维度】纯类型文件，无运行时代码；提供方私有，不依赖 ctx.llm。
 * 【产品维度】把 Perplexity 的生成式回答与引用收敛为提供方内部词汇，便于上层归一化。
 * 【逻辑维度】请求体 → 结构化搜索结果 → 响应信封 → 错误信封。
 * 【关键边界】search_results 与 citations 是二选一来源：有结构化结果优先用结构化，
 *             否则回退到纯 URL 列表。
 * 【新手阅读建议】对照 provider.ts 中 mapPerplexityResponse 的消费方式阅读。
 * ==========================================================================
 */
/**
 * Wire types for the Perplexity search API (`POST https://api.perplexity.ai/chat/completions`,
 * an OpenAI-compatible chat shape). Results prefer structured `search_results` and fall back to
 * URL-only `citations`; the provider-private wire shape does not depend on `ctx.llm`.
 * @module @deepseek-ai/dsh-web-search-perplexity/types
 */

/** Request body sent to Perplexity's chat-completions endpoint. */
// 发给 Perplexity chat-completions 端点的请求体。
export interface PerplexityRequest {
  model: string
  messages: { role: 'user'; content: string }[]
}

/** One structured search result (the preferred citation shape). */
// 一条结构化搜索结果（首选的引用形状）。
export interface PerplexitySearchResult {
  url: string
  title?: string | null
  snippet?: string | null
  date?: string | null
}

/** Perplexity's response envelope. */
// Perplexity 响应信封。
export interface PerplexityResponse {
  choices?: { message?: { content?: string | null } }[]
  /** Structured citation data (preferred). */
  // 结构化引用数据（优先使用）。
  search_results?: PerplexitySearchResult[]
  /** URL-only citation fallback. */
  // 仅含 URL 的引用回退来源。
  citations?: string[]
}

/** Perplexity's error response envelope (best-effort; fields vary). */
// Perplexity 错误响应信封（尽力而为，字段随失败类型变化）。
export interface PerplexityError {
  error?: { message?: string } | string
  message?: string
}
