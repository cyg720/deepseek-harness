/**
 * ================================ 文件注释 ================================
 * 【文件职责】集中定义每次 provider 请求都会发送的非机密产品身份标识
 * （User-Agent 等归属头），防止各适配器各自为政产生漂移。
 * 【技术维度】通过 createRequire 读取本包 package.json 的 version 作为版本
 * 唯一来源；User-Agent 遵循 RFC 9110 的 product + comment 语法。
 * 【产品维度】向 LLM provider 声明"我是谁"（产品名、版本、仓库地址），方便
 * provider 侧统计与故障排查；部署方可用白标身份覆盖默认值，但不能完全取消。
 * 【逻辑维度】读取版本号 → 定义 AppIdentity 接口 → 定义默认身份 APP_IDENTITY
 * → 两个纯函数：userAgent 渲染头部值、attributionHeaders 返回头对象。
 * 【关键边界】只允许公开产品事实：无密钥、无本地路径、无会话 id、无提示词、
 * 无任何按请求变化的个人标识；任何请求级数据都不得影响这些值。
 * 【新手阅读建议】先读英文模块注释（含指向 Agent Note 的链接），再看
 * userAgent 函数理解 User-Agent 字符串的构成。
 * ==========================================================================
 */

/**
 * Centralize the non-secret product identity every provider request sends as `User-Agent`, keeping
 * adapters from drifting. See
 * `.agents/notes/implemented/architecture/2026-06-21-mandatory-app-attribution-headers.md`.
 *
 * App-attribution vocabulary for provider requests.
 * @module @deepseek-ai/dsh-llm/attribution
 */

import { createRequire } from 'node:module'

// The package's own manifest is the single source of the version so the
// User-Agent cannot drift from what is published (`./package.json` is an
// export of this package; the relative path resolves from both `src/` and
// the bundled `lib/`).
// 中文：以本包自己的 package.json 作为版本号的唯一来源，使 User-Agent 与
// 实际发布的版本保持一致（该相对路径在 src/ 与打包后的 lib/ 下都能解析）。
const { version } = createRequire(import.meta.url)('../package.json') as { version: string }

/**
 * （中文）发送给 LLM provider 的静态公开应用身份。所有字段都是公开的产品
 * 事实，可安全随每个请求发送：这里不允许出现密钥、本地路径、会话 id、提示词
 * 或任何按用户区分的标识，且没有任何按请求变化的数据可以影响这些值。
 */
/**
 * Static public application identity sent to LLM providers.
 *
 * Every field is a public product fact, safe on every request: no secrets,
 * local paths, session ids, prompt text, or per-user identifiers belong here,
 * and nothing per-request may influence the values.
 */
export interface AppIdentity {
  /** `User-Agent` product token (lowercase, hyphenated). */
  // 中文：User-Agent 中的产品 token（小写、连字符风格）。
  product: string
  /** Product version; sourced from package metadata, never hand-copied. */
  // 中文：产品版本，取自包元数据，绝不手工复制。
  version: string
  /** Repository home URL of the app, used as the `User-Agent` comment. */
  // 中文：应用仓库主页 URL，用作 User-Agent 中的注释部分。
  url: string
}

/**
 * （中文）harness 自身的默认身份：所有适配器默认发送它。需要白标身份的部署
 * 方可以把自定义 AppIdentity 传给 attributionHeaders——省略时回退到这个默认值；
 * 没有任何机制能完全取消归属头。
 */
/**
 * The harness's own identity: the default every adapter sends. Deployments
 * that need a white-label identity pass their own {@link AppIdentity} to
 * {@link attributionHeaders} — omission falls back to this default; nothing
 * can suppress attribution entirely.
 */
export const APP_IDENTITY: AppIdentity = {
  product: 'deepseek-harness',
  version,
  url: 'https://github.com/deepseek-ai/deepseek-harness',
}

/**
 * （中文）标准的 User-Agent 值：`product/version (+url)`。括号里的 +url 注释
 * 是 RFC 9110 §10.1.5 规定的 product + comment 自报家门形式。
 * @param identity 要渲染的身份；缺省用 APP_IDENTITY。
 * @returns 可直接发送的头部值字符串。
 */
/**
 * The standard `User-Agent` value: `product/version (+url)`. The
 * parenthesized `+url` comment is the conventional self-identification form
 * (RFC 9110 §10.1.5 product + comment syntax).
 * @param identity - the identity to render; defaults to {@link APP_IDENTITY}.
 * @returns the ready-to-send header value.
 */
export function userAgent(identity: AppIdentity = APP_IDENTITY): string {
  return `${identity.product}/${identity.version} (+${identity.url})`
}

/**
 * （中文）构造适配器必须在每个 provider 请求上发送的归属头。头部名使用小写
 * （HTTP 字段名在线上不区分大小写）。
 * @param identity 要发送的身份；缺省用 APP_IDENTITY——省略不能取消归属头。
 * @returns 需要合并进 provider 请求的头对象（目前只有 user-agent 一项）。
 */
/**
 * Build the attribution headers an adapter must send on every provider
 * request. Header names are lowercase (HTTP field names are case-insensitive
 * on the wire).
 * @param identity - the identity to send; defaults to {@link APP_IDENTITY} — omission cannot suppress attribution.
 * @returns headers to merge into the provider request (currently just `user-agent`).
 */
export function attributionHeaders(
  identity: AppIdentity = APP_IDENTITY,
): Record<string, string> {
  return { 'user-agent': userAgent(identity) }
}
