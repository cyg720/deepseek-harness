/** Runtime constructors and protocol constants for the goal domain. */

import { HarnessError } from '@deepseek-ai/dsh-llm'
import type { RemoteError, RemoteErrorDetailsMap } from '@deepseek-ai/dsh-typert-protocol'
import type { GoalId as GoalIdType } from './types.ts'
import type { GoalErrorCode } from './domain.ts'

/** Version of the goal change embedded in a round-zero message source. */
export const GOAL_CHANGE_VERSION = 1

/**
 * Brand a string as a goal id.
 * @param id - raw goal identifier.
 * @returns the same string with the compile-time brand.
 */
export function GoalId(id: string): GoalIdType {
  return id as GoalIdType
}

/** Error returned by the goal domain boundary. */
export class GoalError extends HarnessError implements RemoteError<GoalErrorCode> {
  // 保留工具端 HarnessError 元数据，同时满足 Gateway 的结构化错误识别，避免丢失 CAS 分类。
  declare readonly code: GoalErrorCode
  readonly isDSHRemoteError: true = true
  readonly details: RemoteErrorDetailsMap[GoalErrorCode] = {}

  /**
   * @param message - human-readable rejection reason.
   * @param code - stable machine-routable classification.
   */
  // Keep the constructor to narrow HarnessError's string code at this boundary.
  // oxlint-disable-next-line typescript/no-useless-constructor -- type-only narrowing
  constructor(message: string, code: GoalErrorCode) {
    super(message, code)
  }
}
