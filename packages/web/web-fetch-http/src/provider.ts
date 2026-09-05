
/**
 * Safe HTTP(S) retrieval for `ctx.web`: validates and pins public IP destinations, follows
 * only same-origin redirects, enforces time and size limits, classifies and decodes text,
 * and leaves presentation to `@deepseek-ai/dsh-tool-web`. Requests carry no browser cookies
 * or ambient credentials.
 * @module @deepseek-ai/dsh-web-fetch-http/provider
 */

/*
 * 【文件职责】安全获取公共 HTTP(S) 文本，限制同源跳转、时间和体积；
 * 请求不携带浏览器 Cookie 或环境凭据。
 */

import { WebError } from '@deepseek-ai/dsh-web'
import type { WebFetchBody, WebFetchProvider, WebFetchRequest, WebFetchResult } from '@deepseek-ai/dsh-web'
import { deadline, timeoutOf } from '@deepseek-ai/dsh-timeout'
import type { Response } from 'undici'
import { proxyRouteFor } from '@deepseek-ai/dsh-http-proxy'
import { isNonPublicIpLiteral, publicHttpNetwork } from './network.ts'
import type { PublicAddress } from './network.ts'
import { classifyContentType, decoderForCharset, isSameOrigin, parseCharset, validateFetchUrl } from './policy.ts'

/** Resolved provider limits (the plugin's schemastery Config supplies defaults). */
// 已解析的提供者限额（默认值由插件的 schemastery Config 提供）。
export interface HttpFetchLimits {
  /** Maximum response body size in bytes (read is aborted past this). */
  // 响应体最大字节数（超出即中止读取）。
  maxResponseBytes: number
  /** Maximum decoded body length in characters (truncated past this). */
  // 解码后正文的最大字符数（超出即截断）。
  maxBodyChars: number
  /** Default fetch timeout in milliseconds. */
  // 默认抓取超时（毫秒）。
  timeoutMs: number
  /** Maximum number of (same-origin) redirect hops to follow. */
  // 最多跟随的（同源）重定向跳数。
  maxRedirects: number
  /** `User-Agent` header sent on every request. */
  // 每次请求发送的 User-Agent 头。
  userAgent: string
}

/** Resolve one hostname to an already policy-validated address set. */
export type HttpFetchResolver = (hostname: string, signal: AbortSignal) => Promise<PublicAddress[]>

/** Stable id this provider registers under. */
// 本提供者在 seam 注册表中使用的稳定 id。
export const LOCAL_FETCH_PROVIDER_ID = 'http'

/** The anonymous public HTTP(S) fetch provider. */
// 匿名公共 HTTP(S) 抓取提供者。
export class HttpFetchProvider implements WebFetchProvider {
  readonly id = LOCAL_FETCH_PROVIDER_ID

  /**
   * @param limits - resolved transport and response limits.
   * @param resolveAddresses - resolver that rejects non-public destinations before returning.
   */
  constructor(
    private readonly limits: HttpFetchLimits,
    private readonly resolveAddresses: HttpFetchResolver = publicHttpNetwork.resolve,
  ) {}

  /** No credentials to check — an anonymous public fetcher is always usable. */
  // 没有凭据需要检查——匿名公共抓取器永远可用。
  available(): boolean {
    return true
  }

  async fetch(request: WebFetchRequest, signal?: AbortSignal): Promise<WebFetchResult> {
    if (signal?.aborted) throw new WebError('web fetch aborted', 'WEB_ABORTED')

    // One signal stops both the request and body read. The deadline's TimeoutReason later
    // distinguishes this provider's timeout from caller or outer-deadline cancellation.
    // 一个 signal 同时停掉请求与正文读取；deadline 的 TimeoutReason 后续可区分
    // "本提供者超时"与"调用方/外层 deadline 取消"。
    using d = deadline(signal, this.limits.timeoutMs, 'WEB_FETCH_TIMEOUT')
    return await this.followAndRead(request.url, d.signal)
  }

