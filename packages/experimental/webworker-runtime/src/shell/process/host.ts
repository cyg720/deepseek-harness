/**
 * Starting and supervising shell processes from the host worker.
 *
 * A process is a Web Worker started from this same bundle, told by its first
 * frame to be a shell process rather than a host. That is what buys real
 * process semantics in a browser: the command runs off the host's thread, and
 * `terminate()` stops it even mid-loop — the one thing a cooperative in-thread
 * interpreter can never do.
 *
 * Where no `Worker` constructor exists (a Node test host), the same command
 * runs inline on this thread. Everything except preemption behaves the same,
 * and the difference is named rather than hidden: {@link RunningProcess.destroy}
 * can only ask an inline command to stop.
 * @module @deepseek-ai/dsh-experimental-webworker-runtime/src/shell/process/host
 * @remarks 文件说明：文件职责：实现 experimental/webworker-runtime 中 host 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/webworker-runtime 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 →
 * 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。
 */

import { runShellCommand, runShellProgram } from '../interpret.ts'
import { hostFileSystem } from '../fs-access.ts'
import type { ShellFileSystem } from '../types.ts'
import type { FilesystemOperation, FromProcessFrame, ShellStartFrame } from './protocol.ts'
import { runShellProcess } from './child.ts'
import type { ProcessScope } from './child.ts'

/** What the caller must supply to start one process. */
export interface ProcessStartOptions {
  /** Command source for `bash -c`, or undefined when `argv` names a program. */
  script?: string | undefined
  /** The program and its arguments. */
  argv: readonly string[]
  /** Working directory the command starts in. */
  cwd: string
  /** Environment the command starts with. */
  env: Record<string, string>
  /** Everything on standard input. */
  stdin: string
  /** Receives output as it is produced. */
  onOutput: (stream: 'stdout' | 'stderr', text: string) => void
  /** Receives the settled status exactly once. */
  onExit: (code: number) => void
  /** The filesystem the command acts on; defaults to the mounted VFS. */
  fs?: ShellFileSystem | undefined
}

/** A started command, from the host's side. */
export interface RunningProcess {
  /** Ask the command to stop at its next command boundary (the `SIGTERM` rung).
   * @remarks 中文说明：功能说明：处理 interrupt 相关流程；使用场景由所在模块及调用位置决定。；返回值：void；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 interrupt()，并按返回类型处理结果。 */
  interrupt(): void
  /**
   * Stop the command now (the `SIGKILL` rung). A worker-backed process dies
   * whatever it was doing; an inline one can only be asked, because nothing
   * can preempt a synchronous loop on its own thread.
   * @remarks 中文说明：功能说明：处理 destroy 相关流程；使用场景由所在模块及调用位置决定。；返回值：void；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 destroy()，并按返回类型处理结果。
   */
  destroy(): void
}

/** Whether this thread can start a real process worker.
 * @remarks 中文说明：功能说明：判断是否能够 Spawn Worker 相关流程；使用场景由所在模块及调用位置决定。；
 * 返回值：boolean；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * canSpawnWorker()，并按返回类型处理结果。 */
function canSpawnWorker(): boolean {
  return typeof Worker === 'function' && typeof self !== 'undefined' && typeof self.location.href === 'string'
}

/**
 * Start one command.
 * @param options - the command, its environment, and the sinks for its output and status.
 * @returns the handle the process table signals through.
 * @remarks 中文说明：功能说明：启动 Process 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：options（ProcessStartOptions）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。；
 * 返回值：RunningProcess；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * startProcess(options)，并按返回类型处理结果。
 */
export function startProcess(options: ProcessStartOptions): RunningProcess {
  return canSpawnWorker() ? startWorkerProcess(options) : startInlineProcess(options)
}

/** Serve one filesystem call for a process worker.
 * @remarks 中文说明：功能说明：处理 serveFilesystemCall 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：fs（ShellFileSystem）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：op（FilesystemOperation）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：args（readonly unknown[]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：Promise<unknown>；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * serveFilesystemCall(fs, op, args)，并按返回类型处理结果。 */
async function serveFilesystemCall(fs: ShellFileSystem, op: FilesystemOperation, args: readonly unknown[]): Promise<unknown> {
  switch (op) {
    case 'stat': return await fs.stat(args[0] as string)
    case 'list': return await fs.list(args[0] as string)
    case 'readText': return await fs.readText(args[0] as string)
    case 'writeText':
      await fs.writeText(args[0] as string, args[1] as string, args[2] as boolean)
      return undefined
    case 'mkdir':
      await fs.mkdir(args[0] as string, args[1] as boolean)
      return undefined
    case 'remove':
      await fs.remove(args[0] as string, args[1] as { recursive: boolean; force: boolean })
      return undefined
    case 'rename':
      await fs.rename(args[0] as string, args[1] as string)
      return undefined
    default:
      // The op crossed a worker postMessage: a name the union does not carry
      // must fail the call rather than answer `{ value: undefined }`.
      throw new Error(`webworker shell: unknown filesystem op ${String(op)}`)
  }
}

