/*
 * ================================ 文件注释 ================================
 * 【文件职责】输入触发器纯核心（core）的冻结契约：触发器检测与菜单归约的类型，
 *             零 React / DOM / Cordis 依赖。
 * 【技术维度】纯类型别名：实现分布在兄弟模块（detect.ts / menu.ts），
 *             服务壳把它们接到 Cordis 上下文上。
 * 【产品维度】支撑 '/' 与 '@' 触发菜单的检测结果、菜单状态与归约事件的形态定义。
 * 【逻辑维度】TriggerHit（一次检测命中）→ MenuState/MenuEvent/MenuReduce
 *             （菜单状态机）→ ExactMatch（精确匹配查询）。
 * 【关键边界】纯核心不依赖任何运行时框架；菜单分组状态机由 reducer 纯函数驱动。
 * 【新手阅读建议】先看 MenuState 与 MenuEvent，理解"分组 + 代际"的归约模型。
 * ==========================================================================
 */
/**
 * Frozen pure-core contract: trigger detection and
 * menu reduction, zero React / DOM / cordis. Types only — implementations
 * live in sibling modules annotated with these
 * aliases; the service shell wires them to ctx.
 */
import type { InputTriggerCandidate, TokenSpan, TriggerChar, TriggerGuard, TriggerPosition } from '../types.ts'

/** A detected trigger token under the caret. */
// 光标处检测到的一次触发命中：触发字符、查询词、是否带引号、位置与 token 区间。
export interface TriggerHit {
  readonly trigger: TriggerChar
  /** Text between the trigger char and the caret, live-filtered. */
  readonly query: string
  /** True only for an open quoted `@file` token. */
  readonly quoted: boolean
  /** leading = draft trimmed (whitespace incl. newlines) starts with the token. */
  readonly position: TriggerPosition
  /** Token span; draftRev injected by the caller. */
  readonly span: TokenSpan
}

/**
 * Detect a trigger token at the caret under the given guard tier.
 * `@` uses the shared file-reference start/whitespace grammar; `/` accepts
 * punctuation boundaries with URL carve-outs. `user@host` and URL `/` do not
 * trigger.
 * Returns null when no trigger is live at the caret.
 */
export type DetectTrigger = (draft: string, caret: number, guard: TriggerGuard) => TriggerHit | null

/** Menu state: one group per source; empty ready groups auto-close the menu. */
export interface MenuState {
  readonly open: boolean
  readonly hit: TriggerHit | null
  /** Monotonic per-hit generation; stale source settlements are dropped. */
  readonly generation: number
  readonly groups: readonly {
    readonly source: string
    /** False when candidate section rows own all visible group labeling. */
    readonly showGroupTitle?: boolean
    readonly status: 'pending' | 'ready'
    readonly items: readonly InputTriggerCandidate[]
  }[]
  readonly highlight: { readonly source: string; readonly index: number } | null
}

/** Menu reduction events. Source failure = silent group removal (log only; no error UI tier). */
export type MenuEvent =
  | { readonly type: 'hit'; readonly hit: TriggerHit | null }
  | { readonly type: 'source-settled'; readonly generation: number; readonly source: string; readonly items?: readonly InputTriggerCandidate[] }
  | { readonly type: 'source-failed'; readonly generation: number; readonly source: string }
  | { readonly type: 'move'; readonly dir: 1 | -1 }
  | { readonly type: 'close' }

/** Pure menu reducer; returns the same reference when the event is stale or a no-op. */
export type MenuReduce = (state: MenuState, ev: MenuEvent) => MenuState

/**
 * Exact-name lookup in one source's ready group; null when absent or the
 * group is not ready.
 */
export type ExactMatch = (groups: MenuState['groups'], source: string, name: string) => InputTriggerCandidate | null
