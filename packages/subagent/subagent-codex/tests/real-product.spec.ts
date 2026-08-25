/**
 * 文件职责：验证 real-product.spec.ts 覆盖的子代理启动、协议、继承与生命周期行为。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、进程协议或同进程代理驱动。
 * 产品维度：保障 Agent 能可靠委派任务、继承上下文并收集子代理结果。
 * 逻辑维度：准备代理配置，启动或连接子代理，转发事件，再处理结果、取消与清理。
 * 关键边界：异步状态不等于单次任务结果；外部输出不可信；清理必须等待子代理完全停止。
 * 新手阅读建议：先看公开配置和测试夹具，再读启动/事件流程，最后关注继承、取消与失败路径。
 */
import { execFile } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import type {
  SubprocessHandle,
  SubprocessOutcome,
  SubprocessSpawnSpec,
} from '@deepseek-ai/dsh-subprocess'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import * as codex from '../src/index.ts'
import type { CodexPermissionMode } from '../src/run.ts'
import {
  startResponsesFixture,
  /** 中文说明：type ResponsesBehavior 定义本测试所需的数据或行为，用于表达子代理场景。 */
  type ResponsesBehavior,
  /** 中文说明：type ResponsesFixture 定义本测试所需的数据或行为，用于表达子代理场景。 */
  type ResponsesFixture,
} from './responses-fixture.ts'

/** 中文说明：变量 execFileAsync 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const execFileAsync = promisify(execFile)
/** 中文说明：变量 packageRoot 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const packageRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
/** 中文说明：变量 codexBinDir 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const codexBinDir = join(packageRoot, 'node_modules', '.bin')
/** 中文说明：变量 codexPackageJson 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const codexPackageJson = createRequire(import.meta.url).resolve('@openai/codex/package.json')
/** 中文说明：变量 codexPackage 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const codexPackage = JSON.parse(readFileSync(
  codexPackageJson,
  'utf8',
)) as { version: string; bin: { codex: string } }
/** 中文说明：变量 codexEntry 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const codexEntry = resolve(dirname(codexPackageJson), codexPackage.bin.codex)
/** 中文说明：变量 codexPackageRoot 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const codexPackageRoot = dirname(dirname(codexEntry))

/** 中文说明：变量 roots 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const roots: string[] = []
/** 中文说明：变量 fixtures 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const fixtures: ResponsesFixture[] = []
/** 中文说明：变量 contexts 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const contexts: Context[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(fixtures.splice(0).map(fixture => fixture.close()))
  /** 中文说明：该循环依次处理代理事件；循环变量仅在当前循环中有效。 */
  for (const root of roots.splice(0)) {
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }
})

/** 中文说明：interface RealHarness 定义本测试所需的数据或行为，用于表达子代理场景。 */
interface RealHarness {
  readonly ctx: Context
  readonly handles: SubprocessHandle[]
  readonly spawnSpecs: SubprocessSpawnSpec[]
  readonly parent: Agent
  readonly env: Record<string, string>
  readonly workspace: string
}

/** 中文说明：interface RealInstanceFixture 定义本测试所需的数据或行为，用于表达子代理场景。 */
interface RealInstanceFixture {
  readonly fixture: ResponsesFixture
  readonly env: Record<string, string>
  readonly workspace: string
}

/** 中文说明：type ResponsesScript 定义本测试所需的数据或行为，用于表达子代理场景。 */
type ResponsesScript = readonly ResponsesBehavior[] | ((workspace: string) => readonly ResponsesBehavior[])

