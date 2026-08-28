/** Opaque webhook identities shared by adapters, rules, and Session provenance.
 * @remarks 文件说明：文件职责：实现 webhook/webhook 中 brand 模块的职责，并向相邻模块提供可复用能力。；
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的 webhook/webhook 能力，
 * 使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。；
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。 */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** Identifies one programmatic webhook rule. */
export type WebhookRuleId = Branded<'WebhookRuleId'>

/** Identifies one configured webhook adapter instance. */
export type WebhookSourceId = Branded<'WebhookSourceId'>

/** Identifies one provider delivery. The runtime assigns no deduplication semantics. */
export type WebhookDeliveryId = Branded<'WebhookDeliveryId'>

/**
 * Brand a webhook rule id.
 * @param value - non-empty rule identifier validated at registration.
 * @returns the same string with its compile-time brand.
 * @remarks 中文说明：功能说明：处理 WebhookRuleId 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：value（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：WebhookRuleId；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 WebhookRuleId(value)，
 * 并按返回类型处理结果。
 */
export function WebhookRuleId(value: string): WebhookRuleId {
  return value as WebhookRuleId
}

/**
 * Brand a configured webhook source id.
 * @param value - non-empty adapter instance identifier validated by its adapter.
 * @returns the same string with its compile-time brand.
 * @remarks 中文说明：功能说明：处理 WebhookSourceId 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：value（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：WebhookSourceId；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 WebhookSourceId(value)，
 * 并按返回类型处理结果。
 */
export function WebhookSourceId(value: string): WebhookSourceId {
  return value as WebhookSourceId
}

/**
 * Brand a provider delivery id.
 * @param value - non-empty provider identity validated by its adapter.
 * @returns the same string with its compile-time brand.
 * @remarks 中文说明：功能说明：处理 WebhookDeliveryId 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：value（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：WebhookDeliveryId；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 WebhookDeliveryId(value)，
 * 并按返回类型处理结果。
 */
export function WebhookDeliveryId(value: string): WebhookDeliveryId {
  return value as WebhookDeliveryId
}
