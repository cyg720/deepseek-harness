/**
 * Scriptable OpenAI-compatible HTTP/SSE server for transport, protocol, and
 * semantic-empty LLM recovery tests. Each accepted chat-completions request
 * consumes one behavior; the server never retries or interprets harness policy.
 *
 * @module @deepseek-ai/dsh-llm-mock-server
 */
/*
 * 文件职责：实现 index.ts 覆盖的LLM 测试替身行为与测试协作。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、快照、模拟服务器或类型生成。
 * 产品维度：通过可复现的LLM 测试替身能力保障 Agent 功能在集成层稳定。
 * 逻辑维度：准备夹具或输入，执行装载/生成/调用流程，再规范化并核对结果。
 * 关键边界：夹具必须确定且跨平台；模型可见状态应可重放；临时资源必须释放。
 * 新手阅读建议：先看导出类型和夹具，再读主流程，最后关注规范化、失败和清理。
 */

import { createServer } from 'node:http'
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'node:http'
import { randomBytes } from 'node:crypto'
import { isIP, type AddressInfo } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'

/** Request-scoped behaviors accepted by {@link startMockLlmServer}. */
/* 中文说明：常量 MOCK_LLM_BEHAVIORS 保存本模块共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
export const MOCK_LLM_BEHAVIORS = [
  'connection_reset',
  'stream_disconnect',
  'empty',
  'empty_body',
  'stream_eof',
  'partial_eof',
  'partial_disconnect',
  'stall',
  'malformed_json',
  'malformed_event',
  'wrong_content_type',
  'rate_limit',
  'server_error',
  'service_unavailable',
  'auth_error',
  'invalid_request',
  'context_overflow',
  'quota_exceeded',
  'success',
  'reasoning_success',
  'tool_call_success',
  'max_tokens',
  'slow_success',
  'random',
] as const

/** One scripted mock behavior name; `random` selects a concrete behavior per request. */
/* 中文说明：type MockLlmBehavior 定义本模块所需的数据或行为，用于表达LLM 测试替身场景。 */
export type MockLlmBehavior = typeof MOCK_LLM_BEHAVIORS[number]

/** One concrete request behavior after resolving a `random` script entry. */
/* 中文说明：type ConcreteMockLlmBehavior 定义本模块所需的数据或行为，用于表达LLM 测试替身场景。 */
export type ConcreteMockLlmBehavior = Exclude<MockLlmBehavior, 'random'>

/** Relative non-negative weights for random request behavior selection. */
/* 中文说明：type MockLlmRandomWeights 定义本模块所需的数据或行为，用于表达LLM 测试替身场景。 */
export type MockLlmRandomWeights = Partial<Record<ConcreteMockLlmBehavior, number>>

/**
 * Default stress profile for `random`. Weights are configurable test pressure,
 * not a claim about production incident frequency.
 */
/* 中文说明：常量 DEFAULT_MOCK_LLM_RANDOM_WEIGHTS 保存本模块共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
export const DEFAULT_MOCK_LLM_RANDOM_WEIGHTS: Readonly<MockLlmRandomWeights> = Object.freeze({
  success: 48,
  slow_success: 10,
  max_tokens: 2,
  connection_reset: 5,
  stream_disconnect: 5,
  partial_disconnect: 10,
  empty: 5,
  stall: 2,
  rate_limit: 5,
  server_error: 4,
  service_unavailable: 2,
  partial_eof: 1,
  malformed_json: 1,
})

/** Largest millisecond delay accepted by Node timers without truncation. */
/* 中文说明：常量 MAX_MOCK_LLM_TIMER_DELAY_MS 保存本模块共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
export const MAX_MOCK_LLM_TIMER_DELAY_MS = 2_147_483_647

/** How one accepted request ended at the mock boundary. */
/* 中文说明：type MockLlmRequestOutcome 定义本模块所需的数据或行为，用于表达LLM 测试替身场景。 */
export type MockLlmRequestOutcome = 'completed' | 'reset' | 'stalled' | 'client_closed' | 'server_error'

