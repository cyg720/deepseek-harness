/**
 * `node:child_process` over the worker's own shell.
 *
 * A browser worker cannot fork, so this module IS the machine's process layer:
 * `spawn` starts the argv as a shell process (`src/shell/process/`) — its own
 * Web Worker, off this thread — and reports it through the `ChildProcess`
 * surface the subprocess service consumes: pipes, `exit`/`close`, pid, and
 * signals, with `SIGKILL` terminating the worker for real. Worker-owned
 * executable wrappers resolve before the shell's command table; anything in
 * neither set fails with `ENOENT`, exactly as a missing binary does on a real
 * host.
 *
 * What stays impossible is what needs a real process: synchronous execution
 * (`execSync`, and `spawnSync` for a known program) and `fork`.
 * @module @deepseek-ai/dsh-experimental-webworker-runtime/src/node/builtin_modules/implemented/child_process
 * @remarks 文件说明：文件职责：实现 experimental/webworker-runtime 中 child process
 * 模块的职责，并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与
 * Cordis 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/webworker-runtime 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 →
 * 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。
 */

import { Buffer } from 'buffer'
import { EventEmitter } from './events.ts'
import { notImplementedFail } from '../../notImplementedFail.ts'
import { registerProcess, releaseProcess, signalProcess } from '../../process-table.ts'
import { startProcess } from '../../../shell/process/host.ts'
import { hostFileSystem } from '../../../shell/fs-access.ts'
import { virtualExecutable } from '../../../shell/process/virtual-executables.ts'
import type { VirtualExecutableExit } from '../../../shell/process/virtual-executables.ts'
import { standardPrograms } from '../../../shell/programs/index.ts'
import type { ShellFileSystem } from '../../../shell/types.ts'
import { DSH_ROOT } from '../../../storage/paths.ts'

/**
 * 常量说明：MODULE 用于处理 MODULE 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const MODULE = 'node:child_process'

/** Per-stream disposition, as Node's `stdio` array spells it. */
type StdioSetting = 'pipe' | 'ignore' | 'inherit'

/** The spawn options this shim reads; Node accepts more, none of which apply here. */
export interface WorkerSpawnOptions {
  cwd?: string | undefined
  env?: Record<string, string | undefined> | undefined
  stdio?: StdioSetting | readonly StdioSetting[] | undefined
  /** Accepted and ignored: process groups do not exist, so there is no group to detach into. */
  detached?: boolean | undefined
}

/**
 * The readable half of a pipe: `data` events carrying Buffers, `end`, and a
 * `destroy` that stops delivery.
 *
 * The stream-shaping members below are no-ops rather than omissions. A caller
 * that configures the pipe before reading it (the browser launcher calls
 * `setEncoding`) would otherwise die of a TypeError on the configuration line,
 * hiding the real outcome — which for an unknown program is the `ENOENT` this
 * shim is about to emit.
 * @remarks 中文说明：类说明：WorkerReadable 用于集中封装 处理 WorkerReadable 相关状态与行为。；
 * 核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。；使用场景：由
 * experimental/webworker-runtime 在对应插件或业务生命周期内创建和调用。
 */
class WorkerReadable extends EventEmitter {
  /**
   * 变量说明：destroyed 用于处理 destroyed 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  private destroyed = false

  /**
   * Accept an encoding (chunks are always UTF-8 text carried as Buffers).
   * @returns this stream.
   * @remarks 中文说明：功能说明：设置 Encoding 相关流程；使用场景由所在模块及调用位置决定。；返回值：this；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 setEncoding()，并按返回类型处理结果。
   */
  setEncoding(): this {
    return this
  }

  /**
   * Accept a flow-control request; delivery is driven by the command, which
   * has already produced whatever it produced.
   * @returns this stream.
   * @remarks 中文说明：功能说明：处理 pause 相关流程；使用场景由所在模块及调用位置决定。；返回值：this；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 pause()，并按返回类型处理结果。
   */
  pause(): this {
    return this
  }

  /** @returns this stream; see {@link pause}.
   * @remarks 中文说明：功能说明：处理 resume 相关流程；使用场景由所在模块及调用位置决定。；返回值：this；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 resume()，并按返回类型处理结果。 */
  resume(): this {
    return this
  }

