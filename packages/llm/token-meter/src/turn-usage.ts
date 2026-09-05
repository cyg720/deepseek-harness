/*
 * 【文件职责】汇总已完成轮次内各模型尝试的提供者用量，保留提供者和模型路由信息。
 */

import { expandAssistantStream } from '@deepseek-ai/dsh-llm/assistant-stream'
import type { AssistantMessage, TokenUsage } from '@deepseek-ai/dsh-llm/types'
import type {} from '@deepseek-ai/dsh-llm-retry/types'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'

/** One provider/model route that contributed a billed request attempt. */
export interface TurnTokenUsageRoute {
  readonly provider: string
  readonly model: string
}

/** Exact provider-reported token accounting for every attempt in one completed Turn. */
export interface TurnTokenUsage {
  /** Sum of uncached prompt input across all attempts. */
  readonly uncachedInputTokens: number
  readonly outputTokens: number
  /** Exact aggregate prompt plus output total across all attempts. */
  readonly totalTokens: number
  /** Present only when every attempt reported the bucket. */
  readonly cacheReadTokens?: number
  /** Present only when every attempt reported the bucket. */
  readonly cacheWriteTokens?: number
  /** Output subset, present only when every attempt reported it. */
  readonly reasoningTokens?: number
  /** Present only when every billed attempt has provider/model attribution. */
  readonly routes?: readonly TurnTokenUsageRoute[]
}

interface NormalizedAttempt {
  readonly inputTokens: number
  readonly outputTokens: number
  readonly totalTokens: number
  readonly cacheReadTokens?: number
  readonly cacheWriteTokens?: number
  readonly reasoningTokens?: number
  readonly route?: TurnTokenUsageRoute
}

type AttemptState =
  | { readonly kind: 'idle' }
  | {
    readonly kind: 'open'
    readonly turn: number
    readonly step: number
    readonly sample?: TokenUsage
  }
  | {
    readonly kind: 'finishClosed'
    readonly turn: number
    readonly step: number
  }
  | {
    readonly kind: 'settled'
    readonly turn: number
    readonly step: number
    readonly by: 'message' | 'retry'
  }

/**
 * 功能说明：判断是否为 Count 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns value is number；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 isCount(value)，并按返回类型处理结果。
 */
function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

/**
 * 功能说明：处理 safeSum 相关流程；使用场景由所在模块及调用位置决定。
 * @param values （readonly number[]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns number | undefined；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 safeSum(values)，并按返回类型处理结果。
 */
