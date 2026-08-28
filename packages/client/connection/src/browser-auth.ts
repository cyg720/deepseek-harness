/** Browser-session authentication for the Host Connection carrier.
 * @remarks 文件说明：文件职责：实现 client/connection 中 browser auth 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * client/connection 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 →
 * 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。；
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。 */

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import type { CredentialProvider, CredentialRecord } from '@deepseek-ai/dsh-credentials'
import type {
  ConnectionIndexRequest,
  ConnectionIndexResponse,
  ConnectionTrustRequest,
} from './rpc.ts'

/**
 * 常量说明：AUTH_RECORD_KEY 用于处理 AUTH_RECORD_KEY 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const AUTH_RECORD_KEY = credentialKey('client-connection', 'browser-session')
/**
 * 常量说明：DAY_MILLISECONDS 用于处理 DAY_MILLISECONDS 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const DAY_MILLISECONDS = 24 * 60 * 60 * 1000
/**
 * 常量说明：SECRET_BYTES 用于处理 SECRET_BYTES 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const SECRET_BYTES = 32
/**
 * 常量说明：TOKEN_QUERY 用于处理 TOKEN_QUERY 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const TOKEN_QUERY = 'token'
/**
 * 常量说明：COOKIE_PREFIX 用于处理 COOKIE_PREFIX 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const COOKIE_PREFIX = 'dsh-auth-'
/**
 * 常量说明：COOKIE_PAYLOAD_VERSION 用于处理 COOKIE_PAYLOAD_VERSION 相关数据，作用于当前作用域；
 * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const COOKIE_PAYLOAD_VERSION = 1
/**
 * 常量说明：STORED_SECRET_VERSION 用于处理 STORED_SECRET_VERSION 相关数据，作用于当前作用域；
 * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const STORED_SECRET_VERSION = 1
/**
 * 常量说明：BASE64URL_PATTERN 用于处理 BASE64URL_PATTERN 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]*$/
/**
 * 常量说明：PROCESS_LAUNCH_TOKENS 用于处理 PROCESS_LAUNCH_TOKENS 相关数据，作用于当前作用域；
 * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const PROCESS_LAUNCH_TOKENS = new WeakMap<object, string>()

interface StoredSecretPayload {
  readonly version: typeof STORED_SECRET_VERSION
  readonly secret: string
}

interface BrowserCookiePayload {
  readonly version: typeof COOKIE_PAYLOAD_VERSION
  readonly authority: string
  readonly issuedAt: number
  readonly expiresAt: number
}

/**
 * 功能说明：判断是否为 Record 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns value is Record<string, unknown>；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 isRecord(value)，并按返回类型处理结果。
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * 功能说明：编码 Base64 Url 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （Uint8Array）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns string；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 encodeBase64Url(value)，并按返回类型处理结果。
 */
function encodeBase64Url(value: Uint8Array): string {
  return Buffer.from(value).toString('base64')
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '')
}

/**
 * 功能说明：解码 Base64 Url 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns Buffer | undefined；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 decodeBase64Url(value)，并按返回类型处理结果。
 */
