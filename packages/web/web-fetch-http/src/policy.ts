/**
 * ================================ 文件注释 ================================
 * 【文件职责】本文件是本地 HTTP(S) 抓取提供者中"纯函数、无网络"的一半：URL 校验与
 *             Content-Type 分类；真正发请求与读流的传输逻辑在 provider.ts 里组合这些函数。
 * 【技术维度】全部为纯函数（同样的输入必得同样的输出），便于单测；错误统一抛 WebError。
 * 【产品维度】抓取前的安全卫生检查：只允许 http/https、禁止 URL 内嵌凭据、拒绝跨源重定向、
 *             不支持的字符集宁可报错也不产出乱码。
 * 【逻辑维度】按出现顺序：正文种类枚举 → URL 校验 → 同源判断 → 内容类型分类 → 字符集提取
 *             → 构建解码器。
 * 【关键边界】SSRF/内网阻断不在本文件实现（见包内 Agent Note）；URL 长度有上限；
 *             编码与分类都基于响应头，不是正文探测。
 * 【新手阅读建议】逐个函数读即可，每个函数都是单职责的纯函数，先看 validateFetchUrl。
 * ==========================================================================
 */
/**
 * URL validation and content-type classification for the local HTTP(S) fetch
 * provider — the pure, network-free half. The provider's `fetch()` composes
 * these with transport (redirect following, byte caps, decoding).
 *
 * @module @deepseek-ai/dsh-web-fetch-http/policy
 */

import { WebError } from '@deepseek-ai/dsh-web'

/** The body kinds this provider decodes. */
// 本提供者可解码的正文种类。
export type FetchableKind = 'html' | 'text'

/**
 * Validate a request URL against the basic transport hygiene the provider
 * enforces before any network access: http(s) only, no embedded credentials,
 * bounded length. Returns the parsed `URL`. Throws {@link WebError} otherwise.
 * (SSRF / private-network blocking is deferred — see the package Agent Note.)
 *
 * @param input - the raw URL string from the fetch request.
 * @param maxUrlLength - inclusive upper bound on `input`'s length.
 * @returns the parsed `URL`.
 */
// 在发起任何网络访问前校验请求 URL 的传输卫生：仅允许 http/https、禁止内嵌凭据、
// 限制长度。合法则返回解析后的 URL 对象，否则抛 WebError。
// （SSRF/内网地址阻断暂缓实现，见包内 Agent Note。）
export function validateFetchUrl(input: string, maxUrlLength: number): URL {
  if (input.length > maxUrlLength) {
    throw new WebError(`URL exceeds the maximum length of ${maxUrlLength}`, 'WEB_INVALID_URL')
  }
  let url: URL
  try {
    url = new URL(input)
  } catch (error: unknown) {
    throw new WebError(`invalid URL: ${input}`, 'WEB_INVALID_URL', { cause: error })
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new WebError(`unsupported URL scheme "${url.protocol}" (only http and https are allowed)`, 'WEB_INVALID_URL')
  }
  if (url.username.length > 0 || url.password.length > 0) {
    throw new WebError('credentials in URLs are not allowed', 'WEB_BLOCKED_URL')
  }
  return url
}

/**
 * Two URLs are same-origin when scheme, hostname, and port match. A redirect
 * that crosses origins is refused so each new origin requires a fresh tool call
 * (and thus a fresh provider/permission decision).
 *
 * @param a - one of the two URLs to compare.
 * @param b - the other URL to compare.
 * @returns true when `a` and `b` share scheme, hostname, and port.
 */
// 当协议、主机名、端口完全一致时两个 URL 视为同源。跨源的重定向会被拒绝，
// 这样每个新源都需要一次全新的工具调用（从而重新走一遍提供者/权限决策）。
export function isSameOrigin(a: URL, b: URL): boolean {
  return a.protocol === b.protocol && a.hostname === b.hostname && a.port === b.port
}

/**
 * Classify a response `Content-Type` into a decodable body kind, or `undefined`
 * for an unsupported (e.g. binary) type. `text/html` and `application/xhtml+xml`
 * are `html`; other `text/*` plus a few structured text types are `text`.
 *
 * @param contentType - the raw `Content-Type` header, or `null` when the
 *   response carries none (unsupported).
 * @returns the decodable kind, or `undefined` for an unsupported type.
 */
// 把响应 Content-Type 分类为可解码的正文种类；不支持的类型（如二进制）返回 undefined。
// text/html 与 application/xhtml+xml 归为 html；其余 text/* 及少量结构化文本类型归为 text。
export function classifyContentType(contentType: string | null): FetchableKind | undefined {
  const mime = (contentType ?? '').replace(/;.*$/s, '').trim().toLowerCase()
  if (mime === 'text/html' || mime === 'application/xhtml+xml') return 'html'
  if (mime.startsWith('text/')) return 'text'
  if (mime === 'application/json' || mime === 'application/xml' || mime.endsWith('+json') || mime.endsWith('+xml')) return 'text'
  return undefined
}

/**
 * Extract the `charset` parameter from a response `Content-Type`, lower-cased,
 * or `undefined` when absent. The provider feeds this label to `TextDecoder`
 * so a non-UTF-8 response is decoded with its declared encoding rather than
 * silently mangled into replacement characters.
 *
 * @param contentType - the raw `Content-Type` header, or `null` when the
 *   response carries none.
 * @returns the lower-cased charset label, or `undefined` when none is declared.
 */
// 从响应 Content-Type 中提取 charset 参数（转小写），缺省返回 undefined。
// 提供者把它交给 TextDecoder，使非 UTF-8 响应按声明编码解码，而不是被静默替换成乱码字符。
export function parseCharset(contentType: string | null): string | undefined {
  const match = /;\s*charset\s*=\s*"?([^";]+)"?/i.exec(contentType ?? '')
  return match?.[1]?.trim().toLowerCase()
}

/**
 * Build a `TextDecoder` for the declared charset, falling back to UTF-8 when
 * none is declared. Throws {@link WebError} `WEB_UNSUPPORTED_CONTENT_TYPE` when
 * the label is present but not a charset `TextDecoder` recognizes — better to
 * fail loudly than return mojibake.
 *
 * @param charset - the declared charset label (from {@link parseCharset}), or
 *   `undefined` to default to UTF-8.
 * @returns a decoder for the declared (or defaulted) encoding.
 */
// 为声明的字符集构建 TextDecoder，未声明时回退 UTF-8。若声明了但 TextDecoder 不认识的
// 字符集，则抛 WEB_UNSUPPORTED_CONTENT_TYPE——宁可大声失败也不返回乱码。
export function decoderForCharset(charset: string | undefined): TextDecoder {
  if (charset === undefined) return new TextDecoder('utf-8')
  try {
    return new TextDecoder(charset)
  } catch (error: unknown) {
    throw new WebError(`unsupported charset "${charset}"`, 'WEB_UNSUPPORTED_CONTENT_TYPE', { cause: error })
  }
}
