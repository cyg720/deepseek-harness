/*
 * 【文件职责】校验 DNS 地址集合并固定后续连接地址，避免传输再次解析主机名而连接到未获准的私有地址。
 */

import { lookup as systemLookup } from 'node:dns/promises'
import type { LookupAddress, LookupOptions } from 'node:dns'
import { isIP } from 'node:net'
import type { Dispatcher, Response } from 'undici'

import ipaddr from 'ipaddr.js'
import { WebError } from '@deepseek-ai/dsh-web'

/** One address resolved and retained for the subsequent pinned connection. */
export interface PublicAddress {
  /** Canonical textual IPv4 or IPv6 address. */
  readonly address: string
  /** Address family accepted by Node's connection lookup callback. */
  readonly family: 4 | 6
}

/** The result of one address-pinned request; closing releases its private pool. */
export interface PinnedResponse {
  /** HTTP response whose body remains readable until `close()` is called. */
  readonly response: Response
  /** Release the request's dispatcher after the response body is consumed or cancelled.
   * @remarks 中文说明：功能说明：关闭 close 相关流程；使用场景由所在模块及调用位置决定。；返回值：Promise<void>；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 close()，并按返回类型处理结果。 */
  close(): Promise<void>
}

/** Resolver signature used to test public-address policy without process DNS changes. */
export type AddressResolver = (hostname: string, options: { all: true; order: 'verbatim' }) => Promise<LookupAddress[]>

/** RFC 6052 prefix lengths that may carry an IPv4 destination through NAT64.
 * @remarks 中文说明：常量说明：RFC6052_PREFIX_LENGTHS 用于处理 RFC6052_PREFIX_LENGTHS
 * 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
const RFC6052_PREFIX_LENGTHS = [32, 40, 48, 56, 64, 96] as const
/**
 * 常量说明：IPV4ONLY_DISCOVERY_HOST 用于处理 IPV4ONLY_DISCOVERY_HOST 相关数据，作用于当前作用域；
 * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const IPV4ONLY_DISCOVERY_HOST = 'ipv4only.arpa'
/**
 * 常量说明：IPV4ONLY_SENTINELS 用于处理 IPV4ONLY_SENTINELS 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const IPV4ONLY_SENTINELS = new Set(['192.0.0.170', '192.0.0.171'])

interface Nat64Prefix {
  readonly bytes: readonly number[]
  readonly length: typeof RFC6052_PREFIX_LENGTHS[number]
}

/**
 * Return whether an address is globally reachable unicast. IPv4-mapped IPv6 is
 * classified by its embedded IPv4 address; transition and translation prefixes
 * remain blocked because their eventual IPv4 destination cannot be pinned here.
 *
 * @param input - textual IPv4 or IPv6 address.
 * @returns true only for a public unicast destination.
 * @remarks 中文说明：功能说明：判断是否为 Public Ip Address 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：input（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：boolean；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 isPublicIpAddress(input)，并按返回类型处理结果。
 */
