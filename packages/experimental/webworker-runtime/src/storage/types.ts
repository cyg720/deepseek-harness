/**
 * Filesystem interfaces shared by every VFS backend. The shipped implementation
 * is in memory; browser persistence hydrates it and consumes its committed
 * mutation stream. Errors carry Node's `code` values because roster plugins
 * branch on them (`ENOENT` for optional files, `EACCES` for read-only trees).
 * @module @deepseek-ai/dsh-experimental-webworker-runtime/src/storage/types
 */

/** Encodings the VFS accepts where Node accepts any `BufferEncoding`.
 * @remarks 文件说明：文件职责：实现 experimental/webworker-runtime 中 types 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/webworker-runtime 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 →
 * 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。 */
export type VfsEncoding = 'utf8' | 'utf-8'

/** Read options accepted by both the sync and promise faces. */
export type VfsReadOptions = VfsEncoding | { encoding?: VfsEncoding | null } | null | undefined

/** Node-compatible error with a `code`, as roster plugins expect. */
export interface VfsError extends Error {
  code: string
  path: string
  syscall: string
}

/** Subset of `fs.Stats` the roster reads. */
export interface VfsStats {
  readonly size: number
  /** Stable file identity across rename and hard links; recreation receives another value. */
  readonly ino: number
  readonly mtimeMs: number
  readonly ctimeMs: number
  readonly atimeMs: number
  readonly birthtimeMs: number
  readonly mtime: Date
  readonly mode: number
  /**
   * 功能说明：判断是否为 File 相关流程；使用场景由所在模块及调用位置决定。
   * @returns boolean；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 isFile()，并按返回类型处理结果。
   */
  isFile(): boolean
  /**
   * 功能说明：判断是否为 Directory 相关流程；使用场景由所在模块及调用位置决定。
   * @returns boolean；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 isDirectory()，并按返回类型处理结果。
   */
  isDirectory(): boolean
  /**
   * 功能说明：判断是否为 Symbolic Link 相关流程；使用场景由所在模块及调用位置决定。
   * @returns boolean；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 isSymbolicLink()，并按返回类型处理结果。
   */
  isSymbolicLink(): boolean
  /**
   * 功能说明：判断是否为 FIFO 相关流程；使用场景由所在模块及调用位置决定。
   * @returns boolean；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 isFIFO()，并按返回类型处理结果。
   */
  isFIFO(): boolean
  /**
   * 功能说明：判断是否为 Socket 相关流程；使用场景由所在模块及调用位置决定。
   * @returns boolean；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 isSocket()，并按返回类型处理结果。
   */
  isSocket(): boolean
  /**
   * 功能说明：判断是否为 Block Device 相关流程；使用场景由所在模块及调用位置决定。
   * @returns boolean；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 isBlockDevice()，并按返回类型处理结果。
   */
  isBlockDevice(): boolean
  /**
   * 功能说明：判断是否为 Character Device 相关流程；使用场景由所在模块及调用位置决定。
   * @returns boolean；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 isCharacterDevice()，并按返回类型处理结果。
   */
  isCharacterDevice(): boolean
}

/**
 * Stats as Node returns them under `{ bigint: true }`.
 *
 * The filesystem service (`dsh-fs-local`) stats every target this way and then
 * does BigInt arithmetic on `mode` and builds its version token from
 * `dev:ino:size:mtimeNs:ctimeNs`, so these fields are load-bearing rather than
 * decorative: a number-valued `mode` here fails the whole read as a type error,
 * and a constant `ino`/`mtimeNs` would make the service's stale-write guard
 * unable to tell two revisions apart.
 */
