/**
 * Consumer-surface tests for the search tools over a FAKE subprocess service
 * and a FAKE spill backend, exercised through `ctx.tools.execute()` so nothing
 * bypasses the tool registry. The fake service makes every seam outcome
 * scriptable — spawn failure, truncated stdout with/without a raw spill path,
 * abort/timeout kills, signal kills, ripgrep exit codes — so these tests
 * verify schemas, argument validation, argv construction, workdir derivation,
 * signal forwarding, `SEARCH_*` error classification, retention,
 * formatted-result spill handoff, and the no-background-job invariant.
 * Real-`rg` behavior is pinned separately in integration.spec.ts.
 */
/*
 * 文件职责：验证文件系统与工具的 tools.spec.ts 行为与安全边界。
 * 技术维度：TypeScript、Cordis、会话事件、路径策略、判别联合和 Vitest。
 * 产品维度：保证文件系统与工具操作可预测、可审计并在失败时保持一致。
 * 逻辑维度：构造请求与状态，驱动服务并断言输出和清理。
 * 关键边界：文件路径必须经过策略检查；目标引用含版本，过期修改必须拒绝。
 * 新手阅读建议：先读类型与测试夹具，再按校验、执行、事件折叠和错误流程阅读。
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { join, sep } from 'node:path'
import { createUserMessage, CallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { TOOL_ABORTED_BEFORE_DISPATCH, type ToolExecution, type ToolExecutionToken } from '@deepseek-ai/dsh-tools'
import { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import type { SubprocessCollectedOutputs, SubprocessHandle, SubprocessOutcome, SubprocessOutputRead, SubprocessOutputReader, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import { rgPath } from '@vscode/ripgrep'
import { SpillLocator, SpillStore } from '@deepseek-ai/dsh-spill'
import type { SaveTextSpill, SpillRef } from '@deepseek-ai/dsh-spill'
import * as ToolFsSearch from '@deepseek-ai/dsh-tool-fs-search'
import {
  buildGlobCommand,
  buildGrepCommand,
  formatGrepMatches,
  parseGrepMatches,
  presentGlobCall,
  presentGlobResult,
  presentGrepCall,
  presentGrepResult,
  previewLine,
  resolveRgPath,
  runRipgrep,
  sampleAcrossTopLevel,
  toWorkdirRelative,
} from '@deepseek-ai/dsh-tool-fs-search'

/** 中文说明：测试局部值 testToolSignal，由紧邻初始化决定。 */
const testToolSignal = new AbortController().signal

/**
 * Normalize a POSIX-style test path to the platform separator: the sampler and
 * the workdir-relative display conversion group by `node:path.sep`, so
 * `/`-literal paths would collapse into per-path groups on Windows.
 */
/* 中文说明：测试局部值 w，由紧邻初始化决定。 */
const w = (path: string): string => path.replaceAll('/', sep)

/** One scripted collect-mode stream, returned by `readFrom(0)` after settlement. */
/* 中文说明：类型或类 ScriptedStream 约束文件或目标数据职责。 */
interface ScriptedStream {
  text: string
  lossy?: boolean
  spillPath?: string
}

/** One scripted spawn: exit facts plus the collected streams the tool reads. */
/* 中文说明：类型或类 ScriptedRun 约束文件或目标数据职责。 */
interface ScriptedRun {
  outcome: SubprocessOutcome
  stdout: ScriptedStream
  stderr: ScriptedStream
}

/** A successful run over the given stdout; overrides script the failure shapes. */
/* 中文说明：函数 runResult 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function runResult(
  stdout: string,
  overrides?: Partial<SubprocessOutcome> & { stdout?: Partial<ScriptedStream>; stderr?: ScriptedStream },
): ScriptedRun {
  /** 中文说明：测试局部值 { stdout，由紧邻初始化决定。 */
  const { stdout: stdoutOverrides, stderr: stderrOverrides, ...outcome } = overrides ?? {}
  return {
    outcome: { exitCode: 0, signal: null, ...outcome },
    stdout: { text: stdout, ...stdoutOverrides },
    stderr: { text: '', ...stderrOverrides },
  }
}

/** A fixed-response collect-mode reader: the tools read each stream once, from 0, after settlement. */
/* 中文说明：类型或类 FakeReader 约束文件或目标数据职责。 */
class FakeReader implements SubprocessOutputReader {
  constructor(private readonly read: ScriptedStream) {}

  readFrom(_fromByte: number): SubprocessOutputRead {
    return {
      text: this.read.text,
      nextOffset: 0,
      lossy: this.read.lossy ?? false,
      ...this.read.spillPath !== undefined ? { spillPath: this.read.spillPath } : {},
    }
  }
}

/**
 * A scriptable subprocess handle: `done` resolves with the scripted outcome
 * (or rejects with the scripted error), `terminate()` records the call, and
 * the spec's abort signal marks the handle terminated — mirroring the seam's
 * abort→terminate escalation.
 */
/* 中文说明：类型或类 FakeHandle 约束文件或目标数据职责。 */
class FakeHandle implements SubprocessHandle {
  readonly pid = 4242
  readonly stdin = undefined
  readonly stdout = undefined
  readonly stderr = undefined
  readonly collected: SubprocessCollectedOutputs
  readonly done: Promise<SubprocessOutcome>
  /** True once `done` settled — the search tools must never leave a spawn running. */
  settled = false
  /** True when the handle's termination path ran (abort signal or explicit terminate). */
  terminated = false
  /** Scripted handle that drops one requested collect reader (the defensive branch). */
  readonly dropReaders: boolean

  constructor(spec: SubprocessSpawnSpec, script: () => ScriptedRun | { reject: Error }, dropReaders = false) {
    this.dropReaders = dropReaders
    // The abort listener attaches BEFORE the scripted run resolves, mirroring
    // a real spawn: the escalation is armed when the process starts.
    spec.signal?.addEventListener('abort', () => { this.terminated = true }, { once: true })
    /** 中文说明：测试局部值 scripted，由紧邻初始化决定。 */
    const scripted = script()
    if ('reject' in scripted) {
      // A spawn failure produces no process output, so no readers exist.
      this.collected = {}
      this.done = Promise.reject(scripted.reject)
    } else {
      this.collected = {
        ...dropReaders ? {} : { stdout: new FakeReader(scripted.stdout), stderr: new FakeReader(scripted.stderr) },
      }
      this.done = Promise.resolve(scripted.outcome)
    }
    this.done.then(
      () => { this.settled = true },
      () => { this.settled = true },
    )
  }

  terminate(): void {
    this.terminated = true
  }

  waitForExit(_signal?: AbortSignal): Promise<boolean> {
    return Promise.resolve(true)
  }
}

/**
 * A scriptable fake subprocess service: `spawn()` records every spec and
 * returns a handle scripted by the armed `handler`. The search tools must
 * never spawn outside a single awaited foreground call, so every test can
 * assert on the exact spawn specs and settled handles.
 */
/* 中文说明：类型或类 FakeSubprocess 约束文件或目标数据职责。 */
class FakeSubprocess extends SubprocessRuntime {
  spawns: SubprocessSpawnSpec[] = []
  override async resolveExecutable(command: string): Promise<string> { return command }
  override spawnTerminal(): Promise<never> { throw new Error('search tools spawn pipes, never terminals') }
  handles: FakeHandle[] = []
  /** Arms the per-spawn script; a `{ reject }` return scripts a spawn-level failure. */
  handler: (spec: SubprocessSpawnSpec) => ScriptedRun | { reject: Error } = () => runResult('')
  /** When true, spawned handles drop their collect readers (the defensive branch). */
  dropReaders = false

  override spawn(spec: SubprocessSpawnSpec): SubprocessHandle {
    this.spawns.push(spec)
    /** 中文说明：测试局部值 handle，由紧邻初始化决定。 */
    const handle = new FakeHandle(spec, () => this.handler(spec), this.dropReaders)
    this.handles.push(handle)
    return handle
  }
}

/** A recording spill backend; arm `failWith` to script a storage failure. */
/* 中文说明：类型或类 FakeSpill 约束文件或目标数据职责。 */
class FakeSpill extends SpillStore {
  saves: SaveTextSpill[] = []
  failWith?: Error

  override saveText(input: SaveTextSpill): Promise<SpillRef> {
    if (this.failWith) return Promise.reject(this.failWith)
    this.saves.push(input)
    return Promise.resolve({
      locator: SpillLocator(`/spill/${input.suggestedName}`),
      bytes: Buffer.byteLength(input.content, 'utf8'),
      retrievalHint: 'Use the fake retrieval hint.',
    })
  }
}

/** 中文说明：类型或类 SetupOptions 约束文件或目标数据职责。 */
interface SetupOptions {
  config?: Partial<ToolFsSearch.Config>
  spill?: boolean
}

/** 中文说明：测试局部值 DEFAULT_CONFIG，由紧邻初始化决定。 */
const DEFAULT_CONFIG = { sampleOverCapGlobResults: true } satisfies ToolFsSearch.Config

