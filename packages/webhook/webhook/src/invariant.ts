/** Package-owned relationship invariant for webhook-origin prompt admission.
 * @remarks 文件说明：文件职责：实现 webhook/webhook 中 invariant 模块的职责，并向相邻模块提供可复用能力。；
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的 webhook/webhook 能力，
 * 使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。；
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-workspace'
import type {} from './types.ts'

/**
 * 常量说明：PACKAGE_NAME 用于处理 PACKAGE_NAME 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const PACKAGE_NAME = '@deepseek-ai/dsh-webhook'

/** Cordis invariant-companion plugin name.
 * @remarks 中文说明：常量说明：name 用于处理 name 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
export const name = 'webhook-invariant'
/** Registry required before reserving this package's invariant ownership.
 * @remarks 中文说明：常量说明：inject 用于处理 inject 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
export const inject = ['invariants']

/** Verify that one webhook-origin message already belongs to its cwd Workspace.
 * @remarks 中文说明：常量说明：install 用于处理 install 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：ctx（Context）：提供当前 Cordis
 * 插件上下文与已声明服务；必须满足声明的类型及调用时序要求。；参数：fail（InvariantFailure）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。；返回值：void；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用
 * 匿名回调(ctx, fail)，并按返回类型处理结果。
 */
const install: InvariantInstaller = Object.assign(function installWebhookMessages(
  ctx: Context,
  fail: InvariantFailure,
): void {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：_mode（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：eventName（由 TypeScript
   * 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；参数：args（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(_mode, eventName, args)，
   * 并按返回类型处理结果。
   */
  ctx.on('internal/dispatch', (_mode, eventName, args) => {
    if (eventName !== 'session/event') return
    /**
     * 常量说明：session、event 用于处理 session、event 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const [session, event] = args as [Session, SessionEvent]
    if (event.type !== 'agent/inbox/spliced') return
    /**
     * 常量说明：webhookMessages 用于处理 webhookMessages 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：message（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(message)，并按返回类型处理结果。
     */
    const webhookMessages = event.data.inserted.filter(message => message.source.kind === 'webhook')
    if (webhookMessages.length === 0) return
    /**
     * 常量说明：cwd 用于处理 cwd 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const cwd = session.header.cwd
    if (cwd === undefined) return fail(`webhook Session "${session.id}" has no cwd`)
    /**
     * 常量说明：owners 用于处理 owners 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：workspace（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(workspace)，并按返回类型处理结果。
     */
    const owners = ctx.workspaceRegistry.list().filter(workspace => workspace.sessionIds.includes(session.id))
    if (owners.length !== 1) {
      return fail(`webhook Session "${session.id}" belongs to ${owners.length} Workspaces at prompt admission`)
    }
    if (owners[0]?.path !== cwd) {
      fail(`webhook Session "${session.id}" cwd ${JSON.stringify(cwd)} differs from its Workspace path`)
    }
  }, { global: true })
}, {
  inject: ['workspaceRegistry'],
})

/**
 * Register this package's relationship invariant.
 * @param ctx - Cordis context carrying the invariant registry.
 * @returns the invariant registration disposer.
 * @remarks 中文说明：常量说明：apply 用于注册并应用 apply 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。；功能说明：注册并应用 apply 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：ctx（Context）：提供当前 Cordis 插件上下文与已声明服务；必须满足声明的类型及调用时序要求。；
 * 返回值：Promise<() => void>；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * apply(ctx)，并按返回类型处理结果。
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
