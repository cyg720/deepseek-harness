/** Landlock launcher parsing and per-process VFS enforcement for the worker shell.
 * @remarks 文件说明：文件职责：实现 experimental/webworker-runtime 中 landlock 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/webworker-runtime 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 →
 * 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。 */
import { resolve } from '../../module-system/posix-path.ts'
import { DSH_TMP } from '../../storage/paths.ts'
import { filesystemError } from '../fs-access.ts'
import type { ShellDirent, ShellFileSystem, ShellStats } from '../types.ts'
import type { VirtualExecutable, VirtualExecutableExit } from './virtual-executables.ts'

/** Parsed invocation of the native launcher's unchanged argv grammar. */
export type LandlockInvocation =
  | { readonly kind: 'probe' }
  | {
    readonly kind: 'run'
    readonly readOnly: readonly string[]
    readonly readWrite: readonly string[]
    readonly argv: readonly string[]
  }

/** Launcher-owned failure; callers print its message with the `landlock-run:` prefix.
 * @remarks 中文说明：类说明：LandlockLauncherError 用于集中封装 处理 LandlockLauncherError
 * 相关状态与行为。；核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。；使用场景：由
 * experimental/webworker-runtime 在对应插件或业务生命周期内创建和调用。 */
export class LandlockLauncherError extends Error {}

/**
 * Parse the native launcher's argv grammar.
 * @param args - Arguments after the launcher executable.
 * @returns A probe or confined-run request.
 * @remarks 中文说明：功能说明：解析 Landlock Arguments 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：args（readonly string[]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：LandlockInvocation；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * parseLandlockArguments(args)，并按返回类型处理结果。
 */
