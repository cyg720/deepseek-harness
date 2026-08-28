/**
 * 文件职责：验证 webhook/webhook-github 中 handler spec 相关行为与失败场景。
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。
 * 产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 */
import { createHmac } from 'node:crypto'
import { createServer, request as httpRequest, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { createGitHubWebhookHandler } from '../src/handler.ts'

/**
 * 常量说明：servers 用于处理 servers 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const servers: Server[] = []

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
afterEach(async () => {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：server（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(server)，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolve（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(resolve)，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => { resolve() }))))
})

/** One mutable fake for credential rotation and dispatch observation.
 * @remarks 中文说明：功能说明：处理 fakeContext 相关流程；使用场景由所在模块及调用位置决定。；参数说明：secret（由
 * TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：{ ctx: Context
 * dispatch: ReturnType<typeof vi.fn> setSecret(value: st…；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 fakeContext(secret)，并按返回类型处理结果。 */
function fakeContext(secret = 'fixture-secret'): {
  ctx: Context
  dispatch: ReturnType<typeof vi.fn>
  /**
   * 功能说明：设置 Secret 相关流程；使用场景由所在模块及调用位置决定。
   * @param value （string | undefined）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 setSecret(value)，并按返回类型处理结果。
   */
  setSecret(value: string | undefined): void
  warnings: ReturnType<typeof vi.fn>
} {
  /**
   * 变量说明：current 用于处理 current 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let current = secret as string | undefined
  /**
   * 常量说明：dispatch 用于分发 dispatch 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const dispatch = vi.fn()
  /**
   * 常量说明：warnings 用于处理 warnings 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const warnings = vi.fn()
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  return {
    ctx: {
      credentials: {
        resolve: async () => current === undefined ? undefined : { value: current, source: 'environment' },
      },
      webhookRuntime: { dispatch },
      logger: { warn: warnings },
    } as unknown as Context,
    dispatch,
    /**
     * 功能说明：设置 Secret 相关流程；使用场景由所在模块及调用位置决定。
     * @param value （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
     * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 setSecret(value)，并按返回类型处理结果。
     */
    setSecret(value) { current = value },
    warnings,
  }
}

/** Start a real Node server around the package-owned route handler.
 * @remarks 中文说明：功能说明：处理 serve 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：ctx（Context）：提供当前 Cordis 插件上下文与已声明服务；必须满足声明的类型及调用时序要求。；
 * 参数说明：maxBodyBytes（由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * ；返回值：Promise<string>；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * serve(ctx, maxBodyBytes)，并按返回类型处理结果。 */
