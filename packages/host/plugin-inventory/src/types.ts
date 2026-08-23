/**
 * ================================ 文件注释 ================================
 * 【文件职责】plugin-inventory 域的纯类型契约：插件条目 id、fiber 阶段与条目/
 * 快照形状。无运行时逻辑，供客户端与服务端共用。
 * 【技术维度】PluginEntryId 是品牌化字符串（编译期约束）；PluginFiberPhase 把
 * Cordis Fiber 生命周期投影为字符串字面量联合（null = 无活跃根 fiber）。
 * 【产品维度】"已装插件"面板的数据形状：枚举插件名、启用状态与生命周期阶段。
 * 【逻辑维度】PluginEntryId → PluginFiberPhase → PluginInventoryEntry → 快照。
 * 【关键边界】enabled 是有效 Loader 启用态（含被禁用的祖先组）；fiberPhase 为
 * null 时表示该条目当前没有活跃根 fiber。
 * 【新手阅读建议】与 index.ts 的 list() 投影逻辑对照阅读。
 * ==========================================================================
 */
import type { Branded } from '@deepseek-ai/dsh-brand'

/** Stable Loader-tree identity of one configured plugin entry. */
export type PluginEntryId = Branded<'PluginEntryId'>

/** Lifecycle state of an entry's root Fiber, or null when it has no live root Fiber. */
export type PluginFiberPhase =
  | 'pending'
  | 'loading'
  | 'active'
  | 'failed'
  | 'unloading'
  | null

/** One non-group Loader entry exposed to trusted clients. */
export interface PluginInventoryEntry {
  readonly entryId: PluginEntryId
  /** Exact module specifier imported by the Loader entry. */
  readonly moduleName: string
  /** Effective Loader enablement, including disabled ancestor groups. */
  readonly enabled: boolean
  readonly fiberPhase: PluginFiberPhase
}

/** Point-in-time inventory returned by the plugin inventory Remote. */
export interface PluginInventorySnapshot {
  readonly entries: readonly PluginInventoryEntry[]
}
