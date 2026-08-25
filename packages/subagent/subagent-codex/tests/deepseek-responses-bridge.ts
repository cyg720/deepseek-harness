/**
 * 文件职责：验证 deepseek-responses-bridge.ts 覆盖的子代理启动、协议、继承与生命周期行为。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、进程协议或同进程代理驱动。
 * 产品维度：保障 Agent 能可靠委派任务、继承上下文并收集子代理结果。
 * 逻辑维度：准备代理配置，启动或连接子代理，转发事件，再处理结果、取消与清理。
 * 关键边界：异步状态不等于单次任务结果；外部输出不可信；清理必须等待子代理完全停止。
 * 新手阅读建议：先看公开配置和测试夹具，再读启动/事件流程，最后关注继承、取消与失败路径。
 */
import { createServer } from 'node:http'
import type {
  IncomingMessage,
  Server,
  ServerResponse,
} from 'node:http'
import { completeResponsesEvents } from './responses-fixture.ts'

/** 中文说明：常量 OFFICIAL_DEEPSEEK_BASE_URL 保存本测试共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const OFFICIAL_DEEPSEEK_BASE_URL = 'https://api.deepseek.com'
/** 中文说明：常量 MAX_REQUEST_BYTES 保存本测试共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const MAX_REQUEST_BYTES = 1_048_576

/** One running test-only Responses-to-DeepSeek bridge. */
/** 中文说明：interface DeepSeekResponsesBridge 定义本测试所需的数据或行为，用于表达子代理场景。 */
export interface DeepSeekResponsesBridge {
  readonly baseUrl: string
  readonly completedRequests: number
  close(): Promise<void>
}

/** 中文说明：函数 readRequest 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function readRequest(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    /** 中文说明：变量 body 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let body = ''
    request.setEncoding('utf8')
    request.on('data', (chunk: string) => {
      body += chunk
      if (Buffer.byteLength(body) > MAX_REQUEST_BYTES) {
        request.destroy(new Error('DeepSeek bridge request exceeded its byte limit'))
      }
    })
    request.on('end', () => { resolve(body) })
    request.on('error', reject)
  })
}

/** 中文说明：函数 responseInputTexts 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function responseInputTexts(body: Record<string, unknown>): string[] {
  if (!Array.isArray(body.input)) return []
  return body.input.flatMap((item): string[] => {
    if (item === null || typeof item !== 'object') return []
    /** 中文说明：变量 content 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const content = (item as Record<string, unknown>).content
    if (!Array.isArray(content)) return []
    return content.flatMap((part): string[] => (
      part !== null
      && typeof part === 'object'
      && typeof (part as Record<string, unknown>).text === 'string'
        ? [(part as Record<string, unknown>).text as string]
        : []
    ))
  })
}

/** 中文说明：函数 taskText 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function taskText(body: Record<string, unknown>): string {
  /** 中文说明：变量 input 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const input = responseInputTexts(body).join('\n')
  if (input.trim().length > 0) return input
  return typeof body.instructions === 'string' ? body.instructions : ''
}

/** 中文说明：函数 deepSeekBaseUrl 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function deepSeekBaseUrl(): string {
  /** 中文说明：变量 configured 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const configured = (process.env.DEEPSEEK_BASE_URL ?? OFFICIAL_DEEPSEEK_BASE_URL)
    .replace(/\/+$/, '')
  if (configured !== OFFICIAL_DEEPSEEK_BASE_URL) {
    throw new Error('Codex DeepSeek e2e requires the official DeepSeek base URL')
  }
  return configured
}

/** 中文说明：函数 completeWithDeepSeek 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function completeWithDeepSeek(
  authorization: string,
  task: string,
): Promise<string> {
  /** 中文说明：变量 response 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const response = await fetch(`${deepSeekBaseUrl()}/chat/completions`, {
    method: 'POST',
    headers: {
      authorization,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'deepseek-v4-flash',
      messages: [
        {
          role: 'system',
          content: 'Follow the user instruction and return only the requested nonce.',
        },
        { role: 'user', content: task },
      ],
      temperature: 0,
      max_tokens: 64,
      stream: false,
    }),
  })
  if (!response.ok) {
    void response.body?.cancel()
    throw new Error(`DeepSeek bridge upstream returned HTTP ${response.status}`)
  }
  /** 中文说明：变量 payload 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const payload = await response.json() as {
    choices?: Array<{ message?: { content?: unknown } }>
  }
  /** 中文说明：变量 content 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const content = payload.choices?.[0]?.message?.content
  if (typeof content !== 'string' || content.trim().length === 0) {
    throw new Error('DeepSeek bridge upstream returned no text')
  }
  return content
}

/** 中文说明：函数 closeServer 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error !== undefined) reject(error)
      else resolve()
    })
    server.closeAllConnections()
  })
}

/**
 * Start the single-purpose loopback bridge used by the Codex credentialed e2e.
 * @param nonce - unique answer the incoming Responses task must request.
 * @returns loopback endpoint, completion count, and close operation.
 */
/** 中文说明：函数 startDeepSeekResponsesBridge 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
export async function startDeepSeekResponsesBridge(
  nonce: string,
): Promise<DeepSeekResponsesBridge> {
  /** 中文说明：变量 seenRequests 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let seenRequests = 0
  /** 中文说明：变量 completedRequests 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let completedRequests = 0
  /** 中文说明：变量 openResponses 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const openResponses = new Set<ServerResponse>()
  /** 中文说明：函数值 server 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
  const server = createServer((request, response) => {
    openResponses.add(response)
    response.on('close', () => { openResponses.delete(response) })
    void (async () => {
      if (request.method !== 'POST' || request.url !== '/v1/responses') {
        response.writeHead(404)
        response.end()
        return
      }
      if (seenRequests !== 0) {
        response.writeHead(409)
        response.end()
        return
      }
      seenRequests += 1
      /** 中文说明：变量 authorization 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const authorization = request.headers.authorization
      if (
        typeof authorization !== 'string'
        || !authorization.startsWith('Bearer ')
        || authorization.length === 'Bearer '.length
      ) {
        throw new Error('Codex DeepSeek bridge received no bearer credential')
      }
      /** 中文说明：变量 body 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const body = JSON.parse(await readRequest(request)) as Record<string, unknown>
      /** 中文说明：变量 task 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const task = taskText(body)
      if (!task.includes(nonce)) {
        throw new Error('Codex DeepSeek bridge request omitted the expected nonce')
      }
      /** 中文说明：变量 text 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const text = await completeWithDeepSeek(authorization, task)
      completedRequests += 1
      response.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
        'x-request-id': 'req_deepseek_e2e',
      })
      /** 中文说明：该循环依次处理代理事件；循环变量仅在当前循环中有效。 */
      for (const event of completeResponsesEvents(text)) {
        response.write(`data: ${JSON.stringify(event)}\n\n`)
      }
      response.end('data: [DONE]\n\n')
    })().catch(() => {
      if (!response.headersSent) {
        response.writeHead(502, { 'content-type': 'application/json' })
      }
      response.end(JSON.stringify({ error: { message: 'DeepSeek bridge request failed' } }))
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })
  /** 中文说明：变量 address 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const address = server.address()
  if (address === null || typeof address === 'string') {
    throw new Error('DeepSeek bridge did not acquire a TCP port')
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    get completedRequests(): number { return completedRequests },
    async close(): Promise<void> {
      /** 中文说明：该循环依次处理代理事件；循环变量仅在当前循环中有效。 */
      for (const response of openResponses) response.destroy()
      await closeServer(server)
    },
  }
}
