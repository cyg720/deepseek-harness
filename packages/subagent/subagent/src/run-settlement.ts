/*
 * ================================ 文件注释 ================================
 * 【文件职责】把一次性（ONE-SHOT）子代理运行的最终结果结算成后台任务（Job）的 outcome。
 * 【技术维度】面向 dsh-jobs 的 JobOutcome：completed 携带文本输出，aborted 记为 killed，
 *   其余停止原因（error/max-tokens/refusal 等）记为 failed 并附 provider 诊断。
 * 【产品维度】一次性子代理在后台任务系统中呈现为一项任务，父代理通过任务状态感知其成败；
 *   续聊子代理不经过本模块（它们没有 Task）。
 * 【逻辑维度】按代码顺序：finalText（取文本块拼串）→ failureDetail（渲染失败详情）→
 *   runOutcome（停止原因到 JobOutcome 的映射）→ settleRun（等待结果、dispose、返回 outcome）。
 * 【关键边界】result 本身不 reject（失败以 stopReason 表示），settleRun 额外兜住
 *   result/dispose 的意外异常并转为 failed；两次失败时两个详情都保留。
 * 【新手阅读建议】重点看 settleRun 的双 try/catch 结构：一次取结果、一次释放资源。
 * ==========================================================================
 */

/**
 * Settlement of one ONE-SHOT subagent run into a background-Task outcome. Only
 * the one-shot background path uses Jobs; continuable children have no Task,
 * no per-message result, and no Task cancellation.
 *
 * @module @deepseek-ai/dsh-subagent/run-settlement
 */

import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { JobOutcome } from '@deepseek-ai/dsh-jobs'
import type { SubagentResult, SubagentRun } from './types.ts'

/** Flatten a child's final output blocks to the task's final text. */
// 中文：把子代理最终输出块过滤成纯文本并拼接，作为后台任务 completed 时的 output 文本。
function finalText(blocks: ContentBlock[]): string {
  return blocks
    .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
    .map(block => block.text)
    .join('')
}

/** Render a failed stop reason with optional provider-authored detail. */
// 中文：渲染失败详情：有 provider 诊断时拼成 "stopReason; diagnostic: ..."，
// 否则只输出停止原因本身。
function failureDetail(result: SubagentResult): string {
  const stopReason = result.stopReason
  return result.diagnostic === undefined
    ? stopReason
    : `${stopReason}; diagnostic: ${result.diagnostic}`
}

/**
 * Map a child result to the task outcome: completed carries final text,
 * aborted is killed, and every other reason is failed without partial output.
 * @param result - child terminal result.
 * @returns outcome for the `ctx.jobs` registration.
 */
// 中文：停止原因 → 任务 outcome 的映射：completed 带最终文本，aborted 记为 killed，
// 其余一律 failed（附失败详情）。可合并扩展的新停止原因也落入 failed，绝不当作成功。
function runOutcome(result: SubagentResult): JobOutcome {
  switch (result.stopReason) {
    case 'completed':
      return { status: 'completed', output: finalText(result.output) }
    case 'aborted':
      return { status: 'killed' }
    case 'error':
    case 'max-tokens':
    case 'refusal':
      return { status: 'failed', detail: failureDetail(result) }
    // Merge-extensible reasons remain failures with provider-authored detail.
    default:
      return { status: 'failed', detail: failureDetail(result) }
  }
}

/**
 * Await the child result, dispose the run, then return its task outcome. Result
 * and disposal failures become `failed`; when both fail, both details survive.
 * @param run - live run to settle and release.
 * @returns outcome after child resources are released.
 */
// 中文：结算入口：等待子代理结果 → 映射为 outcome → 释放运行资源。result 或 dispose
// 抛出的意外异常都被转为 failed 而非上抛，保证后台任务总能拿到确定结局。
export async function settleRun(run: SubagentRun): Promise<JobOutcome> {
  let outcome: JobOutcome
  try {
    outcome = runOutcome(await run.result)
  } catch (error: unknown) {
    outcome = { status: 'failed', detail: String(error) }
  }
  try {
    await run.dispose()
  } catch (error: unknown) {
    const prefix = outcome.detail === undefined ? '' : `${outcome.detail}; `
    return { status: 'failed', detail: `${prefix}dispose failed: ${String(error)}` }
  }
  return outcome
}
