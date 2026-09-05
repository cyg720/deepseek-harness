/**
 * 文件职责：验证E2B 远程沙箱的 subprocess.spec.ts 行为与边界。
 * 技术维度：TypeScript、Cordis、异步资源生命周期、远程文件/进程接口和 Vitest。
 * 产品维度：保证E2B 远程沙箱在真实组装、失败和清理场景中可靠。
 * 逻辑维度：构造服务或远程替身，驱动操作并断言结果。
 * 关键边界：凭据不得泄漏；远程句柄、终端和后台进程必须在取消或卸载时释放。
 * 新手阅读建议：先读接口和夹具，再按创建、操作、错误和清理流程阅读。
 */
import { once } from 'node:events'
import { Context } from '@deepseek-ai/cordis'
import {
  CommandExitError,
  FileNotFoundError,
  SandboxNotFoundError,
  /** 中文说明：类型或类 CommandHandle 约束远程资源或测试数据职责。 */
  type CommandHandle,
  /** 中文说明：类型或类 CommandResult 约束远程资源或测试数据职责。 */
  type CommandResult,
  /** 中文说明：类型或类 Sandbox 约束远程资源或测试数据职责。 */
  type Sandbox,
} from '@deepseek-ai/dsh-e2b'
import type E2BRuntime from '@deepseek-ai/dsh-e2b'
import type { SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import E2BSubprocessRuntime from '@deepseek-ai/dsh-subprocess-e2b'
import { E2BBase64Decoder, E2B_OUTPUT_COMPLETE_FRAME, E2BOutputReader } from '../src/output.ts'
import { E2BSubprocessHandle } from '../src/process.ts'
import { describe, expect, it, vi } from 'vitest'

/** 中文说明：函数 commandError 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function commandError(exitCode: number): CommandExitError {
  return new CommandExitError({ exitCode, stdout: '', stderr: '', error: `exit ${exitCode}` })
}

/** 中文说明：类型或类 StartOptions 约束远程资源或测试数据职责。 */
interface StartOptions {
  background: true
  cwd: string
  stdin: boolean
  timeoutMs: number
  signal?: AbortSignal
  envs?: Record<string, string>
  onStdout?: (data: string) => void | Promise<void>
  onStderr?: (data: string) => void | Promise<void>
}

/** 中文说明：类型或类 FakeCommandHandle 约束远程资源或测试数据职责。 */
class FakeCommandHandle {
  pid = 4242
  readonly sent: Array<string | Uint8Array> = []
  closes = 0
  kills = 0
  disconnects = 0
  killError: unknown
  killResult = true
  disconnectError: unknown
  private readonly result = Promise.withResolvers<CommandResult>()
  private settled = false

  constructor(private readonly onKill: () => void = () => {}) {}

  wait(): Promise<CommandResult> {
    return this.result.promise
  }

  async sendStdin(data: string | Uint8Array): Promise<void> {
    this.sent.push(data)
  }

  async closeStdin(): Promise<void> {
    this.closes += 1
  }

  async kill(): Promise<boolean> {
    this.kills += 1
    if (this.killError !== undefined) throw this.killError
    this.onKill()
    return this.killResult
  }

  async disconnect(): Promise<void> {
    this.disconnects += 1
    if (this.disconnectError !== undefined) throw this.disconnectError
  }

  succeed(exitCode = 0): void {
    if (this.settled) return
    this.settled = true
    this.result.resolve({ exitCode, stdout: '', stderr: '' })
  }

  fail(exitCode: number): void {
    if (this.settled) return
    this.settled = true
    this.result.reject(commandError(exitCode))
  }

  crash(error: unknown): void {
    if (this.settled) return
    this.settled = true
    this.result.reject(error)
  }
}

/** 中文说明：类型或类 FakeSandbox 约束远程资源或测试数据职责。 */
class FakeSandbox {
  readonly handle: FakeCommandHandle
  readonly commandsSeen: string[] = []
  readonly writtenFiles: string[][] = []
  readonly writtenFileData = new Map<string, string>()
  readonly removed: string[] = []
  readonly directories: string[] = []
  startOptions: StartOptions | undefined
  backgroundError: unknown
  envError: unknown
  statusError: unknown
  nextRemoveError: unknown
  probeError: unknown
  signalError: unknown
  readonly signalErrors: unknown[] = []
  trapsTerm = false
  delaysKill = false
  delaysKillCompletion = false
  sdkKillStops = true
  alive = true
  zombieOnly = false
  ambient = 'PATH=/ambient/bin\0KEEP=safe\0UNICODE=你好\0NPM_TOKEN=secret\0DSH_STALE=old\0BROKEN\0=bad\0'
  environmentHome = '/home/user'
  environmentWire: string | undefined
  environmentRequest: ((signal: AbortSignal | undefined) => Promise<void>) | undefined
  processGroupId = '4242\n'
  exitStatus = ''
  statusReads = 0
  readonly processGroupReads: string[] = []
  afterStatusRead: (() => void) | undefined
  beforeProbe: (() => void) | undefined
  afterProbe: (() => void) | undefined
  private startGate: Promise<void> | undefined
  private openStart: (() => void) | undefined
  private processGroupReadGate: Promise<void> | undefined
  private openProcessGroupRead: (() => void) | undefined
  private signalGate: Promise<void> | undefined
  private openSignal: (() => void) | undefined

  constructor() {
    this.handle = new FakeCommandHandle(() => {
      if (this.sdkKillStops) {
        this.alive = false
        this.handle.fail(137)
      }
    })
  }

  deferStart(): void {
    /** 中文说明：测试局部值 gate，由紧邻初始化决定。 */
    const gate = Promise.withResolvers<undefined>()
    this.startGate = gate.promise
    this.openStart = () => { gate.resolve(undefined) }
  }

  releaseStart(): void {
    this.openStart?.()
  }

  deferProcessGroupRead(): void {
    /** 中文说明：测试局部值 gate，由紧邻初始化决定。 */
    const gate = Promise.withResolvers<undefined>()
    this.processGroupReadGate = gate.promise
    this.openProcessGroupRead = () => { gate.resolve(undefined) }
  }

  releaseProcessGroupRead(): void {
    this.openProcessGroupRead?.()
  }

  deferSignals(): void {
    /** 中文说明：测试局部值 gate，由紧邻初始化决定。 */
    const gate = Promise.withResolvers<undefined>()
    this.signalGate = gate.promise
    this.openSignal = () => { gate.resolve(undefined) }
  }

  releaseSignals(): void {
    this.openSignal?.()
  }

  finish(exitCode = 0): void {
    this.alive = false
    void this.completeOutput().then(
      () => {
        if (exitCode === 0) this.handle.succeed(0)
        else this.handle.fail(exitCode)
      },
      (error: unknown) => { this.handle.crash(error) },
    )
  }

  async completeOutput(): Promise<void> {
    await Promise.all([
      this.stdoutWire(`${E2B_OUTPUT_COMPLETE_FRAME}\n`),
      this.stderrWire(`${E2B_OUTPUT_COMPLETE_FRAME}\n`),
    ])
  }

  async stdout(data: string): Promise<void> {
    await this.stdoutWire(data.length === 0 ? '' : `${Buffer.from(data).toString('base64')}\n`)
  }

  async stderr(data: string): Promise<void> {
    await this.stderrWire(data.length === 0 ? '' : `${Buffer.from(data).toString('base64')}\n`)
  }

  async stdoutWire(data: string): Promise<void> {
    await this.startOptions?.onStdout?.(data)
  }

  async stderrWire(data: string): Promise<void> {
    await this.startOptions?.onStderr?.(data)
  }

  readonly sandbox = {
    sandboxId: 'fake',
    files: {
      makeDir: async (path: string): Promise<boolean> => {
        this.directories.push(path)
        return true
      },
      write: async (files: Array<{ path: string; data: string }>): Promise<object[]> => {
        this.writtenFiles.push(files.map(file => file.path))
        /** 中文说明：测试局部值 file，由紧邻初始化决定。 */
        for (const file of files) this.writtenFileData.set(file.path, file.data)
        return files.map(() => ({}))
      },
      read: async (path: string): Promise<string> => {
        if (!path.endsWith('/exit-code')) {
          await this.processGroupReadGate
          return this.processGroupReads.shift() ?? this.processGroupId
        }
        if (this.statusError !== undefined) {
          /** 中文说明：测试局部值 error，由紧邻初始化决定。 */
          const error = this.statusError
          this.statusError = undefined
          throw error
        }
        this.statusReads += 1
        this.afterStatusRead?.()
        return this.exitStatus
      },
      remove: async (path: string): Promise<void> => {
        this.removed.push(path)
        if (this.nextRemoveError !== undefined) {
          /** 中文说明：测试局部值 error，由紧邻初始化决定。 */
          const error = this.nextRemoveError
          this.nextRemoveError = undefined
          throw error
        }
      },
    },
    commands: {
      run: async (command: string, options?: StartOptions | { signal?: AbortSignal }): Promise<CommandHandle | CommandResult> => {
        this.commandsSeen.push(command)
        if (command.includes('env -0 | base64')) {
          await this.environmentRequest?.(options?.signal)
          if (this.envError !== undefined) throw this.envError
          return {
            exitCode: 0,
            stdout: this.environmentWire ?? [this.environmentHome, this.ambient]
              .map(value => Buffer.from(value).toString('base64'))
              .join('\n'),
            stderr: '',
          }
        }
        if (command.startsWith('set -o pipefail; ps -eo pgid=,stat=')) {
          this.beforeProbe?.()
          if (options?.signal?.aborted === true) throw new DOMException('aborted', 'AbortError')
          if (this.probeError !== undefined) {
            /** 中文说明：测试局部值 error，由紧邻初始化决定。 */
            const error = this.probeError
            this.probeError = undefined
            throw error
          }
          /** 中文说明：测试局部值 stdout，由紧邻初始化决定。 */
          const stdout = this.alive && !this.zombieOnly ? 'live\n' : ''
          this.afterProbe?.()
          return { exitCode: 0, stdout, stderr: '' }
        }
        if (command.startsWith('kill -TERM ')) {
          await this.signalGate
          /** 中文说明：测试局部值 error，由紧邻初始化决定。 */
          const error = this.signalErrors.shift() ?? this.signalError
          if (error !== undefined) {
            if (this.signalErrors.length === 0) this.signalError = undefined
            throw error
          }
          if (!this.trapsTerm) {
            this.alive = false
            this.handle.fail(143)
          }
          return { exitCode: 0, stdout: '', stderr: '' }
        }
        if (command.startsWith('kill -KILL ')) {
          await this.signalGate
          /** 中文说明：测试局部值 error，由紧邻初始化决定。 */
          const error = this.signalErrors.shift() ?? this.signalError
          if (error !== undefined) {
            if (this.signalErrors.length === 0) this.signalError = undefined
            throw error
          }
          if (!this.delaysKill) this.alive = false
          if (!this.delaysKillCompletion) this.handle.fail(137)
          return { exitCode: 0, stdout: '', stderr: '' }
        }
        if ((options as StartOptions | undefined)?.background === true) {
          this.startOptions = options as StartOptions
          await this.startGate
          if (this.backgroundError !== undefined) throw this.backgroundError
          return this.handle as unknown as CommandHandle
        }
        return { exitCode: 0, stdout: '', stderr: '' }
      },
    },
  } as unknown as Sandbox
}

/** 中文说明：函数 spec 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function spec(overrides: Partial<SubprocessSpawnSpec> = {}): SubprocessSpawnSpec {
  return {
    argv: ['bash', '-c', 'printf ok'],
    cwd: '/workspace',
    stdio: {
      stdin: 'ignore',
      stdout: { maxBytes: 4, spill: { maxBytes: 16 } },
      stderr: { maxBytes: 4 },
    },
    graceMs: 5,
    ...overrides,
  }
}

/** 中文说明：函数 runtime 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function runtime(fake: FakeSandbox, getSandbox: () => Promise<Sandbox> = async () => fake.sandbox): E2BRuntime {
  return {
    cwd: '/workspace',
    runtimeRoot: '/workspace/.dsh-e2b',
    getSandbox,
  } as unknown as E2BRuntime
}

/** 中文说明：函数 flush 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
async function flush(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0))
}

/** Construct the handle under test with the config default the service would pass. */
/* 中文说明：函数 testHandle 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function testHandle(
  runtime: ConstructorParameters<typeof E2BSubprocessHandle>[0],
  spec: ConstructorParameters<typeof E2BSubprocessHandle>[1],
  stateDir: string,
  pollMs = 20,
): E2BSubprocessHandle {
  return new E2BSubprocessHandle(runtime, spec, stateDir, pollMs)
}

describe('E2BOutputReader', () => {
  it('decodes base64 across arbitrary callback boundaries and rejects malformed framing', () => {
    /** 中文说明：测试局部值 decoder，由紧邻初始化决定。 */
    const decoder = new E2BBase64Decoder()
    expect(decoder.push('')).toEqual(Buffer.alloc(0))
    expect(decoder.push('5')).toEqual(Buffer.alloc(0))
    expect(decoder.push('L2')).toEqual(Buffer.alloc(0))
    expect(decoder.push('g\n').toString()).toBe('你')
    expect(decoder.push('YQ==\nYg==\n').toString()).toBe('ab')
    expect(decoder.push(`${Buffer.from([0, 255]).toString('base64')}\n`)).toEqual(Buffer.from([0, 255]))
    expect(decoder.push(`${E2B_OUTPUT_COMPLETE_FRAME}\n`)).toEqual(Buffer.alloc(0))
    decoder.finish()

    expect(() => new E2BBase64Decoder().push('%\n')).toThrow('invalid base64')
    expect(() => new E2BBase64Decoder().push('AB==\n')).toThrow('invalid base64')
    expect(() => decoder.push(`${E2B_OUTPUT_COMPLETE_FRAME}\n`)).toThrow('duplicate output transport completion')
    expect(() => decoder.push('YQ==\n')).toThrow('continued after completion')
    /** 中文说明：测试局部值 truncated，由紧邻初始化决定。 */
    const truncated = new E2BBase64Decoder()
    truncated.push('YQ')
    expect(() => { truncated.finish() }).toThrow('truncated base64')
    expect(() => { new E2BBase64Decoder().finish() }).toThrow('incomplete output transport')
    /** 中文说明：测试局部值 interrupted，由紧邻初始化决定。 */
    const interrupted = new E2BBase64Decoder()
    interrupted.push('YQ')
    expect(() => { interrupted.finish(false) }).not.toThrow()
  })

  it('keeps a byte-exact tail with independent whole-stream cursors', () => {
    /** 中文说明：测试局部值 reader，由紧邻初始化决定。 */
    const reader = new E2BOutputReader(4, 10, '/remote/spill')
    reader.push(Buffer.alloc(0))
    reader.push(Buffer.from('ab'))
    reader.push(Buffer.from('cdef'))
    expect(reader.size).toBe(6)
    expect(reader.readFrom(0)).toEqual({ text: 'cdef', nextOffset: 6, lossy: true, spillPath: '/remote/spill' })
    expect(reader.readFrom(2)).toEqual({ text: 'cdef', nextOffset: 6, lossy: false })
    expect(reader.readFrom(5)).toEqual({ text: 'f', nextOffset: 6, lossy: false })
    expect(reader.readFrom(99)).toEqual({ text: '', nextOffset: 6, lossy: false })
    reader.invalidateSpill()
    expect(reader.readFrom(0)).toEqual({ text: 'cdef', nextOffset: 6, lossy: true })
  })

  it('drops whole head chunks and withholds absent or over-cap spills', () => {
    /** 中文说明：测试局部值 withoutSpill，由紧邻初始化决定。 */
    const withoutSpill = new E2BOutputReader(2, undefined, '/unused')
    withoutSpill.push(Buffer.from('ab'))
    withoutSpill.push(Buffer.from('cd'))
    expect(withoutSpill.readFrom(0)).toEqual({ text: 'cd', nextOffset: 4, lossy: true })
    /** 中文说明：测试局部值 overCap，由紧邻初始化决定。 */
    const overCap = new E2BOutputReader(2, 3, '/too-small')
    overCap.push(Buffer.from('abcd'))
    expect(overCap.readFrom(0)).toEqual({ text: 'cd', nextOffset: 4, lossy: true })
  })
})

