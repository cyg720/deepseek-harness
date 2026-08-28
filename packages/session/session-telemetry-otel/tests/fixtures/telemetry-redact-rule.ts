/**
 * 文件职责：验证 session/session-telemetry-otel 中 telemetry redact rule 相关行为与失败场景。
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。
 * 产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 */
import type { Context } from '@deepseek-ai/cordis'

/**
 * Deployment-style redaction rule for the telemetry e2e: scrubs the fixture
 * credential from body strings, exactly as a real deployment would mount its
 * own rules on the `session-telemetry/record` waterfall.
 * @remarks 中文说明：常量说明：SECRET 用于处理 SECRET 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */

const SECRET = /sk-e2efixture[0-9]+/g
/**
 * 常量说明：PLACEHOLDER 用于处理 PLACEHOLDER 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const PLACEHOLDER = '[E2E-REDACTED]'

/**
 * 功能说明：处理 scrub 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns unknown；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 scrub(value)，并按返回类型处理结果。
 */
function scrub(value: unknown): unknown {
  if (typeof value === 'string') return value.replace(SECRET, PLACEHOLDER)
  if (Array.isArray(value)) return value.map(scrub)
  if (value !== null && typeof value === 'object') {
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：[key, entry]（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调([key, entry])，并按返回类型处理结果。
     */
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, scrub(entry)]))
  }
  return value
}

/**
 * 常量说明：name 用于处理 name 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
export const name = 'telemetry-redact-rule'

/** Mount the fixture scrub rule onto the redact waterfall.
 * @remarks 中文说明：功能说明：注册并应用 apply 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：ctx（Context）：提供当前 Cordis 插件上下文与已声明服务；必须满足声明的类型及调用时序要求。；返回值：void；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 apply(ctx)，并按返回类型处理结果。 */
export function apply(ctx: Context): void {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：_record（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：next（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(_record, next)，并按返回类型处理结果。
   */
  ctx.on('session-telemetry/record', (_record, next) => {
    /**
     * 常量说明：record 用于处理 record 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const record = next()
    return { ...record, body: scrub(record.body) }
  })
}
