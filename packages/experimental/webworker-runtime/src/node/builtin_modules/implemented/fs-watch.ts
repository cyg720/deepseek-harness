/** Node filesystem watching over the active in-memory VFS.
 * @remarks 文件说明：文件职责：实现 experimental/webworker-runtime 中 fs watch 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/webworker-runtime 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 →
 * 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。 */
import { Buffer } from 'buffer'
import { EventEmitter } from './events.ts'
import { captureAsyncContext, runWithAsyncContext } from './async_hooks.ts'
import { basename, relative, resolve, sep } from './path.ts'
import { requireActiveVfs } from '../../../storage/active.ts'
import type { VfsBigIntStats, VfsMutation, VfsStats } from '../../../storage/types.ts'
import { abortError } from './abort-error.ts'

type PathArg = string | URL | Uint8Array
type WatchListener = (eventType: 'rename' | 'change', filename: string | Buffer | null) => void
type WatchStats = VfsStats | VfsBigIntStats
type StatListener = (current: WatchStats, previous: WatchStats) => void

/** Options shared by the callback and promise watch faces. */
export interface WatchOptions {
  persistent?: boolean
  recursive?: boolean
  encoding?: BufferEncoding | 'buffer'
  signal?: AbortSignal
}
/** Poll-style watch options. */
export interface WatchFileOptions {
  persistent?: boolean
  interval?: number
  bigint?: boolean
}

/**
 * 常量说明：asPath 用于处理 asPath 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 * 功能说明：处理 asPath 相关流程；使用场景由所在模块及调用位置决定。
 * @param path （PathArg）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。
 * @returns string；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 asPath(path)，并按返回类型处理结果。
 */
const asPath = (path: PathArg): string => {
  if (typeof path === 'string') return resolve(path)
  if (path instanceof URL) return resolve(decodeURIComponent(path.pathname))
  return resolve(new TextDecoder().decode(path))
}

/**
 * 常量说明：missingStats 用于处理 missingStats 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 * 功能说明：处理 missingStats 相关流程；使用场景由所在模块及调用位置决定。
 * @param bigint （boolean）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns WatchStats；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 missingStats(bigint)，并按返回类型处理结果。
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
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
const missingStats = (bigint: boolean): WatchStats => ({
  size: bigint ? 0n : 0,
  ino: bigint ? 0n : 0,
  mtimeMs: bigint ? 0n : 0,
  ctimeMs: bigint ? 0n : 0,
  atimeMs: bigint ? 0n : 0,
  birthtimeMs: bigint ? 0n : 0,
  mtime: new Date(0),
  mode: bigint ? 0n : 0,
  ...bigint ? {
    dev: 0n,
    nlink: 0n,
    mtimeNs: 0n,
    ctimeNs: 0n,
    atimeNs: 0n,
    birthtimeNs: 0n,
    ctime: new Date(0),
    atime: new Date(0),
    birthtime: new Date(0),
  } : {},
  isFile: () => false,
  isDirectory: () => false,
  isSymbolicLink: () => false,
  isFIFO: () => false,
  isSocket: () => false,
  isBlockDevice: () => false,
  isCharacterDevice: () => false,
}) as WatchStats

/**
 * 常量说明：statOrMissing 用于处理 statOrMissing 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 * 功能说明：处理 statOrMissing 相关流程；使用场景由所在模块及调用位置决定。
 * @param path （string）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。
 * @param bigint （boolean）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns WatchStats；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 statOrMissing(path, bigint)，并按返回类型处理结果。
 */
const statOrMissing = (path: string, bigint: boolean): WatchStats => {
  /**
   * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
   */
  try {
    return requireActiveVfs().statSync(path, { bigint })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return missingStats(bigint)
    throw error
  }
}

/**
 * 常量说明：statsChanged 用于处理 statsChanged 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 * 功能说明：处理 statsChanged 相关流程；使用场景由所在模块及调用位置决定。
 * @param left （WatchStats）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param right （WatchStats）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns boolean；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 statsChanged(left, right)，并按返回类型处理结果。
 */
