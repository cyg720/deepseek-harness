/*
 * ================================ 文件注释 ================================
 * 【文件职责】定义 token-meter 的公共配置与测量词汇：配置类型、测量基线、
 * 测量快照（TokenMeasurement）与表面节点（TokenSurfaceNode）。
 * 【技术维度】TokenMeasurement 是从"一次消费到的日志修订号"上的请求压力 +
 * 表面快照（深冻结、剥离副本）；基线（baseline）区分三种来源：无（none）、
 * 启发式估计（estimated）、provider 实测用量（usage）。
 * 【产品维度】上层（agent loop、UI）调用 tokenMeter.measure() 获得"当前请求
 * 会花多少钱、当前表面有多少"的只读快照，用于上下文预算与占用展示。
 * 【逻辑维度】投影类型再导出 → 配置 → 基线 → 测量快照 → 表面节点。
 * 【关键边界】logRevision 等于"下一个未读事件 seq"；totalTokens 非负；
 * surfaceDeltaTokens 是相对基线锚点的有符号重定价。
 * 【新手阅读建议】先读 TokenMeasurement 各字段，再对照 index.ts 的 measure()
 * 理解字段如何产生。
 * ==========================================================================
 */

/**
 * Public configuration and measurement vocabulary for replay token metering.
 *
 * @module @deepseek-ai/dsh-token-meter/types
 */

import type { TokenUsage } from '@deepseek-ai/dsh-llm'

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
  // 中文：已消费的持久事件数；等于下一个未读事件 seq。
  readonly logRevision: number
  /** Provider or heuristic anchor used for this measurement. */
  // 中文：本次测量使用的 provider 或启发式锚点。
  readonly baseline: TokenMeasurementBaseline
  /** Signed repricing of current surface content relative to the baseline anchor. */
  // 中文：当前表面内容相对基线锚点的有符号重定价。
  readonly surfaceDeltaTokens: number
  /** Non-negative current request-and-response pressure. */
  // 中文：非负的当前请求+响应压力。
  readonly totalTokens: number
  /** Total heuristic tokens across the current surface. */
  // 中文：当前表面总启发式 token 数。
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
  // 中文：表面事件的持久序号。
  readonly seq: number
  /** Heuristic tokens for the exact message projected by this node. */
  // 中文：该节点投影的精确消息的启发式 token 数。
  readonly tokens: number
}