describe('E2BSubprocessHandle', () => {
  it('starts asynchronously, keeps secrets out of the command, and supports deferred piped stdin/output', async () => {
    /** 中文说明：测试局部值 fake，由紧邻初始化决定。 */
    const fake = new FakeSandbox()
    fake.processGroupId = '4343\n'
    fake.deferStart()
    /** 中文说明：测试局部值 handle，由紧邻初始化决定。 */
    const handle = testHandle(runtime(fake), spec({
      argv: ['tool', 'argument with spaces'],
      stdio: { stdin: 'pipe', stdout: 'pipe', stderr: { maxBytes: 8, spill: { maxBytes: 32 } } },
      env: {
        PATH: '/bin',
        'FOO-BAR': 'hyphen-value',
        '--split-string': 'literal-value',
        DEEPSEEK_API_KEY: 'explicit-secret',
        DSH_MODE: 'test',
        // The seam's tombstone: an explicit undefined removes the ambient entry.
        KEEP: undefined,
      },
    }), '/workspace/.dsh-e2b/processes/one')
    expect(handle.pid).toBe(-1)
    handle.stdin!.write('hello')
    handle.stdin!.end()
    fake.releaseStart()
    await flush()
    expect(handle.pid).toBe(4343)
    expect(fake.handle.sent.map(value => String(value))).toEqual(['hello'])
    expect(fake.handle.closes).toBe(1)
    /** 中文说明：测试局部值 controlEnvs，由紧邻初始化决定。 */
    const controlEnvs = fake.startOptions?.envs
    expect(controlEnvs?.HOME).toMatch(/^\/\.dsh-e2b-control-/)
    expect(controlEnvs).toEqual({
      TERM: 'dumb',
      NPM_TOKEN: '',
      DSH_STALE: '',
      HOME: controlEnvs?.HOME,
    })
    /** 中文说明：测试局部值 command，由紧邻初始化决定。 */
    const command = fake.commandsSeen.find(value => value.includes('exec "$dsh_e2b_env_bin" -i'))!
    expect(command).toContain('"$dsh_e2b_setsid" --wait -- "$dsh_e2b_bash" -c')
    expect(command).not.toContain('DEEPSEEK_API_KEY')
    expect(command).not.toContain('DSH_MODE')
    expect(command).not.toContain('FOO-BAR')
    expect(command).not.toContain('explicit-secret')
    expect(command).not.toContain('hyphen-value')
    expect(command).not.toContain('${!dsh_e2b_name}')
    /** 中文说明：测试局部值 environmentProbe，由紧邻初始化决定。 */
    const environmentProbe = fake.commandsSeen.find(value => value.includes('env -0 | base64'))
    expect(environmentProbe).toContain('getent passwd "$(id -u)"')
    expect(environmentProbe).toContain('test -n "$dsh_e2b_home" -a -d "$dsh_e2b_home"')
    expect(environmentProbe).not.toContain('"$PWD"')
    expect(command).toContain('mapfile -d')
    expect(command).toContain('dsh_e2b_node="$(command -v node)"')
    expect(command).toContain('"$dsh_e2b_env_bin" -i "$dsh_e2b_node" -e')
    expect(command).toContain('"$dsh_e2b_env_bin" -i -- "${dsh_e2b_env[@]}" "$@"')
    expect(command).toContain('exec "$dsh_e2b_env_bin" -i -- "${dsh_e2b_env[@]}"')
    expect(command).toContain('>&2 2>/dev/null')
    expect(command).not.toContain('2>/dev/null >&2')
    expect(command).toContain('base64')
    expect(fake.writtenFiles[0]).toEqual([
      '/workspace/.dsh-e2b/processes/one/pid',
      '/workspace/.dsh-e2b/processes/one/exit-code',
      '/workspace/.dsh-e2b/processes/one/environment',
      '/workspace/.dsh-e2b/processes/one/stderr.log',
    ])
    expect(fake.writtenFileData.get('/workspace/.dsh-e2b/processes/one/environment')).toBe(
      'PATH=/bin\0UNICODE=你好\0HOME=/home/user\0FOO-BAR=hyphen-value\0--split-string=literal-value\0DEEPSEEK_API_KEY=explicit-secret\0DSH_MODE=test\0',
    )

    /** 中文说明：测试局部值 piped，由紧邻初始化决定。 */
    let piped = ''
    handle.stdout!.on('data', (chunk) => { piped += String(chunk) })
    await fake.stdout('pipe-data')
    await fake.stderr('err')
    fake.finish()
    await expect(handle.done).resolves.toEqual({ exitCode: 0, signal: null })
    expect(piped).toBe('pipe-data')
    expect(handle.collected.stderr!.readFrom(0)).toMatchObject({ text: 'err', lossy: false })
    expect(fake.removed).toContain('/workspace/.dsh-e2b/processes/one/stderr.log')
    await expect(handle.waitForExit()).resolves.toBe(true)
  })

  it('rejects an unrepresentable graceMs before any remote work', () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    /** 中文说明：测试局部值 service，由紧邻初始化决定。 */
    const service = Object.create(E2BSubprocessRuntime.prototype) as E2BSubprocessRuntime
    Reflect.set(service, 'disposing', false)
    Reflect.set(service, 'ctx', ctx)
    /** 中文说明：测试局部值 graceMs，由紧邻初始化决定。 */
    for (const graceMs of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => service.spawn(spec({ graceMs }))).toThrow('graceMs must be a positive finite number')
      void expect(service.spawnTerminal({
        argv: ['bash'], cwd: '/w', rows: 24, cols: 80, graceMs,
      })).rejects.toThrow('graceMs must be a positive finite number')
    }
  })

  it('rejects malformed environment entries before command start', async () => {
    /** 中文说明：测试局部值 env，由紧邻初始化决定。 */
    for (const env of [{ 'BAD=NAME': 'x' }, { BAD: 'x\0INJECTED=1' }]) {
      /** 中文说明：测试局部值 fake，由紧邻初始化决定。 */
      const fake = new FakeSandbox()
      /** 中文说明：测试局部值 handle，由紧邻初始化决定。 */
      const handle = testHandle(runtime(fake), spec({ env }), '/runtime/invalid-environment')
      await expect(handle.done).rejects.toThrow('environment entries')
      expect(fake.startOptions).toBeUndefined()
      expect(fake.removed).toContain('/runtime/invalid-environment')
    }
  })

  it('preserves UTF-8 bytes when the ASCII transport is split across callbacks', async () => {
    /** 中文说明：测试局部值 fake，由紧邻初始化决定。 */
    const fake = new FakeSandbox()
    /** 中文说明：测试局部值 handle，由紧邻初始化决定。 */
    const handle = testHandle(runtime(fake), spec({
      stdio: { stdin: 'ignore', stdout: 'pipe', stderr: { maxBytes: 4 } },
    }), '/runtime/split-utf8')
    await flush()
    /** 中文说明：测试局部值 chunks，由紧邻初始化决定。 */
    const chunks: Buffer[] = []
    handle.stdout!.on('data', (chunk: Buffer) => { chunks.push(chunk) })
    /** 中文说明：测试局部值 character，由紧邻初始化决定。 */
    for (const character of `${Buffer.from('A你好B').toString('base64')}\n`) {
      await fake.stdoutWire(character)
    }
    fake.finish()
    await expect(handle.done).resolves.toEqual({ exitCode: 0, signal: null })
    expect(Buffer.concat(chunks).toString('utf8')).toBe('A你好B')
  })

  it('rejects malformed output transport without confusing it with a consumer sink failure', async () => {
    /** 中文说明：测试局部值 fake，由紧邻初始化决定。 */
    const fake = new FakeSandbox()
    /** 中文说明：测试局部值 handle，由紧邻初始化决定。 */
    const handle = testHandle(runtime(fake), spec(), '/runtime/malformed-output')
    await flush()
    await fake.stdoutWire('%\n')
    fake.finish()
    await expect(handle.done).rejects.toThrow('invalid base64 output transport')

    /** 中文说明：测试局部值 stderrFake，由紧邻初始化决定。 */
    const stderrFake = new FakeSandbox()
    /** 中文说明：测试局部值 stderrHandle，由紧邻初始化决定。 */
    const stderrHandle = testHandle(runtime(stderrFake), spec(), '/runtime/malformed-stderr')
    await flush()
    await stderrFake.stderrWire('%\n')
    stderrFake.finish()
    await expect(stderrHandle.done).rejects.toThrow('invalid base64 output transport')
  })

  it('rejects a naturally completed command whose encoder omits its completion frame', async () => {
    /** 中文说明：测试局部值 fake，由紧邻初始化决定。 */
    const fake = new FakeSandbox()
    /** 中文说明：测试局部值 handle，由紧邻初始化决定。 */
    const handle = testHandle(runtime(fake), spec(), '/runtime/incomplete-output')
    await flush()
    fake.alive = false
    fake.handle.succeed(0)
    await expect(handle.done).rejects.toThrow('incomplete output transport')
  })

  it('bounds descendant-held output draining and withholds the incomplete spill', async () => {
    /** 中文说明：测试局部值 fake，由紧邻初始化决定。 */
    const fake = new FakeSandbox()
    /** 中文说明：测试局部值 handle，由紧邻初始化决定。 */
    const handle = testHandle(runtime(fake), spec({ graceMs: 5 }), '/runtime/drain-bound')
    await flush()
    await fake.stdout('leader-output')
    fake.exitStatus = '0\n'

    await expect(handle.done).resolves.toEqual({ exitCode: 0, signal: null })
    expect(fake.handle.disconnects).toBe(1)
    expect(handle.collected.stdout?.readFrom(0)).toEqual({
      text: 'tput',
      nextOffset: 13,
      lossy: true,
    })
    expect(fake.removed).toContain('/runtime/drain-bound/stdout.log')

    handle.terminate()
    await expect(handle.waitForExit()).resolves.toBe(true)
  })

  it('releases an inherited-output callback blocked on host backpressure at drain expiry', async () => {
    /** 中文说明：测试局部值 fake，由紧邻初始化决定。 */
    const fake = new FakeSandbox()
    /** 中文说明：测试局部值 written，由紧邻初始化决定。 */
    const written: string[] = []
    /** 中文说明：测试局部值 stdoutWrite，由紧邻初始化决定。 */
    const stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: Uint8Array) => {
      written.push(Buffer.from(chunk).toString())
      return false
    }) as typeof process.stdout.write)
    try {
      /** 中文说明：测试局部值 handle，由紧邻初始化决定。 */
      const handle = testHandle(runtime(fake), spec({
        graceMs: 5,
        stdio: { stdin: 'ignore', stdout: 'inherit', stderr: { maxBytes: 4 } },
      }), '/runtime/inherit-backpressure')
      await flush()
      /** 中文说明：测试局部值 callbackSettled，由紧邻初始化决定。 */
      let callbackSettled = false
      /** 中文说明：测试局部值 blocked，由紧邻初始化决定。 */
      const blocked = fake.stdout('blocked bytes').then(() => { callbackSettled = true })
      await flush()
      expect(callbackSettled).toBe(false)
      fake.exitStatus = '0\n'

      await expect(handle.done).resolves.toEqual({ exitCode: 0, signal: null })
      await blocked
      expect(callbackSettled).toBe(true)
      expect(written.join('')).toBe('blocked bytes')
      expect(fake.handle.disconnects).toBe(1)

      handle.terminate()
      await expect(handle.waitForExit()).resolves.toBe(true)
    } finally {
      stdoutWrite.mockRestore()
    }
  })

  it('waits for lossless raw-pipe output after the direct status is published', async () => {
    /** 中文说明：测试局部值 fake，由紧邻初始化决定。 */
    const fake = new FakeSandbox()
    /** 中文说明：测试局部值 handle，由紧邻初始化决定。 */
    const handle = testHandle(runtime(fake), spec({
      graceMs: 1,
      stdio: { stdin: 'ignore', stdout: 'pipe', stderr: { maxBytes: 4 } },
    }), '/runtime/pipe-drain')
    /** 中文说明：测试局部值 output，由紧邻初始化决定。 */
    let output = ''
    handle.stdout!.on('data', (chunk) => { output += String(chunk) })
    await flush()
    fake.exitStatus = '0\n'

    /** 中文说明：测试局部值 settled，由紧邻初始化决定。 */
    let settled = false
    void handle.done.then(() => { settled = true })
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(settled).toBe(false)
    expect(fake.handle.disconnects).toBe(0)
    expect(fake.statusReads).toBe(0)

    await fake.stdout('complete protocol frame')
    fake.finish()
    await expect(handle.done).resolves.toEqual({ exitCode: 0, signal: null })
    expect(output).toBe('complete protocol frame')
    expect(fake.statusReads).toBe(1)
  })

  it('accepts clean encoder completion inside the output-drain grace', async () => {
    /** 中文说明：测试局部值 fake，由紧邻初始化决定。 */
    const fake = new FakeSandbox()
    /** 中文说明：测试局部值 handle，由紧邻初始化决定。 */
    const handle = testHandle(runtime(fake), spec({ graceMs: 100 }), '/runtime/drain-complete')
    await flush()
    fake.exitStatus = '0\n'
    fake.afterStatusRead = () => {
      fake.afterStatusRead = undefined
      setTimeout(() => { fake.finish() }, 0)
    }

    await expect(handle.done).resolves.toEqual({ exitCode: 0, signal: null })
    expect(fake.handle.disconnects).toBe(0)
  })

  it('preserves a published exit code when requested termination outlives output draining', async () => {
    /** 中文说明：测试局部值 fake，由紧邻初始化决定。 */
    const fake = new FakeSandbox()
    fake.trapsTerm = true
    fake.delaysKill = true
    fake.delaysKillCompletion = true
    fake.sdkKillStops = false
    /** 中文说明：测试局部值 handle，由紧邻初始化决定。 */
    const handle = testHandle(runtime(fake), spec({ graceMs: 5 }), '/runtime/drain-signal')
    await flush()

    handle.terminate()
    await vi.waitFor(() => { expect(fake.commandsSeen).toContain('kill -KILL -- -4242') })
    fake.exitStatus = '0\n'

    await expect(handle.done).resolves.toEqual({ exitCode: 0, signal: null })
    expect(fake.handle.disconnects).toBe(1)
    fake.alive = false
    handle.terminate()
    await expect(handle.waitForExit()).resolves.toBe(true)
  })

  it('preserves a published nonzero exit code when termination settles the SDK inside the drain grace', async () => {
    /** 中文说明：测试局部值 fake，由紧邻初始化决定。 */
    const fake = new FakeSandbox()
    /** 中文说明：测试局部值 handle，由紧邻初始化决定。 */
    const handle = testHandle(runtime(fake), spec({ graceMs: 100 }), '/runtime/drain-signal-settled')
    await flush()
    fake.exitStatus = '7\n'
    fake.afterStatusRead = () => {
      fake.afterStatusRead = undefined
      handle.terminate()
    }

    await expect(handle.done).resolves.toEqual({ exitCode: 7, signal: null })
    await expect(handle.waitForExit()).resolves.toBe(true)
  })

  it('rejects an invalid direct-command exit status', async () => {
    /** 中文说明：测试局部值 fake，由紧邻初始化决定。 */
    const fake = new FakeSandbox()
    /** 中文说明：测试局部值 handle，由紧邻初始化决定。 */
    const handle = testHandle(runtime(fake), spec(), '/runtime/invalid-status')
    await flush()
    fake.exitStatus = '999\n'
    await expect(handle.done).rejects.toThrow('invalid exit code')
    handle.terminate()
    await expect(handle.waitForExit()).resolves.toBe(true)
  })

  it('rolls back a published process group before rejecting a monitoring failure', async () => {
    /** 中文说明：测试局部值 fake，由紧邻初始化决定。 */
    const fake = new FakeSandbox()
    fake.statusError = new Error('status transport failed')
    /** 中文说明：测试局部值 handle，由紧邻初始化决定。 */
    const handle = testHandle(runtime(fake), spec(), '/runtime/status-failure')

    await expect(handle.done).rejects.toThrow('status transport failed')
    expect(fake.commandsSeen).toContain('kill -TERM -- -4242')
    expect(fake.alive).toBe(false)
    await expect(handle.waitForExit()).resolves.toBe(true)

    /** 中文说明：测试局部值 failed，由紧邻初始化决定。 */
    const failed = new FakeSandbox()
    failed.statusError = new Error('status transport failed')
    failed.signalErrors.push(new Error('TERM transport failed'), new Error('KILL transport failed'))
    failed.handle.killError = new Error('SDK kill failed')
    /** 中文说明：测试局部值 retained，由紧邻初始化决定。 */
    const retained = testHandle(runtime(failed), spec({ graceMs: 1 }), '/runtime/status-cleanup-failure')

    await expect(retained.done).rejects.toThrow(
      'command monitoring failed and process-group rollback did not reach quiescence',
    )
    expect(failed.alive).toBe(true)
    failed.handle.killError = undefined
    retained.terminate()
    await expect(retained.waitForExit()).resolves.toBe(true)

    // A state-cleanup failure on top preserves the rollback failure instead of
    // re-aggregating only the original monitoring error.
    /** 中文说明：测试局部值 triple，由紧邻初始化决定。 */
    const triple = new FakeSandbox()
    triple.statusError = new Error('status transport failed')
    triple.signalErrors.push(new Error('TERM transport failed'), new Error('KILL transport failed'))
    triple.handle.killError = new Error('SDK kill failed')
    triple.nextRemoveError = new Error('state cleanup failed')
    /** 中文说明：测试局部值 tripleHandle，由紧邻初始化决定。 */
    const tripleHandle = testHandle(runtime(triple), spec({ graceMs: 1 }), '/runtime/triple-failure')
    /** 中文说明：测试局部值 failure，由紧邻初始化决定。 */
    const failure = await tripleHandle.done.catch((error: unknown) => error as AggregateError)
    expect(failure).toBeInstanceOf(AggregateError)
    expect((failure as AggregateError).message).toContain('private state cleanup failed')
    /** 中文说明：测试局部值 nested，由紧邻初始化决定。 */
    const nested = (failure as AggregateError).errors[0] as AggregateError
    expect(nested.message).toContain('rollback did not reach quiescence')
    triple.handle.killError = undefined
    tripleHandle.terminate()
    await expect(tripleHandle.waitForExit()).resolves.toBe(true)
  })

  it('surfaces deferred piped-stdin write and close failures as stream errors', async () => {
    /** 中文说明：测试局部值 writeFake，由紧邻初始化决定。 */
    const writeFake = new FakeSandbox()
    writeFake.deferStart()
    vi.spyOn(writeFake.handle, 'sendStdin').mockRejectedValueOnce('stdin rejected')
    /** 中文说明：测试局部值 writeHandle，由紧邻初始化决定。 */
    const writeHandle = testHandle(runtime(writeFake), spec({
      stdio: { stdin: 'pipe', stdout: { maxBytes: 4 }, stderr: { maxBytes: 4 } },
    }), '/runtime/stdin-write-error')
    /** 中文说明：测试局部值 writeError，由紧邻初始化决定。 */
    const writeError = once(writeHandle.stdin!, 'error')
    writeHandle.stdin!.write('input')
    writeFake.releaseStart()
    await expect(writeError).resolves.toMatchObject([{ message: 'stdin rejected' }])
    writeFake.finish()
    await writeHandle.done

    /** 中文说明：测试局部值 closeFake，由紧邻初始化决定。 */
    const closeFake = new FakeSandbox()
    vi.spyOn(closeFake.handle, 'closeStdin').mockRejectedValueOnce(new Error('close rejected'))
    /** 中文说明：测试局部值 closeHandle，由紧邻初始化决定。 */
    const closeHandle = testHandle(runtime(closeFake), spec({
      stdio: { stdin: 'pipe', stdout: { maxBytes: 4 }, stderr: { maxBytes: 4 } },
    }), '/runtime/stdin-close-error')
    await flush()
    /** 中文说明：测试局部值 closeError，由紧邻初始化决定。 */
    const closeError = once(closeHandle.stdin!, 'error')
    closeHandle.stdin!.end()
    await expect(closeError).resolves.toMatchObject([{ message: 'close rejected' }])
    closeFake.finish()
    await closeHandle.done
  })

  it('collects bounded tails, retains valid spills, and maps natural nonzero exits', async () => {
    /** 中文说明：测试局部值 fake，由紧邻初始化决定。 */
    const fake = new FakeSandbox()
    /** 中文说明：测试局部值 handle，由紧邻初始化决定。 */
    const handle = testHandle(runtime(fake), spec({
      stdio: {
        stdin: { data: 'batch' },
        stdout: { maxBytes: 4, spill: { maxBytes: 16 } },
        stderr: { maxBytes: 3 },
      },
    }), '/runtime/two')
    await flush()
    await fake.stdout('abcdef')
    await fake.stderr('12345')
    fake.finish(7)
    await expect(handle.done).resolves.toEqual({ exitCode: 7, signal: null })
    expect(fake.handle.sent).toEqual(['batch'])
    expect(fake.handle.closes).toBe(1)
    expect(handle.collected.stdout!.readFrom(0)).toEqual({
      text: 'cdef',
      nextOffset: 6,
      lossy: true,
      spillPath: '/runtime/two/stdout.log',
    })
    expect(handle.collected.stderr!.readFrom(0)).toEqual({ text: '345', nextOffset: 5, lossy: true })
    expect(fake.removed).not.toContain('/runtime/two/stdout.log')
  })

  it('removes a spill once the complete stream exceeds its cap', async () => {
    /** 中文说明：测试局部值 fake，由紧邻初始化决定。 */
    const fake = new FakeSandbox()
    /** 中文说明：测试局部值 handle，由紧邻初始化决定。 */
    const handle = testHandle(runtime(fake), spec({
      stdio: { stdin: 'ignore', stdout: { maxBytes: 2, spill: { maxBytes: 3 } }, stderr: 'inherit' },
    }), '/runtime/oversize')
    await flush()
    await fake.stdout('abcd')
    await fake.stderr('')
    fake.finish()
    await handle.done
    expect(handle.collected.stdout!.readFrom(0)).toEqual({ text: 'cd', nextOffset: 4, lossy: true })
    expect(fake.removed).toContain('/runtime/oversize/stdout.log')
    /** 中文说明：测试局部值 command，由紧邻初始化决定。 */
    const command = fake.commandsSeen.find(value => value.includes('dsh_e2b_tee='))!
    expect(command).toContain('"$dsh_e2b_head" -c 3')
    expect(command).toContain('/runtime/oversize/stdout.log')
    expect(command).toContain('"$dsh_e2b_tee" --output-error=warn-nopipe')
    expect(command).not.toContain('tee -a')
  })

  it('contains remote spill-removal failures and routes empty inherited output', async () => {
    /** 中文说明：测试局部值 fake，由紧邻初始化决定。 */
    const fake = new FakeSandbox()
    fake.nextRemoveError = new Error('already removed')
    /** 中文说明：测试局部值 handle，由紧邻初始化决定。 */
    const handle = testHandle(runtime(fake), spec({
      stdio: { stdin: 'ignore', stdout: 'inherit', stderr: { maxBytes: 4, spill: { maxBytes: 8 } } },
    }), '/runtime/remove-error')
    await flush()
    await fake.stdout('')
    await fake.stderr('')
    fake.finish()
    await expect(handle.done).resolves.toEqual({ exitCode: 0, signal: null })
    expect(fake.removed).toContain('/runtime/remove-error/stderr.log')
  })

  it('terminates a process group with TERM and reports the signal outcome', async () => {
    /** 中文说明：测试局部值 fake，由紧邻初始化决定。 */
    const fake = new FakeSandbox()
    /** 中文说明：测试局部值 handle，由紧邻初始化决定。 */
    const handle = testHandle(runtime(fake), spec(), '/runtime/term')
    await flush()
    handle.terminate()
    handle.terminate()
    await expect(handle.done).resolves.toEqual({ exitCode: null, signal: 'SIGTERM' })
    await expect(handle.waitForExit()).resolves.toBe(true)
    expect(fake.commandsSeen).toContain('kill -TERM -- -4242')
    expect(fake.commandsSeen).not.toContain('kill -KILL -- -4242')
    /** 中文说明：测试局部值 signals，由紧邻初始化决定。 */
    const signals = fake.commandsSeen.filter(command => command.startsWith('kill -')).length
    fake.alive = true
    handle.terminate()
    await flush()
    expect(fake.alive).toBe(true)
    expect(fake.commandsSeen.filter(command => command.startsWith('kill -'))).toHaveLength(signals)
  })

  it('makes termination a permanent no-op after natural quiescence is observed', async () => {
    /** 中文说明：测试局部值 fake，由紧邻初始化决定。 */
    const fake = new FakeSandbox()
    /** 中文说明：测试局部值 handle，由紧邻初始化决定。 */
    const handle = testHandle(runtime(fake), spec(), '/runtime/natural-quiescence')
    await flush()
    fake.finish()
    await expect(handle.done).resolves.toEqual({ exitCode: 0, signal: null })
    await expect(handle.waitForExit()).resolves.toBe(true)

    /** 中文说明：测试局部值 signals，由紧邻初始化决定。 */
    const signals = fake.commandsSeen.filter(command => command.startsWith('kill -')).length
    fake.alive = true
    handle.terminate()
    await flush()
    expect(fake.alive).toBe(true)
    expect(fake.commandsSeen.filter(command => command.startsWith('kill -'))).toHaveLength(signals)
  })

  it('treats a zombie-only process group as quiescent', async () => {
    /** 中文说明：测试局部值 fake，由紧邻初始化决定。 */
    const fake = new FakeSandbox()
    fake.zombieOnly = true
    /** 中文说明：测试局部值 handle，由紧邻初始化决定。 */
    const handle = testHandle(runtime(fake), spec(), '/runtime/zombie-quiescence')
    await flush()

    await expect(handle.waitForExit()).resolves.toBe(true)
    expect(fake.commandsSeen).toContain(
      'set -o pipefail; ps -eo pgid=,stat= | awk \'$1 == 4242 && $2 !~ /^[ZXx]/ { live=1 } END { if (live) print "live" }\'',
    )
    fake.finish()
    await expect(handle.done).resolves.toEqual({ exitCode: 0, signal: null })
  })

  it('keeps proven quiescence after a concurrent termination transport fails', async () => {
    /** 中文说明：测试局部值 fake，由紧邻初始化决定。 */
    const fake = new FakeSandbox()
    fake.signalErrors.push(new Error('TERM transport failed'), new Error('KILL transport failed'))
    fake.handle.killError = new Error('SDK kill failed')
    fake.deferSignals()
    /** 中文说明：测试局部值 handle，由紧邻初始化决定。 */
    const handle = testHandle(runtime(fake), spec(), '/runtime/quiescent-race')
    await flush()

    handle.terminate()
    await vi.waitFor(() => { expect(fake.commandsSeen).toContain('kill -TERM -- -4242') })
    fake.alive = false
    await expect(handle.waitForExit()).resolves.toBe(true)

    fake.probeError = new Error('post-quiescence probe failed')
    fake.releaseSignals()
    await vi.waitFor(() => { expect(fake.handle.kills).toBe(1) })
    fake.finish()
    await expect(handle.done).resolves.toEqual({ exitCode: 0, signal: null })
    /** 中文说明：测试局部值 signals，由紧邻初始化决定。 */
    const signals = fake.commandsSeen.filter(command => command.startsWith('kill -')).length
    handle.terminate()
    await expect(handle.waitForExit()).resolves.toBe(true)
    expect(fake.commandsSeen.filter(command => command.startsWith('kill -'))).toHaveLength(signals)
  })

  it('escalates a TERM-trapping process group to KILL and uses the SDK kill as fallback', async () => {
    /** 中文说明：测试局部值 fake，由紧邻初始化决定。 */
    const fake = new FakeSandbox()
    fake.trapsTerm = true
    fake.handle.killError = new Error('already gone')
    /** 中文说明：测试局部值 handle，由紧邻初始化决定。 */
    const handle = testHandle(runtime(fake), spec({ graceMs: 1 }), '/runtime/kill')
    await flush()
    handle.terminate()
    await expect(handle.done).resolves.toEqual({ exitCode: null, signal: 'SIGKILL' })
    await expect(handle.waitForExit()).resolves.toBe(true)
    expect(fake.commandsSeen).toContain('kill -KILL -- -4242')
    expect(fake.handle.kills).toBe(1)
  })

  it('keeps force cleanup retryable until quiescence is proven', async () => {
    /** 中文说明：测试局部值 fake，由紧邻初始化决定。 */
    const fake = new FakeSandbox()
    fake.trapsTerm = true
    fake.delaysKill = true
    fake.delaysKillCompletion = true
    fake.sdkKillStops = false
    /** 中文说明：测试局部值 handle，由紧邻初始化决定。 */
    const handle = testHandle(runtime(fake), spec({ graceMs: 1 }), '/runtime/termination-fence')
    await flush()
    handle.terminate()
    await vi.waitFor(() => { expect(fake.handle.kills).toBe(1) })
    await expect(handle.waitForExit()).rejects.toThrow('remained live after force termination')
    expect(fake.alive).toBe(true)

    fake.delaysKill = false
    fake.delaysKillCompletion = false
    fake.sdkKillStops = true
    handle.terminate()
    await expect(handle.waitForExit()).resolves.toBe(true)
    await expect(handle.done).resolves.toEqual({ exitCode: null, signal: 'SIGKILL' })
  })

  it('honors termination requested before asynchronous startup finishes', async () => {
    /** 中文说明：测试局部值 fake，由紧邻初始化决定。 */
    const fake = new FakeSandbox()
    fake.deferStart()
    /** 中文说明：测试局部值 handle，由紧邻初始化决定。 */
    const handle = testHandle(runtime(fake), spec(), '/runtime/deferred-kill')
    handle.terminate()
    fake.releaseStart()
    await expect(handle.done).resolves.toEqual({ exitCode: null, signal: 'SIGTERM' })
  })

  it('aborts a stalled preparation request before reporting startup quiescence', async () => {
    /** 中文说明：测试局部值 fake，由紧邻初始化决定。 */
    const fake = new FakeSandbox()
    /** 中文说明：测试局部值 解构结果，由紧邻初始化决定。 */
    let preparationSignal: AbortSignal | undefined
    fake.environmentRequest = async (signal) => {
      preparationSignal = signal
      await new Promise<never>((_resolve, reject) => {
        /** 中文说明：测试局部值 rejectAbort，由紧邻初始化决定。 */
        const rejectAbort = (): void => {
          /** 中文说明：测试局部值 reason，由紧邻初始化决定。 */
          const reason: unknown = signal?.reason
          reject(reason instanceof Error ? reason : new Error(String(reason)))
        }
        if (signal?.aborted === true) {
          rejectAbort()
          return
        }
        signal?.addEventListener('abort', rejectAbort, { once: true })
      })
    }
    /** 中文说明：测试局部值 handle，由紧邻初始化决定。 */
    const handle = testHandle(runtime(fake), spec(), '/runtime/stalled-preparation')
    await vi.waitFor(() => { expect(preparationSignal).toBeDefined() })

    handle.terminate()
    await expect(handle.done).resolves.toEqual({ exitCode: null, signal: 'SIGTERM' })
    await expect(handle.waitForExit()).resolves.toBe(true)
    expect(preparationSignal?.aborted).toBe(true)
    expect(fake.startOptions).toBeUndefined()
  })

  it('kills through the provisional SDK handle before process-group publication', async () => {
    /** 中文说明：测试局部值 fake，由紧邻初始化决定。 */
    const fake = new FakeSandbox()
    fake.deferProcessGroupRead()
    fake.signalErrors.push(commandError(1), commandError(1))
    /** 中文说明：测试局部值 handle，由紧邻初始化决定。 */
    const handle = testHandle(runtime(fake), spec(), '/runtime/pre-publication-kill')
    await vi.waitFor(() => { expect(fake.startOptions).toBeDefined() })

    handle.terminate()
    await vi.waitFor(() => { expect(fake.handle.kills).toBe(1) })
    expect(fake.alive).toBe(false)
    await expect(handle.waitForExit()).resolves.toBe(true)

    fake.releaseProcessGroupRead()
    await expect(handle.done).resolves.toEqual({ exitCode: null, signal: 'SIGKILL' })
  })

  it('does not treat an unsuccessful SDK fallback as provisional group quiescence', async () => {
    /** 中文说明：测试局部值 fake，由紧邻初始化决定。 */
    const fake = new FakeSandbox()
    fake.deferProcessGroupRead()
    fake.trapsTerm = true
    fake.delaysKill = true
    fake.delaysKillCompletion = true
    fake.sdkKillStops = false
    fake.handle.killResult = false
    /** 中文说明：测试局部值 handle，由紧邻初始化决定。 */
    const handle = testHandle(runtime(fake), spec({ graceMs: 1 }), '/runtime/provisional-sdk-false')
    await vi.waitFor(() => { expect(fake.startOptions).toBeDefined() })

    handle.terminate()
    await vi.waitFor(() => { expect(fake.handle.kills).toBe(1) })
    await expect(handle.waitForExit()).rejects.toThrow('remained live after force termination')
    fake.alive = false
    handle.terminate()
    await expect(handle.waitForExit()).resolves.toBe(true)
    fake.releaseProcessGroupRead()
    fake.finish()
    await handle.done
  })

  it('bounds a quiescence observer while provisional termination is awaiting the controller', async () => {
    /** 中文说明：测试局部值 fake，由紧邻初始化决定。 */
    const fake = new FakeSandbox()
    fake.deferProcessGroupRead()
    /** 中文说明：测试局部值 reconnect，由紧邻初始化决定。 */
    const reconnect = Promise.withResolvers<Sandbox>()
    /** 中文说明：测试局部值 calls，由紧邻初始化决定。 */
    let calls = 0
    /** 中文说明：测试局部值 delayedRuntime，由紧邻初始化决定。 */
    const delayedRuntime = runtime(fake, async () => {
      calls += 1
      return calls === 1 ? fake.sandbox : await reconnect.promise
    })
    /** 中文说明：测试局部值 handle，由紧邻初始化决定。 */
    const handle = testHandle(delayedRuntime, spec(), '/runtime/pre-publication-observer')
    await vi.waitFor(() => { expect(fake.startOptions).toBeDefined() })
    handle.terminate()

    /** 中文说明：测试局部值 controller，由紧邻初始化决定。 */
    const controller = new AbortController()
    /** 中文说明：测试局部值 waiting，由紧邻初始化决定。 */
    const waiting = handle.waitForExit(controller.signal)
    await flush()
    controller.abort()
    await expect(waiting).resolves.toBe(false)

    reconnect.resolve(fake.sandbox)
    await expect(handle.waitForExit()).resolves.toBe(true)
    fake.releaseProcessGroupRead()
    await handle.done
  })

  it('proves a provisional group exit when the SDK kill fallback fails', async () => {
    /** 中文说明：测试局部值 fake，由紧邻初始化决定。 */
    const fake = new FakeSandbox()
    fake.deferProcessGroupRead()
    fake.trapsTerm = true
    fake.handle.killError = new Error('SDK kill unavailable')
    /** 中文说明：测试局部值 handle，由紧邻初始化决定。 */
    const handle = testHandle(runtime(fake), spec({ graceMs: 1 }), '/runtime/pre-publication-group-kill')
    await vi.waitFor(() => { expect(fake.startOptions).toBeDefined() })

    handle.terminate()
    await expect(handle.waitForExit()).resolves.toBe(true)
    fake.releaseProcessGroupRead()
    await expect(handle.done).resolves.toEqual({ exitCode: null, signal: 'SIGKILL' })
  })

  it('reports failed provisional group and SDK force transports', async () => {
    /** 中文说明：测试局部值 fake，由紧邻初始化决定。 */
    const fake = new FakeSandbox()
    fake.deferProcessGroupRead()
    fake.signalErrors.push(new Error('TERM transport failed'), new Error('KILL transport failed'))
    fake.handle.killError = new Error('SDK kill failed')
    /** 中文说明：测试局部值 handle，由紧邻初始化决定。 */
    const handle = testHandle(runtime(fake), spec({ graceMs: 1 }), '/runtime/pre-publication-failure')
    await vi.waitFor(() => { expect(fake.startOptions).toBeDefined() })

    handle.terminate()
    await expect(handle.waitForExit()).rejects.toThrow('remained live after force termination')

    fake.handle.killError = undefined
    handle.terminate()
    await expect(handle.waitForExit()).resolves.toBe(true)
    fake.releaseProcessGroupRead()
    await handle.done

    /** 中文说明：测试局部值 absentGroup，由紧邻初始化决定。 */
    const absentGroup = new FakeSandbox()
    absentGroup.deferProcessGroupRead()
    absentGroup.signalErrors.push(commandError(1), commandError(1))
    absentGroup.handle.killError = new Error('SDK kill failed without a provisional group')
    /** 中文说明：测试局部值 absentHandle，由紧邻初始化决定。 */
    const absentHandle = testHandle(
      runtime(absentGroup),
      spec({ graceMs: 1 }),
      '/runtime/pre-publication-absent-group',
    )
    await vi.waitFor(() => { expect(absentGroup.startOptions).toBeDefined() })
    absentHandle.terminate()
    await expect(absentHandle.waitForExit()).rejects.toThrow('remained live after force termination')
    absentGroup.handle.killError = undefined
    absentHandle.terminate()
    await expect(absentHandle.waitForExit()).resolves.toBe(true)
    absentGroup.releaseProcessGroupRead()
    await absentHandle.done

    /** 中文说明：测试局部值 optimisticSdk，由紧邻初始化决定。 */
    const optimisticSdk = new FakeSandbox()
    optimisticSdk.deferProcessGroupRead()
    optimisticSdk.signalErrors.push(commandError(1), commandError(1))
    optimisticSdk.sdkKillStops = false
    /** 中文说明：测试局部值 optimisticHandle，由紧邻初始化决定。 */
    const optimisticHandle = testHandle(
      runtime(optimisticSdk),
      spec({ graceMs: 1 }),
      '/runtime/pre-publication-optimistic-sdk',
    )
    await vi.waitFor(() => { expect(optimisticSdk.startOptions).toBeDefined() })
    optimisticHandle.terminate()
    await expect(optimisticHandle.waitForExit()).rejects.toThrow('remained live after force termination')
    optimisticHandle.terminate()
    await expect(optimisticHandle.waitForExit()).resolves.toBe(true)
    optimisticSdk.releaseProcessGroupRead()
    await optimisticHandle.done
  })

  it('honors an already-aborted signal when constructing the asynchronous handle directly', async () => {
    /** 中文说明：测试局部值 fake，由紧邻初始化决定。 */
    const fake = new FakeSandbox()
    /** 中文说明：测试局部值 handle，由紧邻初始化决定。 */
    const handle = testHandle(runtime(fake), spec({ signal: AbortSignal.abort('stop') }), '/runtime/pre-aborted')
    await expect(handle.done).resolves.toEqual({ exitCode: null, signal: 'SIGTERM' })
  })

  it('reacts to a signal that aborts after the remote command has started', async () => {
    /** 中文说明：测试局部值 fake，由紧邻初始化决定。 */
    const fake = new FakeSandbox()
    /** 中文说明：测试局部值 controller，由紧邻初始化决定。 */
    const controller = new AbortController()
    /** 中文说明：测试局部值 handle，由紧邻初始化决定。 */
    const handle = testHandle(runtime(fake), spec({ signal: controller.signal }), '/runtime/live-abort')
    await flush()
    controller.abort('stop')
    await expect(handle.done).resolves.toEqual({ exitCode: null, signal: 'SIGTERM' })
  })

  it('can terminate a surviving process group after the command leader settles', async () => {
    /** 中文说明：测试局部值 fake，由紧邻初始化决定。 */
    const fake = new FakeSandbox()
    /** 中文说明：测试局部值 handle，由紧邻初始化决定。 */
    const handle = testHandle(runtime(fake), spec(), '/runtime/surviving-group')
    await flush()
    await fake.completeOutput()
    fake.handle.succeed(0)
    await expect(handle.done).resolves.toEqual({ exitCode: 0, signal: null })
    expect(fake.alive).toBe(true)

    handle.terminate()
    await flush()
    /** 中文说明：测试局部值 signaled，由紧邻初始化决定。 */
    const signaled = fake.commandsSeen.includes('kill -TERM -- -4242')
    if (!signaled) fake.finish()
    await expect(handle.waitForExit()).resolves.toBe(true)
    expect(signaled).toBe(true)
  })

  it('bounds waitForExit while startup or a live group is pending', async () => {
    /** 中文说明：测试局部值 fake，由紧邻初始化决定。 */
    const fake = new FakeSandbox()
    fake.deferStart()
    /** 中文说明：测试局部值 handle，由紧邻初始化决定。 */
    const handle = testHandle(runtime(fake), spec(), '/runtime/wait')
    /** 中文说明：测试局部值 beforeStart，由紧邻初始化决定。 */
    const beforeStart = new AbortController()
    /** 中文说明：测试局部值 pending，由紧邻初始化决定。 */
    const pending = handle.waitForExit(beforeStart.signal)
    beforeStart.abort()
    await expect(pending).resolves.toBe(false)
    await expect(handle.waitForExit(AbortSignal.abort())).resolves.toBe(false)
    fake.releaseStart()
    await flush()
    /** 中文说明：测试局部值 live，由紧邻初始化决定。 */
    const live = new AbortController()
    /** 中文说明：测试局部值 liveWait，由紧邻初始化决定。 */
    const liveWait = handle.waitForExit(live.signal)
    live.abort()
    await expect(liveWait).resolves.toBe(false)
    fake.finish()
    await handle.done

    /** 中文说明：测试局部值 terminatingFake，由紧邻初始化决定。 */
    const terminatingFake = new FakeSandbox()
    terminatingFake.deferStart()
    /** 中文说明：测试局部值 terminating，由紧邻初始化决定。 */
    const terminating = testHandle(runtime(terminatingFake), spec(), '/runtime/wait-termination-start')
    terminating.terminate()
    /** 中文说明：测试局部值 beforeHandle，由紧邻初始化决定。 */
    const beforeHandle = new AbortController()
    /** 中文说明：测试局部值 handlePending，由紧邻初始化决定。 */
    const handlePending = terminating.waitForExit(beforeHandle.signal)
    beforeHandle.abort()
    await expect(handlePending).resolves.toBe(false)
    terminatingFake.releaseStart()
    await terminating.done
  })

  it('bounds both sides of the liveness-poll abort race', async () => {
    /** 中文说明：测试局部值 fake，由紧邻初始化决定。 */
    const fake = new FakeSandbox()
    /** 中文说明：测试局部值 handle，由紧邻初始化决定。 */
    const handle = testHandle(runtime(fake), spec(), '/runtime/poll-abort')
    await flush()

    /** 中文说明：测试局部值 beforeTick，由紧邻初始化决定。 */
    const beforeTick = new AbortController()
    fake.afterProbe = () => { beforeTick.abort(); fake.afterProbe = undefined }
    await expect(handle.waitForExit(beforeTick.signal)).resolves.toBe(false)

    /** 中文说明：测试局部值 duringTick，由紧邻初始化决定。 */
    const duringTick = new AbortController()
    fake.afterProbe = () => {
      fake.afterProbe = undefined
      setTimeout(() => { duringTick.abort() }, 0)
    }
    await expect(handle.waitForExit(duringTick.signal)).resolves.toBe(false)

    /** 中文说明：测试局部值 duringProbe，由紧邻初始化决定。 */
    const duringProbe = new AbortController()
    fake.beforeProbe = () => { duringProbe.abort(); fake.beforeProbe = undefined }
    await expect(handle.waitForExit(duringProbe.signal)).resolves.toBe(false)

    /** 中文说明：测试局部值 racedAbort，由紧邻初始化决定。 */
    let racedAbort = false
    /** 中文说明：测试局部值 raceSignal，由紧邻初始化决定。 */
    const raceSignal = {
      get aborted() { return racedAbort },
      addEventListener: () => { racedAbort = true },
      removeEventListener: () => {},
    } as unknown as AbortSignal
    await expect(handle.waitForExit(raceSignal)).resolves.toBe(false)
    fake.finish()
    await handle.done
  })

  it('observes a live group across one successful bounded poll', async () => {
    /** 中文说明：测试局部值 fake，由紧邻初始化决定。 */
    const fake = new FakeSandbox()
    /** 中文说明：测试局部值 handle，由紧邻初始化决定。 */
    const handle = testHandle(runtime(fake), spec(), '/runtime/poll-success')
    await flush()
    setTimeout(() => { fake.finish() }, 1)
    await expect(handle.waitForExit(new AbortController().signal)).resolves.toBe(true)
    await handle.done
  })

  it('treats startup failure as no live tree and contains readiness rejection', async () => {
    /** 中文说明：测试局部值 fake，由紧邻初始化决定。 */
    const fake = new FakeSandbox()
    fake.backgroundError = new Error('start failed')
    /** 中文说明：测试局部值 handle，由紧邻初始化决定。 */
    const handle = testHandle(runtime(fake), spec(), '/runtime/fail')
    await expect(handle.done).rejects.toThrow('start failed')
    expect(handle.pid).toBe(-1)
    expect(fake.removed).toContain('/runtime/fail/environment')
    expect(fake.removed).toContain('/runtime/fail')
    await expect(handle.waitForExit()).resolves.toBe(true)
    handle.terminate()

    /** 中文说明：测试局部值 unavailableHandle，由紧邻初始化决定。 */
    const unavailableHandle = testHandle(
      runtime(new FakeSandbox(), async () => { throw new Error('sandbox unavailable') }),
      spec(),
      '/runtime/unavailable-start',
    )
    await expect(unavailableHandle.done).rejects.toThrow('sandbox unavailable')
    await expect(unavailableHandle.waitForExit()).resolves.toBe(true)

    /** 中文说明：测试局部值 envFailure，由紧邻初始化决定。 */
    const envFailure = new FakeSandbox()
    envFailure.envError = new Error('ambient lookup failed')
    /** 中文说明：测试局部值 envHandle，由紧邻初始化决定。 */
    const envHandle = testHandle(runtime(envFailure), spec(), '/runtime/env-failure')
    await expect(envHandle.done).rejects.toThrow('ambient lookup failed')
    expect(envFailure.removed).toEqual([])

    /** 中文说明：测试局部值 expectEnvironmentFailure，由紧邻初始化决定。 */
    const expectEnvironmentFailure = async (name: string, wire: string, message: string): Promise<void> => {
      /** 中文说明：测试局部值 fake，由紧邻初始化决定。 */
      const fake = new FakeSandbox()
      fake.environmentWire = wire
      /** 中文说明：测试局部值 failed，由紧邻初始化决定。 */
      const failed = testHandle(runtime(fake), spec(), `/runtime/${name}`)
      await expect(failed.done).rejects.toThrow(message)
    }
    /** 中文说明：测试局部值 encodedEnvironment，由紧邻初始化决定。 */
    const encodedEnvironment = Buffer.from('PATH=/bin\0').toString('base64')
    /** 中文说明：测试局部值 encodedHome，由紧邻初始化决定。 */
    const encodedHome = Buffer.from('/home/user').toString('base64')
    await expectEnvironmentFailure('malformed-frame', '%', 'invalid base64')
    await expectEnvironmentFailure('malformed-base64', `${encodedHome}\n%`, 'invalid base64')
    await expectEnvironmentFailure(
      'invalid-utf8-home',
      `${Buffer.from([0xff]).toString('base64')}\n${encodedEnvironment}`,
      'not valid UTF-8',
    )
    await expectEnvironmentFailure(
      'invalid-utf8-environment',
      `${encodedHome}\n${Buffer.from([0xff]).toString('base64')}`,
      'not valid UTF-8',
    )
    await expectEnvironmentFailure(
      'relative-home',
      `${Buffer.from('home/user').toString('base64')}\n${encodedEnvironment}`,
      'remote login home is invalid',
    )
    await expectEnvironmentFailure(
      'nul-home',
      `${Buffer.from('/home/user\0tail').toString('base64')}\n${encodedEnvironment}`,
      'remote login home is invalid',
    )

    /** 中文说明：测试局部值 cleanupFailure，由紧邻初始化决定。 */
    const cleanupFailure = new FakeSandbox()
    cleanupFailure.backgroundError = new Error('start failed before credential consumption')
    cleanupFailure.nextRemoveError = new Error('credential cleanup failed')
    /** 中文说明：测试局部值 cleanupHandle，由紧邻初始化决定。 */
    const cleanupHandle = testHandle(runtime(cleanupFailure), spec(), '/runtime/cleanup-failure')
    await expect(cleanupHandle.done).rejects.toThrow('command failed and private state cleanup failed')

    /** 中文说明：测试局部值 absentState，由紧邻初始化决定。 */
    const absentState = new FakeSandbox()
    absentState.backgroundError = new Error('start failed after external cleanup')
    absentState.nextRemoveError = new FileNotFoundError('already removed')
    /** 中文说明：测试局部值 absentHandle，由紧邻初始化决定。 */
    const absentHandle = testHandle(runtime(absentState), spec(), '/runtime/absent-state')
    await expect(absentHandle.done).rejects.toThrow('start failed after external cleanup')
  })

  it('bounds a readiness rejection with a still-live caller signal', async () => {
    /** 中文说明：测试局部值 fake，由紧邻初始化决定。 */
    const fake = new FakeSandbox()
    fake.deferStart()
    fake.backgroundError = new Error('start failed')
    /** 中文说明：测试局部值 handle，由紧邻初始化决定。 */
    const handle = testHandle(runtime(fake), spec(), '/runtime/fail-with-signal')
    /** 中文说明：测试局部值 waiting，由紧邻初始化决定。 */
    const waiting = handle.waitForExit(new AbortController().signal)
    fake.releaseStart()
    await expect(handle.done).rejects.toThrow('start failed')
    await expect(waiting).resolves.toBe(true)
  })

  it('propagates an unavailable sandbox unless the caller aborts the wait', async () => {
    /** 中文说明：测试局部值 fake，由紧邻初始化决定。 */
    const fake = new FakeSandbox()
    /** 中文说明：测试局部值 calls，由紧邻初始化决定。 */
    let calls = 0
    /** 中文说明：测试局部值 unavailable，由紧邻初始化决定。 */
    const unavailable = runtime(fake, async () => {
      calls += 1
      if (calls === 1) return fake.sandbox
      throw new Error('connection unavailable')
    })
    /** 中文说明：测试局部值 handle，由紧邻初始化决定。 */
    const handle = testHandle(unavailable, spec(), '/runtime/unavailable')
    await flush()
    await expect(handle.waitForExit()).rejects.toThrow('connection unavailable')
    fake.finish()
    await handle.done
  })

  it('returns false when the caller aborts while reconnecting for liveness', async () => {
    /** 中文说明：测试局部值 fake，由紧邻初始化决定。 */
    const fake = new FakeSandbox()
    /** 中文说明：测试局部值 reconnect，由紧邻初始化决定。 */
    const reconnect = Promise.withResolvers<Sandbox>()
    /** 中文说明：测试局部值 calls，由紧邻初始化决定。 */
    let calls = 0
    /** 中文说明：测试局部值 unavailable，由紧邻初始化决定。 */
    const unavailable = runtime(fake, async () => {
      calls += 1
      return calls === 1 ? fake.sandbox : await reconnect.promise
    })
    /** 中文说明：测试局部值 handle，由紧邻初始化决定。 */
    const handle = testHandle(unavailable, spec(), '/runtime/reconnect-abort')
    await flush()
    /** 中文说明：测试局部值 controller，由紧邻初始化决定。 */
    const controller = new AbortController()
    /** 中文说明：测试局部值 waiting，由紧邻初始化决定。 */
    const waiting = handle.waitForExit(controller.signal)
    await flush()
    controller.abort()
    reconnect.reject(new Error('connection unavailable'))
    await expect(waiting).resolves.toBe(false)
    fake.finish()
    await handle.done
  })

  it('returns false when a liveness request itself is aborted and surfaces other probe failures', async () => {
    /** 中文说明：测试局部值 fake，由紧邻初始化决定。 */
    const fake = new FakeSandbox()
    /** 中文说明：测试局部值 handle，由紧邻初始化决定。 */
    const handle = testHandle(runtime(fake), spec(), '/runtime/probe')
    await flush()
    /** 中文说明：测试局部值 controller，由紧邻初始化决定。 */
    const controller = new AbortController()
    controller.abort()
    await expect(handle.waitForExit(controller.signal)).resolves.toBe(false)
    fake.probeError = new Error('probe failed')
    await expect(handle.waitForExit()).rejects.toThrow('probe failed')
    fake.finish()
    await handle.done
  })

  it('treats a timeout-killed sandbox as quiescent during liveness probing', async () => {
    /** 中文说明：测试局部值 fake，由紧邻初始化决定。 */
    const fake = new FakeSandbox()
    /** 中文说明：测试局部值 handle，由紧邻初始化决定。 */
    const handle = testHandle(runtime(fake), spec(), '/runtime/expired-sandbox')
    await flush()
    fake.finish()
    await handle.done
    fake.probeError = new SandboxNotFoundError('sandbox expired')

    await expect(handle.waitForExit()).resolves.toBe(true)
  })

  it('treats a missing sandbox handle as quiescent during liveness acquisition', async () => {
    /** 中文说明：测试局部值 fake，由紧邻初始化决定。 */
    const fake = new FakeSandbox()
    /** 中文说明：测试局部值 calls，由紧邻初始化决定。 */
    let calls = 0
    /** 中文说明：测试局部值 handle，由紧邻初始化决定。 */
    const handle = testHandle(runtime(fake, async () => {
      calls += 1
      if (calls === 1) return fake.sandbox
      throw new SandboxNotFoundError('sandbox expired')
    }), spec(), '/runtime/expired-acquisition')
    await flush()

    await expect(handle.waitForExit()).resolves.toBe(true)
    await fake.completeOutput()
    fake.alive = false
    fake.handle.succeed(0)
    await handle.done
  })

  it('treats sandbox loss during termination as quiescent', async () => {
    /** 中文说明：测试局部值 fake，由紧邻初始化决定。 */
    const fake = new FakeSandbox()
    /** 中文说明：测试局部值 calls，由紧邻初始化决定。 */
    let calls = 0
    /** 中文说明：测试局部值 handle，由紧邻初始化决定。 */
    const handle = testHandle(runtime(fake, async () => {
      calls += 1
      if (calls === 1) return fake.sandbox
      throw new SandboxNotFoundError('sandbox expired')
    }), spec(), '/runtime/expired-termination')
    await flush()
    await fake.completeOutput()

    handle.terminate()
    await expect(handle.waitForExit()).resolves.toBe(true)
    fake.alive = false
    fake.handle.succeed(0)
    await handle.done
  })

  it('makes batch stdin close failures best-effort', async () => {
    /** 中文说明：测试局部值 fake，由紧邻初始化决定。 */
    const fake = new FakeSandbox()
    vi.spyOn(fake.handle, 'sendStdin').mockRejectedValueOnce(new Error('closed'))
    /** 中文说明：测试局部值 handle，由紧邻初始化决定。 */
    const handle = testHandle(runtime(fake), spec({
      stdio: { stdin: { data: 'ignored' }, stdout: { maxBytes: 4 }, stderr: { maxBytes: 4 } },
    }), '/runtime/stdin-closed')
    await flush()
    fake.finish()
    await expect(handle.done).resolves.toEqual({ exitCode: 0, signal: null })
  })

  it('rejects malformed SDK process ids and non-command settlement failures', async () => {
    /** 中文说明：测试局部值 invalidPid，由紧邻初始化决定。 */
    const invalidPid = new FakeSandbox()
    invalidPid.handle.pid = 0
    /** 中文说明：测试局部值 invalid，由紧邻初始化决定。 */
    const invalid = testHandle(runtime(invalidPid), spec(), '/runtime/invalid-pid')
    await expect(invalid.done).rejects.toThrow(/invalid command pid 0/)
    expect(invalidPid.handle.kills).toBe(1)
    expect(invalidPid.removed).toContain('/runtime/invalid-pid/environment')
    await expect(invalid.waitForExit()).resolves.toBe(true)

    /** 中文说明：测试局部值 failedRollback，由紧邻初始化决定。 */
    const failedRollback = new FakeSandbox()
    failedRollback.handle.pid = 0
    failedRollback.handle.killError = new Error('invalid handle kill failed')
    /** 中文说明：测试局部值 retained，由紧邻初始化决定。 */
    const retained = testHandle(runtime(failedRollback), spec(), '/runtime/invalid-pid-retained')
    await expect(retained.done).rejects.toThrow('invalid command pid rollback did not reach quiescence')
    await expect(retained.waitForExit()).rejects.toThrow('invalid handle kill failed')
    failedRollback.handle.killError = undefined
    retained.terminate()
    await expect(retained.waitForExit()).resolves.toBe(true)

    /** 中文说明：测试局部值 crashedFake，由紧邻初始化决定。 */
    const crashedFake = new FakeSandbox()
    /** 中文说明：测试局部值 crashed，由紧邻初始化决定。 */
    const crashed = testHandle(runtime(crashedFake), spec(), '/runtime/crashed')
    await flush()
    crashedFake.alive = false
    crashedFake.handle.crash(new Error('command transport failed'))
    await expect(crashed.done).rejects.toThrow('command transport failed')
  })

  it('rejects invalid or absent process-group publication', async () => {
    /** 中文说明：测试局部值 invalidGroup，由紧邻初始化决定。 */
    const invalidGroup = new FakeSandbox()
    invalidGroup.processGroupId = 'not-a-pid\n'
    invalidGroup.delaysKill = true
    invalidGroup.sdkKillStops = false
    invalidGroup.afterProbe = () => { invalidGroup.alive = false }
    /** 中文说明：测试局部值 invalid，由紧邻初始化决定。 */
    const invalid = testHandle(runtime(invalidGroup), spec(), '/runtime/invalid-group')
    await expect(invalid.done).rejects.toThrow(/invalid process-group id/)
    expect(invalidGroup.handle.kills).toBe(1)
    expect(invalidGroup.commandsSeen).toContain('kill -KILL -- -4242')
    await expect(invalid.waitForExit()).resolves.toBe(true)

    // A rewritten pid file must not aim the kill at every process (`-- -1`).
    /** 中文说明：测试局部值 unsafeGroup，由紧邻初始化决定。 */
    const unsafeGroup = new FakeSandbox()
    unsafeGroup.processGroupId = '1\n'
    unsafeGroup.delaysKill = true
    unsafeGroup.sdkKillStops = false
    unsafeGroup.afterProbe = () => { unsafeGroup.alive = false }
    /** 中文说明：测试局部值 unsafe，由紧邻初始化决定。 */
    const unsafe = testHandle(runtime(unsafeGroup), spec(), '/runtime/unsafe-group')
    await expect(unsafe.done).rejects.toThrow(/unsafe published process-group id 1/)
    expect(unsafeGroup.commandsSeen).not.toContain('kill -KILL -- -1')
    await expect(unsafe.waitForExit()).resolves.toBe(true)

    /** 中文说明：测试局部值 absentGroup，由紧邻初始化决定。 */
    const absentGroup = new FakeSandbox()
    absentGroup.processGroupId = ''
    /** 中文说明：测试局部值 absent，由紧邻初始化决定。 */
    const absent = testHandle(runtime(absentGroup), spec(), '/runtime/absent-group')
    await flush()
    absentGroup.finish()
    await expect(absent.done).rejects.toThrow(/exited before publishing/)
    expect(absentGroup.handle.kills).toBe(1)
    expect(absentGroup.commandsSeen).toContain('kill -KILL -- -4242')
    await expect(absent.waitForExit()).resolves.toBe(true)
  })

  it('preserves publication failure and reports cleanup that cannot be verified', async () => {
    /** 中文说明：测试局部值 fake，由紧邻初始化决定。 */
    const fake = new FakeSandbox()
    fake.processGroupId = 'not-a-pid\n'
    fake.signalError = new Error('rollback signal failed')
    fake.handle.killError = new Error('SDK kill failed')
    /** 中文说明：测试局部值 handle，由紧邻初始化决定。 */
    const handle = testHandle(runtime(fake), spec(), '/runtime/failed-rollback')

    /** 中文说明：测试局部值 failure: unknown，由紧邻初始化决定。 */
    let failure: unknown
    try {
      await handle.done
    } catch (error: unknown) {
      failure = error
    }
    expect(failure).toBeInstanceOf(AggregateError)
    if (!(failure instanceof AggregateError)) throw new Error('expected AggregateError')
    expect(failure.message).toBe('subprocess-e2b: process-group publication failed and rollback did not reach quiescence')
    /** 中文说明：测试局部值 failures，由紧邻初始化决定。 */
    const failures = Array.from(failure.errors as Iterable<unknown>)
    expect(failures).toHaveLength(2)
    expect(failures[0]).toBeInstanceOf(Error)
    expect(failures[1]).toBeInstanceOf(Error)
    if (!(failures[0] instanceof Error) || !(failures[1] instanceof Error)) throw new Error('expected nested errors')
    expect(failures[0].message).toContain('invalid process-group id')
    expect(failures[1].message).toContain('remained live after force termination')
    expect(fake.handle.kills).toBe(1)
    /** 中文说明：测试局部值 bounded，由紧邻初始化决定。 */
    const bounded = new AbortController()
    /** 中文说明：测试局部值 waiting，由紧邻初始化决定。 */
    const waiting = handle.waitForExit(bounded.signal)
    bounded.abort()
    await expect(waiting).resolves.toBe(false)
    handle.terminate()
    await expect(handle.waitForExit()).resolves.toBe(true)
    expect(fake.commandsSeen).toContain('kill -TERM -- -4242')

    /** 中文说明：测试局部值 naturallyGone，由紧邻初始化决定。 */
    const naturallyGone = new FakeSandbox()
    naturallyGone.processGroupId = 'not-a-pid\n'
    naturallyGone.signalError = new Error('rollback signal failed')
    naturallyGone.handle.killError = new Error('SDK kill failed')
    /** 中文说明：测试局部值 observed，由紧邻初始化决定。 */
    const observed = testHandle(runtime(naturallyGone), spec(), '/runtime/failed-rollback-observed')
    await expect(observed.done).rejects.toThrow('process-group publication failed')
    naturallyGone.alive = false
    await expect(observed.waitForExit()).resolves.toBe(true)
  })

  it('waits for delayed process-group publication', async () => {
    /** 中文说明：测试局部值 fake，由紧邻初始化决定。 */
    const fake = new FakeSandbox()
    fake.processGroupReads.push('', '4242\n')
    /** 中文说明：测试局部值 handle，由紧邻初始化决定。 */
    const handle = testHandle(runtime(fake), spec(), '/runtime/delayed-group')
    await vi.waitFor(() => { expect(handle.pid).toBe(4242) })
    fake.finish()
    await expect(handle.done).resolves.toEqual({ exitCode: 0, signal: null })
  })

  it('handles output backpressure and contains a stderr sink failure', async () => {
    /** 中文说明：测试局部值 fake，由紧邻初始化决定。 */
    const fake = new FakeSandbox()
    /** 中文说明：测试局部值 handle，由紧邻初始化决定。 */
    const handle = testHandle(runtime(fake), spec({
      stdio: { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' },
    }), '/runtime/backpressure')
    await flush()

    handle.stdout!.on('error', () => {})
    /** 中文说明：测试局部值 stdoutWrite，由紧邻初始化决定。 */
    const stdoutWrite = vi.spyOn(handle.stdout!, 'write').mockReturnValueOnce(false)
    /** 中文说明：测试局部值 stdoutPending，由紧邻初始化决定。 */
    const stdoutPending = fake.stdout('blocked')
    queueMicrotask(() => { handle.stdout!.emit('drain') })
    await stdoutPending
    stdoutWrite.mockRestore()

    handle.stderr!.on('error', () => {})
    /** 中文说明：测试局部值 stderrWrite，由紧邻初始化决定。 */
    const stderrWrite = vi.spyOn(handle.stderr!, 'write').mockReturnValueOnce(false)
    /** 中文说明：测试局部值 stderrPending，由紧邻初始化决定。 */
    const stderrPending = fake.stderr('broken')
    queueMicrotask(() => { handle.stderr!.emit('error', new Error('sink failed')) })
    await stderrPending
    stderrWrite.mockRestore()

    fake.finish()
    await expect(handle.done).resolves.toEqual({ exitCode: 0, signal: null })
  })

  it('settles output backpressure when the consumer closes the pipe', async () => {
    /** 中文说明：测试局部值 fake，由紧邻初始化决定。 */
    const fake = new FakeSandbox()
    /** 中文说明：测试局部值 handle，由紧邻初始化决定。 */
    const handle = testHandle(runtime(fake), spec({
      stdio: { stdin: 'ignore', stdout: 'pipe', stderr: { maxBytes: 4 } },
    }), '/runtime/backpressure-close')
    await flush()

    /** 中文说明：测试局部值 stdoutWrite，由紧邻初始化决定。 */
    const stdoutWrite = vi.spyOn(handle.stdout!, 'write').mockReturnValueOnce(false)
    /** 中文说明：测试局部值 pending，由紧邻初始化决定。 */
    const pending = fake.stdout('discarded')
    queueMicrotask(() => { handle.stdout!.destroy() })
    await pending
    stdoutWrite.mockRestore()

    fake.finish()
    await expect(handle.done).resolves.toEqual({ exitCode: 0, signal: null })
  })

  it('breaks output backpressure when termination owns the command', async () => {
    /** 中文说明：测试局部值 fake，由紧邻初始化决定。 */
    const fake = new FakeSandbox()
    /** 中文说明：测试局部值 handle，由紧邻初始化决定。 */
    const handle = testHandle(runtime(fake), spec({
      stdio: { stdin: 'ignore', stdout: 'pipe', stderr: { maxBytes: 4 } },
    }), '/runtime/backpressure-termination')
    await flush()

    /** 中文说明：测试局部值 stdoutWrite，由紧邻初始化决定。 */
    const stdoutWrite = vi.spyOn(handle.stdout!, 'write').mockReturnValueOnce(false)
    /** 中文说明：测试局部值 released，由紧邻初始化决定。 */
    let released = false
    /** 中文说明：测试局部值 pending，由紧邻初始化决定。 */
    const pending = fake.stdout('blocked').then(() => { released = true })
    await Promise.resolve()
    handle.terminate()
    await flush()
    /** 中文说明：测试局部值 releasedByTermination，由紧邻初始化决定。 */
    const releasedByTermination = released
    if (!released) handle.stdout!.emit('drain')
    await pending
    stdoutWrite.mockRestore()
    await handle.done

    expect(releasedByTermination).toBe(true)
  })

  it('settles backpressure when a synchronous pipe write starts termination', async () => {
    /** 中文说明：测试局部值 fake，由紧邻初始化决定。 */
    const fake = new FakeSandbox()
    /** 中文说明：测试局部值 handle，由紧邻初始化决定。 */
    const handle = testHandle(runtime(fake), spec({
      stdio: { stdin: 'ignore', stdout: 'pipe', stderr: { maxBytes: 4 } },
    }), '/runtime/backpressure-synchronous-termination')
    await flush()

    /** 中文说明：测试局部值 stdoutWrite，由紧邻初始化决定。 */
    const stdoutWrite = vi.spyOn(handle.stdout!, 'write').mockImplementationOnce(() => {
      handle.terminate()
      return false
    })
    await expect(fake.stdout('blocked')).resolves.toBeUndefined()
    stdoutWrite.mockRestore()
    await handle.done
  })

  it('contains a pipe callback failure instead of rejecting command settlement', async () => {
    /** 中文说明：测试局部值 fake，由紧邻初始化决定。 */
    const fake = new FakeSandbox()
    /** 中文说明：测试局部值 handle，由紧邻初始化决定。 */
    const handle = testHandle(runtime(fake), spec({
      stdio: { stdin: 'ignore', stdout: 'pipe', stderr: { maxBytes: 4 } },
    }), '/runtime/pipe-error')
    await flush()
    /** 中文说明：测试局部值 emitted，由紧邻初始化决定。 */
    const emitted = once(handle.stdout!, 'error')
    handle.stdout!.destroy(new Error('consumer failed'))
    await emitted
    await fake.stdout('late output')
    fake.finish()
    await expect(handle.done).resolves.toEqual({ exitCode: 0, signal: null })
  })

  it('contains an already-gone group signal and escalates after a TERM transport failure', async () => {
    /** 中文说明：测试局部值 gone，由紧邻初始化决定。 */
    const gone = new FakeSandbox()
    gone.trapsTerm = true
    gone.signalError = commandError(1)
    /** 中文说明：测试局部值 goneHandle，由紧邻初始化决定。 */
    const goneHandle = testHandle(runtime(gone), spec({ graceMs: 1 }), '/runtime/gone-signal')
    await flush()
    goneHandle.terminate()
    await expect(goneHandle.done).resolves.toEqual({ exitCode: null, signal: 'SIGKILL' })

    /** 中文说明：测试局部值 failed，由紧邻初始化决定。 */
    const failed = new FakeSandbox()
    failed.signalError = new Error('signal transport failed')
    /** 中文说明：测试局部值 failedHandle，由紧邻初始化决定。 */
    const failedHandle = testHandle(runtime(failed), spec(), '/runtime/failed-signal')
    await flush()
    failedHandle.terminate()
    await expect(failedHandle.done).resolves.toEqual({ exitCode: null, signal: 'SIGKILL' })
    expect(failed.commandsSeen).toContain('kill -KILL -- -4242')
  })

  it('allows termination retry after both force transports fail', async () => {
    /** 中文说明：测试局部值 fake，由紧邻初始化决定。 */
    const fake = new FakeSandbox()
    fake.signalErrors.push(new Error('TERM transport failed'), new Error('KILL transport failed'))
    fake.handle.killError = new Error('SDK kill failed')
    /** 中文说明：测试局部值 handle，由紧邻初始化决定。 */
    const handle = testHandle(runtime(fake), spec({ graceMs: 1 }), '/runtime/retry-signal')
    await flush()

    handle.terminate()
    await expect(handle.waitForExit()).rejects.toThrow('remained live after force termination')
    fake.handle.killError = undefined
    handle.terminate()
    await expect(handle.done).resolves.toEqual({ exitCode: null, signal: 'SIGTERM' })
    expect(fake.commandsSeen.filter(command => command.startsWith('kill -TERM '))).toHaveLength(2)

    /** 中文说明：测试局部值 missingGroup，由紧邻初始化决定。 */
    const missingGroup = new FakeSandbox()
    missingGroup.trapsTerm = true
    missingGroup.signalErrors.push(undefined, commandError(1))
    missingGroup.handle.killError = new Error('SDK kill failed after group exit race')
    /** 中文说明：测试局部值 raced，由紧邻初始化决定。 */
    const raced = testHandle(runtime(missingGroup), spec({ graceMs: 1 }), '/runtime/group-exit-race')
    await flush()
    raced.terminate()
    await expect(raced.waitForExit()).rejects.toThrow('remained live after force termination')
    missingGroup.handle.killError = undefined
    raced.terminate()
    await expect(raced.waitForExit()).resolves.toBe(true)
  })

  it('rejects an optimistic SDK kill while descendants survive a failed group KILL', async () => {
    /** 中文说明：测试局部值 fake，由紧邻初始化决定。 */
    const fake = new FakeSandbox()
    fake.trapsTerm = true
    fake.sdkKillStops = false
    fake.signalErrors.push(undefined, new Error('KILL transport failed'))
    /** 中文说明：测试局部值 handle，由紧邻初始化决定。 */
    const handle = testHandle(runtime(fake), spec({ graceMs: 1 }), '/runtime/optimistic-sdk-kill')
    await flush()

    handle.terminate()
    await expect(handle.waitForExit()).rejects.toThrow('remained live after force termination')
    expect(fake.alive).toBe(true)

    fake.sdkKillStops = true
    handle.terminate()
    await expect(handle.waitForExit()).resolves.toBe(true)
    await expect(handle.done).resolves.toEqual({ exitCode: null, signal: 'SIGKILL' })
  })
})

