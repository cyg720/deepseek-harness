/** Model-visible continuation prompt for one same-session goal round. */
/**
 * 文件职责：生成同一会话下一轮目标执行所需的完整模型提示块。
 * 技术维度：使用 TypeScript 模板字符串、JSON.stringify 和 LLM ContentBlock 线协议类型。
 * 产品维度：让长期目标在多轮中持续推进，并提醒代理以当前工作区和持久状态为准完成验证。
 * 逻辑维度：把目标文本、轮次上限和固定执行要求拼成一个 goal_round XML 风格文本块。
 * 关键边界：round 应为正数；目标文本必须 JSON 转义，生成内容会进入并保留在会话历史中。
 * 新手阅读建议：先看两个参数，再按输出文本中的 Objective、Round 和执行规则三段理解。
 */

import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { GoalView } from '@deepseek-ai/dsh-goal'

/**
 * Render the complete goal-round instruction retained in session history.
 * @param goal - exact active goal revision being admitted.
 * @param round - next positive round number.
 * @returns a fresh one-block prompt for `Agent.followup()`.
 */
/**
 * 渲染完整目标续轮指令。
 * @param goal 当前获准执行的精确目标版本。
 * @param round 下一轮正整数编号。
 * @returns 供 Agent.followup 使用的新单块提示数组。
 * @example renderGoalRoundPrompt(goal, 2)。
 */
export function renderGoalRoundPrompt(goal: GoalView, round: number): ContentBlock[] {
  return [{
    type: 'text',
    text: '<goal_round>\n'
      + `Objective: ${JSON.stringify(goal.objective)}\n`
      + `Round: ${round}/${goal.maxGoalRounds}\n\n`
      + 'Continue working toward the objective in this same session. Treat the current workspace, '
      + 'tool results, and durable session state as authoritative; inspect them instead of assuming '
      + 'earlier narration is still current. Make concrete progress and verify the result. Before '
      + 'claiming completion, gather evidence that the whole objective is achieved, read the current '
      + 'goal, and mark it complete. If work remains, leave the goal active for the next round. Follow '
      + 'the configured goal-tool policy before reporting a blocker.\n'
      + '</goal_round>',
  }]
}
