/**
 * `node:url` for the worker: the two conversions the host tree uses, plus the
 * WHATWG classes the browser already provides. VFS paths are POSIX, so the
 * file-URL mapping is the simple percent-encoding pair.
 */

/**
 * Filesystem path of a `file:` URL.
 * @param url - file URL or its string form.
 * @returns the decoded POSIX path.
 * @remarks 文件说明：文件职责：实现 experimental/webworker-runtime 中 url 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/webworker-runtime 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 →
 * 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。
 * @remarks 中文说明：功能说明：处理 fileURLToPath 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：url（string | URL）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：string；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 fileURLToPath(url)，
 * 并按返回类型处理结果。
 */
export function fileURLToPath(url: string | URL): string {
  /**
   * 常量说明：parsed 用于处理 parsed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const parsed = typeof url === 'string' ? new URL(url) : url
  if (parsed.protocol !== 'file:') {
    throw new TypeError(`The URL must be of scheme file (received ${parsed.protocol})`)
  }
  return decodeURIComponent(parsed.pathname)
}

/**
 * `file:` URL of a filesystem path.
 * @param path - absolute or relative POSIX path.
 * @returns the URL.
 * @remarks 中文说明：功能说明：处理 pathToFileURL 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：path（string）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；返回值：URL；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 pathToFileURL(path)，并按返回类型处理结果。
 */
export function pathToFileURL(path: string): URL {
  // Only the characters the URL path parser would not escape itself are escaped
  // here (Node does the same), so `@`, `:` and `~` survive verbatim — scoped
  // package directories must round-trip unchanged.
  /**
   * 常量说明：escaped 用于处理 escaped 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const escaped = path
    .replaceAll('%', '%25')
    .replaceAll('\\', '%5C')
    .replaceAll('\n', '%0A')
    .replaceAll('\r', '%0D')
    .replaceAll('\t', '%09')
  /**
   * 常量说明：url 用于处理 url 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const url = new globalThis.URL('file:///')
  url.pathname = escaped.startsWith('/') ? escaped : `/${escaped}`
  return url
}

/**
 * Absolute URL from a specifier and its base.
 * @param specifier - relative or absolute specifier.
 * @param base - base URL.
 * @returns the resolved URL string.
 * @remarks 中文说明：功能说明：解析 resolve 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：specifier（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：base（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：string；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 resolve(specifier, base)，并按返回类型处理结果。
 */
export function resolve(specifier: string, base: string): string {
  return new URL(specifier, base).toString()
}

/** WHATWG URL class, as `node:url` re-exports it.
 * @remarks 中文说明：常量说明：UrlClass 用于处理 UrlClass 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
const UrlClass = globalThis.URL

/** WHATWG URLSearchParams class, as `node:url` re-exports it.
 * @remarks 中文说明：常量说明：UrlSearchParamsClass 用于处理 UrlSearchParamsClass 相关数据，
 * 作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
const UrlSearchParamsClass = globalThis.URLSearchParams

export { UrlClass as URL, UrlSearchParamsClass as URLSearchParams }

/** CommonJS interop marker: the worker loader hands `default` to default imports (see ./builtins.ts).
 * @remarks 中文说明：常量说明：__esModule 用于处理 __esModule 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
export const __esModule = true

/**
 * The `node:url` declarations this module stands in for. The two classes stay
 * the browser globals this worker runs on: the DOM and Node libraries declare
 * `URL.createObjectURL` and the `URLSearchParams` initializer union differently,
 * and re-declaring either would replace the objects the platform hands out.
 */
type NodeFace = Partial<Omit<typeof import('node:url'), 'URL' | 'URLSearchParams'>>
  & Record<'URL' | 'URLSearchParams', unknown>

/** CommonJS default export: the members `require()` hands a caller of this module. */
export default {
  fileURLToPath, pathToFileURL, resolve, URL: UrlClass, URLSearchParams: UrlSearchParamsClass,
} satisfies NodeFace
