/**
 * The Node-compatibility table, in one place. Two consumers share it, and they
 * must resolve to the same module instances:
 *   - the worker vite build aliases these specifiers for code bundled statically
 *     into the worker (vendored loader, Connection, …);
 *   - the worker module loader answers `require('node:fs')` from VFS-loaded
 *     modules out of this table, before bare-name resolution.
 * Anything absent here fails loudly at resolution instead of resolving to an
 * empty module. `process` is deliberately absent: the worker host installs that
 * global itself and fills it into this table at assembly time.
 *
 * Import paths carry the classification: `./implemented/<module>.ts` backs the
 * module's real semantics over a worker data source, while `./mock/<module>.ts`
 * is a structural placeholder whose calls report the missing capability. File
 * names match their Node module specifiers exactly, nesting included.
 *
 * Every value is a {@link StaticModuleFactory}, so the loader reads a table
 * entry only when a `require` names that specifier. What a factory defers is the
 * table read, not module evaluation: each one answers a namespace object of the
 * static ESM graph below, which the worker bundle evaluates at load like any
 * other import. Deferring a shim's own start-up cost therefore belongs inside
 * that shim, on the path that first needs it.
 * @remarks 文件说明：文件职责：实现 experimental/webworker-runtime 中 builtins 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/webworker-runtime 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 →
 * 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。
 */
import * as nodeAsyncHooks from './builtin_modules/implemented/async_hooks.ts'
import * as nodeBuffer from './builtin_modules/implemented/buffer.ts'
import * as nodeCrypto from './builtin_modules/implemented/crypto.ts'
import * as nodeDnsPromises from './builtin_modules/mock/dns/promises.ts'
import * as nodeEvents from './builtin_modules/implemented/events.ts'
import * as nodeFs from './builtin_modules/implemented/fs.ts'
import * as nodeFsPromises from './builtin_modules/implemented/fs/promises.ts'
import * as nodeHttp from './builtin_modules/implemented/http.ts'
import * as nodeModule from './builtin_modules/implemented/module.ts'
import * as nodeOs from './builtin_modules/implemented/os.ts'
import * as nodePath from './builtin_modules/implemented/path.ts'
import * as nodePerfHooks from './builtin_modules/implemented/perf_hooks.ts'
import * as nodeStream from './builtin_modules/implemented/stream.ts'
import * as nodeTimersPromises from './builtin_modules/implemented/timers/promises.ts'
import * as nodeTty from './builtin_modules/implemented/tty.ts'
import * as nodeUrl from './builtin_modules/implemented/url.ts'
import * as nodeUtil from './builtin_modules/implemented/util.ts'
import * as nodeUtilTypes from './builtin_modules/implemented/util/types.ts'
import * as nodeZlib from './builtin_modules/implemented/zlib.ts'
import * as nodeChildProcess from './builtin_modules/implemented/child_process.ts'
import * as nodeNet from './builtin_modules/mock/net.ts'
import * as nodeSqlite from './builtin_modules/mock/sqlite.ts'
import * as nodeVm from './builtin_modules/mock/vm.ts'
import * as nodeWorkerThreads from './builtin_modules/mock/worker_threads.ts'
import * as koffi from './external_packages/koffi.ts'
import * as nodePty from './external_packages/node-pty.ts'
import * as piAi from './external_packages/pi-ai.ts'
import * as ripgrep from './external_packages/ripgrep.ts'
import * as sharp from './external_packages/sharp.ts'
import * as ws from './external_packages/ws.ts'
import { REPLACED_EXTERNAL_PACKAGES } from './external_packages/replaced-externals.ts'
import type { StaticModuleFactory } from '../module-system/module-loader.ts'

/** Builtin modules, keyed with and without the `node:` prefix.
 * @remarks 中文说明：常量说明：BUILTINS 用于处理 BUILTINS 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
const BUILTINS: Record<string, StaticModuleFactory> = {
  async_hooks: () => nodeAsyncHooks,
  buffer: () => nodeBuffer,
  child_process: () => nodeChildProcess,
  crypto: () => nodeCrypto,
  'dns/promises': () => nodeDnsPromises,
  events: () => nodeEvents,
  fs: () => nodeFs,
  'fs/promises': () => nodeFsPromises,
  http: () => nodeHttp,
  module: () => nodeModule,
  net: () => nodeNet,
  os: () => nodeOs,
  path: () => nodePath,
  'path/posix': () => nodePath,
  perf_hooks: () => nodePerfHooks,
  sqlite: () => nodeSqlite,
  stream: () => nodeStream,
  'timers/promises': () => nodeTimersPromises,
  tty: () => nodeTty,
  url: () => nodeUrl,
  util: () => nodeUtil,
  'util/types': () => nodeUtilTypes,
  vm: () => nodeVm,
  worker_threads: () => nodeWorkerThreads,
  zlib: () => nodeZlib,
}

/** External npm packages replaced wholesale (structural not-implemented stubs and fakes).
 * @remarks 中文说明：常量说明：EXTERNALS 用于处理 EXTERNALS 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
const EXTERNALS: Record<string, StaticModuleFactory> = {
  'koffi': () => koffi,
  'sharp': () => sharp,
  'node-pty': () => nodePty,
  'ws': () => ws,
  '@vscode/ripgrep': () => ripgrep,
  '@earendil-works/pi-ai': () => piAi,
}

/**
 * Prefixes whose every subpath resolves to one replacement module. The loader
 * matches the longest prefix after its exact table misses, so pi-ai's
 * `/providers/*` and `/api/*.lazy` entries need no enumeration.
 * @remarks 中文说明：常量说明：REPLACED_PREFIXES 用于处理 REPLACED_PREFIXES 相关数据，
 * 作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
export const REPLACED_PREFIXES: Record<string, StaticModuleFactory> = {
  '@earendil-works/pi-ai/': () => piAi,
}

// One list, two consumers: a package replaced here must also be kept out of the
// VFS image, so any divergence fails at worker start rather than at first require.
/**
 * 常量说明：declared 用于处理 declared 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const declared = [...REPLACED_EXTERNAL_PACKAGES].sort().join(',')
/**
 * 常量说明：wired 用于处理 wired 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const wired = Object.keys(EXTERNALS).sort().join(',')
if (declared !== wired) {
  throw new Error(`web-preview: replaced-external lists diverge — declared [${declared}] vs wired [${wired}]`)
}

/**
 * Build the specifier → factory table the worker module loader consults first.
 * @returns every replaced specifier, including its `node:`-prefixed alias.
 * @remarks 中文说明：功能说明：创建 Node Builtins 相关流程；使用场景由所在模块及调用位置决定。；
 * 返回值：Record<string, StaticModuleFactory>；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 createNodeBuiltins()，并按返回类型处理结果。
 */
export function createNodeBuiltins(): Record<string, StaticModuleFactory> {
  /**
   * 常量说明：table 用于处理 table 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const table: Record<string, StaticModuleFactory> = { ...EXTERNALS }
  /**
   * 变量说明：name、factory 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (const [name, factory] of Object.entries(BUILTINS)) {
    table[name] = factory
    table[`node:${name}`] = factory
  }
  return table
}
