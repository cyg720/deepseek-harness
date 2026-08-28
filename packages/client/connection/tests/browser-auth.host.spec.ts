/** Browser launch-token and persistent-cookie behavior.
 * @remarks 文件说明：文件职责：验证 client/connection 中 browser auth host spec
 * 相关行为与失败场景。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。；产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。；
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。；
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。 */

import { createHmac } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CredentialProvider } from '@deepseek-ai/dsh-credentials'
import { BrowserAuth } from '../src/browser-auth.ts'
import type { ConnectionIndexRequest, ConnectionIndexResponse } from '../src/rpc.ts'
import { RecordCredentials } from './browser-credentials.ts'

/**
 * 功能说明：处理 signedCookie 相关流程；使用场景由所在模块及调用位置决定。
 * @param store （RecordCredentials）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param name （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param payload （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns string；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 signedCookie(store, name, payload)，并按返回类型处理结果。
 */
function signedCookie(store: RecordCredentials, name: string, payload: unknown): string {
  /**
   * 常量说明：body 用于处理 body 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const body = typeof payload === 'string'
    ? Buffer.from(payload, 'utf8').toString('base64url')
    : Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  return signedBodyCookie(store, name, body)
}

/**
 * 功能说明：处理 signedBodyCookie 相关流程；使用场景由所在模块及调用位置决定。
 * @param store （RecordCredentials）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param name （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param body （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns string；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 signedBodyCookie(store, name, body)，并按返回类型处理结果。
 */
function signedBodyCookie(store: RecordCredentials, name: string, body: string): string {
  /**
   * 常量说明：record 用于处理 record 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const record = store.record
  if (record?.kind !== 'grant' || typeof record.payload !== 'object' || record.payload === null) {
    throw new Error('test credential store has no signing secret')
  }
  /**
   * 常量说明：secret 用于处理 secret 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const secret: unknown = Reflect.get(record.payload, 'secret')
  if (typeof secret !== 'string') throw new Error('test credential record has no string secret')
  /**
   * 常量说明：signature 用于处理 signature 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const signature = createHmac('sha256', Buffer.from(secret, 'base64url')).update(body).digest('base64url')
  return `${name}=v1.${body}.${signature}`
}

interface ResponseState {
  status?: number
  headers?: Readonly<Record<string, string>>
  body?: string
}

/**
 * 功能说明：处理 response 相关流程；使用场景由所在模块及调用位置决定。
 * @returns { value: ConnectionIndexResponse; state: ResponseState }；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 response()，并按返回类型处理结果。
 */
function response(): { value: ConnectionIndexResponse; state: ResponseState } {
  /**
   * 常量说明：state 用于处理 state 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const state: ResponseState = {}
  return {
    value: {
      /**
       * 功能说明：写入 Head 相关流程；使用场景由所在模块及调用位置决定。
       * @param status （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
       * @param headers （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
       * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
       * @example 在完成前置校验后调用 writeHead(status, headers)，并按返回类型处理结果。
       */
      writeHead(status, headers) {
        state.status = status
        if (headers !== undefined) state.headers = headers
      },
      /**
       * 功能说明：处理 end 相关流程；使用场景由所在模块及调用位置决定。
       * @param body （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
       * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
       * @example 在完成前置校验后调用 end(body)，并按返回类型处理结果。
       */
      end(body) {
        if (body !== undefined) state.body = body
      },
    },
    state,
  }
}

/**
 * 功能说明：处理 credentials 相关流程；使用场景由所在模块及调用位置决定。
 * @param store （RecordCredentials）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns CredentialProvider；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 credentials(store)，并按返回类型处理结果。
 */
function credentials(store: RecordCredentials): CredentialProvider {
  return store as unknown as CredentialProvider
}

/**
 * 功能说明：创建 Auth 相关流程；使用场景由所在模块及调用位置决定。
 * @param store （RecordCredentials）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param maxAgeDays （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。
 * @param processOwner （object）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns Promise<BrowserAuth>；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 createAuth(store, maxAgeDays, processOwner)，
 * 并按返回类型处理结果。
 */