/** Immutable telemetry emitted when a request starts or reaches an outcome. */
/* 中文说明：type MockLlmServerEvent 定义本模块所需的数据或行为，用于表达LLM 测试替身场景。 */
export type MockLlmServerEvent =
  | {
    readonly type: 'request'
    readonly attempt: number
    readonly scriptBehavior: MockLlmBehavior | 'script_exhausted'
    readonly behavior: ConcreteMockLlmBehavior | 'script_exhausted'
    readonly path: string
  }
  | {
    readonly type: 'result'
    readonly attempt: number
    readonly scriptBehavior: MockLlmBehavior | 'script_exhausted'
    readonly behavior: ConcreteMockLlmBehavior | 'script_exhausted'
    readonly outcome: MockLlmRequestOutcome
    readonly chunksSent: number
  }

/** Captured wire request and its final server-side outcome. */
/* 中文说明：interface MockLlmRequestRecord 定义本模块所需的数据或行为，用于表达LLM 测试替身场景。 */
export interface MockLlmRequestRecord {
  /** One-based accepted chat-completions request number. */
  readonly attempt: number
  /** Script entry consumed for this request before random resolution. */
  readonly scriptBehavior: MockLlmBehavior | 'script_exhausted'
  /** Concrete behavior selected for this request, or exhaustion after the configured script. */
  readonly behavior: ConcreteMockLlmBehavior | 'script_exhausted'
  /** Original request path, including a `/v1` prefix when the client supplied one. */
  readonly path: string
  /** Detached request headers. */
  readonly headers: Readonly<IncomingHttpHeaders>
  /** Parsed JSON request body. */
  readonly body: unknown
  /** Number of SSE `data:` events handed to Node before the outcome. */
  chunksSent: number
  /** Final server-side outcome; absent while a stalled request remains open. */
  outcome?: MockLlmRequestOutcome
}

/** Configuration for one mock server instance. */
/* 中文说明：interface MockLlmServerOptions 定义本模块所需的数据或行为，用于表达LLM 测试替身场景。 */
export interface MockLlmServerOptions {
  /** Loopback host by default. */
  readonly host?: string
  /** TCP port; zero requests an OS-assigned port. */
  readonly port?: number
  /** Optional exact bearer token; omission accepts any authorization header. */
  readonly apiKey?: string
  /** Ordered request behaviors; exhaustion fails loud unless `repeatLast` is true. */
  readonly sequence: readonly MockLlmBehavior[]
  /** Reuse the final behavior after the sequence is consumed. */
  readonly repeatLast?: boolean
  /** Optional deterministic unsigned 32-bit seed; omission generates and exposes one. */
  readonly randomSeed?: number
  /** Relative weights used whenever a script entry is `random`. */
  readonly randomWeights?: Readonly<MockLlmRandomWeights>
  /** Complete text returned by success-shaped behaviors. */
  readonly successText?: string
  /** Text emitted before partial EOF/reset behaviors terminate. */
  readonly partialText?: string
  /** Reasoning text emitted by `reasoning_success`. */
  readonly reasoningText?: string
  /** Unicode code-point count per text or reasoning SSE delta. */
  readonly chunkSize?: number
  /** Inter-chunk delay for `slow_success`, in milliseconds. */
  readonly chunkDelayMs?: number
  /** Delay after headers/deltas before a forced disconnect, in milliseconds. */
  readonly disconnectDelayMs?: number
  /** Provider retry delay; the wire `Retry-After` value rounds up to whole seconds. */
  readonly retryAfterMs?: number
  /** Optional provider request id returned on HTTP failures. */
  readonly requestId?: string
  /** Tool name emitted by `tool_call_success`. */
  readonly toolName?: string
  /** Raw JSON arguments emitted by `tool_call_success`. */
  readonly toolArguments?: string
  /** Optional observer for JSONL CLI telemetry; observer failures never affect wire behavior. */
  readonly onEvent?: (event: MockLlmServerEvent) => void
}

