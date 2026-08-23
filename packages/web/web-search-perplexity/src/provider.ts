/**
 * ================================ 文件注释 ================================
 * 【文件职责】本文件实现 Perplexity 搜索提供者：通过其 OpenAI 兼容的 chat-completions 端点
 *             执行搜索，把生成式回答与结构化引用适配为 ctx.web 的 WebSearchProvider。
 * 【技术维度】实现 WebSearchProvider 接口；用原生 fetch 客户端发 POST；生成式回答映射为
 *             content；来源优先用结构化 search_results，缺失时回退到 URL-only citations。
 * 【产品维度】产品启用 dsh-web-search-perplexity 即可获得 Perplexity 的生成式联网搜索
 *             （带回答与引用的答案）。
 * 【逻辑维度】常量（id/端点/模型/token 上限/时效类型）→ 选项接口 → 两个映射函数 →
 *             提供者类（available / search）→ 两个本地校验辅助函数。
 * 【关键边界】search_results 与 citations 二选一；HTTP 重定向一律失败为 WEB_PROVIDER_ERROR；
 *             最终 maxResults 截断由 web seam 负责，本提供者始终报 truncated: false。
 * 【新手阅读建议】先读 mapPerplexityResponse 看回答与引用的归一化，再读 search() 看网络流程。
 * ==========================================================================
 */
/**
 * Perplexity search over its OpenAI-compatible chat-completions endpoint. The generated answer
 * becomes `content`; sources prefer structured `search_results[]` and fall back to URL-only
 * `citations[]`. The wire format and native `fetch` client are provider-private and do not use
 * `ctx.llm`.
 * @module @deepseek-ai/dsh-web-search-perplexity/provider
 */

import { WebError } from '@deepseek-ai/dsh-web'
import type {
  WebSearchProvider,
  WebSearchRequest,
  WebSearchResult,
  WebSearchSource,
} from '@deepseek-ai/dsh-web'
import type { PerplexityError, PerplexityResponse, PerplexitySearchResult } from './types.ts'

/** Stable id this provider registers under. */
// 本提供者在 seam 注册表中使用的稳定 id。
export const PERPLEXITY_PROVIDER_ID = 'perplexity'

/** Default Perplexity endpoint; `/chat/completions` is the operation. */
// 默认的 Perplexity 端点基址；/chat/completions 是具体操作路径。
export const PERPLEXITY_DEFAULT_BASE_URL = 'https://api.perplexity.ai'

/** Default search model. */
// 默认搜索模型名。
export const PERPLEXITY_DEFAULT_MODEL = 'sonar'

/** Default upper bound on generated answer tokens. */
// 生成回答 token 的默认上限。
export const PERPLEXITY_DEFAULT_MAX_TOKENS = 1024

/** Recency filter values Perplexity accepts for `search_recency_filter`. */
// Perplexity 的 search_recency_filter 可接受的时效过滤取值。
export type PerplexityRecency = 'day' | 'week' | 'month' | 'year'

/** Attribution header sent on every request. Bump with the package version. */
// 每次请求发送的归属标识头；随包版本更新。
const USER_AGENT = 'deepseek-harness/0.0.1'

/** Resolved provider options (the plugin's `apply` supplies env-var and constant defaults). */
// 已解析的提供者选项（默认值由插件 apply() 从环境变量与常量补齐）。
export interface PerplexitySearchProviderOptions {
  /** Perplexity API key. Empty/absent makes the provider unavailable. */
  // Perplexity API key；为空/缺失时提供者不可用。
  apiKey: string
  /** Endpoint base; `/chat/completions` is appended. */
  // 端点基址；会拼接 /chat/completions。
  baseURL: string
  /** Search model name. */
  // 搜索模型名。
  model: string
  /** Upper bound on generated answer tokens (`max_tokens`). */
  // 生成回答 token 的上限（max_tokens 参数）。
  maxTokens: number
  /** Optional recency window sent as `search_recency_filter`; omitted = no filter. */
  // 可选的时效过滤窗口，随请求发给 search_recency_filter；省略则不设过滤。
  searchRecency?: PerplexityRecency
}

/**
 * Map one structured Perplexity search result to a normalized source.
 *
 * @param result - one entry of the response's `search_results[]`.
 * @returns the normalized source; blank fields are omitted rather than set empty.
 */
// 把一条结构化 Perplexity 搜索结果映射为归一化来源；空字段直接省略而非置空。
export function mapPerplexityResult(result: PerplexitySearchResult): WebSearchSource {
  return {
    url: result.url,
    ...result.title != null && result.title.length > 0 ? { title: result.title } : {},
    ...result.snippet != null && result.snippet.length > 0 ? { snippet: result.snippet } : {},
    ...result.date != null && result.date.length > 0 ? { publishedAt: result.date } : {},
  }
}

