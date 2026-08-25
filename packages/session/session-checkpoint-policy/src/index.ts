/*
 * ================================ 文件注释 ================================
 * 【文件职责】语义耐久检查点策略：在模型请求、顶层工具分发与已完成的 agent 步骤
 *   边界上把日志先冲刷（flush）到持久层，再放行下游动作。
 * 【技术维度】Cordis 监听（llm/stream 瀑布、tools/execute 瀑布、agent/pre-step）；
 *   afterCheckpoint 用异步生成器延迟构造下游流，直到请求前缀持久化。
 * 【产品维度】模型/工具副作用前的 fail-closed 持久化：崩溃后日志不会"先有动作后无记录"。
 * 【逻辑维度】按代码顺序：name/inject → afterCheckpoint → abortedBeforeDispatchResult → apply。
 * 【关键边界】嵌套工具分发复用持久化的外层调用（parent 存在时不重复 flush）；
 *   检查点失败即拒绝下游调用（fail-closed）。
 * 【新手阅读建议】对照三个监听点理解"何时必须落盘"。
 * ==========================================================================
 */

/**
 * Semantic durability checkpoints for model requests, top-level tool dispatch,
 * and completed agent steps.
 * @module @deepseek-ai/dsh-session-checkpoint-policy
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import { TOOL_ABORTED_BEFORE_DISPATCH, type ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import type { PreStepDecision } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-session-persistence'

/** Cordis plugin name used by Loader diagnostics. */
export const name = 'session-checkpoint-policy'

/** Services whose request, tool, session, and persistence boundaries this policy joins. */
export const inject = ['llm', 'sessionPersistence', 'sessions', 'tools']

/**
 * Delay construction of the downstream model stream until the complete logged
 * request prefix is durable. A checkpoint rejection prevents adapter dispatch.
 *
 * @param ctx - plugin context that owns the session store.
 * @param session - live session named by the model request.
 * @param next - downstream `llm/stream` chain.
 * @returns a stream that checkpoints before requesting its first chunk.
 */
// 中文：生成一个"先冲刷日志再取下游流"的包装流：请求前缀持久化完成前不触发下游
// 适配器分发；检查点拒绝即阻止分发（fail-closed）。
function afterCheckpoint(
  ctx: Context,
  session: Session,
  next: () => AsyncIterable<StreamChunk>,
): AsyncIterable<StreamChunk> {
  return (async function* (): AsyncIterable<StreamChunk> {
    await ctx.sessions.flush(session)
    yield* next()
  })()
}

/** Materialize the canonical result for a call cancelled before tool dispatch. */
function abortedBeforeDispatchResult(): ToolExecutionResult {
  return {
    content: [{ type: 'text', text: 'Error: tool call aborted before dispatch' }],
    isError: true,
    error: {
      message: 'tool call aborted before dispatch',
      info: { name: 'AbortError', code: TOOL_ABORTED_BEFORE_DISPATCH },
    },
  }
}

/**
 * Install semantic checkpoint listeners. Loop-built model calls checkpoint the
 * logged request before adapter dispatch; top-level tool calls checkpoint their
 * recorded call before the tool body; the next request boundary checkpoints
 * the preceding response/result batch. Nested tool dispatches reuse the durable outer call.
 *
 * Checkpoint failures are fail-closed at the model and tool side-effect
 * boundaries: the downstream adapter or tool body is not invoked.
 *
 * @param ctx - plugin context that owns the listeners.
 */
export function apply(ctx: Context): void {
  ctx.on('llm/stream', (options, next): AsyncIterable<StreamChunk> => {
    if (options.sessionId === undefined) return next()
    const session = ctx.sessions.get(options.sessionId)
    return session === undefined ? next() : afterCheckpoint(ctx, session, next)
  })

  ctx.on('tools/execute', async (exec, next): Promise<ToolExecutionResult> => {
    if (exec.agent === undefined || exec.parent !== undefined) return next()
    await ctx.sessions.flush(exec.agent.session)
    if (exec.signal.aborted) return abortedBeforeDispatchResult()
    return next()
  })

  // Before each request, persist everything committed by the preceding step;
  // the first step's call is an intentional no-op beyond any prompt intake.
  ctx.on('agent/pre-step', async ({ agent }, next): Promise<PreStepDecision> => {
    await ctx.sessions.flush(agent.session)
    return next()
  })
}
