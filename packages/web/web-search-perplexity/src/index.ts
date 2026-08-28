/*
 * ================================ 文件注释 ================================
 * 【文件职责】本文件是 dsh-web-search-perplexity 包的插件入口：把 Perplexity 搜索提供者
 *             注册进 ctx.web 的搜索注册表，并负责把插件配置与环境变量解析成提供者选项。
 * 【技术维度】函数/命名空间式 Cordis 插件：导出 name/inject/Config/apply；配置经 schemastery
 *             校验默认后交给 PerplexitySearchProvider。
 * 【产品维度】产品启用本插件即获得 Perplexity 联网搜索（生成式回答 + 引用）；API key 可写
 *             配置或读 $PERPLEXITY_API_KEY 环境变量。
 * 【逻辑维度】导入提供者与常量 → 定义 Config → apply() 里组装选项并注册。
 * 【关键边界】注册进的是 seam 的提供者注册表而非 ctx.web 键本身；apiKey 为空时提供者
 *             available() 返回 false。
 * 【新手阅读建议】先看 provider.ts 的 PerplexitySearchProvider，再看本文件 apply() 的装配。
 * ==========================================================================
 */
/**
 * Perplexity-backed `WebSearchProvider` plugin. It contributes to the
 * `ctx.web` registry without owning the service.
 *
 * @module @deepseek-ai/dsh-web-search-perplexity
 */

import type { Context } from '@deepseek-ai/cordis'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-web'
import { PerplexitySearchProvider, PERPLEXITY_DEFAULT_BASE_URL, PERPLEXITY_DEFAULT_MAX_TOKENS, PERPLEXITY_DEFAULT_MODEL } from './provider.ts'

export {
  PERPLEXITY_DEFAULT_BASE_URL,
  PERPLEXITY_DEFAULT_MAX_TOKENS,
  PERPLEXITY_DEFAULT_MODEL,
  PERPLEXITY_PROVIDER_ID,
  PerplexitySearchProvider,
} from './provider.ts'
export type { PerplexityRecency, PerplexitySearchProviderOptions } from './provider.ts'

/** Cordis plugin name used by loader diagnostics. */
// 插件名，供加载器日志与诊断使用。
export const name = 'web-search-perplexity'

/** The web seam this provider registers into. */
// 声明依赖：注册进 web seam。
export const inject = ['web']

/** Plugin config (all optional — `apply` fills env-var and constant defaults). */
// 插件配置：全部可选，apply() 会用环境变量与常量默认值补齐。
export interface Config {
  /** Perplexity API key. Falls back to `$PERPLEXITY_API_KEY`. Empty → unavailable. */
  // Perplexity API key；缺省时回退读 $PERPLEXITY_API_KEY 环境变量，仍为空则不可用。
  apiKey?: string
  /** Endpoint base; `/chat/completions` is appended. Defaults to the public API. */
  // 端点基址；会拼接 /chat/completions。缺省用官方公共 API 地址。
  baseURL?: string
  /** Search model name. Defaults to `sonar`. */
  // 搜索模型名；缺省为 sonar。
  model?: string
  /** Upper bound on generated answer tokens. Defaults to 1024. */
  // 生成回答的 token 上限；缺省为 1024。
  maxTokens?: number
  /** Recency window sent as `search_recency_filter`. Omitted = no filter. */
  // 时效过滤窗口，随请求发给 search_recency_filter；省略则不设过滤。
  searchRecency?: 'day' | 'week' | 'month' | 'year'
}

// schemastery 配置 schema：为 Config 提供校验与默认值。
export const Config: z<Config> = z.object({
  apiKey: z.string(),
  baseURL: z.string(),
  model: z.string(),
  maxTokens: z.number().step(1).min(1),
  searchRecency: z.union(['day', 'week', 'month', 'year'] as const),
})

/** Register the Perplexity search provider with `ctx.web`. */
// 插件入口 apply：组装提供者选项并注册进 ctx.web 的搜索注册表。
export function apply(ctx: Context, config: Config): void {
  ctx.web.registerSearchProvider(new PerplexitySearchProvider({
    // Every environment layer may name this key: the product trusts the
    // project it is launched in, and the managed store is not involved here.
    // 各环境层都可以提供该 key：产品信任其启动所在项目，这里不涉及托管密钥库。
    apiKey: config.apiKey ?? launchEnvironmentOf(ctx).get('PERPLEXITY_API_KEY')?.value ?? '',
    baseURL: config.baseURL ?? PERPLEXITY_DEFAULT_BASE_URL,
    model: config.model ?? PERPLEXITY_DEFAULT_MODEL,
    maxTokens: config.maxTokens ?? PERPLEXITY_DEFAULT_MAX_TOKENS,
    ...config.searchRecency !== undefined ? { searchRecency: config.searchRecency } : {},
  }))
}
