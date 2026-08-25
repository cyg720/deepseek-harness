/** E2B PTY allocation and process-session ownership for the subprocess seam. */
/*
 * 文件职责：实现E2B 远程沙箱的 terminal.ts 模块。
 * 技术维度：TypeScript、Cordis、异步资源生命周期、远程文件/进程接口和 Vitest。
 * 产品维度：保证E2B 远程沙箱在真实组装、失败和清理场景中可靠。
 * 逻辑维度：注册能力，转换请求并管理远程资源。
 * 关键边界：凭据不得泄漏；远程句柄、终端和后台进程必须在取消或卸载时释放。
 * 新手阅读建议：先读接口和夹具，再按创建、操作、错误和清理流程阅读。
 */

import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { PassThrough } from 'node:stream'
import { posix } from 'node:path'
import {
  CommandExitError,
  e2bControlEnvs,
  FileNotFoundError,
  SandboxNotFoundError,
  quoteE2BShellArg,
} from '@deepseek-ai/dsh-e2b'
import type { CommandHandle, CommandResult, Sandbox } from '@deepseek-ai/dsh-e2b'
import type {
  SubprocessOutcome,
  SubprocessTerminalForeground,
  SubprocessTerminalHandle,
  SubprocessTerminalSignal,
  SubprocessTerminalSpawnSpec,
} from '@deepseek-ai/dsh-subprocess'
import type E2BRuntime from '@deepseek-ai/dsh-e2b'
import {
  bootstrapEnvironment,
  readRemoteEnvironment,
  serializeRemoteEnvironment,
} from './environment.ts'
import { asError, commandOpts, delay, signalOpts, signalRemoteGroups } from './remote.ts'

/** 中文说明：运行时局部值 TERMINAL_RUNNER_SOURCE，由紧邻初始化决定。 */
const TERMINAL_RUNNER_SOURCE = [
  '#!/bin/bash',
  'set -euo pipefail',
  'dsh_state=$1',
  'mapfile -d \'\' -t dsh_env < "$dsh_state/environment"',
  'mapfile -d \'\' -t dsh_argv < "$dsh_state/argv"',
  'dsh_output_marker=$(<"$dsh_state/output-marker")',
  'rm -f -- "$dsh_state/environment" "$dsh_state/argv" "$dsh_state/output-marker" "$dsh_state/runner.bash"',
  'if (( ${#dsh_argv[@]} == 0 )); then',
  "  printf 'terminal runner received empty argv\\n' >&2",
  '  exit 125',
  'fi',
  'printf \'%s\' "$dsh_output_marker"',
  'exec env -i -- "${dsh_env[@]}" "${dsh_argv[@]}"',
  '',
].join('\n')

/** 中文说明：类型或类 TerminalPaths 约束远程资源或测试数据职责。 */
interface TerminalPaths {
  runner: string
  environment: string
  argv: string
  outputMarker: string
}

/** 中文说明：类型或类 BootstrapOutputFilter 约束远程资源或测试数据职责。 */
class BootstrapOutputFilter {
  readonly ready: Promise<void>

  private readonly readyState = Promise.withResolvers<void>()
  private pending = Buffer.alloc(0)
  private published = false

  constructor(
    private readonly marker: Buffer,
    private readonly output: PassThrough,
  ) {
    this.ready = this.readyState.promise
  }

  push(data: Uint8Array): void {
    if (this.published) {
      this.write(data)
      return
    }
    /** 中文说明：运行时局部值 combined，由紧邻初始化决定。 */
    const combined = Buffer.concat([this.pending, Buffer.from(data)])
    /** 中文说明：运行时局部值 markerOffset，由紧邻初始化决定。 */
    const markerOffset = combined.indexOf(this.marker)
    if (markerOffset < 0) {
      /** 中文说明：运行时局部值 retained，由紧邻初始化决定。 */
      const retained = Math.min(combined.length, this.marker.length - 1)
      this.pending = Buffer.from(combined.subarray(combined.length - retained))
      return
    }
    this.published = true
    this.pending = Buffer.alloc(0)
    this.readyState.resolve()
    this.write(combined.subarray(markerOffset + this.marker.length))
  }