/** 中文说明：函数 setup 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
async function setup(options: SetupOptions = {}) {
  /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
  const ctx = new Context()
  /** 中文说明：测试局部值 warnings，由紧邻初始化决定。 */
  const warnings: string[] = []
  ctx.logger.warn = ((message: unknown) => { warnings.push(String(message)) }) as typeof ctx.logger.warn
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(FakeSubprocess)
  /** 中文说明：测试局部值 subprocess，由紧邻初始化决定。 */
  const subprocess = ctx.subprocess as FakeSubprocess
  if (options.spill === true) await ctx.plugin(FakeSpill)
  /** 中文说明：测试局部值 fiber，由紧邻初始化决定。 */
  const fiber = await ctx.plugin(ToolFsSearch, { ...DEFAULT_CONFIG, ...options.config })
  /** 中文说明：测试局部值 spill，由紧邻初始化决定。 */
  const spill = options.spill === true ? ctx.get('spillStore') as FakeSpill : undefined
  return { ctx, subprocess, spill, fiber, warnings }
}

/** A stand-in agent whose session header carries the given cwd (and a stable id). */
/* 中文说明：测试局部值 agent，由紧邻初始化决定。 */
const agent = (cwd?: string) => ({ session: { header: { id: 'session-1', ...cwd !== undefined ? { cwd } : {} } } })

/** 中文说明：测试局部值 callCounter，由紧邻初始化决定。 */
let callCounter = 0
/** 中文说明：函数 call 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function call(
  ctx: Context,
  name: string,
  args: unknown,
  options: { agent?: object; signal?: AbortSignal; parent?: ToolExecutionToken } = {},
) {
  return ctx.tools.execute({
    signal: testToolSignal,
    callId: CallId(`call-${++callCounter}`),
    name,
    arguments: args,
    ...options.agent ? { agent: options.agent as never } : {},
    ...options.signal ? { signal: options.signal } : {},
    ...options.parent ? { parent: options.parent } : {},
  })
}

/** 中文说明：函数 text 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function text(result: { content: { type: string; text?: string }[] }): string {
  return result.content.filter(b => b.type === 'text').map(b => b.text).join('')
}

/** One rg --json match record line. */
/* 中文说明：函数 matchLine 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function matchLine(path: string, lineNumber: number, lineText: string): string {
  return JSON.stringify({ type: 'match', data: { path: { text: path }, lines: { text: lineText }, line_number: lineNumber, absolute_offset: 0, submatches: [] } })
}

describe('registration', () => {
  it('registers glob and grep unconditionally with their prompt sections', async () => {
    /** 中文说明：测试局部值 { ctx, subprocess }，由紧邻初始化决定。 */
    const { ctx, subprocess } = await setup()
    // Registration performs NO load-time probe: the packaged binary is always
    // available, so nothing spawns until a tool call.
    expect(subprocess.spawns).toHaveLength(0)
    expect(ctx.tools.schemas().map(s => s.name).sort()).toEqual(['glob', 'grep'])
    /** 中文说明：测试局部值 prompt，由紧邻初始化决定。 */
    const prompt = renderPrompt(await ctx.systemPrompt.assemble())
    expect(prompt).toContain('Use the glob tool')
    expect(prompt).toContain('Use the grep tool')
    expect(prompt).toContain('sampled across top-level entries')
    expect(prompt).not.toContain('sampled across top-level directories')
    /** 中文说明：测试局部值 glob，由紧邻初始化决定。 */
    const glob = ctx.tools.schemas().find(schema => schema.name === 'glob')
    expect(glob?.description).toContain('sampled across top-level entries')
  })

  it('stays pending until ctx.subprocess exists (inject)', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(ToolFsSearch, DEFAULT_CONFIG) // no subprocess service
    expect(ctx.tools.schemas()).toHaveLength(0)
  })

  it('unregisters everything on fiber disposal (HMR safety)', async () => {
    /** 中文说明：测试局部值 { ctx, fiber }，由紧邻初始化决定。 */
    const { ctx, fiber } = await setup()
    expect(ctx.tools.schemas()).toHaveLength(2)
    await fiber.dispose()
    expect(ctx.tools.schemas()).toHaveLength(0)
    /** 中文说明：测试局部值 sections，由紧邻初始化决定。 */
    const sections = (await ctx.systemPrompt.assemble()).sections.map(s => s.name)
    expect(sections).not.toContain('tool:glob')
    expect(sections).not.toContain('tool:grep')
  })

  it('attaches the configured timeoutMs to both tool definitions', async () => {
    /** 中文说明：测试局部值 { ctx }，由紧邻初始化决定。 */
    const { ctx } = await setup({ config: { timeoutMs: 5000 } })
    expect(ctx.tools.get('glob')?.timeoutMs).toBe(5000)
    expect(ctx.tools.get('grep')?.timeoutMs).toBe(5000)
  })

  it('defaults the timeout budget to 30 seconds', async () => {
    /** 中文说明：测试局部值 { ctx }，由紧邻初始化决定。 */
    const { ctx } = await setup()
    expect(ctx.tools.get('glob')?.timeoutMs).toBe(30_000)
    expect(ctx.tools.get('grep')?.timeoutMs).toBe(30_000)
  })

  it('describes the modification-time head when over-cap sampling is disabled', async () => {
    /** 中文说明：测试局部值 { ctx }，由紧邻初始化决定。 */
    const { ctx } = await setup({ config: { sampleOverCapGlobResults: false } })
    /** 中文说明：测试局部值 prompt，由紧邻初始化决定。 */
    const prompt = renderPrompt(await ctx.systemPrompt.assemble())
    expect(prompt).toContain('a larger one keeps the modification-time-ordered head')
    expect(prompt).not.toContain('sampled across top-level entries')
    /** 中文说明：测试局部值 glob，由紧邻初始化决定。 */
    const glob = ctx.tools.schemas().find(schema => schema.name === 'glob')
    expect(glob?.description).toContain('a larger result returns the first 100 paths in modification-time order')
    expect(glob?.description).not.toContain('sampled across top-level entries')
  })
})

describe('config validation', () => {
  it('requires an explicit over-cap glob sampling choice', () => {
    expect(() => new ToolFsSearch.Config()).toThrow(/sampleOverCapGlobResults/)
    expect(new ToolFsSearch.Config({ sampleOverCapGlobResults: false })).toMatchObject({
      sampleOverCapGlobResults: false,
      globMaxResults: 100,
    })
  })

  it.each([
    ['globMaxResults', { globMaxResults: 0 }],
    ['grepMaxMatches', { grepMaxMatches: -1 }],
    ['grepMaxLineBytes', { grepMaxLineBytes: 1.5 }],
    ['rawOutputMaxBytes', { rawOutputMaxBytes: 0 }],
    ['graceMs', { graceMs: 0 }],
    ['stderrMaxBytes', { stderrMaxBytes: -1 }],
    ['timeoutMs', { timeoutMs: -100 }],
  ] as const)('rejects a non-positive or fractional %s at load', async (name, config) => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(FakeSubprocess)
    await expect(ctx.plugin(ToolFsSearch, { ...DEFAULT_CONFIG, ...config })).rejects.toThrow(new RegExp(`tool-fs-search: ${name} must be a positive integer`))
  })

  it('rejects a grace beyond the Node timer range at load', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(FakeSubprocess)
    await expect(ctx.plugin(ToolFsSearch, {
      ...DEFAULT_CONFIG,
      graceMs: MAX_TIMER_DELAY_MS + 1,
    })).rejects.toThrow(`tool-fs-search: graceMs must be no greater than ${MAX_TIMER_DELAY_MS}`)
  })
})

describe('command construction (plain argv)', () => {
  it('glob: fixed rg --files argv with the pattern and paired VCS excludes', () => {
    expect(buildGlobCommand({ pattern: '**/*.ts' })).toEqual([
      '--files',
      '--glob=**/*.ts',
      '--sort=modified',
      '--no-ignore',
      '--hidden',
      '--glob=!**/.git', '--glob=!**/.git/**',
      '--glob=!**/.svn', '--glob=!**/.svn/**',
      '--glob=!**/.hg', '--glob=!**/.hg/**',
      '--glob=!**/.bzr', '--glob=!**/.bzr/**',
      '--glob=!**/.jj', '--glob=!**/.jj/**',
      '--glob=!**/.sl', '--glob=!**/.sl/**',
    ])
  })

  it('glob: the search root rides behind -- as a plain element', () => {
    expect(buildGlobCommand({ pattern: '*.md', path: 'docs dir' })).toEqual(['--files', '--glob=*.md', '--sort=modified', '--no-ignore', '--hidden',
      '--glob=!**/.git', '--glob=!**/.git/**',
      '--glob=!**/.svn', '--glob=!**/.svn/**',
      '--glob=!**/.hg', '--glob=!**/.hg/**',
      '--glob=!**/.bzr', '--glob=!**/.bzr/**',
      '--glob=!**/.jj', '--glob=!**/.jj/**',
      '--glob=!**/.sl', '--glob=!**/.sl/**',
      '--', 'docs dir'])
  })

  it('grep: fixed rg --json argv with the pattern in --regexp= form', () => {
    expect(buildGrepCommand({ pattern: 'foo.*bar' })).toEqual(['--json', '--regexp=foo.*bar'])
  })

  it('grep: include in --glob= form, path behind --, both plain elements', () => {
    expect(buildGrepCommand({ pattern: 'x', path: '-leading-dash', include: '*.{ts,tsx}' }))
      .toEqual(['--json', '--regexp=x', '--glob=*.{ts,tsx}', '--', '-leading-dash'])
  })

  it.each([
    ['a command-substitution pattern', '$(rm -rf /)'],
    ['a backtick pattern', '`touch pwned`'],
    ['a pattern with double quotes and spaces', 'say "hi there"'],
    ['a pattern with single quotes', "it's"],
    ['a pattern with newlines', 'a\nb'],
    ['a leading-dash pattern', '--flag'],
    ['glob metacharacters', '*?[a-z]{x,y}'],
  ])('keeps %s as ONE inert argv element (no shell layer to escape)', (_label, raw) => {
    // The argv vector is handed to rg verbatim: hostile text cannot break out
    // of its argument because there is no shell between the vector and rg.
    expect(buildGrepCommand({ pattern: raw })).toEqual(['--json', `--regexp=${raw}`])
    expect(buildGlobCommand({ pattern: raw })[1]).toBe(`--glob=${raw}`)
  })
})

