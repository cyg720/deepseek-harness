/**
 * ================================ 文件注释 ================================
 * 【文件职责】通过声明合并把两个重试事件注册进 dsh-session 的 SessionEventMap，
 * 并定义它们的持久负载类型：llm/retry（调度记录）与 llm/retry-started（等待
 * 完成记录）。
 * 【技术维度】类型合并（declaration merging）：扩展会话事件映射后，重试记录
 * 就能进入统一的会话日志（持久化 + 可回放）；normal/always 两种模式用判别
 * 联合区分负载字段（always 不带 maxRetries）。
 * 【产品维度】"每次调度的重试在可取消等待前都是持久的"（英文模块注释的契约）：
 * 调度先落日志再等待，崩溃/重启后可从日志重建重试意图。
 * 【逻辑维度】事件声明 → llm/retry 负载（两模式联合）→ llm/retry-started 负载。
 * 【关键边界】llm/retry 是"非展示面"的持久记录；llm/retry-started 在等待
 * 成功、下一次请求尝试开始之前写入。
 * 【新手阅读建议】对照 index.ts 的 backoff 函数看两个事件各自的写入时机。
 * ==========================================================================
 */

import type { LlmFailure } from '@deepseek-ai/dsh-llm/types'
import type { RetryId } from './brand.ts'

export type { RetryId }

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Durable, non-surface record of one provider-routed retry scheduled after a failed request attempt. */
    // 中文：一次请求尝试失败后、按 provider 路由调度重试的持久（非展示面）记录。
    'llm/retry': LlmRetryEventData
    /** Durable transition written after a retry wait succeeds and before the next request attempt starts. */
    // 中文：重试等待成功、下一次请求尝试开始之前写入的持久转换记录。
    'llm/retry-started': LlmRetryStartedEventData
  }
}

/** Durable payload recorded before one provider-routed model-request retry wait. */
/*
 * （中文）一次 provider 路由的模型请求重试等待前记录的持久负载。normal 模式
 * 额外携带 maxRetries（供校验 retry 不超限）；always 模式省略它。
 */
export type LlmRetryEventData =
  | {
    // 中文：重试链稳定身份。
    retryId: RetryId
    // 中文：所属轮次。
    turn: number
    // 中文：所属步骤。
    step: number
    // 中文：失败请求的 provider 路由。
    provider: string
    // 中文：策略模式。
    mode: 'normal'
    // 中文：策略的稳定键（变化即视为新策略链）。
    policyKey: string
    // 中文：本次重试序号（从 1 起）。
    retry: number
    // 中文：策略最大重试次数。
    maxRetries: number
    // 中文：本次等待的延迟毫秒数。
    delayMs: number
    // 中文：触发重试的失败事实。
    failure: LlmFailure
  }

  | {
    retryId: RetryId
    turn: number
    step: number
    provider: string
    mode: 'always'
    policyKey: string
    retry: number
    delayMs: number
    failure: LlmFailure
  }

/** Durable transition recorded after one retry delay completes. */
/*
 * （中文）一次重试延迟完成后记录的持久转换（等待成功、即将开始下一次尝试）。
 */
export interface LlmRetryStartedEventData {
  // 中文：重试链稳定身份（与调度记录一致）。
  retryId: RetryId
  // 中文：轮次。
  turn: number
  // 中文：步骤。
  step: number
  // 中文：重试序号。
  retry: number
}
