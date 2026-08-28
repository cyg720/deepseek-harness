/**
 * The in-host filesystem for shell runs: {@link ShellFileSystem} straight over
 * the mounted VFS, plus the path and diagnostic helpers every program shares.
 *
 * This implementation answers from memory. A command running in its own
 * worker uses the message-backed one (`./process/child.ts`), which this one
 * serves from the host side.
 * @module @deepseek-ai/dsh-experimental-webworker-runtime/src/shell/fs-access
 * @remarks 文件说明：文件职责：实现 experimental/webworker-runtime 中 fs access 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/webworker-runtime 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 →
 * 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。
 */

import { resolve } from '../module-system/posix-path.ts'
import { requireActiveVfs } from '../storage/active.ts'
import type { VfsError, VfsStats } from '../storage/types.ts'
import type { ShellDirent, ShellFileSystem, ShellStats } from './types.ts'

/**
 * Resolve one shell word into an absolute VFS path.
 * @param cwd - the shell's working directory.
 * @param path - absolute or relative path as the command line spelled it.
 * @returns the absolute normalized path.
 * @remarks 中文说明：功能说明：解析 In 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：cwd（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：path（string）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；返回值：string；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 resolveIn(cwd, path)，
 * 并按返回类型处理结果。
 */
export function resolveIn(cwd: string, path: string): string {
  return resolve(cwd, path)
}

/**
 * Restate a filesystem failure the way a shell utility reports it, so the model
 * reads `cat: /dsh/none: No such file or directory` instead of a Node error
 * string.
 * @param program - the utility's name, used as the message prefix.
 * @param path - the path the utility was working on.
 * @param error - the failure the filesystem raised.
 * @returns the single-line diagnostic, without a trailing newline.
 * @remarks 中文说明：功能说明：处理 describeFailure 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：program（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：path（string）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；
 * 参数说明：error（unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：string；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 describeFailure(program, path, error)，
 * 并按返回类型处理结果。
 */
