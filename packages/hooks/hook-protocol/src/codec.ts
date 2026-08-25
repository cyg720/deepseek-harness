/**
 * Decode hook process outcomes for both dialects. Exit 0 may carry structured
 * JSON or plain stdout; exit 2 blocks with stderr as the reason; every other
 * exit is a non-blocking error. Bridges decide which recognized fields apply.
 * @module @deepseek-ai/dsh-hook-protocol/codec
 */
/*
 * 文件职责：实现Hook 线协议的 codec.ts 模块。
 * 技术维度：TypeScript、Cordis、JSON 编解码、子进程、事件匹配和严格联合类型。
 * 产品维度：保证Hook 线协议可预测地传递事件、限制循环或适配外部工具。
 * 逻辑维度：解析配置，匹配事件，执行处理器并合并输出。
 * 关键边界：线协议输入必须校验；外部 Hook 失败不得破坏会话日志或核心循环。
 * 新手阅读建议：先读 types/events，再看 codec/matcher/runner，最后阅读桥接配置。
 */

import type { HookOutput } from './types.ts'

/** The exit code a hook uses to signal a blocking error (stderr → model). */
/* 中文说明：协议局部值 BLOCKING_EXIT_CODE，由紧邻初始化决定。 */
const BLOCKING_EXIT_CODE = 2

/** Read a string field from a parsed object, or `undefined` if absent/wrong type. */
/* 中文说明：函数 str 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function str(obj: Record<string, unknown>, key: string): string | undefined {
  /** 中文说明：协议局部值 v，由紧邻初始化决定。 */
  const v = obj[key]
  return typeof v === 'string' ? v : undefined
}

/** Read a boolean field, or `undefined` if absent/wrong type. */
/* 中文说明：函数 bool 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function bool(obj: Record<string, unknown>, key: string): boolean | undefined {
  /** 中文说明：协议局部值 v，由紧邻初始化决定。 */
  const v = obj[key]
  return typeof v === 'boolean' ? v : undefined
}

/** A plain (non-null, non-array) object, or `undefined`. */
/* 中文说明：函数 obj 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function obj(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

/**
 * The legacy TOP-LEVEL `decision` is only `approve`/`block` in both reference
 * schemas — `allow`/`deny`/`ask` are reserved for `hookSpecificOutput.
 * permissionDecision`. So an out-of-band `{"decision":"deny"}` is invalid and
 * ignored here (it must not become a real blocking decision).
 */
/* 中文说明：函数 topLevelDecisionOf 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function topLevelDecisionOf(value: string | undefined): HookOutput['decision'] {
  return value === 'approve' || value === 'block' ? value : undefined
}

/** A `hookSpecificOutput.permissionDecision` is `allow`/`deny`/`ask` only. */
/* 中文说明：函数 permissionDecisionOf 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function permissionDecisionOf(value: string | undefined): HookOutput['decision'] {
  return value === 'allow' || value === 'deny' || value === 'ask' ? value : undefined
}

/**
 * Decode process output into a dialect-neutral hook outcome. This function is
 * total: malformed JSON remains plain stdout. When `expectedEventName` is set,
 * a missing or different `hookSpecificOutput.hookEventName` discards only its
 * event-scoped fields; top-level fields and the claimed discriminator remain.
 * Omitting the guard applies the block as-is.
 * @param exitCode - process exit, or `undefined` when spawn failed.
 * @param stdout - output parsed as structured JSON only on exit 0.
 * @param stderr - the captured stderr stream; becomes the blocking `reason` on exit 2.
 * @param expectedEventName - firing event used to guard hook-specific fields; omit to disable the guard.
 * @returns the dialect-neutral decoded outcome.
 */
/*
 * 中文说明：函数 parseHookOutput 的参数见签名，返回结果供相邻流程使用；示例见本文件。
 * @param exitCode 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @param stdout 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @param stderr 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @param expectedEventName 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
 */
