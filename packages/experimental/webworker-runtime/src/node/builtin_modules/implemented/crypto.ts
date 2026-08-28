/**
 * `node:crypto` for the worker: WebCrypto for randomness, `@noble/hashes` for the
 * synchronous digests Node's streaming Hash object provides (SubtleCrypto is
 * async, and every caller here hashes synchronously).
 * @remarks 文件说明：文件职责：实现 experimental/webworker-runtime 中 crypto 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/webworker-runtime 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 →
 * 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。
 */
import { sha1 } from '@noble/hashes/legacy.js'
import { sha256, sha512 } from '@noble/hashes/sha2.js'
import { randomUUID as mintUUID } from '@deepseek-ai/dsh-util-crypto'
import { Buffer } from 'buffer'

type Hasher = (input: Uint8Array) => Uint8Array

/**
 * 常量说明：HASHERS 用于处理 HASHERS 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const HASHERS: Record<string, Hasher> = {
  sha1,
  sha256,
  sha512,
}

/**
 * 常量说明：encoder 用于处理 encoder 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const encoder = new TextEncoder()

/**
 * 常量说明：toBytes 用于处理 toBytes 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 * 功能说明：处理 toBytes 相关流程；使用场景由所在模块及调用位置决定。
 * @param data （string | Uint8Array | ArrayBuffer）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。
 * @returns Uint8Array；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 toBytes(data)，并按返回类型处理结果。
 */
const toBytes = (data: string | Uint8Array | ArrayBuffer): Uint8Array => {
  if (typeof data === 'string') return encoder.encode(data)
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  return data
}

/** Node's streaming Hash face, restricted to the update/digest pair in use. */
export interface Hash {
  /**
   * 功能说明：更新 update 相关流程；使用场景由所在模块及调用位置决定。
   * @param data （string | Uint8Array | ArrayBuffer）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。
   * @param encoding （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns Hash；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 update(data, encoding)，并按返回类型处理结果。
   */
  update(data: string | Uint8Array | ArrayBuffer, encoding?: string): Hash
  /**
   * 功能说明：处理 digest 相关流程；使用场景由所在模块及调用位置决定。
   * @returns Buffer；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 digest()，并按返回类型处理结果。
   */
  digest(): Buffer
  /**
   * 功能说明：处理 digest 相关流程；使用场景由所在模块及调用位置决定。
   * @param encoding （'hex' | 'base64'）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns string；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 digest(encoding)，并按返回类型处理结果。
   */
  digest(encoding: 'hex' | 'base64'): string
}

/**
 * Create a synchronous hash object.
 * @param algorithm - digest name; only the algorithms the host tree uses exist.
 * @returns the streaming hash face.
 * @remarks 中文说明：功能说明：创建 Hash 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：algorithm（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：Hash；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 createHash(algorithm)，
 * 并按返回类型处理结果。
 */
