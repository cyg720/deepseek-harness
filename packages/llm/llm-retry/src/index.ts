/**
 * Provider-routed model-request retry policy on the agent loop's request
 * recovery extension point. Each scheduled retry is durable before its cancellable wait.
 *
 * @module @deepseek-ai/dsh-llm-retry
 */

/*
 * ================================ 文件注释 ================================
 * 【文件职责】实现 dsh-llm-retry 插件：在 agent loop 的"请求失败恢复"扩展点
 * 上执行 provider 路由的模型请求重试策略（normal 有界 / always 无界）。
 * 【技术维度】监听 agent/request-error 瀑布流事件；每次调度的重试在可取消
 * 等待前先写入会话日志（持久化契约）；用 AbortSignal.any 融合请求信号与插件
 * 生命周期信号；normal 模式通过会话事件历史推断已有重试次数（崩溃/重启后可
 * 续跑），provider 的 Retry-After 优先于本地指数退避。
 * 【产品维度】瞬时限流/超时/服务器错误自动重试是 agent 稳定性的关键：配置了
 * 策略的 provider 失败后自动退避重试，用户无需手动重试。
 * 【逻辑维度】导出与配置 → 校验 → 内部类型与辅助（下游结算/退避/策略键/
 * 可取消延迟）→ apply（track/backoff/recover + 监听器 + 生命周期清理）。
 * 【关键边界】normal 模式只在失败码属于 retryableCodes 时重试；超过 maxRetries
 * 交给下游；always 模式忽略下游恢复失败并继续；插件销毁时中止所有活跃等待。
 * 【新手阅读建议】先读 recover 的分支逻辑（always/normal/不可重试码），再读
 * backoff 理解"先持久化调度记录再等待"的时序。
 * ==========================================================================
 */

import { randomUUID } from 'node:crypto'
import type { Context, Events } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { z as zod } from 'zod'
import type { Agent, RequestErrorAction } from '@deepseek-ai/dsh-agent'
import type { LlmFailure, ResolvedRetryPolicy } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-session-projection'
import { RetryId } from './brand.ts'
import type { LlmRetryEventData } from './types.ts'

export type { LlmRetryEventData, LlmRetryStartedEventData } from './types.ts'
export { RetryId } from './brand.ts'

export const name = 'llm-retry'
export const inject = ['agents', 'sessionProjections']

/** This policy executor has no config; providers own `retryPolicy`. */
export type Config = Readonly<Record<string, never>>

/** Runtime schema for {@link Config}. */
export const Config = z.object({}) as unknown as z<Config>

function validateConfig(config: Config): void {
  const [key] = Object.keys(config)
  if (key === undefined) return
  if (key === 'retryPolicy') {
    throw new Error('llm-retry: retryPolicy belongs under each provider configuration')
  }
  throw new Error(`llm-retry: unknown key "${key}"`)
}

/** Non-serializable hooks used to make timing policy deterministic in tests. */
export interface RetryInternals {
  /** Random sample in the inclusive zero-to-one range used for jitter. */
  random?: () => number
}

type DownstreamOutcome =
  | { readonly type: 'decision'; readonly decision: RequestErrorAction }
  | { readonly type: 'error'; readonly error: unknown }

async function settleDownstream(
  next: () => Promise<RequestErrorAction>,
): Promise<DownstreamOutcome> {
  try {
    return { type: 'decision', decision: await next() }
  } catch (error: unknown) {
    return { type: 'error', error }
  }
}

function localDelay(config: ResolvedRetryPolicy, retry: number, random: () => number): number {
  const exponent = Math.min(retry - 1, 1024)
  const exponential = Math.min(config.initialDelayMs * 2 ** exponent, config.maxDelayMs)
  const jitter = 1 - config.jitterRatio + 2 * config.jitterRatio * random()
  return Math.min(exponential * jitter, config.maxDelayMs)
}

function retryPolicyKey(policy: ResolvedRetryPolicy): string {
  return policy.mode === 'always'
    ? JSON.stringify([policy.mode, policy.initialDelayMs, policy.maxDelayMs, policy.jitterRatio])
    : JSON.stringify([
      policy.mode,
      policy.maxRetries,
      [...policy.retryableCodes].sort(),
      policy.initialDelayMs,
      policy.maxDelayMs,
      policy.jitterRatio,
    ])
}

function retryStateKey(provider: string, policyKey: string): string {
  return JSON.stringify([provider, policyKey])
}

function cancellableDelay(delayMs: number, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(false)
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve(true)
    }, delayMs)
    function onAbort(): void {
      clearTimeout(timer)
      resolve(false)
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * Install provider-routed normal or unbounded request recovery.
 * @param ctx - plugin context that owns the listener and active waits.
 * @param config - empty executor config; provider registrations own policy.
 * @param internals - non-serializable deterministic hooks for tests.
 */
interface RetryStateEntry {
  retry: number
  retryId: RetryId
}

type LlmRetryState = Record<string, RetryStateEntry>

// The cast bridges the branded retry id, which Zod cannot express directly.
const llmRetryStateSchema: zod.ZodType<LlmRetryState> = zod.record(zod.string(), zod.object({
  retry: zod.number().int().nonnegative(),
  retryId: zod.string(),
})) as unknown as zod.ZodType<LlmRetryState>
declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    /** Retry state for the current step by provider and policy. */
    llmRetry: LlmRetryState
  }
}

