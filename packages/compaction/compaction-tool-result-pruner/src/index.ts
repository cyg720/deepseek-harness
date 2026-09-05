/**
 * Replay-safe, model-free tool-result pruning service.
 *
 * @module @deepseek-ai/dsh-compaction-tool-result-pruner
 */

/*
 * 【文件职责】按确定的头、中、尾保留策略裁剪工具文本结果，无需模型请求，结果可以从日志回放。
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { freezeMessage } from '@deepseek-ai/dsh-llm'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { Session, SessionEvent, SessionSeq, ToolResultMessage } from '@deepseek-ai/dsh-session'
// Type-only: the `compaction/*` SessionEventMap merges (the shadow-price event).
import type {} from '@deepseek-ai/dsh-compaction'
// Type-only: the `ctx.tokenMeter` Context merge for the declared injection.
import type {} from '@deepseek-ai/dsh-token-meter'
import { codePointLength, DEFAULTS, PRUNE_MARKER, resolveConfig } from './config.ts'
import type {
  PrunedEntry,
  PruneResult,
  ResolvedConfig,
  ToolResultPruneConfig,
} from './types.ts'

export { codePointLength, DEFAULTS, PRUNE_MARKER, resolveConfig } from './config.ts'
export type {
  PrunedEntry,
  PruneResult,
  ResolvedConfig,
  ToolResultPruneConfig,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  /** 中文说明：类型或类 Context 约束上下文或压缩数据职责。 */
  interface Context {
    toolResultPruner: ToolResultPruner
  }
}

/** 中文说明：类型或类 SnapshotCandidate 约束上下文或压缩数据职责。 */
interface SnapshotCandidate {
  readonly seq: SessionSeq
  readonly event: SessionEvent<'tool/result'>
}

/** Deterministic head/middle/tail pruning for current tool-result surface nodes. */
/* 中文说明：类型或类 ToolResultPruner 约束上下文或压缩数据职责。 */
export class ToolResultPruner extends Service {
  // The token meter prices each shadowed node for its logged shadow-price
  // event, so pruning genuinely requires the pricing capability.
  static inject = ['tokenMeter']

  static Config: z<ToolResultPruneConfig> = z.object({
    thresholdChars: z.number().step(1).min(1).default(DEFAULTS.thresholdChars),
    headChars: z.number().step(1).min(0).default(DEFAULTS.headChars),
    tailChars: z.number().step(1).min(0).default(DEFAULTS.tailChars),
  })

  /** Resolved and immutable character budgets. */
  readonly config: ResolvedConfig

  constructor(ctx: Context, config: ToolResultPruneConfig = {}) {
    super(ctx, 'toolResultPruner')
    this.config = resolveConfig(config)
  }

  /**
   * Measure text content in Unicode code points; non-text blocks cost zero.
   * @param blocks - tool-result content to measure.
   * @returns total Unicode code points across text blocks.
   */
  measureContent(blocks: readonly ContentBlock[]): number {
    /** 中文说明：上下文局部值 chars，由紧邻初始化决定。 */
    let chars = 0
    /** 中文说明：上下文局部值 block，由紧邻初始化决定。 */
    for (const block of blocks) {
      if (block.type === 'text') chars += codePointLength(block.text)
    }
    return chars
  }