const statsChanged = (left: WatchStats, right: WatchStats): boolean =>
  left.size !== right.size
  || left.mtimeMs !== right.mtimeMs
  || left.mode !== right.mode
  || left.ino !== right.ino
  || left.isFile() !== right.isFile()
  || left.isDirectory() !== right.isDirectory()

/**
 * 常量说明：contains 用于处理 contains 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 * 功能说明：处理 contains 相关流程；使用场景由所在模块及调用位置决定。
 * @param parent （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param child （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns boolean；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 contains(parent, child)，并按返回类型处理结果。
 */
const contains = (parent: string, child: string): boolean =>
  parent === '/' || child === parent || child.startsWith(`${parent}${sep}`)

/**
 * 常量说明：overlaps 用于处理 overlaps 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 * 功能说明：处理 overlaps 相关流程；使用场景由所在模块及调用位置决定。
 * @param left （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param right （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns boolean；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 overlaps(left, right)，并按返回类型处理结果。
 */
const overlaps = (left: string, right: string): boolean => contains(left, right) || contains(right, left)

/** `fs.FSWatcher` over VFS mutations.
 * @remarks 中文说明：类说明：FSWatcher 用于集中封装 处理 FSWatcher 相关状态与行为。；核心功能：通过成员字段保存状态，
 * 并由公开方法提供受类型约束的操作入口。；使用场景：由 experimental/webworker-runtime
 * 在对应插件或业务生命周期内创建和调用。 */
export class FSWatcher extends EventEmitter {
  /**
   * 常量说明：disposeMutation 用于处理 disposeMutation 相关数据，作用于成员；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  private readonly disposeMutation: () => void
  /**
   * 常量说明：signal 用于处理 signal 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly signal: AbortSignal | undefined
  /**
   * 常量说明：onAbort 用于响应 Abort 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly onAbort: (() => void) | undefined
  /**
   * 变量说明：closed 用于处理 closed 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  private closed = false
  /**
   * 变量说明：referenced 用于处理 referenced 相关数据，作用于成员；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  private referenced: boolean

  /**
   * 功能说明：处理 FSWatcher 相关流程；使用场景由所在模块及调用位置决定。
   * @param target （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param directory （boolean）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param options （WatchOptions）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。
   * @param listener （WatchListener）：接收后续状态或事件并执行调用方逻辑；必须满足声明的类型及调用时序要求。
   * @returns 当前类实例；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 通过 new FSWatcher(target, directory, options, listener) 创建实例，
   * 并在所属生命周期内使用。
   */
  constructor(
    private readonly target: string,
    private readonly directory: boolean,
    private readonly options: WatchOptions,
    listener?: WatchListener,
  ) {
    super()
    this.referenced = options.persistent ?? true
    /**
     * 常量说明：context 用于处理 context 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const context = captureAsyncContext()
    if (listener !== undefined) this.on('change', listener as (...args: unknown[]) => void)
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：mutation（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(mutation)，并按返回类型处理结果。
     */
    this.disposeMutation = requireActiveVfs().subscribe((mutation) => {
      if (!this.matches(mutation)) return
      /**
       * 常量说明：eventType 用于处理 eventType 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const eventType = mutation.kind === 'write' && !mutation.entryChanged || mutation.kind === 'chmod'
        ? 'change'
        : 'rename'
      /**
       * 常量说明：filename 用于处理 filename 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const filename = this.filename(mutation.path)
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
       */
      queueMicrotask(() => {
        if (this.closed) return
        /**
         * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
         * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
         */
        runWithAsyncContext(context, () => { this.emit('change', eventType, filename) })
      })
    })
    this.signal = options.signal
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    this.onAbort = options.signal === undefined ? undefined : () => { this.close() }
    if (options.signal?.aborted === true) {
      this.close()
      return
    }
    options.signal?.addEventListener('abort', this.onAbort as () => void, { once: true })
  }

