/**
 * 文件职责：验证E2B 远程沙箱的 terminal.spec.ts 行为与边界。
 * 技术维度：TypeScript、Cordis、异步资源生命周期、远程文件/进程接口和 Vitest。
 * 产品维度：保证E2B 远程沙箱在真实组装、失败和清理场景中可靠。
 * 逻辑维度：构造服务或远程替身，驱动操作并断言结果。
 * 关键边界：凭据不得泄漏；远程句柄、终端和后台进程必须在取消或卸载时释放。
 * 新手阅读建议：先读接口和夹具，再按创建、操作、错误和清理流程阅读。
 */
import { Buffer } from 'node:buffer'
import { once } from 'node:events'
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
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
import type { SubprocessTerminalSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import E2BSubprocessRuntime from '@deepseek-ai/dsh-subprocess-e2b'
import { spawnE2BTerminal } from '../src/terminal.ts'

/** 中文说明：函数 commandError 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function commandError(exitCode: number): CommandExitError {
  return new CommandExitError({ exitCode, stdout: '', stderr: '', error: `exit ${exitCode}` })
}

/** 中文说明：类型或类 CommandOptions 约束远程资源或测试数据职责。 */
interface CommandOptions {
  signal?: AbortSignal
  cwd?: string
  envs?: Record<string, string>
}

/** 中文说明：类型或类 FakeTerminalCommandHandle 约束远程资源或测试数据职责。 */
class FakeTerminalCommandHandle {
  pid = 123
  disconnects = 0
  sdkKills = 0
  disconnectError: unknown
  sdkKillError: unknown
  waitError: unknown
  settleOnSdkKill = true
  private readonly result = Promise.withResolvers<CommandResult>()
  private settled = false

  wait(): Promise<CommandResult> {
    if (this.waitError !== undefined) throw this.waitError
    return this.result.promise
  }

  async disconnect(): Promise<void> {
    this.disconnects += 1
    if (this.disconnectError !== undefined) throw this.disconnectError
  }

  async kill(): Promise<boolean> {
    this.sdkKills += 1
    if (this.sdkKillError !== undefined) {
      /** 中文说明：测试局部值 error，由紧邻初始化决定。 */
      const error = this.sdkKillError
      if (this.settleOnSdkKill) this.fail(137)
      throw error
    }
    if (this.settleOnSdkKill) this.fail(137)
    return true
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

  asHandle(): CommandHandle {
    return this as unknown as CommandHandle
  }
}

/** 中文说明：类型或类 FakeTerminalSandbox 约束远程资源或测试数据职责。 */
class FakeTerminalSandbox {
  readonly handle = new FakeTerminalCommandHandle()
  readonly commands: string[] = []
  readonly commandOptions: CommandOptions[] = []
  readonly inputs: Array<{ pid: number; data: Buffer }> = []
  readonly removed: string[] = []
  readonly directories: string[] = []
  readonly writes = new Map<string, string>()
  createOptions: Parameters<Sandbox['pty']['create']>[0] | undefined
  ambient = 'KEEP=visible\0UNICODE=你好\0NPM_TOKEN=secret\0DSH_STALE=old\0BROKEN\0=bad\0'
  sessionId = '123\n'
  foreground = '456\n'
  groups = [123]
  zombieGroups: number[] = []
  createError: unknown
  writeError: unknown
  sendError: unknown
  commandFailure: unknown
  makeDirRequest: ((signal: AbortSignal | undefined) => Promise<void>) | undefined
  sendInputRequest: ((signal: AbortSignal | undefined) => Promise<void>) | undefined
  foregroundRequest: ((signal: AbortSignal | undefined) => Promise<void>) | undefined
  signalRequest: ((signal: AbortSignal | undefined) => Promise<void>) | undefined
  sessionGroupsFailure: unknown
  foregroundFailure: unknown
  termFailure: unknown
  removeError: unknown
  clearOnTerm = true
  clearOnKill = true
  resolvedExecutable = '/usr/bin/node\n'
  requestedOutput = 'requested-shell$ '
  emitOutputMarker = true
  afterSessionLookup: (() => void) | undefined
  private createGate: Promise<undefined> | undefined
  private releaseCreateGate: (() => void) | undefined

  deferCreate(): void {
    /** 中文说明：测试局部值 gate，由紧邻初始化决定。 */
    const gate = Promise.withResolvers<undefined>()
    this.createGate = gate.promise
    this.releaseCreateGate = () => { gate.resolve(undefined) }
  }

  releaseCreate(): void {
    this.releaseCreateGate?.()
  }

  readonly sandbox = {
    files: {
      makeDir: async (path: string, options?: CommandOptions): Promise<boolean> => {
        this.directories.push(path)
        await this.makeDirRequest?.(options?.signal)
        options?.signal?.throwIfAborted()
        return true
      },
      write: async (files: Array<{ path: string; data: string }>): Promise<object[]> => {
        /** 中文说明：测试局部值 file，由紧邻初始化决定。 */
        for (const file of files) this.writes.set(file.path, file.data)
        if (this.writeError !== undefined) throw this.writeError
        return files.map(() => ({}))
      },
      remove: async (path: string): Promise<void> => {
        this.removed.push(path)
        if (this.removeError !== undefined) throw this.removeError
      },
    },
    commands: {
      run: async (command: string, options?: CommandOptions): Promise<CommandResult> => {
        this.commands.push(command)
        if (options !== undefined) this.commandOptions.push(options)
        options?.signal?.throwIfAborted()
        if (this.commandFailure !== undefined) {
          /** 中文说明：测试局部值 error，由紧邻初始化决定。 */
          const error = this.commandFailure
          this.commandFailure = undefined
          throw error
        }
        if (command.includes('env -0 | base64')) {
          return {
            exitCode: 0,
            stdout: ['/home/user', this.ambient].map(value => Buffer.from(value).toString('base64')).join('\n'),
            stderr: '',
          }
        }
        if (command.includes('command -v -- ')) {
          return { exitCode: 0, stdout: this.resolvedExecutable, stderr: '' }
        }
        if (command.startsWith('ps -o sid=')) {
          this.afterSessionLookup?.()
          return { exitCode: 0, stdout: this.sessionId, stderr: '' }
        }
        if (command.startsWith('ps -o tpgid=')) {
          await this.foregroundRequest?.(options?.signal)
          options?.signal?.throwIfAborted()
          if (this.foregroundFailure !== undefined) throw this.foregroundFailure
          return { exitCode: 0, stdout: this.foreground, stderr: '' }
        }
        if (command.startsWith('set -o pipefail; ps -eo sid=')) {
          if (this.sessionGroupsFailure !== undefined) throw this.sessionGroupsFailure
          /** 中文说明：测试局部值 groups，由紧邻初始化决定。 */
          const groups = command.includes('stat=') && command.includes('$3 !~ /^[ZXx]/')
            ? this.groups
            : [...this.groups, ...this.zombieGroups]
          return { exitCode: 0, stdout: groups.map(group => `${group}\n`).join(''), stderr: '' }
        }
        if (command.startsWith('kill -TERM -- ')) {
          if (this.termFailure !== undefined) throw this.termFailure
          if (this.clearOnTerm) {
            this.groups = []
            this.handle.fail(143)
          }
        }
        if (command.startsWith('kill -INT -- ')) {
          await this.signalRequest?.(options?.signal)
          options?.signal?.throwIfAborted()
        }
        if (command.startsWith('kill -KILL -- ') && this.clearOnKill) this.groups = []
        return { exitCode: 0, stdout: '', stderr: '' }
      },
    },
    pty: {
      create: async (options: Parameters<Sandbox['pty']['create']>[0]): Promise<CommandHandle> => {
        this.createOptions = options
        if (this.createError !== undefined) throw this.createError
        await this.createGate
        options.signal?.throwIfAborted()
        await options.onData(Buffer.from('buffered banner\n'))
        return this.handle.asHandle()
      },
      sendInput: async (pid: number, data: Uint8Array, options?: { signal?: AbortSignal }): Promise<void> => {
        options?.signal?.throwIfAborted()
        await this.sendInputRequest?.(options?.signal)
        options?.signal?.throwIfAborted()
        this.inputs.push({ pid, data: Buffer.from(data) })
        if (this.sendError !== undefined) throw this.sendError
        if (this.emitOutputMarker && Buffer.from(data).includes(Buffer.from('runner.bash'))) {
          /** 中文说明：测试局部值 marker，由紧邻初始化决定。 */
          const marker = [...this.writes].find(([path]) => path.endsWith('/output-marker'))?.[1]
          /** 中文说明：测试局部值 onData，由紧邻初始化决定。 */
          const onData = this.createOptions?.onData
          if (marker !== undefined && onData !== undefined) {
            await onData(Buffer.from(Buffer.from(data).toString().replace(/\r$/, '\r\n')))
            /** 中文说明：测试局部值 split，由紧邻初始化决定。 */
            const split = Math.floor(marker.length / 2)
            await onData(Buffer.from(marker.slice(0, split)))
            await onData(Buffer.from(marker.slice(split)))
            await onData(Buffer.from(this.requestedOutput))
          }
        }
      },
    },
  } as unknown as Sandbox
}

/** 中文说明：函数 runtime 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function runtime(fake: FakeTerminalSandbox): E2BRuntime {
  return {
    cwd: '/workspace',
    runtimeRoot: '/workspace/.dsh-e2b',
    getSandbox: async () => fake.sandbox,
  } as unknown as E2BRuntime
}

/** 中文说明：函数 spec 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function spec(overrides: Partial<SubprocessTerminalSpawnSpec> = {}): SubprocessTerminalSpawnSpec {
  return {
    argv: ['/bin/bash', '--noprofile', '--norc'],
    cwd: '/workspace',
    rows: 24,
    cols: 80,
    graceMs: 5,
    env: { TERM: 'dumb', DSH_SESSION_ID: 'owner', TOKEN_EXPLICIT: 'kept' },
    ...overrides,
  }
}

/** 中文说明：函数 holdRequestUntilAbort 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function holdRequestUntilAbort(started: PromiseWithResolvers<AbortSignal>) {
  return async (signal: AbortSignal | undefined): Promise<void> => {
    if (signal === undefined) throw new Error('expected an operation signal')
    signal.throwIfAborted()
    started.resolve(signal)
    await new Promise<void>((_resolve, reject) => {
      signal.addEventListener('abort', () => {
        reject(signal.reason instanceof Error ? signal.reason : new Error(String(signal.reason)))
      }, { once: true })
    })
  }
}

/** Spawn the terminal under test with the config default the service would pass. */
/* 中文说明：函数 testSpawn 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function testSpawn(
  runtime: Parameters<typeof spawnE2BTerminal>[0],
  spec: Parameters<typeof spawnE2BTerminal>[1],
  stateDir: string,
  pollMs = 20,
): ReturnType<typeof spawnE2BTerminal> {
  return spawnE2BTerminal(runtime, spec, stateDir, pollMs)
}

describe('E2B terminal allocation', () => {
  it('hides bootstrap-shell bytes and preserves requested-shell bytes across the output boundary', async () => {
    /** 中文说明：测试局部值 fake，由紧邻初始化决定。 */
    const fake = new FakeTerminalSandbox()
    /** 中文说明：测试局部值 terminal，由紧邻初始化决定。 */
    const terminal = await testSpawn(runtime(fake), spec(), '/runtime/terminal-one')
    /** 中文说明：测试局部值 output，由紧邻初始化决定。 */
    let output = ''
    terminal.output.on('data', (chunk) => { output += String(chunk) })
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(output).toBe('requested-shell$ ')
    expect(output).not.toContain('buffered banner')
    expect(output).not.toContain('runner.bash')
    expect(fake.createOptions).toMatchObject({ rows: 24, cols: 80, cwd: '/workspace', timeoutMs: 0 })
    /** 中文说明：测试局部值 controlEnvs，由紧邻初始化决定。 */
    const controlEnvs = fake.createOptions?.envs
    expect(controlEnvs?.HOME).toMatch(/^\/\.dsh-e2b-control-/)
    expect(controlEnvs).toEqual({
      TERM: 'dumb',
      NPM_TOKEN: '',
      DSH_STALE: '',
      HOME: controlEnvs?.HOME,
    })
    expect(fake.inputs[0]?.data.toString()).toContain("exec /bin/bash '/runtime/terminal-one/runner.bash'")
    expect(fake.writes.get('/runtime/terminal-one/environment')).toContain('KEEP=visible\0')
    expect(fake.writes.get('/runtime/terminal-one/environment')).toContain('UNICODE=你好\0')
    expect(fake.writes.get('/runtime/terminal-one/environment')).toContain('TOKEN_EXPLICIT=kept\0')
    expect(fake.writes.get('/runtime/terminal-one/environment')).not.toContain('secret')
    expect(fake.writes.get('/runtime/terminal-one/environment')).not.toContain('DSH_STALE')
    expect(fake.writes.get('/runtime/terminal-one/argv')).toBe('/bin/bash\0--noprofile\0--norc\0')
    /** 中文说明：测试局部值 marker，由紧邻初始化决定。 */
    const marker = fake.writes.get('/runtime/terminal-one/output-marker') ?? ''
    expect(marker).toMatch(/^dsh-e2b-bootstrap:/)
    expect(fake.inputs[0]?.data.toString()).not.toContain(marker)
    /** 中文说明：测试局部值 runner，由紧邻初始化决定。 */
    const runner = fake.writes.get('/runtime/terminal-one/runner.bash') ?? ''
    expect(runner).toContain('if (( ${#dsh_argv[@]} == 0 )); then')
    expect(runner).toContain('printf \'%s\' "$dsh_output_marker"')
    expect(runner).toContain('exec env -i -- "${dsh_env[@]}" "${dsh_argv[@]}"')
    expect(runner).not.toContain('\u007f')
    terminal.output.destroy()
    await fake.createOptions?.onData(Buffer.from('late bootstrap callback'))
    expect(output).toBe('requested-shell$ ')

    await terminal.write('echo ok\r')
    expect(fake.inputs.at(-1)?.data.toString()).toBe('echo ok\r')
    await expect(terminal.inspectForeground()).resolves.toEqual({ processGroupId: 456, inputWaiting: false })
    await expect(terminal.signalForeground('SIGINT')).resolves.toBe(456)
    expect(fake.commands).toContain('kill -INT -- -456')

    /** 中文说明：测试局部值 terminated，由紧邻初始化决定。 */
    const terminated = terminal.terminate()
    await expect(terminal.done).resolves.toEqual({ exitCode: null, signal: 'SIGTERM' })
    await terminated
    expect(fake.handle.disconnects).toBe(1)
    expect(fake.removed).toContain('/runtime/terminal-one')
  })

  it('inherits only safe ambient values and limits the allocation signal to setup', async () => {
    /** 中文说明：测试局部值 fake，由紧邻初始化决定。 */
    const fake = new FakeTerminalSandbox()
    /** 中文说明：测试局部值 controller，由紧邻初始化决定。 */
    const controller = new AbortController()
    /** 中文说明：测试局部值 terminal，由紧邻初始化决定。 */
    const terminal = await testSpawn(
      runtime(fake),
      spec({ env: undefined, signal: controller.signal }),
      '/runtime/abort-live',
    )
    /** 中文说明：测试局部值 environment，由紧邻初始化决定。 */
    const environment = fake.writes.get('/runtime/abort-live/environment') ?? ''
    expect(environment).toContain('KEEP=visible\0')
    expect(environment).not.toContain('secret')
    expect(environment).not.toContain('DSH_STALE')

    controller.abort(new Error('stop'))
    await terminal.write('still live\r')
    expect(fake.inputs.at(-1)?.data.toString()).toBe('still live\r')
    await terminal.terminate()
    await expect(terminal.done).resolves.toEqual({ exitCode: null, signal: 'SIGTERM' })
  })

  it('publishes the PTY handle before honoring allocation cancellation', async () => {
    /** 中文说明：测试局部值 fake，由紧邻初始化决定。 */
    const fake = new FakeTerminalSandbox()
    fake.deferCreate()
    /** 中文说明：测试局部值 controller，由紧邻初始化决定。 */
    const controller = new AbortController()
    /** 中文说明：测试局部值 spawning，由紧邻初始化决定。 */
    const spawning = testSpawn(
      runtime(fake),
      spec({ signal: controller.signal }),
      '/runtime/allocation-cancel',
    )
    await vi.waitFor(() => { expect(fake.createOptions).toBeDefined() })

    controller.abort(new Error('allocation cancelled'))
    fake.releaseCreate()
    await expect(spawning).rejects.toThrow('allocation cancelled')
    expect(fake.createOptions?.signal).toBeUndefined()
    expect(fake.groups).toEqual([])
    expect(fake.handle.disconnects).toBe(1)
  })

  it('rejects malformed environment and argv values before PTY allocation', async () => {
    /** 中文说明：测试局部值 invalidName，由紧邻初始化决定。 */
    const invalidName = new FakeTerminalSandbox()
    await expect(testSpawn(runtime(invalidName), spec({ env: { 'BAD=NAME': 'x' } }), '/runtime/name'))
      .rejects.toThrow('environment entries')
    expect(invalidName.createOptions).toBeUndefined()

    /** 中文说明：测试局部值 invalidValue，由紧邻初始化决定。 */
    const invalidValue = new FakeTerminalSandbox()
    await expect(testSpawn(runtime(invalidValue), spec({ env: { BAD: 'x\0y' } }), '/runtime/value'))
      .rejects.toThrow('environment entries')

    /** 中文说明：测试局部值 invalidArg，由紧邻初始化决定。 */
    const invalidArg = new FakeTerminalSandbox()
    await expect(testSpawn(runtime(invalidArg), spec({ argv: ['/bin/bash', 'x\0y'] }), '/runtime/argv'))
      .rejects.toThrow('argv must not contain NUL')
  })

  it('cleans malformed handles, bootstrap failures, and readiness failures', async () => {
    /** 中文说明：测试局部值 failedState，由紧邻初始化决定。 */
    const failedState = new FakeTerminalSandbox()
    failedState.writeError = new Error('state write failed')
    await expect(testSpawn(runtime(failedState), spec(), '/runtime/state-write'))
      .rejects.toThrow('state write failed')
    expect(failedState.writes.get('/runtime/state-write/environment')).toContain('KEEP=visible\0')
    expect(failedState.removed).toContain('/runtime/state-write')
    expect(failedState.createOptions).toBeUndefined()

    /** 中文说明：测试局部值 stateAlreadyGone，由紧邻初始化决定。 */
    const stateAlreadyGone = new FakeTerminalSandbox()
    stateAlreadyGone.writeError = new Error('state write failed after external cleanup')
    stateAlreadyGone.removeError = new FileNotFoundError('state already gone')
    await expect(testSpawn(runtime(stateAlreadyGone), spec(), '/runtime/state-gone'))
      .rejects.toThrow('state write failed after external cleanup')

    /** 中文说明：测试局部值 invalidPid，由紧邻初始化决定。 */
    const invalidPid = new FakeTerminalSandbox()
    invalidPid.handle.pid = 0
    await expect(testSpawn(runtime(invalidPid), spec(), '/runtime/invalid-pid'))
      .rejects.toThrow('invalid terminal pid 0')
    expect(invalidPid.handle.sdkKills).toBe(1)
    expect(invalidPid.removed).toContain('/runtime/invalid-pid')

    /** 中文说明：测试局部值 failedInput，由紧邻初始化决定。 */
    const failedInput = new FakeTerminalSandbox()
    failedInput.sendError = new Error('bootstrap failed')
    await expect(testSpawn(runtime(failedInput), spec(), '/runtime/input'))
      .rejects.toThrow('bootstrap failed')
    expect(failedInput.commands).toContain('kill -TERM -- -123')
    expect(failedInput.groups).toEqual([])

    /** 中文说明：测试局部值 invalidSession，由紧邻初始化决定。 */
    const invalidSession = new FakeTerminalSandbox()
    invalidSession.sessionId = 'not-a-session\n'
    invalidSession.clearOnTerm = false
    await expect(testSpawn(runtime(invalidSession), spec(), '/runtime/session'))
      .rejects.toThrow('cannot resolve process session')
    expect(invalidSession.commands).toContain('kill -TERM -- -123')
    expect(invalidSession.commands).toContain('kill -KILL -- -123')
    expect(invalidSession.groups).toEqual([])
    expect(invalidSession.handle.sdkKills).toBe(1)
    /** 中文说明：测试局部值 lateData，由紧邻初始化决定。 */
    const lateData = invalidSession.createOptions?.onData
    if (lateData === undefined) throw new Error('missing captured terminal callback')
    expect(lateData(Buffer.from('late bytes'))).toBeUndefined()

    /** 中文说明：测试局部值 termFailed，由紧邻初始化决定。 */
    const termFailed = new FakeTerminalSandbox()
    termFailed.sendError = new Error('bootstrap failed')
    termFailed.termFailure = new Error('TERM transport failed')
    await expect(testSpawn(runtime(termFailed), spec(), '/runtime/term-failed'))
      .rejects.toThrow('bootstrap failed')
    expect(termFailed.commands).toContain('kill -KILL -- -123')
    expect(termFailed.handle.sdkKills).toBe(1)

    /** 中文说明：测试局部值 uninspectable，由紧邻初始化决定。 */
    const uninspectable = new FakeTerminalSandbox()
    uninspectable.sendError = new Error('bootstrap failed')
    uninspectable.sessionGroupsFailure = 'session enumeration failed'
    uninspectable.handle.sdkKillError = new Error('PTY kill failed')
    /** 中文说明：测试局部值 解构结果，由紧邻初始化决定。 */
    let uninspectableFailure: unknown
    try {
      await testSpawn(runtime(uninspectable), spec(), '/runtime/uninspectable')
    } catch (error: unknown) {
      uninspectableFailure = error
    }
    expect(uninspectableFailure).toBeInstanceOf(AggregateError)
    expect(uninspectable.handle.sdkKills).toBe(1)

    /** 中文说明：测试局部值 survivingGroups，由紧邻初始化决定。 */
    const survivingGroups = new FakeTerminalSandbox()
    survivingGroups.sendError = new Error('bootstrap failed')
    survivingGroups.clearOnTerm = false
    survivingGroups.clearOnKill = false
    await expect(testSpawn(runtime(survivingGroups), spec({ graceMs: 1 }), '/runtime/surviving-groups'))
      .rejects.toThrow('bootstrap failed')

    /** 中文说明：测试局部值 survivingPid，由紧邻初始化决定。 */
    const survivingPid = new FakeTerminalSandbox()
    survivingPid.sendError = new Error('bootstrap failed')
    survivingPid.groups = []
    survivingPid.handle.settleOnSdkKill = false
    await expect(testSpawn(runtime(survivingPid), spec({ graceMs: 1 }), '/runtime/surviving-pid'))
      .rejects.toThrow('bootstrap failed')

    /** 中文说明：测试局部值 waitFailed，由紧邻初始化决定。 */
    const waitFailed = new FakeTerminalSandbox()
    waitFailed.handle.waitError = new Error('wait failed')
    waitFailed.handle.settleOnSdkKill = false
    waitFailed.handle.sdkKillError = new Error('kill failed')
    await expect(testSpawn(runtime(waitFailed), spec(), '/runtime/wait-failed'))
      .rejects.toThrow('wait failed')
    expect(waitFailed.handle.sdkKills).toBe(1)

    /** 中文说明：测试局部值 cleanupFailed，由紧邻初始化决定。 */
    const cleanupFailed = new FakeTerminalSandbox()
    cleanupFailed.handle.pid = 0
    cleanupFailed.handle.sdkKillError = new Error('kill transport failed')
    cleanupFailed.removeError = new Error('remove transport failed')
    await expect(testSpawn(runtime(cleanupFailed), spec(), '/runtime/cleanup-failed'))
      .rejects.toThrow('invalid terminal pid 0')

    /** 中文说明：测试局部值 expiredDuringRollback，由紧邻初始化决定。 */
    const expiredDuringRollback = new FakeTerminalSandbox()
    expiredDuringRollback.sendError = new Error('bootstrap failed before timeout')
    expiredDuringRollback.groups = []
    expiredDuringRollback.handle.settleOnSdkKill = false
    expiredDuringRollback.handle.sdkKillError = new SandboxNotFoundError('sandbox expired')
    expiredDuringRollback.removeError = new SandboxNotFoundError('sandbox expired')
    await expect(testSpawn(runtime(expiredDuringRollback), spec(), '/runtime/expired-rollback'))
      .rejects.toThrow('bootstrap failed before timeout')
    expect(expiredDuringRollback.handle.sdkKills).toBe(1)

    /** 中文说明：测试局部值 expiredBeforeSdkRollback，由紧邻初始化决定。 */
    const expiredBeforeSdkRollback = new FakeTerminalSandbox()
    expiredBeforeSdkRollback.handle.waitError = new Error('wait failed after timeout')
    expiredBeforeSdkRollback.handle.sdkKillError = new SandboxNotFoundError('sandbox expired')
    expiredBeforeSdkRollback.handle.settleOnSdkKill = false
    await expect(testSpawn(runtime(expiredBeforeSdkRollback), spec(), '/runtime/expired-sdk-rollback'))
      .rejects.toThrow('wait failed after timeout')

    /** 中文说明：测试局部值 missingDuringDisconnect，由紧邻初始化决定。 */
    const missingDuringDisconnect = new FakeTerminalSandbox()
    missingDuringDisconnect.sendError = new Error('bootstrap failed before disconnect')
    missingDuringDisconnect.handle.disconnectError = new SandboxNotFoundError('sandbox expired')
    await expect(testSpawn(runtime(missingDuringDisconnect), spec(), '/runtime/missing-disconnect'))
      .rejects.toThrow('bootstrap failed before disconnect')

    /** 中文说明：测试局部值 failedDisconnect，由紧邻初始化决定。 */
    const failedDisconnect = new FakeTerminalSandbox()
    failedDisconnect.sendError = new Error('bootstrap failed with disconnect failure')
    failedDisconnect.handle.disconnectError = new Error('disconnect transport failed')
    await expect(testSpawn(runtime(failedDisconnect), spec(), '/runtime/failed-disconnect'))
      .rejects.toThrow('bootstrap failed with disconnect failure')
  })

  it('propagates setup cancellation and provider failures', async () => {
    /** 中文说明：测试局部值 aborted，由紧邻初始化决定。 */
    const aborted = new FakeTerminalSandbox()
    await expect(testSpawn(runtime(aborted), spec({ signal: AbortSignal.abort(new Error('stop')) }), '/runtime/abort'))
      .rejects.toThrow('stop')

    /** 中文说明：测试局部值 createFailed，由紧邻初始化决定。 */
    const createFailed = new FakeTerminalSandbox()
    createFailed.createError = new Error('create failed')
    await expect(testSpawn(runtime(createFailed), spec(), '/runtime/create'))
      .rejects.toThrow('create failed')

  })

  it('bounds a missing bootstrap-output boundary by process exit or cancellation', async () => {
    /** 中文说明：测试局部值 exited，由紧邻初始化决定。 */
    const exited = new FakeTerminalSandbox()
    exited.emitOutputMarker = false
    /** 中文说明：测试局部值 exiting，由紧邻初始化决定。 */
    const exiting = testSpawn(runtime(exited), spec(), '/runtime/missing-output-boundary')
    await vi.waitFor(() => { expect(exited.inputs).toHaveLength(1) })
    exited.handle.succeed(0)
    await expect(exiting).rejects.toThrow('terminal exited before publishing its output boundary')

    /** 中文说明：测试局部值 cancelled，由紧邻初始化决定。 */
    const cancelled = new FakeTerminalSandbox()
    cancelled.emitOutputMarker = false
    /** 中文说明：测试局部值 controller，由紧邻初始化决定。 */
    const controller = new AbortController()
    /** 中文说明：测试局部值 cancelling，由紧邻初始化决定。 */
    const cancelling = testSpawn(
      runtime(cancelled),
      spec({ signal: controller.signal }),
      '/runtime/cancel-output-boundary',
    )
    await vi.waitFor(() => { expect(cancelled.inputs).toHaveLength(1) })
    await new Promise(resolve => setTimeout(resolve, 0))
    controller.abort(new Error('cancel output boundary'))
    await expect(cancelling).rejects.toThrow('cancel output boundary')
  })
})

