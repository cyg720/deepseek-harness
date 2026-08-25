/**
 * Host-side vocabulary of the goal domain: live views, durable change
 * payloads, message attribution, replay folds, and the scoped `goal/changed`
 * event. Kept separate from ./types.ts (the pure client-safe outlet) because
 * these declarations pull dsh-agent, dsh-llm, and cordis into the program —
 * the one-program-per-side layout forbids that on client aggregates.
 * @module @deepseek-ai/dsh-goal
 */
/**
 * 文件职责：实现目标管理的 domain.ts 模块。
 * 技术维度：TypeScript、Cordis、会话事件、路径策略、判别联合和 Vitest。
 * 产品维度：保证目标管理操作可预测、可审计并在失败时保持一致。
 * 逻辑维度：校验输入，更新领域状态并记录事件或注册能力。
 * 关键边界：文件路径必须经过策略检查；目标引用含版本，过期修改必须拒绝。
 * 新手阅读建议：先读类型与测试夹具，再按校验、执行、事件折叠和错误流程阅读。
 */

import type { Agent } from '@deepseek-ai/dsh-agent'
import type { GoalId, GoalRef, GoalSnapshot, GoalView } from './types.ts'

/** Goal state-changing verbs recorded in the durable source change. */
/** 中文说明：类型或类 GoalOperation 约束文件或目标数据职责。 */
export type GoalOperation =
  | 'create'
  | 'edit'
  | 'pause'
  | 'resume'
  | 'complete'
  | 'block'
  | 'clear'

/** Full-snapshot goal mutation committed by a durable `goal/change` event. */
/** 中文说明：类型或类 GoalSnapshotChangeMeta 约束文件或目标数据职责。 */
export interface GoalSnapshotChangeMeta {
  readonly kind: 'goal/change'
  readonly version: 1
  readonly operation: Exclude<GoalOperation, 'clear'>
  readonly goal: GoalSnapshot
  readonly roundsStarted: number
  readonly createdAt: number
  readonly updatedAt: number
}

/** Tombstone retained when the current goal is cleared. */
/** 中文说明：类型或类 GoalClearChangeMeta 约束文件或目标数据职责。 */
export interface GoalClearChangeMeta {
  readonly kind: 'goal/change'
  readonly version: 1
  readonly operation: 'clear'
  readonly cleared: GoalRef
  readonly clearedAt: number
}

/** Durable change union carried by the goal domain's own session event. */
/** 中文说明：类型或类 GoalChangeMeta 约束文件或目标数据职责。 */
export type GoalChangeMeta = GoalSnapshotChangeMeta | GoalClearChangeMeta

/** Message attribution for admitted continuation rounds. */
/** 中文说明：类型或类 GoalMessageSource 约束文件或目标数据职责。 */
export interface GoalMessageSource {
  readonly kind: 'goal'
  readonly goalId: GoalId
  readonly revision: number
  /** Positive admitted continuation round. */
  readonly round: number
}

declare module '@deepseek-ai/dsh-llm' {
  /** 中文说明：类型或类 MessageSourceMap 约束文件或目标数据职责。 */
  interface MessageSourceMap {
    goal: GoalMessageSource
  }
}

declare module '@deepseek-ai/dsh-session/types' {
  /** 中文说明：类型或类 SessionEventMap 约束文件或目标数据职责。 */
  interface SessionEventMap {
    /**
     * Complete post-mutation goal state or clear tombstone.
     */
    'goal/change': GoalChangeMeta
  }
}

/** Pure replay fold of durable goal facts. */
/** 中文说明：类型或类 FoldedGoal 约束文件或目标数据职责。 */
export interface FoldedGoal {
  /** Current goal, absent after a clear or before the first create. */
  readonly goal?: GoalSnapshot
  /** Highest admitted round for the current goal. */
  readonly roundsStarted: number
  /** Current goal creation time, absent without a current goal. */
  readonly createdAt?: number
  /** Current goal mutation time, absent without a current goal. */
  readonly updatedAt?: number
  /** Latest mutation ref, including a clear tombstone. */
  readonly lastRef?: GoalRef
}

/** Live notification after one durable goal mutation commits. */
/** 中文说明：类型或类 GoalChanged 约束文件或目标数据职责。 */
export interface GoalChanged {
  readonly operation: GoalOperation
  readonly ref: GoalRef
  /** Absent for a clear tombstone. */
  readonly goal?: GoalView
}

/** Stable error codes for rejected goal reads and mutations. */
/** 中文说明：类型或类 GoalErrorCode 约束文件或目标数据职责。 */
export type GoalErrorCode =
  | 'GOAL_AGENT_NOT_LIVE'
  | 'GOAL_NOT_FOUND'
  | 'GOAL_ALREADY_EXISTS'
  | 'GOAL_STALE_REVISION'
  | 'GOAL_INVALID_OBJECTIVE'
  | 'GOAL_INVALID_MAX_ROUNDS'
  | 'GOAL_INVALID_BLOCK_REASON'
  | 'GOAL_INVALID_EDIT'
  | 'GOAL_INVALID_TRANSITION'

declare module '@deepseek-ai/cordis' {
  /** 中文说明：类型或类 Events 约束文件或目标数据职责。 */
  interface Events {
    /**
     * Goal mutation accepted by one live agent. The matching `goal/change`
     * session event has already committed. Listener failures are contained.
     * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent.
     * @param payload.agent - agent whose session owns the goal.
     * @param payload.change - fresh current projection or clear tombstone.
     * @mode emit
     */
    'goal/changed'(this: import('@deepseek-ai/dsh-scope').Scoped<Agent>, payload: { agent: Agent; change: GoalChanged }): void
  }
}