export function isPublicIpAddress(input: string): boolean {
  /**
   * 变量说明：parsed 用于处理 parsed 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let parsed: ipaddr.IPv4 | ipaddr.IPv6
  try {
    parsed = ipaddr.parse(stripIpv6Brackets(input))
  } catch {
    return false
  }
  if (parsed instanceof ipaddr.IPv4) return parsed.range() === 'unicast'
  if (parsed.isIPv4MappedAddress()) return parsed.toIPv4Address().range() === 'unicast'
  return parsed.range() === 'unicast'
}

/**
 * Resolve a hostname once and reject the complete answer set if any destination
 * is not public. The returned addresses are the only ones the transport may use.
 *
 * @param hostname - URL hostname, including brackets when it is an IPv6 literal.
 * @param signal - aborts the wait for system resolution; an in-flight OS lookup may finish unused.
 * @param resolver - lookup implementation, overridden only by focused tests.
 * @returns the validated, non-empty address set.
 * @remarks 中文说明：功能说明：解析 Public Addresses 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：hostname（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：signal（AbortSignal）：传递取消或终止信号；必须满足声明的类型及调用时序要求。；
 * 参数说明：resolver（AddressResolver）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：Promise<PublicAddress[]>；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 resolvePublicAddresses(hostname, signal, resolver)，
 * 并按返回类型处理结果。
 */
export async function resolvePublicAddresses(
  hostname: string,
  signal: AbortSignal,
  resolver: AddressResolver = systemLookup,
): Promise<PublicAddress[]> {
  /**
   * 常量说明：unbracketed 用于处理 unbracketed 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const unbracketed = stripIpv6Brackets(hostname)
  /**
   * 常量说明：literalFamily 用于处理 literalFamily 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const literalFamily = isIP(unbracketed)
  /**
   * 常量说明：resolved 用于处理 resolved 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const resolved = literalFamily === 0
    ? await raceWithSignal(resolver(unbracketed, { all: true, order: 'verbatim' }), signal)
    : [{ address: unbracketed, family: literalFamily }]

  if (resolved.length === 0) {
    throw new WebError(`hostname "${hostname}" resolved to no addresses`, 'WEB_PROVIDER_ERROR')
  }

  /**
   * 常量说明：hasIpv6 用于判断是否包含 Ipv6 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：entry（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(entry)，并按返回类型处理结果。
   */
  const hasIpv6 = resolved.some(entry => entry.family === 6 && isIP(entry.address) === 6)
  /**
   * 常量说明：nat64Prefixes 用于处理 nat64Prefixes 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const nat64Prefixes = hasIpv6
    ? await discoverNat64Prefixes(signal, resolver)
    : []

  /**
   * 常量说明：addresses 用于处理 addresses 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const addresses: PublicAddress[] = []
  /**
   * 变量说明：entry 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (const entry of resolved) {
    if ((entry.family !== 4 && entry.family !== 6) || isIP(entry.address) !== entry.family) {
      throw new WebError(`hostname "${hostname}" resolved to an invalid IP address`, 'WEB_PROVIDER_ERROR')
    }
    if (!isPublicIpAddress(entry.address)) {
      throw new WebError(`URL hostname "${hostname}" resolves to a non-public IP address`, 'WEB_BLOCKED_URL')
    }
    /**
     * 常量说明：translatedIpv4 用于处理 translatedIpv4 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const translatedIpv4 = translatedIpv4Address(entry.address, nat64Prefixes)
    if (translatedIpv4 !== undefined && !isPublicIpAddress(translatedIpv4)) {
      throw new WebError(`URL hostname "${hostname}" resolves through NAT64 to a non-public IPv4 address`, 'WEB_BLOCKED_URL')
    }
    addresses.push({ address: entry.address, family: entry.family })
  }
  return addresses
}

/** Discover the active DNS64 prefix set using RFC 7050's reserved hostname.
 * @remarks 中文说明：功能说明：处理 discoverNat64Prefixes 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：signal（AbortSignal）：传递取消或终止信号；必须满足声明的类型及调用时序要求。；
 * 参数说明：resolver（AddressResolver）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：Promise<Nat64Prefix[]>；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 discoverNat64Prefixes(signal, resolver)，并按返回类型处理结果。 */
async function discoverNat64Prefixes(signal: AbortSignal, resolver: AddressResolver): Promise<Nat64Prefix[]> {
  /**
   * 常量说明：discovered 用于处理 discovered 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const discovered = await raceWithSignal(
    resolver(IPV4ONLY_DISCOVERY_HOST, { all: true, order: 'verbatim' }),
    signal,
  )
  /**
   * 常量说明：prefixes 用于处理 prefixes 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const prefixes: Nat64Prefix[] = []
  /**
   * 常量说明：seen 用于处理 seen 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const seen = new Set<string>()
  /**
   * 变量说明：entry 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (const entry of discovered) {
    if (entry.family !== 6 || isIP(entry.address) !== 6) continue
    /**
     * 常量说明：bytes 用于处理 bytes 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const bytes = ipaddr.parse(entry.address).toByteArray()
    /**
     * 变量说明：length 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const length of RFC6052_PREFIX_LENGTHS) {
      /**
       * 常量说明：embedded 用于处理 embedded 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const embedded = embeddedIpv4Address(bytes, length)
      if (embedded === undefined || !IPV4ONLY_SENTINELS.has(embedded)) continue
      /**
       * 常量说明：prefixBytes 用于处理 prefixBytes 相关数据，作用于当前作用域；初始化后不可重新赋值，
       * 但对象内部是否可变仍由其类型决定。
       */
      const prefixBytes = bytes.slice(0, length / 8)
      /**
       * 常量说明：key 用于处理 key 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const key = `${String(length)}:${prefixBytes.join('.')}`
      if (seen.has(key)) continue
      seen.add(key)
      prefixes.push({ bytes: prefixBytes, length })
    }
  }
  return prefixes
}

/** Return the RFC 6052-embedded IPv4 address when an IPv6 address matches a discovered prefix.
 * @remarks 中文说明：功能说明：处理 translatedIpv4Address 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：input（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数说明：prefixes（readonly
 * Nat64Prefix[]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：string | undefined；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * translatedIpv4Address(input, prefixes)，并按返回类型处理结果。 */
function translatedIpv4Address(input: string, prefixes: readonly Nat64Prefix[]): string | undefined {
  if (isIP(input) !== 6) return undefined
  /**
   * 常量说明：bytes 用于处理 bytes 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const bytes = ipaddr.parse(input).toByteArray()
  /**
   * 变量说明：prefix 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (const prefix of prefixes) {
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：byte（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：index（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(byte, index)，并按返回类型处理结果。
     */
    if (!prefix.bytes.every((byte, index) => bytes[index] === byte)) continue
    /**
     * 常量说明：embedded 用于处理 embedded 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const embedded = embeddedIpv4Address(bytes, prefix.length)
    if (embedded !== undefined) return embedded
  }
  return undefined
}

/** Extract one IPv4 address from an RFC 6052 IPv6 layout.
 * @remarks 中文说明：功能说明：处理 embeddedIpv4Address 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：bytes（readonly number[]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：prefixLength（Nat64Prefix['length']）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：string | undefined；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * embeddedIpv4Address(bytes, prefixLength)，并按返回类型处理结果。 */
function embeddedIpv4Address(bytes: readonly number[], prefixLength: Nat64Prefix['length']): string | undefined {
  if (prefixLength === 96) return bytes.slice(12, 16).join('.')
  if (bytes[8] !== 0) return undefined
  /**
   * 常量说明：prefixBytes 用于处理 prefixBytes 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const prefixBytes = prefixLength / 8
  /**
   * 常量说明：beforeReservedOctet 用于处理 beforeReservedOctet 相关数据，作用于当前作用域；
   * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const beforeReservedOctet = 8 - prefixBytes
  /**
   * 常量说明：ipv4 用于处理 ipv4 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const ipv4 = [
    ...bytes.slice(prefixBytes, prefixBytes + beforeReservedOctet),
    ...bytes.slice(9, 9 + 4 - beforeReservedOctet),
  ]
  return ipv4.join('.')
}

/**
 * Whether a hostname is an IP literal that {@link resolvePublicAddresses} would refuse.
 *
 * A proxied hop skips those checks because the proxy resolves the origin, but a literal needs no
 * resolution: the address is already stated, and handing it to a proxy running on this machine
 * would reach exactly the loopback or private service the checks exist to keep out of reach.
 *
 * @param hostname - a URL's hostname, bracketed or not.
 * @returns true when the host is a literal address no request may be sent to.
 */
export function isNonPublicIpLiteral(hostname: string): boolean {
  const unbracketed = stripIpv6Brackets(hostname)
  return isIP(unbracketed) !== 0 && !isPublicIpAddress(unbracketed)
}

/**
 * Fetch through an agent whose lookup callback returns only the already validated address set. The
 * URL hostname remains intact for HTTP Host and TLS SNI.
 *
 * The agent is this request's own because the address set is: pinning is how this package refuses a
 * DNS answer that changes between validation and connection, and it may not apply process-wide —
 * an operator-configured MCP server or model endpoint on loopback is a supported destination, and
 * only the URLs this tool fetches are the model's to choose.
 *
 * @param url - validated HTTP(S) URL the policy does not route through a proxy.
 * @param addresses - public addresses returned by {@link resolvePublicAddresses}.
 * @param headers - request headers.
 * @param signal - request and body-read cancellation signal.
 * @returns a response plus the disposer its consumer must call.
 */
export async function requestPinned(
  url: URL,
  addresses: readonly PublicAddress[],
  headers: Record<string, string>,
  signal: AbortSignal,
): Promise<PinnedResponse> {
  // Keep the Node-only transport out of browser-worker startup. The preview can load the provider
  // and fail loud at its DNS stub without evaluating Undici; a real request resolves it here.
  const { Agent, fetch } = await import('undici')
  // Reached only where `proxyRouteFor` reported no proxy for this URL, and the pinned lookup this
  // agent carries is per-request state the process-wide dispatcher cannot hold.
  // proxy-exempt: pinning one request's validated addresses, on a URL the policy routes directly.
  const dispatcher = new Agent({ autoSelectFamily: true, connect: { lookup: createPinnedLookup(addresses) } })
  try {
    // proxy-exempt: the agent above, whose lifetime is this one request.
    const response = await fetch(url, { method: 'GET', redirect: 'manual', headers, signal, dispatcher })
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    return { response, close: async () => { await dispatcher.close() } }
  } catch (error: unknown) {
    await dispatcher.close()
    throw error
  }
}

/**
 * Fetch through the dispatcher the proxy policy already installed, letting the proxy resolve the
 * origin.
 *
 * No address set is pinned because none exists to pin: the proxy performs the lookup, and a
 * connection pinned to a locally resolved address would reach the origin directly and defeat the
 * proxy. The dispatcher is the process-wide one, so hops share its connection pool and no caller
 * closes it.
 *
 * @param dispatcher - the route's dispatcher, from `proxyRouteFor`.
 * @param url - validated HTTP(S) URL the policy routes through a proxy.
 * @param headers - request headers.
 * @param signal - request and body-read cancellation signal.
 * @returns a response plus a disposer that releases nothing, so both paths close alike.
 */
export async function requestVia(
  dispatcher: Dispatcher,
  url: URL,
  headers: Record<string, string>,
  signal: AbortSignal,
): Promise<PinnedResponse> {
  const { fetch } = await import('undici')
  // proxy-exempt: the dispatcher is the installed policy's own, handed over by `proxyRouteFor`.
  const response = await fetch(url, { method: 'GET', redirect: 'manual', headers, signal, dispatcher })
  return { response, close: () => Promise.resolve() }
}

/** Production network operations kept as an object so provider tests can replace resolution only. */
export const publicHttpNetwork = {
  resolve: resolvePublicAddresses,
  request: requestPinned,
  requestVia,
}

type LookupCallback = (
  error: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number,
) => void

/**
 * Build the connector lookup that serves a fixed validated answer set.
 *
 * @param addresses - public addresses retained from the preceding resolution.
 * @returns a Node-compatible lookup callback that performs no network resolution.
 * @remarks 中文说明：功能说明：创建 Pinned Lookup 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：addresses（readonly PublicAddress[]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：( hostname: string, options: LookupOptions, callback:
 * LookupCallback,…；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * createPinnedLookup(addresses)，并按返回类型处理结果。
 */
export function createPinnedLookup(addresses: readonly PublicAddress[]): (
  hostname: string,
  options: LookupOptions,
  callback: LookupCallback,
) => void {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：hostname（string）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。；参数：options（LookupOptions）：提供本次操作使用的配置选项；
   * 必须满足声明的类型及调用时序要求。；参数：callback（LookupCallback）：接收后续状态或事件并执行调用方逻辑；
   * 必须满足声明的类型及调用时序要求。；返回值：void；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用
   * 匿名回调(hostname, options, callback)，并按返回类型处理结果。
   */
  return (hostname: string, options: LookupOptions, callback: LookupCallback): void => {
    /**
     * 常量说明：family 用于处理 family 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const family = typeof options.family === 'number'
      ? options.family
      : options.family === 'IPv4' ? 4 : options.family === 'IPv6' ? 6 : 0
    /**
     * 常量说明：eligible 用于处理 eligible 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：address（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(address)，并按返回类型处理结果。
     */
    const eligible = family === 0 ? addresses : addresses.filter(address => address.family === family)
    /**
     * 常量说明：selected 用于处理 selected 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const selected = eligible[0]
    if (selected === undefined) {
      /**
       * 常量说明：error 用于处理 error 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const error = Object.assign(new Error(`no validated address for ${hostname} in family ${family}`), {
        code: 'ENOTFOUND',
        hostname,
      })
      callback(error, options.all === true ? [] : '', family)
      return
    }
    if (options.all === true) {
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：address（由 TypeScript
       * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(address)，并按返回类型处理结果。
       */
      callback(null, eligible.map(address => ({ ...address })))
      return
    }
    callback(null, selected.address, selected.family)
  }
}

/** Race a non-cancellable OS lookup without letting it delay tool cancellation.
 * @remarks 中文说明：功能说明：处理 raceWithSignal 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：promise（Promise<T>）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：signal（AbortSignal）：传递取消或终止信号；必须满足声明的类型及调用时序要求。；返回值：Promise<T>；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 raceWithSignal(promise,
 * signal)，并按返回类型处理结果。 */
function raceWithSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  /**
   * 常量说明：abortError 用于处理 abortError 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   * 功能说明：处理 abortError 相关流程；使用场景由所在模块及调用位置决定。
   * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 abortError()，并按返回类型处理结果。
   */
  const abortError = () => new Error('web fetch aborted during hostname resolution', { cause: signal.reason })
  if (signal.aborted) return Promise.reject(abortError())
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolve（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：reject（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(resolve, reject)，
   * 并按返回类型处理结果。
   */
  return new Promise<T>((resolve, reject) => {
    /**
     * 常量说明：abort 用于处理 abort 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     * 功能说明：处理 abort 相关流程；使用场景由所在模块及调用位置决定。
     * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 abort()，并按返回类型处理结果。
     */
    const abort = () => { reject(abortError()) }
    signal.addEventListener('abort', abort, { once: true })
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    promise.then(resolve, reject).finally(() => { signal.removeEventListener('abort', abort) })
  })
}

/** WHATWG URL retains brackets around IPv6 hostnames; IP parsers do not.
 * @remarks 中文说明：功能说明：处理 stripIpv6Brackets 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：hostname（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：string；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * stripIpv6Brackets(hostname)，并按返回类型处理结果。 */
function stripIpv6Brackets(hostname: string): string {
  return hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname
}
