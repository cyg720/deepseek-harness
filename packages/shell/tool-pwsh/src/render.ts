/*
 * ================================ 文件注释 ================================
 * 【文件职责】pwsh 工具的模型可见结果渲染：把结构化结果（前台结果 / 后台增量读取）
 * 整理成模型看到的纯文本——stdout、带标记的 stderr 分区、沙箱拒绝/运行器失败标记
 * （含同轮升级提示）、截断通知与 spill 路径，最后是退出状态标记。
 * 【技术维度】纯字符串拼接，无运行时依赖；是 bash 工具渲染器的 PowerShell 孪生
 * （刻意镜像，包在 jscpd:ignore 豁免区内）；marker 文本与 dsh-shell 的
 * parseExitStatus 构成写/读契约。
 * 【产品维度】模型可读性：干净退出（0 且无信号）不产生任何标记；非零退出只报告
 * 不报错；截断/拒绝/运行器故障都给出可行动的提示文本。
 * 【逻辑维度】streamText 追加截断通知 → renderPwshResult 组装前台结果文本 →
 * renderPwshProcessRead 组装后台增量文本。
 * 【关键边界】退出标记必须保持在文本末尾（parseExitStatus 以行尾锚点解析）；
 * 空输出显示 `(no output)`；后台渲染不处理空增量（那是通用 job 控制器的职责）。
 * 【新手阅读建议】与 dsh-tool-bash/render.ts 对照阅读，找差异（函数名与输入形状
 * RenderablePwshResult 不同，逻辑一致）。
 * ==========================================================================
 */

/**
 * Model-facing result rendering for the pwsh tool — the PowerShell twin of
 * `dsh-tool-bash`'s renderer: stdout, a marked stderr section, sandbox
 * denial/runner-failure markers (with the same-turn escalation hint), and
 * truncation notices with spill paths, then exit-status markers. Non-zero
 * exits are reported, not errored — the model decides how to react; only
 * infrastructure failures (spawn errors, aborts) surface as isError
 * results.
 *
 * @module @deepseek-ai/dsh-tool-pwsh/render
 */

import type { ShellProcessRead, ShellSandboxInfo, CollectedOutput } from '@deepseek-ai/dsh-shell'
import type { SandboxMode } from '@deepseek-ai/dsh-sandbox'
import { escalationHintMarker, sandboxDenialMarker } from '@deepseek-ai/dsh-sandbox'

/* jscpd:ignore-start -- deliberate twin of dsh-tool-bash/render.ts (Agent Note). */

/** Append the truncation notice (with the full-output spill path) to a stream's text. */
/* 给流文本追加截断通知（含完整输出的 spill 文件路径）；未截断时原样返回。 */
function streamText(output: CollectedOutput): string {
  if (!output.truncated) return output.text
  return `${output.text}\n[output truncated; full output: ${output.spillPath ?? '(unavailable)'}]`
}

/** The renderable foreground result shape (the schema-derived value, no `kind`). */
/* 可渲染的前台结果形状（来自输出 schema 的值，不含 kind 字段）。 */
export interface RenderablePwshResult {
  exitCode: number | null
  signal: string | null
  timedOut: boolean
  timeoutMs: number
  stdout: CollectedOutput
  stderr: CollectedOutput
  sandbox?: ShellSandboxInfo
}

/**
 * Shape one finished run into the text the model sees: stdout, then a marked
 * stderr section, then exit-status markers, matching the bash tool's story —
 * a clean exit (0, no signal) produces no marker.
 * @param result - the completed foreground run from the executor.
 * @param escalationModes - the escalation targets this composition advertises;
 *   non-empty adds the same-turn escalation hint after a denial marker
 *   (default `[]`: no hint).
 * @returns the model-facing text: output body (or `(no output)`), then any timeout/signal/exit markers, each on its own line.
 */
/*
 * 把一次已完成的运行整理成模型看到的文本：stdout、带标记的 stderr 分区、退出状态标记，
 * 与 bash 工具的故事一致——干净退出（0 且无信号）不产生任何标记。
 * @param result 执行器返回的已完成前台运行
 * @param escalationModes 该组合体宣传的升级目标；非空时在拒绝标记后追加同轮升级提示
 *   （默认 []：无提示）
 * @returns 模型可见文本：输出正文（或 `(no output)`），其后各占一行的超时/信号/退出标记
 */
export function renderPwshResult(
  result: RenderablePwshResult,
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
  // A command may trap the termination and exit 0 after timeout; still report interruption.
  // 命令可能在超时后捕获终止信号并以 0 退出；仍要报告中断。
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
 * spill paths) when in-memory truncation dropped unread bytes.
 * @param read - one incremental read from the process handle.
 * @param sandbox - settled sandbox facts, when this was a confined process.
 * @param escalationModes - escalation targets advertised by this composition.
 * @returns the delta text with any loss or sandbox notice appended.
 */
/*
 * 把一次后台进程读取整理成模型看到的 job_output 增量：增量 delta 之外，若内存截断丢过
 * 未读字节，追加"丢失读取"通知（含完整流 spill 路径）。
 * @param read 从进程句柄取回的一次增量读取
 * @param sandbox 受限进程落定后的沙箱事实（如有）
 * @param escalationModes 该组合体宣传的升级目标
 * @returns 追加了丢失或沙箱通知后的增量文本
 */
export function renderPwshProcessRead(
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
/* jscpd:ignore-end */
