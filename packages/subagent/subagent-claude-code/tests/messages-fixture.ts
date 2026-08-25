/**
 * 文件职责：验证 messages-fixture.ts 覆盖的子代理进程与协议行为与生命周期。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、文件存储或受控子进程协议。
 * 产品维度：保障 Agent 的子代理进程与协议能力稳定、安全且可诊断。
 * 逻辑维度：准备或解析输入，执行核心流程，再处理结果、错误与资源清理。
 * 关键边界：外部进程和持久化数据不可信；敏感环境需净化；清理必须等待资源完全停止。
 * 新手阅读建议：先看导出类型和夹具，再读主流程，最后关注协议错误、恢复和清理。
 */
import { createServer, type IncomingHttpHeaders, type ServerResponse } from 'node:http'

/** One deterministic response emitted by the package-private Messages server. */
/** 中文说明：type MessagesBehavior 定义本测试所需的数据或行为，用于表达子代理进程与协议场景。 */
export type MessagesBehavior =
  | { readonly kind: 'complete'; readonly text: string }
  | { readonly kind: 'hold' }
  | {
    readonly kind: 'tool-use'
    readonly toolName: string
    readonly input: Record<string, unknown>
    readonly finalText?: string
  }

/** One recorded Anthropic Messages request. */
/** 中文说明：interface RecordedMessagesRequest 定义本测试所需的数据或行为，用于表达子代理进程与协议场景。 */
interface RecordedMessagesRequest {
  readonly method: string
  readonly path: string
  readonly headers: IncomingHttpHeaders
  readonly body: Record<string, unknown>
}

/** Running package-private Anthropic Messages fixture. */
/** 中文说明：interface MessagesFixture 定义本测试所需的数据或行为，用于表达子代理进程与协议场景。 */
export interface MessagesFixture {
  readonly baseUrl: string
  readonly requests: RecordedMessagesRequest[]
  readonly requestStarted: Promise<void>
  close(): Promise<void>
}

/** 中文说明：函数 event 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function event(
  response: ServerResponse,
  type: string,
  payload: Record<string, unknown>,
): void {
  response.write(`event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`)
}

/** 中文说明：函数 complete 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function complete(
  response: ServerResponse,
  body: Record<string, unknown>,
  text: string,
): void {
  /** 中文说明：变量 model 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const model = typeof body.model === 'string' ? body.model : 'fixture-model'
  response.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  })
  event(response, 'message_start', {
    type: 'message_start',
    message: {
      id: 'msg_dsh_fixture',
      type: 'message',
      role: 'assistant',
      model,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: {
        input_tokens: 7,
        output_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    },
  })
  event(response, 'content_block_start', {
    type: 'content_block_start',
    index: 0,
    content_block: { type: 'text', text: '' },
  })
  event(response, 'content_block_delta', {
    type: 'content_block_delta',
    index: 0,
    delta: { type: 'text_delta', text },
  })
  event(response, 'content_block_stop', {
    type: 'content_block_stop',
    index: 0,
  })
  event(response, 'message_delta', {
    type: 'message_delta',
    delta: { stop_reason: 'end_turn', stop_sequence: null },
    usage: { output_tokens: 1 },
  })
  event(response, 'message_stop', { type: 'message_stop' })
  response.end()
}

/** 中文说明：函数 toolUse 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function toolUse(
  response: ServerResponse,
  body: Record<string, unknown>,
  toolName: string,
  input: Record<string, unknown>,
): void {
  /** 中文说明：变量 model 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const model = typeof body.model === 'string' ? body.model : 'fixture-model'
  response.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  })
  event(response, 'message_start', {
    type: 'message_start',
    message: {
      id: 'msg_dsh_fixture_tool_use',
      type: 'message',
      role: 'assistant',
      model,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: {
        input_tokens: 7,
        output_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    },
  })
  event(response, 'content_block_start', {
    type: 'content_block_start',
    index: 0,
    content_block: {
      type: 'tool_use',
      id: 'toolu_dsh_fixture',
      name: toolName,
      input: {},
    },
  })
  event(response, 'content_block_delta', {
    type: 'content_block_delta',
    index: 0,
    delta: {
      type: 'input_json_delta',
      partial_json: JSON.stringify(input),
    },
  })
  event(response, 'content_block_stop', {
    type: 'content_block_stop',
    index: 0,
  })
  event(response, 'message_delta', {
    type: 'message_delta',
    delta: { stop_reason: 'tool_use', stop_sequence: null },
    usage: { output_tokens: 1 },
  })
  event(response, 'message_stop', { type: 'message_stop' })
  response.end()
}

/**
 * Start a loopback-only Anthropic Messages SSE fixture.
 * @param behavior - the single response behavior for this fixture.
 * @returns the bound server and its recorded requests.
 */
/** 中文说明：函数 startMessagesFixture 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
export async function startMessagesFixture(
  behavior: MessagesBehavior,
): Promise<MessagesFixture> {
  /** 中文说明：变量 requests 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const requests: RecordedMessagesRequest[] = []
  /** 中文说明：函数值 requestStartedResolve 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
  let requestStartedResolve!: () => void
  /** 中文说明：函数值 requestStarted 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
  const requestStarted = new Promise<void>((resolve) => {
    requestStartedResolve = resolve
  })
  /** 中文说明：函数值 server 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
  const server = createServer((request, response) => {
    /** 中文说明：变量 chunks 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => { chunks.push(chunk) })
    request.on('end', () => {
      /** 中文说明：变量 path 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const path = request.url ?? ''
      if (path !== '/v1/messages' && !path.startsWith('/v1/messages?')) {
        response.writeHead(404, { 'content-type': 'application/json' })
        response.end(JSON.stringify({
          type: 'error',
          error: { type: 'not_found_error', message: `unexpected path ${path}` },
        }))
        return
      }
      /** 中文说明：变量 text 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const text = Buffer.concat(chunks).toString('utf8')
      /** 中文说明：变量 body 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const body = JSON.parse(text) as Record<string, unknown>
      requests.push({
        method: request.method ?? '',
        path,
        headers: request.headers,
        body,
      })
      requestStartedResolve()
      if (behavior.kind === 'complete') {
        complete(response, body, behavior.text)
      } else if (behavior.kind === 'tool-use' && requests.length === 1) {
        toolUse(response, body, behavior.toolName, behavior.input)
      } else if (
        behavior.kind === 'tool-use'
        && behavior.finalText !== undefined
      ) {
        complete(response, body, behavior.finalText)
      }
      // A hold, or a tool-use without final text, waits for client abort.
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
    throw new Error('Messages fixture did not bind a TCP port')
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests,
    requestStarted,
    async close(): Promise<void> {
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error !== undefined) reject(error)
          else resolve()
        })
      })
    },
  }
}