  /** Follow same-origin redirects up to the hop cap, then read the final response. */
  // 按跳数上限跟随同源重定向，然后读取最终响应。
  private async followAndRead(initialUrl: string, signal: AbortSignal): Promise<WebFetchResult> {
    let currentUrl = validateFetchUrl(initialUrl)
    let redirectsFollowed = 0

    for (;;) {
      const request = await this.requestOnce(currentUrl, signal)
      const { response } = request
      try {
        if (isRedirectStatus(response.status)) {
          // Enforce the redirect budget before resolving or validating the next hop.
          if (redirectsFollowed >= this.limits.maxRedirects) {
            await response.body?.cancel()
            throw new WebError(`exceeded the maximum of ${this.limits.maxRedirects} redirects`, 'WEB_REDIRECT_BLOCKED')
          }
          const location = response.headers.get('location')
          if (location === null) {
            // A redirect status with no Location is not a usable resource. Cancel
            // the (possibly streaming) body before throwing so no socket leaks.
            await response.body?.cancel()
            throw new WebError(`redirect response (HTTP ${response.status}) without a Location header`, 'WEB_PROVIDER_ERROR')
          }
          const target = resolveRedirect(location, currentUrl)
          // Re-validate the target against the same transport hygiene a direct request gets: a
          // redirect must not be a back door to a credentialed, non-http(s), or over-long URL
          // that validateFetchUrl would reject.
          let validatedTarget: URL
          try {
            validatedTarget = validateFetchUrl(target.toString())
            if (!isSameOrigin(validatedTarget, currentUrl)) {
              throw new WebError(
                `cross-origin redirect to ${validatedTarget.origin} is not followed automatically; retry against that URL directly`,
                'WEB_REDIRECT_BLOCKED',
              )
            }
          } catch (error: unknown) {
            await response.body?.cancel()
            throw error
          }
          await response.body?.cancel()
          currentUrl = validatedTarget
          redirectsFollowed++
          continue
        }

        return await this.readBody(response, currentUrl, signal)
      } finally {
        await request.close()
      }
    }
  }

  private async requestOnce(url: URL, signal: AbortSignal) {
    const headers = {
      'user-agent': this.limits.userAgent,
      'accept': 'text/html,application/xhtml+xml,text/*;q=0.9,application/json;q=0.8',
    }
    try {
      // A proxied hop skips public-address resolution and pinning: the proxy performs the origin's
      // DNS, so there is no local address to validate, and pinning one would connect directly and
      // bypass the proxy. A hop the policy bypasses — every loopback and every `NO_PROXY` entry —
      // still takes the resolved-and-pinned path unchanged.
      //
      // One route decides both the branch and the dispatcher, so a mount or disposal between two
      // reads cannot return a direct, unpinned agent for a URL this branch cleared as proxied.
      //
      // An IP literal the address checks would refuse never takes it. The proxy would resolve
      // nothing — the address is already stated — so the shortcut would spend the checks for
      // nothing and let a proxy on this machine reach the very service they keep out of reach.
      const route = proxyRouteFor(url)
      if (route.proxied && !isNonPublicIpLiteral(url.hostname)) {
        return await publicHttpNetwork.requestVia(route.dispatcher, url, headers, signal)
      }
      const addresses = await this.resolveAddresses(url.hostname, signal)
      return await publicHttpNetwork.request(url, addresses, headers, signal)
    } catch (error: unknown) {
      if (error instanceof WebError) throw error
      throw translateAbortOrNetwork(error, signal)
    }
  }

  /** Read, byte-cap, classify, and decode the final response body. */
  // 读取、按字节截断、分类并解码最终响应正文。
  private async readBody(response: Response, finalUrl: URL, signal: AbortSignal): Promise<WebFetchResult> {
    const contentType = response.headers.get('content-type')
    const kind = classifyContentType(contentType)
    if (kind === undefined) {
      await response.body?.cancel()
      throw new WebError(`unsupported content type "${contentType ?? 'unknown'}"`, 'WEB_UNSUPPORTED_CONTENT_TYPE')
    }

    // Resolve the decoder BEFORE reading the body so an unsupported charset
    // fails without consuming the stream — but cancel the body on that failure
    // so the socket does not leak (matching the unsupported-content-type path).
    // 在读正文之前先解析解码器：不支持的字符集在未消费流时即失败，
    // 但失败路径上仍取消正文，避免 socket 泄漏（与不支持的内容类型路径一致）。
    let decoder: TextDecoder
    try {
      decoder = decoderForCharset(parseCharset(contentType))
    } catch (error: unknown) {
      await response.body?.cancel()
      throw error
    }
    const { bytes, truncatedByBytes } = await this.readCapped(response, signal)
    const decoded = decoder.decode(bytes)
    const truncatedByChars = decoded.length > this.limits.maxBodyChars
    const content = truncatedByChars ? decoded.slice(0, this.limits.maxBodyChars) : decoded
    const body: WebFetchBody = kind === 'html' ? { kind: 'html', content } : { kind: 'text', content }

    return {
      url: finalUrl.toString(),
      statusCode: response.status,
      body,
      truncated: truncatedByBytes || truncatedByChars,
    }
  }

