/** Realm-stable translation between Client catalog keys and common Runtime script keys.
 * @remarks 文件说明：文件职责：实现 experimental/inspector 中 scripts 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/inspector 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。 */

import { inspectorId } from '../../../shared/identity.ts'
import type { RuntimeScriptKey } from '../../../shared/cdp/ids.ts'

/** Allocates one shared script identity namespace for all backends in a Client realm.
 * @remarks 中文说明：类说明：ClientScriptIdentity 用于集中封装 处理 ClientScriptIdentity
 * 相关状态与行为。；核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。；使用场景：由
 * experimental/inspector 在对应插件或业务生命周期内创建和调用。 */
export class ClientScriptIdentity {
  /**
   * 常量说明：publicByLocal 用于处理 publicByLocal 相关数据，作用于成员；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  private readonly publicByLocal = new Map<RuntimeScriptKey, RuntimeScriptKey>()

  /**
   * 功能说明：处理 ClientScriptIdentity 相关流程；使用场景由所在模块及调用位置决定。
   * @param contextId （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns 当前类实例；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 通过 new ClientScriptIdentity(contextId) 创建实例，并在所属生命周期内使用。
   */
  constructor(private readonly contextId: number) {}

  /**
   * Convert a Client-local key to the realm's public Runtime script key.
   * @param localKey - Script key used on the Client wire.
   * @returns Stable key shared by this realm's Runtime, Console, and Sources backends.
   * @remarks 中文说明：功能说明：处理 toRuntime 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：localKey（RuntimeScriptKey）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：RuntimeScriptKey；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * toRuntime(localKey)，并按返回类型处理结果。
   */
  toRuntime(localKey: RuntimeScriptKey): RuntimeScriptKey {
    /**
     * 变量说明：scriptKey 用于处理 scriptKey 相关数据，作用于当前作用域；其值可能随流程推进而变化，
     * 读写时需遵守声明类型和所在生命周期。
     */
    let scriptKey = this.publicByLocal.get(localKey)
    if (scriptKey !== undefined) return scriptKey
    scriptKey = inspectorId<'RuntimeScriptKey'>(
      `client:${String(Math.abs(this.contextId))}:${String(this.publicByLocal.size + 1)}`,
      'scriptKey',
    )
    this.publicByLocal.set(localKey, scriptKey)
    return scriptKey
  }
}
