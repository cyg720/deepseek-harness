/** Runtime constructors and protocol constants for the goal domain. */
/**
 * 文件职责：提供目标领域的品牌化 ID 构造器、协议版本常量和稳定错误类型。
 * 技术维度：使用 TypeScript 品牌转换、HarnessError 继承和受限错误码联合。
 * 产品维度：让目标创建与推进结果可被可靠路由，并为轮次零消息保留明确版本。
 * 逻辑维度：声明 GOAL_CHANGE_VERSION，提供 GoalId 转换，再用 GoalError 收窄错误码类型。
 * 关键边界：GoalId 不做运行时验证；版本常量变更必须与消息协议消费者同步。
 * 新手阅读建议：先看常量和 ID 的纯类型作用，再理解 GoalError 为什么保留看似简单的构造函数。
 */

import { HarnessError } from '@deepseek-ai/dsh-llm'
import type { GoalId as GoalIdType } from './types.ts'
import type { GoalErrorCode } from './domain.ts'

/** Version of the goal change embedded in a round-zero message source. */
/** GOAL_CHANGE_VERSION：轮次零消息源中目标变更记录的协议版本，当前固定为 1。 */
export const GOAL_CHANGE_VERSION = 1

/**
 * Brand a string as a goal id.
 * @param id - raw goal identifier.
 * @returns the same string with the compile-time brand.
 */
/**
 * 把原始字符串标记为目标 ID。
 * @param id - 已由目标领域产生或验证的原始标识。
 * @returns 运行时不变、仅带 GoalId 编译期品牌的字符串。
 * @example GoalId('goal-1')。
 */
export function GoalId(id: string): GoalIdType {
  return id as GoalIdType
}

/** Error returned by the goal domain boundary. */
/** GoalError：目标领域边界返回的错误，携带稳定可路由的 GoalErrorCode。 */
export class GoalError extends HarnessError {
  /**
   * @param message - human-readable rejection reason.
   * @param code - stable machine-routable classification.
   */
  /**
   * 功能描述：创建目标领域错误并把受限错误码传给 HarnessError。
   * 参数说明：message 是可读拒绝原因；code 是稳定 GoalErrorCode。
   * 返回值解释：构造新的 GoalError 实例。
   * 使用示例：new GoalError('goal missing', 'NOT_FOUND')，具体 code 以领域联合为准。
   */
  // Keep the constructor to narrow HarnessError's string code at this boundary.
  // 保留此构造函数是为了在目标边界把 HarnessError 的普通字符串码收窄为 GoalErrorCode。
  // oxlint-disable-next-line typescript/no-useless-constructor -- type-only narrowing
  constructor(message: string, code: GoalErrorCode) {
    super(message, code)
  }
}