  private write(data: Uint8Array): void {
    if (data.length > 0 && !this.output.destroyed) this.output.write(data)
  }
}

/** 中文说明：函数 waitForBootstrapOutput 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
async function waitForBootstrapOutput(
  ready: Promise<void>,
  completion: Promise<CommandResult>,
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted()
  await new Promise<void>((resolve, reject) => {
    /** 中文说明：运行时局部值 settled，由紧邻初始化决定。 */
    let settled = false
    /** 中文说明：运行时局部值 removeAbort，由紧邻初始化决定。 */
    let removeAbort: (() => void) | undefined
    /** 中文说明：运行时局部值 finish，由紧邻初始化决定。 */
    const finish = (complete: () => void): void => {
      if (settled) return
      settled = true
      removeAbort?.()
      complete()
    }
    /** 中文说明：运行时局部值 onExit，由紧邻初始化决定。 */
    const onExit = (): void => {
      finish(() => { reject(new Error('subprocess-e2b: terminal exited before publishing its output boundary')) })
    }
    if (signal !== undefined) {
      /** 中文说明：运行时局部值 onAbort，由紧邻初始化决定。 */
      const onAbort = (): void => {
        finish(() => { reject(asError(signal.reason)) })
      }
      signal.addEventListener('abort', onAbort, { once: true })
      removeAbort = () => { signal.removeEventListener('abort', onAbort) }
    }
    void ready.then(() => { finish(resolve) })
    void completion.then(onExit, onExit)
  })
}

/** 中文说明：函数 parsePositiveId 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function parsePositiveId(value: string, message: string): number {
  /** 中文说明：运行时局部值 raw，由紧邻初始化决定。 */
  const raw = value.trim()
  /** 中文说明：运行时局部值 id，由紧邻初始化决定。 */
  const id = Number(raw)
  if (!/^[1-9][0-9]*$/.test(raw) || !Number.isSafeInteger(id)) throw new Error(message)
  return id
}

/** 中文说明：函数 serializeValues 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function serializeValues(values: readonly string[], kind: string): string {
  /** 中文说明：运行时局部值 value，由紧邻初始化决定。 */
  for (const value of values) {
    if (value.includes('\0')) throw new Error(`subprocess-e2b: terminal ${kind} must not contain NUL bytes`)
  }
  return values.map(value => `${value}\0`).join('')
}

/** 中文说明：函数 terminalSessionId 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
async function terminalSessionId(
  sandbox: Sandbox,
  pid: number,
  envs: Record<string, string>,
  signal?: AbortSignal,
): Promise<number> {
  /** 中文说明：运行时局部值 result，由紧邻初始化决定。 */
  const result = await sandbox.commands.run(`ps -o sid= -p ${pid}`, commandOpts(envs, signal))
  signal?.throwIfAborted()
  return parsePositiveId(result.stdout, `subprocess-e2b: cannot resolve process session for terminal ${pid}`)
}

/** 中文说明：函数 sessionProcessGroups 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
async function sessionProcessGroups(
  sandbox: Sandbox,
  sessionId: number,
  envs: Record<string, string>,
): Promise<number[]> {
  /** 中文说明：运行时局部值 result: CommandResult，由紧邻初始化决定。 */
  let result: CommandResult
  try {
    result = await sandbox.commands.run(
      `set -o pipefail; ps -eo sid=,pgid=,stat= | awk '$1 == ${sessionId} && $3 !~ /^[ZXx]/ { print $2 }'`,
      commandOpts(envs),
    )
  } catch (error: unknown) {
    if (error instanceof SandboxNotFoundError) return []
    throw error
  }
  /** 中文说明：运行时局部值 groups，由紧邻初始化决定。 */
  const groups = new Set<number>()
  /** 中文说明：运行时局部值 raw，由紧邻初始化决定。 */
  for (const raw of result.stdout.trim().split(/\s+/)) {
    if (raw.length === 0) continue
    /** 中文说明：运行时局部值 group，由紧邻初始化决定。 */
    const group = parsePositiveId(
      raw,
      `subprocess-e2b: invalid process group ${JSON.stringify(raw)} in terminal session ${sessionId}`,
    )
    if (group <= 1) {
      throw new Error(`subprocess-e2b: unsafe process group ${group} in terminal session ${sessionId}`)
    }
    groups.add(group)
  }
  return [...groups]
}

