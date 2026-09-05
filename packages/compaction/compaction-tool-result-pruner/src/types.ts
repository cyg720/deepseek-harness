/*
 * 【文件职责】声明工具结果裁剪的字符预算策略；
 * 文本长度以 Unicode 码点计数。
 */

import type { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { SessionSeq } from '@deepseek-ai/dsh-session/types'

/** Character-budget policy for deterministic tool-result pruning. */
/* 确定性工具结果裁剪的字符预算策略；省略字段时使用实现默认值。 */
export interface ToolResultPruneConfig {
  /** Prune when total text exceeds this many Unicode code points. Defaults to `8192`. */
  /* 总文本超过此 Unicode 码点数时裁剪，默认 8192。 */
  thresholdChars?: number
  /** Maximum leading Unicode code points retained. Defaults to `4096`. */
  /* 最多保留的开头码点数，默认 4096。 */
  headChars?: number
  /** Maximum trailing Unicode code points retained. Defaults to `1024`. */
  /* 最多保留的结尾码点数，默认 1024。 */
  tailChars?: number
}

/** Validated, detached, deeply immutable pruning configuration. */
/* 已校验、与输入分离且深度不可变的裁剪配置。 */
export interface ResolvedConfig {
  // 实际触发阈值，必须为已校验数值。
  readonly thresholdChars: number
  // 实际保留开头长度。
  readonly headChars: number
  // 实际保留结尾长度。
  readonly tailChars: number
}

/** Cited source event and size accounting for one landed surface replacement. */
/* 一次已落地替换的来源事件引用和长度统计。 */
export interface PrunedEntry {
  /** Full-fidelity tool-result event shadowed by the replacement. */
  readonly originalSeq: SessionSeq
  /** Newly appended pruned tool-result event. */
  readonly replacementSeq: SessionSeq
  /** Tool call shared by the original and replacement. */
  readonly callId: ToolCallId
  /** Original text size in Unicode code points. */
  /* 原始文本的 Unicode 码点数。 */
  readonly charsBefore: number
  /** Replacement text size in Unicode code points. */
  /* 替换文本的 Unicode 码点数。 */
  readonly charsAfter: number
}

/** Aggregate outcome of one stable-surface pruning pass. */
/* 一次稳定表面裁剪过程的汇总结果。 */
export interface PruneResult {
  /** Replacements in the snapshotted surface order. */
  /* 按快照表面顺序排列的只读替换记录。 */
  readonly pruned: readonly PrunedEntry[]
  /** Total Unicode code points removed across replacements. */
  /* 全部替换总共移除的 Unicode 码点数。 */
  readonly charsRemoved: number
}
