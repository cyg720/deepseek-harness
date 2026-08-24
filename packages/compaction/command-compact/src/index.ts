/**
 * Human-facing `/compact` command over the backend-independent compaction seam.
 * @module @deepseek-ai/dsh-command-compact
 */
/**
 * 文件职责：实现上下文压缩的 index 模块。
 * 技术维度：TypeScript、Cordis 插件、Worker/JSON 协议和严格类型。
 * 产品维度：为产品提供上下文压缩能力。
 * 逻辑维度：解析配置或协议，执行核心流程并返回结构化结果。
 * 关键边界：跨线程和模型输入属于不可信边界；资源与事件注册必须清理。
 * 新手阅读建议：先读导出类型与配置，再跟踪入口和错误分支。
 */

import type { Context } from '@deepseek-ai/cordis'
import { ManualCompactionError } from '@deepseek-ai/dsh-compaction'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'

/** 中文说明：运行时局部值 name，由紧邻初始化决定。 */
export const name = 'command-compact'
/** 中文说明：运行时局部值 inject，由紧邻初始化决定。 */
export const inject = ['commands', 'compaction']

/** 中文说明：运行时局部值 USAGE，由紧邻初始化决定。 */
const USAGE = 'Usage: /compact (no arguments)'

/** Fail loudly if a locally closed union gains an unhandled member. */
/* v8 ignore start -- closed-union backstop is unreachable without violating the TypeScript contract */
/** 中文说明：函数 assertNever 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function assertNever(value: never): never {
  throw new TypeError(`unknown manual compaction error code: ${String(value)}`)
}
/* v8 ignore stop */

/** Convert expected capability failures into concise human-only outcomes. */
/** 中文说明：函数 expectedFailure 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function expectedFailure(error: ManualCompactionError): CommandResult {
  switch (error.code) {
    case 'busy':
      return {
        kind: 'error',
        text: 'Compaction is unavailable because this process has an active compaction, or the agent is not idle.',
      }
    case 'cancelled':
      return { kind: 'error', text: 'Compaction cancelled.' }
    case 'changed':
      return {
        kind: 'error',
        text: 'The history selected for compaction changed before it could be replaced. The conversation is unchanged; the attempt is recorded in the session log.',
      }
    case 'summary':
      return {
        kind: 'error',
        text: 'Compaction could not produce a useful summary. The conversation is unchanged; the attempt is recorded in the session log.',
      }
    case 'commit':
      return {
        kind: 'error',
        text: 'Compaction did not finish cleanly; some session history may have changed. Inspect the current session state before retrying.',
      }
    case 'persistence':
      return {
        kind: 'error',
        text: 'Compaction finished, but the session could not be saved.',
      }
    /* v8 ignore next 2 -- ManualCompactionErrorCode is closed and every member is handled above */
    default: return assertNever(error.code)
  }
}

/** Execute one argument-free manual compaction request. */
/** 中文说明：函数 executeCompact 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
async function executeCompact(
  ctx: Context,
  invocation: CommandInvocation,
): Promise<CommandResult> {
  if (invocation.rawInput.trim().length > 0) {
    return { kind: 'error', text: USAGE }
  }
  try {
    /** 中文说明：运行时局部值 result，由紧邻初始化决定。 */
    const result = await ctx.compaction.compactNow(invocation.agent, invocation.signal, invocation.commandId)
    if (result === null) return { kind: 'success', text: 'No compactable history yet.' }
    return {
      kind: 'success',
      text: `Compacted ${result.shadowedSeqs.length} history items (~${result.shadowedTokenCount} tokens).`,
      sourceEventSeq: result.summarySeq,
    }
  } catch (error: unknown) {
    if (invocation.signal.aborted) return { kind: 'error', text: 'Compaction cancelled.' }
    if (error instanceof ManualCompactionError) return expectedFailure(error)
    throw error
  }
}

/**
 * Register `/compact` for every composed human-command adapter.
 * @param ctx - context carrying the command registry and the compaction seam.
 */
/** 中文说明：函数 apply 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
export function apply(ctx: Context): void {
  /** 中文说明：运行时局部值 active，由紧邻初始化决定。 */
  const active = new Set<Promise<CommandResult>>()
  /** 中文说明：运行时局部值 handler，由紧邻初始化决定。 */
  const handler = (invocation: CommandInvocation): Promise<CommandResult> => {
    /** 中文说明：运行时局部值 operation，由紧邻初始化决定。 */
    const operation = executeCompact(ctx, invocation)
    active.add(operation)
    /** 中文说明：运行时局部值 retire，由紧邻初始化决定。 */
    const retire = (): void => { active.delete(operation) }
    // Both branches retire without rethrowing, so the derived observer promise
    // cannot become an unhandled mirror of an expected handler rejection.
    void operation.then(retire, retire)
    return operation
  }

  ctx.effect(function* () {
    // Yield drain before registration: composite teardown is LIFO, so no new
    // invocation can enter while already-started handler promises quiesce.
    yield async () => { await Promise.allSettled(active) }
    yield ctx.commands.register({
      name: 'compact',
      description: 'Compact older conversation history',
      handler,
    })
  }, 'command-compact lifecycle')
}
