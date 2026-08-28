/**
 * `node:fs` bridge over the worker's in-memory VFS. `MemoryVfs` owns paths,
 * bytes, the directory tree, and Node's error codes; this module adds only what
 * is Node-API-shaped and not VFS business: Buffer results, `Dirent` objects,
 * file descriptors, `mkdtemp`, access checks, watchers, streams, and the promise face.
 * @remarks 文件说明：文件职责：实现 experimental/webworker-runtime 中 fs 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/webworker-runtime 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 →
 * 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。
 */
import { requireActiveVfs } from '../../../storage/active.ts'
import type {
  Vfs, VfsBigIntStats, VfsOpenFile, VfsStatOptions, VfsStats, VfsWriteOptions,
} from '../../../storage/types.ts'
import { Buffer } from 'buffer'
import { Readable, Writable } from './stream.ts'
import { dirname } from './path.ts'
import { abortError } from './abort-error.ts'
import {
  FSWatcher, StatWatcher, unwatchFile, watch, watchAsync, watchFile,
} from './fs-watch.ts'

/**
 * 常量说明：vfs 用于处理 vfs 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 * 功能说明：处理 vfs 相关流程；使用场景由所在模块及调用位置决定。
 * @returns Vfs；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 vfs()，并按返回类型处理结果。
 */
const vfs = (): Vfs => requireActiveVfs()

export { FSWatcher, StatWatcher, unwatchFile, watch, watchFile }

type PathArg = string | URL | Uint8Array

/**
 * 常量说明：asPath 用于处理 asPath 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 * 功能说明：处理 asPath 相关流程；使用场景由所在模块及调用位置决定。
 * @param path （PathArg）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。
 * @returns string；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 asPath(path)，并按返回类型处理结果。
 */
const asPath = (path: PathArg): string => {
  if (typeof path === 'string') return path
  if (path instanceof URL) return decodeURIComponent(path.pathname)
  return new TextDecoder().decode(path)
}

type EncodingOption = BufferEncoding | { encoding?: BufferEncoding | null } | null | undefined

/**
 * 常量说明：encodingOf 用于处理 encodingOf 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 * 功能说明：处理 encodingOf 相关流程；使用场景由所在模块及调用位置决定。
 * @param options （EncodingOption）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。
 * @returns BufferEncoding | undefined；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 encodingOf(options)，并按返回类型处理结果。
 */
const encodingOf = (options: EncodingOption): BufferEncoding | undefined => {
  if (options === undefined || options === null) return undefined
  if (typeof options === 'string') return options
  return options.encoding ?? undefined
}

/**
 * 常量说明：bytesOf 用于处理 bytesOf 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 * 功能说明：处理 bytesOf 相关流程；使用场景由所在模块及调用位置决定。
 * @param path （string）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。
 * @returns Uint8Array；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 bytesOf(path)，并按返回类型处理结果。
 */
const bytesOf = (path: string): Uint8Array => vfs().readFileSync(path) as Uint8Array

/** Share the VFS bytes rather than copying them.
 * @remarks 中文说明：常量说明：asBuffer 用于处理 asBuffer 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。；功能说明：处理 asBuffer 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：bytes（Uint8Array）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：Buffer；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 asBuffer(bytes)，
 * 并按返回类型处理结果。 */
const asBuffer = (bytes: Uint8Array): Buffer =>
  Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)

/** Node `Dirent` subset returned by `readdirSync(dir, { withFileTypes: true })`.
 * @remarks 中文说明：类说明：Dirent 用于集中封装 处理 Dirent 相关状态与行为。；核心功能：通过成员字段保存状态，
 * 并由公开方法提供受类型约束的操作入口。；使用场景：由 experimental/webworker-runtime
 * 在对应插件或业务生命周期内创建和调用。 */
export class Dirent {
  /** Entry name, without its directory.
   * @remarks 中文说明：常量说明：name 用于处理 name 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
  readonly name: string
  /** Directory this entry was listed from.
   * @remarks 中文说明：常量说明：parentPath 用于处理 parentPath 相关数据，作用于成员；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。 */
  readonly parentPath: string
  /**
   * 常量说明：file 用于处理 file 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly file: boolean

  /**
   * Build one directory entry.
   * @param name - entry name.
   * @param parentPath - directory holding it.
   * @param file - whether the entry is a regular file.
   * @remarks 中文说明：功能说明：处理 Dirent 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：name（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：parentPath（string）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；
   * 参数说明：file（boolean）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；返回值：当前类实例；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：通过 new Dirent(name, parentPath,
   * file) 创建实例，并在所属生命周期内使用。
   */
  constructor(name: string, parentPath: string, file: boolean) {
    this.name = name
    this.parentPath = parentPath
    this.file = file
  }

  /**
   * Entry kind, as `readdirSync` observed it.
   * @returns Whether the entry is a regular file.
   * @remarks 中文说明：功能说明：判断是否为 File 相关流程；使用场景由所在模块及调用位置决定。；返回值：boolean；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 isFile()，并按返回类型处理结果。
   */
  isFile(): boolean {
    return this.file
  }

  /**
   * Entry kind, as `readdirSync` observed it.
   * @returns Whether the entry is a directory.
   * @remarks 中文说明：功能说明：判断是否为 Directory 相关流程；使用场景由所在模块及调用位置决定。；返回值：boolean；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 isDirectory()，并按返回类型处理结果。
   */
  isDirectory(): boolean {
    return !this.file
  }

  /**
   * Symlink test, answered from the image's own shape.
   * @returns False — the image is materialized without symlinks.
   * @remarks 中文说明：功能说明：判断是否为 Symbolic Link 相关流程；使用场景由所在模块及调用位置决定。；
   * 返回值：boolean；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * isSymbolicLink()，并按返回类型处理结果。
   */
  isSymbolicLink(): boolean {
    return false
  }
}

/** Access-mode constants; the VFS has no permission model, so all bits pass.
 * @remarks 中文说明：常量说明：constants 用于处理 constants 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
export const constants = {
  F_OK: 0,
  R_OK: 4,
  W_OK: 2,
  X_OK: 1,
  COPYFILE_EXCL: 1,
  O_RDONLY: 0,
  O_WRONLY: 1,
  O_RDWR: 2,
  O_CREAT: 64,
  O_TRUNC: 512,
  O_APPEND: 1024,
}

/**
 * Read a file.
 * @param path - file path.
 * @param options - encoding, or an options object carrying one.
 * @returns bytes, or text when an encoding is given.
 * @remarks 中文说明：功能说明：读取 File Sync 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：path（PathArg）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；
 * 参数说明：options（EncodingOption）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。；返回值：Buffer
 * | string；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * readFileSync(path, options)，并按返回类型处理结果。
 */
