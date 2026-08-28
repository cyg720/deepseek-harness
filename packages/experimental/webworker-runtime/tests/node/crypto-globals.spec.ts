/**
 * The crypto global patch and the shim UUID it installs: on an insecure
 * origin the platform withholds `crypto.randomUUID` while product code calls
 * it off the global, so the worker fills the one missing method — and leaves
 * a platform that already has it untouched.
 * @remarks 文件说明：文件职责：验证 experimental/webworker-runtime 中 crypto globals
 * spec 相关行为与失败场景。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。；
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。；
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { installCryptoGlobals } from '../../src/node/globals/crypto.ts'
import { randomUUID } from '../../src/node/builtin_modules/implemented/crypto.ts'

/**
 * 常量说明：V4_SHAPE 用于处理 V4_SHAPE 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const V4_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
describe('the shim randomUUID', () => {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('emits RFC 9562 v4 ids without touching the platform method', () => {
    /**
     * 变量说明：round 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (let round = 0; round < 32; round += 1) expect(randomUUID()).toMatch(V4_SHAPE)
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    expect(new Set(Array.from({ length: 32 }, () => randomUUID())).size).toBe(32)
  })
})

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
describe('installCryptoGlobals', () => {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  afterEach(() => { vi.unstubAllGlobals() })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('fills randomUUID on a crypto that lacks it, the insecure-origin shape', () => {
    /**
     * 常量说明：bare 用于处理 bare 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const bare = { getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto) }
    vi.stubGlobal('crypto', bare)
    installCryptoGlobals()
    expect(globalThis.crypto.randomUUID()).toMatch(V4_SHAPE)
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('leaves a platform that already provides randomUUID untouched', () => {
    /**
     * 常量说明：platform 用于处理 platform 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     * 功能说明：处理 platform 相关流程；使用场景由所在模块及调用位置决定。
     * @returns string；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 platform()，并按返回类型处理结果。
     */
    const platform = (): string => 'platform-owned'
    vi.stubGlobal('crypto', { randomUUID: platform })
    installCryptoGlobals()
    expect(Reflect.get(globalThis.crypto, 'randomUUID')).toBe(platform)
  })
})
