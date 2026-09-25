/**
 * 诊断行的视图模型：模型重试、终态失败与输出上限。
 *
 * 重试阶段只陈述官方记录的事实（已排期 / 已开始 / 已取消）；界面不安排本地倒计时，
 * 也不因为等待结束而发起任何请求。耗尽后的失败由本轮 turn-error 行陈述，重试行不自行宣称耗尽。
 */
import type { RetryChatData, TurnErrorNode, TurnMaxTokensNode } from '@deepseek-ai/dsh-client-ui-chat/client'

/** 重试行状态，取自官方客户端推导。 */
export type RetryState = 'scheduled' | 'started' | 'cancelled'

/** 重试行的视图模型。 */
export interface RetryModel {
  /** 当前尝试的阶段。 */
  readonly state: RetryState
  /** 当前尝试序号。 */
  readonly attempt: number
  /** 策略允许的最大重试次数；无上限策略时为 undefined。 */
  readonly maximum: number | undefined
  /** 官方记录的等待毫秒数（展示用，不是本地倒计时）。 */
  readonly delayMs: number
  /** 供应商名。 */
  readonly provider: string
  /** 失败的代码与消息；消息可能被官方脱敏为空串。 */
  readonly failure: { readonly code: string; readonly message: string } | undefined
  /** 已记录的重试条数。 */
  readonly attempts: number
}

/**
 * 构建重试模型。
 * @param data - `model-retry` 节点负载。
 * @returns 重试模型。
 */
export function retryModel(data: RetryChatData): RetryModel {
  const current = data.current
  return {
    state: current.retryState,
    attempt: current.retry,
    maximum: current.mode === 'normal' ? current.maxRetries : undefined,
    delayMs: current.delayMs,
    provider: current.provider,
    failure: current.failure.message === '' && current.failure.code === ''
      ? undefined
      : { code: current.failure.code, message: current.failure.message },
    attempts: data.attempts.length,
  }
}

/** 终态失败行的视图模型。 */
export interface TurnErrorModel {
  /** 官方错误代码；没有代码时为 undefined。 */
  readonly code: string | undefined
  /** 官方消息；已知代码时可能为空串。 */
  readonly message: string
}

/**
 * 构建终态失败模型。
 * @param data - `turn-error` 节点负载。
 * @returns 失败模型。
 */
export function turnErrorModel(data: TurnErrorNode): TurnErrorModel {
  return { code: data.code, message: data.message }
}

/** 输出上限行的视图模型。 */
export interface MaxTokensModel {
  /** 触发上限的轮次序号。 */
  readonly turn: number
}

/**
 * 构建输出上限模型。
 * @param data - `turn-max-tokens` 节点负载。
 * @returns 上限模型。
 */
export function maxTokensModel(data: TurnMaxTokensNode): MaxTokensModel {
  return { turn: data.turn }
}
