/**
 * E2B Service Provider for the subprocess capability seam. Each handle starts through the
 * shared sandbox and retains command output/status paths in that remote world.
 * @module @deepseek-ai/dsh-subprocess-e2b
 */
/**
 * 文件职责：实现E2B 远程沙箱的 index.ts 模块。
 * 技术维度：TypeScript、Cordis、异步资源生命周期、远程文件/进程接口和 Vitest。
 * 产品维度：保证E2B 远程沙箱在真实组装、失败和清理场景中可靠。
 * 逻辑维度：注册能力，转换请求并管理远程资源。
 * 关键边界：凭据不得泄漏；远程句柄、终端和后台进程必须在取消或卸载时释放。
 * 新手阅读建议：先读接口和夹具，再按创建、操作、错误和清理流程阅读。
 */

import { randomUUID } from 'node:crypto'
import { posix } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import type {
  SubprocessHandle,
  SubprocessSpawnSpec,
  SubprocessTerminalHandle,
  SubprocessTerminalSpawnSpec,
} from '@deepseek-ai/dsh-subprocess'
import { e2bControlEnvs, quoteE2BShellArg } from '@deepseek-ai/dsh-e2b'
import { E2BSubprocessHandle } from './process.ts'
import { asError, signalOpts } from './remote.ts'
import { spawnE2BTerminal } from './terminal.ts'

/** Configuration for the E2B subprocess adapter. */
/** 中文说明：类型或类 Config 约束远程资源或测试数据职责。 */
export interface Config {
  /** Remote status/liveness poll cadence in milliseconds; each tick is one control-plane request. */
  pollMs?: number
}

/** 中文说明：类型或类 SchemaResolvedConfig 约束远程资源或测试数据职责。 */
interface SchemaResolvedConfig extends Config {
  pollMs: number
}

/** 中文说明：类型或类 TerminalSetup 约束远程资源或测试数据职责。 */
interface TerminalSetup {
  done: Promise<void>
  controller: AbortController
}

/**
 * Enforce the seam's documented grace bound (positive, finite, one Node timer),
 * matching subprocess-local's spawn-time check; an unbounded grace would make
 * the remote force-escalation deadline unreachable.
 * @param graceMs - The spec's cleanup grace in milliseconds.
 */
/** 中文说明：函数 requireRepresentableGrace 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function requireRepresentableGrace(graceMs: number): void {
  if (!Number.isFinite(graceMs) || graceMs <= 0 || graceMs > MAX_TIMER_DELAY_MS) {
    throw new Error(`subprocess graceMs must be a positive finite number no greater than ${MAX_TIMER_DELAY_MS}`)
  }
}

/** E2B command manager registered as `ctx.subprocess`. */
/** 中文说明：类型或类 E2BSubprocessRuntime 约束远程资源或测试数据职责。 */
export class E2BSubprocessRuntime extends SubprocessRuntime {
  static inject = ['e2b']

  static Config: z<Config> = z.object({
    pollMs: z.number().default(20),
  })

  private readonly live = new Set<E2BSubprocessHandle>()
  private readonly terminals = new Set<SubprocessTerminalHandle>()
  private readonly terminalSetups = new Set<TerminalSetup>()
  private readonly pollMs: number
  private disposing = false

  /** Create the E2B subprocess service and bind its disposal policy. */
  constructor(ctx: Context, config: Config) {
    super(ctx)
    // Schemastery fills pollMs before construction; the type does not encode that step.
    /** 中文说明：运行时局部值 { pollMs }，由紧邻初始化决定。 */
    const { pollMs } = config as SchemaResolvedConfig
    if (!Number.isSafeInteger(pollMs) || pollMs <= 0) {
      throw new Error('subprocess-e2b: pollMs must be a positive safe integer')
    }
    this.pollMs = pollMs
    ctx.effect(() => async () => {
      this.disposing = true
      /** 中文说明：运行时局部值 setup，由紧邻初始化决定。 */
      for (const setup of this.terminalSetups) {
        setup.controller.abort(new Error('subprocess-e2b: service disposed during terminal setup'))
      }
      await Promise.all([...this.terminalSetups].map(setup => setup.done))
      /** 中文说明：运行时局部值 handles，由紧邻初始化决定。 */
      const handles = [...this.live]
      /** 中文说明：运行时局部值 terminals，由紧邻初始化决定。 */
      const terminals = [...this.terminals]
      /** 中文说明：运行时局部值 pending，由紧邻初始化决定。 */
      const pending: Promise<unknown>[] = []
      /** 中文说明：运行时局部值 handle，由紧邻初始化决定。 */
      for (const handle of handles) {
        handle.terminate()
        pending.push(handle.waitForExit().then(async () => {
          await handle.done.catch(() => undefined)
          this.live.delete(handle)
        }))
      }
      /** 中文说明：运行时局部值 terminal，由紧邻初始化决定。 */
      for (const terminal of terminals) {
        pending.push(terminal.terminate().then(() => { this.terminals.delete(terminal) }))
      }
      /** 中文说明：运行时局部值 outcomes，由紧邻初始化决定。 */
      const outcomes = await Promise.allSettled(pending)
      /** 中文说明：运行时局部值 failures，由紧邻初始化决定。 */
      const failures = outcomes.flatMap<unknown>(outcome => outcome.status === 'rejected'
        ? [outcome.reason as unknown]
        : [])
      if (failures.length === 1) throw asError(failures[0])
      if (failures.length > 1) throw new AggregateError(failures, 'subprocess-e2b: teardown failed')
    }, 'e2b subprocess teardown')
  }

