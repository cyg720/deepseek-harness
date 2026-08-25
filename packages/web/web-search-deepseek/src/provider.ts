/*
 * ================================ 文件注释 ================================
 * 【文件职责】本文件实现 DeepSeek 搜索提供者：通过 Anthropic 兼容 Messages API 调用原生
 *             web_search_20250305 服务端工具执行搜索，把结果块归一化为 WebSearchProvider。
 * 【技术维度】实现 WebSearchProvider 接口；用原生 fetch 客户端（不走 ctx.llm）；一次搜索
 *             花费一次模型轮次；结果以结构化块返回，缺失结果块视为错误而非散文兜底。
 * 【产品维度】复用 DeepSeek API key 即可获得 DeepSeek 原生联网搜索；请求快照会写入会话日志，
 *             保证"模型可见输入可还原"。
 * 【逻辑维度】常量 → 请求快照类型 + 会话事件声明 → 选项接口 → citationSnippets /
 *             mapAnthropicResponse 两个映射函数 → 提供者类（available / search / apiKey）
 *             → 取消与校验辅助函数。
 * 【关键边界】密钥解析与端点读取必须来自同一次配置快照（防止设置热更新混用）；
 *             响应无 web_search_tool_result 块即抛错；重定向 fail 为 WEB_PROVIDER_ERROR。
 * 【新手阅读建议】先读 mapAnthropicResponse 看结果块如何拼接，再读 search() 看请求构造
 *             与错误分类，最后看 abortable 的取消竞态处理。
 * ==========================================================================
 */
/**
 * DeepSeek search through an Anthropic-compatible Messages model call with the native
 * `web_search_20250305` server tool. Each search costs a model turn, but returns structured
 * result blocks; absence of those blocks is an error rather than a prose-scraping fallback.
 * The wire format and native `fetch` client are provider-private and do not use `ctx.llm`.
 * @module @deepseek-ai/dsh-web-search-deepseek/provider
 */

import { WebError } from '@deepseek-ai/dsh-web'
import type {
  WebSearchProvider,
  WebSearchRequest,
  WebSearchResult,
  WebSearchSource,
} from '@deepseek-ai/dsh-web'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-session'
import type {
  AnthropicError,
  AnthropicResponse,
  ContentBlock,
  TextBlock,
  WebSearchToolResultBlock,
} from './types.ts'

/** Stable id this provider registers under. */
// 本提供者在 seam 注册表中使用的稳定 id。
export const DEEPSEEK_PROVIDER_ID = 'deepseek-official'

/**
 * Default endpoint: DeepSeek's Anthropic-compatible API, `/v1` included
 * (`/messages` is appended). This is NOT the chat-completions base
 * (`https://api.deepseek.com`) `@deepseek-ai/dsh-llm-deepseek` uses, so this
 * provider does NOT reuse `$DEEPSEEK_BASE_URL` — only the API key is shared.
 */
// 默认端点：DeepSeek 的 Anthropic 兼容 API（含 /v1 前缀，后面再拼接 /messages）。
// 注意这不是 dsh-llm-deepseek 用的聊天补全基址（https://api.deepseek.com），
// 因此本提供者不复用 $DEEPSEEK_BASE_URL——只共享 API key。
export const DEEPSEEK_DEFAULT_BASE_URL = 'https://api.deepseek.com/anthropic/v1'

/** Default Anthropic-format model name (aligned with the repo's DeepSeek model vocabulary). */
// 默认的 Anthropic 格式模型名（与仓库 DeepSeek 模型词汇表一致）。
export const DEEPSEEK_DEFAULT_MODEL = 'deepseek-v4-flash'

/** Default `anthropic-version` header value. */
// 默认的 anthropic-version 请求头取值。
export const DEEPSEEK_DEFAULT_API_VERSION = '2023-06-01'

/** Default upper bound on generated tokens for the Messages request. */
// Messages 请求中生成 token 的默认上限。
export const DEEPSEEK_DEFAULT_MAX_TOKENS = 4096

/** Default maximum `web_search` server-tool uses per request. */
// 每次请求中 web_search 服务端工具的默认最大使用次数。
export const DEEPSEEK_DEFAULT_MAX_USES = 5

/** Attribution header sent on every request. Bump with the package version. */
// 每次请求发送的归属标识头；随包版本更新。
const USER_AGENT = 'deepseek-harness/0.0.1'

/**
 * Exact secret-free DeepSeek Messages request recorded immediately before one
 * auxiliary search dispatch.
 */