  /**
   * Deliver one chunk to the `data` listeners.
   * @param text - the text written by the command.
   * @remarks 中文说明：功能说明：处理 push 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：text（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 push(text)，并按返回类型处理结果。
   */
  push(text: string): void {
    if (this.destroyed || text === '') return
    this.emit('data', Buffer.from(text, 'utf8'))
  }

  /** Signal end of stream.
   * @remarks 中文说明：功能说明：处理 finish 相关流程；使用场景由所在模块及调用位置决定。；返回值：void；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 finish()，并按返回类型处理结果。 */
  finish(): void {
    if (this.destroyed) return
    this.emit('end')
  }

  /** Stop delivering; the collector calls this once the process settles.
   * @remarks 中文说明：功能说明：处理 destroy 相关流程；使用场景由所在模块及调用位置决定。；返回值：void；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 destroy()，并按返回类型处理结果。 */
  destroy(): void {
    this.destroyed = true
    this.emit('close')
  }
}

/** The writable half of stdin: the batch write the subprocess service performs.
 * @remarks 中文说明：类说明：WorkerWritable 用于集中封装 处理 WorkerWritable 相关状态与行为。；
 * 核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。；使用场景：由
 * experimental/webworker-runtime 在对应插件或业务生命周期内创建和调用。 */
class WorkerWritable extends EventEmitter {
  /**
   * 变量说明：text 用于处理 text 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  private text = ''

  /**
   * Buffer one write.
   * @param chunk - text or bytes to add to standard input.
   * @returns true, since nothing here applies backpressure.
   * @remarks 中文说明：功能说明：写入 write 相关流程；使用场景由所在模块及调用位置决定。；参数说明：chunk（string |
   * Uint8Array）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：boolean；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 write(chunk)，并按返回类型处理结果。
   */
  write(chunk: string | Uint8Array): boolean {
    this.text += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8')
    return true
  }

  /**
   * Finish standard input.
   * @param chunk - optional final write.
   * @remarks 中文说明：功能说明：处理 end 相关流程；使用场景由所在模块及调用位置决定。；参数说明：chunk（string |
   * Uint8Array）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 end(chunk)，并按返回类型处理结果。
   */
  end(chunk?: string | Uint8Array): void {
    if (chunk !== undefined) this.write(chunk)
    this.emit('finish')
  }

  /** @returns everything written so far.
   * @remarks 中文说明：功能说明：处理 contents 相关流程；使用场景由所在模块及调用位置决定。；返回值：string；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 contents()，并按返回类型处理结果。 */
  contents(): string {
    return this.text
  }
}

/**
 * One running command, wearing the parts of `ChildProcess` its consumers read.
 * @remarks 中文说明：类说明：WorkerChildProcess 用于集中封装 处理 WorkerChildProcess
 * 相关状态与行为。；核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。；使用场景：由
 * experimental/webworker-runtime 在对应插件或业务生命周期内创建和调用。
 */
export class WorkerChildProcess extends EventEmitter {
  /** The worker's own process id for this command, from the process table.
   * @remarks 中文说明：常量说明：pid 用于处理 pid 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
  readonly pid: number
  /** Standard input, when the caller asked for a pipe; null otherwise.
   * @remarks 中文说明：常量说明：stdin 用于处理 stdin 相关数据，作用于成员；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。 */
  readonly stdin: WorkerWritable | null
  /** Standard output, when the caller asked for a pipe; null otherwise.
   * @remarks 中文说明：常量说明：stdout 用于处理 stdout 相关数据，作用于成员；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。 */
  readonly stdout: WorkerReadable | null
  /** Standard error, when the caller asked for a pipe; null otherwise.
   * @remarks 中文说明：常量说明：stderr 用于处理 stderr 相关数据，作用于成员；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。 */
  readonly stderr: WorkerReadable | null
  /** Exit status once settled; null while running and after a signal.
   * @remarks 中文说明：变量说明：exitCode 用于处理 exitCode 相关数据，作用于成员；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。 */
  exitCode: number | null = null
  /** The signal that ended the command, or null when it exited on its own.
   * @remarks 中文说明：变量说明：signalCode 用于处理 signalCode 相关数据，作用于成员；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。 */
  signalCode: NodeJS.Signals | null = null

