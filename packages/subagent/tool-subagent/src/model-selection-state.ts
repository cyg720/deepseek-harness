/** Durable per-session state for the user-controlled model-selection opt-in.
 * @remarks 文件说明：文件职责：实现 subagent/tool-subagent 中 model selection state
 * 模块的职责，并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与
 * Cordis 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * subagent/tool-subagent 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。 */

import type { Session } from '@deepseek-ai/dsh-session'
import { assertAllowedModelRoutes, type AllowedModelRoute } from './model-selection.ts'

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * Records that this session's delegation tool exposes child provider,
     * model, and reasoning-effort selection. Appended before the first model
     * request; absence means the fixed-route definition. Log-only: it carries
     * no `surfaceOp` and never enters model history.
     */
    'subagent/model-selection-policy': {
      /** Exact routes this Session may select explicitly for a child. */
      allowedModels: AllowedModelRoute[]
    }
  }
}

/**
 * Read the exact route list captured for a model-selectable definition.
 * @param session - session whose durable decision is read.
 * @returns a detached route list, or undefined for the fixed-route definition.
 * @remarks 中文说明：功能说明：处理 subagentModelSelectionPolicy 相关流程；使用场景由所在模块及调用位置决定。
 * ；参数说明：session（Session）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：AllowedModelRoute[] | undefined；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 subagentModelSelectionPolicy(session)，并按返回类型处理结果。
 */
export function subagentModelSelectionPolicy(session: Session): AllowedModelRoute[] | undefined {
  /**
   * 常量说明：event 用于处理 event 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：candidate（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(candidate)，并按返回类型处理结果。
   */
  const event = session.events.find(candidate => candidate.type === 'subagent/model-selection-policy')
  if (event?.type !== 'subagent/model-selection-policy') return undefined
  /**
   * 常量说明：allowedModels 用于处理 allowedModels 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const { allowedModels } = event.data
  assertAllowedModelRoutes(allowedModels)
  /**
   * 常量说明：routes 用于处理 routes 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：route（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(route)，并按返回类型处理结果。
   */
  const routes = allowedModels.map(route => ({ ...route }))
  if (routes.length === 0) throw new Error('subagent/model-selection-policy requires at least one route')
  return routes
}

/**
 * Append the route policy once, before its definition can reach a model request.
 * @param session - session receiving the model-selectable definition.
 * @param allowedModels - exact routes the definition may select explicitly.
 * @remarks 中文说明：功能说明：处理 recordSubagentModelSelection 相关流程；使用场景由所在模块及调用位置决定。
 * ；参数说明：session（Session）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：allowedModels（readonly AllowedModelRoute[]）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。；返回值：void；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 recordSubagentModelSelection(session,
 * allowedModels)，并按返回类型处理结果。
 */
export function recordSubagentModelSelection(session: Session, allowedModels: readonly AllowedModelRoute[]): void {
  if (subagentModelSelectionPolicy(session) !== undefined) return
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：route（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(route)，并按返回类型处理结果。
   */
  session.append('subagent/model-selection-policy', {
    allowedModels: allowedModels.map(route => ({ ...route })),
  })
}
