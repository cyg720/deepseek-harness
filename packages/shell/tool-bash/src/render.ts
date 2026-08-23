/**
 * ================================ 文件注释 ================================
 * 【文件职责】bash 工具的模型可见结果渲染：把执行器返回的结构化结果（ShellRunResult /
 * ShellProcessRead）整理成模型看到的纯文本——输出正文 + 标记分区 + 退出状态标记，
 * 并统一再导出共享的退出状态解析函数。
 * 【技术维度】纯字符串拼接，无运行时依赖；marker 文本与 dsh-shell/render.ts 的
 * parseExitStatus 构成一对"写/读"契约（渲染端写入、展示层解析回）。
 * 【产品维度】模型可读性：非零退出、超时、被信号杀死、沙箱拒绝、输出截断都以醒目的
 * 方括号标记呈现，且拒绝后可选追加"同轮升级"提示（与审批流程衔接）。
 * 【逻辑维度】streamText 追加截断通知 → renderResult 组装前台结果文本（正文 → stderr
 * 分区 → 各标记）→ renderProcessRead 组装后台增量文本（增量 + 丢失/沙箱通知）。
 * 【关键边界】退出标记必须保持在文本末尾（parseExitStatus 以行尾锚点解析）；非零退出
 * 只报告不报错（isError 仅用于基础设施故障）；空输出显示 `(no output)`。
 * 【新手阅读建议】先看 renderResult 的标记顺序（沙箱拒绝 → 超时 → 信号 → 退出码），
 * 再看 renderProcessRead 的通知组合，最后对照 dsh-shell/render.ts 的解析逻辑。
 * ==========================================================================
 */

/**
 * Model-facing result rendering for the bash tool.
 *
 * @module @deepseek-ai/dsh-tool-bash/render
 */

import type { ShellProcessRead, ShellRunResult, ShellSandboxInfo, CollectedOutput } from '@deepseek-ai/dsh-shell'
import type { SandboxMode } from '@deepseek-ai/dsh-sandbox'
import { escalationHintMarker, sandboxDenialMarker } from '@deepseek-ai/dsh-sandbox'

/** Append the truncation notice (with the full-output spill path) to a stream's text. */
/** 给流文本追加截断通知（含完整输出的 spill 文件路径）；未截断时原样返回。 */
function streamText(output: CollectedOutput): string {
  if (!output.truncated) return output.text
  return `${output.text}\n[output truncated; full output: ${output.spillPath ?? '(unavailable)'}]`
}

/**
 * Shape one finished run into the text the model sees: stdout, then a marked
 * stderr section, then exit-status markers. Non-zero exits are reported, not
 * errored — the model decides how to react; only infrastructure failures
 * (spawn errors, aborts) surface as isError results.
 * @param result - the completed foreground run from the executor.
 * @param escalationModes - the escalation targets this composition advertises;
 *   non-empty adds the same-turn escalation hint after a denial marker
 *   (default `[]`: no hint).
 * @returns the model-facing text: output body (or `(no output)`), then any timeout/signal/exit markers, each on its own line.
 */
/**
 * 把一次已完成的运行整理成模型看到的文本：先 stdout，再带标记的 stderr 分区，最后退出
 * 状态标记。非零退出只"报告"而不"报错"——由模型决定如何反应；只有基础设施故障
 * （spawn 错误、abort）才会以 isError 结果呈现。
 * @param result 执行器返回的已完成前台运行
 * @param escalationModes 该组合体宣传的升级目标；非空时在拒绝标记后追加同轮升级提示
 *   （默认 []：无提示）
 * @returns 模型可见文本：输出正文（或 `(no output)`），其后各占一行的超时/信号/退出标记
 */
