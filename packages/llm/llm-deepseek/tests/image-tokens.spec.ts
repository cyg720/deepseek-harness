/**
 * 文件职责：验证 llm/llm-deepseek 中 image tokens spec 相关行为与失败场景。
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。
 * 产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 */
import { describe, expect, it } from 'vitest'
import { deepSeekImageTokens } from '../src/image-tokens.ts'

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
describe('DeepSeek v4 image tokens', () => {
  // Reference values from the provider's published image token calculator
  // (api-docs.deepseek.com, Token & Token Usage), at the worst-case pad.
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：width（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：height（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：expected（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(width, height, expected)，
   * 并按返回类型处理结果。
   */
  it.each([
    [100, 100, 117],
    [384, 384, 117],
    [640, 480, 209],
    [800, 800, 349],
    [1024, 768, 357],
    [1920, 1080, 369],
    [2000, 2000, 349],
    [5000, 5000, 349],
    [300, 50, 101],
  ])('prices %sx%s as %s tokens', (width, height, expected) => {
    expect(deepSeekImageTokens(width, height)).toBe(expected)
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('caps every image at 384 tokens regardless of source size', () => {
    /**
     * 变量说明：width、height 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const [width, height] of [[2000, 2000], [5000, 5000], [8192, 8192], [16, 8192]]) {
      expect(deepSeekImageTokens(width!, height!)).toBeLessThanOrEqual(384)
    }
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('prices small images at the documented scale-up floor', () => {
    // Below roughly 384x384 total pixels the provider scales up, so a tiny
    // square costs the same as a 384x384 one.
    expect(deepSeekImageTokens(100, 100)).toBe(deepSeekImageTokens(384, 384))
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('clamps extreme width by the aspect-ratio bound', () => {
    // Width beyond 8x height projects onto the same clamped grid.
    expect(deepSeekImageTokens(9000, 1)).toBe(113)
    expect(deepSeekImageTokens(8192, 100)).toBe(113)
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('solves a one-column grid for an extremely tall image', () => {
    // Height-dominant aspect drives the solver's single-column branch.
    expect(deepSeekImageTokens(16, 8192)).toBe(381)
    expect(deepSeekImageTokens(1, 9000)).toBe(381)
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('trims an odd solved grid height to the even row count', () => {
    expect(deepSeekImageTokens(100, 4036)).toBe(253)
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('converges through a second projection pass when the first is not a fixpoint', () => {
    expect(deepSeekImageTokens(4921, 353)).toBe(289)
    expect(deepSeekImageTokens(97, 7289)).toBe(245)
  })
})
