/**
 * Configuration vocabulary for the replay-aware basic compaction backend.
 *
 * @module @deepseek-ai/dsh-compaction-basic/types
 */
/**
 * 文件职责：实现上下文压缩的 types.ts 模块。
 * 技术维度：TypeScript、Cordis 插件、会话事件和严格判别联合。
 * 产品维度：控制模型请求中的上下文压缩信息。
 * 逻辑维度：读取日志或文件状态，计算投影并记录/注入结果。
 * 关键边界：不能静默丢失必需事件；裁剪和替换必须保持日志可重放。
 * 新手阅读建议：先读导出类型与配置，再跟踪事件和投影流程。
 */

import type { LlmCallConfig } from '@deepseek-ai/dsh-llm'

/** Policy fields shared by the default policy and exact model overrides. */
/** 中文说明：类型或类 CompactionPolicyConfig 约束上下文或压缩数据职责。 */
export interface CompactionPolicyConfig {
  /** Compact at this fraction of the model's context window. Defaults to `0.8`. */
  thresholdRatio?: number
  /** Recent context retained as a fraction of the model's window. Defaults to `0.16`. */
  retainRatio?: number
  /** Absolute recent-context budget; mutually exclusive with `retainRatio`. */
  retainTokens?: number
  /** Summary provider; set together with `summarizationModel`, or inherit the conversation target. */
  summarizationProvider?: string
  /** Summary model; set together with `summarizationProvider`, or inherit the conversation target. */
  summarizationModel?: string
  /** Provider generation cap for summarization. Defaults to `8192`. */
  maxTokens?: number
  /** Extra attempts after the first compaction when pressure remains above threshold. Defaults to `1`. */
  compactionRetries?: number
  /** Maximum retries after canonical context overflow; `0` disables recovery. Defaults to `1`. */
  maxOverflowRetries?: number
}

/** Exact provider/model override merged over the default compaction policy. */
/** 中文说明：类型或类 ModelCompactPolicyConfig 约束上下文或压缩数据职责。 */
export interface ModelCompactPolicyConfig extends CompactionPolicyConfig {
  /** Registered provider route to match. */
  provider: string
  /** Exact routed model id to match within `provider`. */
  model: string
}

/** Basic compaction configuration with an optional exact-target policy table. */
/** 中文说明：类型或类 BasicCompactionConfig 约束上下文或压缩数据职责。 */
export interface BasicCompactionConfig extends CompactionPolicyConfig {
  /** Exact provider/model overrides; duplicate targets fail plugin load. */
  modelPolicies?: ModelCompactPolicyConfig[]
  /** Enable automatic step-boundary pressure and overflow-recovery listeners. Defaults to `true`. */
  auto?: boolean
}

/** Exactly one validated retention form. */
/** 中文说明：类型或类 ResolvedRetention 约束上下文或压缩数据职责。 */
export type ResolvedRetention =
  | { readonly retainRatio: number; readonly retainTokens?: never }
  | { readonly retainRatio?: never; readonly retainTokens: number }

/** Validated policy fields shared before and after exact-target matching. */
/** 中文说明：类型或类 ResolvedPolicyFields 约束上下文或压缩数据职责。 */
interface ResolvedPolicyFields {
  readonly thresholdRatio: number
  readonly summarizationProvider: string
  readonly summarizationModel: string
  readonly maxTokens: number
  readonly compactionRetries: number
  readonly maxOverflowRetries: number
}

/** Validated immutable config whose target-specific defaults remain unresolved. */
/** 中文说明：类型或类 ResolvedConfig 约束上下文或压缩数据职责。 */
export type ResolvedConfig = ResolvedPolicyFields & ResolvedRetention & {
  readonly modelPolicies: readonly Readonly<ModelCompactPolicyConfig>[]
  readonly auto: boolean
}

/** Fully merged policy for one routed conversation target, before capacity scaling. */
/** 中文说明：类型或类 ResolvedTargetPolicy 约束上下文或压缩数据职责。 */
export type ResolvedTargetPolicy = ResolvedPolicyFields & ResolvedRetention & {
  readonly target: Pick<LlmCallConfig, 'provider' | 'model'>
}

/** One routed model's concrete pressure and retention budget. */
/** 中文说明：类型或类 ResolvedCompactSpec 约束上下文或压缩数据职责。 */
export type ResolvedCompactSpec = Omit<ResolvedTargetPolicy, 'retainRatio' | 'retainTokens'> & {
  readonly contextWindow: number
  readonly thresholdTokens: number
  readonly retainTokens: number
}
