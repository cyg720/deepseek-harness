/** Query-backed adapter for the transport-independent Cordis tree reader.
 * @remarks 文件说明：文件职责：实现 experimental/inspector 中 query reader 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/inspector 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。 */

import type { CordisRuntimeTreeReader } from '../cordis/reader.ts'
import type { InspectorQueryRequester } from './messages/query/commands.ts'

/**
 * Create a reader that obtains the tree through the typed Inspector query protocol.
 * @param requester - Active Host or Client query connection.
 * @returns A non-CDP Cordis tree reader.
 * @remarks 中文说明：功能说明：创建 Query Cordis Runtime Tree Reader 相关流程；
 * 使用场景由所在模块及调用位置决定。；参数说明：requester（InspectorQueryRequester）：提供调用方提交的请求信息；
 * 必须满足声明的类型及调用时序要求。；返回值：CordisRuntimeTreeReader；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 createQueryCordisRuntimeTreeReader(requester)，
 * 并按返回类型处理结果。
 */
export function createQueryCordisRuntimeTreeReader(requester: InspectorQueryRequester): CordisRuntimeTreeReader {
  return {
    /**
     * 功能说明：获取 Tree 相关流程；使用场景由所在模块及调用位置决定。
     * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 getTree()，并按返回类型处理结果。
     */
    async getTree() {
      /**
       * 常量说明：result 用于处理 result 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const result = await requester.request({ op: 'cordis-tree/get' })
      return result.tree
    },
  }
}
