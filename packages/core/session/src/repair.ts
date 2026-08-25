/**
 * Crash-recovery repair for an interrupted session log. It preserves a fully
 * written final turn and supplies the missing tool, step, and turn boundaries
 * needed to resume with a provider-valid transcript.
 * @module @deepseek-ai/dsh-session/repair
 */
/*
 * ================================ 文件注释 ================================
 * 【文件职责】崩溃恢复：修复被打断的会话日志尾部。它保全已完整写下的最后一轮，并补齐缺失的
 *           工具结果、step 与 turn 边界事件，使日志能以“提供方合法的转录”继续 resume。
 * 【技术维度】对日志的单遍扫描状态机（跟踪开着的 turn/step 与未闭合的工具调用）；确定性合成事件
 *            （seq 接续日志、时间戳复用最后一条真实事件）；freezeMessage 构造不可变消息。
 * 【产品维度】进程崩溃或被强杀后，日志尾部可能停在“半开的轮次”里；不补齐这些事件，恢复后发给
 *           模型的转录会带着悬空的工具调用而被 API 拒绝。此模块让恢复既合法又对模型诚实——
 *           合成的错误结果明确告诉模型“结局未知，谨慎重试”。
 * 【逻辑维度】interruptedTurnClosers 先扫描全日志，用 pendingCalls 登记未配对的工具调用并记录
 *           开着的 turn/step；平衡日志直接返回空；否则按“悬空调用的错误结果 → step/end →
 *           turn/end(interrupted)”顺序生成合成收尾事件。
 * 【关键边界】合成事件的 seq 接续最后一条真实事件、时间戳沿用之（保证确定性且不虚构未来时间）；
 *           “已启动但结果未知”与“尚未记录启动”使用不同的错误码与提示文案；
 *           Map 插入序保证多条悬空调用按转录顺序闭合；每个 turn 边界都会清空登记表防泄漏。
 * 【新手阅读建议】先读两个错误码常量与函数主注释，再顺着 switch 理解 pendingCalls 的登记/清账时机，
 *           最后对比两种合成结果文案，体会“未知结局 vs 未曾启动”的差异。
 * ==========================================================================
 */

import { MessageId, freezeMessage, type CallId } from '@deepseek-ai/dsh-llm'
import type { ToolResultMessage } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from './types.ts'

/** Recovery code for an assistant tool request that never reached a recorded call start. */
/* 恢复错误码：assistant 请求了某次工具调用，但日志中没有对应的“调用开始”记录。 */
export const TOOL_NOT_STARTED = 'TOOL_NOT_STARTED'

/** Recovery code for a recorded tool call whose completed outcome was not durably recorded. */
/* 恢复错误码：调用已被记录开始，但其完成结果没有被耐久地记录下来（结局未知）。 */
export const TOOL_OUTCOME_UNKNOWN = 'TOOL_OUTCOME_UNKNOWN'

/**
 * Return deterministic synthetic events that close an open tail turn. Unmatched
 * calls receive error results first, followed by an open `step/end` and an
 * interrupted `turn/end`; sequences continue the log and timestamps reuse the
 * last real event. A balanced or empty log returns no events.
 *
 * @param events - the loaded durable log to scan (a valid committed prefix, possibly with a crash tail).
 * @returns the synthetic closer events to append after `events`, in order; empty when the log is already balanced.
 */
/*
 * 生成确定性的合成事件来闭合一个未收尾的开放轮次：未配对的调用先收到错误结果，
 * 随后补上缺失的 step/end 与 interrupted 的 turn/end；seq 接续日志、时间戳复用最后一条
 * 真实事件。已经平衡（或为空）的日志返回空数组。
 * @param events - 已加载的耐久日志（一个有效的已提交前缀，可能带崩溃尾巴）。
 * @returns 应按序追加在 events 之后的合成收尾事件；日志已平衡时为空数组。
 */
