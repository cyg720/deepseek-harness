/**
 * Uncompressed ustar archive: the VFS image format. One fetch delivers the
 * whole tree, and the reader hands out subarray views into the fetched buffer,
 * so mounting copies nothing and no inflate step runs inside the worker.
 *
 * Hand-rolled on purpose: both sides need synchronous in-memory operation and
 * the reader ships inside the worker bundle, where the streaming tar packages
 * would drag Node stream shims back in. The subset is plain ustar — regular
 * files and directories, names up to 255 bytes via the name-prefix split — and
 * anything outside it fails loud on either side.
 * @module @deepseek-ai/dsh-experimental-webworker-runtime/src/storage/tar
 * @remarks 文件说明：文件职责：实现 experimental/webworker-runtime 中 tar 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/webworker-runtime 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 →
 * 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。
 * @remarks 中文说明：常量说明：encoder 用于处理 encoder 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */

const encoder = new TextEncoder()
/**
 * 常量说明：decoder 用于处理 decoder 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const decoder = new TextDecoder()
/**
 * 常量说明：BLOCK 用于处理 BLOCK 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const BLOCK = 512

/** One archive entry; a directory carries empty bytes and a trailing-slash name. */
export interface TarEntry {
  readonly name: string
  readonly bytes: Uint8Array
  readonly directory: boolean
  /** Permission bits from the header's mode field (`0o777` mask). */
  readonly mode: number
}

/** Write an octal field: zero-padded digits with a terminating NUL.
 * @remarks 中文说明：功能说明：写入 Octal 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：header（Uint8Array）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：offset（number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：length（number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：value（number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 writeOctal(header, offset, length,
 * value)，并按返回类型处理结果。 */
function writeOctal(header: Uint8Array, offset: number, length: number, value: number): void {
  header.set(encoder.encode(value.toString(8).padStart(length - 1, '0')), offset)
}

/**
 * Split an entry name into the ustar name and prefix fields.
 * @param name - Full entry name.
 * @returns The two fields; the prefix is empty when the name fits directly.
 * @throws When no slash yields name ≤ 100 and prefix ≤ 155 bytes: the entry
 * cannot be archived and a silently truncated name would corrupt the image.
 * @remarks 中文说明：功能说明：处理 splitName 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：name（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：{ name: string;
 * prefix: string }；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * splitName(name)，并按返回类型处理结果。
 */