export function describeFailure(program: string, path: string, error: unknown): string {
  /**
   * 常量说明：code 用于处理 code 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const code = (error as Partial<VfsError>).code
  /**
   * 常量说明：reason 用于处理 reason 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const reason = code === 'ENOENT'
    ? 'No such file or directory'
    : code === 'ENOTDIR'
      ? 'Not a directory'
      : code === 'EISDIR'
        ? 'Is a directory'
        : code === 'ENOTEMPTY'
          ? 'Directory not empty'
          : code === 'EEXIST'
            ? 'File exists'
            : error instanceof Error ? error.message : String(error)
  return `${program}: ${path}: ${reason}`
}

/**
 * Build a Node-shaped filesystem error, for the conditions this layer detects
 * itself and for the worker transport, which can carry a code but not a class.
 * @param code - the Node error code (`ENOENT`, `EISDIR`, …).
 * @param syscall - the operation that failed.
 * @param path - the path it failed on.
 * @returns the error to throw.
 * @remarks 中文说明：功能说明：处理 filesystemError 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：code（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：syscall（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：path（string）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；返回值：VfsError；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 filesystemError(code,
 * syscall, path)，并按返回类型处理结果。
 */
export function filesystemError(code: string, syscall: string, path: string): VfsError {
  /**
   * 常量说明：reason 用于处理 reason 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const reason = code === 'EACCES' ? 'permission denied' : `${syscall} failed`
  /**
   * 常量说明：error 用于处理 error 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const error = new Error(`${code}: ${reason}, ${syscall} '${path}'`) as VfsError
  error.code = code
  error.path = path
  error.syscall = syscall
  return error
}

/** Project VFS stats onto the facts a program reads.
 * @remarks 中文说明：功能说明：处理 statsOf 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：stats（VfsStats）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：ShellStats；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 statsOf(stats)，并按返回类型处理结果。 */
function statsOf(stats: VfsStats): ShellStats {
  return { directory: stats.isDirectory(), size: stats.size, mtimeMs: stats.mtimeMs }
}

/**
 * The filesystem backed by the VFS mounted in this thread.
 * @returns the in-host {@link ShellFileSystem}.
 * @remarks 中文说明：功能说明：处理 hostFileSystem 相关流程；使用场景由所在模块及调用位置决定。；
 * 返回值：ShellFileSystem；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * hostFileSystem()，并按返回类型处理结果。
 */
export function hostFileSystem(): ShellFileSystem {
  /**
   * 常量说明：vfs 用于处理 vfs 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   * 功能说明：处理 vfs 相关流程；使用场景由所在模块及调用位置决定。
   * @returns ReturnType<typeof requireActiveVfs>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 vfs()，并按返回类型处理结果。
   */
  const vfs = (): ReturnType<typeof requireActiveVfs> => requireActiveVfs()
  /**
   * 常量说明：stat 用于处理 stat 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   * 功能说明：处理 stat 相关流程；使用场景由所在模块及调用位置决定。
   * @param path （string）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。
   * @returns Promise<ShellStats | undefined>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 stat(path)，并按返回类型处理结果。
   */
  const stat = (path: string): Promise<ShellStats | undefined> => {
    try {
      return Promise.resolve(statsOf(vfs().statSync(path) as VfsStats))
    } catch {
      // Absence is the answer callers branch on; every other failure mode of
      // the in-memory backend is also "this path holds nothing readable".
      return Promise.resolve(undefined)
    }
  }
  // Several members take no await: the face is asynchronous because a process
  // worker's filesystem is, while this backend answers from memory.
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：path（string）：指定要读取、写入或匹配的文件位置；
   * 必须满足声明的类型及调用时序要求。；返回值：Promise<ShellDirent[]>；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 典型用法：在完成前置校验后调用 匿名回调(path)，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：path（string）：指定要读取、写入或匹配的文件位置；
   * 必须满足声明的类型及调用时序要求。；返回值：Promise<string>；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 典型用法：在完成前置校验后调用 匿名回调(path)，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：path（string）：指定要读取、写入或匹配的文件位置；
   * 必须满足声明的类型及调用时序要求。；参数：text（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数：append（由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(path,
   * text, append)，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：path（string）：指定要读取、写入或匹配的文件位置；
   * 必须满足声明的类型及调用时序要求。；参数：recursive（boolean）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(path,
   * recursive)，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：path（string）：指定要读取、写入或匹配的文件位置；
   * 必须满足声明的类型及调用时序要求。；参数：options（{ recursive: boolean; force: boolean
   * }）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。；返回值：Promise<void>；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(path, options)，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：from（string）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。；参数：to（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(from,
   * to)，并按返回类型处理结果。
   */
  return {
    stat,
    list: async (path: string): Promise<ShellDirent[]> => {
      /**
       * 常量说明：names 用于处理 names 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const names = [...vfs().readdirSync(path) as string[]].sort()
      /**
       * 常量说明：entries 用于处理 entries 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const entries: ShellDirent[] = []
      /**
       * 变量说明：name 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
       */
      for (const name of names) {
        entries.push({ name, directory: (await stat(resolve(path, name)))?.directory ?? false })
      }
      return entries
    },
    readText: async (path: string): Promise<string> => {
      if ((await stat(path))?.directory === true) throw filesystemError('EISDIR', 'read', path)
      return vfs().readFileSync(path, 'utf8') as string
    },
    writeText: (path: string, text: string, append = false): Promise<void> => {
      if (append) vfs().appendFileSync(path, text)
      else vfs().writeFileSync(path, text)
      return Promise.resolve()
    },
    mkdir: (path: string, recursive: boolean): Promise<void> => {
      vfs().mkdirSync(path, { recursive })
      return Promise.resolve()
    },
    remove: (path: string, options: { recursive: boolean; force: boolean }): Promise<void> => {
      vfs().rmSync(path, options)
      return Promise.resolve()
    },
    rename: (from: string, to: string): Promise<void> => {
      vfs().renameSync(from, to)
      return Promise.resolve()
    },
  }
}
