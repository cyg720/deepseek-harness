/** Virtual executable registry used by the Worker process launcher.
 * @remarks 文件说明：文件职责：实现 experimental/webworker-runtime 中 virtual
 * executables 模块的职责，并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM
 * 模块、严格类型约束与 Cordis 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness
 * 的 experimental/webworker-runtime 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 →
 * 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。 */
import { basename } from '../../module-system/posix-path.ts'
import type { ShellFileSystem } from '../types.ts'
import { LANDLOCK_EXECUTABLE } from './landlock.ts'

/** Completed virtual executable invocation. */
export interface VirtualExecutableExit {
  readonly kind: 'exit'
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
}

/** Invocation delegated to the normal Worker command runner after preparation. */
export interface VirtualExecutableDelegate {
  readonly kind: 'delegate'
  readonly argv: readonly string[]
  readonly filesystem: ShellFileSystem
  readonly missingExecutable: VirtualExecutableExit
}

/** Result of preparing an asynchronous virtual executable invocation. */
export type VirtualExecutablePreparation = VirtualExecutableExit | VirtualExecutableDelegate

/** Result available to the synchronous child-process face. */
export type VirtualExecutableSyncResult = VirtualExecutableExit | { readonly kind: 'asynchronous' }

/** One executable implemented by the Worker instead of an operating-system binary. */
export interface VirtualExecutable {
  /** Platform executable name, independent of package-manager installation path. */
  readonly name: string
  /**
   * Prepare an invocation or complete it without entering the command runner.
   * @param args - Arguments after the executable path.
   * @param context - Working directory and ambient Worker filesystem.
   * @returns The completed result or delegated command and filesystem.
   * @remarks 中文说明：功能说明：处理 prepare 相关流程；使用场景由所在模块及调用位置决定。；参数说明：args（readonly
   * string[]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数说明：context（{ readonly cwd:
   * string; readonly filesystem: ShellFileSyste…）：提供当前 Cordis 插件上下文与已声明服务；
   * 必须满足声明的类型及调用时序要求。；返回值：Promise<VirtualExecutablePreparation>；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 prepare(args, context)，并按返回类型处理结果。
   */
  prepare(
    args: readonly string[],
    context: { readonly cwd: string; readonly filesystem: ShellFileSystem },
  ): Promise<VirtualExecutablePreparation>
  /**
   * Handle the subset that can complete synchronously.
   * @param args - Arguments after the executable path.
   * @returns A completed result or the asynchronous marker.
   * @remarks 中文说明：功能说明：执行 Sync 相关流程；使用场景由所在模块及调用位置决定。；参数说明：args（readonly
   * string[]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：VirtualExecutableSyncResult；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 runSync(args)，并按返回类型处理结果。
   */
  runSync(args: readonly string[]): VirtualExecutableSyncResult
}

/**
 * 常量说明：EXECUTABLES 用于处理 EXECUTABLES 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const EXECUTABLES: ReadonlyMap<string, VirtualExecutable> = new Map([
  [LANDLOCK_EXECUTABLE.name, LANDLOCK_EXECUTABLE],
])

/**
 * Resolve a Worker platform executable by logical name.
 * @param path - Bare name or executable path passed to `spawn`.
 * @returns Its implementation, or undefined for the normal command table.
 * @remarks 中文说明：功能说明：处理 virtualExecutable 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：path（string）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；
 * 返回值：VirtualExecutable | undefined；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 virtualExecutable(path)，并按返回类型处理结果。
 */
export function virtualExecutable(path: string): VirtualExecutable | undefined {
  return EXECUTABLES.get(basename(path))
}