  /**
   * Read the response stream up to `maxResponseBytes`. A `Content-Length` over
   * the cap rejects immediately with `WEB_FETCH_TOO_LARGE`; a stream that grows
   * past the cap is cut short (`truncatedByBytes`) rather than rejected, so a
   * server that under-reports still yields a bounded usable body.
   */
  // 把响应流读到 maxResponseBytes 为止。Content-Length 超限直接抛 WEB_FETCH_TOO_LARGE；
  // 流式增长超限则截断（truncatedByBytes）而不是拒绝，所以谎报 Content-Length 的服务器
  // 依然能产出有界可用的正文。
  private async readCapped(response: Response, signal: AbortSignal): Promise<{ bytes: Uint8Array; truncatedByBytes: boolean }> {
    const declared = response.headers.get('content-length')
    if (declared !== null) {
      const length = Number(declared)
      if (Number.isFinite(length) && length > this.limits.maxResponseBytes) {
        await response.body?.cancel()
        throw new WebError(`response exceeds the maximum of ${this.limits.maxResponseBytes} bytes`, 'WEB_FETCH_TOO_LARGE')
      }
    }

    /* v8 ignore next -- a 2xx Response from fetch always exposes a body stream; the null guard is defensive. */
    if (response.body === null) return { bytes: new Uint8Array(0), truncatedByBytes: false }

    const chunks: Uint8Array[] = []
    let total = 0
    let truncatedByBytes = false
    // Undici exposes response chunks as `any`; Fetch guarantees body chunks are Uint8Array.
    const reader = response.body.getReader() as ReadableStreamDefaultReader<Uint8Array>
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        const remaining = this.limits.maxResponseBytes - total
        // Only DROPPED bytes count as truncation: a chunk that exactly fills the
        // remaining capacity keeps all its bytes and we read on to observe EOF,
        // so an exactly-at-cap body is not falsely flagged truncated.
        // 只有"被丢弃的字节"才算截断：恰好填满剩余容量的分块会保留全部字节并继续读到 EOF，
        // 因此正好达到上限的正文不会被误标记为截断。
        if (value.byteLength > remaining) {
          chunks.push(value.subarray(0, remaining))
          total += remaining
          truncatedByBytes = true
          break
        }
        chunks.push(value)
        total += value.byteLength
      }
    } catch (error: unknown) {
      /* v8 ignore next -- mid-stream read fault needs a network drop after headers; translate path covered by request-phase tests. */
      throw translateAbortOrNetwork(error, signal)
    } finally {
      /* v8 ignore next 4 -- cancel() after a completed/broken read settles without rejecting; unobserved best-effort cleanup. */
      await reader.cancel().catch(() => {
        // Cancel after a successful read (or after we broke past the cap) is
        // best-effort cleanup; the bytes we need are already collected.
        // 读取成功（或越限截断）后的 cancel 是尽力而为的清理：所需字节已收集完毕。
      })
    }

    const bytes = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    return { bytes, truncatedByBytes }
  }
}

/** HTTP redirect status codes that carry a `Location`. */
// 携带 Location 头的 HTTP 重定向状态码集合。
function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308
}

/** Resolve a (possibly relative) `Location` against the current URL. */
// 把（可能相对的）Location 相对当前 URL 解析为绝对地址。
function resolveRedirect(location: string, base: URL): URL {
  try {
    return new URL(location, base)
  } catch (error: unknown) {
    /* v8 ignore next 2 -- URL resolution against a valid absolute base effectively never throws; defensive guard. */
    throw new WebError(`invalid redirect Location "${location}"`, 'WEB_PROVIDER_ERROR', { cause: error })
  }
}

/**
 * Translate a thrown fetch/stream error into a `WebError`, classified by the
 * deadline signal rather than the thrown value (which differs by phase: the
 * request-phase `fetch` rejects with the abort reason, while the read-phase
 * reader surfaces a bare `AbortError`). `timeoutOf(signal, 'WEB_FETCH_TIMEOUT')`
 * recovering OUR reason means our timeout fired (`WEB_FETCH_TIMEOUT`); any other
 * abort — an upstream cancel, or a foreign/outer deadline's timeout under
 * nesting — is `WEB_ABORTED`; a throw with the signal NOT aborted is a
 * transport/network failure (`WEB_PROVIDER_ERROR`).
 */
// 把 fetch/流读取抛出的错误翻译为 WebError，分类依据是 deadline signal 而非抛出的值
// （不同阶段抛出物不同：请求阶段 fetch 以 abort reason 拒绝，读取阶段 reader 抛出裸的
// AbortError）。timeoutOf 恢复出我们自己的 reason 说明是本提供者超时（WEB_FETCH_TIMEOUT）；
// 其它中止（上游取消、嵌套下外层 deadline 超时）是 WEB_ABORTED；signal 未中止的抛出
// 属于传输/网络失败（WEB_PROVIDER_ERROR）。
function translateAbortOrNetwork(error: unknown, signal: AbortSignal): WebError {
  const timeout = timeoutOf(signal, 'WEB_FETCH_TIMEOUT')
  if (timeout !== undefined) return new WebError('web fetch timed out', 'WEB_FETCH_TIMEOUT', { cause: timeout })
  if (signal.aborted) return new WebError('web fetch aborted', 'WEB_ABORTED', { cause: error })
  return new WebError(`web fetch failed: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
}