export function apply(ctx: Context, config: Config = {}, internals: RetryInternals = {}): void {
  validateConfig(config)
  ctx.sessionProjections.register({
    key: 'llmRetry',
    stateVersion: 1,
    stateSchema: llmRetryStateSchema,
    init: () => ({}),
    apply: (state, event) => {
      if (event.type === 'step/start' || event.type === 'turn/end') return {}
      if (event.type !== 'llm/retry') return state
      const key = retryStateKey(event.data.provider, event.data.policyKey)
      const entry = state[key]
      if (entry?.retry === event.data.retry && entry.retryId === event.data.retryId) return state
      return { ...state, [key]: { retry: event.data.retry, retryId: event.data.retryId } }
    },
  })
  const random = internals.random ?? Math.random
  const lifetime = new AbortController()
  const active = new Set<Promise<RequestErrorAction>>()

  function track(operation: Promise<RequestErrorAction>): Promise<RequestErrorAction> {
    const tracked = operation.finally(() => active.delete(tracked))
    active.add(tracked)
    return tracked
  }

  async function backoff(
    agent: Agent,
    turn: number,
    step: number,
    failure: LlmFailure,
    provider: string,
    policy: ResolvedRetryPolicy,
    policyKey: string,
    retry: number,
    retryId: RetryId,
    delayMs: number,
    signal: AbortSignal,
  ): Promise<RequestErrorAction> {
    const fusedSignal = AbortSignal.any([signal, lifetime.signal])
    if (fusedSignal.aborted) return
    const eventData: LlmRetryEventData = policy.mode === 'normal'
      ? {
        retryId,
        turn,
        step,
        provider,
        mode: policy.mode,
        policyKey,
        retry,
        maxRetries: policy.maxRetries,
        delayMs,
        failure,
      }
      : {
        retryId,
        turn,
        step,
        provider,
        mode: policy.mode,
        policyKey,
        retry,
        delayMs,
        failure,
      }
    agent.session.append('llm/retry', eventData)
    if (!await cancellableDelay(delayMs, fusedSignal)) return
    agent.session.append('llm/retry-started', { retryId, turn, step, retry })
    return { kind: 'retry' }
  }

  async function recover(
    { agent, turn, step, provider, failure, retryPolicy: policy, signal }: Parameters<Events['agent/request-error']>[0],
    next: () => Promise<RequestErrorAction>,
  ): Promise<RequestErrorAction> {
    if (policy === undefined) return next()
    if (policy.mode === 'always') {
      if (signal.aborted || lifetime.signal.aborted) return
      const fusedSignal = AbortSignal.any([signal, lifetime.signal])
      // The loop and plugin lifetime stay open until delegated recovery settles.
      // An abort then wins before the decision or fallback can mutate later state.
      const downstream = await settleDownstream(next)
      if (fusedSignal.aborted) return
      if (downstream.type === 'error') {
        ctx.logger.warn(
          `llm-retry: provider "${provider}" always policy ignored a downstream recovery failure: %o`,
          downstream.error,
        )
      }
      if (downstream.type === 'decision' && downstream.decision?.kind === 'retry') {
        return downstream.decision
      }
    } else if (!policy.retryableCodes.includes(failure.code)) {
      return next()
    }

    const policyKey = retryPolicyKey(policy)
    const retryState = ctx.sessionProjections.stateOf(agent.session, 'llmRetry') as LlmRetryState
    const previous = retryState[retryStateKey(provider, policyKey)]
    const previousRetry = previous?.retry ?? 0
    if (policy.mode === 'normal' && previousRetry >= policy.maxRetries) return next()
    const retry = previousRetry + 1
    const retryId = previous?.retryId ?? RetryId(randomUUID())
    let delayMs: number
    if (failure.providerRetryAfterMs !== undefined
      && Number.isFinite(failure.providerRetryAfterMs)
      && failure.providerRetryAfterMs > 0) {
      if (failure.providerRetryAfterMs > policy.maxDelayMs) {
        if (policy.mode === 'normal') return next()
        delayMs = localDelay(policy, retry, random)
      } else {
        delayMs = failure.providerRetryAfterMs
      }
    } else {
      delayMs = localDelay(policy, retry, random)
    }

    return backoff(agent, turn, step, failure, provider, policy, policyKey, retry, retryId, delayMs, signal)
  }

  const disposeListener = ctx.on('agent/request-error', (
    payload,
    next: () => Promise<RequestErrorAction>,
  ) => {
    // A waterfall may have captured this callback before its registration was
    // removed. Lifetime cancellation must prevent that stale callback from
    // entering a downstream policy after disposal.
    if (lifetime.signal.aborted) return Promise.resolve<RequestErrorAction>(undefined)
    return track(recover(payload, next))
  })

  ctx.effect(() => async () => {
    disposeListener()
    lifetime.abort(new Error('llm-retry plugin disposed'))
    await Promise.allSettled([...active])
  }, 'llm-retry: abort and drain active recovery')
}