  /** @inheritdoc */
  async resolveExecutable(
    command: string,
    env?: Readonly<Record<string, string>>,
    signal?: AbortSignal,
  ): Promise<string> {
    if (command.length === 0) throw new Error('subprocess-e2b: executable name must be non-empty')
    signal?.throwIfAborted()
    /** 中文说明：运行时局部值 sandbox，由紧邻初始化决定。 */
    const sandbox = await this.ctx.e2b.getSandbox()
    if (posix.isAbsolute(command)) {
      await sandbox.commands.run(
        `test -f ${quoteE2BShellArg(command)} -a -x ${quoteE2BShellArg(command)}`,
        { envs: e2bControlEnvs(), ...signalOpts(signal) },
      )
      signal?.throwIfAborted()
      return command
    }
    if (command.includes('/')) {
      throw new Error(
        `subprocess-e2b: command ${JSON.stringify(command)} is a relative path; use an absolute path or a bare PATH name`,
      )
    }
    /** 中文说明：运行时局部值 path，由紧邻初始化决定。 */
    const path = env?.PATH
    /** 中文说明：运行时局部值 prefix，由紧邻初始化决定。 */
    const prefix = path === undefined ? '' : `PATH=${quoteE2BShellArg(path)} `
    /** 中文说明：运行时局部值 result，由紧邻初始化决定。 */
    const result = await sandbox.commands.run(
      `${prefix}command -v -- ${quoteE2BShellArg(command)}`,
      { cwd: this.ctx.e2b.cwd, envs: e2bControlEnvs(), ...signalOpts(signal) },
    )
    signal?.throwIfAborted()
    /** 中文说明：运行时局部值 executable，由紧邻初始化决定。 */
    const executable = result.stdout.trim()
    if (executable.includes('\n') || (!posix.isAbsolute(executable) && !executable.includes('/'))) {
      throw new Error(`subprocess-e2b: executable ${JSON.stringify(command)} did not resolve to one absolute path`)
    }
    // A relative result comes from a relative PATH entry; the lookup ran with the shared cwd.
    return posix.resolve(this.ctx.e2b.cwd, executable)
  }

  /** @inheritdoc */
  spawn(spec: SubprocessSpawnSpec): SubprocessHandle {
    if (this.disposing) throw new Error('subprocess-e2b: service is disposing')
    /** 中文说明：运行时局部值 program，由紧邻初始化决定。 */
    const program = spec.argv[0]
    if (program === undefined || program.length === 0) {
      throw new Error('invalid argv: expected a non-empty program name at argv[0]')
    }
    requireRepresentableGrace(spec.graceMs)
    if (spec.signal?.aborted === true) {
      throw new Error(`aborted before spawn: ${String(spec.signal.reason)}`)
    }
    /** 中文说明：运行时局部值 stateDir，由紧邻初始化决定。 */
    const stateDir = posix.join(this.ctx.e2b.runtimeRoot, 'processes', randomUUID())
    /** 中文说明：运行时局部值 handle，由紧邻初始化决定。 */
    const handle = new E2BSubprocessHandle(this.ctx.e2b, spec, stateDir, this.pollMs)
    this.live.add(handle)
    /** 中文说明：运行时局部值 release，由紧邻初始化决定。 */
    const release = async (): Promise<void> => {
      await handle.waitForExit()
      this.live.delete(handle)
    }
    void handle.done.then(release, release).catch((_automaticReleaseFailure: unknown) => {
      // Retain the handle so service disposal can retry its cleanup transaction.
    })
    return handle
  }

  /** @inheritdoc */
  async spawnTerminal(spec: SubprocessTerminalSpawnSpec): Promise<SubprocessTerminalHandle> {
    if (this.disposing) throw new Error('subprocess-e2b: service is disposing')
    /** 中文说明：运行时局部值 program，由紧邻初始化决定。 */
    const program = spec.argv[0]
    if (program === undefined || program.length === 0) {
      throw new Error('subprocess-e2b: terminal argv must contain a program')
    }
    requireRepresentableGrace(spec.graceMs)
    spec.signal?.throwIfAborted()
    /** 中文说明：运行时局部值 stateDir，由紧邻初始化决定。 */
    const stateDir = posix.join(this.ctx.e2b.runtimeRoot, 'terminals', randomUUID())
    /** 中文说明：运行时局部值 done，由紧邻初始化决定。 */
    const done = Promise.withResolvers<void>()
    /** 中文说明：运行时局部值 setup，由紧邻初始化决定。 */
    const setup: TerminalSetup = { done: done.promise, controller: new AbortController() }
    /** 中文说明：运行时局部值 setupSignal，由紧邻初始化决定。 */
    const setupSignal = spec.signal === undefined
      ? setup.controller.signal
      : AbortSignal.any([spec.signal, setup.controller.signal])
    this.terminalSetups.add(setup)
    try {
      /** 中文说明：运行时局部值 terminal，由紧邻初始化决定。 */
      const terminal = await spawnE2BTerminal(
        this.ctx.e2b,
        { ...spec, signal: setupSignal },
        stateDir,
        this.pollMs,
      )
      this.terminals.add(terminal)
      // oxlint-disable-next-line typescript/no-unnecessary-condition -- Remote allocation yields to disposal.
      if (this.disposing) {
        await terminal.terminate()
        this.terminals.delete(terminal)
        throw new Error('subprocess-e2b: service disposed during terminal setup')
      }
      /** 中文说明：运行时局部值 release，由紧邻初始化决定。 */
      const release = async (): Promise<void> => {
        await terminal.terminate()
        this.terminals.delete(terminal)
      }
      void terminal.done.then(release, release).catch((_automaticReleaseFailure: unknown) => {
        // Retain the terminal so service disposal can retry its cleanup transaction.
      })
      return terminal
    } finally {
      this.terminalSetups.delete(setup)
      done.resolve()
    }
  }
}

export default E2BSubprocessRuntime
