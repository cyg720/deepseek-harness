/** Source-side interfaces shared by MessagePort and WebSocket bridge implementations.
 * @remarks 文件说明：文件职责：实现 experimental/inspector 中 publisher 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/inspector 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。 */

import type { InspectorJsonValue } from '../json.ts'
import type { InspectorQuery, InspectorQueryRequester, InspectorQueryResultFor } from './messages/query/commands.ts'

/** Transport-independent observation publisher. */
export interface InspectorPublisher {
  /** Publish one validated observation.
   * @remarks 中文说明：功能说明：处理 publish 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：topic（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：payload（InspectorJsonValue）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：monotonicMs（number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 publish(topic, payload,
   * monotonicMs)，并按返回类型处理结果。 */
  publish(topic: string, payload: InspectorJsonValue, monotonicMs?: number): void
}

/** Publisher that also retains the latest value of stateful observation topics. */
export interface InspectorStatePublisher extends InspectorPublisher {
  /**
   * Replace one topic's retained state and publish the replacement.
   * @param topic - Domain-owned state topic.
   * @param payload - Latest JSON state, replayed after source resynchronization.
   * @param monotonicMs - Source-clock timestamp; defaults to `performance.now()`.
   * @remarks 中文说明：功能说明：设置 State 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：topic（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：payload（InspectorJsonValue）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：monotonicMs（number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 setState(topic, payload,
   * monotonicMs)，并按返回类型处理结果。
   */
  setState(topic: string, payload: InspectorJsonValue, monotonicMs?: number): void
}

/** Shared capabilities exposed above a Host MessagePort or Client WebSocket carrier. */
export interface InspectorConnection extends InspectorStatePublisher, InspectorQueryRequester {}

/** Shared observation and query delegation inherited by both source transports.
 * @remarks 中文说明：类说明：InspectorSourceConnection 用于集中封装 处理
 * InspectorSourceConnection 相关状态与行为。；核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。；
 * 使用场景：由 experimental/inspector 在对应插件或业务生命周期内创建和调用。 */
export abstract class InspectorSourceConnection implements InspectorConnection {
  /**
   * 常量说明：publisher 用于处理 publisher 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  protected abstract readonly publisher: InspectorStatePublisher
  /**
   * 常量说明：queries 用于处理 queries 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  protected abstract readonly queries: InspectorQueryRequester

  /** Publish one JSON observation without waiting on its carrier.
   * @remarks 中文说明：功能说明：处理 publish 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：topic（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：payload（InspectorJsonValue）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：monotonicMs（由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：void；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 publish(topic,
   * payload, monotonicMs)，并按返回类型处理结果。 */
  publish(topic: string, payload: InspectorJsonValue, monotonicMs = performance.now()): void {
    this.publisher.publish(topic, payload, monotonicMs)
  }

  /** Retain and publish one state value for reconnect or replacement recovery.
   * @remarks 中文说明：功能说明：设置 State 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：topic（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：payload（InspectorJsonValue）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：monotonicMs（由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：void；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 setState(topic,
   * payload, monotonicMs)，并按返回类型处理结果。 */
  setState(topic: string, payload: InspectorJsonValue, monotonicMs = performance.now()): void {
    this.publisher.setState(topic, payload, monotonicMs)
  }

  /** Execute one non-CDP query through the active source generation.
   * @remarks 中文说明：功能说明：处理 request 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：query（Query）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：Promise<InspectorQueryResultFor<Query>>；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 使用示例：典型用法：在完成前置校验后调用 request(query)，并按返回类型处理结果。 */
  request<Query extends InspectorQuery>(query: Query): Promise<InspectorQueryResultFor<Query>> {
    return this.queries.request(query)
  }
}