/** Running mock server and captured request state. */
/* 中文说明：interface MockLlmServer 定义本模块所需的数据或行为，用于表达LLM 测试替身场景。 */
export interface MockLlmServer {
  /** Base URL without `/v1`; both root and `/v1` chat-completions paths are accepted. */
  readonly baseURL: string
  /** Actual bound port, including an OS-assigned value. */
  readonly port: number
  /** Seed used for random behavior selection, including the generated default. */
  readonly randomSeed: number
  /** Live request records in arrival order. */
  readonly requests: readonly MockLlmRequestRecord[]
  /** Stop accepting requests and force-close stalled/streaming connections; idempotent. */
  close(): Promise<void>
}

/** 中文说明：interface ResolvedOptions 定义本模块所需的数据或行为，用于表达LLM 测试替身场景。 */
interface ResolvedOptions {
  readonly host: string
  readonly port: number
  readonly apiKey?: string
  readonly sequence: readonly MockLlmBehavior[]
  readonly lastBehavior: MockLlmBehavior
  readonly repeatLast: boolean
  readonly randomSeed: number
  readonly randomWeights: readonly (readonly [ConcreteMockLlmBehavior, number])[]
  readonly successText: string
  readonly partialText: string
  readonly reasoningText: string
  readonly chunkSize: number
  readonly chunkDelayMs: number
  readonly disconnectDelayMs: number
  readonly retryAfterMs: number
  readonly requestId?: string
  readonly toolName: string
  readonly toolArguments: string
  readonly onEvent?: (event: MockLlmServerEvent) => void
}

/** 中文说明：常量 DEFAULT_SUCCESS_TEXT 保存本模块共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const DEFAULT_SUCCESS_TEXT = 'mock response recovered'
/** 中文说明：常量 DEFAULT_PARTIAL_TEXT 保存本模块共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const DEFAULT_PARTIAL_TEXT = 'discarded partial response'
/** 中文说明：常量 DEFAULT_REASONING_TEXT 保存本模块共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const DEFAULT_REASONING_TEXT = 'mock reasoning'
/** 中文说明：函数值 CONCRETE_BEHAVIORS 封装本模块的局部步骤；参数和返回值由右侧签名约束；示例见本模块调用。 */
const CONCRETE_BEHAVIORS = new Set<string>(MOCK_LLM_BEHAVIORS.filter(behavior => behavior !== 'random'))