  /**
   * 功能说明：处理 WorkerChildProcess 相关流程；使用场景由所在模块及调用位置决定。
   * @param pid （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param stdio （readonly StdioSetting[]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns 当前类实例；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 通过 new WorkerChildProcess(pid, stdio) 创建实例，并在所属生命周期内使用。
   */
  constructor(pid: number, stdio: readonly StdioSetting[]) {
    super()
    this.pid = pid
    this.stdin = stdio[0] === 'pipe' ? new WorkerWritable() : null
    this.stdout = stdio[1] === 'pipe' ? new WorkerReadable() : null
    this.stderr = stdio[2] === 'pipe' ? new WorkerReadable() : null
  }

  /**
   * Deliver a signal to this command.
   * @param signal - signal name; every one of them terminates.
   * @returns true when the command was still running.
   * @remarks 中文说明：功能说明：处理 kill 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：signal（NodeJS.Signals）：传递取消或终止信号；必须满足声明的类型及调用时序要求。；返回值：boolean；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 kill(signal)，并按返回类型处理结果。
   */
  kill(signal: NodeJS.Signals = 'SIGTERM'): boolean {
    return signalProcess(this.pid, signal)
  }
}

/** Normalize the `stdio` option into the three-entry form the shim reads.
 * @remarks 中文说明：功能说明：处理 stdioOf 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：option（WorkerSpawnOptions['stdio']）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。；
 * 返回值：StdioSetting[]；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * stdioOf(option)，并按返回类型处理结果。 */
function stdioOf(option: WorkerSpawnOptions['stdio']): StdioSetting[] {
  if (typeof option === 'string') return [option, option, option]
  if (option === undefined) return ['pipe', 'pipe', 'pipe']
  return [option[0] ?? 'pipe', option[1] ?? 'pipe', option[2] ?? 'pipe']
}

/** The environment a command runs with: the caller's map, minus the removals Node allows.
 * @remarks 中文说明：功能说明：处理 environmentOf 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：option（WorkerSpawnOptions['env']）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。；
 * 返回值：Record<string, string>；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 environmentOf(option)，并按返回类型处理结果。 */
function environmentOf(option: WorkerSpawnOptions['env']): Record<string, string> {
  /**
   * 常量说明：inherited 用于处理 inherited 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const inherited = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {}
  /**
   * 常量说明：source 用于处理 source 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const source = option ?? inherited
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：[, value]（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调([, value])，并按返回类型处理结果。
   */
  return Object.fromEntries(Object.entries(source).filter(([, value]) => value !== undefined) as [string, string][])
}

/**
 * A missing program fails the way Node fails a missing binary, so consumers
 * that classify spawn errors by `code`, `path`, and `syscall` keep working.
 * @remarks 中文说明：功能说明：处理 spawnEnoent 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：program（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：NodeJS.ErrnoException；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * spawnEnoent(program)，并按返回类型处理结果。
 */
