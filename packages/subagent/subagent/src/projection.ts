/**
 * ================================ 文件注释 ================================
 * 【文件职责】子代理身份（模式/标签）与进行中回合耗时的纯会话投影实现：把会话事件流
 *   折叠成持久可查的摘要值，注册进 session-projection 注册表。
 * 【技术维度】Zod 定义状态与视图 schema；每个投影定义（ProjectionDefinition）包含
 *   init/apply/wire/stateVersion；描述符事件到达时重置累计状态（fork seed 可能回放
 *   祖先描述符，最后一次重置才是子代理自己的权威计时原点）。
 * 【产品维度】枚举子代理（mode/label）与展示回合耗时都直接读投影值，无需重放整个日志；
 *   损坏/未知版本的描述符折叠为 null/undefined 而不抛错，保证投影永不破坏查询。
 * 【逻辑维度】按代码顺序：TimingState → 三个 schema → 声明合并 → subagentTimingProjectionDefinition
 *   → IdentityState → identity schema → descriptorIdentity → subagentIdentityProjectionDefinition。
 * 【关键边界】投影 fold 绝不抛错（损坏数据折成无值）；stateVersion 升级意味着旧检查点
 *   行必须重新折叠。
 * 【新手阅读建议】对照两个 ProjectionDefinition 的 apply 分支理解折叠规则；投影词汇见
 *   projection-types.ts。
 * ==========================================================================
 */

/**
 * Pure session projections for subagent identity (mode/label) and active-turn
 * duration.
 *
 * @module @deepseek-ai/dsh-subagent/projection
 */

import { z } from 'zod'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { foldSubagentDescriptor } from './descriptor.ts'
import type { SubagentDescriptorData } from './descriptor.ts'
import type { SubagentIdentityProjection, SubagentTimingProjection } from './projection-types.ts'

/** Fold state for a subagent's latest timing snapshot. */
// 中文：timing 投影的折叠中间态：settledMs 累计已完成回合耗时，active 是当前开着的
// 时间窗，pendingTurnStart 是描述符出现前最近的回合起点（描述符到达时被提升），
// descriptorSeen 标记是否已跨过子代理自己的描述符。
export interface TimingState {
  /** Milliseconds accumulated across completed post-descriptor turns. */
  settledMs: number
  /** Current open interval kept paired inside the fold. */
  active?: { since: number; through: number } | undefined
  /** Latest pre-descriptor turn start, promoted when the child's own descriptor arrives. */
  pendingTurnStart?: number | undefined
  /** Whether the fold has crossed a descriptor in this logical log. */
  descriptorSeen: boolean
}

// 中文：时间窗的 zod 校验：两个非负整数时间戳，strict 拒绝多余字段。
const activeIntervalSchema = z.object({
  since: z.number().int().nonnegative(),
  through: z.number().int().nonnegative(),
}).strict()

const projectionSchema: z.ZodType<SubagentTimingProjection> = z.object({
  settledMs: z.number().int().nonnegative(),
  active: activeIntervalSchema.optional(),
}).strict().transform(({ settledMs, active }) => ({
  settledMs,
  ...active === undefined ? {} : { active },
}))

const timingStateSchema: z.ZodType<TimingState> = z.object({
  settledMs: z.number().int().nonnegative(),
  active: activeIntervalSchema.optional(),
  pendingTurnStart: z.number().int().nonnegative().optional(),
  descriptorSeen: z.boolean(),
}).strict()

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    subagentTiming: TimingState
    subagent: IdentityState
  }
}

/**
 * Fold turn boundaries around the child's own durable descriptor.
 *
 * A fork seed may contain an ancestor descriptor and completed turns. Every
 * descriptor therefore resets the accumulated state; the healthy catalog
 * admits only a child with exactly one descriptor in its own suffix, making
 * the final reset the child's authoritative timing origin.
 */