describe('workdir derivation and signal forwarding', () => {
  it('forwards the session cwd as the spawn cwd', async () => {
    /** 中文说明：测试局部值 { ctx, subprocess }，由紧邻初始化决定。 */
    const { ctx, subprocess } = await setup()
    subprocess.handler = () => runResult('a.ts\n')
    await call(ctx, 'glob', { pattern: '*' }, { agent: agent('/sessions/s1') })
    expect(subprocess.spawns[0]?.cwd).toBe('/sessions/s1')
  })

  it('defaults the spawn cwd to process.cwd() without a session cwd', async () => {
    /** 中文说明：测试局部值 { ctx, subprocess }，由紧邻初始化决定。 */
    const { ctx, subprocess } = await setup()
    subprocess.handler = () => runResult('a.ts\n')
    await call(ctx, 'glob', { pattern: '*' }, { agent: agent() })
    expect(subprocess.spawns[0]?.cwd).toBe(process.cwd())
    // A non-agent caller takes the same default.
    await call(ctx, 'grep', { pattern: 'x' })
    expect(subprocess.spawns[1]?.cwd).toBe(process.cwd())
  })

  it('spawns the packaged ripgrep binary with --no-config, the fixed argv, and budgeted collect streams', async () => {
    /** 中文说明：测试局部值 { ctx, subprocess }，由紧邻初始化决定。 */
    const { ctx, subprocess } = await setup({
      config: { rawOutputMaxBytes: 1234, graceMs: 5000, stderrMaxBytes: 4096 },
    })
    subprocess.handler = () => runResult('', { exitCode: 1 })
    await call(ctx, 'grep', { pattern: 'needle' })
    /** 中文说明：测试局部值 spec，由紧邻初始化决定。 */
    const spec = subprocess.spawns[0]
    // --no-config keeps a host RIPGREP_CONFIG_PATH from injecting a
    // preprocessor into this unconfined spawn.
    expect(spec?.argv).toEqual([rgPath, '--no-config', '--json', '--regexp=needle'])
    expect(spec?.stdio.stdin).toBe('ignore')
    // stdout gets the tool's parse budget; stderr is a diagnostic excerpt;
    // both are the seam's diagnostic-tail shape (no spill files requested).
    expect((spec?.stdio.stdout as { maxBytes: number }).maxBytes).toBe(1234)
    expect((spec?.stdio.stderr as { maxBytes: number }).maxBytes).toBe(4096)
    expect(spec?.graceMs).toBe(5_000)
  })

  it('defaults the stderr tail budget and grace period when the config omits them', async () => {
    /** 中文说明：测试局部值 { ctx, subprocess }，由紧邻初始化决定。 */
    const { ctx, subprocess } = await setup()
    subprocess.handler = () => runResult('', { exitCode: 1 })
    await call(ctx, 'grep', { pattern: 'needle' })
    /** 中文说明：测试局部值 spec，由紧邻初始化决定。 */
    const spec = subprocess.spawns[0]
    expect((spec?.stdio.stderr as { maxBytes: number }).maxBytes).toBe(64 * 1024)
    expect(spec?.graceMs).toBe(3_000)
  })

  it('forwards exec.signal into the spawn spec', async () => {
    /** 中文说明：测试局部值 { ctx, subprocess }，由紧邻初始化决定。 */
    const { ctx, subprocess } = await setup()
    /** 中文说明：测试局部值 controller，由紧邻初始化决定。 */
    const controller = new AbortController()
    subprocess.handler = () => runResult('')
    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await call(ctx, 'grep', { pattern: 'x' }, { signal: controller.signal })
    expect(subprocess.spawns[0]?.signal).toBe(controller.signal)
    expect(result.isError).toBe(false)
  })

  it('reports an abort fired during the run as SEARCH_ABORTED', async () => {
    // The cooperative tool timeout or caller cancellation aborts exec.signal;
    // the subprocess seam then kills the process tree. The tool classifies
    // the first cause it owns: the abort.
    /** 中文说明：测试局部值 { ctx, subprocess }，由紧邻初始化决定。 */
    const { ctx, subprocess } = await setup()
    /** 中文说明：测试局部值 controller，由紧邻初始化决定。 */
    const controller = new AbortController()
    subprocess.handler = () => {
      controller.abort('timeout')
      return runResult('', { exitCode: null, signal: 'SIGTERM' })
    }
    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await call(ctx, 'glob', { pattern: '*' }, { signal: controller.signal })
    expect(result.isError).toBe(true)
    expect(result.error).toMatchObject({ info: { code: 'SEARCH_ABORTED' } })
    expect(text(result)).toContain('aborted before completion')
    expect(subprocess.handles[0]?.terminated).toBe(true)
  })

  it('skips a pre-aborted registry call before spawn()', async () => {
    /** 中文说明：测试局部值 { ctx, subprocess }，由紧邻初始化决定。 */
    const { ctx, subprocess } = await setup()
    /** 中文说明：测试局部值 controller，由紧邻初始化决定。 */
    const controller = new AbortController()
    controller.abort()
    subprocess.handler = () => { throw new Error('aborted before spawn') }
    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await call(ctx, 'grep', { pattern: 'x' }, { signal: controller.signal })
    expect(result.isError).toBe(true)
    expect(result.error).toMatchObject({ info: { name: 'AbortError', code: TOOL_ABORTED_BEFORE_DISPATCH } })
    expect(subprocess.spawns).toHaveLength(0)
  })

  it('fails a pre-aborted exec.signal before spawn with SEARCH_ABORTED', async () => {
    // Direct unit check of runRipgrep's own pre-spawn guard: the registry
    // intercepts most pre-aborted calls, but a signal that aborts between the
    // registry check and execute reaches this branch.
    /** 中文说明：测试局部值 { ctx }，由紧邻初始化决定。 */
    const { ctx } = await setup()
    /** 中文说明：测试局部值 controller，由紧邻初始化决定。 */
    const controller = new AbortController()
    controller.abort()
    /** 中文说明：测试局部值 exec，由紧邻初始化决定。 */
    const exec = { signal: controller.signal, name: 'glob', callId: CallId('direct-pre-abort') } as unknown as ToolExecution
    await expect(runRipgrep(ctx, exec, 'glob', ['--files'], 1_000_000, 3_000, 64 * 1024)).rejects
      .toMatchObject({ name: 'SearchError', code: 'SEARCH_ABORTED' })
  })

  it('translates a spawn rejection into SEARCH_FAILED even when the signal aborts concurrently', async () => {
    // The seam rejects only for infrastructure failures (unusable workdir,
    // missing binary); the abort happened after dispatch, so the launch
    // failure is the reportable cause with the original error chained.
    /** 中文说明：测试局部值 { ctx, subprocess }，由紧邻初始化决定。 */
    const { ctx, subprocess } = await setup()
    /** 中文说明：测试局部值 controller，由紧邻初始化决定。 */
    const controller = new AbortController()
    subprocess.handler = () => {
      controller.abort('cancel search')
      return { reject: new Error('spawn ENOENT') }
    }

    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await call(ctx, 'grep', { pattern: 'x' }, { signal: controller.signal })

    expect(result.isError).toBe(true)
    expect(result.error).toMatchObject({ info: { name: 'SearchError', code: 'SEARCH_FAILED' } })
    expect(text(result)).toContain('could not start')
  })

  it('classifies a synchronous spawn-creation throw as SEARCH_FAILED', async () => {
    // Node's spawn() throws synchronously for a NUL in argv, and the local
    // impl can throw synchronously for other invalid specs. Creation-time
    // failures must join the error vocabulary instead of escaping raw.
    /** 中文说明：测试局部值 { ctx, subprocess }，由紧邻初始化决定。 */
    const { ctx, subprocess } = await setup()
    subprocess.handler = () => { throw new Error('spawn ERR_INVALID_ARG_VALUE') }

    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await call(ctx, 'grep', { pattern: 'x' })

    expect(result.isError).toBe(true)
    expect(result.error).toMatchObject({ info: { name: 'SearchError', code: 'SEARCH_FAILED' } })
    expect(text(result)).toContain('could not start')
  })

  it('classifies a synchronous spawn-creation throw after an abort as SEARCH_ABORTED', async () => {
    // The local impl can throw synchronously when the signal aborts between
    // the pre-spawn check and the spawn call; no process was launched, so the
    // abort is the reportable cause.
    /** 中文说明：测试局部值 { ctx, subprocess }，由紧邻初始化决定。 */
    const { ctx, subprocess } = await setup()
    /** 中文说明：测试局部值 controller，由紧邻初始化决定。 */
    const controller = new AbortController()
    subprocess.handler = () => {
      controller.abort('timeout')
      throw new Error('aborted during spawn')
    }

    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await call(ctx, 'glob', { pattern: '*' }, { signal: controller.signal })

    expect(result.isError).toBe(true)
    expect(result.error).toMatchObject({ info: { name: 'SearchError', code: 'SEARCH_ABORTED' } })
    expect(text(result)).toContain('aborted before completion')
  })

  it('resolves the packaged ripgrep path lazily, once per process', async () => {
    // The module must not touch @vscode/ripgrep at load (a missing platform
    // package would otherwise fail the whole composition), and repeated
    // resolution reuses the first result. The resolution-failure path is
    // pinned separately in rg-path.spec.ts.
    await setup()
    expect(await resolveRgPath()).toBe(rgPath)
    expect(resolveRgPath()).toBe(resolveRgPath())
  })

  it('rejects when the subprocess implementation drops a requested collect stream', async () => {
    /** 中文说明：测试局部值 { ctx, subprocess }，由紧邻初始化决定。 */
    const { ctx, subprocess } = await setup()
    subprocess.dropReaders = true
    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await call(ctx, 'glob', { pattern: '*' })
    expect(result.isError).toBe(true)
    expect(result.error).toMatchObject({ info: { name: 'SearchError', code: 'SEARCH_FAILED' } })
    expect(text(result)).toContain('no collected output streams')
  })
})