/** 中文说明：函数 boundedInteger 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function boundedInteger(name: string, value: number, min: number, max: number): number {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`llm-mock-server: ${name} must be an integer between ${min} and ${max}`)
  }
  return value
}

/** 中文说明：函数 resolveOptions 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function resolveOptions(options: MockLlmServerOptions): ResolvedOptions {
  /** 中文说明：变量 host 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const host = options.host ?? '127.0.0.1'
  /** 中文说明：变量 port 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const port = boundedInteger('port', options.port ?? 0, 0, 65_535)
  /** 中文说明：变量 chunkSize 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const chunkSize = boundedInteger('chunkSize', options.chunkSize ?? 8, 1, Number.MAX_SAFE_INTEGER)
  /** 中文说明：变量 chunkDelayMs 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const chunkDelayMs = boundedInteger(
    'chunkDelayMs',
    options.chunkDelayMs ?? 25,
    0,
    MAX_MOCK_LLM_TIMER_DELAY_MS,
  )
  /** 中文说明：变量 disconnectDelayMs 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const disconnectDelayMs = boundedInteger(
    'disconnectDelayMs',
    options.disconnectDelayMs ?? 10,
    0,
    MAX_MOCK_LLM_TIMER_DELAY_MS,
  )
  /** 中文说明：变量 retryAfterMs 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const retryAfterMs = boundedInteger(
    'retryAfterMs',
    options.retryAfterMs ?? 1_000,
    1,
    MAX_MOCK_LLM_TIMER_DELAY_MS,
  )
  /** 中文说明：变量 randomSeed 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const randomSeed = boundedInteger(
    'randomSeed',
    options.randomSeed ?? randomBytes(4).readUInt32LE(0),
    0,
    0xffff_ffff,
  )
  /** 中文说明：变量 successText 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const successText = options.successText ?? DEFAULT_SUCCESS_TEXT
  /** 中文说明：变量 partialText 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const partialText = options.partialText ?? DEFAULT_PARTIAL_TEXT
  /** 中文说明：变量 reasoningText 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const reasoningText = options.reasoningText ?? DEFAULT_REASONING_TEXT
  /** 中文说明：变量 toolName 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const toolName = options.toolName ?? 'mock_tool'
  /** 中文说明：变量 toolArguments 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const toolArguments = options.toolArguments ?? '{"value":"mock"}'

  if (host.length === 0) throw new Error('llm-mock-server: host must not be empty')
  if (options.sequence.length === 0) throw new Error('llm-mock-server: sequence must not be empty')
  /** 中文说明：函数值 lastBehavior 封装本模块的局部步骤；参数和返回值由右侧签名约束；示例见本模块调用。 */
  const lastBehavior = options.sequence.reduce((_previous, behavior) => behavior)
  if (options.apiKey === '') throw new Error('llm-mock-server: apiKey must not be empty')
  if (successText.length === 0) throw new Error('llm-mock-server: successText must not be empty')
  if (partialText.length === 0) throw new Error('llm-mock-server: partialText must not be empty')
  if (reasoningText.length === 0) throw new Error('llm-mock-server: reasoningText must not be empty')
  if (toolName.length === 0) throw new Error('llm-mock-server: toolName must not be empty')
  if (options.requestId === '') throw new Error('llm-mock-server: requestId must not be empty')
  try {
    JSON.parse(toolArguments)
  } catch {
    throw new Error('llm-mock-server: toolArguments must be valid JSON')
  }

  /** 中文说明：变量 configuredWeights 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const configuredWeights = options.randomWeights ?? DEFAULT_MOCK_LLM_RANDOM_WEIGHTS
  /** 中文说明：变量 randomWeights 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const randomWeights: Array<readonly [ConcreteMockLlmBehavior, number]> = []
  /** 中文说明：该循环依次处理夹具或生成数据；循环变量仅在当前循环中有效。 */
  for (const [behavior, weight] of Object.entries(configuredWeights)) {
    if (!CONCRETE_BEHAVIORS.has(behavior)) {
      throw new Error(`llm-mock-server: randomWeights contains unknown concrete behavior ${JSON.stringify(behavior)}`)
    }
    if (!Number.isFinite(weight) || weight < 0) {
      throw new Error(`llm-mock-server: random weight for ${behavior} must be a non-negative finite number`)
    }
    if (weight > 0) randomWeights.push([behavior as ConcreteMockLlmBehavior, weight])
  }
  if (randomWeights.length === 0) {
    throw new Error('llm-mock-server: randomWeights must contain at least one positive weight')
  }

  return {
    host,
    port,
    ...options.apiKey === undefined ? {} : { apiKey: options.apiKey },
    sequence: [...options.sequence],
    lastBehavior,
    repeatLast: options.repeatLast ?? false,
    randomSeed,
    randomWeights,
    successText,
    partialText,
    reasoningText,
    chunkSize,
    chunkDelayMs,
    disconnectDelayMs,
    retryAfterMs,
    ...options.requestId === undefined ? {} : { requestId: options.requestId },
    toolName,
    toolArguments,
    ...options.onEvent === undefined ? {} : { onEvent: options.onEvent },
  }
}

/** 中文说明：函数 emit 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function emit(options: ResolvedOptions, event: MockLlmServerEvent): void {
  try {
    options.onEvent?.(Object.freeze(event))
  } catch (_telemetryObserverFailure) {
    // Test telemetry is observational; a broken observer cannot change provider wire behavior.
  }
}

/** 中文说明：函数 readJsonBody 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  /** 中文说明：变量 chunks 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const chunks: Buffer[] = []
  /** 中文说明：该循环依次处理夹具或生成数据；循环变量仅在当前循环中有效。 */
  for await (const chunk of request) chunks.push(Buffer.from(chunk as Uint8Array))
  /** 中文说明：变量 body 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const body = Buffer.concat(chunks).toString('utf8')
  return body.length === 0 ? undefined : JSON.parse(body)
}

/** 中文说明：函数 splitText 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function splitText(text: string, size: number): string[] {
  /** 中文说明：变量 points 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const points = Array.from(text)
  /** 中文说明：变量 chunks 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const chunks: string[] = []
  /** 中文说明：该循环依次处理夹具或生成数据；循环变量仅在当前循环中有效。 */
  for (let index = 0; index < points.length; index += size) chunks.push(points.slice(index, index + size).join(''))
  return chunks
}

