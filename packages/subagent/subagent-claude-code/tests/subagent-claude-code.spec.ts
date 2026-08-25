/**
 * 文件职责：验证 subagent-claude-code.spec.ts 覆盖的子代理启动、协议、继承与生命周期行为。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、进程协议或同进程代理驱动。
 * 产品维度：保障 Agent 能可靠委派任务、继承上下文并收集子代理结果。
 * 逻辑维度：准备代理配置，启动或连接子代理，转发事件，再处理结果、取消与清理。
 * 关键边界：异步状态不等于单次任务结果；外部输出不可信；清理必须等待子代理完全停止。
 * 新手阅读建议：先看公开配置和测试夹具，再读启动/事件流程，最后关注继承、取消与失败路径。
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { PassThrough } from 'node:stream'
import { fileURLToPath } from 'node:url'
import type {
  Options,
  Query,
  SDKMessage,
  SDKPermissionDeniedMessage,
  SDKResultMessage,
  SpawnOptions,
} from '@anthropic-ai/claude-agent-sdk'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import * as yaml from 'js-yaml'
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  /** 中文说明：type Mock 定义本测试所需的数据或行为，用于表达子代理场景。 */
  type Mock,
  vi,
} from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import type {
  SubprocessHandle,
  SubprocessOutcome,
  SubprocessSpawnSpec,
} from '@deepseek-ai/dsh-subprocess'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import * as claudeCode from '../src/index.ts'
import * as invariant from '../src/invariant.ts'
import {
  claudeSpawnSpec,
  ManagedClaudeCodeProcess,
  sdkEnvironmentOverlay,
} from '../src/process.ts'
import {
  CLAUDE_CODE_PERMISSION_MODES,
  DEFAULT_CLAUDE_CODE_PERMISSION_MODE,
  claudeQueryOptions,
  consumeClaudeQuery,
  disposeClaudeCodeChild,
  startClaudeCodeRun,
  successfulResult,
  textTask,
  /** 中文说明：type ClaudeCodeRunSpec 定义本测试所需的数据或行为，用于表达子代理场景。 */
  type ClaudeCodeRunSpec,
} from '../src/run.ts'

/** 中文说明：type QueryFactory 定义本测试所需的数据或行为，用于表达子代理场景。 */
type QueryFactory = (params: {
  prompt: string
  options: Options
}) => Query

/** 中文说明：函数值 queryMock 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
const queryMock = vi.hoisted(() => vi.fn<QueryFactory>())

/** 中文说明：常量 CLAUDE_AGENT_SDK_VERSION 保存本测试共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const CLAUDE_AGENT_SDK_VERSION = '0.3.220'
/** 中文说明：常量 CLAUDE_CODE_VERSION 保存本测试共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const CLAUDE_CODE_VERSION = '2.1.220'
/** 中文说明：常量 CLAUDE_PLATFORM_PACKAGES 保存本测试共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const CLAUDE_PLATFORM_PACKAGES = [
  '@anthropic-ai/claude-agent-sdk-darwin-arm64',
  '@anthropic-ai/claude-agent-sdk-darwin-x64',
  '@anthropic-ai/claude-agent-sdk-linux-arm64',
  '@anthropic-ai/claude-agent-sdk-linux-arm64-musl',
  '@anthropic-ai/claude-agent-sdk-linux-x64',
  '@anthropic-ai/claude-agent-sdk-linux-x64-musl',
  '@anthropic-ai/claude-agent-sdk-win32-arm64',
  '@anthropic-ai/claude-agent-sdk-win32-x64',
] as const

vi.mock('@anthropic-ai/claude-agent-sdk', async importOriginal => ({
  ...await importOriginal<typeof import('@anthropic-ai/claude-agent-sdk')>(),
  query: queryMock,
}))

/** 中文说明：变量 fakeParent 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const fakeParent = {
  id: 'parent',
  session: { header: { cwd: process.cwd() } },
} as unknown as Agent

/** 中文说明：函数 request 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function request(
  prompt: ContentBlock[] = [{ type: 'text', text: 'do the task' }],
  signal = new AbortController().signal,
) {
  return { prompt, parent: fakeParent, signal }
}

/** 中文说明：函数 nextTask 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function nextTask(): Promise<void> {
  await new Promise<void>((resolve) => { setImmediate(resolve) })
}

/** 中文说明：函数 errorCause 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function errorCause(value: unknown): Error | undefined {
  return value instanceof Error && value.cause instanceof Error
    ? value.cause
    : undefined
}

/** 中文说明：interface FakeChildOptions 定义本测试所需的数据或行为，用于表达子代理场景。 */
interface FakeChildOptions {
  readonly pid?: number
  readonly exitOnTerminate?: boolean
  readonly waitForExitError?: Error
  readonly doneError?: Error
}

/** 中文说明：interface FakeChild 定义本测试所需的数据或行为，用于表达子代理场景。 */
interface FakeChild {
  readonly handle: SubprocessHandle
  readonly stdin: PassThrough
  readonly stdout: PassThrough
  readonly settle: (outcome?: SubprocessOutcome) => void
  readonly fail: (error: Error) => void
  readonly terminate: Mock<SubprocessHandle['terminate']>
  readonly waitForExit: Mock<SubprocessHandle['waitForExit']>
}

/** 中文说明：函数 fakeChild 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function fakeChild(options: FakeChildOptions = {}): FakeChild {
  /** 中文说明：变量 stdin 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const stdin = new PassThrough()
  /** 中文说明：变量 stdout 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const stdout = new PassThrough()
  /** 中文说明：变量 exited 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let exited = false
  /** 中文说明：函数值 resolveDone 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
  let resolveDone!: (outcome: SubprocessOutcome) => void
  /** 中文说明：函数值 rejectDone 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
  let rejectDone!: (error: Error) => void
  /** 中文说明：函数值 done 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
  const done = new Promise<SubprocessOutcome>((resolve, reject) => {
    resolveDone = resolve
    rejectDone = reject
  })
  // Individual tests deliberately exercise rejected and still-pending handles.
  void done.catch(() => {})
  /** 中文说明：变量 settle 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const settle = (
    outcome: SubprocessOutcome = { exitCode: 0, signal: null },
  ): void => {
    if (exited) return
    exited = true
    resolveDone(outcome)
  }
  /** 中文说明：函数值 fail 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
  const fail = (error: Error): void => {
    if (exited) return
    exited = true
    rejectDone(error)
  }
  if (options.doneError !== undefined) fail(options.doneError)
  /** 中文说明：函数值 terminate 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
  const terminate = vi.fn<SubprocessHandle['terminate']>(() => {
    if (options.exitOnTerminate !== false) settle()
  })
  /** 中文说明：函数值 waitForExit 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
  const waitForExit = vi.fn<SubprocessHandle['waitForExit']>(async (signal?: AbortSignal): Promise<boolean> => {
    if (options.waitForExitError !== undefined) {
      throw options.waitForExitError
    }
    if (exited) return true
    if (signal === undefined) {
      await done.catch(() => {})
      return true
    }
    return await new Promise<boolean>((resolve) => {
      /** 中文说明：函数值 onAbort 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
      const onAbort = (): void => { resolve(false) }
      signal.addEventListener('abort', onAbort, { once: true })
      void done.then(
        () => {
          signal.removeEventListener('abort', onAbort)
          resolve(true)
        },
        () => {
          signal.removeEventListener('abort', onAbort)
          resolve(true)
        },
      )
    })
  })
  /** 中文说明：变量 handle 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const handle: SubprocessHandle = {
    pid: options.pid ?? 1234,
    stdin,
    stdout,
    stderr: undefined,
    collected: {},
    done,
    terminate,
    waitForExit,
  }
  return {
    handle,
    stdin,
    stdout,
    settle,
    fail,
    terminate,
    waitForExit,
  }
}

/** 中文说明：函数 success 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function success(
  result = 'answer',
  isError = false,
): SDKResultMessage {
  return {
    type: 'result',
    subtype: 'success',
    is_error: isError,
    result,
  } as SDKResultMessage
}

/** 中文说明：type ErrorSubtype 定义本测试所需的数据或行为，用于表达子代理场景。 */
type ErrorSubtype = Exclude<SDKResultMessage['subtype'], 'success'>

