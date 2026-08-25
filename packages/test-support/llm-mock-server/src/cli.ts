/**
 * Dependency-free CLI parsing for the standalone mock LLM server.
 * @module @deepseek-ai/dsh-llm-mock-server/cli
 */
/*
 * 文件职责：实现 cli.ts 覆盖的LLM 测试替身行为与测试协作。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、快照、模拟服务器或类型生成。
 * 产品维度：通过可复现的LLM 测试替身能力保障 Agent 功能在集成层稳定。
 * 逻辑维度：准备夹具或输入，执行装载/生成/调用流程，再规范化并核对结果。
 * 关键边界：夹具必须确定且跨平台；模型可见状态应可重放；临时资源必须释放。
 * 新手阅读建议：先看导出类型和夹具，再读主流程，最后关注规范化、失败和清理。
 */

import { parseArgs } from 'node:util'
import { MAX_MOCK_LLM_TIMER_DELAY_MS, MOCK_LLM_BEHAVIORS } from './index.ts'
import type {
  ConcreteMockLlmBehavior,
  MockLlmBehavior,
  MockLlmRandomWeights,
  MockLlmServerOptions,
} from './index.ts'

/** Listener lifecycle behavior understood only by the standalone CLI. */
/* 中文说明：常量 CONNECTION_REFUSED_BEHAVIOR 保存本模块共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
export const CONNECTION_REFUSED_BEHAVIOR = 'connection_refused'

/** Parsed CLI configuration, including a pre-listen unavailable interval. */
/* 中文说明：interface MockLlmCliConfig 定义本模块所需的数据或行为，用于表达LLM 测试替身场景。 */
export interface MockLlmCliConfig {
  /** Server options after removing the lifecycle-only `connection_refused` entry. */
  readonly server: MockLlmServerOptions
  /** Delay before binding the model port; an integer from zero through the Node timer maximum. */
  readonly listenDelayMs: number
  /** Whether the original sequence requested a true pre-listen refusal phase. */
  readonly startsUnavailable: boolean
}

/** Result of parsing `dsh-llm-mock-server` arguments. */
/* 中文说明：type MockLlmCliParseResult 定义本模块所需的数据或行为，用于表达LLM 测试替身场景。 */
export type MockLlmCliParseResult =
  | { readonly kind: 'help' }
  | { readonly kind: 'run'; readonly config: MockLlmCliConfig }

/** 中文说明：常量 BEHAVIORS 保存本模块共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const BEHAVIORS = new Set<string>(MOCK_LLM_BEHAVIORS)
/** 中文说明：常量 DEFAULT_LISTEN_DELAY_MS 保存本模块共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const DEFAULT_LISTEN_DELAY_MS = 750

/** Command usage written for `--help` and invalid arguments. */
/* 中文说明：常量 MOCK_LLM_CLI_USAGE 保存本模块共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
export const MOCK_LLM_CLI_USAGE = `Usage: dsh-llm-mock-server [options]

Required:
  --sequence <a,b,...>       Ordered behaviors; connection_refused is allowed first

Listener:
  --host <host>              Default 127.0.0.1
  --port <port>              Default 8000; required and nonzero for connection_refused
  --api-key <token>          Validate exact Bearer token when present
  --listen-delay-ms <ms>     Unavailable interval (default 750 with connection_refused)
  --repeat-last              Repeat the final request behavior after exhaustion
  --seed <uint32>            Reproduce random selections
  --random-weights <a=n,...> Relative weights for concrete behaviors

Response:
  --success-text <text>
  --partial-text <text>
  --reasoning-text <text>
  --chunk-size <count>
  --chunk-delay-ms <ms>
  --disconnect-delay-ms <ms>
  --retry-after-ms <ms>
  --request-id <id>
  --tool-name <name>
  --tool-arguments <json>

Other:
  --help
`

/** 中文说明：函数 numberValue 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function numberValue(option: string, value: string): number {
  /** 中文说明：变量 parsed 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) throw new Error(`dsh-llm-mock-server: ${option} must be a finite number`)
  return parsed
}

/** 中文说明：函数 boundedIntegerValue 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function boundedIntegerValue(option: string, value: string, min: number, max: number): number {
  /** 中文说明：变量 parsed 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const parsed = numberValue(option, value)
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`dsh-llm-mock-server: ${option} must be an integer between ${min} and ${max}`)
  }
  return parsed
}

/** 中文说明：函数 parseSequence 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function parseSequence(raw: string): { startsUnavailable: boolean; sequence: MockLlmBehavior[] } {
  /** 中文说明：函数值 entries 封装本模块的局部步骤；参数和返回值由右侧签名约束；示例见本模块调用。 */
  const entries = raw.split(',').map(entry => entry.trim())
  if (entries.some(entry => entry.length === 0)) {
    throw new Error('dsh-llm-mock-server: --sequence must contain non-empty comma-separated behaviors')
  }
  /** 中文说明：变量 startsUnavailable 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const startsUnavailable = entries[0] === CONNECTION_REFUSED_BEHAVIOR
  if (entries.slice(1).includes(CONNECTION_REFUSED_BEHAVIOR)) {
    throw new Error('dsh-llm-mock-server: connection_refused is allowed only as the first behavior')
  }
  /** 中文说明：变量 requestEntries 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const requestEntries = startsUnavailable ? entries.slice(1) : entries
  if (requestEntries.length === 0) {
    throw new Error('dsh-llm-mock-server: connection_refused must be followed by a request behavior')
  }
  /** 中文说明：该循环依次处理夹具或生成数据；循环变量仅在当前循环中有效。 */
  for (const entry of requestEntries) {
    if (!BEHAVIORS.has(entry)) throw new Error(`dsh-llm-mock-server: unknown behavior ${JSON.stringify(entry)}`)
  }
  return { startsUnavailable, sequence: requestEntries as MockLlmBehavior[] }
}

