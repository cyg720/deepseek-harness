/**
 * 文件职责：验证 responses-fixture.ts 覆盖的子代理启动、协议、继承与生命周期行为。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、进程协议或同进程代理驱动。
 * 产品维度：保障 Agent 能可靠委派任务、继承上下文并收集子代理结果。
 * 逻辑维度：准备代理配置，启动或连接子代理，转发事件，再处理结果、取消与清理。
 * 关键边界：异步状态不等于单次任务结果；外部输出不可信；清理必须等待子代理完全停止。
 * 新手阅读建议：先看公开配置和测试夹具，再读启动/事件流程，最后关注继承、取消与失败路径。
 */
import { createServer } from 'node:http'
import type {
  IncomingHttpHeaders,
  IncomingMessage,
  Server,
  ServerResponse,
} from 'node:http'

/** One request observed by the package-private Responses fixture. */
/** 中文说明：interface RecordedResponsesRequest 定义本测试所需的数据或行为，用于表达子代理场景。 */
interface RecordedResponsesRequest {
  readonly method: string | undefined
  readonly path: string | undefined
  readonly headers: IncomingHttpHeaders
  readonly body: Record<string, unknown>
}

/** Behavior consumed by one Responses request. */
/** 中文说明：type ResponsesBehavior 定义本测试所需的数据或行为，用于表达子代理场景。 */
export type ResponsesBehavior =
  | { readonly kind: 'complete'; readonly text: string }
  | { readonly kind: 'error'; readonly status: number; readonly message: string }
  | {
    readonly kind: 'functionCall'
    readonly name: string
    readonly arguments: Record<string, unknown>
  }
  | {
    readonly kind: 'advertisedFunctionCall'
    readonly choices: readonly {
      readonly name: string
      readonly arguments: Record<string, unknown>
    }[]
  }
  | { readonly kind: 'hold' }

/** Running package-private Responses fixture. */
/** 中文说明：interface ResponsesFixture 定义本测试所需的数据或行为，用于表达子代理场景。 */
export interface ResponsesFixture {
  readonly baseUrl: string
  readonly requests: RecordedResponsesRequest[]
  readonly requestStarted: Promise<void>
  close(): Promise<void>
}

/** 中文说明：函数 responseObject 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function responseObject(text: string): Record<string, unknown> {
  /** 中文说明：变量 message 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const message = {
    id: 'msg_fixture',
    type: 'message',
    status: 'completed',
    role: 'assistant',
    content: [{
      type: 'output_text',
      annotations: [],
      logprobs: [],
      text,
    }],
  }
  return {
    id: 'resp_fixture',
    object: 'response',
    created_at: 1,
    status: 'completed',
    background: false,
    error: null,
    incomplete_details: null,
    instructions: null,
    max_output_tokens: null,
    max_tool_calls: null,
    model: 'fixture-model',
    output: [message],
    parallel_tool_calls: true,
    previous_response_id: null,
    prompt_cache_key: null,
    prompt_cache_retention: null,
    reasoning: { effort: null, summary: null },
    safety_identifier: null,
    service_tier: 'default',
    store: false,
    temperature: null,
    text: { format: { type: 'text' }, verbosity: 'medium' },
    tool_choice: 'auto',
    tools: [],
    top_logprobs: 0,
    top_p: null,
    truncation: 'disabled',
    usage: {
      input_tokens: 10,
      input_tokens_details: { cached_tokens: 0 },
      output_tokens: 1,
      output_tokens_details: { reasoning_tokens: 0 },
      total_tokens: 11,
    },
    user: null,
    metadata: {},
  }
}

/**
 * Build the minimal Responses SSE event sequence consumed by Codex 0.147.0.
 * @param text - exact assistant answer.
 * @returns ordered response lifecycle events.
 */
