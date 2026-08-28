/** Cordis service API shared by the Host and Client plugin faces.
 * @remarks 文件说明：文件职责：实现 experimental/inspector 中 service 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/inspector 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。 */

import type { CordisRuntimeTreeReader } from './cordis/reader.ts'
import { createQueryCordisRuntimeTreeReader } from './bridge/query-reader.ts'
import type { InspectorJsonValue } from './json.ts'
import type { InspectorConnection } from './bridge/publisher.ts'

/** Shared Host/Client service façade over the realm's source publisher. */
export interface InspectorService {
  /**
   * Publish one JSON observation without waiting for Worker delivery.
   * @param topic - Domain-owned topic name.
   * @param payload - JSON value validated before it reaches the carrier.
   * @param monotonicMs - Source-clock timestamp; defaults to `performance.now()`.
   * @remarks 中文说明：功能说明：处理 publish 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：topic（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：payload（InspectorJsonValue）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：monotonicMs（number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 publish(topic, payload,
   * monotonicMs)，并按返回类型处理结果。
   */
  publish(topic: string, payload: InspectorJsonValue, monotonicMs?: number): void

  /** Read-only Cordis topology queries independent of CDP sessions. */
  readonly cordis: CordisRuntimeTreeReader
}

/**
 * Create the shared service façade without exposing the carrier implementation.
 * @param connection - Realm-local observation and query transport.
 * @returns The Cordis service value.
 * @remarks 中文说明：功能说明：创建 Inspector Service 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：connection（InspectorConnection）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：InspectorService；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * createInspectorService(connection)，并按返回类型处理结果。
 */
export function createInspectorService(connection: InspectorConnection): InspectorService {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：topic（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：payload（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：monotonicMs（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(topic, payload,
   * monotonicMs)，并按返回类型处理结果。
   */
  return {
    publish: (topic, payload, monotonicMs) => { connection.publish(topic, payload, monotonicMs) },
    cordis: createQueryCordisRuntimeTreeReader(connection),
  }
}
