/**
 * ================================ 文件注释 ================================
 * 【文件职责】把后台 pwsh 进程句柄适配到通用任务（generic task）的结果词汇表，是
 * dsh-tool-bash 版后台适配的 shell 无关孪生。
 * 【技术维度】纯函数，只依赖 ShellProcess 的 status/signal/exitCode 字段；文件主体与
 * bash 版刻意镜像，故包在 jscpd:ignore 豁免区内。
 * 【产品维度】后台任务结果归一后，job_output / job_kill 等通用工具与 UI 即可统一处理
 * pwsh 后台任务。
 * 【逻辑维度】killed 保持 killed（detail 为信号名或"退出前被杀"）；其余一律 completed
 * 并以退出码为 detail。
 * 【关键边界】TODO 标记指出：当前契约把 spawn 失败伪装成无信号 kill、把运行器失败
 * 伪装成普通包装退出，需扩展 ShellProcess 才能区分基础设施失败。
 * 【新手阅读建议】对照 shell/src/types.ts 的 ShellProcessStatus 三种状态理解映射逻辑。
 * ==========================================================================
 */

/**
 * Generic-task adaptation for background pwsh process handles — the shell-agnostic
 * twin of `dsh-tool-bash`'s background adaptation.
 *
 * @module @deepseek-ai/dsh-tool-pwsh/background
 */

import type { ShellProcess } from '@deepseek-ai/dsh-shell'

/* jscpd:ignore-start -- deliberate twin of dsh-tool-bash/background.ts (Agent Note). */

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
  // infrastructure-failure outcome, then map spawn failures and
  // sandbox.runnerFailed to task `failed`. The current contract aliases a spawn
  // failure with a signal-less kill and a runner failure with an ordinary
  // wrapper exit; real nonzero command exits must remain `completed`.
  // TODO(background-infrastructure-outcome): 需要扩展 ShellProcess 以区分"基础设施失败"
  // 结局并把 spawn 失败与 sandbox.runnerFailed 映射为任务 failed；当前契约把 spawn 失败
  // 伪装成无信号 kill、把运行器失败伪装成普通包装退出；真实非零退出必须保持 completed。
  if (proc.status === 'killed') {
    return { status: 'killed', detail: proc.signal !== null ? `signal: ${proc.signal}` : 'killed before exit' }
  }
  return { status: 'completed', detail: `exit code: ${proc.exitCode ?? 0}` }
}
/* jscpd:ignore-end */
