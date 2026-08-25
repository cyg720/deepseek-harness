/*
 * ================================ 文件注释 ================================
 * 【文件职责】把后台 bash 进程句柄适配到通用任务（generic task）的结果词汇表：把进程的
 * 落定状态映射为 ctx.jobs 注册所需的 { status, detail } 结构。
 * 【技术维度】纯函数，只依赖 ShellProcess 的 status/signal/exitCode 字段；与前台渲染
 * 一致，非零命令退出只"报告"而不"失败"。
 * 【产品维度】后台任务的结果归一到通用词汇后，job_output / job_kill 等通用工具与 UI
 * 就能统一处理 bash 后台任务，无需知道 bash 特有细节。
 * 【逻辑维度】killed 保持 killed（detail 为信号名或"退出前被杀"）；其余一律 completed
 * 并以退出码为 detail。
 * 【关键边界】TODO 标记指出：非受限 spawn 失败仍会伪装成无信号的 kill，真正的
 * 基础设施失败结果需要 ShellProcess 扩展后才能区分。
 * 【新手阅读建议】对照 shell/src/types.ts 里 ShellProcessStatus 的三种状态理解映射逻辑。
 * ==========================================================================
 */

/**
 * Generic-task adaptation for background bash process handles.
 *
 * @module @deepseek-ai/dsh-tool-bash/background
 */

import type { ShellProcess } from '@deepseek-ai/dsh-shell'

/**
 * Map a settled background process onto the generic task-outcome vocabulary:
 * `killed` stays `killed` (detail: the signal when one is known), everything
 * else is `completed` with the exit code as detail. A nonzero command exit is
 * reported, not failed, exactly like the foreground rendering.
 * @param proc - the settled process handle.
 * @returns the outcome for the `ctx.jobs` registration.
 */
/*
 * 把已落定的后台进程映射到通用任务结果词汇：killed 保持 killed（detail 为已知信号名），
 * 其它一律 completed 并以退出码为 detail。非零命令退出只报告而不失败，与前台渲染一致。
 * @param proc 已落定的进程句柄
 * @returns 供 ctx.jobs 注册使用的结果
 */
export function processOutcome(proc: ShellProcess): { status: 'completed' | 'killed'; detail: string } {
  // TODO(background-infrastructure-outcome): widen ShellProcess with an explicit
  // infrastructure-failure outcome, then map it to task `failed`. Restricted
  // runner failures expose sandbox.runnerFailed, but unconfined spawn failures
  // still alias a signal-less kill; real nonzero command exits must remain
  // `completed`.
  // TODO(background-infrastructure-outcome): 需要扩展 ShellProcess 以区分"基础设施失败"
  // 结局并映射为任务 failed；受限运行器失败有 sandbox.runnerFailed，但非受限 spawn 失败
  // 仍会伪装成无信号 kill；真实的非零命令退出必须保持 completed。
  if (proc.status === 'killed') {
    return { status: 'killed', detail: proc.signal !== null ? `signal: ${proc.signal}` : 'killed before exit' }
  }
  return { status: 'completed', detail: `exit code: ${proc.exitCode ?? 0}` }
}
