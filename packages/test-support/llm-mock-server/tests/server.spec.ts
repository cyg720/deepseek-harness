/**
 * 文件职责：验证 server.spec.ts 覆盖的Agent 预设行为与边界场景。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、异步协议、进程资源或仓库文本分析。
 * 产品维度：保障 Agent 的Agent 预设能力稳定、可复现且可诊断。
 * 逻辑维度：准备输入和夹具，执行被测或验证流程，再核对结果、错误与资源清理。
 * 关键边界：中文测试字符串不是注释；外部数据不可信；异步资源必须完全释放。
 * 新手阅读建议：先看夹具和公开类型，再读正常流程，最后关注中文输入、失败与清理场景。
 */
import { request } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import type { MockLlmBehavior, MockLlmServer, MockLlmServerEvent } from '../src/index.ts'
import { startMockLlmServer } from '../src/index.ts'

/** 中文说明：变量 running 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const running: MockLlmServer[] = []

afterEach(async () => {
  await Promise.all(running.splice(0).map(server => server.close()))
})

/** 中文说明：函数 start 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function start(
  sequence: readonly MockLlmBehavior[],
  options: Omit<Parameters<typeof startMockLlmServer>[0], 'sequence'> = {},
): Promise<MockLlmServer> {
  /** 中文说明：变量 server 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const server = await startMockLlmServer({ sequence, ...options })
  running.push(server)
  return server
}

/** 中文说明：函数 chat 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function chat(
  server: MockLlmServer,
  options: { path?: string; key?: string; body?: string; signal?: AbortSignal } = {},
): Promise<Response> {
  return fetch(`${server.baseURL}${options.path ?? '/v1/chat/completions'}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...options.key === undefined ? {} : { authorization: `Bearer ${options.key}` },
    },
    body: options.body ?? JSON.stringify({ model: 'mock', messages: [], stream: true }),
    ...options.signal === undefined ? {} : { signal: options.signal },
  })
}

/** 中文说明：函数 rawChat 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function rawChat(server: MockLlmServer, chunks: readonly Buffer[]): Promise<void> {
  return new Promise((resolve, reject) => {
    /** 中文说明：变量 outgoing 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const outgoing = request(`${server.baseURL}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    }, (response) => {
      response.once('error', reject)
      response.once('end', resolve)
      response.resume()
    })
    outgoing.once('error', reject)
    /** 中文说明：该循环依次处理输入或事件；循环变量仅在当前循环中有效。 */
    for (const chunk of chunks) outgoing.write(chunk)
    outgoing.end()
  })
}

