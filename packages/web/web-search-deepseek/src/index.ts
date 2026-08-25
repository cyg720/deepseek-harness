/*
 * ================================ 文件注释 ================================
 * 【文件职责】本文件是 dsh-web-search-deepseek 包的插件入口：把 DeepSeek 搜索提供者注册进
 *             ctx.web 的搜索注册表，并把插件配置、设置面板、环境变量解析成提供者选项。
 * 【技术维度】函数式 Cordis 插件：导出 name/inject/Config/apply；用 settings 服务的设置面板
 *             承载可热更新的端点/模型配置；每次搜索前动态解析选项。
 * 【产品维度】复用 DeepSeek API key 即可获得 DeepSeek 原生联网搜索；端点可用独立的
 *             $DEEPSEEK_SEARCH_BASE_URL 环境变量或设置面板覆盖。
 * 【逻辑维度】插件三要素 → 配置 schema → 环境变量名与设置命名空间 → resolveOptions() 解析 →
 *             apply() 安装设置面板并注册提供者。
 * 【关键边界】搜索走 Anthropic 兼容 Messages API，与聊天补全的 $DEEPSEEK_BASE_URL 不同源，
 *             因此不复用该变量；提供者每次搜索都重新解析配置以支持设置热更新。
 * 【新手阅读建议】先看 provider.ts 的 DeepSeekSearchProvider 与 resolveOptions 的对应关系。
 * ==========================================================================
 */
/**
 * Register a DeepSeek-backed provider in `ctx.web`. It calls the Anthropic-compatible Messages API
 * with native `web_search_20250305`. The provider reuses `DEEPSEEK_API_KEY` but not
 * `DEEPSEEK_BASE_URL`, because search and chat-completions use different bases.
 * @module @deepseek-ai/dsh-web-search-deepseek
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-agent'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-web'
import {
  DeepSeekSearchProvider,
  DEEPSEEK_DEFAULT_API_VERSION,
  DEEPSEEK_DEFAULT_BASE_URL,
  DEEPSEEK_DEFAULT_MAX_TOKENS,
  DEEPSEEK_DEFAULT_MAX_USES,
  DEEPSEEK_DEFAULT_MODEL,
} from './provider.ts'
import type { DeepSeekSearchProviderOptions } from './provider.ts'

export {
  DeepSeekSearchProvider,
  DEEPSEEK_DEFAULT_API_VERSION,
  DEEPSEEK_DEFAULT_BASE_URL,
  DEEPSEEK_DEFAULT_MAX_TOKENS,
  DEEPSEEK_DEFAULT_MAX_USES,
  DEEPSEEK_DEFAULT_MODEL,
  DEEPSEEK_PROVIDER_ID,
} from './provider.ts'
export type { DeepSeekSearchLlmRequest, DeepSeekSearchProviderOptions } from './provider.ts'

/** Cordis plugin name used by loader diagnostics. */
// 插件名，供加载器日志与诊断使用。
export const name = 'web-search-deepseek'

/** The web seam this provider registers into. */
// 声明依赖：注册进 web seam。
export const inject = ['web']

// 默认的 API key 环境变量名。
const DEFAULT_API_KEY_ENV = 'DEEPSEEK_API_KEY'

/** Plugin config (all optional — `apply` fills env-var and constant defaults). */
// 插件配置：全部可选，apply() 会用环境变量与常量默认值补齐。
export interface Config {
  /** Literal DeepSeek API key; prefer {@link apiKeyEnv} so no secret enters configuration files. */
  // 字面量 API key；优先用 apiKeyEnv 引用凭据，避免把密钥写进配置文件。
  apiKey?: string
  /** Credential reference resolved for each search; defaults to `DEEPSEEK_API_KEY`. */
  // 每次搜索时解析的凭据引用；缺省为 DEEPSEEK_API_KEY。
  apiKeyEnv?: string
  /** Anthropic-compatible endpoint base; `/messages` is appended. */
  // Anthropic 兼容端点基址；会拼接 /messages。
  baseURL?: string
  /** Anthropic-format model name. Defaults to `deepseek-v4-flash`. */
  // Anthropic 格式的模型名；缺省为 deepseek-v4-flash。
  model?: string
  /** `anthropic-version` header value. Defaults to `2023-06-01`. */
  // anthropic-version 请求头取值；缺省为 2023-06-01。
  apiVersion?: string
  /** Upper bound on generated tokens for the Messages request. Defaults to 4096. */
  // Messages 请求的生成 token 上限；缺省为 4096。
  maxTokens?: number
  /** Maximum `web_search` server-tool uses per request. Defaults to 5. */
  // 每次请求中 web_search 服务端工具的最大使用次数；缺省为 5。
  maxUses?: number
}