describe('E2B terminal lifecycle', () => {
  it('aborts and joins in-flight terminal operations before cleanup', async () => {
    /** 中文说明：测试局部值 fake，由紧邻初始化决定。 */
    const fake = new FakeTerminalSandbox()
    /** 中文说明：测试局部值 terminal，由紧邻初始化决定。 */
    const terminal = await testSpawn(runtime(fake), spec(), '/runtime/in-flight-operations')
    /** 中文说明：测试局部值 writeStarted，由紧邻初始化决定。 */
    const writeStarted = Promise.withResolvers<AbortSignal>()
    /** 中文说明：测试局部值 inspectStarted，由紧邻初始化决定。 */
    const inspectStarted = Promise.withResolvers<AbortSignal>()
    /** 中文说明：测试局部值 signalStarted，由紧邻初始化决定。 */
    const signalStarted = Promise.withResolvers<AbortSignal>()
    fake.sendInputRequest = holdRequestUntilAbort(writeStarted)
    /** 中文说明：测试局部值 foregroundRequests，由紧邻初始化决定。 */
    let foregroundRequests = 0
    fake.foregroundRequest = async (signal) => {
      foregroundRequests += 1
      if (foregroundRequests === 1) await holdRequestUntilAbort(inspectStarted)(signal)
    }
    /** 中文说明：测试局部值 signalCompleted，由紧邻初始化决定。 */
    let signalCompleted = false
    fake.signalRequest = async (operationSignal) => {
      await holdRequestUntilAbort(signalStarted)(operationSignal)
      signalCompleted = true
    }
    /** 中文说明：测试局部值 write，由紧邻初始化决定。 */
    const write = terminal.write('late input')
    /** 中文说明：测试局部值 inspect，由紧邻初始化决定。 */
    const inspect = terminal.inspectForeground()
    await Promise.all([writeStarted.promise, inspectStarted.promise])
    /** 中文说明：测试局部值 signal，由紧邻初始化决定。 */
    const signal = terminal.signalForeground('SIGINT')
    await signalStarted.promise

    /** 中文说明：测试局部值 terminating，由紧邻初始化决定。 */
    const terminating = terminal.terminate()
    await expect(write).rejects.toThrow('terminal is terminating')
    await expect(inspect).rejects.toThrow('terminal is terminating')
    await expect(signal).rejects.toThrow('terminal is terminating')
    await terminating
    expect(signalCompleted).toBe(false)
    expect(fake.inputs).toHaveLength(1)
    /** 中文说明：测试局部值 commandCount，由紧邻初始化决定。 */
    const commandCount = fake.commands.length
    await expect(terminal.write('after termination')).rejects.toThrow('terminal is terminating')
    await expect(terminal.inspectForeground()).rejects.toThrow('terminal is terminating')
    await expect(terminal.signalForeground('SIGINT')).rejects.toThrow('terminal is terminating')
    expect(fake.commands).toHaveLength(commandCount)
  })

  it('maps ordinary exits, closes output, and reports an absent foreground after exit', async () => {
    /** 中文说明：测试局部值 fake，由紧邻初始化决定。 */
    const fake = new FakeTerminalSandbox()
    fake.groups = []
    /** 中文说明：测试局部值 terminal，由紧邻初始化决定。 */
    const terminal = await testSpawn(runtime(fake), spec(), '/runtime/natural')
    terminal.output.resume()
    /** 中文说明：测试局部值 ended，由紧邻初始化决定。 */
    const ended = once(terminal.output, 'end')
    fake.handle.succeed(7)
    await expect(terminal.done).resolves.toEqual({ exitCode: 7, signal: null })
    await ended
    await expect(terminal.write('late')).rejects.toThrow('exited')
    fake.foregroundFailure = commandError(1)
    await expect(terminal.inspectForeground()).resolves.toBeUndefined()
    await expect(terminal.signalForeground('SIGINT')).rejects.toThrow('cannot resolve foreground process group')
    await terminal.terminate()
  })

  it.each([
    [7, { exitCode: 7, signal: null }],
    [143, { exitCode: 143, signal: null }],
    [255, { exitCode: 255, signal: null }],
  ] as const)('classifies an unrequested command exit %i', async (exitCode, expected) => {
    /** 中文说明：测试局部值 fake，由紧邻初始化决定。 */
    const fake = new FakeTerminalSandbox()
    fake.groups = []
    /** 中文说明：测试局部值 terminal，由紧邻初始化决定。 */
    const terminal = await testSpawn(runtime(fake), spec(), `/runtime/exit-${exitCode}`)
    fake.handle.fail(exitCode)
    await expect(terminal.done).resolves.toEqual(expected)
    await terminal.terminate()
  })

  it('treats a terminal session containing only zombies as quiescent', async () => {
    /** 中文说明：测试局部值 fake，由紧邻初始化决定。 */
    const fake = new FakeTerminalSandbox()
    fake.groups = []
    fake.zombieGroups = [123]
    /** 中文说明：测试局部值 terminal，由紧邻初始化决定。 */
    const terminal = await testSpawn(runtime(fake), spec(), '/runtime/zombie-session')

    fake.handle.succeed(0)
    await expect(terminal.done).resolves.toEqual({ exitCode: 0, signal: null })
    await terminal.terminate()
    expect(fake.commands).toContain(
      "set -o pipefail; ps -eo sid=,pgid=,stat= | awk '$1 == 123 && $3 !~ /^[ZXx]/ { print $2 }'",
    )
  })

  it('treats a timeout-killed sandbox as quiescent during terminal cleanup', async () => {
    /** 中文说明：测试局部值 fake，由紧邻初始化决定。 */
    const fake = new FakeTerminalSandbox()
    /** 中文说明：测试局部值 terminal，由紧邻初始化决定。 */
    const terminal = await testSpawn(runtime(fake), spec(), '/runtime/expired-sandbox')
    fake.sessionGroupsFailure = new SandboxNotFoundError('sandbox expired')
    fake.handle.succeed(0)

    await expect(terminal.done).resolves.toEqual({ exitCode: 0, signal: null })
    await terminal.terminate()
  })

  it('treats sandbox disappearance during PTY kill as quiescent', async () => {
    /** 中文说明：测试局部值 fake，由紧邻初始化决定。 */
    const fake = new FakeTerminalSandbox()
    fake.groups = []
    fake.handle.settleOnSdkKill = false
    fake.handle.sdkKillError = new SandboxNotFoundError('sandbox expired')
    /** 中文说明：测试局部值 terminal，由紧邻初始化决定。 */
    const terminal = await testSpawn(runtime(fake), spec({ graceMs: 1 }), '/runtime/expired-pty-kill')

    await terminal.terminate()
    expect(fake.handle.sdkKills).toBe(1)
  })

  it('propagates a non-missing PTY kill failure', async () => {
    /** 中文说明：测试局部值 fake，由紧邻初始化决定。 */
    const fake = new FakeTerminalSandbox()
    fake.groups = []
    fake.handle.settleOnSdkKill = false
    fake.handle.sdkKillError = new Error('PTY kill transport failed')
    /** 中文说明：测试局部值 terminal，由紧邻初始化决定。 */
    const terminal = await testSpawn(runtime(fake), spec({ graceMs: 1 }), '/runtime/failed-pty-kill')

    await expect(terminal.terminate()).rejects.toThrow('PTY kill transport failed')
    fake.handle.sdkKillError = undefined
    fake.handle.succeed(0)
    await terminal.done
    await terminal.terminate()
  })

  it.each([
    ['accepts sandbox loss', new SandboxNotFoundError('sandbox expired'), true],
    ['propagates another failure', new Error('disconnect failed'), false],
  ] as const)('%s while disconnecting a settled terminal', async (_label, failure, accepted) => {
    /** 中文说明：测试局部值 fake，由紧邻初始化决定。 */
    const fake = new FakeTerminalSandbox()
    /** 中文说明：测试局部值 terminal，由紧邻初始化决定。 */
    const terminal = await testSpawn(runtime(fake), spec(), `/runtime/disconnect-${accepted}`)
    fake.handle.disconnectError = failure
    fake.groups = []
    fake.handle.succeed(0)

    if (accepted) await expect(terminal.terminate()).resolves.toBeUndefined()
    else await expect(terminal.terminate()).rejects.toThrow('disconnect failed')
  })

  it('rejects killing the terminal shell and propagates live foreground failures', async () => {
    /** 中文说明：测试局部值 fake，由紧邻初始化决定。 */
    const fake = new FakeTerminalSandbox()
    fake.foreground = '123\n'
    /** 中文说明：测试局部值 terminal，由紧邻初始化决定。 */
    const terminal = await testSpawn(runtime(fake), spec(), '/runtime/signal')
    await expect(terminal.signalForeground('SIGKILL')).rejects.toThrow('refusing to SIGKILL')
    fake.foreground = 'invalid\n'
    await expect(terminal.inspectForeground()).rejects.toThrow('cannot resolve foreground')
    fake.foregroundFailure = commandError(1)
    await expect(terminal.inspectForeground()).resolves.toBeUndefined()
    fake.foregroundFailure = commandError(2)
    await expect(terminal.inspectForeground()).rejects.toBeInstanceOf(CommandExitError)
    fake.clearOnTerm = true
    await terminal.terminate()
  })

  it('sends KILL before checking an expired force-cleanup deadline', async () => {
    /** 中文说明：测试局部值 fake，由紧邻初始化决定。 */
    const fake = new FakeTerminalSandbox()
    fake.groups = [123, 456]
    fake.clearOnTerm = false
    /** 中文说明：测试局部值 terminal，由紧邻初始化决定。 */
    const terminal = await testSpawn(runtime(fake), spec({ graceMs: 0 }), '/runtime/escalate')
    /** 中文说明：测试局部值 terminating，由紧邻初始化决定。 */
    const terminating = terminal.terminate()
    await expect(terminal.done).resolves.toEqual({ exitCode: null, signal: 'SIGKILL' })
    await terminating
    expect(fake.commands).toContain('kill -TERM -- -123 -456')
    expect(fake.commands).toContain('kill -KILL -- -123 -456')
  })

  it('surfaces cleanup failures and allows a later retry', async () => {
    /** 中文说明：测试局部值 fake，由紧邻初始化决定。 */
    const fake = new FakeTerminalSandbox()
    fake.groups = [1]
    /** 中文说明：测试局部值 terminal，由紧邻初始化决定。 */
    const terminal = await testSpawn(runtime(fake), spec({ graceMs: 1 }), '/runtime/retry')
    await expect(terminal.terminate()).rejects.toThrow('unsafe process group 1')

    fake.groups = []
    fake.handle.succeed(0)
    await terminal.done
    await terminal.terminate()
  })

  it('propagates a process-group signalling transport failure before retry', async () => {
    /** 中文说明：测试局部值 fake，由紧邻初始化决定。 */
    const fake = new FakeTerminalSandbox()
    fake.termFailure = new Error('signal transport failed')
    /** 中文说明：测试局部值 terminal，由紧邻初始化决定。 */
    const terminal = await testSpawn(runtime(fake), spec({ graceMs: 1 }), '/runtime/signal-failure')
    await expect(terminal.terminate()).rejects.toThrow('signal transport failed')

    fake.groups = []
    fake.handle.succeed(0)
    await terminal.done
    await terminal.terminate()

    /** 中文说明：测试局部值 alreadyExited，由紧邻初始化决定。 */
    const alreadyExited = new FakeTerminalSandbox()
    alreadyExited.termFailure = commandError(1)
    /** 中文说明：测试局部值 tolerant，由紧邻初始化决定。 */
    const tolerant = await testSpawn(runtime(alreadyExited), spec({ graceMs: 1 }), '/runtime/group-exited')
    /** 中文说明：测试局部值 tolerantTermination，由紧邻初始化决定。 */
    const tolerantTermination = tolerant.terminate()
    await expect(tolerant.done).resolves.toEqual({ exitCode: null, signal: 'SIGKILL' })
    await tolerantTermination
  })

  it('keeps command rejection authoritative while cleanup is already waiting', async () => {
    /** 中文说明：测试局部值 fake，由紧邻初始化决定。 */
    const fake = new FakeTerminalSandbox()
    fake.groups = []
    fake.removeError = new Error('private state already gone')
    /** 中文说明：测试局部值 terminal，由紧邻初始化决定。 */
    const terminal = await testSpawn(runtime(fake), spec(), '/runtime/reject-during-cleanup')
    terminal.output.on('error', () => {})
    /** 中文说明：测试局部值 cleanup，由紧邻初始化决定。 */
    const cleanup = terminal.terminate()
    await Promise.resolve()
    fake.handle.crash(new Error('command transport failed'))
    await expect(terminal.done).rejects.toThrow('command transport failed')
    await cleanup
  })

  it('keeps a late command rejection authoritative after PTY kill', async () => {
    /** 中文说明：测试局部值 fake，由紧邻初始化决定。 */
    const fake = new FakeTerminalSandbox()
    fake.groups = []
    fake.handle.settleOnSdkKill = false
    /** 中文说明：测试局部值 terminal，由紧邻初始化决定。 */
    const terminal = await testSpawn(runtime(fake), spec({ graceMs: 1 }), '/runtime/reject-after-kill')
    terminal.output.on('error', () => {})
    /** 中文说明：测试局部值 cleanup，由紧邻初始化决定。 */
    const cleanup = terminal.terminate()
    while (fake.handle.sdkKills === 0) await new Promise(resolve => setTimeout(resolve, 0))
    await Promise.resolve()
    fake.handle.crash(new Error('late command transport failed'))
    await expect(terminal.done).rejects.toThrow('late command transport failed')
    await cleanup
  })

  it('reports surviving groups, a surviving top-level pid, and transport failure', async () => {
    /** 中文说明：测试局部值 survivor，由紧邻初始化决定。 */
    const survivor = new FakeTerminalSandbox()
    survivor.clearOnTerm = false
    survivor.clearOnKill = false
    /** 中文说明：测试局部值 terminal，由紧邻初始化决定。 */
    const terminal = await testSpawn(runtime(survivor), spec({ graceMs: 1 }), '/runtime/survivor')
    await expect(terminal.terminate()).rejects.toThrow('surviving process groups: 123')

    /** 中文说明：测试局部值 livePid，由紧邻初始化决定。 */
    const livePid = new FakeTerminalSandbox()
    livePid.groups = []
    livePid.handle.settleOnSdkKill = false
    /** 中文说明：测试局部值 live，由紧邻初始化决定。 */
    const live = await testSpawn(runtime(livePid), spec({ graceMs: 1 }), '/runtime/live-pid')
    await expect(live.terminate()).rejects.toThrow('surviving pid: 123')
    livePid.handle.succeed(0)
    await live.done

    /** 中文说明：测试局部值 crashed，由紧邻初始化决定。 */
    const crashed = new FakeTerminalSandbox()
    crashed.groups = []
    /** 中文说明：测试局部值 failed，由紧邻初始化决定。 */
    const failed = await testSpawn(runtime(crashed), spec(), '/runtime/crashed')
    /** 中文说明：测试局部值 outputError，由紧邻初始化决定。 */
    const outputError = once(failed.output, 'error')
    crashed.handle.crash('transport gone')
    await expect(failed.done).rejects.toEqual('transport gone')
    await expect(outputError).resolves.toMatchObject([{ message: 'transport gone' }])
    await failed.terminate()
  })
})

