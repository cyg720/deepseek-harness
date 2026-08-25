/**
 * Durable and model-facing Schedule value types.
 * @module @deepseek-ai/dsh-schedule
 */
/**
 * 文件职责：实现 types.ts 承担的计划调度配置、协议与生命周期职责。
 * 技术维度：使用 TypeScript、Cordis 插件、配置校验、事件日志与异步资源管理。
 * 产品维度：为 Agent 提供可靠的计划调度能力。
 * 逻辑维度：解析输入，注册能力，执行核心操作，并在结束时释放所拥有的资源。
 * 关键边界：权限和配置失败必须显式；模型可见状态必须记录；清理必须达到静止状态。
 * 新手阅读建议：先看导出类型和常量，再读主流程，最后关注平台限制、恢复和清理。
 */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type {} from '@deepseek-ai/dsh-session/types'

/** Stable reminder identity that is unique and never reused within one session. */
/** 中文说明：type ScheduleId 定义本模块所需的数据或行为，用于表达计划调度场景。 */
export type ScheduleId = Branded<'ScheduleId'>

/** Durable one-shot reminder created from a positive delay. */
/** 中文说明：interface AfterScheduleRecord 定义本模块所需的数据或行为，用于表达计划调度场景。 */
export interface AfterScheduleRecord {
  /** Session-local stable identity. */
  readonly id: ScheduleId
  /** Rule discriminator for a delayed one-shot reminder. */
  readonly kind: 'after'
  /** Trimmed reminder content supplied at creation. */
  readonly prompt: string
  /** Positive safe-integer delay accepted at creation. */
  readonly afterSeconds: number
  /** Four-digit-year RFC 3339 UTC target. */
  readonly scheduledAt: string
}

/** Durable one-shot reminder created from an absolute instant. */
/** 中文说明：interface AtScheduleRecord 定义本模块所需的数据或行为，用于表达计划调度场景。 */
export interface AtScheduleRecord {
  /** Session-local stable identity. */
  readonly id: ScheduleId
  /** Rule discriminator for an absolute one-shot reminder. */
  readonly kind: 'at'
  /** Trimmed reminder content supplied at creation. */
  readonly prompt: string
  /** Four-digit-year RFC 3339 UTC target. */
  readonly scheduledAt: string
}

/** Durable fixed-rate reminder whose next target remains creation-anchor-aligned. */
/** 中文说明：interface EveryScheduleRecord 定义本模块所需的数据或行为，用于表达计划调度场景。 */
export interface EveryScheduleRecord {
  /** Session-local stable identity. */
  readonly id: ScheduleId
  /** Rule discriminator for a fixed-rate recurring reminder. */
  readonly kind: 'every'
  /** Trimmed reminder content supplied at creation. */
  readonly prompt: string
  /** Fixed safe-integer interval, never below five minutes. */
  readonly everySeconds: number
  /** Earliest anchor-aligned occurrence not yet dispatched. */
  readonly scheduledAt: string
}

/** Structured local-calendar input accepted by `schedule_create`. */
/** 中文说明：interface LocalAtInput 定义本模块所需的数据或行为，用于表达计划调度场景。 */
export interface LocalAtInput {
  /** Four-digit ISO calendar date. */
  readonly date: string
  /** Local wall-clock time with optional one-to-three digit milliseconds. */
  readonly time: string
  /** Explicit UTC or IANA Area/Location zone. */
  readonly time_zone: string
}

/** Absolute selector accepted by `schedule_create`. */
/** 中文说明：type AtInput 定义本模块所需的数据或行为，用于表达计划调度场景。 */
export type AtInput = string | LocalAtInput

/** One-shot record variants that terminate on an id-only dispatch. */
/** 中文说明：type OneShotScheduleRecord 定义本模块所需的数据或行为，用于表达计划调度场景。 */
export type OneShotScheduleRecord = AfterScheduleRecord | AtScheduleRecord

/** The v1 durable reminder record union. */
/** 中文说明：type ScheduleRecord 定义本模块所需的数据或行为，用于表达计划调度场景。 */
export type ScheduleRecord = OneShotScheduleRecord | EveryScheduleRecord

