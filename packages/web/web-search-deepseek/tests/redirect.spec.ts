/**
 * Real HTTP coverage proves whether native `fetch` contacts a cross-origin `Location`; mocked
 * request-init assertions alone cannot observe that boundary.
 */
/**
 * 文件职责：验证 redirect.spec.ts 覆盖的Web 搜索与抓取行为与边界场景。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、HTTP、类型投影或异步资源控制。
 * 产品维度：保障 Agent 的Web 搜索与抓取能力稳定、可复现且可诊断。
 * 逻辑维度：准备或解析输入，执行核心流程，再转换并核对结果、错误与清理。
 * 关键边界：网络和生成数据不可信；超时与取消必须传播；临时资源必须可靠释放。
 * 新手阅读建议：先看公开类型和夹具，再读主流程，最后关注校验、超时与失败路径。
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { DeepSeekSearchProvider } from '@deepseek-ai/dsh-web-search-deepseek'

/** Construct the provider over a fixed options value; production passes a live thunk. */
import type { DeepSeekSearchProviderOptions } from '@deepseek-ai/dsh-web-search-deepseek'

/** 中文说明：函数值 searchProvider 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
const searchProvider = (options: DeepSeekSearchProviderOptions): DeepSeekSearchProvider =>
  new DeepSeekSearchProvider(() => options)

/** 中文说明：常量 TEST_API_KEY 保存本测试共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const TEST_API_KEY = 'redirect-test-key'
/** 中文说明：常量 TEST_QUERY 保存本测试共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const TEST_QUERY = 'private redirect query'
/** 中文说明：变量 targetRequests 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const targetRequests: ReceivedRequest[] = []

/** 中文说明：interface ReceivedRequest 定义本测试所需的数据或行为，用于表达Web 搜索与抓取场景。 */
interface ReceivedRequest {
  readonly body: string
  readonly headers: IncomingMessage['headers']
  readonly method?: string
}

/** 中文说明：变量 redirectOrigin 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
let redirectOrigin: string
/** 中文说明：变量 targetOrigin 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
let targetOrigin: string

/** 中文说明：函数值 targetServer 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
const targetServer = createServer((request, response) => {
  void captureRequest(request).then((received) => {
    targetRequests.push(received)
    response.writeHead(204).end()
  }, (error: unknown) => response.destroy(asError(error)))
})

/** 中文说明：函数值 redirectServer 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
const redirectServer = createServer((request, response) => {
  request.resume()
  /** 中文说明：变量 status 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const status = Number(new URL(request.url ?? '/', 'http://fixture.test').pathname.split('/')[1])
  response.writeHead(status, { location: `${targetOrigin}/collect` }).end()
})

beforeAll(async () => {
  targetOrigin = await listen(targetServer)
  redirectOrigin = await listen(redirectServer)
})

afterAll(async () => {
  await Promise.all([close(redirectServer), close(targetServer)])
})

describe('DeepSeekSearchProvider redirect policy', () => {
  it.each([301, 302, 303, 307, 308])('rejects HTTP %i before contacting Location', async (status) => {
    targetRequests.length = 0
    /** 中文说明：变量 provider 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const provider = searchProvider({
      apiKey: TEST_API_KEY,
      baseURL: `${redirectOrigin}/${status}`,
      model: 'deepseek-chat',
      apiVersion: '2023-06-01',
      maxTokens: 32,
      maxUses: 1,
    })

    await expect(provider.search({ query: TEST_QUERY }))
      .rejects.toMatchObject({ code: 'WEB_PROVIDER_ERROR' })
    expect(targetRequests).toHaveLength(0)
  })

  it('shows default 307 following forwards the custom credential and POST body', async () => {
    targetRequests.length = 0
    /** 中文说明：变量 body 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const body = JSON.stringify({ query: TEST_QUERY })
    await fetch(`${redirectOrigin}/307`, {
      method: 'POST',
      headers: {
        'x-api-key': TEST_API_KEY,
        'authorization': `Bearer ${TEST_API_KEY}`,
        'content-type': 'application/json',
      },
      body,
    })

    expect(targetRequests).toHaveLength(1)
    expect(targetRequests[0]).toMatchObject({ method: 'POST', body })
    expect(targetRequests[0]?.headers['x-api-key']).toBe(TEST_API_KEY)
  })
})

/** Read a complete request received by the redirect target. */
/** 中文说明：函数 captureRequest 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function captureRequest(request: IncomingMessage): Promise<ReceivedRequest> {
  return new Promise((resolve, reject) => {
    /** 中文说明：变量 chunks 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const chunks: Uint8Array[] = []
    request.on('data', (chunk: unknown) => {
      if (typeof chunk === 'string' || chunk instanceof Uint8Array) chunks.push(Buffer.from(chunk))
      else reject(new TypeError('unexpected HTTP request chunk'))
    })
    request.once('error', reject)
    request.once('end', () => {
      resolve({
        ...request.method !== undefined ? { method: request.method } : {},
        headers: request.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      })
    })
  })
}

/** Listen on an ephemeral loopback port and return the server origin. */
/** 中文说明：函数 listen 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  /** 中文说明：变量 address 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const address = server.address() as AddressInfo
  return `http://127.0.0.1:${address.port}`
}

/** Close a listening fixture server after every request has settled. */
/** 中文说明：函数 close 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function close(server: Server): Promise<void> {
  if (!server.listening) return
  await new Promise<void>((resolve, reject) => server.close((error) => {
    if (error === undefined) resolve()
    else reject(error)
  }))
}

/** Normalize an unknown fixture failure for `ServerResponse.destroy`. */
/** 中文说明：函数 asError 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}