/** 中文说明：函数 openSse 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function openSse(response: ServerResponse, contentType = 'text/event-stream; charset=utf-8'): void {
  response.writeHead(200, {
    'content-type': contentType,
    'cache-control': 'no-cache',
    'connection': 'keep-alive',
  })
  response.flushHeaders()
}

/** 中文说明：函数 writeSse 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function writeSse(record: MockLlmRequestRecord, response: ServerResponse, payload: unknown): void {
  response.write(`data: ${typeof payload === 'string' ? payload : JSON.stringify(payload)}\n\n`)
  record.chunksSent += 1
}

/** 中文说明：函数 writeDone 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function writeDone(record: MockLlmRequestRecord, response: ServerResponse): void {
  writeSse(record, response, '[DONE]')
}

/** 中文说明：函数 finishRecord 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function finishRecord(
  options: ResolvedOptions,
  record: MockLlmRequestRecord,
  outcome: MockLlmRequestOutcome,
): void {
  if (record.outcome !== undefined) return
  record.outcome = outcome
  emit(options, {
    type: 'result',
    attempt: record.attempt,
    scriptBehavior: record.scriptBehavior,
    behavior: record.behavior,
    outcome,
    chunksSent: record.chunksSent,
  })
}

/** 中文说明：函数 httpError 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function httpError(
  options: ResolvedOptions,
  record: MockLlmRequestRecord,
  response: ServerResponse,
  status: number,
  message: string,
  code: string,
  type = 'mock_error',
): void {
  /** 中文说明：变量 headers 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (record.behavior === 'rate_limit') {
    headers['retry-after'] = String(Math.ceil(options.retryAfterMs / 1_000))
  }
  if (options.requestId !== undefined) headers['x-request-id'] = options.requestId
  response.writeHead(status, headers)
  response.end(JSON.stringify({ error: { message, type, code } }))
  finishRecord(options, record, 'completed')
}

/** 中文说明：函数 terminalChunk 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function terminalChunk(reason: string, outputTokens: number): unknown {
  return {
    choices: [{ index: 0, delta: { content: '' }, finish_reason: reason }],
    usage: { prompt_tokens: 3, completion_tokens: outputTokens },
  }
}

/** 中文说明：函数 pause 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
async function pause(milliseconds: number, response: ServerResponse): Promise<boolean> {
  if (milliseconds === 0) return !response.destroyed
  /** 中文说明：变量 controller 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const controller = new AbortController()
  /** 中文说明：函数值 stop 封装本模块的局部步骤；参数和返回值由右侧签名约束；示例见本模块调用。 */
  const stop = (): void => { controller.abort() }
  response.once('close', stop)
  try {
    await delay(milliseconds, undefined, { signal: controller.signal })
    return true
  } catch (_responseClosed) {
    // The timer only receives this response-owned abort signal; closing the response cancels its wait.
    return false
  } finally {
    response.off('close', stop)
  }
}

/** 中文说明：函数 streamText 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
async function streamText(
  options: ResolvedOptions,
  record: MockLlmRequestRecord,
  response: ServerResponse,
  text: string,
  delayMs: number,
): Promise<boolean> {
  /** 中文说明：该循环依次处理夹具或生成数据；循环变量仅在当前循环中有效。 */
  for (const chunk of splitText(text, options.chunkSize)) {
    writeSse(record, response, { choices: [{ index: 0, delta: { content: chunk }, finish_reason: null }] })
    if (!await pause(delayMs, response)) return false
  }
  return true
}