export function interruptedTurnClosers(events: readonly SessionEvent[]): SessionEvent[] {
  // 当前开着的轮次/步骤编号；null 表示没有开放。
  let openTurn: number | null = null
  let openStep: number | null = null
  // Reset at each turn boundary so earlier calls cannot leak into tail repair.
  // Assistant blocks register calls; later `tool/call` events add their seqs to `sourceEventSeqs`.
  // 每个 turn 边界重置，防止更早的调用泄漏进尾部修复。assistant 消息块登记调用；
  // 后续 tool/call 事件把自己的 seq 补进 sourceEventSeqs。
  const pendingCalls = new Map<CallId, { step: number; callSeq?: number }>()
  for (const event of events) {
    switch (event.type) {
      case 'turn/start':
        openTurn = event.data.turn
        openStep = null
        pendingCalls.clear()
        break
      case 'turn/end':
        openTurn = null
        openStep = null
        pendingCalls.clear()
        break
      case 'step/start':
        openStep = event.data.step
        break
      case 'step/end':
        pendingCalls.clear()
        openStep = null
        break
      case 'assistant/message':
        // The assistant message carries the tool-call blocks; each is pending
        // until a tool/result event with the same callId is logged.
        // assistant 消息携带工具调用块；每个调用在出现相同 callId 的 tool/result 之前都算未结。
        for (const block of event.data.message.content) {
          if (block.type === 'tool-call') pendingCalls.set(block.id, { step: event.data.step })
        }
        break
      case 'tool/call':
        // Cite the `tool/call` seq from the synthetic result.
        // 在合成结果里引用对应 tool/call 事件的 seq。
        {
          const entry = pendingCalls.get(event.data.callId)
          if (entry) {
            entry.callSeq = event.seq
          }
        }
        break
      case 'tool/result':
        // 出现了正式结果，从待结表中移除该调用。
        pendingCalls.delete(event.data.message.source.callId)
        break
      // Other event types do not move the turn/step boundary cursor.
      // 其他事件类型不影响轮次/步骤边界游标。
      default:
        break
    }
  }

  // Balanced log (no crash mid-turn): nothing to close. An open turn implies
  // `events` is non-empty (its turn/start was logged), so `last` exists.
  // 平衡日志（没有崩溃在轮次中间）：无需收尾。开着轮次意味着 events 非空（其 turn/start 已落日志），
  // 因此 last 必然存在。
  const last = events.at(-1)
  if (openTurn === null || last === undefined) return []

  // The last real event supplies the seq base and the timestamp for the
  // synthetic closers (reusing the last timestamp keeps them deterministic and
  // never invents a "future" time).
  // 最后一条真实事件提供合成收尾事件的 seq 基点与时间戳（复用时间戳保证确定性，
  // 也绝不会编造“未来”的时间）。
  let seq = last.seq + 1
  const time = last.time
  // 待返回的合成收尾事件列表。
  const closers: SessionEvent[] = []

  // Close calls before their step: providers reject dangling assistant calls,
  // and Map insertion order preserves their transcript order.
  // 先于步骤闭合这些调用：提供方拒绝悬空的 assistant 调用；Map 插入序保持它们的转录顺序。
  for (const [callId, { step, callSeq }] of pendingCalls) {
    // 该调用是否已被记录“开始”。
    const started = callSeq !== undefined
    // 给模型的合成错误结果：文案区分“结果未知（先核实再重试）”与“未曾启动（仍需要就可重试）”。
    const message: ToolResultMessage = freezeMessage({
      id: MessageId(`interrupted-tool-result-${callId}-${seq}`),
      role: 'user',
      source: { kind: 'tool', callId },
      content: [{
        type: 'tool-result',
        toolCallId: callId,
        isError: true,
        content: [{
          type: 'text',
          text: started
            ? 'The tool call was interrupted after it was recorded, but no result was durably recorded. Its outcome is unknown. Decide whether to retry from the tool semantics: retry only if the operation is read-only or idempotent; if it may have side effects, first verify external state or ask the user. Do not retry blindly.'
            : 'The tool call was interrupted before the Harness recorded it as started. Retry it if it is still needed.',
        }],
      }],
    })
    closers.push({
      type: 'tool/result',
      seq: seq++,
      time,
      data: {
        turn: openTurn,
        step,
        message,
        error: started
          ? { name: 'ToolOutcomeUnknownError', code: TOOL_OUTCOME_UNKNOWN }
          : { name: 'ToolNotStartedError', code: TOOL_NOT_STARTED },
      },
      surfaceOp: 'append',
      ...started ? { sourceEventSeqs: [callSeq] } : {},
    })
  }

  // Close an open step next — a turn/end while a step is open is an invariant
  // violation, so the step's boundary must be synthesized before the turn's.
  // 接着闭合开着的步骤——step 还开着就发 turn/end 属于不变量违规，因此必须先合成步骤边界。
  if (openStep !== null) {
    closers.push({ type: 'step/end', seq: seq++, time, data: { turn: openTurn, step: openStep } })
  }
  closers.push({ type: 'turn/end', seq: seq++, time, data: { turn: openTurn, reason: { kind: 'interrupted' } } })
  return closers
}
