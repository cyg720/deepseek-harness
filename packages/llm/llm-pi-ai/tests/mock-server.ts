/**
 * 文件职责：验证 mock-server.ts 覆盖的 LLM 配置、调用与事件处理行为。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件上下文和可控测试替身验证运行时协作。
 * 产品维度：保障模型接入在配置变化、认证、重试与异常场景下仍能给 Agent 稳定反馈。
 * 逻辑维度：准备上下文与测试数据，触发被测流程，再核对请求、事件、结果和清理行为。
 * 关键边界：测试替身必须保持确定性；敏感凭据不可写入日志；异步资源必须在用例结束时释放。
 * 新手阅读建议：先看测试数据和辅助函数，再按 describe/it 场景阅读，最后对照被测插件实现。
 */
import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'

/** 中文说明：interface MockServer 定义本测试所需的数据或行为，用于表达模型调用相关场景。 */
export interface MockServer {
  url: string
  paths: string[]
  requests: unknown[]
  headers: IncomingMessage['headers'][]
  readonly closedResponses: number
  responseClosed: Promise<void>
}

/** 中文说明：变量 servers 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const servers: Server[] = []

/** Close every server opened since the last call; run from each spec's afterEach. */
/* 中文说明：函数 closeMockServers 承担本测试场景中的准备或验证工作；参数按签名传入，返回值供后续断言使用；示例见本文件调用。 */
export async function closeMockServers(): Promise<void> {
  await Promise.all(servers.splice(0).map(server => new Promise(resolve => server.close(resolve))))
}

/** A minimal complete text generation in pi-ai's chat-completions shape. */
/* 中文说明：变量 textEvents 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
export const textEvents = [
  '{"choices":[{"delta":{"role":"assistant","content":""},"index":0,"finish_reason":null}]}',
  '{"choices":[{"delta":{"content":"hello"},"index":0,"finish_reason":null}]}',
  '{"choices":[{"delta":{},"index":0,"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":1}}',
  '[DONE]',
]

/** Local provider stand-in: replays scripted behaviors per request. */
/* 中文说明：函数 mockServer 承担本测试场景中的准备或验证工作；参数按签名传入，返回值供后续断言使用；示例见本文件调用。 */
export async function mockServer(script: {
  status?: number
  events?: string[]
  body?: string
  delayMs?: number
  headers?: Record<string, string>
}[]): Promise<MockServer> {
  /** 中文说明：变量 paths 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const paths: string[] = []
  /** 中文说明：变量 requests 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const requests: unknown[] = []
  /** 中文说明：变量 headers 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const headers: IncomingMessage['headers'][] = []
  /** 中文说明：变量 closedResponses 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let closedResponses = 0
  /** 中文说明：变量 responseClosed 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const responseClosed = Promise.withResolvers<undefined>()
  /** 中文说明：函数值 server 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    response.on('close', () => {
      closedResponses += 1
      responseClosed.resolve(undefined)
    })
    /** 中文说明：变量 body 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let body = ''
    request.on('data', (chunk: Buffer) => { body += chunk.toString('utf8') })
    request.on('end', () => {
      paths.push(request.url ?? '')
      requests.push(body.length === 0 ? undefined : JSON.parse(body))
      headers.push(request.headers)
      /** 中文说明：变量 behavior 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const behavior = script.shift() ?? { status: 500, body: 'script exhausted' }
      if (behavior.status !== undefined && behavior.status !== 200) {
        response.writeHead(behavior.status, { 'content-type': 'application/json', ...behavior.headers })
        response.end(behavior.body ?? '{}')
        return
      }
      if (behavior.body !== undefined) {
        response.writeHead(200, { 'content-type': 'application/json', ...behavior.headers })
        response.end(behavior.body)
        return
      }
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      /** 中文说明：变量 index 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      let index = 0
      /** 中文说明：函数值 writeNext 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
      const writeNext = (): void => {
        /** 中文说明：变量 event 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const event = behavior.events?.[index++]
        if (event === undefined) { response.end(); return }
        response.write(`data: ${event}\n\n`)
        if (behavior.delayMs === undefined) writeNext()
        else setTimeout(writeNext, behavior.delayMs)
      }
      writeNext()
    })
  })
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  /** 中文说明：变量 address 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('no port')
  return {
    url: `http://127.0.0.1:${address.port}`,
    paths,
    requests,
    headers,
    responseClosed: responseClosed.promise,
    get closedResponses() { return closedResponses },
  }
}
