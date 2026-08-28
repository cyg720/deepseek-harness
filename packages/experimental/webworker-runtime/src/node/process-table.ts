/**
 * The worker's process table. A browser worker cannot fork, so the
 * `node:child_process` shim keeps its own table: one entry per running
 * command, with the pid `process.kill` and the subprocess service's tree
 * bookkeeping address it by.
 *
 * Kept apart from both consumers because they need it from opposite sides —
 * the shim registers entries, the `process` global signals them.
 * @module @deepseek-ai/dsh-experimental-webworker-runtime/src/node/process-table
 * @remarks 文件说明：文件职责：实现 experimental/webworker-runtime 中 process table
 * 模块的职责，并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与
 * Cordis 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/webworker-runtime 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 →
 * 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。
 */

import type { RunningProcess } from '../shell/process/host.ts'

/** One running command, as the table tracks it. */
export interface WorkerProcessEntry {
  /** Identifier handed out to the host tree; unique for the worker's lifetime. */
  readonly pid: number
  /** The first signal delivered, which decides how the process reports its death. */
  signal: NodeJS.Signals | undefined
  /** The started command, attached once it exists; signals reach it through this. */
  process: RunningProcess | undefined
}

/**
 * 常量说明：entries 用于处理 entries 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const entries = new Map<number, WorkerProcessEntry>()

// Pid 1 is the worker host itself (`process.pid`), so commands start above it.
/**
 * 变量说明：lastPid 用于处理 lastPid 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
 */
let lastPid = 1

/**
 * Reserve one pid before its command starts, so a handle can report it
 * synchronously.
 * @returns the new table entry, still without its process.
 * @remarks 中文说明：功能说明：注册 Process 相关流程；使用场景由所在模块及调用位置决定。；
 * 返回值：WorkerProcessEntry；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * registerProcess()，并按返回类型处理结果。
 */
export function registerProcess(): WorkerProcessEntry {
  lastPid += 1
  /**
   * 常量说明：entry 用于处理 entry 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const entry: WorkerProcessEntry = { pid: lastPid, signal: undefined, process: undefined }
  entries.set(entry.pid, entry)
  return entry
}

/**
 * Drop one entry once its command has settled.
 * @param pid - the entry's pid.
 * @remarks 中文说明：功能说明：处理 releaseProcess 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：pid（number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 releaseProcess(pid)，并按返回类型处理结果。
 */
export function releaseProcess(pid: number): void {
  entries.delete(pid)
}

/**
 * Whether a command with this pid is still running.
 * @param pid - pid to look up; a negative value addresses the group, which here
 * holds exactly the one process that leads it.
 * @returns true while the entry is in the table.
 * @remarks 中文说明：功能说明：处理 processAlive 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：pid（number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：boolean；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 processAlive(pid)，并按返回类型处理结果。
 */
export function processAlive(pid: number): boolean {
  return entries.has(Math.abs(pid))
}

/**
 * Deliver a signal to one running command.
 *
 * `SIGKILL` stops the command whatever it is doing; every other signal asks it
 * to stop at its next command boundary. That distinction is real only for a
 * worker-backed process — see {@link RunningProcess.destroy}.
 * @param pid - pid or negative process-group id.
 * @param signal - the signal name to record and deliver.
 * @returns true when an entry received it, false when no such process exists.
 * @remarks 中文说明：功能说明：处理 signalProcess 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：pid（number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：signal（NodeJS.Signals）：传递取消或终止信号；必须满足声明的类型及调用时序要求。；返回值：boolean；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 signalProcess(pid,
 * signal)，并按返回类型处理结果。
 */
export function signalProcess(pid: number, signal: NodeJS.Signals): boolean {
  /**
   * 常量说明：entry 用于处理 entry 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const entry = entries.get(Math.abs(pid))
  if (entry === undefined) return false
  entry.signal ??= signal
  if (signal === 'SIGKILL') entry.process?.destroy()
  else entry.process?.interrupt()
  return true
}
