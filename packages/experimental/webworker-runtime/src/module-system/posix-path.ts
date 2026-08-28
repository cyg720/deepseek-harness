/**
 * POSIX path helpers for the worker VFS: one absolute root, no drive letters,
 * no symlinks.
 *
 * **Not a `node:path` substitute.** {@link dirname}, {@link basename}, and
 * {@link parse} normalize first, because every caller here hands the result to
 * the VFS, which keys files by normalized absolute path — `dirname('/a/b/..')`
 * answers `/`, the directory that actually holds the entry. Node's three are
 * purely lexical and answer `/a/b`. A `node:path` proxy owes callers Node's
 * literal answers, so it needs its own port of Node's implementation rather than
 * a facade over this module; measured over ~200 cases, the normalizing and
 * lexical forms diverge in 45, all in these three functions. The Node-facing
 * port is pinned separately by `../../tests/node/path-diff.spec.ts`.
 * @module @deepseek-ai/dsh-experimental-webworker-runtime/src/module-system/posix-path
 */

/** Path separator of the virtual filesystem.
 * @remarks 文件说明：文件职责：实现 experimental/webworker-runtime 中 posix path 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/webworker-runtime 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 →
 * 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。
 * @remarks 中文说明：常量说明：SEP 用于处理 SEP 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
export const SEP = '/'

/**
 * Collapse `.` and `..` segments.
 * @param path - Path with any number of separators.
 * @returns Normalized path; a relative input keeps leading `..` segments.
 * @remarks 中文说明：功能说明：规范化 normalize 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：path（string）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；返回值：string；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 normalize(path)，
 * 并按返回类型处理结果。
 */
