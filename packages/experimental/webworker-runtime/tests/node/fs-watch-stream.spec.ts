/** Node differential checks for the Worker filesystem watcher and stream faces.
 * @remarks 文件说明：文件职责：验证 experimental/webworker-runtime 中 fs watch stream
 * spec 相关行为与失败场景。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。；
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。；
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。 */
import {
  closeSync as closeNodeSync,
  createReadStream as createNodeReadStream,
  createWriteStream as createNodeWriteStream,
  mkdtempSync,
  openSync as openNodeSync,
  readSync as readNodeSync,
  readFileSync,
  renameSync as renameNodeSync,
  rmSync,
  unwatchFile as unwatchNodeFile,
  watchFile as watchNodeFile,
  writeSync as writeNodeSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryVfs } from '../../src/storage/memory.ts'
import { setActiveVfs } from '../../src/storage/active.ts'
import * as workerFs from '../../src/node/builtin_modules/implemented/fs.ts'
import * as workerFsp from '../../src/node/builtin_modules/implemented/fs/promises.ts'
import * as workerStream from '../../src/node/builtin_modules/implemented/stream.ts'

/**
 * 常量说明：VFS_ROOT 用于处理 VFS_ROOT 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const VFS_ROOT = '/dsh/watch-stream'
/**
 * 常量说明：nativeRoots 用于处理 nativeRoots 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const nativeRoots: string[] = []
/**
 * 变量说明：vfs 用于处理 vfs 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
 */