/**
 * Map a Perplexity response envelope to a normalized search result. Prefers
 * structured `search_results[]`; falls back to URL-only `citations[]` (those
 * sources carry just a `url`) only when `search_results` is absent.
 *
 * @param response - the parsed chat-completions response body.
 * @returns the normalized result; `content` is omitted when the answer is empty.
 */
// 把 Perplexity 响应信封映射为归一化搜索结果：优先结构化 search_results，
// 仅当 search_results 缺失时才回退到仅含 URL 的 citations；回答为空时省略 content。
export function mapPerplexityResponse(response: PerplexityResponse): WebSearchResult {
  const content = response.choices?.[0]?.message?.content
  const sources: WebSearchSource[] = response.search_results !== undefined
    ? response.search_results.map(mapPerplexityResult)
    : (response.citations ?? []).map(url => ({ url }))
  return {
    ...content != null && content.length > 0 ? { content } : {},
    sources,
    truncated: false,
  }
}

/** The Perplexity-backed search provider; HTTP redirects fail as `WEB_PROVIDER_ERROR`. */
// Perplexity 搜索提供者；HTTP 重定向一律失败为 WEB_PROVIDER_ERROR。
export class PerplexitySearchProvider implements WebSearchProvider {
  readonly id = PERPLEXITY_PROVIDER_ID

  constructor(private readonly options: PerplexitySearchProviderOptions) {}

  // Availability checks stay beside each provider's distinct config contract;
  // a shared base class would obscure which fields make this backend usable.
  // 可用性检查放在各提供者各自的配置契约旁：共用的基类会掩盖"哪些字段决定本后端可用"。
  /* jscpd:ignore-start */
  available(): boolean {
    return this.options.apiKey.length > 0
      && URL.canParse(this.options.baseURL)
      && isPositiveInteger(this.options.maxTokens)
  }
  /* jscpd:ignore-end */

  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    let response: Response
    try {
      response = await fetch(`${this.options.baseURL}/chat/completions`, {
        method: 'POST',
        redirect: 'error',
        headers: {
          'authorization': `Bearer ${this.options.apiKey}`,
          'content-type': 'application/json',
          'accept': 'application/json',
          'user-agent': USER_AGENT,
        },
        body: JSON.stringify({
          model: this.options.model,
          max_tokens: this.options.maxTokens,
          messages: [{ role: 'user', content: request.query }],
          ...this.options.searchRecency !== undefined ? { search_recency_filter: this.options.searchRecency } : {},
        }),
        ...signal !== undefined ? { signal } : {},
      })
    } catch (error: unknown) {
      if (isAbortError(error)) throw new WebError('Perplexity search aborted', 'WEB_ABORTED', { cause: error })
      throw new WebError(`Perplexity search request failed: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
    }

    if (!response.ok) {
      const status = response.status
      let message = `Perplexity API error (HTTP ${status})`
      try {
        const parsed = await response.json() as PerplexityError
        const detail = typeof parsed.error === 'string' ? parsed.error : parsed.error?.message ?? parsed.message
        if (detail !== undefined && detail.length > 0) message = detail
      } catch (error: unknown) {
        // An abort fired mid-body must surface as WEB_ABORTED, not be swallowed
        // into a generic HTTP-error message — cancellation is not a provider
        // error (the seam's cancellation contract).
        // 读取错误体中途发生的中止必须以 WEB_ABORTED 上报，不能吞进通用 HTTP 错误文案——
        // 取消不是提供者错误（seam 的取消契约）。
        if (isAbortError(error)) throw new WebError('Perplexity search aborted', 'WEB_ABORTED', { cause: error })
        // Otherwise: the HTTP status is already captured in `message` above; a
        // malformed/non-JSON error body (normal for gateway 5xx/429s) can only
        // cost a richer provider message, never the real error.
        // 其余情况：HTTP 状态已写入上面的 message；畸形/非 JSON 错误体（网关 5xx/429 常见）
        // 最多损失一条更丰富的提供者消息，绝不覆盖真实错误。
      }
      throw new WebError(message, 'WEB_PROVIDER_ERROR')
    }

    try {
      const payload = await response.json() as PerplexityResponse
      return mapPerplexityResponse(payload)
    } catch (error: unknown) {
      if (isAbortError(error)) throw new WebError('Perplexity search aborted', 'WEB_ABORTED', { cause: error })
      throw new WebError(`Perplexity returned an unprocessable response body: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
    }
  }
}

// These two predicates are intentionally local: exporting generic internals
// from the public web seam would add more API than these pure checks.
// 这两个谓词刻意保持局部：从公共 web seam 导出通用内部实现，只会多出无谓的 API 面。
/* jscpd:ignore-start */
/** True for a fetch/`AbortSignal` abort, surfaced as `WEB_ABORTED`. */
// 是否是 fetch 或 AbortSignal 引发的中止，统一上报为 WEB_ABORTED。
function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

/** True for a request limit that can be sent to Perplexity (a positive whole number). */
// 是否是可以发给 Perplexity 的请求限额（正整数）。
function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0
}
/* jscpd:ignore-end */