/** The worker-backed process: a second copy of this bundle, running one command.
 * @remarks 中文说明：功能说明：启动 Worker Process 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：options（ProcessStartOptions）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。；
 * 返回值：RunningProcess；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * startWorkerProcess(options)，并按返回类型处理结果。 */
function startWorkerProcess(options: ProcessStartOptions): RunningProcess {
  /**
   * 常量说明：fs 用于处理 fs 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const fs = options.fs ?? hostFileSystem()
  // Same bundle, different role: the first frame decides. Starting from this
  // worker's own URL keeps the deployment free of a second static asset and of
  // the build-order trap a sibling artifact would bring.
  /**
   * 常量说明：worker 用于处理 worker 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const worker = new Worker(self.location.href, { type: 'module' })
  /**
   * 变量说明：settled 用于处理 settled 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let settled = false
  /**
   * 常量说明：settle 用于处理 settle 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   * 功能说明：处理 settle 相关流程；使用场景由所在模块及调用位置决定。
   * @param code （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 settle(code)，并按返回类型处理结果。
   */
  const settle = (code: number): void => {
    if (settled) return
    settled = true
    worker.terminate()
    options.onExit(code)
  }

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：event（MessageEvent）：提供需要处理或投影的事件数
   * 据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 典型用法：在完成前置校验后调用 匿名回调(event)，并按返回类型处理结果。
   */
  worker.addEventListener('message', (event: MessageEvent) => {
    /**
     * 常量说明：frame 用于处理 frame 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const frame = event.data as FromProcessFrame
    if (frame.t === 'shell-out') {
      options.onOutput(frame.stream, frame.text)
      return
    }
    if (frame.t === 'shell-exit') {
      settle(frame.code)
      return
    }
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：value（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(value)，并按返回类型处理结果。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：error（unknown）：提供本次调用所需的数据；
     * 必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；
     * 典型用法：在完成前置校验后调用 匿名回调(error)，并按返回类型处理结果。
     */
    void serveFilesystemCall(fs, frame.op, frame.args).then(
      (value) => { worker.postMessage({ t: 'fs-reply', id: frame.id, value }) },
      (error: unknown) => {
        /**
         * 常量说明：failure 用于处理 failure 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const failure = {
          code: (error as { code?: string }).code,
          message: error instanceof Error ? error.message : String(error),
        }
        worker.postMessage({ t: 'fs-reply', id: frame.id, failure })
      },
    )
  })
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：event（ErrorEvent）：提供需要处理或投影的事件数据；
   * 必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 典型用法：在完成前置校验后调用 匿名回调(event)，并按返回类型处理结果。
   */
  worker.addEventListener('error', (event: ErrorEvent) => {
    options.onOutput('stderr', `bash: process worker failed: ${event.message}\n`)
    settle(1)
  })

  /**
   * 常量说明：start 用于启动 start 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const start: ShellStartFrame = {
    t: 'shell-start',
    script: options.script,
    argv: options.argv,
    cwd: options.cwd,
    env: options.env,
    stdin: options.stdin,
  }
  worker.postMessage(start)

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  return {
    interrupt: () => { if (!settled) worker.postMessage({ t: 'shell-signal' }) },
    // The reason this whole module exists: a worker dies on command, even
    // mid-loop, so a timeout is enforceable rather than advisory.
    destroy: () => { settle(130) },
  }
}

/** The inline process: the same command on this thread, stoppable only by asking.
 * @remarks 中文说明：功能说明：启动 Inline Process 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：options（ProcessStartOptions）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。；
 * 返回值：RunningProcess；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * startInlineProcess(options)，并按返回类型处理结果。 */
function startInlineProcess(options: ProcessStartOptions): RunningProcess {
  /**
   * 常量说明：stopping 用于处理 stopping 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const stopping = new AbortController()
  /**
   * 常量说明：runOptions 用于执行 Options 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const runOptions = {
    cwd: options.cwd,
    env: options.env,
    stdin: options.stdin,
    signal: stopping.signal,
    fs: options.fs ?? hostFileSystem(),
    onOutput: options.onOutput,
  }
  /**
   * 常量说明：run 用于执行 run 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const run = options.script === undefined
    ? runShellProgram(options.argv, runOptions)
    : runShellCommand(options.script, runOptions)
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：outcome（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(outcome)，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：error（unknown）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 典型用法：在完成前置校验后调用 匿名回调(error)，并按返回类型处理结果。
   */
  void run.then(
    (outcome) => { options.onExit(outcome.exitCode) },
    (error: unknown) => {
      options.onOutput('stderr', `bash: ${String(error)}\n`)
      options.onExit(1)
    },
  )
  /**
   * 常量说明：stop 用于停止 stop 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   * 功能说明：停止 stop 相关流程；使用场景由所在模块及调用位置决定。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 stop()，并按返回类型处理结果。
   */
  const stop = (): void => { stopping.abort(new Error('killed by signal')) }
  return { interrupt: stop, destroy: stop }
}

/** Re-exported for the worker entry, which decides its role from the first frame. */
export { runShellProcess }
export type { ProcessScope }
