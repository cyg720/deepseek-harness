/**
 * ================================ 文件注释 ================================
 * 【文件职责】定义并解析"provider 自有的请求重试策略"：提供配置类型、Cordis
 * schema、以及把配置校验/补默认/冻结成不可变策略的 resolveRetryPolicy。
 * 【技术维度】配置层用 schemastery 定义 schema 供 cordis.yml 嵌入；运行时
 * 解析器手工校验（key 白名单、数值范围、去重）并用 Object.freeze 冻结，产出
 * 可在注册时安全捕获的不可变策略。可选的重试执行由 dsh-llm-retry 插件负责。
 * 【产品维度】不同 provider 的故障特征不同（有的限流需要退避、有的错误不可
 * 重试），允许按 provider 配置重试策略能显著提升调用成功率与稳定性体验。
 * 【逻辑维度】默认值常量 → 配置类型（normal/always 两种模式）→ 解析结果
 * 类型 → schema → key 白名单 → 校验辅助 → resolveBackoff → resolveRetryPolicy。
 * 【关键边界】backoff 延迟上限受 MAX_TIMER_DELAY_MS 约束；retryableCodes 不
 * 能为空、不能重复；切换模式后残留的 normal 字段被静默忽略但仍拒绝未知 key。
 * 【新手阅读建议】先看三种配置接口与解析结果类型，再读 resolveRetryPolicy
 * 的两个 case 分支，理解配置到不可变策略的转换。
 * ==========================================================================
 */

/**
 * Provider-owned request-retry policy configuration and resolution.
 *
 * Adapters expose one resolved policy per registered provider route; the
 * optional dsh-llm-retry plugin executes it on the agent's failed-step extension point.
 *
 * @module @deepseek-ai/dsh-llm/retry-policy
 */

import z from '@deepseek-ai/schemastery'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import { EMPTY_RESPONSE_CODE } from './error.ts'

// 中文：默认最大重试次数：首次请求之后的额外尝试最多 5 次。
const DEFAULT_MAX_RETRIES = 5
// 中文：默认初始退避延迟 500 毫秒。
const DEFAULT_INITIAL_DELAY_MS = 500
// 中文：默认最大退避延迟 10 秒（超过此值需在配置中显式放开）。
const DEFAULT_MAX_DELAY_MS = 10_000
// 中文：默认抖动比例 0.1：每次延迟在计算值 ±10% 范围内随机浮动，避免
// 大量客户端同时重试造成"惊群"。
const DEFAULT_JITTER_RATIO = 0.1
// 中文：默认可重试的失败码集合：空响应、限流、服务器错误、超时、传输层错误；
// 冻结为只读数组。
const DEFAULT_RETRYABLE_CODES = Object.freeze([
  EMPTY_RESPONSE_CODE,
  'RATE_LIMIT',
  'SERVER',
  'TIMEOUT',
  'TRANSPORT',
])

/** Bounded exponential backoff with symmetric jitter around each local delay. */
/*
 * （中文）有上限的指数退避配置：每次重试间隔按指数增长，但封顶在 maxDelayMs；
 * 每次实际延迟在计算值周围做对称随机抖动。
 */
export interface BackoffConfig {
  /** Initial local exponential-backoff delay in milliseconds (default 500). */
  // 中文：指数退避的初始延迟毫秒数（默认 500）。
  initialDelayMs?: number
  /** Maximum locally scheduled or accepted provider delay in milliseconds (default 10000). */
  // 中文：本地调度或接受的 provider 延迟上限毫秒数（默认 10000）。
  maxDelayMs?: number
  /** Symmetric random multiplier range around one (default 0.1). */
  // 中文：围绕 1 的对称随机乘数范围（默认 0.1）。
  jitterRatio?: number
}

/** Current bounded transient retry behavior for one provider route. */
/*
 * （中文）normal 模式：只对配置的可重试失败码做有上限的重试（默认 5 次）。
 */
export interface NormalRetryPolicyConfig {
  /** Retry only configured transient failure codes. */
  // 中文：模式标记，只重试配置的瞬时失败码。
  mode: 'normal'
  /** Maximum eligible retries after the first request (default 5). */
  // 中文：首次请求之后最多允许的重试次数（默认 5）。
  maxRetries?: number
  /** Stable failure codes eligible for this policy. */
  // 中文：本策略可重试的稳定失败码清单。
  retryableCodes?: string[]
  /** Local exponential-backoff and jitter configuration. */
  // 中文：本地指数退避与抖动配置。
  backoff?: BackoffConfig
}

