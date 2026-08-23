/**
 * ================================ 文件注释 ================================
 * 【文件职责】本文件定义 web 能力 seam（ctx.web）的全部对外类型词汇：搜索与抓取共享同一个
 *             seam，但各自拥有独立的请求、结果类型。
 * 【技术维度】纯 TypeScript 类型 + 一个继承自 HarnessError 的错误类，无任何运行时逻辑；
 *             闭式判别联合（WebFetchBody）配合 assertNever 实现"新增类型即编译报错"。
 * 【产品维度】搜索/抓取合并成一个 seam，使提供者选择、取消、错误、产品配置只有一个所有者，
 *             便于产品方统一治理联网能力。
 * 【逻辑维度】按出现顺序：搜索请求 → 搜索结果 → 来源 → 抓取请求 → 抓取结果 → 正文联合 →
 *             提供者接口（搜索/抓取）→ 统一错误类。
 * 【关键边界】WebFetchBody 是封闭联合，新增 kind 必须同步修改所有消费方；提供者接口要求
 *             available() 必须是廉价本地检查、禁止发网络请求。
 * 【新手阅读建议】先读 WebSearchRequest/WebSearchResult/WebFetchRequest/WebFetchResult 四个
 *             核心形状，再读 WebError，最后看两个提供者接口。
 * ==========================================================================
 */
/**
 * Vocabulary for the web capability seam (`ctx.web`). Search and fetch deliberately share one
 * seam so provider selection, cancellation, errors, and product configuration have one owner,
 * while retaining separate request and result types.
 * @module @deepseek-ai/dsh-web/types
 */

import { HarnessError } from '@deepseek-ai/dsh-llm'

/**
 * What one search-capable backend is asked to search. Each request carries one
 * query; a consumer may issue several requests. `maxResults` is a
 * `dsh-tool-web`-layer bound passed through unchanged and enforced on the way
 * back by the seam (see {@link WebSearchResult}).
 */
// 一次搜索请求：每个请求只带一个查询词，调用方可发多次请求。
// maxResults 由 dsh-tool-web 层传入，seam 原样透传并在返回时强制截断。
export interface WebSearchRequest {
  readonly query: string
  /**
   * Upper bound on returned sources; the seam truncates to it. Omitted = no
   * bound. `dsh-tool-web` always sets it. A provider whose API supports a
   * result-count control (Exa's `numResults`) should apply it at the request
   * layer as a cost/latency optimization; the seam enforces the bound
   * regardless.
   */
  // 返回来源条数的上限，超出的部分由 seam 截断；省略表示不设上限。
  // 提供方若支持条数控制（如 Exa 的 numResults），可在请求层使用以省成本、降延迟，
  // 但无论提供方是否截断，seam 都会再强制一次。
  readonly maxResults?: number
}

/**
 * Normalized search outcome. `content` is optional provider-generated answer
 * text or summary (Exa and DeepSeek return none; Perplexity returns a
 * generated answer).
 * `sources[]` is the portable citation shape. `truncated` is set by the seam
 * when it cut `sources[]` down to `maxResults`.
 */
// 归一化的搜索结果：content 是提供方生成的答案文本（可选），
// Exa 和 DeepSeek 不返回，Perplexity 会返回；sources 是可移植的引用列表；
// truncated 表示 seam 是否把 sources 截到了 maxResults。
export interface WebSearchResult {
  /** Optional provider-generated answer text, search context, or summary. */
  // 提供方生成的答案/摘要文本，可有可无。
  readonly content?: string
  /** Citeable sources, already truncated to the request's `maxResults`. */
  // 可引用的来源列表（已按请求的 maxResults 截断）。
  readonly sources: readonly WebSearchSource[]
  /** True when the seam dropped sources to honor `maxResults`. */
  // 为遵守 maxResults 而丢弃了部分来源时为 true。
  readonly truncated: boolean
}

/**
 * One citeable source. A source always has a URL; `title`, `snippet`, and
 * `publishedAt` are optional because not every provider returns them — forcing
 * adapters to invent them would make the seam lie (Perplexity citations may be
 * URL-only). `dsh-tool-web` renders `title ?? hostname(url)` for display.
 */
// 单个可引用来源：URL 必有；title/snippet/publishedAt 均可选，因为不是每家提供方
// 都返回这些字段——强行编造会让 seam 说谎（如 Perplexity 的引用可能只有 URL）。
// 展示层用"标题，缺省则取 URL 的主机名"兜底。
export interface WebSearchSource {
  readonly url: string
  readonly title?: string
  readonly snippet?: string
  /** Publication/crawl timestamp as a provider-supplied ISO-8601 string. */
  // 发布/抓取时间戳（提供方给出的 ISO-8601 字符串）。
  readonly publishedAt?: string
}

