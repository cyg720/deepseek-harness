/*
 * ================================ 文件注释 ================================
 * 【文件职责】本文件是 web 能力 seam 的实现：ctx.web 服务。它持有搜索/抓取提供者的注册表，
 *             在调用时刻按规则选出一个提供者执行请求，并对搜索结果强制 maxResults 上限。
 * 【技术维度】继承 Cordis Service 的服务类；注册用 ctx.effect() 管理生命周期（返回释放函数）；
 *             提供者选择完全在调用时解析，与注册顺序无关。
 * 【产品维度】把"选哪个联网后端"与"具体怎么联网"解耦：产品通过 searchProvider/fetchProvider
 *             配置或环境变量固定选择，其余情况按可用性自动挑选。
 * 【逻辑维度】Selection 输入 → WebRuntimeConfig → WebRuntime 类（注册/搜索/抓取）→
 *             resolveProvider（选择规则）→ capSources（截断）。
 * 【关键边界】同一能力下重复 id 注册抛 WEB_DUPLICATE_PROVIDER；未配置且多个可用提供者时
 *             抛歧义错误而不是静默选第一个；环境变量与配置字段等价，没有隐藏优先级链。
 * 【新手阅读建议】先读 resolveProvider 的选择规则（六种分支），再看 capSources，
 *             最后回读类的方法。
 * ==========================================================================
 */
/**
 * Service Definition for the web access capability seam (`ctx.web`): registries and provider-selecting execution for search and
 * fetch. Duplicate ids are rejected. At execution time, a configured provider must exist and
 * be usable; without one, exactly one usable provider is required, so selection never depends
 * on registration order.
 * @module @deepseek-ai/dsh-web
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {
  WebFetchProvider,
  WebFetchRequest,
  WebFetchResult,
  WebSearchProvider,
  WebSearchRequest,
  WebSearchResult,
} from './types.ts'
import { WebError } from './types.ts'

export {
  WebError,
} from './types.ts'
export type {
  WebFetchBody,
  WebFetchProvider,
  WebFetchRequest,
  WebFetchResult,
  WebSearchProvider,
  WebSearchRequest,
  WebSearchResult,
  WebSearchSource,
} from './types.ts'

// 类型合并：把 ctx.web 声明进 Cordis 的 Context 接口，使所有插件都能通过 ctx.web 访问本服务。
declare module '@deepseek-ai/cordis' {
  interface Context {
    web: WebRuntime
  }
}

/** Selection inputs for execution-time provider resolution. */
// 执行时刻"提供者选择"的输入。
interface Selection<P> {
  /** The configured provider id for this capability, if any. */
  // 配置的提供者 id（若有）。
  readonly configuredId?: string
  /** Providers registered for this capability kind. */
  // 本能力种类下已注册的提供者集合（按 id 索引）。
  readonly providers: ReadonlyMap<string, P>
}

/**
 * Config for the web seam. `searchProvider` / `fetchProvider` pin which provider
 * wins for each capability; both are optional (a single registered usable
 * provider auto-selects). Operational overrides such as environment variables
 * must feed these same fields rather than introduce a hidden priority chain.
 */
// web seam 的配置：searchProvider / fetchProvider 分别钉死搜索与抓取用哪个提供者；
// 两者都可选（只有一个可用提供者时自动选中）。环境变量等运维覆盖必须流入这两个字段，
// 而不是另立一条隐藏的优先级链。
export interface WebRuntimeConfig {
  /** Explicit search provider id. Omitted = auto-select when exactly one usable. */
  // 显式搜索提供者 id；省略时在"恰好一个可用提供者"的情况下自动选择。
  readonly searchProvider?: string
  /** Explicit fetch provider id. Omitted = auto-select when exactly one usable. */
  // 显式抓取提供者 id；省略时在"恰好一个可用提供者"的情况下自动选择。
  readonly fetchProvider?: string
}