export function parseLandlockArguments(args: readonly string[]): LandlockInvocation {
  /**
   * 常量说明：readOnly 用于读取 Only 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const readOnly: string[] = []
  /**
   * 常量说明：readWrite 用于读取 Write 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const readWrite: string[] = []
  /**
   * 变量说明：index 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (let index = 0; index < args.length;) {
    /**
     * 常量说明：argument 用于处理 argument 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const argument = args[index] as string
    if (argument === '--probe') {
      if (args.length !== 1) throw new LandlockLauncherError('usage error: --probe takes no other arguments')
      return { kind: 'probe' }
    }
    if (argument === '--ro' || argument === '--rw') {
      /**
       * 常量说明：path 用于处理 path 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const path = args[index + 1]
      if (path === undefined) throw new LandlockLauncherError(`usage error: ${argument} requires a path`)
      ;(argument === '--ro' ? readOnly : readWrite).push(path)
      index += 2
      continue
    }
    if (argument === '--') {
      /**
       * 常量说明：argv 用于处理 argv 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const argv = args.slice(index + 1)
      if (argv.length === 0) throw new LandlockLauncherError('usage error: missing `-- <argv>...` command')
      return { kind: 'run', readOnly, readWrite, argv }
    }
    throw new LandlockLauncherError(`usage error: unknown argument: ${argument}`)
  }
  throw new LandlockLauncherError('usage error: missing `-- <argv>...` command')
}

/** Map the host launcher's temp path into the Worker VFS.
 * @remarks 中文说明：功能说明：处理 vfsPath 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：path（string）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；
 * 参数说明：cwd（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：string；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 vfsPath(path, cwd)，并按返回类型处理结果。 */
function vfsPath(path: string, cwd: string): string {
  /**
   * 常量说明：resolved 用于处理 resolved 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const resolved = resolve(cwd, path)
  /**
   * 常量说明：absolute 用于处理 absolute 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const absolute = resolved.length > 1 ? resolved.replace(/\/+$/u, '') : resolved
  if (absolute === '/tmp') return DSH_TMP
  if (absolute.startsWith('/tmp/')) return `${DSH_TMP}${absolute.slice('/tmp'.length)}`
  return absolute
}

/** Whether a normalized path is the root itself or one of its descendants.
 * @remarks 中文说明：功能说明：处理 contains 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：root（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：path（string）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；返回值：boolean；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 contains(root, path)，
 * 并按返回类型处理结果。 */
function contains(root: string, path: string): boolean {
  return root === '/' || path === root || path.startsWith(`${root}/`)
}

/** Throw the denial dialect consumed by `dsh-bash-sandbox`.
 * @remarks 中文说明：功能说明：处理 deny 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：syscall（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：path（string）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；返回值：never；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 deny(syscall, path)，
 * 并按返回类型处理结果。 */
function deny(syscall: string, path: string): never {
  throw filesystemError('EACCES', syscall, path)
}

/** Stats for the virtual `/dev/null` file.
 * @remarks 中文说明：常量说明：NULL_STATS 用于处理 NULL_STATS 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
const NULL_STATS: ShellStats = { directory: false, size: 0, mtimeMs: 0 }
/**
 * 常量说明：DEV_ROOT 用于处理 DEV_ROOT 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const DEV_ROOT = '/dev'
/**
 * 常量说明：NULL_PATH 用于处理 NULL_PATH 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const NULL_PATH = '/dev/null'

/** Build one launcher-owned terminal result.
 * @remarks 中文说明：功能说明：处理 launcherExit 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：exitCode（number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数说明：stdout（由
 * TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数说明：stderr（由
 * TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：VirtualExecutableExit；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * launcherExit(exitCode, stdout, stderr)，并按返回类型处理结果。 */
function launcherExit(exitCode: number, stdout = '', stderr = ''): VirtualExecutableExit {
  return { kind: 'exit', exitCode, stdout, stderr }
}

/** Convert a parser or grant failure into the native launcher's fatal dialect.
 * @remarks 中文说明：功能说明：处理 launcherFailure 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：error（unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：VirtualExecutableExit；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * launcherFailure(error)，并按返回类型处理结果。 */
function launcherFailure(error: unknown): VirtualExecutableExit {
  /**
   * 常量说明：detail 用于处理 detail 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const detail = error instanceof LandlockLauncherError ? error.message : String(error)
  return launcherExit(125, '', `landlock-run: ${detail}\n`)
}

/**
 * Validate grant roots and create one process-local filesystem guard.
 * @param base - Host-side VFS adapter all permitted calls delegate to.
 * @param invocation - Parsed confined-run request.
 * @param cwd - Launcher's working directory for relative grant paths.
 * @returns A filesystem enforcing only this invocation's grants.
 * @remarks 中文说明：功能说明：处理 landlockFileSystem 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：base（ShellFileSystem）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：invocation（Extract<LandlockInvocation, { kind: 'run'
 * }>）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数说明：cwd（string）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。；返回值：Promise<ShellFileSystem>；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 landlockFileSystem(base, invocation, cwd)，
 * 并按返回类型处理结果。
 */
export async function landlockFileSystem(
  base: ShellFileSystem,
  invocation: Extract<LandlockInvocation, { kind: 'run' }>,
  cwd: string,
): Promise<ShellFileSystem> {
  /**
   * 常量说明：normalizeGrant 用于规范化 Grant 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   * 功能说明：规范化 Grant 相关流程；使用场景由所在模块及调用位置决定。
   * @param path （string）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。
   * @returns Promise<string>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 normalizeGrant(path)，并按返回类型处理结果。
   */
  const normalizeGrant = async (path: string): Promise<string> => {
    if (path === '') throw new LandlockLauncherError('cannot open rule path: : No such file or directory')
    /**
     * 常量说明：target 用于处理 target 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const target = vfsPath(path, cwd)
    if (target !== DEV_ROOT && target !== NULL_PATH && await base.stat(target) === undefined) {
      throw new LandlockLauncherError(`cannot open rule path: ${path}: No such file or directory`)
    }
    return target
  }
  /**
   * 常量说明：readOnly 用于读取 Only 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const readOnly = await Promise.all(invocation.readOnly.map(normalizeGrant))
  /**
   * 常量说明：readWrite 用于读取 Write 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const readWrite = await Promise.all(invocation.readWrite.map(normalizeGrant))
  /**
   * 常量说明：readable 用于处理 readable 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const readable = [...readOnly, ...readWrite]

  /**
   * 常量说明：checkedPath 用于处理 checkedPath 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   * 功能说明：处理 checkedPath 相关流程；使用场景由所在模块及调用位置决定。
   * @param path （string）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。
   * @param syscall （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns string；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 checkedPath(path, syscall)，并按返回类型处理结果。
   */
  const checkedPath = (path: string, syscall: string): string => {
    /**
     * 常量说明：target 用于处理 target 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const target = vfsPath(path, cwd)
    if (target.startsWith(`${NULL_PATH}/`)) throw filesystemError('ENOTDIR', syscall, path)
    return target
  }
  /**
   * 常量说明：readPath 用于读取 Path 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   * 功能说明：读取 Path 相关流程；使用场景由所在模块及调用位置决定。
   * @param path （string）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。
   * @param syscall （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns string；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 readPath(path, syscall)，并按返回类型处理结果。
   */
  const readPath = (path: string, syscall: string): string => {
    /**
     * 常量说明：target 用于处理 target 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const target = checkedPath(path, syscall)
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：root（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(root)，并按返回类型处理结果。
     */
    if (!readable.some(root => contains(root, target))) deny(syscall, path)
    return target
  }
  /**
   * 常量说明：writePath 用于写入 Path 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   * 功能说明：写入 Path 相关流程；使用场景由所在模块及调用位置决定。
   * @param path （string）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。
   * @param syscall （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns string；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 writePath(path, syscall)，并按返回类型处理结果。
   */
  const writePath = (path: string, syscall: string): string => {
    /**
     * 常量说明：target 用于处理 target 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const target = checkedPath(path, syscall)
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：root（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(root)，并按返回类型处理结果。
     */
    if (!readWrite.some(root => contains(root, target))) deny(syscall, path)
    return target
  }

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：path（string）：指定要读取、写入或匹配的文件位置；
   * 必须满足声明的类型及调用时序要求。；返回值：Promise<ShellStats | undefined>；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(path)，并按返回类型处理结果。
   */
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
    stat: async (path: string): Promise<ShellStats | undefined> => {
      /**
       * 常量说明：target 用于处理 target 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const target = readPath(path, 'stat')
      if (target === NULL_PATH) return NULL_STATS
      if (target === DEV_ROOT && !await base.stat(target)) return { directory: true, size: 0, mtimeMs: 0 }
      return await base.stat(target)
    },
    list: async (path: string): Promise<ShellDirent[]> => {
      /**
       * 常量说明：target 用于处理 target 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const target = readPath(path, 'scandir')
      if (target === DEV_ROOT) return [{ name: 'null', directory: false }]
      if (target === NULL_PATH) throw filesystemError('ENOTDIR', 'scandir', path)
      return await base.list(target)
    },
    readText: async (path: string): Promise<string> => {
      /**
       * 常量说明：target 用于处理 target 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const target = readPath(path, 'open')
      return target === NULL_PATH ? '' : await base.readText(target)
    },
    writeText: async (path: string, text: string, append = false): Promise<void> => {
      /**
       * 常量说明：target 用于处理 target 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const target = writePath(path, 'open')
      if (target !== NULL_PATH) await base.writeText(target, text, append)
    },
    mkdir: async (path: string, recursive: boolean): Promise<void> => {
      /**
       * 常量说明：target 用于处理 target 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const target = writePath(path, 'mkdir')
      if (target === NULL_PATH) throw filesystemError('EEXIST', 'mkdir', path)
      await base.mkdir(target, recursive)
    },
    remove: async (path: string, options: { recursive: boolean; force: boolean }): Promise<void> => {
      /**
       * 常量说明：target 用于处理 target 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const target = writePath(path, 'rm')
      if (target === NULL_PATH) deny('rm', path)
      await base.remove(target, options)
    },
    rename: async (from: string, to: string): Promise<void> => {
      /**
       * 常量说明：source 用于处理 source 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const source = writePath(from, 'rename')
      /**
       * 常量说明：destination 用于处理 destination 相关数据，作用于当前作用域；初始化后不可重新赋值，
       * 但对象内部是否可变仍由其类型决定。
       */
      const destination = writePath(to, 'rename')
      if (source === NULL_PATH || destination === NULL_PATH) deny('rename', source === NULL_PATH ? from : to)
      await base.rename(source, destination)
    },
  }
}

/** Virtual executable implementing the native launcher's CLI over VFS grants.
 * @remarks 中文说明：常量说明：LANDLOCK_EXECUTABLE 用于处理 LANDLOCK_EXECUTABLE 相关数据，
 * 作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
export const LANDLOCK_EXECUTABLE: VirtualExecutable = {
  name: 'landlock-run',
  /**
   * 功能说明：处理 prepare 相关流程；使用场景由所在模块及调用位置决定。
   * @param args （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param context （由 TypeScript 根据调用位置推断的类型）：提供当前 Cordis 插件上下文与已声明服务；
   * 必须满足声明的类型及调用时序要求。
   * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 prepare(args, context)，并按返回类型处理结果。
   */
  async prepare(args, context) {
    /**
     * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
     */
    try {
      /**
       * 常量说明：invocation 用于处理 invocation 相关数据，作用于当前作用域；初始化后不可重新赋值，
       * 但对象内部是否可变仍由其类型决定。
       */
      const invocation = parseLandlockArguments(args)
      if (invocation.kind === 'probe') return launcherExit(0, 'landlock: fully enforced\n')
      return {
        kind: 'delegate',
        argv: invocation.argv,
        filesystem: await landlockFileSystem(context.filesystem, invocation, context.cwd),
        missingExecutable: launcherExit(125, '', 'landlock-run: exec failed: No such file or directory\n'),
      }
    } catch (error) {
      return launcherFailure(error)
    }
  },
  /**
   * 功能说明：执行 Sync 相关流程；使用场景由所在模块及调用位置决定。
   * @param args （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 runSync(args)，并按返回类型处理结果。
   */
  runSync(args) {
    /**
     * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
     */
    try {
      /**
       * 常量说明：invocation 用于处理 invocation 相关数据，作用于当前作用域；初始化后不可重新赋值，
       * 但对象内部是否可变仍由其类型决定。
       */
      const invocation = parseLandlockArguments(args)
      return invocation.kind === 'probe'
        ? launcherExit(0, 'landlock: fully enforced\n')
        : { kind: 'asynchronous' }
    } catch (error) {
      return launcherFailure(error)
    }
  },
}