export function readFileSync(path: PathArg, options?: EncodingOption): Buffer | string {
  /**
   * 常量说明：encoding 用于处理 encoding 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const encoding = encodingOf(options)
  /**
   * 常量说明：bytes 用于处理 bytes 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const bytes = bytesOf(asPath(path))
  return encoding === undefined || encoding === 'utf8' || encoding === 'utf-8'
    ? (encoding === undefined ? asBuffer(bytes) : new TextDecoder().decode(bytes))
    : asBuffer(bytes).toString(encoding)
}

/**
 * Write a file.
 * @param path - file path.
 * @param data - bytes or text.
 * @param options - write flag and creation mode, forwarded to the VFS.
 * @remarks 中文说明：功能说明：写入 File Sync 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：path（PathArg）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；参数说明：data（string |
 * Uint8Array）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：options（VfsWriteOptions）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。；返回值：void；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 writeFileSync(path, data,
 * options)，并按返回类型处理结果。
 */
export function writeFileSync(path: PathArg, data: string | Uint8Array, options?: VfsWriteOptions): void {
  vfs().writeFileSync(asPath(path), data, options)
}

/**
 * Append to a file, creating it when absent.
 * @param path - file path.
 * @param data - bytes or text.
 * @remarks 中文说明：功能说明：处理 appendFileSync 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：path（PathArg）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；参数说明：data（string |
 * Uint8Array）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 appendFileSync(path, data)，并按返回类型处理结果。
 */
export function appendFileSync(path: PathArg, data: string | Uint8Array): void {
  vfs().appendFileSync(asPath(path), data)
}

/**
 * Whether a path exists.
 * @param path - the path.
 * @returns true when present.
 * @remarks 中文说明：功能说明：处理 existsSync 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：path（PathArg）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；返回值：boolean；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 existsSync(path)，
 * 并按返回类型处理结果。
 */
export function existsSync(path: PathArg): boolean {
  return vfs().existsSync(asPath(path))
}

/**
 * Stat a path.
 * @param path - the path.
 * @param options - `bigint` selects the BigInt stats the filesystem service reads.
 * @returns the stats, in the plain or BigInt shape.
 * @remarks 中文说明：功能说明：处理 statSync 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：path（PathArg）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；
 * 参数说明：options（VfsStatOptions）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。；
 * 返回值：VfsStats | VfsBigIntStats；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 statSync(path, options)，并按返回类型处理结果。
 */
export function statSync(path: PathArg, options?: VfsStatOptions): VfsStats | VfsBigIntStats {
  return vfs().statSync(asPath(path), options)
}

/**
 * Read stats through Node's callback form.
 * @param path - Path to stat.
 * @param optionsOrCallback - Stat options or the completion callback.
 * @param maybeCallback - Completion callback when options are present.
 * @remarks 中文说明：功能说明：处理 stat 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：path（PathArg）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；
 * 参数说明：optionsOrCallback（VfsStatOptions | ((error: NodeJS.ErrnoException |
 * null, sta…）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。；参数说明：maybeCallback（(error:
 * NodeJS.ErrnoException | null, stats?: VfsStats | Vf…）：接收后续状态或事件并执行调用方逻辑；
 * 必须满足声明的类型及调用时序要求。；返回值：void；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 stat(path, optionsOrCallback, maybeCallback)，
 * 并按返回类型处理结果。
 */
export function stat(
  path: PathArg,
  optionsOrCallback: VfsStatOptions | ((error: NodeJS.ErrnoException | null, stats?: VfsStats | VfsBigIntStats) => void),
  maybeCallback?: (error: NodeJS.ErrnoException | null, stats?: VfsStats | VfsBigIntStats) => void,
): void {
  /**
   * 常量说明：options 用于处理 options 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const options = typeof optionsOrCallback === 'function' ? undefined : optionsOrCallback
  /**
   * 常量说明：callback 用于处理 callback 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const callback = typeof optionsOrCallback === 'function' ? optionsOrCallback : maybeCallback
  if (callback === undefined) throw new TypeError('The "callback" argument must be of type function')
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  queueMicrotask(() => {
    /**
     * 变量说明：result 用于处理 result 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let result: VfsStats | VfsBigIntStats
    /**
     * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
     */
    try {
      result = statSync(path, options)
    } catch (error) {
      callback(error as NodeJS.ErrnoException)
      return
    }
    callback(null, result)
  })
}

/**
 * Change an entry's permission bits; stat reads back exactly what was set.
 * @param path - the path.
 * @param mode - new permission bits (`0o777` mask), numeric or Node's octal string form.
 * @remarks 中文说明：功能说明：处理 chmodSync 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：path（PathArg）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；参数说明：mode（number |
 * string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 chmodSync(path, mode)，并按返回类型处理结果。
 */
export function chmodSync(path: PathArg, mode: number | string): void {
  vfs().chmodSync(asPath(path), typeof mode === 'string' ? Number.parseInt(mode, 8) : mode)
}

/**
 * Stat a path without following symlinks (the image has none).
 * @param path - the path.
 * @param options - `bigint` selects the BigInt stats the filesystem service reads.
 * @returns the stats, in the plain or BigInt shape.
 * @remarks 中文说明：功能说明：处理 lstatSync 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：path（PathArg）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；
 * 参数说明：options（VfsStatOptions）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。；
 * 返回值：VfsStats | VfsBigIntStats；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 lstatSync(path, options)，并按返回类型处理结果。
 */
export function lstatSync(path: PathArg, options?: VfsStatOptions): VfsStats | VfsBigIntStats {
  return statSync(path, options)
}

/**
 * Read link stats through Node's callback form; this symlink-free VFS delegates to stat.
 * @param path - Path to stat.
 * @param optionsOrCallback - Stat options or the completion callback.
 * @param maybeCallback - Completion callback when options are present.
 * @remarks 中文说明：功能说明：处理 lstat 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：path（PathArg）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；
 * 参数说明：optionsOrCallback（VfsStatOptions | ((error: NodeJS.ErrnoException |
 * null, sta…）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。；参数说明：maybeCallback（(error:
 * NodeJS.ErrnoException | null, stats?: VfsStats | Vf…）：接收后续状态或事件并执行调用方逻辑；
 * 必须满足声明的类型及调用时序要求。；返回值：void；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 lstat(path, optionsOrCallback, maybeCallback)，
 * 并按返回类型处理结果。
 */
export function lstat(
  path: PathArg,
  optionsOrCallback: VfsStatOptions | ((error: NodeJS.ErrnoException | null, stats?: VfsStats | VfsBigIntStats) => void),
  maybeCallback?: (error: NodeJS.ErrnoException | null, stats?: VfsStats | VfsBigIntStats) => void,
): void {
  stat(path, optionsOrCallback, maybeCallback)
}

/**
 * Canonical path (normalization only: the image is symlink-free).
 * @param path - the path.
 * @returns the resolved path.
 * @remarks 中文说明：功能说明：处理 realpathSync 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：path（PathArg）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；返回值：string；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 realpathSync(path)，
 * 并按返回类型处理结果。
 */
export function realpathSync(path: PathArg): string {
  return vfs().realpathSync(asPath(path))
}

/**
 * List a directory.
 * @param path - directory path.
 * @param options - `withFileTypes` selects Dirent objects.
 * @returns names, or Dirent objects.
 * @remarks 中文说明：功能说明：处理 readdirSync 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：path（PathArg）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；参数说明：options（{
 * withFileTypes?: boolean } | BufferEncoding | null）：提供本次操作使用的配置选项；
 * 必须满足声明的类型及调用时序要求。；返回值：string[] | Dirent[]；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 readdirSync(path, options)，并按返回类型处理结果。
 */
export function readdirSync(
  path: PathArg,
  options?: { withFileTypes?: boolean } | BufferEncoding | null,
): string[] | Dirent[] {
  /**
   * 常量说明：target 用于处理 target 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const target = asPath(path)
  /**
   * 常量说明：names 用于处理 names 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const names = vfs().readdirSync(target)
  if (typeof options !== 'object' || options === null || options.withFileTypes !== true) return names
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：name（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(name)，并按返回类型处理结果。
   */
  return names.map(name => new Dirent(name, target, vfs().statSync(`${target}/${name}`).isFile()))
}