export function renderResult(
  result: ShellRunResult,
  escalationModes: readonly SandboxMode[] = [],
): string {
  const out = streamText(result.stdout)
  const err = streamText(result.stderr)

  let body = out
  if (err.length > 0) {
    // Single newline between sections (stdout usually ends with one already).
    // 分区之间用单个换行（stdout 通常已以换行结尾）。
    if (body.length > 0 && !body.endsWith('\n')) body += '\n'
    body += `[stderr]\n${err}`
  }
  if (body.length === 0) body = '(no output)'

  const markers: string[] = []
  // Keep the exit marker last because parseExitStatus anchors there.
  // 退出标记必须放在最后：parseExitStatus 以它为锚点解析。
  if (result.sandbox?.denied) {
    markers.push(sandboxDenialMarker(result.sandbox.mode))
    // Hint only when the composition exposes escalation, before the final exit marker.
    // 仅当组合体暴露升级能力时提示，位置在最终退出标记之前。
    if (escalationModes.length > 0) {
      markers.push(escalationHintMarker('command'))
    }
  }
  // A command may trap SIGTERM and exit 0 after timeout; still report interruption.
  // 命令可能在超时后捕获 SIGTERM 并以 0 退出；仍要报告中断。
  if (result.timedOut) markers.push(`[timed out after ${result.timeoutMs}ms]`)
  if (result.signal !== null) {
    markers.push(`[killed by signal: ${result.signal}]`)
  } else if (result.exitCode !== 0) {
    markers.push(`[exit code: ${result.exitCode}]`)
  }
  if (markers.length === 0) return body

  if (!body.endsWith('\n')) body += '\n'
  return body + markers.join('\n')
}

/**
 * Shape one background-process read into the `job_output` delta the model
 * sees: the incremental delta, plus the lossy-read notice (with full-stream
 * spill paths) when in-memory truncation dropped unread bytes. Empty-delta
 * rendering (`(no new output)`) is the generic job controller's job.
 * @param read - one incremental read from the process handle.
 * @param sandbox - settled sandbox facts, when this was a confined process.
 * @param escalationModes - escalation targets advertised by this composition.
 * @returns the delta text with any loss or sandbox notice appended.
 */
/**
 * 把一次后台进程读取整理成模型看到的 job_output 增量：增量 delta 之外，若内存截断丢过
 * 未读字节，追加"丢失读取"通知（含完整流 spill 路径）。空增量的渲染（`(no new output)`）
 * 由通用 job 控制器负责。
 * @param read 从进程句柄取回的一次增量读取
 * @param sandbox 受限进程落定后的沙箱事实（如有）
 * @param escalationModes 该组合体宣传的升级目标
 * @returns 追加了丢失或沙箱通知后的增量文本
 */
export function renderProcessRead(
  read: ShellProcessRead,
  sandbox?: ShellSandboxInfo,
  escalationModes: readonly SandboxMode[] = [],
): string {
  const notices: string[] = []
  if (read.lossy) {
    const paths = [read.stdoutSpillPath, read.stderrSpillPath].filter((path): path is string => path !== undefined)
    notices.push(`[some output was dropped from memory; full output: ${paths.length > 0 ? paths.join(', ') : '(unavailable)'}]`)
  }
  if (sandbox?.runnerFailed) {
    notices.push(`[sandbox: the sandbox runner itself failed under ${sandbox.mode} mode — the command did not run; this is a sandbox problem, not a command failure]`)
  } else if (sandbox?.denied) {
    notices.push(sandboxDenialMarker(sandbox.mode))
    if (escalationModes.length > 0) {
      notices.push(escalationHintMarker('command'))
    }
  }
  if (notices.length === 0) return read.delta
  return `${read.delta}${read.delta.length > 0 && !read.delta.endsWith('\n') ? '\n' : ''}${notices.join('\n')}`
}

/**
 * The exit-status parse is the shared marker-contract half of the shell-tool
 * rendering story, owned by `@deepseek-ai/dsh-shell` so `dsh-tool-pwsh` reuses
 * it (its renderer emits the same markers). Re-exported here to keep
 * `../src/render.ts` a single import root for bash-tool consumers.
 */
/**
 * 退出状态解析是 shell 工具渲染故事的"共享标记契约"一半，由 dsh-shell 拥有，
 * 这样 dsh-tool-pwsh 也能复用（其渲染器发出同样的标记）。此处再导出，让 bash 工具
 * 消费者以本文件为单一导入根。
 */
export { parseExitStatus, type ParsedExitStatus } from '@deepseek-ai/dsh-shell'
