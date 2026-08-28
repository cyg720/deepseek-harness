/**
 * `node:module` for the worker: `createRequire` hands out the worker module
 * loader's synchronous require. Typert can resolve package exports, and package
 * inventory can discover manifests through `require.resolve.paths()` without
 * either consumer changing for the Worker.
 * @remarks 文件说明：文件职责：实现 experimental/webworker-runtime 中 module 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/webworker-runtime 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 →
 * 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。
 */
import { requireActiveModuleLoader, type WorkerRequire } from '../../../module-system/module-loader.ts'

/** Node `require` face the harness consumes. */
export type NodeRequire = WorkerRequire

/**
 * Build a `require` bound to a base path or file URL.
 * @param base - directory, file path, or file URL the resolution starts from.
 * @returns the synchronous require face, including `resolve()` and `resolve.paths()`.
 * @remarks 中文说明：功能说明：创建 Require 相关流程；使用场景由所在模块及调用位置决定。；参数说明：base（string |
 * URL）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：NodeRequire；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 createRequire(base)，并按返回类型处理结果。
 */
export function createRequire(base: string | URL): NodeRequire {
  return requireActiveModuleLoader().createRequire(base)
}

/** Builtin specifiers the module proxy table answers (without the `node:` prefix).
 * @remarks 中文说明：常量说明：builtinModules 用于处理 builtinModules 相关数据，作用于当前作用域；
 * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
export const builtinModules = [
  'assert', 'async_hooks', 'buffer', 'child_process', 'crypto', 'events', 'fs', 'http', 'module',
  'net', 'os', 'path', 'process', 'stream', 'tty', 'url', 'util', 'worker_threads',
]

/**
 * Whether a specifier names a Node builtin.
 * @param specifier - the module specifier.
 * @returns true for builtin names, with or without the `node:` prefix.
 * @remarks 中文说明：功能说明：判断是否为 Builtin 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：specifier（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：boolean；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 isBuiltin(specifier)，
 * 并按返回类型处理结果。
 */
export function isBuiltin(specifier: string): boolean {
  return builtinModules.includes(specifier.replace(/^node:/, ''))
}

/**
 * TypeScript stripping is a Node 22+ loader feature with no worker counterpart.
 * @returns Never — it throws naming the unavailable member.
 * @remarks 中文说明：功能说明：处理 stripTypeScriptTypes 相关流程；使用场景由所在模块及调用位置决定。；
 * 返回值：never；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * stripTypeScriptTypes()，并按返回类型处理结果。
 */
export function stripTypeScriptTypes(): never {
  throw new Error('web-preview: node:module.stripTypeScriptTypes is not available in the worker host')
}

/**
 * Loader hooks have no meaning here: the worker loader owns resolution.
 * @returns Never — it throws naming the unavailable member.
 * @remarks 中文说明：功能说明：注册 register 相关流程；使用场景由所在模块及调用位置决定。；返回值：never；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 register()，并按返回类型处理结果。
 */
export function register(): never {
  throw new Error('web-preview: node:module.register is not available in the worker host')
}

/** ESM/CJS export syncing is a no-op: the worker loader materializes CommonJS only.
 * @remarks 中文说明：功能说明：同步 Builtin ESMExports 相关流程；使用场景由所在模块及调用位置决定。；返回值：void；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 syncBuiltinESMExports()，
 * 并按返回类型处理结果。 */
export function syncBuiltinESMExports(): void {
  // Nothing to sync: every builtin is a plain module object from the proxy table.
}

/** Erased type peer for the vendored loader's type-only LoadHookContext import. */
export type LoadHookContext = never

/** CommonJS interop marker: the worker loader hands `default` to default imports (see ./builtins.ts).
 * @remarks 中文说明：常量说明：__esModule 用于处理 __esModule 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
export const __esModule = true

/**
 * The `node:module` declarations this module stands in for. `createRequire`
 * keeps this module's own face: the loader's require carries the call and
 * `resolve` the harness uses, not Node's `cache`, `extensions`, and `main`,
 * which describe a CommonJS module registry the worker has no counterpart for.
 */
type NodeFace = Partial<Omit<typeof import('node:module'), 'createRequire'>> & Record<'createRequire', unknown>

/** CommonJS default export: the members `require()` hands a caller of this module. */
export default {
  createRequire, builtinModules, isBuiltin, register, syncBuiltinESMExports, stripTypeScriptTypes,
} satisfies NodeFace