describe('exit semantics and failure classification', () => {
  it('exit 1 is a successful empty search', async () => {
    /** 中文说明：测试局部值 { ctx, subprocess }，由紧邻初始化决定。 */
    const { ctx, subprocess } = await setup()
    subprocess.handler = () => runResult('', { exitCode: 1 })
    /** 中文说明：测试局部值 glob，由紧邻初始化决定。 */
    const glob = await call(ctx, 'glob', { pattern: '*.nope' })
    expect(glob.isError).toBe(false)
    expect(text(glob)).toBe('No files found')
    /** 中文说明：测试局部值 grep，由紧邻初始化决定。 */
    const grep = await call(ctx, 'grep', { pattern: 'nope' })
    expect(grep.isError).toBe(false)
    expect(text(grep)).toBe('No matches found')
  })

  it('a regex parse error classifies as SEARCH_INVALID_PATTERN', async () => {
    /** 中文说明：测试局部值 { ctx, subprocess }，由紧邻初始化决定。 */
    const { ctx, subprocess } = await setup()
    subprocess.handler = () => runResult('', { exitCode: 2, stderr: { text: 'rg: regex parse error:\n    (\nerror: unclosed group' } })
    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await call(ctx, 'grep', { pattern: '(' })
    expect(result.error).toMatchObject({ info: { code: 'SEARCH_INVALID_PATTERN' } })
    expect(text(result)).toContain('regex parse error')
  })

  it('a glob parse error classifies as SEARCH_INVALID_PATTERN', async () => {
    /** 中文说明：测试局部值 { ctx, subprocess }，由紧邻初始化决定。 */
    const { ctx, subprocess } = await setup()
    subprocess.handler = () => runResult('', { exitCode: 2, stderr: { text: 'rg: error parsing glob \'[\': unclosed character class' } })
    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await call(ctx, 'glob', { pattern: '[' })
    expect(result.error).toMatchObject({ info: { code: 'SEARCH_INVALID_PATTERN' } })
  })

  it('other nonzero exits are SEARCH_FAILED carrying the stderr excerpt', async () => {
    /** 中文说明：测试局部值 { ctx, subprocess }，由紧邻初始化决定。 */
    const { ctx, subprocess } = await setup()
    subprocess.handler = () => runResult('', { exitCode: 2, stderr: { text: 'rg: missing.dir: IO error: no such file or directory' } })
    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await call(ctx, 'grep', { pattern: 'x', path: 'missing.dir' })
    expect(result.error).toMatchObject({ info: { code: 'SEARCH_FAILED' } })
    expect(text(result)).toContain('IO error')
  })

  it('a nonzero exit with EMPTY stderr still reports the exit code', async () => {
    /** 中文说明：测试局部值 { ctx, subprocess }，由紧邻初始化决定。 */
    const { ctx, subprocess } = await setup()
    subprocess.handler = () => runResult('', { exitCode: 3 })
    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await call(ctx, 'glob', { pattern: '*' })
    expect(result.error).toMatchObject({ info: { code: 'SEARCH_FAILED' } })
    expect(text(result)).toContain('exit 3')
  })

  it('truncated stderr gains a truncation note and stderr.spillPath is never read', async () => {
    /** 中文说明：测试局部值 { ctx, subprocess }，由紧邻初始化决定。 */
    const { ctx, subprocess } = await setup()
    subprocess.handler = () => runResult('', {
      exitCode: 2,
      stderr: { text: 'tail of diagnostics', lossy: true, spillPath: '/does/not/exist-and-never-read' },
    })
    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await call(ctx, 'grep', { pattern: 'x' })
    expect(text(result)).toContain('tail of diagnostics [stderr truncated]')
  })

  it('a signal kill (not timeout, not abort) is SEARCH_FAILED', async () => {
    /** 中文说明：测试局部值 { ctx, subprocess }，由紧邻初始化决定。 */
    const { ctx, subprocess } = await setup()
    subprocess.handler = () => runResult('', { exitCode: null, signal: 'SIGKILL' })
    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await call(ctx, 'grep', { pattern: 'x' })
    expect(result.error).toMatchObject({ info: { code: 'SEARCH_FAILED' } })
    expect(text(result)).toContain('SIGKILL')
  })

  it('a null exit with no signal (defensive) is SEARCH_FAILED', async () => {
    /** 中文说明：测试局部值 { ctx, subprocess }，由紧邻初始化决定。 */
    const { ctx, subprocess } = await setup()
    subprocess.handler = () => runResult('', { exitCode: null, signal: null })
    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await call(ctx, 'glob', { pattern: '*' })
    expect(result.error).toMatchObject({ info: { code: 'SEARCH_FAILED' } })
    expect(text(result)).toContain('killed by signal (unknown)')
  })
})

describe('raw output acquisition', () => {
  it('fails with SEARCH_RAW_OUTPUT_OVERFLOW when truncated stdout has a raw spill path', async () => {
    /** 中文说明：测试局部值 { ctx, subprocess }，由紧邻初始化决定。 */
    const { ctx, subprocess } = await setup({ config: { rawOutputMaxBytes: 16 } })
    subprocess.handler = () => runResult('', { stdout: { text: 'x', lossy: true, spillPath: '/does/not/get-read' } })
    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await call(ctx, 'glob', { pattern: '*' })
    expect(result.error).toMatchObject({ info: { code: 'SEARCH_RAW_OUTPUT_OVERFLOW' } })
    expect(text(result)).toContain('narrow pattern, path, or include')
  })

  it('fails with SEARCH_RAW_OUTPUT_OVERFLOW when UNTRUNCATED inline stdout exceeds the cap', async () => {
    // A subprocess implementation retaining more inline than this package's
    // cap (or a deployment lowering rawOutputMaxBytes below the retention
    // budget) must not smuggle an over-cap parse through the untruncated path.
    /** 中文说明：测试局部值 { ctx, subprocess }，由紧邻初始化决定。 */
    const { ctx, subprocess } = await setup({ config: { rawOutputMaxBytes: 16 } })
    subprocess.handler = () => runResult(`${'x'.repeat(64)}\n`)
    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await call(ctx, 'grep', { pattern: 'x' })
    expect(result.error).toMatchObject({ info: { name: 'SearchError', code: 'SEARCH_RAW_OUTPUT_OVERFLOW' } })
    expect(text(result)).toContain('narrow pattern, path, or include')
  })

  it('fails with SEARCH_RAW_OUTPUT_OVERFLOW when truncated stdout has no spill path', async () => {
    /** 中文说明：测试局部值 { ctx, subprocess }，由紧邻初始化决定。 */
    const { ctx, subprocess } = await setup()
    subprocess.handler = () => runResult('', { stdout: { text: 'partial', lossy: true } })
    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await call(ctx, 'grep', { pattern: 'x' })
    expect(result.error).toMatchObject({ info: { code: 'SEARCH_RAW_OUTPUT_OVERFLOW' } })
  })
})

