/**
 * The worker's process shim: the layout-derived environment and the Node 22
 * `getBuiltinModule` face, which must answer the loader's module proxies for
 * builtin ids and undefined for everything else — never an image resolution.
 * @remarks 文件说明：文件职责：验证 experimental/webworker-runtime 中 process shim spec
 * 相关行为与失败场景。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。；产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。；
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。；
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { installProcessGlobal } from '../../src/node/globals/process.ts'
import { setActiveModuleLoader, WorkerModuleLoader } from '../../src/module-system/module-loader.ts'
import { MemoryVfs } from '../../src/storage/memory.ts'

/**
 * 常量说明：realProcess 用于处理 realProcess 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const realProcess = globalThis.process

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
afterEach(() => {
  ;(globalThis as { process: unknown }).process = realProcess
})

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
describe('process shim', () => {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('publishes cwd, env, and version zero for the loader probe', () => {
    /**
     * 常量说明：shim 用于处理 shim 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const shim = installProcessGlobal({ cwd: '/dsh', env: { DSH_HOME: '/dsh/home' } })
    expect(shim.cwd()).toBe('/dsh')
    expect(shim.env.DSH_HOME).toBe('/dsh/home')
    expect(shim.title).toBe('dsh-webworker')
    // "0.0.0" keeps the vendored Loader off Node internals so the worker owns
    // the module seam.
    expect(shim.versions.node).toBe('0.0.0')
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('answers getBuiltinModule from the module proxies and undefined otherwise', () => {
    /**
     * 常量说明：fs 用于处理 fs 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const fs = { marker: 'fs-proxy' }
    // The table holds factories, and a builtin must keep one identity across
    // requires (`instanceof`, `Buffer.isBuffer`), so this one answers with the
    // same object every time.
    /**
     * 常量说明：factory 用于处理 factory 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     * 功能说明：处理 factory 相关流程；使用场景由所在模块及调用位置决定。
     * @returns unknown；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 factory()，并按返回类型处理结果。
     */
    const factory = (): unknown => fs
    /**
     * 常量说明：vfs 用于处理 vfs 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const vfs = new MemoryVfs()
    vfs.seedDirectory('/dsh')
    /**
     * 常量说明：loader 用于处理 loader 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const loader = new WorkerModuleLoader({
      vfs,
      root: '/dsh',
      staticModules: { 'node:fs': factory, 'fs': factory },
    })
    setActiveModuleLoader(loader)
    /**
     * 常量说明：shim 用于处理 shim 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const shim = installProcessGlobal({ cwd: '/dsh', env: {} })
    // The shim calls the factory: a caller receives the module, never the thunk.
    expect(shim.getBuiltinModule('fs')).toBe(fs)
    expect(shim.getBuiltinModule('node:fs')).toBe(fs)
    expect(shim.getBuiltinModule('no-such-builtin')).toBeUndefined()
  })
})