export interface VfsBigIntStats {
  readonly size: bigint
  readonly mode: bigint
  /** One virtual device holds the whole image. */
  readonly dev: bigint
  /** File identity retained across rename and hard links; recreation gets a new one. */
  readonly ino: bigint
  readonly nlink: bigint
  readonly mtimeMs: bigint
  readonly mtimeNs: bigint
  readonly ctimeMs: bigint
  readonly ctimeNs: bigint
  readonly atimeMs: bigint
  readonly atimeNs: bigint
  readonly birthtimeMs: bigint
  readonly birthtimeNs: bigint
  readonly mtime: Date
  readonly ctime: Date
  readonly atime: Date
  readonly birthtime: Date
  /**
   * 功能说明：判断是否为 File 相关流程；使用场景由所在模块及调用位置决定。
   * @returns boolean；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 isFile()，并按返回类型处理结果。
   */
  isFile(): boolean
  /**
   * 功能说明：判断是否为 Directory 相关流程；使用场景由所在模块及调用位置决定。
   * @returns boolean；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 isDirectory()，并按返回类型处理结果。
   */
  isDirectory(): boolean
  /**
   * 功能说明：判断是否为 Symbolic Link 相关流程；使用场景由所在模块及调用位置决定。
   * @returns boolean；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 isSymbolicLink()，并按返回类型处理结果。
   */
  isSymbolicLink(): boolean
  /**
   * 功能说明：判断是否为 FIFO 相关流程；使用场景由所在模块及调用位置决定。
   * @returns boolean；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 isFIFO()，并按返回类型处理结果。
   */
  isFIFO(): boolean
  /**
   * 功能说明：判断是否为 Socket 相关流程；使用场景由所在模块及调用位置决定。
   * @returns boolean；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 isSocket()，并按返回类型处理结果。
   */
  isSocket(): boolean
  /**
   * 功能说明：判断是否为 Block Device 相关流程；使用场景由所在模块及调用位置决定。
   * @returns boolean；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 isBlockDevice()，并按返回类型处理结果。
   */
  isBlockDevice(): boolean
  /**
   * 功能说明：判断是否为 Character Device 相关流程；使用场景由所在模块及调用位置决定。
   * @returns boolean；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 isCharacterDevice()，并按返回类型处理结果。
   */
  isCharacterDevice(): boolean
}

/** Stat option Node reads; `bigint` selects {@link VfsBigIntStats}. */
export interface VfsStatOptions {
  readonly bigint?: boolean
}

/** Write options the roster passes; `flag` decides create and truncate behavior. */
export interface VfsWriteOptions {
  readonly encoding?: VfsEncoding | null
  readonly mode?: number
  readonly flag?: string
}

/** Explicit metadata for image or durable-store hydration. */
export interface VfsSeedOptions {
  readonly mode?: number
  readonly mtimeMs?: number
}

/** Directory entry as `readdir` with `withFileTypes` reports it. */
export interface VfsDirent {
  readonly name: string
  readonly parentPath: string
  /**
   * 功能说明：判断是否为 File 相关流程；使用场景由所在模块及调用位置决定。
   * @returns boolean；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 isFile()，并按返回类型处理结果。
   */
  isFile(): boolean
  /**
   * 功能说明：判断是否为 Directory 相关流程；使用场景由所在模块及调用位置决定。
   * @returns boolean；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 isDirectory()，并按返回类型处理结果。
   */
  isDirectory(): boolean
  /**
   * 功能说明：判断是否为 Symbolic Link 相关流程；使用场景由所在模块及调用位置决定。
   * @returns boolean；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 isSymbolicLink()，并按返回类型处理结果。
   */
  isSymbolicLink(): boolean
}

/** Directory handle returned by `opendir`; consumers only enumerate and close. */
/**
 * 功能说明：判断是否为 File 相关流程；使用场景由所在模块及调用位置决定。
 * @returns boolean；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 isFile()，并按返回类型处理结果。
 */
/**
 * 功能说明：判断是否为 Directory 相关流程；使用场景由所在模块及调用位置决定。
 * @returns boolean；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 isDirectory()，并按返回类型处理结果。
 */
export interface VfsDir {
  readonly path: string
  /**
   * 功能说明：关闭 close 相关流程；使用场景由所在模块及调用位置决定。
   * @returns Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 close()，并按返回类型处理结果。
   */
  close(): Promise<void>
  /**
   * 功能说明：读取 read 相关流程；使用场景由所在模块及调用位置决定。
   * @returns Promise<{ name: string } | null>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 read()，并按返回类型处理结果。
   */
  read(): Promise<{ name: string } | null>
  /**
   * 功能说明：处理 [Symbol.asyncIterator] 相关流程；使用场景由所在模块及调用位置决定。
   * @returns AsyncGenerator<{ name: string; isFile(): boolean;
   * isDirectory(): bool…；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 [Symbol.asyncIterator]()，并按返回类型处理结果。
   */
  [Symbol.asyncIterator](): AsyncGenerator<{ name: string; isFile(): boolean; isDirectory(): boolean }>
}

