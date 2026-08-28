/**
 * Compact relative-time bucketing shared by every surface that dates a
 * session. Bucketing is here so two surfaces naming the same session agree;
 * the words stay in each plugin's own dictionary, per locale-owned copy.
 *
 * @module @deepseek-ai/dsh-client-ui-primitives/relative-time
 */

/** Relative-time bucket of a dated row's trailing label.
 * @remarks 文件说明：文件职责：实现 client/ui-primitives 中 relative time 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * client/ui-primitives 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。 */
export type RelativeTimeUnit = 'now' | 'minutes' | 'hours' | 'days' | 'months' | 'years'

/** Structured relative time: the bucket plus its magnitude (0 for 'now'). */
export interface RelativeTime {
  unit: RelativeTimeUnit
  n: number
}

/**
 * Compact relative time, as a structured bucket the renderer localizes
 * ("now"/"5min"/"3h"/"2d"/"4mo"/"1y" in en).
 * @param at - epoch ms of the dated moment.
 * @param now - current epoch ms (injected for pure rendering).
 * @returns the row's trailing time bucket and magnitude.
 * @remarks 中文说明：功能说明：处理 relativeTime 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：at（number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：now（number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：RelativeTime；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 relativeTime(at, now)，
 * 并按返回类型处理结果。
 */
export function relativeTime(at: number, now: number): RelativeTime {
  /**
   * 常量说明：MIN 用于处理 MIN 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const MIN = 60_000
  /**
   * 常量说明：HOUR 用于处理 HOUR 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const HOUR = 3_600_000
  /**
   * 常量说明：DAY 用于处理 DAY 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const DAY = 86_400_000
  /**
   * 常量说明：diff 用于处理 diff 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const diff = Math.max(0, now - at)
  if (diff < MIN) return { unit: 'now', n: 0 }
  if (diff < HOUR) return { unit: 'minutes', n: Math.floor(diff / MIN) }
  if (diff < DAY) return { unit: 'hours', n: Math.floor(diff / HOUR) }
  if (diff < 30 * DAY) return { unit: 'days', n: Math.floor(diff / DAY) }
  if (diff < 365 * DAY) return { unit: 'months', n: Math.floor(diff / (30 * DAY)) }
  return { unit: 'years', n: Math.floor(diff / (365 * DAY)) }
}