/**
 * The web access service. Registered as `ctx.web` (one instance per context).
 *
 * Selection semantics (resolved at execution time, never order-dependent):
 * - A configured id that is registered and `available()` → that provider.
 * - A configured id not registered → `WEB_PROVIDER_CONFIGURED_MISSING`.
 * - A configured id registered but unavailable →
 *   `WEB_PROVIDER_CONFIGURED_UNAVAILABLE`.
 * - No id configured, exactly one registered usable provider → that provider.
 * - No id configured, multiple usable providers → `WEB_PROVIDER_AMBIGUOUS`.
 * - No id configured, no usable provider → `WEB_PROVIDER_UNAVAILABLE`.
 */
// web 访问服务，注册为 ctx.web（每个 context 一个实例）。
// 选择语义（执行时解析，绝不依赖注册顺序）：
// - 配置了 id 且已注册且可用 → 用它；
// - 配置了 id 但未注册 → WEB_PROVIDER_CONFIGURED_MISSING；
// - 配置了 id 但不可用 → WEB_PROVIDER_CONFIGURED_UNAVAILABLE；
// - 未配置且恰好一个可用 → 用它；
// - 未配置且有多个可用 → WEB_PROVIDER_AMBIGUOUS；
// - 未配置且无可用 → WEB_PROVIDER_UNAVAILABLE。
export class WebRuntime extends Service {
  /**
   * Provider selection config. Operational env overrides feed the SAME fields:
   * `$DSH_WEB_SEARCH_PROVIDER` / `$DSH_WEB_FETCH_PROVIDER` are equivalent to
   * `searchProvider` / `fetchProvider` and are NOT a hidden priority chain.
   */
  // 提供者选择配置。运维环境变量覆盖同一组字段：$DSH_WEB_SEARCH_PROVIDER 与
  // $DSH_WEB_FETCH_PROVIDER 分别等价于 searchProvider / fetchProvider，不是隐藏优先级链。
  static Config: z<WebRuntimeConfig> = z.object({
    searchProvider: z.string(),
    fetchProvider: z.string(),
  })

  private searchProviders = new Map<string, WebSearchProvider>()
  private fetchProviders = new Map<string, WebFetchProvider>()
  private readonly searchProviderId: string | undefined
  private readonly fetchProviderId: string | undefined

  constructor(ctx: Context, config: WebRuntimeConfig = {}) {
    super(ctx, 'web')
    this.searchProviderId = config.searchProvider ?? process.env.DSH_WEB_SEARCH_PROVIDER
    this.fetchProviderId = config.fetchProvider ?? process.env.DSH_WEB_FETCH_PROVIDER
  }

  /**
   * Register a search provider. Throws {@link WebError} `WEB_DUPLICATE_PROVIDER`
   * if its id is already registered for search. Returns a disposer; disposed
   * with the calling fiber.
   * @param provider - the provider; its `id` is the registry key.
   * @returns the disposer that unregisters the provider.
   */
  // 注册一个搜索提供者：id 重复时抛 WEB_DUPLICATE_PROVIDER；返回的释放函数随调用方
  // fiber 一起销毁（取消注册）。
  registerSearchProvider(provider: WebSearchProvider): () => void {
    return this.registerProvider(this.searchProviders, provider)
  }

  /**
   * Register a fetch provider. Throws {@link WebError} `WEB_DUPLICATE_PROVIDER`
   * if its id is already registered for fetch. Returns a disposer; disposed
   * with the calling fiber.
   * @param provider - the provider; its `id` is the registry key.
   * @returns the disposer that unregisters the provider.
   */
  // 注册一个抓取提供者：id 重复时抛 WEB_DUPLICATE_PROVIDER；返回的释放函数随调用方
  // fiber 一起销毁（取消注册）。
  registerFetchProvider(provider: WebFetchProvider): () => void {
    return this.registerProvider(this.fetchProviders, provider)
  }

