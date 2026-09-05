
// Latency/throughput folds shared by the settled turn footer and StatsLine.

/*
 * 【文件职责】声明轮次页脚使用的延迟和解码吞吐指标；
 * 未记录的计时保持缺失状态。
 */

import type {
  AssistantMessageNode, ConversationNode,
} from '@deepseek-ai/dsh-client-ui-conversation/client'

/** Latency and decode-throughput readings for one turn's footer. */
// 一个回合页脚的延迟与解码吞吐读数。
export interface TurnMetrics {
  /** First-step TTFT in ms; absent when that step carries no recorded timing. */
  // 首步 TTFT（毫秒）；该步无记录时序时缺省。
  ttftMs?: number
  /** Decode throughput over steps carrying both timing and provider usage. */
  // 同时携带时序与提供商用量的步骤上的解码吞吐。
  tokensPerSecond?: number
}

/** One assistant step's derivable latency facts; null marks an unrecorded part. */
// 一个 assistant 步骤可推导的延迟事实；null 表示该部分未记录。
export interface StepReading {
  /** step/start → first token delta, in ms. */
  // step/start 到首 token 的差值（毫秒）。
  ttftMs: number | null
  /** First token delta → final message, in ms. */
  // 首 token 到最终消息的差值（毫秒）。
  decodeMs: number | null
  /** Provider-reported completion tokens. */
  // 提供商报告的完成 token 数。
  outputTokens: number | null
}

interface UsageLike {
  outputTokens?: number
}

type AssistantNode = AssistantMessageNode

function usageOutputTokens(usage: unknown): number | null {
  if (typeof usage !== 'object' || usage === null) return null
  const value = (usage as UsageLike).outputTokens
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

/**
 * Read one assistant node's TTFT, decode wall time, and output tokens.
 * @param node - A settled assistant node.
 * @returns Per-part readings with `null` for unrecorded values.
 */
export function assistantStepReading(node: AssistantNode): StepReading {
  const timing = node.timing
  const ttftMs = timing !== undefined && timing.stepStartTime !== null && timing.firstTokenTime !== null
    ? Math.max(0, timing.firstTokenTime - timing.stepStartTime)
    : null
  const decodeMs = timing !== undefined && timing.firstTokenTime !== null
    ? Math.max(0, timing.completedTime - timing.firstTokenTime)
    : null
  return { ttftMs, decodeMs, outputTokens: usageOutputTokens(node.usage) }
}

interface TurnFold {
  firstStep: number
  firstStepTtftMs: number | null
  decodeMs: number
  outputTokens: number
  sampled: boolean
}

/**
 * Fold assistant nodes into per-turn footer metrics.
 *
 * TTFT is the turn's lowest-step request-dispatch-to-first-token reading, so
 * it is only meaningful when the turn's start is inside
 * the loaded window (the caller gates on `turnTimings`, which shares that
 * window). Throughput divides summed output tokens by summed decode wall time,
 * counting only steps that carry both.
 * @param nodes - Snapshot nodes of the loaded window.
 * @returns Turn number → available metrics; turns with none are absent.
 */
export function deriveTurnMetrics(nodes: readonly ConversationNode[]): Map<number, TurnMetrics> {
  const folds = new Map<number, TurnFold>()
  for (const node of nodes) {
    if (node.kind !== 'assistant') continue
    const reading = assistantStepReading(node)
    let fold = folds.get(node.turn)
    if (fold === undefined) {
      fold = { firstStep: node.step, firstStepTtftMs: reading.ttftMs, decodeMs: 0, outputTokens: 0, sampled: false }
      folds.set(node.turn, fold)
    } else if (node.step < fold.firstStep) {
      fold.firstStep = node.step
      fold.firstStepTtftMs = reading.ttftMs
    }
    if (reading.decodeMs !== null && reading.outputTokens !== null) {
      fold.decodeMs += reading.decodeMs
      fold.outputTokens += reading.outputTokens
      fold.sampled = true
    }
  }
  const metrics = new Map<number, TurnMetrics>()
  for (const [turn, fold] of folds) {
    const entry: TurnMetrics = {}
    if (fold.firstStepTtftMs !== null) entry.ttftMs = fold.firstStepTtftMs
    if (fold.sampled && fold.decodeMs > 0) entry.tokensPerSecond = fold.outputTokens / (fold.decodeMs / 1000)
    if (entry.ttftMs !== undefined || entry.tokensPerSecond !== undefined) metrics.set(turn, entry)
  }
  return metrics
}
