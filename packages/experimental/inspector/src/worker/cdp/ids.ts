/** Opaque identifiers owned by one Worker-side Chrome DevTools connection.
 * @remarks 文件说明：文件职责：实现 experimental/inspector 中 ids 模块的职责，并向相邻模块提供可复用能力。；
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/inspector 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。 */

import type { InspectorId } from '../../shared/identity.ts'

/**
 * 常量说明：cdpNumericIdBrand 用于处理 cdpNumericIdBrand 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
declare const cdpNumericIdBrand: unique symbol

/** Number branded with one Chrome CDP identity role. */
export type CdpNumericId<Role extends string> = number & { readonly [cdpNumericIdBrand]: Role }

/** Identity of one DevTools connection inside the Worker. */
export type InspectorConnectionId = InspectorId<'InspectorConnectionId'>

/** Runtime object id scoped to one DevTools connection. */
export type CdpRemoteObjectId = InspectorId<'CdpRemoteObjectId'>

/** Debugger script id scoped to one DevTools connection. */
export type CdpScriptId = InspectorId<'CdpScriptId'>

/** Debugger call-frame id scoped to one paused DevTools session. */
export type CdpCallFrameId = InspectorId<'CdpCallFrameId'>

/** Runtime execution-context id scoped to one DevTools target. */
export type CdpExecutionContextId = CdpNumericId<'CdpExecutionContextId'>

/** DOM frontend node id scoped to one DevTools document. */
export type CdpNodeId = CdpNumericId<'CdpNodeId'>

/** DOM backend node id stable across connection-local document projections. */
export type CdpBackendNodeId = CdpNumericId<'CdpBackendNodeId'>

/**
 * Validate and brand a string id allocated or accepted by the CDP adapter.
 * @param value - CDP identifier text.
 * @param label - Field named in validation failures.
 * @returns The branded CDP identifier.
 * @remarks 中文说明：功能说明：处理 cdpStringId 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：value（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：label（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：InspectorId<Role>；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 cdpStringId(value, label)，
 * 并按返回类型处理结果。
 */
export function cdpStringId<Role extends string>(value: string, label: string): InspectorId<Role> {
  if (value.length === 0 || value.length > 16_384) {
    throw new Error(`inspector CDP: ${label} must contain 1 to 16384 characters`)
  }
  return value as InspectorId<Role>
}

/**
 * Validate and brand a positive numeric id allocated by the CDP adapter.
 * @param value - CDP identifier number.
 * @param label - Field named in validation failures.
 * @returns The branded numeric identifier.
 * @remarks 中文说明：功能说明：处理 cdpNumericId 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：value（number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：label（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：CdpNumericId<Role>；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 cdpNumericId(value,
 * label)，并按返回类型处理结果。
 */
export function cdpNumericId<Role extends string>(value: number, label: string): CdpNumericId<Role> {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`inspector CDP: ${label} must be a positive integer`)
  return value as CdpNumericId<Role>
}
