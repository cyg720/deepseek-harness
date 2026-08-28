/**
 * `node:path` for the worker: the POSIX algorithm, transliterated from Node's
 * implementation. It is NOT a face over the worker host's `posixPath`: that helper
 * normalizes before splitting, so `dirname('/a/b/..')` answers `/` where Node
 * answers `/a/b` (measured: 45 cases diverge between the normalizing helper and
 * Node). `../../../../tests/node/path-diff.spec.ts` pins the port below to
 * Node's answers.
 * A `node:` proxy has to answer what Node answers, since VFS paths were built with
 * Node semantics. `win32` members throw: the worker host reports
 * `process.platform === 'linux'`, so a Windows branch means a bug.
 * @remarks 文件说明：文件职责：实现 experimental/webworker-runtime 中 path 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/webworker-runtime 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 →
 * 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。
 */
import { DSH_ROOT } from '../../../storage/paths.ts'

/**
 * 常量说明：CHAR_DOT 用于处理 CHAR_DOT 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const CHAR_DOT = 46
/**
 * 常量说明：CHAR_FORWARD_SLASH 用于处理 CHAR_FORWARD_SLASH 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const CHAR_FORWARD_SLASH = 47

/** Parsed path object returned by {@link parse}. */
export interface ParsedPath {
  root: string
  dir: string
  base: string
  ext: string
  name: string
}

/**
 * 常量说明：cwd 用于处理 cwd 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 * 功能说明：处理 cwd 相关流程；使用场景由所在模块及调用位置决定。
 * @returns string；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 cwd()，并按返回类型处理结果。
 */
const cwd = (): string => {
  /**
   * 常量说明：scope 用于处理 scope 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const scope = globalThis as { process?: { cwd?: () => string } }
  return scope.process?.cwd?.() ?? DSH_ROOT
}

/**
 * 功能说明：断言 Path 相关流程；使用场景由所在模块及调用位置决定。
 * @param path （unknown）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。
 * @returns asserts path is string；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 assertPath(path)，并按返回类型处理结果。
 */
function assertPath(path: unknown): asserts path is string {
  if (typeof path !== 'string') {
    throw new TypeError(`Path must be a string. Received ${JSON.stringify(path)}`)
  }
}

/** Resolve `.` and `..` segments; `allowAboveRoot` keeps leading `..` for relative inputs.
 * @remarks 中文说明：功能说明：规范化 String 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：path（string）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；
 * 参数说明：allowAboveRoot（boolean）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：string；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 normalizeString(path,
 * allowAboveRoot)，并按返回类型处理结果。 */
function normalizeString(path: string, allowAboveRoot: boolean): string {
  /**
   * 变量说明：res 用于处理 res 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let res = ''
  /**
   * 变量说明：lastSegmentLength 用于处理 lastSegmentLength 相关数据，作用于当前作用域；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  let lastSegmentLength = 0
  /**
   * 变量说明：lastSlash 用于处理 lastSlash 相关数据，作用于当前作用域；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  let lastSlash = -1
  /**
   * 变量说明：dots 用于处理 dots 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let dots = 0
  /**
   * 变量说明：code 用于处理 code 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let code = 0
  /**
   * 变量说明：i 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (let i = 0; i <= path.length; ++i) {
    if (i < path.length) code = path.charCodeAt(i)
    else if (code === CHAR_FORWARD_SLASH) break
    else code = CHAR_FORWARD_SLASH
    if (code === CHAR_FORWARD_SLASH) {
      if (lastSlash === i - 1 || dots === 1) {
        // empty segment or `.`
      } else if (dots === 2) {
        if (res.length < 2 || lastSegmentLength !== 2
          || res.charCodeAt(res.length - 1) !== CHAR_DOT
          || res.charCodeAt(res.length - 2) !== CHAR_DOT) {
          if (res.length > 2) {
            /**
             * 常量说明：lastSlashIndex 用于处理 lastSlashIndex 相关数据，作用于当前作用域；初始化后不可重新赋值，
             * 但对象内部是否可变仍由其类型决定。
             */
            const lastSlashIndex = res.lastIndexOf('/')
            if (lastSlashIndex === -1) {
              res = ''
              lastSegmentLength = 0
            } else {
              res = res.slice(0, lastSlashIndex)
              lastSegmentLength = res.length - 1 - res.lastIndexOf('/')
            }
            lastSlash = i
            dots = 0
            continue
          } else if (res.length !== 0) {
            res = ''
            lastSegmentLength = 0
            lastSlash = i
            dots = 0
            continue
          }
        }
        if (allowAboveRoot) {
          res += res.length > 0 ? '/..' : '..'
          lastSegmentLength = 2
        }
      } else {
        if (res.length > 0) res += `/${path.slice(lastSlash + 1, i)}`
        else res = path.slice(lastSlash + 1, i)
        lastSegmentLength = i - lastSlash - 1
      }
      lastSlash = i
      dots = 0
    } else if (code === CHAR_DOT && dots !== -1) {
      ++dots
    } else {
      dots = -1
    }
  }
  return res
}

