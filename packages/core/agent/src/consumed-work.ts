/**
 * ================================ 文件注释 ================================
 * 【文件职责】回答“一份 agent 日志到底消费了哪些工作”：从会话事件中折叠出最近一个“为工作负责”的 turn/end，以及是否有输入在 turn 之外被取消未运行。
 * 【技术维度】单遍折叠（fold）算法：用 stepped/claimed 两个集合区分“真正跑过模型步骤”与“只领取了输入”的轮次；turn/end 形态不足以回答该问题，必须结合 inbox 的 removedCount/outcome。
 * 【产品维度】支撑“这个 agent 上次停在哪、有没有白干”的审计语义：被取消而未运行的输入不会被误记为成功。
 * 【逻辑维度】ConsumedWork 接口 → accountsForClaim 判定（completed 除外都算负责）→ foldConsumedWork 主折叠
 * （turn/start、step/start、agent/inbox/spliced、turn/end 四种事件分支）。
 * 【关键边界】只认日志本身，不采样 live 状态，任何取消者读到的结果一致；替换（有插入的 canceled）不算丢弃；merged-extensible 的 turn/end 变体默认按负责处理。
 * 【新手阅读建议】先读模块头部文档（为什么 turn 词汇不够），再看 accountsForClaim 的 switch 与 foldConsumedWork 的状态更新顺序。
 * ==========================================================================
 */
/**
 * How one agent log accounts for the work it consumed.
 *
 * The turn and step vocabulary alone cannot answer this. A turn that stops
 * before its first step leaves a `turn/end` shaped exactly like the balanced
 * no-op turns a rejection or an empty claim produces, so reading turns in
 * isolation either credits cut-short work as finished or convicts every no-op.
 * The missing fact is the inbox's own record: {@link Inbox} logs each mutation
 * with `removedCount` and marks a cancellation `outcome: 'canceled'`, which
 * separates a turn claiming its input from work being dropped unrun.
 *
 * @module @deepseek-ai/dsh-agent/consumed-work
 */

import type { SessionEvent, TurnEndReason } from '@deepseek-ai/dsh-session'

/** How one agent log accounts for the work it consumed. */
// 一份 agent 日志对“消费掉的工作”的账目：最近一个负责的 turn/end + 之后是否有未运行即被取消的输入。
export interface ConsumedWork {
  /**
   * The latest closed turn that accounts for consumed work: one that entered a
   * model step, or one that claimed inbox input and then failed, was stopped,
   * or was rejected. Absent when no turn closed over any work.
   */
  // 最近一个“为工作负责”的已关闭轮次：进入过模型步骤，或领取过输入后又失败/中止/被拒；
  // 没有任何轮次承担过工作时该字段缺失。
  readonly end?: SessionEvent<'turn/end'>
  /**
   * Whether accepted work was cancelled out of the inbox, unrun, after that
   * turn. This is the only account of input a cancellation took before any turn
   * could open over it — no `turn/end` describes it.
   */
  // 该轮次之后，是否有输入在“未运行”的状态下被从 inbox 取消掉——这是取消发生在任何轮次打开之前的唯一账目。
  readonly droppedUnrun: boolean
}

/**
 * Whether a turn that consumed input but never reached a step ends in a way
 * that accounts for that input. Only a `completed` end does not: it had
 * nothing left to run once its claim was rewritten away. A `blocked` end is
 * that input's ending too — the pre-step rejection that produced it discarded
 * the claimed messages, so the work it took will never run.
 * @param reason - the turn's recorded ending.
 * @returns whether the ending accounts for the input the turn took.
 */
// 判定一个“领了输入但没跑过步骤”的轮次，其结束原因是否仍为该输入负责。
// 只有 completed 不算：它领的输入已被改写消失，没有剩下可跑的东西。
function accountsForClaim(reason: TurnEndReason): boolean {
  switch (reason.kind) {
    case 'completed':
      return false
    case 'blocked':
    case 'aborted':
    case 'interrupted':
    case 'error':
      return true
    /* v8 ignore next 4 -- unreachable: the one unnamed built-in, `max-tokens`, requires a step,
     * so its turn short-circuits as stepped before this call, and `TurnEndReasonMap` is
     * merge-extensible, so a backend-added variant cannot be listed; an unnameable ending over
     * consumed input must not read as success. */
    default:
      return true
  }
}

/**
 * Fold one agent log, or an owned suffix of one, into its account of consumed
 * work. Single pass, and every input is the log itself: no caller has to sample
 * live state before cancelling, so a cancellation issued by anyone — the owner's
 * teardown, an ancestor's interrupt, an unloading plugin — reads the same.
 * @param events - the log, or an owned suffix, to fold.
 * @returns the accounting turn when one closed, and whether work was dropped unrun after it.
 */
// 主折叠函数：单遍扫描事件序列，产出“最近负责的轮次 + 是否丢弃过未运行的输入”。
export function foldConsumedWork(events: readonly SessionEvent[]): ConsumedWork {
  // stepped：跑过模型步骤的轮次集合（有 step/start 的轮次无论如何都算负责）。
  const stepped = new Set<number>()
  // claimed：领取过 inbox 输入的轮次集合（需要再看结束原因是否负责）。
  const claimed = new Set<number>()
  // open：当前打开的轮次号；只有轮次打开期间的删减才算“领取”。
  let open: number | undefined
  // end：最新一个负责的 turn/end 事件；droppedUnrun：在该轮次之后是否仍有未运行的丢弃。
  let end: SessionEvent<'turn/end'> | undefined
  let droppedUnrun = false
  for (const event of events) {
    switch (event.type) {
      case 'turn/start':
        open = event.data.turn
        break
      case 'step/start':
        stepped.add(event.data.turn)
        break
      case 'agent/inbox/spliced': {
        const { removedCount, outcome, inserted } = event.data
        if (removedCount === undefined) break
        // A replacement keeps the work pending under a new identity, so only a
        // cancellation that leaves nothing behind drops it.
        // 只有“取消且没有插入任何替代消息”才算丢弃；有插入的是换了个身份的替换，工作仍在队列里。
        if (outcome === 'canceled') droppedUnrun ||= inserted.length === 0
        // Claims are the loop's own step-boundary reads, always inside a turn.
        // 轮次打开期间的普通删减（outcome 为空）是循环自己的步骤领取，记入 claimed。
        else if (open !== undefined) claimed.add(open)
        break
      }
      case 'turn/end': {
        const { turn, reason } = event.data
        open = undefined
        // 该轮次跑过步骤（stepped）直接算负责；只领过输入的（claimed）还要看结束原因是否负责。
        if (stepped.delete(turn) || (claimed.delete(turn) && accountsForClaim(reason))) {
          end = event
          // Anything dropped before this turn closed is what its own ending
          // reports; only a later drop is still unaccounted for.
          // 本轮次关闭前发生的丢弃已由该轮次的结束原因自行表述，只有之后的丢弃才仍未入账。
          droppedUnrun = false
        }
        break
      }
      default:
        break
    }
  }
  return { ...end === undefined ? {} : { end }, droppedUnrun }
}
