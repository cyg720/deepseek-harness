/**
 * The Node-compatibility table and the module identity it owes its consumers.
 *
 * Two consumers read these specifiers — the worker vite build aliases them for
 * statically bundled code, and the module loader answers `require('node:fs')`
 * from VFS-loaded modules — and both must land on ONE module instance per
 * specifier. Class identity is what depends on it: `instanceof EventEmitter` and
 * `Buffer.isBuffer` compare against a specific copy, so a second instance turns
 * them into silent false answers rather than an error anyone can trace.
 *
 * The table holds factories, so what a table entry defers is the table read. The
 * namespace objects themselves belong to the static graph the worker bundle
 * evaluates at load, which is why nothing here asserts that a factory is
 * unevaluated.
 * @remarks 文件说明：文件职责：验证 experimental/webworker-runtime 中 builtins table
 * spec 相关行为与失败场景。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。；
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。；
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 */
import { describe, expect, it } from 'vitest'
import { createNodeBuiltins, REPLACED_PREFIXES } from '../../src/node/builtins.ts'
import { WorkerModuleLoader, type WorkerRequire } from '../../src/module-system/module-loader.ts'
import { MemoryVfs } from '../../src/storage/memory.ts'

/** A loader over an empty image: every specifier below resolves from the table.
 * @remarks 中文说明：功能说明：处理 loaderRequire 相关流程；使用场景由所在模块及调用位置决定。；
 * 返回值：WorkerRequire；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * loaderRequire()，并按返回类型处理结果。 */
function loaderRequire(): WorkerRequire {
  /**
   * 常量说明：vfs 用于处理 vfs 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const vfs = new MemoryVfs()
  vfs.seedDirectory('/dsh')
  /**
   * 常量说明：loader 用于处理 loader 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const loader = new WorkerModuleLoader({ vfs, root: '/dsh', staticModules: createNodeBuiltins() })
  return loader.createRequire('/dsh/')
}

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
describe('the replacement table', () => {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('holds a factory for every specifier', () => {
    /**
     * 常量说明：table 用于处理 table 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const table = createNodeBuiltins()
    /**
     * 常量说明：notFunctions 用于处理 notFunctions 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：[, value]（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调([, value])，并按返回类型处理结果。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：[specifier]（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调([specifier])，并按返回类型处理结果。
     */
    const notFunctions = Object.entries(table)
      .filter(([, value]) => typeof value !== 'function')
      .map(([specifier]) => specifier)
    // A module object left in the table would be called as a factory and fail at
    // the first require of that specifier, not at assembly.
    expect(notFunctions).toEqual([])
    expect(Object.keys(table).length).toBeGreaterThan(0)
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('keys every builtin with and without the node: prefix', () => {
    /**
     * 常量说明：table 用于处理 table 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const table = createNodeBuiltins()
    expect(Object.keys(table)).toEqual(expect.arrayContaining(['fs', 'node:fs', 'fs/promises', 'node:fs/promises']))
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('leaves process out, because the host installs that global itself', () => {
    /**
     * 常量说明：table 用于处理 table 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const table = createNodeBuiltins()
    expect([table['process'], table['node:process']]).toEqual([undefined, undefined])
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('answers path and path/posix from one module: the worker speaks POSIX only', () => {
    /**
     * 常量说明：table 用于处理 table 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const table = createNodeBuiltins()
    expect(table['path']?.()).toBe(table['path/posix']?.())
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('answers a prefixed subpath with the module its exact key answers', () => {
    /**
     * 常量说明：table 用于处理 table 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const table = createNodeBuiltins()
    expect(REPLACED_PREFIXES['@earendil-works/pi-ai/']?.()).toBe(table['@earendil-works/pi-ai']?.())
  })
})

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
describe('module identity through the loader', () => {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('exposes async and synchronous resolution through the Cordis internal seam', async () => {
    /**
     * 常量说明：vfs 用于处理 vfs 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const vfs = new MemoryVfs()
    vfs.seedDirectory('/dsh/node_modules/example')
    vfs.writeFileSync('/dsh/node_modules/example/package.json', JSON.stringify({ main: 'index.js' }))
    vfs.writeFileSync('/dsh/node_modules/example/index.js', 'module.exports = {}\n')
    /**
     * 常量说明：loader 用于处理 loader 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const loader = new WorkerModuleLoader({ vfs, root: '/dsh', staticModules: createNodeBuiltins() })

    expect(loader.internal.resolveSync('example', 'file:///dsh/app.js')).toEqual({
      format: 'commonjs',
      url: 'file:///dsh/node_modules/example/index.js',
    })
    await expect(loader.internal.resolve('node:fs', 'file:///dsh/app.js')).resolves.toEqual({
      format: 'builtin',
      url: 'node:fs',
    })
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('hands the same instance to two requires of one specifier', () => {
    /**
     * 常量说明：require 用于处理 require 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const require = loaderRequire()
    expect(require('node:events')).toBe(require('node:events'))
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('hands the same instance to the bare and prefixed specifiers', () => {
    /**
     * 常量说明：require 用于处理 require 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const require = loaderRequire()
    expect(require('events')).toBe(require('node:events'))
    expect(require('fs')).toBe(require('node:fs'))
    expect(require('tty')).toBe(require('node:tty'))
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('reports that worker file descriptors are not terminals', () => {
    /**
     * 常量说明：tty 用于处理 tty 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 isatty 相关流程；使用场景由所在模块及调用位置决定。
     * @param fd （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
     * @returns boolean；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 isatty(fd)，并按返回类型处理结果。
     */
    const tty = loaderRequire()('tty') as { isatty(fd: number): boolean }
    expect(tty.isatty(2)).toBe(false)
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('keeps class identity across those specifiers', () => {
    // The consequence the single-instance rule exists for: a second copy would
    // make this comparison answer false with nothing failing.
    /**
     * 常量说明：require 用于处理 require 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const require = loaderRequire()
    /**
     * 常量说明：EventEmitter 用于处理 EventEmitter 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const { EventEmitter } = require('events') as { EventEmitter: new () => unknown }
    /**
     * 常量说明：prefixed 用于处理 prefixed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const prefixed = require('node:events') as { EventEmitter: new () => unknown }
    expect(new EventEmitter() instanceof prefixed.EventEmitter).toBe(true)
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('refuses a specifier the table does not hold, instead of resolving it empty', () => {
    /**
     * 常量说明：require 用于处理 require 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const require = loaderRequire()
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    expect(() => require('node:dns')).toThrow()
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('exposes the package search paths used by the VFS resolver', () => {
    /**
     * 常量说明：require 用于处理 require 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const require = loaderRequire()
    expect(require.resolve.paths('node:fs')).toBeNull()
    expect(require.resolve.paths('node:dns')).toBeNull()
    expect(require.resolve.paths('workspace-package')).toEqual(['/dsh/node_modules'])
    expect(require.resolve.paths('./local.js')).toEqual(['/dsh'])
  })
})