/**
 * Resolve a sequence of paths into an absolute path.
 * @param paths - path segments, right to left until an absolute one is found.
 * @returns the absolute, normalized path.
 * @remarks 中文说明：功能说明：解析 resolve 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：paths（string[]）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；返回值：string；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 resolve(paths)，并按返回类型处理结果。
 */
export function resolve(...paths: string[]): string {
  /**
   * 变量说明：resolved 用于处理 resolved 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let resolved = ''
  /**
   * 变量说明：absolute 用于处理 absolute 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let absolute = false
  /**
   * 变量说明：i 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (let i = paths.length - 1; i >= 0 && !absolute; i--) {
    /**
     * 常量说明：path 用于处理 path 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const path = paths[i]
    assertPath(path)
    if (path.length === 0) continue
    resolved = resolved.length === 0 ? path : `${path}/${resolved}`
    absolute = path.charCodeAt(0) === CHAR_FORWARD_SLASH
  }
  if (!absolute) {
    /**
     * 常量说明：base 用于处理 base 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const base = cwd()
    resolved = resolved.length === 0 ? base : `${base}/${resolved}`
    absolute = base.charCodeAt(0) === CHAR_FORWARD_SLASH
  }
  /**
   * 常量说明：normalized 用于处理 normalized 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const normalized = normalizeString(resolved, !absolute)
  if (absolute) return `/${normalized}`
  return normalized.length > 0 ? normalized : '.'
}

/**
 * Normalize a path, resolving `.`, `..`, and duplicate separators.
 * @param path - the path.
 * @returns the normalized path.
 * @remarks 中文说明：功能说明：规范化 normalize 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：path（string）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；返回值：string；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 normalize(path)，
 * 并按返回类型处理结果。
 */
export function normalize(path: string): string {
  assertPath(path)
  if (path.length === 0) return '.'
  /**
   * 常量说明：isAbsolutePath 用于判断是否为 Absolute Path 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const isAbsolutePath = path.charCodeAt(0) === CHAR_FORWARD_SLASH
  /**
   * 常量说明：trailingSeparator 用于处理 trailingSeparator 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const trailingSeparator = path.charCodeAt(path.length - 1) === CHAR_FORWARD_SLASH
  /**
   * 变量说明：normalized 用于处理 normalized 相关数据，作用于当前作用域；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  let normalized = normalizeString(path, !isAbsolutePath)
  if (normalized.length === 0) {
    if (isAbsolutePath) return '/'
    return trailingSeparator ? './' : '.'
  }
  if (trailingSeparator) normalized += '/'
  return isAbsolutePath ? `/${normalized}` : normalized
}

/**
 * Whether the path is absolute.
 * @param path - the path.
 * @returns true when it starts at the root.
 * @remarks 中文说明：功能说明：判断是否为 Absolute 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：path（string）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；返回值：boolean；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 isAbsolute(path)，
 * 并按返回类型处理结果。
 */
export function isAbsolute(path: string): boolean {
  assertPath(path)
  return path.length > 0 && path.charCodeAt(0) === CHAR_FORWARD_SLASH
}

/**
 * Join path segments with the separator, then normalize.
 * @param paths - the segments.
 * @returns the joined path.
 * @remarks 中文说明：功能说明：处理 join 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：paths（string[]）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；返回值：string；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 join(paths)，并按返回类型处理结果。
 */
export function join(...paths: string[]): string {
  if (paths.length === 0) return '.'
  /**
   * 变量说明：joined 用于处理 joined 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let joined: string | undefined
  /**
   * 变量说明：path 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (const path of paths) {
    assertPath(path)
    if (path.length === 0) continue
    joined = joined === undefined ? path : `${joined}/${path}`
  }
  return joined === undefined ? '.' : normalize(joined)
}

/**
 * Relative path from one location to another.
 * @param from - source path.
 * @param to - target path.
 * @returns the relative path, or '' when both resolve identically.
 * @remarks 中文说明：功能说明：处理 relative 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：from（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：to（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：string；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 relative(from, to)，并按返回类型处理结果。
 */
export function relative(from: string, to: string): string {
  assertPath(from)
  assertPath(to)
  if (from === to) return ''
  /**
   * 常量说明：fromResolved 用于处理 fromResolved 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const fromResolved = resolve(from)
  /**
   * 常量说明：toResolved 用于处理 toResolved 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const toResolved = resolve(to)
  if (fromResolved === toResolved) return ''
  /**
   * 常量说明：fromParts 用于处理 fromParts 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：part（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(part)，并按返回类型处理结果。
   */
  const fromParts = fromResolved.split('/').filter(part => part.length > 0)
  /**
   * 常量说明：toParts 用于处理 toParts 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：part（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(part)，并按返回类型处理结果。
   */
  const toParts = toResolved.split('/').filter(part => part.length > 0)
  /**
   * 变量说明：shared 用于处理 shared 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let shared = 0
  while (shared < fromParts.length && shared < toParts.length && fromParts[shared] === toParts[shared]) shared++
  /**
   * 常量说明：up 用于处理 up 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  const up = Array.from({ length: fromParts.length - shared }, () => '..')
  return [...up, ...toParts.slice(shared)].join('/')
}

/**
 * Directory portion of a path (lexical, as Node defines it: no normalization).
 * @param path - the path.
 * @returns the parent directory.
 * @remarks 中文说明：功能说明：处理 dirname 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：path（string）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；返回值：string；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 dirname(path)，并按返回类型处理结果。
 */
export function dirname(path: string): string {
  assertPath(path)
  if (path.length === 0) return '.'
  /**
   * 常量说明：hasRoot 用于判断是否包含 Root 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const hasRoot = path.charCodeAt(0) === CHAR_FORWARD_SLASH
  /**
   * 变量说明：end 用于处理 end 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let end = -1
  /**
   * 变量说明：matchedSlash 用于处理 matchedSlash 相关数据，作用于当前作用域；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  let matchedSlash = true
  /**
   * 变量说明：i 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (let i = path.length - 1; i >= 1; --i) {
    if (path.charCodeAt(i) === CHAR_FORWARD_SLASH) {
      if (!matchedSlash) {
        end = i
        break
      }
    } else {
      matchedSlash = false
    }
  }
  if (end === -1) return hasRoot ? '/' : '.'
  if (hasRoot && end === 1) return '//'
  return path.slice(0, end)
}

/**
 * Last portion of a path, optionally without a suffix (lexical, as in Node).
 * @param path - the path.
 * @param suffix - extension to strip when the base ends with it.
 * @returns the base name.
 * @remarks 中文说明：功能说明：处理 basename 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：path（string）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；
 * 参数说明：suffix（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：string；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 basename(path, suffix)，并按返回类型处理结果。
 */
export function basename(path: string, suffix?: string): string {
  assertPath(path)
  /**
   * 变量说明：start 用于启动 start 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let start = 0
  /**
   * 变量说明：end 用于处理 end 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let end = -1
  /**
   * 变量说明：matchedSlash 用于处理 matchedSlash 相关数据，作用于当前作用域；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  let matchedSlash = true
  if (suffix !== undefined && suffix.length > 0 && suffix.length <= path.length) {
    if (suffix === path) return ''
    /**
     * 变量说明：extIdx 用于处理 extIdx 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let extIdx = suffix.length - 1
    /**
     * 变量说明：firstNonSlashEnd 用于处理 firstNonSlashEnd 相关数据，作用于当前作用域；其值可能随流程推进而变化，
     * 读写时需遵守声明类型和所在生命周期。
     */
    let firstNonSlashEnd = -1
    /**
     * 变量说明：i 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (let i = path.length - 1; i >= 0; --i) {
      /**
       * 常量说明：code 用于处理 code 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const code = path.charCodeAt(i)
      if (code === CHAR_FORWARD_SLASH) {
        if (!matchedSlash) {
          start = i + 1
          break
        }
        continue
      }
      if (firstNonSlashEnd === -1) {
        matchedSlash = false
        firstNonSlashEnd = i + 1
      }
      if (extIdx >= 0) {
        if (code === suffix.charCodeAt(extIdx)) {
          if (--extIdx === -1) end = i
        } else {
          extIdx = -1
          end = firstNonSlashEnd
        }
      }
    }
    if (start === end) end = firstNonSlashEnd
    else if (end === -1) end = path.length
    return path.slice(start, end)
  }
  /**
   * 变量说明：i 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (let i = path.length - 1; i >= 0; --i) {
    if (path.charCodeAt(i) === CHAR_FORWARD_SLASH) {
      if (!matchedSlash) {
        start = i + 1
        break
      }
    } else if (end === -1) {
      matchedSlash = false
      end = i + 1
    }
  }
  return end === -1 ? '' : path.slice(start, end)
}

/**
 * Extension of the last path segment, including the leading dot.
 * @param path - the path.
 * @returns the extension, or '' when there is none.
 * @remarks 中文说明：功能说明：处理 extname 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：path（string）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；返回值：string；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 extname(path)，并按返回类型处理结果。
 */
export function extname(path: string): string {
  assertPath(path)
  /**
   * 变量说明：startDot 用于启动 Dot 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let startDot = -1
  /**
   * 变量说明：startPart 用于启动 Part 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let startPart = 0
  /**
   * 变量说明：end 用于处理 end 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let end = -1
  /**
   * 变量说明：matchedSlash 用于处理 matchedSlash 相关数据，作用于当前作用域；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  let matchedSlash = true
  /**
   * 变量说明：preDotState 用于处理 preDotState 相关数据，作用于当前作用域；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  let preDotState = 0
  /**
   * 变量说明：i 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (let i = path.length - 1; i >= 0; --i) {
    /**
     * 常量说明：code 用于处理 code 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const code = path.charCodeAt(i)
    if (code === CHAR_FORWARD_SLASH) {
      if (!matchedSlash) {
        startPart = i + 1
        break
      }
      continue
    }
    if (end === -1) {
      matchedSlash = false
      end = i + 1
    }
    if (code === CHAR_DOT) {
      if (startDot === -1) startDot = i
      else if (preDotState !== 1) preDotState = 1
    } else if (startDot !== -1) {
      preDotState = -1
    }
  }
  if (startDot === -1 || end === -1 || preDotState === 0
    || (preDotState === 1 && startDot === end - 1 && startDot === startPart + 1)) {
    return ''
  }
  return path.slice(startDot, end)
}

/**
 * Build a path from its parsed parts.
 * @param pathObject - dir/root/base/name/ext parts.
 * @returns the assembled path.
 * @remarks 中文说明：功能说明：格式化 format 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：pathObject（Partial<ParsedPath>）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；
 * 返回值：string；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * format(pathObject)，并按返回类型处理结果。
 */
export function format(pathObject: Partial<ParsedPath>): string {
  /**
   * 常量说明：dir 用于处理 dir 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const dir = pathObject.dir ?? pathObject.root ?? ''
  /**
   * 常量说明：base 用于处理 base 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const base = pathObject.base ?? `${pathObject.name ?? ''}${pathObject.ext ?? ''}`
  if (dir === '') return base
  return dir === pathObject.root ? `${dir}${base}` : `${dir}/${base}`
}

/**
 * Split a path into root/dir/base/ext/name (lexical, as in Node).
 * @param path - the path.
 * @returns the parsed parts.
 * @remarks 中文说明：功能说明：解析 parse 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：path（string）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；返回值：ParsedPath；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 parse(path)，并按返回类型处理结果。
 */
export function parse(path: string): ParsedPath {
  assertPath(path)
  /**
   * 常量说明：base 用于处理 base 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const base = basename(path)
  /**
   * 常量说明：ext 用于处理 ext 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const ext = extname(path)
  /**
   * 常量说明：trimmed 用于处理 trimmed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const trimmed = path.length > 1 ? path.replace(/\/+$/, '') : path
  /**
   * 常量说明：lastSlash 用于处理 lastSlash 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const lastSlash = trimmed.lastIndexOf('/')
  /**
   * 常量说明：root 用于处理 root 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const root = isAbsolute(path) ? '/' : ''
  return {
    root,
    dir: trimmed === '' ? root : lastSlash === -1 ? '' : lastSlash === 0 ? '/' : trimmed.slice(0, lastSlash),
    base,
    ext,
    name: ext.length > 0 ? base.slice(0, base.length - ext.length) : base,
  }
}

/** POSIX path separator.
 * @remarks 中文说明：常量说明：sep 用于处理 sep 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
export const sep = '/' as const

/** POSIX path-list delimiter.
 * @remarks 中文说明：常量说明：delimiter 用于处理 delimiter 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
export const delimiter = ':' as const

/**
 * Windows namespace prefixes do not exist here.
 * @param path - the path.
 * @returns the path unchanged.
 * @remarks 中文说明：功能说明：处理 toNamespacedPath 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：path（string）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；返回值：string；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 toNamespacedPath(path)，
 * 并按返回类型处理结果。
 */
export function toNamespacedPath(path: string): string {
  return path
}

/**
 * 常量说明：posixFace 用于处理 posixFace 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const posixFace = {
  resolve, normalize, isAbsolute, join, relative, dirname, basename, extname, format, parse,
  sep, delimiter, toNamespacedPath,
}

/** POSIX member set: the module face, plus Node's self-referential namespaces.
 * @remarks 中文说明：常量说明：posix 用于处理 posix 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
export const posix: typeof posixFace & { readonly posix: unknown; readonly win32: unknown } = {
  ...posixFace,
  /**
   * 功能说明：处理 posix 相关流程；使用场景由所在模块及调用位置决定。
   * @returns unknown；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 posix()，并按返回类型处理结果。
   */
  get posix(): unknown { return posix },
  /**
   * 功能说明：处理 win32 相关流程；使用场景由所在模块及调用位置决定。
   * @returns unknown；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 win32()，并按返回类型处理结果。
   */
  get win32(): unknown { return win32 },
}

/**
 * 常量说明：win32Member 用于处理 win32Member 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 * 功能说明：处理 win32Member 相关流程；使用场景由所在模块及调用位置决定。
 * @param name （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 win32Member(name)，并按返回类型处理结果。
 */
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：never；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
const win32Member = (name: string) => (): never => {
  throw new Error(`web-preview: node:path.win32.${name} is unreachable — the worker host reports platform "linux"`)
}

/** Windows member set: reaching it means a platform branch went the wrong way.
 * @remarks 中文说明：常量说明：win32 用于处理 win32 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
export const win32 = {
  resolve: win32Member('resolve'),
  normalize: win32Member('normalize'),
  isAbsolute: win32Member('isAbsolute'),
  join: win32Member('join'),
  relative: win32Member('relative'),
  dirname: win32Member('dirname'),
  basename: win32Member('basename'),
  extname: win32Member('extname'),
  format: win32Member('format'),
  parse: win32Member('parse'),
  toNamespacedPath: win32Member('toNamespacedPath'),
  sep: '\\',
  delimiter: ';',
}

/** CommonJS interop marker: the worker loader hands `default` to default imports (see ./builtins.ts).
 * @remarks 中文说明：常量说明：__esModule 用于处理 __esModule 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
export const __esModule = true

/**
 * The `node:path` declarations this module stands in for. The two platform
 * namespaces stay unknown-typed: `posix` is this module reached through itself,
 * and `win32` holds throwing members rather than Node's `PlatformPath`, because
 * the worker host reports `linux` and a Windows branch is a bug.
 */
type NodeFace = Partial<Omit<typeof import('node:path'), 'posix' | 'win32'>> & Record<'posix' | 'win32', unknown>

export default posix satisfies NodeFace
