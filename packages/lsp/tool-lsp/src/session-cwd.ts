/**
 * ================================ 文件注释 ================================
 * 【文件职责】从工具执行上下文推导 lsp 调用所解析的工作区根目录：即调用代理的会话工作区（exec.agent.session.header.cwd），与文件系统工具解析路径的方式一致。
 * 【技术维度】纯函数：只读取 ToolExecution 的可选 agent 字段；无依赖、无副作用。
 * 【产品维度】与 fs 工具不同，lsp 没有提供者回退：缺少 cwd 时调用以 LSP_WORKSPACE_REQUIRED 失败，因为本地提供者必须先规范化真实工作区才能拉起服务器。
 * 【逻辑维度】单一导出函数 sessionCwd：返回 agent 会话 cwd 或 undefined。
 * 【关键边界】非代理调用方返回 undefined；绝不在这里做默认值或路径解析（规范化在提供者侧完成）。
 * 【新手阅读建议】结合 tool-lsp/index.ts 的 execute 看 cwd 如何决定查询的 workspaceRoot。
 * ==========================================================================
 */
/**
 * Derive the workspace root an `lsp` call resolves against: the calling agent's per-session
 * workspace (`exec.agent.session.header.cwd`), mirroring how the filesystem tools resolve paths.
 * Unlike those tools, LSP has NO provider fallback — a missing cwd fails the call as
 * `LSP_WORKSPACE_REQUIRED`, because the local provider must canonicalize a real workspace before it
 * can start a server.
 * @module @deepseek-ai/dsh-tool-lsp/session-cwd
 */

import type { ToolExecution } from '@deepseek-ai/dsh-tools'

/**
 * The session workspace cwd for this call, or `undefined` when none applies.
 * @param exec - the tool-execution context; only its optional `agent` is read.
 * @returns the calling agent's session cwd, or undefined for a non-agent caller.
 */
// 本次调用的会话工作区 cwd：仅读取 exec 的可选 agent 字段；非代理调用方返回 undefined。
export function sessionCwd(exec: ToolExecution): string | undefined {
  return exec.agent?.session.header.cwd
}