describe('cross-directory sampling', () => {
  it('gives every top-level entry a slot before any entry gets a second', () => {
    /** 中文说明：测试局部值 paths，由紧邻初始化决定。 */
    const paths = ['v/a', 'v/b', 'v/c', 'v/d', 'src/e', 'guide/f'].map(w)
    // The head of 3 would be all `v/`; the sample reaches all three entries.
    expect(sampleAcrossTopLevel(paths, 3)).toEqual({ items: ['v/a', 'src/e', 'guide/f'].map(w), shown: 3, total: 3 })
    // Extra slots go round again — to the only entry with paths left — and the
    // page stays grouped by entry rather than interleaved.
    expect(sampleAcrossTopLevel(paths, 5)).toEqual({ items: ['v/a', 'v/b', 'v/c', 'src/e', 'guide/f'].map(w), shown: 3, total: 3 })
  })

  it('hands an exhausted entry the remaining slots go to entries that still have paths', () => {
    /** 中文说明：测试局部值 paths，由紧邻初始化决定。 */
    const paths = ['solo/a', 'many/b', 'many/c', 'many/d'].map(w)
    expect(sampleAcrossTopLevel(paths, 3)).toEqual({ items: ['solo/a', 'many/b', 'many/c'].map(w), shown: 2, total: 2 })
  })

  it('does not rescan exhausted entries while filling a skewed page', () => {
    /** 中文说明：测试局部值 singletonCount，由紧邻初始化决定。 */
    const singletonCount = 12_500
    /** 中文说明：测试局部值 paths，由紧邻初始化决定。 */
    const paths = [
      ...Array.from({ length: singletonCount }, (_, index) => `group-${index}${sep}only`),
      ...Array.from({ length: singletonCount }, (_, index) => `late${sep}${index}`),
    ]
    expect(sampleAcrossTopLevel(paths, paths.length - 1)).toMatchObject({
      shown: singletonCount + 1,
      total: singletonCount + 1,
      items: { length: paths.length - 1 },
    })
  }, 500)

  it('reports the entries it could not reach when the page is smaller than the top level', () => {
    /** 中文说明：测试局部值 paths，由紧邻初始化决定。 */
    const paths = ['a/1', 'b/1', 'c/1', 'd/1'].map(w)
    expect(sampleAcrossTopLevel(paths, 2)).toEqual({ items: ['a/1', 'b/1'].map(w), shown: 2, total: 4 })
  })

  it('groups an absolute path by its first real name, not by its empty root segment', () => {
    // Paths outside the workdir stay absolute; without stripping the leading
    // separator every one of them would collapse into a single empty group.
    expect(sampleAcrossTopLevel(['/out/a', '/out/b', '/away/c', '/away/d'].map(w), 2))
      .toEqual({ items: ['/out/a', '/away/c'].map(w), shown: 2, total: 2 })
  })

  it('reproduces the modification-time-ordered head for a flat result', () => {
    expect(sampleAcrossTopLevel(['a.ts', 'b.ts', 'c.ts'], 2)).toEqual({ items: ['a.ts', 'b.ts'], shown: 2, total: 3 })
  })

  it('groups paths relative to an explicit search root', () => {
    expect(sampleAcrossTopLevel([
      'workspace/vendor/a.ts',
      'workspace/vendor/b.ts',
      'workspace/source/c.ts',
      'workspace/guides/d.md',
    ].map(w), 3, 'workspace')).toEqual({
      items: ['workspace/vendor/a.ts', 'workspace/source/c.ts', 'workspace/guides/d.md'].map(w),
      shown: 3,
      total: 3,
    })
    expect(sampleAcrossTopLevel(['./vendor/a.ts', './src/b.ts'].map(w), 2, '.'))
      .toEqual({ items: ['./vendor/a.ts', './src/b.ts'].map(w), shown: 2, total: 2 })
    expect(sampleAcrossTopLevel(['/vendor/a.ts', '/src/b.ts'].map(w), 2, w('/')))
      .toEqual({ items: ['/vendor/a.ts', '/src/b.ts'].map(w), shown: 2, total: 2 })
    /** 中文说明：测试局部值 rooted，由紧邻初始化决定。 */
    const rooted = [
      ['root', 'a', 'one'].join(sep),
      ['root', 'a', 'two'].join(sep),
      ['root', 'b', 'three'].join(sep),
    ]
    expect(sampleAcrossTopLevel(rooted, 2, 'root'))
      .toEqual({ items: [rooted[0], rooted[2]], shown: 2, total: 2 })
    expect(sampleAcrossTopLevel(['other/a.ts'].map(w), 1, 'src'))
      .toEqual({ items: ['other/a.ts'].map(w), shown: 1, total: 1 })
    expect(sampleAcrossTopLevel(['src'], 1, 'src'))
      .toEqual({ items: ['src'], shown: 1, total: 1 })
  })

  it.skipIf(process.platform === 'win32')('treats POSIX backslashes as filename characters', () => {
    /** 中文说明：测试局部值 paths，由紧邻初始化决定。 */
    const paths = ['old\\one', 'old\\two', 'src/a']
    expect(sampleAcrossTopLevel(paths, 2)).toEqual({
      items: ['old\\one', 'old\\two'],
      shown: 2,
      total: 3,
    })
  })

  it('handles more top-level groups than the JavaScript argument limit', () => {
    /** 中文说明：测试局部值 paths，由紧邻初始化决定。 */
    const paths = Array.from({ length: 125_000 }, (_, index) => `dir-${index}/file.txt`)
    expect(sampleAcrossTopLevel(paths, 100)).toMatchObject({ shown: 100, total: 125_000 })
  })
})

