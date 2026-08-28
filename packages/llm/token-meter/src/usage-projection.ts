/*
 * ================================ 文件注释 ================================
 * 【文件职责】实现两个纯投影单元：tokenUsage（跨整份日志累计 provider 报告
 * 用量）与 contextPressure（最近请求压力 + 最新已知路由容量的占用视图）。
 * 【技术维度】标准投影单元：zod 严格 schema 定义状态与视图；usage 折叠用
 * "单 last 槽"保存最近一次同 turn/step 的采样（同步骤重复采样替换旧值而非
 * 重复累计，依赖"同步骤用量报告相邻"的会话日志不变量）；pressure 用
 * foldSurfaceProjection 的 O(1) 表面总量 + 采样时刻快照推导 projectedTokens。
 * 【产品维度】用量统计页消费 tokenUsage；占用/压力展示消费 contextPressure；
 * projectedTokens 让展示对"下一次请求"作答，而不是停留在最后一次请求。
 * 【逻辑维度】桶辅助与 schema → tokenUsage 定义（含 last 槽去重）→
 * contextPressure 定义（压力/容量/表面/claim 四路更新 + 视图推导）。
 * 【关键边界】重复采样按"替换"处理；pressureTokens 只含提示侧；usage 采样
 * 在事件加入表面之前盖印，因此 assistant/message 锚定到它自己请求所见的表面。
 * 【新手阅读建议】先读 tokenUsage 的 apply（去重逻辑），再读 contextPressure
 * 的 apply 与 wire（projectedTokens 如何从三个量推导）。
 * ==========================================================================
 */

/**
 * Pure folds for durable provider-reported token usage and context occupancy.
 */

import { z } from 'zod'
import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-llm-retry/types'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { ContextPressureProjection, TokenUsageProjection } from './projection.ts'
import { foldSurfaceProjection } from './surface-projection.ts'

// 中文：四个零桶。
const zeroBuckets = (): TokenUsageProjection => ({
  uncachedInputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
})

// 中文：把 provider 用量转成四桶（缺失的缓存字段按 0 处理）。
const bucketsFrom = (usage: TokenUsage): TokenUsageProjection => ({
  uncachedInputTokens: usage.inputTokens,
  outputTokens: usage.outputTokens,
  cacheReadTokens: usage.cacheReadTokens ?? 0,
  cacheWriteTokens: usage.cacheWriteTokens ?? 0,
})

// 中文：四桶逐一相等比较。
const bucketsEqual = (left: TokenUsageProjection, right: TokenUsageProjection): boolean =>
  left.uncachedInputTokens === right.uncachedInputTokens
  && left.outputTokens === right.outputTokens
  && left.cacheReadTokens === right.cacheReadTokens
  && left.cacheWriteTokens === right.cacheWriteTokens

// 中文：替换式加法：总量减掉"被替换的旧采样"再加新采样（避免重复累计）。
const addReplacing = (
  totals: TokenUsageProjection,
  previous: TokenUsageProjection | undefined,
  next: TokenUsageProjection,
): TokenUsageProjection => ({
  uncachedInputTokens: totals.uncachedInputTokens - (previous?.uncachedInputTokens ?? 0) + next.uncachedInputTokens,
  outputTokens: totals.outputTokens - (previous?.outputTokens ?? 0) + next.outputTokens,
  cacheReadTokens: totals.cacheReadTokens - (previous?.cacheReadTokens ?? 0) + next.cacheReadTokens,
  cacheWriteTokens: totals.cacheWriteTokens - (previous?.cacheWriteTokens ?? 0) + next.cacheWriteTokens,
})

// 中文：四桶投影 schema（严格，未知键拒绝）。
const projectionSchema = z.object({
  uncachedInputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative(),
  cacheWriteTokens: z.number().int().nonnegative(),
}).strict()

/*
 * （中文）token-usage 单元的状态 schema——状态形状的唯一权威定义；状态类型
 * 由它推导。
 */
/**
 * The token-usage unit's state schema — the one definition of the state
 * shape; the state type is inferred from it.
 */
const tokenUsageStateSchema = z.object({
  totals: projectionSchema,
  last: z.object({
    turn: z.number().int().nonnegative(),
    step: z.number().int().nonnegative(),
    buckets: projectionSchema,
  }).nullable(),
}).strict()

type TokenUsageState = z.infer<typeof tokenUsageStateSchema>

