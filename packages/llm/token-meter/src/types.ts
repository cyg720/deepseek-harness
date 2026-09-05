

/**
 * Public configuration and measurement vocabulary for replay token metering.
 *
 * @module @deepseek-ai/dsh-token-meter/types
 */

/*
 * 【文件职责】声明可回放 token 计量的配置和测量结果，固定估算算法不额外暴露设置。
 */

import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import type { SessionLogOffset, SessionSeq } from '@deepseek-ai/dsh-session/types'

export type { ContextBreakdownProjection, ContextPressureProjection, TokenUsageProjection } from './projection.ts'

/** Token-meter plugin configuration; the fixed estimator has no settings. */
// 中文：token-meter 插件配置；固定估计器没有任何设置项（空对象）。
export type TokenMeterConfig = Record<string, never>

/** The baseline from which a signed surface delta produces current pressure. */
/*
 * （中文）"有符号表面增量"据以产生当前压力的基线锚点：none（还没有任何
 * 内容）、estimated（启发式估价）、usage（provider 实测用量）。
 */
export type TokenMeasurementBaseline =
  | { readonly kind: 'none'; readonly tokens: 0 }
  | { readonly kind: 'estimated'; readonly tokens: number }
  | { readonly kind: 'usage'; readonly tokens: number; readonly usage: Readonly<TokenUsage> }

/** Detached immutable request-pressure and surface snapshot at one consumed log revision. */
/*
 * （中文）在某个已消费日志修订号上的剥离、不可变请求压力与表面快照。
 */
export interface TokenMeasurement {
  /** Number of durable events consumed; equal to the next unread event seq. */
  readonly logRevision: SessionLogOffset
  /** Provider or heuristic anchor used for this measurement. */
  // 中文：本次测量使用的 provider 或启发式锚点。
  readonly baseline: TokenMeasurementBaseline
  /** Signed repricing of current surface content relative to the baseline anchor. */
  // 中文：当前表面内容相对基线锚点的有符号重定价。
  readonly surfaceDeltaTokens: number
  /** Non-negative current request-and-response pressure. */
  // 中文：非负的当前请求+响应压力。
  readonly totalTokens: number
  /** Total route-priced request tokens across the current surface; equals the sum of the node prices. */
  readonly surfaceTokens: number
  /** Current surface nodes in positional head-to-tail order. */
  // 中文：当前表面节点，按位置从头到尾排列。
  readonly nodes: readonly TokenSurfaceNode[]
}

/** One token-priced node in the current ordered session surface. */
/*
 * （中文）当前有序会话表面里的一个已定价节点。
 */
export interface TokenSurfaceNode {
  /** Durable sequence number of the surface event. */
  readonly seq: SessionSeq
  /**
   * Request-pressure tokens for the exact message projected by this node under
   * the measured route: image occurrences carry the route's declared visual
   * price when the routed adapter declares one, and the fixed heuristic
   * otherwise. Trigger, retention, and range selection all read this price.
   */
  readonly tokens: number
  /**
   * Fixed-heuristic tokens for the same message, independent of any route.
   * The shadow-price protocol prices replacements with this value so the O(1)
   * projection fold stays in agreement with its own appends.
   */
  readonly heuristicTokens: number
}