function spawnEnoent(program: string): NodeJS.ErrnoException {
  /**
   * 常量说明：error 用于处理 error 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const error = new Error(`spawn ${program} ENOENT`) as NodeJS.ErrnoException
  error.code = 'ENOENT'
  error.errno = -2
  error.path = program
  error.syscall = `spawn ${program}`
  return error
}

/** Whether this argv is a shell invocation whose script the interpreter should parse.
 * @remarks 中文说明：功能说明：处理 shellScriptOf 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：argv（readonly string[]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：string |
 * undefined；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * shellScriptOf(argv)，并按返回类型处理结果。 */
function shellScriptOf(argv: readonly string[]): string | undefined {
  /**
   * 常量说明：program、flag、script 用于处理 program、flag、script 相关数据，作用于当前作用域；
   * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const [program, flag, script] = argv
  if ((program !== 'bash' && program !== 'sh') || flag !== '-c') return undefined
  return script ?? ''
}

/**
 * Run one command in the worker.
 *
 * The call returns immediately with a handle; the command runs in its own
 * worker (or inline where no `Worker` exists) and reports back through the
 * handle's pipes and events.
 * @param program - the program name, as argv[0].
 * @param args - its arguments.
 * @param options - working directory, environment, and stdio dispositions.
 * @returns the running command's handle.
 * @remarks 中文说明：功能说明：处理 spawn 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：program（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数说明：args（readonly
 * string[]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：options（WorkerSpawnOptions）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。；
 * 返回值：WorkerChildProcess；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * spawn(program, args, options)，并按返回类型处理结果。
 */
export function spawn(
  program: string,
  args: readonly string[] = [],
  options: WorkerSpawnOptions = {},
): WorkerChildProcess {
  if (typeof program !== 'string' || program === '') {
    // Node refuses a non-string command with this error rather than starting
    // anything; a caller whose own lookup produced nothing reads why.
    /**
     * 常量说明：invalid 用于处理 invalid 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const invalid = new TypeError(`The "file" argument must be a non-empty string. Received ${program as unknown as string}`) as NodeJS.ErrnoException
    invalid.code = 'ERR_INVALID_ARG_TYPE'
    throw invalid
  }
  /**
   * 常量说明：argv 用于处理 argv 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const argv = [program, ...args]
  /**
   * 常量说明：stdio 用于处理 stdio 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const stdio = stdioOf(options.stdio)
  /**
   * 常量说明：entry 用于处理 entry 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const entry = registerProcess()
  /**
   * 常量说明：child 用于处理 child 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const child = new WorkerChildProcess(entry.pid, stdio)

  /**
   * 常量说明：emit 用于发送 emit 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   * 功能说明：发送 emit 相关流程；使用场景由所在模块及调用位置决定。
   * @param stream （'stdout' | 'stderr'）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param text （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 emit(stream, text)，并按返回类型处理结果。
   */
  const emit = (stream: 'stdout' | 'stderr', text: string): void => {
    if (text === '') return
    /**
     * 常量说明：pipe 用于处理 pipe 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const pipe = stream === 'stdout' ? child.stdout : child.stderr
    if (pipe !== null) {
      pipe.push(text)
      return
    }
    // An inherited stream belongs to the host: the worker's console is the
    // only place it can go, and an ignored one goes nowhere.
    if (stdio[stream === 'stdout' ? 1 : 2] === 'inherit') {
      (stream === 'stdout' ? console.log : console.error)(text.replace(/\n$/, ''))
    }
  }

  /**
   * 变量说明：settled 用于处理 settled 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let settled = false
  /**
   * 常量说明：settle 用于处理 settle 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   * 功能说明：处理 settle 相关流程；使用场景由所在模块及调用位置决定。
   * @param exitCode （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 settle(exitCode)，并按返回类型处理结果。
   */
  const settle = (exitCode: number): void => {
    if (settled) return
    settled = true
    releaseProcess(entry.pid)
    // A signalled command reports no exit code, which is what makes the
    // subprocess service classify it as killed rather than finished.
    /**
     * 常量说明：signal 用于处理 signal 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const signal = entry.signal ?? null
    child.exitCode = signal === null ? exitCode : null
    child.signalCode = signal
    child.stdout?.finish()
    child.stderr?.finish()
    child.emit('exit', child.exitCode, signal)
    child.emit('close', child.exitCode, signal)
  }
  /**
   * 常量说明：failSpawn 用于处理 failSpawn 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   * 功能说明：处理 failSpawn 相关流程；使用场景由所在模块及调用位置决定。
   * @param error （Error）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 failSpawn(error)，并按返回类型处理结果。
   */
  const failSpawn = (error: Error): void => {
    if (settled) return
    settled = true
    releaseProcess(entry.pid)
    child.emit('error', error)
  }

  // The command starts on a microtask, so a caller that attaches listeners and
  // writes standard input right after `spawn()` — the subprocess service does
  // exactly that — is never racing the first output.
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  queueMicrotask(() => {
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：error（unknown）：提供本次调用所需的数据；
     * 必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；
     * 典型用法：在完成前置校验后调用 匿名回调(error)，并按返回类型处理结果。
     */
    void (async () => {
      /**
       * 常量说明：cwd 用于处理 cwd 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const cwd = options.cwd ?? DSH_ROOT
      /**
       * 变量说明：commandArgv 用于处理 commandArgv 相关数据，作用于当前作用域；其值可能随流程推进而变化，
       * 读写时需遵守声明类型和所在生命周期。
       */
      let commandArgv: readonly string[] = argv
      /**
       * 变量说明：filesystem 用于处理 filesystem 相关数据，作用于当前作用域；其值可能随流程推进而变化，
       * 读写时需遵守声明类型和所在生命周期。
       */
      let filesystem: ShellFileSystem | undefined
      /**
       * 变量说明：missingExecutable 用于处理 missingExecutable 相关数据，作用于当前作用域；其值可能随流程推进而变化，
       * 读写时需遵守声明类型和所在生命周期。
       */
      let missingExecutable: VirtualExecutableExit | undefined
      /**
       * 常量说明：executable 用于处理 executable 相关数据，作用于当前作用域；初始化后不可重新赋值，
       * 但对象内部是否可变仍由其类型决定。
       */
      const executable = virtualExecutable(program)
      if (executable !== undefined) {
        /**
         * 常量说明：prepared 用于处理 prepared 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const prepared = await executable.prepare(args, { cwd, filesystem: hostFileSystem() })
        if (prepared.kind === 'exit') {
          emit('stdout', prepared.stdout)
          emit('stderr', prepared.stderr)
          settle(prepared.exitCode)
          return
        }
        commandArgv = prepared.argv
        filesystem = prepared.filesystem
        missingExecutable = prepared.missingExecutable
      }

      /**
       * 常量说明：command 用于处理 command 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const command = commandArgv[0] as string
      /**
       * 常量说明：script 用于处理 script 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const script = shellScriptOf(commandArgv)
      /**
       * 常量说明：known 用于处理 known 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const known = script !== undefined || standardPrograms().has(command)
      if (!known) {
        if (missingExecutable !== undefined) {
          emit('stdout', missingExecutable.stdout)
          emit('stderr', missingExecutable.stderr)
          settle(missingExecutable.exitCode)
        } else {
          failSpawn(spawnEnoent(program))
        }
        return
      }
      entry.process = startProcess({
        script,
        argv: commandArgv,
        cwd,
        env: environmentOf(options.env),
        stdin: child.stdin?.contents() ?? '',
        onOutput: emit,
        onExit: settle,
        ...filesystem === undefined ? {} : { fs: filesystem },
      })
      // A signal that arrived while the process was still starting has to reach
      // it now; the table recorded it but had nothing to deliver it to.
      if (entry.signal !== undefined) {
        if (entry.signal === 'SIGKILL') entry.process.destroy()
        else entry.process.interrupt()
      }
    })().catch((error: unknown) => {
      failSpawn(error instanceof Error ? error : new Error(String(error)))
    })
  })

  return child
}

/** The result shape `spawnSync` returns, holding only the members consumers read. */
export interface WorkerSpawnSyncResult {
  pid: number
  status: number | null
  signal: NodeJS.Signals | null
  stdout: Buffer
  stderr: Buffer
  output: (Buffer | null)[]
  /** Why the run did not happen; carries `code` for the callers that classify by it. */
  error?: NodeJS.ErrnoException
}

/**
 * Report that a command cannot run synchronously.
 *
 * Callers use `spawnSync` to probe for a binary (the sandbox runner probes do)
 * and Node answers a missing one with an `error` rather than a throw, so this
 * answers in the same shape: absent programs report `ENOENT`, and a program
 * this shell *does* have reports that only the asynchronous path can run it.
 * @param program - the program name.
 * @param args - arguments passed to the virtual launcher probe.
 * @returns the Node-shaped synchronous result carrying the failure.
 * @remarks 中文说明：功能说明：处理 spawnSync 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：program（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数说明：args（readonly
 * string[]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：WorkerSpawnSyncResult；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 spawnSync(program, args)，
 * 并按返回类型处理结果。
 */
export function spawnSync(program: string, args: readonly string[] = []): WorkerSpawnSyncResult {
  /**
   * 常量说明：empty 用于处理 empty 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const empty = Buffer.alloc(0)
  /**
   * 常量说明：executable 用于处理 executable 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const executable = virtualExecutable(program)
  if (executable !== undefined) {
    /**
     * 常量说明：result 用于处理 result 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const result = executable.runSync(args)
    if (result.kind === 'asynchronous') {
      /**
       * 常量说明：error 用于处理 error 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const error = new Error(`${MODULE}.spawnSync cannot run ${program} in the worker host: commands run asynchronously`)
      return { pid: -1, status: null, signal: null, stdout: empty, stderr: empty, output: [null, empty, empty], error }
    }
    /**
     * 常量说明：stdout 用于处理 stdout 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const stdout = Buffer.from(result.stdout)
    /**
     * 常量说明：stderr 用于处理 stderr 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const stderr = Buffer.from(result.stderr)
    return { pid: -1, status: result.exitCode, signal: null, stdout, stderr, output: [null, stdout, stderr] }
  }
  /**
   * 常量说明：error 用于处理 error 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const error = standardPrograms().has(program)
    ? new Error(`${MODULE}.spawnSync cannot run ${program} in the worker host: commands run asynchronously`)
    : spawnEnoent(program)
  return { pid: -1, status: null, signal: null, stdout: empty, stderr: empty, output: [null, empty, empty], error }
}

/** Callback `exec` and `execFile` report through. */
type ExecCallback = (error: Error | null, stdout: string, stderr: string) => void

/** Split the optional options argument from the callback Node allows in either position.
 * @remarks 中文说明：功能说明：处理 execArguments 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：options（WorkerSpawnOptions | ExecCallback |
 * undefined）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。；参数说明：callback（ExecCallback |
 * undefined）：接收后续状态或事件并执行调用方逻辑；必须满足声明的类型及调用时序要求。；返回值：{ options:
 * WorkerSpawnOptions; callback: ExecCallback | undefined }；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 execArguments(options, callback)，
 * 并按返回类型处理结果。 */
function execArguments(
  options: WorkerSpawnOptions | ExecCallback | undefined,
  callback: ExecCallback | undefined,
): { options: WorkerSpawnOptions; callback: ExecCallback | undefined } {
  if (typeof options === 'function') return { options: {}, callback: options }
  return { options: options ?? {}, callback }
}

/**
 * Run a command line and report its output through a callback.
 * @param command - the shell source to run.
 * @param options - working directory and environment, or the callback.
 * @param callback - receives the failure (nonzero status included), stdout, and stderr.
 * @returns the running command's handle.
 * @remarks 中文说明：功能说明：处理 exec 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：command（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：options（WorkerSpawnOptions | ExecCallback）：提供本次操作使用的配置选项；
 * 必须满足声明的类型及调用时序要求。；参数说明：callback（ExecCallback）：接收后续状态或事件并执行调用方逻辑；
 * 必须满足声明的类型及调用时序要求。；返回值：WorkerChildProcess；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 exec(command, options, callback)，并按返回类型处理结果。
 */
export function exec(
  command: string,
  options?: WorkerSpawnOptions | ExecCallback,
  callback?: ExecCallback,
): WorkerChildProcess {
  /**
   * 常量说明：settled 用于处理 settled 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const settled = execArguments(options, callback)
  return execute(['bash', '-c', command], settled.options, settled.callback)
}

/**
 * Run one program with an explicit argv and report its output through a callback.
 * @param program - the program name.
 * @param args - its arguments, or the options, or the callback.
 * @param options - working directory and environment, or the callback.
 * @param callback - receives the failure (nonzero status included), stdout, and stderr.
 * @returns the running command's handle.
 * @remarks 中文说明：功能说明：处理 execFile 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：program（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数说明：args（readonly
 * string[] | WorkerSpawnOptions | ExecCallback）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。；参数说明：options（WorkerSpawnOptions |
 * ExecCallback）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。；
 * 参数说明：callback（ExecCallback）：接收后续状态或事件并执行调用方逻辑；必须满足声明的类型及调用时序要求。；
 * 返回值：WorkerChildProcess；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * execFile(program, args, options, callback)，并按返回类型处理结果。
 */
export function execFile(
  program: string,
  args?: readonly string[] | WorkerSpawnOptions | ExecCallback,
  options?: WorkerSpawnOptions | ExecCallback,
  callback?: ExecCallback,
): WorkerChildProcess {
  /**
   * 常量说明：argv 用于处理 argv 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const argv = Array.isArray(args) ? [program, ...args as string[]] : [program]
  /**
   * 常量说明：shifted 用于处理 shifted 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const shifted = Array.isArray(args) ? options : args as WorkerSpawnOptions | ExecCallback | undefined
  /**
   * 常量说明：settled 用于处理 settled 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const settled = execArguments(shifted, typeof options === 'function' ? options : callback)
  return execute(argv, settled.options, settled.callback)
}

/** Shared body of `exec` and `execFile`: spawn, collect both streams, then report.
 * @remarks 中文说明：功能说明：执行 execute 相关流程；使用场景由所在模块及调用位置决定。；参数说明：argv（readonly
 * string[]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：options（WorkerSpawnOptions）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。；
 * 参数说明：callback（ExecCallback | undefined）：接收后续状态或事件并执行调用方逻辑；
 * 必须满足声明的类型及调用时序要求。；返回值：WorkerChildProcess；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 execute(argv, options, callback)，并按返回类型处理结果。 */
function execute(argv: readonly string[], options: WorkerSpawnOptions, callback: ExecCallback | undefined): WorkerChildProcess {
  /**
   * 常量说明：child 用于处理 child 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const child = spawn(argv[0] as string, argv.slice(1), { ...options, stdio: 'pipe' })
  /**
   * 变量说明：stdout 用于处理 stdout 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let stdout = ''
  /**
   * 变量说明：stderr 用于处理 stderr 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let stderr = ''
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：chunk（unknown）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 典型用法：在完成前置校验后调用 匿名回调(chunk)，并按返回类型处理结果。
   */
  child.stdout?.on('data', (chunk: unknown) => { stdout += String(chunk) })
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：chunk（unknown）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 典型用法：在完成前置校验后调用 匿名回调(chunk)，并按返回类型处理结果。
   */
  child.stderr?.on('data', (chunk: unknown) => { stderr += String(chunk) })
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：error（unknown）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 典型用法：在完成前置校验后调用 匿名回调(error)，并按返回类型处理结果。
   */
  child.on('error', (error: unknown) => { callback?.(error instanceof Error ? error : new Error(String(error)), stdout, stderr) })
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：code（unknown）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 典型用法：在完成前置校验后调用 匿名回调(code)，并按返回类型处理结果。
   */
  child.on('close', (code: unknown) => {
    /**
     * 常量说明：status 用于处理 status 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const status = typeof code === 'number' ? code : 1
    callback?.(status === 0 ? null : new Error(`Command failed: ${argv.join(' ')}`), stdout, stderr)
  })
  return child
}

/** Run a command line synchronously (unavailable: the interpreter is asynchronous).
 * @remarks 中文说明：常量说明：execSync 用于处理 execSync 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
export const execSync: typeof import('node:child_process').execSync = notImplementedFail(MODULE, 'execSync')

/** Run one program synchronously (unavailable: the interpreter is asynchronous).
 * @remarks 中文说明：常量说明：execFileSync 用于处理 execFileSync 相关数据，作用于当前作用域；
 * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
export const execFileSync: typeof import('node:child_process').execFileSync = notImplementedFail(MODULE, 'execFileSync')

/** Start a Node child (unavailable: the worker cannot create another Node runtime).
 * @remarks 中文说明：常量说明：fork 用于处理 fork 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
export const fork: typeof import('node:child_process').fork = notImplementedFail(MODULE, 'fork')

/** CommonJS interop marker: the worker loader hands `default` to default imports (see ../../builtins.ts).
 * @remarks 中文说明：常量说明：__esModule 用于处理 __esModule 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
export const __esModule = true

/**
 * The `node:child_process` declarations this module stands in for. The four
 * process starters keep this module's own types: they answer
 * {@link WorkerChildProcess} and {@link WorkerSpawnSyncResult}, the pipes and exit
 * facts a shell worker can carry, where Node declares a `ChildProcess` holding OS
 * stream objects and, for `exec`/`execFile`, an overload ladder over encodings
 * this shell reports as UTF-8 text.
 */
type NodeFace = Partial<Omit<typeof import('node:child_process'), 'spawn' | 'spawnSync' | 'exec' | 'execFile'>>
  & Record<'spawn' | 'spawnSync' | 'exec' | 'execFile', unknown>

/** CommonJS default export: the members `require()` hands a caller of this module. */
export default { spawn, spawnSync, exec, execFile, execFileSync, execSync, fork } satisfies NodeFace
