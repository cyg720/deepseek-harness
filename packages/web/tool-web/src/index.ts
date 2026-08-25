/*
 * ================================ 文件注释 ================================
 * 【文件职责】本文件是 dsh-tool-web 包的插件入口：按配置启用面向模型的 web_search 与
 *             web_fetch 两个工具，并定义工具级的超时与输出上限默认值。
 * 【技术维度】函数式 Cordis 插件：导出 name/inject/Config/apply；用 schemastery 配置决定
 *             注册哪些工具；超时经 ToolDefinition.timeoutMs 交给超时策略插件执行。
 * 【产品维度】产品通过本包把联网能力暴露给模型：搜索与抓取的 schema、提示词、结果格式
 *             由本包负责，具体网络实现由下方 provider 包提供。
 * 【逻辑维度】默认常量 → Config → apply() 里校验正整数配置后按开关注册两个工具。
 * 【关键边界】启用与否只控制工具注册；提供者不可用时工具仍可见，执行时才报结构化错误。
 * 【新手阅读建议】先看 search.ts / fetch.ts 两个工具模块，再看本文件 apply() 的装配。
 * ==========================================================================
 */
/**
 * Model-facing `web_search` and `web_fetch` tools over `ctx.web`. This package owns schemas,
 * validation, prompt guidance, limits, and presentation, never concrete providers. Enablement
 * controls tool registration; an enabled tool remains visible when its provider is unavailable
 * and fails with a structured error at execution time.
 * @module @deepseek-ai/dsh-tool-web
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-web'
import { applyWebSearchTool, WEB_SEARCH_MAX_QUERIES, WEB_SEARCH_MAX_RESULTS } from './search.ts'
import { applyWebFetchTool } from './fetch.ts'

export { WEB_SEARCH_MAX_QUERIES, WEB_SEARCH_MAX_RESULTS, applyWebSearchTool, formatSearchOutput, presentSearchCall, presentSearchResult, searchMetaFromValue, searchMetaFromResult } from './search.ts'
export type { WebSearchMeta } from './search.ts'
export { applyWebFetchTool, formatFetchOutput, parseFetchArgs, presentFetchCall, presentFetchResult, fetchMetaFromValue, fetchMetaFromResult } from './fetch.ts'
export type { WebFetchMeta } from './fetch.ts'

/** Cordis plugin name used by loader diagnostics. */
// 插件名，供加载器日志与诊断使用。
export const name = 'tool-web'

/** Services required by the web tool suite. */
// 声明依赖：需要工具注册表、web seam、系统提示词注册表。
export const inject = ['tools', 'web', 'systemPrompt']

/** Default cooperative tool-call timeout budget (ms) for the web tools. */
// web 工具默认的协作式超时预算（毫秒）。
export const DEFAULT_WEB_TOOL_TIMEOUT_MS = 30_000

/**
 * Default cap on one `web_fetch` output and on source characters converted
 * synchronously. This leaves headroom above the local provider's default
 * 100,000-character body cap while bounding custom providers and rendered output.
 */
// 单次 web_fetch 输出与同步转换源字符的默认上限。比本地提供者的 10 万字符正文上限留出
// 余量，同时约束自定义提供者与渲染输出。
export const DEFAULT_FETCH_MAX_OUTPUT_CHARS = 200_000

/** Plugin config: which web tools to register, search bounds, per-tool budgets, and the fetch output cap. */
// 插件配置：注册哪些工具、搜索上限、各工具预算与抓取输出上限。
export interface Config {
  /** Register `web_search`. Defaults to true. */
  // 是否注册 web_search；缺省为 true。
  search?: boolean
  /** Register `web_fetch`. Defaults to true. */
  // 是否注册 web_fetch；缺省为 true。
  fetch?: boolean
  /** Upper bound on sources returned by one `web_search` call. */
  // 单次 web_search 调用返回来源条数的上限。
  searchMaxResults?: number
  /** Upper bound on queries accepted by one `web_search` call. */
  // 单次 web_search 调用接受的查询词数量上限。
  searchMaxQueries?: number
  /** Cooperative timeout budget (ms) for `web_fetch`. Defaults to 30000. */
  // web_fetch 的协作式超时预算（毫秒）；缺省 30000。
  fetchTimeoutMs?: number
  /** Cooperative timeout budget (ms) for `web_search`. Defaults to 30000. */
  // web_search 的协作式超时预算（毫秒）；缺省 30000。
  searchTimeoutMs?: number
  /** Cap on source characters converted and complete `web_fetch` output characters. Defaults to 200000. */
  // 同步转换的源字符数与完整 web_fetch 输出字符数的上限；缺省 200000。
  fetchMaxOutputChars?: number
}

// schemastery 配置 schema：为 Config 提供校验与默认值。
export const Config: z<Config> = z.object({
  search: z.boolean().default(true),
  fetch: z.boolean().default(true),
  searchMaxResults: z.number().default(WEB_SEARCH_MAX_RESULTS),
  searchMaxQueries: z.number().default(WEB_SEARCH_MAX_QUERIES),
  fetchTimeoutMs: z.number().default(DEFAULT_WEB_TOOL_TIMEOUT_MS),
  searchTimeoutMs: z.number().default(DEFAULT_WEB_TOOL_TIMEOUT_MS),
  fetchMaxOutputChars: z.number().default(DEFAULT_FETCH_MAX_OUTPUT_CHARS),
})

/** Complete config after schemastery applies every field default. */
// schemastery 应用全部默认值后的完整配置类型。
type ResolvedConfig = Required<Config>

/** Configured count, timeout, and character caps must be positive integers. */
// 配置的条数、超时与字符上限必须是正整数。
function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`tool-web: ${name} must be a positive integer`)
  }
}

/**
 * Register the enabled web tools. `search`/`fetch` default to true; a product
 * that wants only one disables the other in config. Each tool's cooperative
 * timeout budget (`fetchTimeoutMs`/`searchTimeoutMs`, default 30000) is resolved
 * here and attached to the tool as `ToolDefinition.timeoutMs` for
 * `@deepseek-ai/dsh-tool-call-timeout-policy` to enforce. The tools' disposers are
 * fiber-scoped (the effect-based registries clean up on dispose), so no manual
 * teardown is needed.
 */
// 插件入口 apply：校验配置后按开关注册启用的工具。每个工具的协作式超时预算在这里解析，
// 以 ToolDefinition.timeoutMs 形式挂到工具上，交给超时策略插件强制；工具注册基于 effect，
// 插件销毁时自动清理，无需手动拆除。
export function apply(ctx: Context, config: Config): void {
  // schemastery (Config) has already filled every defaulted field.
  // schemastery 已经填好全部默认字段，这里直接按完整配置使用。
  const resolved = config as ResolvedConfig
  assertPositiveInteger('searchMaxResults', resolved.searchMaxResults)
  assertPositiveInteger('searchMaxQueries', resolved.searchMaxQueries)
  assertPositiveInteger('fetchTimeoutMs', resolved.fetchTimeoutMs)
  assertPositiveInteger('searchTimeoutMs', resolved.searchTimeoutMs)
  assertPositiveInteger('fetchMaxOutputChars', resolved.fetchMaxOutputChars)
  if (resolved.search) {
    applyWebSearchTool(ctx, resolved.searchMaxResults, resolved.searchMaxQueries, resolved.searchTimeoutMs, resolved.fetch)
  }
  if (resolved.fetch) applyWebFetchTool(ctx, resolved.fetchTimeoutMs, resolved.fetchMaxOutputChars)
}
