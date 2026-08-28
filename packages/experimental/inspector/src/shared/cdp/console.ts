/** Realm-neutral Console events emitted by Runtime backends.
 * @remarks 文件说明：文件职责：实现 experimental/inspector 中 console 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/inspector 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。 */

import type { RuntimeRemoteObject } from './remote-object.ts'
import type { RuntimeExceptionDetails, RuntimeStackTrace } from './errors.ts'

/** Console API categories exposed by CDP Runtime. */
export type RuntimeConsoleType =
  | 'log'
  | 'debug'
  | 'info'
  | 'error'
  | 'warning'
  | 'dir'
  | 'dirxml'
  | 'table'
  | 'trace'
  | 'clear'
  | 'startGroup'
  | 'startGroupCollapsed'
  | 'endGroup'
  | 'assert'
  | 'profile'
  | 'profileEnd'
  | 'count'
  | 'timeEnd'

/** One Console event associated with a single inspected realm. */
export interface RuntimeConsoleEvent<Handle extends string> {
  readonly type: RuntimeConsoleType
  readonly arguments: readonly RuntimeRemoteObject<Handle>[]
  readonly timestamp: number
  readonly contextId?: number
  readonly stackTrace?: RuntimeStackTrace
}

/** One uncaught exception observed in an inspected realm. */
export interface RuntimeExceptionEvent<Handle extends string> {
  readonly timestamp: number
  readonly contextId?: number
  readonly details: RuntimeExceptionDetails<Handle>
}

/** Console-domain event emitted by a realm backend. */
export type RuntimeConsoleBackendEvent<Handle extends string> =
  | { readonly type: 'console-api'; readonly event: RuntimeConsoleEvent<Handle> }
  | { readonly type: 'exception'; readonly event: RuntimeExceptionEvent<Handle> }