export function parseHookOutput(exitCode: number | undefined, stdout: string, stderr: string, expectedEventName?: string): HookOutput {
  /** 中文说明：协议局部值 trimmedErr，由紧邻初始化决定。 */
  const trimmedErr = stderr.trim()
  /** 中文说明：协议局部值 trimmedOut，由紧邻初始化决定。 */
  const trimmedOut = stdout.trim()
  // Plain stdout remains available even when it is not JSON.
  /** 中文说明：协议局部值 output，由紧邻初始化决定。 */
  const output: HookOutput = { exitCode, stderr: trimmedErr, stdout: trimmedOut }

  // Both dialects treat exit 2 as a block with stderr as its reason.
  if (exitCode === BLOCKING_EXIT_CODE) {
    output.decision = 'block'
    if (trimmedErr.length > 0) output.reason = trimmedErr
  }

  // Structured stdout is valid only for a clean exit.
  if (exitCode === 0) {
    // Only attempt JSON when stdout looks like a JSON object — matches the
    // reference engines, which treat other stdout as plain text, not an error.
    if (trimmedOut.startsWith('{')) {
      /** 中文说明：协议局部值 解构结果，由紧邻初始化决定。 */
      let parsed: Record<string, unknown> | undefined
      try {
        parsed = obj(JSON.parse(trimmedOut))
      } catch {
        // Malformed JSON on a clean exit = no structured output (lenient, as the
        // reference engines are). The plain stdout remains the bridge's to use.
        parsed = undefined
      }
      if (parsed) applyStructured(output, parsed, expectedEventName)
    }
  }

  return output
}

/**
 * Fold a parsed structured-stdout object into `output` (mutates in place).
 * `expectedEventName` (the firing event) gates the per-event `hookSpecificOutput`
 * block: a block whose `hookEventName` names a different event — OR omits it — has
 * its event-scoped fields discarded (any present `hookEventName` is still recorded).
 */
/* 中文说明：函数 applyStructured 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function applyStructured(output: HookOutput, parsed: Record<string, unknown>, expectedEventName?: string): void {
  /** 中文说明：协议局部值 cont，由紧邻初始化决定。 */
  const cont = bool(parsed, 'continue')
  if (cont !== undefined) output.continue = cont
  /** 中文说明：协议局部值 stopReason，由紧邻初始化决定。 */
  const stopReason = str(parsed, 'stopReason')
  if (stopReason !== undefined) output.stopReason = stopReason
  /** 中文说明：协议局部值 sysMsg，由紧邻初始化决定。 */
  const sysMsg = str(parsed, 'systemMessage')
  if (sysMsg !== undefined) output.systemMessage = sysMsg

  // Top-level legacy `decision` (approve/block ONLY — allow/deny/ask there are
  // invalid per both schemas) + its `reason`.
  /** 中文说明：协议局部值 topDecision，由紧邻初始化决定。 */
  const topDecision = topLevelDecisionOf(str(parsed, 'decision'))
  if (topDecision !== undefined) output.decision = topDecision
  /** 中文说明：协议局部值 topReason，由紧邻初始化决定。 */
  const topReason = str(parsed, 'reason')
  if (topReason !== undefined) output.reason = topReason

  // hookSpecificOutput: the per-event channel, keyed by `hookEventName`. The
  // permissionDecision (allow/deny/ask) OVERRIDES the legacy top-level decision;
  // additionalContext and updatedInput live here too.
  /** 中文说明：协议局部值 hso，由紧邻初始化决定。 */
  const hso = obj(parsed.hookSpecificOutput)
  if (hso) {
    /** 中文说明：协议局部值 eventName，由紧邻初始化决定。 */
    const eventName = str(hso, 'hookEventName')
    // Always surface the discriminator (for the log/diagnostics), even on a
    // mismatch — the record should show what the malformed block claimed.
    if (eventName !== undefined) output.hookEventName = eventName
    // A missing or mismatched discriminator cannot affect the firing event.
    if (expectedEventName !== undefined && eventName !== expectedEventName) {
      return
    }
    /** 中文说明：协议局部值 permission，由紧邻初始化决定。 */
    const permission = permissionDecisionOf(str(hso, 'permissionDecision'))
    if (permission !== undefined) output.decision = permission
    /** 中文说明：协议局部值 permissionReason，由紧邻初始化决定。 */
    const permissionReason = str(hso, 'permissionDecisionReason')
    if (permissionReason !== undefined) output.reason = permissionReason
    /** 中文说明：协议局部值 addCtx，由紧邻初始化决定。 */
    const addCtx = str(hso, 'additionalContext')
    if (addCtx !== undefined) output.additionalContext = addCtx
    /** 中文说明：协议局部值 updated，由紧邻初始化决定。 */
    const updated = obj(hso.updatedInput)
    if (updated !== undefined) output.updatedInput = updated
  }
}
