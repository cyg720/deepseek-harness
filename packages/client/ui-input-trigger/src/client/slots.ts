/** Slash-menu props for the Conversation-owned input overlay.
 * @remarks 文件说明：文件职责：实现 client/ui-input-trigger 中 slots 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * client/ui-input-trigger 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。 */
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { InputTriggerCrumb, PickAction } from '../types.ts'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { MenuState } from '../core/contract.ts'

/** Injected business face of the MenuView overlay entry (copy rides the standard locale seat, not this face). */
export interface MenuViewInjected {
  /** The service's menu state store (read-only here; MenuView subscribes). */
  menu: SnapshotStore<MenuState>
  /** Crumbs published per source for the open menu; sources without a header never appear. */
  headers: SnapshotStore<ReadonlyMap<string, readonly InputTriggerCrumb[]>>
  /**
   * Pointer pick routed back through the service pipeline.
   * @param source - source (group) name.
   * @param index - candidate index within the group.
   * @param action - settling pick (default) or the candidate's drill action.
   */
  onPick: (source: string, index: number, action?: PickAction) => void
  /**
   * Pointer hover routed to the shared highlight (pointer and keyboard drive
   * one highlight — last input wins).
   * @param source - source (group) name.
   * @param index - candidate index within the group.
   */
  onHover: (source: string, index: number) => void
  /**
   * Pointer pick on one header crumb, routed back through the source's drill path.
   * @param source - source (group) name.
   * @param index - crumb index within that source's published header.
   */
  onCrumb: (source: string, index: number) => void
  /** Dismiss the menu (external pointer outside the composer area). */
  onDismiss: () => void
}
