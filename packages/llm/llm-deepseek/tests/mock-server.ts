/**
 * 文件职责：验证DeepSeek LLM的 mock-server.ts 行为与网络边界。
 * 技术维度：TypeScript、Fetch、SSE、OAuth/密钥认证、模型目录和运行时模式校验。
 * 产品维度：让 Agent 能稳定调用供应商模型、发现能力并接收流式结果。
 * 逻辑维度：构造请求或模拟服务器，驱动适配器并断言事件与错误。
 * 关键边界：网络响应属于不可信输入；密钥和令牌不得记录；取消必须终止请求与流。
 * 新手阅读建议：先读 config/auth/catalog，再看 adapter/stream，最后阅读错误和重放测试。
 */
import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'

/** One scripted behavior for the next request the mock server receives. */
/* 中文说明：类型或类 Behavior 约束模型请求、认证或流事件职责。 */
export type Behavior =
  | { kind: 'sse'; events: string[]; delayMs?: number }
  | { kind: 'http-error'; status: number; body: string; contentType?: string; headers?: Record<string, string> }
  | { kind: 'close-early'; events: string[] }

/** 中文说明：类型或类 MockServer 约束模型请求、认证或流事件职责。 */
export interface MockServer {
  url: string
  /** Bodies of received requests, in order. */
  requests: unknown[]
  /** Header bags of received requests, in order (parallel to `requests`). */
  headers: IncomingMessage['headers'][]
  /** Parsed Files API operations, excluded from chat request ordering. */
  fileRequests: Array<{ method: string; path: string; filename?: string; bytes?: number }>
  script: Behavior[]
  close(): Promise<void>
}

/** 中文说明：测试局部值 servers，由紧邻初始化决定。 */
const servers: Server[] = []

/** Close every server opened since the last call; run from each spec's afterEach. */
/* 中文说明：函数 closeMockServers 的参数见签名，返回结果供模型流程使用；示例见本文件。 */
export async function closeMockServers(): Promise<void> {
  await Promise.all(servers.splice(0).map(server => new Promise(resolve => server.close(resolve))))
}

/** A minimal complete text generation, reused by request-shape assertions. */
/* 中文说明：测试局部值 textEvents，由紧邻初始化决定。 */
export const textEvents = [
  '{"choices":[{"delta":{"role":"assistant","content":null,"reasoning_content":""}}]}',
  '{"choices":[{"delta":{"content":"hello"}}]}',
  '{"choices":[{"delta":{"content":""},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":1}}',
  '[DONE]',
]