/** 中文说明：函数 realInstanceFixture 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function realInstanceFixture(
  script: ResponsesScript,
): Promise<RealInstanceFixture> {
  /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const root = mkdtempSync(join(tmpdir(), 'dsh-codex-real-'))
  roots.push(root)
  /** 中文说明：变量 workspace 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const workspace = join(root, 'workspace')
  /** 中文说明：变量 codexHome 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const codexHome = join(root, 'codex-home')
  mkdirSync(workspace)
  mkdirSync(codexHome)
  /** 中文说明：变量 fixture 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const fixture = await startResponsesFixture(typeof script === 'function' ? script(workspace) : script)
  fixtures.push(fixture)
  writeFileSync(join(codexHome, 'config.toml'), [
    'model = "fixture-model"',
    'model_provider = "fixture"',
    'approval_policy = "on-request"',
    'sandbox_mode = "read-only"',
    'disable_response_storage = true',
    'check_for_update_on_startup = false',
    '',
    '[model_providers.fixture]',
    'name = "Fixture Responses"',
    `base_url = "${fixture.baseUrl}"`,
    'env_key = "OPENAI_API_KEY"',
    'wire_api = "responses"',
    'requires_openai_auth = false',
    '',
    '[analytics]',
    'enabled = false',
    '',
  ].join('\n'))
  /** 中文说明：变量 env 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const env = {
    OPENAI_API_KEY: 'dsh-fake-openai-key',
    CODEX_HOME: codexHome,
    HOME: root,
    XDG_CONFIG_HOME: join(root, 'xdg'),
    PATH: `${codexBinDir}${delimiter}${process.env.PATH ?? ''}`,
    HTTP_PROXY: '',
    HTTPS_PROXY: '',
    ALL_PROXY: '',
    NO_PROXY: '127.0.0.1,localhost',
  }
  return { fixture, env, workspace }
}

/** 中文说明：interface RealRuntime 定义本测试所需的数据或行为，用于表达子代理场景。 */
interface RealRuntime {
  readonly ctx: Context
  readonly handles: SubprocessHandle[]
  readonly spawnSpecs: SubprocessSpawnSpec[]
}