/** Creates one durable reminder record. */
/** 中文说明：interface ScheduleCreateChange 定义本模块所需的数据或行为，用于表达计划调度场景。 */
export interface ScheduleCreateChange {
  readonly version: 1
  readonly operation: 'create'
  readonly schedule: ScheduleRecord
}

/** Deletes one currently active reminder. */
/** 中文说明：interface ScheduleDeleteChange 定义本模块所需的数据或行为，用于表达计划调度场景。 */
export interface ScheduleDeleteChange {
  readonly version: 1
  readonly operation: 'delete'
  readonly id: ScheduleId
}

/** Records that one active one-shot reminder entered the durable dispatch history. */
/** 中文说明：interface OneShotScheduleDispatchChange 定义本模块所需的数据或行为，用于表达计划调度场景。 */
export interface OneShotScheduleDispatchChange {
  readonly version: 1
  readonly operation: 'dispatch'
  readonly id: ScheduleId
}

/** Records one fixed-rate decision and advances directly past missed occurrences. */
/** 中文说明：interface EveryScheduleDispatchChange 定义本模块所需的数据或行为，用于表达计划调度场景。 */
export interface EveryScheduleDispatchChange {
  readonly version: 1
  readonly operation: 'dispatch'
  readonly id: ScheduleId
  /** Wall-clock decision time used to select the latest due occurrence. */
  readonly acceptedAt: string
}

/** Durable dispatch shapes supported by the current rule set. */
/** 中文说明：type ScheduleDispatchChange 定义本模块所需的数据或行为，用于表达计划调度场景。 */
export type ScheduleDispatchChange = OneShotScheduleDispatchChange | EveryScheduleDispatchChange

/** Strict version-1 durable Schedule mutation union. */
/** 中文说明：type ScheduleChange 定义本模块所需的数据或行为，用于表达计划调度场景。 */
export type ScheduleChange = ScheduleCreateChange | ScheduleDeleteChange | ScheduleDispatchChange

/** Current delivery timing derived from the durable record and wall clock. */
/** 中文说明：type ScheduleState 定义本模块所需的数据或行为，用于表达计划调度场景。 */
export type ScheduleState = 'scheduled' | 'overdue'

/** Fixed v1 delivery boundary: the original session must be live. */
/** 中文说明：type ScheduleDeliveryMode 定义本模块所需的数据或行为，用于表达计划调度场景。 */
export type ScheduleDeliveryMode = 'session-local'

/** Complete model-facing view of one active reminder. */
/** 中文说明：type ScheduleView 定义本模块所需的数据或行为，用于表达计划调度场景。 */
export type ScheduleView = ScheduleRecord & {
  /** Whether the target remains in the future. */
  readonly state: ScheduleState
  /** Reminder delivery never leaves the owning session. */
  readonly deliveryMode: ScheduleDeliveryMode
}

/** Management operations whose persistence barrier may be uncertain. */
/** 中文说明：type SchedulePersistenceOperation 定义本模块所需的数据或行为，用于表达计划调度场景。 */
export type SchedulePersistenceOperation = 'create' | 'list' | 'delete'

/** Stable error returned for an empty reminder prompt. */
/** 中文说明：interface InvalidPromptError 定义本模块所需的数据或行为，用于表达计划调度场景。 */
export interface InvalidPromptError {
  readonly code: 'invalid_prompt'
  readonly message: string
}

/** Stable error returned for a missing, conflicting, or unsupported rule selector. */
/** 中文说明：interface InvalidSelectorError 定义本模块所需的数据或行为，用于表达计划调度场景。 */
export interface InvalidSelectorError {
  readonly code: 'invalid_selector'
  readonly message: string
}

/** Stable error returned for an invalid rule or management argument. */
/** 中文说明：interface InvalidRuleError 定义本模块所需的数据或行为，用于表达计划调度场景。 */
export interface InvalidRuleError {
  readonly code: 'invalid_rule'
  readonly message: string
}