/**
 * What one fetch-capable backend is asked to retrieve. The request deliberately
 * omits timeout, format, prompt, and extraction controls: cancellation is a
 * direct execution argument, while presentation and higher-level LLM concerns
 * belong outside safe retrieval.
 */
// 一次抓取请求：刻意不含超时、格式、提示词、抽取等控制项——
// 取消是执行时的直接参数，展示与 LLM 相关的高级诉求不属于"安全抓取"的职责。
export interface WebFetchRequest {
  readonly url: string
}

/**
 * Normalized fetch outcome. A successful network fetch of a non-2xx response is
 * a result, not an error: the status code is part of the fetched resource
 * state. {@link WebError} is reserved for failures to safely retrieve or
 * represent the resource.
 */
// 归一化的抓取结果：成功抓到的非 2xx 响应也算"结果"而非错误（状态码属于资源状态的一部分）；
// WebError 只留给"无法安全抓取或表达资源"的失败。
export interface WebFetchResult {
  /** The final URL after allowed redirects (the request URL is in the request). */
  // 允许的重定向结束后的最终 URL（请求时的原始 URL 在请求里）。
  readonly url: string
  /** HTTP status code of the fetched response. */
  // 响应的 HTTP 状态码。
  readonly statusCode: number
  /** Decoded body, classified by content kind. */
  // 按内容类型分类解码后的正文。
  readonly body: WebFetchBody
  /** True when the provider capped the decoded body. */
  // 提供方截断了解码正文时为 true。
  readonly truncated: boolean
}

/**
 * The decoded body of a fetched resource. A CLOSED discriminated union owned by
 * `dsh-web`: the provider decodes the kind and `dsh-tool-web` renders it, so a
 * new kind is a coordinated change across known packages, not a plugin
 * extension. Consumers `switch` on `kind` ending in `default: assertNever(...)`
 * so adding a kind breaks compilation at every consumer until handled. Each arm
 * stays its own object literal even where fields coincide, so an arm can gain
 * fields the others lack.
 */
// 抓取正文的解码结果：这是一个由 dsh-web 拥有的"封闭"判别联合（kind 决定形状）。
// 提供方负责解码出 kind，dsh-tool-web 负责渲染，因此新增 kind 是跨已知包的协同改动，
// 而不是插件扩展点。消费方用 switch 按 kind 分支并以 assertNever 收尾，
// 一旦新增 kind，所有未处理的消费方都会编译失败。
export type WebFetchBody =
  | { readonly kind: 'html'; readonly content: string }
  | { readonly kind: 'text'; readonly content: string }

/**
 * A search-capable backend. Registered with `ctx.web.registerSearchProvider`.
 * `id` is a stable string, unique within the search capability kind.
 */
// 搜索型后端：通过 ctx.web.registerSearchProvider() 注册；id 是稳定字符串，
// 在"搜索"这一类能力内必须唯一。
export interface WebSearchProvider {
  readonly id: string
  /** Cheap local usability check; must not make network calls. */
  // 廉价的本地可用性检查：禁止发网络请求。
  available(): boolean
  /** Run one search; honor `signal` for cancellation. */
  // 执行一次搜索；必须尊重 signal 的取消请求。
  search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult>
}

/**
 * A fetch-capable backend. Registered with `ctx.web.registerFetchProvider`.
 * `id` is a stable string, unique within the fetch capability kind.
 */
// 抓取型后端：通过 ctx.web.registerFetchProvider() 注册；id 是稳定字符串，
// 在"抓取"这一类能力内必须唯一。
export interface WebFetchProvider {
  readonly id: string
  /** Cheap local usability check; must not make network calls. */
  // 廉价的本地可用性检查：禁止发网络请求。
  available(): boolean
  /** Retrieve one URL; honor `signal` for cancellation. */
  // 抓取一个 URL；必须尊重 signal 的取消请求。
  fetch(request: WebFetchRequest, signal?: AbortSignal): Promise<WebFetchResult>
}

/**
 * Typed web error with a machine-routable, open-string `code` and chained `cause`.
 * Consumers must tolerate provider-specific codes. Shared codes cover unavailable,
 * missing, unusable, ambiguous, or duplicate providers, cancellation, and provider failure;
 * the local fetch provider additionally distinguishes invalid or blocked URLs, redirects,
 * size and timeout limits, and unsupported content types. Tool execution exposes the code in
 * structured error metadata.
 */
// 带类型的 web 错误：code 是可机器路由的开放式字符串，cause 保留错误链。
// 消费方必须容忍提供方特有的 code。共享 code 覆盖：提供方不可用/缺失/不可用/歧义/重复、
// 取消、提供方失败；本地抓取提供方还细分了 URL 非法或被封禁、重定向、大小与超时限制、
// 不支持的 Content-Type。工具执行会把 code 暴露在结构化的错误元数据里。
export class WebError extends HarnessError {}