/** Unbounded retry behavior for every model-request failure on one provider route. */
/*
 * （中文）always 模式：对该 provider 路由上的每次模型请求失败都重试，直到
 * 成功、取消或插件被销毁。
 */
export interface AlwaysRetryPolicyConfig {
  /** Retry every model-request failure until success, cancellation, or disposal. */
  // 中文：模式标记，重试一切失败直到成功/取消/销毁。
  mode: 'always'
  /** Local exponential-backoff and jitter configuration. */
  // 中文：本地指数退避与抖动配置。
  backoff?: BackoffConfig
}

/** Provider-owned model-request retry policy configuration. */
/*
 * （中文）两种模式的并集：normal（有界瞬时重试）或 always（无界全重试）。
 */
export type RetryPolicyConfig = NormalRetryPolicyConfig | AlwaysRetryPolicyConfig

/** Fully resolved backoff shared by both retry modes. */
/*
 * （中文）两种模式共享的、完全解析后的退避参数（已补默认并冻结）。
 */
export interface ResolvedRetryBackoff {
  readonly initialDelayMs: number
  readonly maxDelayMs: number
  readonly jitterRatio: number
}

/** Fully resolved bounded transient retry policy. */
/*
 * （中文）完全解析后的 normal 策略：模式、最大重试次数、可重试码、退避参数
 * 都已确定并只读。
 */
export interface ResolvedNormalRetryPolicy extends ResolvedRetryBackoff {
  readonly mode: 'normal'
  readonly maxRetries: number
  readonly retryableCodes: readonly string[]
}

/** Fully resolved unbounded retry policy. */
/*
 * （中文）完全解析后的 always 策略：模式 + 退避参数，全部只读。
 */
export interface ResolvedAlwaysRetryPolicy extends ResolvedRetryBackoff {
  readonly mode: 'always'
}

/** Immutable provider policy captured when its adapter route is registered. */
/*
 * （中文）注册适配器路由时捕获的不可变策略类型，两种模式取其一。
 */
export type ResolvedRetryPolicy = ResolvedNormalRetryPolicy | ResolvedAlwaysRetryPolicy

// 中文：退避配置的 schemastery schema：三个字段都限定了范围并带默认值。
const backoffSchema: z<BackoffConfig> = z.object({
  initialDelayMs: z.number().max(MAX_TIMER_DELAY_MS).default(DEFAULT_INITIAL_DELAY_MS),
  maxDelayMs: z.number().max(MAX_TIMER_DELAY_MS).default(DEFAULT_MAX_DELAY_MS),
  jitterRatio: z.number().min(0).max(1).default(DEFAULT_JITTER_RATIO),
})

// 中文：normal 策略 schema：mode 必填且只能是 'normal'，其余字段带默认值。
const normalPolicySchema: z<NormalRetryPolicyConfig> = z.object({
  mode: z.const('normal').required(),
  maxRetries: z.number().step(1).min(0).max(Number.MAX_SAFE_INTEGER).default(DEFAULT_MAX_RETRIES),
  retryableCodes: z.array(z.string()).default([...DEFAULT_RETRYABLE_CODES]),
  backoff: backoffSchema,
})

// 中文：always 策略 schema：只有 mode 与 backoff 两个字段。
const alwaysPolicySchema: z<AlwaysRetryPolicyConfig> = z.object({
  mode: z.const('always').required(),
  backoff: backoffSchema,
})

/** Cordis schema embedded by each concrete provider configuration. */
// 中文：对外暴露的联合 schema：normal/always 二选一，供各具体 provider 的
// 配置定义嵌入使用。
export const RetryPolicySchema: z<RetryPolicyConfig> = z.union([
  normalPolicySchema,
  alwaysPolicySchema,
])

// 中文：normal 模式允许出现的配置 key 白名单。
const NORMAL_POLICY_KEYS: ReadonlySet<string> = new Set([
  'mode', 'maxRetries', 'retryableCodes', 'backoff',
])
// Layered configuration can retain normal-only fields after switching modes;
// always mode ignores those inactive values while still rejecting unknown keys.
// 中文：分层配置在切换模式后可能残留 normal 专属字段；always 模式忽略这些
// 失效值，但仍拒绝未知 key（白名单保持一致以放行残留字段）。
const ALWAYS_POLICY_KEYS: ReadonlySet<string> = new Set([
  'mode', 'maxRetries', 'retryableCodes', 'backoff',
])
const BACKOFF_KEYS: ReadonlySet<string> = new Set(['initialDelayMs', 'maxDelayMs', 'jitterRatio'])