function createAuth(
  store: RecordCredentials,
  maxAgeDays = 30,
  processOwner: object = {},
): Promise<BrowserAuth> {
  return BrowserAuth.create(processOwner, credentials(store), maxAgeDays)
}

/**
 * 功能说明：处理 request 相关流程；使用场景由所在模块及调用位置决定。
 * @param url （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param authority （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param init （{ cookie?: string method?: string }）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。
 * @returns ConnectionIndexRequest；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 request(url, authority, init)，并按返回类型处理结果。
 */
function request(url: string, authority = '127.0.0.1:3080', init?: {
  cookie?: string
  method?: string
}): ConnectionIndexRequest {
  return {
    method: init?.method ?? 'GET',
    url,
    headers: {
      host: authority,
      ...init?.cookie === undefined ? {} : { cookie: init.cookie },
    },
  }
}

/**
 * 功能说明：处理 exchange 相关流程；使用场景由所在模块及调用位置决定。
 * @param auth （BrowserAuth）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param authority （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns { cookie: string; launchUrl: string; state: ResponseState }；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 exchange(auth, authority)，并按返回类型处理结果。
 */
function exchange(
  auth: BrowserAuth,
  authority = '127.0.0.1:3080',
): { cookie: string; launchUrl: string; state: ResponseState } {
  /**
   * 常量说明：launchUrl 用于处理 launchUrl 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const launchUrl = auth.authenticatedUrl(`http://${authority}`)
  /**
   * 常量说明：target 用于处理 target 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const target = new URL(launchUrl)
  /**
   * 常量说明：res 用于处理 res 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const res = response()
  expect(auth.authorizeIndex(request(`${target.pathname}${target.search}`, authority), res.value)).toBe(false)
  /**
   * 常量说明：setCookie 用于设置 Cookie 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const setCookie = res.state.headers?.['set-cookie']
  if (setCookie === undefined) throw new Error('token exchange did not set a cookie')
  return { cookie: setCookie.split(';', 1)[0]!, launchUrl, state: res.state }
}

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
afterEach(() => {
  vi.useRealTimers()
})

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
describe('BrowserAuth', () => {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('mints one process token and a persistent authority-bound cookie', async () => {
    /**
     * 常量说明：store 用于处理 store 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const store = new RecordCredentials()
    /**
     * 常量说明：processOwner 用于处理 processOwner 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const processOwner = {}
    /**
     * 常量说明：first 用于处理 first 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const first = await createAuth(store, 30, processOwner)
    /**
     * 常量说明：login 用于处理 login 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const login = exchange(first)

    expect(login.state).toMatchObject({
      status: 303,
      headers: {
        'cache-control': 'no-store',
        'location': '/',
        'referrer-policy': 'no-referrer',
      },
    })
    expect(login.state.headers?.['set-cookie']).toMatch(/; Max-Age=2592000; Path=\/; Expires=.*; HttpOnly; SameSite=Strict$/u)
    expect(login.state.headers?.['set-cookie']).not.toContain('Secure')
    expect(first.isAuthenticated(request('/', '127.0.0.1:3080', { cookie: login.cookie }))).toBe(true)
    expect(first.isAuthenticated({
      headers: new Headers({ host: '127.0.0.1:3080', cookie: login.cookie }),
    })).toBe(true)
    expect(first.isAuthenticated({ headers: new Headers() })).toBe(false)
    expect(first.isAuthenticated(request('/', 'localhost:3080', { cookie: login.cookie }))).toBe(false)
    expect(first.isAuthenticated(request('/', '127.0.0.1:3081', { cookie: login.cookie }))).toBe(false)

    /**
     * 常量说明：reloaded 用于处理 reloaded 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const reloaded = await createAuth(store, 30, processOwner)
    expect(reloaded.authenticatedUrl('http://127.0.0.1:3080')).toBe(login.launchUrl)
    expect(reloaded.isAuthenticated(request('/', '127.0.0.1:3080', { cookie: login.cookie }))).toBe(true)

    /**
     * 常量说明：restarted 用于处理 restarted 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const restarted = await createAuth(store)
    expect(new URL(restarted.authenticatedUrl('http://127.0.0.1:3080')).searchParams.get('token'))
      .not.toBe(new URL(login.launchUrl).searchParams.get('token'))
    expect(restarted.isAuthenticated(request('/', '127.0.0.1:3080', { cookie: login.cookie }))).toBe(true)
    /**
     * 常量说明：staleUrl 用于处理 staleUrl 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const staleUrl = new URL(login.launchUrl)
    /**
     * 常量说明：redirected 用于处理 redirected 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const redirected = response()
    expect(restarted.authorizeIndex(request(
      `${staleUrl.pathname}${staleUrl.search}`,
      '127.0.0.1:3080',
      { cookie: login.cookie },
    ), redirected.value)).toBe(false)
    expect(redirected.state).toEqual({
      status: 303,
      headers: {
        'cache-control': 'no-store',
        'location': '/',
        'referrer-policy': 'no-referrer',
      },
    })
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('accepts the cookie for index serving and gives every unauthenticated request one response', async () => {
    /**
     * 常量说明：auth 用于处理 auth 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const auth = await createAuth(new RecordCredentials())
    /**
     * 常量说明：cookie 用于处理 cookie 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const { cookie } = exchange(auth)
    /**
     * 常量说明：allowed 用于处理 allowed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const allowed = response()
    expect(auth.authorizeIndex(request('/index.html', '127.0.0.1:3080', { cookie }), allowed.value)).toBe(true)
    expect(allowed.state).toEqual({})

    /**
     * 变量说明：candidate 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const candidate of [
      request('/'),
      request('/?token=wrong'),
      request('/?token=wrong&token=again'),
      request('/index.html?token=wrong'),
      request(auth.authenticatedUrl('http://127.0.0.1:3080'), '127.0.0.1:3080', { method: 'HEAD' }),
    ]) {
      /**
       * 常量说明：denied 用于处理 denied 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const denied = response()
      expect(auth.authorizeIndex(candidate, denied.value)).toBe(false)
      expect(denied.state.status).toBe(401)
      expect(denied.state.headers).toEqual({
        'cache-control': 'no-store',
        'content-type': 'text/plain; charset=utf-8',
      })
      expect(denied.state.body).toBe(candidate.method === 'HEAD'
        ? undefined
        : 'dsh web authentication required; reopen the URL printed by dsh web.\n')
    }
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('rejects tampering, expiry, future issuance, and a longer lifetime than configured', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-24T00:00:00.000Z'))
    /**
     * 常量说明：store 用于处理 store 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const store = new RecordCredentials()
    /**
     * 常量说明：auth 用于处理 auth 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const auth = await createAuth(store)
    /**
     * 常量说明：cookie 用于处理 cookie 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const { cookie } = exchange(auth)
    /**
     * 常量说明：name、value 用于处理 name、value 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const [name, value] = cookie.split('=') as [string, string]

    expect(auth.isAuthenticated(request('/', '127.0.0.1:3080', { cookie: `${name}=broken` }))).toBe(false)
    expect(auth.isAuthenticated(request('/', '127.0.0.1:3080', { cookie: `${name}=${value.slice(0, -1)}x` }))).toBe(false)
    expect(auth.isAuthenticated(request('/', '127.0.0.1:3080', { cookie: `${name}=%` }))).toBe(false)
    expect(auth.isAuthenticated(request('/', '127.0.0.1:3080', {
      cookie: signedBodyCookie(store, name, 'a'),
    }))).toBe(false)
    expect(auth.isAuthenticated({ headers: {} })).toBe(false)
    expect(auth.isAuthenticated({ headers: { host: 'bad host', cookie } })).toBe(false)
    expect(auth.isAuthenticated({ headers: { host: '127.0.0.1:3080' } })).toBe(false)

    /**
     * 常量说明：invalidPayloads 用于处理 invalidPayloads 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const invalidPayloads: unknown[] = [
      'not json',
      null,
      { version: 2, authority: '127.0.0.1:3080', issuedAt: Date.now(), expiresAt: Date.now() + 1000 },
      { version: 1, authority: 42, issuedAt: Date.now(), expiresAt: Date.now() + 1000 },
      { version: 1, authority: '127.0.0.1:3080', issuedAt: 'now', expiresAt: Date.now() + 1000 },
      { version: 1, authority: '127.0.0.1:3080', issuedAt: Date.now(), expiresAt: 'later' },
    ]
    /**
     * 变量说明：payload 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const payload of invalidPayloads) {
      expect(auth.isAuthenticated(request('/', '127.0.0.1:3080', {
        cookie: signedCookie(store, name, payload),
      }))).toBe(false)
    }

    /**
     * 常量说明：shorter 用于处理 shorter 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const shorter = await createAuth(store, 1)
    expect(shorter.isAuthenticated(request('/', '127.0.0.1:3080', { cookie }))).toBe(false)
    vi.setSystemTime(new Date('2026-09-24T00:00:00.000Z'))
    expect(auth.isAuthenticated(request('/', '127.0.0.1:3080', { cookie }))).toBe(false)
    vi.setSystemTime(new Date('2026-08-23T00:00:00.000Z'))
    expect(auth.isAuthenticated(request('/', '127.0.0.1:3080', { cookie }))).toBe(false)
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('loads one secret per activation and replaces it after deletion on the next activation', async () => {
    /**
     * 常量说明：store 用于处理 store 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const store = new RecordCredentials()
    /**
     * 常量说明：auth 用于处理 auth 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const auth = await createAuth(store)
    /**
     * 常量说明：first 用于处理 first 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const first = exchange(auth)
    expect(store).toMatchObject({ reads: 0, modifies: 1 })

    await store.deleteRecord()
    expect(auth.isAuthenticated(request('/', '127.0.0.1:3080', { cookie: first.cookie }))).toBe(true)
    /**
     * 常量说明：sameActivation 用于处理 sameActivation 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const sameActivation = exchange(auth)
    expect(auth.isAuthenticated(request('/', '127.0.0.1:3080', { cookie: sameActivation.cookie }))).toBe(true)
    expect(store).toMatchObject({ reads: 0, modifies: 1 })

    /**
     * 常量说明：reactivated 用于处理 reactivated 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const reactivated = await createAuth(store)
    /**
     * 常量说明：second 用于处理 second 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const second = exchange(reactivated)
    expect(second.cookie).not.toBe(first.cookie)
    expect(reactivated.isAuthenticated(request('/', '127.0.0.1:3080', { cookie: first.cookie }))).toBe(false)
    expect(reactivated.isAuthenticated(request('/', '127.0.0.1:3080', { cookie: second.cookie }))).toBe(true)
    expect(store).toMatchObject({ reads: 0, modifies: 2 })
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('fails loud on an invalid owner record instead of replacing it', async () => {
    /**
     * 常量说明：unsupported 用于处理 unsupported 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const unsupported = new RecordCredentials()
    unsupported.record = { kind: 'api-key', key: 'not-a-cookie-secret' }
    await expect(createAuth(unsupported)).rejects.toThrow(/unsupported format/u)

    /**
     * 常量说明：malformed 用于处理 malformed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const malformed = new RecordCredentials()
    malformed.record = { kind: 'grant', payload: { version: 1, secret: 'short' } }
    await expect(createAuth(malformed)).rejects.toThrow(/invalid secret/u)

    /**
     * 常量说明：nonString 用于处理 nonString 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const nonString = new RecordCredentials()
    nonString.record = { kind: 'grant', payload: { version: 1, secret: 42 } }
    await expect(createAuth(nonString)).rejects.toThrow(/invalid secret/u)

    /**
     * 常量说明：discarded 用于处理 discarded 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const discarded = new RecordCredentials()
    discarded.discardWrites = true
    await expect(createAuth(discarded)).rejects.toThrow(/was not created/u)

    await expect(createAuth(new RecordCredentials(), Number.MAX_SAFE_INTEGER))
      .rejects.toThrow(/safe timestamp range/u)
  })
})