/** Local chat-completions stand-in: replays scripted behaviors per request. */
/* 中文说明：函数 mockServer 的参数见签名，返回结果供模型流程使用；示例见本文件。 */
export async function mockServer(script: Behavior[]): Promise<MockServer> {
  /** 中文说明：测试局部值 requests，由紧邻初始化决定。 */
  const requests: unknown[] = []
  /** 中文说明：测试局部值 headers，由紧邻初始化决定。 */
  const headers: IncomingMessage['headers'][] = []
  /** 中文说明：测试局部值 fileRequests，由紧邻初始化决定。 */
  const fileRequests: MockServer['fileRequests'] = []
  /** 中文说明：测试局部值 files，由紧邻初始化决定。 */
  const files = new Map<string, { id: string; object: 'file'; bytes: number; created_at: number; filename: string; purpose: 'user_data'; expires_at: number }>()
  /** 中文说明：测试局部值 nextFile，由紧邻初始化决定。 */
  let nextFile = 1
  /** 中文说明：测试局部值 server，由紧邻初始化决定。 */
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    /** 中文说明：测试局部值 chunks，由紧邻初始化决定。 */
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => { chunks.push(chunk) })
    request.on('end', () => {
      void (async () => {
        /** 中文说明：测试局部值 url，由紧邻初始化决定。 */
        const url = new URL(request.url ?? '/', 'http://localhost')
        /** 中文说明：测试局部值 body，由紧邻初始化决定。 */
        const body = Buffer.concat(chunks)
        if (url.pathname === '/files' && request.method === 'POST') {
          /** 中文说明：测试局部值 headers，由紧邻初始化决定。 */
          const headers = new Headers()
          /** 中文说明：测试局部值 [name，由紧邻初始化决定。 */
          for (const [name, value] of Object.entries(request.headers)) {
            if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : value)
          }
          /** 中文说明：测试局部值 form，由紧邻初始化决定。 */
          const form = await new Request('http://localhost/files', {
            method: 'POST',
            headers,
            body,
          }).formData()
          /** 中文说明：测试局部值 blob，由紧邻初始化决定。 */
          const blob = form.get('file')
          if (!(blob instanceof Blob)) throw new Error('mock upload omitted file')
          /** 中文说明：测试局部值 name，由紧邻初始化决定。 */
          const name = 'name' in blob && typeof blob.name === 'string' ? blob.name : 'uploaded_file'
          /** 中文说明：测试局部值 id，由紧邻初始化决定。 */
          const id = `file-api-${nextFile}`
          /** 中文说明：测试局部值 createdAt，由紧邻初始化决定。 */
          const createdAt = Math.floor(Date.now() / 1_000)
          nextFile += 1
          /** 中文说明：测试局部值 expiresSeconds，由紧邻初始化决定。 */
          const expiresSeconds = Number(form.get('expires_after[seconds]'))
          /** 中文说明：测试局部值 file，由紧邻初始化决定。 */
          const file = {
            id,
            object: 'file' as const,
            bytes: blob.size,
            created_at: createdAt,
            filename: name,
            purpose: 'user_data' as const,
            expires_at: createdAt + expiresSeconds,
          }
          files.set(id, file)
          fileRequests.push({ method: 'POST', path: url.pathname, filename: name, bytes: blob.size })
          response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(file))
          return
        }
        if (url.pathname === '/files' && request.method === 'GET') {
          fileRequests.push({ method: 'GET', path: `${url.pathname}${url.search}` })
          /** 中文说明：测试局部值 data，由紧邻初始化决定。 */
          const data = [...files.values()]
          response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({
            object: 'list',
            data,
            first_id: data[0]?.id,
            last_id: data.at(-1)?.id,
            has_more: false,
          }))
          return
        }
        if (url.pathname.startsWith('/files/') && request.method === 'DELETE') {
          /** 中文说明：测试局部值 id，由紧邻初始化决定。 */
          const id = decodeURIComponent(url.pathname.slice('/files/'.length))
          files.delete(id)
          fileRequests.push({ method: 'DELETE', path: url.pathname })
          response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({
            id, object: 'file', deleted: true,
          }))
          return
        }
        if (url.pathname.startsWith('/files/') && request.method === 'GET') {
          /** 中文说明：测试局部值 id，由紧邻初始化决定。 */
          const id = decodeURIComponent(url.pathname.slice('/files/'.length))
          fileRequests.push({ method: 'GET', path: url.pathname })
          /** 中文说明：测试局部值 file，由紧邻初始化决定。 */
          const file = files.get(id)
          if (file === undefined) {
            response.writeHead(404, { 'content-type': 'application/json' }).end(JSON.stringify({
              error: { message: 'file not found', code: 'file_not_found' },
            }))
          } else {
            response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(file))
          }
          return
        }

        requests.push(JSON.parse(body.toString('utf8')))
        headers.push(request.headers)
        /** 中文说明：测试局部值 behavior，由紧邻初始化决定。 */
        const behavior = script.shift()
        if (!behavior) {
          response.writeHead(500).end('mock script exhausted')
          return
        }
        if (behavior.kind === 'http-error') {
          response.writeHead(behavior.status, {
            'content-type': behavior.contentType ?? 'application/json',
            ...behavior.headers,
          })
          response.end(behavior.body)
          return
        }
        response.writeHead(200, { 'content-type': 'text/event-stream' })
        /** 中文说明：测试局部值 write，由紧邻初始化决定。 */
        const write = (index: number): void => {
          if (index >= behavior.events.length) {
            if (behavior.kind === 'sse') response.end()
            else response.destroy() // close-early: drop the socket mid-stream
            return
          }
          response.write(`data: ${behavior.events[index]}\n\n`)
          setTimeout(() => { write(index + 1) }, behavior.kind === 'sse' ? behavior.delayMs ?? 0 : 5)
        }
        write(0)
      })().catch((error: unknown) => {
        response.writeHead(500, { 'content-type': 'text/plain' }).end(String(error))
      })
    })
  })
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  /** 中文说明：测试局部值 address，由紧邻初始化决定。 */
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('no port')
  return {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    headers,
    fileRequests,
    script,
    close: () => new Promise(resolve => server.close(() => { resolve() })),
  }
}
