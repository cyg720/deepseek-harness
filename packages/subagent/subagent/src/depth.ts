/**
 * ================================ 文件注释 ================================
 * 【文件职责】委派深度（delegation depth）记账：父代理传给子代理的递归预算。
 *   负责读取某个 agent 的深度、校验子代理的最大深度上限参数。
 * 【技术维度】通过声明合并给 AgentOptions 增加可选 subagentDepth 字段；
 *   会话 header 的 delegationDepth 是权威且单调的底数，运行时选项只能加深不能降低。
 * 【产品维度】防止无限递归委托（子代理再派子代理……），给每个子代理一个可配置的深度上限，
 *   超限时在委托发生前报错。
 * 【逻辑维度】按代码顺序：声明合并 → delegationDepthOf（读深度，取 header 与运行时选项的较大值）
 *   → assertSubagentMaxDepth（校验 maxDepth 是合法的非负安全整数）。
 * 【关键边界】深度是安全整数（SafeInteger），负数与 -0 都被拒绝；恢复（resume）时深度
 *   只读持久化 header，避免被当成顶级 agent 重新计算。
 * 【新手阅读建议】先看 delegationDepthOf 中 Math.max 的取法，理解"持久化底数 + 运行时加深"。
 * ==========================================================================
 */

/**
 * Delegation-depth accounting: the recursion budget a parent passes to its
 * children. Kept apart from the service so composition helpers can read it
 * without importing the registry.
 *
 * @module @deepseek-ai/dsh-subagent/depth
 */

import type { Agent } from '@deepseek-ai/dsh-agent'

// 中文：声明合并：给 AgentOptions 增加可选 subagentDepth 字段，让每个 agent 可携带委派深度。
declare module '@deepseek-ai/dsh-agent' {
  interface AgentOptions {
    /** Delegation depth: zero for a top-level agent and parent depth + 1 for a child. */
    subagentDepth?: number
  }
}

/**
 * Read an agent's delegation depth, treating absence as top-level depth zero.
 * The persisted session header is authoritative and monotone: runtime
 * `AgentOptions.subagentDepth` may DEEPEN the count but can never lower it —
 * a resumed child arrives with fresh options, and counting it from zero would
 * let it delegate as if it were top-level.
 * @param agent - the agent whose header and options carry the depth.
 * @returns its non-negative safe-integer depth.
 * @throws if the runtime `AgentOptions.subagentDepth` is not a non-negative safe integer.
 */
// 中文：读取某个 agent 的委派深度。持久化 header 的 delegationDepth 是权威底数，
// 运行时选项 subagentDepth 只能加深不能降低（恢复的子代理带着全新选项，若从零算
// 就会被当成顶级 agent 而获得无限委托权）。
export function delegationDepthOf(agent: Agent): number {
  const runtime = agent.options.subagentDepth
  if (runtime !== undefined && (!Number.isSafeInteger(runtime) || runtime < 0 || Object.is(runtime, -0))) {
    throw new TypeError('agent subagentDepth must be a non-negative safe integer')
  }
  // The header value was validated at the session boundary (creation and
  // persistence load both construct through the store).
  return Math.max(agent.session.header.delegationDepth ?? 0, runtime ?? 0)
}

/**
 * Reject a recursion cap that cannot represent an exact delegation depth.
 * @param maxDepth - the optional runtime value to validate.
 */
// 中文：校验可选的 maxDepth 参数：必须是"非负安全整数"（排除 NaN、小数、负数、-0），
// 否则抛 TypeError；undefined 表示不设上限，直接通过。
export function assertSubagentMaxDepth(maxDepth: unknown): void {
  if (maxDepth !== undefined && (
    typeof maxDepth !== 'number'
    || !Number.isSafeInteger(maxDepth)
    || maxDepth < 0
    || Object.is(maxDepth, -0)
  )) {
    throw new TypeError('subagent maxDepth must be a non-negative safe integer')
  }
}
