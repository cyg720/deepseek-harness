/**
 * In-memory filesystem behind the worker's `node:fs` proxy. Contents come from
 * the build-time image (see {@link loadVfsImage}); this remains the synchronous
 * authority when an asynchronous durable sink mirrors selected subtrees.
 * @module @deepseek-ai/dsh-experimental-webworker-runtime/src/storage/memory
 * @remarks 文件说明：文件职责：实现 experimental/webworker-runtime 中 memory 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/webworker-runtime 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 →
 * 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。
 */
import { dirname, join, normalize, resolve, SEP } from '../module-system/posix-path.ts'
import { IMAGE_OVERLAY_DIRECTORIES } from '../image-layout.ts'
import { parseTar } from './tar.ts'
import type {
  Vfs, VfsBigIntStats, VfsDir, VfsDirent, VfsEncoding, VfsError, VfsFileHandle, VfsMutation, VfsOpenFile,
  VfsMutationListener, VfsMutationSink, VfsReadOptions, VfsSeedOptions, VfsStatOptions, VfsStats, VfsWriteOptions,
} from './types.ts'

/**
 * 常量说明：decoder 用于处理 decoder 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const decoder = new TextDecoder()
/**
 * 常量说明：encoder 用于处理 encoder 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const encoder = new TextEncoder()

interface FileNode {
  bytes: Uint8Array
  mtimeMs: number
  /** Permission bits (`0o777` mask), set at creation and changed only by `chmod`. */
  mode: number
  /** Stable identity shared by hard links and retained by open descriptors. */
  identity?: bigint
  /** One path normally, a Set only for hard links, or undefined after the final unlink. */
  paths: string | Set<string> | undefined
}

/** Creation default for files, Node's `0o666` under the classic `022` umask.
 * @remarks 中文说明：常量说明：DEFAULT_FILE_MODE 用于处理 DEFAULT_FILE_MODE 相关数据，
 * 作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
const DEFAULT_FILE_MODE = 0o644

/** Creation default for directories, Node's `0o777` under the classic `022` umask.
 * @remarks 中文说明：常量说明：DEFAULT_DIRECTORY_MODE 用于处理 DEFAULT_DIRECTORY_MODE
 * 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
const DEFAULT_DIRECTORY_MODE = 0o755

/**
 * 功能说明：处理 fail 相关流程；使用场景由所在模块及调用位置决定。
 * @param code （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param syscall （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param path （string）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。
 * @param detail （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns never；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 fail(code, syscall, path, detail)，并按返回类型处理结果。
 */
