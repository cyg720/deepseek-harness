/**
 * 文件职责：验证 experimental/inspector 中 client stack host spec 相关行为与失败场景。
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。
 * 产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 */
import { describe, expect, it } from 'vitest'
import { inspectorId } from '../src/shared/bridge/ids.ts'
import { ClientScriptIdentity } from '../src/worker/realms/client/scripts.ts'
import { clientConsoleEvent } from '../src/worker/realms/client/values.ts'

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
describe('Worker Client stack projection', () => {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('uses one script key in Client Console and Sources projections', () => {
    /**
     * 常量说明：localKey 用于处理 localKey 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const localKey = inspectorId<'RuntimeScriptKey'>('client-bundle', 'scriptKey')
    /**
     * 常量说明：scripts 用于处理 scripts 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const scripts = new ClientScriptIdentity(-7)
    /**
     * 常量说明：projected 用于处理 projected 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：scriptKey（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(scriptKey)，并按返回类型处理结果。
     */
    const projected = clientConsoleEvent({
      type: 'console-api',
      event: {
        type: 'log',
        arguments: [],
        timestamp: 1,
        stackTrace: {
          callFrames: [{
            functionName: 'apply',
            scriptKey: localKey,
            url: 'http://client.test/client.js',
            lineNumber: 1,
            columnNumber: 2,
          }],
        },
      },
    }, scriptKey => scripts.toRuntime(scriptKey))
    if (projected.type !== 'console-api') throw new Error('unexpected exception event')
    expect(projected.event.stackTrace?.callFrames[0]?.scriptKey).toBe(scripts.toRuntime(localKey))
  })
})