// 中文：校验一个配置对象只含白名单内的 key，否则抛错（fail loud）。
function validateKeys(value: object, allowed: ReadonlySet<string>, path: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`${path}: unknown key "${key}"`)
  }
}

// 中文：把退避配置补默认并做范围校验（正数、有限、不超上限、initial <= max、
// 抖动在 0~1），返回冻结的解析结果。
function resolveBackoff(config: BackoffConfig | undefined, path: string): ResolvedRetryBackoff {
  if (config !== undefined) validateKeys(config, BACKOFF_KEYS, path)
  const initialDelayMs = config?.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS
  const maxDelayMs = config?.maxDelayMs ?? DEFAULT_MAX_DELAY_MS
  const jitterRatio = config?.jitterRatio ?? DEFAULT_JITTER_RATIO

  if (!Number.isFinite(initialDelayMs) || initialDelayMs <= 0 || initialDelayMs > MAX_TIMER_DELAY_MS) {
    throw new Error(`${path}.initialDelayMs must be a positive finite number no greater than ${MAX_TIMER_DELAY_MS}`)
  }
  if (!Number.isFinite(maxDelayMs) || maxDelayMs <= 0 || maxDelayMs > MAX_TIMER_DELAY_MS) {
    throw new Error(`${path}.maxDelayMs must be a positive finite number no greater than ${MAX_TIMER_DELAY_MS}`)
  }
  if (initialDelayMs > maxDelayMs) {
    throw new Error(`${path}.initialDelayMs must be less than or equal to maxDelayMs`)
  }
  if (!Number.isFinite(jitterRatio) || jitterRatio < 0 || jitterRatio > 1) {
    throw new Error(`${path}.jitterRatio must be between 0 and 1`)
  }

  return Object.freeze({ initialDelayMs, maxDelayMs, jitterRatio })
}

/**
 * （中文）校验、补默认并"剥离"（detach）一份 provider 自有的重试策略：省略
 * 配置时返回 normal 默认值；否则按模式分支校验字段并冻结。结果不可变，可被
 * provider 注册状态安全捕获。
 * @param config 可选的 provider 配置；省略时使用 normal 默认值。
 * @param path 诊断路径，用于在报错信息里点名持有该值的 provider 配置。
 * @returns 不可变策略，适合捕获进 provider 注册状态。
 */
/**
 * Validate, default, and detach one provider-owned retry policy.
 * @param config - optional provider configuration; omission selects normal defaults.
 * @param path - diagnostic path naming the provider config that owns the value.
 * @returns an immutable policy safe to capture in provider registration state.
 */
export function resolveRetryPolicy(
  config: RetryPolicyConfig | undefined,
  path: string,
): ResolvedRetryPolicy {
  if (config === undefined) {
    return Object.freeze({
      mode: 'normal',
      maxRetries: DEFAULT_MAX_RETRIES,
      retryableCodes: DEFAULT_RETRYABLE_CODES,
      ...resolveBackoff(undefined, `${path}.backoff`),
    })
  }

  switch (config.mode) {
    case 'normal': {
      validateKeys(config, NORMAL_POLICY_KEYS, path)
      const maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES
      const retryableCodes = config.retryableCodes ?? [...DEFAULT_RETRYABLE_CODES]
      if (!Number.isSafeInteger(maxRetries) || maxRetries < 0) {
        throw new Error(`${path}.maxRetries must be a non-negative safe integer`)
      }
      if (retryableCodes.length === 0) {
        throw new Error(`${path}.retryableCodes must not be empty`)
      }
      if (retryableCodes.some(code => typeof code !== 'string' || code.length === 0)) {
        throw new Error(`${path}.retryableCodes must contain only non-empty strings`)
      }
      if (new Set(retryableCodes).size !== retryableCodes.length) {
        throw new Error(`${path}.retryableCodes must not contain duplicates`)
      }
      return Object.freeze({
        mode: 'normal',
        maxRetries,
        retryableCodes: Object.freeze([...retryableCodes]),
        ...resolveBackoff(config.backoff, `${path}.backoff`),
      })
    }
    case 'always':
      validateKeys(config, ALWAYS_POLICY_KEYS, path)
      return Object.freeze({
        mode: 'always',
        ...resolveBackoff(config.backoff, `${path}.backoff`),
      })
    default:
      throw new Error(`${path}.mode must be "normal" or "always"`)
  }
}