/** 中文说明：函数 parseRandomWeights 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function parseRandomWeights(raw: string): MockLlmRandomWeights {
  /** 中文说明：变量 weights 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const weights: MockLlmRandomWeights = {}
  /** 中文说明：该循环依次处理夹具或生成数据；循环变量仅在当前循环中有效。 */
  for (const entry of raw.split(',')) {
    const [behavior, rawWeight, ...extra] = entry.split('=')
    if (behavior === undefined || behavior === '' || rawWeight === undefined || rawWeight === '' || extra.length > 0) {
      throw new Error('dsh-llm-mock-server: --random-weights expects behavior=weight comma-separated entries')
    }
    if (!BEHAVIORS.has(behavior) || behavior === 'random') {
      throw new Error(`dsh-llm-mock-server: random weight requires a concrete behavior, got ${JSON.stringify(behavior)}`)
    }
    if (Object.hasOwn(weights, behavior)) {
      throw new Error(`dsh-llm-mock-server: duplicate random weight for ${JSON.stringify(behavior)}`)
    }
    weights[behavior as ConcreteMockLlmBehavior] = numberValue('--random-weights', rawWeight)
  }
  return weights
}

/** parseArgs vocabulary: every documented flag; only `--repeat-last` and `--help` are boolean. */
/* 中文说明：常量 CLI_OPTIONS 保存本模块共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const CLI_OPTIONS = {
  'sequence': { type: 'string' },
  'host': { type: 'string' },
  'port': { type: 'string' },
  'api-key': { type: 'string' },
  'listen-delay-ms': { type: 'string' },
  'repeat-last': { type: 'boolean' },
  'seed': { type: 'string' },
  'random-weights': { type: 'string' },
  'success-text': { type: 'string' },
  'partial-text': { type: 'string' },
  'reasoning-text': { type: 'string' },
  'chunk-size': { type: 'string' },
  'chunk-delay-ms': { type: 'string' },
  'disconnect-delay-ms': { type: 'string' },
  'retry-after-ms': { type: 'string' },
  'request-id': { type: 'string' },
  'tool-name': { type: 'string' },
  'tool-arguments': { type: 'string' },
} as const

/**
 * Parse standalone server arguments without starting a process or listener.
 * Tokenizing rides `node:util` `parseArgs` (strict, no positionals); numeric
 * coercion, bounds, and cross-option constraints remain manual below it.
 * @param argv - arguments after the executable name.
 * @returns help or validated run configuration.
 */
/*
 * 中文说明：函数 parseMockLlmCliArgs 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。
 * @param argv 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
 */