/** 中文说明：函数 realRuntime 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function realRuntime(): Promise<RealRuntime> {
  /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SubagentRuntime)
  await ctx.plugin(LocalSubprocessRuntime)
  /** 中文说明：变量 handles 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const handles: SubprocessHandle[] = []
  /** 中文说明：变量 spawnSpecs 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const spawnSpecs: SubprocessSpawnSpec[] = []
  /** 中文说明：变量 spawn 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const spawn = ctx.subprocess.spawn.bind(ctx.subprocess)
  vi.spyOn(ctx.subprocess, 'spawn').mockImplementation((spec) => {
    spawnSpecs.push(spec)
    /** 中文说明：变量 handle 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const handle = spawn(spec)
    handles.push(handle)
    return handle
  })
  return { ctx, handles, spawnSpecs }
}

/** 中文说明：函数 realHarness 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function realHarness(
  script: ResponsesScript,
  permissionMode?: CodexPermissionMode,
): Promise<{
  readonly harness: RealHarness
  readonly fixture: ResponsesFixture
}> {
  /** 中文说明：变量 instance 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const instance = await realInstanceFixture(script)
  const { ctx, handles, spawnSpecs } = await realRuntime()
  await ctx.plugin(codex, {
    env: instance.env,
    ...permissionMode === undefined ? {} : { permissionMode },
    disposeGraceMs: 2_000,
  })
  /** 中文说明：变量 parent 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const parent = {
    id: 'real-parent',
    session: { header: { cwd: instance.workspace } },
  } as unknown as Agent
  return {
    harness: {
      ctx,
      handles,
      spawnSpecs,
      parent,
      env: instance.env,
      workspace: instance.workspace,
    },
    fixture: instance.fixture,
  }
}

/** 中文说明：函数 expectQuiescent 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function expectQuiescent(handles: readonly SubprocessHandle[]): Promise<void> {
  expect(handles.length).toBeGreaterThan(0)
  /** 中文说明：该循环依次处理代理事件；循环变量仅在当前循环中有效。 */
  for (const handle of handles) {
    await expect(handle.waitForExit()).resolves.toBe(true)
    /** 中文说明：变量 outcome 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const outcome = await handle.done
    expect(outcome).toHaveProperty('exitCode')
    expect(outcome).toHaveProperty('signal')
  }
}

/** 中文说明：函数 expectedProcessExitDiagnostic 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function expectedProcessExitDiagnostic(outcome: SubprocessOutcome): string {
  /** 中文说明：变量 fields 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const fields = [
    'product: Codex',
    'stage: process',
    'category: process-exit',
  ]
  if (outcome.exitCode !== null) fields.push(`exit code: ${outcome.exitCode}`)
  if (outcome.signal !== null) fields.push(`signal: ${outcome.signal}`)
  return `Product subagent failure (${fields.join('; ')})`
}

/** 中文说明：interface JsonSchemaNode 定义本测试所需的数据或行为，用于表达子代理场景。 */
interface JsonSchemaNode {
  readonly enum?: string[]
  readonly format?: string
  readonly minimum?: number
  readonly properties?: Record<string, JsonSchemaNode>
  readonly required?: string[]
  readonly type?: string | string[]
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

describe('real @openai/codex 0.147.0 product', () => {
  it('starts approve-for-me through the real app-server and returns exact text', async () => {
    /** 中文说明：变量 sentinel 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const sentinel = 'REAL_CODEX_SENTINEL_0_147_0'
    /** 中文说明：变量 task 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const task = 'Return the fixture sentinel exactly.'
    const { harness, fixture } = await realHarness([
      { kind: 'complete', text: sentinel },
    ], 'approve-for-me')
    expect(codexPackage.version).toBe('0.147.0')
    /** 中文说明：变量 version 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const version = await execFileAsync(process.execPath, [codexEntry, '--version'], {
      env: { ...process.env, ...harness.env },
    })
    expect(version.stdout.trim()).toBe('codex-cli 0.147.0')
    /** 中文说明：变量 schemaRoot 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const schemaRoot = mkdtempSync(join(tmpdir(), 'dsh-codex-schema-'))
    roots.push(schemaRoot)
    await execFileAsync(process.execPath, [
      codexEntry,
      'app-server',
      'generate-json-schema',
      '--out',
      schemaRoot,
    ], { env: { ...process.env, ...harness.env } })
    /** 中文说明：变量 schema 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const schema = JSON.parse(readFileSync(
      join(schemaRoot, 'ServerNotification.json'),
      'utf8',
    )) as {
      definitions: {
        CodexErrorInfo: {
          oneOf: JsonSchemaNode[]
        }
      }
    }
    expect(schema.definitions.CodexErrorInfo.oneOf[0]?.enum).toEqual([
      'contextWindowExceeded',
      'sessionBudgetExceeded',
      'usageLimitExceeded',
      'serverOverloaded',
      'cyberPolicy',
      'internalServerError',
      'unauthorized',
      'badRequest',
      'threadRollbackFailed',
      'sandboxError',
      'other',
    ])
    expect(schema.definitions.CodexErrorInfo.oneOf.slice(1).map(variant =>
      Object.keys(variant.properties ?? {})[0])).toEqual([
      'httpConnectionFailed',
      'responseStreamConnectionFailed',
      'responseStreamDisconnected',
      'responseTooManyFailedAttempts',
      'activeTurnNotSteerable',
    ])
    /** 中文说明：该循环依次处理代理事件；循环变量仅在当前循环中有效。 */
    for (const variant of schema.definitions.CodexErrorInfo.oneOf.slice(1, 5)) {
      /** 中文说明：变量 category 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const category = Object.keys(variant.properties ?? {})[0]!
      /** 中文说明：变量 detail 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const detail = variant.properties?.[category]
      expect(detail?.required).toBeUndefined()
      expect(detail?.properties?.httpStatusCode).toEqual({
        format: 'uint16',
        minimum: 0,
        type: ['integer', 'null'],
      })
    }

    /** 中文说明：变量 run 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const run = await harness.ctx.subagents.start('codex', {
      prompt: [{ type: 'text', text: task }],
      parent: harness.parent,
      signal: new AbortController().signal,
    })
    await expect(run.result).resolves.toEqual({
      output: [{ type: 'text', text: sentinel }],
      stopReason: 'completed',
    })
    await run.dispose()

    expect(harness.spawnSpecs[0]?.argv).toEqual([
      process.execPath,
      codexEntry,
      'app-server',
      '--stdio',
    ])

    expect(fixture.requests).toHaveLength(1)
    /** 中文说明：变量 recorded 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const recorded = fixture.requests[0]!
    expect(recorded.method).toBe('POST')
    expect(recorded.path).toBe('/v1/responses')
    expect(recorded.headers.authorization).toBe('Bearer dsh-fake-openai-key')
    expect(responseInputTexts(recorded.body)).toContain(task)
    await expectQuiescent(harness.handles)
  }, 60_000)

  it('fails a missing platform payload without falling back to a host codex', async () => {
    /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const root = mkdtempSync(join(tmpdir(), 'dsh-codex-missing-payload-'))
    roots.push(root)
    /** 中文说明：变量 isolatedPackage 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const isolatedPackage = join(root, 'node_modules', '@openai', 'codex')
    mkdirSync(dirname(isolatedPackage), { recursive: true })
    cpSync(codexPackageRoot, isolatedPackage, { recursive: true, dereference: true })
    /** 中文说明：变量 isolatedEntry 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const isolatedEntry = join(isolatedPackage, 'bin', 'codex.js')

    await expect(execFileAsync(process.execPath, [isolatedEntry, '--version'], {
      env: {
        PATH: codexBinDir,
        ...process.platform === 'win32' && process.env.SystemRoot !== undefined
          ? { SystemRoot: process.env.SystemRoot }
          : {},
      },
    })).rejects.toThrow(/Missing optional dependency @openai\/codex-[a-z0-9-]+/)
  }, 30_000)

  it('runs two named instances concurrently and unloads one without revoking its run', async () => {
    /** 中文说明：变量 safeInstance 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const safeInstance = await realInstanceFixture([{ kind: 'hold' }])
    /** 中文说明：变量 bypassInstance 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const bypassInstance = await realInstanceFixture([{
      kind: 'complete',
      text: 'NAMED_CODEX_BYPASS_RESULT',
    }])
    const { ctx, handles, spawnSpecs } = await realRuntime()
    /** 中文说明：变量 safeFiber 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const safeFiber = await ctx.plugin(codex, {
      providerName: 'codex-safe',
      env: safeInstance.env,
      permissionMode: 'never',
      disposeGraceMs: 2_000,
    })
    /** 中文说明：变量 bypassFiber 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const bypassFiber = await ctx.plugin(codex, {
      providerName: 'codex-bypass',
      env: bypassInstance.env,
      permissionMode: 'dangerously-bypass-approvals-and-sandbox',
      disposeGraceMs: 2_000,
    })
    /** 中文说明：变量 safeParent 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const safeParent = {
      id: 'safe-parent',
      session: { header: { cwd: safeInstance.workspace } },
    } as unknown as Agent
    /** 中文说明：变量 bypassParent 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const bypassParent = {
      id: 'bypass-parent',
      session: { header: { cwd: bypassInstance.workspace } },
    } as unknown as Agent
    /** 中文说明：变量 safeController 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const safeController = new AbortController()

    const [safeRun, bypassRun] = await Promise.all([
      ctx.subagents.start('codex-safe', {
        prompt: [{ type: 'text', text: 'Hold the safe instance.' }],
        parent: safeParent,
        signal: safeController.signal,
      }),
      ctx.subagents.start('codex-bypass', {
        prompt: [{ type: 'text', text: 'Complete the bypass instance.' }],
        parent: bypassParent,
        signal: new AbortController().signal,
      }),
    ])
    await safeInstance.fixture.requestStarted
    await safeFiber.dispose()
    expect(ctx.subagents.list()).toEqual(['codex-bypass'])
    await expect(ctx.subagents.start('codex-safe', {
      prompt: [{ type: 'text', text: 'This start must fail.' }],
      parent: safeParent,
      signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'NO_PROVIDER' })

    await expect(bypassRun.result).resolves.toEqual({
      output: [{ type: 'text', text: 'NAMED_CODEX_BYPASS_RESULT' }],
      stopReason: 'completed',
    })
    safeController.abort(new Error('cancel only the published safe run'))
    await expect(safeRun.result).resolves.toEqual({
      output: [],
      stopReason: 'aborted',
    })
    await Promise.all([safeRun.dispose(), bypassRun.dispose()])
    expect(safeInstance.fixture.requests).toHaveLength(1)
    expect(bypassInstance.fixture.requests).toHaveLength(1)
    expect(safeInstance.fixture.requests[0]?.body.input)
      .not.toEqual(bypassInstance.fixture.requests[0]?.body.input)
    expect(spawnSpecs.map(spec => spec.env?.CODEX_HOME).sort()).toEqual([
      safeInstance.env.CODEX_HOME,
      bypassInstance.env.CODEX_HOME,
    ].sort())
    await expectQuiescent(handles)
    await bypassFiber.dispose()
    expect(ctx.subagents.list()).toEqual([])
  }, 60_000)

  it('overrides on-request with never and reports a denied command safely', async () => {
    /** 中文说明：变量 command 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const command = process.platform === 'win32'
      ? 'cmd /c type nul > approval-side-effect'
      : 'touch approval-side-effect'
    /** 中文说明：变量 commandCalls 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const commandCalls = [
      {
        name: 'exec_command',
        arguments: {
          cmd: command,
          sandbox_permissions: 'require_escalated',
          justification: 'exercise the unattended approval boundary',
        },
      },
      {
        name: 'shell_command',
        arguments: {
          command,
          sandbox_permissions: 'require_escalated',
          justification: 'exercise the unattended approval boundary',
        },
      },
    ] as const
    const { harness, fixture } = await realHarness([
      {
        kind: 'advertisedFunctionCall',
        choices: commandCalls,
      },
      {
        kind: 'error',
        status: 400,
        message: 'fixture terminal failure after permission denial',
      },
    ])
    /** 中文说明：变量 sideEffect 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const sideEffect = join(harness.workspace, 'approval-side-effect')
    /** 中文说明：变量 run 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const run = await harness.ctx.subagents.start('codex', {
      prompt: [{ type: 'text', text: 'Attempt the fixture command.' }],
      parent: harness.parent,
      signal: new AbortController().signal,
    })
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await run.result
    expect(result.output).toEqual([])
    expect(result.stopReason).toBe('error')
    /** 中文说明：变量 diagnosticLines 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const diagnosticLines = result.diagnostic?.split('\n') ?? []
    expect(diagnosticLines[0]).toBe(
      'Product subagent failure (product: Codex; stage: turn; category: other)',
    )
    expect([
      'Codex unattended decision (mode: never; request: command approval; decision: cancelled): the provider does not grant interactive approval',
      'Codex unattended decision (mode: never; request: sandbox execution; decision: failed): Codex reported a sandbox failure',
      'Codex unattended decision (mode: never; request: command execution; decision: denied): Codex rejected an escalation because the selected policy never asks for approval',
    ]).toContain(diagnosticLines[1])
    expect(result.diagnostic).not.toContain(command)
    expect(result.diagnostic).not.toContain(harness.workspace)
    await run.dispose()

    expect(existsSync(sideEffect)).toBe(false)
    expect(fixture.requests).toHaveLength(2)
    /** 中文说明：变量 tools 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const tools = fixture.requests[0]!.body.tools as Array<Record<string, unknown>>
    expect(commandCalls.some(call => tools.some(tool => (
      tool.type === 'function' && tool.name === call.name
    )))).toBe(true)
    expect(fixture.requests.every(requestEntry =>
      requestEntry.headers.authorization === 'Bearer dsh-fake-openai-key',
    )).toBe(true)
    await expectQuiescent(harness.handles)
  }, 60_000)

  it('reports a real service failure and an early app-server exit safely', async () => {
    {
      const { harness } = await realHarness([{
        kind: 'error',
        status: 503,
        message: 'SECRET_TOKEN in /private/secret.txt',
      }])
      /** 中文说明：变量 run 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const run = await harness.ctx.subagents.start('codex', {
        prompt: [{ type: 'text', text: 'Exercise the service failure path.' }],
        parent: harness.parent,
        signal: new AbortController().signal,
      })
      /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const result = await run.result
      expect(result).toMatchObject({ output: [], stopReason: 'error' })
      expect(result.diagnostic).toBe(
        'Product subagent failure (product: Codex; stage: turn; category: internalServerError)',
      )
      expect(result.diagnostic).not.toContain('SECRET_TOKEN')
      expect(result.diagnostic).not.toContain('/private/secret.txt')
      await run.dispose()
      await expectQuiescent(harness.handles)
    }
    {
      const { harness, fixture } = await realHarness([{ kind: 'hold' }])
      /** 中文说明：变量 run 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const run = await harness.ctx.subagents.start('codex', {
        prompt: [{ type: 'text', text: 'Exercise the process failure path.' }],
        parent: harness.parent,
        signal: new AbortController().signal,
      })
      await fixture.requestStarted
      expect(harness.handles).toHaveLength(1)
      harness.handles[0]!.terminate()
      /** 中文说明：变量 outcome 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const outcome = await harness.handles[0]!.done
      await expect(run.result).resolves.toEqual({
        output: [],
        diagnostic: expectedProcessExitDiagnostic(outcome),
        stopReason: 'error',
      })
      await run.dispose()
      await expectQuiescent(harness.handles)
    }
  }, 60_000)

  it('executes an explicitly selected dangerous bypass write in the isolated workspace', async () => {
    /** 中文说明：变量 sideEffect 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const sideEffect = 'bypass-side-effect'
    const { harness, fixture } = await realHarness((workspace): readonly ResponsesBehavior[] => {
      /** 中文说明：变量 target 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const target = join(workspace, sideEffect)
      /** 中文说明：变量 command 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const command = process.platform === 'win32'
        ? `powershell.exe -NoLogo -NoProfile -NonInteractive -Command "Set-Content -LiteralPath '${target.replaceAll("'", "''")}' -Value 'bypass' -NoNewline"`
        : `printf bypass > ${JSON.stringify(target)}`
      /** 中文说明：变量 commandCalls 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const commandCalls = [
        {
          name: 'exec_command',
          arguments: {
            cmd: command,
          },
        },
        {
          name: 'shell_command',
          arguments: {
            command,
          },
        },
      ] as const
      return [
        { kind: 'advertisedFunctionCall', choices: commandCalls },
        { kind: 'complete', text: 'bypass complete' },
      ]
    }, 'dangerously-bypass-approvals-and-sandbox')
    /** 中文说明：变量 target 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const target = join(harness.workspace, sideEffect)
    /** 中文说明：变量 run 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const run = await harness.ctx.subagents.start('codex', {
      prompt: [{ type: 'text', text: 'Create the fixture side effect.' }],
      parent: harness.parent,
      signal: new AbortController().signal,
    })
    await expect(run.result).resolves.toEqual({
      output: [{ type: 'text', text: 'bypass complete' }],
      stopReason: 'completed',
    })
    expect(existsSync(target), JSON.stringify(fixture.requests.at(-1)?.body.input)).toBe(true)
    expect(readFileSync(target, 'utf8').trim()).toBe('bypass')
    await run.dispose()
    await expectQuiescent(harness.handles)
  }, 60_000)

  it('settles cancellation locally and leaves the real app-server tree quiescent', async () => {
    const { harness, fixture } = await realHarness([{ kind: 'hold' }])
    /** 中文说明：变量 controller 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const controller = new AbortController()
    /** 中文说明：变量 run 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const run = await harness.ctx.subagents.start('codex', {
      prompt: [{ type: 'text', text: 'Wait for cancellation.' }],
      parent: harness.parent,
      signal: controller.signal,
    })
    await fixture.requestStarted
    controller.abort(new Error('real product cancellation'))
    await expect(run.result).resolves.toMatchObject({ stopReason: 'aborted' })
    await run.dispose()
    await expectQuiescent(harness.handles)
  }, 60_000)
})
