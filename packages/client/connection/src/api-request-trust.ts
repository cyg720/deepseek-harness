/**
 * Browser-trust fence for every /api request. Defends the two confused-deputy
 * paths a browser opens against a local HTTP API — DNS rebinding (Host names
 * the attacker's domain while the socket reaches this server) and cross-site
 * requests fired from a malicious page. The Host fence binds every request,
 * browser-looking or not: over plain HTTP a browser attaches neither Origin
 * nor Fetch-Metadata to reads (images and navigations — those
 * headers go only to trustworthy destinations), so an unmarked request may
 * still be a rebound browser read and Host is the one header rebinding cannot
 * forge. Non-browser and remote clients pass the same fence via loopback,
 * deployment-derived LAN IP literals, or a declared `trustedHosts` authority.
 * Network reachability and authentication stay out of scope: binding policy
 * belongs to the webserver config, and this fence is not an auth layer.
 */
/**
 * 文件职责：为每个/api请求执行Host、Fetch-Metadata和Origin信任检查，阻止DNS重绑定与跨站浏览器调用。
 * 技术维度：使用WHATWG URL规范化Node/Fetch请求头，并按回环地址和部署trustedHosts比较authority。
 * 产品维度：保护本地Harness HTTP API不被恶意网页借用浏览器访问，同时允许合法CLI、LAN和显式信任客户端。
 * 逻辑维度：统一读取请求头，解析并规范authority，验证配置项，再依次执行Host、跨站标记和Origin围栏。
 * 关键边界：该文件不是认证层；Host检查对所有请求生效；trustedHosts必须是规范bare host[:port]。
 * 新手阅读建议：先看parseAuthority与canonicalAuthority，再看配置校验，最后按isTrustedApiRequest中的三道围栏阅读。
 */

import type { IncomingHttpHeaders } from 'node:http'
import { isLoopbackHostname } from './loopback-hostname.ts'

/** The request facts the fence reads from either HTTP representation. */
/** 信任围栏从Node HTTP或Fetch表示中读取的最小请求事实。 */
interface ApiTrustRequest {
  /** Node IncomingHttpHeaders或浏览器Headers对象。 */
  headers: IncomingHttpHeaders | Headers
}

/** 从两种请求头表示中读取单值字符串。 */
function header(headers: IncomingHttpHeaders | Headers, name: string): string | undefined {
  if (headers instanceof Headers) return headers.get(name) ?? undefined
  const value = headers[name]
  return typeof value === 'string' ? value : undefined
}

/** Normalized URL of a Host-header authority (hostname lowercased, default port stripped, IPv6 bracketed), or undefined when unparsable. */
/** 将Host authority解析为规范URL；无法解析时返回undefined。 */
function parseAuthority(authority: string): URL | undefined {
  try {
    // http: is a WHATWG "special scheme": parsing yields a non-empty hostname or throws.
    return new URL(`http://${authority}`)
  } catch {
    return undefined
  }
}

/**
 * Assert one configured `trustedHosts` entry is a bare authority (`host` or
 * `host:port`) in canonical form: it must survive WHATWG parsing unchanged
 * (case aside). Anything parsing would silently rewrite is refused as a typo
 * that must fail the load loudly instead of being ignored until requests 403
 * or quietly changing the grant: URL parts beyond the authority
 * (`harness.internal/path`, `user@harness.internal` — which would authorize
 * the embedded hostname), stripped whitespace, a dangling colon or
 * zero-padded port (which would broaden an intended exact-port grant to every
 * port), and non-canonical host spellings (`0x7f.0.0.1`, percent-encoding,
 * unbracketed IPv6; IDN hosts are declared in punycode, the form the wire
 * carries).
 * @param entry - the configured value, verbatim.
 */
export function assertTrustedAuthority(entry: string): void {
  // 按HTTP特殊协议解析出的配置authority。
  const entryUrl = parseAuthority(entry)
  if (entryUrl !== undefined && canonicalAuthority(entry, entryUrl) === entry.toLowerCase()) return
  throw new Error(`client-connection: trustedHosts entry ${JSON.stringify(entry)} is not a bare host[:port] authority`)
}

/**
 * Canonical form of a parsed authority: `hostname` when no port was written,
 * else `hostname:port`. The port is judged from URL parses under both special
 * schemes (their default ports differ, so `:80` and `:443` still count as
 * explicit), never from the raw string, where WHATWG trimming would misread
 * shapes like `host:port ` as port-less.
 */
function canonicalAuthority(entry: string, entryUrl: URL): string {
  // An authority that parsed under http cannot fail under https.
  // 通过HTTP和HTTPS默认端口差异判断配置是否显式写入端口。
  const port = entryUrl.port !== '' ? entryUrl.port : new URL(`https://${entry}`).port
  return port === '' ? entryUrl.hostname : `${entryUrl.hostname}:${port}`
}

/**
 * Whether the request authority matches a `trustedHosts` entry. An entry with
 * an explicit port matches that exact authority; a port-less entry matches the
 * hostname on any port (the shape the CLI derives for IP-literal LAN serving,
 * where the bound port may be OS-assigned). Both sides compare through WHATWG
 * normalization, so case and a redundant `:80` never decide trust.
 */
function isTrustedAuthority(hostUrl: URL, trustedHosts: readonly string[]): boolean {
  return trustedHosts.some((entry) => {
    const entryUrl = parseAuthority(entry)
    if (entryUrl === undefined) return false
    return canonicalAuthority(entry, entryUrl) === entryUrl.hostname
      ? entryUrl.hostname === hostUrl.hostname
      : entryUrl.host === hostUrl.host
  })
}

/**
 * Decide whether one /api request may reach the RPC bridge.
 * @param request - Node HTTP or Fetch request facts (headers).
 * @param trustedHosts - non-loopback authorities this deployment serves: exact `host:port`, or port-less `host` matching any port.
 * @returns true when the Host is ours (loopback or trusted) and any attached browser markers are same-origin.
 */
export function isTrustedApiRequest(request: ApiTrustRequest, trustedHosts: readonly string[]): boolean {
  // Host fence (DNS-rebinding defense), applied to every request: the browser
  // fills Host from the URL it believes it is talking to, so a rebound page
  // carries the attacker's domain here even though the socket lands on this
  // server. There is no marker shortcut — a browser read over plain HTTP
  // (images and navigations) arrives with neither Origin nor
  // Fetch-Metadata, indistinguishable from curl, and its response is readable
  // by the rebound page.
  const host = header(request.headers, 'host')
  if (host === undefined) return false
  // 当前请求Host解析并规范化后的URL。
  const hostUrl = parseAuthority(host)
  if (hostUrl === undefined) return false
  if (!isLoopbackHostname(hostUrl.hostname) && !isTrustedAuthority(hostUrl, trustedHosts)) return false
  // Cross-site fence: modern browsers label the initiator relationship on
  // every fetch; an explicit cross-site marker is refused regardless of Origin.
  if (header(request.headers, 'sec-fetch-site') === 'cross-site') return false
  // Origin fence: when a browser attaches an Origin it must be exactly this
  // authority (compared through the same normalization as the Host). Absent
  // Origin is fine — the Host fence above already bound the request. The
  // literal "null" (sandboxed iframes, file: pages) is an opaque origin, refused.
  // 浏览器可选附带的请求发起Origin。
  const origin = header(request.headers, 'origin')
  if (origin === undefined) return true
  try {
    return new URL(origin).host === hostUrl.host
  } catch {
    return false
  }
}
