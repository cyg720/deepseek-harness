/**
 * The interpreter: it walks the parsed command line and runs the command table
 * against the VFS. Structure (`;` `&` `|` `|&` `&&` `||`, subshells, groups,
 * redirections, prefix assignments) is honored here; what a command *does*
 * belongs to its program in `./programs/`.
 *
 * Output is text, not streams: every program is a JavaScript function that
 * returns before the next one runs, so a pipeline hands a string along instead
 * of plumbing byte streams a browser worker has no way to schedule between.
 * @module @deepseek-ai/dsh-experimental-webworker-runtime/src/shell/interpret
 * @remarks 文件说明：文件职责：实现 experimental/webworker-runtime 中 interpret 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/webworker-runtime 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 →
 * 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。
 */

import { parseShell } from '@yarnpkg/parsers'
import type { Command, CommandChain, CommandLine, RedirectArgument, ShellLine, ValueArgument } from './ast.ts'
import { expandArgument, isGlobPattern } from './expand.ts'
import type { ExpansionContext } from './expand.ts'
import { describeFailure, hostFileSystem, resolveIn } from './fs-access.ts'
import { standardPrograms } from './programs/index.ts'
import type { ShellFileSystem, ShellIo, ShellProgram, ShellRunOutcome, ShellState } from './types.ts'

/** Status a command line reports once the caller's abort signal has fired.
 * @remarks 中文说明：常量说明：ABORTED_STATUS 用于处理 ABORTED_STATUS 相关数据，作用于当前作用域；
 * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
const ABORTED_STATUS = 130

/** Status of a command name the table does not hold, as POSIX shells report it.
 * @remarks 中文说明：常量说明：NOT_FOUND_STATUS 用于处理 NOT_FOUND_STATUS 相关数据，作用于当前作用域；
 * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
const NOT_FOUND_STATUS = 127

/** Nesting limit for `$( … )`; a deeper line is a runaway, not a command.
 * @remarks 中文说明：常量说明：MAX_SUBSTITUTION_DEPTH 用于处理 MAX_SUBSTITUTION_DEPTH
 * 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
const MAX_SUBSTITUTION_DEPTH = 16

/** Everything one `bash -c` invocation needs. */
export interface ShellRunOptions {
  /** Working directory the line starts in. */
  cwd: string
  /** Environment the line starts with. */
  env: Record<string, string>
  /** Standard input contents; absent means empty. */
  stdin?: string | undefined
  /** Cancellation: an aborted line stops before its next command. */
  signal?: AbortSignal | undefined
  /**
   * The filesystem this run acts on; defaults to the VFS mounted in this
   * thread. A run inside a process worker passes the message-backed one.
   */
  fs?: ShellFileSystem | undefined
  /**
   * Called with each write as it happens, before the run settles. The returned
   * outcome still carries the complete text; this only lets a caller that
   * reports progress (a background job's incremental reads) see output while
   * the line is still running.
   */
  onOutput?: ((stream: 'stdout' | 'stderr', text: string) => void) | undefined
}

/** Accumulates one output stream. */
interface Sink {
  write: (text: string) => void
}

/** A sink over a string buffer, for pipelines and command substitution.
 * @remarks 中文说明：功能说明：处理 buffer 相关流程；使用场景由所在模块及调用位置决定。；返回值：Sink & { text():
 * string }；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 buffer()，
 * 并按返回类型处理结果。 */
/**
 * 功能说明：处理 text 相关流程；使用场景由所在模块及调用位置决定。
 * @returns string；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 text()，并按返回类型处理结果。
 */