export function parseMockLlmCliArgs(argv: readonly string[]): MockLlmCliParseResult {
  if (argv.includes('--help')) return { kind: 'help' }

  const { values } = parseArgs({ args: [...argv], options: CLI_OPTIONS, strict: true, allowPositionals: false })

  /** 中文说明：变量 host 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const host = values.host
  /** 中文说明：变量 port 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const port = values.port === undefined ? 8_000 : numberValue('--port', values.port)
  /** 中文说明：变量 apiKey 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const apiKey = values['api-key']
  /** 中文说明：变量 listenDelayMs 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const listenDelayMs = values['listen-delay-ms'] === undefined
    ? undefined
    : boundedIntegerValue('--listen-delay-ms', values['listen-delay-ms'], 0, MAX_MOCK_LLM_TIMER_DELAY_MS)
  /** 中文说明：变量 repeatLast 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const repeatLast = values['repeat-last'] ?? false
  /** 中文说明：变量 randomSeed 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const randomSeed = values.seed === undefined ? undefined : numberValue('--seed', values.seed)
  /** 中文说明：变量 randomWeights 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const randomWeights = values['random-weights'] === undefined ? undefined : parseRandomWeights(values['random-weights'])
  /** 中文说明：变量 successText 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const successText = values['success-text']
  /** 中文说明：变量 partialText 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const partialText = values['partial-text']
  /** 中文说明：变量 reasoningText 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const reasoningText = values['reasoning-text']
  /** 中文说明：变量 chunkSize 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const chunkSize = values['chunk-size'] === undefined ? undefined : numberValue('--chunk-size', values['chunk-size'])
  /** 中文说明：变量 chunkDelayMs 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const chunkDelayMs = values['chunk-delay-ms'] === undefined ? undefined : numberValue('--chunk-delay-ms', values['chunk-delay-ms'])
  /** 中文说明：变量 disconnectDelayMs 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const disconnectDelayMs = values['disconnect-delay-ms'] === undefined
    ? undefined
    : numberValue('--disconnect-delay-ms', values['disconnect-delay-ms'])
  /** 中文说明：变量 retryAfterMs 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const retryAfterMs = values['retry-after-ms'] === undefined ? undefined : numberValue('--retry-after-ms', values['retry-after-ms'])
  /** 中文说明：变量 requestId 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const requestId = values['request-id']
  /** 中文说明：变量 toolName 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const toolName = values['tool-name']
  /** 中文说明：变量 toolArguments 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const toolArguments = values['tool-arguments']

  if (values.sequence === undefined) throw new Error('dsh-llm-mock-server: --sequence is required')
  /** 中文说明：变量 sequenceRaw 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const sequenceRaw = values.sequence
  /** 中文说明：变量 parsedSequence 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const parsedSequence = parseSequence(sequenceRaw)
  if (parsedSequence.startsUnavailable && port === 0) {
    throw new Error('dsh-llm-mock-server: connection_refused requires an explicit nonzero --port')
  }
  if (!parsedSequence.startsUnavailable && listenDelayMs !== undefined) {
    throw new Error('dsh-llm-mock-server: --listen-delay-ms requires connection_refused first in --sequence')
  }
  if (!parsedSequence.sequence.includes('random') && (randomSeed !== undefined || randomWeights !== undefined)) {
    throw new Error('dsh-llm-mock-server: --seed and --random-weights require random in --sequence')
  }

  return {
    kind: 'run',
    config: {
      server: {
        sequence: parsedSequence.sequence,
        port,
        repeatLast,
        ...randomSeed === undefined ? {} : { randomSeed },
        ...randomWeights === undefined ? {} : { randomWeights },
        ...host === undefined ? {} : { host },
        ...apiKey === undefined ? {} : { apiKey },
        ...successText === undefined ? {} : { successText },
        ...partialText === undefined ? {} : { partialText },
        ...reasoningText === undefined ? {} : { reasoningText },
        ...chunkSize === undefined ? {} : { chunkSize },
        ...chunkDelayMs === undefined ? {} : { chunkDelayMs },
        ...disconnectDelayMs === undefined ? {} : { disconnectDelayMs },
        ...retryAfterMs === undefined ? {} : { retryAfterMs },
        ...requestId === undefined ? {} : { requestId },
        ...toolName === undefined ? {} : { toolName },
        ...toolArguments === undefined ? {} : { toolArguments },
      },
      listenDelayMs: parsedSequence.startsUnavailable ? listenDelayMs ?? DEFAULT_LISTEN_DELAY_MS : 0,
      startsUnavailable: parsedSequence.startsUnavailable,
    },
  }
}
