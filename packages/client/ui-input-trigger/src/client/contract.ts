/*
 * ================================ 文件注释 ================================
 * 【文件职责】斜杠管线的服务冻结契约（纯类型）：定义 ctx.inputTriggers 服务的
 *             注册与会话控制器解析接口。
 * 【技术维度】纯类型：InputTriggerService 实现此面并发布为 ctx.inputTriggers；
 *             源只看到 registerSource，对话接线层用 sessionOf 解析会话控制器。
 * 【产品维度】触发管线对外的服务形态。
 * 【逻辑维度】registerSource 注册源（返回清理器）；sessionOf 解析会话控制器。
 * 【关键边界】重复 trigger/name 对抛错；控制器随会话作用域销毁。
 * 【新手阅读建议】配合 service.ts 与 controller.ts 阅读。
 * ==========================================================================
 */
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
}
