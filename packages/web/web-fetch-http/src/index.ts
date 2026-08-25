/*
 * ================================ 文件注释 ================================
 * 【文件职责】本文件是 dsh-web-fetch-http 包的插件入口：把本地 HTTP(S) 抓取提供者注册进
 *             ctx.web 的抓取注册表，并负责校验与装配抓取限额配置。
 * 【技术维度】函数/命名空间式 Cordis 插件：导出 name/inject/Config/apply；配置经 schemastery
 *             默认后，先做"正有限数/非负整数/超时上限"校验，再构造 HttpFetchProvider。
 * 【产品维度】提供一个匿名公共 HTTP(S) 抓取实现，与各家搜索提供者并列注册，
 *             产品可开箱即用地抓取网页内容。
 * 【逻辑维度】默认常量与 User-Agent → Config → 三个校验函数 → apply() 校验并注册。
 * 【关键边界】必须保持"函数式插件"形态（注册进 seam 的抓取注册表，不占 ctx.web 键）；
 *             超时值不得超过 Node 定时器上限，否则会被强制成 1ms。
 * 【新手阅读建议】先看 provider.ts 的 HttpFetchProvider 与 policy.ts 的纯函数，
 *             再看本文件 apply() 的配置装配。
 * ==========================================================================
 */
/**
 * `@deepseek-ai/dsh-web-fetch-http`: registers an anonymous public HTTP(S)
 * `WebFetchProvider` with `ctx.web`. A function/namespace plugin (NOT a
 * default-export service): it registers INTO the seam's fetch registry, like the
 * search providers register into the search registry.
 *
 * @module @deepseek-ai/dsh-web-fetch-http
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-web'
import { HttpFetchProvider } from './provider.ts'
import type { HttpFetchLimits } from './provider.ts'

// Node 定时器允许的最大延迟（约 24.8 天），超过会被强制视为 1ms。
const MAX_NODE_TIMER_DELAY_MS = 2_147_483_647

export {
  LOCAL_FETCH_PROVIDER_ID,
  HttpFetchProvider,
} from './provider.ts'
export type { HttpFetchLimits } from './provider.ts'

/** Default `User-Agent`: an explicit product agent, never a browser disguise. */
// 默认 User-Agent：明确的"产品代理"身份，绝不伪装成浏览器。
export const DEFAULT_USER_AGENT = 'deepseek-harness/0.0.1 (+https://github.com/deepseek-ai)'

/** Cordis plugin name used by loader diagnostics. */
// 插件名，供加载器日志与诊断使用。
export const name = 'web-fetch-http'

/** The web seam this provider registers into. */
// 声明依赖：注册进 web seam。
export const inject = ['web']

/** Plugin config: the provider's transport and size limits plus its `User-Agent` (all defaulted). */
// 插件配置：传输与大小限额、User-Agent（全部有默认值）。
export interface Config {
  /** Maximum accepted request URL length. */
  // 请求 URL 的最大长度。
  maxUrlLength?: number
  /** Maximum response body size in bytes. */
  // 响应体最大字节数。
  maxResponseBytes?: number
  /** Maximum decoded body length in characters. */
  // 解码后正文的最大字符数。
  maxBodyChars?: number
  /** Default fetch timeout in milliseconds, within Node's timer range. */
  // 默认抓取超时（毫秒），须在 Node 定时器范围内。
  timeoutMs?: number
  /** Maximum number of same-origin redirect hops to follow. */
  // 最多跟随的同源重定向跳数。
  maxRedirects?: number
  /** `User-Agent` header sent on every request. */
  // 每次请求发送的 User-Agent 头。
  userAgent?: string
}

// schemastery 配置 schema：为 Config 提供校验与默认值。
export const Config: z<Config> = z.object({
  maxUrlLength: z.number().default(2048),
  maxResponseBytes: z.number().default(5_000_000),
  maxBodyChars: z.number().default(100_000),
  timeoutMs: z.number().default(30_000),
  maxRedirects: z.number().default(5),
  userAgent: z.string().default(DEFAULT_USER_AGENT),
})

/** Complete config after schemastery applies every field default. */
// schemastery 应用全部默认值后的完整配置类型。
type ResolvedConfig = Required<Config>

/** A resource limit (byte/char/length/timeout cap) must be a positive finite number. */
// 资源限额（字节/字符/长度/超时上限）必须是正的有限数。
function assertPositiveFinite(name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`web-fetch-http: ${name} must be a positive finite number`)
  }
}

/** Node coerces larger timer delays to 1 ms, so reject them at configuration time. */
// Node 会把超过上限的定时器延迟强制为 1ms，因此在配置期直接拒绝。
function assertTimeoutMs(value: number): void {
  assertPositiveFinite('timeoutMs', value)
  if (value > MAX_NODE_TIMER_DELAY_MS) {
    throw new Error(`web-fetch-http: timeoutMs must be no greater than ${MAX_NODE_TIMER_DELAY_MS}`)
  }
}

/** The redirect hop cap must be a non-negative integer (0 follows no redirects). */
// 重定向跳数上限必须是非负整数（0 表示不跟随任何重定向）。
function assertNonNegativeInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`web-fetch-http: ${name} must be a non-negative integer`)
  }
}

/** Register the local HTTP(S) fetch provider with `ctx.web`. */
// 插件入口 apply：校验限额后组装 HttpFetchLimits，并注册提供者。
export function apply(ctx: Context, config: Config): void {
  // schemastery (Config) has already filled every defaulted field.
  // schemastery 已经填好全部默认字段，这里直接按完整配置使用。
  const resolved = config as ResolvedConfig
  assertPositiveFinite('maxUrlLength', resolved.maxUrlLength)
  assertPositiveFinite('maxResponseBytes', resolved.maxResponseBytes)
  assertPositiveFinite('maxBodyChars', resolved.maxBodyChars)
  assertTimeoutMs(resolved.timeoutMs)
  assertNonNegativeInteger('maxRedirects', resolved.maxRedirects)
  const limits: HttpFetchLimits = {
    maxUrlLength: resolved.maxUrlLength,
    maxResponseBytes: resolved.maxResponseBytes,
    maxBodyChars: resolved.maxBodyChars,
    timeoutMs: resolved.timeoutMs,
    maxRedirects: resolved.maxRedirects,
    userAgent: resolved.userAgent,
  }
  ctx.web.registerFetchProvider(new HttpFetchProvider(limits))
}