// 中文：压力视图 schema（全部可选，转换后剥离 undefined 字段）。
const pressureSchema: z.ZodType<ContextPressureProjection> = z.object({
  pressureTokens: z.number().int().nonnegative().optional(),
  projectedTokens: z.number().int().nonnegative().optional(),
  contextWindow: z.number().int().positive().optional(),
}).strict().transform(({ pressureTokens, projectedTokens, contextWindow }) => ({
  ...pressureTokens === undefined ? {} : { pressureTokens },
  ...projectedTokens === undefined ? {} : { projectedTokens },
  ...contextWindow === undefined ? {} : { contextWindow },
}))

/** Prompt-side pressure of one request: input plus cache traffic, no output. */
// 中文：一次请求的提示侧压力：输入 + 缓存读写，不含输出。
const pressureFrom = (usage: TokenUsage): number =>
  usage.inputTokens + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0)

/** The usage a chunk or finalized message reports for its step, if any. */
// 中文：某块或已定稿消息为其步骤报告的用量（若有）：usage 块或带 usage 的
// assistant/message。
const usageOf = (event: SessionEvent): TokenUsage | undefined =>
  event.type === 'assistant/chunk' && event.data.chunk.type === 'usage'
    ? event.data.chunk.usage
    : event.type === 'assistant/message'
      ? event.data.usage
      : undefined

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    tokenUsage: TokenUsageState
    contextPressure: ContextPressureState
  }
}

/** The context-pressure state schema and source of its inferred type. */
// 中文：context-pressure 状态 schema（压力/容量/表面总量/采样时表面/claim）与
// 推导出的状态类型。
const contextPressureStateSchema = z.object({
  contextWindow: z.number().int().positive().optional(),
  pressureTokens: z.number().int().nonnegative().optional(),
  surfaceTokens: z.number().int().nonnegative(),
  sampledSurfaceTokens: z.number().int().nonnegative().optional(),
  claim: z.object({
    start: z.number().int().nonnegative(),
    end: z.number().int().nonnegative(),
    tokens: z.number().int().nonnegative(),
  }).optional(),
}).strict()

type ContextPressureState = z.infer<typeof contextPressureStateSchema>

/*
 * （中文）token-meter 的用量投影单元。
 * 用量块提供早期采样（可挺过随后的请求失败）；assistant/message 为同一
 * turn/step 提供最终采样。重复采样替换该步骤的旧值而非重复累计。单 last 槽
 * 依赖会话日志不变量：同一 turn/step 的用量报告相邻——一旦更晚的步骤开始，
 * 合法日志绝不会再为更早步骤报告用量。
 */
/**
 * Token-meter's session projection unit.
 *
 * Usage chunks provide an early sample that survives a later request failure;
 * an assistant message provides the final sample for the same attempt. A
 * repeated sample replaces that attempt's earlier value instead of double
 * counting it, while `llm/retry-started` closes the replacement slot so the
 * retried attempt adds to the total. The single `last` slot relies on the
 * session-log invariant that usage reports for one attempt are adjacent.
 */
export const tokenUsageProjectionDefinition = {
  key: 'tokenUsage',
  stateVersion: 2,
  stateSchema: tokenUsageStateSchema,
  init: () => ({ totals: zeroBuckets(), last: null }),
  apply: (state, event) => {
    if (event.type === 'llm/retry-started') {
      return state.last?.turn === event.data.turn && state.last.step === event.data.step
        ? { ...state, last: null }
        : state
    }
    let turn: number
    let step: number
    let usage: TokenUsage
    // 中文：只处理两类带用量的事件（usage 块 / 带 usage 的 assistant/message）。
    if (event.type === 'assistant/chunk' && event.data.chunk.type === 'usage') {
      ;({ turn, step } = event.data)
      usage = event.data.chunk.usage
    } else if (event.type === 'assistant/message' && event.data.usage !== undefined) {
      ;({ turn, step, usage } = event.data)
    } else {
      return state
    }

    const buckets = bucketsFrom(usage)
    // 中文：同 turn/step 的旧采样（若有）作为"被替换"基准；完全相同则无变化。
    const previous = state.last !== null
      && state.last.turn === turn
      && state.last.step === step
      ? state.last.buckets
      : undefined
    if (previous !== undefined && bucketsEqual(previous, buckets)) return state

    return {
      totals: addReplacing(state.totals, previous, buckets),
      last: { turn, step, buckets },
    }
  },
  wire: { viewSchema: projectionSchema, view: state => state.totals },
} satisfies ProjectionDefinition<'tokenUsage', TokenUsageState>