/** 中文说明：函数 awaitSessionEmpty 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
async function awaitSessionEmpty(
  sandbox: Sandbox,
  sessionId: number,
  envs: Record<string, string>,
  graceMs: number,
  pollMs: number,
  kill = false,
): Promise<number[]> {
  /** 中文说明：运行时局部值 deadline，由紧邻初始化决定。 */
  const deadline = Date.now() + graceMs
  for (;;) {
    /** 中文说明：运行时局部值 groups，由紧邻初始化决定。 */
    const groups = await sessionProcessGroups(sandbox, sessionId, envs)
    if (groups.length === 0) return groups
    if (kill) {
      await signalRemoteGroups(sandbox, envs, groups, 'KILL')
      if (Date.now() >= deadline) return await sessionProcessGroups(sandbox, sessionId, envs)
    } else if (Date.now() >= deadline) {
      return groups
    }
    await delay(Math.min(pollMs, Math.max(1, deadline - Date.now())))
  }
}

/** 中文说明：函数 rollbackUnpublishedTerminal 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
async function rollbackUnpublishedTerminal(
  sandbox: Sandbox,
  handle: CommandHandle,
  completion: Promise<CommandResult>,
  envs: Record<string, string>,
  graceMs: number,
  pollMs: number,
): Promise<void> {
  /** 中文说明：运行时局部值 topLevelExited，由紧邻初始化决定。 */
  let topLevelExited = false
  void completion.then(
    () => { topLevelExited = true },
    () => { topLevelExited = true },
  )
  /** 中文说明：运行时局部值 validPid，由紧邻初始化决定。 */
  const validPid = Number.isSafeInteger(handle.pid) && handle.pid > 1
  /** 中文说明：运行时局部值 attemptFailures，由紧邻初始化决定。 */
  const attemptFailures: Error[] = []
  /** 中文说明：运行时局部值 解构结果，由紧邻初始化决定。 */
  let sessionId: number | undefined
  if (validPid) {
    sessionId = handle.pid
    try {
      sessionId = await terminalSessionId(sandbox, handle.pid, envs)
    } catch (_sessionLookupFailure) {
      // E2B's PTY leader is also the provisional POSIX session leader, so its
      // PID remains usable after the setup lookup itself fails or is canceled.
    }
    try {
      /** 中文说明：运行时局部值 groups，由紧邻初始化决定。 */
      let groups = await sessionProcessGroups(sandbox, sessionId, envs)
      if (groups.length > 0) {
        await signalRemoteGroups(sandbox, envs, groups, 'TERM')
        groups = await awaitSessionEmpty(sandbox, sessionId, envs, graceMs, pollMs)
      }
      if (groups.length > 0) {
        await awaitSessionEmpty(sandbox, sessionId, envs, graceMs, pollMs, true)
      }
    } catch (error: unknown) {
      attemptFailures.push(asError(error))
    }
  }
  // Completion can settle while any awaited provider cleanup above is running.
  // oxlint-disable-next-line typescript/no-unnecessary-condition -- Provider cleanup yields to completion.
  if (!topLevelExited) {
    try {
      await handle.kill()
    } catch (error: unknown) {
      if (error instanceof SandboxNotFoundError) return
      attemptFailures.push(asError(error))
    }
    await Promise.race([completion.catch(() => undefined), delay(graceMs)])
  }
  /** 中文说明：运行时局部值 proofFailures，由紧邻初始化决定。 */
  const proofFailures: Error[] = []
  if (sessionId !== undefined) {
    try {
      /** 中文说明：运行时局部值 groups，由紧邻初始化决定。 */
      const groups = await awaitSessionEmpty(sandbox, sessionId, envs, graceMs, pollMs, true)
      if (groups.length > 0) {
        proofFailures.push(new Error(
          `subprocess-e2b: terminal setup rollback failed; surviving process groups: ${groups.join(', ')}`,
        ))
      }
    } catch (error: unknown) {
      proofFailures.push(asError(error))
    }
  }
  // The bounded completion race above updates this callback-owned state.
  // oxlint-disable-next-line typescript/no-unnecessary-condition -- The callback mutates this after a race.
  if (!topLevelExited) {
    proofFailures.push(new Error(`subprocess-e2b: terminal setup rollback failed; surviving pid: ${handle.pid}`))
  }
  if (proofFailures.length > 0) {
    throw new AggregateError(
      [...attemptFailures, ...proofFailures],
      'subprocess-e2b: terminal setup rollback did not reach quiescence',
    )
  }
  try {
    await handle.disconnect()
  } catch (error: unknown) {
    if (!(error instanceof SandboxNotFoundError)) throw error
  }
}

