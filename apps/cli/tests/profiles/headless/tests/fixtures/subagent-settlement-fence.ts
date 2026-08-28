/**
 * Loader fixture that holds the parent's second step until settlement delivery.
 * @module subagent-settlement-fence
 * @remarks 文件说明：文件职责：验证 apps/cli 中 subagent settlement fence 相关行为与失败场景。；
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。；产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。；
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。；
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent-loop'
import type {} from '@deepseek-ai/dsh-subagent'

/** Fixture plugin name.
 * @remarks 中文说明：常量说明：name 用于处理 name 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
export const name = 'subagent-settlement-fence'

/**
 * Fence the parent's post-spawn request behind admission of the manager notice.
 *
 * This pins content order, not step placement: the held pre-step runs after its
 * own `Inbox.claim()`, so the notice lands after step 2's claim and is claimed at
 * step 3 because the child's settlement pipeline is strictly longer than the
 * parent's claim path, not because a barrier forces it.
 * @param ctx - assembled headless-agent context.
 * @remarks 中文说明：功能说明：注册并应用 apply 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：ctx（Context）：提供当前 Cordis 插件上下文与已声明服务；必须满足声明的类型及调用时序要求。；返回值：void；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 apply(ctx)，并按返回类型处理结果。
 */
export function apply(ctx: Context): void {
  /**
   * 常量说明：delivered 用于处理 delivered 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const delivered = Promise.withResolvers<undefined>()
  /**
   * 变量说明：hasDelivered 用于判断是否包含 Delivered 相关数据，作用于当前作用域；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  let hasDelivered = false

  ctx.effect(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {
    /**
     * 常量说明：disposeInbox 用于处理 disposeInbox 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
      const disposeInbox = ctx.root.on('agent/inbox/inserted', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：{ agent, message }（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调({ agent, message })，
 * 并按返回类型处理结果。
 */ ({ agent, message }) => {
          if (agent.session.header.parentSession !== undefined || message.source.kind !== 'subagent-settled') return
          hasDelivered = true
          delivered.resolve(undefined)
        })
      /**
     * 常量说明：disposeStep 用于处理 disposeStep 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
      const disposeStep = ctx.root.on('agent/pre-step', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：{ agent, turn, step }（由
 * TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：next（由
 * TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript
 * 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调({ agent, turn,
 * step…, next)，并按返回类型处理结果。
 */ async ({ agent, turn, step }, next) => {
          if (agent.session.header.parentSession === undefined && turn === 1 && step === 2 && !hasDelivered) {
            await delivered.promise
          }
          return next()
        })
      /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
      return () => {
        disposeStep()
        disposeInbox()
      }
    }, 'subagent-settlement-fence.listeners')
}
