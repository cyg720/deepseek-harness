import type { InputTriggerConsumerPolicy } from './qs/consumer.ts'
/**
 * Frozen service contract of the slash pipeline. Types only. The
 * InputTriggerService implementation publishes this face as `ctx.inputTriggers`; sources
 * see registerSource alone, the conversation wiring layer resolves its
 * per-session controller through sessionOf.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { InputTriggerSource } from '../types.ts'
import type { InputTriggerController } from './controller.ts'

/** The `ctx.inputTriggers` service face. */
export interface InputTriggerServiceContract {
  /**
   * Register one trigger source; duplicate trigger/name pairs throw.
   * @param src - source that discovers and resolves slash or reference candidates.
   * @returns effect disposer removing this source.
   */
  registerSource(src: InputTriggerSource): () => void
  /**
   * Resolve the lazy controller owned by one session scope.
   * @param actx - session-scoped Client context.
   * @returns controller that dies with that scope.
   */
  sessionOf(actx: ClientContext): InputTriggerController
  /**
   * 为可见输入取得独占来源策略。
   * @param actx - 会话作用域。
   * @param policy - 可见输入允许的来源。
   * @returns 共享控制器及幂等释放动作；同时存在两个租约时拒绝。
   */
  acquireConsumer(actx: ClientContext, policy: InputTriggerConsumerPolicy): { controller: InputTriggerController; release: () => void }
}
