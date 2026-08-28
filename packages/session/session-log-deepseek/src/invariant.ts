/** Package-owned invariants for DeepSeek session-log acceptance watermarks.
 * @remarks 文件说明：文件职责：实现 session/session-log-deepseek 中 invariant 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * session/session-log-deepseek 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态
 * → 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。 */

import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type {} from './types.ts'

/**
 * 常量说明：PACKAGE_NAME 用于处理 PACKAGE_NAME 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const PACKAGE_NAME = '@deepseek-ai/dsh-session-log-deepseek'

/** Cordis companion plugin name.
 * @remarks 中文说明：常量说明：name 用于处理 name 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
export const name = 'session-log-deepseek-invariant'
/** Service required before the companion can reserve package ownership.
 * @remarks 中文说明：常量说明：inject 用于处理 inject 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
export const inject = ['invariants']

/** Validate one acceptance watermark against its containing event and session.
 * @remarks 中文说明：功能说明：校验 Delivery Accepted 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：session（Session）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：event（SessionEvent<'session-log-deepseek/delivery-accepted'>）：提供需要处
 * 理或投影的事件数据；必须满足声明的类型及调用时序要求。；参数说明：fail（InvariantFailure）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。；返回值：void；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 validateDeliveryAccepted(session, event, fail)，
 * 并按返回类型处理结果。 */
function validateDeliveryAccepted(session: Session, event: SessionEvent<'session-log-deepseek/delivery-accepted'>, fail: InvariantFailure): void {
  /**
   * 常量说明：sessionId、throughSeq 用于处理 sessionId、throughSeq 相关数据，作用于当前作用域；
   * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const { sessionId, throughSeq } = event.data
  /**
   * 常量说明：inherited 用于处理 inherited 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const inherited = session.header.parentSession !== undefined
    && session.header.seedLength !== undefined
    && event.seq < session.header.seedLength
  if (sessionId !== session.id && !inherited) {
    fail('a non-inherited session-log-deepseek/delivery-accepted event must name its containing session')
  }
  if (!Number.isSafeInteger(throughSeq) || throughSeq < 0 || throughSeq >= event.seq) {
    fail(`session-log-deepseek/delivery-accepted throughSeq must identify an earlier event, got ${throughSeq} at seq ${event.seq}`)
  }
}

/** Validate acceptance watermarks already present in one Session.
 * @remarks 中文说明：功能说明：校验 Session 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：session（Session）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：fail（InvariantFailure）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 validateSession(session,
 * fail)，并按返回类型处理结果。 */
function validateSession(session: Session, fail: InvariantFailure): void {
  /**
   * 变量说明：event 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (const event of session.events) {
    if (event.type === 'session-log-deepseek/delivery-accepted') validateDeliveryAccepted(session, event, fail)
  }
}

/** Validate one live session-event dispatch.
 * @remarks 中文说明：功能说明：校验 Dispatched 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：args（unknown[]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：fail（InvariantFailure）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 validateDispatched(args,
 * fail)，并按返回类型处理结果。 */
function validateDispatched(args: unknown[], fail: InvariantFailure): void {
  /**
   * 常量说明：session、event 用于处理 session、event 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const [session, event] = args as [Session, SessionEvent]
  if (event.type === 'session-log-deepseek/delivery-accepted') validateDeliveryAccepted(session, event, fail)
}

/** Install validation for restored, newly created, and newly appended watermarks.
 * @remarks 中文说明：常量说明：install 用于处理 install 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：ctx（Context）：提供当前 Cordis
 * 插件上下文与已声明服务；必须满足声明的类型及调用时序要求。；参数：fail（InvariantFailure）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 典型用法：在完成前置校验后调用 匿名回调(ctx, fail)，并按返回类型处理结果。
 */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  /**
   * 常量说明：validateExisting 用于校验 Existing 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   * 功能说明：校验 Existing 相关流程；使用场景由所在模块及调用位置决定。
   * @param session （Session）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 validateExisting(session)，并按返回类型处理结果。
   */
  const validateExisting = (session: Session): void => { validateSession(session, fail) }
  ctx.sessions.list().forEach(validateExisting)
  ctx.on('session/created', validateExisting, { global: true })
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：_mode（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：eventName（由 TypeScript
   * 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；参数：args（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(_mode, eventName, args)，
   * 并按返回类型处理结果。
   */
  ctx.on('internal/dispatch', (_mode, eventName, args) => {
    if (eventName === 'session/event') validateDispatched(args, fail)
  }, { global: true })
}, { inject: ['sessions'] })

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 * @remarks 中文说明：常量说明：apply 用于注册并应用 apply 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。；功能说明：注册并应用 apply 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：ctx（Context）：提供当前 Cordis 插件上下文与已声明服务；必须满足声明的类型及调用时序要求。；
 * 返回值：Promise<() => void>；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * apply(ctx)，并按返回类型处理结果。
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