export function createHash(algorithm: string): Hash {
  /**
   * 常量说明：hasher 用于处理 hasher 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const hasher = HASHERS[algorithm.toLowerCase().replace('-', '')]
  if (hasher === undefined) {
    throw new Error(`web-preview: node:crypto.createHash("${algorithm}") is not available in the worker host`)
  }
  /**
   * 常量说明：chunks 用于处理 chunks 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const chunks: Uint8Array[] = []
  /**
   * 常量说明：hash 用于处理 hash 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const hash: Hash = {
    /**
     * 功能说明：更新 update 相关流程；使用场景由所在模块及调用位置决定。
     * @param data （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
     * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 update(data)，并按返回类型处理结果。
     */
    update(data) {
      chunks.push(toBytes(data))
      return hash
    },
    /**
     * 功能说明：处理 digest 相关流程；使用场景由所在模块及调用位置决定。
     * @param encoding （'hex' | 'base64'）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
     * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 digest(encoding)，并按返回类型处理结果。
     */
    digest(encoding?: 'hex' | 'base64') {
      /**
       * 常量说明：total 用于处理 total 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：sum（由 TypeScript
       * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：chunk（由 TypeScript
       * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(sum, chunk)，并按返回类型处理结果。
       */
      const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0)
      /**
       * 常量说明：joined 用于处理 joined 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const joined = new Uint8Array(total)
      /**
       * 变量说明：at 用于处理 at 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
       */
      let at = 0
      /**
       * 变量说明：chunk 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
       */
      for (const chunk of chunks) {
        joined.set(chunk, at)
        at += chunk.byteLength
      }
      /**
       * 常量说明：digest 用于处理 digest 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const digest = Buffer.from(hasher(joined))
      return (encoding === undefined ? digest : digest.toString(encoding)) as Buffer & string
    },
  }
  return hash
}

/**
 * Random bytes.
 * @param size - byte count.
 * @returns a Buffer of cryptographically strong random bytes.
 * @remarks 中文说明：功能说明：处理 randomBytes 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：size（number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：Buffer<ArrayBuffer>；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 randomBytes(size)，
 * 并按返回类型处理结果。
 */
export function randomBytes(size: number): Buffer<ArrayBuffer> {
  /**
   * 常量说明：bytes 用于处理 bytes 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const bytes = new Uint8Array(size)
  globalThis.crypto.getRandomValues(bytes)
  return Buffer.from(bytes)
}

/**
 * Random v4 UUID. Delegated to the repository's own mint rather than to
 * `crypto.randomUUID`, which browsers expose only in secure contexts — a
 * preview served over plain HTTP on a LAN address has no `randomUUID`.
 * @returns the UUID string.
 * @remarks 中文说明：功能说明：处理 randomUUID 相关流程；使用场景由所在模块及调用位置决定。；
 * 返回值：import('node:crypto').UUID；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 randomUUID()，并按返回类型处理结果。
 */
export function randomUUID(): import('node:crypto').UUID {
  return mintUUID()
}

/**
 * Fill a typed array with random bytes.
 * @param target - the array to fill.
 * @returns the same array.
 * @remarks 中文说明：功能说明：获取 Random Values 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：target（T）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：T；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 getRandomValues(target)，并按返回类型处理结果。
 */
export function getRandomValues<T extends ArrayBufferView<ArrayBuffer>>(target: T): T {
  return globalThis.crypto.getRandomValues(target)
}

/**
 * Random integer in `[0, max)`.
 * @param max - exclusive upper bound.
 * @returns the integer.
 * @remarks 中文说明：功能说明：处理 randomInt 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：max（number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：number；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 randomInt(max)，并按返回类型处理结果。
 */
export function randomInt(max: number): number {
  /**
   * 常量说明：sample 用于处理 sample 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const sample = globalThis.crypto.getRandomValues(new Uint32Array(1))[0] ?? 0
  return Math.floor((sample / 2 ** 32) * max)
}

/** WebCrypto instance, as Node exposes it.
 * @remarks 中文说明：常量说明：webcrypto 用于处理 webcrypto 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
export const webcrypto = globalThis.crypto

/** CommonJS interop marker: the worker loader hands `default` to default imports (see ./builtins.ts).
 * @remarks 中文说明：常量说明：__esModule 用于处理 __esModule 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
export const __esModule = true

/**
 * The `node:crypto` declarations this module stands in for. Three members keep
 * this module's own types: Node declares `createHash` as returning a Transform
 * stream, while this Hash is the synchronous update/digest pair the host tree
 * calls; `webcrypto` is the browser `Crypto` object, whose `subtle` face is
 * declared by the DOM library rather than by Node; and `getRandomValues` accepts
 * only a typed-array view, the values WebCrypto can fill, where Node's
 * declaration also admits a bare `ArrayBuffer`.
 */
type NodeFace = Partial<Omit<typeof import('node:crypto'), 'createHash' | 'getRandomValues' | 'webcrypto'>>
  & Record<'createHash' | 'getRandomValues' | 'webcrypto', unknown>

/** CommonJS default export: the members `require()` hands a caller of this module. */
export default {
  createHash, randomBytes, randomUUID, getRandomValues, randomInt, webcrypto,
} satisfies NodeFace