  /**
   * 功能说明：处理 matches 相关流程；使用场景由所在模块及调用位置决定。
   * @param mutation （VfsMutation）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns boolean；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 matches(mutation)，并按返回类型处理结果。
   */
  private matches(mutation: VfsMutation): boolean {
    if (mutation.path === this.target) return true
    if (mutation.kind === 'remove' && contains(mutation.path, this.target)) return true
    if (!this.directory || !contains(this.target, mutation.path)) return false
    if (this.options.recursive === true) return true
    /**
     * 常量说明：child 用于处理 child 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const child = relative(this.target, mutation.path)
    return child !== '' && !child.startsWith('..') && !child.includes(sep)
  }

  /**
   * 功能说明：处理 filename 相关流程；使用场景由所在模块及调用位置决定。
   * @param path （string）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。
   * @returns string | Buffer；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 filename(path)，并按返回类型处理结果。
   */
  private filename(path: string): string | Buffer {
    /**
     * 常量说明：relativePath 用于处理 relativePath 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const relativePath = relative(this.target, path)
    /**
     * 常量说明：value 用于处理 value 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const value = this.directory && contains(this.target, path)
      ? this.options.recursive === true ? relativePath : relativePath.split(sep)[0] ?? ''
      : basename(this.target)
    return this.options.encoding === 'buffer' ? Buffer.from(value) : value
  }

  /** Stop observing and publish `close` once.
   * @remarks 中文说明：功能说明：关闭 close 相关流程；使用场景由所在模块及调用位置决定。；返回值：void；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 close()，并按返回类型处理结果。 */
  close(): void {
    if (this.closed) return
    this.closed = true
    this.disposeMutation()
    if (this.onAbort !== undefined) this.signal?.removeEventListener('abort', this.onAbort)
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    queueMicrotask(() => { this.emit('close') })
  }

  /**
   * Mark this watcher as process-liveness-bearing.
   * @returns This watcher.
   * @remarks 中文说明：功能说明：处理 ref 相关流程；使用场景由所在模块及调用位置决定。；返回值：this；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 ref()，并按返回类型处理结果。
   */
  ref(): this {
    this.referenced = true
    return this
  }

  /**
   * Clear the process-liveness flag; dedicated Workers have no ref-counted event loop.
   * @returns This watcher.
   * @remarks 中文说明：功能说明：处理 unref 相关流程；使用场景由所在模块及调用位置决定。；返回值：this；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 unref()，并按返回类型处理结果。
   */
  unref(): this {
    this.referenced = false
    return this
  }

  /**
   * Read the retained process-liveness flag.
   * @returns Whether this watcher is marked as keeping its owner alive.
   * @remarks 中文说明：功能说明：判断是否包含 Ref 相关流程；使用场景由所在模块及调用位置决定。；返回值：boolean；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 hasRef()，并按返回类型处理结果。
   */
  hasRef(): boolean {
    return this.referenced
  }
}

/**
 * Watch one path through the active VFS.
 * @param path - File or directory path.
 * @param optionsOrListener - Watch options, encoding, or the change listener.
 * @param maybeListener - Change listener when the second argument carries options.
 * @returns The closeable watcher.
 * @remarks 中文说明：功能说明：处理 watch 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：path（PathArg）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；
 * 参数说明：optionsOrListener（WatchOptions | BufferEncoding | 'buffer' |
 * WatchListener）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。；
 * 参数说明：maybeListener（WatchListener）：接收后续状态或事件并执行调用方逻辑；必须满足声明的类型及调用时序要求。；
 * 返回值：FSWatcher；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 watch(path,
 * optionsOrListener, maybeListener)，并按返回类型处理结果。
 */
export function watch(
  path: PathArg,
  optionsOrListener?: WatchOptions | BufferEncoding | 'buffer' | WatchListener,
  maybeListener?: WatchListener,
): FSWatcher {
  /**
   * 常量说明：options 用于处理 options 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const options: WatchOptions = typeof optionsOrListener === 'object'
    ? optionsOrListener
    : typeof optionsOrListener === 'string' ? { encoding: optionsOrListener } : {}
  /**
   * 常量说明：listener 用于处理 listener 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const listener = typeof optionsOrListener === 'function' ? optionsOrListener : maybeListener
  /**
   * 常量说明：target 用于处理 target 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const target = asPath(path)
  /**
   * 常量说明：stats 用于处理 stats 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const stats = requireActiveVfs().statSync(target)
  return new FSWatcher(target, stats.isDirectory(), options, listener)
}

/** `fs.StatWatcher` returned from `watchFile`.
 * @remarks 中文说明：类说明：StatWatcher 用于集中封装 处理 StatWatcher 相关状态与行为。；
 * 核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。；使用场景：由
 * experimental/webworker-runtime 在对应插件或业务生命周期内创建和调用。 */
export class StatWatcher extends EventEmitter {
  /**
   * 常量说明：disposeMutation 用于处理 disposeMutation 相关数据，作用于成员；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  private readonly disposeMutation: () => void
  /**
   * 变量说明：timer 用于处理 timer 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  private timer: ReturnType<typeof setTimeout> | undefined
  /**
   * 变量说明：previous 用于处理 previous 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  private previous: WatchStats
  /**
   * 变量说明：stopped 用于处理 stopped 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  private stopped = false
  /**
   * 变量说明：referenced 用于处理 referenced 相关数据，作用于成员；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  private referenced: boolean
  /**
   * 常量说明：context 用于处理 context 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly context: ReturnType<typeof captureAsyncContext>
  /**
   * 常量说明：interval 用于处理 interval 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly interval: number
  /**
   * 常量说明：bigint 用于处理 bigint 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly bigint: boolean

  /**
   * 功能说明：处理 StatWatcher 相关流程；使用场景由所在模块及调用位置决定。
   * @param path （string）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。
   * @param options （WatchFileOptions）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。
   * @returns 当前类实例；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 通过 new StatWatcher(path, options) 创建实例，并在所属生命周期内使用。
   */
  constructor(readonly path: string, options: WatchFileOptions) {
    super()
    this.referenced = options.persistent ?? true
    this.interval = options.interval ?? 5007
    this.bigint = options.bigint ?? false
    this.previous = statOrMissing(path, this.bigint)
    this.context = captureAsyncContext()
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：mutation（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(mutation)，并按返回类型处理结果。
     */
    this.disposeMutation = requireActiveVfs().subscribe((mutation) => {
      if (overlaps(path, mutation.path)) this.schedule()
    })
    if (!this.previous.isFile() && !this.previous.isDirectory()) this.schedule(true)
  }

  /**
   * 功能说明：处理 schedule 相关流程；使用场景由所在模块及调用位置决定。
   * @param initialMissing （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 schedule(initialMissing)，并按返回类型处理结果。
   */
  private schedule(initialMissing = false): void {
    if (this.stopped || this.timer !== undefined) return
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    this.timer = setTimeout(() => {
      this.timer = undefined
      if (this.stopped) return
      /**
       * 常量说明：current 用于处理 current 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const current = statOrMissing(this.path, this.bigint)
      /**
       * 常量说明：previous 用于处理 previous 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const previous = this.previous
      this.previous = current
      if (initialMissing || statsChanged(current, previous)) {
        /**
         * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
         * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
         */
        runWithAsyncContext(this.context, () => { this.emit('change', current, previous) })
      }
    }, this.interval)
    if (!this.referenced) timerUnref(this.timer)
  }

  /** Stop polling and release the VFS subscription.
   * @remarks 中文说明：功能说明：停止 stop 相关流程；使用场景由所在模块及调用位置决定。；返回值：void；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 stop()，并按返回类型处理结果。 */
  stop(): void {
    if (this.stopped) return
    this.stopped = true
    this.disposeMutation()
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
    this.emit('stop')
  }

  /** Alias used by callers treating the watcher as a closeable handle.
   * @remarks 中文说明：功能说明：关闭 close 相关流程；使用场景由所在模块及调用位置决定。；返回值：void；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 close()，并按返回类型处理结果。 */
  close(): void {
    this.stop()
  }

  /**
   * Mark this watcher as process-liveness-bearing.
   * @returns This watcher.
   * @remarks 中文说明：功能说明：处理 ref 相关流程；使用场景由所在模块及调用位置决定。；返回值：this；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 ref()，并按返回类型处理结果。
   */
  ref(): this {
    this.referenced = true
    if (this.timer !== undefined) timerRef(this.timer)
    return this
  }

  /**
   * Mark this watcher as not keeping its owner alive.
   * @returns This watcher.
   * @remarks 中文说明：功能说明：处理 unref 相关流程；使用场景由所在模块及调用位置决定。；返回值：this；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 unref()，并按返回类型处理结果。
   */
  unref(): this {
    this.referenced = false
    if (this.timer !== undefined) timerUnref(this.timer)
    return this
  }

  /**
   * Read the retained process-liveness flag.
   * @returns Whether this watcher is marked as keeping its owner alive.
   * @remarks 中文说明：功能说明：判断是否包含 Ref 相关流程；使用场景由所在模块及调用位置决定。；返回值：boolean；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 hasRef()，并按返回类型处理结果。
   */
  hasRef(): boolean {
    return this.referenced
  }

}

type RefTimer = { ref?: () => unknown; unref?: () => unknown }

/** Browser timers are numeric; Node timers expose optional liveness methods.
 * @remarks 中文说明：常量说明：timerRef 用于处理 timerRef 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。；功能说明：处理 timerRef 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：timer（ReturnType<typeof setTimeout>）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：void；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 timerRef(timer)，
 * 并按返回类型处理结果。 */
const timerRef = (timer: ReturnType<typeof setTimeout>): void => {
  ;(timer as unknown as RefTimer).ref?.()
}

/** Browser timers are numeric; Node timers expose optional liveness methods.
 * @remarks 中文说明：常量说明：timerUnref 用于处理 timerUnref 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。；功能说明：处理 timerUnref 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：timer（ReturnType<typeof setTimeout>）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：void；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * timerUnref(timer)，并按返回类型处理结果。 */
const timerUnref = (timer: ReturnType<typeof setTimeout>): void => {
  ;(timer as unknown as RefTimer).unref?.()
}

/**
 * 常量说明：statWatchers 用于处理 statWatchers 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const statWatchers = new Map<string, StatWatcher>()

/**
 * Register a stat-poll watcher for one path.
 * @param path - File or directory path, including a currently missing path.
 * @param optionsOrListener - Polling options or the change listener.
 * @param maybeListener - Change listener when the second argument carries options.
 * @returns The path's shared stat watcher.
 * @remarks 中文说明：功能说明：处理 watchFile 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：path（PathArg）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；
 * 参数说明：optionsOrListener（WatchFileOptions | StatListener）：提供本次操作使用的配置选项；
 * 必须满足声明的类型及调用时序要求。；参数说明：maybeListener（StatListener）：接收后续状态或事件并执行调用方逻辑；
 * 必须满足声明的类型及调用时序要求。；返回值：StatWatcher；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 watchFile(path, optionsOrListener, maybeListener)，
 * 并按返回类型处理结果。
 */
export function watchFile(
  path: PathArg,
  optionsOrListener: WatchFileOptions | StatListener,
  maybeListener?: StatListener,
): StatWatcher {
  /**
   * 常量说明：options 用于处理 options 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const options = typeof optionsOrListener === 'function' ? {} : optionsOrListener
  /**
   * 常量说明：listener 用于处理 listener 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const listener = typeof optionsOrListener === 'function' ? optionsOrListener : maybeListener
  if (listener === undefined) throw new TypeError('The "listener" argument must be of type function')
  /**
   * 常量说明：target 用于处理 target 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const target = asPath(path)
  /**
   * 变量说明：watcher 用于处理 watcher 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let watcher = statWatchers.get(target)
  if (watcher === undefined) {
    watcher = new StatWatcher(target, options)
    statWatchers.set(target, watcher)
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    watcher.once('stop', () => { statWatchers.delete(target) })
  }
  watcher.on('change', listener as (...args: unknown[]) => void)
  return watcher
}

/**
 * Remove one listener or every listener for a path.
 * @param path - Watched path.
 * @param listener - Specific registration to remove; omission removes all registrations.
 * @remarks 中文说明：功能说明：处理 unwatchFile 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：path（PathArg）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；
 * 参数说明：listener（StatListener）：接收后续状态或事件并执行调用方逻辑；必须满足声明的类型及调用时序要求。；返回值：void；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 unwatchFile(path,
 * listener)，并按返回类型处理结果。
 */
export function unwatchFile(path: PathArg, listener?: StatListener): void {
  /**
   * 常量说明：target 用于处理 target 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const target = asPath(path)
  /**
   * 常量说明：watcher 用于处理 watcher 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const watcher = statWatchers.get(target)
  if (watcher === undefined) return
  if (listener === undefined) watcher.removeAllListeners('change')
  else watcher.removeListener('change', listener as (...args: unknown[]) => void)
  if (watcher.listenerCount('change') === 0) watcher.stop()
}

/**
 * Create the promise-based watch iterator over the callback watcher.
 * @param path - File or directory path.
 * @param options - Watch options and cancellation signal.
 * @returns An iterator of change records that closes its watcher on return or failure.
 * @remarks 中文说明：功能说明：处理 watchAsync 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：path（PathArg）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；
 * 参数说明：options（WatchOptions）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。；
 * 返回值：AsyncIterableIterator<{ eventType: 'rename' | 'change'; filename:
 * str…；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 watchAsync(path,
 * options)，并按返回类型处理结果。
 */
export function watchAsync(
  path: PathArg,
  options: WatchOptions = {},
): AsyncIterableIterator<{ eventType: 'rename' | 'change'; filename: string | Buffer | null }> {
  type WatchEvent = { eventType: 'rename' | 'change'; filename: string | Buffer | null }
  type Waiting = {
    /**
     * 功能说明：解析 resolve 相关流程；使用场景由所在模块及调用位置决定。
     * @param result （IteratorResult<WatchEvent>）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
     * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 resolve(result)，并按返回类型处理结果。
     */
    resolve(result: IteratorResult<WatchEvent>): void
    /**
     * 功能说明：处理 reject 相关流程；使用场景由所在模块及调用位置决定。
     * @param reason （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
     * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 reject(reason)，并按返回类型处理结果。
     */
    reject(reason: unknown): void
  }
  /**
   * 常量说明：queued 用于处理 queued 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const queued: WatchEvent[] = []
  /**
   * 常量说明：waiting 用于处理 waiting 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const waiting: Waiting[] = []
  /**
   * 变量说明：watcher 用于处理 watcher 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let watcher: FSWatcher | undefined
  /**
   * 变量说明：failure 用于处理 failure 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let failure: Error | undefined
  /**
   * 变量说明：closed 用于处理 closed 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let closed = false

  /**
   * 常量说明：stopWatcher 用于停止 Watcher 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   * 功能说明：停止 Watcher 相关流程；使用场景由所在模块及调用位置决定。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 stopWatcher()，并按返回类型处理结果。
   */
  const stopWatcher = (): void => {
    options.signal?.removeEventListener('abort', onAbort)
    watcher?.close()
  }
  /**
   * 常量说明：settleFailure 用于处理 settleFailure 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   * 功能说明：处理 settleFailure 相关流程；使用场景由所在模块及调用位置决定。
   * @param reason （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 settleFailure(reason)，并按返回类型处理结果。
   */
  const settleFailure = (reason: unknown): void => {
    if (closed) return
    /**
     * 常量说明：error 用于处理 error 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const error = reason instanceof Error ? reason : new Error(String(reason))
    closed = true
    queued.length = 0
    stopWatcher()
    /**
     * 常量说明：failed 用于处理 failed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const failed = waiting.shift()
    if (failed === undefined) failure = error
    else failed.reject(error)
    /**
     * 变量说明：pending 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const pending of waiting.splice(0)) pending.resolve({ done: true, value: undefined })
  }
  /**
   * 常量说明：onAbort 用于响应 Abort 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   * 功能说明：响应 Abort 相关流程；使用场景由所在模块及调用位置决定。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 onAbort()，并按返回类型处理结果。
   */
  const onAbort = (): void => { settleFailure(abortError(options.signal?.reason)) }
  /**
   * 常量说明：start 用于启动 start 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   * 功能说明：启动 start 相关流程；使用场景由所在模块及调用位置决定。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 start()，并按返回类型处理结果。
   */
  const start = (): void => {
    if (watcher !== undefined || closed || failure !== undefined) return
    if (options.signal?.aborted === true) {
      settleFailure(abortError(options.signal.reason))
      return
    }
    /**
     * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
     */
    try {
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：eventType（由 TypeScript
       * 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；参数：filename（由 TypeScript
       * 根据调用位置推断的类型）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript
       * 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(eventType,
       * filename)，并按返回类型处理结果。
       */
      watcher = watch(path, options, (eventType, filename) => {
        /**
         * 常量说明：event 用于处理 event 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const event = { eventType, filename }
        /**
         * 常量说明：pending 用于处理 pending 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const pending = waiting.shift()
        if (pending === undefined) queued.push(event)
        else pending.resolve({ done: false, value: event })
      })
      watcher.on('error', settleFailure)
      options.signal?.addEventListener('abort', onAbort, { once: true })
    } catch (error) {
      settleFailure(error)
    }
  }
  /**
   * 常量说明：close 用于关闭 close 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   * 功能说明：关闭 close 相关流程；使用场景由所在模块及调用位置决定。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 close()，并按返回类型处理结果。
   */
  const close = (): void => {
    /**
     * 常量说明：alreadyClosed 用于处理 alreadyClosed 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const alreadyClosed = closed
    closed = true
    queued.length = 0
    failure = undefined
    if (!alreadyClosed) stopWatcher()
    /**
     * 变量说明：pending 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const pending of waiting.splice(0)) pending.resolve({ done: true, value: undefined })
  }

  return {
    /**
     * 功能说明：处理 [Symbol.asyncIterator] 相关流程；使用场景由所在模块及调用位置决定。
     * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 [Symbol.asyncIterator]()，并按返回类型处理结果。
     */
    [Symbol.asyncIterator]() {
      return this
    },
    /**
     * 功能说明：处理 next 相关流程；使用场景由所在模块及调用位置决定。
     * @returns Promise<IteratorResult<WatchEvent>>；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 next()，并按返回类型处理结果。
     */
    next(): Promise<IteratorResult<WatchEvent>> {
      start()
      if (failure !== undefined) {
        /**
         * 常量说明：reason 用于处理 reason 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const reason = failure
        failure = undefined
        return Promise.reject(reason)
      }
      /**
       * 常量说明：event 用于处理 event 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const event = queued.shift()
      if (event !== undefined) return Promise.resolve({ done: false, value: event })
      if (closed) return Promise.resolve({ done: true, value: undefined })
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolve（由 TypeScript
       * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：reject（由 TypeScript
       * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(resolve, reject)，
       * 并按返回类型处理结果。
       */
      return new Promise<IteratorResult<WatchEvent>>((resolve, reject) => { waiting.push({ resolve, reject }) })
    },
    /**
     * 功能说明：处理 return 相关流程；使用场景由所在模块及调用位置决定。
     * @returns Promise<IteratorResult<WatchEvent>>；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 return()，并按返回类型处理结果。
     */
    return(): Promise<IteratorResult<WatchEvent>> {
      close()
      return Promise.resolve({ done: true, value: undefined })
    },
    /**
     * 功能说明：处理 throw 相关流程；使用场景由所在模块及调用位置决定。
     * @param reason （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
     * @returns Promise<IteratorResult<WatchEvent>>；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 throw(reason)，并按返回类型处理结果。
     */
    throw(reason?: unknown): Promise<IteratorResult<WatchEvent>> {
      close()
      // AsyncIterator.throw forwards the caller's exact reason, including non-Error values.
      // oxlint-disable-next-line typescript/prefer-promise-reject-errors
      return Promise.reject(reason)
    },
  }
}
