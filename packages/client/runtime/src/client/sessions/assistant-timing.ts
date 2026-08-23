/**
 * ================================ 文件注释 ================================
 * 【文件职责】把"助手步骤"（assistant step）的计时信息（步骤开始、首个
 *   token 到达）折叠成会话节点的耗时元数据：Chat 定义与轨迹历史折叠共用。
 * 【技术维度】纯函数 fold：以 turn/step 组合为键维护一个可变 Map 索引，
 *   增量吸收 step/start 与 assistant/chunk 事件；事件流是追加式的。
 * 【产品维度】客户端 UI 展示助手回复的首字延迟与总耗时，需要从会话事件流
 *   中还原每一步的起止时刻。
 * 【逻辑维度】assistantStepKey 生成碰撞安全的键；indexAssistantStepTiming
 *   折叠事件更新索引；settledAssistantTiming 在消息完成时结算计时。
 * 【关键边界】step/start 或首 token 落在窗口外时边界为 null；首 token 只
 *   记录一次（第一次非空 token delta）；不匹配的事件类型是空操作。
 * 【新手阅读建议】先看 conversation.ts 的 AssistantTiming 类型，
 *   再看本文件三个函数的协作顺序。
 * ==========================================================================
 */
// Shared assistant step-timing fold: Chat Definitions and the Trajectory
// history fold derive AssistantTiming from the same step/start -> first token
// delta -> assistant/message sequence.
// 共享的助手步骤计时折叠：Chat 定义与轨迹历史折叠都从同一序列
// （step/start -> 首个 token delta -> assistant/message）推导 AssistantTiming。

import { isTokenDelta } from '@deepseek-ai/dsh-llm/message'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import type { AssistantTiming } from './conversation.ts'

// The first-token predicate lives beside the StreamChunk type in dsh-llm;
// re-exported here so Chat Definitions keep their client-runtime import.
// 首 token 判定谓词（isTokenDelta）定义在 dsh-llm 的 StreamChunk 类型旁；
// 在这里再导出，让 Chat 定义只需依赖 client-runtime 这一个导入来源。
export { isTokenDelta } from '@deepseek-ai/dsh-llm/message'

/** Pre-finalize timing boundaries for one assistant step (start + first token). */
/** 单个助手步骤在消息完成前的计时边界：步骤开始时刻 + 首 token 到达时刻。 */
export interface AssistantStepMetadata {
  stepStartTime: number | null
  firstTokenTime: number | null
}

/**
 * Composite map key for one assistant step.
 * @param turn - turn number from the event payload.
 * @param step - step number from the event payload.
 * @returns collision-free `turn`/`step` key (NUL separator).
 */
/**
 * 构造单个助手步骤在计时索引中的复合键。
 * @param turn 事件负载中的轮次（turn）编号。
 * @param step 事件负载中的步骤（step）编号。
 * @returns 以 NUL 分隔符拼接的 turn/step 键，避免不同 (turn, step) 组合撞键。
 */
export function assistantStepKey(turn: number, step: number): string {
  return `${turn}\u0000${step}`
}

/**
 * Fold one event into the per-step timing index: step/start opens the entry,
 * the first non-empty token delta stamps first-token time once. Other event
 * types are no-ops.
 * @param steps - the mutable per-step index, keyed by {@link assistantStepKey}.
 * @param event - the raw window event.
 */
/**
 * 把一个事件折叠进按步骤组织的计时索引：step/start 开启条目，
 * 第一个非空 token delta 只盖章一次首 token 时刻；其他事件类型是空操作。
 * @param steps 可变的按步骤索引，键由 assistantStepKey 生成。
 * @param event 原始窗口事件。
 */
export function indexAssistantStepTiming(steps: Map<string, AssistantStepMetadata>, event: SessionEvent): void {
  if (event.type === 'step/start') {
    steps.set(
      assistantStepKey(event.data.turn, event.data.step),
      { stepStartTime: event.time, firstTokenTime: null },
    )
  } else if (event.type === 'assistant/chunk' && isTokenDelta(event.data.chunk)) {
    const key = assistantStepKey(event.data.turn, event.data.step) // 定位该步骤的索引条目
    const current = steps.get(key) ?? { stepStartTime: null, firstTokenTime: null } // 取不到时按"窗口外开始"兜底
    if (current.firstTokenTime === null) {
      steps.set(key, { ...current, firstTokenTime: event.time })
    }
  }
}

/**
 * Settle one finalized assistant message's timing from its step entry; a step
 * whose start or first token fell outside the window yields null boundaries.
 * @param steps - the per-step index built by {@link indexAssistantStepTiming}.
 * @param turn - the assistant/message turn number.
 * @param step - the assistant/message step number.
 * @param completedTime - the assistant/message event timestamp (epoch ms).
 * @returns the node-ready timing record.
 */
/**
 * 从步骤索引结算一条已完成助手消息的计时：若步骤的开始或首 token 落在
 * 窗口之外，对应边界为 null。
 * @param steps indexAssistantStepTiming 构建的按步骤索引。
 * @param turn 助手消息的轮次编号。
 * @param step 助手消息的步骤编号。
 * @param completedTime 助手消息事件的完成时刻（Unix 毫秒）。
 * @returns 可直接挂到会话节点上的计时记录。
 */
export function settledAssistantTiming(
  steps: ReadonlyMap<string, AssistantStepMetadata>,
  turn: number,
  step: number,
  completedTime: number,
): AssistantTiming {
  return {
    ...(steps.get(assistantStepKey(turn, step)) ?? { stepStartTime: null, firstTokenTime: null }),
    completedTime,
  }
}
