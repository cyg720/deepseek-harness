/**
 * Merge matched hooks into one most-restrictive outcome. Permission precedence
 * is `deny > ask > allow`; the first `continue:false` stop is sticky; reasons
 * for the winning rank are joined; and context and system messages accumulate
 * in hook order.
 * @module @deepseek-ai/dsh-hook-protocol/merge
 */
/*
 * 文件职责：实现Hook 线协议的 merge.ts 模块。
 * 技术维度：TypeScript、Cordis、JSON 编解码、子进程、事件匹配和严格联合类型。
 * 产品维度：保证Hook 线协议可预测地传递事件、限制循环或适配外部工具。
 * 逻辑维度：解析配置，匹配事件，执行处理器并合并输出。
 * 关键边界：线协议输入必须校验；外部 Hook 失败不得破坏会话日志或核心循环。
 * 新手阅读建议：先读 types/events，再看 codec/matcher/runner，最后阅读桥接配置。
 */

import type { HookOutput } from './types.ts'

/** The single decision a hook point resolves to after merging all matched hooks. */
/* 中文说明：类型或类 MergedDecision 约束 Hook、守卫或目标数据职责。 */
export type MergedDecision = 'allow' | 'ask' | 'deny' | 'none'

/** The folded outcome of every hook that matched one point. */
/* 中文说明：类型或类 MergedHookOutcome 约束 Hook、守卫或目标数据职责。 */
export interface MergedHookOutcome {
  /**
   * The most-restrictive permission decision across all hooks (`deny` > `ask` >
   * `allow`), or `none` when no hook expressed one. `block`/`deny` both fold to
   * `deny`; `approve`/`allow` both fold to `allow`.
   */
  decision: MergedDecision
  /** Joined (`\n\n`) reasons from every blocking/denying hook, or `undefined`. */
  reason?: string
  /** `true` when any hook asked to halt (`continue:false`). */
  stop: boolean
  /** The first halting hook's `stopReason`, when one halted. */
  stopReason?: string
  /** Every hook's `additionalContext`, in hook order (no joining — the bridge decides). */
  additionalContext: string[]
  /** Every hook's `systemMessage`, in hook order. */
  systemMessages: string[]
}

/** Rank a single hook's decision for the deny>ask>allow precedence (higher = stricter). */
/* 中文说明：函数 rank 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function rank(decision: HookOutput['decision']): number {
  switch (decision) {
    case 'deny': case 'block': return 3
    case 'ask': return 2
    case 'approve': case 'allow': return 1
    default: return 0 // no decision
  }
}

/** Collapse a ranked decision back to the merged enum. */
/* 中文说明：函数 decisionForRank 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function decisionForRank(maxRank: number): MergedDecision {
  switch (maxRank) {
    case 3: return 'deny'
    case 2: return 'ask'
    case 1: return 'allow'
    default: return 'none'
  }
}

/**
 * Fold `outputs` (the results of every hook that matched a point, in hook order)
 * into one {@link MergedHookOutcome} by the precedence rules above. An empty list
 * yields a neutral outcome (`decision: 'none'`, no stop, empty context) — the
 * caller treats that as "no hook had anything to say".
 * @param outputs - every matched hook's decoded output, in hook order.
 * @returns the single folded outcome the bridge maps onto its extension point.
 */
/*
 * 中文说明：函数 mergeHookOutputs 的参数见签名，返回结果供相邻流程使用；示例见本文件。
 * @param outputs 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
 */
export function mergeHookOutputs(outputs: HookOutput[]): MergedHookOutcome {
  /** 中文说明：协议局部值 maxRank，由紧邻初始化决定。 */
  let maxRank = 0
  // Keep reasons per rank so only objections explaining the winning decision surface.
  /** 中文说明：协议局部值 reasonsByRank，由紧邻初始化决定。 */
  const reasonsByRank = new Map<number, string[]>()
  /** 中文说明：协议局部值 stop，由紧邻初始化决定。 */
  let stop = false
  /** 中文说明：协议局部值 解构结果，由紧邻初始化决定。 */
  let stopReason: string | undefined
  /** 中文说明：协议局部值 additionalContext，由紧邻初始化决定。 */
  const additionalContext: string[] = []
  /** 中文说明：协议局部值 systemMessages，由紧邻初始化决定。 */
  const systemMessages: string[] = []

  /** 中文说明：协议局部值 out，由紧邻初始化决定。 */
  for (const out of outputs) {
    /** 中文说明：协议局部值 r，由紧邻初始化决定。 */
    const r = rank(out.decision)
    if (r > maxRank) maxRank = r
    if ((r === 3 || r === 2) && out.reason !== undefined && out.reason.length > 0) {
      /** 中文说明：协议局部值 list，由紧邻初始化决定。 */
      const list = reasonsByRank.get(r) ?? []
      list.push(out.reason)
      reasonsByRank.set(r, list)
    }
    if (out.continue === false && !stop) {
      stop = true
      if (out.stopReason !== undefined) stopReason = out.stopReason
    }
    if (out.additionalContext !== undefined && out.additionalContext.length > 0) {
      additionalContext.push(out.additionalContext)
    }
    if (out.systemMessage !== undefined && out.systemMessage.length > 0) {
      systemMessages.push(out.systemMessage)
    }
  }

  /** 中文说明：协议局部值 reasons，由紧邻初始化决定。 */
  const reasons = reasonsByRank.get(maxRank) ?? []
  return {
    decision: decisionForRank(maxRank),
    ...reasons.length > 0 ? { reason: reasons.join('\n\n') } : {},
    stop,
    ...stopReason !== undefined ? { stopReason } : {},
    additionalContext,
    systemMessages,
  }
}
