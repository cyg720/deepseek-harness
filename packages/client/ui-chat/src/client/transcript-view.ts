/** Host-backed completed-Turn transcript presentation policy.
 * @remarks 文件说明：文件职责：实现 client/ui-chat 中 transcript view 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的 client/ui-chat
 * 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。；
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。 */

import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import {
  DEFAULT_TRANSCRIPT_VIEW_MODE, TRANSCRIPT_VIEW_FIELD,
  type ChatSettings, type TranscriptViewMode,
} from '../chat-settings.ts'

/** Live transcript preference consumed by Chat and its Settings row.
 * @remarks 中文说明：类说明：TranscriptViewPolicy 用于集中封装 处理 TranscriptViewPolicy
 * 相关状态与行为。；核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。；使用场景：由 client/ui-chat
 * 在对应插件或业务生命周期内创建和调用。 */
export class TranscriptViewPolicy {
  /** Reactive current mode; defaults to Compact before Host settings arrive.
   * @remarks 中文说明：常量说明：mode 用于处理 mode 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
  readonly mode: SnapshotStore<TranscriptViewMode> = createSnapshotStore(DEFAULT_TRANSCRIPT_VIEW_MODE)

  /**
   * @param host - durable Chat settings scope.
   * @remarks 中文说明：功能说明：处理 TranscriptViewPolicy 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：host（SettingsScope<ChatSettings>）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：当前类实例；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：通过 new
   * TranscriptViewPolicy(host) 创建实例，并在所属生命周期内使用。
   */
  constructor(private readonly host: SettingsScope<ChatSettings>) {
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    host.subscribe(() => { this.adopt() })
    this.adopt()
  }

  /**
   * Publish and persist one explicit user choice.
   * @param mode - Normal or Compact transcript presentation.
   * @remarks 中文说明：功能说明：设置 Mode 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：mode（TranscriptViewMode）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 setMode(mode)，并按返回类型处理结果。
   */
  setMode(mode: TranscriptViewMode): void {
    if (this.mode.getSnapshot() === mode) return
    this.mode.set(mode)
    void this.host.set(TRANSCRIPT_VIEW_FIELD, mode)
  }

  /** Adopt the latest accepted Host section without writing it back.
   * @remarks 中文说明：功能说明：处理 adopt 相关流程；使用场景由所在模块及调用位置决定。；返回值：void；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 adopt()，并按返回类型处理结果。 */
  private adopt(): void {
    /**
     * 常量说明：section 用于处理 section 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const section = this.host.getSnapshot().value
    if (section === undefined || this.mode.getSnapshot() === section.transcriptView) return
    this.mode.set(section.transcriptView)
  }
}