  private registerProvider<P extends { readonly id: string }>(store: Map<string, P>, provider: P): () => void {
    if (store.has(provider.id)) {
      throw new WebError(`a web provider with id "${provider.id}" is already registered`, 'WEB_DUPLICATE_PROVIDER')
    }
    const dispose = this.ctx.effect(function* () {
      store.set(provider.id, provider)
      yield () => store.delete(provider.id)
    }, 'web.registerProvider()')
    // ctx.effect's disposer returns Promise<void>; our disposer API is
    // synchronous fire-and-forget — discard the (always-resolved) promise.
    // ctx.effect 的释放器返回 Promise，而本 API 的释放器是同步的即发即忘——
    // 直接丢弃这个（总是已 resolve 的）Promise。
    return () => void dispose()
  }

  /**
   * Run one search through the selected provider. Resolves the provider at call
   * time with the selection rules above; throws {@link WebError} when the
   * capability cannot run. The seam enforces `request.maxResults` on the result:
   * if the provider over-returns, `sources[]` is truncated and `truncated` set.
   * @param request - the query and optional result limit.
   * @param signal - optional cancellation signal forwarded to the provider.
   * @returns the provider's results, capped to `request.maxResults`.
   */
  // 通过选中的提供者执行一次搜索。调用时按上述规则解析提供者，无法执行时抛 WebError。
  // seam 对结果强制 maxResults：提供者多返回时截断 sources 并置 truncated。
  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    const provider = resolveProvider({
      providers: this.searchProviders,
      ...this.searchProviderId !== undefined ? { configuredId: this.searchProviderId } : {},
    })
    const result = await provider.search(request, signal)
    return capSources(result, request.maxResults)
  }

  /**
   * Retrieve one URL through the selected provider. Resolves the provider at
   * call time with the selection rules above; throws {@link WebError} when the
   * capability cannot run. A non-2xx response is a result, not a throw.
   * @param request - the URL plus retrieval options.
   * @param signal - optional cancellation signal forwarded to the provider.
   * @returns the retrieval outcome; non-2xx responses resolve descriptively.
   */
  // 通过选中的提供者抓取一个 URL。调用时按上述规则解析提供者；非 2xx 响应是结果而非异常。
  async fetch(request: WebFetchRequest, signal?: AbortSignal): Promise<WebFetchResult> {
    const provider = resolveProvider({
      providers: this.fetchProviders,
      ...this.fetchProviderId !== undefined ? { configuredId: this.fetchProviderId } : {},
    })
    return provider.fetch(request, signal)
  }
}

// 可解析的提供者公共形状：带 id，且能本地回答"当前是否可用"。
interface ResolvableProvider {
  readonly id: string
  available(): boolean
}

/** Resolve the selected provider or throw the matching {@link WebError}. */
// 解析选中的提供者，六种分支，不匹配时抛出对应的 WebError。
function resolveProvider<P extends ResolvableProvider>(selection: Selection<P>): P {
  const { configuredId, providers } = selection
  if (configuredId !== undefined) {
    const provider = providers.get(configuredId)
    if (!provider) {
      throw new WebError(`configured web provider "${configuredId}" is not registered`, 'WEB_PROVIDER_CONFIGURED_MISSING')
    }
    if (!provider.available()) {
      throw new WebError(`configured web provider "${configuredId}" is registered but unavailable`, 'WEB_PROVIDER_CONFIGURED_UNAVAILABLE')
    }
    return provider
  }
  const usable = [...providers.values()].filter(provider => provider.available())
  const [single] = usable
  if (single === undefined) {
    throw new WebError('no usable web provider is registered', 'WEB_PROVIDER_UNAVAILABLE')
  }
  if (usable.length > 1) {
    const ids = usable.map(provider => provider.id).join(', ')
    throw new WebError(`multiple usable web providers are registered (${ids}); configure one explicitly`, 'WEB_PROVIDER_AMBIGUOUS')
  }
  return single
}

/** Enforce `maxResults` on a search result: truncate `sources[]` and flag it. */
// 对搜索结果强制 maxResults：超限则截断 sources 并置 truncated 标记。
function capSources(result: WebSearchResult, maxResults: number | undefined): WebSearchResult {
  if (maxResults === undefined || result.sources.length <= maxResults) return result
  return { ...result, sources: result.sources.slice(0, maxResults), truncated: true }
}

export default WebRuntime
