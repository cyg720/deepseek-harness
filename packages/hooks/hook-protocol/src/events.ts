/**
 * Append helpers for durable, log-only hook events. They carry no surface
 * intent and must remain turn-enclosed and invoked/result paired. Mid-turn hook
 * points satisfy that boundary; SessionStart records injected context instead
 * and does not append `hook/*` outside a turn.
 * @module @deepseek-ai/dsh-hook-protocol/events
 */
/*
 * 文件职责：实现Hook 线协议的 events.ts 模块。
 * 技术维度：TypeScript、Cordis、JSON 编解码、子进程、事件匹配和严格联合类型。
 * 产品维度：保证Hook 线协议可预测地传递事件、限制循环或适配外部工具。
 * 逻辑维度：解析配置，匹配事件，执行处理器并合并输出。
 * 关键边界：线协议输入必须校验；外部 Hook 失败不得破坏会话日志或核心循环。
 * 新手阅读建议：先读 types/events，再看 codec/matcher/runner，最后阅读桥接配置。
 */

import type { Session } from '@deepseek-ai/dsh-session'
import type { HookDialect, HookOutput } from './types.ts'

/** What identifies a hook invocation across its invoked/result pair. */
/* 中文说明：类型或类 HookInvocation 约束 Hook、守卫或目标数据职责。 */
export interface HookInvocation {
  /** The open turn the invocation lives inside. */
  turn: number
  /** The hook point (`PreToolUse`, `Stop`, …). */
  point: string
  /** The bridge dialect that ran it. */
  dialect: HookDialect
  /** A stable id correlating the invoked event with its result. */
  handlerId: string
  /** The matcher-group pattern that selected it (absent for match-all). */
  matcher?: string
}

/** The decided outcome half of the pair. */
/* 中文说明：类型或类 HookResultRecord 约束 Hook、守卫或目标数据职责。 */
export interface HookResultRecord {
  turn: number
  point: string
  handlerId: string
  /**
   * The decoded outcome the run produced. {@link appendHookResult} derives the
   * durable `decision`/`exitCode`/`stderrSummary` fields from it, so the shared
   * event's semantics live here, in the lib that declares it, not per-bridge.
   */
  output: HookOutput
  /**
   * Character cap for the derived `stderrSummary`. The bound is the bridge's
   * to own (its `stderrSummaryMaxChars` config) and is passed in explicitly —
   * {@link DEFAULT_STDERR_SUMMARY_MAX_CHARS} is the reference default.
   */
  stderrSummaryMaxChars: number
  /** Wall-clock duration of the run (from `runHook`) — durable audit timing. */
  durationMs: number
}

/**
 * The reference default for {@link HookResultRecord.stderrSummaryMaxChars}
 * (both bridges' config default). It lives here, once, next to the truncation
 * rule it bounds, so the bridges cannot drift apart on the shared event's
 * default cap.
 */
/* 中文说明：协议局部值 解构结果，由紧邻初始化决定。 */
export const DEFAULT_STDERR_SUMMARY_MAX_CHARS = 500

/**
 * Truncate a hook's stderr for {@link HookResultRecord.stderrSummary}: trimmed,
 * `undefined` when empty, cut at `maxChars` with an ellipsis when over. The
 * bound is a parameter — like `runHook`'s `defaultTimeoutMs`, each bridge owns
 * the config default and passes it in.
 * @param stderr - the hook's raw captured stderr.
 * @param maxChars - the character cap for the summary (the bridge's config value).
 * @returns the trimmed, capped summary, or `undefined` when stderr is blank.
 */
/*
 * 中文说明：函数 summarizeStderr 的参数见签名，返回结果供相邻流程使用；示例见本文件。
 * @param stderr 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @param maxChars 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
 */
export function summarizeStderr(stderr: string, maxChars: number): string | undefined {
  /** 中文说明：协议局部值 t，由紧邻初始化决定。 */
  const t = stderr.trim()
  if (t.length === 0) return undefined
  return t.length > maxChars ? t.slice(0, maxChars) + '…' : t
}

/**
 * Append a `hook/invoked` event naming the handler and hook point to `session`.
 * @param session - the session whose open turn records the event.
 * @param invocation - the invocation identity; an absent `matcher` is omitted from the payload.
 */
/*
 * 中文说明：函数 appendHookInvoked 的参数见签名，返回结果供相邻流程使用；示例见本文件。
 * @param session 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @param invocation 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 */
export function appendHookInvoked(session: Session, invocation: HookInvocation): void {
  session.append('hook/invoked', {
    turn: invocation.turn,
    point: invocation.point,
    dialect: invocation.dialect,
    handlerId: invocation.handlerId,
    ...invocation.matcher !== undefined ? { matcher: invocation.matcher } : {},
  })
}

/**
 * Append the durable result paired with `hook/invoked`. The recorded decision
 * is the parsed decision, then `stop` for `continue:false`, else `pass`; stderr
 * is trimmed and capped, and an absent process exit stays omitted.
 * @param session - the session whose open turn records the event.
 * @param record - the outcome to record: the decoded output plus the summary cap and duration.
 */
/*
 * 中文说明：函数 appendHookResult 的参数见签名，返回结果供相邻流程使用；示例见本文件。
 * @param session 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @param record 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 */
export function appendHookResult(session: Session, record: HookResultRecord): void {
  /** 中文说明：协议局部值 { output }，由紧邻初始化决定。 */
  const { output } = record
  /** 中文说明：协议局部值 stderrSummary，由紧邻初始化决定。 */
  const stderrSummary = summarizeStderr(output.stderr, record.stderrSummaryMaxChars)
  session.append('hook/result', {
    turn: record.turn,
    point: record.point,
    handlerId: record.handlerId,
    decision: output.decision ?? (output.continue === false ? 'stop' : 'pass'),
    ...output.exitCode !== undefined ? { exitCode: output.exitCode } : {},
    ...stderrSummary !== undefined ? { stderrSummary } : {},
    durationMs: record.durationMs,
  })
}
