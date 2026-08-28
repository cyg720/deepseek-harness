/**
 * The image byte envelope. The packer writes one gzip member holding the ustar
 * archive, and the worker inflates it with the platform's own decompressor before
 * the tar reader sees a byte — `storage/tar.ts` stays a pure ustar reader with no
 * codec in it.
 *
 * Inflation runs on the fetch stream rather than on downloaded bytes: the
 * decompressor consumes each chunk as it lands, so unpacking overlaps the
 * download instead of following it, and the compressed copy never has to be held
 * whole in memory beside the archive it produces.
 *
 * One format, no negotiation: a body that does not start a gzip member is refused
 * by name, in the stream, before the decompressor sees it. Without that check a
 * plain tar, a truncated download, or a proxy's HTML error page would reach
 * `parseTar` and fail as a corrupt header field, which says nothing about what
 * the deployment actually served.
 * @module @deepseek-ai/dsh-experimental-webworker-runtime/src/storage/image-gzip
 */

/** gzip member identification bytes (RFC 1952 §2.3.1).
 * @remarks 文件说明：文件职责：实现 experimental/webworker-runtime 中 image gzip 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/webworker-runtime 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 →
 * 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。
 * @remarks 中文说明：常量说明：GZIP_MAGIC 用于处理 GZIP_MAGIC 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
const GZIP_MAGIC = [0x1f, 0x8b] as const

/** Bytes of a refused body quoted in the failure, enough to recognize text served in its place.
 * @remarks 中文说明：常量说明：QUOTED_BYTES 用于处理 QUOTED_BYTES 相关数据，作用于当前作用域；
 * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
const QUOTED_BYTES = 8

/**
 * 常量说明：hex 用于处理 hex 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 * 功能说明：处理 hex 相关流程；使用场景由所在模块及调用位置决定。
 * @param bytes （Uint8Array）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns string；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 hex(bytes)，并按返回类型处理结果。
 */
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：byte（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(byte)，并按返回类型处理结果。
 */
const hex = (bytes: Uint8Array): string =>
  [...bytes.slice(0, QUOTED_BYTES)].map(byte => byte.toString(16).padStart(2, '0')).join(' ')

/**
 * A pass-through that refuses a body which is not a gzip member.
 *
 * The check spans chunks: a transport may deliver the first byte alone, so the
 * head is held until it can be judged and then forwarded intact. A body that ends
 * before two bytes arrive is refused in `flush`, where "too short" is the only
 * thing left to report.
 * @param source - the image URL, or how the bytes arrived; named in a refusal.
 * @returns The transform to pipe the body through before the decompressor.
 * @remarks 中文说明：功能说明：处理 requireGzipMember 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：source（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：TransformStream<Uint8Array, Uint8Array>；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 requireGzipMember(source)，并按返回类型处理结果。
 */
function requireGzipMember(source: string): TransformStream<Uint8Array, Uint8Array> {
  /**
   * 变量说明：head 用于处理 head 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let head: Uint8Array = new Uint8Array(0)
  /**
   * 变量说明：judged 用于处理 judged 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let judged = false
  /**
   * 常量说明：refuse 用于处理 refuse 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   * 功能说明：处理 refuse 相关流程；使用场景由所在模块及调用位置决定。
   * @param read （Uint8Array）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns Error；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 refuse(read)，并按返回类型处理结果。
   */
  const refuse = (read: Uint8Array): Error => new Error(
    `webworker image: ${source} is not the gzip-compressed tar this deployment serves as its image `
    + `(expected a member starting 1f 8b, read ${read.byteLength === 0 ? 'an empty body' : hex(read)}); `
    + 'a host that answered with a Content-Encoding the transport already decoded, or a build that wrote '
    + 'the archive uncompressed, arrives exactly this way',
  )
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：chunk（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：controller（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(chunk, controller)，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：void；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  return new TransformStream<Uint8Array, Uint8Array>({
    transform: (chunk, controller): void => {
      if (judged) {
        controller.enqueue(chunk)
        return
      }
      /**
       * 常量说明：merged 用于处理 merged 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const merged = new Uint8Array(head.byteLength + chunk.byteLength)
      merged.set(head)
      merged.set(chunk, head.byteLength)
      head = merged
      if (head.byteLength < GZIP_MAGIC.length) return
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：byte（由 TypeScript
       * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：at（由 TypeScript
       * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(byte, at)，并按返回类型处理结果。
       */
      if (GZIP_MAGIC.some((byte, at) => head[at] !== byte)) throw refuse(head)
      judged = true
      controller.enqueue(head)
    },
    flush: (): void => {
      if (!judged) throw refuse(head)
    },
  })
}

/**
 * Inflate a packed VFS image as it arrives.
 * @param body - the image body, straight from `fetch` or wrapped around bytes.
 * @param source - the image URL, or how the bytes arrived; named in a refusal.
 * @returns the ustar archive the image carries.
 * @throws When the body does not start a gzip member, or the member is corrupt.
 * @remarks 中文说明：功能说明：处理 inflateImageStream 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：body（ReadableStream<Uint8Array>）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：source（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：Promise<Uint8Array>；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * inflateImageStream(body, source)，并按返回类型处理结果。
 */
export async function inflateImageStream(body: ReadableStream<Uint8Array>, source: string): Promise<Uint8Array> {
  /**
   * 常量说明：inflated 用于处理 inflated 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const inflated = body
    .pipeThrough(requireGzipMember(source))
    // The decompressor's writable half takes any BufferSource, which a
    // `ReadableStream<Uint8Array>` is not assignable to.
    .pipeThrough(new DecompressionStream('gzip') as unknown as TransformStream<Uint8Array, Uint8Array>)
  return new Uint8Array(await new Response(inflated).arrayBuffer())
}

/**
 * Inflate a packed VFS image held in memory.
 *
 * The bytes become a body so both entries run the same stream: one decompression
 * path, one refusal, whether the image came off the network or out of a caller's
 * buffer.
 * @param bytes - the image bytes.
 * @param source - how the bytes arrived; named in a refusal.
 * @returns the ustar archive the image carries.
 * @throws When the bytes do not start a gzip member, or the member is corrupt.
 * @remarks 中文说明：功能说明：处理 inflateImage 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：bytes（Uint8Array）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：source（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：Promise<Uint8Array>；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * inflateImage(bytes, source)，并按返回类型处理结果。
 */
export async function inflateImage(bytes: Uint8Array, source: string): Promise<Uint8Array> {
  /**
   * 常量说明：body 用于处理 body 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const body = new Response(bytes as Uint8Array<ArrayBuffer>).body
  if (body === null) throw new Error(`webworker image: ${source} produced no readable body`)
  return await inflateImageStream(body, source)
}
