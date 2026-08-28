/** Child-process fixture whose Host main thread is paused and resumed through the Inspector Worker.
 * @remarks 文件说明：文件职责：验证 experimental/inspector 中 debug host 相关行为与失败场景。；
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。；产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。；
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。；
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。 */

import { createInterface } from 'node:readline'
import { startInspector } from '../../src/host/bridge/controller.ts'

/**
 * 常量说明：inspector 用于处理 inspector 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const inspector = await startInspector({ port: 0, captureFetch: false })

/**
 * 功能说明：处理 breakpointProbe 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns number；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 breakpointProbe(value)，并按返回类型处理结果。
 */
function breakpointProbe(value: number): number {
  /**
   * 常量说明：local 用于处理 local 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const local = value
  return local + 1
}

Object.defineProperty(globalThis, '__inspectorBreakpointProbe', { value: breakpointProbe, configurable: true })
process.stdout.write(`${JSON.stringify(inspector.endpoint)}\n`)

/**
 * 常量说明：input 用于处理 input 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const input = createInterface({ input: process.stdin, terminal: false })
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：line（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(line)，并按返回类型处理结果。
 */
input.on('line', (line) => {
  if (line === 'run') {
    Object.defineProperty(globalThis, '__inspectorBreakpointResult', {
      value: breakpointProbe(41),
      configurable: true,
    })
  }
  if (line === 'stop') {
    input.close()
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    void inspector.close().then(() => { process.exit(0) })
  }
})
