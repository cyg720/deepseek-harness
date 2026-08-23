/**
 * ================================ 文件注释 ================================
 * 【文件职责】本文件是 dsh-web-search-exa 包的插件入口：把 Exa 搜索提供者注册进 ctx.web 的
 *             搜索注册表，并负责把插件配置与环境变量解析成提供者选项。
 * 【技术维度】函数/命名空间式 Cordis 插件（非默认导出服务）：导出 name/inject/Config/apply；
 *             配置经 schemastery 校验默认后交给 ExaSearchProvider。
 * 【产品维度】产品只要启用本插件即可获得 Exa 联网搜索能力；API key 可写配置或读
 *             $EXA_API_KEY 环境变量。
 * 【逻辑维度】导入提供者与常量 → 定义 Config → apply() 里组装选项并注册。
 * 【关键边界】注册进的是 seam 的提供者注册表，而不是占据 ctx.web 键本身（ctx.web 由 dsh-web
 *             拥有）；apiKey 为空时提供者 available() 返回 false。
 * 【新手阅读建议】先看 provider.ts 的 ExaSearchProvider，再看本文件 apply() 的参数装配。
 * ==========================================================================
 */
/**
 * `@deepseek-ai/dsh-web-search-exa`: registers an Exa-backed `WebSearchProvider`
 * with `ctx.web`. A function/namespace plugin (NOT a default-export service):
 * a search provider does not own the `ctx.web` key — it registers INTO the
 * seam's provider registry, exactly as `@deepseek-ai/dsh-llm-deepseek`
 * registers an adapter into `ctx.llm`. The key is owned by `@deepseek-ai/dsh-web`.
 *
 * @module @deepseek-ai/dsh-web-search-exa
 */

import type { Context } from '@deepseek-ai/cordis'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-web'
import {
  ExaSearchProvider,
  EXA_DEFAULT_BASE_URL,
  EXA_DEFAULT_HIGHLIGHTS_PER_RESULT,
  EXA_DEFAULT_SEARCH_TYPE,
} from './provider.ts'

export {
  EXA_DEFAULT_BASE_URL,
  EXA_DEFAULT_HIGHLIGHTS_PER_RESULT,
  EXA_DEFAULT_SEARCH_TYPE,
  EXA_PROVIDER_ID,
  ExaSearchProvider,
} from './provider.ts'
export type { ExaSearchProviderOptions } from './provider.ts'

/** Cordis plugin name used by loader diagnostics. */
// 插件名，供加载器日志与诊断使用。
export const name = 'web-search-exa'

/** The web seam this provider registers into. */
// 声明依赖：注册进 web seam。
export const inject = ['web']

/** Plugin config (all optional — `apply` fills env-var and constant defaults). */
// 插件配置：全部可选，apply() 会用环境变量与常量默认值补齐。
export interface Config {
  /** Exa API key. Falls back to `$EXA_API_KEY`. Empty → provider unavailable. */
  // Exa API key；缺省时回退读 $EXA_API_KEY 环境变量，仍为空则提供者不可用。
  apiKey?: string
  /** Endpoint base; `/search` is appended. Defaults to the public API. */
  // 端点基址；会拼接 /search。缺省用官方公共 API 地址。
  baseURL?: string
  /** Retrieval mode sent as Exa's `type`. Defaults to `auto`. */
  // 检索模式，随请求发给 Exa 的 type 字段；缺省为 auto。
  searchType?: 'auto' | 'keyword' | 'neural'
  /** Default result count when a request carries no `maxResults`. Omitted = none. */
  // 请求未带 maxResults 时的默认结果条数；省略则不发条数控制。
  numResults?: number
  /** Highlight sentences requested per result. Defaults to 1. */
  // 每条结果请求的高亮句子数；缺省为 1。
  highlightsPerResult?: number
}

// schemastery 配置 schema：为 Config 提供校验与默认值。
export const Config: z<Config> = z.object({
  apiKey: z.string(),
  baseURL: z.string(),
  searchType: z.union(['auto', 'keyword', 'neural'] as const),
  numResults: z.number().step(1).min(1),
  highlightsPerResult: z.number().step(1).min(1),
})

/** Register the Exa search provider with `ctx.web`. */
// 插件入口 apply：组装提供者选项并注册进 ctx.web 的搜索注册表。
export function apply(ctx: Context, config: Config): void {
  ctx.web.registerSearchProvider(new ExaSearchProvider({
    // Every environment layer may name this key: the product trusts the
    // project it is launched in, and the managed store is not involved here.
    // 各环境层都可以提供该 key：产品信任其启动所在项目，这里不涉及托管密钥库。
    apiKey: config.apiKey ?? launchEnvironmentOf(ctx).get('EXA_API_KEY')?.value ?? '',
    baseURL: config.baseURL ?? EXA_DEFAULT_BASE_URL,
    searchType: config.searchType ?? EXA_DEFAULT_SEARCH_TYPE,
    highlightsPerResult: config.highlightsPerResult ?? EXA_DEFAULT_HIGHLIGHTS_PER_RESULT,
    ...config.numResults !== undefined ? { numResults: config.numResults } : {},
  }))
}
