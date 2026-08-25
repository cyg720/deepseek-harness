/*
 * ================================ 文件注释 ================================
 * 【文件职责】模型侧读取工具共享的"路径解析 + 常规文件校验"：解析路径、观察缺失、
 * 并要求目标是普通文件。
 * 【技术维度】一次 stat 完成三件事：缺失观察（fs/observed absent，供策略插件记录）、
 * 类型检查（拒绝目录/特殊文件）、携带 present 版本供守卫变更使用。
 * 【产品维度】让 read/read_image 复用同一套"先解析、再确认可读"的前置流程，
 * 保证观察态策略（先读后写）的一致性。
 * 【逻辑维度】按出现顺序：模块注释 → resolveRegularReadTarget（解析 → stat → 缺失
 * 观察与报错 → 类型检查）。
 * 【关键边界】缺失时报 FS_NOT_FOUND 并先发 absent 观察（让后续写按 createIfAbsent
 * 决策）；非普通文件报 FS_NOT_REGULAR_FILE。
 * 【新手阅读建议】跟踪一次"读不存在的文件"的调用即可理解全部行为。
 * ==========================================================================
 */
/**
 * Shared path resolution and regular-file validation for model-facing read tools.
 * @module @deepseek-ai/dsh-tool-fs/src/read-target
 */

import type { Context } from '@deepseek-ai/cordis'
import { FsError } from '@deepseek-ai/dsh-fs'
import type { FsInfo, FsTarget } from '@deepseek-ai/dsh-fs'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import { sessionResolveOptions } from './session-cwd.ts'

/**
 * Resolve a model-supplied path, observe absence, and require a regular file.
 * @param ctx - the plugin context providing filesystem resolution and observation events.
 * @param exec - the current tool execution, including session cwd and cancellation.
 * @param requestedPath - the raw path supplied to the tool.
 * @returns the resolved target and its single stat result.
 */
/*
 * 解析模型提供的路径、观察缺失、并要求目标是普通文件。
 * @param ctx 提供文件系统解析与观察事件的插件上下文。
 * @param exec 当前工具执行（含会话 cwd 与取消信号）。
 * @param requestedPath 工具收到的原始路径。
 * @returns 已解析目标与它的单次 stat 结果。
 */
export async function resolveRegularReadTarget(
  ctx: Context,
  exec: ToolExecution,
  requestedPath: string,
): Promise<{ target: FsTarget; info: FsInfo }> {
  const target = await ctx.fs.resolve(requestedPath, sessionResolveOptions(exec, requestedPath))
  const info = await ctx.fs.stat(target, exec.signal)
  // 缺失：先发 absent 观察（供策略插件记录"确认不存在"），再报 FS_NOT_FOUND。
  if (info === undefined) {
    ctx.emit('fs/observed', target, { kind: 'absent' }, exec)
    throw new FsError(`cannot read "${target.displayPath}": not found`, 'FS_NOT_FOUND')
  }
  if (info.type !== 'file') {
    throw new FsError(`cannot read "${target.displayPath}": not a regular file`, 'FS_NOT_REGULAR_FILE')
  }
  return { target, info }
}