describe('glob results', () => {
  it('lists workdir-relative paths (absolute output under the workdir is relativized)', async () => {
    /** 中文说明：测试局部值 { ctx, subprocess }，由紧邻初始化决定。 */
    const { ctx, subprocess } = await setup()
    subprocess.handler = () => runResult('/sessions/s1/src/a.ts\n/elsewhere/b.ts\nrel/c.ts\n')
    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await call(ctx, 'glob', { pattern: '*' }, { agent: agent('/sessions/s1') })
    if (result.isError) throw new Error('expected glob success')
    expect(result.value).toEqual({ root: '.', paths: [join('src', 'a.ts'), '/elsewhere/b.ts', 'rel/c.ts'] })
    expect(text(result)).toBe(`${join('src', 'a.ts')}\n/elsewhere/b.ts\nrel/c.ts`)
  })

  it('validates arguments (blank pattern, blank path)', async () => {
    /** 中文说明：测试局部值 { ctx }，由紧邻初始化决定。 */
    const { ctx } = await setup()
    expect(text(await call(ctx, 'glob', { pattern: '  ' }))).toContain('pattern must be a non-empty string')
    expect(text(await call(ctx, 'glob', { pattern: '*', path: ' ' }))).toContain('path must be a non-empty string')
  })

  it('threads a valid path through to the spawn as the plain search root element', async () => {
    /** 中文说明：测试局部值 { ctx, subprocess }，由紧邻初始化决定。 */
    const { ctx, subprocess } = await setup()
    subprocess.handler = () => runResult('sub/a.ts\n')
    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await call(ctx, 'glob', { pattern: '*.ts', path: 'sub' })
    expect(result.isError).toBe(false)
    expect(subprocess.spawns[0]?.argv).toEqual([rgPath, '--no-config', '--files', '--glob=*.ts', '--sort=modified', '--no-ignore', '--hidden',
      '--glob=!**/.git', '--glob=!**/.git/**',
      '--glob=!**/.svn', '--glob=!**/.svn/**',
      '--glob=!**/.hg', '--glob=!**/.hg/**',
      '--glob=!**/.bzr', '--glob=!**/.bzr/**',
      '--glob=!**/.jj', '--glob=!**/.jj/**',
      '--glob=!**/.sl', '--glob=!**/.sl/**',
      '--', 'sub'])
  })

  it('caps at globMaxResults and saves the FULL sorted list through spillStore', async () => {
    /** 中文说明：测试局部值 解构结果，由紧邻初始化决定。 */
    const { ctx, subprocess, spill } = await setup({ config: { globMaxResults: 2 }, spill: true })
    ctx.on('tools/post-execute', async () => ({
      kind: 'accept',
      additionalContexts: [createUserMessage({
        content: [{ type: 'text', text: 'glob context' }], source: { kind: 'plugin', plugin: 'test' },
      })],
    }))
    subprocess.handler = () => runResult('a.ts\nb.ts\nc.ts\nd.ts\n')
    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await call(ctx, 'glob', { pattern: '*.ts' }, { agent: agent('/w') })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected glob success')
    expect(result.value).toEqual({ root: '.', paths: ['a.ts', 'b.ts', 'c.ts', 'd.ts'] })
    expect(text(result)).toBe('a.ts\nb.ts\n\n(Showing 2 of 4 paths. Full sorted result stored at: /spill/glob-results.txt. Use the fake retrieval hint.)')
    expect(spill?.saves).toHaveLength(1)
    expect(spill?.saves[0]).toMatchObject({
      owner: { sessionId: 'session-1' },
      source: { toolName: 'glob', label: 'result' },
      suggestedName: 'glob-results.txt',
      content: 'a.ts\nb.ts\nc.ts\nd.ts',
    })
    expect(spill?.saves[0]?.source.callId).toBeDefined()
    expect(result.additionalContexts?.[0]?.content).toEqual([{ type: 'text', text: 'glob context' }])
  })

  it('samples an over-cap result across top-level entries instead of taking its head', async () => {
    // The shipped failure: `*` matches the whole tree, mtime order puts one
    // freshly-unpacked subtree first, and a head-of-3 reads like the entire
    // workspace. The sample reaches every top-level entry instead.
    /** 中文说明：测试局部值 { ctx, subprocess }，由紧邻初始化决定。 */
    const { ctx, subprocess } = await setup({ config: { globMaxResults: 3 } })
    subprocess.handler = () => runResult(['vendor/a.ts', 'vendor/b.ts', 'vendor/c.ts', 'src/d.ts', 'guide/e.md', 'top.txt'].map(w).join('\n'))
    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await call(ctx, 'glob', { pattern: '*' }, { agent: agent('/w') })
    expect(text(result)).toBe(['vendor/a.ts', 'src/d.ts', 'guide/e.md'].map(w).join('\n') + '\n\n'
      + '(Showing 3 of 6 paths, sampled across 3 of the 4 top-level entries this pattern matched '
      + 'instead of taken in modification-time order. Narrow path to inspect a specific subtree. '
      + 'The complete result could not be saved; narrow pattern or path to see more.)')
  })

  it('keeps the modification-time head when over-cap sampling is disabled', async () => {
    /** 中文说明：测试局部值 { ctx, subprocess }，由紧邻初始化决定。 */
    const { ctx, subprocess } = await setup({
      config: { globMaxResults: 3, sampleOverCapGlobResults: false },
    })
    subprocess.handler = () => runResult(['vendor/a.ts', 'vendor/b.ts', 'vendor/c.ts', 'src/d.ts', 'guide/e.md'].join('\n'))
    expect(text(await call(ctx, 'glob', { pattern: '*' }, { agent: agent('/w') })))
      .toBe('vendor/a.ts\nvendor/b.ts\nvendor/c.ts\n\n'
        + '(Showing 3 of 5 paths. The complete result could not be saved; narrow pattern or path to see more.)')
  })

  it('samples relative to the explicit search root instead of its workdir prefix', async () => {
    /** 中文说明：测试局部值 { ctx, subprocess }，由紧邻初始化决定。 */
    const { ctx, subprocess } = await setup({ config: { globMaxResults: 3 } })
    subprocess.handler = () => runResult([
      'workspace/vendor/a.ts',
      'workspace/vendor/b.ts',
      'workspace/source/c.ts',
      'workspace/guides/d.md',
    ].map(w).join('\n'))
    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await call(ctx, 'glob', { pattern: '*', path: w('workspace') }, { agent: agent('/w') })
    expect(text(result)).toContain(['workspace/vendor/a.ts', 'workspace/source/c.ts', 'workspace/guides/d.md'].map(w).join('\n'))
    expect(text(result)).toContain('sampled across 3 of the 3 top-level entries')
  })

  it('samples relative to an absolute search root after workdir display conversion', async () => {
    /** 中文说明：测试局部值 { ctx, subprocess }，由紧邻初始化决定。 */
    const { ctx, subprocess } = await setup({ config: { globMaxResults: 3 } })
    subprocess.handler = () => runResult([
      '/w/workspace/vendor/a.ts',
      '/w/workspace/vendor/b.ts',
      '/w/workspace/source/c.ts',
      '/w/workspace/guides/d.md',
    ].map(w).join('\n'))
    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await call(ctx, 'glob', { pattern: '*', path: w('/w/workspace') }, { agent: agent(w('/w')) })
    expect(text(result)).toContain(['workspace/vendor/a.ts', 'workspace/source/c.ts', 'workspace/guides/d.md'].map(w).join('\n'))
    expect(text(result)).toContain('sampled across 3 of the 3 top-level entries')
  })

  it('drops the narrowing hint when the sample reaches every top-level entry', async () => {
    /** 中文说明：测试局部值 { ctx, subprocess }，由紧邻初始化决定。 */
    const { ctx, subprocess } = await setup({ config: { globMaxResults: 3 } })
    subprocess.handler = () => runResult(['vendor/a.ts', 'vendor/b.ts', 'vendor/c.ts', 'src/d.ts'].map(w).join('\n'))
    expect(text(await call(ctx, 'glob', { pattern: '*' }, { agent: agent('/w') })))
      .toBe(['vendor/a.ts', 'vendor/b.ts', 'src/d.ts'].map(w).join('\n') + '\n\n'
        + '(Showing 3 of 4 paths, sampled across 2 of the 2 top-level entries this pattern matched '
        + 'instead of taken in modification-time order. '
        + 'The complete result could not be saved; narrow pattern or path to see more.)')
  })

  it('keeps modification-time order untouched when the whole result fits', async () => {
    /** 中文说明：测试局部值 { ctx, subprocess }，由紧邻初始化决定。 */
    const { ctx, subprocess } = await setup({ config: { globMaxResults: 4 } })
    subprocess.handler = () => runResult('vendor/a.ts\nvendor/b.ts\nsrc/c.ts\n')
    expect(text(await call(ctx, 'glob', { pattern: '*' }, { agent: agent('/w') })))
      .toBe('vendor/a.ts\nvendor/b.ts\nsrc/c.ts')
  })

  it('keeps the plain footer for a flat result, where the sample is the modification-time head', async () => {
    /** 中文说明：测试局部值 { ctx, subprocess }，由紧邻初始化决定。 */
    const { ctx, subprocess } = await setup({ config: { globMaxResults: 2 } })
    subprocess.handler = () => runResult('a.ts\nb.ts\nc.ts\n')
    expect(text(await call(ctx, 'glob', { pattern: '*' }, { agent: agent('/w') })))
      .toBe('a.ts\nb.ts\n\n(Showing 2 of 3 paths. The complete result could not be saved; narrow pattern or path to see more.)')
  })

  it('does not create a spill file when the result fits inline', async () => {
    /** 中文说明：测试局部值 解构结果，由紧邻初始化决定。 */
    const { ctx, subprocess, spill } = await setup({ spill: true })
    subprocess.handler = () => runResult('a.ts\nb.ts\n')
    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await call(ctx, 'glob', { pattern: '*' }, { agent: agent('/w') })
    expect(text(result)).toBe('a.ts\nb.ts')
    expect(spill?.saves).toHaveLength(0)
  })

  it('preserves a downstream canonical value replacement instead of spilling the old value', async () => {
    /** 中文说明：测试局部值 解构结果，由紧邻初始化决定。 */
    const { ctx, subprocess, spill } = await setup({ config: { globMaxResults: 1 }, spill: true })
    ctx.on('tools/post-execute', async () => ({
      kind: 'accept' as const,
      value: { root: '.', paths: ['replacement-a.ts', 'replacement-b.ts'] },
    }))
    subprocess.handler = () => runResult('old-a.ts\nold-b.ts\n')

    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await call(ctx, 'glob', { pattern: '*.ts' }, { agent: agent('/w') })

    if (result.isError) throw new Error('expected glob replacement success')
    expect(result.value).toEqual({ root: '.', paths: ['replacement-a.ts', 'replacement-b.ts'] })
    expect(text(result)).toContain('replacement-a.ts')
    expect(text(result)).not.toContain('old-a.ts')
    expect(spill?.saves).toHaveLength(0)
  })

  it('keeps the full nested Code value without creating a top-level spill', async () => {
    /** 中文说明：测试局部值 解构结果，由紧邻初始化决定。 */
    const { ctx, subprocess, spill } = await setup({ config: { globMaxResults: 2 }, spill: true })
    subprocess.handler = () => runResult('a.ts\nb.ts\nc.ts\nd.ts\n')
    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await call(ctx, 'glob', { pattern: '*.ts' }, {
      agent: agent('/w'),
      parent: Symbol('run_code') as ToolExecutionToken,
    })
    if (result.isError) throw new Error('expected glob success')
    expect(result.value).toEqual({ root: '.', paths: ['a.ts', 'b.ts', 'c.ts', 'd.ts'] })
    expect(text(result)).toBe('a.ts\nb.ts\n\n(Showing 2 of 4 paths. The complete result could not be saved; narrow pattern or path to see more.)')
    expect(spill?.saves).toHaveLength(0)
  })

  it.each([
    ['no spill backend loaded', { fail: false, spill: false, ownerless: false }],
    ['saveText fails', { fail: true, spill: true, ownerless: false }],
    ['no session owner', { fail: false, spill: true, ownerless: true }],
  ])('keeps the inline page and reports the unsaved remainder when %s', async (_label, mode) => {
    /** 中文说明：测试局部值 解构结果，由紧邻初始化决定。 */
    const { ctx, subprocess, spill } = await setup({ config: { globMaxResults: 1 }, spill: mode.spill })
    if (mode.fail && spill) spill.failWith = new Error('disk full')
    subprocess.handler = () => runResult('a.ts\nb.ts\n')
    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await call(ctx, 'glob', { pattern: '*' }, mode.ownerless ? {} : { agent: agent('/w') })
    expect(result.isError).toBe(false) // spill unavailability never fails the search
    expect(text(result)).toBe('a.ts\n\n(Showing 1 of 2 paths. The complete result could not be saved; narrow pattern or path to see more.)')
  })
})