/** Stable error returned for an invalid or unsupported IANA time zone. */
/** 中文说明：interface InvalidTimeZoneError 定义本模块所需的数据或行为，用于表达计划调度场景。 */
export interface InvalidTimeZoneError {
  readonly code: 'invalid_time_zone'
  readonly message: string
}

/** Stable error returned when an absolute target is not strictly future. */
/** 中文说明：interface NotFutureError 定义本模块所需的数据或行为，用于表达计划调度场景。 */
export interface NotFutureError {
  readonly code: 'not_future'
  readonly message: string
}

/** Stable error returned when the computed instant cannot use a four-digit UTC year. */
/** 中文说明：interface TimeOutOfRangeError 定义本模块所需的数据或行为，用于表达计划调度场景。 */
export interface TimeOutOfRangeError {
  readonly code: 'time_out_of_range'
  readonly message: string
}

/** Stable error returned when a fixed-rate rule runs more often than supported. */
/** 中文说明：interface FrequencyTooHighError 定义本模块所需的数据或行为，用于表达计划调度场景。 */
export interface FrequencyTooHighError {
  readonly code: 'frequency_too_high'
  readonly message: string
}

/** Stable error returned when the durable Schedule stream is malformed. */
/** 中文说明：interface CorruptScheduleLogError 定义本模块所需的数据或行为，用于表达计划调度场景。 */
export interface CorruptScheduleLogError {
  readonly code: 'corrupt_schedule_log'
  readonly message: string
}

/** Stable error returned when a required persistence checkpoint did not complete. */
/** 中文说明：interface PersistenceUncertainError 定义本模块所需的数据或行为，用于表达计划调度场景。 */
export interface PersistenceUncertainError {
  readonly code: 'persistence_uncertain'
  readonly message: string
  readonly operation: SchedulePersistenceOperation
  readonly id?: ScheduleId
}

/** Stable fallback that does not disclose an internal exception. */
/** 中文说明：interface InternalScheduleError 定义本模块所需的数据或行为，用于表达计划调度场景。 */
export interface InternalScheduleError {
  readonly code: 'internal_error'
  readonly message: string
}

/** Closed v1 Schedule management error union. */
/** 中文说明：type ScheduleToolError 定义本模块所需的数据或行为，用于表达计划调度场景。 */
export type ScheduleToolError =
  | InvalidPromptError
  | InvalidSelectorError
  | InvalidRuleError
  | InvalidTimeZoneError
  | NotFutureError
  | TimeOutOfRangeError
  | FrequencyTooHighError
  | CorruptScheduleLogError
  | PersistenceUncertainError
  | InternalScheduleError

/** Canonical `schedule_create` value. */
/** 中文说明：type ScheduleCreateValue 定义本模块所需的数据或行为，用于表达计划调度场景。 */
export type ScheduleCreateValue = ScheduleView | ScheduleToolError

/** Canonical `schedule_list` value. */
/** 中文说明：type ScheduleListValue 定义本模块所需的数据或行为，用于表达计划调度场景。 */
export type ScheduleListValue = ScheduleView[] | ScheduleToolError

/** Successful `schedule_delete` value, including the non-mutating not-found result. */
/** 中文说明：type ScheduleDeleteResult 定义本模块所需的数据或行为，用于表达计划调度场景。 */
export type ScheduleDeleteResult =
  | { readonly id: ScheduleId; readonly deleted: true }
  | { readonly id: ScheduleId; readonly deleted: false; readonly code: 'schedule_not_found' }

/** Canonical `schedule_delete` value. */
/** 中文说明：type ScheduleDeleteValue 定义本模块所需的数据或行为，用于表达计划调度场景。 */
export type ScheduleDeleteValue = ScheduleDeleteResult | ScheduleToolError

declare module '@deepseek-ai/dsh-session/types' {
  /** 中文说明：interface SessionEventMap 定义本模块所需的数据或行为，用于表达计划调度场景。 */
  interface SessionEventMap {
    /**
     * Versioned Schedule mutation. The owning package validates the complete
     * session-local transition stream before accepting a candidate event.
     */
    'schedule/change': ScheduleChange
  }
}