describe('E2BSubprocessRuntime', () => {
  /** 中文说明：函数 service 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
  async function service(
    fake = new FakeSandbox(),
    providedRuntime: E2BRuntime = runtime(fake),
  ): Promise<{ ctx: Context; fiber: Awaited<ReturnType<Context['plugin']>> }> {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    ctx.provide('e2b', providedRuntime)
    /** 中文说明：测试局部值 fiber，由紧邻初始化决定。 */
    const fiber = await ctx.plugin(E2BSubprocessRuntime)
    return { ctx, fiber }
  }

  it('registers handles and disposal terminates and joins live remote groups regardless of sandbox policy', async () => {
    /** 中文说明：测试局部值 fake，由紧邻初始化决定。 */
    const fake = new FakeSandbox()
    fake.trapsTerm = true
    /** 中文说明：测试局部值 { ctx, fiber }，由紧邻初始化决定。 */
    const { ctx, fiber } = await service(fake)
    /** 中文说明：测试局部值 handle，由紧邻初始化决定。 */
    const handle = ctx.subprocess.spawn(spec({ graceMs: 1 }))
    await flush()
    await fiber.dispose()
    await expect(handle.done).resolves.toEqual({ exitCode: null, signal: 'SIGKILL' })
    expect(fake.alive).toBe(false)
  })

  it('awaits SDK settlement after the remote process group becomes quiescent', async () => {
    /** 中文说明：测试局部值 fake，由紧邻初始化决定。 */
    const fake = new FakeSandbox()
    fake.trapsTerm = true
    /** 中文说明：测试局部值 { ctx, fiber }，由紧邻初始化决定。 */
    const { ctx, fiber } = await service(fake)
    /** 中文说明：测试局部值 handle，由紧邻初始化决定。 */
    const handle = ctx.subprocess.spawn(spec())
    await flush()
    fake.alive = false

    /** 中文说明：测试局部值 disposed，由紧邻初始化决定。 */
    let disposed = false
    /** 中文说明：测试局部值 disposing，由紧邻初始化决定。 */
    const disposing = fiber.dispose().then(() => { disposed = true })
    await flush()
    expect(disposed).toBe(false)

    fake.finish()
    await disposing
    await expect(handle.done).resolves.toEqual({ exitCode: 0, signal: null })
  })

  it('reports a failed termination transaction from disposal instead of waiting on done', async () => {
    /** 中文说明：测试局部值 fake，由紧邻初始化决定。 */
    const fake = new FakeSandbox()
    fake.signalErrors.push(new Error('TERM transport failed'), new Error('KILL transport failed'))
    fake.handle.killError = new Error('SDK kill failed')
    /** 中文说明：测试局部值 { ctx, fiber }，由紧邻初始化决定。 */
    const { ctx, fiber } = await service(fake)
    /** 中文说明：测试局部值 handle，由紧邻初始化决定。 */
    const handle = ctx.subprocess.spawn(spec({ graceMs: 1 }))
    await flush()

    await expect(fiber.dispose()).resolves.toBeUndefined()
    await expect(handle.waitForExit()).rejects.toThrow('remained live after force termination')

    fake.handle.killError = undefined
    handle.terminate()
    await expect(handle.waitForExit()).resolves.toBe(true)
    await expect(handle.done).resolves.toEqual({ exitCode: null, signal: 'SIGTERM' })
  })

  it('aggregates sibling cleanup failures instead of reporting only the first', async () => {
    /** 中文说明：测试局部值 { ctx, fiber }，由紧邻初始化决定。 */
    const { ctx, fiber } = await service()
    /** 中文说明：测试局部值 disposalErrors，由紧邻初始化决定。 */
    const disposalErrors: unknown[] = []
    ctx.logger.error = ((error: unknown) => { disposalErrors.push(error) }) as typeof ctx.logger.error
    /** 中文说明：测试局部值 first，由紧邻初始化决定。 */
    const first = {
      terminate: vi.fn(),
      waitForExit: vi.fn(async () => { throw new Error('first cleanup failed') }),
      done: Promise.resolve({ exitCode: 0, signal: null }),
    } as unknown as E2BSubprocessHandle
    /** 中文说明：测试局部值 second，由紧邻初始化决定。 */
    const second = {
      terminate: vi.fn(),
      waitForExit: vi.fn(async () => { throw new Error('second cleanup failed') }),
      done: Promise.resolve({ exitCode: 0, signal: null }),
    } as unknown as E2BSubprocessHandle
    /** 中文说明：测试局部值 live，由紧邻初始化决定。 */
    const live = (ctx.subprocess as unknown as { live: Set<E2BSubprocessHandle> }).live
    live.add(first)
    live.add(second)

    await fiber.dispose()
    /** 中文说明：测试局部值 failure，由紧邻初始化决定。 */
    const failure = disposalErrors[0]
    expect(failure).toBeInstanceOf(AggregateError)
    if (!(failure instanceof AggregateError)) throw new Error('expected AggregateError')
    expect(failure.errors.map(error => (error as Error).message).sort()).toEqual([
      'first cleanup failed',
      'second cleanup failed',
    ])
  })

  it('waits for every owned cleanup before reporting a disposal failure', async () => {
    /** 中文说明：测试局部值 { ctx, fiber }，由紧邻初始化决定。 */
    const { ctx, fiber } = await service()
    /** 中文说明：测试局部值 failed，由紧邻初始化决定。 */
    const failed = {
      terminate: vi.fn(),
      waitForExit: vi.fn(async () => { throw new Error('cleanup failed') }),
      done: Promise.resolve({ exitCode: 0, signal: null }),
    } as unknown as E2BSubprocessHandle
    /** 中文说明：测试局部值 finishCleanup，由紧邻初始化决定。 */
    let finishCleanup!: () => void
    /** 中文说明：测试局部值 cleanup，由紧邻初始化决定。 */
    const cleanup = new Promise<boolean>((resolve) => {
      finishCleanup = () => { resolve(true) }
    })
    /** 中文说明：测试局部值 draining，由紧邻初始化决定。 */
    const draining = {
      terminate: vi.fn(),
      waitForExit: vi.fn(() => cleanup),
      done: Promise.resolve({ exitCode: 0, signal: null }),
    } as unknown as E2BSubprocessHandle
    /** 中文说明：测试局部值 live，由紧邻初始化决定。 */
    const live = (ctx.subprocess as unknown as { live: Set<E2BSubprocessHandle> }).live
    live.add(failed)
    live.add(draining)

    /** 中文说明：测试局部值 disposed，由紧邻初始化决定。 */
    let disposed = false
    /** 中文说明：测试局部值 disposing，由紧邻初始化决定。 */
    const disposing = fiber.dispose().then(() => { disposed = true })
    await flush()
    expect(disposed).toBe(false)
    finishCleanup()
    await disposing
    expect(live).toEqual(new Set([failed]))
  })

  it('releases naturally settled handles before later service disposal', async () => {
    /** 中文说明：测试局部值 fake，由紧邻初始化决定。 */
    const fake = new FakeSandbox()
    /** 中文说明：测试局部值 { ctx, fiber }，由紧邻初始化决定。 */
    const { ctx, fiber } = await service(fake)
    /** 中文说明：测试局部值 handle，由紧邻初始化决定。 */
    const handle = ctx.subprocess.spawn(spec())
    await flush()
    fake.finish()
    await handle.done
    await flush()
    /** 中文说明：测试局部值 signalsBefore，由紧邻初始化决定。 */
    const signalsBefore = fake.commandsSeen.filter(command => command.startsWith('kill -')).length
    await fiber.dispose()
    expect(fake.commandsSeen.filter(command => command.startsWith('kill -')).length).toBe(signalsBefore)
  })

  it('contains a release liveness failure and retries quiescence during disposal', async () => {
    /** 中文说明：测试局部值 fake，由紧邻初始化决定。 */
    const fake = new FakeSandbox()
    /** 中文说明：测试局部值 calls，由紧邻初始化决定。 */
    let calls = 0
    /** 中文说明：测试局部值 reconnecting，由紧邻初始化决定。 */
    const reconnecting = runtime(fake, async () => {
      calls += 1
      if (calls === 2) throw new Error('transient liveness failure')
      return fake.sandbox
    })
    /** 中文说明：测试局部值 { ctx, fiber }，由紧邻初始化决定。 */
    const { ctx, fiber } = await service(fake, reconnecting)
    /** 中文说明：测试局部值 handle，由紧邻初始化决定。 */
    const handle = ctx.subprocess.spawn(spec())
    await flush()
    fake.finish()
    await handle.done
    await flush()
    await fiber.dispose()
    expect(calls).toBeGreaterThanOrEqual(3)
  })

  it('contains spawn rejection while disposal is joining the pending handle', async () => {
    /** 中文说明：测试局部值 fake，由紧邻初始化决定。 */
    const fake = new FakeSandbox()
    fake.deferStart()
    fake.backgroundError = new Error('start failed during disposal')
    /** 中文说明：测试局部值 { ctx, fiber }，由紧邻初始化决定。 */
    const { ctx, fiber } = await service(fake)
    /** 中文说明：测试局部值 subprocess，由紧邻初始化决定。 */
    const subprocess = ctx.subprocess
    /** 中文说明：测试局部值 handle，由紧邻初始化决定。 */
    const handle = subprocess.spawn(spec())
    await vi.waitFor(() => { expect(fake.startOptions).toBeDefined() })
    /** 中文说明：测试局部值 disposing，由紧邻初始化决定。 */
    const disposing = fiber.dispose()
    await flush()
    expect(() => subprocess.spawn(spec())).toThrow('service is disposing')
    fake.releaseStart()
    await expect(disposing).resolves.toBeUndefined()
    await expect(handle.done).rejects.toThrow('start failed during disposal')
  })

  it('validates synchronous spawn preconditions', async () => {
    /** 中文说明：测试局部值 { ctx }，由紧邻初始化决定。 */
    const { ctx } = await service()
    expect(() => ctx.subprocess.spawn(spec({ argv: [] }))).toThrow(/non-empty program/)
    expect(() => ctx.subprocess.spawn(spec({ signal: AbortSignal.abort('stop') }))).toThrow(/aborted before spawn/)
  })
})