  /**
   * Replace an over-budget text middle while retaining rich-block order.
   * Text slicing is by Unicode code point, not UTF-16 code unit, so a retained
   * boundary cannot split a surrogate pair. Grapheme clusters may still split.
   * @param blocks - original tool-result content.
   * @returns pruned content, or `null` when the text is within budget.
   */
  pruneContent(blocks: readonly ContentBlock[]): ContentBlock[] | null {
    /** 中文说明：上下文局部值 totalChars，由紧邻初始化决定。 */
    const totalChars = this.measureContent(blocks)
    if (totalChars <= this.config.thresholdChars) return null

    /** 中文说明：上下文局部值 removedStart，由紧邻初始化决定。 */
    const removedStart = this.config.headChars
    /** 中文说明：上下文局部值 removedEnd，由紧邻初始化决定。 */
    const removedEnd = totalChars - this.config.tailChars
    /** 中文说明：上下文局部值 pruned，由紧邻初始化决定。 */
    const pruned: ContentBlock[] = []
    /** 中文说明：上下文局部值 consumed，由紧邻初始化决定。 */
    let consumed = 0
    /** 中文说明：上下文局部值 markerInserted，由紧邻初始化决定。 */
    let markerInserted = false

    /** 中文说明：上下文局部值 block，由紧邻初始化决定。 */
    for (const block of blocks) {
      if (block.type !== 'text') {
        pruned.push(block)
        continue
      }

      /** 中文说明：上下文局部值 points，由紧邻初始化决定。 */
      const points = Array.from(block.text)
      /** 中文说明：上下文局部值 blockStart，由紧邻初始化决定。 */
      const blockStart = consumed
      /** 中文说明：上下文局部值 blockEnd，由紧邻初始化决定。 */
      const blockEnd = blockStart + points.length
      /** 中文说明：上下文局部值 headEnd，由紧邻初始化决定。 */
      const headEnd = Math.min(points.length, Math.max(0, removedStart - blockStart))
      /** 中文说明：上下文局部值 tailStart，由紧邻初始化决定。 */
      const tailStart = Math.min(points.length, Math.max(0, removedEnd - blockStart))
      /** 中文说明：上下文局部值 intersectsRemoved，由紧邻初始化决定。 */
      const intersectsRemoved = blockStart < removedEnd && blockEnd > removedStart
      /** 中文说明：上下文局部值 marker，由紧邻初始化决定。 */
      const marker = intersectsRemoved && !markerInserted ? PRUNE_MARKER : ''
      if (marker.length > 0) markerInserted = true
      /** 中文说明：上下文局部值 text，由紧邻初始化决定。 */
      const text = points.slice(0, headEnd).join('')
        + marker
        + points.slice(tailStart).join('')
      if (text.length > 0) pruned.push({ ...block, text })
      consumed = blockEnd
    }

    /* v8 ignore next -- totalChars > threshold and valid budgets guarantee a removed text span. */
    if (!markerInserted) throw new Error('tool-result prune: failed to locate the removed text span')
    /** 中文说明：上下文局部值 charsAfter，由紧邻初始化决定。 */
    const charsAfter = this.measureContent(pruned)
    /* v8 ignore next -- config validation fixes the emitted head + marker + tail budget. */
    if (charsAfter > this.config.thresholdChars || charsAfter >= totalChars) {
      throw new Error('tool-result prune: replacement must be smaller and within threshold')
    }
    return pruned
  }

  /**
   * Prune every over-budget tool result from one stable current-surface snapshot.
   * Each replacement preserves the complete event data except for `content`,
   * cites the shadowed node so replay can recover the replacement input, and is
   * immediately preceded by a `compaction/prune` shadow-price event pricing the
   * shadowed node through the injected token meter, so pure consumers can
   * subtract it without per-node state.
   * @param session - session whose current surface is rewritten.
   * @returns landed replacements and aggregate Unicode-code-point savings.
   * @throws when the session rejects a replacement; replacements committed
   * earlier in the pass remain durable.
   */
  pruneSession(session: Session): PruneResult {
    /** 中文说明：上下文局部值 candidates，由紧邻初始化决定。 */
    const candidates: SnapshotCandidate[] = []
    /** 中文说明：上下文局部值 seq，由紧邻初始化决定。 */
    for (const seq of [...session.surface.nodes]) {
      const event = session.eventAt(seq)
      /* v8 ignore next -- surface seqs are validated contiguous log references. */
      if (event?.type === 'tool/result') candidates.push({ seq, event })
    }

    /** 中文说明：上下文局部值 pruned，由紧邻初始化决定。 */
    const pruned: PrunedEntry[] = []
    /** 中文说明：上下文局部值 charsRemoved，由紧邻初始化决定。 */
    let charsRemoved = 0
    /** 中文说明：上下文局部值 {，由紧邻初始化决定。 */
    for (const { seq, event } of candidates) {
      /** 中文说明：上下文局部值 result，由紧邻初始化决定。 */
      const result = event.data.message.content[0]
      /** 中文说明：上下文局部值 content，由紧邻初始化决定。 */
      const content = this.pruneContent(result.content)
      if (content === null) continue
      /** 中文说明：上下文局部值 charsBefore，由紧邻初始化决定。 */
      const charsBefore = this.measureContent(result.content)
      /** 中文说明：上下文局部值 charsAfter，由紧邻初始化决定。 */
      const charsAfter = this.measureContent(content)
      /** 中文说明：上下文局部值 message，由紧邻初始化决定。 */
      const message = freezeMessage<ToolResultMessage>({
        ...event.data.message,
        content: [{
          ...result,
          content,
        }] as [typeof result],
      })
      // Shadow-price protocol: the metering event and its replacement are
      // appended synchronously adjacent, so pure consumers subtract the
      // shadowed node's heuristic price without retaining per-node state.
      session.append('compaction/prune', {
        shadowedRange: { start: seq, end: seq },
        shadowedSeqs: [seq],
        shadowedTokenCount: this.ctx.tokenMeter.estimateMessage(event.data.message),
      })
      /** 中文说明：上下文局部值 replacement，由紧邻初始化决定。 */
      const replacement = session.append('tool/result', {
        ...event.data,
        message,
      }, {
        surfaceOp: { op: 'replace', start: seq, end: seq },
        sourceEventSeqs: [seq],
      })
      pruned.push({
        originalSeq: seq,
        replacementSeq: replacement.seq,
        callId: event.data.message.source.callId,
        charsBefore,
        charsAfter,
      })
      charsRemoved += charsBefore - charsAfter
    }
    return { pruned, charsRemoved }
  }
}

export default ToolResultPruner
