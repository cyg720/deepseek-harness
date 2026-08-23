/**
 * ================================ 文件注释 ================================
 * 【文件职责】定义"子代理最终助手输出"的唯一选择规则：取最后一条非空 assistant 消息；
 *   没有则取累计的文本流；再没有则为空。后端运行结果与 subagent/end 事件都套用同一规则。
 * 【技术维度】AssistantOutputFold 类按事件流增量折叠，支持流式推送；finalAssistantOutput
 *   一次性对整个事件后缀应用规则。空内容消息（仅用量记录）不覆盖更早的输出。
 * 【产品维度】保证无论子代理以什么方式结束（正常/超限/失败/取消），父代理拿到的"最终回答"
 *   都是同一套可预期的选择结果，避免空消息吞掉有效输出。
 * 【逻辑维度】按代码顺序：AssistantOutputFold（push/pushText/collect 三个增量接口）→
 *   finalAssistantOutput（对事件数组整体折叠的便捷函数）。
 * 【关键边界】选择与停止原因（stopReason）无关；文本流回退仅在无任何非空消息时生效。
 * 【新手阅读建议】关注 collect() 的三级选择逻辑，这是整个文件的核心规则。
 * ==========================================================================
 */

/**
 * Canonical selection of a child's final assistant output. Backend run results
 * and `subagent/end.lastAssistantMessage` apply the same rule: select the last
 * non-empty assistant message. An empty-content message records usage only
 * when the loop appends it after a max-tokens step with no executable blocks,
 * so it does not replace earlier output. If no non-empty message exists,
 * select the accumulated assistant text. Selection is independent of the
 * run's stop reason.
 *
 * @module @deepseek-ai/dsh-subagent/assistant-output
 */

import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

/**
 * Incremental fold of the selection rule, for backends that observe a child's
 * output as it streams: session-event backends {@link push} each event, and
 * transports without session events (ACP content chunks) {@link pushText} raw
 * text into the same streamed fallback.
 */
// 中文：增量折叠"最终助手输出"选择规则的类：push() 喂会话事件、pushText() 喂无事件的
// 文本流、collect() 给出当前选定的最终输出，供流式观察子代理输出的后端复用同一规则。
export class AssistantOutputFold {
  // 中文：当前选定的"最后一条非空 assistant 消息"候选；为空表示还没有这样的消息。
  private message: ContentBlock[] | undefined
  // 中文：文本流回退：以 text-delta 累积的文本片段，仅在没有非空消息时兜底使用。
  private partial: string[] = []

  /**
   * Fold one session event: a non-empty assistant message becomes the
   * candidate final answer, and a `text-delta` chunk extends the streamed
   * fallback; every other event contributes nothing.
   * @param event - the next observed session event.
   */
  // 中文：喂入一条会话事件：非空 assistant 消息成为最终答案候选，text-delta 块扩展
  // 流式回退文本，其余事件不产生任何贡献。
  push(event: SessionEvent): void {
    if (event.type === 'assistant/message') {
      const content = event.data.message.content
      if (content.length > 0) this.message = content
    } else if (event.type === 'assistant/chunk' && event.data.chunk.type === 'text-delta') {
      this.pushText(event.data.chunk.text)
    }
  }

  /**
   * Extend the streamed fallback with text observed outside session events.
   * @param text - the next streamed text piece (an empty piece is a no-op).
   */
  // 中文：把会话事件之外的流式文本追加进回退候选（空片段是 no-op）。
  pushText(text: string): void {
    if (text.length > 0) this.partial.push(text)
  }

  /**
   * Select the final output folded so far.
   * @returns the last non-empty assistant message, else the accumulated
   *   streamed text, or `undefined` when the child produced neither.
   */
  // 中文：汇总当前折叠结果：优先返回最后一条非空 assistant 消息；没有则把累计文本
  // 拼成一条 text 块；两者都没有时返回 undefined。
  collect(): ContentBlock[] | undefined {
    if (this.message !== undefined) return this.message
    const text = this.partial.join('')
    return text.length > 0 ? [{ type: 'text', text }] : undefined
  }
}

/**
 * Apply the selection rule to one complete child-owned event suffix.
 * @param events - the child-owned events (after any seed or epoch boundary).
 * @returns the selected output, or `undefined` when the child produced none.
 */
// 中文：对完整事件后缀一次性应用选择规则：新建折叠器逐事件喂入后汇总。注释里的 TODO
// 提示：若某条长续聊 epoch 的结算成为热点，可改为从后向前扫描以提前退出。
export function finalAssistantOutput(events: readonly SessionEvent[]): ContentBlock[] | undefined {
  // TODO: this folds the complete suffix once per run/epoch settlement. If a
  // long continuable epoch ever profiles hot here, scan backward with early
  // exit for the last non-empty message and fold text deltas only on the
  // no-message fallback.
  const fold = new AssistantOutputFold()
  for (const event of events) fold.push(event)
  return fold.collect()
}