function decodeBase64Url(value: string): Buffer | undefined {
  if (!BASE64URL_PATTERN.test(value) || value.length % 4 === 1) return undefined
  /**
   * 常量说明：padding 用于处理 padding 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const padding = '='.repeat((4 - value.length % 4) % 4)
  /**
   * 常量说明：decoded 用于处理 decoded 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const decoded = Buffer.from(value.replaceAll('-', '+').replaceAll('_', '/') + padding, 'base64')
  return encodeBase64Url(decoded) === value ? decoded : undefined
}

/**
 * 功能说明：处理 processLaunchToken 相关流程；使用场景由所在模块及调用位置决定。
 * @param owner （object）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns string；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 processLaunchToken(owner)，并按返回类型处理结果。
 */
function processLaunchToken(owner: object): string {
  /**
   * 常量说明：existing 用于处理 existing 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const existing = PROCESS_LAUNCH_TOKENS.get(owner)
  if (existing !== undefined) return existing
  /**
   * 常量说明：created 用于处理 created 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const created = encodeBase64Url(randomBytes(SECRET_BYTES))
  PROCESS_LAUNCH_TOKENS.set(owner, created)
  return created
}

/**
 * 功能说明：处理 header 相关流程；使用场景由所在模块及调用位置决定。
 * @param headers （ConnectionTrustRequest['headers']）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。
 * @param name （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns string | undefined；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 header(headers, name)，并按返回类型处理结果。
 */
function header(
  headers: ConnectionTrustRequest['headers'],
  name: string,
): string | undefined {
  if (headers instanceof Headers) return headers.get(name) ?? undefined
  /**
   * 常量说明：value 用于处理 value 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const value = headers[name]
  return typeof value === 'string' ? value : undefined
}

/** Canonical request authority used as the cookie name and signed audience.
 * @remarks 中文说明：功能说明：处理 requestAuthority 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：headers（ConnectionTrustRequest['headers']）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。；返回值：string | undefined；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 requestAuthority(headers)，并按返回类型处理结果。 */
function requestAuthority(headers: ConnectionTrustRequest['headers']): string | undefined {
  /**
   * 常量说明：host 用于处理 host 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const host = header(headers, 'host')
  if (host === undefined) return undefined
  try {
    return new URL(`http://${host}`).host
  } catch {
    return undefined
  }
}

/**
 * 功能说明：处理 canonicalSecret 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns Buffer | undefined；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 canonicalSecret(value)，并按返回类型处理结果。
 */
function canonicalSecret(value: unknown): Buffer | undefined {
  if (typeof value !== 'string') return undefined
  /**
   * 常量说明：decoded 用于处理 decoded 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const decoded = decodeBase64Url(value)
  if (decoded === undefined || decoded.byteLength !== SECRET_BYTES) return undefined
  return decoded
}

/**
 * 功能说明：处理 storedSecret 相关流程；使用场景由所在模块及调用位置决定。
 * @param record （CredentialRecord | undefined）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。
 * @returns Buffer | undefined；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 storedSecret(record)，并按返回类型处理结果。
 */
function storedSecret(record: CredentialRecord | undefined): Buffer | undefined {
  if (record === undefined) return undefined
  if (record.kind !== 'grant' || !isRecord(record.payload)
    || record.payload.version !== STORED_SECRET_VERSION) {
    throw new Error('client-connection: browser-session credential record has an unsupported format')
  }
  /**
   * 常量说明：secret 用于处理 secret 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const secret = canonicalSecret(record.payload.secret)
  if (secret === undefined) {
    throw new Error('client-connection: browser-session credential record has an invalid secret')
  }
  return secret
}

/**
 * 功能说明：处理 tokenMatches 相关流程；使用场景由所在模块及调用位置决定。
 * @param actual （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param expected （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns boolean；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 tokenMatches(actual, expected)，并按返回类型处理结果。
 */
function tokenMatches(actual: string, expected: string): boolean {
  /**
   * 常量说明：actualBytes 用于处理 actualBytes 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const actualBytes = Buffer.from(actual, 'utf8')
  /**
   * 常量说明：expectedBytes 用于处理 expectedBytes 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const expectedBytes = Buffer.from(expected, 'utf8')
  return actualBytes.byteLength === expectedBytes.byteLength && timingSafeEqual(actualBytes, expectedBytes)
}

/**
 * 功能说明：处理 cookieName 相关流程；使用场景由所在模块及调用位置决定。
 * @param authority （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns string；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 cookieName(authority)，并按返回类型处理结果。
 */
function cookieName(authority: string): string {
  return COOKIE_PREFIX + encodeBase64Url(createHash('sha256').update(authority).digest())
}

/** Read the exact generated cookie without implementing general Cookie decoding.
 * @remarks 中文说明：功能说明：处理 cookieValue 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：headerValue（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：name（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：string | undefined；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 cookieValue(headerValue,
 * name)，并按返回类型处理结果。 */
function cookieValue(headerValue: string, name: string): string | undefined {
  /**
   * 变量说明：segment 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (const segment of headerValue.split(';')) {
    /**
     * 常量说明：at 用于处理 at 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const at = segment.indexOf('=')
    if (at === -1 || segment.slice(0, at).trim() !== name) continue
    return segment.slice(at + 1).trim()
  }
  return undefined
}

/** Serialize the fixed browser-session attributes; generated names and values are cookie-safe base64url.
 * @remarks 中文说明：功能说明：处理 sessionCookie 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：name（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：value（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：expiresAt（number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：maxAgeSeconds（number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：string；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 sessionCookie(name,
 * value, expiresAt, maxAgeSeconds)，并按返回类型处理结果。 */
function sessionCookie(name: string, value: string, expiresAt: number, maxAgeSeconds: number): string {
  return `${name}=${value}; Max-Age=${String(maxAgeSeconds)}; Path=/; Expires=${new Date(expiresAt).toUTCString()}; HttpOnly; SameSite=Strict`
}

/**
 * 功能说明：处理 signature 相关流程；使用场景由所在模块及调用位置决定。
 * @param secret （Buffer）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param body （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns Buffer；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 signature(secret, body)，并按返回类型处理结果。
 */
function signature(secret: Buffer, body: string): Buffer {
  return createHmac('sha256', secret).update(body).digest()
}

/**
 * 功能说明：编码 Cookie 相关流程；使用场景由所在模块及调用位置决定。
 * @param payload （BrowserCookiePayload）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param secret （Buffer）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns string；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 encodeCookie(payload, secret)，并按返回类型处理结果。
 */
function encodeCookie(payload: BrowserCookiePayload, secret: Buffer): string {
  /**
   * 常量说明：body 用于处理 body 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const body = encodeBase64Url(Buffer.from(JSON.stringify(payload), 'utf8'))
  return `v1.${body}.${encodeBase64Url(signature(secret, body))}`
}

/**
 * 功能说明：解码 Cookie 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param secret （Buffer）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns BrowserCookiePayload | undefined；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 decodeCookie(value, secret)，并按返回类型处理结果。
 */
function decodeCookie(value: string, secret: Buffer): BrowserCookiePayload | undefined {
  /**
   * 常量说明：parts 用于处理 parts 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const parts = value.split('.')
  /**
   * 常量说明：version、body、encodedSignature 用于处理 version、body、encodedSignature
   * 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const [version, body, encodedSignature] = parts
  if (parts.length !== 3 || version !== 'v1' || body === undefined || encodedSignature === undefined) {
    return undefined
  }
  /**
   * 常量说明：actualSignature 用于处理 actualSignature 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const actualSignature = decodeBase64Url(encodedSignature)
  if (actualSignature === undefined) return undefined
  /**
   * 常量说明：expectedSignature 用于处理 expectedSignature 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const expectedSignature = signature(secret, body)
  if (actualSignature.byteLength !== expectedSignature.byteLength
    || !timingSafeEqual(actualSignature, expectedSignature)) return undefined
  /**
   * 变量说明：decoded 用于处理 decoded 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let decoded: unknown
  try {
    /**
     * 常量说明：bodyBytes 用于处理 bodyBytes 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const bodyBytes = decodeBase64Url(body)
    if (bodyBytes === undefined) return undefined
    decoded = JSON.parse(bodyBytes.toString('utf8'))
  } catch {
    return undefined
  }
  if (!isRecord(decoded)
    || decoded.version !== COOKIE_PAYLOAD_VERSION
    || typeof decoded.authority !== 'string'
    || !Number.isSafeInteger(decoded.issuedAt)
    || !Number.isSafeInteger(decoded.expiresAt)) return undefined
  return decoded as unknown as BrowserCookiePayload
}

/**
 * 功能说明：处理 initializeSecret 相关流程；使用场景由所在模块及调用位置决定。
 * @param credentials （CredentialProvider）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns Promise<Buffer>；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 initializeSecret(credentials)，并按返回类型处理结果。
 */
async function initializeSecret(credentials: CredentialProvider): Promise<Buffer> {
  /**
   * 常量说明：generated 用于处理 generated 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const generated: StoredSecretPayload = {
    version: STORED_SECRET_VERSION,
    secret: encodeBase64Url(randomBytes(SECRET_BYTES)),
  }
  /**
   * 常量说明：record 用于处理 record 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：current（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(current)，并按返回类型处理结果。
   */
  const record = await credentials.modifyRecord(AUTH_RECORD_KEY, (current) => {
    if (current !== undefined) {
      storedSecret(current)
      return Promise.resolve(undefined)
    }
    return Promise.resolve({ kind: 'grant', payload: generated })
  })
  /**
   * 常量说明：secret 用于处理 secret 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const secret = storedSecret(record)
  if (secret === undefined) {
    throw new Error('client-connection: browser-session credential record was not created')
  }
  return secret
}

/**
 * Process launch-token exchange and persistent signed-cookie verification.
 * Connection loads the credential provider's signing secret during activation
 * and retains it for synchronous request authentication.
 * @remarks 中文说明：类说明：BrowserAuth 用于集中封装 处理 BrowserAuth 相关状态与行为。；
 * 核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。；使用场景：由 client/connection
 * 在对应插件或业务生命周期内创建和调用。
 */
export class BrowserAuth {
  /**
   * 常量说明：launchToken 用于处理 launchToken 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly launchToken: string
  /**
   * 常量说明：maxAgeMilliseconds 用于处理 maxAgeMilliseconds 相关数据，作用于成员；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  private readonly maxAgeMilliseconds: number

  /**
   * 功能说明：处理 BrowserAuth 相关流程；使用场景由所在模块及调用位置决定。
   * @param processOwner （object）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param secret （Buffer）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param maxAgeDays （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns 当前类实例；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 通过 new BrowserAuth(processOwner, secret, maxAgeDays) 创建实例，
   * 并在所属生命周期内使用。
   */
  private constructor(
    processOwner: object,
    private readonly secret: Buffer,
    maxAgeDays: number,
  ) {
    this.launchToken = processLaunchToken(processOwner)
    this.maxAgeMilliseconds = maxAgeDays * DAY_MILLISECONDS
    if (!Number.isSafeInteger(this.maxAgeMilliseconds)
      || !Number.isSafeInteger(Date.now() + this.maxAgeMilliseconds)) {
      throw new Error('client-connection: cookieMaxAgeDays exceeds the safe timestamp range')
    }
  }

  /**
   * Initialize browser authentication and create its durable signing secret
   * when this Harness home has none.
   * @param processOwner - root application context retaining one token across Connection reloads.
   * @param credentials - persistent credential provider for the Web profile.
   * @param maxAgeDays - positive absolute browser-cookie lifetime in days.
   * @returns initialized authentication owner with the process owner's launch token.
   * @remarks 中文说明：功能说明：创建 create 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：processOwner（object）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：credentials（CredentialProvider）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：maxAgeDays（number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：Promise<BrowserAuth>；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * create(processOwner, credentials, maxAgeDays)，并按返回类型处理结果。
   */
  static async create(
    processOwner: object,
    credentials: CredentialProvider,
    maxAgeDays: number,
  ): Promise<BrowserAuth> {
    return new BrowserAuth(processOwner, await initializeSecret(credentials), maxAgeDays)
  }

  /**
   * Add this process's launch token to the ordinary application root URL.
   * @param baseUrl - canonical browser origin without credentials.
   * @returns root URL carrying the process token as its sole authentication input.
   * @remarks 中文说明：功能说明：处理 authenticatedUrl 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：baseUrl（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：string；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 authenticatedUrl(baseUrl)，
   * 并按返回类型处理结果。
   */
  authenticatedUrl(baseUrl: string): string {
    /**
     * 常量说明：url 用于处理 url 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const url = new URL(baseUrl)
    url.pathname = '/'
    url.search = ''
    url.hash = ''
    url.searchParams.set(TOKEN_QUERY, this.launchToken)
    return url.href
  }

  /**
   * Authenticate an index request. A valid root query token mints the cookie
   * and redirects to clean `/`; a valid cookie lets the caller serve the
   * index; every other request receives the same minimal 401 response.
   * @param req - incoming root or configured-index request.
   * @param res - response owned when this method returns false.
   * @returns true only when the caller may serve index.html.
   * @remarks 中文说明：功能说明：处理 authorizeIndex 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：req（ConnectionIndexRequest）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：res（ConnectionIndexResponse）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：boolean；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * authorizeIndex(req, res)，并按返回类型处理结果。
   */
  authorizeIndex(req: ConnectionIndexRequest, res: ConnectionIndexResponse): boolean {
    /* v8 ignore next -- node:http always supplies url on server requests. */
    /**
     * 常量说明：url 用于处理 url 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const url = new URL(req.url ?? '/', 'http://dsh.invalid')
    /**
     * 常量说明：tokens 用于处理 tokens 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const tokens = url.searchParams.getAll(TOKEN_QUERY)
    if (tokens.length > 0) {
      /**
       * 常量说明：authority 用于处理 authority 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const authority = requestAuthority(req.headers)
      if (req.method === 'GET' && url.pathname === '/' && tokens.length === 1
        && authority !== undefined && tokenMatches(tokens.join(''), this.launchToken)) {
        /**
         * 常量说明：issuedAt 用于处理 issuedAt 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const issuedAt = Date.now()
        /**
         * 常量说明：expiresAt 用于处理 expiresAt 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const expiresAt = issuedAt + this.maxAgeMilliseconds
        /**
         * 常量说明：value 用于处理 value 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const value = encodeCookie({
          version: COOKIE_PAYLOAD_VERSION,
          authority,
          issuedAt,
          expiresAt,
        }, this.secret)
        res.writeHead(303, {
          'cache-control': 'no-store',
          'location': '/',
          'referrer-policy': 'no-referrer',
          'set-cookie': sessionCookie(
            cookieName(authority), value, expiresAt, Math.floor(this.maxAgeMilliseconds / 1000),
          ),
        })
        res.end()
        return false
      }
      if (req.method === 'GET' && url.pathname === '/' && this.isAuthenticated(req)) {
        res.writeHead(303, {
          'cache-control': 'no-store',
          'location': '/',
          'referrer-policy': 'no-referrer',
        })
        res.end()
        return false
      }
      this.writeUnauthorized(req, res)
      return false
    }
    if (this.isAuthenticated(req)) return true
    this.writeUnauthorized(req, res)
    return false
  }

  /**
   * Verify the authority-bound browser cookie on a Host request.
   * @param request - request headers carrying Host and Cookie.
   * @returns true only for an unexpired cookie signed by this activation's loaded secret.
   * @remarks 中文说明：功能说明：判断是否为 Authenticated 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：request（ConnectionTrustRequest）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。；
   * 返回值：boolean；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * isAuthenticated(request)，并按返回类型处理结果。
   */
  isAuthenticated(request: ConnectionTrustRequest): boolean {
    /**
     * 常量说明：authority 用于处理 authority 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const authority = requestAuthority(request.headers)
    /**
     * 常量说明：rawCookie 用于处理 rawCookie 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const rawCookie = header(request.headers, 'cookie')
    if (authority === undefined || rawCookie === undefined) return false
    /**
     * 常量说明：value 用于处理 value 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const value = cookieValue(rawCookie, cookieName(authority))
    if (value === undefined) return false
    /**
     * 常量说明：payload 用于处理 payload 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const payload = decodeCookie(value, this.secret)
    if (payload === undefined || payload.authority !== authority) return false
    /**
     * 常量说明：now 用于处理 now 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const now = Date.now()
    return payload.issuedAt <= now
      && payload.expiresAt > now
      && payload.expiresAt > payload.issuedAt
      && payload.expiresAt - payload.issuedAt <= this.maxAgeMilliseconds
  }

  /**
   * 功能说明：写入 Unauthorized 相关流程；使用场景由所在模块及调用位置决定。
   * @param req （ConnectionIndexRequest）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param res （ConnectionIndexResponse）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 writeUnauthorized(req, res)，并按返回类型处理结果。
   */
  private writeUnauthorized(req: ConnectionIndexRequest, res: ConnectionIndexResponse): void {
    res.writeHead(401, {
      'cache-control': 'no-store',
      'content-type': 'text/plain; charset=utf-8',
    })
    res.end(req.method === 'HEAD'
      ? undefined
      : 'dsh web authentication required; reopen the URL printed by dsh web.\n')
  }
}