/*
 * （中文）token-meter 的上下文占用投影单元。
 * 独立的 last-wins 槽：最新用量采样提供 provider 分子，最新 request/context
 * 记录提供分母。两者都是完整值，因此结果只由回放顺序决定，不声明跨字段一致
 * 性——该配对明确不是同一次原子请求观测。
 * pressureTokens 只含提示侧，因此在某轮流式输出时保持不动，下一次请求报告
 * 用量时步进。因为只有请求会报告用量，它也看不见压缩：折叠因此随身携带运行
 * 表面总量并发布 projectedTokens——采样 + 采样后表面的有符号移动——让占用对
 * 下一次请求作答而非最后一次。总量走 foldSurfaceProjection，状态保持 O(1)，
 * 替换按日志影子价格收缩；无 claim 的替换保留先前总量。用量采样在事件加入
 * 表面之前盖印，因此 assistant/message 锚定到它自己请求所见的表面。
 */
/**
 * Token-meter's context-occupancy projection unit.
 *
 * Independent last-wins slots: the newest usage sample supplies the provider
 * numerator, the newest `request/context` record the denominator. Both are
 * whole values, so replay order alone decides the result and no cross-field
 * consistency is claimed — the pair is explicitly not one atomic request
 * observation (see {@link ContextPressureProjection}).
 *
 * `pressureTokens` is prompt-side only, so it holds still while a turn streams
 * and steps forward once the next request reports its usage. Because nothing
 * but a request reports usage, it also cannot see a compaction: the fold
 * therefore carries a running surface total alongside it and publishes
 * `projectedTokens` — the sample plus the surface's signed movement since it
 * was taken — so occupancy answers for the next request rather than the last
 * one. The total rides {@link foldSurfaceProjection}, so the state stays O(1)
 * and a replacement shrinks it by its logged shadow price. A replacement
 * without a claim preserves the previous total. A usage sample is stamped
 * BEFORE the same event joins the surface, so an `assistant/message` anchors
 * against the surface its own request saw.
 */
export const contextPressureProjectionDefinition = {
  key: 'contextPressure',
  stateVersion: 4,
  stateSchema: contextPressureStateSchema,
  init: () => ({ surfaceTokens: 0 }),
  apply: (state, event) => {
    // 中文：先做表面折叠（claim 管理与表面增量）。
    const fold = foldSurfaceProjection(state.claim, event)
    let next = state
    // 中文：request/context：last-wins 更新或移除上下文容量。
    if (event.type === 'request/context') {
      const contextWindow = event.data.contextWindow
      if (contextWindow !== state.contextWindow) {
        if (contextWindow !== undefined) {
          next = { ...next, contextWindow }
        } else {
          const { contextWindow: _removed, ...withoutContextWindow } = next
          next = withoutContextWindow
        }
      }
    }
    // 中文：用量采样：更新压力值并盖印"采样时的表面总量"（只在该步骤首次
    // 采样或压力变化时）。
    const usage = usageOf(event)
    if (usage !== undefined) {
      const pressureTokens = pressureFrom(usage)
      if (pressureTokens !== next.pressureTokens || next.sampledSurfaceTokens !== next.surfaceTokens) {
        next = { ...next, pressureTokens, sampledSurfaceTokens: next.surfaceTokens }
      }
    }
    // 中文：表面增量累加进总量。
    if (fold.deltaTokens !== 0) {
      next = { ...next, surfaceTokens: next.surfaceTokens + fold.deltaTokens }
    }
    // A defined fold.claim is always freshly built, so presence decides claim
    // bookkeeping: no claim before or after this event leaves `next` as is.
    // 中文：fold.claim 有定义时总是新构建的，因此按"是否存在"做 claim 记账：
    // 事件前后都无 claim 时直接返回 next。
    if (state.claim === undefined && fold.claim === undefined) return next
    const { claim: _expired, ...withoutClaim } = next
    return fold.claim === undefined ? withoutClaim : { ...withoutClaim, claim: fold.claim }
  },
  wire: {
    viewSchema: pressureSchema,
    view: ({ contextWindow, pressureTokens, surfaceTokens, sampledSurfaceTokens }) => ({
      ...contextWindow === undefined ? {} : { contextWindow },
      ...pressureTokens === undefined ? {} : { pressureTokens },
      // 中文：projectedTokens = 压力 + (当前表面 - 采样时表面)，截断到非负。
      ...pressureTokens === undefined || sampledSurfaceTokens === undefined
        ? {}
        : { projectedTokens: Math.max(0, pressureTokens + surfaceTokens - sampledSurfaceTokens) },
    }),
  },
} satisfies ProjectionDefinition<'contextPressure', ContextPressureState>
