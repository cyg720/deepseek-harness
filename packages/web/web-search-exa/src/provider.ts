/**
 * ================================ 文件注释 ================================
 * 【文件职责】本文件实现 Exa 搜索提供者：把 Exa 搜索 API（POST /search + highlight contents）
 *             适配为 ctx.web 的 WebSearchProvider。
 * 【技术维度】实现 WebSearchProvider 接口；用原生 fetch 客户端发 POST；把首条非空 highlight
 *             映射为 snippet、publishedDate 映射为 publishedAt；无生成式回答故省略 content。
 * 【产品维度】产品启用 dsh-web-search-exa 即可获得 Exa 的语义/关键词联网搜索能力。
 * 【逻辑维度】常量（id/端点/默认值）→ 选项接口 → 两个映射函数（单条/整包）→ 提供者类
 *             （available / search）→ 三个本地校验辅助函数。
 * 【关键边界】不带 snippet 的结果条目会被丢弃（宁可少报也不编造摘要）；HTTP 重定向
 *             （redirect: 'error'）一律失败为 WEB_PROVIDER_ERROR；最终 maxResults 截断
 *             由 web seam 负责，本提供者始终报 truncated: false。
 * 【新手阅读建议】先读 mapExaResult / mapExaResponse 看归一化规则，再读 search() 看网络流程。
 * ==========================================================================
 */
/**
 * `ExaSearchProvider`: a `WebSearchProvider` backed by the Exa search API (`POST /search` with
 * highlight contents). It maps the first non-blank highlight to `snippet`, maps
 * `publishedDate` to `publishedAt`, drops entries without a snippet, and omits `content`
 * because Exa returns no generated answer.
 * @module @deepseek-ai/dsh-web-search-exa/provider
 */

import { WebError } from '@deepseek-ai/dsh-web'
import type {
  WebSearchProvider,
  WebSearchRequest,
  WebSearchResult,
  WebSearchSource,
} from '@deepseek-ai/dsh-web'
import type { ExaError, ExaResult, ExaSearchResponse } from './types.ts'

/** Stable id this provider registers under. */
// 本提供者在 seam 注册表中使用的稳定 id。
export const EXA_PROVIDER_ID = 'exa'

/** Default Exa search endpoint; `/search` is the operation. */
// 默认的 Exa 搜索端点基址；/search 是具体操作路径。
export const EXA_DEFAULT_BASE_URL = 'https://api.exa.ai'

/** Default retrieval mode: let Exa pick between keyword and neural search. */
// 默认检索模式：让 Exa 在关键词与语义搜索之间自行选择。
export const EXA_DEFAULT_SEARCH_TYPE = 'auto'

/** Default number of highlight sentences requested per result. */
// 每条结果默认请求的高亮句子数。
export const EXA_DEFAULT_HIGHLIGHTS_PER_RESULT = 1

/** Attribution header sent on every request. Bump with the package version. */
// 每次请求发送的归属标识头；随包版本更新。
const USER_AGENT = 'deepseek-harness/0.0.1'

/** Resolved provider options (the plugin's `apply` supplies env-var and constant defaults). */
// 已解析的提供者选项（默认值由插件 apply() 从环境变量与常量补齐）。
export interface ExaSearchProviderOptions {
  /** Exa API key. Empty/absent makes the provider unavailable. */
  // Exa API key；为空/缺失时提供者不可用。
  apiKey: string
  /** Endpoint base; `/search` is appended. */
  // 端点基址；会拼接 /search。
  baseURL: string
  /** Retrieval mode sent as Exa's `type`. */
  // 检索模式，随请求发给 Exa 的 type 字段。
  searchType: 'auto' | 'keyword' | 'neural'
  /** Default result count when a request carries no `maxResults`. */
  // 请求未带 maxResults 时的默认结果条数。
  numResults?: number
  /** Highlight sentences requested per result (Exa's `highlightsPerUrl`). */
  // 每条结果请求的高亮句子数（Exa 的 highlightsPerUrl 参数）。
  highlightsPerResult: number
}

/**
 * Map one Exa result to a normalized source, or `undefined` when it carries no
 * portable snippet (an entry with no highlight is dropped — the seam has no
 * other field to derive a snippet from, and inventing one would lie).
 *
 * @param result - one entry of Exa's `results[]`.
 * @returns the normalized source, or `undefined` when the entry has no
 *   non-blank highlight.
 */
// 把一条 Exa 结果映射为归一化来源；没有可移植摘要（highlight）时返回 undefined 并丢弃——
// seam 没有其它字段能推导摘要，编造摘要等于说谎。
export function mapExaResult(result: ExaResult): WebSearchSource | undefined {
  const snippet = result.highlights?.find(highlight => highlight.trim().length > 0)
  if (snippet === undefined) return undefined
  return {
    url: result.url,
    ...result.title != null && result.title.length > 0 ? { title: result.title } : {},
    snippet,
    ...result.publishedDate != null && result.publishedDate.length > 0 ? { publishedAt: result.publishedDate } : {},
  }
}

