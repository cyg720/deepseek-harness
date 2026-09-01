/*
 * 中文导读：本模块从会话事件投影 Agent 的当前轮次、最近轮次和步骤边界状态。
 */

import type { TurnBoundaryProjection } from './types.ts'
import type {} from '@deepseek-ai/dsh-session-projection'

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    /** The agent session's open/last turn and step boundary facts (whole value). */
    turnBoundary: TurnBoundaryProjection
  }
}

export {}