// 在一次辅助搜索派发前记录的、去密钥后的 DeepSeek Messages 请求快照。
export interface DeepSeekSearchLlmRequest {
  /** Fully resolved Messages endpoint. */
  // 完整解析后的 Messages 端点。
  readonly endpoint: string
  /** `anthropic-version` header value. */
  // anthropic-version 请求头取值。
  readonly apiVersion: string
  /** Exact JSON body sent to the provider. */
  // 实际发给提供方的精确 JSON 请求体。
  readonly body: {
    readonly model: string
    readonly max_tokens: number
    readonly messages: readonly [{
      readonly role: 'user'
      readonly content: readonly [{
        readonly type: 'text'
        readonly text: string
      }]
    }]
    readonly tools: readonly [{
      readonly type: 'web_search_20250305'
      readonly name: 'web_search'
      readonly max_uses: number
    }]
  }
}

// 类型合并：为会话事件表新增"请求快照"事件，供会话日志持久化模型可见的辅助输入。
declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Secret-free auxiliary DeepSeek search request recorded before dispatch. */
    // 派发前记录的、去密钥的 DeepSeek 辅助搜索请求。
    'web/deepseek-search-llm-request': DeepSeekSearchLlmRequest
  }
}

/** Resolved provider options (the plugin's `apply` supplies credential and constant defaults). */
// 已解析的提供者选项（默认值由插件 apply() 从凭据与环境变量补齐）。
export interface DeepSeekSearchProviderOptions {
  /** Literal DeepSeek API key; when present it wins over {@link resolveApiKey}. */
  // 字面量 API key；存在时优先于 resolveApiKey。
  apiKey?: string
  /** Resolve the current DeepSeek API key for one search operation. */
  // 为一次搜索操作解析当前的 DeepSeek API key。
  resolveApiKey?: () => Promise<string | undefined>
  /** Credential reference named by missing-credential diagnostics. */
  // 凭据引用；密钥缺失时的诊断信息会点名它。
  apiKeyEnv?: CredentialRef
  /** Endpoint base; `/messages` is appended. */
  // 端点基址；会拼接 /messages。
  baseURL: string
  /** Anthropic-format model name. */
  // Anthropic 格式的模型名。
  model: string
  /** `anthropic-version` header value. */
  // anthropic-version 请求头取值。
  apiVersion: string
  /** Upper bound on generated tokens for the Messages request. */
  // Messages 请求的生成 token 上限。
  maxTokens: number
  /** Maximum `web_search` server-tool uses per request. */
  // 每次请求中 web_search 服务端工具的最大使用次数。
  maxUses: number
  /**
   * Record the exact secret-free request immediately before dispatch. A throw
   * prevents dispatch so model-visible auxiliary input cannot escape logging.
   */
  // 派发前记录精确的去密钥请求；此处抛错可阻止派发，
  // 从而保证"模型可见的辅助输入不可能逃出日志"。
  recordRequest?: (request: DeepSeekSearchLlmRequest) => void
}

/**
 * Build a `url → cited_text` map from every `text` block's `citations[]`. This
 * is the snippet source: Anthropic `web_search_result` items carry
 * `url`/`title`/`page_age` but typically NO inline snippet — the excerpt lives
 * in a separate `text` block's citation, keyed by `url` (first occurrence wins).
 *
 * @param blocks - the response's content blocks; non-`text` blocks are skipped.
 * @returns the `url → cited_text` map (empty when no citations are present).
 */
// 从每个 text 块的 citations 数组构建"url → 引用摘录"映射。这是摘要（snippet）的来源：
// Anthropic 的 web_search_result 条目只带 url/title/page_age，通常没有内联摘要——
// 摘录存在于另一个 text 块的引用里，按 url 关联（首次出现者胜出）。
export function citationSnippets(blocks: readonly ContentBlock[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const block of blocks) {
    if (block.type !== 'text') continue
    for (const cite of (block as TextBlock).citations ?? []) {
      if (cite.url != null && cite.url.length > 0 && cite.cited_text != null && cite.cited_text.length > 0 && !map.has(cite.url)) {
        map.set(cite.url, cite.cited_text)
      }
    }
  }
  return map
}

/**
 * Map a DeepSeek Anthropic Messages response to a normalized search result. Walks
 * `web_search_tool_result` blocks for citeable `web_search_result` items, joins each to its
 * citation excerpt as `snippet`, and dedupes by `url` (a `max_uses > 1` request can surface
 * the same URL across searches). The web service owns the final `maxResults` truncation, so
 * `truncated` is always `false` here.
 *
 * @param response - the parsed Messages response body.
 * @returns the normalized result with deduped, snippet-joined sources.
 * @throws {@link WebError} when native search produced no result block.
 */