/** One E2B PTY and all process groups in its remote process session. */
/* 中文说明：类型或类 E2BTerminalHandle 约束远程资源或测试数据职责。 */
export class E2BTerminalHandle implements SubprocessTerminalHandle {
  readonly pid: number
  readonly done: Promise<SubprocessOutcome>

  private topLevelExited = false
  private cleanup: Promise<void> | undefined
  private readonly operationController = new AbortController()
  private readonly operations = new Set<Promise<unknown>>()
  private terminationSignal: NodeJS.Signals | null = null

  constructor(
    private readonly sandbox: Sandbox,
    private readonly handle: CommandHandle,
    readonly output: PassThrough,
    private readonly completion: Promise<CommandResult>,
    private readonly sessionId: number,
    private readonly controlEnvs: Record<string, string>,
    private readonly stateDir: string,
    private readonly graceMs: number,
    private readonly pollMs: number,
  ) {
    this.pid = handle.pid
    this.done = this.waitForCommand()
  }

  // TODO(e2b-pgid-identity): Replace retained numeric PTY/session ids when E2B
  // exposes identity-bound input, foreground-signal, and cleanup operations.
  /** @inheritdoc */
  write(data: string): Promise<void> {
    return this.trackOperation(async (signal) => {
      if (this.topLevelExited) throw new Error('terminal process has exited')
      await this.sandbox.pty.sendInput(this.pid, Buffer.from(data, 'utf8'), { signal })
    })
  }

  /** @inheritdoc */
  inspectForeground(): Promise<SubprocessTerminalForeground | undefined> {
    return this.trackOperation(signal => this.inspectForegroundOnce(signal))
  }

  /** @inheritdoc */
  signalForeground(signal: SubprocessTerminalSignal): Promise<number> {
    return this.trackOperation(async (operationSignal) => {
      /** 中文说明：运行时局部值 foreground，由紧邻初始化决定。 */
      const foreground = await this.inspectForegroundOnce(operationSignal)
      if (foreground === undefined) {
        throw new Error(`subprocess-e2b: cannot resolve foreground process group for terminal ${this.pid}`)
      }
      if (signal === 'SIGKILL' && foreground.processGroupId === this.pid) {
        throw new Error('refusing to SIGKILL the terminal shell; terminate the terminal session instead')
      }
      await this.sandbox.commands.run(
        `kill -${signal.slice(3)} -- -${foreground.processGroupId}`,
        commandOpts(this.controlEnvs, operationSignal),
      )
      return foreground.processGroupId
    })
  }

