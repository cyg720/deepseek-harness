

/**
 * Lifecycle-edge publication for both subagent shapes: the contained emitter,
 * the one-shot run observer, and the continuable Activation observer.
 *
 * The public payload contracts ({@link SubagentRunInfo},
 * {@link SubagentRunEndInfo}) live in `./types.ts` with the rest of the seam's
 * consumer-facing types; this module owns only the implementation and the
 * package-private {@link ActivationObserver} the continuation manager consumes.
 * Keeping the internal control interface out of the published surface is
 * deliberate: the observer's `start`/`capture`/`settle` ordering is a contract
 * between this module and one in-package caller, not something a plugin may
 * depend on.
 *
 * @module @deepseek-ai/dsh-subagent/lifecycle
 */

/*
 * 【文件职责】统一发布一次性及可继续子 Agent 的生命周期边，隔离观察者错误并保持内部控制接口私有。
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { foldConsumedWork } from '@deepseek-ai/dsh-agent'
import { SessionLogOffset } from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionId, SessionLogOffset as SessionLogOffsetType } from '@deepseek-ai/dsh-session'
import { finalAssistantOutput } from './assistant-output.ts'
import { SubagentRunId } from './types.ts'
import type { SubagentResult, SubagentRun, SubagentRunEndInfo, SubagentRunInfo } from './types.ts'

/**
 * How one Activation's residency epoch ended, as both the terminal lifecycle
 * edge and the manager's own parent delivery report it.
 */
// 中文：一次 Activation 驻留 epoch 的终结信息：既作为 subagent/end 事件载荷的一部分，
// 也作为管理器向父代理投递结算通知的依据。
export interface ActivationTerminal {
  /** Why this epoch's last ordinary turn ended, or `error` when teardown failed. */
  readonly stopReason: SubagentResult['stopReason']
  /** The epoch's final assistant content, absent when it produced none or failed. */
  readonly output?: ContentBlock[]
}

/**
 * Lifecycle observer for one Activation's residency epoch, so continuable
 * children emit the same start/end pair as one-shot runs. Package-private: the
 * continuation manager is the only consumer, and its call ordering is an
 * in-package contract rather than a published extension point.
 */
// 中文：一次 Activation 驻留 epoch 的生命周期观察器（包内私有）：续聊管理器按
// start → capture → terminal → settle 的顺序调用，使续聊子代理与一次性运行
// 对外呈现完全相同的 start/end 事件对。
export interface ActivationObserver {
  /**
   * Publish the start edge once the epoch is resident.
   * @param child - the resident child agent, whose log suffix bounds this epoch.
   */
  start(child: Agent): void
  /**
   * Snapshot the child-dependent terminal facts while the child is still
   * registered, because handle disposal unregisters it and consumers resolve it
   * to read the child's own log and scope.
   * @param child - the quiescent child agent about to be released.
   */
  capture(child: Agent): void
  /**
   * Resolve the terminal facts {@link settle} will publish, without publishing
   * them. The manager's parent delivery must run before the ownership release
   * that lets the parent settle, which is earlier than the terminal edge; both
   * therefore read one computation instead of restating the failure rule.
   * @param failure - the teardown or durability failure, or `undefined` on success.
   * @returns this epoch's stop reason and final assistant content.
   */
  terminal(failure: unknown): ActivationTerminal
  /**
   * Publish the terminal edge exactly once, pairing this epoch's {@link start},
   * after the disposal outcome is known. Called only for a resident epoch: a
   * failure before residency publishes no edge, because inventing one would
   * report a lifecycle the child never had.
   * @param failure - the teardown or durability failure, or `undefined` on success.
   */
  settle(failure: unknown): void
}

/**
 * Publish one lifecycle edge with per-listener exception containment. Run edges
 * carry the delegating parent that keys scoped dispatch; provider removal has no
 * parent carrier and reaches listeners unscoped.
 *
 * The service owns this closure because scoped dispatch keys its carrier by the
 * exact service instance, whose own context filter composes into the carrier;
 * a narrowed stand-in would silently change scope filtering.
 */
