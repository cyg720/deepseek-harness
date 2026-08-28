/**
 * How one composition row's `name` reaches a module.
 *
 * A preset composition is read by `Include`, which rewrites its context's
 * `baseUrl` to the composition's own directory. That is right for a row
 * naming a file the preset ships and wrong for a row naming a package: a
 * locally authored preset lives under the user's home, where Node's upward
 * `node_modules` walk never reaches the harness's own dependencies. Both the
 * mount's import override and discovery's health check therefore have to
 * classify a row's name before they can act on it, and they must classify it
 * the same way — a row discovery resolves from one base and the mount imports
 * from another would be reported healthy and then fail to load.
 * @module @deepseek-ai/dsh-agent-presets/specifier
 * @remarks 文件说明：文件职责：实现 preset/agent-presets 中 specifier 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * preset/agent-presets 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。
 */

import { isAbsolute } from 'node:path'
import { pathToFileURL } from 'node:url'

/** One composition row's module specifier, classified by where it resolves. */
export type RowSpecifier =
  /** A `cordis:` builtin the Loader supplies; nothing is resolved. */
  | { readonly kind: 'builtin'; readonly specifier: string }
  /** A path relative to the preset's own directory; the preset ships the file. */
  | { readonly kind: 'preset'; readonly specifier: string }
  /** An absolute path or `file:` URL; it names one file and no base. */
  | { readonly kind: 'file'; readonly specifier: string }
  /** A package name resolved from the installed harness. */
  | { readonly kind: 'package'; readonly specifier: string }

/**
 * Classify one row's `name`.
 *
 * An absolute filesystem path becomes a file URL here rather than at each
 * call site, because Node's ESM resolver rejects a bare drive-letter path on
 * Windows. A `file:` URL is already one and joins it: the Loader accepts both
 * spellings for the same thing, and treating the URL as a package name would
 * hand it to a resolver that only normalizes it, reporting a file that is not
 * there as present. The `specifier` a caller receives is always the string to
 * hand a resolver; only `kind` decides which base it goes with.
 * @param name - the module specifier exactly as the row wrote it.
 * @returns the classification, carrying the specifier to resolve.
 * @remarks 中文说明：功能说明：处理 classifyRowSpecifier 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：name（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：RowSpecifier；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * classifyRowSpecifier(name)，并按返回类型处理结果。
 */
export function classifyRowSpecifier(name: string): RowSpecifier {
  if (name.startsWith('cordis:')) return { kind: 'builtin', specifier: name }
  if (name.startsWith('.')) return { kind: 'preset', specifier: name }
  if (name.startsWith('file:')) return { kind: 'file', specifier: name }
  if (isAbsolute(name)) return { kind: 'file', specifier: pathToFileURL(name).href }
  return { kind: 'package', specifier: name }
}