let vfs: MemoryVfs

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
beforeEach(() => {
  vfs = new MemoryVfs()
  setActiveVfs(vfs)
  vfs.mkdirSync(VFS_ROOT, { recursive: true })
})

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
afterEach(() => {
  /**
   * 变量说明：root 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (const root of nativeRoots.splice(0)) rmSync(root, { recursive: true, force: true })
  vi.restoreAllMocks()
})

/** Await the next callback value with a bounded failure instead of an open watcher.
 * @remarks 中文说明：功能说明：处理 nextValue 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：install（(resolve: (value: T) => void) => void）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。；返回值：Promise<T>；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 nextValue(install)，并按返回类型处理结果。 */
function nextValue<T>(install: (resolve: (value: T) => void) => void): Promise<T> {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolve（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：reject（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(resolve, reject)，
   * 并按返回类型处理结果。
   */
  return new Promise<T>((resolve, reject) => {
    /**
     * 常量说明：timeout 用于处理 timeout 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    const timeout = setTimeout(() => { reject(new Error('timed out waiting for filesystem event')) }, 2_000)
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：value（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(value)，并按返回类型处理结果。
     */
    install((value) => {
      clearTimeout(timeout)
      resolve(value)
    })
  })
}

interface ReadableFileStream {
  readonly bytesRead: number
  /**
   * 功能说明：响应 on 相关流程；使用场景由所在模块及调用位置决定。
   * @param event （string）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。
   * @param listener （(...args: unknown[]) => void）：接收后续状态或事件并执行调用方逻辑；
   * 必须满足声明的类型及调用时序要求。
   * @returns ReadableFileStream；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 on(event, listener)，并按返回类型处理结果。
   */
  on(event: string, listener: (...args: unknown[]) => void): ReadableFileStream
}

/** Collect byte chunks and lifecycle events from one read stream implementation.
 * @remarks 中文说明：功能说明：读取 Scenario 相关流程；使用场景由所在模块及调用位置决定。；参数说明：create（() =>
 * ReadableFileStream）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：Promise<{ chunks:
 * string[] events: string[] bytesRead: number }>；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 readScenario(create)，并按返回类型处理结果。 */
async function readScenario(create: () => ReadableFileStream): Promise<{
  chunks: string[]
  events: string[]
  bytesRead: number
}> {
  /**
   * 常量说明：stream 用于处理 stream 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const stream = create()
  /**
   * 常量说明：chunks 用于处理 chunks 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const chunks: string[] = []
  /**
   * 常量说明：events 用于处理 events 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const events: string[] = []
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  stream.on('open', () => { events.push('open') })
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  stream.on('ready', () => { events.push('ready') })
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：chunk（unknown）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 典型用法：在完成前置校验后调用 匿名回调(chunk)，并按返回类型处理结果。
   */
  stream.on('data', (chunk: unknown) => {
    events.push('data')
    chunks.push(Buffer.from(chunk as Uint8Array).toString('utf8'))
  })
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  stream.on('end', () => { events.push('end') })
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolve（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：reject（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(resolve, reject)，
   * 并按返回类型处理结果。
   */
  await new Promise<void>((resolve, reject) => {
    stream.on('error', reject)
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    stream.on('close', () => {
      events.push('close')
      resolve()
    })
  })
  return { chunks, events, bytesRead: stream.bytesRead }
}

interface WritableFileStream {
  readonly bytesWritten: number
  /**
   * 功能说明：响应 on 相关流程；使用场景由所在模块及调用位置决定。
   * @param event （string）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。
   * @param listener （(...args: unknown[]) => void）：接收后续状态或事件并执行调用方逻辑；
   * 必须满足声明的类型及调用时序要求。
   * @returns WritableFileStream；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 on(event, listener)，并按返回类型处理结果。
   */
  on(event: string, listener: (...args: unknown[]) => void): WritableFileStream
  /**
   * 功能说明：写入 write 相关流程；使用场景由所在模块及调用位置决定。
   * @param chunk （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns boolean；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 write(chunk)，并按返回类型处理结果。
   */
  write(chunk: string): boolean
  /**
   * 功能说明：处理 end 相关流程；使用场景由所在模块及调用位置决定。
   * @param chunk （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 end(chunk)，并按返回类型处理结果。
   */
  end(chunk?: string): void
}

/** Write the same chunks and record backpressure plus lifecycle ordering.
 * @remarks 中文说明：功能说明：写入 Scenario 相关流程；使用场景由所在模块及调用位置决定。；参数说明：create（() =>
 * WritableFileStream）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：Promise<{ writes:
 * boolean[] events: string[] bytesWritten: number }>；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 writeScenario(create)，并按返回类型处理结果。 */
async function writeScenario(create: () => WritableFileStream): Promise<{
  writes: boolean[]
  events: string[]
  bytesWritten: number
}> {
  /**
   * 常量说明：stream 用于处理 stream 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const stream = create()
  /**
   * 常量说明：events 用于处理 events 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const events: string[] = []
  /**
   * 变量说明：event 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (const event of ['open', 'ready', 'drain', 'finish'] as const) {
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    stream.on(event, () => { events.push(event) })
  }
  /**
   * 常量说明：writes 用于处理 writes 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const writes = [stream.write('ab'), stream.write('cd')]
  stream.end('ef')
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolve（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：reject（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(resolve, reject)，
   * 并按返回类型处理结果。
   */
  await new Promise<void>((resolve, reject) => {
    stream.on('error', reject)
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    stream.on('close', () => {
      events.push('close')
      resolve()
    })
  })
  return { writes, events, bytesWritten: stream.bytesWritten }
}

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
describe('file streams', () => {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('keeps an opened file identity across rename, replacement, and unlink', () => {
    /**
     * 常量说明：nativeRoot 用于处理 nativeRoot 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const nativeRoot = mkdtempSync(join(tmpdir(), 'dsh-stream-diff-'))
    nativeRoots.push(nativeRoot)
    /**
     * 常量说明：nativePath 用于处理 nativePath 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const nativePath = join(nativeRoot, 'identity.txt')
    /**
     * 常量说明：workerPath 用于处理 workerPath 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const workerPath = `${VFS_ROOT}/identity.txt`

    /**
     * 常量说明：nativeScenario 用于处理 nativeScenario 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     * 功能说明：处理 nativeScenario 相关流程；使用场景由所在模块及调用位置决定。
     * @returns string[]；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 nativeScenario()，并按返回类型处理结果。
     */
    const nativeScenario = (): string[] => {
      writeFileSync(nativePath, 'original')
      /**
       * 常量说明：fd 用于处理 fd 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const fd = openNodeSync(nativePath, 'r')
      renameNodeSync(nativePath, `${nativePath}.moved`)
      writeFileSync(nativePath, 'replacement')
      /**
       * 常量说明：beforeUnlink 用于处理 beforeUnlink 相关数据，作用于当前作用域；初始化后不可重新赋值，
       * 但对象内部是否可变仍由其类型决定。
       */
      const beforeUnlink = Buffer.alloc(16)
      /**
       * 常量说明：firstCount 用于处理 firstCount 相关数据，作用于当前作用域；初始化后不可重新赋值，
       * 但对象内部是否可变仍由其类型决定。
       */
      const firstCount = readNodeSync(fd, beforeUnlink, 0, beforeUnlink.length, 0)
      rmSync(`${nativePath}.moved`)
      /**
       * 常量说明：afterUnlink 用于处理 afterUnlink 相关数据，作用于当前作用域；初始化后不可重新赋值，
       * 但对象内部是否可变仍由其类型决定。
       */
      const afterUnlink = Buffer.alloc(16)
      /**
       * 常量说明：secondCount 用于处理 secondCount 相关数据，作用于当前作用域；初始化后不可重新赋值，
       * 但对象内部是否可变仍由其类型决定。
       */
      const secondCount = readNodeSync(fd, afterUnlink, 0, afterUnlink.length, 0)
      closeNodeSync(fd)
      return [beforeUnlink.subarray(0, firstCount).toString(), afterUnlink.subarray(0, secondCount).toString()]
    }
    /**
     * 常量说明：workerScenario 用于处理 workerScenario 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     * 功能说明：处理 workerScenario 相关流程；使用场景由所在模块及调用位置决定。
     * @returns string[]；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 workerScenario()，并按返回类型处理结果。
     */
    const workerScenario = (): string[] => {
      vfs.writeFileSync(workerPath, 'original')
      /**
       * 常量说明：fd 用于处理 fd 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const fd = workerFs.openSync(workerPath, 'r')
      vfs.renameSync(workerPath, `${workerPath}.moved`)
      vfs.writeFileSync(workerPath, 'replacement')
      /**
       * 常量说明：beforeUnlink 用于处理 beforeUnlink 相关数据，作用于当前作用域；初始化后不可重新赋值，
       * 但对象内部是否可变仍由其类型决定。
       */
      const beforeUnlink = Buffer.alloc(16)
      /**
       * 常量说明：firstCount 用于处理 firstCount 相关数据，作用于当前作用域；初始化后不可重新赋值，
       * 但对象内部是否可变仍由其类型决定。
       */
      const firstCount = workerFs.readSync(fd, beforeUnlink, 0, beforeUnlink.length, 0)
      vfs.rmSync(`${workerPath}.moved`)
      /**
       * 常量说明：afterUnlink 用于处理 afterUnlink 相关数据，作用于当前作用域；初始化后不可重新赋值，
       * 但对象内部是否可变仍由其类型决定。
       */
      const afterUnlink = Buffer.alloc(16)
      /**
       * 常量说明：secondCount 用于处理 secondCount 相关数据，作用于当前作用域；初始化后不可重新赋值，
       * 但对象内部是否可变仍由其类型决定。
       */
      const secondCount = workerFs.readSync(fd, afterUnlink, 0, afterUnlink.length, 0)
      workerFs.closeSync(fd)
      return [beforeUnlink.subarray(0, firstCount).toString(), afterUnlink.subarray(0, secondCount).toString()]
    }

    expect(workerScenario()).toEqual(nativeScenario())
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('keeps a read stream on the file opened before an atomic replacement', async () => {
    /**
     * 常量说明：nativeRoot 用于处理 nativeRoot 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const nativeRoot = mkdtempSync(join(tmpdir(), 'dsh-stream-diff-'))
    nativeRoots.push(nativeRoot)
    /**
     * 常量说明：nativePath 用于处理 nativePath 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const nativePath = join(nativeRoot, 'stream-identity.txt')
    /**
     * 常量说明：workerPath 用于处理 workerPath 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const workerPath = `${VFS_ROOT}/stream-identity.txt`
    writeFileSync(nativePath, 'original')
    vfs.writeFileSync(workerPath, 'original')

    /**
     * 常量说明：readAfterReplacement 用于读取 After Replacement 相关数据，作用于当前作用域；
     * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     * 功能说明：读取 After Replacement 相关流程；使用场景由所在模块及调用位置决定。
     * @param stream （AsyncIterable<Uint8Array> & { once(event: string,
     * listener:…）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
     * @param replace （() => void）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
     * @returns Promise<string>；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 readAfterReplacement(stream, replace)，并按返回类型处理结果。
     */
    /**
     * 功能说明：处理 once 相关流程；使用场景由所在模块及调用位置决定。
     * @param event （string）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。
     * @param listener （() => void）：接收后续状态或事件并执行调用方逻辑；必须满足声明的类型及调用时序要求。
     * @returns unknown；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 once(event, listener)，并按返回类型处理结果。
     */
    const readAfterReplacement = async (
      stream: AsyncIterable<Uint8Array> & { once(event: string, listener: () => void): unknown },
      replace: () => void,
    ): Promise<string> => {
      stream.once('open', replace)
      /**
       * 常量说明：chunks 用于处理 chunks 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const chunks: Uint8Array[] = []
      /**
       * 变量说明：chunk 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
       */
      for await (const chunk of stream) chunks.push(chunk)
      return Buffer.concat(chunks).toString()
    }
    /**
     * 常量说明：native 用于处理 native 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    const native = await readAfterReplacement(createNodeReadStream(nativePath, { highWaterMark: 2 }), () => {
      renameNodeSync(nativePath, `${nativePath}.moved`)
      writeFileSync(nativePath, 'replacement')
    })
    /**
     * 常量说明：worker 用于处理 worker 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    const worker = await readAfterReplacement(workerFs.createReadStream(workerPath, { highWaterMark: 2 }), () => {
      vfs.renameSync(workerPath, `${workerPath}.moved`)
      vfs.writeFileSync(workerPath, 'replacement')
    })
    expect(worker).toBe(native)
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('rejects descriptor operations that conflict with the open mode', () => {
    /**
     * 常量说明：nativeRoot 用于处理 nativeRoot 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const nativeRoot = mkdtempSync(join(tmpdir(), 'dsh-stream-diff-'))
    nativeRoots.push(nativeRoot)
    /**
     * 常量说明：nativePath 用于处理 nativePath 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const nativePath = join(nativeRoot, 'mode.txt')
    /**
     * 常量说明：workerPath 用于处理 workerPath 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const workerPath = `${VFS_ROOT}/mode.txt`
    writeFileSync(nativePath, 'content')
    vfs.writeFileSync(workerPath, 'content')
    /**
     * 常量说明：codeOf 用于处理 codeOf 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     * 功能说明：处理 codeOf 相关流程；使用场景由所在模块及调用位置决定。
     * @param run （() => unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
     * @returns string | undefined；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 codeOf(run)，并按返回类型处理结果。
     */
    const codeOf = (run: () => unknown): string | undefined => {
      /**
       * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
       */
      try {
        run()
        return undefined
      } catch (error) {
        return (error as NodeJS.ErrnoException).code
      }
    }

    /**
     * 常量说明：nativeReadOnly 用于处理 nativeReadOnly 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const nativeReadOnly = openNodeSync(nativePath, 'r')
    /**
     * 常量说明：workerReadOnly 用于处理 workerReadOnly 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const workerReadOnly = workerFs.openSync(workerPath, 'r')
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    expect(codeOf(() => workerFs.writeSync(workerReadOnly, 'x')))
      .toBe(codeOf(() => writeNodeSync(nativeReadOnly, 'x')))
    closeNodeSync(nativeReadOnly)
    workerFs.closeSync(workerReadOnly)

    /**
     * 常量说明：nativeWriteOnly 用于处理 nativeWriteOnly 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const nativeWriteOnly = openNodeSync(nativePath, 'w')
    /**
     * 常量说明：workerWriteOnly 用于处理 workerWriteOnly 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const workerWriteOnly = workerFs.openSync(workerPath, 'w')
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    expect(codeOf(() => workerFs.readSync(workerWriteOnly, Buffer.alloc(1), 0, 1, 0)))
      .toBe(codeOf(() => readNodeSync(nativeWriteOnly, Buffer.alloc(1), 0, 1, 0)))
    closeNodeSync(nativeWriteOnly)
    workerFs.closeSync(workerWriteOnly)
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('keeps hard-link identity and content shared through the Node face', () => {
    /**
     * 常量说明：source 用于处理 source 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const source = `${VFS_ROOT}/linked-source.txt`
    /**
     * 常量说明：alias 用于处理 alias 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const alias = `${VFS_ROOT}/linked-alias.txt`
    workerFs.writeFileSync(source, 'one')
    workerFs.linkSync(source, alias)
    expect(workerFs.statSync(alias, { bigint: true }).ino)
      .toBe(workerFs.statSync(source, { bigint: true }).ino)
    workerFs.appendFileSync(alias, '-two')
    expect(workerFs.readFileSync(source, 'utf8')).toBe('one-two')
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('reports incompatible read and write stream flags as EBADF', async () => {
    /**
     * 常量说明：path 用于处理 path 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const path = `${VFS_ROOT}/stream-mode.txt`
    vfs.writeFileSync(path, 'content')
    /**
     * 常量说明：writeError 用于写入 Error 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolve（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(resolve)，并按返回类型处理结果。
     */
    const writeError = nextValue<NodeJS.ErrnoException>((resolve) => {
      /**
       * 常量说明：stream 用于处理 stream 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const stream = workerFs.createWriteStream(path, { flags: 'r' })
      stream.once('error', resolve)
      stream.end('x')
    })
    await expect(writeError).resolves.toMatchObject({ code: 'EBADF' })

    /**
     * 常量说明：read 用于读取 read 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const read = workerFs.createReadStream(path, { flags: 'w' })
    /**
     * 常量说明：readError 用于读取 Error 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolve（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(resolve)，并按返回类型处理结果。
     */
    const readError = nextValue<NodeJS.ErrnoException>((resolve) => { read.once('error', resolve) })
    read.resume()
    await expect(readError).resolves.toMatchObject({ code: 'EBADF' })
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('zero-extends through promise and file-handle truncate', async () => {
    /**
     * 常量说明：path 用于处理 path 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const path = `${VFS_ROOT}/truncate.txt`
    vfs.writeFileSync(path, new Uint8Array([1, 2]))
    await workerFsp.truncate(path, 4)
    expect([...workerFs.readFileSync(path) as Uint8Array]).toEqual([1, 2, 0, 0])
    /**
     * 常量说明：handle 用于处理 handle 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const handle = await workerFsp.open(path, 'r+')
    await handle.truncate(6)
    await handle.close()
    expect([...workerFs.readFileSync(path) as Uint8Array]).toEqual([1, 2, 0, 0, 0, 0])
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('matches Node chunking, inclusive ranges, and read lifecycle ordering', async () => {
    /**
     * 常量说明：nativeRoot 用于处理 nativeRoot 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const nativeRoot = mkdtempSync(join(tmpdir(), 'dsh-stream-diff-'))
    nativeRoots.push(nativeRoot)
    /**
     * 常量说明：nativePath 用于处理 nativePath 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const nativePath = join(nativeRoot, 'input.txt')
    /**
     * 常量说明：workerPath 用于处理 workerPath 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const workerPath = `${VFS_ROOT}/input.txt`
    writeFileSync(nativePath, '0123456789')
    vfs.writeFileSync(workerPath, '0123456789')

    /**
     * 常量说明：native 用于处理 native 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    const native = await readScenario(() => createNodeReadStream(nativePath, { start: 2, end: 7, highWaterMark: 2 }))
    /**
     * 常量说明：worker 用于处理 worker 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    const worker = await readScenario(() => workerFs.createReadStream(workerPath, { start: 2, end: 7, highWaterMark: 2 }))
    expect(worker).toEqual(native)
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('matches Node write backpressure, lifecycle ordering, and byte accounting', async () => {
    /**
     * 常量说明：nativeRoot 用于处理 nativeRoot 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const nativeRoot = mkdtempSync(join(tmpdir(), 'dsh-stream-diff-'))
    nativeRoots.push(nativeRoot)
    /**
     * 常量说明：nativePath 用于处理 nativePath 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const nativePath = join(nativeRoot, 'output.txt')
    /**
     * 常量说明：workerPath 用于处理 workerPath 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const workerPath = `${VFS_ROOT}/output.txt`

    /**
     * 常量说明：native 用于处理 native 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    const native = await writeScenario(() => createNodeWriteStream(nativePath, { highWaterMark: 2 }))
    /**
     * 常量说明：worker 用于处理 worker 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    const worker = await writeScenario(() => workerFs.createWriteStream(workerPath, { highWaterMark: 2 }))
    expect(worker).toEqual(native)
    expect(workerFs.readFileSync(workerPath, 'utf8')).toBe('abcdef')
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('uses the maintained stream implementation for backpressure and async iteration', async () => {
    /**
     * 常量说明：values 用于处理 values 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const values: string[] = []
    /**
     * 变量说明：value 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for await (const value of workerStream.Readable.from(['one', 'two'])) values.push(String(value))
    expect(values).toEqual(['one', 'two'])
    expect(workerStream.default).toBe(workerStream.Stream)
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：_chunk（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：_encoding（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：callback（由 TypeScript
     * 根据调用位置推断的类型）：接收后续状态或事件并执行调用方逻辑；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript
     * 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(_chunk,
     * _encoding, callback)，并按返回类型处理结果。
     */
    expect(new workerStream.Writable({ write: (_chunk, _encoding, callback) => { callback() } }))
      .toBeInstanceOf(workerStream.default)
    expect(typeof workerStream.pipeline).toBe('function')
    expect(typeof workerStream.finished).toBe('function')
    expect(workerStream.getDefaultHighWaterMark(false)).toBe(64 * 1024)
    expect(workerStream.default._isArrayBufferView(new Uint8Array())).toBe(true)
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('uses Node 22 Linux file-stream defaults and abort error identity', async () => {
    /**
     * 常量说明：nativeRoot 用于处理 nativeRoot 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const nativeRoot = mkdtempSync(join(tmpdir(), 'dsh-stream-diff-'))
    nativeRoots.push(nativeRoot)
    /**
     * 常量说明：nativePath 用于处理 nativePath 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const nativePath = join(nativeRoot, 'input.txt')
    /**
     * 常量说明：workerPath 用于处理 workerPath 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const workerPath = `${VFS_ROOT}/input.txt`
    writeFileSync(nativePath, 'content')
    vfs.writeFileSync(workerPath, 'content')
    /**
     * 常量说明：nativeRead 用于处理 nativeRead 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const nativeRead = createNodeReadStream(nativePath)
    /**
     * 常量说明：nativeWrite 用于处理 nativeWrite 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const nativeWrite = createNodeWriteStream(join(nativeRoot, 'output.txt'))
    /**
     * 常量说明：workerRead 用于处理 workerRead 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const workerRead = workerFs.createReadStream(workerPath)
    /**
     * 常量说明：workerWrite 用于处理 workerWrite 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const workerWrite = workerFs.createWriteStream(`${VFS_ROOT}/output.txt`)
    expect([workerRead.readableHighWaterMark, workerWrite.writableHighWaterMark]).toEqual([
      nativeRead.readableHighWaterMark,
      nativeWrite.writableHighWaterMark,
    ])
    interface CloseableStream {
      /**
       * 功能说明：处理 once 相关流程；使用场景由所在模块及调用位置决定。
       * @param event （string）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。
       * @param listener （(...args: unknown[]) => void）：接收后续状态或事件并执行调用方逻辑；
       * 必须满足声明的类型及调用时序要求。
       * @returns unknown；调用方应按声明类型处理，不应假定未声明的附加状态。
       * @example 在完成前置校验后调用 once(event, listener)，并按返回类型处理结果。
       */
      once(event: string, listener: (...args: unknown[]) => void): unknown
      /**
       * 功能说明：处理 destroy 相关流程；使用场景由所在模块及调用位置决定。
       * @returns unknown；调用方应按声明类型处理，不应假定未声明的附加状态。
       * @example 在完成前置校验后调用 destroy()，并按返回类型处理结果。
       */
      destroy(): unknown
    }
    /**
     * 常量说明：streams 用于处理 streams 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const streams = [nativeRead, nativeWrite, workerRead, workerWrite] as unknown as CloseableStream[]
    /**
     * 常量说明：closed 用于处理 closed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：stream（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(stream)，并按返回类型处理结果。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolve（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(resolve)，并按返回类型处理结果。
     */
    const closed = streams.map(stream => new Promise<void>((resolve) => {
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
       */
      stream.once('error', () => {})
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
       */
      stream.once('close', () => { resolve() })
    }))
    /**
     * 变量说明：stream 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const stream of streams) stream.destroy()
    await Promise.all(closed)

    /**
     * 常量说明：controller 用于处理 controller 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const controller = new AbortController()
    controller.abort(new Error('stop'))
    /**
     * 常量说明：aborted 用于处理 aborted 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const aborted = workerFs.createReadStream(workerPath, { signal: controller.signal })
    /**
     * 常量说明：error 用于处理 error 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolve（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(resolve)，并按返回类型处理结果。
     */
    const error = await nextValue<Error & { code?: string }>((resolve) => { aborted.once('error', resolve) })
    expect(error).toMatchObject({ name: 'AbortError', code: 'ABORT_ERR' })
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('keeps autoClose false descriptors open until explicit stream close', async () => {
    /**
     * 常量说明：readPath 用于读取 Path 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const readPath = `${VFS_ROOT}/manual-read-close.txt`
    vfs.writeFileSync(readPath, 'content')
    /**
     * 常量说明：read 用于读取 read 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const read = workerFs.createReadStream(readPath, { autoClose: false })
    read.resume()
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolve（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(resolve)，并按返回类型处理结果。
     */
    /**
    * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
    * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
    */
    await nextValue<undefined>((resolve) => { read.once('end', () => { resolve(undefined) }) })
    /**
     * 常量说明：readFd 用于读取 Fd 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const readFd = read.fd
    expect(readFd).not.toBeNull()
    expect(read.destroyed).toBe(false)
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    expect(() => workerFs.readSync(readFd as number, Buffer.alloc(1), 0, 1, 0)).not.toThrow()
    /**
     * 常量说明：readClosed 用于读取 Closed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolve（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(resolve)，并按返回类型处理结果。
     */
    /**
    * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
    * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
    */
    const readClosed = nextValue<undefined>((resolve) => { read.once('close', () => { resolve(undefined) }) })
    read.close()
    await readClosed
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    expect(() => workerFs.readSync(readFd as number, Buffer.alloc(1), 0, 1, 0)).toThrow(/EBADF/)

    /**
     * 常量说明：write 用于写入 write 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const write = workerFs.createWriteStream(`${VFS_ROOT}/manual-write-close.txt`, { autoClose: false })
    write.end('a')
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolve（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(resolve)，并按返回类型处理结果。
     */
    /**
    * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
    * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
    */
    await nextValue<undefined>((resolve) => { write.once('finish', () => { resolve(undefined) }) })
    /**
     * 常量说明：writeFd 用于写入 Fd 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const writeFd = write.fd
    expect(writeFd).not.toBeNull()
    expect(write.destroyed).toBe(false)
    expect(workerFs.writeSync(writeFd as number, 'b')).toBe(1)
    /**
     * 常量说明：writeClosed 用于写入 Closed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolve（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(resolve)，并按返回类型处理结果。
     */
    /**
    * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
    * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
    */
    const writeClosed = nextValue<undefined>((resolve) => { write.once('close', () => { resolve(undefined) }) })
    write.close()
    await writeClosed
    expect(workerFs.readFileSync(`${VFS_ROOT}/manual-write-close.txt`, 'utf8')).toBe('ab')

    vfs.writeFileSync(`${VFS_ROOT}/manual-error-close.txt`, 'content')
    /**
     * 常量说明：errored 用于处理 errored 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const errored = workerFs.createWriteStream(`${VFS_ROOT}/manual-error-close.txt`, {
      flags: 'r',
      autoClose: false,
    })
    /**
     * 常量说明：error 用于处理 error 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolve（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(resolve)，并按返回类型处理结果。
     */
    const error = nextValue<NodeJS.ErrnoException>((resolve) => { errored.once('error', resolve) })
    errored.end('rejected')
    await expect(error).resolves.toMatchObject({ code: 'EBADF' })
    /**
     * 常量说明：errorFd 用于处理 errorFd 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const errorFd = errored.fd
    expect(errorFd).not.toBeNull()
    expect(errored.destroyed).toBe(false)
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    expect(() => workerFs.readSync(errorFd as number, Buffer.alloc(1), 0, 1, 0)).not.toThrow()
    /**
     * 常量说明：errorClosed 用于处理 errorClosed 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolve（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(resolve)，并按返回类型处理结果。
     */
    /**
    * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
    * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
    */
    const errorClosed = nextValue<undefined>((resolve) => { errored.once('close', () => { resolve(undefined) }) })
    errored.destroy()
    await errorClosed
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    expect(() => workerFs.readSync(errorFd as number, Buffer.alloc(1), 0, 1, 0)).toThrow(/EBADF/)
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('matches Node positional overwrite and missing-file failure', async () => {
    /**
     * 常量说明：nativeRoot 用于处理 nativeRoot 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const nativeRoot = mkdtempSync(join(tmpdir(), 'dsh-stream-diff-'))
    nativeRoots.push(nativeRoot)
    /**
     * 常量说明：nativePath 用于处理 nativePath 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const nativePath = join(nativeRoot, 'position.txt')
    /**
     * 常量说明：workerPath 用于处理 workerPath 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const workerPath = `${VFS_ROOT}/position.txt`
    writeFileSync(nativePath, 'abcdef')
    vfs.writeFileSync(workerPath, 'abcdef')

    /**
     * 常量说明：writeAt 用于写入 At 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     * 功能说明：写入 At 相关流程；使用场景由所在模块及调用位置决定。
     * @param stream （WritableFileStream）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
     * @returns Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 writeAt(stream)，并按返回类型处理结果。
     */
    const writeAt = async (stream: WritableFileStream): Promise<void> => {
      stream.end('XY')
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolve（由 TypeScript
       * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(resolve)，并按返回类型处理结果。
       */
      /**
      * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
      * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
      */
      await new Promise<void>((resolve) => { stream.on('close', () => { resolve() }) })
    }
    await writeAt(createNodeWriteStream(nativePath, { flags: 'r+', start: 2 }))
    await writeAt(workerFs.createWriteStream(workerPath, { flags: 'r+', start: 2 }))
    expect(workerFs.readFileSync(workerPath, 'utf8')).toBe(readFileSync(nativePath, 'utf8'))

    /**
     * 常量说明：missing 用于处理 missing 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const missing = workerFs.createReadStream(`${VFS_ROOT}/missing.txt`)
    /**
     * 常量说明：events 用于处理 events 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const events: string[] = []
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    missing.on('error', () => { events.push('error') })
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolve（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(resolve)，并按返回类型处理结果。
     */
    await new Promise<void>((resolve) => {
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
       */
      missing.on('close', () => {
        events.push('close')
        resolve()
      })
    })
    expect(events).toEqual(['error', 'close'])
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('publishes descriptors before open and ready listener exceptions escape', () => {
    /**
     * 常量说明：readPath 用于读取 Path 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const readPath = `${VFS_ROOT}/listener-read.txt`
    vfs.writeFileSync(readPath, 'content')
    /**
     * 常量说明：readCallback 用于读取 Callback 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const readCallback = vi.fn()
    /**
     * 常量说明：readFailure 用于读取 Failure 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const readFailure = new Error('read open listener failed')
    /**
     * 常量说明：readReceiver 用于读取 Receiver 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const readReceiver: {
      path: string
      flags: string
      start: number
      end: number
      signal: undefined
      pending: boolean
      fd: number | null
      /**
       * 功能说明：发送 emit 相关流程；使用场景由所在模块及调用位置决定。
       * @param event （string）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。
       * @returns boolean；调用方应按声明类型处理，不应假定未声明的附加状态。
       * @example 在完成前置校验后调用 emit(event)，并按返回类型处理结果。
       */
      emit(event: string): boolean
    } = {
      path: readPath,
      flags: 'r',
      start: 0,
      end: Number.POSITIVE_INFINITY,
      signal: undefined,
      pending: true,
      fd: null,
      /**
       * 功能说明：发送 emit 相关流程；使用场景由所在模块及调用位置决定。
       * @param event （由 TypeScript 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。
       * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
       * @example 在完成前置校验后调用 emit(event)，并按返回类型处理结果。
       */
      emit(event) {
        expect(readCallback).toHaveBeenCalledOnce()
        if (event === 'open') throw readFailure
        return true
      },
    }
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    expect(() => {
      workerFs.ReadStream.prototype._construct.call(
        readReceiver as unknown as workerFs.ReadStream,
        readCallback,
      )
    }).toThrow(readFailure)
    expect(readReceiver.pending).toBe(false)
    expect(readReceiver.fd).not.toBeNull()
    workerFs.closeSync(readReceiver.fd as number)

    /**
     * 常量说明：writeCallback 用于写入 Callback 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const writeCallback = vi.fn()
    /**
     * 常量说明：writeFailure 用于写入 Failure 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const writeFailure = new Error('write ready listener failed')
    /**
     * 常量说明：writeReceiver 用于写入 Receiver 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const writeReceiver: {
      path: string
      flags: string
      mode: undefined
      start: undefined
      signal: undefined
      pending: boolean
      fd: number | null
      /**
       * 功能说明：发送 emit 相关流程；使用场景由所在模块及调用位置决定。
       * @param event （string）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。
       * @returns boolean；调用方应按声明类型处理，不应假定未声明的附加状态。
       * @example 在完成前置校验后调用 emit(event)，并按返回类型处理结果。
       */
      emit(event: string): boolean
    } = {
      path: `${VFS_ROOT}/listener-write.txt`,
      flags: 'w',
      mode: undefined,
      start: undefined,
      signal: undefined,
      pending: true,
      fd: null,
      /**
       * 功能说明：发送 emit 相关流程；使用场景由所在模块及调用位置决定。
       * @param event （由 TypeScript 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。
       * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
       * @example 在完成前置校验后调用 emit(event)，并按返回类型处理结果。
       */
      emit(event) {
        expect(writeCallback).toHaveBeenCalledOnce()
        if (event === 'ready') throw writeFailure
        return true
      },
    }
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    expect(() => {
      workerFs.WriteStream.prototype._construct.call(
        writeReceiver as unknown as workerFs.WriteStream,
        writeCallback,
      )
    }).toThrow(writeFailure)
    expect(writeReceiver.pending).toBe(false)
    expect(writeReceiver.fd).not.toBeNull()
    workerFs.closeSync(writeReceiver.fd as number)
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('codes a write before descriptor publication as EBADF', () => {
    /**
     * 变量说明：failure 用于处理 failure 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let failure: Error | null | undefined
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：error（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(error)，并按返回类型处理结果。
     */
    workerFs.WriteStream.prototype._write.call(
      { fd: null } as unknown as workerFs.WriteStream,
      Buffer.from('x'),
      'utf8',
      (error) => { failure = error },
    )
    expect(failure).toMatchObject({ code: 'EBADF', syscall: 'write' })
  })
})

interface StatTransition {
  currentExists: boolean
  previousExists: boolean
  currentSize: number
  previousSize: number
  currentOtherKinds: boolean[]
}

/** Observe missing, creation, rewrite, and deletion through one watchFile implementation.
 * @remarks 中文说明：功能说明：处理 watchFileScenario 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：path（string）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；
 * 参数说明：watchFile（typeof watchNodeFile）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；
 * 参数说明：unwatchFile（typeof unwatchNodeFile）：指定要读取、写入或匹配的文件位置；
 * 必须满足声明的类型及调用时序要求。；参数说明：write（(text: string) => void）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。；参数说明：remove（() => void）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：Promise<StatTransition[]>；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 watchFileScenario(path, watchFile, unwatchFile,
 * write, remove)，并按返回类型处理结果。 */
async function watchFileScenario(
  path: string,
  watchFile: typeof watchNodeFile,
  unwatchFile: typeof unwatchNodeFile,
  write: (text: string) => void,
  remove: () => void,
): Promise<StatTransition[]> {
  /**
   * 常量说明：waiting 用于处理 waiting 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const waiting: Array<(value: StatTransition) => void> = []
  /**
   * 常量说明：queued 用于处理 queued 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const queued: StatTransition[] = []
  /**
   * 常量说明：listener 用于处理 listener 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   * 功能说明：处理 listener 相关流程；使用场景由所在模块及调用位置决定。
   * @param current （import('node:fs').Stats）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param previous （import('node:fs').Stats）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 listener(current, previous)，并按返回类型处理结果。
   */
  const listener = (current: import('node:fs').Stats, previous: import('node:fs').Stats): void => {
    /**
     * 常量说明：transition 用于处理 transition 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const transition = {
      currentExists: current.isFile(),
      previousExists: previous.isFile(),
      currentSize: current.size,
      previousSize: previous.size,
      currentOtherKinds: [
        current.isDirectory(), current.isSymbolicLink(), current.isFIFO(),
        current.isSocket(), current.isBlockDevice(), current.isCharacterDevice(),
      ],
    }
    /**
     * 常量说明：resolve 用于解析 resolve 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const resolve = waiting.shift()
    if (resolve === undefined) queued.push(transition)
    else resolve(transition)
  }
  /**
   * 常量说明：next 用于处理 next 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   * 功能说明：处理 next 相关流程；使用场景由所在模块及调用位置决定。
   * @returns Promise<StatTransition>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 next()，并按返回类型处理结果。
   */
  const next = async (): Promise<StatTransition> => {
    /**
     * 常量说明：queuedValue 用于处理 queuedValue 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const queuedValue = queued.shift()
    if (queuedValue !== undefined) return queuedValue
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolve（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(resolve)，并按返回类型处理结果。
     */
    return await nextValue((resolve) => { waiting.push(resolve) })
  }
  watchFile(path, { interval: 10, persistent: false }, listener)
  try {
    /**
     * 常量说明：missing 用于处理 missing 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const missing = await next()
    write('a')
    /**
     * 常量说明：created 用于处理 created 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const created = await next()
    write('longer')
    /**
     * 常量说明：changed 用于处理 changed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const changed = await next()
    remove()
    /**
     * 常量说明：removed 用于处理 removed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const removed = await next()
    return [missing, created, changed, removed]
  } finally {
    unwatchFile(path, listener)
  }
}

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
describe('watchers', () => {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('does not catch exceptions thrown by a successful stat callback', () => {
    /**
     * 常量说明：path 用于处理 path 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const path = `${VFS_ROOT}/callback.txt`
    vfs.writeFileSync(path, 'value')
    /**
     * 常量说明：failure 用于处理 failure 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const failure = new Error('callback failed')
    /**
     * 变量说明：calls 用于处理 calls 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let calls = 0
    /**
     * 常量说明：dispatch 用于分发 dispatch 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：callback（由 TypeScript
     * 根据调用位置推断的类型）：接收后续状态或事件并执行调用方逻辑；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript
     * 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(callback)，
     * 并按返回类型处理结果。
     */
    const dispatch = vi.spyOn(globalThis, 'queueMicrotask').mockImplementation((callback) => { callback() })
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    expect(() => {
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
       */
      workerFs.stat(path, () => {
        calls += 1
        throw failure
      })
    }).toThrow(failure)
    expect(calls).toBe(1)
    dispatch.mockRestore()
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('matches Node watchFile state transitions for a missing and recreated file', async () => {
    /**
     * 常量说明：nativeRoot 用于处理 nativeRoot 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const nativeRoot = mkdtempSync(join(tmpdir(), 'dsh-watch-diff-'))
    nativeRoots.push(nativeRoot)
    /**
     * 常量说明：nativePath 用于处理 nativePath 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const nativePath = join(nativeRoot, 'watched.txt')
    /**
     * 常量说明：workerPath 用于处理 workerPath 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const workerPath = `${VFS_ROOT}/watched.txt`
    /**
     * 常量说明：native 用于处理 native 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：text（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(text)，并按返回类型处理结果。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    const native = await watchFileScenario(
      nativePath,
      watchNodeFile,
      unwatchNodeFile,
      (text) => { writeFileSync(nativePath, text) },
      () => { rmSync(nativePath) },
    )
    /**
     * 常量说明：worker 用于处理 worker 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：text（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(text)，并按返回类型处理结果。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    const worker = await watchFileScenario(
      workerPath,
      workerFs.watchFile as unknown as typeof watchNodeFile,
      workerFs.unwatchFile as unknown as typeof unwatchNodeFile,
      (text) => { vfs.writeFileSync(workerPath, text) },
      () => { vfs.rmSync(workerPath) },
    )
    expect(worker).toEqual(native)
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('shares one StatWatcher and removes only the named listener', async () => {
    /**
     * 常量说明：path 用于处理 path 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const path = `${VFS_ROOT}/shared.txt`
    vfs.writeFileSync(path, 'a')
    /**
     * 常量说明：firstEvents 用于处理 firstEvents 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const firstEvents: number[] = []
    /**
     * 常量说明：secondEvents 用于处理 secondEvents 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const secondEvents: number[] = []
    /**
     * 常量说明：first 用于处理 first 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     * 功能说明：处理 first 相关流程；使用场景由所在模块及调用位置决定。
     * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 first()，并按返回类型处理结果。
     */
    const first = (): void => { firstEvents.push(1) }
    /**
     * 常量说明：second 用于处理 second 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     * 功能说明：处理 second 相关流程；使用场景由所在模块及调用位置决定。
     * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 second()，并按返回类型处理结果。
     */
    const second = (): void => { secondEvents.push(1) }
    /**
     * 常量说明：firstWatcher 用于处理 firstWatcher 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const firstWatcher = workerFs.watchFile(path, { interval: 1, persistent: false }, first)
    /**
     * 常量说明：secondWatcher 用于处理 secondWatcher 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const secondWatcher = workerFs.watchFile(path, { interval: 1, persistent: false }, second)
    expect(secondWatcher).toBe(firstWatcher)
    workerFs.unwatchFile(path, first)
    vfs.writeFileSync(path, 'bb')
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolve（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(resolve)，并按返回类型处理结果。
     */
    await nextValue<undefined>((resolve) => {
      /**
       * 常量说明：poll 用于处理 poll 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
       */
      const poll = setInterval(() => {
        if (secondEvents.length === 0) return
        clearInterval(poll)
        resolve(undefined)
      }, 1)
    })
    expect(firstEvents).toEqual([])
    expect(secondEvents).toEqual([1])
    workerFs.unwatchFile(path)
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('reports direct and recursive names, then reaches quiescence on close', async () => {
    /**
     * 常量说明：root 用于处理 root 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const root = `${VFS_ROOT}/tree`
    vfs.mkdirSync(`${root}/nested`, { recursive: true })
    /**
     * 常量说明：directEvents 用于处理 directEvents 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const directEvents: Array<[string, string]> = []
    /**
     * 常量说明：recursiveEvents 用于处理 recursiveEvents 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const recursiveEvents: Array<[string, string]> = []
    /**
     * 常量说明：direct 用于处理 direct 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：_event（由 TypeScript
     * 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；参数：_filename（由 TypeScript
     * 根据调用位置推断的类型）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript
     * 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(_event,
     * _filename)，并按返回类型处理结果。
     */
    const direct = workerFs.watch(root, (_event, _filename) => {})
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：event（由 TypeScript
     * 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；参数：filename（由 TypeScript
     * 根据调用位置推断的类型）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript
     * 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(event,
     * filename)，并按返回类型处理结果。
     */
    direct.on('change', (event, filename) => { directEvents.push([String(event), String(filename)]) })
    /**
     * 常量说明：recursive 用于处理 recursive 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：event（由 TypeScript
     * 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；参数：filename（由 TypeScript
     * 根据调用位置推断的类型）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript
     * 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(event,
     * filename)，并按返回类型处理结果。
     */
    const recursive = workerFs.watch(root, { recursive: true }, (event, filename) => {
      recursiveEvents.push([event, String(filename)])
    })
    vfs.writeFileSync(`${root}/top.txt`, 'top')
    vfs.writeFileSync(`${root}/nested/deep.txt`, 'deep')
    await Promise.resolve()
    expect(directEvents).toEqual([['rename', 'top.txt']])
    expect(recursiveEvents).toEqual([
      ['rename', 'top.txt'],
      ['rename', 'nested/deep.txt'],
    ])
    direct.close()
    recursive.close()
    vfs.writeFileSync(`${root}/after.txt`, 'after')
    await Promise.resolve()
    expect(directEvents).toHaveLength(1)
    expect(recursiveEvents).toHaveLength(2)
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('supports Buffer filenames, file targets, abort closure, and ref state', async () => {
    /**
     * 常量说明：path 用于处理 path 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const path = `${VFS_ROOT}/encoded.txt`
    vfs.writeFileSync(path, 'before')
    /**
     * 常量说明：controller 用于处理 controller 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const controller = new AbortController()
    /**
     * 常量说明：event 用于处理 event 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolve（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(resolve)，并按返回类型处理结果。
     */
    const event = nextValue<[string, Buffer]>((resolve) => {
      /**
       * 常量说明：watcher 用于处理 watcher 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：eventType（由 TypeScript
       * 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；参数：filename（由 TypeScript
       * 根据调用位置推断的类型）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript
       * 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(eventType,
       * filename)，并按返回类型处理结果。
       */
      const watcher = workerFs.watch(
        new TextEncoder().encode(path),
        { encoding: 'buffer', persistent: false, signal: controller.signal },
        (eventType, filename) => { resolve([eventType, filename as Buffer]) },
      )
      expect(watcher.hasRef()).toBe(false)
      expect(watcher.ref().hasRef()).toBe(true)
      expect(watcher.unref().hasRef()).toBe(false)
    })
    vfs.writeFileSync(path, 'after')
    /**
     * 常量说明：eventType、filename 用于处理 eventType、filename 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const [eventType, filename] = await event
    expect(eventType).toBe('change')
    expect(Buffer.isBuffer(filename)).toBe(true)
    expect(filename.toString()).toBe('encoded.txt')

    /**
     * 常量说明：watcher 用于处理 watcher 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const watcher = workerFs.watch(path, { signal: controller.signal })
    /**
     * 变量说明：closes 用于处理 closes 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let closes = 0
    /**
     * 常量说明：closed 用于处理 closed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolve（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(resolve)，并按返回类型处理结果。
     */
    const closed = nextValue<undefined>((resolve) => {
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
       */
      watcher.on('close', () => {
        closes += 1
        resolve(undefined)
      })
    })
    controller.abort(new Error('stop'))
    await closed
    watcher.close()
    await Promise.resolve()
    expect(closes).toBe(1)
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('supports the string encoding overload and suppresses queued delivery after close', async () => {
    /**
     * 常量说明：encoded 用于处理 encoded 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolve（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(resolve)，并按返回类型处理结果。
     */
    const encoded = nextValue<Buffer>((resolve) => {
      /**
       * 常量说明：watcher 用于处理 watcher 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：_eventType（由 TypeScript
       * 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；参数：filename（由 TypeScript
       * 根据调用位置推断的类型）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript
       * 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(_eventType,
       * filename)，并按返回类型处理结果。
       */
      const watcher = workerFs.watch(VFS_ROOT, 'buffer', (_eventType, filename) => {
        watcher.close()
        resolve(filename as Buffer)
      })
    })
    vfs.writeFileSync(`${VFS_ROOT}/buffer-name.txt`, 'x')
    await expect(encoded).resolves.toEqual(Buffer.from('buffer-name.txt'))

    /**
     * 变量说明：calls 用于处理 calls 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let calls = 0
    /**
     * 常量说明：closed 用于处理 closed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    const closed = workerFs.watch(VFS_ROOT, () => { calls += 1 })
    vfs.writeFileSync(`${VFS_ROOT}/queued.txt`, 'x')
    closed.close()
    await Promise.resolve()
    expect(calls).toBe(0)
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('reports removal of an ancestor to a watched file', async () => {
    /**
     * 常量说明：directory 用于处理 directory 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const directory = `${VFS_ROOT}/removed-parent`
    /**
     * 常量说明：path 用于处理 path 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const path = `${directory}/file.txt`
    vfs.mkdirSync(directory)
    vfs.writeFileSync(path, 'x')
    /**
     * 常量说明：event 用于处理 event 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolve（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(resolve)，并按返回类型处理结果。
     */
    const event = nextValue<[string, string]>((resolve) => {
      /**
       * 常量说明：watcher 用于处理 watcher 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：eventType（由 TypeScript
       * 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；参数：filename（由 TypeScript
       * 根据调用位置推断的类型）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript
       * 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(eventType,
       * filename)，并按返回类型处理结果。
       */
      const watcher = workerFs.watch(path, (eventType, filename) => {
        watcher.close()
        resolve([eventType, String(filename)])
      })
    })
    vfs.rmSync(directory, { recursive: true })
    await expect(event).resolves.toEqual(['rename', 'file.txt'])
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('returns an asynchronously closing watcher for a pre-aborted signal', async () => {
    /**
     * 常量说明：controller 用于处理 controller 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const controller = new AbortController()
    controller.abort(new Error('already stopped'))
    /**
     * 常量说明：order 用于处理 order 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const order: string[] = []
    /**
     * 常量说明：watcher 用于处理 watcher 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const watcher = workerFs.watch(VFS_ROOT, { signal: controller.signal })
    /**
     * 常量说明：closed 用于处理 closed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolve（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(resolve)，并按返回类型处理结果。
     */
    const closed = nextValue<undefined>((resolve) => {
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
       */
      watcher.once('close', () => {
        order.push('close')
        resolve(undefined)
      })
    })
    order.push('return')
    await closed
    expect(order).toEqual(['return', 'close'])
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    expect(() => { vfs.writeFileSync(`${VFS_ROOT}/after-abort.txt`, 'x') }).not.toThrow()
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('reports an atomic replacement destination as rename even when it existed', async () => {
    /**
     * 常量说明：target 用于处理 target 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const target = `${VFS_ROOT}/target.txt`
    /**
     * 常量说明：replacement 用于处理 replacement 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const replacement = `${VFS_ROOT}/replacement.txt`
    vfs.writeFileSync(target, 'old')
    vfs.writeFileSync(replacement, 'new')
    /**
     * 常量说明：event 用于处理 event 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolve（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(resolve)，并按返回类型处理结果。
     */
    const event = nextValue<[string, string]>((resolve) => {
      /**
       * 常量说明：watcher 用于处理 watcher 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：eventType（由 TypeScript
       * 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；参数：filename（由 TypeScript
       * 根据调用位置推断的类型）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript
       * 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(eventType,
       * filename)，并按返回类型处理结果。
       */
      const watcher = workerFs.watch(VFS_ROOT, (eventType, filename) => {
        if (String(filename) !== 'target.txt') return
        watcher.close()
        resolve([eventType, String(filename)])
      })
    })
    vfs.renameSync(replacement, target)
    await expect(event).resolves.toEqual(['rename', 'target.txt'])
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('supports BigInt watchFile state, default options, and idempotent stop', async () => {
    /**
     * 常量说明：path 用于处理 path 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const path = `${VFS_ROOT}/bigint.txt`
    /**
     * 常量说明：states 用于处理 states 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolve（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(resolve)，并按返回类型处理结果。
     */
    const states = nextValue<[bigint, bigint]>((resolve) => {
      /**
       * 常量说明：watcher 用于处理 watcher 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：current（由 TypeScript
       * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：previous（由 TypeScript
       * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(current, previous)，
       * 并按返回类型处理结果。
       */
      const watcher = workerFs.watchFile(new URL(`file://${path}`), { bigint: true, interval: 1 }, (current, previous) => {
        resolve([current.size as bigint, previous.size as bigint])
      })
      expect(watcher.hasRef()).toBe(true)
      expect(watcher.unref().hasRef()).toBe(false)
      expect(watcher.ref().hasRef()).toBe(true)
    })
    vfs.writeFileSync(path, 'big')
    await expect(states).resolves.toEqual([3n, 0n])
    workerFs.unwatchFile(path)
    workerFs.unwatchFile(path)

    vfs.writeFileSync(`${VFS_ROOT}/default.txt`, 'x')
    /**
     * 常量说明：listener 用于处理 listener 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     * 功能说明：处理 listener 相关流程；使用场景由所在模块及调用位置决定。
     * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 listener()，并按返回类型处理结果。
     */
    const listener = (): void => {}
    /**
     * 常量说明：defaultWatcher 用于处理 defaultWatcher 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const defaultWatcher = workerFs.watchFile(`${VFS_ROOT}/default.txt`, listener)
    expect(defaultWatcher.hasRef()).toBe(true)
    defaultWatcher.close()
    defaultWatcher.close()
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    expect(() => workerFs.watchFile(`${VFS_ROOT}/default.txt`, {})).toThrow(/listener/)

    /**
     * 变量说明：cancelledCalls 用于处理 cancelledCalls 相关数据，作用于当前作用域；其值可能随流程推进而变化，
     * 读写时需遵守声明类型和所在生命周期。
     */
    let cancelledCalls = 0
    /**
     * 常量说明：cancelled 用于处理 cancelled 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    const cancelled = workerFs.watchFile(`${VFS_ROOT}/never-created`, { interval: 1 }, () => { cancelledCalls += 1 })
    cancelled.close()
    cancelled.close()
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolve（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(resolve)，并按返回类型处理结果。
     */
    await new Promise<void>((resolve) => { setTimeout(resolve, 5) })
    expect(cancelledCalls).toBe(0)
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('propagates non-absence stat failures from watchFile', () => {
    /**
     * 常量说明：failure 用于处理 failure 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const failure = Object.assign(new Error('denied'), { code: 'EACCES' })
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    vi.spyOn(vfs, 'statSync').mockImplementationOnce(() => { throw failure })
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    expect(() => workerFs.watchFile(`${VFS_ROOT}/denied`, () => {})).toThrow(failure)
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('exposes promise watch as an abortable async iterator', async () => {
    /**
     * 常量说明：controller 用于处理 controller 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const controller = new AbortController()
    /**
     * 常量说明：iterator 用于处理 iterator 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const iterator = workerFsp.watch(VFS_ROOT, { signal: controller.signal })[Symbol.asyncIterator]()
    /**
     * 常量说明：event 用于处理 event 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const event = iterator.next()
    vfs.writeFileSync(`${VFS_ROOT}/async.txt`, 'x')
    await expect(event).resolves.toEqual({ done: false, value: { eventType: 'rename', filename: 'async.txt' } })
    /**
     * 常量说明：failed 用于处理 failed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const failed = iterator.next()
    /**
     * 常量说明：completed 用于处理 completed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const completed = iterator.next()
    controller.abort()
    await expect(failed).rejects.toMatchObject({ name: 'AbortError', code: 'ABORT_ERR' })
    await expect(completed).resolves.toEqual({ done: true, value: undefined })
    await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined })
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('rejects the first promise-watch read for a pre-aborted signal', async () => {
    /**
     * 常量说明：controller 用于处理 controller 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const controller = new AbortController()
    /**
     * 常量说明：reason 用于处理 reason 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const reason = new Error('already stopped')
    controller.abort(reason)
    /**
     * 常量说明：iterator 用于处理 iterator 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const iterator = workerFsp.watch(VFS_ROOT, { signal: controller.signal })[Symbol.asyncIterator]()
    await expect(iterator.next()).rejects.toMatchObject({ name: 'AbortError', code: 'ABORT_ERR', cause: reason })
    await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined })
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('lets promise-watch return interrupt a pending next call', async () => {
    /**
     * 常量说明：iterator 用于处理 iterator 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const iterator = workerFsp.watch(VFS_ROOT)[Symbol.asyncIterator]()
    /**
     * 常量说明：pending 用于处理 pending 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const pending = iterator.next()
    await expect(iterator.return?.()).resolves.toEqual({ done: true, value: undefined })
    await expect(pending).resolves.toEqual({ done: true, value: undefined })
    vfs.writeFileSync(`${VFS_ROOT}/after-return.txt`, 'x')
    await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined })
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('propagates promise-watch startup and throw failures', async () => {
    /**
     * 常量说明：missing 用于处理 missing 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const missing = workerFsp.watch(`${VFS_ROOT}/missing`)[Symbol.asyncIterator]()
    await expect(missing.next()).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(missing.next()).resolves.toEqual({ done: true, value: undefined })

    /**
     * 常量说明：iterator 用于处理 iterator 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const iterator = workerFsp.watch(VFS_ROOT)[Symbol.asyncIterator]()
    /**
     * 常量说明：reason 用于处理 reason 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const reason = { reason: 'caller stopped iteration' }
    if (iterator.throw === undefined) throw new Error('watch iterator has no throw method')
    await expect(iterator.throw(reason)).rejects.toBe(reason)
    await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined })
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('queues promise-watch events when no next call is waiting', async () => {
    /**
     * 常量说明：iterator 用于处理 iterator 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const iterator = workerFsp.watch(VFS_ROOT)[Symbol.asyncIterator]()
    /**
     * 常量说明：first 用于处理 first 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const first = iterator.next()
    vfs.writeFileSync(`${VFS_ROOT}/one.txt`, 'one')
    vfs.writeFileSync(`${VFS_ROOT}/two.txt`, 'two')
    await expect(first).resolves.toEqual({ done: false, value: { eventType: 'rename', filename: 'one.txt' } })
    await expect(iterator.next()).resolves.toEqual({ done: false, value: { eventType: 'rename', filename: 'two.txt' } })
    await expect(iterator.return?.()).resolves.toEqual({ done: true, value: undefined })
    await expect(iterator.return?.()).resolves.toEqual({ done: true, value: undefined })
  })
})