export function normalize(path: string): string {
  /**
   * 常量说明：absolute 用于处理 absolute 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const absolute = path.startsWith(SEP)
  /**
   * 常量说明：trailing 用于处理 trailing 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const trailing = path.length > 1 && path.endsWith(SEP)
  /**
   * 常量说明：out 用于处理 out 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const out: string[] = []
  /**
   * 变量说明：segment 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (const segment of path.split(SEP)) {
    if (segment === '' || segment === '.') continue
    if (segment === '..' && out.length > 0 && out[out.length - 1] !== '..') {
      out.pop()
      continue
    }
    if (segment === '..' && absolute) continue
    out.push(segment)
  }
  /**
   * 常量说明：body 用于处理 body 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const body = out.join(SEP)
  if (absolute) return SEP + body + (trailing && body !== '' ? SEP : '')
  if (body === '') return trailing ? './' : '.'
  return body + (trailing ? SEP : '')
}

/**
 * Join segments and normalize the result.
 * @param segments - Path segments.
 * @returns Joined path, `.` when nothing remains.
 * @remarks 中文说明：功能说明：处理 join 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：segments（string[]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：string；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 join(segments)，并按返回类型处理结果。
 */
export function join(...segments: string[]): string {
  /**
   * 常量说明：joined 用于处理 joined 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：segment（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(segment)，并按返回类型处理结果。
   */
  const joined = segments.filter(segment => segment !== '').join(SEP)
  return joined === '' ? '.' : normalize(joined)
}

/**
 * Resolve segments right to left against a base directory.
 * @param segments - Path segments; the first absolute one wins.
 * @returns Absolute normalized path.
 * @remarks 中文说明：功能说明：解析 resolve 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：segments（string[]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：string；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 resolve(segments)，
 * 并按返回类型处理结果。
 */
export function resolve(...segments: string[]): string {
  /**
   * 变量说明：path 用于处理 path 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let path = ''
  /**
   * 变量说明：segment 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (const segment of [...segments].reverse()) {
    if (segment === '') continue
    path = path === '' ? segment : `${segment}${SEP}${path}`
    if (segment.startsWith(SEP)) break
  }
  return normalize(path.startsWith(SEP) ? path : `${SEP}${path}`)
}

/**
 * Directory part of a path, after normalization (see the module note).
 * @param path - Path to inspect.
 * @returns Parent path; `/` for root children and `.` for bare names.
 * @remarks 中文说明：功能说明：处理 dirname 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：path（string）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；返回值：string；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 dirname(path)，并按返回类型处理结果。
 */
export function dirname(path: string): string {
  /**
   * 常量说明：normalized 用于处理 normalized 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const normalized = normalize(path).replace(/\/+$/, '')
  /**
   * 常量说明：index 用于处理 index 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const index = normalized.lastIndexOf(SEP)
  if (index < 0) return '.'
  if (index === 0) return SEP
  return normalized.slice(0, index)
}

/**
 * Last segment of a path, after normalization (see the module note).
 * @param path - Path to inspect.
 * @param suffix - Optional suffix to strip.
 * @returns Final segment.
 * @remarks 中文说明：功能说明：处理 basename 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：path（string）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；
 * 参数说明：suffix（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：string；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 basename(path, suffix)，并按返回类型处理结果。
 */
export function basename(path: string, suffix?: string): string {
  /**
   * 常量说明：normalized 用于处理 normalized 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const normalized = normalize(path).replace(/\/+$/, '')
  /**
   * 常量说明：name 用于处理 name 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const name = normalized.slice(normalized.lastIndexOf(SEP) + 1)
  if (suffix !== undefined && suffix !== name && name.endsWith(suffix)) return name.slice(0, -suffix.length)
  return name
}

/**
 * Extension of the last segment, dot included.
 * @param path - Path to inspect.
 * @returns Extension, or an empty string when there is none.
 * @remarks 中文说明：功能说明：处理 extname 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：path（string）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；返回值：string；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 extname(path)，并按返回类型处理结果。
 */
export function extname(path: string): string {
  /**
   * 常量说明：name 用于处理 name 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const name = basename(path)
  /**
   * 常量说明：index 用于处理 index 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const index = name.lastIndexOf('.')
  return index <= 0 ? '' : name.slice(index)
}

/**
 * Report whether a path starts at the root.
 * @param path - Path to inspect.
 * @returns True for absolute paths.
 * @remarks 中文说明：功能说明：判断是否为 Absolute 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：path（string）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；返回值：boolean；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 isAbsolute(path)，
 * 并按返回类型处理结果。
 */
export function isAbsolute(path: string): boolean {
  return path.startsWith(SEP)
}

/**
 * Relative path from one absolute path to another.
 * @param from - Source directory.
 * @param to - Target path.
 * @returns Relative path using `..` segments.
 * @remarks 中文说明：功能说明：处理 relative 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：from（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：to（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：string；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 relative(from, to)，并按返回类型处理结果。
 */
export function relative(from: string, to: string): string {
  /**
   * 常量说明：source 用于处理 source 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：segment（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(segment)，并按返回类型处理结果。
   */
  const source = resolve(from).split(SEP).filter(segment => segment !== '')
  /**
   * 常量说明：target 用于处理 target 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：segment（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(segment)，并按返回类型处理结果。
   */
  const target = resolve(to).split(SEP).filter(segment => segment !== '')
  /**
   * 变量说明：shared 用于处理 shared 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let shared = 0
  while (shared < source.length && shared < target.length && source[shared] === target[shared]) shared += 1
  /**
   * 常量说明：up 用于处理 up 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const up = new Array(source.length - shared).fill('..') as string[]
  return [...up, ...target.slice(shared)].join(SEP)
}

/**
 * Split a path into components, after normalization (see the module note).
 * @param path - Path to split.
 * @returns Root, directory, base name, extension, and stem.
 * @remarks 中文说明：功能说明：解析 parse 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：path（string）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；返回值：{ root: string;
 * dir: string; base: string; ext: string; name: string }；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 parse(path)，并按返回类型处理结果。
 */
export function parse(path: string): { root: string; dir: string; base: string; ext: string; name: string } {
  /**
   * 常量说明：root 用于处理 root 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const root = isAbsolute(path) ? SEP : ''
  /**
   * 常量说明：base 用于处理 base 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const base = basename(path)
  /**
   * 常量说明：ext 用于处理 ext 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const ext = extname(path)
  return { root, dir: dirname(path), base, ext, name: ext === '' ? base : base.slice(0, -ext.length) }
}

/**
 * Node's Windows-only namespaced-path conversion.
 * @param path - the path to convert.
 * @returns The path unchanged; namespaced paths are a Windows concept.
 * @remarks 中文说明：功能说明：处理 toNamespacedPath 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：path（string）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；返回值：string；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 toNamespacedPath(path)，
 * 并按返回类型处理结果。
 */
export function toNamespacedPath(path: string): string {
  return path
}

/**
 * Convert a VFS path into a `file:` URL string.
 * @param path - Absolute VFS path.
 * @returns URL text with each segment percent-encoded.
 * @remarks 中文说明：功能说明：处理 pathToFileUrl 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：path（string）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；返回值：string；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 pathToFileUrl(path)，
 * 并按返回类型处理结果。
 */
export function pathToFileUrl(path: string): string {
  /**
   * 常量说明：absolute 用于处理 absolute 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const absolute = resolve(path)
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：segment（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(segment)，并按返回类型处理结果。
   */
  return `file://${absolute.split(SEP).map(segment => encodeURIComponent(segment)).join(SEP)}`
}

/**
 * Convert a `file:` URL back into a VFS path.
 * @param url - URL text or URL instance.
 * @returns Absolute VFS path.
 * @remarks 中文说明：功能说明：处理 fileUrlToPath 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：url（string | URL）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：string；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 fileUrlToPath(url)，
 * 并按返回类型处理结果。
 */
export function fileUrlToPath(url: string | URL): string {
  /**
   * 常量说明：text 用于处理 text 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const text = typeof url === 'string' ? url : url.href
  if (!text.startsWith('file://')) throw new Error(`webworker vfs: not a file URL: ${text}`)
  return decodeURIComponent(text.slice('file://'.length).replace(/[?#].*$/, '')) || SEP
}
