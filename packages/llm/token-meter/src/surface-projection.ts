

/**
 * The O(1) surface-token fold shared by the token-meter projection units.
 *
 * A projection state must stay bounded — the persisted projection cache
 * checkpoints every unit's whole state, so carrying the priced surface
 * (one node per model-visible message) would grow a checkpoint without
 * bound over the session's life. Instead, replacements ride the compact
 * seam's shadow-price protocol: the metering event immediately before a
 * surface `replace` (`compaction/summary` or `compaction/prune`) states the
 * heuristic price of the exact replaced range, so the fold keeps a running
 * total plus at most one pending claim and never retains per-node prices.
 * The counts are exact by construction: producers derive them from the same
 * fixed estimator this module prices appends with. A replacement without an
 * armed claim folds with zero delta because bounded state cannot reconstruct
 * the replaced range; this preserves replay at the cost of possible drift.
 *
 * @module @deepseek-ai/dsh-token-meter/surface-projection
 */

/*
 * 【文件职责】用常量大小状态维护表面 token 投影；
 * 替换范围的价格取自紧邻替换记录的持久计量事实。
 */

import { deriveEventMessage, isSurfaceEvent, SessionSeq } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
// Type-only: the `compaction/*` SessionEventMap merges (shadow-price events).
import type {} from '@deepseek-ai/dsh-compaction'
import { estimateMessage } from './estimate.ts'

/*
 * （中文）一个已武装的影子价格：紧随其后的表面 replace 事件要替换的区间，
 * 其启发式 token 数。武装期间属于持久单元状态的一部分，因此必须是纯 JSON。
 */
/**
 * One armed shadow price: the heuristic tokens of the surface range the
 * IMMEDIATELY following event replaces. Plain JSON — it is part of the
 * persisted unit state while armed.
 */
export interface ShadowPriceClaim {
  /** Declared inclusive first surface-node seq of the priced range. */
  start: SessionSeq
  /** Declared inclusive last surface-node seq of the priced range. */
  end: SessionSeq
  /** Heuristic tokens of the priced range under the fixed estimator. */
  // 中文：固定估计器下该区间的启发式 token 数。
  tokens: number
}

/** One event's effect on a running surface-token total. */
/*
 * （中文）一个事件对运行中表面 token 总量的影响。
 */
export interface SurfaceTokensFold {
  /** Signed change in the surface total; 0 for events off the surface. */
  // 中文：表面总量的有符号变化；非表面事件为 0。
  readonly deltaTokens: number
  /** Claim to carry into the next event; undefined when none survives. */
  // 中文：要带入下一个事件的 claim；无存活时为 undefined。
  readonly claim: ShadowPriceClaim | undefined
}

/*
 * （中文）把一个已提交事件折叠到运行中的表面 token 总量上。
 * 影子价格事件武装一个 claim；任何其他事件使其过期；表面 replace 消费"命名其
 * 精确区间"的 claim——生产者把计量事件与替换事件同步相邻追加，因此存活的
 * claim 总是为紧接着的下一个事件定价。无 claim 的 replace 按零增量折叠（有界
 * 状态无法重建被替换区间）。武装了其他区间的 claim 仍会失败，因为相邻事件
 * 相互矛盾。
 * @param claim 紧邻前一个事件武装的 claim（若有）。
 * @param event 下一个已提交的会话事件。
 * @returns 有符号 token 增量与该事件之后的 claim 状态。
 * @throws 当替换事件带着"指向不同区间"的武装 claim 到达时——计量事件本应
 *   相邻，这是活跃生产者的影子价格契约违反（而非历史数据），必须 fail loud
 *   而不是让总量漂移。
 */
/**
 * Fold one committed event onto a running surface-token total.
 *
 * A shadow-price event arms a claim; any other event expires it, and a
 * surface `replace` consumes the claim naming its exact range — the
 * producers append the metering event and the replacement synchronously
 * adjacent, so a surviving claim always prices the very next event.
 * A replace with no claim folds with zero delta because the bounded state
 * cannot reconstruct the replaced range. An armed claim for another range
 * still fails because the adjacent events contradict each other.
 * @param claim - the claim armed by the immediately preceding event, if any.
 * @param event - the next committed session event.
 * @returns the signed token delta and the claim state after this event.
 * @throws when a replacement arrives with an armed claim for a different
 *   range — the metering event was adjacent, so this is a live producer's
 *   shadow-price contract violation, not historical data, and must fail
 *   loud rather than let the total drift.
 */
export function foldSurfaceProjection(
  claim: ShadowPriceClaim | undefined,
  event: SessionEvent,
): SurfaceTokensFold {
  // 中文：计量事件（压缩摘要/剪枝）：武装 claim（记录被遮蔽区间与其价格）。
  if (event.type === 'compaction/summary' || event.type === 'compaction/prune') {
    const { shadowedRange, shadowedTokenCount } = event.data
    return {
      deltaTokens: 0,
      claim: {
        start: SessionSeq(shadowedRange.start),
        end: SessionSeq(shadowedRange.end),
        tokens: shadowedTokenCount,
      },
    }
  }
  // 中文：非表面事件：零增量、无 claim。
  if (!isSurfaceEvent(event)) return { deltaTokens: 0, claim: undefined }
  const message = deriveEventMessage(event)
  const tokens = message === null ? 0 : estimateMessage(message)
  const op = event.surfaceOp
  if (op === 'append') return { deltaTokens: tokens, claim: undefined }
  // Sessions recorded before the shadow-price protocol log replacements with
  // no adjacent metering event; the bounded state cannot reconstruct the
  // replaced range's price, so fold those neutrally — historical replay
  // degrades to drift instead of failing.
  // 中文：影子价格协议之前记录的会话，其替换没有相邻计量事件；有界状态无法
  // 重建被替换区间的价格，因此中性折叠——历史回放退化为漂移而非失败。
  if (claim === undefined) return { deltaTokens: 0, claim: undefined }
  // 中文：claim 与替换区间不一致 → 活跃生产者契约违反，fail loud。
  if (claim.start !== op.start || claim.end !== op.end) {
    throw new Error(
      `token surface: replace at seq ${event.seq} over range ${op.start}-${op.end} has no adjacent shadow price`
      + ` (armed claim covers ${claim.start}-${claim.end})`,
    )
  }
  return { deltaTokens: tokens - claim.tokens, claim: undefined }
}
