/** Shared top-level-call post-policy selection for search result spill. @module dsh-tool-fs-search/direct-call */

/*
 * ================================ 文件注释 ================================
 * 【文件职责】glob/grep 两个搜索工具共享的"顶级调用后策略选择"：判断这次搜索结果
 * 是否仍是"本工具拥有的直接成功顶级调用"，只有满足时才会把完整结果保存为 spill。
 * 【技术维度】acceptedDirectCallValue 检查下游决策的形态：决策必须仍是 accept、没有
 * 替换 content 或 value、调用无父级（顶级）、工具名一致、结果非错误、且注册表中
 * 当前作用域拥有者仍是本工具——任一不满足即返回 undefined（推迟 spill）。
 * 【产品维度】防止"下游策略插件已改写结果"时把旧内容存进 spill 文件，保证恢复
 * 文件与实际展示一致。
 * 【逻辑维度】按出现顺序：模块注释 → acceptedDirectCallValue（条件判定）。
 * 【关键边界】这是一个"要么全条件成立要么放弃"的守卫：任何一条不满足都不保存。
 * 【新手阅读建议】逐个条件读一遍即可理解"什么情况下才保存完整结果"。
 * ==========================================================================
 */

import type { Context } from '@deepseek-ai/cordis'
import type { PostToolDecision, ToolDefinition, ToolExecution, ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'

/**
 * Return the accepted canonical value only when this tool still owns a direct
 * successful top-level call and no downstream policy replaced either projection.
 * @param ctx - the tool plugin context used to resolve the live scoped owner.
 * @param tool - the exact registered definition whose value may be projected.
 * @param exec - the completed execution identity.
 * @param result - the canonical result before post-policy decisions are applied.
 * @param decision - the composed downstream post-policy decision.
 * @returns the canonical value to project, or `undefined` when spill must defer.
 */
export function acceptedDirectCallValue(
  ctx: Context,
  tool: ToolDefinition,
  exec: ToolExecution,
  result: ToolExecutionResult,
  decision: PostToolDecision,
): JsonValue | undefined {
  if (decision.kind !== 'accept' || decision.content !== undefined || Object.hasOwn(decision, 'value')
    || exec.parent !== undefined || exec.name !== tool.name || result.isError
    || ctx.tools.get(exec.name, exec.agent) !== tool) return undefined
  return result.value
}