/** 中文说明：函数 failure 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function failure(
  subtype: ErrorSubtype,
  errors: string[] = ['fixture failure'],
): SDKResultMessage {
  return {
    type: 'result',
    subtype,
    is_error: true,
    errors,
  } as SDKResultMessage
}

/** 中文说明：函数 expectedFailureDiagnostic 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function expectedFailureDiagnostic(
  stage: 'query-start' | 'query-run' | 'process' | 'teardown',
  category: string,
  outcome?: Partial<SubprocessOutcome>,
): string {
  /** 中文说明：变量 fields 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const fields = [
    'product: Claude Code',
    `stage: ${stage}`,
    `category: ${category}`,
  ]
  if (outcome?.exitCode !== null && outcome?.exitCode !== undefined) {
    fields.push(`exit code: ${outcome.exitCode}`)
  }
  if (outcome?.signal !== null && outcome?.signal !== undefined) {
    fields.push(`signal: ${outcome.signal}`)
  }
  return `Product subagent failure (${fields.join('; ')})`
}

/** 中文说明：函数 permissionDenied 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function permissionDenied(): SDKPermissionDeniedMessage {
  return {
    type: 'system',
    subtype: 'permission_denied',
    tool_name: 'Bash',
    tool_use_id: 'tool-secret',
    decision_reason_type: 'mode',
    decision_reason: 'contains /private/secret.txt',
    message: 'command with SECRET_TOKEN was denied',
    uuid: '00000000-0000-4000-8000-000000000001',
    session_id: 'session-secret',
  }
}

/** 中文说明：函数 queryFrom 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function queryFrom(
  messages: readonly SDKMessage[],
  after?: Error,
  close = vi.fn(),
): Query {
  async function* stream(): AsyncGenerator<SDKMessage, void> {
    /** 中文说明：该循环依次处理代理事件；循环变量仅在当前循环中有效。 */
    for (const message of messages) yield message
    if (after !== undefined) throw after
  }
  return Object.assign(stream(), { close }) as unknown as Query
}

/** 中文说明：函数 waitingQuery 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function waitingQuery(signal: AbortSignal, close = vi.fn()): Query {
  async function* stream(): AsyncGenerator<SDKMessage, void> {
    await new Promise<never>((_resolve, reject) => {
      /** 中文说明：函数值 fail 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
      const fail = (): void => {
        reject(signal.reason instanceof Error
          ? signal.reason
          : new Error(String(signal.reason)))
      }
      if (signal.aborted) fail()
      else signal.addEventListener('abort', fail, { once: true })
    })
  }
  return Object.assign(stream(), { close }) as unknown as Query
}

/** 中文说明：函数 sdkSpawnOptions 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function sdkSpawnOptions(
  overrides: Partial<SpawnOptions> = {},
): SpawnOptions {
  return {
    command: '/sdk/claude',
    args: ['--output-format', 'stream-json'],
    cwd: '/workspace',
    env: { PATH: '/bin', OMITTED: undefined },
    signal: new AbortController().signal,
    ...overrides,
  }
}

/** 中文说明：interface FakeRun 定义本测试所需的数据或行为，用于表达子代理场景。 */
interface FakeRun {
  readonly child: FakeChild
  readonly close: ReturnType<typeof vi.fn>
  readonly spawnSpecs: SubprocessSpawnSpec[]
  readonly options: Options[]
  readonly spec: ClaudeCodeRunSpec
}