/** 中文说明：函数 completeText 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
async function completeText(
  options: ResolvedOptions,
  record: MockLlmRequestRecord,
  response: ServerResponse,
  reason: 'stop' | 'length',
  delayMs: number,
): Promise<void> {
  if (!await streamText(options, record, response, options.successText, delayMs)) {
    finishRecord(options, record, 'client_closed')
    return
  }
  writeSse(record, response, terminalChunk(reason, Array.from(options.successText).length))
  writeDone(record, response)
  response.end()
  finishRecord(options, record, 'completed')
}

/** 中文说明：函数 disconnect 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
async function disconnect(
  options: ResolvedOptions,
  record: MockLlmRequestRecord,
  response: ServerResponse,
): Promise<void> {
  if (!await pause(options.disconnectDelayMs, response)) {
    finishRecord(options, record, 'client_closed')
    return
  }
  finishRecord(options, record, 'reset')
  response.destroy()
}

/** 中文说明：函数 toolCallChunks 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function toolCallChunks(options: ResolvedOptions): readonly unknown[] {
  /** 中文说明：变量 midpoint 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const midpoint = Math.max(1, Math.floor(options.toolArguments.length / 2))
  return [
    {
      choices: [{
        index: 0,
        delta: {
          tool_calls: [{
            index: 0,
            id: 'mock-call-1',
            type: 'function',
            function: { name: options.toolName, arguments: options.toolArguments.slice(0, midpoint) },
          }],
        },
        finish_reason: null,
      }],
    },
    {
      choices: [{
        index: 0,
        delta: { tool_calls: [{ index: 0, function: { arguments: options.toolArguments.slice(midpoint) } }] },
        finish_reason: null,
      }],
    },
  ]
}

/** 中文说明：函数 runBehavior 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
async function runBehavior(
  options: ResolvedOptions,
  record: MockLlmRequestRecord,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  switch (record.behavior) {
    case 'script_exhausted':
      httpError(options, record, response, 500, 'mock script exhausted', 'MOCK_SCRIPT_EXHAUSTED')
      return
    case 'connection_reset':
      finishRecord(options, record, 'reset')
      request.socket.destroy()
      return
    case 'stream_disconnect':
      openSse(response)
      await disconnect(options, record, response)
      return
    case 'empty':
      openSse(response)
      writeSse(record, response, terminalChunk('stop', 0))
      writeDone(record, response)
      response.end()
      finishRecord(options, record, 'completed')
      return
    case 'empty_body':
      openSse(response)
      response.end()
      finishRecord(options, record, 'completed')
      return
    case 'stream_eof':
      openSse(response)
      writeSse(record, response, { choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }] })
      response.end()
      finishRecord(options, record, 'completed')
      return
    case 'partial_eof':
      openSse(response)
      await streamText(options, record, response, options.partialText, 0)
      response.end()
      finishRecord(options, record, 'completed')
      return
    case 'partial_disconnect':
      openSse(response)
      if (!await streamText(options, record, response, options.partialText, options.chunkDelayMs)) return
      await disconnect(options, record, response)
      return
    case 'stall':
      openSse(response)
      finishRecord(options, record, 'stalled')
      return
    case 'malformed_json':
      openSse(response)
      writeSse(record, response, '{not-json')
      writeDone(record, response)
      response.end()
      finishRecord(options, record, 'completed')
      return
    case 'malformed_event':
      openSse(response)
      writeSse(record, response, { choices: [null] })
      writeDone(record, response)
      response.end()
      finishRecord(options, record, 'completed')
      return
    case 'wrong_content_type':
      openSse(response, 'application/json')
      await completeText(options, record, response, 'stop', 0)
      return
    case 'rate_limit':
      httpError(options, record, response, 429, 'mock rate limit', 'rate_limit')
      return
    case 'server_error':
      httpError(options, record, response, 500, 'mock server error', 'server_error')
      return
    case 'service_unavailable':
      httpError(options, record, response, 503, 'mock service unavailable', 'service_unavailable')
      return
    case 'auth_error':
      httpError(options, record, response, 401, 'mock authentication failed', 'invalid_api_key')
      return
    case 'invalid_request':
      httpError(options, record, response, 400, 'mock invalid request', 'invalid_request')
      return
    case 'context_overflow':
      httpError(
        options,
        record,
        response,
        400,
        'mock input exceeds the model context window',
        'context_length_exceeded',
        'invalid_request_error',
      )
      return
    case 'quota_exceeded':
      httpError(options, record, response, 429, 'mock insufficient quota', 'insufficient_quota')
      return
    case 'success':
      openSse(response)
      await completeText(options, record, response, 'stop', 0)
      return
    case 'reasoning_success':
      openSse(response)
      /** 中文说明：该循环依次处理夹具或生成数据；循环变量仅在当前循环中有效。 */
      for (const chunk of splitText(options.reasoningText, options.chunkSize)) {
        writeSse(record, response, {
          choices: [{ index: 0, delta: { reasoning_content: chunk }, finish_reason: null }],
        })
      }
      await completeText(options, record, response, 'stop', 0)
      return
    case 'tool_call_success':
      openSse(response)
      /** 中文说明：该循环依次处理夹具或生成数据；循环变量仅在当前循环中有效。 */
      for (const chunk of toolCallChunks(options)) writeSse(record, response, chunk)
      writeSse(record, response, terminalChunk('tool_calls', 2))
      writeDone(record, response)
      response.end()
      finishRecord(options, record, 'completed')
      return
    case 'max_tokens':
      openSse(response)
      await completeText(options, record, response, 'length', 0)
      return
    case 'slow_success':
      openSse(response)
      await completeText(options, record, response, 'stop', options.chunkDelayMs)
      return
  }
}