function safeSum(values: readonly number[]): number | undefined {
  /**
   * 变量说明：total 用于处理 total 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let total = 0
  /**
   * 变量说明：value 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (const value of values) {
    total += value
    if (!Number.isSafeInteger(total)) return undefined
  }
  return total
}

/**
 * 功能说明：处理 messageRoute 相关流程；使用场景由所在模块及调用位置决定。
 * @param message （AssistantMessage）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns TurnTokenUsageRoute | undefined；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 messageRoute(message)，并按返回类型处理结果。
 */
function messageRoute(message: AssistantMessage): TurnTokenUsageRoute | undefined {
  /**
   * 常量说明：provider、model 用于处理 provider、model 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const { provider, model } = message.source
  return provider.length > 0 && model.length > 0 ? { provider, model } : undefined
}

function streamUsage(stream: SessionEvent<'assistant/message'>['data']['stream']): TokenUsage | undefined {
  let sample: TokenUsage | undefined
  for (const member of expandAssistantStream(stream)) {
    if (member.chunk.type === 'usage') sample = member.chunk.usage
  }
  return sample
}

function normalizeUsage(usage: TokenUsage, route?: TurnTokenUsageRoute): NormalizedAttempt | undefined {
  /**
   * 常量说明：inputTokens、outputTokens、cacheReadTokens、cacheWriteTokens、reasoning
   * Tokens、totalTokens 用于处理 inputTokens、outputTokens、cacheReadTokens、cacheWr
   * iteTokens、reasoningTokens、totalTokens 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const {
    inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, reasoningTokens, totalTokens,
  } = usage
  if (!isCount(inputTokens) || !isCount(outputTokens)) return undefined
  if (cacheReadTokens !== undefined && !isCount(cacheReadTokens)) return undefined
  if (cacheWriteTokens !== undefined && !isCount(cacheWriteTokens)) return undefined
  if (reasoningTokens !== undefined && (!isCount(reasoningTokens) || reasoningTokens > outputTokens)) {
    return undefined
  }

  /**
   * 常量说明：knownPrompt 用于处理 knownPrompt 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const knownPrompt = safeSum([
    inputTokens,
    ...cacheReadTokens === undefined ? [] : [cacheReadTokens],
    ...cacheWriteTokens === undefined ? [] : [cacheWriteTokens],
  ])
  if (knownPrompt === undefined) return undefined

  /**
   * 变量说明：exactTotal 用于处理 exactTotal 相关数据，作用于当前作用域；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  let exactTotal: number
  if (totalTokens !== undefined) {
    if (!isCount(totalTokens)) return undefined
    /**
     * 常量说明：exactPrompt 用于处理 exactPrompt 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const exactPrompt = totalTokens - outputTokens
    if (!isCount(exactPrompt) || exactPrompt < knownPrompt) return undefined
    if (cacheReadTokens !== undefined && cacheWriteTokens !== undefined && exactPrompt !== knownPrompt) {
      return undefined
    }
    exactTotal = totalTokens
  } else {
    if (cacheReadTokens === undefined || cacheWriteTokens === undefined) return undefined
    /**
     * 常量说明：derivedTotal 用于处理 derivedTotal 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const derivedTotal = safeSum([knownPrompt, outputTokens])
    if (derivedTotal === undefined) return undefined
    exactTotal = derivedTotal
  }

  return {
    inputTokens,
    outputTokens,
    totalTokens: exactTotal,
    ...cacheReadTokens === undefined ? {} : { cacheReadTokens },
    ...cacheWriteTokens === undefined ? {} : { cacheWriteTokens },
    ...reasoningTokens === undefined ? {} : { reasoningTokens },
    ...route === undefined ? {} : { route },
  }
}

/**
 * 功能说明：处理 aggregateAttempts 相关流程；使用场景由所在模块及调用位置决定。
 * @param attempts （readonly NormalizedAttempt[]）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。
 * @returns TurnTokenUsage | undefined；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 aggregateAttempts(attempts)，并按返回类型处理结果。
 */
function aggregateAttempts(attempts: readonly NormalizedAttempt[]): TurnTokenUsage | undefined {
  if (attempts.length === 0) return undefined
  /**
   * 常量说明：inputTokens 用于处理 inputTokens 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：attempt（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(attempt)，并按返回类型处理结果。
   */
  const inputTokens = safeSum(attempts.map(attempt => attempt.inputTokens))
  /**
   * 常量说明：outputTokens 用于处理 outputTokens 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：attempt（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(attempt)，并按返回类型处理结果。
   */
  const outputTokens = safeSum(attempts.map(attempt => attempt.outputTokens))
  /**
   * 常量说明：totalTokens 用于处理 totalTokens 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：attempt（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(attempt)，并按返回类型处理结果。
   */
  const totalTokens = safeSum(attempts.map(attempt => attempt.totalTokens))
  if (inputTokens === undefined || outputTokens === undefined || totalTokens === undefined) return undefined

  /**
   * 常量说明：cacheRead 用于处理 cacheRead 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：attempt（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(attempt)，并按返回类型处理结果。
   */
  const cacheRead = attempts.map(attempt => attempt.cacheReadTokens)
  /**
   * 常量说明：cacheWrite 用于处理 cacheWrite 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：attempt（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(attempt)，并按返回类型处理结果。
   */
  const cacheWrite = attempts.map(attempt => attempt.cacheWriteTokens)
  /**
   * 常量说明：reasoning 用于处理 reasoning 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：attempt（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(attempt)，并按返回类型处理结果。
   */
  const reasoning = attempts.map(attempt => attempt.reasoningTokens)
  /**
   * 常量说明：cacheReadTokens 用于处理 cacheReadTokens 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const cacheReadTokens = cacheRead.every(isCount) ? safeSum(cacheRead) : undefined
  /**
   * 常量说明：cacheWriteTokens 用于处理 cacheWriteTokens 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const cacheWriteTokens = cacheWrite.every(isCount) ? safeSum(cacheWrite) : undefined
  /**
   * 常量说明：reasoningTokens 用于处理 reasoningTokens 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const reasoningTokens = reasoning.every(isCount) ? safeSum(reasoning) : undefined
  // A present cache bucket is bounded by exact prompt, and reasoning is bounded
  // by output. Safe required aggregates therefore imply safe optional sums.

  /**
   * 变量说明：routes 用于处理 routes 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let routes: readonly TurnTokenUsageRoute[] | undefined
  /**
   * 常量说明：attributed 用于处理 attributed 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：attempt（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(attempt)，并按返回类型处理结果。
   */
  const attributed = attempts.map(attempt => attempt.route)
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：route（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：route is
   * TurnTokenUsageRoute；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用
   * 匿名回调(route)，并按返回类型处理结果。
   */
  if (attributed.every((route): route is TurnTokenUsageRoute => route !== undefined)) {
    /**
     * 常量说明：unique 用于处理 unique 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const unique = new Map<string, TurnTokenUsageRoute>()
    /**
     * 变量说明：route 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const route of attributed) unique.set(`${route.provider}\0${route.model}`, route)
    routes = [...unique.values()]
  }

  return {
    uncachedInputTokens: inputTokens,
    outputTokens,
    totalTokens,
    ...cacheReadTokens === undefined ? {} : { cacheReadTokens },
    ...cacheWriteTokens === undefined ? {} : { cacheWriteTokens },
    ...reasoningTokens === undefined ? {} : { reasoningTokens },
    ...routes === undefined ? {} : { routes },
  }
}

/**
 * 功能说明：处理 sameAttempt 相关流程；使用场景由所在模块及调用位置决定。
 * @param state （Exclude<AttemptState, { kind: 'idle' }>）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。
 * @param turn （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param step （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns boolean；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 sameAttempt(state, turn, step)，并按返回类型处理结果。
 */
function sameAttempt(
  state: Exclude<AttemptState, { kind: 'idle' }>,
  turn: number,
  step: number,
): boolean {
  return state.turn === turn && state.step === step
}

/**
 * Fold one complete Turn's durable attempt lifecycle into exact token accounting.
 *
 * No attempt is inferred from a usage sample. Any missing lifecycle boundary,
 * incomplete attempt usage, unsafe count, or contradictory exact total makes
 * the whole disclosure unavailable.
 * @param events - Turn-local durable events from `turn/start` through `turn/end`.
 * @returns exact aggregate usage, or undefined when it cannot be proven.
 * @remarks 中文说明：功能说明：推导 Turn Token Usage 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：events（readonly SessionEvent[]）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；
 * 返回值：TurnTokenUsage | undefined；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 deriveTurnTokenUsage(events)，并按返回类型处理结果。
 */
export function deriveTurnTokenUsage(events: readonly SessionEvent[]): TurnTokenUsage | undefined {
  /**
   * 变量说明：state 用于处理 state 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let state: AttemptState = { kind: 'idle' }
  /**
   * 常量说明：attempts 用于处理 attempts 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const attempts: NormalizedAttempt[] = []
  /**
   * 变量说明：turn 用于处理 turn 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let turn: number | undefined
  /**
   * 变量说明：sawEnd 用于处理 sawEnd 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let sawEnd = false
  /**
   * 变量说明：invalid 用于处理 invalid 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let invalid = false

  /**
   * 常量说明：closeOpen 用于关闭 Open 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   * 功能说明：关闭 Open 相关流程；使用场景由所在模块及调用位置决定。
   * @param route （TurnTokenUsageRoute）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns boolean；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 closeOpen(route)，并按返回类型处理结果。
   */
  const closeOpen = (route?: TurnTokenUsageRoute): boolean => {
    if (state.kind !== 'open' || state.sample === undefined) return false
    /**
     * 常量说明：normalized 用于处理 normalized 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const normalized = normalizeUsage(state.sample, route)
    if (normalized === undefined) return false
    attempts.push(normalized)
    return true
  }

  /**
   * 变量说明：event 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (const event of events) {
    if (invalid) break
    if (event.type === 'turn/start') {
      if (turn !== undefined || state.kind !== 'idle') invalid = true
      else turn = event.data.turn
      continue
    }
    if (turn === undefined) {
      invalid = true
      break
    }
    if (event.type === 'turn/end') {
      if (event.data.turn !== turn || state.kind !== 'idle' || sawEnd) invalid = true
      else sawEnd = true
      continue
    }
    if (sawEnd) {
      invalid = true
      break
    }
    if (event.type === 'step/start') {
      if (event.data.turn !== turn || state.kind !== 'idle') invalid = true
      else state = { kind: 'open', turn, step: event.data.step }
      continue
    }
    if (event.type === 'llm/retry-started') {
      if (event.data.turn !== turn
        || state.kind !== 'settled'
        || state.by !== 'retry'
        || !sameAttempt(state, event.data.turn, event.data.step)) invalid = true
      else state = { kind: 'open', turn, step: event.data.step }
      continue
    }
    if (event.type === 'assistant/attempt') {
      if (event.data.turn !== turn
        || state.kind !== 'open'
        || !sameAttempt(state, event.data.turn, event.data.step)) {
        invalid = true
        continue
      }
      let sample: TokenUsage | undefined = state.sample
      for (const member of expandAssistantStream(event.data.stream)) {
        if (member.chunk.type === 'usage') sample = member.chunk.usage
      }
      state = { kind: 'open', turn, step: event.data.step, ...(sample === undefined ? {} : { sample }) }
      if (!closeOpen()) invalid = true
      else state = { kind: 'finishClosed', turn, step: event.data.step }
      continue
    }
    if (event.type === 'assistant/message') {
      if (event.data.turn !== turn
        || state.kind !== 'open'
        || !sameAttempt(state, event.data.turn, event.data.step)) {
        invalid = true
        continue
      }
      const sample = event.data.usage ?? streamUsage(event.data.stream)
      if (sample !== undefined) state = { ...state, sample }
      if (!closeOpen(messageRoute(event.data.message))) invalid = true
      else state = { kind: 'settled', turn, step: event.data.step, by: 'message' }
      continue
    }
    if (event.type === 'llm/retry') {
      if (event.data.turn !== turn || state.kind === 'idle'
        || !sameAttempt(state, event.data.turn, event.data.step)) {
        invalid = true
        continue
      }
      if (state.kind === 'settled' || (state.kind === 'open' && !closeOpen())) invalid = true
      if (!invalid) state = { kind: 'settled', turn, step: event.data.step, by: 'retry' }
      continue
    }
    if (event.type === 'step/end') {
      if (event.data.turn !== turn || state.kind === 'idle'
        || !sameAttempt(state, event.data.turn, event.data.step)) {
        invalid = true
        continue
      }
      if (state.kind === 'open' && !closeOpen()) invalid = true
      if (!invalid) state = { kind: 'idle' }
    }
  }

  return invalid || !sawEnd || state.kind !== 'idle' ? undefined : aggregateAttempts(attempts)
}