// 把 DeepSeek Messages 响应映射为归一化搜索结果：遍历 web_search_tool_result 块收集可引用
// 条目，把引用摘录拼为 snippet，并按 url 去重（max_uses 大于 1 时同一 URL 可能跨搜索重复出现）。
// 最终 maxResults 截断归 web seam 负责，所以这里 truncated 恒为 false。
export function mapAnthropicResponse(response: AnthropicResponse): WebSearchResult {
  const blocks = response.content ?? []
  const resultBlocks = blocks.filter(
    (block): block is WebSearchToolResultBlock => block.type === 'web_search_tool_result',
  )
  if (resultBlocks.length === 0) {
    throw new WebError(
      'DeepSeek returned no web_search_tool_result blocks; the request may not have triggered native web search',
      'WEB_PROVIDER_ERROR',
    )
  }

  const snippets = citationSnippets(blocks)
  const seen = new Set<string>()
  const sources: WebSearchSource[] = []
  for (const block of resultBlocks) {
    for (const item of block.content ?? []) {
      if (item.type !== 'web_search_result' || item.url.length === 0 || seen.has(item.url)) continue
      seen.add(item.url)
      const snippet = snippets.get(item.url)
      sources.push({
        url: item.url,
        ...item.title != null && item.title.length > 0 ? { title: item.title } : {},
        ...snippet != null && snippet.length > 0 ? { snippet } : {},
        ...item.page_age != null && item.page_age.length > 0 ? { publishedAt: item.page_age } : {},
      })
    }
  }
  return { sources, truncated: false }
}

/** The DeepSeek-backed search provider; HTTP redirects fail as `WEB_PROVIDER_ERROR`. */
// DeepSeek 搜索提供者；HTTP 重定向一律失败为 WEB_PROVIDER_ERROR。
export class DeepSeekSearchProvider implements WebSearchProvider {
  readonly id = DEEPSEEK_PROVIDER_ID

  /**
   * @param resolveOptions - the options for the NEXT operation, snapshotted
   * once at each operation's entry so one search never mixes two sections. A
   * thunk rather than a value because the plugin's settings section can change
   * between searches, and re-registering the provider to carry a new endpoint
   * would make the seam's selection observable to the user as a flicker.
   */
  // 构造参数是一个"解析器"函数而非固定值：每次搜索开始时快照一次选项，
  // 保证一次搜索不会混用两份设置 section；插件设置可在两次搜索之间变化，
  // 若为了携带新端点而重新注册提供者，会让 seam 的选择对用户可见地闪烁。
  constructor(private readonly resolveOptions: () => DeepSeekSearchProviderOptions) {}

