/**
 * The image byte envelope: the worker inflates one gzip member off the response
 * stream and refuses anything else by name.
 *
 * The refusal is the load-bearing case. A deployment that serves a plain tar, a
 * truncated download, or a proxy's HTML error page under the image URL would
 * otherwise reach the tar reader, which reports a corrupt header field and says
 * nothing about what arrived — so the check has to name the source and the format
 * it expected. It also has to survive chunking: the two identification bytes may
 * arrive one at a time, which the single-byte case below feeds deliberately.
 * @remarks 文件说明：文件职责：验证 experimental/webworker-runtime 中 image gzip spec
 * 相关行为与失败场景。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。；产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。；
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。；
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 */
import { gzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { inflateImage, inflateImageStream } from '../../src/storage/image-gzip.ts'
import { loadVfsImage } from '../../src/storage/memory.ts'
import { packTar } from '../../src/storage/tar.ts'

/**
 * 常量说明：encoder 用于处理 encoder 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const encoder = new TextEncoder()
/**
 * 常量说明：decoder 用于处理 decoder 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const decoder = new TextDecoder()

/** A two-entry archive, as the packer would lay one out under the virtual root.
 * @remarks 中文说明：常量说明：archive 用于处理 archive 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。；功能说明：处理 archive 相关流程；使用场景由所在模块及调用位置决定。；返回值：Uint8Array；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 archive()，并按返回类型处理结果。 */
const archive = (): Uint8Array => packTar({
  'config/cordis.yml': encoder.encode('- id: subject\n'),
  'node_modules/@scope/pkg/lib/index.js': encoder.encode('exports.answer = 42\n'),
})

/** The bytes as a body delivered `size` bytes at a time, the way a transport may.
 * @remarks 中文说明：常量说明：chunked 用于处理 chunked 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。；功能说明：处理 chunked 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：bytes（Uint8Array）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：size（number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：ReadableStream<Uint8Array>；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 chunked(bytes, size)，并按返回类型处理结果。 */
const chunked = (bytes: Uint8Array, size: number): ReadableStream<Uint8Array> => {
  /**
   * 变量说明：at 用于处理 at 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let at = 0
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：controller（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(controller)，并按返回类型处理结果。
   */
  return new ReadableStream<Uint8Array>({
    pull: (controller): void => {
      if (at >= bytes.byteLength) {
        controller.close()
        return
      }
      controller.enqueue(bytes.slice(at, at + size))
      at += size
    },
  })
}

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
describe('image gzip envelope', () => {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('inflates a compressed image into the archive the packer wrote', async () => {
    /**
     * 常量说明：tar 用于处理 tar 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const tar = archive()
    /**
     * 常量说明：inflated 用于处理 inflated 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const inflated = await inflateImage(gzipSync(tar), 'the spec image')
    expect(inflated.byteLength).toBe(tar.byteLength)
    expect([...inflated]).toEqual([...tar])
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('inflates a body delivered one byte at a time', async () => {
    /**
     * 常量说明：tar 用于处理 tar 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const tar = archive()
    /**
     * 常量说明：inflated 用于处理 inflated 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const inflated = await inflateImageStream(chunked(gzipSync(tar), 1), 'the spec image')
    expect([...inflated]).toEqual([...tar])
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('mounts an inflated image through the real VFS loader', async () => {
    /**
     * 常量说明：vfs 用于处理 vfs 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const vfs = loadVfsImage(await inflateImage(gzipSync(archive()), 'the spec image'), '/dsh')
    expect(vfs.existsSync('/dsh/node_modules/@scope/pkg/lib/index.js')).toBe(true)
    expect(decoder.decode(vfs.readFileSync('/dsh/config/cordis.yml') as Uint8Array)).toBe('- id: subject\n')
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('refuses an uncompressed tar, naming the source and the expected member', async () => {
    await expect(inflateImage(archive(), 'https://example.test/vfs-image.tar.gz')).rejects.toThrow(
      /https:\/\/example\.test\/vfs-image\.tar\.gz is not the gzip-compressed tar .*expected a member starting 1f 8b, read/,
    )
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('refuses a page served in the image\'s place, quoting what it read', async () => {
    /**
     * 常量说明：page 用于处理 page 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const page = encoder.encode('<!doctype html><title>404</title>')
    await expect(inflateImage(page, 'the image bytes')).rejects.toThrow(/read 3c 21 64 6f 63 74 79 70/)
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('refuses a body that ends before the header, one byte at a time', async () => {
    await expect(inflateImageStream(chunked(new Uint8Array([0x1f]), 1), 'the spec image'))
      .rejects.toThrow(/expected a member starting 1f 8b, read 1f/)
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('refuses an empty body as such', async () => {
    await expect(inflateImage(new Uint8Array(0), 'the spec image')).rejects.toThrow(/read an empty body/)
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('refuses a truncated gzip member instead of mounting a partial archive', async () => {
    /**
     * 常量说明：compressed 用于处理 compressed 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const compressed = gzipSync(archive())
    await expect(inflateImage(compressed.subarray(0, compressed.byteLength - 64), 'the spec image')).rejects.toThrow()
  })
})