async function serve(ctx: Context, maxBodyBytes = 1024): Promise<string> {
  /**
   * 常量说明：handler 用于处理 handler 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const handler = createGitHubWebhookHandler(ctx, {
    source: 'primary',
    secretEnv: credentialRef('DSH_GITHUB_WEBHOOK_SECRET'),
    maxBodyBytes,
  })
  /**
   * 常量说明：server 用于处理 server 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：request（由 TypeScript
   * 根据调用位置推断的类型）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。；参数：response（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(request, response)，
   * 并按返回类型处理结果。
   */
  const server = createServer((request, response) => { void handler(request, response) })
  servers.push(server)
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolve（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(resolve)，并按返回类型处理结果。
   */
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  /**
   * 常量说明：port 用于处理 port 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const port = (server.address() as AddressInfo).port
  return `http://127.0.0.1:${String(port)}`
}

/** HMAC header for one exact UTF-8 body.
 * @remarks 中文说明：功能说明：处理 signature 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：secret（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：body（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：string；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 signature(secret, body)，并按返回类型处理结果。 */
function signature(secret: string, body: string): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`
}

/** Send one GitHub-shaped request.
 * @remarks 中文说明：功能说明：处理 post 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：base（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：body（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数说明：options（{ secret?:
 * string signature?: string event?: string deliver…）：提供本次操作使用的配置选项；
 * 必须满足声明的类型及调用时序要求。；返回值：Promise<Response>；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 post(base, body, options)，并按返回类型处理结果。 */
async function post(
  base: string,
  body: string,
  options: {
    secret?: string
    signature?: string
    event?: string
    delivery?: string
    contentType?: string
    method?: string
  } = {},
): Promise<Response> {
  /**
   * 常量说明：secret 用于处理 secret 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const secret = options.secret ?? 'fixture-secret'
  return await fetch(base, {
    method: options.method ?? 'POST',
    headers: {
      'content-type': options.contentType ?? 'application/json',
      'x-hub-signature-256': options.signature ?? signature(secret, body),
      'x-github-event': options.event ?? 'pull_request',
      'x-github-delivery': options.delivery ?? 'delivery-1',
    },
    ...(options.method === 'GET' ? {} : { body }),
  })
}

/** Send body chunks without Content-Length through a real Node client socket.
 * @remarks 中文说明：功能说明：处理 postChunked 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：base（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数说明：chunks（readonly
 * string[]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数说明：endDelayMs（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：Promise<{ body: string;
 * status: number }>；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * postChunked(base, chunks, endDelayMs)，并按返回类型处理结果。 */
async function postChunked(
  base: string,
  chunks: readonly string[],
  endDelayMs = 0,
): Promise<{ body: string; status: number }> {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolve（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：reject（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(resolve, reject)，
   * 并按返回类型处理结果。
   */
  return await new Promise((resolve, reject) => {
    /**
     * 常量说明：request 用于处理 request 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：response（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(response)，并按返回类型处理结果。
     */
    const request = httpRequest(base, {
      method: 'POST',
      headers: {
        connection: 'close',
        'content-type': 'application/json',
        'transfer-encoding': 'chunked',
        'x-hub-signature-256': 'sha256=unused',
        'x-github-event': 'pull_request',
        'x-github-delivery': 'chunked-delivery',
      },
    }, (response) => {
      /**
       * 变量说明：body 用于处理 body 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
       */
      let body = ''
      response.setEncoding('utf8')
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：chunk（string）：提供本次调用所需的数据；
       * 必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；
       * 典型用法：在完成前置校验后调用 匿名回调(chunk)，并按返回类型处理结果。
       */
      response.on('data', (chunk: string) => { body += chunk })
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
       */
      response.on('end', () => { resolve({ body, status: response.statusCode ?? 0 }) })
    })
    request.once('error', reject)
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：socket（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(socket)，并按返回类型处理结果。
     */
    request.once('socket', (socket) => { socket.setNoDelay(true) })
    /**
     * 变量说明：chunk 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const chunk of chunks) request.write(chunk)
    if (endDelayMs === 0) request.end()
    else /**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
setTimeout(() => { request.end() }, endDelayMs)
  })
}

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
describe('GitHub webhook HTTP handler', () => {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('verifies, projects, dispatches, and answers 202', async () => {
    /**
     * 常量说明：fake 用于处理 fake 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const fake = fakeContext()
    /**
     * 常量说明：base 用于处理 base 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const base = await serve(fake.ctx)
    /**
     * 常量说明：body 用于处理 body 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const body = JSON.stringify({ action: 'ready_for_review', number: 1 })
    /**
     * 常量说明：response 用于处理 response 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const response = await post(base, body, { contentType: 'application/json; charset=utf-8' })
    expect(response.status).toBe(202)
    expect(await response.text()).toBe('')
    expect(fake.dispatch).toHaveBeenCalledOnce()
    /**
     * 常量说明：dispatched 用于处理 dispatched 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const dispatched: unknown = fake.dispatch.mock.calls[0]?.[0]
    expect(dispatched).toMatchObject({
      kind: 'github',
      source: 'primary',
      deliveryId: 'delivery-1',
      event: { name: 'pull_request', payload: { action: 'ready_for_review', number: 1 } },
    })
    expect(typeof (dispatched as { receivedAt?: unknown }).receivedAt).toBe('number')
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('resolves the secret for each request so rotation takes effect immediately', async () => {
    /**
     * 常量说明：fake 用于处理 fake 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const fake = fakeContext('first')
    /**
     * 常量说明：base 用于处理 base 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const base = await serve(fake.ctx)
    /**
     * 常量说明：body 用于处理 body 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const body = JSON.stringify({ ping: true })
    expect((await post(base, body, { secret: 'first', delivery: 'first' })).status).toBe(202)
    fake.setSecret('second')
    expect((await post(base, body, { secret: 'first', delivery: 'stale' })).status).toBe(401)
    expect((await post(base, body, { secret: 'second', delivery: 'second' })).status).toBe(202)
    expect(fake.dispatch).toHaveBeenCalledTimes(2)
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：_label（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：options（由 TypeScript
   * 根据调用位置推断的类型）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。；参数：status（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(_label, options, status)，
   * 并按返回类型处理结果。
   */
  it.each([
    ['method', { method: 'GET' }, 405],
    ['content type', { contentType: 'text/plain' }, 415],
    ['content type parameter', { contentType: 'application/json; boundary=x' }, 415],
    ['content type parameters', { contentType: 'application/json; charset=utf-8; boundary=x' }, 415],
    ['signature', { signature: 'sha256=bad' }, 401],
    ['event header', { event: '' }, 400],
    ['delivery header', { delivery: '' }, 400],
  ] as const)('rejects an invalid %s before dispatch', async (_label, options, status) => {
    /**
     * 常量说明：fake 用于处理 fake 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const fake = fakeContext()
    /**
     * 常量说明：base 用于处理 base 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const base = await serve(fake.ctx)
    /**
     * 常量说明：response 用于处理 response 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const response = await post(base, '{}', options)
    expect(response.status).toBe(status)
    if (status === 405) expect(response.headers.get('allow')).toBe('POST')
    expect(fake.dispatch).not.toHaveBeenCalled()
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('rejects a missing Content-Type before body processing', async () => {
    /**
     * 常量说明：fake 用于处理 fake 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const fake = fakeContext()
    /**
     * 常量说明：handler 用于处理 handler 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const handler = createGitHubWebhookHandler(fake.ctx, {
      source: 'primary',
      secretEnv: credentialRef('DSH_GITHUB_WEBHOOK_SECRET'),
      maxBodyBytes: 1024,
    })
    /**
     * 常量说明：request 用于处理 request 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const request = { method: 'POST', headers: {}, headersDistinct: {} } as unknown as IncomingMessage
    /**
     * 常量说明：writeHead 用于写入 Head 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const writeHead = vi.fn()
    /**
     * 常量说明：response 用于处理 response 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const response = { setHeader: vi.fn(), writeHead, end: vi.fn() } as unknown as ServerResponse
    await handler(request, response)
    expect(writeHead).toHaveBeenCalledWith(415, expect.any(Object))
    expect(fake.dispatch).not.toHaveBeenCalled()
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('rejects duplicate required headers', async () => {
    /**
     * 常量说明：fake 用于处理 fake 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const fake = fakeContext()
    /**
     * 常量说明：handler 用于处理 handler 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const handler = createGitHubWebhookHandler(fake.ctx, {
      source: 'primary',
      secretEnv: credentialRef('DSH_GITHUB_WEBHOOK_SECRET'),
      maxBodyBytes: 1024,
    })
    /**
     * 常量说明：request 用于处理 request 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const request = {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      headersDistinct: {
        'x-hub-signature-256': ['sha256=unused'],
        'x-github-delivery': ['delivery-1'],
        'x-github-event': ['pull_request', 'ping'],
      },
      complete: true,
      /**
       * 功能说明：处理 [Symbol.asyncIterator] 相关流程；使用场景由所在模块及调用位置决定。
       * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
       * @example 在完成前置校验后调用 [Symbol.asyncIterator]()，并按返回类型处理结果。
       */
      async * [Symbol.asyncIterator]() { yield Buffer.from('{}') },
    } as unknown as IncomingMessage
    /**
     * 常量说明：writeHead 用于写入 Head 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const writeHead = vi.fn()
    /**
     * 常量说明：response 用于处理 response 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const response = { setHeader: vi.fn(), writeHead, end: vi.fn() } as unknown as ServerResponse
    await handler(request, response)
    expect(writeHead).toHaveBeenCalledWith(400, expect.any(Object))
    expect(fake.dispatch).not.toHaveBeenCalled()
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：_label（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：body（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：status（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(_label, body, status)，
   * 并按返回类型处理结果。
   */
  it.each([
    ['not JSON', '{', 400],
    ['array', '[]', 400],
    ['non-lossless number', '{"value":1e400}', 400],
  ] as const)('rejects a signed %s body', async (_label, body, status) => {
    /**
     * 常量说明：fake 用于处理 fake 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const fake = fakeContext()
    /**
     * 常量说明：base 用于处理 base 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const base = await serve(fake.ctx)
    /**
     * 常量说明：response 用于处理 response 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const response = await post(base, body)
    expect(response.status).toBe(status)
    expect(fake.dispatch).not.toHaveBeenCalled()
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('rejects a declared body over the configured cap', async () => {
    /**
     * 常量说明：fake 用于处理 fake 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const fake = fakeContext()
    /**
     * 常量说明：base 用于处理 base 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const base = await serve(fake.ctx, 2)
    /**
     * 常量说明：response 用于处理 response 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const response = await post(base, '{} ')
    expect(response.status).toBe(413)
    expect(fake.dispatch).not.toHaveBeenCalled()
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('answers 413 for a chunked body over the cap without resetting the connection', async () => {
    /**
     * 常量说明：fake 用于处理 fake 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const fake = fakeContext()
    /**
     * 常量说明：base 用于处理 base 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const base = await serve(fake.ctx, 2)

    await expect(postChunked(base, ['abc'], 50)).resolves.toEqual({
      body: 'request body is too large',
      status: 413,
    })
    expect(fake.dispatch).not.toHaveBeenCalled()
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('answers 503 when the credential or runtime is unavailable', async () => {
    /**
     * 常量说明：missing 用于处理 missing 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const missing = fakeContext()
    missing.setSecret(undefined)
    /**
     * 常量说明：missingBase 用于处理 missingBase 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const missingBase = await serve(missing.ctx)
    expect((await post(missingBase, '{}')).status).toBe(503)

    /**
     * 常量说明：closing 用于处理 closing 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const closing = fakeContext()
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    closing.dispatch.mockImplementation(() => { throw new Error('closing') })
    /**
     * 常量说明：closingBase 用于处理 closingBase 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const closingBase = await serve(closing.ctx)
    expect((await post(closingBase, '{}')).status).toBe(503)
    expect(closing.warnings).toHaveBeenCalledTimes(1)
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('does not leak the signed payload or secret in an infrastructure diagnostic', async () => {
    /**
     * 常量说明：fake 用于处理 fake 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const fake = fakeContext('super-secret')
    ;/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
(fake.ctx.credentials.resolve as ReturnType<typeof vi.fn> | undefined) = vi.fn(async () => {
      throw new Error('credential store unavailable')
    }) as never
    /**
     * 常量说明：base 用于处理 base 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const base = await serve(fake.ctx)
    /**
     * 常量说明：body 用于处理 body 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const body = JSON.stringify({ private: 'payload-secret' })
    expect((await post(base, body, { secret: 'super-secret' })).status).toBe(503)
    /**
     * 常量说明：diagnostics 用于处理 diagnostics 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const diagnostics = JSON.stringify(fake.warnings.mock.calls)
    expect(diagnostics).not.toContain('super-secret')
    expect(diagnostics).not.toContain('payload-secret')
  })
})