  // 可用性检查：有 key 来源、基址可解析、数值参数为正整数。
  available(): boolean {
    const options = this.resolveOptions()
    return ((options.apiKey?.length ?? 0) > 0 || options.resolveApiKey !== undefined)
      && URL.canParse(options.baseURL)
      && isPositiveInteger(options.maxTokens)
      && isPositiveInteger(options.maxUses)
  }

  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    // One snapshot for the whole operation: credential resolution awaits, and a
    // settings write landing inside that await must not send the key resolved
    // from the old section to the endpoint named by the new one.
    // 整个操作只取一次快照：凭据解析是异步的，若在 await 期间落盘了新的设置写，
    // 绝不能把"旧 section 解析出的 key"发给"新 section 命名的端点"。
    const options = this.resolveOptions()
    const apiKey = await this.apiKey(options, signal)
    throwIfSearchAborted(signal)
    const endpoint = `${options.baseURL}/messages`
    const body: DeepSeekSearchLlmRequest['body'] = {
      model: options.model,
      max_tokens: options.maxTokens,
      messages: [{
        role: 'user',
        content: [{ type: 'text', text: `Perform a web search for the query: ${request.query}` }],
      }],
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: options.maxUses }],
    }
    options.recordRequest?.({
      endpoint,
      apiVersion: options.apiVersion,
      body,
    })
    throwIfSearchAborted(signal)
    let response: Response
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        redirect: 'error',
        headers: {
          // Official DeepSeek expects `x-api-key`; an Anthropic-compatible proxy
          // may expect `Authorization: Bearer` — send both so either resolves.
          // 官方 DeepSeek 认 x-api-key；Anthropic 兼容代理可能认 Authorization: Bearer——
          // 两个头都发，无论哪条通路都能解析。
          'x-api-key': apiKey,
          'authorization': `Bearer ${apiKey}`,
          'anthropic-version': options.apiVersion,
          'content-type': 'application/json',
          'accept': 'application/json',
          'user-agent': USER_AGENT,
        },
        body: JSON.stringify(body),
        ...signal !== undefined ? { signal } : {},
      })
    } catch (error: unknown) {
      if (signal?.aborted === true || isAbortError(error)) throw searchAborted(signal, error)
      throw new WebError(`DeepSeek search request failed: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
    }

    if (!response.ok) {
      const status = response.status
      let message = `DeepSeek API error (HTTP ${status})`
      try {
        const parsed = await response.json() as AnthropicError
        const detail = typeof parsed.error === 'string' ? parsed.error : parsed.error?.message ?? parsed.message
        if (detail !== undefined && detail.length > 0) message = detail
      } catch (error: unknown) {
        // An abort fired mid-body must surface as WEB_ABORTED, not be swallowed
        // into a generic HTTP-error message — cancellation is not a provider
        // error (the seam's cancellation contract).
        // 读取错误体中途发生的中止必须以 WEB_ABORTED 上报，不能吞进通用 HTTP 错误文案——
        // 取消不是提供者错误（seam 的取消契约）。
        if (signal?.aborted === true || isAbortError(error)) throw searchAborted(signal, error)
        // Otherwise: the HTTP status is already captured in `message` above; a
        // malformed/non-JSON error body (normal for gateway 5xx/429s) can only
        // cost a richer provider message, never the real error.
        // 其余情况：HTTP 状态已写入上面的 message；畸形/非 JSON 错误体（网关 5xx/429 常见）
        // 最多损失一条更丰富的提供者消息，绝不覆盖真实错误。
      }
      throw new WebError(message, 'WEB_PROVIDER_ERROR')
    }

    try {
      const payload = await response.json() as AnthropicResponse
      return mapAnthropicResponse(payload)
    } catch (error: unknown) {
      if (signal?.aborted === true || isAbortError(error)) throw searchAborted(signal, error)
      if (error instanceof WebError) throw error
      throw new WebError(`DeepSeek returned an unprocessable response body: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
    }
  }

  /**
   * Resolve one operation's credential without retaining it on the provider.
   * @param options - the caller's snapshot, so the key and the endpoint it is sent to come from one section.
   * @param signal - abort signal for the surrounding search.
   * @returns the resolved key.
   */
  // 解析一次操作的凭据，且不把密钥保存在提供者上。
  // 使用调用方快照，确保 key 与其将要发往的端点来自同一个 section。
  private async apiKey(options: DeepSeekSearchProviderOptions, signal?: AbortSignal): Promise<string> {
    throwIfSearchAborted(signal)
    if (options.apiKey !== undefined && options.apiKey.length > 0) return options.apiKey
    let resolved: string | undefined
    try {
      resolved = await abortable(options.resolveApiKey?.() ?? Promise.resolve(undefined), signal)
    } catch (error: unknown) {
      if (signal?.aborted === true || isAbortError(error)) throw searchAborted(signal, error)
      throw new WebError(
        `DeepSeek search credential resolution failed: ${String(error)}`,
        'WEB_PROVIDER_ERROR',
        { cause: error },
      )
    }
    if (resolved !== undefined && resolved.length > 0) return resolved
    const ref = options.apiKeyEnv ?? 'DEEPSEEK_API_KEY'
    throw new WebError(
      `DeepSeek search has no API key for "${ref}"; store it through the credentials service`
      + ' (the web Models page writes it), export it in the launching environment, or set a literal'
      + ' "apiKey" in the web-search-deepseek config',
      'WEB_PROVIDER_CREDENTIAL_MISSING',
    )
  }
}

/**
 * Race a same-process asynchronous preflight against caller cancellation. The
 * attached settlement handlers keep observing an uncooperative operation after
 * abort so a later rejection cannot become unhandled.
 */
// 让一个同进程异步预检与调用方取消进行竞速。附加的 settled 处理器会在中止后继续观察
// 不配合的操作，使迟到的 rejection 不会变成"未处理异常"。
function abortable<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal === undefined) return operation
  if (signal.aborted) return Promise.reject(searchAborted(signal))
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => { reject(searchAborted(signal)) }
    signal.addEventListener('abort', onAbort, { once: true })
    void operation.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort)
        reject(new Error(String(error).replace(/^Error: /u, ''), { cause: error }))
      },
    )
  })
}

/** Throw the provider's stable cancellation error when the caller already aborted. */
// 调用方已中止时，抛出提供者稳定的取消错误。
function throwIfSearchAborted(signal?: AbortSignal): void {
  if (signal?.aborted === true) throw searchAborted(signal)
}

/** Build the provider's stable cancellation error while retaining the caller's reason. */
// 构建提供者稳定的取消错误，同时保留调用方的取消原因。
function searchAborted(signal?: AbortSignal, fallback?: unknown): WebError {
  return new WebError('DeepSeek search aborted', 'WEB_ABORTED', {
    cause: signal?.aborted === true ? signal.reason : fallback,
  })
}

/** True for a fetch/`AbortSignal` abort, surfaced as `WEB_ABORTED`. */
// 是否是 fetch 或 AbortSignal 引发的中止，统一上报为 WEB_ABORTED。
function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

/** True for DeepSeek request limits that can be sent to the Messages API. */
// 是否是可以发给 Messages API 的请求限额（正整数）。
function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0
}
