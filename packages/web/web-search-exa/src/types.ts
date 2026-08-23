/**
 * ================================ 文件注释 ================================
 * 【文件职责】本文件定义 Exa 搜索 API 的线上请求/响应类型（POST https://api.exa.ai/search）。
 * 【技术维度】纯类型文件，无运行时代码；字段命名跟随 Exa 官方接口。
 * 【产品维度】把 Exa 的扁平 results 数组收敛为提供方内部词汇，便于上层归一化。
 * 【逻辑维度】请求体 → 单条结果 → 响应信封 → 错误信封。
 * 【关键边界】请求了 highlights 时每条结果才带 highlights 数组；numResults 只是成本优化，
 *             最终截断仍由 seam 强制。
 * 【新手阅读建议】对照 provider.ts 中 mapExaResult / mapExaResponse 的消费方式阅读。
 * ==========================================================================
 */
/**
 * Wire types for the Exa search API (`POST https://api.exa.ai/search`). Types
 * only — no runtime code. Exa returns a flat `results[]`; each entry carries a
 * URL, optional title, optional `publishedDate`, and (when highlights are
 * requested) a `highlights[]` array of salient sentences.
 *
 * @module @deepseek-ai/dsh-web-search-exa/types
 */

/** Request body sent to Exa's search endpoint. */
// 发给 Exa 搜索端点的请求体。
export interface ExaSearchRequest {
  query: string
  /** Retrieval mode: keyword, neural (embeddings), or auto (Exa decides). */
  // 检索模式：keyword（关键词）、neural（向量/语义）、auto（让 Exa 决定）。
  type: 'auto' | 'keyword' | 'neural'
  /** Exa's result-count control; the seam still enforces the bound on return. */
  // Exa 的结果条数控制；返回时 seam 仍会强制上限。
  numResults?: number
  /** Ask Exa to return highlight sentences per result. */
  // 请求 Exa 为每条结果返回若干高亮句子。
  contents: { highlights: { highlightsPerUrl: number } }
}

/** One entry of Exa's flat `results[]`. */
// Exa 扁平 results 数组中的单条结果。
export interface ExaResult {
  url: string
  title?: string | null
  publishedDate?: string | null
  highlights?: string[]
}

/** Exa's search response envelope. */
// Exa 搜索响应信封。
export interface ExaSearchResponse {
  results?: ExaResult[]
}

/** Exa's error response envelope (best-effort; fields vary by failure). */
// Exa 错误响应信封（尽力而为，字段随失败类型变化）。
export interface ExaError {
  error?: string
  message?: string
}