describe('E2B subprocess terminal service', () => {
  /** 中文说明：函数 service 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
  async function service(fake = new FakeTerminalSandbox()): Promise<{
    ctx: Context
    fiber: Awaited<ReturnType<Context['plugin']>>
    fake: FakeTerminalSandbox
  }> {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    ctx.provide('e2b', runtime(fake))
    /** 中文说明：测试局部值 fiber，由紧邻初始化决定。 */
    const fiber = await ctx.plugin(E2BSubprocessRuntime)
    return { ctx, fiber, fake }
  }

  it('resolves remote executables', async () => {
    /** 中文说明：测试局部值 { ctx, fake }，由紧邻初始化决定。 */
    const { ctx, fake } = await service()
    await expect(ctx.subprocess.resolveExecutable('/bin/bash')).resolves.toBe('/bin/bash')
    await expect(ctx.subprocess.resolveExecutable('node', { PATH: '/custom/bin' }, new AbortController().signal))
      .resolves.toBe('/usr/bin/node')
    fake.resolvedExecutable = 'tools/bin/node\n'
    await expect(ctx.subprocess.resolveExecutable('node', { PATH: 'tools/bin' }))
      .resolves.toBe('/workspace/tools/bin/node')
    /** 中文说明：测试局部值 commandOptions，由紧邻初始化决定。 */
    const commandOptions = fake.commandOptions.at(-1)
    expect(commandOptions).toMatchObject({ cwd: '/workspace' })
    expect(commandOptions?.envs?.HOME).toMatch(/^\/\.dsh-e2b-control-/)
    expect(commandOptions?.envs).toEqual({ HOME: commandOptions?.envs?.HOME })
    expect((ctx.e2b)).toBeDefined()
  })

  it('rejects invalid executable lookup inputs and results', async () => {
    /** 中文说明：测试局部值 { ctx, fake }，由紧邻初始化决定。 */
    const { ctx, fake } = await service()
    await expect(ctx.subprocess.resolveExecutable('')).rejects.toThrow('non-empty')
    await expect(ctx.subprocess.resolveExecutable('./bin/server')).rejects.toThrow('is a relative path')
    await expect(ctx.subprocess.resolveExecutable('node_modules/.bin/server')).rejects.toThrow('is a relative path')
    await expect(ctx.subprocess.resolveExecutable('node', undefined, AbortSignal.abort(new Error('stop'))))
      .rejects.toThrow('stop')
    fake.resolvedExecutable = 'node\n'
    await expect(ctx.subprocess.resolveExecutable('node')).rejects.toThrow('did not resolve')
    fake.resolvedExecutable = '/one\n/two\n'
    await expect(ctx.subprocess.resolveExecutable('node')).rejects.toThrow('did not resolve')
  })

  it('rejects a non-positive poll cadence at load', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    ctx.provide('e2b', runtime(new FakeTerminalSandbox()))
    await expect(ctx.plugin(E2BSubprocessRuntime, { pollMs: 0 }))
      .rejects.toThrow('pollMs must be a positive safe integer')
    /** 中文说明：测试局部值 explicit，由紧邻初始化决定。 */
    const explicit = await ctx.plugin(E2BSubprocessRuntime, { pollMs: 5 })
    await explicit.dispose()
  })

  it('owns live terminals through service disposal', async () => {
    /** 中文说明：测试局部值 { ctx, fiber, fake }，由紧邻初始化决定。 */
    const { ctx, fiber, fake } = await service()
    /** 中文说明：测试局部值 terminal，由紧邻初始化决定。 */
    const terminal = await ctx.subprocess.spawnTerminal(spec({ signal: new AbortController().signal }))
    await fiber.dispose()
    await expect(terminal.done).resolves.toEqual({ exitCode: null, signal: 'SIGTERM' })
    expect(fake.handle.disconnects).toBe(1)
  })

  it('joins and rejects terminal setup that completes during service disposal', async () => {
    /** 中文说明：测试局部值 fake，由紧邻初始化决定。 */
    const fake = new FakeTerminalSandbox()
    /** 中文说明：测试局部值 { ctx, fiber }，由紧邻初始化决定。 */
    const { ctx, fiber } = await service(fake)
    /** 中文说明：测试局部值 解构结果，由紧邻初始化决定。 */
    let disposing: Promise<void> | undefined
    fake.afterSessionLookup = () => {
      fake.afterSessionLookup = undefined
      queueMicrotask(() => {
        queueMicrotask(() => { disposing = fiber.dispose() })
      })
    }
    /** 中文说明：测试局部值 subprocess，由紧邻初始化决定。 */
    const subprocess = ctx.subprocess
    /** 中文说明：测试局部值 spawning，由紧邻初始化决定。 */
    const spawning = ctx.subprocess.spawnTerminal(spec())
    /** 中文说明：测试局部值 rejected，由紧邻初始化决定。 */
    const rejected = expect(spawning).rejects.toThrow('service disposed during terminal setup')
    await vi.waitFor(() => { expect(disposing).toBeDefined() })
    await expect(subprocess.spawnTerminal(spec())).rejects.toThrow('service is disposing')

    await rejected
    await disposing
    expect(fake.groups).toEqual([])
    expect(fake.handle.disconnects).toBe(1)
    expect(fake.removed.some(path => path.includes('/terminals/'))).toBe(true)
  })

  it('aborts and rolls back terminal setup that cannot publish its output boundary during disposal', async () => {
    /** 中文说明：测试局部值 fake，由紧邻初始化决定。 */
    const fake = new FakeTerminalSandbox()
    fake.emitOutputMarker = false
    /** 中文说明：测试局部值 { ctx, fiber }，由紧邻初始化决定。 */
    const { ctx, fiber } = await service(fake)
    /** 中文说明：测试局部值 spawning，由紧邻初始化决定。 */
    const spawning = ctx.subprocess.spawnTerminal(spec())
    /** 中文说明：测试局部值 rejected，由紧邻初始化决定。 */
    const rejected = expect(spawning).rejects.toThrow('service disposed during terminal setup')
    await vi.waitFor(() => { expect(fake.inputs).toHaveLength(1) })

    await fiber.dispose()
    await rejected
    expect(fake.groups).toEqual([])
    expect(fake.handle.disconnects).toBe(1)
  })

  it('owns and cancels terminal state-directory creation during disposal', async () => {
    /** 中文说明：测试局部值 fake，由紧邻初始化决定。 */
    const fake = new FakeTerminalSandbox()
    fake.makeDirRequest = async (signal) => {
      await new Promise<never>((_resolve, reject) => {
        /** 中文说明：测试局部值 onAbort，由紧邻初始化决定。 */
        const onAbort = (): void => {
          /** 中文说明：测试局部值 reason，由紧邻初始化决定。 */
          const reason: unknown = signal?.reason
          reject(reason instanceof Error ? reason : new Error(String(reason)))
        }
        signal?.addEventListener('abort', onAbort, { once: true })
        if (signal?.aborted === true) onAbort()
      })
    }
    /** 中文说明：测试局部值 { ctx, fiber }，由紧邻初始化决定。 */
    const { ctx, fiber } = await service(fake)
    /** 中文说明：测试局部值 spawning，由紧邻初始化决定。 */
    const spawning = ctx.subprocess.spawnTerminal(spec())
    /** 中文说明：测试局部值 rejected，由紧邻初始化决定。 */
    const rejected = expect(spawning).rejects.toThrow('service disposed during terminal setup')
    await vi.waitFor(() => { expect(fake.directories.some(path => path.includes('/terminals/'))).toBe(true) })

    await fiber.dispose()
    await rejected
    expect(fake.removed.some(path => path.includes('/terminals/'))).toBe(true)
    expect(fake.createOptions).toBeUndefined()
  })

  it('releases naturally settled terminals and validates terminal requests', async () => {
    /** 中文说明：测试局部值 { ctx, fiber, fake }，由紧邻初始化决定。 */
    const { ctx, fiber, fake } = await service()
    /** 中文说明：测试局部值 request，由紧邻初始化决定。 */
    for (const request of [
      spec({ argv: [] }),
      spec({ signal: AbortSignal.abort(new Error('cancelled')) }),
    ]) {
      await expect(ctx.subprocess.spawnTerminal(request)).rejects.toThrow()
    }

    fake.groups = []
    /** 中文说明：测试局部值 terminal，由紧邻初始化决定。 */
    const terminal = await ctx.subprocess.spawnTerminal(spec())
    fake.handle.succeed(0)
    await terminal.done
    await terminal.terminate()
    /** 中文说明：测试局部值 signals，由紧邻初始化决定。 */
    const signals = fake.commands.filter(command => command.startsWith('kill -')).length
    await fiber.dispose()
    expect(fake.commands.filter(command => command.startsWith('kill -'))).toHaveLength(signals)
  })

  it('contains a failed automatic terminal release until service disposal retries it', async () => {
    /** 中文说明：测试局部值 { fiber, fake }，由紧邻初始化决定。 */
    const { fiber, fake } = await service()
    fake.clearOnTerm = false
    fake.clearOnKill = false
    /** 中文说明：测试局部值 terminal，由紧邻初始化决定。 */
    const terminal = await (fiber.ctx).subprocess.spawnTerminal(spec({ graceMs: 1 }))
    fake.handle.succeed(0)
    await terminal.done
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(fake.commands).toContain('kill -KILL -- -123')

    fake.groups = []
    await fiber.dispose()
    await expect(terminal.terminate()).resolves.toBeUndefined()
  })

  it('contains an immediate automatic terminal release rejection before disposal retries it', async () => {
    /** 中文说明：测试局部值 { fiber, fake }，由紧邻初始化决定。 */
    const { fiber, fake } = await service()
    fake.groups = []
    /** 中文说明：测试局部值 terminal，由紧邻初始化决定。 */
    const terminal = await (fiber.ctx).subprocess.spawnTerminal(spec())
    /** 中文说明：测试局部值 terminate，由紧邻初始化决定。 */
    const terminate = vi.spyOn(terminal, 'terminate')
      .mockRejectedValueOnce(new Error('automatic release failed'))
    fake.handle.succeed(0)
    await terminal.done
    await vi.waitFor(() => { expect(terminate).toHaveBeenCalledTimes(1) })
    await new Promise(resolve => setTimeout(resolve, 0))

    await fiber.dispose()
    expect(terminate).toHaveBeenCalledTimes(2)
    expect(fake.handle.disconnects).toBe(1)
  })
})
