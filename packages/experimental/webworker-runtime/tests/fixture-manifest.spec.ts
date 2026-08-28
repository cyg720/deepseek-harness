/**
 * 文件职责：验证 experimental/webworker-runtime 中 fixture manifest spec 相关行为与失败场景。
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。
 * 产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 */
import { describe, expect, it } from 'vitest'
import {
  parsePreviewFixtureManifest, PREVIEW_FIXTURE_MANIFEST_VERSION,
} from '../src/fixture-manifest.ts'

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
describe('Preview fixture manifest', () => {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('accepts a unique named fixture with ordered overlays', () => {
    expect(parsePreviewFixtureManifest({
      version: PREVIEW_FIXTURE_MANIFEST_VERSION,
      defaultFixture: 'example',
      fixtures: [{
        id: 'example',
        label: 'Example',
        description: 'A deterministic example.',
        overlays: ['fixtures/base.tar.gz', 'fixtures/tail.tar.gz'],
      }],
    })).toEqual({
      version: PREVIEW_FIXTURE_MANIFEST_VERSION,
      defaultFixture: 'example',
      fixtures: [{
        id: 'example',
        label: 'Example',
        description: 'A deterministic example.',
        overlays: ['fixtures/base.tar.gz', 'fixtures/tail.tar.gz'],
      }],
    })
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：value（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：error（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(value, error)，并按返回类型处理结果。
   */
  it.each([
    [{ version: 2, defaultFixture: null, fixtures: [] }, /must use version/],
    [{ version: 1, defaultFixture: 'missing', fixtures: [] }, /defaultFixture/],
    [{
      version: 1,
      defaultFixture: 'duplicate',
      fixtures: [
        { id: 'duplicate', label: 'One', description: 'First.', overlays: ['one.tar.gz'] },
        { id: 'duplicate', label: 'Two', description: 'Second.', overlays: ['two.tar.gz'] },
      ],
    }, /repeats id/],
    [{
      version: 1,
      defaultFixture: 'none',
      fixtures: [{ id: 'none', label: 'None', description: 'Reserved.', overlays: ['none.tar.gz'] }],
    }, /invalid fixture entry/],
  ])('rejects malformed catalogs', (value, error) => {
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    expect(() => parsePreviewFixtureManifest(value)).toThrow(error)
  })
})