/** 中文说明：函数 completeResponsesEvents 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
export function completeResponsesEvents(text: string): Record<string, unknown>[] {
  /** 中文说明：变量 completed 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const completed = responseObject(text)
  /** 中文说明：变量 message 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const message = (completed.output as Record<string, unknown>[])[0]!
  /** 中文说明：变量 part 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const part = (message.content as Record<string, unknown>[])[0]!
  return [
    {
      type: 'response.created',
      response: { ...completed, status: 'in_progress', output: [] },
    },
    {
      type: 'response.output_item.added',
      output_index: 0,
      item: { ...message, status: 'in_progress', content: [] },
    },
    {
      type: 'response.content_part.added',
      item_id: message.id,
      output_index: 0,
      content_index: 0,
      part: { ...part, text: '' },
    },
    {
      type: 'response.output_text.delta',
      item_id: message.id,
      output_index: 0,
      content_index: 0,
      delta: text,
      logprobs: [],
    },
    {
      type: 'response.output_text.done',
      item_id: message.id,
      output_index: 0,
      content_index: 0,
      text,
      logprobs: [],
    },
    {
      type: 'response.content_part.done',
      item_id: message.id,
      output_index: 0,
      content_index: 0,
      part,
    },
    {
      type: 'response.output_item.done',
      output_index: 0,
      item: message,
    },
    { type: 'response.completed', response: completed },
  ]
}

/** 中文说明：函数 functionCallEvents 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function functionCallEvents(
  name: string,
  argumentsValue: Record<string, unknown>,
): Record<string, unknown>[] {
  /** 中文说明：变量 argumentsText 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const argumentsText = JSON.stringify(argumentsValue)
  /** 中文说明：变量 item 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const item = {
    id: 'fc_fixture',
    type: 'function_call',
    status: 'completed',
    name,
    arguments: argumentsText,
    call_id: 'call_fixture',
  }
  /** 中文说明：变量 completed 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const completed = {
    ...responseObject(''),
    output: [item],
    usage: {
      input_tokens: 10,
      input_tokens_details: { cached_tokens: 0 },
      output_tokens: 5,
      output_tokens_details: { reasoning_tokens: 0 },
      total_tokens: 15,
    },
  }
  return [
    {
      type: 'response.created',
      response: { ...completed, status: 'in_progress', output: [] },
    },
    {
      type: 'response.output_item.added',
      output_index: 0,
      item: { ...item, status: 'in_progress', arguments: '' },
    },
    {
      type: 'response.function_call_arguments.delta',
      item_id: item.id,
      output_index: 0,
      delta: argumentsText,
    },
    {
      type: 'response.function_call_arguments.done',
      item_id: item.id,
      output_index: 0,
      arguments: argumentsText,
    },
    {
      type: 'response.output_item.done',
      output_index: 0,
      item,
    },
    { type: 'response.completed', response: completed },
  ]
}

/** 中文说明：函数 readRequest 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function readRequest(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    /** 中文说明：变量 body 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let body = ''
    request.setEncoding('utf8')
    request.on('data', (chunk: string) => { body += chunk })
    request.on('end', () => { resolve(body) })
    request.on('error', reject)
  })
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

/** 中文说明：函数 advertisedFunctionNames 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function advertisedFunctionNames(body: Record<string, unknown>): Set<string> {
  if (!Array.isArray(body.tools)) return new Set()
  return new Set(body.tools.flatMap((tool): string[] => (
    tool !== null
    && typeof tool === 'object'
    && (tool as Record<string, unknown>).type === 'function'
    && typeof (tool as Record<string, unknown>).name === 'string'
      ? [(tool as Record<string, unknown>).name as string]
      : []
  )))
}

/**
 * Start a loopback-only Responses SSE fixture.
 * @param script - one behavior per expected Responses request.
 * @returns the running fixture and its observed requests.
 */
/** 中文说明：函数 startResponsesFixture 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
export async function startResponsesFixture(
  script: readonly ResponsesBehavior[],
): Promise<ResponsesFixture> {
  /** 中文说明：变量 behaviors 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const behaviors = [...script]
  /** 中文说明：变量 requests 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const requests: RecordedResponsesRequest[] = []
  /** 中文说明：变量 started 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const started = Promise.withResolvers<undefined>()
  /** 中文说明：变量 openResponses 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const openResponses = new Set<ServerResponse>()
  /** 中文说明：函数值 server 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
  const server = createServer((request, response) => {
    openResponses.add(response)
    response.on('close', () => { openResponses.delete(response) })
    void readRequest(request).then((body) => {
      /** 中文说明：变量 parsedBody 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const parsedBody = JSON.parse(body) as Record<string, unknown>
      requests.push({
        method: request.method,
        path: request.url,
        headers: request.headers,
        body: parsedBody,
      })
      started.resolve(undefined)
      /** 中文说明：变量 behavior 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const behavior = behaviors.shift()
      if (behavior === undefined) {
        response.writeHead(500, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ error: { message: 'fixture script exhausted' } }))
        return
      }
      /** 中文说明：变量 advertisedCall 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const advertisedCall = behavior.kind === 'advertisedFunctionCall'
        ? behavior.choices.find(choice => advertisedFunctionNames(parsedBody).has(choice.name))
        : undefined
      if (behavior.kind === 'advertisedFunctionCall' && advertisedCall === undefined) {
        response.writeHead(500, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ error: { message: 'none of the fixture function calls was advertised' } }))
        return
      }
      if (behavior.kind === 'error') {
        response.writeHead(behavior.status, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ error: { message: behavior.message } }))
        return
      }
      response.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
        'x-request-id': 'req_fixture',
      })
      if (behavior.kind === 'hold') return
      /** 中文说明：变量 events 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      let events: Record<string, unknown>[]
      if (behavior.kind === 'complete') {
        events = completeResponsesEvents(behavior.text)
      } else {
        /** 中文说明：变量 call 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const call = behavior.kind === 'functionCall'
          ? behavior
          : advertisedCall!
        events = functionCallEvents(call.name, call.arguments)
      }
      /** 中文说明：该循环依次处理代理事件；循环变量仅在当前循环中有效。 */
      for (const event of events) {
        response.write(`data: ${JSON.stringify(event)}\n\n`)
      }
      response.end('data: [DONE]\n\n')
    }).catch((error: unknown) => {
      response.destroy(error instanceof Error ? error : new Error(String(error)))
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
    throw new Error('responses fixture did not acquire a TCP port')
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    requests,
    requestStarted: started.promise,
    async close(): Promise<void> {
      /** 中文说明：该循环依次处理代理事件；循环变量仅在当前循环中有效。 */
      for (const response of openResponses) response.destroy()
      await closeServer(server)
    },
  }
}