describe('mock LLM server wire behaviors', () => {
  it('streams a complete text response and captures the request', async () => {
    /** 中文说明：变量 events 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const events: MockLlmServerEvent[] = []
    /** 中文说明：变量 server 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const server = await start(['success'], {
      apiKey: 'mock-key',
      successText: 'recovered',
      chunkSize: 3,
      onEvent: (event) => { events.push(event) },
    })

    /** 中文说明：变量 response 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const response = await chat(server, { key: 'mock-key' })
    /** 中文说明：变量 body 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const body = await response.text()

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/event-stream')
    expect(body).toContain('"content":"rec"')
    expect(body).toContain('"content":"ove"')
    expect(body).toContain('"content":"red"')
    expect(body).toContain('"finish_reason":"stop"')
    expect(body).toContain('data: [DONE]')
    expect(server.requests).toEqual([expect.objectContaining({
      attempt: 1,
      behavior: 'success',
      path: '/v1/chat/completions',
      body: { model: 'mock', messages: [], stream: true },
      chunksSent: 5,
      outcome: 'completed',
    })])
    expect(events).toEqual([
      {
        type: 'request',
        attempt: 1,
        scriptBehavior: 'success',
        behavior: 'success',
        path: '/v1/chat/completions',
      },
      {
        type: 'result',
        attempt: 1,
        scriptBehavior: 'success',
        behavior: 'success',
        outcome: 'completed',
        chunksSent: 5,
      },
    ])
  })

  it('supports root paths and intentionally ignores telemetry observer failures', async () => {
    /** 中文说明：变量 server 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const server = await start(['empty'], {
      onEvent() {
        throw new Error('observer failed')
      },
    })
    /** 中文说明：变量 response 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const response = await chat(server, { path: '/chat/completions' })

    expect(response.status).toBe(200)
    expect(await response.text()).toContain('data: [DONE]')
    expect(server.requests[0]).toMatchObject({ path: '/chat/completions', outcome: 'completed' })
  })

  it.each([
    ['empty_body', 0, ''] as const,
    ['stream_eof', 1, '"role":"assistant"'] as const,
    ['partial_eof', 1, 'discarded partial response'] as const,
    ['malformed_json', 2, 'data: {not-json'] as const,
    ['malformed_event', 2, '"choices":[null]'] as const,
  ])('serves %s without inventing a terminal completion', async (behavior, chunks, marker) => {
    /** 中文说明：变量 server 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const server = await start([behavior], { chunkSize: 100 })
    /** 中文说明：变量 response 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const response = await chat(server)
    /** 中文说明：变量 body 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const body = await response.text()

    expect(response.status).toBe(200)
    expect(body).toContain(marker)
    if (behavior !== 'malformed_json' && behavior !== 'malformed_event') {
      expect(body).not.toContain('[DONE]')
    }
    expect(server.requests[0]).toMatchObject({ behavior, chunksSent: chunks, outcome: 'completed' })
  })

  it.each([
    ['connection_reset', false] as const,
    ['stream_disconnect', true] as const,
    ['partial_disconnect', true] as const,
  ])('forces the %s transport boundary', async (behavior, receivesHeaders) => {
    /** 中文说明：变量 server 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const server = await start([behavior], { disconnectDelayMs: 20, partialText: 'half' })

    /** 中文说明：变量 headersReceived 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let headersReceived = false
    await expect((async () => {
      /** 中文说明：变量 response 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const response = await chat(server)
      headersReceived = true
      await response.text()
    })()).rejects.toThrow()

    expect(headersReceived).toBe(receivesHeaders)
    expect(server.requests[0]).toMatchObject({
      behavior,
      chunksSent: behavior === 'partial_disconnect' ? 1 : 0,
      outcome: 'reset',
    })
  })

  it('holds a stalled stream until the client aborts and server close remains idempotent', async () => {
    /** 中文说明：变量 server 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const server = await start(['stall'])
    /** 中文说明：变量 controller 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const controller = new AbortController()
    /** 中文说明：变量 response 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const response = await chat(server, { signal: controller.signal })

    expect(response.status).toBe(200)
    expect(server.requests[0]).toMatchObject({ behavior: 'stall', outcome: 'stalled' })
    controller.abort()
    await expect(response.text()).rejects.toThrow()
    await server.close()
    await server.close()
  })

  it.each([
    ['slow_success', 100] as const,
    ['stream_disconnect', 100] as const,
    ['partial_disconnect', 100] as const,
  ])('records a client that closes during %s', async (behavior, delayMs) => {
    /** 中文说明：变量 events 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const events: MockLlmServerEvent[] = []
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = Promise.withResolvers<Extract<MockLlmServerEvent, { type: 'result' }>>()
    /** 中文说明：变量 server 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const server = await start([behavior], {
      chunkDelayMs: delayMs,
      disconnectDelayMs: delayMs,
      chunkSize: 1,
      onEvent: (event) => {
        events.push(event)
        if (event.type === 'result') result.resolve(event)
      },
    })
    /** 中文说明：变量 controller 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const controller = new AbortController()
    /** 中文说明：变量 response 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const response = await chat(server, { signal: controller.signal })
    controller.abort()
    await expect(response.text()).rejects.toThrow()
    await result.promise

    expect(server.requests[0]).toMatchObject({ behavior, outcome: 'client_closed' })
    expect(events.filter(event => event.type === 'result')).toEqual([
      expect.objectContaining({ behavior, outcome: 'client_closed' }),
    ])
  })

  it('preserves UTF-8 code points split across request chunks', async () => {
    /** 中文说明：变量 server 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const server = await start(['success'])
    /** 中文说明：变量 encoded 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const encoded = Buffer.from(JSON.stringify({ messages: [{ role: 'user', content: '你好' }] }))
    /** 中文说明：变量 characterOffset 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const characterOffset = encoded.indexOf(Buffer.from('你'))
    expect(characterOffset).toBeGreaterThanOrEqual(0)

    await rawChat(server, [
      encoded.subarray(0, characterOffset + 1),
      encoded.subarray(characterOffset + 1),
    ])

    expect(server.requests[0]?.body).toEqual({ messages: [{ role: 'user', content: '你好' }] })
  })

  it('formats an IPv6 listener as a valid base URL', async () => {
    /** 中文说明：变量 server 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const server = await start(['success'], { host: '::1' })

    expect(server.baseURL).toMatch(/^http:\/\/\[::1\]:\d+$/)
    expect((await chat(server)).status).toBe(200)
  })

  it('emits reasoning, tool calls, max-token finishes, slow chunks, and a wrong content type', async () => {
    /** 中文说明：变量 server 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const server = await start([
      'reasoning_success',
      'tool_call_success',
      'max_tokens',
      'slow_success',
      'wrong_content_type',
    ], {
      successText: 'answer',
      reasoningText: 'think',
      toolName: 'lookup',
      toolArguments: '{"id":7}',
      chunkDelayMs: 1,
      chunkSize: 2,
    })

    /** 中文说明：变量 bodies 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const bodies: string[] = []
    /** 中文说明：变量 contentTypes 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const contentTypes: Array<string | null> = []
    /** 中文说明：该循环依次处理输入或事件；循环变量仅在当前循环中有效。 */
    for (let index = 0; index < 5; index += 1) {
      /** 中文说明：变量 response 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const response = await chat(server)
      contentTypes.push(response.headers.get('content-type'))
      bodies.push(await response.text())
    }

    expect(bodies[0]).toContain('"reasoning_content":"th"')
    expect(bodies[1]).toContain('"name":"lookup"')
    expect(bodies[1]).toContain('"arguments":"{\\"id"')
    expect(bodies[1]).toContain('"finish_reason":"tool_calls"')
    expect(bodies[2]).toContain('"finish_reason":"length"')
    expect(bodies[3]).toContain('"finish_reason":"stop"')
    expect(contentTypes[4]).toBe('application/json')
    expect(server.requests).toHaveLength(5)
    expect(server.requests.every(record => record.outcome === 'completed')).toBe(true)
  })

  it.each([
    ['rate_limit', 429, 'mock rate limit'] as const,
    ['server_error', 500, 'mock server error'] as const,
    ['service_unavailable', 503, 'mock service unavailable'] as const,
    ['auth_error', 401, 'mock authentication failed'] as const,
    ['invalid_request', 400, 'mock invalid request'] as const,
    ['context_overflow', 400, 'context_length_exceeded'] as const,
    ['quota_exceeded', 429, 'insufficient_quota'] as const,
  ])('serves %s as a structured HTTP error', async (behavior, status, marker) => {
    /** 中文说明：变量 server 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const server = await start([behavior], { retryAfterMs: 1_001, requestId: 'mock-request-1' })
    /** 中文说明：变量 response 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const response = await chat(server)
    /** 中文说明：变量 body 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const body = await response.text()

    expect(response.status).toBe(status)
    expect(body).toContain(marker)
    expect(response.headers.get('x-request-id')).toBe('mock-request-1')
    if (behavior === 'rate_limit') expect(response.headers.get('retry-after')).toBe('2')
    else expect(response.headers.get('retry-after')).toBeNull()
    expect(server.requests[0]?.outcome).toBe('completed')
  })

  it('fails loud on script exhaustion and can explicitly repeat the final behavior', async () => {
    /** 中文说明：变量 exhausted 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const exhausted = await start(['success'], { successText: 'once' })
    await (await chat(exhausted)).text()
    /** 中文说明：变量 exhaustedResponse 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const exhaustedResponse = await chat(exhausted)
    expect(exhaustedResponse.status).toBe(500)
    expect(await exhaustedResponse.text()).toContain('mock script exhausted')
    expect(exhausted.requests.map(record => record.behavior)).toEqual(['success', 'script_exhausted'])

    /** 中文说明：变量 repeating 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const repeating = await start(['empty'], { repeatLast: true })
    await (await chat(repeating)).text()
    await (await chat(repeating)).text()
    expect(repeating.requests.map(record => record.behavior)).toEqual(['empty', 'empty'])
  })

  it('selects weighted random behaviors reproducibly and reports the concrete choice', async () => {
    /** 中文说明：变量 options 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const options = {
      sequence: ['random'] as const,
      repeatLast: true,
      randomSeed: 42,
      randomWeights: { success: 1, empty: 1 },
      successText: 'random success',
    }
    /** 中文说明：变量 first 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const first = await startMockLlmServer(options)
    /** 中文说明：变量 second 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const second = await startMockLlmServer(options)
    running.push(first, second)

    /** 中文说明：该循环依次处理输入或事件；循环变量仅在当前循环中有效。 */
    for (let attempt = 0; attempt < 12; attempt += 1) {
      await (await chat(first)).text()
      await (await chat(second)).text()
    }

    /** 中文说明：函数值 firstChoices 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const firstChoices = first.requests.map(record => record.behavior)
    expect(first.randomSeed).toBe(42)
    expect(second.randomSeed).toBe(42)
    expect(firstChoices).toEqual(second.requests.map(record => record.behavior))
    expect(new Set(firstChoices)).toEqual(new Set(['success', 'empty']))
    expect(first.requests.every(record => record.scriptBehavior === 'random')).toBe(true)
  })

  it('rejects invalid method, route, bearer token, and JSON without consuming the script', async () => {
    /** 中文说明：变量 server 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const server = await start(['success'], { apiKey: 'expected' })
    /** 中文说明：变量 method 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const method = await fetch(`${server.baseURL}/v1/chat/completions`)
    /** 中文说明：变量 route 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const route = await fetch(`${server.baseURL}/v1/other`, { method: 'POST', body: '{}' })
    /** 中文说明：变量 auth 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const auth = await chat(server, { key: 'wrong' })
    /** 中文说明：变量 json 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const json = await chat(server, { key: 'expected', body: '{' })

    expect(method.status).toBe(405)
    expect(method.headers.get('allow')).toBe('POST')
    expect(route.status).toBe(404)
    expect(auth.status).toBe(401)
    expect(json.status).toBe(400)
    expect(server.requests).toHaveLength(0)

    /** 中文说明：变量 emptyRequest 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const emptyRequest = await fetch(`${server.baseURL}/v1/chat/completions`, {
      method: 'POST',
      headers: { authorization: 'Bearer expected' },
    })
    expect(emptyRequest.status).toBe(200)
    expect(server.requests[0]?.behavior).toBe('success')
    expect(server.requests[0]?.body).toBeUndefined()
  })
})

describe('mock LLM server option validation', () => {
  it.each([
    [{ sequence: [] }, /sequence/],
    [{ sequence: ['success'], host: '' }, /host/],
    [{ sequence: ['success'], port: -1 }, /port/],
    [{ sequence: ['success'], port: 65_536 }, /port/],
    [{ sequence: ['success'], apiKey: '' }, /apiKey/],
    [{ sequence: ['success'], successText: '' }, /successText/],
    [{ sequence: ['success'], partialText: '' }, /partialText/],
    [{ sequence: ['success'], reasoningText: '' }, /reasoningText/],
    [{ sequence: ['success'], chunkSize: 0 }, /chunkSize/],
    [{ sequence: ['success'], chunkDelayMs: -1 }, /chunkDelayMs/],
    [{ sequence: ['success'], disconnectDelayMs: Number.POSITIVE_INFINITY }, /disconnectDelayMs/],
    [{ sequence: ['success'], retryAfterMs: 0 }, /retryAfterMs/],
    [{ sequence: ['success'], requestId: '' }, /requestId/],
    [{ sequence: ['success'], toolName: '' }, /toolName/],
    [{ sequence: ['success'], toolArguments: '{' }, /toolArguments/],
    [{ sequence: ['random'], randomSeed: -1 }, /randomSeed/],
    [{ sequence: ['random'], randomWeights: { random: 1 } }, /unknown concrete behavior/],
    [{ sequence: ['random'], randomWeights: { success: -1 } }, /non-negative/],
    [{ sequence: ['random'], randomWeights: { success: 0 } }, /positive weight/],
  ] as const)('rejects invalid options %#', async (options, expected) => {
    await expect(startMockLlmServer(options as Parameters<typeof startMockLlmServer>[0]))
      .rejects.toThrow(expected)
  })
})
