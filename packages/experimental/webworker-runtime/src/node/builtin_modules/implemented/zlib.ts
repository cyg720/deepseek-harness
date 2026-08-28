/**
 * `node:zlib` for the worker. The worker composition carries no compression
 * codec: the boot patch forces the JSONL session backend onto its plaintext
 * path (`compression: 'none'`), because the VFS is in-memory and compressing
 * it buys nothing. The Zstandard surface keeps its module-scope shape — the
 * backend reads `constants` and `promisify`s the callback forms while
 * loading — and every codec call fails loud, naming the missing capability.
 *
 * `createZstdDecompress` returns a handle-less object on purpose: the backend
 * probes for Node's private stream shape and falls back to its public one-shot
 * decoder when the probe declines.
 * @remarks 文件说明：文件职责：实现 experimental/webworker-runtime 中 zlib 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/webworker-runtime 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 →
 * 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。
 */
import { notImplementedFail } from '../../notImplementedFail.ts'

/**
 * 常量说明：MODULE 用于处理 MODULE 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const MODULE = 'node:zlib'

/** Zstandard parameter/flush constants read at module scope by the JSONL backend.
 * @remarks 中文说明：常量说明：constants 用于处理 constants 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
export const constants = {
  ZSTD_c_compressionLevel: 100,
  ZSTD_c_checksumFlag: 201,
  ZSTD_e_continue: 0,
  ZSTD_e_flush: 1,
  ZSTD_e_end: 2,
  ZSTD_CLEVEL_DEFAULT: 3,
  Z_NO_FLUSH: 0,
  Z_SYNC_FLUSH: 2,
  Z_FINISH: 4,
}

/** One-shot Zstandard compression (unavailable; the composition writes plaintext logs).
 * @remarks 中文说明：常量说明：zstdCompressSync 用于处理 zstdCompressSync 相关数据，作用于当前作用域；
 * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
export const zstdCompressSync: typeof import('node:zlib').zstdCompressSync = notImplementedFail(MODULE, 'zstdCompressSync')

/** One-shot Zstandard decompression (unavailable; the worker never reads compressed logs).
 * @remarks 中文说明：常量说明：zstdDecompressSync 用于处理 zstdDecompressSync 相关数据，
 * 作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
export const zstdDecompressSync: typeof import('node:zlib').zstdDecompressSync
  = notImplementedFail(MODULE, 'zstdDecompressSync')

/** Callback form of {@link zstdCompressSync} (`promisify`'d at module scope by the backend).
 * @remarks 中文说明：常量说明：zstdCompress 用于处理 zstdCompress 相关数据，作用于当前作用域；
 * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
export const zstdCompress: typeof import('node:zlib').zstdCompress = notImplementedFail(MODULE, 'zstdCompress')

/** Callback form of {@link zstdDecompressSync}.
 * @remarks 中文说明：常量说明：zstdDecompress 用于处理 zstdDecompress 相关数据，作用于当前作用域；
 * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
export const zstdDecompress: typeof import('node:zlib').zstdDecompress = notImplementedFail(MODULE, 'zstdDecompress')

/**
 * Streaming Zstandard decoder placeholder: the returned object deliberately
 * lacks Node's private `_handle`/`_writeState` members, which is the signal the
 * backend's private-shape probe checks before choosing that path.
 * @returns the incompatible placeholder stream.
 * @remarks 中文说明：功能说明：创建 Zstd Decompress 相关流程；使用场景由所在模块及调用位置决定。；
 * 返回值：Record<string, unknown>；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 createZstdDecompress()，并按返回类型处理结果。
 */
export function createZstdDecompress(): Record<string, unknown> {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  return { close: () => { /* nothing was opened */ } }
}

/** Streaming Zstandard encoder (unavailable; the backend only needs one-shot).
 * @remarks 中文说明：常量说明：createZstdCompress 用于创建 Zstd Compress 相关数据，作用于当前作用域；
 * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
export const createZstdCompress: typeof import('node:zlib').createZstdCompress
  = notImplementedFail(MODULE, 'createZstdCompress')

/** gzip family (unavailable; no consumer in the reachable tree).
 * @remarks 中文说明：常量说明：gzip 用于处理 gzip 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
export const gzip: typeof import('node:zlib').gzip = notImplementedFail(MODULE, 'gzip')

/** gzip sync counterpart.
 * @remarks 中文说明：常量说明：gzipSync 用于处理 gzipSync 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
export const gzipSync: typeof import('node:zlib').gzipSync = notImplementedFail(MODULE, 'gzipSync')

/** gunzip counterpart.
 * @remarks 中文说明：常量说明：gunzip 用于处理 gunzip 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
export const gunzip: typeof import('node:zlib').gunzip = notImplementedFail(MODULE, 'gunzip')

/** gunzip sync counterpart.
 * @remarks 中文说明：常量说明：gunzipSync 用于处理 gunzipSync 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
export const gunzipSync: typeof import('node:zlib').gunzipSync = notImplementedFail(MODULE, 'gunzipSync')

/** CommonJS interop marker: the worker loader hands `default` to default imports (see ./builtins.ts).
 * @remarks 中文说明：常量说明：__esModule 用于处理 __esModule 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
export const __esModule = true

/**
 * The `node:zlib` declarations this module stands in for. Two members keep this
 * module's own types: `constants` carries only the Zstandard and flush values the
 * JSONL backend reads, and `createZstdDecompress` answers the placeholder the
 * same backend's private-shape probe must decline.
 */
type NodeFace = Partial<Omit<typeof import('node:zlib'), 'constants' | 'createZstdDecompress'>>
  & Record<'constants' | 'createZstdDecompress', unknown>

/** CommonJS default export: the members `require()` hands a caller of this module. */
export default {
  constants, zstdCompress, zstdCompressSync, zstdDecompress, zstdDecompressSync,
  createZstdCompress, createZstdDecompress, gzip, gzipSync, gunzip, gunzipSync,
} satisfies NodeFace