function fail(code: string, syscall: string, path: string, detail?: string): never {
  /**
   * 常量说明：error 用于处理 error 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const error = new Error(`${code}: ${detail ?? syscall} failed, ${syscall} '${path}'`) as VfsError
  error.code = code
  error.path = path
  error.syscall = syscall
  throw error
}

/**
 * 功能说明：处理 encodingOf 相关流程；使用场景由所在模块及调用位置决定。
 * @param options （VfsReadOptions）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。
 * @returns VfsEncoding | undefined；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 encodingOf(options)，并按返回类型处理结果。
 */
function encodingOf(options: VfsReadOptions): VfsEncoding | undefined {
  if (options === null || options === undefined) return undefined
  if (typeof options === 'string') return options
  return options.encoding ?? undefined
}

// Permission bits are entry state: creation takes the caller's mode (or the
// umask-free default), `chmod` changes it, and both stat shapes report the
// stored value — the round-trip consumers like dsh-credentials-local's
// owner-only check rely on. The bits are never enforced: a single-owner
// filesystem reads and writes as its owner regardless, like root.
/**
 * 功能说明：处理 statsOf 相关流程；使用场景由所在模块及调用位置决定。
 * @param size （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param mtimeMs （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param directory （boolean）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param ino （bigint）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param mode （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns VfsStats；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 statsOf(size, mtimeMs, directory, ino, mode)，
 * 并按返回类型处理结果。
 */
function statsOf(size: number, mtimeMs: number, directory: boolean, ino: bigint, mode: number): VfsStats {
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
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  return {
    size,
    ino: Number(ino),
    mtimeMs,
    ctimeMs: mtimeMs,
    atimeMs: mtimeMs,
    birthtimeMs: mtimeMs,
    mtime: new Date(mtimeMs),
    mode: (directory ? 0o040000 : 0o100000) | (mode & 0o777),
    isFile: () => !directory,
    isDirectory: () => directory,
    isSymbolicLink: () => false,
    isFIFO: () => false,
    isSocket: () => false,
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
  }
}

/**
 * The same entry as {@link statsOf}, in the BigInt shape.
 *
 * Timestamps carry millisecond resolution scaled to nanoseconds, which is what
 * the underlying `mtimeMs` holds; the VFS keeps that value strictly increasing
 * per entry so two writes inside one millisecond still differ.
 * @param size - Byte length; zero for a directory.
 * @param mtimeMs - Modification time the entry carries.
 * @param directory - Whether the entry is a directory.
 * @param ino - Identity of the entry at this path.
 * @param mode - Stored permission bits of the entry.
 * @returns Stats in the shape Node returns under `{ bigint: true }`.
 * @remarks 中文说明：功能说明：处理 bigIntStatsOf 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：size（number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：mtimeMs（number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：directory（boolean）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：ino（bigint）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：mode（number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数说明：nlink（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：VfsBigIntStats；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 bigIntStatsOf(size,
 * mtimeMs, directory, ino, mode, nlink)，并按返回类型处理结果。
 */
function bigIntStatsOf(
  size: number,
  mtimeMs: number,
  directory: boolean,
  ino: bigint,
  mode: number,
  nlink = 1,
): VfsBigIntStats {
  /**
   * 常量说明：milliseconds 用于处理 milliseconds 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const milliseconds = BigInt(Math.trunc(mtimeMs))
  /**
   * 常量说明：nanoseconds 用于处理 nanoseconds 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const nanoseconds = milliseconds * 1_000_000n
  /**
   * 常量说明：time 用于处理 time 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const time = new Date(mtimeMs)
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
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  return {
    size: BigInt(size),
    mode: BigInt((directory ? 0o040000 : 0o100000) | (mode & 0o777)),
    dev: 1n,
    ino,
    nlink: BigInt(nlink),
    mtimeMs: milliseconds,
    mtimeNs: nanoseconds,
    ctimeMs: milliseconds,
    ctimeNs: nanoseconds,
    atimeMs: milliseconds,
    atimeNs: nanoseconds,
    birthtimeMs: milliseconds,
    birthtimeNs: nanoseconds,
    mtime: time,
    ctime: time,
    atime: time,
    birthtime: time,
    isFile: () => !directory,
    isDirectory: () => directory,
    isSymbolicLink: () => false,
    isFIFO: () => false,
    isSocket: () => false,
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
  }
}

interface OpenMode {
  readonly readable: boolean
  readonly writable: boolean
  readonly append: boolean
  readonly create: boolean
  readonly truncate: boolean
  readonly exclusive: boolean
}

/** Parse the Node string flags supported by the compatibility filesystem.
 * @remarks 中文说明：功能说明：打开 Mode 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：flags（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：OpenMode；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 openMode(flags)，
 * 并按返回类型处理结果。 */
function openMode(flags: string): OpenMode {
  /**
   * 常量说明：base 用于处理 base 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const base = flags[0]
  /**
   * 常量说明：suffix 用于处理 suffix 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const suffix = flags.slice(1).split('')
  /**
   * 常量说明：validSuffix 用于处理 validSuffix 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：flag（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(flag)，并按返回类型处理结果。
   */
  const validSuffix = suffix.every(flag => flag === '+' || flag === 'x' || flag === 's')
  /**
   * 常量说明：uniqueSuffix 用于处理 uniqueSuffix 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const uniqueSuffix = new Set(suffix).size === suffix.length
  if ((base !== 'r' && base !== 'w' && base !== 'a') || !validSuffix || !uniqueSuffix
    || base === 'r' && flags.includes('x')) {
    /**
     * 常量说明：error 用于处理 error 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const error = new TypeError(`The argument 'flags' is invalid. Received '${flags}'`) as TypeError & { code: string }
    error.code = 'ERR_INVALID_ARG_VALUE'
    throw error
  }
  return {
    readable: base === 'r' || flags.includes('+'),
    writable: base !== 'r' || flags.includes('+'),
    append: base === 'a',
    create: base === 'w' || base === 'a',
    truncate: base === 'w',
    exclusive: flags.includes('x'),
  }
}

/** Resize bytes exactly, preserving the prefix and zero-filling growth.
 * @remarks 中文说明：功能说明：处理 resize 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：bytes（Uint8Array）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：length（number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：Uint8Array；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 resize(bytes, length)，
 * 并按返回类型处理结果。 */
function resize(bytes: Uint8Array, length: number): Uint8Array {
  if (!Number.isSafeInteger(length) || length < 0) {
    /**
     * 常量说明：error 用于处理 error 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const error = new RangeError(`The value of "len" is out of range. It must be >= 0. Received ${String(length)}`) as RangeError & { code: string }
    error.code = 'ERR_OUT_OF_RANGE'
    throw error
  }
  /**
   * 常量说明：resized 用于处理 resized 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const resized = new Uint8Array(length)
  resized.set(bytes.subarray(0, length))
  return resized
}

/** Construction inputs for {@link MemoryVfs}. */
export interface MemoryVfsOptions {
  /** Durable write-behind observer; absent leaves the filesystem ephemeral. */
  readonly sink?: VfsMutationSink
}

/**
 * Filesystem held in two maps: one for file bytes, one for directories.
 * Every path is normalized to an absolute POSIX path without a trailing
 * separator, so callers may pass either form.
 * @remarks 中文说明：类说明：MemoryVfs 用于集中封装 处理 MemoryVfs 相关状态与行为。；核心功能：通过成员字段保存状态，
 * 并由公开方法提供受类型约束的操作入口。；使用场景：由 experimental/webworker-runtime
 * 在对应插件或业务生命周期内创建和调用。
 */
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：path（string）：指定要读取、写入或匹配的文件位置；
 * 必须满足声明的类型及调用时序要求。；参数：options（VfsReadOptions）：提供本次操作使用的配置选项；
 * 必须满足声明的类型及调用时序要求。；返回值：Promise<string | Uint8Array>；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(path, options)，并按返回类型处理结果。
 */
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：path（string）：指定要读取、写入或匹配的文件位置；
 * 必须满足声明的类型及调用时序要求。；参数：data（string | Uint8Array）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。；参数：options（VfsWriteOptions）：提供本次操作使用的配置选项；
 * 必须满足声明的类型及调用时序要求。；返回值：Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 典型用法：在完成前置校验后调用 匿名回调(path, data, options)，并按返回类型处理结果。
 */
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：path（string）：指定要读取、写入或匹配的文件位置；
 * 必须满足声明的类型及调用时序要求。；参数：data（string | Uint8Array）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。；返回值：Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 典型用法：在完成前置校验后调用 匿名回调(path, data)，并按返回类型处理结果。
 */
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：path（string）：指定要读取、写入或匹配的文件位置；
 * 必须满足声明的类型及调用时序要求。；参数：options（{ recursive?: boolean; mode?: number
 * }）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。；返回值：Promise<string | undefined>；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(path, options)，并按返回类型处理结果。
 */
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：path（string）：指定要读取、写入或匹配的文件位置；
 * 必须满足声明的类型及调用时序要求。；参数：options（{ withFileTypes?: boolean }）：提供本次操作使用的配置选项；
 * 必须满足声明的类型及调用时序要求。；返回值：Promise<string[] & VfsDirent[]>；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(path, options)，并按返回类型处理结果。
 */
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：path（string）：指定要读取、写入或匹配的文件位置；
 * 必须满足声明的类型及调用时序要求。；参数：options（VfsStatOptions）：提供本次操作使用的配置选项；
 * 必须满足声明的类型及调用时序要求。；返回值：Promise<VfsStats | VfsBigIntStats>；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(path, options)，并按返回类型处理结果。
 */
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：path（string）：指定要读取、写入或匹配的文件位置；
 * 必须满足声明的类型及调用时序要求。；参数：options（VfsStatOptions）：提供本次操作使用的配置选项；
 * 必须满足声明的类型及调用时序要求。；返回值：Promise<VfsStats | VfsBigIntStats>；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(path, options)，并按返回类型处理结果。
 */
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：path（string）：指定要读取、写入或匹配的文件位置；
 * 必须满足声明的类型及调用时序要求。；返回值：Promise<string>；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 典型用法：在完成前置校验后调用 匿名回调(path)，并按返回类型处理结果。
 */
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：from（string）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。；参数：to（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(from,
 * to)，并按返回类型处理结果。
 */
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：path（string）：指定要读取、写入或匹配的文件位置；
 * 必须满足声明的类型及调用时序要求。；返回值：Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 典型用法：在完成前置校验后调用 匿名回调(path)，并按返回类型处理结果。
 */
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：path（string）：指定要读取、写入或匹配的文件位置；
 * 必须满足声明的类型及调用时序要求。；参数：options（{ recursive?: boolean; force?: boolean
 * }）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。；返回值：Promise<void>；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(path, options)，并按返回类型处理结果。
 */
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：prefix（string）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。；返回值：Promise<string>；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 典型用法：在完成前置校验后调用 匿名回调(prefix)，并按返回类型处理结果。
 */
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：existing（string）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。；参数：next（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用
 * 匿名回调(existing, next)，并按返回类型处理结果。
 */
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：path（string）：指定要读取、写入或匹配的文件位置；
 * 必须满足声明的类型及调用时序要求。；参数：length（number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(path,
 * length)，并按返回类型处理结果。
 */
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：path（string）：指定要读取、写入或匹配的文件位置；
 * 必须满足声明的类型及调用时序要求。；参数：mode（number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(path,
 * mode)，并按返回类型处理结果。
 */
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：path（string）：指定要读取、写入或匹配的文件位置；
 * 必须满足声明的类型及调用时序要求。；返回值：Promise<VfsDir>；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 典型用法：在完成前置校验后调用 匿名回调(path)，并按返回类型处理结果。
 */
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：path（string）：指定要读取、写入或匹配的文件位置；
 * 必须满足声明的类型及调用时序要求。；参数：flags（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数：mode（number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：Promise<VfsFileHandle>；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(path, flags, mode)，
 * 并按返回类型处理结果。
 */
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：path（string）：指定要读取、写入或匹配的文件位置；
 * 必须满足声明的类型及调用时序要求。；返回值：Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 典型用法：在完成前置校验后调用 匿名回调(path)，并按返回类型处理结果。
 */
export class MemoryVfs implements Vfs {
  /**
   * 常量说明：files 用于处理 files 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly files = new Map<string, FileNode>()
  /**
   * 常量说明：directories 用于处理 directories 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly directories = new Set<string>([SEP])
  /** Directory permission bits; absence means {@link DEFAULT_DIRECTORY_MODE}.
   * @remarks 中文说明：常量说明：directoryModes 用于处理 directoryModes 相关数据，作用于成员；
   * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
  private readonly directoryModes = new Map<string, number>()
  /** Directory mtimes advance when their immediate entry set changes.
   * @remarks 中文说明：常量说明：directoryMtimes 用于处理 directoryMtimes 相关数据，作用于成员；
   * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
  private readonly directoryMtimes = new Map<string, number>()
  /**
   * 常量说明：mutationListeners 用于处理 mutationListeners 相关数据，作用于成员；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  private readonly mutationListeners = new Set<VfsMutationListener>()
  /**
   * 常量说明：sink 用于处理 sink 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly sink: VfsMutationSink | undefined
  /**
   * 变量说明：temporaries 用于处理 temporaries 相关数据，作用于成员；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  private temporaries = 0
  // Directories retain path identities. File identities live on FileNode so
  // descriptors, renames, and hard links continue to address the same file.
  /**
   * 常量说明：identities 用于处理 identities 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly identities = new Map<string, bigint>()
  /**
   * 变量说明：lastIdentity 用于处理 lastIdentity 相关数据，作用于成员；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  private lastIdentity = 0n

  /**
   * Build the synchronous filesystem authority.
   * @param options - Optional durable write-behind sink.
   * @remarks 中文说明：功能说明：处理 MemoryVfs 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：options（MemoryVfsOptions）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。；返回值：当前类实例；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：通过 new MemoryVfs(options) 创建实例，
   * 并在所属生命周期内使用。
   */
  constructor(options: MemoryVfsOptions = {}) {
    this.sink = options.sink
  }

  /**
   * Settle the durable sink without changing in-memory success.
   * @returns A promise that resolves when all recorded mutations are stored.
   * @remarks 中文说明：功能说明：处理 flush 相关流程；使用场景由所在模块及调用位置决定。；返回值：Promise<void>；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 flush()，并按返回类型处理结果。
   */
  async flush(): Promise<void> {
    await this.sink?.flush()
  }

  /**
   * Observe committed runtime mutations. Image seeding is deliberately silent.
   * @param listener - Consumer called after each successful mutation.
   * @returns A disposer that prevents future calls.
   * @remarks 中文说明：功能说明：处理 subscribe 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：listener（VfsMutationListener）：接收后续状态或事件并执行调用方逻辑；必须满足声明的类型及调用时序要求。；
   * 返回值：() => void；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * subscribe(listener)，并按返回类型处理结果。
   */
  subscribe(listener: VfsMutationListener): () => void {
    this.mutationListeners.add(listener)
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    return () => { this.mutationListeners.delete(listener) }
  }

  /** Publish after state changes; one faulty observer cannot roll back a write.
   * @remarks 中文说明：功能说明：处理 publish 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：mutation（VfsMutation）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 publish(mutation)，
   * 并按返回类型处理结果。 */
  private publish(mutation: VfsMutation): void {
    /**
     * 常量说明：observers 用于处理 observers 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：change（VfsMutation）：提供本次调用所需的数据；
     * 必须满足声明的类型及调用时序要求。；返回值：void；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用
     * 匿名回调(change)，并按返回类型处理结果。
     */
    const observers: VfsMutationListener[] = [
      ...(this.sink === undefined ? [] : [(change: VfsMutation): void => { this.sink?.record(change) }]),
      ...this.mutationListeners,
    ]
    /**
     * 变量说明：listener 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const listener of observers) {
      /**
       * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
       */
      try {
        listener(mutation)
      } catch (error) {
        console.error('webworker vfs: mutation observer failed', error)
      }
    }
  }

  /** Promise face mirroring `node:fs/promises` for the methods the roster uses.
   * @remarks 中文说明：常量说明：promises 用于处理 promises 相关数据，作用于成员；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。 */
  readonly promises = {
    readFile: async (path: string, options?: VfsReadOptions): Promise<string | Uint8Array> => this.readFileSync(path, options),
    writeFile: async (path: string, data: string | Uint8Array, options?: VfsWriteOptions): Promise<void> => {
      this.writeFileSync(path, data, options)
    },
    appendFile: async (path: string, data: string | Uint8Array): Promise<void> => { this.appendFileSync(path, data) },
    mkdir: async (path: string, options?: { recursive?: boolean; mode?: number }): Promise<string | undefined> =>
      this.mkdirSync(path, options),
    readdir: async (path: string, options?: { withFileTypes?: boolean }): Promise<string[] & VfsDirent[]> =>
      this.readdirSync(path, options),
    stat: async (path: string, options?: VfsStatOptions): Promise<VfsStats | VfsBigIntStats> => this.statSync(path, options),
    lstat: async (path: string, options?: VfsStatOptions): Promise<VfsStats | VfsBigIntStats> => this.statSync(path, options),
    realpath: async (path: string): Promise<string> => this.realpathSync(path),
    rename: async (from: string, to: string): Promise<void> => { this.renameSync(from, to) },
    unlink: async (path: string): Promise<void> => { this.unlinkSync(path) },
    rm: async (path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void> => { this.rmSync(path, options) },
    mkdtemp: async (prefix: string): Promise<string> => this.mkdtempSync(prefix),
    link: async (existing: string, next: string): Promise<void> => { this.linkSync(existing, next) },
    truncate: async (path: string, length?: number): Promise<void> => { this.truncateSync(path, length) },
    chmod: async (path: string, mode: number): Promise<void> => { this.chmodSync(path, mode) },
    opendir: async (path: string): Promise<VfsDir> => this.opendir(path),
    open: async (path: string, flags?: string, mode?: number): Promise<VfsFileHandle> => this.open(path, flags, mode),
    /** Resolves for any existing path: the VFS grants read and write to everything it holds. */
    access: async (path: string): Promise<void> => {
      /**
       * 常量说明：target 用于处理 target 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const target = normalize(resolve(path))
      if (!this.files.has(target) && !this.directories.has(target)) fail('ENOENT', 'access', target)
    },
  }

  /** @returns Absolute path with no trailing separator.
   * @remarks 中文说明：功能说明：处理 key 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：path（string）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；返回值：string；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 key(path)，并按返回类型处理结果。 */
  private key(path: string): string {
    /**
     * 常量说明：absolute 用于处理 absolute 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const absolute = normalize(resolve(path))
    return absolute.length > 1 && absolute.endsWith(SEP) ? absolute.slice(0, -1) : absolute
  }

  /**
   * Read a file.
   * @param path - File path.
   * @param options - `'utf8'` or `{encoding}` for text; omitted for bytes.
   * @returns Text or a copy-free view of the stored bytes.
   * @remarks 中文说明：功能说明：读取 File Sync 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：path（string）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；
   * 参数说明：options（VfsReadOptions）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。；返回值：string
   * | Uint8Array；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * readFileSync(path, options)，并按返回类型处理结果。
   */
  readFileSync(path: string, options?: VfsReadOptions): string | Uint8Array {
    /**
     * 常量说明：target 用于处理 target 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const target = this.key(path)
    /**
     * 常量说明：node 用于处理 node 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const node = this.files.get(target)
    if (node === undefined) {
      if (this.directories.has(target)) fail('EISDIR', 'read', target)
      fail('ENOENT', 'open', target)
    }
    return encodingOf(options) === undefined ? node.bytes : decoder.decode(node.bytes)
  }

  /**
   * Report whether a path exists.
   * @param path - Path to test.
   * @returns True for files and directories.
   * @remarks 中文说明：功能说明：处理 existsSync 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：path（string）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；返回值：boolean；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 existsSync(path)，
   * 并按返回类型处理结果。
   */
  existsSync(path: string): boolean {
    /**
     * 常量说明：target 用于处理 target 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const target = this.key(path)
    return this.files.has(target) || this.directories.has(target)
  }

  /**
   * Stat a path.
   * @param path - Path to stat.
   * @param options - `bigint` selects the BigInt stats Node returns for it.
   * @returns Stats for the file or directory.
   * @remarks 中文说明：功能说明：处理 statSync 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：path（string）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；
   * 参数说明：options（VfsStatOptions）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。；
   * 返回值：VfsStats | VfsBigIntStats；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 使用示例：典型用法：在完成前置校验后调用 statSync(path, options)，并按返回类型处理结果。
   */
  statSync(path: string, options?: VfsStatOptions): VfsStats | VfsBigIntStats {
    /**
     * 常量说明：target 用于处理 target 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const target = this.key(path)
    /**
     * 常量说明：node 用于处理 node 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const node = this.files.get(target)
    /**
     * 常量说明：size、mtimeMs、directory、mode 用于处理 size、mtimeMs、directory、mode 相关数据，
     * 作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const [size, mtimeMs, directory, mode] = node !== undefined
      ? [node.bytes.length, node.mtimeMs, false, node.mode] as const
      : this.directories.has(target)
        ? [0, this.directoryMtimes.get(target) ?? 0, true, this.directoryModes.get(target) ?? DEFAULT_DIRECTORY_MODE] as const
        : fail('ENOENT', 'stat', target)
    /**
     * 常量说明：identity 用于处理 identity 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const identity = node === undefined ? this.identityOf(target) : this.identityOfFile(node)
    return options?.bigint === true
      ? bigIntStatsOf(size, mtimeMs, directory, identity, mode, node === undefined ? 1 : this.fileLinkCount(node))
      : statsOf(size, mtimeMs, directory, identity, mode)
  }

  /** @returns Stats in the plain shape, for internal callers that read `size`/`mtimeMs`.
   * @remarks 中文说明：功能说明：处理 plainStats 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：path（string）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；返回值：VfsStats；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 plainStats(path)，
   * 并按返回类型处理结果。 */
  private plainStats(path: string): VfsStats {
    return this.statSync(path) as VfsStats
  }

  /** @returns The stable identity of an existing path, assigning one on first observation.
   * @remarks 中文说明：功能说明：处理 identityOf 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：target（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：bigint；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 identityOf(target)，并按返回类型处理结果。 */
  private identityOf(target: string): bigint {
    /**
     * 常量说明：existing 用于处理 existing 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const existing = this.identities.get(target)
    if (existing !== undefined) return existing
    this.lastIdentity += 1n
    this.identities.set(target, this.lastIdentity)
    return this.lastIdentity
  }

  /** @returns The inode-like identity retained by a file node across names.
   * @remarks 中文说明：功能说明：处理 identityOfFile 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：node（FileNode）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：bigint；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 identityOfFile(node)，并按返回类型处理结果。 */
  private identityOfFile(node: FileNode): bigint {
    if (node.identity !== undefined) return node.identity
    this.lastIdentity += 1n
    node.identity = this.lastIdentity
    return node.identity
  }

  /** @returns The number of names currently linked to one file node.
   * @remarks 中文说明：功能说明：处理 fileLinkCount 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：node（FileNode）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：number；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 fileLinkCount(node)，并按返回类型处理结果。 */
  private fileLinkCount(node: FileNode): number {
    return typeof node.paths === 'string' ? 1 : node.paths?.size ?? 0
  }

  /** Add one map name, promoting the rare hard-link case to a Set.
   * @remarks 中文说明：功能说明：处理 addFilePath 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：node（FileNode）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：path（string）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；返回值：void；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 addFilePath(node, path)，
   * 并按返回类型处理结果。 */
  private addFilePath(node: FileNode, path: string): void {
    if (node.paths === undefined) {
      node.paths = path
    } else if (typeof node.paths === 'string') {
      node.paths = new Set([node.paths, path])
    } else {
      node.paths.add(path)
    }
  }

  /** Remove one map name, collapsing a remaining single link back to a string.
   * @remarks 中文说明：功能说明：移除 File Path 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：node（FileNode）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：path（string）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；返回值：void；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 removeFilePath(node,
   * path)，并按返回类型处理结果。 */
  private removeFilePath(node: FileNode, path: string): void {
    if (typeof node.paths === 'string') {
      node.paths = undefined
      return
    }
    if (node.paths === undefined) return
    node.paths.delete(path)
    if (node.paths.size === 1) {
      /**
       * 常量说明：remaining 用于处理 remaining 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const [remaining] = node.paths
      node.paths = remaining
    }
  }

  /** Set one file-map entry while maintaining both nodes' reverse path indexes.
   * @remarks 中文说明：功能说明：设置 File 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：path（string）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；
   * 参数说明：node（FileNode）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 setFile(path, node)，并按返回类型处理结果。 */
  private setFile(path: string, node: FileNode): void {
    /**
     * 常量说明：previous 用于处理 previous 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const previous = this.files.get(path)
    if (previous === node) return
    if (previous !== undefined) this.removeFilePath(previous, path)
    this.files.set(path, node)
    this.addFilePath(node, path)
  }

  /** Delete one file-map entry while retaining an unlinked node held by a descriptor.
   * @remarks 中文说明：功能说明：删除 File 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：path（string）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；返回值：FileNode |
   * undefined；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * deleteFile(path)，并按返回类型处理结果。 */
  private deleteFile(path: string): FileNode | undefined {
    /**
     * 常量说明：node 用于处理 node 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const node = this.files.get(path)
    if (node === undefined) return undefined
    this.files.delete(path)
    this.removeFilePath(node, path)
    return node
  }

  /** Publish one linked name after a content or metadata write.
   * @remarks 中文说明：功能说明：处理 publishFilePath 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：node（FileNode）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：path（string）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；
   * 参数说明：appendedFrom（number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 publishFilePath(node,
   * path, appendedFrom)，并按返回类型处理结果。 */
  private publishFilePath(node: FileNode, path: string, appendedFrom?: number): void {
    this.publish({
      kind: 'write', path, bytes: node.bytes, mode: node.mode, entryChanged: false,
      ...appendedFrom === undefined ? {} : { appendedFrom },
    })
  }

  /** Publish a content or metadata write for every hard link to one node.
   * @remarks 中文说明：功能说明：处理 publishFile 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：node（FileNode）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：appendedFrom（number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 publishFile(node,
   * appendedFrom)，并按返回类型处理结果。 */
  private publishFile(node: FileNode, appendedFrom?: number): void {
    if (typeof node.paths === 'string') {
      this.publishFilePath(node, node.paths, appendedFrom)
      return
    }
    if (node.paths === undefined) return
    /**
     * 变量说明：path 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const path of node.paths) this.publishFilePath(node, path, appendedFrom)
  }

  /** Replace bytes on one file identity and notify all linked paths.
   * @remarks 中文说明：功能说明：处理 replaceFile 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：node（FileNode）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：bytes（Uint8Array）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：appendedFrom（number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 replaceFile(node, bytes,
   * appendedFrom)，并按返回类型处理结果。 */
  private replaceFile(node: FileNode, bytes: Uint8Array, appendedFrom?: number): void {
    node.bytes = bytes
    node.mtimeMs = this.touchNode(node)
    this.publishFile(node, appendedFrom)
  }

  /** Write at one offset, zero-filling any gap.
   * @remarks 中文说明：功能说明：写入 File Node 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：node（FileNode）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：position（number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：data（Uint8Array）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：number；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 writeFileNode(node,
   * position, data)，并按返回类型处理结果。 */
  private writeFileNode(node: FileNode, position: number, data: Uint8Array): number {
    /**
     * 常量说明：offset 用于处理 offset 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const offset = Math.max(0, position)
    /**
     * 常量说明：previousLength 用于处理 previousLength 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const previousLength = node.bytes.length
    /**
     * 常量说明：bytes 用于处理 bytes 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const bytes = new Uint8Array(Math.max(previousLength, offset + data.length))
    bytes.set(node.bytes)
    bytes.set(data, offset)
    this.replaceFile(node, bytes, offset === previousLength ? previousLength : undefined)
    return data.length
  }

  /** Resize one file identity and notify all linked paths.
   * @remarks 中文说明：功能说明：处理 truncateFile 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：node（FileNode）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：length（number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 truncateFile(node, length)，并按返回类型处理结果。 */
  private truncateFile(node: FileNode, length: number): void {
    this.replaceFile(node, resize(node.bytes, length))
  }

  /** @returns Plain stats for an open file, including after its last name is removed.
   * @remarks 中文说明：功能说明：处理 fileStats 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：node（FileNode）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：VfsStats；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 fileStats(node)，
   * 并按返回类型处理结果。 */
  private fileStats(node: FileNode): VfsStats {
    return statsOf(node.bytes.length, node.mtimeMs, false, this.identityOfFile(node), node.mode)
  }

  /** Forget removed directory identities, so recreated paths report new ones.
   * @remarks 中文说明：功能说明：处理 forgetIdentity 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：target（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 forgetIdentity(target)，并按返回类型处理结果。 */
  private forgetIdentity(target: string): void {
    this.identities.delete(target)
    /**
     * 常量说明：prefix 用于处理 prefix 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const prefix = `${target}${SEP}`
    /**
     * 变量说明：known 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const known of [...this.identities.keys()]) {
      if (known.startsWith(prefix)) this.identities.delete(known)
    }
  }

  /**
   * Modification time for a write, strictly after the entry's previous one.
   *
   * The clock has millisecond resolution and these writes are in memory, so two
   * revisions of one file routinely land in the same millisecond. The filesystem
   * service's stale-write guard compares timestamps, so an equal one would let a
   * stale overwrite through.
   * @param target - Normalized path being written.
   * @returns Now, or one millisecond past the entry's current time.
   * @remarks 中文说明：功能说明：处理 touch 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：target（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：number；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 touch(target)，并按返回类型处理结果。
   */
  private touch(target: string): number {
    return this.touchNode(this.files.get(target))
  }

  /** @returns A modification time strictly newer than one file node's current value.
   * @remarks 中文说明：功能说明：处理 touchNode 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：node（FileNode）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：number；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 touchNode(node)，并按返回类型处理结果。 */
  private touchNode(node?: FileNode): number {
    /**
     * 常量说明：previous 用于处理 previous 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const previous = node?.mtimeMs
    /**
     * 常量说明：now 用于处理 now 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const now = Date.now()
    return previous === undefined ? now : Math.max(now, previous + 1)
  }

  /** Advance a directory's mtime after its immediate children change.
   * @remarks 中文说明：功能说明：处理 touchDirectory 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：target（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 touchDirectory(target)，并按返回类型处理结果。 */
  private touchDirectory(target: string): void {
    /**
     * 常量说明：previous 用于处理 previous 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const previous = this.directoryMtimes.get(target)
    /**
     * 常量说明：now 用于处理 now 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const now = Date.now()
    this.directoryMtimes.set(target, previous === undefined ? now : Math.max(now, previous + 1))
  }

  /**
   * List a directory.
   * @param path - Directory path.
   * @param options - `withFileTypes` returns {@link VfsDirent} objects instead of names.
   * @returns Immediate entry names, or directory entries.
   * @remarks 中文说明：功能说明：处理 readdirSync 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：path（string）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；参数说明：options（{
   * withFileTypes?: boolean }）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。；返回值：string[]
   * & VfsDirent[]；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * readdirSync(path, options)，并按返回类型处理结果。
   */
  readdirSync(path: string, options?: { withFileTypes?: boolean }): string[] & VfsDirent[] {
    /**
     * 常量说明：target 用于处理 target 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const target = this.key(path)
    if (!this.directories.has(target)) {
      if (this.files.has(target)) fail('ENOTDIR', 'scandir', target)
      fail('ENOENT', 'scandir', target)
    }
    /**
     * 常量说明：prefix 用于处理 prefix 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const prefix = target === SEP ? SEP : `${target}${SEP}`
    /**
     * 常量说明：names 用于处理 names 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const names = new Set<string>()
    /**
     * 变量说明：candidate 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const candidate of [...this.files.keys(), ...this.directories]) {
      if (!candidate.startsWith(prefix) || candidate === target) continue
      /**
       * 常量说明：rest 用于处理 rest 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const rest = candidate.slice(prefix.length)
      if (rest === '') continue
      /**
       * 常量说明：head 用于处理 head 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const [head = rest] = rest.split(SEP)
      names.add(head)
    }
    /**
     * 常量说明：sorted 用于处理 sorted 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const sorted = [...names].sort()
    if (options?.withFileTypes !== true) return sorted as string[] & VfsDirent[]
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：name（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(name)，并按返回类型处理结果。
     */
    return sorted.map(name => this.direntOf(target, name)) as string[] & VfsDirent[]
  }

  /** @returns Directory entry for one child of `directory`.
   * @remarks 中文说明：功能说明：处理 direntOf 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：directory（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：name（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：VfsDirent；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 direntOf(directory, name)，
   * 并按返回类型处理结果。 */
  private direntOf(directory: string, name: string): VfsDirent {
    /**
     * 常量说明：stats 用于处理 stats 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const stats = this.plainStats(join(directory, name))
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
      name,
      parentPath: directory,
      isFile: () => stats.isFile(),
      isDirectory: () => stats.isDirectory(),
      isSymbolicLink: () => false,
    }
  }

  /**
   * Resolve a path; the VFS has no symlinks, so this only normalizes.
   * @param path - Path to resolve.
   * @returns Absolute path.
   * @remarks 中文说明：功能说明：处理 realpathSync 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：path（string）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；返回值：string；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 realpathSync(path)，
   * 并按返回类型处理结果。
   */
  realpathSync(path: string): string {
    /**
     * 常量说明：target 用于处理 target 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const target = this.key(path)
    if (!this.existsSync(target)) fail('ENOENT', 'realpath', target)
    return target
  }

  /**
   * Create a directory.
   * @param path - Directory path.
   * @param options - `recursive` creates missing parents.
   * @returns First created path when recursive, otherwise undefined.
   * @remarks 中文说明：功能说明：处理 mkdirSync 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：path（string）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；参数说明：options（{
   * recursive?: boolean; mode?: number }）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。；
   * 返回值：string | undefined；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * mkdirSync(path, options)，并按返回类型处理结果。
   */
  mkdirSync(path: string, options?: { recursive?: boolean; mode?: number }): string | undefined {
    /**
     * 常量说明：target 用于处理 target 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const target = this.key(path)
    if (this.files.has(target)) fail('EEXIST', 'mkdir', target)
    if (this.directories.has(target)) {
      if (options?.recursive === true) return undefined
      fail('EEXIST', 'mkdir', target)
    }
    /**
     * 常量说明：parent 用于处理 parent 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const parent = dirname(target)
    if (!this.directories.has(parent)) {
      if (options?.recursive !== true) fail('ENOENT', 'mkdir', target)
      this.mkdirSync(parent, options)
    }
    this.directories.add(target)
    this.touchDirectory(target)
    this.touchDirectory(parent)
    /**
     * 常量说明：mode 用于处理 mode 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const mode = (options?.mode ?? DEFAULT_DIRECTORY_MODE) & 0o777
    if (mode !== DEFAULT_DIRECTORY_MODE) this.directoryModes.set(target, mode)
    this.publish({ kind: 'mkdir', path: target, mode })
    return target
  }

  /**
   * Write a file, replacing existing contents.
   * @param path - File path; its parent directory must exist.
   * @param data - Text or bytes.
   * @param options - `flag` `wx` refuses an existing file, `a` appends.
   * @remarks 中文说明：功能说明：写入 File Sync 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：path（string）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；参数说明：data（string |
   * Uint8Array）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：options（VfsWriteOptions）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。；返回值：void；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 writeFileSync(path, data,
   * options)，并按返回类型处理结果。
   */
  writeFileSync(path: string, data: string | Uint8Array, options?: VfsWriteOptions): void {
    /**
     * 常量说明：target 用于处理 target 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const target = this.key(path)
    if (this.directories.has(target)) fail('EISDIR', 'open', target)
    if (!this.directories.has(dirname(target))) fail('ENOENT', 'open', target)
    /**
     * 常量说明：flag 用于处理 flag 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const flag = options?.flag ?? 'w'
    if (flag.startsWith('wx') && this.files.has(target)) fail('EEXIST', 'open', target)
    if (flag.startsWith('a')) {  this.appendFileSync(target, data); return }
    // POSIX open(O_CREAT): the mode applies at creation only; a rewrite keeps
    // the entry's bits.
    /**
     * 常量说明：previous 用于处理 previous 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const previous = this.files.get(target)
    /**
     * 常量说明：mode 用于处理 mode 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const mode = previous?.mode ?? (options?.mode !== undefined ? options.mode & 0o777 : DEFAULT_FILE_MODE)
    /**
     * 常量说明：bytes 用于处理 bytes 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const bytes = typeof data === 'string' ? encoder.encode(data) : data
    if (previous !== undefined) {
      this.replaceFile(previous, bytes)
      return
    }
    /**
     * 常量说明：node 用于处理 node 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const node: FileNode = { bytes, mtimeMs: this.touch(target), mode, paths: undefined }
    this.setFile(target, node)
    this.touchDirectory(dirname(target))
    this.publish({ kind: 'write', path: target, bytes, mode, entryChanged: true })
  }

  /**
   * Open a directory; consumers enumerate entries or just prove it is one.
   * @param path - Directory path.
   * @returns Directory handle.
   * @remarks 中文说明：功能说明：处理 opendir 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：path（string）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；返回值：VfsDir；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 opendir(path)，并按返回类型处理结果。
   */
  opendir(path: string): VfsDir {
    /**
     * 常量说明：target 用于处理 target 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const target = this.key(path)
    /**
     * 常量说明：names 用于处理 names 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const names = this.readdirSync(target)
    /**
     * 变量说明：cursor 用于处理 cursor 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let cursor = 0
    /**
     * 常量说明：direntOf 用于处理 direntOf 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     * 功能说明：处理 direntOf 相关流程；使用场景由所在模块及调用位置决定。
     * @param name （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
     * @returns VfsDirent；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 direntOf(name)，并按返回类型处理结果。
     */
    const direntOf = (name: string): VfsDirent => this.direntOf(target, name)
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：Promise<void>；调用方应按声明类型处理，
     * 不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：Promise<{ name: string } | null>；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    return {
      path: target,
      close: async (): Promise<void> => {},
      read: async (): Promise<{ name: string } | null> => {
        /**
         * 常量说明：name 用于处理 name 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const name = names[cursor]
        cursor += 1
        return name === undefined ? null : direntOf(name)
      },
      /**
       * 功能说明：处理 [Symbol.asyncIterator] 相关流程；使用场景由所在模块及调用位置决定。
       * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
       * @example 在完成前置校验后调用 [Symbol.asyncIterator]()，并按返回类型处理结果。
       */
      async *[Symbol.asyncIterator]() {
        /**
         * 变量说明：name 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
         */
        for (const name of names) yield direntOf(name)
      },
    }
  }

  /**
   * Open a file handle.
   * @param path - File path.
   * @param flags - Node open flags; `r` requires the file, `wx` refuses an existing one.
   * @param mode - Permission bits applied when the open creates the file.
   * @returns File handle.
   * @remarks 中文说明：功能说明：打开 open 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：path（string）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；参数说明：flags（由
   * TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：mode（number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：VfsFileHandle；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 open(path, flags, mode)，
   * 并按返回类型处理结果。
   */
  open(path: string, flags = 'r', mode?: number): VfsFileHandle {
    /**
     * 常量说明：target 用于处理 target 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const target = this.key(path)
    // Durable writers fsync the parent directory by opening it read-only.
    if (this.directories.has(target)) {
      if (!flags.startsWith('r')) fail('EISDIR', 'open', target)
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：Promise<{ bytesWritten: number
       * }>；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
       */
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：Promise<void>；调用方应按声明类型处理，
       * 不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
       */
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：Promise<string | Uint8Array>；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
       */
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：Promise<void>；调用方应按声明类型处理，
       * 不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
       */
      return {
        write: async (): Promise<{ bytesWritten: number }> => fail('EISDIR', 'write', target),
        writeFile: async (): Promise<void> => fail('EISDIR', 'write', target),
        readFile: async (): Promise<string | Uint8Array> => fail('EISDIR', 'read', target),
        truncate: async (): Promise<void> => fail('EISDIR', 'ftruncate', target),
        ...this.handleTail(target),
      }
    }
    /**
     * 常量说明：file 用于处理 file 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const file = this.openFileSync(target, flags, mode)
    /**
     * 变量说明：position 用于处理 position 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let position = 0
    /**
     * 变量说明：closed 用于处理 closed 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let closed = false
    /**
     * 常量说明：current 用于处理 current 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     * 功能说明：处理 current 相关流程；使用场景由所在模块及调用位置决定。
     * @param syscall （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
     * @returns VfsOpenFile；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 current(syscall)，并按返回类型处理结果。
     */
    const current = (syscall: string): VfsOpenFile => {
      if (closed) fail('EBADF', syscall, target)
      return file
    }
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：data（string |
     * Uint8Array）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：Promise<{ bytesWritten:
     * number }>；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(data)，
     * 并按返回类型处理结果。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：data（string |
     * Uint8Array）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：Promise<void>；调用方应按声明类型处理，
     * 不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(data)，并按返回类型处理结果。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：options（VfsReadOptions）：提供本次操作使用的
     * 配置选项；必须满足声明的类型及调用时序要求。；返回值：Promise<string | Uint8Array>；调用方应按声明类型处理，
     * 不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(options)，并按返回类型处理结果。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：length（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：Promise<void>；调用方应按声明类型处理，
     * 不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(length)，并按返回类型处理结果。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：Promise<VfsStats>；调用方应按声明类型处理，
     * 不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：Promise<void>；调用方应按声明类型处理，
     * 不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：Promise<void>；调用方应按声明类型处理，
     * 不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：Promise<void>；调用方应按声明类型处理，
     * 不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    return {
      write: async (data: string | Uint8Array): Promise<{ bytesWritten: number }> => {
        /**
         * 常量说明：bytes 用于处理 bytes 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const bytes = typeof data === 'string' ? encoder.encode(data) : data
        /**
         * 常量说明：descriptor 用于处理 descriptor 相关数据，作用于当前作用域；初始化后不可重新赋值，
         * 但对象内部是否可变仍由其类型决定。
         */
        const descriptor = current('write')
        /**
         * 常量说明：offset 用于处理 offset 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const offset = descriptor.append ? descriptor.stat().size : position
        /**
         * 常量说明：bytesWritten 用于处理 bytesWritten 相关数据，作用于当前作用域；初始化后不可重新赋值，
         * 但对象内部是否可变仍由其类型决定。
         */
        const bytesWritten = descriptor.write(offset, bytes)
        position = offset + bytesWritten
        return { bytesWritten }
      },
      writeFile: async (data: string | Uint8Array): Promise<void> => {
        /**
         * 常量说明：bytes 用于处理 bytes 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const bytes = typeof data === 'string' ? encoder.encode(data) : data
        /**
         * 常量说明：descriptor 用于处理 descriptor 相关数据，作用于当前作用域；初始化后不可重新赋值，
         * 但对象内部是否可变仍由其类型决定。
         */
        const descriptor = current('write')
        /**
         * 常量说明：offset 用于处理 offset 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const offset = descriptor.append ? descriptor.stat().size : position
        position = offset + descriptor.write(offset, bytes)
      },
      readFile: async (options?: VfsReadOptions): Promise<string | Uint8Array> => {
        /**
         * 常量说明：descriptor 用于处理 descriptor 相关数据，作用于当前作用域；初始化后不可重新赋值，
         * 但对象内部是否可变仍由其类型决定。
         */
        const descriptor = current('read')
        /**
         * 常量说明：bytes 用于处理 bytes 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const bytes = descriptor.read(position, Math.max(0, descriptor.stat().size - position))
        position += bytes.length
        return encodingOf(options) === undefined ? bytes : decoder.decode(bytes)
      },
      truncate: async (length = 0): Promise<void> => {
        current('ftruncate').truncate(length)
      },
      stat: async (): Promise<VfsStats> => current('fstat').stat(),
      sync: async (): Promise<void> => { current('fsync'); await this.flush() },
      datasync: async (): Promise<void> => { current('fdatasync'); await this.flush() },
      close: async (): Promise<void> => { closed = true },
    }
  }

  /**
   * Open one synchronous descriptor over a stable file identity.
   * @param path - File path.
   * @param flags - Node open flags.
   * @param mode - Permission bits applied only when a file is created.
   * @returns An open file that survives path rename, replacement, and unlink.
   * @remarks 中文说明：功能说明：打开 File Sync 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：path（string）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；参数说明：flags（由
   * TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：mode（number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：VfsOpenFile；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 openFileSync(path, flags,
   * mode)，并按返回类型处理结果。
   */
  openFileSync(path: string, flags = 'r', mode?: number): VfsOpenFile {
    /**
     * 常量说明：target 用于处理 target 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const target = this.key(path)
    /**
     * 常量说明：access 用于处理 access 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const access = openMode(flags)
    /**
     * 常量说明：existing 用于处理 existing 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const existing = this.files.get(target)
    if (this.directories.has(target)) fail('EISDIR', 'open', target)
    if (access.exclusive && existing !== undefined) fail('EEXIST', 'open', target)
    if (!access.create && existing === undefined) fail('ENOENT', 'open', target)
    if (access.create && existing === undefined) {
      this.writeFileSync(target, new Uint8Array(), mode === undefined ? undefined : { mode })
    } else if (access.truncate && existing !== undefined) {
      this.truncateFile(existing, 0)
    }
    /**
     * 常量说明：node 用于处理 node 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const node = this.files.get(target)
    if (node === undefined) fail('ENOENT', 'open', target)
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：position（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：length（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(position, length)，
     * 并按返回类型处理结果。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：position（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：data（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(position, data)，
     * 并按返回类型处理结果。
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
    return {
      readable: access.readable,
      writable: access.writable,
      append: access.append,
      read: (position, length) => {
        if (!access.readable) fail('EBADF', 'read', target)
        return node.bytes.subarray(position, position + length)
      },
      write: (position, data) => {
        if (!access.writable) fail('EBADF', 'write', target)
        return this.writeFileNode(node, access.append ? node.bytes.length : position, data)
      },
      truncate: (length) => {
        if (!access.writable) fail('EINVAL', 'ftruncate', target)
        this.truncateFile(node, length)
      },
      stat: () => this.fileStats(node),
    }
  }

  /**
   * Directory-handle members for metadata, durability, and release.
   * `sync`/`datasync` settle an attached durable sink; an ephemeral filesystem
   * resolves immediately and `close` releases nothing.
   * @param target - Normalized path the handle was opened on.
   * @returns Metadata plus the no-op durability and release calls.
   * @remarks 中文说明：功能说明：处理 Tail 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：target（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：Pick<VfsFileHandle, 'stat' | 'sync' | 'datasync' | 'close'>；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 handleTail(target)，
   * 并按返回类型处理结果。
   */
  private handleTail(target: string): Pick<VfsFileHandle, 'stat' | 'sync' | 'datasync' | 'close'> {
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：Promise<VfsStats>；调用方应按声明类型处理，
     * 不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：Promise<void>；调用方应按声明类型处理，
     * 不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：Promise<void>；调用方应按声明类型处理，
     * 不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：Promise<void>；调用方应按声明类型处理，
     * 不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    return {
      stat: async (): Promise<VfsStats> => this.plainStats(target),
      sync: async (): Promise<void> => { await this.flush() },
      datasync: async (): Promise<void> => { await this.flush() },
      close: async (): Promise<void> => {},
    }
  }

  /**
   * Append to a file, creating it when absent.
   * @param path - File path.
   * @param data - Text or bytes.
   * @remarks 中文说明：功能说明：处理 appendFileSync 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：path（string）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；参数说明：data（string |
   * Uint8Array）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 appendFileSync(path, data)，并按返回类型处理结果。
   */
  appendFileSync(path: string, data: string | Uint8Array): void {
    /**
     * 常量说明：target 用于处理 target 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const target = this.key(path)
    /**
     * 常量说明：existing 用于处理 existing 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const existing = this.files.get(target)
    /**
     * 常量说明：addition 用于处理 addition 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const addition = typeof data === 'string' ? encoder.encode(data) : data
    if (existing === undefined) {  this.writeFileSync(target, addition); return }
    this.writeFileNode(existing, existing.bytes.length, addition)
  }

  /**
   * Move a file or directory subtree.
   * @param from - Source path.
   * @param to - Destination path.
   * @remarks 中文说明：功能说明：处理 renameSync 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：from（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：to（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 renameSync(from, to)，并按返回类型处理结果。
   */
  renameSync(from: string, to: string): void {
    /**
     * 常量说明：source 用于处理 source 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const source = this.key(from)
    /**
     * 常量说明：destination 用于处理 destination 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const destination = this.key(to)
    if (source === destination) return
    /**
     * 常量说明：node 用于处理 node 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const node = this.files.get(source)
    if (node !== undefined) {
      if (this.directories.has(destination)) fail('EISDIR', 'rename', destination)
      if (!this.directories.has(dirname(destination))) fail('ENOENT', 'rename', destination)
      if (this.files.get(destination) === node) return
      this.deleteFile(source)
      this.setFile(destination, node)
      this.forgetIdentity(source)
      this.forgetIdentity(destination)
      this.touchDirectory(dirname(source))
      this.touchDirectory(dirname(destination))
      this.publish({ kind: 'remove', path: source })
      this.publish({ kind: 'write', path: destination, bytes: node.bytes, mode: node.mode, entryChanged: true })
      return
    }
    if (!this.directories.has(source)) fail('ENOENT', 'rename', source)
    if (this.files.has(destination)) fail('ENOTDIR', 'rename', destination)
    if (!this.directories.has(dirname(destination))) fail('ENOENT', 'rename', destination)
    if (this.directories.has(destination)) {
      if (this.readdirSync(destination).length > 0) fail('ENOTEMPTY', 'rename', destination)
      this.directories.delete(destination)
      this.directoryModes.delete(destination)
      this.directoryMtimes.delete(destination)
    }
    /**
     * 常量说明：prefix 用于处理 prefix 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const prefix = `${source}${SEP}`
    /**
     * 常量说明：movedFiles 用于处理 movedFiles 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const movedFiles: Array<{ path: string; bytes: Uint8Array; mode: number }> = []
    /**
     * 变量说明：candidate、value 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const [candidate, value] of [...this.files]) {
      if (!candidate.startsWith(prefix)) continue
      this.deleteFile(candidate)
      /**
       * 常量说明：target 用于处理 target 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const target = join(destination, candidate.slice(prefix.length))
      this.setFile(target, value)
      movedFiles.push({ path: target, bytes: value.bytes, mode: value.mode })
    }
    /**
     * 常量说明：movedDirectories 用于处理 movedDirectories 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const movedDirectories: Array<{ path: string; mode: number }> = []
    /**
     * 变量说明：candidate 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const candidate of [...this.directories]) {
      if (!candidate.startsWith(prefix) && candidate !== source) continue
      /**
       * 常量说明：moved 用于处理 moved 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const moved = candidate === source ? destination : join(destination, candidate.slice(prefix.length))
      this.directories.delete(candidate)
      this.directories.add(moved)
      /**
       * 常量说明：bits 用于处理 bits 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const bits = this.directoryModes.get(candidate)
      this.directoryModes.delete(candidate)
      if (bits !== undefined) this.directoryModes.set(moved, bits)
      movedDirectories.push({ path: moved, mode: bits ?? DEFAULT_DIRECTORY_MODE })
      /**
       * 常量说明：mtime 用于处理 mtime 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const mtime = this.directoryMtimes.get(candidate)
      this.directoryMtimes.delete(candidate)
      if (mtime !== undefined) this.directoryMtimes.set(moved, mtime)
    }
    this.forgetIdentity(source)
    this.forgetIdentity(destination)
    this.touchDirectory(dirname(source))
    this.touchDirectory(dirname(destination))
    this.publish({ kind: 'remove', path: source })
    /**
     * 变量说明：directory 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const directory of movedDirectories) {
      this.publish({ kind: 'mkdir', path: directory.path, mode: directory.mode })
    }
    /**
     * 变量说明：entry 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const entry of movedFiles) {
      this.publish({
        kind: 'write', path: entry.path, bytes: entry.bytes, mode: entry.mode, entryChanged: true,
      })
    }
  }

  /**
   * Give existing bytes a second name.
   *
   * Both names retain one file identity, so writes and metadata changes through
   * either name remain visible through the other until that name is removed.
   * @param existing - Source file path.
   * @param next - Additional path; its parent must exist and it must be free.
   * @remarks 中文说明：功能说明：处理 linkSync 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：existing（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：next（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 linkSync(existing, next)，并按返回类型处理结果。
   */
  linkSync(existing: string, next: string): void {
    /**
     * 常量说明：source 用于处理 source 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const source = this.key(existing)
    /**
     * 常量说明：target 用于处理 target 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const target = this.key(next)
    /**
     * 常量说明：node 用于处理 node 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const node = this.files.get(source)
    if (node === undefined) fail('ENOENT', 'link', source)
    if (this.files.has(target) || this.directories.has(target)) fail('EEXIST', 'link', target)
    if (!this.directories.has(dirname(target))) fail('ENOENT', 'link', target)
    this.setFile(target, node)
    this.touchDirectory(dirname(target))
    this.publish({ kind: 'write', path: target, bytes: node.bytes, mode: node.mode, entryChanged: true })
  }

  /**
   * Shorten a file.
   * @param path - File path.
   * @param length - Byte length to keep; defaults to zero.
   * @remarks 中文说明：功能说明：处理 truncateSync 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：path（string）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；参数说明：length（由
   * TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 truncateSync(path,
   * length)，并按返回类型处理结果。
   */
  truncateSync(path: string, length = 0): void {
    /**
     * 常量说明：target 用于处理 target 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const target = this.key(path)
    /**
     * 常量说明：node 用于处理 node 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const node = this.files.get(target)
    if (node === undefined) fail('ENOENT', 'truncate', target)
    this.truncateFile(node, length)
  }

  /**
   * Change an entry's permission bits; stat reads back exactly what was set.
   * @param path - File or directory path.
   * @param mode - New permission bits (`0o777` mask).
   * @remarks 中文说明：功能说明：处理 chmodSync 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：path（string）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；
   * 参数说明：mode（number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 chmodSync(path, mode)，并按返回类型处理结果。
   */
  chmodSync(path: string, mode: number): void {
    /**
     * 常量说明：target 用于处理 target 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const target = this.key(path)
    /**
     * 常量说明：node 用于处理 node 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const node = this.files.get(target)
    if (node !== undefined) {
      node.mode = mode & 0o777
      if (typeof node.paths === 'string') {
        this.publish({ kind: 'chmod', path: node.paths, mode: node.mode })
      } else if (node.paths !== undefined) {
        /**
         * 变量说明：path 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
         */
        for (const path of node.paths) this.publish({ kind: 'chmod', path, mode: node.mode })
      }
      return
    }
    if (this.directories.has(target)) {
      /**
       * 常量说明：bits 用于处理 bits 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const bits = mode & 0o777
      this.directoryModes.set(target, bits)
      this.publish({ kind: 'chmod', path: target, mode: bits })
      return
    }
    fail('ENOENT', 'chmod', target)
  }

  /**
   * Remove a file.
   * @param path - File path.
   * @remarks 中文说明：功能说明：处理 unlinkSync 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：path（string）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；返回值：void；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 unlinkSync(path)，
   * 并按返回类型处理结果。
   */
  unlinkSync(path: string): void {
    /**
     * 常量说明：target 用于处理 target 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const target = this.key(path)
    if (this.deleteFile(target) === undefined) fail('ENOENT', 'unlink', target)
    this.forgetIdentity(target)
    this.touchDirectory(dirname(target))
    this.publish({ kind: 'remove', path: target })
  }

  /**
   * Remove a file or directory.
   * @param path - Path to remove.
   * @param options - `recursive` removes subtrees, `force` ignores absence.
   * @remarks 中文说明：功能说明：处理 rmSync 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：path（string）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；参数说明：options（{
   * recursive?: boolean; force?: boolean }）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。；
   * 返回值：void；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 rmSync(path,
   * options)，并按返回类型处理结果。
   */
  rmSync(path: string, options?: { recursive?: boolean; force?: boolean }): void {
    /**
     * 常量说明：target 用于处理 target 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const target = this.key(path)
    if (this.deleteFile(target) !== undefined) {
      this.forgetIdentity(target)
      this.touchDirectory(dirname(target))
      this.publish({ kind: 'remove', path: target })
      return
    }
    if (this.directories.has(target)) {
      if (options?.recursive !== true) fail('ERR_FS_EISDIR', 'rm', target)
      /**
       * 常量说明：prefix 用于处理 prefix 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const prefix = `${target}${SEP}`
      /**
       * 变量说明：candidate 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
       */
      for (const candidate of [...this.files.keys()]) if (candidate.startsWith(prefix)) this.deleteFile(candidate)
      /**
       * 变量说明：candidate 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
       */
      for (const candidate of [...this.directories]) {
        if (!candidate.startsWith(prefix)) continue
        this.directories.delete(candidate)
        this.directoryModes.delete(candidate)
        this.directoryMtimes.delete(candidate)
      }
      this.directories.delete(target)
      this.directoryModes.delete(target)
      this.directoryMtimes.delete(target)
      this.forgetIdentity(target)
      this.touchDirectory(dirname(target))
      this.publish({ kind: 'remove', path: target })
      return
    }
    if (options?.force !== true) fail('ENOENT', 'rm', target)
  }

  /**
   * Create a uniquely named directory beside `prefix`, as `fs.mkdtempSync` does.
   * @param prefix - Path prefix; the suffix is appended without a separator.
   * @returns The created directory path.
   * @remarks 中文说明：功能说明：处理 mkdtempSync 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：prefix（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：string；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 mkdtempSync(prefix)，并按返回类型处理结果。
   */
  mkdtempSync(prefix: string): string {
    this.temporaries += 1
    /**
     * 常量说明：target 用于处理 target 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const target = `${prefix}${Date.now().toString(36)}${this.temporaries.toString(36)}`
    this.mkdirSync(target, { recursive: true })
    return this.key(target)
  }

  /**
   * Seed a file and its parent directories, for image loading and tests.
   * @param path - File path.
   * @param data - Text or bytes.
   * @param options - Permission bits and modification time supplied by the image or durable store.
   * @remarks 中文说明：功能说明：处理 seed 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：path（string）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；参数说明：data（string |
   * Uint8Array）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：options（VfsSeedOptions）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。；返回值：void；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 seed(path, data, options)，
   * 并按返回类型处理结果。
   */
  seed(path: string, data: string | Uint8Array, options: VfsSeedOptions = {}): void {
    /**
     * 常量说明：target 用于处理 target 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const target = this.key(path)
    this.seedDirectory(dirname(target))
    this.setFile(target, {
      bytes: typeof data === 'string' ? encoder.encode(data) : data,
      mtimeMs: options.mtimeMs ?? this.touch(target),
      mode: (options.mode ?? DEFAULT_FILE_MODE) & 0o777,
      paths: undefined,
    })
    this.touchDirectory(dirname(target))
  }

  /**
   * Create a directory and its parents.
   * @param path - Directory path.
   * @param options - Permission bits and modification time supplied by the image or durable store.
   * @remarks 中文说明：功能说明：处理 seedDirectory 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：path（string）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；
   * 参数说明：options（VfsSeedOptions）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。；返回值：void；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 seedDirectory(path,
   * options)，并按返回类型处理结果。
   */
  seedDirectory(path: string, options: VfsSeedOptions = {}): void {
    /**
     * 常量说明：target 用于处理 target 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const target = this.key(path)
    if (!this.directories.has(target)) {
      /**
       * 常量说明：parent 用于处理 parent 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const parent = dirname(target)
      if (parent !== target) this.seedDirectory(parent)
      if (this.files.has(target)) fail('EEXIST', 'mkdir', target)
      this.directories.add(target)
      this.directoryMtimes.set(target, options.mtimeMs ?? Date.now())
      this.touchDirectory(parent)
    }
    if (options.mode !== undefined) this.directoryModes.set(target, options.mode & 0o777)
    if (options.mtimeMs !== undefined) this.directoryMtimes.set(target, options.mtimeMs)
  }

  /**
   * Report what this filesystem holds, for the host's boot diagnostics.
   * @returns File count, directory count, and total byte size.
   * @remarks 中文说明：功能说明：处理 usage 相关流程；使用场景由所在模块及调用位置决定。；返回值：{ files: number;
   * directories: number; bytes: number }；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 使用示例：典型用法：在完成前置校验后调用 usage()，并按返回类型处理结果。
   */
  usage(): { files: number; directories: number; bytes: number } {
    /**
     * 变量说明：bytes 用于处理 bytes 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let bytes = 0
    /**
     * 变量说明：node 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const node of this.files.values()) bytes += node.bytes.length
    return { files: this.files.size, directories: this.directories.size, bytes }
  }
}

/**
 * Mount a tar image produced by the build-time collector.
 *
 * Entry names are relative to `root` (`node_modules/...`, `config/cordis.yml`);
 * an absolute entry name is a collector defect and fails loud. File contents
 * stay views into `image` — nothing is copied at mount time.
 * @param image - The ustar archive, as `inflateImage` produces it from the fetched image.
 * @param root - Virtual root the entries mount under.
 * @param vfs - Filesystem to fill; a fresh one by default.
 * @returns The filled filesystem.
 * @remarks 中文说明：功能说明：加载 Vfs Image 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：image（Uint8Array）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数说明：root（由
 * TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数说明：vfs（由
 * TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：MemoryVfs；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 loadVfsImage(image, root,
 * vfs)，并按返回类型处理结果。
 */
export function loadVfsImage(image: Uint8Array, root = '/dsh', vfs = new MemoryVfs()): MemoryVfs {
  vfs.seedDirectory(root)
  /**
   * 变量说明：entry 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (const entry of parseTar(image)) {
    /**
     * 常量说明：relativeName 用于处理 relativeName 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const relativeName = entry.name.startsWith('./') ? entry.name.slice(2) : entry.name
    if (relativeName.startsWith(SEP)) {
      throw new Error(`webworker vfs: image entry must be relative to ${root}, received "${entry.name}"`)
    }
    /**
     * 常量说明：target 用于处理 target 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const target = join(root, relativeName)
    if (entry.directory) {
      vfs.seedDirectory(target, { mode: entry.mode })
      continue
    }
    vfs.seed(target, entry.bytes, { mode: entry.mode })
  }
  return vfs
}

/**
 * Apply one ordered data overlay to an already mounted base image.
 *
 * Overlay entries may replace files only under the layout's data directories;
 * module code, configuration, and the lowering manifest cannot be shadowed.
 * Paths containing traversal segments are refused before normalization. Later
 * overlays win for files, while file/directory type conflicts fail loud.
 * @param image - Uncompressed ustar overlay archive.
 * @param root - Virtual root shared with the base image.
 * @param vfs - Mounted filesystem to update.
 * @returns The same filesystem after applying the overlay.
 * @remarks 中文说明：功能说明：加载 Vfs Overlay 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：image（Uint8Array）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：root（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：vfs（MemoryVfs）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：MemoryVfs；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 loadVfsOverlay(image,
 * root, vfs)，并按返回类型处理结果。
 */
export function loadVfsOverlay(image: Uint8Array, root: string, vfs: MemoryVfs): MemoryVfs {
  /**
   * 变量说明：entry 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (const entry of parseTar(image)) {
    /**
     * 常量说明：relativeName 用于处理 relativeName 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const relativeName = entry.name.startsWith('./') ? entry.name.slice(2) : entry.name
    /**
     * 常量说明：path 用于处理 path 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const path = relativeName.endsWith('/') ? relativeName.slice(0, -1) : relativeName
    /**
     * 常量说明：segments 用于处理 segments 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const segments = path.split('/')
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：segment（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(segment)，并按返回类型处理结果。
     */
    if (path === '' || relativeName.startsWith(SEP)
      || segments.some(segment => segment === '' || segment === '.' || segment === '..')
      || !IMAGE_OVERLAY_DIRECTORIES.includes(segments[0] ?? '')) {
      throw new Error(`webworker vfs: overlay entry must stay under ${IMAGE_OVERLAY_DIRECTORIES.join('/ or ')}, received "${entry.name}"`)
    }
    /**
     * 常量说明：target 用于处理 target 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const target = join(root, path)
    if (entry.directory) {
      vfs.seedDirectory(target, { mode: entry.mode })
      continue
    }
    if (vfs.existsSync(target) && vfs.statSync(target).isDirectory()) {
      throw new Error(`webworker vfs: overlay file cannot replace directory "${target}"`)
    }
    vfs.seed(target, entry.bytes, { mode: entry.mode })
  }
  return vfs
}