function splitName(name: string): { name: string; prefix: string } {
  if (encoder.encode(name).length <= 100) return { name, prefix: '' }
  /**
   * 变量说明：index 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (let index = name.length - 1; index > 0; index -= 1) {
    if (name[index] !== '/') continue
    /**
     * 常量说明：prefix 用于处理 prefix 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const prefix = name.slice(0, index)
    /**
     * 常量说明：rest 用于处理 rest 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const rest = name.slice(index + 1)
    if (encoder.encode(rest).length <= 100 && encoder.encode(prefix).length <= 155) {
      return { name: rest, prefix }
    }
  }
  throw new Error(`vfs tar: entry name does not fit the ustar name+prefix split: ${name}`)
}

/**
 * Pack entries into one uncompressed ustar archive.
 *
 * Entries keep their given order; names ending in a slash become directory
 * entries. Contents are written verbatim — compression belongs to the HTTP
 * transport, not to the archive.
 * @param files - Entry name to content bytes.
 * @returns The archive bytes.
 * @remarks 中文说明：功能说明：处理 packTar 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：files（Readonly<Record<string, Uint8Array>>）：指定要读取、写入或匹配的文件位置；
 * 必须满足声明的类型及调用时序要求。；返回值：Uint8Array；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 packTar(files)，并按返回类型处理结果。
 */
export function packTar(files: Readonly<Record<string, Uint8Array>>): Uint8Array {
  /**
   * 常量说明：chunks 用于处理 chunks 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const chunks: Uint8Array[] = []
  /**
   * 变量说明：entryName、bytes 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (const [entryName, bytes] of Object.entries(files)) {
    /**
     * 常量说明：directory 用于处理 directory 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const directory = entryName.endsWith('/')
    /**
     * 常量说明：size 用于处理 size 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const size = directory ? 0 : bytes.length
    /**
     * 常量说明：name、prefix 用于处理 name、prefix 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const { name, prefix } = splitName(entryName)
    /**
     * 常量说明：header 用于处理 header 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const header = new Uint8Array(BLOCK)
    header.set(encoder.encode(name), 0)
    writeOctal(header, 100, 8, directory ? 0o755 : 0o644)
    writeOctal(header, 108, 8, 0)
    writeOctal(header, 116, 8, 0)
    writeOctal(header, 124, 12, size)
    writeOctal(header, 136, 12, 0)
    header.fill(0x20, 148, 156)
    header[156] = directory ? 0x35 : 0x30
    header.set(encoder.encode('ustar'), 257)
    header.set(encoder.encode('00'), 263)
    header.set(encoder.encode(prefix), 345)
    /**
     * 变量说明：checksum 用于处理 checksum 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let checksum = 0
    /**
     * 变量说明：byte 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const byte of header) checksum += byte
    header.set(encoder.encode(checksum.toString(8).padStart(6, '0')), 148)
    header[154] = 0
    header[155] = 0x20
    chunks.push(header)
    if (size > 0) {
      chunks.push(bytes)
      /**
       * 常量说明：padding 用于处理 padding 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const padding = size % BLOCK
      if (padding !== 0) chunks.push(new Uint8Array(BLOCK - padding))
    }
  }
  chunks.push(new Uint8Array(BLOCK * 2))
  /**
   * 常量说明：total 用于处理 total 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：sum（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：chunk（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(sum, chunk)，并按返回类型处理结果。
   */
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  /**
   * 常量说明：archive 用于处理 archive 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const archive = new Uint8Array(total)
  /**
   * 变量说明：offset 用于处理 offset 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let offset = 0
  /**
   * 变量说明：chunk 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (const chunk of chunks) {
    archive.set(chunk, offset)
    offset += chunk.length
  }
  return archive
}

/** @returns The NUL-terminated string in one header field.
 * @remarks 中文说明：功能说明：读取 Field 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：header（Uint8Array）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：offset（number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：length（number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：string；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 readField(header, offset, length)，
 * 并按返回类型处理结果。 */
function readField(header: Uint8Array, offset: number, length: number): string {
  /**
   * 变量说明：end 用于处理 end 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let end = offset
  while (end < offset + length && header[end] !== 0) end += 1
  return decoder.decode(header.subarray(offset, end))
}

/**
 * Parse an uncompressed ustar archive.
 *
 * File bytes are subarray views into `archive`, not copies; callers own the
 * aliasing. Entry kinds outside the written subset (links, PAX extensions)
 * fail loud instead of being skipped.
 * @param archive - Archive bytes.
 * @returns Entries in archive order.
 * @remarks 中文说明：功能说明：解析 Tar 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：archive（Uint8Array）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：TarEntry[]；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 parseTar(archive)，
 * 并按返回类型处理结果。
 */
export function parseTar(archive: Uint8Array): TarEntry[] {
  /**
   * 常量说明：entries 用于处理 entries 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const entries: TarEntry[] = []
  /**
   * 变量说明：offset 用于处理 offset 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let offset = 0
  while (offset + BLOCK <= archive.length) {
    /**
     * 常量说明：header 用于处理 header 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const header = archive.subarray(offset, offset + BLOCK)
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：byte（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(byte)，并按返回类型处理结果。
     */
    if (header.every(byte => byte === 0)) break
    /**
     * 常量说明：short 用于处理 short 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const short = readField(header, 0, 100)
    /**
     * 常量说明：prefix 用于处理 prefix 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const prefix = readField(header, 345, 155)
    /**
     * 常量说明：name 用于处理 name 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const name = prefix === '' ? short : `${prefix}/${short}`
    /**
     * 常量说明：size 用于处理 size 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const size = Number.parseInt(readField(header, 124, 12).trim() || '0', 8)
    /**
     * 常量说明：mode 用于处理 mode 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const mode = Number.parseInt(readField(header, 100, 8).trim() || '0', 8) & 0o777
    /**
     * 常量说明：typeflag 用于处理 typeflag 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const typeflag = header[156]
    /**
     * 常量说明：directory 用于处理 directory 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const directory = typeflag === 0x35 || name.endsWith('/')
    if (typeflag !== 0x30 && typeflag !== 0 && typeflag !== 0x35) {
      throw new Error(`vfs tar: unsupported entry type ${String.fromCharCode(typeflag ?? 0)} for "${name}"`)
    }
    /**
     * 常量说明：dataStart 用于处理 dataStart 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const dataStart = offset + BLOCK
    entries.push({ name, bytes: archive.subarray(dataStart, dataStart + size), directory, mode })
    offset = dataStart + Math.ceil(size / BLOCK) * BLOCK
  }
  return entries
}