  /** @inheritdoc */
  terminate(): Promise<void> {
    if (this.cleanup !== undefined) return this.cleanup
    this.operationController.abort(new Error('subprocess-e2b: terminal is terminating'))
    /** 中文说明：运行时局部值 cleanup，由紧邻初始化决定。 */
    const cleanup = this.closeAfterOperations()
    this.cleanup = cleanup
    void cleanup.catch((_cleanupFailure: unknown) => {
      this.cleanup = undefined
    })
    return cleanup
  }

  private async inspectForegroundOnce(
    signal: AbortSignal,
  ): Promise<SubprocessTerminalForeground | undefined> {
    try {
      /** 中文说明：运行时局部值 result，由紧邻初始化决定。 */
      const result = await this.sandbox.commands.run(
        `ps -o tpgid= -p ${this.pid}`,
        commandOpts(this.controlEnvs, signal),
      )
      return {
        processGroupId: parsePositiveId(
          result.stdout,
          `subprocess-e2b: cannot resolve foreground process group for terminal ${this.pid}`,
        ),
        // E2B exposes process-table commands but not the /proc memory access
        // needed to prove a specific syscall is waiting on fd 0.
        inputWaiting: false,
      }
    } catch (error: unknown) {
      if (error instanceof CommandExitError && (error.exitCode === 1 || this.topLevelExited)) return undefined
      throw error
    }
  }

  private trackOperation<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (this.operationController.signal.aborted) {
      return Promise.reject(new Error('subprocess-e2b: terminal is terminating'))
    }
    /** 中文说明：运行时局部值 pending，由紧邻初始化决定。 */
    const pending = operation(this.operationController.signal)
    this.operations.add(pending)
    void pending.then(
      () => { this.operations.delete(pending) },
      () => { this.operations.delete(pending) },
    )
    return pending
  }

  private async closeAfterOperations(): Promise<void> {
    await Promise.allSettled(this.operations)
    await this.closeOnce()
  }

  private async waitForCommand(): Promise<SubprocessOutcome> {
    try {
      /** 中文说明：运行时局部值 result，由紧邻初始化决定。 */
      const result = await this.completion
      return { exitCode: result.exitCode, signal: null }
    } catch (error: unknown) {
      if (error instanceof CommandExitError) {
        return this.terminationSignal === null
          ? { exitCode: error.exitCode, signal: null }
          : { exitCode: null, signal: this.terminationSignal }
      }
      this.output.destroy(error instanceof Error ? error : new Error(String(error)))
      throw error
    } finally {
      this.topLevelExited = true
      if (!this.output.destroyed) this.output.end()
    }
  }

  private async closeOnce(): Promise<void> {
    /** 中文说明：运行时局部值 groups，由紧邻初始化决定。 */
    let groups = await sessionProcessGroups(this.sandbox, this.sessionId, this.controlEnvs)
    if (groups.length > 0) {
      this.terminationSignal = 'SIGTERM'
      await signalRemoteGroups(this.sandbox, this.controlEnvs, groups, 'TERM')
      groups = await awaitSessionEmpty(this.sandbox, this.sessionId, this.controlEnvs, this.graceMs, this.pollMs)
    }
    if (groups.length === 0 && !this.topLevelExited) {
      await Promise.race([this.done.catch(() => undefined), delay(this.graceMs)])
    }
    if (groups.length > 0 || !this.topLevelExited) {
      this.terminationSignal = 'SIGKILL'
      if (!this.topLevelExited) {
        try {
          await this.handle.kill()
        } catch (error: unknown) {
          if (error instanceof SandboxNotFoundError) return
          throw error
        }
      }
      groups = await awaitSessionEmpty(this.sandbox, this.sessionId, this.controlEnvs, this.graceMs, this.pollMs, true)
      if (!this.topLevelExited) await Promise.race([this.done.catch(() => undefined), delay(this.graceMs)])
    }
    if (groups.length > 0) {
      throw new Error(`subprocess-e2b: terminal cleanup failed; surviving process groups: ${groups.join(', ')}`)
    }
    if (!this.topLevelExited) {
      throw new Error(`subprocess-e2b: terminal cleanup failed; surviving pid: ${this.pid}`)
    }
    try {
      await this.handle.disconnect()
    } catch (error: unknown) {
      if (!(error instanceof SandboxNotFoundError)) throw error
    }
    try {
      await this.sandbox.files.remove(this.stateDir)
    } catch (_adapterPrivateStateRemovalFailure) {
      // The terminal is quiescent; owner teardown bounds private residue.
    }
  }
}

