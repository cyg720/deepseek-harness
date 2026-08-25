/**
 * ================================ 文件注释 ================================
 * 【文件职责】推导文件系统工具解析相对路径时的工作目录：调用代理的"按会话工作区"
 * （exec.agent.session.header.cwd），让每个会话的 read/write/edit 都作用在"它自己的
 * 工作区"上，而不是服务器启动目录——与 dsh-tool-bash 把 bash workdir 默认成会话
 * cwd 的做法一致。
 * 【技术维度】sessionCwd 从会话头取 cwd；当 cwd 或请求路径含父级遍历段（..）时，
 * 用 canonicalPath 把 cwd 规范化（否则符号链接 cwd 的文件系统身份会被暴露）。
 * sessionResolveOptions 组装提供者所需的 { cwd, signal }（策略工作区根优先于会话 cwd）。
 * 【产品维度】多会话共享服务器进程时，文件操作天然按会话隔离工作区，互不串扰。
 * 【逻辑维度】按出现顺序：PARENT_PATH_SEGMENT（父级遍历段正则）→ sessionCwd（会话
 * cwd 推导）→ sessionResolveOptions（解析选项组装）。
 * 【关键边界】非代理调用返回 undefined，让回退留在提供者里，而不是在工具边界读
 * process.cwd()；规范化只在出现 .. 时才做（避免每次都做系统调用）。
 * 【新手阅读建议】先看 sessionCwd 的规范化条件，再看 sessionResolveOptions 的
 * 优先级（策略根 > 会话 cwd）。
 * ==========================================================================
 */
/**
 * Derive the working directory a filesystem tool resolves relative paths against: the calling
 * agent's per-session workspace (`exec.agent.session.header.cwd`), so each session's
 * `read`/`write`/`edit` act on ITS workspace, not the server's launch dir — mirroring how
 * `dsh-tool-bash` defaults a bash `workdir` to the session cwd.
 * Non-agent calls return `undefined`, leaving the fallback in the provider rather than reading
 * `process.cwd()` at the tool boundary.
 * @module @deepseek-ai/dsh-tool-fs/session-cwd
 */
/*
 * 模块总览：本文件解决"工具以哪个目录为相对路径基准"——每个会话自己的工作区。
 */

import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import { canonicalPath } from '@deepseek-ai/dsh-sandbox'

// 匹配路径中的父级遍历段（..）——首/尾/被分隔符包围的 ..。
const PARENT_PATH_SEGMENT = /(?:^|[\\/])\.\.(?:[\\/]|$)/

/**
 * The session workspace cwd for this call, or `undefined` when none applies.
 * @param exec - the tool-execution context; only its optional `agent` is read.
 * @param requestedPath - the path the provider will resolve; parent traversal
 *   makes a symlinked cwd's filesystem identity observable.
 * @returns the calling agent's session cwd, or undefined for a non-agent caller (the backend then applies its own default).
 */
/*
 * 本次调用的会话工作区 cwd；不适用时为 undefined。
 * 当 cwd 或请求路径含父级遍历段（..）时做 canonicalPath 规范化——否则符号链接 cwd
 * 的文件系统身份会被 .. 暴露。
 * @param exec 工具执行上下文；只读其可选的 agent。
 * @param requestedPath 提供者将解析的路径；父级遍历会使符号链接 cwd 的身份可被观察。
 * @returns 调用代理的会话 cwd；非代理调用返回 undefined（后端用自己的默认）。
 */
export function sessionCwd(exec: ToolExecution, requestedPath: string): string | undefined {
  const cwd = exec.agent?.session.header.cwd
  if (cwd === undefined || (!PARENT_PATH_SEGMENT.test(cwd) && !PARENT_PATH_SEGMENT.test(requestedPath))) return cwd
  return canonicalPath(cwd)
}

/**
 * Resolution options shared by all model-facing filesystem tools.
 * @param exec - the tool-execution context supplying session cwd and cancellation.
 * @param requestedPath - the path the provider will resolve.
 * @param policyWorkspaceRoot - resolved per-call root, when a mutation carries sandbox policy.
 * @returns provider resolution options for the current tool call.
 */
/*
 * 所有模型侧文件系统工具共享的解析选项。优先级：策略工作区根 > 会话 cwd；
 * 取消信号始终携带。
 * @param exec 提供会话 cwd 与取消信号的工具执行上下文。
 * @param requestedPath 提供者将解析的路径。
 * @param policyWorkspaceRoot 变更携带沙箱策略时的已解析按调用根。
 * @returns 当前工具调用的提供者解析选项。
 */
export function sessionResolveOptions(
  exec: ToolExecution,
  requestedPath: string,
  policyWorkspaceRoot?: string,
): { cwd?: string; signal?: AbortSignal } {
  const cwd = policyWorkspaceRoot ?? sessionCwd(exec, requestedPath)
  return {
    ...cwd !== undefined ? { cwd } : {},
    signal: exec.signal,
  }
}