/** 中文说明：函数 seededRandom 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function seededRandom(seed: number): () => number {
  /** 中文说明：变量 state 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let state = seed
  return () => {
    state = (state + 0x6d2b_79f5) >>> 0
    /** 中文说明：变量 mixed 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let mixed = state
    mixed = Math.imul(mixed ^ mixed >>> 15, mixed | 1)
    mixed ^= mixed + Math.imul(mixed ^ mixed >>> 7, mixed | 61)
    return ((mixed ^ mixed >>> 14) >>> 0) / 0x1_0000_0000
  }
}

/** 中文说明：函数 chooseRandomBehavior 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function chooseRandomBehavior(
  weights: readonly (readonly [ConcreteMockLlmBehavior, number])[],
  random: () => number,
): ConcreteMockLlmBehavior {
  /** 中文说明：函数值 total 封装本模块的局部步骤；参数和返回值由右侧签名约束；示例见本模块调用。 */
  const total = weights.reduce((sum, entry) => sum + entry[1], 0)
  /** 中文说明：变量 draw 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let draw = random() * total
  /** 中文说明：该循环依次处理夹具或生成数据；循环变量仅在当前循环中有效。 */
  for (const [behavior, weight] of weights) {
    if (draw < weight) return behavior
    draw -= weight
  }
  // Floating-point subtraction can only leave a rounding residue at the upper boundary.
  /* v8 ignore next -- seededRandom is strictly less than one; this guards floating-point residue only */
  return (weights.at(-1) as readonly [ConcreteMockLlmBehavior, number])[0]
}

/**
 * Start a local chat-completions server that consumes one configured behavior
 * per accepted request. Only a `POST` path ending in `/chat/completions` consumes the script;
 * invalid routes, methods, authorization, and JSON receive ordinary 4xx
 * responses. Closing the handle terminates stalled connections.
 *
 * @param options - listener, script, response content, timing, and telemetry options.
 * @returns the listening handle after the port is bound.
 */
/*
 * 中文说明：函数 startMockLlmServer 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。
 * @param options 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
 */