// 中文：timing 投影定义：turn/start 打开时间窗（描述符前先暂存起点）、
// subagent/descriptor 重置累计并以"已开窗或暂存起点"为新窗口起点、
// turn/end 把窗口时长累进 settledMs。
export const subagentTimingProjectionDefinition = {
  key: 'subagentTiming',
  stateSchema: timingStateSchema,
  init: () => ({ descriptorSeen: false, settledMs: 0 }),
  apply: (state, event) => {
    if (event.type === 'turn/start') {
      return state.descriptorSeen
        ? { ...state, active: { since: event.time, through: event.time } }
        : { ...state, pendingTurnStart: event.time }
    }
    if (event.type === 'subagent/descriptor') {
      const activeSince = state.active?.since ?? state.pendingTurnStart
      return {
        descriptorSeen: true,
        settledMs: 0,
        ...(activeSince === undefined
          ? {}
          : { active: { since: activeSince, through: event.time } }),
      }
    }
    if (event.type === 'turn/end') {
      if (!state.descriptorSeen) {
        if (state.pendingTurnStart === undefined) return state
        const { pendingTurnStart: _closed, ...next } = state
        return next
      }
      if (state.active === undefined) return state
      const { active, ...rest } = state
      return {
        ...rest,
        settledMs: state.settledMs + Math.max(0, event.time - active.since),
      }
    }
    if (state.active === undefined) return state
    return { ...state, active: { ...state.active, through: event.time } }
  },
  wire: {
    viewSchema: projectionSchema,
    view: state => ({
      settledMs: state.settledMs,
      ...(state.active === undefined ? {} : { active: state.active }),
    }),
  },
  stateVersion: 2,
} satisfies ProjectionDefinition<'subagentTiming', TimingState>

// 中文：identity 投影的折叠中间态：identity 只在"最后一条有效描述符"后存在，
// 遇到无效或未知版本描述符时被清空（对外折成 null 哨兵）。
interface IdentityState {
  /** Identity from the last valid descriptor; absent before one, and after an invalid one. */
  identity?: SubagentIdentityProjection | undefined
}

// The cast bridges only the optional-label arm: Zod's optional output
// includes explicit `undefined`, which exactOptionalPropertyTypes excludes
// from the public interface. The no-value state itself is the serializable
// `null` arm — never `undefined` — so every registry read and push frame
// survives JSON.stringify losslessly.
const identityValueSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('one-shot'),
    label: z.string().optional(),
    seq: z.number().int().nonnegative(),
  }).strict(),
  z.object({
    mode: z.literal('continuable'),
    label: z.string(),
    seq: z.number().int().nonnegative(),
  }).strict(),
]) as unknown as z.ZodType<SubagentIdentityProjection>

const identitySchema = identityValueSchema.nullable()

const identityStateSchema: z.ZodType<IdentityState> = z.object({
  identity: identityValueSchema.optional(),
}).strict()

/** Interpret one `subagent/descriptor` event's identity; no value when the payload cannot be trusted. */
// 中文：从单条描述符事件折出身份：解析失败（损坏的当前版本载荷）折成 undefined，
// 投影折叠绝不能抛错；one-shot/continuable 两臂分别组装，seq 取事件自身序号。
function descriptorIdentity(event: SessionEvent): SubagentIdentityProjection | undefined {
  let descriptor: SubagentDescriptorData | undefined
  try {
    descriptor = foldSubagentDescriptor([event])
  } catch {
    // Only a malformed current-version payload throws in descriptor parsing;
    // a projection fold must never throw, so damage folds to no value.
    descriptor = undefined
  }
  if (descriptor === undefined) return undefined
  return descriptor.mode === 'one-shot'
    ? {
      mode: 'one-shot',
      ...descriptor.label !== undefined ? { label: descriptor.label } : {},
      seq: event.seq,
    }
    : { mode: 'continuable', label: descriptor.label, seq: event.seq }
}

/**
 * Fold the durable mode/label identity from `subagent/descriptor` events,
 * last-wins: a fork seed may replay an ancestor's descriptor, and the child's
 * own descriptor must override it — the same reset discipline as
 * {@link subagentTimingProjectionDefinition}. A malformed or unknown-version
 * payload resets to the `null` sentinel instead of throwing, so a fork of a
 * healthy ancestor never inherits an identity its own descriptor failed to
 * establish — and the reset survives every JSON push frame, so a consumer
 * holding the earlier identity replaces it instead of keeping it stale;
 * `null` ⟺ no valid descriptor, with the causes deliberately undistinguished.
 */
// 中文：identity 投影定义：只关注 subagent/descriptor 事件，last-wins；无效/未知版本
// 折叠为 null 哨兵（而非抛错或保留旧值），保证损坏数据不会让查询崩掉。
export const subagentIdentityProjectionDefinition = {
  key: 'subagent',
  stateSchema: identityStateSchema,
  init: () => ({}),
  apply: (state, event) => {
    if (event.type !== 'subagent/descriptor') return state
    const identity = descriptorIdentity(event)
    return identity === undefined ? {} : { identity }
  },
  wire: { viewSchema: identitySchema, view: state => state.identity ?? null },
  // Bumped when the identity gained its `seq` field: an older checkpoint row
  // would replay into a value the schema rejects, so it must refold instead.
  stateVersion: 2,
} satisfies ProjectionDefinition<'subagent', IdentityState>