// 中文：生命周期发射器签名：前两个重载携带"委托父代理"用于作用域派发，
// provider 移除事件没有父代理载体，不做作用域过滤。
export type LifecycleEmitter = {
  (name: 'subagent/start', info: SubagentRunInfo, parent: Agent): void
  (name: 'subagent/end', info: SubagentRunEndInfo, parent: Agent): void
  (name: 'subagent/provider-removed', info: string): void
}

/**
 * Build the contained lifecycle emitter this seam publishes every edge through.
 * Every listener is independently contained: a synchronous throw or a rejected
 * returned promise is logged without starving peer listeners, changing the run,
 * or — for provider removal, which fires from a disposer — breaking teardown.
 * @param ctx - the service's own context, owning dispatch and the logger.
 * @param carrier - resolve the scoped dispatch carrier for one delegating parent.
 * @returns the emitter both observers and the provider registry publish through.
 */
// 中文：构建"包含式"生命周期发射器：手动派发事件；同步抛出或被 reject 的监听器返回
// 都被记录成 warn 日志，不影响其他监听器、运行本身或销毁流程。
export function createLifecycleEmitter(
  ctx: Context,
  carrier: (parent: Agent) => object,
): LifecycleEmitter {
  return (
    name: 'subagent/start' | 'subagent/end' | 'subagent/provider-removed',
    info: SubagentRunInfo | SubagentRunEndInfo | string,
    parent?: Agent,
  ): void => {
    const dispatchArgs: unknown[] = parent === undefined
      ? [name, info]
      : [carrier(parent), name, info]
    for (const callback of ctx.events.dispatch('emit', dispatchArgs)) {
      try {
        const returned: unknown = callback(info)
        void Promise.resolve(returned).catch((error: unknown) => {
          ctx.logger.warn(`subagent: ${name} listener rejected: ${renderThrown(error)}`)
        })
      } catch (error: unknown) {
        ctx.logger.warn(`subagent: ${name} listener threw: ${renderThrown(error)}`)
      }
    }
  }
}

/**
 * Emit the start/end lifecycle pair for one accepted one-shot run.
 * @param emit - the contained lifecycle emitter.
 * @param provider - the provider that established the run.
 * @param parent - the delegating parent keying scoped dispatch.
 * @param run - the published run whose settlement closes the pair.
 * @returns the same run, unchanged.
 */
// 中文：为一次性运行发射 start/end 事件对：先在运行结果上挂终结观察（reject 也发 end，
// 停止原因记 error），再同步发射 start，保证观察者先看到 start 后看到 end。
export function observeRun(
  emit: LifecycleEmitter,
  provider: string,
  parent: Agent,
  run: SubagentRun,
): SubagentRun {
  const identity = {
    runId: SubagentRunId(randomUUID()),
    provider,
    id: run.id,
    local: run.localAgent !== undefined,
  }
  // Attach the terminal observer before dispatching start. Promise reactions
  // still run after this synchronous start emission, preserving start → end.
  void run.result.then(
    (result) => {
      emit('subagent/end', {
        ...identity,
        stopReason: result.stopReason,
        // Omit the field when no output exists, matching continuable epochs.
        ...result.output.length === 0 ? {} : { lastAssistantMessage: result.output },
      }, parent)
    },
    () => {
      emit('subagent/end', { ...identity, stopReason: 'error' }, parent)
    },
  )
  emit('subagent/start', identity, parent)
  return run
}

/**
 * Build the observer for one continuable Activation's residency epoch. Observers
 * see the same vocabulary as a one-shot run, so a child's start and settlement
 * remain observable without exposing whether the manager materialized, woke, or
 * cold-resumed it. Creation failure before residency emits no lifecycle edge.
 * @param emit - the contained lifecycle emitter.
 * @param provider - the provider name recorded in the durable descriptor.
 * @param childId - the durable child session id.
 * @param parent - the exact live direct parent keying scoped dispatch.
 * @returns the observer whose edges this epoch publishes.
 */