describe('grep results', () => {
  it('groups matches by file with line numbers', async () => {
    /** 中文说明：测试局部值 { ctx, subprocess }，由紧邻初始化决定。 */
    const { ctx, subprocess } = await setup()
    subprocess.handler = () => runResult([
      JSON.stringify({ type: 'begin', data: { path: { text: 'a.ts' } } }),
      matchLine('a.ts', 3, 'const x = 1\n'),
      matchLine('a.ts', 9, 'const y = 2\n'),
      JSON.stringify({ type: 'end', data: { path: { text: 'a.ts' } } }),
      matchLine('b.ts', 1, 'const z = 3'),
      JSON.stringify({ type: 'summary', data: {} }),
      '',
    ].join('\n'))
    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await call(ctx, 'grep', { pattern: 'const' })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected grep success')
    expect(result.value).toEqual({
      matches: [
        { path: 'a.ts', lineNumber: 3, line: 'const x = 1' },
        { path: 'a.ts', lineNumber: 9, line: 'const y = 2' },
        { path: 'b.ts', lineNumber: 1, line: 'const z = 3' },
      ],
    })
    expect(text(result)).toBe('Found 3 matches\n\na.ts\nLine 3: const x = 1\nLine 9: const y = 2\n\nb.ts\nLine 1: const z = 3')
  })

  it('reports a single match in the singular', async () => {
    /** 中文说明：测试局部值 { ctx, subprocess }，由紧邻初始化决定。 */
    const { ctx, subprocess } = await setup()
    subprocess.handler = () => runResult(`${matchLine('a.ts', 1, 'hit')}\n`)
    expect(text(await call(ctx, 'grep', { pattern: 'hit' }))).toBe('Found 1 match\n\na.ts\nLine 1: hit')
  })

  it('relativizes absolute match paths against the resolved workdir', async () => {
    /** 中文说明：测试局部值 { ctx, subprocess }，由紧邻初始化决定。 */
    const { ctx, subprocess } = await setup()
    subprocess.handler = () => runResult(`${matchLine('/sessions/s1/deep/a.ts', 2, 'hit')}\n`)
    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await call(ctx, 'grep', { pattern: 'hit', path: '/sessions/s1' }, { agent: agent('/sessions/s1') })
    expect(text(result)).toContain(`${join('deep', 'a.ts')}\nLine 2: hit`)
  })

  it('previews a long matched line at grepMaxLineBytes preserving UTF-8', async () => {
    /** 中文说明：测试局部值 { ctx, subprocess }，由紧邻初始化决定。 */
    const { ctx, subprocess } = await setup({ config: { grepMaxLineBytes: 7 } })
    // 'héllo wörld' cut at 7 bytes lands mid-'é'? h(1)é(2)l(1)l(1)o(1)=6, space=7 → clean cut at 7.
    // Use a multibyte straddle instead: 'aé' repeated — cut at 7 bytes: a(1)é(2)a(1)é(2)=6 +a(1)=7 → next é straddles: trimmed.
    subprocess.handler = () => runResult(`${matchLine('a.txt', 1, 'aéaéaéaé')}\n`)
    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await call(ctx, 'grep', { pattern: 'a' })
    if (result.isError) throw new Error('expected grep success')
    expect(result.value).toEqual({ matches: [{ path: 'a.txt', lineNumber: 1, line: 'aéaéaéaé' }] })
    expect(text(result)).toContain('Line 1: aéaéa (line truncated)')
  })

  it('renders a non-UTF-8 line (rg bytes form) as a placeholder instead of failing', async () => {
    /** 中文说明：测试局部值 { ctx, subprocess }，由紧邻初始化决定。 */
    const { ctx, subprocess } = await setup()
    /** 中文说明：测试局部值 record，由紧邻初始化决定。 */
    const record = JSON.stringify({ type: 'match', data: { path: { text: 'bin.dat' }, lines: { bytes: 'AAECww==' }, line_number: 4 } })
    subprocess.handler = () => runResult(`${record}\n`)
    expect(text(await call(ctx, 'grep', { pattern: 'x' }))).toContain('Line 4: (line is not valid UTF-8)')
  })

  it('strips a CRLF terminator from the matched line text', () => {
    /** 中文说明：测试局部值 matches，由紧邻初始化决定。 */
    const matches = parseGrepMatches(`${matchLine('a.txt', 1, 'windows line\r\n')}\n`)
    expect(matches[0]?.line).toBe('windows line')
  })

  it('caps at grepMaxMatches and spills the full formatted match list', async () => {
    /** 中文说明：测试局部值 解构结果，由紧邻初始化决定。 */
    const { ctx, subprocess, spill } = await setup({ config: { grepMaxMatches: 2 }, spill: true })
    ctx.on('tools/post-execute', async () => ({
      kind: 'accept',
      additionalContexts: [createUserMessage({
        content: [{ type: 'text', text: 'grep context' }], source: { kind: 'plugin', plugin: 'test' },
      })],
    }))
    subprocess.handler = () => runResult([
      matchLine('a.ts', 1, 'one'),
      matchLine('a.ts', 2, 'two'),
      matchLine('b.ts', 3, 'three'),
      '',
    ].join('\n'))
    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await call(ctx, 'grep', { pattern: 'e' }, { agent: agent('/w') })
    if (result.isError) throw new Error('expected grep success')
    expect(result.value).toEqual({
      matches: [
        { path: 'a.ts', lineNumber: 1, line: 'one' },
        { path: 'a.ts', lineNumber: 2, line: 'two' },
        { path: 'b.ts', lineNumber: 3, line: 'three' },
      ],
    })
    expect(text(result)).toBe('Found 2 of 3 matches\n\na.ts\nLine 1: one\nLine 2: two\n\n(Full grep result stored at: /spill/grep-results.txt. Use the fake retrieval hint.)')
    expect(spill?.saves[0]).toMatchObject({
      source: { toolName: 'grep', label: 'result' },
      suggestedName: 'grep-results.txt',
      content: 'Found 3 matches\n\na.ts\nLine 1: one\nLine 2: two\n\nb.ts\nLine 3: three',
    })
    expect(result.additionalContexts?.[0]?.content).toEqual([{ type: 'text', text: 'grep context' }])
  })

  it('preserves a downstream canonical value replacement instead of spilling the old matches', async () => {
    /** 中文说明：测试局部值 解构结果，由紧邻初始化决定。 */
    const { ctx, subprocess, spill } = await setup({ config: { grepMaxMatches: 1 }, spill: true })
    ctx.on('tools/post-execute', async () => ({
      kind: 'accept' as const,
      value: {
        matches: [
          { path: 'replacement.ts', lineNumber: 7, line: 'first' },
          { path: 'replacement.ts', lineNumber: 8, line: 'second' },
        ],
      },
    }))
    subprocess.handler = () => runResult(`${matchLine('old.ts', 1, 'old')}\n`)

    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await call(ctx, 'grep', { pattern: 'old' }, { agent: agent('/w') })

    if (result.isError) throw new Error('expected grep replacement success')
    expect(result.value).toEqual({
      matches: [
        { path: 'replacement.ts', lineNumber: 7, line: 'first' },
        { path: 'replacement.ts', lineNumber: 8, line: 'second' },
      ],
    })
    expect(text(result)).toContain('replacement.ts')
    expect(text(result)).not.toContain('old.ts')
    expect(spill?.saves).toHaveLength(0)
  })

  it('keeps every nested Code match in the value without creating a top-level spill', async () => {
    /** 中文说明：测试局部值 解构结果，由紧邻初始化决定。 */
    const { ctx, subprocess, spill } = await setup({ config: { grepMaxMatches: 1 }, spill: true })
    subprocess.handler = () => runResult(`${matchLine('a.ts', 1, 'one')}\n${matchLine('b.ts', 2, 'two')}\n`)
    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await call(ctx, 'grep', { pattern: 'o' }, {
      agent: agent('/w'),
      parent: Symbol('run_code') as ToolExecutionToken,
    })
    if (result.isError) throw new Error('expected grep success')
    expect(result.value).toEqual({
      matches: [
        { path: 'a.ts', lineNumber: 1, line: 'one' },
        { path: 'b.ts', lineNumber: 2, line: 'two' },
      ],
    })
    expect(text(result)).toBe('Found 1 of 2 matches\n\na.ts\nLine 1: one\n\n(The complete result could not be saved; narrow pattern, path, or include to see more.)')
    expect(spill?.saves).toHaveLength(0)
  })

  it('reports the unsaved remainder when capped with no spill backend', async () => {
    /** 中文说明：测试局部值 { ctx, subprocess }，由紧邻初始化决定。 */
    const { ctx, subprocess } = await setup({ config: { grepMaxMatches: 1 } })
    subprocess.handler = () => runResult(`${matchLine('a.ts', 1, 'one')}\n${matchLine('a.ts', 2, 'two')}\n`)
    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await call(ctx, 'grep', { pattern: 'o' }, { agent: agent('/w') })
    expect(result.isError).toBe(false)
    expect(text(result)).toBe('Found 1 of 2 matches\n\na.ts\nLine 1: one\n\n(The complete result could not be saved; narrow pattern, path, or include to see more.)')
  })

  it('validates arguments (empty pattern, blank path, bad include)', async () => {
    /** 中文说明：测试局部值 { ctx }，由紧邻初始化决定。 */
    const { ctx } = await setup()
    expect(text(await call(ctx, 'grep', { pattern: '' }))).toContain('pattern must be a non-empty string')
    expect(text(await call(ctx, 'grep', { pattern: 'x', path: '  ' }))).toContain('path must be a non-empty string')
    expect(text(await call(ctx, 'grep', { pattern: 'x', include: '  ' }))).toContain('include must be a non-empty glob')
    expect(text(await call(ctx, 'grep', { pattern: 'x', include: '!*.ts' }))).toContain('negated patterns')
    expect(text(await call(ctx, 'grep', { pattern: 'x', include: '*.ts,*.js' }))).toContain('comma-separated list')
  })

  it('accepts a whitespace-only pattern (a legitimate regex) and brace alternation in include', async () => {
    /** 中文说明：测试局部值 { ctx, subprocess }，由紧邻初始化决定。 */
    const { ctx, subprocess } = await setup()
    subprocess.handler = () => runResult('', { exitCode: 1 })
    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await call(ctx, 'grep', { pattern: '  ', include: '*.{ts,tsx}' })
    expect(result.isError).toBe(false)
  })
})

