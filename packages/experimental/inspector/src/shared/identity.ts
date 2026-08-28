/** Shared branded-identifier construction without assigning protocol ownership.
 * @remarks 文件说明：文件职责：实现 experimental/inspector 中 identity 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/inspector 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。 */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** String branded with one Inspector identity role. */
export type InspectorId<Role extends string> = Branded<Role>

/**
 * Validate and brand a non-empty identifier received from or sent across a runtime boundary.
 * @param value - Untrusted identifier text.
 * @param label - Field name used in validation errors.
 * @returns The role-branded identifier.
 * @remarks 中文说明：功能说明：处理 inspectorId 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：value（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：label（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：InspectorId<Role>；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 inspectorId(value, label)，
 * 并按返回类型处理结果。
 */
export function inspectorId<Role extends string>(value: string, label: string): InspectorId<Role> {
  if (value.length === 0 || value.length > 256) {
    throw new Error(`inspector protocol: ${label} must contain 1 to 256 characters`)
  }
  return value as InspectorId<Role>
}