/** 中文说明：函数 fakeRun 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function fakeRun(
  messages: readonly SDKMessage[] = [success()],
  after?: Error,
  child = fakeChild(),
): FakeRun {
  /** 中文说明：变量 close 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const close = vi.fn()
  /** 中文说明：变量 query 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const query = queryFrom(messages, after, close)
  /** 中文说明：变量 spawnSpecs 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const spawnSpecs: SubprocessSpawnSpec[] = []
  /** 中文说明：变量 options 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const options: FakeRun['options'] = []
  /** 中文说明：变量 spec 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const spec: ClaudeCodeRunSpec = {
    cwd: '/workspace',
    permissionMode: DEFAULT_CLAUDE_CODE_PERMISSION_MODE,
    env: { ANTHROPIC_API_KEY: 'fake-key' },
    disposeGraceMs: 5,
    spawn: (spawnSpec) => {
      spawnSpecs.push(spawnSpec)
      return child.handle
    },
  }
  queryMock.mockImplementation((params) => {
    options.push(params.options)
    params.options.spawnClaudeCodeProcess!(sdkSpawnOptions())
    return query
  })
  return { child, close, spawnSpecs, options, spec }
}

beforeEach(() => {
  queryMock.mockImplementation(({ options }) => {
    options.spawnClaudeCodeProcess!(sdkSpawnOptions({
      cwd: options.cwd!,
      env: options.env!,
      signal: options.abortController!.signal,
    }))
    return queryFrom([])
  })
})

afterEach(() => {
  queryMock.mockReset()
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe('task admission and package contracts', () => {
  it('ships one independently installable provider-only Bundle patch', () => {
    /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const root = fileURLToPath(new URL('..', import.meta.url))
    /** 中文说明：变量 manifest 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
      files?: string[]
      dsh?: { bundle?: { patch?: string } }
    }
    expect(manifest.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
    expect(manifest.files).toContain('cordis.patch.yml')
    expect(manifest.dependencies).toHaveProperty(
      '@anthropic-ai/claude-agent-sdk',
      CLAUDE_AGENT_SDK_VERSION,
    )
    expect(manifest.dependencies).toHaveProperty(
      '@modelcontextprotocol/sdk',
      '^1.29.0',
    )
    expect(manifest.dependencies).toHaveProperty('zod', '^4.4.3')
    expect(manifest.dependencies).not.toHaveProperty('@deepseek-ai/dsh-subagent-codex')

    /** 中文说明：变量 sdkRoot 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const sdkRoot = dirname(fileURLToPath(
      import.meta.resolve('@anthropic-ai/claude-agent-sdk'),
    ))
    /** 中文说明：变量 sdkManifest 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const sdkManifest = JSON.parse(readFileSync(
      resolve(sdkRoot, 'package.json'),
      'utf8',
    )) as {
      version: string
      claudeCodeVersion: string
      optionalDependencies: Record<string, string>
    }
    expect(sdkManifest.version).toBe(CLAUDE_AGENT_SDK_VERSION)
    expect(sdkManifest.claudeCodeVersion).toBe(CLAUDE_CODE_VERSION)
    expect(sdkManifest.optionalDependencies).toEqual(Object.fromEntries(
      CLAUDE_PLATFORM_PACKAGES.map(packageName => [
        packageName,
        CLAUDE_AGENT_SDK_VERSION,
      ]),
    ))
    /** 中文说明：变量 lockfile 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const lockfile = readFileSync(resolve(root, '../../../pnpm-lock.yaml'), 'utf8')
    /** 中文说明：该循环依次处理代理事件；循环变量仅在当前循环中有效。 */
    for (const packageName of CLAUDE_PLATFORM_PACKAGES) {
      expect(lockfile).toContain(
        `  '${packageName}@${CLAUDE_AGENT_SDK_VERSION}':`,
      )
      expect(lockfile).toContain(
        `      '${packageName}': ${CLAUDE_AGENT_SDK_VERSION}`,
      )
    }

    /** 中文说明：变量 parsed 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const parsed = yaml.load(readFileSync(resolve(root, manifest.dsh!.bundle!.patch!), 'utf8'))
    /** 中文说明：变量 rows 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const rows = Array.isArray(parsed)
      ? (parsed as Array<{ insert?: Array<{ id?: string; name?: string }> }>).flatMap(entry => entry.insert ?? [])
      : []
    expect(rows).toEqual([{
      id: 'subagent-claude-code',
      name: '@deepseek-ai/dsh-subagent-claude-code',
    }])
    expect(JSON.stringify(rows)).not.toContain('tool-subagent')
  })

  it('preserves text sequences and rejects empty, blank, and non-text tasks', () => {
    expect(textTask([
      { type: 'text', text: 'one' },
      { type: 'text', text: 'two' },
    ])).toBe('onetwo')
    expect(() => textTask([])).toThrow('only text blocks')
    expect(() => textTask([{ type: 'reasoning', text: 'hidden' }]))
      .toThrow('only text blocks')
    expect(() => textTask([{ type: 'text', text: ' \n ' }]))
      .toThrow('must not be empty')
  })

  it('registers the default descriptor, validates config, and unregisters on HMR', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(SubagentRuntime)
    await ctx.plugin(LocalSubprocessRuntime)
    /** 中文说明：变量 fiber 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const fiber = await ctx.plugin(claudeCode, {})
    expect(ctx.subagents.getProvider('claude-code')).toMatchObject({
      name: 'claude-code',
      capabilities: {
        outputSchema: false,
        depthLimit: false,
        toolFilter: false,
        persona: false,
      },
      inheritsParentContext: false,
    })
    expect(ctx.subagents.list()).toEqual(['claude-code'])
    await fiber.dispose()
    expect(ctx.subagents.list()).toEqual([])

    /** 中文说明：该循环依次处理代理事件；循环变量仅在当前循环中有效。 */
    for (const disposeGraceMs of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      await expect(ctx.plugin(claudeCode, { disposeGraceMs }))
        .rejects.toThrow('disposeGraceMs must be a positive finite number')
    }
    await expect(ctx.plugin(claudeCode, {
      disposeGraceMs: MAX_TIMER_DELAY_MS + 1,
    })).rejects.toThrow(
      `disposeGraceMs must be no greater than ${MAX_TIMER_DELAY_MS}`,
    )
    await ctx.fiber.dispose()
  })

  it('keeps named instances, runs, and HMR ownership isolated', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(SubagentRuntime)
    await ctx.plugin(LocalSubprocessRuntime)
    /** 中文说明：变量 safeChild 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const safeChild = fakeChild()
    /** 中文说明：变量 bypassChild 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const bypassChild = fakeChild()
    /** 中文说明：变量 spawnSpecs 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const spawnSpecs: SubprocessSpawnSpec[] = []
    vi.spyOn(ctx.subprocess, 'spawn').mockImplementation((spec) => {
      spawnSpecs.push(spec)
      return spec.env?.DSH_CLAUDE_INSTANCE === 'safe'
        ? safeChild.handle
        : bypassChild.handle
    })
    /** 中文说明：变量 queryOptions 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const queryOptions: Options[] = []
    queryMock.mockImplementation(({ options }) => {
      queryOptions.push(options)
      options.spawnClaudeCodeProcess!(sdkSpawnOptions({
        cwd: options.cwd!,
        env: options.env!,
        signal: options.abortController!.signal,
      }))
      return options.permissionMode === 'dontAsk'
        ? waitingQuery(options.abortController!.signal)
        : queryFrom([success('bypass answer')])
    })

    /** 中文说明：变量 added 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const added: string[] = []
    /** 中文说明：变量 started 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const started: string[] = []
    /** 中文说明：变量 ended 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ended: string[] = []
    /** 中文说明：变量 removed 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const removed: string[] = []
    ctx.on('subagent/provider-added', provider => void added.push(provider.name))
    ctx.on('subagent/start', info => void started.push(info.provider))
    ctx.on('subagent/end', info => void ended.push(info.provider))
    ctx.on('subagent/provider-removed', providerName => void removed.push(providerName))
    /** 中文说明：变量 safeFiber 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const safeFiber = await ctx.plugin(claudeCode, {
      providerName: 'claude-safe',
      env: { DSH_CLAUDE_INSTANCE: 'safe' },
      permissionMode: 'dontAsk',
      disposeGraceMs: 11,
    })
    /** 中文说明：变量 bypassFiber 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const bypassFiber = await ctx.plugin(claudeCode, {
      providerName: 'claude-bypass',
      env: { DSH_CLAUDE_INSTANCE: 'bypass' },
      permissionMode: 'bypassPermissions',
      disposeGraceMs: 29,
    })
    expect(ctx.subagents.list()).toEqual(['claude-safe', 'claude-bypass'])
    expect(added).toEqual(['claude-safe', 'claude-bypass'])

    /** 中文说明：变量 safeController 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const safeController = new AbortController()
    const [safeRun, bypassRun] = await Promise.all([
      ctx.subagents.start('claude-safe', request(undefined, safeController.signal)),
      ctx.subagents.start('claude-bypass', request()),
    ])
    await safeFiber.dispose()
    expect(ctx.subagents.list()).toEqual(['claude-bypass'])
    expect(removed).toEqual(['claude-safe'])
    await expect(ctx.subagents.start('claude-safe', request()))
      .rejects.toMatchObject({ code: 'NO_PROVIDER' })

    await expect(bypassRun.result).resolves.toEqual({
      output: [{ type: 'text', text: 'bypass answer' }],
      stopReason: 'completed',
    })
    safeController.abort(new Error('stop only the safe instance'))
    await expect(safeRun.result).resolves.toEqual({
      output: [],
      stopReason: 'aborted',
    })
    expect(queryOptions.map(options => ({
      instance: options.env?.DSH_CLAUDE_INSTANCE,
      permissionMode: options.permissionMode,
    }))).toEqual([
      { instance: 'safe', permissionMode: 'dontAsk' },
      { instance: 'bypass', permissionMode: 'bypassPermissions' },
    ])
    expect(spawnSpecs.map(spec => ({
      instance: spec.env?.DSH_CLAUDE_INSTANCE,
      graceMs: spec.graceMs,
    }))).toEqual([
      { instance: 'safe', graceMs: 11 },
      { instance: 'bypass', graceMs: 29 },
    ])

    await Promise.all([safeRun.dispose(), bypassRun.dispose()])
    expect([...started].sort()).toEqual(['claude-bypass', 'claude-safe'])
    expect([...ended].sort()).toEqual(['claude-bypass', 'claude-safe'])
    expect(safeChild.terminate).toHaveBeenCalledOnce()
    expect(bypassChild.terminate).toHaveBeenCalledOnce()
    await bypassFiber.dispose()
    expect(removed).toEqual(['claude-safe', 'claude-bypass'])
    await ctx.fiber.dispose()
  })

  it('rejects duplicate provider names without replacing the first instance', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(SubagentRuntime)
    await ctx.plugin(LocalSubprocessRuntime)
    /** 中文说明：变量 firstFiber 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const firstFiber = await ctx.plugin(claudeCode, {
      providerName: 'claude-duplicate',
    })
    /** 中文说明：变量 first 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const first = ctx.subagents.getProvider('claude-duplicate')
    await expect(ctx.plugin(claudeCode, {
      providerName: 'claude-duplicate',
      permissionMode: 'bypassPermissions',
    })).rejects.toMatchObject({ code: 'DUPLICATE_PROVIDER' })
    expect(ctx.subagents.getProvider('claude-duplicate')).toBe(first)
    expect(ctx.subagents.list()).toEqual(['claude-duplicate'])
    await firstFiber.dispose()
    await ctx.fiber.dispose()
  })

  it('accepts only the five fixed non-interactive permission modes', () => {
    expect(claudeCode.Config({}).providerName).toBe('claude-code')
    expect(claudeCode.Config({ providerName: 'claude-safe' }).providerName)
      .toBe('claude-safe')
    expect(() => claudeCode.Config({ providerName: '' })).toThrow()
    expect(claudeCode.Config({}).permissionMode)
      .toBe(DEFAULT_CLAUDE_CODE_PERMISSION_MODE)
    /** 中文说明：该循环依次处理代理事件；循环变量仅在当前循环中有效。 */
    for (const permissionMode of CLAUDE_CODE_PERMISSION_MODES) {
      expect(claudeCode.Config({ permissionMode }).permissionMode)
        .toBe(permissionMode)
    }
    /** 中文说明：该循环依次处理代理事件；循环变量仅在当前循环中有效。 */
    for (const permissionMode of ['default', 'interactive', 'future-mode']) {
      expect(() => claudeCode.Config({ permissionMode } as never)).toThrow()
    }
  })

  it('resolves the safe permission default when apply is called directly', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(SubagentRuntime)
    await ctx.plugin(LocalSubprocessRuntime)
    claudeCode.apply(ctx, { env: {}, disposeGraceMs: 3_000 })
    expect(ctx.subagents.getProvider('claude-code')).toBeDefined()
    await ctx.fiber.dispose()
  })

  it('starts through the registered provider with its resolved config and diagnostics', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(SubagentRuntime)
    await ctx.plugin(LocalSubprocessRuntime)
    /** 中文说明：变量 child 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const child = fakeChild()
    /** 中文说明：变量 spawn 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const spawn = vi.spyOn(ctx.subprocess, 'spawn')
      .mockImplementation(() => child.handle)
    /** 中文说明：变量 resolveExecutable 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const resolveExecutable = vi.spyOn(ctx.subprocess, 'resolveExecutable')
      .mockResolvedValue('/host/bin/claude')
    /** 中文说明：函数值 warn 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
    await ctx.plugin(claudeCode, {
      providerName: 'claude-diagnostic',
      env: {
        ANTHROPIC_API_KEY: 'provider-fake-key',
        CLAUDE_CONFIG_DIR: '/private/tmp/dsh-claude-code-unit-config',
        HOME: '/private/tmp/dsh-claude-code-unit-home',
      },
      permissionMode: 'auto',
      disposeGraceMs: 29,
    })

    await expect(ctx.subagents.start('claude-diagnostic', {
      ...request(),
      parent: {
        id: 'parent-without-cwd',
        session: { header: {} },
      } as unknown as Agent,
    })).rejects.toThrow(
      'subagent-claude-code: no working directory for the child — delegate from a parent session that has one',
    )
    expect(queryMock).not.toHaveBeenCalled()

    /** 中文说明：变量 invalidCwdParent 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const invalidCwdParent = {
      id: 'parent-with-invalid-cwd',
      session: { header: { cwd: 'relative/SECRET_TOKEN' } },
    } as unknown as Agent
    /** 中文说明：变量 invalidCwd 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const invalidCwd = ctx.subagents.start('claude-diagnostic', {
      ...request(),
      parent: invalidCwdParent,
    })
    await expect(invalidCwd)
      .rejects.toThrow(expectedFailureDiagnostic('query-start', 'unknown'))
    await expect(invalidCwd).rejects.not.toThrow('relative/SECRET_TOKEN')
    expect(warn).toHaveBeenCalledWith(
      'subagent-claude-code "claude-diagnostic": child start failed: %o',
      expect.any(Error),
    )
    expect(errorCause(warn.mock.calls[0]?.[1] as unknown)?.message)
      .toContain('relative/SECRET_TOKEN')

    /** 中文说明：变量 invalidCwdAbort 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const invalidCwdAbort = new AbortController()
    invalidCwdAbort.abort(new Error('cancel invalid cwd startup'))
    await expect(ctx.subagents.start('claude-diagnostic', {
      ...request(undefined, invalidCwdAbort.signal),
      parent: invalidCwdParent,
    })).rejects.toThrow('aborted before SDK startup')
    expect(queryMock).not.toHaveBeenCalled()
    warn.mockClear()

    vi.stubEnv('PATH', '/host/bin')
    queryMock.mockImplementationOnce(() => {
      throw new Error(
        'Native CLI binary for fixture-platform not found. Reinstall @anthropic-ai/claude-agent-sdk without --omit=optional, or set options.pathToClaudeCodeExecutable.',
      )
    })
    /** 中文说明：变量 missingPayload 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const missingPayload = ctx.subagents.start('claude-diagnostic', request())
    await expect(missingPayload)
      .rejects.toThrow(expectedFailureDiagnostic('query-start', 'unknown'))
    await expect(missingPayload).rejects.not.toThrow('Native CLI binary')
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining(
        'subagent-claude-code "claude-diagnostic": child run failed (error):',
      ),
      expect.any(Error),
    )
    expect(errorCause(warn.mock.calls[0]?.[1] as unknown)?.message)
      .toContain('Native CLI binary for fixture-platform not found')
    expect(resolveExecutable).not.toHaveBeenCalled()

    /** 中文说明：变量 run 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const run = await ctx.subagents.start('claude-diagnostic', request())
    child.settle({ exitCode: 9, signal: null })
    child.stdout.end()
    await expect(run.result).resolves.toEqual({
      output: [],
      diagnostic: expectedFailureDiagnostic('query-run', 'missing-result'),
      stopReason: 'error',
    })
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining(
        'subagent-claude-code "claude-diagnostic": child run failed (error):',
      ),
      expect.any(Error),
    )
    expect(resolveExecutable).not.toHaveBeenCalled()
    expect(queryMock.mock.calls[1]?.[0].options)
      .not.toHaveProperty('pathToClaudeCodeExecutable')
    expect(queryMock.mock.calls[1]?.[0].options.permissionMode).toBe('auto')
    expect(spawn).toHaveBeenCalledWith(expect.objectContaining({
      cwd: process.cwd(),
      graceMs: 29,
    }))
    expect(spawn.mock.calls[0]?.[0].env).toMatchObject({
      ANTHROPIC_API_KEY: 'provider-fake-key',
    })
    await run.dispose()
    await ctx.fiber.dispose()
  })

  it('keeps the Loader namespace shape and package-owned empty invariant', async () => {
    expect('default' in claudeCode).toBe(false)
    expect(claudeCode.name).toBe('subagent-claude-code')
    expect(claudeCode.inject).toEqual(['subagents', 'subprocess'])
    /** 中文说明：变量 loader 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const loader = Object.create(Loader.prototype) as Loader
    expect(loader.unwrapExports(claudeCode)).toBe(claudeCode)

    /** 中文说明：变量 dispose 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const dispose = vi.fn()
    /** 中文说明：变量 register 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const register = vi.fn((
      _packageName: string,
      _installer: InvariantInstaller,
    ) => dispose)
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = { invariants: { register } } as unknown as Context
    await expect(invariant.apply(ctx)).resolves.toBe(dispose)
    expect(register).toHaveBeenCalledWith(
      '@deepseek-ai/dsh-subagent-claude-code',
      expect.any(Function),
    )
    /** 中文说明：变量 install 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const install = register.mock.calls[0]![1]
    await install(new Context(), (message) => { throw new Error(message) })
    expect(invariant.name).toBe('subagent-claude-code-invariant')
    expect(invariant.inject).toEqual(['invariants'])
  })
})

describe('official spawn projection', () => {
  it('forwards command, arguments, cwd, environment, and signal exactly', () => {
    vi.stubEnv('SDK_REMOVED_AMBIENT', 'ambient-value')
    /** 中文说明：变量 signal 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const signal = new AbortController().signal
    /** 中文说明：变量 options 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const options = sdkSpawnOptions({
      command: '/official/claude',
      args: ['--one', 'two'],
      cwd: '/parent/workspace',
      env: { A: 'one', B: undefined, C: 'three' },
      signal,
    })
    expect(sdkEnvironmentOverlay(options.env)).toEqual(expect.objectContaining({
      A: 'one',
      B: undefined,
      C: 'three',
      SDK_REMOVED_AMBIENT: undefined,
    }))
    /** 中文说明：变量 spawnSpec 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const spawnSpec = claudeSpawnSpec(options, 321)
    expect(spawnSpec).toMatchObject({
      argv: ['/official/claude', '--one', 'two'],
      cwd: '/parent/workspace',
      stdio: { stdin: 'pipe', stdout: 'pipe', stderr: 'inherit' },
      graceMs: 321,
      signal,
    })
    expect(spawnSpec.env).toEqual(expect.objectContaining({
      A: 'one',
      B: undefined,
      C: 'three',
      SDK_REMOVED_AMBIENT: undefined,
    }))
    /** 中文说明：变量 missingCwd 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const missingCwd = sdkSpawnOptions()
    delete missingCwd.cwd
    expect(() => claudeSpawnSpec(
      missingCwd,
      321,
    )).toThrow('SDK spawn request omitted its workspace')
    expect(() => claudeSpawnSpec(
      sdkSpawnOptions({ cwd: '' }),
      321,
    )).toThrow('SDK spawn request omitted its workspace')
  })

  it('forwards the SDK-selected Windows native executable without a batch shim', () => {
    /** 中文说明：变量 command 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const command = String.raw`C:\Program Files\Claude\claude.exe`
    /** 中文说明：变量 spec 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const spec = claudeSpawnSpec(sdkSpawnOptions({
      command,
      args: ['--output-format', 'stream-json'],
    }), 7)

    expect(spec.argv).toEqual([
      command, '--output-format', 'stream-json',
    ])
  })

  it('projects streams, exit facts, listeners, and idempotent tree termination', async () => {
    /** 中文说明：变量 child 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const child = fakeChild({ exitOnTerminate: false })
    /** 中文说明：变量 process 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const process = new ManagedClaudeCodeProcess(child.handle)
    expect(process.stdin).toBe(child.stdin)
    expect(process.stdout).toBe(child.stdout)
    expect(process.killed).toBe(false)
    expect(process.exitCode).toBeNull()
    expect(process.signalCode).toBeNull()
    expect(process.outcome).toBeUndefined()

    /** 中文说明：变量 exit 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const exit = vi.fn()
    /** 中文说明：变量 once 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const once = vi.fn()
    /** 中文说明：变量 removed 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const removed = vi.fn()
    process.on('exit', exit)
    process.once('exit', once)
    process.on('exit', removed)
    process.off('exit', removed)
    expect(process.kill('SIGTERM')).toBe(true)
    expect(process.killed).toBe(true)
    expect(process.kill('SIGKILL')).toBe(false)
    expect(child.terminate).toHaveBeenCalledOnce()

    child.settle({ exitCode: null, signal: 'SIGTERM' })
    await nextTask()
    expect(exit).toHaveBeenCalledWith(null, 'SIGTERM')
    expect(once).toHaveBeenCalledOnce()
    expect(removed).not.toHaveBeenCalled()
    expect(process.signalCode).toBe('SIGTERM')
    expect(process.outcome).toEqual({ exitCode: null, signal: 'SIGTERM' })
    expect(process.kill('SIGTERM')).toBe(false)
  })

  it('emits spawn errors', async () => {
    /** 中文说明：变量 child 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const child = fakeChild({ pid: -1 })
    /** 中文说明：变量 process 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const process = new ManagedClaudeCodeProcess(child.handle)
    /** 中文说明：变量 errorListener 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const errorListener = vi.fn()
    /** 中文说明：变量 removed 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const removed = vi.fn()
    process.once('error', errorListener)
    process.on('error', removed)
    process.off('error', removed)
    child.fail(new Error('spawn boom'))
    await nextTask()
    expect(errorListener).toHaveBeenCalledWith(expect.objectContaining({
      message: 'spawn boom',
    }))
    expect(removed).not.toHaveBeenCalled()
  })

  it('exposes a settled direct-child exit code', async () => {
    /** 中文说明：变量 child 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const child = fakeChild()
    /** 中文说明：变量 process 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const process = new ManagedClaudeCodeProcess(child.handle)
    child.settle({ exitCode: 7, signal: null })
    await nextTask()
    expect(process.exitCode).toBe(7)
    expect(process.signalCode).toBeNull()
    expect(process.outcome).toEqual({ exitCode: 7, signal: null })
    expect(process.kill('SIGTERM')).toBe(false)
  })
})

describe('query options and result mapping', () => {
  it('builds the fixed unattended options over the scrubbed environment', async () => {
    vi.stubEnv('HOST_VISIBLE', 'visible')
    vi.stubEnv('HOST_SECRET_TOKEN', 'must-not-leak')
    vi.stubEnv('DSH_INTERNAL', 'must-not-leak')
    /** 中文说明：变量 child 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const child = fakeChild()
    /** 中文说明：函数值 spawn 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const spawn = vi.fn(() => child.handle)
    /** 中文说明：变量 captured 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const captured: SubprocessHandle[] = []
    /** 中文说明：变量 diagnostics 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const diagnostics: string[] = []
    /** 中文说明：变量 spec 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const spec: ClaudeCodeRunSpec = {
      cwd: '/workspace',
      permissionMode: 'acceptEdits',
      env: {
        HOST_VISIBLE: 'overridden',
        ANTHROPIC_API_KEY: 'explicit-fake-key',
      },
      disposeGraceMs: 17,
      spawn,
    }
    /** 中文说明：变量 controller 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const controller = new AbortController()
    /** 中文说明：变量 options 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const options = claudeQueryOptions(
      spec,
      controller,
      (value) => {
        captured.push(value)
      },
      value => diagnostics.push(value),
    )

    expect(options).toMatchObject({
      abortController: controller,
      cwd: '/workspace',
      persistSession: false,
      disallowedTools: ['AskUserQuestion'],
      permissionMode: 'acceptEdits',
      supportedDialogKinds: ['refusal_fallback_prompt'],
    })
    expect(options).not.toHaveProperty('pathToClaudeCodeExecutable')
    expect(options).not.toHaveProperty('allowDangerouslySkipPermissions')
    expect(options.env).toMatchObject({
      HOST_VISIBLE: 'overridden',
      ANTHROPIC_API_KEY: 'explicit-fake-key',
    })
    expect(options.env).not.toHaveProperty('HOST_SECRET_TOKEN')
    expect(options.env).not.toHaveProperty('DSH_INTERNAL')
    expect(options).not.toHaveProperty('settingSources')

    /** 中文说明：变量 callbackSignal 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const callbackSignal = new AbortController().signal
    await expect(options.canUseTool!(
      'Bash',
      { command: 'cat /private/secret.txt', token: 'SECRET_TOKEN' },
      {
        signal: callbackSignal,
        toolUseID: 'tool-1',
        requestId: 'request-1',
        blockedPath: '/private/secret.txt',
        decisionReason: 'SECRET_TOKEN in /private/secret.txt',
      },
    )).resolves.toEqual({
      behavior: 'deny',
      message: 'This unattended Claude Code subagent cannot request human approval.',
    })
    await expect(options.onElicitation!(
      {
        serverName: 'private-server',
        message: 'enter SECRET_TOKEN',
        requestedSchema: { secret: true },
      },
      { signal: callbackSignal },
    )).resolves.toEqual({ action: 'decline' })
    await expect(options.onUserDialog!(
      {
        dialogKind: 'refusal_fallback_prompt',
        payload: { path: '/private/secret.txt', token: 'SECRET_TOKEN' },
      },
      { signal: callbackSignal },
    )).resolves.toEqual({ behavior: 'cancelled' })
    expect(diagnostics).toEqual([
      'Claude Code unattended decision (mode: acceptEdits; request: tool permission; decision: denied): the provider does not request human approval',
      'Claude Code unattended decision (mode: acceptEdits; request: MCP elicitation; decision: declined): the provider does not collect interactive MCP input',
      'Claude Code unattended decision (mode: acceptEdits; request: user dialog; decision: cancelled): the provider does not render blocking dialogs',
    ])
    expect(diagnostics.join('\n')).not.toContain('SECRET_TOKEN')
    expect(diagnostics.join('\n')).not.toContain('/private/secret.txt')

    /** 中文说明：变量 spawned 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const spawned = options.spawnClaudeCodeProcess!(sdkSpawnOptions())
    expect(spawned).toBeInstanceOf(ManagedClaudeCodeProcess)
    expect(captured).toEqual([child.handle])
    expect(spawn).toHaveBeenCalledWith(expect.objectContaining({
      argv: ['/sdk/claude', '--output-format', 'stream-json'],
      cwd: '/workspace',
      graceMs: 17,
    }))
  })

  it.each(CLAUDE_CODE_PERMISSION_MODES)(
    'maps the %s mode and only confirms the dangerous bypass',
    (permissionMode) => {
      /** 中文说明：变量 child 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const child = fakeChild()
      /** 中文说明：变量 options 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const options = claudeQueryOptions({
        cwd: '/workspace',
        permissionMode,
        env: {},
        disposeGraceMs: 17,
        spawn: () => child.handle,
      }, new AbortController(), () => {}, () => {})
      expect(options.permissionMode).toBe(permissionMode)
      expect(options.disallowedTools).toEqual(permissionMode === 'plan'
        ? ['AskUserQuestion', 'ExitPlanMode']
        : ['AskUserQuestion'])
      if (permissionMode === 'bypassPermissions') {
        expect(options.allowDangerouslySkipPermissions).toBe(true)
        expect(options).not.toHaveProperty('canUseTool')
      } else {
        expect(options).not.toHaveProperty('allowDangerouslySkipPermissions')
        expect(options.canUseTool).toBeTypeOf('function')
      }
    },
  )

  it('disallows ExitPlanMode before native plan-mode allow rules', () => {
    /** 中文说明：变量 child 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const child = fakeChild()
    /** 中文说明：变量 options 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const options = claudeQueryOptions({
      cwd: '/workspace',
      permissionMode: 'plan',
      env: {},
      disposeGraceMs: 17,
      spawn: () => child.handle,
    }, new AbortController(), () => {}, () => {})
    expect(options.disallowedTools).toEqual([
      'AskUserQuestion',
      'ExitPlanMode',
    ])
  })

  it('accepts only a non-error success with a non-blank final result', () => {
    expect(successfulResult(success('exact final'))).toBe('exact final')
    expect(() => successfulResult(success('answer', true)))
      .toThrow(expectedFailureDiagnostic('query-run', 'invalid-success'))
    expect(() => successfulResult(success(' \n ')))
      .toThrow(expectedFailureDiagnostic('query-run', 'invalid-success'))
    /** 中文说明：函数值 sdkFailure 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const sdkFailure = () => successfulResult(failure(
      'error_during_execution',
      ['SECRET_TOKEN', '/private/secret.txt'],
    ))
    expect(sdkFailure).toThrow(expectedFailureDiagnostic(
      'query-run',
      'error_during_execution',
    ))
    expect(sdkFailure).not.toThrow('SECRET_TOKEN')
    expect(sdkFailure).not.toThrow('/private/secret.txt')
    expect(() => successfulResult(failure(
      'error_max_turns',
      [],
    ))).toThrow(expectedFailureDiagnostic('query-run', 'error_max_turns'))

    /** 中文说明：变量 unknown 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const unknown = {
      type: 'result',
      subtype: 'future_failure',
      is_error: true,
      errors: ['SECRET_TOKEN'],
    } as unknown as SDKResultMessage
    expect(() => successfulResult(unknown))
      .toThrow(expectedFailureDiagnostic('query-run', 'unknown'))
    expect(() => successfulResult(unknown)).not.toThrow('future_failure')
    expect(() => successfulResult(unknown)).not.toThrow('SECRET_TOKEN')
  })

  it('consumes the complete stream and keeps the latest strict success', async () => {
    /** 中文说明：变量 query 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const query = queryFrom([
      { type: 'system', subtype: 'init' } as SDKMessage,
      success('first'),
      success('last'),
    ])
    await expect(consumeClaudeQuery(query)).resolves.toEqual({
      output: [{ type: 'text', text: 'last' }],
      stopReason: 'completed',
    })
    await expect(consumeClaudeQuery(
      queryFrom([{ type: 'system', subtype: 'init' } as SDKMessage]),
    )).rejects.toThrow(expectedFailureDiagnostic('query-run', 'missing-result'))

    /** 中文说明：变量 onPermissionDenied 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const onPermissionDenied = vi.fn()
    await expect(consumeClaudeQuery(queryFrom([
      permissionDenied(),
      success('after denial'),
    ]), onPermissionDenied)).resolves.toEqual({
      output: [{ type: 'text', text: 'after denial' }],
      stopReason: 'completed',
    })
    expect(onPermissionDenied).toHaveBeenCalledOnce()
  })
})

describe('run publication, cancellation, and settlement', () => {
  it('publishes only after Query and managed child exist, then disposes once', async () => {
    /** 中文说明：变量 fixture 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const fixture = fakeRun([success('exact answer')])
    /** 中文说明：变量 run 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const run = await startClaudeCodeRun(
      request([
        { type: 'text', text: 'first' },
        { type: 'text', text: 'second' },
      ]),
      fixture.spec,
    )
    expect(fixture.options).toHaveLength(1)
    expect(fixture.spawnSpecs).toHaveLength(1)
    await expect(run.result).resolves.toEqual({
      output: [{ type: 'text', text: 'exact answer' }],
      stopReason: 'completed',
    })
    /** 中文说明：变量 first 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const first = run.dispose()
    /** 中文说明：变量 second 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const second = run.dispose()
    expect(second).toBe(first)
    await first
    expect(fixture.close).toHaveBeenCalledOnce()
    expect(fixture.child.terminate).toHaveBeenCalledOnce()
  })

  it('flattens every SDK error result without inventing shared stop reasons', async () => {
    /** 中文说明：变量 subtypes 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const subtypes: ErrorSubtype[] = [
      'error_during_execution',
      'error_max_turns',
      'error_max_budget_usd',
      'error_max_structured_output_retries',
    ]
    /** 中文说明：该循环依次处理代理事件；循环变量仅在当前循环中有效。 */
    for (const subtype of subtypes) {
      /** 中文说明：变量 fixture 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const fixture = fakeRun([failure(subtype)])
      /** 中文说明：变量 onError 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const onError = vi.fn()
      /** 中文说明：变量 run 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const run = await startClaudeCodeRun(
        request(),
        { ...fixture.spec, onError },
      )
      await expect(run.result).resolves.toEqual({
        output: [],
        diagnostic: expectedFailureDiagnostic('query-run', subtype),
        stopReason: 'error',
      })
      expect(onError).toHaveBeenCalledWith(
        expect.any(Error),
        'error',
      )
      await run.dispose()
    }
  })

  it('attaches a safe diagnostic when a permission denial precedes failure', async () => {
    /** 中文说明：变量 fixture 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const fixture = fakeRun([
      permissionDenied(),
      failure('error_during_execution'),
    ])
    /** 中文说明：变量 run 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const run = await startClaudeCodeRun(request(), fixture.spec)
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await run.result
    expect(result).toEqual({
      output: [],
      diagnostic: `${expectedFailureDiagnostic('query-run', 'error_during_execution')}\nClaude Code unattended decision (mode: dontAsk; request: tool permission; decision: denied): Claude Code denied the request before an interactive prompt`,
      stopReason: 'error',
    })
    expect(result.diagnostic).not.toContain('SECRET_TOKEN')
    expect(result.diagnostic).not.toContain('/private/secret.txt')
    await run.dispose()
  })

  it('omits captured diagnostics on success and isolates concurrent runs', async () => {
    /** 中文说明：变量 children 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const children = [fakeChild(), fakeChild()]
    /** 中文说明：变量 childIndex 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let childIndex = 0
    /** 中文说明：变量 spec 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const spec: ClaudeCodeRunSpec = {
      cwd: '/workspace',
      permissionMode: 'dontAsk',
      env: {},
      disposeGraceMs: 5,
      spawn: () => children[childIndex++]!.handle,
    }
    queryMock.mockImplementation(({ prompt, options }) => {
      options.spawnClaudeCodeProcess!(sdkSpawnOptions())
      return prompt === 'denied then completed'
        ? queryFrom([permissionDenied(), success('completed answer')])
        : queryFrom([failure('error_during_execution')])
    })

    const [completed, failed] = await Promise.all([
      startClaudeCodeRun(
        request([{ type: 'text', text: 'denied then completed' }]),
        spec,
      ),
      startClaudeCodeRun(
        request([{ type: 'text', text: 'unrelated failure' }]),
        spec,
      ),
    ])
    await expect(completed.result).resolves.toEqual({
      output: [{ type: 'text', text: 'completed answer' }],
      stopReason: 'completed',
    })
    await expect(failed.result).resolves.toEqual({
      output: [],
      diagnostic: expectedFailureDiagnostic(
        'query-run',
        'error_during_execution',
      ),
      stopReason: 'error',
    })
    await Promise.all([completed.dispose(), failed.dispose()])
  })

  it('fails closed when iteration rejects after a result', async () => {
    /** 中文说明：变量 child 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const child = fakeChild()
    /** 中文说明：变量 outcome 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const outcome = { exitCode: 31, signal: null } as const
    async function* stream(): AsyncGenerator<SDKMessage, void> {
      yield success('partial final')
      child.settle(outcome)
      await Promise.resolve()
      throw new Error('iterator boom')
    }
    queryMock.mockImplementation(({ options }) => {
      options.spawnClaudeCodeProcess!(sdkSpawnOptions())
      return Object.assign(stream(), { close: vi.fn() }) as unknown as Query
    })
    /** 中文说明：变量 run 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const run = await startClaudeCodeRun(request(), {
      cwd: '/workspace',
      permissionMode: DEFAULT_CLAUDE_CODE_PERMISSION_MODE,
      env: {},
      disposeGraceMs: 5,
      spawn: () => child.handle,
    })
    await expect(run.result).resolves.toEqual({
      output: [],
      diagnostic: expectedFailureDiagnostic('query-run', 'unknown', outcome),
      stopReason: 'error',
    })
    await run.dispose()
  })

  it('maps invalid success and missing result to fixed query-run facts', async () => {
    /** 中文说明：该循环依次处理代理事件；循环变量仅在当前循环中有效。 */
    for (const [messages, category] of [
      [[success('answer', true)], 'invalid-success'],
      [[success('')], 'invalid-success'],
      [[{ type: 'system', subtype: 'init' } as SDKMessage], 'missing-result'],
    ] as const) {
      /** 中文说明：变量 fixture 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const fixture = fakeRun(messages)
      /** 中文说明：变量 run 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const run = await startClaudeCodeRun(request(), fixture.spec)
      await expect(run.result).resolves.toEqual({
        output: [],
        diagnostic: expectedFailureDiagnostic('query-run', category),
        stopReason: 'error',
      })
      await run.dispose()
    }
  })

  it('reports an early process exit with independent code and signal facts', async () => {
    /** 中文说明：变量 outcomes 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const outcomes: SubprocessOutcome[] = [
      { exitCode: 23, signal: null },
      { exitCode: null, signal: 'SIGABRT' },
      { exitCode: null, signal: null },
    ]
    /** 中文说明：该循环依次处理代理事件；循环变量仅在当前循环中有效。 */
    for (const outcome of outcomes) {
      /** 中文说明：变量 child 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const child = fakeChild()
      async function* stream(): AsyncGenerator<SDKMessage, void> {
        child.settle(outcome)
        await Promise.resolve()
        throw new Error('SECRET_TOKEN from process transport')
      }
      queryMock.mockImplementation(({ options }) => {
        options.spawnClaudeCodeProcess!(sdkSpawnOptions())
        return Object.assign(stream(), { close: vi.fn() }) as unknown as Query
      })
      /** 中文说明：变量 run 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const run = await startClaudeCodeRun(request(), {
        cwd: '/workspace',
        permissionMode: DEFAULT_CLAUDE_CODE_PERMISSION_MODE,
        env: {},
        disposeGraceMs: 5,
        spawn: () => child.handle,
      })
      /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const result = await run.result
      expect(result).toEqual({
        output: [],
        diagnostic: expectedFailureDiagnostic(
          'process',
          'process-exit',
          outcome,
        ),
        stopReason: 'error',
      })
      expect(result.diagnostic).not.toContain('SECRET_TOKEN')
      await run.dispose()
    }
  })

  it('gives local cancellation precedence and isolates overlapping controllers', async () => {
    /** 中文说明：变量 firstChild 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const firstChild = fakeChild()
    /** 中文说明：变量 secondChild 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const secondChild = fakeChild()
    /** 中文说明：变量 children 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const children = [firstChild, secondChild]
    /** 中文说明：变量 controllers 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const controllers: AbortController[] = []
    /** 中文说明：变量 index 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let index = 0
    /** 中文说明：变量 spec 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const spec: ClaudeCodeRunSpec = {
      cwd: '/workspace',
      permissionMode: 'dontAsk',
      env: {},
      disposeGraceMs: 5,
      spawn: () => children[index++]!.handle,
    }
    queryMock.mockImplementation(({ prompt, options }) => {
      controllers.push(options.abortController!)
      options.spawnClaudeCodeProcess!(sdkSpawnOptions())
      return prompt === 'wait'
        ? waitingQuery(options.abortController!.signal)
        : queryFrom([success('second answer')])
    })
    /** 中文说明：变量 firstAbort 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const firstAbort = new AbortController()
    /** 中文说明：变量 first 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const first = await startClaudeCodeRun(
      request([{ type: 'text', text: 'wait' }], firstAbort.signal),
      spec,
    )
    /** 中文说明：变量 second 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const second = await startClaudeCodeRun(
      request([{ type: 'text', text: 'finish' }]),
      spec,
    )
    expect(controllers).toHaveLength(2)
    expect(controllers[0]).not.toBe(controllers[1])
    firstAbort.abort(new Error('parent cancelled'))
    await expect(first.result).resolves.toEqual({
      output: [],
      stopReason: 'aborted',
    })
    await expect(second.result).resolves.toEqual({
      output: [{ type: 'text', text: 'second answer' }],
      stopReason: 'completed',
    })
    expect(controllers[1]!.signal.aborted).toBe(false)
    await Promise.all([first.dispose(), second.dispose()])
  })

  it('keeps local cancellation authoritative when the SDK iterator ends normally', async () => {
    /** 中文说明：变量 parentAbort 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const parentAbort = new AbortController()
    /** 中文说明：变量 child 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const child = fakeChild()
    async function* stream(): AsyncGenerator<SDKMessage, void> {
      yield success('candidate answer')
      parentAbort.abort(new Error('parent cancelled at iterator completion'))
    }
    queryMock.mockImplementation(({ options }) => {
      options.spawnClaudeCodeProcess!(sdkSpawnOptions())
      return Object.assign(stream(), { close: vi.fn() }) as unknown as Query
    })
    /** 中文说明：变量 run 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const run = await startClaudeCodeRun(
      request(undefined, parentAbort.signal),
      {
        cwd: '/workspace',
        permissionMode: DEFAULT_CLAUDE_CODE_PERMISSION_MODE,
        env: {},
        disposeGraceMs: 5,
        spawn: () => child.handle,
      },
    )
    await expect(run.result).resolves.toEqual({
      output: [],
      stopReason: 'aborted',
    })
    await run.dispose()
  })

  it('rejects pre-abort and every incomplete startup transaction', async () => {
    /** 中文说明：变量 preAborted 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const preAborted = new AbortController()
    preAborted.abort()
    /** 中文说明：变量 unused 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const unused = fakeRun()
    await expect(startClaudeCodeRun(
      request(undefined, preAborted.signal),
      unused.spec,
    )).rejects.toThrow('aborted before SDK startup')
    expect(unused.options).toEqual([])

    /** 中文说明：变量 noChildClose 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const noChildClose = vi.fn()
    queryMock.mockImplementationOnce(
      () => queryFrom([], undefined, noChildClose),
    )
    await expect(startClaudeCodeRun(request(), {
      ...unused.spec,
    })).rejects.toThrow(expectedFailureDiagnostic('query-start', 'unknown'))
    expect(noChildClose).toHaveBeenCalledOnce()

    /** 中文说明：函数值 closeFailure 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const closeFailure = vi.fn(() => { throw new Error('close boom') })
    queryMock.mockImplementationOnce(
      () => queryFrom([], undefined, closeFailure),
    )
    /** 中文说明：变量 noChild 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const noChild = startClaudeCodeRun(request(), {
      ...unused.spec,
    })
    await expect(noChild)
      .rejects.toThrow(expectedFailureDiagnostic('query-start', 'unknown'))
    await expect(noChild).rejects.toThrow(
      `${expectedFailureDiagnostic('query-start', 'unknown')}; subagent-claude-code: ${expectedFailureDiagnostic('teardown', 'unknown')}`,
    )
    await expect(noChild).rejects.toBeInstanceOf(AggregateError)

    /** 中文说明：变量 startupAbort 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const startupAbort = new AbortController()
    /** 中文说明：变量 abortedChild 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const abortedChild = fakeChild()
    /** 中文说明：变量 abortedClose 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const abortedClose = vi.fn()
    queryMock.mockImplementationOnce(({ options }) => {
      options.spawnClaudeCodeProcess!(sdkSpawnOptions())
      startupAbort.abort(new Error('startup cancelled'))
      return queryFrom([], undefined, abortedClose)
    })
    /** 中文说明：变量 abortedDuringStartup 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const abortedDuringStartup = startClaudeCodeRun(
      request(undefined, startupAbort.signal),
      {
        ...unused.spec,
        spawn: () => abortedChild.handle,
      },
    )
    await expect(abortedDuringStartup)
      .rejects.toThrow('aborted before SDK startup')
    expect(abortedClose).toHaveBeenCalledOnce()
    expect(abortedChild.terminate).toHaveBeenCalledOnce()

    /** 中文说明：变量 cleanupAbort 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const cleanupAbort = new AbortController()
    /** 中文说明：变量 cleanupFailedChild 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const cleanupFailedChild = fakeChild({
      waitForExitError: new Error('SECRET_TOKEN cleanup wait failure'),
    })
    queryMock.mockImplementationOnce(({ options }) => {
      options.spawnClaudeCodeProcess!(sdkSpawnOptions())
      cleanupAbort.abort(new Error('startup cancelled'))
      return queryFrom([])
    })
    /** 中文说明：变量 cancelledCleanupFailure 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const cancelledCleanupFailure = startClaudeCodeRun(
      request(undefined, cleanupAbort.signal),
      {
        ...unused.spec,
        spawn: () => cleanupFailedChild.handle,
      },
    )
    await expect(cancelledCleanupFailure)
      .rejects.toBeInstanceOf(AggregateError)
    await expect(cancelledCleanupFailure)
      .rejects.toThrow(expectedFailureDiagnostic('query-start', 'unknown'))
    await expect(cancelledCleanupFailure).rejects.toThrow(
      `${expectedFailureDiagnostic('query-start', 'unknown')}; subagent-claude-code: ${expectedFailureDiagnostic('teardown', 'unknown', { exitCode: 0, signal: null })}`,
    )
    await expect(cancelledCleanupFailure)
      .rejects.not.toThrow('SECRET_TOKEN')

    queryMock.mockImplementationOnce(() => {
      throw new Error('query failed before resource creation')
    })
    /** 中文说明：变量 queryFailureOnError 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const queryFailureOnError = vi.fn<
      NonNullable<ClaudeCodeRunSpec['onError']>
    >()
    /** 中文说明：变量 queryFailure 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const queryFailure = startClaudeCodeRun(request(), {
      ...unused.spec,
      onError: queryFailureOnError,
    })
    await expect(queryFailure)
      .rejects.toThrow(expectedFailureDiagnostic('query-start', 'unknown'))
    await expect(queryFailure).rejects.not.toThrow(
      'query failed before resource creation',
    )
    expect(queryFailureOnError).toHaveBeenCalledWith(
      expect.any(Error),
      'error',
    )
    expect(errorCause(queryFailureOnError.mock.calls[0]?.[0])?.message)
      .toBe('query failed before resource creation')

    /** 中文说明：变量 spawned 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const spawned = fakeChild()
    /** 中文说明：变量 spawnSpecs 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const spawnSpecs: SubprocessSpawnSpec[] = []
    /** 中文说明：变量 factoryController 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let factoryController: AbortController | undefined
    queryMock.mockImplementationOnce(({ options }) => {
      factoryController = options.abortController
      options.spawnClaudeCodeProcess!(sdkSpawnOptions())
      spawned.settle({ exitCode: 17, signal: null })
      throw new Error('query construction failed')
    })
    /** 中文说明：变量 factoryFailure 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const factoryFailure = startClaudeCodeRun(request(), {
      ...unused.spec,
      spawn: (spawnSpec) => {
        spawnSpecs.push(spawnSpec)
        return spawned.handle
      },
    })
    await expect(factoryFailure).rejects.toThrow(expectedFailureDiagnostic(
      'query-start',
      'unknown',
      { exitCode: 17, signal: null },
    ))
    await expect(factoryFailure).rejects.not.toThrow('query construction failed')
    expect(spawnSpecs).toHaveLength(1)
    expect(factoryController?.signal.aborted).toBe(true)
    expect(spawned.terminate).toHaveBeenCalledOnce()

    /** 中文说明：变量 cleanupRaceAbort 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const cleanupRaceAbort = new AbortController()
    /** 中文说明：变量 cleanupRaceChild 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const cleanupRaceChild = fakeChild({ exitOnTerminate: false })
    queryMock.mockImplementationOnce(({ options }) => {
      options.spawnClaudeCodeProcess!(sdkSpawnOptions())
      throw new Error('query failed before cleanup wait')
    })
    /** 中文说明：变量 cleanupRace 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const cleanupRace = startClaudeCodeRun(
      request(undefined, cleanupRaceAbort.signal),
      {
        ...unused.spec,
        spawn: () => cleanupRaceChild.handle,
      },
    )
    await nextTask()
    cleanupRaceAbort.abort(new Error('cancelled during cleanup'))
    cleanupRaceChild.settle()
    await expect(cleanupRace).rejects.toThrow('aborted before SDK startup')

    /** 中文说明：变量 spawnError 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const spawnError = Object.assign(
      new Error('spawn /sdk/claude EACCES'),
      { code: 'EACCES', path: '/sdk/claude' },
    )
    /** 中文说明：变量 failedSpawn 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const failedSpawn = fakeChild({
      pid: -1,
      doneError: spawnError,
    })
    /** 中文说明：变量 failed 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const failed = fakeRun([], undefined, failedSpawn)
    /** 中文说明：变量 failedStartup 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const failedStartup = startClaudeCodeRun(request(), failed.spec)
    await expect(failedStartup)
      .rejects.toThrow(expectedFailureDiagnostic('query-start', 'unknown'))
    await expect(failedStartup).rejects.not.toThrow('spawn /sdk/claude EACCES')
    await expect(failedStartup).rejects.toMatchObject({ cause: spawnError })
    expect(failed.close).toHaveBeenCalledOnce()
    expect(failedSpawn.terminate).not.toHaveBeenCalled()
    expect(failedSpawn.waitForExit).not.toHaveBeenCalled()

    /** 中文说明：变量 failedSpawnAbort 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const failedSpawnAbort = new AbortController()
    /** 中文说明：变量 cancelledFailedSpawn 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const cancelledFailedSpawn = fakeChild({
      pid: -1,
      doneError: spawnError,
    })
    /** 中文说明：变量 cancelledFailedClose 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const cancelledFailedClose = vi.fn()
    queryMock.mockImplementationOnce(({ options }) => {
      options.spawnClaudeCodeProcess!(sdkSpawnOptions())
      failedSpawnAbort.abort(new Error('startup cancelled'))
      return queryFrom([], undefined, cancelledFailedClose)
    })
    await expect(startClaudeCodeRun(
      request(undefined, failedSpawnAbort.signal),
      { ...unused.spec, spawn: () => cancelledFailedSpawn.handle },
    )).rejects.toThrow('aborted before SDK startup')
    expect(cancelledFailedClose).toHaveBeenCalledOnce()

    /** 中文说明：变量 cancelledFailedSpawnCloseError 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const cancelledFailedSpawnCloseError = new Error('cancelled query close failed')
    /** 中文说明：函数值 cancelledFailedSpawnClose 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const cancelledFailedSpawnClose = vi.fn(() => {
      throw cancelledFailedSpawnCloseError
    })
    /** 中文说明：变量 cancelledFailedSpawnWithCloseFailure 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const cancelledFailedSpawnWithCloseFailure = fakeChild({
      pid: -1,
      doneError: spawnError,
    })
    /** 中文说明：变量 failedSpawnAbortWithCloseFailure 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const failedSpawnAbortWithCloseFailure = new AbortController()
    queryMock.mockImplementationOnce(({ options }) => {
      options.spawnClaudeCodeProcess!(sdkSpawnOptions())
      failedSpawnAbortWithCloseFailure.abort(new Error('startup cancelled'))
      return queryFrom([], undefined, cancelledFailedSpawnClose)
    })
    /** 中文说明：变量 cancelledWithCloseFailure 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const cancelledWithCloseFailure = startClaudeCodeRun(
      request(undefined, failedSpawnAbortWithCloseFailure.signal),
      { ...unused.spec, spawn: () => cancelledFailedSpawnWithCloseFailure.handle },
    )
    await expect(cancelledWithCloseFailure).rejects.toMatchObject({
      message: `subagent-claude-code: ${expectedFailureDiagnostic('query-start', 'unknown')}; subagent-claude-code: ${expectedFailureDiagnostic('teardown', 'unknown')}`,
      errors: [
        expect.objectContaining({
          message: `subagent-claude-code: ${expectedFailureDiagnostic('query-start', 'unknown')}`,
          cause: spawnError,
        }),
        expect.objectContaining({
          message: `subagent-claude-code: ${expectedFailureDiagnostic('teardown', 'unknown')}`,
          cause: cancelledFailedSpawnCloseError,
        }),
      ],
    })
    await expect(cancelledWithCloseFailure)
      .rejects.not.toThrow('spawn /sdk/claude EACCES')
    expect(cancelledFailedSpawnClose).toHaveBeenCalledOnce()

    /** 中文说明：变量 failedSpawnCloseError 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const failedSpawnCloseError = new Error('query close failed')
    /** 中文说明：函数值 failedSpawnClose 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const failedSpawnClose = vi.fn(() => { throw failedSpawnCloseError })
    /** 中文说明：变量 failedSpawnWithCloseFailure 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const failedSpawnWithCloseFailure = fakeChild({
      pid: -1,
      doneError: spawnError,
    })
    queryMock.mockImplementationOnce(({ options }) => {
      options.spawnClaudeCodeProcess!(sdkSpawnOptions())
      return queryFrom([], undefined, failedSpawnClose)
    })
    /** 中文说明：变量 failedWithCloseFailure 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const failedWithCloseFailure = startClaudeCodeRun(request(), {
      ...unused.spec,
      spawn: () => failedSpawnWithCloseFailure.handle,
    })
    await expect(failedWithCloseFailure)
      .rejects.toThrow(expectedFailureDiagnostic('query-start', 'unknown'))
    await expect(failedWithCloseFailure)
      .rejects.not.toThrow('spawn /sdk/claude EACCES')
    await expect(failedWithCloseFailure).rejects.toMatchObject({
      message: `subagent-claude-code: ${expectedFailureDiagnostic('query-start', 'unknown')}; subagent-claude-code: ${expectedFailureDiagnostic('teardown', 'unknown')}`,
      errors: [
        expect.objectContaining({ cause: spawnError }),
        expect.objectContaining({ cause: failedSpawnCloseError }),
      ],
    })

    /** 中文说明：变量 cleanupError 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const cleanupError = new Error('live child cleanup failed')
    /** 中文说明：变量 constructionError 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const constructionError = new Error(
      'query construction failed with a live child',
    )
    /** 中文说明：变量 liveChildCleanupFailure 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const liveChildCleanupFailure = fakeChild({ waitForExitError: cleanupError })
    queryMock.mockImplementationOnce(({ options }) => {
      options.spawnClaudeCodeProcess!(sdkSpawnOptions())
      throw constructionError
    })
    /** 中文说明：变量 liveCleanupFailure 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const liveCleanupFailure = startClaudeCodeRun(request(), {
      ...unused.spec,
      spawn: () => liveChildCleanupFailure.handle,
    })
    await expect(liveCleanupFailure).rejects.toMatchObject({
      message: `subagent-claude-code: ${expectedFailureDiagnostic('query-start', 'unknown')}; subagent-claude-code: ${expectedFailureDiagnostic('teardown', 'unknown', { exitCode: 0, signal: null })}`,
      errors: [
        expect.objectContaining({ cause: constructionError }),
        expect.objectContaining({ cause: cleanupError }),
      ],
    })
    await expect(liveCleanupFailure)
      .rejects.not.toThrow('query construction failed with a live child')
    await expect(liveCleanupFailure)
      .rejects.not.toThrow('live child cleanup failed')
  })
})

describe('query and process disposal', () => {
  it('closes the query, terminates the tree, and waits for direct-child outcome', async () => {
    /** 中文说明：变量 child 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const child = fakeChild()
    /** 中文说明：变量 close 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const close = vi.fn()
    await disposeClaudeCodeChild({ close }, child.handle)
    expect(close).toHaveBeenCalledOnce()
    expect(child.terminate).toHaveBeenCalledOnce()
    expect(child.waitForExit).toHaveBeenCalledOnce()
    expect(child.waitForExit).toHaveBeenCalledWith()
    await expect(child.handle.done).resolves.toEqual({
      exitCode: 0,
      signal: null,
    })
  })

  it('reports a published teardown failure to the Host diagnostic sink', async () => {
    /** 中文说明：变量 fixture 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const fixture = fakeRun([success('exact answer')])
    /** 中文说明：变量 onError 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const onError = vi.fn<NonNullable<ClaudeCodeRunSpec['onError']>>()
    /** 中文说明：变量 run 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const run = await startClaudeCodeRun(request(), {
      ...fixture.spec,
      onError,
    })
    await expect(run.result).resolves.toMatchObject({ stopReason: 'completed' })
    fixture.close.mockImplementationOnce(() => {
      throw new Error('SECRET_TOKEN close failure')
    })
    await expect(run.dispose()).rejects.toThrow(
      expectedFailureDiagnostic('teardown', 'unknown', {
        exitCode: 0,
        signal: null,
      }),
    )
    expect(onError).toHaveBeenCalledWith(expect.any(Error), 'error')
    expect(errorCause(onError.mock.calls[0]?.[0])?.message)
      .toBe('SECRET_TOKEN close failure')
  })

  it('does not finish disposal before the managed tree exits', async () => {
    /** 中文说明：变量 child 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const child = fakeChild({ exitOnTerminate: false })
    /** 中文说明：变量 disposed 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let disposed = false
    /** 中文说明：变量 disposal 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const disposal = disposeClaudeCodeChild(
      { close: vi.fn() },
      child.handle,
    ).then(() => {
      disposed = true
    })
    await nextTask()
    expect(disposed).toBe(false)
    child.settle()
    await disposal
    expect(disposed).toBe(true)
  })

  it('reports close and tree-wait failures without skipping cleanup', async () => {
    /** 中文说明：变量 waitFailure 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const waitFailure = fakeChild({
      waitForExitError: new Error('wait boom'),
    })
    /** 中文说明：函数值 closeFailure 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const closeFailure = vi.fn(() => { throw new Error('close boom') })
    /** 中文说明：变量 waitAndClose 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const waitAndClose = disposeClaudeCodeChild(
      { close: closeFailure },
      waitFailure.handle,
    )
    await expect(waitAndClose).rejects.toThrow(expectedFailureDiagnostic(
      'teardown',
      'unknown',
      { exitCode: 0, signal: null },
    ))
    /** 中文说明：变量 waitAndCloseError 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const waitAndCloseError = await waitAndClose.then(
      () => undefined,
      (error: unknown) => error,
    )
    /** 中文说明：变量 waitAndCloseCause 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const waitAndCloseCause = errorCause(waitAndCloseError)
    expect(waitAndCloseCause).toBeInstanceOf(AggregateError)
    expect((waitAndCloseCause as AggregateError).errors).toEqual([
      expect.objectContaining({ message: 'close boom' }),
      expect.objectContaining({ message: 'wait boom' }),
    ])
    expect(waitFailure.terminate).toHaveBeenCalledOnce()
  })
})