describe('rg --json transport failures (SEARCH_FAILED)', () => {
  it.each([
    ['a non-JSON line', 'not json at all'],
    ['a non-object record', '42'],
    ['a match record with no data', JSON.stringify({ type: 'match' })],
    ['a match record with no path text', JSON.stringify({ type: 'match', data: { path: {}, lines: { text: 'x' }, line_number: 1 } })],
    ['a match record with a non-object path', JSON.stringify({ type: 'match', data: { path: 'a.ts', lines: { text: 'x' }, line_number: 1 } })],
    ['a match record with no line number', JSON.stringify({ type: 'match', data: { path: { text: 'a.ts' }, lines: { text: 'x' } } })],
    ['a match record with no line content', JSON.stringify({ type: 'match', data: { path: { text: 'a.ts' }, line_number: 1 } })],
    ['a match record with neither text nor bytes', JSON.stringify({ type: 'match', data: { path: { text: 'a.ts' }, lines: {}, line_number: 1 } })],
  ])('%s fails the search', async (_label, line) => {
    /** 中文说明：测试局部值 { ctx, subprocess }，由紧邻初始化决定。 */
    const { ctx, subprocess } = await setup()
    subprocess.handler = () => runResult(`${line}\n`)
    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await call(ctx, 'grep', { pattern: 'x' })
    expect(result.isError).toBe(true)
    expect(result.error).toMatchObject({ info: { name: 'SearchError', code: 'SEARCH_FAILED' } })
  })
})

describe('the no-background-job invariant', () => {
  it('settles every spawned search handle across successful and failed searches', async () => {
    /** 中文说明：测试局部值 { ctx, subprocess }，由紧邻初始化决定。 */
    const { ctx, subprocess } = await setup()
    subprocess.handler = () => runResult('a.ts\n')
    await call(ctx, 'glob', { pattern: '*' })
    subprocess.handler = () => runResult('', { exitCode: 2, stderr: { text: 'boom' } })
    await call(ctx, 'grep', { pattern: 'x' })
    // One foreground spawn per call, each awaited to settlement before the
    // tool returns — the searches never leave a background handle running.
    expect(subprocess.spawns).toHaveLength(2)
    expect(subprocess.handles.every(handle => handle.settled)).toBe(true)
  })
})

describe('presentation', () => {
  it('glob titles carry the pattern and optional root', () => {
    expect(presentGlobCall({ pattern: '**/*.ts' })).toMatchObject({ card: 'generic', title: 'Glob **/*.ts', kind: 'search' })
    expect(presentGlobCall({ pattern: '*.md', path: 'docs' }).title).toBe('Glob *.md in docs')
  })

  it('grep titles carry the pattern, target, and include filter', () => {
    expect(presentGrepCall({ pattern: 'todo' })).toMatchObject({ card: 'generic', title: 'Grep todo', kind: 'search' })
    expect(presentGrepCall({ pattern: 'todo', path: 'src', include: '*.ts' }).title).toBe('Grep todo in src (*.ts)')
  })

  it('grep projects a search card from a real execute, grouped by file with total and truncation', async () => {
    /** 中文说明：测试局部值 { ctx, subprocess }，由紧邻初始化决定。 */
    const { ctx, subprocess } = await setup({ config: { grepMaxMatches: 2 } })
    subprocess.handler = () => runResult([
      matchLine('a.ts', 1, 'one'),
      matchLine('a.ts', 2, 'two'),
      matchLine('b.ts', 3, 'three'),
      '',
    ].join('\n'))
    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await call(ctx, 'grep', { pattern: 'e' }, { agent: agent('/w') })
    if (result.isError) throw new Error('expected grep success')
    // The presentationMeta projection rides the result meta (a surface call).
    expect(result.meta).toEqual({
      shape: 'matches',
      files: [{ path: 'a.ts', matches: [{ lineNumber: 1, line: 'one' }, { lineNumber: 2, line: 'two' }] }],
      truncated: true,
      total: 3,
    })
    /** 中文说明：测试局部值 view，由紧邻初始化决定。 */
    const view = presentGrepResult({ pattern: 'e' }, result)
    expect(view).toEqual({
      card: 'search',
      shape: 'matches',
      files: [{ path: 'a.ts', matches: [{ lineNumber: 1, line: 'one' }, { lineNumber: 2, line: 'two' }] }],
      truncated: true,
      total: 3,
    })
  })

  it('glob projects a search card from a real execute, a flat path list with total and truncation', async () => {
    /** 中文说明：测试局部值 { ctx, subprocess }，由紧邻初始化决定。 */
    const { ctx, subprocess } = await setup({ config: { globMaxResults: 2 } })
    subprocess.handler = () => runResult('a.ts\nb.ts\nc.ts\n')
    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await call(ctx, 'glob', { pattern: '*.ts' }, { agent: agent('/w') })
    if (result.isError) throw new Error('expected glob success')
    expect(result.meta).toEqual({ shape: 'paths', paths: ['a.ts', 'b.ts'], truncated: true, total: 3 })
    /** 中文说明：测试局部值 view，由紧邻初始化决定。 */
    const view = presentGlobResult({ pattern: '*.ts' }, result)
    expect(view).toEqual({ card: 'search', shape: 'paths', paths: ['a.ts', 'b.ts'], truncated: true, total: 3 })
  })

  it('nested Code dispatch computes no meta, so presentResult falls back to the generic card', async () => {
    /** 中文说明：测试局部值 { ctx, subprocess }，由紧邻初始化决定。 */
    const { ctx, subprocess } = await setup()
    subprocess.handler = () => runResult(`${matchLine('a.ts', 1, 'one')}\n`)
    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await call(ctx, 'grep', { pattern: 'o' }, {
      agent: agent('/w'),
      parent: Symbol('run_code') as ToolExecutionToken,
    })
    if (result.isError) throw new Error('expected grep success')
    expect(result.meta).toBeUndefined()
    expect(presentGrepResult({ pattern: 'o' }, result)).toBeUndefined()
  })

  it('presentResult returns undefined for a failed result and for the other tool’s meta shape', () => {
    /** 中文说明：测试局部值 errorResult，由紧邻初始化决定。 */
    const errorResult = { content: [{ type: 'text' as const, text: 'boom' }], isError: true }
    expect(presentGrepResult({ pattern: 'x' }, errorResult)).toBeUndefined()
    expect(presentGlobResult({ pattern: '*' }, errorResult)).toBeUndefined()
    // A grep result carrying a paths-shaped meta (and vice versa) is not this
    // tool's shape: each presenter narrows to its own shape and otherwise falls back.
    /** 中文说明：测试局部值 pathsResult，由紧邻初始化决定。 */
    const pathsResult = { content: [], isError: false, meta: { shape: 'paths', paths: ['a.ts'], truncated: false, total: 1 } }
    /** 中文说明：测试局部值 matchesResult，由紧邻初始化决定。 */
    const matchesResult = { content: [], isError: false, meta: { shape: 'matches', files: [], truncated: false, total: 0 } }
    expect(presentGrepResult({ pattern: 'x' }, pathsResult)).toBeUndefined()
    expect(presentGlobResult({ pattern: '*' }, matchesResult)).toBeUndefined()
  })

  it('presentResult falls back to the generic card on malformed replayed meta', () => {
    /** 中文说明：测试局部值 malformed，由紧邻初始化决定。 */
    const malformed = { content: [], isError: false, meta: { shape: 'matches', files: 'nope', truncated: false, total: 0 } }
    expect(presentGrepResult({ pattern: 'x' }, malformed)).toBeUndefined()
    expect(presentGlobResult({ pattern: '*' }, { content: [], isError: false, meta: 42 })).toBeUndefined()
  })
})

describe('helpers', () => {
  it('toWorkdirRelative maps inside-workdir absolutes and passes everything else through', () => {
    expect(toWorkdirRelative('/w/a/b.ts', '/w')).toBe(join('a', 'b.ts'))
    expect(toWorkdirRelative('/w', '/w')).toBe('.')
    expect(toWorkdirRelative('/other/b.ts', '/w')).toBe('/other/b.ts')
    expect(toWorkdirRelative('/w-sibling/b.ts', '/w')).toBe('/w-sibling/b.ts')
    expect(toWorkdirRelative('rel/b.ts', '/w')).toBe('rel/b.ts')
    // Normalization makes this land OUTSIDE the workdir → original path kept.
    expect(toWorkdirRelative('/w/../up.ts', '/w')).toBe('/w/../up.ts')
  })

  it('previewLine keeps a within-budget line untouched', () => {
    expect(previewLine('short', 100)).toBe('short')
  })

  it('formatGrepMatches groups by first-seen file order', () => {
    /** 中文说明：测试局部值 grouped，由紧邻初始化决定。 */
    const grouped = formatGrepMatches([
      { path: 'b.ts', lineNumber: 2, line: 'x' },
      { path: 'a.ts', lineNumber: 1, line: 'y' },
      { path: 'b.ts', lineNumber: 5, line: 'z' },
    ])
    expect(grouped).toBe('b.ts\nLine 2: x\nLine 5: z\n\na.ts\nLine 1: y')
  })
})
