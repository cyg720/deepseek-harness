/**
 * Pure types of the plan domain: the ONE home of the `plan` projection-key
 * declaration, free of this package's host-side value imports (cordis,
 * dsh-tools, dsh-agent). Two namespace projections serve it — `./types` for
 * host consumers and `./client` for client aggregates — with zero content
 * duplication.
 *
 * @module @deepseek-ai/dsh-plan-mode/types
 */

/*
 * 文件职责：定义计划模式投影的纯类型，并扩展会话投影键映射。
 * 技术维度：使用 TypeScript 接口与模块声明合并，在不引入宿主运行时代码的前提下共享类型。
 * 产品维度：让客户端和宿主都能一致展示当前计划模式及尚未落实的切换请求。
 * 逻辑维度：先定义 PlanProjection 的两个布尔字段，再把 plan 键登记到 SessionProjectionMap。
 * 关键边界：能力未装配时 plan 键应缺失，不能用两个 false 冒充能力存在。
 * 新手阅读建议：先分清 active 与 pending 的时间含义，再学习 declare module 如何扩展外部接口。
 */

import type { CommandId } from '@deepseek-ai/dsh-commands/brand'

/**
 * The plan projection's wire value. `active` is the logged state in force
 * (the last `plan/mode`, inactive before the first); `pending` is true while
 * a logged `/plan` selection targets a state other than `active`, has not
 * failed through its paired `command/done`, and no later `plan/mode` event has
 * recorded that state. Capability absence (plan-mode not composed) is the
 * key's absence, never a value.
 */
export interface PlanProjection {
  active: boolean
  pending: boolean
}

/** Host state used to derive {@link PlanProjection}. */
export interface PlanUnitState {
  /** Logged plan mode. */
  active: boolean
  /** The selection's target mode; null when no selection is outstanding. */
  wanted: boolean | null
  /** The latest plan command awaiting its paired settlement. */
  running: { commandId: CommandId; wanted: boolean } | null
  /** Active state recorded by the latest `request/header`, or null. */
  activeAtLastHeader: boolean | null
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    /** Host plan-mode fold state. */
    plan: PlanUnitState
  }
  interface SessionProjectionMap {
    /** Plan collaboration state folded from the plan command lifecycle and `plan/mode` events. */
    plan: PlanProjection
  }
}