/**
 * Create a directory.
 * @param path - directory path.
 * @param options - `recursive` creates parents.
 * @returns the first created path when recursive, else undefined.
 * @remarks 中文说明：功能说明：处理 mkdirSync 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：path（PathArg）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；参数说明：options（{
 * recursive?: boolean; mode?: number }）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。；
 * 返回值：string | undefined；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * mkdirSync(path, options)，并按返回类型处理结果。
 */
export function mkdirSync(path: PathArg, options?: { recursive?: boolean; mode?: number }): string | undefined {
  return vfs().mkdirSync(asPath(path), options)
}

/**
 * Create a uniquely named directory.
 * @param prefix - path prefix; six random characters are appended.
 * @returns the created directory path.
 * @remarks 中文说明：功能说明：处理 mkdtempSync 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：prefix（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：string；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 mkdtempSync(prefix)，并按返回类型处理结果。
 */
export function mkdtempSync(prefix: string): string {
  // Not crypto.randomUUID: browsers expose that only in secure contexts.
  /**
   * 常量说明：suffix 用于处理 suffix 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：byte（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(byte)，并按返回类型处理结果。
   */
  const suffix = Array.from(globalThis.crypto.getRandomValues(new Uint8Array(3)), byte => byte.toString(16).padStart(2, '0')).join('')
  /**
   * 常量说明：target 用于处理 target 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const target = `${prefix}${suffix}`
  vfs().mkdirSync(target, { recursive: true })
  return target
}

/**
 * Remove a file or directory.
 * @param path - the path.
 * @param options - `recursive`/`force`, as in Node.
 * @remarks 中文说明：功能说明：处理 rmSync 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：path（PathArg）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；参数说明：options（{
 * recursive?: boolean; force?: boolean }）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。；
 * 返回值：void；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 rmSync(path,
 * options)，并按返回类型处理结果。
 */
export function rmSync(path: PathArg, options?: { recursive?: boolean; force?: boolean }): void {
  vfs().rmSync(asPath(path), options)
}

/**
 * Remove a file.
 * @param path - the path.
 * @remarks 中文说明：功能说明：处理 unlinkSync 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：path（PathArg）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；返回值：void；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 unlinkSync(path)，
 * 并按返回类型处理结果。
 */
export function unlinkSync(path: PathArg): void {
  vfs().rmSync(asPath(path))
}

/**
 * Rename a path.
 * @param from - source path.
 * @param to - target path.
 * @remarks 中文说明：功能说明：处理 renameSync 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：from（PathArg）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：to（PathArg）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 renameSync(from, to)，并按返回类型处理结果。
 */
export function renameSync(from: PathArg, to: PathArg): void {
  vfs().renameSync(asPath(from), asPath(to))
}

/**
 * Access check: existence only.
 * @param path - the path.
 * @remarks 中文说明：功能说明：处理 accessSync 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：path（PathArg）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；返回值：void；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 accessSync(path)，
 * 并按返回类型处理结果。
 */
export function accessSync(path: PathArg): void {
  vfs().realpathSync(asPath(path))
}

interface OpenFile {
  file: VfsOpenFile
  position: number
}

/**
 * 常量说明：openFiles 用于打开 Files 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const openFiles = new Map<number, OpenFile>()
/**
 * 变量说明：nextFd 用于处理 nextFd 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
 */
let nextFd = 3

/**
 * Open a file descriptor.
 * @param path - file path.
 * @param flags - Node flag string: 'r', 'w', 'a', with optional '+' and the
 * exclusive 'x' (create-only) modifier.
 * @param mode - creation permission bits.
 * @returns the descriptor.
 * @remarks 中文说明：功能说明：打开 Sync 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：path（PathArg）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；参数说明：flags（由
 * TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：mode（number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：number；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 openSync(path, flags, mode)，
 * 并按返回类型处理结果。
 */
export function openSync(path: PathArg, flags = 'r', mode?: number): number {
  /**
   * 常量说明：target 用于处理 target 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const target = asPath(path)
  /**
   * 常量说明：file 用于处理 file 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const file = vfs().openFileSync(target, flags, mode)
  /**
   * 常量说明：fd 用于处理 fd 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const fd = nextFd++
  openFiles.set(fd, { file, position: 0 })
  return fd
}

/**
 * 常量说明：badFileDescriptor 用于处理 badFileDescriptor 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 * 功能说明：处理 badFileDescriptor 相关流程；使用场景由所在模块及调用位置决定。
 * @param syscall （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns never；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 badFileDescriptor(syscall)，并按返回类型处理结果。
 */
const badFileDescriptor = (syscall: string): never => {
  /**
   * 常量说明：error 用于处理 error 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const error = new Error(`EBADF: bad file descriptor, ${syscall}`) as Error & { code: string; syscall: string }
  error.code = 'EBADF'
  error.syscall = syscall
  throw error
}

/**
 * 常量说明：fileOf 用于处理 fileOf 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 * 功能说明：处理 fileOf 相关流程；使用场景由所在模块及调用位置决定。
 * @param fd （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param syscall （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns OpenFile；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 fileOf(fd, syscall)，并按返回类型处理结果。
 */
const fileOf = (fd: number, syscall: string): OpenFile => {
  /**
   * 常量说明：file 用于处理 file 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const file = openFiles.get(fd)
  if (file === undefined) return badFileDescriptor(syscall)
  return file
}

/**
 * Read from a descriptor.
 * @param fd - descriptor.
 * @param buffer - destination.
 * @param offset - destination offset.
 * @param length - byte count.
 * @param position - file position, or null to continue from the cursor.
 * @returns bytes read.
 * @remarks 中文说明：功能说明：读取 Sync 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：fd（number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：buffer（Uint8Array）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数说明：offset（由
 * TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数说明：length（由
 * TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：position（number | null）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：number；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 readSync(fd, buffer,
 * offset, length, position)，并按返回类型处理结果。
 */
export function readSync(
  fd: number,
  buffer: Uint8Array,
  offset = 0,
  length = buffer.byteLength,
  position: number | null = null,
): number {
  /**
   * 常量说明：file 用于处理 file 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const file = fileOf(fd, 'read')
  /**
   * 常量说明：from 用于处理 from 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const from = position ?? file.position
  /**
   * 常量说明：slice 用于处理 slice 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const slice = file.file.read(from, length)
  buffer.set(slice, offset)
  if (position === null) file.position = from + slice.byteLength
  return slice.byteLength
}

/**
 * Write through a descriptor.
 * @param fd - descriptor.
 * @param data - bytes or text.
 * @returns bytes written.
 * @remarks 中文说明：功能说明：写入 Sync 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：fd（number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数说明：data（string |
 * Uint8Array）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：number；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 writeSync(fd, data)，并按返回类型处理结果。
 */
export function writeSync(fd: number, data: string | Uint8Array): number {
  /**
   * 常量说明：file 用于处理 file 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const file = fileOf(fd, 'write')
  /**
   * 常量说明：bytes 用于处理 bytes 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data
  /**
   * 常量说明：position 用于处理 position 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const position = file.file.append ? file.file.stat().size : file.position
  /**
   * 常量说明：bytesWritten 用于处理 bytesWritten 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const bytesWritten = file.file.write(position, bytes)
  file.position = position + bytesWritten
  return bytesWritten
}

/**
 * Close a descriptor.
 * @param fd - descriptor.
 * @remarks 中文说明：功能说明：关闭 Sync 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：fd（number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 closeSync(fd)，并按返回类型处理结果。
 */
export function closeSync(fd: number): void {
  if (!openFiles.delete(fd)) fileOf(fd, 'close')
}

/**
 * Create a second name for one file identity.
 * @param from - existing path.
 * @param to - new path.
 * @remarks 中文说明：功能说明：处理 linkSync 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：from（PathArg）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：to（PathArg）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 linkSync(from, to)，并按返回类型处理结果。
 */
export function linkSync(from: PathArg, to: PathArg): void {
  vfs().linkSync(asPath(from), asPath(to))
}

/**
 * Open file handle (`fs.FileHandle` subset): the atomic-write and durability
 * pair the storage backends use. `sync`/`datasync` settle the active VFS's
 * optional write-behind sink.
 */
export interface FileHandle {
  readonly fd: number
  /**
   * 功能说明：读取 File 相关流程；使用场景由所在模块及调用位置决定。
   * @param options （EncodingOption）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。
   * @returns Promise<Buffer | string>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 readFile(options)，并按返回类型处理结果。
   */
  readFile(options?: EncodingOption): Promise<Buffer | string>
  /**
   * 功能说明：写入 File 相关流程；使用场景由所在模块及调用位置决定。
   * @param data （string | Uint8Array）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param encoding （BufferEncoding）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 writeFile(data, encoding)，并按返回类型处理结果。
   */
  writeFile(data: string | Uint8Array, encoding?: BufferEncoding): Promise<void>
  /**
   * 功能说明：写入 write 相关流程；使用场景由所在模块及调用位置决定。
   * @param data （string | Uint8Array）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns Promise<{ bytesWritten: number }>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 write(data)，并按返回类型处理结果。
   */
  write(data: string | Uint8Array): Promise<{ bytesWritten: number }>
  /**
   * 功能说明：读取 read 相关流程；使用场景由所在模块及调用位置决定。
   * @param buffer （Uint8Array）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param offset （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param length （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param position （number | null）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns Promise<{ bytesRead: number; buffer: Uint8Array }>；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 read(buffer, offset, length, position)，并按返回类型处理结果。
   */
  read(buffer: Uint8Array, offset?: number, length?: number, position?: number | null): Promise<{ bytesRead: number; buffer: Uint8Array }>
  /**
   * 功能说明：处理 stat 相关流程；使用场景由所在模块及调用位置决定。
   * @returns Promise<VfsStats>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 stat()，并按返回类型处理结果。
   */
  stat(): Promise<VfsStats>
  /**
   * 功能说明：处理 truncate 相关流程；使用场景由所在模块及调用位置决定。
   * @param length （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 truncate(length)，并按返回类型处理结果。
   */
  truncate(length?: number): Promise<void>
  /**
   * 功能说明：同步 sync 相关流程；使用场景由所在模块及调用位置决定。
   * @returns Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 sync()，并按返回类型处理结果。
   */
  sync(): Promise<void>
  /**
   * 功能说明：处理 datasync 相关流程；使用场景由所在模块及调用位置决定。
   * @returns Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 datasync()，并按返回类型处理结果。
   */
  datasync(): Promise<void>
  /**
   * 功能说明：关闭 close 相关流程；使用场景由所在模块及调用位置决定。
   * @returns Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 close()，并按返回类型处理结果。
   */
  close(): Promise<void>
}

/**
 * Open a file handle. Directories open read-only, which is what the durability
 * helpers do before an fsync.
 * @param path - file or directory path.
 * @param flags - Node flag string.
 * @param mode - creation permission bits.
 * @returns the handle.
 * @remarks 中文说明：功能说明：打开 Handle Sync 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：path（PathArg）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；参数说明：flags（由
 * TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：mode（number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：FileHandle；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 openHandleSync(path,
 * flags, mode)，并按返回类型处理结果。
 */
export function openHandleSync(path: PathArg, flags = 'r', mode?: number): FileHandle {
  /**
   * 常量说明：target 用于处理 target 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const target = asPath(path)
  /**
   * 常量说明：directory 用于处理 directory 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const directory = vfs().existsSync(target) && vfs().statSync(target).isDirectory()
  /**
   * 常量说明：fd 用于处理 fd 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const fd = directory ? -1 : openSync(target, flags, mode)
  /**
   * 变量说明：closed 用于处理 closed 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let closed = false
  /**
   * 常量说明：descriptor 用于处理 descriptor 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   * 功能说明：处理 descriptor 相关流程；使用场景由所在模块及调用位置决定。
   * @param syscall （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns OpenFile；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 descriptor(syscall)，并按返回类型处理结果。
   */
  const descriptor = (syscall: string): OpenFile => fileOf(fd, syscall)
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：options（EncodingOption）：提供本次操作使用的
   * 配置选项；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(options)，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：data（string |
   * Uint8Array）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(data)，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：data（string |
   * Uint8Array）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(data)，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：buffer（Uint8Array）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。；参数：offset（由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。；参数：length（由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。；参数：position（number | null）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 典型用法：在完成前置校验后调用 匿名回调(buffer, offset, length, position)，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：length（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(length)，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  return {
    fd,
    readFile: async (options?: EncodingOption) => {
      if (directory) return readFileSync(target, options)
      /**
       * 常量说明：open 用于打开 open 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const open = descriptor('read')
      /**
       * 常量说明：bytes 用于处理 bytes 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const bytes = open.file.read(open.position, Math.max(0, open.file.stat().size - open.position))
      open.position += bytes.length
      /**
       * 常量说明：encoding 用于处理 encoding 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const encoding = encodingOf(options)
      return encoding === undefined || encoding === 'utf8' || encoding === 'utf-8'
        ? (encoding === undefined ? asBuffer(bytes) : new TextDecoder().decode(bytes))
        : asBuffer(bytes).toString(encoding)
    },
    writeFile: async (data: string | Uint8Array) => {
      if (directory) writeFileSync(target, data)
      else writeSync(fd, data)
    },
    write: async (data: string | Uint8Array) => ({ bytesWritten: writeSync(fd, data) }),
    read: async (buffer: Uint8Array, offset = 0, length = buffer.byteLength, position: number | null = null) => ({
      bytesRead: readSync(fd, buffer, offset, length, position),
      buffer,
    }),
    stat: async () => directory ? statSync(target) as VfsStats : descriptor('fstat').file.stat(),
    truncate: async (length = 0) => {
      if (directory) writeFileSync(target, new Uint8Array(length))
      else descriptor('ftruncate').file.truncate(length)
    },
    sync: async () => { await vfs().flush() },
    datasync: async () => { await vfs().flush() },
    close: async () => {
      if (closed) return
      closed = true
      if (fd !== -1) closeSync(fd)
    },
  }
}

/** Options supported by the VFS-backed read stream. */
export interface ReadStreamOptions {
  flags?: string
  encoding?: BufferEncoding | null
  autoClose?: boolean
  emitClose?: boolean
  start?: number
  end?: number
  highWaterMark?: number
  signal?: AbortSignal
}

/** Options supported by the VFS-backed write stream. */
export interface WriteStreamOptions {
  flags?: string
  encoding?: BufferEncoding | null
  mode?: number
  autoClose?: boolean
  emitClose?: boolean
  start?: number
  highWaterMark?: number
  signal?: AbortSignal
}

/** Node implements file-stream `autoClose` through the stream's `autoDestroy` state.
 * @remarks 中文说明：常量说明：streamAutoDestroy 用于处理 streamAutoDestroy 相关数据，
 * 作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。；功能说明：处理 streamAutoDestroy 相关流程；
 * 使用场景由所在模块及调用位置决定。；参数说明：autoClose（boolean | undefined）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。；返回值：boolean；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 streamAutoDestroy(autoClose)，并按返回类型处理结果。 */
const streamAutoDestroy = (autoClose: boolean | undefined): boolean => autoClose ?? true

interface FileStreamState {
  fd: number | null
  pending: boolean
}

/** Release the descriptor and abort listener shared by both file-stream directions.
 * @remarks 中文说明：功能说明：处理 destroyFileStream 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：stream（FileStreamState）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：signal（AbortSignal | undefined）：传递取消或终止信号；必须满足声明的类型及调用时序要求。；
 * 参数说明：onAbort（(() => void) | undefined）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：error（Error | null）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：callback（(error: Error | null) => void）：接收后续状态或事件并执行调用方逻辑；
 * 必须满足声明的类型及调用时序要求。；返回值：void；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 destroyFileStream(stream, signal, onAbort, error,
 * callback)，并按返回类型处理结果。 */
function destroyFileStream(
  stream: FileStreamState,
  signal: AbortSignal | undefined,
  onAbort: (() => void) | undefined,
  error: Error | null,
  callback: (error: Error | null) => void,
): void {
  signal?.removeEventListener('abort', onAbort as () => void)
  if (stream.fd !== null) closeSync(stream.fd)
  stream.fd = null
  stream.pending = false
  callback(error)
}

interface ClosableFileStream {
  /**
   * 功能说明：处理 once 相关流程；使用场景由所在模块及调用位置决定。
   * @param event （string）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。
   * @param listener （() => void）：接收后续状态或事件并执行调用方逻辑；必须满足声明的类型及调用时序要求。
   * @returns unknown；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 once(event, listener)，并按返回类型处理结果。
   */
  once(event: string, listener: () => void): unknown
  /**
   * 功能说明：处理 destroy 相关流程；使用场景由所在模块及调用位置决定。
   * @returns unknown；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 destroy()，并按返回类型处理结果。
   */
  destroy(): unknown
}

/** Register an optional completion callback and explicitly destroy a file stream.
 * @remarks 中文说明：功能说明：关闭 File Stream 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：stream（ClosableFileStream）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：callback（(error?: NodeJS.ErrnoException | null) =>
 * void）：接收后续状态或事件并执行调用方逻辑；必须满足声明的类型及调用时序要求。；返回值：void；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 closeFileStream(stream, callback)，
 * 并按返回类型处理结果。 */
function closeFileStream(
  stream: ClosableFileStream,
  callback?: (error?: NodeJS.ErrnoException | null) => void,
): void {
  /**
  * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
  * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
  */
  if (callback !== undefined) stream.once('close', () => { callback(null) })
  stream.destroy()
}

/** Read stream over one VFS file.
 * @remarks 中文说明：类说明：ReadStream 用于集中封装 读取 Stream 相关状态与行为。；核心功能：通过成员字段保存状态，
 * 并由公开方法提供受类型约束的操作入口。；使用场景：由 experimental/webworker-runtime
 * 在对应插件或业务生命周期内创建和调用。 */
export class ReadStream extends Readable {
  /** Resolved path opened by this stream.
   * @remarks 中文说明：常量说明：path 用于处理 path 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
  readonly path: string
  /** Open descriptor, or null before open and after close.
   * @remarks 中文说明：变量说明：fd 用于处理 fd 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。 */
  fd: number | null = null
  /** Whether the descriptor is still waiting to open.
   * @remarks 中文说明：变量说明：pending 用于处理 pending 相关数据，作用于成员；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。 */
  pending = true
  /** Bytes delivered by this stream.
   * @remarks 中文说明：变量说明：bytesRead 用于处理 bytesRead 相关数据，作用于成员；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。 */
  bytesRead = 0
  /**
   * 常量说明：start 用于启动 start 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly start: number
  /**
   * 常量说明：end 用于处理 end 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly end: number
  /**
   * 常量说明：flags 用于处理 flags 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly flags: string
  /**
   * 常量说明：signal 用于处理 signal 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly signal: AbortSignal | undefined
  /**
   * 常量说明：onAbort 用于响应 Abort 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly onAbort: (() => void) | undefined
  /**
   * 变量说明：position 用于处理 position 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  private position: number

  /**
   * 功能说明：读取 Stream 相关流程；使用场景由所在模块及调用位置决定。
   * @param path （PathArg）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。
   * @param options （ReadStreamOptions）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。
   * @returns 当前类实例；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 通过 new ReadStream(path, options) 创建实例，并在所属生命周期内使用。
   */
  constructor(path: PathArg, options: ReadStreamOptions = {}) {
    super({
      autoDestroy: streamAutoDestroy(options.autoClose),
      emitClose: options.emitClose ?? true,
      highWaterMark: options.highWaterMark ?? 64 * 1024,
    })
    this.path = asPath(path)
    this.start = options.start ?? 0
    this.end = options.end ?? Number.POSITIVE_INFINITY
    this.flags = options.flags ?? 'r'
    this.position = this.start
    this.signal = options.signal
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    this.onAbort = options.signal === undefined ? undefined : () => { this.destroy(abortError(options.signal?.reason)) }
    if (options.encoding !== undefined && options.encoding !== null) this.setEncoding(options.encoding)
    options.signal?.addEventListener('abort', this.onAbort as () => void, { once: true })
  }

  /**
   * 功能说明：处理 _construct 相关流程；使用场景由所在模块及调用位置决定。
   * @param callback （(error?: Error | null) => void）：接收后续状态或事件并执行调用方逻辑；
   * 必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 _construct(callback)，并按返回类型处理结果。
   */
  override _construct(callback: (error?: Error | null) => void): void {
    if (this.start < 0 || this.end < this.start) {
      callback(new RangeError('The value of "start" is out of range'))
      return
    }
    if (this.signal?.aborted === true) {
      callback(abortError(this.signal.reason))
      return
    }
    /**
     * 变量说明：fd 用于处理 fd 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let fd: number
    /**
     * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
     */
    try {
      fd = openSync(this.path, this.flags)
    } catch (error) {
      callback(error as Error)
      return
    }
    this.fd = fd
    this.pending = false
    callback()
    this.emit('open', fd)
    this.emit('ready')
  }

  /**
   * 功能说明：读取 _read 相关流程；使用场景由所在模块及调用位置决定。
   * @param size （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 _read(size)，并按返回类型处理结果。
   */
  override _read(size: number): void {
    if (this.fd === null) return
    /**
     * 常量说明：remaining 用于处理 remaining 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const remaining = this.end === Number.POSITIVE_INFINITY ? size : Math.min(size, this.end - this.position + 1)
    if (remaining <= 0) {
      this.push(null)
      return
    }
    /**
     * 常量说明：buffer 用于处理 buffer 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const buffer = Buffer.allocUnsafe(remaining)
    /**
     * 变量说明：count 用于处理 count 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let count: number
    /**
     * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
     */
    try {
      count = readSync(this.fd, buffer, 0, remaining, this.position)
    } catch (error) {
      this.destroy(error as Error)
      return
    }
    if (count === 0) {
      this.push(null)
      return
    }
    this.position += count
    this.bytesRead += count
    this.push(buffer.subarray(0, count))
  }

  /**
   * 功能说明：处理 _destroy 相关流程；使用场景由所在模块及调用位置决定。
   * @param error （Error | null）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param callback （(error?: Error | null) => void）：接收后续状态或事件并执行调用方逻辑；
   * 必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 _destroy(error, callback)，并按返回类型处理结果。
   */
  override _destroy(error: Error | null, callback: (error?: Error | null) => void): void {
    destroyFileStream(this, this.signal, this.onAbort, error, callback)
  }

  /**
   * Close the stream and release its descriptor.
   * @param callback - Optional completion callback after `close`.
   * @remarks 中文说明：功能说明：关闭 close 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：callback（(error?: NodeJS.ErrnoException | null) =>
   * void）：接收后续状态或事件并执行调用方逻辑；必须满足声明的类型及调用时序要求。；返回值：void；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 close(callback)，并按返回类型处理结果。
   */
  close(callback?: (error?: NodeJS.ErrnoException | null) => void): void {
    closeFileStream(this, callback)
  }
}

/** Writable stream committing chunks through the VFS file-descriptor face.
 * @remarks 中文说明：类说明：WriteStream 用于集中封装 写入 Stream 相关状态与行为。；核心功能：通过成员字段保存状态，
 * 并由公开方法提供受类型约束的操作入口。；使用场景：由 experimental/webworker-runtime
 * 在对应插件或业务生命周期内创建和调用。 */
export class WriteStream extends Writable {
  /** Resolved path opened by this stream.
   * @remarks 中文说明：常量说明：path 用于处理 path 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
  readonly path: string
  /** Open descriptor, or null before open and after close.
   * @remarks 中文说明：变量说明：fd 用于处理 fd 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。 */
  fd: number | null = null
  /** Whether the descriptor is still waiting to open.
   * @remarks 中文说明：变量说明：pending 用于处理 pending 相关数据，作用于成员；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。 */
  pending = true
  /** Bytes committed by this stream.
   * @remarks 中文说明：变量说明：bytesWritten 用于处理 bytesWritten 相关数据，作用于成员；
   * 其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。 */
  bytesWritten = 0
  /**
   * 常量说明：flags 用于处理 flags 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly flags: string
  /**
   * 常量说明：mode 用于处理 mode 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly mode: number | undefined
  /**
   * 常量说明：start 用于启动 start 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly start: number | undefined
  /**
   * 常量说明：signal 用于处理 signal 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly signal: AbortSignal | undefined
  /**
   * 常量说明：onAbort 用于响应 Abort 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly onAbort: (() => void) | undefined

  /**
   * 功能说明：写入 Stream 相关流程；使用场景由所在模块及调用位置决定。
   * @param path （PathArg）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。
   * @param options （WriteStreamOptions）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。
   * @returns 当前类实例；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 通过 new WriteStream(path, options) 创建实例，并在所属生命周期内使用。
   */
  constructor(path: PathArg, options: WriteStreamOptions = {}) {
    super({
      autoDestroy: streamAutoDestroy(options.autoClose),
      decodeStrings: true,
      defaultEncoding: options.encoding ?? 'utf8',
      emitClose: options.emitClose ?? true,
      highWaterMark: options.highWaterMark ?? 64 * 1024,
    })
    this.path = asPath(path)
    this.flags = options.flags ?? 'w'
    this.mode = options.mode
    this.start = options.start
    this.signal = options.signal
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    this.onAbort = options.signal === undefined ? undefined : () => { this.destroy(abortError(options.signal?.reason)) }
    options.signal?.addEventListener('abort', this.onAbort as () => void, { once: true })
  }

  /**
   * 功能说明：处理 _construct 相关流程；使用场景由所在模块及调用位置决定。
   * @param callback （(error?: Error | null) => void）：接收后续状态或事件并执行调用方逻辑；
   * 必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 _construct(callback)，并按返回类型处理结果。
   */
  override _construct(callback: (error?: Error | null) => void): void {
    if (this.start !== undefined && this.start < 0) {
      callback(new RangeError('The value of "start" is out of range'))
      return
    }
    if (this.signal?.aborted === true) {
      callback(abortError(this.signal.reason))
      return
    }
    /**
     * 变量说明：fd 用于处理 fd 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let fd: number
    /**
     * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
     */
    try {
      fd = openSync(this.path, this.flags, this.mode)
    } catch (error) {
      callback(error as Error)
      return
    }
    this.fd = fd
    if (this.start !== undefined) fileOf(fd, 'write').position = this.start
    this.pending = false
    callback()
    this.emit('open', fd)
    this.emit('ready')
  }

  /**
   * 功能说明：写入 _write 相关流程；使用场景由所在模块及调用位置决定。
   * @param chunk （string | Uint8Array）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param encoding （BufferEncoding）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param callback （(error?: Error | null) => void）：接收后续状态或事件并执行调用方逻辑；
   * 必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 _write(chunk, encoding, callback)，并按返回类型处理结果。
   */
  override _write(
    chunk: string | Uint8Array,
    encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    /**
     * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
     */
    try {
      /**
       * 常量说明：fd 用于处理 fd 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const fd = this.fd
      if (fd === null) return badFileDescriptor('write')
      /**
       * 常量说明：data 用于处理 data 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const data = typeof chunk === 'string' ? Buffer.from(chunk, encoding) : chunk
      this.bytesWritten += writeSync(fd, data)
      callback()
    } catch (error) {
      callback(error as Error)
    }
  }

  /**
   * 功能说明：处理 _destroy 相关流程；使用场景由所在模块及调用位置决定。
   * @param error （Error | null）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param callback （(error: Error | null) => void）：接收后续状态或事件并执行调用方逻辑；
   * 必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 _destroy(error, callback)，并按返回类型处理结果。
   */
  override _destroy(error: Error | null, callback: (error: Error | null) => void): void {
    destroyFileStream(this, this.signal, this.onAbort, error, callback)
  }

  /**
   * Close the stream and release its descriptor.
   * @param callback - Optional completion callback after `close`.
   * @remarks 中文说明：功能说明：关闭 close 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：callback（(error?: NodeJS.ErrnoException | null) =>
   * void）：接收后续状态或事件并执行调用方逻辑；必须满足声明的类型及调用时序要求。；返回值：void；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 close(callback)，并按返回类型处理结果。
   */
  close(callback?: (error?: NodeJS.ErrnoException | null) => void): void {
    closeFileStream(this, callback)
  }
}

/**
 * Create a Node-compatible readable file stream over the VFS.
 * @param path - File path.
 * @param options - Encoding, range, open, buffer, and abort options.
 * @returns The readable file stream.
 * @remarks 中文说明：功能说明：创建 Read Stream 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：path（PathArg）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；
 * 参数说明：options（ReadStreamOptions | BufferEncoding）：提供本次操作使用的配置选项；
 * 必须满足声明的类型及调用时序要求。；返回值：ReadStream；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 createReadStream(path, options)，并按返回类型处理结果。
 */
export function createReadStream(path: PathArg, options?: ReadStreamOptions | BufferEncoding): ReadStream {
  return new ReadStream(path, typeof options === 'string' ? { encoding: options } : options)
}

/**
 * Create a Node-compatible writable file stream over the VFS.
 * @param path - File path.
 * @param options - Encoding, open, buffer, and abort options.
 * @returns The writable file stream.
 * @remarks 中文说明：功能说明：创建 Write Stream 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：path（PathArg）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；
 * 参数说明：options（WriteStreamOptions | BufferEncoding）：提供本次操作使用的配置选项；
 * 必须满足声明的类型及调用时序要求。；返回值：WriteStream；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 createWriteStream(path, options)，并按返回类型处理结果。
 */
export function createWriteStream(path: PathArg, options?: WriteStreamOptions | BufferEncoding): WriteStream {
  return new WriteStream(path, typeof options === 'string' ? { encoding: options } : options)
}

/** Open directory handle (`fs.Dir` subset): iteration plus the close pair. */
export interface Dir {
  readonly path: string
  /**
   * 功能说明：读取 read 相关流程；使用场景由所在模块及调用位置决定。
   * @returns Promise<Dirent | null>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 read()，并按返回类型处理结果。
   */
  read(): Promise<Dirent | null>
  /**
   * 功能说明：关闭 close 相关流程；使用场景由所在模块及调用位置决定。
   * @returns Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 close()，并按返回类型处理结果。
   */
  close(): Promise<void>
  /**
   * 功能说明：关闭 Sync 相关流程；使用场景由所在模块及调用位置决定。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 closeSync()，并按返回类型处理结果。
   */
  closeSync(): void
  /**
   * 功能说明：处理 [Symbol.asyncIterator] 相关流程；使用场景由所在模块及调用位置决定。
   * @returns AsyncIterableIterator<Dirent>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 [Symbol.asyncIterator]()，并按返回类型处理结果。
   */
  [Symbol.asyncIterator](): AsyncIterableIterator<Dirent>
}

/**
 * Open a directory handle. Callers use it to assert "this path is a directory"
 * and to walk entries; the listing is taken once, since the VFS has no external
 * writer to race with.
 * @param path - directory path.
 * @returns the handle.
 * @remarks 中文说明：功能说明：处理 opendirSync 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：path（PathArg）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；返回值：Dir；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 opendirSync(path)，
 * 并按返回类型处理结果。
 */
export function opendirSync(path: PathArg): Dir {
  /**
   * 常量说明：target 用于处理 target 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const target = asPath(path)
  /**
   * 常量说明：entries 用于处理 entries 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const entries = readdirSync(target, { withFileTypes: true }) as Dirent[]
  /**
   * 变量说明：index 用于处理 index 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let index = 0
  /**
   * 常量说明：next 用于处理 next 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   * 功能说明：处理 next 相关流程；使用场景由所在模块及调用位置决定。
   * @returns Dirent | null；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 next()，并按返回类型处理结果。
   */
  const next = (): Dirent | null => entries[index++] ?? null
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  return {
    path: target,
    read: async () => next(),
    close: async () => { index = entries.length },
    closeSync: () => { index = entries.length },
    /**
     * 功能说明：处理 [Symbol.asyncIterator] 相关流程；使用场景由所在模块及调用位置决定。
     * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 [Symbol.asyncIterator]()，并按返回类型处理结果。
     */
    async *[Symbol.asyncIterator]() {
      /**
       * 变量说明：entry 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
       */
      for (let entry = next(); entry !== null; entry = next()) yield entry
    },
  }
}

/**
 * Promise face (`node:fs/promises`) over the same VFS. Each member answers the
 * union the VFS produces rather than Node's encoding-dependent overloads, so the
 * check here is that every name is a real `node:fs/promises` export.
 * @remarks 中文说明：常量说明：promises 用于处理 promises 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：path（PathArg）：指定要读取、写入或匹配的文件位置；
 * 必须满足声明的类型及调用时序要求。；参数：options（EncodingOption）：提供本次操作使用的配置选项；
 * 必须满足声明的类型及调用时序要求。；返回值：Promise<Buffer | string>；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 典型用法：在完成前置校验后调用 匿名回调(path, options)，并按返回类型处理结果。
 */
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：path（PathArg）：指定要读取、写入或匹配的文件位置；
 * 必须满足声明的类型及调用时序要求。；参数：data（string | Uint8Array）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。；参数：options（{ flag?: string; mode?: number } |
 * BufferEncoding | null）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。；返回值：Promise<void>；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(path, data, options)，
 * 并按返回类型处理结果。
 */
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：path（PathArg）：指定要读取、写入或匹配的文件位置；
 * 必须满足声明的类型及调用时序要求。；参数：data（string | Uint8Array）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。；返回值：Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 典型用法：在完成前置校验后调用 匿名回调(path, data)，并按返回类型处理结果。
 */
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：path（PathArg）：指定要读取、写入或匹配的文件位置；
 * 必须满足声明的类型及调用时序要求。；参数：options（{ recursive?: boolean; mode?: number
 * }）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。；返回值：Promise<string | undefined>；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(path, options)，并按返回类型处理结果。
 */
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：prefix（string）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。；返回值：Promise<string>；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 典型用法：在完成前置校验后调用 匿名回调(prefix)，并按返回类型处理结果。
 */
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：path（PathArg）：指定要读取、写入或匹配的文件位置；
 * 必须满足声明的类型及调用时序要求。；参数：options（{ withFileTypes?: boolean } |
 * BufferEncoding）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。；返回值：Promise<string[] |
 * Dirent[]>；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(path, options)，
 * 并按返回类型处理结果。
 */
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：path（PathArg）：指定要读取、写入或匹配的文件位置；
 * 必须满足声明的类型及调用时序要求。；参数：options（VfsStatOptions）：提供本次操作使用的配置选项；
 * 必须满足声明的类型及调用时序要求。；返回值：Promise<VfsStats | VfsBigIntStats>；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(path, options)，并按返回类型处理结果。
 */
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：path（PathArg）：指定要读取、写入或匹配的文件位置；
 * 必须满足声明的类型及调用时序要求。；参数：options（VfsStatOptions）：提供本次操作使用的配置选项；
 * 必须满足声明的类型及调用时序要求。；返回值：Promise<VfsStats | VfsBigIntStats>；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(path, options)，并按返回类型处理结果。
 */
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：path（PathArg）：指定要读取、写入或匹配的文件位置；
 * 必须满足声明的类型及调用时序要求。；返回值：Promise<string>；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 典型用法：在完成前置校验后调用 匿名回调(path)，并按返回类型处理结果。
 */
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：path（PathArg）：指定要读取、写入或匹配的文件位置；
 * 必须满足声明的类型及调用时序要求。；参数：options（{ recursive?: boolean; force?: boolean
 * }）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。；返回值：Promise<void>；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(path, options)，并按返回类型处理结果。
 */
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：path（PathArg）：指定要读取、写入或匹配的文件位置；
 * 必须满足声明的类型及调用时序要求。；返回值：Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 典型用法：在完成前置校验后调用 匿名回调(path)，并按返回类型处理结果。
 */
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：from（PathArg）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。；参数：to（PathArg）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(from,
 * to)，并按返回类型处理结果。
 */
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：path（PathArg）：指定要读取、写入或匹配的文件位置；
 * 必须满足声明的类型及调用时序要求。；返回值：Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 典型用法：在完成前置校验后调用 匿名回调(path)，并按返回类型处理结果。
 */
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：path（PathArg）：指定要读取、写入或匹配的文件位置；
 * 必须满足声明的类型及调用时序要求。；参数：mode（number | string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(path,
 * mode)，并按返回类型处理结果。
 */
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：from（PathArg）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。；参数：to（PathArg）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(from,
 * to)，并按返回类型处理结果。
 */
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：from（PathArg）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。；参数：to（PathArg）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(from,
 * to)，并按返回类型处理结果。
 */
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：path（PathArg）：指定要读取、写入或匹配的文件位置；
 * 必须满足声明的类型及调用时序要求。；参数：flags（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数：mode（number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：Promise<FileHandle>；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(path, flags, mode)，
 * 并按返回类型处理结果。
 */
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：path（PathArg）：指定要读取、写入或匹配的文件位置；
 * 必须满足声明的类型及调用时序要求。；返回值：Promise<Dir>；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 典型用法：在完成前置校验后调用 匿名回调(path)，并按返回类型处理结果。
 */
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：path（PathArg）：指定要读取、写入或匹配的文件位置；
 * 必须满足声明的类型及调用时序要求。；参数：length（由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。；返回值：Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 典型用法：在完成前置校验后调用 匿名回调(path, length)，并按返回类型处理结果。
 */
export const promises = {
  readFile: async (path: PathArg, options?: EncodingOption): Promise<Buffer | string> => readFileSync(path, options),
  writeFile: async (
    path: PathArg,
    data: string | Uint8Array,
    options?: { flag?: string; mode?: number } | BufferEncoding | null,
  ): Promise<void> => {
    /**
     * 常量说明：flag 用于处理 flag 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const flag = typeof options === 'object' && options !== null ? options.flag : undefined
    /**
     * 常量说明：mode 用于处理 mode 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const mode = typeof options === 'object' && options !== null ? options.mode : undefined
    if (flag !== undefined && flag.includes('x') && existsSync(path)) {
      /**
       * 常量说明：error 用于处理 error 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const error = new Error(`EEXIST: file already exists, open '${asPath(path)}'`) as Error & { code: string }
      error.code = 'EEXIST'
      throw error
    }
    if (flag !== undefined && flag.startsWith('a')) appendFileSync(path, data)
    else writeFileSync(path, data, { ...flag === undefined ? {} : { flag }, ...mode === undefined ? {} : { mode } })
  },
  appendFile: async (path: PathArg, data: string | Uint8Array): Promise<void> => { appendFileSync(path, data) },
  mkdir: async (path: PathArg, options?: { recursive?: boolean; mode?: number }): Promise<string | undefined> => mkdirSync(path, options),
  mkdtemp: async (prefix: string): Promise<string> => mkdtempSync(prefix),
  readdir: async (
    path: PathArg,
    options?: { withFileTypes?: boolean } | BufferEncoding,
  ): Promise<string[] | Dirent[]> => readdirSync(path, options),
  stat: async (path: PathArg, options?: VfsStatOptions): Promise<VfsStats | VfsBigIntStats> => statSync(path, options),
  lstat: async (path: PathArg, options?: VfsStatOptions): Promise<VfsStats | VfsBigIntStats> => lstatSync(path, options),
  realpath: async (path: PathArg): Promise<string> => realpathSync(path),
  rm: async (path: PathArg, options?: { recursive?: boolean; force?: boolean }): Promise<void> => { rmSync(path, options) },
  unlink: async (path: PathArg): Promise<void> => { unlinkSync(path) },
  rename: async (from: PathArg, to: PathArg): Promise<void> => { renameSync(from, to) },
  access: async (path: PathArg): Promise<void> => { accessSync(path) },
  chmod: async (path: PathArg, mode: number | string): Promise<void> => { chmodSync(path, mode) },
  cp: async (from: PathArg, to: PathArg): Promise<void> => {
    /**
     * 常量说明：source 用于处理 source 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const source = asPath(from)
    /**
     * 常量说明：target 用于处理 target 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const target = asPath(to)
    if (statSync(source).isDirectory()) {
      mkdirSync(target, { recursive: true })
      /**
       * 变量说明：name 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
       */
      for (const name of vfs().readdirSync(source)) await promises.cp(`${source}/${name}`, `${target}/${name}`)
      return
    }
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, bytesOf(source))
  },
  // The VFS keeps both names attached to one file identity until either name is removed.
  link: async (from: PathArg, to: PathArg): Promise<void> => { linkSync(from, to) },
  open: async (path: PathArg, flags?: string, mode?: number): Promise<FileHandle> => openHandleSync(path, flags, mode),
  opendir: async (path: PathArg): Promise<Dir> => opendirSync(path),
  truncate: async (path: PathArg, length = 0): Promise<void> => {
    vfs().truncateSync(asPath(path), length)
  },
  watch: watchAsync,
  constants,
} satisfies Partial<Record<keyof typeof import('node:fs/promises'), unknown>>

/** CommonJS interop marker: the worker loader hands `default` to default imports (see ./builtins.ts).
 * @remarks 中文说明：常量说明：__esModule 用于处理 __esModule 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
export const __esModule = true

/**
 * Members Node declares as encoding- and option-dependent overload ladders
 * (`readFileSync` answering `Buffer` XOR `string`, `statSync` answering `Stats`
 * XOR `BigIntStats`, `mkdirSync` answering `string` XOR `void`). This module
 * answers the union its VFS actually produces from one signature, which no single
 * signature can present as all of Node's overloads; `realpathSync` additionally
 * carries Node's `.native` member, and `constants`, `promises`, and `Dirent` hold
 * the subsets the host tree reads.
 */
type OwnSignature =
  | 'constants' | 'promises' | 'Dirent' | 'FSWatcher' | 'StatWatcher' | 'ReadStream' | 'WriteStream'
  | 'readFileSync' | 'writeFileSync' | 'appendFileSync' | 'statSync' | 'lstatSync' | 'realpathSync'
  | 'readdirSync' | 'mkdirSync' | 'mkdtempSync' | 'rmSync' | 'opendirSync'
  | 'openSync' | 'readSync' | 'writeSync' | 'stat' | 'lstat' | 'watch' | 'watchFile' | 'unwatchFile'
  | 'createReadStream' | 'createWriteStream'

/**
 * The `node:fs` declarations this module stands in for. Every other member is
 * checked against Node; `openHandleSync` is the worker's own handle opener, which
 * `promises.open` answers with and Node has no synchronous counterpart for.
 */
type NodeFace = Partial<Omit<typeof import('node:fs'), OwnSignature>>
  & Record<OwnSignature | 'openHandleSync', unknown>

/** CommonJS default export: the members `require()` hands a caller of this module. */
export default {
  constants, promises, Dirent, FSWatcher, StatWatcher, ReadStream, WriteStream,
  readFileSync, writeFileSync, appendFileSync, existsSync, statSync, stat, lstatSync, lstat, realpathSync, chmodSync,
  readdirSync, mkdirSync, mkdtempSync, rmSync, unlinkSync, renameSync, accessSync, opendirSync,
  openHandleSync, linkSync,
  openSync, readSync, writeSync, closeSync, watch, watchFile, unwatchFile,
  createReadStream, createWriteStream,
} satisfies NodeFace
