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

/**
 * Provider-routed model-request retry policy on the agent loop's request
 * recovery extension point. Each scheduled retry is durable before its cancellable wait.
 *
 * @module @deepseek-ai/dsh-llm-retry
 */

import { randomUUID } from 'node:crypto'
import type { Context, Events } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent, RequestErrorAction } from '@deepseek-ai/dsh-agent'
import type { LlmFailure, ResolvedRetryPolicy } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { RetryId } from './brand.ts'
import type { LlmRetryEventData } from './types.ts'

export type { LlmRetryEventData, LlmRetryStartedEventData } from './types.ts'
export { RetryId } from './brand.ts'

// 中文：插件名与依赖声明。
export const name = 'llm-retry'
export const inject = ['agents']

/** This policy executor has no config; providers own `retryPolicy`. */
// 中文：本策略执行器没有配置；重试策略由各 provider 配置（retryPolicy）。
export type Config = Readonly<Record<string, never>>

/** Runtime schema for {@link Config}. */
// 中文：Config 的运行时 schema（空对象）。
export const Config = z.object({}) as unknown as z<Config>

// 中文：配置校验：拒绝任何未知 key，并专门提示 retryPolicy 应放在 provider 下。
function validateConfig(config: Config): void {
  const [key] = Object.keys(config)
  if (key === undefined) return
  if (key === 'retryPolicy') {
    throw new Error('llm-retry: retryPolicy belongs under each provider configuration')
  }
  throw new Error(`llm-retry: unknown key "${key}"`)
}

/** Non-serializable hooks used to make timing policy deterministic in tests. */
/*
 * （中文）不可序列化的钩子，用于让测试里的时间策略确定化。
 */
export interface RetryInternals {
  /** Random sample in the inclusive zero-to-one range used for jitter. */
  // 中文：用于抖动的随机采样（0 到 1 闭区间）。
  random?: () => number
}

// 中文：下游（更内层的瀑布流监听器）结算结果：返回决策或抛错。
type DownstreamOutcome =
  | { readonly type: 'decision'; readonly decision: RequestErrorAction }
  | { readonly type: 'error'; readonly error: unknown }

// 中文：调用下游 next() 并捕获其抛错，统一成可检查的结果。
async function settleDownstream(
  next: () => Promise<RequestErrorAction>,
): Promise<DownstreamOutcome> {
  try {
    return { type: 'decision', decision: await next() }
  } catch (error: unknown) {
    return { type: 'error', error }
  }
}

// 中文：计算本地退避延迟：指数上限封顶到 maxDelayMs，抖动乘数在
// (1-ratio, 1+ratio) 范围内随机，结果再封顶一次。
function localDelay(config: ResolvedRetryPolicy, retry: number, random: () => number): number {
  const exponent = Math.min(retry - 1, 1024)
  const exponential = Math.min(config.initialDelayMs * 2 ** exponent, config.maxDelayMs)
  const jitter = 1 - config.jitterRatio + 2 * config.jitterRatio * random()
  return Math.min(exponential * jitter, config.maxDelayMs)
}

// 中文：把已解析策略转成稳定键：策略内容变化（如设置变更）即视为新策略链
// （normal 的 retryableCodes 排序后参与比较）。
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

// 中文：可取消的延迟：定时器到点返回 true；信号先 abort 则清定时器返回 false。
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

/*
 * （中文）安装 provider 路由的 normal 或无界请求恢复。
 * @param ctx 拥有监听器与活跃等待的插件上下文。
 * @param config 空的执行器配置；策略由 provider 注册持有。
 * @param internals 供测试使用的不可序列化确定性钩子。
 */
/**
 * Install provider-routed normal or unbounded request recovery.
 * @param ctx - plugin context that owns the listener and active waits.
 * @param config - empty executor config; provider registrations own policy.
 * @param internals - non-serializable deterministic hooks for tests.
 */
export function apply(ctx: Context, config: Config = {}, internals: RetryInternals = {}): void {
  validateConfig(config)
  // 中文：随机源（可注入）；插件生命周期控制器；活跃恢复操作集合。
  const random = internals.random ?? Math.random
  const lifetime = new AbortController()
  const active = new Set<Promise<RequestErrorAction>>()

  // 中文：登记活跃操作，结算后自动移出集合（供销毁时排空等待）。
  function track(operation: Promise<RequestErrorAction>): Promise<RequestErrorAction> {
    const tracked = operation.finally(() => active.delete(tracked))
    active.add(tracked)
    return tracked
  }

  // 中文：退避：先写持久调度记录（llm/retry），再做可取消等待，等待成功后写
  // llm/retry-started 并返回 {kind:'retry'} 让 loop 重试。
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
    // 中文：按模式组装持久负载（always 不带 maxRetries）。
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
    // 中文：契约：调度先持久化，再进入可取消等待。
    agent.session.append('llm/retry', eventData)
    if (!await cancellableDelay(delayMs, fusedSignal)) return
    agent.session.append('llm/retry-started', { retryId, turn, step, retry })
    return { kind: 'retry' }
  }

  // 中文：核心恢复逻辑：无策略或不可重试码 → 交还下游；always 模式先问下游
  // 是否已给 retry 决策（下游失败仅警告）；normal 模式从会话历史推断已重试
  // 次数并决定是否再试。
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
      // 中文：loop 与插件生命周期保持打开，直到委派的下游恢复结算；此后的
      // 中止会在决策/回退改写后续状态之前胜出。
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
    // 中文：从会话历史找同 turn/step/provider/策略键的最后一条调度记录，推断
    // 已重试次数；崩溃重启后可续跑同一策略链。
    const priorPolicyRetry = agent.session.events.findLast((event): event is SessionEvent<'llm/retry'> =>
      event.type === 'llm/retry'
      && event.data.turn === turn
      && event.data.step === step
      && event.data.provider === provider
      && event.data.policyKey === policyKey,
    )
    const previousRetry = priorPolicyRetry?.data.retry ?? 0
    // 中文：normal 模式已达上限 → 交还下游处理。
    if (policy.mode === 'normal' && previousRetry >= policy.maxRetries) return next()
    const retry = previousRetry + 1
    // 中文：续用既有链的 retryId；新链铸造新 id。
    const retryId = priorPolicyRetry?.data.retryId ?? RetryId(randomUUID())
    // 中文：延迟选择：provider Retry-After 有效且不超本地上限时优先采用；
    // 超限时 normal 模式放弃（交还下游）、always 模式退回本地退避；否则本地退避。
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

  // 中文：挂接瀑布流监听器：插件已销毁时，被过早捕获的陈旧回调不得再进入
  // 下游策略。
  const disposeListener = ctx.on('agent/request-error', (
    payload,
    next: () => Promise<RequestErrorAction>,
  ) => {
    // A waterfall may have captured this callback before its registration was
    // removed. Lifetime cancellation must prevent that stale callback from
    // entering a downstream policy after disposal.
    // 中文：瀑布流可能在注册被移除前就捕获了这个回调；生命周期取消必须阻止
    // 这个陈旧回调在销毁后进入下游策略。
    if (lifetime.signal.aborted) return Promise.resolve<RequestErrorAction>(undefined)
    return track(recover(payload, next))
  })

  // 中文：生命周期清理：移除监听器、中止全部活跃等待、等其结算完毕。
  ctx.effect(() => async () => {
    disposeListener()
    lifetime.abort(new Error('llm-retry plugin disposed'))
    await Promise.allSettled([...active])
  }, 'llm-retry: abort and drain active recovery')
}