// schemastery 配置 schema：为 Config 提供校验、默认值与元数据角色。
export const Config: z<Config> = z.object({
  apiKey: z.string().role('secret'),
  apiKeyEnv: z.string().role('credential-ref').default(DEFAULT_API_KEY_ENV),
  // Declared here rather than only at the use site: a configuration surface
  // renders the resolved section, so a default the schema does not carry reads
  // there as no value at all.
  // 在 schema 里声明（而不只在用点声明）：设置面板会渲染解析后的 section，
  // 若 schema 不带默认值，面板上就读不到任何值。
  baseURL: z.string(),
  model: z.string().default(DEEPSEEK_DEFAULT_MODEL),
  apiVersion: z.string().default(DEEPSEEK_DEFAULT_API_VERSION),
  maxTokens: z.number().step(1).min(1).default(DEEPSEEK_DEFAULT_MAX_TOKENS),
  maxUses: z.number().step(1).min(1).default(DEEPSEEK_DEFAULT_MAX_USES),
})

/**
 * Environment variable naming this provider's endpoint. Deliberately distinct
 * from `$DEEPSEEK_BASE_URL`, which belongs to the chat-completions adapter:
 * search speaks the Anthropic-compatible Messages API, so one variable cannot
 * serve both.
 */
// 指定本提供者端点的环境变量名。刻意与聊天补全适配器使用的 $DEEPSEEK_BASE_URL 区分开：
// 搜索走 Anthropic 兼容 Messages API，同一个变量无法同时服务两种协议。
const SEARCH_BASE_URL_ENV = 'DEEPSEEK_SEARCH_BASE_URL'

/** Settings namespace carrying this provider's endpoint, model, and key reference. */
// 承载本提供者端点、模型与 key 引用的设置命名空间。
export const WEB_SEARCH_DEEPSEEK_SETTINGS_NAMESPACE = settingsNamespace('web-search-deepseek')

/**
 * Project one resolved section into the options the provider serves its next
 * search with. Environment fallbacks stay here rather than in the provider:
 * every value it reads is already fully defaulted.
 * @param ctx - plugin context supplying the credential and environment planes.
 * @param config - the currently authoritative section.
 * @returns options for one search.
 */
// 把一份已解析的设置 section 投影为提供者下一次搜索所用的选项。
// 环境变量回退集中在这里而非提供者内部，保证提供者读到的值都已完全默认化。
function resolveOptions(ctx: Context, config: Config): DeepSeekSearchProviderOptions {
  const apiKeyEnv = credentialRef(config.apiKeyEnv ?? DEFAULT_API_KEY_ENV)
  const literalApiKey = config.apiKey !== undefined && config.apiKey.length > 0
    ? config.apiKey
    : undefined
  return {
    ...literalApiKey === undefined ? {} : { apiKey: literalApiKey },
    // 解析器：优先用凭据服务，缺失时回退到启动环境变量。
    resolveApiKey: async () => {
      const credentials = ctx.get('credentials')
      if (credentials !== undefined) return (await credentials.resolve(apiKeyEnv))?.value
      // Without the seam the environment is the whole credential plane.
      // 没有凭据服务时，环境变量就是完整的凭据平面。
      const ambient = launchEnvironmentOf(ctx).get(apiKeyEnv)
      return ambient !== undefined && ambient.value.length > 0 ? ambient.value : undefined
    },
    apiKeyEnv,
    baseURL: config.baseURL
      ?? launchEnvironmentOf(ctx).get(SEARCH_BASE_URL_ENV)?.value
      ?? DEEPSEEK_DEFAULT_BASE_URL,
    model: config.model ?? DEEPSEEK_DEFAULT_MODEL,
    apiVersion: config.apiVersion ?? DEEPSEEK_DEFAULT_API_VERSION,
    maxTokens: config.maxTokens ?? DEEPSEEK_DEFAULT_MAX_TOKENS,
    maxUses: config.maxUses ?? DEEPSEEK_DEFAULT_MAX_USES,
    // 请求记录器：把无密钥的请求体写入当前代理的会话日志（模型可见输入必须可还原）。
    recordRequest: (request) => {
      ctx.get('agents')?.currentInitiator()?.session.append(
        'web/deepseek-search-llm-request',
        request,
      )
    },
  }
}

/** Register the DeepSeek search provider with `ctx.web`. */
// 插件入口 apply：安装设置面板并注册提供者；配置变更无需重新注册（提供者每次搜索重新解析）。
export function apply(ctx: Context, config: Config): void {
  let current: () => Config = () => config
  installSettingsSection(ctx, WEB_SEARCH_DEEPSEEK_SETTINGS_NAMESPACE, Config, config, {
    setSource: (source) => {
      current = source
    },
    // The registration carries no resolved value: the provider projects the
    // section per search, so a committed change needs no re-registration.
    // 注册时并不携带解析后的值：提供者按次搜索投影 section，提交变更无需重新注册。
    onChange: () => {},
  })
  ctx.web.registerSearchProvider(new DeepSeekSearchProvider(() => resolveOptions(ctx, current())))
}