/** File handle returned by `open`; the roster writes, syncs, and closes. */
export interface VfsFileHandle {
  /**
   * 功能说明：写入 write 相关流程；使用场景由所在模块及调用位置决定。
   * @param data （string | Uint8Array）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns Promise<{ bytesWritten: number }>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 write(data)，并按返回类型处理结果。
   */
  write(data: string | Uint8Array): Promise<{ bytesWritten: number }>
  /**
   * 功能说明：写入 File 相关流程；使用场景由所在模块及调用位置决定。
   * @param data （string | Uint8Array）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 writeFile(data)，并按返回类型处理结果。
   */
  writeFile(data: string | Uint8Array): Promise<void>
  /**
   * 功能说明：读取 File 相关流程；使用场景由所在模块及调用位置决定。
   * @param options （VfsReadOptions）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。
   * @returns Promise<string | Uint8Array>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 readFile(options)，并按返回类型处理结果。
   */
  readFile(options?: VfsReadOptions): Promise<string | Uint8Array>
  /**
   * 功能说明：处理 truncate 相关流程；使用场景由所在模块及调用位置决定。
   * @param length （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 truncate(length)，并按返回类型处理结果。
   */
  truncate(length?: number): Promise<void>
  /**
   * 功能说明：处理 stat 相关流程；使用场景由所在模块及调用位置决定。
   * @returns Promise<VfsStats>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 stat()，并按返回类型处理结果。
   */
  stat(): Promise<VfsStats>
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

/** Open-file identity used by synchronous Node-style descriptors. */
export interface VfsOpenFile {
  /** Whether reads are allowed by the flags used at open time. */
  readonly readable: boolean
  /** Whether writes and truncation are allowed by the flags used at open time. */
  readonly writable: boolean
  /** Whether each write targets the current end of the opened file. */
  readonly append: boolean
  /**
   * Read bytes from the opened file identity.
   * @param position - Absolute byte offset.
   * @param length - Maximum byte count.
   * @returns A view of the available bytes.
   * @remarks 中文说明：功能说明：读取 read 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：position（number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：length（number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：Uint8Array；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 read(position, length)，
   * 并按返回类型处理结果。
   */
  read(position: number, length: number): Uint8Array
  /**
   * Write bytes to the opened file identity.
   * @param position - Absolute byte offset, ignored for append descriptors.
   * @param data - Bytes to write.
   * @returns Number of bytes written.
   * @remarks 中文说明：功能说明：写入 write 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：position（number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：data（Uint8Array）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：number；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 write(position, data)，
   * 并按返回类型处理结果。
   */
  write(position: number, data: Uint8Array): number
  /**
   * Resize the opened file, zero-filling growth.
   * @param length - Target byte length.
   * @remarks 中文说明：功能说明：处理 truncate 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：length（number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 truncate(length)，并按返回类型处理结果。
   */
  truncate(length: number): void
  /**
   * Read metadata from the opened file identity.
   * @returns Current file metadata, including after rename or unlink.
   * @remarks 中文说明：功能说明：处理 stat 相关流程；使用场景由所在模块及调用位置决定。；返回值：VfsStats；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 stat()，并按返回类型处理结果。
   */
  stat(): VfsStats
}

/**
 * One completed change to the authoritative in-memory filesystem.
 *
 * A durable mirror receives the post-write bytes, virtual permission bits, and optional append offset;
 * live watchers use `entryChanged` to distinguish directory-entry replacement
 * from content writes. Rename is represented as source removal plus complete
 * destination mkdir/write records, so a sink never receives a path without the
 * state needed to materialize it.
 */
export type VfsMutation =
  | {
    readonly kind: 'write'
    readonly path: string
    readonly bytes: Uint8Array
    readonly mode: number
    readonly entryChanged: boolean
    readonly appendedFrom?: number
  }
  | { readonly kind: 'mkdir'; readonly path: string; readonly mode: number }
  | { readonly kind: 'remove'; readonly path: string }
  | { readonly kind: 'chmod'; readonly path: string; readonly mode: number }

/** Receives one committed VFS mutation. */
export type VfsMutationListener = (mutation: VfsMutation) => void

/** Durable observer attached to the synchronous VFS. */
export interface VfsMutationSink {
  /**
   * Record one completed mutation without delaying its caller.
   * @param mutation - Post-commit state to mirror.
   * @remarks 中文说明：功能说明：处理 record 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：mutation（VfsMutation）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 record(mutation)，
   * 并按返回类型处理结果。
   */
  record(mutation: VfsMutation): void
  /**
   * Settle all previously recorded mutations.
   * Implementations report persistence failures and stop mirroring rather than
   * rejecting, because the in-memory mutation has already committed.
   * @returns A promise that resolves when the sink has no pending work.
   * @remarks 中文说明：功能说明：处理 flush 相关流程；使用场景由所在模块及调用位置决定。；返回值：Promise<void>；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 flush()，并按返回类型处理结果。
   */
  flush(): Promise<void>
}

/** Synchronous filesystem used by the worker's Node compatibility modules. */
export interface Vfs {
  readonly promises: {
    /**
     * 功能说明：读取 File 相关流程；使用场景由所在模块及调用位置决定。
     * @param path （string）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。
     * @param options （VfsReadOptions）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。
     * @returns Promise<string | Uint8Array>；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 readFile(path, options)，并按返回类型处理结果。
     */
    readFile(path: string, options?: VfsReadOptions): Promise<string | Uint8Array>
    /**
     * 功能说明：写入 File 相关流程；使用场景由所在模块及调用位置决定。
     * @param path （string）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。
     * @param data （string | Uint8Array）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
     * @param options （VfsWriteOptions）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。
     * @returns Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 writeFile(path, data, options)，并按返回类型处理结果。
     */
    writeFile(path: string, data: string | Uint8Array, options?: VfsWriteOptions): Promise<void>
    /**
     * 功能说明：处理 appendFile 相关流程；使用场景由所在模块及调用位置决定。
     * @param path （string）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。
     * @param data （string | Uint8Array）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
     * @returns Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 appendFile(path, data)，并按返回类型处理结果。
     */
    appendFile(path: string, data: string | Uint8Array): Promise<void>
    /**
     * 功能说明：处理 mkdir 相关流程；使用场景由所在模块及调用位置决定。
     * @param path （string）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。
     * @param options （{ recursive?: boolean; mode?: number }）：提供本次操作使用的配置选项；
     * 必须满足声明的类型及调用时序要求。
     * @returns Promise<string | undefined>；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 mkdir(path, options)，并按返回类型处理结果。
     */
    mkdir(path: string, options?: { recursive?: boolean; mode?: number }): Promise<string | undefined>
    /**
     * 功能说明：处理 readdir 相关流程；使用场景由所在模块及调用位置决定。
     * @param path （string）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。
     * @param options （{ withFileTypes?: boolean }）：提供本次操作使用的配置选项；
     * 必须满足声明的类型及调用时序要求。
     * @returns Promise<string[] & VfsDirent[]>；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 readdir(path, options)，并按返回类型处理结果。
     */
    readdir(path: string, options?: { withFileTypes?: boolean }): Promise<string[] & VfsDirent[]>
    /**
     * 功能说明：处理 stat 相关流程；使用场景由所在模块及调用位置决定。
     * @param path （string）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。
     * @param options （VfsStatOptions）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。
     * @returns Promise<VfsStats | VfsBigIntStats>；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 stat(path, options)，并按返回类型处理结果。
     */
    stat(path: string, options?: VfsStatOptions): Promise<VfsStats | VfsBigIntStats>
    /**
     * 功能说明：处理 lstat 相关流程；使用场景由所在模块及调用位置决定。
     * @param path （string）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。
     * @param options （VfsStatOptions）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。
     * @returns Promise<VfsStats | VfsBigIntStats>；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 lstat(path, options)，并按返回类型处理结果。
     */
    lstat(path: string, options?: VfsStatOptions): Promise<VfsStats | VfsBigIntStats>
    /**
     * 功能说明：处理 realpath 相关流程；使用场景由所在模块及调用位置决定。
     * @param path （string）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。
     * @returns Promise<string>；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 realpath(path)，并按返回类型处理结果。
     */
    realpath(path: string): Promise<string>
    /**
     * 功能说明：处理 rename 相关流程；使用场景由所在模块及调用位置决定。
     * @param from （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
     * @param to （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
     * @returns Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 rename(from, to)，并按返回类型处理结果。
     */
    rename(from: string, to: string): Promise<void>
    /**
     * 功能说明：处理 unlink 相关流程；使用场景由所在模块及调用位置决定。
     * @param path （string）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。
     * @returns Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 unlink(path)，并按返回类型处理结果。
     */
    unlink(path: string): Promise<void>
    /**
     * 功能说明：处理 rm 相关流程；使用场景由所在模块及调用位置决定。
     * @param path （string）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。
     * @param options （{ recursive?: boolean; force?: boolean }）：提供本次操作使用的配置选项；
     * 必须满足声明的类型及调用时序要求。
     * @returns Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 rm(path, options)，并按返回类型处理结果。
     */
    rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>
    /**
     * 功能说明：处理 mkdtemp 相关流程；使用场景由所在模块及调用位置决定。
     * @param prefix （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
     * @returns Promise<string>；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 mkdtemp(prefix)，并按返回类型处理结果。
     */
    mkdtemp(prefix: string): Promise<string>
    /**
     * 功能说明：处理 link 相关流程；使用场景由所在模块及调用位置决定。
     * @param existing （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
     * @param next （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
     * @returns Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 link(existing, next)，并按返回类型处理结果。
     */
    link(existing: string, next: string): Promise<void>
    /**
     * 功能说明：处理 truncate 相关流程；使用场景由所在模块及调用位置决定。
     * @param path （string）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。
     * @param length （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
     * @returns Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 truncate(path, length)，并按返回类型处理结果。
     */
    truncate(path: string, length?: number): Promise<void>
    /**
     * 功能说明：处理 chmod 相关流程；使用场景由所在模块及调用位置决定。
     * @param path （string）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。
     * @param mode （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
     * @returns Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 chmod(path, mode)，并按返回类型处理结果。
     */
    chmod(path: string, mode: number): Promise<void>
    /**
     * 功能说明：处理 opendir 相关流程；使用场景由所在模块及调用位置决定。
     * @param path （string）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。
     * @returns Promise<VfsDir>；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 opendir(path)，并按返回类型处理结果。
     */
    opendir(path: string): Promise<VfsDir>
    /**
     * 功能说明：打开 open 相关流程；使用场景由所在模块及调用位置决定。
     * @param path （string）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。
     * @param flags （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
     * @param mode （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
     * @returns Promise<VfsFileHandle>；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 open(path, flags, mode)，并按返回类型处理结果。
     */
    open(path: string, flags?: string, mode?: number): Promise<VfsFileHandle>
    /**
     * 功能说明：处理 access 相关流程；使用场景由所在模块及调用位置决定。
     * @param path （string）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。
     * @returns Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 access(path)，并按返回类型处理结果。
     */
    access(path: string): Promise<void>
  }
  /**
   * 功能说明：读取 File Sync 相关流程；使用场景由所在模块及调用位置决定。
   * @param path （string）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。
   * @param options （VfsReadOptions）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。
   * @returns string | Uint8Array；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 readFileSync(path, options)，并按返回类型处理结果。
   */
  readFileSync(path: string, options?: VfsReadOptions): string | Uint8Array
  /**
   * 功能说明：处理 existsSync 相关流程；使用场景由所在模块及调用位置决定。
   * @param path （string）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。
   * @returns boolean；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 existsSync(path)，并按返回类型处理结果。
   */
  existsSync(path: string): boolean
  /**
   * 功能说明：处理 statSync 相关流程；使用场景由所在模块及调用位置决定。
   * @param path （string）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。
   * @param options （VfsStatOptions）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。
   * @returns VfsStats | VfsBigIntStats；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 statSync(path, options)，并按返回类型处理结果。
   */
  statSync(path: string, options?: VfsStatOptions): VfsStats | VfsBigIntStats
  /**
   * 功能说明：处理 readdirSync 相关流程；使用场景由所在模块及调用位置决定。
   * @param path （string）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。
   * @param options （{ withFileTypes?: boolean }）：提供本次操作使用的配置选项；
   * 必须满足声明的类型及调用时序要求。
   * @returns string[] & VfsDirent[]；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 readdirSync(path, options)，并按返回类型处理结果。
   */
  readdirSync(path: string, options?: { withFileTypes?: boolean }): string[] & VfsDirent[]
  /**
   * 功能说明：处理 realpathSync 相关流程；使用场景由所在模块及调用位置决定。
   * @param path （string）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。
   * @returns string；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 realpathSync(path)，并按返回类型处理结果。
   */
  realpathSync(path: string): string
  /**
   * 功能说明：处理 mkdirSync 相关流程；使用场景由所在模块及调用位置决定。
   * @param path （string）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。
   * @param options （{ recursive?: boolean; mode?: number }）：提供本次操作使用的配置选项；
   * 必须满足声明的类型及调用时序要求。
   * @returns string | undefined；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 mkdirSync(path, options)，并按返回类型处理结果。
   */
  mkdirSync(path: string, options?: { recursive?: boolean; mode?: number }): string | undefined
  /**
   * 功能说明：写入 File Sync 相关流程；使用场景由所在模块及调用位置决定。
   * @param path （string）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。
   * @param data （string | Uint8Array）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param options （VfsWriteOptions）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 writeFileSync(path, data, options)，并按返回类型处理结果。
   */
  writeFileSync(path: string, data: string | Uint8Array, options?: VfsWriteOptions): void
  /**
   * 功能说明：处理 appendFileSync 相关流程；使用场景由所在模块及调用位置决定。
   * @param path （string）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。
   * @param data （string | Uint8Array）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 appendFileSync(path, data)，并按返回类型处理结果。
   */
  appendFileSync(path: string, data: string | Uint8Array): void
  /**
   * 功能说明：处理 renameSync 相关流程；使用场景由所在模块及调用位置决定。
   * @param from （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param to （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 renameSync(from, to)，并按返回类型处理结果。
   */
  renameSync(from: string, to: string): void
  /**
   * 功能说明：处理 linkSync 相关流程；使用场景由所在模块及调用位置决定。
   * @param existing （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param next （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 linkSync(existing, next)，并按返回类型处理结果。
   */
  linkSync(existing: string, next: string): void
  /**
   * 功能说明：处理 truncateSync 相关流程；使用场景由所在模块及调用位置决定。
   * @param path （string）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。
   * @param length （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 truncateSync(path, length)，并按返回类型处理结果。
   */
  truncateSync(path: string, length?: number): void
  /**
   * 功能说明：处理 chmodSync 相关流程；使用场景由所在模块及调用位置决定。
   * @param path （string）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。
   * @param mode （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 chmodSync(path, mode)，并按返回类型处理结果。
   */
  chmodSync(path: string, mode: number): void
  /**
   * 功能说明：处理 unlinkSync 相关流程；使用场景由所在模块及调用位置决定。
   * @param path （string）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 unlinkSync(path)，并按返回类型处理结果。
   */
  unlinkSync(path: string): void
  /**
   * 功能说明：处理 rmSync 相关流程；使用场景由所在模块及调用位置决定。
   * @param path （string）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。
   * @param options （{ recursive?: boolean; force?: boolean }）：提供本次操作使用的配置选项；
   * 必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 rmSync(path, options)，并按返回类型处理结果。
   */
  rmSync(path: string, options?: { recursive?: boolean; force?: boolean }): void
  /**
   * 功能说明：处理 mkdtempSync 相关流程；使用场景由所在模块及调用位置决定。
   * @param prefix （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns string；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 mkdtempSync(prefix)，并按返回类型处理结果。
   */
  mkdtempSync(prefix: string): string
  /** Open and retain one file identity until its Node descriptor closes.
   * @remarks 中文说明：功能说明：打开 File Sync 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：path（string）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；
   * 参数说明：flags（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：mode（number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：VfsOpenFile；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 openFileSync(path, flags,
   * mode)，并按返回类型处理结果。 */
  openFileSync(path: string, flags?: string, mode?: number): VfsOpenFile
  /**
   * 功能说明：处理 seed 相关流程；使用场景由所在模块及调用位置决定。
   * @param path （string）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。
   * @param data （string | Uint8Array）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param options （VfsSeedOptions）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 seed(path, data, options)，并按返回类型处理结果。
   */
  seed(path: string, data: string | Uint8Array, options?: VfsSeedOptions): void
  /**
   * 功能说明：处理 seedDirectory 相关流程；使用场景由所在模块及调用位置决定。
   * @param path （string）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。
   * @param options （VfsSeedOptions）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 seedDirectory(path, options)，并按返回类型处理结果。
   */
  seedDirectory(path: string, options?: VfsSeedOptions): void
  /**
   * 功能说明：处理 usage 相关流程；使用场景由所在模块及调用位置决定。
   * @returns { files: number; directories: number; bytes: number }；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 usage()，并按返回类型处理结果。
   */
  usage(): { files: number; directories: number; bytes: number }
  /** Register one observer and return its synchronous disposer.
   * @remarks 中文说明：功能说明：处理 subscribe 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：listener（VfsMutationListener）：接收后续状态或事件并执行调用方逻辑；必须满足声明的类型及调用时序要求。；
   * 返回值：() => void；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * subscribe(listener)，并按返回类型处理结果。 */
  subscribe(listener: VfsMutationListener): () => void
  /** Settle the attached durable mutation sink, if any.
   * @remarks 中文说明：功能说明：处理 flush 相关流程；使用场景由所在模块及调用位置决定。；返回值：Promise<void>；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 flush()，并按返回类型处理结果。 */
  flush(): Promise<void>
}
