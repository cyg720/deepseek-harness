/**
 * Differential check of this package's POSIX path shim against Node's
 * `path.posix`.
 *
 * Differential rather than example-based: the shim's contract is "behaves like
 * `node:path/posix`", so Node itself is the oracle and every case is compared
 * rather than asserted against a hand-written expectation. The corpus is the
 * shapes a VFS path actually takes (absolute image paths, `node_modules`
 * specifiers, `.bin` entries) plus edge forms that stress lexical handling
 * (repeated slashes, trailing dots, `..` past the root).
 *
 * Imports go through the package name so the harness and the shim resolve to one
 * module instance (see `../polyfill/als-shim.spec.ts` for why that matters).
 * @remarks 文件说明：文件职责：验证 experimental/webworker-runtime 中 path diff spec
 * 相关行为与失败场景。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。；产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。；
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。；
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 */
import { expect, test } from 'vitest'
import { posix as nodePosix } from 'node:path'
import * as shim from '@deepseek-ai/dsh-experimental-webworker-runtime/src/node/builtin_modules/implemented/path.ts'

/**
 * 常量说明：CASES 用于处理 CASES 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const CASES = [
  '', '.', '..', '/', '//', '///', 'a', '/a', 'a/', '/a/', 'a/b', '/a/b/c', 'a//b', '/a//b/',
  './a', '../a', 'a/./b', 'a/../b', '/a/../..', '/../a', 'a/b/../../c', '.hidden', 'a.b.c',
  '/a/b/c.txt', 'c.txt', '.txt', 'a/.txt', 'a/b.', '/a/b/.', '/a/b/..', 'foo/bar/../baz/./qux',
  '/dsh/node_modules/@deepseek-ai/dsh-session/lib/index.js', 'node_modules/.bin/x',
]

/**
 * 常量说明：JOINS 用于处理 JOINS 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const JOINS: string[][] = [
  ['a', 'b'], ['/a', 'b'], ['a', '/b'], ['a', '..'], ['a', '../..'], ['', 'b'], ['a', ''],
  ['/dsh', 'config', 'cordis.yml'], ['/dsh/node_modules', '@scope/pkg', 'lib/index.js'],
  ['a/', '/b'], ['.', 'a'], ['..', 'a'], ['/', 'a'], [],
]

/**
 * 常量说明：RESOLVES 用于处理 RESOLVES 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const RESOLVES: string[][] = [
  ['a'], ['/a', 'b'], ['/a', '/b'], ['a', '..'], ['/dsh', './config/../config/cordis.yml'],
  ['/a/b', '../c'], ['/'], ['', 'a'], ['/dsh/node_modules/pkg', './lib/../lib/index.js'],
]

/**
 * 常量说明：RELATIVES 用于处理 RELATIVES 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const RELATIVES: [string, string][] = [
  ['/a/b', '/a/b/c'], ['/a/b/c', '/a/b'], ['/a', '/b'], ['/a/b', '/a/b'], ['/', '/a'],
  ['/dsh/node_modules/a', '/dsh/node_modules/b/lib/x.js'],
]

/**
 * 常量说明：compare 用于比较 compare 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 * 功能说明：比较 compare 相关流程；使用场景由所在模块及调用位置决定。
 * @param label （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param actual （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param expected （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 compare(label, actual, expected)，并按返回类型处理结果。
 */
const compare = (label: string, actual: unknown, expected: unknown): void => {
  /**
   * 常量说明：shimmed、node 用于处理 shimmed、node 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const [shimmed, node] = [JSON.stringify(actual), JSON.stringify(expected)]
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  test(label, () => { expect(shimmed).toBe(node) })
}

// resolve() consults process.cwd() on both sides; pin it so they agree, then put
// it back before any case runs so the rest of the run keeps the repository root.
/**
 * 常量说明：originalCwd 用于处理 originalCwd 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const originalCwd = process.cwd()
process.chdir('/')

/**
 * 变量说明：value 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
 */
for (const value of CASES) {
  /**
   * 变量说明：fn 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (const fn of ['normalize', 'dirname', 'basename', 'extname', 'isAbsolute', 'parse'] as const) {
    /**
     * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
     */
    try {
      compare(`${fn}(${JSON.stringify(value)})`, (shim[fn] as (v: string) => unknown)(value), (nodePosix[fn] as (v: string) => unknown)(value))
    } catch (error) {
      /**
       * 常量说明：thrown 用于处理 thrown 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const thrown = String(error)
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
       */
      test(`${fn}(${JSON.stringify(value)}) does not throw`, () => { expect.unreachable(thrown) })
    }
  }
  compare(`basename(${JSON.stringify(value)}, '.txt')`, shim.basename(value, '.txt'), nodePosix.basename(value, '.txt'))
}

/**
 * 变量说明：parts 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
 */
for (const parts of JOINS) compare(`join(${JSON.stringify(parts)})`, shim.join(...parts), nodePosix.join(...parts))
/**
 * 变量说明：parts 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
 */
for (const parts of RESOLVES) compare(`resolve(${JSON.stringify(parts)})`, shim.resolve(...parts), nodePosix.resolve(...parts))
/**
 * 变量说明：from、to 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
 */
for (const [from, to] of RELATIVES) compare(`relative(${from}, ${to})`, shim.relative(from, to), nodePosix.relative(from, to))
/**
 * 变量说明：value 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
 */
for (const value of CASES) {
  /**
   * 常量说明：parsed 用于处理 parsed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const parsed = nodePosix.parse(value)
  compare(`format(parse(${JSON.stringify(value)}))`, shim.format(parsed), nodePosix.format(parsed))
}

process.chdir(originalCwd)