/**
 * Allocate an E2B PTY, replace its bootstrap shell with the requested argv,
 * and return only after the private runner has published readiness.
 * @param runtime - Shared E2B sandbox owner.
 * @param spec - Fully specified terminal-process request.
 * @param stateDir - Private remote directory for one startup transaction.
 * @param pollMs - Remote session liveness poll cadence.
 * @returns The live subprocess terminal handle.
 */
/*
 * 中文说明：函数 spawnE2BTerminal 的参数见签名，返回结果供相邻流程使用；示例见本文件。
 * @param runtime 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @param spec 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @param stateDir 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @param pollMs 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
 */
export async function spawnE2BTerminal(
  runtime: E2BRuntime,
  spec: SubprocessTerminalSpawnSpec,
  stateDir: string,
  pollMs: number,
): Promise<E2BTerminalHandle> {
  /** 中文说明：运行时局部值 sandbox，由紧邻初始化决定。 */
  const sandbox = await runtime.getSandbox()
  spec.signal?.throwIfAborted()
  /** 中文说明：运行时局部值 paths，由紧邻初始化决定。 */
  const paths: TerminalPaths = {
    runner: posix.join(stateDir, 'runner.bash'),
    environment: posix.join(stateDir, 'environment'),
    argv: posix.join(stateDir, 'argv'),
    outputMarker: posix.join(stateDir, 'output-marker'),
  }
  /** 中文说明：运行时局部值 outputMarker，由紧邻初始化决定。 */
  const outputMarker = Buffer.from(`dsh-e2b-bootstrap:${randomUUID()}`)
  /** 中文说明：运行时局部值 output，由紧邻初始化决定。 */
  const output = new PassThrough()
  /** 中文说明：运行时局部值 outputFilter，由紧邻初始化决定。 */
  const outputFilter = new BootstrapOutputFilter(outputMarker, output)
  /** 中文说明：运行时局部值 解构结果，由紧邻初始化决定。 */
  let handle: CommandHandle | undefined
  /** 中文说明：运行时局部值 解构结果，由紧邻初始化决定。 */
  let completion: Promise<CommandResult> | undefined
  /** 中文说明：运行时局部值 stateDirectoryCreated，由紧邻初始化决定。 */
  let stateDirectoryCreated = false
  /** 中文说明：运行时局部值 controlEnvs，由紧邻初始化决定。 */
  let controlEnvs: Record<string, string> = {}
  try {
    /** 中文说明：运行时局部值 ambient，由紧邻初始化决定。 */
    const ambient = await readRemoteEnvironment(sandbox, spec.signal)
    controlEnvs = bootstrapEnvironment(ambient)
    /** 中文说明：运行时局部值 environment，由紧邻初始化决定。 */
    const environment = serializeRemoteEnvironment(ambient, spec.env)
    /** 中文说明：运行时局部值 argv，由紧邻初始化决定。 */
    const argv = serializeValues(spec.argv, 'argv')
    stateDirectoryCreated = true
    await sandbox.files.makeDir(stateDir, signalOpts(spec.signal))
    await sandbox.commands.run(
      `chmod 700 -- ${quoteE2BShellArg(stateDir)}`,
      commandOpts(controlEnvs, spec.signal),
    )
    await sandbox.files.write([
      { path: paths.runner, data: TERMINAL_RUNNER_SOURCE },
      { path: paths.environment, data: environment },
      { path: paths.argv, data: argv },
      { path: paths.outputMarker, data: outputMarker.toString('utf8') },
    ], signalOpts(spec.signal))
    await sandbox.commands.run(
      `chmod 600 -- ${quoteE2BShellArg(paths.runner)} ${quoteE2BShellArg(paths.environment)} ${quoteE2BShellArg(paths.argv)} ${quoteE2BShellArg(paths.outputMarker)}`,
      commandOpts(controlEnvs, spec.signal),
    )
    handle = await sandbox.pty.create({
      rows: spec.rows,
      cols: spec.cols,
      cwd: spec.cwd,
      envs: e2bControlEnvs(controlEnvs),
      timeoutMs: 0,
      onData: (data) => { outputFilter.push(data) },
    })
    completion = handle.wait()
    void completion.catch(() => {})
    spec.signal?.throwIfAborted()
    if (!Number.isSafeInteger(handle.pid) || handle.pid <= 0) {
      throw new Error(`subprocess-e2b: E2B returned invalid terminal pid ${handle.pid}`)
    }
    /** 中文说明：运行时局部值 command，由紧邻初始化决定。 */
    const command = `exec /bin/bash ${quoteE2BShellArg(paths.runner)} ${quoteE2BShellArg(stateDir)}\r`
    await sandbox.pty.sendInput(handle.pid, Buffer.from(command), signalOpts(spec.signal))
    await waitForBootstrapOutput(outputFilter.ready, completion, spec.signal)
    /** 中文说明：运行时局部值 sessionId，由紧邻初始化决定。 */
    const sessionId = await terminalSessionId(sandbox, handle.pid, controlEnvs, spec.signal)
    return new E2BTerminalHandle(
      sandbox,
      handle,
      output,
      completion,
      sessionId,
      controlEnvs,
      stateDir,
      spec.graceMs,
      pollMs,
    )
  } catch (error: unknown) {
    output.destroy()
    /** 中文说明：运行时局部值 terminalQuiescent，由紧邻初始化决定。 */
    let terminalQuiescent = handle === undefined
    /** 中文说明：运行时局部值 stateRemoved，由紧邻初始化决定。 */
    let stateRemoved = !stateDirectoryCreated
    /** 中文说明：运行时局部值 cleanup，由紧邻初始化决定。 */
    const cleanup = async (): Promise<void> => {
      /** 中文说明：运行时局部值 failures，由紧邻初始化决定。 */
      const failures: Error[] = []
      if (!terminalQuiescent && handle !== undefined) {
        try {
          if (completion === undefined) await handle.kill()
          else await rollbackUnpublishedTerminal(sandbox, handle, completion, controlEnvs, spec.graceMs, pollMs)
          terminalQuiescent = true
        } catch (cleanupError: unknown) {
          if (cleanupError instanceof SandboxNotFoundError) terminalQuiescent = true
          else failures.push(asError(cleanupError))
        }
      }
      if (!stateRemoved) {
        try {
          await sandbox.files.remove(stateDir)
          stateRemoved = true
        } catch (stateError: unknown) {
          if (stateError instanceof FileNotFoundError || stateError instanceof SandboxNotFoundError) stateRemoved = true
          else failures.push(asError(stateError))
        }
      }
      if (failures.length > 0) {
        throw new AggregateError(failures, 'subprocess-e2b: terminal setup cleanup did not complete')
      }
    }
    try {
      await cleanup()
    } catch (cleanupError: unknown) {
      // TODO(e2b-terminal-setup-rollback): Retain retry state only if a real
      // double failure must be recovered before sandbox disposal or timeout.
      throw new AggregateError([asError(error), asError(cleanupError)], asError(error).message)
    }
    throw error
  }
}
