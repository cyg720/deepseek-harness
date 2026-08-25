/**
 * Execute command hooks through `ctx.shell`, using its credential scrub,
 * process-group cancellation, and timeout machinery. The bridge supplies the
 * trusted stdin payload and dialect environment, then this module decodes the
 * captured outcome.
 * @module @deepseek-ai/dsh-hook-protocol/runner
 */
/*
 * 文件职责：实现Hook 线协议的 runner.ts 模块。
 * 技术维度：TypeScript、Cordis、JSON 编解码、子进程、事件匹配和严格联合类型。
 * 产品维度：保证Hook 线协议可预测地传递事件、限制循环或适配外部工具。
 * 逻辑维度：解析配置，匹配事件，执行处理器并合并输出。
 * 关键边界：线协议输入必须校验；外部 Hook 失败不得破坏会话日志或核心循环。
 * 新手阅读建议：先读 types/events，再看 codec/matcher/runner，最后阅读桥接配置。
 */

import type { ShellExecutor } from '@deepseek-ai/dsh-shell'
import { parseHookOutput } from './codec.ts'
import type { CommandHook, HookOutput } from './types.ts'

/**
 * The reference default per-hook timeout, in ms (10 minutes) — the value both
 * Claude Code and Codex apply to a hook whose config sets no `timeout`. It
 * lives here, once, as the protocol's default; the bridges' `defaultTimeoutMs`
 * config defaults to it, and a per-hook {@link CommandHook.timeoutSec} is the
 * override API.
 */
/* 中文说明：协议局部值 DEFAULT_HOOK_TIMEOUT_MS，由紧邻初始化决定。 */
export const DEFAULT_HOOK_TIMEOUT_MS = 600_000

/** Everything a single hook invocation needs beyond its command line. */
/* 中文说明：类型或类 RunHookOptions 约束 Hook、守卫或目标数据职责。 */
export interface RunHookOptions {
  /** The JSON payload object written to the hook's stdin (the bridge builds it). */
  payload: unknown
  /** Extra env vars for the hook process (`CLAUDE_PROJECT_DIR`, …); the bridge builds these. */
  env?: Record<string, string>
  /** Working directory for the hook (defaults to the executor's own default when omitted). */
  cwd?: string
  /** Explicit owning-operation signal; firing it cancels the hook run. */
  readonly signal: AbortSignal
  /** Whether to append a trailing newline to the stdin payload (CC yes, Codex no). */
  trailingNewline: boolean
  /**
   * Timeout applied when the hook's config sets no `timeout` of its own. The
   * bridge owns the default (its `defaultTimeoutMs` config, reference default
   * {@link DEFAULT_HOOK_TIMEOUT_MS}) and passes it in explicitly.
   */
  defaultTimeoutMs: number
  /**
   * The event this hook is firing for (e.g. `'PreToolUse'`). When set, a
   * structured `hookSpecificOutput` block whose `hookEventName` names a DIFFERENT
   * event is treated as malformed and its event-scoped fields are discarded (see
   * {@link parseHookOutput}). Omit it to apply any block as-is.
   */
  expectedEventName?: string
}

/** The {@link HookOutput} plus the wall-clock duration of the run (for `hook/result`). */
/* 中文说明：类型或类 RunHookResult 约束 Hook、守卫或目标数据职责。 */
export interface RunHookResult {
  output: HookOutput
  /** Wall-clock duration of the run, from `now` — durable on the `hook/result` event. */
  durationMs: number
}

/**
 * Run `hook` with serialized stdin and decode its outcome. A hook-specific
 * timeout in seconds overrides the default; trusted environment entries merge
 * after the executor scrub. Infrastructure rejection becomes an outcome with
 * no exit code, so this function never throws or crashes the calling turn.
 * @param bash - The executor service the command runs through.
 * @param hook - the configured command; its `timeoutSec` (wire unit: seconds) overrides the default timeout.
 * @param options - the invocation's payload, env, cwd, signal, stdin framing, and default timeout.
 * @param now - millisecond clock used for the reported duration.
 * @returns the decoded output plus the run's wall-clock duration.
 */
/*
 * 中文说明：函数 runHook 的参数见签名，返回结果供相邻流程使用；示例见本文件。
 * @param bash 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @param hook 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @param options 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @param now 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
 */
export async function runHook(
  bash: ShellExecutor,
  hook: CommandHook,
  options: RunHookOptions,
  now: () => number,
): Promise<RunHookResult> {
  /** 中文说明：协议局部值 started，由紧邻初始化决定。 */
  const started = now()
  /** 中文说明：协议局部值 timeoutMs，由紧邻初始化决定。 */
  const timeoutMs = hook.timeoutSec !== undefined ? hook.timeoutSec * 1000 : options.defaultTimeoutMs
  /** 中文说明：协议局部值 stdin，由紧邻初始化决定。 */
  const stdin = JSON.stringify(options.payload) + (options.trailingNewline ? '\n' : '')

  /** 中文说明：协议局部值 request，由紧邻初始化决定。 */
  const request = {
    command: hook.command,
    timeoutMs,
    stdin,
    signal: options.signal,
    ...options.cwd !== undefined ? { workdir: options.cwd } : {},
    ...options.env !== undefined ? { env: options.env } : {},
  }

  try {
    /** 中文说明：协议局部值 result，由紧邻初始化决定。 */
    const result = await bash.run(bash.resolve(request))
    // ShellRunResult.exitCode is `number | null` (null = died by signal); the
    // protocol's exit-code contract is numeric, so a signal death maps to
    // `undefined` (a non-blocking error — no clean exit code to act on).
    /** 中文说明：协议局部值 exitCode，由紧邻初始化决定。 */
    const exitCode = result.exitCode ?? undefined
    return {
      output: parseHookOutput(exitCode, result.stdout.text, result.stderr.text, options.expectedEventName),
      durationMs: now() - started,
    }
  } catch (error: unknown) {
    // The executor rejects only on infrastructure faults (unusable workdir,
    // missing shell). A hook that cannot run is a non-blocking error: no exit
    // code, the failure on stderr for the record. The turn proceeds.
    /** 中文说明：协议局部值 message，由紧邻初始化决定。 */
    const message = error instanceof Error ? error.message : String(error)
    return {
      output: parseHookOutput(undefined, '', message),
      durationMs: now() - started,
    }
  }
}