export async function startMockLlmServer(options: MockLlmServerOptions): Promise<MockLlmServer> {
  /** 中文说明：变量 resolved 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const resolved = resolveOptions(options)
  /** 中文说明：变量 requests 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const requests: MockLlmRequestRecord[] = []
  /** 中文说明：变量 random 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const random = seededRandom(resolved.randomSeed)
  /** 中文说明：变量 cursor 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let cursor = 0

  /** 中文说明：变量 selectBehavior 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const selectBehavior = (): {
    scriptBehavior: MockLlmBehavior | 'script_exhausted'
    behavior: ConcreteMockLlmBehavior | 'script_exhausted'
  } => {
    /** 中文说明：变量 selected 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const selected = resolved.sequence[cursor]
    cursor += 1
    /** 中文说明：变量 scriptBehavior 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const scriptBehavior = selected
      ?? (resolved.repeatLast ? resolved.lastBehavior : 'script_exhausted')
    return {
      scriptBehavior,
      behavior: scriptBehavior === 'random'
        ? chooseRandomBehavior(resolved.randomWeights, random)
        : scriptBehavior,
    }
  }

  /** 中文说明：函数值 handle 封装本模块的局部步骤；参数和返回值由右侧签名约束；示例见本模块调用。 */
  const handle = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    /** 中文说明：变量 path 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    /* v8 ignore next -- node:http server requests always carry a URL despite the shared optional type */
    const path = new URL(request.url ?? '/', 'http://mock.invalid').pathname
    if (request.method !== 'POST') {
      response.writeHead(405, { allow: 'POST' }).end()
      return
    }
    if (!path.endsWith('/chat/completions')) {
      response.writeHead(404).end()
      return
    }
    if (resolved.apiKey !== undefined && request.headers.authorization !== `Bearer ${resolved.apiKey}`) {
      response.writeHead(401, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: { message: 'invalid mock bearer token', code: 'invalid_api_key' } }))
      return
    }

    /** 中文说明：变量 body 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let body: unknown
    try {
      body = await readJsonBody(request)
    } catch {
      response.writeHead(400, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: { message: 'request body must be valid JSON', code: 'invalid_json' } }))
      return
    }

    /** 中文说明：变量 selected 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const selected = selectBehavior()
    /** 中文说明：变量 record 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const record: MockLlmRequestRecord = {
      attempt: requests.length + 1,
      scriptBehavior: selected.scriptBehavior,
      behavior: selected.behavior,
      path,
      headers: { ...request.headers },
      body,
      chunksSent: 0,
    }
    requests.push(record)
    response.once('close', () => {
      if (!response.writableFinished && record.outcome === undefined) {
        finishRecord(resolved, record, 'client_closed')
      }
    })
    emit(resolved, {
      type: 'request',
      attempt: record.attempt,
      scriptBehavior: record.scriptBehavior,
      behavior: record.behavior,
      path,
    })
    await runBehavior(resolved, record, request, response)
  }

  /** 中文说明：函数值 server 封装本模块的局部步骤；参数和返回值由右侧签名约束；示例见本模块调用。 */
  const server = createServer((request, response) => {
    /* v8 ignore start -- last-resort containment for Node response failures after validated test inputs */
    handle(request, response).catch((error: unknown) => {
      /** 中文说明：变量 record 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const record = requests.at(-1)
      if (record !== undefined) finishRecord(resolved, record, 'server_error')
      if (response.headersSent) {
        response.destroy(error instanceof Error ? error : new Error(String(error)))
        return
      }
      response.writeHead(500, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: { message: 'mock server handler failed', code: 'MOCK_HANDLER_FAILED' } }))
    })
    /* v8 ignore stop */
  })

  /** 中文说明：变量 closing 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let closing: Promise<void> | undefined
  /** 中文说明：函数值 close 封装本模块的局部步骤；参数和返回值由右侧签名约束；示例见本模块调用。 */
  const close = (): Promise<void> => (closing ??= new Promise((resolveClose) => {
    server.close(() => { resolveClose() })
    server.closeAllConnections()
  }))

  await new Promise<void>((resolveListen, rejectListen) => {
    server.once('error', rejectListen)
    server.listen(resolved.port, resolved.host, () => {
      server.off('error', rejectListen)
      resolveListen()
    })
  })

  /** 中文说明：变量 address 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const address = server.address() as AddressInfo
  /** 中文说明：变量 advertisedHost 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const advertisedHost = isIP(resolved.host) === 6 ? `[${resolved.host}]` : resolved.host
  return {
    baseURL: `http://${advertisedHost}:${address.port}`,
    port: address.port,
    randomSeed: resolved.randomSeed,
    requests,
    close,
  }
}
