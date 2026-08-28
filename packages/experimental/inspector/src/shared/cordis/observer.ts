/** Lifecycle-driven Cordis tree publication shared by Host and Client plugin faces.
 * @remarks 文件说明：文件职责：实现 experimental/inspector 中 observer 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/inspector 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。 */

import type { Context } from '@deepseek-ai/cordis'
import type { CordisTreeSnapshot } from './snapshot.ts'
import { CordisTreeCollector, type CordisTreeLimits } from './collector.ts'

/** Receives one complete semantic snapshot after a coalesced Cordis mutation. */
export type CordisTreeSnapshotListener = (snapshot: CordisTreeSnapshot) => void

/**
 * Observe one Cordis realm and publish immutable tree replacements.
 * @param ctx - Plugin context whose root is inspected and whose effects own listeners.
 * @param listener - Consumer of complete snapshots in the inspected realm.
 * @param limits - Snapshot node and encoded-byte limits.
 * @returns A disposer that unregisters listeners and releases retained objects.
 * @remarks 中文说明：功能说明：处理 observeCordisTree 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：ctx（Context）：提供当前 Cordis 插件上下文与已声明服务；必须满足声明的类型及调用时序要求。；
 * 参数说明：listener（CordisTreeSnapshotListener）：接收后续状态或事件并执行调用方逻辑；
 * 必须满足声明的类型及调用时序要求。；参数说明：limits（CordisTreeLimits）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。；返回值：() => void；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 observeCordisTree(ctx, listener, limits)，并按返回类型处理结果。
 */
export function observeCordisTree(
  ctx: Context,
  listener: CordisTreeSnapshotListener,
  limits: CordisTreeLimits,
): () => void {
  /**
   * 常量说明：collector 用于处理 collector 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const collector = new CordisTreeCollector(ctx.root, limits)
  /**
   * 变量说明：scheduled 用于处理 scheduled 相关数据，作用于当前作用域；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  let scheduled = false
  /**
   * 变量说明：closed 用于处理 closed 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let closed = false
  /**
   * 常量说明：publish 用于处理 publish 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   * 功能说明：处理 publish 相关流程；使用场景由所在模块及调用位置决定。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 publish()，并按返回类型处理结果。
   */
  const publish = (): void => {
    scheduled = false
    if (closed) return
    listener(collector.snapshot())
  }
  /**
   * 常量说明：schedule 用于处理 schedule 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   * 功能说明：处理 schedule 相关流程；使用场景由所在模块及调用位置决定。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 schedule()，并按返回类型处理结果。
   */
  const schedule = (): void => {
    if (scheduled || closed) return
    scheduled = true
    queueMicrotask(publish)
  }
  /**
   * 常量说明：disposers 用于处理 disposers 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const disposers = [
    ctx.on('internal/plugin', schedule, { global: true }),
    ctx.on('internal/status', schedule, { global: true }),
  ]
  publish()
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  return () => {
    if (closed) return
    closed = true
    /**
     * 变量说明：dispose 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const dispose of disposers) dispose()
    collector.close()
  }
}