function buffer(): Sink & { text(): string } {
  /**
   * 常量说明：chunks 用于处理 chunks 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const chunks: string[] = []
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：text（string）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 典型用法：在完成前置校验后调用 匿名回调(text)，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  return {
    write: (text: string) => { chunks.push(text) },
    text: () => chunks.join(''),
  }
}

/**
 * Run one shell command line to completion.
 * @param source - the command source, exactly as `bash -c` would receive it.
 * @param options - starting directory, environment, standard input, cancellation, filesystem, output callback.
 * @returns the exit status and the complete standard output and standard error.
 * @remarks 中文说明：功能说明：执行 Shell Command 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：source（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：options（ShellRunOptions）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。；
 * 返回值：Promise<ShellRunOutcome>；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 runShellCommand(source, options)，并按返回类型处理结果。
 */
export async function runShellCommand(source: string, options: ShellRunOptions): Promise<ShellRunOutcome> {
  /**
   * 常量说明：run 用于执行 run 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const run = startRun(options)
  /**
   * 变量说明：line 用于处理 line 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let line: ShellLine
  /**
   * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
   */
  try {
    line = parseShell(source, { isGlobPattern })
  } catch (error) {
    run.io.err(`bash: syntax error: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}\n`)
    return run.settle(2)
  }
  /**
   * 常量说明：interpreter 用于处理 interpreter 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const interpreter = new Interpreter(standardPrograms(), options.fs ?? hostFileSystem(), options.signal)
  return run.settle(await interpreter.line(line, run.state, run.io))
}

/**
 * Run one program directly, without a command line to parse.
 *
 * This is the path for an argv the caller already has in pieces — a spawn that
 * names a program instead of handing `bash` a script — so nothing re-quotes
 * words that were never quoted in the first place.
 * @param argv - the program name at index 0, then its arguments.
 * @param options - starting directory, environment, standard input, cancellation, filesystem, output callback.
 * @returns the exit status and the complete standard output and standard error.
 * @remarks 中文说明：功能说明：执行 Shell Program 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：argv（readonly string[]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：options（ShellRunOptions）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。；
 * 返回值：Promise<ShellRunOutcome>；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 runShellProgram(argv, options)，并按返回类型处理结果。
 */
export async function runShellProgram(argv: readonly string[], options: ShellRunOptions): Promise<ShellRunOutcome> {
  /**
   * 常量说明：run 用于执行 run 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const run = startRun(options)
  /**
   * 常量说明：name 用于处理 name 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const name = argv[0]
  /**
   * 常量说明：program 用于处理 program 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const program = name === undefined ? undefined : standardPrograms().get(name)
  if (name === undefined || program === undefined) {
    run.io.err(`bash: ${name ?? ''}: command not found\n`)
    return run.settle(NOT_FOUND_STATUS)
  }
  if (options.signal?.aborted === true) return run.settle(ABORTED_STATUS)
  /**
   * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
   */
  try {
    return run.settle(await program(argv, run.io, run.state, options.fs ?? hostFileSystem()))
  } catch (error) {
    run.io.err(`bash: ${name}: ${error instanceof Error ? error.message : String(error)}\n`)
    return run.settle(1)
  }
}

/** Build the state, the sinks, and the settlement one run reports through.
 * @remarks 中文说明：功能说明：启动 Run 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：options（ShellRunOptions）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。；返回值：{
 * state: ShellState io: ShellIo settle: (exitCode: number) => ShellRu…；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 startRun(options)，
 * 并按返回类型处理结果。 */
function startRun(options: ShellRunOptions): {
  state: ShellState
  io: ShellIo
  settle: (exitCode: number) => ShellRunOutcome
} {
  /**
   * 常量说明：stdout 用于处理 stdout 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const stdout = buffer()
  /**
   * 常量说明：stderr 用于处理 stderr 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const stderr = buffer()
  /**
   * 常量说明：report 用于处理 report 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const report = options.onOutput
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：text（string）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 典型用法：在完成前置校验后调用 匿名回调(text)，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：text（string）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 典型用法：在完成前置校验后调用 匿名回调(text)，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：exitCode（number）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 典型用法：在完成前置校验后调用 匿名回调(exitCode)，并按返回类型处理结果。
   */
  return {
    state: {
      cwd: options.cwd,
      environment: { ...options.env },
      variables: {},
      lastStatus: 0,
      exitRequested: undefined,
      signal: options.signal,
    },
    io: {
      stdin: options.stdin ?? '',
      out: (text: string) => {
        stdout.write(text)
        report?.('stdout', text)
      },
      err: (text: string) => {
        stderr.write(text)
        report?.('stderr', text)
      },
    },
    settle: (exitCode: number) => ({ exitCode, stdout: stdout.text(), stderr: stderr.text() }),
  }
}

/** One interpretation pass; holds what every nested command shares.
 * @remarks 中文说明：类说明：Interpreter 用于集中封装 处理 Interpreter 相关状态与行为。；
 * 核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。；使用场景：由
 * experimental/webworker-runtime 在对应插件或业务生命周期内创建和调用。 */
class Interpreter {
  /**
   * 功能说明：处理 Interpreter 相关流程；使用场景由所在模块及调用位置决定。
   * @param programs （ReadonlyMap<string, ShellProgram>）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。
   * @param fs （ShellFileSystem）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param signal （AbortSignal | undefined）：传递取消或终止信号；必须满足声明的类型及调用时序要求。
   * @param depth （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns 当前类实例；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 通过 new Interpreter(programs, fs, signal, depth) 创建实例，
   * 并在所属生命周期内使用。
   */
  constructor(
    private readonly programs: ReadonlyMap<string, ShellProgram>,
    private readonly fs: ShellFileSystem,
    private readonly signal: AbortSignal | undefined,
    private readonly depth = 0,
  ) {}

  /**
   * Run every command of one line, left to right.
   * @param line - the parsed line.
   * @param state - shell state the line reads and mutates.
   * @param io - standard input and the output sinks.
   * @returns the status of the last command that ran.
   * @remarks 中文说明：功能说明：处理 line 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：line（ShellLine）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：state（ShellState）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：io（ShellIo）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：Promise<number>；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 line(line, state, io)，
   * 并按返回类型处理结果。
   */
  async line(line: ShellLine, state: ShellState, io: ShellIo): Promise<number> {
    /**
     * 变量说明：status 用于处理 status 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let status = state.lastStatus
    /**
     * 变量说明：entry 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const entry of line) {
      if (this.signal?.aborted === true) return ABORTED_STATUS
      // `&` starts no background job here: the worker has no scheduler that
      // could run one, so a backgrounded command runs to completion in place.
      status = await this.commandLine(entry.command, state, io)
      state.lastStatus = status
      if (state.exitRequested !== undefined) return state.exitRequested
    }
    return status
  }

  /**
   * Run one `&&` / `||` chain.
   *
   * The grammar nests these to the right, while a shell evaluates them left to
   * right: `false && a || b` runs `b`. Flattening first is what makes the
   * skipped `&&` hand its status to the following `||` instead of taking the
   * whole remainder of the line with it.
   * @remarks 中文说明：功能说明：处理 commandLine 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：commandLine（CommandLine）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：state（ShellState）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：io（ShellIo）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：Promise<number>；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 commandLine(commandLine,
   * state, io)，并按返回类型处理结果。
   */
  private async commandLine(commandLine: CommandLine, state: ShellState, io: ShellIo): Promise<number> {
    /**
     * 常量说明：links 用于处理 links 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const links: { type: '&&' | '||'; chain: CommandChain }[] = []
    /**
     * 变量说明：current 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (let current = commandLine.then; current !== undefined; current = current.line.then) {
      links.push({ type: current.type, chain: current.line.chain })
    }
    /**
     * 变量说明：status 用于处理 status 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let status = await this.pipeline(commandLine.chain, state, io)
    state.lastStatus = status
    /**
     * 变量说明：link 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const link of links) {
      if (state.exitRequested !== undefined) return status
      if (link.type === '&&' ? status !== 0 : status === 0) continue
      status = await this.pipeline(link.chain, state, io)
      state.lastStatus = status
    }
    return status
  }

  /** Run one `|` / `|&` pipeline; its status is the last stage's.
   * @remarks 中文说明：功能说明：处理 pipeline 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：chain（CommandChain）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：state（ShellState）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：io（ShellIo）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：Promise<number>；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 pipeline(chain, state,
   * io)，并按返回类型处理结果。 */
  private async pipeline(chain: CommandChain, state: ShellState, io: ShellIo): Promise<number> {
    /**
     * 常量说明：stages 用于处理 stages 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const stages: { command: CommandChain; mergesStderr: boolean }[] = []
    /**
     * 变量说明：current 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (let current: CommandChain | undefined = chain; current !== undefined;) {
      /**
       * 常量说明：link 用于处理 link 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const link: CommandChain['then'] = current.then
      stages.push({ command: current, mergesStderr: link?.type === '|&' })
      current = link?.chain
    }
    /**
     * 变量说明：input 用于处理 input 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let input = io.stdin
    /**
     * 变量说明：status 用于处理 status 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let status = 0
    /**
     * 变量说明：index、stage 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const [index, stage] of stages.entries()) {
      if (this.signal?.aborted === true) return ABORTED_STATUS
      /**
       * 常量说明：last 用于处理 last 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const last = index === stages.length - 1
      /**
       * 常量说明：piped 用于处理 piped 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const piped = buffer()
      /**
       * 常量说明：stageIo 用于处理 stageIo 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const stageIo: ShellIo = last
        ? { stdin: input, out: io.out, err: io.err }
        : { stdin: input, out: piped.write, err: stage.mergesStderr ? piped.write : io.err }
      status = await this.command(stage.command, state, stageIo)
      if (!last) input = piped.text()
      if (state.exitRequested !== undefined) return status
    }
    return status
  }

  /** Run one command node: a program call, a subshell, a group, or bare assignments.
   * @remarks 中文说明：功能说明：处理 command 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：command（Command）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：state（ShellState）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：io（ShellIo）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：Promise<number>；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 command(command, state,
   * io)，并按返回类型处理结果。 */
  private async command(command: Command, state: ShellState, io: ShellIo): Promise<number> {
    switch (command.type) {
      case 'envs':
        /**
         * 变量说明：env 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
         */
        for (const env of command.envs) assign(state, env.name, await this.assignedValue(env.args[0], state))
        return 0
      case 'subshell': {
        // A subshell sees a copy: its `cd` and its assignments die with it.
        /**
         * 常量说明：nested 用于处理 nested 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const nested = { ...state, environment: { ...state.environment }, variables: { ...state.variables } }
        /**
         * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：inner（由 TypeScript
         * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
         * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(inner)，并按返回类型处理结果。
         */
        return await this.redirected(command.args, state, io, async inner => await this.line(command.subshell, nested, inner))
      }
      case 'group':
        /**
         * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：inner（由 TypeScript
         * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
         * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(inner)，并按返回类型处理结果。
         */
        return await this.redirected(command.args, state, io, async inner => await this.line(command.group, state, inner))
      case 'command':
        return await this.program(command, state, io)
    }
  }

  /** Expand a command's words and run the program they name.
   * @remarks 中文说明：功能说明：处理 program 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：command（Extract<Command, { type: 'command' }>）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。；参数说明：state（ShellState）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：io（ShellIo）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：Promise<number>；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 program(command, state,
   * io)，并按返回类型处理结果。 */
  private async program(command: Extract<Command, { type: 'command' }>, state: ShellState, io: ShellIo): Promise<number> {
    /**
     * 常量说明：argv 用于处理 argv 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const argv: string[] = []
    /**
     * 常量说明：redirections 用于处理 redirections 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const redirections: RedirectArgument[] = []
    /**
     * 变量说明：argument 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const argument of command.args) {
      if (argument.type === 'redirection') {
        redirections.push(argument)
        continue
      }
      argv.push(...await expandArgument(argument, this.context(state)))
    }
    /**
     * 常量说明：prefix 用于处理 prefix 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const prefix: Record<string, string> = {}
    /**
     * 变量说明：env 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const env of command.envs) prefix[env.name] = await this.assignedValue(env.args[0], state)

    if (argv.length === 0) {
      /**
       * 变量说明：name、value 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
       */
      for (const [name, value] of Object.entries(prefix)) assign(state, name, value)
      return 0
    }
    // A prefixed command sees the assignments as environment for its run only,
    // which also means it cannot change the caller's directory.
    /**
     * 常量说明：scope 用于处理 scope 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const scope = Object.keys(prefix).length === 0
      ? state
      : { ...state, environment: { ...state.environment, ...prefix } }

    /**
     * 常量说明：name 用于处理 name 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const name = argv[0] as string
    /**
     * 常量说明：program 用于处理 program 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const program = this.programs.get(name)
    if (program === undefined) {
      io.err(`bash: ${name}: command not found\n`)
      return NOT_FOUND_STATUS
    }
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：inner（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(inner)，并按返回类型处理结果。
     */
    return await this.redirected(redirections, state, io, async (inner) => {
      /**
       * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
       */
      try {
        return await program(argv, inner, scope, this.fs)
      } catch (error) {
        // A program's own defect must not take the whole worker down with it.
        inner.err(`bash: ${name}: ${error instanceof Error ? error.message : String(error)}\n`)
        return 1
      }
    })
  }

  /**
   * Apply redirections around one body, then restore nothing: every sink is a
   * value, so the caller's own `io` is untouched by construction.
   * @remarks 中文说明：功能说明：处理 redirected 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：redirections（readonly RedirectArgument[]）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。；参数说明：state（ShellState）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：io（ShellIo）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数说明：body（(io: ShellIo)
   * => Promise<number>）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：Promise<number>；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 redirected(redirections,
   * state, io, body)，并按返回类型处理结果。
   */
  private async redirected(
    redirections: readonly RedirectArgument[],
    state: ShellState,
    io: ShellIo,
    body: (io: ShellIo) => Promise<number>,
  ): Promise<number> {
    /**
     * 变量说明：stdin 用于处理 stdin 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let stdin = io.stdin
    /**
     * 变量说明：out 用于处理 out 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let out = io.out
    /**
     * 变量说明：err 用于处理 err 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let err = io.err
    // Every file write this redirection set started, awaited before the
    // command's status is reported: a `> file` must be complete on return.
    /**
     * 常量说明：writes 用于处理 writes 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const writes: Promise<void>[] = []
    /**
     * 变量说明：redirection 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const redirection of redirections) {
      /**
       * 常量说明：targets 用于处理 targets 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const targets: string[] = []
      /**
       * 变量说明：argument 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
       */
      for (const argument of redirection.args) targets.push(...await expandArgument(argument, this.context(state)))
      /**
       * 常量说明：target 用于处理 target 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const target = targets[0]
      if (target === undefined || targets.length > 1) {
        io.err('bash: ambiguous redirect\n')
        return 1
      }
      /**
       * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
       */
      try {
        switch (redirection.subtype) {
          case '<':
            stdin = await this.fs.readText(resolveIn(state.cwd, target))
            break
          case '<<<':
            stdin = `${target}\n`
            break
          case '>':
          case '>>': {
            /**
             * 常量说明：path 用于处理 path 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
             */
            const path = resolveIn(state.cwd, target)
            // Truncation happens at redirect time, so `> file` empties it even
            // when the command writes nothing.
            if (redirection.subtype === '>') await this.fs.writeText(path, '')
            // Appends are ordered by the queue below: a sink is synchronous to
            // its caller, so writes are chained rather than raced.
            /**
             * 变量说明：pending 用于处理 pending 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
             */
            let pending: Promise<void> = Promise.resolve()
            /**
             * 常量说明：sink 用于处理 sink 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
             * 功能说明：处理 sink 相关流程；使用场景由所在模块及调用位置决定。
             * @param text （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
             * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
             * @example 在完成前置校验后调用 sink(text)，并按返回类型处理结果。
             */
            const sink = (text: string): void => {
              /**
               * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
               * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
               */
              pending = pending.then(async () => { await this.fs.writeText(path, text, true) })
              writes.push(pending)
            }
            if (redirection.fd === 2) err = sink
            else out = sink
            break
          }
          case '>&': {
            // Only descriptor duplication between stdout and stderr is
            // meaningful here: those are the only two the shell owns.
            if (redirection.fd === 2 && target === '1') err = out
            else if ((redirection.fd === null || redirection.fd === 1) && target === '2') out = err
            else {
              io.err(`bash: ${String(redirection.fd ?? 1)}>&${target}: unsupported descriptor redirection\n`)
              return 1
            }
            break
          }
          case '<&':
            io.err(`bash: <&${target}: unsupported descriptor redirection\n`)
            return 1
        }
      } catch (error) {
        io.err(`${describeFailure('bash', resolveIn(state.cwd, target), error)}\n`)
        return 1
      }
    }
    /**
     * 常量说明：status 用于处理 status 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const status = await body({ stdin, out, err })
    await Promise.all(writes)
    return status
  }

  /** The expansion hook: `$( … )` runs on a nested interpreter of the same table.
   * @remarks 中文说明：功能说明：处理 context 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：state（ShellState）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：ExpansionContext；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * context(state)，并按返回类型处理结果。 */
  private context(state: ShellState): ExpansionContext {
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：shell（ShellLine）：提供本次调用所需的数据；
     * 必须满足声明的类型及调用时序要求。；返回值：Promise<string>；调用方应按声明类型处理，不应假定未声明的附加状态。；
     * 典型用法：在完成前置校验后调用 匿名回调(shell)，并按返回类型处理结果。
     */
    return {
      state,
      fs: this.fs,
      substitute: async (shell: ShellLine): Promise<string> => {
        if (this.depth >= MAX_SUBSTITUTION_DEPTH) {
          throw new Error(`command substitution nested deeper than ${String(MAX_SUBSTITUTION_DEPTH)} levels`)
        }
        /**
         * 常量说明：captured 用于处理 captured 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const captured = buffer()
        /**
         * 常量说明：nested 用于处理 nested 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const nested = { ...state, environment: { ...state.environment }, variables: { ...state.variables } }
        /**
         * 常量说明：inner 用于处理 inner 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const inner = new Interpreter(this.programs, this.fs, this.signal, this.depth + 1)
        /**
         * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
         * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
         */
        await inner.line(shell, nested, { stdin: '', out: captured.write, err: () => {} })
        return captured.text().replace(/\n+$/, '')
      },
    }
  }

  /** Expand the right-hand side of one `NAME=value` assignment.
   * @remarks 中文说明：功能说明：处理 assignedValue 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：argument（ValueArgument | undefined）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：state（ShellState）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：Promise<string>；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 assignedValue(argument,
   * state)，并按返回类型处理结果。 */
  private async assignedValue(argument: ValueArgument | undefined, state: ShellState): Promise<string> {
    if (argument === undefined) return ''
    return (await expandArgument(argument, this.context(state))).join(' ')
  }
}

/**
 * Record one assignment. An exported name keeps its export (the environment
 * copy is what programs read); anything else stays a shell variable.
 * @remarks 中文说明：功能说明：处理 assign 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：state（ShellState）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：name（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：value（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 assign(state, name, value)，并按返回类型处理结果。
 */
function assign(state: ShellState, name: string, value: string): void {
  if (name in state.environment) state.environment[name] = value
  else state.variables[name] = value
}