// 中文：为一次续聊 Activation 驻留 epoch 构建观察器：start 记录日志边界并发射 start 边，
// capture 在句柄释放前快照本 epoch 的终止事实，settle 在处置结果已知后发射 end 边；
// 驻留前失败不发任何边。
export function createActivationObserver(
  emit: LifecycleEmitter,
  provider: string,
  childId: SessionId,
  parent: Agent,
): ActivationObserver {
  const identity = { runId: SubagentRunId(randomUUID()), provider, id: childId, local: true }
  // A cold resume replays earlier turns, so this epoch's telemetry must come
  // from the suffix it actually produced — never the whole session, which
  // would report a previous epoch's answer when this one opened no turn.
  let boundary: SessionLogOffsetType = SessionLogOffset(0)
  // Assigned by `capture()`, which the disposal path always runs before
  // `settle()`; a resident epoch therefore always has its facts by then.
  let captured: ActivationTerminal = { stopReason: 'completed' }
  // Teardown failure overrides the epoch's own outcome and withholds its
  // output: an answer this harness could not durably release is not a result.
  const terminal = (failure: unknown): ActivationTerminal => failure === undefined
    ? captured
    : { stopReason: 'error' }
  return {
    start: (child: Agent): void => {
      boundary = child.session.seq
      emit('subagent/start', identity, parent)
    },
    capture: (child: Agent): void => {
      const own = child.session.snapshotEvents(boundary)
      const output = finalAssistantOutput(own)
      captured = {
        stopReason: epochStopReason(own),
        ...output === undefined ? {} : { output },
      }
    },
    terminal,
    settle: (failure: unknown): void => {
      const { stopReason, output } = terminal(failure)
      emit('subagent/end', {
        ...identity,
        stopReason,
        ...output === undefined ? {} : { lastAssistantMessage: output },
      }, parent)
    },
  }
}

/**
 * Why this child's epoch ended, for the terminal lifecycle edge and the
 * manager's own parent delivery. The child's own log is authoritative:
 * teardown succeeding says nothing about whether the model errored, hit its
 * token ceiling, or was cancelled, so deriving the reason from disposal would
 * report failed work as completed.
 *
 * {@link foldConsumedWork} supplies both halves the raw turn sequence cannot:
 * which turn accounts for the work this epoch consumed, and whether accepted
 * work was cancelled after it without any turn opening over it. A recorded
 * failure still wins over a cancellation — stopping a child that had already
 * failed does not turn its failure into a cancellation.
 * @param events - this epoch's own event suffix.
 * @returns its terminal stop reason; `completed` only for an epoch that both
 *   closed cleanly and had nothing left to run.
 */
// 中文：从本 epoch 的事件后缀推导停止原因：以子代理自己的日志为准（teardown 成功
// 不代表模型没出错）；foldConsumedWork 提供"本 epoch 消耗的回合"与"被取消的未跑工作"
// 两个线索，已记录的失败优先于取消。
function epochStopReason(events: readonly SessionEvent[]): SubagentResult['stopReason'] {
  const { end, droppedUnrun } = foldConsumedWork(events)
  switch (end?.data.reason.kind) {
    case 'max-tokens':
      return 'max-tokens'
    case 'aborted':
    case 'interrupted':
      return 'aborted'
    case 'error':
      return 'error'
    // A pre-step rejection — a hook deny, a policy plugin — discarded input
    // this epoch had claimed: the work was declined, not done.
    case 'blocked':
      return 'refusal'
    // A clean ending and no accounting turn at all share one rule: the epoch
    // finished what it was given unless a cancelled queue says otherwise.
    case undefined:
    case 'completed':
      return droppedUnrun ? 'aborted' : 'completed'
    /* v8 ignore next 3 -- `TurnEndReason` is merge-extensible, so this arm needs a
     * backend that adds a variant; treating an unnameable reason as success would
     * report failed work as completed. */
    default:
      return 'error'
  }
}

/** Render any listener-thrown value without letting coercion escape containment. */
// 中文：把监听器抛出的任意值渲染成可读字符串；渲染过程自身失败时给出固定兜底文本，
// 保证日志记录永远不会再抛。
function renderThrown(value: unknown): string {
  try {
    return value instanceof Error ? `${value.name}: ${value.message}` : String(value)
  } catch {
    return '<unrenderable thrown value>'
  }
}
