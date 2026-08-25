/**
 * 文件职责：定义工具结果裁剪策略、已校验配置、单条替换记录和汇总结果类型。
 * 技术维度：使用 TypeScript 接口、只读字段和品牌化 CallId 描述确定性裁剪数据。
 * 产品维度：在保留首尾关键信息的同时减少模型上下文中的过长工具输出。
 * 逻辑维度：原始配置允许缺省；解析后配置完全只读；PrunedEntry 记录替换，PruneResult 汇总批次。
 * 关键边界：长度单位统一为 Unicode 码点而非 UTF-16 单元；替换必须保持原调用 id。
 * 新手阅读建议：先比较 ToolResultPruneConfig 与 ResolvedConfig，再看单条 PrunedEntry 和整体 PruneResult。
 */
import type { CallId } from '@deepseek-ai/dsh-llm'

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
  /* 被新事件遮蔽的完整工具结果事件序号。 */
  readonly originalSeq: number
  /** Newly appended pruned tool-result event. */
  /* 新追加的裁剪后工具结果事件序号。 */
  readonly replacementSeq: number
  /** Tool call shared by the original and replacement. */
  /* 原事件和替换事件共同引用的品牌化工具调用 id。 */
  readonly callId: CallId
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
