/**
 * Loader fixture that holds the child until its parent's spawn turn ends,
 * then parks the parent until settlement follows its Agent message.
 * @module subagent-send-message-fence
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent-loop'

/** Fixture plugin name. */
export const name = 'subagent-send-message-fence'

/**
 * Keep replay scheduling from folding settlement into the parent's first turn
 * or starting a second parent request between the Agent message and settlement.
 * @param ctx - assembled ACP-agent context.
 * @remarks 中文说明：功能说明：注册并应用 apply 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：ctx（Context）：提供当前 Cordis 插件上下文与已声明服务；必须满足声明的类型及调用时序要求。；返回值：void；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 apply(ctx)，并按返回类型处理结果。
 */
export function apply(ctx: Context): void {
  /**
   * 常量说明：childReady 用于处理 childReady 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const childReady = Promise.withResolvers<undefined>()
  /**
   * 常量说明：parentStopped 用于处理 parentStopped 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const parentStopped = Promise.withResolvers<undefined>()
  /**
   * 常量说明：childSettled 用于处理 childSettled 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const childSettled = Promise.withResolvers<undefined>()
  /**
   * 变量说明：hasStopped 用于判断是否包含 Stopped 相关数据，作用于当前作用域；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  let hasStopped = false
  /**
   * 变量说明：parentMaintenance 用于处理 parentMaintenance 相关数据，作用于当前作用域；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  let parentMaintenance: Promise<void> | undefined

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  ctx.effect(() => {
    /**
     * 常量说明：disposeSession 用于处理 disposeSession 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：session（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：event（由 TypeScript
     * 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(session, event)，
     * 并按返回类型处理结果。
     */
    const disposeSession = ctx.root.on('session/event', (session, event) => {
      if (session.header.parentSession !== undefined || event.type !== 'turn/end' || event.data.turn !== 1) return
      hasStopped = true
      parentStopped.resolve(undefined)
    })
    /**
     * 常量说明：disposeStatus 用于处理 disposeStatus 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：{ agent, status }（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调({ agent, status })，
     * 并按返回类型处理结果。
     */
    const disposeStatus = ctx.root.on('agent/status', ({ agent, status }) => {
      if (
        agent.session.header.parentSession === undefined &&
        status === 'idle' &&
        hasStopped &&
        parentMaintenance === undefined
      ) {
        /**
         * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
         * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
         */
        parentMaintenance = agent.runMaintenance(async () => {
          await childSettled.promise
        })
      }
    })
    /**
     * 常量说明：disposeInbox 用于处理 disposeInbox 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：{ agent, message }（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调({ agent, message })，
     * 并按返回类型处理结果。
     */
    const disposeInbox = ctx.root.on('agent/inbox/inserted', ({ agent, message }) => {
      if (
        agent.session.header.parentSession === undefined &&
        message.source.kind === 'subagent-settled'
      ) {
        childSettled.resolve(undefined)
      }
    })
    /**
     * 常量说明：disposeStep 用于处理 disposeStep 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：{ agent, turn, step }（由
     * TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：next（由
     * TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript
     * 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调({ agent, turn,
     * step…, next)，并按返回类型处理结果。
     */
    const disposeStep = ctx.root.on('agent/pre-step', async ({ agent, turn, step }, next) => {
      if (agent.session.header.parentSession !== undefined) {
        childReady.resolve(undefined)
        if (!hasStopped) await parentStopped.promise
      } else if (turn === 1 && step === 2) {
        await childReady.promise
      }
      return next()
    })
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    return () => {
      childSettled.resolve(undefined)
      disposeStep()
      disposeInbox()
      disposeStatus()
      disposeSession()
    }
  }, 'subagent-send-message-fence.listeners')
}