/**
 * Map an Exa response envelope to a normalized search result.
 *
 * @param response - the parsed `POST /search` response body.
 * @returns the normalized result; snippet-less entries are dropped
 *   ({@link mapExaResult}).
 */
// 把 Exa 响应信封映射为归一化搜索结果；无摘要的条目按 mapExaResult 的规则丢弃。
export function mapExaResponse(response: ExaSearchResponse): WebSearchResult {
  const sources = (response.results ?? [])
    .map(mapExaResult)
    .filter((source): source is WebSearchSource => source !== undefined)
  // Exa returns no generated answer, so `content` is omitted. The web service owns the
  // final `maxResults` truncation, so this provider reports `truncated: false`.
  // Exa 不返回生成式回答，因此省略 content；最终 maxResults 截断归 web seam 负责，
  // 所以本提供者固定报告 truncated: false。
  return { sources, truncated: false }
}

/** The Exa-backed search provider; HTTP redirects fail as `WEB_PROVIDER_ERROR`. */
// Exa 搜索提供者；HTTP 重定向一律失败为 WEB_PROVIDER_ERROR。
export class ExaSearchProvider implements WebSearchProvider {
  readonly id = EXA_PROVIDER_ID

  constructor(private readonly options: ExaSearchProviderOptions) {}

  // 可用性检查：apiKey 非空、基址可解析、各数值参数为正整数。
  available(): boolean {
    return this.options.apiKey.length > 0
      && isValidBaseUrl(this.options.baseURL)
      && isPositiveInteger(this.options.highlightsPerResult)
      && (this.options.numResults === undefined || isPositiveInteger(this.options.numResults))
  }

  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    // A per-request bound wins over the configured default; either may be absent.
    // 请求级上限优先于配置默认值；两者都可能缺失。
    const numResults = request.maxResults ?? this.options.numResults
    let response: Response
    try {
      response = await fetch(`${this.options.baseURL}/search`, {
        method: 'POST',
        redirect: 'error',
        headers: {
          'authorization': `Bearer ${this.options.apiKey}`,
          'content-type': 'application/json',
          'accept': 'application/json',
          'user-agent': USER_AGENT,
        },
        body: JSON.stringify({
          query: request.query,
          type: this.options.searchType,
          contents: { highlights: { highlightsPerUrl: this.options.highlightsPerResult } },
          ...numResults !== undefined ? { numResults } : {},
        }),
        ...signal !== undefined ? { signal } : {},
      })
    } catch (error: unknown) {
      if (isAbortError(error)) throw new WebError('Exa search aborted', 'WEB_ABORTED', { cause: error })
      throw new WebError(`Exa search request failed: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
    }

    if (!response.ok) {
      const status = response.status
      let message = `Exa API error (HTTP ${status})`
      try {
        const parsed = await response.json() as ExaError
        const detail = parsed.error ?? parsed.message
        if (detail !== undefined && detail.length > 0) message = detail
      } catch (error: unknown) {
        // An abort fired mid-body must surface as WEB_ABORTED, not be swallowed
        // into a generic HTTP-error message — cancellation is not a provider
        // error (the seam's cancellation contract).
        // 读取错误体中途发生的中止必须以 WEB_ABORTED 上报，不能吞进通用 HTTP 错误文案——
        // 取消不是提供者错误（seam 的取消契约）。
        if (isAbortError(error)) throw new WebError('Exa search aborted', 'WEB_ABORTED', { cause: error })
        // Otherwise: the HTTP status is already captured in `message` above; a
        // malformed/non-JSON error body (normal for gateway 5xx/429s) can only
        // cost a richer provider message, never the real error.
        // 其余情况：HTTP 状态已写入上面的 message；畸形/非 JSON 错误体（网关 5xx/429 常见）
        // 最多损失一条更丰富的提供者消息，绝不覆盖真实错误。
      }
      throw new WebError(message, 'WEB_PROVIDER_ERROR')
    }

    try {
      const payload = await response.json() as ExaSearchResponse
      return mapExaResponse(payload)
    } catch (error: unknown) {
      if (isAbortError(error)) throw new WebError('Exa search aborted', 'WEB_ABORTED', { cause: error })
      throw new WebError(`Exa returned an unprocessable response body: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
    }
  }
}

/** True when `baseURL` parses as an absolute URL (a cheap local config check). */
// baseURL 能否解析为绝对 URL（廉价的本地配置检查）。
function isValidBaseUrl(baseURL: string): boolean {
  return URL.canParse(baseURL)
}

/** True for a request limit that can be sent to Exa (a positive whole number). */
// 是否是可以发给 Exa 的请求限额（正整数）。
function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0
}

/** True for a fetch/`AbortSignal` abort, surfaced as `WEB_ABORTED`. */
// 是否是 fetch 或 AbortSignal 引发的中止，统一上报为 WEB_ABORTED。
function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}
