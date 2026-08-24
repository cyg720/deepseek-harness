/** Model-visible wrap-up instruction for a terminal autonomous goal update. */
/**
 * 中文说明：
 * - 文件职责：生成自治目标完成或阻塞后注入模型的最终回复指令。
 * - 技术维度：使用 TypeScript 字符串模板、条件分支、JSON 转义和 LLM ContentBlock。
 * - 产品维度：确保长时目标结束前仍向用户说明结果、证据、阻塞原因或后续动作。
 * - 逻辑维度：固定事实约束，写入目标标题，再按 complete/blocked 组装不同标签和回复要求。
 * - 关键边界：blockedReason 省略即视为完成；文本明确禁止结束轮继续调用工具或虚构细节。
 * - 新手阅读建议：先看 GROUNDING 的共同约束，再比较两个分支要求用户看到的信息差异。
 */

import type { ContentBlock } from '@deepseek-ai/dsh-llm'

/** 两种结束状态共用的事实约束，要求只报告会话已有证据。 */
const GROUNDING =
  'Report only what earlier rounds and tool results in this session actually establish; '
  + 'when a detail is not in the session, say so instead of inventing it. '

/**
 * Render the closing-message instruction injected after an autonomous goal
 * round reports `complete` or `blocked`, replacing the former hard turn stop
 * so the model still addresses the user once before the turn ends.
 * @param objective - the terminal goal's objective, echoed for grounding.
 * @param blockedReason - the validated report for `blocked`; omitted for `complete`.
 * @returns a fresh one-block context for `ToolRunContext.deferContext()`.
 */
/** 中文：生成结束上下文；objective 必填，blockedReason 存在时生成阻塞分支，返回新的单文本块数组。 */
export function renderWrapupContext(objective: string, blockedReason?: string): ContentBlock[] {
  /** JSON 转义后的目标标题行，防止目标文本破坏标签结构。 */
  const heading = `Objective: ${JSON.stringify(objective)}\n`
  /** 根据是否提供阻塞原因生成的完整模型指令文本。 */
  const text = blockedReason === undefined
    ? '<goal_complete>\n'
      + heading
      + 'The goal is marked complete and this autonomous run is ending. Write the closing '
      + 'message to the user now: state the outcome, summarize what was done and how it was '
      + 'verified, and point to the concrete results (files, commits, or other artifacts). '
      + GROUNDING
      + 'Note anything the user should review or do next. Address the user directly. Do not '
      + "call any more tools in this run; further work waits for the user's next instruction.\n"
      + '</goal_complete>'
    : '<goal_blocked>\n'
      + heading
      + `Blocked: ${JSON.stringify(blockedReason)}\n`
      + 'The goal is marked blocked and this autonomous run is ending. Write the closing '
      + 'message to the user now: state what has been completed so far, describe the concrete '
      + 'blocking condition and what you tried, and say exactly what you need from the user to '
      + 'continue. '
      + GROUNDING
      + 'Address the user directly. Do not call any more tools in this run; further work '
      + "waits for the user's next instruction.\n"
      + '</goal_blocked>'
  return [{ type: 'text', text }]
}
